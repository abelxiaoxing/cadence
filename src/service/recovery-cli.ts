/** Native local management only. Never imported by HTTP or exposed as a route. */
import { isatty } from "node:tty";
import { HistoryRecovery } from "../history/recovery.ts";
import { ContractError, LIMITS } from "../service-contract.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import {
  type RegistryRecoveryInspection,
  ServiceCoordination,
} from "./coordination.ts";
import {
  inspectGatewayRecovery,
  resolveGatewayRecovery,
} from "./gateway-recovery.ts";
import type { GatewayStore } from "./gateway-store.ts";
import { inspectRecovery, resolveRecovery } from "./recovery.ts";

const warning =
  "PID absence is not proof that descendants stopped or credential writes settled. Inspect/stop old processes externally, independently inspect the selected Pi credential store and SDK locks, and inspect retained history/storage. Cadence does not kill, repair, reset, migrate or certify those resources. Unknown historical outcomes remain unknown. A new Start is required.";
function native(): void {
  if (!isatty(0) || !isatty(1) || !process.stdin.isTTY || !process.stdout.isTTY)
    throw new ContractError("forbidden");
}
async function confirm(expected: {
  epoch: string;
  scope?: "global-registry" | "workbench";
  legacyHost?: boolean;
}): Promise<() => void> {
  native();
  if (process.stdin.readableLength) throw new ContractError("forbidden");
  const identity = JSON.stringify(expected);
  const deadline = performance.now() + LIMITS.grantMs;
  const prompts = [
    ...(expected.legacyHost
      ? [
          [
            "Legacy registration has no host identity. Independently verify this state originated on THIS host and is not shared/copied from another host. Type local-host",
            "local-host",
          ],
        ]
      : []),
    [
      "Confirm old processes stopped externally; acknowledge escaped-descendant uncertainty. Type processes",
      "processes",
    ],
    [
      "Confirm independent credential/refresh/writeback inspection; PID absence does not settle auth. Type credentials",
      "credentials",
    ],
    [
      "Confirm independent storage inspection; preserve damaged bytes and unknown outcomes. Type storage",
      "storage",
    ],
    [
      `${expected.scope === "global-registry" ? "Release ONLY the global registry lock; all project fences remain." : expected.scope === "workbench" ? "Release ONLY the workbench fence and retire its old project associations; all project fences remain." : "Release ONLY the displayed unchanged service-owned fences."} Type resolve ${expected.epoch}`,
      `resolve ${expected.epoch}`,
    ],
  ];
  await new Promise<void>((resolve, reject) => {
    let index = 0,
      line = "",
      done = false;
    const raw = process.stdin.isRaw;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      process.stdin.removeListener("data", input);
      process.stdin.removeListener("end", fail);
      process.stdin.removeListener("error", fail);
      process.stdin.setRawMode(raw);
      process.stdin.pause();
      process.stdout.write("\x1b[?2004l\n");
      if (ok) resolve();
      else reject(new ContractError("forbidden"));
    };
    const fail = () => finish(false);
    const show = () => process.stdout.write(`${prompts[index]?.[0]}: `);
    const input = (chunk: Buffer) => {
      if (performance.now() >= deadline || chunk.length > 128) return fail();
      for (let n = 0; n < chunk.length; n++) {
        const byte = chunk[n];
        if (byte === 13 || byte === 10) {
          // A multiline paste/queued second answer cannot authorize another step.
          if (n !== chunk.length - 1 || line !== prompts[index]?.[1])
            return fail();
          line = "";
          process.stdout.write("\n");
          if (++index === prompts.length) return finish(true);
          show();
        } else if (byte === 127) {
          line = line.slice(0, -1);
        } else if (
          byte !== undefined &&
          byte >= 32 &&
          byte <= 126 &&
          line.length < 80
        ) {
          line += String.fromCharCode(byte);
        } else return fail(); // includes Escape/bracketed paste/Ctrl-C and invalid UTF-8
      }
    };
    const timer = setTimeout(fail, LIMITS.grantMs);
    process.stdin.setRawMode(true);
    process.stdout.write("\x1b[?2004h");
    process.stdin
      .on("data", input)
      .once("end", fail)
      .once("error", fail)
      .resume();
    show();
  });
  return () => {
    native();
    if (performance.now() >= deadline || JSON.stringify(expected) !== identity)
      throw new ContractError("stale");
  };
}
async function localRegistryRecovery(
  c: ServiceCoordination,
  operation: "inspect" | "resolve",
): Promise<unknown> {
  if (operation === "resolve") native(); // no filesystem writes on nonterminal invocation
  const registryLock = c.registryLockDiagnostic();
  if (registryLock) {
    let expected: RegistryRecoveryInspection;
    try {
      expected = c.inspectRegistryRecovery();
    } catch {
      const blocked = {
        scope: "global-registry",
        ...registryLock,
        coordination: "unavailable",
        resolution: "blocked-preserve-state",
        notice:
          "Registry state is incomplete, changed or unsafe. Preserve it; no lock or project resource was released.",
      };
      if (operation === "inspect") return blocked;
      process.stdout.write(`${JSON.stringify(blocked)}\n`);
      throw new ContractError("quarantine");
    }
    const view = {
      ...expected,
      process: {
        ...expected.process,
        host: diagnosticText(expected.process.host, 255),
      },
      notice: `Global registry lock blocks every project in this state home. Recovery preserves its original bytes and all project reservations, owner/checkout locks and history. Inspect project fences separately afterward. ${warning}`,
    };
    if (operation === "inspect") return view;
    process.stdout.write(`${JSON.stringify(view)}\n`);
    if (
      expected.owner !== "absent" ||
      (expected.previousResolver !== null &&
        expected.previousResolver !== "absent")
    )
      throw new ContractError("quarantine");
    const assertFresh = await confirm(expected);
    return c.resolveRegistryRecovery(expected, assertFresh);
  }
  return undefined;
}
export async function localRecovery(
  c: ServiceCoordination,
  operation: "inspect" | "resolve",
): Promise<unknown> {
  const registry = await localRegistryRecovery(c, operation);
  if (registry !== undefined) return registry;
  const history = new HistoryRecovery(c);
  const expected = await inspectRecovery(c, history);
  const registration = c.recoverySnapshot().registration;
  const view = {
    ...expected,
    process: {
      pid: registration.pid,
      host: diagnosticText(registration.host, 255),
    },
    notice: warning,
  };
  if (operation === "inspect") return view;
  process.stdout.write(`${JSON.stringify(view)}\n`);
  if (expected.owner !== "absent") throw new ContractError("quarantine");
  const assertFresh = await confirm(expected);
  return resolveRecovery(
    c,
    {
      expected,
      acknowledgeEscapedProcesses: true,
      processes: "externally-resolved",
      credentials: "independently-resolved",
      storage: "independently-resolved",
      assertLocalAuthority: (choice) => {
        assertFresh();
        if (JSON.stringify(choice) !== JSON.stringify(expected))
          throw new ContractError("stale");
      },
    },
    history,
  );
}

/** Unbound account/workbench management; cwd is never a selected project. */
export async function localGatewayRecovery(
  store: GatewayStore,
  operation: "inspect" | "resolve",
): Promise<unknown> {
  const registry = await localRegistryRecovery(
    new ServiceCoordination(null, store.stateHome),
    operation,
  );
  if (registry !== undefined) return registry;
  let expected: ReturnType<typeof inspectGatewayRecovery>;
  try {
    const observed = store.inspect();
    if (observed.status === "absent" || observed.status === "stopped") {
      if (operation === "resolve") throw new ContractError("unavailable");
      return { ...observed, scope: "workbench" };
    }
    expected = inspectGatewayRecovery(store);
  } catch (error) {
    if (operation === "resolve") throw error;
    return {
      status: "unavailable",
      scope: "workbench",
      resolution: "blocked-preserve-state",
      error: error instanceof ContractError ? error.code : "unavailable",
      notice:
        "Workbench state is incomplete, changed or unsafe. Preserve it; no resource was released.",
    };
  }
  const view = {
    ...expected,
    process: {
      ...expected.process,
      host:
        expected.process.host === null
          ? null
          : diagnosticText(expected.process.host, 255),
    },
    notice: `Recovery releases ONLY the workbench fence and retires its exact old project associations. Project references, reservations, owner/checkout locks, opening receipts and history remain unchanged. Explicit Open must associate a project again; recover affected project owners separately. ${warning}`,
  };
  if (operation === "inspect") return view;
  process.stdout.write(`${JSON.stringify(view)}\n`);
  if (
    (!expected.legacyHost && expected.owner !== "absent") ||
    expected.owner === "live" ||
    (expected.previousResolver !== null &&
      expected.previousResolver !== "absent")
  )
    throw new ContractError("quarantine");
  const authority = await confirm(expected);
  return resolveGatewayRecovery(
    store,
    expected,
    authority,
    expected.legacyHost,
  );
}
