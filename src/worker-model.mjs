import {
  bool,
  canonicalJson,
  closed,
  decodeModelRetry,
  integer,
  list,
  oneOf,
  text,
} from "./worker-public.mjs";
import { own } from "./worker-redaction.mjs";

/** Service exceptions only. Pi owns defaults and user/project setting merges.
 * No cache-warming requests or second provider retry layer in owned workers. */
export const WORKER_POLICY = Object.freeze({
  retry: { provider: { maxRetries: 0 } },
  cacheWarming: "off",
  httpIdleTimeoutMs: 0,
});
export const WORKER_SETTINGS_BYTES = 32768;
/** A worker the service runs unattended keeps asking a failing provider far
 * longer than an interactive session would: nobody is there to press retry, and
 * a rate limit or an outage of some minutes must not cost the work done so far.
 * A floor under Pi's own retry settings (about half an hour of backoff at its
 * default base delay), never applied when the user turned retries off. */
export const UNATTENDED_RETRY = Object.freeze({
  maxRetries: 12,
  maxAgentDelayMs: 300_000,
});
export function unattendedRuntime(runtime) {
  const retry = runtime.settings.retry;
  if (!retry.enabled) return runtime;
  return decodeWorkerRuntime({
    ...runtime,
    settings: {
      ...runtime.settings,
      retry: {
        ...retry,
        maxRetries: Math.max(retry.maxRetries, UNATTENDED_RETRY.maxRetries),
        maxAgentDelayMs: Math.max(
          retry.maxAgentDelayMs,
          UNATTENDED_RETRY.maxAgentDelayMs,
        ),
      },
    },
  });
}

/** Public SDK factories are the source of built-in/default tool identities. */
export function defaultWorkerTools(pi, cwd) {
  const edit = pi.createCodingTools(cwd).map((tool) => tool.name);
  const readonly = pi.createReadOnlyTools(cwd).map((tool) => tool.name);
  return {
    edit,
    readonly,
    available: [
      ...new Set([...edit, ...readonly, pi.createPowerShellTool(cwd).name]),
    ],
  };
}

/** Resolve a selected model through Pi's public getters, not a second merge or
 * settings-default implementation. Only execution preferences cross the pipe;
 * package/extension/auth/model discovery settings never do. */
export function resolveWorkerRuntime(manager, model, defaults) {
  if (manager.drainErrors().length)
    throw new Error("Pi settings could not be read");
  const effective = manager.getSettings();
  const selected = manager.getDefaultTools();
  const tools = selected ?? defaults.edit;
  if (
    !Array.isArray(tools) ||
    tools.some((name) => !defaults.available.includes(name))
  )
    throw new Error("Configured Pi tools are unavailable in service workers");
  const provider = manager.getProviderRetrySettings();
  return decodeWorkerRuntime({
    projectTrusted: manager.isProjectTrusted(),
    tools: {
      edit: tools,
      readonly:
        selected === undefined
          ? defaults.readonly
          : tools.filter((name) => defaults.readonly.includes(name)),
    },
    settings: {
      compaction: manager.getCompactionSettings(model),
      retry: {
        ...manager.getRetrySettings(),
        provider: {
          ...WORKER_POLICY.retry.provider,
          maxRetryDelayMs: provider.maxRetryDelayMs,
          ...(provider.timeoutMs === undefined
            ? {}
            : { timeoutMs: provider.timeoutMs }),
        },
      },
      // A product default, not a replacement for an explicit Pi request policy.
      httpIdleTimeoutMs:
        effective.httpIdleTimeoutMs === undefined
          ? WORKER_POLICY.httpIdleTimeoutMs
          : manager.getHttpIdleTimeoutMs(),
      ...(manager.getWebSocketConnectTimeoutMs() === undefined
        ? {}
        : {
            websocketConnectTimeoutMs: manager.getWebSocketConnectTimeoutMs(),
          }),
      transport: manager.getTransport(),
      ...(manager.getThinkingBudgets() === undefined
        ? {}
        : { thinkingBudgets: manager.getThinkingBudgets() }),
      images: {
        autoResize: manager.getImageAutoResize(),
        blockImages: manager.getBlockImages(),
      },
      ...(manager.getShellPath() === undefined
        ? {}
        : { shellPath: manager.getShellPath() }),
      ...(manager.getShellCommandPrefix() === undefined
        ? {}
        : { shellCommandPrefix: manager.getShellCommandPrefix() }),
      cacheWarming: WORKER_POLICY.cacheWarming,
    },
  });
}

/** Closed, bounded private runtime snapshot; it grants no tool authority. */
export function decodeWorkerRuntime(value) {
  // JSON also removes omitted SDK getter fields. The wire owns plain data only.
  const v = JSON.parse(canonicalJson(value, WORKER_SETTINGS_BYTES));
  const o = closed(v, ["projectTrusted", "tools", "settings"]);
  const t = closed(o.tools, ["edit", "readonly"]);
  const r = o.settings;
  const s = closed(r, [
    "compaction",
    "retry",
    "httpIdleTimeoutMs",
    "transport",
    "images",
    "cacheWarming",
    ...[
      "websocketConnectTimeoutMs",
      "thinkingBudgets",
      "shellPath",
      "shellCommandPrefix",
    ].filter((key) => Object.hasOwn(r ?? {}, key)),
  ]);
  const c = closed(s.compaction, [
    "enabled",
    "reserveTokens",
    "keepRecentTokens",
  ]);
  const retry = closed(s.retry, [
    "enabled",
    "maxRetries",
    "baseDelayMs",
    "maxAgentDelayMs",
    "provider",
  ]);
  const provider = closed(retry.provider, [
    "maxRetries",
    "maxRetryDelayMs",
    ...(Object.hasOwn(retry.provider ?? {}, "timeoutMs") ? ["timeoutMs"] : []),
  ]);
  const images = closed(s.images, ["autoResize", "blockImages"]);
  const milliseconds = (v) => integer(v, 0, 2147483647);
  const names = (v) => {
    const result = list(v, 64, (name) => text(name, 128, true));
    if (new Set(result).size !== result.length)
      throw new Error("Duplicate Pi tool selection");
    return result;
  };
  const budgets = s.thinkingBudgets;
  if (budgets !== undefined) {
    closed(
      budgets,
      ["minimal", "low", "medium", "high"].filter((key) =>
        Object.hasOwn(budgets, key),
      ),
    );
    for (const value of Object.values(budgets)) integer(value, 0);
  }
  if (s.cacheWarming !== "off" || provider.maxRetries !== 0)
    throw new Error("Invalid service policy");
  return {
    projectTrusted: bool(o.projectTrusted),
    tools: { edit: names(t.edit), readonly: names(t.readonly) },
    settings: {
      compaction: {
        enabled: bool(c.enabled),
        reserveTokens: integer(c.reserveTokens, 0),
        keepRecentTokens: integer(c.keepRecentTokens, 0),
      },
      retry: {
        enabled: bool(retry.enabled),
        maxRetries: integer(retry.maxRetries, 0),
        baseDelayMs: milliseconds(retry.baseDelayMs),
        maxAgentDelayMs: milliseconds(retry.maxAgentDelayMs),
        provider: {
          maxRetries: 0,
          maxRetryDelayMs: milliseconds(provider.maxRetryDelayMs),
          ...(provider.timeoutMs === undefined
            ? {}
            : { timeoutMs: milliseconds(provider.timeoutMs) }),
        },
      },
      httpIdleTimeoutMs: milliseconds(s.httpIdleTimeoutMs),
      ...(s.websocketConnectTimeoutMs === undefined
        ? {}
        : {
            websocketConnectTimeoutMs: milliseconds(
              s.websocketConnectTimeoutMs,
            ),
          }),
      transport: oneOf(s.transport, [
        "auto",
        "sse",
        "websocket",
        "websocket-cached",
      ]),
      ...(budgets === undefined ? {} : { thinkingBudgets: budgets }),
      images: {
        autoResize: bool(images.autoResize),
        blockImages: bool(images.blockImages),
      },
      ...(s.shellPath === undefined
        ? {}
        : { shellPath: text(s.shellPath, 4096) }),
      ...(s.shellCommandPrefix === undefined
        ? {}
        : { shellCommandPrefix: text(s.shellCommandPrefix, 8192) }),
      cacheWarming: "off",
    },
  };
}

export function describeWorkerRuntime(runtime) {
  const { settings: s, tools } = runtime;
  return `Pi runtime: project settings ${runtime.projectTrusted ? "trusted" : "not loaded"}; tools ${tools.edit.join(", ") || "none"}; readonly ${tools.readonly.join(", ") || "none"}; auto-compaction ${s.compaction.enabled ? "on" : "off"} (reserve ${s.compaction.reserveTokens}, keep ${s.compaction.keepRecentTokens}); request retries ${s.retry.enabled ? s.retry.maxRetries : "off"}; HTTP idle ${s.httpIdleTimeoutMs === 0 ? "disabled" : `${s.httpIdleTimeoutMs}ms`}; shell ${s.shellPath || s.shellCommandPrefix ? "configured" : "default"}. Provider retries and cache warming are off.`;
}

/** Observation only: AgentSession owns classification, backoff and continuation.
 * Session listeners are synchronous. CaptureEmitter reserves/enqueues before
 * returning its promise; every rejection is handled without leaking SDK text. */
export class WorkerModelState {
  requestPrepared = false;
  actualResponseStatus = "UNKNOWN";
  retryAttempts = 0;
  progress = null;
  /** The provider's words for the last failed request, as `describe` kept them. */
  reason = "";
  /** `describe` turns provider text into what may leave the worker (redacted,
   * bounded), or "" for nothing; without it no provider text is kept. */
  constructor(emit, fail, describe = () => "") {
    this.emit = emit;
    this.fail = fail;
    this.describe = describe;
  }
  publish(progress) {
    this.progress = progress;
    try {
      return Promise.resolve(this.emit({ kind: "model-retry", progress }));
    } catch (error) {
      return Promise.reject(error);
    }
  }
  event(event) {
    try {
      const type = own(event, "type");
      let pending;
      if (type === "auto_retry_start") {
        this.reason = this.describe(own(event, "errorMessage"));
        const progress = decodeModelRetry({
          phase: "waiting",
          attempt: own(event, "attempt"),
          maxAttempts: own(event, "maxAttempts"),
          delayMs: own(event, "delayMs"),
          ...(this.reason ? { reason: this.reason } : {}),
        });
        this.retryAttempts = progress.attempt;
        pending = this.publish(progress);
      } else if (type === "auto_retry_end" && this.progress) {
        // This event is not proof of success, native closure or task completion.
        pending = this.publish(null);
      }
      pending?.catch(() => this.fail());
    } catch {
      this.fail();
    }
  }
  async beginRequest() {
    // Each attempt owns its observations, including one that gets no response.
    this.requestPrepared = false;
    this.actualResponseStatus = "UNKNOWN";
    if (!this.progress) {
      this.retryAttempts = 0;
      return;
    }
    try {
      await this.publish({ ...this.progress, phase: "requesting", delayMs: 0 });
    } catch (error) {
      this.fail();
      throw error;
    }
  }
}

/** One private, sequential request at a time. Replies contain credentials only
 * on the owner/child IPC pipe, never in capture or a tool result. No retry here.
 * SDK availability checks and prompt/request auth can overlap in ONE worker;
 * worker-reservation limits are not an admission limit for these callers.
 * Await their originals in order, keeping at most one owner request in flight.
 * Abort is owned by the session; disconnect is a real loss of its auth owner. */
export function ownerAuth(channel, retain, fail = () => {}) {
  let sequence = 0;
  let pending;
  let tail = Promise.resolve();
  let closed = false;
  const disconnect = () => {
    closed = true;
    if (pending) fail("owner-auth-lost");
    pending?.reject(new Error("Owner authentication channel disconnected"));
    pending = undefined;
  };
  const message = (value) => {
    if (value?.kind !== "auth" || !pending || value.id !== pending.id) return;
    const waiting = pending;
    pending = undefined;
    if (!value.ok || !value.auth?.ok) {
      fail("owner-auth-refused");
      waiting.reject(new Error("Owner authentication refused"));
      return;
    }
    retain(value.auth);
    waiting.resolve(value.auth);
  };
  channel.on("message", message);
  channel.on("disconnect", disconnect);
  return {
    resolve() {
      if (closed || !channel.connected)
        return Promise.reject(new Error("Owner authentication unavailable"));
      const original = tail.then(
        () =>
          new Promise((resolve, reject) => {
            if (closed || !channel.connected) {
              reject(new Error("Owner authentication unavailable"));
              return;
            }
            const id = ++sequence;
            pending = { id, resolve, reject };
            try {
              channel.send({ kind: "auth", id }, (error) => {
                if (error) disconnect();
              });
            } catch {
              disconnect();
            }
          }),
      );
      tail = original.then(
        () => {},
        () => {},
      );
      return original;
    },
    close() {
      disconnect();
      channel.removeListener("message", message);
      channel.removeListener("disconnect", disconnect);
    },
  };
}
