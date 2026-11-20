import { randomUUID } from "node:crypto";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  readableDelivery,
  readableWorkflowPlan,
  type WorkflowProposal,
} from "../../src/service/contracts/workflow.ts";
import { PlanCard } from "../../web/src/components/workspace/WorkflowPanel";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { plan } from "../helpers/workflow-plan.ts";

function fixture(): WorkflowProposal {
  const epoch = randomUUID();
  return {
    id: randomUUID(),
    epoch,
    digest: "a".repeat(64),
    observation: "b".repeat(64),
    cwd: "/fixture/subfolder",
    checkoutRoot: "/fixture",
    model: {
      epoch,
      accessGeneration: 1,
      configRev: 1,
      catalogId: randomUUID(),
    },
    delivery: {
      policy: "task-branch-v1",
      target: {
        checkoutRoot: "/fixture",
        repository: "/git/common",
        repositoryIdentity: "c".repeat(64),
        branch: "refs/heads/release/reader",
        head: "d".repeat(40),
      },
    },
    display: {
      model: "fixture/model · high",
      branch: "release/reader",
      baseCommit: "d".repeat(40),
      runtime: "Fixture runtime with a different retry policy",
    },
    plan: {
      ...plan(),
      goal: "Deliver a readable export",
      design: "Add a **plain-text** export.",
      decisions: "Keep the existing JSON export.",
      assumptions: "A local viewer is already installed.",
    },
  };
}
const unexpected = () => {
  throw Error("Reading a plan must not dispatch a command");
};
function card(
  proposal: WorkflowProposal,
  props: Partial<Omit<ComponentProps<typeof PlanCard>, "proposal">> = {},
  locale: "en" | "zh" = "en",
) {
  const html = renderToStaticMarkup(
    <LocaleProvider initial={locale}>
      <PlanCard
        proposal={proposal}
        canApprove
        onApprove={unexpected}
        {...props}
      />
    </LocaleProvider>,
  );
  const start = html.indexOf("<details>"),
    end = html.lastIndexOf("</details>") + "</details>".length;
  expect(start).toBeGreaterThan(0);
  expect(html).not.toMatch(/<details\b[^>]*\bopen\b/);
  return {
    summary: html.slice(0, start),
    details: html.slice(start, end),
    actions: html.slice(end),
    html,
  };
}

it("leads with actual state, goal, declared changes and decisions; long terms occur only inside the technical disclosure", () => {
  const proposal = fixture();
  const { summary, details, actions, html } = card(proposal);
  expect(summary).toMatch(
    /Awaiting plan approval.*Deliver a readable export.*plain-text.*Keep the existing JSON export.*What approval allows/s,
  );
  expect(summary).toContain("<strong>plain-text</strong>");
  expect(summary).toContain("/fixture</code> · <code>release/reader");
  expect(summary).toContain("not in a sandbox");
  expect(summary).toContain("Create a task branch and isolated worktrees.");
  expect(summary).toContain("No source, profile or dependency copying.");
  expect(summary).toContain("route and repository write scope");
  expect(summary).toContain("No dependency installation.");
  for (const term of [
    proposal.digest,
    "Fixture runtime",
    proposal.plan.assumptions,
    "refs/heads/release/reader",
    "/git/common",
    "Create a.txt",
  ]) {
    expect(summary).not.toContain(term);
    expect(details).toContain(term);
  }
  // Commands, refs and angle-bracket placeholders are literal text, not Markdown tags.
  for (const text of [
    readableWorkflowPlan(proposal.plan),
    readableDelivery(proposal.delivery),
  ]) {
    const exact = renderToStaticMarkup(<pre>{text}</pre>);
    expect(details).toContain(exact);
    expect(html.split(exact)).toHaveLength(2);
  }
  expect(actions).not.toContain("Keep the task branch");
  expect(actions).toContain("Implement this plan");
});

it("takes delivery and installation rights from this plan, including exact setup-only installs", () => {
  const p = fixture();
  p.plan.delivery = "working-copy";
  delete p.delivery;
  p.plan.decisions = "";
  p.plan.setup = [{ name: "setup", command: "install-approved-fixture" }];
  const direct = card(p);
  expect(direct.summary).not.toContain("Decisions and non-goals");
  expect(direct.summary).toContain("No commit or merge.");
  expect(direct.summary).toContain("keep edits on failure");
  expect(direct.summary).not.toContain("isolated worktrees");
  expect(direct.summary).toContain(
    "Dependency installs are limited to the listed setup commands.",
  );
  expect(direct.details).toContain("install-approved-fixture");
  p.plan.policy = { installs: true };
  expect(card(p).summary).toContain("Revisions may add dependency installs");
  p.plan.version = 2;
  delete p.plan.policy;
  const retained = card(p, { canApprove: false });
  expect(retained.summary).toContain(
    "This retained agreement is read-only. Its declared paths and commands are fixed.",
  );
  expect(retained.summary).not.toContain("adjust the route");
  p.plan.delivery = "local-merge";
  expect(card(p, { canApprove: false }).summary).toContain("no bound target");
});

it("distinguishes a blocked action from an available validation, without calling either decision on render", () => {
  const p = fixture();
  const blocked = card(p, {
    canApprove: false,
    approvalHint: "Reply outcome unknown",
  });
  expect(blocked.summary).toMatch(/role="status">Reply outcome unknown</);
  expect(blocked.summary).not.toContain("Awaiting plan approval");
  expect(blocked.actions).toMatch(/disabled=""[^>]*>Implement this plan</);
  for (const action of ["restore", "validate"] as const) {
    const props = {
      action,
      canApprove: false,
      canValidate: true,
      onValidate: unexpected,
    };
    const { summary, actions } = card(p, props);
    expect(summary).toContain(
      action === "restore"
        ? "Restore execution before approval."
        : "Validation required before approval.",
    );
    expect(actions).not.toMatch(
      /disabled|Implement this plan|Confirm implementation/,
    );
    expect(actions).toContain("confirmation comes afterward");
    const unavailable = card(p, { ...props, canValidate: false });
    expect(unavailable.summary).toContain(
      "Plan validation is currently unavailable.",
    );
    expect(unavailable.actions).toContain("disabled");
  }
});

it("compares only the named prior binding, without duplicating its delivery prose or offering stale actions", () => {
  const prior = fixture(),
    current = fixture();
  current.revalidatedFrom = prior.id;
  current.observation = "e".repeat(64);
  if (!prior.delivery || !prior.display) throw Error("fixture");
  prior.display.runtime = "Previous runtime policy";
  prior.delivery.target.branch = "refs/heads/previous";
  const view = card(current, { previous: prior, onValidate: unexpected });
  expect(view.summary).toContain("Nothing was approved");
  expect(view.summary).toContain("evidence changed");
  expect(view.summary).not.toContain("Previous runtime policy");
  expect(view.details).toContain(prior.delivery.target.branch);
  expect(view.details).toContain("Previous runtime policy");
  expect(view.html.split("Assignments that can run side by side")).toHaveLength(
    2,
  );
  expect(view.actions).toContain("Confirm implementation");
  const replacement = card(fixture(), { previous: prior });
  expect(replacement.html).not.toContain(prior.id);
  expect(replacement.html).not.toContain("Previous runtime policy");
  expect(replacement.actions).not.toContain("Confirm implementation");
});

it("keeps recorded prose intact under Chinese controls and the full English delivery agreement out of the summary", () => {
  const p = fixture();
  const { summary, details, actions } = card(p, {}, "zh");
  expect(summary).toContain("等待批准计划");
  for (const label of [
    "此次变化",
    "已确认决定与保留项",
    "批准范围",
    "不推送、发布或部署。",
  ])
    expect(summary).toContain(label);
  expect(details).toContain("技术详情");
  expect(summary).toContain("工具和检查直接在服务主机运行，不是安全沙箱。");
  expect(summary).toContain("Keep the existing JSON export.");
  expect(summary).not.toContain(
    "Acceptance: checks and automatic Agent review",
  );
  expect(details).toContain("完整交付约定");
  expect(details).toContain("Acceptance: checks and automatic Agent review");
  expect(actions).toContain("按此计划实施");
});
