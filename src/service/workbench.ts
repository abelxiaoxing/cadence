/** Composition of independent conversations, readonly files and explicit project opening. */
import { opendirSync } from "node:fs";
import { join } from "node:path";
import { CadencePreferences } from "../cadence-preferences.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { activityReaderScope } from "./activity-files.ts";
import type { CheckoutGate } from "./checkout-gate.ts";
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
import type { ConversationContexts } from "./conversation-contexts.ts";
import { ConversationImages } from "./conversation-images.ts";
import { ConversationWorkflow } from "./conversation-workflow.ts";
import { Conversations } from "./conversations.ts";
import type { ServiceCoordination } from "./coordination.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { OwnerModelContext } from "./model-context.ts";
import type { ServiceOwner } from "./owner.ts";
import type { Caller } from "./ports.ts";
import { hash } from "./private-files.ts";
import { WorkbenchFiles } from "./workbench-files.ts";
import { UnacceptedConversationCommand } from "./workbench-send-refusal.ts";
import { Workflows } from "./workflows.ts";

export class Workbench implements WorkbenchPort {
  readonly images = new ConversationImages();
  readonly conversations: Conversations;
  readonly contexts: ConversationContexts;
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
      gate: CheckoutGate;
      cwd: string;
      agentDir: string;
      projectsEnabled: boolean;
      hostUrl: URL;
      secrets(): readonly string[];
      checkEnvironment?: Readonly<NodeJS.ProcessEnv>;
      /** Workflow workers of one run in flight at once (`CADENCE_PARALLEL`). */
      parallel?: number;
      /** Where the project's Pi sessions live; defaults to Pi's own resolution. */
      sessionDir?: string;
    },
  ) {
    this.conversations = new Conversations(o);
    this.contexts = this.conversations.contexts;
    this.workflows = new Workflows({ ...o, contexts: this.contexts });
    this.cadence = new ConversationWorkflow({
      ...o,
      contexts: this.contexts,
      conversations: this.conversations,
      workflows: this.workflows,
    });
    // Control records are not a startup gate: one unusable record degrades
    // only its own conversation (see ConversationWorkflow.read).
    this.conversations.assertSettled();
    this.files = new WorkbenchFiles(
      o.coordination.store.root,
      [o.coordination.files.namespace, o.agentDir],
      o.secrets,
    );
    this.projectRoot = join(
      o.coordination.files.namespace,
      "workbench-projects-v1",
    );
  }
  activityReaderScope() {
    return activityReaderScope(this.o.agentDir, this.o.sessionDir);
  }
  activity() {
    this.o.owner.lease.assert();
    return [...this.conversations.activity(), ...this.workflows.activity()];
  }
  closeReads(): void {
    this.images.clear();
    this.workflows.closeHistory();
    this.conversations.records.closeReads();
  }
  read(value: WorkbenchRead): WorkbenchResult {
    const request = decodeWorkbenchRead(value);
    this.o.owner.lease.assert();
    switch (request.kind) {
      case "conversation-context":
        return {
          kind: request.kind,
          context: this.contexts.records.read(request.location).context,
        };
      case "conversation-models":
        return {
          kind: request.kind,
          catalog: this.contexts.catalog(request.location),
        };
      case "cadence-conversation":
        return {
          kind: request.kind,
          state: this.cadence.records.state(request.id),
        };
      case "workflow-active": {
        const active = this.workflows.activeRuns();
        // Admission identity is authoritative; copied/forked history is not.
        const links = active.runs.flatMap((run) => {
          const context = run.execution;
          const location = context?.version.conversation;
          return location &&
            context?.checkoutRoot === this.o.coordination.store.root &&
            context.version.epoch === run.epoch &&
            context.cwd === location.cwd
            ? [{ runId: run.id, conversationId: location.id }]
            : [];
        });
        return { ...active, links };
      }
      case "workflow-history":
        return this.workflows.history(request.after, request.scan);
      case "workflow-transcript":
        return this.workflows.transcript(request.id, request.stepId);
      case "workflow-detail":
        return this.workflows.detail(request.id, request.stepId);
      case "workflow":
        return this.workflows.view(request.id, request.before);
      case "conversation-active":
      case "conversations": {
        const value =
          request.kind === "conversation-active"
            ? this.conversations.records.activeConversations()
            : this.conversations.records.list(request.after ?? null);
        if (
          value.kind !== "conversations" &&
          value.kind !== "conversation-active"
        )
          return value;
        return {
          ...value,
          entries: value.entries.map((entry) => ({
            ...entry,
            cadence: this.cadence.records.observe(entry.id).enabled,
          })),
        };
      }
      case "conversation":
        return this.conversations.records.conversation(
          request.id,
          request.leaf,
          request.known,
        );
      case "conversation-turn":
        return this.conversations.records.turnSteps(
          request.id,
          request.leaf,
          request.ordinal,
          request.before,
        );
      case "conversation-image":
        return this.conversations.records.image(request);
      case "conversation-step":
        return this.conversations.records.step(
          request.id,
          request.leaf,
          request.turnId,
          request.step,
          request.part,
        );
      case "conversation-tree":
        return this.conversations.records.tree(request.id, request.leaf);
      case "files":
      case "file": {
        const cwd = this.contexts.directory(request.location);
        const files = new WorkbenchFiles(
          cwd,
          [this.o.coordination.files.namespace, this.o.agentDir],
          this.o.secrets,
        );
        return request.kind === "files"
          ? files.list(request.path)
          : files.read(request.path);
      }
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
    caller?: Caller,
  ): WorkbenchResult {
    const claimImages = () =>
      request.kind === "cadence-exit" ? [] : this.images.claim(request, caller);
    let mayHaveEffects = true;
    try {
      const state = this.cadence.records.state(request.conversationId);
      mayHaveEffects =
        this.o.owner.state !== "idle" ||
        state.head === request.commandId ||
        this.conversations.attempted(request.conversationId, request.commandId);
      const accepting = () => {
        mayHaveEffects = true;
      };
      if (request.kind === "send") {
        // A lost reply observes its original acceptance before mode checks.
        const receipt = this.conversations.receipt(request);
        if (receipt) return receipt;
        if (state.notice) throw new ContractError("corrupt-selected");
        if (state.enabled) throw new ContractError("conflict");
        return this.conversations.send(
          request,
          undefined,
          accepting,
          claimImages,
        );
      }
      if (request.kind === "cadence-exit")
        return this.cadence.send(
          {
            ...request,
            kind: "cadence-send",
            text: "exit cadence",
            model: request.location
              ? this.contexts.snapshot(request.location).version
              : this.o.choice.snapshot().version,
            intent: "exit",
          },
          accepting,
        );
      return this.cadence.send(request, accepting, claimImages);
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
    if (request.kind === "image-upload") {
      this.o.owner.lease.assert();
      if (this.o.owner.state !== "idle") throw new ContractError("quarantine");
      this.contexts.capture(request.send.model);
      if (
        request.send.model.conversation &&
        request.send.model.conversation.id !== request.send.conversationId
      )
        throw new ContractError("stale");
      return this.images.upload(request, caller);
    }
    if (request.kind === "conversation-model")
      return {
        kind: request.kind,
        commandId: request.commandId,
        choice: this.contexts.choose(
          request.location,
          request.expected,
          request.choice,
        ),
      };
    if (request.kind === "restore-model") {
      if (request.epoch !== this.o.owner.lease.registration.epoch)
        throw new ContractError("stale");
      if (request.location) {
        this.contexts.restore(
          request.location,
          request.expected,
          request.choice,
        );
        return { kind: "accepted", commandId: request.commandId };
      }
      const before = this.o.choice.snapshot();
      if (!before.selected) {
        let choice: ReturnType<CadencePreferences["read"]>;
        try {
          choice = new CadencePreferences(this.o.agentDir).read();
        } catch {
          // An unreadable or unsupported preference is reported, never replaced.
          throw new ContractError("unavailable");
        }
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
      return this.send(request, caller);
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
      // The native route reports a provably effect-free refusal as such.
      return this.workflows.command(
        request.commandId,
        request.epoch,
        request.request,
        { definite: true },
      );
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
