import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { CaptureBudgetPool } from "../src/service/contracts/budget.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import { OwnerModelContext } from "../src/service/model-context.ts";
import { ServiceOwner } from "../src/service/owner.ts";
import type { CaptureSink, PersistenceResult } from "../src/service/ports.ts";
import {
  legacyWorkerEnvelope,
  preparedWorker,
} from "../src/subagent-process.ts";
import {
  type CaptureBudget,
  canonicalJson,
  type DetailCommit,
  type DetailDescriptor,
  decodeCaptureFrame,
  decodeWorkerPublicRequest,
  publicError,
} from "../src/worker-public.mjs";
import { WorkerRecording } from "../src/worker-recording.ts";
import { captureSummary } from "./helpers/worker-v2.ts";

vi.mock("node:child_process", async (original) => {
  const value = await original<typeof import("node:child_process")>();
  return { ...value, spawn: vi.fn(value.spawn) };
});
const nativeSpawn = vi.mocked(spawn).getMockImplementation() as typeof spawn;

// Actual disk writes under a controllable gate, with the real shared lease pool.
// These fixture commit references are NOT W3 durability/ledger qualification.
function diskSink(path: string, gate: Promise<void>, batchMs = 0) {
  const pool = new CaptureBudgetPool();
  let seq = 0;
  const metrics = { maxBatchBytes: 0, appendAttempts: 0, batches: 0 };
  let fenced = false;
  const contents = new Map<
    string,
    { descriptor: DetailDescriptor; body: string }
  >();
  let writer = Promise.resolve();
  let queued: { write: () => Promise<void>; bytes: number }[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    const batch = queued;
    metrics.maxBatchBytes = Math.max(
      metrics.maxBatchBytes,
      batch.reduce((sum, item) => sum + item.bytes, 0),
    );
    metrics.batches++;
    queued = [];
    writer = writer.then(async () => {
      for (const item of batch) await item.write();
    });
  };
  const enqueue = (
    write: () => Promise<void>,
    bytes: number,
    control: boolean,
  ) => {
    if (
      queued.length &&
      queued.reduce((sum, item) => sum + item.bytes, 0) + bytes > 256 * 1024
    )
      flush();
    queued.push({ write, bytes });
    if (
      !batchMs ||
      control ||
      queued.reduce((sum, item) => sum + item.bytes, 0) >= 256 * 1024
    )
      flush();
    else timer ??= setTimeout(flush, batchMs);
  };
  const sink: CaptureSink = {
    reserve(budget: CaptureBudget) {
      try {
        const lease = pool.reserve(budget);
        return {
          status: "reserved",
          reservation: {
            grow(extra) {
              try {
                lease.grow(extra);
                return { status: "reserved" };
              } catch {
                return { status: "refused", error: publicError("capacity") };
              }
            },
            release() {
              lease.release();
            },
            async commit(input) {
              const value = lease.beginWorker(input);
              return new Promise((resolve, reject) =>
                enqueue(
                  async () => {
                    try {
                      await gate;
                      if (fenced) throw new Error("Fixture writer fenced");
                      const details: DetailCommit[] = [];
                      for (const { event } of value.events) {
                        if (event.kind === "detail-begin")
                          contents.set(event.detailId, {
                            descriptor: event.descriptor,
                            body: "",
                          });
                        if (event.kind === "stored-chunk")
                          contents.get(event.detailId)!.body += event.text;
                        if (event.kind === "stored-end") {
                          const content = contents.get(event.detailId)!;
                          details.push({
                            childRunId: input.link.childRunId,
                            detailId: event.detailId,
                            committedSeq: String(seq + 1),
                            content: {
                              recordId: randomUUID(),
                              version: 1,
                              field: content.descriptor.field,
                              bytes: Buffer.byteLength(content.body),
                              sha256: createHash("sha256")
                                .update(content.body)
                                .digest("hex"),
                            },
                          });
                        }
                      }
                      metrics.appendAttempts++;
                      await appendFile(path, `${canonicalJson(value)}\n`, {
                        mode: 0o600,
                      });
                      resolve({
                        status: "committed",
                        batch: {
                          committedSeq: String(++seq),
                          details,
                          ownerDetails: [],
                          coverage: {
                            observed: "complete",
                            source: "complete",
                            redacted: true,
                            omissions: [],
                          },
                        },
                      });
                    } catch (error) {
                      fenced = true;
                      reject(error);
                    } finally {
                      lease.settled();
                    }
                  },
                  Buffer.byteLength(canonicalJson(value)),
                  budget.lane === "control",
                ),
              );
            },
          },
        };
      } catch {
        return { status: "refused", error: publicError("capacity") };
      }
    },
  };
  return { sink, pool, contents, metrics };
}
for (const mode of ["instant", "stalled", "batched", "disk-error"] as const)
  it(`actual SDK producer / ${mode} disk fixture preserves original charges and native facts`, async () => {
    const slow = mode === "stalled";
    const root = mkdtempSync(join(tmpdir(), "cadence-w2-disk-"));
    const path =
      mode === "disk-error" ? root : join(root, "fixture-public.jsonl");
    const key = "fabricated-worker-canary",
      ownerToken = "fabricated-owner-only-canary";
    const expected = slow
      ? "x".repeat(512 * 1024)
      : `beyond-preview ${key} ${ownerToken} ${"x".repeat(mode === "batched" ? 2 * 1024 * 1024 : 32768)}`;
    let requests = 0;
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* Drain the actual request. */
      }
      requests++;
      expect(req.headers.authorization).toBe(`Bearer ${key}`);
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      const send = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      for (let at = 0; at < expected.length; at += 1024)
        send({ role: "assistant", content: expected.slice(at, at + 1024) });
      send({}, "stop");
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    let release = () => {};
    const gate = slow
      ? new Promise<void>((resolve) => {
          release = resolve;
        })
      : Promise.resolve();
    const fixture = diskSink(path, gate, mode === "batched" ? 100 : 0);
    const raw: Buffer[] = [];
    let nativeExit: number | null | undefined;
    let nativeClose = false;
    vi.mocked(spawn).mockImplementationOnce((command, args, options) => {
      const child = nativeSpawn(
        command,
        [
          "--import",
          new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url).href,
          ...(args ?? []),
        ],
        options,
      );
      child.stdout!.on("data", (part: Buffer) => raw.push(part));
      child.on("exit", (code) => {
        nativeExit = code;
      });
      child.on("close", () => {
        nativeClose = true;
      });
      return child;
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("Fixture unavailable");
      const model = {
        id: "fixture-model",
        name: "Fixture",
        provider: "fixture",
        api: "openai-completions" as const,
        baseUrl: `http://127.0.0.1:${address.port}/v1`,
        reasoning: false,
        input: ["text" as const],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 8192,
        maxTokens: 4096,
      };
      const envelope = legacyWorkerEnvelope({
        cwd: root,
        model,
        kind: "research",
        auth: { ok: true, apiKey: key },
        instructions: "Synthetic fixture",
        prompt: "Answer the fixture",
      });
      const link = {
        epoch: randomUUID(),
        taskId: envelope.request.taskId,
        runId: envelope.request.runId,
        childRunId: envelope.request.childRunId,
      };
      let consumed = false;
      const prepared = preparedWorker(
        {
          consume(encode, use) {
            expect(consumed).toBe(false);
            consumed = true;
            const encoded = encode({ ...envelope, model });
            expect(encoded).not.toContain(ownerToken);
            return use(encoded);
          },
        },
        envelope.request,
        link,
        [ownerToken],
        15000,
      );
      const result = await prepared.launch(
        new AbortController().signal,
        fixture.sink,
      );
      expect(consumed).toBe(true);
      if (mode === "disk-error") expect(requests).toBeLessThanOrEqual(1);
      else expect(requests).toBe(1);
      expect(nativeClose).toBe(true);
      expect(result.native.exitCode).toBe(nativeExit);
      const stdout = Buffer.concat(raw).toString("utf8");
      expect(stdout).not.toContain(key);
      if (mode === "disk-error") {
        expect(result.recording.status).toBe("uncertain");
        expect(fixture.metrics.appendAttempts).toBe(1); // genuine EISDIR, no write retry
        expect(result.native.outcome).not.toBe("completed");
        expect(fixture.pool.accounting.leases).toBe(0);
      } else if (slow) {
        expect(result.recording.status).not.toBe("committed");
        expect(fixture.pool.accounting.bytes).toBeGreaterThan(0); // ORIGINAL pending write not refunded.
        release();
        const deadline = Date.now() + 5000;
        while (fixture.pool.accounting.leases && Date.now() < deadline)
          await new Promise((resolve) => setTimeout(resolve, 10));
        expect(fixture.pool.accounting.leases).toBe(0);
        expect(result.recording.status).not.toBe("committed"); // no retroactive success
      } else {
        expect(result.native).toMatchObject({
          outcome: "completed",
          closure: "direct-child-closed",
          exitCode: 0,
          stdin: "delivered",
          final: "valid",
          cleanup: "settled",
        });
        expect(result.recording.status).toBe("committed");
        expect(fixture.metrics.maxBatchBytes).toBeLessThanOrEqual(256 * 1024);
        expect(fixture.metrics.batches).toBeGreaterThan(0);
        captureSummary(stdout);
        expect(stdout).toContain(ownerToken); // Owner secret intentionally never sent to worker.
        const stored = readFileSync(path, "utf8");
        expect(stored).not.toContain(ownerToken);
        expect(stored).not.toContain(key);
        const body = fixture.contents.get(result.selected!.detailId)!.body;
        expect(body).toBe(
          expected
            .replaceAll(key, "[redacted]")
            .replaceAll(ownerToken, "[redacted]"),
        );
        expect(fixture.pool.accounting.leases).toBe(0);
      }
    } finally {
      release();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);

// Public decoder/owner projection injection, not an SDK media-provider lane.
it("owner metadata redaction covers omitted source type and MIME before disk", async () => {
  const root = mkdtempSync(join(tmpdir(), "cadence-w2-metadata-"));
  const path = join(root, "public.jsonl");
  const fixture = diskSink(path, Promise.resolve());
  const link = {
    epoch: randomUUID(),
    taskId: randomUUID(),
    runId: randomUUID(),
    childRunId: randomUUID(),
  };
  let stopped = false;
  const recorder = new WorkerRecording(
    link,
    fixture.sink,
    ["owner-canary"],
    () => {
      stopped = true;
    },
  );
  const frame = decodeCaptureFrame({
    protocol: 2,
    childRunId: link.childRunId,
    workerSeq: 1,
    observedMs: 0,
    event: {
      kind: "omitted-block",
      block: {
        owner: {
          kind: "message",
          messageId: randomUUID(),
          blockId: randomUUID(),
          index: 0,
          stage: "final",
        },
        sourceType: "image",
        mimeType: "image/owner-canary",
        reason: "binary",
      },
    },
  });
  recorder.accept(
    frame,
    recorder.reserveRaw(Buffer.byteLength(canonicalJson(frame))),
  );
  await recorder.drain();
  recorder.closeIngress();
  expect(stopped).toBe(false);
  expect(readFileSync(path, "utf8")).not.toContain("owner-canary");
  expect(fixture.pool.accounting.leases).toBe(0);
});

for (const scenario of [
  "native",
  "large-envelope",
  "missing-sink",
  "request-mismatch",
  "canceled",
  "changed-reserve",
] as const)
  it(`real PreparedModelContext.consume composition: ${scenario}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-w2-consume-"));
    const cwd = join(root, "workspace");
    mkdirSync(cwd);
    const home = join(root, "home"),
      agentDir = join(home, ".pi", "agent");
    mkdirSync(agentDir, { recursive: true, mode: 0o700 });
    const key =
      scenario === "large-envelope"
        ? "f".repeat(20000)
        : "fabricated-real-preparation-canary";
    let requests = 0;
    const server = createServer(
      { maxHeaderSize: 64 * 1024 },
      async (req, res) => {
        for await (const _chunk of req) {
          /* Genuine request drain. */
        }
        requests++;
        expect(req.headers.authorization).toBe(`Bearer ${key}`);
        res.writeHead(200, {
          "content-type": "text/event-stream",
          connection: "close",
        });
        for (const [delta, finish_reason] of [
          [{ role: "assistant", content: "PREPARED_NATIVE_OK" }, null],
          [{}, "stop"],
        ])
          res.write(
            `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        res.end("data: [DONE]\n\n");
      },
    );
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture");
    writeFileSync(
      join(agentDir, "auth.json"),
      JSON.stringify({ fixture: { type: "api_key", key } }),
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
    const coordination = new ServiceCoordination(cwd, join(root, "state"));
    const config = {
      schema: "cadence-service-owner-config/1" as const,
      endpoint: "http://127.0.0.1:17423",
      policyIdentity: "a".repeat(64),
    };
    coordination.initialize(config);
    const lease = coordination.acquire(config);
    // Real W1 SDK/file preparation; auth journal receipts are explicit injections.
    const committed: PersistenceResult = {
      status: "committed",
      batch: {
        committedSeq: "1",
        details: [],
        ownerDetails: [],
        coverage: {
          observed: "complete",
          source: "complete",
          redacted: false,
          omissions: [],
        },
      },
    };
    const owner = new ServiceOwner(lease, {
      quiesce() {},
      flush: async () => committed,
      closeListener: async () => {},
    });
    const accounting: string[] = [];
    let spawns = 0,
      inputBytes = 0,
      originalClose = false,
      eof = 0;
    const previous = vi.mocked(spawn).getMockImplementation();
    vi.mocked(spawn).mockImplementation((command, args, options) => {
      spawns++;
      expect(accounting).toEqual(["intent", "settled"]);
      const child = nativeSpawn(
        command,
        [
          "--import",
          new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url).href,
          ...(args ?? []),
        ],
        options,
      );
      const end = child.stdin!.end;
      child.stdin!.end = function (...args: unknown[]) {
        const input = args[0];
        if (typeof input !== "string")
          throw new Error("Fixture input required");
        inputBytes = Buffer.byteLength(input);
        expect(inputBytes).toBeLessThanOrEqual(128 * 1024);
        expect(JSON.parse(input).auth.apiKey).toBe(key);
        return Reflect.apply(end, this, args);
      };
      child.stdout!.on("end", () => eof++);
      child.stderr!.on("end", () => eof++);
      child.on("close", () => {
        originalClose = true;
      });
      return child;
    });
    try {
      // Isolated Vitest worker's explicit DIRECT fixture; service auth must
      // refuse ambient routing, not silently inherit the developer's route.
      for (const key of [
        "http_proxy",
        "https_proxy",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "all_proxy",
        "NO_PROXY",
        "no_proxy",
        "NODE_USE_ENV_PROXY",
        "NODE_OPTIONS",
      ])
        vi.stubEnv(key, undefined);
      const context = new OwnerModelContext({
        home,
        cwd,
        agentDir,
        environment: { HOME: home, USERPROFILE: home },
        owner,
        accounting: {
          preparation: async () => {
            accounting.push("intent");
            return committed;
          },
          settlement: async () => {
            accounting.push("settled");
            return committed;
          },
        },
      });
      await context.load();
      const model = context.select({
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      });
      const request = decodeWorkerPublicRequest({
        protocol: 2,
        taskId: randomUUID(),
        taskKind: "research",
        runId: randomUUID(),
        childRunId: randomUUID(),
        assignmentId: "one",
        purpose: "research",
        model,
        role: { role: "design-explorer", sha256: "a".repeat(64) },
        context: scenario === "large-envelope" ? "x".repeat(32768) : "",
        instructions:
          scenario === "large-envelope" ? "x".repeat(16384) : "Fixture only",
        prompt: scenario === "large-envelope" ? "x".repeat(32768) : "Inspect",
        handoff: { graphRevision: 1, inputs: [] },
      });
      const prepared = await context.prepare({
        request,
        operationId: randomUUID(),
        epoch: lease.registration.epoch,
        timeoutMs: 15000,
        signal: new AbortController().signal,
        current: () => true,
      });
      if (prepared.status !== "prepared")
        throw new Error("Fixture preparation refused");
      const fixture = diskSink(
        join(root, "recorded.jsonl"),
        Promise.resolve(),
        100,
      );
      const port = preparedWorker(
        prepared.prepared,
        scenario === "request-mismatch"
          ? { ...request, prompt: "Changed" }
          : request,
        {
          epoch: lease.registration.epoch,
          taskId: request.taskId,
          runId: request.runId,
          childRunId: request.childRunId,
        },
        [],
        15000,
      );
      if (scenario === "changed-reserve") {
        const reserve = fixture.sink.reserve;
        fixture.sink.reserve = (budget) => {
          writeFileSync(
            join(agentDir, "auth.json"),
            JSON.stringify({
              fixture: { type: "api_key", key: "changed-fabricated-key" },
            }),
            { mode: 0o600 },
          );
          return reserve(budget);
        };
      }
      const signal = new AbortController();
      if (scenario === "canceled") signal.abort();
      const result =
        scenario === "missing-sink"
          ? await Reflect.apply(port.launch, port, [signal.signal, undefined])
          : await port.launch(signal.signal, fixture.sink);
      if (scenario === "native" || scenario === "large-envelope") {
        expect(result.native).toMatchObject({
          outcome: "completed",
          exitCode: 0,
          closure: "direct-child-closed",
          stdin: "delivered",
        });
        expect(result.recording.status).toBe("committed");
        expect(spawns).toBe(1);
        expect(inputBytes).toBeGreaterThan(
          scenario === "large-envelope" ? 96 * 1024 : 0,
        );
        expect(originalClose).toBe(true);
        expect(eof).toBe(2);
        expect(requests).toBe(1);
        const again = await port.launch(
          new AbortController().signal,
          fixture.sink,
        );
        expect(again.native.closure).toBe("not-launched");
        expect(spawns).toBe(1);
      } else {
        expect(result.native.closure).toBe("not-launched");
        expect(result.recording.status).toBe("refused");
        expect(spawns).toBe(0);
        expect(requests).toBe(0);
      }
      expect(fixture.pool.accounting.leases).toBe(0);
    } finally {
      if (previous) vi.mocked(spawn).mockImplementation(previous);
      vi.unstubAllEnvs();
      await owner.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);
