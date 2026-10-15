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

describe("@abelxiaoxing/cadence standalone package contract", () => {
  it("declares the standalone manifest without a workspace or reference dependency", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    expect(pkg.name).toBe("@abelxiaoxing/cadence");
    expect(pkg.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(pkg.type).toBe("module");
    expect(pkg.engines?.node).toBe(">=22.13.0");
    expect(pkg.license).toBe("MIT");
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(pkg.peerDependencies?.["@earendil-works/pi-tui"]).toBe("*");
    expect(pkg.peerDependencies?.["@earendil-works/pi-ai"]).toBe("*");
    expect(pkg.peerDependencies?.typebox).toBe("*");
    expect(pkg.peerDependencies?.undici).toBe("^8.9.0");
    expect(pkg.peerDependenciesMeta?.undici?.optional).not.toBe(true);
    expect(pkg.devDependencies?.undici).toBe("8.9.0");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.workspaces).toBeUndefined();
    expect(pkg.exports).toBeUndefined();
    const all = JSON.stringify(pkg);
    expect(all).not.toMatch(/@gotgenes/);
    expect(all).not.toMatch(/pi-subagents/);
  });

  it("registers the sole task extension and independent skills without prompt aliases", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    expect(pkg.pi?.extensions).toEqual(["./src/index.ts"]);
    expect(pkg.pi?.prompts).toBeUndefined();
    expect(pkg.files).not.toContain("prompts");
    expect(pkg.pi?.skills).toEqual(["./skills"]);
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        "src",
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
