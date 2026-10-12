# Lightweight runner: resolved auth is publicly transferable

## Decision

Use one native SDK child, not CLI startup or an in-process fallback. The prior `lightweight-host-design.md` claim that ephemeral auth requires private ModelRuntime access is incorrect; retain that report as history. Public `ctx.modelRegistry.getApiKeyAndHeaders(ctx.model)` supplies `{ok, apiKey?, headers?, baseUrl?, env?}`. No private cast, new dependency or Trellis code.

Inspected installed **0.84.3** (global docs are **1.1.0**): full SDK/custom-provider/security/models/providers/settings docs and relevant SDK/provider examples. Owners under installed `@earendil-works/`: coding-agent SDK/model-registry/runtime/provider-composer/agent-session; ai models/auth/API and stream types; agent-core Agent. Receipt hashes selected source files.

## Smallest construction and an important exception

1. Resolve auth in the parent immediately before launch. Refuse failed auth/missing model. Send bounded model/auth/prompt JSON through anonymous stdin then EOF, never secret argv/environment/files/logs. Preserve provider/id/api, `auth.baseUrl ?? model.baseUrl`, compat/sampling/thinking/limits; remove configured model headers because auth already contains their resolved values.
2. Create ModelRuntime with `credentials:new InMemoryCredentialStore()`, `modelsStore:new InMemoryModelsStore()`, `modelsPath:null`, `refreshOnCreate:false`, `allowModelNetwork:false`. Pass explicit cwd/agentDir, `SettingsManager.inMemory`, `SessionManager.inMemory(cwd)`, fixed tools and a genuinely empty ResourceLoader to `createAgentSession`. Disable automatic retry/compaction; set `PI_OFFLINE=1`. No CLI/default discovery or credential files. Offline prevents rg/fd downloads; missing helpers remain unavailable.
3. **Wire-proven ordinary-key route:** `registerProvider(provider,{api,baseUrl,models:[definitionWithoutHeaders]})`, then `setRuntimeApiKey(provider,auth.apiKey)`. Capture `session.agent.streamFunction`; wrap it with `{...options,apiKey:auth.apiKey,headers:auth.headers,env:auth.env}`. Preserve options/signal; original SDK closure calls `modelRuntime.streamSimple`.

Do not stop at step 3 for all providers: `openai-codex` is OAuth-only in 0.84.3. Registering plain models plus a runtime key leaves its API-key resolver absent; SDK auth preflight can refuse. A headers-only unknown provider also lacks a configured resolver. Neither needs private access.

**Recommended uniform implementation:** replace the selected provider via public `registerNativeProvider(createProvider(...))`, using the exact model and the official adapter selected from a fixed supported API allowlist (`@earendil-works/pi-ai/api/<api>`). Supply only a local snapshot resolver:

```ts
auth: { apiKey: {
  name: "Resolved parent request",
  resolve: async () => ({
    auth: { apiKey: a.apiKey, headers: a.headers, baseUrl: a.baseUrl },
    env: a.env,
  }),
} }
```

This child-owned value adapter shares raw auth between preflight and requests, avoiding OAuth-store expectations, runtime-key installation and stream wrapping. `createProvider` takes `id`, `models`, `api`, `auth`; no config-value headers. Source-supported, **not separately executed**; the ordinary-key wrapper is the wire proof. Implement one route, not fallback runners.

## Exact semantics and limits

`SimpleStreamOptions` includes literal apiKey, `ProviderHeaders = Record<string,string|null>` (null suppresses headers), and provider-scoped `env`; baseUrl belongs to Model/auth, not a stream option. ModelRuntime/Models merges request overrides last and applies auth.baseUrl. Neither raw option headers nor native resolver auth uses command interpolation. Config apiKey/headers interpret `!` commands and `$` interpolation: NEVER put resolved values there. `setRuntimeApiKey` stores a literal memory override.

Keep provider identity: standard adapters have provider-specific behavior. Do not silently replace function-defined custom streams with a similarly named standard API. Inspect public registered-provider config/native-provider accessors; unsupported/unknown behavior must refuse explicitly. Ambient-file authentication is not made portable by an empty envelope. OpenAI completions supports headers-only Authorization/cf-aig-authorization; arbitrary headers alone do not authenticate it.

Parent resolution normally refreshes OAuth using the parent's original store; child gets only current request auth, no refresh tokens. Public result has no expiry: a bounded 20-minute run is not guaranteed token validity. Stop on expiry/auth failure; resolve again for a new explicit run. In-process registry.complete needs stream adaptation/preflight integration and loses process containment; not simpler.

## One synthetic probe, not workflow qualification

Private receipt: `/tmp/cadence-lightweight-auth-o6WlPt/receipt.json`
SHA256: `ac1fb2ba4a27bea6e85295fb84bbc713c155856d372c4cbb41653f94cad5f872`.
Scripts remain beside it (directory0700, receipt0600).

Node26.7.0/Linux x64/Pi0.84.3: fabricated parent runtime key and configured headers resolved through actual public ModelRegistry; native Node child received615 bytes via pipe. Two loopback OpenAI SSE requests matched exact endpoint/model/Bearer and provider/model headers, including literal leading `!` and `$`. One SDK write created only `fixture.txt`; final text `WIRE_OK`, stopReason `stop`,23 events,350 stdout bytes,0 stderr, exit0. Empty HOME/agent directory; no auth/settings/models/session files. Child guards saw zero discovery/state violations/subprocesses and two loopback connections. No real credentials/provider/install/CLI startup. Env/baseUrl override and OAuth/header-only variants remain source analysis, not measured lanes.

Prompt, abort/dispose, original child close and server close awaited; no runner remained. Bounds were fixture-specific. Product cancellation/redaction/bounds/platform/UI/workflow safety remain unqualified. No product/spec/test/map/dependency/status/Git changes.
