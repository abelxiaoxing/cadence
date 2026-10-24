import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { loadAgentDefinitions } from "../src/agent-registry.ts";
import { proposePlanContent } from "../src/history/plans.ts";
import { HistoryProjection } from "../src/history/projection.ts";
import { HistoryReader } from "../src/history/reader.ts";
import { RunState, readRunState } from "../src/history/run-state.ts";
import { CheckRecording } from "../src/service/check-recording.ts";
import {
  type CheckSelection,
  type ContextVersion,
  encodeExportFrame,
  type ListRequest,
} from "../src/service-contract.ts";

import { fixture, natives } from "./helpers/service-check-fixture.ts";

function settledCheck(f: Awaited<ReturnType<typeof fixture>>, runId: string) {
  const fact = f.facts(runId).find((v) => v.kind === "check-settled");
  if (fact?.kind !== "check-settled") throw Error("No check settlement");
  return fact;
}
it("real SDK task then configured and local manual checks: frozen cwd/env, real EOF/close, own generation PASS and full retained split stdout/stderr", async () => {
  const ingress: { stream: string; bytes: number; failed?: string }[] = [];
  const receive = CheckRecording.prototype.receive;
  vi.spyOn(CheckRecording.prototype, "receive").mockImplementation(function (
    this: CheckRecording,
    chunk,
    stream,
  ) {
    const row: { stream: string; bytes: number; failed?: string } = {
      stream,
      bytes: chunk.length,
    };
    ingress.push(row);
    try {
      return receive.call(this, chunk, stream).catch((error) => {
        row.failed = "recording-refused";
        throw error;
      });
    } catch (error) {
      row.failed = "recording-refused";
      throw error;
    }
  });
  const f = await fixture(`
    if (process.env.ORDINARY_CHECK_VALUE !== 'launch-frozen' || process.env.PRIVATE_AUTH_ONLY || process.env.CADENCE_CONTROL_CANARY || !process.env.CADENCE_SUBAGENT_CHILD) process.exit(7);
    process.stdin.resume(); process.stdin.on('end', async () => {
      process.stdout.write('cwd=' + process.cwd() + '\\nEOF observed\\n');
      const emit = (s,b) => new Promise(r => s.write(b,r));
      for (const stream of [process.stdout,process.stderr]) {
        await emit(stream, 'x'.repeat(70000));
        const text = Buffer.from('🌟fabricated-check-provider-key終');
        for (let at=0; at<text.length; at++) await emit(stream,text.subarray(at,at+1));
        await emit(stream,'\\nEND\\n');
      }
    });`);
  const taskId = await f.create(),
    task = f.h.coordination.store.loadSnapshot(taskId)!;
  const role = loadAgentDefinitions().find(
    (r) => r.role === "design-explorer",
  )!;
  const plan = "Inspect readonly before actual parent checks.";
  await f.submit({
    kind: "save-plan",
    taskId,
    plan,
    graph: {
      schema: "cadence-graph/2",
      taskId,
      taskKind: "code",
      taskRevision: task.record.revision + 1,
      revision: 1,
      planRevision: 1,
      plan: proposePlanContent(plan, 1, []),
      assignments: [
        {
          id: "inspect",
          purpose: "research",
          instructions: "Report observations",
          expectedOutput: "Result",
          role: { role: "design-explorer", sha256: role.sha256 },
          model: f.selection,
          dependencies: [],
        },
      ],
    },
  });
  await f.actions.settled(taskId);
  const started = await f.submit({ kind: "start", taskId });
  await f.actions.scheduler.settled(started.runId!);
  expect(f.contacts()).toBe(1);
  const preparation = vi.spyOn(f.h.models, "prepareTracked");
  vi.stubEnv("ORDINARY_CHECK_VALUE", "later-terminal-change");
  const preview = await f.actions.observe({
    kind: "check",
    taskId,
    check: f.check,
  });
  expect(preview.checkEnvironmentPolicy).toBe("service-launch-ordinary/1");
  const checked = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(checked.runId!);
  const fact = settledCheck(f, checked.runId!);
  expect(fact, JSON.stringify(ingress)).toMatchObject({
    status: "passed",
    native: {
      outcome: "completed",
      closure: "direct-child-closed",
      exitCode: 0,
      stdin: "not-required",
    },
    coverage: { observed: "complete", redacted: true },
  });
  expect(fact.after.checkoutGeneration).toBe(
    fact.before.checkoutGeneration + 1,
  );
  expect(fact.ownAdvance?.reservationId).toBe(fact.checkId);
  const state = readRunState(f.h.reader.files, checked.runId!);
  expect(state.admission).toMatchObject({
    kind: "check",
    assignments: [],
    graph: null,
  });
  expect(state.drained).toBe(true);
  const ref = fact.output!;
  expect(ref.bytes).toBeGreaterThan(140000);
  const detail = f.h.reader.selected({
    storeId: f.h.reader.storeId,
    scope: { kind: "run", id: checked.runId! },
    snapshotSeq: f.h.writer.committedSeq,
    query: null,
    recordId: ref.recordId,
    recordVersion: ref.version,
    field: "check",
    offset: 0,
  });
  const text = Buffer.concat(
    [...f.h.reader.parts(detail, f.h.writer.committedSeq)].map((p) => p.bytes),
  ).toString("utf8");
  // Labels intentionally interrupt chunks; reconstruct each fixture stream,
  // rather than pretending the combined observation is one original stream.
  const pieces = text.split(/\n\[(stdout|stderr)\]\n/);
  const streams = { stdout: "", stderr: "" };
  for (let i = 1; i < pieces.length; i += 2) {
    const stream = pieces[i];
    if (stream === "stdout" || stream === "stderr")
      streams[stream] += pieces[i + 1];
  }
  expect(streams.stdout.includes(`cwd=${f.root}`)).toBe(true);
  expect(streams.stdout.includes("EOF observed")).toBe(true);
  expect(text).toContain("[stdout]");
  expect(text).toContain("[stderr]");
  expect(streams.stdout.includes("x".repeat(70000))).toBe(true);
  expect(streams.stderr).toBe(`${"x".repeat(70000)}🌟[redacted]終\nEND\n`);
  expect(text.includes("🌟[redacted]終")).toBe(true);
  expect(text).not.toContain("fabricated-check-provider-key");
  expect(text).not.toContain("�");
  const manual = {
    ...f.check,
    kind: "manual" as const,
    name: "Manual",
    timeoutMs: 120000,
  };
  const manualPreview = await f.actions.observe({
    kind: "check",
    taskId,
    check: manual,
  });
  expect(
    (
      await f.actions.admission.preflight(
        {
          action: { kind: "check", taskId, check: manual },
          expected: manualPreview.version,
        },
        { ...f.caller, authority: "browser" },
      )
    ).kind,
  ).toBe("error");
  const local = await f.submit({ kind: "check", taskId, check: manual });
  await f.actions.scheduler.settled(local.runId!);
  expect(settledCheck(f, local.runId!).status).toBe("passed");
  expect(preparation).not.toHaveBeenCalled();
  expect(f.contacts()).toBe(1);
  expect(
    natives
      .filter((n) => n.kind === "check")
      .every((n) => n.ignoredInput && n.code === 0),
  ).toBe(true);
  expect(f.h.coordination.store.load(taskId)?.checks).toHaveLength(2);
}, 60000);

it("current obligations: own PASS, foreign-generation/epoch/cwd/environment stale and changed definition not-run without rewriting native facts", async () => {
  const f = await fixture(),
    taskId = await f.create();
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  let version: ContextVersion = (
    await f.actions.observe({ kind: "check", taskId, check: f.check })
  ).version;
  // Actual check source and observation; subsequent identity perturbations are
  // explicit current-environment injections, not a running production host.
  const projection = new HistoryProjection(f.h.reader, {
    session: () => {
      throw Error("unused");
    },
    workspace: () => {
      throw Error("unused");
    },
    context: () => ({ status: "available", version }),
    checks: (id) => f.actions.checks(id),
    legacyTasks: () => [],
  });
  expect(
    (await projection.checkObligations(taskId)).definitions.map(
      (d) => d.status,
    ),
  ).toEqual(["passed", "not-run"]);
  const original = version;
  for (const change of [
    { checkoutGeneration: version.checkoutGeneration + 1 },
    { epoch: randomUUID() },
    { cwdId: randomUUID() },
    { checkEnvGeneration: 2 },
  ]) {
    version = { ...original, ...change };
    expect(
      (await projection.checkObligations(taskId)).definitions[0].status,
    ).toBe("stale");
  }
  version = original;
  f.configure([{ ...f.check, timeoutMs: f.check.timeoutMs - 1 }]);
  expect(
    (await projection.checkObligations(taskId)).definitions[0].status,
  ).toBe("not-run");
  expect(settledCheck(f, r.runId!)).toMatchObject({
    status: "passed",
    native: { exitCode: 0 },
  });
}, 60000);

it("actual check mutation and nonzero exit preserve stale/failed native facts; v1 external conflict is not overwritten", async () => {
  const f = await fixture(
      "require('node:fs').writeFileSync('changed.txt','check mutation');",
    ),
    taskId = await f.create();
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  expect(settledCheck(f, r.runId!)).toMatchObject({
    status: "stale",
    native: { outcome: "completed", exitCode: 0 },
  });
  const manual: CheckSelection = {
    kind: "manual",
    name: "Manual",
    command: `${JSON.stringify(process.execPath)} -e "process.exit(7)"`,
    timeoutMs: 120000,
  };
  const bad = await f.submit({ kind: "check", taskId, check: manual });
  await f.actions.scheduler.settled(bad.runId!);
  expect(settledCheck(f, bad.runId!)).toMatchObject({
    status: "failed",
    native: { exitCode: 7 },
  });
  const publish = f.h.writer.publishTask.bind(f.h.writer);
  let external = "";
  vi.spyOn(f.h.writer, "publishTask").mockImplementation(async (request) => {
    const state = request.operationId && f.facts(r.runId!);
    if (state && f.h.coordination.store.load(taskId)?.phase === "running") {
      const path = join(
        f.root,
        ".cadence/assistant/tasks",
        taskId,
        "task.json",
      );
      external = `${readFileSync(path, "utf8")} `;
      writeFileSync(path, external);
    }
    return publish(request);
  });
  const conflict = await f.submit({ kind: "check", taskId, check: manual });
  await f.actions.scheduler.settled(conflict.runId!);
  expect(f.h.owner.state).toBe("quarantined");
  expect(
    readFileSync(
      join(f.root, ".cadence/assistant/tasks", taskId, "task.json"),
      "utf8",
    ),
  ).toBe(external);
}, 60000);

it.each(["cancel", "timeout"] as const)(
  "actual %s preserves native close/EOF facts and never a green check",
  async (mode) => {
    const f = await fixture(
        "process.stdout.write('started\\n'); setTimeout(()=>{},10000);",
        mode === "timeout" ? 100 : 15000,
      ),
      taskId = await f.create();
    const r = await f.submit({ kind: "check", taskId, check: f.check });
    if (mode === "cancel") {
      await vi.waitFor(
        () => expect(natives.some((n) => n.kind === "check")).toBe(true),
        { timeout: 5000 },
      );
      const canceled = await f.actions.admission.cancel(
        {
          commandId: randomUUID(),
          epoch: f.caller ? f.h.owner.lease.registration.epoch : "",
          runId: r.runId!,
        },
        f.caller,
      );
      expect(canceled.kind).toBe("ok");
    }
    await f.actions.scheduler.settled(r.runId!);
    expect(settledCheck(f, r.runId!)).toMatchObject({
      status: "canceled",
      native: {
        outcome: mode === "cancel" ? "canceled" : "timeout",
        closure: "direct-child-closed",
        stdin: "not-required",
      },
    });
  },
  60000,
);

it("native invalid UTF-8 cannot become a successful captured check at exit zero", async () => {
  const f = await fixture("process.stdout.write(Buffer.from([0xff]));"),
    taskId = await f.create();
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  const settled = settledCheck(f, r.runId!);
  expect(settled).toMatchObject({
    status: "failed",
    coverage: { observed: "incomplete" },
    native: { closure: "direct-child-closed" },
  });
  // The child exits 0 right after its write, unless the recorder's refusal of
  // the byte stops it first (a loaded runner): neither close is a success.
  expect(
    settled.native.exitCode === 0 || settled.native.signal === "SIGTERM",
  ).toBe(true);
}, 60000);

it("actual private access/model literals redact without check-side auth and with no credential/config writes", async () => {
  const f = await fixture(),
    taskId = await f.create();
  const access = f.h.access.redactionLiterals()[0],
    capability = f.h.coordination.localAccess().capability;
  writeFileSync(
    join(f.dir, "check.cjs"),
    `process.stdout.write(${JSON.stringify(`begin ${access} ${capability} fabricated-check-provider-key fabricated-scoped-auth end`)});`,
  );
  const authPath = join(f.dir, "home/agent/auth.json"),
    before = readFileSync(authPath);
  const prepare = vi.spyOn(f.h.models, "prepareTracked");
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  const fact = settledCheck(f, r.runId!);
  expect(fact.status).toBe("passed");
  const ref = fact.output!;
  const detail = f.h.reader.selected({
    storeId: f.h.reader.storeId,
    scope: { kind: "run", id: r.runId! },
    snapshotSeq: f.h.writer.committedSeq,
    query: null,
    recordId: ref.recordId,
    recordVersion: ref.version,
    field: "check",
    offset: 0,
  });
  const text = Buffer.concat(
    [...f.h.reader.parts(detail, f.h.writer.committedSeq)].map((p) => p.bytes),
  ).toString("utf8");
  for (const secret of [
    access,
    capability,
    "fabricated-check-provider-key",
    "fabricated-scoped-auth",
  ])
    expect(text.includes(secret)).toBe(false);
  expect(prepare).not.toHaveBeenCalled();
  expect(f.contacts()).toBe(0);
  expect(readFileSync(authPath)).toEqual(before);
}, 60000);

it("slow original capture end after real native exit0 retains Stop fences and cannot publish late", async () => {
  const f = await fixture(),
    taskId = await f.create();
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((yes) => {
      enter = yes;
    }),
    held = new Promise<void>((yes) => {
      release = yes;
    });
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
          if (
            once &&
            stage === "commit" &&
            rows.some(
              (r) =>
                r.value.kind === "owner" &&
                r.value.events.some(
                  (e) => e.kind === "end" && e.detail.content.field === "check",
                ),
            )
          ) {
            once = false;
            enter();
            await held;
          }
        },
        nav,
        charge,
      ),
  );
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  try {
    await Promise.race([
      entered,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(Error("capture end not reached")), 10000),
      ),
    ]);
    expect(
      natives.some((n) => n.kind === "check" && n.end !== null && n.code === 0),
    ).toBe(true);
    const report = await f.h.owner.stop(10); // injected reporting wait, not the5s capture bound
    expect(report.state).toBe("quarantined");
    expect(f.h.writer.pendingWrites).toBeGreaterThan(0);
    expect(f.actions.scheduler.accounting.reservations).toBe(1);
  } finally {
    release();
  }
  await f.actions.scheduler.settled(r.runId!);
  await f.h.writer.settled();
  await f.h.owner.settled();
  expect(f.h.owner.state).toBe("quarantined");
  expect(existsSync(f.h.coordination.store.lockPath)).toBe(true);
  expect(f.h.coordination.store.load(taskId)?.phase).toBe("running");
  expect(f.actions.scheduler.accounting.reservations).toBe(1);
}, 60000);

it.each(["start", "generate-plan"] as const)(
  "check excludes cross-task %s; foreign advance blocks old acceptance, fresh consent runs afterward",
  async (kind) => {
    const f = await fixture(
        "process.stdout.write('running'); const timer=setInterval(()=>{if(require('node:fs').existsSync(require('node:path').join(__dirname,'release-check'))){clearInterval(timer); process.stdout.write('finished');}},20);",
      ),
      taskId = await f.create(),
      other = await f.create();
    const role = loadAgentDefinitions().find(
        (r) => r.role === "implementation-worker",
      )!,
      task = f.h.coordination.store.loadSnapshot(other)!;
    const plan = "Make the explicitly authorized edit after parent checks.";
    await f.submit({
      kind: "save-plan",
      taskId: other,
      plan,
      graph: {
        schema: "cadence-graph/2",
        taskId: other,
        taskKind: "code",
        taskRevision: task.record.revision + 1,
        revision: 1,
        planRevision: 1,
        plan: proposePlanContent(plan, 1, []),
        assignments: [
          {
            id: "edit",
            purpose: "edit",
            instructions: "Inspect the isolated task",
            expectedOutput: "Result",
            role: { role: "implementation-worker", sha256: role.sha256 },
            model: f.selection,
            dependencies: [],
          },
        ],
      },
    });
    await f.actions.settled(other);
    const checked = await f.submit({ kind: "check", taskId, check: f.check });
    await vi.waitFor(
      () => expect(natives.some((n) => n.kind === "check")).toBe(true),
      { timeout: 5000 },
    );
    const edit = await f.submit({ kind, taskId: other });
    expect(f.contacts()).toBe(0);
    writeFileSync(join(f.dir, "release-check"), "release");
    await f.actions.scheduler.settled(checked.runId!);
    await f.actions.scheduler.settled(edit.runId!);
    expect(settledCheck(f, checked.runId!).status).toBe("passed");
    expect(
      readRunState(f.h.reader.files, edit.runId!).settlement,
    ).toMatchObject({
      kind: "parent",
      outcome: "blocked",
    });
    expect(f.contacts()).toBe(0);
    expect(natives.filter((n) => n.kind === "check")).toHaveLength(1);
    if (kind === "start") {
      // A blocked Start is not resumable: explicitly save/review a new graph.
      const previous = f.actions.savedGraph(other)!.graph;
      await f.submit({
        kind: "save-plan",
        taskId: other,
        plan,
        graph: {
          ...previous,
          revision: previous.revision + 1,
          planRevision: previous.planRevision + 1,
          taskRevision: f.h.coordination.store.load(other)!.revision + 1,
          plan: proposePlanContent(plan, previous.planRevision + 1, []),
        },
      });
      await f.actions.settled(other);
    }
    const fresh = await f.submit({ kind, taskId: other });
    await f.actions.scheduler.settled(fresh.runId!);
    expect(f.contacts()).toBe(1);
    expect(
      readRunState(f.h.reader.files, fresh.runId!).settlement,
    ).toMatchObject({ kind: "parent", outcome: "completed" });
    expect(natives.find((n) => n.kind === "sdk")!.start).toBeGreaterThanOrEqual(
      natives.find((n) => n.kind === "check")!.end!,
    );
  },
  60000,
);

it("shared reducer rejects an owned check advance borrowed from another operation/reservation/generation", async () => {
  const f = await fixture(),
    taskId = await f.create();
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  for (const mutation of ["operation", "reservation", "generation"] as const) {
    const state = new RunState(r.runId!);
    let exercised = false;
    for (const batch of f.h.reader.files.scan()) {
      for (const row of batch.rows) {
        const copy = structuredClone(row);
        if (copy.value.kind === "owner" && copy.value.link.runId === r.runId) {
          const item = copy.value.events.find(
            (e) =>
              e.kind === "owner" &&
              e.value.kind === "fact" &&
              e.value.fact.kind === "check-settled",
          );
          if (
            item?.kind === "owner" &&
            item.value.kind === "fact" &&
            item.value.fact.kind === "check-settled"
          ) {
            const advance = item.value.fact.ownAdvance!;
            if (mutation === "operation") advance.operationId = randomUUID();
            if (mutation === "reservation")
              advance.reservationId = randomUUID();
            if (mutation === "generation") {
              advance.from++;
              advance.to++;
            }
            expect(() => state.apply(copy, batch.marker.last)).toThrow();
            exercised = true;
            break;
          }
        }
        state.apply(copy, batch.marker.last);
      }
      if (exercised) break;
    }
    expect(exercised).toBe(true);
  }
  expect(settledCheck(f, r.runId!).status).toBe("passed");
}, 60000);

it("actual native check loses lease before timeout signaling: unknown stays fenced after eventual unforced close", async () => {
  const f = await fixture(
      "process.stdout.write('native-live'); setTimeout(()=>{},4500);",
      500,
    ),
    taskId = await f.create();
  const originals: Parameters<typeof f.h.owner.trackCheck>[0][] = [];
  const track = f.h.owner.trackCheck.bind(f.h.owner);
  vi.spyOn(f.h.owner, "trackCheck").mockImplementation((original, stop) => {
    originals.push(original);
    track(original, stop);
  });
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await vi.waitFor(
    () => expect(natives.some((n) => n.kind === "check")).toBe(true),
    { timeout: 5000 },
  );
  // Injected real-file ownership loss, not an OS race or successful recovery.
  const registration = f.h.coordination.path("registration.json");
  writeFileSync(registration, `${readFileSync(registration, "utf8")} `);
  await f.actions.scheduler.settled(r.runId!);
  expect(originals).toHaveLength(1);
  expect(await originals[0]).toMatchObject({
    outcome: "unknown",
    closure: "unconfirmed",
    exitCode: null,
    stdin: "not-required",
  });
  expect(f.actions.scheduler.accounting.reservations).toBe(1);
  expect(f.h.owner.state).toBe("quarantined");
  await vi.waitFor(
    () => expect(natives.every((n) => n.end !== null)).toBe(true),
    { timeout: 6000 },
  );
  expect(natives[0].code).toBe(0); // later native zero cannot repair the original unknown
  expect(await originals[0]).toMatchObject({
    outcome: "unknown",
    closure: "unconfirmed",
  });
  expect(existsSync(f.h.coordination.store.lockPath)).toBe(true);
}, 60000);

it("rotation during a native check keeps new and retired owner literals private across both split streams", async () => {
  const f = await fixture(`
    const fs = require('node:fs'), path = require('node:path');
    const marker = path.join(__dirname,'continue-output');
    fs.writeFileSync(path.join(__dirname,'check-ready'),'ready');
    const wait = setInterval(async () => {
      if (!fs.existsSync(marker)) return;
      clearInterval(wait);
      const values = JSON.parse(fs.readFileSync(marker,'utf8'));
      if (values.some(v => Object.values(process.env).includes(v))) process.exit(9);
      const emit = (s,b) => new Promise(r => s.write(b,r));
      for (const [name,s] of [['stdout',process.stdout],['stderr',process.stderr]]) {
        for (const [index,value] of values.entries()) {
          await emit(s, 'before ' + value.slice(0,17));
          // Acknowledged by the actual parent native receive callback, not a
          // sleep or model/progress message. The next write cannot coalesce.
          while (!fs.existsSync(path.join(__dirname,'part-'+name+'-'+index))) await new Promise(r=>setTimeout(r,5));
          await emit(s, value.slice(17) + ' after\\n');
        }
      }
    },20);`),
    taskId = await f.create();
  const raw: Record<"stdout" | "stderr", string[]> = { stdout: [], stderr: [] };
  let values: string[] = [];
  const receive = CheckRecording.prototype.receive;
  vi.spyOn(CheckRecording.prototype, "receive").mockImplementation(function (
    this: CheckRecording,
    chunk,
    stream,
  ) {
    raw[stream].push(chunk.toString("utf8"));
    for (const [index, value] of values.entries())
      if (raw[stream].join("").includes(value.slice(0, 17)))
        writeFileSync(join(f.dir, `part-${stream}-${index}`), "received");
    return receive.call(this, chunk, stream);
  });
  const old = f.h.access.redactionLiterals()[0];
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await vi.waitFor(
    () => expect(existsSync(join(f.dir, "check-ready"))).toBe(true),
    { timeout: 5000 },
  );
  f.h.access.rotate();
  const retired = f.h.access.redactionLiterals()[0];
  f.h.access.rotate();
  const latest = f.h.access.redactionLiterals()[0];
  values = [old, retired, latest];
  writeFileSync(join(f.dir, "continue-output"), JSON.stringify(values));
  await f.actions.scheduler.settled(r.runId!);
  const fact = settledCheck(f, r.runId!);
  expect(fact).toMatchObject({
    status: "passed",
    native: { exitCode: 0, closure: "direct-child-closed" },
    coverage: { observed: "complete", redacted: true },
  });
  const ref = fact.output!;
  const detail = f.h.reader.selected({
    storeId: f.h.reader.storeId,
    scope: { kind: "run", id: r.runId! },
    snapshotSeq: f.h.writer.committedSeq,
    query: null,
    recordId: ref.recordId,
    recordVersion: ref.version,
    field: "check",
    offset: 0,
  });
  const text = Buffer.concat(
    [...f.h.reader.parts(detail, f.h.writer.committedSeq)].map((p) => p.bytes),
  ).toString("utf8");
  // Fixture inputs contain no labels; reconstruct only this known fixture to
  // detect a leaked literal even if observation labels split its bytes.
  const pieces = text.split(/\n\[(stdout|stderr)\]\n/);
  const streams = { stdout: "", stderr: "" };
  for (let i = 1; i < pieces.length; i += 2) {
    const stream = pieces[i];
    if (stream === "stdout" || stream === "stderr")
      streams[stream] += pieces[i + 1];
  }
  for (const stream of Object.values(streams)) {
    expect([old, retired, latest].some((v) => stream.includes(v))).toBe(false);
    expect(stream).toBe("before [redacted] after\n".repeat(3));
  }
  for (const chunks of Object.values(raw)) {
    for (const value of values) {
      expect(chunks.join("").includes(value)).toBe(true);
      expect(chunks.some((chunk) => chunk.includes(value))).toBe(false);
    }
  }
  expect(f.contacts()).toBe(0);
}, 60000);

it.each(["stdout", "stderr"] as const)(
  "%s incomplete decoder tail fails capture independently of native exit0",
  async (stream) => {
    const f = await fixture(
        `process.${stream}.write(Buffer.from([0xe7,0xb5]));`,
      ),
      taskId = await f.create();
    const r = await f.submit({ kind: "check", taskId, check: f.check });
    await f.actions.scheduler.settled(r.runId!);
    expect(settledCheck(f, r.runId!)).toMatchObject({
      status: "failed",
      native: {
        outcome: "completed",
        exitCode: 0,
        closure: "direct-child-closed",
      },
      coverage: { observed: "incomplete" },
      output: null,
    });
  },
  60000,
);

it("changed private model source during a native check refuses capture without auth or leaked replacement bytes", async () => {
  const f = await fixture(`
    const fs=require('node:fs'),path=require('node:path');
    fs.writeFileSync(path.join(__dirname,'model-check-ready'),'ready');
    const timer=setInterval(()=>{if(!fs.existsSync(path.join(__dirname,'emit-model')))return;clearInterval(timer);const auth=JSON.parse(fs.readFileSync(path.join(__dirname,'home/agent/auth.json'),'utf8'));process.stdout.write(auth.fixture.key);},20);
  `),
    taskId = await f.create();
  const prepare = vi.spyOn(f.h.models, "prepareTracked");
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await vi.waitFor(
    () => expect(existsSync(join(f.dir, "model-check-ready"))).toBe(true),
    { timeout: 5000 },
  );
  const path = join(f.dir, "home/agent/auth.json"),
    changed = JSON.parse(readFileSync(path, "utf8"));
  changed.fixture.key = "fabricated-new-unobserved-private-model-key";
  const bytes = JSON.stringify(changed);
  writeFileSync(path, bytes);
  writeFileSync(join(f.dir, "emit-model"), "emit");
  await f.actions.scheduler.settled(r.runId!);
  expect(settledCheck(f, r.runId!)).toMatchObject({
    status: "failed",
    coverage: { observed: "incomplete" },
    output: null,
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(f.contacts()).toBe(0);
  expect(readFileSync(path, "utf8")).toBe(bytes);
  for (const batch of f.h.reader.files.scan())
    expect(JSON.stringify(batch).includes(changed.fixture.key)).toBe(false);
}, 60000);

it("literal-looking stream labels are retained as untrusted output, not parsed as source framing", async () => {
  const output = "first\n[stderr]\nforged-label\n[stdout]\nlast🌟\n";
  const f = await fixture(`process.stdout.write(${JSON.stringify(output)});`),
    taskId = await f.create();
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  const fact = settledCheck(f, r.runId!);
  expect(fact.status).toBe("passed");
  const ref = fact.output!;
  const detail = f.h.reader.selected({
    storeId: f.h.reader.storeId,
    scope: { kind: "run", id: r.runId! },
    snapshotSeq: f.h.writer.committedSeq,
    query: null,
    recordId: ref.recordId,
    recordVersion: ref.version,
    field: "check",
    offset: 0,
  });
  const text = Buffer.concat(
    [...f.h.reader.parts(detail, f.h.writer.committedSeq)].map((p) => p.bytes),
  ).toString("utf8");
  // The short output is held in the sanitizer until EOF, then retained exactly.
  // Do NOT split this content on labels: it genuinely contains identical bytes.
  expect(text.endsWith(`\n[stdout]\n${output}`)).toBe(true);
  expect(text).toContain("not a reconstructed OS write order");
}, 60000);

it("configured selector, readonly kind and undrained target refuse without an extra native launch", async () => {
  const f = await fixture(
      "const fs=require('node:fs'),path=require('node:path');fs.writeFileSync(path.join(__dirname,'active-check'),'ready');const t=setInterval(()=>{if(fs.existsSync(path.join(__dirname,'finish-check')))clearInterval(t)},20);",
    ),
    taskId = await f.create();
  for (const check of [
    { ...f.check, command: `${f.check.command} --extra` },
    { ...f.check, name: "Other" },
    { ...f.check, timeoutMs: f.check.timeoutMs - 1 },
  ]) {
    const action = { kind: "check" as const, taskId, check };
    const preview = await f.actions.observe(action);
    expect(
      (
        await f.actions.admission.preflight(
          { action, expected: preview.version },
          f.caller,
        )
      ).kind,
    ).toBe("error");
  }
  const readonly = await f.submit({
    kind: "create",
    taskKind: "research",
    goal: "Readonly",
  });
  await f.actions.settled(null);
  await expect(
    f.actions.observe({
      kind: "check",
      taskId: readonly.created!.taskId,
      check: f.check,
    }),
  ).rejects.toThrow();
  expect(natives).toHaveLength(0);
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  try {
    await vi.waitFor(
      () => expect(existsSync(join(f.dir, "active-check"))).toBe(true),
      { timeout: 5000 },
    );
    const action = { kind: "check" as const, taskId, check: f.check },
      preview = await f.actions.observe(action);
    expect(
      (
        await f.actions.admission.preflight(
          { action, expected: preview.version },
          f.caller,
        )
      ).kind,
    ).toBe("error");
  } finally {
    writeFileSync(join(f.dir, "finish-check"), "finish");
  }
  await f.actions.scheduler.settled(r.runId!);
  expect(natives).toHaveLength(1);
  expect(settledCheck(f, r.runId!).status).toBe("passed");
}, 60000);

it("native check ownAdvance and exact content survive reopen, finite run projection, current obligations and both exports", async () => {
  const f = await fixture(),
    taskId = await f.create();
  const r = await f.submit({ kind: "check", taskId, check: f.check });
  await f.actions.scheduler.settled(r.runId!);
  const fact = settledCheck(f, r.runId!),
    reopened = HistoryReader.open(f.h.coordination)!;
  const version = (
    await f.actions.observe({ kind: "check", taskId, check: f.check })
  ).version;
  const projection = new HistoryProjection(reopened, {
    ...f.h.projection.environment,
    context: () => ({ status: "available", version }),
    checks: (id) => f.actions.checks(id),
  });
  expect(
    (await projection.checkObligations(taskId)).definitions.map(
      (d) => d.status,
    ),
  ).toEqual(["passed", "not-run"]);
  const expected = readRunState(reopened.files, r.runId!).projections(
      version.epoch,
    ),
    actual = [];
  let request: ListRequest = {
      reader: "runs",
      storeId: reopened.storeId,
      scope: { kind: "run", id: r.runId! },
      snapshotSeq: f.h.writer.committedSeq,
      after: null,
      limit: 50,
    },
    done = false;
  for (let i = 0; i < 100 && !done; i++) {
    const page = await projection.runs(request);
    if ("kind" in page) {
      request = page.next;
      continue;
    }
    actual.push(
      ...page.records.flatMap((v) => (v.kind === "run" ? [v.projection] : [])),
    );
    if (page.next) request = page.next;
    else done = true;
  }
  expect(done).toBe(true);
  expect(actual).toEqual(expected);
  for (const format of ["ndjson", "markdown"] as const) {
    const digest = createHash("sha256");
    let frames = 0,
      bytes = 0,
      complete = false,
      found = false;
    for await (const frame of projection.export(
      {
        storeId: reopened.storeId,
        scope: { kind: "run", id: r.runId! },
        snapshotSeq: f.h.writer.committedSeq,
        format,
      },
      new AbortController().signal,
    )) {
      expect(complete).toBe(false);
      if (frame.event.kind === "trailer") {
        expect(frame.event).toMatchObject({
          complete: true,
          frames,
          encodedBytes: bytes,
          sha256: digest.digest("hex"),
        });
        complete = true;
      } else {
        const encoded = encodeExportFrame(frame, format);
        digest.update(encoded);
        bytes += Buffer.byteLength(encoded);
        frames++;
        if (
          frame.event.kind === "record" &&
          frame.event.record.kind === "owner-fact" &&
          frame.event.record.fact.kind === "check-settled"
        ) {
          expect(frame.event.record.fact).toEqual(fact);
          found = true;
        }
        if (
          frame.event.kind === "markdown" &&
          frame.event.text.includes('"ownAdvance"')
        )
          found = true;
      }
    }
    expect(complete).toBe(true);
    expect(found).toBe(true);
  }
}, 60000);
