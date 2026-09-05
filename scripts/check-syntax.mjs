// Shell-free replacement for find | xargs; follows no directory symlinks.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
function check(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) check(file);
    else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      const result = spawnSync(process.execPath, ["--check", file], {
        stdio: "inherit",
        shell: false,
      });
      if (result.error || result.status !== 0) process.exit(1);
    }
  }
}
for (const directory of ["skills", "test", "scripts"]) {
  check(path.join(root, directory));
}
