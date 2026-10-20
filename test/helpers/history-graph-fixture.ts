import { randomUUID } from "node:crypto";
import { hash } from "../../src/service/private-files.ts";
import {
  canonicalJson,
  type Graph,
  type RunIdentity,
} from "../../src/service-contract.ts";
import { historyFixture } from "./history-fixture.ts";
import { retainedText } from "./history-read-fixture.ts";

/** Real journal/admission writes, fabricated owner allocation; no SDK/launch. */
export async function retainedGraph() {
  const f = historyFixture(),
    { content } = await retainedText(f, "A readable retained plan");
  const graph: Graph = {
    schema: "cadence-graph/2",
    taskId: f.link.taskId,
    taskKind: "research",
    taskRevision: 1,
    revision: 1,
    planRevision: 1,
    plan: content,
    assignments: [
      {
        id: "one",
        purpose: "research",
        instructions: "Inspect only",
        expectedOutput: "Findings",
        role: { role: "design-explorer", sha256: "a".repeat(64) },
        model: f.context.model,
        dependencies: [],
      },
    ],
  };
  const sha256 = hash(canonicalJson(graph));
  if (!f.context.task) throw Error("fixture task absent");
  f.context.task = {
    ...f.context.task,
    graphRevision: 1,
    graphIdentity: sha256,
  };
  f.writer.supplyContext(f.context);
  f.intent.identity = {
    kind: "action",
    expected: f.context,
    action: { kind: "start", taskId: f.link.taskId },
  };
  if ((await f.writer.commit(f.intent)).status !== "committed")
    throw Error("fixture command");
  const identity: RunIdentity = {
    operationId: f.intent.operationId,
    commandId: f.intent.commandId,
    kind: "start",
    context: f.context,
    graph: { recordId: randomUUID(), revision: 1, sha256 },
    assignments: [{ assignmentId: "one", childRunId: f.link.childRunId }],
  };
  if (
    (await f.writer.admitRun(f.link.runId, identity, graph)).status !==
    "committed"
  )
    throw Error("fixture graph");
  return { ...f, graph, identity };
}
