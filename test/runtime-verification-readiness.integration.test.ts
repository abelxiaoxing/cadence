import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { Activation } from "../src/activation.ts";
import { snapshotFiles } from "../src/file-snapshot.ts";
import {
  assessImplementGraphReadiness,
  hashImplementGraphBoundary,
} from "../src/implement-graph.ts";
import { Runtime } from "../src/runtime.ts";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function fixture(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-runtime-readiness-"));
  roots.push(root);
  mkdirSync(path.join(root, "src"));
  mkdirSync(path.join(root, "node_modules/.bin"), { recursive: true });
  writeFileSync(path.join(root, "src/value.ts"), "export const value = 1;\n");
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ scripts: { typecheck: "tsc --noEmit" } }),
  );
  writeFileSync(path.join(root, "node_modules/.bin/tsc"), "#!/bin/sh\n", {
    mode: 0o755,
  });
  return root;
}

function runtimeFixture() {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
}

function context(root: string) {
  return {
    cwd: root,
    model: { provider: "fixture", id: "fixture", name: "fixture" },
    modelRegistry: {},
  } as never;
}

function staticVerification(
  id: string,
  classification: "expected-red" | "expected-green",
  runner: string,
) {
  return {
    kind: "static-check",
    id,
    runner: { kind: "node", script: runner },
    args: [],
    classification,
    ...(classification === "expected-red"
      ? { expectedFailure: "[RUNTIME-READINESS:red]" }
      : {}),
  };
}

function task(
  taskId: string,
  runner: string,
  source: Record<string, unknown>,
  options: { dependsOn?: string[]; producesRunner?: boolean } = {},
) {
  return {
    taskId,
    dependsOn: options.dependsOn ?? [],
    objective: `Implement ${taskId}`,
    roots: ["."],
    context: { agents: "fixture", contract: "Gate B fixture" },
    phases: {
      red: {
        read: options.producesRunner ? [] : [runner],
        write: options.producesRunner ? [runner] : ["src/value.ts"],
        verification: staticVerification(
          `${taskId}-red`,
          "expected-red",
          runner,
        ),
        verificationInputs: [source],
      },
      green: {
        read: [runner, "src/value.ts"],
        write: ["src/value.ts"],
        verification: staticVerification(
          `${taskId}-green`,
          "expected-green",
          runner,
        ),
        verificationInputs: [source],
      },
    },
    scheduling: { conflicts: [], resources: [] },
    agents: { impact: "none", managedOnly: true },
    approvedDependencies: [],
    impactClosure: {
      changedSurfaces: ["none"],
      searchEvidence: [],
      relatedTests: [],
      affectedSuite: [],
    },
  };
}

function graphRequest(
  graph: Record<string, unknown>,
  state: { completedTasks?: string[]; blockedTasks?: string[] } = {},
) {
  return {
    stage: "abel-implement",
    kind: "admit-graph",
    graph,
    graphHash: hashImplementGraphBoundary(graph),
    state: {
      completedTasks: state.completedTasks ?? [],
      blockedTasks: state.blockedTasks ?? [],
    },
  };
}

describe("Implement graph verification readiness", () => {
  it("rejects an impossible adapter before graph admission", async () => {
    const root = fixture();
    const runtime = runtimeFixture();
    const missing = {
      kind: "package-script",
      id: "missing-red-script",
      packageManager: "npm",
      script: "test:missing",
      command: "vitest run",
      args: [],
      classification: "expected-red",
      expectedFailure: "[RUNTIME-READINESS:missing]",
    };
    const missingGreen = {
      ...missing,
      id: "missing-green-script",
      classification: "expected-green",
    };
    delete (missingGreen as Record<string, unknown>).expectedFailure;
    const graph = {
      changeId: "runtime-readiness",
      tasks: [
        {
          ...task("missing-script", "src/value.ts", {
            kind: "workspace",
            path: "src/value.ts",
          }),
          phases: {
            red: {
              read: ["src/value.ts", "package.json"],
              write: ["src/value.ts"],
              verification: missing,
              verificationInputs: [{ kind: "workspace", path: "package.json" }],
            },
            green: {
              read: ["src/value.ts", "package.json"],
              write: ["src/value.ts"],
              verification: missingGreen,
              verificationInputs: [{ kind: "workspace", path: "package.json" }],
            },
          },
        },
      ],
      outputs: [],
    };

    const result = await runtime.execute(
      "run",
      { request: graphRequest(graph) },
      context(root),
    );

    expect(result).toMatchObject({ kind: "graph-rejected" });
    expect((result as { diagnostics: unknown[] }).diagnostics).toContainEqual(
      expect.objectContaining({
        kind: "verification-adapter",
        code: "script-missing",
        phase: "red",
      }),
    );
    expect(
      (
        runtime as never as { registry: { values(): unknown[] } }
      ).registry.values(),
    ).toEqual([]);
  });

  it("keeps a consumer dependency-blocked when its producer is blocked", async () => {
    const root = fixture();
    const runtime = runtimeFixture();
    const runner = "test/cugc_pytest.mjs";
    const output = {
      id: "pytest-adapter",
      path: runner,
      producer: { taskId: "T1", phase: "red" },
      postcondition: "regular-file",
    };
    const graph = {
      changeId: "runtime-readiness",
      tasks: [
        task(
          "T1",
          runner,
          { kind: "output", outputId: "pytest-adapter" },
          { producesRunner: true },
        ),
        task(
          "T7",
          runner,
          { kind: "output", outputId: "pytest-adapter" },
          { dependsOn: ["T1"] },
        ),
      ],
      outputs: [output],
    };
    const designReadiness = assessImplementGraphReadiness(root, graph, {
      completedTasks: [],
      blockedTasks: ["T1"],
    });
    expect(
      designReadiness.phases.find(
        (phase) => phase.taskId === "T7" && phase.phase === "red",
      ),
    ).toMatchObject({
      ready: false,
      diagnostics: [{ code: "dependency-blocked", dependencyTaskId: "T1" }],
    });
    expect(
      await runtime.execute(
        "run",
        { request: graphRequest(graph, { blockedTasks: ["T1"] }) },
        context(root),
      ),
    ).toMatchObject({
      kind: "graph-admitted",
      readyTasks: [],
      blockedTasks: ["T1", "T7"],
    });

    const result = await runtime.execute(
      "run",
      {
        request: {
          stage: "abel-implement",
          kind: "task-attempt",
          attempt: {
            changeId: "runtime-readiness",
            taskId: "T7",
            requestId: "T7:red:0",
            phase: "red",
            snapshot: snapshotFiles(root, [runner, "src/value.ts"]),
          },
        },
      },
      context(root),
    );

    expect(result).toMatchObject({
      kind: "dependency-blocked",
      taskId: "T7",
      diagnostics: [
        {
          kind: "graph-readiness",
          code: "dependency-blocked",
          dependencyTaskId: "T1",
        },
      ],
    });
    expect(
      (
        runtime as never as { registry: { values(): unknown[] } }
      ).registry.values(),
    ).toEqual([]);
  });

  it("rebuilds completed output availability and rejects a false completion fact", async () => {
    const root = fixture();
    const runner = "test/cugc_pytest.mjs";
    const graph = {
      changeId: "runtime-readiness",
      tasks: [
        task(
          "T1",
          runner,
          { kind: "output", outputId: "pytest-adapter" },
          { producesRunner: true },
        ),
        task(
          "T7",
          runner,
          { kind: "output", outputId: "pytest-adapter" },
          { dependsOn: ["T1"] },
        ),
      ],
      outputs: [
        {
          id: "pytest-adapter",
          path: runner,
          producer: { taskId: "T1", phase: "red" },
          postcondition: "regular-file",
        },
      ],
    };

    const missing = await runtimeFixture().execute(
      "run",
      { request: graphRequest(graph, { completedTasks: ["T1"] }) },
      context(root),
    );
    expect(missing).toMatchObject({
      kind: "graph-rejected",
      diagnostics: [
        { code: "producer-output-unavailable", outputId: "pytest-adapter" },
      ],
    });

    mkdirSync(path.join(root, "test"), { recursive: true });
    writeFileSync(path.join(root, runner), "export {};\n");
    const ready = await runtimeFixture().execute(
      "run",
      { request: graphRequest(graph, { completedTasks: ["T1"] }) },
      context(root),
    );
    expect(ready).toMatchObject({
      kind: "graph-admitted",
      readyTasks: ["T7"],
      blockedTasks: [],
    });
  });
});
