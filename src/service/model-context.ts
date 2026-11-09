import { randomUUID } from "node:crypto";
import type { Api, AuthResult, Model } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { networkKeys } from "../sdk-network.ts";
import {
  assertWorkerEnvelopeSize,
  ContractError,
  canonicalJson,
  decodeCommittedBatch,
  decodeId,
  decodeModelSelection,
  decodeModelSelector,
  decodeWorkerPublicRequest,
  LIMITS,
  type ModelCandidate,
  type ModelSelection,
  type ModelSelector,
  type PublicError,
  publicError,
  type WorkerPublicRequest,
} from "../service-contract.ts";
import { decodeWorkerRuntime, type WorkerRuntime } from "../worker-model.mjs";
import type { AuthNetwork } from "./auth-network.ts";
import {
  exactEnvironment,
  projectModelCatalog,
  validateCatalogModel,
} from "./model-catalog.ts";
import {
  captureEnvironment,
  clonePrivate,
  data,
  environment,
  type LaunchEnvironment,
  type PiSnapshot,
  type PiSource,
  PiSourceRefusal,
  piSource,
  readPiSnapshot,
  sameModels,
  sdkRefusal,
  snapshotLiterals,
  sourceIdentity,
  stablePrivate,
} from "./model-config.ts";
import type { ServiceOwner } from "./owner.ts";
import type {
  AuthAccountingPort,
  AuthPreparationIntent,
  AuthPreparationSettlement,
  PersistenceResult,
} from "./ports.ts";
import { readWorkerRuntime } from "./worker-settings.ts";

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
  runtime?: WorkerRuntime;
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
  /** Re-resolve the same pinned source at an SDK request boundary, including compaction. */
  refreshAuth(): Promise<ServerModelEnvelope["auth"]>;
  consume<T>(
    encode: (material: ServerModelEnvelope) => string,
    use: (serialized: string) => T,
  ): T;
}
export interface ModelPreparationInput {
  /** Admission-owned preferences; later workers/refreshes never reload them. */
  runtime?: WorkerRuntime;
  request: WorkerPublicRequest;
  operationId: string;
  epoch: string;
  signal: AbortSignal;
  /** Validated by the admitting conversation/workflow; never inferred from the owner default. */
  cwd?: string;
  current: () => boolean;
  /** Ordinary chat has its own durable turn, not a fabricated task admission.
   * These synchronous private writes must flush before returning, and fence on
   * uncertainty. They never receive resolved credentials. */
  journal?: {
    preparation(intent: AuthPreparationIntent): void;
    settlement(result: AuthPreparationSettlement): void;
  };
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
  #readSettings?: (
    cwd: string,
    model: { provider: string; id: string },
  ) => WorkerRuntime;
  #thinking?: (model: Model<Api>) => readonly string[];
  #selected = new Map<string, Selected>();
  #retained = new Set<string>();
  #pending = 0;
  #loading = false;
  #tail: Promise<void> = Promise.resolve();
  #generation = 0;
  constructor(options: ModelContextOptions) {
    this.#options = options;
    this.#launch = captureEnvironment(options.environment);
  }
  workerSettings(cwd: string, selection: ModelSelection): WorkerRuntime {
    this.assertCurrent(selection);
    if (!this.#readSettings) throw new ContractError("unavailable");
    return this.#readSettings(cwd, {
      provider: selection.provider,
      id: selection.model,
    });
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
      const catalog = projectModelCatalog(
        runtime,
        this.#thinking,
        current,
        this.catalogLiterals(current),
        (input, snapshot) => this.validateModel(input, snapshot),
      );
      // Re-read original selected sources before returning the projection.
      const after = this.catalogSource();
      if (
        after.auth.identity !== current.auth.identity ||
        after.auth.stamp !== current.auth.stamp
      )
        throw new ContractError("stale");
      return catalog;
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
    return snapshotLiterals(
      snapshot,
      this.#launch,
      this.#options.network?.literals ?? [],
    );
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
          if (id !== old.selection.sourceSelectionId && !this.#retained.has(id))
            this.#selected.delete(id);
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
    for (const id of this.#selected.keys())
      if (!this.#retained.has(id)) this.#selected.delete(id);
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
    this.#retained.clear();
    this.#runtime = undefined;
    this.#readSettings = undefined;
    ++this.#generation;
    try {
      const source = piSource(
        this.#options.agentDir,
        this.#options.home,
        this.#options.cwd,
        this.#launch,
      );
      const before = readPiSnapshot(source);
      const pi = await import("@earendil-works/pi-coding-agent");
      const { ModelRuntime } = pi;
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
      const refused = runtime.getError();
      if (refused) throw sdkRefusal(refused);
      if (
        after.auth.identity !== ready.auth.identity ||
        !sameModels(ready, after)
      )
        throw new ContractError("stale");
      this.#source = source;
      this.#snapshot = after;
      this.#runtime = runtime;
      this.#thinking = getSupportedThinkingLevels;
      this.#readSettings = (cwd, model) =>
        readWorkerRuntime(cwd, source.directory, model, pi);
    } catch (error) {
      runtimeOwners.delete(this.#options.owner);
      // Never inspect provider/OS exception properties or expose config bytes;
      // a Pi source refusal carries only Cadence's own field path and words.
      if (error instanceof PiSourceRefusal) throw error;
      throw new ContractError(
        error instanceof ContractError ? error.code : "corrupt-selected",
      );
    } finally {
      this.#loading = false;
    }
  }
  /** Shared finite source cache; reads never install a conversation preference. */
  retainedSelection(
    input: ModelSelector,
    onlyRetained = true,
  ): ModelSelection | null {
    const key = canonicalJson(decodeModelSelector(input));
    for (const entry of this.#selected.values()) {
      const { sourceSelectionId: _id, ...selector } = entry.selection;
      if (
        canonicalJson(selector) === key &&
        (!onlyRetained || this.#retained.has(entry.selection.sourceSelectionId))
      )
        return { ...entry.selection };
    }
    return null;
  }
  /** Explicit conversation choice, independent of other conversations' work.
   * Source IDs stay alive for accepted runs; distinct selectors share the
   * existing bounded runtime cache rather than growing with conversation count. */
  retainSelection(input: ModelSelector): ModelSelection {
    const old = this.retainedSelection(input, false);
    if (old) {
      this.assertCurrent(old);
      this.#retained.add(old.sourceSelectionId);
      return old;
    }
    const selected = this.select(input);
    this.#retained.add(selected.sourceSelectionId);
    return selected;
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
    if (!this.#runtime || !this.#thinking)
      throw new ContractError("unavailable");
    return validateCatalogModel(
      this.#runtime,
      this.#thinking,
      input,
      current,
      this.#launch,
      this.catalogLiterals(current),
    );
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
    const recordPreparation = async (
      intent: AuthPreparationIntent,
    ): Promise<void> => {
      if (input.journal) input.journal.preparation(intent);
      else
        committed(
          await this.trackedWrite(
            retainWrite(this.#options.accounting.preparation(intent)),
          ),
        );
    };
    const recordSettlement = async (
      result: AuthPreparationSettlement,
    ): Promise<PersistenceResult | null> => {
      if (input.journal) {
        input.journal.settlement(result);
        return null;
      }
      // Register the ORIGINAL combined settlement below, before getAuth can
      // settle or Stop can close admission. Never late-track a continuation.
      return retainWrite(this.#options.accounting.settlement(result));
    };
    const taskResult = (
      result: PersistenceResult | null,
    ): PersistenceResult => {
      if (result === null) throw new ContractError("recording-exhausted");
      return result;
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
    if (closed) reportClosed();
    const previous = this.#tail;
    const operation = (async (): Promise<ModelPreparation> => {
      try {
        const request = decodeWorkerPublicRequest(input.request);
        const operationId = decodeId(input.operationId);
        const epoch = decodeId(input.epoch);
        if (epoch !== this.#options.owner.lease.registration.epoch)
          throw new ContractError("stale");
        const validityMs = LIMITS.authValidityMarginMs;
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
        const workerRuntime = input.runtime
          ? decodeWorkerRuntime(input.runtime)
          : this.workerSettings(
              input.cwd ?? this.#options.cwd,
              selected.selection,
            );
        check();
        effectStarted = true;
        await recordPreparation({
          operationId,
          epoch,
          runId: request.runId,
          childRunId: request.childRunId,
          sourceSelectionId: request.model.sourceSelectionId,
          validityMs,
        });
        let initial: PiSnapshot;
        try {
          initial = check();
        } catch (error) {
          const result: AuthPreparationSettlement = {
            operationId,
            outcome: "refused",
            admissionClosed: true,
          };
          if (input.journal) input.journal.settlement(result);
          else
            committed(
              await this.trackedWrite(
                retainWrite(this.#options.accounting.settlement(result)),
              ),
            );
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
                runtime: workerRuntime,
                request,
                cwd: input.cwd ?? this.#options.cwd,
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
            return recordSettlement({
              operationId,
              outcome,
              admissionClosed:
                closed ||
                input.signal.aborted ||
                !current() ||
                this.#options.owner.state !== "idle",
            });
          },
          () => {
            failure = new ContractError("auth-unavailable");
            return recordSettlement({
              operationId,
              outcome: "failed",
              admissionClosed:
                closed ||
                input.signal.aborted ||
                !current() ||
                this.#options.owner.state !== "idle",
            });
          },
        );
        // Both originals are immediately handled/tracked, including refused late
        // registration. ServiceOwner deliberately quarantines rejected originals.
        void recorded.catch(() => {});
        let trackingFailed = false;
        try {
          this.#options.owner.trackAuth(
            original,
            input.journal || this.#options.accounting.lifetimeTracked
              ? undefined
              : recorded.then(taskResult),
          );
        } catch {
          trackingFailed = true;
        }
        const record = await recorded;
        if (!input.journal) committed(taskResult(record));
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
            refreshAuth: async () => {
              const next = this.prepareTracked({
                ...input,
                runtime: workerRuntime,
                operationId: randomUUID(),
              });
              // A reporting refusal/abort does not settle original OAuth or its
              // writeback. Keep the request and all owner fences until it does.
              const result = await next.result;
              await next.settled;
              if (result.status !== "prepared")
                throw new ContractError(result.error.code);
              let auth: ServerModelEnvelope["auth"] | undefined;
              return result.prepared.consume(
                (material) => {
                  auth = material.auth;
                  return JSON.stringify(material);
                },
                () => {
                  if (!auth) throw new ContractError("auth-unavailable");
                  return auth;
                },
              );
            },
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
        input.signal.removeEventListener("abort", reportClosed);
        // Keep checking input.signal after return; reporting cannot refund originals.
      }),
    };
  }
}
