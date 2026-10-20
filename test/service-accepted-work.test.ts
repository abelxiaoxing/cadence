/** Real owner/disk/SDK with fabricated loopback provider. Timing gates are injected. */
import type { SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { readRunState } from "../src/history/run-state.ts";
import type { OwnerStopReport } from "../src/service/owner.ts";
import { TaskActions } from "../src/service/task-actions.ts";
import type { Action } from "../src/service-contract.ts";
import { createServiceHost } from "./helpers/source-host.ts";

const natives = vi.hoisted(
  () => [] as { closed: boolean; code: number | null; signal: string | null }[],
);
vi.mock("node:child_process", async (original) => {
  const actual = await original<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: string[], options: SpawnOptions) => {
      const sdk = args.some((a) => a.endsWith("sdk-worker.mjs"));
      const child = actual.spawn(
        command,
        sdk
          ? [
              "--import",
              new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url)
                .href,
              ...args,
            ]
          : args,
        options,
      );
      if (sdk) {
        const observed = {
          closed: false,
          code: null as number | null,
          signal: null as string | null,
        };
        natives.push(observed);
        child.on("close", (code, signal) => {
          observed.closed = true;
          observed.code = code;
          observed.signal = signal;
        });
      }
      return child;
    },
  };
});
function gate<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
const disposals: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposals.splice(0)) await dispose();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
async function fixture() {
  natives.length = 0;
  const dir = mkdtempSync(join(tmpdir(), "accepted-work-"));
  const root = join(dir, "project"),
    home = join(dir, "home"),
    agentDir = join(home, "agent");
  for (const path of [root, agentDir])
    mkdirSync(path, { recursive: true, mode: 0o700 });
  const responses: ServerResponse[] = [];
  const contacted = gate();
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* genuine SDK request, no stored auth/body */
    }
    responses.push(res);
    contacted.resolve();
  });
  await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture address");
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "fabricated-accepted-key" },
    }),
    { mode: 0o600 },
  );
  writeFileSync(
    join(agentDir, "models.json"),
    JSON.stringify({
      providers: {
        fixture: {
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          api: "openai-completions",
          models: [{ id: "fixed", reasoning: false }],
        },
      },
    }),
    { mode: 0o600 },
  );
  const allowed = new Set([
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "WINDIR",
    "COMSPEC",
    "TMP",
    "TEMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "PATHEXT",
    "NODE_ENV",
    "VITEST",
    "VITEST_POOL_ID",
    "VITEST_WORKER_ID",
  ]);
  for (const key of Object.keys(process.env))
    if (!allowed.has(key)) vi.stubEnv(key, undefined);
  vi.stubEnv("HOME", home);
  vi.stubEnv("USERPROFILE", home);
  const h = await createServiceHost({
    workspace: root,
    stateHome: join(dir, "state"),
    environmentToken: null,
    config: {
      schema: "cadence-service-host/1",
      cwd: root,
      agentDir,
      tokenSource: "generated",
      tokenFile: null,
      http: {
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: 0,
        proxy: null,
      },
    },
  });
  const selection = h.models.select({
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
  });
  const actions = new TaskActions({
    host: h,
    cwd: root,
    selection,
    ownerSecrets: [],
    workerTimeoutMs: 15000,
  });
  const caller = {
    attachmentId: randomUUID(),
    authority: "local" as const,
    accessGeneration: h.access.generation,
  };
  let first: OwnerStopReport | undefined;
  const stop = async (wait = 5000) => {
    const result = await h.owner.stop(wait);
    first ??= result;
    return result;
  };
  disposals.push(async () => {
    await stop();
    await actions.settledAll();
    await h.writer.settled();
    await h.owner.settled();
    h.live.close();
    await h.http.close();
    server.closeAllConnections();
    await new Promise<void>((yes) => server.close(() => yes()));
    expect(h.http.server.listening).toBe(false);
    expect(server.listening).toBe(false);
    expect(natives.every((n) => n.closed)).toBe(true);
    writeFileSync(
      join(dir, "lifetime-receipt.json"),
      JSON.stringify({
        first,
        finalState: h.owner.state,
        pendingWrites: h.writer.pendingWrites,
        acceptedPending: h.owner.acceptedPending,
        scheduler: actions.scheduler.accounting,
        native: natives,
        listening: false,
        locksRetained: existsSync(h.coordination.store.lockPath),
        fabricatedProvider: true,
        injectedTiming: true,
        productionAdmission: null,
      }) + "\n",
      { mode: 0o600 },
    );
  });
  const command = async (action: Action) => {
    const preview = await actions.observe(action);
    const preflight = await actions.admission.preflight(
      { action, expected: preview.version },
      caller,
    );
    if (preflight.kind !== "ok") throw Error(JSON.stringify(preflight));
    return {
      action,
      expected: preview.version,
      commandId: randomUUID(),
      grant: preflight.value.grant,
    };
  };
  const submit = async (action: Action) => {
    const reply = await actions.admission.submit(await command(action), caller);
    if (reply.kind !== "ok") throw Error(JSON.stringify(reply));
    return reply.value;
  };
  const create = async () => {
    const receipt = await submit({
      kind: "create",
      taskKind: "research",
      goal: "isolated accepted-work control",
    });
    await actions.settledAll();
    if (!receipt.created) throw Error("created identity");
    return receipt.created.taskId;
  };
  const reply = () => {
    for (const res of responses) {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      for (const [delta, finish_reason] of [
        [{ role: "assistant", content: "actual native output" }, null],
        [{}, "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    }
  };
  return {
    h,
    actions,
    caller,
    command,
    submit,
    create,
    stop,
    contacted,
    responses,
    reply,
  };
}

it("immutable action owner refuses idle replacement and queued/held review barriers stay busy", async () => {
  const f = await fixture();
  const before = f.h.choice.snapshot();
  const selections = f.h.models.observe();
  const install = () =>
    f.h.choice.choose({
      expected: before.version,
      choice: {
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      },
    });
  expect(() => f.h.owner.assertQuiescent()).toThrow("unavailable");
  expect(install).toThrow("unavailable");
  const first = await f.actions.scheduler.reviewBarrier(randomUUID());
  const queued = f.actions.scheduler.reviewBarrier(randomUUID());
  expect(() => f.actions.scheduler.assertQuiescent()).toThrow("conflict");
  expect(install).toThrow("conflict");
  first.release();
  const second = await queued;
  expect(() => f.actions.scheduler.assertQuiescent()).toThrow("conflict");
  expect(install).toThrow("conflict");
  second.release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  expect(() => f.actions.scheduler.assertQuiescent()).not.toThrow();
  expect(install).toThrow("unavailable");
  expect(f.h.choice.snapshot()).toEqual(before);
  expect(f.h.models.observe()).toEqual(selections);
  expect(natives).toHaveLength(0);
}, 20000);

it.each(["commit-gap", "metadata-microtask"] as const)(
  "Stop at %s retains accepted metadata, revokes grants and never publishes late",
  async (window) => {
    const f = await fixture();
    const command = await f.command({
      kind: "create",
      taskKind: "research",
      goal: "must remain unapplied",
    });
    let stopping: Promise<OwnerStopReport> | undefined;
    const publish = vi.spyOn(f.h.writer, "publishTask");
    if (window === "commit-gap") {
      const commit = f.h.writer.commit.bind(f.h.writer);
      vi.spyOn(f.h.writer, "commit").mockImplementation(async (intent) => {
        const result = await commit(intent);
        expect(f.h.owner.acceptedPending).toBe(1);
        stopping = f.stop();
        return result;
      });
    } else {
      const activate = f.actions.activate.bind(f.actions);
      vi.spyOn(f.actions, "activate").mockImplementation((intent, receipt) => {
        activate(intent, receipt);
        expect(f.h.owner.acceptedPending).toBe(1);
        stopping = f.stop();
      });
    }
    await f.actions.admission.submit(command, f.caller);
    expect(await stopping).toMatchObject({
      state: "quarantined",
      pending: { work: 0 },
    });
    expect(publish).not.toHaveBeenCalled();
    expect(f.h.coordination.store.list()).toHaveLength(0);
    expect(await f.h.writer.lookup(command.commandId)).toMatchObject({
      status: "found",
      record: { receipt: { admission: "accepted", publication: "uncertain" } },
    });
    expect(existsSync(f.h.coordination.store.lockPath)).toBe(true);
    expect((await f.h.projection.session()).capabilities.actions).toBe(false);
  },
  20000,
);

it("Stop before accepted episode allocation does not invent a run admission or launch", async () => {
  const f = await fixture(),
    taskId = await f.create();
  const allocate = vi.spyOn(f.h.writer, "admitRun");
  const prepare = vi.spyOn(f.h.models, "prepareTracked");
  const activate = f.actions.activate.bind(f.actions);
  let stopping: Promise<OwnerStopReport> | undefined;
  vi.spyOn(f.actions, "activate").mockImplementation((intent, receipt) => {
    activate(intent, receipt);
    stopping = f.stop();
  });
  const receipt = await f.submit({ kind: "start", taskId });
  expect((await stopping)?.state).toBe("quarantined");
  expect(allocate).not.toHaveBeenCalled();
  expect(prepare).not.toHaveBeenCalled();
  const state = readRunState(f.h.reader.files, receipt.runId!);
  expect(state.admission).toBeNull();
  expect(state.publication).toBe("uncertain");
  expect(f.actions.run(receipt.runId!)?.state).toBe("unknown");
  expect(state.settlement).toBeNull();
  expect(natives).toHaveLength(0);
  expect(f.actions.scheduler.accounting.episodes).toBe(1);
}, 20000);

it("Stop retains the original preparing continuation and prevents late native launch", async () => {
  const f = await fixture(),
    taskId = await f.create();
  const entered = gate(),
    release = gate();
  const prepare = f.h.models.prepareTracked.bind(f.h.models);
  vi.spyOn(f.h.models, "prepareTracked").mockImplementation((input) => {
    const handle = prepare(input);
    return {
      settled: handle.settled,
      result: handle.result.then(async (result) => {
        entered.resolve();
        await release.promise;
        return result;
      }),
    };
  });
  try {
    await f.submit({ kind: "start", taskId });
    await entered.promise;
    const report = await f.stop(10);
    expect(report).toMatchObject({
      state: "quarantined",
      pending: { work: 1 },
    });
    expect(natives).toHaveLength(0);
  } finally {
    release.resolve();
  }
  await f.actions.settledAll();
  expect(natives).toHaveLength(0);
  expect(f.h.owner.state).toBe("quarantined");
}, 20000);

it.each([false, true])(
  "Stop during native activity joins original close and never signals after ownership loss: %s",
  async (lost) => {
    const f = await fixture(),
      taskId = await f.create();
    const receipt = await f.submit({ kind: "start", taskId });
    await f.contacted.promise;
    if (lost) {
      const lock = f.h.coordination.store.lockPath;
      writeFileSync(lock, `${readFileSync(lock, "utf8")} `);
    }
    const stopping = f.stop();
    if (lost) f.reply(); // native success is independent of lost publication/ownership
    expect((await stopping).state).toBe("quarantined");
    await f.actions.settledAll();
    expect(natives).toHaveLength(1);
    expect(natives[0].closed).toBe(true);
    expect(natives[0].signal).toBe(lost ? null : "SIGTERM");
    if (lost) expect(natives[0].code).toBe(0);
    else {
      const state = readRunState(f.h.reader.files, receipt.runId!);
      expect([...state.children.values()][0].completion?.native).toMatchObject({
        outcome: "canceled",
        closure: "direct-child-closed",
      });
      expect(state.publication).toBe("uncertain");
    }
    expect(existsSync(f.h.coordination.store.lockPath)).toBe(true);
  },
  20000,
);

it.each(["publication-intent", "settlement"] as const)(
  "Stop joins post-native/metadata original writer at %s: admitted publication drains, no new work or replay",
  async (kind) => {
    const f = await fixture();
    const taskId = kind === "settlement" ? await f.create() : null;
    const entered = gate(),
      release = gate();
    const append = f.h.writer.files.append.bind(f.h.writer.files);
    let once = true;
    vi.spyOn(f.h.writer.files, "append").mockImplementation(
      (lease, scan, rows, observer, nav, charge) =>
        append(
          lease,
          scan,
          rows,
          async (at) => {
            await observer?.(at);
            if (
              once &&
              at === "commit" &&
              rows.some((r) =>
                kind === "settlement"
                  ? r.value.kind === "settlement"
                  : r.value.kind === "owner" &&
                    r.value.events.some(
                      (e) =>
                        e.kind === "owner" &&
                        e.value.kind === "fact" &&
                        e.value.fact.kind === "publication-intent",
                    ),
              )
            ) {
              once = false;
              entered.resolve();
              await release.promise;
            }
          },
          nav,
          charge,
        ),
    );
    try {
      if (taskId) {
        await f.submit({ kind: "start", taskId });
        await f.contacted.promise;
        f.reply();
      } else
        await f.submit({
          kind: "create",
          taskKind: "research",
          goal: "unapplied candidate",
        });
      await entered.promise;
      const report = await f.stop(10);
      expect(report.pending.work).toBe(1);
      expect(report.pending.storage).toBeGreaterThan(0);
      if (taskId) expect(natives[0]).toMatchObject({ closed: true, code: 0 });
      else expect(f.h.coordination.store.list()).toHaveLength(0);
    } finally {
      release.resolve();
    }
    await f.actions.settledAll();
    await f.h.writer.settled();
    await f.h.owner.settled();
    expect(f.h.owner.acceptedPending).toBe(0);
    expect(f.h.owner.state).toBe("quarantined");
    if (!taskId) {
      // D4 permits this exact pre-Stop publication continuation, not new work.
      const records = f.h.coordination.store.list();
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({
        goal: "unapplied candidate",
        revision: 1,
      });
      expect(natives).toHaveLength(0);
      await expect(
        f.submit({
          kind: "create",
          taskKind: "research",
          goal: "post-Stop forbidden",
        }),
      ).rejects.toThrow();
      expect(f.h.coordination.store.list()).toHaveLength(1);
    }
    expect(existsSync(f.h.coordination.store.lockPath)).toBe(true);
  },
  20000,
);

it("late original admission after its reporting timeout records nonapplication, not a permanently pending publication", async () => {
  const f = await fixture();
  const command = await f.command({
    kind: "create",
    taskKind: "research",
    goal: "late accepted metadata must remain unapplied",
  });
  const entered = gate(),
    release = gate();
  const append = f.h.writer.files.append.bind(f.h.writer.files);
  vi.spyOn(f.h.writer.files, "append").mockImplementation(
    (lease, scan, rows, observer, nav, charge) =>
      append(
        lease,
        scan,
        rows,
        async (at) => {
          await observer?.(at);
          if (
            at === "commit" &&
            rows.some((r) => r.value.kind === "admission")
          ) {
            entered.resolve();
            await release.promise;
          }
        },
        nav,
        charge,
      ),
  );
  const submitting = f.actions.admission.submit(command, f.caller);
  try {
    await entered.promise;
    // Actual unchanged five-second writer report, not an injected faster deadline.
    expect(await submitting).toMatchObject({ kind: "error" });
    const report = await f.stop(10);
    expect(report.state).toBe("quarantined");
    expect(report.pending.storage).toBeGreaterThan(0);
    expect(f.h.coordination.store.list()).toHaveLength(0);
  } finally {
    release.resolve();
  }
  await f.actions.settledAll();
  await f.h.writer.settled();
  await f.h.owner.settled();
  expect(await f.h.writer.lookup(command.commandId)).toMatchObject({
    status: "found",
    record: {
      receipt: {
        admission: "accepted",
        publication: "uncertain",
        execution: null,
        settlement: null,
      },
    },
  });
  expect(f.h.coordination.store.list()).toHaveLength(0);
  expect(natives).toHaveLength(0);
  expect(f.h.owner.state).toBe("quarantined");
  expect(existsSync(f.h.coordination.store.lockPath)).toBe(true);
}, 20000);

it("Stop closes queued work and requests BOTH real native stops before joining either original", async () => {
  const f = await fixture(),
    taskId = await f.create();
  const preview = await f.actions.observe({ kind: "start", taskId });
  if (!preview.graph) throw Error("actual prospective graph");
  const { proposePlanContent } = await import("../src/history/plans.ts");
  const graph = structuredClone(preview.graph);
  const plan = "Three independent readonly investigations.";
  graph.taskRevision++;
  graph.plan = proposePlanContent(plan, 1, []);
  graph.assignments = Array.from({ length: 3 }, (_, i) => ({
    ...graph.assignments[0],
    id: `read-${i}`,
  }));
  await f.submit({ kind: "save-plan", taskId, plan, graph });
  await f.actions.settledAll();
  const receipt = await f.submit({ kind: "start", taskId });
  await vi.waitFor(() => expect(f.responses).toHaveLength(2), {
    timeout: 5000,
  });
  const stopping = f.stop();
  expect(f.actions.run(receipt.runId!)?.cancelRequested).toBe(true);
  expect((await stopping).state).toBe("quarantined");
  expect(f.responses).toHaveLength(2);
  expect(natives).toHaveLength(2);
  expect(natives.every((n) => n.closed && n.signal === "SIGTERM")).toBe(true);
  const state = readRunState(f.h.reader.files, receipt.runId!);
  expect(state.children.size).toBe(2);
  expect(state.settlement).toMatchObject({ outcome: "canceled" });
  expect(
    [...state.assignments.values()].filter((a) => a.state === "unstarted"),
  ).toHaveLength(1);
  expect(state.publication).toBe("uncertain");
}, 20000);
