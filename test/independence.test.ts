import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("standalone independence", () => {
  it("exposes no host-version policy or compatibility module", () => {
    const srcFiles = walk(path.join(root, "src")).filter((f) =>
      f.endsWith(".ts"),
    );
    expect(srcFiles.length).toBeGreaterThan(0);
    for (const f of srcFiles) {
      const text = read(f);
      expect(text).not.toMatch(/0\.84\.1/);
      expect(text).not.toMatch(/host-version policy|version compatibility/);
      expect(text).not.toMatch(/pi-subagents|gotgenes/);
    }
  });

  it("leaves no private state files in the package tree", () => {
    const files = walk(root)
      .map((f) => path.relative(root, f))
      .filter((f) => !f.startsWith("node_modules/"));
    for (const f of files) {
      const base = path.basename(f);
      expect(
        /\.(log|tmp|bak|swp)$/.test(base) ||
          base.includes("transcript") ||
          /\b(session|transcript|receipt|credential)\.(json|log|txt|yaml|yml)$/.test(
            base,
          ) ||
          /(^|\/)state\//.test(f),
      ).toBe(false);
    }
  });

  it("ships no forbidden workflow checkout or reference dependency", () => {
    const files = walk(root).map((f) => path.relative(root, f));
    for (const f of files) {
      if (f.startsWith("licenses/") || f === "THIRD_PARTY_NOTICES.md") continue;
      expect(f).not.toMatch(/pi-subagents/);
      expect(f).not.toMatch(/pi-permission-system/);
      expect(f).not.toMatch(/pi-autoformat/);
    }
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.workspaces).toBeUndefined();
  });

  it("documents local-directory and installed-tarball loading without version or publication claims", () => {
    const readme = read(path.join(root, "README.md"));
    expect(readme).toMatch(/local package|tarball|\.tgz|installed/i);
    expect(readme).toMatch(/\.\/|absolute|relative/i);
    expect(readme).not.toMatch(/0\.84\.1|supported.*version|compatib/i);
    expect(readme).not.toMatch(/installed from npm|npm install @abel/i);
  });
});
