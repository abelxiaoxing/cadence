/** Retained conversation views for stopped owners. Never starts an owner, loads
 * Pi, repairs records or treats an unresponsive owner as stopped. */
import { ContractError } from "./contracts/core.ts";
import type { ProjectEntry } from "./contracts/gateway.ts";
import type { WorkbenchRead, WorkbenchResult } from "./contracts/workbench.ts";
import { ConversationContextRecords } from "./conversation-contexts.ts";
import {
  ConversationControls,
  freshCadenceConversation,
} from "./conversation-controls.ts";
import { ConversationRecords } from "./conversation-records.ts";
import { ServiceCoordination } from "./coordination.ts";
import { readHostConfig } from "./runtime.ts";

/** Each reader has its existing bounded history scans/cache. Eviction closes
 * scans, so a stale continuation refuses rather than silently starting over. */
const READERS = 16;
interface View {
  key: string;
  records: ConversationRecords;
  controls: ConversationControls;
  assertCurrent(): void;
}
export function retainedConversationRead(request: WorkbenchRead): boolean {
  return [
    "conversations",
    "conversation",
    "conversation-turn",
    "conversation-step",
    "cadence-conversation",
    "conversation-context",
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
  constructor(private readonly stateHome: string) {}
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
    if (!retainedConversationRead(request)) return undefined;
    const c = new ServiceCoordination(project.path, this.stateHome);
    if (c.store.root !== project.path) throw new ContractError("stale");
    const status = c.inspect().status;
    if (unpreparedDirectory(c, project)) {
      // Only a never-prepared selection can have an empty initial view. A
      // missing established store or a corrupt selection is not a new chat.
      this.forget(project.id);
      switch (request.kind) {
        case "conversation-context":
          return {
            kind: request.kind,
            context: new ConversationContextRecords(c).read(request.location)
              .context,
          };
        case "conversations":
          if (request.scan || request.after) throw new ContractError("stale");
          return { kind: "conversations", entries: [], next: null };
        case "conversation":
          return { kind: "conversation", summary: null, turns: 0 };
        case "cadence-conversation":
          return {
            kind: request.kind,
            state: freshCadenceConversation(request.id),
          };
        default:
          throw new ContractError("stale");
      }
    }
    if (status !== "stopped") {
      this.forget(project.id);
      // Live or inconclusive: only the real owner knows its original work.
      return undefined;
    }
    const registration = c.files.read(c.path("registration.json"));
    const selected = c.files.read(c.path("host-config.json"));
    const config = readHostConfig(c);
    if (!registration || !selected || !config)
      throw new ContractError("corrupt-selected");
    const key = `${registration.stamp}:${selected.stamp}`;
    let view = this.views.get(project.id);
    if (view?.key !== key) {
      this.forget(project.id);
      const assertCurrent = () => {
        c.files.assert(c.path("registration.json"), registration);
        c.files.assert(c.path("host-config.json"), selected);
        if (c.inspect().status !== "stopped") throw new ContractError("stale");
      };
      assertCurrent();
      const records = new ConversationRecords({
        directory: c.directory,
        files: c.files,
        cwd: c.store.root,
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
    let result: WorkbenchResult;
    switch (request.kind) {
      case "conversation-context":
        result = {
          kind: request.kind,
          context: new ConversationContextRecords(c).read(request.location)
            .context,
        };
        break;
      case "conversations": {
        result = view.records.list(request.after ?? null, request.scan);
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
        result = view.records.conversation(request.id);
        break;
      case "conversation-turn":
        result = view.records.turnSteps(
          request.id,
          request.ordinal,
          request.before,
        );
        break;
      case "conversation-step":
        result = view.records.step(
          request.id,
          request.turnId,
          request.step,
          request.part,
        );
        break;
      case "cadence-conversation":
        result = { kind: request.kind, state: view.controls.state(request.id) };
        break;
      default:
        throw new ContractError("invalid");
    }
    // Another process may have started the owner during the read. Do not
    // publish a cold projection (especially "unknown") across that boundary.
    view.assertCurrent();
    return result;
  }
}
