/** Owner-process memory of per-task fold states, an accelerator only. The
 * writer remembers a task's state at its chain head from its own commits when
 * a batch settles that task's publication; readers in this process resume from
 * the newest remembered state at or before their snapshot whose chain hash
 * still matches, and fold only the newer original batches on top. Any miss (an
 * evicted entry, another process, a restart, a diverged chain) folds the
 * original chain: correctness never depends on this memory, and nothing is
 * persisted, authenticated or repaired. Budget exhaustion is never absence. */
import type { CheckFoldState } from "./checks.ts";
import type { HistoryFiles, HistoryReadBudget } from "./files.ts";
import type { HistoryNavigation, LocatedBatch } from "./navigation.ts";
import type { PlanFoldState } from "./reader.ts";

export interface TaskFoldState {
  checks: CheckFoldState;
  run: string | null;
  plan: PlanFoldState;
}
export interface TaskFoldAnchor {
  seq: string;
  hash: string;
}
/** Tasks remembered per store and states per task; beyond either, the oldest
 * goes and later reads of it fold the original chain. */
const TASKS = 1024,
  STATES = 8;
class TaskFoldMemory {
  private readonly tasks = new Map<
    string,
    Map<string, { hash: string; state: TaskFoldState }>
  >();
  has(taskId: string): boolean {
    return this.tasks.has(taskId);
  }
  remember(taskId: string, anchor: TaskFoldAnchor, state: TaskFoldState): void {
    let states = this.tasks.get(taskId);
    if (!states) {
      if (this.tasks.size >= TASKS)
        this.tasks.delete(this.tasks.keys().next().value ?? "");
      states = new Map();
      this.tasks.set(taskId, states);
    }
    states.delete(anchor.seq);
    states.set(anchor.seq, {
      hash: anchor.hash,
      state: structuredClone(state),
    });
    if (states.size > STATES) states.delete(states.keys().next().value ?? "");
  }
  /** A copy of the state remembered at exactly this chain link, if its hash
   * matches; no reader can alter what later readers resume from. */
  recall(taskId: string, anchor: TaskFoldAnchor): TaskFoldState | undefined {
    const entry = this.tasks.get(taskId)?.get(anchor.seq);
    return entry?.hash === anchor.hash
      ? structuredClone(entry.state)
      : undefined;
  }
}
const memories = new Map<string, TaskFoldMemory>();
/** One memory per store in this process, shared by its writer and readers. */
export function taskFoldMemory(files: HistoryFiles): TaskFoldMemory {
  const key = `${files.directory}\0${files.format.storeId}`;
  let memory = memories.get(key);
  if (!memory) {
    memory = new TaskFoldMemory();
    memories.set(key, memory);
  }
  return memory;
}
/** One fold part through `snapshot`: the newest remembered state's part and the
 * newer original batches, or no base and the original chain (or snapshot
 * scan). A part that cannot be resumed is a miss, never a refusal. */
export function resumeTaskFold<T>(
  files: HistoryFiles,
  navigation: HistoryNavigation,
  taskId: string,
  snapshot: string,
  budget: HistoryReadBudget,
  resume: (state: TaskFoldState) => T,
): { base: T | undefined; batches: Iterable<LocatedBatch> } {
  const memory = taskFoldMemory(files);
  const suffix = memory.has(taskId)
    ? navigation.taskSuffix(taskId, snapshot, budget, (head) => {
        const state = memory.recall(taskId, head);
        if (!state) return;
        try {
          return resume(state);
        } catch {
          budget.reserve(0); // Exhaustion while resuming is never a miss.
          return;
        }
      })
    : undefined;
  return (
    suffix ?? {
      base: undefined,
      batches:
        navigation.entityBatches(taskId, snapshot, budget) ??
        navigation.scanSnapshot(snapshot, budget),
    }
  );
}
