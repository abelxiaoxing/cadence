import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { loadAgentDefinitions } from "../src/agent-registry.ts";
import { proposePlanContent } from "../src/history/plans.ts";
import { HistoryReader } from "../src/history/reader.ts";
import type { AdmissionIntent } from "../src/service/ports.ts";
import { canonicalJson, type Graph } from "../src/service-contract.ts";
import { legacyTaskStore } from "../src/task-store.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import { retainedText, storedTree } from "./helpers/history-read-fixture.ts";

/** Real coordination, writer, artifacts and expected-byte publication. Context/model
 * authority is fixture input: this does NOT qualify an accepting ActionOwner. */
async function created(options: Parameters<typeof historyFixture>[0] = {}) {
  const f = historyFixture(options);
  f.context.task = null;
  f.writer.supplyContext(f.context);
  const create: AdmissionIntent = {
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: null,
    createdTaskId: f.link.taskId,
    identity: {
      kind: "action",
      expected: f.context,
      action: {
        kind: "create",
        taskKind: "research",
        goal: "Inspect the isolated fixture",
      },
    },
  };
  expect((await f.writer.commit(create)).status).toBe("committed");
  expect(
    (
      await f.writer.publishTask({
        operationId: create.operationId,
        cwd: f.root,
      })
    ).status,
  ).toBe("published");
  const saved = legacyTaskStore(f.c).loadSnapshot(f.link.taskId)!;
  f.context = {
    ...f.context,
    controlRev: 2,
    task: {
      id: f.link.taskId,
      kind: saved.record.kind,
      revision: saved.record.revision,
      identity: saved.identity,
      graphRevision: null,
      graphIdentity: null,
    },
  };
  f.writer.supplyContext(f.context);
  return f;
}
function proposal(
  f: Awaited<ReturnType<typeof created>>,
  plan: string,
  version = 1,
) {
  const role = loadAgentDefinitions().find(
    (a) => a.role === "design-explorer",
  )!;
  const graph: Graph = {
    schema: "cadence-graph/2",
    taskId: f.link.taskId,
    taskKind: "research",
    taskRevision: f.context.task!.revision + 1,
    revision: (f.context.task!.graphRevision ?? 0) + 1,
    planRevision: version,
    plan: proposePlanContent(plan, version, []),
    assignments: [
      {
        id: "inspect",
        purpose: "research",
        instructions: "Inspect, without editing.",
        expectedOutput: "Report observations.",
        role: { role: "design-explorer", sha256: role.sha256 },
        model: f.context.model,
        dependencies: [],
      },
    ],
  };
  const intent: AdmissionIntent = {
    commandId: randomUUID(),
    operationId: randomUUID(),
    runId: null,
    createdTaskId: null,
    identity: {
      kind: "action",
      expected: f.context,
      action: { kind: "save-plan", taskId: f.link.taskId, plan, graph },
    },
  };
  return { intent, graph, plan };
}
async function save(
  f: Awaited<ReturnType<typeof created>>,
  p: ReturnType<typeof proposal>,
) {
  expect((await f.writer.commit(p.intent)).status).toBe("committed");
  const retained = await f.writer.retainAcceptedPlan(p.intent.operationId, []);
  expect(retained.status).toBe("committed");
  if (retained.status !== "committed") throw Error("No committed plan");
  expect(retained.batch.ownerDetails).toHaveLength(1);
  expect(retained.batch.ownerDetails[0].content).toEqual(p.graph.plan);
  const published = await f.writer.publishTask({
    operationId: p.intent.operationId,
  });
  expect(published.status).toBe("published");
  return published;
}

it.each([
  "",
  'Reviewed UTF-8 中文 🦉\nwith \\"escaped text\\".',
  `${"界".repeat(10922)}ab`,
])(
  "retains the exact accepted plan at a non-v1 content version, without preflight writes (%#)",
  async (plan) => {
    const f = await created(),
      before = storedTree(f.dir);
    const p = proposal(f, plan, 7);
    expect(storedTree(f.dir)).toEqual(before);
    expect(
      HistoryReader.open(f.c)!.publishedPlan(
        f.link.taskId,
        f.writer.committedSeq,
      ),
    ).toBeNull();
    expect(
      (await f.writer.retainAcceptedPlan(p.intent.operationId, [])).status,
    ).toBe("refused");
    expect(storedTree(f.dir)).toEqual(before);
    expect(f.writer.quarantined).toBe(false);
    const publication = await save(f, p);
    const saved = legacyTaskStore(f.c).loadSnapshot(f.link.taskId)!;
    expect(saved.record.plan).toBe(plan);
    expect(saved.record.revision).toBe(2);
    expect(saved.record.phase).toBe("planning");
    expect(saved.record.result).toBe("");
    const snapshot = f.writer.committedSeq,
      disk = storedTree(f.dir);
    const descriptor = HistoryReader.open(f.c)!.publishedPlan(
      f.link.taskId,
      snapshot,
    )!;
    expect(descriptor.graph).toEqual(p.graph);
    expect(descriptor.reference.recordId).toBe(p.intent.operationId);
    expect(descriptor.reference.revision).toBe(p.graph.revision);
    expect(descriptor.publication).toEqual(publication.observed);
    expect(storedTree(f.dir)).toEqual(disk);
    expect(
      [...f.files.scan()].some((b) =>
        b.rows.some((r) =>
          ["launch", "auth-preparation", "settlement"].includes(r.value.kind),
        ),
      ),
    ).toBe(false);
    expect(f.writer.accounting.episodes.count).toBe(0);
  },
);

it("pure proposal refuses sanitizer changes, malformed UTF-8, invalid versions and oversize", () => {
  for (const plan of [
    "private-canary",
    "\u001b[31mcolor",
    "authorization: Bearer fabricated",
    "\ud800",
    "x".repeat(32769),
  ])
    expect(() => proposePlanContent(plan, 1, ["private-canary"])).toThrow();
  for (const version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    expect(() => proposePlanContent("reviewed", version, [])).toThrow();
});

it.each(["hash", "length", "secret", "task", "context", "kind"])(
  "refuses %s mismatch without artifact/publication or invented reference",
  async (fault) => {
    const f = await created(),
      p = proposal(f, "owner-only-canary");
    if (fault === "hash") p.graph.plan.sha256 = "0".repeat(64);
    if (fault === "length") p.graph.plan.bytes++;
    if (fault === "kind") p.graph.taskKind = "diagnosis";
    expect((await f.writer.commit(p.intent)).status).toBe("committed");
    if (fault === "task") {
      const path = join(legacyTaskStore(f.c).tasks, f.link.taskId, "task.json");
      writeFileSync(path, `${readFileSync(path, "utf8")} `);
    }
    if (fault === "context")
      f.writer.supplyContext({
        ...f.writer.currentContext(f.link.taskId)!,
        checkoutGeneration: 1,
      });
    const before = storedTree(f.dir);
    const result = await f.writer.retainAcceptedPlan(
      p.intent.operationId,
      fault === "secret" ? ["owner-only-canary"] : [],
    );
    expect(result.status).toBe("refused");
    expect(storedTree(f.dir)).toEqual(before);
    expect(f.writer.quarantined).toBe(false);
    expect(() =>
      HistoryReader.open(f.c)!.publishedPlan(
        f.link.taskId,
        f.writer.committedSeq,
      ),
    ).toThrow();
  },
);

it("does not expose pending retention/publication or fall back to a previously saved graph", async () => {
  const f = await created(),
    first = proposal(f, "First approved plan");
  await save(f, first);
  const firstSnapshot = f.writer.committedSeq;
  const firstDescriptor = HistoryReader.open(f.c)!.publishedPlan(
    f.link.taskId,
    firstSnapshot,
  )!;
  f.context = {
    ...f.writer.currentContext(f.link.taskId)!,
    task: {
      ...f.context.task!,
      revision: firstDescriptor.publication.revision,
      identity: firstDescriptor.publication.identity,
      graphRevision: first.graph.revision,
      graphIdentity: firstDescriptor.reference.sha256,
    },
  };
  f.writer.supplyContext(f.context);
  const second = proposal(f, "Second approved plan", 2);
  expect((await f.writer.commit(second.intent)).status).toBe("committed");
  const reader = HistoryReader.open(f.c)!;
  expect(() =>
    reader.publishedPlan(f.link.taskId, f.writer.committedSeq),
  ).toThrow();
  expect(reader.publishedPlan(f.link.taskId, firstSnapshot)?.graph).toEqual(
    first.graph,
  );
  expect(
    (await f.writer.retainAcceptedPlan(second.intent.operationId, [])).status,
  ).toBe("committed");
  expect(() =>
    reader.publishedPlan(f.link.taskId, f.writer.committedSeq),
  ).toThrow();
  expect(
    (await f.writer.publishTask({ operationId: second.intent.operationId }))
      .status,
  ).toBe("published");
  expect(
    HistoryReader.open(f.c)!.publishedPlan(f.link.taskId, f.writer.committedSeq)
      ?.graph,
  ).toEqual(second.graph);
});

it("duplicate retention and a different accepted operation cannot reuse a content identity", async () => {
  const f = await created(),
    first = proposal(f, "same approved bytes");
  expect((await f.writer.commit(first.intent)).status).toBe("committed");
  const results = await Promise.all([
    f.writer.retainAcceptedPlan(first.intent.operationId, []),
    f.writer.retainAcceptedPlan(first.intent.operationId, []),
  ]);
  expect(results.map((r) => r.status)).toEqual(["committed", "refused"]);
  expect(f.writer.quarantined).toBe(false);
  const before = storedTree(f.dir);
  expect(
    (await f.writer.retainAcceptedPlan(first.intent.operationId, [])).status,
  ).toBe("refused");
  expect(storedTree(f.dir)).toEqual(before);
  f.context = f.writer.currentContext(f.link.taskId)!;
  const second = proposal(f, first.plan);
  second.graph.plan = first.graph.plan;
  expect((await f.writer.commit(second.intent)).status).toBe("committed");
  const accepted = storedTree(f.dir);
  expect(
    (await f.writer.retainAcceptedPlan(second.intent.operationId, [])).status,
  ).toBe("refused");
  expect(storedTree(f.dir)).toEqual(accepted);
});

it("ordinary content remains randomly allocated at version1 and cannot be adopted as accepted-plan membership", async () => {
  const f = await created(),
    original = await retainedText(f, "same text", "plan", 3);
  expect(original.content.version).toBe(1);
  const p = proposal(f, "same text");
  p.graph.plan = original.content;
  expect((await f.writer.commit(p.intent)).status).toBe("committed");
  const before = storedTree(f.dir);
  expect(
    (await f.writer.retainAcceptedPlan(p.intent.operationId, [])).status,
  ).toBe("refused");
  expect(storedTree(f.dir)).toEqual(before);
  // Publication cannot bypass accepted-plan production by adopting unrelated content.
  expect(
    (await f.writer.publishTask({ operationId: p.intent.operationId })).status,
  ).not.toBe("published");
  expect(legacyTaskStore(f.c).loadSnapshot(f.link.taskId)!.record.plan).toBe(
    "",
  );
});

it("publication conflict preserves external bytes and never exposes a current saved graph", async () => {
  const f = await created(),
    p = proposal(f, "Reviewed plan");
  expect((await f.writer.commit(p.intent)).status).toBe("committed");
  expect(
    (await f.writer.retainAcceptedPlan(p.intent.operationId, [])).status,
  ).toBe("committed");
  const path = join(legacyTaskStore(f.c).tasks, f.link.taskId, "task.json");
  const external = `${readFileSync(path, "utf8")} \n`;
  writeFileSync(path, external);
  expect(
    (await f.writer.publishTask({ operationId: p.intent.operationId })).status,
  ).not.toBe("published");
  expect(readFileSync(path, "utf8")).toBe(external);
  expect(() =>
    HistoryReader.open(f.c)!.publishedPlan(
      f.link.taskId,
      f.writer.committedSeq,
    ),
  ).toThrow();
});

it("reopened lookup revalidates exact retained artifact bytes, not an in-memory graph", async () => {
  const f = await created(),
    p = proposal(f, "Retained plan bytes");
  await save(f, p);
  // Find the original artifact path using the writer's actual descriptor, not a guessed file naming rule.
  const event = [...f.files.scan()]
    .flatMap((b) => b.rows)
    .flatMap((r) => (r.value.kind === "owner" ? r.value.events : []))
    .find((e) => e.kind === "chunk");
  if (event?.kind !== "chunk") throw Error("Missing actual artifact");
  const actual = f.files.artifactPath(event.artifact);
  writeFileSync(actual, "x".repeat(event.artifact.bytes));
  expect(() =>
    HistoryReader.open(f.c)!.publishedPlan(
      f.link.taskId,
      f.writer.committedSeq,
    ),
  ).toThrow();
  expect(canonicalJson(p.graph)).toContain(p.graph.plan.sha256);
});

it("accepted Create is not authority to retain a caller-supplied plan", async () => {
  const f = await created();
  const first = [...f.files.scan()]
    .flatMap((b) => b.rows)
    .find((r) => r.value.kind === "admission");
  if (first?.value.kind !== "admission")
    throw Error("Missing create acceptance");
  const before = storedTree(f.dir);
  expect(
    (await f.writer.retainAcceptedPlan(first.value.intent.operationId, []))
      .status,
  ).toBe("refused");
  expect(storedTree(f.dir)).toEqual(before);
  expect(f.writer.quarantined).toBe(false);
});

it("retains maximum legal graph and maximum legal plan together without duplicate identity expansion", async () => {
  const f = await created(),
    p = proposal(f, "p".repeat(32768));
  const base = p.graph.assignments[0];
  p.graph.assignments = Array.from({ length: 16 }, (_, i) => ({
    ...base,
    id: `a${i}`,
    instructions: "\\".repeat(15000),
    expectedOutput: "x".repeat(2000),
  }));
  const bytes = () => Buffer.byteLength(canonicalJson(p.graph));
  for (const a of p.graph.assignments)
    a.instructions += "\\".repeat(
      Math.min(
        16384 - a.instructions.length,
        Math.floor((524288 - bytes()) / 2),
      ),
    );
  p.graph.assignments[0].expectedOutput += "x".repeat(524288 - bytes());
  expect(bytes()).toBe(524288);
  await save(f, p);
  expect(
    HistoryReader.open(f.c)!.publishedPlan(f.link.taskId, f.writer.committedSeq)
      ?.graph,
  ).toEqual(p.graph);
});
