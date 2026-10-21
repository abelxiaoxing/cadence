import { expect, it, vi } from "vitest";
import { readRunState } from "../src/history/run-state.ts";
import type { Action, Receipt, Reply } from "../src/service-contract.ts";
import { confirm, prepare } from "../web/src/client/actions.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";
import { keepOnlyEnvironment } from "./helpers/windows-environment.ts";

function ok<T>(reply: Reply<T>): T {
  if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
  return reply.value;
}
for (const kind of ["start", "check"] as const)
  it(`Stop joins original ${kind} final publication without recording cancellation after terminal settlement`, async () => {
    const f = await acceptingFixture("source", (env) => {
      // Case-insensitive on Windows: never stub one variable under two spellings.
      keepOnlyEnvironment(Object.keys(env));
      for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    });
    const host = f.host!;
    let release = () => {};
    try {
      const client = f.client,
        session = ok(await client.session());
      ok(
        await client.chooseModel({
          expected: ok(await client.models()).version,
          choice: {
            provider: "fixture",
            model: "fixed",
            api: "openai-completions",
            thinking: "off",
          },
        }),
      );
      const submit = async (action: Action) => {
        const view = ok(
          await client.current({
            storeId: session.storeId,
            taskId: action.kind === "create" ? null : action.taskId,
          }),
        );
        if (view.context.status !== "available") throw Error("fixture current");
        return ok(
          await confirm(
            client,
            ok(await prepare(client, view.context.version, action)),
          ),
        );
      };
      const created = await submit({
        kind: "create",
        taskKind: kind === "start" ? "research" : "code",
        goal: "Original final publication Stop boundary",
      });
      await host.actions!.settledAll();
      if (!created.created) throw Error("fixture create");
      const taskId = created.created.taskId;
      let observed!: () => void;
      const reached = new Promise<void>((resolve) => {
        observed = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const publish = host.writer.publishTask.bind(host.writer);
      let calls = 0;
      vi.spyOn(host.writer, "publishTask").mockImplementation(
        async (...args) => {
          const result = await publish(...args);
          if (++calls === 2) {
            observed();
            await hold;
          } // original final write is committed; control-flow is still draining
          return result;
        },
      );
      const receipt: Receipt = await submit(
        kind === "start"
          ? { kind, taskId }
          : {
              kind,
              taskId,
              check: ok(await client.checkObligations(taskId)).definitions[0]
                .selection,
            },
      );
      await reached;
      expect(receipt.runId).not.toBeNull();
      const before = readRunState(host.reader.files, receipt.runId!);
      expect(before.settlement?.kind).toBe(
        kind === "start" ? "parent" : "check",
      );
      expect(before.publication).toBe("published");
      await f.transport.detach();
      const stopping = host.owner.stop();
      release();
      expect(await stopping).toMatchObject({
        state: "stopped",
        settlement: "known",
        pending: { process: 0, auth: 0, storage: 0, work: 0 },
      });
      expect(host.writer.quarantined).toBe(false);
      const after = readRunState(host.reader.files, receipt.runId!);
      expect(after.settlement).toEqual(before.settlement);
      expect(after.admissionClosed).toBeNull();
      expect(after.publication).toBe("published");
    } finally {
      release();
      try {
        await f.close();
      } finally {
        if (host.owner.state !== "stopped") await host.http.close(); // exact owned source fixture only; fences stay
        vi.restoreAllMocks();
        vi.unstubAllEnvs();
      }
    }
  }, 30000);
