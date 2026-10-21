import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (p) => readFileSync(p, "utf8");

function walkTs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(p));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

// Pi installs packages with peers omitted (npm --legacy-peer-deps, bun
// --omit=peer, pnpm auto-install-peers=false) and aliases only its own modules.
const PI_PROVIDED =
  /^(?:typebox|@earendil-works\/pi-(?:coding-agent|tui|ai|agent-core))(?:\/|$)/;
const IMPORT_SPEC =
  /\b(?:import|export)\s+(type\s+)?(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;

function extensionImports(entry) {
  const files = new Set();
  const bare = new Map();
  const visit = (file) => {
    if (files.has(file)) return;
    files.add(file);
    for (const m of read(file).matchAll(IMPORT_SPEC)) {
      const spec = m[2] ?? m[3];
      if (spec.startsWith(".")) {
        const next = path.resolve(path.dirname(file), spec);
        expect(existsSync(next), `${file} -> ${spec}`).toBe(true);
        visit(next);
      } else if (!spec.startsWith("node:")) {
        bare.set(spec, (bare.get(spec) ?? true) && Boolean(m[1]));
      }
    }
  };
  visit(entry);
  return { files, bare };
}

describe("@abelxiaoxing/cadence standalone package contract", () => {
  it("declares the standalone manifest without a workspace or reference dependency", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    expect(pkg.name).toBe("@abelxiaoxing/cadence");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.type).toBe("module");
    expect(pkg.engines?.node).toBe(">=22.19.0");
    expect(pkg.license).toBe("MIT");
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(pkg.peerDependencies?.["@earendil-works/pi-tui"]).toBe("*");
    expect(pkg.peerDependencies?.["@earendil-works/pi-ai"]).toBe("*");
    expect(pkg.peerDependencies?.typebox).toBe("*");
    // Pi's managed install omits peers; Undici must ship as a dependency.
    expect(pkg.peerDependencies?.undici).toBeUndefined();
    expect(pkg.devDependencies?.undici).toBeUndefined();
    expect(pkg.dependencies).toEqual({ undici: "8.9.0", ws: "8.21.3" });
    // The standalone owner and workers import the SDK by bare name outside Pi,
    // so they load the exact tested copy from optional dependencies.
    expect(pkg.optionalDependencies).toEqual({
      "@earendil-works/pi-ai": "0.84.3",
      "@earendil-works/pi-coding-agent": "0.84.3",
    });
    for (const name of Object.keys(pkg.optionalDependencies))
      expect(pkg.devDependencies?.[name]).toBeUndefined();
    expect(pkg.bin).toEqual({ "cadence-service": "./src/service-cli.mjs" });
    expect(pkg.workspaces).toBeUndefined();
    expect(pkg.exports).toBeUndefined();
    const all = JSON.stringify(pkg);
    expect(all).not.toMatch(/@gotgenes/);
    expect(all).not.toMatch(/pi-subagents/);
  });

  it("resolves every extension runtime import from Pi or a production dependency", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    const { files, bare } = extensionImports(path.join(root, "src/index.ts"));
    expect(files).toContain(path.join(root, "src/native-client.ts"));
    expect(bare.size).toBeGreaterThan(0);
    for (const [spec, typeOnly] of bare) {
      if (typeOnly || PI_PROVIDED.test(spec)) continue;
      const name = spec
        .split("/")
        .slice(0, spec.startsWith("@") ? 2 : 1)
        .join("/");
      expect(pkg.dependencies?.[name], spec).toBeDefined();
    }
  });

  it("registers the sole task extension and independent skills without prompt aliases", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    expect(pkg.pi?.extensions).toEqual(["./src/index.ts"]);
    expect(pkg.pi?.prompts).toBeUndefined();
    expect(pkg.files).not.toContain("prompts");
    expect(pkg.pi?.skills).toEqual(["./skills"]);
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        "src/index.ts",
        "src/service-host.mjs",
        "src/service-cli.mjs",
        "web/dist",
        "docs",
        "agents",
        "skills",
        "config",
        "licenses",
        "THIRD_PARTY_NOTICES.md",
      ]),
    );
    expect(pkg.files).not.toEqual(
      expect.arrayContaining(["test", "scripts", "openspec", "AGENTS.md"]),
    );
  });

  it("ships MIT license, notices, and the subagents attribution", () => {
    expect(read(path.join(root, "LICENSE"))).toMatch(/MIT/);
    expect(existsSync(path.join(root, "THIRD_PARTY_NOTICES.md"))).toBe(true);
    expect(
      existsSync(path.join(root, "licenses", "pi-subagents-MIT.txt")),
    ).toBe(true);
  });

  it("documents loading without imposing a Pi version range", () => {
    const readme = read(path.join(root, "README.md"));
    expect(readme).toMatch(/local package|tarball|\.tgz|installed/i);
    expect(readme).toMatch(/\.\/|absolute|relative/i);
    expect(readme).toContain("does not impose a Pi version range");
    // published as @abelxiaoxing/cadence only; no other @abel/ scope or bare scope installs
    expect(readme).not.toMatch(/npm install @abel(?![a-z]+\/)/i);
    expect(readme).not.toMatch(/@abel\/(?!xiaoxing)/i);
  });

  it("keeps protocol validation local and ships no host compatibility shim", () => {
    const srcFiles = walkTs(path.join(root, "src"));
    expect(srcFiles.length).toBeGreaterThan(0);
    expect(srcFiles.map((file) => path.basename(file))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/compatib/i)]),
    );
    for (const file of srcFiles) {
      expect(read(file)).not.toMatch(
        /from ["'][^"']*compatib|checkHostVersion|supportedHostVersions|supportedPiVersions/i,
      );
    }
    expect(existsSync(path.join(root, "src/control-contracts.ts"))).toBe(false);
  });

  it("provides the standalone Bun commands and lockfile", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    for (const s of ["check", "lint", "test", "test:target", "check:agents"]) {
      expect(typeof pkg.scripts?.[s]).toBe("string");
    }
    expect(existsSync(path.join(root, "bun.lock"))).toBe(true);
    const lock = read(path.join(root, "bun.lock"));
    expect(lock).not.toMatch(/@gotgenes/);
  });

  it("pins plain direct-edit and readonly roles without certified application promises", () => {
    const implementation = read(
      path.join(root, "agents/implementation-worker.md"),
    );
    expect(implementation).toMatch(/smallest complete change/i);
    expect(implementation).toMatch(/chosen working copy/i);
    expect(implementation).toMatch(/not passing parent checks/i);
    expect(implementation).not.toMatch(
      /parent.*seals the candidate|supplied disposable proposal root/i,
    );
    for (const role of ["design-explorer", "diagnosis-worker"]) {
      const body = read(path.join(root, `agents/${role}.md`));
      expect(body).toMatch(/readonly/i);
      expect(body).toMatch(/Do not/i);
      expect(body).toMatch(/human review/i);
    }
  });
});
