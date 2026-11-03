// @module-tag slow
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import type {
  WorkflowRequest,
  WorkflowRun,
} from "../src/service/contracts/workflow.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { plan } from "./helpers/workflow-plan.ts";

it("scoped consent binds cwd/model; admitted Git worktrees, review and checks keep their original execution snapshot", async () => {
  const f = await acceptingFixture("generated", undefined, null, {
    models: ["fixed", "alternate"],
  });
  try {
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: f.root,
        encoding: "utf8",
        env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" },
      }).trim();
    const cwd = join(f.root, "pkg");
    mkdirSync(cwd);
    git("init", "-q");
    git("config", "user.name", "Cadence fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("commit", "-qm", "Fixture baseline");
    mkdirSync(join(cwd, ".pi"));
    writeFileSync(
      join(cwd, ".pi", "SYSTEM.md"),
      "Untracked profile is preserved, never copied.\n",
    );
    const location = { id: randomUUID(), cwd };
    const boot = await f.client.session();
    if (boot.kind !== "ok") throw Error("bootstrap");
    const choose = async (model: string) => {
      const c = await f.client.models(undefined, location);
      if (c.kind !== "ok") throw Error(JSON.stringify(c));
      const chosen = await f.client.chooseModel(
        {
          expected: c.value.version,
          choice: {
            provider: "fixture",
            model,
            api: "openai-completions",
            thinking: "off",
          },
        },
        location,
      );
      if (chosen.kind !== "ok") throw Error(JSON.stringify(chosen));
      return chosen.value.version;
    };
    const command = (request: WorkflowRequest) =>
      f.client.workbenchCommand({
        kind: "workflow",
        commandId: randomUUID(),
        epoch: boot.value.epoch,
        request,
      });
    let model = await choose("fixed");
    const definition = plan();
    definition.goal =
      "Create one scoped file without copying an untracked profile";
    definition.tasks = [
      {
        ...definition.tasks[0],
        writes: ["pkg/a.txt"],
        instructions: "Create the declared checkout-relative file.",
      },
    ];
    definition.checks = [
      {
        name: "session cwd and actual file",
        command:
          "node -e \"const f=require('fs');if(f.existsSync('.pi/SYSTEM.md')===process.cwd().includes('cadence-worktrees-v1')||f.readFileSync('a.txt','utf8')!=='implemented pkg/a.txt\\n')process.exit(1)\"",
        timeoutMs: 3000,
      },
    ];
    const propose = async () => {
      const r = await command({ action: "propose", model, plan: definition });
      if (
        r.kind !== "ok" ||
        r.value.kind !== "workflow" ||
        r.value.response.type !== "proposal"
      )
        throw Error(JSON.stringify(r));
      return r.value.response.proposal;
    };
    const prepare = async (p: Awaited<ReturnType<typeof propose>>) => {
      const r = await command({
        action: "prepare",
        proposalId: p.id,
        digest: p.digest,
      });
      if (
        r.kind !== "ok" ||
        r.value.kind !== "workflow" ||
        r.value.response.type !== "grant"
      )
        throw Error(JSON.stringify(r));
      return r.value.response.grant;
    };
    const old = await propose(),
      grant = await prepare(old);
    expect(old.cwd).toBe(cwd);
    await choose("alternate");
    expect(
      await command({
        action: "execute",
        proposalId: old.id,
        digest: old.digest,
        grant,
      }),
    ).toMatchObject({
      kind: "error",
      error: { code: "stale", effect: "none" },
    });
    expect(f.contacts()).toBe(0);
    model = await choose("fixed");
    // Returning to the same selector is not permission to revive an old plan.
    expect(
      await command({
        action: "prepare",
        proposalId: old.id,
        digest: old.digest,
      }),
    ).toMatchObject({ kind: "error", error: { code: "stale" } });
    const proposal = await propose(),
      fresh = await prepare(proposal);
    f.mode("workflow");
    const admitted = await command({
      action: "execute",
      proposalId: proposal.id,
      digest: proposal.digest,
      grant: fresh,
    });
    if (
      admitted.kind !== "ok" ||
      admitted.value.kind !== "workflow" ||
      admitted.value.response.type !== "run"
    )
      throw Error(JSON.stringify(admitted));
    const runId = admitted.value.response.run.id;
    expect(admitted.value.response.run.execution).toMatchObject({
      cwd,
      checkoutRoot: f.root,
      model: { model: "fixed" },
      version: model,
    });
    // Change the conversation's FUTURE model before the run's first SDK worker.
    await choose("alternate");
    let run: WorkflowRun | undefined;
    try {
      await expect
        .poll(
          async () => {
            const r = await f.client.workbenchRead({
              kind: "workflow",
              id: runId,
            });
            if (
              r.kind !== "ok" ||
              r.value.kind !== "workflow" ||
              r.value.response.type !== "run"
            )
              return "unobserved";
            run = r.value.response.run;
            return ["queued", "running"].includes(run.status)
              ? "running"
              : "settled";
          },
          // Reading the full native/auth/storage snapshot at 20 Hz competes
          // with the real owner under the slow lane's parallel process load.
          // Keep the same deadline and settlement predicate, not a merge shortcut.
          { timeout: 20000, interval: 100 },
        )
        .toBe("settled");
    } catch (error) {
      writeFileSync(
        join(f.dir, "scope-observation.json"),
        JSON.stringify({ observedAt: Date.now(), run }, null, 2),
      );
      throw error;
    }
    expect(run?.status, JSON.stringify(run)).toBe("completed");
    expect(run?.mergedCommit).toBe(git("rev-parse", "HEAD"));
    expect(readFileSync(join(cwd, "a.txt"), "utf8")).toBe(
      "implemented pkg/a.txt\n",
    );
    expect(existsSync(join(f.root, "a.txt"))).toBe(false);
    expect(readFileSync(join(cwd, ".pi", "SYSTEM.md"), "utf8")).toBe(
      "Untracked profile is preserved, never copied.\n",
    );
    expect(f.modelRequests.length).toBeGreaterThan(1);
    expect(new Set(f.modelRequests)).toEqual(new Set(["fixed"]));
    const root = join(f.c.directory, "workflows-v1", "runs", runId);
    const launches = readdirSync(join(root, "launches")).map((name) =>
      JSON.parse(readFileSync(join(root, "launches", name), "utf8")),
    );
    expect(
      launches.every((launch) =>
        launch.cwd.endsWith(`${process.platform === "win32" ? "\\" : "/"}pkg`),
      ),
    ).toBe(true);
    expect(
      launches.every((launch) => launch.request.model.model === "fixed"),
    ).toBe(true);
    const catalog = await f.client.models(undefined, location);
    expect(catalog).toMatchObject({
      kind: "ok",
      value: { selected: { model: "alternate" } },
    });
  } finally {
    await f.close();
  }
}, 30000);
