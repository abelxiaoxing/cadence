/** The upstream browser's readonly source seam, adapted to Cadence's bus.
 * No manager, SDK session, filesystem path or execution operation crosses it. */
import type {
  AgentSession,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  described,
  factsText,
  type SubagentState,
  type SubagentStore,
} from "../agent-panel-model.ts";

export type SessionMessage = AgentSession["messages"][number];
export interface ModelIdentity {
  provider: string;
  id: string;
}
export interface EntryHeading {
  name: string;
  modeLabel: string | undefined;
  description: string;
}
export interface TranscriptSource {
  getMessages(): readonly SessionMessage[];
  inFlight(): Extract<SessionMessage, { role: "assistant" }> | undefined;
  subscribe(onChange: () => void): (() => void) | undefined;
  streaming(): string | undefined;
  notice(): string | undefined;
  getToolDefinition(name: string): ToolDefinition | undefined;
  sessionModel(): {
    model: ModelIdentity | undefined;
    thinkingLevel: Parameters<Theme["getThinkingBorderColor"]>[0] | undefined;
  };
}
export interface NavigationEntry {
  id: string;
  label: string;
  heading: EntryHeading;
  source: TranscriptSource;
}
export interface BrowserSource {
  entries(): NavigationEntry[];
  subscribe(changed: () => void): () => void;
  view(id: string | null): void;
}

/** Keep the producer's message identities so the upstream content cache can
 * append settled blocks without rebuilding earlier messages. */
function renderable(message: object): boolean {
  const m = message as { role?: unknown; content?: unknown };
  if (m.role === "user")
    return (
      typeof m.content === "string" ||
      (Array.isArray(m.content) &&
        m.content.every((block) => block && typeof block === "object"))
    );
  if (m.role === "toolResult") return Array.isArray(m.content);
  if (m.role !== "assistant" || !Array.isArray(m.content)) return false;
  return m.content.every(
    (block) =>
      block &&
      typeof block === "object" &&
      ((block.type === "text" && typeof block.text === "string") ||
        (block.type === "thinking" && typeof block.thinking === "string") ||
        (block.type === "toolCall" &&
          typeof block.name === "string" &&
          typeof block.id === "string")),
  );
}

function transcriptSource(
  store: SubagentStore,
  agent: SubagentState,
): TranscriptSource {
  let revision = -1;
  let messages: SessionMessage[] = [];
  let partial: Extract<SessionMessage, { role: "assistant" }> | undefined;
  const refresh = () => {
    if (revision === agent.revision) return;
    revision = agent.revision;
    const visible = agent.messages.filter(renderable) as SessionMessage[];
    const tail = visible.at(-1);
    // The feed replaces a streaming snapshot rather than emitting SDK deltas.
    // Keep it out of settled history so the upstream cache only repaints the
    // live tail. Clone it because a producer may mutate that snapshot in place.
    partial =
      agent.streaming &&
      tail === agent.messages.at(-1) &&
      tail?.role === "assistant"
        ? { ...tail }
        : undefined;
    messages = partial ? visible.slice(0, -1) : visible;
    if (agent.streaming && !partial && tail)
      messages[messages.length - 1] = { ...tail };
  };
  return {
    getMessages() {
      refresh();
      return messages;
    },
    inFlight() {
      refresh();
      return partial;
    },
    subscribe: (changed) => {
      let seenRevision = agent.revision;
      let seenStatus = agent.status;
      let seenActivity = agent.activity;
      return store.subscribe(() => {
        if (
          seenRevision === agent.revision &&
          seenStatus === agent.status &&
          seenActivity === agent.activity
        )
          return;
        seenRevision = agent.revision;
        seenStatus = agent.status;
        seenActivity = agent.activity;
        changed();
      });
    },
    streaming: () =>
      agent.status === "running" ? agent.activity || "Working" : undefined,
    notice: () =>
      agent.omitted
        ? `… ${agent.omitted} earlier messages not retained; see /cadence-history`
        : !agent.messages.length
          ? "No retained messages observed yet"
          : undefined,
    getToolDefinition: () => undefined,
    // The feed records no model or thinking evidence: do not borrow the parent's.
    sessionModel: () => ({ model: undefined, thinkingLevel: undefined }),
  };
}

export function cadenceBrowserSource(
  store: SubagentStore,
  view: (id: string | null) => void,
  now: () => number,
): BrowserSource {
  const sources = new Map<string, TranscriptSource>();
  return {
    entries: () => {
      for (const id of sources.keys()) if (!store.get(id)) sources.delete(id);
      return store.ordered().map((agent) => {
        let source = sources.get(agent.id);
        if (!source) {
          source = transcriptSource(store, agent);
          sources.set(agent.id, source);
        }
        return {
          id: agent.id,
          label: `${described(agent)} · ${agent.status} · ${factsText(agent, now())}`,
          heading: {
            name: agent.label,
            modeLabel: agent.kind,
            get description() {
              return agent.status;
            },
          },
          source,
        };
      });
    },
    subscribe: (changed) => store.subscribe(changed),
    view,
  };
}
