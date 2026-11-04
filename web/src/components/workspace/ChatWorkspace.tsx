/* Adapted from pi-web-ui ChatInput/MessageList: bottom composer, streaming
 * transcript, folded tools and per-conversation drafts. MIT (c) 2026 xing-shuyin.
 * No upstream prompt, dispatch tool, queue, plugin or subagent runtime. */
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
  FiArrowUp,
  FiCornerDownRight,
  FiGitBranch,
  FiImage,
  FiMessageSquare,
  FiSquare,
} from "react-icons/fi";
import { IMAGE_LIMITS, IMAGE_TYPES } from "../../../../src/image-content.mjs";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type { ChatSummary } from "../../../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../../../src/service/contracts/workflow.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
import {
  type ModelSelector,
  publicError,
} from "../../../../src/service-contract.ts";
import {
  assertSendModel,
  captureSend,
  type PendingSend,
  SEND_PREPARATION_MS,
  draftKey as selectDraftKey,
  selector,
  sendCommand,
  withSendModel,
} from "../../client/conversation-send";
import { uploadImages } from "../../client/images";
import { useConversation } from "../../client/use-conversation";
import { cadenceInput, useWorkbench } from "../../client/use-workbench";
import {
  approveWorkflow,
  cadenceApproval,
  cadenceExit,
} from "../../client/workflow-entry";
import { describeError, useT } from "../../i18n/locale";
import { useLazyWindow } from "../../transcript/use-lazy-window";
import { ModelPicker } from "../actions/ModelPicker";
import { LazyMount } from "../transcript/LazyMount";
import { useWorkflowRuns, type WorkflowAgent } from "./AgentDock";
import { BranchTree } from "./BranchTree";
import { DraftImage, useImageDraft } from "./ChatImages";
import { ChatTurnView } from "./ChatTurnView";
import { ChatWelcome } from "./ChatWelcome";
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
function stored(key: string) {
  try {
    return sessionStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
export function ChatWorkspace({
  client,
  id,
  workspaceId,
  initialCwd,
  onLocation,
  enabled,
  actionsReady = enabled,
  prepareForSend,
  legacyWorkspaceId,
  directoryNamespaces = [],
  available = enabled,
  canInterrupt = enabled,
  modelEnabled = enabled,
  onModelChanged,
  onChanged,
  reference,
  onReferenceUsed,
  hidden = false,
  onOpenAgent,
  onWorkflowRuns,
}: {
  client: ServiceClient;
  id: string;
  workspaceId: string;
  initialCwd?: string;
  onLocation?(location: ConversationLocation): void;
  enabled: boolean;
  actionsReady?: boolean;
  prepareForSend?(
    signal: AbortSignal,
    location?: ConversationLocation,
  ): Promise<void>;
  legacyWorkspaceId?: string;
  directoryNamespaces?: string[];
  available?: boolean;
  canInterrupt?: boolean;
  /** Kept mounted (draft, scroll, observations) while a subagent view covers it. */
  hidden?: boolean;
  onOpenAgent?(agent: WorkflowAgent): void;
  /** This conversation's recent workflow runs, for the subagent dock. */
  onWorkflowRuns?(ids: string[]): void;
  /** The owner is compatible and current, so a model can be chosen. */
  modelEnabled?: boolean;
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
  const [draft, setDraft] = useState(() => stored(draftKey));
  const imageDraft = useImageDraft();
  const removeImages = imageDraft.remove;
  const sentImages = useRef<readonly File[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"chat" | "cadence">(() =>
    stored(`${draftKey}:mode`) === "cadence" ? "cadence" : "chat",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [pending, setPending] = useState(() => stored(`${draftKey}:pending`));
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
  const observedModel = useRef<ModelSelector | null>(null);
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
  const onLocationRef = useRef(onLocation);
  onLocationRef.current = onLocation;
  useEffect(() => {
    if (contextKnown && locationCwd)
      onLocationRef.current?.({ id, cwd: locationCwd });
  }, [contextKnown, id, locationCwd]);
  const conversation = useConversation(client, id, available);
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
  const [branchesOpen, setBranchesOpen] = useState(false);
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
  const planApprovable =
    !!state?.proposal && !!summary && !running && summary.status !== "unknown";
  const approvalHint =
    state?.proposal && summary?.status === "unknown"
      ? t(
          "The latest turn's outcome is unknown. Approval waits until it is observed.",
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
  const alive = useRef(true);
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
      removeImages(sentImages.current);
      setDraft((value) => (value === sentDraft.current ? "" : value));
      onChanged();
    }
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [summary, turns, pending, onChanged, state, conversation, removeImages]);
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
  const lazy = useLazyWindow(scroll, rows);
  // The user's own choice to open or fold a turn's steps outlives its remount.
  const toggles = useRef(new Map<string, boolean>());
  const rememberToggle = useCallback((turnId: string, open: boolean) => {
    toggles.current.set(turnId, open);
  }, []);
  // Earlier turns load while the reader is near the top, on scroll and after
  // each render (a short transcript fills itself); no page is ever switched.
  const { earlier, loadEarlier } = conversation;
  const nearTop = () => {
    const el = scroll.current;
    if (el && !hidden && earlier && el.scrollTop < 1200) loadEarlier();
  };
  useEffect(nearTop);
  // Inserted earlier turns must not move what is being read. Scroll anchoring
  // does this natively; without it the inserted height is skipped here.
  const firstOrdinal = turns[0]?.ordinal;
  const anchor = useRef<{ ordinal?: number; height: number }>({ height: 0 });
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const previous = anchor.current;
    if (
      !NATIVE_ANCHORING &&
      !stick.current &&
      previous.ordinal !== undefined &&
      firstOrdinal !== undefined &&
      firstOrdinal < previous.ordinal
    )
      el.scrollTop += el.scrollHeight - previous.height;
    anchor.current = { ordinal: firstOrdinal, height: el.scrollHeight };
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
      setError(t("No plan is awaiting approval."));
      return;
    }
    if (
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
    setError("");
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
      (!message.trim() && !images.length)
    )
      return;
    if (exiting && images.length) {
      setError(t("Remove images before exiting Cadence."));
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
        setError(
          t(
            "Execution is not ready to approve this plan. Send a message to refresh the conversation first; nothing was approved.",
          ),
        );
      else await approve();
      return;
    }
    const selecting = cadenceInput(message, mode).mode === "cadence";
    if (!canPrepareOnly && (cadence || selecting) && !cadenceKnown) {
      setError(
        t(
          "Cadence state unavailable. Observe the conversation before sending.",
        ),
      );
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
    const generation = sendGeneration.current;
    const current = () =>
      alive.current && sendGeneration.current === generation;
    let dispatched = false;
    let preparationAttempted = false;
    const prepare = async (location?: ConversationLocation) => {
      if (!prepareForSend) return;
      preparationAttempted = true;
      setPreparing(true);
      await prepareForSend(
        AbortSignal.any([
          departure.current.signal,
          AbortSignal.timeout(SEND_PREPARATION_MS),
        ]),
        location,
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
          head: conversation.leaf,
          text: message,
          images,
          revision: state?.revision ?? 0,
          location: context ? { id, cwd: context.cwd } : undefined,
          model: observedModel.current ?? context?.model ?? undefined,
          intent: exiting
            ? "exit"
            : cadence
              ? "message"
              : selecting
                ? "enter"
                : "ordinary",
        });
      await prepare(intent.location);
      if (!current()) return;
      if (intent.command.kind === "cadence-exit") {
        const commandId = intent.command.commandId;
        sentDraft.current = message;

        setPending(commandId);
        dispatched = true;
        const reply = await client.workbenchCommand(sendCommand(intent));
        if (!current()) return;
        if (reply.kind === "error") {
          setError(reply.error.code);
          if (reply.error.effect === "none") setPending("");
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
      const chooseFirst = () => {
        waitingSend.current = intent;
        setAwaitingModel(true);
        setModelOpen(true);
      };
      let catalog = await client.models(undefined, intent.location);
      if (!current()) return;
      const offered =
        catalog.kind === "ok"
          ? (catalog.value.selected ?? catalog.value.remembered)
          : null;
      if (!intent.model && offered) intent = withSendModel(intent, offered);
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
          chooseFirst();
          return;
        }
        catalog = await client.models(undefined, intent.location);
        if (!current()) return;
        setModelReads((n) => n + 1);
      }
      if (catalog.kind !== "ok" || !catalog.value.selected) {
        chooseFirst();
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
          setError(
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

      setPending(command.commandId);
      dispatched = true;
      const reply = await client.workbenchCommand(command);
      if (!current()) return;
      if (reply.kind === "error") {
        setError(
          `${reply.error.code}. ${t("Observe this send before sending again. No automatic retry.")}`,
        );
        if (reply.error.effect === "none") setPending("");
        // Even a lost reply can have accepted work. Observe this exact turn ID.
      } else {
        removeImages(sentImages.current);
        setDraft((value) => (value === sentDraft.current ? "" : value));
        setPending("");
        if (command.kind === "cadence-send") {
          setMode("chat");
        }
        // The new reply ends the branch: follow it as the session's latest.
        chooseBranch(null);
      }
      workflow.refresh();
      conversation.refresh();
      onChanged();
    } catch (error) {
      if (current())
        setError(
          dispatched
            ? t(
                "Send unavailable. Check the message limit (16 KiB); observe any pending command before sending again.",
              )
            : t(
                preparationAttempted
                  ? "The message was not sent ({code}). Its draft is kept; preparation may have started an execution service."
                  : "The message was not sent ({code}). Its draft is kept.",
                {
                  code: error instanceof Error ? error.message : "unavailable",
                },
              ),
        );
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
  // The Send that waited for a model continues once sending is possible again.
  useEffect(() => {
    if (resume && canSend && !running) {
      setResume(false);
      const intent = waitingSend.current;
      waitingSend.current = null;
      if (intent) void sendLatest.current(undefined, intent);
    }
  }, [resume, canSend, running]);
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
  const chooseBranch = (leaf: string | null) => {
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
    conversation.choose(leaf);
    setBranchesOpen(false);
  };
  const imagesLocked = busy || awaitingModel || !!pending || !!running;
  const addImages = (files: File[]) => {
    if (imagesLocked) return;
    try {
      imageDraft.add(files);
      setError("");
    } catch (error) {
      setError(tx(error instanceof Error ? error.message : "unavailable"));
    }
  };
  return (
    <section
      className="chat-workspace"
      hidden={hidden}
      aria-label={
        cadence ? t("Cadence conversation") : t("Ordinary conversation")
      }
    >
      <header className="conversation-header">
        <div className="conversation-heading">
          <FiMessageSquare aria-hidden="true" />
          <h2>{summary?.title ?? t("New conversation")}</h2>
          <span className="conversation-badge">
            {cadence ? t("Cadence on") : t("Ordinary")}
          </span>
          {summary && (
            <span className="conversation-badge">
              {summary.origin === "terminal"
                ? t("Started in the terminal")
                : t("Started in the WebUI")}
            </span>
          )}
        </div>
        <div className="conversation-branch">
          {(conversation.branches > 1 || conversation.pinned) && (
            <button
              type="button"
              className="ghost"
              aria-expanded={branchesOpen}
              onClick={() => setBranchesOpen((open) => !open)}
            >
              <FiGitBranch aria-hidden="true" />
              {t("Branches ({count})", { count: conversation.branches })}
            </button>
          )}
          {conversation.pinned && (
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
            <span className="ep-state running">
              {tx(workflowActivity(activeRun))}
            </span>
          )}
          {summary &&
            (!activeRun ||
              settledBadly ||
              (cadence && !running && !!state?.proposal)) && (
              <span className={`ep-state ${summary.status}`}>
                {cadence
                  ? running
                    ? t("Discussing")
                    : settledBadly
                      ? tx(summary.status)
                      : state?.proposal
                        ? t("Awaiting plan approval")
                        : t("Ready for conversation")
                  : tx(summary.status)}
              </span>
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
      {branchesOpen && (
        <BranchTree
          client={client}
          id={id}
          leaf={conversation.leaf}
          onChoose={chooseBranch}
          onClose={() => setBranchesOpen(false)}
        />
      )}
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
          }
        }}
      >
        {conversation.summary === null && (
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
        {rows.map(({ id, version, turn }) => (
          <Fragment key={id}>
            <LazyMount
              id={id}
              show={!lazy.hidden.has(id)}
              height={lazy.placeholder(id, version, 320)}
              containerRef={scroll}
              onMeasured={lazy.recordMeasured}
              lazyRef={lazy.register(id)}
            >
              <ChatTurnView
                turn={turn}
                toggled={toggles.current.get(id) ?? null}
                onToggle={rememberToggle}
              />
            </LazyMount>
            {/* Workflows that started in this turn, then the turn's branch point. */}
            {placed.after.get(id)?.map(workflowLine)}
            {turn.header.entry &&
              turn.ordinal < conversation.count - 1 &&
              !running && (
                <button
                  type="button"
                  className="ghost turn-branch"
                  title={t(
                    "Show the conversation up to here. The next message starts a new branch; nothing is deleted.",
                  )}
                  onClick={() => chooseBranch(turn.header.entry)}
                >
                  <FiCornerDownRight aria-hidden="true" />
                  {t("Continue from here")}
                </button>
              )}
          </Fragment>
        ))}
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
        {(error || conversation.error || workflow.error) && (
          <p role="alert" className="banner-notice">
            {describeError(
              t,
              error || conversation.error || workflow.error || "",
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
        {conversation.pinned && !running && (
          <p className="inspector-note">
            {t(
              "You are viewing an earlier point of this conversation. A message sent now starts a new branch here; the rest stays in the session.",
            )}
          </p>
        )}
      </div>
      {away && (
        <button
          type="button"
          className="chat-scroll-bottom"
          aria-label={t("Latest messages")}
          onClick={() => {
            if (scroll.current)
              scroll.current.scrollTop = scroll.current.scrollHeight;
            stick.current = true;
          }}
        >
          <FiArrowDown />
        </button>
      )}
      <form
        className="chat-composer"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files"))
            event.preventDefault();
        }}
        onDrop={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          addImages(Array.from(event.dataTransfer.files));
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept={IMAGE_TYPES.join(",")}
          multiple
          hidden
          disabled={imagesLocked}
          aria-label={t("Add images")}
          onChange={(event) => {
            addImages(Array.from(event.currentTarget.files ?? []));
            event.currentTarget.value = "";
          }}
        />
        {imageDraft.files.length > 0 && (
          <div className="chat-images">
            {imageDraft.files.map((file) => (
              <DraftImage
                key={imageDraft.key(file)}
                file={file}
                disabled={imagesLocked}
                remove={() => removeImages([file])}
              />
            ))}
          </div>
        )}
        <textarea
          ref={textarea}
          disabled={
            (!enabled && !(cadence && canInterrupt)) ||
            (!canPrepareOnly &&
              (!observed || !modeObserved || !!conversation.error)) ||
            busy ||
            !!pending
          }
          aria-label={t("Message")}
          value={draft}
          placeholder={t(
            "Message, or /cadence to enter continuous Cadence mode…",
          )}
          rows={3}
          onChange={(event) => setDraft(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((f) =>
              f.type.startsWith("image/"),
            );
            if (!files.length) return;
            event.preventDefault();
            addImages(files);
          }}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <p className="composer-image-help">
          {t(
            "PNG, JPEG or WebP · {count} images · {each} MiB each · {total} MiB total. Unsent images stay in this tab.",
            {
              count: IMAGE_LIMITS.count,
              each: IMAGE_LIMITS.bytes / 1024 / 1024,
              total: IMAGE_LIMITS.totalBytes / 1024 / 1024,
            },
          )}
        </p>
        <div className="composer-toolbar">
          <button
            type="button"
            className="ghost icon"
            disabled={imagesLocked}
            aria-label={t("Add images")}
            title={t("Add images")}
            onClick={() => fileInput.current?.click()}
          >
            <FiImage aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`mode-toggle${cadence || input.mode === "cadence" ? " on" : ""}`}
            aria-label={t("Cadence mode")}
            aria-pressed={cadence || input.mode === "cadence"}
            disabled={cadence ? !canExit : running || busy}
            title={
              cadence
                ? t("Cadence mode is on. Click to exit it.")
                : input.mode === "cadence"
                  ? t(
                      "Your next message turns on Cadence mode. Click to cancel.",
                    )
                  : t(
                      "Turn on Cadence mode: agree on a plan before implementation.",
                    )
            }
            onClick={() => {
              if (cadence) {
                void send("exit cadence");
                return;
              }
              if (input.mode === "cadence") {
                setMode("chat");
                if (cadenceInput(draft, "chat").mode === "cadence")
                  setDraft(input.text);
              } else setMode("cadence");
            }}
          >
            <span className="mode-switch" aria-hidden="true" />
            Cadence
          </button>
          <ModelPicker
            client={modelClient}
            onObserved={(catalog) => {
              observedModel.current = catalog.selected
                ? selector(catalog.selected)
                : catalog.remembered;
            }}
            enabled={modelEnabled && available && contextKnown}
            locked={!!running}
            refresh={String(modelReads)}
            open={modelOpen}
            onOpenChange={(value) => {
              setModelOpen(value);
              if (!value) setAwaitingModel(false);
            }}
            onChanged={() => {
              contextRead.refresh();
              onModelChanged();
            }}
            onChosen={(choice) => {
              if (!awaitingModel || !waitingSend.current) return;
              waitingSend.current = withSendModel(waitingSend.current, choice);
              setAwaitingModel(false);
              setError("");
              setResume(true);
            }}
            awaitingSend={awaitingModel}
          />
          <span className="composer-hint">
            {cadence
              ? t("Cadence stays on. Confirm one plan before implementation.")
              : input.mode === "cadence"
                ? t("Your next message turns on Cadence mode.")
                : ""}
          </span>
          {running ? (
            <button
              type="button"
              className="danger"
              disabled={busy || !canInterrupt}
              onClick={() => void interrupt()}
            >
              <FiSquare />
              {t("Stop response")}
            </button>
          ) : (
            <button
              type="submit"
              className="primary"
              disabled={
                (!(cadence && cadenceExit(draft) ? canExit : canSend) &&
                  !canPrepareOnly) ||
                (!draft.trim() && !imageDraft.files.length)
              }
            >
              <FiArrowUp />
              {t("Send")}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
export { ChatTurnView } from "./ChatTurnView";
export type { ChatSummary };
