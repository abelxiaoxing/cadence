/** Shared readonly model projection and validation. No session, owner or auth call. */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import {
  ContractError,
  decodeModelCandidate,
  decodeModelSelector,
  LIMITS,
  type ModelCandidate,
  type ModelSelection,
  type ModelSelector,
  modelApis,
  thinkingLevels,
} from "../service-contract.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import {
  environment,
  type LaunchEnvironment,
  type PiSnapshot,
  selectedEnvironment,
  sourceIdentity,
  stablePrivate,
} from "./model-config.ts";
export type CatalogModels = Pick<
  ModelRuntime,
  | "getError"
  | "getRegisteredNativeProvider"
  | "getRegisteredProviderConfig"
  | "getModels"
  | "getModel"
  | "getProvider"
>;
export type ModelThinking = (model: Model<Api>) => readonly string[];
export function publicModelIdentifier(
  value: string,
  literals: readonly string[],
): boolean {
  return (
    !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) &&
    diagnosticText(value, 512, literals) === value &&
    sanitizeText(value, literals) === value
  );
}
export function exactEnvironment(
  launch: LaunchEnvironment,
  selected: {
    selection: Pick<ModelSelection, "provider">;
    env: Record<string, string>;
  },
  snapshot: PiSnapshot,
): void {
  const scoped = snapshot.credentials[selected.selection.provider]?.env;
  const local = scoped === undefined ? {} : environment(scoped);
  // Auth configuration may resolve templates through process.env. Bind the
  // selected launch facts independently of getAuth overrides, without
  // mutating process.env. Empty/missing values never fall through to ambient.
  for (const [name, value] of Object.entries(selected.env)) {
    if (local[name]) continue;
    const d = Object.getOwnPropertyDescriptor(process.env, name);
    if (!d || !("value" in d) || d.value !== value || launch[name] !== value)
      throw new ContractError("stale");
  }
}
export function validateCatalogModel(
  runtime: CatalogModels,
  thinking: ModelThinking,
  input: ModelSelector,
  current: PiSnapshot,
  launch: LaunchEnvironment,
  literals: readonly string[],
) {
  if (!runtime || !thinking) throw new ContractError("unavailable");
  if (
    runtime.getError() ||
    runtime.getRegisteredNativeProvider(input.provider) ||
    runtime.getRegisteredProviderConfig(input.provider)
  )
    throw new ContractError("unsupported-context");
  const model = runtime.getModel(input.provider, input.model);
  if (
    !model ||
    model.api !== input.api ||
    model.provider !== input.provider ||
    model.id !== input.model ||
    !thinking(model).includes(input.thinking)
  )
    throw new ContractError("unsupported-context");
  if (
    !publicModelIdentifier(input.provider, literals) ||
    !publicModelIdentifier(input.model, literals)
  )
    throw new ContractError("unsupported-context");
  const credential = current.credentials[input.provider];
  const provider = runtime.getProvider(input.provider);
  if (
    credential?.type === "oauth"
      ? !provider?.auth.oauth
      : !provider?.auth.apiKey
  )
    throw new ContractError("unsupported-context");
  if (
    credential?.type === "api_key"
      ? !credential.key
      : !credential && !current.providers[input.provider]?.apiKey
  )
    throw new ContractError("auth-unavailable");
  const selected = {
    model,
    sourceIdentity: sourceIdentity(current, input.provider),
    credentialIdentity: stablePrivate(credential ?? null),
    env: selectedEnvironment(current, input.provider, input.model, launch),
  };
  // exactEnvironment only needs the provider, not an allocated source ID.
  exactEnvironment(launch, { ...selected, selection: input }, current);
  return selected;
}
export function projectModelCatalog(
  runtime: CatalogModels,
  supportedThinking: ModelThinking,
  current: PiSnapshot,
  literals: readonly string[],
  validate: (input: ModelSelector, current: PiSnapshot) => unknown,
): {
  status: "complete" | "capacity";
  entries: ModelCandidate[];
  withheld: number;
} {
  const providers = [
    ...new Set([
      ...Object.keys(current.credentials),
      ...Object.keys(current.providers),
    ]),
  ].sort();
  // Check counts before projecting/cloning any model list. No partial roster.
  let count = 0;
  for (const provider of providers) {
    if (
      runtime.getRegisteredNativeProvider(provider) ||
      runtime.getRegisteredProviderConfig(provider)
    )
      throw new ContractError("unsupported-context");
    count += runtime.getModels(provider).length;
    if (count > LIMITS.maxPageEntries)
      return { status: "capacity", entries: [], withheld: 0 };
  }
  const entries: ModelCandidate[] = [];
  let withheld = 0;
  for (const provider of providers) {
    const models = runtime.getModels(provider);
    if (entries.length + withheld + models.length > LIMITS.maxPageEntries)
      throw new ContractError("capacity");
    for (const model of models) {
      if (model.provider !== provider)
        throw new ContractError("unsupported-context");
      // An ID that would reveal a credential literal (an Ollama apiKey
      // "ollama" equal to its provider ID) withholds only that entry.
      if (
        !publicModelIdentifier(provider, literals) ||
        !publicModelIdentifier(model.id, literals)
      ) {
        withheld++;
        continue;
      }
      const api = modelApis.find((api) => api === model.api) ?? null;
      const levels = supportedThinking(model);
      if (levels.length > 7) throw new ContractError("unsupported-context");
      let eligibility: ModelCandidate["eligibility"] = "candidate";
      const thinking = levels.map((level) => ({
        level,
        selectable: api !== null && thinkingLevels.some((t) => t === level),
      }));
      const supported = thinking.find((t) => t.selectable);
      if (!api || !supported) eligibility = "unsupported";
      else {
        try {
          validate(
            decodeModelSelector({
              provider,
              model: model.id,
              api,
              thinking: supported.level,
            }),
            current,
          );
        } catch (error) {
          if (!(error instanceof ContractError)) throw error;
          if (error.code === "auth-unavailable")
            eligibility = "auth-unavailable";
          else if (error.code === "unsupported-context")
            eligibility = "unsupported";
          else throw error;
        }
      }
      entries.push(
        decodeModelCandidate({
          provider,
          model: model.id,
          api,
          thinking: thinking.map((t) => ({
            ...t,
            selectable: t.selectable && eligibility === "candidate",
          })),
          images: model.input.includes("image"),
          // A source may state none, or zero for an unknown window.
          ...(Number.isSafeInteger(model.contextWindow) &&
          model.contextWindow > 0
            ? { contextWindow: model.contextWindow }
            : {}),
          eligibility,
        }),
      );
    }
  }
  return { status: "complete", entries, withheld };
}
