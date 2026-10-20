import { savedRecordIdentity } from "../../src/task-store.ts";
import { TASK_SCHEMA, type TaskRecord } from "../../src/task-types.ts";
import type { historyFixture } from "./history-fixture.ts";
/** Real v1 bytes, explicit selected context; never imported execution approval. */
export function selectLegacy(
  f: ReturnType<typeof historyFixture>,
  patch: Partial<TaskRecord> = {},
): TaskRecord {
  const record: TaskRecord = {
    schema: TASK_SCHEMA,
    id: f.link.taskId,
    revision: 1,
    kind: f.context.task?.kind ?? "research",
    goal: "Selected legacy task",
    plan: "Readable plan",
    cwd: f.root,
    phase: "planning",
    result: "",
    baseline: "",
    checks: [],
    activity: [],
    ...patch,
  };
  f.c.store.save(record, 0, f.lease.checkout);
  if (!f.context.task) throw Error("fixture requires selected task");
  f.context.task.identity = savedRecordIdentity(record);
  f.context.task.kind = record.kind;
  f.writer.supplyContext(f.context);
  return record;
}
