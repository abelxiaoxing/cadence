/** Actual compiled owner → readonly panel feed → Pi bus. Only the numeric-loopback provider is fabricated. */
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { registerCadenceAgentFeed } from "../src/agent-panel-cadence.ts";
import {
  SUBAGENT_EVENTS as E,
  SUBAGENT_VIEW,
} from "../src/agent-panel-model.ts";
import { proposePlan } from "../src/plan-proposal.ts";
import type { Action, Receipt, Reply } from "../src/service-contract.ts";
import { confirm, prepare } from "../web/src/client/actions.ts";
import { acceptingFixture } from "./helpers/accepting-fixture.ts";

function ok<T>(reply: Reply<T>): T {
  if (reply.kind === "error") throw Error(JSON.stringify(reply.error));
  return reply.value;
}
afterEach(() => {
  vi.unstubAllEnvs();
});

it("an actual owner's children reach the bus: running, viewed, explicitly canceled, then completed", async () => {
  const f = await acceptingFixture("generated");
  vi.stubEnv("XDG_STATE_HOME", join(f.dir, "state"));
  if (process.platform === "win32")
    vi.stubEnv("LOCALAPPDATA", join(f.dir, "state"));
  const sent: [string, any][] = [];
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const lifecycle = new Map<string, ((...args: any[]) => unknown)[]>();
  const pi = {
    events: {
      on(channel: string, fn: (data: unknown) => void) {
        listeners.set(channel, (listeners.get(channel) ?? new Set()).add(fn));
        return () => listeners.get(channel)?.delete(fn);
      },
      emit(channel: string, data: unknown) {
        sent.push([channel, data]);
        for (const fn of listeners.get(channel) ?? []) fn(data);
      },
    },
    on(name: string, fn: (...args: any[]) => unknown) {
      lifecycle.set(name, [...(lifecycle.get(name) ?? []), fn]);
    },
  };
  registerCadenceAgentFeed(pi as never, {
    timing: { firstMs: 0, activeMs: 50, idleMs: 50, retryMs: 200 },
  });
  const ctx = { cwd: f.root, mode: "tui", hasUI: true };
  const fire = async (name: string) => {
    for (const fn of lifecycle.get(name) ?? []) await fn({}, ctx);
  };
  const of = (channel: string) =>
    sent.filter(([c]) => c === channel).map(([, data]) => data);
  try {
    const c = f.client;
    const session = ok(await c.session());
    const catalog = ok(await c.models());
    ok(
      await c.chooseModel({
        expected: catalog.version,
        choice: {
          provider: "fixture",
          model: "fixed",
          api: "openai-completions",
          thinking: "off",
        },
      }),
    );
    const current = async (taskId: string | null) =>
      ok(await c.current({ storeId: session.storeId, taskId }));
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

    await fire("session_start");
    const created = await settled(
      await submit({
        kind: "create",
        taskKind: "research",
        goal: "Panel observation of two readonly children",
      }),
    );
    const taskId = created.created!.taskId;
    const view = await current(taskId);
    const proposal = await proposePlan(
      view,
      "Two independent readonly assignments.",
      ["first", "second"].map((id) => ({
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
      })),
      {
        uuid: randomUUID,
        sha256: (b) => createHash("sha256").update(b).digest("hex"),
      },
    );
    await settled(await submit(proposal));
    // Saving and the task itself announce nothing: only child runs are agents.
    expect(sent).toEqual([]);

    // A normal run is followed to done, with the model's retained answer.
    f.mode("parallel");
    const done = await settled(await submit({ kind: "start", taskId }), true);
    expect(done.execution).toBe("completed");
    await expect
      .poll(() => of(E.end).map((d) => d.status), { timeout: 15000 })
      .toEqual(["done", "done"]);
    expect(of(E.start).map((d) => [d.label, d.kind])).toEqual([
      ["first", "Research"],
      ["second", "Research"],
    ]);
    const second = of(E.start).find((d) => d.label === "second").id;
    pi.events.emit(SUBAGENT_VIEW, { id: second });
    await expect
      .poll(
        () =>
          of(E.message).find(
            (d) => d.id === second && d.message.role === "assistant",
          )?.message.content[0].text,
        { timeout: 15000 },
      )
      .toContain("END-RETAINED");
    expect(of(E.message).filter((d) => d.id === second)[0].message.role).toBe(
      "user",
    );

    // The provider holds both replies (last: held replies are never released):
    // two running children, until the human's explicit Cancel stops them.
    f.mode("pending");
    pi.events.emit(SUBAGENT_VIEW, { id: null });
    sent.length = 0;
    const pending = await submit({ kind: "start", taskId });
    await expect
      .poll(() => of(E.start).map((d) => [d.label, d.kind]), {
        timeout: 15000,
      })
      .toEqual([
        ["first", "Research"],
        ["second", "Research"],
      ]);
    const ids = [...of(E.start).map((d) => d.id)];
    expect(of(E.start).every((d) => typeof d.startedAt === "number")).toBe(
      true,
    );
    await expect
      .poll(
        () =>
          ids.map(
            (id) => of(E.activity).findLast((d) => d.id === id)?.activity,
          ),
        { timeout: 15000 },
      )
      .toEqual(["first · Working", "second · Working"]);
    pi.events.emit(SUBAGENT_VIEW, { id: ids[0] });
    await expect
      .poll(
        () =>
          of(E.message)
            .filter((d) => d.id === ids[0])
            .map((d) => d.message.role),
        { timeout: 15000 },
      )
      .toEqual(["user"]);
    // The prompt the child actually received, from its final message blocks.
    expect(
      of(E.message).find((d) => d.id === ids[0]).message.content[0].text,
    ).toContain("first");
    expect(of(E.end)).toEqual([]);
    ok(
      await c.cancel({
        commandId: randomUUID(),
        epoch: session.epoch,
        runId: pending.runId!,
      }),
    );
    expect((await settled(pending, true)).execution).toBe("canceled");
    await expect
      .poll(() => of(E.end).map((d) => [d.id, d.status]), { timeout: 15000 })
      .toEqual(ids.map((id) => [id, "cancelled"]));
  } catch (error) {
    console.error("original panel-owner assertion", error);
    throw error;
  } finally {
    try {
      await fire("session_shutdown");
    } finally {
      await f.close();
    }
  }
}, 60_000);
