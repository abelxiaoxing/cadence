// The new-task composer and the per-task next-step bar. They only open panels
// or request previews; every effect still needs its own confirmation.
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import {
  type ActiveRunRef,
  type ContextVersion,
  decodeRunProjection,
  type RunProjection,
} from "../../src/service-contract.ts";
import {
  Composer,
  submitsDraft,
} from "../../web/src/components/workspace/Composer";
import {
  TaskFlow,
  taskStage,
} from "../../web/src/components/workspace/TaskFlow";
import { LocaleProvider } from "../../web/src/i18n/locale";
import { context, coverage, hash, id } from "./fixtures";

function run(
  c: ContextVersion,
  kind: "start" | "check" = "start",
): RunProjection {
  return decodeRunProjection({
    runId: id(),
    taskId: c.task?.id,
    childRunId: null,
    assignmentId: null,
    admission: {
      operationId: id(),
      commandId: id(),
      kind,
      context: c,
      assignments:
        kind === "start" ? [{ assignmentId: "inspect", childRunId: id() }] : [],
      graph:
        kind === "start"
          ? { recordId: id(), revision: c.task?.graphRevision, sha256: hash }
          : null,
    },
    lifecycle: "settled",
    outcome: "unknown",
    settlement: null,
    reason: null,
    publication: "uncertain",
    coverage,
    result: null,
  });
}
function active(c: ContextVersion, kind: ActiveRunRef["kind"]): ActiveRunRef {
  return {
    taskId: c.task?.id ?? id(),
    runId: id(),
    operationId: id(),
    epoch: c.epoch,
    kind,
    stage: "active",
  };
}
function unplanned(kind: "code" | "research" = "code"): ContextVersion {
  const c = context();
  if (!c.task) throw new Error("fixture-task");
  c.task = { ...c.task, kind, graphRevision: null, graphIdentity: null };
  return c;
}
const flow = (
  props: Partial<Parameters<typeof TaskFlow>[0]> & {
    context: ContextVersion | null;
  },
) =>
  renderToStaticMarkup(
    <TaskFlow
      runs={[]}
      active={undefined}
      rosterComplete
      canAct
      cancelCompatible
      canceling={false}
      onGenerate={() => {}}
      onStart={() => {}}
      onPanel={() => {}}
      onCancel={() => {}}
      {...props}
    />,
  );

it("derives the next step from the saved graph, observed runs and the roster", () => {
  const saved = context();
  expect(taskStage(null, [], undefined)).toBe("unavailable");
  expect(taskStage(unplanned(), [], undefined)).toBe("plan");
  expect(taskStage(saved, [], undefined)).toBe("ready");
  // A settled check is not an execution of the saved graph.
  expect(taskStage(saved, [run(saved, "check")], undefined)).toBe("ready");
  expect(taskStage(saved, [run(saved)], undefined)).toBe("verify");
  // The roster is the authority for running work, whatever the history shows.
  expect(taskStage(saved, [run(saved)], active(saved, "start"))).toBe(
    "running",
  );
});

it("offers only previews and panels for each step, never an effect", () => {
  const plan = flow({ context: unplanned() });
  expect(plan).toContain("Generate plan proposal");
  expect(plan).toContain("Edit plan");
  expect(plan).not.toContain("Start execution");
  // Readonly Generate is a code-task proposal only.
  expect(flow({ context: unplanned("research") })).not.toContain(
    "Generate plan proposal",
  );
  const saved = context();
  const ready = flow({ context: saved });
  expect(ready).toContain("Plan saved (revision 1)");
  expect(ready).toContain("Start execution");
  expect(flow({ context: saved, canAct: false })).toMatch(
    /disabled=""[^>]*>.*?Start execution/,
  );
  const verify = flow({ context: saved, runs: [run(saved)] });
  expect(verify).toContain("Last run settled: unknown");
  expect(verify).toContain("Run checks");
  expect(verify).toContain("Review");
  expect(flow({ context: null })).not.toContain("<button");
});

it("a running step keeps explicit Stop, disabled without a compatible cancel", () => {
  const saved = context();
  const running = flow({ context: saved, active: active(saved, "start") });
  expect(running).toContain("Leaving this page does not cancel it.");
  expect(running).toContain("Stop this run");
  expect(running).toContain('aria-current="step"');
  expect(
    flow({
      context: saved,
      active: active(saved, "start"),
      cancelCompatible: false,
    }),
  ).toMatch(/disabled=""[^>]*>.*?Stop this run/);
  expect(
    flow({
      context: saved,
      active: active(saved, "start"),
      rosterComplete: false,
    }),
  ).toContain("absence is not proof of settlement");
});

it("the composer requests a Create preview on plain Enter only", () => {
  const key = (over: Partial<Parameters<typeof submitsDraft>[0]> = {}) =>
    submitsDraft({
      key: "Enter",
      shiftKey: false,
      keyCode: 13,
      nativeEvent: { isComposing: false },
      ...over,
    });
  expect(key()).toBe(true);
  expect(key({ shiftKey: true })).toBe(false);
  expect(key({ nativeEvent: { isComposing: true } })).toBe(false);
  expect(key({ keyCode: 229 })).toBe(false);
  expect(key({ key: "a" })).toBe(false);
});

it("the composer says why Create is unavailable and names the model state", () => {
  const html = renderToStaticMarkup(
    <LocaleProvider initial="zh">
      <Composer
        inputRef={createRef()}
        goal="修复"
        onGoal={() => {}}
        kind="research"
        onKind={() => {}}
        model={null}
        onModel={() => {}}
        canSubmit={false}
        blocked="请先选择模型"
        onSubmit={() => {}}
      />
    </LocaleProvider>,
  );
  expect(html).toContain('role="status">请先选择模型');
  expect(html).toContain("先选择模型");
  expect(html).toContain("创建不会启动");
  expect(html).toMatch(/aria-label="预览创建（不会启动）"[^>]*disabled=""/);
  expect(html).toContain('<option value="research" selected="">');
});
