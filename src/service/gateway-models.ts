/** Resolve only server-selected Pi sources. Discovery creates no project state
 * and does not claim a stopped/live owner or add a whole-workbench Stop member. */
import { homedir } from "node:os";
import { ContractError, canonicalJson } from "../service-contract.ts";
import type { ProjectEntry } from "./contracts/gateway.ts";
import type { ModelPreview } from "./contracts/models.ts";
import { ServiceCoordination } from "./coordination.ts";
import {
  captureEnvironment,
  piSource,
  readPiSnapshot,
  sameModels,
} from "./model-config.ts";
import type { PreviewSource } from "./model-preview-process.ts";
import { readHostConfig } from "./runtime.ts";

export async function readGatewayModels(
  project: ProjectEntry | undefined,
  input: { stateHome: string; agentDir?: string },
  secrets: readonly string[],
  read: (source: PreviewSource) => Promise<ModelPreview>,
) {
  const c = project
    ? new ServiceCoordination(project.path, input.stateHome)
    : undefined;
  if (c && c.store.root !== project?.path) throw new ContractError("stale");
  const file = c?.files.read(c.path("host-config.json"));
  const config = c ? readHostConfig(c) : undefined;
  if (file && !config) throw new ContractError("corrupt-selected");
  const agentDir = config?.agentDir ?? input.agentDir;
  if (!agentDir) throw new ContractError("unavailable");
  const home = homedir(),
    cwd = project?.path ?? home,
    environment = captureEnvironment(process.env);
  const source = piSource(agentDir, home, cwd, environment);
  const before = readPiSnapshot(source);
  const catalog = await read({
    agentDir: source.directory,
    home,
    cwd,
    environment,
    secrets: [...secrets],
  });
  const after = readPiSnapshot(source);
  if (
    !sameModels(before, after) ||
    before.auth.identity !== after.auth.identity ||
    before.auth.stamp !== after.auth.stamp
  )
    throw new ContractError("stale");
  if (c) {
    c.files.assert(c.path("host-config.json"), file);
    if (
      canonicalJson(readHostConfig(c) ?? null) !== canonicalJson(config ?? null)
    )
      throw new ContractError("stale");
  }
  return catalog;
}
