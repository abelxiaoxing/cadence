/** Read-only, session-independent context import. Never opens the private store. */
import { opendirSync } from "node:fs";
import path from "node:path";
import { canonicalJson } from "./canonical.ts";
import { observeSafePath } from "./safe-path.ts";
import { readTaskFile } from "./task-files.ts";
import {
  type PortableTask,
  parsePortableTask,
  TASK_LIMITS,
  taskError,
  taskFail,
  taskHash,
  taskId,
} from "./task-records.ts";

export interface ImportedTaskContext {
  record: PortableTask;
  authority: "context-only";
}
export function importTask(root: string, id: string): ImportedTaskContext {
  taskId(id);
  const prefix = `.cadence/tasks/${id}`;
  const bytes = readTaskFile(
    root,
    `${prefix}/task.json`,
    TASK_LIMITS.recordBytes,
  );
  if (bytes === null) taskFail("task-not-found");
  const record = parsePortableTask(bytes);
  if (record.id !== id) taskFail("task-conflict");
  let total = 0;
  for (const a of record.artifacts) {
    const content = readTaskFile(root, `${prefix}/${a.path}`);
    total += content?.byteLength ?? 0;
    if (
      content === null ||
      content.byteLength !== a.bytes ||
      taskHash(content) !== a.sha256 ||
      total > TASK_LIMITS.artifactBytes
    )
      taskFail("task-conflict");
  }
  return { record, authority: "context-only" };
}
function discoverChecked(roots: readonly string[]): ImportedTaskContext[] {
  if (roots.length > 16) taskFail("task-record-invalid");
  const found = new Map<string, ImportedTaskContext>();
  let count = 0;
  for (const root of roots) {
    const observation = observeSafePath(root, ".cadence/tasks");
    if (observation.kind === "absent") continue;
    if (observation.kind !== "directory") taskFail("task-path-unsafe");
    const directory = opendirSync(path.join(root, ".cadence/tasks"));
    try {
      for (;;) {
        const entry = directory.readSync();
        if (!entry) break;
        if (
          ++count > TASK_LIMITS.discovery ||
          !entry.isDirectory() ||
          entry.isSymbolicLink()
        )
          taskFail("task-path-unsafe");
        const imported = importTask(root, taskId(entry.name));
        const old = found.get(imported.record.id);
        if (old && canonicalJson(old.record) !== canonicalJson(imported.record))
          taskFail("task-conflict");
        found.set(imported.record.id, imported);
      }
    } finally {
      directory.closeSync();
    }
  }
  return [...found.values()];
}

export function discoverTasks(roots: readonly string[]): ImportedTaskContext[] {
  try {
    return discoverChecked(roots);
  } catch (error) {
    return taskError(error, "task-io-failed");
  }
}
