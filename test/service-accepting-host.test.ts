import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { HistoryReadBudget } from "../src/history/files.ts";
import { proposePlan } from "../src/plan-proposal.ts";
import { ServiceClient } from "../src/service-client.ts";
import type { Action, Receipt, Reply } from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { confirm, prepare } from "../web/src/client/actions.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { nativeBuild } from "./helpers/source-build.ts";

function ok<T>(reply: Reply<T>): T {
  expect(reply.kind, JSON.stringify(reply)).toBe("ok");
  if (reply.kind !== "ok") throw Error("refused");
  return reply.value;
}
for (const mode of ["source", "generated"] as const)
  it(`actual ${mode} accepting host: explicit choice, saved graph, advisory, overlapping SDK children, real check/review, cancel and compatibility`, async () => {
    const f = await acceptingFixture(mode, (env) => {
      for (const k of Object.keys(process.env))
        if (!(k in env)) vi.stubEnv(k, undefined);
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    });
    const c = f.client;
    const readFailures: string[] = [];
    const reserve = HistoryReadBudget.prototype.reserve;
    if (mode === "source")
      vi.spyOn(HistoryReadBudget.prototype, "reserve").mockImplementation(
        function (
          this: HistoryReadBudget,
          ...args: Parameters<typeof reserve>
        ) {
          try {
            return reserve.apply(this, args);
          } catch (error) {
            if (readFailures.length < 16 && error instanceof Error)
              readFailures.push(error.stack ?? "read failure");
            throw error;
          }
        },
      );
    try {
      const session = ok(await c.session());
      expect(session.capabilities.actions).toBe(false);
      expect(ok(await c.models()).selected).toBeNull();
      expect(f.contacts()).toBe(0);
      const current = async (taskId: string | null) =>
        ok(await c.current({ storeId: session.storeId, taskId }));
      expect((await current(null)).context.status).toBe("unavailable");
      const initialCurrent = await current(null);
      const inventory = ok(
        await c.tasks({
          storeId: session.storeId,
          scope: { kind: "workspace", id: initialCurrent.workspaceId },
          snapshotSeq: null,
          after: null,
          limit: 50,
        }),
      );
      expect(
        "records" in inventory &&
          inventory.records.some(
            (r) => r.kind === "task" && r.owner.taskId === f.legacyId,
          ),
      ).toBe(true);
      expect(JSON.stringify(inventory)).not.toContain(
        "fabricated-accepting-key",
      );
      const catalog = ok(await c.models());
      const choice = {
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions" as const,
          thinking: "off" as const,
        },
      };
      const absent = new HttpServiceTransport({
        origin: f.endpoint,
        localCapability: f.c.localAccess().capability,
      });
      const absentClient = new ServiceClient(absent);
      ok(await absentClient.session());
      expect(await absentClient.chooseModel(choice)).toMatchObject({
        kind: "error",
        error: { effect: "none", code: "unsupported-context" },
      });
      await absent.detach();
      ok(await c.chooseModel(choice));
      expect(ok(await c.session()).capabilities.actions).toBe(true);
      expect(f.contacts()).toBe(0);
      const submit = async (action: Action) => {
        const view = await current(
          action.kind === "create" ? null : action.taskId,
        );
        if (view.context.status !== "available")
          throw Error(JSON.stringify(view));
        return ok(
          await confirm(c, ok(await prepare(c, view.context.version, action))),
        );
      };
      const settled = async (initial: Receipt, execution = false) => {
        let receipt = initial;
        await expect
          .poll(
            async () => {
              const lookup = await c.receipt(initial.commandId);
              if (lookup.status === "found") receipt = lookup.receipt;
              const active = await c.activeRuns();
              return (
                active.kind === "ok" &&
                active.value.status === "complete" &&
                !active.value.runs.some((r) => r.runId === initial.runId) &&
                receipt.publication === "published" &&
                (!execution || typeof receipt.execution === "string")
              );
            },
            { timeout: 15000, interval: 100 },
          )
          .toBe(true);
        return receipt;
      };
      const created = await settled(
        await submit({
          kind: "create",
          taskKind: "code",
          goal: "Accepting host independent readonly analysis",
        }),
      );
      if (!created.created) throw Error("missing task");
      const taskId = created.created.taskId;
      const view = await current(taskId);
      const assignments = ["first", "second"].map((id) => ({
        id,
        purpose: "research" as const,
        instructions: `Inspect ${id} independently without editing.`,
        expectedOutput: "Report actual retained observations.",
        role: view.roles.find((r) => r.role === "design-explorer")!,
        model:
          view.context.status === "available"
            ? view.context.version.model
            : null!,
        dependencies: [],
      }));
      const proposal = await proposePlan(
        view,
        "Two independent readonly assignments, then actual configured checks and human review.",
        assignments,
        {
          uuid: randomUUID,
          sha256: (b) => createHash("sha256").update(b).digest("hex"),
        },
      );
      await settled(await submit(proposal));
      const saved = await current(taskId);
      expect(saved.savedGraph.status).toBe("saved");
      if (saved.savedGraph.status !== "saved") throw Error("graph missing");
      let request = saved.savedGraph.request;
      for (let n = 0; ; n++) {
        if (n >= 100) throw Error("bounded graph continuation exceeded");
        const value = ok(await c.graph(request));
        if (!("kind" in value)) {
          expect(value.graph).toEqual(proposal.graph);
          break;
        }
        request = value.next;
        await new Promise((r) => setTimeout(r, 0));
      }
      const generated = await settled(
        await submit({ kind: "generate-plan", taskId }),
        true,
      );
      expect(generated.execution).toBe("completed");
      expect((await current(taskId)).readablePlan?.text).toBe(proposal.plan);
      f.mode("parallel");
      const start = await submit({ kind: "start", taskId });
      const done = await settled(start, true);
      expect(done.execution).toBe("completed");
      expect(f.maxActive()).toBeGreaterThanOrEqual(2);
      expect(
        f.observations.every(
          (o) => !o.tools.some((t) => ["write", "edit", "bash"].includes(t)),
        ),
      ).toBe(true);
      const obligations = ok(await c.checkObligations(taskId));
      await settled(
        await submit({
          kind: "check",
          taskId,
          check: obligations.definitions[0].selection,
        }),
        true,
      );
      const checked = ok(await c.checkObligations(taskId));
      expect(checked.definitions[0].status).toBe("passed");
      const changes = ok(
        await c.currentChanges({ storeId: session.storeId, taskId }),
      );
      expect(changes.text.length).toBeGreaterThan(0);
      const reviewed = await settled(
        await submit({
          kind: "review",
          taskId,
          runId: start.runId!,
          changesIdentity: changes.observation.identity,
          checksRevision: checked.revision,
          acceptIssues: true,
        }),
      );
      expect(reviewed.publication).toBe("published");
      expect(
        ok(await c.snapshot({ kind: "task", id: taskId })).runs.find(
          (r) => r.runId === start.runId && !r.childRunId,
        )?.outcome,
      ).toBe("completed");
      for (const format of ["ndjson", "markdown"] as const) {
        let text = "",
          trailer = false;
        for await (const frame of c.export(
          {
            storeId: session.storeId,
            scope: { kind: "task", id: taskId },
            snapshotSeq: (await current(taskId)).committedSeq,
            format,
          },
          new AbortController().signal,
        )) {
          text += JSON.stringify(frame);
          trailer ||= frame.event.kind === "trailer";
        }
        expect(trailer).toBe(true);
        expect(text).toContain("END-RETAINED");
        expect(text).toContain("ACTUAL-PARENT-CHECK");
      }
      f.mode("pending");
      const pending = await submit({ kind: "start", taskId });
      const active = ok(await c.activeRuns());
      expect(
        active.status === "complete" &&
          active.runs.some((r) => r.runId === pending.runId),
      ).toBe(true);
      const canceled = ok(
        await c.cancel({
          commandId: randomUUID(),
          epoch: session.epoch,
          runId: pending.runId!,
        }),
      );
      expect(canceled.admission).toBe("accepted");
      expect((await settled(pending, true)).execution).toBe("canceled");
      const incompatible = new HttpServiceTransport({
        origin: f.endpoint,
        localCapability: f.c.localAccess().capability,
        build: { ...nativeBuild, contractHash: "0".repeat(64) },
      });
      const bad = new ServiceClient(incompatible);
      ok(await bad.session());
      const latest = await current(null);
      if (latest.context.status !== "available") throw Error("context");
      expect(
        await bad.preflight(latest.context.version, {
          kind: "create",
          goal: "must refuse",
          taskKind: "code",
        }),
      ).toMatchObject({ kind: "error", error: { effect: "none" } });
      await incompatible.detach();
    } catch (error) {
      console.error("original accepting assertion", error);
      throw error;
    } finally {
      try {
        await f.close();
      } finally {
        writeFileSync(
          join(f.dir, "read-failure-stacks.json"),
          JSON.stringify(readFailures, null, 2),
        );
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
      }
    }
  }, 120000);
