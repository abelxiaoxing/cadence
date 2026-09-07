import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai/providers/faux";
import { afterEach, describe, expect, it } from "vitest";
import { ArtifactStore } from "../src/artifact-store";
import { compileCandidatePatch } from "../src/candidate-patch";
import { LIMITS } from "../src/contracts";
import {
  classifyCandidateContextRequest,
  createCandidateArtifactTool,
  createStructuredPatchTool,
} from "../src/submit-tool";
import { TaskLedger } from "../src/task-ledger";
import { runtimeForProvider } from "./helpers/model-runtime.ts";

let child: typeof import("../src/child-session") | null = null;
let parentProvider: { runtimeForProvider: typeof runtimeForProvider } | null =
  null;
try {
  child = await import("../src/child-session");
  parentProvider = { runtimeForProvider };
} catch {
  child = null;
  parentProvider = null;
}

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const notReady = (name: string): never =>
  expect.fail(`not_ready: ${name} is not implemented`);

function evidence() {
  return {
    id: "packet-1",
    role: "design-explorer",
    kind: "evidence",
    packet_id: "packet-1",
    module_name: "fixture",
    scope: ["a.txt"],
    files_read: ["a.txt"],
    evidence: [
      { claim: "src exists", path: "a.txt", line_start: 1, line_end: 1 },
    ],
    existing_structures: ["fixture file"],
    existing_conventions: [],
    constraints_discovered: [],
    open_questions: [],
    dependencies: [],
    write_set_hints: [],
    validation_hints: ["none"],
    agents_impact_hints: ["none"],
    risks: [],
    success_criteria_hints: ["cited fixture evidence"],
  };
}

describe("real isolated child session", () => {
  it("generates, chunks, and seals a large patch from one structured Worker submission", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-segmented-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "a.txt"), "old\n");
    const privateRoot = join(cwd, ".candidate-state");
    const artifacts = new ArtifactStore(join(privateRoot, "artifacts"));
    const ledger = new TaskLedger({
      root: join(privateRoot, "ledger"),
      artifacts,
    });
    const candidateId = "candidate-structured-large";
    const identity = {
      candidateId,
      runId: "run-structured-large",
      deliveryRevision: 1,
      taskId: "task-structured-large",
      phase: "green" as const,
      attemptId: "attempt-structured-large",
      approvedPaths: ["a.txt"],
      isolatedRevisionId: "a".repeat(64),
      verificationId: "structured-large-green",
      routeId: "implementation-primary",
      routeFingerprint: "b".repeat(64),
    };
    const operations = [
      {
        kind: "replace" as const,
        path: "a.txt",
        oldText: "old\n",
        newText: `old\n${"x".repeat(LIMITS.maxCompleteResultBytes + 4096)}\n`,
      },
    ];
    const diff = Buffer.from(
      compileCandidatePatch({
        root: cwd,
        writePaths: ["a.txt"],
        deletePaths: [],
        operations,
        maxBytes: 8 * 1024 * 1024,
      }),
    );
    expect(diff.byteLength).toBeGreaterThan(LIMITS.maxCompleteResultBytes);
    const sha256 = (bytes: Uint8Array) =>
      createHash("sha256").update(bytes).digest("hex");
    const faux = fauxProvider({
      provider: "abel-faux-segmented-large",
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall(
          "abel_submit_result",
          {
            kind: "candidate-patch",
            candidateId,
            operations,
          },
          { id: "candidate-patch" },
        ),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    try {
      const result = await child.runChildSession({
        cwd,
        modelRuntime,
        model: faux.getModel(),
        systemPrompt: "Submit the supplied structured candidate patch once.",
        requestId: "task-structured-large",
        taskId: "task-structured-large",
        role: "implementation-worker",
        phase: "green",
        output: "diff",
        roots: [cwd],
        timeoutMs: 5_000,
        candidateArtifact: {
          ledger,
          identity,
          workspaceRoot: cwd,
          writePaths: ["a.txt"],
          deletePaths: [],
        },
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.submitCount).toBe(1);
      expect(result.result).toMatchObject({
        kind: "sealed-candidate",
        candidateId,
        artifactHash: sha256(diff),
        bytes: diff.byteLength,
        paths: ["a.txt"],
      });
      expect(Buffer.from(ledger.readSealedCandidate(candidateId))).toEqual(
        diff,
      );
    } finally {
      ledger.close();
    }
  });

  it("accepts a reduced Design draft through the real SDK, not just direct execute", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const full = evidence();
    const draft = {
      module_name: full.module_name,
      scope: full.scope,
      files_read: full.files_read,
      evidence: full.evidence,
      constraints_discovered: [],
      open_questions: [],
      risks: [],
    };
    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "reduced-design",
      fauxAssistantMessage(fauxToolCall("abel_submit_result", draft), {
        stopReason: "toolUse",
      }),
      { requestId: "packet-1", role: "design-explorer", output: "evidence" },
    );
    expect(result.ok).toBe(true);
    expect(result.result).toMatchObject({
      ...draft,
      id: "packet-1",
      packet_id: "packet-1",
      role: "design-explorer",
      kind: "evidence",
      dependencies: [],
    });
  });

  it("uses empty resources, exactly five scoped tools, one structural submit, usage, and disposal", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "a.txt"), "hello\n");
    const faux = fauxProvider({ provider: "abel-faux", api: "faux" });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", evidence(), { id: "submit-1" }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const streamEvents: string[] = [];
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "Return the supplied evidence through abel_submit_result.",
      requestId: "packet-1",
      role: "design-explorer",
      output: "evidence",
      roots: [cwd],
      timeoutMs: 5_000,
      ledgerProjection: {
        runId: "run-child-projection",
        taskId: "task-child-projection",
        currentPhase: "red",
        history: [],
      },
      captureObservations: true,
      onStreamStart: () => streamEvents.push("start"),
      onStreamProgress: () => streamEvents.push("progress"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual(evidence());
    expect(result.toolNames).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "abel_submit_result",
    ]);
    expect(result.submitCount).toBe(1);
    expect(result.disposeCount).toBe(1);
    expect(result.usage.totalTokens).toBeGreaterThan(0);
    expect(result.observations).toEqual({
      observations: [],
      truncated: false,
    });
    expect(faux.state.callCount).toBe(1);
    expect(streamEvents[0]).toBe("start");
    expect(streamEvents).toContain("progress");
  });

  it("accepts one corrected structural submit without restarting the child", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-bad-"));
    roots.push(cwd);
    const faux = fauxProvider({ provider: "abel-faux-bad", api: "faux" });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", { ...evidence(), id: "wrong" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", evidence(), { id: "submit-retry" }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "submit",
      requestId: "packet-1",
      role: "design-explorer",
      output: "evidence",
      roots: [cwd],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(faux.state.callCount).toBe(2);
    expect(result.classification).toMatchObject({
      finalCategory: "multiple-submit",
      attempts: 2,
      schema: "valid",
      identity: { request: true },
    });
    expect(result.usage.totalTokens).toBeGreaterThan(0);
  });

  it("aborts on timeout and disposes exactly once", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-timeout-"));
    roots.push(cwd);
    const faux = fauxProvider({
      provider: "abel-faux-timeout",
      api: "faux",
      tokensPerSecond: 0.01,
    });
    faux.setResponses([fauxAssistantMessage("never finish in time")]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "wait",
      requestId: "packet-1",
      role: "design-explorer",
      output: "evidence",
      roots: [cwd],
      timeoutMs: 5,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.disposeCount).toBe(1);
    expect(result.failure).toEqual({
      kind: "transport",
      code: "child-timeout",
      stage: "child-timeout",
    });
  });
});

describe("implementation candidate protocol", () => {
  it("publishes the attempt-bound candidate id in every submit schema branch", () => {
    const candidateId = "candidate-worker-visible";
    const submission = createCandidateArtifactTool({
      ledger: {
        beginCandidate: () => ({ accepted: true as const }),
        appendCandidateSegment: () => ({ ok: true as const }),
        sealCandidate: () => ({
          ok: true as const,
          artifactHash: "a".repeat(64),
          bytes: 1,
          paths: ["src/value.ts"],
        }),
      } as never,
      identity: {
        candidateId,
        runId: "run-candidate-visible",
        deliveryRevision: 1,
        taskId: "task-candidate-visible",
        phase: "green",
        attemptId: "attempt-candidate-visible",
        approvedPaths: ["src/value.ts"],
        isolatedRevisionId: "b".repeat(64),
        verificationId: "candidate-visible-green",
        routeId: "implementation-primary",
        routeFingerprint: "c".repeat(64),
      },
      workspaceRoot: process.cwd(),
      writePaths: ["src/value.ts"],
      deletePaths: [],
    });

    const schema = JSON.stringify(submission.tool.parameters);
    expect(schema.split(`"const":"${candidateId}"`)).toHaveLength(3);
  });

  it("classifies context from refs instead of trusting the Worker-selected code", () => {
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-context",
          code: "boundary-review-needed",
          refs: ["src/approved.ts"],
        },
        ["src"],
      ),
    ).toEqual({
      kind: "retryable",
      code: "approved-context-needed",
      contextRequest: {
        code: "boundary-review-needed",
        refs: [
          { kind: "requested-path", path: "src/approved.ts", access: "read" },
        ],
      },
    });
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-context",
          code: "approved-context-needed",
          refs: ["tests/file.test.mjs:209", "phase-contract.writeSet"],
        },
        ["tests/file.test.mjs"],
      ),
    ).toEqual({
      kind: "retryable",
      code: "approved-context-needed",
      contextRequest: {
        code: "approved-context-needed",
        refs: [
          {
            kind: "source-citation",
            path: "tests/file.test.mjs",
            line: 209,
          },
          {
            kind: "contract-diagnostic",
            ref: "phase-contract.writeSet",
          },
        ],
      },
    });
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-context",
          code: "task-split-needed",
          refs: ["outside/authority.ts"],
        },
        ["src"],
      ),
    ).toEqual({
      kind: "approval-needed",
      code: "boundary-review-needed",
      contextRequest: {
        code: "task-split-needed",
        refs: [
          {
            kind: "requested-path",
            path: "outside/authority.ts",
            access: "read",
          },
        ],
      },
    });
  });

  it("keeps the first accepted structured patch and rejects a later overwrite", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "abel-structured-one-result-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "a.txt"), "old\n");
    const submission = createStructuredPatchTool({
      requestId: "diagnosis-one-result",
      taskId: "diagnosis-one-result",
      role: "diagnosis-worker",
      phase: "red",
      workspaceRoot: cwd,
      writePaths: ["a.txt"],
      deletePaths: [],
    });
    const execute = submission.tool.execute as (
      id: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>;
    const patch = (newText: string) => ({
      kind: "candidate-patch",
      candidateId: "diagnosis-one-result",
      operations: [
        {
          kind: "replace",
          path: "a.txt",
          oldText: "old",
          newText,
        },
      ],
    });

    await execute("first-accepted", patch("first"));
    const first = submission.getResult();
    await expect(execute("second-rejected", patch("second"))).rejects.toThrow(
      /terminal|duplicate/u,
    );

    expect(submission.getResult()).toEqual(first);
    expect(first).toMatchObject({ kind: "diff" });
    expect(first && "diff" in first ? first.diff : "").toContain("+first");
    expect(submission.getFailure()).toEqual({
      kind: "artifact",
      code: "invalid-structural-result",
      stage: "structural-submit",
    });
  });

  it("records a terminal failure for a duplicate accepted candidate result", async () => {
    const candidateId = "candidate-one-result";
    const submission = createCandidateArtifactTool({
      ledger: {
        beginCandidate: () => ({ ok: true as const }),
        appendCandidateSegment: () => ({ ok: true as const }),
        sealCandidate: () => ({
          ok: true as const,
          artifactHash: "a".repeat(64),
          bytes: 1,
          paths: ["src/value.ts"],
        }),
      } as never,
      identity: {
        candidateId,
        runId: "run-candidate-one-result",
        deliveryRevision: 1,
        taskId: "task-candidate-one-result",
        phase: "green",
        attemptId: "attempt-candidate-one-result",
        approvedPaths: ["src/value.ts"],
        isolatedRevisionId: "b".repeat(64),
        verificationId: "candidate-one-result-green",
        routeId: "implementation-primary",
        routeFingerprint: "c".repeat(64),
      },
      workspaceRoot: process.cwd(),
      writePaths: ["src/value.ts"],
      deletePaths: [],
    });
    const execute = submission.tool.execute as (
      id: string,
      params: Record<string, unknown>,
    ) => Promise<unknown>;
    const first = {
      kind: "context-request",
      candidateId,
      code: "approved-context-needed",
      refs: ["src/value.ts"],
    };

    await execute("first-candidate-result", first);
    await expect(
      execute("duplicate-candidate-result", {
        ...first,
        code: "task-split-needed",
      }),
    ).rejects.toThrow(/terminal/u);

    expect(submission.getResult()).toMatchObject({
      kind: "context-request",
      candidateId,
      code: "approved-context-needed",
    });
    expect(submission.getFailure()).toEqual({
      kind: "artifact",
      code: "invalid-structural-result",
      stage: "structural-submit",
    });
  });

  it("reads approved task context across phases without expanding write authority", () => {
    const boundary = {
      phase: "green" as const,
      readPaths: ["src/main.ts"],
      writePaths: ["src/main.ts"],
      taskPaths: ["src/main.ts", "src/helper.ts"],
      redWritePaths: [],
      agents: { impact: "none" as const },
    };
    const request = (access: "read" | "write", path = "src/helper.ts") => ({
      kind: "context-request" as const,
      candidateId: "candidate-task-context",
      code: "approved-context-needed" as const,
      refs: [{ kind: "requested-path" as const, path, access }],
    });
    expect(
      classifyCandidateContextRequest(request("read"), boundary),
    ).toMatchObject({ kind: "retryable", code: "approved-context-needed" });
    expect(
      classifyCandidateContextRequest(request("write"), boundary),
    ).toMatchObject({ kind: "approval-needed" });
    expect(
      classifyCandidateContextRequest(
        request("read", "outside/private.ts"),
        boundary,
      ),
    ).toMatchObject({ kind: "approval-needed" });
  });

  it("discovers ordinary context within sealed roots without granting writes or secret reads", () => {
    const boundary = {
      phase: "green" as const,
      readPaths: ["src/main.ts"],
      writePaths: ["src/main.ts"],
      taskPaths: ["src/main.ts"],
      contextReadRoots: ["src"],
      redWritePaths: [],
      agents: { impact: "none" as const },
    };
    const classify = (path: string, access: "read" | "write" = "read") =>
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "context-discovery",
          code: "approved-context-needed",
          refs: [{ kind: "requested-path", path, access }],
        },
        boundary,
      );
    expect(classify("src/helper.ts")).toMatchObject({
      kind: "retryable",
      code: "approved-context-needed",
    });
    for (const path of ["src/.env", "src/private.key", "outside/helper.ts"])
      expect(classify(path)).toMatchObject({ kind: "approval-needed" });
    expect(classify("src/helper.ts", "write")).toMatchObject({
      kind: "approval-needed",
    });
  });

  it("routes a Green constraint from its accepted Red artifact to bounded correction", () => {
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-red-constraint",
          code: "boundary-review-needed",
          refs: [
            "tests/foundation.test.mjs:209",
            "tests/foundation.test.mjs:237",
            "phase-contract.writeSet",
            "scripts/AGENTS.md",
          ],
        },
        {
          phase: "green",
          readPaths: ["src/game.ts"],
          writePaths: ["src/game.ts"],
          taskPaths: ["tests/foundation.test.mjs", "src/game.ts"],
          redWritePaths: ["tests/foundation.test.mjs"],
          agents: { impact: "none" },
        },
      ),
    ).toMatchObject({
      kind: "retryable",
      code: "red-artifact-constraint",
      contextRequest: {
        refs: [
          {
            kind: "source-citation",
            path: "tests/foundation.test.mjs",
            line: 209,
          },
          {
            kind: "source-citation",
            path: "tests/foundation.test.mjs",
            line: 237,
          },
          {
            kind: "contract-diagnostic",
            ref: "phase-contract.writeSet",
          },
          {
            kind: "requested-path",
            path: "scripts/AGENTS.md",
            access: "read",
          },
        ],
      },
    });
  });

  it("classifies requested write access against only writable boundaries", () => {
    const boundary = {
      phase: "green" as const,
      readPaths: ["src/read-only.ts"],
      writePaths: ["src/writable.ts"],
      deletePaths: ["src/deletable.ts"],
      taskPaths: ["src/read-only.ts", "src/writable.ts", "src/deletable.ts"],
      redWritePaths: ["tests/red-only.test.ts"],
      agents: { impact: "none" as const },
    };
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-read-context",
          code: "approved-context-needed",
          refs: [
            {
              kind: "requested-path",
              path: "src/read-only.ts",
              access: "read",
            },
          ],
        },
        boundary,
      ),
    ).toMatchObject({ kind: "retryable", code: "approved-context-needed" });
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-write-context",
          code: "approved-context-needed",
          refs: [
            {
              kind: "requested-path",
              path: "src/read-only.ts",
              access: "write",
            },
          ],
        },
        boundary,
      ),
    ).toMatchObject({
      kind: "approval-needed",
      code: "boundary-review-needed",
    });
  });

  it("keeps AGENTS authority parent-owned and separately classified", () => {
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-agents-unapproved",
          code: "approved-context-needed",
          refs: [
            {
              kind: "requested-path",
              path: "scripts/AGENTS.md",
              access: "write",
            },
          ],
        },
        {
          phase: "green",
          readPaths: ["src/game.ts"],
          writePaths: ["src/game.ts"],
          taskPaths: ["src/game.ts"],
          redWritePaths: ["tests/foundation.test.mjs"],
          agents: { impact: "none" },
        },
      ),
    ).toMatchObject({
      kind: "approval-needed",
      code: "agents-contract-insufficient",
    });
    expect(
      classifyCandidateContextRequest(
        {
          kind: "context-request",
          candidateId: "candidate-agents-parent",
          code: "boundary-review-needed",
          refs: [
            {
              kind: "requested-path",
              path: "AGENTS.md",
              access: "write",
            },
          ],
        },
        {
          phase: "green",
          readPaths: ["src/game.ts"],
          writePaths: ["src/game.ts"],
          taskPaths: ["src/game.ts"],
          redWritePaths: ["tests/foundation.test.mjs"],
          agents: { impact: "update-existing", target: "AGENTS.md" },
        },
      ),
    ).toMatchObject({
      kind: "paused",
      code: "agents-write-parent-owned",
    });
  });

  it("lets an implementation Worker correct one invalid structured patch", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-patch-correction-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "a.txt"), "old\n");
    const candidateId = "candidate-patch-correction";
    let retained = Buffer.alloc(0);
    const faux = fauxProvider({
      provider: "abel-faux-patch-correction",
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          kind: "candidate-patch",
          candidateId,
          operations: [
            {
              kind: "replace",
              path: "a.txt",
              oldText: "missing",
              newText: "new",
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          kind: "candidate-patch",
          candidateId,
          operations: [
            {
              kind: "replace",
              path: "a.txt",
              oldText: "old",
              newText: "new",
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "Correct one rejected structured patch.",
      requestId: "task-patch-correction",
      taskId: "task-patch-correction",
      role: "implementation-worker",
      phase: "green",
      output: "diff",
      roots: [cwd],
      timeoutMs: 5_000,
      candidateArtifact: {
        ledger: {
          beginCandidate: () => ({ ok: true as const }),
          appendCandidateSegment: (input: { bytes: Uint8Array }) => {
            retained = Buffer.concat([retained, Buffer.from(input.bytes)]);
            return { ok: true as const, nextSequence: 1 };
          },
          sealCandidate: () => ({
            ok: true as const,
            artifactHash: createHash("sha256").update(retained).digest("hex"),
            bytes: retained.byteLength,
            paths: ["a.txt"],
          }),
        } as never,
        identity: {
          candidateId,
          runId: "run-patch-correction",
          deliveryRevision: 1,
          taskId: "task-patch-correction",
          phase: "green",
          attemptId: "attempt-patch-correction",
          approvedPaths: ["a.txt"],
          isolatedRevisionId: "b".repeat(64),
          verificationId: "patch-correction-green",
          routeId: "implementation-primary",
          routeFingerprint: "c".repeat(64),
        },
        workspaceRoot: cwd,
        writePaths: ["a.txt"],
        deletePaths: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.submitCount).toBe(2);
    expect(result.classification.finalCategory).toBe("multiple-submit");
    expect(faux.state.callCount).toBe(2);
  });

  it("lets a diagnosis Worker submit structured operations and receives a trusted diff", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-diagnosis-patch-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "a.txt"), "old\n");
    const faux = fauxProvider({
      provider: "abel-faux-diagnosis-patch",
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          kind: "candidate-patch",
          candidateId: "diagnosis-patch",
          operations: [
            {
              kind: "replace",
              path: "a.txt",
              oldText: "old",
              newText: "new",
            },
          ],
        }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "Submit one diagnosis patch.",
      requestId: "diagnosis-patch",
      taskId: "diagnosis-patch",
      role: "diagnosis-worker",
      phase: "red",
      output: "diff",
      roots: [cwd],
      timeoutMs: 5_000,
      structuredPatch: {
        workspaceRoot: cwd,
        writePaths: ["a.txt"],
        deletePaths: [],
      },
    });
    expect(result).toMatchObject({
      ok: true,
      result: {
        kind: "diff",
        id: "diagnosis-patch",
        role: "diagnosis-worker",
        taskId: "diagnosis-patch",
        phase: "red",
      },
    });
    if (result.ok && result.result.kind === "diff") {
      expect(result.result.diff).toContain("--- a/a.txt");
      expect(result.result.diff).toContain("+++ b/a.txt");
    }
  });

  it("accepts a diagnosis context request through the same small protocol", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-diagnosis-context-"));
    roots.push(cwd);
    const faux = fauxProvider({
      provider: "abel-faux-diagnosis-context",
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          kind: "context-request",
          candidateId: "diagnosis-context",
          code: "approved-context-needed",
          refs: ["missing.txt"],
        }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    await expect(
      child.runChildSession({
        cwd,
        modelRuntime,
        model: faux.getModel(),
        systemPrompt: "Request missing diagnosis context.",
        requestId: "diagnosis-context",
        taskId: "diagnosis-context",
        role: "diagnosis-worker",
        phase: "red",
        output: "diff",
        roots: [cwd],
        timeoutMs: 5_000,
        structuredPatch: {
          workspaceRoot: cwd,
          writePaths: [],
          deletePaths: [],
        },
      }),
    ).resolves.toMatchObject({
      ok: true,
      result: {
        kind: "context-request",
        candidateId: "diagnosis-context",
        code: "approved-context-needed",
      },
    });
  });

  it("accepts a diagnosis delete operation within the declared write set", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-diagnosis-delete-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "obsolete.txt"), "obsolete\n");
    const faux = fauxProvider({
      provider: "abel-faux-diagnosis-delete",
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall("abel_submit_result", {
          kind: "candidate-patch",
          candidateId: "diagnosis-delete",
          operations: [{ kind: "delete", path: "obsolete.txt" }],
        }),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "Delete the obsolete diagnosis fixture.",
      requestId: "diagnosis-delete",
      taskId: "diagnosis-delete",
      role: "diagnosis-worker",
      phase: "red",
      output: "diff",
      roots: [cwd],
      timeoutMs: 5_000,
      structuredPatch: {
        workspaceRoot: cwd,
        writePaths: ["obsolete.txt"],
        deletePaths: ["obsolete.txt"],
      },
    });
    expect(result).toMatchObject({ ok: true, result: { kind: "diff" } });
    if (result.ok && result.result.kind === "diff") {
      expect(result.result.diff).toContain("deleted file mode");
    }
  });

  it("keeps the first terminal candidate result when its tool batch also reads", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-terminal-candidate-"));
    roots.push(cwd);
    writeFileSync(join(cwd, "a.txt"), "approved context\n");
    const candidateId = "candidate-terminal-result";
    const firstRequest = {
      kind: "context-request" as const,
      candidateId,
      code: "approved-context-needed" as const,
      refs: ["a.txt"],
    };
    const faux = fauxProvider({
      provider: "abel-faux-terminal-candidate",
      api: "faux",
    });
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("abel_submit_result", firstRequest, {
            id: "terminal-context-request",
          }),
          fauxToolCall("read", { path: "a.txt" }, { id: "late-read" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall(
          "abel_submit_result",
          {
            ...firstRequest,
            code: "task-split-needed",
          },
          { id: "overwriting-context-request" },
        ),
        { stopReason: "toolUse" },
      ),
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "Request bounded context once.",
      requestId: "task-terminal-result",
      taskId: "task-terminal-result",
      role: "implementation-worker",
      phase: "green",
      output: "diff",
      roots: [cwd],
      allowedPaths: ["a.txt"],
      timeoutMs: 5_000,
      candidateArtifact: {
        ledger: {
          beginCandidate: () => ({ ok: true as const }),
          appendCandidateSegment: () => ({ ok: true as const }),
          sealCandidate: () => ({
            ok: true as const,
            artifactHash: "a".repeat(64),
            bytes: 1,
            paths: ["a.txt"],
          }),
        } as never,
        identity: {
          candidateId,
          runId: "run-terminal-result",
          deliveryRevision: 1,
          taskId: "task-terminal-result",
          phase: "green",
          attemptId: "attempt-terminal-result",
          approvedPaths: ["a.txt"],
          isolatedRevisionId: "b".repeat(64),
          verificationId: "terminal-result-green",
          routeId: "implementation-primary",
          routeFingerprint: "c".repeat(64),
        },
        workspaceRoot: cwd,
        writePaths: ["a.txt"],
        deletePaths: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result).toEqual({
      ...firstRequest,
      refs: [{ kind: "requested-path", path: "a.txt", access: "read" }],
    });
    expect(result.submitCount).toBe(1);
    expect(faux.state.callCount).toBe(1);
  });
});
type ChildOutcome = {
  ok: boolean;
  result?: unknown;
  failure?: unknown;
  submitCount?: unknown;
  disposeCount?: unknown;
  toolNames?: unknown;
  transportFailure?: unknown;
  classification?: unknown;
  usage?: { totalTokens: number };
};
type ChildModule = NonNullable<typeof child>;
type ParentModule = NonNullable<typeof parentProvider>;
type FauxResponse = ReturnType<typeof fauxAssistantMessage>;

async function runChildSessionFixture(
  childRef: ChildModule,
  parentRef: ParentModule,
  tag: string,
  response: FauxResponse,
  request: {
    requestId: string;
    role: "design-explorer" | "implementation-worker";
    output: "evidence" | "diff";
  } = {
    requestId: "task-1",
    role: "implementation-worker",
    output: "diff",
  },
) {
  const cwd = mkdtempSync(join(tmpdir(), `abel-fc-${tag}-`));
  roots.push(cwd);
  writeFileSync(join(cwd, "a.txt"), "old\n");
  const faux = fauxProvider({ provider: `abel-fc-${tag}`, api: "faux" });
  faux.setResponses(
    response.stopReason === "stop" ? [response, response] : [response],
  );
  const modelRuntime = await parentRef.runtimeForProvider(faux.provider);
  return (await childRef.runChildSession({
    cwd,
    modelRuntime,
    model: faux.getModel(),
    systemPrompt: "Submit the supplied diff through abel_submit_result.",
    requestId: request.requestId,
    role: request.role,
    output: request.output,
    roots: [cwd],
    timeoutMs: 5_000,
  })) as unknown as ChildOutcome;
}

async function runChildSessionResponses(
  childRef: ChildModule,
  parentRef: ParentModule,
  tag: string,
  responses: FauxResponse[],
) {
  const cwd = mkdtempSync(join(tmpdir(), `abel-fc-${tag}-`));
  roots.push(cwd);
  writeFileSync(join(cwd, "a.txt"), "old\n");
  const faux = fauxProvider({ provider: `abel-fc-${tag}`, api: "faux" });
  faux.setResponses(responses);
  const modelRuntime = await parentRef.runtimeForProvider(faux.provider);
  return (await childRef.runChildSession({
    cwd,
    modelRuntime,
    model: faux.getModel(),
    systemPrompt: "Submit the supplied diff through abel_submit_result.",
    requestId: "task-1",
    role: "implementation-worker",
    output: "diff",
    roots: [cwd],
    timeoutMs: 5_000,
  })) as unknown as ChildOutcome;
}

const validDiffSubmit = {
  id: "task-1",
  role: "implementation-worker",
  kind: "diff",
  taskId: "task-1",
  phase: "red",
  summary: "change a.txt",
  diff: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
  expectedVerification: "cat a.txt",
  risks: [],
  contractCompliant: true,
};

const submitResponse = (submitted: typeof validDiffSubmit): FauxResponse =>
  fauxAssistantMessage(fauxToolCall("abel_submit_result", submitted), {
    stopReason: "toolUse",
  });

describe("structural submission fixture precheck", () => {
  it.each(["length", "error", "aborted"] as const)(
    "never executes a submit from a %s response",
    async (stopReason) => {
      if (!child || !parentProvider) return notReady("child session");
      const result = await runChildSessionResponses(
        child,
        parentProvider,
        `incomplete-${stopReason}`,
        [
          fauxAssistantMessage(
            fauxToolCall("abel_submit_result", validDiffSubmit),
            { stopReason },
          ),
          submitResponse(validDiffSubmit),
        ],
      );
      expect(result.ok).toBe(false);
      expect(result.result).toBeUndefined();
      expect(result.classification).toMatchObject({ attempts: 0 });
    },
  );

  it("accepts corrected submissions after preflight rejection without a stale invalid schema flag", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "preflight-corrected",
      [
        submitResponse({ ...validDiffSubmit, summary: { bad: true } } as never),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(true);
    expect(result.classification).toMatchObject({
      attempts: 2,
      schema: "valid",
    });
  });

  it("counts a validator rejection after preflight rejection as the final correction", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "preflight-then-identity",
      [
        submitResponse({ ...validDiffSubmit, summary: { bad: true } } as never),
        submitResponse({ ...validDiffSubmit, taskId: "wrong" }),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.classification).toMatchObject({
      attempts: 2,
      schema: "valid",
      identity: { task: false },
    });
  });

  it("bounds SDK-rejected schema submissions and never gives a third attempt", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "sdk-schema-limit",
      [
        submitResponse({
          ...validDiffSubmit,
          summary: { invalid: true },
        } as never),
        submitResponse({
          ...validDiffSubmit,
          summary: { invalid: true },
        } as never),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.classification).toMatchObject({
      attempts: 2,
      schema: "invalid",
    });
  });

  it("retains SDK rejection classification when the child subsequently stops with prose", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "sdk-rejected-then-prose",
      [
        submitResponse({
          ...validDiffSubmit,
          summary: { invalid: true },
        } as never),
        fauxAssistantMessage("I cannot submit."),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toMatchObject({ code: "invalid-structural-result" });
    expect(result.classification).toMatchObject({
      attempts: 1,
      schema: "invalid",
    });
  });

  it("does not remind after a rejected submit followed by prose", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "rejected-then-prose",
      [
        submitResponse({ ...validDiffSubmit, taskId: "wrong" }),
        fauxAssistantMessage("I cannot submit."),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.classification).toMatchObject({ attempts: 1 });
  });

  it("requests one same-session submission after a text-only stop", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "text-then-submit",
      [
        fauxAssistantMessage("The investigation is complete."),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(true);
    expect(result.disposeCount).toBe(1);
  });

  it("does not repeatedly prompt a text-only child", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "text-twice",
      [
        fauxAssistantMessage("The investigation is complete."),
        fauxAssistantMessage("Still no submit."),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(false);
    expect(result.failure).toMatchObject({
      code: "child-no-structural-submit",
    });
  });

  it("does not prompt a truncated response for submission", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "text-truncated",
      [
        fauxAssistantMessage("Partial result", { stopReason: "length" }),
        submitResponse(validDiffSubmit),
      ],
    );
    expect(result.ok).toBe(false);
  });

  it("runs one valid strict diff submit through a real in-memory child session", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "precheck",
      submitResponse(validDiffSubmit),
    );
    expect(result.ok).toBe(true);
    expect(result.submitCount).toBe(1);
    expect(result.disposeCount).toBe(1);
    expect(result.toolNames).toEqual([
      "read",
      "grep",
      "find",
      "ls",
      "abel_submit_result",
    ]);
  });
});

describe("structural submission classification", () => {
  it("accepts a validated submit accompanied by harmless assistant text", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "submit-with-text",
      fauxAssistantMessage(
        [
          { type: "text", text: "Submitting the validated result." },
          fauxToolCall("abel_submit_result", validDiffSubmit),
        ],
        { stopReason: "toolUse" },
      ),
    );

    expect(result.ok).toBe(true);
    expect(result.submitCount).toBe(1);
  });

  it("lets a child correct one rejected structural submission in the same session", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "submit-correction",
      [
        submitResponse({ ...validDiffSubmit, taskId: "wrong-task" }),
        submitResponse(validDiffSubmit),
      ],
    );

    expect(result.ok).toBe(true);
    expect(result.submitCount).toBe(2);
  });

  it("rejects two valid submissions from one assistant tool batch", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "two-valid-submits",
      fauxAssistantMessage(
        [
          fauxToolCall("abel_submit_result", validDiffSubmit, {
            id: "first-valid-submit",
          }),
          fauxToolCall(
            "abel_submit_result",
            {
              ...validDiffSubmit,
              summary: "attempt to overwrite the accepted result",
            },
            { id: "second-valid-submit" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toMatchObject({
      kind: "artifact",
      code: "invalid-structural-result",
      stage: "structural-submit",
    });
    expect(result.classification).toMatchObject({
      finalCategory: "multiple-submit",
      attempts: 2,
      schema: "invalid",
    });
  });

  it("stops after the one in-session structural correction is also rejected", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const result = await runChildSessionResponses(
      child,
      parentProvider,
      "submit-correction-limit",
      [
        submitResponse({ ...validDiffSubmit, taskId: "wrong-task-one" }),
        submitResponse({ ...validDiffSubmit, taskId: "wrong-task-two" }),
        submitResponse(validDiffSubmit),
      ],
    );

    expect(result.ok).toBe(false);
    expect(result.classification).toMatchObject({
      attempts: 2,
      schema: "valid",
      identity: { task: false },
    });
  });

  it("[SLICE-2:typed-failure] measures non-ASCII evidence limits in UTF-8 bytes", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const submitted = {
      ...evidence(),
      existing_structures: [
        "界".repeat(Math.ceil(LIMITS.maxCompleteResultBytes / 3)),
      ],
    };
    const serialized = JSON.stringify(submitted);
    expect(serialized.length).toBeLessThan(LIMITS.maxCompleteResultBytes);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(
      LIMITS.maxCompleteResultBytes,
    );

    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "result-limit-evidence-utf8",
      fauxAssistantMessage(fauxToolCall("abel_submit_result", submitted), {
        stopReason: "toolUse",
      }),
      {
        requestId: "packet-1",
        role: "design-explorer",
        output: "evidence",
      },
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      kind: "result-limit",
      limitBytes: LIMITS.maxCompleteResultBytes,
    });
    expect(result.result).toBeUndefined();
  });

  it("[SLICE-2:typed-failure] measures non-ASCII diff limits in UTF-8 bytes", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const submitted = {
      ...validDiffSubmit,
      diff: [
        "--- a/a.txt",
        "+++ b/a.txt",
        "@@ -1 +1,2 @@",
        "-old",
        "+new",
        `+${"界".repeat(Math.ceil(LIMITS.maxCompleteResultBytes / 3))}`,
        "",
      ].join("\n"),
    };
    const serialized = JSON.stringify(submitted);
    expect(serialized.length).toBeLessThan(LIMITS.maxCompleteResultBytes);
    expect(Buffer.byteLength(serialized, "utf8")).toBeGreaterThan(
      LIMITS.maxCompleteResultBytes,
    );

    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "result-limit-diff-utf8",
      submitResponse(submitted),
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      kind: "result-limit",
      limitBytes: LIMITS.maxCompleteResultBytes,
    });
    expect(result.result).toBeUndefined();
  });

  it("[SLICE-2:typed-failure] returns a terminal result-limit failure without a partial result", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const oversizedDiff = [
      "--- a/a.txt",
      "+++ b/a.txt",
      "@@ -1 +1,2 @@",
      "-old",
      "+new",
      `+${"x".repeat(LIMITS.maxCompleteResultBytes)}`,
      "",
    ].join("\n");
    const result = await runChildSessionFixture(
      child,
      parentProvider,
      "result-limit",
      submitResponse({ ...validDiffSubmit, diff: oversizedDiff }),
    );

    expect(result.ok).toBe(false);
    expect(result.failure).toEqual({
      kind: "result-limit",
      limitBytes: LIMITS.maxCompleteResultBytes,
    });
    expect(result.result).toBeUndefined();
  });

  it("[SLICE-2:typed-failure] distinguishes final shape, attempts, schema, and request/role/task/phase identity", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const classification = (result: ChildOutcome) =>
      result.classification as
        | undefined
        | {
            finalCategory?: unknown;
            attempts?: unknown;
            schema?: unknown;
            identity?: {
              request?: unknown;
              role?: unknown;
              task?: unknown;
              phase?: unknown;
            };
          };

    // Final shape: a single valid strict submit is one retained submission.
    const single = await runChildSessionFixture(
      child,
      parentProvider,
      "single",
      submitResponse(validDiffSubmit),
    );
    const singleCls = classification(single);
    expect.soft(single.ok).toBe(true);
    expect.soft(singleCls?.finalCategory).toBe("single-submit-only");
    expect.soft(singleCls?.attempts).toBe(1);
    expect.soft(singleCls?.schema).toBe("valid");
    expect.soft(singleCls?.identity?.request).toBe(true);
    expect.soft(singleCls?.identity?.role).toBe(true);
    expect.soft(singleCls?.identity?.task).toBe(true);
    expect.soft(singleCls?.identity?.phase).toBe(true);

    // Final shape: an assistant that only produces text is not structural.
    const textOnly = await runChildSessionFixture(
      child,
      parentProvider,
      "text",
      fauxAssistantMessage("explaining progress without submitting"),
    );
    expect.soft(classification(textOnly)?.finalCategory).toBe("text-only");
    expect.soft(textOnly.transportFailure).toBe(false);
    expect.soft(textOnly.failure).toEqual({
      kind: "artifact",
      code: "child-no-structural-submit",
      stage: "child-finalization",
      details: {
        finalCategory: "text-only",
        submitAttempts: 0,
        schema: "not-submitted",
      },
    });

    const providerError = await runChildSessionFixture(
      child,
      parentProvider,
      "provider-error",
      fauxAssistantMessage([], {
        stopReason: "error",
        errorMessage:
          "provider=openai model=private payload=must-not-be-public",
      }),
    );
    expect.soft(providerError.failure).toEqual({
      kind: "transport",
      code: "child-provider-stream-error",
      stage: "child-provider-stream",
    });
    expect(JSON.stringify(providerError)).not.toMatch(
      /openai|private|must-not-be-public/i,
    );

    const providerAborted = await runChildSessionFixture(
      child,
      parentProvider,
      "provider-aborted",
      fauxAssistantMessage([], { stopReason: "aborted" }),
    );
    expect.soft(providerAborted.failure).toEqual({
      kind: "transport",
      code: "child-provider-stream-aborted",
      stage: "child-provider-stream",
    });

    // Attempts: a wrong request is still counted as an attempted submit.
    const wrongRequest = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-request",
      submitResponse({ ...validDiffSubmit, id: "other-task" }),
    );
    expect.soft(wrongRequest.ok).toBe(false);
    expect.soft(classification(wrongRequest)?.attempts).toBe(1);
    expect.soft(classification(wrongRequest)?.identity?.request).toBe(false);
    expect.soft(wrongRequest.failure).toMatchObject({
      kind: "artifact",
      code: "structural-identity-mismatch",
      stage: "structural-submit",
      details: { identityMismatch: ["request"] },
    });

    // Attempts: a wrong role is still counted as an attempted submit.
    const wrongRole = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-role",
      submitResponse({ ...validDiffSubmit, role: "design-explorer" }),
    );
    expect.soft(wrongRole.ok).toBe(false);
    expect.soft(classification(wrongRole)?.attempts).toBe(1);
    expect.soft(classification(wrongRole)?.identity?.role).toBe(false);
    expect.soft(wrongRole.failure).toMatchObject({
      kind: "artifact",
      code: "structural-identity-mismatch",
      details: { identityMismatch: ["role"] },
    });

    // Identity: a wrong task id must be rejected before retention.
    const wrongTask = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-task",
      submitResponse({ ...validDiffSubmit, taskId: "other-task" }),
    );
    expect.soft(wrongTask.ok).toBe(false);
    expect.soft(classification(wrongTask)?.identity?.task).toBe(false);
    expect.soft(wrongTask.failure).toMatchObject({
      kind: "artifact",
      code: "structural-identity-mismatch",
      details: { identityMismatch: ["task"] },
    });

    // Identity: a phase other than the request phase must be rejected.
    const wrongPhase = await runChildSessionFixture(
      child,
      parentProvider,
      "wrong-phase",
      submitResponse({ ...validDiffSubmit, phase: "green" }),
    );
    expect.soft(wrongPhase.ok).toBe(false);
    expect.soft(classification(wrongPhase)?.identity?.phase).toBe(false);
    expect.soft(wrongPhase.failure).toMatchObject({
      kind: "artifact",
      code: "structural-identity-mismatch",
      details: { identityMismatch: ["phase"] },
    });

    // Schema: an invalid diff payload is rejected and classed as invalid.
    const invalidSchema = await runChildSessionFixture(
      child,
      parentProvider,
      "schema",
      submitResponse({ ...validDiffSubmit, diff: "not a diff" }),
    );
    expect.soft(invalidSchema.ok).toBe(false);
    expect.soft(classification(invalidSchema)?.schema).toBe("invalid");
    expect.soft(invalidSchema.transportFailure).toBe(false);
    expect.soft(invalidSchema.failure).toEqual({
      kind: "artifact",
      code: "invalid-diff",
      stage: "candidate-diff",
      details: {
        finalCategory: "mixed",
        submitAttempts: 1,
        schema: "invalid",
      },
    });

    const invalidStructural = await runChildSessionFixture(
      child,
      parentProvider,
      "invalid-structural",
      submitResponse({ ...validDiffSubmit, summary: "" }),
    );
    expect.soft(invalidStructural.failure).toMatchObject({
      kind: "artifact",
      code: "invalid-structural-result",
      stage: "structural-submit",
      details: { schema: "invalid", submitAttempts: 1 },
    });
  });
});

describe("child scoped tool argument compatibility", () => {
  it("accepts Pi-style find, ls, grep, and windowed read arguments", async () => {
    if (!child || !parentProvider) return notReady("child session");
    const cwd = mkdtempSync(join(tmpdir(), "abel-child-tools-"));
    roots.push(cwd);
    mkdirSync(join(cwd, "src"));
    writeFileSync(
      join(cwd, "src", "index.ts"),
      Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n"),
    );
    writeFileSync(join(cwd, "src", "other.ts"), "other\n");
    writeFileSync(join(cwd, "readme.md"), "# readme\n");
    const toolResults: Array<{
      toolName: string;
      isError: boolean;
      text: string;
    }> = [];
    const faux = fauxProvider({
      provider: "abel-faux-child-tools",
      api: "faux",
    });
    const collect = (context: { messages: Array<{ role: string }> }) => {
      for (const message of context.messages) {
        if (message.role !== "toolResult") continue;
        const result = message as unknown as {
          toolName: string;
          isError: boolean;
          content: Array<{ type?: string; text?: string }>;
        };
        const text = result.content
          .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
          .join("\n");
        if (
          !toolResults.some(
            (entry) =>
              entry.toolName === result.toolName && entry.text === text,
          )
        ) {
          toolResults.push({
            toolName: result.toolName,
            isError: result.isError,
            text,
          });
        }
      }
    };
    faux.setResponses([
      (context) => {
        collect(context);
        return fauxAssistantMessage(
          fauxToolCall(
            "find",
            { path: "src", pattern: "*.ts", limit: 1 },
            { id: "find-1" },
          ),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        collect(context);
        return fauxAssistantMessage(fauxToolCall("ls", {}, { id: "ls-1" }), {
          stopReason: "toolUse",
        });
      },
      (context) => {
        collect(context);
        return fauxAssistantMessage(
          fauxToolCall(
            "read",
            { path: "src/index.ts", offset: 4, limit: 3 },
            { id: "read-1" },
          ),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        collect(context);
        return fauxAssistantMessage(
          fauxToolCall("grep", { pattern: "line 1" }, { id: "grep-1" }),
          { stopReason: "toolUse" },
        );
      },
      (context) => {
        collect(context);
        return fauxAssistantMessage(
          fauxToolCall("abel_submit_result", evidence(), { id: "submit-1" }),
          { stopReason: "toolUse" },
        );
      },
    ]);
    const modelRuntime = await parentProvider.runtimeForProvider(faux.provider);
    const result = await child.runChildSession({
      cwd,
      modelRuntime,
      model: faux.getModel(),
      systemPrompt: "Inspect the fixture through scoped tools, then submit.",
      requestId: "packet-1",
      role: "design-explorer",
      output: "evidence",
      roots: [cwd],
      allowedPaths: ["src/index.ts", "src/other.ts"],
      timeoutMs: 8_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byName = Object.fromEntries(
      toolResults.map((entry) => [entry.toolName, entry]),
    );
    expect(byName.find?.isError).toBe(false);
    expect(byName.find?.text).toContain('"entries":["src/index.ts"]');
    expect(byName.find?.text).not.toContain("other.ts");
    expect(byName.find?.text).not.toContain(cwd);
    expect(byName.ls?.isError).toBe(false);
    expect(byName.ls?.text).toContain('"name":"src"');
    expect(byName.ls?.text).not.toContain("readme.md");
    expect(byName.read?.isError).toBe(false);
    expect(byName.read?.text).toContain("line 4");
    expect(byName.read?.text).not.toContain("line 1");
    expect(byName.grep?.isError).toBe(false);
    expect(byName.grep?.text).toContain("src/index.ts");
  });
});
