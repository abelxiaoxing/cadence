import { randomUUID } from "node:crypto";
import type { Api, AuthResult, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { networkKeys } from "../sdk-network.ts";
import {
  assertWorkerEnvelopeSize,
  ContractError,
  decodeCommittedBatch,
  decodeId,
  decodeModelCandidate,
  decodeModelSelection,
  decodeModelSelector,
  decodeWorkerPublicRequest,
  LIMITS,
  type ModelCandidate,
  type ModelSelection,
  type ModelSelector,
  modelApis,
  type PublicError,
  publicError,
  thinkingLevels,
  type WorkerPublicRequest,
} from "../service-contract.ts";
import { diagnosticText } from "../verification-diagnostics.ts";
import { sanitizeText } from "../worker-redaction.mjs";
import type { AuthNetwork } from "./auth-network.ts";
import {
  captureEnvironment,
  clonePrivate,
  data,
  environment,
  type LaunchEnvironment,
  type PiSnapshot,
  type PiSource,
  piSource,
  readPiSnapshot,
  sameModels,
  selectedEnvironment,
  sourceIdentity,
  stablePrivate,
  templateNames,
} from "./model-config.ts";
import type { ServiceOwner } from "./owner.ts";
import type { AuthAccountingPort, PersistenceResult } from "./ports.ts";

export interface ModelContextOptions {
  /** Explicit service-launch inputs, never browser or per-request overrides. */
  agentDir?: string;
  home: string;
  cwd: string;
  environment: LaunchEnvironment;
  owner: ServiceOwner;
  accounting: AuthAccountingPort;
  /** Real host-owned process route; absent adapters retain DIRECT-only refusal. */
  network?: AuthNetwork;
  /** May shorten reporting only, never the lifetime of a started SDK operation. */
  waitMs?: number;
}
interface Selected {
  selection: ModelSelection;
  model: Model<Api>;
  sourceIdentity: string;
  credentialIdentity: string;
  env: Record<string, string>;
}
/** Server-only material. It must never be passed to a history/client/logging port. */
export interface ServerModelEnvelope {
  request: WorkerPublicRequest;
  cwd: string;
  model: Model<Api>;
  auth: {
    ok: true;
    apiKey?: string;
    headers?: Record<string, string | null>;
    baseUrl?: string;
    env?: Record<string, string>;
  };
}
/** Not a PreparedWorkerPort and not a launcher. W2 must supply its real encoder
 * and native spawn in one synchronous consumption, checking the ACTUAL string.
 * No accepting worker/fallback is wired by this module. JSON emits no secrets. */
export interface PreparedModelContext {
  consume<T>(
    encode: (material: ServerModelEnvelope) => string,
    use: (serialized: string) => T,
  ): T;
}
export interface ModelPreparationInput {
  request: WorkerPublicRequest;
  operationId: string;
  epoch: string;
  timeoutMs: number;
  signal: AbortSignal;
  current: () => boolean;
}
export interface TrackedModelPreparation {
  result: Promise<ModelPreparation>;
  /** This preparation's original SDK AND accounting completion; no auth material. */
  settled: Promise<void>;
}
export type ModelPreparation =
  | { status: "prepared"; prepared: PreparedModelContext }
  | { status: "refused"; error: PublicError };

function committed(result: PersistenceResult): void {
  if (result.status !== "committed")
    throw new ContractError("recording-exhausted");
  decodeCommittedBatch(result.batch);
}
function refusal(
  error: unknown,
  effect: PublicError["effect"] = "none",
): ModelPreparation {
  return {
    status: "refused",
    error: publicError(
      error instanceof ContractError ? error.code : "auth-unavailable",
      effect,
    ),
  };
}
/** Isolated adapters without the host's real route retain DIRECT-only behavior. */
function directAuthRoute(
  launch: LaunchEnvironment,
  scoped: Record<string, string>,
): void {
  for (const name of networkKeys) {
    if (
      Object.hasOwn(launch, name) ||
      Object.hasOwn(scoped, name) ||
      Object.getOwnPropertyDescriptor(process.env, name) !== undefined
    )
      throw new ContractError("unsupported-context");
  }
}
function exactEnvironment(
  launch: LaunchEnvironment,
  selected: {
    selection: Pick<ModelSelection, "provider">;
    env: Record<string, string>;
  },
  snapshot: PiSnapshot,
): void {
  const scoped = snapshot.credentials[selected.selection.provider]?.env;
  const local = scoped === undefined ? {} : environment(scoped);
  // 0.84.3's auth store and OAuth configured headers resolve templates through
  // process.env, not solely getAuth overrides. Check named launch facts without
  // mutating process.env. Empty/missing values never fall through to ambient.
  for (const [name, value] of Object.entries(selected.env)) {
    if (local[name]) continue;
    const d = Object.getOwnPropertyDescriptor(process.env, name);
    if (!d || !("value" in d) || d.value !== value || launch[name] !== value)
      throw new ContractError("stale");
  }
}
function authProjection(
  value: AuthResult | undefined,
): ServerModelEnvelope["auth"] {
  if (!value) throw new ContractError("auth-unavailable");
  const snapshot = data(clonePrivate(value));
  if (
    Object.keys(snapshot).some(
      (key) => !["auth", "env", "source"].includes(key),
    )
  )
    throw new ContractError("unsupported-context");
  const auth = data(snapshot.auth);
  if (
    Object.keys(auth).some(
      (key) => !["apiKey", "headers", "baseUrl"].includes(key),
    )
  )
    throw new ContractError("unsupported-context");
  for (const key of ["apiKey", "baseUrl"])
    if (
      auth[key] !== undefined &&
      (typeof auth[key] !== "string" || !auth[key] || auth[key].includes("\0"))
    )
      throw new ContractError("auth-unavailable");
  const headers: Record<string, string | null> = Object.create(null);
  if (auth.headers !== undefined) {
    for (const [name, entry] of Object.entries(data(auth.headers))) {
      if (
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
        (entry !== null &&
          (typeof entry !== "string" || /[\r\n\0]/.test(entry)))
      )
        throw new ContractError("auth-unavailable");
      headers[name] = entry;
    }
  }
  if (
    !auth.apiKey &&
    !Object.values(headers).some((v) => typeof v === "string" && v)
  )
    throw new ContractError("auth-unavailable");
  return {
    ok: true,
    ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey as string }),
    ...(auth.baseUrl === undefined ? {} : { baseUrl: auth.baseUrl as string }),
    ...(auth.headers === undefined ? {} : { headers }),
    ...(snapshot.env === undefined ? {} : { env: environment(snapshot.env) }),
  };
}

/** One explicit owner-selected runtime, no inference/session/resources. Passive
 * observe() only projects previously selected secret-free IDs, never touches SDK
 * storage, refresh, probes or files. All raw identities remain private RAM. */
const canonicalSelection = (v: ModelSelection) =>
  JSON.stringify(decodeModelSelection(v));
const runtimeOwners = new WeakMap<ServiceOwner, OwnerModelContext>();

export class OwnerModelContext {
  #options: ModelContextOptions;
  #launch: LaunchEnvironment;
  #source?: PiSource;
  #snapshot?: PiSnapshot;
  #runtime?: ModelRuntime;
  #thinking?: (model: Model<Api>) => readonly string[];
  #selected = new Map<string, Selected>();
  #pending = 0;
  #loading = false;
  #tail: Promise<void> = Promise.resolve();
  #generation = 0;
  constructor(options: ModelContextOptions) {
    const waitMs = options.waitMs ?? LIMITS.authWaitMs;
    if (
      !Number.isSafeInteger(waitMs) ||
      waitMs < 1 ||
      waitMs > LIMITS.authWaitMs
    )
      throw new ContractError("invalid");
    this.#options = { ...options, waitMs };
    this.#launch = captureEnvironment(options.environment);
  }
  observe(): ModelSelection[] {
    return [...this.#selected.values()].map((entry) => ({
      ...entry.selection,
    }));
  }
  /** Readonly selected-source freshness, never getAuth or inference. */
  assertCurrent(selection: ModelSelection): void {
    const selected = this.#selected.get(selection.sourceSelectionId);
    if (
      !selected ||
      canonicalSelection(selected.selection) !== canonicalSelection(selection)
    )
      throw new ContractError("stale");
    this.fresh(selected);
  }
  /** Owner-only known literals from validated private sources. No getAuth,
   * interpolation, refresh, credential write or public secret-derived identity. */
  redactionLiterals(selection: ModelSelection): readonly string[] {
    const selected = this.#selected.get(selection.sourceSelectionId);
    if (
      !selected ||
      canonicalSelection(selected.selection) !== canonicalSelection(selection)
    )
      throw new ContractError("stale");
    const snapshot = this.fresh(selected);
    const credential = snapshot.credentials[selection.provider];
    const strings = (value: unknown): string[] => {
      if (typeof value === "string") return [value];
      if (!value || typeof value !== "object") return [];
      return Object.values(data(value)).flatMap(strings);
    };
    const config = snapshot.providers[selection.provider];
    const literals = [
      ...(this.#options.network?.literals ?? []),
      ...strings(credential && "key" in credential ? credential.key : null),
      ...strings(credential?.type === "oauth" ? credential.access : null),
      ...strings(credential?.type === "oauth" ? credential.refresh : null),
      ...strings(credential?.env),
      ...strings(config?.apiKey),
      ...strings(config?.headers),
      ...strings(selected.model.headers),
      ...Object.values(selected.env),
      ...Object.entries(this.#launch).flatMap(([key, value]) =>
        /(?:KEY|TOKEN|SECRET|PASS|AUTH|COOKIE)/i.test(key) && value
          ? [value]
          : [],
      ),
    ].filter(Boolean);
    if (
      literals.reduce((n, s) => n + Buffer.byteLength(s), 0) >
      LIMITS.workerRequestBytes * 2
    )
      throw new ContractError("oversize");
    return [...new Set(literals)];
  }
  /** Owner-only readonly literals for current text before any model is selected.
   * Reuses the bounded catalog source policy, without enumerating/choosing models. */
  viewRedactionLiterals(): readonly string[] {
    return this.catalogLiterals(this.catalogSource());
  }
  get loading(): boolean {
    return this.#loading;
  }
  /** Bounded credential-free catalog. No selection, availability/auth probe or refresh. */
  catalog(): {
    status: "complete" | "capacity";
    entries: ModelCandidate[];
    withheld: number;
  } {
    try {
      const current = this.catalogSource();
      const runtime = this.#runtime;
      if (!runtime || !this.#thinking) throw new ContractError("unavailable");
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
      const literals = this.catalogLiterals(current);
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
            !this.isPublicIdentifier(provider, literals) ||
            !this.isPublicIdentifier(model.id, literals)
          ) {
            withheld++;
            continue;
          }
          const api = modelApis.find((api) => api === model.api) ?? null;
          const levels = this.#thinking(model);
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
              this.validateModel(
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
              eligibility,
            }),
          );
        }
      }
      // Re-read original selected sources before returning the projection.
      const after = this.catalogSource();
      if (
        after.auth.identity !== current.auth.identity ||
        after.auth.stamp !== current.auth.stamp
      )
        throw new ContractError("stale");
      return { status: "complete", entries, withheld };
    } catch (error) {
      throw new ContractError(
        error instanceof ContractError ? error.code : "corrupt-selected",
      );
    }
  }
  private catalogSource(): PiSnapshot {
    this.alive();
    if (
      this.#loading ||
      !this.#runtime ||
      !this.#snapshot ||
      !this.#source ||
      !this.#thinking
    )
      throw new ContractError("unavailable");
    if (this.#runtime.getError()) throw new ContractError("corrupt-selected");
    const current = readPiSnapshot(this.#source);
    if (!sameModels(this.#snapshot, current)) throw new ContractError("stale");
    return current;
  }
  private catalogLiterals(snapshot: PiSnapshot): readonly string[] {
    // Visit the already validated private snapshot without first flattening or
    // spreading an uncharged literal list. Charge each UNIQUE value before retain.
    const strings = (v: unknown, visit: (value: string) => void): void => {
      if (typeof v === "string") {
        if (v) visit(v);
      } else if (v && typeof v === "object") {
        for (const key of Object.keys(v))
          strings((v as Record<string, unknown>)[key], visit);
      }
    };
    const literals = new Set<string>();
    let literalBytes = 0;
    const add = (value: string) => {
      if (literals.has(value)) return;
      const size = Buffer.byteLength(value);
      if (literalBytes + size > LIMITS.workerRequestBytes * 2)
        throw new ContractError("oversize");
      literalBytes += size;
      literals.add(value);
    };
    for (const route of this.#options.network?.literals ?? []) add(route);
    const templates = (value: unknown, provider: string) => {
      const scoped = environment(snapshot.credentials[provider]?.env ?? {});
      strings(value, (literal) => {
        add(literal);
        for (const name of templateNames(literal)) {
          const resolved = scoped[name] || this.#launch[name];
          if (resolved) add(resolved);
        }
      });
    };
    for (const [provider, credential] of Object.entries(snapshot.credentials)) {
      strings(
        credential.type === "api_key" ? credential.key : credential.access,
        add,
      );
      strings(credential.type === "oauth" ? credential.refresh : null, add);
      strings(credential.env, add);
      if (credential.type === "api_key") templates(credential.key, provider);
    }
    for (const [provider, config] of Object.entries(snapshot.providers)) {
      templates(config.apiKey, provider);
      templates(config.headers, provider);
      for (const model of Array.isArray(config.models) ? config.models : [])
        templates(data(model).headers, provider);
      if (config.modelOverrides)
        for (const model of Object.values(data(config.modelOverrides)))
          templates(data(model).headers, provider);
    }
    for (const [key, value] of Object.entries(this.#launch))
      if (/(?:KEY|TOKEN|SECRET|PASS|AUTH|COOKIE)/i.test(key) && value)
        add(value);
    return [...literals];
  }
  private isPublicIdentifier(
    value: string,
    literals: readonly string[],
  ): boolean {
    return (
      !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value) &&
      diagnosticText(value, 512, literals) === value &&
      sanitizeText(value, literals) === value
    );
  }
  private publicIdentifier(value: string, literals: readonly string[]): void {
    if (!this.isPublicIdentifier(value, literals))
      throw new ContractError("unsupported-context");
  }
  /** Explicit owner-wide replacement only, never called by catalog/read paths. */
  replaceSelection(
    input: ModelSelector,
    beforeInstall: () => void,
  ): ModelSelection {
    this.#options.owner.assertQuiescent();
    if (this.#pending || this.#loading) throw new ContractError("conflict");
    const selector = decodeModelSelector(input);
    for (const old of this.#selected.values()) {
      // A different selector cannot launder changed selected sources into a new
      // choice under the old displayed version. Refuse without retiring IDs.
      this.assertCurrent(old.selection);
      const { sourceSelectionId: _id, ...previous } = old.selection;
      if (JSON.stringify(previous) === JSON.stringify(selector)) {
        beforeInstall();
        for (const id of this.#selected.keys())
          if (id !== old.selection.sourceSelectionId) this.#selected.delete(id);
        return { ...old.selection };
      }
    }
    // Validation completes before any old selection is retired.
    const current = this.catalogSource();
    const validated = this.validateModel(selector, current);
    this.#options.owner.assertQuiescent();
    const selection = { sourceSelectionId: randomUUID(), ...selector };
    const selected = {
      ...validated,
      model: clonePrivate(validated.model),
      selection,
    };
    const after = this.catalogSource();
    if (
      after.auth.identity !== current.auth.identity ||
      after.auth.stamp !== current.auth.stamp
    )
      throw new ContractError("stale");
    beforeInstall();
    this.#selected.clear();
    this.#selected.set(selection.sourceSelectionId, selected);
    return { ...selection };
  }
  get pending(): number {
    return this.#pending;
  }
  private alive(): void {
    if (this.#options.owner.state !== "idle")
      throw new ContractError("quarantine");
    this.#options.owner.lease.assert();
  }
  /** Explicit load/reload only. No API auth call; malformed existing input is
   * refused before SDK construction, and getError is never a warning/fallback. */
  async load(): Promise<void> {
    this.alive();
    if (this.#loading || this.#pending) throw new ContractError("capacity");
    const existing = runtimeOwners.get(this.#options.owner);
    if (existing && existing !== this) throw new ContractError("conflict");
    runtimeOwners.set(this.#options.owner, this);
    this.#loading = true;
    this.#selected.clear();
    this.#runtime = undefined;
    ++this.#generation;
    try {
      const source = piSource(
        this.#options.agentDir,
        this.#options.home,
        this.#options.cwd,
        this.#launch,
      );
      const before = readPiSnapshot(source);
      const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
      const { InMemoryModelsStore, getSupportedThinkingLevels } = await import(
        "@earendil-works/pi-ai"
      );
      // SDK imports can replace startup dispatchers; install owned public routing
      // after those imports, before ModelRuntime construction/getAuth.
      if (this.#options.network) await this.#options.network.initialize();
      this.alive();
      const ready = readPiSnapshot(source);
      if (
        ready.auth.identity !== before.auth.identity ||
        !sameModels(before, ready)
      )
        throw new ContractError("stale");
      const runtime = await ModelRuntime.create({
        authPath: source.authPath,
        modelsPath: source.modelsPath,
        modelsStore: new InMemoryModelsStore(),
        allowModelNetwork: false,
        refreshOnCreate: false,
      });
      this.alive();
      const after = readPiSnapshot(source);
      if (runtime.getError()) throw new ContractError("corrupt-selected");
      if (
        after.auth.identity !== ready.auth.identity ||
        !sameModels(ready, after)
      )
        throw new ContractError("stale");
      this.#source = source;
      this.#snapshot = after;
      this.#runtime = runtime;
      this.#thinking = getSupportedThinkingLevels;
    } catch (error) {
      runtimeOwners.delete(this.#options.owner);
      // Never inspect provider/OS exception properties or expose config bytes.
      throw new ContractError(
        error instanceof ContractError ? error.code : "corrupt-selected",
      );
    } finally {
      this.#loading = false;
    }
  }
  /** Selection is an explicit local operation; sourceSelectionId is random, not
   * a credential/config digest. Callers bind this value into fresh confirmation. */
  select(input: Omit<ModelSelection, "sourceSelectionId">): ModelSelection {
    try {
      return this.selectExisting(input);
    } catch (error) {
      throw new ContractError(
        error instanceof ContractError ? error.code : "corrupt-selected",
      );
    }
  }
  private selectExisting(
    input: Omit<ModelSelection, "sourceSelectionId">,
  ): ModelSelection {
    this.alive();
    if (this.#selected.size >= LIMITS.maxPageEntries)
      throw new ContractError("capacity");
    const selector = decodeModelSelector(input);
    const validated = this.validateModel(selector, this.catalogSource());
    const selection = { sourceSelectionId: randomUUID(), ...selector };
    this.#selected.set(selection.sourceSelectionId, {
      ...validated,
      model: clonePrivate(validated.model),
      selection,
    });
    return { ...selection };
  }
  private validateModel(
    input: ModelSelector,
    current: PiSnapshot,
  ): Omit<Selected, "selection"> {
    const runtime = this.#runtime;
    if (!runtime || !this.#thinking) throw new ContractError("unavailable");
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
      !this.#thinking(model).includes(input.thinking)
    )
      throw new ContractError("unsupported-context");
    const literals = this.catalogLiterals(current);
    this.publicIdentifier(input.provider, literals);
    this.publicIdentifier(input.model, literals);
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
      env: selectedEnvironment(
        current,
        input.provider,
        input.model,
        this.#launch,
      ),
    };
    // exactEnvironment only needs the provider, not an allocated source ID.
    exactEnvironment(this.#launch, { ...selected, selection: input }, current);
    return selected;
  }
  private fresh(selected: Selected, resolvingOAuth = false): PiSnapshot {
    this.alive();
    if (!this.#source || !this.#snapshot || !this.#runtime)
      throw new ContractError("unavailable");
    const snapshot = readPiSnapshot(this.#source);
    // getModel can invoke a registered provider's synchronous getModels. Guard
    // function transports BEFORE calling it, including unchanged-choice reads.
    if (
      this.#runtime.getError() ||
      this.#runtime.getRegisteredNativeProvider(selected.selection.provider) ||
      this.#runtime.getRegisteredProviderConfig(selected.selection.provider)
    )
      throw new ContractError("stale");
    const model = this.#runtime.getModel(
      selected.selection.provider,
      selected.selection.model,
    );
    if (
      !sameModels(snapshot, this.#snapshot) ||
      sourceIdentity(snapshot, selected.selection.provider) !==
        selected.sourceIdentity ||
      (!resolvingOAuth &&
        stablePrivate(
          snapshot.credentials[selected.selection.provider] ?? null,
        ) !== selected.credentialIdentity) ||
      JSON.stringify(clonePrivate(model)) !== JSON.stringify(selected.model) ||
      this.#runtime.getError() ||
      this.#runtime.getRegisteredNativeProvider(selected.selection.provider) ||
      this.#runtime.getRegisteredProviderConfig(selected.selection.provider)
    )
      throw new ContractError("stale");
    exactEnvironment(this.#launch, selected, snapshot);
    this.authRoute(selected.env);
    return snapshot;
  }
  private authRoute(scoped: Record<string, string>): void {
    if (this.#options.network) this.#options.network.assert(scoped);
    else directAuthRoute(this.#launch, scoped);
  }
  private async trackedWrite(
    original: Promise<PersistenceResult>,
  ): Promise<PersistenceResult> {
    void original.catch(() => {});
    let trackingFailed = false;
    try {
      if (!this.#options.accounting.lifetimeTracked)
        this.#options.owner.trackPersistence(original);
    } catch {
      trackingFailed = true;
    }
    // Even refused late registration does not refund an in-flight write slot.
    const result = await original;
    if (trackingFailed) throw new ContractError("quarantine");
    return result;
  }
  prepare(input: ModelPreparationInput): Promise<ModelPreparation> {
    return this.prepareTracked(input).result;
  }
  prepareTracked(input: ModelPreparationInput): TrackedModelPreparation {
    // Capacity is reserved before any await/copy/SDK effect. Caller cancellation
    // does NOT refund an outstanding original or its settlement write.
    if (this.#loading || this.#pending >= LIMITS.childReservations)
      return {
        result: Promise.resolve(refusal(new ContractError("capacity"))),
        settled: Promise.resolve(),
      };
    ++this.#pending;
    const writes: Promise<PersistenceResult>[] = [];
    const retainWrite = (report: Promise<PersistenceResult>) => {
      const original = this.#options.accounting.original?.(report) ?? report;
      void original.catch(() => {});
      writes.push(original);
      return report;
    };
    let closed = input.signal.aborted;
    let effectStarted = false;
    const current = () => {
      try {
        return input.current() === true;
      } catch {
        return false;
      }
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const close = () => {
      closed = true;
    };
    let reportClosed!: () => void;
    const closedWait = new Promise<ModelPreparation>((resolve) => {
      reportClosed = () => {
        close();
        resolve(
          refusal(
            new ContractError("auth-unavailable"),
            effectStarted ? "uncertain" : "none",
          ),
        );
      };
    });
    input.signal.addEventListener("abort", reportClosed, { once: true });
    timer = setTimeout(reportClosed, this.#options.waitMs);
    if (closed) reportClosed();
    const previous = this.#tail;
    const operation = (async (): Promise<ModelPreparation> => {
      try {
        const request = decodeWorkerPublicRequest(input.request);
        const operationId = decodeId(input.operationId);
        const epoch = decodeId(input.epoch);
        if (epoch !== this.#options.owner.lease.registration.epoch)
          throw new ContractError("stale");
        if (
          !Number.isSafeInteger(input.timeoutMs) ||
          input.timeoutMs < 100 ||
          input.timeoutMs > LIMITS.workerMs
        )
          throw new ContractError("invalid");
        const validityMs = input.timeoutMs + LIMITS.authValidityMarginMs;
        const generation = this.#generation;
        const selected = this.#selected.get(request.model.sourceSelectionId);
        if (
          !selected ||
          JSON.stringify(selected.selection) !== JSON.stringify(request.model)
        )
          throw new ContractError("stale");
        const check = () => {
          if (closed || input.signal.aborted) throw new ContractError("stale");
          const stillCurrent = current();
          // A trusted current-context callback can synchronously cause cancel or
          // reload. Its return value cannot override those newer facts.
          if (
            closed ||
            input.signal.aborted ||
            !stillCurrent ||
            generation !== this.#generation
          )
            throw new ContractError("stale");
          return this.fresh(selected);
        };
        await previous;
        check();
        effectStarted = true;
        const intent = this.#options.accounting.preparation({
          operationId,
          epoch,
          runId: request.runId,
          childRunId: request.childRunId,
          sourceSelectionId: request.model.sourceSelectionId,
          validityMs,
        });
        committed(await this.trackedWrite(retainWrite(intent)));
        let initial: PiSnapshot;
        try {
          initial = check();
        } catch (error) {
          const write = this.#options.accounting.settlement({
            operationId,
            outcome: "refused",
            admissionClosed: true,
          });
          committed(await this.trackedWrite(retainWrite(write)));
          throw error;
        }
        const runtime = this.#runtime;
        if (!runtime) throw new ContractError("unavailable");
        // NEVER forward the caller's signal. Installed SDK's original promise
        // encompasses refresh/writeback only when this operation signal stays live.
        const operationSignal = new AbortController().signal;
        let original: Promise<AuthResult | undefined>;
        try {
          original = runtime.getAuth(selected.model, {
            signal: operationSignal,
            env: { ...selected.env },
            minOAuthValidityMs: validityMs,
          });
        } catch {
          original = Promise.reject(new ContractError("auth-unavailable"));
        }
        let material: ServerModelEnvelope | undefined;
        let failure: unknown;
        const recorded = original.then(
          (auth) => {
            let outcome: "resolved" | "refused" = "resolved";
            try {
              const latest = this.fresh(selected, true);
              const credential =
                latest.credentials[selected.selection.provider];
              if (
                credential?.type === "oauth" &&
                credential.expires < Date.now() + validityMs
              )
                throw new ContractError("auth-unavailable");
              // Non-OAuth source changes never count as routine renewal.
              if (
                sourceIdentity(initial, selected.selection.provider) !==
                sourceIdentity(latest, selected.selection.provider)
              )
                throw new ContractError("stale");
              const projected = authProjection(auth);
              this.authRoute(projected.env ?? {});
              material = {
                request,
                cwd: this.#options.cwd,
                model: {
                  ...selected.model,
                  baseUrl: projected.baseUrl ?? selected.model.baseUrl,
                },
                auth: projected,
              };
              delete material.model.headers; // Parent resolution includes literal model headers.
              assertWorkerEnvelopeSize(JSON.stringify(material));
              // Advance only an observed original resolution, not arbitrary file
              // changes between admissions. Opaque OAuth credentials provide no
              // public proof of account identity; external unobserved replacements
              // conservatively require a new selection, never secret-derived IDs.
              for (const entry of this.#selected.values()) {
                if (
                  entry.selection.provider === selected.selection.provider &&
                  entry.sourceIdentity === selected.sourceIdentity &&
                  entry.credentialIdentity ===
                    stablePrivate(
                      initial.credentials[selected.selection.provider] ?? null,
                    )
                )
                  entry.credentialIdentity = stablePrivate(credential ?? null);
              }
            } catch (error) {
              failure = error;
              outcome = "refused";
            }
            return retainWrite(
              this.#options.accounting.settlement({
                operationId,
                outcome,
                admissionClosed:
                  closed ||
                  input.signal.aborted ||
                  !current() ||
                  this.#options.owner.state !== "idle",
              }),
            );
          },
          () => {
            failure = new ContractError("auth-unavailable");
            return retainWrite(
              this.#options.accounting.settlement({
                operationId,
                outcome: "failed",
                admissionClosed:
                  closed ||
                  input.signal.aborted ||
                  !current() ||
                  this.#options.owner.state !== "idle",
              }),
            );
          },
        );
        // Both originals are immediately handled/tracked, including refused late
        // registration. ServiceOwner deliberately quarantines rejected originals.
        void recorded.catch(() => {});
        let trackingFailed = false;
        try {
          this.#options.owner.trackAuth(
            original,
            this.#options.accounting.lifetimeTracked ? undefined : recorded,
          );
        } catch {
          trackingFailed = true;
        }
        committed(await recorded);
        if (trackingFailed) throw new ContractError("quarantine");
        check();
        if (failure || !material)
          throw failure ?? new ContractError("auth-unavailable");
        const preparedMaterial = material;
        const preparedIdentity = selected.credentialIdentity;
        let used = false;
        return {
          status: "prepared",
          prepared: Object.freeze({
            consume: <T>(
              encode: (value: ServerModelEnvelope) => string,
              use: (serialized: string) => T,
            ): T => {
              if (used) throw new ContractError("consumed-grant");
              used = true;
              try {
                const snapshot = check();
                if (preparedIdentity !== selected.credentialIdentity)
                  throw new ContractError("stale");
                const credential =
                  snapshot.credentials[selected.selection.provider];
                if (
                  credential?.type === "oauth" &&
                  credential.expires < Date.now() + validityMs
                )
                  throw new ContractError("auth-unavailable");
                const serialized = encode(clonePrivate(preparedMaterial));
                if (typeof serialized !== "string")
                  throw new ContractError("invalid");
                assertWorkerEnvelopeSize(serialized);
                check();
                // Encoding is synchronous but may take time or reenter. Recheck
                // remaining validity after it, beside the final context/abort
                // check, with no await or alternate factory before native use.
                if (
                  credential?.type === "oauth" &&
                  credential.expires < Date.now() + validityMs
                )
                  throw new ContractError("auth-unavailable");
                return use(serialized);
              } catch (error) {
                throw new ContractError(
                  error instanceof ContractError
                    ? error.code
                    : "auth-unavailable",
                );
              }
            },
          }),
        };
      } catch (error) {
        return refusal(error, effectStarted ? "uncertain" : "none");
      }
    })();
    const settled = operation.then(async () => {
      await Promise.allSettled(writes);
      --this.#pending;
    });
    this.#tail = settled;
    return {
      settled,
      result: Promise.race([operation, closedWait]).finally(() => {
        clearTimeout(timer);
        input.signal.removeEventListener("abort", reportClosed);
        // Keep checking input.signal after return; reporting cannot refund originals.
      }),
    };
  }
}
