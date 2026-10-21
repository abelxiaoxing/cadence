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

export async function acceptingFixture(
  mode: "source" | "generated",
  environment?: (env: NodeJS.ProcessEnv) => void,
  proxy: HostInput["config"]["http"]["proxy"] = null,
) {
  const packageRoot = process.env.CADENCE_TEST_PACKAGE_ROOT;
  const dir = mkdtempSync(join(tmpdir(), "accepting-"));
  for (const name of ["project", "agent", "home", "tmp"])
    mkdirSync(join(dir, name), { mode: 0o700 });
  const root = join(dir, "project"),
    agentDir = join(dir, "agent");
  let providerMode: "single" | "parallel" | "pending" | "failure" = "single";
  let contacts = 0,
    active = 0,
    maxActive = 0;
  const held: ServerResponse[] = [];
  const observations: { tools: string[]; mode: string }[] = [];
  const longText = `Actual retained SDK result. ${"retained-detail-αβγ ".repeat(900)} END-RETAINED`;
  function finish(res: ServerResponse, text = longText) {
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
    });
    res.once("close", () => {
      active--;
    });
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
    environmentToken: null,
    config: {
      schema: "cadence-service-host/1",
      cwd: root,
      agentDir,
      tokenSource: "generated",
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
    contacts: () => contacts,
    maxActive: () => maxActive,
    observations,
    rotate: () => nativeCall(c, "token-rotate"),
    async restart() {
      if (mode !== "generated")
        throw Error("restart requires original generated owner");
      await transport.detach();
      await nativeCall(c, "stop");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        original,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), 5000);
        }),
      ]);
      clearTimeout(timer);
      if (result === null || child?.exitCode !== 0 || child.signalCode !== null)
        throw Error("restart original owner close unavailable");
      restartedCloses.push(result);
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
