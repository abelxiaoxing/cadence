import { randomUUID } from "node:crypto";
import {
  admitFixtureRun,
  historyFixture,
  prepareFixtureChild,
} from "./history-fixture.ts";

const directory = process.argv[2],
  boundary = process.argv[3];
const f = historyFixture(
  {
    observeWrite: (at) => {
      if (at === boundary) process.exit(77);
    },
  },
  directory,
);
const admitted = await f.writer.commit(f.intent);
if (admitted.status !== "committed") process.exit(78);
if (
  boundary === "auth" ||
  boundary === "launch" ||
  boundary === "run-admission"
)
  await admitFixtureRun(f);
if (boundary === "auth")
  await f.writer.auth.preparation({
    operationId: randomUUID(),
    epoch: f.link.epoch,
    runId: f.link.runId,
    childRunId: f.link.childRunId,
    sourceSelectionId: f.context.model.sourceSelectionId,
    validityMs: 1000,
  });
if (boundary === "launch") {
  await prepareFixtureChild(f);
  await f.writer.processes.launchIntent(f.link, f.intent.operationId);
}
if (boundary === "checkpoint") await f.writer.checkpoint();
process.exit(77);
