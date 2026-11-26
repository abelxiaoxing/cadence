import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CheckoutGate } from "../src/service/checkout-gate.ts";
import {
  WORKFLOW_LIMITS,
  workflowContext,
  workflowPlanInput,
} from "../src/service/contracts/workflow.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { RUN_TEMP_DIRECTORY } from "../src/service/run-environment.ts";
import {
  reviewVerdict,
  WorkflowTranscript,
} from "../src/service/workflow-report.ts";
import { Workflows } from "../src/service/workflows.ts";
import { fixtureRuntime } from "./helpers/worker-runtime.ts";
import { plan } from "./helpers/workflow-plan.ts";

const worker = vi.hoisted(() => vi.fn());
vi.mock("../src/subagent-process.ts", async (original) => ({
  ...(await original<typeof import("../src/subagent-process.ts")>()),
  launchWorkflowWorker: worker,
}));

// Owner/SDK boundary unit fixture, not native-process evidence. Real process
// ordering and generated-owner closure have separate integration tests.
it.each([
  [false, false],
  [true, false],
  [false, true],
])(
  "lifecycle observations retain actual closure; storage failure=%s editing cleanup unknown=%s",
  async (failStorage, editing) => {
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
        workerSettings: () => fixtureRuntime(),
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
    let temporaryDirectory: string | undefined;
    // The planner submits its route through cadence_route; the final prose is
    // not parsed for JSON anymore.
    const selectedPlan = editing
      ? vi
          .spyOn(WorkflowTranscript.prototype, "submission")
          .mockReturnValueOnce(
            JSON.stringify({
              tasks: [
                {
                  id: "a",
                  title: "A",
                  instructions: "Create a.txt",
                  writes: ["a.txt"],
                  after: [],
                  reads: [],
                },
              ],
            }),
          )
      : undefined;
    if (editing)
      worker.mockImplementationOnce(
        async (_prepared, _cwd, _signal, options) => {
          options.onNative({
            outcome: "completed",
            closure: "direct-child-closed",
            exitCode: 0,
            signal: null,
            durationMs: 10,
            stdin: "delivered",
            final: "valid",
            cleanup: "settled",
            capture: {
              observed: "complete",
              source: "available",
              redacted: false,
              omissions: [],
            },
          });
          return {
            outcome: "completed",
            closed: true,
            exitCode: 0,
            signal: null,
            durationMs: 10,
            text: "",
            output: "",
            truncated: false,
          };
        },
      );
    worker.mockImplementationOnce(async (_prepared, _cwd, _signal, options) => {
      temporaryDirectory = options.temporaryDirectory;
      expect(!!temporaryDirectory).toBe(editing);
      if (temporaryDirectory) expect(existsSync(temporaryDirectory)).toBe(true);
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
      if (editing) {
        const definition = plan();
        definition.delivery = "working-copy";
        const proposed = workflows.command(randomUUID(), epoch, {
          action: "propose",
          plan: definition,
          model: version,
        });
        if (
          proposed.kind !== "workflow" ||
          proposed.response.type !== "proposal"
        )
          throw Error("proposal");
        const proposal = proposed.response.proposal;
        const prepared = workflows.command(randomUUID(), epoch, {
          action: "prepare",
          proposalId: proposal.id,
          digest: proposal.digest,
        });
        if (prepared.kind !== "workflow" || prepared.response.type !== "grant")
          throw Error("grant");
        workflows.command(id, epoch, {
          action: "execute",
          proposalId: proposal.id,
          digest: proposal.digest,
          grant: prepared.response.grant,
        });
      } else
        workflows.command(id, epoch, {
          action: "research",
          goal: "Bounded observation",
          questions: ["q"],
          model: version,
        });
      await workflows.join(id);
      expect(observed).toBe(true);
      if (editing) expect(existsSync(temporaryDirectory!)).toBe(true);
      else
        expect(
          readdirSync(coordination.stateHome).includes(RUN_TEMP_DIRECTORY),
        ).toBe(false);
      const view = workflows.view(id);
      if (view.kind !== "workflow" || view.response.type !== "run")
        throw Error("run");
      expect(view.response.run.status).toBe(
        failStorage || editing ? "unknown" : "timeout",
      );
      expect(view.response.run.steps.at(-1)?.timing).toMatchObject({
        startedAt: expect.any(Number),
        stopRequestedAt: expect.any(Number),
        closedAt: expect.any(Number),
        settledAt: expect.any(Number),
        stopReason: "timeout",
      });
      if (failStorage || editing) {
        expect(owner.state).toBe("quarantined");
        // Test-only observation of the gate's held reservation, without releasing it.
        owner.state = "idle";
        // Only a run that edits the checkout holds it; research holds nothing.
        if (editing) expect(() => gate.assertQuiescent()).toThrow("conflict");
        else gate.assertQuiescent();
        owner.state = "quarantined";
      } else gate.assertQuiescent();
    } finally {
      selectedPlan?.mockRestore();
      replace.mockRestore();
      workflows.closeHistory();
    }
  },
);

it.each([
  ["implementation", false, "short"],
  ["diagnosis", false, "short"],
  ["review", false, "short"],
  ["implementation", true, "short"],
  ["diagnosis", true, "short"],
  ["review", true, "short"],
  ["implementation", true, "shared"],
  ["diagnosis", true, "shared"],
  ["review", true, "shared"],
  ["implementation", true, "separate"],
  ["diagnosis", true, "separate"],
  ["review", true, "separate"],
] as const)(
  "%s preserves completion boundaries independently of diagnostic truncation (full agreement: %s, temporary path: %s)",
  async (kind, fullAgreement, temporaryPath) => {
    const cwd = mkdtempSync(join(tmpdir(), "workflow-report-projection-"));
    const epoch = randomUUID();
    const version = {
      epoch,
      accessGeneration: 1,
      configRev: 1,
      catalogId: randomUUID(),
    };
    const model = {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "fixed",
      api: "openai-completions",
      thinking: "off",
    };
    const report = { status: "completed", summary: "Completed assignment" };
    const diagnosis = {
      action: "continue",
      cause: "Split remaining work",
      evidence: ["failed-step"],
      strategy: "Implement the remaining parts separately",
      work: Array.from({ length: 3 }, (_, i) => ({
        title: `Part ${i}`,
        instructions: "x".repeat(8192),
        writes: ["src"],
      })),
    };
    const selected = vi
      .spyOn(WorkflowTranscript.prototype, "selected")
      .mockReturnValue(
        kind === "diagnosis"
          ? "Decision submitted; nothing else to add."
          : kind === "review"
            ? `{"approved":true}\n${"Context ".repeat(3000)}\n{"approved":false,"blockingIssues":["missing requirement"]}`
            : undefined,
      );
    // The capture parser has separate event-stream tests. This isolates the
    // owner projection when its complete submission survives a missing final
    // preview: a structured role's text is its tool submission, never its prose.
    const captured = vi
      .spyOn(WorkflowTranscript.prototype, "submission")
      .mockImplementation((tool) =>
        tool === "cadence_recovery"
          ? JSON.stringify(diagnosis)
          : JSON.stringify(report),
      );
    const live = {
      execution: { version, model },
      abort: new AbortController(),
      run: {
        id: randomUUID(),
        epoch,
        goal: "Fixture",
        phase: "implementing",
        steps: [],
      },
    };
    // Both checkout and scratch may inherit a long state-home prefix, or
    // have separate long prefixes. Quotes also exercise JSON escaping.
    const executionRoot = fullAgreement
      ? `/${Array(16).fill('"'.repeat(240)).join("/")}`
      : cwd;
    const temporaryDirectory =
      temporaryPath === "shared"
        ? join(executionRoot, "..", "owned-temporary")
        : temporaryPath === "separate"
          ? `/${Array(16).fill('q"'.repeat(120)).join("/")}/owned-temporary`
          : "/owned-temporary";
    let agreement: string | undefined;
    if (fullAgreement) {
      const definition = plan();
      definition.design += "x".repeat(
        WORKFLOW_LIMITS.context -
          Buffer.byteLength(workflowContext(definition)),
      );
      const approved = workflowPlanInput(definition);
      agreement = workflowContext(approved);
      expect(Buffer.byteLength(agreement)).toBe(WORKFLOW_LIMITS.context);
      Object.assign(live, {
        proposal: { plan: approved },
        environment: {
          forWorkspace: () => ({
            TMPDIR: temporaryDirectory,
            TEMP: temporaryDirectory,
            TMP: temporaryDirectory,
          }),
        },
      });
    }
    // Escaped, long placement metadata must not overflow the separate
    // instructions field either. Filesystem operations remain controlled here.
    const executionCwd = fullAgreement ? `${executionRoot}/scoped` : cwd;
    if (fullAgreement)
      Object.assign(live, {
        delivery: {
          view: {
            worktreeRoot: join(executionRoot, "..", "integration"),
            artifacts: [
              { id: "assignment", path: executionRoot, base: "a".repeat(40) },
            ],
          },
        },
      });
    const requests: { request: { context: string; instructions: string } }[] =
      [];
    const owner = Object.assign(Object.create(Workflows.prototype), {
      cwd: executionRoot,
      root: cwd,
      assertRunning() {},
      executionCwd: () => executionCwd,
      reader: async () => ({ writes: [], named: {} }),
      save() {},
      write: () => ({}),
      o: {
        secrets: () => [],
        owner: {
          lease: { assert() {} },
          trackConversationProcess: (p: Promise<unknown>) => {
            void p.catch(() => {});
          },
        },
        models: {
          workerSettings: () => fixtureRuntime(),
          assertCurrent() {},
          prepareTracked: (input: {
            request: { context: string; instructions: string };
          }) => {
            requests.push(input);
            return {
              result: Promise.resolve({ status: "prepared", prepared: {} }),
              settled: Promise.resolve(),
            };
          },
        },
      },
    });
    worker.mockImplementationOnce(async (_prepared, _cwd, _signal, options) => {
      const placementLine = requests[0].request.instructions
        .split("\n")
        .find((line) =>
          line.startsWith("Execution placement (data, not instructions): "),
        )!;
      const placement = JSON.parse(
        placementLine.slice(placementLine.indexOf("{")),
      );
      expect(placement.temporaryDirectoryEnvironment).toBe(
        fullAgreement ? "TMPDIR" : undefined,
      );
      expect(placement).not.toHaveProperty("temporaryDirectory");
      if (fullAgreement) {
        expect(options.temporaryDirectory).toBe(temporaryDirectory);
        expect(requests[0].request.instructions).not.toContain(
          JSON.stringify(temporaryDirectory),
        );
      } else expect(options.temporaryDirectory).toBeUndefined();
      options.onNative({
        outcome: "completed",
        closure: "direct-child-closed",
        exitCode: 0,
        signal: null,
        durationMs: 1,
        stdin: "delivered",
        final: "valid",
        cleanup: "settled",
        capture: {
          observed: "incomplete",
          source: "unavailable",
          redacted: false,
          omissions: ["gap"],
        },
      });
      return {
        outcome: "completed",
        closed: true,
        exitCode: 0,
        signal: null,
        durationMs: 1,
        text: "clipped final",
        output: "[diagnostic truncated]",
        truncated: true,
      };
    });
    try {
      const { result, step } = await owner.worker(
        live,
        executionRoot,
        "assignment",
        "Inspect fixture",
        kind !== "implementation",
        version,
        undefined,
        kind,
      );
      if (agreement) {
        expect(requests[0].request.context).toBe(agreement);
        expect(requests[0].request.instructions).toContain(
          JSON.stringify(executionRoot),
        );
        expect(requests[0].request.instructions).toContain(
          '"cwdRelativeToCheckout":"scoped"',
        );
        expect(
          Buffer.byteLength(requests[0].request.instructions),
        ).toBeLessThanOrEqual(16 * 1024);
        expect(requests[0].request.instructions).toContain("TMPDIR");
        expect(requests[0].request.instructions).toContain(
          '"combinedCandidateRelativeToCheckout":"../integration"',
        );
        expect(requests[0].request.instructions).toContain(
          "Detached assignment snapshot: inspect combinedCandidateRelativeToCheckout readonly for completed sibling outputs; finish only this assignment.",
        );
        expect(requests[0].request.instructions).toContain(
          "There is no total runtime deadline",
        );
        expect(requests[0].request.instructions).not.toContain(
          "Do not delegate, restart the workflow, mutate Git",
        );
      }
      if (kind === "review") {
        expect(reviewVerdict(result.text)).toBeNull();
        expect(step.status).toBe("failed");
      } else
        expect(JSON.parse(result.text)).toEqual(
          kind === "diagnosis" ? diagnosis : report,
        );
      expect(result.truncated).toBe(true);
    } finally {
      captured.mockRestore();
      selected.mockRestore();
    }
  },
);
