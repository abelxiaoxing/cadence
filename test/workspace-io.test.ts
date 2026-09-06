import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { ArtifactStore } from "../src/artifact-store.ts";
import type { WorkspaceIoMetrics } from "../src/workspace-io.ts";
import { WorkspaceStore } from "../src/workspace-store.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture(files = 1) {
  const root = mkdtempSync(path.join(tmpdir(), "cadence-io-"));
  roots.push(root);
  const consumer = path.join(root, "consumer");
  mkdirSync(consumer);
  for (let index = 0; index < files; index++)
    writeFileSync(path.join(consumer, `${index}.txt`), `file-${index}\n`);
  execFileSync("git", ["init", "-q"], { cwd: consumer });
  execFileSync("git", ["add", "."], { cwd: consumer });
  const metrics: WorkspaceIoMetrics[] = [];
  const artifacts = new ArtifactStore(path.join(root, "artifacts"));
  const store = new WorkspaceStore(path.join(root, "workspaces"), artifacts, {
    onMetrics: (event) => metrics.push(event),
  });
  return { root, consumer, artifacts, store, metrics };
}

it("keeps the parent heartbeat live during durable capture and materialization", async () => {
  const fixtureValue = fixture(250);
  let heartbeat = 0;
  const timer = setInterval(() => heartbeat++, 5);
  try {
    const baseline = await fixtureValue.store.captureBaselineAsync({
      consumerRoot: fixtureValue.consumer,
    });
    const afterCapture = heartbeat;
    expect(afterCapture).toBeGreaterThan(0);
    await fixtureValue.store.materializeAsync(
      baseline.revisionId,
      path.join(fixtureValue.root, "copy"),
    );
    expect(heartbeat).toBeGreaterThan(afterCapture);
    expect(
      fixtureValue.metrics.map(({ operation, files }) => ({
        operation,
        files,
      })),
    ).toEqual([
      { operation: "captureBaseline", files: 250 },
      { operation: "materialize", files: 250 },
    ]);
    expect(
      fixtureValue.metrics.every(
        ({ bytes, elapsedMs }) => bytes > 0 && elapsedMs > 0,
      ),
    ).toBe(true);
  } finally {
    clearInterval(timer);
  }
}, 15_000);

it("settles cancelled work before returning and can resume from the same store", async () => {
  const value = fixture(50);
  const controller = new AbortController();
  const result = value.store.captureBaselineAsync(
    { consumerRoot: value.consumer },
    controller.signal,
  );
  controller.abort(new Error("audit-cancelled"));
  await expect(result).rejects.toThrow("audit-cancelled");
  const baseline = await value.store.captureBaselineAsync({
    consumerRoot: value.consumer,
  });
  const target = path.join(value.root, "cancelled-copy");
  const cancelled = new AbortController();
  cancelled.abort(new Error("copy-cancelled"));
  await expect(
    value.store.materializeAsync(baseline.revisionId, target, cancelled.signal),
  ).rejects.toThrow("copy-cancelled");
  expect(() => statSync(target)).toThrow();
});

it("isolates copied inodes, verifies bytes at use, and retains inherited revision ownership", async () => {
  const value = fixture();
  const baseline = await value.store.captureBaselineAsync({
    consumerRoot: value.consumer,
  });
  const file = baseline.entries["0.txt"];
  if (file.kind !== "file") throw new Error("fixture");
  const count = value.artifacts.referenceCount(file.hash);
  const child = value.store.createRevision({
    parentRevisionId: baseline.revisionId,
    changes: { "new.txt": Buffer.from("new\n") },
  });
  expect(value.artifacts.referenceCount(file.hash)).toBe(count);
  const target = path.join(value.root, "copy");
  await value.store.materializeAsync(child.revisionId, target);
  writeFileSync(path.join(target, "0.txt"), "consumer edit\n");
  expect(Buffer.from(value.artifacts.read(file.hash)).toString()).toBe(
    "file-0\n",
  );
  expect(readFileSync(path.join(value.consumer, "0.txt"), "utf8")).toBe(
    "file-0\n",
  );
  const blob = path.join(
    value.artifacts.root,
    "blobs",
    file.hash.slice(0, 2),
    file.hash,
  );
  writeFileSync(blob, "corrupted\n");
  await expect(
    value.store.materializeAsync(
      child.revisionId,
      path.join(value.root, "bad-copy"),
    ),
  ).rejects.toThrow("artifact-integrity-invalid");
});

it("bounds Git enumeration and cancels an active Git child", async () => {
  const value = fixture();
  const bin = path.join(value.root, "bin");
  mkdirSync(bin);
  writeFileSync(
    path.join(bin, "git"),
    "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n",
    { mode: 0o755 },
  );
  const previous = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${previous ?? ""}`;
  try {
    await expect(
      value.store.captureBaselineWithGit({
        consumerRoot: value.consumer,
        gitTimeoutMs: 50,
      }),
    ).rejects.toThrow("workspace-git-baseline-unavailable");
    const controller = new AbortController();
    const pending = value.store.captureBaselineAsync(
      { consumerRoot: value.consumer },
      controller.signal,
    );
    const timer = setTimeout(
      () => controller.abort(new Error("git-cancelled")),
      200,
    );
    try {
      await expect(pending).rejects.toThrow("git-cancelled");
    } finally {
      clearTimeout(timer);
    }
  } finally {
    if (previous === undefined) delete process.env.PATH;
    else process.env.PATH = previous;
  }
});
