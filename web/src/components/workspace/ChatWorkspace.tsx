/* Adapted from pi-web-ui ChatInput/MessageList: bottom composer, streaming
 * transcript, tool cards and per-conversation drafts. MIT (c) 2026 xing-shuyin.
 * No upstream prompt, dispatch tool, queue, plugin or subagent runtime.
 * Cadence: the branch shown (the view) and the entry the next message
 * continues (the anchor) are separate. Choosing a branch, a version or a
 * question only reads; an anchor only changes what the next Send names. */

import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  FiArrowDown,
  FiCornerDownRight,
  FiEdit2,
  FiFileText,
  FiGitBranch,
  FiMessageSquare,
} from "react-icons/fi";
import { abortScope } from "../../../../src/abort-scope.ts";
import {
  type DesignAnswer,
  designMessage,
} from "../../../../src/service/contracts/design.ts";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type {
  CadenceConversation,
  ChatCache,
  ChatPending,
  ChatSummary,
  ChatTreeNode,
} from "../../../../src/service/contracts/workbench.ts";
import { CONVERSATION_SEND_BYTES } from "../../../../src/service/contracts/workbench.ts";
import type {
  WorkflowProposal,
  WorkflowRun,
} from "../../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import {
  canonicalJson,
  decodeModelSelector,
  type ModelSelector,
  publicError,
} from "../../../../src/service-contract.ts";
import { type ContextUsage, contextUsage } from "../../client/context-usage";
import {
  editHead,
  firstLine,
  offBranch,
  sendHead,
} from "../../client/conversation-anchor";
import {
  type InputMode,
  inputCommand,
  inputOutcome,
  inputRefusal,
  wholePendingText,
  withdrawCommand,
} from "../../client/conversation-inputs";
import {
  type ConversationView,
  type LoadedTurn,
  unsettled,
} from "../../client/conversation-reader";
import {
  assertSendModel,
  captureSend,
  chooseWaitingModel,
  dispatchSend,
  installSendModel,
  modelDraftConsumed,
  modelWaitDisposition,
  type PendingSend,
  type PreparationStage,
  type PrepareExecution,
  preparationEffect,
  draftKey as selectDraftKey,
  selector,
  sendCommand,
  sendFailureMessage,
  unsentMessage,
  waitForPreparation,
  waitingModelSend,
  withSendModel,
} from "../../client/conversation-send";
import {
  branchQuestions,
  messageVersions,
  questionOrdinal,
  useConversationTree,
} from "../../client/conversation-tree";
import type { FolderDraft } from "../../client/folder-draft";
import { uploadImages } from "../../client/images";
import type { PreviewModels } from "../../client/model-preview";
import { refusedAccess } from "../../client/observation-read";
import type { ObservationAccess } from "../../client/observer";
import {
  activityRoute,
  chatFromLocation,
  rememberBranch,
} from "../../client/project-route";
import { useConversation } from "../../client/use-conversation";
import {
  type CatalogClient,
  type ModelAvailability,
  useModelCatalog,
} from "../../client/use-model-catalog";
import { cadenceInput, useWorkbench } from "../../client/use-workbench";
import { useWorkflowRuns } from "../../client/use-workflow-runs";
import {
  approveWorkflow,
  cadenceApproval,
  cadenceExit,
  planAction,
  revalidateWorkflow,
} from "../../client/workflow-entry";
import { pushPromptHistory } from "../../composer/prompt-history";
import { describeError, useT } from "../../i18n/locale";
import { dismissToasts, notify } from "../../layout/toasts";
import { dockGroups } from "../../navigation/workflow-assignments";
import { useLazyWindow } from "../../transcript/use-lazy-window";
import { LazyMount } from "../transcript/LazyMount";
import type { ConversationAgents, WorkflowAgent } from "./AgentDock";
import type { BranchesView } from "./BranchesPanel";
import { composerMode, modeHints } from "./CadenceModeButton";
import { ChatComposer, type ChatComposerProps } from "./ChatComposer";
import { useImageDraft } from "./ChatImages";
import { turnParts } from "./ChatSteps";
import { ChatTurnView } from "./ChatTurnView";
import { ChatWelcome, ConversationFeedback } from "./ChatWelcome";
import "./conversation-entry.css";
import { DesignCard } from "./DesignCard";
import { QuestionRail } from "./QuestionRail";
import { useSendAnchor } from "./use-send-anchor";
import { WaitingMessages } from "./WaitingMessages";
import {
  type CanCancelWorkflow,
  nextRunWindow,
  PlanCard,
  placeWorkflows,
  RUN_WINDOW,
  WorkflowLine,
} from "./WorkflowPanel";

const NO_ACTIVE_RUNS: readonly string[] = [];
const NATIVE_ANCHORING =
  typeof CSS !== "undefined" && CSS.supports("overflow-anchor", "auto");

/** Preserve the existing 80px intent boundary; content growth is not itself
 * permission to resume following a reader who scrolled up. */
export function followsLatest(
  el: Pick<HTMLElement, "scrollHeight" | "scrollTop" | "clientHeight">,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}
export function followLatest(
  el: Pick<HTMLElement, "scrollHeight" | "scrollTop"> | null,
  following: boolean,
): void {
  if (following && el) el.scrollTop = el.scrollHeight;
}
/** Epoch milliseconds for a currently observed live reply (0 when its start is
 * unrecorded). Neither an unreadable reply nor a settled one owns a timer. */
export type ReplyClock = number | "idle" | "unavailable";
export function observedReplyClock(
  view: ConversationView,
  id: string,
  awaitingReceipt = false,
): ReplyClock {
  const { summary, observation } = view;
  if (
    !observation ||
    view.error ||
    summary === undefined ||
    (!summary && view.attempt?.status === "unknown") ||
    (summary &&
      (summary.id !== id ||
        summary.status === "unknown" ||
        (summary.live && summary.live.epoch !== observation.epoch)))
  )
    return "unavailable";
  if (!unsettled(summary?.status))
    return awaitingReceipt ? "unavailable" : "idle";
  const latest = view.turns.at(-1);
  return latest &&
    latest.ordinal === view.count - 1 &&
    unsettled(latest.header.status)
    ? latest.header.at
    : 0;
}
/** What the open conversation tells the statusbar: observations only. */
export interface ConversationActivity {
  id: string;
  /** Turns on the branch shown. */
  turns: number;
  replyClock: ReplyClock;
  /** The branch's context size as of its last completed model response;
   * absent when the head read states none. */
  context?: ContextUsage;
  /** The whole session's input tokens by cache use; absent when the head
   * read states none. */
  cache?: ChatCache;
}
/** Captured by the rendered control, never looked up on the next viewer. */
export interface ViewerTicket {
  epoch?: string;
  allocation?: AbortSignal;
  attached(epoch: string): boolean;
  current(): boolean;
}
type PrepareChat =
  | PrepareExecution
  | ((...args: Parameters<PrepareExecution>) => Promise<ViewerTicket>);
export interface ChatDiagnostics {
  context?: string;
  head?: string;
  prepareOnly: boolean;
  workflow?: string;
  runs?: string;
  retry(): void;
}
type Draft = { text: string; source?: string | symbol };
type DraftEntry = Draft & { parked?: Draft };
// Native history exposes the restored text, not which edit it came from.
// Remember only recognized phrases: a discussion lifetime if unambiguous,
// otherwise null. Neither the browser's edit stack nor plan bindings live here.
type PhraseOrigins = ReadonlyMap<string, symbol | null>;
function rememberPhrase(origins: PhraseOrigins, entry: Draft): PhraseOrigins {
  if (!cadenceApproval(entry.text)) return origins;
  const key = entry.text.trim();
  const previous = origins.get(key);
  const source =
    typeof entry.source === "symbol" &&
    (previous === undefined || previous === entry.source)
      ? entry.source
      : null;
  return previous === source ? origins : new Map(origins).set(key, source);
}
function stored(key: string, fallback = "") {
  try {
    return sessionStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}
/** A message of the tree to bring into view, and what to do once it is. */
interface Target {
  id: string;
  then: "show" | "edit" | "continue";
  /** Its own branch was already asked for. */
  switched?: boolean;
}
export function ChatWorkspace({
  client,
  id,
  workspaceId,
  initialCwd,
  initialLeaf = null,
  activitySelected = false,
  onLocation,
  onActivity,
  enabled,
  actionsReady = enabled,
  viewer,
  access,
  readSelected,
  onDiagnostics,
  prepareForSend,
  prepareForPlan,
  legacyWorkspaceId,
  directoryNamespaces = [],
  available = enabled,
  canInterrupt = enabled,
  canCancelWorkflow,
  modelAvailability,
  previewModels,
  initialDraft,
  onDraftApplied,
  onModelChanged,
  onChanged,
  reference,
  onReferenceUsed,
  hidden = false,
  observe = 0,
  onOpenAgent,
  activeWorkflowIds = NO_ACTIVE_RUNS,
  onAgents,
  onBranches,
  onOpenBranches,
}: {
  client: ServiceClient;
  id: string;
  workspaceId: string;
  initialCwd?: string;
  initialLeaf?: string | null;
  activitySelected?: boolean;
  onLocation?(location: ConversationLocation): void;
  onActivity?(activity: ConversationActivity): void;
  enabled: boolean;
  actionsReady?: boolean;
  viewer?: ViewerTicket;
  access?: ObservationAccess;
  readSelected?(): boolean;
  onDiagnostics?(diagnostics: ChatDiagnostics): void;
  prepareForSend?: PrepareChat;
  /** Explicit plan validation may prepare an owner; never called by observation. */
  prepareForPlan?: PrepareChat;
  legacyWorkspaceId?: string;
  directoryNamespaces?: string[];
  available?: boolean;
  canInterrupt?: boolean;
  canCancelWorkflow?: CanCancelWorkflow;
  /** Kept mounted (draft, scroll, observations) while a subagent view covers it. */
  hidden?: boolean;
  /** Changes when something outside this view (a rename or archive from the
   * sidebar) may have changed the conversation's summary: read it again. */
  observe?: number;
  onOpenAgent?(agent: WorkflowAgent): void;
  /** Active IDs attributed by the owner's roster; retained IDs come from history. */
  activeWorkflowIds?: readonly string[];
  onAgents?(observation: ConversationAgents): void;
  /** The session tree and the ways to act on it, for the Branches tab. */
  onBranches?(view: BranchesView): void;
  /** Open the Branches tab. */
  onOpenBranches?(): void;
  /** Observed execution availability, independent of the readable history. */
  modelAvailability: ModelAvailability;
  previewModels?: PreviewModels;
  initialDraft?: FolderDraft;
  /** Retire the one-time entry handoff only after the target mounts. */
  onDraftApplied?(): void;
  /** An explicit model choice changed the owner configuration. */
  onModelChanged(): void;
  /** Refresh owner state after a user command, not after a transcript read. */
  onChanged(): void;
  reference?: string;
  onReferenceUsed(): void;
}) {
  const { t, tx } = useT();
  const [draftKey] = useState(() =>
    selectDraftKey(workspaceId, id, legacyWorkspaceId, ...directoryNamespaces),
  );
  // Only text survives storage, recall by the workspace, and branch edits.
  // A plan confirmation gets its source from an explicit composer edit below.
  const [{ entry }, updateEditor] = useState<{
    entry: DraftEntry;
    origins: PhraseOrigins;
  }>(() => ({
    entry: { text: stored(draftKey, initialDraft?.text) },
    origins: new Map(),
  }));
  const setEntry = useCallback(
    (edit: (prior: DraftEntry, origins: PhraseOrigins) => DraftEntry) => {
      updateEditor((prior) => {
        const origins = rememberPhrase(prior.origins, prior.entry);
        const entry = edit(prior.entry, origins);
        return entry === prior.entry ? prior : { entry, origins };
      });
    },
    [],
  );
  const draft = entry.text;
  const setDraft = useCallback(
    (update: string | ((text: string) => string)) => {
      setEntry((previous) => {
        if (typeof update === "string") return { text: update };
        const text = update(previous.text);
        return text === previous.text ? previous : { text };
      });
    },
    [setEntry],
  );
  useEffect(() => {
    if (initialDraft) onDraftApplied?.();
  }, [initialDraft, onDraftApplied]);
  const imageDraft = useImageDraft();
  const removeImages = imageDraft.remove;
  const sentImages = useRef<readonly File[]>([]);
  const alive = useRef(true);
  // The entry the next message continues when that is not the end of the
  // view, and the draft set aside for it.
  const sendAnchor = useSendAnchor({
    draftKey,
    draft,
    setDraft,
    images: imageDraft,
    alive,
    onUnread: () =>
      refuse(
        t(
          "Part of the message could not be read back. Check the text and images before sending.",
        ),
      ),
  });
  const { anchor, attaching } = sendAnchor;
  const releaseAnchor = sendAnchor.release;
  // Each render's handlers, for callers that keep one callback across renders:
  // memoized turn rows, the Branches tab and effects.
  const acts = useRef({
    chooseBranch(_leaf: string | null, _first?: number) {},
    followAnchor() {},
    show(_id: string, _then: Target["then"]) {},
    stepVersion(_turnId: string, _step: -1 | 1) {},
  });
  const [mode, setMode] = useState<"chat" | "cadence">(() =>
    stored(`${draftKey}:mode`) === "cadence" ? "cadence" : "chat",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // A definite local refusal (nothing reached the owner) is a toast this
  // conversation withdraws on its next attempt; an unknown outcome or an
  // owner-side effect stays in the transcript as `error`, which no toast clears.
  const toastKey = `conversation:${id}`;
  const clearError = () => {
    setError("");
    dismissToasts(toastKey);
  };
  const refuse = (text: string) => notify("error", text, toastKey);
  useEffect(() => () => dismissToasts(toastKey), [toastKey]);
  const [pending, setPending] = useState(() => stored(`${draftKey}:pending`));
  // A matched message receipt can arrive before the reader's next head. The
  // layout uses that fact immediately; a preparation/exit/approval is not one.
  const [received, setReceived] = useState("");
  const [review, setReview] = useState<{
    binding: string;
    open: boolean;
  } | null>(null);
  const [modelCommand, setModelCommand] = useState(() =>
    stored(`${draftKey}:model-command`),
  );
  const [modelOpen, setModelOpen] = useState(false);
  // A Send found no model: it continues once one is explicitly chosen.
  const [awaitingModel, setAwaitingModel] = useState(false);
  const [resume, setResume] = useState(false);
  const [modelReads, setModelReads] = useState(0);
  const waitingSend = useRef<PendingSend | null>(null);
  const waitingViewer = useRef<ViewerTicket>(undefined);
  const sending = useRef(false);
  const sendGeneration = useRef(0);
  const departure = useRef(new AbortController());
  const renderedBranch = departure.current.signal;
  const [preparing, setPreparing] = useState(false);
  const [draftModel, setDraftModel] = useState<ModelSelector | null>(() => {
    try {
      const saved = sessionStorage.getItem(`${draftKey}:model`);
      if (saved) return decodeModelSelector(JSON.parse(saved));
    } catch {
      /* Optional browser draft. */
    }
    return initialDraft?.model ?? null;
  });
  useEffect(() => {
    try {
      if (draftModel)
        sessionStorage.setItem(`${draftKey}:model`, JSON.stringify(draftModel));
      else sessionStorage.removeItem(`${draftKey}:model`);
    } catch {
      /* Selection remains in memory. */
    }
  }, [draftKey, draftModel]);

  // Workspace lifetime is one conversation. Keep only explicit disclosures,
  // above the window that unmounts turn bodies. Normal latest-leaf growth is
  // not a branch switch; a non-continuing head is (including a terminal fork).
  const [expandedTraces, setExpandedTraces] =
    useState<ReadonlyMap<string, ReadonlySet<string>>>();
  const replacedHeads = useRef(new WeakSet<ChatSummary>());
  const [traceBranch, setTraceBranch] = useState(0);
  const retireTraceChoices = useCallback(() => {
    setExpandedTraces(undefined);
    // Retire mounted focus/visibility holds on a shared ancestor too.
    setTraceBranch((previous) => previous + 1);
  }, []);
  const rememberTrace = useCallback(
    (turn: string, steps: ReadonlySet<string>) => {
      setExpandedTraces((prior) => {
        const next = new Map(prior);
        if (steps.size) next.set(turn, steps);
        else next.delete(turn);
        return next.size ? next : undefined;
      });
    },
    [],
  );

  // History GETs do not borrow an execution attachment. Attribute a denial
  // only to the project/conversation that issued this read.
  const reader = useMemo<Pick<ServiceClient, "workbenchRead">>(
    () => ({
      async workbenchRead(request, signal) {
        const wait = abortScope([signal, access?.signal]);
        try {
          if (wait.signal.aborted || readSelected?.() === false)
            return { kind: "error", error: publicError("stale") };
          const reply = await client.workbenchRead(request, wait.signal);
          if (wait.signal.aborted || readSelected?.() === false)
            return { kind: "error", error: publicError("stale") };
          if (
            reply.kind === "ok" &&
            reply.value.kind === "conversation" &&
            !reply.value.continues &&
            reply.value.summary
          )
            replacedHeads.current.add(reply.value.summary);
          if (reply.kind === "error" && refusedAccess(reply.error.code))
            access?.refuse("viewer", reply.error.code);
          return reply;
        } finally {
          wait.dispose();
        }
      },
    }),
    [client, readSelected, access],
  );
  const contextRead = useWorkbench(
    reader,
    available && initialCwd
      ? { kind: "conversation-context", location: { id, cwd: initialCwd } }
      : null,
    1000,
  );
  const context =
    contextRead.value?.kind === "conversation-context"
      ? contextRead.value.context
      : undefined;
  const contextKnown = !!context && !contextRead.error;
  const locationCwd = context?.cwd ?? initialCwd;
  const modelClient = useMemo<CatalogClient>(
    () => ({
      models: (signal, reload) =>
        locationCwd
          ? client.models(signal, { id, cwd: locationCwd }, reload)
          : Promise.resolve({
              kind: "error",
              error: publicError("unavailable"),
            }),
    }),
    [client, id, locationCwd],
  );
  const modelChoiceClient = useMemo<Pick<ServiceClient, "chooseModel">>(
    () => ({
      chooseModel: (request) =>
        locationCwd &&
        actionsReady &&
        (!viewer ||
          (viewer.current() && request.expected.epoch === viewer.epoch))
          ? client.chooseModel(request, { id, cwd: locationCwd })
          : Promise.resolve({ kind: "error", error: publicError("stale") }),
    }),
    [client, actionsReady, locationCwd, viewer, id],
  );
  const availability: ModelAvailability = preparing
    ? { status: "preparing" }
    : modelAvailability.status === "ready" && (!available || !contextKnown)
      ? { status: contextRead.error ? "unavailable" : "connecting" }
      : modelAvailability;
  const latestAvailability = useRef(availability);
  latestAvailability.current = availability;
  const modelRead = useModelCatalog(
    modelClient,
    availability,
    `${modelReads}:${context?.revision ?? "unobserved"}`,
    previewModels,
  );
  const clearModelWait = () => {
    waitingSend.current = null;
    setAwaitingModel(false);
    setResume(false);
  };
  const openModels = (open: boolean, reason?: "chosen") => {
    if (open) modelRead.reread(true);
    else if (!open && reason !== "chosen") clearModelWait();
    setModelOpen(open);
  };
  const chosenModel = (choice: ModelSelector, installed: boolean) => {
    setDraftModel(installed ? null : choice);
    const waiting = waitingSend.current;
    if (!awaitingModel || !waiting) return;
    if (
      modelWaitDisposition(waiting, latestAvailability.current) === "cancel"
    ) {
      clearModelWait();
      refuse(
        t(
          "The connection changed. Your model choice and draft are kept; send again when ready.",
        ),
      );
      return;
    }
    waitingSend.current = chooseWaitingModel(waiting, choice, installed);
    setAwaitingModel(false);
    clearError();
    setResume(true);
  };
  const onLocationRef = useRef(onLocation);
  onLocationRef.current = onLocation;
  useEffect(() => {
    if (contextKnown && locationCwd)
      onLocationRef.current?.({ id, cwd: locationCwd });
  }, [contextKnown, id, locationCwd]);
  // The address names the branch shown (`rememberBranch` keeps it current),
  // so a remount or a refresh opens on it again.
  const [entryLeaf] = useState(() =>
    typeof window !== "undefined" && chatFromLocation() === id
      ? activityRoute(window.location.hash, id).leaf
      : initialLeaf,
  );
  const conversation = useConversation(
    reader,
    id,
    available,
    modelAvailability.status === "ready" ? modelAvailability : null,
    entryLeaf,
  );
  const { turns } = conversation;
  // The reader publishes a head only after its turn reads succeed. Keep the
  // old view's choices until that switch, even if the reads are slow or fail.
  useLayoutEffect(() => {
    if (
      conversation.summary &&
      replacedHeads.current.delete(conversation.summary)
    )
      retireTraceChoices();
  }, [conversation.summary, retireTraceChoices]);
  // Undefined until observed; null is a conversation not started yet.
  const observed = conversation.summary !== undefined;
  const workflow = useWorkbench(
    reader,
    available ? { kind: "cadence-conversation", id } : null,
    1000,
  );
  const [editedState, setEditedState] =
    useState<
      import("../../../../src/service/contracts/workbench.ts").CadenceConversation
    >();
  const polledState =
    workflow.value?.kind === "cadence-conversation"
      ? workflow.value.state
      : undefined;
  const state =
    polledState &&
    editedState?.id === id &&
    editedState.revision > polledState.revision
      ? editedState
      : polledState;
  const cadence = state?.enabled === true;
  // Ordinary chat never depends on the Cadence record: a failed mode read
  // still allows an ordinary Send, which the owner refuses if Cadence is on.
  const modeObserved = !!state || !!workflow.error;
  // A degraded record (notice) is shown but takes no Cadence action.
  const cadenceKnown = !!state && !workflow.error && !state.notice;
  const latestState = useRef(state);
  latestState.current = state;
  // Keep an uncertain approval identity across refresh; it is observed, never replayed.
  const [approving, setApproving] = useState(() =>
    stored(`${draftKey}:approval`, ""),
  );
  const attempted = useRef(approving);
  const decisionBusy = useRef(false);
  const [revalidating, setRevalidating] = useState(false);
  const [invalidatedPlan, setInvalidatedPlan] = useState("");
  const [validation, setValidation] = useState<{
    before: WorkflowProposal;
    after: CadenceConversation;
  }>();
  const rememberApproval = useCallback(
    (commandId: string) => {
      attempted.current = commandId;
      setApproving(commandId);
      try {
        if (commandId)
          sessionStorage.setItem(`${draftKey}:approval`, commandId);
        else sessionStorage.removeItem(`${draftKey}:approval`);
      } catch {
        /* The live attempt remains observable without browser storage. */
      }
    },
    [draftKey],
  );
  const input = cadenceInput(draft, cadence ? "cadence" : mode);
  const modeFacts = {
    active: cadence,
    armed: input.mode === "cadence",
    known: cadenceKnown,
  };
  const modeHint = modeHints[composerMode(modeFacts)];
  const canSend =
    enabled &&
    !(activitySelected && !conversation.summary) &&
    contextKnown &&
    observed &&
    !conversation.error &&
    modeObserved &&
    !(cadence && (workflow.error || state?.notice)) &&
    !busy &&
    !awaitingModel &&
    !pending;
  const summary = conversation.summary ?? undefined;
  const status = summary?.status;
  const running = unsettled(status);
  const lastTurn = turns.at(-1)?.header;
  const replyClock = observedReplyClock(conversation, id, !!pending);
  // The branch's context size beside the window of the model that reported
  // it, from the catalog already read here; each head read is a new object.
  const {
    tokens: usedTokens,
    provider: usedProvider,
    model: usedModel,
  } = conversation.context ?? {};
  const modelEntries = modelRead.catalog?.entries ?? modelRead.preview?.entries;
  const usage = useMemo(
    () =>
      usedTokens === undefined ||
      usedProvider === undefined ||
      usedModel === undefined
        ? undefined
        : contextUsage(
            { tokens: usedTokens, provider: usedProvider, model: usedModel },
            modelEntries,
          ),
    [usedTokens, usedProvider, usedModel, modelEntries],
  );
  // Each head read is a new object; the totals themselves change rarely.
  const {
    input: cacheInput,
    read: cacheRead,
    write: cacheWrite,
  } = conversation.cache ?? {};
  const cache = useMemo(
    () =>
      cacheInput === undefined ||
      cacheRead === undefined ||
      cacheWrite === undefined
        ? undefined
        : { input: cacheInput, read: cacheRead, write: cacheWrite },
    [cacheInput, cacheRead, cacheWrite],
  );
  const observeConversation = conversation.refresh;
  useEffect(() => {
    // Readonly: the header shows a new name once the head read states it.
    if (observe) observeConversation();
  }, [observe, observeConversation]);
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  useLayoutEffect(() => {
    onActivityRef.current?.({
      id,
      turns: conversation.count,
      replyClock,
      ...(usage ? { context: usage } : {}),
      ...(cache ? { cache } : {}),
    });
  }, [id, conversation.count, replyClock, usage, cache]);
  const newest = turns.at(-1);
  const newestLive = unsettled(newest?.header.status);
  // One tree read for the branch shown feeds the version pagers, the question
  // rail and the Branches tab. It is made again when the branch gains or
  // changes a message, not for every entry a reply appends.
  const treeRead = useConversationTree(
    client,
    id,
    conversation.leaf,
    [
      newest?.header.id ?? "",
      conversation.count,
      conversation.branches,
      newestLive,
    ].join(),
    available && !!summary,
  );
  const { tree } = treeRead;
  const versions = useMemo(
    () => messageVersions(tree ?? { nodes: [], truncated: false }),
    [tree],
  );
  // The branch's user messages; a live turn's own is not on the listed branch
  // until it settles, so it is added from the turn shown.
  const questions = useMemo(() => {
    const listed = branchQuestions(tree?.nodes ?? []).map((node) => ({
      id: node.id,
      text: node.text,
    }));
    if (
      !newest ||
      !newestLive ||
      listed.some((question) => question.id === newest.header.id)
    )
      return listed;
    const text = turnParts(newest.steps).user[0]?.step.text ?? "";
    return [...listed, { id: newest.header.id, text: firstLine(text) }];
  }, [tree, newest, newestLive]);
  // A message to bring into view; once its turn is shown, the row jumped to
  // (a new object per jump, kept mounted until the next one).
  const [target, setTarget] = useState<Target | null>(null);
  const [jump, setJump] = useState<{ id: string } | null>(null);
  // The turn at the top of the transcript, for the rail.
  const [activeTurn, setActiveTurn] = useState<string | null>(null);
  // A failed read must not strand a half-started owner behind an unreadable
  // conversation. Explicit Send may prepare it, but cannot infer or rebase the
  // missing head: the user reviews the restored context and sends again.
  const canPrepareOnly =
    !!prepareForSend &&
    enabled &&
    (!!conversation.error || !!contextRead.error) &&
    conversation.error !== "retired-conversation" &&
    contextRead.error !== "retired-conversation" &&
    !state?.notice &&
    !running &&
    !busy &&
    !pending &&
    !awaitingModel;
  const canExit =
    (actionsReady || !!prepareForSend) &&
    contextKnown &&
    observed &&
    cadenceKnown &&
    !conversation.error &&
    !busy &&
    !pending &&
    !running;
  // The proposal is conversation-wide, not a snapshot of a historical fork.
  // Keep it readable there without offering an action on the unseen latest branch.
  const historicalBranch =
    conversation.pinned && (!summary || conversation.leaf !== summary.leaf);
  const modelPending =
    !!draftModel &&
    canonicalJson(draftModel) !== canonicalJson(context?.model ?? null);
  const planApprovable =
    state?.proposal?.plan.version === 3 &&
    state.enabled &&
    state.id === id &&
    !!summary &&
    summary.id === id &&
    !historicalBranch &&
    !running &&
    summary.status !== "unknown";
  const proposal = state?.id === id && state.enabled ? state.proposal : null;
  // A disclosure is local to this exact proposal and discussion. No version
  // list, history scan, or approval grant is created by opening the panel.
  const binding = proposal
    ? JSON.stringify([
        id,
        proposal.id,
        proposal.digest,
        state?.head,
        state?.revision,
        conversation.leaf,
        conversation.pinned,
        conversation.count,
        sendGeneration.current,
      ])
    : "";
  const reviewed = !!binding && review?.binding === binding;
  const planOpen = reviewed && review.open;
  const planPanelId = `current-plan-${id}`;
  const approvalAction =
    state?.proposal?.plan.version === 3
      ? planAction(
          state.proposal,
          actionsReady,
          modelRead.catalog?.version,
          modelPending || invalidatedPlan === state.proposal.id,
        )
      : "readonly";
  // An exact phrase can also be ordinary discussion (including steering a
  // live reply). Never reinterpret a draft across these two input paths.
  const discussionPath = running ? "reply" : cadence ? undefined : mode;
  const discussionSource = useMemo(
    () => discussionPath && Symbol(discussionPath),
    [discussionPath],
  );
  const phraseSource =
    discussionSource ??
    (cadenceKnown && reviewed && planApprovable && contextKnown && !anchor
      ? canonicalJson([
          binding,
          approvalAction,
          availability,
          modelRead.catalog?.version ?? null,
          context,
          draftModel,
        ])
      : undefined);
  const editDraft: ChatComposerProps["onDraft"] = (text, origin = "edit") => {
    if (origin === "history") {
      // Keep the entry we left in memory; the displayed history prompt is text only.
      setEntry((prior) => ({ text, parked: prior.parked ?? prior }));
    } else if (origin === "restore") {
      setEntry((prior) =>
        prior.parked?.text === text ? prior.parked : { text },
      );
    } else {
      setEntry((prior, origins) => {
        if (origin === "native-history")
          return {
            text,
            source:
              discussionPath === "chat" &&
              origins.get(text.trim()) === discussionSource
                ? discussionSource
                : undefined,
          };
        const source =
          discussionSource ??
          (!imageDraft.files.length ? phraseSource : undefined);
        // The whole phrase (including intermediate keystrokes) must come
        // from this context. Editing its margins doesn't re-author the text.
        if (origin === "replace" || !prior.text.trim()) return { text, source };
        return {
          text,
          source:
            prior.text.trim() === text.trim() || prior.source === source
              ? prior.source
              : undefined,
        };
      });
    }
  };
  const latestSource = useRef(phraseSource);
  latestSource.current = phraseSource;
  const phraseCurrent = () =>
    !!entry.source &&
    entry.source === phraseSource &&
    phraseSource === latestSource.current;
  const refusePhrase = () =>
    refuse(
      t(
        !proposal
          ? "No plan is awaiting approval."
          : approvalAction === "readonly"
            ? "This plan is read-only. A new proposal is required for implementation."
            : "This draft does not confirm the current plan. Review it from the conversation title and enter the approval phrase again.",
      ),
    );
  const validationPending =
    !!validation && !!state && state.revision < validation.after.revision;
  const canValidatePlan =
    !!state?.proposal &&
    canSend &&
    cadenceKnown &&
    planApprovable &&
    !approving &&
    !revalidating &&
    !validationPending &&
    (!!prepareForPlan || actionsReady) &&
    !!(draftModel ?? context?.model);
  const approvalHint = historicalBranch
    ? t("Show the latest branch before acting on the current plan.")
    : revalidating
      ? t(
          "Preparing execution and validating the plan; no implementation is approved.",
        )
      : validationPending
        ? t("Reading the validated plan…")
        : modelPending
          ? t("Validate the plan with this model before approving it.")
          : summary?.status === "unknown"
            ? t(
                "The latest turn's outcome is unknown. Approval waits until it is observed.",
              )
            : !actionsReady
              ? t(
                  "Read the current execution state before approving this plan.",
                )
              : !cadenceKnown
                ? t("Cadence state unavailable")
                : running
                  ? t("Wait for the current reply before approving this plan.")
                  : approving
                    ? t("Observing plan approval…")
                    : !canSend
                      ? t(
                          "Read the current conversation context before approving this plan.",
                        )
                      : undefined;
  const textarea = useRef<HTMLTextAreaElement>(null),
    scroll = useRef<HTMLDivElement>(null),
    lastTop = useRef(0);
  const stick = useRef(true),
    [away, setAway] = useState(false);
  // A scroll event for our own write can arrive after the row has grown
  // again (opening placeholder → loaded detail), before its resize observer.
  // Match the clamped offset, not the now obsolete distance from the end.
  const followedTop = useRef<number | null>(null);
  // Observing a row again can deliver a resize even if nothing grew. While
  // within the follow boundary, move only for a new end or explicit Latest.
  const previousEnd = useRef<number | null>(null);
  const keepEnd = useCallback((explicit = false) => {
    const el = scroll.current;
    if (!el) return;
    const end = el.scrollHeight - el.clientHeight;
    if (stick.current && (explicit || end !== previousEnd.current)) {
      followLatest(el, true);
      followedTop.current = el.scrollTop;
    }
    previousEnd.current = end;
  }, []);
  // `display: none` drops the scroll offset; restore it when the view returns.
  useLayoutEffect(() => {
    if (!hidden && scroll.current && !stick.current)
      scroll.current.scrollTop = lastTop.current;
  }, [hidden]);
  const sentDraft = useRef(draft);

  useEffect(() => {
    alive.current = true;
    if (departure.current.signal.aborted)
      departure.current = new AbortController();
    return () => {
      alive.current = false;
      departure.current.abort();
    };
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(`${draftKey}:mode`, mode);
    } catch {
      /* local preference only */
    }
  }, [draftKey, mode]);
  useEffect(() => {
    try {
      sessionStorage.setItem(draftKey, draft);
    } catch {
      /* draft still usable in memory */
    }
  }, [draft, draftKey]);
  useEffect(() => {
    try {
      if (pending) sessionStorage.setItem(`${draftKey}:pending`, pending);
      else sessionStorage.removeItem(`${draftKey}:pending`);
    } catch {
      /* no automatic replay */
    }
  }, [draftKey, pending]);
  useEffect(() => {
    try {
      if (pending && modelCommand === pending)
        sessionStorage.setItem(`${draftKey}:model-command`, modelCommand);
      else sessionStorage.removeItem(`${draftKey}:model-command`);
    } catch {
      /* Unknown receipt kind conservatively keeps a local choice. */
    }
  }, [draftKey, pending, modelCommand]);
  useEffect(() => {
    if (reference) {
      setDraft((previous) => `${previous}${previous ? "\n" : ""}@${reference}`);
      onReferenceUsed();
      textarea.current?.focus();
    }
  }, [reference, onReferenceUsed, setDraft]);
  useEffect(() => {
    if (attempted.current && state?.runs.includes(attempted.current)) {
      rememberApproval("");
      setError("");
    }
    if (
      pending &&
      (summary?.live?.commandId === pending ||
        conversation.attempt?.commandId === pending ||
        turns.some((turn) => turn.header.id === pending) ||
        conversation.commands.includes(pending))
    ) {
      setPending("");
      if (modelDraftConsumed(pending, modelCommand)) {
        setReceived(pending);
        setReview(null);
        setDraftModel(null);
      }
      setModelCommand("");
      removeImages(sentImages.current);
      setDraft((value) => (value === sentDraft.current ? "" : value));
      // Only a message carries the model marker; leaving Cadence does not.
      if (modelDraftConsumed(pending, modelCommand))
        pushPromptHistory(workspaceId, sentDraft.current);
      // The composer stayed locked since that Send, so an anchor still set is
      // the one it used: the reply's branch is followed as the latest.
      acts.current.followAnchor();
    }
  }, [
    summary,
    turns,
    pending,
    modelCommand,
    state,
    conversation,
    removeImages,
    workspaceId,
    rememberApproval,
    setDraft,
  ]);
  // Turns render lazily: those far outside the viewport keep only their height.
  const rows = useMemo(
    () =>
      turns.map((turn) => ({
        // Read/navigation coordinate, shared by LazyMount, measurements and
        // jump pins. The Fragment below has a separate stable render identity.
        id: turn.header.id,
        role: "assistant",
        version: turn.steps.reduce(
          (size, step) => size + step.text.length + 1,
          turn.header.status.length,
        ),
        turn,
      })),
    [turns],
  );
  const lazy = useLazyWindow(
    scroll,
    rows,
    jump?.id ?? null,
    undefined,
    keepEnd,
  );
  // Earlier turns load while the reader is near the top, on scroll and after
  // each render (a short transcript fills itself); no page is ever switched.
  const { earlier, loadEarlier } = conversation;
  const nearTop = () => {
    const el = scroll.current;
    if (el && !hidden && earlier && el.scrollTop < 1200) loadEarlier();
  };
  useEffect(nearTop);
  // The question the transcript is at: the last one at its end, else the
  // turn that has reached the top of the view.
  const tracking = useRef(0);
  const trackActive = () => {
    if (tracking.current) return;
    tracking.current = requestAnimationFrame(() => {
      tracking.current = 0;
      const el = scroll.current;
      if (!el) return;
      let at: string | null = null;
      if (!stick.current) {
        const line = el.getBoundingClientRect().top + 140;
        for (const row of el.querySelectorAll<HTMLElement>("[data-lazy-id]")) {
          if (at !== null && row.getBoundingClientRect().top > line) break;
          at = row.dataset.lazyId ?? null;
        }
      }
      setActiveTurn(at);
    });
  };
  useEffect(
    () => () => {
      if (tracking.current) cancelAnimationFrame(tracking.current);
    },
    [],
  );
  // Scroll to the row jumped to once it is mounted at its real height.
  useEffect(() => {
    if (!jump) return;
    const frame = requestAnimationFrame(() => {
      const row = [
        ...(scroll.current?.querySelectorAll<HTMLElement>("[data-lazy-id]") ??
          []),
      ].find((el) => el.dataset.lazyId === jump.id);
      if (!row) return;
      stick.current = false;
      row.scrollIntoView({ block: "start" });
      row.classList.remove("msg-flash");
      void row.offsetWidth;
      row.classList.add("msg-flash");
      setActiveTurn(jump.id);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump]);
  // Inserted earlier turns must not move what is being read. Scroll anchoring
  // does this natively; without it the inserted height is skipped here.
  const firstOrdinal = turns[0]?.ordinal;
  const inserted = useRef<{ ordinal?: number; height: number }>({ height: 0 });
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const previous = inserted.current;
    if (
      !NATIVE_ANCHORING &&
      !stick.current &&
      previous.ordinal !== undefined &&
      firstOrdinal !== undefined &&
      firstOrdinal < previous.ordinal
    )
      el.scrollTop += el.scrollHeight - previous.height;
    // Include workflow lines, notices and queued inputs outside observed rows.
    if (!hidden) keepEnd();
    inserted.current = { ordinal: firstOrdinal, height: el.scrollHeight };
  });
  useEffect(() => {
    try {
      // 2.0.21 kept an approval lock here that could outlive its request.
      sessionStorage.removeItem(`${draftKey}:approval`);
    } catch {
      /* storage is advisory */
    }
  }, [draftKey]);
  // Workflows of this session: the browser's and those the terminal started.
  const runs = useMemo(
    () => [...new Set([...conversation.runs, ...(state?.runs ?? [])])],
    [conversation.runs, state?.runs],
  );
  // Each workflow is one line after the turn it started in. Each list's newest
  // are read first; older ones only once the turns shown could hold them.
  const [windows, setWindows] = useState({
    terminal: RUN_WINDOW,
    browser: RUN_WINDOW,
  });
  const watched = useMemo(
    () => [
      ...new Set([
        ...activeWorkflowIds,
        ...conversation.runs.slice(-windows.terminal),
        ...(state?.runs ?? []).slice(-windows.browser),
        ...(approving ? [approving] : []),
      ]),
    ],
    [activeWorkflowIds, conversation.runs, state?.runs, windows, approving],
  );
  const flows = useWorkflowRuns(reader, id, available ? watched : []);
  // Share one verified observation with the dock; copied terminal entries
  // are not ownership, and the dock need not read these runs a second time.
  const agentsUnavailable =
    !available ||
    !observed ||
    !!conversation.error ||
    !cadenceKnown ||
    !!flows.error ||
    flows.incomplete;
  useEffect(() => {
    if (!onAgents) return;
    const recent = runs.filter((runId) => flows.runs.has(runId)).slice(-4);
    onAgents({
      groups: dockGroups([...activeWorkflowIds, ...recent], flows.runs),
      unavailable: agentsUnavailable,
    });
  }, [runs, activeWorkflowIds, flows.runs, agentsUnavailable, onAgents]);
  const contextError = available ? contextRead.error : undefined;
  const headError = available ? conversation.error || undefined : undefined;
  const workflowError = available ? workflow.error : undefined;
  const runsError = available ? flows.error : undefined;
  const retryRead = useRef(() => {});
  retryRead.current = () => {
    if (!alive.current || access?.signal.aborted) return;
    if (contextError) contextRead.refresh();
    if (headError) conversation.refresh();
    if (workflow.error) workflow.refresh();
    if (runsError) flows.refresh();
  };
  useEffect(() => {
    onDiagnostics?.({
      context: contextError,
      head: headError,
      prepareOnly: canPrepareOnly,
      workflow: workflowError,
      runs: runsError,
      retry: () => retryRead.current(),
    });
  }, [
    contextError,
    headError,
    workflowError,
    runsError,
    canPrepareOnly,
    onDiagnostics,
  ]);
  const hasRecord =
    !!summary ||
    conversation.count > 0 ||
    turns.length > 0 ||
    !!conversation.attempt ||
    conversation.pending.length > 0 ||
    conversation.undelivered.length > 0 ||
    conversation.commands.length > 0 ||
    runs.length > 0 ||
    activeWorkflowIds.length > 0 ||
    !!proposal ||
    !!state?.design ||
    !!state?.head ||
    !!state?.notice;
  const observedEmpty =
    available &&
    conversation.summary === null &&
    !conversation.error &&
    !hasRecord &&
    !activitySelected;
  // Keep an already-observed first draft in place across preparation or a
  // failed read. Never infer a new conversation from an unread history.
  const wasEmpty = useRef(false);
  useLayoutEffect(() => {
    if (observedEmpty || hasRecord) wasEmpty.current = observedEmpty;
  }, [observedEmpty, hasRecord]);
  const centerEntry =
    !received &&
    !hasRecord &&
    !activitySelected &&
    (observedEmpty || wasEmpty.current);
  // Animate from the editor's actual last position, not a guessed viewport
  // midpoint. Layout itself stays final (including the scroll/follow area).
  const dock = useRef<HTMLDivElement>(null);
  const entryTop = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = dock.current;
    if (!el || hidden) {
      entryTop.current = null;
      return;
    }
    if (centerEntry) {
      entryTop.current = el.getBoundingClientRect().top;
    } else if (entryTop.current !== null) {
      const from = entryTop.current;
      entryTop.current = null;
      if (
        (received || summary) &&
        window.matchMedia("(prefers-reduced-motion: no-preference)").matches
      ) {
        const delta = from - el.getBoundingClientRect().top;
        if (Math.abs(delta) > 1)
          el.animate?.(
            [{ transform: `translateY(${delta}px)` }, { transform: "none" }],
            { duration: 240, easing: "ease-out" },
          );
      }
    }
  });
  const firstAt = turns.find((turn) => turn.header.at > 0)?.header.at;
  const allTurns = !earlier && turns.length > 0;
  useEffect(() => {
    if (!available) return;
    const grown = (ids: readonly string[], size: number) =>
      nextRunWindow(ids, size, flows.runs, flows.unreadable, firstAt, allTurns);
    const terminal = grown(conversation.runs, windows.terminal),
      browser = grown(state?.runs ?? [], windows.browser);
    if (terminal !== windows.terminal || browser !== windows.browser)
      setWindows({ terminal, browser });
  }, [
    available,
    conversation.runs,
    state?.runs,
    windows,
    flows,
    firstAt,
    allTurns,
  ]);
  const placed = useMemo(
    () => placeWorkflows(turns, flows.runs.values(), earlier),
    [turns, flows.runs, earlier],
  );
  const workflowLine = (run: WorkflowRun) => (
    <WorkflowLine
      key={run.id}
      client={client}
      run={run}
      canCancelWorkflow={canCancelWorkflow}
      onOpen={() =>
        onOpenAgent?.({ runId: run.id, stepId: null, label: run.goal })
      }
      onChanged={() => {
        workflow.refresh();
        onChanged();
      }}
    />
  );
  const validatePlan = async () => {
    if (
      !canValidatePlan ||
      !state?.proposal ||
      !context ||
      latestState.current?.revision !== state.revision ||
      decisionBusy.current
    )
      return;
    const model = draftModel ?? context.model;
    if (!model) return;
    const proposal = state.proposal;
    const observed = state;
    const generation = sendGeneration.current;
    // The owner checks the captured revision/head. Its own successful write
    // may already reach polling before this command's reply comes back.
    let authority = viewer;
    const prepare = !actionsReady ? prepareForPlan : undefined;
    let prepared = !prepare;
    const current = () =>
      alive.current &&
      !renderedBranch.aborted &&
      sendGeneration.current === generation &&
      (prepared
        ? !authority || authority.current()
        : !viewer?.allocation?.aborted);
    if (!current()) return;
    decisionBusy.current = true;
    setBusy(true);
    setRevalidating(true);
    clearError();
    try {
      const next = await revalidateWorkflow({
        client,
        state: observed,
        context,
        model,
        head: conversation.leaf,
        signal: departure.current.signal,
        current,
        prepare: prepare
          ? async (...args) => {
              authority = (await prepare(...args)) || undefined;
              if (viewer && !authority) throw new Error("stale");
              prepared = true;
            }
          : undefined,
      });
      if (!alive.current || sendGeneration.current !== generation) return;
      setValidation({ before: proposal, after: next });
      setInvalidatedPlan("");
      setDraftModel((value) =>
        canonicalJson(value) === canonicalJson(model) ? null : value,
      );
    } catch (error) {
      if (alive.current && sendGeneration.current === generation)
        setError(
          t(
            "Plan validation did not finish ({code}). No implementation was approved; observe the plan before trying again.",
            {
              code: error instanceof Error ? error.message : "unavailable",
            },
          ),
        );
    } finally {
      if (alive.current && sendGeneration.current === generation) {
        decisionBusy.current = false;
        setBusy(false);
        setRevalidating(false);
        setModelReads((n) => n + 1);
        contextRead.refresh();
        workflow.refresh();
        conversation.refresh();
        onChanged();
      }
    }
  };
  const approve = async () => {
    if (historicalBranch) {
      refuse(t("Show the latest branch before acting on the current plan."));
      return;
    }
    if (!state?.proposal) {
      refuse(t("No plan is awaiting approval."));
      return;
    }
    if (approvalAction === "readonly") return;
    if (approvalAction !== "approve") {
      await validatePlan();
      return;
    }
    if (
      decisionBusy.current ||
      validationPending ||
      modelPending ||
      !actionsReady ||
      !cadenceKnown ||
      !canSend ||
      running ||
      approving ||
      !planApprovable
    )
      return;
    const proposal = state.proposal;
    const observed = state;
    const generation = sendGeneration.current;
    decisionBusy.current = true;
    setBusy(true);
    clearError();
    try {
      const reply = await approveWorkflow({
        client,
        state: observed,
        current: () =>
          alive.current &&
          sendGeneration.current === generation &&
          !renderedBranch.aborted &&
          (!viewer || viewer.current()) &&
          latestSource.current === phraseSource &&
          latestState.current?.revision === observed.revision &&
          latestState.current?.enabled === true,
        submitting: rememberApproval,
      });
      if (!alive.current || sendGeneration.current !== generation) return;
      if (reply.kind === "error") {
        // A lost reply may still have started the run; the observation shows it.
        setError(reply.error.code);
        if (reply.error.effect === "none") {
          rememberApproval("");
          if (reply.error.code === "stale") setInvalidatedPlan(proposal.id);
        }
      } else
        setEntry((value) =>
          phraseSource &&
          value.source === phraseSource &&
          cadenceApproval(value.text)
            ? { text: "" }
            : value,
        );
    } catch (e) {
      if (alive.current && sendGeneration.current === generation) {
        setError(e instanceof Error ? e.message : "unavailable");
        if (!attempted.current && e instanceof Error && e.message === "stale")
          setInvalidatedPlan(proposal.id);
      }
    } finally {
      if (alive.current && sendGeneration.current === generation) {
        decisionBusy.current = false;
        setBusy(false);
        workflow.refresh();
        conversation.refresh();
        onChanged();
      }
    }
  };
  const editDesign = async (answers: DesignAnswer[]) => {
    if (!state?.design || decisionBusy.current || renderedBranch.aborted)
      return;
    if (
      !actionsReady ||
      (viewer && !viewer.current()) ||
      latestState.current?.revision !== state.revision
    ) {
      workflow.refresh();
      return;
    }
    clearError();
    const generation = sendGeneration.current;
    decisionBusy.current = true;
    setBusy(true);
    try {
      const response = await client.workbenchCommand({
        kind: "cadence-design-edit",
        commandId: crypto.randomUUID(),
        conversationId: id,
        revision: state.revision,
        designId: state.design.id,
        answers,
      });
      if (!alive.current || generation !== sendGeneration.current) return;
      if (response.kind !== "ok") {
        if (
          response.error.code === "stale" &&
          response.error.effect === "none"
        ) {
          setEditedState(undefined);
          refuse(t("The choices changed before this answer was saved."));
          return;
        }
        throw new Error(response.error.code);
      }
      if (
        response.value.kind !== "cadence-conversation" ||
        response.value.state.id !== id
      )
        throw new Error("stale");
      setEditedState(response.value.state);
    } catch (e) {
      if (alive.current && generation === sendGeneration.current)
        setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      if (alive.current && generation === sendGeneration.current) {
        decisionBusy.current = false;
        setBusy(false);
        workflow.refresh();
      }
    }
  };
  const send = async (
    override?: string,
    retained?: PendingSend,
    submitDesign = false,
  ) => {
    const message = retained?.text ?? override ?? draft;
    const images = retained?.images ?? (override ? [] : imageDraft.files);
    const exiting = retained
      ? retained.command.kind === "cadence-exit"
      : cadence && cadenceExit(message);
    const phrase =
      !images.length && !retained && !override && cadenceApproval(message);
    if (phrase && !phraseCurrent()) {
      refusePhrase();
      return;
    }
    if (
      (!(exiting ? canExit : canSend) && !canPrepareOnly) ||
      running ||
      // A rewritten message waits for its own images.
      (attaching && !retained) ||
      (!message.trim() && !images.length)
    )
      return;
    if (
      retained &&
      (!canSend ||
        modelWaitDisposition(retained, latestAvailability.current) !== "ready")
    )
      return;
    if (exiting && images.length) {
      refuse(t("Remove images before exiting Cadence."));
      return;
    }
    if (phrase && cadence) {
      await approve();
      return;
    }
    const selecting = cadenceInput(message, mode).mode === "cadence";
    if (!canPrepareOnly && (cadence || selecting) && !cadenceKnown) {
      refuse(
        t(
          "Cadence state unavailable. Observe the conversation before sending.",
        ),
      );
      return;
    }
    if (
      sending.current ||
      !alive.current ||
      renderedBranch.aborted ||
      viewer?.allocation?.aborted
    )
      return;
    if ((!prepareForSend || retained) && viewer && !viewer.current()) return;
    if (retained && waitingViewer.current?.allocation !== viewer?.allocation)
      return;
    sending.current = true;
    setBusy(true);
    clearError();
    const generation = sendGeneration.current;
    const current = () =>
      alive.current && sendGeneration.current === generation;
    let authority = viewer;
    const admissible = () => current() && (!authority || authority.current());
    const check = (epoch?: string) => {
      if (!admissible() || (epoch && authority && authority.epoch !== epoch))
        throw new Error("stale");
    };
    let dispatched = false;
    let preparation: PreparationStage = "not-dispatched";
    // Only `effect: none` proves the owner took nothing.
    const sendRefused = (code: string, effect?: string) => {
      const text = t(sendFailureMessage(effect), { code });
      if (effect === "none") refuse(text);
      else setError(text);
    };
    const pendingCommand = (id: string) => {
      if (current()) {
        setPending(id);
        setModelCommand(id && !exiting ? id : "");
      }
    };
    const prepare = async (location?: ConversationLocation) => {
      if (!prepareForSend) return;
      setPreparing(true);
      await waitForPreparation(
        async (...args) => {
          authority = (await prepareForSend(...args)) || undefined;
          if (viewer && !authority) throw new Error("stale");
        },
        departure.current.signal,
        location,
        (stage) => {
          preparation = stage;
        },
      );
      if (current()) {
        setPreparing(false);
        setModelReads((n) => n + 1);
      }
    };
    try {
      if (canPrepareOnly) {
        await prepare(context ? { id, cwd: context.cwd } : undefined);
        if (!current()) return;
        conversation.refresh();
        contextRead.refresh();
        workflow.refresh();
        onChanged();
        setError(
          t(
            "Execution was prepared, but the conversation was unreadable before Send. Review its restored context and send again; this message was not sent.",
          ),
        );
        return;
      }
      let intent =
        retained ??
        captureSend({
          id,
          // The anchor when one is set, else the end of the branch shown.
          // Leaving Cadence is no message: it never starts a branch.
          head: exiting
            ? conversation.leaf
            : sendHead(anchor, conversation.leaf),
          text: message,
          images,
          revision: state?.revision ?? 0,
          location: context ? { id, cwd: context.cwd } : undefined,
          installModel: !!draftModel,
          model:
            draftModel ??
            (modelRead.catalog?.selected
              ? selector(modelRead.catalog.selected)
              : (modelRead.catalog?.remembered ??
                context?.model ??
                modelRead.preview?.remembered ??
                undefined)),
          intent: submitDesign
            ? "design"
            : exiting
              ? "exit"
              : cadence
                ? "message"
                : selecting
                  ? "enter"
                  : "ordinary",
        });
      if (retained) {
        if (
          modelWaitDisposition(retained, latestAvailability.current) !== "ready"
        )
          throw new Error("stale");
      } else await prepare(intent.location);
      if (!current()) return;
      check();
      if (intent.command.kind === "cadence-exit") {
        const command = sendCommand(intent);
        sentDraft.current = message;
        dispatched = true;
        const reply = await dispatchSend(client, command, pendingCommand);
        if (!current()) return;
        if (reply.kind === "error") {
          sendRefused(reply.error.code, reply.error.effect);
        } else {
          setPending("");
          setMode("chat");
          setDraft((value) => (value === message ? "" : value));
        }
        workflow.refresh();
        conversation.refresh();
        onChanged();
        return;
      }
      const chooseFirst = (epoch?: string) => {
        const observed = latestAvailability.current;
        const prepared =
          epoch ?? (observed.status === "ready" ? observed.epoch : undefined);
        if (
          prepared &&
          modelWaitDisposition(waitingModelSend(intent, prepared), observed) !==
            "cancel"
        ) {
          waitingViewer.current = authority;
          waitingSend.current = waitingModelSend(intent, prepared);
          setAwaitingModel(true);
        } else {
          clearModelWait();
          refuse(
            t(
              "The connection changed. Your model choice and draft are kept; send again when ready.",
            ),
          );
        }
        openModels(true);
      };
      let catalog = await client.models(undefined, intent.location);
      if (!current()) return;
      check(catalog.kind === "ok" ? catalog.value.version.epoch : undefined);
      if (
        intent.preparedEpoch &&
        catalog.kind === "ok" &&
        catalog.value.version.epoch !== intent.preparedEpoch
      )
        throw new Error("stale");
      const offered =
        catalog.kind === "ok"
          ? (catalog.value.selected ?? catalog.value.remembered)
          : null;
      if (!intent.model && offered) intent = withSendModel(intent, offered);
      if (intent.installModel && catalog.kind === "ok") {
        catalog = {
          kind: "ok",
          value: await installSendModel(
            client,
            intent,
            catalog.value,
            admissible,
          ),
        };
        if (!current()) return;
        setModelReads((n) => n + 1);
      }
      // Restore only this Send's exact displayed choice, never a newer global
      // default or another conversation's selection.
      const restoreChoice =
        intent.model ??
        (catalog.kind === "ok" ? catalog.value.remembered : null);
      if (catalog.kind === "ok" && !catalog.value.selected && restoreChoice) {
        check(catalog.value.version.epoch);
        const restored = await client.workbenchCommand({
          kind: "restore-model",
          commandId: crypto.randomUUID(),
          epoch: catalog.value.version.epoch,
          ...(intent.location
            ? {
                location: intent.location,
                expected: catalog.value.version,
                choice: restoreChoice,
              }
            : {}),
        });
        if (!current()) return;
        if (restored.kind === "error") {
          setError(restored.error.code);
          chooseFirst(catalog.value.version.epoch);
          return;
        }
        catalog = await client.models(undefined, intent.location);
        if (!current()) return;
        setModelReads((n) => n + 1);
      }
      if (catalog.kind !== "ok" || !catalog.value.selected) {
        chooseFirst(
          catalog.kind === "ok" ? catalog.value.version.epoch : undefined,
        );
        return;
      }
      check(catalog.value.version.epoch);
      assertSendModel(intent, catalog.value.selected);
      let command = sendCommand(intent, catalog.value.version);
      if (intent.images.length) {
        const selected = catalog.value.selected;
        if (
          !catalog.value.entries.some(
            (m) =>
              m.provider === selected?.provider &&
              m.model === selected?.model &&
              m.images,
          )
        ) {
          refuse(
            t(
              "The selected model does not support images. Choose a vision model or remove the images.",
            ),
          );
          return;
        }
        if (command.kind === "cadence-exit") throw new Error("invalid");
        command = await uploadImages(
          client,
          command,
          intent.images,
          admissible,
        );
        if (!current()) return;
      }
      check(catalog.value.version.epoch);
      sentImages.current = intent.images;
      sentDraft.current = message;

      dispatched = true;
      const reply = await dispatchSend(client, command, pendingCommand);
      if (!current()) return;
      if (reply.kind === "error") {
        sendRefused(reply.error.code, reply.error.effect);
        // Even a lost reply can have accepted work. Observe this exact turn ID.
      } else {
        setReceived(command.commandId);
        removeImages(sentImages.current);
        setDraftModel(null);
        setDraft((value) => (value === sentDraft.current ? "" : value));
        setPending("");
        if (command.kind === "cadence-send") {
          setMode("chat");
        }
        if (!override) pushPromptHistory(workspaceId, message);
        // The new reply ends the branch: follow it as the session's latest.
        // An anchor is used up, and the draft set aside for it comes back.
        chooseBranch(null);
      }
      workflow.refresh();
      conversation.refresh();
      onChanged();
    } catch (error) {
      if (current()) {
        const code = error instanceof Error ? error.message : "unavailable";
        const effect = preparationEffect(error);
        const text = t(
          dispatched
            ? sendFailureMessage()
            : unsentMessage(preparation, effect),
          { code },
        );
        // A pre-dispatch failure or reliable no-effect refusal changed nothing.
        if (
          !dispatched &&
          (preparation === "not-dispatched" || effect === "none")
        )
          refuse(text);
        else setError(text);
      }
    } finally {
      if (sendGeneration.current === generation) sending.current = false;
      if (current()) {
        setBusy(false);
        setPreparing(false);
      }
    }
  };
  const sendLatest = useRef(send);
  sendLatest.current = send;
  // Preview and installed choices share the same original continuation. Stop
  // or an epoch change retires it; a model click never starts another owner.
  useEffect(() => {
    const waiting = waitingSend.current;
    if (!waiting || (!resume && !awaitingModel)) return;
    const disposition = modelWaitDisposition(waiting, availability);
    if (disposition === "cancel") {
      waitingSend.current = null;
      setAwaitingModel(false);
      setResume(false);
      notify(
        "error",
        t(
          "The connection changed. Your model choice and draft are kept; send again when ready.",
        ),
        toastKey,
      );
    } else if (resume && disposition === "ready" && canSend && !running) {
      setResume(false);
      waitingSend.current = null;
      void sendLatest.current(undefined, waiting);
    }
  }, [resume, awaitingModel, canSend, running, availability, t, toastKey]);
  // Never a late surprise: if sending stays impossible, the message waits.
  useEffect(() => {
    if (!resume) return;
    const timer = setTimeout(() => {
      setResume(false);
      waitingSend.current = null;
    }, 10000);
    return () => clearTimeout(timer);
  }, [resume]);
  // ---- Messages into the reply that is running ----
  const flow =
    typeof replyClock === "number" &&
    summary?.status === "running" &&
    turns.at(-1)?.ordinal === conversation.count - 1 &&
    lastTurn?.status === "running" &&
    (lastTurn.activity?.kind === "tool" ||
      lastTurn.activity?.kind === "thinking");
  const liveRun = running ? summary?.live : undefined;
  // The whole text of messages this tab sent, which the head read may clip.
  const sentInputs = useRef(new Map<string, string>());
  const inputBlock = inputRefusal({
    images: imageDraft.files.length,
    modeChange: cadence ? cadenceExit(draft) : input.mode === "cadence",
    anchored: !!anchor,
    waiting: conversation.pending.length,
  });
  const turn = useRef(liveRun);
  turn.current = liveRun;
  const pendingInputs = useRef(conversation.pending);
  pendingInputs.current = conversation.pending;
  const turnCurrent = () =>
    !!liveRun &&
    alive.current &&
    !renderedBranch.aborted &&
    canInterrupt &&
    (!viewer || viewer.attached(liveRun.epoch)) &&
    turn.current?.commandId === liveRun.commandId &&
    turn.current?.epoch === liveRun.epoch;
  const inputCurrent = () =>
    turnCurrent() && actionsReady && (!viewer || viewer.current());
  const canInput = inputCurrent() && !busy && !pending && !attaching;
  const sendInput = async (mode: InputMode) => {
    if (!liveRun || !canInput || !inputCurrent() || inputBlock || !draft.trim())
      return;
    if (cadenceApproval(draft) && !phraseCurrent()) {
      refusePhrase();
      return;
    }
    clearError();
    setBusy(true);
    const text = draft;
    const command = inputCommand(id, liveRun, mode, text);
    const reply = await client.workbenchCommand(command);
    const outcome =
      reply.kind === "ok" && reply.value.kind !== "accepted"
        ? { kind: "unknown" as const, code: "unavailable" }
        : inputOutcome(reply);
    if (!alive.current) return;
    setBusy(false);
    if (outcome.kind === "accepted") {
      if (!renderedBranch.aborted) setReceived(command.commandId);
      sentInputs.current.set(command.commandId, text);
      pushPromptHistory(workspaceId, text);
      setDraft("");
    } else if (outcome.kind === "refused")
      refuse(
        t(
          "The running reply did not take the message ({reason}). Your text stays here.",
          { reason: describeError(t, outcome.code) },
        ),
      );
    // Unknown: the text stays, and the next read shows whether it waits.
    else setError(outcome.code);
    conversation.refresh();
  };
  const withdrawInput = async (waiting: ChatPending, recall: boolean) => {
    if (
      !liveRun ||
      busy ||
      !inputCurrent() ||
      !pendingInputs.current.some(
        (item) => item.commandId === waiting.commandId,
      )
    )
      return;
    setBusy(true);
    const outcome = inputOutcome(
      await client.workbenchCommand(
        withdrawCommand(id, liveRun, waiting.commandId),
      ),
    );
    if (!alive.current) return;
    setBusy(false);
    if (outcome.kind === "accepted") {
      const whole = sentInputs.current.get(waiting.commandId) ?? waiting.text;
      sentInputs.current.delete(waiting.commandId);
      // Never over text typed since.
      if (recall) setDraft((current) => (current.trim() ? current : whole));
    } else if (outcome.kind === "refused")
      refuse(
        outcome.code === "conflict"
          ? t(
              "That message has already been handed to the model and can no longer be withdrawn.",
            )
          : t("The message was not withdrawn ({reason}).", {
              reason: describeError(t, outcome.code),
            }),
      );
    else setError(outcome.code);
    conversation.refresh();
  };
  const restoreUndelivered = (text: string) => {
    setDraft((current) => (current.trim() ? `${current}\n${text}` : text));
    textarea.current?.focus();
  };
  const interrupt = async () => {
    const live = summary?.live;
    if (!live || busy || !turnCurrent()) return;
    setBusy(true);
    const result = await client.workbenchCommand({
      kind: "interrupt",
      commandId: crypto.randomUUID(),
      conversationId: id,
      turnId: live.commandId,
      epoch: live.epoch,
    });
    if (!alive.current) return;
    if (result.kind === "error") setError(result.error.code);
    setBusy(false);
    conversation.refresh();
  };
  // Changes the branch shown: readonly. An anchor belongs to the branch it
  // was set on, so it is released and the draft set aside for it comes back.
  // `first` is the oldest turn to show at once, for a branch entered at one of
  // its messages.
  const chooseBranch = (leaf: string | null, first?: number) => {
    ++sendGeneration.current;
    departure.current.abort();
    departure.current = new AbortController();
    waitingSend.current = null;
    sending.current = false;
    decisionBusy.current = false;
    setRevalidating(false);
    setValidation(undefined);
    setReview(null);
    wasEmpty.current = false;
    setAwaitingModel(false);
    setResume(false);
    setModelOpen(false);
    setBusy(false);
    setPreparing(false);
    releaseAnchor();
    if (leaf !== (conversation.pinned ? conversation.leaf : null))
      retireTraceChoices();
    conversation.choose(leaf, first);
    rememberBranch(id, leaf);
  };
  // An anchor may move only while nothing of this conversation is in flight.
  const canAnchor = !running && !busy && !pending && !awaitingModel;
  const toComposer = () => {
    clearError();
    textarea.current?.focus();
  };
  const startContinue = (turn: LoadedTurn) => {
    if (!canAnchor || !turn.header.entry) return;
    // After the newest turn is where a message goes anyway.
    if (turn.ordinal >= conversation.count - 1) releaseAnchor();
    else sendAnchor.continueAfter(turn);
    toComposer();
  };
  const startEdit = (turn: LoadedTurn) => {
    if (!canAnchor) return;
    const previous = turns.find((other) => other.ordinal === turn.ordinal - 1);
    if (sendAnchor.edit(turn, previous)) toComposer();
    else
      refuse(
        t(
          "This message cannot be rewritten from here: the entry it continued is not known.",
        ),
      );
  };
  // Brings a message of the session into view: its branch is shown first
  // when it is on another one, and its turn read when it is not shown yet.
  // `then` may also move the anchor to it.
  const show = (messageId: string, then: Target["then"]) =>
    setTarget({ id: messageId, then });
  // Another version of a message: its branch, opened at that same turn.
  const stepVersion = (turnId: string, step: -1 | 1) => {
    const list = versions.get(turnId) ?? [];
    const next = list[list.findIndex((node) => node.id === turnId) + step];
    if (!next) return;
    chooseBranch(
      next.leaf === summary?.leaf ? null : next.leaf,
      turns.find((turn) => turn.header.id === turnId)?.ordinal,
    );
    show(next.id, "show");
  };
  acts.current = {
    chooseBranch,
    followAnchor() {
      if (sendAnchor.current()) chooseBranch(null);
    },
    show,
    stepVersion,
  };
  // Turn rows are memoized: each gets callbacks that never change.
  const continueFrom = useCallback(
    (turnId: string) => acts.current.show(turnId, "continue"),
    [],
  );
  const editFrom = useCallback(
    (turnId: string) => acts.current.show(turnId, "edit"),
    [],
  );
  const versionStep = useCallback(
    (turnId: string, step: -1 | 1) => acts.current.stepVersion(turnId, step),
    [],
  );
  const jumpTo = useCallback(
    (messageId: string) => acts.current.show(messageId, "show"),
    [],
  );
  // The target's turn is shown: act on it and scroll there. Until then the
  // tree of the branch shown says where it is: on another branch, which is
  // then shown, or at a turn of this one, which is then read.
  useEffect(() => {
    if (!target) return;
    const shown = turns.find((turn) => turn.header.id === target.id);
    if (shown) {
      setTarget(null);
      if (target.then === "edit") startEdit(shown);
      else if (target.then === "continue") startContinue(shown);
      setJump({ id: shown.header.id });
      return;
    }
    const giveUp = (why: string) => {
      setTarget(null);
      refuse(why);
    };
    // The conversation's own read error is already shown in the transcript.
    if (conversation.error) return setTarget(null);
    if (!observed || (!turns.length && conversation.count > 0)) return;
    if (!treeRead.current) {
      if (treeRead.error && !treeRead.loading)
        giveUp(describeError(t, treeRead.error));
      return;
    }
    const node = tree?.nodes.find((other) => other.id === target.id);
    if (node && !node.current && !target.switched) {
      chooseBranch(node.leaf === summary?.leaf ? null : node.leaf);
      return setTarget({ ...target, switched: true });
    }
    const ordinal = questionOrdinal(
      questions,
      target.id,
      turns,
      conversation.count,
      newestLive,
    );
    // Not in the tree read, or the turn in its place is another message.
    if (ordinal === undefined || turns.some((turn) => turn.ordinal === ordinal))
      return giveUp(t("That message could not be found in this conversation."));
    conversation.showFrom(ordinal);
  });
  const waitingReason = preparing
    ? t("Preparing execution for this Send…")
    : pending
      ? t("The last Send is not yet confirmed. No message is resent.")
      : awaitingModel
        ? t("Choose a model; your message is sent right after.")
        : busy
          ? t("Working…")
          : undefined;
  const imageLockReason = running
    ? t("Wait for the current reply to finish before adding images.")
    : attaching
      ? t("Reading the message's images…")
      : waitingReason;
  const addImages = (files: File[]) => {
    if (imageLockReason) return refuse(imageLockReason);
    try {
      imageDraft.add(files);
      clearError();
    } catch (error) {
      refuse(tx(error instanceof Error ? error.message : "unavailable"));
    }
  };
  // What the Branches tab shows and may ask for; its callbacks never change.
  const onBranchesRef = useRef(onBranches);
  onBranchesRef.current = onBranches;
  const treeActions = useMemo(
    () => ({
      onShow: (node: ChatTreeNode) => acts.current.show(node.id, "show"),
      onEdit: (node: ChatTreeNode) => acts.current.show(node.id, "edit"),
      onContinue: (node: ChatTreeNode) =>
        acts.current.show(node.id, "continue"),
      onLatest: () => acts.current.chooseBranch(null),
    }),
    [],
  );
  const {
    error: treeError,
    loading: treeLoading,
    refresh: treeRefresh,
  } = treeRead;
  const { pinned } = conversation;
  useEffect(() => {
    onBranchesRef.current?.({
      id,
      tree,
      error: treeError,
      loading: treeLoading,
      pinned,
      canAct: canAnchor,
      onRefresh: treeRefresh,
      ...treeActions,
    });
  }, [
    id,
    tree,
    treeError,
    treeLoading,
    pinned,
    canAnchor,
    treeRefresh,
    treeActions,
  ]);
  // The turns the message being composed will not have in its context. A
  // restored anchor dims nothing unless its own turn is on the branch shown.
  const anchored =
    anchor !== null &&
    (turns.some((turn) => turn.header.id === anchor.turnId) ||
      questions.some((question) => question.id === anchor.turnId))
      ? anchor
      : null;
  const firstOff = anchored
    ? rows.find(({ turn }) => offBranch(anchored, turn.ordinal))?.id
    : undefined;
  const activeQuestion =
    activeTurn === null
      ? questions.length - 1
      : questions.findIndex((question) => question.id === activeTurn);
  const strip = anchor ? (
    <div className="composer-anchor">
      {anchor.kind === "edit" ? (
        <FiEdit2 aria-hidden="true" />
      ) : (
        <FiCornerDownRight aria-hidden="true" />
      )}
      <div className="composer-anchor-text" role="status">
        <strong>
          {anchor.kind === "edit"
            ? t("Rewriting a message")
            : t("Continuing after an earlier turn")}
        </strong>
        {anchor.label && (
          <span className="composer-anchor-quote">{anchor.label}</span>
        )}
        <span>
          {anchor.kind === "edit"
            ? t(
                "Send starts a new branch beside it; that message and the turns after it stay on their branch and are not in the new context.",
              )
            : t(
                "Send starts a new branch after that turn; the turns after it stay on their branch and are not in the new context.",
              )}{" "}
          {t(
            "Only the conversation is rewound: files on disk stay as they are.",
          )}
        </span>
        {attaching && <span>{t("Reading the message's images…")}</span>}
        {anchor.media && (
          <span>
            {t("Attachments that were not retained are not attached again.")}
          </span>
        )}
      </div>
      <button
        type="button"
        className="ghost"
        title={t("Cancel and restore the draft that was here")}
        disabled={busy || !!pending}
        onClick={() => {
          releaseAnchor();
          textarea.current?.focus();
        }}
      >
        {t("Cancel")}
      </button>
    </div>
  ) : pinned && !running ? (
    <div className="composer-anchor quiet">
      <FiGitBranch aria-hidden="true" />
      <div className="composer-anchor-text" role="status">
        <span>
          {t(
            "A chosen branch is shown, not the latest. A message sent now continues from the end of what is shown; the rest stays in the session.",
          )}
        </span>
      </div>
    </div>
  ) : undefined;
  return (
    <section
      className="chat-workspace"
      data-entry={
        centerEntry
          ? "new"
          : received
            ? "received"
            : hasRecord
              ? "history"
              : "unobserved"
      }
      hidden={hidden}
      aria-label={
        !cadenceKnown
          ? t("Conversation")
          : cadence
            ? t("Cadence conversation")
            : t("Ordinary conversation")
      }
    >
      <header
        className="conversation-header"
        title={
          headError && observed
            ? t(
                "Conversation state is not current. Previously read content may be shown; this does not mean work has stopped.",
              )
            : undefined
        }
      >
        <div className="conversation-heading">
          <FiMessageSquare aria-hidden="true" />
          <h2>
            {summary?.title ??
              (activitySelected
                ? t("Discovered session")
                : centerEntry
                  ? t("New conversation")
                  : t("Conversation"))}
          </h2>
        </div>
        {proposal && (
          <button
            className="current-plan-trigger"
            type="button"
            aria-controls={planOpen ? planPanelId : undefined}
            aria-expanded={planOpen}
            title={proposal.plan.goal}
            onClick={() => setReview({ binding, open: !planOpen })}
          >
            <FiFileText aria-hidden="true" />
            {t(planOpen ? "Hide current plan" : "View current plan")}
          </button>
        )}
        <div className="conversation-branch">
          {/* One quiet line: the mode, then where the session started. */}
          <span className="conversation-meta">
            {!cadenceKnown
              ? workflow.error
                ? t("Cadence state unavailable")
                : ""
              : cadence
                ? t("Cadence on")
                : t("Ordinary")}
            {summary &&
              ` · ${
                summary.origin === "terminal"
                  ? t("Started in the terminal")
                  : t("Started in the WebUI")
              }`}
          </span>
          {status === "starting" && (
            <span className="ep-state starting">{tx(status)}</span>
          )}
          {/* Read by link while the history leaves it out; shown on phones too. */}
          {summary?.archived && (
            <span className="conversation-badge">{t("Archived")}</span>
          )}
          {/* The session forks: its tree is the inspector's Branches tab. */}
          {onOpenBranches && (conversation.branches > 1 || pinned) && (
            <button
              type="button"
              className="ghost"
              aria-label={t("Branches ({count})", {
                count: conversation.branches,
              })}
              title={t("Branches ({count})", { count: conversation.branches })}
              onClick={onOpenBranches}
            >
              <FiGitBranch aria-hidden="true" />
              {conversation.branches}
            </button>
          )}
          {pinned && (
            <button
              type="button"
              className="ghost"
              onClick={() => chooseBranch(null)}
            >
              {t("Show the latest")}
            </button>
          )}
          {!hidden &&
            observed &&
            available &&
            !conversation.error &&
            (!summary || summary.id === id) && (
              <ConversationFeedback
                key={`${id}:${conversation.pinned ? conversation.leaf : "latest"}`}
                receipt={received}
                semantic={
                  cadenceKnown
                    ? JSON.stringify([
                        summary?.status,
                        conversation.count,
                        lastTurn?.activity?.kind,
                        cadence,
                        proposal?.id,
                      ])
                    : undefined
                }
              />
            )}
        </div>
      </header>
      <div
        className="chat-messages-wrap"
        data-reviewing={planOpen || undefined}
      >
        {planOpen && proposal && (
          <div className="current-plan-panel" id={planPanelId}>
            <PlanCard
              key={binding}
              proposal={proposal}
              canApprove={
                !modelPending &&
                actionsReady &&
                canSend &&
                cadenceKnown &&
                planApprovable &&
                !running &&
                !approving &&
                !validationPending &&
                approvalAction === "approve"
              }
              action={approvalAction}
              canValidate={canValidatePlan}
              validating={revalidating}
              previous={
                validation?.after.proposal?.id === proposal.id
                  ? validation.before
                  : undefined
              }
              approvalHint={approvalHint}
              onValidate={() => void validatePlan()}
              onApprove={() => void approve()}
            />
            {error && (
              <p role="alert" className="banner-notice">
                {describeError(t, error)}
              </p>
            )}
          </div>
        )}
        <div
          className="chat-messages"
          inert={planOpen || undefined}
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el && !hidden) {
              lastTop.current = el.scrollTop;
              if (!stick.current || lastTop.current !== followedTop.current)
                stick.current = followsLatest(el);
              followedTop.current = null;
              setAway(!stick.current);
              nearTop();
              trackActive();
            }
          }}
        >
          {activitySelected && !conversation.summary && (
            <p role="status" className="panel-hint">
              {t(
                "Activity was discovered; session history is not yet readable. No transcript was created.",
              )}
            </p>
          )}
          {!available && !observed && (
            <p role="status" className="panel-hint">
              {t(
                "Conversation content has not been read. You can keep a draft; nothing is sent until the context is available.",
              )}
            </p>
          )}
          {available &&
            !conversation.error &&
            (!observed || (turns.length === 0 && conversation.count > 0)) && (
              <p className="inspector-note chat-reading" role="status">
                {t("Reading this conversation…")}
              </p>
            )}
          {turns.length > 0 && earlier && (
            <div className="chat-earlier" role="status">
              {conversation.loadingEarlier && t("Reading earlier messages…")}
            </div>
          )}
          {placed.start.map(workflowLine)}
          {rows.map(({ id, version, turn }, position) => {
            const forks = versions.get(id);
            const renderId = turn.renderId ?? turn.header.id;
            return (
              <Fragment key={renderId}>
                {id === firstOff && (
                  <p className="chat-anchor-divider">
                    <FiGitBranch aria-hidden="true" />
                    {t(
                      "From here on, the turns stay on their branch: the message being written will not have them in its context.",
                    )}
                  </p>
                )}
                <LazyMount
                  id={id}
                  show={!lazy.hidden.has(id) || id === jump?.id}
                  height={lazy.placeholder(id, version, 320)}
                  containerRef={scroll}
                  onMeasured={lazy.recordMeasured}
                  lazyRef={lazy.register(id)}
                >
                  {/* An earlier settled turn offers its end as the place to
                      continue from; a message may be rewritten where the
                      entry it continued is known. */}
                  <ChatTurnView
                    key={traceBranch}
                    reading={away && !hidden}
                    expandedSteps={expandedTraces?.get(renderId)}
                    onExpandSteps={rememberTrace}
                    turn={turn}
                    onContinue={
                      canAnchor &&
                      turn.header.entry &&
                      turn.ordinal < conversation.count - 1
                        ? continueFrom
                        : undefined
                    }
                    onEdit={
                      canAnchor &&
                      editHead(turn, rows[position - 1]?.turn) !== undefined
                        ? editFrom
                        : undefined
                    }
                    version={
                      forks ? forks.findIndex((node) => node.id === id) + 1 : 0
                    }
                    versions={forks?.length ?? 0}
                    onVersion={versionStep}
                    off={offBranch(anchored, turn.ordinal)}
                  />
                </LazyMount>
                {/* Workflows that started in this turn. */}
                {placed.after.get(id)?.map(workflowLine)}
              </Fragment>
            );
          })}
          {placed.end.map(workflowLine)}
          {conversation.attempt && (
            <article className="chat-attempt" aria-label={t("Message")}>
              <p className="chat-attempt-text">{conversation.attempt.text}</p>
              <p className="inspector-note">
                <span className={`ep-state ${conversation.attempt.status}`}>
                  {tx(conversation.attempt.status)}
                </span>{" "}
                {conversation.attempt.notice
                  ? tx(conversation.attempt.notice)
                  : ""}
              </p>
            </article>
          )}
          <WaitingMessages
            pending={conversation.pending}
            undelivered={conversation.undelivered}
            canWithdraw={inputCurrent() && !busy}
            recallable={(waiting) =>
              sentInputs.current.has(waiting.commandId) ||
              wholePendingText(waiting.text)
            }
            onWithdraw={(waiting, recall) =>
              void withdrawInput(waiting, recall)
            }
            onRestore={restoreUndelivered}
          />
          {approving && (
            <p role="status">
              {t("Observing approval request {id}; no approval is replayed.", {
                id: approving,
              })}
            </p>
          )}
          {state?.enabled && state.design && (
            <DesignCard
              key={state.design.id}
              draft={state.design}
              active={!hidden}
              error={error ? describeError(t, error) : undefined}
              disabled={
                !!pinned ||
                !!anchor ||
                attaching ||
                busy ||
                !!running ||
                !actionsReady ||
                !canSend ||
                !cadenceKnown ||
                !!approving
              }
              onEdit={editDesign}
              onSubmit={(d) =>
                void send(
                  designMessage(d, CONVERSATION_SEND_BYTES),
                  undefined,
                  true,
                )
              }
            />
          )}
          {cadenceKnown &&
            state?.enabled &&
            !state.proposal &&
            runs.length === 0 && (
              <p className="inspector-note">
                {t(
                  "Cadence stays on for this conversation until you explicitly exit.",
                )}
              </p>
            )}
          {state?.notice && (
            <p role="alert" className="banner-notice">
              {tx(state.notice)}
            </p>
          )}
          {error && !planOpen && (
            <p role="alert" className="banner-notice">
              {describeError(t, error)}
            </p>
          )}
          {pending && (
            <p className="inspector-note">
              {t("Send outcome not yet observed:")} <code>{pending}</code>{" "}
              <button type="button" onClick={conversation.refresh}>
                {t("Observe current state")}
              </button>
            </p>
          )}
        </div>
        {away && (
          <button
            type="button"
            className="scroll-bottom"
            onClick={() => {
              stick.current = true;
              keepEnd(true);
              setAway(false);
            }}
          >
            <FiArrowDown aria-hidden="true" />
            {t("Latest messages")}
          </button>
        )}
        {/* A jump to a turn not shown yet reads back to it first. */}
        {target && (
          <p className="chat-jump-status" role="status">
            {t("Reading earlier messages…")}
          </p>
        )}
        {questions.length > 1 && (
          <QuestionRail
            questions={questions}
            active={activeQuestion}
            reading={target?.id ?? null}
            onJump={jumpTo}
          />
        )}
      </div>
      {centerEntry && (
        <ChatWelcome
          onStart={
            observedEmpty &&
            draft === "" &&
            !imageDraft.files.length &&
            !busy &&
            !pending &&
            !awaitingModel
              ? (prompt) => {
                  setDraft((current) => (current === "" ? prompt : current));
                  textarea.current?.focus({ preventScroll: true });
                }
              : undefined
          }
        />
      )}
      <div className="composer-dock" ref={dock}>
        <ChatComposer
          flow={flow}
          inputRef={textarea}
          draft={draft}
          onDraft={editDraft}
          locked={busy || !!pending || awaitingModel}
          images={imageDraft.files}
          imageKey={imageDraft.key}
          imagesLocked={!!imageLockReason}
          imageLockReason={imageLockReason}
          onAddImages={addImages}
          onRemoveImage={(file) => removeImages([file])}
          anchor={strip}
          status={
            preparing
              ? t("Preparing execution for this Send…")
              : liveRun && draft.trim() && inputBlock
                ? t(
                    inputBlock === "images"
                      ? "A message into a running reply carries no images. Remove them, or send after the reply ends."
                      : inputBlock === "mode"
                        ? "Cadence mode is not changed by a message into a running reply. Send this after the reply ends."
                        : inputBlock === "full"
                          ? "Eight messages already wait for this reply. Withdraw one, or wait."
                          : "A message into a running reply continues that reply, not another entry.",
                  )
                : running || canPrepareOnly || canSend
                  ? undefined
                  : pending
                    ? t(
                        "The last Send is not yet confirmed. No message is resent.",
                      )
                    : awaitingModel
                      ? t("Choose a model; your message is sent right after.")
                      : busy
                        ? t("Sending…")
                        : t(
                            "Sending is unavailable until the current context is observed. Your draft stays here.",
                          )
          }
          cadence={{
            ...modeFacts,
            disabledReason: !cadenceKnown
              ? t("Cadence state unavailable")
              : running
                ? t("Wait for the current reply before changing mode.")
                : (waitingReason ??
                  t("Current action context unavailable; observe again.")),
            disabled: cadence
              ? !canExit
              : !!running || busy || !!pending || awaitingModel,
            onClick: () => {
              if (cadence) {
                void send("exit cadence");
                return;
              }
              if (input.mode === "cadence") {
                setMode("chat");
                if (cadenceInput(draft, "chat").mode === "cadence")
                  setDraft(input.text);
              } else setMode("cadence");
            },
          }}
          model={{
            client: modelChoiceClient,
            availability,
            read: {
              ...modelRead,
              isCurrent: () =>
                modelRead.isCurrent() &&
                (availability.status !== "ready" ||
                  !viewer ||
                  viewer.current()),
            },
            lastModel: context?.model,
            draftModel,
            onPreviewChoice: previewModels
              ? (choice) => chosenModel(choice, false)
              : undefined,
            locked:
              !!running ||
              busy ||
              !!pending ||
              (availability.status === "ready" && !actionsReady),
            lockReason: running
              ? undefined
              : (waitingReason ??
                t("Current action context unavailable; observe again.")),
            open: modelOpen,
            onOpenChange: openModels,
            onChanged: () => {
              contextRead.refresh();
              onModelChanged();
            },
            onChosen: (choice) => chosenModel(choice, true),
            awaitingSend: awaitingModel,
          }}
          hint={
            liveRun && canInput && !inputBlock && draft.trim()
              ? t("Enter steers this reply · Alt+Enter queues behind it")
              : modeHint
                ? t(modeHint)
                : ""
          }
          running={!!running}
          canStop={!busy && turnCurrent()}
          stopBlocked={
            waitingReason ??
            t("Current action context unavailable; observe again.")
          }
          onStop={() => void interrupt()}
          canSend={
            ((cadence && cadenceExit(draft) ? canExit : canSend) ||
              canPrepareOnly) &&
            !attaching &&
            (!!draft.trim() || imageDraft.files.length > 0)
          }
          onSend={() => void send()}
          input={
            liveRun
              ? {
                  enabled: canInput && !inputBlock && !!draft.trim(),
                  onInput: (mode) => void sendInput(mode),
                }
              : undefined
          }
          historyScope={workspaceId}
          files={{
            client,
            location:
              available && contextKnown && context
                ? { id, cwd: context.cwd }
                : undefined,
          }}
          onResized={keepEnd}
        />
      </div>
    </section>
  );
}
export { ChatTurnView } from "./ChatTurnView";
export type { ChatSummary };
