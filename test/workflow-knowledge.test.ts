/** The delivery's knowledge step: one curating assignment per delivery, a store
 * that must pass its checks, and what each worker is given to read first.
 * Control flow over real files; no Git, service or provider. */
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
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
  expect(worker.named.extra).toHaveLength(1);
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
