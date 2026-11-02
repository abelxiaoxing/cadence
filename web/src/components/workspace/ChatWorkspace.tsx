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
  FiCornerDownRight,
  FiGitBranch,
  FiMessageSquare,
  FiSquare,
} from "react-icons/fi";
import {
  type ChatSummary,
  decodeWorkbenchCommand,
  type WorkbenchCommand,
} from "../../../../src/service/contracts/workbench.ts";
import type { ServiceClient } from "../../../../src/service-client.ts";
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
import { BranchTree } from "./BranchTree";
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
  enabled,
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
  enabled: boolean;
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
  const draftKey = `cadence:draft:${workspaceId}:${id}`;
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
    observed &&
    !conversation.error &&
    modeObserved &&
    !(cadence && (workflow.error || state?.notice)) &&
    !busy &&
    !pending;
  const summary = conversation.summary ?? undefined;
  const running =
    summary && (summary.status === "queued" || summary.status === "running");
  // A failed or interrupted reply stays in the session; the next message
  // continues the branch as it would in the terminal.
  const settledBadly = !!summary && summary.status !== "completed" && !running;
  const [branchesOpen, setBranchesOpen] = useState(false);
  const canExit =
    canInterrupt &&
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
  // The branch end a pending message was sent from: once the branch moves on
  // without it live, its outcome is in the session (or its attempt record).
  const pendingHead = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
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
        (summary && !summary.live && pendingHead.current !== conversation.leaf))
    ) {
      setPending("");
      setDraft((value) => (value === sentDraft.current ? "" : value));
      onChanged();
    }
    if (stick.current && scroll.current)
      scroll.current.scrollTop = scroll.current.scrollHeight;
  }, [summary, turns, pending, onChanged, state, conversation]);
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
  const approve = async () => {
    if (!state?.proposal) {
      setError(t("No plan is awaiting approval."));
      return;
    }
    if (!cadenceKnown || !canSend || running || approving || !planApprovable)
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
  const send = async (override?: string) => {
    const message = override ?? draft;
    const exiting = cadence && cadenceExit(message);
    if (!(exiting ? canExit : canSend) || running || !message.trim()) return;
    if (!override && cadence && cadenceApproval(message)) {
      await approve();
      return;
    }
    const selecting = cadenceInput(message, mode).mode === "cadence";
    if ((cadence || selecting) && !cadenceKnown) {
      setError(
        t(
          "Cadence state unavailable. Observe the conversation before sending.",
        ),
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (cadence && cadenceExit(message) && state) {
        const commandId = crypto.randomUUID();
        sentDraft.current = message;
        pendingHead.current = conversation.leaf;
        setPending(commandId);
        const reply = await client.workbenchCommand({
          kind: "cadence-exit",
          commandId,
          conversationId: id,
          head: conversation.leaf,
          revision: state.revision,
        });
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
        setAwaitingModel(true);
        setModelOpen(true);
      };
      let catalog = await client.models();
      if (!alive.current) return;
      // Send installs the saved preference; with none, the model control
      // opens and this message waits for one explicit choice.
      if (
        catalog.kind === "ok" &&
        !catalog.value.selected &&
        catalog.value.remembered
      ) {
        const restored = await client.workbenchCommand({
          kind: "restore-model",
          commandId: crypto.randomUUID(),
          epoch: catalog.value.version.epoch,
        });
        if (!alive.current) return;
        if (restored.kind === "error") {
          setError(restored.error.code);
          chooseFirst();
          return;
        }
        catalog = await client.models();
        if (!alive.current) return;
        setModelReads((n) => n + 1);
      }
      if (catalog.kind !== "ok" || !catalog.value.selected) {
        chooseFirst();
        return;
      }
      // The message continues the branch shown: a session that moved on
      // meanwhile (in the terminal, too) gains a branch.
      const common = {
        commandId: crypto.randomUUID(),
        conversationId: id,
        head: conversation.leaf,
        text: message,
        model: catalog.value.version,
      };
      // A Cadence command was refused above without an observed mode record.
      const command: WorkbenchCommand =
        (cadence || selecting) && state
          ? {
              kind: "cadence-send",
              ...common,
              revision: state.revision,
              intent: cadenceExit(message)
                ? "exit"
                : cadence
                  ? "message"
                  : "enter",
            }
          : { kind: "send", ...common };
      decodeWorkbenchCommand(command); // Refuse invalid/oversize text before any pending-send state.
      sentDraft.current = message;
      pendingHead.current = conversation.leaf;
      setPending(command.commandId);
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
        // The new reply ends the branch: follow it as the session's latest.
        conversation.choose(null);
      }
      workflow.refresh();
      conversation.refresh();
      onChanged();
    } catch {
      if (alive.current)
        setError(
          t(
            "Send unavailable. Check the message limit (16 KiB); observe any pending command before sending again.",
          ),
        );
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  const sendLatest = useRef(send);
  sendLatest.current = send;
  // The Send that waited for a model continues once sending is possible again.
  useEffect(() => {
    if (resume && canSend && !running) {
      setResume(false);
      void sendLatest.current();
    }
  }, [resume, canSend, running]);
  // Never a late surprise: if sending stays impossible, the message waits.
  useEffect(() => {
    if (!resume) return;
    const timer = setTimeout(() => setResume(false), 10000);
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
              onClick={() => conversation.choose(null)}
            >
              {t("Show the latest")}
            </button>
          )}
          {summary && (
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
      {branchesOpen && (
        <BranchTree
          client={client}
          id={id}
          leaf={conversation.leaf}
          onChoose={(leaf) => {
            conversation.choose(leaf);
            setBranchesOpen(false);
          }}
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
            {turn.header.entry &&
              turn.ordinal < conversation.count - 1 &&
              !running && (
                <button
                  type="button"
                  className="ghost turn-branch"
                  title={t(
                    "Show the conversation up to here. The next message starts a new branch; nothing is deleted.",
                  )}
                  onClick={() => conversation.choose(turn.header.entry)}
                >
                  <FiCornerDownRight aria-hidden="true" />
                  {t("Continue from here")}
                </button>
              )}
          </LazyMount>
        ))}
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
        {state && (
          <WorkflowPanel
            client={client}
            state={state}
            runs={runs}
            canApprove={
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
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <textarea
          ref={textarea}
          disabled={
            (!enabled && !(cadence && canInterrupt)) ||
            !observed ||
            !modeObserved ||
            !!conversation.error ||
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
            client={client}
            enabled={modelEnabled && available}
            locked={!!running}
            refresh={String(modelReads)}
            open={modelOpen}
            onOpenChange={(value) => {
              setModelOpen(value);
              if (!value) setAwaitingModel(false);
            }}
            onChanged={onModelChanged}
            onChosen={() => {
              if (!awaitingModel) return;
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
                !(cadence && cadenceExit(draft) ? canExit : canSend) ||
                !draft.trim()
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
