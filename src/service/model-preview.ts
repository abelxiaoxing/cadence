/** Readonly Pi model discovery. Loads only a model registry on demand: no
 * execution owner, AgentSession, tools, authentication resolution or disk writes.
 * The registry and its credential snapshot are discarded after projection. */
import type { CredentialStore } from "@earendil-works/pi-ai";
import { CadencePreferences } from "../cadence-preferences.ts";
import { ContractError } from "../service-contract.ts";
import {
  catalogOffers,
  decodeModelPreview,
  type ModelPreview,
} from "./contracts/models.ts";
import { projectModelCatalog, validateCatalogModel } from "./model-catalog.ts";
import {
  clonePrivate,
  type LaunchEnvironment,
  piSource,
  readPiSnapshot,
  sameModels,
  sdkRefusal,
  snapshotLiterals,
} from "./model-config.ts";

export async function readModelPreview(input: {
  agentDir?: string;
  home: string;
  cwd: string;
  environment: LaunchEnvironment;
  secrets?: readonly string[];
}): Promise<ModelPreview> {
  const source = piSource(
    input.agentDir,
    input.home,
    input.cwd,
    input.environment,
  );
  const before = readPiSnapshot(source);
  // A readonly snapshot store cannot refresh credentials or publish a login,
  // even if a future SDK accidentally tries to do so during construction.
  const credentials: CredentialStore = {
    async read(provider) {
      const value = before.credentials[provider];
      return value ? clonePrivate(value) : undefined;
    },
    async list() {
      return Object.entries(before.credentials).map(
        ([providerId, credential]) => ({ providerId, type: credential.type }),
      );
    },
    async modify() {
      throw new ContractError("forbidden");
    },
    async delete() {
      throw new ContractError("forbidden");
    },
  };
  const [
    { ModelRuntime },
    { InMemoryModelsStore, getSupportedThinkingLevels },
  ] = await Promise.all([
    import("@earendil-works/pi-coding-agent"),
    import("@earendil-works/pi-ai"),
  ]);
  const runtime = await ModelRuntime.create({
    credentials,
    modelsPath: source.modelsPath,
    modelsStore: new InMemoryModelsStore(),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const error = runtime.getError();
  if (error) throw sdkRefusal(error);
  const literals = snapshotLiterals(
    before,
    input.environment,
    input.secrets ?? [],
  );
  const catalog = projectModelCatalog(
    runtime,
    getSupportedThinkingLevels,
    before,
    literals,
    (selector, snapshot) =>
      validateCatalogModel(
        runtime,
        getSupportedThinkingLevels,
        selector,
        snapshot,
        input.environment,
        literals,
      ),
  );
  let remembered = null;
  try {
    const saved = new CadencePreferences(source.directory).read();
    if (saved && catalogOffers(catalog.entries, saved)) remembered = saved;
  } catch {
    /* A default is optional, never installed by discovery. */
  }
  const after = readPiSnapshot(source);
  if (
    !sameModels(before, after) ||
    before.auth.stamp !== after.auth.stamp ||
    before.auth.identity !== after.auth.identity
  )
    throw new ContractError("stale");
  return decodeModelPreview({ ...catalog, remembered });
}
