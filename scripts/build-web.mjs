// Real Vite outputs, private double build, exact body/reference closure. No installs.

import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assetMime,
  decodeAssetManifest,
  loadWebAssets,
} from "../src/service-assets.ts";
import { auditNotices } from "./audit-notices.mjs";
import { browserIdentity, digest, inputFiles } from "./build-identity.mjs";
import { publishedWebIdentity, publishWebOutput } from "./web-output.ts";

const root = resolve(import.meta.dirname, "..");
const inputs = (at) => inputFiles(root, at);
const sourceIdentity = () => browserIdentity(root);
const identity = sourceIdentity();
if (process.argv[2] === "--produce") {
  const outDir = process.argv[3];
  if (!outDir || existsSync(outDir)) throw new Error("fresh-output-required");
  const { build } = await import("vite");
  const { default: config } = await import("../web/vite.config.ts");
  const outputs = await build({
    ...config,
    configFile: false,
    cacheDir: join(dirname(outDir), "vite-cache"),
    define: { __CADENCE_BUILD__: JSON.stringify(identity) },
    build: { ...config.build, outDir, write: false },
  });
  if (Array.isArray(outputs) || !("output" in outputs))
    throw new Error("single-build-required");
  const emitted = outputs.output.map((o) => ({
    name: o.fileName,
    type: o.type,
    imports: o.type === "chunk" ? o.imports : [],
    modules:
      o.type === "chunk"
        ? Object.entries(o.modules)
            .filter(([, module]) => module.renderedLength > 0)
            .map(([name]) => relative(root, name).replaceAll("\\", "/"))
            .sort()
        : [],
  }));
  auditNotices(root, emitted);
  console.log(JSON.stringify({ emitted }));
  const bodies = new Map();
  const references = new Map();
  for (const output of outputs.output) {
    const name = output.fileName;
    assetMime(name); // reviewed finite names, not expected-members derived from output
    if (bodies.has(name)) throw new Error("asset-collision");
    const body = Buffer.from(
      output.type === "chunk" ? output.code : output.source,
    );
    if (
      (output.type === "chunk" && output.map) ||
      (/\.(?:js|css|html)$/.test(name) &&
        (body.includes(root) ||
          /sourceMappingURL=/.test(body.toString("utf8"))))
    )
      throw new Error("nonportable-output");
    bodies.set(name, body);
    const refs = new Set(
      output.type === "chunk"
        ? [...output.imports, ...output.dynamicImports]
        : [],
    );
    const text = body.toString("utf8");
    const raw = name.endsWith(".css")
      ? [...text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)].map(
          (m) => m[1],
        )
      : name === "index.html"
        ? [...text.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1])
        : [];
    for (const ref of raw) {
      if (/^(?:data:|https?:|\/\/|#)/.test(ref))
        throw new Error("nonlocal-asset-reference");
      refs.add(
        ref.startsWith("/")
          ? ref.slice(1)
          : posix.normalize(posix.join(posix.dirname(name), ref)),
      );
    }
    references.set(name, [...refs].sort());
  }
  const manifest = decodeAssetManifest({
    schema: "cadence-web-assets/1",
    ...identity,
    assets: [...bodies]
      .sort(([a], [b]) => a.localeCompare(b, "en"))
      .map(([name, body]) => ({
        name,
        bytes: body.length,
        sha256: digest(body),
        references: references.get(name),
      })),
  });
  // Every emitted KaTeX font, not just browser-preferred WOFF2, must survive.
  const fonts = readdirSync(
    fileURLToPath(
      new URL("../node_modules/katex/dist/fonts/", import.meta.url),
    ),
  ).sort();
  if (
    fonts.length !== 60 ||
    fonts.some((name) => !bodies.has(`assets/${name}`))
  )
    throw new Error("font-closure-incomplete");
  mkdirSync(outDir, { mode: 0o700 });
  mkdirSync(join(outDir, "assets"), { mode: 0o700 });
  for (const [name, body] of bodies)
    writeFileSync(join(outDir, name), body, { flag: "wx", mode: 0o600 });
  writeFileSync(
    join(outDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  loadWebAssets(outDir);
} else {
  if (
    process.argv.length > 3 ||
    (process.argv[2] && process.argv[2] !== "--check")
  )
    throw new Error("build-arguments");
  const temp = resolve(tmpdir());
  if (
    process.env.TMPDIR !== temp ||
    process.env.TEMP !== temp ||
    process.env.TMP !== temp ||
    lstatSync(temp).isSymbolicLink() ||
    (process.platform !== "win32" && (lstatSync(temp).mode & 0o077) !== 0)
  )
    throw new Error("explicit-private-disk-temp-required");
  const target = join(root, "web/dist");
  // Existing output must already be an intact owned closure, not a backup target
  // for unknown/dirty/partial bytes. Check again after both builds, before rename.
  const prior = publishedWebIdentity(target);
  const run = mkdtempSync(join(temp, "web-build-"));
  const commands = [];
  for (const name of ["first", "second"]) {
    const env = Object.fromEntries(
      ["PATH", "SystemRoot", "WINDIR"]
        .filter((key) => process.env[key] !== undefined)
        .map((key) => [key, process.env[key]]),
    );
    const home = join(run, `${name}-home`);
    mkdirSync(home, { mode: 0o700 });
    Object.assign(env, {
      HOME: home,
      USERPROFILE: home,
      TMPDIR: run,
      TMP: run,
      TEMP: run,
      NODE_ENV: "production",
      NO_COLOR: "1",
      TZ: "UTC",
    });
    const args = [fileURLToPath(import.meta.url), "--produce", join(run, name)];
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    writeFileSync(
      join(run, `${name}.log`),
      `${result.stdout ?? ""}${result.stderr ?? ""}`,
      { mode: 0o600 },
    );
    commands.push({
      executable: process.execPath,
      args,
      exit: result.status,
      signal: result.signal,
    });
    writeFileSync(
      join(run, "commands.json"),
      JSON.stringify(commands, null, 2),
    );
    if (result.status !== 0)
      throw new Error(`web-build-failed: ${run}/${name}.log`);
  }
  const first = join(run, "first"),
    second = join(run, "second");
  const a = inputs(first),
    b = inputs(second);
  const normalized = (tuples, base) =>
    tuples.map(([name, hash]) => [relative(base, resolve(root, name)), hash]);
  if (
    JSON.stringify(normalized(a, first)) !==
    JSON.stringify(normalized(b, second))
  )
    throw new Error(`web-build-not-reproducible: ${run}`);
  if (JSON.stringify(identity) !== JSON.stringify(sourceIdentity()))
    throw new Error("build-source-changed");
  if (process.argv[2] === "--check") {
    loadWebAssets(target);
    if (
      JSON.stringify(normalized(inputs(target), target)) !==
      JSON.stringify(normalized(a, first))
    )
      throw new Error(`web-build-stale: ${run}`);
  } else {
    publishWebOutput(first, target, join(run, "previous-dist"), prior);
  }
  console.log(
    JSON.stringify({
      kind: "web-build",
      mode: process.argv[2] === "--check" ? "check" : "publish",
      run,
      ...identity,
      files: normalized(a, first),
    }),
  );
}
