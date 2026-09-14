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
  writeFileSync,
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
  it("ships doctor selection diagnostics without changing consumer locks or running scripts", () => {
    const root = path.join(tempRoot, "doctor-consumer");
    mkdirSync(root);
    const locks = ["bun.lock", "package-lock.json"];
    for (const lock of locks) writeFileSync(path.join(root, lock), "retained");
    const manifest = { scripts: { test: "node missing-product-test.mjs" } };
    const probe = () => {
      const result = spawnSync(
        process.execPath,
        [path.join(packedPackageDir, "src/operator-cli.mjs"), "doctor", root],
        {
          encoding: "utf8",
          timeout: 30000,
        },
      );
      expect(result.error).toBeUndefined();
      return JSON.parse(result.stdout);
    };
    writeFileSync(path.join(root, "package.json"), JSON.stringify(manifest));
    expect(probe()).toMatchObject({
      selectedPackageManager: null,
      selectionSource: "ambiguous",
      ambiguousLockfiles: true,
      ok: false,
    });
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ ...manifest, packageManager: "npm@10.0.0" }),
    );
    const selected = probe();
    expect(selected).toMatchObject({
      selectedPackageManager: "npm",
      selectionSource: "package.json",
      ambiguousLockfiles: true,
    });
    expect(
      selected.checks.find((check) => check.name === "script:test").detail,
    ).toMatch(
      /^(?:statically admitted; tests not executed|npm:runner-missing)$/u,
    );
    for (const lock of locks)
      expect(readFileSync(path.join(root, lock), "utf8")).toBe("retained");
  });

  it("initializes and resets versioned storage using the real tarball's package version", () => {
    const script = `
      import assert from 'node:assert/strict';
      import { pathToFileURL } from 'node:url';
      import { mkdirSync, readFileSync } from 'node:fs';
      import path from 'node:path';
      import { DatabaseSync } from 'node:sqlite';
      const pkg = ${JSON.stringify(packedPackageDir)};
      const load = file => import(pathToFileURL(path.join(pkg, 'src', file)).href);
      const { acquirePackageState } = await load('package-state.ts');
      const { resolveStateRoot } = await load('state-root.ts');
      const { RunStore } = await load('run-store.ts');
      const consumerRoot = ${JSON.stringify(path.join(tempRoot, "packed-reset-consumer"))};
      mkdirSync(consumerRoot);
      const state = resolveStateRoot({consumerRoot, xdgStateHome: ${JSON.stringify(path.join(tempRoot, "packed-reset-state"))}});
      acquirePackageState(state, '0.0.0').close();
      const store = RunStore.open(state);
      store.startRun({stage:'abel-design', operationId:'seed', provisionalKey:'a'.repeat(64)});
      store.close();
      const owner = acquirePackageState(state);
      assert.equal(owner.notice.currentVersion, JSON.parse(readFileSync(path.join(pkg,'package.json'),'utf8')).version);
      assert.equal(owner.notice.reason, 'package-upgrade');
      assert.equal(owner.notice.oldRunsAbandoned, true);
      assert.equal(owner.notice.workspaceRestored, false);
      assert.match(owner.notice.warning, /Git diff/);
      const backup = new DatabaseSync(path.join(owner.notice.backupPath,'control.sqlite3'),{readOnly:true});
      assert.equal(backup.prepare('SELECT count(*) AS n FROM runs').get().n,1); backup.close();
      owner.close();
      const db = new DatabaseSync(state.databasePath,{readOnly:true});
      assert.equal(db.prepare('SELECT count(*) AS n FROM runs').get().n,0); db.close();
      const reopened = acquirePackageState(state); assert.equal(reopened.notice,undefined); reopened.close();
      console.log('packed-version-reset-ok');
    `;
    expect(
      exec(process.execPath, [
        "--experimental-strip-types",
        "--input-type=module",
        "-e",
        script,
      ]),
    ).toContain("packed-version-reset-ok");
  });

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

it("runs the shipped operator CLI from node_modules without TypeScript stripping", () => {
  const installed = path.join(
    tempRoot,
    "operator-install/node_modules/cadence",
  );
  cpSync(packedPackageDir, installed, { recursive: true });
  const consumer = path.join(tempRoot, "operator-consumer");
  mkdirSync(consumer);
  const result = spawnSync(
    process.execPath,
    [path.join(installed, "src/operator-cli.mjs"), "runs", consumer],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        XDG_STATE_HOME: path.join(tempRoot, "operator-state"),
      },
    },
  );
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    runs: [],
    truncated: false,
  });
});
