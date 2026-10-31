import { randomUUID } from "node:crypto";
import fs, { appendFileSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { legacyTaskStore } from "../../src/task-store.ts";
import { admitFixtureRun, historyFixture } from "./history-fixture.ts";

const directory = process.argv[2],
  boundary = process.argv[3];
if (boundary === "rename-before" || boundary === "rename-after") {
  const original = fs.renameSync;
  fs.renameSync = (from, to) => {
    if (String(to).endsWith("task.json")) {
      if (boundary === "rename-before") process.exit(77);
      original(from, to);
      process.exit(77);
    }
    return original(from, to);
  };
  syncBuiltinESMExports();
}
let armed = false;
const f = historyFixture(
  {
    observeWrite: (at) => {
      if (armed && at === boundary.replace("outcome-", "")) process.exit(77);
    },
  },
  directory,
);
f.context.task = null;
f.writer.supplyContext(f.context);
f.intent.runId = null;
f.intent.createdTaskId = f.link.taskId;
f.intent.identity = {
  kind: "action",
  expected: f.context,
  action: {
    kind: "create",
    taskKind: "research",
    goal: "Crash publication fixture",
  },
};
writeFileSync(
  join(directory, "selection.json"),
  JSON.stringify({
    commandId: f.intent.commandId,
    operationId: f.intent.operationId,
    taskId: f.link.taskId,
  }),
);
await f.writer.commit(f.intent);
if (
  boundary.startsWith("rename") ||
  boundary.startsWith("publication") ||
  boundary === "outcome-journal" ||
  boundary === "outcome-commit"
) {
  let saves = 0;
  // Native save is not replaced. The original post-save observer arms the real outcome write crash.
  const original = legacyTaskStore(f.c).save.bind(legacyTaskStore(f.c));
  legacyTaskStore(f.c).save = (...args) => {
    const result = original(...args);
    saves++;
    if (boundary.startsWith("outcome")) armed = true;
    return result;
  };
  armed = boundary.startsWith("publication");
  await f.writer.publishTask({
    operationId: f.intent.operationId,
    cwd: f.root,
  });
  if (!saves) process.exit(78);
}
if (boundary === "large-tail") {
  // Structural retained ledger load through real append/fsync; not accepted SDK work.
  let state = f.files.inspect();
  for (let batch = 0; batch < 30; batch++)
    state = await f.files.append(
      f.lease,
      state,
      Array.from({ length: 20 }, (_, i) => {
        const commandId = randomUUID(),
          operationId = randomUUID(),
          taskId = randomUUID();
        const identity = {
          kind: "action" as const,
          expected: f.context,
          action: {
            kind: "create" as const,
            taskKind: "research" as const,
            goal: "z".repeat(7900),
          },
        };
        return {
          kind: "record" as const,
          id: randomUUID(),
          seq: String(BigInt(state.committedSeq) + BigInt(i) + 1n),
          value: {
            kind: "admission" as const,
            intent: {
              commandId,
              operationId,
              runId: null,
              createdTaskId: taskId,
              identity,
            },
            record: {
              identity,
              receipt: {
                commandId,
                operationId,
                runId: null,
                admission: "accepted" as const,
                committedSeq: String(BigInt(state.committedSeq) + 20n),
                execution: null,
                settlement: null,
                created: {
                  kind: "task" as const,
                  taskId,
                  state: "reserved" as const,
                },
                publication: "pending" as const,
              },
            },
          },
        };
      }),
    );
  appendFileSync(f.files.segmentPath(state.segment), '{"torn":');
}
if (boundary === "tail") appendFileSync(f.files.segmentPath(1), '{"torn":');
if (boundary === "auth" || boundary === "launch") {
  const task = legacyTaskStore(f.c).save(
    {
      schema: "cadence-workflow-assistant/1",
      id: f.link.taskId,
      revision: 1,
      kind: "research",
      goal: "Auth",
      plan: "",
      cwd: f.root,
      phase: "planning",
      result: "",
      baseline: "",
      checks: [],
      activity: [],
    },
    0,
    f.lease.checkout,
  );
  const snapshot = legacyTaskStore(f.c).loadSnapshot(task.id);
  if (!snapshot) throw Error("fixture task absent");
  const context = {
    ...f.context,
    controlRev: 2,
    task: {
      id: task.id,
      kind: task.kind,
      revision: 1,
      identity: snapshot.identity,
      graphRevision: null,
      graphIdentity: null,
    },
  };
  f.context = context;
  f.writer.supplyContext(context);
  f.intent = {
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: f.link.runId,
    createdTaskId: null,
    identity: {
      kind: "action",
      expected: context,
      action: { kind: "generate-plan", taskId: task.id },
    },
  };
  await f.writer.commit(f.intent);
  await admitFixtureRun(f);
  const authOperation = randomUUID();
  await f.writer.auth.preparation({
    operationId: authOperation,
    epoch: f.link.epoch,
    runId: f.link.runId,
    childRunId: f.link.childRunId,
    sourceSelectionId: context.model.sourceSelectionId,
    validityMs: 1000,
  });
  if (boundary === "launch") {
    await f.writer.auth.settlement({
      operationId: authOperation,
      outcome: "resolved",
      admissionClosed: false,
    });
    await f.writer.processes.launchIntent(f.link, f.intent.operationId);
  }
}
process.exit(77);
