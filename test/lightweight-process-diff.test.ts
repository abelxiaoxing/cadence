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
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  runCheck,
  runProcess,
  runWorker,
  safeChildEnv,
} from "../src/subagent-process.ts";
import { TaskController } from "../src/task-controller.ts";
import { captureChanges } from "../src/task-diff.ts";
import { resolveWorkspace, TaskStore } from "../src/task-store.ts";
import { diagnosticText } from "../src/verification-diagnostics.ts";

// Observe actual launch arguments without replacing native execution.
vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return { ...original, spawn: vi.fn(original.spawn) };
});

const nativeSpawn = vi.mocked(spawn).getMockImplementation() as typeof spawn;
const temporary = () => mkdtempSync(join(tmpdir(), "cadence-lw-native-"));
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
  const stream = () =>
    Object.assign(new EventEmitter(), {
      end: vi.fn(),
      destroy: vi.fn(),
    });
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

const validFrames = Buffer.from(
  '{"type":"ready"}\n{"type":"final","text":"transport-final","stopReason":"stop"}\n',
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
    const launch = vi.mocked(spawn).mock.lastCall;
    const child = vi.mocked(spawn).mock.results.at(-1)?.value;
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
      expect(vi.mocked(spawn).mock.lastCall?.[2]?.stdio).toEqual([
        "ignore",
        "pipe",
        "pipe",
      ]);
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
        const child = vi.mocked(spawn).mock.results.at(-1)?.value;
        expect(vi.mocked(spawn).mock.lastCall?.[2]?.stdio).toEqual([
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
        model: {},
        auth: { ok: true as const },
        kind: "code" as const,
        prompt: "synthetic payload",
        instructions: "fixture only",
      };
      const input = JSON.stringify(request);
      const child = lifecycleChild(input);
      const run = runWorker(request, new AbortController().signal);
      expect(vi.mocked(spawn).mock.lastCall?.[2]?.stdio).toEqual([
        "pipe",
        "pipe",
        "pipe",
      ]);
      expect(child.stdin?.end).toHaveBeenCalledExactlyOnceWith(input);
      expect(Buffer.byteLength(input)).toBeLessThanOrEqual(128 * 1024);
      let settled = false;
      void run.then(() => {
        settled = true;
      });
      // The production data handler synchronously parses both valid frames.
      // The no-error twin below proves the same frames yield the final text.
      child.stdout.emit("data", validFrames);
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
      expect(vi.mocked(spawn).mock.lastCall?.[2]?.stdio).toEqual([
        "ignore",
        "pipe",
        "pipe",
      ]);
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
      const launch = vi.mocked(spawn).mock.lastCall;
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
      expect(
        vi.mocked(spawn).mock.lastCall?.[2]?.windowsVerbatimArguments,
      ).toBeUndefined();
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
      `for (const event of [{type:'ready'},{type:'tool',name:'fixturesecret'},{type:'final',text:'Done',stopReason:'stop'}]) console.log(JSON.stringify(event));`,
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
        model: {},
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
    const frames = `console.log(JSON.stringify({type:'ready'}));console.log(JSON.stringify({type:'final',text:'Done',stopReason:'stop'}));`;
    // Protocol-only fixtures may omit input: ignored EOF does not waive any
    // framing/final/close obligation. runWorker always supplies its JSON input.
    const complete = await node(frames, { protocol: true });
    expect(complete.outcome).toBe("completed");
    expect(complete).toMatchObject({ closed: true, exitCode: 0, text: "Done" });
    expect(vi.mocked(spawn).mock.lastCall?.[2]?.stdio).toEqual([
      "ignore",
      "pipe",
      "pipe",
    ]);
    for (const code of [
      "",
      "console.log('broken')",
      `${frames}process.exitCode=2;`,
      `console.log(JSON.stringify({type:'ready'}));`,
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
  it.skipIf(process.platform === "win32")(
    "held descendant pipe exposes unknown stop, not false closure (POSIX lane)",
    async () => {
      const started = Date.now();
      const run = await node(
        `const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},4500)'],{detached:true,stdio:['ignore',1,2]}).unref();`,
        { timeoutMs: 300 },
      );
      expect(run.closed).toBe(false);
      expect(run.outcome).toBe("unknown");
      // Wait for fixture's bounded escaped process natural exit. Unknown original receipt is not repaired.
      await new Promise((resolve) =>
        setTimeout(resolve, Math.max(0, 5000 - (Date.now() - started))),
      );
    },
    10000,
  );
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
