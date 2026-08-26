import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateRequestEnvelope } from "../src/contracts.ts";
import * as graphReadiness from "../src/implement-graph.ts";

type Phase = "red" | "green" | "refactor";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function workspace(): string {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-graph-readiness-"));
  roots.push(root);
  return root;
}

function verification(
  id: string,
  phase: Phase,
  script: string,
): Record<string, unknown> {
  return {
    kind: "static-check",
    id,
    runner: { kind: "node", script },
    args: [],
    classification: `expected-${phase}`,
    ...(phase === "red" ? { expectedFailure: "expected Red witness" } : {}),
  };
}

function task(
  taskId: string,
  script: string,
  source: Record<string, unknown>,
  options: {
    dependsOn?: string[];
    redWrite?: string[];
    greenWrite?: string[];
  } = {},
): Record<string, unknown> {
  return {
    taskId,
    dependsOn: options.dependsOn ?? [],
    objective: `Implement ${taskId}`,
    context: { agents: "bounded context", contract: "approved contract" },
    roots: ["."],
    phases: {
      red: {
        read: options.redWrite?.includes(script) ? [] : [script],
        write: options.redWrite ?? [],
        verification: verification(`${taskId}-red`, "red", script),
        verificationInputs: [source],
      },
      green: {
        read: options.greenWrite?.includes(script) ? [] : [script],
        write: options.greenWrite ?? [],
        verification: verification(`${taskId}-green`, "green", script),
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

function graph(
  tasks: Record<string, unknown>[],
  outputs: Record<string, unknown>[] = [],
): Record<string, unknown> {
  return { changeId: "graph-readiness", tasks, outputs };
}

function output(
  id: string,
  artifactPath: string,
  taskId: string,
  phase: Phase,
): Record<string, unknown> {
  return {
    id,
    path: artifactPath,
    producer: { taskId, phase },
    postcondition: "regular-file",
  };
}

function assess(
  root: string,
  boundary: Record<string, unknown>,
  facts: Record<string, unknown> = {},
) {
  const fn = (graphReadiness as Record<string, unknown>)
    .assessImplementGraphReadiness;
  expect(
    fn,
    "assessImplementGraphReadiness must be the single graph core",
  ).toBeTypeOf("function");
  return (
    fn as (
      workspaceRoot: string,
      graphBoundary: Record<string, unknown>,
      executionFacts: Record<string, unknown>,
    ) => {
      closure: {
        executable: boolean;
        diagnostics: Array<Record<string, unknown>>;
      };
      phases: Array<Record<string, unknown>>;
      outputs: Array<Record<string, unknown>>;
    }
  )(root, boundary, {
    completedTasks: [],
    blockedTasks: [],
    appliedPhases: [],
    ...facts,
  });
}

function phaseResult(
  result: ReturnType<typeof assess>,
  taskId: string,
  phase: Phase,
) {
  return result.phases.find(
    (entry) => entry.taskId === taskId && entry.phase === phase,
  );
}

describe("Implement graph verification closure", () => {
  const runner = "test/cugc_pytest.mjs";

  it("rejects an absent workspace input without a producer proof", () => {
    const root = workspace();
    const result = assess(
      root,
      graph([task("T7", runner, { kind: "workspace", path: runner })]),
    );

    expect(result.closure.executable).toBe(false);
    expect(result.closure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "workspace-input-unavailable",
        taskId: "T7",
        phase: "red",
        verificationId: "T7-red",
      }),
    );
  });

  it("publishes a unique producer output only after its dependency completes", () => {
    const root = workspace();
    const adapter = output("pytest-adapter", runner, "T1", "red");
    const producer = task(
      "T1",
      runner,
      { kind: "output", outputId: "pytest-adapter" },
      { redWrite: [runner] },
    );
    const consumer = task(
      "T7",
      runner,
      { kind: "output", outputId: "pytest-adapter" },
      { dependsOn: ["T1"] },
    );
    const boundary = graph([producer, consumer], [adapter]);

    const pending = assess(root, boundary);
    expect(pending.closure).toMatchObject({
      executable: true,
      diagnostics: [],
    });
    expect(phaseResult(pending, "T7", "red")).toMatchObject({
      ready: false,
      diagnostics: [{ code: "dependency-blocked", dependencyTaskId: "T1" }],
    });

    const completedMissing = assess(root, boundary, {
      completedTasks: ["T1"],
    });
    expect(completedMissing.outputs).toContainEqual(
      expect.objectContaining({
        outputId: "pytest-adapter",
        status: "unavailable",
      }),
    );
    expect(phaseResult(completedMissing, "T7", "red")).toMatchObject({
      ready: false,
      diagnostics: [
        { code: "producer-output-unavailable", outputId: "pytest-adapter" },
      ],
    });

    mkdirSync(path.join(root, "test"), { recursive: true });
    writeFileSync(path.join(root, runner), "export {};\n");
    const completed = assess(root, boundary, { completedTasks: ["T1"] });
    expect(phaseResult(completed, "T7", "red")).toMatchObject({
      ready: true,
      diagnostics: [],
    });
  });

  it("rejects a producer that is not an ancestor of its consumer", () => {
    const root = workspace();
    const adapter = output("pytest-adapter", runner, "T1", "red");
    const result = assess(
      root,
      graph(
        [
          task(
            "T1",
            runner,
            { kind: "output", outputId: "pytest-adapter" },
            { redWrite: [runner] },
          ),
          task("T7", runner, {
            kind: "output",
            outputId: "pytest-adapter",
          }),
        ],
        [adapter],
      ),
    );

    expect(result.closure.executable).toBe(false);
    expect(result.closure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "producer-not-dependency",
        taskId: "T7",
        producerTaskId: "T1",
      }),
    );
  });

  it("rejects multiple producers for one artifact path", () => {
    const root = workspace();
    const first = output("pytest-adapter-a", runner, "T1", "red");
    const second = output("pytest-adapter-b", runner, "T2", "red");
    const result = assess(
      root,
      graph(
        [
          task(
            "T1",
            runner,
            { kind: "output", outputId: "pytest-adapter-a" },
            { redWrite: [runner] },
          ),
          task(
            "T2",
            runner,
            { kind: "output", outputId: "pytest-adapter-b" },
            { redWrite: [runner] },
          ),
        ],
        [first, second],
      ),
    );

    expect(result.closure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "multiple-output-producers",
        path: runner,
      }),
    );
  });

  it("allows Red to create the runner used by its own verification", () => {
    const root = workspace();
    const adapter = output("pytest-adapter", runner, "T1", "red");
    const resultGraph = graph(
      [
        task(
          "T1",
          runner,
          { kind: "output", outputId: "pytest-adapter" },
          { redWrite: [runner] },
        ),
      ],
      [adapter],
    );
    const result = assess(root, resultGraph);

    expect(result.closure).toMatchObject({ executable: true, diagnostics: [] });
    expect(phaseResult(result, "T1", "red")).toMatchObject({
      ready: true,
      diagnostics: [],
    });

    const candidateMissing = assess(root, resultGraph, {
      candidate: { taskId: "T1", phase: "red" },
    });
    expect(phaseResult(candidateMissing, "T1", "red")).toMatchObject({
      ready: false,
      diagnostics: [
        { code: "producer-output-unavailable", outputId: "pytest-adapter" },
      ],
    });

    mkdirSync(path.join(root, "test"), { recursive: true });
    writeFileSync(path.join(root, runner), "export {};\n");
    const candidateReady = assess(root, resultGraph, {
      candidate: { taskId: "T1", phase: "red" },
    });
    expect(phaseResult(candidateReady, "T1", "red")).toMatchObject({
      ready: true,
      diagnostics: [],
    });
  });

  it("rejects a Red input produced only by Green", () => {
    const root = workspace();
    const adapter = output("pytest-adapter", runner, "T1", "green");
    const result = assess(
      root,
      graph(
        [
          task(
            "T1",
            runner,
            { kind: "output", outputId: "pytest-adapter" },
            { greenWrite: [runner] },
          ),
        ],
        [adapter],
      ),
    );

    expect(result.closure.diagnostics).toContainEqual(
      expect.objectContaining({
        code: "producer-phase-after-consumer",
        taskId: "T1",
        phase: "red",
        producerPhase: "green",
      }),
    );
  });

  it("accepts only an existing safe regular workspace input", () => {
    const root = workspace();
    mkdirSync(path.join(root, "test"), { recursive: true });
    writeFileSync(path.join(root, runner), "export {};\n");
    const boundary = graph([
      task("T7", runner, { kind: "workspace", path: runner }),
    ]);

    expect(assess(root, boundary).closure).toMatchObject({
      executable: true,
      diagnostics: [],
    });

    rmSync(path.join(root, runner));
    mkdirSync(path.join(root, runner));
    expect(assess(root, boundary).closure.diagnostics).toContainEqual(
      expect.objectContaining({ code: "workspace-input-unavailable" }),
    );
  });

  it("rejects final and parent symlinks for workspace inputs", () => {
    const root = workspace();
    const outside = workspace();
    mkdirSync(path.join(root, "test"), { recursive: true });
    writeFileSync(path.join(outside, "runner.mjs"), "export {};\n");
    symlinkSync(
      path.join(outside, "runner.mjs"),
      path.join(root, "test/runner.mjs"),
    );
    const direct = graph([
      task("T7", "test/runner.mjs", {
        kind: "workspace",
        path: "test/runner.mjs",
      }),
    ]);
    expect(assess(root, direct).closure.diagnostics).toContainEqual(
      expect.objectContaining({ code: "workspace-input-unavailable" }),
    );

    rmSync(path.join(root, "test"), { recursive: true });
    symlinkSync(outside, path.join(root, "test"));
    const parent = graph([
      task("T7", "test/runner.mjs", {
        kind: "workspace",
        path: "test/runner.mjs",
      }),
    ]);
    expect(assess(root, parent).closure.diagnostics).toContainEqual(
      expect.objectContaining({ code: "workspace-input-unavailable" }),
    );
  });

  it("fails closed when a path component cannot be observed", () => {
    const root = workspace();
    mkdirSync(path.join(root, "test"));
    const unavailable = `test/${"x".repeat(300)}.mjs`;
    const boundary = graph([
      task("T7", unavailable, { kind: "workspace", path: unavailable }),
    ]);

    expect(assess(root, boundary).closure.diagnostics).toContainEqual(
      expect.objectContaining({ code: "workspace-input-unavailable" }),
    );
  });

  it.each(["/tmp/runner.mjs", "../runner.mjs", "test/../runner.mjs"])(
    "rejects unsafe output path %s",
    (unsafePath) => {
      const root = workspace();
      const result = assess(
        root,
        graph(
          [
            task(
              "T1",
              runner,
              { kind: "output", outputId: "pytest-adapter" },
              { redWrite: [runner] },
            ),
          ],
          [output("pytest-adapter", unsafePath, "T1", "red")],
        ),
      );

      expect(result.closure.diagnostics).toContainEqual(
        expect.objectContaining({
          code: "invalid-output-path",
          outputId: "pytest-adapter",
        }),
      );
    },
  );
});

describe("Implement graph admission contract", () => {
  it("accepts one graph admission followed only by task attempts", () => {
    const runner = "test/runner.mjs";
    const boundary = graph([
      task("T1", runner, { kind: "workspace", path: runner }),
    ]);
    const hash = (graphReadiness as Record<string, unknown>)
      .hashImplementGraphBoundary;
    expect(hash).toBeTypeOf("function");
    const graphHash = (hash as (value: unknown) => string)(boundary);

    expect(
      validateRequestEnvelope({
        stage: "abel-implement",
        kind: "admit-graph",
        graph: boundary,
        graphHash,
        state: { completedTasks: [], blockedTasks: [] },
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateRequestEnvelope({
        stage: "abel-implement",
        kind: "task-attempt",
        attempt: {
          changeId: "graph-readiness",
          taskId: "T1",
          requestId: "T1:red:0",
          phase: "red",
          snapshot: {},
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      validateRequestEnvelope({
        stage: "abel-implement",
        kind: "unsupported-request",
        boundary: {
          changeId: "graph-readiness",
          ...((boundary.tasks as Record<string, unknown>[])[0] ?? {}),
        },
        attempt: {
          changeId: "graph-readiness",
          taskId: "T1",
          requestId: "T1:red:0",
          phase: "red",
          snapshot: {},
        },
      }),
    ).toMatchObject({ ok: false });
  });

  it("hashes canonical object keys and changes with graph facts", () => {
    const hash = (graphReadiness as Record<string, unknown>)
      .hashImplementGraphBoundary as ((value: unknown) => string) | undefined;
    expect(hash).toBeTypeOf("function");
    const left = { changeId: "hash", tasks: [], outputs: [] };
    const reordered = { outputs: [], tasks: [], changeId: "hash" };
    expect(hash?.(left)).toBe(hash?.(reordered));
    expect(hash?.(left)).not.toBe(
      hash?.({ changeId: "other", tasks: [], outputs: [] }),
    );
  });
});
