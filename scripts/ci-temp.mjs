import { appendFileSync, mkdtempSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Fixtures need real ancestors, not macOS /var aliases or Windows 8.3 paths.
// Allocate only a new owned child; never scan/reset/clean historical temp trees.
const native = tmpdir();
const canonical = realpathSync.native(native);
if (!process.env.GITHUB_ENV || /[\r\n]/.test(canonical))
  throw new Error("CI temporary directory unavailable");
const directory = mkdtempSync(path.join(canonical, "cadence-ci-"));
appendFileSync(
  process.env.GITHUB_ENV,
  `TMPDIR=${directory}\nTEMP=${directory}\nTMP=${directory}\n`,
);
// Bounded path-only metadata, not an environment or fixture-content export.
const bounded = (value) => (value ? String(value).slice(0, 4096) : null);
console.log(
  JSON.stringify({
    native: bounded(native),
    canonical: bounded(canonical),
    owned: bounded(directory),
    runnerTemp: bounded(process.env.RUNNER_TEMP),
  }),
);
