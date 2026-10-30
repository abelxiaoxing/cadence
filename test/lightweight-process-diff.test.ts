import { spawn, spawnSync } from "node:child_process";
import { EventEmitter } from "node:events";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  runCheck,
  runProcess,
  runWorker,
  safeChildEnv,
  type WorkerRequest,
} from "../src/subagent-process.ts";
import { TaskController } from "../src/task-controller.ts";
import { captureChanges } from "../src/task-diff.ts";
import { resolveWorkspace, TaskStore } from "../src/task-store.ts";
import { diagnosticText } from "../src/verification-diagnostics.ts";
import { v2Frames } from "./helpers/worker-v2.ts";

/** The child launch itself: on Windows a stop also spawns taskkill /T. */
const launchIndex = () =>
  vi
    .mocked(spawn)
    .mock.calls.findLastIndex(
      ([command]) => !/taskkill(\.exe)?$/i.test(String(command)),
    );
const launchCall = () => vi.mocked(spawn).mock.calls[launchIndex()];
const launchedChild = () => vi.mocked(spawn).mock.results[launchIndex()]?.value;

// Observe actual launch arguments without replacing native execution.
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

// Isolate only route keys. Real ambient values stay in RAM and are never printed.
const routeKeys = [
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
] as const;
let savedRoutes: (PropertyDescriptor | undefined)[];
beforeEach(() => {
  savedRoutes = routeKeys.map((key) =>
    Object.getOwnPropertyDescriptor(process.env, key),
  );
  for (const key of routeKeys) delete process.env[key];
});
afterEach(() => {
  routeKeys.forEach((key, index) => {
    delete process.env[key];
    const descriptor = savedRoutes[index];
    if (descriptor) Object.defineProperty(process.env, key, descriptor);
  });
});

const nativeSpawn = vi.mocked(spawn).getMockImplementation() as typeof spawn;
// Bind the native fixture parent before finite process.env mocks. Windows
// tmpdir() otherwise falls back to `undefined\\temp` without TEMP/SystemRoot.
const nativeTemporaryParent = realpathSync(tmpdir());
const temporary = () =>
  mkdtempSync(join(nativeTemporaryParent, "cadence-lw-native-"));
function node(
  code: string,
  options: Partial<Parameters<typeof runProcess>[0]> = {},
) {
  return runProcess({
    command: process.execPath,
    args: ["-e", code],
    cwd: temporary(),
    signal: new AbortController().signal,
    timeoutMs: 5000,
    ...options,
  });
}
// Exact lifecycle controls are not native exit evidence. The native cases below
// separately verify spawn options, real EOF/exit and injected parent-side
// Writable faults on actual child pipes (not native reader-close evidence).
function lifecycleChild(input?: string) {
  const stream = () => {
    const result = Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
    });
    result.end.mockImplementation(() => {
      result.emit("finish");
    });
    return result;
  };
  const child = Object.assign(new EventEmitter(), {
    stdin: input === undefined ? null : stream(),
    stdout: stream(),
    stderr: stream(),
    kill: vi.fn(() => true),
    unref: vi.fn(),
  });
  vi.mocked(spawn).mockReturnValueOnce(
    child as unknown as ReturnType<typeof spawn>,
  );
  return child;
}

const validFrames = Buffer.from(v2Frames("transport-final"));
const workerFrames = (
  child: ReturnType<typeof lifecycleChild>,
  text = "transport-final",
  tool?: string,
) =>
  Buffer.from(
    v2Frames(
      text,
      JSON.parse(child.stdin!.end.mock.calls[0][0]).request.childRunId,
      tool,
    ),
  );

describe("demand-based stdin transport", () => {
  it.each([
    { name: "absent", input: undefined, stdin: "ignore" },
    { name: "explicit empty", input: "", stdin: "pipe" },
    { name: "payload", input: "bounded 中文 payload", stdin: "pipe" },
  ])("actual spawn and EOF delivery: $name", async ({ input, stdin }) => {
    const result = await node(
      `let text='';process.stdin.setEncoding('utf8');process.stdin.on('data',part=>text+=part);process.stdin.on('end',()=>{process.stdout.write(JSON.stringify(text));process.stderr.write('stderr-pipe')});process.stdin.resume();`,
      { input },
    );
    const launch = launchCall();
    const child = launchedChild();
    expect(launch?.[2]?.stdio).toEqual([stdin, "pipe", "pipe"]);
    expect(launch?.[2]?.detached).toBe(process.platform !== "win32");
    expect(launch?.[2]?.windowsHide).toBe(true);
    expect(launch?.[2]?.windowsVerbatimArguments).toBeUndefined();
    expect(child.stdin === null).toBe(input === undefined);
    expect(result).toMatchObject({
      outcome: "completed",
      closed: true,
      exitCode: 0,
      signal: null,
      truncated: false,
    });
    expect(result.output).toContain(JSON.stringify(input ?? ""));
    expect(result.output).toContain("stderr-pipe");
  });

  it("native fast shell and Node zero/nonzero retain their actual close facts", async () => {
    for (const [command, exitCode] of [
      [process.platform === "win32" ? "exit 0" : "true", 0],
      [process.platform === "win32" ? "exit 1" : "false", 1],
      ["exit 7", 7],
    ] as const) {
      const result = await runCheck(
        { name: "fast-close", command, timeoutMs: 1000 },
        temporary(),
        new AbortController().signal,
      );
      expect(launchCall()?.[2]?.stdio).toEqual(["ignore", "pipe", "pipe"]);
      expect(result).toMatchObject({
        outcome: exitCode === 0 ? "completed" : "failed",
        closed: true,
        exitCode,
        signal: null,
        truncated: false,
        output: "",
      });
    }
    for (const exitCode of [0, 7]) {
      const result = await node(`process.exit(${exitCode});`);
      expect(result).toMatchObject({
        outcome: exitCode === 0 ? "completed" : "failed",
        closed: true,
        exitCode,
        signal: null,
        truncated: false,
      });
    }
  });

  it.each([
    { name: "absent", input: undefined },
    { name: "explicit empty", input: "" },
    { name: "payload", input: "bounded 中文 payload" },
  ])(
    "real child with injected parent-side Writable fault: $name",
    async ({ input }) => {
      const cwd = temporary();
      const gate = join(cwd, "continue");
      const abort = new AbortController();
      const fault = new Error("Injected parent-side Writable transport fault");
      let childReady = false;
      let nativeEOF = false;
      let nativeEndAttempted = false;
      let stdinError: Error | undefined;
      const lifecycle: {
        event: "exit" | "close";
        exitCode: number | null;
        signal: NodeJS.Signals | null;
      }[] = [];
      vi.mocked(spawn).mockImplementationOnce((command, args, options) => {
        const child = nativeSpawn(command, args, options);
        const stdin = child.stdin;
        // Defer delivery only until the real child has installed its watcher.
        // Writable.destroy(error) publicly injects a parent-side pipe fault;
        // bare destroy() + end() need not emit an error. This is neither an OS
        // EPIPE nor proof that a Windows child's original fd0 was closed.
        const end = stdin?.end.bind(stdin);
        if (stdin && end) stdin.end = vi.fn(() => stdin);
        stdin?.on("error", (error: Error) => {
          stdinError = error;
        });
        child.on("exit", (exitCode, signal) => {
          lifecycle.push({ event: "exit", exitCode, signal });
        });
        child.on("close", (exitCode, signal) => {
          lifecycle.push({ event: "close", exitCode, signal });
        });
        let observed = "";
        child.stdout?.on("data", (bytes: Buffer) => {
          observed += bytes.toString();
          if (!childReady && observed.includes("NATIVE_READY\n")) {
            childReady = true;
            if (stdin && end) {
              stdin.destroy(fault);
              end(input);
              nativeEndAttempted = true;
            }
          }
          if (!nativeEOF && observed.includes("NATIVE_EOF\n")) {
            nativeEOF = true;
            if (input === undefined) writeFileSync(gate, "continue");
          }
        });
        return child;
      });
      try {
        const result = await node(
          `const fs=require('node:fs');const gate=${JSON.stringify(gate)};const watcher=fs.watch(${JSON.stringify(cwd)},()=>{if(fs.existsSync(gate)){watcher.close();console.log('WORK_AFTER_EOF')}});process.stdin.on('end',()=>console.log('NATIVE_EOF'));process.stdin.resume();console.log('NATIVE_READY');`,
          { cwd, input, signal: abort.signal },
        );
        const child = launchedChild();
        expect(launchCall()?.[2]?.stdio).toEqual([
          input === undefined ? "ignore" : "pipe",
          "pipe",
          "pipe",
        ]);
        expect(childReady).toBe(true);
        expect(result.closed).toBe(true);
        expect(lifecycle).toEqual([
          { event: "exit", exitCode: result.exitCode, signal: result.signal },
          { event: "close", exitCode: result.exitCode, signal: result.signal },
        ]); // Only actual native exit/close events supply these facts.
        if (input === undefined) {
          expect(child.stdin).toBeNull();
          expect(nativeEndAttempted).toBe(false);
          expect(stdinError).toBeUndefined();
          expect(nativeEOF).toBe(true);
          expect(result).toMatchObject({
            outcome: "completed",
            exitCode: 0,
            signal: null,
            truncated: false,
          });
          expect(result.output).toContain("WORK_AFTER_EOF");
        } else {
          // Empty is supplied input, not a truthiness-based absence. The real
          // Writable emits our injected fault; production must fail closed.
          expect(child.stdin.end).toHaveBeenCalledExactlyOnceWith(input);
          expect(nativeEndAttempted).toBe(true);
          expect(child.stdin.destroyed).toBe(true);
          expect(stdinError).toBe(fault);
          expect(result.outcome).toBe("failed");
          expect(result.truncated).toBe(false);
          expect(result.output).not.toContain("WORK_AFTER_EOF");
        }
      } finally {
        abort.abort();
      }
    },
  );

  it("real controller stores passed/review and failed statuses with stable inputs", async () => {
    const root = temporary();
    writeFileSync(join(root, "existing.txt"), "stable user bytes");
    const store = new TaskStore(root, join(temporary(), "state"));
    const controller = new TaskController(store, root);
    controller.create("code", "Native check status");
    const before = controller.observe().fingerprint;
    for (const [name, command, exitCode, status, phase] of [
      [
        "pass",
        process.platform === "win32" ? "exit 0" : "true",
        0,
        "passed",
        "review",
      ],
      [
        "fail",
        process.platform === "win32" ? "exit 1" : "false",
        1,
        "failed",
        "failed",
      ],
    ] as const) {
      const result = await controller.check(
        controller.choice(),
        { name, command, timeoutMs: 1000 },
        () => true,
      );
      expect(result).toMatchObject({
        outcome: exitCode === 0 ? "completed" : "failed",
        closed: true,
        exitCode,
        signal: null,
      });
      expect(controller.observe().fingerprint).toBe(before);
      const task = controller.current;
      expect(task?.phase).toBe(phase);
      expect(task?.checks.find((check) => check.name === name)).toMatchObject({
        status,
        exitCode,
        fingerprint: before,
      });
      expect(store.loadSnapshot(controller.choice().id)?.record).toEqual(task);
      expect(controller.busy).toBe(false);
      expect(controller.blocked).toBe(false);
    }
    expect(controller.current?.checks.map((check) => check.status)).toEqual([
      "passed",
      "failed",
    ]);
  });

  it.each(["before-exit", "after-exit", "after-close", "none"] as const)(
    "SDK payload + already parsed valid final: stdin error %s",
    async (order) => {
      const request = {
        cwd: temporary(),
        model: {
          id: "fixture",
          provider: "fixture",
          api: "openai-completions",
        },
        auth: { ok: true as const },
        kind: "code" as const,
        prompt: "synthetic payload",
        instructions: "fixture only",
      };
      const input = JSON.stringify(request);
      const child = lifecycleChild(input);
      const run = runWorker(request, new AbortController().signal);
      expect(launchCall()?.[2]?.stdio).toEqual(["pipe", "pipe", "pipe"]);
      expect(child.stdin?.end).toHaveBeenCalledTimes(1);
      const actualInput = child.stdin!.end.mock.calls[0][0];
      expect(JSON.parse(actualInput)).toMatchObject({
        cwd: request.cwd,
        model: request.model,
        auth: request.auth,
        request: { protocol: 2, prompt: request.prompt },
      });
      expect(Buffer.byteLength(actualInput)).toBeLessThanOrEqual(128 * 1024);
      let settled = false;
      void run.then(() => {
        settled = true;
      });
      // The production data handler synchronously parses both valid frames.
      // The no-error twin below proves the same frames yield the final text.
      child.stdout.emit("data", workerFrames(child));
      const error = () =>
        child.stdin?.emit(
          "error",
          Object.assign(new Error("synthetic transport failure"), {
            code: "EPIPE",
          }),
        );
      if (order === "before-exit") error();
      child.emit("exit", 0, null);
      await Promise.resolve();
      expect(settled).toBe(false); // Native exit is not stream settlement.
      if (order === "after-exit") error();
      child.emit("close", 0, null);
      if (order === "after-close") error();
      const failed = order === "before-exit" || order === "after-exit";
      expect(await run).toMatchObject({
        outcome: failed ? "failed" : "completed",
        closed: true,
        exitCode: 0,
        signal: null,
        truncated: false,
        ...(failed ? {} : { text: "transport-final" }),
      });
      expect(child.kill.mock.calls).toEqual(failed ? [["SIGTERM"]] : []);
    },
  );

  it("explicit empty input errors stay strict; cancellation still wins over late zero", async () => {
    for (const canceled of [false, true]) {
      const child = lifecycleChild("");
      const abort = new AbortController();
      const run = node("synthetic lifecycle only", {
        input: "",
        protocol: true,
        signal: abort.signal,
      });
      expect(child.stdin?.end).toHaveBeenCalledExactlyOnceWith("");
      child.stdout.emit("data", validFrames);
      if (canceled) abort.abort();
      child.emit("exit", 0, null);
      child.stdin?.emit(
        "error",
        Object.assign(new Error("fixture EPIPE"), { code: "EPIPE" }),
      );
      child.emit("close", 0, null);
      expect(await run).toMatchObject({
        outcome: canceled ? "canceled" : "failed",
        closed: true,
        exitCode: 0,
        signal: null,
      });
    }
  });

  it("absent stdin is safe on unknown-close cleanup without inventing close", async () => {
    vi.useFakeTimers();
    try {
      const child = lifecycleChild();
      const abort = new AbortController();
      const run = node("synthetic no-close only", { signal: abort.signal });
      expect(child.stdin).toBeNull();
      expect(launchCall()?.[2]?.stdio).toEqual(["ignore", "pipe", "pipe"]);
      abort.abort();
      await vi.advanceTimersByTimeAsync(3000);
      const result = await run;
      expect(result).toMatchObject({
        outcome: "unknown",
        closed: false,
        exitCode: null,
        signal: null,
      });
      expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
      expect(child.unref).toHaveBeenCalledOnce();
      expect(child.stdout.destroy).toHaveBeenCalledOnce();
      expect(child.stderr.destroy).toHaveBeenCalledOnce();
      child.emit("close", 0, null);
      expect(await run).toBe(result); // A later event cannot repair the receipt.
    } finally {
      vi.useRealTimers();
    }
  });

  it("oversized supplied input refuses before any spawn", async () => {
    const calls = vi.mocked(spawn).mock.calls.length;
    const result = await node("not launched", {
      input: "x".repeat(128 * 1024 + 1),
    });
    expect(result).toMatchObject({
      outcome: "failed",
      closed: true,
      exitCode: null,
    });
    expect(vi.mocked(spawn).mock.calls).toHaveLength(calls);
  });
});

describe("SDK-only validated egress (labelled lifecycle mocks, not native waits)", () => {
  const proxy = "http://127.0.0.1:2048/";
  it("test-owned fixture parent is independent of finite fake process.env", () => {
    const ambient = Object.getOwnPropertyDescriptor(process, "env")!;
    const synthetic = { HTTP_PROXY: proxy, HTTPS_PROXY: proxy };
    try {
      Object.defineProperty(process, "env", { value: synthetic });
      const cwd = temporary();
      expect(dirname(cwd)).toBe(nativeTemporaryParent);
      expect(realpathSync(cwd)).toBe(cwd);
      expect(process.env === synthetic).toBe(true);
      expect(synthetic).toEqual({ HTTP_PROXY: proxy, HTTPS_PROXY: proxy });
    } finally {
      Object.defineProperty(process, "env", ambient);
    }
  });
  const unsupported = {
    outcome: "failed",
    closed: true,
    exitCode: null,
    signal: null,
    durationMs: 0,
    output: "",
    truncated: false,
    text: "unsupportedNetwork: SDK proxy configuration or runtime capability is unsupported; no worker launched.",
  };
  const request = (): WorkerRequest => ({
    cwd: temporary(),
    model: { id: "fixture", provider: "fixture", api: "openai-completions" },
    auth: { ok: true },
    kind: "code",
    prompt: "fixed synthetic request",
    instructions: "fixture only",
  });
  const pair = () => {
    process.env.HTTP_PROXY = proxy;
    process.env.HTTPS_PROXY = proxy;
  };
  // Node freezes the public Set: inject only local public capability facts, not its body.
  const capability = (implementation: (flag: string) => boolean) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      process,
      "allowedNodeEnvironmentFlags",
    )!;
    const has = vi.fn(implementation);
    Object.defineProperty(process, "allowedNodeEnvironmentFlags", {
      value: { has },
      configurable: true,
    });
    has.mockRestore = () => {
      Object.defineProperty(process, "allowedNodeEnvironmentFlags", descriptor);
    };
    return has;
  };
  const supported = () => capability(() => true);
  const refuse = async (
    wire = request(),
    signal = new AbortController().signal,
  ) => {
    const calls = vi.mocked(spawn).mock.calls.length;
    const result = await runWorker(wire, signal);
    expect(result).toEqual(unsupported);
    expect(vi.mocked(spawn).mock.calls).toHaveLength(calls);
    return result;
  };
  const completed = async (wire: WorkerRequest) => {
    const input = JSON.stringify(wire);
    const child = lifecycleChild(input);
    const calls = vi.mocked(spawn).mock.calls.length;
    const run = runWorker(wire, new AbortController().signal);
    expect(vi.mocked(spawn).mock.calls).toHaveLength(calls + 1);
    const launch = launchCall()!;
    expect(launch[0]).toBe(process.execPath);
    expect(launch[1]).toEqual([
      fileURLToPath(new URL("../src/sdk-worker.mjs", import.meta.url)),
    ]);
    expect(launch[2]).toMatchObject({
      cwd: wire.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    expect(launch[2]?.windowsVerbatimArguments).toBeUndefined();
    expect(child.stdin?.end).toHaveBeenCalledTimes(1);
    const envelope = JSON.parse(child.stdin!.end.mock.calls[0][0]);
    expect(envelope).toMatchObject({
      cwd: wire.cwd,
      model: wire.model,
      auth: wire.auth,
      request: {
        protocol: 2,
        taskKind: wire.kind,
        prompt: wire.prompt,
        instructions: wire.instructions,
      },
    });
    child.stdout.emit("data", workerFrames(child));
    child.emit("close", 0, null);
    expect(await run).toMatchObject({
      outcome: "completed",
      closed: true,
      exitCode: 0,
      signal: null,
      text: "transport-final",
    });
    const env = launch[2]?.env;
    if (!env) throw new Error("Synthetic launch missing environment");
    return env;
  };
  it.each([false, true])(
    "DIRECT preserves narrow env; NODE_OPTIONS alone=%s is dropped",
    async (options) => {
      if (options) process.env.NODE_OPTIONS = "--fabricated-preload-never-run";
      const flag = capability(() => {
        throw new Error("must not check direct capability");
      });
      try {
        const env = await completed(request());
        expect(env).toEqual(safeChildEnv());
        for (const key of routeKeys) expect(env).not.toHaveProperty(key);
        expect(flag).not.toHaveBeenCalled();
      } finally {
        flag.mockRestore();
      }
    },
  );
  it.each([
    ["lower", { http_proxy: proxy, https_proxy: proxy }],
    ["upper", { HTTP_PROXY: proxy, HTTPS_PROXY: proxy }],
    [
      "duplicates",
      {
        http_proxy: proxy,
        HTTP_PROXY: proxy,
        https_proxy: proxy,
        HTTPS_PROXY: proxy,
      },
    ],
    ["mixed", { http_proxy: proxy, HTTPS_PROXY: proxy }],
    [
      "opt-in",
      { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NODE_USE_ENV_PROXY: "1" },
    ],
    [
      "https",
      {
        HTTP_PROXY: "https://proxy.example:443",
        HTTPS_PROXY: "https://proxy.example:443",
      },
    ],
    [
      "scheme-case",
      {
        HTTP_PROXY: "HTTP://proxy.example:2048/",
        HTTPS_PROXY: "HTTP://proxy.example:2048/",
      },
    ],
    [
      "ipv6",
      { HTTP_PROXY: "http://[::1]:2048", HTTPS_PROXY: "http://[::1]:2048" },
    ],
  ])(
    "validated %s projects only exact uppercase route before stdin",
    async (_name, settings) => {
      Object.assign(process.env, settings);
      const flag = supported();
      vi.stubEnv("OPENAI_API_KEY", "fabricated-ambient-secret");
      vi.stubEnv("PI_SESSION_ID", "fabricated-session");
      vi.stubEnv("CADENCE_CONTROL_FD", "999");
      try {
        const wire = request();
        wire.auth = {
          ok: true,
          apiKey: "fabricated-request-key",
          env: { FIXTURE_PROVIDER_SECRET: "fabricated-scoped-secret" },
        };
        const env = await completed(wire);
        const exact =
          "http_proxy" in settings ? settings.http_proxy : settings.HTTP_PROXY;
        expect(env).toEqual({
          ...safeChildEnv(),
          HTTP_PROXY: exact,
          HTTPS_PROXY: exact,
          NODE_USE_ENV_PROXY: "1",
        });
        for (const key of [
          "OPENAI_API_KEY",
          "PI_SESSION_ID",
          "CADENCE_CONTROL_FD",
          "FIXTURE_PROVIDER_SECRET",
          "NODE_OPTIONS",
          "http_proxy",
          "https_proxy",
        ])
          expect(env).not.toHaveProperty(key);
        for (const key of routeKeys)
          expect(safeChildEnv()).not.toHaveProperty(key);
        expect(flag).toHaveBeenCalledWith("--use-env-proxy");
      } finally {
        flag.mockRestore();
        vi.unstubAllEnvs();
      }
    },
  );
  it.each([
    "",
    "ftp://proxy.example",
    "http://",
    "http://user@proxy.example",
    "http://user:secret@proxy.example",
    "http://proxy.example?",
    "http://proxy.example#",
    "http://proxy.example/?x=1",
    "http://proxy.example/#x",
    "http://proxy.example/path",
    "http://proxy.example/./",
    "http://proxy.example/a/..",
    "http://proxy.example/%2e/",
    "http://proxy.example\\",
    "http://proxy.example:abc",
    "http://proxy.example:",
    "http://proxy.example:65536",
    "http://proxy.example:0",
    "http://proxy.example:1.5",
    "http://proxy.example:2048:2049",
    "http:///proxy.example",
    " http://proxy.example",
    "http://proxy.example\n",
    "http://proxy.example\u0000",
    "http://proxy.example\u200b",
    "http://proxy.example\u202e",
    "http://[bad]:2048",
    `http://${"x".repeat(4090)}.example`,
    `http://${"漢".repeat(1400)}.example`,
  ])("unsafe synthetic URL refuses without spawn: %j", async (value) => {
    const ambient = process.env;
    try {
      // A native env setter truncates NUL; this finite own-data fixture preserves it.
      Object.defineProperty(process, "env", {
        value: { HTTP_PROXY: value, HTTPS_PROXY: value },
      });
      await refuse();
    } finally {
      Object.defineProperty(process, "env", { value: ambient });
    }
  });
  it.each(
    [
      ["ascii", "proxy.example:2048/"],
      ["ipv4", "127.0.0.1"],
      ["ipv6", "[::1]:2048"],
      ["punycode", "xn--bcher-kva.example/"],
      ["raw-unicode", "bücher.example:2048/"],
    ].flatMap(([host, authority]) =>
      ["http", "https"].map((scheme) => ({
        name: `${scheme}/${host}`,
        value: `${scheme}://${authority}`,
      })),
    ),
  )(
    "simple unencoded authority preserves exact route: $name",
    async ({ value }) => {
      const ambient = process.env;
      const flag = supported();
      try {
        Object.defineProperty(process, "env", {
          value: { HTTP_PROXY: value, HTTPS_PROXY: value },
        });
        const wire = request();
        wire.auth.env = { https_proxy: value };
        expect(await completed(wire)).toEqual({
          ...safeChildEnv(),
          HTTP_PROXY: value,
          HTTPS_PROXY: value,
          NODE_USE_ENV_PROXY: "1",
        });
      } finally {
        flag.mockRestore();
        Object.defineProperty(process, "env", { value: ambient });
      }
    },
  );
  it.each([
    ["encoded-zero-width-space-upper", "pro%E2%80%8Bxy.example:2048/"],
    ["encoded-zero-width-space-lower", "pro%e2%80%8bxy.example:2048/"],
    ["encoded-soft-hyphen-upper", "pro%C2%ADxy.example:2048/"],
    ["encoded-soft-hyphen-lower", "pro%c2%adxy.example:2048/"],
    ["encoded-bom-upper", "pro%EF%BB%BFxy.example:2048/"],
    ["encoded-bom-lower", "pro%ef%bb%bfxy.example:2048/"],
    ["encoded-bidi-override", "pro%E2%80%AExy.example:2048/"],
    ["encoded-bidi-isolate", "pro%e2%81%a6xy.example:2048/"],
    ["raw-zero-width-space", "pro\u200bxy.example:2048/"],
    ["raw-soft-hyphen", "pro\u00adxy.example:2048/"],
    ["raw-bom", "pro\ufeffxy.example:2048/"],
    ["raw-bidi-override", "pro\u202exy.example:2048/"],
    ["raw-cc", "pro\u0001xy.example:2048/"],
    ["encoded-nul", "pro%00xy.example:2048/"],
    ["encoded-tab", "pro%09xy.example:2048/"],
    ["encoded-line-feed", "pro%0axy.example:2048/"],
    ["encoded-del", "pro%7Fxy.example:2048/"],
    ["encoded-c1", "pro%C2%85xy.example:2048/"],
    ["encoded-ascii-letter", "%70roxy.example:2048/"],
    ["encoded-ascii-dot", "proxy%2Eexample:2048/"],
    ["encoded-at", "pro%40xy.example:2048/"],
    ["encoded-colon", "pro%3axy.example:2048/"],
    ["encoded-slash", "pro%2Fxy.example:2048/"],
    ["encoded-backslash", "pro%5Cxy.example:2048/"],
    ["encoded-query", "pro%3Fxy.example:2048/"],
    ["encoded-fragment", "pro%23xy.example:2048/"],
    ["encoded-userinfo", "%75ser@proxy.example:2048/"],
    ["encoded-port", "proxy.example:%32/"],
    ["encoded-ipv6-zone", "[::1%25lo0]:2048/"],
    ["bare-percent", "pro%xy.example:2048/"],
    ["short-escape", "pro%2xy.example:2048/"],
    ["invalid-hex", "pro%GGxy.example:2048/"],
    ["truncated-utf8", "pro%E2%80xy.example:2048/"],
    ["overlong-utf8", "pro%C0%80xy.example:2048/"],
    ["encoded-surrogate", "pro%ED%A0%80xy.example:2048/"],
    ["double-encoded-control", "pro%25E2%2580%258Bxy.example:2048/"],
  ])(
    "raw URL policy refuses before normalization/spawn: %s",
    async (_name, authority) => {
      const ambient = process.env;
      const spawnImplementation = vi.mocked(spawn).getMockImplementation()!;
      const flag = supported();
      // Fail locally if admission regresses; never launch a real SDK/network request.
      vi.mocked(spawn).mockImplementation(() => {
        throw new Error("Synthetic unsafe URL reached spawn");
      });
      try {
        for (const scheme of ["http", "https"]) {
          const value = `${scheme}://${authority}`;
          Object.defineProperty(process, "env", {
            value: { http_proxy: value, HTTPS_PROXY: value },
          });
          await refuse(); // Exact production runWorker selector; fixed/null native facts.
        }
        expect(flag).not.toHaveBeenCalled();
      } finally {
        vi.mocked(spawn).mockImplementation(spawnImplementation);
        flag.mockRestore();
        Object.defineProperty(process, "env", { value: ambient });
      }
    },
  );
  it.each([
    { HTTP_PROXY: proxy },
    { HTTPS_PROXY: proxy },
    { HTTP_PROXY: proxy, https_proxy: "http://127.0.0.1:2049" },
    {
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      http_proxy: "http://127.0.0.1:2049",
    },
    {
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      https_proxy: `${proxy.slice(0, -1)}`,
    },
    { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: "" },
    { NODE_USE_ENV_PROXY: "1" },
    ...[
      "ALL_PROXY",
      "all_proxy",
      "NO_PROXY",
      "no_proxy",
      "NODE_OPTIONS",
    ].flatMap((key) => [
      { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, [key]: "" },
      { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, [key]: "fabricated" },
    ]),
    ...["", "0", "true"].map((value) => ({
      HTTP_PROXY: proxy,
      HTTPS_PROXY: proxy,
      NODE_USE_ENV_PROXY: value,
    })),
  ])(
    "partial/conflicting/unsupported finite configuration %#",
    async (settings) => {
      const ambient = process.env;
      try {
        // These are finite own-case controls, not OS env-setter/Windows alias evidence.
        Object.defineProperty(process, "env", { value: settings });
        await refuse();
      } finally {
        Object.defineProperty(process, "env", { value: ambient });
      }
    },
  );
  it.each(["undefined", "number", "getter", "coercion"])(
    "own-data ambient reader never invokes %s",
    async (mode) => {
      const env = process.env;
      let reads = 0;
      const synthetic = { HTTP_PROXY: proxy, HTTPS_PROXY: proxy };
      Object.defineProperty(
        synthetic,
        "http_proxy",
        mode === "getter"
          ? {
              enumerable: true,
              get() {
                reads++;
                throw new Error("fabricated-getter");
              },
            }
          : {
              value:
                mode === "undefined"
                  ? undefined
                  : mode === "number"
                    ? 1
                    : {
                        [Symbol.toPrimitive]() {
                          reads++;
                          throw new Error("fabricated-coercion");
                        },
                      },
              enumerable: true,
            },
      );
      try {
        Object.defineProperty(process, "env", { value: synthetic });
        await refuse();
        expect(reads).toBe(0);
      } finally {
        Object.defineProperty(process, "env", { value: env });
      }
    },
  );
  it.each([
    "false",
    "throw",
    "missing",
    "getter",
    "bun",
    "unknown",
    "node-getter",
  ])("public capability refusal: %s", async (mode) => {
    pair();
    const flags = Object.getOwnPropertyDescriptor(
      process,
      "allowedNodeEnvironmentFlags",
    )!;
    const node = Object.getOwnPropertyDescriptor(process.versions, "node")!;
    const bun = Object.getOwnPropertyDescriptor(process.versions, "bun");
    let nodeReads = 0;
    try {
      if (mode === "bun")
        Object.defineProperty(process.versions, "bun", {
          value: "fabricated-bun",
          configurable: true,
        });
      if (mode === "unknown")
        Object.defineProperty(process.versions, "node", { value: undefined });
      if (mode === "node-getter")
        Object.defineProperty(process.versions, "node", {
          get() {
            nodeReads++;
            throw new Error("fabricated-node");
          },
        });
      Object.defineProperty(
        process,
        "allowedNodeEnvironmentFlags",
        mode === "getter"
          ? {
              get() {
                throw new Error("fabricated-capability-getter");
              },
              configurable: true,
            }
          : {
              value:
                mode === "missing"
                  ? undefined
                  : {
                      has() {
                        if (mode === "throw")
                          throw new Error("fabricated-capability");
                        return false;
                      },
                    },
              configurable: true,
            },
      );
      await refuse();
      expect(nodeReads).toBe(0);
    } finally {
      Object.defineProperty(process, "allowedNodeEnvironmentFlags", flags);
      Object.defineProperty(process.versions, "node", node);
      delete (process.versions as Record<string, unknown>).bun;
      if (bun) Object.defineProperty(process.versions, "bun", bun);
    }
  });
  it("matching scoped network stays literal; unrelated provider env never promoted", async () => {
    pair();
    const flag = supported();
    try {
      const wire = request();
      wire.auth.env = {
        http_proxy: proxy,
        HTTPS_PROXY: proxy,
        NODE_USE_ENV_PROXY: "1",
        FIXTURE_SECRET: "fabricated-scoped-secret",
      };
      const original = JSON.stringify(wire);
      const env = await completed(wire);
      expect(env).not.toHaveProperty("FIXTURE_SECRET");
      expect(JSON.stringify(wire)).toBe(original);
    } finally {
      flag.mockRestore();
    }
  });
  it.each([
    { http_proxy: "http://user:secret@127.0.0.1:2048" },
    { HTTPS_PROXY: "http://127.0.0.1:2049" },
    { HTTP_PROXY: "" },
    { HTTP_PROXY: undefined },
    { HTTP_PROXY: 1 },
    { NODE_USE_ENV_PROXY: "0" },
    { ALL_PROXY: "" },
    { all_proxy: "" },
    { NO_PROXY: "" },
    { no_proxy: "" },
    { NODE_OPTIONS: "" },
  ])("scoped conflicting/unsupported own value %# refuses", async (env) => {
    pair();
    const flag = supported();
    try {
      const wire = request();
      wire.auth.env = env as unknown as Record<string, string>;
      await refuse(wire);
    } finally {
      flag.mockRestore();
    }
  });
  it.each(["route", "opt-in", "env-getter", "route-getter"])(
    "scoped-only or accessor %s never selects/invokes",
    async (mode) => {
      const wire = request();
      let reads = 0;
      wire.auth.env =
        mode === "opt-in"
          ? { NODE_USE_ENV_PROXY: "1" }
          : { HTTP_PROXY: proxy, HTTPS_PROXY: proxy };
      if (mode.endsWith("getter"))
        Object.defineProperty(
          mode === "env-getter" ? wire.auth : wire.auth.env!,
          mode === "env-getter" ? "env" : "HTTP_PROXY",
          {
            enumerable: true,
            get() {
              reads++;
              throw new Error("fabricated-scoped-getter");
            },
          },
        );
      await refuse(wire);
      expect(reads).toBe(0);
    },
  );
  it.each(["ambient", "scoped", "descriptor", "serialized-only"])(
    "changed %s during labelled serialization refuses no recapture",
    async (mode) => {
      pair();
      const flag = supported();
      try {
        const wire = request();
        wire.auth.env = { HTTP_PROXY: proxy };
        Object.defineProperty(wire.model, "toJSON", {
          value() {
            if (mode === "ambient")
              process.env.HTTPS_PROXY = "http://127.0.0.1:2049";
            if (mode === "scoped")
              wire.auth.env!.HTTP_PROXY = "http://127.0.0.1:2049";
            if (mode === "descriptor")
              Object.defineProperty(wire.auth.env!, "HTTP_PROXY", {
                enumerable: false,
              });
            return {};
          },
        });
        if (mode === "serialized-only")
          Object.defineProperty(wire.auth.env, "toJSON", {
            value() {
              return { HTTP_PROXY: "http://127.0.0.1:2049" };
            },
          });
        await refuse(wire);
      } finally {
        flag.mockRestore();
      }
    },
  );
  it("already aborted precedes network admission and no worker exists", async () => {
    process.env.ALL_PROXY = "";
    const abort = new AbortController();
    abort.abort();
    const calls = vi.mocked(spawn).mock.calls.length;
    expect(await runWorker(request(), abort.signal)).toEqual({
      ...unsupported,
      outcome: "canceled",
      text: "Canceled before launch",
    });
    expect(vi.mocked(spawn).mock.calls).toHaveLength(calls);
  });
  it("SDK route never widens general default env or narrows ordinary parent checks", async () => {
    pair();
    process.env.NODE_USE_ENV_PROXY = "1";
    const direct = await node(
      "console.log(['HTTP_PROXY','HTTPS_PROXY','NODE_USE_ENV_PROXY'].every(key=>process.env[key]===undefined)?'general-narrow':'wrong')",
    );
    expect(direct).toMatchObject({
      outcome: "completed",
      closed: true,
      exitCode: 0,
    });
    expect(direct.output).toContain("general-narrow");
    const cwd = temporary();
    writeFileSync(
      join(cwd, "route-check.cjs"),
      `if(process.env.HTTP_PROXY!==${JSON.stringify(proxy)} || process.env.HTTPS_PROXY!==${JSON.stringify(proxy)} || process.env.NODE_USE_ENV_PROXY!=='1') process.exitCode=7;else console.log('check-route-preserved');`,
    );
    const result = await runCheck(
      {
        name: "ordinary route environment",
        command: `"${process.execPath}" route-check.cjs`,
        timeoutMs: 5000,
      },
      cwd,
      new AbortController().signal,
    );
    expect(result).toMatchObject({
      outcome: "completed",
      closed: true,
      exitCode: 0,
    });
    expect(result.output).toContain("check-route-preserved");
  });
  it.each([
    "final",
    "split-stderr",
    "malformed-tool",
    "truncation",
    "split-utf8",
    "tool-name",
  ])("cached route literal redacts %s before byte truncation", async (mode) => {
    pair();
    const flag = supported();
    try {
      const wire = request();
      wire.auth.apiKey = "fixturesecret";
      const child = lifecycleChild(JSON.stringify(wire));
      const progress: string[] = [];
      const run = runWorker(wire, new AbortController().signal, (text) =>
        progress.push(text),
      );
      if (mode === "malformed-tool") {
        const frames = workerFrames(child, "safe")
          .toString()
          .trimEnd()
          .split("\n");
        child.stdout.emit("data", Buffer.from(`${frames[0]}\n`));
        child.stdout.emit(
          "data",
          Buffer.from(
            `${JSON.stringify({ ...JSON.parse(frames[1]), event: { kind: "tool-start", name: proxy } })}\n`,
          ),
        );
      } else {
        const text = mode === "final" ? `safe ${proxy}` : "safe";
        child.stdout.emit(
          "data",
          workerFrames(
            child,
            text,
            mode === "tool-name" ? "fixturesecret" : undefined,
          ),
        );
        const bytes = Buffer.from(
          `${mode === "truncation" ? `${proxy} ${"x".repeat(70000)}` : "漢字 "}${proxy}`,
        );
        for (const chunk of [
          bytes.subarray(0, 2),
          bytes.subarray(2, bytes.length - 8),
          bytes.subarray(bytes.length - 8),
        ])
          child.stderr.emit("data", chunk);
      }
      child.emit("close", 0, null);
      const result = await run;
      expect(JSON.stringify({ result, progress })).not.toContain(proxy);
      expect(progress.join("\n")).not.toContain("fixturesecret");
      if (mode === "tool-name") expect(progress).toContain("Tool: [redacted]");
      expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(16384);
      expect(Buffer.byteLength(result.output)).toBeLessThanOrEqual(65536);
      if (mode === "malformed-tool") expect(result.outcome).toBe("failed");
      else {
        expect(result.outcome).toBe("completed");
        expect(result.output).toContain("[redacted]");
      }
      if (mode === "truncation") expect(result.output).toContain("[truncated]");
    } finally {
      flag.mockRestore();
    }
  });
});

describe("bounded real process owner", () => {
  it("parent checks inherit project environment without weakening SDK environment isolation", async () => {
    const cwd = temporary();
    const script = join(cwd, "check.cjs");
    writeFileSync(
      script,
      `if (process.env.CADENCE_PROJECT_SETTING !== 'project-value' || process.env.CADENCE_SUBAGENT_CHILD !== '1') process.exit(7); console.log('environment-ok');`,
    );
    vi.stubEnv("CADENCE_PROJECT_SETTING", "project-value");
    try {
      const command = `"${process.execPath}" check.cjs`;
      const check = await runCheck(
        { name: "environment", command, timeoutMs: 5000 },
        cwd,
        new AbortController().signal,
      );
      const shell =
        process.platform === "win32"
          ? (process.env.COMSPEC ?? "cmd.exe")
          : "/bin/sh";
      // Synthetic command/result only: never dump the inherited environment.
      const diagnostics = JSON.stringify({
        node: process.execPath,
        version: process.version,
        platform: process.platform,
        command,
        cwd,
        shell,
        windowsVerbatimArguments: process.platform === "win32",
        result: check,
      });
      expect(check.outcome, diagnostics).toBe("completed");
      expect(check.exitCode, diagnostics).toBe(0);
      expect(check.output, diagnostics).toContain("environment-ok");
      expect(check.closed, diagnostics).toBe(true);
      expect(check.truncated, diagnostics).toBe(false);
      const launch = launchCall();
      // Project before asserting, so a failing diff cannot print ambient auth.
      expect({
        command: launch?.[0],
        args: launch?.[1],
        cwd: launch?.[2]?.cwd,
        windowsVerbatimArguments: launch?.[2]?.windowsVerbatimArguments,
        projectSetting: launch?.[2]?.env?.CADENCE_PROJECT_SETTING,
        childGuard: launch?.[2]?.env?.CADENCE_SUBAGENT_CHILD,
      }).toEqual({
        command: shell,
        args:
          process.platform === "win32"
            ? ["/d", "/s", "/c", `"${command}"`]
            : ["-c", command],
        cwd,
        windowsVerbatimArguments:
          process.platform === "win32" ? true : undefined,
        projectSetting: "project-value",
        childGuard: "1",
      });
      const workerEnvironment = await node(
        "process.stdout.write(process.env.CADENCE_PROJECT_SETTING ?? 'absent')",
      );
      expect(workerEnvironment.output).toBe("absent");
      expect(launchCall()?.[2]?.windowsVerbatimArguments).toBeUndefined();
      expect(safeChildEnv()).not.toHaveProperty("CADENCE_PROJECT_SETTING");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("quoted executable, Unicode/space paths and arguments retain native shell redirection and chaining", async () => {
    const cwd = join(temporary(), "working 空格");
    mkdirSync(cwd);
    writeFileSync(
      join(cwd, "check 空格.cjs"),
      "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
    );
    const quotedArgument =
      process.platform === "win32" ? '"say \\"hello\\""' : "'say \"hello\"'";
    const command = `"${process.execPath}" "check 空格.cjs" "argument 空格" ${quotedArgument} > "result 空格.txt" && echo chain-ok`;
    const result = await runCheck(
      { name: "quoted control", command, timeoutMs: 5000 },
      cwd,
      new AbortController().signal,
    );
    const diagnostics = JSON.stringify({ command, cwd, result });
    expect(result.outcome, diagnostics).toBe("completed");
    expect(result.closed, diagnostics).toBe(true);
    expect(result.exitCode, diagnostics).toBe(0);
    expect(result.output, diagnostics).toContain("chain-ok");
    expect(
      JSON.parse(readFileSync(join(cwd, "result 空格.txt"), "utf8")),
    ).toEqual(["argument 空格", 'say "hello"']);
  });
  it("even tool-name progress redacts known request secrets", async () => {
    const progress: string[] = [];
    const result = await node(
      `process.stdout.write(${JSON.stringify(v2Frames("Done", undefined, "fixturesecret"))});`,
      {
        protocol: true,
        secrets: ["fixturesecret"],
        onProgress: (text) => progress.push(text),
      },
    );
    expect(result.outcome).toBe("completed");
    expect(progress.join("\n")).not.toContain("fixturesecret");
  });
  it("file-based auth refuses before child launch and tiny display budgets remain bounded", async () => {
    const result = await runWorker(
      {
        cwd: temporary(),
        model: {
          id: "fixture",
          provider: "fixture",
          api: "openai-completions",
        },
        auth: {
          ok: true,
          env: { AWS_SHARED_CREDENTIALS_FILE: "/fabricated/not-read" },
        },
        kind: "code",
        prompt: "",
        instructions: "",
      },
      new AbortController().signal,
    );
    expect(result.outcome).toBe("failed");
    expect(result.text).toContain("no worker launched");
    expect(
      Buffer.byteLength(diagnosticText("漢".repeat(20), 5)),
    ).toBeLessThanOrEqual(5);
  });
  it("malformed UTF-8 protocol refuses rather than replacing invalid bytes", async () => {
    const result = await node(
      `process.stdout.write(Buffer.concat([Buffer.from('{"type":"ready"}\\n{"type":"final","stopReason":"stop","text":"'),Buffer.from([255]),Buffer.from('"}\\n')]));`,
      { protocol: true },
    );
    expect(result.outcome).toBe("failed");
  });

  it("requires valid protocol final AND native zero close", async () => {
    const frames = `process.stdout.write(${JSON.stringify(v2Frames("Done"))});`;
    // Protocol-only fixtures may omit input: ignored EOF does not waive any
    // framing/final/close obligation. runWorker always supplies its JSON input.
    const complete = await node(frames, { protocol: true });
    expect(complete.outcome).toBe("completed");
    expect(complete).toMatchObject({ closed: true, exitCode: 0, text: "Done" });
    expect(launchCall()?.[2]?.stdio).toEqual(["ignore", "pipe", "pipe"]);
    for (const code of [
      "",
      "console.log('broken')",
      `${frames}process.exitCode=2;`,
      `process.stdout.write(${JSON.stringify(`${v2Frames("Done").split("\n")[0]}\n`)});`,
      `${frames}${frames}`,
    ])
      expect((await node(code, { protocol: true })).outcome).toBe("failed");
  }, 15000);
  it("output floods and nonzero checks never become completed", async () => {
    const flood = await node("process.stdout.write('x'.repeat(300000));");
    expect(flood.outcome).toBe("failed");
    expect(flood.truncated).toBe(true);
    const fail = await runCheck(
      { name: "fail", command: "exit 7", timeoutMs: 1000 },
      temporary(),
      new AbortController().signal,
    );
    expect(fail.exitCode).toBe(7);
    expect(fail.outcome).toBe("failed");
    const pass = await runCheck(
      { name: "pass", command: "echo check-output", timeoutMs: 1000 },
      temporary(),
      new AbortController().signal,
    );
    expect(pass.outcome).toBe("completed");
    expect(pass.closed).toBe(true);
    expect(pass.exitCode).toBe(0);
    expect(pass.output).toContain("check-output");
  });
  it("split UTF-8 and known secrets are buffered before redaction; control-safe byte limits", async () => {
    const code = `const b=Buffer.from('漢字 secret-value');process.stdout.write(b.subarray(0,2));setTimeout(()=>{process.stdout.write(b.subarray(2,10));setTimeout(()=>process.stdout.write(b.subarray(10)),5)},5);`;
    const result = await node(code, { secrets: ["secret-value"] });
    expect(result.output).toContain("漢字");
    expect(result.output).not.toContain("secret-value");
    expect(result.output).toContain("[redacted]");
    const safe = diagnosticText(
      "\x1b]52;c;secret\x07\x1b[31m漢".repeat(100),
      100,
    );
    expect(Buffer.byteLength(safe)).toBeLessThanOrEqual(100);
    expect(safe).not.toContain("\x1b");
    expect(safeChildEnv()).not.toHaveProperty("NODE_OPTIONS");
    expect(safeChildEnv()).not.toHaveProperty("OPENAI_API_KEY");
  });
  it("abort and timeout settle within declared stop bound even with TERM ignored", async () => {
    const abort = new AbortController();
    const run = node("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)", {
      signal: abort.signal,
    });
    setTimeout(() => abort.abort(), 150);
    const result = await run;
    expect(result.outcome).toBe("canceled");
    expect(result.closed).toBe(true);
    expect(result.durationMs).toBeLessThan(3500);
    const timed = await node("setInterval(()=>{},1000)", { timeoutMs: 100 });
    expect(timed.outcome).toBe("timeout");
  }, 10000);
});

describe("readonly dirty/change observations", () => {
  it.skipIf(process.platform === "win32")(
    "Git root resolution preserves trailing whitespace in real checkout paths",
    () => {
      for (const suffix of [" ", "\t", "\r", "\n"]) {
        const root = join(
          temporary(),
          `checkout with trailing whitespace${suffix}`,
        );
        mkdirSync(root);
        expect(spawnSync("git", ["init", "-q"], { cwd: root }).status).toBe(0);
        const cwd = join(root, "nested");
        mkdirSync(cwd);
        expect(resolveWorkspace(cwd)).toEqual({
          root: realpathSync(root),
          cwd: realpathSync(cwd),
        });
      }
    },
  );
  function repository() {
    const root = temporary();
    const git = (...args: string[]) => {
      const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout;
    };
    git("init", "-q");
    git("config", "user.name", "fixture");
    git("config", "user.email", "fixture@example.invalid");
    writeFileSync(join(root, "tracked.txt"), "before\n");
    writeFileSync(join(root, "deleted.txt"), "before\n");
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 1, 2]));
    git("add", ".");
    return { root, git };
  }
  it("includes staged/unstaged/untracked/binary/deletion and keeps index bytes unchanged", () => {
    const { root, git } = repository();
    writeFileSync(join(root, "tracked.txt"), "staged\n");
    git("add", "tracked.txt");
    writeFileSync(join(root, "tracked.txt"), "unstaged\n");
    unlinkSync(join(root, "deleted.txt"));
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 3, 4]));
    writeFileSync(join(root, "untracked 漢.txt"), "new");
    const index = readFileSync(join(root, ".git", "index"));
    const view = captureChanges(root);
    expect(view.text).toContain("Staged");
    expect(view.text).toContain("Unstaged");
    expect(view.text).toContain("deleted.txt");
    expect(view.text).toContain("binary.bin");
    expect(view.text).toContain("untracked 漢.txt");
    expect(view.text).toContain("pre-existing dirt");
    expect(readFileSync(join(root, ".git", "index"))).toEqual(index);
    const before = view.fingerprint;
    writeFileSync(join(root, "binary.bin"), Buffer.from([0, 5, 6]));
    expect(captureChanges(root).fingerprint).not.toBe(before);
    mkdirSync(join(root, "nested"));
    expect(resolveWorkspace(join(root, "nested"))).toEqual({
      root,
      cwd: join(root, "nested"),
    });
  });
  it("gitlinks explicitly limit review coverage even when Git configuration hides submodule dirt", () => {
    const { root, git } = repository();
    const tree = git("write-tree").trim();
    const commit = git("commit-tree", tree, "-m", "fixture base").trim();
    git("update-ref", "HEAD", commit);
    // A fixture gitlink is enough to expose uninspected nested content, without
    // downloading/initializing any submodule or executing its configuration.
    git(
      "update-index",
      "--add",
      "--cacheinfo",
      `160000,${commit},nested-module`,
    );
    git("config", "diff.ignoreSubmodules", "all");
    const index = readFileSync(join(root, ".git", "index"));
    const view = captureChanges(root);
    expect(view.complete).toBe(false);
    expect(view.text).toContain(
      "Submodule content not inspected: nested-module",
    );
    expect(readFileSync(join(root, ".git", "index"))).toEqual(index);
  });
  it("own task records do not stale business inputs; config and ignored coverage are visible", () => {
    const { root } = repository();
    const before = captureChanges(root);
    mkdirSync(join(root, ".cadence", "assistant", "tasks", "fixture"), {
      recursive: true,
    });
    writeFileSync(
      join(root, ".cadence", "assistant", "tasks", "fixture", "task.json"),
      "admin",
    );
    expect(captureChanges(root).fingerprint).toBe(before.fingerprint);
    writeFileSync(join(root, ".cadence", "assistant", "config.json"), "{}");
    expect(captureChanges(root).fingerprint).not.toBe(before.fingerprint);
    writeFileSync(join(root, ".gitignore"), "ignored\n");
    writeFileSync(join(root, "ignored"), "private");
    expect(captureChanges(root).complete).toBe(false);
  });
  it("an output-limited Git observation keeps one identity for an unchanged tree", () => {
    const { root } = repository();
    // The killed diff's partial stdout varies with pipe timing; hashing it made
    // every preflight of an unchanged tree stale.
    writeFileSync(join(root, "tracked.txt"), "changed line\n".repeat(100_000));
    const views = Array.from({ length: 4 }, () =>
      captureChanges(root, 64 * 1024),
    );
    expect(new Set(views.map((view) => view.fingerprint)).size).toBe(1);
    // Only the fixed outcome is hashed: bytes inside limited output are
    // unobserved (labeled incomplete), while other observations still count.
    writeFileSync(
      join(root, "tracked.txt"),
      `other start\n${"changed line\n".repeat(100_000)}`,
    );
    expect(captureChanges(root, 64 * 1024).fingerprint).toBe(
      views[0].fingerprint,
    );
    expect(views[0].complete).toBe(false);
    expect(views[0].text).toContain(
      "Unavailable/limited Git observation: diff (ENOBUFS)",
    );
    writeFileSync(join(root, "untracked.txt"), "new");
    expect(captureChanges(root, 64 * 1024).fingerprint).not.toBe(
      views[0].fingerprint,
    );
  });
  it("a wholly ignored directory is one uninspected entry", () => {
    const { root } = repository();
    writeFileSync(join(root, ".gitignore"), "build/\n*.env\n");
    mkdirSync(join(root, "build"));
    writeFileSync(join(root, "build", "a.o"), "a");
    const before = captureChanges(root);
    expect(before.complete).toBe(false);
    expect(before.text).toContain("Ignored files exist");
    writeFileSync(join(root, "build", "b.o"), "b");
    expect(captureChanges(root).fingerprint).toBe(before.fingerprint);
    writeFileSync(join(root, "local.env"), "x");
    expect(captureChanges(root).fingerprint).not.toBe(before.fingerprint);
  });
  it("real check edits invalidate check freshness while exit remains factual", async () => {
    const { root } = repository();
    const store = new TaskStore(root, join(temporary(), "state"));
    const controller = new TaskController(store, root);
    controller.create("code", "Test check freshness");
    await controller.check(
      controller.choice(),
      {
        name: "changes",
        command: "echo changed > tracked.txt",
        timeoutMs: 1000,
      },
      () => true,
    );
    expect(controller.current?.checks[0].exitCode).toBe(0);
    expect(controller.current?.checks[0].status).toBe("stale");
  });
  it("non-Git inventories additions/deletions and labels bounded omissions", () => {
    const root = temporary();
    writeFileSync(join(root, "file"), "one");
    const first = captureChanges(root);
    expect(first.git).toBe(false);
    expect(first.text).toContain("Non-Git");
    writeFileSync(join(root, "new"), "new");
    expect(captureChanges(root).fingerprint).not.toBe(first.fingerprint);
    unlinkSync(join(root, "file"));
    writeFileSync(join(root, "huge"), Buffer.alloc(1024 * 1024 + 1));
    expect(captureChanges(root).complete).toBe(false);
  });
});

it.each(["timeout", "protocol"] as const)(
  "automatic %s stop checks a lost/throwing service lease before TERM and KILL (injected native handle)",
  async (cause) => {
    vi.useFakeTimers();
    const child = lifecycleChild();
    const guard = vi.fn(() => {
      if (cause === "protocol") throw new Error("injected lost lease");
      return false;
    });
    try {
      const original = node("unused injected process", {
        timeoutMs: 100,
        protocol: cause === "protocol",
        maySignal: guard,
      });
      if (cause === "protocol")
        child.stdout.emit("data", Buffer.from("not-json\n"));
      else await vi.advanceTimersByTimeAsync(100);
      expect(guard).toHaveBeenCalledTimes(1);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1000);
      expect(guard).toHaveBeenCalledTimes(2);
      expect(child.kill).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2000);
      const result = await original;
      expect(result).toMatchObject({
        outcome: "unknown",
        closed: false,
        exitCode: null,
        signal: null,
      });
      child.emit("close", 0, null);
      expect(await original).toBe(result);
    } finally {
      vi.useRealTimers();
    }
  },
);

it("service signal guard rechecks TERM and KILL separately and unknown is not close (injected native handle)", async () => {
  vi.useFakeTimers();
  const child = lifecycleChild();
  const abort = new AbortController();
  let owned = true;
  const guard = vi.fn(() => owned);
  try {
    const original = node("unused injected process", {
      signal: abort.signal,
      maySignal: guard,
    });
    abort.abort();
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGTERM");
    owned = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(child.kill).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await original).toMatchObject({
      outcome: "unknown",
      closed: false,
      exitCode: null,
      signal: null,
    });
  } finally {
    vi.useRealTimers();
  }
});
