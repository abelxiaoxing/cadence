/** Opt-in fixture-only aggregate timings. No payloads, paths, tokens or secrets. */
import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { vi } from "vitest";
import { HistoryFiles } from "../../src/history/files.ts";
import { HistoryNavigation } from "../../src/history/navigation.ts";
import { PrivateFiles } from "../../src/service/private-files.ts";

export function historyPhaseMetrics(test: string) {
  const path = process.env.CADENCE_W3_PHASE_LOG;
  const start = performance.now(),
    wall = Date.now(),
    fakeTimers = vi.isFakeTimers();
  let phase = "setup",
    since = start;
  const phases: Record<string, number> = {};
  const calls: Record<string, { count: number; ms: number; pending: number }> =
    {};
  const restores: (() => void)[] = [];
  // Wrappers return the exact original value/promise. Side observers are handled
  // independently; they neither join nor replace native/file promises.
  function watch(object: object, method: string) {
    const target = object as Record<string, (...args: unknown[]) => unknown>;
    const original = target[method];
    const spy = vi.spyOn(target, method).mockImplementation(function (
      this: unknown,
      ...args
    ) {
      const at = performance.now(),
        key = `${phase}/${method}`;
      calls[key] ??= { count: 0, ms: 0, pending: 0 };
      const entry = calls[key];
      entry.count++;
      try {
        const result = original.apply(this, args);
        if (result instanceof Promise) {
          entry.pending++;
          const settled = () => {
            entry.pending--;
            entry.ms += performance.now() - at;
          };
          void result.then(settled, settled);
        } else entry.ms += performance.now() - at;
        return result;
      } catch (error) {
        entry.ms += performance.now() - at;
        throw error;
      }
    });
    restores.push(() => spy.mockRestore());
  }
  if (path) {
    watch(HistoryFiles.prototype, "append");
    for (const name of ["create", "replace", "read"])
      watch(PrivateFiles.prototype, name);
    for (const name of [
      "prepare",
      "publish",
      "snapshot",
      "latest",
      "batch",
      "entityBatches",
    ])
      watch(HistoryNavigation.prototype, name);
  }
  return {
    phase(next: string) {
      const now = performance.now();
      phases[phase] = (phases[phase] ?? 0) + now - since;
      since = now;
      phase = next;
    },
    finish(facts: Record<string, number | boolean> = {}) {
      const now = performance.now();
      phases[phase] = (phases[phase] ?? 0) + now - since;
      for (const restore of restores.reverse()) restore();
      if (path)
        appendFileSync(
          path,
          `${JSON.stringify({ test, totalMs: now - start, wallMs: Date.now() - wall, fakeTimers, fakeTimersAtFinish: vi.isFakeTimers(), phases, calls, facts })}\n`,
          { mode: 0o600 },
        );
    },
  };
}
