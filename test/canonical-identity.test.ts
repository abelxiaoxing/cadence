import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArtifactStore } from "../src/artifact-store.ts";
import { WorkspaceStore } from "../src/workspace-store.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
const digest = (...parts: string[]) => {
  const hash = createHash("sha256");
  for (const part of parts)
    hash.update(`${Buffer.byteLength(part)}:`).update(part);
  return hash.digest("hex");
};

it("uses the same canonical identity and reads the same workspace in different process locales", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-identity-"));
  roots.push(root);
  const consumer = path.join(root, "consumer");
  mkdirSync(consumer);
  for (const name of ["z.ts", "ä.ts"])
    writeFileSync(path.join(consumer, name), "export {};\n");
  execFileSync("git", ["init", "-q"], { cwd: consumer });
  execFileSync("git", ["add", "."], { cwd: consumer });
  const code = `
    import { ArtifactStore } from './src/artifact-store.ts';
    import { WorkspaceStore } from './src/workspace-store.ts';
    import { canonicalJson } from './src/canonical.ts';
    const root = ${JSON.stringify(root)};
    const store = new WorkspaceStore(root + '/workspaces', new ArtifactStore(root + '/artifacts'));
    const revision = store.captureBaseline({consumerRoot: root + '/consumer'});
    store.getRevision(revision.revisionId);
    console.log(JSON.stringify([canonicalJson({'ä': 1, z: 2}), revision.revisionId]));
  `;
  const outputs = ["en_US.UTF-8", "sv_SE.UTF-8", "tr_TR.UTF-8"].map((locale) =>
    execFileSync(
      process.execPath,
      ["--experimental-strip-types", "--input-type=module", "-e", code],
      {
        cwd: path.resolve(import.meta.dirname, ".."),
        env: { ...process.env, LANG: locale, LC_ALL: locale },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    ),
  );
  expect(new Set(outputs).size).toBe(1);
});

it("preserves old manifest identities and detects tampering without knowing the original locale", () => {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-legacy-identity-"));
  roots.push(root);
  const artifacts = new ArtifactStore(path.join(root, "artifacts"));
  const store = new WorkspaceStore(path.join(root, "workspaces"), artifacts);
  const artifact = artifacts.put(Buffer.from("old bytes"));
  const entries = Object.fromEntries(
    ["ä.ts", "z.ts"].map((name) => [
      name,
      { kind: "file", hash: artifact.hash, bytes: artifact.bytes, mode: 0o644 },
    ]),
  );
  const manifestHash = digest(
    "cadence-workspace-manifest",
    JSON.stringify(entries),
  );
  const revisionId = digest("cadence-workspace-revision", "", manifestHash);
  const target = path.join(
    root,
    "workspaces/revisions",
    revisionId.slice(0, 2),
    `${revisionId}.json`,
  );
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(
    target,
    JSON.stringify({
      revisionId,
      parentRevisionId: null,
      manifestHash,
      entries,
    }),
  );
  expect(store.getRevision(revisionId).revisionId).toBe(revisionId);
  const changed = JSON.parse(readFileSync(target, "utf8"));
  changed.entries["ä.ts"].mode = 0o755;
  writeFileSync(target, JSON.stringify(changed));
  expect(() => store.getRevision(revisionId)).toThrow(
    "workspace-revision-integrity-invalid",
  );
});

it("keeps historical proof-bound receipt ordering without weakening ordinary receipt parsing", async () => {
  const { canonicalJson } = await import("../src/canonical.ts");
  const { compileGateAReceipt, parseGateAReceipt } = await import(
    "../src/delivery-compiler.ts"
  );
  const compiled = compileGateAReceipt({
    change: "legacy-order",
    schema: "spec-driven",
    approval: {
      revision: 1,
      contractHash: "a".repeat(64),
      recordHash: "b".repeat(64),
    },
    artifacts: [
      { path: "specs/ä/spec.md", rawSha256: "c".repeat(64) },
      { path: "specs/z/spec.md", rawSha256: "d".repeat(64) },
    ],
  });
  const legacy = structuredClone(compiled.receipt);
  legacy.artifacts.reverse();
  const bytes = Buffer.from(`${canonicalJson(legacy)}\n`);
  expect(() => parseGateAReceipt(bytes)).toThrow("gate-a-receipt-invalid");
  expect(parseGateAReceipt(bytes, { allowLegacyOrder: true })).toEqual(legacy);
  legacy.artifacts[0].rawSha256 = "invalid";
  expect(() =>
    parseGateAReceipt(Buffer.from(`${canonicalJson(legacy)}\n`), {
      allowLegacyOrder: true,
    }),
  ).toThrow();
});

it("revalidates historical plan bytes without changing their approved identity, and invalidates preservation after mutation", async () => {
  const { verificationFixturePlan } = await import(
    "./helpers/verification-plan.ts"
  );
  const { canonicalJson } = await import("../src/canonical.ts");
  const { compileImplementPlan, parseImplementPlan } = await import(
    "../src/delivery-compiler.ts"
  );
  const root = mkdtempSync(path.join(tmpdir(), "cadence-legacy-plan-"));
  roots.push(root);
  mkdirSync(path.join(root, "test"));
  writeFileSync(path.join(root, "package.json"), '{"type":"module"}\n');
  writeFileSync(path.join(root, "value.txt"), "0\n");
  for (const file of [
    "test/regression.mjs",
    "test/health.mjs",
    "test/ä.mjs",
    "test/z.mjs",
  ])
    writeFileSync(path.join(root, file), "export {};\n");
  const { plan } = verificationFixturePlan("legacy-plan");
  for (const phase of Object.values(plan.tasks[0].phases))
    phase.read.push("test/ä.mjs", "test/z.mjs");
  const legacy = compileImplementPlan(plan, { consumerRoot: root }).plan;
  for (const phase of Object.values(legacy.tasks[0].phases))
    phase.read.sort((left, right) => left.localeCompare(right, "en-US"));
  const oldBytes = Buffer.from(`${canonicalJson(legacy)}\n`);
  expect(() => parseImplementPlan(oldBytes)).toThrow(
    "delivery-plan-not-canonical",
  );
  const parsed = parseImplementPlan(oldBytes, { allowLegacyOrder: true });
  const validated = compileImplementPlan(parsed, { consumerRoot: root });
  expect(Buffer.from(validated.bytes)).toEqual(oldBytes);
  parsed.tasks[0].objective = "A changed requirement";
  expect(
    Buffer.from(compileImplementPlan(parsed, { consumerRoot: root }).bytes),
  ).not.toEqual(oldBytes);
});
