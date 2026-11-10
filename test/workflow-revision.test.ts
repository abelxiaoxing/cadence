/** The owner revises an approved delivery on its own: scope, deviations and
 * the checks they set aside. Control flow only; no Git, service or provider. */
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { AttemptFailure } from "../src/service/workflow-controller.ts";
import { acceptanceRecord } from "../src/service/workflow-delivery.ts";
import { WorkflowRefusal } from "../src/service/workflow-git.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

/** Every file of the controlled tree, so an edit anywhere is observed. */
const tree = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirtyTarget: [] as string[],
}));
vi.mock("../src/service/workflow-git.ts", async (original) => ({
  ...(await original<typeof import("../src/service/workflow-git.ts")>()),
  sourceIdentityAsync: async () => JSON.stringify([...tree.files]),
  workingSnapshot: async () => ({ git: true, paths: new Map(tree.files) }),
  gitHead: async () => "1".repeat(40),
  assertTarget: async (_cwd: string, _target: unknown, paths: string[]) => {
    const { WorkflowRefusal } =
      await original<typeof import("../src/service/workflow-git.ts")>();
    const dirty = paths.filter((p) => tree.dirtyTarget.includes(p));
    if (dirty.length)
      throw new WorkflowRefusal("conflict", `dirty: ${dirty.join(", ")}`);
  },
}));
afterEach(() => {
  tree.files.clear();
  tree.dirtyTarget = [];
});

const settled = {
  outcome: "completed",
  closed: true,
  exitCode: 0,
  output: "fixture",
  text: "",
  durationMs: 1,
  truncated: false,
  signal: null,
};
function fixture() {
  const cwd = mkdtempSync(join(tmpdir(), "workflow-revision-"));
  const definition = plan();
  definition.checks = [
    { name: "unit", command: "unit" },
    { name: "format", command: "format" },
  ];
  const proposal = { plan: definition, model: {}, digest: "d".repeat(64) };
  const live = {
    proposal,
    abort: new AbortController(),
    delivered: new Set<string>(),
    notes: [] as string[],
    target: undefined as { head: string; branch: string } | undefined,
    run: {
      id: randomUUID(),
      epoch: randomUUID(),
      status: "running",
      phase: "implementing",
      steps: [] as { id: string; kind: string; status: string }[],
      notice: "",
      revision: 0,
      scope: undefined as string[] | undefined,
      deviations: undefined as
        | { revision: number; item: string; waives: string[] }[]
        | undefined,
    },
  };
  const records = new Map<string, unknown>();
  /** What the next diagnosis worker replies. */
  const replies: object[] = [];
  const prompts: string[] = [];
  const owner = Object.assign(Object.create(Workflows.prototype), {
    cwd,
    root: join(cwd, "state"),
    o: { owner: { state: "idle" }, secrets: () => [] },
    save() {},
    assertRunning() {},
    evidence: () => "native evidence",
    write: (p: string, v: unknown) => records.set(p, v),
    worker: async (
      _live: unknown,
      _cwd: string,
      name: string,
      prompt: string,
      _readonly: boolean,
      _version: unknown,
      _roots: unknown,
      kind: string,
    ) => {
      prompts.push(prompt);
      const step = owner.step(live, name, kind);
      const reply = replies.shift();
      const result = { ...settled, text: reply ? JSON.stringify(reply) : "" };
      owner.finishStep(live, step, result);
      return { result, step, report: null };
    },
  });
  /** A failed step recovery can cite. */
  const failed = () => {
    const step = owner.step(live, "attempt", "implementation");
    owner.finishStep(live, step, {
      ...settled,
      outcome: "failed",
      exitCode: 1,
    });
    return step as { id: string };
  };
  return { owner, live, proposal, records, replies, prompts, failed, cwd };
}
const reply = (evidence: string, extra: object = {}) => ({
  action: "continue",
  level: "repair",
  cause: "observed",
  evidence: [evidence],
  strategy: `approach ${randomUUID()}`,
  work: [],
  ...extra,
});

it("an edit outside the write scope is a fact recovery decides about; a protected path still refuses the run", async () => {
  const { owner, live } = fixture();
  const step = { id: "implementation-step" };
  tree.files.set("a.txt", "before");
  // Inside the repository boundary: recoverable, citing the attempt's own step.
  const adopted = owner.scoped(
    live,
    ["a.txt"],
    async () => {
      tree.files.set("a.txt", "after");
      tree.files.set("src/helper.ts", "new helper");
      return step;
    },
    owner.cwd,
    (value: { id: string }) => [value.id],
  );
  await expect(adopted).rejects.toBeInstanceOf(AttemptFailure);
  await adopted.catch((error: AttemptFailure) => {
    expect(error.steps).toEqual([step.id]);
    expect(error.message).toContain("src/helper.ts");
    expect(error.message).toContain("level replan");
  });
  // The edits stay; in-scope ones are still counted as delivered.
  expect(tree.files.get("src/helper.ts")).toBe("new helper");
  expect(live.delivered.has("a.txt")).toBe(true);
  for (const path of [".env", "deploy/id_rsa", "certs/server.pem"]) {
    const refused = owner.scoped(
      live,
      ["a.txt"],
      async () => {
        tree.files.set(path, "secret");
        return step;
      },
      owner.cwd,
      (value: { id: string }) => [value.id],
    );
    await expect(refused, path).rejects.toBeInstanceOf(WorkflowRefusal);
    tree.files.delete(path);
  }
  // Without a step to cite there is nothing recovery could be bound to.
  await expect(
    owner.scoped(live, ["a.txt"], async () => {
      tree.files.set("src/other.ts", "x");
    }),
  ).rejects.toBeInstanceOf(WorkflowRefusal);
});

it("a recorded revision extends the run's write scope, and a path the target checkout changed cannot join it", async () => {
  const { owner, live, proposal, replies, prompts, failed, records } =
    fixture();
  let attempt = 0;
  const first = failed();
  replies.push(
    reply(first.id, {
      level: "replan",
      scope: ["shared/types.ts"],
      strategy: "extract the shared type",
    }),
  );
  await owner
    .controller(live, owner.cwd, proposal)
    .complete("task a", async () => {
      if (++attempt === 1)
        throw new AttemptFailure("needs a shared type", [first.id]);
    });
  expect(live.run.scope).toEqual(["shared/types.ts"]);
  expect(owner.scope(live, proposal)).toEqual([
    "a.txt",
    "b.txt",
    "shared/types.ts",
  ]);
  expect(live.run.revision).toBe(1);
  expect(
    records.get(join(owner.root, "runs", live.run.id, "revisions", "1.json")),
  ).toMatchObject({ revision: 1, decision: { level: "replan" } });
  expect(prompts[0]).toContain("Current write scope: a.txt, b.txt");
  expect(prompts[0]).toContain("Least level for this decision: repair");
  expect(prompts[0]).toContain(
    "Dependency installation by revision: not allowed",
  );

  // The user's own change to a path blocks adding it; the diagnosis is told why
  // and decides again.
  live.target = { head: "1".repeat(40), branch: "refs/heads/main" };
  tree.dirtyTarget = ["docs/guide.md"];
  const second = failed();
  replies.push(
    reply(second.id, { level: "replan", scope: ["docs/guide.md"] }),
    reply(second.id, { level: "replan", scope: ["docs/usage.md"] }),
  );
  attempt = 0;
  await owner
    .controller(live, owner.cwd, proposal)
    .complete("task b", async () => {
      if (++attempt === 1)
        throw new AttemptFailure("needs a document", [second.id]);
    });
  expect(live.run.scope).toEqual(["shared/types.ts", "docs/usage.md"]);
  expect(prompts.at(-1)).toContain("could not be used");
  expect(prompts.at(-1)).toContain("docs/guide.md");
  expect(prompts.at(-1)).toContain(
    "Current write scope: a.txt, b.txt, shared/types.ts",
  );
});

it("a deviation is recorded on the run, shown to later workers and the review, and sets aside only the checks it names", async () => {
  const { owner, live, proposal, replies, prompts, failed } = fixture();
  const step = failed();
  replies.push(
    reply(step.id, {
      level: "deviate",
      deviation: {
        item: "Output is formatted by the house formatter",
        reason: "The formatter cannot parse the generated grammar file",
        delivered: "Generated grammar is excluded from formatting",
        waives: ["format"],
      },
    }),
  );
  let attempt = 0;
  await owner
    .controller(live, owner.cwd, proposal)
    .complete("verification", async () => {
      if (++attempt === 1) throw new AttemptFailure("format failed", [step.id]);
    });
  expect(live.run.deviations).toMatchObject([
    { revision: 1, waives: ["format"] },
  ]);
  expect(live.run.notice).toContain("Plan revision 1 (deviate)");
  expect(owner.deviationBrief(live, "work")).toContain(
    "implement the delivered variant",
  );

  // The declared checks all still run. The one set aside no longer gates;
  // any other failure still does.
  const outcomes: Record<string, boolean> = { unit: true, format: false };
  owner.check = async (_l: unknown, _c: string, c: { name: string }) => {
    const check = owner.step(live, c.name, "check");
    const result = outcomes[c.name]
      ? settled
      : { ...settled, outcome: "failed", exitCode: 1 };
    owner.finishStep(live, check, result);
    return { result, step: check };
  };
  const observed: { id: string; status: string }[] = [];
  const waived = new Set<string>();
  expect(
    await owner.checks(live, owner.cwd, proposal.plan, false, observed, waived),
  ).toBe(true);
  expect(observed.map((s) => s.status)).toEqual(["completed", "failed"]);
  expect([...waived]).toEqual([observed[1].id]);
  outcomes.unit = false;
  expect(await owner.checks(live, owner.cwd, proposal.plan)).toBe(false);

  // The review is asked to judge the deviation.
  replies.push({ approved: true, summary: "ok", blockingIssues: [] });
  await owner.review(live, owner.cwd, proposal, observed);
  expect(prompts.at(-1)).toContain("Recorded deviations from the agreement");
  expect(prompts.at(-1)).toContain(
    "unnecessary or larger than needed is a blocking issue",
  );
  expect(prompts.at(-1)).toContain("Checks set aside: format");
});

it("acceptance records which checks were set aside and never accepts a candidate whose every check was", () => {
  const check = (name: string, ok: boolean) => ({
    id: `${name}-${randomUUID()}`,
    kind: "check" as const,
    status: ok ? ("completed" as const) : ("failed" as const),
    exitCode: ok ? 0 : 1,
    text: "",
    truncated: false,
  });
  const review = {
    ...check("review", true),
    kind: "review" as const,
  };
  const execution = { cwd: "/x", checkoutRoot: "/x" } as never;
  const args = [
    "1".repeat(40),
    "2".repeat(40),
    "d".repeat(64),
    execution,
  ] as const;
  const unit = check("unit", true),
    format = check("format", false);
  const accepted = acceptanceRecord(
    ...args,
    [unit, format],
    review,
    2,
    new Set([format.id]),
  );
  expect(accepted.waived).toEqual([format.id]);
  expect(acceptanceRecord(...args, [unit], review, 1).waived).toBeUndefined();
  // A failed check nobody set aside, a waived check that actually passed, and
  // a delivery with nothing left to gate it are all refused.
  expect(() => acceptanceRecord(...args, [unit, format], review, 2)).toThrow();
  expect(() =>
    acceptanceRecord(...args, [unit, format], review, 2, new Set([unit.id])),
  ).toThrow();
  expect(() =>
    acceptanceRecord(...args, [format], review, 1, new Set([format.id])),
  ).toThrow();
});
