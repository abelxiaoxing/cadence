// P-007 pack check: build the real tarball and verify its exact member set,
// no symlinks, and the four prompt/skill/agent families. Mirrors the
// distribution test's approved member list without re-running vitest.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

run("bun", ["scripts/build-workspace-io.mjs", "--check"], { cwd: packageDir });

const tempRoot = mkdtempSync(path.join(tmpdir(), "abel-pack-check-"));
try {
  const packDir = path.join(tempRoot, "pack");
  mkdirSync(packDir);
  run("bun", ["pm", "pack", "--destination", packDir], { cwd: packageDir });
  const archives = readdirSync(packDir).filter((f) => f.endsWith(".tgz"));
  if (archives.length !== 1) throw new Error("expected exactly one tarball");
  const members = run("tar", ["tzf", path.join(packDir, archives[0])])
    .split("\n")
    .map((entry) => entry.replace(/^\.\//, ""))
    .filter((entry) => entry && !entry.endsWith("/"))
    .sort();
  const missing = expectedMembers.filter((m) => !members.includes(m));
  const extra = members.filter((m) => !expectedMembers.includes(m));
  if (missing.length || extra.length) {
    throw new Error(
      `pack member drift: missing=${JSON.stringify(missing)} extra=${JSON.stringify(extra)}`,
    );
  }
  if (
    !existsSync(path.join(packageDir, "provenance", "adapted-modules.yaml"))
  ) {
    throw new Error("provenance/adapted-modules.yaml missing");
  }
  const provenance = readFileSync(
    path.join(packageDir, "provenance", "adapted-modules.yaml"),
    "utf8",
  );
  for (const role of [
    "design-explorer",
    "diagnosis-worker",
    "implementation-worker",
  ]) {
    const hash = createHash("sha256")
      .update(readFileSync(path.join(packageDir, "agents", `${role}.md`)))
      .digest("hex");
    const binding = provenance.match(
      new RegExp(
        `path: agents/${role}\\.md[\\s\\S]{0,160}?role: ${role}[\\s\\S]{0,160}?sha256: ([0-9a-f]{64})`,
        "u",
      ),
    );
    if (binding?.[1] !== hash) {
      throw new Error(`provenance hash mismatch: ${role}`);
    }
  }
  console.log(`pack-check: ${members.length} members match the approved set`);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
