import { randomUUID } from "node:crypto";
import type { ServiceTransport } from "../../src/service-client.ts";
import {
  type CaptureCoverage,
  type ContentRef,
  type ContextVersion,
  GRAPH_SCHEMA,
  type Graph,
  publicError,
  type ReadCursor,
  type Receipt,
} from "../../src/service-contract.ts";
export const id = () => randomUUID();
export const hash = "a".repeat(64);
export const coverage: CaptureCoverage = {
  observed: "complete",
  source: "complete",
  redacted: false,
  omissions: [],
};
export const content = (
  field: ContentRef["field"] = "final-text",
  bytes = 4,
): ContentRef => ({ recordId: id(), version: 1, field, bytes, sha256: hash });
export function context(): ContextVersion {
  return {
    epoch: id(),
    accessGeneration: 1,
    configRev: 1,
    controlRev: 1,
    workspaceId: id(),
    cwdId: id(),
    model: {
      sourceSelectionId: id(),
      provider: "fabricated",
      model: "selected",
      api: "openai-completions",
      thinking: "off",
    },
    checkEnvGeneration: 1,
    checkoutGeneration: 0,
    observation: { identity: hash, complete: true },
    task: {
      id: id(),
      kind: "code",
      revision: 1,
      identity: hash,
      graphRevision: 1,
      graphIdentity: hash,
    },
  };
}
export function graph(c: ContextVersion): Graph {
  if (!c.task) throw new Error("fixture-task");
  return {
    schema: GRAPH_SCHEMA,
    taskId: c.task.id,
    taskKind: c.task.kind,
    taskRevision: 1,
    revision: 1,
    planRevision: 1,
    plan: content("plan"),
    assignments: [
      {
        id: "inspect",
        purpose: "research",
        instructions: "Exact proposed assignment",
        expectedOutput: "Observed facts",
        role: { role: "design-explorer", sha256: hash },
        model: c.model,
        dependencies: [],
      },
    ],
  };
}
export const cursor = (): ReadCursor => ({
  storeId: id(),
  scope: { kind: "task", id: id() },
  snapshotSeq: "1",
  query: null,
  recordId: null,
  recordVersion: null,
  field: null,
  offset: 0,
});
export const receipt = (): Receipt => ({
  commandId: id(),
  operationId: id(),
  runId: id(),
  admission: "accepted",
  committedSeq: "1",
  execution: null,
  settlement: null,
  created: null,
  publication: "pending",
});
export function transport(
  overrides: Partial<ServiceTransport> = {},
): ServiceTransport {
  const unavailable = async () => ({
    kind: "error",
    error: publicError("unavailable"),
  });
  return {
    checkObligations: unavailable,
    entity: unavailable,
    session: unavailable,
    workspace: unavailable,
    tasks: unavailable,
    runs: unavailable,
    messages: unavailable,
    tools: unavailable,
    contents: unavailable,
    events: unavailable,
    checks: unavailable,
    changes: unavailable,
    reviews: unavailable,
    graph: unavailable,
    preflight: unavailable,
    command: unavailable,
    cancel: unavailable,
    receipt: unavailable,
    snapshot: unavailable,
    detail: unavailable,
    search: unavailable,
    export: async function* () {
      yield* [];
    },
    ...overrides,
  };
}
