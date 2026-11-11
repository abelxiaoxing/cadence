/** Messages a browser sends into a running conversation turn, handed over by
 * the owner on the worker's private IPC channel. A steer goes to Pi at once,
 * which delivers it at its next opportunity; every other message waits here
 * and becomes the next prompt once the reply has ended normally. Nothing here
 * outlives the worker, and a message is identified by the order Pi was given
 * it in, never by its text. */
import { closed, decodeId, LIMITS } from "./worker-public.mjs";
import { own } from "./worker-redaction.mjs";

/** Whether the reply an `agent_end` closes failed or was aborted; an event
 * that cannot be read counts as failed. */
function unsuccessful(event) {
  try {
    const messages = own(event, "messages");
    for (let i = messages.length - 1; i >= 0; i--)
      if (own(messages[i], "role") === "assistant")
        return ["error", "aborted"].includes(own(messages[i], "stopReason"));
    return false;
  } catch {
    return true;
  }
}

/** `fail(category)` reports a broken channel or sequence; the caller aborts. */
export function conversationInputs(channel, session, fail) {
  /** Handed to Pi as steers, in the order it delivers them. */
  const steering = [];
  /** Not handed to Pi: each becomes a prompt of its own, oldest first. */
  const waiting = [];
  const known = new Set();
  let open = true;
  /** A reply's request failed for good: no steer until another one starts. */
  let held = false;
  const recall = () => {
    if (!steering.length) return;
    session.clearQueue();
    waiting.unshift(...steering.splice(0));
  };
  const steer = (input) => {
    // Listed before Pi has it, so its delivery always finds it here.
    steering.push(input);
    let disposition;
    session
      .prompt(input.text, {
        streamingBehavior: "steer",
        expandPromptTemplates: false,
        preflightResult: (value) => {
          disposition = value;
          // Pi takes a steer only into a running reply; anything else is
          // work this worker did not sequence.
          if (value !== "queued") fail("input-not-queued");
        },
      })
      .then(
        () => {
          if (disposition === undefined) fail("input-not-queued");
        },
        () => {
          // Pi took nothing (it is compacting, for one): the message waits.
          const at = steering.indexOf(input);
          if (at < 0) return;
          steering.splice(at, 1);
          if (open) waiting.push(input);
        },
      );
  };
  const receive = (message) => {
    // Credential and coordinator replies share this channel.
    const kind =
      message && typeof message === "object" ? message.kind : undefined;
    if (kind !== "input" && kind !== "input-cancel") return;
    try {
      if (kind === "input-cancel") {
        const id = decodeId(closed(message, ["kind", "id"]).id);
        const at = waiting.findIndex((input) => input.id === id);
        if (at >= 0) waiting.splice(at, 1);
        channel.send({ kind, id, removed: at >= 0 }, () => {});
        return;
      }
      const row = closed(message, ["kind", "id", "mode", "text"]);
      const input = { id: decodeId(row.id), text: row.text };
      if (
        !["steer", "queue"].includes(row.mode) ||
        typeof input.text !== "string" ||
        !input.text.trim() ||
        Buffer.byteLength(input.text) > LIMITS.workerRequestBytes ||
        known.has(input.id)
      )
        throw new Error("Invalid input");
      known.add(input.id);
      // The reply is ending or has failed: the owner records it undelivered.
      if (!open) return;
      if (row.mode === "steer" && !held && session.isStreaming) steer(input);
      else waiting.push(input);
    } catch {
      fail("invalid-input");
    }
  };
  channel.on("message", receive);
  return {
    /** Pi's own events, as `session.subscribe` reports them. A reply that
     * failed for good must not continue into the steers Pi still holds: they
     * come back to wait, and whether anything further is delivered is decided
     * when the prompt returns (Pi may yet recover by compacting). */
    event(event) {
      if (event.type === "agent_start") held = false;
      else if (
        event.type === "agent_end" &&
        event.willRetry !== true &&
        unsuccessful(event)
      ) {
        held = true;
        recall();
      }
    },
    /** The input whose message Pi has just delivered into the running reply. */
    delivered() {
      return steering.shift();
    },
    /** After a reply ended normally: the message to prompt with next. A steer
     * Pi never looked at again waits first. Without one the turn is over and
     * nothing further is taken. */
    next() {
      recall();
      const input = waiting.shift();
      if (!input) open = false;
      return input;
    },
    /** The turn failed or is being stopped: nothing further is delivered. */
    stop() {
      open = false;
      waiting.length = 0;
      if (!steering.length) return;
      steering.length = 0;
      session.clearQueue();
    },
    close() {
      open = false;
      channel.removeListener("message", receive);
    },
  };
}
