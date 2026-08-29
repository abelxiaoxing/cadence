import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const RED_IDENTITY = "[CADENCE-V2:T3-workspace-revisions]";
const roots: string[] = [];
type ModuleRecord = Record<string, unknown>;

let artifactModule: ModuleRecord | null = null;
let workspaceModule: ModuleRecord | null = null;
let isolationModule: ModuleRecord | null = null;

beforeAll(async () => {
  [artifactModule, workspaceModule, isolationModule] = await Promise.all(
    [
      "../src/artifact-store.ts",
      "../src/workspace-store.ts",
      "../src/isolation-backend.ts",
    ].map(async (specifier) => {
      try {
        return (await import(specifier)) as ModuleRecord;
      } catch {
        return null;
      }
    }),
  );
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function temporaryRoot(label: string): string {
  const root = mkdtempSync(path.join(tmpdir(), `cadence-workspace-${label}-`));
  roots.push(root);
  return root;
}

function requiredClass<T>(module: ModuleRecord | null, name: string): T {
  expect(module, `${RED_IDENTITY}: ${name} module must exist`).not.toBeNull();
  expect(
    module?.[name],
    `${RED_IDENTITY}: ${name} must be exported`,
  ).toBeTypeOf("function");
  return module?.[name] as T;
}

function stores(label: string) {
  const ArtifactStore = requiredClass<
    new (
      root: string,
    ) => {
      put(bytes: Uint8Array): Record<string, unknown>;
      read(hash: string): Uint8Array;
      retain(hash: string): number;
      release(hash: string): number;
      referenceCount(hash: string): number;
    }
  >(artifactModule, "ArtifactStore");
  const WorkspaceStore = requiredClass<
    new (
      root: string,
      artifacts: InstanceType<typeof ArtifactStore>,
    ) => {
      captureBaseline(input: Record<string, unknown>): Record<string, unknown>;
      getRevision(id: string): Record<string, unknown>;
      createRevision(input: Record<string, unknown>): Record<string, unknown>;
      mergeRevision(input: Record<string, unknown>): Record<string, unknown>;
      materialize(revisionId: string, destination: string): void;
    }
  >(workspaceModule, "WorkspaceStore");
  const privateRoot = temporaryRoot(label);
  const artifacts = new ArtifactStore(path.join(privateRoot, "artifacts"));
  return {
    artifacts,
    workspaces: new WorkspaceStore(
      path.join(privateRoot, "workspaces"),
      artifacts,
    ),
  };
}

function gitWorkspace(): string {
  const root = temporaryRoot("consumer");
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeFileSync(path.join(root, "tracked.txt"), "committed\n");
  execFileSync("git", ["add", "tracked.txt"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Cadence",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "-qm",
      "baseline",
    ],
    { cwd: root },
  );
  writeFileSync(path.join(root, "tracked.txt"), "dirty working bytes\n");
  writeFileSync(path.join(root, "approved.txt"), "approved untracked\n");
  writeFileSync(path.join(root, "ignored-secret.txt"), "must not capture\n");
  mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
  writeFileSync(
    path.join(root, "node_modules", "pkg", "index.js"),
    "dependency\n",
  );
  return root;
}

describe("content-addressed artifact store", () => {
  it("deduplicates exact bytes, verifies integrity, and tracks references", () => {
    const { artifacts } = stores("artifacts");
    const first = artifacts.put(Buffer.from("same bytes"));
    const second = artifacts.put(Buffer.from("same bytes"));
    expect(second).toEqual(first);
    expect(first).toMatchObject({
      hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
      bytes: 10,
    });
    expect(Buffer.from(artifacts.read(String(first.hash))).toString()).toBe(
      "same bytes",
    );
    expect(artifacts.retain(String(first.hash))).toBe(1);
    expect(artifacts.retain(String(first.hash))).toBe(2);
    expect(artifacts.release(String(first.hash))).toBe(1);
    expect(artifacts.referenceCount(String(first.hash))).toBe(1);
  });
});

describe("immutable workspace manifests", () => {
  it("captures dirty tracked bytes plus only approved untracked and absent facts", () => {
    const consumerRoot = gitWorkspace();
    const { workspaces } = stores("capture");
    const baseline = workspaces.captureBaseline({
      consumerRoot,
      approvedUntracked: ["approved.txt"],
      absent: ["future/output.ts"],
    });
    const revision = workspaces.getRevision(String(baseline.revisionId));
    expect(revision.entries).toMatchObject({
      "tracked.txt": { kind: "file", bytes: 20 },
      "approved.txt": { kind: "file", bytes: 19 },
      "future/output.ts": { kind: "absent" },
    });
    expect(revision.entries).not.toHaveProperty("ignored-secret.txt");
    expect(revision.entries).not.toHaveProperty("node_modules/pkg/index.js");

    const destination = temporaryRoot("materialized");
    workspaces.materialize(String(baseline.revisionId), destination);
    expect(readFileSync(path.join(destination, "tracked.txt"), "utf8")).toBe(
      "dirty working bytes\n",
    );
    expect(readFileSync(path.join(destination, "approved.txt"), "utf8")).toBe(
      "approved untracked\n",
    );
  });

  it("round-trips manifests and rejects a symlinked approved path", () => {
    const consumerRoot = gitWorkspace();
    const outside = temporaryRoot("outside");
    writeFileSync(path.join(outside, "value.txt"), "outside\n");
    symlinkSync(
      path.join(outside, "value.txt"),
      path.join(consumerRoot, "linked.txt"),
    );
    const { workspaces } = stores("roundtrip");
    expect(() =>
      workspaces.captureBaseline({
        consumerRoot,
        approvedUntracked: ["linked.txt"],
      }),
    ).toThrow(/unsafe-workspace-path/u);
  });

  it("materializes deterministic directory-to-file and file-to-directory revisions", () => {
    const consumerRoot = temporaryRoot("shape-transitions");
    mkdirSync(path.join(consumerRoot, "directory"));
    writeFileSync(path.join(consumerRoot, "directory/leaf.txt"), "leaf\n");
    writeFileSync(path.join(consumerRoot, "file"), "file\n");
    execFileSync("git", ["init", "-q"], { cwd: consumerRoot });
    execFileSync("git", ["add", "."], { cwd: consumerRoot });
    const { workspaces } = stores("shape-transitions");
    const baseline = workspaces.captureBaseline({ consumerRoot });

    const transitioned = workspaces.createRevision({
      parentRevisionId: baseline.revisionId,
      changes: {
        directory: Buffer.from("replacement file\n"),
        "directory/leaf.txt": { kind: "absent" },
        file: { kind: "absent" },
        "file/leaf.txt": Buffer.from("replacement leaf\n"),
      },
    });
    const destination = temporaryRoot("shape-transition-output");
    workspaces.materialize(String(transitioned.revisionId), destination);

    expect(readFileSync(path.join(destination, "directory"), "utf8")).toBe(
      "replacement file\n",
    );
    expect(readFileSync(path.join(destination, "file/leaf.txt"), "utf8")).toBe(
      "replacement leaf\n",
    );
    expect(workspaces.getRevision(String(transitioned.revisionId))).toEqual(
      transitioned,
    );
  });
});

describe("MVCC revision merge", () => {
  it("commutes disjoint changes and rejects overlapping stale work", () => {
    const consumerRoot = gitWorkspace();
    writeFileSync(path.join(consumerRoot, "a.txt"), "a0\n");
    writeFileSync(path.join(consumerRoot, "b.txt"), "b0\n");
    execFileSync("git", ["add", "a.txt", "b.txt"], { cwd: consumerRoot });
    const { workspaces } = stores("merge");
    const base = workspaces.captureBaseline({ consumerRoot });
    const left = workspaces.createRevision({
      parentRevisionId: base.revisionId,
      changes: { "a.txt": Buffer.from("a1\n") },
    });
    const right = workspaces.createRevision({
      parentRevisionId: base.revisionId,
      changes: { "b.txt": Buffer.from("b1\n") },
    });
    const leftThenRight = workspaces.mergeRevision({
      baseRevisionId: base.revisionId,
      currentRevisionId: left.revisionId,
      candidateRevisionId: right.revisionId,
      boundPaths: ["b.txt"],
    });
    const rightThenLeft = workspaces.mergeRevision({
      baseRevisionId: base.revisionId,
      currentRevisionId: right.revisionId,
      candidateRevisionId: left.revisionId,
      boundPaths: ["a.txt"],
    });
    expect(leftThenRight.manifestHash).toBe(rightThenLeft.manifestHash);

    const overlap = workspaces.createRevision({
      parentRevisionId: base.revisionId,
      changes: { "a.txt": Buffer.from("different\n") },
    });
    expect(() =>
      workspaces.mergeRevision({
        baseRevisionId: base.revisionId,
        currentRevisionId: left.revisionId,
        candidateRevisionId: overlap.revisionId,
        boundPaths: ["a.txt"],
      }),
    ).toThrow(/workspace-revision-stale/u);
  });
});

describe("isolation capability closure", () => {
  it("pauses when Bubblewrap is unavailable and never invokes an unsafe fallback", async () => {
    const backendClass = requiredClass<
      new (
        options?: Record<string, unknown>,
      ) => {
        run(input: Record<string, unknown>): Promise<Record<string, unknown>>;
      }
    >(isolationModule, "BubblewrapIsolationBackend");
    let executed = false;
    const backend = new backendClass({ probe: () => false });
    await expect(
      backend.run({
        root: temporaryRoot("sandbox"),
        executable: "node",
        args: ["--version"],
        unsafeFallback: () => {
          executed = true;
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      state: "paused",
      code: "isolation-backend-unavailable",
    });
    expect(executed).toBe(false);
  });
});
