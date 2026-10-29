/** Explicit local recovery of ONLY the workbench fence. Never releases project
 * reservations, replays openings, starts owners, signals processes or repairs data. */
import { opendirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  ContractError,
  closed,
  decodeHash,
  decodeId,
  integer,
  literal,
  text,
} from "./contracts/core.ts";
import { decodeProjectEntry } from "./contracts/gateway.ts";
import { recoveryOwnerStatus } from "./coordination.ts";
import { decodeGatewayInput, type GatewayStore } from "./gateway-store.ts";
import { encoded, type FileSnapshot, hash, json } from "./private-files.ts";

export interface GatewayRecoveryInspection {
  scope: "workbench";
  epoch: string;
  coordinationDigest: string;
  owner: "live" | "absent" | "ambiguous";
  process: { pid: number; host: string | null };
  legacyHost: boolean;
  previousResolver: "live" | "absent" | "ambiguous" | null;
  projects: number;
  openings: number;
  resolution: "local-interactive-only" | "local-host-confirmation-required";
}
type Resources = Map<string, FileSnapshot>;
function required(resources: Resources, name: string): FileSnapshot {
  const file = resources.get(name);
  if (!file) throw new ContractError("corrupt-selected");
  return file;
}
function names(store: GatewayStore, path: string, maximum: number): string[] {
  if (!store.files.directory(path)) return [];
  const stream = opendirSync(path),
    out: string[] = [];
  try {
    for (let row = stream.readSync(); row; row = stream.readSync()) {
      if (out.length >= maximum || (!row.isFile() && !row.isDirectory()))
        throw new ContractError("corrupt-selected");
      out.push(row.name);
    }
  } finally {
    stream.closeSync();
  }
  return out.sort();
}
function capture(store: GatewayStore): Resources {
  const out: Resources = new Map();
  const keep = (name: string) => {
    const file = store.files.read(store.path(name));
    if (!file) throw new ContractError("corrupt-selected");
    out.set(name, file);
  };
  for (const name of names(store, store.directory, 9)) {
    if (
      [
        "gateway.json",
        "gateway.lock",
        "input.json",
        "access-config.json",
        "access.json",
      ].includes(name)
    )
      keep(name);
    else if (name === "projects" || name === "commands") {
      for (const child of names(
        store,
        store.path(name),
        name === "projects" ? 128 : 2048,
      )) {
        if (
          name === "projects"
            ? !/^[a-f0-9]{64}\.json$/.test(child)
            : !/^[a-f0-9-]{36}(?:\.result)?\.json$/.test(child)
        )
          throw new ContractError("corrupt-selected");
        keep(`${name}/${child}`);
      }
    } else if (
      name !== "recovery-v1" ||
      !store.files.directory(store.path(name))
    )
      throw new ContractError("corrupt-selected");
  }
  for (const name of [
    "gateway.json",
    "input.json",
    "access-config.json",
    "access.json",
  ])
    if (!out.has(name)) throw new ContractError("corrupt-selected");
  for (const [name, file] of out) {
    if (!name.startsWith("commands/")) continue;
    if (name.endsWith(".result.json")) {
      if (!out.has(name.replace(".result.json", ".json")))
        throw new ContractError("corrupt-selected");
      decodeProjectEntry(json(file));
    } else {
      decodeId(name.slice("commands/".length, -5));
      const intent = closed(json(file), ["path", "epoch"]);
      text(intent.path, 4096, true);
      decodeId(intent.epoch);
    }
  }
  return out;
}
function signature(resources: Resources): string {
  return hash(
    encoded(
      [...resources]
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([name, file]) => [
          name,
          file.stamp,
          // No public secret-derived hashes (registration carries a native capability).
          ["gateway.json", "access.json", "access-config.json"].includes(name)
            ? null
            : file.identity,
        ]),
    ),
  );
}
function state(store: GatewayStore) {
  const registration = store.read();
  if (!registration) throw new ContractError("unavailable");
  const resources = capture(store),
    lock = resources.get("gateway.lock");
  if (!lock) throw new ContractError("unavailable");
  decodeId(closed(json(lock), ["epoch"]).epoch);
  const input = decodeGatewayInput(json(required(resources, "input.json")));
  if (
    input.serverConfig !== store.serverConfig ||
    input.stateHome !== store.stateHome
  )
    throw new ContractError("conflict");
  const projects = store.projects();
  store.associatedProjects(); // Validate any earlier pinned recovery evidence.
  const incarnation = hash(encoded([lock.identity, lock.stamp]));
  // acquire creates its fence before publishing the successor registration.
  // A stopped predecessor's PID says nothing about that new lock's holder.
  // Only our exact durable partial-release bridge can justify a stopped row.
  if (
    registration.phase === "stopped" &&
    !registration.recovery?.receipt.startsWith(`recovery-v1/${incarnation}/`)
  )
    throw new ContractError("corrupt-selected");
  const archive = store.path(`recovery-v1/${incarnation}`);
  const attempts: FileSnapshot[] = [];
  let previousResolver: GatewayRecoveryInspection["previousResolver"] = null;
  const entries = names(store, archive, 128);
  for (let n = 0; n < entries.length; n++) {
    if (!entries.includes(`${n}.json`))
      throw new ContractError("corrupt-selected");
    const file = store.files.read(join(archive, `${n}.json`), 65536);
    if (!file) throw new ContractError("corrupt-selected");
    const row = closed(json(file, 65536), [
      "schema",
      "lock",
      "epoch",
      "digest",
      "pid",
      "host",
      "legacyHost",
      "retiredProjects",
    ]);
    literal(row.schema, "cadence-workbench-recovery/1");
    literal(row.lock, lock.bytes.toString("utf8"));
    literal(row.epoch, registration.epoch);
    decodeHash(row.digest);
    if (!Array.isArray(row.retiredProjects) || row.retiredProjects.length > 128)
      throw new ContractError("corrupt-selected");
    for (const entry of row.retiredProjects) {
      const project = closed(entry, ["id", "stamp"]);
      decodeHash(project.id);
      text(project.stamp, 512, true);
    }
    if (typeof row.legacyHost !== "boolean")
      throw new ContractError("corrupt-selected");
    previousResolver = recoveryOwnerStatus(
      integer(row.pid, 1, 2147483647),
      text(row.host, 255, true),
    );
    attempts.push(file);
  }
  if (encoded(store.read()) !== encoded(registration))
    throw new ContractError("conflict");
  for (const [name, file] of resources)
    store.files.assert(store.path(name), file);
  const localOwner = recoveryOwnerStatus(
    registration.pid,
    registration.host ?? hostname(),
  );
  const inspection: GatewayRecoveryInspection = {
    scope: "workbench",
    epoch: registration.epoch,
    coordinationDigest: hash(
      encoded([
        signature(resources),
        attempts.map((a) => [a.identity, a.stamp]),
      ]),
    ),
    owner: registration.host
      ? localOwner
      : localOwner === "live"
        ? "live"
        : "ambiguous",
    process: { pid: registration.pid, host: registration.host ?? null },
    legacyHost: !registration.host,
    previousResolver,
    projects: projects.length,
    openings: [...resources.keys()].filter(
      (name) => name.startsWith("commands/") && !name.endsWith(".result.json"),
    ).length,
    resolution: registration.host
      ? "local-interactive-only"
      : "local-host-confirmation-required",
  };
  return {
    registration,
    resources,
    lock,
    archive,
    incarnation,
    attempts,
    localOwner,
    inspection,
  };
}
export function inspectGatewayRecovery(
  store: GatewayStore,
): GatewayRecoveryInspection {
  const before = state(store),
    after = state(store);
  if (encoded(before.inspection) !== encoded(after.inspection))
    throw new ContractError("conflict");
  return before.inspection;
}
export function resolveGatewayRecovery(
  store: GatewayStore,
  expected: GatewayRecoveryInspection,
  assertAuthority: () => void,
  legacyHostConfirmed = false,
) {
  assertAuthority();
  const selected = state(store);
  if (encoded(selected.inspection) !== encoded(expected))
    throw new ContractError("conflict");
  const absent = () => {
    assertAuthority();
    if (
      (expected.legacyHost && !legacyHostConfirmed) ||
      recoveryOwnerStatus(
        selected.registration.pid,
        selected.registration.host ?? hostname(),
      ) !== "absent"
    )
      throw new ContractError("quarantine");
  };
  absent();
  if (
    expected.previousResolver !== null &&
    expected.previousResolver !== "absent"
  )
    throw new ContractError("quarantine");
  if (selected.attempts.length >= 128) throw new ContractError("capacity");
  const receiptPath = join(
    selected.archive,
    `${selected.attempts.length}.json`,
  );
  const receipt = store.files.create(
    receiptPath,
    encoded({
      schema: "cadence-workbench-recovery/1",
      lock: selected.lock.bytes.toString("utf8"),
      epoch: expected.epoch,
      digest: expected.coordinationDigest,
      pid: process.pid,
      host: hostname(),
      legacyHost: expected.legacyHost,
      retiredProjects: [...selected.resources]
        .filter(([name]) => name.startsWith("projects/"))
        .map(([name, file]) => ({
          id: name.slice("projects/".length, -5),
          stamp: file.stamp,
        })),
    }),
    65536,
  );
  // Exclusive immutable receipt is flushed/closed before either release effect.
  const assert = () => {
    absent();
    store.associatedProjects();
    const current = capture(store);
    if (signature(current) !== signature(selected.resources))
      throw new ContractError("conflict");
    for (const [name, file] of selected.resources)
      store.files.assert(store.path(name), file);
    if (
      names(store, selected.archive, 128).length !==
      selected.attempts.length + 1
    )
      throw new ContractError("conflict");
    for (const [n, file] of selected.attempts.entries())
      store.files.assert(join(selected.archive, `${n}.json`), file, 65536);
    store.files.assert(receiptPath, receipt, 65536);
  };
  assert();
  const registration = store.files.replace(
    store.path("gateway.json"),
    required(selected.resources, "gateway.json"),
    encoded({
      ...selected.registration,
      phase: "stopped",
      recovery: {
        receipt: `recovery-v1/${selected.incarnation}/${selected.attempts.length}.json`,
        sha256: receipt.identity,
        stamp: receipt.stamp,
      },
    }),
  );
  selected.resources.set("gateway.json", registration);
  assert();
  store.files.remove(store.path("gateway.lock"), selected.lock);
  return {
    status: "resolved",
    scope: "workbench",
    epoch: expected.epoch,
    notice: "operator-acknowledgment-only-project-fences-preserved",
  } as const;
}
