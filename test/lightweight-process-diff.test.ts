import { spawnSync } from "node:child_process";
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
      const check = await runCheck(
        {
          name: "environment",
          command: `"${process.execPath}" check.cjs`,
          timeoutMs: 5000,
        },
        cwd,
        new AbortController().signal,
      );
      expect(check.outcome).toBe("completed");
      expect(check.exitCode).toBe(0);
      expect(check.output).toContain("environment-ok");
      const workerEnvironment = await node(
        "process.stdout.write(process.env.CADENCE_PROJECT_SETTING ?? 'absent')",
      );
      expect(workerEnvironment.output).toBe("absent");
      expect(safeChildEnv()).not.toHaveProperty("CADENCE_PROJECT_SETTING");
    } finally {
      vi.unstubAllEnvs();
    }
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
    expect((await node(frames, { protocol: true })).outcome).toBe("completed");
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
