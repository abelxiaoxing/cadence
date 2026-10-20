/** Opt-in fixed aggregate diagnostics for isolated fabricated history fixtures.
 * No paths, payloads, credentials, exception objects or per-event log retention. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { HistoryFiles, HistoryReadBudget } from "../../src/history/files.ts";
import { HistoryNavigation } from "../../src/history/navigation.ts";
import { PrivateFiles } from "../../src/service/private-files.ts";

export function historyProfile(label: string) {
  const root = process.env.CADENCE_HISTORY_PROFILE;
  const counts: Record<
    string,
    { count: number; ms: number; maximumMs: number; bytes: number }
  > = {};
  const restore: (() => void)[] = [];
  const started = performance.now();
  const wrap = (object: object, key: string, name = key) => {
    if (!root) return;
    const target = object as Record<string, (...args: unknown[]) => unknown>;
    const original = target[key];
    target[key] = function (...args) {
      const at = performance.now();
      counts[name] ??= { count: 0, ms: 0, maximumMs: 0, bytes: 0 };
      const metric = counts[name];
      metric.count++;
      if (name === "budget" && typeof args[0] === "number")
        metric.bytes += args[0];
      const done = () => {
        const ms = performance.now() - at;
        metric.ms += ms;
        metric.maximumMs = Math.max(metric.maximumMs, ms);
      };
      try {
        const result = Reflect.apply(original, this, args);
        if (result instanceof Promise) return result.finally(done);
        done();
        return result;
      } catch (error) {
        done();
        throw error;
      }
    };
    restore.push(() => {
      target[key] = original;
    });
  };
  for (const key of ["create", "replace", "read", "assert"])
    wrap(PrivateFiles.prototype, key, `private.${key}`);
  for (const key of [
    "append",
    "encodeBatch",
    "writeArtifact",
    "syncParents",
    "validateRecovery",
  ])
    wrap(HistoryFiles.prototype, key, `history.${key}`);
  for (const key of [
    "prepare",
    "publish",
    "publishActive",
    "snapshot",
    "next",
    "batch",
  ])
    wrap(HistoryNavigation.prototype, key, `navigation.${key}`);
  wrap(HistoryReadBudget.prototype, "reserve", "budget");
  return {
    wrap,
    finish() {
      for (const undo of restore.reverse()) undo();
      if (root)
        writeFileSync(
          join(root, `${label}.json`),
          JSON.stringify(
            { label, elapsedMs: performance.now() - started, counts },
            null,
            2,
          ),
          { mode: 0o600 },
        );
    },
  };
}
