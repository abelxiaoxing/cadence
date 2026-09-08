import {
  type AssistantMessage,
  type Context,
  cleanupSessionResources,
  type Model,
  type Models,
} from "@earendil-works/pi-ai";

import { requestBounds, TransportTimeout } from "./transport-budget.ts";

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
  onHeaders?: () => void;
  onProgress?: () => void;
  onMessage(message: AssistantMessage): void;
}): Promise<AssistantMessage | undefined> {
  input.signal.throwIfAborted();
  const bounds = requestBounds();
  const controller = new AbortController();
  const forward = () => controller.abort(input.signal.reason);
  input.signal.addEventListener("abort", forward, { once: true });
  let accepting = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = (
    code: "first-progress-timeout" | "stream-idle-timeout",
    ms: number,
  ) => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new TransportTimeout(code)), ms);
  };
  let consume: Promise<AssistantMessage | undefined> | undefined;
  try {
    schedule("first-progress-timeout", bounds.firstProgressMs);
    notify(input.onStart);
    controller.signal.throwIfAborted();
    const stream = input.client.streamSimple(input.model, input.context, {
      signal: controller.signal,
      reasoning: "low",
      ...(Number.isFinite(input.model.contextWindow) &&
      Number.isFinite(input.model.maxTokens)
        ? {
            maxTokens: Math.max(
              1,
              Math.min(
                input.model.maxTokens,
                Math.floor(input.model.contextWindow / 2),
              ),
            ),
          }
        : {}),
      maxRetries: 0,
      sessionId: input.sessionId,
      onResponse: () => {
        if (accepting && !controller.signal.aborted) notify(input.onHeaders);
      },
    });
    consume = (async () => {
      for await (const event of stream) {
        if (!accepting) break;
        if (event.type === "done" || event.type === "error") {
          const final = event.type === "done" ? event.message : event.error;
          // Cooperative cancellation may report terminal usage during bounded drain.
          input.onMessage(final);
          return final;
        }
        if (
          !controller.signal.aborted &&
          (event.type === "text_delta" ||
            event.type === "thinking_delta" ||
            event.type === "toolcall_delta") &&
          event.delta.length > 0
        ) {
          schedule("stream-idle-timeout", bounds.streamIdleMs);
          notify(input.onProgress);
        }
      }
      return undefined;
    })();
    return await abortable(consume, controller.signal);
  } finally {
    clearTimeout(timer);
    input.signal.removeEventListener("abort", forward);
    if (controller.signal.aborted && consume) {
      let drainTimer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        consume.catch(() => undefined),
        new Promise<void>((resolve) => {
          drainTimer = setTimeout(resolve, bounds.cancellationDrainMs);
        }),
      ]);
      clearTimeout(drainTimer);
    }
    accepting = false;
  }
}

/** Release only this child's provider caches/connections, never host sessions. */
export function disposeChildTransport(sessionId: string): void {
  cleanupSessionResources(sessionId);
}
