/** Resolve only server-selected Pi sources. Discovery creates no project state
 * and does not claim a stopped/live owner or add a whole-workbench Stop member. */
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { CadencePreferences } from "../cadence-preferences.ts";
import { ContractError, canonicalJson } from "../service-contract.ts";
import type { ProjectEntry } from "./contracts/gateway.ts";
import type { ModelPreview } from "./contracts/models.ts";
import { ServiceCoordination } from "./coordination.ts";
import {
  captureEnvironment,
  type LaunchEnvironment,
  type PiSnapshot,
  piSource,
  readPiSnapshot,
  sameModels,
} from "./model-config.ts";
import type { PreviewSource } from "./model-preview-process.ts";
import { readHostConfig } from "./runtime.ts";

const MAX_PREVIEW_CACHE = 16;
/** Bounded secret-free DTO cache keyed by cryptographic stamps of the exact
 * Pi sources, preferences, sanitized environment and redaction literals. */
export class GatewayModelPreviewCache {
  private readonly entries = new Map<string, ModelPreview>();
  get(key: string): ModelPreview | undefined {
    const hit = this.entries.get(key);
    return hit ? structuredClone(hit) : undefined;
  }
  set(key: string, value: ModelPreview): void {
    if (this.entries.has(key)) this.entries.delete(key);
    else if (this.entries.size >= MAX_PREVIEW_CACHE) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, structuredClone(value));
  }
  clear(): void {
    this.entries.clear();
  }
}
function preferenceStamp(agentDir: string): string {
  try {
    const file = new CadencePreferences(agentDir).snapshot();
    return file ? `${file.identity}:${file.stamp}` : "absent";
  } catch {
    return "unreadable";
  }
}
function previewCacheKey(input: {
  agentDir: string;
  snapshot: PiSnapshot;
  hostConfigStamp: string;
  prefStamp: string;
  environment: LaunchEnvironment;
  secrets: readonly string[];
}): string {
  const hash = createHash("sha256");
  hash.update(input.agentDir);
  hash.update("\0");
  hash.update(input.snapshot.auth.identity);
  hash.update("\0");
  hash.update(input.snapshot.auth.stamp);
  hash.update("\0");
  hash.update(input.snapshot.models?.identity ?? "");
  hash.update("\0");
  hash.update(input.snapshot.models?.stamp ?? "");
  hash.update("\0");
  hash.update(input.hostConfigStamp);
  hash.update("\0");
  hash.update(input.prefStamp);
  hash.update("\0");
  hash.update(JSON.stringify(input.environment));
  for (const secret of input.secrets) {
    hash.update("\0");
    hash.update(secret);
  }
  return hash.digest("hex");
}

export async function readGatewayModels(
  project: ProjectEntry | undefined,
  input: { stateHome: string; agentDir?: string },
  secrets: readonly string[],
  read: (source: PreviewSource) => Promise<ModelPreview>,
  cache?: GatewayModelPreviewCache,
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
  const hostConfigStamp = file ? `${file.identity}:${file.stamp}` : "absent";
  const prefBefore = cache ? preferenceStamp(source.directory) : "";
  const cacheKey = cache
    ? previewCacheKey({
        agentDir: source.directory,
        snapshot: before,
        hostConfigStamp,
        prefStamp: prefBefore,
        environment,
        secrets,
      })
    : undefined;
  if (cache && cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached) return cached;
  }
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
  if (cache && cacheKey && preferenceStamp(source.directory) === prefBefore)
    cache.set(cacheKey, catalog);
  return catalog;
}
