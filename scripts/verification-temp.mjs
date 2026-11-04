import { spawnSync } from "node:child_process";
import { lstatSync, realpathSync, statfsSync, statSync } from "node:fs";
import { isAbsolute, relative, sep } from "node:path";

/** Verification creates non-Git projects and private-state fixtures. A temp
 * inside any worktree makes Git discover that parent instead of the fixture.
 * Validate the caller's choice; never redirect, create or clean their data. */
export function assertVerificationTemp(root, env = process.env) {
  const fail = () => {
    throw new Error(
      "verification-temp-required: set TMPDIR, TEMP and TMP to one fresh 0700 directory outside every Git working copy, on the checkout's disk filesystem (not tmpfs)",
    );
  };
  const path = env.TMPDIR;
  if (!path || env.TMP !== path || env.TEMP !== path) fail();
  let directory;
  try {
    const entry = lstatSync(path);
    directory = realpathSync(path);
    const disk = statfsSync(directory);
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      directory !== path ||
      (process.platform !== "win32" && (entry.mode & 0o777) !== 0o700) ||
      entry.dev !== statSync(root).dev ||
      disk.type === 0x01021994 // Linux tmpfs
    )
      fail();
  } catch {
    fail();
  }
  const inside = relative(realpathSync(root), directory);
  if (
    !inside ||
    (!isAbsolute(inside) && inside !== ".." && !inside.startsWith(`..${sep}`))
  )
    fail();
  const git = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: directory,
    encoding: "utf8",
    timeout: 5000,
    // Drop repository overrides so this observes the selected temp directory.
    env: {
      ...Object.fromEntries(
        Object.entries(env).filter(([key]) => !key.startsWith("GIT_")),
      ),
      LC_ALL: "C",
    },
  });
  if (
    git.error ||
    git.signal ||
    git.status !== 128 ||
    !git.stderr.includes("not a git repository")
  )
    fail();
}
