# Independent service: model/auth sourcing and lifecycle

## Scope and evidence

Planning-only research for `.trellis/tasks/10-16-cadence-webui-terminal`, confirmed by `python3 ./.trellis/scripts/task.py current --source` (session source).
Read current `prd.md`, `cadence-runtime-web-seams.md`, `pi-web-ui-reuse.md`, maintained workflow/storage specs, Cadence source, installed SDK declarations/implementations and official local docs/examples.
Only this file is written.
No credentials, credential files, secret-bearing environment values, network/provider calls, dependency installs, services, tests, task activation or product edits were used.
The Context7 skill was consulted but not invoked: this delegation explicitly forbids network calls/config access.
Findings are source inspection, **not executed qualification**.
Earlier research's observation-only/terminal-attached recommendation is superseded by the PRD choices: actionable WebUI, independent shared owner, bounded multi-subagent work.
Exposure remains undecided.

Anchor shorthand: `SDK` = `node_modules/@earendil-works/pi-coding-agent`; `AI` = `node_modules/@earendil-works/pi-ai`; `GLOBAL` = `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`; `DOC`/`EX` = `GLOBAL/docs`/`GLOBAL/examples`.
Paths otherwise are repository-relative.

## Findings in brief

- Feasible without a live terminal: instantiate **model/auth infrastructure only** in a Cadence service; the existing `runWorker` remains the sole admitted SDK-child launch route.
  A `ModelRuntime` is not an `AgentSession` and need not execute a prompt.
- Do not launch `pi --mode rpc`, a browser-owned SDK session, or a dormant parent agent merely to acquire credentials.
  These create an execution host, not attachment to Cadence's owner (`DOC/cli-integration.md:58-89`; `EX/rpc-client.ts`).
- There is no public ready-made readonly profile constructor. `readStoredCredential` plus the public `CredentialStore` interface permits a narrow readonly adapter; sustained OAuth refresh needs explicitly writable credential ownership.
- Keep child credentials as one bounded resolved-auth snapshot.
  That preserves today's implementation but cannot refresh a token during a long child run.
  Multiple scheduled children must resolve credentials at admission, not reuse a task-wide token forever.
- Independent lifetime is more than moving the UI: parent-check environment, SDK peer resolution, crash/unknown-child fencing, terminal guard behavior and durable command admission all need deliberate changes.

## 1. Exact public surface and observed version gaps

Installed coding-agent, pi-ai and pi-agent-core metadata are **0.84.3**; the corresponding global packages/docs are **1.2.0**.
Both SDK sets declare Node `>=22.19.0`, while Cadence declares `>=22.13.0` (`package.json:7-9,48-64`; respective SDK `package.json`).
Versions describe evidence, not a guessed compatibility/fallback rule.

| Public API in installed peer                                                                                              | Contract / implication                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ModelRuntime.create(options?: CreateModelRuntimeOptions): Promise<ModelRuntime>`                                         | Options include `credentials?: CredentialStore`, `authPath?: string`, `modelsPath?: string \| null`, `modelsStore?: ModelsStore`, `modelsStorePath?`, `allowModelNetwork?`, `modelRefreshTimeoutMs?`, `catalogBaseUrl?`, `signal?`, `refreshOnCreate?` (`SDK/dist/core/model-runtime.d.ts:3-24,53`). **No `agentDir`, `readOnly`, profile, or `AuthContext` option.** |
| `getModel(providerId, modelId): Model<Api> \| undefined`                                                                  | Exact selection; `getModels()` is synchronous catalog inspection. Do not pick first available/default as fallback (`:62-69`).                                                                                                                                                                                                                                         |
| `getAuth(model, {signal?, apiKey?, env?, minOAuthValidityMs?}): Promise<AuthResult \| undefined>`                         | Model overload includes configured model headers; result is `{auth:{apiKey?,headers?,baseUrl?}, env?, source?}`, not `{ok:true}` (`:20-24,78-79`; `AI/dist/auth/types.d.ts:1-9,89-100`). Map explicitly to `WorkerRequest.auth`.                                                                                                                                      |
| `new ModelRegistry(runtime).getApiKeyAndHeaders(model)`                                                                   | Matches existing parent envelope but accepts **no AbortSignal**; `getAuth` is narrower for new cancellable service admission (`SDK/dist/core/model-registry.d.ts:5-14,22-30`). Do not use its `@internal` compatibility method directly.                                                                                                                              |
| `readStoredCredential(providerId, authPath?): Credential \| undefined`                                                    | Exported at root (`SDK/dist/index.d.ts:4`); reads one stored provider without key-expression resolution. Internally reads/parses the file and catches all errors as undefined (`SDK/dist/core/auth-storage.js:413-424`): missing and invalid/unreadable are not distinguished.                                                                                        |
| `CredentialStore.read/list/modify/delete`                                                                                 | Public through pi-ai; `modify` must serialize refresh/read-modify-write, cross-process where appropriate; `list` must not execute key commands (`AI/dist/auth/types.d.ts:45-78`; `AI/dist/index.d.ts:15-18`).                                                                                                                                                         |
| `InMemoryCredentialStore`, `InMemoryModelsStore`                                                                          | Public pi-ai exports; avoid credential/catalog file defaults when injecting these (`AI/dist/auth/credential-store.d.ts`; `AI/dist/models-store.d.ts`; `AI/dist/index.d.ts:16,22`). In-memory storage does not imply a safe durable OAuth owner.                                                                                                                       |
| `login(providerId, type, interaction)`, `logout(providerId,{signal?})`                                                    | UI-neutral login callbacks are public, but adding browser credential management is not required scope (`SDK/dist/core/model-runtime.d.ts:93-94`; `AI/dist/auth/types.d.ts:105-160`).                                                                                                                                                                                  |
| `createAgentSession({cwd,agentDir,model,modelRuntime,thinkingLevel,tools,resourceLoader,sessionManager,settingsManager})` | Explicit construction used by existing child; in-memory history/settings and empty loader avoid discovery. `agentDir` here does not configure an already-created `ModelRuntime` (`SDK/dist/core/sdk.d.ts:10-64`; `EX/sdk/12-full-control.ts`).                                                                                                                        |

Important capability differences / traps:

1. `AuthStorage`, `ReadOnlyAuthStorage`, `FileAuthStorageBackend` have internal declarations but **are not root exports**, and package exports expose only `.`, `./rpc-entry`, `./client` (`SDK/package.json:14-27`; `SDK/dist/index.d.ts`).
   Global 1.2.0 also exports only `readStoredCredential` from auth-storage.
   Do not deep-import internals or invent `AuthStorage.create({readonly:true})`.
2. 1.2.0 adds typed image/classifier enumeration, `registerVirtualModel`, `resolveModel`, `getPhysicalModel`, and a fourth `login(..., options?: LoginOptions)` parameter; installed `ModelRuntime` lacks them.
   Stay with exact physical chat model identity and the three-argument login contract (`SDK/dist/core/model-runtime.d.ts:62-98`; `GLOBAL/dist/core/model-runtime.d.ts:69-143`).
3. Installed `tools` is an exact-name allowlist; global declarations also support patterns/additive selection and MCP-specific behavior.
   Keep explicit names and empty discovery, not new wildcard/MCP assumptions (`SDK/dist/core/sdk.d.ts:34-45`; `GLOBAL/dist/core/sdk.d.ts:34-54`).
4. Global settings document `cacheWarming`; installed `Settings` has no declared field.
   Cadence's JS child already passes `cacheWarming:"off"`, disables compaction/retry and forces stream `maxRetries:0`.
   A future typed host cannot pretend the older declaration has this property; modern peer behavior needs its own qualified lane (`SDK/dist/core/settings-manager.d.ts`; `src/sdk-worker.mjs:264-295`; `DOC/settings.md:7-23`).
5. Global `DOC/extensions.md` suggests `ctx.modelRegistry.streamSimple()`, but installed `ModelRegistry` declares `complete()`, not `streamSimple()`; use the declared `ModelRuntime.getAuth()` for this task, not nested inference.
6. `ModelRuntime` has no public `dispose/close`; `AgentSession.dispose()` and `AgentSessionRuntime.dispose()` are different ownership APIs.
   Do not guess a runtime shutdown method or globally clean other sessions' transports (`SDK/dist/core/model-runtime.d.ts`; `SDK/dist/core/agent-session-runtime.d.ts`; `AI/dist/session-resources.d.ts`).

## 2. Profile/model trust and no implicit execution

Here **profile** means a Cadence-selected configuration descriptor, not an SDK profile API: canonical workspace/cwd, explicit trusted agent directory or explicit auth/models paths, credential policy, exact provider/model/API/thinking, and approved environment/network policy.
`DOC/configuration.md:3-25` supports agent-directory selection via `PI_CODING_AGENT_DIR`/session `agentDir`; a standalone `ModelRuntime` needs explicit paths.
Avoid process-global environment switching between tasks/profiles.
Use one pinned configuration generation per admission.
Client sends profile/model identifiers, not raw model objects, credentials, arbitrary paths or a `WorkerRequest`; owner resolves/validates them.
Changed plan/cwd/model/config generation invalidates pending consent.

`ModelRuntime.create` defaults to file-backed auth, models.json and models-store.json; even auth reads can create the file/directories/lock (`SDK/dist/core/model-runtime.js:74-110`; `SDK/dist/core/auth-storage.js:22-30,57-67,116-140,282-285`).
Thus using an existing `authPath` is **not readonly** merely because the service never calls login/logout.
Use explicit `modelsStore: new InMemoryModelsStore()`, `allowModelNetwork:false`, `refreshOnCreate:false`; `modelsPath:null` disables file model discovery.
These switches do not prohibit explicit inference or OAuth refresh.
Skipping refresh leaves static models available, not a complete authenticated catalog.
Do not treat `getAvailableSnapshot()/hasConfiguredAuth()` as proof of usable credentials; check selected configuration errors and resolve selected auth at admitted work time (`SDK/dist/core/model-runtime.js:74-110,330-353`).

Do not use `createAgentSession()` defaults or `createAgentSessionServices({cwd})` for credential bootstrap: defaults discover settings/resources and services construct a resource loader (`DOC/sdk.md:97-111`; `EX/sdk/01-minimal.ts`, `13-session-runtime.ts`; `SDK/dist/core/agent-session-services.d.ts:25-80`).
Profile trust is not permission to load every personal/project extension.
Minimal service loads no extensions/MCP/skills/prompts/themes; reuse Cadence's bounded, explicitly untrusted root AGENTS content (`src/task-shell.ts:411-427`; `src/sdk-worker.mjs:231-270`).
Pi trust is not a sandbox; context files can load even without project trust in ordinary Pi (`DOC/security.md:27-64`).
Service-owned trust/allowlisting must replace reliance on a live `ctx.isProjectTrusted()`, not fake a terminal context.

## 3. Credential sourcing options — decisions must remain explicit

### A. Read existing supported credentials without modifying their source

Smallest candidate: a service-owned readonly implementation of public `CredentialStore`, restricted to the explicitly selected provider/path, using exported `readStoredCredential` for the raw supported credential shape and rejecting `modify/delete` **before invoking mutation callbacks**.
Require selected-file hygiene/bounds and credential validation; undefined/error/invalid data refuses admission, never falls back to ambient credentials.
The helper itself is unbounded and does not validate shape or distinguish corruption, so it is not a complete safety adapter.
No calls to internal `ReadOnlyAuthStorage`; no copying the whole auth file to a new store; re-read at new admission so external setup changes can be observed under an explicit configuration-generation policy.

Narrow initial capability: a stored literal API key (and explicitly approved provider fields), or a still-valid OAuth credential with sufficient remaining lifetime; exact built-in/static model.
Unsupported command/interpolation credentials or headers should refuse, not be passed as literal keys or silently reinterpreted.
`auth.json` key commands and `models.json` key/header commands are execution authority, not mere file reads: normal Pi resolves the former with process-lifetime caching and the latter at request time (`DOC/providers.md:71-84`; `DOC/models.md:61-79`; `SDK/dist/core/auth-storage.js:369-376`; `SDK/dist/core/provider-composer.js:219-248`).
Supporting them later requires explicit trusted-command policy and bounded cancellation/environment semantics.
Stored API-key fields can still be completed from ambient provider configuration; `ModelRuntime.create` exposes no injectable `AuthContext`, and `env` overrides are overlays, not an environment denylist (`AI/dist/auth/types.d.ts:161-183`; `AI/dist/auth/resolve.js:30-59`).
Validate required fields/provider capability and use an explicitly controlled service environment; a missing selected credential must reject in the adapter rather than return undefined and enable ambient fallback.
Using reviewed `models.json` is possible through `modelsPath`, but restrict/validate command-bearing fields, require explicitly selected files to exist, and fail on parse/composition errors; the runtime can retain built-ins despite configuration errors.
`getError()` is an admission gate, not a warning to ignore (`SDK/dist/core/model-runtime.js:135-160`; `SDK/dist/core/model-config.js:212-252`).

Readonly OAuth is **not refresh-capable**: `getAuth` calls `CredentialStore.modify` when expiry is within five minutes (or a larger explicit `minOAuthValidityMs`), then persists rotated tokens before deriving auth (`AI/dist/auth/resolve.js:61-115`).
Reject near-expiry credentials without invoking the refresh callback.
External reauthentication/refresh is separate, user-initiated setup; no promise of unattended indefinite availability.
Never seed a writable `InMemoryCredentialStore` with another process's refresh token to claim readonly support: refresh can rotate/revoke the original remotely while losing the new token on service exit, despite no local file write.

### B. Dedicated, explicitly writable service credential configuration

Public route: `ModelRuntime.create({authPath:<dedicated>, modelsPath:<explicit-or-null>, modelsStore:new InMemoryModelsStore(), allowModelNetwork:false, refreshOnCreate:false})` with the default file credential store.
User provisions it separately through normal Pi `/login` with that agent directory, or a later explicitly approved UI-neutral login adapter.
Runtime operation does not require that terminal to remain alive.
Do not copy existing OAuth tokens as an incidental migration; prefer independent login where the provider permits it.
Default file store serializes refresh under a cross-process lock and persists through `modify` (`SDK/dist/core/auth-storage.js:76-155,378-394`; `AI/dist/auth/types.d.ts:45-78`).
Keep one credential owner per profile/provider and don't give children that file.
Sharing a file with setup tools requires the same SDK storage protocol; provider policies may still couple multiple logins.
This is the minimal durable OAuth option, **but selecting dedicated persistent secrets is a user policy decision**, not implied by choosing a service.
Permission/ACL checks, backup/revocation, storage failure and refresh-rotation crash handling remain design/qualification work.

### C. Explicit writable sharing of the existing Pi auth file

Also supported through `authPath`; smallest code change but makes Cadence a writer to personal credentials.
Label it accurately and obtain separate consent.
SDK locking does not make this readonly or guarantee coordination with incompatible older tools/manual editors.
Do not silently switch A→B/C when refresh fails.
Do not add login prompts, browser callbacks, ambient key fallback or automatic reauthentication to a Start failure.

### Auth-resource ownership and run limits

Prefer `runtime.getAuth(selectedModel,{signal,minOAuthValidityMs})` with a bounded admission deadline and fresh rechecks before spawn.
Registry compatibility has no signal; today's `awaitWithAbort` only discards late completion, not underlying auth side effects (`src/subagent-process.ts:539-565`).
The public auth call races cancellation (`AI/dist/auth/resolve.js:26-28`): an abort rejection is not proof all underlying refresh I/O stopped, and there is no public auth `waitForIdle`.
A canceled refresh may already have reached the provider; disk failure after rotation is not rollback.
Keep refresh work accounted for through shutdown, hide raw exceptions (which may contain provider details/credentials), and fail visibly without launching/retrying a worker.
Request auth goes only to the bounded anonymous stdin envelope, never argv, browser snapshots, task records, logs or parent check env (`src/subagent-process.ts:448-512`; `src/sdk-worker.mjs:208-230`).
Preserve null-header suppression, resolved baseUrl and provider-scoped env as literals.
A child uses that snapshot for all its requests; default worker budget is 20 minutes, exceeding the default five-minute OAuth refresh window.
Option: require validity covering bounded child lifetime plus setup slack, and refuse if refreshed tokens cannot satisfy it; this does not guarantee server-side validity.
Otherwise retain documented expiry failure requiring a new explicit run.
In-run auth IPC/refresh is a separate, larger contract, not present today.
Auth validity is checked per child when it is actually admitted, not when queued.
Configuration/identity changes during a queue require renewed consent; token renewal within the same approved identity/policy must have explicitly defined semantics.

## 4. Recommended minimal execution route (conditional, not approval)

1. Explicitly launched Cadence owner; terminal and WebUI are clients.
   Owner has no prompt-running parent Pi session; it owns task admission, scheduler, model/auth preparation, process handles and parent checks.
2. Explicit trusted profile + exact static chat model + seven currently supported adapters; keep all discovery/retries/automatic continuation disabled.
   Reject native/function-defined provider transports rather than silently substituting official adapters (`src/task-shell.ts:63-71,370-390`; `src/sdk-worker.mjs:15-30,174-180`).
   Bedrock/Vertex ambient-file auth remains unsupported by this worker route (`src/subagent-process.ts:455-464`).
3. Start with option A if its credential/lifetime limits meet the user's actual needs; offer B only after explicit persistent-credential approval if refresh is required.
   Do not choose the user's credential or deployment policy here.
4. Preserve `runWorker`/`sdk-worker.mjs` for each explicitly admitted assignment, with per-child tools and in-memory sessions.
   Parallel readonly children are intentional service-owned workers, **not competing executors**.
   No child spawn tool, arbitrary nested scheduler or browser SDK runtime.
5. Retain one service-controlled checkout write lane across tasks, including arbitrary parent-check commands.
   Existing `TaskController.active` plus its per-operation checkout lock cannot simply run two controllers concurrently for readonly work; scheduler/lock ownership needs refactoring (`src/task-controller.ts:293-312`; `src/task-store.ts:266-301`).
   Parent-check freshness must not race service edits.
6. Same owner accepts native terminal and browser actions through separate fresh consent paths, binding task/raw-record identity, plan, assignments, cwd, model/profile generation and operation ID.
   Observing/reconnecting never performs auth resolution, starts a worker, or replays an uncertain command.

This avoids a second inference runtime and most auth machinery, but does **not** prove all present terminal providers work headlessly.
A profile needing extension code, dynamic catalog discovery, key commands, cloud ambient files or mid-run refresh requires a separately reviewed capability, not fallback.

## 5. Parent-check environment and packaging constraints

Today `runCheck` inherits the ordinary parent process environment, uses `/bin/sh -c` or explicit Windows CMD quoting, and never receives resolved request auth (`src/subagent-process.ts:514-537`).
In a service the parent is the **service process**, not the initiating terminal.
Define and display a named check-environment policy: an explicitly launched owner can inherit a documented operator environment snapshot; alternatively configure a reviewed per-workspace check environment.
Neither is automatically identical to a later client's shell.
Do not accept arbitrary browser env overlays, copy terminal secrets over the control channel, or merge model-auth env into checks.
Checks may intentionally require ordinary project credentials; silently replacing their environment with `safeChildEnv()` breaks the current contract.
Conversely an auth-rich daemon environment would leak those secrets to checks; dedicated auth storage avoids promoting resolved tokens into process env.
OS-accessible files remain accessible to host tools: no sandbox claim.
Proxy policy also changes with the parent process: `runWorker` validates the service's ambient proxy route, not the disconnected terminal's.
Preserve its narrow capability checks and refusal semantics (`src/subagent-process.ts:258-443`); separately qualify provider auth-refresh networking, which does not run in the worker's owned proxy dispatcher.

A standalone service cannot rely on Pi's extension loader to resolve wildcard peers.
`DOC/packages.md:76-94` says Pi supplies peers and suppresses managed peer auto-installation; a physical bundled duplicate can change registry identity.
Decide an explicit supported installation/module root, make the service and worker resolve the same reviewed SDK family, and refuse missing capabilities—no global-directory guessing, CLI fallback or auto-install.
Keep ordinary extension loading inert (`src/index.ts:6-12`; `DOC/extensions.md:54-60`).
A separate audited service entry/build artifact is needed; existing readonly `doctor/runs` must not silently acquire execution authority.
Package membership, engines and source/extracted qualification need deliberate updates, not disabled audits.

## 6. Startup, disconnect, stop and crash

| Event                                 | Proposed owner behavior / source constraint                                                                                                                                                                                                                                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Explicit service startup              | Validate selected config/capabilities and establish one owner identity/epoch; readiness is not provider inference or task Start. No background login, catalog fetch, transcript import/repair, lock recovery or restart continuation.                                                                   |
| Open/reconnect client                 | Subscribe to authoritative snapshot/cursor. Client presence never owns the worker lifetime. Reject stale epoch/duplicate mutation; return prior admission result where known, not a second launch after lost acknowledgment.                                                                            |
| Terminal navigation/model change/exit | Detach UI/invalidate local dialogs; service-owned work continues. Current `depart()` and progress `dispose()` cancel (`src/task-shell.ts:81-113,217-222`) and must intentionally change. Model changes in another client cannot mutate an admitted run.                                                 |
| Explicit parent cancellation          | Stop admission first, abort pending auth/admission, then cancel every active child/check using bounded process settlement. Aggregate failed/canceled/timeout/unknown honestly; keep checkout blocked while any writer closure is unknown.                                                               |
| Explicit service stop / SIGTERM       | Stop admission, cancel active work by default, await bounded settlement and final persistence, close owned subscribers/resources. Optional drain mode would need a clear separate policy; do not silently detach untracked children.                                                                    |
| SIGKILL/crash                         | No cleanup guarantee. Worker groups are POSIX-detached (`src/subagent-process.ts:82-88`), so service death is not proof they stopped. Persisted running becomes interrupted/unknown, not successful/canceled.                                                                                           |
| Restart                               | New epoch; expose old uncertainty and deny unsafe writers; never re-prompt/retry automatically. PID/host alone cannot identify surviving descendants or prevent PID-reuse confusion. Old native close observations cannot be reconstructed by a new process.                                            |
| Recovery                              | Separate informed operator action with unchanged selected ownership data; never on view/reconnect. Existing recovery only checks the dead local **parent** PID (`src/task-store.ts:303-316`), insufficient to prove new service children closed. Retain conservative fencing until explicit resolution. |

Persist admitted operation identity and uncertainty before side effects, with launch/settlement observations and bounded command deduplication.
A crash between recorded admission and process launch/closure must remain uncertain, not be repaired by replay.
Process identity/containment strategy needs platform-specific design; a new per-worker PID field alone is not proof of ownership or descendant closure.
Current TaskRecord decoder rejects unknown top-level fields and task directories reject extra siblings (`src/task-types.ts:166-182`; `src/task-store.ts:324-332`).
Keep new service journal/coordination outside old task directories in reviewed private storage; do not migrate old history.
Progress-history depth/retention remains the user's pending decision.

Original foreground compatibility has two meanings: preserve plan/Start/check/review terminal-only UX (required), and preserve a terminal-owned executor (not required by independent ownership).
Prefer terminal client→same explicit headless owner, with no browser required and no silent local fallback when service unavailable.
If a legacy embedded mode remains for compatibility, make it an explicit mutually exclusive owner mode with the same checkout fence, never concurrent with service ownership.
Retain existing tests for its foreground cancellation, while service mode gets new detach semantics.
Whether to ship both modes is a rollout decision.
The old host input/tool/bash guards depend on local `controller.busy` (`src/task-shell.ts:114-133`); a thin client needs shared-busy awareness to avoid ordinary host edits racing service writers.
Other editors/unmodified Pi processes remain outside Cadence coordination; cannot promise universal checkout exclusion.

## 7. User-owned choices and unresolved engineering constraints

- **User:** local-only, remote single-user or multi-user deployment; principal/origin/credential isolation cannot be decided from the service choice.
  This report selects none.
- **User:** existing readonly credentials with explicit expiry limits versus dedicated writable OAuth config versus explicitly shared writes; whether unsupported dynamic/provider capabilities are required.
- **User:** progress/history depth; preferred stop/drain UX and whether retaining a legacy owner mode is valuable.
  No login-at-boot/autostart/public listener is implied.
- **Engineering:** exact public-peer support/distribution route; safe selected-profile validation without discovery; auth-refresh cancellation/rotation persistence; check environment; durable admission/dedup and epoch fencing; bounded scheduler and process-stop behavior across platforms.
- **Security:** browser authentication is separate from provider OAuth.
  Never use a provider token as the WebUI credential or treat client IDs/connection state as Start consent.
  Remote/multi-user policy can materially alter the minimal credential-owner design.

## 8. Acceptance-test ideas — none executed

1. Static/packaged public import checks against each supported peer: no private SDK imports, no guessed APIs, no accidental CLI/session bootstrap; missing model/API/thinking capability refuses without fallback.
2. Fake credentials only: readonly source unchanged byte-for-byte, no lock/file creation; missing/corrupt/symlinked/oversized selected files refuse; literal keys/null headers stay literal; key commands never run during view/startup.
3. Fake OAuth clock/provider/store: sufficient validity succeeds; near-expiry readonly fails without network/modify callback; writable concurrent child admission refreshes once with serialized rotation; persistence failure/cancellation cannot launch late work or fall back to env.
4. Long child/queue expiry: resolve per admission, preserve approved identity, enforce chosen validity policy, no in-run refresh surprise or autonomous retry.
   Secret canaries absent from argv/events/records/errors/check environment.
5. Headless owner with no Pi terminal and no browser can perform admitted work; both clients see the same operation.
   Disconnect each surface during auth, tool execution and parent check: no cancellation/duplicate launch; reconnect is observation only.
6. Stop/crash at admission, post-spawn and pre-result-save boundaries: cancellation differs from crash/unknown; stale epoch and duplicate Start rejected; surviving process/uncertain close blocks writers; restart never continues work.
7. Two readonly children overlap; competing edits/checks serialize across tasks; readonly child never gains code tools.
   Parent cancel stops queued admission and accounts for all active children.
8. Confirmed check uses the documented service environment, cwd/command/timeout and native exit; changed workspace becomes stale.
   Human Done cannot upgrade failed/unrun checks.
   Preserve original records and dirty working-copy files.
9. Source/extracted terminal regular/fullscreen lanes retain native entry/fresh consent and no-browser operation; service disconnect/detach expectations tested separately from retained legacy mode, if any.
   OS/provider-specific lanes remain unqualified until actually run.

## 9. Proposed child-deliverable boundaries (do not create/start yet)

| Child                                      | Independently reviewable output / dependencies                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Runtime profile/auth adapter               | Public API support matrix, explicit model/config selection, readonly or approved writable credential policy, no discovery, expiry/cancel/secret tests; blocked on user credential capability requirements.   |
| Shared owner/lifecycle and admission       | Explicit startup/stop, service identity/epoch, durable admission/dedup, checkout fence and unknown recovery, environment-bound parent checks; depends on auth contract.                                      |
| Bounded orchestration/projection           | Assignment identities, readonly concurrency, serialized mutation/check lane, cancellation/aggregate outcomes and truthful events; depends on lifecycle/fencing, informs history decision.                    |
| Terminal and WebUI adapters                | Both consume the same owner contract; native consent retained, browser fresh-action admission and reconnect; depends on exposure/auth decision and projection. UI reuse/provenance stays scoped.             |
| Distribution and integration qualification | Service/worker peer resolution, audited artifacts/notices, source/extracted terminal/browser/headless, restart/secret/OS tests; depends on all prior deliverables. Parent owns cross-child R1–R8 acceptance. |

Official documentation read completely: `GLOBAL/README.md`; `DOC/{sdk,providers,models,configuration,security,settings,environment-variables,custom-provider,cli-integration,extensions,rpc,rpc-extension-ui,tui,packages,sessions}.md`; `EX/sdk/README.md`.
Relevant linked SDK examples `01`, `02`, `09`, `10`, `12`, `13` and RPC client were inspected, not executed.
New provider protocols, transcript import, MCP and browser login implementation are intentionally outside the minimal route.
