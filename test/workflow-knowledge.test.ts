/** The delivery's knowledge step: one curating assignment per delivery, a store
 * that must pass its checks, and what each worker is given to read first.
 * Control flow over real files; no Git, service or provider. */
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { INVESTIGATIONS, questionKey } from "../src/service/investigations.ts";
import { KNOWLEDGE_STORE } from "../src/service/knowledge-store.ts";
import { hash } from "../src/service/private-files.ts";
import { AttemptFailure } from "../src/service/workflow-controller.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

const git = vi.hoisted(() => ({
  ignored: false,
  dirty: false,
  head: "1".repeat(40),
}));
vi.mock("../src/service/workflow-git.ts", async (original) => {
  const real =
    await original<typeof import("../src/service/workflow-git.ts")>();
  return {
    ...real,
    gitHead: async () => git.head,
    gitRun: async (_cwd: string, args: string[]) => ({
      code: args[0] === "check-ignore" ? (git.ignored ? 0 : 1) : 0,
      stdout: "",
    }),
    assertTarget: async () => {
      if (git.dirty) throw new real.WorkflowRefusal("conflict", "dirty");
    },
  };
});
afterEach(() => {
  git.ignored = false;
  git.dirty = false;
  git.head = "1".repeat(40);
});

const TABLE = `# Project knowledge\n\n## Routes\n\n- \`a.txt\` -> \`.cadence/knowledge/outputs.md#Files\` — what the outputs hold\n`;
const TOPIC = `# Outputs\n\n## Files\n\n### Each output names itself\nKind: contract\nWhy: the check reads it back.\nAnchors: \`a.txt\`\n`;
function fixture(curate: (put: (path: string, text: string) => void) => void) {
  const cwd = mkdtempSync(join(tmpdir(), "workflow-knowledge-"));
  const put = (path: string, text: string) => {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  };
  put("a.txt", "implemented a.txt\n");
  const definition = plan();
  const proposal = { plan: definition, model: {} };
  const records = new Map<string, unknown>();
  const prompts: {
    id: string;
    prompt: string;
    paths: string[];
    kind: string;
  }[] = [];
  const live = {
    proposal,
    abort: new AbortController(),
    delivered: new Set<string>(["a.txt"]),
    notes: [] as string[],
    target: { head: "1".repeat(40), branch: "refs/heads/main" } as
      | { head: string; branch: string }
      | undefined,
    managed: undefined as boolean | undefined,
    knowledgeDone: undefined as boolean | undefined,
    owned: undefined as Map<string, string[]> | undefined,
    routed: undefined as Set<string> | undefined,
    lessons: undefined as { from: string; text: string }[] | undefined,
    run: {
      id: randomUUID(),
      status: "running",
      phase: "verifying",
      steps: [] as { id: string }[],
      revision: 0,
      scope: undefined as string[] | undefined,
      deviations: undefined,
      verification: undefined,
    },
  };
  const owner = Object.assign(Object.create(Workflows.prototype), {
    cwd,
    root: join(cwd, ".state"),
    o: {
      owner: { state: "idle", lease: { assert() {} } },
      secrets: () => [],
      coordination: {
        files: {
          read: (p: string) =>
            records.has(p)
              ? { bytes: Buffer.from(JSON.stringify(records.get(p))) }
              : null,
          create: (p: string, body: string) => {
            if (records.has(p)) throw new Error("exists");
            records.set(p, JSON.parse(body));
          },
          replace: (p: string, _expected: unknown, body: string) => {
            records.set(p, JSON.parse(body));
          },
        },
      },
    },
    save() {},
    assertRunning() {},
    evidence: () => "native evidence",
    write: (p: string, v: unknown) => records.set(p, v),
    recoverStage: (
      _l: unknown,
      _c: string,
      _p: unknown,
      _stage: string,
      action: () => Promise<unknown>,
    ) => action(),
    editAttempt: async (
      _l: unknown,
      _c: string,
      _p: unknown,
      id: string,
      prompt: string,
      paths: string[],
      kind: string,
    ) => {
      prompts.push({ id, prompt, paths: [...paths], kind });
      curate((path, text) => {
        put(path, text);
        live.delivered.add(path);
      });
      const step = { id: `${id}-${randomUUID()}` };
      live.run.steps.push(step);
      return step;
    },
  });
  return { owner, live, proposal, records, prompts, cwd, put };
}

it("every delivery of a current agreement curates the store; the first one is asked to create the route table", async () => {
  const f = fixture((put) => {
    put(KNOWLEDGE_STORE.index, TABLE);
    put(`${KNOWLEDGE_STORE.topics}/outputs.md`, TOPIC);
  });
  await f.owner.learn(f.live, f.cwd, f.proposal);
  expect(f.prompts).toHaveLength(1);
  expect(f.prompts[0]).toMatchObject({
    id: "project-knowledge",
    kind: "knowledge",
    // No document was named: the store alone is in scope.
    paths: [".cadence/project.md", ".cadence/knowledge"],
  });
  expect(f.prompts[0].prompt).toContain("There is no route table yet");
  expect(f.prompts[0].prompt).toContain("native evidence");
  expect(f.live.knowledgeDone).toBe(true);
  // From now on the store belongs to what this run commits and reviews.
  expect(f.owner.scope(f.live, f.proposal)).toEqual([
    "a.txt",
    "b.txt",
    ".cadence/project.md",
    ".cadence/knowledge",
  ]);
});

it("a store the curator leaves over budget or with a broken reference fails its own step, so recovery corrects it before anything is verified", async () => {
  const oversized = fixture((put) => {
    put(KNOWLEDGE_STORE.index, TABLE);
    put(
      `${KNOWLEDGE_STORE.topics}/outputs.md`,
      `${TOPIC}\n${"x".repeat(KNOWLEDGE_STORE.topicBytes)}\n`,
    );
  });
  const failed = oversized.owner.learn(
    oversized.live,
    oversized.cwd,
    oversized.proposal,
  );
  await expect(failed).rejects.toBeInstanceOf(AttemptFailure);
  await failed.catch((error: AttemptFailure) => {
    expect(error.steps).toEqual([oversized.live.run.steps[0].id]);
    expect(error.message).toContain("does not pass its checks");
    expect(error.message).toContain("budget");
  });
  expect(oversized.live.knowledgeDone).toBeUndefined();

  const dangling = fixture((put) => {
    put(KNOWLEDGE_STORE.index, TABLE);
    put(
      `${KNOWLEDGE_STORE.topics}/outputs.md`,
      TOPIC.replace("`a.txt`", "`a.txt#noSuchSymbol`"),
    );
  });
  await expect(
    dangling.owner.learn(dangling.live, dangling.cwd, dangling.proposal),
  ).rejects.toThrow("a.txt#noSuchSymbol does not resolve");
});

it("a delivery that cannot carry the store says so and maintains only the documents the agreement named", async () => {
  // Nothing named and the store ignored by Git: no curating step at all.
  git.ignored = true;
  const silent = fixture(() => {});
  await silent.owner.learn(silent.live, silent.cwd, silent.proposal);
  expect(silent.prompts).toEqual([]);
  expect(silent.live.knowledgeDone).toBeUndefined();
  expect(silent.live.notes.join(" ")).toContain(
    "Project knowledge was not maintained in this delivery",
  );
  // The target checkout has its own edits to the store: the named document only.
  git.ignored = false;
  git.dirty = true;
  const named = fixture(() => {});
  named.proposal.plan.documents = ["docs/guide.md"];
  await named.owner.learn(named.live, named.cwd, named.proposal);
  expect(named.prompts[0].paths).toEqual(["docs/guide.md"]);
  expect(named.prompts[0].prompt).toContain("not maintained in this delivery");
  expect(named.owner.scope(named.live, named.proposal)).not.toContain(
    ".cadence/project.md",
  );
  // A direct working-copy delivery has no target to conflict with.
  git.dirty = false;
  git.ignored = true;
  const direct = fixture((put) => put(KNOWLEDGE_STORE.index, TABLE));
  direct.live.target = undefined;
  direct.put(`${KNOWLEDGE_STORE.topics}/outputs.md`, TOPIC);
  await direct.owner.learn(direct.live, direct.cwd, direct.proposal);
  expect(direct.live.managed).toBe(true);
});

it("the curator is given what failed along the way, and each worker what the agreement names for it", async () => {
  const f = fixture((put) => put(KNOWLEDGE_STORE.index, TABLE));
  f.put(KNOWLEDGE_STORE.index, TABLE);
  f.put(`${KNOWLEDGE_STORE.topics}/outputs.md`, TOPIC);
  f.live.run.revision = 1;
  f.records.set(
    join(f.owner.root, "runs", f.live.run.id, "revisions", "1.json"),
    {
      revision: 1,
      stage: "assignment a",
      failure: "the output lacked its trailing newline",
      decision: {
        level: "repair",
        cause: "the writer trimmed the text",
        strategy: "write the text unchanged",
      },
    },
  );
  await f.owner.learn(f.live, f.cwd, f.proposal);
  const prompt = f.prompts[0].prompt;
  expect(prompt).toContain("the output lacked its trailing newline");
  expect(prompt).toContain("write the text unchanged");
  // a.txt was changed by this delivery, so the entry about it is rechecked.
  expect(prompt).toContain('outputs.md "Each output names itself"');
  expect(prompt).not.toContain("There is no route table yet");

  // A recorded investigation the agreement names is resolved from its record.
  const investigation = randomUUID(),
    researchRun = randomUUID(),
    step = `research-1-${randomUUID()}`;
  f.records.set(join(f.owner.root, "investigations", `${investigation}.json`), {
    run: researchRun,
    step,
    question: "Where are outputs written?",
    commit: "2".repeat(40),
    at: 1,
  });
  f.records.set(
    join(f.owner.root, "runs", researchRun, "results", `${hash(step)}.json`),
    { result: { text: "Outputs are written by write.ts." } },
  );
  f.proposal.plan.tasks[0].reads = [
    {
      path: ".cadence/knowledge/outputs.md",
      section: "Files",
      reason: "Contract",
    },
    { research: investigation, reason: "Where to edit" },
    { research: randomUUID(), reason: "Never recorded" },
  ];
  f.proposal.plan.reviewReads = [{ path: "AGENTS.md", reason: "Rules" }];
  const worker = await f.owner.reader(f.live, f.cwd, "a", "implementation");
  expect(worker.writes).toEqual(["a.txt"]);
  expect(worker.named.reads).toHaveLength(3);
  expect(worker.named.extra).toHaveLength(2);
  // Named but never recorded: the worker is told, not left guessing.
  expect(worker.named.extra[1]).toMatchObject({
    reason: "Recorded investigation, named by the agreement: Never recorded",
    body: expect.stringContaining("No investigation is recorded"),
  });
  expect(worker.named.extra[0]).toMatchObject({
    label: `investigation ${investigation}`,
    reason: "Recorded investigation, named by the agreement: Where to edit",
  });
  expect(worker.named.extra[0].body).toContain(
    "Outputs are written by write.ts.",
  );
  expect(worker.named.extra[0].body).toContain("Where are outputs written?");
  // The checkout moved since it was recorded: it says so.
  expect(worker.named.extra[0].body).toContain(
    "the checkout has changed since",
  );
  const review = await f.owner.reader(f.live, f.cwd, "review-x", "review");
  expect(review.named.reads).toEqual([{ path: "AGENTS.md", reason: "Rules" }]);
  expect(review.writes).toContain("b.txt");
  // A repair or a diagnosis gets no assignment list, only routes and discovery.
  expect(
    (await f.owner.reader(f.live, f.cwd, "repair-1", "implementation")).named
      .reads,
  ).toEqual([]);
});

it("the store's usage is counted once per delivery and decides what the curator looks over; what workers proposed reaches it as unverified", async () => {
  const stored = (put: (path: string, text: string) => void) => {
    put(KNOWLEDGE_STORE.index, TABLE);
    put(`${KNOWLEDGE_STORE.topics}/outputs.md`, TOPIC);
  };
  const label = ".cadence/knowledge/outputs.md#Files";
  const f = fixture(stored);
  stored(f.put);
  const use = join(f.owner.root, "knowledge-use.json");
  f.live.routed = new Set([label]);
  f.live.lessons = [
    { from: "a", text: "write.ts must not trim: outputs end with a newline" },
  ];
  await f.owner.learn(f.live, f.cwd, f.proposal);
  expect(f.records.get(use)).toEqual({
    deliveries: 1,
    routes: { [label]: { first: 1, used: 1 } },
    topics: { ".cadence/knowledge/outputs.md": { reviewed: 1 } },
  });
  const prompt = f.prompts[0].prompt;
  expect(prompt).toContain(
    "Also look over .cadence/knowledge/outputs.md, which has gone longest without a check",
  );
  expect(prompt).toContain("unverified proposals");
  expect(prompt).toContain(
    "- (a) write.ts must not trim: outputs end with a newline",
  );
  expect(prompt).not.toContain("No worker of the last");

  // Many deliveries later nothing has been routed there: the curator is told.
  const idle = fixture(stored);
  stored(idle.put);
  idle.records.set(join(idle.owner.root, "knowledge-use.json"), {
    deliveries: 20,
    routes: { [label]: { first: 3, used: 9 } },
    topics: { ".cadence/knowledge/outputs.md": { reviewed: 20 } },
  });
  await idle.owner.learn(idle.live, idle.cwd, idle.proposal);
  expect(idle.prompts[0].prompt).toContain(
    `No worker of the last 8 deliveries was routed to these; keep one only if it still earns its place: ${label}`,
  );
  expect(
    idle.records.get(join(idle.owner.root, "knowledge-use.json")),
  ).toMatchObject({ deliveries: 21, routes: { [label]: { used: 9 } } });

  // A record that cannot be read is left exactly as it is and said to be so.
  const broken = fixture(stored);
  stored(broken.put);
  const damaged = { deliveries: "many" };
  broken.records.set(join(broken.owner.root, "knowledge-use.json"), damaged);
  await broken.owner.learn(broken.live, broken.cwd, broken.proposal);
  expect(
    broken.records.get(join(broken.owner.root, "knowledge-use.json")),
  ).toBe(damaged);
  expect(broken.live.notes.join(" ")).toContain(
    "usage record could not be read or kept",
  );
  expect(broken.prompts[0].prompt).toContain("Also look over");
  expect(broken.live.knowledgeDone).toBe(true);
});

it("a recorded investigation is given only while the files it cites read as they did, and the same question is answered from it without another worker", async () => {
  const f = fixture(() => {});
  const digest = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const id = randomUUID(),
    run = randomUUID(),
    step = `research-1-${randomUUID()}`;
  const record = {
    run,
    step,
    question: "Where are outputs written?",
    commit: "2".repeat(40),
    at: Date.now() - 1000,
    files: [{ path: "a.txt", digest: digest("implemented a.txt\n") }],
  };
  f.records.set(join(f.owner.root, "investigations", `${id}.json`), record);
  f.records.set(
    join(f.owner.root, "runs", run, "results", `${hash(step)}.json`),
    { result: { text: "Outputs are written by write.ts into a.txt." } },
  );
  f.records.set(
    join(
      f.owner.root,
      "investigations",
      "questions",
      `${questionKey(record.question, undefined)}.json`,
    ),
    { id },
  );
  // The checkout moved, but what the answer rests on did not: no caution.
  const current = await f.owner.investigation(id, f.cwd);
  expect(current).toContain("Outputs are written by write.ts");
  expect(current).not.toContain("changed since");
  expect(f.owner.answered(" Where are  outputs written? ", undefined)).toEqual({
    id,
    at: record.at,
    answer: "Outputs are written by write.ts into a.txt.",
  });
  // Another question, or the same one about other directories, is not it.
  expect(f.owner.answered("Where are inputs read?", undefined)).toBeNull();
  expect(f.owner.answered(record.question, ["src"])).toBeNull();
  // Too old to be given again without a look.
  f.records.set(join(f.owner.root, "investigations", `${id}.json`), {
    ...record,
    at: Date.now() - INVESTIGATIONS.reuseMs - 1000,
  });
  expect(f.owner.answered(record.question, undefined)).toBeNull();
  f.records.set(join(f.owner.root, "investigations", `${id}.json`), record);
  // An answer that cites nothing cannot be checked, so it is asked again.
  f.records.set(join(f.owner.root, "investigations", `${id}.json`), {
    ...record,
    files: [],
  });
  expect(f.owner.answered(record.question, undefined)).toBeNull();
  f.records.set(join(f.owner.root, "investigations", `${id}.json`), record);
  // The cited file changed: a worker gets a pointer, not the stale answer.
  f.put("a.txt", "rewritten\n");
  const stale = await f.owner.investigation(id, f.cwd);
  expect(stale).toContain("out of date: a.txt changed since it was made");
  expect(stale).toContain("Where are outputs written?");
  expect(stale).not.toContain("write.ts");
  expect(f.owner.answered(record.question, undefined)).toBeNull();
});

it("lessons a worker proposes in its report are kept for the curator, from blocked attempts too, up to a bound", async () => {
  const f = fixture(() => {});
  const reports = [
    { status: "completed", summary: "done", lessons: ["first", "second"] },
    { status: "blocked", summary: "stuck", lessons: ["a trap"] },
    { status: "completed", summary: "done" },
  ];
  Object.assign(f.owner, {
    attemptResult() {},
    worker: async () => ({
      result: {},
      step: { id: randomUUID(), status: "completed", text: "" },
      report: reports.shift(),
    }),
  });
  await f.owner.implementation(f.live, f.cwd, "a", "Do a", {});
  await expect(
    f.owner.implementation(f.live, f.cwd, "b", "Do b", {}),
  ).rejects.toBeInstanceOf(AttemptFailure);
  await f.owner.implementation(f.live, f.cwd, "c", "Do c", {});
  expect(f.live.lessons).toEqual([
    { from: "a", text: "first" },
    { from: "a", text: "second" },
    { from: "b", text: "a trap" },
  ]);
  reports.push({
    status: "completed",
    summary: "done",
    lessons: Array.from({ length: 5 }, (_, n) => `more ${n}`),
  });
  f.live.lessons = Array.from({ length: 30 }, (_, n) => ({
    from: "x",
    text: `earlier ${n}`,
  }));
  await f.owner.implementation(f.live, f.cwd, "d", "Do d", {});
  expect(f.live.lessons).toHaveLength(32);
});
