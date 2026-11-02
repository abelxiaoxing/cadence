/* Adapted from pi-web-ui ChatInput/MessageList: bottom composer, streaming
 * transcript, folded tools and per-conversation drafts. MIT (c) 2026 xing-shuyin.
 * No upstream prompt, dispatch tool, queue, plugin or subagent runtime. */
import {
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
  FiMessageSquare,
  FiSquare,
} from "react-icons/fi";
import type { ConversationLocation } from "../../../../src/service/contracts/models.ts";
import type { ChatSummary } from "../../../../src/service/contracts/workbench.ts";
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
import type { WorkflowAgent } from "./AgentDock";
import { ChatTurnView } from "./ChatTurnView";
import { ChatWelcome } from "./ChatWelcome";
import { WorkflowPanel } from "./WorkflowPanel";

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
  const blocked = !!summary && summary.status !== "completed" && !running;
  // A failed read must not strand a half-started owner behind an unreadable
  // conversation. Explicit Send may prepare it, but cannot infer or rebase the
  // missing head: the user reviews the restored context and sends again.
  const canPrepareOnly =
    !!prepareForSend &&
    enabled &&
    (!!conversation.error || !!contextRead.error) &&
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
    const signature = summary ? `${summary.head}:${summary.status}` : "";
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
      (summary?.head === pending ||
        turns.some((turn) => turn.header.id === pending))
    ) {
      setPending("");
      setDraft((value) => (value === sentDraft.current ? "" : value));
      onChanged();
    }
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [summary, turns, pending, onChanged, state]);
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
  const runsKey = JSON.stringify(state?.runs.slice(-4) ?? []);
  useEffect(() => {
    onWorkflowRuns?.(JSON.parse(runsKey));
  }, [runsKey, onWorkflowRuns]);
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
    setBusy(true);
    setError("");
    try {
      const reply = await approveWorkflow({
        client,
        state: observed,
        current: () =>
          alive.current &&
          latestState.current?.revision === observed.revision &&
          latestState.current?.enabled === true,
        submitting: (commandId) => {
          attempted.current = commandId;
          setApproving(commandId);
        },
      });
      if (!alive.current) return;
      if (reply.kind === "error") {
        // A lost reply may still have started the run; the observation shows it.
        setError(reply.error.code);
        setApproving("");
      } else setDraft((value) => (cadenceApproval(value) ? "" : value));
    } catch (e) {
      if (alive.current)
        setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      if (alive.current) {
        setBusy(false);
        workflow.refresh();
        conversation.refresh();
        onChanged();
      }
    }
  };
  const send = async (override?: string, retained?: PendingSend) => {
    const message = retained?.text ?? override ?? draft;
    const exiting = retained
      ? retained.command.kind === "cadence-exit"
      : cadence && cadenceExit(message);
    if (
      (!(exiting ? canExit : canSend) && !canPrepareOnly) ||
      running ||
      !message.trim()
    )
      return;
    if (!retained && !override && cadence && cadenceApproval(message)) {
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
    if (blocked && (!cadence || summary?.status === "unknown")) return;
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError("");
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
      if (alive.current) {
        setPreparing(false);
        setModelReads((n) => n + 1);
      }
    };
    try {
      if (canPrepareOnly) {
        await prepare(context ? { id, cwd: context.cwd } : undefined);
        if (!alive.current) return;
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
          head: summary?.head ?? null,
          text: message,
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
      if (!alive.current) return;
      if (intent.command.kind === "cadence-exit") {
        const commandId = intent.command.commandId;
        sentDraft.current = message;
        setPending(commandId);
        dispatched = true;
        const reply = await client.workbenchCommand(sendCommand(intent));
        if (!alive.current) return;
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
      if (!alive.current) return;
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
        if (!alive.current) return;
        if (restored.kind === "error") {
          setError(restored.error.code);
          chooseFirst();
          return;
        }
        catalog = await client.models(undefined, intent.location);
        if (!alive.current) return;
        setModelReads((n) => n + 1);
      }
      if (catalog.kind !== "ok" || !catalog.value.selected) {
        chooseFirst();
        return;
      }
      assertSendModel(intent, catalog.value.selected);
      const command = sendCommand(intent, catalog.value.version);
      sentDraft.current = message;
      setPending(command.commandId);
      dispatched = true;
      const reply = await client.workbenchCommand(command);
      if (!alive.current) return;
      if (reply.kind === "error") {
        setError(
          `${reply.error.code}. ${t("Observe this send before sending again. No automatic retry.")}`,
        );
        if (reply.error.effect === "none") setPending("");
        // Even a lost reply can have accepted work. Observe this exact turn ID.
      } else {
        setDraft((value) => (value === sentDraft.current ? "" : value));
        setPending("");
        if (command.kind === "cadence-send") {
          setMode("chat");
        }
      }
      workflow.refresh();
      conversation.refresh();
      onChanged();
    } catch (error) {
      if (alive.current)
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
      sending.current = false;
      if (alive.current) {
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
    const turn = turns.find((row) => row.header.id === summary?.head)?.header;
    if (!turn || busy) return;
    setBusy(true);
    const result = await client.workbenchCommand({
      kind: "interrupt",
      commandId: crypto.randomUUID(),
      conversationId: id,
      turnId: turn.id,
      epoch: turn.epoch,
    });
    if (!alive.current) return;
    if (result.kind === "error") setError(result.error.code);
    setBusy(false);
    conversation.refresh();
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
        </div>
        {summary && (
          <span className={`ep-state ${summary.status}`}>
            {cadence
              ? running
                ? t("Discussing")
                : blocked
                  ? tx(summary.status)
                  : state?.proposal
                    ? t("Awaiting plan approval")
                    : t("Ready for conversation")
              : tx(summary.status)}
          </span>
        )}
      </header>
      {contextRead.error && !canPrepareOnly && (
        <p role="alert" className="inspector-note">
          {contextRead.error}
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
        {rows.map(({ id, version, turn }) => (
          <LazyMount
            key={id}
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
        ))}
        {state && (
          <WorkflowPanel
            client={client}
            state={state}
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
            onOpenAgent={onOpenAgent}
            onChanged={() => {
              workflow.refresh();
              onChanged();
            }}
          />
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
        {blocked && cadence && summary?.status !== "unknown" && (
          <p className="inspector-note">
            {t(
              "The last turn did not complete. A new message continues from the last complete checkpoint; incomplete work is not replayed.",
            )}
          </p>
        )}
        {blocked && !cadence && (
          <p className="inspector-note">
            {t(
              "This turn has no complete continuation context. Start a new conversation; retained messages are preserved.",
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
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
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
        <div className="composer-toolbar">
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
                !draft.trim() ||
                (blocked && (!cadence || summary?.status === "unknown"))
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
