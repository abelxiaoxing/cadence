import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CheckoutGate } from "../src/service/checkout-gate.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { Workflows } from "../src/service/workflows.ts";

const worker = vi.hoisted(() => vi.fn());
vi.mock("../src/subagent-process.ts", async (original) => ({
  ...(await original<typeof import("../src/subagent-process.ts")>()),
  launchWorkflowWorker: worker,
}));

// Owner/SDK boundary unit fixture, not native-process evidence. Real process
// ordering and generated-owner closure have separate integration tests.
it.each([false, true])(
  "lifecycle observations stay in memory until original settlement; storage failure=%s retains fences",
  async (failStorage) => {
    const home = mkdtempSync(join(tmpdir(), "workflow-lifecycle-"));
    const cwd = join(home, "project");
    mkdirSync(cwd, { mode: 0o700 });
    const coordination = new ServiceCoordination(cwd, join(home, "state"));
    coordination.files.directory(coordination.directory, true);
    const epoch = randomUUID();
    const version = {
      epoch,
      accessGeneration: 1,
      configRev: 1,
      catalogId: randomUUID(),
    };
    const owner = {
      state: "idle" as "idle" | "quarantined",
      lease: { assert() {}, registration: { epoch } },
      quarantine() {
        owner.state = "quarantined";
      },
      trackConversation(p: Promise<unknown>) {
        void p.catch(() => {});
      },
      trackConversationProcess(p: Promise<unknown>) {
        void p.catch(() => {});
      },
    };
    const gate = new CheckoutGate(owner);
    const workflows = new Workflows({
      coordination,
      owner,
      gate,
      cwd,
      secrets: () => [],
      models: {
        assertCurrent() {},
        prepareTracked: () => ({
          result: Promise.resolve({ status: "prepared", prepared: {} }),
          settled: Promise.resolve(),
        }),
      },
      choice: {
        snapshot: () => ({
          version,
          selected: {
            sourceSelectionId: randomUUID(),
            provider: "fixture",
            model: "fixed",
            api: "openai-completions",
            thinking: "off",
          },
        }),
      },
    } as unknown as ConstructorParameters<typeof Workflows>[0]);
    const replace = vi.spyOn(coordination.files, "replace");
    let observed = false;
    worker.mockImplementationOnce(async (_prepared, _cwd, _signal, options) => {
      const writes = replace.mock.calls.length;
      const at = Date.now();
      for (const kind of ["spawned", "stop-requested", "closed"] as const) {
        options.onLifecycle({
          kind,
          at,
          ...(kind === "stop-requested" ? { reason: "timeout" } : {}),
        });
        expect(replace.mock.calls.length).toBe(writes);
      }
      observed = true;
      options.onNative({
        outcome: "timeout",
        closure: "direct-child-closed",
        exitCode: null,
        signal: "SIGTERM",
        durationMs: 100,
        stdin: "delivered",
        final: "missing",
        cleanup: "unconfirmed",
        capture: {
          observed: "incomplete",
          source: "unavailable",
          redacted: false,
          omissions: ["gap"],
        },
      });
      if (failStorage)
        replace.mockImplementationOnce(() => {
          throw new Error("fixture storage refusal");
        });
      return {
        outcome: "timeout",
        closed: true,
        exitCode: null,
        signal: "SIGTERM",
        durationMs: 100,
        text: "fixture timeout",
        output: "",
        truncated: false,
      };
    });
    try {
      const id = randomUUID();
      workflows.command(id, epoch, {
        action: "research",
        goal: "Bounded observation",
        questions: ["q"],
        model: version,
      });
      await workflows.join(id);
      expect(observed).toBe(true);
      const view = workflows.view(id);
      if (view.kind !== "workflow" || view.response.type !== "run")
        throw Error("run");
      expect(view.response.run.status).toBe(
        failStorage ? "unknown" : "timeout",
      );
      expect(view.response.run.steps[0].timing).toMatchObject({
        startedAt: expect.any(Number),
        stopRequestedAt: expect.any(Number),
        closedAt: expect.any(Number),
        settledAt: expect.any(Number),
        stopReason: "timeout",
      });
      if (failStorage) {
        expect(owner.state).toBe("quarantined");
        // Test-only observation of the gate's held reservation, without releasing it.
        owner.state = "idle";
        expect(() => gate.assertQuiescent()).toThrow("conflict");
        owner.state = "quarantined";
      } else gate.assertQuiescent();
    } finally {
      replace.mockRestore();
      workflows.closeHistory();
    }
  },
);
