import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CheckoutGate } from "../src/service/checkout-gate.ts";
import { projectMarkdown } from "../src/service/workflow-git.ts";
import { Workflows } from "../src/service/workflows.ts";
import { plan } from "./helpers/workflow-plan.ts";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

it.each(["local-merge", "working-copy", "research"] as const)(
  "%s uses the shared owner gate without releasing another run's reservation",
  async (delivery) => {
    const owner = {
      state: "idle",
      lease: { assert() {} },
      quarantine: vi.fn(),
    };
    const gate = new CheckoutGate(
      owner as ConstructorParameters<typeof CheckoutGate>[0],
    );
    const entered = [deferred(), deferred()];
    const finished = [deferred(), deferred()];
    const live = [0, 1].map((index) => ({
      run: {
        id: randomUUID(),
        phase: "implementing",
        status: "queued",
        steps: [],
      },
      abort: new AbortController(),
      execution: {},
      ...(delivery === "research" ? {} : { proposal: { plan: { delivery } } }),
      delivered: new Set<string>(),
      notes: [],
      index,
    }));
    const work = async (item: (typeof live)[number]) => {
      entered[item.index].resolve();
      await finished[item.index].promise;
    };
    // Deterministic scheduler seam, not SDK/process execution evidence.
    const workflows = Object.assign(Object.create(Workflows.prototype), {
      o: { owner, gate, secrets: () => [] },
      active: new Map(live.map((item) => [item.run.id, item])),
      assertRunning() {},
      assertStartable() {},
      save() {},
      saveFinal() {},
      implement: work,
      worker: async (item: (typeof live)[number]) => {
        await work(item);
        return { result: { outcome: "completed", closed: true, exitCode: 0 } };
      },
    });
    const request =
      delivery === "research"
        ? { action: "research", questions: ["q"], model: {} }
        : { action: "execute" };
    const a = workflows.execute(live[0], request);
    await entered[0].promise;
    const b = workflows.execute(live[1], request);
    if (delivery === "working-copy") {
      let secondEntered = false;
      void entered[1].promise.then(() => {
        secondEntered = true;
      });
      await Promise.resolve();
      expect(secondEntered).toBe(false);
      finished[0].resolve();
    }
    await entered[1].promise;
    if (delivery === "local-merge") gate.assertQuiescent();
    else expect(() => gate.assertQuiescent()).toThrow("conflict");
    live[0].abort.abort();
    finished[0].resolve();
    await a;
    expect(live[1].abort.signal.aborted).toBe(false);
    finished[1].resolve();
    await b;
    gate.assertQuiescent();
    expect(owner.quarantine).not.toHaveBeenCalled();
  },
);

function candidate() {
  const home = mkdtempSync(join(tmpdir(), "parallel-candidate-"));
  const cwd = join(home, "project"),
    integration = join(home, "candidate");
  mkdirSync(cwd);
  const git = (at: string, ...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@example.invalid",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd: at, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).trim();
  git(cwd, "init", "-q");
  writeFileSync(join(cwd, "base.txt"), "base\n");
  git(cwd, "add", ".");
  git(cwd, "commit", "-qm", "base");
  const base = git(cwd, "rev-parse", "HEAD");
  const branch = git(cwd, "symbolic-ref", "HEAD");
  git(cwd, "worktree", "add", "--detach", integration, base);
  writeFileSync(join(integration, "a.txt"), "candidate\n");
  git(integration, "add", ".");
  git(integration, "commit", "-qm", "candidate");
  const original = git(integration, "rev-parse", "HEAD");
  const approved = plan();
  approved.tasks = [approved.tasks[0]];
  approved.projectContext = "";
  const verify = vi.fn(async () => {});
  const workflows = Object.assign(Object.create(Workflows.prototype), {
    cwd,
    gitStep: async (
      _live: unknown,
      at: string,
      _title: string,
      body: (run: (args: string[]) => Promise<void>) => Promise<void>,
    ) =>
      body(async (args) => {
        git(at, ...args);
      }),
    verifyAndRepair: verify,
  });
  const live = {
    target: { head: base, branch },
    frontier: base,
    guidance: { agents: null, project: null },
  };
  const advance = (path: string) => {
    writeFileSync(join(cwd, path), "sibling\n");
    git(cwd, "add", ".");
    git(cwd, "commit", "-qm", "sibling");
    return git(cwd, "rev-parse", "HEAD");
  };
  return {
    cwd,
    integration,
    git,
    original,
    verify,
    live,
    advance,
    approved,
    refresh: () =>
      workflows.refreshCandidate(live, integration, { plan: approved }),
  };
}
it("refreshes an isolated candidate over verified sibling delivery and requires new checks/review before fast-forward", async () => {
  const f = candidate();
  f.live.frontier = f.advance("b.txt");
  await f.refresh();
  expect(f.verify).toHaveBeenCalledOnce();
  expect(f.verify.mock.calls[0]).toEqual([
    f.live,
    f.integration,
    { plan: f.approved },
    true,
    0,
  ]);
  expect(f.git(f.integration, "rev-parse", "HEAD^")).toBe(f.live.frontier);
  expect(readFileSync(join(f.integration, "a.txt"), "utf8")).toBe(
    "candidate\n",
  );
  expect(readFileSync(join(f.integration, "b.txt"), "utf8")).toBe("sibling\n");
  // Candidate refresh alone never changes the user's branch.
  expect(f.git(f.cwd, "rev-parse", "HEAD")).toBe(f.live.frontier);
});
it("a failed refreshed check/review leaves the target untouched", async () => {
  const f = candidate();
  f.live.frontier = f.advance("b.txt");
  f.verify.mockRejectedValueOnce(new Error("fresh verification failed"));
  await expect(f.refresh()).rejects.toThrow("fresh verification failed");
  expect(f.git(f.cwd, "rev-parse", "HEAD")).toBe(f.live.frontier);
});
it.each([true, false])(
  "managed project context is compatible only when the approved bytes agree: %s",
  async (same) => {
    const f = candidate();
    f.approved.projectContext = "Shared project conventions";
    mkdirSync(join(f.cwd, ".cadence"));
    writeFileSync(
      join(f.cwd, ".cadence/project.md"),
      projectMarkdown(
        f.cwd,
        same ? f.approved.projectContext : "Different conventions",
      ),
    );
    f.live.frontier = f.advance("b.txt");
    if (same) await f.refresh();
    else await expect(f.refresh()).rejects.toThrow("conflict");
    expect(f.verify).toHaveBeenCalledTimes(same ? 1 : 0);
  },
);
it("uncommitted guidance drift is refused without a branch advance", async () => {
  const f = candidate();
  writeFileSync(join(f.cwd, "AGENTS.md"), "changed instructions");
  await expect(f.refresh()).rejects.toThrow("conflict");
  expect(f.git(f.integration, "rev-parse", "HEAD")).toBe(f.original);
});
it.each(["external", "overlap", "guidance"])(
  "refuses %s changes and preserves the candidate",
  async (kind) => {
    const f = candidate();
    const head = f.advance(
      kind === "overlap"
        ? "a.txt"
        : kind === "guidance"
          ? "AGENTS.md"
          : "b.txt",
    );
    if (kind !== "external") f.live.frontier = head;
    await expect(f.refresh()).rejects.toThrow(
      kind === "external" ? "stale" : "conflict",
    );
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.git(f.integration, "rev-parse", "HEAD")).toBe(f.original);
    expect(f.git(f.cwd, "rev-parse", "HEAD")).toBe(head);
  },
);
