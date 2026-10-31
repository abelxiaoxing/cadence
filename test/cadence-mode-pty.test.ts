import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, it } from "vitest";

it.skipIf(process.platform === "win32")(
  "actual Pi TUI: one activation governs two ordinary turns, explicit exit restores built-in tools",
  async () => {
    const root = mkdtempSync(join(tmpdir(), "cadence-mode-pty-"));
    const project = join(root, "project"),
      agent = join(root, "agent"),
      sessions = join(root, "sessions");
    for (const dir of [project, agent, sessions, join(root, "home")])
      mkdirSync(dir, { mode: 0o700 });
    const requests: any[] = [];
    let investigated = false,
      answers = 0;
    const server = createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c);
      const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      requests.push(input);
      const main = input.tools.some(
        (t: any) => t.function.name === "cadence_research",
      );
      const ordinary = input.tools.some(
        (t: any) => t.function.name === "write",
      );
      const investigate = main && !investigated;
      if (investigate) investigated = true;
      const first = investigate
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "investigate",
                type: "function",
                function: {
                  name: "cadence_research",
                  arguments: JSON.stringify({
                    goal: "Understand this project",
                    questions: [
                      "Identify project instructions and verification commands without editing.",
                    ],
                  }),
                },
              },
            ],
          }
        : {
            role: "assistant",
            content:
              main || ordinary
                ? `MODE-ANSWER-${++answers}`
                : "Readonly fixture repository evidence.",
          };
      res.writeHead(200, {
        "content-type": "text/event-stream",
        connection: "close",
      });
      for (const [delta, finish_reason] of [
        [first, null],
        [{}, investigate ? "tool_calls" : "stop"],
      ])
        res.write(
          `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
        );
      res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const address = server.address();
    if (!address || typeof address === "string") throw Error("provider");
    writeFileSync(
      join(agent, "models.json"),
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
    writeFileSync(
      join(agent, "auth.json"),
      JSON.stringify({
        fixture: { type: "api_key", key: "fixture-native-mode-key" },
      }),
      { mode: 0o600 },
    );
    writeFileSync(
      join(agent, "settings.json"),
      JSON.stringify({
        defaultProjectTrust: "always",
        quietStartup: true,
        theme: "dark",
      }),
      { mode: 0o600 },
    );
    const config = join(root, "driver.json");
    const env = {
      PATH: process.env.PATH,
      HOME: join(root, "home"),
      PI_CODING_AGENT_DIR: agent,
      XDG_STATE_HOME: join(root, "state"),
      TERM: "xterm-256color",
      PI_OFFLINE: "1",
      PI_SKIP_VERSION_CHECK: "1",
      PI_TELEMETRY: "0",
      CADENCE_AGENT_PANEL: "off",
      TMPDIR: root,
      TEMP: root,
      TMP: root,
    };
    writeFileSync(
      config,
      JSON.stringify({
        root,
        cwd: project,
        env,
        argv: [
          process.execPath,
          resolve(
            "node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js",
          ),
          "--no-extensions",
          "--extension",
          resolve("src/index.ts"),
          "--session-dir",
          sessions,
          "--provider",
          "fixture",
          "--model",
          "fixed",
          "--thinking",
          "off",
        ],
      }),
    );
    try {
      const child = spawn(
        "python3",
        [resolve("test/helpers/cadence-mode-pty.py"), config],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      let error = "";
      child.stderr.on("data", (b) => {
        error += b;
      });
      const code = await new Promise<number | null>((resolve, reject) => {
        child.on("error", reject);
        child.on("close", resolve);
      });
      expect(
        code,
        `${error}\n${root}\n${readFileSync(join(root, "terminal-output.bin"), "utf8").slice(-8000)}`,
      ).toBe(0);
      const main = requests.filter((r) =>
        r.tools.some((t: any) => t.function.name === "cadence_research"),
      );
      expect(main).toHaveLength(3);
      for (const input of main) {
        expect(input.tools.map((t: any) => t.function.name)).not.toContain(
          "write",
        );
        expect(JSON.stringify(input.messages)).toContain(
          "CADENCE CONVERSATION MODE",
        );
      }
      const worker = requests.filter(
        (r) =>
          !r.tools.some((t: any) =>
            ["cadence_research", "write"].includes(t.function.name),
          ),
      );
      expect(worker).toHaveLength(1);
      expect(worker[0].tools.map((t: any) => t.function.name)).toContain(
        "read",
      );
      expect(worker[0].tools.map((t: any) => t.function.name)).not.toContain(
        "bash",
      );
      const last = requests.at(-1).tools.map((t: any) => t.function.name);
      expect(last).toContain("write");
      expect(last).not.toContain("cadence_start");
      expect(
        JSON.parse(readFileSync(join(agent, "cadence/settings.json"), "utf8"))
          .model,
      ).toEqual({
        provider: "fixture",
        model: "fixed",
        api: "openai-completions",
        thinking: "off",
      });
    } finally {
      const stopped = spawnSync(
        process.execPath,
        [
          resolve("src/service-cli.mjs"),
          "stop",
          "--workspace",
          project,
          "--state-home",
          join(root, "state"),
        ],
        { env, encoding: "utf8", timeout: 10000 },
      );
      writeFileSync(
        join(root, "stop-result.json"),
        JSON.stringify({
          status: stopped.status,
          stdout: stopped.stdout,
          stderr: stopped.stderr,
        }),
      );
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      expect(stopped.status).toBe(0);
      expect(JSON.parse(stopped.stdout).status).toBe("stopped");
    }
  },
  30000,
);
