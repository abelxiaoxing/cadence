import {
  inspectRoutePolicy,
  type RouteDialect,
  type RoutePolicy,
  type WorkerRole,
  type WorkerRoutePolicy,
} from "./route-policy.ts";

export const ROUTE_ATTEMPT_BOUNDS = Object.freeze({
  connectMs: 10_000,
  firstResponseMs: 90_000,
  idleMs: 3 * 60_000,
  totalMs: 20 * 60_000,
  cooldownMs: 30_000,
  attemptsPerRoute: 2,
});

export type RouteHealthState = "healthy" | "open" | "half-open";

export interface RouteRequirements {
  dialects?: RouteDialect[];
  minContextWindow?: number;
  minOutputTokens?: number;
}

interface RouteHealth {
  state: RouteHealthState;
  retryAt?: number;
  probeInFlight?: boolean;
  probeExpiresAt?: number;
  lastCode?: string;
}

export interface RouteHealthStore {
  get(fingerprint: string): RouteHealth | undefined;
  set(fingerprint: string, health: RouteHealth): void;
}

class MemoryRouteHealthStore implements RouteHealthStore {
  readonly #values = new Map<string, RouteHealth>();

  get(fingerprint: string): RouteHealth | undefined {
    const value = this.#values.get(fingerprint);
    return value ? structuredClone(value) : undefined;
  }

  set(fingerprint: string, health: RouteHealth): void {
    this.#values.set(fingerprint, structuredClone(health));
  }
}

export interface WorkerBrokerOptions {
  now?: () => number;
  healthStore?: RouteHealthStore;
}

export interface RunWorkerAttemptInput<T> {
  runId: string;
  taskId?: string;
  operationId: string;
  role: WorkerRole;
  requirements?: RouteRequirements;
  signal?: AbortSignal;
  onActivity?: (event: BrokerActivityUpdate) => void;
  classifyResult?: (value: T) => string | undefined;
  execute(context: RouteAttemptContext): Promise<T>;
}

export interface RouteAttemptContext {
  route: WorkerRoutePolicy;
  signal: AbortSignal;
  onHeaders(): void;
  onProgress(): void;
}

export interface BrokerAttemptEvidence {
  routeId: string;
  code: string;
}

export interface BrokerActivityUpdate {
  state: "connecting" | "waiting-first-response" | "running" | "retrying";
  attempt: number;
  maxAttempts: number;
  code?: string;
  wait?: string;
}

function emitBrokerActivity(
  observer: ((event: BrokerActivityUpdate) => void) | undefined,
  event: BrokerActivityUpdate,
): void {
  try {
    observer?.(structuredClone(event));
  } catch {
    // Presentation cannot influence route selection or attempt control.
  }
}

class RouteAttemptStop extends Error {
  readonly code:
    | "connect-timeout"
    | "first-response-timeout"
    | "idle-timeout"
    | "phase-timeout"
    | "cancelled";

  constructor(code: RouteAttemptStop["code"]) {
    super(code);
    this.name = "RouteAttemptStop";
    this.code = code;
  }
}

function isRole(value: unknown): value is WorkerRole {
  return [
    "design-explorer",
    "implementation-worker",
    "diagnosis-worker",
  ].includes(String(value));
}

function validRequirements(value: unknown): value is RouteRequirements {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (
    Object.keys(candidate).some(
      (key) =>
        !["dialects", "minContextWindow", "minOutputTokens"].includes(key),
    )
  ) {
    return false;
  }
  return (
    (candidate.dialects === undefined ||
      (Array.isArray(candidate.dialects) &&
        candidate.dialects.length > 0 &&
        candidate.dialects.every((dialect) =>
          [
            "openai-completions",
            "openai-responses",
            "anthropic-messages",
          ].includes(String(dialect)),
        ))) &&
    (candidate.minContextWindow === undefined ||
      (Number.isSafeInteger(candidate.minContextWindow) &&
        (candidate.minContextWindow as number) > 0)) &&
    (candidate.minOutputTokens === undefined ||
      (Number.isSafeInteger(candidate.minOutputTokens) &&
        (candidate.minOutputTokens as number) > 0))
  );
}

function capable(
  route: WorkerRoutePolicy,
  role: WorkerRole,
  requirements: RouteRequirements,
): boolean {
  const dialects = requirements.dialects ?? [];
  return (
    route.capabilities.roles.includes(role) &&
    dialects.every((dialect) =>
      route.capabilities.dialects.includes(dialect),
    ) &&
    route.capabilities.contextWindow >= (requirements.minContextWindow ?? 0) &&
    route.capabilities.maxTokens >= (requirements.minOutputTokens ?? 0)
  );
}

function safeFailureCode(error: unknown): string {
  if (error instanceof RouteAttemptStop) return error.code;
  return "transport-failure";
}

export class WorkerBroker {
  readonly #policy: RoutePolicy;
  readonly #now: () => number;
  readonly #healthStore: RouteHealthStore;

  constructor(policy: RoutePolicy, options: WorkerBrokerOptions = {}) {
    this.#policy = structuredClone(policy);
    this.#now = options.now ?? Date.now;
    this.#healthStore = options.healthStore ?? new MemoryRouteHealthStore();
  }

  #routeHealth(routeId: string): RouteHealth {
    const route = this.#policy.routes[routeId];
    return (
      (route ? this.#healthStore.get(route.fingerprint) : undefined) ?? {
        state: "healthy",
      }
    );
  }

  #setRouteHealth(routeId: string, health: RouteHealth): void {
    const route = this.#policy.routes[routeId];
    if (!route) throw new Error("route-not-declared");
    this.#healthStore.set(route.fingerprint, health);
  }

  markFailure(routeId: string, code: string): void {
    if (!Object.hasOwn(this.#policy.routes, routeId)) {
      throw new Error("route-not-declared");
    }
    this.#setRouteHealth(routeId, {
      state: "open",
      retryAt: this.#now() + ROUTE_ATTEMPT_BOUNDS.cooldownMs,
      lastCode: code,
    });
  }

  markSuccess(routeId: string): void {
    if (!Object.hasOwn(this.#policy.routes, routeId)) {
      throw new Error("route-not-declared");
    }
    this.#setRouteHealth(routeId, { state: "healthy" });
  }

  #releaseHalfOpenProbeForRetry(routeId: string, code: string): void {
    const health = this.#routeHealth(routeId);
    if (health.state !== "half-open" || !health.probeInFlight) return;
    this.#setRouteHealth(routeId, {
      state: "open",
      retryAt: this.#now(),
      lastCode: code,
    });
  }

  select(input: {
    role: WorkerRole;
    dialects?: RouteDialect[];
    minContextWindow?: number;
    minOutputTokens?: number;
    exclude?: readonly string[];
    routeId?: string;
  }):
    | { ok: true; route: WorkerRoutePolicy; health: RouteHealthState }
    | { ok: false; code: "endpoint-unavailable" | "route-not-declared" } {
    const requirements: RouteRequirements = {
      ...(input.dialects ? { dialects: input.dialects } : {}),
      ...(input.minContextWindow === undefined
        ? {}
        : { minContextWindow: input.minContextWindow }),
      ...(input.minOutputTokens === undefined
        ? {}
        : { minOutputTokens: input.minOutputTokens }),
    };
    if (!isRole(input.role) || !validRequirements(requirements)) {
      return { ok: false, code: "endpoint-unavailable" };
    }
    const declared = this.#policy.roles[input.role];
    const candidates = input.routeId
      ? declared.includes(input.routeId)
        ? [input.routeId]
        : []
      : declared;
    if (input.routeId && candidates.length === 0) {
      return { ok: false, code: "route-not-declared" };
    }
    const excluded = new Set(input.exclude ?? []);
    for (const routeId of candidates) {
      if (excluded.has(routeId)) continue;
      const route = this.#policy.routes[routeId];
      if (!route || !capable(route, input.role, requirements)) continue;
      const health = this.#routeHealth(routeId);
      if (
        health.state === "open" &&
        health.retryAt !== undefined &&
        health.retryAt > this.#now()
      ) {
        continue;
      }
      if (
        (health.state === "open" || health.state === "half-open") &&
        health.probeInFlight &&
        health.probeExpiresAt !== undefined &&
        health.probeExpiresAt > this.#now()
      ) {
        continue;
      }
      if (health.state === "open") {
        return { ok: true, route: structuredClone(route), health: "half-open" };
      }
      return {
        ok: true,
        route: structuredClone(route),
        health: health.state,
      };
    }
    return { ok: false, code: "endpoint-unavailable" };
  }

  async #attempt<T>(
    route: WorkerRoutePolicy,
    execute: (context: RouteAttemptContext) => Promise<T>,
    parentSignal?: AbortSignal,
    onActivity?: (state: "waiting-first-response" | "running") => void,
  ): Promise<T> {
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let headersSeen = false;
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let firstResponseTimer: ReturnType<typeof setTimeout> | undefined;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const stop = (code: RouteAttemptStop["code"]) => {
      if (!controller.signal.aborted)
        controller.abort(new RouteAttemptStop(code));
    };
    const schedule = (code: RouteAttemptStop["code"], milliseconds: number) => {
      const timer = setTimeout(() => stop(code), milliseconds);
      timers.add(timer);
      return timer;
    };
    const clear = (timer: ReturnType<typeof setTimeout> | undefined) => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(timer);
      }
    };
    const onParentAbort = () => stop("cancelled");
    if (parentSignal?.aborted) stop("cancelled");
    else parentSignal?.addEventListener("abort", onParentAbort, { once: true });

    connectTimer = schedule("connect-timeout", ROUTE_ATTEMPT_BOUNDS.connectMs);
    schedule("phase-timeout", ROUTE_ATTEMPT_BOUNDS.totalMs);
    let removeAbortRace: () => void = () => {};
    try {
      const execution = Promise.resolve().then(() =>
        execute({
          route: structuredClone(route),
          signal: controller.signal,
          onHeaders: () => {
            if (controller.signal.aborted || headersSeen) return;
            headersSeen = true;
            clear(connectTimer);
            onActivity?.("waiting-first-response");
            firstResponseTimer = schedule(
              "first-response-timeout",
              ROUTE_ATTEMPT_BOUNDS.firstResponseMs,
            );
          },
          onProgress: () => {
            if (controller.signal.aborted) return;
            clear(connectTimer);
            clear(firstResponseTimer);
            clear(idleTimer);
            idleTimer = schedule("idle-timeout", ROUTE_ATTEMPT_BOUNDS.idleMs);
            onActivity?.("running");
          },
        }),
      );
      // A timed-out Provider may ignore its AbortSignal and settle later. The
      // broker owns the bounded result, so absorb that late settlement.
      void execution.catch(() => undefined);
      const aborted = new Promise<never>((_resolve, reject) => {
        const onAbort = () =>
          reject(
            controller.signal.reason instanceof Error
              ? controller.signal.reason
              : new RouteAttemptStop("cancelled"),
          );
        removeAbortRace = () =>
          controller.signal.removeEventListener("abort", onAbort);
        if (controller.signal.aborted) onAbort();
        else
          controller.signal.addEventListener("abort", onAbort, { once: true });
      });
      return await Promise.race([execution, aborted]);
    } finally {
      removeAbortRace();
      for (const timer of timers) clearTimeout(timer);
      parentSignal?.removeEventListener("abort", onParentAbort);
    }
  }

  async run<T>(input: {
    operationId: string;
    role: WorkerRole;
    requirements?: RouteRequirements;
    signal?: AbortSignal;
    onActivity?: (event: BrokerActivityUpdate) => void;
    classifyResult?: (value: T) => string | undefined;
    execute: (context: RouteAttemptContext) => Promise<T>;
  }): Promise<
    | { ok: true; routeId: string; value: T; attempts: BrokerAttemptEvidence[] }
    | {
        ok: false;
        state: "paused" | "cancelled";
        code: string;
        attempts: BrokerAttemptEvidence[];
      }
  > {
    if (
      typeof input.operationId !== "string" ||
      input.operationId.length === 0 ||
      !isRole(input.role) ||
      !validRequirements(input.requirements)
    ) {
      return {
        ok: false,
        state: "paused",
        code: "broker-input-invalid",
        attempts: [],
      };
    }
    const attempted = new Set<string>();
    const evidence: BrokerAttemptEvidence[] = [];
    const capableRouteCount = this.#policy.roles[input.role].filter(
      (routeId) => {
        const route = this.#policy.routes[routeId];
        return route
          ? capable(route, input.role, input.requirements ?? {})
          : false;
      },
    ).length;
    const maxAttempts = Math.max(
      1,
      capableRouteCount > 1
        ? capableRouteCount
        : ROUTE_ATTEMPT_BOUNDS.attemptsPerRoute,
    );
    for (;;) {
      const selection = this.select({
        role: input.role,
        ...(input.requirements ?? {}),
        exclude: [...attempted],
      });
      if (!selection.ok) {
        return {
          ok: false,
          state: "paused",
          code: evidence.at(-1)?.code ?? selection.code,
          attempts: evidence,
        };
      }
      const routeId = selection.route.id;
      attempted.add(routeId);
      if (selection.health === "half-open") {
        this.#setRouteHealth(routeId, {
          ...this.#routeHealth(routeId),
          state: "half-open",
          probeInFlight: true,
          probeExpiresAt: this.#now() + ROUTE_ATTEMPT_BOUNDS.totalMs,
        });
      }
      const routeAttempt = evidence.filter(
        (item) => item.routeId === routeId,
      ).length;
      const attempt = evidence.length + 1;
      emitBrokerActivity(input.onActivity, {
        state: "connecting",
        attempt,
        maxAttempts,
        wait: "connection",
      });
      try {
        const value = await this.#attempt(
          selection.route,
          input.execute,
          input.signal,
          (state) =>
            emitBrokerActivity(input.onActivity, {
              state,
              attempt,
              maxAttempts,
              wait:
                state === "waiting-first-response"
                  ? "first-response"
                  : "worker-progress",
            }),
        );
        const semanticCode = input.classifyResult?.(value);
        if (semanticCode) {
          evidence.push({ routeId, code: semanticCode });
          const routeHasRetry =
            capableRouteCount === 1 &&
            routeAttempt + 1 < ROUTE_ATTEMPT_BOUNDS.attemptsPerRoute;
          if (routeHasRetry) {
            this.#releaseHalfOpenProbeForRetry(routeId, semanticCode);
            attempted.delete(routeId);
          } else {
            this.markFailure(routeId, semanticCode);
          }
          if (attempt < maxAttempts) {
            emitBrokerActivity(input.onActivity, {
              state: "retrying",
              attempt,
              maxAttempts,
              code: semanticCode,
              wait: "bounded-policy",
            });
            continue;
          }
          if (routeHasRetry) this.markFailure(routeId, semanticCode);
          return { ok: true, routeId, value, attempts: evidence };
        }
        this.markSuccess(routeId);
        return { ok: true, routeId, value, attempts: evidence };
      } catch (error) {
        const code = safeFailureCode(error);
        evidence.push({ routeId, code });
        if (code === "cancelled") {
          const health = this.#routeHealth(routeId);
          if (health.state === "half-open" && health.probeInFlight) {
            this.#setRouteHealth(routeId, {
              state: "open",
              retryAt: this.#now(),
              ...(health.lastCode ? { lastCode: health.lastCode } : {}),
            });
          }
          return { ok: false, state: "cancelled", code, attempts: evidence };
        }
        const routeHasRetry =
          capableRouteCount === 1 &&
          routeAttempt + 1 < ROUTE_ATTEMPT_BOUNDS.attemptsPerRoute;
        if (routeHasRetry) {
          this.#releaseHalfOpenProbeForRetry(routeId, code);
          attempted.delete(routeId);
        } else {
          this.markFailure(routeId, code);
        }
        if (attempt < maxAttempts) {
          emitBrokerActivity(input.onActivity, {
            state: "retrying",
            attempt,
            maxAttempts,
            code,
            wait: "bounded-policy",
          });
        } else if (routeHasRetry) {
          this.markFailure(routeId, code);
        }
      }
    }
  }

  rebind(input: Record<string, unknown>):
    | { ok: true; runId: string; route: WorkerRoutePolicy }
    | {
        ok: false;
        code:
          | "approval-boundary"
          | "route-not-declared"
          | "route-capability-insufficient";
      } {
    const allowed = new Set(["runId", "role", "routeId", "requirements"]);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      return { ok: false, code: "approval-boundary" };
    }
    if (
      typeof input.runId !== "string" ||
      input.runId.length === 0 ||
      !isRole(input.role) ||
      typeof input.routeId !== "string" ||
      !validRequirements(input.requirements)
    ) {
      return { ok: false, code: "route-capability-insufficient" };
    }
    const selection = this.select({
      role: input.role,
      ...(input.requirements ?? {}),
      routeId: input.routeId,
    });
    if (!selection.ok) {
      return {
        ok: false,
        code:
          selection.code === "route-not-declared"
            ? "route-not-declared"
            : "route-capability-insufficient",
      };
    }
    return {
      ok: true,
      runId: input.runId,
      route: structuredClone(selection.route),
    };
  }

  status(): Record<string, unknown> {
    const health = Object.fromEntries(
      Object.keys(this.#policy.routes).map((routeId) => {
        const value = this.#routeHealth(routeId);
        return [
          routeId,
          {
            state: value.state,
            ...(value.retryAt === undefined ? {} : { retryAt: value.retryAt }),
          },
        ];
      }),
    );
    return inspectRoutePolicy(
      {
        ok: true,
        source: { kind: "project", path: "<injected>" },
        policy: this.#policy,
      },
      health,
    );
  }
}

/**
 * Adds run/role defaults and independent task bindings to route attempts.
 * All bound brokers consult the same health store.
 * Attempt credentials and provider objects remain disposable and are never
 * retained by this facade.
 */
export class RunWorkerBroker {
  #policy: RoutePolicy;
  readonly #options: WorkerBrokerOptions;
  #defaultBroker: WorkerBroker;
  readonly #bindings = new Map<
    string,
    { routeId: string; fingerprint: string }
  >();
  readonly #boundBrokers = new Map<string, WorkerBroker>();

  constructor(policy: RoutePolicy, options: WorkerBrokerOptions = {}) {
    this.#policy = structuredClone(policy);
    this.#options = {
      ...options,
      healthStore: options.healthStore ?? new MemoryRouteHealthStore(),
    };
    this.#defaultBroker = new WorkerBroker(this.#policy, this.#options);
  }

  #bindingKey(runId: string, role: WorkerRole, taskId?: string): string {
    return JSON.stringify([runId, role, taskId ?? null]);
  }

  #brokerFor(runId: string, role: WorkerRole, taskId?: string): WorkerBroker {
    const binding =
      this.#bindings.get(this.#bindingKey(runId, role, taskId)) ??
      this.#bindings.get(this.#bindingKey(runId, role));
    if (!binding) return this.#defaultBroker;
    const routeId = binding.routeId;
    const key = `${role}\0${routeId}`;
    const existing = this.#boundBrokers.get(key);
    if (existing) return existing;
    const ordered = [
      routeId,
      ...this.#policy.roles[role].filter((candidate) => candidate !== routeId),
    ];
    const policy: RoutePolicy = {
      ...structuredClone(this.#policy),
      roles: Object.freeze({
        ...structuredClone(this.#policy.roles),
        [role]: Object.freeze(ordered),
      }),
    };
    const broker = new WorkerBroker(policy, this.#options);
    this.#boundBrokers.set(key, broker);
    return broker;
  }

  async run<T>(input: RunWorkerAttemptInput<T>) {
    if (
      typeof input.runId !== "string" ||
      input.runId.length === 0 ||
      (input.taskId !== undefined &&
        (typeof input.taskId !== "string" || input.taskId.length === 0)) ||
      typeof input.operationId !== "string" ||
      input.operationId.length === 0
    ) {
      return {
        ok: false as const,
        state: "paused" as const,
        code: "broker-input-invalid",
        attempts: [],
      };
    }
    const result = await this.#brokerFor(
      input.runId,
      input.role,
      input.taskId,
    ).run({
      operationId: input.operationId,
      role: input.role,
      ...(input.requirements ? { requirements: input.requirements } : {}),
      ...(input.signal ? { signal: input.signal } : {}),
      ...(input.onActivity ? { onActivity: input.onActivity } : {}),
      ...(input.classifyResult ? { classifyResult: input.classifyResult } : {}),
      execute: input.execute,
    });
    if (result.ok) {
      const route = this.#policy.routes[result.routeId];
      if (!route) throw new Error("broker-route-result-invalid");
      this.#bindings.set(
        this.#bindingKey(input.runId, input.role, input.taskId),
        {
          routeId: route.id,
          fingerprint: route.fingerprint,
        },
      );
    }
    return result;
  }

  rebind(input: {
    runId: string;
    taskId?: string;
    role: WorkerRole;
    routeId: string;
    requirements?: RouteRequirements;
  }) {
    const { taskId, ...routeInput } = input;
    if (
      taskId !== undefined &&
      (typeof taskId !== "string" || taskId.length === 0)
    ) {
      return { ok: false as const, code: "approval-boundary" as const };
    }
    const result = this.#defaultBroker.rebind(routeInput);
    if (result.ok) {
      this.#bindings.set(
        this.#bindingKey(input.runId, input.role, input.taskId),
        {
          routeId: result.route.id,
          fingerprint: result.route.fingerprint,
        },
      );
    }
    return result;
  }

  resumeBinding(input: {
    runId: string;
    taskId?: string;
    role: WorkerRole;
    routeId: string;
    expectedFingerprint?: string;
    requirements?: RouteRequirements;
  }) {
    const binding = this.#bindings.get(
      this.#bindingKey(input.runId, input.role, input.taskId),
    );
    const route = this.#policy.routes[input.routeId];
    if (!binding) {
      if (
        !route ||
        input.expectedFingerprint === undefined ||
        route.fingerprint !== input.expectedFingerprint
      ) {
        return { ok: false as const, code: "route-rebind-required" as const };
      }
      return this.rebind({
        runId: input.runId,
        ...(input.taskId === undefined ? {} : { taskId: input.taskId }),
        role: input.role,
        routeId: input.routeId,
        ...(input.requirements ? { requirements: input.requirements } : {}),
      });
    }
    if (
      binding.routeId !== input.routeId ||
      !route ||
      route.fingerprint !== binding.fingerprint ||
      (input.expectedFingerprint !== undefined &&
        binding.fingerprint !== input.expectedFingerprint)
    ) {
      return { ok: false as const, code: "route-rebind-required" as const };
    }
    return {
      ok: true as const,
      runId: input.runId,
      route: structuredClone(route),
    };
  }

  updatePolicy(policy: RoutePolicy): void {
    this.#policy = structuredClone(policy);
    this.#defaultBroker = new WorkerBroker(this.#policy, this.#options);
    this.#boundBrokers.clear();
  }

  binding(
    runId: string,
    role: WorkerRole,
    taskId?: string,
  ): string | undefined {
    return this.#bindings.get(this.#bindingKey(runId, role, taskId))?.routeId;
  }

  status(): Record<string, unknown> {
    return this.#defaultBroker.status();
  }
}
