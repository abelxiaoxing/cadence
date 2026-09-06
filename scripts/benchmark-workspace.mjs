// Run with Node >=22.13: node --experimental-strip-types scripts/benchmark-workspace.mjs [files].
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { ArtifactStore } from "../src/artifact-store.ts";
import { WorkspaceStore } from "../src/workspace-store.ts";

const files = Number(process.argv[2] ?? 1000);
if (!Number.isSafeInteger(files) || files < 1 || files > 100_000)
  throw new Error("files must be between 1 and 100000");
const root = mkdtempSync(path.join(tmpdir(), "cadence-workspace-benchmark-"));
const lag = monitorEventLoopDelay({ resolution: 10 });
try {
  const consumer = path.join(root, "consumer");
  mkdirSync(consumer);
  for (let index = 0; index < files; index++)
    writeFileSync(
      path.join(consumer, `${index}.txt`),
      `${index}\n${"x".repeat(4096)}`,
    );
  execFileSync("git", ["init", "-q"], { cwd: consumer });
  execFileSync("git", ["add", "."], { cwd: consumer });
  const metrics = [];
  const store = new WorkspaceStore(
    path.join(root, "workspaces"),
    new ArtifactStore(path.join(root, "artifacts")),
    { onMetrics: (value) => metrics.push(value) },
  );
  lag.enable();
  const baseline = await store.captureBaselineAsync({ consumerRoot: consumer });
  await store.materializeAsync(baseline.revisionId, path.join(root, "copy"));
  lag.disable();
  console.log(
    JSON.stringify(
      {
        files,
        metrics,
        parentEventLoopDelayMs: {
          p99: lag.percentile(99) / 1e6,
          max: lag.max / 1e6,
        },
      },
      null,
      2,
    ),
  );
} finally {
  lag.disable();
  rmSync(root, { recursive: true, force: true });
}
