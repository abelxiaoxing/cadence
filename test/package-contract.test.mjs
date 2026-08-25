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
    expect(pkg.engines?.node).toBe(">=22");
    expect(pkg.license).toBe("MIT");
    expect(pkg.keywords).toContain("pi-package");
    expect(pkg.peerDependencies?.["@earendil-works/pi-coding-agent"]).toBe("*");
    expect(pkg.peerDependencies?.["@earendil-works/pi-tui"]).toBe("*");
    expect(pkg.peerDependencies?.typebox).toBe("*");
    expect(pkg.devDependencies?.["@earendil-works/pi-tui"]).toBe("0.84.3");
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.workspaces).toBeUndefined();
    expect(pkg.exports).toBeUndefined();
    const all = JSON.stringify(pkg);
    expect(all).not.toMatch(/@gotgenes/);
    expect(all).not.toMatch(/pi-subagents/);
  });

  it("registers the private extension and the four prompts and skills", () => {
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    expect(pkg.pi?.extensions).toEqual(["./src/index.ts"]);
    expect(pkg.pi?.prompts).toEqual(["./prompts/*.md"]);
    expect(pkg.pi?.skills).toEqual(["./skills"]);
    expect(pkg.files).toEqual(
      expect.arrayContaining([
        "src",
        "agents",
        "prompts",
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

  it("documents local-directory and installed-tarball loading without version or publication claims", () => {
    const readme = read(path.join(root, "README.md"));
    expect(readme).toMatch(/local package|tarball|\.tgz|installed/i);
    expect(readme).toMatch(/\.\/|absolute|relative/i);
    expect(readme).not.toMatch(
      /0\.84\.1|supported.*version|version.*support|compatib/i,
    );
    // published as @abelxiaoxing/cadence only; no other @abel/ scope or bare scope installs
    expect(readme).not.toMatch(/npm install @abel(?![a-z]+\/)/i);
    expect(readme).not.toMatch(/@abel\/(?!xiaoxing)/i);
  });

  it("exposes no host-version policy or compatibility module", () => {
    const srcFiles = walkTs(path.join(root, "src"));
    expect(srcFiles.length).toBeGreaterThan(0);
    expect(srcFiles.map((file) => path.basename(file))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/compatib/i)]),
    );
    for (const file of srcFiles) {
      expect(read(file)).not.toMatch(
        /version.*check|check.*version|unsupported.*version|from ["'][^"']*compatib/i,
      );
    }
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

  it("[SLICE-5:pi-tool-error] ships fact-only worker and reviewer contracts", () => {
    const implementation = read(
      path.join(root, "agents", "implementation-worker.md"),
    );
    const diagnosis = read(path.join(root, "agents", "diagnosis-worker.md"));
    const reviewer = read(path.join(root, "agents", "contract-reviewer.md"));

    expect(implementation).toMatch(/complete unified diff/i);
    expect(implementation).toMatch(/expected verification/i);
    expect(implementation).toMatch(/result-limit/i);
    expect(implementation).not.toMatch(
      /design-required|return-to-design|\/abel-design|recommended next (workflow )?step|nextStep|dependent successors?|split condition/i,
    );

    expect(diagnosis).toMatch(/reproduced symptoms/i);
    expect(diagnosis).toMatch(/falsif/i);
    expect(diagnosis).toMatch(/failing-regression[\s\S]{0,240}minimum-repair/i);
    expect(diagnosis).not.toMatch(
      /recommended next (workflow )?step|nextStep/i,
    );

    expect(reviewer).toMatch(/delivery-invalid/);
    expect(reviewer).toMatch(/approval-boundary/);
    expect(reviewer).not.toMatch(
      /returns?[\s\S]{0,80}(defects?|issues?)[\s\S]{0,80}to Design|recommended next (workflow )?step|nextStep/i,
    );
  });
});
