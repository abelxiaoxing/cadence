import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { Activation } from "../src/activation";
import type { ImplementRunRequest } from "../src/contracts";
import {
  mergeBounds,
  snapshotDirManifests,
  snapshotFiles,
} from "../src/file-snapshot";
import { runtimeForProvider } from "../src/parent-provider";
import { Runtime } from "../src/runtime";
import { PassthroughParentPayloadBridge } from "./helpers/passthrough-parent-payload-bridge.ts";

const tempRoots: string[] = [];
let providerSequence = 0;

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeGitRoot(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "abel-file-concurrency-"));
  tempRoots.push(root);
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  mkdirSync(join(root, "node_modules/.bin"), { recursive: true });
  const fixtureReporter = join(root, "node_modules/.bin/vitest");
  writeFileSync(
    fixtureReporter,
    [
      "#!/usr/bin/env bun",
      'import { writeFileSync } from "node:fs";',
      "const args = process.argv.slice(2);",
      'const output = args.find((arg) => arg.startsWith("--outputFile="))?.slice(13);',
      'if (!output) throw new Error("missing structured report output");',
      'const red = args.some((arg) => arg.endsWith("expected-red.mjs"));',
      'const identity = "[FILE-CONCURRENCY:expected-red]";',
      "writeFileSync(output, JSON.stringify({",
      "  numTotalTests: 1,",
      "  numFailedTests: red ? 1 : 0,",
      "  success: !red,",
      '  testResults: [{ message: "", assertionResults: [{',
      '    status: red ? "failed" : "passed",',
      '    fullName: red ? identity : "passes",',
      '    title: red ? identity : "passes",',
      "    failureMessages: red ? [identity] : [],",
      "  }] }],",
      "}));",
      "if (red) process.exit(1);",
      "",
    ].join("\n"),
  );
  chmodSync(fixtureReporter, 0o755);
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  writeFileSync(
    join(root, "package.json"),
    `${JSON.stringify({
      private: true,
      scripts: { check: 'node -e ""', "test:target": "vitest run" },
    })}\n`,
  );
  writeFileSync(join(root, "bun.lock"), "# fixture lock\n");
  writeFileSync(
    join(root, "test/expected-red.mjs"),
    "// fixture expected Red\n",
  );
  writeFileSync(
    join(root, "test/expected-green.mjs"),
    "// fixture expected Green\n",
  );
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
  });
  execFileSync("git", ["config", "user.name", "Abel Test"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: root });
  return root;
}

function activeRuntime(): Runtime {
  const activation = new Activation();
  activation.request();
  activation.activate();
  return new Runtime({
    activation,
    parentPayloadBridge: new PassthroughParentPayloadBridge(),
  });
}

function modifyPatch(path: string, before: string, after: string): string {
  return [
    `--- a/${path}`,
    `+++ b/${path}`,
    "@@ -1 +1 @@",
    `-${before}`,
    `+${after}`,
    "",
  ].join("\n");
}

function addPatch(path: string, content: string): string {
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${path}`,
    "@@ -0,0 +1 @@",
    `+${content}`,
    "",
  ].join("\n");
}

function diffRequest(input: {
  id: string;
  read: string[];
  write: string[];
  green?: { read: string[]; write: string[] };
  snapshot: unknown;
}): Extract<ImplementRunRequest, { kind: "open-task" }> {
  const verification = (phase: "red" | "green") => ({
    id: `verify-${input.id}-${phase}`,
    argv: [
      "bun",
      "run",
      "test:target",
      phase === "red" ? "test/expected-red.mjs" : "test/expected-green.mjs",
    ],
    classification:
      phase === "red" ? ("expected-red" as const) : ("expected-green" as const),
    ...(phase === "red"
      ? { expectedFailure: "[FILE-CONCURRENCY:expected-red]" }
      : {}),
    minTests: 1,
  });
  return {
    stage: "abel-implement",
    kind: "open-task",
    boundary: {
      changeId: "file-concurrency-fixture",
      taskId: input.id,
      objective: `Complete ${input.id}`,
      roots: ["."],
      context: {
        agents: "root contract",
        contract: "approved task contract",
      },
      phases: {
        red: {
          read: input.read,
          write: input.write,
          verificationLock: `verify-${input.id}`,
          verification: verification("red"),
        },
        green: {
          read: input.green?.read ?? input.read,
          write: input.green?.write ?? input.write,
          verificationLock: `verify-${input.id}`,
          verification: verification("green"),
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
    },
    attempt: {
      changeId: "file-concurrency-fixture",
      taskId: input.id,
      requestId: input.id,
      phase: "red",
      snapshot: input.snapshot,
    },
  };
}

function phaseAttempt(
  request: Extract<ImplementRunRequest, { kind: "open-task" }>,
  phase: "green",
  snapshot: unknown,
): ImplementRunRequest {
  return {
    stage: "abel-implement",
    kind: "phase-attempt",
    attempt: {
      ...structuredClone(request.attempt),
      requestId: `${request.attempt.taskId}:${phase}`,
      phase,
      snapshot,
    },
  };
}

function submittedDiff(request: ImplementRunRequest, diff: string) {
  return {
    id: request.attempt.requestId,
    role: "implementation-worker",
    kind: "diff",
    taskId: request.attempt.taskId,
    phase: request.attempt.phase,
    summary: `Complete ${request.attempt.taskId}`,
    diff,
    expectedVerification: "fixed fixture verification",
    risks: [],
    contractCompliant: true,
  };
}

async function runDiff(input: {
  runtime: Runtime;
  root: string;
  request: ImplementRunRequest;
  diff: string;
}) {
  const submitted = submittedDiff(input.request, input.diff);
  const faux = fauxProvider({
    provider: `abel-file-faux-${providerSequence++}`,
    api: "faux",
  });
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall("abel_submit_result", submitted), {
      stopReason: "toolUse",
    }),
  ]);
  const modelRuntime = await runtimeForProvider(faux.provider);
  const context = {
    cwd: input.root,
    model: faux.getModel(),
    modelRegistry: new ModelRegistry(modelRuntime),
  };
  const result = await input.runtime.execute(
    "run",
    { request: input.request },
    context,
  );
  return { context, faux, result };
}

function retainedResultId(
  result: Awaited<ReturnType<Runtime["execute"]>>,
): string {
  expect(result).toMatchObject({ kind: "candidate" });
  if (!("kind" in result) || result.kind !== "candidate") {
    throw new Error("run did not retain a diff result");
  }
  return result.resultId;
}

let applySequence = 0;
function applyCandidate(
  runtime: Runtime,
  resultId: string,
  context: Parameters<Runtime["execute"]>[2],
) {
  return runtime.execute(
    "apply",
    {
      resultId,
      requestId: `file-concurrency:apply:${applySequence++}`,
    },
    context,
  );
}

describe("task-lifetime conflict admission", () => {
  it("[SLICE-4:task-lifetime-conflict] retains later-phase conflicts while a candidate is pending without losing an independent sibling", async () => {
    const root = makeGitRoot({
      "owner-red.txt": "owner0\n",
      "contender-red.txt": "contender0\n",
      "later-shared.txt": "shared0\n",
      "sibling.txt": "sibling0\n",
    });
    const runtime = activeRuntime();
    const owner = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "lifetime-owner",
        read: ["owner-red.txt"],
        write: ["owner-red.txt"],
        green: {
          read: ["later-shared.txt"],
          write: ["later-shared.txt"],
        },
        snapshot: snapshotFiles(root, ["owner-red.txt"]),
      }),
      diff: modifyPatch("owner-red.txt", "owner0", "owner1"),
    });
    expect(retainedResultId(owner.result)).toBeTypeOf("string");

    const conflictingRequest = diffRequest({
      id: "later-phase-contender",
      read: ["contender-red.txt"],
      write: ["contender-red.txt"],
      green: {
        read: ["later-shared.txt"],
        write: ["later-shared.txt"],
      },
      snapshot: snapshotFiles(root, ["contender-red.txt"]),
    });
    const firstDeferred = await runDiff({
      runtime,
      root,
      request: conflictingRequest,
      diff: modifyPatch("contender-red.txt", "contender0", "contender1"),
    });
    const secondDeferred = await runDiff({
      runtime,
      root,
      request: conflictingRequest,
      diff: modifyPatch("contender-red.txt", "contender0", "contender1"),
    });
    const sibling = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "independent-sibling",
        read: ["sibling.txt"],
        write: ["sibling.txt"],
        snapshot: snapshotFiles(root, ["sibling.txt"]),
      }),
      diff: modifyPatch("sibling.txt", "sibling0", "sibling1"),
    });

    for (const deferred of [firstDeferred, secondDeferred]) {
      expect(deferred.result).toMatchObject({
        kind: "deferred",
        requestId: "later-phase-contender",
        taskId: "later-phase-contender",
        reason: "task-conflict",
      });
      expect(deferred.faux.state.callCount).toBe(0);
    }
    expect(sibling.result).toMatchObject({ kind: "candidate" });
    expect(sibling.faux.state.callCount).toBe(1);
    expect(retainedResultId(sibling.result)).toBeTypeOf("string");
  });
});

describe("file-aware current and stale results", () => {
  it("keeps a disjoint sibling current after applying another accepted result", async () => {
    const root = makeGitRoot({ "a.txt": "a0\n", "b.txt": "b0\n" });
    const runtime = activeRuntime();
    const left = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "disjoint-left",
        read: ["a.txt"],
        write: ["a.txt"],
        snapshot: snapshotFiles(root, ["a.txt"]),
      }),
      diff: modifyPatch("a.txt", "a0", "a1"),
    });
    const right = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "disjoint-right",
        read: ["b.txt"],
        write: ["b.txt"],
        snapshot: snapshotFiles(root, ["b.txt"]),
      }),
      diff: modifyPatch("b.txt", "b0", "b1"),
    });

    const appliedLeft = await applyCandidate(
      runtime,
      retainedResultId(left.result),
      left.context,
    );
    expect(appliedLeft).toMatchObject({ kind: "applied" });

    const appliedRight = await applyCandidate(
      runtime,
      retainedResultId(right.result),
      right.context,
    );
    expect(appliedRight).toMatchObject({ kind: "applied" });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("a1\n");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("b1\n");
  });

  it("stales a result when a bound read file changes", async () => {
    const root = makeGitRoot({
      "shared.txt": "shared0\n",
      "worker.txt": "worker0\n",
    });
    const runtime = activeRuntime();
    const observing = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "observes-shared",
        read: ["shared.txt", "worker.txt"],
        write: ["worker.txt"],
        snapshot: snapshotFiles(root, ["shared.txt", "worker.txt"]),
      }),
      diff: modifyPatch("worker.txt", "worker0", "worker1"),
    });

    writeFileSync(join(root, "shared.txt"), "shared1\n");

    const stale = await applyCandidate(
      runtime,
      retainedResultId(observing.result),
      observing.context,
    );
    expect(stale).toMatchObject({
      kind: "retry",
      scope: "worker",
      phase: "red",
      cause: "stale",
      remainingAttempts: 1,
    });
    expect(readFileSync(join(root, "worker.txt"), "utf8")).toBe("worker0\n");
  });

  it("defers a descendant write and stales on an external directory-manifest change", async () => {
    const root = makeGitRoot({
      "docs/base.txt": "base\n",
      "worker.txt": "worker0\n",
    });
    const runtime = activeRuntime();
    const observing = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "observes-directory",
        read: ["docs", "worker.txt"],
        write: ["worker.txt"],
        snapshot: mergeBounds(
          snapshotFiles(root, ["worker.txt"]),
          snapshotDirManifests(root, ["docs"]),
        ),
      }),
      diff: modifyPatch("worker.txt", "worker0", "worker1"),
    });
    const adding = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "add-directory-entry",
        read: [],
        write: ["docs/new.txt"],
        snapshot: snapshotFiles(root, ["docs/new.txt"], {
          absent: ["docs/new.txt"],
        }),
      }),
      diff: addPatch("docs/new.txt", "new"),
    });

    expect(adding.result).toMatchObject({
      kind: "deferred",
      taskId: "add-directory-entry",
      reason: "task-conflict",
    });
    expect(adding.faux.state.callCount).toBe(0);
    writeFileSync(join(root, "docs/new.txt"), "new\n");

    const stale = await applyCandidate(
      runtime,
      retainedResultId(observing.result),
      observing.context,
    );
    expect(stale).toMatchObject({
      kind: "retry",
      scope: "worker",
      phase: "red",
      cause: "stale",
      remainingAttempts: 1,
    });
    expect(readFileSync(join(root, "worker.txt"), "utf8")).toBe("worker0\n");
  });
});

describe("runtime redispatch and logical Worker identity", () => {
  it("mechanically redispatches one unchanged failed request exactly once", async () => {
    const root = makeGitRoot({ "a.txt": "alpha\n" });
    const runtime = activeRuntime();
    const request = diffRequest({
      id: "retry-once",
      read: ["a.txt"],
      write: ["a.txt"],
      snapshot: snapshotFiles(root, ["a.txt"]),
    });
    const faux = fauxProvider({
      provider: `abel-retry-faux-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "first transport failure",
      }),
      fauxAssistantMessage(
        fauxToolCall(
          "abel_submit_result",
          submittedDiff(request, modifyPatch("a.txt", "alpha", "updated")),
        ),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await runtimeForProvider(faux.provider);
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };

    const result = await runtime.execute("run", { request }, context);
    expect(faux.state.callCount).toBe(2);
    expect(result).toMatchObject({ kind: "candidate" });
  });

  it("blocks after the identical mechanical redispatch fails again", async () => {
    const root = makeGitRoot({ "a.txt": "alpha\n" });
    const runtime = activeRuntime();
    const request = diffRequest({
      id: "retry-limit",
      read: ["a.txt"],
      write: ["a.txt"],
      snapshot: snapshotFiles(root, ["a.txt"]),
    });
    const faux = fauxProvider({
      provider: `abel-retry-limit-faux-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "first transport failure",
      }),
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "second transport failure",
      }),
      fauxAssistantMessage(
        fauxToolCall(
          "abel_submit_result",
          submittedDiff(request, modifyPatch("a.txt", "alpha", "updated")),
        ),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await runtimeForProvider(faux.provider);
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };

    const result = await runtime.execute("run", { request }, context);
    expect(result).toMatchObject({
      kind: "blocked",
      phase: "red",
      failure: {
        kind: "attempts-exhausted",
        cause: "transport",
        lastFailure: {
          code: "child-provider-stream-error",
          stage: "child-provider-stream",
        },
      },
    });
    expect(faux.state.callCount).toBe(2);
  });

  it("does not treat an expanded recovery contract as a mechanical redispatch", async () => {
    const root = makeGitRoot({ "a.txt": "alpha\n", "b.txt": "beta\n" });
    const runtime = activeRuntime();
    const request = diffRequest({
      id: "fixed-worker",
      read: ["a.txt"],
      write: ["a.txt"],
      snapshot: snapshotFiles(root, ["a.txt"]),
    });
    const faux = fauxProvider({
      provider: `abel-retry-scope-faux-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "first transport failure",
      }),
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage: "second transport failure",
      }),
      fauxAssistantMessage(
        fauxToolCall(
          "abel_submit_result",
          submittedDiff(request, modifyPatch("a.txt", "alpha", "updated")),
        ),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await runtimeForProvider(faux.provider);
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };

    await runtime.execute("run", { request }, context);
    const expanded = structuredClone(request);
    expanded.boundary.phases.red.read.push("b.txt");
    expanded.boundary.phases.green.read.push("b.txt");
    expanded.attempt.snapshot = snapshotFiles(root, ["a.txt", "b.txt"]);

    await expect(
      runtime.execute("run", { request: expanded }, context),
    ).rejects.toThrow(/duplicate|open|protocol/i);
    expect(faux.state.callCount).toBe(2);
  });

  it("pins provider/model identity across fresh phases of one logical Worker", async () => {
    const root = makeGitRoot({ "a.txt": "a0\n" });
    const runtime = activeRuntime();
    const openRequest = diffRequest({
      id: "pinned-worker",
      read: ["a.txt"],
      write: ["a.txt"],
      snapshot: snapshotFiles(root, ["a.txt"]),
    });
    const first = await runDiff({
      runtime,
      root,
      request: openRequest,
      diff: modifyPatch("a.txt", "a0", "a1"),
    });
    const firstResultId = retainedResultId(first.result);
    expect(first.faux.state.callCount).toBe(1);
    const applied = await applyCandidate(runtime, firstResultId, first.context);
    expect(applied).toMatchObject({ kind: "applied" });

    await expect(
      runDiff({
        runtime,
        root,
        request: phaseAttempt(
          openRequest,
          "green",
          snapshotFiles(root, ["a.txt"]),
        ),
        diff: modifyPatch("a.txt", "a1", "a2"),
      }),
    ).rejects.toThrow(/identity|model|provider|pinned/i);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("a1\n");
  });
});
describe("serial parent apply FIFO and recovery", () => {
  it("serial parent apply FIFO and recovery", async () => {
    const root = makeGitRoot({
      x: "x0\n",
      y: "y0\n",
      z: "z0\n",
      w: "w0\n",
    });
    const runtime = activeRuntime();
    const run: Array<Awaited<ReturnType<typeof runDiff>>> = [];
    for (const file of ["x", "y"]) {
      const r = await runDiff({
        runtime,
        root,
        request: diffRequest({
          id: `serial-${file}`,
          read: [file],
          write: [file],
          snapshot: snapshotFiles(root, [file]),
        }),
        diff: modifyPatch(file, `${file}0`, `${file}1`),
      });
      run.push(r);
    }
    const ids = run.map((r) => retainedResultId(r.result));

    // A forced stale failure must settle as retry and not poison later applies.
    writeFileSync(join(root, "x"), "x-changed\n");
    const failing = await applyCandidate(runtime, ids[0], run[0].context);
    expect(failing).toMatchObject({ kind: "retry", cause: "stale" });
    writeFileSync(join(root, "x"), "x0\n");
    const replacement = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "serial-z",
        read: ["z"],
        write: ["z"],
        snapshot: snapshotFiles(root, ["z"]),
      }),
      diff: modifyPatch("z", "z0", "z1"),
    });

    // Overlapping applies are admitted in invocation order: each controlled
    // result carries a monotonic FIFO sequence number, so the earlier caller
    // must observe a lower sequence than the later caller.
    const [first, second] = await Promise.all([
      applyCandidate(
        runtime,
        retainedResultId(replacement.result),
        replacement.context,
      ),
      applyCandidate(runtime, ids[1], run[1].context),
    ]);
    expect(first).toMatchObject({ kind: "applied" });
    expect(second).toMatchObject({ kind: "applied" });
    if (
      "kind" in first &&
      first.kind === "applied" &&
      "kind" in second &&
      second.kind === "applied"
    ) {
      expect(first.result.sequence).toBeTypeOf("number");
      expect(second.result.sequence).toBeTypeOf("number");
      expect(first.result.sequence!).toBeLessThan(second.result.sequence!);
    }

    // Recovery: a later apply for a third retained result still succeeds.
    const c = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "serial-w",
        read: ["w"],
        write: ["w"],
        snapshot: snapshotFiles(root, ["w"]),
      }),
      diff: modifyPatch("w", "w0", "w1"),
    });
    const recovered = await applyCandidate(
      runtime,
      retainedResultId(c.result),
      c.context,
    );
    expect(recovered).toMatchObject({ kind: "applied" });
  });
});
