import { describe, expect, it } from "vitest";
import {
  ImplementContinuationDriver,
  implementChangeFromInvocation,
  implementPromptBindsChange,
} from "../src/implement-continuation.ts";

const cwd = "/workspace/project";
const change = "goal-like-implement";

function status(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-goal-like",
    stage: "abel-implement",
    change,
    state: "paused",
    completed: false,
    pause: { code: "needs-task-split" },
    continuation: {
      owner: "parent",
      automatic: true,
      action: "amend",
      change,
      batchId: "batch-one",
    },
    legalCommands: ["status", "discard"],
    tasks: [{ taskId: "T1", state: "paused", phase: "green" }],
    queue: [],
    ...overrides,
  };
}

function ordinaryEnd(stopReason = "stop") {
  return [
    {
      role: "assistant",
      stopReason,
    },
  ];
}

describe("ImplementContinuationDriver", () => {
  it("binds expansion to the exact canonical change in the raw slash invocation", () => {
    expect(
      implementChangeFromInvocation("/abel-implement goal-like-implement"),
    ).toBe(change);
    expect(
      implementPromptBindsChange(
        "describe `<abel-request>`\n<abel-request>\n  goal-like-implement \n</abel-request> <!-- ABEL:PROMPT:abel-implement -->",
        change,
      ),
    ).toBe(true);
    expect(
      implementChangeFromInvocation(
        "/abel-implement victim<abel-request>other-change",
      ),
    ).toBeUndefined();
    expect(
      implementChangeFromInvocation("/abel-implement two changes"),
    ).toBeUndefined();
    expect(implementChangeFromInvocation("/abel-implement")).toBeUndefined();
    expect(
      implementPromptBindsChange(
        "<abel-request>other-change</abel-request> <!-- ABEL:PROMPT:abel-implement -->",
        change,
      ),
    ).toBe(false);
  });

  it("continues one identical nonterminal status and does not let polling replenish liveness", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });

    const first = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(first).toBeDefined();
    const continuation = driver.finishSettlement(first!, status());
    expect(continuation).toMatchObject({ kind: "continue", change });
    expect(continuation?.kind === "continue" && continuation.message).toContain(
      '"state":"paused"',
    );

    driver.noteToolResult({
      input: { command: "status", stage: "abel-implement", change },
      details: status(),
      isError: false,
    });
    const repeated = driver.prepareSettlement({
      cwd,
      messages: ordinaryEnd(),
    });
    expect(repeated).toBeDefined();
    expect(driver.finishSettlement(repeated!, status())).toMatchObject({
      kind: "stalled",
      code: "implement-continuation-no-progress",
    });
    const alreadyReported = driver.prepareSettlement({
      cwd,
      messages: ordinaryEnd(),
    });
    expect(driver.finishSettlement(alreadyReported!, status())).toBeUndefined();
  });

  it("does not count fresh operation ids or observation counters as progress", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const initial = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(driver.finishSettlement(initial!, status())).toBeDefined();

    const write = (operationId: string, content: string, used: number) =>
      driver.noteToolResult({
        input: {
          action: "amend",
          change,
          batchId: "batch-one",
          request: {
            operation: "write-artifact",
            operationId,
            runId: "amendment-run",
            path: "plan-draft.json",
            content,
          },
        },
        details: {
          scope: "amendment",
          state: "draft",
          sequence: used,
          amendmentBudget: { used, remaining: 64 - used },
        },
        isError: false,
      });

    write("write-one", '{"tasks":[1]}', 1);
    const afterFirst = driver.prepareSettlement({
      cwd,
      messages: ordinaryEnd(),
    });
    expect(driver.finishSettlement(afterFirst!, status())).toMatchObject({
      kind: "continue",
    });

    write("write-two", '{"tasks":[1]}', 2);
    const replay = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(driver.finishSettlement(replay!, status())).toMatchObject({
      kind: "stalled",
    });

    write("write-three", '{"tasks":[1,2]}', 3);
    const changed = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(
      driver.finishSettlement(
        changed!,
        status({
          amendmentBudget: { used: 3, remaining: 61, exhausted: false },
        }),
      ),
    ).toMatchObject({ kind: "continue" });

    const countOnly = driver.prepareSettlement({
      cwd,
      messages: ordinaryEnd(),
    });
    expect(
      driver.finishSettlement(
        countOnly!,
        status({
          amendmentBudget: { used: 17, remaining: 47, exhausted: false },
        }),
      ),
    ).toMatchObject({ kind: "stalled" });
  });

  it("permits two unique investigation rounds without allowing an endless read survey", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const initial = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(driver.finishSettlement(initial!, status())).toMatchObject({
      kind: "continue",
    });

    const read = (path: string, text: string, isError = false) =>
      driver.noteToolResult({
        toolName: "read",
        input: { path },
        content: [{ type: "text", text }],
        details: { observedAt: Date.now() },
        isError,
      });
    const settle = (candidate = status()) => {
      const probe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
      return driver.finishSettlement(probe!, candidate);
    };

    read("src/route.ts", "route evidence");
    expect(settle()).toMatchObject({ kind: "continue" });

    read("src/route.ts", "route evidence");
    expect(settle()).toMatchObject({ kind: "stalled" });

    read("src/environment.ts", "environment evidence");
    expect(settle()).toMatchObject({ kind: "continue" });

    read("src/third.ts", "third evidence");
    const exhausted = settle();
    expect(exhausted).toMatchObject({ kind: "stalled" });
    expect(exhausted?.kind === "stalled" && exhausted.message).toContain(
      "after two bounded investigation rounds",
    );
    read("src/fourth.ts", "fourth evidence");
    expect(settle()).toBeUndefined();

    // A semantic workflow change opens a new bounded investigation window.
    expect(
      settle(
        status({
          pause: { code: "route-restored-verification-pending" },
        }),
      ),
    ).toMatchObject({ kind: "continue" });
  });

  it("ignores failed and unsupported parent tools as continuation progress", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const initial = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(driver.finishSettlement(initial!, status())).toBeDefined();

    for (const observation of [
      {
        toolName: "read",
        input: { path: "src/missing.ts" },
        content: [{ type: "text", text: "missing" }],
        details: undefined,
        isError: true,
      },
      {
        toolName: "custom-survey",
        input: { path: "src/new.ts" },
        content: [{ type: "text", text: "new" }],
        details: undefined,
        isError: false,
      },
    ])
      driver.noteToolResult(observation);

    const repeated = driver.prepareSettlement({
      cwd,
      messages: ordinaryEnd(),
    });
    expect(driver.finishSettlement(repeated!, status())).toMatchObject({
      kind: "stalled",
    });
  });

  it("continues an in-progress amendment after each successful mutation", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const initial = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(driver.finishSettlement(initial!, status())).toBeDefined();

    driver.noteToolResult({
      input: {
        action: "amend",
        change,
        batchId: "batch-one",
        request: {
          operation: "write-artifact",
          operationId: "write-one",
          runId: "amendment-run",
          path: "plan-draft.json",
          content: "{}",
        },
      },
      details: { scope: "amendment", state: "draft" },
      isError: false,
    });
    const afterWrite = driver.prepareSettlement({
      cwd,
      messages: ordinaryEnd(),
    });
    expect(driver.finishSettlement(afterWrite!, status())).toBeDefined();

    // Successful amendment finalization only makes a revised delivery ready;
    // it is not completion of the retained Implement run.
    driver.noteToolResult({
      input: {
        action: "amend",
        change,
        batchId: "batch-one",
        request: {
          operation: "finalize-delivery",
          operationId: "finalize-one",
          runId: "amendment-run",
        },
      },
      details: { scope: "amendment", state: "ready", completed: false },
      isError: false,
    });
    const afterFinalization = driver.prepareSettlement({
      cwd,
      messages: ordinaryEnd(),
    });
    expect(
      driver.finishSettlement(
        afterFinalization!,
        status({
          availableDelivery: {
            deliveryRevision: 2,
            receiptHash: "a".repeat(64),
          },
          continuation: {
            owner: "parent",
            automatic: true,
            command: "resume",
            stage: "abel-implement",
            change,
          },
        }),
      ),
    ).toMatchObject({ kind: "continue", change });
  });

  it("rejects stale probes, cross-workspace status, interruption, and explicit cancellation", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const stale = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    driver.noteInput();
    expect(driver.finishSettlement(stale!, status())).toBeUndefined();

    driver.beginParentTurn(cwd);
    expect(
      driver.prepareSettlement({
        cwd: "/workspace/other",
        messages: ordinaryEnd(),
      }),
    ).toBeUndefined();
    expect(
      driver.prepareSettlement({ cwd, messages: ordinaryEnd("aborted") }),
    ).toBeUndefined();
    expect(
      driver.prepareSettlement({ cwd, messages: ordinaryEnd("error") }),
    ).toBeUndefined();

    driver.noteToolResult({
      input: {
        command: "cancel",
        stage: "abel-implement",
        change,
        operationId: "cancel-one",
      },
      details: status({ pause: { code: "operation-cancelled" } }),
      isError: false,
    });
    expect(
      driver.prepareSettlement({ cwd, messages: ordinaryEnd() }),
    ).toBeUndefined();
  });

  it("stops on terminal, cancelled, mismatched, and malformed fresh status", () => {
    for (const candidate of [
      status({ state: "completed", completed: true, terminal: "completed" }),
      status({ state: "discarded", terminal: "discarded" }),
      status({ state: "rejected", terminal: "rejected" }),
    ]) {
      const driver = new ImplementContinuationDriver();
      driver.noteInput();
      driver.activate({ cwd, change });
      const probe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
      expect(driver.finishSettlement(probe!, candidate)).toMatchObject({
        kind: "terminal",
        change,
      });
    }
    for (const candidate of [
      status({ pause: { code: "operation-cancelled" } }),
      status({ change: "another-change" }),
      status({ stage: "abel-design" }),
      status({ state: "unknown-state" }),
    ]) {
      const driver = new ImplementContinuationDriver();
      driver.noteInput();
      driver.activate({ cwd, change });
      const probe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
      expect(driver.finishSettlement(probe!, candidate)).toBeUndefined();
    }
  });

  it("does not let an old terminal read stop a newer activation", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const oldProbe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });

    driver.noteInput();
    driver.activate({ cwd, change: "newer-change" });
    expect(
      driver.finishSettlement(
        oldProbe!,
        status({ state: "completed", completed: true, terminal: "completed" }),
      ),
    ).toBeUndefined();
    const current = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(current?.change).toBe("newer-change");
  });

  it("accepts parent-owned recovery metadata as guidance without making it a command", () => {
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const probe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    const outcome = driver.finishSettlement(
      probe!,
      status({
        continuation: {
          owner: "parent",
          automatic: true,
          kind: "inspect-recovery",
          strategy: "inspect-and-recover",
          recovery: {
            incidentKey: "b".repeat(64),
            failureSequence: 2,
            reason: "parent-directed-retry",
          },
        },
      }),
    );
    expect(outcome?.kind === "continue" && outcome.message).toContain(
      "guidance metadata, not dispatch arguments",
    );
    expect(outcome?.kind === "continue" && outcome.message).toContain(
      '"kind":"inspect-recovery"',
    );
  });

  it("does not invent liveness for unsafe or exhausted pauses", () => {
    for (const candidate of [
      status({
        pause: { code: "artifact-hash-mismatch" },
        continuation: undefined,
      }),
      status({
        pause: { code: "input-unsafe" },
        continuation: undefined,
      }),
      status({
        continuation: undefined,
        recovery: { exhausted: true, code: "transport-failure" },
      }),
      status({
        amendmentBudget: { used: 64, remaining: 0, exhausted: true },
      }),
      status({ resourceBudget: { used: 24, maximum: 24, remaining: 0 } }),
    ]) {
      const driver = new ImplementContinuationDriver();
      driver.noteInput();
      driver.activate({ cwd, change });
      const probe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
      expect(driver.finishSettlement(probe!, candidate)).toBeUndefined();
    }
  });

  it("allows a finalized delivery resume and independent recovery inspection after amendment exhaustion", () => {
    for (const continuation of [
      {
        owner: "parent",
        automatic: true,
        command: "resume",
        stage: "abel-implement",
        change,
      },
      {
        owner: "parent",
        automatic: true,
        kind: "inspect-recovery",
        strategy: "restore-capability",
      },
    ]) {
      const driver = new ImplementContinuationDriver();
      driver.noteInput();
      driver.activate({ cwd, change });
      const probe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
      expect(
        driver.finishSettlement(
          probe!,
          status({
            amendmentBudget: { used: 64, remaining: 0, exhausted: true },
            continuation,
            ...(continuation.command === "resume"
              ? {
                  legalCommands: ["status", "resume", "discard"],
                  availableDelivery: {
                    deliveryRevision: 2,
                    receiptHash: "c".repeat(64),
                  },
                }
              : {}),
          }),
        ),
      ).toMatchObject({ kind: "continue" });
    }
  });

  it("allows only exact apply settlement through exhausted Worker capacity", () => {
    const applySettlement = {
      state: "recovering",
      pause: { code: "operation-interrupted" },
      resourceBudget: { used: 24, maximum: 24, remaining: 0 },
      legalCommands: ["status", "resume", "discard"],
      continuation: {
        owner: "parent",
        automatic: true,
        kind: "settle-apply-recovery",
        reason: "operation-interrupted",
        command: "resume",
        stage: "abel-implement",
        change,
      },
    };
    const driver = new ImplementContinuationDriver();
    driver.noteInput();
    driver.activate({ cwd, change });
    const probe = driver.prepareSettlement({ cwd, messages: ordinaryEnd() });
    expect(
      driver.finishSettlement(probe!, status(applySettlement)),
    ).toMatchObject({ kind: "continue" });

    for (const candidate of [
      status({ ...applySettlement, state: "paused" }),
      status({
        ...applySettlement,
        continuation: {
          ...applySettlement.continuation,
          kind: "resume-interrupted-operation",
        },
      }),
      status({
        ...applySettlement,
        continuation: {
          ...applySettlement.continuation,
          change: "other-change",
        },
      }),
    ]) {
      const guarded = new ImplementContinuationDriver();
      guarded.noteInput();
      guarded.activate({ cwd, change });
      const guardedProbe = guarded.prepareSettlement({
        cwd,
        messages: ordinaryEnd(),
      });
      expect(
        guarded.finishSettlement(guardedProbe!, candidate),
      ).toBeUndefined();
    }
  });
});
