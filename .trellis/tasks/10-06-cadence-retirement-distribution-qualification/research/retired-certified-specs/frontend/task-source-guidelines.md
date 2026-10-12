# Disconnected G2 Source Host and Native Choices

Candidate-only convergence: the appended scenario records reviewed behavior before guarded LIVE integration.
Earlier checkpoints remain historical.

## 1. Scope / Trigger

Read when touching `src/task-source.ts` or source/native-choice seams in `src/task-session.ts`.
Production `src/index.ts` remains unchanged; this is a bounded disconnected increment, not accepted full G2 or a supported second workflow.
The separate D registrar/Create/Return candidate remains disconnected and unaccepted; Source supplies no full review pager/compiler/issuer or executor.
Source resource lifetime is integrated under [qualified disconnected B/lifetime acceptance](../backend/task-authoring-guidelines.md); whole G2 remains unaccepted.
`planning-b-lifetime-integration-readiness.md` records historical narrow readiness and gaps, not full-gate or release evidence.

Task `09-24-cadence-task-shell-and-approval` owns the evidence:

- `research/native-pi-ui-implementation-approval.md` records explicit approval of the bounded batch and N1 display delegation, superseding frozen planning-hold language.
- `research/native-pi-ui-implementation-review.md` records independent review and its corrected R1 promise-rejection/capacity finding, with no remaining bounded-batch blocker.
- `research/{source-host-review,source-host-capability-gap,source-increment-disposition}.md` and `verification.md` retain the original universal-contract failures; they are not rewritten as passes.

The approved observable-event/final-currentness policy replaces universal attempt fencing: hidden unchanged-state canceled/handled/no-op attempts and unobserved ABA need not revoke.
Idle flags do not account for all foreign work.
No newer host, first-registration assertion, upstream attempt API, monkeypatch or capability flag is now a prerequisite.
Owned actions, delivered conflicts and observable drift still reject stale authority.
See [Session Adapter](./task-session-guidelines.md) and [Task Storage](../backend/task-storage-guidelines.md) for their respective boundaries.

## 2. Signatures

`createTaskSourceService(owner, state)` registers one synchronous observer and returns:

- `confirmDecision(ctx, decisionId): Promise<boolean>`: optional exact-statement choice, not implementation approval.
- `reviseDecision(ctx, decisionId, statement, rationale)` / `supersedeDecision(ctx, decisionId, statement, rationale)`: return proposed decision identity, retaining blockers/history.
- `progress(ctx, summary)`: summary-only portable revision and unchanged intent revision.
- `observationStatus()`: pending/unconfirmed diagnostic, not receipts or a permit.

Owner seams (all callbacks code-owned):

```typescript
withAttachment<T>(ctx, action(binding, guard, io: Readonly<TaskSourceIO>) => T): T
observeInputs(state, observer(event, binding, guard, io: Readonly<TaskSourceIO>)): void
withSourceChoice(ctx, prepare(binding, guard, io) => {
  title, label, commit(freshBinding, precommit, freshIO)
}): Promise<boolean>

interface TaskSourceIO {
  current(): TaskLocal;
  decisions(after: number): ReturnType<typeof observeTaskContext>;
  record(): PortableTask;
  recordSource(input: TaskSourceChange): TaskLocal;
  changeDecision(input: TaskDecisionChange): TaskLocal;
  resolveDecision(input: TaskSourceDecisionChange): TaskLocal;
  progress(input: TaskProgressChange): TaskLocal;
}
```

`withAttachment`'s type excludes `PromiseLike` results; its frozen binding has only task/epoch.
Observer/choice bindings additionally contain `Readonly<TaskAttachmentObservation>` root/session/instance and attachment/branch generations.
The frozen seven-method IO facade exposes no raw Work/store/DB/lease/root selector/close/publication/generic runner.
Each method requires its exact active invocation; writes bind both task/epoch, including both compound components.
Decisions use bounded four-row pages; resolve/progress supply no publications.
`task-source.ts` must use this port, never an untracked direct opener fallback.
This remains an idle-command boundary, not B busy-turn permission or runtime authentication of arbitrary trusted JavaScript.

## 3. Contracts

### Synchronous call, exact return and resource ownership

`sourceCall` reserves a writer, inspection/unwind pair and original task/epoch fence before private/header reads; the unused inspection child is canceled.
Reads receive that exact work without writable checkout.
Only a mutation lazily acquires independent checked exclusion, opens a borrowed store and binds its original DB to the reserved fence.
The facade/guard become inactive at actual lexical callback return or reviewed no-escape throw, **before** result classification.
Store-owned source precommit frames run inside BEGIN after preparation/integrity; do not wrap the entire source body in a frame or double-enter the store frame.
Only this call's checked writes advance its private witness; final checks cannot refresh from unrelated facts.
See [Task Storage](../backend/task-storage-guidelines.md#participating-resource-and-fence-boundary) for native closure and sticky fence routes.

Normal synchronous return and proved-closed refusal close actual task DB/borrow/coordinator on the **same stack**, then tracked final host/private/pure checks and exact unused-tail/work cleanup permit fresh admission.
No synthetic Promise, `syncReturned`, caller `closed` flag or microtask delay represents synchronous completion.
Generic `withAttachment<T>` preserves exact result identity, including Date, Map, function, number, undefined and frozen binding; it does not clone/serialize/require plain JSON.
Only UI preparation is the closed three-own-data-field `title`/`label`/`commit` envelope, pinned without invoking accessors.
Ignored observer/commit returns still undergo asynchronous-return checking, not a new result schema.

`exceptionalSourceReturn` checks native Promise branding, then only effective `then` descriptors on the object plus at most eight prototype links, rejecting proxies **before reflection at each level**.
A noncallable own data `then` shadows deeper properties; accessors, callable thenables, proxies and exhausted chains refuse without getters/traps/coercion/iteration/assimilation.
These checks do not prove callback footprint: supported adapters are statically reviewed no-escape composition; arbitrary hidden JS descendants remain outside containment for plain return, throw and Promise outcome alike.

The writer's exceptional-return record/frozen facade is preallocated before I/O.
`armInvocation(work, "body", "retained-source-return")` activates only its still-retained unused slot, even after retirement or native uncertainty.
It stores the **actual original return** before native Promise reaction/constructor/species behavior; unsupported return or reaction failure stays unknown.
Native body rejection settles only that invocation, never other resources/fences.
While pending, retain the original task DB/store/borrow/coordinator and deny source fencing; safe independent descriptor/reference closure remains possible.
Install cleanup after the anchor's original reaction.
Actual late completion may drain the exact original fence/resources but never reenable IO, resume success, restore old tools or clear independent native uncertainty.
Do not prematurely retire the store wrapper and then use a second native close as recovery.

### Pending input, never inferred acceptance

Register once with the exact owner state; shutdown releases the observer.
Only explicitly attached, current, idle context admits observations; ordinary/native-context-only/streaming/queued inputs gain no authority.
Every captured live input remains pending, with null accepted-occurrence/entry/question/choice bindings.
Pi 0.84.3 exposes no accepted-occurrence correlation: interactive source is defaultable, handlers transform/handle, model/auth can reject, and message-end precedes append.
Never promote by identical text, user-role history or message-end matching.
Images, streaming behavior, empty/oversized/invalid text are excluded or unconfirmed; observer failure does not handle chat or expose raw diagnostics.

### Exact optional source envelope

Require an existing proposed decision and the complete unchanged single-line statement: **at most 128 UTF-8 bytes and 64 visible columns** (`visibleWidth`), with no Unicode `Cc`, `Cf`, `Zl` or `Zp` characters.
Long/unsupported statements stay proposed unchanged, with no source capture or UI invocation; never truncate or paraphrase to fit.
These UI bounds do not change the 4 KiB narrative/64 KiB storage-envelope limits.

Preparation pins decision hash, question/choice/proposal identities and a pending receipt using the final capture guard.
The complete title is at most 256 UTF-8 bytes/three lines, each at most 72 columns; action label is nonempty, at most 40 columns and not `Not now` (also bounded by the narrative byte cap).
Title lines/label reject the same control/format/line-separator classes.
The source title states that this is not implementation approval, expires in five minutes, and must be canceled if incomplete/unreadable; Escape dismisses and retry follows close.
Pin `title`, `label` and `commit` before awaiting; caller mutation cannot substitute a later action.
Preparation work/DB/coordinator close **before** the inert selector wait.
Guard-only reads stay bounded/noncreating.
After an answer, commit runs under a fresh synchronous IO scope, never the captured preparation facade; recheck private clocks/predecessor/idle/currentness and monotonic expiry through precommit.
Use `select(title, ["Not now", label])`, with no affirmative default and no host options.
Only the exact nondefault result can consume the ticket.
Optional source confirmation must not become a prior-plan approval ceremony for technical synthesis.

### Local native protocol and capacity

The D candidate factors the existing selector path through private `nativeStep(ctx, labels: readonly string[] | null, title, ticket, guard): Promise<string | undefined>` in `task-session.ts`; `choose` delegates with one label, while shell input uses `null` and shell menus use bounded labels.
This is shared transport, not new Source authority or a public UI permit.
Each shell step keeps the **same original five-minute deadline** and ticket generations; normal answer may advance to another waiting step, never reset expiry.
Source still closes preparation before its selector and uses fresh guarded synchronous commit afterward.
Existing N1 and unresolved-call capacity/throw/rejection rules below remain unchanged, with no stale hide/abort.
Pin before preparation; reserve the native slot before property reads/synchronous dispatch.
After UI/API getters recheck actual guarded manager/root/locator/leaf, known work/queues and generations, then dispatch; recheck again after potentially reentrant native disposal/focus/mount.
Stale preparation cannot renew itself.
Tickets transition `waiting -> answered -> consumed`, or retire, with a five-minute monotonic `performance.now()` deadline.
A resolved affirmative is still revocable through store preparation and the final commit; clearing wait resources does not consume it.
Default, Escape, local expiry, invalidation or invocation failure grants nothing.

Never pass native signal/timeout options or call stale abort/hide/done/countdown cleanup: generic host cleanup can remove another dialog.
Local expiry can leave a visible inert popup until Escape/Pi dismissal; no automatic reload or custom fallback.
One unresolved native call per owner includes retired waits.
Only normal native result/dismissal releases that slot; a hidden unresolved call blocks explicit retry until its response or a fresh owner after lifecycle fencing.
**Synchronous invocation throw and promise rejection both retain uncertain capacity until a fresh owner**: either can follow partial mount, so rejection is not cleanup evidence (review R1).
Retirement clears local timer/delivery and UI/context/store/commit captures; the pending native reaction retains only an inert cell.
This is per-owner capacity, not process-wide memory accounting.
An inert native wait is not owned execution I/O; real uncertain I/O still blocks departure.

### Final guarded mutation and invalidation

Source capture, confirmation, revise, supersede and progress pass their guard into the store, not merely around a callback before store opening.
Resolve confirms source plus dependent decision in one transaction after plain-data preparation, store opening and integrity reads.
After callback-bearing observations, finish with pure generation/ticket/deadline checks and consume the single-use answer immediately before the code-owned synchronous mutation path.
No await, renderer, host getter or foreign callback may separate that final check from mutation; no filesystem/SQL atomicity is promised.
Recheck current owner/manager/root/header/path/inode/leaf/epoch, idle/queue/settlement, private clocks and exact predecessor.
Direct storage APIs remain trusted data writers, not host authentication.

Delivered input, raw bash, agent-start and before/terminal compaction events invalidate both Open and source choices even without an input observer, including after answer.
Discussion invalidates choices without detaching; navigation/lifetime observations fence attachment too.
Conflicting owned choices invalidate prior tickets; Open fences attachment before its wait even when subsequently rejected/dismissed, and failed fencing latches uncertainty.
Later-extension navigation cancellation does not resurrect authority.
Source-only composition blocks raw bash with an explicit handled-cancelled result during waits/owned uncertainty, not a complete business-readonly tool boundary; the planning installer owns task-wide tool enforcement.
The combined isolated [planning installer](./task-planning-guidelines.md) retains A task-wide restrictions/model admission and adds attached-only B/C operations without changing these source/native contracts.
Unresolved B groups block conflicting accepted-source/decision/progress writers; harmless pending/unconfirmed source metadata remains allowed by the storage barrier.
B source references grant no agreement.
Its original H1/H2 assertions now pass under reviewed lifetime integration; historical failures remain separate from accepted native-policy limits and do not alone confer acceptance.
Earlier hidden handled/canceled attempts with unchanged observable state remain compatible, not proof of acceptance or uninterrupted lineage.

C has [qualified disconnected acceptance](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-c-acceptance.md); that historical composition is not D qualification.
It adds no Source API, evidence fulfillment or source-acceptance route.
At `sourceCall` entry, pending review becomes context-stale, review generation advances and planning correlation is revoked **before** root/IO callbacks; do not retire the source ticket shared by preparation and commit.
`withSourceChoice` still closes preparation resources before inert UI and re-admits fresh guarded commit.
The seven-method facade, generic synchronous return identity, idle guards, N1/expiry/capacity and original-return/unknown-close retention above remain unchanged.
[Session lifecycle matrix](./task-session-guidelines.md#c-lifecycle-entry-matrix) owns bypass ordering; `test/task-planning-c-shutdown-review.integration.test.ts` covers direct Source retirement plus retained choice positives.
Wrong: use generic choice retirement inside sourceCall to stale C. Correct: revoke planning only there, preserving the independently current source choice/precommit protocol.

### Display delegation and projection

Approved N1 binds complete immutable **supplied** bytes and a current invocation response, not actually painted/viewed/read text.
Pi owns native layout, painting, keys and normal close in regular/fullscreen modes.
Clipping from narrow terminals, resize or widgets may still return a consumable affirmative; users must cancel unreadable/incomplete content.
Dimensions are not dock/continuous-visibility proof; no physical-human provenance is claimed.
Reject known app overbounds/incomplete data, non-TUI/unknown context, missing APIs and known startup/invocation errors, not undetectable clipping.
Full immutable review paging/access and genuine compilation remain later gates; short source UI does not qualify them.

Revised/superseding wording preserves references/blockers/history but never inherits confirmation.
Progress changes only portable revision/summary, not artifacts/lifecycle/intent/issuance provenance.
No API here reconciles publications or copies receipts/chat into project records.
Summaries are not universally secret-redacted; minimize inputs.
Wrap store open/action/close in bounded errors: failure after commit is uncertainty, not rollback proof.

## 4. Validation and error matrix

| Condition                                                                 | Outcome                                             |
| ------------------------------------------------------------------------- | --------------------------------------------------- |
| Wrong owner/state or stale root/epoch/clocks/predecessor                  | Bounded rejection, no accepted source               |
| Live input without occurrence proof                                       | Pending/excluded, never accepted by matching        |
| Unsupported long/multiline/control/format source                          | Proposed unchanged; no capture/UI                   |
| Default/Escape/expired/duplicate/observed-stale response                  | False/rejected; pending receipt may remain          |
| Reentry during preparation, UI getters/mount, store open or final getters | No stale commit                                     |
| Unresolved retired call                                                   | Retry rejected before preparation/capture           |
| Sync throw or rejected native promise after possible partial mount        | Local false; capacity retained until fresh owner    |
| Unexpected store/close failure                                            | `task-io-failed`; committed facts may remain        |
| Async/thenable callback or malformed presentation                         | Reject/fence, no async permission                   |
| Unsupported return/reaction failure or native closure uncertainty         | Retain exact negative state; no fresh-owner reset   |
| Captured IO/guard used after lexical return                               | `task-entry-rejected`; no opener/mutation           |
| Proved-closed synchronous refusal                                         | Request fails; later fresh admission may proceed    |
| Post-return final-read close failure                                      | Process refusal; no invented still-held coordinator |
| Hidden unchanged-state attempt or host clipping                           | Accepted policy limit, not automatic refusal        |

## 5. Good / Base / Bad cases

- Good: exact supported native choice atomically accepts a bound source and confirms its unchanged decision once.
- Base: handled/transformed/replayed SDK text cannot become an accepted live source; absent proof stays pending/unconfirmed.
- Bad: release native capacity on promise rejection because it “settled”; the native Promise executor may already have installed a selector.
- Bad: treat injected replies, native paint bytes or regression totals as human/continuous-visibility/full-product acceptance.
- Good: two successive synchronous progress calls each close their actual DB/coordinator before returning exact results.
- Base: returning a Date/Map/function/undefined remains valid; malformed plain UI preparation refuses without poisoning proved-closed work.
- Bad: commit with old preparation IO after the selector, or clear an unknown DB when a returned Promise later fulfills.
- Base D: shared native transport leaves pending live input unconfirmed and C review slots inert; menu/history facts cannot supply agreement or execution.
- Bad D: renew the five-minute deadline per page, hide a retired popup, or treat registrar-controlled replies as full native/CLI qualification.

## 6. Tests required

`test/task-source.integration.test.ts` uses the actual service/owner through `test/helpers/task-source-host.ts` and installed Pi 0.84.3 runtime.
Retain exact/single-use choice, compound atomicity, bounded diagnostics, pending-input provenance, replay/transform negatives, blocker history and independent progress.
Test byte/column limits including CJK/emoji and Unicode separators; unsupported text must leave storage/UI untouched.
Cover delivered invalidation during waits/after response, mutable callback pinning, async/default/thenable negatives, prepare/dispatch/property/store-open reentry and pure checks after the final manager getter.
`test/task-shell-session.integration.test.ts` covers Open/reconstruction, observer-independent invalidation and failed durable fencing.
`test/task-shell-source-store.test.ts`, `test/task-shell-g2-store.test.ts` and `test/task-shell-session-store.test.ts` retain compound/reopen/rollback, reservation/CAS and immutable-provenance assertions; their direct storage fixtures are not host authority.

`test/task-native-ui.integration.test.ts` with `test/helpers/task-native-ui.ts` exercises unmodified installed `InteractiveMode` methods on a **test-only prototype receiver**, not a patched prototype.
It deliberately omits the full constructor/init/CLI; terminal transport and dock components are fixtures, while renderer/selector/mount/focus/keys/normal close are real installed methods.
Both regular/fullscreen modes cover saved Open, reconstruction, exact CJK/emoji source, default/Escape, visible expiry, hidden replacement, bounded retry, monotonic post-answer expiry, reentry and rejected partial mount.
Assertions separate exact supplied data from emitted render bytes; narrow/resize/widget clipping is approved N1 characterization, not a repaired safety negative.
Plain controlled replies in other suites are not native evidence.
No PTY, physical-human, installed-product, worker-containment or complete G2 qualification follows.
Preserve both original external v1 failures and P1/N1 history; changed compatibility policy does not make old contracts pass.
`test/task-lifetime-source.integration.test.ts`, `task-lifetime-source-review.integration.test.ts` and `task-lifetime-source-return.test.ts` cover actual same-stack native closure, generic identity, disabled facade, descriptor/prototype negatives, exact original/GC retention, reaction reentry, pending commit fencing and late completion versus unknown resources.
Retain actual source precommit/expiry/private-witness tests and original inline Source-R1 plus its separate file-loaded supplement: original read/writer DB remains live after fault, same-root fresh Open refuses before selector, and held coordinator excludes a checked contender where applicable.
Do not relabel inline evidence file-loaded, carryforward evidence rerun, or Linux Node 26.7 evidence native Node 22/24/Windows/macOS qualification.
D's [current candidate checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate2-loop-checkpoint.md) preserves these Source/N1 contracts.
Require original capacity/rejection/expiry/final-precommit tests plus shared-step total-deadline and reentry controls; actual full registrar regular/fullscreen/CLI/PTY routes are not qualified.
Four solo old-Source timing comparisons and selected native regressions do not explain or exempt the unresolved old composite timeouts.

## 7. Wrong vs correct

Wrong: match live input against history, or call `recordShellSource(resolve)` then `changeShellDecision(confirm)` as separate writes.
Correct: keep live observations pending; for an owned exact choice use the compound writer with the code-owned final guard:

```typescript
freshIO.resolveDecision(preparedPair); // Owner supplies guarded compound precommit.
```

Wrong: native rejection/timeout means the popup is gone, so cancel it or immediately mount another.
Correct: retire locally without host cleanup; only normal result/dismissal releases capacity, while partial-mount errors require a fresh fenced owner.

Wrong: passing native tests fixes the historical universal-observation or clipping findings.
Correct: preserve those failures, cite the explicit revised-policy authorization, and report only named bounded behavior with production still disconnected.

Wrong: return `Promise.resolve(value)` to manufacture synchronous completion or retain preparation IO for commit.
Correct: finish the real lexical call and close resources synchronously; native wait holds no lease, and its answer enters a fresh guarded IO scope.

## Scenario: Candidate-only whole readonly objective agreement

### 1. Scope / Trigger

Only the private convergence candidate adds this planning agreement; it is not LIVE promotion, implementation approval, evidence fulfillment or G5 execution.
Existing short decision and pending/unconfirmed live-input contracts above remain unchanged.

### 2. Signatures

`source.confirmReadonlyObjective(ctx, objectiveId)` uses private `owner.withReadonlyObjectiveAgreement`.
`TaskStore.resolveReadonlyAgreementShell(input, precommit)` persists the named reciprocal pair, not an arbitrary Intent setter.

### 3. Contracts

Hash the entire kind/objective including ordered evidence requirements and sourceRefs; pin complete original Intent revision/hash through every wait.
Preflight full compound envelopes/capacity before pending capture; close capture resources before full native paging.
Nondefault `Agree objective + evidence` resolves the actual terminal-choice Source and appends precisely one marked agreement in one guarded transaction.
Cancellation leaves only pending history; legacy accepted quotations do not prove agreement on the evidence list.
Carry only an uninterrupted exact unchanged objective/list; edit/drop/edit-back cannot resurrect agreement.
The original five-minute native deadline/capacity/N1 rules remain, with no per-document ceremony or relaxed shortSource.

### 4. Validation & Error Matrix

Changed full Intent/list, missing peer/capture or stale response refuses agreement.
Missing capacity/material access refuses before affirmative exposure; unknown closure remains obstructing.
Questions/evidence remain unfulfilled even after agreement.

### 5. Good/Base/Bad Cases

Good: actual default registrar research/diagnosis agrees a complete objective/list without producing a code plan.
Base: new technical synthesis remains proposed until a genuine current choice.
Bad: accept a paraphrase/model flag or promote historical accepted Source alone into agreement.

### 6. Tests Required

Keep complete Source-store, Source, approval/readonly business and native suites.
Assert genuine default-registrar positives, last-wait Intent mutation refusal, exact clocks/reciprocal lineage, carry/edit/edit-back and unchanged live-input policy.

### 7. Wrong vs Correct

Wrong: reuse short statement confirmation to endorse an undisplayed evidence list.
Correct: page the complete pinned target and commit only its exact current reciprocal Source/Intent transition.
