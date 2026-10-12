import { spawn, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditPackage } from "../scripts/package-audit.mjs";

const root = path.resolve(import.meta.dirname, "..");
const expected = JSON.parse(
  readFileSync(path.join(root, "provenance/package-members.json"), "utf8"),
);
let fixture, archive, installed;
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: 30000,
    ...options,
  });
  if (result.error || result.status !== 0)
    throw new Error(`${command}: ${result.error ?? result.stderr}`);
  return result.stdout;
};
beforeAll(() => {
  fixture = mkdtempSync(path.join(tmpdir(), "cadence-distribution-"));
  const pack = path.join(fixture, "pack");
  mkdirSync(pack);
  if (process.env.CADENCE_TEST_ARCHIVE) {
    archive = path.resolve(process.env.CADENCE_TEST_ARCHIVE);
  } else {
    run("bun", ["pm", "pack", "--destination", pack], { cwd: root });
    const archives = readdirSync(pack);
    expect(archives).toHaveLength(1);
    archive = path.join(pack, archives[0]);
  }
  // Audit before extraction; unsafe/link/duplicate archive entries refuse.
  auditPackage(archive, root, expected);
  run("tar", ["xzf", archive, "-C", fixture]);
  installed = path.join(
    fixture,
    "consumer 空格 & %PATH% ! (pkg)/node_modules/@abelxiaoxing/cadence",
  );
  mkdirSync(path.dirname(installed), { recursive: true });
  cpSync(path.join(fixture, "package"), installed, { recursive: true });
  for (const name of ["@earendil-works", "typebox"]) {
    symlinkSync(
      path.join(root, "node_modules", name),
      path.join(fixture, "consumer 空格 & %PATH% ! (pkg)/node_modules", name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}, 60000);
// Retain bounded fixture receipts for review, including any failed execution.
afterAll(() => console.log(`distribution fixture retained: ${fixture}`));

describe("real lightweight package", () => {
  it("audits exactly 34 unique regular members, every source body and all Agent pins", () => {
    expect(expected).toHaveLength(34);
    const audit = auditPackage(archive, root, expected);
    expect(audit.members).toEqual(expected);
    expect(Object.keys(audit.bodyHashes)).toHaveLength(34);
    expect(expected.filter((p) => p.startsWith("package/src/"))).toHaveLength(
      16,
    );
    expect(expected.join("\n")).not.toMatch(
      /sqlite|workspace-io|windows-job|apply-transaction|compiler|scheduler/,
    );
  });

  it("source and extracted readonly operators preserve old bytes and absent state, refusing all task control", () => {
    const cwd = path.join(fixture, "old consumer 空格 & ;");
    mkdirSync(cwd);
    const sentinels = [
      ".cadence/old.sqlite",
      ".pi/sessions/old.jsonl",
      "openspec/tasks.md",
      ".git/index",
      ".git/config",
      "bun.lock",
      "package-lock.json",
      "package.json",
    ];
    for (const file of sentinels) {
      mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
      writeFileSync(path.join(cwd, file), `retained ${file}\n`);
    }
    const env = {
      ...process.env,
      XDG_STATE_HOME: path.join(fixture, "private-state"),
    };
    for (const packageRoot of [root, installed]) {
      const cli = path.join(packageRoot, "src/operator-cli.mjs");
      expect(
        JSON.parse(run(process.execPath, [cli, "doctor", cwd], { env })),
      ).toMatchObject({
        ok: true,
        taskCount: 0,
        checks: [],
        checkStatus: "not-run",
        coordination: "unlocked",
      });
      expect(
        JSON.parse(run(process.execPath, [cli, "runs", cwd], { env })),
      ).toMatchObject({ ok: true, tasks: [] });
      for (const action of ["start", "reset", "recover", "run"]) {
        expect(
          spawnSync(process.execPath, [cli, action, cwd], {
            env,
            timeout: 10000,
          }).status,
        ).toBe(1);
      }
    }
    for (const file of sentinels)
      expect(readFileSync(path.join(cwd, file), "utf8")).toBe(
        `retained ${file}\n`,
      );
    expect(existsSync(path.join(cwd, ".cadence/assistant"))).toBe(false);
    expect(existsSync(env.XDG_STATE_HOME)).toBe(false);
  }, 30000);

  it("extracted operator refuses corrupt new configuration without resetting it", () => {
    const cwd = path.join(fixture, "corrupt");
    mkdirSync(path.join(cwd, ".cadence/assistant"), { recursive: true });
    const file = path.join(cwd, ".cadence/assistant/config.json");
    writeFileSync(file, "{unknown secret=do-not-display");
    const result = spawnSync(
      process.execPath,
      [path.join(installed, "src/operator-cli.mjs"), "doctor", cwd],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).not.toContain("do-not-display");
    expect(readFileSync(file, "utf8")).toBe("{unknown secret=do-not-display");
  });

  it("loads actual source/extracted extension and independent skills with no prompt aliases or extra task tools", async () => {
    const { DefaultResourceLoader, SettingsManager } = await import(
      "@earendil-works/pi-coding-agent"
    );
    for (const packageRoot of [root, installed]) {
      const cwd = path.join(
        fixture,
        packageRoot === root ? "source-loader" : "extracted-loader",
      );
      mkdirSync(cwd);
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir: path.join(cwd, "agent"),
        settingsManager: SettingsManager.inMemory(),
        additionalExtensionPaths: [path.join(packageRoot, "src/index.ts")],
        additionalSkillPaths: [path.join(packageRoot, "skills")],
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      const extensions = loader.getExtensions().extensions;
      expect(extensions).toHaveLength(1);
      expect([...extensions[0].commands.keys()]).toEqual(["cadence"]);
      expect(extensions[0].tools.size).toBe(0);
      expect(loader.getPrompts().prompts).toEqual([]);
      expect(
        loader
          .getSkills()
          .skills.map((s) => s.name)
          .sort(),
      ).toEqual(["context7-auto-research", "git-commit", "grok-search"]);
      expect(existsSync(path.join(cwd, ".cadence"))).toBe(false);
    }
  }, 20000);

  it("installed SDK child runs an actual loopback tool cycle with literal auth and no TypeScript/source fallback", async () => {
    const cwd = path.join(fixture, "sdk-consumer");
    mkdirSync(cwd);
    const requests = [];
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const part of req) raw += part;
      const body = JSON.parse(raw);
      requests.push({ body, headers: req.headers, path: req.url });
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      const emit = (delta, finish_reason = null) =>
        res.write(
          `data: ${JSON.stringify({ id: "installed", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      if (requests.length === 1) {
        emit({
          role: "assistant",
          tool_calls: [
            {
              index: 0,
              id: "fixture_write",
              type: "function",
              function: {
                name: "write",
                arguments: JSON.stringify({
                  path: "installed.txt",
                  content: "actual-sdk",
                }),
              },
            },
          ],
        });
        emit({}, "tool_calls");
      } else {
        emit({ role: "assistant", content: "INSTALLED_OK" });
        emit({}, "stop");
      }
      res.end("data: [DONE]\n\n");
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
      const child = spawn(
        process.execPath,
        [path.join(installed, "src/sdk-worker.mjs")],
        {
          cwd,
          env: {
            PATH: process.env.PATH,
            HOME: cwd,
            USERPROFILE: cwd,
            PI_OFFLINE: "1",
            CADENCE_SUBAGENT_CHILD: "1",
          },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (b) => {
        stdout += b;
      });
      child.stderr.on("data", (b) => {
        stderr += b;
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), 15000);
      const closed = new Promise((resolve, reject) => {
        child.on("error", reject);
        child.on("close", (code) => resolve(code));
      });
      child.stdin.end(
        JSON.stringify({
          cwd,
          kind: "code",
          model: {
            provider: "installed-fixture",
            id: "exact-model",
            name: "Fixture",
            api: "openai-completions",
            baseUrl,
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 8192,
            maxTokens: 128,
            compat: { supportsDeveloperRole: false },
          },
          auth: {
            ok: true,
            apiKey: "!fixture-$LITERAL",
            headers: { "X-Literal": "!header-$LITERAL" },
          },
          thinkingLevel: "off",
          instructions: "Synthetic local fixture only.",
          prompt: "Write installed.txt then finish.",
        }),
      );
      let code;
      try {
        code = await closed;
      } finally {
        clearTimeout(timer);
      }
      expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
      expect(stdout).toContain("INSTALLED_OK");
      expect(stdout).not.toContain("!fixture");
      expect(requests).toHaveLength(2);
      for (const request of requests) {
        expect(request.body.model).toBe("exact-model");
        expect(request.headers.authorization).toBe("Bearer !fixture-$LITERAL");
        expect(request.headers["x-literal"]).toBe("!header-$LITERAL");
        expect(request.path).toBe("/v1/chat/completions");
      }
      expect(requests[1].body.messages.some((m) => m.role === "tool")).toBe(
        true,
      );
      expect(readFileSync(path.join(cwd, "installed.txt"), "utf8")).toBe(
        "actual-sdk",
      );
      expect(readdirSync(cwd)).toEqual(["installed.txt"]);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  }, 20000);
});

it("actual source/extracted nonterminal CLI command dispatch cannot create or start a task", () => {
  const cli = path.join(
    root,
    "node_modules/@earendil-works/pi-coding-agent/dist/cli.js",
  );
  for (const packageRoot of [root, installed])
    for (const mode of ["json", "text"]) {
      const cwd = path.join(
        fixture,
        `nonterminal-${packageRoot === root ? "source" : "installed"}-${mode}`,
      );
      mkdirSync(cwd);
      const home = path.join(cwd, "home");
      mkdirSync(home);
      const agent = path.join(home, "agent");
      mkdirSync(agent);
      writeFileSync(
        path.join(agent, "settings.json"),
        JSON.stringify({
          packages: [],
          extensions: [],
          skills: [],
          prompts: [],
          themes: [],
          cacheWarming: "off",
          retry: { enabled: false },
          enableInstallTelemetry: false,
        }),
      );
      const result = spawnSync(
        process.execPath,
        [
          cli,
          "--offline",
          "--approve",
          "--no-session",
          "--no-context-files",
          "--no-extensions",
          "--no-skills",
          "--no-prompt-templates",
          "--no-themes",
          "--extension",
          path.join(packageRoot, "src/index.ts"),
          "--mode",
          mode,
          "--print",
          "/cadence inert",
        ],
        {
          cwd,
          input: "",
          encoding: "utf8",
          timeout: 15000,
          env: {
            PATH: process.env.PATH,
            HOME: home,
            USERPROFILE: home,
            PI_CODING_AGENT_DIR: agent,
            XDG_STATE_HOME: path.join(home, "state"),
            PI_OFFLINE: "1",
            PI_SKIP_VERSION_CHECK: "1",
            PI_TELEMETRY: "0",
          },
        },
      );
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout + result.stderr).not.toMatch(
        /legacy history is not imported|Cadence foreground work/,
      );
      expect(existsSync(path.join(cwd, ".cadence"))).toBe(false);
      expect(existsSync(path.join(home, "state/cadence-assistant-v1"))).toBe(
        false,
      );
    }
}, 60000);

it("shipped check example is decoded by the extracted readonly operator without executing it", () => {
  const cwd = path.join(fixture, "configured");
  mkdirSync(path.join(cwd, ".cadence/assistant"), { recursive: true });
  const example = readFileSync(
    path.join(installed, "config/workflow-task.example.json"),
  );
  const config = path.join(cwd, ".cadence/assistant/config.json");
  writeFileSync(config, example);
  const result = JSON.parse(
    run(
      process.execPath,
      [path.join(installed, "src/operator-cli.mjs"), "doctor", cwd],
      {
        env: {
          ...process.env,
          XDG_STATE_HOME: path.join(fixture, "config-state"),
        },
      },
    ),
  );
  expect(result).toMatchObject({
    ok: true,
    taskCount: 0,
    checkStatus: "not-run",
    checks: [
      { name: "Type check", timeoutMs: 120000 },
      { name: "Tests", timeoutMs: 120000 },
    ],
  });
  expect(readFileSync(config)).toEqual(example);
  expect(existsSync(path.join(cwd, ".cadence/assistant/tasks"))).toBe(false);
  expect(existsSync(path.join(fixture, "config-state"))).toBe(false);
});
