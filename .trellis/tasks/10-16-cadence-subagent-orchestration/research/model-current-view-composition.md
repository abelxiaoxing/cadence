# Actual-host model choice and current-view composition

## Boundary and recommendation

Active task resolved with `python3 ./.trellis/scripts/task.py current --source`: `.trellis/tasks/10-16-cadence-subagent-orchestration` (session source). **Source research only:** no agents, implementation, tests, builds, SDK construction, native/browser qualification, network, downloads, credential inspection or Git mutation. Only this new research artifact is authored. Main owns the concurrent private-read review.

Authority: complete parent PRD/design/plan and both mandatory appendices; parent `research/accepting-owner-composition-handoff.md`; W4 `research/w4-accepting-owner-contracts.md`; W6 `research/w6-build-qualification-review.md`. Their execution/privacy/original-lifetime contracts remain controlling.

**Recommended minimum:** keep one loaded OwnerModelContext; add bounded credential-free catalog and explicit authenticated owner choice; begin each boot without selection. Construct one TaskActions against narrow real dependencies and a nullable choice accessor, not a dummy selection/incomplete ServiceHost. Publish current metadata from that same action owner, separately from historical projections. No new Pi session, provider/profile runtime, settings writer, scheduler or UI reducer.

Catalog/viewing does not select, resolve auth, save a plan or grant Start. All assignments retain exact selected-model/thinking inheritance. A choice change refuses while busy; it never retargets or cancels accepted work.

## 1. Actual source gaps

| Source | Observed fact |
| --- | --- |
| `src/service/model-context.ts:216–403` | observe lists #selected; load clears selections and constructs a runtime but selects none. select performs actual validation and allocates random sourceSelectionId. Its local-only comment needs the authorized authenticated browser ingress, not a bypass. |
| `src/service/host.ts:69–293` | Loads models; admission null; current/check callbacks unavailable; no assets or TaskActions. ServiceHost includes projection/live/http which actions do not need. |
| `src/service/runtime.ts` | Closed cadence-service-host/1 and HostInput have no model choice. Existing config/policy identity is immutable and compared. |
| `src/service/task-actions.ts` | Constructor clones/requires a selection; alive asserts it current. observe hardcodes configRev/checkEnvGeneration=1, supports create/save/generate/start only. savedGraph partly relies on a 16-entry RAM own-publication cache. |
| `src/service/graph.ts:28–62` | Roles come from shipped content; validate requires each assignment model equal the owner selection, including sourceSelectionId. Preserve this rule. |
| `src/history/projection.ts` | ReadEnvironment is the current-authority seam. Historical task entities do not invent a private ContentRef for raw current v1 plan text. Existing workspace/snapshot/checkObligations are not complete current planning metadata. |
| `src/history/reader.ts:95–180,205–305` | publishedPlan proves Save/retention/publication but returns its full graph and Save publication endpoint. Task-scope graph already reads saved graphs before Start. |
| `web/src/client/plan-metadata.ts` | read(context)/saveAction(context,draft) intentionally disconnected. InspectorPanel checks context equality; PlanBoard already consumes actual role hashes/context.model. |
| `src/service-assets.ts`, `scripts/build-web.mjs`, `web/src/client/build-identity.ts` | Actual finite asset loader and compiled local identity exist; host integration/service compatibility identity do not. |

These are source findings, not executed acceptance.

## 2. Public installed Pi 0.84.3 APIs

Import public package roots. The dist paths below are inspection citations, **not** proposed private imports.

```ts
// @earendil-works/pi-coding-agent: ModelRuntime
getModels(providerId?: string): readonly Model<Api>[];
getModel(providerId: string, modelId: string): Model<Api> | undefined;
getProvider(providerId: string): Provider | undefined;
getError(): string | undefined;
getRegisteredProviderConfig(providerId: string): ProviderConfigInput | undefined;
getRegisteredNativeProvider(providerId: string): Provider | undefined;
getAuth(providerId: string, overrides?: ModelRuntimeAuthOverrides): Promise<AuthResult | undefined>;
getAuth(model: Model<Api>, overrides?: ModelRuntimeAuthOverrides): Promise<AuthResult | undefined>;

// @earendil-works/pi-ai
getSupportedThinkingLevels<TApi extends Api>(model: Model<TApi>): ModelThinkingLevel[];
clampThinkingLevel<TApi extends Api>(model: Model<TApi>, level: ModelThinkingLevel): ModelThinkingLevel;
```

Evidence: installed `pi-coding-agent/dist/core/model-runtime.d.ts`, `model-runtime.js:73–108,268–338`; `pi-ai/dist/models.d.ts:193–194`, `models.js:547–578`; package indexes export these APIs. ModelRuntime.getModels/getModel delegate to the existing collection, not selection/auth. The collection getModel searches the provider's getModels (`pi-ai/dist/models.js:55–79`). Static models exist with refreshOnCreate:false.

Retain actual construction: existing validated auth/models paths, InMemoryModelsStore, allowModelNetwork:false, refreshOnCreate:false. **Do not use getAvailable for catalog:** it invokes availability/auth checks and credential listing. getAvailableSnapshot/hasConfiguredAuth reflect refresh state and can be empty/false after deliberately unrefreshed construction; not evidence of absent configuration. No refresh/checkAuth/getAuth/login/logout/registration/session on view. Existing prepareTracked owns getAuth, validity, durable intent/settlement and original lifetime.

### Supported versus custom-function refusal

Separate existing selectExisting validation from allocation, reusing exact getModel/provider/id/API/thinking, source/environment checks and getError refusal. Do not serialize returned Model objects. Existing getRegisteredProviderConfig/getRegisteredNativeProvider guards reject registered extensions/native providers, **not ordinary static models.json overlays**. Keep guards before enumeration/selection and never discover extensions.

Current worker/ModelSelection supports only these APIs (`src/sdk-worker.mjs:25–40`, `src/worker-public.mjs:405–436`): openai-completions, openai-responses, openai-codex-responses, anthropic-messages, google-generative-ai, mistral-conversations, azure-openai-responses. SDK support alone is not Cadence support. Ambient credential-file auth, command expressions, unsupported transports/APIs and missing required environment remain fixed visible refusals. Candidate eligibility is not authenticated provider availability.

**Real contract conflict:** Pi helper/type includes max; Cadence decoder/declaration stops at xhigh. Helper returns off only for nonreasoning models; for reasoning models null mappings remove levels, and xhigh/max require mappings. Expose SDK-supported versus Cadence-selectable levels explicitly; max currently refuses unsupported-context. Never clamp. Adding max needs coordinated worker/declaration/codec qualification, not a UI cast or hidden fallback.

### Normal Pi settings: why explicit choice is cleaner

Read relevant Pi docs completely: sdk, models, settings, configuration, providers, custom-provider, security; examples sdk/02-custom-model.ts and 10-settings.ts. Documentation root: `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`; API conclusions checked against repository-installed 0.84.3 declarations/implementation.

Normal settings contain defaultProvider/defaultModel/defaultThinkingLevel and modelThinkingLevels[provider/modelId]. Trusted project settings override agent settings. `/model` selects a session; Ctrl+S saves startup defaults. Resumed session selection, enabled-model patterns and Pi automatic fallback are not an explicit owner choice.

Public SettingsManager (`dist/core/settings-manager.d.ts:159–211`):

```ts
static create(cwd: string, agentDir?: string, options?: SettingsManagerCreateOptions): SettingsManager;
static fromStorage(storage: SettingsStorage, options?: SettingsManagerCreateOptions): SettingsManager;
static inMemory(settings?: Partial<Settings>, options?: SettingsManagerCreateOptions): SettingsManager;
getDefaultProvider(): string | undefined;
getDefaultModel(): string | undefined;
getDefaultThinkingLevel(): ThinkingLevel | undefined;
getModelThinkingLevel(provider: string, modelId: string): ThinkingLevel | undefined;
getAllModelThinkingLevels(): Record<string, ThinkingLevel>;
drainErrors(): SettingsError[];
// SettingsStorage.withLock(scope, fn), fn returns string | undefined
```

SettingsManager.create is **not side-effect-free file inspection**: FileSettingsStorage.withLock acquires locks even for readonly existing settings (`settings-manager.js:46–108,154–207`); create defaults projectTrusted=true, parse errors become recorded errors plus empty settings, setters queue writes. SDK session creation also invokes automatic model/default/clamped-thinking paths (`core/sdk.js:88–130`). Do not use those shortcuts.

Safe alternative if preferences are required: bounded safe settings reads, then public fromStorage over a readonly in-memory snapshot adapter; reject writes, drain errors, validate exact fields and do not assume project trust. Only explicit provider+model and explicit supported per-model/default thinking provide a complete configured choice. Missing thinking is not permission to guess medium/off. This adds a settings/trust/source-freshness boundary absent from the host. **Recommend explicit owner choice now**, reusing existing auth/models, with no settings read/write. A future settings hint can prefill a chooser, never apply itself. No second login/profile or terminal-session dependency.

## 3. Bounded catalog and explicit choice

Proposed additions below, not current APIs. One portable codec owner exported through service-contract; Node/Pi logic stays owner-side.

```ts
type ChoiceVersion = {
  epoch:string; accessGeneration:number; configRev:number; catalogId:string;
};
type ModelCandidate = {
  provider:string; model:string; api:string;
  thinking:{level:string; selectable:boolean}[];
  eligibility:'candidate'|'unsupported'|'auth-unavailable';
};
type ModelCatalog = {
  version:ChoiceVersion; selected:ModelSelection|null; entries:ModelCandidate[];
};
type ChooseModelRequest = {
  expected:ChoiceVersion;
  choice:Omit<ModelSelection,'sourceSelectionId'>;
};
```

Actual codec uses finite API/thinking enums (including nonselectable max), not unrestricted strings from this sketch. Unsupported API gets a fixed category. Provider/model retain existing 128/256-byte identity limits. Omit names/pricing/context extras: exact provider/model/API/thinking suffices. Reject secret-bearing/unsafe identity strings rather than redacting into a different selectable identifier. No header/baseURL/env/auth fields, raw errors or credential/config fingerprints.

Minimal finite policy: ≤existing maxPageEntries=200 candidates, ≤pageBytes=512KiB for the **whole Reply**, ≤7 thinking levels per candidate. Enumerate only providers with existing validated sources in already bounded PiSnapshot (existing 1MiB input/256-entry bounds). Guard count/bytes before copies, not after cloning all registry models. Overflow returns capacity/oversize, never first-N presented as complete. Exact human-entered choice can still be checked with getModel; it cannot guess omitted models. If full catalog paging is needed, use bounded deterministic credential-free pages pinned to catalogId/configRev, not an archive scan/cache or raised response ceiling.

catalogId is random owner metadata tied to loaded configuration generation, never auth hash. Entries have **no sourceSelectionId**. Only actual successful select allocates it. Local freshness reads use existing bounded safe-read policy; no auth-status probe.

Proposed finite routes and ownership:

* `GET /api/v1/models` → Reply<ModelCatalog>, authenticated passive read.
* `POST /api/v1/model-choice` → updated catalog/selection. Native local capability or browser cookie + exact Origin/CSRF/attachment. Explicit chooser submit only, no load/reconnect effect. Choice mutation is not credential administration, task action/Start grant or durable execution receipt.
* Add ModelChoicePort to HttpAdapters and typed methods to ServiceTransport/HttpServiceTransport/ServiceClient; routes/decoders/size/mutation classification in service-wire.ts. No generic send and no WS control. Read methods forward optional AbortSignal.
* Lost choice response: observe current selection/revision, never automatic POST replay.

### Atomic quiescent refusal, not retargeting

Choice installation uses loaded runtime synchronously from final busy/version check through validation/allocation/install. Future asynchronous reload would need a configuration reservation before await and repeated validation; do not introduce it incidentally.

Refuse while any admission queued/in-flight original, committed-but-unactivated intent, metadata job, accepted/unallocated episode, scheduler episode/reservation/closing work, queued/running check/review, pending model load/preparation, writer original or owner process/auth/storage/work original exists. Check idle owner/lease/writer fence. Existing admission.accounting, scheduler.accounting and writer.pendingWrites are useful but **not alone sufficient**. No PID-only idle test. Refusal does not revoke grants or stop accepted work.

Existing admission reserves synchronously before awaits. A narrow synchronous configuration guard can refuse when pending admission count is nonzero; no competing async mutex/framework. Successful install advances configRev/catalogId and revokes unconsumed grants before new admission observes old selection. Validate expected epoch/access/config/catalog, validate actual candidate/source, allocate through OwnerModelContext.select, atomically install one active choice. Retire obsolete selection IDs only while quiescent; do not accumulate them indefinitely in #selected. Exact already-current choice may return its existing ID after freshness validation.

Do not persist this in immutable host-config.json or add default fields to cadence-service-host/1. Choice is epoch RAM state. Restart requires choice again. An optional explicit launch-only choice could later extend HostInput, but must not silently update stored config. Invalid existing auth/models/config remains refusal/preserved bytes, not empty catalog.

## 4. Constructor and current-generation owner

Replace TaskActionsOptions.host:ServiceHost with a structural dependency type containing only coordination, owner, writer, reader, models, access and frozen checkEnvironment. Scheduler already has SchedulerOptions. Never cast an unfinished host to ServiceHost.

Replace mandatory selection with owner-private `choice.snapshot(): {selection:ModelSelection|null; configRev:number; checkEnvGeneration:number}`. Construct exactly one TaskActions/Admission/Scheduler; its owner WeakSet makes rebuilding actions on choice change incorrect. Split structural owner/lease/cwd/writer liveness from requireCurrentChoice so no-selection observation works without an accepting placeholder.

Action observation captures/validates one real selection via models.assertCurrent, freezes it into preview/context and checks it again at activation/after awaits. Accepted graph/planner requests use their frozen selection, never a later accessor. Checks use ordinary frozen environment, **no model auth resolution** merely because ContextVersion includes model.

Extract an action-neutral current-observation builder from TaskActions.observe. Use it for ReadEnvironment/current/preflight; do not fake an action to read metadata or use writer.currentContext/old RunIdentity as fresh authority.

**First manual-plan Start seam:** observe(start) currently creates a cached single-assignment default when no saved graph exists. A current context with null graphIdentity followed by a preflight with that default hash immediately stales the displayed context. Common builder must use the same default-identity rule. The bounded RAM default is prospective, not savedGraphRef; full body is displayed in Start preview. UUID eviction/replacement means stale/refetch, not silent rebasing. Saved graphs retain exact stored identities.

Real counters:

* configRev advances on successful choice/relevant explicitly installed configuration. HistoryWriter replays policyGeneration and rejects supplied configRev below it (`writer.ts:177,292–297,425–439`). Expose readonly revision floor from existing replay; initialize boot configRev above it. Otherwise any prior accepted configRev>1 breaks a new hardcoded-1 host. A revision floor is not resurrected selection/authority.
* checkEnvGeneration is an owner counter for launch-frozen ordinary environment. Positive per boot; compare **with epoch/cwdId**, not globally meaningful standalone 1. Only separately authorized quiescent replacement could advance it later. No secret-derived env hash or browser overlays/model-auth merge.
* Fresh epoch/cwdId per owner; checkoutGeneration advances on actual service writers/checks, not view. writer.controlRevision(taskId) supplies accepted-control revision. Progress is not control revision.
* After async reads/before returning mutation-ready context, revalidate lease, applicable access/epoch, raw task revision/identity, role/hint identity, model source, check definitions/generation and observation. Change yields unavailable/stale, not repair/retarget.

Old contexts remain old admission evidence even when readable text/provider/id/fingerprint match. Source-selection UUID, epoch, env and control versions are not fresh. Initially: selected=null, unavailable ControlContext, actions disabled, history/readable current data available. W6 currently captures action capability at session acquisition: refresh capabilities/current context on the same attachment after choice, using its existing refresh path, not a second hidden session or replay.

## 5. Current metadata separate from archive paging

Proposed owner functions: current(taskId|null), currentChanges(taskId), activeRefs(). Compose a narrow CurrentMetadataPort alongside/delegated through ProjectionPort/ReadEnvironment. **TaskActions produces current semantics; HistoryProjection keeps retained reduction.** Shared portable codecs only.

```ts
type SavedGraphSelection =
  | {status:'none'} // proven none, never inconclusive
  | {status:'saved'; request:GraphReadRequest}
  | {status:'unavailable'; error:PublicError};
type CurrentView = {
  storeId:string; workspaceId:string; epoch:string; committedSeq:string;
  context:ControlContext;
  task:null|{id:string; kind:TaskKind; revision:number; identity:string};
  roles:RoleSelection[];
  readablePlan:null|{source:'current-v1'; text:string};
  savedGraphRef:SavedGraphSelection;
};
type ActiveRunRef = {
  taskId:string; runId:string; operationId:string; epoch:string;
  kind:'start'|'generate-plan'|'check';
  stage:'accepted-unallocated'|'active'|'draining';
};
```

`current({storeId,taskId})` must not require an old ContextVersion: first inspection needs to obtain one. Bind response workspace/task/epoch. PlanMetadataPort.read(context) compares exact returned available version; never silently changes expected context. No-selection view can contain actual v1 plan/roles with unavailable authority. Unreadable/oversized selected data refuses, not empty-plan success.

Routes: `/api/v1/current`, `/api/v1/current-changes`; bounded activeRefs in workspace DTO, independent of arbitrary task/archive pages. Reuse `/api/v1/check-obligations`, `/api/v1/graph`, `/api/v1/snapshot` and historical list routes. IDs only, no host-path/expression input. GET/finite readonly POST through existing wire security; read POST is not execution consent.

Bounds: whole current Reply≤512KiB; three pinned RoleSelections, one current plan≤32KiB, one saved graph reference, **no graph body/transcript**. Active refs≤eight admitted episodes including checks once composed. Reserve synchronously at accepted activation before allocation awaits; retain through original settlement. Admission accounting covers the prior commit/activation gap: empty native roster is not idle. Old-epoch unknown history is not a current active ref. Inconclusive current/durable lookup must not claim an empty set; old full runs remain paged.

### Readable current v1 and cold own-publication lineage

TaskStore.loadSnapshot(taskId) supplies current raw identity/revision and readonly plan. Label current-v1 readable text, not privately committed content or imported legacy approval. Sanitize public text using owner policy; if changed by redaction, expose coverage/noneditable status rather than byte-exact editable text (extend the sketch accordingly). Read never calls retainAcceptedPlan/publishTask.

publishedPlan already yields a genuine pre-Start saved descriptor. Return GraphReadRequest with storeId/task scope/snapshotSeq/exact recordId+revision+sha256; existing graph reader/progress owns body retrieval (512KiB graph, 1MiB graph reply envelope). Never put full graph in workspace/current snapshots or fabricate graph membership for a RAM proposal.

**Cold lineage is a real missing proof:** Save's raw-v1 publication identity changes after ordinary summary publication. TaskActions.savedGraph accepts this partly via RAM publications; restart/eviction loses that proof. Reuse OperationState/RunState/publicationTransition in history/run-state.ts and original committed task rows. Establish latest Save+retained content, then exact published expectedRevision/expectedIdentity → nextRevision/nextIdentity chain ending at current raw-v1 identity. Verify intervening accepted operations preserve plan/graph; later Save supersedes it. Pending/conflict/uncertain publication, missing link/external edit/budget exhaustion cannot revive an older Save. Recheck snapshot/source observations around proof.

No second publication reducer or all-history map. Small memo keyed store/snapshot/raw identity accelerates but does not establish proof. publishedPlan currently has no progress result: exhaustion remains receipt-inconclusive, never null. If continuation is needed extend existing navigation/proof machinery within 8MiB/100ms, not a new authoritative cache. Main's private-read cost work is orthogonal.

Proven cold publication continuity still does not restore Start authority. Old saved assignments normally name old sourceSelectionId; readable graph fails exact inheritance against fresh choice. Require explicit rebind/edit and Save revision, then fresh Start. No assignment rewrite/model substitution on read.

### Change body and check obligations

captureChanges (`src/task-diff.ts`) supplies fingerprint/text/complete/git, 128KiB sanitized display bound and explicit bounded-file/Git coverage. CurrentChanges carries task raw identity, epoch/cwd/env/checkout generation, ObservationFact, text/coverage; whole Reply≤512KiB, text≤128KiB, no ContentRef. One capture supplies both context fingerprint and body. Read does not advance generation/publish facts. Label working-copy dirt, not task-attributed complete patch. Accepted work/review changes retain real committed ContentRefs on existing historical routes.

Populate ReadEnvironment.checks from actual bounded configured definitions and a stable revision; preserve not-run. Existing checkObligations checks after observation/checkoutGeneration but **not epoch/cwd/checkEnvGeneration**. Reuse retained check-start/link/admission facts (check-start already has cwdId/checkEnvGeneration) so equal old-boot fingerprints/generations do not appear fresh. Valid same-boot own-check advancement is exactly before+1 with required observation and no foreign intervening generation; later foreign change stales pass without changing native exit/outcome. Proof failure is not not-run. Human review consumes same versions and short exclusive recapture, not a modal-held barrier or rewritten results.

## 6. Bind current W6 consumers, no UI protocol fork

Implement thin adapter for existing PlanMetadataPort at main.tsx/App composition:

1. `read(context,signal?)`: shared current reader, exact available-context comparison, actual roles/current plan, shared graph/progress retrieval if savedGraphRef is saved. After awaited graph reads recheck epoch/version/raw identity. Return existing `{context,roles,savedGraph,readablePlan}`. Inconclusive is not savedGraph=null.
2. `saveAction(context,draft)`: **local proposal only**, using shared bounds/action/graph decoders. Fresh crypto UUID, UTF-8 bytes, SHA256 exact plan → prospective ContentRef. Current task revision/identity and observed saved graph determine revisions (initial 1; otherwise advance graph/plan versions). No network/files/auth/retention. Browser Web Crypto and native hash/UUID can be injected into one portable proposal helper; do not import Node history/plans.ts into web. Server assertPlanContent/retainAcceptedPlan remain authoritative.
3. Do not silently remap old draft assignment models after owner choice. Require explicitly displayed rebind/new draft plus Save preview; one inherited model, no per-node picker.
4. Pass returned ordinary save-plan Action into existing explicit preflight/confirm/submit. UUID/hash is prospective, not membership. Only committed acceptance→retention→expected-byte publication makes graph current. No preflight writes, hidden Save→Start or automatic acceptance of generated prose.

Preserve InspectorPanel exact-context checks, PlanBoard roleForPurpose/current-model use, ViewLifetime and optional AbortSignal around async reads/digests. No-selection UI shows readonly data and chooser without task authority. CheckPanel keeps obligations route; ObservationPanel distinguishes current body from retained changes; sidebar/status uses workspace activeRefs so old pages cannot hide current work. Use existing ServiceClient/ProjectionTracker/WorkspaceObserver, not another reducer/polling system.

## 7. Assets, actual build identity, composition order

`loadWebAssets(directory = fileURLToPath(new URL('../web/dist/', import.meta.url)))` returns `{manifest,assets,identity}` (`src/service-assets.ts`). Manifest: schema cadence-web-assets/1, sourceHash, contractHash, buildId, assets[name,bytes,sha256,references]. identity hashes **manifest bytes**, not buildId. buildId hashes JSON.stringify({sourceHash,contractHash}).

Loader validates nine fixed HTML/JS/CSS members plus 60 finite KaTeX fonts, exact membership (69 assets/70 files), hashes/reference closure/incarnations; 16MiB/member,64MiB total,128KiB manifest. index.html maps to /app, no filesystem URL fallback. Pass assets into ServiceHttpServer constructor **before listen**; configure currently cannot add assets.

build-web.mjs:39–84 computes sourceHash from web/build/package/lock inputs, contractHash from worker-public JS/declaration, service-contract/client/http-client/wire and all service/contracts inputs; injects __CADENCE_BUILD__. web/client/build-identity exposes localBuild or null. build-service.mjs emits external-peer Node service-cli and service-host bundles but currently **no independent service contract identity**.

Minimal shared handshake: closed SessionBootstrap build metadata with loaded manifest sourceHash/contractHash/buildId/manifest identity plus independent service contractHash. Extract existing pure contract-input/hash computation into nonexecuting shared build helper; do not import build-web.mjs and trigger top-level build. Embed service hash at build; source-development host derives same actual readonly source identity or requires a real source-bound input, never copies manifest/client assertion. Require service contractHash==asset contractHash before normal actions. No host-config rewrite.

Browser compares **compiled localBuild** with advertised assets and service compatibility; missing/mismatch disables normal actions with reload guidance. Echoing server ID or compatible=true is not proof. Apply shared compatibility guards to relevant ingress, not buttons only. Compatible explicit Cancel retains independent safety semantics; mismatch never automatically cancels. W5 needs native compatibility consumer; W7 owns rebuilt/extracted evidence.

Composition without casts/default acceptance:

1. Decode existing config; freeze sanitized launch/check environment; validate actual assets/build. Construct HTTP with assets, bind closed before registration/model effects. Preserve existing config conflicts.
2. Acquire lease; create ServiceOwner lifecycle closures referencing explicitly nullable actions/writer/live slots. Quiesce always closes HTTP and calls actions.quiesce once installed. No fake object satisfying ServiceHost.
3. Initialize/open actual history as currently authorized; writer original hooks→owner, then reader/access/auth. Construct/load one OwnerModelContext and track original load as today. Null choice is normal, not swallowed load failure.
4. Build real narrow action dependencies/choice/counters and one TaskActions. Install quiesce before accepting routes. **Actual owner-secret source is another seam:** AccessMaterial has no server-private snapshot API, while TaskActions requires ownerSecrets. Add narrow owner-only sanitizer/secret source plus actual local capability; never pass []/parse token-link/cast private fields. Keep out of public/worker DTOs; rotation must preserve accepted-work redaction and include current owner secrets.
5. Construct HistoryProjection with actual current/check/active callbacks and HistoryLive. Configure HTTP once with real admission/choice/current/receipt/live/management ports. Keep named incomplete actions unavailable; no admitting partial host.
6. Validate owner/writer/build, admit authenticated observation/choice. Task-action capabilities require complete composed paths plus current choice/context. Return full ServiceHost only when constructed. Same-attachment capability refresh must handle initial no-selection→selected.

Missing/bad assets/build is an explicit composition/distribution blocker, not source UI fallback. Invalid selected Pi config preserves refusal/fences. No-selection means valid loaded runtime without owner choice.

## 8. Stop registration seams and remaining blockers

Existing owner APIs: trackWorker(original,stop), trackCheck(original,stop), trackAuth(original,settlement), trackPersistence(original), trackHistory(original,safety). Stop is coalesced, drains originals/flush/listener, preserves fences after uncertain/reporting-expired settlement. Current host only HTTP.quiesce; TaskActions.quiesce closes grants/scheduler, but metadata remains its private promises and accepted scheduler allocation precedes native registration. Per-write hooks do not prove the lifetime between writes has ended.

Add minimal bounded owner-private **accepted-work original** registration with known settlement result and synchronous stop callback. Register before first activation microtask/allocation/metadata effect; include accepted-but-unallocated episodes, metadata, queued checks/review. Native/auth/storage remain independently tracked. Expose internal readonly counts to choice busy guard. Quiesce closes admission/grants/queued work, requests concurrent bounded cancellation, prevents late ordinary publication/launch; only authorized safety settlements continue. Promise<void> resolving after swallowed failure cannot prove clean release: require actual recording/publication certainty.

One lifetime seam, not new scheduler/management framework. Preserve 60s reporting versus settlement, original TERM/KILL/unknown bounds, auth writeback lifetime, lease rechecks and unknown fences. Client detach remains observation-only; no old-queue replay or cancel-on-choice.

**Actionable blockers:** real nullable choice/current composition; busy refusal covering commit/activation originals; configRev replay floor; max-thinking mismatch; cold publication lineage; check epoch/env freshness; initial manual-plan Start identity; actual owner-secret source; independent service build handshake; W6 metadata/current-change/active-ref adapters. W1 outbound-auth proxy/informed recovery, W5 native cutover and W7 final distribution/acceptance stay separate. This report closes none of those runtime gates.

### Inspection identity samples

Source-only SHA256 samples (not executed evidence):

```text
2e63538b2f02cc732a46c6591ff94e7990add0570e4bb97b0444a167bdbd7a9f  src/service/host.ts
cac728f9b70f18f39ae54073ee1c088eb256707364714bc57235b04f7e18d9c8  node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts
```
