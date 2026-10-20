import { execFileSync, type SpawnOptions } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, expect, it as nativeIt, vi } from "vitest";
import { schedulerIo } from "./helpers/scheduler-io-diagnostics.ts";

const it = schedulerIo.tests(nativeIt);
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  const { schedulerIo } = await import("./helpers/scheduler-io-diagnostics.ts");
  const measured = schedulerIo.fs(actual);
  return { ...measured, default: measured };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  const { schedulerIo } = await import("./helpers/scheduler-io-diagnostics.ts");
  const measured = schedulerIo.promises(actual);
  return { ...measured, default: measured };
});

const nativeIntervals = vi.hoisted(
  () => [] as { start: number; end: number | null; exit: number | null }[],
);
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const { schedulerIo } = await import("./helpers/scheduler-io-diagnostics.ts");
  return {
    ...actual,
    spawn: vi.fn(
      (
        command: string,
        args: readonly string[] = [],
        options?: SpawnOptions,
      ) => {
        const sdk = args?.some((a) => String(a).endsWith("sdk-worker.mjs"));
        const child = actual.spawn(
          command,
          sdk
            ? [
                "--import",
                new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url)
                  .href,
                ...args!,
              ]
            : args,
          options ?? {},
        );
        if (sdk) {
          schedulerIo.native(child);
          const interval = {
            start: performance.now(),
            end: null as number | null,
            exit: null as number | null,
          };
          nativeIntervals.push(interval);
          child.on("close", (code) => {
            interval.end = performance.now();
            interval.exit = code;
          });
        }
        return child;
      },
    ),
  };
});

import { loadAgentDefinitions } from "../src/agent-registry.ts";
import { HistoryReadBudget } from "../src/history/files.ts";
import { graphPreparation } from "../src/history/graph-progress.ts";
import { proposePlanContent } from "../src/history/plans.ts";
import { HistoryReadProof } from "../src/history/read-proof.ts";
import { readRunState } from "../src/history/run-state.ts";
import type { ServiceHost } from "../src/service/host.ts";
import { recordOwner } from "../src/service/scheduler.ts";
import { TaskActions } from "../src/service/task-actions.ts";
import { ServiceClient } from "../src/service-client.ts";
import type {
  Action,
  Graph,
  ModelSelection,
  Receipt,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { SchedulerDiagnostics } from "./helpers/scheduler-diagnostics.ts";
import { createServiceHost } from "./helpers/source-host.ts";

const diagnostics: {
  d: SchedulerDiagnostics;
  h?: ServiceHost;
  actions?: TaskActions;
}[] = [];
const hosts: ServiceHost[] = [];
const cores = new Map<ServiceHost, TaskActions>();
const disposed = new WeakSet<ServiceHost>();
async function disposeHost(h: ServiceHost): Promise<void> {
  if (disposed.has(h)) return;
  const original = h.owner.stop(5000);
  schedulerIo.original("owner-stop", original);
  const report = await original;
  schedulerIo.snapshot("owner-stop:report", report);
  await cores.get(h)?.settledAll();
  await h.writer.settled();
  await h.owner.settled();
  // Quarantine deliberately keeps production diagnosis alive. The fixture owns
  // these exact transports; disposal is NOT recovery or lease-release evidence.
  h.live.close();
  await h.http.close();
  expect(h.http.server.listening).toBe(false);
  disposed.add(h);
  cores.delete(h);
}
const retainedDiagnostics: typeof diagnostics = [];
afterEach(() =>
  schedulerIo.teardown(async () => {
    schedulerIo.snapshot("teardown:begin", {
      hosts: hosts.map((h) => ({
        state: h.owner.state,
        pendingWrites: h.writer.pendingWrites,
      })),
    });
    for (const { d } of diagnostics) d.mark("teardown:begin");
    try {
      for (const h of hosts.splice(0)) await disposeHost(h);
    } finally {
      for (const entry of diagnostics.splice(0)) {
        entry.d.finish(entry.h, entry.actions);
        if (schedulerIo.enabled && retainedDiagnostics.length < 64)
          retainedDiagnostics.push(entry);
      }
      vi.unstubAllEnvs();
      schedulerIo.teardownEnded();
    }
  }),
);
afterAll(() => {
  if (!schedulerIo.enabled) return;
  // One final bounded receipt, never a write inside an observed syscall/callback.
  try {
    const receipt = JSON.stringify({
      io: schedulerIo.finish(),
      lateOriginals: retainedDiagnostics.map(({ d, h, actions }) =>
        d.snapshot(h, actions),
      ),
    });
    if (Buffer.byteLength(receipt) > 4 * 1024 * 1024)
      throw Error("diagnostic bound");
    writeFileSync(join(tmpdir(), "scheduler-io.json"), `${receipt}\n`, {
      mode: 0o600,
    });
  } catch {
    console.error(
      "Scheduler IO receipt unavailable; original outcome unchanged.",
    );
  }
});
async function fixture(
  handler: (body: Record<string, unknown>, res: ServerResponse) => void,
  policyClock?: () => number,
  makeActions?: (h: ServiceHost, selection: ModelSelection) => TaskActions,
  diagnostic: SchedulerDiagnostics | undefined = schedulerIo.enabled
    ? new SchedulerDiagnostics()
    : undefined,
) {
  const dir = mkdtempSync(join(tmpdir(), "cadence-w4-native-"));
  const intervalStart = nativeIntervals.length;
  if (diagnostic) diagnostic.path = join(dir, "scheduler-timings.json");
  diagnostic?.mark("fixture:begin");
  const root = join(dir, "project"),
    home = join(dir, "home"),
    agentDir = join(home, "agent");
  for (const p of [root, agentDir])
    mkdirSync(p, { recursive: true, mode: 0o700 });
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    handler(JSON.parse(body), res);
  });
  await new Promise<void>((yes) => server.listen(0, "127.0.0.1", yes));
  schedulerIo.mark("provider:listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("fixture");
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "fabricated-w4-provider-key" },
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
    config: {
      schema: "cadence-service-host/1",
      cwd: root,
      agentDir,
      http: {
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: 0,
        proxy: null,
      },
      tokenSource: "generated",
      tokenFile: null,
    },
    environmentToken: null,
  });
  hosts.push(h);
  diagnostic?.mark("host:ready");
  const selection = h.models.select({
    provider: "fixture",
    model: "fixed",
    api: "openai-completions",
    thinking: "off",
  });
  const actions = makeActions
    ? makeActions(h, selection)
    : new TaskActions({
        host: h,
        cwd: root,
        selection,
        ownerSecrets: [],
        workerTimeoutMs: 15000,
        policyClock,
      });
  cores.set(h, actions);
  if (diagnostic) {
    diagnostic.attach(h, actions);
    diagnostics.push({ d: diagnostic, h, actions });
  }
  diagnostic?.mark("fixture:ready");
  const caller = {
    attachmentId: randomUUID(),
    authority: "local" as const,
    accessGeneration: h.access.generation,
  };
  const submit = async (action: Action): Promise<Receipt> => {
    diagnostic?.mark(`submit:${action.kind}:begin`);
    const preview = await actions.observe(action);
    if (action.kind === "save-plan") {
      expect(preview.readablePlan).toBe(action.plan);
      expect(preview.graph).toEqual(action.graph);
      expect(preview.version.task?.identity).toBe(
        h.coordination.store.loadSnapshot(action.taskId)?.identity,
      );
    }
    const p = await actions.admission.preflight(
      { action, expected: preview.version },
      caller,
    );
    expect(p.kind).toBe("ok");
    if (p.kind !== "ok") throw Error(JSON.stringify(p));
    const r = await actions.admission.submit(
      {
        commandId: randomUUID(),
        grant: p.value.grant,
        expected: preview.version,
        action,
      },
      caller,
    );
    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") throw Error(JSON.stringify(r));
    diagnostic?.mark(`submit:${action.kind}:end`);
    return r.value;
  };
  const create = async (taskKind: "research" | "code" = "research") => {
    const c = await submit({
      kind: "create",
      taskKind,
      goal: "Read-only isolated investigation",
    });
    await actions.settled(null);
    diagnostic?.mark("create:published");
    expect(h.owner.state).toBe("idle");
    return c.created!.taskId;
  };
  const save = async (
    taskId: string,
    count = 2,
    configure?: (graph: Graph) => void,
  ) => {
    const task = h.coordination.store.loadSnapshot(taskId)!;
    const role = loadAgentDefinitions().find(
      (r) => r.role === "design-explorer",
    )!;
    const plan = "Inspect independently, then report observations.";
    const graph: Graph = {
      schema: "cadence-graph/2",
      taskId,
      taskKind: task.record.kind,
      taskRevision: task.record.revision + 1,
      revision: 1,
      planRevision: 1,
      plan: proposePlanContent(plan, 1, []),
      assignments: Array.from({ length: count }, (_, i) => ({
        id: `inspect-${i}`,
        purpose: "research",
        instructions: `Investigate area ${i} without editing.`,
        expectedOutput: "Report observations.",
        role: { role: "design-explorer", sha256: role.sha256 },
        model: selection,
        dependencies: [],
      })),
    };
    configure?.(graph);
    await submit({ kind: "save-plan", taskId, plan, graph });
    await actions.settled(taskId);
    diagnostic?.mark("save:published");
    expect(h.owner.state).toBe("idle");
    return graph;
  };
  return {
    h,
    actions,
    caller,
    submit,
    create,
    save,
    close: async () => {
      await disposeHost(h);
      schedulerIo.mark("provider:close:begin");
      writeFileSync(
        join(dir, "sdk-receipt.json"),
        JSON.stringify(
          {
            schema: "cadence-w4-fixture-native/1",
            node: process.version,
            executable: process.execPath,
            platform: process.platform,
            arch: process.arch,
            fabricatedProvider: true,
            physicalHuman: false,
            paidProvider: false,
            hostActions: false,
            originals: nativeIntervals.slice(intervalStart),
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
      server.closeAllConnections();
      await new Promise<void>((yes) => server.close(() => yes()));
      schedulerIo.mark("provider:close:end");
    },
  };
}
function reply(res: ServerResponse, text: string) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    connection: "close",
  });
  const send = (delta: unknown, finish_reason: string | null = null) =>
    res.write(
      `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
    );
  send({ role: "assistant", content: text });
  send({}, "stop");
  res.end("data: [DONE]\n\n");
}
it("real Create/save-plan/Start overlaps two readonly SDK children through admission and durable native facts", async () => {
  nativeIntervals.length = 0;
  const pending: ServerResponse[] = [],
    bodies: Record<string, unknown>[] = [];
  const f = await fixture((body, res) => {
    bodies.push(body);
    pending.push(res);
    if (pending.length === 2)
      for (const r of pending) reply(r, "independent retained observation");
  });
  try {
    const taskId = await f.create(),
      graph = await f.save(taskId);
    const descriptor = f.actions.savedGraph(taskId)!;
    expect(descriptor.graph).toEqual(graph);
    const client = new ServiceClient(
      new HttpServiceTransport({
        origin: f.h.endpoint,
        localCapability: f.h.coordination.localAccess().capability,
        fetch,
      }),
    );
    expect((await client.session()).kind).toBe("ok");
    const graphRequest = {
      storeId: f.h.reader.storeId,
      scope: { kind: "task" as const, id: taskId },
      snapshotSeq: f.h.writer.committedSeq,
      graph: descriptor.reference,
    };
    const normal = await client.graph(graphRequest);
    expect(normal).toMatchObject({ kind: "ok", value: { graph } });
    // Real proof issuer; initial selection is explicit, not an elapsed-time claim.
    const initial = graphPreparation(
      graphRequest,
      new HistoryReadProof(f.h.reader.files).prepareCompletion(
        new HistoryReadBudget(),
      ),
    );
    if (!("kind" in initial)) throw Error("proof");
    let next = initial.next;
    for (let i = 0; i < 30; i++) {
      const page = await client.graph(next);
      expect(page.kind).toBe("ok");
      if (page.kind !== "ok") throw Error("graph");
      if (!("kind" in page.value)) {
        expect(page.value.graph).toEqual(graph);
        break;
      }
      next = page.value.next;
      if (i === 29) throw Error("proof did not finish");
    }
    for (const format of ["ndjson", "markdown"] as const) {
      let trailer = false,
        hasGraph = false;
      for await (const frame of client.export(
        {
          storeId: graphRequest.storeId,
          scope: graphRequest.scope,
          snapshotSeq: graphRequest.snapshotSeq,
          format,
        },
        new AbortController().signal,
      )) {
        trailer ||= frame.event.kind === "trailer";
        hasGraph ||=
          frame.event.kind === "graph" ||
          (frame.event.kind === "markdown" &&
            frame.event.text.includes("Frozen graph"));
      }
      expect(trailer).toBe(true);
      expect(hasGraph).toBe(true);
    }
    const start = await f.submit({ kind: "start", taskId });
    expect(f.actions.run(start.runId!)?.state).toBe("active");
    await f.actions.scheduler.settled(start.runId!);
    expect(f.h.owner.state).toBe("idle");
    expect(bodies).toHaveLength(2);
    expect(nativeIntervals).toHaveLength(2);
    expect(Math.max(...nativeIntervals.map((i) => i.start))).toBeLessThan(
      Math.min(...nativeIntervals.map((i) => i.end!)),
    );
    expect(nativeIntervals.every((i) => i.exit === 0 && i.end !== null)).toBe(
      true,
    );
    for (const body of bodies) {
      expect(body.model).toBe("fixed");
      const tools = body.tools as { function: { name: string } }[];
      expect(tools.map((t) => t.function.name)).not.toContain("bash");
      expect(tools.map((t) => t.function.name)).not.toContain("write");
      expect(tools.map((t) => t.function.name)).not.toContain("edit");
    }
    const state = readRunState(f.h.reader.files, start.runId!);
    expect(state.drained).toBe(true);
    expect(state.settlement).toMatchObject({ outcome: "completed" });
    expect(state.children.size).toBe(2);
    for (const child of state.children.values())
      expect(child.completion).toMatchObject({
        native: {
          outcome: "completed",
          closure: "direct-child-closed",
          exitCode: 0,
          stdin: "delivered",
          final: "valid",
          cleanup: "settled",
        },
        recording: { status: "committed" },
      });
    expect(f.h.coordination.store.load(taskId)?.phase).toBe("review");
    // The real production host remains mutation-closed, even with an owner core exercised here.
    expect((await f.h.projection.session()).capabilities.actions).toBe(false);
  } finally {
    await f.close();
  }
}, 20000);

it("a dependent receives exact durable predecessor text and cannot run before original native settlement", async () => {
  nativeIntervals.length = 0;
  const bodies: Record<string, unknown>[] = [];
  const text = "Exact predecessor λ UTF-8 observation";
  const f = await fixture((body, res) => {
    bodies.push(body);
    reply(res, bodies.length === 1 ? text : "dependent observation");
  });
  try {
    const taskId = await f.create();
    await f.save(taskId, 2, (graph) => {
      graph.assignments[1].dependencies = [
        {
          source: { kind: "current", assignmentId: graph.assignments[0].id },
          range: null,
          requireCompleteObservation: false,
        },
      ];
    });
    const start = await f.submit({ kind: "start", taskId });
    await f.actions.scheduler.settled(start.runId!);
    expect(f.h.owner.state).toBe("idle");
    expect(bodies).toHaveLength(2);
    expect(JSON.stringify(bodies[1])).toContain(text);
    expect(JSON.stringify(bodies[1]).split(text)).toHaveLength(2);
    expect(nativeIntervals[1].start).toBeGreaterThan(nativeIntervals[0].end!);
    expect(
      readRunState(f.h.reader.files, start.runId!).settlement,
    ).toMatchObject({ outcome: "completed" });
  } finally {
    await f.close();
  }
}, 20000);

it("explicit Cancel stops both original native children and never launches queued work", async () => {
  nativeIntervals.length = 0;
  let ready!: () => void;
  const contacted = new Promise<void>((yes) => {
    ready = yes;
  });
  let contacts = 0;
  const f = await fixture((_body, _res) => {
    if (++contacts === 2) ready();
  });
  try {
    const taskId = await f.create();
    await f.save(taskId, 3);
    const start = await f.submit({ kind: "start", taskId });
    await contacted;
    const canceled = await f.actions.admission.cancel(
      {
        commandId: randomUUID(),
        epoch: start.runId ? f.h.owner.lease.registration.epoch : "",
        runId: start.runId,
      },
      f.caller,
    );
    if (canceled.kind !== "ok") throw Error(JSON.stringify(canceled));
    await f.actions.scheduler.settled(start.runId!);
    expect(contacts).toBe(2);
    expect(nativeIntervals).toHaveLength(2);
    expect(nativeIntervals.every((i) => i.end !== null)).toBe(true);
    const state = readRunState(f.h.reader.files, start.runId!);
    expect(state.settlement).toMatchObject({ outcome: "canceled" });
    expect(
      state
        .projections(f.h.owner.lease.registration.epoch)
        .filter((r) => r.childRunId !== null && r.settlement === null),
    ).toMatchObject([{ reason: "parent-stopped", outcome: "blocked" }]);
    expect(state.drained).toBe(true);
  } finally {
    await f.close();
  }
}, 20000);

it("goal-only readonly Start retains a default plan only after accepted authority", async () => {
  let contacts = 0;
  const f = await fixture((_body, res) => {
    contacts++;
    reply(res, "goal-only observation");
  });
  try {
    const taskId = await f.create();
    const before = f.h.writer.committedSeq;
    const preview = await f.actions.observe({ kind: "start", taskId });
    expect(preview.graph?.assignments).toHaveLength(1);
    expect(f.h.writer.committedSeq).toBe(before);
    expect(contacts).toBe(0);
    const start = await f.submit({ kind: "start", taskId });
    await f.actions.scheduler.settled(start.runId!);
    expect(contacts).toBe(1);
    expect(f.h.owner.state).toBe("idle");
    expect(
      readRunState(f.h.reader.files, start.runId!).settlement,
    ).toMatchObject({ outcome: "completed" });
    expect(
      f.h.reader.admission(start.runId!, f.h.writer.committedSeq).graph,
    ).toEqual(preview.graph);
    // The save-plan-specific producer still refuses a Start operation.
    expect(
      (await f.h.writer.retainAcceptedPlan(start.operationId, [])).status,
    ).toBe("refused");
  } finally {
    await f.close();
  }
}, 20000);

it("first native failure closes only its parent admission while an independent native sibling drains", async () => {
  let ready!: () => void;
  const contacted = new Promise<void>((yes) => {
    ready = yes;
  });
  const responses: ServerResponse[] = [];
  const f = await fixture((_body, res) => {
    responses.push(res);
    if (responses.length === 2) ready();
  });
  try {
    const taskId = await f.create();
    await f.save(taskId, 3);
    const start = await f.submit({ kind: "start", taskId });
    await contacted;
    responses[0].writeHead(500, { "content-type": "application/json" });
    responses[0].end('{"error":{"message":"fabricated failure"}}');
    await vi.waitFor(
      () =>
        expect(
          readRunState(f.h.reader.files, start.runId!).admissionClosed?.reason,
        ).toBe("failed"),
      { timeout: 3000, interval: 20 },
    );
    expect(responses[1].writableEnded).toBe(false);
    reply(responses[1], "independent sibling retained success");
    await f.actions.scheduler.settled(start.runId!);
    const state = readRunState(f.h.reader.files, start.runId!);
    expect(responses).toHaveLength(2);
    expect(state.settlement).toMatchObject({ outcome: "failed" });
    expect(
      [...state.children.values()]
        .map((c) => c.completion?.native.outcome)
        .sort(),
    ).toEqual(["completed", "failed"]);
    expect(state.drained).toBe(true);
  } finally {
    await f.close();
  }
}, 20000);

it("checkout writer preference excludes native readers across tasks and stale queued work never relaunches", async () => {
  const diagnostic = new SchedulerDiagnostics();
  nativeIntervals.length = 0;
  let ready!: () => void;
  const contacted = new Promise<void>((yes) => {
    ready = yes;
  });
  let first: ServerResponse | undefined;
  const bodies: Record<string, unknown>[] = [];
  const f = await fixture(
    (body, res) => {
      diagnostic.mark("provider:request");
      bodies.push(body);
      if (bodies.length === 1) {
        first = res;
        ready();
      } else reply(res, "writer finished without a tool mutation");
    },
    undefined,
    undefined,
    diagnostic,
  );
  try {
    const a = await f.create("code"),
      b = await f.create();
    await f.save(a, 2, (g) => {
      const role = loadAgentDefinitions().find(
        (r) => r.role === "implementation-worker",
      )!;
      g.assignments[1].purpose = "edit";
      g.assignments[1].role = {
        role: "implementation-worker",
        sha256: role.sha256,
      };
    });
    await f.save(b, 1);
    const older = await f.submit({ kind: "start", taskId: a });
    await contacted;
    diagnostic.mark("first:contacted");
    await f.h.writer.settled();
    diagnostic.mark("first:writes-drained");
    const younger = await f.submit({ kind: "start", taskId: b });
    expect(bodies).toHaveLength(1);
    diagnostic.mark("first:reply");
    reply(first!, "older reader finished");
    await Promise.all([
      f.actions.scheduler.settled(older.runId!),
      f.actions.scheduler.settled(younger.runId!),
    ]);
    diagnostic.mark("parents:settled");
    expect(bodies).toHaveLength(2);
    expect(nativeIntervals[1].start).toBeGreaterThan(nativeIntervals[0].end!);
    expect(
      (bodies[0].tools as { function: { name: string } }[]).map(
        (t) => t.function.name,
      ),
    ).not.toContain("write");
    expect(
      (bodies[1].tools as { function: { name: string } }[]).map(
        (t) => t.function.name,
      ),
    ).toEqual(expect.arrayContaining(["write", "edit", "bash"]));
    expect(
      readRunState(f.h.reader.files, older.runId!).settlement,
    ).toMatchObject({ outcome: "completed" });
    const blocked = readRunState(f.h.reader.files, younger.runId!);
    expect(blocked.admissionClosed?.reason).toBe("stale-dependency");
    expect(blocked.settlement).toMatchObject({ outcome: "blocked" });
    expect(blocked.children.size).toBe(0);
  } finally {
    diagnostic.mark("case:finally");
    await f.close();
  }
}, 20000);

it.each(["start", "generate-plan"] as const)(
  "%s cancel during original preparation accounting retains its slot and cannot launch late (injected continuation barrier)",
  async (kind) => {
    let contacts = 0,
      entered!: () => void,
      release!: () => void;
    const reached = new Promise<void>((yes) => {
        entered = yes;
      }),
      held = new Promise<void>((yes) => {
        release = yes;
      });
    const f = await fixture((_body, res) => {
      contacts++;
      reply(res, "must not launch");
    });
    try {
      const taskId = await f.create(
        kind === "generate-plan" ? "code" : "research",
      );
      if (kind === "start") await f.save(taskId, 1);
      const original = f.h.writer.auth.preparation.bind(f.h.writer.auth);
      const spy = vi
        .spyOn(f.h.writer.auth, "preparation")
        .mockImplementation((input) =>
          original(input).then(async (result) => {
            entered();
            await held;
            return result;
          }),
        );
      const start = await f.submit({ kind, taskId });
      await reached;
      const cancel = await f.actions.admission.cancel(
        {
          commandId: randomUUID(),
          epoch: f.h.owner.lease.registration.epoch,
          runId: start.runId!,
        },
        f.caller,
      );
      expect(cancel.kind).toBe("ok");
      expect(contacts).toBe(0);
      expect(f.actions.scheduler.accounting.reservations).toBe(1);
      release();
      await f.actions.scheduler.settled(start.runId!);
      spy.mockRestore();
      expect(contacts).toBe(0);
      expect(f.actions.scheduler.accounting.reservations).toBe(0);
      const state = readRunState(f.h.reader.files, start.runId!);
      expect(state.children.size).toBe(0);
      expect(state.auth.size).toBe(1);
      expect(state.drained).toBe(true);
      expect(state.settlement).toMatchObject({ outcome: "canceled" });
    } finally {
      release();
      await f.close();
    }
  },
  20000,
);

it.each(["wait-expired", "timeout"] as const)(
  "injected policy clock %s preserves actual native outcomes and never revives queued work",
  async (reason) => {
    let now = 0,
      ready!: () => void;
    const contacted = new Promise<void>((yes) => {
        ready = yes;
      }),
      responses: ServerResponse[] = [];
    const f = await fixture(
      (_body, res) => {
        responses.push(res);
        if (responses.length === 2) ready();
      },
      () => now,
    );
    try {
      const taskId = await f.create();
      await f.save(taskId, 3);
      const start = await f.submit({ kind: "start", taskId });
      await contacted;
      now = reason === "timeout" ? 6 * 60 * 60 * 1000 + 1 : 10 * 60 * 1000 + 1;
      await vi.waitFor(
        () =>
          expect(
            readRunState(f.h.reader.files, start.runId!).admissionClosed
              ?.reason,
          ).toBe(reason),
        { timeout: 3000, interval: 20 },
      );
      if (reason === "wait-expired")
        for (const response of responses)
          reply(response, "active sibling drained after wait expiry");
      await f.actions.scheduler.settled(start.runId!);
      const state = readRunState(f.h.reader.files, start.runId!);
      expect(responses).toHaveLength(2);
      expect(state.drained).toBe(true);
      expect(state.settlement).toMatchObject({
        outcome: reason === "timeout" ? "timeout" : "blocked",
      });
      expect(
        [...state.children.values()].map((c) => c.completion?.native.outcome),
      ).toEqual(
        reason === "timeout"
          ? ["canceled", "canceled"]
          : ["completed", "completed"],
      );
      expect(f.actions.scheduler.accounting.reservations).toBe(0);
    } finally {
      await f.close();
    }
  },
  20000,
);

it("Cancel requests both native stops before an unrelated original journal write settles", async () => {
  nativeIntervals.length = 0;
  let ready!: () => void, entered!: () => void, release!: () => void;
  const contacted = new Promise<void>((yes) => {
    ready = yes;
  });
  const reached = new Promise<void>((yes) => {
    entered = yes;
  });
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  let contacts = 0;
  const f = await fixture(() => {
    if (++contacts === 2) ready();
  });
  let cancel: ReturnType<TaskActions["admission"]["cancel"]> | undefined;
  let write: Promise<string> | undefined;
  try {
    const taskId = await f.create();
    await f.save(taskId, 3);
    const start = await f.submit({ kind: "start", taskId });
    await contacted;
    await f.h.writer.settled();
    const state = readRunState(f.h.reader.files, start.runId!);
    const append = f.h.writer.files.append.bind(f.h.writer.files);
    let once = true;
    vi.spyOn(f.h.writer.files, "append").mockImplementation(
      (lease, scan, rows, observer, nav, charge) =>
        append(
          lease,
          scan,
          rows,
          async (stage) => {
            await observer?.(stage);
            if (once && stage === "commit") {
              once = false;
              entered();
              await held;
            }
          },
          nav,
          charge,
        ),
    );
    write = recordOwner(
      f.h.writer,
      {
        epoch: f.h.owner.lease.registration.epoch,
        taskId,
        runId: start.runId!,
        operationId: start.operationId,
      },
      [
        {
          kind: "fact",
          fact: {
            kind: "assignment-state",
            childRunId: state.admission!.assignments[0].childRunId,
            state: "closing",
            reason: null,
          },
        },
      ],
    );
    void write.catch(() => {});
    await reached;
    const conflict = await f.actions.admission.cancel(
      {
        commandId: start.commandId,
        epoch: f.h.owner.lease.registration.epoch,
        runId: start.runId!,
      },
      f.caller,
    );
    expect(conflict).toMatchObject({
      kind: "error",
      error: { code: "conflict" },
    });
    expect(f.actions.run(start.runId!)?.cancelRequested).toBe(false);
    cancel = f.actions.admission.cancel(
      {
        commandId: randomUUID(),
        epoch: f.h.owner.lease.registration.epoch,
        runId: start.runId!,
      },
      f.caller,
    );
    // A fixture boundary assertion, not a changed native stop/reporting allowance.
    await vi.waitFor(
      () => expect(f.actions.run(start.runId!)?.cancelRequested).toBe(true),
      { timeout: 500, interval: 10 },
    );
    expect(f.h.writer.pendingWrites).toBeGreaterThan(0);
    expect(f.actions.scheduler.accounting.reservations).toBe(2);
    expect(f.actions.scheduler.accounting.episodes).toBe(1);
    expect(contacts).toBe(2);
  } finally {
    release();
    await Promise.allSettled([cancel, write]);
    await f.h.writer.settled();
    await vi.waitFor(
      () => expect(nativeIntervals.every((i) => i.end !== null)).toBe(true),
      { timeout: 4000 },
    );
    vi.restoreAllMocks();
    await f.close();
  }
}, 20000);

it("accepted default Start survives access rotation without reusing the caller grant", async () => {
  let contacts = 0;
  const f = await fixture((_body, res) => {
    contacts++;
    reply(res, "accepted after rotation");
  });
  try {
    const taskId = await f.create();
    const commit = f.h.writer.commit.bind(f.h.writer);
    vi.spyOn(f.h.writer, "commit").mockImplementation(async (intent) => {
      const result = await commit(intent);
      if (
        intent.identity.kind === "action" &&
        intent.identity.action.kind === "start"
      )
        f.h.access.rotate();
      return result;
    });
    const start = await f.submit({ kind: "start", taskId });
    await vi.waitFor(
      () => expect(f.actions.run(start.runId!)?.state).toBe("settled"),
      { timeout: 10000 },
    );
    expect(contacts).toBe(1);
    expect(f.h.owner.state).toBe("idle");
    expect(
      readRunState(f.h.reader.files, start.runId!).settlement,
    ).toMatchObject({ outcome: "completed" });
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
}, 20000);

it.each(
  ["task", "hints", "files"].flatMap((fault) =>
    ["start", "generate-plan"].map((kind) => ({
      fault,
      kind: kind as "start" | "generate-plan",
    })),
  ),
)(
  "post-commit $kind $fault mutation cannot be hidden by the own controlRev transition",
  async ({ fault, kind }) => {
    let contacts = 0;
    const f = await fixture((_body, res) => {
      contacts++;
      reply(res, "must not launch");
    });
    try {
      const taskId = await f.create(
        kind === "generate-plan" ? "code" : "research",
      );
      await f.save(taskId, 1);
      const action = { kind, taskId };
      const auth = vi.spyOn(f.h.models, "prepareTracked");
      const preview = await f.actions.observe(action);
      const grant = await f.actions.admission.preflight(
        { action, expected: preview.version },
        f.caller,
      );
      if (grant.kind !== "ok") throw Error("grant");
      const commit = f.h.writer.commit.bind(f.h.writer);
      const path = join(f.h.coordination.store.tasks, taskId, "task.json");
      vi.spyOn(f.h.writer, "commit").mockImplementation(async (intent) => {
        const result = await commit(intent);
        if (fault === "task")
          writeFileSync(path, readFileSync(path, "utf8") + " ");
        else
          writeFileSync(
            join(
              f.h.coordination.store.root,
              fault === "hints" ? "AGENTS.md" : "foreign.txt",
            ),
            "external change",
          );
        return result;
      });
      const r = await f.actions.admission.submit(
        {
          commandId: randomUUID(),
          grant: grant.value.grant,
          expected: preview.version,
          action,
        },
        f.caller,
      );
      expect(r).toMatchObject({
        kind: "error",
        error: { code: "stale", effect: "accepted" },
      });
      expect(contacts).toBe(0);
      expect(auth).not.toHaveBeenCalled();
      expect(f.actions.scheduler.accounting.episodes).toBe(0);
      expect(f.h.owner.state).toBe("quarantined");
    } finally {
      vi.restoreAllMocks();
      await f.close();
    }
  },
  20000,
);

it("post-native ORIGINAL settlement storage holds the slot, episode and dependency after its reporting timeout", async () => {
  nativeIntervals.length = 0;
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((yes) => {
    entered = yes;
  });
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  let contacts = 0;
  const f = await fixture((_body, res) => {
    contacts++;
    reply(res, "native zero is not durable completion");
  });
  try {
    const taskId = await f.create();
    await f.save(taskId, 2, (g) => {
      g.assignments[1].dependencies = [
        {
          source: { kind: "current", assignmentId: g.assignments[0].id },
          range: null,
          requireCompleteObservation: false,
        },
      ];
    });
    const append = f.h.writer.files.append.bind(f.h.writer.files);
    vi.spyOn(f.h.writer.files, "append").mockImplementation(
      (lease, scan, rows, observer, nav, charge) =>
        append(
          lease,
          scan,
          rows,
          async (stage) => {
            await observer?.(stage);
            if (
              stage === "commit" &&
              rows.some((r) => r.value.kind === "settlement")
            ) {
              entered();
              await held;
            }
          },
          nav,
          charge,
        ),
    );
    const start = await f.submit({ kind: "start", taskId });
    await reached;
    expect(nativeIntervals).toHaveLength(1);
    expect(nativeIntervals[0]).toMatchObject({ exit: 0 });
    expect(nativeIntervals[0].end).not.toBeNull();
    const before = f.actions.scheduler.accounting;
    expect(before).toMatchObject({ reservations: 1, episodes: 1, queued: 1 });
    await vi.waitFor(() => expect(f.h.owner.state).toBe("quarantined"), {
      timeout: 7000,
      interval: 20,
    });
    expect(f.h.writer.pendingWrites).toBeGreaterThan(0);
    expect(f.actions.scheduler.accounting).toEqual(before);
    expect(f.h.coordination.store.load(taskId)?.phase).toBe("running");
    expect(f.actions.run(start.runId!)?.state).toBe("unknown");
    release();
    await f.h.writer.settled();
    expect(f.h.writer.pendingWrites).toBe(0);
    expect(f.actions.scheduler.accounting).toEqual(before);
    expect(contacts).toBe(1);
    // Late original settlement does not clear quarantine or manufacture parent success.
    expect(f.h.owner.state).toBe("quarantined");
  } finally {
    release();
    vi.restoreAllMocks();
    await f.close();
  }
}, 20000);

it("a real SDK editor's own generation advance permits its exact current dependent", async () => {
  nativeIntervals.length = 0;
  const bodies: Record<string, unknown>[] = [];
  const f = await fixture((body, res) => {
    bodies.push(body);
    if (bodies.length !== 1) {
      reply(
        res,
        bodies.length === 2 ? "real edited predecessor" : "reviewed edit",
      );
      return;
    }
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    for (const [delta, finish_reason] of [
      [
        {
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "actual_write",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  path: "fixture.txt",
                  content: "actual SDK write",
                }),
              },
            },
          ],
        },
        null,
      ],
      [{}, "tool_calls"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    res.end("data: [DONE]\n\n");
  });
  try {
    const taskId = await f.create("code");
    await f.save(taskId, 2, (g) => {
      const role = loadAgentDefinitions().find(
        (r) => r.role === "implementation-worker",
      )!;
      g.assignments[0].purpose = "edit";
      g.assignments[0].role = {
        role: "implementation-worker",
        sha256: role.sha256,
      };
      g.assignments[1].dependencies = [
        {
          source: { kind: "current", assignmentId: g.assignments[0].id },
          range: null,
          requireCompleteObservation: false,
        },
      ];
    });
    const start = await f.submit({ kind: "start", taskId });
    await f.actions.scheduler.settled(start.runId!);
    expect(f.h.owner.state).toBe("idle");
    expect(
      readFileSync(join(f.h.coordination.store.root, "fixture.txt"), "utf8"),
    ).toBe("actual SDK write");
    expect(bodies).toHaveLength(3);
    expect(JSON.stringify(bodies[2])).toContain("real edited predecessor");
    expect(nativeIntervals[1].start).toBeGreaterThan(nativeIntervals[0].end!);
    const state = readRunState(f.h.reader.files, start.runId!);
    expect(state.drained).toBe(true);
    expect(state.settlement).toMatchObject({ outcome: "completed" });
  } finally {
    await f.close();
  }
}, 20000);

it.each(["whole", "range", "split-utf8"])(
  "real retained large predecessor %s never silently clips the selected input",
  async (mode) => {
    const bodies: Record<string, unknown>[] = [];
    const text = `λ${"x".repeat(17000)}`;
    const f = await fixture((body, res) => {
      bodies.push(body);
      reply(res, bodies.length === 1 ? text : "selected range read");
    });
    try {
      const taskId = await f.create();
      await f.save(taskId, 2, (g) => {
        g.assignments[1].dependencies = [
          {
            source: { kind: "current", assignmentId: g.assignments[0].id },
            range:
              mode === "whole"
                ? null
                : { start: mode === "range" ? 0 : 1, end: 3 },
            requireCompleteObservation: false,
          },
        ];
      });
      const start = await f.submit({ kind: "start", taskId });
      await f.actions.scheduler.settled(start.runId!);
      const state = readRunState(f.h.reader.files, start.runId!);
      expect(f.h.owner.state).toBe("idle");
      expect(state.drained).toBe(true);
      expect(state.settlement).toMatchObject({
        outcome: mode === "range" ? "completed" : "blocked",
      });
      expect(bodies).toHaveLength(mode === "range" ? 2 : 1);
      if (mode === "range") expect(JSON.stringify(bodies[1])).toContain("λx");
      else
        expect(state.admissionClosed?.reason).toBe(
          mode === "whole" ? "handoff-overflow" : "stale-dependency",
        );
    } finally {
      await f.close();
    }
  },
  20000,
);

it("one actual action owner fences metadata while duplicate/lost receipts never activate it twice", async () => {
  const f = await fixture((_body, res) => reply(res, "must not launch"));
  let entered!: () => void, release!: () => void;
  const reached = new Promise<void>((yes) => {
    entered = yes;
  });
  const held = new Promise<void>((yes) => {
    release = yes;
  });
  try {
    const action = {
      kind: "create" as const,
      taskKind: "research" as const,
      goal: "metadata only",
    };
    const preview = await f.actions.observe(action);
    const preflight = await f.actions.admission.preflight(
      { action, expected: preview.version },
      f.caller,
    );
    if (preflight.kind !== "ok") throw Error("grant");
    const command = {
      action,
      expected: preview.version,
      grant: preflight.value.grant,
      commandId: randomUUID(),
    };
    const publish = f.h.writer.publishTask.bind(f.h.writer);
    const effect = vi
      .spyOn(f.h.writer, "publishTask")
      .mockImplementation(async (input) => {
        entered();
        await held;
        return publish(input);
      });
    expect((await f.actions.admission.submit(command, f.caller)).kind).toBe(
      "ok",
    );
    await reached;
    await expect(f.actions.observe(action)).rejects.toThrow("conflict");
    expect(f.h.coordination.store.list()).toHaveLength(0);
    expect(
      (
        await f.actions.admission.submit(
          { ...command, grant: randomUUID() },
          f.caller,
        )
      ).kind,
    ).toBe("ok");
    expect(effect).toHaveBeenCalledTimes(1);
    expect(
      () =>
        new TaskActions({
          host: f.h,
          cwd: f.h.coordination.store.root,
          selection: preview.version.model,
          ownerSecrets: [],
        }),
    ).toThrow("conflict");
    release();
    await f.actions.settled(null);
    expect(f.h.coordination.store.list()).toHaveLength(1);
    const lost = await f.actions.admission.submit(command, f.caller);
    expect(lost).toMatchObject({
      kind: "ok",
      value: { admission: "accepted", publication: "published" },
    });
    expect(effect).toHaveBeenCalledTimes(1);
    expect(f.actions.scheduler.accounting.reservations).toBe(0);
  } finally {
    release();
    vi.restoreAllMocks();
    await f.close();
  }
}, 20000);

it("refuses a displayed task cwd different from the actual host launch cwd in the same Git checkout", async () => {
  let refused = false;
  const f = await fixture(
    (_body, res) => reply(res, "must not launch"),
    undefined,
    (host, selection) => {
      const root = host.coordination.store.root;
      // Explicit fixture-only Git setup; no Git operation touches the user's checkout.
      execFileSync("git", ["init", "--quiet"], { cwd: root, env: process.env });
      const nested = join(root, "nested");
      mkdirSync(nested);
      try {
        return new TaskActions({
          host,
          cwd: nested,
          selection,
          ownerSecrets: [],
        });
      } catch {
        refused = true;
        return new TaskActions({
          host,
          cwd: root,
          selection,
          ownerSecrets: [],
        });
      }
    },
  );
  try {
    expect(refused).toBe(true);
    expect(f.actions.scheduler.accounting.reservations).toBe(0);
  } finally {
    await f.close();
  }
}, 20000);

it("already accepted save-plan publication also survives real access rotation", async () => {
  let contacts = 0;
  const f = await fixture((_body, res) => {
    contacts++;
    reply(res, "must not launch");
  });
  try {
    const taskId = await f.create();
    const commit = f.h.writer.commit.bind(f.h.writer);
    vi.spyOn(f.h.writer, "commit").mockImplementation(async (intent) => {
      const result = await commit(intent);
      if (
        intent.identity.kind === "action" &&
        intent.identity.action.kind === "save-plan"
      )
        f.h.access.rotate();
      return result;
    });
    const graph = await f.save(taskId, 1);
    expect(f.actions.savedGraph(taskId)?.graph).toEqual(graph);
    expect(f.h.owner.state).toBe("idle");
    expect(contacts).toBe(0);
  } finally {
    vi.restoreAllMocks();
    await f.close();
  }
}, 20000);

it.each([false, true])(
  "Generate uses one actual readonly child, graph null and never saves its advisory output (saved graph: %s)",
  async (saved) => {
    nativeIntervals.length = 0;
    const bodies: Record<string, unknown>[] = [];
    // Deliberately unusable as a structured/size-bounded Save proposal. It remains
    // genuine successful native output, not a failed worker or a clipped plan.
    const proposal = saved
      ? `Not JSON: ${"advisory λ ".repeat(4000)}END-PROPOSAL`
      : "Inspect, then propose two independent investigations. Await separate Save and Start.";
    const f = await fixture((body, res) => {
      bodies.push(body);
      reply(res, proposal);
    });
    try {
      const taskId = await f.create("code");
      const graph = saved
        ? await f.save(taskId, 2, (g) => {
            const role = loadAgentDefinitions().find(
              (r) => r.role === "implementation-worker",
            )!;
            for (const assignment of g.assignments) {
              assignment.purpose = "edit";
              assignment.role = {
                role: "implementation-worker",
                sha256: role.sha256,
              };
              assignment.instructions =
                "SAVED-EDIT-ASSIGNMENT-MUST-NOT-EXECUTE";
            }
          })
        : null;
      const before = f.h.coordination.store.load(taskId)!;
      const action: Action = { kind: "generate-plan", taskId };
      const preview = await f.actions.observe(action);
      expect(preview.graph).toBeNull();
      expect(preview.readablePlan).toBe(before.plan);
      const grant = await f.actions.admission.preflight(
        { action, expected: preview.version },
        f.caller,
      );
      if (grant.kind !== "ok") throw Error("preflight");
      const command = {
        commandId: randomUUID(),
        action,
        expected: preview.version,
        grant: grant.value.grant,
      };
      const accepted = await f.actions.admission.submit(command, f.caller);
      if (accepted.kind !== "ok") throw Error(JSON.stringify(accepted));
      // Lost-reply observation of the exact command does not allocate another child.
      const duplicate = await f.actions.admission.submit(command, f.caller);
      expect(duplicate).toMatchObject({
        kind: "ok",
        value: { runId: accepted.value.runId },
      });
      await f.actions.scheduler.settled(accepted.value.runId!);
      expect(f.h.owner.state).toBe("idle");
      expect(bodies).toHaveLength(1);
      expect(nativeIntervals).toHaveLength(1);
      expect(nativeIntervals[0]).toMatchObject({ exit: 0 });
      expect(nativeIntervals[0].end).not.toBeNull();
      const tools = bodies[0].tools as { function: { name: string } }[];
      expect(tools.map((t) => t.function.name).sort()).toEqual([
        "find",
        "grep",
        "ls",
        "read",
      ]);
      const prompt = JSON.stringify(bodies[0]);
      expect(prompt).toContain("at most 16 assignments");
      expect(prompt).toContain("advisory");
      expect(prompt).not.toContain("SAVED-EDIT-ASSIGNMENT-MUST-NOT-EXECUTE");
      const state = readRunState(f.h.reader.files, accepted.value.runId!);
      expect(state.admission).toMatchObject({
        kind: "generate-plan",
        graph: null,
        assignments: [{ assignmentId: "plan" }],
      });
      expect(state.admission?.context.model).toEqual(preview.version.model);
      expect(
        f.h.reader.files.readAdmission(state.runId, state.admission!).graph,
      ).toBeNull();
      expect(state.drained).toBe(true);
      expect(state.settlement).toMatchObject({
        kind: "parent",
        outcome: "completed",
      });
      expect(state.children.size).toBe(1);
      const child = [...state.children.values()][0];
      expect(child.completion).toMatchObject({
        native: {
          outcome: "completed",
          closure: "direct-child-closed",
          exitCode: 0,
          stdin: "delivered",
          final: "valid",
          cleanup: "settled",
        },
        recording: { status: "committed" },
      });
      if (child.completion?.recording.status !== "committed")
        throw Error("recording");
      const ref = child.completion.recording.detail.content;
      const detail = f.h.reader.selected({
        storeId: f.h.reader.storeId,
        scope: { kind: "child", id: child.link.childRunId },
        snapshotSeq: f.h.writer.committedSeq,
        recordId: ref.recordId,
        recordVersion: ref.version,
        field: ref.field,
        query: null,
        offset: 0,
      });
      const retained = Buffer.concat(
        [...f.h.reader.parts(detail, f.h.writer.committedSeq)].map(
          (p) => p.bytes,
        ),
      ).toString("utf8");
      expect(retained).toBe(proposal);
      const after = f.h.coordination.store.load(taskId)!;
      expect(after.phase).toBe("planning");
      expect(after.plan).toBe(before.plan);
      expect(after.checks).toEqual(before.checks);
      expect(after.result).toContain("Advisory plan proposal only; not saved");
      expect(f.actions.savedGraph(taskId)?.graph ?? null).toEqual(graph);
      expect(f.actions.scheduler.accounting).toMatchObject({
        episodes: 0,
        reservations: 0,
      });
      expect((await f.h.projection.session()).capabilities.actions).toBe(false);
      if (!saved) {
        const startPreview = await f.actions.observe({ kind: "start", taskId });
        expect(
          await f.actions.admission.preflight(
            {
              action: { kind: "start", taskId },
              expected: startPreview.version,
            },
            f.caller,
          ),
        ).toMatchObject({
          kind: "error",
          error: { code: "unsupported-context" },
        });
      }
    } finally {
      await f.close();
    }
  },
  20000,
);

it("Generate is independently forbidden for a readonly task and never contacts the provider", async () => {
  let contacts = 0;
  const f = await fixture((_body, res) => {
    contacts++;
    reply(res, "not allowed");
  });
  try {
    const taskId = await f.create();
    const before = readFileSync(
      join(f.h.coordination.store.tasks, taskId, "task.json"),
    );
    await expect(
      f.actions.observe({ kind: "generate-plan", taskId }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(contacts).toBe(0);
    expect(f.actions.scheduler.accounting.episodes).toBe(0);
    expect(
      readFileSync(join(f.h.coordination.store.tasks, taskId, "task.json")),
    ).toEqual(before);
  } finally {
    await f.close();
  }
}, 20000);

it("Generate survives real token rotation/detach; explicit Cancel joins original native closure without saving", async () => {
  nativeIntervals.length = 0;
  let ready!: () => void;
  const contacted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let contacts = 0;
  const f = await fixture(() => {
    contacts++;
    ready();
  });
  try {
    const taskId = await f.create("code");
    const generated = await f.submit({ kind: "generate-plan", taskId });
    await contacted;
    f.h.access.rotate();
    f.h.owner.detach();
    expect(f.actions.run(generated.runId!)?.cancelRequested).toBe(false);
    expect(nativeIntervals[0].end).toBeNull();
    const cancel = await f.actions.admission.cancel(
      {
        commandId: randomUUID(),
        epoch: f.h.owner.lease.registration.epoch,
        runId: generated.runId,
      },
      { ...f.caller, accessGeneration: f.h.access.generation },
    );
    expect(cancel.kind).toBe("ok");
    await f.actions.scheduler.settled(generated.runId!);
    const state = readRunState(f.h.reader.files, generated.runId!);
    expect(state.admission?.kind).toBe("generate-plan");
    expect(state.drained).toBe(true);
    expect(state.settlement).toMatchObject({ outcome: "canceled" });
    expect([...state.children.values()][0].completion?.native).toMatchObject({
      outcome: "canceled",
      closure: "direct-child-closed",
    });
    expect(f.h.coordination.store.load(taskId)).toMatchObject({
      phase: "interrupted",
      plan: "",
    });
    expect(contacts).toBe(1);
    expect(nativeIntervals).toHaveLength(1);
    expect(nativeIntervals[0].end).not.toBeNull();
  } finally {
    await f.close();
  }
}, 20000);

it("Generate publication conflict preserves external raw task bytes and genuine native success separately", async () => {
  let ready!: () => void;
  const contacted = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let response!: ServerResponse;
  const f = await fixture((_body, res) => {
    response = res;
    ready();
  });
  try {
    const taskId = await f.create("code");
    const generated = await f.submit({ kind: "generate-plan", taskId });
    await contacted;
    const path = join(f.h.coordination.store.tasks, taskId, "task.json");
    const external = Buffer.concat([readFileSync(path), Buffer.from(" \n")]);
    writeFileSync(path, external);
    reply(
      response,
      "An advisory draft is not permission to overwrite external task bytes.",
    );
    await f.actions.scheduler.settled(generated.runId!);
    expect(readFileSync(path)).toEqual(external);
    expect(f.h.owner.state).toBe("quarantined");
    const state = readRunState(f.h.reader.files, generated.runId!);
    expect([...state.children.values()][0].completion?.native).toMatchObject({
      outcome: "completed",
      exitCode: 0,
      closure: "direct-child-closed",
    });
    // No new candidate/save existed: the durable pre-effect outcome is uncertain,
    // not a fabricated publication intent or an overwritten successful receipt.
    expect(state.publication).toBe("uncertain");
    expect(state.drained).toBe(false);
  } finally {
    await f.close();
  }
}, 20000);
