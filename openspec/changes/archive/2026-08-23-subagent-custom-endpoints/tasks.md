## 1. Endpoint configuration parsing and resolution

- [x] 1.1 Implement the endpoint resolver module with whole-layer three-tier resolution, reusing the shared env parser through a typed declaration
  - Task ID / dependencies: T1.1 / none
  - Requirement + scenario: `openspec/specs/subagent-endpoint-config/spec.md#Per-role endpoint configuration key surface/Project file wins as a whole`, `.../Empty value is absent`, `.../Role key mapping`; `openspec/specs/subagent-endpoint-config/spec.md#Three-tier whole-layer resolution/Role layer commits`, `.../Global layer commits when role absent`, `.../No committed layer inherits parent identity`, `.../Committed layer does not merge missing values`, `.../Absent bounds use internal defaults`
  - Verification type: property
  - Red command: `bun run test -- test/subagent-endpoint.property.test.ts` — expected failure: module resolution error for `src/subagent-endpoint.ts` (module does not exist yet)
  - Green expected behavior: resolution is deterministic and idempotent; a layer commits when any of its six keys is non-empty; committed layers never merge values across layers; project file wins over user file as a whole; empty values are absent; role key mapping converts hyphens to underscores; absent bounds resolve to context window 256000, max output tokens 128000, reasoning-capable identity; no configuration resolves the inherited kind
  - Affected-suite verification: `bun run test -- test/subagent-endpoint.property.test.ts && bun run check`
  - Target scope/files: `src/subagent-endpoint.ts` (new), `skills/_shared/load-config.d.mts` (new), `test/subagent-endpoint.property.test.ts` (new)

- [x] 1.2 Add fail-closed validation to the resolver for incomplete layers, invalid URLs, unknown dialects, and invalid bounds
  - Task ID / dependencies: T1.2 / T1.1
  - Requirement + scenario: `openspec/specs/subagent-endpoint-config/spec.md#Fail-closed configuration errors/Partial layer fails dispatch`, `.../Invalid URL fails closed`, `.../Unknown dialect fails closed`, `.../Invalid bounds fail closed`
  - Verification type: property
  - Red command: `bun run test -- test/subagent-endpoint.property.test.ts` — expected failure: assertions for invalid-resolution results fail because the resolver does not yet classify partial layers, non-http(s) URLs, unknown dialect values, or non-positive-integer bounds as invalid with offending key names
  - Green expected behavior: a committed layer missing MODEL or API_URL, a non-http(s) URL, a dialect outside the three supported values, and a zero/negative/non-integer bound each resolve to the invalid kind naming only offending keys; identical configuration state always yields the identical result
  - Affected-suite verification: `bun run test -- test/subagent-endpoint.property.test.ts && bun run check`
  - Target scope/files: `src/subagent-endpoint.ts`, `test/subagent-endpoint.property.test.ts`

## 2. Typed configuration failure code

- [x] 2.1 Extend the closed environment failure codes with the subagent endpoint configuration code and verify its terminal mapping
  - Task ID / dependencies: T2.1 / T1.2
  - Requirement + scenario: `openspec/specs/subagent-endpoint-config/spec.md#Fail-closed configuration errors/Configuration error is not retried`
  - Verification type: example
  - Red command: `bun run test -- test/subagent-endpoint.property.test.ts` — expected failure: assertions that `invalid-subagent-endpoint` is a member of the closed environment code set and maps to a terminal, non-retryable failure fail because the code does not exist yet
  - Green expected behavior: the closed code set contains `invalid-subagent-endpoint`; the failure kind remains environment so existing terminal mapping applies without any new ChildFailure kind
  - Affected-suite verification: `bun run test -- test/subagent-endpoint.property.test.ts && bun run check`
  - Target scope/files: `src/contracts.ts`, `test/subagent-endpoint.property.test.ts`

## 3. Custom phase runtime

- [x] 3.1 Implement the custom phase runtime that builds the standalone endpoint provider and verify real transport against a local HTTP server
  - Task ID / dependencies: T3.1 / T1.1
  - Requirement + scenario: `openspec/specs/subagent-endpoint-config/spec.md#Custom endpoint request behavior/Request reaches configured endpoint`, `.../Payload bridge is bypassed`, `.../Optional API key endpoint`, `.../Default dialect`, `.../Configured bounds shape the child model`; `openspec/specs/subagent-endpoint-config/spec.md#Endpoint key privacy/Key absent from observable output`; `openspec/specs/private-agent-orchestration/spec.md#Ephemeral bounded runtime lifecycle/Child session is created` (custom branch)
  - Verification type: E2E
  - Red command: `bun run test -- test/subagent-endpoint.integration.test.ts` — expected failure: module resolution error for the `customPhaseRuntime` export from `src/parent-provider.ts`
  - Green expected behavior: a child session under a committed configuration completes a structural submit against a local HTTP server; the recorded request hits the configured URL with the configured model id and bearer credential; the configured MAX_TOKENS value shapes the request payload; a keyless configuration sends no API-key credential; an absent dialect sends an `openai-completions` request; dispatch succeeds after the parent payload bridge is cleared; the configured key value appears in no recorded observable output; child session creation keeps empty resource discovery, in-memory session and settings, and disabled Provider retry
  - Affected-suite verification: `bun run test -- test/subagent-endpoint.integration.test.ts && bun run check`
  - Target scope/files: `src/parent-provider.ts`, `test/subagent-endpoint.integration.test.ts` (new)

## 4. Runtime wiring

- [x] 4.1 Wire dispatch to resolve the endpoint identity, fail closed before any child launch, and keep the inherited path unchanged
  - Task ID / dependencies: T4.1 / T3.1, T2.1
  - Requirement + scenario: `openspec/specs/subagent-endpoint-config/spec.md#Fail-closed configuration errors/Partial layer fails dispatch`, `.../Configuration error is not retried`; `openspec/specs/subagent-endpoint-config/spec.md#Endpoint key privacy/Error names keys not values`; `openspec/specs/subagent-endpoint-config/spec.md#Three-tier whole-layer resolution/No committed layer inherits parent identity`
  - Verification type: integration
  - Red command: `bun run test -- test/runtime-subagent-endpoint.integration.test.ts` — expected failure: dispatch ignores endpoint configuration, so partial-config dispatches proceed to a child launch or inherit the parent identity instead of returning the typed configuration error
  - Green expected behavior: a committed-but-incomplete configuration fails the dispatch immediately with the typed configuration error before any child launch, consumes no transport-shared launch, and performs no retry; the error text names offending key names and contains no configured values; with no configuration the dispatch inherits the parent identity exactly as before
  - Regression scenarios: every unchanged scenario under `openspec/specs/private-agent-orchestration/spec.md#Ephemeral bounded runtime lifecycle` — Task identity is pinned; Task identity changes; Task reaches a terminal state; AGENTS checkpoint correction is bounded; AGENTS checkpoint attempts are exhausted; Parent payload compatibility rewrites a child request; Parent payload compatibility cannot complete; Pi contains an internal parent handler error; OpenAI Responses child request has no optional output cap; Runtime bound is reached; Phase times out; Dispatcher returns nested usage; Pi lifecycle ends the stage; Filesystem is inspected after delegation; Multiple Subagents are active; Activity display overflows; Invalid request is rejected — remains verified by the pre-existing suite via `bun run verify`
  - Affected-suite verification: `bun run test -- test/runtime-subagent-endpoint.integration.test.ts && bun run check`
  - Target scope/files: `src/runtime.ts`, `src/parent-provider.ts`, `test/runtime-subagent-endpoint.integration.test.ts` (new)

- [x] 4.2 Pin the resolved identity at Implement task admission and keep it stable across phase launches
  - Task ID / dependencies: T4.2 / T4.1
  - Requirement + scenario: `openspec/specs/subagent-endpoint-config/spec.md#Three-tier whole-layer resolution/Admitted task identity is stable`; `openspec/specs/private-agent-orchestration/spec.md#Ephemeral bounded runtime lifecycle/Child session is created` (inherited branch)
  - Verification type: integration
  - Red command: `bun run test -- test/runtime-subagent-endpoint.integration.test.ts` — expected failure: the stability assertion fails because a configuration edit between phase launches leaks into a later launch (no pinned identity is stored yet)
  - Green expected behavior: an Implement task admits with the identity resolved at admission; a later configuration file edit does not change any phase launch of the admitted task; inherited-identity task launches remain byte-for-byte compatible with the existing child-session creation scenario
  - Affected-suite verification: `bun run test -- test/runtime-subagent-endpoint.integration.test.ts && bun run check`
  - Target scope/files: `src/runtime.ts`, `test/runtime-subagent-endpoint.integration.test.ts`

## 5. Documentation and distribution pins

- [x] 5.1 Document the key surface and synchronize the pinned distribution member set
  - Task ID / dependencies: T5.1 / T1.1
  - Requirement + scenario: `openspec/specs/subagent-endpoint-config/spec.md#Per-role endpoint configuration key surface/Role key mapping` (documented surface); distribution member pinning is repository convention verified by the distribution suite
  - Verification type: example
  - Red command: `bun run test -- test/distribution.test.mjs` — expected failure: the pinned member-set assertion fails because the new `load-config.d.mts` member is absent from the expected set
  - Green expected behavior: `config/.env.example` documents all six global keys and the per-role key pattern with defaults and fail-closed semantics; `test/distribution.test.mjs` and `scripts/pack-check.mjs` expected member sets include the new declaration file; the full verification suite passes
  - Affected-suite verification: `bun run verify`
  - Target scope/files: `config/.env.example`, `test/distribution.test.mjs`, `scripts/pack-check.mjs`
