/** A Cadence process that ends without its orderly Stop, leaving real state. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { HistoryFiles } from "../../src/history/files.ts";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import { GatewayStore } from "../../src/service/gateway-store.ts";
import { encoded } from "../../src/service/private-files.ts";
import { ProcessLedger } from "../../src/service/process-ledger.ts";

const [mode, root, state] = process.argv.slice(2);
if (!mode || !root || !state) throw new Error("fixture arguments");
const config = {
  schema: "cadence-service-owner-config/1",
  endpoint: process.env.FIXTURE_ENDPOINT ?? "http://127.0.0.1:17423",
  policyIdentity: "a".repeat(64),
} as const;
if (mode === "owner" || mode === "owner-worker" || mode === "tail") {
  const c = new ServiceCoordination(root, state);
  const lease = c.acquire(config);
  const files = HistoryFiles.initialize(lease);
  if (mode === "tail")
    // A batch the crash cut short: bytes without their commit marker.
    files.files.create(files.segmentPath(1), '{"torn":', 8 * 1024 * 1024);
  if (mode === "owner-worker") {
    const ledger = new ProcessLedger(c.files).open(lease.registration.epoch);
    const worker = spawn(
      process.execPath,
      ["-e", "setInterval(() => {}, 1000)"],
      { detached: process.platform !== "win32", stdio: "ignore" },
    );
    await new Promise((resolve) => worker.once("spawn", resolve));
    ledger.add(worker.pid as number);
    worker.unref();
    console.log(JSON.stringify({ worker: worker.pid }));
  }
  process.exit(77);
}
if (mode === "partial") {
  const c = new ServiceCoordination(root, state);
  c.acquire(config, undefined, () => process.exit(77));
}
if (mode === "registry-lock") {
  const c = new ServiceCoordination(root, state);
  c.files.create(
    join(c.registryDirectory, "registry.lock"),
    encoded({
      schema: "cadence-service-registry-lock/1",
      token: randomUUID(),
      pid: process.pid,
      host: hostname(),
    }),
  );
  process.exit(77);
}
if (mode === "workbench") {
  const store = new GatewayStore(join(root, "server.env"), state);
  writeFileSync(
    store.serverConfig,
    `CADENCE_PORT=17425\nCADENCE_TOKEN=${"fake-gateway-".repeat(4)}\n`,
    { mode: 0o600 },
  );
  store.acquire("http://127.0.0.1:17425", "fake-gateway-".repeat(4), {
    kind: "workbench",
    serverConfig: store.serverConfig,
    stateHome: store.stateHome,
    agentDir: root,
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 17425,
      proxy: null,
    },
  });
  store.phase("quarantined");
  process.exit(77);
}
throw new Error("unknown fixture mode");
