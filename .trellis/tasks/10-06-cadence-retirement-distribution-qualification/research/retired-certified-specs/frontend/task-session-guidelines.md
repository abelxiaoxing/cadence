# Disconnected G2 Session Adapter

Current G6 Completion guard ownership: [Publication Admission](../backend/task-publication-admission-guidelines.md).
Only owned publication separates live host/locator callbacks plus the pure generation/work tail from full history guards; knowledge and other actions retain full guards.
Earlier per-I/O full-history statements do not override that approved private-writer boundary.

Candidate-only convergence: the appended scenario records reviewed behavior before guarded LIVE integration.
Earlier checkpoints remain historical.

## 1. Scope / Trigger

Use this guide when composing or changing `src/task-session.ts`.
The adapter uses installed Pi 0.84.3; production `src/index.ts` does not load it.
The isolated D registrar is implemented but unaccepted; no issuer/executor or legacy entry change.
The combined isolated A/B/C installer is documented in [Planning Host](./task-planning-guidelines.md).
C has [qualified disconnected acceptance](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-c-acceptance.md): historical **3537 passed / 21 existing skips / 123 exact archive members**, not fresh D evidence.
A/native checkpoints remain accepted; integrated lifetime/Open/source/B now have independent Linux Node 26.7.0 / Pi 0.84.3 evidence, including original H1/H2 passes.
B/lifetime has [qualified disconnected acceptance](../backend/task-authoring-guidelines.md); whole G2 remains unaccepted and historical red evidence is preserved.

The approved observable-currentness policy supersedes universal attempt fencing, not its two historical failing probes.
Hidden unchanged-state attempts/foreign work/ABA remain limits; no upstream prerequisite is required.
[Source Host Guidelines](./task-source-guidelines.md) owns authorization/review, native tickets and N1 painting delegation; this is not full G2 acceptance.

D's [Gate 2b checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate2-loop-checkpoint.md) records the actual disconnected registrar/Create/Return candidate and independently closed R1–R3 corrections.
The [registry seam is approved](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-registry-seam-approval.md) and implemented at one installer call site.
The later [R4 continuation checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-r4-checkpoint.md) records two reviewed negative-lineage corrections and additional bounded coverage; maximum history and timing keep R4/Gate 2/D/whole G2 open/unaccepted.
The approved inventory-assertion correction closes only collection, as recorded in [Quality Guidelines](../backend/quality-guidelines.md#scenario-c4-native-fixture-emission-and-closure-acknowledgement).
The earlier [prerequisite checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate2-prereq-checkpoint.md) is historical, not complete-loop qualification.
`src/index.ts` still does not register `/cadence`.

## 2. Signatures

`registerTaskShell(pi, {state, sessionDirectory, privateRoots}): void` in `src/task-shell.ts` composes owner → controller/Source → planning installer → `installShell()` → `registerCommand("cadence", ...)`, once per exact Pi API object.
The command delegates to `owner.enter(ctx: ExtensionCommandContext, args: string): Promise<string>`; outcomes are `attached|returned|canceled|pending`, not permission objects.
Errors use `task-entry-rejected`, never outgoing UI notification after replacement.
`createTaskSessionOwner(pi, options)` registers lifecycle/entry-wait handlers per extension owner, not commands/tools.
It provides `view()`, `open(ctx, taskId): Promise<"attached"|"canceled"|"pending">` and synchronous `withAttachment(ctx, (binding, guard, io) => syncResult)`.
`observeInputs(state, observer(event, binding, guard, io))` registers one synchronous observer.
`withSourceChoice(ctx, prepare)` takes synchronous `prepare(binding, guard, io) -> {title, label, commit(binding, precommit, freshIO)}` and returns `Promise<boolean>`.
[Source Host](./task-source-guidelines.md) owns the seven-method `TaskSourceIO` and generic synchronous return/escape contract.
`inspectTaskSessionLocator(options, value, work?: LifetimeWork)` checks locators without opening/migrating Pi history; optional work tracks the actual session-header FD.

`installPlanning(state, onProjection, registryCheck?: () => void)` is the single pre-start composition seam for the combined isolated tool installer.
The optional third argument preserves standalone two-argument use; D terminal entry requires the captured checker and ordered startup pin.
Projection returning void is not checker success.
Its observed run/turn/start/admit/execute lane retains A busy-model-turn reads and adds attached-only B scope admission without changing idle `withAttachment` or source admission.
It supplies restrictions beyond `view()`, exact candidate/signal/currentness guards and actual body/promise work tracking; see [Planning Host](./task-planning-guidelines.md) for the complete returned API.
Pending work conservatively cancels departure in the current owner; end/abort cannot settle it.
The sole [negative lifetime owner](../backend/task-authoring-guidelines.md#integrated-negative-lifetime-core) retains actual unfinished work across compatible same-build replacement; a fresh owner is not completion proof.
The planning guide records checkout-safe same-store unwind, `TaskAuthoringExecutionScope.setReleaseCheck` and corrected callback-before-private/filesystem-before-pure-release ordering (H3).

`TaskSessionOptions` contains checked private `state`, canonical `sessionDirectory` and optional code-owned `settlement`.
`TaskSessionSettlement.isBusy()` / `inspectAndSettle(reason, signal)` track owned work: reasons `open|departure|shutdown|authoring`, results `no-owned-execution|blocked`.
`authoring` inspects external/retained work during a busy turn, excluding only the exact current handle; it never waits for its own agent to become idle.
One private write-once installation pins the receiver and both callable **own data** methods.
Constructor-supplied standalone settlement and `installShell(): void` use that same cell; a supplied malformed adapter occupies it and cannot fall back to shell success.
Proxy receivers refuse before descriptor reflection; missing/accessor/nonfunction/replaced methods refuse without invoking the replacement/accessor.
`installShell()` takes no adapter or authority selector and requires planning already installed, a live owner, pre-start execution and no prior inspector installation.
It installs a frozen resource-free adapter; repeat, late or external-adapter collision fails with `task-entry-rejected`, while invalid constructor installation retains refusal hooks.
Every busy/inspection dispatch rechecks both own-method identities, calls the pinned receiver, rejects recursive dispatch and clears its private synchronous call scope in `finally`.
Only constructor installation reads `options.settlement`; no later direct-option method path or stale constructor capture may bypass the pin.
The reviewed inspector is resource-free/no-escape/non-reentrant: no checkout/store reopen, publication, navigation, processes or self-agent/tool wait.
A method identity is not runtime footprint certification; arbitrary hidden trusted-JS work is outside containment.
Reserve/arm before invoking its original native Promise, with checked coordinator already held; timeout is only a waiting outcome.
Missing settlement/errors/timeouts grant no success or worker-settlement proof.
Completed blocked-but-closed inspection can permit fresh checks later; a later independent success cannot settle an old invocation.
See [Task Storage Guidelines](../backend/task-storage-guidelines.md) for guarded writers and context-query privacy.

## 3. Contracts

### Entry and live use

D `enter` requires ordered startup **owner discovery → installer baseline → shell admission**.
Capture the existing registry checker once; it must return exactly `undefined` (no `.then` inspection/assimilation).
Pin command metadata, actual manager/session and planning epoch only at successful startup; failure is sticky, not repaired by entry, projection, retry or later startup.
Repeated startup compares established identities rather than recapturing them.
Require callable `newSession`, `switchSession`, native `select` and `input` before the first dialog/bootstrap, and recheck after waits and in final guards.
`shellHostCheck`/`entryCheck` finish all callbacks before pure original `planningEpoch`, generation, exact-work and ticket/deadline checks.

Bare `/cadence` offers context-appropriate New task/Return/Open this task, Continue local and Local history; arguments propose a new request only from proved ordinary context.
Select code/research/diagnosis, supply every bounded escaped request page, retain or replace, then require nondefault final Create.
Exactness starts at Pi-delivered args/input; no extra normalization, editor fallback or inferred human provenance.
Existing seed validation still rejects unsupported controls/format characters.
Create commits checked genesis/seed/pending session/reservation at **epoch 1**, with **zero outbox entries** and no initial repository publication, before its original session handoff; it is not Create followed by a second Open.
Seed background is `[]`; never copy the ordinary conversation or forge a model turn to save it.
B supplies first project materials/index later.
Local inventory/history are noncreating and include unpublished shell tasks; foundation-only records are not Open-eligible.
Continue local selects/Open-restores context, never executes.
History/picker facts confer no attachment: selected Open performs its own current explicit choice and rereads facts.
No source-pending observation or C review slot grants agreement, review UI, readiness or execution.
Admitted initial store setup can precede the final compound guard: postguard zero-write refusal is not whole-route zero-I/O.
Accepted U3 allows first-initialization interruption to leave no task and indefinite entry refusal even after restart; no reset/delete/adoption/recovery action is supplied.
Cold ABI6 deployment and existing bounded uncertainty remain.

Every Open requires a current terminal choice: `Not now` first, then checked Open or explicit reconstruction.
Require `tui`, UI, non-child, matching root/session, idle/no queues/known compaction and available settlement.
Pin manager identity, path/header/locator and leaf before preparation; recheck before native dispatch, after reentrant mount, after waits and at the final write boundary.
Never refresh stale preparation or silently replace a changed source header.

`withAttachment` passes frozen task/epoch data and a code-owned synchronous guard after live/durable checks.
Source writers pass the guard into the narrow store precommit seam after preparation/store opening; pure generation/deadline checks follow host getters with no await/render/foreign callback before mutation.
Reject native async callbacks and asynchronous results using the source guide's descriptor-only classifier and preallocated original-return retention; no thenable assimilation or synthetic completion.
Reacquire after awaits: this idle-command seam is neither model-tool admission, a JavaScript sandbox nor filesystem/SQL atomicity.

Live use checks inode/header/path and bounded append-only ancestry; choices pin the exact leaf.
First lazy persistence may pin an inode with unchanged header/path; later replacement or same-ID branch/header drift fences attachment.
Restoring old values does not revive it.

### Pinned planning-only inspector and exact self

The shell adapter inspects only local correlation and the checked negative lifetime anchor, never host getters, `view`/projection/`rootGate`, controller, storage, checkout, publication, navigation, processes or descendants.
`isBusy` returns false only for the matching healthy context below; `inspectAndSettle` returns its original native Promise with `blocked` on abort/busy, otherwise `no-owned-execution`.
That means no **other accounted owned execution** in this disconnected no-executor composition, not a constant-success stub or foreign/G4 worker settlement.
Inspection pending correlation and the exact armed child precede original invocation; original-Promise observation precedes the timeout race.
The resource-free inspector does not make its caller's store, descriptor, coordinator or body resource-free.

| Current call                                        | Exact negative exclusion; all other work still obstructs                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Idle/availability                                   | No self: private active inventory must be empty and the anchor root clear                                                                                               |
| Synchronous session read                            | Exact work in its active `framed` interval; no retirement, body-self or inspection mismatch                                                                             |
| Source                                              | Exact family/work in its `lexical` same-call interval, including guard/precommit/final checks; exceptional original return, lexical exit, retirement or cleanup refuses |
| A/B/C pending admission                             | `reading === candidate`, exact work/run/turn/planning epoch and nonaborted signal; no active body Symbol                                                                |
| A/B/C body/serialization                            | Same current candidate plus its exact `bodyHandle`, the sole existing `planningWork` Symbol, and matching held-store scope                                              |
| B/C inspection                                      | Writer above plus exact armed pending child, original body/outer-pending correlation, known unreleased coordinator and no entered task-store scope                      |
| Create/Open/Return or departure/shutdown inspection | Exact local parent, pending original body, coordinator and armed child; no unrelated inventory exemption                                                                |
| Navigation postinspection/owned before-switch       | Original unfinished parent after actual inspection completion; admitted handoff also proves exact moving/map/root-lane/purpose/phase/deadline                           |
| Create/Open final callback                          | Exact fresh receiver/final work, successful provisional completion and used final phase; command handoffs also require fresh startup/checker pin                        |
| Return recognition/outcome                          | Exact Return family and sequential readonly-recognition then outcome child; recognition cannot borrow a writer or establish task attachment                             |

Exactly one self match is required; same task/root/session IDs cannot select it.
Anchor currentness still rejects unknown family resources, competing owners and retired work; pending/failed fences, old settlements and uncertain closure remain blockers.
Source lexical exit never settles an escaped original return: only its actual completion may drain its own original fence/resources, without restoring IO or authority.
Inert native waits remain outside execution I/O and keep the existing N1/capacity rules.
This prerequisite adds no resource site/profile/bank/connection, store reader or larger bound; `framed`/`lexical` are synchronous correlation and `bodyHandle` retains an existing Symbol.
The D candidate uses these purpose-specific stacks without expanding lifetime banks; demonstrated Return fault/callback routes below are not every phase/site/loader combination or inference from Open.

### Complete ordinary ancestry and local mappings

`observeContext(ctx, mappings = true, work?)` is private recognition, not a caller-selectable authority API.
Pin actual manager, leaf and generation/source/planning generations before callback-bearing observations.
Null leaf requires absent (`undefined`) leaf entry; a nonnull leaf requires the exact returned leaf ID.
Each ID is nonempty, at most 256 UTF-8 bytes and contains no lone surrogate; every nonnull parent lookup must return that exact ID.
Traverse at most **256 nodes**, tracking visited IDs and requiring a genuine null parent terminator; missing/wrong/undefined/empty parent, malformed leaf, cycle or overbound traversal refuses rather than becoming ordinary.
Proved private-store absence does not skip ancestry or bootstrap storage.

Retain noncreating **64-row pages / 256 history-work budget** for complete local mapping discovery; even a foundation-only G2 row with empty shell history consumes work and supplies no binding.
A retained mapping can identify context after its marker disappears; incomplete/ambiguous/overbudget discovery cannot grant ordinary tools.
This 256-work ordinary-recognition limit does not make local history unreachable: restricted context may still browse history without New or tool authority.
All final root/manager/leaf callbacks precede pure original-pin/exact-work checks; an outer nested session-read path rechecks its original pin after closure, never refreshes it.
`mappings=false` remains confined to an already admitted planning branch check, not startup or ordinary-tool admission.
Startup/tree/planning recognition and D Create admission, Return recognition/outcome and final fresh ordinary projection use this proof.
It is not proof of complete-loop timing/native qualification.

### Locator and reconstruction

Validate canonical allowed session directory/ancestors, direct-child regular single-link file, ID/root/header version, inode and bounded size before/after header read.
Headers are bounded to 16 KiB plus one byte; sessions over 64 MiB require reconstruction.
Unsafe paths fail; missing/configured-unsaved/replaced/old/malformed candidates require explicit reconstruction.
Never validate with `SessionManager.open`: it can initialize missing/empty files or migrate history.
Actual `getSessionDir()` is required, not inferred from a configured filename.

Reconstruction seeds bounded private request/background/current facts through separate structured custom marker and model custom-message entries.
Never copy whole history/receipts/locators, forge assistant turns or call a model to force persistence.
Configured paths/custom entries are not durable-file evidence.
Native markers/mappings restore context only; plain prose/quoted markers do not activate.
Conflicting/incomplete bounded discovery is restricted, not guessed ordinary.

### Replacement, invalidation and departure

Owned Open fences an existing attachment/source wait before waiting, even if later rejected or dismissed; failed durable fencing latches uncertainty and blocks later mutable Open/direct live use.
Commit epoch/seed/reservation before navigation, then close the parent task connection/inspection before crossing replacement.
A current explicit nondefault choice precedes writable coordinator acquisition/work-starting inspection; listing, readonly preparation and inert choices never acquire it.
Recheck expiry/current source/header/private facts after inspection and inside admission precommit.

#### Exact original Open handoff

The actual `Handoff` object correlates original callbacks; IDs/root/session equality are not positive credentials.
After inspection/unwind closes, reserve exactly two single-use children: **provisional**, then **final**, with at most one borrower/connection.
The original setup may precede fresh receiver registration under the approved addendum; it captures the exact handoff/provisional handle and performs guarded context-only preparation/seed writes.
No attachment follows until the unique fresh receiver validates actual manager/root/header/leaf, committed intent/epoch/reservation and original final callback, then performs guarded final CAS.
Provisional connection/child must close before final borrowing; final child closes before original parent completion/coordinator release.
No outgoing Pi/UI/store objects authorize fresh binding, parent-DB rebinding, third child or recursive grant.

Before expected retirement, the original Open parent's narrow guard may track **only source/target session-header reads**, sequentially, while both phases remain unused and its coordinator is known active.
Both header FDs and frame close before retirement/phase entry.
A live/unknown header cannot cross replacement; low-level checked locator alone is not Open success after reentry.
During active provisional/final invalidation, the child's exact reserved fence uses its own still-usable DB and inherited coordinator after transaction unwind, not a new store or the closed parent DB.
[Task Storage](../backend/task-storage-guidelines.md#participating-resource-and-fence-boundary) owns native/fence completion rules; negative child exclusion grants no attachment.

`OpenOutcome = {revoked: boolean}` is shared only by the original handoff and its exact fresh attachment.
Delivered lifecycle/input/source retirement latches it before callbacks; original Open checks it after SDK navigation **and again after actual parent closure**.
It can downgrade stale `attached` to `pending`, never grant authority or prove resource closure.
Read only plain correlation at this boundary; never call the outgoing host.
The exact final callback registers `Handoff.postClose` on the original navigation-body Promise.
The outgoing continuation first performs actual child/parent/coordinator/core closure; only then may the fresh synchronous refresh run.
Create/Open and Return await that exact reaction before returning affirmative primitive outcomes.
Missing reaction or fresh checker/currentness refusal yields `pending`, revokes the shared outcome and restricts/fences fresh attachment as applicable; durable attached/arrived facts remain truthful.
This reaction is ordering acknowledgement, not resource-closure evidence, a new timeout/retry protocol or a positive lifetime credential.
Fresh checker failure cannot be reduced to an uncertainty flag after public success was already decided.
`finishReplacement(h, ctx)` must catch phase/receiver validation as well as receiver execution: any original final-callback failure, including a consumed duplicate, calls `poisonHandoff(h)` before rethrow or the already-registered fresh reaction can run.
Both negative latches precede core retirement; poisoning does not close resources.
A finished old family cannot retire a later generation through replay.
Both fresh reactions screen the **exact original** navigation-body result: only `attached` for Create/Open or `returned` for Return avoids this negative revocation.
Rejection/cancellation after committed final facts still revokes fresh attachment/ordinary projection.
Those strings are necessary negative constraints, never positive authority: exact fresh receiver/manager, registry, epoch/generations, deadline, ordinary proof where applicable and actual child/parent/coordinator/core closure remain mandatory.
Truthful durable attached/arrived facts do not grant tools.
Missing module-local rendezvous, wrong/duplicate/out-of-order/expired callback or ambiguous receiver retains recoverable context-only facts; the negative anchor cannot reconstruct positive lineage.
Late original completion permits fresh explicit reconstruction only after resources/fences close; it never resumes the old request or restores tools.

Delivered `input`, `user_bash`, `before_agent_start`, `agent_start` and before/terminal compaction events invalidate Open/source choices even without an input observer, including after response.
Discussion retains attachment; navigation/lifetime observations fence it too.
Owned navigation and delivered switch/fork/tree fence before settlement, not hidden unchanged-state attempts.
Return `{cancel: true}` for uncertain cancellable departure; exceptions are not vetoes.
Later-extension cancellation leaves context-only state and the durable fence intact.
Reload/disposal cannot be vetoed and never proves work completed.

Native choices expire locally after five minutes without host signal/timeout/abort cleanup.
An inert popup may linger: Escape dismisses; retry requires normal native settlement or a fresh fenced owner.
UI waits are not owned execution I/O; uncertain I/O still blocks departure.
The [source guide](./task-source-guidelines.md) owns bounds/capacity/error details.

`view()` is ordinary/context-only/attached/restricted projection, not authority.
Without the planning installer, explicit raw-bash refusal covers entry/source waits and known owned/unavailable-composition obstruction, not full task tool enforcement.
With it, the integrated restriction predicate also blocks raw bash in task/transition/uncertainty states; tool hooks and guarded same-owner restoration belong to [Planning Host](./task-planning-guidelines.md).
No publication replay, approval reissue or execution; full native review paging remains later work.

### D Return and final ordinary projection

Return fences attachment before its first getter/wait, preserves pending publication facts without replay, and requires a current saved-origin choice or explicit clean ordinary destination.
Missing/unsaved origin does not justify opening a configured path or reconstructing ordinary history.
Use reserved Return intent/outcome identities and sequential **readonly recognition → guarded outcome** phases; arrived storage vocabulary is not a task binding.
Those children finish before the original parent/body/coordinator closes; only afterward may the fresh reaction recheck ordinary recognition and project its own checked tools.
Unknown work/closure retains restrictions; canceled departure never resurrects attachment.
The fresh `restoring` scope pins exact handoff, `family.finished`, original deadline and attachment/source/planning generations.
`projection()` captures pins **before** callback-bearing root checks and compares them in its pure return tail, including `restorationCurrent()`.
This protects the installer's last `lane.projection()` **before** ordinary `setActiveTools`, not merely a later refusal.
No outgoing baseline/checker/host callback may restore tools, and foreign membership must not be overwritten.

### C lifecycle entry matrix

`src/task-session.ts` separates pending-review invalidation from run/candidate retirement; [Planning Host](./task-planning-guidelines.md#c-admission-and-pending-review-release) owns C scopes/witness/release.
**P0 review rule:** enumerate every entry, including routes bypassing a predecessor event, and locate its first callback.
`rootGate` is not pure: it reads context and invokes manager `getCwd` before filesystem checks.
U = delivered/owned conflict, X = exact private handoff exception, C = completion/correlation only, O = observation/initial setup.

| Entry                                                         | Class    | Required behavior before callbacks                                                                      |
| ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| input, raw bash, before/start agent                           | U        | `deliveredChoices` stales pending, advances review generation and revokes planning correlation          |
| before switch/fork/tree                                       | U/X      | Unowned retires first; only exact original owned switch may use X                                       |
| first session_start                                           | O/X      | Empty local state; preserve original fresh Open receiver                                                |
| repeated session_start                                        | U        | Retire before context properties; same-owner `bindExtensions({})` emits start without shutdown          |
| delivered session_tree                                        | U        | Retire independently of any preceding before-event                                                      |
| before/success/failed compaction                              | U        | Each delivered event retires; retain separate early-abort signal checks                                 |
| unowned shutdown/reload/runtime dispose                       | U        | Retire before root/family/projection/settlement callbacks; shutdown may arrive without before-switch    |
| owned navigating shutdown                                     | X        | Prove exact phase/work/map/deadline before old root/header observations; poison invalid proof           |
| sourceCall / withAttachment                                   | U        | Stale pending/review generation and revoke planning before root/IO; preserve shared source ticket       |
| withSourceChoice                                              | U        | Retire conflicting planning before preparation; native source protocol unchanged                        |
| Open                                                          | U/X      | Lose pending/fence old authority before observations/waits; exact handoff alone retains children        |
| observeRun/observeTurn/tool end/endTurn/endRun/revokePlanning | C        | Retire correlation, not pending or original invocation/resources                                        |
| root/view/projection/tool admission/setup                     | O        | Observation alone is not conflict; discovered root/branch drift retires before later cleanup/projection |
| native reply/expiry, inspector completion/abort               | O/C      | No new authority or closure of unrelated work                                                           |
| direct AgentSession.dispose                                   | O limit  | No shutdown hook on pinned SDK; do not claim unobserved pre-abort fencing                               |
| review consumer                                               | Deferred | No API, settled trigger or agent-end UI                                                                 |

U stales local authority, **not** original Promise/resource completion.
Retain sticky fences/restrictions; uncertain cancellable departures explicitly return `{cancel:true}` and raw bash returns handled cancellation, never throw-as-veto.
Pi 0.84.3 reload and runtime disposal emit shutdown directly; a later before-event cannot retroactively repair first-callback order.
Actual unload removes hooks; direct session disposal is an observed-delivery limit, not a new monkeypatch requirement.

X uses the exact private `Handoff` object (`owned === moving`, `opening === owned.family`) plus `phaseCurrent`'s map/root-lane/phase/deadline/original-work checks, not reason/target/task/session equality or a boolean exemption.
Check before **and after** callback-bearing root/header observations.
Invalid cancellable owned before-switch cancels; invalid owned shutdown is noncancellable and poisons, never returns fictitious cancellation/attached success.
Preserve original two sequential provisional/final children, child-before-parent closure, fresh receiver guards and negative outcome latch.
Blanket invalidation would break useful original Open callbacks.

Normal result/follow-up append and agent end are C, not navigation or semantic change; they keep the inert slot without presenting it.
This is supported by static nonstaling call graph plus actual SDK event order/append assertions; there is no public idle pending getter.
No hidden unchanged-state/foreign-work/ABA detection or outgoing-tool restoration follows.

## 4. Validation and error matrix

- Stale/nonterminal/busy/unsupported entry → `task-entry-rejected`, no admission.
- Unsafe/unavailable session capability or malformed private context → `task-session-unavailable`, no raw locator/parser text.
- Missing/changed/unsaved safe target → explicit reconstruction, not silent migration.
- Completed blocked-but-closed inspection → reject this request; fresh admission may later proceed.
- Timed-out original/rejected inspection, failed fence or native close uncertainty → retained same-root refusal across compatible replacement; cancellable departure returns `{cancel:true}`.
- Post-final delivered navigation/input → no stale `attached` result, even if binding committed before revocation.
- Expired/stale/double fresh callback → pending context, not attachment.
- Retained marker/approval or same session ID → context only, never live permission.
- C invalidation after a callback rather than before it → ordering defect even if eventual admission refuses.
- Known-closed typed C read refusal → later fresh checks possible; unknown native cell → existing anchored refusal, never error-code settlement.
- Missing/invalid/replaced inspector or repeat/late/colliding shell installation → `task-entry-rejected`, no replacement invocation or fallback adapter.
- Availability descriptor drift → unavailable/known busy; an exception from a valid pinned busy body still latches uncertainty and revokes planning, not a swallowed descriptor refusal.
- Missing/wrong parent, inconsistent leaf, cycle, incomplete mapping or final traversal invalidation → restricted recognition, no ordinary-tool grant/bootstrap.
- Multiple possible selves, required fence or exceptional Source original → refuse; exact current work is not completion evidence.
- Missing/nonvoid/throwing registry checker or failed ordered startup → sticky `task-entry-rejected`, no lazy startup repair.
- Missing navigation/native API or reentrant capability revocation → refuse before dialog/private bootstrap.
- Last projection getter revokes planning epoch or expires Return → no ordinary setter call, even when it returns unchanged values.
- Fresh post-parent-close refusal → public `pending`, restricted context and retained committed facts, not false rollback or stale success.
- Original final callback fails/is consumed twice, even if its error is swallowed → poisoned lineage before fresh reaction; no ordinary setter or attachment.
- Original navigation rejects/cancels after successful final commit → negative outcome revocation; arrived/attached history survives without live authority.

## 5. Good / Base / Bad cases

- Good: explicit Open reconstructs an unsaved conversation via fresh setup/start/withSession, preserving issuance provenance and pending outbox.
- Base: native resume/fork/import restores bounded context and requires explicit Open.
- Bad: infer success from a vanished handoff, accept a changed same-ID header, or use decoded bindings as permits.
- Good: saved/unsaved original Open completes both sequential children while the SDK still awaits the parent; unrelated same-root Open cannot borrow that exclusion.
- Base: lost file-loaded rendezvous leaves context-only recoverable intent, then later explicit Open after actual closure.
- Bad: refresh outgoing host getters after replacement or equate `OpenOutcome.revoked === false` with current attachment.
- Good C: actual reload advances correlation/stales pending before first old-manager callback, while a current original saved/unsaved Open still completes.
- Bad C: rely on before-switch for reload, on shutdown for repeated startup, or invalidate normal agent-end to compensate.
- Good prerequisite: install planning then the shell-owned inspector before startup; original saved/unsaved Open and busy A/B/C remain useful without fixture settlement.
- Base prerequisite: a complete empty/256-node ordinary branch and bounded foundation-only mappings need no writable bootstrap.
- Bad prerequisite: missing parent means ordinary, an invalid standalone adapter may be replaced, or same-root equality exempts an old inspection.
- Good D: healthy Return closes the original family, then the fresh owner proves ordinary and projects its own baseline before acknowledging `returned`.
- Base D: closed failed publication remains pending through Return/Open without reconciliation; facts alone are not live I/O.
- Bad D: return success before fresh refresh, or allow ordinary membership briefly and rely on a later guard to report refusal.

## 6. Required tests and qualification

`test/task-shell-session.integration.test.ts` uses `test/helpers/task-shell-host.ts` and real SDK dispatch.
Retain locator/lazy-persistence/branch/import, pending/provisional/attached crashes, callback identity/expiry/duplication, cancellation/append and async negatives.
Test observer-independent invalidation, post-answer store-open reentry, failed fencing and uncertain settlement.
Approval fixtures are not issuer evidence.

`test/task-source.integration.test.ts` covers guarded writers/final getter reentry; `test/task-native-ui.integration.test.ts` covers both-mode Open/reconstruction/source through unmodified native methods on fixture receivers, not full constructor/init/CLI.
The source guide details real renderer/selector and terminal/dock fixture limits.
N1 binds supplied bytes, not clipped paint or physical reading.
Preserve v1 failures; no PTY, installed-product, human, containment or full G2 qualification follows.
Retain `test/task-lifetime-open.integration.test.ts`, `task-lifetime-open-review.integration.test.ts`, `task-lifetime-open-result.integration.test.ts`, `task-lifetime-navigation-read.test.ts` and `task-lifetime-handoff-fence.test.ts`.
Assert saved/unsaved positives, exact setup-before-receiver/final callback ordering, no self-deadlock, wrong/duplicate/missing manager/phase refusal, both-header first-close faults, actual same-child fence and no stale post-final navigation/input result.
Original B H1/H2 and Open inspection/map-loss file-loaded probes now pass; preserve original bodies and red logs.
The historical independent `research/planning-b-lifetime-integration-readiness.md` qualifies only the isolated Linux Node 26.7.0 / Pi 0.84.3 slice and records READY FOR FULL GATES, not an acceptance verdict.
Node 22/24, native Windows/macOS, PTY/full CLI, installed-tarball, full review/issuer/compiler and G4 remain gaps; main owns full repository/distribution/real-pack evidence.

Retain all six C host/pending/safety/lifecycle/final-lifecycle/shutdown suites linked by [Planning Host](./task-planning-guidelines.md#6-tests-required).
Assert first-callback throwing/reentrant raw bash/switch/fork/tree/shutdown/start/source cases, actual reload/runtime disposal/rebind, delivered terminal tree independently, expired owned phase before getters, current saved/unsaved file-loaded positives and normal append/end preservation.
Native first-close unknown before/after syscall must survive replacement/disposal and no-marker A→ordinary B→A without reset/reclose/count inference.
The PW1/PW2 corrections fixed propagation and an implicit callback-purity assumption, not missing approved requirements.
Review the whole entry matrix, not just the last failing caller; original reds remain history.

### D prerequisite evidence and retained gaps

`test/task-shell-entry.integration.test.ts` contains **46** new pre-registrar cases: installation order/collision/own-data identity and receiver, saved/unsaved original Open, busy all-kind A/B/C and all four B operations, actual Source guard/progress/exceptional-return lifetime, ancestry/mapping bounds and final callback drift.
Retain first-close faults before/after the native syscall (exact original inode before/after reload on the former), file-loaded old-inspection refusal, conflicting candidate/departure cancellation and proved-closed blocked-inspection fresh admission.
Invalid-adapter installation fixtures are inert registration tests, not actual SDK work; seeded task fixtures/controlled replies are not clean-consumer creation or human approval.

Evidence lives under `/tmp/cadence-g2-d-implementation.1dzxw491/`: `gate2-prereq/report.md` and `gate2-prereq-review/report.md`.
Final-source implementer evidence is **46 new tests** and **275 original host tests**; earlier 171/160 native/lifetime runs predate the final standalone-busy-exception correction and are not final-hash reruns.
Independent review freshly passed **75 tests / 5 files** (including the 46), check/scoped Biome, unchanged original **H1/H2 (2 tests)** and **3 independent probes**; these overlap and are not summed.
The probes assert parent-getter invalidation with no ordinary business-tool restoration/bootstrap, nested Source refusal without borrowing the outer lexical self, and final Source getter invalidation with unchanged retained progress facts.
Original H1 is file-loaded original-FD evidence; original H2 is timed-out authoring inspection through same-module SDK reload, not file-loaded H2.
The separate manually retained inspection/fresh file-loaded shell-owner case is not that original H2.
Development/noninjecting/fixture failures and original historical reds remain preserved, not retrospective passes.

Earlier D Gate 1 **1234 serial and 1234 default tests** qualify only the then-hashed foundation, not a rerun after this prerequisite.
That prerequisite qualification remains Linux x64 / Node 26.7.0 / Pi 0.84.3; it alone supplies no registrar/Create/Return, CLI/PTY/human display, new-platform or full-gate evidence.

### D Gate 2b candidate and correction qualification

`test/helpers/task-shell-registrar-host.ts` loads the actual registrar; appended `test/task-shell-entry.integration.test.ts` and new `test/task-shell-return.integration.test.ts` cover the candidate.
Preserve the original **46-case entry prefix** and all later pre-correction prefixes/assertions/deadlines.
Require strict/sticky startup and no `.then` getter invocation; no UI/bootstrap on missing APIs; exact epoch-1 request/kind/zero outbox; original saved/unsaved callbacks; canceled/stale/expired/duplicate entry; useful busy A/B/C; pending-publication preservation and actual fresh ordinary projection.
R1 tests/probes inject at the last fresh projection getter **after real native/core closure**, require zero ordinary setter calls on matching-value revocation/expiry, and include a healthy actual-setter control.
R2 tests require Create/Return/registrar-selected Open to remain publicly pending after actual close when the fresh checker revokes, with no outgoing checker call and intact committed facts/fences.
These are pre-effect and post-close ordering assertions, not output-only tests.
The earlier [loop checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate2-loop-checkpoint.md) and external `gate2-loop-correction-review/report.md` close R1–R3.
The later [R4 checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-r4-checkpoint.md), `gate2-r4-review/report.md` and `gate2-r4-completion-review/report.md` independently review the two negative-lineage corrections and appended coverage: first **50 new cases pass**; second **27 pass / 1 enabled maximum-publication case times out**.
These are selected, overlapping implementation/review runs, not 78 passes, complete-file or whole-composition qualification.
Preserve the prior 120-case and subsequent 170-case prefixes, old loop deadlines and skip rules.
Saved Open/Return use actual file-loaded `additionalExtensionPaths`/Jiti and original `switchSession` callbacks, with **no caller setup**; new-session/reconstruction setup precedes fresh startup.
Assert exact receivers, lost/wrong/duplicate/swallowed-error/expired final callbacks, post-final rejection/cancellation and late replay without changing later-generation facts/tools.
Controlled wrappers establish those fault cases, not that stock Pi normally produces them.
Saved fixture persistence uses actual header/custom entries before provisional locator capture, never fabricated assistant/model turns.
Actual Return recognition DB/header FD, outcome DB and parent coordinator healthy/fault controls pin original resources and one close attempt; unknown close retains restrictions and phase-appropriate pending/arrived facts.
Recognition traps cover all seven current TaskStore entrances, three checkout/package acquisitions and mutating `DatabaseSync.exec` statements, including no fallback writer after readonly failure.
Together with the static readonly path, these prove the demonstrated routes, not arbitrary native-SQL/JS containment.
[Fault fixture retention](../backend/quality-guidelines.md#testing-conventions) must precede any diagnostic/assertion that can throw.
History tests reconstruct complete minimized detail bytes, revisit identical pages, traverse nested Back/dismissal paths and check privacy, DB/fact/tool preservation and no writer/publisher/navigation.
The 65-row fixtures prove variable session byte-envelope pages and small-publication 64+1 continuation, not maxima.
Session detail is at most **113 escaped ASCII bytes** in the checked closed shape; that does not bound raw session rows.
The **65536-byte** raw envelope (including 1024 framing reserve) can split below 64 rows.
Full 64-row menus omit Back to task to fit choice capacity.
Neither the <=819-epoch arithmetic bound nor 256-work ordinary mapping proves the **64-cursor** history limit unreachable; G1 `TaskStore.intent` has no 4096 lifetime publication cap.
The enabled public-API **4097-intent** case attempts cursor exhaustion, Previous and fresh-list restart but timed out **20651/20000 ms**; its last predeadline page is unknown.
Maximum byte-heavy lawful session history also remains unconstructed/unqualified.
No skipped case, shortened sequence, deadline lift or late-teardown completion claim closes either gap.
The original 43-file run remains **1840 passed / 8 timeouts**, plus **two collection failures**; six old composite timeouts remain unexplained.
Selected correction/compatibility/native passes are separate overlapping runs, not full-loop acceptance.
The research-loop diagnostic preserves nine asks (**19.390 s**) and its **20000-ms** deadline: it timed out, planning assertions were late, Return resumed after cleanup and Open was unobserved.
Four solo old-Source comparison passes are not an exemption or established cause.
No registrar native regular/fullscreen/CLI/PTY, process-cut/full-gate or installed-tarball qualification follows.
[Quality Guidelines](../backend/quality-guidelines.md#scenario-c4-native-fixture-emission-and-closure-acknowledgement) owns the independently reviewed collection-only correction to the current 32-input inventory and the 124-member manifest versus still-pending separate real-pack/body verification.
Gate 1's 1234 passes are historical foundation evidence, not current-candidate full-suite results.
No runtime validation or acceptance is performed by this spec capture.

## 7. Wrong vs correct

Wrong: matching session ID plus a consumed-looking callback implies current attachment.
Correct: pin manager/header/path/branch/epoch and require the fresh owner's committed attached phase.

Wrong: `owner.withAttachment(ctx, async ids => writeLater(ids))` or checking only before store opening.
Correct: prepare plain data synchronously and pass the code-owned guard to the narrow writer; reacquire currentness after any wait.

Wrong: any waiting parent blocks every fresh callback, or matching IDs allow any successor to exclude it.
Correct: only the original two sequential callback children borrow exact negative exclusion; fresh final-binding checks independently establish attachment.

Wrong: committed `attached` history makes the original Open response successful after delivered navigation.
Correct: retain the exact negative outcome latch through actual parent completion and downgrade revoked success without outgoing host calls.

Wrong: classify `rootGate` as pure or assume reload/rebind delivered an earlier invalidating hook.
Correct: classify each entry U/X/C/O, retire U before its first callback, prove exact X early, and retain normal C/O positives and explicit no-hook limits.

Wrong: `while (entry) entry = getEntry(entry.parentId)` proves ordinary when a parent is missing, or `isBusy: () => false` proves settlement.
Correct: require exact leaf/parent identities, visited-cycle exclusion and complete null-terminated bounded ancestry; dispatch the pinned inspector with exactly correlated self while retaining all actual resources/original Promises.

Wrong: `projectPlanning()` returning void proves registry admission, or an earlier epoch check protects a later callback-bearing projection.
Correct: use the captured strict checker after ordered startup, then compare original `planningEpoch`/generations/deadline after the **last** observation and before the membership effect.

Wrong: `return await originalNavigation` settles the public result before a fresh reaction can refuse it.
Correct: close the actual original family, await its exact fresh `postClose` reaction, then read only negative correlation/deadline to decide the result.
The bug classes are an omitted final pure guard and asynchronous negative-observation ordering, not missing response formatting.

Wrong: a successful final commit or swallowed duplicate error lets an already-registered reaction restore tools.
Correct: poison the exact original handoff before rethrow; screen its original body's result negatively before fresh checks/projection.
Neither a success string nor durable arrived facts supplies authority.

## Scenario: Candidate-only convergence mapping and native terminal review

### 1. Scope / Trigger

This describes the sole private convergence candidate, not code already integrated into LIVE or accepted production.
Earlier missing-issuer/CLI and mandatory full-history statements above remain historical checkpoints.
`src/index.ts`, ordinary chat and legacy activation are unchanged.

### 2. Signatures

`registerTaskShell(pi, {state, sessionDirectory, privateRoots})` retains no compiler/fixture option.
Pre-start `owner.installReview(service, source)` connects the default-unavailable service and actual Source service.
Private `terminalReview` and `withReadonlyObjectiveAgreement` use fixed-purpose native page dispatch, not a model capability or generic UI profile.

### 3. Contracts

Ordinary recognition uses a dedicated bounded mapping read plus exact null-terminated 256-node ancestry; pin original startup session ID, manager and leaf before reads and recheck after final callbacks.
Check selected reserved-key domains, predecessor departure kind/request and event references even when other history is not audited.
Return destinations are ordinary history, not task bindings; ambiguity/incomplete mapping remains restricted.
Menu selection creates fresh attached review intent, never revives an old C slot or attaches context-only history.
One original five-minute deadline governs overview/material paging and issuance; native default remains `Not now`, no host timeout/abort/hide.
Complete contiguous overview precedes final control; every bound immutable artifact and exact plan is accessible through ordinal picker pages of eight documents, at most 65 documents.
Header/content bounds are 256/1024 bytes, 3/8 lines and 72/64 columns; control escaping and UTF-8 cursors are reversible.
Actual reads/writes/checkout close before inert waits; final fresh host checks precede callback-free private/material/file checks, pure response/receipt/deadline checks and synchronous consume/CAS.
H3 post-close checks compare this exact committed outcome; lost response/reopen observes original provenance without compiler replay, reissue or execution.
Tool restoration requires the exact fresh post-close ordinary proof; no outgoing baseline or known foreign-set overwrite.
N1 delegates painting, not complete supplied bytes; synthetic keys are not physical-human consent.

### 4. Validation & Error Matrix

Changed ID/root/leaf/Intent/file, expiry, stale/double/missing response or incomplete access refuses attachment/approval.
Missing compiler returns unavailable with no plan identity or affirmative control.
Unknown actual closure retains restrictions/resources; timeout/native disposal is not completion.

### 5. Good/Base/Bad Cases

Good: same immutable pair after Not now validates through a fresh private receipt/interaction.
Base: approved reconstruction shows exact old facts; Continue/execution remain absent.
Bad: map a substituted getter ID to ordinary mode, infer authority from rendered pages or reset expiry per page.

### 6. Tests Required

Complete entry/Return/session, approval, review UI/compiler, native, resource, CLI and fresh-process suites remain enabled.
Assert substituted-ID refusal, reserved collisions, predecessor/event joins, default/Escape, all G2 roles plus exact plan access, original deadline and unchanged-pair/lost-response behavior.
Native modes and repository-pinned OS PTY are separate evidence; retain their actual exit receipts and platform limitations.

### 7. Wrong vs Correct

Wrong: UI snapshot/marker or durable approval authenticates a fresh attachment or restores tools.
Correct: independently revalidate selected facts and current host identity, require explicit Open, and preserve original approval provenance without launch.

## Scenario: Isolated G4 execution and departure owner (unaccepted)

### 1. Scope / Trigger

Only `registerTaskExecutionShell` installs the fixed foreground lane.
`registerTaskShell` stays planning-only; production `src/index.ts`, ordinary engineering and all model tools remain disconnected.
This supersedes the historical absence of Continue only in the isolated G4 composition, not production.

### 2. Signatures

Pre-start `owner.installExecution()` has no executor/verifier/closure option.
Private `runExecution(ctx, continuing)` owns one original work/checkout/native storage/backend family.
`drainExecution()` invokes typed backend pause, joins its exact control Promise, closes originals, then releases checkout/work.
Execution status is readonly.

### 3. Contracts

A start requires this call's one-use genuine terminal issuance after the actual review family closes; retained approval never starts.
Open/reconstruction/reload only restore context/restrictions.
A distinct nondefault Continue performs fresh full attachment/private/material/source/profile checks and preserves original review provenance, run identity and used budgets.

Package candidate and verification owners are fixed; there is no fixture/PASS or caller-supplied controller port.
Fixed backend modules load only after explicit start/Continue and are rechecked after every import/capability await; legacy planning/native replay keep their original bounded module closure.

Execution's negative native menu alone carries its exact original work through every existing selector/dispatch root cut.
Old G2 callers and the resource-free inspector keep unborrowed checks.
Repeat actual host/leaf/header/currentness after native await.
No root-ID, task-ID, copied-marker or blanket executor-self exception is admissible.

Pause/Return/Switch and delivered before-switch/fork/tree/tree-after/shutdown revoke first.
Durable pause and exact original-body/native closure precede G2 navigation/ordinary projection.
Later foreign cancellation cannot restore the old permit.
Unknown intent/body/first-close keeps exact resources, checkout, materials and restrictions and vetoes cancellable departure; shutdown cannot promise veto or forced-exit settlement.
No destructor, timeout, parent exit, retry-close or error string substitutes for closure.

### 4. Validation & Error Matrix

Unavailable capability or stale final issuance: approval may persist, with no writable native launch.
Missing/unknown settlement: `termination-unconfirmed`, retained obstruction, no navigation/tool restoration.
Verified application is historical context with objective completion pending G5, never task lifecycle completion.

### 5. Good / Base / Bad Cases

Good: actual package process creates a sealed candidate, independent native checks verify it, and original checked apply produces a retained verified-application result.
Base: inert Open followed by current explicit Continue on the same run and spent budget.
Bad: retained review, chat, fabricated PASS, a new owner, or canceled navigation automatically restarts execution.

### 6. Tests Required

Keep complete original entry/Return/session/approval, A/B/C/Source, native/lifetime/emitter and engine/application suites.
`test/task-shell-execution.integration.test.ts` adds actual SDK G3→G4, capability/final-close negatives, original native preparation/worker/verifier/post-apply barriers, owned Pause/Return, native switch/fork/tree/shutdown and native-close-return-loss retention.
Excluded CLI qualification selects the fixed G4 registrar and runs unchanged regular/fullscreen no-model navigation bodies.
These are Linux offline/controlled-UI evidence, not paid/human, installed-engine, Windows or Node22/24 qualification.

### 7. Wrong vs Correct

Wrong: fix active Pause by exempting every root query, or keep a mutable engine loaded on Open.
Correct: exact-work negative controls only, cold fixed positive composition, fresh witnesses, and actual typed pause/original closure before fresh G2 admission.

G4 final callback ordering: read both actual `ctx.model` and `ctx.modelRegistry` before the post-getter foreground guard and before checkout/storage/engine allocation.
Reading registry later inside factory argument construction can allocate a mutable engine after its lazy getter revokes.
The actual SDK command-context getter test mutates the original SessionManager branch and requires zero native storage constructors, retained approval and no worker/application.

Bounded M1/M2 source composition now captures the checked original basis while the execution family is current and privately issues a receipt only after its complete original normal drain.
A separate fresh work/invocation/physical checkout persists it; delivered revocation fences that writer, and its own unknown first close remains retained and blocks positive UI/negative navigation.
A cold historical completed Continue cannot mint vanished closure proof.
Labels remain “verified application / objective completion pending G5”; no Completion choice, departure publication, archive, knowledge or production composition is added.
The receiver observes host state, repeats actual sealed native evidence/task witnesses, then uses the separate callback-free original-action check before writing.
See [backend contract](../backend/task-execution-guidelines.md#scenario-bounded-closed-family-handoff--selected-evidence-basis-m1m2-only).

## Scenario: Isolated G5 research, completion and knowledge controls

### 1. Scope / Trigger

Only `registerTaskCompletionShell` installs this fixed composition.
Production index and ordinary engineering remain unchanged.
See the [G5 handoff](../../tasks/10-06-cadence-readonly-history-knowledge-completion/research/knowledge-controls-handoff.md) for actual evidence and unresolved gates.

### 2. Signatures

Pre-start `installCompletion()` composes the fixed completion service; it adds no provider/PASS/closure selector.
Native actions are Completion status, Assess and finalize, Continue completion, Continue finalization, Knowledge suggestions, and Plan linked code fix.
`guardCompletionInStore` uses the exact admitted held store, not nested authoring admission.
The existing resource-free settlement inspector stays resource-free.

### 3. Contracts

Current research Create or explicit Continue research grants local collection; context-only Open and code Create do not.
Completed readonly tasks cannot collect another basis.
Model inputs are closed collection/assessment proposals only; byte-page context is context-only, never proof or a command/confirmation.

Readonly completion pages the whole current objective definition and retained report separately before its nondefault final choice.
Native knowledge pages candidate, support, assessment, uncertain/conflicting scan, original predecessor/publication, and exact rendered note.
One-use WeakMap membership binds the whole view; copied objects/chat/truncated titles cannot confirm.

Genuine normally closed original G4 application plus the still-current original action permits automatic code completion.
Do not reuse revoked execution permission or historical success as permission.
Continue finalization retries only committed required result/archive/ack; no model, collection, optional backlog, worker/verifier/engine/apply.

Linked remediation creates a separately confirmed unapproved code planning task, with readonly findings/task ID as context.
It never converts the old task, inherits approval, or grants execution.

Track exact original G5 body/work in the existing departure lane.
Revoke before callbacks, retire exact current work, await exact original completion, and require first normal native closure before release.
The 60-second watchdog grants no closure.
Unknown close retains originals/coordinator/material and cancels unsafe departure; pending body intervals grant neither Source nor model mutation nor a second native action.

### 4. Validation & Error Matrix

Stale root/task/epoch/leaf/view, copied receipt or unsupported action: bounded refusal.
Missing genuine basis: blocked/research context, not fabricated Completion.
Optional conflict: archive remains valid, optional intent remains pending.
Unknown native closure: retained obstruction and cancellable departure veto, never retry-close or normal projection.

### 5. Good / Base / Bad Cases

Good: whole-candidate native consent finishes the same conflict-stopped fact intent and bytes.
Base: context-only Open, then a distinct current Continue.
Bad: Open starts research, a readonly finding upgrades its original task to code, or finalization invokes an engine to regenerate support.

### 6. Tests Required

Keep complete entry/Return/session/Source/G3/G4/native/emitter/lifetime tests and original assertions/deadlines.
Native G5 tests require genuine collection/report, whole native norm and pending-fact confirmation, readonly archive/linked planning, independent engine-replay traps, and actual before/after-first-close original-DB retention/departure veto.
Controlled replies and source fixtures do not establish physical-human, paid-model, installed-product or new-platform qualification.

### 7. Wrong vs Correct

Wrong: execution's drained permit also authorizes G5, or IDs exempt every lifetime root check.
Correct: separate current G5 action pins and exact original-work exclusion after genuine closure.
Wrong: a fulfilled Promise or a later close releases an uncertain family.
Correct: account for the exact original body and first native close; uncertainty stays retained across compatible replacement.

## Scenario: G6 fixed production host bootstrap (unreleased source)

### 1. Scope / Trigger

This scenario supersedes only the historical production-disconnected ownership statements above.
`src/index.ts` now registers the fixed completion shell and independent nonactivating configuration notification.
Earlier acceptance, failures, bounds and platform limitations remain historical evidence, not new release passes.

### 2. Signatures

`registerTaskCompletionShell(pi, options?)` uses the sole fixed G3 compiler, G4 original engine and G5 service.
Explicit checked options retain isolated host composition; omitted options bind the actual original native host.
`createTaskSessionOwner(pi, options?)` installs original lifecycle hooks immediately, before any host binding.
Private composition calls `owner.bindProductionHost(ctx)` once and `owner.checkProductionBinding()` after installing the fixed services.
Neither method accepts root, compiler, executor, closure or approval selectors.

### 3. Contracts

Discovery registers `/cadence` and original source, invalidation, refusal and departure hooks without resolving roots or allocating storage.
The shell's initial `session_start` handler precedes original owner discovery.
It binds canonical actual `ctx.cwd`, matching `sessionManager.getCwd()` and actual canonical `getSessionDir()`.
`resolveStateRoot` checks the external state location, using the existing `XDG_STATE_HOME`/home policy rather than a new selector.
Private domains are that checked state base/product root and actual session directory; no guessed agent/session path or `process.cwd()` is used.
Bootstrap constructors allocate no TaskStore, checkout, private database/directory, model, worker, verifier or publisher.

All host callbacks precede pure original generation/planning/source checks.
A pre-bind delivered invalidation, mismatched host or failed initial composition refuses permanently; later startup cannot repair it.
Original before-switch/fork/tree/shutdown hooks already exist at discovery, so a later extension's cancellation cannot overtake their retirement.
Unbound raw bash returns handled cancellation and cancellable departure returns `cancel: true`, never throw-as-veto.

Pinned Pi 0.84.3 iterates the current extension's live handler array.
The tool projection and shell admission installed during the first event therefore run once after original owner discovery, in their original order.
Repeated startup does not reinstall tools/services/hooks; original same-owner invalidation and identity checks remain.
A new runtime installs a new original owner; handoff, ancestry, header/leaf, branch/epoch, currentness and first-close rules above remain unchanged.
Only exact current original callback lineage attaches; history/import/reload does not recreate permission.

`CADENCE_SUBAGENT_CHILD=1` suppresses production registration.
Task control requires native `tui`, UI and idle/no pending messages; RPC with UI is insufficient.
Ordinary/quoted/old-marker text does not authorize tasks.
Pi's generated `sendUserMessage` disables command/template expansion, and `steer`/`followUp` reject extension commands.
Direct trusted SDK `prompt` dispatches commands before input and does not expose an input-source witness to the command.
Do not claim hidden caller/physical-human provenance from that API; every mutable task action still requires original terminal choices and current guards.

### 4. Validation & Error Matrix

- Missing startup, invalid/mismatched roots/session directory, reentrant native departure or failed bootstrap: `task-entry-rejected`, no lazy repair.
- Nonterminal, child, busy, stale leaf/header/manager/epoch or queued state: refusal before task mutation.
- Original native first-close return loss: retained exact obstruction/material, no retry-close, canceled unsafe departure.
- Startup presentation error: isolated nonauthority failure, never resource settlement or tool restoration.

### 5. Good / Base / Bad Cases

Good: a nondefault session directory and host root different from process cwd bind once, followed by genuine Create and original fresh receiver callbacks.
Base: ordinary startup/canceled menu creates no task namespace; readonly history remains inert.
Bad: create services in a command to repair skipped startup, infer a session directory from environment/cwd, or treat RPC UI as terminal authority.

### 6. Tests Required

`test/task-production-bootstrap.integration.test.ts` loads the actual source entry inline and through the pinned disk loader.
Assert first/repeated startup, actual roots, reentrant before-tree, pre-start refusal, exactly one original fork/tree/shutdown registration and the nine-tool registry when the SDK supplies all eight built-ins.
`test/task-production-entry.integration.test.ts` asserts actual source nonterminal/child/ordinary/generated/quoted/replay/busy/stale refusal, original Create/replacement/inert Open, later cancellation, consumer old-byte preservation, whole-local readonly Completion and genuine current code approval/application/Completion.
Its excluded worker changes disposable candidate bytes only; the package still independently seals, isolates/verifies and applies them.
Original native-close-loss faults retain namespaces before teardown.
Controlled SDK UI/model replies and an offline child are not installed-product, physical-human, paid-model, Windows, Node22/24 or release qualification.
Preserve all existing lifetime/compiler/engine/Source/approval/Completion tests and deadlines.

### 7. Wrong vs Correct

Wrong: defer creating the session owner until startup, then assume earlier departure/source hooks or the initial receiver ran.
Correct: install the original owner at discovery, bind only fixed actual-host data before its first startup, and retain the final callback-free original epoch check.
Wrong: equate first registration or a successful primitive outcome with permission/closure.
Correct: require original guarded terminal choices, independent native evidence and exact normally closed resource families.
