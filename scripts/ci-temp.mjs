import { appendFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";

// Fixtures need a real directory, not macOS /var aliases or Windows 8.3 paths.
// Production state-root checks still reject symlink components.
const directory = realpathSync.native(tmpdir());
if (!process.env.GITHUB_ENV || /[\r\n]/.test(directory))
  throw new Error("CI temporary directory unavailable");
appendFileSync(
  process.env.GITHUB_ENV,
  `TMPDIR=${directory}\nTEMP=${directory}\nTMP=${directory}\n`,
);
