import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { coalesceVerificationScans } from "../src/verification-scan.ts";
import { runWorkspaceIo } from "../src/workspace-io.ts";

const count = Number(process.argv[2] ?? 10000);
if (!Number.isSafeInteger(count) || count < 1 || count > 100000)
  throw new Error("files must be 1..100000");
const root = mkdtempSync(path.join(tmpdir(), "cadence-dependency-benchmark-"));
try {
  const dependencies = path.join(root, "node_modules");
  mkdirSync(dependencies);
  for (let i = 0; i < count; i++)
    writeFileSync(path.join(dependencies, `${i}.js`), "x".repeat(4096));
  let scans = 0;
  const scan = coalesceVerificationScans(async (_plan, signal) => {
    scans++;
    return runWorkspaceIo({
      root,
      artifactRoot: root,
      operation: "verificationIdentity",
      args: [[dependencies]],
      signal,
    });
  });
  const timings = [];
  for (const phase of ["cold", "warm"]) {
    const start = performance.now();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => scan({}, new AbortController().signal)),
    );
    if (new Set(results).size !== 1) throw new Error("identity mismatch");
    timings.push({ phase, elapsedMs: performance.now() - start });
  }
  console.log(
    JSON.stringify(
      { files: count, bytes: count * 4096, scans, callers: 8, timings },
      null,
      2,
    ),
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}
