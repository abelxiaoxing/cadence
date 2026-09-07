import {
  type AssistantMessage,
  type Context,
  cleanupSessionResources,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";

/** Only the public model transport contract crosses into the child executor. */
export type ChildModelClient = Pick<Models, "streamSimple">;

export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

function notify(callback: (() => void) | undefined) {
  try {
    callback?.();
  } catch {
    /* Observers cannot control execution. */
  }
}

/** Consume one complete model turn, never execute tools from partial events. */
export async function requestChildTurn(input: {
  client: ChildModelClient;
  model: Model<string>;
  context: Context;
  signal: AbortSignal;
  sessionId: string;
  onStart?: () => void;
  onProgress?: () => void;
  onMessage(message: AssistantMessage): void;
}): Promise<AssistantMessage | undefined> {
  input.signal.throwIfAborted();
  const stream = input.client.streamSimple(input.model, input.context, {
    signal: input.signal,
    reasoning: "low",
    maxRetries: 0,
    sessionId: input.sessionId,
  });
  let accepting = true;
  let final: AssistantMessage | undefined;
  const consume = (async () => {
    for await (const event of stream) {
      if (!accepting) break;
      if (event.type === "start") notify(input.onStart);
      else if (event.type === "done" || event.type === "error") {
        final = event.type === "done" ? event.message : event.error;
        input.onMessage(final);
        break;
      } else notify(input.onProgress);
    }
    return final;
  })();
  try {
    return await abortable(consume, input.signal);
  } finally {
    if (input.signal.aborted) {
      // Retain terminal usage from cooperative cancellation, but bound cleanup
      // for a Provider which ignores AbortSignal. Late output is never admitted.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        consume.catch(() => undefined),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 250);
        }),
      ]);
      if (timer !== undefined) clearTimeout(timer);
    }
    accepting = false;
  }
}

/** Release only this child's provider caches/connections, never host sessions. */
export function disposeChildTransport(sessionId: string): void {
  cleanupSessionResources(sessionId);
}
