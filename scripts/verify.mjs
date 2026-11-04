// The integration gate: every independent check at once, each reported with
// its time; any failure fails the gate. `--full` then runs the `slow`-tagged
// root tests and the browser scenarios, one lane at a time.
import { spawn } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { availableParallelism } from "node:os";
import path from "node:path";
import { assertVerificationTemp } from "./verification-temp.mjs";

const root = path.resolve(import.meta.dirname, "..");
assertVerificationTemp(root);
const full = process.argv.slice(2).includes("--full");
const windows = process.platform === "win32";
const node = process.execPath;
const bin = (name) =>
  path.join(root, "node_modules", ".bin", windows ? `${name}.cmd` : name);
// Incremental type checks keep their state per checkout under `.cache/tsc`.
const tsc = (state, ...args) => [
  bin("tsc"),
  ...args,
  "--incremental",
  "--tsBuildInfoFile",
  `.cache/tsc/${state}.tsbuildinfo`,
];
const vitest = (...args) => [bin("vitest"), "run", ...args];
const counts = /^\s*(Test Files|Tests)\s/;
// Files tagged `slow` as a whole are left out rather than imported and skipped.
const slowFiles = readdirSync(path.join(root, "test"), { recursive: true })
  .filter((name) => /\.test\.(ts|mjs)$/.test(name))
  .filter((name) =>
    readFileSync(path.join(root, "test", name), "utf8").startsWith(
      "// @module-tag slow\n",
    ),
  )
  .flatMap((name) => ["--exclude", `test/${name.split(path.sep).join("/")}`]);

/** Each stage runs its commands in order; stages run concurrently. */
const gate = [
  { name: "syntax", run: [[node, "scripts/check-syntax.mjs"]] },
  {
    name: "bundles",
    run: [
      ["bun", "scripts/build-operator.mjs", "--check"],
      ["bun", "scripts/build-service.mjs", "--check"],
    ],
  },
  { name: "types", run: [tsc("root", "--noEmit")] },
  {
    name: "web types",
    run: [
      tsc("web", "-p", "web/tsconfig.json"),
      tsc("web-config", "-p", "web/tsconfig.config.json"),
    ],
  },
  { name: "web build", run: [[node, "scripts/build-web.mjs", "--check"]] },
  {
    name: "lint",
    run: [
      [bin("biome"), "check", "."],
      [bin("rumdl"), "check", "."],
    ],
  },
  { name: "agents", run: [[node, "scripts/check-agents.mjs"]] },
  // Without the slow tests the unit files are short; two cores stay free for
  // the concurrent stages.
  {
    name: "unit",
    run: [
      vitest(
        "--tags-filter=!slow",
        `--maxWorkers=${Math.max(1, availableParallelism() - 2)}`,
        ...slowFiles,
      ),
    ],
    counts,
  },
  {
    name: "web unit",
    run: [vitest("--config", "web/vitest.config.ts")],
    counts,
  },
  { name: "pack", run: [[node, "scripts/pack-check.mjs"]] },
];
const release = [
  { name: "slow", run: [vitest("--tags-filter=slow")], counts },
  {
    name: "browser",
    run: [vitest("--config", "web/browser.config.ts")],
    counts,
  },
];

function command([file, ...args]) {
  return new Promise((resolve) => {
    let output = "";
    const child = spawn(file, args, {
      cwd: root,
      env: { ...process.env, FORCE_COLOR: "0" },
      shell: windows,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.on("error", (error) => resolve({ ok: false, output: `${error}` }));
    child.on("close", (code, signal) =>
      resolve({
        ok: code === 0,
        output:
          code === 0 ? output : `${output}\n(exit ${code ?? signal})`.trim(),
      }),
    );
  });
}

async function stage({ name, run, counts }) {
  const started = performance.now();
  let output = "";
  let ok = true;
  for (const step of run) {
    const result = await command(step);
    output += result.output;
    ok = result.ok;
    if (!ok) break;
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const lines = output.split("\n");
  if (ok) {
    const summary = counts ? lines.filter((line) => counts.test(line)) : [];
    console.log(`✓ ${name} ${seconds}s`);
    for (const line of summary) console.log(`    ${line.trim()}`);
  } else {
    console.log(`✗ ${name} ${seconds}s\n${output.trimEnd()}\n`);
  }
  return ok;
}

const started = performance.now();
let ok = (await Promise.all(gate.map(stage))).every(Boolean);
if (ok && full) for (const lane of release) ok = (await stage(lane)) && ok;
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(
  `${ok ? "verify passed" : "verify FAILED"}${full ? " (full)" : ""} in ${seconds}s`,
);
if (!full && ok)
  console.log(
    "Not run: slow-tagged root tests and browser scenarios (verify:full).",
  );
process.exit(ok ? 0 : 1);
