import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { CadencePreferences } from "../src/cadence-preferences.ts";
import {
  PLAN_PARAMETERS,
  RESEARCH_PARAMETERS,
} from "../src/coordinator-tools.mjs";
import {
  clipUnits,
  decodeWorkflowPlan,
  decodeWorkflowProposal,
  decodeWorkflowRequest,
  decodeWorkflowRun,
  investigationId,
  readableWorkflowPlan,
  researchInput,
  WORKFLOW_LIMITS,
  WorkflowInputError,
  type WorkflowPlan,
  workflowAncestors,
  workflowCovers,
  workflowOrder,
  workflowPlanInput,
} from "../src/service/contracts/workflow.ts";
import {
  decodeRoutePlan,
  InvalidRoute,
} from "../src/service/workflow-controller.ts";

import { plan, v4Plan } from "./helpers/workflow-plan.ts";

/** A plan as a model may send it: any field present, absent or of any type. */
type Draft = Record<string, unknown>;

it("retained task plans remain finite DAGs and checks are mandatory; route revisions belong to the owner", () => {
  expect(
    workflowOrder(decodeWorkflowPlan(v4Plan()).tasks).map((t) => t.id),
  ).toEqual(["a", "b"]);
  for (const mutate of [
    (p: WorkflowPlan) => {
      p.tasks[0].after = ["b"];
      p.tasks[1].after = ["a"];
    },
    (p: WorkflowPlan) => {
      p.tasks[1].after = ["missing"];
    },
    (p: WorkflowPlan) => {
      p.tasks[0].writes = ["../outside"];
    },
    (p: WorkflowPlan) => {
      p.tasks[0].writes = [".git/config"];
    },
    (p: WorkflowPlan) => {
      p.checks = [];
    },
    (p: WorkflowPlan) => {
      p.repairAttempts = 3;
    },
  ]) {
    const p = v4Plan();
    mutate(p);
    expect(() => decodeWorkflowPlan(p)).toThrow();
  }
  const p = v4Plan();
  p.tasks[1].after = ["a"];
  p.tasks[1].writes = ["a.txt"];
  expect(
    workflowAncestors(decodeWorkflowPlan(p).tasks, "b").map((t) => t.id),
  ).toEqual(["a"]);
});

it("new plans refuse invisible path characters; retained 2.0.21 task shapes still read", () => {
  const strict = { strict: true };
  for (const path of [
    "src/\u202eevil.ts",
    "src/a\u200b.ts",
    "src/\u2066x\u2069.ts",
    "src/\ufeffa.ts",
    "src/a\u2028b.ts",
  ]) {
    const v5 = plan();
    v5.areas = [path];
    expect(
      () => decodeWorkflowPlan(v5, strict),
      JSON.stringify(path),
    ).toThrow();
    const legacy = v4Plan();
    legacy.tasks[0].writes = [path];
    // Read decoding keeps accepting what 2.0.21 accepted.
    expect(decodeWorkflowPlan(legacy).tasks[0].writes).toEqual([path]);
  }
  const long = v4Plan();
  long.tasks[0].id = `a${"b".repeat(48)}`;
  expect(() => decodeWorkflowPlan(long, strict)).toThrow();
  expect(decodeWorkflowPlan(long).tasks[0].id).toHaveLength(49);
  const retained = {
    id: "00000000-0000-4000-8000-000000000000",
    epoch: "00000000-0000-4000-8000-000000000001",
    digest: "0".repeat(64),
    observation: "1".repeat(64),
    model: {
      epoch: "00000000-0000-4000-8000-000000000001",
      accessGeneration: 1,
      configRev: 1,
      catalogId: "00000000-0000-4000-8000-000000000002",
    },
    plan: long,
    cwd: "/project",
  };
  expect(decodeWorkflowProposal(retained).plan.tasks[0].id).toHaveLength(49);
  long.tasks[0].id = `a${"b".repeat(64)}`;
  expect(() => decodeWorkflowPlan(long)).toThrow();
  const nestedScope = v4Plan();
  nestedScope.tasks[0].writes = ["src"];
  nestedScope.tasks[1].writes = ["src/b.txt"];
  expect(decodeWorkflowPlan(nestedScope).tasks).toHaveLength(2);
  expect(workflowCovers(["src"], "src/b.txt")).toBe(true);
  expect(workflowCovers(["src"], "srcx/b.txt")).toBe(false);
});

it("unit clipping never leaves a lone surrogate", () => {
  const value = `${"x".repeat(79)}\u{1F9EA} tail`;
  expect(clipUnits(value, 80)).toBe("x".repeat(79));
  expect(clipUnits(value, 81)).toBe(`${"x".repeat(79)}\u{1F9EA}`);
  expect(clipUnits("short", 80)).toBe("short");
  expect(() =>
    decodeWorkflowRun({
      id: "00000000-0000-4000-8000-000000000000",
      epoch: "00000000-0000-4000-8000-000000000001",
      goal: clipUnits(`${"g".repeat(319)}\u{1F600}`, 320),
      status: "running",
      phase: "planning",
      steps: [
        {
          id: `${clipUnits(value, 80)}-00000000-0000-4000-8000-000000000002`,
          kind: "planning",
          status: "running",
          text: "",
          exitCode: null,
          truncated: false,
        },
      ],
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
    }),
  ).not.toThrow();
});

it("rejected is a review verdict only; historical failures stay unchanged", () => {
  const run = {
    id: randomUUID(),
    epoch: randomUUID(),
    goal: "review",
    status: "failed",
    phase: "finished",
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    steps: [
      {
        id: "review",
        kind: "review",
        status: "rejected",
        text: "",
        exitCode: 0,
        truncated: false,
      },
    ],
  };
  expect(decodeWorkflowRun(run).steps[0].status).toBe("rejected");
  expect(() => decodeWorkflowRun({ ...run, status: "rejected" })).toThrow();
  run.steps[0].kind = "implementation";
  expect(() => decodeWorkflowRun(run)).toThrow();
  run.steps[0].kind = "review";
  run.steps[0].status = "failed";
  expect(decodeWorkflowRun(run).steps[0].status).toBe("failed");
});

it("automatic execution cannot manufacture human-reviewed state", () => {
  expect(() => decodeWorkflowRun({ humanReviewed: true })).toThrow();
});

it("global preferences persist only exact model choice and never silently replace corrupt files", () => {
  const root = mkdtempSync(join(tmpdir(), "cadence-preferences-")),
    p = new CadencePreferences(root);
  expect(p.read()).toBeNull();
  const model = {
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
  } as const;
  p.save(model);
  expect(new CadencePreferences(root).read()).toEqual(model);
  expect(readFileSync(p.path, "utf8")).not.toMatch(
    /sourceSelectionId|auth|grant/,
  );
  writeFileSync(p.path, '{"schema":"unknown"}');
  expect(() => p.save(model)).toThrow();
  expect(readFileSync(p.path, "utf8")).toBe('{"schema":"unknown"}');
});

it("retained agreements (v1-v4) remain readable but only a current v5 agreement authorizes delivery", () => {
  const current = plan();
  expect(decodeWorkflowPlan(current, { strict: true })).toEqual(current);
  const v4 = v4Plan();
  const {
    version: _version,
    assumptions: _assumptions,
    documents: _documents,
    reviewReads: _reviewReads,
    policy: _policy,
    build: _build,
    links: _links,
    tasks,
    ...body
  } = v4;
  const earlierTasks = tasks.map(({ reads: _reads, ...task }) => task);
  const fixed = {
    ...body,
    tasks: earlierTasks,
    projectContext: "Original planning notes",
    repairAttempts: 2,
  };
  const adaptive = {
    ...body,
    tasks: earlierTasks,
    version: 2,
    knowledge: ["docs/guide.md"],
  };
  const v3 = {
    ...body,
    tasks,
    version: 3,
    assumptions: "",
    documents: [],
    reviewReads: [],
    policy: { installs: false },
  };
  for (const retained of [fixed, adaptive, v3, v4]) {
    expect(decodeWorkflowPlan(retained)).toEqual(retained);
    expect(() => decodeWorkflowPlan(retained, { strict: true })).toThrow(
      "readonly",
    );
  }
  // Versions do not mix their fields.
  for (const mixed of [
    { ...current, repairAttempts: 2 },
    { ...current, knowledge: [] },
    { ...current, reviewReads: [] },
    { ...adaptive, assumptions: "" },
    { ...v3, build: [] },
    { ...current, version: 6 },
  ])
    expect(() => decodeWorkflowPlan(mixed)).toThrow();
  for (const path of [
    "../secret.md",
    ".env",
    "notes.txt",
    ".cadence/project.md",
    ".cadence/knowledge/topic.md",
  ])
    expect(() =>
      decodeWorkflowPlan({ ...current, documents: [path] }, { strict: true }),
    ).toThrow();
});

it("a current v5 agreement states assumptions, installation policy, investigations and advisory areas", () => {
  const p = plan();
  p.assumptions = "Keep the public CLI flags unchanged.";
  p.policy = { installs: true };
  p.investigations = ["0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10"];
  p.areas = ["src/service", "test/workflow-contract.test.ts"];
  p.documents = ["engineering/limits.md"];
  const decoded = decodeWorkflowPlan(p, { strict: true });
  expect(decoded).toEqual(p);
  const readable = readableWorkflowPlan(decoded);
  expect(readable).toContain("## Assumptions (confirmed by approval)");
  expect(readable).toContain("Keep the public CLI flags unchanged.");
  expect(readable).toContain("## Focus areas (advisory for route planning)");
  expect(readable).toContain("src/service");
  expect(readable).toContain("## Investigations passed to route planning");
  expect(readable).toContain("0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10");
  expect(readable).toContain(
    "After approval the service works to completion without further confirmation. First, a readonly route planner inspects",
  );
  expect(readable).toContain("recorded deviation");
  expect(readable).toContain(
    "Revisions may add dependency-installation commands",
  );
  for (const invalid of [
    { ...p, policy: {} },
    { ...p, policy: { installs: "yes" } },
    { ...p, assumptions: undefined },
    { ...p, investigations: ["not-an-id"] },
    { ...p, areas: ["../outside"] },
    { ...p, areas: [".env"] },
    { ...p, documents: [".cadence/project.md"] },
  ])
    expect(() => decodeWorkflowPlan(invalid, { strict: true })).toThrow();
});

it("new setup/check commands default to no timeout without rewriting approved explicit values", () => {
  const p = plan();
  p.setup = [{ name: "setup", command: "prepare", placement: "worktree" }];
  p.baselineChecks = [{ name: "baseline", command: "inspect" }];
  p.checks = [{ name: "verify", command: "verify" }];
  const decoded = decodeWorkflowPlan(p, { strict: true });
  for (const commands of [
    decoded.setup,
    decoded.baselineChecks,
    decoded.checks,
  ])
    expect(commands[0]).not.toHaveProperty("timeoutMs");
  for (const timeoutMs of [120_000, 1_200_000, 3_600_000]) {
    p.checks[0].timeoutMs = timeoutMs;
    expect(decodeWorkflowPlan(p).checks[0].timeoutMs).toBe(timeoutMs);
  }
  for (const timeoutMs of [0, -1, Number.POSITIVE_INFINITY, 2_147_483_648]) {
    p.checks[0].timeoutMs = timeoutMs;
    expect(() => decodeWorkflowPlan(p)).toThrow();
  }
});

it("a research run carries as many independent questions as the plan needs, within its wire bound", () => {
  const request = (count: number) => ({
    action: "research",
    goal: "Map the delivery executor",
    questions: Array.from({ length: count }, (_, i) => `Question ${i + 1}`),
    model: {
      epoch: randomUUID(),
      accessGeneration: 1,
      configRev: 1,
      catalogId: randomUUID(),
    },
  });
  // How many run at once is the owner's execution limit, not this bound.
  expect(WORKFLOW_LIMITS.questions).toBe(32);
  const full = decodeWorkflowRequest(request(WORKFLOW_LIMITS.questions));
  expect(full.action === "research" && full.questions).toHaveLength(32);
  expect(() =>
    decodeWorkflowRequest(request(WORKFLOW_LIMITS.questions + 1)),
  ).toThrow();
  expect(() => decodeWorkflowRequest(request(0))).toThrow();
});

it("the tool schemas state no count, so only the service's named refusal turns a call down", () => {
  const bounds = JSON.stringify([RESEARCH_PARAMETERS, PLAN_PARAMETERS]).match(
    /"(?:maxItems|minItems|maxLength|minLength|maximum|minimum)"/gu,
  );
  expect(bounds).toBeNull();
  const planProps = (PLAN_PARAMETERS as { properties: Record<string, unknown> })
    .properties;
  expect(planProps).not.toHaveProperty("tasks");
  expect(planProps).not.toHaveProperty("reviewReads");
  expect(planProps).toHaveProperty("investigations");
  expect(planProps).toHaveProperty("areas");
  expect(
    researchInput({
      goal: "Map the project",
      questions: ["structure?", "flows?", "documents?", "dependencies?"],
      roots: ["/project"],
    }),
  ).toEqual({
    goal: "Map the project",
    questions: ["structure?", "flows?", "documents?", "dependencies?"],
    roots: ["/project"],
  });
  expect(() => researchInput(null)).toThrow(WorkflowInputError);
  expect(() => researchInput({ goal: "g", questions: {} })).toThrow(
    "questions: must be a list",
  );
  expect(() =>
    researchInput({
      goal: "g",
      questions: ["q"],
      roots: Array(9)
        .fill(0)
        .map((_, i) => `r${i}`),
    }),
  ).toThrow("roots: has 9 directories; at most 8");
});

it("a v5 plan input preserves omitted vs empty links, completes defaults and names every refusal field", () => {
  const p = plan();
  const {
    version: _version,
    setup: _setup,
    links: _links,
    tasks: _tasks,
    ...partial
  } = p;
  const completed = workflowPlanInput(partial);
  expect(completed.links).toBeUndefined();
  expect({ ...completed, links: [] }).toEqual(p);
  expect(workflowPlanInput({ ...partial, links: [] }).links).toEqual([]);
  expect(workflowPlanInput({ ...partial, policy: null }).policy).toEqual({
    installs: false,
  });
  expect(investigationId("0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10")).toBe(
    "0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10",
  );
  expect(
    investigationId("research-12-0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10"),
  ).toBe("0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10");
  expect(investigationId("research-2")).toBeNull();
  // Deduplicates investigations and areas automatically.
  const id = "0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10";
  const deduped = workflowPlanInput({
    ...partial,
    investigations: [id, `research-1-${id}`],
    areas: ["src/a", "src/a"],
  });
  expect(deduped.investigations).toEqual([id]);
  expect(deduped.areas).toEqual(["src/a"]);
  for (const [mutate, said] of [
    [
      (q: Draft) => {
        q.version = 4;
      },
      "earlier agreements are readonly",
    ],
    [
      (q: Draft) => {
        q.tasks = [
          { id: "a", title: "A", instructions: "Do A", writes: ["a.txt"] },
        ];
      },
      "tasks: v5 delivery agreements do not declare tasks",
    ],
    [
      (q: Draft) => {
        q.checks = [{ name: "c", command: "run", timeoutMs: 5 }];
      },
      "checks[0].timeoutMs: is a whole number of milliseconds from 100",
    ],
    [
      (q: Draft) => {
        q.checks = [{ name: "c" }];
      },
      "checks[0]: is missing command",
    ],
    [
      (q: Draft) => {
        q.setup = Array(5).fill(p.checks[0]);
      },
      "setup: has 5 entries; at most 4",
    ],
    [
      (q: Draft) => {
        q.documents = ["notes.txt"];
      },
      "documents[0]: must be a Markdown file (.md)",
    ],
    [
      (q: Draft) => {
        q.documents = [".cadence/project.md"];
      },
      "documents[0]: is managed automatically under .cadence/ and must not be listed in documents",
    ],
    [
      (q: Draft) => {
        q.delivery = "push";
      },
      "delivery: is local-merge or working-copy",
    ],
    [
      (q: Draft) => {
        q.policy = { installs: "yes" };
      },
      "policy.installs: must be true or false",
    ],
    [
      (q: Draft) => {
        q.investigations = ["research-2"];
      },
      'investigations[0]: "research-2" is not an investigation',
    ],
    [
      (q: Draft) => {
        q.areas = ["../outside"];
      },
      "areas[0]: is not a plain path inside the repository",
    ],
    [
      (q: Draft) => {
        q.areas = [".env"];
      },
      "areas[0]: is not a plain path inside the repository",
    ],
    [
      (q: Draft) => {
        q.acceptance = "ok\u001b[2J";
      },
      "acceptance: contains an invisible control character",
    ],
    [
      (q: Draft) => {
        q.extra = 1;
      },
      'plan: has no field "extra"',
    ],
  ] as const) {
    const q: Draft = structuredClone(partial);
    mutate(q);
    expect(() => workflowPlanInput(q), said).toThrow(said);
  }
  expect(() => workflowPlanInput("plan")).toThrow("plan: must be an object");
});

it("setup placement is explicit in new approvals; retained unplaced setup is never reinterpreted", () => {
  const p = plan();
  p.setup = [{ name: "branch", command: "git symbolic-ref -q HEAD" }];
  expect(decodeWorkflowPlan(p).setup).toEqual(p.setup);
  expect(() => decodeWorkflowPlan(p, { strict: true })).toThrow(
    "setup[0]: is missing placement",
  );
  expect(() => workflowPlanInput(p)).toThrow("placement");
  for (const placement of ["target", "candidate", "worktree"] as const) {
    p.setup[0].placement = placement;
    const approved = decodeWorkflowPlan(p, { strict: true });
    expect(approved.setup[0].placement).toBe(placement);
    expect(readableWorkflowPlan(approved)).toContain(
      `[${placement}] branch: git symbolic-ref -q HEAD`,
    );
  }
  expect(() =>
    workflowPlanInput({
      ...p,
      setup: [{ ...p.setup[0], placement: "anywhere" }],
    }),
  ).toThrow("setup[0].placement");
});

it("partial and blocked are assignment/planning reports, not check/review approval or run completion", () => {
  const run = {
    id: randomUUID(),
    epoch: randomUUID(),
    goal: "partial work",
    status: "failed",
    phase: "finished",
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    steps: [
      {
        id: "a",
        kind: "implementation",
        status: "partial",
        text: "",
        exitCode: 0,
        truncated: false,
      },
    ],
  };
  for (const status of ["partial", "blocked"]) {
    run.steps[0].status = status;
    expect(decodeWorkflowRun(run).steps[0].status).toBe(status);
    expect(() => decodeWorkflowRun({ ...run, status })).toThrow();
    for (const kind of ["check", "review", "research"])
      expect(() =>
        decodeWorkflowRun({ ...run, steps: [{ ...run.steps[0], kind }] }),
      ).toThrow();
  }
  expect(
    decodeWorkflowRun({
      ...run,
      steps: [{ ...run.steps[0], kind: "planning", status: "blocked" }],
    }).steps[0].status,
  ).toBe("blocked");
  expect(
    decodeWorkflowRun({
      ...run,
      steps: [
        { ...run.steps[0], kind: "check", status: "not-run", exitCode: null },
      ],
    }).steps[0].status,
  ).toBe("not-run");
  expect(() =>
    decodeWorkflowRun({
      ...run,
      steps: [{ ...run.steps[0], kind: "review", status: "not-run" }],
    }),
  ).toThrow();
});

it("v5 plans express build outputs, check tiers and managed links without extra forms", () => {
  const p = workflowPlanInput({
    ...plan(),
    build: [
      {
        name: "web",
        command: "bun run build:web",
        outputs: ["web/dist", "provenance/webui-reuse.json"],
      },
    ],
    links: [
      { path: "node_modules" },
      { path: "web/node_modules", placement: "candidate" },
    ],
    checks: [
      {
        name: "verify",
        command: "bun run verify",
        tier: "fast",
        target: "run",
      },
      {
        name: "optical",
        command: "node scripts/qualify-optical.mjs",
        tier: "heavy",
        target: "skip",
      },
    ],
  });
  expect(p.version).toBe(5);
  expect(p.build?.[0].outputs).toEqual([
    "web/dist",
    "provenance/webui-reuse.json",
  ]);
  expect(p.links).toEqual([
    { path: "node_modules" },
    { path: "web/node_modules", placement: "candidate" },
  ]);
  const readable = readableWorkflowPlan(p);
  expect(readable).toContain("## Build (owner-synced derived outputs)");
  expect(readable).toContain("web/dist, provenance/webui-reuse.json");
  expect(readable).toContain("## Managed dependency links");
  expect(readable).toContain("[worktree] node_modules -> node_modules");
  // A retained target choice still decodes, and is no longer shown: checks
  // are decided on the exact candidate, never rerun in the user's checkout.
  expect(p.checks.map((c) => c.target)).toEqual(["run", "skip"]);
  expect(readable).toContain("verify [fast]:");
  expect(readable).toContain("optical [heavy]:");
  expect(readable).not.toContain("target:");
  for (const invalid of [
    { ...p, build: [{ name: "b", command: "run", outputs: [] }] },
    { ...p, build: [{ name: "b", command: "run", outputs: [".env"] }] },
    { ...p, links: [{ path: ".git/hooks" }] },
    { ...p, links: [{ path: "node_modules" }, { path: "node_modules" }] },
    { ...p, checks: [{ name: "c", command: "run", tier: "medium" }] },
    { ...p, checks: [{ name: "c", command: "run", target: "always" }] },
  ])
    expect(() => workflowPlanInput(invalid)).toThrow(WorkflowInputError);
});

it("decodeRoutePlan validates Stage 2 DAGs, blocked replies and rejects unsafe or cyclic routes", () => {
  const investigation = randomUUID();
  const valid = decodeRoutePlan(
    `\`\`\`json\n${JSON.stringify({
      tasks: [
        {
          id: "core",
          title: "Shared contract",
          instructions: "Update src/core.ts",
          writes: ["src/core.ts"],
          after: [],
          reads: [
            { path: "AGENTS.md", section: "Development", reason: "Rules" },
            { research: investigation, reason: "Prior evidence" },
          ],
        },
        {
          id: "tests",
          title: "Unit tests",
          instructions: "Add coverage",
          writes: ["test/core.test.ts"],
          after: ["core"],
        },
      ],
      reviewReads: [
        { path: "engineering/architecture.md", reason: "Module boundary" },
      ],
      documents: ["engineering/architecture.md"],
    })}\n\`\`\``,
  );
  expect(valid).toMatchObject({
    action: "plan",
    documents: ["engineering/architecture.md"],
  });
  expect(valid.tasks.map((t) => t.id)).toEqual(["core", "tests"]);
  expect(valid.tasks[1].reads).toEqual([]);

  const blocked = decodeRoutePlan(
    JSON.stringify({
      action: "blocked",
      reason: "Agreement contradicts existing immutable public API.",
    }),
  );
  expect(blocked).toMatchObject({
    action: "blocked",
    tasks: [],
    reason: "Agreement contradicts existing immutable public API.",
  });

  for (const [reply, match] of [
    ["not json at all", /JSON object/i],
    ['{"tasks":[]}', /at least one assignment/],
    [
      JSON.stringify({
        tasks: [
          {
            id: "a",
            title: "A",
            instructions: "Do A",
            writes: ["a.ts"],
            after: ["b"],
          },
          {
            id: "b",
            title: "B",
            instructions: "Do B",
            writes: ["b.ts"],
            after: ["a"],
          },
        ],
      }),
      /cycle/,
    ],
    [
      JSON.stringify({
        tasks: [
          {
            id: "a",
            title: "A",
            instructions: "Do A",
            writes: ["a.ts"],
            after: ["missing"],
          },
        ],
      }),
      /not in tasks/,
    ],
    [
      JSON.stringify({
        tasks: [
          { id: "a", title: "A", instructions: "Do A", writes: [".env"] },
        ],
      }),
      /\.env/,
    ],
    [
      JSON.stringify({
        tasks: [
          { id: "a", title: "A", instructions: "Do A", writes: ["../x.ts"] },
        ],
      }),
      /writes\[0\]/,
    ],
    [
      JSON.stringify({
        tasks: [
          { id: "a", title: "A", instructions: "Do A", writes: ["a.ts"] },
        ],
        documents: [".cadence/project.md"],
      }),
      /\.cadence\//,
    ],
    [
      JSON.stringify({
        tasks: [
          { id: "a", title: "A", instructions: "Do A", writes: ["a.ts"] },
        ],
      }) + JSON.stringify({ tasks: [] }),
      /more than one|JSON/i,
    ],
  ] as const) {
    expect(() => decodeRoutePlan(reply), String(match)).toThrow(InvalidRoute);
    expect(() => decodeRoutePlan(reply), String(match)).toThrow(match);
  }
});
