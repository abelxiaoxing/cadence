/** Self-healing for management commands, and `cadence doctor`. SDK-free.
 * Startup heals automatically; doctor shows the same picture readonly and,
 * with --fix, also handles what needs one confirmation. */
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { createInterface } from "node:readline";
import { isatty } from "node:tty";
import { defaultStateHome } from "../workspace.ts";
import { ContractError } from "./contracts/core.ts";
import { ServiceCoordination } from "./coordination.ts";
import { GatewayStore } from "./gateway-store.ts";
import { type RecoveryEvent, RecoveryLog } from "./recovery-log.ts";
import {
  type HealOptions,
  type HealOutcome,
  healProjectAt,
  healWorkbench,
  RegistryHealer,
} from "./self-heal.ts";
import { serverConfigPath } from "./server-config.ts";

const CAUSES: Record<RecoveryEvent["cause"], string> = {
  reboot: "the machine restarted while Cadence was running",
  crash: "the Cadence process ended without its orderly stop",
  restart: "Cadence restarted itself after a runtime fault",
  storage: "some private files were incomplete or damaged",
};
const ACTIONS: Record<RecoveryEvent["actions"][number], string> = {
  "released-locks": "released its locks",
  "stopped-workers": "stopped leftover worker processes",
  "stopped-owner": "stopped the unresponsive owner",
  "continued-history": "continued its history after the last complete entry",
  "archived-history": "archived unreadable history and started a new one",
  "archived-state": "archived damaged state and started afresh",
  "rebuilt-registry": "rebuilt the project registry",
  "removed-temporaries": "set aside interrupted temporary files",
};
function scopeLabel(e: { scope: RecoveryEvent["scope"]; path: string | null }) {
  return e.scope === "project"
    ? `project ${e.path}`
    : e.scope === "workbench"
      ? "the workbench"
      : "the project registry";
}
export function describeEvent(e: RecoveryEvent, archive?: string): string {
  const actions = e.actions.map((a) =>
    a === "stopped-workers" && e.workers
      ? `stopped ${e.workers} leftover worker process${e.workers === 1 ? "" : "es"}`
      : ACTIONS[a],
  );
  const kept =
    e.archive && archive
      ? ` Damaged files are kept for 30 days in ${archive}/${e.archive}.`
      : "";
  return `Cadence recovered ${scopeLabel(e)} automatically: ${CAUSES[e.cause]}; ${actions.join(", ")}.${kept}`;
}
export function describeBlock(
  outcome: Extract<HealOutcome, { status: "blocked" }>,
  target: string,
): string {
  const pid = outcome.pid === null ? "" : ` (PID ${outcome.pid})`;
  switch (outcome.reason) {
    case "owner-unresponsive":
      return `Cadence for ${target} is running${pid} but not responding.\nStop it and recover: cadence doctor --fix\n`;
    case "workers-running":
      return `Leftover Cadence worker processes for ${target} did not stop.\nStop them (or restart the machine), then start again; cadence doctor shows the details.\n`;
    case "foreign-host":
      return `Cadence state for ${target} was registered on another machine${pid}; it cannot be observed from here.\nIf that machine no longer runs Cadence with this state, take it over: cadence doctor --fix\n`;
    default:
      return `A process${pid} may still be the previous Cadence for ${target}, and Cadence cannot tell.\nIf no Cadence is running, recover: cadence doctor --fix\n`;
  }
}
/** Answers a y/N question on an interactive terminal; false otherwise. */
export async function confirm(question: string): Promise<boolean> {
  if (!isatty(0) || !isatty(2)) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer: string = await new Promise((resolve) =>
      rl.question(`${question} [y/N] `, resolve),
    );
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
/** Registry lock first, then every dead reservation in the account. */
export async function healAccount(
  c: ServiceCoordination,
  options: HealOptions = {},
): Promise<{ registry: HealOutcome; projects: HealOutcome[] }> {
  const healer = new RegistryHealer(c);
  const registry = await healer.heal(options);
  if (registry.status === "blocked" || registry.status === "live")
    return { registry, projects: [] };
  return {
    registry,
    projects: await healer.sweep({
      inspect: options.inspect,
      takeOver: false,
    }),
  };
}
function report(outcomes: HealOutcome[], log: RecoveryLog): void {
  for (const outcome of outcomes)
    if (outcome.status === "healed")
      process.stderr.write(
        `${describeEvent(outcome.event, log.archiveDirectory)}\n`,
      );
}
/** Before a project owner starts: heal everything a dead owner left behind.
 * Returns a refusal message when the user must decide. */
export async function healProjectForStart(
  c: ServiceCoordination,
  responsive: () => Promise<boolean>,
): Promise<string | null> {
  const log = new RecoveryLog(c.files);
  const account = await healAccount(c);
  report([account.registry, ...account.projects], log);
  if (account.registry.status === "blocked")
    return describeBlock(account.registry, "the project registry");
  let own = await healProjectAt(c, c.store.root, { responsive });
  if (
    own.status === "blocked" &&
    own.reason === "owner-unresponsive" &&
    (await confirm(
      `Cadence for ${c.store.root}${own.pid === null ? "" : ` (PID ${own.pid})`} is running but not responding. Stop it and recover?`,
    ))
  )
    own = await healProjectAt(c, c.store.root, {
      responsive,
      stopUnresponsive: true,
    });
  report([own], log);
  return own.status === "blocked" ? describeBlock(own, c.store.root) : null;
}
/** Before the workbench starts. */
export async function healWorkbenchForStart(
  store: GatewayStore,
  responsive: () => Promise<boolean>,
): Promise<string | null> {
  const log = new RecoveryLog(store.files);
  const account = await healAccount(
    new ServiceCoordination(null, store.stateHome),
  );
  report([account.registry, ...account.projects], log);
  if (account.registry.status === "blocked")
    return describeBlock(account.registry, "the project registry");
  let own = await healWorkbench(store, { responsive });
  if (
    own.status === "blocked" &&
    own.reason === "owner-unresponsive" &&
    (await confirm(
      `The Cadence workbench${own.pid === null ? "" : ` (PID ${own.pid})`} is running but not responding. Stop it and recover?`,
    ))
  )
    own = await healWorkbench(store, { responsive, stopUnresponsive: true });
  report([own], log);
  return own.status === "blocked" ? describeBlock(own, "the workbench") : null;
}

export interface DoctorOptions {
  fix: boolean;
  yes: boolean;
  stateHome?: string;
  serverConfig?: string;
  workspace?: string;
  probeProject(root: string, stateHome: string): Promise<boolean>;
  probeWorkbench(store: GatewayStore): Promise<boolean>;
}
type Line = { target: string; outcome: HealOutcome };
function summary(line: Line): string {
  const o = line.outcome;
  switch (o.status) {
    case "clean":
      return `${line.target}: OK`;
    case "live":
      return `${line.target}: running`;
    case "reclaimable":
      return `${line.target}: left over (${CAUSES[o.cause]})${o.workers ? `, ${o.workers} leftover worker process${o.workers === 1 ? "" : "es"}` : ""}; recovers automatically at the next start, or now with: cadence doctor --fix`;
    case "healed":
      return `${line.target}: recovered (${o.event.actions.map((a) => ACTIONS[a]).join(", ")})`;
    default:
      return `${line.target}: needs attention\n    ${describeBlock(o, line.target).trimEnd().replace(/\n/g, "\n    ")}`;
  }
}
/** `cadence doctor [--fix] [--yes]`: readonly by default. */
export async function doctor(o: DoctorOptions): Promise<unknown> {
  const stateHome = o.stateHome ?? defaultStateHome();
  const account = new ServiceCoordination(null, stateHome);
  const log = new RecoveryLog(account.files);
  const lines: Line[] = [];
  const decide = async (question: string) => o.yes || (await confirm(question));
  const options: HealOptions = { inspect: !o.fix };
  const registry = await new RegistryHealer(account).heal(options);
  lines.push({ target: "Project registry", outcome: registry });
  if (registry.status === "blocked" && o.fix) {
    if (
      await decide(
        "The project registry lock's holder cannot be observed. Take it over (only if no other Cadence is using this state)?",
      )
    )
      lines[0] = {
        target: "Project registry",
        outcome: await new RegistryHealer(account).heal({ takeOver: true }),
      };
  }
  const roots = new Set<string>();
  try {
    for (const row of account.registryView()?.value.entries ?? [])
      roots.add(row.root);
  } catch {
    /* reported through the registry line */
  }
  if (o.workspace) {
    try {
      roots.add(new ServiceCoordination(o.workspace, stateHome).store.root);
    } catch {
      if (!existsSync(o.workspace))
        lines.push({
          target: `Project ${o.workspace}`,
          outcome: { status: "clean" },
        });
    }
  }
  for (const root of roots) {
    // The account coordination reaches any project's state by its root,
    // including one whose directory was removed.
    const c = account;
    const missing = !existsSync(root);
    const responsive = () => o.probeProject(root, stateHome);
    let outcome = await healProjectAt(c, root, { ...options, responsive });
    if (o.fix && outcome.status === "blocked") {
      const question =
        outcome.reason === "owner-unresponsive"
          ? `Cadence for ${root} is running but not responding. Stop it and recover?`
          : outcome.reason === "workers-running"
            ? null
            : `The previous Cadence for ${root} cannot be observed from here. Take its state over (only if it is not running anywhere)?`;
      if (question && (await decide(question)))
        outcome = await healProjectAt(c, root, {
          responsive,
          stopUnresponsive: outcome.reason === "owner-unresponsive",
          takeOver: outcome.reason !== "owner-unresponsive",
        });
    }
    lines.push({
      target: `Project ${root}${missing ? " (directory no longer exists)" : ""}`,
      outcome,
    });
  }
  const config = o.serverConfig ?? serverConfigPath(homedir());
  const store = new GatewayStore(config, stateHome);
  if (store.files.directory(store.directory)) {
    const responsive = () => o.probeWorkbench(store);
    let outcome = await healWorkbench(store, { ...options, responsive });
    if (o.fix && outcome.status === "blocked") {
      const stop = outcome.reason === "owner-unresponsive";
      if (
        await decide(
          stop
            ? "The workbench is running but not responding. Stop it and recover?"
            : "The previous workbench cannot be observed from here. Take its state over?",
        )
      )
        outcome = await healWorkbench(store, {
          responsive,
          stopUnresponsive: stop,
          takeOver: !stop,
        });
    }
    lines.push({ target: "Workbench", outcome });
  }
  const recent = log.events(5);
  const usage = log.usage();
  process.stderr.write(
    `Cadence doctor${o.fix ? " --fix" : ""}\n${lines.map((l) => `  ${summary(l)}`).join("\n")}\n${
      recent.length
        ? `Recent automatic recoveries:\n${recent
            .map(
              (e) =>
                `  ${new Date(e.at).toLocaleString()}: ${describeEvent(e, log.archiveDirectory)}`,
            )
            .join("\n")}\n`
        : ""
    }${usage.entries ? `Archived damaged state: ${usage.entries} entr${usage.entries === 1 ? "y" : "ies"}, ${Math.ceil(usage.bytes / 1024)} KiB in ${log.archiveDirectory} (expires after 30 days).\n` : ""}`,
  );
  const needs = lines.some((l) => l.outcome.status === "blocked");
  if (needs) process.exitCode = 1;
  return {
    status: needs ? "attention" : "ok",
    checks: lines.map((l) => ({
      target: l.target,
      status: l.outcome.status,
      ...(l.outcome.status === "blocked"
        ? { reason: l.outcome.reason, pid: l.outcome.pid }
        : {}),
      ...(l.outcome.status === "reclaimable"
        ? { cause: l.outcome.cause, workers: l.outcome.workers }
        : {}),
    })),
    recent: recent.map((e) => ({
      at: e.at,
      scope: e.scope,
      path: e.path,
      cause: e.cause,
      actions: e.actions,
      workers: e.workers,
      archive: e.archive,
    })),
  };
}
/** Missing project directory: a clear refusal instead of an opaque one. */
export function missingWorkspace(workspace: string): string | null {
  if (existsSync(workspace)) return null;
  return `The project directory ${workspace} does not exist (moved or deleted).\nRecreate it, choose another project, or switch the background service to the workbench: cadence server install\nCadence releases whatever the old project owner left behind automatically.\n`;
}
export function assertNotMissing(workspace: string): void {
  if (!existsSync(workspace)) throw new ContractError("invalid");
}
