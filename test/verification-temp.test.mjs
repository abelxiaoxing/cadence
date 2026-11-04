import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { assertVerificationTemp } from "../scripts/verification-temp.mjs";

const homes = [];
const checkout = resolve(fileURLToPath(new URL("..", import.meta.url)));
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true });
});
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "verify-temp-"));
  homes.push(home);
  const root = join(home, "project");
  const temp = join(home, "temporary");
  for (const dir of [root, temp]) mkdirSync(dir, { mode: 0o700 });
  execFileSync("git", ["init", "-q", root]);
  const env = (path) => ({
    ...process.env,
    TMPDIR: path,
    TMP: path,
    TEMP: path,
  });
  return { root, temp, home, env };
}
it("accepts a private same-disk temp outside Git, ignoring repository overrides", () => {
  const { root, temp, env } = fixture();
  expect(() =>
    assertVerificationTemp(root, {
      ...env(temp),
      GIT_DIR: join(root, ".git"),
      GIT_WORK_TREE: root,
    }),
  ).not.toThrow();
});
it("refuses checkout-local temp and another worktree instead of inheriting either repository", () => {
  const { root, temp, home, env } = fixture();
  const nested = join(root, ".cache");
  mkdirSync(nested, { mode: 0o700 });
  for (const path of [root, nested])
    expect(() => assertVerificationTemp(root, env(path))).toThrow(
      "verification-temp-required",
    );
  execFileSync("git", ["init", "-q", home]);
  expect(() => assertVerificationTemp(root, env(temp))).toThrow(
    "outside every Git working copy",
  );
});
it("refuses missing, inconsistent and nonexistent explicit temp without creating it", () => {
  const { root, temp, env } = fixture();
  for (const values of [
    { ...env(temp), TMPDIR: undefined },
    { ...env(temp), TMP: undefined },
    { ...env(temp), TEMP: root },
    env(join(temp, "absent")),
  ])
    expect(() => assertVerificationTemp(root, values)).toThrow(
      "verification-temp-required",
    );
});
it.skipIf(process.platform === "win32")(
  "refuses shared permissions and symlinked temp",
  () => {
    const { root, temp, home, env } = fixture();
    chmodSync(temp, 0o755);
    expect(() => assertVerificationTemp(root, env(temp))).toThrow();
    chmodSync(temp, 0o700);
    const alias = join(home, "alias");
    symlinkSync(temp, alias);
    expect(() => assertVerificationTemp(root, env(alias))).toThrow();
  },
);
it("verify refuses checkout-local temp before launching any stages", () => {
  const { root, env } = fixture();
  // The actual checkout is always invalid as a temp root, regardless of mode.
  const result = spawnSync(process.execPath, ["scripts/verify.mjs"], {
    cwd: checkout,
    env: { ...env(checkout), GIT_WORK_TREE: root },
    encoding: "utf8",
    timeout: 5000,
  });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain("verification-temp-required");
  expect(result.stdout).toBe("");
});
it.each(["--full", "--browser", "--unknown"])(
  "verify rejects %s before preflight or launching any stages",
  (option) => {
    const result = spawnSync(process.execPath, ["scripts/verify.mjs", option], {
      cwd: checkout,
      env: { ...process.env, TMPDIR: checkout, TMP: checkout, TEMP: checkout },
      encoding: "utf8",
      timeout: 5000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toBe("Usage: bun run verify (no options)\n");
    expect(result.stdout).toBe("");
  },
);
