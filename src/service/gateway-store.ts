/** Account-scoped workbench coordination, not a TaskStore or an execution cwd. */
import { randomBytes, randomUUID } from "node:crypto";
import { opendirSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { canonicalAmbientRoot, defaultStateHome } from "../task-store.ts";
import { AccessMaterial } from "./auth.ts";
import { decodeHttpPolicy, type HttpPolicy } from "./config.ts";
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
import type { ProjectEntry as GatewayProject } from "./contracts/gateway.ts";
import { decodeProjectEntry, type ProjectEntry } from "./contracts/gateway.ts";
import {
  encoded,
  type FileSnapshot,
  hash,
  json,
  PrivateFiles,
} from "./private-files.ts";

export interface GatewayInput {
  kind: "workbench";
  serverConfig: string;
  stateHome: string;
  agentDir: string;
  policy: HttpPolicy;
}
export function decodeGatewayInput(value: unknown): GatewayInput {
  const o = closed(value, [
    "kind",
    "serverConfig",
    "stateHome",
    "agentDir",
    "policy",
  ]);
  const absolute = (v: unknown) => {
    const p = text(v, 4096, true);
    if (resolve(p) !== p) throw new ContractError("invalid");
    return p;
  };
  return {
    kind: literal(o.kind, "workbench"),
    serverConfig: absolute(o.serverConfig),
    stateHome: absolute(o.stateHome),
    agentDir: absolute(o.agentDir),
    policy: decodeHttpPolicy(o.policy),
  };
}
export interface GatewayRegistration {
  schema: "cadence-workbench-registration/1";
  epoch: string;
  id: string;
  endpoint: string;
  capability: string;
  selection: string;
  pid: number;
  /** Older registrations omitted this; recovery requires explicit host attestation. */
  host?: string;
  /** Explicit recovery acknowledges old associations without deleting their references. */
  recovery?: { receipt: string; sha256: string; stamp: string };
  phase: "alive" | "stopping" | "stopped" | "quarantined";
}
export type { ProjectEntry as GatewayProject } from "./contracts/gateway.ts";

function decodeGatewayProject(value: unknown): ProjectEntry {
  const project = decodeProjectEntry(value);
  if (
    resolve(project.path) !== project.path ||
    resolve(project.cwd) !== project.cwd
  )
    throw new ContractError("corrupt-selected");
  return project;
}
function registration(value: unknown): GatewayRegistration {
  const hasHost =
    !!value && typeof value === "object" && Object.hasOwn(value, "host");
  const hasRecovery =
    !!value && typeof value === "object" && Object.hasOwn(value, "recovery");
  const o = closed(value, [
    "schema",
    "epoch",
    "id",
    "endpoint",
    "capability",
    "selection",
    "pid",
    "phase",
    ...(hasHost ? ["host"] : []),
    ...(hasRecovery ? ["recovery"] : []),
  ]);
  let recovery: GatewayRegistration["recovery"];
  if (hasRecovery) {
    const r = closed(o.recovery, ["receipt", "sha256", "stamp"]);
    const receipt = text(r.receipt, 128, true);
    if (
      !/^recovery-v1\/[a-f0-9]{64}\/(?:0|[1-9][0-9]{0,2})\.json$/.test(receipt)
    )
      throw new ContractError("corrupt-selected");
    recovery = {
      receipt,
      sha256: decodeHash(r.sha256),
      stamp: text(r.stamp, 512, true),
    };
  }
  const endpoint = text(o.endpoint, 128, true),
    capability = text(o.capability, 43, true);
  if (
    !/^http:\/\/(?:127\.0\.0\.1|\[::1\]):[1-9][0-9]{0,4}$/.test(endpoint) ||
    !/^[A-Za-z0-9_-]{43}$/.test(capability)
  )
    throw new ContractError("corrupt-selected");
  return {
    schema: literal(o.schema, "cadence-workbench-registration/1"),
    epoch: decodeId(o.epoch),
    id: decodeId(o.id),
    endpoint,
    capability,
    selection: decodeHash(o.selection),
    pid: integer(o.pid, 1, 2147483647),
    ...(hasHost ? { host: text(o.host, 255, true) } : {}),
    ...(recovery ? { recovery } : {}),
    phase: oneOf(o.phase, ["alive", "stopping", "stopped", "quarantined"]),
  };
}
export class GatewayStore {
  readonly files: PrivateFiles;
  readonly directory: string;
  readonly stateHome: string;
  private lock: FileSnapshot | undefined;
  private selected: FileSnapshot | undefined;
  private inputFile: FileSnapshot | undefined;
  private value: GatewayRegistration | undefined;
  constructor(
    readonly serverConfig: string,
    stateHome = defaultStateHome(),
  ) {
    this.stateHome = canonicalAmbientRoot(stateHome);
    this.files = new PrivateFiles(join(this.stateHome, "cadence-assistant-v1"));
    this.directory = join(
      this.files.namespace,
      "workbenches-v1",
      hash(resolve(serverConfig)),
    );
  }
  path(name: string): string {
    return join(this.directory, name);
  }
  read(): GatewayRegistration | undefined {
    const file = this.files.read(this.path("gateway.json"));
    if (!file) {
      if (this.files.directory(this.directory))
        throw new ContractError("corrupt-selected");
      return undefined;
    }
    const value = registration(json(file));
    const selected = this.files.read(this.path("input.json"));
    if (!selected || hash(selected.bytes) !== value.selection)
      throw new ContractError("corrupt-selected");
    decodeGatewayInput(json(selected));
    return value;
  }
  localAccess(): { endpoint: string; epoch: string; capability: string } {
    const value = this.read();
    if (!value || value.phase === "stopped")
      throw new ContractError("unavailable");
    return {
      endpoint: value.endpoint,
      epoch: value.epoch,
      capability: value.capability,
    };
  }
  inspect(): { status: string; epoch?: string } {
    const value = this.read();
    if (!value) return { status: "absent" };
    return {
      status:
        value.phase === "stopped" && this.files.read(this.path("gateway.lock"))
          ? "stopping"
          : value.phase,
      epoch: value.epoch,
    };
  }
  acquire(
    endpoint: string,
    token: string,
    input: GatewayInput,
  ): { registration: GatewayRegistration; access: AccessMaterial } {
    const previous = this.read();
    if (previous && previous.phase !== "stopped")
      throw new ContractError("quarantine");
    if (previous?.recovery) this.associatedProjects();
    this.lock = this.files.create(
      this.path("gateway.lock"),
      encoded({ epoch: randomUUID() }),
    );
    // A failed initialization intentionally leaves this exact lock in place.
    const source = { serverConfig: this.serverConfig, token };
    if (!previous)
      AccessMaterial.initialize(this.files, this.directory, source);
    const access = new AccessMaterial(this.files, this.directory, source, () =>
      this.assert(),
    );
    this.selected = this.files.read(this.path("gateway.json"));
    if (
      previous &&
      (!this.selected ||
        encoded(registration(json(this.selected))) !== encoded(previous))
    )
      throw new ContractError("conflict");
    const beforeInput = this.files.read(this.path("input.json"));
    const inputBytes = encoded(decodeGatewayInput(input));
    this.inputFile = beforeInput
      ? this.files.replace(this.path("input.json"), beforeInput, inputBytes)
      : this.files.create(this.path("input.json"), inputBytes);
    this.value = {
      schema: "cadence-workbench-registration/1",
      epoch: randomUUID(),
      id: previous?.id ?? randomUUID(),
      endpoint,
      capability: randomBytes(32).toString("base64url"),
      selection: hash(inputBytes),
      pid: process.pid,
      host: hostname(),
      ...(previous?.recovery ? { recovery: previous.recovery } : {}),
      phase: "alive",
    };
    this.selected = this.selected
      ? this.files.replace(
          this.path("gateway.json"),
          this.selected,
          encoded(this.value),
        )
      : this.files.create(this.path("gateway.json"), encoded(this.value));
    return { registration: this.value, access };
  }
  assert(): void {
    if (!this.lock || !this.selected) throw new ContractError("unavailable");
    this.files.assert(this.path("gateway.lock"), this.lock);
    this.files.assert(this.path("input.json"), this.inputFile);
    this.files.assert(this.path("gateway.json"), this.selected);
  }
  phase(phase: GatewayRegistration["phase"]): void {
    this.assert();
    this.value = { ...(this.value as GatewayRegistration), phase };
    this.selected = this.files.replace(
      this.path("gateway.json"),
      this.selected as FileSnapshot,
      encoded(this.value),
    );
  }
  release(): void {
    this.phase("stopped");
    this.files.remove(this.path("gateway.lock"), this.lock as FileSnapshot);
  }
  projects(): GatewayProject[] {
    const directory = this.path("projects");
    if (!this.files.directory(directory)) return [];
    const stream = opendirSync(directory),
      out: GatewayProject[] = [];
    try {
      for (let entry = stream.readSync(); entry; entry = stream.readSync()) {
        if (
          !entry.isFile() ||
          !/^[a-f0-9]{64}\.json$/.test(entry.name) ||
          out.length >= 128
        )
          throw new ContractError("corrupt-selected");
        const file = this.files.read(join(directory, entry.name));
        if (!file) throw new ContractError("corrupt-selected");
        const project = decodeGatewayProject(json(file));
        if (
          entry.name !== `${project.id}.json` ||
          hash(project.path) !== project.id
        )
          throw new ContractError("corrupt-selected");
        out.push(project);
      }
    } finally {
      stream.closeSync();
    }
    return out;
  }
  /** Recovery retires exact old associations, not projects or outcomes. An
   * explicit Open/save replaces the reference incarnation and associates it again. */
  associatedProjects(): GatewayProject[] {
    const projects = this.projects(),
      recovery = this.read()?.recovery;
    if (!recovery) return projects;
    const receipt = this.files.read(this.path(recovery.receipt), 65536);
    if (
      !receipt ||
      receipt.identity !== recovery.sha256 ||
      receipt.stamp !== recovery.stamp
    )
      throw new ContractError("corrupt-selected");
    const value = json(receipt, 65536) as Record<string, unknown>;
    literal(value.schema, "cadence-workbench-recovery/1");
    const retired = list(value.retiredProjects, 128, (entry) => {
      const row = closed(entry, ["id", "stamp"]);
      return { id: decodeHash(row.id), stamp: text(row.stamp, 512, true) };
    });
    return projects.filter(
      (project) =>
        !retired.some(
          (row) =>
            row.id === project.id &&
            row.stamp ===
              this.files.read(this.path(`projects/${project.id}.json`))?.stamp,
        ),
    );
  }
  saveProject(project: GatewayProject): void {
    this.assert();
    const p = decodeGatewayProject(project),
      path = this.path(`projects/${p.id}.json`),
      before = this.files.read(path);
    if (!before && this.projects().length >= 128)
      throw new ContractError("capacity");
    if (before) {
      const old = decodeGatewayProject(json(before));
      if (old.id !== p.id || old.path !== p.path)
        throw new ContractError("conflict");
      this.files.replace(path, before, encoded(p));
    } else this.files.create(path, encoded(p));
  }
}
