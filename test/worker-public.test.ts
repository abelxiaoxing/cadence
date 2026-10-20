import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { zstdDecompressSync } from "node:zlib";
import { expect, it } from "vitest";
import * as network from "../src/sdk-network.ts";
import * as capture from "../src/service/contracts/capture.ts";
import * as core from "../src/service/contracts/core.ts";
import * as domain from "../src/service/contracts/domain.ts";
import * as facade from "../src/service-contract.ts";
import { safeChildEnv } from "../src/subagent-process.ts";
import * as worker from "../src/worker-public.mjs";

it("all shim and facade codec exports are the identical maintained JS values", () => {
  for (const entry of [core, domain, capture]) {
    for (const [key, value] of Object.entries(entry))
      expect(Reflect.get(worker, key), key).toBe(value);
  }
  expect(Object.keys(worker).sort()).toEqual(
    Object.keys({ ...core, ...domain, ...capture }).sort(),
  );
  for (const [key, value] of Object.entries(worker)) {
    if (Object.hasOwn(facade, key))
      expect(Reflect.get(facade, key), key).toBe(value);
  }
  expect(facade.ContractError).toBe(worker.ContractError);
  expect(facade.LIMITS).toBe(worker.LIMITS);
  expect(safeChildEnv).toBe(network.safeChildEnv);
  for (const name of ["core", "domain", "capture"]) {
    const source = readFileSync(`src/service/contracts/${name}.ts`, "utf8");
    expect(source).toMatch(
      /^\/\*[\s\S]*?\*\/\s*export \{[^}]+\} from "\.\.\/\.\.\/worker-public\.mjs";\s*$/,
    );
  }
  const declaration = readFileSync("src/worker-public.d.mts", "utf8");
  expect(declaration).not.toMatch(/\b(?:import|any)\b/);
});

it("ordinary Node imports the standalone maintained codec with no TS tree or loader", () => {
  const root = mkdtempSync(join(tmpdir(), "cadence-codec-node-"));
  writeFileSync(
    join(root, "worker-public.mjs"),
    readFileSync("src/worker-public.mjs"),
  );
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `
    import assert from 'node:assert/strict';
    import * as codec from './worker-public.mjs';
    assert.equal(codec.WORKER_PROTOCOL, 2);
    assert.throws(() => codec.parseWireJson('{"a":1,"a":2}'), codec.ContractError);
    assert.equal(codec.canonicalJson(codec.parseWireJson('{"a":1}')), '{"a":1}');
    process.stdout.write(JSON.stringify(Object.keys(codec).sort()));
  `,
    ],
    {
      cwd: root,
      env: { HOME: root, USERPROFILE: root, NO_COLOR: "1" },
      timeout: 15000,
      encoding: "utf8",
    },
  );
  expect(JSON.parse(output)).toEqual(Object.keys(worker).sort());
  expect(readdirSync(root)).toEqual(["worker-public.mjs"]);
});

// Real native SDK/official adapter, isolated fabricated provider and custom tools.
// Gates/three-value reservation counters are controlled probes, not a production
// sanitizer, W3 disk sink, total SDK memory bound or paid-provider qualification.
for (const [mode, cleanupFault, cleanupFailures] of [
  ["sequential", "none", 0],
  ["parallel", "none", 0],
  ["capture-overflow", "none", 0],
  ["sequential", "unsubscribe", 1],
  ["sequential", "abort", 4],
  ["sequential", "dispose", 8],
] as const) {
  it(`installed public Agent capture capability: ${mode}/${cleanupFault}`, async () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-capture-capability-"));
    const home = join(root, "home"),
      cwd = join(root, "work");
    mkdirSync(home);
    mkdirSync(cwd);
    const requests: {
      path: string | undefined;
      method: string | undefined;
      auth: boolean;
      model: unknown;
      tools: unknown;
      results: unknown[];
    }[] = [];
    let serverFailed = false;
    const server = createServer(async (req, res) => {
      try {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 128 * 1024) throw new Error("fixture request bound");
          chunks.push(chunk);
        }
        const data = Buffer.concat(chunks);
        const body = JSON.parse(
          (req.headers["content-encoding"] === "zstd"
            ? zstdDecompressSync(data)
            : data
          ).toString("utf8"),
        );
        requests.push({
          path: req.url,
          method: req.method,
          auth:
            req.headers.authorization ===
            "Bearer FABRICATED_CAPTURE_CANARY_872019",
          model: body.model,
          tools: body.tools.map(
            (t: { function: { name: string } }) => t.function.name,
          ),
          results: body.messages
            .filter((m: { role: string }) => m.role === "tool")
            .map((m: { tool_call_id: string; content: unknown }) => ({
              id: m.tool_call_id,
              content: m.content,
            })),
        });
        if (requests.length > 2) throw new Error("unexpected retry");
        res.writeHead(200, {
          "content-type": "text/event-stream",
          connection: "close",
        });
        const emit = (delta: unknown, finish_reason: string | null = null) =>
          res.write(
            `data: ${JSON.stringify({ id: "capture-response", object: "chat.completion.chunk", created: 1, model: "capture-fixture", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
          );
        if (requests.length === 1) {
          emit({
            role: "assistant",
            tool_calls: [1, 2].map((n) => ({
              index: n - 1,
              id: `capture_${n}`,
              type: "function",
              function: {
                name: "capture_probe",
                arguments: JSON.stringify({ ordinal: n }),
              },
            })),
          });
          emit({}, "tool_calls");
        } else {
          emit({ role: "assistant", content: "CAPABILITY_OK" });
          emit({}, "stop");
        }
        res.end("data: [DONE]\n\n");
      } catch {
        serverFailed = true;
        res.destroy();
      }
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("fixture address");
      const script = new URL(
        "./helpers/worker-capability-child.mjs",
        import.meta.url,
      );
      const child = spawn(
        process.execPath,
        [
          "--import",
          new URL("./helpers/lightweight-sdk-guard.mjs", import.meta.url).href,
          fileURLToPath(script),
          mode,
          `http://127.0.0.1:${address.port}/v1`,
          cleanupFault,
        ],
        {
          cwd,
          env: {
            HOME: home,
            USERPROFILE: home,
            TMPDIR: root,
            TMP: root,
            TEMP: root,
            XDG_CONFIG_HOME: home,
            XDG_STATE_HOME: home,
            LOCALAPPDATA: home,
            APPDATA: home,
            NO_COLOR: "1",
            PI_OFFLINE: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "",
        bytes = 0,
        forced = false;
      let stdoutEOF = false,
        stderrEOF = false,
        processFailed = false;
      const waits: {
        event: string;
        code: number | null;
        signal: string | null;
      }[] = [];
      const timer = setTimeout(() => {
        forced = true;
        child.kill("SIGKILL");
      }, 15000);
      const collect = (chunk: Buffer, out: boolean) => {
        bytes += chunk.length;
        if (bytes > 65536) {
          forced = true;
          child.kill("SIGKILL");
        } else if (out) stdout += chunk.toString("utf8");
        else stderr += chunk.toString("utf8");
      };
      child.stdout.on("data", (chunk: Buffer) => collect(chunk, true));
      child.stderr.on("data", (chunk: Buffer) => collect(chunk, false));
      child.stdout.on("end", () => {
        stdoutEOF = true;
      });
      child.stderr.on("end", () => {
        stderrEOF = true;
      });
      child.on("error", () => {
        processFailed = true;
      });
      child.on("exit", (code, signal) =>
        waits.push({ event: "exit", code, signal }),
      );
      const native = await new Promise<{
        code: number | null;
        signal: string | null;
      }>((resolve) =>
        child.on("close", (code, signal) => {
          waits.push({ event: "close", code, signal });
          resolve({ code, signal });
        }),
      ).finally(() => clearTimeout(timer));
      // Retain bounded secret-free receipts even on failure. Never store argv,
      // provider request/header bodies, ambient routes or credentials.
      expect(stdout + stderr).not.toContain("FABRICATED_CAPTURE_CANARY_872019");
      const receipt = {
        mode,
        cleanupFault,
        boundary: "native-public-sdk-with-controlled-listeners-tools",
        executable: process.execPath,
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        peers: Object.fromEntries(
          ["pi-coding-agent", "pi-agent-core", "pi-ai"].map((name) => [
            name,
            JSON.parse(
              readFileSync(
                `node_modules/@earendil-works/${name}/package.json`,
                "utf8",
              ),
            ).version,
          ]),
        ),
        helperSha256: createHash("sha256")
          .update(readFileSync(script))
          .digest("hex"),
        pid: child.pid,
        native,
        waits,
        forced,
        stdoutEOF,
        stderrEOF,
        stdin: "ignored",
        processFailed,
        serverFailed,
        requests: requests.length,
        workingFiles: readdirSync(cwd),
        homeFiles: readdirSync(home),
        observation: stdout ? JSON.parse(stdout) : null,
        failure: stderr,
        paidProvider: false,
        productionCapture: false,
        durableSink: false,
      };
      writeFileSync(
        join(root, "receipt.json"),
        `${JSON.stringify(receipt, null, 2)}\n`,
      );
      if (process.env.CADENCE_WORKER_CAPABILITY_EVIDENCE)
        writeFileSync(
          join(
            process.env.CADENCE_WORKER_CAPABILITY_EVIDENCE,
            `${mode}-${cleanupFault}-${child.pid}.json`,
          ),
          `${JSON.stringify(receipt, null, 2)}\n`,
          { flag: "wx", mode: 0o600 },
        );
      const expectedExit = cleanupFailures ? 1 : 0;
      expect(receipt, stderr).toMatchObject({
        native: { code: expectedExit, signal: null },
        forced: false,
        processFailed: false,
        stdoutEOF: true,
        stderrEOF: true,
        serverFailed: false,
        workingFiles: [],
        homeFiles: [],
      });
      expect(waits).toEqual([
        { event: "exit", code: expectedExit, signal: null },
        { event: "close", code: expectedExit, signal: null },
      ]);
      expect(stderr).toBe(
        cleanupFailures ? "capability-fixture-failed:cleanup\n" : "",
      );
      expect(requests).toHaveLength(mode === "capture-overflow" ? 1 : 2);
      for (const request of requests)
        expect(request).toMatchObject({
          path: "/v1/chat/completions",
          method: "POST",
          auth: true,
          model: "capture-fixture",
          tools: ["capture_probe"],
        });
      expect(requests[0].results).toEqual([]);
      if (mode !== "capture-overflow")
        expect(requests[1].results).toEqual([
          { id: "capture_1", content: "result-1" },
          { id: "capture_2", content: "result-2" },
        ]);
      expect(receipt.observation).toMatchObject({
        mode,
        cleanupFault,
        cleanupAttempted: 15,
        cleanupSettled: 15,
        cleanupFailures,
        listenerSignal: true,
        assistantBlocked: true,
        endBlocked: true,
        secondListenerEnd: true,
        updateCalls: 3,
        updateCallbacks: 3,
        retained: 0,
        highWater: mode === "capture-overflow" ? 2 : 3,
        refused: mode === "capture-overflow" ? 1 : 0,
        copies: mode === "capture-overflow" ? 2 : 3,
        abortRequested: mode === "capture-overflow",
        maxActiveTools: mode === "parallel" ? 2 : 1,
      });
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 20000);
}
