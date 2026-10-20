# pi-web-ui model authentication: reference route for Cadence

## Evidence and scope

Planning-only, source inspection; active task confirmed by `python3 ./.trellis/scripts/task.py current --source` (session source).
`U` = `/home/mirako/abel/pi-web-ui`, clean HEAD `e8bab487af208bc9a1ab60a821652323f598127f`; unprefixed application paths below are under U.
`C` = `/home/mirako/abel/cadence`; `SDK` / `AI` = C's `node_modules/@earendil-works/pi-coding-agent` / `pi-ai` (both **0.84.3**).
`G` = `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`; `GAI` = adjacent `pi-ai` (both **1.2.0**); `DOC` = G/docs.
Read U/AGENTS.md, complete architecture-core/env-vars docs, current task PRD and all four existing research reports.
Read complete G/README.md, DOC/{sdk,providers,models,configuration,security,settings,environment-variables,custom-provider}.md, examples/sdk/README.md and linked credential/full-control examples.
No user `~/.pi` files, real environment values, `.env`, or actual credentials were inspected.
No SDK imports executed, services launched, tests/install/provider/network calls, task start, or edits outside this report.
Context7 skill was read, not invoked because network/config access is prohibited.
These are source findings, not runtime/security qualification.

## Conclusion: two independent authentication layers

- **Browser → Cadence service:** the user's latest request selects reference-style `?token=…` owner access.
  U's `PI_WEB_TOKEN` is an application access secret, not a model API key or provider OAuth token (`server/index.ts:216-219`).
  Parent research owns its middleware/cookie/TLS analysis.
  This choice does not require a new account system.
- **Service → model provider:** standard U server startup reuses the normal Pi agent directory and credentials by default.
  Its UI data directory is separate, but its default model credentials are **not** a dedicated WebUI credential profile.
  A headless Cadence owner can adapt that same configuration route without requiring another provider account or login.
- **Planning recommendation:** propose reuse of the existing Pi model configuration, with SDK-managed refresh writes explicitly documented in the reviewed design.
  Do not force the earlier dedicated-profile recommendation into another product-choice menu.
  Choosing browser-token access is not approval to write/migrate credentials or perform provider login now.

## 1. Actual default paths and construction (not header-comment inference)

| Source anchor                                                                                  | Executed-code route / implication                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `server/index.ts:154-163`                                                                      | `DATA_DIR = resolve(--data-dir ?? PI_WEB_DATA_DIR ?? ~/.pi-web)`; creates it. This is UI/control/plugin/upload state, not the default model-auth path.                                                                                                                                     |
| `bin/pi-web-ui.mjs:429-438`                                                                    | `--data-dir` sets `PI_WEB_DATA_DIR`; only explicit `--agent-dir` sets `PI_CODING_AGENT_DIR`. They are independent controls.                                                                                                                                                                |
| `server/agent-service.ts:2695-2703`                                                            | `ClientSession.create()` obtains `agentDir = process.env.PI_CODING_AGENT_DIR ?? getAgentDir()`, passing it to the session object.                                                                                                                                                          |
| `G/dist/config.js:475-497`                                                                     | Public `getAgentDir()` expands the configured agent directory; otherwise returns `homedir()/.pi/agent`. No user files were read to establish this default.                                                                                                                                 |
| `server/agent-service.ts:2717-2732,2850-2862`                                                  | First conversation creates a runtime; its services seed `cs.sharedModelRuntime`. Later factories pass that instance to `createAgentSessionServices({cwd, modelRuntime, resourceLoaderOptions})`. The services call itself does **not** pass `agentDir`; SDK default discovery resolves it. |
| `G/dist/core/agent-session-services.js:53-69`; `SDK/dist/core/agent-session-services.js:53-69` | Factory uses `options.agentDir` or `getAgentDir()`, then creates `ModelRuntime` with `<agentDir>/auth.json` and `<agentDir>/models.json`; also creates settings/resource loader and calls `reload()`. Both inspected SDK versions agree on this route.                                     |
| `server/agent-service.ts:2678-2688`                                                            | `ModelAdminService` receives that same `agentDir` and a getter for the current services' model runtime. Its auth/model writes target the shared Pi directory.                                                                                                                              |
| `server/model-admin.ts:390-391,551-560,1225-1226`                                              | Additional named-key store is `<agentDir>/provider-keys.json`; active credential is `<agentDir>/auth.json`; custom models are `<agentDir>/models.json`. The extra key store is a U feature, not a separate Pi account.                                                                     |

**Sharing scope matters:** `sharedModelRuntime` belongs to a `ClientSession`, shared by that client's conversations/subagents—not a proven process-wide singleton across all browser clients (`server/agent-service.ts:834-837,2732,2851-2862`).
Cadence should put model/auth ownership in its selected shared service, not recreate U's per-client execution owners.

**Portable exception, not the standard default:** U's “100% Data Isolation” claim is in the Windows portable section (`README.md:144-153`).
`desktop/portable.ts:102-113,174-181` explicitly selects `<portable>/data/agent`, `<portable>/data/web`, and injects the corresponding environment variables.
This does not change ordinary CLI/server defaults.

## 2. Model and credential sources

- SDK runtime combines built-in providers/catalog with `models.json`; its default model cache is `models-store.json` next to that file (`SDK/dist/core/model-runtime.js:74-110`). `allowModelNetwork` defaults false; ordinary U factory does not set a private store or disable file config.
- Credential precedence is runtime override → stored Pi credential → configured `models.json` key → provider environment/ambient source.
  Actual pieces: `SDK/dist/core/runtime-credentials.js:16-20`, `AI/dist/auth/resolve.js:30-53`, `SDK/dist/core/provider-composer.js:223-248`; official explanation `DOC/models.md:22-24`.
  A stored OAuth refresh failure does **not** silently fall back to an environment key.
- Pi settings/default model and resource configuration also enter U's general session bootstrap through the factory, but are not needed merely to obtain model authentication.
  U can write SDK default-model settings during initial creation and restore project key selections (`server/agent-service.ts:2766-2789,6740-6786`).
  Do not import that whole bootstrap as a harmless credential reader.
- `setRuntimeApiKey` itself is an in-memory override, **not durable key saving** (`SDK/dist/core/runtime-credentials.js:1-12`).
  U separately saves files before installing it.
- Model configuration is not necessarily inert data: `auth.json` keys can invoke `!command`; `models.json` keys/headers can interpolate environment or run commands (`DOC/providers.md:71-84`; `DOC/models.md:61-63`; `SDK/dist/core/auth-storage.js:369-376`).
  Reviewed service configuration must name this trust/command boundary.
  No blanket claim that every existing Pi extension/provider is supported by Cadence's current worker adapters.

## 3. API-key/OAuth management and the wire boundary

| Operation             | Actual route and side effects                                                                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Save built-in API key | `set_provider_api_key` dispatches to the service (`server/dispatch-domain-handlers.ts:289-291`). `setProviderApiKey()` saves the named-key store and applies the active key; `applyActiveKey()` read-modify-writes `auth.json`, sets the runtime override, and refreshes that provider with `allowNetwork:true` (`server/model-admin.ts:549-564,572-603`).                                                                                            |
| Add/switch named key  | `add_provider_key` uploads the new raw value; activation/removal identify an existing key by name (`server/protocol.ts:740-752`). Adding stores it; the first active key also updates auth/runtime (`server/model-admin.ts:627-662`). Activation calls `applyActiveKey` (`:727`).                                                                                                                                                                     |
| Custom provider save  | `save_model_config` uploads a new key only when entered (`web/src/components/ModelConfigModal.tsx:845-856`). Merge retains omitted key and non-UI fields/headers, while explicit empty key clears it (`server/model-admin.ts:147-208`). Saves `<agentDir>/models.json` and reloads runtime (`:1843-1872,1957-1983`), not a browser-local model registry.                                                                                              |
| Provider OAuth login  | `ProviderOAuthFlowManager` runs `ModelRuntime.login(provider,"oauth",interaction)` in the server, with flow/prompt IDs, cancel signal and public prompt/event forwarding (`server/provider-oauth-flow.ts:63-107,119-183`). The returned credential is not emitted. Login success clears the named-key active selection and project/default key pins so they cannot overwrite OAuth (`server/model-admin.ts:366-376`; `server/agent-service.ts:2688`). |
| Provider logout       | Calls `runtime.logout(provider)` and updates public status (`server/model-admin.ts:343-363`). SDK deletes the stored credential; it is not provider-side revocation or removal of ambient/model-config credentials (`AI/dist/models.js:340-349`; `DOC/providers.md:16`).                                                                                                                                                                              |
| Probe/refresh         | “Fetch models” / “test connection” send server-side requests using submitted or saved keys; they are not passive reads (`server/model-admin.ts:1427-1474`). No such requests were made here.                                                                                                                                                                                                                                                          |

**Redacted reads are not the same as secret-free mutation messages:**

- `models_config` explicitly builds a projection with `hasApiKey`, model metadata and routing fields, omitting `apiKey` and `headers` (`server/model-admin.ts:1287-1313`). `UiProviderConfig.apiKey` remains a **write-only** protocol field (`server/protocol.ts:2000-2017`).
- `provider_keys` maps to `{name,active}` only, without value or masked fragments (`server/model-admin.ts:459-465`; `server/protocol.ts:2638-2648`).
  Provider status carries configured/source/auth-method flags, not credentials (`server/model-admin.ts:1108-1128`).
- User-entered keys **do travel browser → server** in key/config mutations; e.g. `web/src/components/ModelConfigModal.tsx:888-895`, `web/src/components/PiSetupModal.tsx:79-83`.
  OAuth UI can carry authorization URLs, device codes and manual-code replies; stored access/refresh tokens are not ordinary snapshots (`server/protocol.ts:2610-2636`; `server/provider-oauth-flow.ts:119-149`).
  Secure transport and secret-free logs remain necessary.
  Projection of these fields is not an exhaustive secret audit of arbitrary URLs, names or error strings.

## 4. Refresh persistence and SDK compatibility

- Default runtime credentials are SDK file-backed `AuthStorage`, not a readonly view (`SDK/dist/core/model-runtime.js:6,74-81`).
  Construction can initialize directories/files and acquire locks even without login (`SDK/dist/core/auth-storage.js:22-30,57-67,263-285`).
  “Use existing configuration” must not be described as “never writes existing credentials.”
- OAuth login persists through `CredentialStore.modify`; logout uses `delete` (`AI/dist/models.js:292-349`).
  Near-expiry `getAuth()` refreshes under a double-checked store modification, then persists rotated credentials; default threshold is five minutes (`AI/dist/auth/resolve.js:61-115`).
  Storage re-reads and merges the provider under the file lock (`SDK/dist/core/auth-storage.js:116-155,378-405`).
  File creation requests 0600; parent directory creation requests 0700 (`:15-30`); this is not encryption or proof of existing ACL safety.
- **Version distinction:** GAI 1.2.0 decouples a started OAuth refresh/persistence from caller cancellation to avoid losing a rotated token; cancellation only stops waiting for the lock, and provider refresh has a 15-second timeout (`GAI/dist/auth/resolve.js:46-114`).
  AI 0.84.3 combines caller cancellation with refresh timeout (`AI/dist/auth/resolve.js:82-91`).
  A canceled caller is not evidence of rollback or no credential writes.
  Pin/qualify the intended service peer instead of claiming identical shutdown semantics.
- Public factory declarations in both versions accept `agentDir`, `modelRuntime` and explicit settings/resource-loader options (`G/dist/core/agent-session-services.d.ts:27-36`; corresponding SDK file).
  Public `ModelRuntime.create` accepts **authPath/modelsPath**, not `agentDir` or a guessed readonly/profile flag (`SDK/dist/core/model-runtime.d.ts:3-24`).
  `getModel`, `getAuth`, login/logout and runtime-key overrides exist in the installed peer (`:62-94`); 1.2.0 additionally has a fourth login options argument (`G/dist/core/model-runtime.d.ts:107`).
- Use root exports `ModelRuntime`/`getAgentDir`, not private `AuthStorage` imports (`SDK/dist/index.d.ts:2-4,13`).
  U declares SDK `>=1.1.0`, lock records 1.1.0 (`package.json:105-111`; `package-lock.json:1387-1390`), and its launcher can select a newer SDK (`server/resolve-global-sdk.ts:77-122`).
  U has no installed SDK at its ordinary `node_modules/@earendil-works/pi-coding-agent` path here.
  Factory behavior above was inspected in the identified local/global copies, not executed in U.

## 5. Smallest reference-like Cadence adaptation (proposal, not approval)

1. Reuse the reference browser-token access pattern under the parent's reviewed remote-security policy; no user-account/tenant database or provider-login requirement merely to open the workspace.
   Keep browser access secret and provider authentication entirely separate.
2. Have the single execution owner resolve normal Pi `agentDir` once and construct **model/auth infrastructure only**, using public `ModelRuntime.create({authPath:<agentDir>/auth.json, modelsPath:<agentDir>/models.json, …})`.
   Document refresh write ownership at that same path.
   An already configured provider needs no new account, copied credential database or continuously open Pi terminal.
   Normal Pi setup can remain the provisioning route; do not perform `/login` on the user's behalf.
3. Configure catalog/cache/network behavior explicitly; an in-memory model cache is publicly available (`AI/dist/index.d.ts:22`, `AI/dist/models-store.d.ts`) if preserving an existing disk cache is preferable.
   `allowModelNetwork:false` / `refreshOnCreate:false` limit catalog startup, **not** file-store initialization or later provider-auth refresh.
   Do not resolve credentials or create a general AgentSession just because a browser reconnects.
4. At admitted work, resolve the selected model's auth server-side and adapt it to Cadence's bounded stdin worker envelope (`C/src/subagent-process.ts:455-512`).
   Children retain no discovery and no shared auth-file access through their SDK runtime (`C/src/sdk-worker.mjs:203-270`).
   Resolve each admitted child afresh; current workers keep a fixed auth snapshot, so long-run expiry still needs an explicit validity/failure contract—not a promise of automatic in-child renewal.
5. If model management is included in the reviewed design, **directly adapt substantial compatible U modules/UI**: `ModelAdminHost`/redacted projections, `ProviderOAuthFlowManager`, model/setup form components and protocol DTOs.
   No arbitrary small-reuse quota.
   Retain useful behavior; replace incompatible storage/admission side effects rather than building another credential subsystem.
   Preserve U's full MIT notice and pinned source/destination provenance (`U/LICENSE:1-21`).

## 6. Side effects that the reviewed plan must disclose/authorize

| Boundary                       | Required treatment before implementation/operation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing Pi credentials        | Name the actual selected auth path and approve SDK refresh/rotation persistence there, including directory/file initialization and lock files. This is writable sharing, not migration. Handle cancellation/persistence failure without launching late work or logging returned credentials. Browser-token choice alone did not authorize it.                                                                                                                                                                                                                       |
| Explicit credential management | Adding/activating/deleting keys, replacing provider credentials via login, logout, and model-config edits need deliberate owner actions and stale/duplicate protection. Provider login/refresh/probe network effects must be described; no automatic login, credential copying or refresh-on-view.                                                                                                                                                                                                                                                                  |
| Reference “read” side effects  | U's `listProviderKeys()` seeds and **writes** `provider-keys.json` from existing auth on first list (`server/model-admin.ts:489-525`), and attach calls it (`server/agent-service.ts:3737-3740`). `readProviderKeys()` may rename corrupt files (`server/model-admin.ts:407-440`). Do not import either as passive observation or incidental migration.                                                                                                                                                                                                             |
| Reference file writes          | `applyActiveKey()` treats unreadable/unparseable auth as `{}` before replacement (`server/model-admin.ts:551-560`). `server/atomic-file.ts:12-29` has no SDK credential-store lock or explicit private file mode and falls back to in-place write. Atomic rename alone does not coordinate with Pi OAuth refresh. Prefer approved public SDK credential operations (including `login(provider,"api_key",interaction)` where supported), with serialized storage/private permissions; preserve unknown/corrupt records instead of copying these behaviors unchanged. |
| Bootstrap/management extras    | Settings defaults, automatic project-key activation, key-pin clearing, catalog-cache writes, probes and resource discovery are distinct effects, not prerequisites for token access. Do not import the entire general-chat bootstrap or automatic continuation.                                                                                                                                                                                                                                                                                                     |

**Suggested caller wording:** “There are two keys: the URL token lets you into Cadence; Pi's existing provider credentials let the backend call models.
The reference normally reuses Pi's configuration, so we can follow it without creating another account system.
The plan will explicitly cover OAuth refresh writes to that configuration; no login, migration or credential changes are being performed now.”

Final source check: U HEAD/status remained unchanged and clean; explicit file/range anchors were checked for existence/bounds only, not behavior.
