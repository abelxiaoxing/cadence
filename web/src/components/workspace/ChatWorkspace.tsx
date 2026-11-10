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
  FiGitBranch,
  FiMessageSquare,
} from "react-icons/fi";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type {
  ChatSummary,
  ChatTreeNode,
} from "../../../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import {
  canonicalJson,
  decodeModelSelector,
  type ModelSelector,
  publicError,
} from "../../../../src/service-contract.ts";
import {
  editHead,
  firstLine,
  offBranch,
  sendHead,
} from "../../client/conversation-anchor";
import type { LoadedTurn } from "../../client/conversation-reader";
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
  type PrepareForSend,
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
import {
  activityRoute,
  chatFromLocation,
  rememberBranch,
} from "../../client/project-route";
import { useConversation } from "../../client/use-conversation";
import {
  type ModelAvailability,
  useModelCatalog,
} from "../../client/use-model-catalog";
import { cadenceInput, useWorkbench } from "../../client/use-workbench";
import {
  approveWorkflow,
  cadenceApproval,
  cadenceExit,
} from "../../client/workflow-entry";
import { pushPromptHistory } from "../../composer/prompt-history";
import { describeError, useT } from "../../i18n/locale";
import { dismissToasts, notify } from "../../layout/toasts";
import { useLazyWindow } from "../../transcript/use-lazy-window";
import { LazyMount } from "../transcript/LazyMount";
import { useWorkflowRuns, type WorkflowAgent } from "./AgentDock";
import type { BranchesView } from "./BranchesPanel";
import { ChatComposer } from "./ChatComposer";
import { useImageDraft } from "./ChatImages";
import { turnParts } from "./ChatSteps";
import { ChatTurnView } from "./ChatTurnView";
import { ChatWelcome } from "./ChatWelcome";
import { QuestionRail } from "./QuestionRail";
import { useSendAnchor } from "./use-send-anchor";
import {
  nextRunWindow,
  PlanCard,
  placeWorkflows,
  RUN_WINDOW,
  WorkflowLine,
  workflowActivity,
  workflowLive,
} from "./WorkflowPanel";

const NATIVE_ANCHORING =
  typeof CSS !== "undefined" && CSS.supports("overflow-anchor", "auto");
/** What the open conversation tells the statusbar: observations only. */
export interface ConversationActivity {
  id: string;
  /** Turns on the branch shown. */
  turns: number;
  /** When the live turn began (epoch ms), 0 when unrecorded; null when no
   * reply is queued or running. */
  runningSince: number | null;
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
  prepareForSend,
  legacyWorkspaceId,
  directoryNamespaces = [],
  available = enabled,
  canInterrupt = enabled,
  modelAvailability,
  previewModels,
  initialDraft,
  onDraftApplied,
  onModelChanged,
  onChanged,
  reference,
  onReferenceUsed,
  hidden = false,
  onOpenAgent,
  onWorkflowRuns,
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
  prepareForSend?: PrepareForSend;
  legacyWorkspaceId?: string;
  directoryNamespaces?: string[];
  available?: boolean;
  canInterrupt?: boolean;
  /** Kept mounted (draft, scroll, observations) while a subagent view covers it. */
  hidden?: boolean;
  onOpenAgent?(agent: WorkflowAgent): void;
  /** This conversation's recent workflow runs, for the subagent dock. */
  onWorkflowRuns?(ids: string[]): void;
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
  onChanged(): void;
  reference?: string;
  onReferenceUsed(): void;
}) {
  const { t, tx } = useT();
  const [draftKey] = useState(() =>
    selectDraftKey(workspaceId, id, legacyWorkspaceId, ...directoryNamespaces),
  );
  const [draft, setDraft] = useState(() =>
    stored(draftKey, initialDraft?.text),
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
  const [modelCommand, setModelCommand] = useState(() =>
    stored(`${draftKey}:model-command`),
  );
  const [modelOpen, setModelOpen] = useState(false);
  // A Send found no model: it continues once one is explicitly chosen.
  const [awaitingModel, setAwaitingModel] = useState(false);
  const [resume, setResume] = useState(false);
  const [modelReads, setModelReads] = useState(0);
  const waitingSend = useRef<PendingSend | null>(null);
  const sending = useRef(false);
  const sendGeneration = useRef(0);
  const departure = useRef(new AbortController());
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

  const contextRead = useWorkbench(
    client,
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
  const modelClient = useMemo<Pick<ServiceClient, "models" | "chooseModel">>(
    () => ({
      models: (signal) =>
        locationCwd
          ? client.models(signal, { id, cwd: locationCwd })
          : Promise.resolve({
              kind: "error",
              error: publicError("unavailable"),
            }),
      chooseModel: (request) =>
        locationCwd
          ? client.chooseModel(request, { id, cwd: locationCwd })
          : Promise.resolve({
              kind: "error",
              error: publicError("unavailable"),
            }),
    }),
    [client, id, locationCwd],
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
    if (open && !modelRead.preview && !modelRead.loading) modelRead.reread();
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
  const conversation = useConversation(client, id, available, entryLeaf);
  const { turns } = conversation;
  // Undefined until observed; null is a conversation not started yet.
  const observed = conversation.summary !== undefined;
  const workflow = useWorkbench(
    client,
    available ? { kind: "cadence-conversation", id } : null,
    1000,
  );
  const state =
    workflow.value?.kind === "cadence-conversation"
      ? workflow.value.state
      : undefined;
  const cadence = state?.enabled === true;
  // Ordinary chat never depends on the Cadence record: a failed mode read
  // still allows an ordinary Send, which the owner refuses if Cadence is on.
  const modeObserved = !!state || !!workflow.error;
  // A degraded record (notice) is shown but takes no Cadence action.
  const cadenceKnown = !!state && !workflow.error && !state.notice;
  const latestState = useRef(state);
  latestState.current = state;
  // In-flight approval only. The owner consumes a plan once, so a lost reply
  // never needs a client-side lock: the next observation shows the run.
  const [approving, setApproving] = useState("");
  const attempted = useRef("");
  const input = cadenceInput(draft, cadence ? "cadence" : mode);
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
  const running =
    summary && (summary.status === "queued" || summary.status === "running");
  // A failed or interrupted reply stays in the session; the next message
  // continues the branch as it would in the terminal.
  const settledBadly = !!summary && summary.status !== "completed" && !running;
  // The live turn ends the branch; before Pi lists it the start is unrecorded.
  const lastTurn = turns.at(-1)?.header;
  const runningSince = !running
    ? null
    : lastTurn && ["queued", "running"].includes(lastTurn.status)
      ? lastTurn.at
      : 0;
  const onActivityRef = useRef(onActivity);
  onActivityRef.current = onActivity;
  useEffect(() => {
    onActivityRef.current?.({ id, turns: conversation.count, runningSince });
  }, [id, conversation.count, runningSince]);
  // One tree read per branch shown feeds the version pagers, the question
  // rail and the Branches tab.
  const treeRead = useConversationTree(
    client,
    id,
    conversation.leaf,
    conversation.branches,
    available && !!summary,
  );
  const { tree } = treeRead;
  const versions = useMemo(
    () => messageVersions(tree ?? { nodes: [], truncated: false }),
    [tree],
  );
  const newest = turns.at(-1);
  const unsettled =
    !!newest && ["queued", "running"].includes(newest.header.status);
  // The branch's user messages; a live turn's own is not on the listed branch
  // until it settles, so it is added from the turn shown.
  const questions = useMemo(() => {
    const listed = branchQuestions(tree?.nodes ?? []).map((node) => ({
      id: node.id,
      text: node.text,
    }));
    if (
      !newest ||
      !unsettled ||
      listed.some((question) => question.id === newest.header.id)
    )
      return listed;
    const text = turnParts(newest.steps).user[0]?.step.text ?? "";
    return [...listed, { id: newest.header.id, text: firstLine(text) }];
  }, [tree, newest, unsettled]);
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
    (canInterrupt || !!prepareForSend) &&
    contextKnown &&
    observed &&
    cadenceKnown &&
    !conversation.error &&
    !busy &&
    !pending &&
    !running;
  // The plan card survives later messages; the owner refuses approval only
  // while this conversation's turn is live or its outcome is unknown.
  const modelPending =
    !!draftModel &&
    canonicalJson(draftModel) !== canonicalJson(context?.model ?? null);
  const planApprovable =
    !!state?.proposal && !!summary && !running && summary.status !== "unknown";
  const approvalHint = modelPending
    ? t("Send with this model before approving a plan.")
    : summary?.status === "unknown"
      ? t(
          "The latest turn's outcome is unknown. Approval waits until it is observed.",
        )
      : !actionsReady
        ? t("Read the current execution state before approving this plan.")
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
  // `display: none` drops the scroll offset; restore it when the view returns.
  useLayoutEffect(() => {
    if (!hidden && scroll.current && !stick.current)
      scroll.current.scrollTop = lastTop.current;
  }, [hidden]);
  const observedHead = useRef("");
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
  }, [reference, onReferenceUsed]);
  useEffect(() => {
    const signature = summary ? `${summary.leaf}:${summary.status}` : "";
    if (signature && observedHead.current !== signature) {
      observedHead.current = signature;
      onChanged();
    }
    if (attempted.current && state?.runs.includes(attempted.current)) {
      attempted.current = "";
      setApproving("");
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
      if (modelDraftConsumed(pending, modelCommand)) setDraftModel(null);
      setModelCommand("");
      removeImages(sentImages.current);
      setDraft((value) => (value === sentDraft.current ? "" : value));
      // Only a message carries the model marker; leaving Cadence does not.
      if (modelDraftConsumed(pending, modelCommand))
        pushPromptHistory(workspaceId, sentDraft.current);
      // The composer stayed locked since that Send, so an anchor still set is
      // the one it used: the reply's branch is followed as the latest.
      acts.current.followAnchor();
      onChanged();
    }
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [
    summary,
    turns,
    pending,
    modelCommand,
    onChanged,
    state,
    conversation,
    removeImages,
    workspaceId,
  ]);
  // Turns render lazily: those far outside the viewport keep only their height.
  const rows = useMemo(
    () =>
      turns.map((turn) => ({
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
  const lazy = useLazyWindow(scroll, rows, jump?.id ?? null);
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
  const runsKey = JSON.stringify(runs.slice(-4));
  useEffect(() => {
    onWorkflowRuns?.(JSON.parse(runsKey));
  }, [runsKey, onWorkflowRuns]);
  // Each workflow is one line after the turn it started in. Each list's newest
  // are read first; older ones only once the turns shown could hold them.
  const [windows, setWindows] = useState({
    terminal: RUN_WINDOW,
    browser: RUN_WINDOW,
  });
  const watched = useMemo(
    () => [
      ...new Set([
        ...conversation.runs.slice(-windows.terminal),
        ...(state?.runs ?? []).slice(-windows.browser),
      ]),
    ],
    [conversation.runs, state?.runs, windows],
  );
  const flows = useWorkflowRuns(client, available ? watched : [], 1000);
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
  const activeRun = [...flows.runs.values()].filter(workflowLive).at(-1);
  // A line that appears or settles (and may gain its reason) keeps a reader at
  // the end there; a live line's changing activity never moves the reader.
  const linesKey = [...flows.runs.values()]
    .map((run) => `${run.id}:${run.status}`)
    .join();
  useLayoutEffect(() => {
    if (linesKey && stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [linesKey]);
  const workflowLine = (run: WorkflowRun) => (
    <WorkflowLine
      key={run.id}
      client={client}
      run={run}
      onOpen={() =>
        onOpenAgent?.({ runId: run.id, stepId: null, label: run.goal })
      }
      onChanged={() => {
        workflow.refresh();
        onChanged();
      }}
    />
  );
  const approve = async () => {
    if (!state?.proposal) {
      refuse(t("No plan is awaiting approval."));
      return;
    }
    if (
      modelPending ||
      !actionsReady ||
      !cadenceKnown ||
      !canSend ||
      running ||
      approving ||
      !planApprovable
    )
      return;
    const observed = state;
    const generation = sendGeneration.current;
    setBusy(true);
    clearError();
    try {
      const reply = await approveWorkflow({
        client,
        state: observed,
        current: () =>
          alive.current &&
          sendGeneration.current === generation &&
          latestState.current?.revision === observed.revision &&
          latestState.current?.enabled === true,
        submitting: (commandId) => {
          attempted.current = commandId;
          setApproving(commandId);
        },
      });
      if (!alive.current || sendGeneration.current !== generation) return;
      if (reply.kind === "error") {
        // A lost reply may still have started the run; the observation shows it.
        setError(reply.error.code);
        setApproving("");
      } else setDraft((value) => (cadenceApproval(value) ? "" : value));
    } catch (e) {
      if (alive.current && sendGeneration.current === generation)
        setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      if (alive.current && sendGeneration.current === generation) {
        setBusy(false);
        workflow.refresh();
        conversation.refresh();
        onChanged();
      }
    }
  };
  const send = async (override?: string, retained?: PendingSend) => {
    const message = retained?.text ?? override ?? draft;
    const images = retained?.images ?? (override ? [] : imageDraft.files);
    const exiting = retained
      ? retained.command.kind === "cadence-exit"
      : cadence && cadenceExit(message);
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
    if (
      !images.length &&
      !retained &&
      !override &&
      cadence &&
      cadenceApproval(message)
    ) {
      if (!actionsReady)
        refuse(
          t(
            "Execution is not ready to approve this plan. Send a message to refresh the conversation first; nothing was approved.",
          ),
        );
      else await approve();
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
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    clearError();
    const generation = sendGeneration.current;
    const current = () =>
      alive.current && sendGeneration.current === generation;
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
        prepareForSend,
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
          intent: exiting
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
          value: await installSendModel(client, intent, catalog.value, current),
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
        command = await uploadImages(client, command, intent.images, current);
        if (!current()) return;
      }
      sentImages.current = intent.images;
      sentDraft.current = message;

      dispatched = true;
      const reply = await dispatchSend(client, command, pendingCommand);
      if (!current()) return;
      if (reply.kind === "error") {
        sendRefused(reply.error.code, reply.error.effect);
        // Even a lost reply can have accepted work. Observe this exact turn ID.
      } else {
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
        const text = t(
          dispatched ? sendFailureMessage() : unsentMessage(preparation),
          { code: error instanceof Error ? error.message : "unavailable" },
        );
        // Unsent with no preparation dispatched: nothing reached the owner.
        if (!dispatched && preparation === "not-dispatched") refuse(text);
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
  const interrupt = async () => {
    const live = summary?.live;
    if (!live || busy) return;
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
    setAwaitingModel(false);
    setResume(false);
    setModelOpen(false);
    setBusy(false);
    setPreparing(false);
    releaseAnchor();
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
  const treeCurrent = !!tree && tree.leaf === conversation.leaf;
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
    if (!treeCurrent || treeRead.loading) {
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
      unsettled,
    );
    // Not in the tree read, or the turn in its place is another message.
    if (ordinal === undefined || turns.some((turn) => turn.ordinal === ordinal))
      return giveUp(t("That message could not be found in this conversation."));
    conversation.showFrom(ordinal);
  });
  // The reply's own state. A completed reply and an idle Cadence conversation
  // need no label: the mode is in the meta line and on the composer control.
  const replyState = !summary
    ? ""
    : cadence
      ? running
        ? t("Discussing")
        : settledBadly
          ? tx(summary.status)
          : state?.proposal
            ? t("Awaiting plan approval")
            : ""
      : summary.status === "completed"
        ? ""
        : tx(summary.status);
  const imagesLocked =
    busy || awaitingModel || !!pending || !!running || attaching;
  const addImages = (files: File[]) => {
    if (imagesLocked) return;
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
  const keepEnd = useCallback(() => {
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, []);
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
      hidden={hidden}
      aria-label={
        !cadenceKnown
          ? t("Conversation")
          : cadence
            ? t("Cadence conversation")
            : t("Ordinary conversation")
      }
    >
      <header className="conversation-header">
        <div className="conversation-heading">
          <FiMessageSquare aria-hidden="true" />
          <h2>
            {summary?.title ??
              (activitySelected
                ? t("Discovered session")
                : conversation.summary === null
                  ? t("New conversation")
                  : t("Conversation"))}
          </h2>
        </div>
        <div className="conversation-branch">
          {/* One quiet line: the mode, then where the session started. */}
          <span className="conversation-meta">
            {!cadenceKnown
              ? t("Cadence state unavailable")
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
          {/* A live workflow is what this conversation is doing, whatever its
              mode; beside it the reply's status stays only when that reply
              ended badly or a plan awaits approval. */}
          {activeRun && (
            <span className="ep-state running" role="status">
              {tx(workflowActivity(activeRun))}
            </span>
          )}
          {summary &&
            replyState &&
            (!activeRun ||
              settledBadly ||
              (cadence && !running && !!state?.proposal)) && (
              <span className={`ep-state ${summary.status}`}>{replyState}</span>
            )}
        </div>
      </header>
      {contextRead.error && !canPrepareOnly && (
        <p role="alert" className="inspector-note">
          {describeError(t, contextRead.error)}
        </p>
      )}
      {canPrepareOnly && (
        <p className="panel-hint" role="status">
          {t(
            "Conversation context is unavailable. Send can prepare execution, but cannot submit this draft until the context is observed.",
          )}
        </p>
      )}
      {preparing && (
        <p className="panel-hint" role="status">
          {t("Preparing execution for this Send…")}
        </p>
      )}
      <div className="chat-messages-wrap">
        <div
          className="chat-messages"
          ref={scroll}
          onScroll={() => {
            const el = scroll.current;
            if (el && !hidden) {
              lastTop.current = el.scrollTop;
              stick.current =
                el.scrollHeight - el.scrollTop - el.clientHeight < 80;
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
          {!available && (
            <p role="status" className="panel-hint">
              {t(
                "Conversation content has not been read. You can keep a draft; nothing is sent until the context is available.",
              )}
            </p>
          )}
          {conversation.summary === null &&
            !conversation.error &&
            !activitySelected && (
              <ChatWelcome
                hint={t(
                  "Type a message below. Turn on Cadence mode to agree on a plan before implementation.",
                )}
              />
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
            return (
              <Fragment key={id}>
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
          {state?.enabled && state.proposal && (
            <PlanCard
              proposal={state.proposal}
              canApprove={
                !modelPending &&
                actionsReady &&
                canSend &&
                cadenceKnown &&
                planApprovable &&
                !running &&
                !approving
              }
              approvalHint={approvalHint}
              onApprove={() => void approve()}
            />
          )}
          {state?.enabled && !state.proposal && runs.length === 0 && (
            <p className="inspector-note">
              {t(
                "Cadence stays on for this conversation until you explicitly exit.",
              )}
            </p>
          )}
          {flows.failed && (
            <p className="inspector-note" role="status">
              {t(
                "Workflow activity unavailable; retained work may still be running.",
              )}
            </p>
          )}
          {state?.notice && (
            <p role="alert" className="banner-notice">
              {tx(state.notice)}
            </p>
          )}
          {[...new Set([error, conversation.error, workflow.error])]
            .filter(Boolean)
            .map((notice) => (
              <p key={notice} role="alert" className="banner-notice">
                {describeError(t, notice ?? "")}
              </p>
            ))}
          {conversation.error && conversation.summary !== undefined && (
            <p role="status" className="inspector-note">
              {t(
                "Conversation state is not current. Previously read content may be shown; this does not mean work has stopped.",
              )}
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
              if (scroll.current)
                scroll.current.scrollTop = scroll.current.scrollHeight;
              stick.current = true;
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
      <ChatComposer
        inputRef={textarea}
        draft={draft}
        onDraft={setDraft}
        locked={busy || !!pending || awaitingModel}
        images={imageDraft.files}
        imageKey={imageDraft.key}
        imagesLocked={imagesLocked}
        onAddImages={addImages}
        onRemoveImage={(file) => removeImages([file])}
        anchor={strip}
        status={
          running || canPrepareOnly || canSend || preparing
            ? undefined
            : pending
              ? t("The last Send is not yet confirmed. No message is resent.")
              : awaitingModel
                ? t("Choose a model; your message is sent right after.")
                : busy
                  ? t("Sending…")
                  : t(
                      "Sending is unavailable until the current context is observed. Your draft stays here.",
                    )
        }
        cadence={{
          active: cadence,
          armed: input.mode === "cadence",
          known: cadenceKnown,
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
          client: modelClient,
          availability,
          read: modelRead,
          lastModel: context?.model,
          draftModel,
          onPreviewChoice: previewModels
            ? (choice) => chosenModel(choice, false)
            : undefined,
          locked: !!running || busy || !!pending,
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
          cadence
            ? t("Cadence stays on. Confirm one plan before implementation.")
            : input.mode === "cadence"
              ? t("Your next message turns on Cadence mode.")
              : ""
        }
        running={!!running}
        canStop={!busy && canInterrupt}
        onStop={() => void interrupt()}
        canSend={
          ((cadence && cadenceExit(draft) ? canExit : canSend) ||
            canPrepareOnly) &&
          !attaching &&
          (!!draft.trim() || imageDraft.files.length > 0)
        }
        onSend={() => void send()}
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
    </section>
  );
}
export { ChatTurnView } from "./ChatTurnView";
export type { ChatSummary };
