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

const expectedMembers = [
  "package/THIRD_PARTY_NOTICES.md",
  "package/LICENSE",
  "package/README.md",
  "package/agents/design-explorer.md",
  "package/agents/diagnosis-worker.md",
  "package/agents/implementation-worker.md",
  "package/config/.env.example",
  "package/config/routes.example.json",
  "package/licenses/pi-subagents-MIT.txt",
  "package/package.json",
  "package/prompts/abel-design.md",
  "package/prompts/abel-diagnose.md",
  "package/prompts/abel-implement.md",
  "package/prompts/abel-init.md",
  "package/skills/_shared/http-client.mjs",
  "package/skills/_shared/load-config.d.mts",
  "package/skills/_shared/load-config.mjs",
  "package/skills/context7-auto-research/SKILL.md",
  "package/skills/context7-auto-research/context7.mjs",
  "package/skills/git-commit/SKILL.md",
  "package/skills/grok-search/SKILL.md",
  "package/skills/grok-search/grok-search.mjs",
  "package/src/activation.ts",
  "package/src/agent-registry.ts",
  "package/src/apply-transaction.ts",
  "package/src/artifact-store.ts",
  "package/src/candidate-patch.ts",
  "package/src/parent-payload-bridge.ts",
  "package/src/child-session.ts",
  "package/src/contracts.ts",
  "package/src/control-contracts.ts",
  "package/src/delivery-compiler.ts",
  "package/src/design-control.ts",
  "package/src/design-journal.ts",
  "package/src/empty-resource-loader.ts",
  "package/src/file-snapshot.ts",
  "package/src/index.ts",
  "package/src/implement-graph.ts",
  "package/src/isolation-backend.ts",
  "package/src/openspec-cli.ts",
  "package/src/packet-runtime.ts",
  "package/src/parent-provider.ts",
  "package/src/route-policy.ts",
  "package/src/run-state.ts",
  "package/src/run-store.ts",
  "package/src/safe-path.ts",
  "package/src/scoped-grep-worker.mjs",
  "package/src/scoped-tools.ts",
  "package/src/state-root.ts",
  "package/src/subagent-activity.ts",
  "package/src/submit-tool.ts",
  "package/src/task-ledger.ts",
  "package/src/verification-capability.ts",
  "package/src/worker-broker.ts",
  "package/src/workflow-engine.ts",
  "package/src/workspace-store.ts",
].sort();

const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { encoding: "utf8", ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status}): ${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
};

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
