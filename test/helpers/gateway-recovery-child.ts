import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ServiceCoordination } from "../../src/service/coordination.ts";
import {
  inspectGatewayRecovery,
  resolveGatewayRecovery,
} from "../../src/service/gateway-recovery.ts";
import { GatewayStore } from "../../src/service/gateway-store.ts";
import { encoded, hash } from "../../src/service/private-files.ts";

const [dir, mode] = process.argv.slice(2);
const store = new GatewayStore(join(dir, "server.env"), join(dir, "state"));
if (["resolve", "interrupt", "partial-release"].includes(mode)) {
  const expected = inspectGatewayRecovery(store);
  if (mode === "interrupt") store.files.replace = () => process.exit(77);
  if (mode === "partial-release") store.files.remove = () => process.exit(77);
  // Fixture-only authority, separate from generated CLI/real TTY tests.
  resolveGatewayRecovery(store, expected, () => {});
} else {
  writeFileSync(
    store.serverConfig,
    `CADENCE_PORT=17423\nCADENCE_TOKEN=${"fake-gateway-".repeat(4)}\n`,
    { mode: 0o600 },
  );
  store.acquire("http://127.0.0.1:17423", "fake-gateway-".repeat(4), {
    kind: "workbench",
    serverConfig: store.serverConfig,
    stateHome: store.stateHome,
    agentDir: dir,
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 17423,
      proxy: null,
    },
  });
  const root = join(dir, "project");
  mkdirSync(root);
  const c = new ServiceCoordination(root, store.stateHome);
  const owner = c.acquire({
    schema: "cadence-service-owner-config/1",
    endpoint: "http://127.0.0.1:17424",
    policyIdentity: "a".repeat(64),
  });
  store.saveProject({
    id: hash(root),
    path: root,
    cwd: root,
    epoch: owner.registration.epoch,
  });
  // An unfinished opening is preserved, not replayed or silently settled.
  store.files.create(
    store.path(`commands/${randomUUID()}.json`),
    encoded({ path: root, epoch: store.read()?.epoch }),
  );
  if (mode !== "alive") store.phase("quarantined");
  if (mode === "legacy") {
    const registration = JSON.parse(
      readFileSync(store.path("gateway.json"), "utf8"),
    );
    delete registration.host;
    writeFileSync(store.path("gateway.json"), encoded(registration));
  }
  process.exit(77);
}
