# Presentation Boundary Types

## Shared contracts

`src/task-types.ts` owns `TaskKind`, `TaskPhase`, `TaskRecord`, `CheckDefinition`, `CheckRecord`, `RunResult` and `ChangeView`.
Import those types and shared decoders; do not cast arbitrary JSON in the shell or resurrect retired TypeBox packet/tool schemas.
Cadence registers no model-callable workflow tool, even though host peer metadata still includes TypeBox.
`CurrentChoice` belongs to the controller, `WorkerRequest`/`RequestAuth` to the process owner, and `CheckoutLock` to storage.
The [workflow contract](../backend/lightweight-workflow-guidelines.md) is the single detailed API/field/environment/bounds reference.

```ts
// src/task-types.ts: decode at the data boundary, then project in the shell.
decodeCheck(value: unknown): CheckDefinition;
decodeTask(value: unknown): TaskRecord;
// src/task-controller.ts: selected record identity is not future-code approval.
interface CurrentChoice {
  generation: number;
  id: string;
  revision: number;
  identity: string;
}
```

`decodeTask` checks schema, UUID-v4 ID, positive safe revision, known kind/phase, bounded UTF-8 strings, check/activity/review fields and top-level key allowlist.
Do not claim all nested objects have closed key sets.
`TaskStore.loadSnapshot()` adds raw-byte identity; `save()` checks revision and expected identity before replacing one record.
No canonical approval hash, revision-only permission or trusted model-echoed identity replaces this observed conflict check.

## Executable command versus display text

`decodeCheck` requires nonblank name (128 bytes), command (4096 bytes) and integer timeout 100–1200000 ms. Invisible controls/bidi refuse; command newline/tab is allowed but name newline/tab is not.
`TaskStore.checks()` validates `cadence-assistant-checks/1`, at most 32 definitions, duplicate exact names and reserved `Manual command`.
Missing config means no definitions, never a passing check.
The shell's manual command has name `Manual` and timeout 120000 ms.

Approved commands are shell input, not a token-safe command DSL.
Validate and show exact command/cwd/timeout before native confirmation; never silently sanitize the command and execute different bytes.
Use `diagnosticText` for untrusted display/result/log text, not for filesystem identity or freshness hashing.
Quote operational cwd for presentation without changing spaces/tabs/newlines in the actual path.

## Host and auth types

Use installed `ExtensionAPI`, `ExtensionContext` and `ExtensionCommandContext` declarations in the shell, and public Pi TUI helpers for rendering.
The controller has no Pi imports; serializable request data, not host callbacks or registry internals, crosses stdin to the SDK child.
`modelRegistry.getApiKeyAndHeaders(model)` must resolve the exact current model or refuse.
Null header values retain suppression semantics, resolved base URL overrides the model URL, and provider-scoped env stays in the auth resolver.
No `!`/`$` interpolation of already-resolved auth, credential files/argv/logs, CLI startup migrations, model/API fallback or function-transport substitution is permitted.
SDK environment is narrow; explicitly approved parent checks inherit ordinary project environment, never injected resolved SDK auth.

## Independent research config is a different boundary

`skills/_shared/load-config.mjs` owns `selectConfigPath`, `loadConfig` and `parseEnvFile`; its `.d.mts` declares the TypeScript interface.
Select a whole project-before-user file, parse explicit name/value syntax and bound nonblocking regular-file reads to 64 KiB.
Malformed/oversized/special/dangling selected paths refuse without defaults; absent configuration permits only the documented independent skill defaults.
Do not claim its regular-file loader rejects all symlinks like the task-store reader does.
It supplies no workflow permission and no worker model selection/auth fallback.

## Assertions and mistakes

`test/lightweight-store-controller.test.ts` covers record/config rejection and preservation; `test/lightweight-shell.test.ts` covers current host/model/record checks and readonly menu/tool selection.
`test/lightweight-sdk.test.ts` verifies literal auth/baseURL/null headers/provider env using actual SDK loopback requests, not every allowlisted API or paid service.
`test/config-context7.test.mjs` and `test/grok-search.test.mjs` exercise the independent configuration boundary.
Wrong: duplicate JSON field casts in UI, trim a path, or treat a stored `passed` label as present freshness.
Correct: decode with the owning module, preserve operational bytes, and derive display from current controller observations.
