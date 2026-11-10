/** Retained conversation views and readonly files for stopped owners. Never
 * starts an owner, loads Pi, repairs records or treats an unresponsive owner as
 * stopped. */
import { homedir } from "node:os";
import { AccessMaterial, type TokenSource } from "./auth.ts";
import { ContractError } from "./contracts/core.ts";
import type { ProjectEntry } from "./contracts/gateway.ts";
import type { WorkbenchRead, WorkbenchResult } from "./contracts/workbench.ts";
import {
  assertConversationDirectory,
  ConversationContextRecords,
} from "./conversation-contexts.ts";
import { ConversationControls } from "./conversation-controls.ts";
import { ConversationRecords } from "./conversation-records.ts";
import { ServiceCoordination } from "./coordination.ts";
import {
  captureEnvironment,
  piSource,
  readPiSnapshot,
  snapshotLiterals,
} from "./model-config.ts";
import { readHostConfig } from "./runtime.ts";
import { readServerConfig } from "./server-config.ts";
import { WorkbenchFiles } from "./workbench-files.ts";

/** Each reader has its existing bounded history scans/cache. Eviction closes
 * scans, so a stale continuation refuses rather than silently starting over. */
const READERS = 16;
interface View {
  key: string;
  records: ConversationRecords;
  controls: ConversationControls;
  assertCurrent(): void;
}
/** Reads this gateway answers itself while no owner runs: they need the
 * project's files, never execution. */
function retainedRead(request: WorkbenchRead): boolean {
  return [
    "conversations",
    "conversation",
    "conversation-turn",
    "conversation-step",
    "conversation-image",
    "cadence-conversation",
    "conversation-context",
    "conversation-tree",
    "files",
    "file",
  ].includes(request.kind);
}
/** A never-prepared selection can show an initial conversation even while the
 * global registry is busy. No execution claim is made; Send still acquires the
 * real registry/owner and checks its exact conversation head. */
export function unpreparedDirectory(
  c: ServiceCoordination,
  project: ProjectEntry,
): boolean {
  return project.epoch === null && !c.files.directory(c.directory);
}
export class GatewayConversations {
  private readonly views = new Map<string, View>();
  constructor(
    private readonly stateHome: string,
    private readonly agentDir?: string,
    private readonly secrets: () => readonly string[] = () => [],
  ) {}
  private forget(id: string): void {
    const view = this.views.get(id);
    this.views.delete(id);
    view?.records.closeReads();
  }
  close(): void {
    for (const id of this.views.keys()) this.forget(id);
  }
  read(
    project: ProjectEntry,
    request: WorkbenchRead,
  ): WorkbenchResult | undefined {
    if (!retainedRead(request)) return undefined;
    const c = new ServiceCoordination(project.path, this.stateHome);
    if (c.store.root !== project.path) throw new ContractError("stale");
    const status = c.inspect().status;
    const fresh = unpreparedDirectory(c, project);
    if (!fresh && status !== "stopped") {
      this.forget(project.id);
      return undefined;
    }
    const registration = c.files.read(c.path("registration.json"));
    const selected = c.files.read(c.path("host-config.json"));
    const config = fresh ? null : readHostConfig(c);
    if (!fresh && (!registration || !selected || !config))
      throw new ContractError("corrupt-selected");
    const agentDir = config?.agentDir ?? this.agentDir;
    if (!agentDir) throw new ContractError("unavailable");
    const key = `${registration?.stamp ?? "new"}:${selected?.stamp ?? "new"}:${project.cwd}`;
    let view = this.views.get(project.id);
    if (view?.key !== key) {
      this.forget(project.id);
      const assertCurrent = () => {
        c.files.assert(c.path("registration.json"), registration);
        c.files.assert(c.path("host-config.json"), selected);
        if (
          fresh
            ? !unpreparedDirectory(c, project)
            : c.inspect().status !== "stopped"
        )
          throw new ContractError("stale");
      };
      const readSecrets = () => {
        const environment = captureEnvironment(process.env);
        const snapshot = readPiSnapshot(
          piSource(agentDir, homedir(), c.store.root, environment),
        );
        let access: readonly string[] = [];
        if (config) {
          const source: TokenSource =
            config.tokenSource === "file" && config.tokenFile
              ? { tokenFile: config.tokenFile }
              : config.tokenSource === "config" && config.tokenFile
                ? {
                    serverConfig: config.tokenFile,
                    token: readServerConfig(config.tokenFile).config.token,
                  }
                : config.tokenSource === "environment" &&
                    process.env.CADENCE_TOKEN
                  ? { environment: process.env.CADENCE_TOKEN }
                  : {};
          access = new AccessMaterial(
            c.files,
            c.directory,
            source,
          ).redactionLiterals();
        }
        return [
          ...this.secrets(),
          ...access,
          ...snapshotLiterals(snapshot, environment),
        ];
      };
      assertCurrent();
      const records = new ConversationRecords({
        coordination: c,
        cwd: project.cwd,
        agentDir,
        secrets: readSecrets,
        assertCurrent,
      });
      view = {
        key,
        records,
        assertCurrent,
        controls: new ConversationControls({
          directory: c.directory,
          files: c.files,
          conversations: records,
          assertCurrent,
        }),
      };
      if (this.views.size >= READERS)
        this.forget(this.views.keys().next().value as string);
      this.views.set(project.id, view);
    }
    view.assertCurrent();
    const { records } = view;
    let result: WorkbenchResult;
    switch (request.kind) {
      case "conversation-context":
        result = {
          kind: request.kind,
          context: new ConversationContextRecords(
            c,
            view.records.sessions,
          ).read(request.location).context,
        };
        break;
      case "conversations": {
        result = view.records.list(
          request.after ?? null,
          request.archived === true,
        );
        if (result.kind === "conversations")
          result = {
            ...result,
            entries: result.entries.map((entry) => ({
              ...entry,
              cadence: view.controls.observe(entry.id).enabled,
            })),
          };
        break;
      }
      case "conversation":
        result = view.records.conversation(
          request.id,
          request.leaf,
          request.known,
        );
        break;
      case "conversation-turn":
        result = view.records.turnSteps(
          request.id,
          request.leaf,
          request.ordinal,
          request.before,
        );
        break;
      case "conversation-image":
        result = view.records.image(request);
        break;
      case "conversation-step":
        result = view.records.step(
          request.id,
          request.leaf,
          request.turnId,
          request.step,
          request.part,
        );
        break;
      case "conversation-tree":
        result = view.records.tree(request.id, request.leaf);
        break;
      case "cadence-conversation":
        result = { kind: request.kind, state: view.controls.state(request.id) };
        break;
      case "files":
      case "file": {
        // The owner's own rule for a conversation directory, minus its lease:
        // same refusals, limits and redaction, and nothing is written.
        const secrets = records.readSecrets();
        const cwd = request.location
          ? new ConversationContextRecords(c, records.sessions).read(
              request.location,
            ).context.cwd
          : project.cwd;
        assertConversationDirectory(c.store.root, cwd, secrets);
        const files = new WorkbenchFiles(
          cwd,
          [c.files.namespace, agentDir],
          () => records.readSecrets(),
        );
        result =
          request.kind === "files"
            ? files.list(request.path)
            : files.read(request.path);
        break;
      }
      default:
        throw new ContractError("invalid");
    }
    // Another process may have started the owner during the read. Do not
    // publish a cold projection (especially "unknown") across that boundary.
    view.assertCurrent();
    return result;
  }
}
