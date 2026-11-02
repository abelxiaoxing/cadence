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
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { joinProjectStops } from "../src/service/gateway.ts";
import { GatewayStore } from "../src/service/gateway-store.ts";
import { installedVersion } from "../src/service/maintenance.ts";
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
  expect(attempts).toEqual(["first"]);
  release();
  // The unconfirmed owner is reported; it keeps its own recoverable state.
  expect(await original).toEqual([projects[0]]);
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

it("directory selection needs no Pi login; Send preparation refuses missing login without admitting a message", async () => {
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
    const select = await fetch(`${g.endpoint}/workbench/v1/select`, {
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
        epoch: state.epoch,
      }),
    });
    expect(select.ok).toBe(true);
    const selected = (await select.json()) as {
      project: { id: string; epoch: null };
    };
    expect(selected.project.epoch).toBeNull();
    const response = await fetch(`${g.endpoint}/workbench/v1/prepare-send`, {
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
        projectId: selected.project.id,
        commandId: randomUUID(),
        epoch: state.epoch,
      }),
    });
    expect(response.ok).toBe(false);
    expect(g.store.projects()).toHaveLength(1);
    expect(g.store.associatedProjects()).toEqual([]);
    expect(g.f.contacts()).toBe(0);
    expect(existsSync(join(project, ".cadence"))).toBe(false);
    expect(existsSync(join(g.home, "cadence"))).toBe(false);
  } finally {
    writeFileSync(auth, saved, { mode: 0o600 });
    await g.close();
  }
}, 30000);

it("the service routes report this copy and refuse a restart that is stale, unconfirmed or has no unit to run it", async () => {
  const g = await gatewayFixture();
  try {
    const entered = await fetch(g.link, { redirect: "manual" });
    const headers = {
      Cookie: entered.headers.get("set-cookie")!.split(";")[0],
      Origin: g.endpoint,
    };
    const state = (await (
      await fetch(`${g.endpoint}/workbench/v1`, { headers })
    ).json()) as { epoch: string; csrf: string };
    const service = await (
      await fetch(`${g.endpoint}/workbench/v1/service`, { headers })
    ).json();
    const version = installedVersion(
      fileURLToPath(new URL("..", import.meta.url)),
    );
    // A checkout started outside systemd: observable, but not restartable here.
    expect(service).toEqual({
      kind: "service",
      version,
      unit: null,
      upgrade: "not-npm-global",
      work: 0,
      job: null,
    });
    const manifest = loadWebAssets().manifest;
    const request = (body: unknown, csrf = state.csrf) =>
      fetch(`${g.endpoint}/workbench/v1/service`, {
        method: "POST",
        headers: {
          ...headers,
          "Content-Type": "application/json",
          "X-Cadence-CSRF": csrf,
          "X-Cadence-Build": JSON.stringify({
            kind: "browser",
            sourceHash: manifest.sourceHash,
            contractHash: manifest.contractHash,
            buildId: manifest.buildId,
          }),
        },
        body: JSON.stringify(body),
      }).then(async (r) => ({
        status: r.status,
        body: (await r.json()) as { error?: { code: string } },
      }));
    const restart = {
      action: "restart",
      from: version,
      to: null,
      work: 0,
      epoch: state.epoch,
    };
    const code = (r: { body: { error?: { code: string } } }) =>
      r.body.error?.code;
    expect(code(await request(restart, "f".repeat(43)))).toMatch(
      /unauthenticated|forbidden/,
    );
    expect(code(await request({ ...restart, from: "0.0.1" }))).toBe("stale");
    expect(code(await request({ ...restart, to: "9.9.9" }))).toBe("invalid");
    expect(code(await request(restart))).toBe("unsupported-context");
    expect(
      g.store.files.read(g.store.path("maintenance.json")),
    ).toBeUndefined();
  } finally {
    await g.close();
  }
}, 30000);
