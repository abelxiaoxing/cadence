/** V5 two-stage delivery (Stage 1 proposal + 3D managed links + Stage 2 route-planner)
 * and deterministic planning gates with controlled worker ports. */
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { ChoiceVersion } from "../src/service/contracts/models.ts";
import type {
  WorkflowPlan,
  WorkflowProposal,
  WorkflowRun,
} from "../src/service/contracts/workflow.ts";
import { readableWorkflowPlan } from "../src/service/contracts/workflow.ts";
import { decodeRoutePlan } from "../src/service/workflow-controller.ts";
import { deliveryObservation } from "../src/service/workflow-delivery.ts";
import { Workflows } from "../src/service/workflows.ts";
import { deliveryFixture } from "./helpers/delivery-fixture.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";
import { plan } from "./helpers/workflow-plan.ts";

afterEach(() => vi.restoreAllMocks());

function v5Fixture(
  options: {
    ignoreFile?: string;
    createNodeModules?: boolean;
    createWebNodeModules?: boolean;
    secrets?: string[];
  } = {},
) {
  const f = deliveryFixture();
  f.git("config", "user.name", "Fixture");
  f.git("config", "user.email", "fixture@example.invalid");
  if (options.ignoreFile !== undefined) {
    writeFileSync(join(f.root, ".gitignore"), options.ignoreFile);
    f.git("add", ".gitignore");
    f.git("commit", "-qm", "add gitignore");
  }
  if (options.createNodeModules) {
    mkdirSync(join(f.root, "node_modules", "dep"), { recursive: true });
    writeFileSync(
      join(f.root, "node_modules", "dep", "index.js"),
      "export {};\n",
    );
  }
  if (options.createWebNodeModules) {
    mkdirSync(join(f.root, "web", "node_modules", "dep"), { recursive: true });
    writeFileSync(
      join(f.root, "web", "node_modules", "dep", "index.js"),
      "export {};\n",
    );
  }
  const lease = f.c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:31418",
    policyIdentity: "a".repeat(64),
  });
  const epoch = lease.registration.epoch;
  const version: ChoiceVersion = {
    epoch,
    accessGeneration: 1,
    configRev: 1,
    catalogId: randomUUID(),
  };
  const execution = {
    cwd: f.root,
    checkoutRoot: f.root,
    version,
    model: {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "fixed",
      api: "openai-completions" as const,
      thinking: "off" as const,
    },
  };
  const workflows = new Workflows({
    cwd: f.root,
    coordination: f.c,
    owner: {
      lease,
      state: "idle",
      quarantine() {},
      trackConversation() {},
      trackConversationProcess() {},
    },
    contexts: { capture: () => execution },
    models: {
      workerSettings: () => fixtureRuntime(),
      assertCurrent() {},
    },
    secrets: () => options.secrets ?? [],
  } as unknown as ConstructorParameters<typeof Workflows>[0]);
  return {
    ...f,
    workflows,
    lease,
    epoch,
    version,
    execution,
    close: () => {
      f.delivery.finish();
      lease.release();
    },
  };
}

it("3D publishProposal auto-discovers ignored node_modules when links is omitted, disables on [], skips when installs=true, and binds into digest", () => {
  const f = v5Fixture({
    ignoreFile: "node_modules/\nweb/node_modules/\n",
    createNodeModules: true,
    createWebNodeModules: true,
  });
  try {
    const omitLinks = (): WorkflowPlan => {
      const p = plan();
      delete p.links;
      return p;
    };
    const propose = (p: WorkflowPlan) => {
      const r = f.workflows.command(randomUUID(), f.epoch, {
        action: "propose",
        plan: p,
        model: f.version,
      });
      if (r.kind !== "workflow" || r.response.type !== "proposal")
        throw Error("proposal");
      return r.response.proposal;
    };

    // Omitted links + local-merge + !installs -> auto-discovers both node_modules.
    const auto = propose(omitLinks());
    expect(auto.plan.links).toEqual([
      { path: "node_modules", placement: "worktree" },
      { path: "web/node_modules", placement: "worktree" },
    ]);

    // Explicit links: [] disables auto-discovery and changes proposal.digest.
    const disabled = propose({ ...plan(), links: [] });
    expect(disabled.plan.links).toEqual([]);
    expect(disabled.digest).not.toBe(auto.digest);

    // policy.installs: true skips auto-discovery to protect target node_modules.
    const withInstalls = propose({
      ...omitLinks(),
      policy: { installs: true },
    });
    expect(withInstalls.plan.links).toEqual([]);

    // working-copy skips auto-discovery.
    const direct = propose({ ...omitLinks(), delivery: "working-copy" });
    expect(direct.plan.links).toEqual([]);

    // Revalidation preserves bound links unchanged.
    const revalidated = f.workflows.revalidate(randomUUID(), auto, f.version);
    expect(revalidated.plan.links).toEqual(auto.plan.links);

    // Unknown investigation UUID is refused at publishProposal.
    expect(() =>
      propose({ ...omitLinks(), investigations: [randomUUID()] }),
    ).toThrow(/invalid-plan|invalid/i);
  } finally {
    f.close();
  }
});

it("an agreement that leaves build out is bound to the repository's own declaration; [] declares none, and a declaration that cannot be used is refused by name", () => {
  const f = v5Fixture();
  try {
    const omitBuild = (): WorkflowPlan => {
      const p = plan();
      delete p.build;
      return p;
    };
    const propose = (p: WorkflowPlan) => {
      const r = f.workflows.command(randomUUID(), f.epoch, {
        action: "propose",
        plan: p,
        model: f.version,
      });
      if (r.kind !== "workflow" || r.response.type !== "proposal")
        throw Error("proposal");
      return r.response.proposal;
    };
    // A repository that declares nothing has no build steps.
    expect(propose(omitBuild()).plan.build).toEqual([]);

    const declare = (body: unknown) => {
      mkdirSync(join(f.root, ".cadence"), { recursive: true });
      writeFileSync(
        join(f.root, ".cadence/derived.json"),
        typeof body === "string" ? body : JSON.stringify(body),
      );
    };
    const build = [
      { name: "bundle", command: "make dist", outputs: ["dist", "gen.ts"] },
      { name: "pins", command: "make pins", refreshes: ["pins.json"] },
    ];
    declare({ build });
    const bound = propose(omitBuild());
    expect(bound.plan.build).toEqual([
      { name: "bundle", command: "make dist", outputs: ["dist", "gen.ts"] },
      {
        name: "pins",
        command: "make pins",
        outputs: [],
        refreshes: ["pins.json"],
      },
    ]);
    // Shown with the rest of the agreement, so it is what gets approved.
    expect(readableWorkflowPlan(bound.plan)).toContain(
      "bundle: make dist (no timeout) -> outputs: dist, gen.ts\npins: make pins (no timeout) -> refreshes: pins.json",
    );
    // An explicit list is the agreement's own; an empty one declares none.
    const none = propose({ ...plan(), build: [] });
    expect(none.plan.build).toEqual([]);
    expect(none.digest).not.toBe(bound.digest);
    const own = [{ name: "mine", command: "make mine", outputs: ["out"] }];
    expect(propose({ ...plan(), build: own }).plan.build).toEqual(own);
    // What was bound stays bound when the same agreement is rebound.
    declare({ build: [] });
    expect(
      f.workflows.revalidate(randomUUID(), bound, f.version).plan.build,
    ).toEqual(bound.plan.build);

    for (const [body, said] of [
      ["{ not json", ".cadence/derived.json: is not JSON"],
      [
        { build, checks: [] },
        '.cadence/derived.json: is an object with one field, "build"',
      ],
      [
        { build: [{ name: "x", command: "make x" }] },
        ".cadence/derived.json: build[0].outputs: needs at least one declared repository-relative path here or in refreshes",
      ],
      [
        { build: [{ name: "x", command: "make x", outputs: ["../out"] }] },
        ".cadence/derived.json: build[0].outputs[0]:",
      ],
      [
        {
          build: [
            {
              name: "x",
              command: "make x",
              outputs: ["dist"],
              refreshes: ["dist/pins.json"],
            },
          ],
        },
        '.cadence/derived.json: build[0].refreshes: "dist/pins.json" is also under outputs',
      ],
    ] as const) {
      declare(body);
      expect(() => propose(omitBuild()), said).toThrow(
        expect.objectContaining({
          code: "invalid",
          detail: expect.stringContaining(said),
        }),
      );
      // The coordinator can still say what it means.
      expect(propose({ ...plan(), build: [] }).plan.build).toEqual([]);
    }
  } finally {
    f.close();
  }
});

it("Stage 2 planRoute invokes route-planner, retries InvalidRoute objections, validates ignored and link gates, persists route.json and feeds assignments/review/learn", async () => {
  const f = v5Fixture({
    ignoreFile: "node_modules/\nignored/\n",
    createNodeModules: true,
  });
  try {
    const p = plan();
    delete p.links;
    p.areas = ["src/core"];
    const proposed = f.workflows.command(randomUUID(), f.epoch, {
      action: "propose",
      plan: p,
      model: f.version,
    });
    if (proposed.kind !== "workflow" || proposed.response.type !== "proposal")
      throw Error("proposal");
    const proposal = proposed.response.proposal;
    expect(proposal.plan.links).toEqual([
      { path: "node_modules", placement: "worktree" },
    ]);

    const engine = f.workflows as unknown as {
      planRoute(
        live: Record<string, unknown>,
        cwd: string,
        proposal: WorkflowProposal,
      ): Promise<void>;
      worker: ReturnType<typeof vi.fn>;
      save: ReturnType<typeof vi.fn>;
      write: ReturnType<typeof vi.fn>;
      path(runId: string, name: string): string;
    };
    const written = new Map<string, unknown>();
    const prompts: string[] = [];
    const kinds: string[] = [];
    const phases: string[] = [];
    const makeLive = () => {
      const id = randomUUID();
      const d = deliveryObservation(
        {
          policy: "task-branch-v3",
          target: { ...proposal.delivery!.target, head: f.base },
        },
        join(f.c.stateHome, "worktrees"),
        id,
        "v5-route",
      );
      const run: WorkflowRun = {
        id,
        epoch: f.epoch,
        goal: proposal.plan.goal,
        status: "running",
        phase: "planning",
        steps: [],
        revision: 0,
        notice: "",
        mergedCommit: null,
        humanReviewed: false,
        execution: f.execution,
        delivery: d,
      };
      return {
        run,
        execution: f.execution,
        proposal,
        abort: new AbortController(),
        delivered: new Set<string>(),
        notes: [] as string[],
      };
    };

    // Case 1: InvalidRoute (1st reply writes inside linked node_modules, 2nd writes ignored file)
    // retries up to PLAN_OBJECTIONS=2 and succeeds on 3rd attempt!
    const live1 = makeLive();
    const replies = [
      JSON.stringify({
        tasks: [
          {
            id: "bad-link",
            title: "Overlap link",
            instructions: "bad",
            writes: ["node_modules/x.js"],
            after: [],
          },
        ],
      }),
      JSON.stringify({
        tasks: [
          {
            id: "bad-ignore",
            title: "Ignored write",
            instructions: "bad",
            writes: ["ignored/out.txt"],
            after: [],
          },
        ],
      }),
      JSON.stringify({
        tasks: [
          {
            id: "core",
            title: "Core",
            instructions: "Create a.txt",
            writes: ["a.txt"],
            after: [],
            reads: [],
          },
          {
            id: "follow",
            title: "Follow",
            instructions: "Create b.txt",
            writes: ["b.txt"],
            after: ["core"],
            reads: [],
          },
        ],
        reviewReads: [{ path: "AGENTS.md", reason: "Check house rules" }],
        documents: ["README.md"],
      }),
    ];
    engine.save = vi.fn((l: { run: WorkflowRun }) => phases.push(l.run.phase));
    engine.write = vi.fn((path: string, value: unknown) => {
      written.set(path, value);
    });
    engine.worker = vi.fn(
      async (
        _l: unknown,
        _cwd: string,
        _id: string,
        prompt: string,
        readonly: boolean,
        _v: unknown,
        _r: unknown,
        kind: string,
      ) => {
        expect(readonly).toBe(true);
        prompts.push(prompt);
        kinds.push(kind);
        const text = replies.shift()!;
        return {
          result: {
            outcome: "completed",
            closed: true,
            exitCode: 0,
            text,
            output: text,
            truncated: false,
            durationMs: 1,
            signal: null,
          },
          step: {
            id: "plan-route",
            kind: "planning",
            status: "completed",
            text,
            exitCode: 0,
            truncated: false,
          },
          report: null,
        };
      },
    );

    await engine.planRoute(live1, f.root, proposal);
    expect(kinds).toEqual(["planning", "planning", "planning"]);
    expect(phases).toContain("planning");
    expect(prompts[0]).toContain("src/core");
    expect(prompts[0]).toContain("node_modules");
    expect(prompts[1]).toContain("overlap owner-managed dependency links");
    expect(prompts[2]).toContain("ignored by Git");
    expect((live1 as { planned?: unknown }).planned).toMatchObject({
      documents: ["README.md"],
      reviewReads: [{ path: "AGENTS.md", reason: "Check house rules" }],
    });
    expect(live1.run.scope).toEqual(
      expect.arrayContaining(["a.txt", "b.txt", "README.md"]),
    );
    expect(live1.run.tasks?.map((t) => t.id)).toEqual(["core", "follow"]);
    expect(written.get(engine.path(live1.run.id, "route.json"))).toMatchObject({
      documents: ["README.md"],
    });

    // Case 2: Planner returns { action: "blocked", reason } -> cleanly aborts without retries.
    const live2 = makeLive();
    const blockedStep = {
      id: "plan-route-1",
      kind: "planning",
      status: "completed" as string,
      text: "",
      exitCode: 0,
      truncated: false,
    };
    engine.worker = vi.fn(async () => ({
      result: {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        text: JSON.stringify({
          action: "blocked",
          reason: "Target architecture conflict cannot be satisfied.",
        }),
        output: "",
        truncated: false,
        durationMs: 1,
        signal: null,
      },
      step: blockedStep,
      report: null,
    }));
    await expect(engine.planRoute(live2, f.root, proposal)).rejects.toThrow(
      "Target architecture conflict cannot be satisfied.",
    );
    expect(engine.worker).toHaveBeenCalledTimes(1);
    expect(blockedStep.status).toBe("blocked");

    // Case 3: uncommitted changes in the user's checkout to a planned write
    // path do not refuse the route: work is isolated from them, and the
    // landing deals with them when it gets there.
    writeFileSync(join(f.root, "dirty.txt"), "uncommitted user edit\n");
    const live3 = makeLive();
    engine.worker = vi.fn(async () => ({
      result: {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        text: JSON.stringify({
          tasks: [
            {
              id: "touch-dirty",
              title: "Edit dirty",
              instructions: "Modify dirty.txt",
              writes: ["dirty.txt"],
              after: [],
            },
          ],
        }),
        output: "",
        truncated: false,
        durationMs: 1,
        signal: null,
      },
      step: {
        id: "plan-route-1",
        kind: "planning",
        status: "completed",
        text: "",
        exitCode: 0,
        truncated: false,
      },
      report: null,
    }));
    await engine.planRoute(live3, f.root, proposal);
    expect(engine.worker).toHaveBeenCalledTimes(1);
    expect(
      (live3 as { planned?: { tasks: { id: string }[] } }).planned?.tasks.map(
        (t) => t.id,
      ),
    ).toEqual(["touch-dirty"]);

    // Case 4: git check-ignore runs against `integration` (not this.cwd) and fails
    // closed when git check-ignore exits with an error code (non-0, non-1).
    const nonGitDir = join(f.c.stateHome, "not-a-git-worktree");
    mkdirSync(nonGitDir, { recursive: true });
    const live4 = makeLive();
    engine.worker = vi.fn(async () => ({
      result: {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        text: JSON.stringify({
          tasks: [
            {
              id: "ok",
              title: "Ok",
              instructions: "Create c.txt",
              writes: ["c.txt"],
              after: [],
            },
          ],
        }),
        output: "",
        truncated: false,
        durationMs: 1,
        signal: null,
      },
      step: {
        id: "plan-route-1",
        kind: "planning",
        status: "completed",
        text: "",
        exitCode: 0,
        truncated: false,
      },
      report: null,
    }));
    await expect(
      engine.planRoute(live4, nonGitDir, proposal),
    ).rejects.toMatchObject({
      code: "unavailable",
      detail: expect.stringMatching(/git check-ignore/i),
    });
    expect(engine.worker).toHaveBeenCalledTimes(1);
  } finally {
    f.close();
  }
});

it("security hardening: auto-discovered links filter secret-bearing paths and decodeRoutePlan forbids .cadence/ writes and sanitizes readings", () => {
  const secret = "secret-workspace-token-99";
  const f = v5Fixture({
    ignoreFile: "node_modules/\n**/node_modules/\n",
    createNodeModules: true,
    secrets: [secret],
  });
  try {
    mkdirSync(join(f.root, secret, "node_modules", "dep"), { recursive: true });
    const p = plan();
    delete p.links;
    const r = f.workflows.command(randomUUID(), f.epoch, {
      action: "propose",
      plan: p,
      model: f.version,
    });
    if (r.kind !== "workflow" || r.response.type !== "proposal")
      throw Error("proposal");
    expect(r.response.proposal.plan.links).toEqual([
      { path: "node_modules", placement: "worktree" },
    ]);

    // decodeRoutePlan rejects .cadence/ in tasks[].writes.
    expect(() =>
      decodeRoutePlan(
        JSON.stringify({
          tasks: [
            {
              id: "bad-cadence",
              title: "Touch cadence",
              instructions: "Update project knowledge",
              writes: [".cadence/project.md"],
            },
          ],
        }),
      ),
    ).toThrow(/\.cadence\//);
    // decodeRoutePlan rejects a secret literal in reads[].path.
    expect(() =>
      decodeRoutePlan(
        JSON.stringify({
          tasks: [
            {
              id: "core",
              title: "Core",
              instructions: "Edit a.txt",
              writes: ["a.txt"],
              reads: [{ path: `${secret}/file.ts`, reason: "Inspect" }],
            },
          ],
        }),
        { secrets: [secret] },
      ),
    ).toThrow(/protected text/);

    // Prose around a submission is never salvaged: the cadence_route tool
    // serialized the text itself.
    expect(() =>
      decodeRoutePlan(
        `Here is the route:\n${JSON.stringify({ tasks: [{ id: "core", title: "Core", instructions: "Edit a.txt", writes: ["a.txt"] }] })}\nDone.`,
        { secrets: [secret] },
      ),
    ).toThrow(/JSON object/i);

    // Secret literals inside reads[].reason & reviewReads[].reason of the
    // submission are sanitized.
    const submitted = JSON.stringify({
      tasks: [
        {
          id: "core",
          title: "Core",
          instructions: "Edit a.txt",
          writes: ["a.txt"],
          reads: [
            {
              path: "AGENTS.md",
              section: `Sec ${secret}`,
              reason: `Avoid ${secret}`,
            },
          ],
        },
      ],
      reviewReads: [{ path: "AGENTS.md", reason: `Check ${secret}` }],
    });
    const decoded = decodeRoutePlan(submitted, { secrets: [secret] });
    expect(JSON.stringify(decoded)).not.toContain(secret);
    expect(decoded.reviewReads[0].reason).toContain("[redacted]");
  } finally {
    f.close();
  }
});
