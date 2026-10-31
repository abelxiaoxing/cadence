/** Isolated real host/SDK/check fixture. Only the numeric-loopback provider is fabricated. */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nativeCall } from "../../src/service/cli.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { createServiceHost } from "../../src/service/host.ts";
import { type HostInput, readHostConfig } from "../../src/service/runtime.ts";
import { ServiceClient } from "../../src/service-client.ts";
import { HttpServiceTransport } from "../../src/service-http-client.ts";
import { nativeBuild, sourceContract } from "./source-build.ts";
import { windowsSystemEnvironment } from "./windows-environment.ts";
import { plan as workflowPlan } from "./workflow-plan.ts";

export async function acceptingFixture(
  mode: "source" | "generated",
  environment?: (env: NodeJS.ProcessEnv) => void,
  proxy: HostInput["config"]["http"]["proxy"] = null,
  options: { rootName?: string; accessToken?: string } = {},
) {
  const packageRoot = process.env.CADENCE_TEST_PACKAGE_ROOT;
  const dir = mkdtempSync(join(tmpdir(), "accepting-"));
  const rootName = options.rootName ?? "project";
  for (const name of [rootName, "agent", "home", "tmp"])
    mkdirSync(join(dir, name), { mode: 0o700 });
  const root = join(dir, rootName),
    agentDir = join(dir, "agent");
  let providerMode:
    | "coordinator"
    | "workflow-parallel"
    | "workflow"
    | "single"
    | "parallel"
    | "pending"
    | "failure"
    | "write"
    | "read-then-fail" = "single";
  let finalReply: string | undefined;
  let contacts = 0,
    active = 0,
    maxActive = 0;
  const held: ServerResponse[] = [];
  const workflowWrites: { res: ServerResponse; path: string }[] = [];
  const observations: { tools: string[]; mode: string; messages: unknown[] }[] =
    [];
  const longText = `Actual retained SDK result. ${"retained-detail-αβγ ".repeat(900)} END-RETAINED`;
  function finish(res: ServerResponse, text = longText) {
    text = finalReply ?? text;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      connection: "close",
    });
    for (const [delta, finish_reason] of [
      [{ role: "assistant", content: text }, null],
      [{}, "stop"],
    ])
      res.write(
        `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      );
    // Like real OpenAI-compatible servers given include_usage; Pi then adds usage.reasoning.
    res.write(
      `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixed", choices: [], usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5, completion_tokens_details: { reasoning_tokens: 1 } } })}\n\n`,
    );
    res.end("data: [DONE]\n\n");
  }
  function callTool(
    res: ServerResponse,
    id: string,
    name: string,
    args: object,
  ) {
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
              id,
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
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
  }
  const provider = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const input = JSON.parse(Buffer.concat(chunks).toString());
    contacts++;
    active++;
    maxActive = Math.max(maxActive, active);
    observations.push({
      tools: (input.tools ?? []).map(
        (t: { function: { name: string } }) => t.function.name,
      ),
      mode: providerMode,
      messages: input.messages ?? [],
    });
    res.once("close", () => {
      active--;
    });
    const toolNames = (input.tools ?? []).map(
      (t: { function: { name: string } }) => t.function.name,
    );
    if (
      providerMode === "coordinator" &&
      toolNames.includes("cadence_research")
    ) {
      const last = input.messages.at(-1);
      const user =
        typeof last?.content === "string"
          ? last.content
          : (last?.content ?? [])
              .map((c: { text?: string }) => c.text ?? "")
              .join("");
      if (last?.role === "tool") {
        finish(
          res,
          String(last.content).includes("proposalId")
            ? "The complete plan is ready for your approval."
            : "Investigation complete. Should we write both files?",
        );
      } else if (JSON.stringify(last?.content).includes("plan now")) {
        const proposal = workflowPlan();
        if (user.includes("working-copy")) proposal.delivery = "working-copy";
        callTool(res, "coordinator-plan", "cadence_plan", proposal);
      } else if (JSON.stringify(last?.content).includes("status")) {
        callTool(res, "coordinator-status", "cadence_status", {});
      } else if (user.trim() === "/cadence")
        finish(res, "Cadence is on. What would you like to accomplish?");
      else
        callTool(res, "coordinator-research", "cadence_research", {
          goal: "Inspect fixture",
          questions: ["Read existing.txt; preserve it."],
        });
      return;
    }
    if (
      providerMode === "coordinator" &&
      !toolNames.includes("write") &&
      !JSON.stringify(input.messages).includes(
        "Independently inspect the implemented files",
      )
    ) {
      if (input.messages.at(-1)?.role === "tool")
        finish(res, "Existing project evidence was read, not changed.");
      else callTool(res, "coordinator-read", "read", { path: "existing.txt" });
      return;
    }
    if (
      providerMode === "coordinator" ||
      providerMode === "workflow" ||
      providerMode === "workflow-parallel"
    ) {
      const prompt = JSON.stringify(input.messages);
      if (prompt.includes("Independently inspect the implemented files")) {
        finish(
          res,
          JSON.stringify({
            approved: true,
            summary: "Fixture review, not human review",
            blockingIssues: [],
          }),
        );
      } else if (input.messages.at(-1)?.role === "tool")
        finish(res, "Implemented the declared file.");
      else {
        const path = prompt.includes("Write only these exact files: a.txt")
          ? "a.txt"
          : "b.txt";
        if (
          providerMode === "workflow-parallel" &&
          prompt.includes("Write only these exact files:")
        ) {
          workflowWrites.push({ res, path });
          if (workflowWrites.length === 2)
            for (const item of workflowWrites.splice(0))
              callTool(item.res, `workflow-${item.path}`, "write", {
                path: item.path,
                content: `implemented ${item.path}\n`,
              });
        } else
          callTool(res, `workflow-${path}`, "write", {
            path,
            content: `implemented ${path}\n`,
          });
      }
      return;
    }
    if (providerMode === "write") {
      if (input.messages.at(-1)?.role === "tool") {
        finish(res, "File written by an ordinary tool.");
        return;
      }
      callTool(res, "ordinary-write", "write", {
        path: "ordinary-created.txt",
        content: "ordinary tool output\n",
      });
      return;
    }
    // One real readonly tool call, then the follow-up request waits for fail().
    if (providerMode === "read-then-fail") {
      if (input.messages.at(-1)?.role === "tool") held.push(res);
      else callTool(res, "ordinary-read", "read", { path: "existing.txt" });
      return;
    }
    if (providerMode === "pending") {
      held.push(res);
      return;
    }
    if (providerMode === "failure") {
      res.writeHead(400);
      res.end('{"error":{"message":"fabricated failure"}}');
      return;
    }
    if (providerMode === "parallel") {
      held.push(res);
      if (held.length === 2) for (const r of held.splice(0)) finish(r);
      return;
    }
    finish(
      res,
      "Advisory: inspect both independent readonly assignments, then explicitly review and save. Never auto-Start.",
    );
  });
  await new Promise<void>((yes) => provider.listen(0, "127.0.0.1", yes));
  const address = provider.address();
  if (!address || typeof address === "string") throw Error("fixture bind");
  writeFileSync(
    join(agentDir, "auth.json"),
    JSON.stringify({
      fixture: { type: "api_key", key: "fabricated-accepting-key" },
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
  mkdirSync(join(root, ".cadence/assistant"), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, "existing.txt"), "pre-existing dirt is preserved\n");
  const command =
    process.platform === "win32"
      ? "echo ACTUAL-PARENT-CHECK"
      : "printf 'ACTUAL-PARENT-CHECK\\n'";
  writeFileSync(
    join(root, ".cadence/assistant/config.json"),
    JSON.stringify({
      schema: "cadence-assistant-checks/1",
      checks: [{ name: "Actual configured", command, timeoutMs: 1000 }],
    }),
  );
  const legacyId = randomUUID();
  const legacyDirectory = join(root, ".cadence/assistant/tasks", legacyId);
  mkdirSync(legacyDirectory, { recursive: true, mode: 0o700 });
  const legacyBytes = JSON.stringify({
    schema: "cadence-workflow-assistant/1",
    id: legacyId,
    revision: 1,
    kind: "research",
    goal: "Legacy context fabricated-accepting-key must be redacted",
    plan: "",
    cwd: root,
    phase: "planning",
    result: "",
    baseline: "",
    checks: [],
    activity: [],
  });
  writeFileSync(join(legacyDirectory, "task.json"), legacyBytes, {
    mode: 0o600,
  });
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: join(dir, "home"),
    USERPROFILE: join(dir, "home"),
    TMPDIR: join(dir, "tmp"),
    TEMP: join(dir, "tmp"),
    TMP: join(dir, "tmp"),
    NO_COLOR: "1",
  };
  Object.assign(env, windowsSystemEnvironment());
  const input: HostInput = {
    workspace: root,
    stateHome: join(dir, "state"),
    environmentToken: options.accessToken ?? null,
    config: {
      schema: "cadence-service-host/1",
      cwd: root,
      agentDir,
      tokenSource: options.accessToken ? "environment" : "generated",
      tokenFile: null,
      http: {
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: 0,
        proxy,
      },
    },
  };
  const c = new ServiceCoordination(root, input.stateHome);
  let host: Awaited<ReturnType<typeof createServiceHost>> | undefined;
  let child: ReturnType<typeof spawn> | undefined;
  let original: Promise<unknown> | undefined;
  let stdout = "",
    stderr = "";
  const restartedCloses: unknown[] = [];
  async function launchGenerated() {
    stdout = "";
    stderr = "";

    child = spawn(
      process.execPath,
      [
        packageRoot
          ? join(packageRoot, "src/service-host.mjs")
          : fileURLToPath(
              new URL("../../src/service-host.mjs", import.meta.url),
            ),
      ],
      { cwd: root, env, stdio: ["pipe", "pipe", "pipe"] },
    );
    original = once(child, "close");
    child.stdout?.on("data", (b) => {
      stdout += b;
    });
    child.stderr?.on("data", (b) => {
      stderr += b;
    });
    child.stdin?.end(JSON.stringify(input));
    const deadline = Date.now() + 10000;
    while (
      !stdout.includes('"ready"') &&
      child.exitCode === null &&
      Date.now() < deadline
    )
      await new Promise((r) => setTimeout(r, 20));
    if (!stdout.includes('"ready"'))
      throw Error(
        `native host readiness unavailable (env names: ${Object.keys(env).join(",")}): ${stderr}`,
      );
  }
  if (mode === "source") {
    if (!environment)
      throw Error("explicit isolated source environment required");
    environment(env);
    host = await createServiceHost(input, {
      contractHash: sourceContract,
      workerTimeoutMs: 15000,
    });
  } else await launchGenerated();
  const local = c.localAccess();
  let transport = new HttpServiceTransport({
    origin: local.endpoint,
    localCapability: local.capability,
    build: nativeBuild,
  });
  let client = new ServiceClient(transport);
  const link = await nativeCall(c, "token-link", true);
  if (
    !link ||
    typeof link !== "object" ||
    !("link" in link) ||
    typeof link.link !== "string"
  )
    throw Error("token link unavailable");
  return {
    dir,
    root,
    host,
    c,
    client,
    transport,
    endpoint: local.endpoint,
    tokenLink: link.link,
    longText,
    legacyId,
    mode: (value: typeof providerMode) => {
      providerMode = value;
    },
    reply(text: string) {
      finalReply = text;
    },
    fail() {
      for (const r of held.splice(0)) {
        r.writeHead(400);
        r.end('{"error":{"message":"fabricated failure"}}');
      }
    },
    held: () => held.length,
    contacts: () => contacts,
    maxActive: () => maxActive,
    observations,
    rotate: () => nativeCall(c, "token-rotate"),
    async restart() {
      await transport.detach();
      if (host) {
        await host.owner.stop();
        host = undefined;
      } else {
        await nativeCall(c, "stop");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          original,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), 5000);
          }),
        ]);
        clearTimeout(timer);
        if (
          result === null ||
          child?.exitCode !== 0 ||
          child.signalCode !== null
        )
          throw Error("restart original owner close unavailable");
        restartedCloses.push(result);
      }
      const config = readHostConfig(c);
      if (!config) throw Error("restart configuration unavailable");
      input.config = config;
      await launchGenerated();
      const access = c.localAccess();
      transport = new HttpServiceTransport({
        origin: access.endpoint,
        localCapability: access.capability,
        build: nativeBuild,
      });
      client = new ServiceClient(transport);
      const bootstrap = await client.session();
      if (bootstrap.kind !== "ok") throw Error("restart bootstrap unavailable");
      return { client, epoch: bootstrap.value.epoch };
    },
    async close() {
      for (const r of held.splice(0)) r.destroy();
      let detachError: unknown;
      try {
        await transport.detach();
      } catch (error) {
        detachError = error;
      }
      let stopped: unknown;
      if (host) stopped = await host.owner.stop();
      else {
        await nativeCall(c, "stop");
        let timer: ReturnType<typeof setTimeout> | undefined;
        const result = await Promise.race([
          original,
          new Promise<null>((yes) => {
            timer = setTimeout(() => yes(null), 5000);
          }),
        ]);
        clearTimeout(timer);
        if (result === null) {
          // Exact original fixture handle only. Forced teardown is retained failure,
          // never clean Stop or permission to release the service's fences.
          child?.kill("SIGTERM");
          stopped = { forced: true, originalClose: await original };
          detachError ??= Error(
            "fixture service stop unconfirmed; owned original forced",
          );
        } else stopped = result;
      }
      provider.closeAllConnections();
      await new Promise<void>((yes) => provider.close(() => yes()));
      writeFileSync(
        join(dir, "receipt.json"),
        JSON.stringify(
          {
            mode,
            packageRoot: packageRoot ?? "source generated",
            contacts,
            maxActive,
            observations,
            stopped,
            restartedCloses,
            stdout,
            stderr,
            sdk: "actual installed public SDK",
            paidProvider: false,
            physicalHuman: false,
          },
          null,
          2,
        ),
      );
      if (
        readFileSync(join(root, "existing.txt"), "utf8") !==
        "pre-existing dirt is preserved\n"
      )
        throw Error("fixture preservation");
      if (child && (child.exitCode !== 0 || child.signalCode !== null))
        throw Error("original host close not zero");
      if (
        readFileSync(join(legacyDirectory, "task.json"), "utf8") !== legacyBytes
      )
        throw Error("legacy bytes changed");
      if (detachError) throw detachError;
      return stopped;
    },
  };
}
