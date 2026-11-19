// Pure synthetic public projections. No worker/owner, filesystem browsing,
// model API, mutation, approval or simulated completion derived from a click.
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { newDesign, reviseDesign } from "../../src/service/contracts/design.ts";
import { designQuestionsFixture } from "../../test/helpers/design-questions.ts";
import { PNG } from "../../test/helpers/images.ts";
import { plan } from "../../test/helpers/workflow-plan.ts";
export const project = "b".repeat(64),
  cwd = "/optical/specimen",
  recentFolder = `${cwd}/facets`,
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
  plan: {
    ...plan(),
    decisions:
      "Consult the [plan notes](#plan-notes) before implementation. No remote push or installation.",
  },
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
// Only this conversation publishes a retained child to the navigation dock.
export const dockResult = "  Facet samples:\n\tsilver  \n\n  quartz\n";
export const dockRun = {
  ...run,
  id: randomUUID(),
  goal: "Inspect the facet",
  phase: "finished",
  status: "completed",
  tasks: [],
  steps: [
    {
      id: "facet",
      childRunId: randomUUID(),
      kind: "research",
      status: "completed",
      text: "Recorded facet inspection.",
      exitCode: 0,
      truncated: false,
    },
  ],
};
export const fileText = {
  "material.ts": 'export const material = "alabaster";',
  "optics.ts": 'export const optic = "prism";',
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
export const shellCommand = `  specimen "${"silver-quartz-".repeat(35)}"\n\tsecond fixture line  \n`;
const tools = {
  bash: { command: shellCommand },
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
    {
      model: "quartz",
      provider: "fixture",
      api: "openai-completions",
      thinking: [{ level: "off", selectable: false }],
      eligibility: "auth-unavailable",
    },
    {
      model: "slate",
      provider: "fixture",
      api: null,
      thinking: [],
      eligibility: "unsupported",
    },
  ],
};
// Only this live conversation has an installed model and multiple offered levels.
export const lockedReply = "locked-levels";
const lockedModel = {
  provider: "fixture",
  model: "optical",
  api: "openai-completions",
  thinking: "medium",
};
const lockedCatalog = {
  ...catalog,
  selected: { ...lockedModel, sourceSelectionId: randomUUID() },
  entries: [
    {
      ...catalog.entries[0],
      thinking: ["low", "medium", "high"].map((level) => ({
        level,
        selectable: true,
      })),
    },
  ],
};
export const controlContext = (taskId = null) => ({
  status: "unavailable",
  workspaceId,
  taskId,
  error: { code: "unavailable", effect: "none", recovery: "operator" },
});
// Separate settled branch so the fixed tool, scroll and timing specimens do
// not change shape. The turn and tree projections name the same user entries.
const questions = [
  {
    id: "00000011",
    entry: "00000012",
    text: "Which material is shown?",
    reply: "The panel is alabaster.\n\nIncomplete formula: $\\frac$.",
  },
  {
    id: "00000013",
    entry: "00000014",
    text: "Where are its notes?",
    reply:
      "Read the [specimen notes](#specimen-notes) for the surface description.",
  },
];
const liveReply = { epoch, commandId: randomUUID() };
// Change only the dedicated composer specimen, never a timing/scroll input.
export const flowCase = {
  phase: "thinking",
  failTurn: false,
  sequence: 0,
  startedAt: 0,
};
const isRunning = (id) =>
  id === "stream" ||
  id === "live-input" ||
  id === lockedReply ||
  (id === "optical-flow" && flowCase.phase !== "settled");
const lockedLive = { epoch, commandId: randomUUID() };
const summary = (id) => ({
  id,
  title: `Optical · ${id}`,
  leaf: id === "questions" ? questions.at(-1).entry : leaf,
  status: isRunning(id) ? "running" : "completed",
  ...(id === "live-input"
    ? { live: liveReply }
    : id === lockedReply
      ? { live: lockedLive }
      : {}),
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
const steps = (id, question) =>
  (question
    ? [
        ["user", question.text],
        ["assistant", question.reply],
      ]
    : [
        ["user", "Inspect the specimen."],
        ["assistant", `${long}\n\n${code}`],
        ["tool", ""],
        [
          "assistant",
          `Specimen notes.\n\n${Array.from({ length: id === "stream" ? feed.increment : id === "expand" ? 5 : 1 }, (_, i) => `Sample ${i + 1}.`).join("\n\n")}`,
        ],
      ]
  ).map(([role, text], i) => ({
    id: question ? (i === 0 ? question.id : question.entry) : `step-${i}`,
    ...(id === "reading" && i === 0
      ? { images: [{ entry: leaf, index: 0, mimeType: "image/png" }] }
      : {}),
    role,
    text,
    name: role === "tool" ? (Object.hasOwn(tools, id) ? id : "read") : "",
    target:
      role === "tool"
        ? id === "bash"
          ? "specimen summary"
          : (tools[id]?.path ?? "material.ts")
        : "",
    clipped: false,
    error: false,
    parts: role === "tool" ? 1 : 0,
    state: i === 3 && isRunning(id) ? "streaming" : "completed",
  }));
export function readRecord(q) {
  const { kind, id } = q;
  const noSession = id === "empty" || id === "attempt";
  const planned = id === "design" || id === "confirm";
  const runs =
    id === "dock"
      ? [dockRun.id]
      : id === "design"
        ? [runId]
        : id === "confirm"
          ? [uncertain.id]
          : [];
  switch (kind) {
    case "conversation-image":
      return { kind, mimeType: "image/png", data: PNG, next: null };
    case "conversation-context":
      return {
        kind,
        context: {
          id: q.location.id,
          cwd,
          revision: 1,
          model: q.location.id === lockedReply ? lockedModel : null,
        },
      };
    case "reload-conversation-models":
    case "conversation-models":
      return {
        kind: "conversation-models",
        catalog: {
          ...(q.location.id === lockedReply
            ? lockedCatalog
            : { ...catalog, selected: null }),
          version: { ...version, conversation: q.location },
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
        leaf: noSession ? null : summary(id).leaf,
        continues: true,
        turns: noSession ? 0 : id === "questions" ? questions.length : 1,
        branches: noSession ? 0 : 1,
        runs,
        attempt: id === "attempt" ? firstAttempt : null,
      };
    case "conversation-turn": {
      const question = id === "questions" ? questions[q.ordinal] : null;
      const flow = id === "optical-flow";
      const items = steps(
        id,
        flow
          ? {
              id: leaf,
              entry: "00000002",
              text: "Read the sample.",
              reply: "Retained optical specimen.",
            }
          : question,
      );
      return {
        kind,
        conversationId: id,
        leaf: q.leaf,
        ordinal: q.ordinal,
        turn: {
          id: question?.id ?? leaf,
          entry: question?.entry ?? leaf,
          ...(question
            ? { parent: questions[q.ordinal - 1]?.entry ?? null }
            : {}),
          at: flow ? flowCase.startedAt : q.ordinal + 1,
          status: summary(id).status,
          ...(flow && isRunning(id)
            ? {
                activity: { kind: flowCase.phase, sequence: flowCase.sequence },
              }
            : {}),
          notice: flow ? `Observation: ${flowCase.phase}` : "",
          omitted: { thinking: false, media: false, other: false },
          steps: items.length,
          stable: isRunning(id) ? items.length - 1 : items.length,
        },
        start: 0,
        steps: items,
      };
    }
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
          name: Object.hasOwn(tools, id) ? id : "read",
          text: "Actual fixture output.\n".repeat(32),
          args: JSON.stringify(tools[id] ?? { path: "material.ts" }),
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
      return {
        kind,
        conversationId: id,
        nodes:
          id !== "questions"
            ? []
            : questions.map((question, i) => ({
                id: question.id,
                parent: questions[i - 1]?.id ?? null,
                text: question.text,
                at: i + 1,
                leaf: summary(id).leaf,
                current: true,
              })),
        truncated: false,
      };
    case "workflow-active":
      return { kind, runs: [] };
    case "workflow-history":
      return { kind, entries: [{ id: runId, run }], next: null };
    case "workflow-detail":
      return id === dockRun.id && q.stepId === dockRun.steps[0].id
        ? { kind: "file", path: "facet.txt", text: dockResult, limited: false }
        : null;
    case "workflow-transcript":
      return id === dockRun.id && q.stepId === dockRun.steps[0].id
        ? { kind, runId: id, stepId: q.stepId, turn: null }
        : null;
    case "workflow":
      return {
        kind,
        commandId: null,
        response: {
          type: "run",
          run:
            id === dockRun.id ? dockRun : id === uncertain.id ? uncertain : run,
        },
      };
    case "directories": {
      const path = q.path === "~" ? cwd : q.path;
      const children = new Map([
        ["/optical", ["specimen"]],
        [cwd, ["facets"]],
        [`${cwd}/facets`, ["quartz"]],
        [`${cwd}/facets/quartz`, []],
      ]).get(path);
      if (!children) return null;
      return {
        kind,
        path,
        parent:
          path === "/optical" ? null : path.slice(0, path.lastIndexOf("/")),
        limited: false,
        entries: children.map((name) => ({
          name,
          path: `${path}/${name}`,
          directory: true,
        })),
      };
    }
    case "files":
      return {
        kind,
        path: q.path,
        parent: null,
        limited: false,
        entries: [
          { name: "facets", path: "facets", directory: true },
          { name: "material.ts", path: "material.ts", directory: false },
          ...(q.location?.id === "design"
            ? [{ name: "optics.ts", path: "optics.ts", directory: false }]
            : []),
        ],
      };
    case "file":
      if (!Object.hasOwn(fileText, q.path)) return null;
      return {
        kind,
        path: q.path,
        text: fileText[q.path],
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

const artifactStart = [
  "--- a/material.ts\n+++ b/material.ts\n@@ -1 +1 @@\n-const material = 'glass';\n+const material = 'alabaster';\n\nRead the [artifact notes](#artifact-notes) for context.\n",
  "# Mineral study\n\n## Captured page only\n\n![quartz](#omitted) [facet 7](relative)\n",
].join("\n");
const artifactContinuation = "+Captured page only on the next field page.\n";
export const fullArtifact = artifactStart + artifactContinuation;
export const artifact = {
  recordId: randomUUID(),
  version: 1,
  field: "changes",
  bytes: Buffer.byteLength(fullArtifact),
  sha256: createHash("sha256").update(fullArtifact).digest("hex"),
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

export function artifactPage(cursor) {
  const seed = {
    storeId,
    scope: { kind: "task", id: task },
    snapshotSeq: change.committedSeq,
    query: null,
    recordId: artifact.recordId,
    recordVersion: artifact.version,
    field: artifact.field,
    offset: cursor.offset,
  };
  if (!isDeepStrictEqual(seed, cursor)) return null;
  const split = Buffer.byteLength(artifactStart);
  if (cursor.offset !== 0 && cursor.offset !== split) return null;
  return {
    cursor,
    content: artifact,
    text: cursor.offset ? artifactContinuation : artifactStart,
    range: {
      start: cursor.offset,
      end: cursor.offset ? artifact.bytes : split,
    },
    next: cursor.offset ? null : { ...cursor, offset: split },
    coverage,
  };
}

// One retained message with immutable field pages. The code hit needs both
// outer vertical and inner horizontal scrolling; the other disclosure is not
// part of the search target.
export const fieldTask = randomUUID();
const pages = [
  [
    "FacetSpot overview of the mineral study.",
    "```\nOther folded specimen.\n```",
    ...Array.from({ length: 36 }, (_, i) => `Recorded layer ${i + 1}.`),
    "```text\n" + "0123456789".repeat(45) + " FacetSpotZircon\n```",
    "FacetSpot appendix.",
    "",
  ].join("\n\n"),
  "Second retained page.",
  "\n\nCode and 代码 in prose.\n\n```\nCode and 代码 in the recorded block.\nAnother line.\n```\n\n" +
    "1 ".repeat(999) +
    "\n\nFinal 1.",
];
const finalText = {
  recordId: randomUUID(),
  version: 1,
  field: "final-text",
  bytes: Buffer.byteLength(pages.join("")),
  sha256: createHash("sha256").update(pages.join("")).digest("hex"),
};
export const historyMessage = {
  kind: "message",
  owner: {
    taskId: fieldTask,
    runId: randomUUID(),
    childRunId: randomUUID(),
    entity: { kind: "message", id: randomUUID(), version: 1 },
  },
  version: 1,
  role: "assistant",
  source: { disposition: "unavailable", value: null },
  resultCallId: null,
  state: "final",
  finalBlockCount: 1,
  finalText,
};
const scope = { kind: "task", id: fieldTask };
const fieldCursor = {
  storeId,
  scope,
  snapshotSeq: change.committedSeq,
  query: null,
  recordId: finalText.recordId,
  recordVersion: 1,
  field: finalText.field,
  offset: 0,
};
const route = (cursor) =>
  `/app?project=${project}#` +
  new URLSearchParams({ task: fieldTask, detail: JSON.stringify(cursor) });
export const fieldRoute = route(fieldCursor);
const starts = pages.map((_, i) =>
  Buffer.byteLength(pages.slice(0, i).join("")),
);
export const literalRoute = route({ ...fieldCursor, offset: starts[2] });
const coverage = {
  observed: "complete",
  source: "complete",
  redacted: false,
  omissions: [],
};
// Every global hit has a real location in the same immutable field. Accept
// only these exact initial and continuation cursors, not arbitrary searches.
export function searchSpecimen(query) {
  if (!["Recorded", "Recorded layer"].includes(query)) return [];
  return [...pages[0].matchAll(/Recorded layer \d+\./g)].map((match) => {
    const start = Buffer.byteLength(pages[0].slice(0, match.index));
    return {
      owner: historyMessage.owner,
      content: finalText,
      range: { start, end: start + Buffer.byteLength(query) },
      preview: match[0],
      cursor: { ...fieldCursor, query, offset: start },
    };
  });
}
export function searchPage(cursor) {
  const hits = searchSpecimen(cursor?.query);
  if (!hits.length) return null;
  const seed = {
    ...fieldCursor,
    query: cursor.query,
    recordId: null,
    recordVersion: null,
    field: null,
  };
  const next = hits[24].cursor;
  if (isDeepStrictEqual(cursor, seed))
    return { cursor, hits: hits.slice(0, 24), next, coverage };
  if (isDeepStrictEqual(cursor, next))
    return { cursor, hits: hits.slice(24), next: null, coverage };
  return null;
}
export function fieldPage(cursor) {
  const matches = searchSpecimen(cursor.query);
  if (cursor.query !== null && !matches.length) return null;
  const hit = matches.find((h) => isDeepStrictEqual(h.cursor, cursor));
  if (
    !hit &&
    !isDeepStrictEqual(cursor, {
      ...fieldCursor,
      query: cursor.query,
      offset: cursor.offset,
    })
  )
    return null;
  const text = hit
    ? Buffer.from(pages[0]).subarray(cursor.offset).toString()
    : pages[starts.indexOf(cursor.offset)];
  if (!text) return null;
  const end = cursor.offset + Buffer.byteLength(text);
  return {
    cursor,
    content: finalText,
    text,
    range: { start: cursor.offset, end },
    next: end < finalText.bytes ? { ...cursor, offset: end } : null,
    coverage,
  };
}
