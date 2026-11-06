/** Reports only an interactive Pi's real agent lifetime; no presence, owner or control. */
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import {
  type ExtensionAPI,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
  ACTIVITY_RENEW_MS,
  ActivityFiles,
  type NativeActivity,
} from "./service/activity-files.ts";
import { selfMark } from "./service/liveness.ts";
import { type FileSnapshot, hash } from "./service/private-files.ts";
import {
  privateWorkspace,
  resolveWorkspaceAsync,
  stateHomeInside,
} from "./workspace.ts";

export interface ActivityPublisherOptions {
  store?: () => Pick<
    ActivityFiles,
    "scope" | "publish" | "withdraw" | "retireDead"
  >;
  now?: () => number;
  canonical?: (cwd: string, signal: AbortSignal) => string | Promise<string>;
}
export function registerActivity(
  pi: ExtensionAPI,
  options: ActivityPublisherOptions = {},
): void {
  if (process.env.CADENCE_SUBAGENT_CHILD === "1") return;
  const instance = randomUUID();
  const now = options.now ?? Date.now;
  let active:
    | {
        id: string;
        sessionId: string;
        abort: AbortController;
        record?: NativeActivity;
        saved?: FileSnapshot;
        store?: ReturnType<NonNullable<ActivityPublisherOptions["store"]>>;
      }
    | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retired = false;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    const previous = active;
    active = undefined; // Fence callbacks before any filesystem operation.
    previous?.abort.abort();
    try {
      if (previous?.store && previous.saved)
        previous.store.withdraw(instance, previous.saved);
    } catch {
      /* Retain uncertain bytes; discovery reports stale/unknown, not success. */
    }
  };
  pi.on("agent_start", (_event, ctx) => {
    if (retired || ctx.mode !== "tui" || !ctx.hasUI) return;
    try {
      const sessionId = ctx.sessionManager.getSessionId();
      if (active?.sessionId === sessionId) return; // retries/compaction/queued continuation
      stop();
      const cwdAtStart = ctx.cwd,
        sessionScope = hash(ctx.sessionManager.getSessionDir()),
        startedAt = now();
      const current = {
        id: randomUUID(),
        sessionId,
        abort: new AbortController(),
      } as NonNullable<typeof active>;
      active = current;
      // Lifecycle hooks never await publication. One callback at a time; timers
      // neither keep Pi alive nor run after settlement/session replacement.
      const publish = async () => {
        if (active !== current || retired) return;
        try {
          if (!current.store) {
            current.store =
              options.store?.() ?? new ActivityFiles(getAgentDir());
            const resolving = options.canonical
              ? options.canonical(cwdAtStart, current.abort.signal)
              : resolveWorkspaceAsync(cwdAtStart, current.abort.signal).then(
                  ({ root, cwd }) => {
                    if (privateWorkspace(root) || stateHomeInside(root))
                      throw new Error("private-workspace");
                    return realpathSync(cwd);
                  },
                );
            const cwd =
              typeof resolving === "string" ? resolving : await resolving;
            if (active !== current || retired) return;
            current.store.retireDead(now());
            current.record = {
              schema: "cadence-pi-activity/1",
              instance,
              activity: current.id,
              scope: current.store.scope,
              sessionScope,
              process: selfMark(),
              cwd,
              sessionId,
              leaf: null,
              startedAt,
              renewedAt: now(),
            };
          }
          const record = current.record;
          if (!record) return;
          record.leaf = ctx.sessionManager.getLeafId();
          record.renewedAt = now();
          current.saved = current.store.publish(record, current.saved);
          timer = setTimeout(publish, ACTIVITY_RENEW_MS);
          timer.unref?.();
        } catch {
          /* Observation failures do not fail, cancel or retry Pi work. */
        }
      };
      timer = setTimeout(publish, 0);
      timer.unref?.();
    } catch {
      /* Metadata is optional; no error escapes into Pi. */
    }
  });
  // agent_end is deliberately NOT a settlement signal.
  pi.on("agent_settled", (_event, ctx) => {
    if (!active || retired) return;
    try {
      if (active.sessionId === ctx.sessionManager.getSessionId()) stop();
    } catch {
      // An invalidated public context cannot fail Pi's final notification.
      // Preserve uncertain metadata but never keep renewing an idle report.
      clearTimeout(timer);
      timer = undefined;
      const previous = active;
      active = undefined;
      previous?.abort.abort();
    }
  });
  pi.on("session_shutdown", () => {
    retired = true;
    stop();
  });
}
