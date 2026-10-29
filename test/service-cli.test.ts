import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  cpSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, expect, it } from "vitest";
import { nativeCall } from "../src/service/cli.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import {
  decodeStartupReport,
  readHostConfig,
  StartupRefusal,
  startupReport,
} from "../src/service/runtime.ts";
import { ServiceClient } from "../src/service-client.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { historyFixture } from "./helpers/history-fixture.ts";
import { withoutNodeProxyNotice } from "./helpers/node-notices.ts";
import { windowsSystemEnvironment } from "./helpers/windows-environment.ts";

const cli = fileURLToPath(new URL("../src/service-cli.mjs", import.meta.url));
const host = fileURLToPath(new URL("../src/service-host.mjs", import.meta.url));
const pending: F[] = [];
type F = ReturnType<typeof fixture>;
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "cadence-host-native-"));
  for (const d of ["workspace", "home", "agent", "state", "tmp"])
    mkdirSync(join(dir, d), { mode: 0o700 });
  writeFileSync(join(dir, "agent", "auth.json"), "{}", { mode: 0o600 });
  const env: NodeJS.ProcessEnv = {
    HOME: join(dir, "home"),
    USERPROFILE: join(dir, "home"),
    LOCALAPPDATA: join(dir, "home"),
    APPDATA: join(dir, "home"),
    TMPDIR: join(dir, "tmp"),
    TEMP: join(dir, "tmp"),
    TMP: join(dir, "tmp"),
    PATH: process.env.PATH,
    NO_COLOR: "1",
  };
  Object.assign(env, windowsSystemEnvironment());
  const root = join(dir, "workspace"),
    state = join(dir, "state");
  return { dir, root, state, env, c: new ServiceCoordination(root, state) };
}
function run(f: F, command: string, extra: string[] = [], entry = cli) {
  return new Promise<{
    code: number | null;
    signal: string | null;
    stdout: string;
    stderr: string;
  }>((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        entry,
        command,
        "--workspace",
        f.root,
        "--state-home",
        f.state,
        ...extra,
      ],
      { cwd: f.root, env: f.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (b) => {
      stdout += b;
    });
    child.stderr.on("data", (b) => {
      stderr += b;
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      resolve({ code, signal, stdout, stderr }),
    );
  });
}
async function started(
  extra: string[] = [],
  environment: Record<string, string> = {},
) {
  const f = fixture();
  Object.assign(f.env, environment);
  pending.push(f);
  const r = await run(f, "start", [
    "--port",
    "0",
    "--agent-dir",
    join(f.dir, "agent"),
    ...extra,
  ]);
  expect(r.stderr).toBe("");
  expect(r.code, r.stdout).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({
    status: "alive",
    actions: false,
  });
  return f;
}
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(at: string) {
    for (const e of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, e.name);
      if (e.isDirectory()) walk(path);
      else out[path] = readFileSync(path).toString("hex");
    }
  }
  walk(dir);
  return out;
}
async function http(
  f: F,
  path: string,
  headers: Record<string, string> = {},
  body?: unknown,
) {
  const access = f.c.localAccess();
  return new Promise<{
    status: number;
    headers: Record<string, any>;
    text: string;
  }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      `${access.endpoint}${path}`,
      {
        method: data ? "POST" : "GET",
        headers: {
          Connection: "close",
          ...headers,
          ...(data
            ? {
                "Content-Type": "application/json",
                "Content-Length": Buffer.byteLength(data),
              }
            : {}),
        },
      },
      (res) => {
        let text = "";
        res.on("data", (c) => {
          text += c;
        });
        res.on("error", reject);
        res.on("end", () =>
          resolve({ status: res.statusCode!, headers: res.headers, text }),
        );
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}
async function token(f: F) {
  const r = await run(f, "token-link", ["--reveal"]);
  expect(r.code, r.stderr).toBe(0);
  return JSON.parse(r.stdout).link as string;
}
afterEach(async () => {
  for (const f of pending.splice(0)) {
    if (["stopped", "absent"].includes(f.c.inspect().status)) continue;
    const result = await run(f, "stop");
    expect(JSON.parse(result.stdout).status, result.stderr).toBe("stopped");
  }
});
beforeAll(() => {
  const r = spawnSync("bun", ["scripts/build-service.mjs", "--check"], {
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
});
it("native-proxy-enabled management keeps local capability direct without changing the parent agent", async () => {
  const f = fixture();
  let localHits = 0,
    proxyHits = 0,
    leakedCapability = false;
  let epoch = "",
    capability = "";
  const local = createServer((req, res) => {
    localHits++;
    expect(req.headers["x-cadence-local"]).toBe(capability);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ kind: "ok", value: { status: "alive", epoch } }));
  });
  const proxy = createServer((req, res) => {
    proxyHits++;
    leakedCapability ||= req.headers["x-cadence-local"] === capability;
    res.writeHead(502).end();
  });
  await new Promise<void>((resolve) => local.listen(0, "127.0.0.1", resolve));
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const address = local.address(),
    proxyAddress = proxy.address();
  if (
    !address ||
    typeof address === "string" ||
    !proxyAddress ||
    typeof proxyAddress === "string"
  )
    throw Error("fixture address");
  const lease = f.c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: `http://127.0.0.1:${address.port}`,
    policyIdentity: "a".repeat(64),
  });
  ({ epoch, capability } = f.c.localAccess());
  const route = `http://127.0.0.1:${proxyAddress.port}`;
  Object.assign(f.env, {
    HTTP_PROXY: route,
    HTTPS_PROXY: route,
    NODE_USE_ENV_PROXY: "1",
  });
  try {
    const result = await run(f, "status"); // real generated SDK-free CLI, actual native proxy opt-in
    expect([
      result.code,
      result.signal,
      withoutNodeProxyNotice(result.stderr),
    ]).toEqual([0, null, ""]);
    expect(JSON.parse(result.stdout)).toEqual({ status: "alive", epoch });
    expect({ localHits, proxyHits, leakedCapability }).toEqual({
      localHits: 1,
      proxyHits: 0,
      leakedCapability: false,
    });
  } finally {
    lease.release();
    await Promise.all([
      new Promise<void>((resolve) => local.close(() => resolve())),
      new Promise<void>((resolve) => proxy.close(() => resolve())),
    ]);
  }
}, 15000);
it("ordinary Node passive status/diagnose/recover and no-service requests create nothing", async () => {
  const f = fixture(),
    before = tree(f.dir);
  for (const name of ["status", "diagnose"]) {
    const r = await run(f, name);
    expect(JSON.parse(r.stdout)).toEqual({ status: "absent" });
  }
  for (const [name, args] of [
    ["token-link", ["--reveal"]],
    ["token-rotate", []],
    ["recover", ["resolve"]],
  ] as const)
    expect((await run(f, name, [...args])).code).toBe(1);
  expect(tree(f.dir)).toEqual(before);
});
it("real authenticated read surfaces stay closed to task actions and do not write", async () => {
  const f = fixture();
  pending.push(f);
  const taskId = randomUUID();
  const taskPath = join(f.root, ".cadence", "assistant", "tasks", taskId);
  mkdirSync(taskPath, { recursive: true });
  writeFileSync(
    join(taskPath, "task.json"),
    JSON.stringify({
      schema: "cadence-workflow-assistant/1",
      id: taskId,
      revision: 1,
      kind: "research",
      goal: "Preserved legacy context",
      plan: "",
      cwd: f.root,
      phase: "running",
      result: "",
      baseline: "",
      checks: [],
      activity: [],
    }),
  );
  expect(
    (
      await run(f, "start", [
        "--port",
        "0",
        "--agent-dir",
        join(f.dir, "agent"),
      ])
    ).code,
  ).toBe(0);
  const cap = f.c.localAccess();
  const transport = new HttpServiceTransport({
    origin: cap.endpoint,
    localCapability: cap.capability,
  });
  const client = new ServiceClient(transport);
  const before = tree(f.dir);
  const session = await client.session();
  expect(session).toMatchObject({
    kind: "ok",
    value: {
      capabilities: { actions: false, manualChecks: false, history: true },
    },
  });
  const workspace = await client.workspace();
  expect(workspace).toMatchObject({
    kind: "ok",
    value: { models: [], context: { status: "unavailable" } },
  });
  if (workspace.kind !== "ok" || session.kind !== "ok")
    throw new Error("bootstrap");
  const scope = { kind: "workspace" as const, id: workspace.value.workspaceId };
  for (const reader of [
    "tasks",
    "runs",
    "messages",
    "tools",
    "contents",
    "events",
    "checks",
    "changes",
    "reviews",
  ] as const) {
    const result = await client[reader]({
      storeId: session.value.storeId,
      scope: reader === "tasks" ? scope : { kind: "task", id: taskId },
      snapshotSeq: null,
      after: null,
      limit: 50,
    });
    expect(result.kind, reader).toBe("ok");
  }
  expect((await client.snapshot({ kind: "task", id: taskId })).kind).toBe("ok");
  const denied = await http(
    f,
    "/api/v1/commands",
    { "X-Cadence-Local": cap.capability },
    { surface: "terminal" },
  );
  expect(denied.status).not.toBe(200);
  expect(tree(f.dir)).toEqual(before);
  await transport.detach();
}, 30000);
it("generated token opt-in, browser management denial, rotation and per-boot local authority", async () => {
  const f = await started();
  expect((await run(f, "token-link")).code).toBe(1);
  const link = await token(f),
    secret = new URL(link).searchParams.get("token")!;
  const entry = await http(f, `/?token=${encodeURIComponent(secret)}`);
  expect(entry.status).toBe(303);
  const cookie = entry.headers["set-cookie"][0].split(";")[0];
  const origin = f.c.localAccess().endpoint;
  const s = await http(f, "/api/v1/session", { cookie });
  const csrf = JSON.parse(s.text).value.csrf;
  for (const op of [
    "status",
    "diagnose",
    "stop",
    "token-link",
    "token-rotate",
  ]) {
    const r = await http(
      f,
      `/local/v1/admin/${op}`,
      { cookie, Origin: origin, "X-Cadence-CSRF": csrf },
      ["status", "diagnose"].includes(op) ? undefined : {},
    );
    expect(r.status).toBe(403);
  }
  expect(
    (
      await http(f, "/local/v1/admin/status", {
        "X-Cadence-Local": "x".repeat(43),
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await http(
        f,
        "/local/v1/admin/recover/resolve",
        { cookie, Origin: origin, "X-Cadence-CSRF": csrf },
        { informedLocalConfirmation: true },
      )
    ).status,
  ).not.toBe(200);
  expect((await run(f, "token-rotate")).code).toBe(0);
  expect((await http(f, "/api/v1/session", { cookie })).status).toBe(401);
  expect((await http(f, `/?token=${secret}`)).status).toBe(401);
  expect(await token(f)).not.toBe(link);
  for (const name of ["status", "diagnose"])
    expect((await run(f, name)).stdout).not.toContain(secret);
  expect(readFileSync(join(f.dir, "agent/auth.json"), "utf8")).toBe("{}");
}, 30000);
it("environment token stays out of persisted/normal output, rotation refuses, explicit changed-env restart", async () => {
  const first = "fabricated-environment-owner-token-111111";
  const f = await started([], { CADENCE_WEB_TOKEN: first });
  expect(new URL(await token(f)).searchParams.get("token")).toBe(first);
  expect((await run(f, "token-rotate")).code).toBe(1);
  expect(JSON.stringify(tree(f.state))).not.toContain(
    Buffer.from(first).toString("hex"),
  );
  expect((await run(f, "stop")).code).toBe(0);
  f.env.CADENCE_WEB_TOKEN = "fabricated-environment-owner-token-222222";
  expect((await run(f, "start")).code).toBe(0);
  expect(new URL(await token(f)).searchParams.get("token")).toBe(
    f.env.CADENCE_WEB_TOKEN,
  );
}, 30000);
it("external private token file source rotates real selected bytes", async () => {
  const f = fixture();
  pending.push(f);
  const path = join(f.dir, "token");
  writeFileSync(path, "fabricated-file-token-source-111111111", {
    mode: 0o600,
  });
  const r = await run(f, "start", [
    "--port",
    "0",
    "--agent-dir",
    join(f.dir, "agent"),
    "--token-file",
    path,
  ]);
  expect(r.code, r.stderr).toBe(0);
  const before = readFileSync(path);
  expect((await run(f, "token-rotate")).code).toBe(0);
  expect(readFileSync(path)).not.toEqual(before);
  expect(new URL(await token(f)).searchParams.get("token")).toBe(
    readFileSync(path, "utf8"),
  );
}, 30000);
/** A port free right now; the host binds it exactly or refuses. */
async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (!address || typeof address === "string") throw new Error("no port");
  return address.port;
}
/** A research .env that also selects the WebUI port and token. */
function serverConfig(f: F, port: number, token: string): string {
  const path = join(f.dir, ".env");
  writeFileSync(
    path,
    `# research\nGROK_API_KEY=fabricated-grok-key\nCADENCE_PORT=${port}\nCADENCE_TOKEN=${token}\n`,
    { mode: 0o600 },
  );
  return path;
}
async function entered(f: F, secret: string) {
  const entry = await http(f, `/?token=${encodeURIComponent(secret)}`);
  expect(entry.status).toBe(303);
  return entry.headers["set-cookie"][0].split(";")[0] as string;
}
it("an unusable server configuration refuses before registering, naming only its path and reason", async () => {
  const f = fixture();
  pending.push(f);
  const path = join(f.dir, ".env");
  const before = tree(f.state);
  const token = "CADENCE_TOKEN=fabricated-server-config-token-1111111111";
  for (const [bad, reason] of [
    ["CADENCE_PORT=17423\n", "has no CADENCE_TOKEN line"],
    [`${token}\n`, "has no CADENCE_PORT line"],
    [
      `CADENCE_PORT=70000\n${token}\n`,
      "has CADENCE_PORT on line 1 that is not a whole number from 1 to 65535",
    ],
    [
      `CADENCE_PORT=17423\n${token}\n${token}\n`,
      "sets CADENCE_TOKEN twice (lines 2 and 3); keep one",
    ],
    [
      `CADENCE_PORT=17423\n${token}\nbroken\n`,
      "has no KEY=value setting on line 3, which the research skills refuse too",
    ],
  ]) {
    writeFileSync(path, bad, { mode: 0o600 });
    const r = await run(f, "start", [
      "--agent-dir",
      join(f.dir, "agent"),
      "--server-config",
      path,
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain(`Cadence changed nothing: ${path} ${reason}.\n`);
    expect(r.stderr).not.toContain("fabricated");
    expect(tree(f.state)).toEqual(before);
  }
  rmSync(path);
  const absent = await run(f, "start", [
    "--agent-dir",
    join(f.dir, "agent"),
    "--server-config",
    path,
  ]);
  expect(absent.code).toBe(1);
  expect(absent.stderr).toContain(
    `Cadence changed nothing: ${path} does not exist.\n`,
  );
  expect(tree(f.state)).toEqual(before);
});
// Mode bits and links are POSIX facts; Windows has neither check.
it.skipIf(process.platform === "win32")(
  "a real owner starts from a group-readable .env behind dotfiles links, like Pi's sources",
  async () => {
    const f = fixture();
    pending.push(f);
    const port = await freePort();
    const secret = "fabricated-server-config-token-1111111111";
    const repo = join(f.dir, "dotfiles");
    mkdirSync(repo, { mode: 0o755 });
    chmodSync(repo, 0o775);
    const target = join(repo, "cadence.env");
    writeFileSync(
      target,
      `GROK_API_KEY=fabricated-grok-key\nCADENCE_PORT=${port}\nCADENCE_TOKEN=${secret}\n`,
    );
    chmodSync(target, 0o664);
    const path = join(f.dir, ".env");
    symlinkSync(target, path);
    const r = await run(f, "start", [
      "--agent-dir",
      join(f.dir, "agent"),
      "--server-config",
      path,
    ]);
    expect(r.code, r.stderr).toBe(0);
    expect(await token(f)).toBe(`http://127.0.0.1:${port}/?token=${secret}`);
    await entered(f, secret);
    // Rotation writes the real file; the link stays a link.
    expect((await run(f, "token-rotate")).code).toBe(0);
    expect(lstatSync(path).isSymbolicLink()).toBe(true);
    const rotated = /CADENCE_TOKEN=([A-Za-z0-9_-]{43})\n/.exec(
      readFileSync(target, "utf8"),
    )?.[1];
    expect(rotated).toBeDefined();
    expect(new URL(await token(f)).searchParams.get("token")).toBe(rotated);
    expect(readFileSync(target, "utf8")).toContain(
      "GROK_API_KEY=fabricated-grok-key\n",
    );
  },
  30000,
);
it("token rotation rewrites only the .env's token line; a pending token edit refuses without fencing", async () => {
  const f = fixture();
  pending.push(f);
  const port = await freePort();
  const first = "fabricated-server-config-token-1111111111";
  const path = join(f.dir, ".env");
  const lines = (secret: string) =>
    `GROK_API_KEY="fabricated grok key"\r\n\r\n# WebUI\r\nCADENCE_PORT=${port}\r\n  CADENCE_TOKEN=${secret}\r\nTAVILY_ENABLED=false\r\n`;
  writeFileSync(path, lines(`"${first}"`), { mode: 0o600 });
  const r = await run(f, "start", [
    "--agent-dir",
    join(f.dir, "agent"),
    "--server-config",
    path,
  ]);
  expect(r.code, r.stderr).toBe(0);
  const cookie = await entered(f, first);
  expect((await run(f, "token-rotate")).code).toBe(0);
  const text = readFileSync(path, "utf8");
  const rotated = /CADENCE_TOKEN=([A-Za-z0-9_-]{43})\r\n/.exec(text)?.[1];
  expect(rotated).toBeDefined();
  // Every other byte, line ending and indent stays.
  expect(text).toBe(lines(rotated!));
  if (process.platform !== "win32")
    expect(statSync(path).mode & 0o777).toBe(0o600);
  expect(new URL(await token(f)).searchParams.get("token")).toBe(rotated);
  expect((await http(f, "/api/v1/session", { cookie })).status).toBe(401);
  const fresh = await entered(f, rotated!);
  const edited = lines("fabricated-edited-server-token-3333333333");
  writeFileSync(path, edited);
  expect((await run(f, "token-rotate")).code).toBe(1);
  expect(readFileSync(path, "utf8")).toBe(edited);
  expect((await http(f, "/api/v1/session", { cookie: fresh })).status).toBe(
    200,
  );
  expect(JSON.parse((await run(f, "status")).stdout).status).toBe("alive");
}, 60000);
/** The host's own startup line for an input the management client would
 * never send, such as a file edited between selection and start. */
async function hostLine(f: F, config: Record<string, unknown>) {
  const child = spawn(process.execPath, [host], {
    cwd: f.root,
    env: f.env,
    stdio: ["pipe", "pipe", "ignore"],
  });
  let stdout = "";
  child.stdout.on("data", (b) => {
    stdout += b;
  });
  const closed = once(child, "close");
  child.stdin.end(
    JSON.stringify({
      workspace: f.root,
      stateHome: f.state,
      environmentToken: null,
      config: {
        schema: "cadence-service-host/1",
        cwd: f.root,
        agentDir: join(f.dir, "agent"),
        ...config,
      },
    }),
  );
  await closed;
  return JSON.parse(stdout);
}
it("the host refuses a server configuration that no longer names the selected port, or a reselection beyond port and token", async () => {
  const f = await started();
  expect((await run(f, "stop")).code).toBe(0);
  const old = readHostConfig(f.c)!;
  const port = await freePort();
  const path = serverConfig(
    f,
    port,
    "fabricated-server-config-token-1111111111",
  );
  const selected = tree(f.state);
  const http = { ...old.http, port: port === 65535 ? 1 : port + 1 };
  expect(
    await hostLine(f, { http, tokenSource: "config", tokenFile: path }),
  ).toEqual({ status: "refused", error: "conflict", stage: "service" });
  const agent = join(f.dir, "agent2");
  mkdirSync(agent, { mode: 0o700 });
  writeFileSync(join(agent, "auth.json"), "{}", { mode: 0o600 });
  expect(
    await hostLine(f, {
      agentDir: agent,
      http: { ...old.http, port },
      tokenSource: "config",
      tokenFile: path,
    }),
  ).toEqual({ status: "refused", error: "conflict", stage: "service" });
  // Only a reselection to the server configuration is accepted.
  expect(
    await hostLine(f, {
      http: { ...old.http, port },
      tokenSource: "file",
      tokenFile: path,
    }),
  ).toEqual({ status: "refused", error: "conflict", stage: "service" });
  expect(tree(f.state)).toEqual(selected);
}, 30000);
for (const mode of ["partial", "malformed", "linked"] as const)
  it(`unsafe selected ${mode} setup preserved, no adoption`, async () => {
    const f = fixture();
    mkdirSync(f.c.directory, { recursive: true, mode: 0o700 });
    if (mode === "partial")
      writeFileSync(f.c.path("config.json"), "{}", { mode: 0o600 });
    else if (mode === "malformed")
      writeFileSync(f.c.path("format.json"), "{", { mode: 0o600 });
    else symlinkSync(join(f.dir, "agent/auth.json"), f.c.path("config.json"));
    const before = tree(f.dir);
    expect(
      (
        await run(f, "start", [
          "--port",
          "0",
          "--agent-dir",
          join(f.dir, "agent"),
        ])
      ).code,
    ).toBe(1);
    expect(tree(f.dir)).toEqual(before);
  });
it("occupied selected endpoint refuses without initializing service/history/access", async () => {
  const f = await started(),
    other = fixture();
  const port = new URL(f.c.localAccess().endpoint).port,
    before = tree(other.dir);
  expect(
    (
      await run(other, "start", [
        "--port",
        port,
        "--agent-dir",
        join(other.dir, "agent"),
      ])
    ).code,
  ).toBe(1);
  expect(tree(other.dir)).toEqual(before);
});
it("startup outbound proxy/preload requests refuse without spawning or direct fallback", async () => {
  for (const key of ["HTTP_PROXY", "NO_PROXY", "NODE_USE_ENV_PROXY"]) {
    const f = fixture();
    f.env[key] = "";
    const before = tree(f.dir);
    expect(
      (
        await run(f, "start", [
          "--port",
          "0",
          "--agent-dir",
          join(f.dir, "agent"),
        ])
      ).code,
    ).toBe(1);
    expect(tree(f.dir)).toEqual(before);
  }
});
// The agent directory's mode is not a premise; it must still be a directory.
for (const [stage, select] of [
  [
    "pi-agent-directory",
    (agent: string) => {
      renameSync(agent, `${agent}-moved`);
      writeFileSync(agent, "", { mode: 0o600 });
    },
  ],
  ["pi-auth", (agent: string) => unlinkSync(join(agent, "auth.json"))],
] as const)
  it(`unusable ${stage} refuses with its stage before registering an owner`, async () => {
    const f = fixture();
    select(join(f.dir, "agent"));
    const before = tree(f.dir),
      began = performance.now();
    const result = await run(f, "start", [
      "--port",
      "0",
      "--agent-dir",
      join(f.dir, "agent"),
    ]);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "refused",
      error: "corrupt-selected",
      stage,
    });
    expect(result.stderr).toContain(join(f.dir, "agent"));
    // A known refusal, not the 10s unconfirmed reporting bound.
    expect(performance.now() - began).toBeLessThan(10000);
    expect(tree(f.dir)).toEqual(before);
    expect(f.c.inspect().status).toBe("absent");
  }, 30000);
// POSIX mode bits are not a Windows ACL premise.
it.skipIf(process.platform === "win32")(
  "Pi sources with a umask 002 mode (0775 directory, 0664 files) start",
  async () => {
    const f = fixture();
    pending.push(f);
    const agent = join(f.dir, "agent");
    // What Pi 1.4.0 itself creates on first launch under umask 002.
    chmodSync(agent, 0o775);
    chmodSync(join(agent, "auth.json"), 0o664);
    const started = await run(f, "start", [
      "--port",
      "0",
      "--agent-dir",
      agent,
    ]);
    expect(started.code, started.stderr).toBe(0);
    expect(JSON.parse(started.stdout)).toMatchObject({ status: "alive" });
  },
  30000,
);
it("a compat flag inert on the pinned SDK starts; an unknown one refuses at pi-models before registering", async () => {
  const f = fixture();
  pending.push(f);
  const agent = join(f.dir, "agent"),
    models = (compat: Record<string, boolean>) =>
      writeFileSync(
        join(agent, "models.json"),
        JSON.stringify({
          providers: {
            fixture: {
              baseUrl: "http://127.0.0.1:9",
              apiKey: "fixture",
              api: "openai-responses",
              models: [{ id: "m", compat }],
            },
          },
        }),
        { mode: 0o600 },
      );
  models({ supportsFutureFlag: true });
  const before = tree(f.dir);
  const refused = await run(f, "start", ["--port", "0", "--agent-dir", agent]);
  expect(refused.code).toBe(1);
  expect(JSON.parse(refused.stdout)).toEqual({
    status: "refused",
    error: "corrupt-selected",
    stage: "pi-models",
  });
  expect(refused.stderr).toContain(join(agent, "models.json"));
  expect(tree(f.dir)).toEqual(before);
  expect(f.c.inspect().status).toBe("absent");
  // Newer Pi writes this; the pinned SDK has no system-role message to collapse.
  models({ supportsMidConvoSystemMessages: false });
  const started = await run(f, "start", ["--port", "0", "--agent-dir", agent]);
  expect(started.code, started.stderr).toBe(0);
  expect(JSON.parse(started.stdout)).toMatchObject({ status: "alive" });
}, 30000);
it("a package hard-linked into its package manager's store (Bun's default install) starts", async () => {
  const f = fixture();
  pending.push(f);
  const pkg = join(f.dir, "package"),
    store = join(f.dir, "store");
  for (const name of ["src", "agents", "web/dist", "package.json"])
    cpSync(
      fileURLToPath(new URL(`../${name}`, import.meta.url)),
      join(pkg, name),
      { recursive: true },
    );
  // Every package file gets a second link, like Bun's hardlink backend.
  const link = (from: string, to: string) => {
    mkdirSync(to, { recursive: true });
    for (const e of readdirSync(from, { withFileTypes: true }))
      if (e.isDirectory()) link(join(from, e.name), join(to, e.name));
      else linkSync(join(from, e.name), join(to, e.name));
  };
  link(pkg, store);
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(pkg, "node_modules"),
    "junction",
  );
  const result = await run(
    f,
    "start",
    ["--port", "0", "--agent-dir", join(f.dir, "agent")],
    join(pkg, "src", "service-cli.mjs"),
  );
  expect(result.code, result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ status: "alive" });
}, 30000);
it("startup refusal report carries only a fixed code and stage", () => {
  expect(
    startupReport(new StartupRefusal("corrupt-selected", "pi-runtime", true)),
  ).toEqual({
    status: "quarantined",
    error: "corrupt-selected",
    stage: "pi-runtime",
  });
  const opaque = startupReport(new Error(`/private/${randomUUID()}`));
  expect(opaque).toEqual({
    status: "refused",
    error: "unavailable",
    stage: "service",
  });
  expect(decodeStartupReport(JSON.parse(JSON.stringify(opaque)))).toEqual(
    opaque,
  );
  for (const bad of [
    { ...opaque, detail: "x" },
    { ...opaque, stage: "elsewhere" },
    { ...opaque, error: "ENOENT" },
    { ...opaque, status: "ready" },
  ])
    expect(() => decodeStartupReport(bad)).toThrow();
});
it("explicit management starts configured owner routing before SDK imports and cleanly stops the owned dispatcher", async () => {
  let contacts = 0;
  const proxy = createServer((_req, res) => {
    contacts++;
    res.writeHead(502);
    res.end();
  });
  await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
  const address = proxy.address();
  if (!address || typeof address === "string") throw Error("fixture");
  const route = `http://127.0.0.1:${address.port}`;
  try {
    const f = await started([], { http_proxy: route, HTTPS_PROXY: route });
    expect(JSON.parse((await run(f, "diagnose")).stdout)).toMatchObject({
      status: "alive",
      proxyAuth: "validated-proxy",
      recovery: "local-interactive-only",
    });
    expect(contacts).toBe(0); // startup/catalog is not provider auth
    expect((await run(f, "stop")).code).toBe(0);
    expect(f.c.inspect().status).toBe("stopped");
  } finally {
    await new Promise<void>((r) => {
      proxy.close(() => r());
      proxy.closeAllConnections();
    });
  }
}, 20000);
it("native management has an absolute response deadline despite slow progress", async () => {
  const f = fixture();
  let tick: ReturnType<typeof setInterval> | undefined;
  const server = createServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.write(" ");
    tick = setInterval(() => res.write(" "), 50);
    res.once("close", () => clearInterval(tick));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("fixture address");
  const lease = f.c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: `http://127.0.0.1:${address.port}`,
    policyIdentity: "a".repeat(64),
  });
  const call = nativeCall(f.c, "status").then(
    () => "resolved",
    () => "refused",
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const observed = await Promise.race([
      call,
      new Promise<string>((resolve) => {
        timer = setTimeout(() => resolve("still-pending"), 2400);
      }),
    ]);
    expect(observed).toBe("refused");
  } finally {
    clearTimeout(timer);
    clearInterval(tick);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await call;
    lease.release();
  }
}, 5000);

it("writer lifetime registration throw refuses before any journal effect", async () => {
  let registrations = 0,
    effects = 0,
    originalSettled = false;
  const f = historyFixture({
    onOriginal: (original) => {
      registrations++;
      void original.then(() => {
        originalSettled = true;
      });
      throw new Error("fixture registration refusal");
    },
    observeWrite: () => {
      effects++;
    },
  });
  const before = tree(f.c.directory);
  expect(await f.writer.flush()).toMatchObject({
    status: "refused",
    durability: "none",
  });
  await f.writer.settled();
  expect(registrations).toBe(1);
  expect(effects).toBe(0);
  expect(originalSettled).toBe(true);
  expect(f.writer.pendingWrites).toBe(0);
  expect(tree(f.c.directory)).toEqual(before);
  expect(existsSync(f.c.store.lockPath)).toBe(true);
});

it("generated outputs deterministic and management bundle contains no SDK loader", () => {
  expect(readFileSync(cli, "utf8")).not.toContain("@earendil-works/");
  expect(readFileSync(host, "utf8")).toContain(
    'import("@earendil-works/pi-coding-agent")',
  );
  const r = spawnSync("bun", ["scripts/build-service.mjs", "--check"], {
    encoding: "utf8",
  });
  expect(r.status, r.stderr).toBe(0);
});

it("ordinary Node foreground management waits original host close after authenticated stop", async () => {
  const f = fixture();
  pending.push(f);
  const child = spawn(
    process.execPath,
    [
      cli,
      "start",
      "--foreground",
      "--workspace",
      f.root,
      "--state-home",
      f.state,
      "--port",
      "0",
      "--agent-dir",
      join(f.dir, "agent"),
    ],
    { cwd: f.root, env: f.env, stdio: ["ignore", "pipe", "pipe"] },
  );
  const close = once(child, "close");
  let output = "";
  await new Promise<void>((resolve) =>
    child.stdout.on("data", (data) => {
      output += data;
      if (output.includes("\n")) resolve();
    }),
  );
  expect(JSON.parse(output).status).toBe("alive");
  expect(child.exitCode).toBeNull();
  expect((await run(f, "stop")).code).toBe(0);
  const [code, signal] = await close;
  expect(code).toBe(0);
  expect(signal).toBeNull();
}, 30000);
it.each([0, 7])(
  "foreground unconfirmed readiness remains CLI failure after fixture child exit %s",
  async (code) => {
    const f = fixture();
    const entry = join(f.dir, "foreground-entry.mjs");
    const manager = join(f.dir, "foreground-manager.mjs");
    writeFileSync(
      join(f.dir, "foreground-host.mjs"),
      `
      process.stdin.resume();
      process.stdin.once("end", () => {
        process.stdout.write(JSON.stringify({ status: "ready", epoch: "11111111-1111-4111-8111-111111111111" }) + "\\n");
        setTimeout(() => { process.exitCode = ${code}; }, 300);
      });
    `,
    );
    writeFileSync(
      entry,
      `
      import { managementMain } from ${JSON.stringify(fileURLToPath(new URL("../src/service/cli.ts", import.meta.url)))};
      await managementMain(process.argv.slice(2), new URL("./foreground-host.mjs", import.meta.url));
    `,
    );
    const built = spawnSync(
      "bun",
      [
        "build",
        entry,
        "--target=node",
        "--packages=external",
        `--define=__CADENCE_TEST_ROOT__=${JSON.stringify(fileURLToPath(new URL("../", import.meta.url)))}`,
        `--outfile=${manager}`,
      ],
      { encoding: "utf8" },
    );
    expect(built.status, built.stderr).toBe(0);
    const result = await run(
      f,
      "start",
      ["--foreground", "--port", "0", "--agent-dir", join(f.dir, "agent")],
      manager,
    );
    expect(result.code).toBe(1);
    expect(result.signal).toBeNull();
    expect(JSON.parse(result.stdout)).toEqual({ status: "unconfirmed" });
    expect(result.stderr).toBe("");
    expect(tree(f.state)).toEqual({});
    expect(readFileSync(join(f.dir, "agent/auth.json"), "utf8")).toBe("{}");
  },
  5000,
);

it("real native host ownership loss denies later management effects, preserves fences (forced fixture teardown separate)", async () => {
  const f = fixture();
  const child = spawn(process.execPath, [host], {
    cwd: f.root,
    env: f.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const close = once(child, "close");
  child.stdin.end(
    JSON.stringify({
      workspace: f.root,
      stateHome: f.state,
      environmentToken: null,
      config: {
        schema: "cadence-service-host/1",
        http: {
          schema: "cadence-service-http/1",
          host: "127.0.0.1",
          port: 0,
          proxy: null,
        },
        cwd: f.root,
        agentDir: join(f.dir, "agent"),
        tokenSource: "generated",
        tokenFile: null,
      },
    }),
  );
  await once(child.stdout, "data");
  const access = f.c.localAccess(),
    old = readFileSync(f.c.path("registration.json"), "utf8");
  writeFileSync(f.c.path("registration.json"), `${old} `, { mode: 0o600 });
  const before = tree(f.state);
  try {
    expect(
      (
        await http(
          f,
          "/local/v1/admin/token-rotate",
          { "X-Cadence-Local": access.capability },
          {},
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await http(
          f,
          "/local/v1/admin/stop",
          { "X-Cadence-Local": access.capability },
          {},
        )
      ).status,
    ).toBe(409);
    expect(tree(f.state)).toEqual(before);
  } finally {
    child.kill("SIGTERM"); // Test-owned original handle only; NOT product recovery or stop evidence.
    const [code, signal] = await close;
    expect(code).toBeNull();
    expect(signal).toBe("SIGTERM");
  }
  expect(existsSync(f.c.store.lockPath)).toBe(true);
}, 30000);

async function fixtureHost(f: F, mode: string) {
  const bundle = join(f.dir, "bundle");
  mkdirSync(bundle);
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(bundle, "node_modules"),
    "junction",
  );
  const target = join(bundle, "host-fixture.mjs");
  const built = spawnSync(
    "bun",
    [
      "build",
      fileURLToPath(
        new URL("./helpers/service-host-fixture.ts", import.meta.url),
      ),
      "--target=node",
      "--packages=external",
      `--define=__CADENCE_TEST_ROOT__=${JSON.stringify(fileURLToPath(new URL("../", import.meta.url)))}`,
      `--outfile=${target}`,
    ],
    { encoding: "utf8" },
  );
  expect(built.status, built.stderr).toBe(0);
  const child = spawn(process.execPath, [target, mode], {
    cwd: f.root,
    env: f.env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  const close = once(child, "close");
  let errors = "";
  child.stderr.on("data", (data) => {
    errors += data;
  });
  child.stdin.end(
    JSON.stringify({
      workspace: f.root,
      stateHome: f.state,
      environmentToken: null,
      config: {
        schema: "cadence-service-host/1",
        http: {
          schema: "cadence-service-http/1",
          host: "127.0.0.1",
          port: 0,
          proxy: null,
        },
        cwd: f.root,
        agentDir: join(f.dir, "agent"),
        tokenSource: "generated",
        tokenFile: null,
      },
    }),
  );
  let output = "";
  const ready = await new Promise<any>((resolve, reject) => {
    child.stdout.on("data", (data) => {
      output += data;
      if (output.endsWith("\n")) resolve(JSON.parse(output));
    });
    child.on("close", () =>
      reject(new Error(`fixture exited before ready: ${errors}`)),
    );
  });
  return { child, close, ready, errors: () => errors };
}

it("lost authenticated Stop acknowledgement remains unconfirmed even after real original native close", async () => {
  const f = fixture(),
    original = await fixtureHost(f, "lost-stop");
  const result = await run(f, "stop");
  expect(result.code).toBe(1);
  expect(JSON.parse(result.stdout)).toEqual({ status: "unconfirmed" });
  const [code, signal] = await original.close;
  expect(code).toBe(0);
  expect(signal).toBeNull();
  expect(original.errors()).toBe("");
  expect(f.c.inspect().status).toBe("stopped");
  // A subsequent absent owner is not an authenticated acknowledgement either.
  expect(JSON.parse((await run(f, "stop")).stdout)).toEqual({
    status: "unconfirmed",
  });
}, 30000);
