// @module-tag slow
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type {
  WorkflowProposal,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowRun,
} from "../src/service/contracts/workflow.ts";
import { canonicalJson } from "../src/worker-public.mjs";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { plan } from "./helpers/workflow-plan.ts";

afterEach(() => vi.unstubAllEnvs());
async function setup(
  initializeGit = true,
  mode: "source" | "generated" = "generated",
) {
  const f = await acceptingFixture(
    mode,
    mode === "source"
      ? (env) => {
          for (const [key, value] of Object.entries(env))
            vi.stubEnv(key, value);
        }
      : undefined,
  );
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: f.root,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      });
    if (initializeGit) {
      git("init", "-q");
      git("config", "user.name", "Cadence fixture");
      git("config", "user.email", "fixture@example.invalid");
      git("add", ".");
      git("commit", "-qm", "Fixture baseline");
    }
    const bootstrap = await f.client.session();
    if (bootstrap.kind !== "ok") throw Error("session");
    const catalog = await f.client.models();
    if (catalog.kind !== "ok") throw Error("catalog");
    const choice = await f.client.chooseModel({
      expected: catalog.value.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
    if (choice.kind !== "ok") throw Error(`choice: ${JSON.stringify(choice)}`);
    const command = async (
      request: WorkflowRequest,
      commandId = randomUUID(),
    ): Promise<WorkflowResponse> => {
      const r = await f.client.workbenchCommand({
        kind: "workflow",
        commandId,
        epoch: bootstrap.value.epoch,
        request,
      });
      if (r.kind !== "ok" || r.value.kind !== "workflow")
        throw Error(JSON.stringify(r));
      return r.value.response;
    };
    const propose = async (definition = plan()): Promise<WorkflowProposal> => {
      const p = await command({
        action: "propose",
        plan: definition,
        model: choice.value.version,
      });
      if (p.type !== "proposal") throw Error("proposal");
      return p.proposal;
    };
    const start = async (p: WorkflowProposal) => {
      const grant = await command({
        action: "prepare",
        proposalId: p.id,
        digest: p.digest,
      });
      if (grant.type !== "grant") throw Error("grant");
      const r = await command({
        action: "execute",
        proposalId: p.id,
        digest: p.digest,
        grant: grant.grant,
      });
      if (r.type !== "run") throw Error("run");
      return r.run.id;
    };
    const wait = async (id: string): Promise<WorkflowRun> => {
      const deadline = Date.now() + 20000;
      while (Date.now() < deadline) {
        const r = await f.client.workbenchRead({ kind: "workflow", id });
        if (
          r.kind !== "ok" ||
          r.value.kind !== "workflow" ||
          r.value.response.type !== "run"
        )
          throw Error(JSON.stringify(r));
        const run = r.value.response.run;
        if (!["running", "queued"].includes(run.status)) return run;
        // Observe actual settlement without a 30 Hz full-snapshot read load
        // competing with real owners' journal I/O. Keep the original deadline.
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw Error("Workflow did not settle within its test budget");
    };
    return {
      f,
      git,
      worktrees: join(
        f.c.stateHome,
        "cadence-worktrees-v1",
        basename(f.c.store.privateRoot),
      ),
      command,
      propose,
      start,
      wait,
      model: choice.value.version,
    };
  } catch (error) {
    await f.close();
    throw error;
  }
}
it("workflow output redacts owner and provider literals before retention and defensively on legacy reads", async () => {
  const { f, command, model, wait } = await setup(false);
  try {
    const ownerSecret = f.c.localAccess().capability;
    const providerSecret = "fabricated-accepting-key";
    // The native preview boundary would otherwise retain all but the last
    // character of the owner literal, making a subsequent full-match redactor fail.
    f.reply(
      `${"x".repeat(16384 - ownerSecret.length + 1)}${ownerSecret} ${providerSecret}`,
    );
    const accepted = await command({
      action: "research",
      goal: "Inspect readonly token: string handling",
      questions: ["Report evidence about the Authorization: Bearer header"],
      model,
    });
    if (accepted.type !== "run") throw Error("run");
    // Credential-looking text is redacted, not a reason to refuse the request.
    expect(accepted.run.goal).toBe(
      "Inspect readonly token: [redacted] handling",
    );
    const run = await wait(accepted.run.id);
    expect(run.status).toBe("completed");
    expect(run.steps).toHaveLength(1);
    const step = run.steps[0];
    const path = join(
      f.c.directory,
      "workflows-v1",
      "runs",
      run.id,
      "results",
      `${createHash("sha256").update(step.id).digest("hex")}.json`,
    );
    const saved = readFileSync(path, "utf8");
    for (const value of [saved, JSON.stringify(run)]) {
      expect(value).not.toContain(ownerSecret);
      expect(value).not.toContain(ownerSecret.slice(0, -1));
      expect(value).not.toContain(providerSecret);
    }
    expect(saved).toContain("[redacted]");
    const detail = await f.client.workbenchRead({
      kind: "workflow-detail",
      id: run.id,
      stepId: step.id,
    });
    expect(detail.kind).toBe("ok");
    expect(JSON.stringify(detail)).not.toContain(ownerSecret);
    // Pre-fix retained records are filtered on read, not rewritten/migrated.
    const legacy = JSON.parse(saved);
    legacy.result.text = `Legacy result: ${ownerSecret}`;
    legacy.result.output = `Quoted: "${ownerSecret}"; ${providerSecret}`;
    const legacyBytes = JSON.stringify(legacy);
    writeFileSync(path, legacyBytes);
    const retained = await f.client.workbenchRead({
      kind: "workflow-detail",
      id: run.id,
      stepId: step.id,
    });
    expect(retained.kind).toBe("ok");
    expect(JSON.stringify(retained)).not.toContain(ownerSecret);
    expect(JSON.stringify(retained)).not.toContain(providerSecret);
    expect(JSON.stringify(retained)).toContain("[redacted]");
    expect(readFileSync(path, "utf8")).toBe(legacyBytes);
    // Transcript reads apply the same read-time filter to retained records.
    const transcriptPath = join(
      f.c.directory,
      "workflows-v1",
      "runs",
      run.id,
      "transcripts",
      `${step.childRunId}.json`,
    );
    const transcript = JSON.parse(readFileSync(transcriptPath, "utf8"));
    transcript.items[0].text = `Legacy transcript: ${ownerSecret}`;
    const transcriptBytes = canonicalJson(transcript, 384 * 1024);
    writeFileSync(transcriptPath, transcriptBytes);
    const read = await f.client.workbenchRead({
      kind: "workflow-transcript",
      id: run.id,
      stepId: step.id,
    });
    expect(read.kind, JSON.stringify(read).slice(0, 400)).toBe("ok");
    expect(JSON.stringify(read)).not.toContain(ownerSecret);
    expect(JSON.stringify(read)).toContain("Legacy transcript: [redacted]");
    expect(readFileSync(transcriptPath, "utf8")).toBe(transcriptBytes);
  } finally {
    await f.close();
  }
}, 30000);

it("real generated owner: task IDs cannot collide with the stable candidate; sequential workers merge while preserving dirt", async () => {
  const { f, git, propose, start, wait, worktrees } = await setup();
  try {
    writeFileSync(join(f.root, "unrelated.txt"), "user-owned bytes\n");
    // Tracked but dirty project context: delivered after the fast-forward
    // around the user's uncommitted text, never silently dropped.
    writeFileSync(join(f.root, ".cadence/project.md"), "# Team notes\n");
    git("add", ".cadence/project.md");
    git("commit", "-qm", "Team notes");
    writeFileSync(
      join(f.root, ".cadence/project.md"),
      "# Team notes\nUncommitted user line.\n",
    );
    f.mode("workflow");
    const definition = plan();
    definition.tasks[0].id = "integration";
    definition.tasks[1].id = "tasks";
    definition.design += " Add a token: string field.";
    const p = await propose(definition);
    // The approved plan is the displayed, redacted one; nothing was refused.
    expect(p.plan.design).toContain("token: [redacted] field");
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
    const run = await wait(await start(p));
    expect(run, JSON.stringify(run)).toMatchObject({
      status: "completed",
      humanReviewed: false,
    });
    expect(f.maxActive()).toBe(1);
    // Worktrees lived outside the private namespace and were removed by plain
    // `git worktree remove` once merged and clean.
    const operations = run.steps.filter((s) => s.kind === "git");
    for (const name of [
      "worktree-integration",
      "commit-candidate",
      "merge",
      "remove-merged-worktree",
    ])
      expect(
        operations.some(
          (s) => s.id.startsWith(`${name}-`) && s.status === "completed",
        ),
        name,
      ).toBe(true);
    expect(existsSync(join(worktrees, run.id))).toBe(false);
    expect(
      git("worktree", "list", "--porcelain").match(/^worktree /gmu),
    ).toHaveLength(1);
    expect(run.notice).toContain("Changed files:");
    expect(run.notice).toContain("a.txt, b.txt");
    expect(
      readFileSync(
        join(f.root, ".cadence/assistant/workflows", run.id, "result.md"),
        "utf8",
      ),
    ).toMatch(
      /^# Workflow delivery notes\n\nWritten before final candidate checks/u,
    );
    expect(
      run.steps.some(
        (s) =>
          s.kind === "review" && s.text.startsWith("Agent review approved"),
      ),
    ).toBe(true);
    expect(run.mergedCommit).toBe(git("rev-parse", "HEAD").trim());
    expect(run.delivery?.taskBranch).toMatch(/^refs\/heads\/cadence\//u);
    expect(run.delivery?.acceptance?.candidate).toBe(run.mergedCommit);
    expect(run.delivery?.integration.status).toBe("applied");
    expect(run.delivery?.postChecks).toBe("passed");
    expect(git("rev-parse", run.delivery?.taskBranch ?? "missing").trim()).toBe(
      run.mergedCommit,
    );

    expect(readFileSync(join(f.root, "a.txt"), "utf8")).toBe(
      "implemented a.txt\n",
    );
    expect(readFileSync(join(f.root, "b.txt"), "utf8")).toBe(
      "implemented b.txt\n",
    );
    expect(readFileSync(join(f.root, "unrelated.txt"), "utf8")).toBe(
      "user-owned bytes\n",
    );
    expect(git("status", "--porcelain")).toContain("?? unrelated.txt");
    expect(
      run.steps
        .filter((s) => s.kind === "check")
        .every((s) => s.exitCode === 0),
    ).toBe(true);
    const context = readFileSync(join(f.root, ".cadence/project.md"), "utf8");
    expect(context).toContain("Uncommitted user line.");
    expect(context).toBe("# Team notes\nUncommitted user line.\n");
    // An interrupted run never fences startup: it settles honestly as unknown.
    const interrupted = randomUUID();
    f.c.files.create(
      join(f.c.directory, "workflows-v1", "runs", interrupted, "state.json"),
      canonicalJson({
        ...run,
        id: interrupted,
        status: "running",
        phase: "integrating",
        mergedCommit: null,
        notice: "",
        steps: [{ ...run.steps[0], status: "running" }],
      }),
      384 * 1024,
    );
    const restarted = await f.restart();
    const retained = await restarted.client.workbenchRead({
      kind: "workflow",
      id: run.id,
    });
    expect(retained).toMatchObject({
      kind: "ok",
      value: { response: { run: { status: "completed" } } },
    });
    const recovered = await restarted.client.workbenchRead({
      kind: "workflow",
      id: interrupted,
    });
    if (
      recovered.kind !== "ok" ||
      recovered.value.kind !== "workflow" ||
      recovered.value.response.type !== "run"
    )
      throw Error(JSON.stringify(recovered));
    expect(recovered.value.response.run).toMatchObject({
      status: "unknown",
      phase: "finished",
      mergedCommit: null,
    });
    expect(recovered.value.response.run.notice).toContain("Interrupted");
    expect(recovered.value.response.run.notice).toContain(
      "fast-forward may have completed",
    );
    expect(recovered.value.response.run.steps[0].status).toBe("unknown");
  } finally {
    await f.close();
  }
}, 30000);
it("stale plans refuse before effects; generated research remains readonly and Cancel joins its real children", async () => {
  const { f, command, propose, start, wait, model } = await setup();
  try {
    const p = await propose();
    writeFileSync(join(f.root, "a.txt"), "user change");
    await expect(start(p)).rejects.toThrow();
    expect(f.contacts()).toBe(0);
    f.mode("pending");
    const r = await command({
      action: "research",
      goal: "Investigate",
      questions: ["Read existing.txt"],
      model,
    });
    if (r.type !== "run") throw Error("run");
    const deadline = Date.now() + 5000;
    while (!f.held() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 20));
    expect(f.held()).toBe(1);
    await command({ action: "cancel", runId: r.run.id });
    const stopped = await wait(r.run.id);
    expect(stopped.status).toBe("canceled");
    expect(f.observations[0].tools).not.toContain("write");
    expect(f.observations[0].tools).not.toContain("bash");
    expect(readFileSync(join(f.root, "a.txt"), "utf8")).toBe("user change");
    // A second approved plan is refused up front instead of queueing to go stale.
    const other = (writes: string) => {
      const definition = plan();
      definition.tasks = [{ ...definition.tasks[0], writes: [writes] }];
      return definition;
    };
    const first = await propose(other("c.txt"));
    const second = await propose(other("d.txt"));
    const running = await start(first);
    const grant = await command({
      action: "prepare",
      proposalId: second.id,
      digest: second.digest,
    });
    if (grant.type !== "grant") throw Error("grant");
    await expect(
      command({
        action: "execute",
        proposalId: second.id,
        digest: second.digest,
        grant: grant.grant,
      }),
    ).rejects.toThrow("conflict");
    await command({ action: "cancel", runId: running });
    expect((await wait(running)).status).toBe("canceled");
  } finally {
    await f.close();
  }
}, 20000);

it("failed verification reaches readonly diagnosis and never merges a genuinely blocked candidate", async () => {
  const { f, command, start, wait, model, git } = await setup();
  try {
    f.mode("workflow");
    const baseline = git("rev-parse", "HEAD");
    const p = plan();
    p.checks = [
      {
        name: "real failure",
        command:
          "node -e \"console.error('fixture-check-diagnostic');process.exit(1)\"",
        timeoutMs: 3000,
      },
    ];
    const proposed = await command({ action: "propose", plan: p, model });
    if (proposed.type !== "proposal") throw Error("proposal");
    const run = await wait(await start(proposed.proposal));
    expect(run.status).toBe("failed");
    expect(run.notice).toContain("Delivery blocked");
    expect(run.steps.filter((s) => s.kind === "diagnosis")).toHaveLength(1);
    expect(
      run.steps
        .filter((s) => s.kind === "check")
        .every((s) => s.exitCode === 1),
    ).toBe(true);
    expect(run.mergedCommit).toBeNull();
    expect(git("rev-parse", "HEAD")).toBe(baseline);
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
    const reviews = run.steps.filter((s) => s.kind === "review");
    expect(reviews).toHaveLength(1);
    for (const review of reviews) {
      const previous = run.steps[run.steps.indexOf(review) - 1];
      expect(previous).toMatchObject({ kind: "check", exitCode: 1 });
      const prompt = f.observations
        .map((o) => JSON.stringify(o.messages))
        .find(
          (text) =>
            text.includes("Independently inspect the implemented files") &&
            text.includes(previous.id),
        );
      expect(prompt).toContain("fixture-check-diagnostic");
      expect(prompt).toContain("Current-round check evidence");
    }
    const repair = f.observations
      .map((o) => JSON.stringify(o.messages))
      .find((text) => text.includes("Diagnose this settled attempt"));
    expect(repair).toContain("fixture-check-diagnostic");
    expect(repair).toContain(reviews[0].id);
    expect(repair).toContain("Approved paths");
    // Each working-copy assignment owns its own scope, not the union: the
    // first worker writes b.txt, which only the second assignment may write.
    const direct = plan();
    direct.delivery = "working-copy";
    direct.tasks = [{ ...direct.tasks[0], writes: ["c.txt"] }, direct.tasks[1]];
    const scoped = await command({ action: "propose", plan: direct, model });
    if (scoped.type !== "proposal") throw Error("proposal");
    const outside = await wait(await start(scoped.proposal));
    expect(outside.status).toBe("failed");
    expect(outside.notice).toContain("outside the approved scope");
    expect(outside.notice).toContain("b.txt");
    expect(readFileSync(join(f.root, "b.txt"), "utf8")).toBe(
      "implemented b.txt\n",
    );
  } finally {
    await f.close();
  }
}, 30000);
it("explicit working-copy delivery works without Git and never initializes or commits a repository", async () => {
  const { f, command, start, wait, model } = await setup(false);
  try {
    f.mode("workflow");
    const p = plan();
    p.delivery = "working-copy";
    p.tasks[1].after = ["a"];
    p.setup = [
      {
        name: "setup once",
        command:
          "node -e \"require('fs').writeFileSync('setup-once','done',{flag:'wx'})\"",
        timeoutMs: 3000,
      },
    ];
    p.baselineChecks = [
      {
        name: "pre-implementation only",
        command:
          "node -e \"if(require('fs').existsSync('a.txt'))process.exit(1);console.log('BASELINE_ONLY')\"",
        timeoutMs: 3000,
      },
    ];
    p.checks[0].command += " && node -e \"console.log('CURRENT_CHECK_OK')\"";
    const proposed = await command({ action: "propose", plan: p, model });
    if (proposed.type !== "proposal") throw Error("proposal");
    const run = await wait(await start(proposed.proposal));
    expect(run, JSON.stringify(run)).toMatchObject({
      status: "completed",
      mergedCommit: null,
      humanReviewed: false,
    });
    expect(existsSync(join(f.root, ".git"))).toBe(false);
    expect(readFileSync(join(f.root, "a.txt"), "utf8")).toBe(
      "implemented a.txt\n",
    );
    const prompts = f.observations.map((o) => JSON.stringify(o.messages));
    const second = prompts.find((text) =>
      text.includes("Execute the remaining work for assignment b:"),
    );
    expect(second).toContain("Predecessor assignments already applied here: a");
    expect(second).toContain("Do not rerun initial cleanliness preconditions");
    const review = prompts.find((text) =>
      text.includes("Independently inspect the implemented files"),
    );
    expect(review).toContain("CURRENT_CHECK_OK");
    expect(review).not.toContain("BASELINE_ONLY");
    const index = run.steps.findIndex((s) => s.kind === "review");
    expect(run.steps[index - 1]).toMatchObject({ kind: "check", exitCode: 0 });
    expect(run.steps.filter((s) => s.id.startsWith("setup:"))).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 30000);

it("passing checks with an unparseable review invoke diagnosis without claiming delivery", async () => {
  const { f, command, start, wait, model } = await setup(false);
  try {
    f.mode("workflow");
    f.reply("Not a structured review verdict.");
    const definition = plan();
    definition.delivery = "working-copy";
    const proposed = await command({
      action: "propose",
      plan: definition,
      model,
    });
    if (proposed.type !== "proposal") throw Error("proposal");
    const run = await wait(await start(proposed.proposal));
    expect(run.status).toBe("failed");
    expect(run.notice).toContain("Delivery blocked");
    expect(run.steps.some((s) => s.kind === "diagnosis")).toBe(true);
    expect(run.steps.filter((s) => s.id.startsWith("repair-"))).toHaveLength(0);
    expect(run.steps.find((s) => s.kind === "review")).toMatchObject({
      status: "failed",
      exitCode: 0,
    });
    expect(
      run.steps
        .filter((s) => s.kind === "check")
        .every((s) => s.exitCode === 0),
    ).toBe(true);
    expect(readFileSync(join(f.root, "a.txt"), "utf8")).toBe(
      "implemented a.txt\n",
    );
    expect(run.mergedCommit).toBeNull();
    expect(
      existsSync(join(f.root, ".cadence/assistant/workflows", run.id)),
    ).toBe(false);
  } finally {
    await f.close();
  }
}, 20000);

it.each([
  ["blocked", "working-copy"],
  ["unparseable", "working-copy"],
  ["blocked", "local-merge"],
  ["unparseable", "local-merge"],
] as const)(
  "a zero-exit %s implementation in %s is diagnosed before dependents, checks, review or delivery, preserving native facts",
  async (report, delivery) => {
    const { f, propose, start, wait, git, worktrees } = await setup();
    try {
      f.mode("workflow");
      f.implementationReply(
        report === "blocked"
          ? '{"status":"blocked","summary":"Required build not performed"}'
          : "I stopped without completing the assignment.",
      );
      const baseline = git("rev-parse", "HEAD");
      const definition = plan();
      definition.delivery = delivery;
      definition.tasks[1].after = ["a"];
      const run = await wait(await start(await propose(definition)));
      expect(run.status).toBe("failed");
      expect(run.steps.filter((s) => s.kind !== "git")).toHaveLength(2);
      const step = run.steps.find((s) => s.kind === "implementation")!;
      expect(step).toMatchObject({
        kind: "implementation",
        status: "failed",
        exitCode: 0,
      });
      expect(step.text).toContain(
        report === "blocked"
          ? "Assignment blocked"
          : "structured completion report",
      );
      const edited =
        delivery === "working-copy"
          ? f.root
          : join(worktrees, run.id, "integration");
      expect(readFileSync(join(edited, "a.txt"), "utf8")).toBe(
        "implemented a.txt\n",
      );
      expect(existsSync(join(edited, "b.txt"))).toBe(false);
      if (delivery === "local-merge")
        expect(existsSync(join(f.root, "a.txt"))).toBe(false);
      expect(git("rev-parse", "HEAD")).toBe(baseline);
      expect(
        existsSync(join(f.root, ".cadence/assistant/workflows", run.id)),
      ).toBe(false);
      const result = JSON.parse(
        readFileSync(
          join(
            f.c.directory,
            "workflows-v1",
            "runs",
            run.id,
            "results",
            `${createHash("sha256").update(step.id).digest("hex")}.json`,
          ),
          "utf8",
        ),
      ).result;
      expect(result).toMatchObject({
        outcome: "completed",
        closed: true,
        exitCode: 0,
      });
      // The raw report is retained, not rewritten as a native process failure.
      expect(result.text).toContain(
        report === "blocked" ? '"status":"blocked"' : "I stopped",
      );
    } finally {
      await f.close();
    }
  },
  20000,
);

it("a real worker's first blocked report is recovered without another user Send or approval", async () => {
  const { f, propose, start, wait } = await setup(false);
  try {
    f.mode("workflow");
    f.implementationReply(
      '{"status":"blocked","summary":"Partial output remains"}',
    );
    f.recoverImplementation();
    const definition = plan();
    definition.delivery = "working-copy";
    const run = await wait(await start(await propose(definition)));
    expect(run.status).toBe("completed");
    expect(run.revision).toBe(1);
    expect(run.steps.filter((s) => s.kind === "diagnosis")).toHaveLength(1);
    expect(
      run.steps.some(
        (s) => s.kind === "implementation" && s.status === "failed",
      ),
    ).toBe(true);
    expect(readFileSync(join(f.root, "a.txt"), "utf8")).toBe(
      "implemented a.txt\n",
    );
    expect(readFileSync(join(f.root, "b.txt"), "utf8")).toBe(
      "implemented b.txt\n",
    );
  } finally {
    await f.close();
  }
}, 20000);

it.each([
  ["plain", "'x'.repeat(90000)", false],
  ["quoted-150k", "String.fromCharCode(34).repeat(150000)", true],
  ["quoted-200k", "String.fromCharCode(34).repeat(200000)", true],
] as const)(
  "workflow %s check output fits records and detail replies, retaining native facts and diagnostic tails",
  async (_name, output, truncated) => {
    const { f, propose, start, wait } = await setup(false);
    try {
      f.mode("workflow");
      const definition = plan();
      definition.delivery = "working-copy";
      definition.goal = "Retain diagnostics for one implemented output";
      definition.design = "Implement a.txt and run the declared check.";
      definition.acceptance =
        "a.txt is implemented and the declared check passes.";
      definition.tasks = [definition.tasks[0]];
      definition.checks = [
        {
          name: "long diagnostic",
          command: `node -e "console.log(${output}+'IMPORTANT_FAILURE_TAIL');process.exitCode=1"`,
          timeoutMs: 3000,
        },
      ];
      const run = await wait(await start(await propose(definition)));
      expect(run.status).toBe("failed");
      const step = run.steps.find((s) => s.kind === "check")!;
      const result = JSON.parse(
        readFileSync(
          join(
            f.c.directory,
            "workflows-v1",
            "runs",
            run.id,
            "results",
            `${createHash("sha256").update(step.id).digest("hex")}.json`,
          ),
          "utf8",
        ),
      ).result;
      expect(result).toMatchObject({
        exitCode: 1,
        closed: true,
        truncated,
      });
      const detail = await f.client.workbenchRead({
        kind: "workflow-detail",
        id: run.id,
        stepId: step.id,
      });
      expect(detail).toMatchObject({
        kind: "ok",
        value: { kind: "file", limited: truncated },
      });
      if (detail.kind !== "ok" || detail.value.kind !== "file")
        throw Error("detail unavailable");
      expect(JSON.parse(detail.value.text).result).toMatchObject({
        exitCode: 1,
        closed: true,
        truncated,
      });
      expect(result.output).toContain("IMPORTANT_FAILURE_TAIL");
      expect(Buffer.byteLength(result.output)).toBeGreaterThan(65536);
      const review = f.observations
        .map((o) => JSON.stringify(o.messages))
        .find((p) => p.includes("Independently inspect the implemented files"));
      expect(review).toContain("IMPORTANT_FAILURE_TAIL");
      expect(review).toContain("[excerpt: middle omitted]");
    } finally {
      await f.close();
    }
  },
  20000,
);

it("a structured completion report containing credential-shaped text survives redaction and remains machine-readable", async () => {
  const { f, propose, start, wait } = await setup(false);
  try {
    f.mode("workflow");
    f.implementationReply(
      JSON.stringify({
        status: "completed",
        summary: "Implemented token: string",
      }),
    );
    const definition = plan();
    definition.delivery = "working-copy";
    definition.goal = "One output with a structured completion report";
    definition.design =
      "Implement a.txt, retaining an accurately redacted report.";
    definition.acceptance = "a.txt contains its expected text.";
    definition.tasks = [definition.tasks[0]];
    definition.checks[0].command =
      "node -e \"if(require('fs').readFileSync('a.txt','utf8')!=='implemented a.txt\\n')process.exit(1)\"";
    const run = await wait(await start(await propose(definition)));
    expect(run.status, JSON.stringify(run)).toBe("completed");
    for (const step of run.steps.filter((s) => s.kind === "implementation")) {
      expect(step).toMatchObject({ status: "completed", exitCode: 0 });
      const detail = await f.client.workbenchRead({
        kind: "workflow-detail",
        id: run.id,
        stepId: step.id,
      });
      if (detail.kind !== "ok" || detail.value.kind !== "file")
        throw Error("detail");
      const report = JSON.parse(JSON.parse(detail.value.text).result.text);
      expect(report).toEqual({
        status: "completed",
        summary: "Implemented token: [redacted]",
      });
    }
  } finally {
    await f.close();
  }
}, 20000);

it("a baseline command cannot hide out-of-scope changes by committing them in the candidate", async () => {
  const { f, git, command, start, wait, model, worktrees } = await setup();
  try {
    writeFileSync(
      join(f.root, "rogue-check.cjs"),
      `const fs=require("node:fs"),{execFileSync}=require("node:child_process");fs.writeFileSync("out-of-scope.txt","unapproved");execFileSync("git",["add","out-of-scope.txt"]);execFileSync("git",["-c","core.hooksPath=unused-hooks","-c","commit.gpgsign=false","commit","-qm","unexpected check commit"]);`,
    );
    git("add", "rogue-check.cjs");
    git("commit", "-qm", "fixture check");
    const head = git("rev-parse", "HEAD");
    const definition = plan();
    definition.baselineChecks = [
      {
        name: "misbehaving baseline",
        command: "node rogue-check.cjs",
        timeoutMs: 3000,
      },
    ];
    const proposed = await command({
      action: "propose",
      plan: definition,
      model,
    });
    if (proposed.type !== "proposal") throw Error("proposal");
    const run = await wait(await start(proposed.proposal));
    expect(run.status).toBe("failed");
    expect(run.mergedCommit).toBeNull();
    expect(f.contacts()).toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(head);
    expect(existsSync(join(f.root, "out-of-scope.txt"))).toBe(false);
    // Failed runs retain their worktrees for inspection.
    const candidate = join(worktrees, run.id, "integration");
    expect(readFileSync(join(candidate, "out-of-scope.txt"), "utf8")).toBe(
      "unapproved",
    );
  } finally {
    await f.close();
  }
}, 20000);

it("readonly workflow history crosses 200 runs in bounded pages without stopping new work or repairing records", async () => {
  const { f, command, wait, model } = await setup(false);
  try {
    const before = f.contacts();
    const root = join(f.c.directory, "workflows-v1", "runs");
    const ids = Array.from(
      { length: 221 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    );
    const bodies = ids.map((id, i) => {
      const dir = join(root, id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const body =
        i === 5
          ? "{torn"
          : JSON.stringify({
              id,
              epoch: randomUUID(),
              goal: `Recorded ${i}`,
              status: "failed",
              phase: "finished",
              steps: [],
              notice: "Retained fixture",
              mergedCommit: null,
              humanReviewed: false,
            });
      writeFileSync(join(dir, "state.json"), body, { mode: 0o600 });
      return body;
    });
    let progressReads = 0;
    const read = async (after: string | null) => {
      let scan: string | undefined;
      for (let quantum = 0; quantum < 3; quantum++) {
        const reply = await f.client.workbenchRead({
          kind: "workflow-history",
          after,
          ...(scan ? { scan } : {}),
        });
        if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
        if (reply.value.kind === "workflow-history-progress") {
          expect(reply.value.after).toBe(after);
          scan = reply.value.scan;
          progressReads++;
        } else if (reply.value.kind === "workflow-history") return reply.value;
        else throw Error(JSON.stringify(reply));
      }
      throw Error("Fixture scan made no bounded progress");
    };
    const first = await read(null);
    expect(first.entries.map((e) => e.id)).toEqual(ids.slice(0, 20));
    expect(first.entries[5]).toEqual({ id: ids[5], run: null });
    expect(first.next).toBe(ids[19]);
    const seen = [...first.entries.map((e) => e.id)];
    let next = first.next;
    while (next) {
      const page = await read(next);
      seen.push(...page.entries.map((e) => e.id));
      next = page.next;
    }
    expect(seen).toEqual(ids);
    expect(progressReads).toBeGreaterThan(0);
    for (let i = 0; i < ids.length; i++)
      expect(readFileSync(join(root, ids[i], "state.json"), "utf8")).toBe(
        bodies[i],
      );
    expect(f.contacts()).toBe(before);
    const started = await command({
      action: "research",
      model,
      goal: "New work after 221 retained runs",
      questions: ["Read only"],
    });
    if (started.type !== "run") throw Error("expected new run");
    expect((await wait(started.run.id)).status).toBe("completed");
    writeFileSync(join(root, "unexpected"), "preserve", { mode: 0o600 });
    await expect(read(null)).rejects.toThrow("corrupt-selected");
    expect(readFileSync(join(root, "unexpected"), "utf8")).toBe("preserve");
  } finally {
    await f.close();
  }
}, 20000);

it("workspace labels redact owner access material without selecting a model or contacting a provider", async () => {
  const accessToken = "fabricated-owner-token-in-project-path-0123456789";
  const f = await acceptingFixture("generated", undefined, null, {
    rootName: accessToken,
    accessToken,
  });
  try {
    expect(f.root).toContain(accessToken);
    expect((await f.client.session()).kind).toBe("ok");
    const workspace = await f.client.workspace();
    expect(workspace.kind).toBe("ok");
    if (workspace.kind !== "ok") throw Error(workspace.error.code);
    expect(JSON.stringify(workspace)).not.toContain(accessToken);
    expect(workspace.value.rootLabel).toContain("[redacted]");
    const models = await f.client.models();
    expect(models.kind === "ok" && models.value.selected).toBeNull();
    expect(f.contacts()).toBe(0);
  } finally {
    await f.close();
  }
}, 20000);

it("generated research reports real queue, spawn, closure and runtime observations independently of client batching", async () => {
  const { f, command, wait, model } = await setup(false);
  try {
    f.mode("pending");
    const first = await command({
      action: "research",
      goal: "Hold checkout",
      questions: ["a", "b"],
      model,
    });
    if (first.type !== "run") throw Error("run");
    await vi.waitFor(() => expect(f.held()).toBe(2), { timeout: 5000 });
    const second = await command({
      action: "research",
      goal: "Queued",
      questions: ["c"],
      model,
      roots: [f.root],
    });
    if (second.type !== "run") throw Error("run");
    const queued = await f.client.workbenchRead({
      kind: "workflow",
      id: second.run.id,
    });
    expect(queued).toMatchObject({
      kind: "ok",
      value: {
        response: {
          run: {
            status: "queued",
            steps: [],
            diagnostics: { acquiredAt: null },
          },
        },
      },
    });
    // Releasing the first original is necessary before the second may contact its provider.
    f.mode("single");
    await command({ action: "cancel", runId: first.run.id });
    const a = await wait(first.run.id),
      b = await wait(second.run.id);
    expect(a.status).toBe("canceled");
    expect(b.status).toBe("completed");
    expect(b.diagnostics!.acquiredAt!).toBeGreaterThanOrEqual(
      a.diagnostics!.settledAt!,
    );
    expect(b.diagnostics!.owner).toMatchObject({
      version: JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      ).version,
      platform: process.platform,
    });
    expect(b.diagnostics!.owner.build).toMatch(/^[a-f0-9]{64}$/);
    expect(b.diagnostics!.owner.entry).toMatch(/service-host\.mjs$/);
    for (const run of [a, b])
      for (const step of run.steps) {
        const t = step.timing!;
        expect(t.createdAt).toBeGreaterThanOrEqual(
          run.diagnostics!.acquiredAt!,
        );
        expect(t.preparedAt!).toBeGreaterThanOrEqual(t.createdAt);
        expect(t.startedAt!).toBeGreaterThanOrEqual(t.preparedAt!);
        expect(t.closedAt!).toBeGreaterThanOrEqual(t.startedAt!);
        expect(t.settledAt!).toBeGreaterThanOrEqual(t.closedAt!);
        expect(step.runtime!.sdkVersion).toBeTruthy();
        expect(step.runtime!.workerHash).toBe(
          createHash("sha256")
            .update(
              readFileSync(new URL("../src/sdk-worker.mjs", import.meta.url)),
            )
            .digest("hex"),
        );
      }
    expect(a.steps.every((s) => s.timing!.stopReason === "canceled")).toBe(
      true,
    );
    expect(b.steps[0].timing!.stopRequestedAt).toBeNull();
  } finally {
    await f.close();
  }
}, 20000);

it("timed-out real workers retain exact step results and transcripts after a later run and owner restart", async () => {
  const { f, command, wait, model } = await setup(false, "source");
  try {
    f.mode("pending");
    const accepted = await command({
      action: "research",
      goal: "Actual timeout",
      questions: ["q1", "q2"],
      model,
    });
    if (accepted.type !== "run") throw Error("run");
    const run = await wait(accepted.run.id);
    expect(run.status).toBe("timeout");
    expect(run.steps).toHaveLength(2);
    for (const step of run.steps) {
      expect(step.status).toBe("timeout");
      expect(step.timing!.stopReason).toBe("timeout");
      expect(step.text).toContain("total process deadline 15000ms");
      expect(step.text).toContain("not evidence of a surviving process");
    }
    f.mode("single");
    const next = await command({
      action: "research",
      goal: "Later",
      questions: ["q"],
      model,
    });
    if (next.type !== "run") throw Error("run");
    expect((await wait(next.run.id)).status).toBe("completed");
    const restarted = await f.restart();
    for (const step of run.steps) {
      const result = await restarted.client.workbenchRead({
        kind: "workflow-detail",
        id: run.id,
        stepId: step.id,
      });
      expect(result, JSON.stringify(result)).toMatchObject({
        kind: "ok",
        value: { kind: "file", limited: false },
      });
      expect(JSON.stringify(result)).toContain("timeout");
      const transcript = await restarted.client.workbenchRead({
        kind: "workflow-transcript",
        id: run.id,
        stepId: step.id,
      });
      expect(transcript).toMatchObject({
        kind: "ok",
        value: { runId: run.id, stepId: step.id, turn: { status: "timeout" } },
      });
    }
  } finally {
    await f.close();
  }
}, 30000);

it("real SDK research uses the explicitly selected root and retains partial scan evidence", async () => {
  const { f, command, wait, model } = await setup(false);
  try {
    const selected = join(f.dir, "selected-backups");
    mkdirSync(selected);
    writeFileSync(join(selected, "a.txt"), "a");
    writeFileSync(join(selected, "b.txt"), "b");
    f.mode("research-scan");
    const accepted = await command({
      action: "research",
      goal: "Inspect the selected backup tree",
      questions: ["Find text backups"],
      roots: [selected],
      model,
    });
    if (accepted.type !== "run") throw Error("run");
    const run = await wait(accepted.run.id);
    expect(run.status).toBe("completed");
    expect(run.steps[0].text).toContain('"state":"more"');
    expect(run.steps[0].text).toContain('"complete":false');
    expect(run.steps[0].text).toContain('"nextCursor":');
    expect(run.steps[0].text).not.toContain("existing.txt");
    expect(
      f.observations.every(
        (r) => !r.tools.includes("bash") && !r.tools.includes("write"),
      ),
    ).toBe(true);
    const transcript = await f.client.workbenchRead({
      kind: "workflow-transcript",
      id: run.id,
      stepId: run.steps[0].id,
    });
    if (
      transcript.kind !== "ok" ||
      transcript.value.kind !== "workflow-transcript"
    )
      throw Error("transcript");
    const tool = transcript.value.turn?.items.find(
      (item) => item.name === "find",
    );
    expect(tool?.error).toBe(false);
    const result = JSON.parse(tool!.text);
    const observation = JSON.parse(result.content[0].text);
    expect(observation.state).toBe("more");
    expect(observation.coverage.complete).toBe(false);
    expect(observation.nextCursor).toEqual(expect.any(String));
    expect(observation.items).toHaveLength(1);
  } finally {
    await f.close();
  }
}, 20000);
