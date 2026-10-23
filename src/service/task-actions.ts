/** One authoritative action owner composed by the real service host. */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { currentChecks } from "../history/checks.ts";
import type { PublishedPlan } from "../history/plans.ts";
import { assertPlanContent, proposePlanContent } from "../history/plans.ts";
import type { ReviewContext } from "../history/review.ts";
import { reviewIssues } from "../history/review.ts";
import {
  type Action,
  type ActionPreview,
  type ActiveRuns,
  type CancelCommand,
  type ContentRef,
  type ContextVersion,
  ContractError,
  type ControlContext,
  type CurrentChanges,
  type CurrentRequest,
  type CurrentView,
  canonicalJson,
  decodeActiveRuns,
  decodeCurrentChanges,
  decodeCurrentChangesRequest,
  decodeCurrentRequest,
  decodeCurrentView,
  decodePreview,
  type Graph,
  LIMITS,
  type ModelSelection,
  type OwnerLink,
  type OwnerRecordingEvent,
  publicError,
  type Receipt,
  roleForPurpose,
  type SavedGraphSelection,
} from "../service-contract.ts";
import { captureChanges } from "../task-diff.ts";
import { resolveWorkspace } from "../task-store.ts";
import type { TaskRecord } from "../task-types.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import { ActionAdmission } from "./admission.ts";
import { GraphContext } from "./graph.ts";
import type { ServiceHost } from "./host.ts";
import type { OwnerModelChoice } from "./model-choice.ts";
import type { AcceptedWorkResult } from "./owner.ts";
import type {
  AdmissionCommit,
  AdmissionIntent,
  AdmissionOwner,
} from "./ports.ts";
import { hash } from "./private-files.ts";
import { readHostConfig } from "./runtime.ts";
import { type ReviewBarrier, recordOwner, TaskScheduler } from "./scheduler.ts";

interface ActionDependencies {
  host: Pick<
    ServiceHost,
    | "coordination"
    | "owner"
    | "writer"
    | "reader"
    | "models"
    | "access"
    | "checkEnvironment"
  >;
  cwd: string;
  ownerSecrets: readonly string[];
  workerTimeoutMs?: number;
  /** Monotonic policy-clock injection only; never changes native/read/auth budgets. */
  policyClock?: () => number;
}
export type TaskActionsOptions = ActionDependencies &
  (
    | { selection: ModelSelection; choice?: never }
    | { choice: OwnerModelChoice; selection?: never }
  );
const actionOwners = new WeakSet<ServiceHost["owner"]>();
/** One operation's folds of its own fixed committed snapshot, read once and
 * treated as read-only. A failed read is not kept. Raw task bytes, changes,
 * configuration, choice, barrier and active work stay outside and are checked
 * on every validation; a later operation folds again. */
type SnapshotReads = <T>(key: string, read: () => T) => T;
function snapshotReads(): SnapshotReads {
  const kept = new Map<string, unknown>();
  return <T>(key: string, read: () => T): T => {
    if (!kept.has(key)) kept.set(key, read());
    return kept.get(key) as T;
  };
}
export class TaskActions implements AdmissionOwner {
  readonly admission: ActionAdmission;
  readonly scheduler: TaskScheduler;
  private readonly sources: GraphContext;
  private readonly cwd: string;
  private readonly launchCwd: string;
  private readonly checkEnvironment: Readonly<NodeJS.ProcessEnv>;
  private readonly cwdId = randomUUID();
  private generation = 0;
  private readonly checkEnvGeneration = 1;
  private readonly legacyConfigRev: number;
  private checkDefinitions = "";
  private checksRevision = 0;
  private readonly metadata = new Map<string, Promise<AcceptedWorkResult>>();
  private readonly accepted = new Map<
    string,
    {
      intent: AdmissionIntent;
      committed: boolean;
      activated: boolean;
      original: Promise<AcceptedWorkResult>;
      activate(work: Promise<AcceptedWorkResult> | null): void;
    }
  >();
  private closed = false;
  private reviewRevision = 0;
  private readonly reviewVersions = new Map<
    string,
    { signature: string; revision: number }
  >();
  private readonly reviewing = new Map<
    string,
    (published?: { revision: number; identity: string }) => ReviewContext
  >();
  private readonly drafts = new Map<
    string,
    { identity: string; graph: Graph }
  >();
  private committed: { intent: AdmissionIntent; previousSeq: string } | null =
    null;
  constructor(private readonly options: TaskActionsOptions) {
    if (actionOwners.has(options.host.owner))
      throw new ContractError("conflict");
    this.options = options.choice
      ? { ...options, ownerSecrets: [...options.ownerSecrets] }
      : {
          ...options,
          selection: structuredClone(options.selection),
          ownerSecrets: [...options.ownerSecrets],
        };
    this.cwd = realpathSync(options.cwd);
    const config = readHostConfig(options.host.coordination);
    if (!config || realpathSync(config.cwd) !== this.cwd)
      throw new ContractError("unsupported-context");
    this.launchCwd = config.cwd;
    this.checkEnvironment = options.host.checkEnvironment;
    if (!Object.isFrozen(this.checkEnvironment))
      throw new ContractError("unsupported-context");
    if (
      resolveWorkspace(this.cwd).root !== options.host.coordination.store.root
    )
      throw new ContractError("conflict");
    this.sources = new GraphContext(options.host.coordination.store.root);
    this.legacyConfigRev = options.host.writer.configurationRevisionFloor + 1;
    const initial = this.choiceSnapshot();
    if (initial.selection) options.host.models.assertCurrent(initial.selection);
    actionOwners.add(options.host.owner);
    this.scheduler = new TaskScheduler({
      ...options.host,
      ownerSecrets: options.ownerSecrets,
      workerTimeoutMs: options.workerTimeoutMs,
      now: options.policyClock,
    });
    this.admission = new ActionAdmission(
      {
        reservedIdentity: (id) => options.host.writer.reservedIdentity(id),
        lookup: (id) => options.host.writer.lookup(id),
        lookupForAdmission: (id) => options.host.writer.lookupForAdmission(id),
        commit: (intent) => this.commit(intent),
      },
      this,
      { now: () => Date.now(), uuid: () => randomUUID() },
    );
    options.host.writer.bindReviewContext((taskId, published) => {
      const current = this.reviewing.get(taskId);
      if (!current) throw new ContractError("unavailable");
      return current(published);
    });
    options.host.owner.registerActions(() => this.quiesce(), {
      assertQuiescent: () => {
        if (this.closed) throw new ContractError("quarantine");
        if (
          this.admission.accounting.count ||
          this.admission.accounting.unresolved ||
          this.accepted.size ||
          this.metadata.size ||
          this.reviewing.size
        )
          throw new ContractError("conflict");
        this.scheduler.assertQuiescent();
        // Immutable legacy clients cannot silently retarget. Only the actual
        // nullable choice consumer can cross this final configuration barrier.
        if (!this.options.choice) throw new ContractError("unavailable");
      },
      changed: () => this.admission.revokeGrants(),
    });
  }
  private commit(intent: AdmissionIntent): Promise<AdmissionCommit> {
    const h = this.options.host;
    if (intent.identity.kind !== "action") return h.writer.commit(intent);
    this.assertChoice(intent.identity.expected);
    let report!: (result: AdmissionCommit) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<AdmissionCommit>((yes, no) => {
      report = yes;
      reject = no;
    });
    let activate!: (work: Promise<AcceptedWorkResult> | null) => void;
    const activated = new Promise<AcceptedWorkResult | null>((yes) => {
      activate = yes;
    });
    // This original spans commit, the post-commit freshness observation, and
    // activation. A Stop in the gap cannot observe an empty native roster as idle.
    const original = Promise.resolve()
      .then(async (): Promise<AcceptedWorkResult> => {
        const previousSeq = h.writer.committedSeq;
        const committed = await h.writer.commit(intent);
        if (committed.status !== "committed") {
          report(committed);
          // A bounded report can precede the ORIGINAL admission write. Queue the
          // nonapplication observation on the same writer behind that original:
          // a late accepted commit must not remain apparently pending forever.
          // If only a partial intent exists, this refuses without fabricating an
          // acceptance, candidate or run. Safety originals remain owner-tracked.
          if (committed.status === "uncertain")
            await h.writer.abandonPublication(intent.operationId);
          return {
            status: committed.status === "uncertain" ? "uncertain" : "settled",
          };
        }
        const tracked = this.accepted.get(intent.operationId);
        if (!tracked) throw new ContractError("conflict");
        tracked.committed = true;
        this.committed = { intent, previousSeq };
        report(committed);
        const outcome = await activated;
        if (outcome) return outcome;
        await h.writer.abandonPublication(intent.operationId);
        return { status: "uncertain" };
      })
      .catch(async (error): Promise<AcceptedWorkResult> => {
        reject(error);
        this.quarantine("activation");
        return { status: "uncertain" };
      })
      .finally(() => {
        this.accepted.delete(intent.operationId);
      });
    const tracked = {
      intent,
      committed: false,
      activated: false,
      original,
      activate: (work: Promise<AcceptedWorkResult> | null) => {
        tracked.activated = true;
        activate(work);
      },
    };
    this.accepted.set(intent.operationId, tracked);
    h.owner.trackAccepted(original); // BEFORE the first commit/activation microtask
    return result;
  }
  async settledAll(): Promise<void> {
    await Promise.all([...this.accepted.values()].map((a) => a.original));
  }
  currentAccess() {
    return {
      epoch: this.options.host.owner.lease.registration.epoch,
      accessGeneration: this.options.host.access.generation,
    };
  }
  private alive(): void {
    if (
      this.closed ||
      this.options.host.owner.state !== "idle" ||
      this.options.host.writer.quarantined
    )
      throw new ContractError("quarantine");
    this.options.host.owner.lease.assert();
    if (
      !this.sources.current() ||
      realpathSync(this.cwd) !== this.cwd ||
      realpathSync(this.launchCwd) !== this.cwd ||
      this.options.host.checkEnvironment !== this.checkEnvironment
    )
      throw new ContractError("stale");
  }
  private choiceSnapshot() {
    const state = this.options.choice?.snapshot();
    const access = this.currentAccess();
    if (
      state &&
      (state.version.epoch !== access.epoch ||
        state.version.accessGeneration !== access.accessGeneration)
    )
      throw new ContractError("stale");
    const configRev = state?.version.configRev ?? this.legacyConfigRev;
    if (
      !Number.isSafeInteger(configRev) ||
      configRev < this.options.host.writer.configurationRevisionFloor
    )
      throw new ContractError("stale");
    return {
      selection: state ? state.selected : (this.options.selection ?? null),
      configRev,
      checkEnvGeneration: this.checkEnvGeneration,
    };
  }
  private requireChoice() {
    this.alive();
    const choice = this.choiceSnapshot();
    if (!choice.selection) throw new ContractError("unavailable");
    this.options.host.models.assertCurrent(choice.selection);
    return { ...choice, selection: choice.selection };
  }
  private assertChoice(version: ContextVersion): void {
    const choice = this.requireChoice();
    if (
      canonicalJson(choice.selection) !== canonicalJson(version.model) ||
      choice.configRev !== version.configRev ||
      choice.checkEnvGeneration !== version.checkEnvGeneration
    )
      throw new ContractError("stale");
  }
  /** Historical descriptor alone is not enough: require selected current raw v1 publication. */
  savedGraph(
    taskId: string,
    snapshot = this.options.host.writer.committedSeq,
  ): PublishedPlan | null {
    const h = this.options.host,
      saved = h.coordination.store.loadSnapshot(taskId);
    if (!saved) throw new ContractError("stale");
    return h.reader.publishedPlan(taskId, snapshot, {
      identity: saved.identity,
      revision: saved.record.revision,
      plan: saved.record.plan,
    });
  }
  private defaultGraph(
    record: TaskRecord,
    identity: string,
    selection: ModelSelection,
  ): Graph {
    identity = canonicalJson({ identity, selection });
    const old = this.drafts.get(record.id);
    if (old?.identity === identity) return old.graph;
    const purpose = record.kind === "code" ? "edit" : record.kind;
    const role = this.sources.roles.find(
      (r) => r.role === roleForPurpose(purpose),
    );
    if (!role) throw new ContractError("unavailable");
    const graph: Graph = {
      schema: "cadence-graph/2",
      taskId: record.id,
      taskKind: record.kind,
      taskRevision: record.revision,
      revision: 1,
      planRevision: 1,
      plan: proposePlanContent(record.plan, 1, this.options.ownerSecrets),
      assignments: [
        {
          id: "task",
          purpose,
          instructions:
            "Perform the explicitly reviewed task and report observations.",
          expectedOutput: "Report the result and remaining uncertainty.",
          role: { role: roleForPurpose(purpose), sha256: role.sha256 },
          model: selection,
          dependencies: [],
        },
      ],
    };
    if (this.drafts.size >= 16)
      this.drafts.delete(this.drafts.keys().next().value ?? "");
    this.drafts.set(record.id, { identity, graph });
    return graph;
  }
  /** Actual configured obligations source for later ReadEnvironment composition. */
  checks(taskId: string) {
    if (!this.options.host.coordination.store.loadSnapshot(taskId))
      throw new ContractError("stale");
    const selections = this.configuredChecks();
    const identity = canonicalJson(selections);
    if (identity !== this.checkDefinitions) {
      this.checkDefinitions = identity;
      this.checksRevision++;
    }
    return { revision: this.checksRevision, selections };
  }
  private configuredChecks() {
    const selections = this.options.host.coordination.store
      .checks()
      .map((c) => ({ kind: "configured" as const, ...c }));
    const identity = canonicalJson(selections);
    if (sanitizeText(identity, this.viewSecrets()) !== identity)
      throw new ContractError("unsupported-context");
    return selections;
  }
  private viewSecrets(): readonly string[] {
    const h = this.options.host;
    return [
      ...this.options.ownerSecrets,
      ...h.access.redactionLiterals(),
      h.coordination.localAccess().capability,
      ...h.models.viewRedactionLiterals(),
    ];
  }
  private checkSecrets(
    selection = this.requireChoice().selection,
  ): readonly string[] {
    const h = this.options.host;
    return [
      ...this.options.ownerSecrets,
      ...h.access.redactionLiterals(),
      h.coordination.localAccess().capability,
      ...h.models.redactionLiterals(selection),
    ];
  }
  /** One synchronous observation: no await between source snapshot and revalidation.
   * Both current readers and action previews use these exact identities. */
  private observeCurrent(
    taskId: string | null,
    snapshot?: string,
    legacyStart = false,
  ) {
    this.alive();
    const h = this.options.host,
      choice = this.choiceSnapshot();
    const access = this.currentAccess();
    const committedSeq = snapshot ?? h.writer.committedSeq;
    const selected = taskId ? h.coordination.store.loadSnapshot(taskId) : null;
    if (taskId && !selected) throw new ContractError("stale");
    if (selected && realpathSync(selected.record.cwd) !== this.cwd)
      throw new ContractError("unsupported-context");
    const secrets = this.viewSecrets();
    const roles = this.sources.roles.map(({ role, sha256 }) => ({
      role,
      sha256,
    }));
    if (sanitizeText(canonicalJson(roles), secrets) !== canonicalJson(roles))
      throw new ContractError("unsupported-context");
    const plan = selected ? sanitizeText(selected.record.plan, secrets) : null;
    const editable = selected ? plan === selected.record.plan : true;
    let descriptor: PublishedPlan | null = null;
    let unavailable: import("../service-contract.ts").PublicError | null = null;
    let saved: SavedGraphSelection = { status: "none" };
    if (selected) {
      try {
        descriptor = this.savedGraph(selected.record.id, committedSeq);
        if (descriptor)
          saved = {
            status: "saved",
            planRevision: descriptor.graph.planRevision,
            request: {
              storeId: h.reader.storeId,
              scope: { kind: "task", id: selected.record.id },
              snapshotSeq: committedSeq,
              graph: descriptor.reference,
            },
          };
      } catch (error) {
        unavailable = publicError(
          error instanceof ContractError ? error.code : "unavailable",
        );
        saved = { status: "unavailable", error: unavailable };
      }
    }
    if (choice.selection) h.models.assertCurrent(choice.selection);
    const graph =
      descriptor?.graph ??
      (!unavailable &&
      editable &&
      selected &&
      choice.selection &&
      (this.options.choice || legacyStart)
        ? this.defaultGraph(
            selected.record,
            selected.identity,
            choice.selection,
          )
        : null);
    const changes = captureChanges(h.coordination.store.root);
    const observation = {
      identity: changes.fingerprint,
      complete: changes.complete,
      checkoutGeneration: this.generation,
    };
    if (!editable) unavailable ??= publicError("unsupported-context");
    const context: ControlContext =
      choice.selection && !unavailable
        ? {
            status: "available",
            version: {
              ...access,
              configRev: choice.configRev,
              controlRev: h.writer.controlRevision(taskId),
              workspaceId: h.reader.files.format.workspaceId,
              cwdId: this.cwdId,
              model: choice.selection,
              checkEnvGeneration: choice.checkEnvGeneration,
              checkoutGeneration: this.generation,
              observation: {
                identity: observation.identity,
                complete: observation.complete,
              },
              task: selected
                ? {
                    id: selected.record.id,
                    kind: selected.record.kind,
                    revision: selected.record.revision,
                    identity: selected.identity,
                    graphRevision: graph?.revision ?? null,
                    graphIdentity: graph ? hash(canonicalJson(graph)) : null,
                  }
                : null,
            },
          }
        : {
            status: "unavailable",
            workspaceId: h.reader.files.format.workspaceId,
            taskId,
            error: unavailable ?? publicError("unavailable"),
          };
    const view = decodeCurrentView({
      request: { storeId: h.reader.storeId, taskId },
      workspaceId: h.reader.files.format.workspaceId,
      epoch: access.epoch,
      committedSeq,
      context,
      task: selected
        ? {
            id: selected.record.id,
            kind: selected.record.kind,
            revision: selected.record.revision,
            identity: selected.identity,
          }
        : null,
      roles,
      readablePlan: selected
        ? {
            source: "current-v1",
            text: plan,
            editable,
            coverage: {
              observed: "complete",
              source: "complete",
              redacted: !editable,
              omissions: [],
            },
          }
        : null,
      savedGraph: saved,
    });
    // Even synchronous readers can reenter or observe external source changes.
    // Consumers must also call this after their final check/review derivation.
    // Private literals are reobserved even with NO selected model; selected-model
    // freshness alone cannot attest that all text was sanitized with current data.
    const assertCurrent = () => {
      this.alive();
      if (canonicalJson(secrets) !== canonicalJson(this.viewSecrets()))
        throw new ContractError("stale");
      if (choice.selection) h.models.assertCurrent(choice.selection);
      const latest = taskId ? h.coordination.store.loadSnapshot(taskId) : null;
      if (
        latest?.identity !== selected?.identity ||
        canonicalJson(choice) !== canonicalJson(this.choiceSnapshot()) ||
        canonicalJson(access) !== canonicalJson(this.currentAccess()) ||
        (context.status === "available" &&
          (h.writer.controlRevision(taskId) !== context.version.controlRev ||
            this.generation !== context.version.checkoutGeneration))
      )
        throw new ContractError("stale");
    };
    assertCurrent();
    return {
      view,
      selected,
      graph,
      changes,
      observation,
      secrets,
      assertCurrent,
    };
  }
  current(input: CurrentRequest, signal?: AbortSignal): CurrentView {
    const request = decodeCurrentRequest(input);
    if (signal?.aborted) throw new ContractError("unavailable");
    if (request.storeId !== this.options.host.reader.storeId)
      throw new ContractError("stale");
    return this.observeCurrent(request.taskId).view;
  }
  currentChanges(input: CurrentRequest, signal?: AbortSignal): CurrentChanges {
    const request = decodeCurrentChangesRequest(input);
    if (signal?.aborted) throw new ContractError("unavailable");
    if (request.storeId !== this.options.host.reader.storeId)
      throw new ContractError("stale");
    const { view, changes, observation, secrets } = this.observeCurrent(
      request.taskId,
    );
    const text = sanitizeText(changes.text, secrets);
    return decodeCurrentChanges({
      request,
      workspaceId: view.workspaceId,
      epoch: view.epoch,
      committedSeq: view.committedSeq,
      context: view.context,
      task: view.task,
      observation,
      text,
      git: changes.git,
      coverage: {
        observed: "complete",
        source: changes.complete ? "complete" : "limited",
        redacted: text !== changes.text,
        omissions: changes.complete ? [] : ["source-limit"],
      },
    });
  }
  activeRuns(signal?: AbortSignal): ActiveRuns {
    if (signal?.aborted) throw new ContractError("unavailable");
    const h = this.options.host;
    h.owner.lease.assert();
    const base = {
      storeId: h.reader.storeId,
      workspaceId: h.reader.files.format.workspaceId,
      epoch: this.currentAccess().epoch,
    };
    const runs = this.scheduler.activeRefs();
    for (const a of this.accepted.values()) {
      const { intent } = a;
      if (
        !intent.runId ||
        intent.identity.kind !== "action" ||
        !intent.identity.expected.task
      )
        continue;
      if (!a.committed)
        return decodeActiveRuns({
          ...base,
          status: "unavailable",
          error: publicError("receipt-inconclusive"),
        });
      const kind = intent.identity.action.kind;
      if (kind !== "start" && kind !== "generate-plan" && kind !== "check")
        throw new ContractError("conflict");
      if (!runs.some((r) => r.runId === intent.runId))
        runs.push({
          taskId: intent.identity.expected.task.id,
          runId: intent.runId,
          operationId: intent.operationId,
          epoch: intent.identity.expected.epoch,
          kind,
          stage:
            this.closed || a.activated ? "draining" : "accepted-unallocated",
        });
    }
    return decodeActiveRuns({ ...base, status: "complete", runs });
  }
  /** Actual callbacks for the existing retained projector, not another reducer. */
  context(taskId: string): ControlContext {
    return this.current({ storeId: this.options.host.reader.storeId, taskId })
      .context;
  }
  workspace() {
    const { view, secrets } = this.observeCurrent(null);
    return {
      rootLabel: diagnosticText(
        sanitizeText(this.options.host.coordination.store.root, secrets),
        4096,
      ),
      context: view.context,
      models:
        view.context.status === "available" ? [view.context.version.model] : [],
      activeRuns: this.activeRuns(),
    };
  }
  checkObligations(taskId: string) {
    const { view, assertCurrent } = this.observeCurrent(taskId);
    if (!view.task) throw new ContractError("stale");
    const checks = this.obligationsFor(
      taskId,
      view.task.kind,
      view.context,
      view.committedSeq,
    ).checks;
    assertCurrent();
    return checks;
  }
  private obligations(
    version: ContextVersion,
    snapshot: string,
    reads?: SnapshotReads,
  ) {
    if (!version.task) throw new ContractError("stale");
    return this.obligationsFor(
      version.task.id,
      version.task.kind,
      { status: "available", version },
      snapshot,
      reads,
    );
  }
  private obligationsFor(
    taskId: string,
    kind: TaskRecord["kind"],
    context: ControlContext,
    snapshot: string,
    reads?: SnapshotReads,
  ) {
    const configured = this.checks(taskId);
    const selections =
      kind === "code"
        ? configured
        : { revision: configured.revision, selections: [] };
    const fold = () =>
      currentChecks(
        this.options.host.reader.files,
        taskId,
        selections,
        context,
        snapshot,
      );
    // Keyed by every input, so a configuration change folds again.
    const state = reads
      ? reads(
          `checks:${canonicalJson({ taskId, selections, context, snapshot })}`,
          fold,
        )
      : fold();
    if (canonicalJson(configured) !== canonicalJson(this.checks(taskId)))
      throw new ContractError("stale");
    // An unavailable viewer conservatively projects a passed check as stale,
    // but that display is not a change to its actual execution/freshness facts.
    // In particular, our pending publication can make a concurrent viewer
    // unavailable between acceptance and post-commit validation. Do not let
    // that readonly observation invalidate an unchanged accepted action.
    if (context.status !== "available")
      return {
        ...state,
        checks: {
          ...state.checks,
          revision:
            this.reviewVersions.get(taskId)?.revision ?? configured.revision,
        },
      };
    const signature = canonicalJson({ configured, ...state });
    let prior = this.reviewVersions.get(taskId);
    if (!prior || prior.signature !== signature) {
      if (this.reviewVersions.size >= 16 && !prior)
        this.reviewVersions.delete(
          this.reviewVersions.keys().next().value ?? "",
        );
      if (!Number.isSafeInteger(this.reviewRevision + 1))
        throw new ContractError("capacity");
      prior = { signature, revision: ++this.reviewRevision };
      this.reviewVersions.set(taskId, prior);
    }
    return { ...state, checks: { ...state.checks, revision: prior.revision } };
  }
  async observe(action: Action): Promise<ActionPreview> {
    const h = this.options.host;
    const taskId = action.kind === "create" ? null : action.taskId;
    if (this.metadata.size >= 16 || this.metadata.has(taskId ?? "workspace"))
      throw new ContractError("conflict");
    const pending = this.committed;
    const ownAcceptance =
      pending?.intent.identity.kind === "action" &&
      canonicalJson(pending.intent.identity.action) === canonicalJson(action);
    const current = this.observeCurrent(
      taskId,
      ownAcceptance ? pending.previousSeq : undefined,
      action.kind === "start",
    );
    const { selected, graph, changes } = current;
    if (current.view.context.status !== "available")
      throw new ContractError(current.view.context.error.code);
    const version = current.view.context.version;
    const selection = version.model;
    if (action.kind === "save-plan") {
      assertPlanContent(action.plan, action.graph.plan, current.secrets);
      this.sources.validate(action.graph, selection);
      if (
        sanitizeText(canonicalJson(action), current.secrets) !==
        canonicalJson(action)
      )
        throw new ContractError("invalid");
    }
    if (
      action.kind === "create" &&
      sanitizeText(action.goal, current.secrets) !== action.goal
    )
      throw new ContractError("invalid");
    if (action.kind === "generate-plan") {
      if (selected?.record.kind !== "code")
        throw new ContractError("forbidden");
      this.scheduler.assertCapacity(1);
      this.sources.planningRequest(
        selected.record,
        selection,
        randomUUID(),
        randomUUID(),
      );
    }
    if (action.kind === "check") {
      if (selected?.record.kind !== "code")
        throw new ContractError("forbidden");
      if (selected.record.checks.length >= 32)
        throw new ContractError("capacity");
      this.scheduler.assertCapacity(0);
      if (
        sanitizeText(canonicalJson(action.check), this.checkSecrets()) !==
        canonicalJson(action.check)
      )
        throw new ContractError("invalid");
    }
    if (action.kind === "start") {
      if (!graph || !selected) throw new ContractError("unsupported-context");
      this.sources.validate(graph, selection);
      this.scheduler.assertCapacity(graph.assignments.length);
      // Exact public request bound before auth. Actual handoff is checked at dispatch.
      for (const assignment of graph.assignments)
        this.sources.request(
          selected.record,
          graph,
          randomUUID(),
          randomUUID(),
          assignment,
          { graphRevision: graph.revision, inputs: [] },
        );
    }
    const checks = taskId
      ? this.checks(taskId).selections
      : this.configuredChecks();
    if (
      sanitizeText(canonicalJson(checks), current.secrets) !==
      canonicalJson(checks)
    )
      throw new ContractError("unsupported-context");
    const review =
      action.kind === "review"
        ? this.reviewObservation(action.runId, version)
        : null;
    const preview = decodePreview({
      version,
      action,
      rootLabel: diagnosticText(
        sanitizeText(h.coordination.store.root, current.secrets),
        4096,
      ),
      cwdLabel: diagnosticText(sanitizeText(this.cwd, current.secrets), 4096),
      readablePlan:
        action.kind === "save-plan"
          ? action.plan
          : (review?.readablePlan ?? selected?.record.plan ?? ""),
      graph:
        action.kind === "save-plan"
          ? action.graph
          : action.kind === "generate-plan"
            ? null
            : review
              ? review.graph
              : graph,
      activeRunId: taskId ? this.scheduler.activeTask(taskId) : null,
      issues:
        review?.issues ?? (changes.complete ? [] : ["incomplete-observation"]),
      configuredChecks: checks,
      ...(action.kind === "check"
        ? { checkEnvironmentPolicy: "service-launch-ordinary/1" }
        : {}),
      checksRevision:
        review?.checks.revision ??
        (taskId && this.options.choice
          ? this.obligations(version, current.view.committedSeq).checks.revision
          : taskId
            ? this.checks(taskId).revision
            : 0),
      reviewRunId: action.kind === "review" ? action.runId : null,
    });
    const latestChecks = taskId
      ? this.checks(taskId).selections
      : this.configuredChecks();
    if (canonicalJson(checks) !== canonicalJson(latestChecks))
      throw new ContractError("stale");
    current.assertCurrent();
    h.writer.supplyContext(version);
    return preview;
  }
  currentGraph(graph: Graph, version: ContextVersion): boolean {
    this.alive();
    if (!version.task) return false;
    const selected = this.options.host.coordination.store.loadSnapshot(
      version.task.id,
    );
    if (
      selected?.identity !== version.task.identity ||
      selected.record.revision !== version.task.revision
    )
      return false;
    const saved = this.savedGraph(version.task.id);
    return (
      !!saved &&
      canonicalJson(saved.graph) === canonicalJson(graph) &&
      hash(canonicalJson(graph)) === version.task.graphIdentity
    );
  }
  run(id: string) {
    return this.scheduler.run(id);
  }
  activate(intent: AdmissionIntent, _receipt: Receipt): void {
    this.alive();
    if (intent.identity.kind !== "action") throw new ContractError("invalid");
    const { action, expected } = intent.identity;
    this.assertChoice(expected);
    const previousSeq = this.committed?.previousSeq;
    this.committed = null;
    const accepted = this.accepted.get(intent.operationId);
    if (!accepted) throw new ContractError("conflict");
    const key = expected.task?.id ?? "workspace",
      h = this.options.host;
    if (this.metadata.has(key)) throw new ContractError("conflict");
    if (action.kind === "review") {
      if (!previousSeq || !expected.task) throw new ContractError("conflict");
      const work = Promise.resolve()
        .then(() => this.performReview(intent, previousSeq))
        .catch(async (): Promise<AcceptedWorkResult> => {
          this.quarantine("activation");
          await h.writer.abandonPublication(intent.operationId);
          return { status: "uncertain" };
        })
        .finally(() => {
          this.metadata.delete(key);
          this.reviewing.delete(key);
        });
      this.metadata.set(key, work);
      accepted.activate(work);
      return;
    }
    if (action.kind === "create" || action.kind === "save-plan") {
      // Register busy synchronously; async effects begin only in the next microtask.
      const work = Promise.resolve()
        .then(async (): Promise<AcceptedWorkResult> => {
          if (this.closed) {
            await h.writer.abandonPublication(intent.operationId);
            return { status: "uncertain" };
          }
          this.assertChoice(expected);
          if (action.kind === "save-plan") {
            const retained = await h.writer.retainAcceptedPlan(
              intent.operationId,
              this.options.ownerSecrets,
            );
            if (retained.status !== "committed")
              throw new ContractError("recording-exhausted");
          }
          if (this.closed) {
            await h.writer.abandonPublication(intent.operationId);
            return { status: "uncertain" };
          }
          this.assertChoice(expected);
          const publication = await h.writer.publishTask({
            operationId: intent.operationId,
            ...(action.kind === "create" ? { cwd: this.cwd } : {}),
          });
          if (publication.status !== "published")
            throw new ContractError("conflict");
          return { status: "settled" };
        })
        .catch(async (): Promise<AcceptedWorkResult> => {
          this.quarantine("activation");
          await h.writer.abandonPublication(intent.operationId);
          return { status: "uncertain" };
        })
        .finally(() => {
          this.metadata.delete(key);
        });
      this.metadata.set(key, work);
      accepted.activate(work);
      return;
    }
    if (
      (action.kind !== "start" &&
        action.kind !== "generate-plan" &&
        action.kind !== "check") ||
      !expected.task ||
      !intent.runId
    )
      throw new ContractError("unavailable");
    const selected = h.coordination.store.loadSnapshot(action.taskId),
      plan = this.savedGraph(action.taskId, previousSeq);
    if (!selected || selected.identity !== expected.task.identity)
      throw new ContractError("stale");
    const graph =
      action.kind === "start"
        ? (plan?.graph ??
          this.defaultGraph(selected.record, selected.identity, expected.model))
        : null;
    if (graph && hash(canonicalJson(graph)) !== expected.task.graphIdentity)
      throw new ContractError("stale");
    let own = {
      revision: selected.record.revision,
      identity: selected.identity,
    };
    const work = this.scheduler.activate({
      intent,
      ...(graph
        ? { kind: "start" as const, graph, planUnretained: !plan }
        : action.kind === "check"
          ? {
              kind: "check" as const,
              graph: null,
              planUnretained: false as const,
              check: action.check,
              cwd: this.cwd,
              environment: this.checkEnvironment,
              secrets: this.checkSecrets(expected.model),
              secretSource: {
                current: () => this.checkSecrets(expected.model),
                onChange: (listener) => h.access.onRevoke(listener),
              },
              definitionCurrent: () =>
                action.check.kind === "manual" ||
                this.checks(action.taskId).selections.some(
                  (c) => canonicalJson(c) === canonicalJson(action.check),
                ),
            }
          : {
              kind: "generate-plan" as const,
              graph: null,
              planUnretained: false as const,
            }),
      task: selected.record,
      sources: this.sources,
      current: () => {
        try {
          this.assertChoice(expected);
          const latest = h.coordination.store.loadSnapshot(action.taskId);
          return (
            latest?.identity === own.identity &&
            latest.record.revision === own.revision &&
            this.sources.current()
          );
        } catch {
          return false;
        }
      },
      observe: (advance) => {
        if (advance) this.generation++;
        const view = captureChanges(h.coordination.store.root);
        return {
          observation: {
            identity: view.fingerprint,
            complete: view.complete,
            checkoutGeneration: this.generation,
          },
          text: view.text,
        };
      },
      publish: async (baseline) => {
        this.assertChoice(expected);
        const publication = await h.writer.publishTask({
          operationId: intent.operationId,
          ...(baseline ? { baseline } : {}),
        });
        if (publication.status !== "published" || !publication.observed)
          throw new ContractError("conflict");
        own = publication.observed;
        // Cold current-graph continuity is proven by original publication facts
        // (a prefix attested by an authenticated task fold checkpoint), not an
        // evictable RAM approval/lineage cache.
      },
    });
    accepted.activate(work);
  }
  private reviewObservation(
    runId: string,
    version: ContextVersion,
    snapshot = this.options.host.writer.committedSeq,
    reads?: SnapshotReads,
  ) {
    if (!version.task) throw new ContractError("stale");
    const h = this.options.host,
      taskId = version.task.id;
    const select = () => h.reader.reviewSelection(taskId, runId, snapshot);
    const selection = reads
      ? reads(`selection:${taskId}:${runId}:${snapshot}`, select)
      : select();
    const { run } = selection;
    const state = this.obligations(version, snapshot, reads);
    const current: ReviewContext = {
      ...state,
      checks: state.checks,
      observation: {
        ...version.observation,
        checkoutGeneration: version.checkoutGeneration,
      },
    };
    return {
      ...current,
      ...selection,
      issues: reviewIssues(
        run,
        current,
        version.task.kind === "code",
        version.epoch,
      ),
    };
  }
  private async performReview(
    intent: AdmissionIntent,
    snapshot: string,
  ): Promise<AcceptedWorkResult> {
    if (
      intent.identity.kind !== "action" ||
      intent.identity.action.kind !== "review" ||
      !intent.identity.expected.task
    )
      throw new ContractError("invalid");
    const h = this.options.host,
      { action, expected } = intent.identity,
      task = expected.task;
    if (!task) throw new ContractError("stale");
    let barrier: ReviewBarrier | undefined;
    try {
      barrier = await this.scheduler.reviewBarrier(intent.operationId);
      const held = barrier;
      const selected = h.coordination.store.loadSnapshot(task.id);
      if (
        !selected ||
        selected.identity !== task.identity ||
        selected.record.revision !== task.revision
      )
        throw new ContractError("stale");
      const graph = this.savedGraph(task.id, snapshot);
      const currentGraph =
        graph?.graph ??
        (this.options.choice
          ? this.defaultGraph(
              selected.record,
              selected.identity,
              expected.model,
            )
          : null);
      if (
        (currentGraph ? hash(canonicalJson(currentGraph)) : null) !==
          task.graphIdentity ||
        (currentGraph?.revision ?? null) !== task.graphRevision
      )
        throw new ContractError("stale");
      // History at `snapshot` is immutable input: fold it once for this
      // review. Every validation still checks the mutable state below.
      const reads = snapshotReads();
      const validate = (published?: {
        revision: number;
        identity: string;
      }): ReviewContext => {
        this.assertChoice(expected);
        held.assertHeld();
        const actual = h.coordination.store.loadSnapshot(task.id),
          want = published ?? task;
        if (
          !actual ||
          actual.identity !== want.identity ||
          actual.record.revision !== want.revision ||
          realpathSync(actual.record.cwd) !== this.cwd ||
          this.generation !== expected.checkoutGeneration ||
          h.writer.controlRevision(task.id) !== expected.controlRev + 1 ||
          this.scheduler.activeTask(task.id)
        )
          throw new ContractError("stale");
        const changes = captureChanges(h.coordination.store.root);
        if (
          changes.fingerprint !== expected.observation.identity ||
          changes.complete !== expected.observation.complete
        )
          throw new ContractError("stale");
        // Original historical proof of this immutable snapshot (not a current
        // default), proven once per review beside the raw-byte checks above.
        const proven = reads(`plan:${task.id}:${snapshot}`, () =>
          h.reader.publishedPlan(task.id, snapshot, {
            revision: selected.record.revision,
            identity: selected.identity,
            plan: selected.record.plan,
          }),
        );
        if (
          (proven?.reference.sha256 ??
            (currentGraph ? hash(canonicalJson(currentGraph)) : null)) !==
          task.graphIdentity
        )
          throw new ContractError("stale");
        const current = this.reviewObservation(
          action.runId,
          expected,
          snapshot,
          reads,
        );
        if (
          current.checks.revision !== action.checksRevision ||
          (current.issues.length && !action.acceptIssues)
        )
          throw new ContractError("stale");
        return current;
      };
      this.reviewing.set(task.id, validate);
      const current = validate();
      const port = h.writer.reviewOutput(intent.operationId);
      const link: OwnerLink = {
        epoch: expected.epoch,
        taskId: task.id,
        runId: action.runId,
        operationId: intent.operationId,
      };
      const view = captureChanges(h.coordination.store.root),
        observationId = randomUUID();
      const changes = await this.reviewContent(
        port,
        link,
        "changes",
        observationId,
        view.text,
        view.complete,
      );
      validate();
      await recordOwner(h.writer, link, [
        {
          kind: "fact",
          fact: {
            kind: "changes",
            stage: "review",
            observationId,
            observation: current.observation,
            content: changes,
          },
        },
      ]);
      validate();
      const reviewId = randomUUID();
      const reviewedRun = h.reader.reviewRun(task.id, action.runId, snapshot);
      const text = canonicalJson({
        kind: "human-review",
        task: expected.task,
        runId: action.runId,
        runSettlementSeq: reviewedRun.settledSeq,
        graphReference: reviewedRun.admission?.graph ?? null,
        currentGraphReference: graph?.reference ?? null,
        model: expected.model,
        cwdId: expected.cwdId,
        checkEnvGeneration: expected.checkEnvGeneration,
        observation: current.observation,
        checks: current.checks,
        recorded: current.recorded,
        recordingIncomplete: current.recordingIncomplete,
        acceptIssues: action.acceptIssues,
        issues: reviewIssues(
          reviewedRun,
          current,
          task.kind === "code",
          expected.epoch,
        ),
        note: "Explicit human acknowledgment; agent review is advisory. Execution/check/native facts are unchanged.",
      });
      const content = await this.reviewContent(
        port,
        link,
        "review",
        reviewId,
        text,
        true,
      );
      validate();
      await recordOwner(h.writer, link, [
        {
          kind: "fact",
          fact: {
            kind: "review",
            reviewId,
            runId: action.runId,
            changesIdentity: action.changesIdentity,
            checksRevision: action.checksRevision,
            acceptIssues: action.acceptIssues,
            outcome: action.acceptIssues ? "reviewed-with-issues" : "reviewed",
            content,
          },
        },
      ]);
      validate();
      const publication = await h.writer.publishTask({
        operationId: intent.operationId,
      });
      if (publication.status !== "published" || !publication.observed)
        throw new ContractError("conflict");
      validate(publication.observed);
      barrier.release();
      barrier = undefined;
      return { status: "settled" };
    } catch {
      // No release on an uncertain original; Stop/accounting retains the barrier.
      throw new ContractError("conflict");
    }
  }
  private async reviewContent(
    port: import("./ports.ts").OwnerJournalPort,
    link: OwnerLink,
    field: "changes" | "review",
    id: string,
    source: string,
    complete: boolean,
  ): Promise<ContentRef> {
    if (Buffer.byteLength(source) > (field === "changes" ? 128 : 512) * 1024)
      throw new ContractError("oversize");
    const lease = port.reserve({
      sourceFrames: 0,
      retainedBytes: 1024 * 1024,
      outputBytes: 2 * 1024 * 1024,
      outputChunks: 160,
      lane: "data",
    });
    if (lease.status !== "reserved") throw new ContractError("capacity");
    let consumed = false;
    try {
      const text = sanitizeText(source, this.checkSecrets()),
        bytes = Buffer.from(text),
        detailId = randomUUID();
      const events: OwnerRecordingEvent[] = [
        {
          kind: "content-begin",
          detailId,
          field,
          encoding: "utf8",
          owner: {
            taskId: link.taskId,
            runId: link.runId,
            childRunId: null,
            entity: { kind: field, id, version: 1 },
          },
        },
      ];
      for (let at = 0; at < bytes.length; ) {
        let end = Math.min(at + LIMITS.chunkBytes, bytes.length);
        while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
        events.push({
          kind: "content-chunk",
          detailId,
          text: bytes.subarray(at, end).toString("utf8"),
        });
        at = end;
      }
      events.push({
        kind: "content-end",
        detailId,
        coverage: {
          observed: "complete",
          source: complete ? "complete" : "limited",
          redacted: text !== source,
          omissions: complete ? [] : ["source-limit"],
        },
      });
      consumed = true;
      const result = await lease.reservation.commit({
        link,
        observedMs: Math.floor(performance.now()),
        events,
      });
      if (
        result.status !== "committed" ||
        result.batch.ownerDetails.length !== 1
      )
        throw new ContractError("recording-exhausted");
      return result.batch.ownerDetails[0].content;
    } finally {
      if (!consumed) lease.reservation.release();
    }
  }
  async settled(taskId: string | null): Promise<void> {
    await this.metadata.get(taskId ?? "workspace");
  }
  requestCancel(command: CancelCommand): void {
    this.scheduler.cancel(command.runId);
  }
  quiesce(): void {
    if (this.closed) return;
    this.closed = true;
    this.admission.revokeGrants();
    this.options.host.writer.quiesce();
    this.scheduler.quiesce();
    for (const accepted of this.accepted.values()) accepted.activate(null);
  }
  quarantine(_reason: "persistence" | "activation" | "context"): void {
    this.quiesce();
    this.scheduler.quarantine();
  }
}
