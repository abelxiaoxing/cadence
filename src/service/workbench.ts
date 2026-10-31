/** Composition of independent conversations, readonly files and explicit project opening. */
import { opendirSync } from "node:fs";
import { join } from "node:path";
import { CadencePreferences } from "../cadence-preferences.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { openProjectDirectory } from "./cli.ts";
import {
  ContractError,
  canonicalJson,
  closed,
  parseWireJson,
  text,
} from "./contracts/core.ts";
import {
  decodeWorkbenchCommand,
  decodeWorkbenchRead,
  type WorkbenchCommand,
  type WorkbenchPort,
  type WorkbenchRead,
  type WorkbenchResult,
} from "./contracts/workbench.ts";
import { ConversationWorkflow } from "./conversation-workflow.ts";
import { Conversations } from "./conversations.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { ServiceOwner } from "./owner.ts";
import type { Caller } from "./ports.ts";
import { hash } from "./private-files.ts";
import type { TaskActions } from "./task-actions.ts";
import { WorkbenchFiles } from "./workbench-files.ts";
import { UnacceptedConversationCommand } from "./workbench-send-refusal.ts";
import { Workflows } from "./workflows.ts";

export class Workbench implements WorkbenchPort {
  readonly conversations: Conversations;
  readonly files: WorkbenchFiles;
  readonly workflows: Workflows;
  readonly cadence: ConversationWorkflow;
  private readonly projectRoot: string;
  private readonly opening = new Map<
    string,
    { identity: string; result: Promise<WorkbenchResult> }
  >();
  constructor(
    private readonly o: {
      coordination: ServiceCoordination;
      owner: ServiceOwner;
      models: OwnerModelContext;
      choice: OwnerModelChoice;
      actions: TaskActions;
      cwd: string;
      agentDir: string;
      projectsEnabled: boolean;
      hostUrl: URL;
      secrets(): readonly string[];
      timeoutMs?: number;
      checkEnvironment?: Readonly<NodeJS.ProcessEnv>;
    },
  ) {
    this.conversations = new Conversations(o);
    this.workflows = new Workflows(o);
    this.cadence = new ConversationWorkflow({
      ...o,
      conversations: this.conversations,
      workflows: this.workflows,
    });
    this.cadence.assertRecords();
    for (const entry of this.conversations.list().entries)
      this.cadence.state(entry.id);
    if (
      this.conversations
        .list()
        .entries.some((entry) => entry.status === "unknown")
    )
      throw new ContractError("quarantine");
    this.files = new WorkbenchFiles(
      o.cwd,
      [o.coordination.files.namespace, o.agentDir],
      o.secrets,
    );
    this.projectRoot = join(
      o.coordination.files.namespace,
      "workbench-projects-v1",
    );
  }
  read(value: WorkbenchRead): WorkbenchResult {
    const request = decodeWorkbenchRead(value);
    this.o.owner.lease.assert();
    switch (request.kind) {
      case "cadence-conversation":
        return { kind: request.kind, state: this.cadence.state(request.id) };
      case "workflow-active":
        return this.workflows.activeRuns();
      case "workflow-transcript":
        return this.workflows.transcript(request.id, request.stepId);
      case "workflow-detail":
        return this.workflows.detail(request.id, request.stepId);
      case "workflow":
        return this.workflows.view(request.id);
      case "task-origin":
        return this.conversations.origin(request.taskId);
      case "conversations": {
        const value = this.conversations.list();
        return {
          ...value,
          entries: value.entries.map((entry) => ({
            ...entry,
            cadence: this.cadence.state(entry.id).enabled,
          })),
        };
      }
      case "conversation":
        return this.conversations.view(request.id, request.before);
      case "files":
        return this.files.list(request.path);
      case "file":
        return this.files.read(request.path);
      case "directories":
        return this.files.list(request.path, true);
      case "projects":
        return this.projects();
    }
  }
  private send(
    request: Extract<
      WorkbenchCommand,
      { kind: "send" | "cadence-send" | "cadence-exit" }
    >,
  ): WorkbenchResult {
    let mayHaveEffects = true;
    try {
      const state = this.cadence.state(request.conversationId);
      mayHaveEffects =
        this.o.owner.state !== "idle" ||
        state.head === request.commandId ||
        this.conversations.attempted(request.conversationId, request.commandId);
      const accepting = () => {
        mayHaveEffects = true;
      };
      if (request.kind === "send") {
        if (state.enabled) throw new ContractError("conflict");
        return this.conversations.send(request, undefined, accepting);
      }
      if (request.kind === "cadence-exit")
        return this.cadence.send(
          {
            ...request,
            kind: "cadence-send",
            text: "exit cadence",
            model: this.o.choice.snapshot().version,
            intent: "exit",
          },
          accepting,
        );
      return this.cadence.send(request, accepting);
    } catch (error) {
      if (!mayHaveEffects && error instanceof ContractError)
        throw new UnacceptedConversationCommand(error.code);
      throw error;
    }
  }
  private projects(): WorkbenchResult {
    const secrets = this.o.secrets();
    if (sanitizeText(this.o.cwd, secrets) !== this.o.cwd)
      throw new ContractError("forbidden");
    const entries = [{ path: this.o.cwd, current: true }],
      files = this.o.coordination.files;
    if (!files.directory(this.projectRoot))
      return { kind: "projects", entries };
    const directory = opendirSync(this.projectRoot);
    try {
      for (let e = directory.readSync(); e; e = directory.readSync()) {
        if (
          !e.isFile() ||
          !/^[a-f0-9]{64}\.json$/.test(e.name) ||
          entries.length > 128
        )
          throw new ContractError("corrupt-selected");
        const saved = files.read(join(this.projectRoot, e.name));
        if (!saved) throw new ContractError("corrupt-selected");
        const row = closed(parseWireJson(saved.bytes.toString("utf8")), [
            "path",
          ]),
          path = text(row.path, 4096, true);
        if (`${hash(path)}.json` !== e.name)
          throw new ContractError("corrupt-selected");
        if (path !== this.o.cwd && sanitizeText(path, secrets) === path)
          entries.push({ path, current: false });
      }
    } finally {
      directory.closeSync();
    }
    return { kind: "projects", entries };
  }
  command(
    value: WorkbenchCommand,
    caller?: Caller,
  ): WorkbenchResult | Promise<WorkbenchResult> {
    const request = decodeWorkbenchCommand(value);
    if (request.kind === "restore-model") {
      if (request.epoch !== this.o.owner.lease.registration.epoch)
        throw new ContractError("stale");
      const before = this.o.choice.snapshot();
      if (!before.selected) {
        const choice = new CadencePreferences(this.o.agentDir).read();
        if (!choice) throw new ContractError("unavailable");
        this.o.choice.choose({ expected: before.version, choice });
      }
      return { kind: "accepted", commandId: request.commandId };
    }
    if (
      request.kind === "send" ||
      request.kind === "cadence-send" ||
      request.kind === "cadence-exit"
    )
      return this.send(request);
    if (
      request.kind === "cadence-prepare" ||
      request.kind === "cadence-approve"
    )
      return this.cadence.approval(request, caller);
    if (request.kind === "workflow-cancel") {
      if (!caller) throw new ContractError("forbidden");
      return this.workflows.command(request.commandId, request.epoch, {
        action: "cancel",
        runId: request.runId,
      });
    }
    if (request.kind === "workflow")
      return this.workflows.command(
        request.commandId,
        request.epoch,
        request.request,
      );
    if (request.kind === "link-task") {
      this.conversations.link(
        request.taskId,
        request.conversationId,
        request.epoch,
      );
      return { kind: "accepted", commandId: request.commandId };
    }
    if (request.kind === "interrupt") {
      this.conversations.interrupt(
        request.conversationId,
        request.turnId,
        request.epoch,
      );
      return { kind: "accepted", commandId: request.commandId };
    }
    this.o.owner.lease.assert();
    if (!this.o.projectsEnabled) throw new ContractError("unsupported-context");
    if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
    if (request.epoch !== this.o.owner.lease.registration.epoch)
      throw new ContractError("stale");
    const identity = canonicalJson(request),
      old = this.opening.get(request.commandId);
    if (old) {
      if (old.identity !== identity) throw new ContractError("conflict");
      return old.result;
    }
    // Retain failed/uncertain attempts. Never replay one after eviction/restart.
    if (this.opening.size >= 64) throw new ContractError("capacity");
    const path = this.files.directory(request.path);
    const marker = join(
      this.o.coordination.directory,
      "conversations-v1",
      "project-commands",
      `${request.commandId}.json`,
    );
    const files = this.o.coordination.files;
    if (files.read(marker)) throw new ContractError("receipt-inconclusive");
    if (
      (this.projects() as Extract<WorkbenchResult, { kind: "projects" }>)
        .entries.length >= 128
    )
      throw new ContractError("capacity");
    const result = Promise.resolve().then(
      async (): Promise<WorkbenchResult> => {
        this.o.owner.lease.assert();
        if (this.o.owner.state !== "idle")
          throw new ContractError("quarantine");
        try {
          files.create(marker, identity);
        } catch (error) {
          this.o.owner.quarantine();
          throw error;
        }
        const opened = await openProjectDirectory(
          path,
          this.o.coordination.stateHome,
          this.o.agentDir,
          this.o.hostUrl,
        );
        for (const root of [this.o.cwd, opened.path]) {
          const entry = join(this.projectRoot, `${hash(root)}.json`);
          const saved = files.read(entry);
          if (!saved) files.create(entry, canonicalJson({ path: root }));
          else if (
            saved.bytes.toString("utf8") !== canonicalJson({ path: root })
          )
            throw new ContractError("conflict");
        }
        return { kind: "project", commandId: request.commandId, ...opened };
      },
    );
    this.opening.set(request.commandId, { identity, result });
    // A failed launch can have a live independent owner. Retain the operation's
    // refusal; do not stop/adopt/clean that project as browser error handling.
    this.o.owner.trackAccepted(
      result.then(
        () => ({ status: "settled" }),
        // The directory owner has its own lifetime/locks, just as CLI project
        // open. A navigation refusal must not Stop unrelated current tasks.
        () => ({ status: "settled" }),
      ),
    );
    return result;
  }
}
