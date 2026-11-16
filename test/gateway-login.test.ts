// In-process gateway login. No SDK, worker or real service manager.
import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { createGateway } from "../src/service/gateway.ts";
import { request } from "./helpers/service-http-fixture.ts";
import { sourceBuild } from "./helpers/source-build.ts";

it("gateway entry points use the script-free 401 password page and one-year cookie login", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gateway-login-"));
  const stateHome = join(dir, "state"),
    agentDir = join(dir, "agent");
  for (const path of [stateHome, agentDir]) mkdirSync(path, { mode: 0o700 });
  // Reserve a gateway port only; no external service or CLI is launched.
  const reserve = createServer();
  reserve.listen(0, "127.0.0.1");
  await once(reserve, "listening");
  const gatewayAddress = reserve.address();
  if (!gatewayAddress || typeof gatewayAddress === "string")
    throw Error("fixture address");
  const port = gatewayAddress.port;
  await new Promise<void>((resolve) => reserve.close(() => resolve()));
  const serverConfig = join(dir, "server.env");
  const token = "fixture-gateway-token";
  writeFileSync(
    serverConfig,
    `CADENCE_PORT=${port}\nCADENCE_TOKEN=${token}\n`,
    { mode: 0o600 },
  );
  let gateway: Awaited<ReturnType<typeof createGateway>> | undefined;
  try {
    gateway = await createGateway(
      {
        kind: "workbench",
        serverConfig,
        stateHome,
        agentDir,
        policy: {
          schema: "cadence-service-http/1",
          host: "127.0.0.1",
          port,
          proxy: null,
        },
      },
      new URL("../src/service-host.mjs", import.meta.url),
      { contractHash: sourceBuild.contractHash },
    );
    const origin = gateway.endpoint;
    // Unauthenticated GET / -> 401 script-free password page.
    const entry = await request(origin, "/", {
      headers: { accept: "text/html" },
    });
    expect(entry.status).toBe(401);
    expect(entry.headers["referrer-policy"]).toBe("same-origin");
    expect(entry.text).not.toMatch(/<script/i);
    expect(entry.text).toContain('action="/auth"');
    expect(entry.text).toContain('autocomplete="current-password"');
    // Unauthenticated GET /app?project= -> 401 page, next preserves the project.
    const projectPage = await request(
      origin,
      `/app?project=${"a".repeat(64)}`,
      { headers: { accept: "text/html" } },
    );
    expect(projectPage.status).toBe(401);
    expect(projectPage.headers["referrer-policy"]).toBe("same-origin");
    expect(projectPage.text).toContain(`/app?project=${"a".repeat(64)}`);
    // POST /auth success -> 303 + one-year HttpOnly SameSite=Strict cookie.
    const login = await request(origin, "/auth", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: `password=${encodeURIComponent(token)}&next=${encodeURIComponent("/app")}`,
    });
    expect(login.status).toBe(303);
    expect(login.headers.location).toBe("/app");
    const setCookie = login.headers["set-cookie"]![0];
    expect(setCookie).toContain(
      "Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000",
    );
    const cookie = setCookie.split(";")[0];
    // Authenticated GET / -> 303 /app.
    const home = await request(origin, "/", { headers: { cookie } });
    expect(home.status).toBe(303);
    expect(home.headers.location).toBe("/app");
    // Authenticated /app?project= serves the app asset.
    expect(
      (
        await request(origin, `/app?project=${"a".repeat(64)}`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(200);
    // POST /auth wrong key -> 303 /?auth_error=1 (neutral notice page).
    const wrong = await request(origin, "/auth", {
      method: "POST",
      headers: {
        origin,
        "content-type": "application/x-www-form-urlencoded",
        cookie,
      },
      body: `password=wrong&next=${encodeURIComponent("/app")}`,
    });
    expect(wrong.status).toBe(303);
    expect(wrong.headers.location).toBe("/?auth_error=1");
    expect(wrong.headers["set-cookie"]![0]).toContain("Max-Age=0");
    // POST /auth missing Origin -> 403.
    const noOrigin = await request(origin, "/auth", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(token)}`,
    });
    expect(noOrigin.status).toBe(403);
    // Invalid cookie 401 clears the cookie in HTML and JSON.
    const cookieName = setCookie.split("=")[0];
    const invalid = `${cookieName}=stale-value`;
    const staleHtml = await request(origin, "/app", {
      headers: { cookie: invalid, accept: "text/html" },
    });
    expect(staleHtml.status).toBe(401);
    expect(staleHtml.headers["set-cookie"]![0]).toContain("Max-Age=0");
    const staleJson = await request(origin, "/app", {
      headers: { cookie: invalid },
    });
    expect(staleJson.status).toBe(401);
    expect(staleJson.headers["set-cookie"]![0]).toContain("Max-Age=0");
  } finally {
    if (gateway) {
      gateway.stop();
      await vi.waitFor(() =>
        expect(gateway!.store.inspect().status).toBe("stopped"),
      );
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
