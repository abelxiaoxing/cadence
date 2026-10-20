// Actual compiled bodies/filesystem/HTTP; no browser DOM or whole-owner acceptance.
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { contractIdentity } from "../../scripts/build-identity.mjs";
import {
  publishedWebIdentity,
  publishWebOutput,
} from "../../scripts/web-output.ts";
import { ServiceHttpServer } from "../../src/service/http.ts";
import {
  ASSET_MEMBER_BYTES,
  ASSET_TOTAL_BYTES,
  assetMime,
  decodeAssetManifest,
  loadWebAssets,
} from "../../src/service-assets.ts";
import * as store from "../../src/task-store.ts";
import { extractVisStyles } from "../../web/build-vis-style";
import {
  type Fixture,
  httpFixture,
  request,
} from "../helpers/service-http-fixture.ts";

const fixtures: Fixture[] = [],
  servers: ServiceHttpServer[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const s of servers.splice(0)) await s.close();
  for (const f of fixtures.splice(0)) await f.server.close();
});
const source = resolve("web/dist");
it("shared plan proposal bytes participate in independently compiled compatibility", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-build-inputs-"));
  for (const name of [
    "src/worker-public.mjs",
    "src/worker-public.d.mts",
    "src/service-contract.ts",
    "src/service-client.ts",
    "src/service-http-client.ts",
    "src/service-wire.ts",
    "src/plan-proposal.ts",
    "src/service/contracts",
  ]) {
    mkdirSync(dirname(join(dir, name)), { recursive: true, mode: 0o700 });
    cpSync(resolve(name), join(dir, name), { recursive: true });
  }
  const before = contractIdentity(dir);
  expect(before).toBe(contractIdentity(resolve(".")));
  const proposal = join(dir, "src/plan-proposal.ts");
  writeFileSync(
    proposal,
    `${readFileSync(proposal, "utf8")}\n// changed input\n`,
  );
  expect(contractIdentity(dir)).not.toBe(before);
});
it("loads exact compiled closure and all 60 actual KaTeX fonts, preserving full bodies", () => {
  const { manifest, assets } = loadWebAssets(source);
  const fonts = manifest.assets.filter((a) =>
    /\.(woff2|woff|ttf)$/.test(a.name),
  );
  expect(fonts).toHaveLength(60);
  for (const font of fonts) {
    const body = readFileSync(
      join("node_modules/katex/dist/fonts", font.name.slice("assets/".length)),
    );
    expect(font.sha256).toBe(createHash("sha256").update(body).digest("hex"));
  }
  expect(assets.some((a) => a.path === "/assets/vis-timeline.css")).toBe(true);
  for (const a of manifest.assets)
    for (const ref of a.references)
      expect(manifest.assets.some((b) => b.name === ref)).toBe(true);
  expect(new Set(manifest.assets.map((a) => a.name)).size).toBe(
    manifest.assets.length,
  );
});
it("refuses unknown names, collision, missing reference, size overflow, changed body, and linked root", () => {
  const { manifest } = loadWebAssets(source);
  expect(() => assetMime("assets/fonts/x.woff2")).toThrow();
  expect(() => assetMime("../secret.js")).toThrow();
  expect(() =>
    decodeAssetManifest({
      ...manifest,
      assets: [...manifest.assets, manifest.assets[0]],
    }),
  ).toThrow();
  expect(() =>
    decodeAssetManifest({
      ...manifest,
      assets: manifest.assets.map((a, i) =>
        i ? a : { ...a, references: ["https://evil.test/script.js"] },
      ),
    }),
  ).toThrow();
  expect(() =>
    decodeAssetManifest({
      ...manifest,
      assets: manifest.assets.map((a, i) =>
        i ? a : { ...a, bytes: ASSET_MEMBER_BYTES + 1 },
      ),
    }),
  ).toThrow();
  expect(() =>
    decodeAssetManifest({
      ...manifest,
      assets: manifest.assets.map((a) => ({ ...a, bytes: ASSET_MEMBER_BYTES })),
    }),
  ).toThrow();
  expect(ASSET_TOTAL_BYTES).toBe(64 * 1024 * 1024);
  const dir = mkdtempSync(join(tmpdir(), "web-assets-"));
  cpSync(source, join(dir, "copy"), { recursive: true });
  writeFileSync(join(dir, "copy/assets/cadence.js"), "altered");
  expect(() => loadWebAssets(join(dir, "copy"))).toThrow("asset-body-refused");
  symlinkSync(source, join(dir, "alias"), "dir");
  expect(() => loadWebAssets(join(dir, "alias"))).toThrow();
});
it("serves compiled flat fonts/JS/CSS behind auth with exact MIME and explicit CSP policy", async () => {
  const f = await httpFixture();
  fixtures.push(f);
  const { assets } = loadWebAssets(source);
  const server = new ServiceHttpServer({
    policy: {
      schema: "cadence-service-http/1",
      host: "127.0.0.1",
      port: 0,
      proxy: null,
    },
    auth: f.auth,
    adapters: f.adapters,
    assets,
  });
  servers.push(server);
  const origin = await server.listen();
  server.admit();
  for (const asset of assets) {
    const response = await fetch(`${origin}${asset.path}`, {
      headers: { "X-Cadence-Local": f.local },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(asset.contentType);
    const received = Buffer.from(await response.arrayBuffer());
    expect(received.byteLength).toBe(asset.bytes.byteLength);
    expect(createHash("sha256").update(received).digest("hex")).toBe(
      createHash("sha256").update(asset.bytes).digest("hex"),
    );
  }
  const response = await request(origin, "/app", {
    headers: { "x-cadence-local": f.local },
  });
  expect(response.headers["content-security-policy"]).toContain(
    "script-src 'self'",
  );
  expect(response.headers["content-security-policy"]).toContain(
    "style-src-elem 'self'; style-src-attr 'unsafe-inline'",
  );
  expect(response.headers["content-security-policy"]).not.toContain(
    "unsafe-eval",
  );
  expect(response.headers["referrer-policy"]).toBe("no-referrer");
  expect((await request(origin, "/assets/KaTeX_Main-Regular.ttf")).status).toBe(
    401,
  );
  expect(
    (
      await request(origin, "/assets/fonts/KaTeX_Main-Regular.ttf", {
        headers: { "x-cadence-local": f.local },
      })
    ).status,
  ).not.toBe(200);
});

it("externalizes all 15 pinned vendor style literals without evaluating JS", () => {
  const original = readFileSync(
    "node_modules/vis-timeline/standalone/esm/vis-timeline-graph2d.mjs",
    "utf8",
  );
  const { code, css } = extractVisStyles(original);
  expect(css).toContain(".vis-timeline");
  expect(css).toContain(".vis-configuration");
  expect([...code.matchAll(/styleInject\(/g)]).toHaveLength(1); // unused function definition only
  expect(() => extractVisStyles(`${original}\n`)).toThrow(
    "unreviewed-vis-body",
  );
});

function inventory(directory: string): unknown {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => [
      entry.name,
      entry.isDirectory()
        ? inventory(join(directory, entry.name))
        : createHash("sha256")
            .update(readFileSync(join(directory, entry.name)))
            .digest("hex"),
    ]);
}
it.each(["extra", "dirty", "partial", "trimmed-manifest"])(
  "publication refuses and preserves %s prior output before moving anything",
  (fault) => {
    const dir = mkdtempSync(join(tmpdir(), "web-publish-")),
      target = join(dir, "dist"),
      run = join(dir, "run");
    mkdirSync(run, { mode: 0o700 });
    cpSync(source, target, { recursive: true });
    const expected = publishedWebIdentity(target);
    if (fault === "extra")
      writeFileSync(join(target, "foreign.txt"), "user bytes");
    if (fault === "dirty")
      writeFileSync(join(target, "assets/cadence.js"), "user bytes");
    if (fault === "partial" || fault === "trimmed-manifest")
      unlinkSync(join(target, "assets/KaTeX_Main-Regular.ttf"));
    if (fault === "trimmed-manifest") {
      const path = join(target, "manifest.json"),
        manifest = JSON.parse(readFileSync(path, "utf8"));
      manifest.assets = manifest.assets.filter(
        (a: { name: string }) => a.name !== "assets/KaTeX_Main-Regular.ttf",
      );
      for (const asset of manifest.assets)
        asset.references = asset.references.filter(
          (name: string) => name !== "assets/KaTeX_Main-Regular.ttf",
        );
      writeFileSync(path, JSON.stringify(manifest));
    }
    const before = inventory(target),
      backup = join(run, "previous-dist");
    expect(() => publishedWebIdentity(target)).toThrow();
    expect(() => publishWebOutput(source, target, backup, expected)).toThrow();
    expect(inventory(target)).toEqual(before);
    expect(existsSync(backup)).toBe(false);
  },
);
it("a failed candidate leaves the prior published tree untouched; exact output may publish", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-publish-")),
    target = join(dir, "dist"),
    bad = join(dir, "bad"),
    run = join(dir, "run");
  mkdirSync(run, { mode: 0o700 });
  cpSync(source, target, { recursive: true });
  cpSync(source, bad, { recursive: true });
  writeFileSync(join(bad, "assets/cadence.js"), "bad build");
  const expected = publishedWebIdentity(target),
    before = inventory(target),
    backup = join(run, "previous-dist");
  expect(() => publishWebOutput(bad, target, backup, expected)).toThrow();
  expect(inventory(target)).toEqual(before);
  expect(existsSync(backup)).toBe(false);
  publishWebOutput(source, target, backup, expected);
  expect(inventory(target)).toEqual(before);
  expect(inventory(backup)).toEqual(before);
});
it("refuses leaf/ancestor/hard links, query names, and an inconsistent build identity", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-unsafe-")),
    target = join(dir, "dist");
  cpSync(source, target, { recursive: true });
  unlinkSync(join(target, "assets/cadence.js"));
  symlinkSync(
    join(source, "assets/cadence.js"),
    join(target, "assets/cadence.js"),
  );
  expect(() => loadWebAssets(target)).toThrow();
  unlinkSync(join(target, "assets/cadence.js"));
  linkSync(join(target, "assets/react.js"), join(target, "assets/cadence.js"));
  expect(() => loadWebAssets(target)).toThrow();
  symlinkSync(dir, join(dir, "alias"), "dir");
  expect(() => loadWebAssets(join(dir, "alias/dist"))).toThrow();
  const { manifest } = loadWebAssets(source);
  expect(() =>
    decodeAssetManifest({ ...manifest, buildId: "0".repeat(64) }),
  ).toThrow();
  expect(() => assetMime("assets/cadence.js?extra")).toThrow();
});
it("detects ordinary read-time replacement, not just matching returned body hashes (injected interleaving)", () => {
  const dir = mkdtempSync(join(tmpdir(), "web-read-change-")),
    target = join(dir, "dist");
  cpSync(source, target, { recursive: true });
  const original = store.readBounded;
  vi.spyOn(store, "readBounded").mockImplementation((path, bound) => {
    const bytes = original(path, bound);
    if (path === join(target, "assets/cadence.js")) {
      unlinkSync(path);
      writeFileSync(path, bytes ?? ""); // identical returned bytes, different selected incarnation
    }
    return bytes;
  });
  expect(() => loadWebAssets(target)).toThrow("asset-read-changed");
});
