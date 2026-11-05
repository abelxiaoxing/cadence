/** Short repository mutation leases and exact managed-worktree ownership.
 * Never reclaims by age/PID here: only the existing owner healer may settle a
 * dead epoch, AFTER its process ledger has stopped the original children. */
import { randomUUID } from "node:crypto";
import { lstatSync, opendirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { readBounded } from "../workspace.ts";
import {
  ContractError,
  closed,
  decodeHash,
  decodeId,
  text,
} from "./contracts/core.ts";
import type { ServiceCoordination } from "./coordination.ts";
import { selfMark } from "./liveness.ts";
import {
  encoded,
  type FileSnapshot,
  hash,
  json,
  type PrivateFiles,
} from "./private-files.ts";

const WAIT_MS = 30_000;
const POLL_MS = 50;
const ACTIVE_RESOURCES = 256;
interface Resource {
  schema: "cadence-delivery-resource/1";
  kind: "mutation" | "workspace";
  resource: string;
  root: string;
  epoch: string;
  run: string;
  token: string;
  identity: string | null;
  holder: ReturnType<typeof selfMark>;
}
function decode(value: unknown): Resource {
  const o = closed(value, [
    "schema",
    "kind",
    "resource",
    "root",
    "epoch",
    "run",
    "token",
    "identity",
    "holder",
  ]);
  if (
    o.schema !== "cadence-delivery-resource/1" ||
    !["mutation", "workspace"].includes(String(o.kind))
  )
    throw new ContractError("corrupt-selected");
  for (const path of [o.resource, o.root])
    if (typeof path !== "string" || !isAbsolute(path) || path.includes("\0"))
      throw new ContractError("corrupt-selected");
  const h = closed(o.holder, ["pid", "host", "boot", "started"]);
  if (
    !Number.isSafeInteger(h.pid) ||
    Number(h.pid) < 1 ||
    typeof h.host !== "string" ||
    ![h.boot, h.started].every((x) => x === null || typeof x === "string")
  )
    throw new ContractError("corrupt-selected");
  return {
    schema: "cadence-delivery-resource/1",
    kind: o.kind as Resource["kind"],
    resource: text(o.resource, 4096, true),
    root: text(o.root, 4096, true),
    epoch: decodeId(o.epoch),
    run: decodeId(o.run),
    token: decodeId(o.token),
    identity: o.identity === null ? null : decodeHash(o.identity),
    holder: h as unknown as Resource["holder"],
  };
}
const directory = (files: PrivateFiles) =>
  join(files.namespace, "delivery-resources-v1");
const resourcePath = (files: PrivateFiles, row: Resource) =>
  join(directory(files), row.kind, `${hash(row.resource)}.json`);
const ownerDirectory = (files: PrivateFiles, root: string, epoch: string) =>
  join(directory(files), "owners", hash(root), decodeId(epoch));
const indexPath = (files: PrivateFiles, row: Resource) =>
  join(
    ownerDirectory(files, row.root, row.epoch),
    `${row.kind}-${hash(row.resource)}.json`,
  );
export function worktreeIdentity(path: string): string {
  const root = lstatSync(path),
    marker = lstatSync(join(path, ".git"));
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    !marker.isFile() ||
    marker.nlink !== 1 ||
    marker.size > 8192
  )
    throw new ContractError("stale");
  const body = readBounded(join(path, ".git"), 8192);
  const after = lstatSync(join(path, ".git")),
    afterRoot = lstatSync(path);
  if (
    !body ||
    after.dev !== marker.dev ||
    after.ino !== marker.ino ||
    after.ctimeMs !== marker.ctimeMs ||
    after.size !== marker.size ||
    afterRoot.dev !== root.dev ||
    afterRoot.ino !== root.ino
  )
    throw new ContractError("stale");
  return hash(
    encoded([
      root.dev,
      root.ino,
      marker.dev,
      marker.ino,
      body.toString("utf8"),
    ]),
  );
}
export class RepositoryCoordination {
  private owned = new Map<
    string,
    { row: Resource; file: FileSnapshot; index: FileSnapshot }
  >();
  constructor(
    private readonly c: ServiceCoordination,
    private readonly root: string,
    private readonly epoch: string,
    private readonly run: string,
    private readonly assertOwner: () => void,
    private readonly fault: () => void,
  ) {}
  private write<T>(operation: () => T): T {
    try {
      return operation();
    } catch (error) {
      this.fault();
      throw error;
    }
  }
  private reserve(kind: Resource["kind"], resource: string) {
    this.assertOwner();
    const row: Resource = {
      schema: "cadence-delivery-resource/1",
      kind,
      resource,
      root: this.root,
      epoch: this.epoch,
      run: this.run,
      token: randomUUID(),
      identity: null,
      holder: selfMark(),
    };
    const target = resourcePath(this.c.files, row);
    if (this.c.files.read(target)) return null;
    // Intent first: a crash cannot create an unindexed active reservation.
    const index = this.write(() =>
      this.c.files.create(indexPath(this.c.files, row), encoded(row)),
    );
    let file: FileSnapshot;
    try {
      file = this.c.files.create(target, encoded(row));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "EEXIST"
      ) {
        this.write(() =>
          this.c.files.remove(indexPath(this.c.files, row), index),
        );
        return null;
      }
      this.fault();
      throw error; // Partial writes retain the intent for recovery, never adopt.
    }
    const held = { row, file, index };
    this.owned.set(row.token, held);
    return held;
  }
  async mutate<T>(
    repository: string,
    signal: AbortSignal,
    operation: () => Promise<T>,
    settled: () => boolean,
  ): Promise<T> {
    const deadline = performance.now() + WAIT_MS;
    let held: ReturnType<RepositoryCoordination["reserve"]>;
    for (;;) {
      this.assertOwner();
      if (signal.aborted) throw new ContractError("stale");
      held = this.reserve("mutation", repository);
      if (held) break;
      if (performance.now() >= deadline) throw new ContractError("conflict");
      await delay(POLL_MS, undefined, { signal });
    }
    try {
      return await operation();
    } finally {
      // The owner supplies actual native/auth/storage settlement, not a timeout.
      if (settled()) this.release(held.row.token);
    }
  }
  reserveWorkspace(path: string): string {
    const held = this.reserve("workspace", path);
    if (!held) throw new ContractError("conflict");
    return held.row.token;
  }
  confirmWorkspace(token: string): void {
    const held = this.require(token);
    held.row = { ...held.row, identity: worktreeIdentity(held.row.resource) };
    // Immutable creation evidence belongs to the run. Shared records remain
    // active-only, so completed history never grows the account's lease index.
    this.write(() =>
      this.c.files.create(
        join(
          this.c.directory,
          "workflows-v1",
          "runs",
          this.run,
          "ownership",
          `${token}.json`,
        ),
        encoded({ ...held.row, schema: "cadence-workspace-observation/1" }),
      ),
    );
  }
  assertWorkspace(token: string): void {
    this.assertOwner();
    const held = this.require(token);
    this.c.files.assert(resourcePath(this.c.files, held.row), held.file);
    if (
      !held.row.identity ||
      worktreeIdentity(held.row.resource) !== held.row.identity
    )
      throw new ContractError("stale");
  }
  private require(token: string) {
    const held = this.owned.get(token);
    if (!held) throw new ContractError("stale");
    return held;
  }
  release(token: string): void {
    this.assertOwner();
    const held = this.require(token);
    this.write(() => {
      this.c.files.remove(resourcePath(this.c.files, held.row), held.file);
      this.c.files.remove(indexPath(this.c.files, held.row), held.index);
    });
    this.owned.delete(token);
  }
  finish(): void {
    for (const held of [...this.owned.values()])
      if (held.row.kind === "workspace") this.release(held.row.token);
  }
}
/** Called only by healProjectAt after exact epoch/children closure proof. Never
 * touches a Git ref, checkout, profile or consumer file; retained ownership
 * evidence stays in the original run, not the account's active lease index. */
export function recoverDeliveryResources(
  files: PrivateFiles,
  root: string,
  epoch: string,
  options: {
    inspect?: boolean;
    takeOver?: boolean;
    archive?: (path: string) => void;
    expectedOwner?: Partial<ReturnType<typeof selfMark>>;
  } = {},
): number {
  const home = ownerDirectory(files, root, epoch);
  if (!files.directory(home)) return 0;
  const dir = opendirSync(home);
  const actions: (() => void)[] = [];
  let count = 0;
  const read = (path: string) => {
    try {
      const snapshot = files.read(path);
      if (!snapshot) return { snapshot, row: undefined, broken: false };
      try {
        return { snapshot, row: decode(json(snapshot)), broken: false };
      } catch {
        return { snapshot, row: undefined, broken: true };
      }
    } catch {
      return { snapshot: undefined, row: undefined, broken: true };
    }
  };
  const archive = (path: string) => {
    if (!options.archive) throw new ContractError("corrupt-selected");
    options.archive(path);
  };
  try {
    for (let entry = dir.readSync(); entry; entry = dir.readSync()) {
      if (++count > ACTIVE_RESOURCES) throw new ContractError("capacity");
      const match = /^(mutation|workspace)-([a-f0-9]{64})\.json$/u.exec(
        entry.name,
      );
      const path = join(home, entry.name);
      if (!match) {
        if (!options.takeOver) throw new ContractError("corrupt-selected");
        actions.push(() => archive(path));
        continue;
      }
      const [, kind, key] = match;
      const index = read(path),
        target = join(directory(files), kind, `${key}.json`),
        shared = read(target);
      const matches = (row: Resource) =>
        row.kind === kind &&
        hash(row.resource) === key &&
        row.root === root &&
        row.epoch === epoch;
      const ownerMatches = (row: Resource) =>
        !options.expectedOwner ||
        Object.entries(options.expectedOwner).every(
          ([key, value]) =>
            value == null ||
            row.holder[key as keyof Resource["holder"]] === value,
        );
      const badIndex =
        index.broken ||
        !index.row ||
        !matches(index.row) ||
        !ownerMatches(index.row);
      const badShared =
        shared.broken ||
        (shared.row &&
          (shared.row.kind !== kind ||
            hash(shared.row.resource) !== key ||
            (matches(shared.row) &&
              (!ownerMatches(shared.row) ||
                (index.row &&
                  !badIndex &&
                  index.row.token === shared.row.token &&
                  encoded(index.row.holder) !== encoded(shared.row.holder))))));
      // A shared unidentifiable holder requires the existing explicit doctor
      // confirmation. A corrupt index alone cannot authorize touching it.
      if (badShared && !options.takeOver)
        throw new ContractError("corrupt-selected");
      actions.push(() => {
        if (badShared) archive(target);
        else if (
          shared.row &&
          shared.snapshot &&
          matches(shared.row) &&
          (!index.row || badIndex || index.row.token === shared.row.token)
        ) {
          files.remove(target, shared.snapshot);
        }
        // A replacement owner's valid resource is always left alone.
        if (badIndex) archive(path);
        else if (index.snapshot) files.remove(path, index.snapshot);
      });
    }
  } finally {
    dir.closeSync();
  }
  if (!options.inspect) for (const action of actions) action();
  return count;
}
