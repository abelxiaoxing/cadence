## Context

See proposal.md — Why. Today every Subagent launch runs `runtimeFromContext` (src/parent-provider.ts), which hard-binds the child to the parent session's selected model key (`sameSelectedModel` / `captureIsReady`), resolves fresh phase-local parent auth through `ctx.modelRegistry.getApiKeyAndHeaders`, and composes every request through the `ParentPayloadBridge` capture for that parent model key. `dispatchChild` (src/runtime.ts) is the single launch path for all four closed roles.

## Goals / Non-Goals

Goals (design-level):
- Resolve a per-role endpoint identity from the cadence env file and build a standalone child provider/runtime for it, leaving the inherited path byte-for-byte unchanged.
- Keep configuration errors structurally incapable of consuming launch budget or retrying.

Non-goals: no models.json / dynamic catalog integration, no OAuth, no per-phase granularity, no skills runtime migration.

## Decisions

**D-T1 Custom model identity and defaults.** The custom child `Model<string>` is constructed with the configured model id, `baseUrl` = configured URL, `provider` = `abel-subagent`, configured dialect `api`, configured or default bounds. Internal defaults when `CONTEXT_WINDOW` / `MAX_TOKENS` are absent: context window 256000, max output tokens 128000, `reasoning: true`; `cost` zeros, `input: ["text"]`. Alternatives: expose bounds-only defaults as extra config keys (approved) while keeping `reasoning` fixed metadata — a reasoning flag key would add surface without observable benefit because child sessions are created with `thinkingLevel: "off"` either way. Declaring smaller-than-reality bounds risks truncation; larger bounds fail at the endpoint as ordinary transport failures under existing bounded retry semantics, so generous defaults are the safe direction.

**D-T2 Configuration parsing reuse (Option C).** The new `src/subagent-endpoint.ts` imports `parseEnvFile` from `skills/_shared/load-config.mjs` with a new `skills/_shared/load-config.d.mts` type declaration, and implements its own optional file lookup (project `<cwd>/.pi/cadence/.env` wins over user `~/.pi/agent/cadence/.env` as a whole file; missing file = empty values). Alternatives: (a) duplicate the parser in TS — rejected: permanent semantic duplication plus equivalence-fixture maintenance; (b) convert skills to TS — rejected for this change: skill CLIs are invoked with `node <file>.mjs` under `engines: node>=22` with no build step, so a TS migration changes the shipped runtime contract and belongs in a separate change.

**D-T3 Custom phase runtime.** `customPhaseRuntime(endpoint, signal)` in src/parent-provider.ts builds the provider via pi-ai `createProvider({ id: "abel-subagent", baseUrl, auth: apiKey resolve closure over the configured key, models: [customModel], api: compat dialect dispatcher })`; the model's `api` selects `openai-completions`, `openai-responses`, or `anthropic-messages`. The explicit compat entry is package-loader-safe under Pi's jiti virtual modules and dispatches to the same built-in dialect implementations. The runtime reuses `runtimeForProvider` (fresh `ModelRuntime`, `InMemoryCredentialStore`, `modelsPath: null`, `registerNativeProvider`); keyless auth uses nullable SDK headers to remove generated credentials, and the custom Responses callback removes `max_output_tokens` after any child payload transform. The provider streams directly; `ParentPayloadBridge` is never touched on this path, which is exactly the approved bypass. Alternatives: routing the custom model through the bridge under a synthetic capture — rejected: the capture delegate streams to the parent endpoint, which would send requests to the wrong endpoint.

**D-T4 Failure classification.** Configuration errors use a new closed code `invalid-subagent-endpoint` added to `ENVIRONMENT_FAILURE_CODES`. Evidence dispatch returns the typed environment failure before `runChildSession`; Implement admission stores the same sanitized failure as a terminal blocked TaskRecord before scheduling. Both paths perform no retry and consume no child launch, while Implement replays return the cached terminal fact with the current request identity. Alternatives: a new `ChildFailure` kind — rejected: closed union with `assertNever` switches across the runtime; a new code in the existing kind achieves the approved D8 semantics with the smallest contract change.

**D-T5 Resolution timing and pinning.** Evidence requests resolve at dispatch. Implement tasks resolve once at admission and pin the frozen identity on the TaskRecord; later phase launches reuse the pinned identity without re-reading the file, satisfying the spec's "Admitted task identity is stable" scenario. The envelope-level `workerIdentity(ctx.model)` pin check is unchanged — the custom identity is the child execution identity, not the envelope contract identity.

**D-T6 Error text and privacy.** Failure messages are built from offending key names only (plus the file path for parse-syntax errors); configured values — especially API keys — never enter dispatch results, activity display, errors, or logs. Integration tests assert the key value is absent from every observable output.

Mechanical records: env key mapping replaces role hyphens with underscores; layer commit = any of the six keys non-empty, empty = absent; URL must parse as http(s); malformed config file fails closed under the same code; provider id `abel-subagent`.

## Risks / Trade-offs

- [Endpoint capabilities unknown; declared bounds may exceed the real model window] → Overflow surfaces as ordinary transport failure under existing bounded semantics; one transport-shared retry remains available, then the task blocks typed.
- [Configuration edited mid-task] → Pinning freezes admitted tasks on their admission identity; new tasks see the new file. Documented behavior, not a bug.
- [src gains one import into skills/_shared] → Single named seam with a typed declaration; the shared module's contract (`parseEnvFile` is pure) is small and already tested by skill suites.
- [`reasoning: true` default for custom identities] → Only metadata; child thinking level stays `off`, so no behavior drift on the inherited path or existing scenarios.

## Migration Plan

Additive only: no configuration present means byte-for-byte today's behavior. Rollback = remove the keys (or revert); no persisted state is introduced.

## Open Questions

None.
