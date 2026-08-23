## Why

Cadence Subagents are hard-bound to the parent session's selected model, phase-local parent authentication, and the parent payload-transform chain (`src/parent-provider.ts` enforces child model key ≡ parent model key). Users cannot route Subagent work to a cheaper, faster, or self-hosted endpoint, which blocks the common split of expensive parent reasoning from high-volume child execution.

## What Changes

- Add per-role custom endpoint configuration for all four closed Subagent roles (`design-explorer`, `contract-reviewer`, `implementation-worker`, `diagnosis-worker`): custom API URL, optional API key, model id, optional API dialect (default `openai-completions`; selectable `openai-responses`, `anthropic-messages`), and optional context-window / max-output-token bounds (internal defaults: context window 256000, max output tokens 128000, reasoning-capable identity).
- Configuration keys follow the existing cadence env-file convention: global layer `SUBAGENT_API_URL` / `SUBAGENT_API_KEY` / `SUBAGENT_MODEL` / `SUBAGENT_API` / `SUBAGENT_CONTEXT_WINDOW` / `SUBAGENT_MAX_TOKENS`, plus per-role layer `SUBAGENT_<ROLE>_*` (role hyphens become underscores). Project file `<project>/.pi/cadence/.env` wins over user file `~/.pi/agent/cadence/.env` as a whole file; no merging or interpolation.
- Three-tier resolution with whole-layer semantics: role layer if any of its keys is non-empty, else global layer if any of its keys is non-empty, else today's behavior unchanged (inherited parent model, fresh phase-local parent auth, capture-required payload composition).
- A committed layer missing MODEL or API_URL, a non-http(s) URL, or an unknown dialect value fails the dispatch immediately with a typed configuration error: no retry, no transport-shared launch consumption, error text names offending keys and never values.
- When a custom endpoint is active for a role, that role's child requests bypass the parent payload-transform chain (the bridge capture exists only for the parent model key); all other workflow behavior is unchanged.
- API keys never appear in dispatch results, activity display, error messages, or logs.
- Document the key surface in `config/.env.example`.

## Capabilities

### New Capabilities

- `subagent-endpoint-config`: Per-role custom endpoint configuration contract for Cadence Subagents: key surface, three-tier whole-layer resolution, enable conditions, fail-closed configuration errors, and key privacy.

### Modified Capabilities

- `private-agent-orchestration`: `Ephemeral bounded runtime lifecycle` currently requires every child Provider request to reuse the selected parent Provider's stream behavior and parent-session payload-transform callback with a pinned parent Provider/model identity. This relaxes to the resolved per-role identity: inherited parent identity (unchanged behavior) or a configured custom endpoint identity that bypasses the parent payload chain; all other lifecycle bounds remain.

## Impact

- Code: `src/parent-provider.ts` (phase runtime resolution gains a custom-endpoint branch), `src/runtime.ts` (`dispatchChild` receives the resolved identity and surfaces typed configuration failures), new configuration resolution module in `src/` that reuses `parseEnvFile` from `skills/_shared/load-config.mjs` via a `load-config.d.mts` type declaration, typed configuration failure code in `src/contracts.ts`, and the pinned distribution member set gains the declaration file.
- Configuration: `config/.env.example` documents the new keys.
- Specs: one new capability spec, one modified requirement in `private-agent-orchestration`.
- No new dependencies; no parent-session model selection change; no per-phase granularity.
