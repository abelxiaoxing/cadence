/** Owner-only Pi settings capture. Pi parses/merges and resolves model overrides;
 * workers receive a bounded inert snapshot, never a profile or a file writer.
 * SDK bindings arrive from the owner's existing explicit load, keeping passive
 * management/gateway imports SDK-free. */
import { lstatSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  defaultWorkerTools,
  resolveWorkerRuntime,
  type WorkerRuntime,
} from "../worker-model.mjs";
import { ContractError } from "./contracts/core.ts";
import { PrivateFiles } from "./private-files.ts";

type Pi = Pick<
  typeof import("@earendil-works/pi-coding-agent"),
  | "SettingsManager"
  | "ProjectTrustStore"
  | "createCodingTools"
  | "createReadOnlyTools"
  | "createPowerShellTool"
>;
/** Per configuration observation, not a session/work lifetime limit. */
const SETTINGS_FILE_BYTES = 1024 * 1024;
function observe(path: string) {
  let target: string;
  try {
    target = realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A broken link is not an absent optional source.
    try {
      lstatSync(path);
    } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code === "ENOENT")
        return undefined;
      throw missing;
    }
    throw new ContractError("corrupt-selected");
  }
  const file = new PrivateFiles(dirname(target), false).read(
    target,
    SETTINGS_FILE_BYTES,
  );
  if (!file) throw new ContractError("stale");
  return { target, ...file };
}
export function readWorkerRuntime(
  cwd: string,
  agentDir: string,
  model: { provider: string; id: string },
  pi: Pi,
): WorkerRuntime {
  try {
    const observed = new Map<string, ReturnType<typeof observe>>();
    const source = (path: string) => {
      const file = observe(path);
      observed.set(path, file);
      if (!file) return undefined;
      const body = new TextDecoder("utf-8", { fatal: true }).decode(file.bytes);
      // Pi treats an empty file as absent. At the service boundary a present,
      // half-written/non-object source must not silently become new defaults.
      // Pi still owns JSON parsing, migration, validation and merging.
      if (!body.trimStart().startsWith("{"))
        throw new ContractError("corrupt-selected");
      return body;
    };
    const global = source(join(agentDir, "settings.json"));
    const storage = (project?: string) => ({
      withLock(
        scope: "global" | "project",
        use: (value: string | undefined) => string | undefined,
      ) {
        if (use(scope === "global" ? global : project) !== undefined)
          throw new Error("Settings snapshot is readonly");
      },
    });
    const user = pi.SettingsManager.fromStorage(storage(), {
      projectTrusted: false,
    });
    if (user.drainErrors().length) throw new ContractError("corrupt-selected");
    const trust = source(join(agentDir, "trust.json"));
    // Pi's getter uses its own short lock. It never changes trust.json; absent
    // stores need no lock/directory creation. No terminal extension trust handler
    // or ephemeral --approve decision is borrowed by this service.
    const decision =
      trust === undefined ? null : new pi.ProjectTrustStore(agentDir).get(cwd);
    const projectTrusted =
      decision ?? user.getDefaultProjectTrust() === "always";
    const project = projectTrusted
      ? source(join(cwd, ".pi", "settings.json"))
      : undefined;
    const manager = pi.SettingsManager.fromStorage(storage(project), {
      projectTrusted,
    });
    const runtime = resolveWorkerRuntime(
      manager,
      model,
      defaultWorkerTools(pi, cwd),
    );
    for (const [path, before] of observed) {
      const after = observe(path);
      if (
        before?.target !== after?.target ||
        before?.identity !== after?.identity ||
        before?.stamp !== after?.stamp
      )
        throw new ContractError("stale");
    }
    return runtime;
  } catch (error) {
    // SDK parse/validation errors can contain source values. Never return them.
    throw new ContractError(
      error instanceof ContractError ? error.code : "unsupported-context",
    );
  }
}
