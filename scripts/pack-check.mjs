// Build and audit the real exact regular tarball, every body and Agent pin.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { auditPackage } from "./package-audit.mjs";

const packageDir = path.resolve(import.meta.dirname, "..");

const expectedMembers = JSON.parse(
  readFileSync(
    path.join(packageDir, "provenance/package-members.json"),
    "utf8",
  ),
);

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
};

run("bun", ["scripts/build-operator.mjs", "--check"], { cwd: packageDir });

const tempRoot = mkdtempSync(path.join(tmpdir(), "abel-pack-check-"));
try {
  const packDir = path.join(tempRoot, "pack");
  mkdirSync(packDir);
  run("bun", ["pm", "pack", "--destination", packDir], { cwd: packageDir });
  const archives = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("expected exactly one tarball");
  const audit = auditPackage(
    path.join(packDir, archives[0]),
    packageDir,
    expectedMembers,
  );
  console.log(
    `pack-check: ${audit.members.length} unique regular members and every body/pin match the approved set`,
  );
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
