# G6 SDK semantic alignment — static engineering plan

## 1. Decision and authority

**Propose a new isolated G installation with modern peers, a small production effective-thinking refusal, and a faithful private model codec.**
Do not upgrade, reinstall or retarget the repository dependency root to make the old bridge work.
This is a plan, not implementation, Cadence acceptance, independent approval or authorization to execute another research model session.
The existing task and intentionally absent pointer remain unchanged.
The current user direction supersedes historical no-archive language only after genuine G6 closure; this research performs no archival.

The smallest expected maintained change set is:

1. `src/sdk-worker.mjs`: check actual public session thinking before READY/prompt; explicitly disable modern automatic cache warming as explained below.
2. `test/lightweight-sdk.test.ts`: additive refusal/success/metadata controls and faithful public-session mock defaults.
3. `.trellis/spec/backend/lightweight-workflow-guidelines.md`: document effective-thinking refusal and the bounded background-request policy.

No parent runner, shell, controller, store, protocol, package manifest, lock, development pin, Agent, generated operator or SDK edit is presently justified.
Only if modern three-OS compatibility is made a required final lane, add the narrowly scoped CI arrangement in section 8.
Private G qualification programs are instrumentation, not new shipped owners or a second executor.

## 2. Immutable starting point and unobserved facts

The supplied current baseline is HEAD `f64fb93fcccf7f54fd23647efe8508f4c0b66c20` and CI38669341877: Linux/macOS582 passed with27 platform-domain skips each; Windows605 passed with4 platform-domain skips.
Its twelve source/extracted × regular/fullscreen cells and27 separate Windows controls are qualified in their recorded domains.
F's fifteen installation probes passed on that baseline.
The current worker was independently rehashed here as `099261e6e7bfa67696fb9c1ee74be839b5bc79fac996b2481dba5cd82ae9766b`.
No CI, installation, archive or original wait was rerun here.

[Original F triage](./g6-current-F-first-real-triage.md) retains producer450391's consumed pre-native failure, source `getAuth` count UNKNOWN and derived CODE Starts0.
[The changed-input observation](./g6-xhigh-user-update-observed-result.md) retains PID467202's xhigh=true, exact selector/500000/128000/reasoning predicates, typePresent/inputLimitsPresent=true, compatSupported=false and canonicalAccepted=false.
That was a valid negative bridge observation with original exit1, not session/inference success.
It does not identify which compatibility key failed, disclose current nested values, establish the original F cause or prove effective session xhigh.
There has been no subsequent actual CODE Start in the supplied history.
Do not repeat either consumed experiment or promote the earlier tiny modern SDK capability to Cadence acceptance.

G6 remains **6/8, OPEN/BLOCKED**, with real workflow/provider evidence missing.
Physical-human is superseded, never PASS; automated evidence remains `physicalHuman:false`.
The438-file original preimage is still unavailable according to existing custody reports; its historical manifest is not a restored backup.
No search for private stores or reconstruction of that debt is proposed.

## 3. Read scope and public-source citation convention

Read the complete task PRD/design/implementation, current workflow/storage/errors/logging/quality/distribution specifications, maintained frontend specifications and shared thinking guides.
Read the complete latest xhigh observation/recheck review, F harness handoff/first-real triage, autonomous approval and preceding closeout/canonicalization reports.
The current instruction, not obsolete physical-human, hard-HTTP/bill-cap or no-archive text in those reports, controls this plan.
The actual sixteen-owner import closure, worker, parent runner, shell, controller, storage, types, diff, independent owners and generated operator composition were inspected.
Relevant SDK tests, native guard and current CI were also inspected.

For citations below, **L** means `/home/mirako/abel/cadence/node_modules` and **M** means `/home/mirako/.bun/install/global/node_modules`.
Paths following L/M are installed public package source/declarations, not private runtime data.
Reading a public export's implementation under `dist` does not authorize importing its private internal subpath.
Use the package's exported root/subpaths in future programs.

Complete relevant documentation read, not merely search excerpts:

- L/M `@earendil-works/pi-coding-agent/docs/sdk.md`, `models.md`, `custom-provider.md`, `extensions.md`, `tui.md`, `settings.md`, `packages.md`, `security.md`.
- M `docs/configuration.md`, `providers.md`, `environment-variables.md`, `sessions.md`, `session-format.md` and the corresponding SDK examples01–13 relevant to models, resources, credentials, settings and runtime replacement; M `examples/extensions/qna.ts`.
- L SDK examples README/02/09/12, and both complete `@earendil-works/pi-ai/README.md` files.

No example was executed.
No normal SDK import, ModelRuntime/model/auth observation, provider/proxy experiment, environment/argv dump, credential/configuration/session-store inspection, installation or product test occurred in this research.
Only this new report is a persisted finding.

## 4. Proven API differences, not current-model guesses

### Public types and exact binding

L has coding-agent/AI/TUI/agent-core0.84.3, typebox1.3.7 and Undici8.9.0.
M metadata establishes the four Pi packages1.2.0, typebox1.3.27 and Undici8.10.2; all six declare MIT.
Both observed Pi/Undici sets declare Node>=22.19.0; Cadence's unchanged engine is>=22.13.0.
Those are metadata facts, not runtime eligibility predicates or proof of every allowed combination.
Cadence has **five direct peers**: coding-agent, AI, TUI, typebox and Undici; agent-core is the separately bound transitive identity.

M coding-agent `dist/core/sdk.d.ts:1–19` imports its `Model` type from public `pi-ai/compat`.
M AI `dist/compat.d.ts` re-exports `./index.ts`, and `dist/index.d.ts` re-exports `./types.ts`.
Thus this is **the same modern Model declaration**, not a second legacy0.84 model representation.
Use root `Model<"openai-codex-responses">` after validated API narrowing; it binds directly to the public session factory and provider APIs.
Do not import a private `dist/types` path, invent a wrapper, use `Model<any>` locally to evade checks, or cast a0.84 model to1.2.
The SDK's own permissive `model?: Model<any>` signature is not a wire validator.

Future compile-only controls should bind a concrete root Model to the compat type and to the exported `CreateAgentSessionOptions`, and pass a typed literal to `createProvider` and `ModelRuntime.registerProvider`.
Build decoded values through validated/narrowed fields or a real checked type guard, not `as unknown as Model`, `any`, a blanket index signature or `@ts-ignore`.
Compile and inspect the full metadata shape, not only structural assignability of three identity strings.

### Actual compatibility of used APIs

| Used boundary             | Installed public evidence and consequence                                                                                                                                                                                                                                                       |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ModelRuntime creation     | L/M coding-agent `dist/core/model-runtime.d.ts`, and JS create at L74/M79: credentials/modelsStore injection, `modelsPath:null`, `allowModelNetwork:false`, `refreshOnCreate:false`, optional signal remain available. Default credentials/configuration are still used when not replaced.      |
| Native provider in worker | L `model-runtime.js:546`, M632; AI `models.js` createProvider at L428/M528. The current worker's model list plus official adapter module and literal resolver remain a public route. M adds mixed operation models; a chat model's defined `type:"chat"` is legal.                              |
| Session factory           | L/M `dist/core/sdk.js`, M87–143 and253–326: an explicit model bypasses initial-model fallback; thinking is nevertheless clamped. The explicit resource loader, in-memory session/settings and existing tool-name lists remain accepted.                                                         |
| Stream instrumentation    | L/M agent-core `dist/agent.d.ts`: constructor option is `streamFn`; public instance property is `streamFunction`. Cadence already correctly wraps `session.agent.streamFunction`. Do not change it to `agent.streamFn` or add an unsupported createAgentSession option.                         |
| Context below Models      | M AI `models.js:444–460` normalizes Context to TranscriptContext before Provider/API dispatch; L dispatch uses Context. Cadence forwards context opaquely to its captured stream, so no production context converter is needed. A private fake provider must honor the matching public version. |
| Parent extension          | L/M coding-agent `dist/core/extensions/types.d.ts`, `model-registry.d.ts/js`: registerCommand/events, TUI mode/trust/idle/queue/current model/thinking, dialog methods, raw terminal input, and `getApiKeyAndHeaders(model)` still exist. M's extra APIs do not require a shell rewrite.        |
| Resource loader           | L/M `dist/core/resource-loader.d.ts`: all methods in the worker's empty loader remain required/compatible. M supports additional built-in extensions, but SDK sessions do not automatically load CLI codemode/MCP. Keep explicit empty resources; never switch to CLI defaults.                 |
| Real native host          | L/M `dist/modes/interactive/interactive-mode.d.ts`: `new InteractiveMode(AgentSessionRuntime, options)` and `run()` remain public. Runtime factory/services/session replacement remain public. Use them, not a fake ctx, redirected-pipe TTY or private renderer fields.                        |
| Cleanup                   | L agent-session JS559–588 and M996–1042 expose dispose and thinking getters; both dispose paths call public `cleanupSessionResources(sessionId)`. M also cancels its cache warmer. Original worker close remains mandatory; dispose is not proof of OS settlement.                              |

Among the sixteen owners, only `sdk-worker.mjs` needs a new semantic guard.
`task-shell.ts` and `index.ts` use the compatible extension/TUI surface above.
The other thirteen owners have no Pi runtime import: controller, store, types, diff, process owner, registry, diagnostics, startup card, three operator owners and two installer owners retain their present responsibilities.
The generated operator has no SDK binding to regenerate for a worker-only change.
Typebox's continuing peer declaration does not justify adding new workflow schemas or tools.

### Modern model fields actually present in the public schema

L AI `dist/types.d.ts:695–715` lacks modern `type`, `inputLimits`, `promptCache` and `samplingParamsByThinkingLevel`.
M `dist/types.d.ts:617–654` includes all of them, with model-schema and compat-schema types publicly re-exported.
The private old bridge expressly refuses defined modern fields; its refusal is not a defect repaired by deleting them.

M `pi-ai/providers/model-schema` is an exported subpath, and its complete source defines:

- `type`, if defined on a chat model, is exactly `"chat"`; preserve absence separately from a defined value.
- `inputLimits.maxRequestBytes`; `images.maxPerMessage`, `maxPerRequest`; `images.resize.maxWidth`, `maxHeight`, `maxBytes`, `jpegQuality`.
  These are positive integers, with jpegQuality1..100.
- `promptCache.short/long`: positive finite seconds when defined.
- Full four cost rates and every cost tier/threshold; all seven thinking-map keys with string/null semantics; both sampling dictionaries including every defined JSON value.

M `providers/compat-schema.js:208–247` / corresponding declarations define ten Responses compatibility properties: `supportsDeveloperRole`, `supportsMidConvoSystemMessages`, `sessionAffinityFormat`, `supportsLongCacheRetention`, `supportsStrictMode`, `supportsOpenAIGrammarTools`, `supportsAdditionalTools`, `supportsToolSearch`, `supportsExplicitPromptCacheMode`, `supportsMaxOutputTokens`.
The two latter/new transcript/output distinctions absent from L's complete Responses declaration must not be lost through an old allowlist.
These are library capabilities, **not a claim that any particular one is configured on the current selected model**.

The public compat schema permits additional properties; do not falsely describe it as closed.
A finite private codec may refuse undeclared/unrepresentable extras explicitly, or preserve allowed extras as bounded strict JSON under that schema; it must never silently remove them or claim broader semantic support.
For G, prefer preserving schema-permitted JSON extras while validating every declared field and refusing non-JSON data.
Unknown top-level model extensions outside the reviewed concrete contract still require explicit refusal/review, not speculative universal support.

## 5. Minimal production semantics and regressions

### Effective thinking: fail before READY and first prompt

The worker currently passes `thinkingLevel ?? "off"` and checks fallback/id/provider/api only (`src/sdk-worker.mjs:250–282`).
Both SDK factories clamp requested thinking (L sdk.js134–137, M140–143).
Both actual public getters return `agent.state.thinkingLevel` (L agent-session.js587, M1041).
AI's `getSupportedThinkingLevels`/`clampThinkingLevel` implementations (L models.js548–577, M680–709) can clamp upward across a hole, downward, or to off for a nonreasoning model.
An options echo, xhigh metadata flag or identity match therefore does not prove the effective session level.

Capture the requested value once as `thinkingLevel ?? "off"`, pass that same value to createAgentSession, assign `session = created.session`, then compare **one public getter read** against that exact captured value.
Place this beside the existing session substitution check, before stream wrapping/subscription/READY/prompt.
A missing, wrong, null or nonstring effective value refuses by strict inequality.
If the getter throws, catch without inspecting the thrown value and issue the same fixed refusal.
Use existing stage `session` / class `model-substitution`, first-fault handling and nonzero cleanup path; do not create a thinking-specific protocol/diagnostic field or emit either value.
Never call setThinkingLevel, lower the request, fill a missing xhigh mapping, substitute a model or retry to repair mismatch.
There is no need for a reusable guard framework or capability/version predicate.

Additive controls in the existing SDK test owner:

1. Public-boundary mocks: exact match including absent-request→off succeeds; mismatch/missing/null/throwing getter refuses before subscribe/READY/prompt/stream; getter is read once and opaque exception properties are read zero times.
2. Keep every old mock lane reachable by giving its fixture session the public effective getter corresponding to its create options.
   Update the three existing fixture constructors, not production code to tolerate an absent getter.
   Preserve existing hook, event, diagnostic, cleanup and original fault assertions.
3. Genuine stock-worker/native refusal: a fabricated nonreasoning model requested high/xhigh, plus a reasoning model with unsupported xhigh, clamps in the real public SDK and refuses with empty stdout, actual nonzero close, zero loopback requests, no file/tool writes and fixed bounded stderr.
4. Genuine known-model xhigh success: fabricated valid reasoning model with defined xhigh map, guarded loopback response/tool-result cycle, actual zero worker close and empty success stderr.
   Check effective wire effort without weakening exact tool/result/auth/file assertions.
5. Separate actual public SDK construction control: pass the rich1.2 literal model, assert deep equality of **exact `session.model`** to the effective request-model literal and `session.thinkingLevel === "xhigh"`, then dispose.
   This is real in-memory SDK construction, not a mock/options-only assertion and not normal-profile observation.
   Keep it separate from the stock-worker wire receipt; no production diagnostic fields are needed.

The test's existing effective model projection is intentional: resolved auth baseUrl overrides model baseUrl, and resolved model headers are removed before literal resolver use.
Compare the complete resulting model, not the original pre-auth endpoint/header record or merely provider/id/api.

### One additional modern behavior that should not be inherited accidentally

M SDK `sdk.js:186–214,253–272` creates a cache warmer and starts it from its stream closure.
M `settings-defaults.js:59` defaults `cacheWarming` to `"streaming"`; complete `core/cache-warmer.js` shows scheduled public `models.streamSimple(... maxTokens:1 ...)` requests when metadata/economics permit.
It does not use the worker's outer stream wrapper, and PI_OFFLINE is not a guard in that class.
Compaction/retry=false alone does not disable this new automatic activity.
Whether the current model has an eligible TTL/economic result is UNKNOWN; do not inspect configuration to decide.

Smallest faithful policy: add public `cacheWarming:"off"` to the ephemeral worker's in-memory settings and private G host settings, while preserving the model's full `promptCache` metadata.
This changes background scheduling, not model identity, thinking, transport, inference token limits or cache metadata.
L's inMemory implementation clones/preserves otherwise unused settings; its worker is JavaScript and has no need for a cross-version Settings cast.
Add an exact settings assertion and a finite modern public-SDK control demonstrating warming disabled with eligible fabricated metadata; keep the existing compaction/retry assertions exact.
Do not erase promptCache to avoid the behavior, invent request-count guarantees, or build a request-budget executor.

### Contracts that must remain byte/behavior bounded

Keep ready/tool/final keys, no new event fields, input128KiB, aggregate256KiB, pending/line64KiB,4096 events/frames, final16KiB, worker timeout and1000/3000ms stop policy.
Keep exact fixed diagnostic keys, at most two512-byte snapshots, first failure, privacy and cleanup bitmask0..15.
Owned Undici close must start and be rejection-handled before independent unsubscribe/abort/dispose; all attempts remain independent, including pending cleanup.
Do not restore or close an unowned dispatcher.
Success stderr stays empty; preserve the narrowly recognized original-PID runtime-warning codec and every invalid-warning assertion, not a blanket warning filter.

Retain all seven guarded success lanes (key/tool-result, headers-only, diagnosis/planner readonly, fabricated OAuth Codex, resolved baseURL/null-header, Azure-env), strict raw-canary and no-discovery/install controls.
Retain genuine DIRECT sink>0/proxy0/CONNECT0 and VALIDATED_PROXY sink0/proxy>0/exact CONNECT>=1/fixed502, with actual native nonzero close, EOF/input/no-force facts.
Also retain successful plain/gzip fake-loopback proxy controls; CONNECT502 alone is routing, not response or inference success.
No forced SSE, global fetch/WebSocket replacement, TLS workaround, alternate Node, private Symbol, private SDK import, auth weakening or larger deadline belongs in this candidate.

## 6. New G installation without disturbing old consumers

E/F/H roots attach repository node_modules; changing that root would retroactively change their effective dependency identities.
Do not run an in-place install, update, peer swap, link retarget or lock regeneration there.
Do not alter M's trusted global packages either.

After independently reviewed production edits and whole verification, create one fresh owned G consumer and isolated HOME/agent/state/config/cache/temp directories.
Perform one actual automatic offline manager installation of the **new audited candidate tarball**, not a source copy called an install.
Reuse the established exact-tar/offline/no-audit/no-fund/no-update/no-retry lifecycle procedure with an exclusive once marker and original manager wait.
Cadence's automatic missing-only hook must actually execute once; manual hooks remain0.
Retain any install/observer failure before a changed-input correction, without reinstalling just to repair an observer.

Attach six explicit trusted modern identity slots beneath G's own peer root: coding-agent/AI/TUI/agent-core1.2.0, typebox1.3.27 and Undici8.10.2.
The five direct peers satisfy the existing declarations; the sixth slot binds agent-core identity rather than adding a product peer.
Existing trusted package links may be used read-only; this is an offline Cadence installation with explicit existing peers, not a claim to have installed the SDK or fetched dependencies.
Use package-specific targets or a new isolated scope root, not the old repository scope link.
Verify host, extension loader and worker-relative resolution, including peer-internal AI/agent-core/TUI/typebox/Undici resolution, to prevent a mixed modern/legacy graph.
Do not assume six top-level links alone prove transitive identity.

Audit independently specified34 regular bodies, all16 source bodies and three Agent pins before/after attachment and probes.
Record the changed worker/new tar identity; unchanged membership is not body equality.
Trusted package-store nlink2 is distinct from owned single-link source/archive/receipt requirements.
Re-run G's retained fifteen finite installation probes on the actual candidate with genuine SDK fake-loopback tool-result, literal-auth, readonly and plain/gzip controls.
Add modern metadata/effective-thinking observations without reclassifying extra internal assertions as extra installation invocations.
Require original worker exit0 before host teardown; an outer host0 or install0 cannot supply it.
Old E/F/H installations and markers remain untouched and historical.

## 7. Private G host/producer/real-PTY plan

Clone the reviewed architecture into **new** owned `producer.mjs`, `interactive-host.mjs`, `real-pty.py`; preserve predecessors byte-for-byte.
Keep finite offline controls/compile-only contracts as test material, not another executor.
Bind the new source freeze, archive, installed G bodies, six modern peer capsules, program hashes, native evidence domains and original wait receipts in new gates.
Publish genuine independent review before parent-only gates and the once marker; never rebind an old PASS to changed programs.

### Full wire and modern host

The old producer's `canonicalModel`, `bridge` and normal source factory were inspected directly as program text.
Use the same normal global1.2 source factory in a future admitted branch only: normal configuration/default credentials internally, in-memory model store, no initial/model catalog refresh, one public source getAuth with the shared30s deadline.
No direct store reads or another capability diagnostic precedes it.
Constructor-internal auth/network/billing stay UNKNOWN; source-explicit call counts must be distinguished from memory-host/worker resolver calls.

Replace only the obsolete private representation restrictions with the full concrete1.2 codec from section 4.
Preserve all defined data through independent pre-auth, resolver-argument, post-auth source, wire and host snapshots.
Only declared optional object positions may equate own undefined with absence.
Preserve false/0/empty strings, thinking-map null, JSON sampling null, nested limits, all cost tiers and full compat; never coerce or default defined values.
Required undefined, undefined dictionary entries, functions/symbols/BigInt/nonfinite numbers, sparse/extended arrays, cycles, getters and unsupported prototypes refuse without reading exception properties.
The canonical model/auth stays in bounded RAM and anonymous descriptors, never disk/log/hash.

Exact binding is source effective model → typed wire → modern host static registration → complete selected model → exact public host `session.model`/thinking → production WorkerRequest → literal native worker session.
Keep500000/128000/reasoning/xhigh unchanged for this qualified selector, not as a universal provider rule.
Retain equality/freshness before and after source auth; give its resolver an independent validated copy so argument mutation cannot corrupt the retained preimage.
Refuse virtual/custom-function routing or identity/API change; no catalog-model substitution.

The host must still use public **static** `ModelRuntime.registerProvider` and unmodified `ModelRegistry.getApiKeyAndHeaders`, not register a native provider and bypass Cadence's native-transport refusal.
M `provider-composer.js:132–148,180–190` uses `extensionModelFromDefinition` for this public registration and spreads the complete chat definition, preserving type/inputLimits/cache/per-thinking sampling/compat.
Do not confuse it with the distinct `modelFromJson` projection at83–115, or write a models.json file.
Use the established reversible leading-!/$ literal escaping only for this static config's string values and prove the resolved snapshot equals the original literal auth.
Auth.env remains in an in-memory credential/resolver snapshot, never process-env promotion.
Production worker registration remains its existing native-provider/literal-resolver route.

Important narrower auth boundary: public ModelAuth headers permit string/null, but host static ProviderConfigInput headers are string-only.
Carry nullable auth faithfully in the wire; do not cast null into that configuration or convert it to an empty string/absence.
If an actual snapshot cannot be represented by this unmodified public static host, refuse before native Start and report that precise representation limit.
The stock worker's successful null-header lane remains mandatory and is not evidence of every host-static auth shape.
No current normal nullable-header value was observed here.

Close the separate anonymous literal-auth FD **before** tools, resources, trust admission or terminal operation.
Suppress discovery during reload, load only G's exact installed absolute entry, then admit only the owned fixture to trust.
Use in-memory settings/session, empty initial parent messages, explicit regular/fullscreen choice, public AgentSessionRuntime and InteractiveMode.
Check full host session model equality and actual xhigh before any Start; preserve the complete request-model/session1.2 metadata check separately for the child boundary.
Do not infer actual reasoning tokens or provider acceptance from these getters.

### Finite offline admission before service use

On the final G freeze, run genuine SDK fake-loopback/compression/literal-auth/tool-result/readonly controls, then the retained native-UI33/observer28/correction36/egress60 suites with their original bounded assertions.

Add only targeted full-model, effective-thinking, G resolution/custody and host-static representation negatives.

A rich defined1.2 model must traverse the actual host bridge and session successfully; testing optional-undefined fields alone is insufficient.

First-failure publication, consumed-marker reentry, malformed frames, getters, source mutation, missing gates, unknown cleanup and original-worker observation controls remain fail-closed.

Review retained existing immutable results rather than blindly rerunning old input matrices; changed G bindings require fresh G controls, not retries of F.

Independent review must inspect actual final summaries and original waits, not just test totals or copied gate objects.

### One actual cycle, only after every prerequisite PASS

Future once-only G operation uses normal public auth30s, code90s after fresh native Start, shared view15s, normal quit15s, bounded checks1000ms and key40ms/Escape100ms pacing.
No Generate plan, Continue, automatic retry, replacement failed attempt or forced inference.
The public fixture goal is a real standard write producing exact `QUALIFIED\n`, with the public sentinel unchanged.
Then require real SDK tool-result follow-up, valid bounded final, original worker close0 before parent checks/host teardown, actual parent PASS/intentional FAIL/canceled/unrun obligations, diff/issues review, inert history and original unforced waited quit.
Do not require a magic final prose string.

Observe via existing passive public process/protocol boundaries; do not export raw provider/tool/thinking/error payloads to prove the loop.
Public SDK loop source plus real write/post-tool final/worker0 corroborates tool-result follow-up; it is not a measurement of exactly two network requests.
Persist only validated fixed facts, safe fixture/check/terminal observations and original wait/EOF/force facts after RAM-only redaction.
Reject unexpected stderr/unknown fields/overflow; do not retain or hash rejected raw real-service streams, route/auth/model endpoint values or opaque errors.
A subscription response is not a cash invoice; hidden requests, billed tokens, quota and cash remain UNKNOWN unless independently observed.
No exact HTTP/token/USD cap is invented from one Start or maxRetries0.

## 8. Native domains and optional modern CI lane

The required current-candidate three-OS CI must run again after any worker change, even if the patch is only a getter comparison.
Prior38669341877 qualifies its old worker and0.84 peer graph, not the new worker or modern1.2 on any OS.
The minimal existing-criterion plan is new final-candidate0.84 three-OS evidence **plus separately labelled modern1.2 local Linux G evidence**.
This can support only those precise domains; it must never be summarized as modern1.2 three-OS qualification.
No installed-public API or wildcard-peer declaration proves every compatible host/version combination.
Freeze this domain interpretation explicitly in the new map/review before paid use, rather than silently merging peer domains.

If the final criterion instead requires the **same candidate on modern1.2 across all three OSes**, add a separate compatibility matrix job, not an in-place devpin upgrade:

- Minimal optional maintained delta: `.github/workflows/ci.yml` plus one excluded `scripts/ci-modern-compat.mjs` bootstrap/reuse harness.
  Leave the original job, baseline lock install and15-minute timeout unchanged; give each separate compatibility job the same15-minute ceiling.
- Allocate a fresh canonical owned peer/snapshot root per OS.
  Install/resolve the six explicit modern identities there using normal reviewed CI dependency acquisition, isolated configuration/cache and disabled dependency lifecycle scripts.
  Bind its resulting lock/integrities/resolution identities as CI artifacts; do not change the source package/lock or repository node_modules.
  This CI acquisition is not the offline local G manager-install lane.
- Existing tests hardcode package-relative node_modules/CLI paths.
  A plain NODE_PATH override or six links beside a source symlink is insufficient.
  Make a finite byte-verified snapshot of required current source/tests/scripts/content/configuration under the new root, excluding Git/private stores and the original node_modules; give that snapshot its own peer tree.
  Reuse existing compiler/test tooling read-only without importing an old Pi peer through it.
  Assert worker/host/extracted resolution identities, including peer-internal edges.
- Run the affected type/API contract, SDK/refusal/routing/plain-gzip controls, shell binding, distribution and shared source/extracted regular/fullscreen terminal scenarios there, including genuine Windows ConPTY controls on Windows.
  Reuse existing assertions and budgets, not a second full verification framework or duplicate whole unrelated skill matrix.
  If the chosen criterion says full modern suite, actually run it; a focused lane must be named focused.
- Keep uploads finite and sanitized under its owned temp root with peer-domain labels; retain first failures and original waits.
  Unavailable prerequisites fail/unqualify the required lane, not version-skip it or substitute Linux/static/pipes evidence.

No CI changes or native execution were made by this plan.
Do not spend time rerunning an unchanged full matrix for this documentation-only research.

## 9. Ordered future validation and genuine closeout

1. Implement only the reviewed minimal maintained semantics/tests/spec; independently review both public peer domains and privacy/cleanup.
2. Freeze changed inputs; run focused new controls, then whole `bun run verify`, separate `check:agents`, distribution and a separate real pack/every-body/Agent-pin audit.
   Retain first failures; a focused or modern-local success is not whole verification.
3. Qualify the new automatic offline G install and full modern finite SDK/host controls, binding the actual candidate tar and peers.
4. Obtain current-candidate native CI on Linux/macOS/Windows and distinct Windows ConPTY evidence.
   Add modern three-OS evidence only if required under section 8; do not fabricate it from the baseline lane.
5. Independently review G's final three programs, complete model/auth representation, descriptor closure, finite native controls, installation, current native evidence and original waits.
   Only then publish new parent-only gates and execute the single actual G CODE Start.
6. Independently review the actual real outcome and custody; failed/unknown/nonzero/forced outcomes remain failed/unknown and consume the marker.
7. Create a **new** current evidence-bound map with explicit peer/platform domains and all required criteria/lanes/checks actually PASS.
   Preserve historical maps, failures, markers, source identities and missing438-preimage debt.
   Run the final traceability check with `--map <new-map> --require-passed` and require original exit0; reference validity alone is insufficient.
8. Only after every required gate, actual provider workflow and final map check PASS, perform genuine **G6-only archival** under the latest user authority.
   No other task archive, publication, consumer cleanup, old-history migration or restored-preimage claim follows.

## 10. This report's verification

This delegation performed static reads and public-package metadata/worker hashing only.
It implemented none of the proposal and made no new capability, auth, inference, installation or platform observation.
Only this newly named report was written; no task was created or activated and no source/Git/index/CI/old record was changed.
The first scoped nonwriting Markdown check exited1 with twelve findings: eleven table-alignment findings and one sentence-layout finding.
Only this new report was reformatted; that first failure remains recorded here.
After that report-only correction, `rumdl check --no-cache --no-exclude <this-report>` returned exit0 with no issues.
This is documentation validation only, not a new product or G6 PASS.
