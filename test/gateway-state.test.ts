import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { joinProjectStops } from "../src/service/gateway.ts";
import { GatewayStore } from "../src/service/gateway-store.ts";
import { readHostConfig } from "../src/service/runtime.ts";
import { loadWebAssets } from "../src/service-assets.ts";
import { gatewayFixture } from "./helpers/gateway-fixture.ts";

it("whole-workbench Stop serially attempts every associated owner even after one refuses", async () => {
  const attempts: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const projects = ["first", "second", "third"].map((id) => ({
    id,
    path: id,
    cwd: id,
    epoch: randomUUID(),
  }));
  const original = joinProjectStops(projects, async (project) => {
    attempts.push(project.id);
    if (project.id === "first") {
      await pending;
      throw new Error("unknown first owner closure");
    }
  });
  const refusal = expect(original).rejects.toThrow();
  expect(attempts).toEqual(["first"]);
  release();
  await refusal;
  expect(attempts).toEqual(["first", "second", "third"]);
});

it("an unknown private workbench directory is preserved, never initialized or repaired on read/start", () => {
  const root = mkdtempSync(join(tmpdir(), "gateway-state-"));
  const store = new GatewayStore(join(root, "config.env"), join(root, "state"));
  expect(store.read()).toBeUndefined();
  expect(existsSync(store.directory)).toBe(false);
  store.files.create(store.path("consumer-sentinel"), "keep uncertain bytes");
  expect(() => store.read()).toThrow();
  expect(() =>
    store.acquire("http://127.0.0.1:17423", "fake-".repeat(8), {
      kind: "workbench",
      stateHome: store.stateHome,
      serverConfig: store.serverConfig,
      agentDir: root,
      policy: {
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: 17423,
        proxy: null,
      },
    }),
  ).toThrow();
  expect(readdirSync(store.directory)).toEqual(["consumer-sentinel"]);
  expect(readFileSync(store.path("consumer-sentinel"), "utf8")).toBe(
    "keep uncertain bytes",
  );
});

it("a missing Pi login refuses project admission but does not prevent the no-project workbench from stopping cleanly", async () => {
  const g = await gatewayFixture();
  const auth = join(readHostConfig(g.f.c)!.agentDir, "auth.json"),
    saved = readFileSync(auth);
  try {
    unlinkSync(auth); // Isolated fabricated source only.
    const entered = await fetch(g.link, { redirect: "manual" });
    const headers = {
      Cookie: entered.headers.get("set-cookie")!.split(";")[0],
      Origin: g.endpoint,
    };
    const state = (await (
      await fetch(`${g.endpoint}/workbench/v1`, { headers })
    ).json()) as { epoch: string; csrf: string };
    const project = join(g.f.dir, "no-login");
    mkdirSync(project);
    const manifest = loadWebAssets().manifest;
    const response = await fetch(`${g.endpoint}/workbench/v1/open`, {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
        "X-Cadence-CSRF": state.csrf,
        "X-Cadence-Build": JSON.stringify({
          kind: "browser",
          sourceHash: manifest.sourceHash,
          contractHash: manifest.contractHash,
          buildId: manifest.buildId,
        }),
      },
      body: JSON.stringify({
        path: project,
        commandId: randomUUID(),
        epoch: state.epoch,
      }),
    });
    expect(response.ok).toBe(false);
    expect(g.store.projects()).toEqual([]);
    expect(g.f.contacts()).toBe(0);
    expect(existsSync(join(project, ".cadence"))).toBe(false);
    expect(existsSync(join(g.home, "cadence"))).toBe(false);
  } finally {
    writeFileSync(auth, saved, { mode: 0o600 });
    await g.close();
  }
}, 30000);
