// Keep TypeScript incremental build info out of checkouts and worktrees so
// type checking never leaves ignored `.cache/tsc` residue behind.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertVerificationTemp } from "./verification-temp.mjs";

const root = path.resolve(import.meta.dirname, "..");

export function tscArgs(checkoutRoot, state, args, env = process.env) {
  try {
    assertVerificationTemp(checkoutRoot, env);
  } catch {
    return [...args];
  }
  const cacheDir = path.join(env.TMPDIR, "tsc");
  mkdirSync(cacheDir, { recursive: true });
  return [
    ...args,
    "--incremental",
    "--tsBuildInfoFile",
    path.join(cacheDir, `${state}.tsbuildinfo`),
  ];
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [state, ...args] = process.argv.slice(2);
  if (!state) {
    console.error("Usage: node scripts/tsc-check.mjs <state> [tsc-args...]");
    process.exit(1);
  }
  const windows = process.platform === "win32";
  const tsc = path.join(
    root,
    "node_modules",
    ".bin",
    windows ? "tsc.cmd" : "tsc",
  );
  const result = spawnSync(tsc, tscArgs(root, state, args), {
    cwd: root,
    stdio: "inherit",
    shell: windows,
  });
  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.signal) process.kill(process.pid, result.signal);
  process.exit(result.status ?? 1);
}
