import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { RuntimeActivityEvent } from "../src/runtime";
import {
  ACTIVITY_REFRESH_MS,
  ACTIVITY_WIDGET_MAX_LINES,
  ACTIVITY_WIDGET_MIN_WIDTH,
  ActivityController,
  ActivityInlineComponent,
  ActivityWidget,
  createActivityDisplay,
  renderActivityWidgetLines,
  sanitizeDisplayText,
  sanitizeFailureReason,
  summarizeDispatchResult,
} from "../src/subagent-activity";

function event(
  state: RuntimeActivityEvent["state"],
  sequence: number,
  requestId = `request-${sequence}`,
): RuntimeActivityEvent {
  return {
    state,
    requestId,
    role: "implementation-worker",
    phase: "green",
    objective: `Objective ${requestId}`,
    sequence,
  };
}

function entry(
  sequence: number,
  state: "queued" | "running",
  toolCallId = `call-${sequence}`,
) {
  return {
    toolCallId,
    requestId: `request-${sequence}`,
    role: "implementation-worker",
    phase: "green",
    objective: `Objective ${sequence}`,
    state,
    sequence,
    startedAt: 0,
    elapsedMs: sequence * 100,
  } as const;
}

describe("Subagent activity presentation", () => {
  it("keeps widget ordering, line width, and exact overflow accounting bounded", () => {
    const entries = [
      entry(4, "running"),
      entry(1, "queued"),
      entry(3, "running"),
      entry(2, "queued"),
      entry(6, "queued"),
      entry(5, "running"),
      entry(7, "running"),
    ];
    for (const width of [60, 30, 20, 15, 10, 7, ACTIVITY_WIDGET_MIN_WIDTH]) {
      const lines = renderActivityWidgetLines(entries, width);
      expect(lines.length).toBeLessThanOrEqual(ACTIVITY_WIDGET_MAX_LINES);
      expect(lines.at(-1)).toMatch(width >= 5 ? /2.*1.*1/ : /1.*1/);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
    const lines = renderActivityWidgetLines(entries, 60);
    expect(lines.join("\n")).toContain("request-1");
    expect(lines.join("\n")).toContain("request-5");
    expect(lines.at(-1)).toBe("+2 more (1 running, 1 queued)");
  });

  it("uses one refresh timer and removes terminal rows immediately", () => {
    let now = 0;
    let nextTimer = 0;
    const setInterval = vi.fn(() => ++nextTimer);
    const clearInterval = vi.fn();
    const ui = {
      setWidget: vi.fn(),
      setStatus: vi.fn(),
    };
    const controller = new ActivityController({
      now: () => now,
      setInterval,
      clearInterval,
    });
    controller.attach(ui);
    const onUpdate = vi.fn();
    controller.accept("call-1", onUpdate, event("queued", 1));
    controller.accept("call-2", onUpdate, event("queued", 2));
    controller.accept("call-1", onUpdate, event("running", 1));
    for (const [partial] of onUpdate.mock.calls) {
      expect(partial.details.activityDisplay).not.toHaveProperty("onUpdate");
    }
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect(setInterval).toHaveBeenCalledWith(
      expect.any(Function),
      ACTIVITY_REFRESH_MS,
    );
    expect(controller.getActiveEntries().map((item) => item.requestId)).toEqual(
      ["request-1", "request-2"],
    );
    now = 250;
    controller.accept("call-1", onUpdate, event("completed", 1));
    expect(controller.getActiveEntries()).toEqual([
      expect.objectContaining({ requestId: "request-2" }),
    ]);
    controller.accept("call-2", onUpdate, event("cancelled", 2));
    expect(controller.getActiveEntries()).toEqual([]);
    expect(clearInterval).toHaveBeenCalledTimes(1);
    expect(ui.setStatus).toHaveBeenLastCalledWith("abel-subagents", undefined);
  });

  it("isolates UI errors and sanitizes unsafe display text", () => {
    const badUi = {
      setWidget: vi.fn(() => {
        throw new Error("widget failed");
      }),
      setStatus: vi.fn(() => {
        throw new Error("status failed");
      }),
    };
    const controller = new ActivityController({
      setInterval: () => 1,
      clearInterval: () => undefined,
    });
    controller.attach(badUi);
    expect(() =>
      controller.accept("call", undefined, event("running", 1)),
    ).not.toThrow();
    const unsafe = sanitizeDisplayText(
      "\u001b]8;;https://model.example\u0007Provider: secret /home/user/private.txt\nnext",
    );
    expect(unsafe).not.toContain("\u001b");
    expect(unsafe).not.toContain("/home/user/private.txt");
    expect(unsafe).not.toContain("model.example");

    const failures = [
      "Request failed for anthropic claude-sonnet-4",
      "openai/gpt-5.4 returned 401",
      "API error from deepseek-chat",
      "failed at /Users/Jane Doe/project/private.ts:10",
    ];
    for (const failure of failures) {
      const safe = sanitizeFailureReason(failure);
      expect(safe).not.toMatch(
        /anthropic|claude|openai|gpt|deepseek|\/Users|private\.ts/i,
      );
    }
  });

  it("[SLICE-5:pi-tool-error] omits next-step metadata from diff summaries", () => {
    const component = new ActivityInlineComponent(
      {
        version: 1,
        kind: "activityDisplay",
        requestId: "request-1",
        role: "implementation-worker",
        phase: "green",
        objective: "safe objective",
        state: "completed",
        elapsedMs: 100,
        summary: {
          kind: "diff",
          summary: "changed one file",
          riskCount: 0,
          retained: true,
        },
      } as never,
      undefined,
      true,
    );
    const rendered = component.render(120).join("\n");
    expect(rendered).toContain("changed one file");
    expect(rendered).not.toContain("next:");
    expect(rendered).not.toContain("parent review");
    expect(rendered).not.toContain("private.txt");
    expect(rendered).not.toContain("model.example");
    expect(rendered).not.toContain("complete citation");
  });

  it("[SLICE-5:pi-tool-error] summarizes a candidate without accepting nextStep", () => {
    const summary = summarizeDispatchResult({
      kind: "candidate",
      requestId: "request-1",
      taskId: "task-1",
      phase: "green",
      resultId: "candidate-1",
      result: {
        id: "request-1",
        role: "implementation-worker",
        kind: "diff",
        taskId: "task-1",
        phase: "green",
        summary: "changed one file",
        diff: "diff bytes stay outside presentation",
        expectedVerification: "target passes",
        risks: ["one bounded risk"],
        contractCompliant: true,
      },
    } as never);

    expect(summary).toEqual({
      kind: "diff",
      summary: "changed one file",
      riskCount: 1,
      retained: true,
    });
    expect(summary).not.toHaveProperty("nextStep");
  });

  it.each([
    ["candidate", "success"],
    ["applied", "success"],
    ["completed", "success"],
    ["deferred", "warning"],
    ["retry", "warning"],
    ["checkpoint-required", "warning"],
    ["blocked", "muted"],
    ["cancelled", "muted"],
  ] as const)(
    "[SLICE-5:pi-tool-error] maps %s outcomes to the %s presentation tone",
    (kind, expectedTone) => {
      const display = createActivityDisplay(event("completed", 1), 100, {
        kind,
      } as never);
      const fg = vi.fn((_color: string, text: string) => text);
      new ActivityInlineComponent(display, { fg }).render(120);

      expect(fg.mock.calls[0]?.[0]).toBe(expectedTone);
    },
  );

  it("[SLICE-5:pi-tool-error] keeps thrown activity in the error presentation tone", () => {
    const display = createActivityDisplay(event("failed", 1), 100);
    const fg = vi.fn((_color: string, text: string) => text);
    new ActivityInlineComponent(display, { fg }).render(120);

    expect(fg.mock.calls[0]?.[0]).toBe("error");
  });

  it("renders a widget component from live controller state", () => {
    const widget = new ActivityWidget(() => [entry(1, "running")]);
    expect(widget.render(80).join("\n")).toContain("request-1");
  });
});
