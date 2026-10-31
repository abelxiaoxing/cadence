import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type {
  WorkflowProposal,
  WorkflowRequest,
  WorkflowResponse,
  WorkflowRun,
} from "../src/service/contracts/workflow.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { plan } from "./helpers/workflow-plan.ts";

async function setup(initializeGit = true) {
  const f = await acceptingFixture("generated");
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
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      throw Error("Workflow did not settle within its test budget");
    };
    return {
      f,
      git,
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
      goal: "Inspect readonly",
      questions: ["Report evidence"],
      model,
    });
    if (accepted.type !== "run") throw Error("run");
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
  } finally {
    await f.close();
  }
}, 30000);

it("real generated owner: task IDs integration/tasks stay disjoint, run parallel SDK workers and merge while preserving dirt", async () => {
  const { f, git, propose, start, wait } = await setup();
  try {
    writeFileSync(join(f.root, "unrelated.txt"), "user-owned bytes\n");
    f.mode("workflow-parallel");
    const definition = plan();
    definition.tasks[0].id = "integration";
    definition.tasks[1].id = "tasks";
    const p = await propose(definition);
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
    const run = await wait(await start(p));
    expect(run, JSON.stringify(run)).toMatchObject({
      status: "completed",
      humanReviewed: false,
    });
    expect(f.maxActive()).toBeGreaterThanOrEqual(2);
    for (const name of ["integration", "tasks/integration", "tasks/tasks"])
      expect(
        existsSync(
          join(
            f.c.directory,
            "workflows-v1",
            "worktrees",
            run.id,
            name,
            ".git",
          ),
        ),
      ).toBe(true);
    expect(run.mergedCommit).toBe(git("rev-parse", "HEAD").trim());
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
    expect(existsSync(join(f.root, ".cadence/project.md"))).toBe(true);
    const restarted = await f.restart();
    const retained = await restarted.client.workbenchRead({
      kind: "workflow",
      id: run.id,
    });
    expect(retained).toMatchObject({
      kind: "ok",
      value: { response: { run: { status: "completed" } } },
    });
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
  } finally {
    await f.close();
  }
}, 20000);

it("failed verification uses only the approved repair budget and never merges a failing candidate", async () => {
  const { f, command, start, wait, model, git } = await setup();
  try {
    f.mode("workflow");
    const baseline = git("rev-parse", "HEAD");
    const p = plan();
    p.repairAttempts = 1;
    p.checks = [
      {
        name: "real failure",
        command: 'node -e "process.exit(1)"',
        timeoutMs: 3000,
      },
    ];
    const proposed = await command({ action: "propose", plan: p, model });
    if (proposed.type !== "proposal") throw Error("proposal");
    const run = await wait(await start(proposed.proposal));
    expect(run.status).toBe("failed");
    expect(run.notice).toContain("repair budget exhausted");
    expect(run.steps.filter((s) => s.id.startsWith("repair-"))).toHaveLength(1);
    expect(
      run.steps
        .filter((s) => s.kind === "check")
        .every((s) => s.exitCode === 1),
    ).toBe(true);
    expect(run.mergedCommit).toBeNull();
    expect(git("rev-parse", "HEAD")).toBe(baseline);
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
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
  } finally {
    await f.close();
  }
}, 30000);

it("a baseline command cannot hide out-of-scope changes by committing them in the candidate", async () => {
  const { f, git, command, start, wait, model } = await setup();
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
    const candidate = join(
      f.c.directory,
      "workflows-v1",
      "worktrees",
      run.id,
      "integration",
    );
    expect(readFileSync(join(candidate, "out-of-scope.txt"), "utf8")).toBe(
      "unapproved",
    );
  } finally {
    await f.close();
  }
}, 20000);
