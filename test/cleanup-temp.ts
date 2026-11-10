/** Vitest globalSetup: every unit run owns one temp subtree and leaves none
 * of it behind.
 *
 * `vitest.config.ts` and `web/vitest.config.ts` point the workers' `TMPDIR`,
 * `TEMP` and `TMP` at `cadence-test-run-<pid>` under the caller's verification
 * temp root. This teardown removes that subtree when the run ends, reopening
 * sealed read-only ledgers first. The caller's root itself is never touched.
 */
import { chmodSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function runDir(): string {
  return join(tmpdir(), `cadence-test-run-${process.pid}`);
}

/** Sealed history ledgers are read-only; reopen the tree before removal. */
function makeWritable(path: string): void {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) makeWritable(child);
    else if (entry.isFile()) chmodSync(child, 0o600);
  }
  chmodSync(path, 0o700);
}

export default function cleanupTempRun() {
  const directory = runDir();
  return () => {
    try {
      makeWritable(directory);
      rmSync(directory, { recursive: true, force: true });
    } catch (error) {
      console.error(`temp cleanup kept ${directory}: ${error}`);
    }
  };
}
