# Disconnected Planning Host — A/B/C and D Candidate

Candidate-only convergence: the appended scenario owns the reviewed isolated composition.
Earlier checkpoints remain historical, not LIVE integration or acceptance.

## 1. Scope / Trigger

Read before changing `src/task-planning-tools.ts` or the integrated active-model-turn lane in `src/task-session.ts`.
The isolated installer now registers one combined A/B/C schema: A status/read/list/literal-search remain unchanged and usable in recognized context-only conversations; B authoring-view/propose/artifact/retry-publication require explicit attachment.
B's integrated negative lifetime is independently reviewed on **Linux x64 Node 26.7.0 / Pi 0.84.3**; original H1/H2 safety assertions now pass with historical reds preserved.
B/lifetime has qualified disconnected acceptance under the authoring guide below; whole G2 remains **unaccepted and disconnected**.
D1/H3, A/N1 and R1/R2 remain mandatory, not waived by lifetime accounting.
The historical integration-readiness verdict was for main-owned full gates/real pack, not release or whole-G2 readiness.
C and its bounded C4 codec/fixture amendment have [qualified disconnected acceptance](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-c-acceptance.md).
Historical **3537 passed / 21 existing skips / 123 exact archive members** qualify that composition only, not fresh D gates or a latency guarantee.
[Fixture qualification](../backend/quality-guidelines.md#scenario-c4-native-fixture-emission-and-closure-acknowledgement) owns the test-only loader and contender contracts.
C supplies attached-only unfulfilled objective questions, structural/request views and one inert local pending review, not an evidence provider, fulfillment, semantic certifier, source acceptance or review consumer.
Do not activate or recommend B in production.
The installer does not activate ordinary chat or `src/index.ts`; the separate unaccepted D registrar composes Create/Return without evidence/source acceptance, review pager/compiler/issuer/executor.
[Authoring primitives](../backend/task-authoring-guidelines.md) documents actual wire/storage/publication contracts, not production authority.
[Session Adapter](./task-session-guidelines.md) still owns idle Open/reconstruction; [Source Host](./task-source-guidelines.md) retains accepted native N1, expiry/capacity and pending-live-input rules unchanged.
The two historical v1 failures remain history, not repaired negatives.

D's [Gate 2b candidate](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate2-loop-checkpoint.md) composes the actual disconnected registrar/Create/Return with this installer.
R1–R3 and the later [R4 negative-lineage corrections](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-r4-checkpoint.md) are independently reviewed; maximum-history/timing gaps keep R4 open and Gate 2/D/G2 unaccepted.
The approved inventory-count correction closes only collection; [fixture qualification](../backend/quality-guidelines.md#scenario-c4-native-fixture-emission-and-closure-acknowledgement) records its independent review.
The [approved registry seam](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-registry-seam-approval.md) changes exactly one installer call to `owner.installPlanning(controller.state, project, check)`; existing check/observe/project/schema/reference/membership/dispatch policy is unchanged.
The owner captures that checker once.
Projection is still notification, not a success certificate; [Session Adapter](./task-session-guidelines.md#entry-and-live-use) owns ordered startup and terminal admission.

The host uses installed **Pi 0.84.3**.
Newer global documentation is not an API or failure-ordering override.
This is observed-event/current-state enforcement, not physical-human or SDK-caller authentication, a hostile-JavaScript/OS sandbox, complete foreign-work accounting or hidden-ABA detection.

## 2. Signatures

```typescript
installTaskPlanningTools(pi: ExtensionAPI, { owner, controller }): void
// owner: ReturnType<typeof createTaskSessionOwner>
// controller: structural { state, dispatch(taskId, request, guard, work?),
//   dispatchAuthoring(taskId, request, scope), dispatchPlanningC(taskId, request, scope) }

owner.installPlanning(state: Readonly<ResolvedStateRoot>, onProjection: () => void, registryCheck?: () => void)
owner.installShell(): void // Pre-start no-executor inspector, NOT a registrar.

// Private codec, not an exported specialization/caller-permission API:
boundedPublic(value: unknown, sameObservation?: {
  root: ReturnType<typeof createTaskAuthoringParameters>; json: string;
}): string
```

Construct the session owner first; install once before startup, with field-equal resolved state.
The controller's frozen `state` is a detached copy, not necessarily the owner's object reference.
D requires **owner discovery → installer baseline → shell startup admission**; missing/nonvoid/throwing checker refuses without thenable assimilation and stays refused.
Standalone two-argument composition remains compatible but grants no terminal entry.
The shell pins command/manager/session identities only at startup and revalidates, never lazily recaptures them; final original `planningEpoch` checks follow all callbacks, not only the checker.
Fresh final authority uses the fresh owner's checker after its own startup.
Original pre-start provisional setup remains context-only under exact family/phase guards; neither outgoing checker nor projection can authorize it.
The retained synchronous A dispatch contracts are in [Readonly Observation](../backend/task-observation-guidelines.md); B dispatch is asynchronous through `TaskAuthoringExecutionScope`.
Installer-local `ControllerPort` permits its dispatch result or a Promise of that result solely for trusted in-process resource-lifetime composition/tests; it is not a model executor flag or production async worker framework.
The installer captures dispatch methods (C is invoked with the original controller receiver only on C dispatch); model JSON cannot choose a body, task, root, operation outside the closed union or private exclusions.

`installPlanning` returns this code-owned seam, not a serialized permit:

| Method                                                                             | Contract                                                                              |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `restricted()`, `projection()`                                                     | Restriction predicate; `ordinary` / `usable` / `blocked` projection                   |
| `observeAvailability()`, `revision()`, `revoke()`                                  | Known work/current-fact observation, generation, immediate authority revocation       |
| `observeRun(ctx)`, `observeTurn(ctx, turn)`                                        | Pin observed signal/run and finite nonnegative safe turn index                        |
| `endTurn()`, `endRun()`                                                            | Retire authority, never settle active work                                            |
| `start(ctx, id, name)`, `end(id)`                                                  | Reserve bounded start correlation; end retires only unused candidate                  |
| `admit(ctx, id, name, input, bytes, registry, operation)`                          | Hook pins post-validation object/canonical bytes and checked structural facts         |
| `execute<T>(ctx, id, input, bytes, signal, registry, body, operation): Promise<T>` | Consume existing pending candidate once; track actual body/promise through completion |

`registry` is an internal synchronous check; body receives `(taskId, guard, scope)` from the owner.
`operation` is independently decoded at hook/execute, not a caller writable-permission flag.
B scope supplies `bindingEpoch`, exact internal `lifetimeWork`, `guard`, `withStore`, `committed` and `setReleaseCheck`; A dispatch also receives exact optional work.
All are code-owned and absent from model JSON.
Do not call these methods from model data/history or create a second admission lane.
`withAttachment` remains synchronous **idle** mutation admission with its original source/native guards; no fake idle or `allowBusy` option is introduced.

The session owner has one private write-once inspector cell for both constructor-supplied `TaskSessionSettlement` and `installShell()`.
Shell installation takes no adapter, requires prior planning installation and a live pre-start owner, and refuses prior/invalid external adapters, repetition or late installation.
Callable own-data methods and original receiver are pinned; every dispatch validates both current method identities without invoking accessors/replacements, and rejects reentrancy.
No method is read later from `options.settlement`; malformed supplied installation stays unavailable rather than selecting a default-success adapter.
[Session inspector contracts](./task-session-guidelines.md#pinned-planning-only-inspector-and-exact-self) own the complete phase table and footprint.

## 3. Contracts

### Pure preparation, then independent hook and execute checks

Register `cadence_task` with `executionMode:"sequential"`, fresh frozen private `createTaskAuthoringParameters()` output, and internal `prepareArguments: decodeRequest`.
Preparation tries `decodeTaskPlanningRequest`, `decodeTaskAuthoringRequest`, then `decodeTaskPlanningCRequest`; the combined schema contains unchanged A variants, four B operations and two C operations with C sections extending authoring-view, with `additionalProperties:false`, required bounded integers/strings and literal variants.
The factory is called once before baseline capture; no dynamic registration or schema-identity fallback is permitted.
Preparation performs descriptor/cycle/UTF-8/envelope preflight and returns detached strict-schema-compatible plain data **before** Pi clones/schema-validates it; no authority, context, I/O, registry or run-cap side effect belongs in preparation.
Reject unsupported/future ops and malformed/coercion-shaped values with exactly plain `Error("task-record-invalid")`, without submitted values or parser text.
Prepared values must pass SDK validation unchanged in value; do not depend on schema coercion or widen the union to mask a mismatch.

Installed `pi-agent-core/dist/agent-loop.js` orders execution-start, preparation, validation, tool-call hook, abort/block handling, then execute.
`core/tools/tool-definition-wrapper.js` preserves preparation and supplies the fresh execute context.
Pin the **post-validation hook input object**, not raw/start/preparation object identity.
Hook and execute independently decode and compare canonical request bytes; a later handler's mutation or replacement rejects.
Repeated/raw/wrapped direct execute cannot allocate admission.

Success is detached `{content:[{type:"text",text:canonicalJson(value)}], details:{}}`, with the actual serialized whole envelope ≤65536 bytes and no large duplicate details.
A observation reserves JSON-as-text expansion at 32512 bytes; B bounds section pages/results separately.
Whole SDK-envelope checks still apply after A, B or C dispatch.
Owned failures throw fixed code-only errors so Pi emits `isError:true`, not error-looking success prose.
Original model arguments already in Pi history, host lookup/truncation errors, foreign preparation/output and later transcript cloning are outside this bounded diagnostic promise.
Descriptor rejection does not contain arbitrary trusted Proxy JavaScript.

C dispatch selects by decoded operation **and section**; ordinary B authoring-view stays B. The combined schema has **ten alternatives** (four A, four B, request-evidence/review); this is not the count of registered tools.
The qualified nine-tool SDK fixture measured **44411 JSON UTF-8 bytes / 2806 raw nodes / depth 32**.
Descriptor copying skips eight undefined metadata properties (2798 visited nodes); no cap changes or spare depth follow.
C0 substituted-schema prototypes are fit checks, not runtime qualification; foreign registrations are not guaranteed headroom within unchanged 65536/8192/32 bounds.

### Registration identity and controlled membership

Before taking any ordinary baseline require the public registered `parameters === ownedParameters`, matching frozen schema content, name/description/guidelines and bounded public metadata.
Only then capture `sourceInfo`, all schema references, registry projection and ordinary active names excluding the optional task tool.
Installed `core/agent-session.js#getAllTools` creates fresh projections while retaining definition parameter references; loader/runner select extension definitions, and SDK custom tools can override them.
Compare references/metadata, not ToolInfo object identity, name/hash or assumed load order.
An equal-shaped but distinct earlier registration fails; no private runner probe or invented provenance fallback is permitted.

Snapshots allow at most 256 registry/active tools and 64 KiB public metadata, with bounded descriptor-only copying (8192 nodes, depth 32); no execute/provider payload retention.
Check at startup/transitions, hook, execute and release against the last controlled projection.
Observed replacement, remove/re-add, provenance/schema change, duplicate names, oversized metadata or foreign membership drift latches conflict and revokes the lane.
**Do not overwrite the foreign active set to hide conflict.**
Hook denial remains even when other tools are visible.
Hidden ABA/indistinguishable replacement and trusted JS borrowing the public schema object are not contained; this is not a registry certificate or tool-set CAS.

Ordinary startup removes only `cadence_task`, preserving ordinary tools/chat.
Usable selected context exposes only `cadence_task`; ambiguous/busy/transition states expose none where the projection remains controlled.
The restriction predicate includes context-only/attached/restricted state, entry/source waits, movement/departure, uncertain/failing fences, settlement and actual read work; `view()` alone is insufficient.
Before-navigation never restores business tools.
Later cancellation retains restrictions and revoked authority.
After task departure, only proved settled successful same-owner tree navigation into ordinary context may restore the unchanged, still-registered baseline after registry/membership checks.
An ordinary Open wait dismissed before attachment can also restore its checked ordinary membership; cancellation of task departure cannot.
Replacement owners establish their own configuration; outgoing snapshots do not overwrite it.
D Return adds the exact fresh post-parent-close path, not an outgoing restore.
The owner's `projection()` pins planning/attachment/source generations before callback-bearing root observations, checks them in its pure tail and checks the exact temporary restoration scope/deadline.
Thus the installer's last projection refuses **before** ordinary `setActiveTools` on matching-value reentrant revocation or expiry; a later error result would be too late.
Create/Open/Return await their exact fresh reaction after real child/body/coordinator/core closure before public success.
`postClose` is ordering acknowledgement, not closure evidence or a new retry/timeout/lifetime permit.
Original final-callback failure, including a consumed duplicate whose error is swallowed, must poison the exact handoff before that registered reaction runs.
An original navigation rejection/cancellation after final commit likewise revokes fresh projection; exact `attached`/`returned` body results are necessary negative screening only, never positive authority.
Fresh registry/epoch/deadline/manager checks and actual parent closure remain mandatory; durable arrived facts cannot restore tools.
[Session handoff contracts](./task-session-guidelines.md#exact-original-open-handoff) own these latches; [Return contracts](./task-session-guidelines.md#d-return-and-final-ordinary-projection) own fresh ordinary projection.

### Same-call bounded copying and serialization

`boundedPublic` validates/copies the complete raw graph before detached serialization: 8192 nodes, depth 32 and 65536 bytes remain unchanged.
Invocation-local primitive string facts, JSON quotations and flat chunks reduce repeated computation only; every occurrence still spends its raw budget.
Preserve node-increment/type/depth, prototype, array length, keys and own-descriptor observation/error order, including ordinary Proxy reflection/throws.
Aliases are revisited, not a seen-once budget shortcut; cycles refuse.
Symbols/nonenumerables stay ignored; enumerable undefined skips key accounting and recursion.
Raw accessors/toJSON are not invoked by copying; key-byte reuse must not validate a lone-surrogate string value.
Null-prototype objects receive assignments only after child copying; arrays retain defineProperty to bypass inherited numeric setters.
Dense serialization preserves UTF-16 key sorting, primitive escaping/number formatting and final actual UTF-8 byte checks.
**Any skipped array undefined selects the original canonicalJson for the whole graph**: retain historical holes/truncation (including `[,null]`), inherited HasProperty/Get behavior, mutations and throws, not a “cleaner” JSON replacement.
The actual whole SDK result envelope still has its separate 64-KiB limit.

Only `observe` constructs `sameObservation`: freshly serialize the private `ownedParameters` at the original short-circuit comparison position, then pass that exact root/string pair into this observation's metadata copy.
The zero-input TypeBox/plain/dense factory and code-owned recursive freeze establish eligibility, not `Object.isFrozen` on arbitrary input.
Every raw schema occurrence is still reflected, copied and budgeted again.
Mark only completed **detached copies** whose original is that exact root; only their serialization may substitute the freshly produced string.
Equal-shaped foreign roots remain ordinary inputs; result serialization uses the default one-argument path.
All maps/marks die with this call: no baseline-string, cross-call registry, private/live-fact, permission or witness cache.

Public getter reports are not an atomic registry certificate.
SAME-P0-1 is the preserved preexisting case where the last membership getter changes foreign description metadata **after its last relevant observation**, without reporting that change in this call; neither old nor amended codec detects it at that boundary.
Actually returned changed metadata/membership still refuses; this limit does **not** excuse delivered revocation or changes to private records/outbox/files that the explicitly later H3 checks must reject.
It grants no blanket JavaScript waiver, hidden-ABA containment, Source/native visibility guarantee or whole-G2 qualification.

### Run, currentness and release

Owner handlers register first.
They invalidate native choices and the integrated lane before lifecycle fences/awaits; installer observes startup/tree after restoration and agent-start after native invalidation.
No universal ordering against foreign earlier handlers is claimed.

1. `agent_start`/`turn_start` bind current guarded manager and nonaborted `ctx.signal` object to the process-local run/turn.
   Reentrant starts revoke prior authority.
   Signal equality is an observed low-level run identity, not authentication of a public caller.
2. `tool_execution_start` reserves one provisional candidate **before** callback-bearing checks.
   At most 256 distinct nonempty valid UTF-8 call IDs/run, each ≤256 bytes; bounded names too.
   Duplicate/exhausted IDs cannot admit; a fresh observed run is required to reset the ledger.
   Preparation/lookup/schema failures can reach execution-end without a hook, so retire unused correlation and permit a later valid call in that run.
3. Restricted `tool_call` denies every name except the positively identified owned tool.
   Require usable selected context, TUI/UI/non-child/root/manager, no queues/compaction/entry/departure/uncertainty, and no other owned or externally reported busy work.
   Model turns may be busy (`ctx.isIdle() === false`); this separate lane never weakens idle Open/source guards.
4. Recognition uses checked local facts/structured active-branch markers, not prose, imported IDs or user-role history.
   Context-only calls pin their actual locator, not a copied binding.
   Attached calls additionally require current binding/epoch/session outcome and unfenced reservation.
   Admission permits at most 256 checked append-parent links, then pins exact leaf.
   Lazy first persistence may add an inode with unchanged header/path; a pinned inode/header/path cannot be replaced.
5. Execute requires pending candidate, matching id/input object/bytes and explicit signal identical to the pinned and current guarded signal; consume before dispatch.
   Check observed generations, selected task/root/session/header/path/inode/leaf and registry after callback-bearing observations, ending with pure lease/generation/abort checks immediately before dispatch/release.
6. Full stored recognition/binding/reservation checks bracket body dispatch and result release.
   Inner synchronous filesystem guards recheck host/branch/locator/registry and the pure lease, not the entire retained SQLite graph at every directory iteration.
   Final full checks reject durable fencing introduced during an actual read.
   No filesystem/SQL atomic snapshot is promised.

### D prerequisite: one inspector path, exact self, complete recognition

All existing call sites use the same write-once pin, not only B writer inspection:

| Call path                          | Pinned dispatch / ordering                                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `reserveRead`                      | `planningBusy()` before reservation, without a self exemption                                                |
| Both `planningBase` branches       | `planningBusy(work, self)` with exact candidate correlation                                                  |
| Idle Source/Open/final callback    | `idle -> planningBusy(work)`; idle checks are not weakened                                                   |
| `observeAvailability`              | Validate pins, then invoke actual busy body; descriptor refusal differs from a body exception                |
| Settlement/Open admission          | Validate the same pin before inspection admission                                                            |
| `inspectAuthoring` / `inspectOpen` | `inspectOwned` only after coordinator acquisition and child arming; latch pending before original invocation |

The shell-owned resource-free inspector uses only private correlation/checked anchor state: no root/projection/host getter, storage, controller, publication, navigation, process or self-agent wait.
A fulfilled `no-owned-execution` means no other accounted owned execution in this no-executor composition; it is not constant settlement or foreign/G4 proof.
Without self, local active inventory and root negatives must be clear.
Pending A/B/C admission requires the exact `reading === candidate`, work/run/turn/planning epoch and nonaborted signal with no body Symbol; body/serialization additionally require the sole exact `bodyHandle` in `planningWork` and matching held-store scope.
Writer inspection additionally binds the armed pending child, original body/outer invocation and known unreleased coordinator, without an entered task-store scope.
Multiple matches, replaced candidate/run, retired/closing/unknown work, required fence and older original inspection remain obstructing.
Synchronous session-read self needs its active `framed` interval; Source needs its exact same-call `lexical` family and rejects exceptional originals/cleanup even after lexical exit.
Current Create/Open use original parent/receiver/map/phase/deadline checks; D Return uses distinct readonly recognition/outcome phases, not a writer-borrowing recognition shortcut.

These exclusions never complete a body/Promise/resource, cancel a required fence or grant attachment.
Original inspection is observed before any race; body including serialization remains tracked until real completion and closure.
The delta adds no native site/profile/bank/connection, larger resource budget or writable read bootstrap; original H3/source guard and close ordering remains mandatory.

[Complete ordinary proof](./task-session-guidelines.md#complete-ordinary-ancestry-and-local-mappings) now requires exact leaf/parent identities, visited-cycle exclusion and a real null terminator within 256 nodes, plus complete noncreating 64-row mapping pages within the 256 history-work budget.
Missing parent is not an ordinary root; foundation-only empty histories consume budget without supplying bindings.
Final callback-bearing observations finish before original generation/manager/leaf/exact-work checks, including after nested read closure; no stale-pin refresh.
D Create/Return/fresh ordinary projection also uses this complete proof; implementation is not full-loop qualification.

### B checkout and final release: implemented narrow ordering

Every B operation, including view, additionally pins an explicit attachment plus private local/record checkpoint, session outcome, binding and unfenced reservation.
Mutations call `inspectAndSettle("authoring", signal)` during the busy model turn, excluding only their exact work handle, not pretending the agent is idle.
Before callbacks/I/O the owner reserves exact writer/inspection/unwind cells and the pinned task/epoch conditional fence, then acquires independent checked coordinator exclusion **before calling the original inspector**.
The inspector is pinned, resource-free/no-escape/non-reentrant; missing/accessor/replaced methods refuse before writer I/O.
This reviewed semantic footprint is not runtime authentication.
The publisher uses the one `TaskStore.openExistingShellBorrowed(state, lease, work)`; controller never nests checkout or owns coordinator release.
Reentrant invalidation immediately revokes/detaches and latches the pending fence; while checkout is held, cancellable departure refuses without a nested opener or self-wait.
On invalidation, revoke/latch before callbacks; end transaction, close descriptors, perform any required original same-store fence, then safely close task DB/borrow.
Original inspection **and installer body including serialization** must finish before coordinator release.
The already-reserved tail can fence a newly observed post-DB-close or post-normal-release departure, never serve as a writable final check or failed-fence fallback.
[Task Storage](../backend/task-storage-guidelines.md#participating-resource-and-fence-boundary) owns sticky routes, original-DB identity and native-close precedence.
Unknown closure retains exact resources/obstruction across compatible replacement; safe independent cleanup still runs.
The commit witness advances pinned facts only to this request's exact checked group/record/clocks, never arbitrary newer state.

H3 correction carries `scope.setReleaseCheck(check: () => void)` from the controller after closure to the lane's actual final release boundary.
The checker retains bounded target/claim/install-alias/ancestor stamps, not a closed publisher/store or writable capability.
After the installer finishes bounded plain-JSON result serialization inside the awaited body, final `guardPlanning` performs:

1. All callback-bearing registry/context/manager/locator/leaf observations.
2. Checked readonly binding/reservation and exact private commit-witness comparisons.
3. The captured code-owned filesystem checker, preserving bounded I/O failure mapping.
4. Pure exact lifetime-work/lease/generation/signal checks, then synchronous return; final cleanup cancels only a healthy unused tail and removes the exact proved-closed work/candidate.

No further Cadence await or foreign callback follows those checks.
Last-getter private progress and postclose registry-callback file edits must reject release, even with unchanged host generations.
Refusal after commit leaves facts/outbox intact, not rollback.
Later SDK result hooks/transcript processing and concurrent filesystem mutation are outside this controlled boundary.
A/view still use readonly observation; there is no writable release reopen.
The parent remains negative after coordinator release through all final callback/private/file reads; final native close failure retains process refusal without inventing a held physical lock.
Only refusal cleanup may enter an already-reserved departure child after final reads drain; success adds no await/callback gap.

Delivered input/raw bash/compaction, conflicting owned actions and navigation/lifetime changes revoke leases; discussion need not detach, navigation fences attachment too.
Direct manual compaction may abort the run before its first hook; signal checks are necessary.
Exceptions/block/end retire unused candidates, not active resources.
Never wait for the tool's own agent settlement.

### C structural projection and local request

`dispatchPlanningC` uses [closed C wire/results](../backend/task-authoring-guidelines.md#c-questions-and-nonauthoritative-results), not model-selected roots/tasks or authority flags.
Both outer `guard()` and inside-store `guardInStore(store)` must return exactly undefined; nonvoid/Promise/thenable refuses without reading `.then`.
Runtime `planningCReviewRequest` minimizes before paging: exactly enumerable own data fields `status,requestId,pinHash,reason`, plain/null prototype, no extra/hidden/symbol/accessor/receipt data, coercion or `toJSON`.
`none` has three nulls (even with an Intent); `pending` has UUID/digest/null reason and must equal the **current nonnull** planning SemanticPin; `stale` retains its original UUID/hash and context-changed/planning-changed reason without refreshing it.
Malformed shape rejects; stale pending equality is conflict, never automatic renewal.

`PlanningCompleteness` contains kind/depth/clocks, structure complete/incomplete, semantic/readiness not-assessed, compilation unavailable for code/not-applicable for readonly, findings, request counts and minimized reviewRequest.
Findings are unique and sorted by class/code/subject/path, ≤2048, never truncated into a green matrix.
These are the **twenty** deterministic codes, not semantic certification:

| Class                | Codes and predicate                                                                                                                                             |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| structure            | `intent-missing`; `input-unbound` for required input without checked source/artifact refs; `blocking-decision` for latest proposed blocker                      |
| structure/code       | `acceptance-empty`, `checks-empty`, `draft-missing`, `steps-empty`                                                                                              |
| structure/code links | `acceptance-check-unlinked`; `draft-acceptance-unlinked` unless acceptance appears in both draft and some step; `step-check-unlinked` without verification refs |
| structure/readonly   | `objectives-empty`; `objective-evidence-empty`                                                                                                                  |
| material             | `role-missing`; independent `artifact-undelivered`, `artifact-missing`, `artifact-changed`                                                                      |
| agreement            | `objective-agreement-missing`; `evidence-agreement-unassessed` for each readonly objective                                                                      |
| evidence             | `request-unfulfilled` for current requests; `required-evidence-unassessed` for nonempty code acceptance requirements                                            |

Finding fields are `{class,code,subjectId,path}`: identified input/decision/acceptance/step/objective/request uses subjectId; role-missing uses brief/requirements/design/plan; artifact findings use validated relative path; other fields are null.
Effective depth is expanded if record already expanded or any declared architecture/compatibility/storage-isolation/multiple-deliverable impact demands it.
Compact tasks require brief; expanded code requires requirements/design/plan, expanded research/diagnosis requirements/design only.
Invalid private/dangling/cross-kind graphs are errors; legal incomplete planning stays useful.
`structure:complete` means no structure/material findings only.
References prove no relevance; exact objective-statement quotation agreement does not endorse its separate evidence requirement list.
No mandatory prior per-item/per-document approval is added for new code synthesis.

`SemanticPin` hashes full Intent and its revision/kind/effective depth, sorted artifacts, latest decisions, referenced sources, retained request IDs/hashes/currentness and current material/version/tail facts.
Unrelated source metadata or summary-only progress need not change this pin; exact CAS/full private witness can still refuse that call.
All-outbox state drift participates in the private witness even when section text/clocks do not change.
Never refresh a stale pin or substitute page identity for that witness.

### C admission and pending review release

`TaskPlanningCReadScope` has `kind:"read"`, epoch/work/guard/release-check plus one-use `observedC(witness)`, `stageReviewRequest(pin)` and `reviewRequest(pin)`; **no withStore**.
`TaskPlanningCWriteScope` has `kind:"write"`, the same base plus `withStore`, `guardInStore(store)` and `evidenceOutcome(outcome)`; no local-review operations.
Exact scope/work/candidate/root/attachment instance and epoch are checked before callbacks.
Admission captures CPrivateWitness before callback-bearing pin/branch observations; subsequent observations may compare, never replace it.
Read6 views/local review never acquire writable checkout/migrate/publish.
Typed refusal whose exact read resources have closed does not permanently poison the root; unknown cells still block completion/replacement.

Request-evidence retains early coordinator/original no-escape inspector and one borrowed write16 store, the existing sticky fence and cleanup banks.
`guardInStore` validates exact held identity/active transaction, performs private host observations within **C1's existing frame**, compares held checkpoint and ends pure.
No B frame wrapper, new reader/classifier/opener/frame option is admitted there.
The controller then repeats mandatory same-store predecessor proof **after callbacks**, followed by captured files; C1 follows with root/catalog/full-witness CAS.
Consume the exact one-shot store outcome while held, independently bound to admitted before/wire/task/epoch/objective/sources; created permits only its pair/event increment, duplicate whole-witness equality.
B committed/retry remain separate.

Successful release: original installer body including full result serialization → actual invocation/resource/fence/task DB/borrow/coordinator closure → **all** registry/context/manager/locator/leaf callbacks → callback-free readonly C witness comparison (including full outbox) and snapshot close → captured file/claim/install/ancestor checker → pure signal/generation/exact-work completion → preallocated plain-slot assignment → synchronous return.
No later Cadence callback/await, writable reopen, file recapture or refreshed witness; consumer root is checked before/after callbacks against the original scope.
Postcommit refusal retains durable questions without false rollback; unknown final-read closure remains process-negative even after coordinator release.

PendingReview is one inert plain-data slot per owner: request ID/hash/SemanticPin, task/root/instance/epoch/attachment/branch generations, status/reason.
It holds no Pi/UI/store/Promise/lease/native capacity and is not a durable queue.
Stage/preallocate inside the body; promote only after the pure successful tail.
Failed result installs no slot.
Same pin/attachment/branch reuses ID; explicit new request may replace stale; Open/replacement loses it without replay.
Normal own result/follow-up/turn append and `endRun -> revokePlanning` preserve pending but never present it.
Normal-end evidence is static call graph plus actual event order/append observations, **not a public idle pending getter** (none exists).
Independent input/start/bash/compaction, owned Source and navigation/lifetime conflict stale before callbacks; semantic drift marks planning-changed preserving original hash.
[Session Adapter](./task-session-guidelines.md#c-lifecycle-entry-matrix) owns the U/X/C/O entry matrix and exact Open exception.
No agent-end/settled/menu consumer, notification, source acceptance, compiler, issuer or execution follows.

### Work lifetime and veto limits

Add the exact owner work handle before invoking body; retain it through dispatch, awaited body/promise, detachment/serialization and final checks.
Only actual completion removes that handle.
Agent/turn/tool end, abort, timeout or UI settlement cannot declare an unfinished body closed.
Pending controller work causes **immediate conservative departure cancellation**, not a new ten-second asynchronous read-drain guarantee.
Existing external settlement keeps its separate bounded lifetime.
Only the exact current handle is excluded from self-busy checks; external busy work is never ignored.
Actual native resource cells, not an outward error code, retain unknown closure even after body rejection or minimized private-read errors.
Do not clear uncertainty because a Promise ended; a fresh owner is not completion.
The ten-second inspection race never replaces the original invocation.
A fulfilled blocked-but-closed inspector can free its exact work for fresh admission; rejection/unknown and pending originals cannot.
Normal cooperative read expiry is incomplete `time-limit`, not a permanent uncertainty latch.
Native inert/lingering popups retain native capacity but are not execution I/O.

Actual tool-call veto covers reactivated builtin/overridden read/bash/edit/write/process/subagent/unknown tools.
Foreign preparation and start handlers run **before** that veto: zero forbidden execute calls is not OS containment.
For raw bash the owner returns `{result:{output:"task-entry-rejected", exitCode:undefined, cancelled:true, truncated:false}}` while restricted.
Installed 0.84.3 `extensions/runner.js#emitUserBash` catches exceptions and continues; throwing/returning undefined is not a veto despite newer documentation's different claim.
A provides no native raw `!`/`!!` CLI routing evidence; delivered `user_bash` fixtures qualify the explicit result only.
Live source input remains pending/unconfirmed; these tools never confirm sources or grant execution.
B may invalidate current review reuse and retain planning facts, not promote lifecycle readiness.

### Replacement-safe refusal and composition limits

[Task Authoring](../backend/task-authoring-guidelines.md#integrated-negative-lifetime-core) owns the sole native-process ABI, supported realm, bounded root/work/resource ledger and cold-restart policy.
Query root negatives before ordinary/context projection, optional-tool membership, actual tool hooks/raw bash, admission and final release, including **no-marker A → ordinary B → A**.
Same-root compatible copies/SDK owners share refusal, not attachment or authority inheritance; unrelated ordinary B keeps its own configuration.
No outgoing owner restores its baseline into a fresh owner; known foreign membership drift remains hook-denied without active-set overwrite.
At registration capacity, negative observation still distinguishes obstructed roots from unrelated ordinary roots.

Unusable runtime/ABI/collision retains explicit refusal handlers, not a factory throw assumed to veto Pi.
Deny entry/tool dispatch and return handled-cancelled raw bash; cancellable departure returns `{cancel:true}`.
Do not read an unknown ABI for safe-root guesses or overwrite foreign tools.
Ordinary availability is not promised in that unusable composition.
If handlers cannot register, report composition unavailable, not host fail-closed enforcement.
Actual unload removes hooks; continuously participating compatible composition is required wherever these restrictions are claimed.
Cold initial deployment and every build/code upgrade require process restart; same-build reload/copies are supported, not automatic same-ABI hot-edit detection.

Historical H1 lost a module-local uncertainty Set under file reload; H2 forgot an owner's original timed-out inspection across replacement.
Pi 0.84.3 Jiti `moduleCache:false`/factory-cache invalidation and runtime EventBus subscription removal disprove those retention remedies.
The integrated anchor now retains original FD/Promise/native DB objects and checked coordinator where held; original H1/H2 assertions pass, with separate file-loaded inspection/source/Open supplements.
Timeout, end, disposal, GC, new owner or a later successful inspection cannot finish old work.
Actual process exit ends local JS/OS resources, not external workers; fresh explicit Open/current checks/exact retry still apply without replay/reset.

## 4. Validation & Error Matrix

`TaskPlanningError` uses the retained closed planning vocabulary from `task-shell-contracts.ts`; `task-planning-limit` and `task-tool-conflict` are not added foundation codes.

| Condition                                                             | Result / retained state                                                            |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Invalid raw arguments during owned preparation                        | Exact `task-record-invalid`, error result, no hook/execute/controller/store access |
| Invalid later hook/execute decode or unexpected host exception        | Fixed `task-entry-rejected`, no submitted values                                   |
| Initial foreign schema or observable registry/membership drift        | `task-tool-conflict`; revoke and preserve foreign set                              |
| Missing run/start/hook, wrong signal/id/input/bytes, stale context    | `task-entry-rejected`; no dispatch/release                                         |
| Run ledger exhausted                                                  | `task-planning-limit` at hook admission; wait for fresh run                        |
| Foreign tool while restricted                                         | Blocked `task-entry-rejected`; execute counter stays zero                          |
| Domain bounded failure                                                | Known planning code only; no raw exception/path/stack                              |
| Pending body at cancellable departure                                 | `{cancel:true}`; no false settlement or tool restoration                           |
| File/directory/SQLite close uncertainty                               | `task-io-failed`; exact same-root negative survives compatible replacement         |
| Cooperative read budget expires with successful close                 | Incomplete `time-limit`; later valid work is possible                              |
| Raw public graph cycle/accessor/prototype or node/depth/byte overflow | `task-tool-conflict`; no serialization shortcut skips raw validation               |
| Actual serialized SDK envelope exceeds 65536 bytes                    | `task-planning-limit`; no oversized successful result                              |

C uses domain bounded errors unchanged: invalid local review shape → `task-record-invalid`; pending hash mismatch or nonundefined guard → `task-conflict`; missing attachment/work → `task-entry-rejected`.
No failed/closed read creates a pending slot, and no typed refusal discharges genuine unknown closure.

D prerequisite: invalid/replaced inspector methods or repeat/late/colliding shell installation → `task-entry-rejected`; no replacement/accessor invocation or fallback success.
Availability descriptor drift means unavailable/known busy; a valid pinned busy body's exception still latches uncertainty/revokes planning through the original catch.
Incomplete/malformed/cyclic ancestry, mapping exhaustion or final callback invalidation → restricted recognition, no business-tool restoration/bootstrap.
Exact-self mismatch/old original/unknown close refuses without pretending resources closed; a completed blocked-but-proved-closed inspection still permits later fresh checks.
D ordered startup failure stays refused; last projection epoch/deadline drift must prevent the ordinary setter, and fresh post-close refusal must precede public `pending`.
Neither durable facts, pending Source nor a C slot repairs admission.

## 5. Good / Base / Bad Cases

- Good: actual `session.prompt` drives complete UTF-8 reads and status/list/search while nonidle in both context-only and attached tasks, without controller writes or readiness claims.
- Base: ordinary conversation keeps normal tools and does not activate `cadence_task`; malformed preparation is followed by a valid current-run call.
- Bad: manufacture a candidate in execute, compare only schema hashes, restore over a foreign set, or clear read work on agent-end.
- Good B: busy explicitly attached code/research/diagnosis turns use all four operations with exact current facts, proposed incomplete planning and no readiness/execution grant.
- Bad: call the async structural controller port an executor, treat copied markers as mutable attachment, or report fresh-owner publication with unfinished old work as safe.
- Good C: a genuine busy attached turn returns an unfulfilled request and a pending review with presentation unavailable; normal own append/end does not self-stale it.
- Base C: structure complete still has not-assessed semantics/evidence and unavailable code compilation.
- Bad C: project a slot receipt accessor, substitute current final facts, or stale every normal end to conceal incomplete event propagation.
- Good codec: reuse a freshly serialized owned schema only for marked detached copies in the same observation, after charging every raw occurrence.
- Base codec: foreign equal-shaped schemas and all domain results take normal copying; undefined arrays take whole-graph canonical fallback.
- Bad codec: treat a prior schema string/frozen flag or last membership getter as proof of current registry/private/file facts.
- Good prerequisite: shell-owned inspector supports real busy A/B/C and original saved/unsaved Open, while pending old inspection/first-close uncertainty survives replacement.
- Base prerequisite: standalone settlement retains its original receiver/reasons and busy-body exception semantics; no shell replacement is allowed.
- Bad prerequisite: use a constant false busy callback, select self by task/root ID, interpret missing ancestry as ordinary, or call installer projection a guarded terminal-entry check.

## 6. Tests Required

`test/task-planning-tools.integration.test.ts` has **81 cases** at independent host-review handoff; together with the 141 domain cases these are focused evidence, not an executed full-suite total.
Task `09-24-cadence-task-shell-and-approval/research/readonly-a-host-review.md` records **293 passed / four suites** including 212 retained session/source/native cases, and no blocking host product finding.
Domain review separately records 488 focused passes.
Historical 1730/21/120 and partial 1825/21/120 checkpoints are not current combined verification; main owns full gates/real pack.

Use actual owner/installer/controller with `test/helpers/task-planning-host.ts` and `task-shell-host.ts`, offline local tool-call adapter/follow-up text, isolated state/agent/session/project and disabled discovery/retry/compaction.
`tools:[]` excludes extension tools too: explicitly allow the product and negative fixture names, then reactivate negatives to prove hook veto rather than SDK exclusion.

| Existing test / area                                                                   | Required assertions                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Busy-turn context-only/attached positives                                              | `isIdle() === false`; useful status/list/search and exact complete multibyte read; lazy persistence; next turns                                                                               |
| `prepared variants pass strict schema and remain equal after SDK cloning`              | Value parity; post-clone hook/execute identity, no coercion                                                                                                                                   |
| Malformed preparation matrix                                                           | Fixed error/isError/≤64 KiB; sentinel absent from owned result; zero hook/execute/controller/store calls; next valid call succeeds                                                            |
| `raw and wrapped direct execute without a live hook candidate cannot dispatch`         | No bypass via direct/wrapped calls                                                                                                                                                            |
| `later equal-shape schema replacement conflicts without clobbering foreign membership` | Reference/provenance checks; foreign set retained                                                                                                                                             |
| Queue/signal/compaction/ancestry/getter cases                                          | Abort before first compact hook; >256 ancestry refusal; pure final checks catch reentry                                                                                                       |
| Deferred-body/end/abort/close cases                                                    | No early handle release or foreign settlement; later actual completion remains distinct from authority                                                                                        |
| Independent review additions                                                           | Durable fence during actual read and active-set drift reject release; early execution-end cannot settle; accessor rejected by preparation; cooperative read stop permits later work/departure |

The 256-ID boundary uses 255 explicitly delivered correlation-only start notifications plus real boundary calls, not 257 provider turns.
Registry/provenance/removal and lifecycle fault injections are named fixtures, not qualification of every natural native route.
Accessor fixtures delimit owned preparation: Pi may later clone its original transcript, outside this guarantee.
Keep real session/source/native regressions and business/Git/settings/writer/process/network sentinels; A adds no native UI/PTY, installed-tarball, Windows/macOS or worker-isolation qualification.

B tests live in `test/task-authoring-tools.integration.test.ts`: actual offline `session.prompt` exercises attached code/research/diagnosis operations, context-only refusal, strict preparation, guarded checkout unwind and final-release regressions.
Preserve historical H3 probes as history: their unborrowed-opener injection does not trigger on pre-C/current borrowed composition and is not green coverage.
Current borrowed-close callback-file/acknowledged checked-process private-progress tests separately qualify H3, alongside promoted final-check revocation/I/O cases.
Retain `test/task-lifetime-host.integration.test.ts`, `task-lifetime-host-io.test.ts`, `task-lifetime-authoring.integration.test.ts`, `task-lifetime-final-review.test.ts` and all resource/fence/source/Open suites linked by their owners.
Tests must reach actual installed SDK dispatch/offline `session.prompt`, file-loader replacement and final return, not reproduce product admission in fixtures.
Assert no-marker same-root restriction, unrelated ordinary tools, exact copy/SDK sharing, foreign membership preservation, unsupported runtime/ABI refusal and explicit raw-bash/cancellable-departure results.
H3 last-manager private-progress contenders must be separately alive checked processes that actually commit/acknowledge new clocks after lease release; same-process early refusal does not test that race.

Task research `planning-b-lifetime-integration-readiness.md` records the historical independent narrow READY FOR FULL GATES disposition.
Original H1/H2 bodies/assertions remain unchanged and pass; H1 is actual file-loaded old-FD evidence, original H2 inline SDK evidence with a separate file-loaded supplement.
Preserve original host/feasibility/correction reds and later component findings; no skip, inverted assertion or compatibility relabeling.
Physical source copies/independent SDK instances and actual alive-contender → process-death → fresh SDK Open/exact retry provide bounded cross-composition evidence, not installed-package or external-worker qualification.
The copy/process scenarios are carried forward across the final proxy-rejection-only delta, not described as fresh reruns.
Full repository/distribution/Agent/traceability/real pack remain separately main-owned; no totals are asserted here.
Node 22/24, native Windows/macOS, PTY/full CLI, installed-tarball, physical-human/full-review and G4 settlement remain explicit gaps.

C host coverage: `test/task-planning-c.integration.test.ts`, `task-planning-c-pending-review.integration.test.ts`, `task-planning-c-safety-review.integration.test.ts`, `task-planning-c-lifecycle-review.integration.test.ts`, `task-planning-c-final-lifecycle-review.integration.test.ts`, `task-planning-c-shutdown-review.integration.test.ts`.
Assert actual busy SDK dispatch/all kinds, independent decode/input identity and ten alternatives; no creating reads, no consumer/provider; consumed-seal-only transition; same-owner normal append/end; failed-stage exclusion; last-callback outbox/file/checked external progress injection before refusal; exact original FD/DB unknown across file-loaded replacement.
Early lifecycle assertions must reach first callbacks, not just eventual refusal; retain saved/unsaved Open and Source/N1 positives.
Historical C1–C3 focused passes alone did not close C4/full-gate/real-pack or acceptance; the later qualified C acceptance record above owns that disposition, not D verification.

`test/task-planning-codec.test.ts` parser-extracts the actual private codec and pins the old reference body: require exact bytes/errors for default and embedded-schema cases, raw reflection/throw order, aliases/cycles, Unicode and all bounds.
Assert fresh frozen factory roots, strict root identity, undefined-hole/prototype getter/setter parity, actual busy SDK observation count/order, and reported description/schema drift refusal without foreign executes or membership overwrite.
These finite comparisons do not replace H3 tests: last host getter changes to private progress/outbox/files must still refuse after the final readonly comparisons.
The older B H3 assertion file stays unchanged; C's checked contender must capture clocks before close, acknowledge success only after normal original-store closure and still await actual child exit (see backend fixture qualification).
Preserve all original five-second deadlines and preexisting longer declarations; measured C4 profiles are bounded evidence, not an SLA or a full-suite checkpoint.

### D prerequisite qualification, not registrar acceptance

Retain all **46** new `test/task-shell-entry.integration.test.ts` cases and the [session guide's assertion/evidence inventory](./task-session-guidelines.md#d-prerequisite-evidence-and-retained-gaps).
Require installation order/collision/pin/receiver negatives, complete empty/256-node ancestry and malformed/257-node refusal, 64-row paging/256-work boundary, retained markerless mappings and final-getter invalidation without business-tool restoration.
Actual offline SDK tests must keep useful all-kind busy A/B/C, four B operations, Source lexical/exceptional-original behavior, current saved/unsaved Open callbacks and real first-close/retained-Promise refusal across replacement.
Do not substitute the manual file-loaded held-inspection fixture for original timed-out authoring H2.

`gate2-prereq/report.md` and `gate2-prereq-review/report.md` under `/tmp/cadence-g2-d-implementation.1dzxw491/` bind the evidence: final **46 new** and **275 original host** tests; independent **75 / 5 files** (overlapping the 46), original **H1/H2: 2**, and **3** separate probes, with fresh check/scoped Biome.
Earlier implementer 171/160 checkpoints predate its final busy-exception compatibility correction; do not call them final-hash reruns or add overlapping counts.
The independent nested-Source and final-getter probes preserve useful outer self while refusing inner/stale writes; the ancestry probe proves no ordinary baseline restoration after delivered traversal invalidation.
Preserve all development/noninjecting/fixture failures and historical red evidence.

Gate 1's earlier **1234 serial / 1234 default** foundation passes qualify the then-hashed composition only; this selected prerequisite review is no 27-file foundation rerun or full D gate.
Linux x64 / Node 26.7.0 / Pi 0.84.3 is the qualified scope, with seeded prerequisites/controlled replies, not clean-consumer registrar/Create/Return, final ordinary-tool return, physical-human/CLI/PTY or installed-tarball runtime.
Those historical prerequisites did not supply a registrar or full gates.
The subsequent D candidate and R1–R3 review are recorded in the [session qualification inventory](./task-session-guidelines.md#d-gate-2b-candidate-and-correction-qualification), not accepted as a complete loop.
Retain original 46-case entry prefix, all old assertions/deadlines and the new pre-effect/no-setter and post-real-close/public-pending controls.
R4's first 50 appended cases pass; the second append has 27 passing cases and one enabled 20-second maximum-publication timeout, not 78 passes or a complete loop.
The session inventory records exact saved file-loaded `switchSession` versus pre-start new-session setup, callback poison/post-final rejection, original-resource retention/no recognition fallback and complete bounded history-detail/privacy/Back evidence.
Maximum publication and byte-heavy session history remain unqualified; mapping/epoch/detail-size limits do not waive them.
Full-loop/composite reds and later native/CLI/full repository/separate-pack gates remain; the independently reviewed collection-only correction does not clear them.
Do not convert the nine-ask research timeout or late Return teardown into successful Return/Open evidence.

## 7. Wrong vs Correct

Wrong: register from an agent-start handler, or use `owner.withAttachment(ctx, async ...)` for a model tool.
Correct: construct owner then installer before startup; use its observed run/start/hook/execute lane while preserving idle mutation admission:

```typescript
const owner = createTaskSessionOwner(pi, options);
const controller = createTaskPlanningController(options.state, privateRoots);
installTaskPlanningTools(pi, { owner, controller }); // Isolated composition only.
// Only if options supplied NO settlement; after planning and before startup:
owner.installShell(); // No terminal command, Create/Return or execution grant.
```

Wrong: `tool.parameters` has the expected JSON hash, so snapshot the ordinary baseline.
Correct: first require the exact fresh owned schema reference and expected metadata, then monitor registry references/provenance and controlled active membership.

Wrong: throw from raw-bash veto or clear work when `agent_end` arrives.
Correct: return the explicit handled-cancelled result; revoke authority immediately but retain actual body/closure lifetime until completion.
The compatible integrated anchor retains exact work across replacement; a fresh owner still gains no positive authority from it.

Wrong: a module Map/Set or extension EventBus listener survives actual reload, so an empty fresh-owner query means settled.
Correct: loader/runtime evidence disproves those retention mechanisms; use the sole checked negative owner and exact resource adapters.
Integrated H1/H2/D1/H3 evidence alone does not confer acceptance, whole-G2 readiness or production authority.

Wrong: run B's framed guard inside C1's guard or promote pending before serialization/final witnesses.
Correct: use exact held-store `guardInStore`, mandatory post-callback predecessor/files checks and the C seal; promote preallocated local data only after H3 and pure exact completion.

```typescript
// Wrong: an install-time string is not this observation's serialization.
const metadata = boundedPublic(tools, { root: ownedParameters, json: schema });
// Correct (inside observe, at the existing comparison position):
const currentSchema = boundedPublic(ownedParameters);
// Compare currentSchema to schema; retain all raw metadata/active observations.
const currentMetadata = boundedPublic(tools, {
  root: ownedParameters, json: currentSchema,
});
```

The private specialization saves detached serialization only; never skip raw traversal or the later private/file/pure release sequence.

Wrong: after shell installation, call live option methods, replace a malformed adapter, or exempt every same-task body as self.
Correct: one write-once own-data pin and synchronous exact call scope across all busy/inspection paths; preserve original Promise/resource accounting and the final callback/private/file/pure-release sequence.

Wrong: `installPlanning` projection returning void proves Create/Return admission, or the last callback may run after a pure epoch/deadline check.
Correct: pass only the existing checker through the approved seam, require sticky ordered startup, and finish callback-bearing observations with original pins before every protected effect.
Preserve existing A/B/C admission and no foreign membership overwrite.

Wrong: freeze `attached`/`returned` before the exact fresh post-close checker can revoke it.
Correct: actual original closure precedes the fresh synchronous reaction; await its acknowledgement, then decide public success using retained negative correlation only, never outgoing host/checker/tool settings.
Original callback/body failure must reach that reaction as negative lineage even after a durable final commit; a matching success string cannot replace fresh admission.

## Scenario: Candidate-only planning-to-terminal convergence seam

### 1. Scope / Trigger

Private convergence adds an explicit idle review consumer outside the model-turn A/B/C lane.
Earlier absent-consumer/full-history/codec-reflection descriptions above are historical checkpoints.

### 2. Signatures

Existing `installTaskPlanningTools` and all ten model alternatives remain unchanged.
The session owner's pre-start `installReview(service, source)` is trusted composition, not a model tool or registrar fixture option.

### 3. Contracts

C review requests remain inert, bounded, pending/stale and never show UI on `agent_end`.
Only fresh explicit attached idle menu intent can create a current terminal interaction; context-only history cannot attach or consume authority.
Selected original key/reference/lineage checks replace ordinary full-history scans; complete audit remains explicit.
Code-owned schema specialization charges every expanded logical occurrence only in fixed observations and retains ordinary fallback/error order for all foreign inputs and result envelopes.
No cached schema/program/display string supplies current host/private/file permission.
Final callback-bearing checks precede captured private/files and pure exact-work release; unknown original resources stay negative across replacement.
Use the [session contract](./task-session-guidelines.md) for pager/currentness and the [storage contract](../backend/task-storage-guidelines.md) for one-shot persistence.

### 4. Validation & Error Matrix

Wrong identity/mapping, incomplete ancestry, registry drift or stale request refuses without foreign-set overwrite.
Default compiler unavailable is truthful, not fixture fallback or structural approval.

### 5. Good/Base/Bad Cases

Good: useful busy A/B/C followed by an independently current idle terminal review.
Base: readonly agreement remains unfulfilled evidence and ordinary conversation remains ordinary.
Bad: stale display or C pending slot grants approval; a later schema string repairs private-currentness drift.

### 6. Tests Required

Keep complete planning/authoring/C, codec differential, entry, approval, resource/H3 and native suites.
Assert exact owned root identity versus equal-shaped foreign schema, unchanged raw reflection/error order on fallback and last-getter private/file refusal.

### 7. Wrong vs Correct

Wrong: model review/result serialization closes work or authorizes presentation.
Correct: finish actual original body/resources, then require fresh explicit terminal intent and independent selected-current admission.

## G3 content and projection checkpoint (not accepted)

The ten B/C tool alternatives and the isolated activation boundary remain unchanged.
B may additionally propose closed draft-v2 execution data; v1 remains planning-only.
Optional fixed local schema definitions are charged in full inside the existing registry byte/node/depth limits; there are no external references or wider limits.
Explicit `refactor` scope is distinct from retained `structural`.

Three shipped task-specific examples are `config/task-plan-draft.quick.example.json`, `config/task-plan-draft.example.json` and `config/task-plan-draft.multiple-tasks.example.json`.
They are B request packets, not legacy Design/OpenSpec deliveries.
Their example clocks must be replaced from current owned facts after the actual input occurrence; examples are not operational authority.
Quick uses finite single-unit expansion, while explicit examples use controller-resolved producers and future independent completion reports.
The closed schema/DTO tests check all three; the genuine SDK test file still has two unresolved full expanded-review deadline failures.
Do not describe this checkpoint as fully compiler/terminal-qualified or released content.

The terminal permission projection now reports actual effects, verifier occurrences, dependency names, budgets, current input/profile/environment hashes and evidence timing.
Static structure/capability checks mean no verifier ran, planning evidence meaning remains unassessed, future reports are not-run, and execution is disconnected.
Maintain complete reversible overview/material pagination and all fresh G2 callback/private/file/pure-release checks.
Do not shorten a failing positive by sampling evidence, skipping pages/checks, widening deadlines or treating fixture terminal selection as a native closure certificate.

### G3 schema growth and unchanged codec bounds

The actual frozen nine-tool G3 registry is 58935 JSON UTF-8 bytes, 3644 raw nodes and depth 32; C's earlier 44411/2806 metric above is historical.
Do not widen 65536/8192/32, restore old schema bytes or advertise a partial factory as runtime evidence.
The full real root no longer fits raw accounting twice; enumerable TypeBox kinds can also exceed original admission.
Preserve complete reference-byte/error parity, including bounded refusal before any inherited getter.
Explicitly private lexical qualification factories retain the K=2/independent mutable-copy/hole-getter controls within the same bounds.
Separate full real-factory tests exercise each actual TypeBox setting and prove either exact current bytes or the original bounded refusal, never cached defaults.
All real SDK schema/dispatch/membership/currentness controls remain complete and independent of those private fit fixtures.

## G5 isolated schema growth and cold observation

The isolated G5 factory has twelve closed alternatives, adding only `collect-evidence` and `submit-assessment` to the ten G3 alternatives.
The actual frozen nine-tool SDK registry is 60113 JSON UTF-8 bytes, 3713 raw nodes and depth 32; earlier G3 metrics are historical, not current pins.
The CLI has a native `powershell` definition too, so qualify its whole registry rather than assuming the narrower SDK fixture supplies headroom.
Keep 65536/8192/32 and exact raw/error-order assertions unchanged.

Fixed JSON Schema `const` already fixes type and value; the local TypeBox `Unsafe<T>({const:value})` declarations omit only redundant type fields, not predicates or branches.
False `uniqueItems` is the JSON Schema default; only that redundant false may be omitted, never an affirmative uniqueness constraint, closed-object check or maximum.
This is fixed schema construction, not a cache/reference framework or a certificate for foreign metadata.
Retain actual SDK cloning/parity, wrong-value/extra-key negatives, original A branch bytes, exact twelve-alternative and whole-registry pins, and unchanged regular/fullscreen CLI deadlines.

Cold `task-session.ts` and required finalizer imports must not eagerly import the transform-only controller.
Load it only inside the admitted asynchronous completion/model action, then recheck the original guard before use.
Keep strip-only navigation/resource negatives and fresh-process session recovery enabled; do not modify their loader, relax native assertions or convert parameter properties throughout unrelated source.
