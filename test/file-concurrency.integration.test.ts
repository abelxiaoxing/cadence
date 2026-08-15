import { execFileSync } from "node:child_process";
import {
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
import type { RequestEnvelope } from "../src/contracts";
import {
  mergeBounds,
  snapshotDirManifests,
  snapshotFiles,
} from "../src/file-snapshot";
import { runtimeForProvider } from "../src/parent-provider";
import { Runtime } from "../src/runtime";

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
  return new Runtime({ activation });
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
  phase?: "red" | "green" | "refactor";
  read: string[];
  write: string[];
  snapshot: unknown;
}): RequestEnvelope {
  return {
    stage: "abel-implement",
    role: "implementation-worker",
    id: input.id,
    phase: input.phase ?? "green",
    objective: `Complete ${input.id}`,
    roots: ["."],
    context: { agents: "root contract", contract: "approved task contract" },
    declared: {
      read: input.read,
      write: input.write,
      conflicts: [],
      resources: [],
      verificationLock: `verify-${input.id}`,
    },
    output: "diff",
    snapshot: input.snapshot,
  };
}

function evidenceRequest(
  id: string,
  overrides: Partial<RequestEnvelope> = {},
): RequestEnvelope {
  return {
    stage: "abel-design",
    role: "design-explorer",
    id,
    phase: "evidence",
    objective: "Return bounded evidence",
    roots: ["."],
    context: { agents: "root contract", contract: "approved packet" },
    declared: {
      read: ["a.txt"],
      write: [],
      conflicts: [],
      resources: [],
    },
    output: "evidence",
    snapshot: {},
    ...overrides,
  };
}

function evidence(id: string) {
  return {
    id,
    role: "design-explorer",
    kind: "evidence",
    conclusions: ["bounded evidence"],
    citations: [{ path: "a.txt", lines: "1" }],
    constraints: [],
    dependencies: [],
    risks: [],
    blockingQuestions: [],
    hints: { writeSet: [], verification: "none", agentsImpact: "none" },
  };
}

async function runDiff(input: {
  runtime: Runtime;
  root: string;
  request: RequestEnvelope;
  diff: string;
}) {
  const submitted = {
    id: input.request.id,
    role: "implementation-worker",
    kind: "diff",
    taskId: input.request.id,
    phase: input.request.phase,
    summary: `Complete ${input.request.id}`,
    diff: input.diff,
    expectedVerification: "fixed fixture verification",
    risks: [],
    nextStep: "parent review",
    contractCompliant: true,
  };
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
  expect(result.ok).toBe(true);
  if (!result.ok || typeof result.resultId !== "string") {
    throw new Error("run did not retain a diff result");
  }
  return result.resultId;
}

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

    const appliedLeft = await runtime.execute(
      "apply",
      { resultId: retainedResultId(left.result) },
      left.context,
    );
    expect(appliedLeft.ok).toBe(true);

    const appliedRight = await runtime.execute(
      "apply",
      { resultId: retainedResultId(right.result) },
      right.context,
    );
    expect(appliedRight.ok).toBe(true);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("a1\n");
    expect(readFileSync(join(root, "b.txt"), "utf8")).toBe("b1\n");
  });

  it("stales a result when another accepted diff changes a bound read file", async () => {
    const root = makeGitRoot({
      "shared.txt": "shared0\n",
      "worker.txt": "worker0\n",
    });
    const runtime = activeRuntime();
    const changing = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "change-shared",
        read: ["shared.txt"],
        write: ["shared.txt"],
        snapshot: snapshotFiles(root, ["shared.txt"]),
      }),
      diff: modifyPatch("shared.txt", "shared0", "shared1"),
    });
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

    const applied = await runtime.execute(
      "apply",
      { resultId: retainedResultId(changing.result) },
      changing.context,
    );
    expect(applied.ok).toBe(true);

    const stale = await runtime.execute(
      "apply",
      { resultId: retainedResultId(observing.result) },
      observing.context,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatch(/stale/i);
    expect(readFileSync(join(root, "worker.txt"), "utf8")).toBe("worker0\n");
  });

  it("stales a result when an accepted diff changes an observed directory manifest", async () => {
    const root = makeGitRoot({
      "docs/base.txt": "base\n",
      "worker.txt": "worker0\n",
    });
    const runtime = activeRuntime();
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

    const applied = await runtime.execute(
      "apply",
      { resultId: retainedResultId(adding.result) },
      adding.context,
    );
    expect(applied.ok).toBe(true);

    const stale = await runtime.execute(
      "apply",
      { resultId: retainedResultId(observing.result) },
      observing.context,
    );
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.error).toMatch(/stale/i);
    expect(readFileSync(join(root, "worker.txt"), "utf8")).toBe("worker0\n");
  });
});

describe("runtime redispatch and logical Worker identity", () => {
  it("mechanically redispatches one unchanged failed request exactly once", async () => {
    const root = makeGitRoot({ "a.txt": "alpha\n" });
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-retry-faux-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage("first phase failed without a submission"),
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", evidence("retry-once")),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await runtimeForProvider(faux.provider);
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };

    const result = await runtime.execute(
      "run",
      { request: evidenceRequest("retry-once") },
      context,
    );
    expect(faux.state.callCount).toBe(2);
    expect(result.ok).toBe(true);
  });

  it("blocks after the identical mechanical redispatch fails again", async () => {
    const root = makeGitRoot({ "a.txt": "alpha\n" });
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-retry-limit-faux-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage("first mechanical failure"),
      fauxAssistantMessage("second mechanical failure"),
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", evidence("retry-limit")),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await runtimeForProvider(faux.provider);
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };

    const result = await runtime.execute(
      "run",
      { request: evidenceRequest("retry-limit") },
      context,
    );
    expect(result.ok).toBe(false);
    expect(faux.state.callCount).toBe(2);
  });

  it("does not treat an expanded recovery contract as a mechanical redispatch", async () => {
    const root = makeGitRoot({ "a.txt": "alpha\n", "b.txt": "beta\n" });
    const runtime = activeRuntime();
    const faux = fauxProvider({
      provider: `abel-retry-scope-faux-${providerSequence++}`,
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage("first mechanical failure"),
      fauxAssistantMessage("second mechanical failure"),
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", evidence("fixed-worker")),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await runtimeForProvider(faux.provider);
    const context = {
      cwd: root,
      model: faux.getModel(),
      modelRegistry: new ModelRegistry(modelRuntime),
    };

    await runtime.execute(
      "run",
      { request: evidenceRequest("fixed-worker") },
      context,
    );
    const expanded = await runtime.execute(
      "run",
      {
        request: evidenceRequest("fixed-worker", {
          objective: "Expand the failed request to inspect another file",
          declared: {
            read: ["a.txt", "b.txt"],
            write: [],
            conflicts: [],
            resources: [],
          },
        }),
      },
      context,
    );

    expect(expanded.ok).toBe(false);
    if (!expanded.ok) {
      expect(expanded.error).toMatch(
        /blocked|changed|contract|scope|identity/i,
      );
    }
    expect(faux.state.callCount).toBe(2);
  });

  it("pins provider/model identity across fresh phases of one logical Worker", async () => {
    const root = makeGitRoot({ "a.txt": "a0\n" });
    const runtime = activeRuntime();
    const first = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "pinned-worker",
        phase: "red",
        read: ["a.txt"],
        write: ["a.txt"],
        snapshot: snapshotFiles(root, ["a.txt"]),
      }),
      diff: modifyPatch("a.txt", "a0", "a1"),
    });
    const firstResultId = retainedResultId(first.result);
    expect(first.faux.state.callCount).toBe(1);
    const applied = await runtime.execute(
      "apply",
      { resultId: firstResultId },
      first.context,
    );
    expect(applied.ok).toBe(true);

    const changedIdentity = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "pinned-worker",
        phase: "green",
        read: ["a.txt"],
        write: ["a.txt"],
        snapshot: snapshotFiles(root, ["a.txt"]),
      }),
      diff: modifyPatch("a.txt", "a1", "a2"),
    });

    expect(changedIdentity.result.ok).toBe(false);
    if (!changedIdentity.result.ok) {
      expect(changedIdentity.result.error).toMatch(
        /blocked|identity|model|provider|pinned/i,
      );
    }
    expect(changedIdentity.faux.state.callCount).toBe(0);
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("a1\n");
  });
});
describe("serial parent apply FIFO and recovery", () => {
  it("serial parent apply FIFO and recovery", async () => {
    const root = makeGitRoot({ x: "x0\n", y: "y0\n" });
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

    // A forced stale failure (bound file changed after retention) must settle
    // as { ok: false } and must not poison later applies.
    writeFileSync(join(root, "x"), "x-changed\n");
    const failing = await runtime.execute(
      "apply",
      { resultId: ids[0] },
      run[0].context,
    );
    expect(failing.ok).toBe(false);
    if (!failing.ok) expect(failing.error).toMatch(/stale/i);
    writeFileSync(join(root, "x"), "x0\n");

    // Overlapping applies are admitted in invocation order: each controlled
    // result carries a monotonic FIFO sequence number, so the earlier caller
    // must observe a lower sequence than the later caller.
    const [first, second] = await Promise.all([
      runtime.execute("apply", { resultId: ids[0] }, run[0].context),
      runtime.execute("apply", { resultId: ids[1] }, run[1].context),
    ]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (first.ok && second.ok) {
      const firstSeq = (first.result as { sequence?: number })?.sequence;
      const secondSeq = (second.result as { sequence?: number })?.sequence;
      expect(firstSeq).toBeTypeOf("number");
      expect(secondSeq).toBeTypeOf("number");
      expect(firstSeq!).toBeLessThan(secondSeq!);
    }

    // Recovery: a later apply for a third retained result still succeeds.
    const c = await runDiff({
      runtime,
      root,
      request: diffRequest({
        id: "serial-y2",
        read: ["y"],
        write: ["y"],
        snapshot: snapshotFiles(root, ["y"]),
      }),
      diff: modifyPatch("y", "y1", "y2"),
    });
    const recovered = await runtime.execute(
      "apply",
      { resultId: retainedResultId(c.result) },
      c.context,
    );
    expect(recovered.ok).toBe(true);
  });
});
