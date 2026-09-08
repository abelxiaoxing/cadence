import { cp, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { executionProfile } from "../src/execution-profile.ts";
import { BubblewrapIsolationBackend } from "../src/isolation-backend.ts";
import { resolveVerificationRunner } from "../src/verification-capability.ts";
import { prepareVerificationEnvironment } from "../src/verification-environment.ts";

/** Independent product oracle; always checks a disposable copy, never the consumer. */
export async function verifyEvaluationOracle(consumer, scenarioId, signal) {
  const profile = executionProfile();
  const root = await mkdtemp(path.join(path.dirname(consumer), "oracle-"));
  let environment;
  try {
    signal?.throwIfAborted();
    await cp(path.join(consumer, "src"), path.join(root, "src"), {
      recursive: true,
      filter: () => {
        signal?.throwIfAborted();
        return true;
      },
    });
    const runner = resolveVerificationRunner("node");
    if (!runner) throw new Error("evaluation-oracle-unavailable");
    environment = await prepareVerificationEnvironment(
      root,
      consumer,
      [runner],
      signal,
    );
    const assertion =
      scenarioId === "multiple-tasks"
        ? "if(add(2,3)!==5||multiply(2,3)!==6)process.exit(1)"
        : "if(add(2,3)!==5)process.exit(1)";
    const result = await new BubblewrapIsolationBackend({
      timeoutMs: 5000,
      bwrapPath: profile.bwrapPath,
      localTrusted: profile.mode === "local-trusted",
    }).run({
      root,
      executable: environment.bindings[0].executablePath,
      args: [
        "--input-type=module",
        "-e",
        `import {add,multiply} from './src/math.mjs';${assertion}`,
      ],
      mounts: environment.mounts,
      environment: environment.environment,
      signal,
    });
    if (!result.ok || result.exitCode !== 0)
      throw new Error("evaluation-oracle-rejected");
  } finally {
    if (environment) await environment.cleanup();
    await rm(root, { recursive: true, force: true });
  }
}
