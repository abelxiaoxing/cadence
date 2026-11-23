// In-process gateway login. No SDK, worker or real service manager.
import { createHash } from "node:crypto";
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
    const css = /<style>([\s\S]*?)<\/style>/.exec(entry.text)![1];
    const hash = createHash("sha256").update(css).digest("base64");
    expect(entry.headers["content-security-policy"]).toContain(
      `style-src 'sha256-${hash}'`,
    );
    expect(entry.headers["content-security-policy"]).not.toMatch(
      /unsafe-inline|script-src 'self'/,
    );

    expect(entry.text).not.toMatch(/<script/i);
    expect(entry.text).toContain('action="/auth"');
    expect(entry.text).toContain('autocomplete="current-password"');
    expect(entry.text).toContain("viewport-fit=cover");
    expect(entry.text).toContain('href="/assets/app.webmanifest"');
    expect(entry.text).toContain('href="/assets/apple-touch-icon.png"');
    // Stable PWA manifest and icons remain readable without a session cookie
    // so iOS Add-to-Home-Screen and Android WebAPK install/refresh cleanly.
    for (const pwaPath of [
      "/assets/app.webmanifest",
      "/assets/apple-touch-icon.png",
      "/assets/icon-maskable-512.png",
    ]) {
      const first = await request(origin, pwaPath);
      expect(first.status).toBe(200);
      expect(first.headers["cache-control"]).toBe("public, no-cache");
      const etag = first.headers.etag;
      expect(etag).toMatch(/^"[a-f0-9]{64}"$/);
      const cached = await request(origin, pwaPath, {
        headers: { "if-none-match": etag as string },
      });
      expect(cached.status).toBe(304);
    }
    expect((await request(origin, "/assets/start.js")).status).toBe(401);
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
    // Authenticated /app?project= serves the app asset with proxy-safe anti-cache headers.
    const app = await request(origin, `/app?project=${"a".repeat(64)}`, {
      headers: { cookie },
    });
    expect(app.status).toBe(200);
    expect(app.headers["cache-control"]).toBe("no-store");
    expect(app.headers.pragma).toBe("no-cache");
    expect(app.headers.expires).toBe("0");
    expect(app.headers["cdn-cache-control"]).toBe("no-store");
    expect(app.headers["cloudflare-cdn-cache-control"]).toBe("no-store");
    expect(app.headers["surrogate-control"]).toBe("no-store");
    expect(app.headers["x-accel-expires"]).toBe("0");
    expect(app.headers.vary).toBe("Cookie");
    const buildId = app.headers["x-cadence-web-build"] as string;
    const busted = await request(
      origin,
      `/app?project=${"a".repeat(64)}&v=${buildId}`,
      { headers: { cookie } },
    );
    expect(busted.status).toBe(200);
    expect(busted.headers["x-cadence-web-build"]).toBe(buildId);
    expect(
      (
        await request(origin, `/app?project=${"a".repeat(64)}&v=bad`, {
          headers: { cookie },
        })
      ).status,
    ).toBe(400);
    const service = await request(origin, "/workbench/v1/service", {
      headers: { cookie },
    });
    expect(service.status).toBe(200);
    expect(service.headers["x-cadence-web-build"]).toBe(buildId);
    const asset = `/ui/${buildId}/assets/react.js`;
    expect(app.text).toContain(asset);
    expect((await request(origin, asset, { headers: { cookie } })).status).toBe(
      200,
    );
    expect((await request(origin, asset)).status).toBe(401);
    expect(
      (await request(origin, "/assets/react.js", { headers: { cookie } }))
        .status,
    ).not.toBe(200);
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
    // An error preserves the selected project through the next form submission.
    const next = `/app?project=${"a".repeat(64)}`;
    const retry = await request(origin, "/auth", {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "rejected-key", next }).toString(),
    });
    expect(retry.status).toBe(303);
    expect(retry.headers.location).not.toContain("rejected-key");
    const retryPage = await request(origin, retry.headers.location!, {
      headers: { accept: "text/html" },
    });
    expect(retryPage.text).toContain(`name="next" value="${next}"`);
    expect(retryPage.text).toContain('role="alert"');
    expect(retryPage.text).not.toContain("rejected-key");
    // Ambiguous forms cannot select one of two credentials.
    const duplicate = await request(origin, "/auth", {
      method: "POST",
      headers: { origin, "content-type": "application/x-www-form-urlencoded" },
      body: `password=${encodeURIComponent(token)}&password=other`,
    });
    expect(duplicate.status).toBe(400);
    expect(duplicate.headers["set-cookie"]).toBeUndefined();
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
