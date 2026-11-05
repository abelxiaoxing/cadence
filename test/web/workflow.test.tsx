import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type {
  CadenceConversation,
  WorkbenchCommand,
} from "../../src/service/contracts/workbench.ts";
import type {
  WorkflowRun,
  WorkflowStep,
} from "../../src/service/contracts/workflow.ts";
import { deliveryObservation } from "../../src/service/workflow-delivery.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  approveWorkflow,
  cadenceApproval,
  cadenceExit,
} from "../../web/src/client/workflow-entry";
import {
  AgentDock,
  workflowAgentLabel,
} from "../../web/src/components/workspace/AgentDock";
import {
  DeliveryDetails,
  nextRunWindow,
  PlanCard,
  placeWorkflows,
  WorkflowLine,
} from "../../web/src/components/workspace/WorkflowPanel";
import { LocaleProvider } from "../../web/src/i18n/locale";
import type { ActiveRuns, RunProjection } from "../../web/src/types";
import { plan } from "../helpers/workflow-plan.ts";
import { transport } from "./fixtures";

function state(): CadenceConversation {
  return {
    id: randomUUID(),
    revision: 3,
    enabled: true,
    head: randomUUID(),
    runs: [],
    proposal: {
      id: randomUUID(),
      epoch: randomUUID(),
      digest: "a".repeat(64),
      observation: "b".repeat(64),
      cwd: "/fixture/subdir",
      checkoutRoot: "/fixture",
      plan: plan(),
      model: {
        epoch: randomUUID(),
        accessGeneration: 1,
        configRev: 1,
        catalogId: randomUUID(),
      },
    },
  };
}
function client(
  s: CadenceConversation,
  change?: (c: WorkbenchCommand) => void,
) {
  const commands: WorkbenchCommand[] = [];
  const api = new ServiceClient({
    ...transport(),
    workbenchCommand: async (c) => {
      commands.push(c);
      change?.(c);
      return {
        kind: "ok",
        value:
          c.kind === "cadence-prepare"
            ? {
                kind: "cadence-grant",
                commandId: c.commandId,
                revision: s.revision,
                proposal: s.proposal,
                grant: randomUUID(),
                expiresAt: Date.now() + 120000,
              }
            : { kind: "accepted", commandId: c.commandId },
      };
    },
  });
  return { api, commands };
}
it("one explicit approval prepares and submits the exact displayed revision, persisting identity before submission", async () => {
  const s = state();
  let attempted = "";
  const c = client(s, (request) => {
    if (request.kind === "cadence-approve")
      expect(attempted).toBe(request.commandId);
  });
  await approveWorkflow({
    client: c.api,
    state: s,
    current: () => true,
    submitting: (id) => {
      attempted = id;
    },
  });
  expect(c.commands.map((c) => c.kind)).toEqual([
    "cadence-prepare",
    "cadence-approve",
  ]);
});
it("departure during preparation never starts accepted work", async () => {
  const s = state();
  let current = true;
  const c = client(s, () => {
    current = false;
  });
  await expect(
    approveWorkflow({
      client: c.api,
      state: s,
      current: () => current,
      submitting: () => {
        throw Error("must not submit");
      },
    }),
  ).rejects.toThrow("stale");
  expect(c.commands).toHaveLength(1);
});
it("a different plan returned by preparation is not silently approved", async () => {
  const s = state(),
    other = state(),
    c = client(other);
  await expect(
    approveWorkflow({
      client: c.api,
      state: s,
      current: () => true,
      submitting: () => {},
    }),
  ).rejects.toThrow("stale");
  expect(c.commands).toHaveLength(1);
});
it("only exact unquoted approval/exit inputs are action intents", () => {
  expect(cadenceApproval("按计划实施")).toBe(true);
  expect(cadenceExit("退出 Cadence")).toBe(true);
  for (const text of [
    "好的",
    "他说按计划实施",
    "`按计划实施`",
    "```\nexit cadence\n```",
    "请解释退出 Cadence",
  ]) {
    expect(cadenceApproval(text)).toBe(false);
    expect(cadenceExit(text)).toBe(false);
  }
});
it("plan cards expose actual checks and local delivery, not old Save/Start/Review steps", () => {
  const s = state();
  if (!s.proposal) throw Error("fixture proposal");
  const html = renderToStaticMarkup(
    <PlanCard
      proposal={s.proposal}
      canApprove={false}
      approvalHint="The latest turn's outcome is unknown."
      onApprove={() => {}}
    />,
  );
  expect(html).toContain("Implement this plan");
  expect(html).toContain("<code>/fixture/subdir</code>");
  expect(html).toContain("Declared write paths use the checkout root:");
  expect(html).toContain("<code>/fixture</code>");
  expect(html).toContain("No push, publication or deployment");
  expect(html).toContain("disabled");
  expect(html).toContain("outcome is unknown");
  expect(html).not.toContain("Confirm start");
});
it("workflow subagent rows use the readable assignment, not the step's random suffix", () => {
  expect(
    workflowAgentLabel("implement-a-1b4e28ba-2fa1-11d2-883f-0016d3cca427"),
  ).toBe("implement-a");
  // A review assignment carries its own identity before the step's suffix.
  expect(
    workflowAgentLabel(
      "review-6419c395-1dd5-49f0-a1ef-87c6c13a2550-1b4e28ba-2fa1-11d2-883f-0016d3cca427",
    ),
  ).toBe("review");
  expect(workflowAgentLabel("question-1")).toBe("question-1");
});
const step = (
  id: string,
  kind: WorkflowStep["kind"],
  status: WorkflowStep["status"],
  text = "",
): WorkflowStep => ({
  id: `${id}-${randomUUID()}`,
  ...(kind === "git" || kind === "check" ? {} : { childRunId: randomUUID() }),
  kind,
  status,
  text,
  exitCode: null,
  truncated: false,
});
function run(
  over: Partial<WorkflowRun> = {},
  acceptedAt = 1_000_000,
  settledAt: number | null = null,
): WorkflowRun {
  return {
    id: randomUUID(),
    epoch: randomUUID(),
    goal: "Two independent outputs",
    status: "running",
    phase: "implementing",
    steps: [
      step("worktree-a", "git", "completed"),
      step("a", "implementation", "running", "Writing a.txt"),
      step("b", "implementation", "running"),
    ],
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    diagnostics: {
      acceptedAt,
      acquiredAt: null,
      settledAt,
      owner: {
        version: "0",
        build: "fixture",
        entry: "service-host.mjs",
        pid: 1,
        node: "v22",
        platform: "linux",
        startedAt: 0,
      },
    },
    ...over,
  };
}
const line = (r: WorkflowRun, locale: "en" | "zh" = "en") =>
  renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <WorkflowLine
        client={new ServiceClient(transport())}
        run={r}
        onOpen={() => {}}
      />
    </LocaleProvider>,
  );
it("a workflow is one line: what it is doing while live, never its step list", () => {
  const live = run();
  const html = line(live);
  expect(html).toContain("Two independent outputs");
  expect(html).toContain("implementing · a, b");
  expect(html).toContain('aria-label="Cancel workflow — request stop"');
  expect(html).not.toContain("worktree-a");
  expect(html).not.toContain("Writing a.txt");
  expect(html).not.toContain("Owner timing");
  expect(line(live, "zh")).toContain("实施中 · a, b");
  expect(line(live, "zh")).toContain("停止");
  const research = run({
    phase: "research",
    steps: [step("research-1", "research", "running")],
  });
  expect(line(research, "zh")).toContain("调研中 · research-1");
});
it("a settled line keeps its outcome, owner-clock duration and, when unsuccessful, the reason", () => {
  const merged = run(
    {
      status: "completed",
      phase: "finished",
      mergedCommit: "9a94027ea14a0351c29deb872349614ad9bc7513",
      notice: "Changed files: a.txt, b.txt",
    },
    1_000_000,
    1_072_000,
  );
  expect(line(merged)).toContain("completed · merged 9a94027 · 1m 12s");
  expect(line(merged, "zh")).toContain("已完成 · 合并 9a94027 · 1 分 12 秒");
  expect(line(merged)).not.toContain("Cancel workflow");
  expect(line(merged)).not.toContain("Changed files");
  const failed = run(
    {
      status: "failed",
      phase: "finished",
      notice: "\nCheck outputs failed: exit 1\nChanged files so far: a.txt",
    },
    1_000_000,
    1_042_000,
  );
  const html = line(failed);
  expect(html).toContain("failed · 42s");
  expect(html).toContain("Check outputs failed: exit 1");
  expect(html).not.toContain("Changed files so far");
  // A record without owner timing states no duration rather than guessing one.
  expect(line(run({ status: "canceled", diagnostics: undefined }))).toContain(
    "canceled</span>",
  );
});
it("each workflow line follows the turn it started in, never the newest message", () => {
  const turn = (id: string, at: number) => ({ header: { id, at } });
  const turns = [turn("t1", 100), turn("t2", 200), turn("t3", 300)];
  const research = run({ goal: "research" }, 150);
  const second = run({ goal: "second" }, 260);
  const first = run({ goal: "first" }, 210);
  const undated = run({ goal: "undated", diagnostics: undefined, steps: [] });
  const older = run({ goal: "older" }, 50);
  const goals = (runs?: WorkflowRun[]) => runs?.map((r) => r.goal);
  const placed = placeWorkflows(
    turns,
    [second, undated, research, older, first],
    true,
  );
  expect(goals(placed.after.get("t1"))).toEqual(["research"]);
  expect(goals(placed.after.get("t2"))).toEqual(["first", "second"]);
  expect(placed.after.get("t3")).toBeUndefined();
  expect(goals(placed.end)).toEqual(["undated"]);
  // Older than every turn shown: it waits while earlier turns remain unread,
  // then heads the transcript.
  expect(goals(placed.start)).toEqual([]);
  expect(
    [...placed.after.values()].flat().some((r) => r.goal === "older"),
  ).toBe(false);
  expect(goals(placeWorkflows(turns, [older], false).start)).toEqual(["older"]);
  // A turn without a recorded start holds nothing.
  expect(goals(placeWorkflows([turn("t0", 0)], [research], false).end)).toEqual(
    ["research"],
  );
  // Before any turn is read (first load, branch switch) nothing gathers at the end.
  const unread = placeWorkflows([], [research, undated], false);
  expect([...unread.start, ...unread.end, ...unread.after.values()]).toEqual(
    [],
  );
});
it("each workflow list is read newest first, older ones only while the turns shown could hold them", () => {
  const ids = Array.from({ length: 20 }, () => randomUUID());
  const at = (index: number) => 1000 + index * 10;
  const observed = (indexes: number[]) =>
    new Map(indexes.map((i) => [ids[i], run({ id: ids[i] }, at(i))]));
  const newest = [12, 13, 14, 15, 16, 17, 18, 19];
  const none = new Set<string>();
  // Still reading the window: no growth yet.
  expect(nextRunWindow(ids, 8, observed([19]), none, at(0), false)).toBe(8);
  // The oldest run read began after the oldest turn shown: read older ones.
  expect(nextRunWindow(ids, 8, observed(newest), none, at(5), false)).toBe(16);
  // It began before the oldest turn shown: the turns shown hold no older run.
  expect(nextRunWindow(ids, 8, observed(newest), none, at(14), false)).toBe(8);
  // Every turn shown: read on to the oldest.
  expect(nextRunWindow(ids, 8, observed(newest), none, at(14), true)).toBe(16);
  expect(nextRunWindow(ids, 24, observed(newest), none, at(0), true)).toBe(24);
  // An ID that cannot be read (a refused terminal attempt) never stalls it.
  const refused = new Set([ids[13]]);
  const readable = observed(newest.filter((i) => i !== 13));
  expect(nextRunWindow(ids, 8, readable, refused, at(5), false)).toBe(16);
});
it("the subagent dock count leads with how many listed agents are still active", () => {
  const child = (lifecycle: RunProjection["lifecycle"]) =>
    ({
      childRunId: randomUUID(),
      assignmentId: "research-a",
      lifecycle,
      outcome: lifecycle === "settled" ? "completed" : null,
    }) as unknown as RunProjection;
  const active: ActiveRuns = {
    storeId: randomUUID(),
    workspaceId: randomUUID(),
    epoch: randomUUID(),
    status: "complete",
    runs: [],
  };
  const dock = (runs: RunProjection[], locale: "en" | "zh" = "en") =>
    renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <AgentDock
          client={new ServiceClient(transport())}
          active={active}
          taskId={randomUUID()}
          runs={runs}
          snapshot="1"
          onOpen={() => {}}
        />
      </LocaleProvider>,
    );
  const mixed = [child("queued"), child("running"), child("settled")];
  expect(dock(mixed)).toContain(
    '<span class="lp-count live">2 active · 3 total</span>',
  );
  expect(dock(mixed, "zh")).toContain("2 个进行中 · 共 3 个");
  expect(dock([child("settled")])).toContain('<span class="lp-count">1</span>');
});

it("delivery UI distinguishes an accepted candidate from an applied merge and names retained workspaces", () => {
  const d = deliveryObservation(
    {
      policy: "task-branch-v1",
      target: {
        checkoutRoot: "/fixture",
        repository: "/fixture/.git",
        repositoryIdentity: "a".repeat(64),
        branch: "refs/heads/main",
        head: "a".repeat(40),
      },
    },
    "/worktrees",
    randomUUID(),
    "feature",
  );
  d.candidate = "b".repeat(40);
  d.acceptance = {
    candidate: d.candidate,
    tree: "c".repeat(40),
    planDigest: "d".repeat(64),
    contextDigest: "e".repeat(64),
    checks: ["check"],
    review: "review",
  };
  d.integration.status = "blocked";
  d.integration.reason = "Target changed; candidate retained.";
  d.cleanup = { status: "retained", reason: "Ignored user data remains." };
  const html = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <DeliveryDetails delivery={d} />
    </LocaleProvider>,
  );
  expect(html).toContain(d.taskBranch);
  expect(html).toContain(d.worktreeRoot);
  expect(html).toContain("Checks and automatic Agent review passed");
  expect(html).toContain("blocked");
  expect(html).toContain("Target changed; candidate retained.");
  expect(html).toContain("Ignored user data remains.");
  expect(html).not.toContain("Actual local merge commit");
  const zh = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <DeliveryDetails delivery={d} />
    </LocaleProvider>,
  );
  expect(zh).toContain("任务分支");
  expect(zh).toContain("候选验收");
});
it("approval card displays the owner-bound target and branch/worktree delivery policy", () => {
  const s = state();
  if (!s.proposal) throw new Error("fixture");
  s.proposal.delivery = {
    policy: "task-branch-v1",
    target: {
      checkoutRoot: "/fixture",
      repository: "/fixture/.git",
      repositoryIdentity: "a".repeat(64),
      branch: "refs/heads/release",
      head: "b".repeat(40),
    },
  };
  const html = renderToStaticMarkup(
    <PlanCard proposal={s.proposal} canApprove={true} onApprove={() => {}} />,
  );
  expect(html).toContain("refs/heads/release");
  expect(html).toContain("b".repeat(40));
  expect(html).toContain("after approval");
  expect(html).toContain("Keep the task branch");
});
