import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import path from "node:path";
import {
  type StructuredVerificationContract,
  VERIFICATION_CONFIGURATION_PATHS,
} from "./contracts.ts";
import { executionProfile } from "./execution-profile.ts";
import {
  resolveVerificationRunner,
  type VerificationRunnerBinding,
  validateVerificationAdapterCapability,
  verificationRunnerFiles,
} from "./verification-capability.ts";
import type { prepareVerificationEnvironmentIo } from "./verification-environment-io.ts";
import type { WorkspaceIoMetrics } from "./workspace-io.ts";
import { runWorkspaceIo } from "./workspace-io.ts";

export async function captureVerificationEnvironmentIdentity(
  dependencyOwner: string,
  verifications: readonly StructuredVerificationContract[],
  signal?: AbortSignal,
): Promise<string> {
  const roots = [path.join(dependencyOwner, "node_modules")];
  const unavailable: string[] = [];
  const profile = executionProfile();
  if (profile.mode === "host-trusted")
    roots.push(
      path.resolve(profile.windowsHelperPath ?? ""),
      path.resolve(`${profile.windowsHelperPath}.json`),
    );
  else roots.push(path.resolve(profile.bwrapPath));
  if (
    profile.mode === "host-trusted" &&
    process.env.ComSpec &&
    path.isAbsolute(process.env.ComSpec)
  )
    roots.push(process.env.ComSpec);
  const node = resolveVerificationRunner("node");
  if (node) roots.push(realpathSync(node.executablePath));
  for (const verification of verifications) {
    // Identity describes installed tools; admission/execution separately owns config authorization.
    const capability = validateVerificationAdapterCapability(
      dependencyOwner,
      verification,
      { executionWritePaths: VERIFICATION_CONFIGURATION_PATHS },
    );
    if (!capability.ok) {
      if (
        ![
          "runner-missing",
          "local-executable-missing",
          "script-missing",
          "script-command-mismatch",
          "verification-config-mismatch",
        ].includes(capability.diagnostic.code)
      )
        throw new Error("verification-environment-unavailable");
      // Missing task capabilities are observable identities. The exact adapter
      // still rejects that task; independent tasks may use their own runners.
      unavailable.push(capability.diagnostic.code);
      continue;
    }
    roots.push(
      ...verificationRunnerFiles(
        dependencyOwner,
        verification,
        capability.runnerBindings,
      ),
    );
    for (const binding of capability.runnerBindings)
      if (binding.mountSource) roots.push(binding.mountSource);
  }
  const installed = await runWorkspaceIo<string>({
    root: dependencyOwner,
    artifactRoot: dependencyOwner,
    operation: "verificationIdentity",
    args: [roots],
    signal,
  });
  return createHash("sha256")
    .update(installed)
    .update(JSON.stringify(unavailable.sort()))
    .update(JSON.stringify(profile))
    .update(
      profile.mode === "host-trusted"
        ? JSON.stringify([
            process.platform,
            process.arch,
            process.versions.node,
            ["PATH", "SystemRoot", "WINDIR", "ComSpec", "PATHEXT"].map(
              (name) => [name, process.env[name] ?? null],
            ),
          ])
        : "",
    )
    .update(
      JSON.stringify(
        profile.inheritEnvironment.map((name) => [
          name,
          process.env[name] ?? null,
        ]),
      ),
    )
    .digest("hex");
}

/** All dependency traversal/copy/removal runs outside the host event loop. */
export async function prepareVerificationEnvironment(
  root: string,
  dependencyOwner: string,
  runnerBindings: readonly VerificationRunnerBinding[],
  signal?: AbortSignal,
  onMetrics?: (metrics: WorkspaceIoMetrics) => void,
) {
  signal?.throwIfAborted();
  const profile = executionProfile();
  const privateRoot = await mkdtemp(
    path.join(path.dirname(root), ".cadence-verification-"),
  );
  const cleanup = () =>
    runWorkspaceIo<void>({
      root,
      artifactRoot: root,
      operation: "cleanupVerification",
      args: [privateRoot],
    });
  try {
    const prepared = await runWorkspaceIo<
      ReturnType<typeof prepareVerificationEnvironmentIo>
    >({
      root,
      artifactRoot: root,
      operation: "prepareVerification",
      args: [
        root,
        dependencyOwner,
        runnerBindings,
        profile,
        Object.fromEntries(
          [
            "PATH",
            ...(profile.mode === "host-trusted"
              ? ["SystemRoot", "WINDIR", "ComSpec", "PATHEXT"]
              : []),
            ...profile.inheritEnvironment,
          ].flatMap((name) =>
            process.env[name] === undefined ? [] : [[name, process.env[name]]],
          ),
        ),
        privateRoot,
      ],
      signal,
      onMetrics,
    });
    return { ...prepared, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
