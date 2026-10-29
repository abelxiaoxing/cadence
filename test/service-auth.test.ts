import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { request as httpRequest } from "node:http";
import {
  request as httpsRequest,
  createServer as httpsServer,
} from "node:https";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { ActionAdmission } from "../src/service/admission.ts";
import { AccessMaterial } from "../src/service/auth.ts";
import { decodeHttpPolicy } from "../src/service/config.ts";
import { ServiceCoordination } from "../src/service/coordination.ts";
import type { AdmissionOwner, StoredCommand } from "../src/service/ports.ts";
import { PrivateFiles } from "../src/service/private-files.ts";
import { ServiceClient } from "../src/service-client.ts";
import type {
  ContextVersion,
  ExportRequest,
  ReadCursor,
} from "../src/service-contract.ts";
import { HttpServiceTransport } from "../src/service-http-client.ts";
import { wireUrl } from "../src/service-wire.ts";
import {
  deferred,
  exportFrames,
  type Fixture,
  httpFixture,
  request,
  session,
} from "./helpers/service-http-fixture.ts";
import { nativeBuild } from "./helpers/source-build.ts";

const fixtures: Fixture[] = [];
async function setup(...args: Parameters<typeof httpFixture>) {
  const f = await httpFixture(...args);
  fixtures.push(f);
  return f;
}
afterEach(async () => {
  for (const f of fixtures.splice(0)) await f.server.close();
});
function accessFixture(
  source: Parameters<typeof AccessMaterial.initialize>[2] = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "cadence-access-"));
  const files = new PrivateFiles(dir);
  AccessMaterial.initialize(files, dir, source);
  return {
    dir,
    files,
    source,
    material: new AccessMaterial(files, dir, source),
  };
}
function raw(origin: string, bytes: string | Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(origin),
      socket = connect(Number(url.port), url.hostname);
    const chunks: Buffer[] = [];
    socket.on("connect", () => socket.end(bytes));
    socket.on("data", (c) => chunks.push(c));
    socket.on("error", reject);
    socket.on("close", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}
async function socket(
  f: Fixture,
  headers?: Record<string, string>,
  id?: string,
) {
  const s = id ? { headers: { "x-cadence-attachment": id } } : await session(f);
  const ws = new WebSocket(
    `${f.origin.replace("http", "ws")}/api/v1/events?attachment=${s.headers["x-cadence-attachment"]}`,
    { headers: headers ?? { cookie: f.cookie, origin: f.origin } },
  );
  await once(ws, "open");
  return ws;
}
function wsMessage(ws: WebSocket): Promise<any> {
  return once(ws, "message").then(([value]) => JSON.parse(value.toString()));
}
async function refusedSocket(
  url: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers });
    ws.on("error", () => {});
    ws.on("open", () => {
      ws.terminate();
      reject(new Error("unexpected upgrade"));
    });
    ws.on("unexpected-response", (_req, res) => {
      const status = res.statusCode!;
      res.resume();
      res.on("end", () => {
        ws.terminate();
        resolve(status);
      });
    });
  });
}
function actionFixture(f: Fixture) {
  const context: ContextVersion = {
    epoch: f.epoch,
    accessGeneration: f.material.generation,
    configRev: 1,
    controlRev: 1,
    workspaceId: f.workspaceId,
    cwdId: randomUUID(),
    model: {
      sourceSelectionId: randomUUID(),
      provider: "fixture",
      model: "inert",
      api: "openai-completions",
      thinking: "off",
    },
    checkEnvGeneration: 1,
    checkoutGeneration: 0,
    observation: { identity: "a".repeat(64), complete: true },
    task: null,
  };
  const rows = new Map<string, StoredCommand>(),
    effects: string[] = [];
  const owner: AdmissionOwner = {
    currentAccess: () => ({
      epoch: f.epoch,
      accessGeneration: f.material.generation,
    }),
    observe: async (action) => ({
      version: { ...context, accessGeneration: f.material.generation },
      action,
      rootLabel: "fixture",
      cwdLabel: "fixture",
      readablePlan: "",
      graph: null,
      activeRunId: null,
      issues: [],
      configuredChecks: [],
      checksRevision: 1,
      reviewRunId: null,
    }),
    run: () => undefined,
    activate: (intent) => {
      effects.push(intent.commandId);
    },
    requestCancel: () => {
      throw new Error("no run");
    },
    quarantine: () => {},
  };
  const admission = new ActionAdmission(
    {
      lookup: async (id) =>
        rows.has(id)
          ? { status: "found", record: rows.get(id)! }
          : { status: "absent", committedSeq: "0" },
      commit: async (intent) => {
        const record: StoredCommand = {
          identity: intent.identity,
          receipt: {
            commandId: intent.commandId,
            operationId: intent.operationId,
            runId: intent.runId,
            admission: "accepted",
            committedSeq: "1",
            execution: null,
            settlement: null,
            created: {
              kind: "task",
              taskId: intent.createdTaskId!,
              state: "reserved",
            },
            publication: "pending",
          },
        };
        context.controlRev++;
        rows.set(intent.commandId, record);
        return { status: "committed", record };
      },
    },
    owner,
    { now: Date.now, uuid: randomUUID },
  );
  f.adapters.admission = admission;
  f.adapters.receipts = async (id) =>
    rows.has(id)
      ? { status: "found", receipt: rows.get(id)!.receipt }
      : { status: "absent", committedSeq: "0" };
  const action = {
    kind: "create",
    taskKind: "code",
    goal: "injected metadata only",
  } as const;
  return { admission, owner, context, action, effects, rows };
}

describe("explicit private access setup (no user/provider credentials)", () => {
  it("generates 32 random bytes, preserves passive absence and refuses partial initialization", () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-access-absent-")),
      files = new PrivateFiles(dir);
    expect(() => new AccessMaterial(files, dir)).toThrow();
    expect(existsSync(join(dir, "access.json"))).toBe(false);
    AccessMaterial.initialize(files, dir);
    const m = new AccessMaterial(files, dir),
      value = new URL(m.tokenLink("http://127.0.0.1:1234")).searchParams.get(
        "token",
      )!;
    expect(Buffer.from(value, "base64url")).toHaveLength(32);
    expect(() => AccessMaterial.initialize(files, dir)).toThrow();
    expect(
      process.platform === "win32" ||
        readFileSync(join(dir, "access.json")).length > 32,
    ).toBe(true);
    const partial = mkdtempSync(join(tmpdir(), "cadence-access-partial-"));
    const pf = new PrivateFiles(partial);
    pf.create(join(partial, "access-config.json"), "{}");
    expect(() => AccessMaterial.initialize(pf, partial)).toThrow();
    expect(existsSync(join(partial, "access.json"))).toBe(false);
  });
  it.each([
    "",
    "x".repeat(31),
    "x".repeat(1025),
    `${"x".repeat(32)}\n`,
    `${"x".repeat(32)}\u202e`,
  ])("refuses invalid configured token %# without writing", (environment) => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-access-bad-"));
    expect(() =>
      AccessMaterial.initialize(new PrivateFiles(dir), dir, { environment }),
    ).toThrow();
    expect(existsSync(join(dir, "access-config.json"))).toBe(false);
  });
  it("supports special exact environment bytes and requires restart for rotation", () => {
    const environment = " +%=&雪/!".repeat(8),
      f = accessFixture({ environment });
    expect(f.material.matches(environment)).toBe(true);
    expect(f.material.matches(environment.trim())).toBe(false);
    expect(() => f.material.rotate()).toThrow("unsupported-context");
    expect(f.material.available).toBe(true);
    expect(readFileSync(join(f.dir, "access.json"), "utf8")).not.toContain(
      environment,
    );
    expect(() => new AccessMaterial(f.files, f.dir)).toThrow();
    expect(() =>
      accessFixture({ environment, tokenFile: "/no" } as any),
    ).toThrow();
  });
  it("uses explicit private raw UTF8 token file and rotates it durably without copying to access metadata", () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-token-file-")),
      tokenFile = join(dir, "token");
    const secret = "雪 %+=/".repeat(12);
    writeFileSync(tokenFile, secret, { mode: 0o600 });
    const f = accessFixture({ tokenFile });
    expect(f.material.matches(secret)).toBe(true);
    f.material.rotate();
    const replacement = readFileSync(tokenFile, "utf8");
    expect(f.material.generation).toBe(2);
    expect(f.material.matches(secret)).toBe(false);
    expect(f.material.matches(replacement)).toBe(true);
    expect(
      new AccessMaterial(f.files, f.dir, { tokenFile }).matches(replacement),
    ).toBe(true);
    expect(readFileSync(join(f.dir, "access.json"), "utf8")).not.toContain(
      replacement,
    );
  });
  it.each(["config", "external"])(
    "rotation revalidates %s after the external-file effect before metadata publication",
    (changed) => {
      const dir = mkdtempSync(join(tmpdir(), "cadence-rotate-boundary-"));
      const tokenFile = join(dir, "token");
      writeFileSync(tokenFile, "fabricated-file-token-source-111111111", {
        mode: 0o600,
      });
      const f = accessFixture({ tokenFile });
      const before = readFileSync(join(f.dir, "access.json"));
      const revoke = vi.fn();
      f.material.onRevoke(revoke);
      const replace = PrivateFiles.prototype.replace;
      const spy = vi
        .spyOn(PrivateFiles.prototype, "replace")
        .mockImplementation(function (this: PrivateFiles, ...args) {
          const result = replace.apply(this, args);
          if (args[0] === tokenFile) {
            const path =
              changed === "config"
                ? join(f.dir, "access-config.json")
                : tokenFile;
            writeFileSync(path, `${readFileSync(path, "utf8")} `);
          }
          return result;
        });
      try {
        expect(() => f.material.rotate()).toThrow("quarantine");
        expect(readFileSync(join(f.dir, "access.json"))).toEqual(before);
        expect(f.material.available).toBe(false);
        expect(revoke).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    },
  );
  it("rotation revalidates its real owner lease between selected-file effects", () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-rotate-lease-"));
    const tokenFile = join(dir, "token");
    writeFileSync(tokenFile, "fabricated-file-token-source-111111111", {
      mode: 0o600,
    });
    const root = join(dir, "workspace");
    mkdirSync(root, { mode: 0o700 });
    const c = new ServiceCoordination(root, join(dir, "state"));
    const lease = c.acquire(
      {
        schema: "cadence-service-owner-config/1",
        endpoint: "http://127.0.0.1:17423",
        policyIdentity: "a".repeat(64),
      },
      undefined,
      () => AccessMaterial.initialize(c.files, c.directory, { tokenFile }),
    );
    const material = new AccessMaterial(
      c.files,
      c.directory,
      { tokenFile },
      () => lease.assert(),
    );
    const before = readFileSync(c.path("access.json"));
    const revoke = vi.fn();
    material.onRevoke(revoke);
    const replace = PrivateFiles.prototype.replace;
    const spy = vi
      .spyOn(PrivateFiles.prototype, "replace")
      .mockImplementation(function (this: PrivateFiles, ...args) {
        const result = replace.apply(this, args);
        if (args[0] === tokenFile)
          writeFileSync(
            c.path("registration.json"),
            `${readFileSync(c.path("registration.json"), "utf8")} `,
          );
        return result;
      });
    try {
      expect(() => material.rotate()).toThrow("quarantine");
      expect(readFileSync(c.path("access.json"))).toEqual(before);
      expect(material.available).toBe(false);
      expect(revoke).toHaveBeenCalledOnce();
      expect(existsSync(c.store.lockPath)).toBe(true);
      expect(existsSync(c.path("owner.lock"))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it.each(["corrupt", "symlink", "hardlink", "mode"])(
    "preserves selected %s access and refuses",
    (kind) => {
      const f = accessFixture(),
        path = join(f.dir, "access.json");
      if (kind === "corrupt")
        writeFileSync(path, '{"token":"SECRET malformed"}');
      if (kind === "mode") {
        if (process.platform === "win32") return;
        chmodSync(path, 0o644);
      }
      if (kind === "hardlink") linkSync(path, join(f.dir, "other"));
      if (kind === "symlink") {
        const other = join(f.dir, "linked");
        symlinkSync(path, other);
        expect(() => accessFixture({ tokenFile: other })).toThrow();
        return;
      }
      const before = readFileSync(path);
      expect(() => new AccessMaterial(f.files, f.dir)).toThrow();
      expect(readFileSync(path)).toEqual(before);
    },
  );
  it("fences RAM access and revokes on uncertain durable rotation, retaining damaged bytes", () => {
    const f = accessFixture();
    const old = new URL(
      f.material.tokenLink("http://127.0.0.1:1234"),
    ).searchParams.get("token")!;
    const revoke = vi.fn();
    f.material.onRevoke(revoke);
    const replace = f.files.replace.bind(f.files);
    vi.spyOn(f.files, "replace").mockImplementation((...args) => {
      replace(...args);
      throw new Error("opaque secret");
    });
    expect(() => f.material.rotate()).toThrow("quarantine");
    expect(f.material.available).toBe(false);
    expect(f.material.matches(old)).toBe(false);
    expect(revoke).toHaveBeenCalledOnce();
    expect(
      JSON.parse(readFileSync(join(f.dir, "access.json"), "utf8")).generation,
    ).toBe(2);
  });
});

describe("actual Node HTTP security boundary, injected task/history ports", () => {
  it("public health/entry reveal no private identity or token; private routes require auth before JSON/body", async () => {
    const f = await setup();
    for (const path of ["/", "/healthz"]) {
      const r = await request(f.origin, path);
      expect(r.status).toBe(200);
      expect(r.headers["set-cookie"]).toBeUndefined();
      for (const secret of [f.dir, f.token, f.local, f.epoch, f.workspaceId])
        expect(r.text).not.toContain(secret);
      expect(r.headers["cache-control"]).toBe("no-store");
      expect(r.headers["referrer-policy"]).toBe("no-referrer");
    }
    for (const path of [
      "/app",
      "/assets/main.js",
      "/api/v1/session",
      "/api/v1/details?request=%7Bbad",
      "/api/v1/export?request=%7Bbad",
    ])
      expect((await request(f.origin, path)).status).toBe(401);
    expect(
      (
        await request(f.origin, "/api/v1/commands", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{bad",
        })
      ).status,
    ).toBe(401);
    expect(existsSync(join(f.dir, "history-v2"))).toBe(false);
  });
  it("token bootstrap redirects before app load; wrong explicit query beats valid cookie and never authenticates later routes", async () => {
    const f = await setup();
    const r = await request(f.origin, `/?token=${encodeURIComponent(f.token)}`);
    expect(r.status).toBe(303);
    expect(r.headers.location).toBe("/app");
    expect(r.text).toBe("");
    const cookie = r.headers["set-cookie"]![0];
    expect(cookie).toContain("HttpOnly; SameSite=Strict; Max-Age=43200");
    expect(cookie).not.toContain("Secure");
    expect(cookie).not.toContain("Domain");
    expect(
      (await request(f.origin, "/app", { headers: { cookie: f.cookie } }))
        .status,
    ).toBe(200);
    expect(
      (
        await request(f.origin, "/?token=wrong", {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(401);
    for (const target of [
      `/api/v1/session?token=${f.token}`,
      `/?token=${f.token}&token=${f.token}`,
      `/?token=${f.token}&other=1`,
    ])
      expect(
        (await request(f.origin, target, { headers: { cookie: f.cookie } }))
          .status,
      ).toBe(400);
    expect(
      (await request(f.origin, `/?token=${f.token}`, { method: "POST" }))
        .status,
    ).toBe(400);
  });
  it.each([
    "host",
    "origin-scheme",
    "origin-null",
    "origin-port",
    "cross-site",
    "forwarded",
    "proto",
    "real-ip",
  ])("rejects %s independently of valid cookie", async (attack) => {
    const f = await setup();
    const headers: Record<string, string> = { cookie: f.cookie };
    if (attack === "host") headers.host = "evil.invalid";
    if (attack === "origin-scheme")
      headers.origin = f.origin.replace("http:", "https:");
    if (attack === "origin-null") headers.origin = "null";
    if (attack === "origin-port") headers.origin = "http://127.0.0.1:1";
    if (attack === "cross-site") headers["sec-fetch-site"] = "cross-site";
    if (attack === "forwarded") headers.forwarded = "proto=https";
    if (attack === "proto") headers["x-forwarded-proto"] = "https";
    if (attack === "real-ip") headers["x-real-ip"] = "127.0.0.1";
    expect(
      (await request(f.origin, "/api/v1/session", { headers })).status,
    ).toBe(403);
  });
  it("local capability is separate and only direct loopback without Origin/cookie/fetch metadata", async () => {
    const f = await setup(),
      local = await session(f, true),
      browser = await session(f);
    expect(local.response.status).toBe(200);
    expect(local.value.authority).toBe("local");
    expect(local.value.csrf).toBeNull();
    expect(browser.value.authority).toBe("browser");
    expect(browser.value.csrf).toMatch(/^[a-f0-9-]{36}$/);
    expect(browser.value.capabilities.manualChecks).toBe(false);
    expect(browser.value.capabilities.actions).toBe(false); // no ActionAdmission composition
    for (const extra of [
      { origin: f.origin },
      { cookie: f.cookie },
      { "sec-fetch-site": "none" },
    ] as Record<string, string>[])
      expect(
        (
          await request(f.origin, "/api/v1/session", {
            headers: { "x-cadence-local": f.local, ...extra },
          })
        ).status,
      ).toBe(403);
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { "x-cadence-local": f.token },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { authorization: `Bearer ${f.token}` },
        })
      ).status,
    ).toBe(403);
  });
  it.each(["host", "cookie", "origin", "x-cadence-csrf", "content-length"])(
    "rejects duplicate raw %s headers",
    async (name) => {
      const f = await setup();
      const result = await raw(
        f.origin,
        `GET /healthz HTTP/1.1\r\nHost: ${new URL(f.origin).host}\r\n${name}: a\r\n${name}: b\r\nConnection: close\r\n\r\n`,
      );
      expect(result).toMatch(/^HTTP\/1\.1 400/);
    },
  );
  it("rejects header/body bounds, malformed UTF8 and duplicate JSON keys before admission", async () => {
    const f = await setup(),
      a = actionFixture(f),
      s = await session(f);
    const r = await raw(
      f.origin,
      `GET /healthz HTTP/1.1\r\nHost: ${new URL(f.origin).host}\r\nX-Big: ${"x".repeat(8192)}\r\n\r\n`,
    );
    expect(r).toMatch(/^HTTP\/1\.1 400/);
    for (const body of [
      '{"expected":null,"expected":null}',
      Buffer.from([0x7b, 0xff, 0x7d]),
    ])
      expect(
        (
          await request(f.origin, "/api/v1/preflight", {
            method: "POST",
            headers: s.headers,
            body,
          })
        ).status,
      ).toBe(400);
    const large = await request(f.origin, "/api/v1/preflight", {
      method: "POST",
      headers: { ...s.headers, "content-length": String(1024 * 1024 + 1) },
    });
    expect(large.status).toBe(413);
    expect(a.effects).toEqual([]);
  });
  it.each(["origin", "csrf", "surface", "attachment"])(
    "refuses mutation with missing/wrong %s, no effects",
    async (attack) => {
      const f = await setup(),
        a = actionFixture(f),
        s = await session(f);
      const headers: Record<string, string> = { ...s.headers };
      if (attack === "origin") delete headers.origin;
      if (attack === "csrf") headers["x-cadence-csrf"] = randomUUID();
      if (attack === "attachment")
        headers["x-cadence-attachment"] = randomUUID();
      const body = {
        expected: a.context,
        action: a.action,
        ...(attack === "surface" ? { surface: "terminal" } : {}),
      };
      expect(
        (
          await request(f.origin, "/api/v1/preflight", {
            method: "POST",
            headers,
            body: JSON.stringify(body),
          })
        ).status,
      ).not.toBe(200);
      expect(a.effects).toEqual([]);
    },
  );
  it("real ActionAdmission, exact attachment grants, lost response lookup and duplicate command do not replay injected effects", async () => {
    const f = await setup(),
      a = actionFixture(f),
      s = await session(f),
      other = await session(f);
    const preflight = await request(f.origin, "/api/v1/preflight", {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ expected: a.context, action: a.action }),
    });
    expect(preflight.status, preflight.text).toBe(200);
    const command = {
      commandId: randomUUID(),
      expected: structuredClone(a.context),
      action: a.action,
      grant: JSON.parse(preflight.text).value.grant,
    };
    const wrong = await request(f.origin, "/api/v1/commands", {
      method: "POST",
      headers: other.headers,
      body: JSON.stringify(command),
    });
    expect(wrong.status).toBe(409);
    const accepted = await request(f.origin, "/api/v1/commands", {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify(command),
    });
    expect(accepted.status, accepted.text).toBe(200);
    expect(
      (
        await request(f.origin, "/api/v1/commands", {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify(command),
        })
      ).text,
    ).toBe(accepted.text);
    expect(
      JSON.parse(
        (
          await request(f.origin, wireUrl("receipt", command.commandId), {
            headers: s.headers,
          })
        ).text,
      ).status,
    ).toBe("found");
    expect(a.effects).toEqual([command.commandId]);
  });
  it("rotation during awaited preflight/read invalidates without late mutation/private output; admitted work is not canceled", async () => {
    const f = await setup(),
      a = actionFixture(f),
      s = await session(f),
      entered = deferred(),
      release = deferred();
    const observe = a.owner.observe;
    a.owner.observe = async (...args) => {
      entered.resolve();
      await release.promise;
      return observe(...args);
    };
    const pending = request(f.origin, "/api/v1/preflight", {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ expected: a.context, action: a.action }),
    });
    await entered.promise;
    f.material.rotate();
    release.resolve();
    expect((await pending).status).not.toBe(200);
    expect(a.effects).toEqual([]);
    expect(
      (await request(f.origin, "/app", { headers: { cookie: f.cookie } }))
        .status,
    ).toBe(401);
    const newer = new URL(f.material.tokenLink(f.origin)).searchParams.get(
      "token",
    )!;
    expect((await request(f.origin, `/?token=${newer}`)).status).toBe(303);
  });
  it("awaited private reads recheck generation before response", async () => {
    const f = await setup(),
      entered = deferred(),
      release = deferred();
    f.projection.snapshot = async (scope) => {
      entered.resolve();
      await release.promise;
      return f.snap(scope);
    };
    const pending = request(f.origin, wireUrl("snapshot", f.scope), {
      headers: { cookie: f.cookie },
    });
    await entered.promise;
    f.material.rotate();
    release.resolve();
    const r = await pending;
    expect(r.status).toBe(401);
    expect(r.text).not.toContain(f.storeId);
  });
  it("unavailable adapters refuse rather than fabricate task/history success; arbitrary paths/admin/shell are absent", async () => {
    const f = await setup();
    f.adapters.projection = null;
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(503);
    for (const path of [
      "/local/v1/admin/stop",
      "/api/v1/shell",
      "/etc/passwd",
      "/assets/../secret",
      "/assets/%2e%2e/secret",
    ])
      expect(
        (await request(f.origin, path, { headers: { cookie: f.cookie } }))
          .status,
      ).not.toBe(200);
    const r = await request(f.origin, wireUrl("receipt", randomUUID()), {
      headers: { cookie: f.cookie },
    });
    expect(JSON.parse(r.text).status).toBe("inconclusive");
  });
  it("portable Fetch client uses named methods/local capability, validates responses and never retries mutations", async () => {
    const f = await setup(),
      a = actionFixture(f);
    const transport = new HttpServiceTransport({
      build: nativeBuild,
      origin: f.origin,
      localCapability: f.local,
    });
    const client = new ServiceClient(transport);
    expect((await client.session()).kind).toBe("ok");
    const preflight = await client.preflight(a.context, a.action);
    expect(preflight.kind).toBe("ok");
    if (preflight.kind !== "ok") return;
    const command = {
      commandId: randomUUID(),
      expected: structuredClone(a.context),
      action: a.action,
      grant: preflight.value.grant,
    };
    expect((await client.create(command)).kind).toBe("ok");
    expect((await client.receipt(command.commandId)).status).toBe("found");
    await transport.detach();
    expect(a.effects).toEqual([command.commandId]);
    const fetcher = vi.fn(async () => {
      throw new Error("lost response");
    });
    const broken = new ServiceClient(
      new HttpServiceTransport({
        build: nativeBuild,
        origin: f.origin,
        fetch: fetcher,
      }),
    );
    expect((await broken.session()).kind).toBe("error");
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("real read-only WebSockets and bounded history transport", () => {
  it.each(["missing", "wrong", "origin", "scheme", "query", "control"])(
    "refuses socket %s admission/control",
    async (attack) => {
      const f = await setup(),
        s = await session(f);
      const url = `${f.origin.replace("http", "ws")}/api/v1/events?attachment=${s.headers["x-cadence-attachment"]}`;
      if (attack === "control") {
        const ws = await socket(
          f,
          undefined,
          s.headers["x-cadence-attachment"],
        );
        const closed = once(ws, "close");
        ws.send('{"kind":"start"}');
        await closed;
        return;
      }
      const headers = {
        cookie:
          attack === "missing"
            ? ""
            : attack === "wrong"
              ? `${f.auth.cookieName}=bad`
              : f.cookie,
        origin:
          attack === "origin"
            ? "http://evil.invalid"
            : attack === "scheme"
              ? f.origin.replace("http", "https")
              : f.origin,
      };
      expect(
        await refusedSocket(
          attack === "query" ? `${url}&token=${f.token}` : url,
          headers,
        ),
      ).toBeGreaterThanOrEqual(400);
    },
  );
  it("snapshot watermark race filters older/duplicate events, delivers newer, resyncs a gap without work", async () => {
    const f = await setup(),
      entered = deferred(),
      release = deferred();
    const initial = f.snap(f.scope);
    f.projection.snapshot = async () => {
      entered.resolve();
      await release.promise;
      return initial;
    };
    const ws = await socket(f);
    const messages: any[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
    await entered.promise;
    f.emit("0", "1");
    f.emit("1", "2");
    release.resolve();
    await vi.waitFor(() =>
      expect(messages.map((m) => m.kind)).toEqual(["snapshot", "event"]),
    );
    expect(messages[0].snapshot.committedSeq).toBe("1");
    expect(messages[1].event.committedSeq).toBe("2");
    f.projection.snapshot = async (scope) => f.snap(scope);
    f.emit("3", "4");
    await vi.waitFor(() =>
      expect(messages.some((m) => m.kind === "resync")).toBe(true),
    );
    expect(messages.at(-1).snapshot.committedSeq).toBe("4");
    const close = once(ws, "close");
    ws.close();
    await close;
  });
  it("rotation closes original WS and removes grants but does not request cancellation", async () => {
    const f = await setup(),
      a = actionFixture(f),
      s = await session(f),
      cancel = vi.spyOn(a.owner, "requestCancel");
    const ws = await socket(f, undefined, s.headers["x-cadence-attachment"]),
      close = once(ws, "close");
    const pre = await request(f.origin, "/api/v1/preflight", {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ expected: a.context, action: a.action }),
    });
    expect(pre.status).toBe(200);
    f.material.rotate();
    await close;
    expect(cancel).not.toHaveBeenCalled();
    expect(
      (
        await request(f.origin, "/api/v1/commands", {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify({
            commandId: randomUUID(),
            expected: a.context,
            action: a.action,
            grant: JSON.parse(pre.text).value.grant,
          }),
        })
      ).status,
    ).not.toBe(200);
    expect(a.effects).toEqual([]);
  });
  it.each(["binary", "utf8", "duplicate", "oversize"])(
    "closes on %s WS input with no adapter effect",
    async (kind) => {
      const f = await setup(),
        ws = await socket(f),
        close = once(ws, "close");
      ws.on("error", () => {});
      if (kind === "binary") ws.send(Buffer.from("{}"));
      if (kind === "utf8") ws.send(Buffer.from([0xff]), { binary: false });
      if (kind === "duplicate") ws.send('{"kind":"ping","kind":"ping"}');
      if (kind === "oversize") ws.send("x".repeat(16385));
      await close;
      expect(f.callbacks.size).toBe(0);
    },
  );
  it("limits viewers and pending snapshot queues without failing publisher", async () => {
    const f = await setup(),
      release = deferred();
    f.projection.snapshot = async (scope) => {
      await release.promise;
      return f.snap(scope);
    };
    const ws = await socket(f),
      close = once(ws, "close");
    ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
    await vi.waitFor(() => expect(f.callbacks.size).toBe(1));
    for (let i = 0; i < 260; i++)
      expect(() => f.emit(String(i + 1), String(i + 2))).not.toThrow();
    await close;
    release.resolve();
    expect(f.callbacks.size).toBe(0);
    for (let i = 0; i < 16; i++)
      expect((await session(f)).response.status).toBe(200);
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(429);
  });
  it("actual heartbeat carries committed watermark; socket departure invalidates only its attachment grant", async () => {
    const f = await setup(),
      a = actionFixture(f),
      s = await session(f),
      ws = await socket(f, undefined, s.headers["x-cadence-attachment"]);
    const first = wsMessage(ws);
    ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
    expect((await first).kind).toBe("snapshot");
    const heartbeat = wsMessage(ws);
    ws.send('{"kind":"ping"}');
    expect((await heartbeat).event).toMatchObject({
      kind: "heartbeat",
      committedSeq: "1",
    });
    const pre = await request(f.origin, "/api/v1/preflight", {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ expected: a.context, action: a.action }),
    });
    const close = once(ws, "close");
    ws.close();
    await close;
    const other = await session(f);
    expect(
      (
        await request(f.origin, "/api/v1/commands", {
          method: "POST",
          headers: other.headers,
          body: JSON.stringify({
            commandId: randomUUID(),
            expected: a.context,
            action: a.action,
            grant: JSON.parse(pre.text).value.grant,
          }),
        })
      ).status,
    ).toBe(409);
    expect(a.effects).toEqual([]);
  });
  it("valid export frames preserve original trailer/EOF through native HTTP and portable client", async () => {
    const f = await setup();
    const input: ExportRequest = {
      storeId: f.storeId,
      scope: f.scope,
      snapshotSeq: "1",
      format: "ndjson",
    };
    const client = new ServiceClient(
      new HttpServiceTransport({
        build: nativeBuild,
        origin: f.origin,
        localCapability: f.local,
      }),
    );
    const frames = [];
    for await (const frame of client.export(
      input,
      new AbortController().signal,
    ))
      frames.push(frame);
    expect(frames.map((v) => v.event.kind)).toEqual(["manifest", "trailer"]);
    const r = await request(
      f.origin,
      wireUrl("download", { ...input, format: "markdown" }),
      { headers: { cookie: f.cookie } },
    );
    expect(r.status).toBe(200);
    expect(r.headers["content-type"]).toContain("text/markdown");
    expect(r.text).toContain('"kind":"trailer"');
  });
  it.each(["rotation", "abort", "trailing", "missing"])(
    "export %s never delivers a replacement completion trailer",
    async (ending) => {
      const f = await setup(),
        entered = deferred(),
        release = deferred();
      const input: ExportRequest = {
        storeId: f.storeId,
        scope: f.scope,
        snapshotSeq: "1",
        format: "ndjson",
      };
      f.projection.export = async function* (request) {
        const frames = exportFrames(request);
        yield frames[0];
        if (ending !== "missing") yield frames[1];
        entered.resolve();
        await release.promise;
        if (ending === "trailing") yield { ...frames[0], ordinal: 3 };
      };
      const controller = new AbortController();
      const response = await fetch(`${f.origin}${wireUrl("export", input)}`, {
        headers: { cookie: f.cookie },
        signal: controller.signal,
      });
      const reader = response.body!.getReader();
      let text = new TextDecoder().decode((await reader.read()).value);
      await entered.promise;
      if (ending === "rotation") f.material.rotate();
      if (ending === "abort") controller.abort();
      release.resolve();
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          text += new TextDecoder().decode(part.value);
        }
      } catch {
        /* native incomplete stream expected */
      }
      expect(text).toContain('"kind":"manifest"');
      expect(text).not.toContain('"kind":"trailer"');
    },
  );
  it("detail validates cursor only after auth and rechecks revocation across awaited validation", async () => {
    const f = await setup(),
      entered = deferred(),
      release = deferred(),
      detail = vi.spyOn(f.projection, "detail");
    const cursor: ReadCursor = {
      storeId: f.storeId,
      scope: f.scope,
      query: null,
      snapshotSeq: "1",
      recordId: randomUUID(),
      recordVersion: 1,
      field: "message",
      offset: 0,
    };
    f.projection.validateCursor = async () => {
      entered.resolve();
      await release.promise;
      return { status: "valid" };
    };
    expect((await request(f.origin, wireUrl("detail", cursor))).status).toBe(
      401,
    );
    const pending = request(f.origin, wireUrl("detail", cursor), {
      headers: { cookie: f.cookie },
    });
    await entered.promise;
    f.material.rotate();
    release.resolve();
    expect((await pending).status).toBe(401);
    expect(detail).not.toHaveBeenCalled();
  });
});

describe("actual isolated same-host HTTPS reverse proxy (not deployed/physical remote)", () => {
  it("verifies TLS CA for bootstrap/private HTTP/WSS, Secure cookie; rejects forwarding chains/native bypass", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cadence-https-")),
      key = join(dir, "key.pem"),
      cert = join(dir, "cert.pem");
    const result = spawnSync(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-days",
        "1",
        "-subj",
        "/CN=127.0.0.1",
        "-addext",
        "subjectAltName=IP:127.0.0.1",
        "-keyout",
        key,
        "-out",
        cert,
      ],
      { stdio: "pipe", timeout: 10000 },
    );
    expect(result.status).toBe(0);
    const ca = readFileSync(cert);
    let target = "";
    let publicOrigin = "";
    const sockets = new Set<import("node:stream").Duplex>();
    const proxy = httpsServer(
      { key: readFileSync(key), cert: ca },
      (req, res) => {
        const headers = { ...req.headers };
        for (const name of Object.keys(headers))
          if (
            name === "forwarded" ||
            name.startsWith("x-forwarded-") ||
            name === "x-real-ip"
          )
            delete headers[name];
        headers.host = new URL(publicOrigin).host;
        headers["x-forwarded-proto"] = "https";
        const forwarded = httpRequest(
          `${target}${req.url}`,
          { method: req.method, headers, agent: false },
          (reply) => {
            res.writeHead(reply.statusCode!, reply.headers);
            reply.pipe(res);
          },
        );
        forwarded.on("error", () => res.destroy());
        req.pipe(forwarded);
      },
    );
    proxy.on("connection", (s) => {
      sockets.add(s);
      s.on("close", () => sockets.delete(s));
    });
    proxy.on("upgrade", (req, socket, head) => {
      const backend = connect(Number(new URL(target).port), "127.0.0.1");
      sockets.add(backend);
      backend.on("close", () => sockets.delete(backend));
      backend.on("error", () => socket.destroy());
      socket.on("error", () => backend.destroy());
      backend.on("connect", () => {
        const headers = Object.entries(req.headers)
          .filter(
            ([name]) =>
              !["host", "forwarded", "x-real-ip"].includes(name) &&
              !name.startsWith("x-forwarded-"),
          )
          .map(([name, value]) => `${name}: ${value}`)
          .join("\r\n");
        backend.write(
          `GET ${req.url} HTTP/1.1\r\nHost: ${new URL(publicOrigin).host}\r\nX-Forwarded-Proto: https\r\n${headers}\r\n\r\n`,
        );
        if (head.length) backend.write(head);
        socket.pipe(backend).pipe(socket);
      });
    });
    await new Promise<void>((r) => proxy.listen(0, "127.0.0.1", r));
    const address = proxy.address();
    expect(address && typeof address === "object").toBeTruthy();
    publicOrigin = `https://127.0.0.1:${(address as import("node:net").AddressInfo).port}`;
    try {
      const f = await setup({
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: 0,
        proxy: { origin: publicOrigin, trustedAddresses: ["127.0.0.1"] },
      });
      target = f.origin;
      const tls = (path: string, headers: Record<string, string> = {}) =>
        new Promise<{
          status: number;
          headers: import("node:http").IncomingMessage["headers"];
          text: string;
        }>((resolve, reject) => {
          const req = httpsRequest(
            `${publicOrigin}${path}`,
            { ca, headers, agent: false },
            (res) => {
              let text = "";
              res.setEncoding("utf8");
              res.on("data", (v) => {
                text += v;
              });
              res.on("end", () =>
                resolve({
                  status: res.statusCode!,
                  headers: res.headers,
                  text,
                }),
              );
            },
          );
          req.on("error", reject);
          req.end();
        });
      const boot = await tls(`/?token=${f.token}`);
      expect(boot.status).toBe(303);
      expect(boot.headers["set-cookie"]![0]).toContain("; Secure");
      const s = await tls("/api/v1/session", {
        cookie: f.cookie,
        origin: publicOrigin,
        "x-forwarded-host": "attacker.invalid",
        forwarded: "bad",
      });
      expect(s.status).toBe(200);
      expect((await tls("/app", { cookie: f.cookie })).status).toBe(200);
      expect(
        (await tls("/api/v1/session", { "x-cadence-local": f.local })).status,
      ).toBe(403);
      expect(
        (await tls("/api/v1/session", { cookie: f.cookie, origin: f.origin }))
          .status,
      ).toBe(403);
      const ws = new WebSocket(
        `${publicOrigin.replace("https", "wss")}/api/v1/events?attachment=${s.headers["x-cadence-attachment"]}`,
        { ca, headers: { cookie: f.cookie, origin: publicOrigin } },
      );
      await once(ws, "open");
      const first = wsMessage(ws);
      ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
      expect((await first).kind).toBe("snapshot");
      const close = once(ws, "close");
      f.material.rotate();
      await close;
      expect((await tls("/app", { cookie: f.cookie })).status).toBe(401);
      for (const extra of [
        { "x-forwarded-proto": "https,http" },
        { "x-forwarded-proto": "https", "x-forwarded-for": "127.0.0.1" },
        { "x-forwarded-proto": "http" },
        { forwarded: "proto=https" },
      ] as Record<string, string>[])
        expect(
          (
            await request(f.origin, "/api/v1/session", {
              headers: {
                cookie: f.cookie,
                host: new URL(publicOrigin).host,
                ...extra,
              },
            })
          ).status,
        ).toBe(403);
      expect(
        decodeHttpPolicy({
          schema: "cadence-service-http/1",
          host: "127.0.0.1",
          port: 0,
          proxy: { origin: publicOrigin, trustedAddresses: ["127.0.0.2"] },
        }).proxy!.trustedAddresses,
      ).toEqual(["127.0.0.2"]);
      await expect(
        new Promise((resolve, reject) => {
          const req = httpsRequest(publicOrigin, { agent: false }, resolve);
          req.on("error", reject);
          req.end();
        }),
      ).rejects.toThrow(); // no CA => genuine TLS verification failure
    } finally {
      const closed = new Promise<void>((resolve, reject) =>
        proxy.close((e) => (e ? reject(e) : resolve())),
      );
      for (const socket of sockets) socket.destroy();
      await closed;
      expect(proxy.listening).toBe(false);
    }
  }, 20000);
});

describe("transport regression controls and original settlement", () => {
  it("special Unicode/percent/equal/space token works over actual bootstrap, cookie and socket", async () => {
    const f = await setup(undefined, {}, { environment: "雪 +%=/!".repeat(8) });
    const boot = await request(
      f.origin,
      `/?token=${encodeURIComponent(f.token)}`,
    );
    expect(boot.status).toBe(303);
    expect((await session(f)).response.status).toBe(200);
    const ws = await socket(f),
      closed = once(ws, "close");
    ws.close();
    await closed;
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { cookie: `${f.cookie}; ${f.cookie}` },
        })
      ).status,
    ).toBe(400);
  });
  it.each(["%ff", "%c0%af", "%ed%a0%80", "%", "%u0020"])(
    "rejects malformed encoded query UTF8 %s rather than replacement decoding",
    async (bad) => {
      const f = await setup();
      expect((await request(f.origin, `/?token=${bad}`)).status).toBe(400);
      expect(
        (
          await request(f.origin, `/api/v1/search?request=%22${bad}%22`, {
            headers: { cookie: f.cookie },
          })
        ).status,
      ).toBe(400);
    },
  );
  it("forbids untrusted immediate proxy and public HTTP proxy policy", async () => {
    expect(() =>
      decodeHttpPolicy({
        schema: "cadence-service-http/1",
        host: "0.0.0.0",
        port: 0,
        proxy: null,
      }),
    ).toThrow();
    expect(() =>
      decodeHttpPolicy({
        schema: "cadence-service-http/1",
        host: "127.0.0.1",
        port: 0,
        proxy: {
          origin: "http://remote.invalid",
          trustedAddresses: ["127.0.0.1"],
        },
      }),
    ).toThrow();
    const f = await setup({
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: {
        origin: "https://remote.invalid",
        trustedAddresses: ["127.0.0.2"],
      },
    });
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: {
            cookie: f.cookie,
            host: "remote.invalid",
            "x-forwarded-proto": "https",
          },
        })
      ).status,
    ).toBe(403);
  });
  it("read-only socket heartbeat repairs a lost final update without control replay", async () => {
    const f = await setup(),
      a = actionFixture(f),
      ws = await socket(f);
    const first = wsMessage(ws);
    ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
    await first;
    const messages: any[] = [];
    ws.on("message", (v) => messages.push(JSON.parse(v.toString())));
    f.setSeq("9");
    ws.send('{"kind":"ping"}');
    await vi.waitFor(() =>
      expect(messages.map((m) => m.kind)).toEqual(["resync", "snapshot"]),
    );
    expect(messages[1].snapshot.committedSeq).toBe("9");
    expect(a.effects).toEqual([]);
    const closed = once(ws, "close");
    ws.close();
    await closed;
  });
  it("retains admitted injected work across rotation and closes original listeners/sockets once", async () => {
    const f = await setup(),
      a = actionFixture(f),
      s = await session(f),
      cancel = vi.spyOn(a.owner, "requestCancel");
    const pre = await request(f.origin, "/api/v1/preflight", {
      method: "POST",
      headers: s.headers,
      body: JSON.stringify({ expected: a.context, action: a.action }),
    });
    const command = {
      commandId: randomUUID(),
      expected: structuredClone(a.context),
      action: a.action,
      grant: JSON.parse(pre.text).value.grant,
    };
    expect(
      (
        await request(f.origin, "/api/v1/commands", {
          method: "POST",
          headers: s.headers,
          body: JSON.stringify(command),
        })
      ).status,
    ).toBe(200);
    const ws = await socket(f),
      closed = once(ws, "close");
    f.material.rotate();
    await closed;
    expect(a.effects).toEqual([command.commandId]);
    expect(cancel).not.toHaveBeenCalled();
    const first = f.server.close(),
      second = f.server.close();
    expect(first).toBe(second);
    await first;
    expect(f.server.server.listening).toBe(false);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
  it("stream digest mismatch is incomplete even when an injected adapter claims a complete trailer", async () => {
    const f = await setup();
    f.projection.export = async function* (request) {
      const frames = exportFrames(request);
      const trailer = frames[1];
      if (trailer.event.kind === "trailer")
        trailer.event.sha256 = "0".repeat(64);
      yield* frames;
    };
    const input: ExportRequest = {
      storeId: f.storeId,
      scope: f.scope,
      snapshotSeq: "1",
      format: "ndjson",
    };
    const client = new ServiceClient(
      new HttpServiceTransport({
        build: nativeBuild,
        origin: f.origin,
        localCapability: f.local,
      }),
    );
    const seen: string[] = [];
    await expect(
      (async () => {
        for await (const frame of client.export(
          input,
          new AbortController().signal,
        ))
          seen.push(frame.event.kind);
      })(),
    ).rejects.toThrow();
    expect(seen).toEqual(["manifest"]);
  });
  it("export concurrency remains reserved across original pending read, and client abort never cancels work", async () => {
    const f = await setup(),
      a = actionFixture(f),
      cancel = vi.spyOn(a.owner, "requestCancel"),
      release = deferred();
    let entered = 0;
    f.projection.export = async function* (request, signal) {
      const frames = exportFrames(request);
      yield frames[0];
      entered++;
      await release.promise;
      if (!signal.aborted) yield frames[1];
    };
    const input: ExportRequest = {
      storeId: f.storeId,
      scope: f.scope,
      snapshotSeq: "1",
      format: "ndjson",
    };
    const firstAbort = new AbortController(),
      secondAbort = new AbortController();
    const first = await fetch(`${f.origin}${wireUrl("export", input)}`, {
      headers: { cookie: f.cookie },
      signal: firstAbort.signal,
    });
    const second = await fetch(`${f.origin}${wireUrl("export", input)}`, {
      headers: { cookie: f.cookie },
      signal: secondAbort.signal,
    });
    await vi.waitFor(() => expect(entered).toBe(2));
    expect(
      (
        await request(f.origin, wireUrl("export", input), {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(429);
    firstAbort.abort();
    secondAbort.abort();
    try {
      await first.body!.cancel().catch(() => {});
      await second.body!.cancel().catch(() => {});
      // Aborting observers is not settlement of the original adapter reads.
      expect(
        (
          await request(f.origin, wireUrl("export", input), {
            headers: { cookie: f.cookie },
          })
        ).status,
      ).toBe(429);
    } finally {
      release.resolve();
    }
    expect(cancel).not.toHaveBeenCalled();
  });
  it("portable WS timing uses 5s pings/15s stale/30s resync, no reconnect or action replay (injected clock/socket)", async () => {
    const f = await setup();
    const fake = { addEventListener: vi.fn(), send: vi.fn(), close: vi.fn() };
    const factory = vi.fn(() => fake),
      status = vi.fn();
    const transport = new HttpServiceTransport({
      build: nativeBuild,
      origin: f.origin,
      localCapability: f.local,
      socket: factory,
    });
    await transport.session();
    vi.useFakeTimers();
    try {
      const stop = transport.subscribe(f.scope, () => {}, status);
      fake.addEventListener.mock.calls.find(([kind]) => kind === "open")![1]();
      vi.advanceTimersByTime(5000);
      expect(JSON.parse(fake.send.mock.calls.at(-1)![0]).kind).toBe("ping");
      vi.advanceTimersByTime(10000);
      expect(status).toHaveBeenCalledWith("stale");
      vi.advanceTimersByTime(15000);
      expect(JSON.parse(fake.send.mock.calls.at(-1)![0]).kind).toBe("resync");
      stop();
      vi.advanceTimersByTime(60000);
      expect(factory).toHaveBeenCalledOnce();
      expect(fake.close).toHaveBeenCalledOnce();
      expect(
        fake.send.mock.calls.every(([v]) =>
          ["subscribe", "ping", "resync"].includes(JSON.parse(v).kind),
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("enforces actual chunked control-body limit with fixed 413 before admission", async () => {
  const f = await setup(),
    a = actionFixture(f),
    s = await session(f);
  const result = await new Promise<{ status: number; text: string }>(
    (resolve, reject) => {
      const req = httpRequest(
        `${f.origin}/api/v1/preflight`,
        {
          method: "POST",
          headers: { ...s.headers, "transfer-encoding": "chunked" },
          agent: false,
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (part) => {
            text += part;
          });
          res.on("end", () => resolve({ status: res.statusCode!, text }));
        },
      );
      req.on("error", reject);
      req.write("x".repeat(700000));
      req.end("x".repeat(400000));
    },
  );
  expect(result.status).toBe(413);
  expect(result.text).toContain('"code":"oversize"');
  expect(a.effects).toEqual([]);
});

it("portable socket factory accepts stock ws public API and observes real snapshot without a private cast", async () => {
  const f = await setup(),
    messages: string[] = [];
  let original: WebSocket | undefined;
  const transport = new HttpServiceTransport({
    build: nativeBuild,
    origin: f.origin,
    localCapability: f.local,
    socket: (url) => {
      original = new WebSocket(url, {
        headers: { "x-cadence-local": f.local },
      });
      return original;
    },
  });
  await transport.session();
  const stop = transport.subscribe(
    f.scope,
    (message) => messages.push(message.kind),
    () => {},
  );
  await vi.waitFor(() => expect(messages).toEqual(["snapshot"]));
  const closed = once(original!, "close");
  stop();
  await closed;
});

it("lost command HTTP acknowledgment remains uncertain with one request/effect, explicit receipt lookup repairs observation only", async () => {
  const f = await setup(),
    a = actionFixture(f);
  let commands = 0;
  const fetcher: typeof fetch = async (url, options) => {
    const response = await fetch(url, options);
    if (String(url).endsWith("/api/v1/commands")) {
      commands++;
      await response.arrayBuffer();
      throw new Error("injected lost response");
    }
    return response;
  };
  const client = new ServiceClient(
    new HttpServiceTransport({
      build: nativeBuild,
      origin: f.origin,
      localCapability: f.local,
      fetch: fetcher,
    }),
  );
  await client.session();
  const pre = await client.preflight(a.context, a.action);
  expect(pre.kind).toBe("ok");
  if (pre.kind !== "ok") return;
  const command = {
    commandId: randomUUID(),
    expected: structuredClone(a.context),
    action: a.action,
    grant: pre.value.grant,
  };
  expect(await client.create(command)).toMatchObject({
    kind: "error",
    error: { effect: "uncertain" },
  });
  expect(commands).toBe(1);
  expect(a.effects).toEqual([command.commandId]);
  expect((await client.receipt(command.commandId)).status).toBe("found");
  expect(commands).toBe(1);
  expect(a.effects).toHaveLength(1);
});

it("detached unresolved original snapshots retain bounded slots; established control/detach is independent", async () => {
  const f = await setup(),
    release = deferred();
  let calls = 0;
  const control = await session(f);
  f.projection.snapshot = async (scope) => {
    calls++;
    await release.promise;
    return f.snap(scope);
  };
  try {
    for (let i = 0; i < 32; i++) {
      const ws = await socket(f),
        closed = once(ws, "close");
      ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
      await vi.waitFor(() => expect(calls).toBe(i + 1));
      ws.close();
      await closed;
      await vi.waitFor(() => expect(f.callbacks.size).toBe(0));
    }
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await request(f.origin, "/api/v1/detach", {
          method: "POST",
          headers: control.headers,
          body: "null",
        })
      ).status,
    ).toBe(200);
  } finally {
    release.resolve();
  }
  await vi.waitFor(async () =>
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(200),
  );
}, 10000);

it.each(["http", "upgrade"])(
  "overlapping %s pipelining closes only that connection, without accumulating private responses",
  async (kind) => {
    const f = await setup(),
      entered = deferred(),
      release = deferred();
    f.projection.snapshot = async (scope) => {
      entered.resolve();
      await release.promise;
      return f.snap(scope);
    };
    const url = new URL(f.origin),
      native = connect(Number(url.port), "127.0.0.1");
    const closed = once(native, "close");
    native.on("error", () => {});
    await once(native, "connect");
    native.write(
      `GET ${wireUrl("snapshot", f.scope)} HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${f.cookie}\r\n\r\n`,
    );
    await entered.promise;
    const attachment = await session(f);
    native.write(
      kind === "http"
        ? `GET /api/v1/session HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${f.cookie}\r\n\r\n`
        : `GET /api/v1/events?attachment=${attachment.headers["x-cadence-attachment"]} HTTP/1.1\r\nHost: ${url.host}\r\nCookie: ${f.cookie}\r\nOrigin: ${f.origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
    );
    await closed;
    release.resolve();
    expect((await request(f.origin, "/healthz")).status).toBe(200);
  },
);

// Independent review regressions: native transport, injected projection waits.
describe("HTTP/auth independent review regressions", () => {
  it("a buffered gap cannot let an older snapshot completion clear a newer resync's ingress state", async () => {
    const f = await setup(),
      firstEntered = deferred(),
      firstRelease = deferred(),
      secondEntered = deferred(),
      secondRelease = deferred();
    const firstSnapshot = f.snap(f.scope);
    let calls = 0;
    f.projection.snapshot = async (scope) => {
      calls++;
      if (calls === 1) {
        firstEntered.resolve();
        await firstRelease.promise;
        return firstSnapshot;
      }
      const snapshot = f.snap(scope);
      secondEntered.resolve();
      await secondRelease.promise;
      return snapshot;
    };
    const ws = await socket(f),
      messages: any[] = [];
    ws.on("message", (data) => messages.push(JSON.parse(data.toString())));
    try {
      ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
      await firstEntered.promise;
      f.emit("2", "3"); // Missing 1 -> 2 forces a resync while draining pending.
      firstRelease.resolve();
      await secondEntered.promise;
      // Wait an event-loop turn so the older snapshot's finally has run.
      await new Promise((resolve) => setImmediate(resolve));
      f.emit("3", "4");
      secondRelease.resolve();
      await vi.waitFor(() =>
        expect(
          messages.map((m) => [
            m.kind,
            m.snapshot?.committedSeq ?? m.event?.committedSeq,
          ]),
        ).toEqual([
          ["snapshot", "1"],
          ["resync", undefined],
          ["snapshot", "3"],
          ["event", "4"],
        ]),
      );
      expect(calls).toBe(2);
    } finally {
      firstRelease.resolve();
      secondRelease.resolve();
      const closed = once(ws, "close");
      ws.close();
      await closed;
    }
  });
  it.each(["cors", "no-cors", "same-origin"])(
    "token entry refuses cross-site %s subresources but permits deliberate top-level navigation",
    async (mode) => {
      const f = await setup();
      const path = `/?token=${encodeURIComponent(f.token)}`;
      const refused = await request(f.origin, path, {
        headers: {
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": mode,
          "sec-fetch-dest": "empty",
        },
      });
      expect(refused.status).toBe(403);
      expect(refused.headers["set-cookie"]).toBeUndefined();
      const allowed = await request(f.origin, path, {
        headers: {
          "sec-fetch-site": "cross-site",
          "sec-fetch-mode": "navigate",
          "sec-fetch-dest": "document",
        },
      });
      expect(allowed.status).toBe(303);
      expect(allowed.headers["set-cookie"]).toHaveLength(1);
    },
  );
  it.each(["sec-fetch-mode", "sec-fetch-dest", "sec-fetch-user"])(
    "native capability refuses standalone browser metadata %s",
    async (name) => {
      const f = await setup();
      expect(
        (
          await request(f.origin, "/api/v1/session", {
            headers: {
              "x-cadence-local": f.local,
              [name]: name === "sec-fetch-user" ? "?1" : "navigate",
            },
          })
        ).status,
      ).toBe(403);
    },
  );
  it("failed session projections do not consume unreachable attachment slots", async () => {
    const f = await setup(),
      original = f.projection.session;
    f.projection.session = async () => {
      throw new Error("opaque SESSION_SECRET");
    };
    for (let i = 0; i < 16; i++) {
      const reply = await request(f.origin, "/api/v1/session", {
        headers: { cookie: f.cookie },
      });
      expect(reply.status).toBe(503);
      expect(reply.text).not.toContain("SESSION_SECRET");
    }
    f.projection.session = original;
    expect(
      (
        await request(f.origin, "/api/v1/session", {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(200);
  });
  it("an explicitly detached attachment cannot return a late successful session bootstrap", async () => {
    const f = await setup(),
      established = await session(f),
      entered = deferred(),
      release = deferred();
    const original = f.projection.session;
    f.projection.session = async () => {
      entered.resolve();
      await release.promise;
      return original();
    };
    const pending = request(f.origin, "/api/v1/session", {
      headers: established.headers,
    });
    await entered.promise;
    try {
      expect(
        (
          await request(f.origin, "/api/v1/detach", {
            method: "POST",
            headers: established.headers,
            body: "null",
          })
        ).status,
      ).toBe(200);
    } finally {
      release.resolve();
    }
    const reply = await pending;
    expect(reply.status).toBe(409);
    expect(reply.text).not.toContain(f.storeId);
  });
});

it("HTTP close publishes its original promise before a live unsubscribe can reenter", async () => {
  const f = await setup();
  let reentered: Promise<void> | undefined;
  f.adapters.live!.subscribe = () => () => {
    reentered = f.server.close();
  };
  const ws = await socket(f),
    first = wsMessage(ws);
  ws.send(JSON.stringify({ kind: "subscribe", scope: f.scope }));
  await first;
  const closed = once(ws, "close");
  const original = f.server.close();
  // Consume both original outcomes even if the identity assertion fails.
  await Promise.allSettled([original, reentered]);
  await closed;
  expect(reentered).toBe(original);
  await expect(original).resolves.toBeUndefined();
  expect(f.server.server.listening).toBe(false);
});

it("two aborted search validations keep their original slots until settlement", async () => {
  const f = await setup(),
    release = deferred();
  const cursor: ReadCursor = {
    storeId: f.storeId,
    scope: f.scope,
    query: "needle",
    snapshotSeq: "1",
    recordId: randomUUID(),
    recordVersion: 1,
    field: "message",
    offset: 0,
  };
  let calls = 0;
  f.projection.validateCursor = async () => {
    calls++;
    await release.promise;
    return { status: "valid" };
  };
  f.projection.search = async (cursor) => ({
    cursor,
    hits: [],
    next: null,
    coverage: {
      observed: "complete",
      source: "complete",
      redacted: false,
      omissions: [],
    },
  });
  const controllers = [new AbortController(), new AbortController()];
  const requests = controllers.map((controller) =>
    fetch(`${f.origin}${wireUrl("search", cursor)}`, {
      headers: { cookie: f.cookie },
      signal: controller.signal,
    }).then(
      () => "response",
      () => "aborted",
    ),
  );
  try {
    await vi.waitFor(() => expect(calls).toBe(2));
    for (const controller of controllers) controller.abort();
    expect(await Promise.all(requests)).toEqual(["aborted", "aborted"]);
    expect(
      (
        await request(f.origin, wireUrl("search", cursor), {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(429);
    expect(calls).toBe(2);
  } finally {
    release.resolve();
  }
  await vi.waitFor(async () =>
    expect(
      (
        await request(f.origin, wireUrl("search", cursor), {
          headers: { cookie: f.cookie },
        })
      ).status,
    ).toBe(200),
  );
});

it("sixteen original partial HTTP bodies reserve ingress; the next body refuses without effects", async () => {
  const f = await setup(),
    a = actionFixture(f),
    s = await session(f),
    entered = deferred();
  let received = 0;
  // Public Node request observation runs after the registered production handler
  // has synchronously reserved its body slot, not an elapsed-time prerequisite.
  f.server.server.on("request", (req) => {
    if (req.url === "/api/v1/preflight" && ++received === 16) entered.resolve();
  });
  const requests = Array.from({ length: 16 }, () => {
    const req = httpRequest(`${f.origin}/api/v1/preflight`, {
      method: "POST",
      headers: { ...s.headers, "content-length": "2" },
      agent: false,
    });
    const closed = new Promise<void>((resolve) => req.once("close", resolve));
    req.on("error", () => {});
    req.write("{");
    return { req, closed };
  });
  try {
    await entered.promise;
    const response = await request(f.origin, "/api/v1/preflight", {
      method: "POST",
      headers: s.headers,
      body: "{}",
    });
    expect(response.status).toBe(429);
    expect(a.effects).toEqual([]);
    expect((await request(f.origin, "/healthz")).status).toBe(200);
  } finally {
    for (const { req } of requests) req.destroy();
    await Promise.all(requests.map(({ closed }) => closed));
  }
});

it("a failed reattachment preserves an already established attachment and its explicit detach", async () => {
  const f = await setup(),
    s = await session(f);
  f.projection.session = async () => {
    throw new Error("opaque SESSION_SECRET");
  };
  const response = await request(f.origin, "/api/v1/session", {
    headers: s.headers,
  });
  expect(response.status).toBe(503);
  expect(response.headers["x-cadence-attachment"]).toBeUndefined();
  expect(response.text).not.toContain("SESSION_SECRET");
  expect(
    (
      await request(f.origin, "/api/v1/detach", {
        method: "POST",
        headers: s.headers,
        body: "null",
      })
    ).status,
  ).toBe(200);
});

it("revocation at the native write-callback boundary prevents the next history read (injected callback timing)", async () => {
  const f = await setup();
  let reads = 0,
    returned = false,
    rotated = false;
  f.projection.export = async function* (request) {
    try {
      for (const frame of exportFrames(request)) {
        reads++;
        yield frame;
      }
    } finally {
      returned = true;
    }
  };
  f.server.server.on("request", (req, res) => {
    if (!req.url?.startsWith("/api/v1/export?")) return;
    const write = res.write.bind(res);
    vi.spyOn(res, "write").mockImplementation((chunk, ...args) => {
      const callback = args.find((arg) => typeof arg === "function");
      return write(chunk, (error) => {
        callback?.(error);
        // Original write callback has resolved its promise and removed its abort
        // listener, but the export continuation has not run yet.
        if (!rotated) {
          rotated = true;
          f.material.rotate();
        }
      });
    });
  });
  const input: ExportRequest = {
    storeId: f.storeId,
    scope: f.scope,
    snapshotSeq: "1",
    format: "ndjson",
  };
  let text = "";
  try {
    const response = await fetch(`${f.origin}${wireUrl("export", input)}`, {
      headers: { cookie: f.cookie },
    });
    text = await response.text();
  } catch {
    /* Native incomplete response is expected. */
  }
  await vi.waitFor(() => expect(returned).toBe(true));
  expect(rotated).toBe(true);
  expect(reads).toBe(1);
  expect(text).not.toContain('"kind":"trailer"');
});

it("native Node Fetch carries only its automatic cors mode, not browser origin/site/dest/user metadata", async () => {
  const f = await setup();
  const observed: unknown[] = [];
  f.server.server.on("request", (req) =>
    observed.push({
      mode: req.headers["sec-fetch-mode"],
      site: req.headers["sec-fetch-site"],
      dest: req.headers["sec-fetch-dest"],
      user: req.headers["sec-fetch-user"],
      origin: req.headers.origin,
    }),
  );
  const client = new ServiceClient(
    new HttpServiceTransport({
      build: nativeBuild,
      origin: f.origin,
      localCapability: f.local,
    }),
  );
  expect((await client.session()).kind).toBe("ok");
  expect(observed).toEqual([
    {
      mode: "cors",
      site: undefined,
      dest: undefined,
      user: undefined,
      origin: undefined,
    },
  ]);
});
