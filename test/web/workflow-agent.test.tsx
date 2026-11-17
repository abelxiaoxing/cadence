import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import type {
  ChatTurn,
  WorkbenchRead,
} from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { WorkflowAgentView } from "../../web/src/components/workspace/WorkflowAgentView";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { transport } from "./fixtures";

const observed = vi.hoisted(() => ({
  run: null as WorkflowRun | null,
  transcript: null as ChatTurn | null,
  reads: [] as { request: WorkbenchRead | null; interval: number }[],
}));
vi.mock("../../web/src/client/use-workbench", () => ({
  useWorkbench: (
    _client: unknown,
    read: WorkbenchRead | null,
    interval = 0,
  ) => {
    observed.reads.push({ request: read, interval });
    return {
      value:
        read?.kind === "workflow"
          ? { kind: "workflow", response: { type: "run", run: observed.run } }
          : read?.kind === "workflow-transcript"
            ? {
                kind: "workflow-transcript",
                runId: read.id,
                stepId: read.stepId,
                turn: observed.transcript,
              }
            : null,
    };
  },
}));

afterEach(() => {
  observed.run = null;
  observed.transcript = null;
  observed.reads = [];
});

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

it.each([
  ["en", "running"],
  ["zh", "running"],
  ["en", "completed"],
  ["zh", "completed"],
  ["en", "failed"],
  ["zh", "failed"],
  ["en", "canceled"],
  ["zh", "canceled"],
] as const)(
  "observed workflow transcript reaches real tool cards independently of reply/workflow outcomes (%s, %s)",
  (locale, status) => {
    const run: WorkflowRun = {
      id: randomUUID(),
      epoch: randomUUID(),
      goal: "fixture",
      status: "running",
      phase: "research",
      notice: "",
      mergedCommit: null,
      humanReviewed: false,
      steps: [
        {
          id: "agent",
          childRunId: randomUUID(),
          kind: "research",
          status,
          text: "",
          exitCode: null,
          truncated: false,
        },
      ],
    };
    observed.run = run;
    observed.transcript = {
      id: run.steps[0].childRunId ?? randomUUID(),
      epoch: run.epoch,
      status,
      notice: "",
      omitted: { thinking: false, media: false, other: false },
      items: [
        {
          id: "answer",
          role: "assistant",
          name: "",
          args: "",
          text: "**Observed** subagent reply",
          error: false,
        },
        ...(["running", "completed", "failed", undefined] as const).map(
          (state, i) => ({
            id: `call-${i}`,
            role: "tool" as const,
            name: `fixture-tool-${i}`,
            args: "{}",
            text: `retained output ${i}`,
            error: state === "failed",
            ...(state ? { state } : {}),
          }),
        ),
      ],
    };
    // These are controlled public observations, not the backend producer.
    // SSR executes WorkflowAgentView -> recordedTurn -> ChatTurnView -> ToolStep.
    const html = renderToStaticMarkup(
      <LocaleProvider initial={locale}>
        <WorkflowAgentView
          client={new ServiceClient(transport())}
          agent={{ runId: run.id, stepId: "agent", label: "fixture" }}
          backLabel="Back"
          onBack={() => {}}
          onOpenAgent={() => {}}
        />
      </LocaleProvider>,
    );
    expect(html).toContain("<strong>Observed</strong> subagent reply");
    expect(html.match(/class="toolcall /g)).toHaveLength(4);
    const labels =
      locale === "en"
        ? [
            "Tool call in progress",
            "Tool result recorded",
            "Tool error recorded",
            "No tool result observed",
          ]
        : [
            "工具调用进行中",
            "已记录工具结果",
            "已记录工具错误",
            "未观察到工具结果",
          ];
    const classes = [
      status === "running" ? "run" : "idle",
      "ok",
      "err",
      "idle",
    ];
    const cards = html.split('<div class="toolcall ').slice(1);
    cards.forEach((card, i) => {
      expect(card).toMatch(new RegExp(`^${classes[i]}">`));
      expect(card).toContain(`toolcall-name">fixture-tool-${i}</span>`);
      expect(card).toContain(
        `aria-label="${labels[i === 0 && status !== "running" ? 3 : i]}"`,
      );
      expect(card).toContain('aria-expanded="false"');
      expect(card).not.toContain(`retained output ${i}`);
    });
    // A completed/failed tool does not settle the reply or the workflow;
    // conversely a failed/canceled reply cannot erase a recorded tool result.
    expect(html).toContain(`class="ep-state ${status}"`);
    expect(html).toContain(` · ${locale === "en" ? "running" : "运行中"}</p>`);
    if (status === "failed" || status === "canceled")
      expect(html).toContain(`<p class="ep-state ${status}">`);
    expect(
      observed.reads.find((r) => r.request?.kind === "workflow-transcript"),
    ).toEqual({
      request: { kind: "workflow-transcript", id: run.id, stepId: "agent" },
      interval: status === "running" ? 1000 : 0,
    });
    expect(
      observed.reads.some((r) => r.request?.kind === "workflow-detail"),
    ).toBe(false);
  },
);
