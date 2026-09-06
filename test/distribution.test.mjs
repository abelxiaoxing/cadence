import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const packageDir = path.resolve(import.meta.dirname, "..");
const expectedFiles = JSON.parse(
  readFileSync(
    path.join(packageDir, "provenance/package-members.json"),
    "utf8",
  ),
);

const exec = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
};

const listFiles = (root) => {
  const files = [];
  const visit = (current) => {
    for (const entry of readdirSync(current)) {
      const absolute = path.join(current, entry);
      const relative = path.relative(root, absolute);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) files.push({ relative, symlink: true });
      else if (stat.isDirectory()) visit(absolute);
      else files.push({ relative, symlink: false });
    }
  };
  visit(root);
  return files;
};

let tempRoot;
let archivePath;
let packedPackageDir;

beforeAll(() => {
  tempRoot = mkdtempSync(path.join(tmpdir(), "pi-abel-distribution-"));
  const packDir = path.join(tempRoot, "pack");
  const extractDir = path.join(tempRoot, "extract");
  mkdirSync(packDir);
  mkdirSync(extractDir);
  exec("bun", ["pm", "pack", "--destination", packDir], { cwd: packageDir });
  const archives = readdirSync(packDir).filter((file) => file.endsWith(".tgz"));
  expect(archives).toHaveLength(1);
  archivePath = path.join(packDir, archives[0]);
  exec("tar", ["xzf", archivePath, "-C", extractDir]);
  packedPackageDir = path.join(extractDir, "package");
}, 60_000);

afterAll(() => {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
});

describe("real npm tarball", () => {
  it("contains exactly the approved runtime and user-documentation files", () => {
    const members = exec("tar", ["tzf", archivePath])
      .split("\n")
      .map((entry) => entry.replace(/^\.\//, ""))
      .filter((entry) => entry && !entry.endsWith("/"))
      .sort();
    expect(members).toEqual(expectedFiles);
  });

  it("contains no symlinks and only regular files", () => {
    const files = listFiles(packedPackageDir);
    expect(files.filter((f) => f.symlink)).toEqual([]);
    expect(files.length).toBeGreaterThan(0);
  });

  it("ships the four prompts and three skills with expected names", () => {
    const prompts = listFiles(path.join(packedPackageDir, "prompts"))
      .map((f) => f.relative)
      .sort();
    expect(prompts).toEqual([
      "abel-design.md",
      "abel-diagnose.md",
      "abel-implement.md",
      "abel-init.md",
    ]);
    const skills = listFiles(path.join(packedPackageDir, "skills")).map(
      (f) => f.relative,
    );
    expect(skills).toEqual(
      expect.arrayContaining([
        "context7-auto-research/SKILL.md",
        "git-commit/SKILL.md",
        "grok-search/SKILL.md",
      ]),
    );
  });

  it("verifies package-shipped Agent files by path/name/hash identity", async () => {
    const agentsDir = path.join(packedPackageDir, "agents");
    const provenance = readFileSync(
      path.join(packageDir, "provenance", "adapted-modules.yaml"),
      "utf8",
    );
    const shipped = [
      "design-explorer",
      "diagnosis-worker",
      "implementation-worker",
    ];
    const { createHash } = await import("node:crypto");
    for (const name of shipped) {
      const file = path.join(agentsDir, `${name}.md`);
      expect(existsSync(file)).toBe(true);
      const hash = createHash("sha256")
        .update(readFileSync(file))
        .digest("hex");
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
      const binding = provenance.match(
        new RegExp(
          `path: agents/${name}\\.md[\\s\\S]{0,160}?role: ${name}[\\s\\S]{0,160}?sha256: ([0-9a-f]{64})`,
          "u",
        ),
      );
      expect(binding?.[1], `provenance hash for ${name}`).toBe(hash);
    }
    const shippedNames = readdirSync(agentsDir)
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    expect(shippedNames).toEqual([...shipped].sort());
  });
});

describe("installed-directory loading", () => {
  it("loads the same four prompts and three skills from absolute and relative local directories", async () => {
    const { DefaultResourceLoader } = await import(
      "@earendil-works/pi-coding-agent"
    );
    const load = async (cwd) => {
      const agentDir = path.join(cwd, "agent");
      mkdirSync(agentDir, { recursive: true });
      const loader = new DefaultResourceLoader({
        cwd,
        agentDir,
        additionalPromptTemplatePaths: [path.resolve(cwd, "prompts")],
        additionalSkillPaths: [path.resolve(cwd, "skills")],
        noExtensions: false,
        noSkills: false,
        noThemes: true,
        noContextFiles: true,
      });
      await loader.reload();
      const loaded = loader.getPrompts();
      const prompts = (loaded.prompts ?? []).map((p) => p.name).sort();
      const skillsLoaded = loader.getSkills?.();
      const skills = (skillsLoaded?.skills ?? []).map((s) => s.name).sort();
      return { prompts, skills, allTools: loader.getAllTools?.() ?? [] };
    };
    const abs = await load(packedPackageDir);
    const rel = await load(
      path.relative(process.cwd(), packedPackageDir) || packedPackageDir,
    );
    expect(abs.prompts).toEqual([
      "abel-design",
      "abel-diagnose",
      "abel-implement",
      "abel-init",
    ]);
    expect(abs.prompts).toEqual(rel.prompts);
    expect(abs.skills).toEqual([
      "context7-auto-research",
      "git-commit",
      "grok-search",
    ]);
    expect(abs.skills).toEqual(rel.skills);
  }, 15_000);
});

describe("installed native I/O worker", () => {
  it("executes from node_modules without a runtime TypeScript loader", async () => {
    const installed = path.join(
      tempRoot,
      "consumer-install/node_modules/@abelxiaoxing/cadence",
    );
    mkdirSync(path.dirname(installed), { recursive: true });
    cpSync(packedPackageDir, installed, { recursive: true });
    const consumer = path.join(tempRoot, "io-consumer");
    mkdirSync(consumer);
    exec("git", ["init", "-q"], { cwd: consumer });
    const worker = new Worker(
      path.join(installed, "src/workspace-io-worker.mjs"),
      {
        execArgv: [],
        workerData: {
          root: path.join(tempRoot, "io-workspaces"),
          artifactRoot: path.join(tempRoot, "io-artifacts"),
          operation: "captureBaseline",
          args: [{ consumerRoot: consumer }],
          cancelled: new SharedArrayBuffer(4),
        },
      },
    );
    const result = await new Promise((resolve, reject) => {
      let message;
      worker.once("message", (value) => {
        message = value;
      });
      worker.once("error", reject);
      worker.once("exit", (code) =>
        code === 0 && message
          ? resolve(message)
          : reject(new Error("installed-worker-failed")),
      );
    });
    expect(result).toMatchObject({
      ok: true,
      result: { revisionId: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
  }, 15_000);
});

describe("first-phase scope", () => {
  it("contains no deferred runtime or publication implementation", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(packageDir, "package.json"), "utf8"),
    );
    expect(manifest.dependencies).toBeUndefined();
    expect(manifest.scripts.publish).toBeUndefined();
  });
});

describe("AGENTS validation routes", () => {
  it("records the exact executable distribution routes", () => {
    const agents = readFileSync(path.join(packageDir, "AGENTS.md"), "utf8");
    const requiredRoutes = [
      "- Target test: `bun run test -- test/distribution.test.mjs`.",
      "- Real pack route: from this package directory, run `bun pm pack --destination <tmp>`.",
      "- Distribution suite: `bun run verify` (check && lint && test && pack:check); traceability: `bun run traceability:check`.",
    ];
    expect(requiredRoutes.filter((route) => !agents.includes(route))).toEqual(
      [],
    );
  });
});
