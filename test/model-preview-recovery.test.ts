// Isolated ledger/lock fixtures only. No processes are started or signalled.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { GatewayStore } from "../src/service/gateway-store.ts";
import * as liveness from "../src/service/liveness.ts";
import { ProcessLedger } from "../src/service/process-ledger.ts";
import { healWorkbench } from "../src/service/self-heal.ts";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "preview-recovery-")),
    state = join(dir, "state");
  mkdirSync(state);
  const store = new GatewayStore(join(dir, "server.env"), state);
  const token = "fake-gateway-preview-".repeat(4);
  writeFileSync(
    store.serverConfig,
    `CADENCE_PORT=17425\nCADENCE_TOKEN=${token}\n`,
    { mode: 0o600 },
  );
  const acquired = store.acquire("http://127.0.0.1:17425", token, {
    kind: "workbench",
    serverConfig: store.serverConfig,
    stateHome: store.stateHome,
    agentDir: dir,
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 17425,
      proxy: null,
    },
  });
  const ledger = new ProcessLedger(store.files);
  const live = ledger.open(acquired.registration.epoch);
  return {
    store,
    ledger,
    live,
    dead() {
      for (const name of ["gateway.lock", "gateway.json"]) {
        const path = store.path(name),
          file = store.files.read(path)!;
        store.files.replace(
          path,
          file,
          JSON.stringify({
            ...JSON.parse(file.bytes.toString()),
            pid: 2147483646,
          }),
        );
      }
      return new GatewayStore(store.serverConfig, store.stateHome);
    },
  };
}
it("a dead workbench removes only its settled discovery ledger before releasing ownership", async () => {
  const f = fixture();
  f.live.add(2147483645);
  const store = f.dead();
  expect(await healWorkbench(store, { inspect: true })).toMatchObject({
    status: "reclaimable",
    workers: 0,
  });
  expect(f.store.files.read(f.ledger.path(f.live.epoch))).toBeDefined();
  expect(await healWorkbench(store)).toMatchObject({
    status: "healed",
    event: { scope: "workbench" },
  });
  expect(f.store.files.read(f.ledger.path(f.live.epoch))).toBeUndefined();
  expect(store.inspect().status).toBe("stopped");
});
it("an unidentifiable live discovery worker blocks recovery without releasing its ledger or signalling it", async () => {
  const f = fixture();
  const path = f.ledger.path(f.live.epoch),
    file = f.store.files.read(path)!;
  f.store.files.replace(
    path,
    file,
    JSON.stringify({
      ...JSON.parse(file.bytes.toString()),
      workers: [{ pid: process.pid, started: null }],
    }),
  );
  const store = f.dead();
  expect(await healWorkbench(store)).toMatchObject({
    status: "blocked",
    reason: "workers-running",
  });
  expect(store.files.read(store.path("gateway.lock"))).toBeDefined();
  expect(store.files.read(path)).toBeDefined();
});
it("a live workbench's discovery ledger is never reclaimed", async () => {
  const f = fixture();
  f.live.add(2147483645);
  expect(await healWorkbench(f.store)).toEqual({ status: "live" });
  expect(f.store.files.read(f.ledger.path(f.live.epoch))).toBeDefined();
  f.live.close();
  f.store.release();
});

it("an unknown discovery process identity is not mistaken for a closed worker", async () => {
  const f = fixture();
  f.live.add(process.pid);
  const store = f.dead();
  const original = liveness.holderState;
  const spy = vi
    .spyOn(liveness, "holderState")
    .mockImplementation((mark, at) =>
      mark.pid === process.pid
        ? { state: "unknown", reboot: false }
        : original(mark, at),
    );
  try {
    expect(await healWorkbench(store)).toMatchObject({
      status: "blocked",
      reason: "workers-running",
    });
    expect(store.files.read(store.path("gateway.lock"))).toBeDefined();
    expect(store.files.read(f.ledger.path(f.live.epoch))).toBeDefined();
  } finally {
    spy.mockRestore();
  }
});
