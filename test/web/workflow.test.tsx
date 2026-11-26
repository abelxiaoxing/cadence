import { randomUUID } from "node:crypto";
import {
  act,
  Children,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { newDesign, reviseDesign } from "../../src/service/contracts/design.ts";
import type {
  CadenceConversation,
  WorkbenchCommand,
} from "../../src/service/contracts/workbench.ts";
import type {
  WorkflowRun,
  WorkflowStep,
  WorkflowTiming,
} from "../../src/service/contracts/workflow.ts";
import { decodeDeliveryObservation } from "../../src/service/contracts/workflow.ts";
import { deliveryObservation } from "../../src/service/workflow-delivery.ts";
import { ServiceClient } from "../../src/service-client.ts";
import {
  approveWorkflow,
  cadenceApproval,
  cadenceExit,
} from "../../web/src/client/workflow-entry";
import {
  AgentDock,
  type WorkflowAgent,
  WorkflowAgentGroup,
} from "../../web/src/components/workspace/AgentDock";
import {
  DesignBar,
  DesignDialog,
  DesignLine,
  placeDesign,
} from "../../web/src/components/workspace/DesignCard.tsx";
import { RetainedStepResult } from "../../web/src/components/workspace/RetainedStepResult";
import {
  AssignmentBoard,
  cancelWorkflow,
  DeliveryDetails,
  Deviations,
  nextRunWindow,
  PlanCard,
  placeWorkflows,
  WorkflowAttemptSummary,
  WorkflowLine,
  WorkflowLineProgress,
  WorkflowRunState,
  WorkflowStepSummary,
} from "../../web/src/components/workspace/WorkflowPanel";
import { LocaleProvider } from "../../web/src/i18n/locale";
import {
  assignmentCounts,
  assignmentRows,
  checkSetAside,
  dockGroups,
  sideBySideCounts,
  workflowAgentLabel,
} from "../../web/src/navigation/workflow-assignments";
import type { RunProjection } from "../../web/src/types";
import { designQuestionsFixture } from "../helpers/design-questions.ts";
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
  s.proposal.display = {
    model: "fixture/fixed",
    branch: "main",
    baseCommit: "a".repeat(40),
    runtime:
      "Pi runtime: tools read, bash, edit, write; auto-compaction on; request retries 9.",
  };
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
  expect(html).toContain(
    "Pi runtime: tools read, bash, edit, write; auto-compaction on; request retries 9.",
  );
  expect(html).toContain("disabled");
  expect(html).toContain("outcome is unknown");
  expect(html).not.toContain("Confirm start");
});
it.each(["validate", "restore", "approve"] as const)(
  "%s plan action marks only pending validation busy and prevents duplicate decisions",
  (action) => {
    const proposal = state().proposal;
    if (!proposal) throw Error("fixture proposal");
    const draw = (validating: boolean, allowed: boolean) =>
      renderToStaticMarkup(
        <PlanCard
          proposal={proposal}
          action={action}
          canApprove={allowed}
          canValidate={allowed}
          validating={validating}
          onValidate={() => {}}
          onApprove={() => {}}
        />,
      );
    for (const allowed of [true, false]) {
      const busy = draw(true, allowed);
      expect(busy).toMatch(
        /<button[^>]*aria-busy="true"[^>]*disabled=""[^>]*>Validating plan…<\/button>/,
      );
      expect(busy.match(/<button(?![^>]*disabled)/g)).toBeNull();
      const idle = draw(false, allowed);
      expect(idle).not.toContain("aria-busy");
      expect(idle).not.toContain("Validating plan…");
      expect(idle.includes('disabled=""')).toBe(!allowed);
    }
  },
);
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
it("workflow-cancel rechecks the supplied attachment gate at dispatch, not just when drawing Stop", async () => {
  const live = run();
  const { api, commands } = client(state());
  let attached = true;
  const allowed = (r: WorkflowRun) => attached && r.epoch === live.epoch;
  expect(allowed(live)).toBe(true);
  attached = false;
  expect(await cancelWorkflow(api, live, allowed)).toBe("stale");
  attached = true;
  expect(
    await cancelWorkflow(api, { ...live, epoch: randomUUID() }, allowed),
  ).toBe("stale");
  expect(commands).toEqual([]);
  expect(await cancelWorkflow(api, live, allowed)).toBe("");
  expect(commands).toEqual([
    {
      kind: "workflow-cancel",
      epoch: live.epoch,
      runId: live.id,
      commandId: expect.any(String),
    },
  ]);
});
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
  // Verified work that stayed on its task branch completes, and says where
  // it is: never the line of an ordinary merge.
  const delivery = deliveryObservation(
    {
      policy: "task-branch-v3",
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
  delivery.integration = {
    status: "branch",
    before: "a".repeat(40),
    after: null,
    reason:
      "Completed, not merged into main: refs/heads/main no longer exists.",
  };
  const unmerged = run(
    { status: "completed", phase: "finished", delivery },
    1_000_000,
    1_072_000,
  );
  const task = delivery.taskBranch.replace("refs/heads/", "");
  expect(line(unmerged)).toContain(
    `completed · not merged into main; the result is on ${task} · 1m 12s`,
  );
  expect(line(unmerged)).not.toContain("merged 9a94027");
  expect(line(unmerged, "zh")).toContain(
    `已完成 · 未合入 main，结果在 ${task} · 1 分 12 秒`,
  );
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
const task = (
  id: string,
  state: NonNullable<WorkflowRun["tasks"]>[number]["state"],
  after: string[] = [],
) => ({ id, title: `Write ${id}`, after, state });
const observed = () =>
  deliveryObservation(
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
const child = (
  id: string,
  applied: string | null,
  state: "preparing" | "ready" | "removed" | "retained",
) => ({
  id,
  path: `/worktrees/run/tasks/${id}`,
  base: "b".repeat(40),
  head: "c".repeat(40),
  applied,
  state,
});
/** Five assignments in mixed states, two of them in their own worktrees. */
function parallel(over: Partial<WorkflowRun> = {}): WorkflowRun {
  const delivery = observed();
  delivery.artifacts = [
    child("api", "d".repeat(40), "removed"),
    child("ui", null, "ready"),
  ];
  return run({
    goal: "Five assignments",
    tasks: [
      task("schema", "completed"),
      task("api", "completed", ["schema"]),
      task("ui", "running", ["schema"]),
      task("cli", "running", ["schema"]),
      task("docs", "queued", ["api", "ui"]),
    ],
    delivery,
    steps: [
      step("schema", "implementation", "completed"),
      step("worktree-api", "git", "completed"),
      step("api", "implementation", "completed"),
      step("ui", "implementation", "running"),
      step("cli", "implementation", "failed"),
      step("repair-1", "implementation", "running"),
      step("cli", "implementation", "running"),
    ],
    ...over,
  });
}
it("assignments are counted from the run, and only a side-by-side run replaces names with counts", () => {
  const current = parallel();
  expect(assignmentCounts(current)).toEqual({
    queued: 1,
    running: 2,
    completed: 2,
    failed: 0,
    superseded: 0,
  });
  expect(sideBySideCounts(current)).not.toBeNull();
  const html = line(current);
  expect(html).toContain("implementing · 2 running · 1 queued · 2 done");
  expect(html).not.toContain("repair-1");
  expect(html).not.toContain("ui, ");
  expect(line(current, "zh")).toContain(
    "实施中 · 2 个运行中 · 1 个排队中 · 2 个已完成",
  );
  // One running after others ran in their own worktrees is still side by side.
  const tail = parallel({
    tasks: [task("a", "completed"), task("b", "running"), task("c", "failed")],
  });
  expect(line(tail)).toContain("implementing · 1 running · 1 done · 1 failed");
  // A serial run keeps naming what runs: nothing ran beside anything.
  const serial = run({
    tasks: [task("a", "running"), task("b", "queued", ["a"])],
    steps: [step("a", "implementation", "running")],
  });
  expect(sideBySideCounts(serial)).toBeNull();
  // The live line also carries its ticking elapsed time after the step names.
  expect(line(serial)).toMatch(/implementing · a · \d+h \d+m<\/span>/);
  // Once every assignment is in the candidate the steps are named again.
  const verifying = parallel({
    phase: "verifying",
    tasks: [task("a", "completed"), task("b", "completed")],
    steps: [step("unit", "check", "running")],
  });
  expect(sideBySideCounts(verifying)).toBeNull();
  expect(line(verifying)).toMatch(/verifying · unit · \d+h \d+m<\/span>/);
  // A revised route: what a revision dropped is counted apart, never as waiting.
  const revised = parallel({
    tasks: [
      task("a", "running"),
      task("b", "running"),
      { ...task("c", "superseded", ["a"]), revision: 2 },
      { ...task("d", "queued", ["a"]), revision: 2 },
    ],
  });
  expect(line(revised)).toContain(
    "implementing · 2 running · 1 queued · 1 superseded",
  );
  expect(line(revised, "zh")).toContain("1 个已被取代");
  // An older service lists no assignments: nothing is counted or invented.
  expect(assignmentCounts(run())).toBeNull();
  expect(assignmentRows(run())).toEqual([]);
});
it("the assignment board states each assignment's state in words, its own worktree and its steps", () => {
  const current = parallel();
  const rows = assignmentRows(current);
  expect(rows.map((row) => [row.task.id, row.steps.length])).toEqual([
    ["schema", 1],
    ["api", 1],
    ["ui", 1],
    ["cli", 2],
    ["docs", 0],
  ]);
  // A git step named after an assignment is not one of its attempts.
  expect(rows[1].steps.every((s) => s.kind === "implementation")).toBe(true);
  expect(rows[1].artifact?.applied).toBe("d".repeat(40));
  expect(rows[0].artifact).toBeUndefined();
  const opened: string[] = [];
  const board = (r: WorkflowRun, locale: "en" | "zh" = "en", partial = false) =>
    renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <AssignmentBoard
          run={r}
          steps={r.steps}
          partial={partial}
          onOpen={(s) => opened.push(s.id)}
        />
      </LocaleProvider>,
    );
  const html = board(current);
  expect(html).toContain(
    '<span class="workflow-board-counts">2 running · 1 queued · 2 done</span>',
  );
  expect(html.match(/<li class="workflow-task">/g)).toHaveLength(5);
  // Each state is a word beside its icon, never a colour alone.
  expect(html).toMatch(
    /<span class="workflow-task-state completed"><svg[^>]*>.*?<\/svg>completed<\/span>/,
  );
  expect(html).toMatch(
    /<span class="workflow-task-state queued"><svg[^>]*>.*?<\/svg>queued<\/span>/,
  );
  expect(html.match(/workflow-task-state running/g)).toHaveLength(2);
  expect(html).toContain("<span>Write api</span><code>api</code>");
  expect(html).toContain("<span>after api, ui</span>");
  // Only those that ran beside others have a worktree of their own.
  expect(html.match(/own worktree/g)).toHaveLength(2);
  expect(html).toContain(
    '<span class="workflow-task-worktree">own worktree · integrated</span>',
  );
  expect(html).toContain(
    '<span class="workflow-task-worktree">own worktree</span>',
  );
  expect(html).not.toContain("kept for inspection");
  // A plan revision's changes are named on the assignments they touched.
  const revised = board(
    parallel({
      tasks: [
        task("schema", "completed"),
        { ...task("api", "superseded", ["schema"]), revision: 2 },
        { ...task("rest", "queued", ["schema"]), revision: 2 },
      ],
    }),
  );
  expect(revised).toMatch(
    /<span class="workflow-task-state superseded"><svg[^>]*>.*?<\/svg>superseded<\/span>/,
  );
  expect(revised).toContain(
    '<span class="workflow-task-revised">dropped by route revision 2</span>',
  );
  expect(revised).toContain(
    '<span class="workflow-task-revised">added or rewritten by route revision 2</span>',
  );
  expect(
    board(
      parallel({
        tasks: [{ ...task("api", "superseded"), revision: 2 }],
      }),
      "zh",
    ),
  ).toContain("在第 2 次路线修订中取消");
  // Its steps open their subagent; the failed attempt stays listed as failed.
  expect(html).toContain("implementation · failed</button>");
  expect(html.match(/title="Open subagent context"/g)).toHaveLength(5);
  expect(html).not.toContain("Only the steps on this page");
  expect(board(current, "en", true)).toContain(
    "Only the steps on this page are grouped below; other pages hold more.",
  );
  // After a failure unintegrated work stays where it can be inspected.
  const stopped = parallel({ status: "failed", phase: "finished" });
  if (!stopped.delivery?.artifacts || !stopped.tasks) throw Error("fixture");
  stopped.delivery.artifacts[1] = child("ui", null, "retained");
  stopped.tasks[2] = task("ui", "failed", ["schema"]);
  const kept = board(stopped);
  expect(kept).toContain(
    '<span class="workflow-task-worktree">own worktree · kept for inspection</span>',
  );
  expect(kept).toContain(
    '<code class="workflow-task-path">/worktrees/run/tasks/ui</code>',
  );
  expect(kept).toMatch(
    /<span class="workflow-task-state failed"><svg[^>]*>.*?<\/svg>failed<\/span>/,
  );
  const zh = board(current, "zh");
  expect(zh).toContain("独立工作区 · 已合回");
  expect(zh).toContain("排队中</span>");
  // Without recorded assignments there is no board, not an empty one.
  expect(board(run())).toBe("");
});
it("the dock groups subagents per run, live first, and shows each one's assignment state", () => {
  const live = parallel();
  const done = run({
    goal: "Earlier research",
    status: "completed",
    phase: "finished",
    steps: [
      step("question-1", "research", "completed"),
      step("unit", "check", "completed"),
    ],
  });
  const empty = run({ goal: "Checks only", steps: [] });
  const runs = new Map([live, done, empty].map((r) => [r.id, r]));
  // Listed oldest first, as the dock receives them; an unread ID has no rows.
  const groups = dockGroups([live.id, done.id, empty.id, randomUUID()], runs);
  expect(groups.map((g) => g.run.goal)).toEqual([
    "Five assignments",
    "Earlier research",
  ]);
  // Live agents lead; the newest comes first among equals; no git or check row.
  expect(
    groups[0].steps.map((s) => `${workflowAgentLabel(s.id)}:${s.status}`),
  ).toEqual([
    "cli:running",
    "repair-1:running",
    "ui:running",
    "cli:failed",
    "api:completed",
    "schema:completed",
  ]);
  expect(groups[1].steps).toHaveLength(1);
  // A settled run that is newer still follows the one with live agents.
  expect(dockGroups([live.id, done.id], runs).map((g) => g.run.goal)).toEqual([
    "Five assignments",
    "Earlier research",
  ]);
  const selectedStep = {
    runId: live.id,
    stepId: groups[0].steps[2].id,
    label: "ui",
  };
  const group = (
    index: number,
    locale: "en" | "zh" = "en",
    selected: WorkflowAgent | null = selectedStep,
  ) =>
    renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <WorkflowAgentGroup
          run={groups[index].run}
          steps={groups[index].steps}
          selected={selected}
        />
      </LocaleProvider>,
    );
  const html = group(0);
  expect(html).toContain(
    '<span class="agent-dock-run-goal">Five assignments</span><span class="agent-dock-run-state">2 running · 1 queued · 2 done</span>',
  );
  expect(html.match(/class="agent-dock-row/g)).toHaveLength(6);
  expect(html.match(/class="agent-dock-row active"/g)).toHaveLength(1);
  const head = group(0, "en", {
    runId: live.id,
    stepId: null,
    label: live.goal,
  });
  const currentButtons = (markup: string) =>
    markup.match(
      /<button\b[^>]*aria-current="true"[^>]*>[\s\S]*?<\/button>/g,
    ) ?? [];
  expect(currentButtons(html)).toHaveLength(1);
  expect(currentButtons(html)[0]).toContain('class="agent-dock-row active"');
  expect(currentButtons(html)[0]).toContain("implementation · ui</strong>");
  expect(currentButtons(head)).toHaveLength(1);
  expect(currentButtons(head)[0]).toContain(
    'class="agent-dock-run-head active"',
  );
  expect(head.match(/ active"/g)).toHaveLength(1);
  for (const none of [
    group(0, "en", null),
    group(1),
    group(0, "en", { ...selectedStep, stepId: "not-listed" }),
  ])
    expect(none).not.toMatch(/aria-current| active"/);
  // The step's own status, and under its name the assignment's state: a
  // finished worker is not an integrated assignment, and the reverse.
  expect(html).toMatch(
    /implementation · cli<\/strong><small>Assignment: running<\/small><\/span><span class="ep-state failed">failed<\/span>/,
  );
  expect(html).toMatch(
    /implementation · api<\/strong><small>Assignment: completed<\/small>/,
  );
  // A repair step is no assignment of the agreement: it claims no state.
  expect(html).toMatch(
    /implementation · repair-1<\/strong><\/span><span class="ep-state running">/,
  );
  expect(group(0, "zh")).toContain("子任务：运行中");
  const research = group(1);
  expect(research).not.toContain("agent-dock-run-state");
  expect(research).not.toContain("Assignment:");
});
/** Every host button in an element tree, for invoking its handler directly. */
function hostButtons(
  node: ReactNode,
  out: ReactElement[] = [],
): ReactElement[] {
  if (isValidElement(node)) {
    if (node.type === "button") out.push(node);
    for (const child of Children.toArray(
      (node.props as { children?: ReactNode }).children,
    ))
      hostButtons(child, out);
  } else if (Array.isArray(node))
    for (const child of node) hostButtons(child, out);
  return out;
}
const timing = (
  startedAt: number,
  settledAt: number | null,
): WorkflowTiming => ({
  createdAt: startedAt,
  preparedAt: null,
  startedAt,
  stopRequestedAt: null,
  closedAt: null,
  settledAt,
  stopReason: null,
});
const progress = (
  r: WorkflowRun,
  now = 1_120_000,
  locale: "en" | "zh" = "en",
  onOpenStep?: (step: WorkflowStep) => void,
) =>
  renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <WorkflowLineProgress
        run={r}
        now={now}
        onOpen={() => {}}
        onOpenStep={onOpenStep}
      />
    </LocaleProvider>,
  );
it("the line stays collapsed until its chevron opens the progress body in place", async () => {
  const live = run();
  const html = line(live);
  expect(html).toContain('aria-expanded="false"');
  expect(html).not.toContain("workflow-line-body");
  expect(html).not.toContain("Recent activity");
  // A real stateful render: the component's own hooks drive the toggle, and
  // the captured tree is inspected statically after each click.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { HTMLIFrameElement: class {} });
  const container = Object.assign(new EventTarget(), {
    nodeType: 1,
    tagName: "DIV",
    ownerDocument: new EventTarget(),
  });
  const root = createRoot(container as unknown as HTMLElement);
  let tree!: ReactElement;
  function Probe() {
    tree = WorkflowLine({
      client: new ServiceClient(transport()),
      run: live,
      onOpen: () => {},
    });
    return null;
  }
  try {
    await act(async () => root.render(<Probe />));
    const open = hostButtons(tree).find(
      (button) =>
        (button.props as { className?: string }).className ===
        "workflow-line-open",
    );
    if (!open) throw new Error("the line's open button is missing");
    const toggle = (open.props as { onClick(): void }).onClick;
    await act(async () => toggle());
    const expanded = renderToStaticMarkup(tree);
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded).toContain("workflow-line-body");
    expect(expanded).toContain("Current activity");
    expect(expanded).toContain("implementation · a");
    expect(expanded).toContain("Open workflow details");
    await act(async () => toggle());
    expect(renderToStaticMarkup(tree)).not.toContain("workflow-line-body");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
});
it("an expanded live workflow shows its stages, current work and recent activity", () => {
  const started = 1_060_000,
    now = 1_120_000;
  const live = run({
    tasks: [task("schema", "completed"), task("a", "running")],
    steps: [
      {
        ...step("schema", "implementation", "completed"),
        timing: timing(1_000_000, 1_040_000),
      },
      {
        ...step("a", "implementation", "running"),
        timing: timing(started, null),
      },
    ],
  });
  const html = progress(live, now, "en", () => {});
  // Plan is done, Develop is current, Verify waits; no delivery, no Merge.
  expect(html.match(/workflow-stage done/g)).toHaveLength(1);
  expect(html.match(/workflow-stage current/g)).toHaveLength(1);
  expect(html.match(/workflow-stage pending/g)).toHaveLength(1);
  expect(html).toContain(">Develop<");
  expect(html).not.toContain(">Merge<");
  // The running step says how long it has been going (now - started = 60s).
  expect(html).toContain("Current activity");
  expect(html).toContain("implementation · a");
  expect(html).toContain(">1m 0s</time>");
  // Recent activity re-expresses the step timings, newest first.
  expect(html).toContain("Recent activity");
  expect(html).toContain("Started · implementation · a");
  expect(html).toContain("completed · implementation · schema");
  expect(html).toContain(">2m ago</time>");
  expect(html.indexOf("Started · implementation · a")).toBeLessThan(
    html.indexOf("completed · implementation · schema"),
  );
  // A step with a subagent opens its live context from the board.
  expect(html).toContain("Open subagent context");
  const zh = progress(live, now, "zh");
  expect(zh).toContain("当前进行");
  expect(zh).toContain("最近动态");
  expect(zh).toContain("开始");
  expect(zh).toContain("分钟前");
});
it("a queued or idle run says plainly that no step is running", () => {
  const queued = run({ status: "queued", phase: "planning", steps: [] });
  const html = progress(queued);
  expect(html.match(/workflow-stage pending/g)).toHaveLength(3);
  expect(html).toContain("No step is running right now.");
  expect(html).not.toContain("Recent activity");
  expect(progress(queued, 1_120_000, "zh")).toContain(
    "此刻没有正在运行的步骤。",
  );
});
it("a completed delivery's progress shows its merge evidence and elapsed time", () => {
  const delivery = observed();
  delivery.candidate = "9a94027ea14a0351c29deb872349614ad9bc7513";
  delivery.acceptance = {
    candidate: delivery.candidate,
    tree: "t".repeat(40),
    planDigest: "p".repeat(64),
    contextDigest: "c".repeat(64),
    checks: ["unit-1"],
    review: "review-1",
  };
  delivery.integration.status = "applied";
  delivery.integration.after = delivery.candidate;
  const done = run(
    {
      status: "completed",
      phase: "finished",
      mergedCommit: delivery.candidate,
      delivery,
    },
    1_000_000,
    1_072_000,
  );
  const html = progress(done);
  expect(html.match(/workflow-stage done/g)).toHaveLength(4);
  expect(html).toContain(">Merge<");
  expect(html).toContain(
    "<code>9a94027ea14a0351c29deb872349614ad9bc7513</code>",
  );
  expect(html).toContain("Checks and automatic Agent review passed");
  expect(html).toContain("Time elapsed");
  expect(html).toContain(">1m 12s</dd>");
  expect(html).toContain("Open workflow details");
  const zh = progress(done, 1_120_000, "zh");
  expect(zh).toContain("实际本地合并提交：");
  expect(zh).toContain("检查和自动 Agent review 已通过");
  expect(zh).toContain("已用时间");
});
it("an unmerged delivery marks Merge unmerged and says where the result stayed, and a settled failed run marks its failure stage", async () => {
  const delivery = observed();
  delivery.integration.status = "branch";
  delivery.integration.reason =
    "the target moved and verification could not finish";
  const unmerged = run(
    { status: "completed", phase: "finished", delivery },
    1_000_000,
    1_072_000,
  );
  const html = progress(unmerged);
  expect(html.match(/workflow-stage done/g)).toHaveLength(3);
  expect(html.match(/workflow-stage unmerged/g)).toHaveLength(1);
  expect(html).toContain("Local integration");
  expect(html).toContain(
    "not merged into main; the result is on cadence/feature-",
  );
  // Real settled failed runs carry phase: "finished"; the stage bar must still
  // identify the exact stage where it stopped, never all-green done.
  const failedPlan = run({
    status: "failed",
    phase: "finished",
    tasks: [],
    steps: [step("route-plan", "planning", "failed")],
    notice: "route planning blocked",
  });
  const planHtml = progress(failedPlan);
  expect(planHtml.match(/workflow-stage done/g)).toBeNull();
  expect(planHtml.match(/workflow-stage failed/g)).toHaveLength(1);
  expect(planHtml.match(/workflow-stage pending/g)).toHaveLength(2);
  expect(planHtml).toContain("workflow-outcome-notice");

  const failedDev = run({
    status: "failed",
    phase: "finished",
    tasks: [task("a", "failed")],
    steps: [step("a", "implementation", "failed")],
    notice: "checks failed\nfix required",
  });
  const devHtml = progress(failedDev);
  expect(devHtml.match(/workflow-stage done/g)).toHaveLength(1);
  expect(devHtml.match(/workflow-stage failed/g)).toHaveLength(1);
  expect(devHtml.match(/workflow-stage pending/g)).toHaveLength(1);
  expect(devHtml).toContain("checks failed");
  expect(devHtml).toContain("fix required");
  expect(devHtml).not.toContain("Current activity");

  const failedVerify = run({
    status: "canceled",
    phase: "finished",
    tasks: [task("a", "completed")],
    steps: [
      step("a", "implementation", "completed"),
      step("unit", "check", "failed"),
    ],
    notice: "canceled",
  });
  const verifyHtml = progress(failedVerify);
  expect(verifyHtml.match(/workflow-stage done/g)).toHaveLength(2);
  expect(verifyHtml.match(/workflow-stage failed/g)).toHaveLength(1);

  const mergeFailedDelivery = observed();
  mergeFailedDelivery.candidate = "a".repeat(40);
  mergeFailedDelivery.acceptance = {
    candidate: "a".repeat(40),
    tree: "b".repeat(40),
    planDigest: "c".repeat(64),
    contextDigest: "d".repeat(64),
    checks: ["unit"],
    review: "review-1",
  };
  mergeFailedDelivery.integration.status = "blocked";
  const failedMerge = run({
    status: "failed",
    phase: "finished",
    delivery: mergeFailedDelivery,
    tasks: [task("a", "completed")],
    steps: [
      step("a", "implementation", "completed"),
      step("review-1", "review", "completed"),
    ],
    notice: "merge blocked",
  });
  const mergeHtml = progress(failedMerge);
  expect(mergeHtml.match(/workflow-stage done/g)).toHaveLength(3);
  expect(mergeHtml.match(/workflow-stage failed/g)).toHaveLength(1);

  // Expanding a failed line hides the collapsed single-line reason so the
  // notice is shown once, full, inside workflow-outcome-notice.
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("window", { HTMLIFrameElement: class {} });
  const container = Object.assign(new EventTarget(), {
    nodeType: 1,
    tagName: "DIV",
    ownerDocument: new EventTarget(),
  });
  const root = createRoot(container as unknown as HTMLElement);
  let tree!: ReactElement;
  function Probe() {
    tree = WorkflowLine({
      client: new ServiceClient(transport()),
      run: failedDev,
      onOpen: () => {},
    });
    return null;
  }
  try {
    await act(async () => root.render(<Probe />));
    expect(renderToStaticMarkup(tree)).toContain("workflow-line-reason");
    const open = hostButtons(tree).find(
      (b) =>
        (b.props as { className?: string }).className === "workflow-line-open",
    );
    if (!open) throw new Error("the line's open button is missing");
    await act(async () => (open.props as { onClick(): void }).onClick());
    const expandedHtml = renderToStaticMarkup(tree);
    expect(expandedHtml).not.toContain("workflow-line-reason");
    expect(expandedHtml).toContain("workflow-outcome-notice");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }

  // Paginated runs pass partial to AssignmentBoard; empty completed runs omit
  // <dl class="workflow-outcome">; equal start/settle timestamps put settle first.
  const paginated = run({
    status: "completed",
    phase: "finished",
    stepsBefore: 5,
    tasks: [task("a", "completed")],
    steps: [
      {
        ...step("a", "implementation", "completed"),
        timing: timing(1_000_000, 1_000_000),
      },
    ],
  });
  const pageHtml = progress(paginated);
  expect(pageHtml).toContain(
    "Only the steps on this page are grouped below; other pages hold more.",
  );
  expect(pageHtml).not.toContain('<dl class="workflow-outcome">');
  expect(pageHtml.indexOf("completed · implementation · a")).toBeLessThan(
    pageHtml.indexOf("Started · implementation · a"),
  );
});
it("a completed delivery states its deviations on its line and leads its view with each of them", () => {
  const deviations = [
    {
      revision: 2,
      item: "Acceptance 3: the export finishes in under 2 seconds",
      reason: "The upstream API allows 20 rows per request (step export-9)",
      delivered: "A paged export that finishes in about 6 seconds",
      waives: ["perf-budget"],
    },
    {
      revision: 3,
      item: "Decision: keep the CSV column order",
      reason: "The new parser sorts columns by name",
      delivered: "Columns in name order, documented in the README",
      waives: [],
    },
  ];
  const delivered = run(
    {
      status: "completed",
      phase: "finished",
      revision: 3,
      mergedCommit: "9a94027ea14a0351c29deb872349614ad9bc7513",
      deviations,
    },
    1_000_000,
    1_072_000,
  );
  const html = line(delivered);
  expect(html).toContain(
    'title="completed · delivered with 2 deviations · merged 9a94027 · 1m 12s"',
  );
  expect(html).toMatch(
    /completed · <span class="workflow-line-deviation"><svg[^>]*>.*?<\/svg>delivered with 2 deviations<\/span> · merged 9a94027 · 1m 12s<\/span>/,
  );
  expect(line(delivered, "zh")).toContain("交付时有 2 处偏离");
  expect(line({ ...delivered, deviations: deviations.slice(0, 1) })).toContain(
    "delivered with 1 deviation<",
  );
  // "Delivered" is claimed only by a completed run; a live or failed one
  // keeps its own state on the line and its deviations in its view.
  for (const status of ["running", "failed"] as const) {
    const other = line({ ...delivered, status });
    expect(other).not.toContain("delivered with");
    expect(other).not.toContain("workflow-line-deviation");
  }
  expect(line({ ...delivered, deviations: [] })).toContain(
    "completed · merged 9a94027 · 1m 12s",
  );
  const view = (r: WorkflowRun, locale: "en" | "zh" = "en") =>
    renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <Deviations run={r} />
      </LocaleProvider>,
    );
  const list = view(delivered);
  expect(list).toContain("Deviations from the agreement: 2");
  expect(list.match(/<li>/g)).toHaveLength(2);
  for (const d of deviations)
    for (const text of [d.item, d.reason, d.delivered])
      expect(list).toContain(`<dd>${text}</dd>`);
  expect(list).toContain(
    "<dt>Checks set aside</dt><dd><code>perf-budget</code></dd>",
  );
  expect(list).toContain("<dt>Checks set aside</dt><dd>None</dd>");
  expect(list).toContain("<dd>route revision 3</dd>");
  expect(list).toContain("it is not human review");
  expect(view(delivered, "zh")).toContain("与约定的偏离：2 处");
  expect(view(run())).toBe("");
});
it("shows unknown from the run and the step independently of phase and task state", () => {
  const r = run({ status: "unknown", phase: "verifying" });
  const probe = step("probe", "check", "unknown");
  expect(renderToStaticMarkup(<WorkflowRunState run={r} />)).toContain(
    'verifying · <span class="workflow-status unknown">unknown</span>',
  );
  expect(
    renderToStaticMarkup(<WorkflowStepSummary run={run()} step={probe} />),
  ).toBe(
    'check · probe · <span class="workflow-status unknown">unknown</span>',
  );
});
it("a check a deviation set aside reads as set aside and failed, never as passed", () => {
  const perf = step("perf-budget", "check", "failed");
  const unit = step("unit", "check", "completed");
  const earlier = step("perf-budget", "check", "failed");
  const review = step("review", "review", "completed");
  const delivery = observed();
  delivery.candidate = "b".repeat(40);
  delivery.acceptance = {
    candidate: delivery.candidate,
    tree: "c".repeat(40),
    planDigest: "d".repeat(64),
    contextDigest: "e".repeat(64),
    checks: [unit.id, perf.id],
    review: review.id,
    waived: [perf.id],
  };
  const accepted = run({
    status: "completed",
    phase: "finished",
    delivery,
    deviations: [
      {
        revision: 2,
        item: "Acceptance 3",
        reason: "Impossible",
        delivered: "Closest",
        waives: ["perf-budget"],
      },
    ],
    steps: [earlier, unit, perf, review],
  });
  expect(checkSetAside(accepted, perf)).toBe(true);
  expect(checkSetAside(accepted, unit)).toBe(false);
  // The same check's earlier failure, before the deviation, is only a failure.
  expect(checkSetAside(accepted, earlier)).toBe(false);
  expect(checkSetAside(accepted, review)).toBe(false);
  const summary = (
    r: WorkflowRun,
    s: WorkflowStep,
    locale: "en" | "zh" = "en",
  ) =>
    renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <WorkflowStepSummary run={r} step={s} />
      </LocaleProvider>,
    );
  expect(summary(accepted, perf)).toBe(
    'check · perf-budget · <span class="workflow-status failed">failed</span><span class="workflow-set-aside">set aside by a recorded deviation</span>',
  );
  expect(summary(accepted, earlier)).toBe(
    'check · perf-budget · <span class="workflow-status failed">failed</span>',
  );
  expect(summary(accepted, unit)).toBe(
    'check · unit · <span class="workflow-status completed">completed</span>',
  );
  expect(summary(accepted, perf, "zh")).toContain("已被记录的偏离搁置");
  // A direct working-copy delivery has no acceptance record: its verification
  // lists the round, and only a failed check a deviation names is set aside.
  const direct = run({
    ...accepted,
    delivery: undefined,
    verification: {
      id: randomUUID(),
      source: "f".repeat(64),
      steps: [unit.id, perf.id, review.id],
    },
  });
  expect(checkSetAside(direct, perf)).toBe(true);
  expect(checkSetAside(direct, earlier)).toBe(false);
  expect(checkSetAside({ ...direct, deviations: [] }, perf)).toBe(false);
  // The acceptance line never says the checks passed when one was set aside.
  const facts = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <DeliveryDetails delivery={delivery} status="completed" />
    </LocaleProvider>,
  );
  expect(facts).toContain(
    "Accepted with 1 of 2 checks set aside by a recorded deviation; the others and the automatic Agent review passed",
  );
  expect(facts).not.toContain("Checks and automatic Agent review passed");
  expect(facts.match(/<dt>/g)).toHaveLength(9);
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
  const dock = (runs: RunProjection[], locale: "en" | "zh" = "en") =>
    renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <AgentDock
          kind="task"
          runs={runs}
          unavailable={false}
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

it("automatic recovery and knowledge progress remain live and do not request another approval", () => {
  for (const [phase, kind, label] of [
    ["recovering", "diagnosis", "自动诊断与恢复"],
    ["learning", "knowledge", "沉淀项目知识"],
  ] as const) {
    const current = run({
      phase,
      revision: 3,
      steps: [step("next", kind, "running")],
    });
    const html = line(current, "zh");
    expect(html).toContain(label);
    expect(html).toContain("停止");
    expect(html).not.toContain("Implement this plan");
  }
  const s = state();
  if (!s.proposal) throw new Error("Missing fixture agreement");
  const html = renderToStaticMarkup(
    <PlanCard proposal={s.proposal} canApprove onApprove={() => {}} />,
  );
  expect(html).toContain("Complete delivery agreement");
  expect(html).toContain("<details>");
  // The statement of what one approval covers stands beside the plan.
  expect(html).toContain(
    "After approval the service plans parallel tasks from the codebase",
  );
  expect(html).toContain("Assumptions (confirmed by approval)");
  expect(html).not.toContain("At most 2 repair rounds");
});
it("delivery UI distinguishes an accepted candidate from an applied merge and names retained workspaces", () => {
  const d = deliveryObservation(
    {
      policy: "task-branch-v3",
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
  const card = (status: WorkflowRun["status"]) =>
    renderToStaticMarkup(
      <LocaleProvider initial="en">
        <DeliveryDetails delivery={d} status={status} />
      </LocaleProvider>,
    );
  expect(card("failed")).toContain("Not executed");
  expect(card("failed")).not.toMatch(/pending|Not recorded/);
  expect(card("unknown")).toContain("Not recorded");
  expect(card("unknown")).not.toMatch(/pending|Not executed/);
  expect(card("queued")).toContain("pending");
  d.preparation = "ready";
  expect(card("failed")).toContain("Not recorded");
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
      <DeliveryDetails delivery={d} status="failed" />
    </LocaleProvider>,
  );
  // The shared dl grid expects direct term/value children. Nested row divs
  // become max-content outer columns and clip the remaining delivery facts.
  expect(html).toContain("<dl><dt>");
  expect(html).not.toContain("<dl><div");
  expect(html.match(/<dt>/g)).toHaveLength(9);
  expect(html.match(/<dd>/g)).toHaveLength(9);
  expect(html).toContain(d.taskBranch);
  expect(html).toContain(d.worktreeRoot);
  expect(html).toContain("Checks and automatic Agent review passed");
  expect(html).toContain("blocked");
  expect(html).toContain("Target changed; candidate retained.");
  expect(html).toContain("Ignored user data remains.");
  expect(html).not.toContain("Actual local merge commit");
  const zh = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <DeliveryDetails delivery={d} status="failed" />
    </LocaleProvider>,
  );
  expect(zh).toContain("任务分支");
  expect(zh).toContain("候选验收");
  // A current delivery says how the branch was moved once it was; nothing is
  // checked in the user's checkout, so there is no post-merge row.
  expect(html).not.toContain("Post-merge checks");
  expect(html).not.toContain("Target branch update");
  d.integration = {
    status: "applied",
    before: "a".repeat(40),
    after: d.candidate,
    reason: "",
    sync: { mode: "ref", worktree: null },
  };
  expect(card("completed")).toContain(
    "<dt>Target branch update</dt><dd><code>Branch reference only; no worktree had it checked out</code></dd>",
  );
  d.integration.sync = { mode: "fast-forward", worktree: "/fixture" };
  expect(card("completed")).toContain("Fast-forward in /fixture");
  // Uncommitted changes to the same files were carried over: where they are
  // as they were is part of the delivery's own record.
  const backup = "refs/cadence/wip-backup/0f8b1a52-7a3c-4f0e-9d51-2f6c1e7a9b10";
  const carried = {
    ...d,
    integration: {
      ...d.integration,
      sync: {
        mode: "wip" as const,
        worktree: "/fixture",
        backup: { ref: backup, oid: "c".repeat(40) },
        fused: ["a.txt", "b.txt"],
      },
    },
  };
  expect(decodeDeliveryObservation(carried)).toEqual(carried);
  expect(
    renderToStaticMarkup(
      <LocaleProvider initial="en">
        <DeliveryDetails delivery={carried} status="completed" />
      </LocaleProvider>,
    ),
  ).toContain(
    `Fast-forward in /fixture; uncommitted changes to 2 files carried over, as they were in ${backup}`,
  );
  expect(
    renderToStaticMarkup(
      <LocaleProvider initial="zh">
        <DeliveryDetails delivery={carried} status="completed" />
      </LocaleProvider>,
    ),
  ).toContain(`2 个文件的未提交改动已带到新提交上，原样保存在 ${backup}`);
  // A backup only ever belongs to that mode, under that private namespace.
  for (const sync of [
    {
      mode: "fast-forward",
      worktree: "/fixture",
      backup: carried.integration.sync.backup,
      fused: [],
    },
    { mode: "wip", worktree: "/fixture" },
    {
      mode: "wip",
      worktree: "/fixture",
      backup: { ref: "refs/heads/main", oid: "c".repeat(40) },
      fused: [],
    },
  ])
    expect(() =>
      decodeDeliveryObservation({
        ...d,
        integration: { ...d.integration, sync },
      }),
    ).toThrow();
  const zhLanded = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <DeliveryDetails delivery={d} status="completed" />
    </LocaleProvider>,
  );
  expect(zhLanded).toContain("目标分支更新");
  expect(zhLanded).toContain("在 /fixture 中快进");
  // A retained run still shows the checks it once reran in the target.
  const retained = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <DeliveryDetails
        delivery={{ ...d, postChecks: "passed" }}
        status="completed"
      />
    </LocaleProvider>,
  );
  expect(retained).toContain(
    "<dt>Post-merge checks</dt><dd><code>passed</code></dd>",
  );
  // Accepted as one of several deliveries landed together: where it was
  // verified is part of the evidence.
  const grouped = {
    ...d,
    acceptance: d.acceptance && {
      ...d.acceptance,
      group: { run: randomUUID(), tip: "e".repeat(40) },
    },
  };
  expect(decodeDeliveryObservation(grouped)).toEqual(grouped);
  expect(
    renderToStaticMarkup(
      <LocaleProvider initial="en">
        <DeliveryDetails delivery={grouped} status="completed" />
      </LocaleProvider>,
    ),
  ).toContain(
    `Checks and automatic Agent review passed · ${d.candidate} · together with other deliveries, as ${"e".repeat(40)}`,
  );
  expect(
    renderToStaticMarkup(
      <LocaleProvider initial="zh">
        <DeliveryDetails delivery={grouped} status="completed" />
      </LocaleProvider>,
    ),
  ).toContain(`与其他交付一起验证，链尾提交 ${"e".repeat(40)}`);
  // A verified result that stayed on its task branch, with the reason.
  d.integration = {
    status: "branch",
    before: "a".repeat(40),
    after: null,
    reason:
      "Completed, not merged into main: refs/heads/main no longer exists.",
  };
  expect(card("completed")).toContain(
    "<dt>Local integration</dt><dd><code>Not merged; delivered on the task branch</code></dd>",
  );
  expect(card("completed")).toContain(
    "<p>Completed, not merged into main: refs/heads/main no longer exists.</p>",
  );
  expect(card("completed")).not.toContain("Target branch update");
  expect(
    renderToStaticMarkup(
      <LocaleProvider initial="zh">
        <DeliveryDetails delivery={d} status="completed" />
      </LocaleProvider>,
    ),
  ).toContain("未合入；已交付到任务分支");
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
  // A current agreement binds the branch, not a commit: whatever the branch
  // gains before or during the run is followed, so no head is shown.
  s.proposal.delivery = {
    policy: "task-branch-v3",
    target: {
      checkoutRoot: "/fixture",
      repository: "/fixture/.git",
      repositoryIdentity: "a".repeat(64),
      branch: "refs/heads/release",
    },
  };
  const current = renderToStaticMarkup(
    <PlanCard proposal={s.proposal} canApprove={true} onApprove={() => {}} />,
  );
  expect(current).toContain(
    "Target: refs/heads/release (its head when the run is admitted is the baseline)",
  );
  expect(current).not.toContain("refs/heads/release @");
  expect(current).toContain("replayed onto its current head");
  expect(current).toContain("Keep the task branch");
});

it("a plan is a decision card, not an error banner, and unavailable approval explains itself", () => {
  const proposal = state().proposal;
  if (!proposal) throw new Error("fixture proposal missing");
  const html = renderToStaticMarkup(
    <PlanCard proposal={proposal} canApprove={false} onApprove={() => {}} />,
  );
  expect(html).toContain('class="workflow-plan"');
  expect(html).not.toContain("banner-notice");
  expect(html).toContain("Plan approval is currently unavailable.");
  expect(html).toContain("Complete delivery agreement");
  expect(html).toContain("No push, publication or deployment.");
});

it("a changed runtime observation is not approved even when plan ID and digest are unchanged", async () => {
  const displayed = state(),
    changed = structuredClone(displayed);
  if (!changed.proposal) throw Error("proposal");
  changed.proposal.observation = "c".repeat(64);
  const c = client(changed);
  await expect(
    approveWorkflow({
      client: c.api,
      state: displayed,
      current: () => true,
      submitting: () => {},
    }),
  ).rejects.toThrow("stale");
  expect(c.commands).toHaveLength(1);
});

it.each(["en", "zh"] as const)(
  "%s distinguishes incomplete reports from failed attempts without inferring delivery",
  (locale) => {
    const steps: WorkflowStep[] = ["partial", "blocked", "failed"].map(
      (status, i) => ({
        id: `repair-${i}`,
        childRunId: randomUUID(),
        kind: "implementation",
        status: status as WorkflowStep["status"],
        text: "",
        exitCode: status === "failed" ? 1 : 0,
        truncated: false,
      }),
    );
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <WorkflowAttemptSummary steps={steps} />
      </LocaleProvider>,
    );
    expect(html).toContain(locale === "en" ? "1 partial" : "1 项部分完成");
    expect(html).toContain(locale === "en" ? "1 blocked" : "1 项受阻");
    expect(html).toContain(locale === "en" ? "1 failed" : "1 项失败");
    expect(html).toContain(
      locale === "en"
        ? "not process failures or delivery approval"
        : "不代表进程故障",
    );
    const record = run();
    const dock = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <WorkflowAgentGroup run={record} steps={steps} />
      </LocaleProvider>,
    );
    expect(dock).toContain("agent-dot partial");
    expect(dock).toContain("agent-dot blocked");
  },
);

it("the Web design controls split pending composer strip, scrolling submitted summary and modal", () => {
  const d = newDesign(
    randomUUID(),
    { questions: designQuestionsFixture },
    undefined,
    1_500,
  );
  const dialogHtml = (draft: typeof d, open = true, disabled = false) =>
    renderToStaticMarkup(
      <DesignDialog
        draft={draft}
        open={open}
        disabled={disabled}
        onClose={() => {}}
        onEdit={() => {}}
        onSubmit={() => {}}
      />,
    );
  const open = dialogHtml(d);
  expect(open).toContain("<dialog");
  expect(dialogHtml(d, false)).not.toContain("<dialog");
  expect(open).toContain("Quieter surfaces");
  expect(open).toContain("Which motion?");
  expect(open).toContain("Other idea");
  expect(open).not.toContain("How much blur?");
  const bar = renderToStaticMarkup(
    <DesignBar draft={d} active onOpen={() => {}} />,
  );
  expect(bar).toContain("composer-anchor design-bar");
  expect(bar).toContain("0 of 2 questions answered");
  expect(bar).toContain("Choose answers");
  const selected = reviseDesign(
    d,
    [{ question: "surface", option: "everywhere" }],
    true,
  );
  const line = renderToStaticMarkup(
    <DesignLine draft={selected} active onOpen={() => {}} />,
  );
  expect(line).toContain("workflow-line design-line");
  expect(line).toContain("Design submitted");
  expect(line).toContain("Review choices");
  expect(line).toContain("Everywhere");
  expect(line).not.toContain("<dialog");
  expect(line).not.toContain("Confirm implementation");
  const submittedDialog = dialogHtml(selected);
  expect(submittedDialog).toContain("How much blur?");
  expect(submittedDialog).not.toContain("Submit design");
  const zhLine = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <DesignLine draft={selected} active onOpen={() => {}} />
    </LocaleProvider>,
  );
  expect(zhLine).toContain("设计选项");
  expect(zhLine).toContain("设计已提交");
  expect(zhLine).toContain("查看或修改选择");
  const turns = [
    { header: { id: "t1", at: 1_000 } },
    { header: { id: "t2", at: 2_000 } },
  ];
  expect(placeDesign(turns, d, false)).toEqual({ kind: "none" });
  expect(placeDesign(turns, selected, false)).toEqual({
    kind: "after",
    turnId: "t1",
  });
  expect(placeDesign(turns, { ...selected, at: 500 }, false)).toEqual({
    kind: "start",
  });
  expect(placeDesign(turns, { ...selected, at: 500 }, true)).toEqual({
    kind: "none",
  });
  expect(placeDesign(turns, { ...selected, at: undefined }, false)).toEqual({
    kind: "end",
  });
});

it("labels the displayed bounded file and its copy action in the selected locale", () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <RetainedStepResult
        file={{
          kind: "file",
          path: "result",
          text: "  bounded result\n",
          limited: true,
        }}
      />
    </LocaleProvider>,
  );
  expect(html).toContain('aria-label="复制输出"');
  expect(html).toContain("步骤结果");
  expect(html).toContain("预览已截断。");
  expect(html).toContain("  bounded result\n</pre>");
});

it("renders V5 planning phase and step kind in English and Chinese", () => {
  const planningRun: WorkflowRun = {
    id: randomUUID(),
    epoch: randomUUID(),
    goal: "Plan V5 route",
    status: "running",
    phase: "planning",
    notice: "",
    mergedCommit: null,
    humanReviewed: false,
    steps: [
      {
        id: `plan-route-${randomUUID()}`,
        childRunId: randomUUID(),
        kind: "planning",
        status: "running",
        text: "",
        exitCode: null,
        truncated: false,
      },
    ],
  };
  const en = renderToStaticMarkup(
    <LocaleProvider initial="en">
      <WorkflowRunState run={planningRun} />
      <WorkflowStepSummary run={planningRun} step={planningRun.steps[0]} />
    </LocaleProvider>,
  );
  expect(en).toContain("planning");
  expect(en).toContain("plan-route");
  const zh = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <WorkflowRunState run={planningRun} />
      <WorkflowStepSummary run={planningRun} step={planningRun.steps[0]} />
    </LocaleProvider>,
  );
  expect(zh).toContain("规划中");
});
