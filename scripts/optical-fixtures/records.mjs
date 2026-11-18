// Pure synthetic public projections. No worker/owner, filesystem browsing,
// model API, mutation, approval or simulated completion derived from a click.
import { createHash, randomUUID } from "node:crypto";
import { newDesign, reviseDesign } from "../../src/service/contracts/design.ts";
import { designQuestionsFixture } from "../../test/helpers/design-questions.ts";
import { PNG } from "../../test/helpers/images.ts";
import { plan } from "../../test/helpers/workflow-plan.ts";
export const project = "b".repeat(64),
  cwd = "/optical/specimen",
  epoch = randomUUID(),
  storeId = randomUUID(),
  workspaceId = randomUUID(),
  task = randomUUID(),
  csrf = randomUUID();
const runId = randomUUID(),
  leaf = "00000001";
const version = {
  epoch,
  accessGeneration: 1,
  configRev: 1,
  catalogId: randomUUID(),
};
const proposal = {
  id: randomUUID(),
  epoch,
  digest: "a".repeat(64),
  observation: "c".repeat(64),
  cwd,
  checkoutRoot: cwd,
  model: version,
  plan: plan(),
};
const design = reviseDesign(
  newDesign(randomUUID(), { questions: designQuestionsFixture }),
  [{ question: "surface", option: "frames" }],
  false,
);
const run = {
  id: runId,
  epoch,
  goal: "Fixture · mineral study",
  status: "running",
  phase: "implementing",
  steps: [],
  notice: "",
  mergedCommit: null,
  humanReviewed: false,
  tasks: ["completed", "running", "queued", "failed"].map((state, i) => ({
    id: `t${i}`,
    title: `Panel ${i + 1}`,
    state,
    after: [],
  })),
};
const uncertain = {
  ...run,
  id: randomUUID(),
  status: "unknown",
  phase: "verifying",
  tasks: [],
  steps: [
    {
      id: "verify-material",
      kind: "check",
      status: "unknown",
      text: "No retained exit status",
      exitCode: null,
      truncated: false,
    },
  ],
};
const revalidated = randomUUID();
export const firstAttempt = {
  commandId: randomUUID(),
  status: "failed",
  text: "First specimen before Pi persistence.",
  notice: "Message not saved.",
};
export const writeContent = Array.from(
  { length: 407 },
  (_, i) => `facet ${i + 1}\n`,
).join("");
const mutation = {
  edit: {
    path: "material.ts",
    oldText: "const tone = silver;",
    newText: "const tone = opal;",
  },
  write: { path: "requested.txt", content: writeContent },
};
export const catalog = {
  status: "complete",
  withheld: 0,
  remembered: null,
  entries: [
    {
      model: "optical",
      provider: "fixture",
      api: "openai-completions",
      thinking: [{ level: "off", selectable: true }],
      eligibility: "candidate",
    },
  ],
};
export const controlContext = (taskId = null) => ({
  status: "unavailable",
  workspaceId,
  taskId,
  error: { code: "unavailable", effect: "none", recovery: "operator" },
});
const summary = (id) => ({
  id,
  title: `Optical · ${id}`,
  leaf,
  status: id === "stream" ? "running" : "completed",
  origin: "webui",
  updatedAt: 1,
});
export const feed = { increment: 0 };
const long = Array.from(
  { length: 14 },
  (_, i) =>
    `### Study ${i + 1}\n\nLocal observation. Glass remains outside the reading column. 材质照明不应打断阅读。`,
).join("\n\n");
const code = '```ts\nconst crystal = "' + "0123456789".repeat(32) + '";\n```';
const steps = (id) =>
  [
    ["user", "Inspect the specimen."],
    ["assistant", `${long}\n\n${code}`],
    ["tool", ""],
    [
      "assistant",
      `Specimen notes.\n\n${Array.from({ length: id === "stream" ? feed.increment : 1 }, (_, i) => `Sample ${i + 1}.`).join("\n\n")}`,
    ],
  ].map(([role, text], i) => ({
    id: `step-${i}`,
    ...(id === "reading" && i === 0
      ? { images: [{ entry: leaf, index: 0, mimeType: "image/png" }] }
      : {}),
    role,
    text,
    name: role === "tool" ? (Object.hasOwn(mutation, id) ? id : "read") : "",
    target: role === "tool" ? (mutation[id]?.path ?? "material.ts") : "",
    clipped: false,
    error: false,
    parts: role === "tool" ? 1 : 0,
    state: i === 3 && id === "stream" ? "streaming" : "completed",
  }));
export function readRecord(q) {
  const { kind, id } = q;
  const noSession = id === "empty" || id === "attempt";
  const planned = id === "design" || id === "confirm";
  const runs =
    id === "design" ? [runId] : id === "confirm" ? [uncertain.id] : [];
  switch (kind) {
    case "conversation-image":
      return { kind, mimeType: "image/png", data: PNG, next: null };
    case "conversation-context":
      return {
        kind,
        context: { id: q.location.id, cwd, revision: 1, model: null },
      };
    case "reload-conversation-models":
    case "conversation-models":
      return {
        kind: "conversation-models",
        catalog: {
          ...catalog,
          version: { ...version, conversation: q.location },
          selected: null,
        },
      };
    case "conversations":
      return {
        kind,
        entries: ["reading", "design", "stream"].map(summary),
        next: null,
      };
    case "conversation-active":
      return { kind, entries: [] };
    case "conversation":
      return {
        kind,
        summary: noSession ? null : summary(id),
        leaf: noSession ? null : leaf,
        continues: true,
        turns: noSession ? 0 : 1,
        branches: noSession ? 0 : 1,
        runs,
        attempt: id === "attempt" ? firstAttempt : null,
      };
    case "conversation-turn":
      return {
        kind,
        conversationId: id,
        leaf: q.leaf,
        ordinal: q.ordinal,
        turn: {
          id: leaf,
          entry: leaf,
          at: 1,
          status: summary(id).status,
          notice: "",
          omitted: { thinking: false, media: false, other: false },
          steps: 4,
          stable: id === "stream" ? 3 : 4,
        },
        start: 0,
        steps: steps(id),
      };
    case "conversation-step":
      return {
        kind,
        conversationId: id,
        leaf: q.leaf,
        turnId: q.turnId,
        step: q.step,
        part: q.part,
        item: {
          id: "step-2",
          role: "tool",
          name: mutation[id] ? id : "read",
          text: "Actual fixture output.\n".repeat(32),
          args: JSON.stringify(mutation[id] ?? { path: "material.ts" }),
          error: false,
        },
      };
    case "cadence-conversation":
      return {
        kind,
        state: {
          id,
          enabled: planned,
          revision: 2,
          head: null,
          proposal: planned
            ? {
                ...proposal,
                model: { ...version, conversation: { id, cwd } },
                ...(id === "confirm" ? { revalidatedFrom: revalidated } : {}),
              }
            : null,
          ...(id === "design" ? { design } : {}),
          runs,
        },
      };
    case "conversation-tree":
      return { kind, conversationId: id, nodes: [], truncated: false };
    case "workflow-active":
      return { kind, runs: [] };
    case "workflow-history":
      return { kind, entries: [{ id: runId, run }], next: null };
    case "workflow":
      return {
        kind,
        commandId: null,
        response: { type: "run", run: id === uncertain.id ? uncertain : run },
      };
    case "files":
    case "directories":
      return {
        kind,
        path: q.path,
        parent: null,
        limited: false,
        entries: [
          { name: "facets", path: "facets", directory: true },
          ...(kind === "files"
            ? [{ name: "material.ts", path: "material.ts", directory: false }]
            : []),
        ],
      };
    case "file":
      return {
        kind,
        path: q.path,
        text: 'export const material = "alabaster";',
        limited: false,
      };
    default:
      return null;
  }
}
const child = randomUUID();
const callId = randomUUID();
const start = (name, callId) => ({
  kind: "tool-start",
  callId,
  declaration: null,
  source: { disposition: "unavailable", value: null },
  name,
  argsDetailId: null,
});
export const events = [
  start("read", callId),
  {
    kind: "tool-update",
    callId,
    semantics: "snapshot",
    detailId: randomUUID(),
  },
  {
    kind: "tool-end",
    callId,
    declaration: null,
    source: { disposition: "unavailable", value: null },
    name: "read",
    association: "execution-only",
    startObserved: true,
    isError: false,
    resultDetailId: randomUUID(),
  },
  start("write", randomUUID()),
].map((event, i) => ({
  kind: "capture-fact",
  recordId: randomUUID(),
  committedSeq: String(i + 1),
  link: { epoch, taskId: task, runId, childRunId: child },
  capture: {
    source: {
      first: i + 1,
      last: i + 1,
      firstObservedMs: i + 1,
      lastObservedMs: i + 1,
    },
    event,
  },
}));

export const diffText =
  "--- a/material.ts\n+++ b/material.ts\n@@ -1 +1 @@\n-const material = 'glass';\n+const material = 'alabaster';\n";
export const artifact = {
  recordId: randomUUID(),
  version: 1,
  field: "changes",
  bytes: Buffer.byteLength(diffText),
  sha256: createHash("sha256").update(diffText).digest("hex"),
};
export const change = {
  kind: "owner-fact",
  observedMs: 3,
  recordId: randomUUID(),
  committedSeq: String(events.length + 1),
  link: { epoch, operationId: randomUUID(), taskId: task, runId },
  fact: {
    kind: "changes",
    observationId: randomUUID(),
    stage: "after",
    observation: {
      identity: artifact.sha256,
      checkoutGeneration: 1,
      complete: true,
    },
    content: artifact,
  },
};
