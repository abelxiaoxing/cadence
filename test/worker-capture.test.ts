import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { expect, it, vi } from "vitest";
import {
  legacyWorkerEnvelope,
  runProcess,
  safeChildEnv,
} from "../src/subagent-process.ts";
import {
  CaptureEmitter,
  CaptureQueue,
  CaptureState,
  SdkCapture,
} from "../src/worker-capture.mjs";
import {
  type CaptureEvent,
  LIMITS,
  type NativeSettlement,
} from "../src/worker-public.mjs";
import {
  DetailSanitizer,
  sanitizeData,
  TextSanitizer,
} from "../src/worker-redaction.mjs";
import { captureBash, ToolIngress } from "../src/worker-tools.mjs";
import { v2Frames } from "./helpers/worker-v2.ts";

it("incremental text redacts split literals, heuristic values and terminal sequences", () => {
  const input =
    "safe 秘密-canary tail Bearer another-token\npassword=abc123 end https://user:pass@example.test/a\x1b[31mRED";
  for (let size = 1; size <= 70; size++) {
    const redactor = new TextSanitizer(["秘密-canary"]);
    let output = "";
    for (let at = 0; at < input.length; at += size)
      output += redactor.write(input.slice(at, at + size));
    output += redactor.end();
    expect(output).toBe(
      "safe [redacted] tail Bearer [redacted]\npassword=[redacted] end https://[redacted]@example.test/aRED",
    );
  }
});
it("heuristic suffix never emits a split Unicode pair through worker and owner projections", () => {
  // Native PTY's long advisory text exposed a 64-code-unit tail cut at 🧪.
  // Each emission must be valid independently, not only after concatenation.
  const text = Array.from(
    { length: 40 },
    (_, i) =>
      `Plan ${i + 1}: inspect 中文 🧪 and write fixture.txt only; preserve existing dirt.`,
  ).join("\n");
  for (let size = 1; size <= 140; size++) {
    const worker = new TextSanitizer(),
      owner = new DetailSanitizer("utf8");
    let output = "";
    const feed = (chunk: string) => {
      expect(Buffer.from(chunk).toString("utf8")).toBe(chunk);
      const projected = owner.write(chunk);
      expect(Buffer.from(projected).toString("utf8")).toBe(projected);
      output += projected;
    };
    for (let at = 0; at < text.length; at += size)
      feed(worker.write(text.slice(at, at + size)));
    feed(worker.end());
    const tail = owner.end();
    expect(Buffer.from(tail).toString("utf8")).toBe(tail);
    expect(output + tail).toBe(text);
  }
});
it("Unicode suffix retention preserves longest secret prefixes and never emits invalid UTF-8", () => {
  const secrets = ["🔐canary", "🔐canary-long"];
  const prefix = "漢🧪".repeat(40);
  const text = `${prefix} 🔐canary-long / 🔐canary tail token=hidden-value\nend🧪`;
  for (let size = 1; size <= 80; size++) {
    const worker = new TextSanitizer(secrets),
      owner = new DetailSanitizer("utf8", secrets);
    let output = "";
    const feed = (chunk: string) => {
      expect(Buffer.from(chunk).toString("utf8")).toBe(chunk);
      const projected = owner.write(chunk);
      expect(Buffer.from(projected).toString("utf8")).toBe(projected);
      output += projected;
    };
    for (let i = 0; i < text.length; i += size)
      feed(worker.write(text.slice(i, i + size)));
    feed(worker.end());
    output += owner.end();
    expect(output).toBe(
      `${prefix} [redacted] / [redacted] tail token=[redacted]\nend🧪`,
    );
    expect(output).not.toContain("canary");
    expect(output).not.toContain("hidden-value");
  }
});
it("structured own-data and owner escaped JSON use the same secret policy", () => {
  let getters = 0;
  expect(() =>
    sanitizeData({
      get content() {
        getters++;
        return "unsafe";
      },
    }),
  ).toThrow();
  expect(getters).toBe(0);
  const input =
    '{"body":"hello \\u0073ecret-canary world","list":[true,2,null],"password":{"nested":"private"}}';
  for (let size = 1; size < 32; size++) {
    const sanitizer = new DetailSanitizer("canonical-json", ["secret-canary"]);
    let output = "";
    for (let i = 0; i < input.length; i += size)
      output += sanitizer.write(input.slice(i, i + size));
    output += sanitizer.end();
    expect(JSON.parse(output)).toEqual({
      password: "[redacted]",
      body: "hello [redacted] world",
      list: [true, 2, null],
    });
  }
});
it("original-wire state refuses wrong hashes, wrong final references and orphan chunks", () => {
  const id = randomUUID();
  const state = new CaptureState(id);
  const event = (event: unknown) =>
    state.accept({
      protocol: 2,
      childRunId: id,
      workerSeq: state.position.workerSeq + 1,
      observedMs: 0,
      event,
    });
  event({ kind: "ready", requestProtocol: 2 });
  const saturated = new CaptureState(randomUUID());
  saturated.bytes = LIMITS.childProtocolBytes; // Labelled arithmetic injection, not native 128MiB emission.
  expect(() =>
    saturated.accept({
      protocol: 2,
      childRunId: saturated.position.childRunId,
      workerSeq: 1,
      observedMs: 0,
      event: { kind: "ready", requestProtocol: 2 },
    }),
  ).toThrow();
  expect(() =>
    event({
      kind: "detail-chunk",
      detailId: randomUUID(),
      offset: 0,
      text: "bad",
    }),
  ).toThrow();
});
for (const partial of [
  '{"path":"fixture"}',
  '{"path":"unfinished',
  '{"path":invalid',
])
  it(`injected SDK stream/final differences and unexecuted declaration prefix: ${partial}`, async () => {
    let raw = "";
    const output = new Writable({
      write(chunk, _encoding, callback) {
        raw += chunk;
        callback();
      },
    });
    const emitter = new CaptureEmitter(randomUUID(), output, () => {
      throw new Error("unexpected");
    });
    const capture = new SdkCapture(emitter, ["split-canary"]);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    await capture.event({
      type: "message_start",
      message: { role: "assistant" },
    });
    for (const delta of ["split-", "canary"])
      await capture.event({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta },
      });
    await capture.event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex: 1,
        delta: partial,
        partial: {
          content: [
            { type: "text", text: "stream" },
            { type: "toolCall", name: "read", arguments: {} },
          ],
        },
      },
    });
    await capture.event({
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "stop",
        content: [
          { type: "text", text: "final only" },
          {
            type: "toolCall",
            id: "assigned-late",
            name: "read",
            arguments: { path: "fixture" },
          },
          {
            type: "thinking",
            get thinking() {
              throw new Error("opaque");
            },
          },
        ],
      },
    });
    await capture.final();
    expect(raw).not.toContain("split-canary");
    expect(raw).not.toContain('"text":"split-"');
    expect(emitter.state.preview).toBe("final only");
    expect(emitter.state.coverage.omissions).toContain("hidden-thinking");
    const events = raw
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line).event);
    const declarations = events.filter(
      (event) => event.kind === "call-declaration",
    );
    expect(declarations).toHaveLength(2);
    expect(declarations.map((d) => d.stage)).toEqual(["partial", "final"]);
    expect(declarations[0].callId).toBe(declarations[1].callId);
    expect(declarations[0].declaration).toEqual(declarations[1].declaration);
    expect(declarations[0].source.disposition).toBe("unavailable");
    expect(declarations[1].source.value).toBe("assigned-late");
    expect(events.some((event) => event.kind === "tool-start")).toBe(false);
  });

for (const tool of [false, true, "invalid-utf8" as const])
  it(`actual v2 SDK/native capture and custom bash: tool=${tool}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-w2-producer-"));
    const canary = "fabricated-capture-canary";
    let requests = 0;
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const parsed = JSON.parse(body);
      requests++;
      expect(req.headers.authorization).toBe(`Bearer ${canary}`);
      expect(parsed.model).toBe("fixture-model");
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      const send = (delta: unknown, finish_reason: string | null = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      if (tool && requests === 1) {
        send({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "bash_fixture",
              type: "function",
              function: {
                name: "bash",
                arguments: JSON.stringify({
                  command:
                    tool === "invalid-utf8"
                      ? "printf '\\377'"
                      : "printf 'fabricated-capture-canary'; i=0; while [ \"$i\" -lt 4096 ]; do printf 'bash-public-output\\n'; i=$((i+1)); done",
                }),
              },
            },
          ],
        });
        send({}, "tool_calls");
      } else {
        if (tool) {
          const results = parsed.messages.filter(
            (message: { role: string }) => message.role === "tool",
          );
          expect(results).toHaveLength(1);
          const actual = String(results[0].content);
          expect(actual).toBe(
            `[redacted]${"bash-public-output\n".repeat(4096)}`,
          );
          expect(actual).not.toContain(canary);
        }
        send({ role: "assistant", content: "CAPTURE_OK" });
        send({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("fixture");
      const material = legacyWorkerEnvelope({
        cwd: root,
        kind: tool ? "code" : "research",
        instructions: "Synthetic fixture only",
        prompt: "Answer CAPTURE_OK",
        auth: { ok: true, apiKey: canary },
        model: {
          id: "fixture-model",
          name: "Fixture",
          provider: "fixture",
          api: "openai-completions",
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: 8192,
          maxTokens: 4096,
        },
      });
      let native: NativeSettlement | undefined;
      const accountingPath = `${root}.accounting.json`;
      const result = await runProcess({
        command: process.execPath,
        args: [
          "--import",
          new URL(
            tool
              ? "./helpers/worker-accounting-preload.mjs"
              : "./helpers/lightweight-sdk-guard.mjs",
            import.meta.url,
          ).href,
          fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
        ],
        cwd: root,
        timeoutMs: 15000,
        signal: new AbortController().signal,
        env: {
          ...safeChildEnv(),
          ...(tool ? { CADENCE_W2_OBSERVATION: accountingPath } : {}),
        },
        onNative: (facts) => {
          native = facts;
        },
        protocol: true,
        childRunId: material.request.childRunId,
        input: JSON.stringify(material),
      });
      // Fixed fixture-only facts, separately from stdout protocol and diagnostics.
      // Preserve these even when the original positive assertion fails.
      let accounting = {
        first: "unavailable",
        bash: {},
        queue: { bytes: -1 },
        ingress: -1,
        entered: -1,
        settled: -2,
      };
      let observationAvailable = false;
      try {
        if (tool) accounting = JSON.parse(readFileSync(accountingPath, "utf8"));
        writeFileSync(
          `${root}.native.json`,
          JSON.stringify({ native, requests, accounting }),
          { mode: 0o600, flag: "wx" },
        );
        observationAvailable = true;
      } catch {
        /* never replace the original result assertion */
      }
      if (tool === "invalid-utf8") {
        expect(result).toMatchObject({
          outcome: "failed",
          closed: true,
          exitCode: 1,
          signal: null,
        });
        expect(requests).toBe(1);
        expect(readdirSync(root)).toEqual([]);
        return;
      }
      expect(result).toMatchObject({
        outcome: "completed",
        closed: true,
        exitCode: 0,
        text: "CAPTURE_OK",
        output: "",
      });
      expect(requests).toBe(tool ? 2 : 1);
      expect(readdirSync(root)).toEqual([]);
      expect(observationAvailable).toBe(true);
      expect(native).toMatchObject({
        stdin: "delivered",
        final: "valid",
        closure: "direct-child-closed",
      });
      if (tool) {
        expect(accounting.first).toBeNull();
        expect(accounting.bash).toMatchObject({
          launches: 1,
          totalBytes: 77849,
          exitObserved: true,
          exitCode: 0,
          closeObserved: true,
          signalObserved: false,
        });
        expect(accounting.queue.bytes).toBe(0);
        expect(accounting.ingress).toBe(0);
        expect(accounting.entered).toBe(accounting.settled);
      }
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);

it("shared native decoder rejects changed hash, sequence, detail ownership and selected final", () => {
  const frames = v2Frames("exact final")
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line));
  for (const mutation of ["hash", "sequence", "owner", "selection"]) {
    const altered = structuredClone(frames);
    if (mutation === "hash")
      altered.find((f) => f.event.kind === "detail-end").event.sha256 =
        "0".repeat(64);
    if (mutation === "sequence") altered[2].workerSeq++;
    if (mutation === "owner")
      altered.find(
        (f) => f.event.kind === "detail-begin",
      ).event.descriptor.owner.messageId = randomUUID();
    if (mutation === "selection") altered.at(-1).event.detailId = randomUUID();
    const state = new CaptureState(frames[0].childRunId);
    expect(() => {
      for (const frame of altered) state.accept(frame);
    }).toThrow();
  }
});

it("actual emitter queue retains outstanding write charges and preserves failure-control headroom", async () => {
  let held = false,
    release: (() => void) | undefined;
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      if (held) release = callback;
      else callback();
    },
  });
  const emitter = new CaptureEmitter(randomUUID(), stream, () => {});
  const detailId = randomUUID();
  await emitter.emit({ kind: "ready", requestProtocol: 2 });
  await emitter.emit({
    kind: "detail-begin",
    detailId,
    descriptor: {
      owner: { kind: "context", component: "request-context" },
      field: "context",
      encoding: "utf8",
    },
  });
  held = true;
  let accepted = 0;
  expect(() => {
    for (let n = 0; n < LIMITS.workerQueueFrames + 1; n++) {
      void emitter
        .emit({ kind: "detail-chunk", detailId, offset: accepted, text: "x" })
        .catch(() => {});
      accepted++;
    }
  }).toThrow();
  expect(accepted).toBe(LIMITS.workerQueueFrames - LIMITS.controlFrames);
  expect(emitter.queuedBytes).toBeGreaterThan(0);
  const failure = emitter.emit({ kind: "worker-failure", code: "capture" });
  held = false;
  release!();
  await failure;
  await emitter.drain();
  expect(emitter.queuedBytes).toBe(0);
}); // New 100,000-frame CPU boundary, not a retimed SDK/native lane.

for (const sourceId of [undefined, null, "same-id", "unsafe source secret"])
  it(`injected genuine occurrence vectors: ${String(sourceId)}`, async () => {
    let raw = "";
    const emitter = new CaptureEmitter(
      randomUUID(),
      new Writable({
        write(chunk, _enc, callback) {
          raw += chunk;
          callback();
        },
      }),
      () => {},
    );
    const capture = new SdkCapture(emitter, ["secret"]);
    await emitter.emit({ kind: "ready", requestProtocol: 2 });
    // Actual observed end with no start: an orphan, never a fabricated launch.
    await capture.event({
      type: "tool_execution_end",
      toolCallId: sourceId,
      toolName: "read",
      result: { content: [{ type: "text", text: "orphan-result" }] },
      isError: true,
    });
    for (let n = 0; n < 2; n++) {
      await capture.event({
        type: "message_start",
        message: { role: "assistant" },
      });
      await capture.event({
        type: "message_end",
        message: {
          role: "assistant",
          stopReason: "toolUse",
          content: [
            {
              type: "toolCall",
              id: sourceId,
              name: "read",
              arguments: { path: "fixture" },
            },
          ],
        },
      });
      await capture.event({
        type: "tool_execution_start",
        toolCallId: sourceId,
        toolName: "read",
        args: { path: "fixture" },
      });
      await capture
        .event({
          type: "tool_execution_update",
          toolCallId: sourceId ?? `absent-${n}`,
          toolName: "read",
          partialResult: { content: [{ type: "text", text: "snapshot" }] },
        })
        .catch((error) => {
          if (sourceId != null) throw error;
        });
      await capture.event({
        type: "tool_execution_end",
        toolCallId: sourceId,
        toolName: "read",
        result: { content: [{ type: "text", text: "result" }] },
        isError: false,
      });
    }
    const events = raw
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line).event);
    const ends = events.filter((e) => e.kind === "tool-end");
    expect(ends[0]).toMatchObject({
      association: "orphan",
      startObserved: false,
      isError: true,
    });
    expect(new Set(ends.map((e) => e.callId)).size).toBe(3);
    expect(events.filter((e) => e.kind === "tool-start")).toHaveLength(2);
    if (sourceId == null)
      expect(ends.every((e) => !e.startObserved)).toBe(true);
    else
      expect(
        ends
          .slice(1)
          .every((e) => e.association === "declared" && e.startObserved),
      ).toBe(true);
    expect(raw).not.toContain("unsafe source secret");
  });

for (const partial of [
  '{"path":"safe',
  '{"password":"hidden-value',
  '{"path":invalid',
])
  it(`unfinished/malformed public argument prefix is retained, not a final-JSON refusal: ${partial}`, () => {
    const sanitizer = new DetailSanitizer("canonical-json", [], true);
    let output = "";
    for (const ch of partial) output += sanitizer.write(ch);
    output += sanitizer.end();
    expect(output).not.toContain("hidden-value");
    expect(output).toContain(
      partial.includes("password") ? "[redacted]" : "path",
    );
  });
it("finalized block projection and selected text have identical sanitized bytes", async () => {
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(_chunk, _enc, callback) {
        callback();
      },
    }),
    () => {},
  );
  const capture = new SdkCapture(emitter);
  await emitter.emit({ kind: "ready", requestProtocol: 2 });
  await capture.event({
    type: "message_start",
    message: { role: "assistant" },
  });
  await capture.event({
    type: "message_end",
    message: {
      role: "assistant",
      stopReason: "stop",
      content: [
        { type: "text", text: "token=" },
        { type: "text", text: "ordinary" },
      ],
    },
  });
  await capture.final();
  expect(emitter.state.preview).toBe("token=[redacted]ordinary");
});

for (const callback of ["pending", "throws", "rejects"] as const)
  it(`synchronous non-awaited tool ingress retains original charges: ${callback}`, async () => {
    const queue = new CaptureQueue();
    let failures = 0;
    const ingress = new ToolIngress(
      ["secret-canary"],
      () => {
        failures++;
      },
      queue,
    );
    const copies: unknown[] = [];
    const tools = ingress.wrap([
      {
        name: "fixture",
        label: "Fixture",
        description: "Injected public tool",
        parameters: Type.Object({}),
        async execute(_id, _args, _signal, update) {
          for (let index = 0; index < 200; index++)
            update?.({
              content: [
                { type: "text", text: `secret-canary${"x".repeat(8192)}` },
              ],
              details: {},
            });
          return { content: [{ type: "text", text: "result" }], details: {} };
        },
      },
    ]);
    const original = tools[0].execute(
      "id",
      {},
      new AbortController().signal,
      (value) => {
        copies.push(value);
        if (callback === "throws") throw new Error("opaque-secret-error");
        if (callback === "rejects")
          return Promise.reject(new Error("opaque-secret-error"));
      },
    );
    // No subscriber yield yet: accounting already excludes further source copies.
    expect(copies.length).toBeGreaterThan(0);
    expect(copies.length).toBeLessThan(200);
    expect(ingress.frames).toBe(copies.length);
    expect(queue.bytes).toBeGreaterThan(0);
    expect(queue.bytes).toBeLessThanOrEqual(LIMITS.workerQueueBytes);
    await original;
    expect(failures).toBeGreaterThan(0);
    expect(JSON.stringify(copies)).not.toContain("secret-canary");
    for (const partialResult of copies)
      ingress.release({ type: "tool_execution_update", partialResult });
    expect(ingress.frames).toBe(0);
    expect(queue.bytes).toBe(0);
  });
it("custom bash accumulator participates in the shared bound before append; no spill/retry", async () => {
  const queue = new CaptureQueue();
  let failed = 0,
    runs = 0,
    aborted = false;
  const tool = captureBash(
    "fixture",
    [],
    () => {
      failed++;
    },
    () => ({
      async exec(_command, _cwd, options) {
        runs++;
        for (let index = 0; index < 200; index++)
          options.onData(Buffer.alloc(32768, 120));
        aborted = options.signal?.aborted === true;
        return { exitCode: 0 };
      },
    }),
    queue,
  );
  await expect(
    Reflect.apply(tool.execute, tool, [
      "id",
      { command: "injected output" },
      new AbortController().signal,
    ]),
  ).rejects.toThrow();
  expect(runs).toBe(1);
  expect(aborted).toBe(true);
  expect(failed).toBeGreaterThan(0);
  expect(queue.bytes).toBe(0);
});
for (const suffix of ["\\u00", "\\q", '"oops":'])
  it(`malformed partial suffix is explicit limited observation without escaped secret: ${suffix}`, () => {
    const sanitizer = new DetailSanitizer("canonical-json", ["canary"], true);
    const input = `{"password":"hidden-value${suffix}`;
    let output = "";
    for (const ch of input) output += sanitizer.write(ch);
    output += sanitizer.end();
    expect(output).not.toContain("hidden-value");
    expect(output).not.toContain("canary");
    expect(sanitizer.redacted).toBe(true);
  });

it("escaped malformed unquoted partial values are omissions, not public escaped secrets", () => {
  const sanitizer = new DetailSanitizer("canonical-json", ["canary"], true);
  const input = '{"path":\\u0063anary';
  let output = "";
  for (const ch of input) output += sanitizer.write(ch);
  output += sanitizer.end();
  expect(output).not.toContain("\\u0063anary");
  expect(sanitizer.limited).toBe(true);
  expect(sanitizer.redacted).toBe(true);
});

it("wire tool start cannot replace the declaration's observed source identity", () => {
  const childRunId = randomUUID(),
    messageId = randomUUID(),
    callId = randomUUID();
  const declaration = { messageId, blockId: randomUUID() };
  const state = new CaptureState(childRunId);
  const send = (event: unknown) =>
    state.accept({
      protocol: 2,
      childRunId,
      workerSeq: state.position.workerSeq + 1,
      observedMs: 0,
      event,
    });
  send({ kind: "ready", requestProtocol: 2 });
  send({
    kind: "message-start",
    messageId,
    role: "assistant",
    source: { disposition: "unavailable", value: null },
    resultCallId: null,
  });
  send({
    kind: "call-declaration",
    callId,
    declaration,
    index: 0,
    source: { disposition: "observed", value: "original" },
    name: "read",
    argsDetailId: null,
    stage: "final",
  });
  expect(() =>
    send({
      kind: "tool-start",
      callId,
      declaration,
      source: { disposition: "observed", value: "different" },
      name: "read",
      argsDetailId: null,
    }),
  ).toThrow();
});

it("ordinary simultaneous partial declarations do not spend megabyte leases on empty JSON state", async () => {
  const emitter = new CaptureEmitter(
    randomUUID(),
    new Writable({
      write(_chunk, _encoding, callback) {
        callback();
      },
    }),
    () => {},
  );
  const capture = new SdkCapture(emitter);
  await emitter.emit({ kind: "ready", requestProtocol: 2 });
  await capture.event({
    type: "message_start",
    message: { role: "assistant" },
  });
  const content = Array.from({ length: 5 }, (_, index) => ({
    type: "toolCall",
    id: `call-${index}`,
    name: "read",
    arguments: { path: "fixture" },
  }));
  for (let contentIndex = 0; contentIndex < content.length; contentIndex++)
    await capture.event({
      type: "message_update",
      assistantMessageEvent: {
        type: "toolcall_delta",
        contentIndex,
        delta: '{"path":"fixture"}',
        partial: { content },
      },
    });
  await capture.event({
    type: "message_end",
    message: { role: "assistant", content, stopReason: "stop" },
  });
  await capture.final();
  expect(emitter.queue.bytes).toBe(0);
});

// Actual HTTP failure and public SDK, not an injected successful transcript.
it("a provider HTTP error retains its error message and reports prompt failure, not capture corruption", async () => {
  const cwd = mkdtempSync(join(tmpdir(), "cadence-prompt-failure-"));
  const key = "fabricated-prompt-failure-canary";
  let contacts = 0;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* bounded fixture request drain */
    }
    contacts++;
    res.writeHead(400, {
      "content-type": "application/json",
      connection: "close",
    });
    res.end(
      JSON.stringify({ error: { message: `fabricated failure ${key}` } }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture");
  const material = legacyWorkerEnvelope({
    cwd,
    kind: "research",
    instructions: "Readonly fixture",
    prompt: "Observe the failure",
    auth: { ok: true, apiKey: key },
    model: {
      id: "fixed",
      name: "Fixture",
      provider: "fixture",
      api: "openai-completions",
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 8192,
      maxTokens: 4096,
    },
  });
  const events: CaptureEvent[] = [];
  const accept = CaptureState.prototype.accept;
  const observer = vi
    .spyOn(CaptureState.prototype, "accept")
    .mockImplementation(function (this: CaptureState, ...args) {
      const frame = Reflect.apply(accept, this, args);
      events.push(frame.event);
      return frame;
    });
  try {
    const result = await runProcess({
      command: process.execPath,
      args: [
        "--import",
        new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url).href,
        fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
      ],
      cwd,
      timeoutMs: 15000,
      signal: new AbortController().signal,
      env: safeChildEnv(),
      protocol: true,
      childRunId: material.request.childRunId,
      input: JSON.stringify(material),
    });
    expect(result).toMatchObject({
      outcome: "failed",
      exitCode: 1,
      signal: null,
      closed: true,
    });
    expect(contacts).toBe(1);
    expect(events).toContainEqual({ kind: "worker-failure", code: "prompt" });
    expect(events).not.toContainEqual({
      kind: "worker-failure",
      code: "capture",
    });
    expect(
      events.some((e) => e.kind === "message-end" && e.stopReason === "error"),
    ).toBe(true);
    expect(events.some((e) => e.kind === "final")).toBe(false);
    const diagnostics = result.output
      .split("\n")
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    expect(diagnostics.at(-1)).toMatchObject({
      stage: "assistant-final",
      class: "terminal-incomplete",
      terminalStopReason: "error",
      cleanupSettled: true,
    });
    expect(JSON.stringify(events) + result.output).not.toContain(key);
  } finally {
    observer.mockRestore();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 20000);
