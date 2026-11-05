import { randomUUID } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { WorkbenchRead } from "../../src/service/contracts/workbench.ts";
import type { WorkflowRun } from "../../src/service/contracts/workflow.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { WorkflowCard } from "../../web/src/components/workspace/WorkflowPanel";
import { transport } from "./fixtures";

const fixture = vi.hoisted(() => ({
  before: 128 as number | undefined,
  current: null as WorkflowRun | null,
  historical: null as WorkflowRun | null,
  reads: [] as { request: WorkbenchRead | null; interval: number }[],
}));
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  return {
    ...react,
    useState: (value: unknown) =>
      react.useState(value === undefined ? fixture.before : value),
  };
});
vi.mock("../../web/src/client/use-workbench", () => ({
  useWorkbench: (
    _client: unknown,
    request: WorkbenchRead | null,
    interval = 0,
  ) => {
    fixture.reads.push({ request, interval });
    const run =
      request?.kind === "workflow"
        ? request.before === undefined
          ? fixture.current
          : fixture.historical
        : null;
    return {
      value: run
        ? { kind: "workflow", response: { type: "run", run } }
        : undefined,
      refresh() {},
    };
  },
}));
it("browsing archived steps keeps polling current run status and does not expose stale Cancel", () => {
  const id = randomUUID();
  fixture.current = {
    id,
    epoch: randomUUID(),
    goal: "Current delivery",
    status: "completed",
    phase: "finished",
    notice: "Current outcome",
    stepsBefore: 256,
    steps: [],
    mergedCommit: null,
    humanReviewed: false,
  };
  fixture.historical = {
    ...fixture.current,
    status: "running",
    phase: "recovering",
    notice: "Old notice",
    stepsBefore: 0,
    steps: [
      {
        id: "archived-step",
        kind: "check",
        status: "completed",
        text: "Retained old evidence",
        truncated: false,
        exitCode: 0,
      },
    ],
  };
  fixture.reads = [];
  const client = new ServiceClient(transport());
  const html = renderToStaticMarkup(<WorkflowCard client={client} id={id} />);
  expect(fixture.reads).toContainEqual({
    request: { kind: "workflow", id },
    interval: 1000,
  });
  expect(fixture.reads).toContainEqual({
    request: { kind: "workflow", id, before: 128 },
    interval: 0,
  });
  expect(html).toContain("Retained old evidence");
  expect(html).toContain("Current outcome");
  expect(html).not.toContain("Old notice");
  expect(html).not.toContain("Cancel workflow");
  expect(html).toContain("Latest workflow steps");
});
it("changing run identity remounts page selection, detail and polling state", () => {
  const client = new ServiceClient(transport());
  const first = randomUUID(),
    next = randomUUID();
  expect(WorkflowCard({ client, id: first }).key).toBe(first);
  expect(WorkflowCard({ client, id: next }).key).toBe(next);
});
