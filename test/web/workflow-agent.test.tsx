import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { WorkflowAgentView } from "../../web/src/components/workspace/WorkflowAgentView";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { transport } from "./fixtures";

const observed = vi.hoisted(() => ({ run: null as WorkflowRun | null }));
vi.mock("../../web/src/client/use-workbench", () => ({
  useWorkbench: (_client: unknown, read: { kind: string } | null) => ({
    value:
      read?.kind === "workflow"
        ? { kind: "workflow", response: { type: "run", run: observed.run } }
        : null,
  }),
}));

it.each([
  ["en", "rejected", "failed"],
  ["zh", "已拒绝", "失败"],
] as const)(
  "a rejected review keeps its own status without making the workflow successful (%s)",
  (locale, rejected, failed) => {
    const run: WorkflowRun = {
      id: randomUUID(),
      epoch: randomUUID(),
      goal: "Acceptance test coverage",
      status: "failed",
      phase: "finished",
      notice: "Agent review did not approve the candidate.",
      mergedCommit: null,
      humanReviewed: false,
      steps: [
        {
          id: "review",
          childRunId: randomUUID(),
          kind: "review",
          status: "rejected",
          text: "Agent review rejected: missing acceptance test.",
          exitCode: 0,
          truncated: false,
        },
      ],
    };
    observed.run = run;
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <WorkflowAgentView
          client={new ServiceClient(transport())}
          agent={{ runId: run.id, stepId: "review", label: "review" }}
          backLabel="Back"
          onBack={() => {}}
          onOpenAgent={() => {}}
        />
      </LocaleProvider>,
    );
    expect(html).toContain(
      `<span class="ep-state rejected">${rejected}</span>`,
    );
    expect(html).toContain(` · ${failed}</p>`);
    expect(html).toContain("Agent review rejected: missing acceptance test.");
    expect(html).not.toContain('class="ep-state failed"');
    expect(run.steps[0].exitCode).toBe(0);
  },
);
