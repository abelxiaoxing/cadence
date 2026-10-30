import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LIMITS } from "../src/worker-public.mjs";

const root = path.resolve(import.meta.dirname, "..");
const read = (p: string) => readFileSync(p, "utf8");

const NON_PACKAGE_DIRS = new Set([".git", "node_modules"]);

/** Spellings a LIMITS value may take in the engineering limits table. */
function limitSpellings(key: string, value: number): string[] {
  const units: (readonly [string, number])[] = key.endsWith("Bytes")
    ? [
        ["GiB", 2 ** 30],
        ["MiB", 2 ** 20],
        ["KiB", 2 ** 10],
        [" bytes", 1],
      ]
    : key.endsWith("Ms")
      ? [
          ["h", 3_600_000],
          ["min", 60_000],
          ["s", 1000],
          ["ms", 1],
        ]
      : [["", 1]];
  return units
    .filter(([, size]) => value % size === 0)
    .map(([unit, size]) => `${value / size}${unit}`);
}

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && NON_PACKAGE_DIRS.has(entry.name)) continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

describe("standalone independence", () => {
  it("keeps engineering guidance available without a project task framework", () => {
    const engineering = (name: string) =>
      read(path.join(root, "engineering", name));
    const agents = read(path.join(root, "AGENTS.md"));
    expect(engineering("architecture.md")).toContain(
      "## Source ownership and API boundaries",
    );
    expect(engineering("verification.md")).toContain(
      "## Validation and regression lessons",
    );
    expect(agents).toContain("`README.md`");
    expect(agents).toContain("`engineering/verification.md`");
    expect(agents).not.toMatch(/trellis/iu);
    expect(existsSync(path.join(root, ".trellis"))).toBe(false);
    for (const dir of [
      ".agents/skills",
      ".pi/agents",
      ".pi/prompts",
      ".pi/extensions",
    ]) {
      const selected = path.join(root, dir);
      if (existsSync(selected))
        expect(
          readdirSync(selected).some((name) => /^trellis(?:-|$)/iu.test(name)),
        ).toBe(false);
    }
    const settingsPath = path.join(root, ".pi/settings.json");
    if (existsSync(settingsPath))
      expect(read(settingsPath)).not.toMatch(/trellis/iu);
    for (const name of [
      ".gitattributes",
      ".rumdl.toml",
      "biome.json",
      "scripts/check-agents.mjs",
    ])
      expect(read(path.join(root, name)), name).not.toContain(".trellis/");
  });

  it("keeps every LIMITS value cited in the engineering limits table", () => {
    const rows = read(path.join(root, "engineering/limits.md"))
      .split("\n")
      .filter((line) => line.startsWith("| ") && line.includes("`LIMITS`"));
    expect(rows.length).toBeGreaterThan(10);
    const limits: Record<string, number> = LIMITS;
    for (const row of rows) {
      const [, ceiling = "", source = ""] = row
        .split("|")
        .slice(1)
        .map((cell) => cell.trim());
      const keys = [...source.matchAll(/`(\w+)`/gu)]
        .map((match) => match[1] ?? "")
        .filter((key) => key !== "LIMITS");
      expect(keys.length, row).toBeGreaterThan(0);
      // Keys are listed in the order their values appear, so each must match
      // after the previous one and a repeated number cannot cite two keys.
      let from = 0;
      for (const key of keys) {
        expect(limits, key).toHaveProperty(key);
        const ends = limitSpellings(key, limits[key] ?? Number.NaN).flatMap(
          (spelling) => {
            const pattern = new RegExp(`(?<![\\w.])${spelling}(?!\\w)`, "gu");
            pattern.lastIndex = from;
            const match = pattern.exec(ceiling);
            return match ? [match.index + match[0].length] : [];
          },
        );
        expect(
          ends.length,
          `${key}=${limits[key]} in "${ceiling}"`,
        ).toBeGreaterThan(0);
        from = Math.min(...ends);
      }
    }
  });

  it("retains historical provenance by Git object rather than a removed task path", () => {
    const policy = JSON.parse(
      read(path.join(root, "provenance/webui-reuse.json")),
    );
    expect(JSON.stringify(policy)).not.toContain(".trellis/");
    const references: unknown[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        for (const child of value) visit(child);
      } else if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          if (key === "preimage") references.push(child);
          else visit(child);
        }
      }
    };
    visit(policy);
    expect(references).toContainEqual({
      gitBlob: "ce41a6d5d830120966067d53367cc58c66611b1c",
      sha256:
        "bedd1bfcf892dd2153e65a09b997da4318897ae282d933b2b34c9a2857669ed5",
      bytes: 31556,
    });
  });

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
    const files: string[] = JSON.parse(
      read(path.join(root, "provenance/package-members.json")),
    ).map((f: string) => f.slice(8));
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
    const files: string[] = JSON.parse(
      read(path.join(root, "provenance/package-members.json")),
    ).map((f: string) => f.slice(8));
    for (const f of files) {
      if (f.startsWith("licenses/") || f === "THIRD_PARTY_NOTICES.md") continue;
      expect(f).not.toMatch(/pi-subagents/);
      expect(f).not.toMatch(/pi-permission-system/);
      expect(f).not.toMatch(/pi-autoformat/);
    }
    const pkg = JSON.parse(read(path.join(root, "package.json")));
    expect(pkg.dependencies).toEqual({ undici: "8.9.0", ws: "8.21.3" });
    expect(JSON.stringify(pkg)).not.toMatch(/pi-web-ui|pi-subagents|trellis/i);
    expect(pkg.workspaces).toBeUndefined();
  });

  it("documents local-directory and installed-tarball loading without version or publication claims", () => {
    const readme = read(path.join(root, "README.md"));
    expect(readme).toMatch(/local package|tarball|\.tgz|installed/i);
    expect(readme).toMatch(/\.\/|absolute|relative/i);
    expect(readme).not.toMatch(
      /0\.84\.1|(?:requires|supports only|supported versions of) Pi \d/i,
    );
    expect(readme).toContain("does not impose a Pi version range");
    expect(readme).toContain("not universal compatibility promises");
    expect(readme).not.toMatch(/installed from npm|npm install @abel/i);
  });
});
