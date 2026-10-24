import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { withoutNodeProxyNotice } from "./helpers/node-notices.ts";

const cases = [
  "passive",
  "bad-compat-boolean",
  "bad-compat-enum",
  "bad-compat-routing",
  "template-literal-braces",
  "valid-compat",
  "abort-during-current",
  "oauth-expiry-during-encode",
  "static-jsonc",
  "environment-accessor",
  "late-auth-tracking",
  "opaque-auth",
  "wrong-epoch",
  "bad-nested-field",
  "one-runtime",
  "mapped-thinking",
  "invalid-thinking-xhigh",
  "stalled-original",
  "opaque-rejection",
  "literal-projection",
  "changed-intent",
  "changed-settlement",
  "settlement-reject",
  "explicit-dir",
  "stale-env",
  "auth-size",
  "oauth-budget",
  "saved-key",
  "static-key",
  "named-env",
  "env-scoped",
  "no-models",
  "bad-json",
  "bad-auth-type",
  "bad-model-field",
  "bad-model-null-header",
  "bad-command",
  "bad-model-command",
  "bad-env-file",
  "bad-auth-link",
  "bad-model-link",
  "bad-hardlink",
  "umask-modes",
  "bad-large",
  "bad-missing",
  "invalid-schema",
  "invalid-thinking",
  "invalid-api",
  "invalid-model",
  "invalid-provider",
  "invalid-transport",
  "no-source",
  "stale-key",
  "stale-model",
  "corrupt-after-load",
  "proxy",
  "intent-refused",
  "cancel-intent",
  "already-canceled",
  "cancel-prepared",
  "oversize-envelope",
  "changed-during-encode",
  "settlement-pending",
  "oauth-refresh",
  "oauth-cancel",
  "oauth-timeout",
  "oauth-queue",
  "oauth-stop",
  "oauth-competing",
  "oauth-short",
  "oauth-failure",
];
let bundle: string;
const guard = new URL(
  "./helpers/service-model-context-guard.mjs",
  import.meta.url,
);
beforeAll(() => {
  bundle = mkdtempSync(join(tmpdir(), "cadence-model-context-bundle-"));
  // Existing trusted installed peers, never copied credentials/global SDK or install.
  symlinkSync(
    fileURLToPath(new URL("../node_modules", import.meta.url)),
    join(bundle, "node_modules"),
    "junction",
  );
  for (const name of [
    "service-model-context-child",
    "service-model-auth-competitor",
    "service-model-route-probe",
  ]) {
    const build = spawnSync(
      "bun",
      [
        "build",
        fileURLToPath(new URL(`./helpers/${name}.mjs`, import.meta.url)),
        "--target=node",
        "--packages=external",
        `--outfile=${join(bundle, `${name}.mjs`)}`,
      ],
      { encoding: "utf8", timeout: 10000 },
    );
    expect(build.status, build.stderr).toBe(0);
  }
});
describe("owner model preparation: isolated actual public SDK, fabricated stores; injected W3 journal", () => {
  for (const scenario of cases) {
    // POSIX mode bits are not a Windows ACL test. Keep those lanes explicitly
    // unexecuted on Windows, rather than expecting chmod to establish the premise.
    it.skipIf(process.platform === "win32" && scenario === "umask-modes")(
      `${scenario} (original native close, no inference)`,
      async () => {
        const root = mkdtempSync(
          join(tmpdir(), "cadence-model-context-native-"),
        );
        const env = fixtureEnvironment(root);
        const stdout = await runNative(
          "service-model-context-child",
          [scenario, root],
          root,
          env,
        );
        expect(stdout).not.toContain(env.CADENCE_FIXTURE_KEY);
        expect(stdout).not.toContain(env.CADENCE_FIXTURE_HEADER);
        const receipt = JSON.parse(stdout);
        expect(receipt).toMatchObject({
          scenario,
          passed: true,
          nativeWorkerSpawns: 0,
        });
        expect(receipt.contacts).toBe(scenario.startsWith("oauth-") ? 1 : 0);
        if (!scenario.startsWith("oauth-"))
          expect(receipt.remainingFiles).not.toContain("models-store.json");
        for (const record of receipt.records)
          if (record.type === "preparation")
            expect(record.validityMs).toBe(
              scenario === "oauth-budget" ? 1320000 : 121000,
            );
      },
      20000,
    );
  }
});

function fixtureEnvironment(root: string): NodeJS.ProcessEnv {
  const home = join(root, "home");
  mkdirSync(home);
  const env: NodeJS.ProcessEnv = {
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_STATE_HOME: join(root, "state"),
    LOCALAPPDATA: join(root, "local"),
    APPDATA: join(root, "roaming"),
    TMPDIR: root,
    TEMP: root,
    TMP: root,
    PI_OFFLINE: "1",
    NO_COLOR: "1",
    CADENCE_FIXTURE_KEY: "FABRICATED_cadence_secret_DO_NOT_REPORT_873195",
    CADENCE_FIXTURE_HEADER: "fabricated-header-secret",
  };
  // Deliberately no parent environment reads, including provider/proxy/Pi state.
  // The original Node executable is explicit; workspace lookup may report Git
  // absent through its existing supported non-repository path.

  return env;
}
async function runNative(
  script: string,
  args: string[],
  root: string,
  env: NodeJS.ProcessEnv,
  expectedCode = 0,
) {
  const child = spawn(
    process.execPath,
    ["--import", guard.href, join(bundle, `${script}.mjs`), ...args],
    { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let forced = false;
  const timer = setTimeout(() => {
    forced = true;
    child.kill("SIGKILL");
  }, 15000);
  child.stdout.on("data", (value) => {
    stdout += value;
    if (stdout.length > 65536) {
      forced = true;
      child.kill("SIGKILL");
    }
  });
  child.stderr.on("data", (value) => {
    stderr += value;
    if (stderr.length > 65536) {
      forced = true;
      child.kill("SIGKILL");
    }
  });
  const native = await new Promise<{
    code: number | null;
    signal: string | null;
  }>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal }));
  }).finally(() => clearTimeout(timer));
  expect(forced, `${script}: ${stderr}`).toBe(false);
  expect(native, `${script}: ${stderr}`).toEqual({
    code: expectedCode,
    signal: null,
  });
  expect(withoutNodeProxyNotice(stderr)).toBe("");
  for (const secret of [
    env.CADENCE_FIXTURE_KEY,
    env.CADENCE_FIXTURE_HEADER,
    "fabricated-probe-access",
    "fabricated-probe-refresh",
  ]) {
    if (secret && stdout.includes(secret))
      throw new Error("fixture-output-secret");
  }
  writeFileSync(
    join(root, "native-receipt.json"),
    JSON.stringify({ native, forced, observed: JSON.parse(stdout) }),
  );
  return stdout;
}

it.each([false, true])(
  "stock SDK proxy startup opt-in=%s (capability probe, not owner acceptance)",
  async (optIn) => {
    const root = mkdtempSync(join(tmpdir(), "cadence-auth-route-probe-"));
    const env = fixtureEnvironment(root);
    let sinkContacts = 0;
    let proxyContacts = 0;
    const sink = createServer(async (req, res) => {
      sinkContacts++;
      expect(req.url).toBe("/v1/oauth/token");
      for await (const _chunk of req) {
        /* drain fabricated refresh form */
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          access_token: "fabricated-probe-access",
          refresh_token: "fabricated-probe-refresh",
          expires_in: 3600,
        }),
      );
    });
    const proxy = createServer((_req, res) => {
      proxyContacts++;
      res.writeHead(502);
      res.end();
    });
    proxy.on("connect", (_req, socket) => {
      proxyContacts++;
      socket.end(
        "HTTP/1.1 502 Fixture\r\nConnection: close\r\nContent-Length: 0\r\n\r\n",
      );
    });
    await Promise.all([
      new Promise<void>((r) => sink.listen(0, "127.0.0.1", r)),
      new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r)),
    ]);
    try {
      const sinkAddress = sink.address();
      const proxyAddress = proxy.address();
      if (
        !sinkAddress ||
        typeof sinkAddress === "string" ||
        !proxyAddress ||
        typeof proxyAddress === "string"
      )
        throw new Error("fixture");
      writeFileSync(
        join(root, "auth.json"),
        JSON.stringify({
          fixture: {
            type: "oauth",
            access: "fabricated-old",
            refresh: "fabricated-refresh",
            expires: 1,
          },
        }),
        { mode: 0o600 },
      );
      writeFileSync(
        join(root, "models.json"),
        JSON.stringify({
          providers: {
            fixture: {
              oauth: "radius",
              baseUrl: `http://127.0.0.1:${sinkAddress.port}/v1`,
              api: "openai-completions",
              models: [{ id: "fixed" }],
            },
          },
        }),
        { mode: 0o600 },
      );
      env.CADENCE_FIXTURE_PORTS = `${sinkAddress.port},${proxyAddress.port}`;
      env.HTTP_PROXY =
        env.HTTPS_PROXY = `http://127.0.0.1:${proxyAddress.port}`;
      if (optIn) env.NODE_USE_ENV_PROXY = "1";
      const stdout = await runNative(
        "service-model-route-probe",
        [root],
        root,
        env,
      );
      const observed = JSON.parse(stdout);
      writeFileSync(
        join(root, "route-observation.json"),
        JSON.stringify({ ...observed, sinkContacts, proxyContacts }),
      );
      // Startup opt-in is required on this actual available host. The fixed502
      // establishes routing only, not refresh success through a working proxy.
      expect(observed.startupCapability).toBe(true);
      // Node's built-in env proxy reaches the stock SDK's own HTTP stack on
      // Node 24+ (observed on 24 and 26); on Node 22 that stock route stays
      // direct. Cadence never relies on it: owner and workers install their own
      // validated dispatchers (service-auth-proxy covers them on every runtime).
      const stockRouted = optIn && Number(observed.node.split(".")[0]) >= 24;
      expect(observed.resolved).toBe(!stockRouted);
      expect(sinkContacts).toBe(stockRouted ? 0 : 1);
      expect(proxyContacts).toBe(stockRouted ? 1 : 0);
      writeFileSync(
        join(root, "route-receipt.json"),
        JSON.stringify({
          ...observed,
          sinkContacts,
          proxyContacts,
          classification: optIn
            ? "stock-sdk-startup-proxy-fixed502"
            : "stock-sdk-no-opt-in-direct",
          ownerProxyQualified: false,
        }),
      );
    } finally {
      await Promise.all(
        [sink, proxy].map(
          (server) =>
            new Promise<void>((r) => {
              server.close(() => r());
              server.closeIdleConnections();
            }),
        ),
      );
    }
  },
  20000,
);

it.each(["read", "network"])(
  "native fixture guard denies unintended %s before SDK construction",
  async (boundary) => {
    const root = mkdtempSync(join(tmpdir(), "cadence-model-guard-"));
    const stdout = await runNative(
      "service-model-route-probe",
      [`guard-denied-${boundary}`, root],
      root,
      fixtureEnvironment(root),
      91,
    );
    expect(JSON.parse(stdout)).toEqual({ denied: true });
  },
  20000,
);
