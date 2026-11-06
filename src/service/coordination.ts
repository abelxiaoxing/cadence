import { randomBytes, randomUUID } from "node:crypto";
import { opendirSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  canonicalAmbientRoot,
  defaultStateHome,
  resolveWorkspace,
} from "../workspace.ts";
import { type CheckoutLock, CheckoutStore } from "./checkout-lock.ts";
import {
  ContractError,
  closed,
  decodeHash,
  decodeId,
  integer,
  list,
  literal,
  oneOf,
  text,
} from "./contracts/core.ts";
import {
  decodeMarkFields,
  holderState,
  selfMark,
  stampTime,
} from "./liveness.ts";
import {
  DirectoryWalks,
  encoded,
  type FileSnapshot,
  hash,
  json,
  PrivateFiles,
  REGISTRY_BYTES,
  REGISTRY_ENTRIES,
  refused,
} from "./private-files.ts";

export interface OwnerConfig {
  schema: "cadence-service-owner-config/1";
  /** Requested loopback policy; :0 persists unchanged across explicit starts. */
  endpoint: string;
  /** Identity of secret-free selected service policy, NOT provider/auth bytes. */
  policyIdentity: string;
}
export type OwnerPhase = "idle" | "stopping" | "quarantined" | "stopped";
export interface Registration {
  schema: "cadence-service-registration/1";
  root: string;
  stateHome: string;
  configIdentity: string;
  endpoint: string;
  epoch: string;
  pid: number;
  host: string;
  ownerToken: string;
  checkoutToken: string;
  phase: OwnerPhase;
}
type Reservation = Omit<Registration, "schema" | "phase" | "checkoutToken">;
interface Registry {
  schema: "cadence-service-registry/1";
  entries: Reservation[];
}
const registrationKeys = [
  "schema",
  "root",
  "stateHome",
  "configIdentity",
  "endpoint",
  "epoch",
  "pid",
  "host",
  "ownerToken",
  "checkoutToken",
  "phase",
];
const reservationKeys = registrationKeys.filter(
  (k) => !["schema", "phase", "checkoutToken"].includes(k),
);
function pathValue(value: unknown): string {
  const path = text(value, 4096, true);
  if (!isAbsolute(path)) refused();
  return path;
}
function endpoint(value: unknown, allowZero = false): string {
  const s = text(value, 128, true);
  const match = /^http:\/\/(127\.0\.0\.1|\[::1\]):(0|[1-9][0-9]{0,4})$/.exec(s);
  if (!match || Number(match[2]) > 65535 || (!allowZero && match[2] === "0"))
    refused();
  return s;
}
function endpointMatches(requested: string, bound: string): boolean {
  return requested.endsWith(":0")
    ? requested.slice(0, -1) === bound.slice(0, bound.lastIndexOf(":") + 1)
    : requested === bound;
}
export function decodeOwnerConfig(value: unknown): OwnerConfig {
  const o = closed(value, ["schema", "endpoint", "policyIdentity"]);
  return {
    schema: literal(o.schema, "cadence-service-owner-config/1"),
    endpoint: endpoint(o.endpoint, true),
    policyIdentity: decodeHash(o.policyIdentity),
  };
}
function decodeReservation(value: unknown): Reservation {
  const o = closed(value, reservationKeys);
  return {
    root: pathValue(o.root),
    stateHome: pathValue(o.stateHome),
    configIdentity: decodeHash(o.configIdentity),
    endpoint: endpoint(o.endpoint),
    epoch: decodeId(o.epoch),
    pid: integer(o.pid, 1),
    host: text(o.host, 255, true),
    ownerToken: decodeId(o.ownerToken),
  };
}
function reservation(r: Registration): Reservation {
  const {
    schema: _schema,
    phase: _phase,
    checkoutToken: _checkout,
    ...row
  } = r;
  return row;
}
export function decodeRegistration(value: unknown): Registration {
  const o = closed(value, registrationKeys);
  const row = Object.fromEntries(reservationKeys.map((k) => [k, o[k]]));
  return {
    schema: literal(o.schema, "cadence-service-registration/1"),
    ...decodeReservation(row),
    checkoutToken: decodeId(o.checkoutToken),
    phase: oneOf(o.phase, ["idle", "stopping", "quarantined", "stopped"]),
  };
}
/** Segment-aware, symmetric, independent of Git classification. */
export function rootsOverlap(a: string, b: string): boolean {
  const within = (x: string, y: string) => {
    const r = relative(x, y);
    return (
      r === "" || (r !== ".." && !r.startsWith(`..${sep}`) && !isAbsolute(r))
    );
  };
  return within(a, b) || within(b, a);
}
function names(path: string, allowed: readonly string[]): void {
  const dir = opendirSync(path);
  try {
    let count = 0;
    for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
      if (++count > allowed.length || !allowed.includes(entry.name)) refused();
    }
  } finally {
    dir.closeSync();
  }
}
interface RegistryLock {
  schema: "cadence-service-registry-lock/1";
  token: string;
  pid: number;
  host: string;
  boot: string | null;
  started: string | null;
}
/** Older locks lack the liveness marks; new ones carry both. */
export function markedKeys(value: unknown, keys: string[]): string[] {
  const has = (key: string) =>
    !!value && typeof value === "object" && Object.hasOwn(value, key);
  return [
    ...keys,
    ...(has("boot") ? ["boot"] : []),
    ...(has("started") ? ["started"] : []),
  ];
}
export function decodeRegistryLock(snapshot: FileSnapshot): RegistryLock {
  const raw = json(snapshot);
  const o = closed(raw, markedKeys(raw, ["schema", "token", "pid", "host"]));
  return {
    schema: literal(o.schema, "cadence-service-registry-lock/1"),
    token: decodeId(o.token),
    // kill(0)/negative process-group probes must never be possible.
    pid: integer(o.pid, 1, 2147483647),
    host: text(o.host, 255, true),
    ...decodeMarkFields(o),
  };
}
export interface RegistryLockDiagnostic {
  reason: "registry-locked";
  owner: "live" | "absent" | "ambiguous" | "unreadable";
}
const registryNames = [
  "format.json",
  "roots.json",
  "registry.lock",
  "recovery-v1",
];
export interface RegistryView {
  format: FileSnapshot;
  snapshot: FileSnapshot;
  value: Registry;
}
interface Selected {
  config: FileSnapshot;
  hostConfig?: FileSnapshot;
  manifest: FileSnapshot;
  registration?: FileSnapshot;
  owner?: FileSnapshot;
  capability?: FileSnapshot;
  checkout?: FileSnapshot;
  value?: Registration;
}
export type CoordinationStatus =
  | { status: "absent" | "unavailable" }
  | {
      status: "stopped" | "unavailable" | "stopping" | "quarantined";
      epoch: string | null;
    };

/** Explicit filesystem ownership only. No listener, worker, auth resolution,
 * task creation, stale reclaim or accepting execution route lives here.
 */
export class ServiceCoordination {
  private readonly project?: CheckoutStore;
  readonly files: PrivateFiles;
  readonly registryDirectory: string;
  readonly stateHome: string;
  /** null addresses only the account registry. An already validated CheckoutStore
   * lets registry observation retain the registered root without running Git. */
  constructor(workspace: string | CheckoutStore | null, stateHome?: string) {
    this.project =
      workspace === null
        ? undefined
        : workspace instanceof CheckoutStore
          ? workspace
          : new CheckoutStore(resolveWorkspace(workspace).root, stateHome);
    this.stateHome = this.project
      ? dirname(dirname(this.project.privateRoot))
      : canonicalAmbientRoot(stateHome ?? defaultStateHome());
    const namespace = join(this.stateHome, "cadence-assistant-v1");
    this.files = new PrivateFiles(namespace);
    this.registryDirectory = join(namespace, "service-registry-v1");
  }
  get store(): CheckoutStore {
    if (!this.project) throw new ContractError("forbidden");
    return this.project;
  }
  get directory(): string {
    return join(this.store.privateRoot, "service-v1");
  }
  path(
    name:
      | "format.json"
      | "config.json"
      | "registration.json"
      | "owner.lock"
      | "local-capability.json"
      | "host-config.json"
      | "access-config.json"
      | "access.json",
  ): string {
    return join(this.directory, name);
  }
  private registryPath(name: string): string {
    return join(this.registryDirectory, name);
  }
  private registry(): RegistryView | undefined {
    if (!this.files.directory(this.registryDirectory)) return undefined;
    names(this.registryDirectory, registryNames);
    const format = this.files.read(this.registryPath("format.json"));
    const snapshot = this.files.read(
      this.registryPath("roots.json"),
      REGISTRY_BYTES,
    );
    if (!format || !snapshot) refused();
    const f = closed(json(format), ["schema", "stateHome"]);
    literal(f.schema, "cadence-service-registry-format/1");
    literal(f.stateHome, this.stateHome);
    const o = closed(json(snapshot, REGISTRY_BYTES), ["schema", "entries"]);
    const entries = list(o.entries, REGISTRY_ENTRIES, decodeReservation);
    for (const [i, row] of entries.entries()) {
      // A missing consumer directory does not erase its reservation. Validate
      // its canonical existing ancestors without recreating the missing tail;
      // aliases (including dangling ones), permissions and overlaps still refuse.
      if (
        row.stateHome !== this.stateHome ||
        canonicalAmbientRoot(row.root) !== row.root
      )
        refused();
      // An endpoint cannot be shared by two supported owners, even for disjoint roots.
      if (
        entries
          .slice(0, i)
          .some(
            (other) =>
              rootsOverlap(row.root, other.root) ||
              row.endpoint === other.endpoint,
          )
      )
        refused();
    }
    return {
      format,
      snapshot,
      value: {
        schema: literal(o.schema, "cadence-service-registry/1"),
        entries,
      },
    };
  }
  assertNamespace(walks?: DirectoryWalks, directory = this.directory): void {
    if (!this.files.directory(directory, false, walks)) refused();
    names(directory, [
      "format.json",
      "config.json",
      "registration.json",
      "owner.lock",
      "local-capability.json",
      "access-config.json",
      "access.json",
      "host-config.json",
      "history-v2",
      "conversations-v1",
      "conversation-commands-v1",
      "conversation-workflows-v1",
      "workflows-v1",
    ]);
    this.files.directory(join(directory, "history-v2"), false, walks);
  }
  private selected(
    directory = this.directory,
    root = this.store.root,
    stoppedOnly = false,
  ): Selected | undefined {
    const walks = new DirectoryWalks();
    if (!this.files.directory(directory, false, walks)) return undefined;
    this.assertNamespace(walks, directory);
    const path = (name: string) => join(directory, name);
    const manifest = this.files.read(path("format.json"), undefined, walks);
    const config = this.files.read(path("config.json"), undefined, walks);
    if (!manifest || !config) refused();
    const f = closed(json(manifest), [
      "schema",
      "root",
      "stateHome",
      "configIdentity",
    ]);
    literal(f.schema, "cadence-service-format/1");
    literal(f.root, root);
    literal(f.stateHome, this.stateHome);
    literal(f.configIdentity, config.identity);
    const c = decodeOwnerConfig(json(config));
    const hostConfig = this.files.read(
      path("host-config.json"),
      undefined,
      walks,
    );
    if (hostConfig && hostConfig.identity !== c.policyIdentity) refused();
    const registration = this.files.read(
      path("registration.json"),
      undefined,
      walks,
    );
    const owner = this.files.read(path("owner.lock"), undefined, walks);
    const capability = this.files.read(
      path("local-capability.json"),
      undefined,
      walks,
    );
    const checkout = this.files.read(
      join(dirname(directory), "checkout.lock"),
      8192,
      walks,
    );
    const value = registration
      ? decodeRegistration(json(registration))
      : undefined;
    if (
      value &&
      (value.root !== root ||
        value.stateHome !== this.stateHome ||
        value.configIdentity !== config.identity ||
        !endpointMatches(c.endpoint, value.endpoint))
    )
      refused();
    if (stoppedOnly && (checkout || (value && value.phase !== "stopped")))
      throw new ContractError("quarantine");
    if (value && value.phase !== "stopped") {
      if (!owner || !checkout || !capability) refused();
      const raw = json(owner);
      const lock = closed(
        raw,
        markedKeys(raw, ["schema", "epoch", "token", "pid", "host"]),
      );
      literal(lock.schema, "cadence-service-owner-lock/1");
      literal(lock.epoch, value.epoch);
      literal(lock.token, value.ownerToken);
      literal(lock.pid, value.pid);
      literal(lock.host, value.host);
      const legacy = this.store.inspectLock();
      if (
        !legacy ||
        legacy.token !== value.checkoutToken ||
        legacy.pid !== value.pid ||
        legacy.host !== value.host
      )
        refused();
      const cap = closed(json(capability), ["schema", "epoch", "capability"]);
      literal(cap.schema, "cadence-service-local-capability/1");
      literal(cap.epoch, value.epoch);
      if (!/^[A-Za-z0-9_-]{43}$/.test(text(cap.capability, 43))) refused();
    } else if (owner || capability || (value && checkout)) refused();
    return {
      config,
      hostConfig,
      manifest,
      registration,
      owner,
      capability,
      checkout,
      value,
    };
  }
  /** A PID alone cannot establish alive/authenticated readiness. Transport will
   * challenge the epoch separately; stale file status remains unavailable here. */
  inspect(): CoordinationStatus {
    try {
      if (this.files.read(this.registryPath("registry.lock")))
        return { status: "unavailable" };
      const registry = this.registry();
      const selected = this.selected();
      const row = registry?.value.entries.find(
        (r) => r.root === this.store.root,
      );
      if (!selected)
        return row ? { status: "unavailable" } : { status: "absent" };
      if (!selected.value)
        return row
          ? { status: "unavailable" }
          : { status: "stopped", epoch: null };
      const r = selected.value;
      if (r.phase === "stopped")
        return { status: row ? "unavailable" : "stopped", epoch: r.epoch };
      if (!row || encoded(row) !== encoded(reservation(r)))
        return { status: "unavailable", epoch: r.epoch };
      return {
        status: r.phase === "idle" ? "unavailable" : r.phase,
        epoch: r.epoch,
      };
    } catch {
      return { status: "unavailable" };
    }
  }
  /** Explicit initialization is not discovery. Partial initialization is never
   * adopted/reset. Caller must retain the failure and request manual diagnosis. */
  initialize(input: OwnerConfig): void {
    const config = decodeOwnerConfig(input);
    const existing = this.selected();
    if (existing) {
      if (existing.config.identity !== hash(encoded(config)))
        throw new ContractError("conflict");
      return;
    }
    this.files.directory(this.directory, true);
    const saved = this.files.create(this.path("config.json"), encoded(config));
    this.files.create(
      this.path("format.json"),
      encoded({
        schema: "cadence-service-format/1",
        root: this.store.root,
        stateHome: this.stateHome,
        configIdentity: saved.identity,
      }),
    );
  }
  /** Validated registry, or undefined before the first reservation. */
  registryView(): RegistryView | undefined {
    return this.registry();
  }
  /** The short exclusive registry section, for self-healing reclaims. */
  mutateRegistry<T>(
    operation: (
      view: RegistryView,
      mutate: () => void,
      assertHeld: () => void,
    ) => T,
  ): T {
    return this.withRegistry(operation);
  }
  private withRegistry<T>(
    operation: (
      view: RegistryView,
      mutate: () => void,
      assertHeld: () => void,
    ) => T,
  ): T {
    this.files.directory(this.registryDirectory, true);
    names(this.registryDirectory, registryNames);
    const lockPath = this.registryPath("registry.lock");
    let lock: FileSnapshot;
    try {
      const mark = selfMark();
      lock = this.files.create(
        lockPath,
        encoded({
          schema: "cadence-service-registry-lock/1",
          token: randomUUID(),
          pid: process.pid,
          host: hostname(),
          boot: mark.boot,
          started: mark.started,
        }),
      );
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw new ContractError("registry-locked");
      throw error;
    }
    let dirty = false;
    try {
      let format = this.files.read(this.registryPath("format.json"));
      const roots = this.files.read(
        this.registryPath("roots.json"),
        REGISTRY_BYTES,
      );
      if (!format && !roots) {
        dirty = true;
        format = this.files.create(
          this.registryPath("format.json"),
          encoded({
            schema: "cadence-service-registry-format/1",
            stateHome: this.stateHome,
          }),
        );
        this.files.create(
          this.registryPath("roots.json"),
          encoded({ schema: "cadence-service-registry/1", entries: [] }),
          REGISTRY_BYTES,
        );
        dirty = false;
      }
      // Corrupt/partial existing registry is uncertainty, not an inert conflict.
      dirty = true;
      const view = this.registry();
      if (!view) refused();
      dirty = false;
      const result = operation(
        view,
        () => {
          dirty = true;
        },
        () => {
          this.files.assert(lockPath, lock);
          this.files.assert(this.registryPath("format.json"), format);
          names(this.registryDirectory, registryNames);
        },
      );
      this.files.remove(lockPath, lock);
      return result;
    } catch (error) {
      // Before any write, a conflict is a known inert refusal. Persistence or
      // release uncertainty retains this exact short lock, never age-expires it.
      if (!dirty) this.files.remove(lockPath, lock);
      throw error;
    }
  }
  acquire(
    input: OwnerConfig,
    resolvedEndpoint: string = input.endpoint,
    initializeNew?: () => void,
    /** Replaces a stopped selection's host policy and access (given its
     * selected host-config snapshot); only then may the identity change. */
    reselectExisting?: (hostConfig: FileSnapshot) => void,
  ): OwnerLease {
    void this.store; // An account-only recovery target cannot acquire an owner.
    if (
      rootsOverlap(
        this.store.root,
        join(this.stateHome, "cadence-worktrees-v1"),
      )
    )
      throw new ContractError("forbidden"); // Managed worktrees belong to their original run, never an implicit project owner.
    const config = decodeOwnerConfig(input);
    const bound = endpoint(resolvedEndpoint);
    if (!endpointMatches(config.endpoint, bound))
      throw new ContractError("conflict");
    // Do not initialize a conflicting root as a side effect of a failed start.
    return this.withRegistry((registry, mutate) => {
      if (
        registry.value.entries.some(
          (r) => rootsOverlap(r.root, this.store.root) || r.endpoint === bound,
        )
      )
        throw new ContractError("conflict");
      if (registry.value.entries.length >= REGISTRY_ENTRIES)
        throw new ContractError("capacity");
      const old = this.selected();
      if (old?.value && old.value.phase !== "stopped")
        throw new ContractError("quarantine");
      if (this.store.inspectLock()) throw new ContractError("conflict");
      const reselect = !!old && old.config.identity !== hash(encoded(config));
      if (reselect && (!reselectExisting || !old?.hostConfig))
        throw new ContractError("conflict");
      // Reserve BEFORE root initialization/legacy acquisition. Any later failure
      // keeps the reservation and short lock as an explicit partial fence.
      const row: Reservation = {
        root: this.store.root,
        stateHome: this.stateHome,
        configIdentity: hash(encoded(config)),
        endpoint: bound,
        epoch: randomUUID(),
        pid: process.pid,
        host: hostname(),
        ownerToken: randomUUID(),
      };
      mutate();
      this.files.replace(
        this.registryPath("roots.json"),
        registry.snapshot,
        encoded({
          ...registry.value,
          entries: [...registry.value.entries, row],
        }),
        REGISTRY_BYTES,
      );
      if (old?.hostConfig && reselect && reselectExisting) {
        // Host policy and access first, then the config and its manifest; the
        // registration below takes the new identity. Failures keep the fence.
        reselectExisting(old.hostConfig);
        const saved = this.files.replace(
          this.path("config.json"),
          old.config,
          encoded(config),
        );
        this.files.replace(
          this.path("format.json"),
          old.manifest,
          encoded({
            schema: "cadence-service-format/1",
            root: this.store.root,
            stateHome: this.stateHome,
            configIdentity: saved.identity,
          }),
        );
      } else this.initialize(config);
      // Called only for genuinely absent selected metadata, under the registry
      // reservation and before registration. Failures preserve the partial fence.
      if (!old) initializeNew?.();
      const checkout = this.store.acquire();
      const checkoutFile = this.files.read(this.store.lockPath, 8192);
      if (!checkoutFile) refused();
      const mark = selfMark();
      const owner = this.files.create(
        this.path("owner.lock"),
        encoded({
          schema: "cadence-service-owner-lock/1",
          epoch: row.epoch,
          token: row.ownerToken,
          pid: row.pid,
          host: row.host,
          boot: mark.boot,
          started: mark.started,
        }),
      );
      const capability = this.files.create(
        this.path("local-capability.json"),
        encoded({
          schema: "cadence-service-local-capability/1",
          epoch: row.epoch,
          capability: randomBytes(32).toString("base64url"),
        }),
      );
      const value: Registration = {
        schema: "cadence-service-registration/1",
        ...row,
        checkoutToken: checkout.token,
        phase: "idle",
      };
      const registration = old?.registration
        ? this.files.replace(
            this.path("registration.json"),
            old.registration,
            encoded(value),
          )
        : this.files.create(this.path("registration.json"), encoded(value));
      const selected = this.selected();
      if (!selected) refused();
      return new OwnerLease(this, checkout, {
        ...selected,
        owner,
        capability,
        checkout: checkoutFile,
        registration,
        value,
      });
    });
  }
  configuration(): OwnerConfig | undefined {
    const selected = this.selected();
    return selected ? decodeOwnerConfig(json(selected.config)) : undefined;
  }
  /** Private direct-native client material; never a public status projection. */
  localAccess(): { endpoint: string; epoch: string; capability: string } {
    if (this.files.read(this.registryPath("registry.lock"))) refused();
    const selected = this.selected(),
      registry = this.registry();
    if (
      !selected?.value ||
      !selected.capability ||
      !registry ||
      selected.value.phase === "stopped" ||
      !registry.value.entries.some(
        (row) =>
          selected.value &&
          encoded(row) === encoded(reservation(selected.value)),
      )
    )
      throw new ContractError("unavailable");
    const cap = closed(json(selected.capability), [
      "schema",
      "epoch",
      "capability",
    ]);
    return {
      endpoint: selected.value.endpoint,
      epoch: selected.value.epoch,
      capability: text(cap.capability, 43, true),
    };
  }
  /** Internal release adapter. Never called by status/restart/recovery. */
  release(lease: OwnerLease): void {
    this.withRegistry((view, mutate, assertHeld) => {
      lease.assert();
      const r = lease.registration;
      const rows = view.value.entries.filter((row) => row.epoch === r.epoch);
      if (rows.length !== 1 || encoded(rows[0]) !== encoded(reservation(r)))
        refused();
      mutate();
      lease.phase("stopped");
      const releasedRegistry = this.files.replace(
        this.registryPath("roots.json"),
        view.snapshot,
        encoded({
          ...view.value,
          entries: view.value.entries.filter((row) => row.epoch !== r.epoch),
        }),
        REGISTRY_BYTES,
      );
      lease.removeOwnedFiles(() => {
        assertHeld();
        this.files.assert(
          this.registryPath("roots.json"),
          releasedRegistry,
          REGISTRY_BYTES,
        );
      });
    });
  }
  /** Readonly and secret-free; never probes another host or reclaims on age. */
  registryLockDiagnostic(): RegistryLockDiagnostic | undefined {
    try {
      const lock = this.files.read(this.registryPath("registry.lock"));
      if (!lock) return undefined;
      const value = decodeRegistryLock(lock);
      const holder = holderState(value, stampTime(lock.stamp)).state;
      return {
        reason: "registry-locked",
        owner:
          holder === "live"
            ? "live"
            : holder === "dead"
              ? "absent"
              : "ambiguous",
      };
    } catch {
      return { reason: "registry-locked", owner: "unreadable" };
    }
  }
}

/** Held only by the original owner. Raw-byte AND inode/time identities supplement
 * CheckoutStore's semantic lock assertion, including whitespace-only interference. */
export class OwnerLease {
  private released = false;
  constructor(
    readonly coordination: ServiceCoordination,
    readonly checkout: CheckoutLock,
    private selected: Selected & {
      value: Registration;
      registration: FileSnapshot;
    },
  ) {}
  get registration(): Readonly<Registration> {
    return { ...this.selected.value };
  }
  assert(): void {
    if (
      this.released ||
      this.selected.value.pid !== process.pid ||
      this.selected.value.host !== hostname()
    )
      throw new ContractError("conflict");
    const c = this.coordination,
      walks = new DirectoryWalks();
    c.assertNamespace(walks);
    for (const [name, snapshot] of [
      ["config.json", this.selected.config],
      ["host-config.json", this.selected.hostConfig],
      ["format.json", this.selected.manifest],
      ["registration.json", this.selected.registration],
      ["owner.lock", this.selected.owner],
      ["local-capability.json", this.selected.capability],
    ] as const)
      c.files.assert(c.path(name), snapshot, undefined, walks);
    c.files.assert(c.store.lockPath, this.selected.checkout, 8192, walks);
    c.store.assertOwner(this.checkout);
  }
  phase(phase: OwnerPhase): void {
    this.assert();
    const value = { ...this.selected.value, phase };
    const registration = this.coordination.files.replace(
      this.coordination.path("registration.json"),
      this.selected.registration,
      encoded(value),
    );
    this.selected = { ...this.selected, value, registration };
  }
  release(): void {
    this.assert();
    this.coordination.release(this);
    this.released = true;
  }
  /** Coordination's final ordered release; callers must use owner.stop(). */
  removeOwnedFiles(assertRegistry: () => void): void {
    this.assert();
    assertRegistry();
    const c = this.coordination;
    if (!this.selected.capability || !this.selected.owner) refused();
    const owner = this.selected.owner;
    c.files.remove(c.path("local-capability.json"), this.selected.capability);
    this.selected = { ...this.selected, capability: undefined };
    // Only successful removals change the expected state. A failure or change
    // at a later boundary must retain every remaining fence, not finish release.
    this.assert();
    assertRegistry();
    c.files.remove(c.path("owner.lock"), owner);
    this.selected = { ...this.selected, owner: undefined };
    this.assert();
    assertRegistry();
    // Last per-checkout removal: legacy v1 writers stay blocked through all
    // preceding durable state publication. Multi-file release is not atomic.
    c.files.assert(c.store.lockPath, this.selected.checkout, 8192);
    c.store.release(this.checkout);
  }
}
