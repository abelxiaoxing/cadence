/** Startup self-healing. A Cadence process that ended without its orderly Stop
 * (power loss, shutdown, crash, kill) leaves its locks and registration behind.
 * Whatever this module can prove dead is reclaimed automatically, leftover
 * worker processes of a dead owner are stopped, and damaged private files are
 * archived before a clean start. Only a live holder, a holder on another host
 * or a running but unresponsive owner is left for the user to decide. */
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, opendirSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  ContractError,
  closed,
  decodeId,
  integer,
  text,
} from "./contracts/core.ts";
import {
  decodeOwnerConfig,
  decodeRegistration,
  decodeRegistryLock,
  markedKeys,
  type Registration,
  type ServiceCoordination,
} from "./coordination.ts";
import type { GatewayStore } from "./gateway-store.ts";
import {
  decodeMarkFields,
  type Holder,
  holderState,
  type ProcessMark,
  stampTime,
  stopProcessGroup,
} from "./liveness.ts";
import { encoded, type FileSnapshot, json } from "./private-files.ts";
import { ProcessLedger } from "./process-ledger.ts";
import {
  type RecoveryEvent,
  RecoveryLog,
  strayTemporaries,
} from "./recovery-log.ts";
import { recoverDeliveryResources } from "./repository-coordination.ts";

export type HealBlock =
  /** The recorded holder runs on another host (shared or copied state). */
  | "foreign-host"
  /** The owner process is running but does not answer. */
  | "owner-unresponsive"
  /** A PID exists that can neither be identified nor shown absent. */
  | "holder-unknown"
  /** Leftover worker processes did not stop. */
  | "workers-running";
export type HealOutcome =
  | { status: "clean" }
  | { status: "live" }
  | { status: "healed"; event: RecoveryEvent }
  | { status: "blocked"; reason: HealBlock; pid: number | null }
  /** Readonly inspection: what a heal would do. */
  | { status: "reclaimable"; cause: RecoveryEvent["cause"]; workers: number };
export interface HealOptions {
  /** Readonly inspection: classify only. */
  inspect?: boolean;
  /** Answers true when the recorded owner replies on its authenticated route. */
  responsive?: () => Promise<boolean>;
  /** Stop a running owner that does not answer, when it is provably Cadence's. */
  stopUnresponsive?: boolean;
  /** The user confirmed that a holder Cadence cannot observe (another host,
   * or an unidentifiable PID) is gone: reclaim without touching processes. */
  takeOver?: boolean;
}

interface Read<T> {
  path: string;
  snapshot: FileSnapshot;
  /** Null when the bytes cannot be decoded. */
  value: T | null;
}
function attempt<T>(read: () => T): T | null {
  try {
    return read();
  } catch {
    return null;
  }
}
function readFile<T>(
  files: ServiceCoordination["files"],
  path: string,
  decode: (value: unknown) => T,
  maximum?: number,
): Read<T> | undefined | "unreadable" {
  let snapshot: FileSnapshot | undefined;
  try {
    snapshot = files.read(path, maximum);
  } catch {
    return "unreadable";
  }
  if (!snapshot) return undefined;
  const bytes = snapshot;
  return {
    path,
    snapshot: bytes,
    value: attempt(() => decode(json(bytes, maximum))),
  };
}
interface LockValue extends ProcessMark {
  epoch: string | null;
}
function decodeOwnerLock(value: unknown): LockValue {
  const o = closed(
    value,
    markedKeys(value, ["schema", "epoch", "token", "pid", "host"]),
  );
  if (o.schema !== "cadence-service-owner-lock/1")
    throw new ContractError("corrupt-selected");
  return {
    epoch: decodeId(o.epoch),
    pid: integer(o.pid, 1, 2147483647),
    host: text(o.host, 255, true),
    ...decodeMarkFields(o),
  };
}
function decodeCheckoutLock(value: unknown): LockValue {
  if (!value || typeof value !== "object")
    throw new ContractError("corrupt-selected");
  const o = value as Record<string, unknown>;
  if (o.schema !== "cadence-assistant-lock/1")
    throw new ContractError("corrupt-selected");
  return {
    epoch: null,
    pid: integer(o.pid, 1, 2147483647),
    host: text(o.host, 255, true),
    ...decodeMarkFields(o),
  };
}
function decodeRegistrationLenient(value: unknown): Registration {
  const o = value as Registration;
  if (
    o?.schema !== "cadence-service-registration/1" ||
    !["idle", "stopping", "quarantined", "stopped"].includes(o.phase)
  )
    throw new ContractError("corrupt-selected");
  integer(o.pid, 1, 2147483647);
  text(o.host, 255, true);
  decodeId(o.epoch);
  return o;
}
/** Combine every recorded holder: all must be dead to reclaim. */
function combine(holders: Holder[]): Holder & { worst: Holder["state"] } {
  const order: Holder["state"][] = ["foreign", "unknown", "live", "dead"];
  const worst =
    order.find((state) => holders.some((h) => h.state === state)) ?? "dead";
  return {
    state: worst,
    worst,
    reboot: holders.length > 0 && holders.every((h) => h.reboot),
  };
}
async function stopWorkers(
  ledger: ProcessLedger,
  epoch: string | null,
  reboot: boolean,
  inspect: boolean,
): Promise<{ stopped: number; running: number }> {
  if (!epoch || reboot) return { stopped: 0, running: 0 };
  let stopped = 0,
    running = 0;
  for (const worker of ledger.read(epoch)) {
    const holder = holderState({ ...worker, host: hostname() });
    if (holder.state === "dead") continue;
    // Unknown identity is not evidence of absence. Only a live PID whose start
    // identity matches the ledger is ours to stop; everything else stays fenced.
    if (holder.state !== "live" || !worker.started) {
      running++;
      continue;
    }
    if (inspect) {
      stopped++;
      continue;
    }
    if (await stopProcessGroup(worker.pid)) stopped++;
    else running++;
  }
  return { stopped, running };
}
async function stopOwnerProcess(pid: number): Promise<boolean> {
  if (pid === process.pid) return false;
  const gone = () => {
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (
        error instanceof Error && "code" in error && error.code === "ESRCH"
      );
    }
  };
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    return gone();
  }
  for (let n = 0; n < 50; n++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (gone()) return true;
  }
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    /* gone */
  }
  for (let n = 0; n < 20; n++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (gone()) return true;
  }
  return false;
}

/** The account registry: its short lock and its reservations. */
export class RegistryHealer {
  readonly log: RecoveryLog;
  readonly ledger: ProcessLedger;
  constructor(readonly c: ServiceCoordination) {
    this.log = new RecoveryLog(c.files);
    this.ledger = new ProcessLedger(c.files);
  }
  private path(name: string): string {
    return join(this.c.registryDirectory, name);
  }
  /** A registry lock whose holder is dead is released; a damaged registry is
   * archived and rebuilt from the live owners' own registrations. */
  async heal(options: HealOptions = {}): Promise<HealOutcome> {
    const lockPath = this.path("registry.lock");
    let lock: FileSnapshot | undefined;
    try {
      lock = this.c.files.read(lockPath);
    } catch {
      // An unsafe or unreadable lock file names no holder; one left alone for
      // a minute is set aside like a torn one (inspection changes nothing).
      lock = undefined;
      const age = (() => {
        try {
          return Date.now() - lstatSync(lockPath).mtimeMs;
        } catch {
          return 0;
        }
      })();
      if (age > 60_000) {
        if (options.inspect)
          return { status: "reclaimable", cause: "storage", workers: 0 };
        const archive = this.log.archive();
        archive.keep(lockPath);
        return {
          status: "healed",
          event: this.log.record({
            scope: "registry",
            path: null,
            cause: "storage",
            actions: ["released-locks"],
            workers: 0,
            archive: archive.name,
          }),
        };
      }
    }
    const actions = new Set<RecoveryEvent["actions"][number]>();
    let cause: RecoveryEvent["cause"] = "storage";
    let archive: ReturnType<RecoveryLog["archive"]> | undefined;
    if (lock) {
      const mark = attempt(() => decodeRegistryLock(lock));
      const writtenAt = stampTime(lock.stamp) ?? Date.now();
      let holder: Holder;
      if (mark) holder = holderState(mark, writtenAt);
      // A torn lock: its writer died while creating it (registry operations
      // are short and synchronous), unless it is younger than a minute.
      else
        holder = {
          state: Date.now() - writtenAt > 60_000 ? "dead" : "unknown",
          reboot: false,
        };
      if (holder.state === "foreign" && !options.takeOver)
        return {
          status: "blocked",
          reason: "foreign-host",
          pid: mark?.pid ?? null,
        };
      if (holder.state === "live") {
        // A live holder finishes within milliseconds; give it a moment.
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (!this.c.files.read(lockPath)) return { status: "clean" };
        return { status: "live" };
      }
      if (holder.state === "unknown" && !options.takeOver)
        return {
          status: "blocked",
          reason: "holder-unknown",
          pid: mark?.pid ?? null,
        };
      cause = holder.reboot ? "reboot" : "crash";
      if (options.inspect) return { status: "reclaimable", cause, workers: 0 };
      this.c.files.remove(lockPath, lock);
      actions.add("released-locks");
    }
    if (options.inspect) {
      if (!this.valid()) return { status: "reclaimable", cause, workers: 0 };
      return { status: "clean" };
    }
    const temporaries = strayTemporaries(this.c.registryDirectory);
    if (temporaries.length) {
      archive ??= this.log.archive();
      for (const path of temporaries) archive.keep(path);
      actions.add("removed-temporaries");
    }
    if (!this.valid()) {
      archive ??= this.log.archive();
      this.rebuild(archive);
      actions.add("rebuilt-registry");
    }
    if (!actions.size) return { status: "clean" };
    return {
      status: "healed",
      event: this.log.record({
        scope: "registry",
        path: null,
        cause,
        actions: [...actions],
        workers: 0,
        archive: archive?.used() ? archive.name : null,
      }),
    };
  }
  private valid(): boolean {
    try {
      // Not yet initialized (a crash right after creating the lock) is fine:
      // the next registry operation initializes it.
      if (
        !this.c.files.read(this.path("format.json")) &&
        !this.c.files.read(this.path("roots.json"), 1024 * 1024)
      )
        return true;
      this.c.registryView();
      return true;
    } catch {
      return false;
    }
  }
  /** Rebuild roots.json from the namespace's own registrations of live owners. */
  private rebuild(archive: ReturnType<RecoveryLog["archive"]>): void {
    const lockPath = this.path("registry.lock");
    const lock = this.c.files.create(
      lockPath,
      encoded({
        schema: "cadence-service-registry-lock/1",
        token: randomUUID(),
        pid: process.pid,
        host: hostname(),
      }),
    );
    try {
      for (const name of ["format.json", "roots.json"]) {
        try {
          if (this.c.files.read(this.path(name), 1024 * 1024))
            archive.keep(this.path(name));
        } catch {
          archive.keep(this.path(name));
        }
      }
      const entries: unknown[] = [];
      for (const row of liveReservations(this.c)) entries.push(row);
      this.c.files.create(
        this.path("format.json"),
        encoded({
          schema: "cadence-service-registry-format/1",
          stateHome: this.c.stateHome,
        }),
      );
      this.c.files.create(
        this.path("roots.json"),
        encoded({ schema: "cadence-service-registry/1", entries }),
        1024 * 1024,
      );
    } finally {
      this.c.files.remove(lockPath, lock);
    }
  }
  /** Every registry reservation whose owner is provably dead is released. */
  async sweep(options: HealOptions = {}): Promise<HealOutcome[]> {
    let rows: { root: string }[];
    try {
      rows = this.c.registryView()?.value.entries ?? [];
    } catch {
      return [];
    }
    const out: HealOutcome[] = [];
    for (const row of rows)
      out.push(
        await healProjectAt(this.c, row.root, {
          ...options,
          responsive: undefined,
        }),
      );
    return out;
  }
}
/** Reservations rebuilt from registrations whose owner is alive. */
function liveReservations(c: ServiceCoordination): unknown[] {
  const out: unknown[] = [];
  const dir = opendirSync(c.files.namespace);
  try {
    for (let e = dir.readSync(); e; e = dir.readSync()) {
      if (!/^[a-f0-9]{64}$/.test(e.name)) continue;
      const service = join(c.files.namespace, e.name, "service-v1");
      const registration = readFile(
        c.files,
        join(service, "registration.json"),
        decodeRegistrationLenient,
      );
      if (!registration || registration === "unreadable") continue;
      const r = registration.value;
      if (!r || r.phase === "stopped") continue;
      const owner = readFile(
        c.files,
        join(service, "owner.lock"),
        decodeOwnerLock,
      );
      const mark =
        owner && owner !== "unreadable" && owner.value ? owner.value : r;
      if (
        holderState(mark, stampTime(registration.snapshot.stamp)).state !==
        "live"
      )
        continue;
      out.push({
        root: r.root,
        stateHome: r.stateHome,
        configIdentity: r.configIdentity,
        endpoint: r.endpoint,
        epoch: r.epoch,
        pid: r.pid,
        host: r.host,
        ownerToken: r.ownerToken,
      });
    }
  } finally {
    dir.closeSync();
  }
  return out;
}

interface ProjectFiles {
  root: string;
  privateRoot: string;
  service: string;
  checkoutPath: string;
}
function projectFiles(c: ServiceCoordination, root: string): ProjectFiles {
  const privateRoot = join(
    c.files.namespace,
    createHash("sha256").update(root).digest("hex"),
  );
  return {
    root,
    privateRoot,
    service: join(privateRoot, "service-v1"),
    checkoutPath: join(privateRoot, "checkout.lock"),
  };
}
interface ProjectSnapshot {
  registration?: Read<Registration> | "unreadable";
  owner?: Read<LockValue> | "unreadable";
  capability?: FileSnapshot | "unreadable";
  checkout?: Read<LockValue> | "unreadable";
  row?: ProcessMark & { root: string; epoch: string };
  rowWrittenAt?: number;
  temporaries: string[];
}
function snapshotProject(
  c: ServiceCoordination,
  p: ProjectFiles,
): ProjectSnapshot {
  const s: ProjectSnapshot = { temporaries: [] };
  s.registration = readFile(
    c.files,
    join(p.service, "registration.json"),
    decodeRegistrationLenient,
  );
  s.owner = readFile(c.files, join(p.service, "owner.lock"), decodeOwnerLock);
  try {
    s.capability = c.files.read(join(p.service, "local-capability.json"));
  } catch {
    s.capability = "unreadable";
  }
  s.checkout = readFile(c.files, p.checkoutPath, decodeCheckoutLock, 8192);
  try {
    const view = c.registryView();
    const row = view?.value.entries.find((r) => r.root === p.root);
    if (row) {
      s.row = row as unknown as ProjectSnapshot["row"];
      s.rowWrittenAt = stampTime(view?.snapshot.stamp ?? "");
    }
  } catch {
    /* the registry heal runs first; a damaged one has no rows to trust */
  }
  s.temporaries = [
    ...strayTemporaries(p.service),
    ...strayTemporaries(join(p.service, "history-v2")),
  ];
  return s;
}
function active(s: ProjectSnapshot): boolean {
  const registration =
    s.registration && s.registration !== "unreadable"
      ? s.registration.value
      : null;
  return !!(
    s.row ||
    s.owner ||
    s.checkout ||
    s.capability ||
    s.registration === "unreadable" ||
    (s.registration && registration?.phase !== "stopped")
  );
}
function holders(s: ProjectSnapshot): {
  holder: Holder;
  epoch: string | null;
  pid: number | null;
} {
  const found: Holder[] = [];
  let epoch: string | null = null,
    pid: number | null = null;
  const consider = (mark: ProcessMark | null | undefined, at?: number) => {
    if (!mark) return;
    pid ??= mark.pid;
    found.push(holderState(mark, at));
  };
  if (s.owner && s.owner !== "unreadable" && s.owner.value) {
    epoch = s.owner.value.epoch;
    consider(s.owner.value, stampTime(s.owner.snapshot.stamp));
  }
  if (
    s.registration &&
    s.registration !== "unreadable" &&
    s.registration.value
  ) {
    const r = s.registration.value;
    if (r.phase !== "stopped") {
      epoch ??= r.epoch;
      consider(r, stampTime(s.registration.snapshot.stamp));
    }
  }
  if (s.row) {
    epoch ??= s.row.epoch;
    consider(s.row, s.rowWrittenAt);
  }
  if (s.checkout && s.checkout !== "unreadable" && s.checkout.value)
    consider(s.checkout.value, stampTime(s.checkout.snapshot.stamp));
  // Files that exist but cannot be decoded name no holder. If no decodable
  // resource names one, nothing can still be using them.
  return { holder: combine(found), epoch, pid };
}

/** Heal one project's ownership, by its canonical root (which may be missing). */
export async function healProjectAt(
  c: ServiceCoordination,
  root: string,
  options: HealOptions = {},
): Promise<HealOutcome> {
  const p = projectFiles(c, root);
  const log = new RecoveryLog(c.files),
    ledger = new ProcessLedger(c.files);
  let s = snapshotProject(c, p);
  // A project nobody owns keeps whatever selection it has: only state a dead
  // owner left half-written (or interrupted temporaries) is set aside.
  if (!active(s) && !s.temporaries.length) return { status: "clean" };
  let { holder, epoch, pid } = holders(s);
  let stoppedOwner = false;
  const takenOver =
    !!options.takeOver &&
    (holder.state === "foreign" || holder.state === "unknown");
  if (active(s) && !takenOver) {
    if (holder.state === "foreign")
      return { status: "blocked", reason: "foreign-host", pid };
    if (holder.state === "unknown")
      // A process that answers as this owner is it, whatever its PID says.
      return options.responsive && (await options.responsive())
        ? { status: "live" }
        : { status: "blocked", reason: "holder-unknown", pid };
    if (holder.state === "live") {
      if (!options.responsive || (await options.responsive()))
        return { status: "live" };
      // Running but silent. Only a process whose start identity matches the
      // owner lock is provably ours to stop, and only when asked to.
      const mark = s.owner && s.owner !== "unreadable" ? s.owner.value : null;
      const ours = !!mark?.started;
      if (!options.stopUnresponsive || !ours || options.inspect || pid === null)
        return { status: "blocked", reason: "owner-unresponsive", pid };
      if (!(await stopOwnerProcess(pid)))
        return { status: "blocked", reason: "owner-unresponsive", pid };
      stoppedOwner = true;
      s = snapshotProject(c, p);
      ({ holder, epoch, pid } = holders(s));
      if (holder.state !== "dead")
        return { status: "blocked", reason: "owner-unresponsive", pid };
    }
  }
  const workers = takenOver
    ? { stopped: 0, running: 0 }
    : await stopWorkers(ledger, epoch, holder.reboot, !!options.inspect);
  if (workers.running)
    return { status: "blocked", reason: "workers-running", pid };
  const selectedOwner = [
    s.owner && s.owner !== "unreadable" ? s.owner.value : null,
    s.registration && s.registration !== "unreadable"
      ? s.registration.value
      : null,
    s.row,
  ].find((value) => value?.epoch === epoch);
  const expectedOwner = selectedOwner
    ? {
        pid: selectedOwner.pid,
        host: selectedOwner.host,
        ...("boot" in selectedOwner
          ? { boot: selectedOwner.boot ?? null }
          : {}),
        ...("started" in selectedOwner
          ? { started: selectedOwner.started ?? null }
          : {}),
      }
    : undefined;
  if (epoch) {
    try {
      recoverDeliveryResources(c.files, root, epoch, {
        inspect: true,
        takeOver: options.takeOver,
        expectedOwner,
      });
    } catch {
      return { status: "blocked", reason: "holder-unknown", pid };
    }
  }
  const restarted = epoch ? ledger.restartRequested(epoch) : false;
  const cause: RecoveryEvent["cause"] = !active(s)
    ? "storage"
    : holder.reboot
      ? "reboot"
      : restarted
        ? "restart"
        : "crash";
  if (options.inspect)
    return { status: "reclaimable", cause, workers: workers.stopped };
  const actions = new Set<RecoveryEvent["actions"][number]>();
  if (stoppedOwner) actions.add("stopped-owner");
  if (workers.stopped) actions.add("stopped-workers");
  const archive = log.archive();
  if (
    epoch &&
    recoverDeliveryResources(c.files, root, epoch, {
      takeOver: options.takeOver,
      expectedOwner,
      archive: (path) => archive.keep(path),
    })
  )
    actions.add("released-locks");
  if (active(s)) {
    reclaim(c, p, s, archive);
    actions.add("released-locks");
  }
  // Interrupted atomic replacements never became state.
  for (const path of snapshotProject(c, p).temporaries) {
    archive.keep(path);
    actions.add("removed-temporaries");
  }
  // Metadata a crash left half-written cannot be completed; keep it aside so
  // the next start initializes this project afresh. Only a dead owner's.
  if (active(s) && metadataDamaged(c, p)) {
    archive.keep(p.service, "service-v1");
    actions.add("archived-state");
  }
  if (epoch) ledger.remove(epoch);
  return {
    status: "healed",
    event: log.record({
      scope: "project",
      path: root,
      cause: actions.has("archived-state") && !active(s) ? "storage" : cause,
      actions: [...actions],
      workers: workers.stopped,
      archive: archive.used() ? archive.name : null,
    }),
  };
}
/** Selection metadata a crash left half-written (or otherwise undecodable).
 * Unknown extra entries are not damage: a newer release may have added them. */
function metadataDamaged(c: ServiceCoordination, p: ProjectFiles): boolean {
  try {
    if (!c.files.directory(p.service)) return false;
  } catch {
    return false;
  }
  try {
    const format = c.files.read(join(p.service, "format.json"));
    const config = c.files.read(join(p.service, "config.json"));
    if (!format || !config) return true;
    const f = closed(json(format), [
      "schema",
      "root",
      "stateHome",
      "configIdentity",
    ]);
    if (
      f.schema !== "cadence-service-format/1" ||
      f.root !== p.root ||
      f.stateHome !== c.stateHome ||
      f.configIdentity !== config.identity
    )
      return true;
    const selected = decodeOwnerConfig(json(config));
    const host = c.files.read(join(p.service, "host-config.json"));
    if (host && host.identity !== selected.policyIdentity) return true;
    const registration = c.files.read(join(p.service, "registration.json"));
    if (registration) {
      const r = decodeRegistration(json(registration));
      if (
        r.root !== p.root ||
        r.stateHome !== c.stateHome ||
        r.configIdentity !== config.identity
      )
        return true;
    }
    return false;
  } catch {
    return true;
  }
}
/** Release a proven-dead owner's fences in the same order an orderly release
 * uses: registration, reservation, capability, owner lock, checkout lock. */
function reclaim(
  c: ServiceCoordination,
  p: ProjectFiles,
  expected: ProjectSnapshot,
  archive: ReturnType<RecoveryLog["archive"]>,
): void {
  c.mutateRegistry((view, mutate) => {
    const s = snapshotProject(c, p);
    const same = (
      a: { snapshot: FileSnapshot } | FileSnapshot | "unreadable" | undefined,
      b: typeof a,
    ) => {
      const id = (x: typeof a) =>
        x === undefined
          ? "absent"
          : x === "unreadable"
            ? "unreadable"
            : "snapshot" in x
              ? `${x.snapshot.identity}:${x.snapshot.stamp}`
              : `${x.identity}:${x.stamp}`;
      return id(a) === id(b);
    };
    if (
      !same(s.registration, expected.registration) ||
      !same(s.owner, expected.owner) ||
      !same(s.capability, expected.capability) ||
      !same(s.checkout, expected.checkout) ||
      encoded(s.row ?? null) !== encoded(expected.row ?? null)
    )
      throw new ContractError("conflict");
    mutate();
    const registration = s.registration;
    if (registration === "unreadable")
      archive.keep(join(p.service, "registration.json"));
    else if (registration) {
      if (!registration.value) archive.keep(registration.path);
      else if (registration.value.phase !== "stopped")
        c.files.replace(
          registration.path,
          registration.snapshot,
          encoded({ ...registration.value, phase: "stopped" }),
        );
    }
    if (s.row)
      c.files.replace(
        join(c.registryDirectory, "roots.json"),
        view.snapshot,
        encoded({
          ...view.value,
          entries: view.value.entries.filter((row) => row.root !== p.root),
        }),
        1024 * 1024,
      );
    const drop = (
      path: string,
      value:
        | { snapshot: FileSnapshot }
        | FileSnapshot
        | "unreadable"
        | undefined,
      maximum?: number,
    ) => {
      if (value === undefined) return;
      if (value === "unreadable") {
        archive.keep(path);
        return;
      }
      c.files.remove(
        path,
        "snapshot" in value ? value.snapshot : value,
        maximum,
      );
    };
    drop(join(p.service, "local-capability.json"), s.capability);
    drop(join(p.service, "owner.lock"), s.owner);
    drop(p.checkoutPath, s.checkout, 8192);
  });
}

/** Heal the selected project before its owner starts, the short registry
 * lock first (a crash inside a registry operation leaves both). */
export async function healProject(
  c: ServiceCoordination,
  options: HealOptions = {},
): Promise<HealOutcome> {
  const registry = await new RegistryHealer(c).heal({
    inspect: options.inspect,
  });
  if (registry.status === "blocked") return registry;
  return healProjectAt(c, c.store.root, options);
}

/** Heal the unified workbench's own registration and lock. */
export async function healWorkbench(
  store: GatewayStore,
  options: HealOptions = {},
): Promise<HealOutcome> {
  const log = new RecoveryLog(store.files);
  const lockPath = store.path("gateway.lock"),
    registrationPath = store.path("gateway.json");
  if (!store.files.directory(store.directory)) return { status: "clean" };
  const lock = readFile(store.files, lockPath, decodeGatewayLock);
  const registration = readFile(
    store.files,
    registrationPath,
    decodeGatewayRegistration,
  );
  const temporaries = [
    ...strayTemporaries(store.directory),
    ...strayTemporaries(store.path("projects")),
  ];
  const value =
    registration && registration !== "unreadable" ? registration.value : null;
  const activeNow = !!(
    lock ||
    registration === "unreadable" ||
    (registration && value?.phase !== "stopped")
  );
  let input: unknown = null;
  try {
    input = store.read();
  } catch {
    input = null;
  }
  // A registration without a readable selection, or a lock without any
  // registration (a crash inside the first start), cannot be completed.
  const damaged = !input && !!(registration || lock);
  if (!activeNow && !temporaries.length && !damaged) return { status: "clean" };
  const found: Holder[] = [];
  let pid: number | null = null;
  if (lock && lock !== "unreadable" && lock.value?.pid) {
    pid = lock.value.pid;
    found.push(
      holderState(lock.value as ProcessMark, stampTime(lock.snapshot.stamp)),
    );
  }
  if (value && value.phase !== "stopped") {
    pid ??= value.pid;
    found.push(
      holderState(
        { pid: value.pid, host: value.host ?? hostname() },
        registration && registration !== "unreadable"
          ? stampTime(registration.snapshot.stamp)
          : undefined,
      ),
    );
  }
  // Older locks name no process: only a lock left alone for a minute (its
  // writer publishes the registration immediately) counts as abandoned.
  if (!found.length && lock && lock !== "unreadable")
    found.push({
      state:
        Date.now() - (stampTime(lock.snapshot.stamp) ?? Date.now()) > 60_000
          ? "dead"
          : "unknown",
      reboot: false,
    });
  const holder = combine(found);
  const takenOver =
    !!options.takeOver &&
    (holder.state === "foreign" || holder.state === "unknown");
  if (activeNow && !takenOver) {
    if (holder.state === "foreign")
      return { status: "blocked", reason: "foreign-host", pid };
    if (holder.state === "unknown")
      return options.responsive && (await options.responsive())
        ? { status: "live" }
        : { status: "blocked", reason: "holder-unknown", pid };
    if (holder.state === "live") {
      if (!options.responsive || (await options.responsive()))
        return { status: "live" };
      const ours = !!(lock && lock !== "unreadable" && lock.value?.started);
      if (!options.stopUnresponsive || !ours || options.inspect || pid === null)
        return { status: "blocked", reason: "owner-unresponsive", pid };
      if (!(await stopOwnerProcess(pid)))
        return { status: "blocked", reason: "owner-unresponsive", pid };
      return healWorkbench(store, { ...options, stopUnresponsive: false });
    }
  }
  const cause: RecoveryEvent["cause"] =
    !activeNow || damaged ? "storage" : holder.reboot ? "reboot" : "crash";
  const ledger = new ProcessLedger(store.files);
  const epoch = value?.epoch ?? null;
  const workers = takenOver
    ? { stopped: 0, running: 0 }
    : await stopWorkers(ledger, epoch, holder.reboot, !!options.inspect);
  if (workers.running)
    return { status: "blocked", reason: "workers-running", pid };
  if (options.inspect)
    return { status: "reclaimable", cause, workers: workers.stopped };
  const actions = new Set<RecoveryEvent["actions"][number]>();
  if (workers.stopped) actions.add("stopped-workers");
  const archive = log.archive();
  for (const path of temporaries) {
    archive.keep(path);
    actions.add("removed-temporaries");
  }
  if (damaged) {
    // Without a readable registration the workbench starts afresh; the old
    // directory (recent projects included) stays in the archive.
    archive.keep(store.directory, "workbench");
    actions.add("archived-state");
  } else if (activeNow) {
    if (
      value &&
      registration &&
      registration !== "unreadable" &&
      value.phase !== "stopped"
    )
      store.files.replace(
        registrationPath,
        registration.snapshot,
        encoded({ ...value, phase: "stopped" }),
      );
    if (lock === "unreadable") archive.keep(lockPath);
    else if (lock) store.files.remove(lockPath, lock.snapshot);
    actions.add("released-locks");
  }
  if (epoch) ledger.remove(epoch);
  return {
    status: "healed",
    event: log.record({
      scope: "workbench",
      path: null,
      cause,
      actions: [...actions],
      workers: workers.stopped,
      archive: archive.used() ? archive.name : null,
    }),
  };
}
interface GatewayLock extends Partial<ProcessMark> {
  epoch: string;
}
function decodeGatewayLock(value: unknown): GatewayLock {
  const o = closed(
    value,
    markedKeys(
      value,
      value && typeof value === "object" && Object.hasOwn(value, "pid")
        ? ["epoch", "pid", "host"]
        : ["epoch"],
    ),
  );
  return {
    epoch: decodeId(o.epoch),
    ...(o.pid !== undefined
      ? { pid: integer(o.pid, 1, 2147483647), host: text(o.host, 255, true) }
      : {}),
    ...decodeMarkFields(o),
  };
}
function decodeGatewayRegistration(value: unknown): {
  epoch?: string;
  pid: number;
  host?: string;
  phase: string;
} {
  const o = value as {
    epoch?: string;
    pid: number;
    host?: string;
    phase: string;
  };
  if (
    !o ||
    typeof o !== "object" ||
    !["alive", "stopping", "stopped", "quarantined"].includes(o.phase)
  )
    throw new ContractError("corrupt-selected");
  integer(o.pid, 1, 2147483647);
  if (o.epoch !== undefined) decodeId(o.epoch);
  return o;
}

/** Recent events, newest first. */
export function recentRecoveries(
  files: ServiceCoordination["files"],
  limit = 10,
): RecoveryEvent[] {
  return new RecoveryLog(files).events(limit);
}
