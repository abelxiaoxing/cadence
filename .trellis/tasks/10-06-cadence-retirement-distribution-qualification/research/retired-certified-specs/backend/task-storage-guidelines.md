# Disconnected G2 Task Storage

Candidate-only convergence: the appended scenario records reviewed behavior before guarded LIVE integration.
Earlier checkpoints remain historical.

## 1. Scope / Trigger

Use this guide when changing G2 task contracts, checked storage, migration or observational reads.
The storage increment is implemented but **the task shell, terminal approval issuer and executor are not**.
Production `src/index.ts` remains unchanged; packaged storage code is not a supported second workflow.
G1 publication/claim retention and narrow legacy admission remain governed by [Database Guidelines](./database-guidelines.md).
[Authoring B](./task-authoring-guidelines.md) records implemented exact-G2 admission, compound groups/barriers, R1/R2, retry and corrected D1 record-tail integrity.
Its integrated lifetime composition has qualified disconnected acceptance under that guide; whole G2 remains unaccepted and disconnected, and no new DDL is introduced.
The earlier C1–C3 checkpoint below predates [qualified C acceptance](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-c-acceptance.md); its historical results are not D evidence.
C does not supply evidence fulfillment, source acceptance or a review consumer.
The appended D scenarios record reviewed storage corrections and traversal-local SELECT reuse.
[Gate 1 technical clearance](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate1-checkpoint.md) now permits the already approved Gate 2 implementation; the registrar/Return host remains absent and D/whole-G2 acceptance remains pending.

## 2. Signatures and owners

- `src/task-shell-contracts.ts`: `decodeTask*` durable decoders, `checkTaskIntentReferences`, `checkTaskReviewLinks`, `checkTaskPreparedBytes` and related integrity checks.
  A decoded receipt/approval is data, not a live capability.
- `src/task-store-read.ts`: exact foundation/shell classification, bounded raw record/review/outbox hydration and `checkTaskFoundationIntegrity`.
- `TaskStore.open(state)`: original schema-checked G1 opener; runtime getters check retained content.
- `TaskStore.openChecked(state)`: complete retained-G1 integrity admission before writable configuration.
- `TaskStore.openShell(state)`: exact G1-to-G2 additive migration or checked complete-G2 reopen, under the existing checkout fence.
  The two G1-only openers reject G2 rather than silently upgrading it.
- `TaskStore.createShell(input, publications?, precommit?)`, `planShell(input, publications?)`, `settleShellBinding(input, precommit?)`, `fenceShell(id, bindingEpoch)` and `recordShellReturn(session, precommit?)` own narrow synchronous compound transactions.
  The Create/Return guards are the partial D checkpoint documented below, not terminal admission.
- `src/task-shell-storage.ts`: internal retained-graph validation and compound mechanics; no public arbitrary SQL callback or generic event writer.
- `observeTasks(state, request?)` in `src/task-observation.ts`: paginated noncreating `authority: "context-only"` observation of absent/G1/G2 storage.
- `TaskStore.admitShellSession(input, precommit?)` and `prepareShellBinding(input, precommit?)`: reserve a new Open/reconstruction epoch and record its provisional binding; final outcomes use `settleShellBinding`.
- `observeTaskContext(state, request)`: bounded detailed owner-private context, seed/reconstruction-seed, sessions/publications/source/decision history pages and current review/approval summaries.
- `recordShellSource(input, precommit?)`, `changeShellDecision(input, precommit?)`, `resolveShellDecision(input, publications?, precommit?)` and `progressShell(input, publications?, precommit?)`: trusted-service source/decision/progress transactions, not host authentication.
  Optional `precommit: () => void` is a code-owned synchronous check, never a model/stored authorization boolean.

`src/storage-schema.ts#TASK_SHELL_SCHEMA` owns all 18 additive STRICT tables, including the revision-1 singleton, seeds/genesis, session/binding/reservation, source/decision/intent, operation/event, prepared bytes/review/interaction/approval/invalidation families.
Presence of these tables does not imply every high-level writer exists.
Open/reconstruction and source/decision/summary-progress storage now exist, including separate invalidation on decision changes.
Review materialization/approval issuance still require their owning G2 implementation.
Disconnected B implements proposal/material reuse invalidation while preserving immutable control facts; this supplies no review/approval/execution authority.
The bounded native source host now follows the explicitly approved observable-currentness/N1 policy; the original universal-contract failures remain history, not repaired negatives.
See [Source Host Guidelines](../frontend/task-source-guidelines.md) for authorization, independent review and remaining disconnected scope.
Read [Session Adapter Guidelines](../frontend/task-session-guidelines.md) before composing the host boundary; successful storage admission alone is not live authority.

## 3. Contracts

### Admission and representation

Retain `task-v1/<rootHash>/control.sqlite3`, all five G1 domain tables and protocol version 1.
Before task-database writable configuration, check exact catalog SQL/structure/root and all bounded retained content in a readonly snapshot; recheck on the actual connection under the lifetime fence.
Migration adds the complete known table set and singleton atomically, preserving G1 rows/BLOBs/outbox identities and `sqlite_sequence` high-water marks.
Unknown/partial/future/corrupt/empty-retained layouts fail without reset or repair.
Do not hide unknown SQLite-prefixed objects using a name-prefix exclusion.

SQL must byte-gate JSON/BLOB/identity metadata **before** materialization and repeat relevant predicates at selection.
Traverse inventories in bounded pages; this bounds JavaScript allocation, not total SQLite scan work or latency.
Hash original BLOB bytes, then use fatal UTF-8 decoding with BOM preservation.
SQLite TEXT decoding can normalize invalid bytes, and TEXT substring/length semantics can terminate at NUL; neither is an identity validator.
For example, gate a digest with `length(CAST(payload_hash AS BLOB)) = 64`, not `substr(payload_hash, 1, 64)`.
Validate sequence values by SQLite type and safe range before materializing them.

### Compound writes and retention

Create commits record, immutable seed/genesis, pending session, reservation, local clocks, operation/event and outbox together.
Planning requires the current recorded binding, unfenced reservation and revision CAS; it commits proposed intent/decisions/pending-or-unconfirmed sources and outbox together.
Publication bytes are detached and bounded; exact retries compare request identities and never reconcile automatically.
Reserved identities must be pairwise distinct and disjoint from the current operation, prior operations and other reservations, including consumed slots.
Reserve binding outcome, departure fence and Return intent/outcome before admission: new planning cannot spend terminal capacity.
Idempotent fencing and reserved Return consume no new source receipt; neither asserts I/O settlement.

Historical decisions/events, seed/session/provenance and prepared/review/input links need relational validation beyond row hashes and foreign keys.
Prepared permissions must include the proposed step writes/deletions as well as declared scope, checks and retries.
Referenced artifact role/path/hash must agree with the retained inventory/review, not merely with another rehashed declaration.
Unrelated retained source excerpts must not exhaust a validation projection: select referenced evidence while independently checking the full source table.
A genuinely referenced oversized projection still fails its own bound; do not silently enlarge limits or prune authority.

Prepared/approval direct-SQL test fixtures certify only retained integrity.
G1 snapshot bytes cover reviewed artifacts, not arbitrary research/other compiler inputs; future review writers must retain and validate any additional bound material explicitly.
No current API authenticates a live answer, materializes a real compiler capability, issues a terminal approval or launches execution.

### Source, decision and independent progress facts

All new requests bind task/operation UUID, current epoch and expected intent/event clocks; source/decision changes additionally pin current row hashes.
`recordShellSource` captures a pending receipt or resolves it once to unconfirmed, accepted-occurrence (live answer) or bound-choice (terminal choice).
These are trusted-service data, not serialized capabilities: storage cannot prove actual Pi acceptance/current branch/dialog ownership.
Preserve immutable original/resolved bytes in bounded operation payloads and validate source state at each historical intent revision; later acceptance or future receipt birth must not backdate agreement.
Validate uniqueness for every source birth, including proposal-only receipts and collisions with genesis; blocked planning events cannot create a receipt or portable record.

`changeShellDecision` supports confirm, revise and supersede with immutable predecessor/after versions.
Confirm requires an accepted source and an exact UTF-8 quotation equal to the existing statement, not a paraphrase or unbound acknowledgement.
Revised/replacement wording stays proposed, retaining the blocker and predecessor history; callers cannot erase a retained blocker by omitting it.
Generic `planning-update` may introduce only a genuinely new proposed decision, never confirmed/superseded/revised history.
Changing an operation kind and rehashing its event must not bypass the exact transition owner.
Old generic-confirmation SQL fixtures were replaced with writer-backed histories, not a fixture-domain bypass or store repair.

For one answer resolving a dependent decision use `resolveShellDecision({source, decision}, publications?)`, not two transactions.
Source must be an accepted resolution; both components bind the same task/epoch/intent revision and distinct operation IDs, with expected event sequences E and E+1.
The transaction jointly admits two ordinary slots, writes adjacent events, and retains identical closed group request/publication metadata in both operations.
Reopen verifies exact partners, adjacency, request/before/after/event links; a missing half is corruption, never a request to repair.
Component retries cannot masquerade as a grouped retry; fenced or obsolete epochs remain rejected.
Decision changes advance intent once, clear current review/approval reuse and record separate invalidation without rewriting original issuance, snapshots or prepared bytes.

Optional compound outbox targets only `decisions.md`, at most one item within 32 KiB, with exact `shellDecisionProjection(afterDecisions)` bytes.
This is explicitly a projection of the changed versions, not full decision inventory/history; it excludes source IDs/receipts/locators.
Preparation commits with both facts; failure rolls both back, and reconciliation remains separate and explicit.

`progressShell` pins the portable record hash and permits only `latestSummary` plus its next portable revision.
It advances event sequence but not intent/review/approval identities; title/kind/depth/lifecycle/artifact inventory cannot change through this route.
An optional single outbox item must be exact canonical-plus-LF `task.json` bytes of that next record.
Summary prose is not universally secret-redacted: the controller must minimize it rather than copy private receipts/chat.

The 18-table schema is unchanged; new closed JSON operation/event variants are source-update/source-recorded, decision-update/decision-changed and progress-update/progress-recorded.
Older closed readers may reject them; never reset or invent provenance to make them readable. 4096-operation, 256-receipt, 128-decision and envelope limits still apply; no pruning or terminal-reserve consumption.

### Code-owned final precommit seam

The native batch changes no schema, state protocol, durable envelope or generic transaction API.
Source methods run the optional synchronous guard inside their existing transaction after `checkShellIntegrity`; compound resolve/progress also finish request/publication preparation before entering that guarded path.
`admitShellSession` and `settleShellBinding` invoke their optional guard at transaction entry before the narrow binding mutation, retaining their existing validation/CAS and post-write integrity checks.
Do not describe the source pre-read ordering as a new integrity pre-pass in every binding writer.

`withAttachment`, `observeInputs` and `withSourceChoice` supply code-owned guards to the source service.
Capture/revise/supersede/progress pass that guard through store opening; bound-choice confirmation passes its single-use `precommit` to `resolveShellDecision(preparedPair, [], precommit)`.
The host guard rechecks actual context/manager/locator/leaf, attachment/generations, known work/queues and, for choices, the monotonic deadline after UI response and store preparation.
Finish callback-bearing observations with pure generation/ticket/deadline checks, then perform only code-owned synchronous validation/CAS/writes: no await, UI/render or foreign callback between final check and mutation.
This is not filesystem/SQL atomicity, a public arbitrary SQL hook or containment of trusted JavaScript.

Direct writers without a host guard remain trusted storage APIs; accepted-looking serialized data or a successful storage call authenticates no terminal interaction.
Do not pass async callbacks or retain plain bindings for later writes; host composition must reacquire currentness after waits.
Guard failure rolls back that transaction; a close/release failure after commit remains uncertainty, never proof that facts rolled back.
Pending live input still has no accepted-occurrence proof, and source confirmation is not implementation approval.

### C event-only writer and exact outcome

Implemented seams in `src/task-store.ts` / `src/task-shell-storage.ts`:

```typescript
store.planningCFacts(taskId: string): CompletenessFacts
store.assertPlanningCPredecessors(selectedTaskId: string,
  expected: TaskAuthoringClocks): void
store.requestShellEvidence(input: EvidenceRequestInput,
  precommit: () => void): EvidenceOutcome
store.consumeEvidenceOutcome(outcome: EvidenceOutcome): EvidenceOutcome
```

`EvidenceRequestInput = {formatVersion:1,taskId,bindingEpoch,expected,objectiveId,question,sources}` has no operation ID.
The closed `evidence-request` operation is committed with `publicationIds:[]`; its request holds epoch/clocks, Intent/objective hashes, exact question and sorted `{id,hash}` sources.
Its ID is the request ID; `requestHash` hashes canonical request, expected Intent revision matches, and eventSequence is expected event +1.
The paired `evidence-requested` event binds exact operation/payload hash/source IDs, empty decision IDs and null review/approval/session-intent references.
Original attached epoch/reservation, Intent/objective/record horizon, source birth/version at E−1, genesis, unique full semantic key and reserved-ID disjointness all validate on reopen.
It neither births a source nor produces an Intent revision.
Rehashed relabeling cannot bypass a transition owner.
Old closed readers may reject these variants despite unchanged eighteen-table revision-1 DDL; use a cold C-aware upgrade, never reset/delete/downgrade to repair compatibility.

Current readonly objective, source refs, planning state, unfenced attachment, all three clocks, clear B barrier and zero pending/conflict across the whole outbox are required.
Blockers/never-authored roles may remain incomplete; managed live conflicts still refuse via controller admission.
Full-key duplicate selection precedes ordinary/new-request capacity and all UUID allocation, including at 64 requests or ordinary event cap; stale input CAS refuses first.
Fresh summary-only progress/reattachment can reuse the historical request without rebinding its original epoch.

Transaction order is BEGIN → checked integrity/preparation → strict synchronous precommit in C1's single family frame → frame leave/pure store-work check → **actual-connection root/catalog classification** → repeated prepared-witness CAS → created pair or no-write duplicate → postvalidation → COMMIT.
The root/catalog check must precede COMMIT even for duplicates: selected streams exclude protocol/schema singletons and catalog; consumption-only validation is too late to roll back guard-induced drift (C1-R1).
Every nonundefined guard return refuses without reading `.then`; no awaited task transaction or nested frame/opener.

`assertPlanningCPredecessors` requires this original usable store's active transaction and captured root, selected identities and exact clocks; it opens no reader, classifier, transaction or frame.
Always check canonical index; check decisions when inventoried, any same-target history exists, or retained decisions require a changed full projection.
Use unchanged `shellAuthoringPredecessor` at the current event/record horizon, historical=false: decisions first, subtract its tail expected bytes from **B's 16-MiB domain**, then index.
No arbitrary artifact, hypothetical B proposal, UUID, retry, publication or current-file-derived expected bytes enters this assertion.
C's actual dispatch must invoke it **after** `guardInStore` host observations and pure checks, then captured file checks, before C1's callback-free CAS.
An early assertion proving active transaction is not a substitute for this post-callback assertion; no SQL/lookup callback is exported.

`EvidencePrepared` binds input/wire digest/before-witness/Intent/objective/sorted sources/semantic hash (≤16384 bytes).
`EvidenceOutcome = {kind:"evidence-created"|"evidence-duplicate",prepared,requestId,operation,event,after}` is frozen, ≤32768 bytes; witness ≤4096.
Creation changes only local eventSequence +1 and the exact operation/event pair; record/Intent/stable facts/outbox stay exact.
Old ordered operation/event streams are proved unchanged by excluding precisely the new UUID/event, not assuming UUID sorts last.
Duplicate proves complete after===before with no row/sequence/temporary-ID allocation.
Only normal COMMIT installs one private exact-object slot on that same store; ambiguous COMMIT creates no optimistic seal.
Consumption spends the slot once, validates typed pair/root/catalog/full after-witness on the still-held connection and binds the session's admitted before/wire/task/epoch/versions.
Copied/replayed/wrong-store/closed/drifted outcomes refuse; C never uses B committed/+1-record or retry exemptions.
Postcommit refusal preserves facts for deliberate fresh duplicate, not automatic replay or inferred rollback.

### C selected projection and private witness

`CompletenessFacts = {local,record,intent,decisions,sources,objectiveAgreementIds,requests,publication,witness}` is private service data, not a DTO.
`observeTaskCompletenessFacts(state, selectedTaskId, work?)` and `observeTaskEvidenceRequests(state, selectedTaskId, work?)` are noncreating checked snapshots in `src/task-observation.ts`; no checkout, migration, managed-file read or replay.
Snapshot closes before returning into host/material callbacks.
Intact request history remains readable after target/claim edits.

`PublicationProjection = {rows,materials,barrier}` retains detached metadata, never all-history BLOB arrays:

- Rows: sequence, operationId, taskId, target, identity, expected nullable BlobFact, desired BlobFact, state, nullable checked owner link.
  Index paths are legal publications, not ArtifactPaths.
- Material: exact inventory artifact/nullable producer, nullable selected publication ID/path tail and checked same-target claim IDs.
- Barrier: count/pending/conflict/delivered plus digest over **every** selected row, including index/obsolete/unowned/all states.
  Unowned foundation rows grant no producer/peer authority.
- Raw SQL scalar/type/byte gates repeat at ≤64-row keyset pages before hydration: ≤4096 rows, ≤64 materials/4096 claim refs, each BLOB ≤16 MiB, aggregate expected+desired ≤64 MiB, one pair (≤32 MiB) hashed/discarded at a time.
- Metadata prebound is 1536 plus raw path bytes (≤2048/row), aggregate ≤8 MiB; repeat decoded bounds.
  This is not total invocation heap/I/O/latency, especially with whole-store integrity/repeated validation.

Select the current inventory producer **and current path tail**, never an older delivered equal-hash row.
B exact after-record/publication links establish a version; exact progress carries it.
Source/binding/informational events cannot invent one.
A lawful legacy missing-byte gap is unproved/undelivered, not private corruption.
Generated source decisions may carry unchanged inventory only with matching tail bytes; lag never silently rebinds it.
Ordinary artifacts use their own B before/after-inventory proof, not the index/decisions-only predecessor predicate.

`CPrivateWitness` contains local plus record/session/binding/reservation/Intent/decisions/all-sources/requests/taskFacts/stableFacts/operations/events/publication hashes.
Its raw ordered/count-tagged stream covers **21 selected-task tables**: seventeen task-bearing shell tables, foundation records/reviews/review bytes and outbox; BLOB-only rows use checked parent joins.
Bind every scalar and raw JSON/BLOB hash/length, including empty-table tags.
Stable facts exclude only local/operations/events; separate hashes bind their ordered streams.
Full publication projection participates even when clocks/projected text are unchanged.
Do not substitute page pins or refresh final facts as a new baseline.
[Observation](./task-observation-guidelines.md#c-managed-material-observation) owns separate current/history file budgets; [Planning Host](../frontend/task-planning-guidelines.md#c-admission-and-pending-review-release) owns admission and callback-free H3 comparison.

### Reattachment and historical sagas

`ShellSessionAdmission` binds task, expected epoch/event sequence, operation ID, pending Open/reconstruct intent and fresh reservation.
One transaction fences the prior epoch, retains a code-derived immutable seed, reserves the new terminal slots and advances clocks.
Seeds reuse original private request/background while refreshing status/artifact pointers; no new genesis/source confirmation or assistant turn is created.
Historical unconsumed slots stay reserved, so admission may exhaust before 4096 rows; never reclaim them by assuming settlement.

Provisional prepared bindings are context only; final attachment must match them exactly.
Canceled/failed prepared bindings remain historical but cannot back planning or approval provenance.
Current mutation/retry paths reject superseded epochs and fenced attachment/planning, including same-ID sessions; inspect history through readonly queries instead.
Validate original admission, Return and departure request hashes against retained saga facts, not current clocks or merely matching row hashes.
Pending intents have no candidate; prepared intents require matching locator/binding facts.

### Observation and failure cleanup

Observation must not call a writable opener, acquire checkout ownership, create directories, migrate or reconcile publications.
Readonly WAL access can touch sidecars; do not claim zero OS I/O.
Readonly A adds `observeTaskPlanningStatus(state, selectedTaskId)` for minimized selected G2 facts, not private context pages or readiness; see [Task Observation](./task-observation-guidelines.md).
Its readonly SQLite close failure preserves `TaskPlanningError("task-io-failed")` for host uncertainty; inventory/private-context boundaries retain their existing foundation storage-error mapping.
That A reader adds no schema, writable opener, checkout acquisition or publication replay.
B's selected `observeTaskAuthoringSection` and code-owned `observeTaskAuthoringCheckpoint` also remain readonly; never forward the latter's private local/record witness.
B historical validation reads no managed target/claim/alias: each original group horizon stays fixed, while the delivery-independent D1 check validates the latest private record-changing tail.
External file conflicts are not private corruption.
See the authoring guide for the distinct fresh-admission and explicit-retry live checks.
G1 listing validates schema/root/health and returned records, not all reviews/outbox bytes; complete-G2 observation checks the retained shell graph as well.
Pagination is not a cross-call snapshot lease.
Detailed `observeTaskContext` pages carry `audience: "owner-private"` and `authority: "context-only"`; never forward locator/approval-bearing pages directly to models, portable records or raw UI.
Closed sections cover current, seed, reconstruction-seed, review, approval, sessions, publications, sources, source-history, decisions and decision-history.
History pages use their section's epoch/sequence/row-position cursor, 1–64 rows and a 64 KiB output ceiling without dropped continuation facts.
Source history retains capture/resolution bytes; latest decision pages include superseded decisions and decision-history exposes retained versions.
Missing/G1 tasks yield no invented shell context; observation never admits an epoch or replays publication.

BEGIN, commit and rollback errors must stay within bounded error handling.
If BEGIN/rollback leaves connection state uncertain, retire the store rather than reusing it.
Default unborrowed cleanup retains its ownership-release behavior even when close throws, without exposing SQLite text.
Participating borrowed stores instead follow the independent resource/lease ordering below: unknown resources forbid coordinator release.
A synthetic close-after-success failure does not prove recovery from every native close failure.

### Participating resource and fence boundary

This is the owning resource contract for integrated A/B/source/Open; the [authoring guide](./task-authoring-guidelines.md#integrated-negative-lifetime-core) owns the sole anchor, bounds and negative identities.
No new DDL, writable read bootstrap or generic transaction API exists.

```typescript
acquireTaskCheckout(state: ResolvedStateRoot, work: LifetimeWork,
  fence?: LifetimeFence): LifetimeCheckout // package-state.ts
TaskStore.openExistingShellBorrowed(state, lease, work): TaskStore
TaskStore.openShellBorrowed(state, lease, work): TaskStore
TaskStore.openReservedFence(state, lease, work, fence): TaskStore
store.lifetimeWork: LifetimeWork | undefined // internal publisher accounting
store.reserveSafetyFence(id, bindingEpoch, reserved?: LifetimeFence): LifetimeFence
store.fenceReserved(fence: LifetimeFence): Promise<TaskLocal>

// TaskLifetime methods: exact identities, not caller-supplied closure claims.
reserveSafetyFence(work, taskId, bindingEpoch, database?, continuation?): LifetimeFence
bindSafetyFence(fence, work, database, taskId, bindingEpoch): void
retireWork(work, requiredFence?): void
enterReadDeparture(fence): LifetimeWork
assertSafetyFence(fence, work, root): void
beginSafetyFence(fence, work, database): Readonly<{taskId: string; bindingEpoch: number}>
observeSafetyFence(fence, original: Promise<unknown>): void
cancelSafetyFence(fence): void
```

Acquire independent checked exclusion **before** invoking a work-starting inspector, not merely before the task store.
Preserve the original coordinator path, safe-path/legacy checks and `PRAGMA busy_timeout = 1; BEGIN IMMEDIATE`.
Reserve its DB cell before path preparation; capture an exclusive-created lock FD immediately, and capture `new DatabaseSync(location, {open:false})` before `open()`/SQL.
Register checkout only after actual checked BEGIN returns; the core cannot certify SQL from a flag.
Contended acquisition starts no inspector.
Failed acquisition retains any exact uncertain native object even if no lease is returned.
Default `acquireCheckoutOwnership`/package reset/apply semantics are unchanged.

Borrowed openers authenticate exact anchored lease/work/root membership **before resolution/preclassification I/O**, without reading a supplied lease getter or accepting `instanceof`, a copied handle or `ownsLock` boolean.
One sequential task connection borrows the independent coordinator; `openExistingShellBorrowed` and `openReservedFence` are exact-existing-G2 only, never creating fallbacks.
`openShellBorrowed` retains explicitly authorized shell creation/evolution, not authority from the lease.
Unborrowed G2 openers query process negatives before readonly probe; other checked writers still contend on the physical coordinator.
Cross-process exclusion covers checked writers using that same private root while the lock is physically held, not arbitrary same-user writers, another private root or external descendants.

Actual owning helper argument positions:

| Owner                                    | Participating signature / scope source                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `directory-sync.ts`                      | `syncDirectory(directory, work?)` — second argument                                                            |
| `task-files.ts`                          | `readTaskFile(root, relative, maximum?, recoveryPeer?, beforeRead?, work?)` — sixth; fifth admission unchanged |
| `task-files.ts`                          | `ensureTaskParents(root, relative, beforeMutation?, work?)` — fourth                                           |
| `task-legacy.ts`                         | `requireLegacyQuiescence(state, coordinator, work?, fence?)` — third/fourth                                    |
| `task-observation.ts`                    | `observeTasks(state, request?, work?)`, `observeTaskContext(state, request, work?)`                            |
| `task-observation.ts`                    | `observeTaskPlanningStatus(state, taskId, work?)`, `observeTaskAuthoringCheckpoint(state, taskId, work?)`      |
| `task-observation.ts`                    | `observeTaskAuthoringSection(state, taskId, request, work?)` — fourth                                          |
| `task-store-read.ts`, `sqlite-schema.ts` | Unchanged reader signatures; exact raw input DB lookup supplies scope                                          |
| `task-publication.ts`                    | Only `store.lifetimeWork`; no public work-selector option                                                      |

FD/Dir resources reserve before open and capture at native return before initialization/callbacks.
All participating DBs capture unopened native objects before `open()`; legacy-reference, store-reference and schema-reference are **three distinct sites**, including cold-cache construction.
Cache hits cancel only their own never-acquired cells; successful cache population cannot settle an earlier failed close.
Legacy classification/immutable URI/header/no-sidecar rules stay intact; the approved exceptional cleanup independently attempts both DB siblings, including nonparticipating defaults.
Other default helper/worker semantics remain unchanged; generated workspace-worker imports do not install an anchor or admit worker ownership.

Only the **first matching native close's normal return** closes a resource cell.
Before/after-syscall throws retain the exact raw DB/FD/Dir strongly as unknown; no second close, `isOpen`, GC, reacquisition or error-code inference proves closure.
Close error outranks content/refusal; safe independent sibling cleanup still runs.
Borrowed TaskStore closes its task DB and releases its exact borrow, never its coordinator.
After proved native DB closure, a blocked pure borrow-release check may be retried; native close itself is never retried after uncertainty.
Failed BEGIN/rollback retires the task connection; committed intent/outbox/claims remain recovery facts, not rollback proof.
`syncDirectory` permits only **win32 + EPERM + syscall fsync + fstat-is-directory** as unsupported barrier, never closure; other open/fstat/flush/close failures propagate.

Store-owned frames wrap source/admit/provisional/final precommit at their existing **inside-BEGIN** positions after applicable preparation/integrity, not around the entire body or before opening.
B's separately composed guard owns its callback-bearing frame inside `authorShell`'s precommit; do not double-wrap it.
After frame leave, pure exact-work/store-usability checks precede same-connection code-owned CAS/writes, with no foreign callback/await.
Participating guards reject every nonundefined return without reading `.then`.
The six existing optional source/admit/final default guards retain historical return tolerance; `prepareShellBinding` and `authorShell` remain strict on both paths.
Nested checkout/borrow/guard/transaction or async continuation is not admitted.
Only the independent coordinator transaction spans awaits.

Reserve the original task/epoch conditional tail **before I/O** (writer + inspection + unwind = three cells), then bind the original captured usable DB once.
On retirement, latch a sticky route before callbacks:

1. Original active bound DB: after transaction/publication unwind use that same store's `fenceReserved`; never rebind to a healthier DB after failure.
2. First required departure after known original DB close/borrow release, or before any task DB while coordinator is held: the reserved child borrows sequentially for exact-existing-only fencing.
3. New owned departure after normal coordinator release (or never-attempted preflight): drain final readonly resources, then the reserved child acquires fresh exclusion for **departure only**, not writable final validation.

Captured-unbound/closing/unknown native state, failed acquisition or failed fence cannot fall back to another route.
The actual private fence Promise, SQL epoch/reservation checks and native closure must finish; a rejected fence stays obstructing even after safe task DB close.
Read work similarly reserves a child before reads, without checkout; only a required departure after actual read-body/resource completion enters it.
No clear-root gap exists: the original parent remains negative through child and final readonly release checks.
Open phase fencing is same-child/same-store only; [Session Adapter](../frontend/task-session-guidelines.md) owns its distinct two-phase correlation.

Normal release requires original body/serialization and inspection completion, descriptors/fence/task DB/borrow closure, then coordinator release, then H3 final readonly checks and exact work finish.
The dormant never-required writer tail alone may survive normal coordinator close; retirement cannot discard an owed fence.
Final readonly close uncertainty remains process-negative without claiming the already released physical lock is held.
[Planning Host](../frontend/task-planning-guidelines.md) owns H3 callback/private/file/pure ordering; [Source Host](../frontend/task-source-guidelines.md) owns same-stack and exceptional-return cleanup.

## 4. Validation and error matrix

| Condition                                                    | Result                                                                                  |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Malformed closed contract, invalid UTF-8, oversized envelope | `task-record-invalid`; no authority                                                     |
| Unknown layout, malformed retained bytes/links/sequence      | `task-storage-invalid`; no configuration/reset/repair                                   |
| Wrong root, unsafe file or unresolved checkout/legacy owner  | Existing foundation path/storage/ownership failure                                      |
| Nonexact retry, stale proposal/binding or conflicting outbox | Bounded conflict; transaction rolls back                                                |
| Capacity consumed by ordinary planning                       | Reject new admission; preserve reserved terminal slots                                  |
| BEGIN/rollback/cleanup failure                               | Retire connection; safe independent close, borrowed coordinator retained on uncertainty |
| Listing/reopen/fixture approval data                         | Context or integrity facts only; no publication/execution                               |
| Stale/expired/reentrant host precommit guard                 | Transaction rejects; prior pending capture may remain                                   |
| Fake/foreign lease, work, fence or nested family frame       | `task-entry-rejected` before opening; no copied-handle authority                        |
| Participating nonvoid/thenable precommit                     | `task-conflict`; zero writer attempts, no then getter                                   |
| Resource/work reservation exhausted                          | `task-planning-limit` before I/O; existing cleanup remains possible                     |
| Unknown native close or fence outcome                        | `task-io-failed`; exact obstruction retained, no release fallback                       |

C-specific errors retain the same vocabulary: post-guard root/catalog corruption → `task-storage-invalid`; stale witness/seal/predecessor/guard → `task-conflict`; bounded projection/history → `task-planning-limit`.
Unknown native closure still outranks a no-write refusal; no completed counter or second close discharges it.

## 5. Good / Base / Bad cases

- Good: a fresh process reopens after each migration DDL fault and sees exact G1 or complete G2, with original claim inode and pending outbox intact.
- Base: a settled historical G1 store is observed without migration; an explicit checked shell opener later upgrades only the known layout.
- Bad: treating a consumed reservation ID as reusable, normalized TEXT as authentic original bytes, or a structurally valid approval row as terminal authorization.
- Bad: checking only before store opening, then allowing preparation to invalidate context before an unguarded write.
- Good: independent lease excludes a checked alive contender while an old install FD is open; after actual process exit, fresh explicit SDK Open does not replay and exact retry reuses retained group/BLOB/claim identities.
- Base: no-work default helper/worker stays nonparticipating; a proved-closed refusal frees only its exact obstruction for fresh checks.
- Bad: task-store `finally` releases the coordinator after descriptor/fence failure, or a new DB "repairs" an unusable original fence.
- Good C: duplicate at capacity executes current guard/CAS, commits no changed rows and consumes the exact same-store outcome once.
- Base C: lawful legacy gap has producer=null/undelivered while private facts remain readable.
- Bad C: catalog mutation commits because only the 21 selected streams matched, or an older delivered predecessor certifies today's inventory.

## 6. Required tests

Keep `test/task-foundation.test.ts` and existing storage/apply suites passing without rewriting their admission contract.
`test/task-shell-contracts.test.ts` and `test/task-shell-durable-contracts.test.ts` cover bounds, closed variants, immutable copies, namespaces, prepared closure/permissions and honest proposed synthesis.
`test/task-shell-store.test.ts` covers readonly allocation/path/catalog/raw-byte integrity and G1 preservation.
`test/task-shell-g2-store.test.ts` covers compound rollback/retry, retained graph corruption, reservation collisions/caps, source histories, cleanup faults and observational G2 reads.
`test/task-shell-crash.integration.test.ts` faults the actual opener in fresh processes around each additive DDL/singleton/commit boundary and verifies preserved records/BLOBs/sequences/claims.
Its fixture prepared/approval rows are not issuer tests.
`test/task-shell-session-store.test.ts` adds multi-epoch/cancellation/same-ID stale callbacks, readonly detailed pages, seed/provenance retention, reserved capacity and fresh-process faults through admission/provisional/final transitions.
Rehashed historical Return/departure corruption and inconsistent pending/prepared locators must fail retained admission.
`test/task-shell-source-store.test.ts` covers source transitions/historical birth/status, exact quote confirmation, decision/blocker history, generic-operation downgrade negatives, independent progress, compound partner integrity, joint capacity and each-write/pre/postcommit fresh-process exits.
Include outbox rollback/conflict, independent-component/grouped retry mismatch, old receipt relabeling and immutable review/approval retention.
The large retained-history positive uses actual source/decision writers beyond one keyset page; prepared/approval setup remains a storage fixture, not issuance.
`test/task-source.integration.test.ts` exercises guarded capture/confirm/revise/supersede/progress after store-open reentry and pure final checks after the last manager getter.
`test/task-shell-session.integration.test.ts` covers final Open guard reentry and failed durable fencing; `test/task-native-ui.integration.test.ts` covers native post-answer expiry before source/Open mutation.
These complement storage tests; they do not authenticate direct storage APIs or qualify an issuer.
Retain `test/task-lifetime-resources.test.ts`, `task-lifetime-fencing.test.ts`, `task-lifetime-final-fence.test.ts`, `task-lifetime-final-review.test.ts`, `task-lifetime-handoff-fence.test.ts`, `task-lifetime-precommit.test.ts` and `task-lifetime-worker.test.ts`.
Assert pre-I/O exact-borrow refusal, deferred DB capture, all three reference sites/cache paths, real before/after-close faults, independent sibling cleanup, actual held-lock contention, sticky original/held/fresh routes and reserved-capacity closure.
Precommit tests must reach actual BEGIN/guard and assert zero writer attempts after revocation, not merely eventual rollback; retain default-return controls and strict provisional/B checks.
Retain actual generated-worker anchor absence and default protocol/failure behavior; any authorized regeneration uses the existing script and keeps operator output unchanged.
D's subsequent narrow generated-worker approval and fresh checks supersede the earlier missing-scope/freshness blocker; see [generated dependency propagation](./quality-guidelines.md#scenario-d-generated-dependency-propagation-and-partial-gates).
Linux storage tests do not establish physical-terminal approval, Node 22/24, native Windows/macOS ACL/power-loss or G4 worker settlement.

Retain `test/task-planning-c-store.test.ts`, `task-planning-c-storage-review.test.ts`, `task-planning-c-root-review.test.ts`, `task-planning-c-projection.test.ts` and `task-planning-c-predecessor.test.ts`.
Assert no-write duplicates before request/event caps and UUID allocation; original-horizon rehashed corruption; postguard protocol/singleton/catalog rollback before COMMIT; same-store one-shot/current outcome; all 21 streams/parent joins; all-outbox state-only drift; producer/tail/source-lag/legacy-gap distinctions and prehydration bounds.
Assert actual same-frame post-observation predecessor on original connection with no nested opener; remaining 16-MiB decisions/index budget; real BEGIN/COMMIT/rollback/close faults and retained IDs after lost response.
These focused cases do not establish C4 or other-runtime/platform acceptance.

## 7. Wrong vs correct

Wrong: exclude every `sqlite_*` catalog entry or truncate an overlong digest to make validation bounded.
Correct: admit only exact known objects, gate raw byte length in SQL and reject malformed identities without normalization.

Wrong: resolve a source and confirm its dependent decision in two separate transactions, or accept a generic rehashed planning event as confirmation history.
Correct: use the compound writer and verify its exact pair/transition ownership on reopen.

Wrong: decode an approval or consume a Return slot and label the task authorized/settled.
Correct: retain checked facts; the future terminal approval and lifecycle owners must supply independent live authorization and settlement proof.

Wrong: a pre-open host check or stored `accepted` field is sufficient authority.
Correct: pass the code-owned synchronous guard to the narrow writer after preparation; direct storage fields remain data, not host proof.

Wrong: `store.close()` always releases the checkout, or a failed same-store fence may retry on a new connection.
Correct: retain the independent lease until all original resources/invocations/fences are proved closed; use only the pre-reserved sticky departure route.

Wrong: `new DatabaseSync(path)` followed by capture, or a wrapper's second `close()` proves cleanup.
Correct: capture the unopened native object before `open()`; settle only the exact first native close's normal return.

Wrong: use a full after snapshot obtained after callbacks as C's new authority, or verify catalog only when consuming.
Correct: pin before callbacks, compare selected facts and actual root/catalog before COMMIT, then consume the exact sealed transition on the original store.

## Scenario: D guarded Create/Return and reserved key domains

### 1. Scope / Trigger

`src/task-store.ts` and `src/task-shell-storage.ts` implement the approved D storage factoring.
Independent correction review closed S1 (missing immutable duplicate witness) and S2 (missing cross-domain reservation invariant); regressions now exist.
These corrections were initially a **partial technical checkpoint**, not combined Gate 1 clearance.
Subsequent independent performance review and main's once-each serial/default gates now clear only the foundation for Gate 2; no D acceptance or terminal-write exposure follows.
The registrar remains absent; accepted B/C history and original failed probes remain unchanged.
The [frozen D plan](../../tasks/09-24-cadence-task-shell-and-approval/research/approved-planning-d-v1/implement.md) and subsequent approvals govern scope; [quality checkpoint](./quality-guidelines.md#scenario-d-generated-dependency-propagation-and-partial-gates) owns current and historical gates.

### 2. Signatures

```typescript
store.createShell(input: ShellCreate, publications?: readonly ShellPublication[],
  precommit?: () => void): PortableTask
store.recordShellReturn(session: unknown, precommit?: () => void): TaskLocal
```

Internal factoring is `prepareShellCreate` → `shellCreatePredecessor` → `commitShellCreate`, and `prepareShellReturn` → `commitShellReturn`.
No generic transaction callback, new durable variant, DDL or environment key is added.
Trusted no-guard callers remain storage services, not authenticated terminal callers.

### 3. Contracts

- Guarded Create detaches/decodes caller graphs, publication byte views/identities and hashes before BEGIN; the prepared graph recursively freezes the exact seed, genesis, operation and decoded `created` event that will be committed.
  Empty record arrays must be code-owned, not caller `Array.map` results.
  Guarded Return decodes input before BEGIN and prepares its detached retained predecessor inside it.
- On the original connection: BEGIN → full integrity/prepared predecessor → one store-owned participating guard frame → strict undefined guard result → frame leave/pure work/store check → actual root/catalog/full integrity → repeated exact predecessor CAS → callback-free compound writes → postvalidation → COMMIT.
  Guarded standalone calls are equally strict; never read `.then` or await a guard.
  Duplicates execute the same currentness/root/catalog/CAS checks before returning; rollback alone does not prove zero writer attempts.
- Create duplicates compare the full operation and **actual stored genesis, seed and created event** with the immutable prepared originals, not just request/row hashes.
  Normalize only legitimately evolving session outcome/candidate and reservation consumed slots for initial-fact comparison.
  Separately pin their unnormalized current values, current local/portable record and outbox sequence/state/identity before and after the guard; legitimate binding/progress/fence/Return history remains legal.
  Both guarded and no-guard duplicates reject already-rehashed provenance instead of adopting it as a baseline.
- New Create checks generated IDs' internal disjointness and actual SQL key domains before any insertion, and repeats after the guard: **SESSION** incoming `{session.id, reservation.returnIntentId}` against both session rows and every retained reserved Return-intent key; **OPERATION** incoming `{operationId, bindingOutcomeOperationId, departureOperationId, returnIntentId, returnOutcomeOperationId}` against operation rows and all four retained terminal-slot values.
  Both directions apply, including consumed reservations; keep separate record/genesis/reservation/publication key checks.
  `returnIntentId` occupies both domains.
  This is not universal UUID uniqueness across unrelated tables.
- Return binds current local/portable record, original session, reservation, exact operation and previous pending outcome; commit recomputes and compares that prepared predecessor, including duplicates.
  Departure must already be consumed.
  Return consumes only its reserved intent/outcome and adds no fence, attachment, navigation, settlement or approval proof.
- Final-guard refusal prevents **task compound write attempts**, not already admitted coordinator/path/empty-file/schema bootstrap or G1 evolution.
  U3 remains: interrupted initial installation can leave no task and indefinite consumer refusal even after restart; D supplies no initialization recovery/reset/delete/change-root escape.

### 4. Validation & Error Matrix

| Condition                                                                    | Required result                                                                              |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Nonundefined guard, stale exact predecessor or rehashed duplicate provenance | `task-conflict`; no compound writer attempt                                                  |
| Occupied SESSION/OPERATION reservation domain, including consumed keys       | `task-storage-invalid` before writer attempts; preexisting collision precedes guard          |
| Guard-induced root/protocol/singleton/catalog corruption                     | `task-storage-invalid` before COMMIT, including duplicates                                   |
| Invalid input/Return prepared outcome                                        | `task-record-invalid`; no invented transition                                                |
| Native close/transaction uncertainty after commit                            | Existing bounded failure/retained resource rules; no inferred rollback or repeat-close proof |

### 5. Good / Base / Bad Cases

- Good: exact Create duplicate after lawful progress/binding/Return preserves today's rows while matching original genesis/seed/event.
- Base: trusted no-guard callers retain compatible reserved Return behavior; independent SQL domains may reuse an otherwise unrelated UUID.
- Bad: accept rehashed genesis, check session IDs only against operations, ignore consumed Return reserves, or discover a collision only after INSERT/rollback.

### 6. Tests Required

`test/task-shell-d-store.test.ts` covers all kinds, detached getters/byte views/custom arrays, strict guard outcomes, actual postguard root/catalog checks on six Create/Return/outcome and duplicate routes, and zero INSERT/UPDATE/DELETE preparation after refusal.
Retain S1 original-provenance/seed drift, preexisting rehashed drift and evolved-current duplicate controls; retain S2 both session-domain directions before/after guard, consumed history and all 5×5 operation/reservation collisions.
Assert complete logical catalog/table/BLOB/`sqlite_sequence` snapshots and checked reopen, not SQLite file-byte/WAL/inode equality.
Bootstrap effects and revoked compound attempts need separate assertions; existing G1/G2/session/source tests and original probes remain intact.
Independent storage review passed 199 focused tests; that is not a combined/full gate.

### 7. Wrong vs Correct

Wrong: `if (stored.requestHash === prepared.requestHash) return success;` or let a UNIQUE failure discover reserved-ID overlap.
Correct: compare immutable original facts **and** the exact current predecessor, repeat both key-domain preflights after the guard, then permit the first writer attempt.
These are missing-witness/cross-layer-invariant bugs, not hash-function or transaction-rollback defects; extend both duplicate and fresh-admission matrices when adding a reserved key.

## Scenario: D traversal-local SELECT reuse without fact caching

### 1. Scope / Trigger

The [approved performance amendment](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-performance-approval.md) changes only private payload/traversal helpers in `src/task-shell-storage.ts`, with appended storage regressions and the separately documented Source fixture adoption.
Independent delta review found no blocker; [Gate 1](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate1-checkpoint.md) is narrowly cleared, not D/G2 acceptance or qualification of a future host.
Reuse SQL preparation within one synchronous traversal, never retained facts or validation results.
No DDL, validator/relationship algorithm, guard/transaction placement, budget, resource owner or native close path changed.

### 2. Signatures

```typescript
// Private to src/task-shell-storage.ts; Row = Record<string, unknown>.
preparePayload(db: DatabaseSync, table: string): StatementSync
checkedPayload(statement: StatementSync, rowid: number): Row
payload(db: DatabaseSync, table: string, rowid: number): Row
each(db: DatabaseSync, table: string, keys: readonly string[],
  visit: (row: Row) => void): void
```

Table/column names and synchronous visitors remain code-owned; no public query/cache selector or environment key is introduced.
Standalone `payload` is exactly `checkedPayload(preparePayload(db, table), rowid)`: `read`, `readSeed`, `readShellLocal` and relational callers prepare afresh on every call.

### 3. Contracts

- Each invocation owns at most three reusable SELECT statements: page, metadata gate and payload.
  Nested reservation traversals (including `checkCapacity` inside local validation) own distinct locals; three is not a whole-stack resource bound.
- Prepare the page statement at its original first execution point.
  Prepare the gate lazily only after the first safe-integer cursor; prepare payload lazily only after the first successful native gate.
  Empty traversal prepares only the page; neither a malformed first cursor nor a failed first gate eagerly prepares later stages.
- Preserve exact SQL text, metadata-column order and bindings.
  Page SQL remains `SELECT rowid AS cursor FROM ${table} WHERE (? IS NULL OR rowid > ?) ORDER BY rowid LIMIT 64`; execute native `.all(cursor, cursor)` for every page, initially `(null, null)`, including the final empty page.
- For every row, execute native gate `.get(cursor)` again: raw `payload_hash` BLOB length **=64**, each requested key BLOB length **<=64**.
  Payload independently repeats its predicates: `SELECT *, CAST(payload_json AS BLOB) AS raw_json`, exact rowid, JSON BLOB **<=65536 bytes**, all code-owned metadata fields/hash **<=64 bytes**.
  Do not merge the distinct gate and hydration predicates.
- `checkedPayload` calls its owning statement's native `.get(rowid)` every time, requires a row and `Uint8Array`, and hashes the freshly selected original BLOB against `payload_hash`.
  Fatal UTF-8/JSON decoding and all existing identity/root/session/epoch, historical/live, source-uniqueness, capacity and relationship checks still run; normalized TEXT is not hash input.
- No saved rows, digests, decoded facts, permissions or bound-method result cache.
  No statement escapes an invocation into a store/module/connection cache or crosses a validation pass, guard, transaction or reopen.
  Pre/postguard full integrity, actual root/catalog and exact predecessor CAS remain separate fresh checks before callback-free writes.
- Local references bound application reuse, **not immediate native finalization/GC**.
  Existing checked DB close and first-close uncertainty remain controlling; no iterator, finalizer, reclose or new resource protocol follows.

### 4. Validation & Error Matrix

| Condition                                                                                         | Required result                                                                                          |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Empty page                                                                                        | Finish traversal without gate/payload preparation                                                        |
| Invalid/unsafe cursor                                                                             | `task-storage-invalid`; no first-row gate/payload hydration                                              |
| Missing metadata gate, short/NUL/overlong raw identity/hash                                       | `task-storage-invalid`; no first-row payload preparation                                                 |
| Oversized/missing payload, wrong original hash, invalid UTF-8/JSON or rehashed relationship drift | `task-storage-invalid` through retained integrity validation; no cached earlier success                  |
| Native prepare or reused `.all`/`.get` failure                                                    | Existing `checkShellIntegrity` bounded `task-storage-invalid` mapping; original close obligations remain |
| Postguard raw/root/catalog drift                                                                  | Fresh validation refuses before compound writer attempts; rollback preserves prior logical facts         |
| Unknown native close                                                                              | Existing resource uncertainty/close-error priority; statement scope/GC does not certify closure          |

### 5. Good / Base / Bad Cases

- Good: 130 sparse rows execute four page reads (64/64/2/0) and 130 gate plus 130 payload reads, using three preparations; a second traversal has distinct statements and raw result objects.
- Base: standalone `readShellLocal` prepares afresh; empty tables and nested reservation traversals keep their original refusal and validation order.
- Bad: count fewer preparations as proof of fewer required reads, reuse a preguard hash after the guard, or infer native closure from local-variable lifetime.

### 6. Tests Required

`test/task-shell-d-store.test.ts` appends **38** cases to the exact original 199-case prefix (**237** total), not replacement assertions.
Assert native execution counts/owning statements, exact cursor pairs/order/final empty page, distinct passes/nesting/standalone reads, lazy refusal and maximum-safe versus unsafe rowids.
Inject real later-page/later-pass corruption immediately before native execution; retain raw metadata/NUL, 65536/65537-byte, invalid UTF-8/original-hash and rehashed relationship negatives.
Assert distinct pre/postguard traversals and zero compound writer attempts after postguard drift, plus exact logical rollback snapshots, native prepare/execution failures and actual original DB closure.
Keep original G2 full-history/reserved-capacity, crash, C projection/predecessor, precommit/handoff and before/after-close injections reachable and unchanged; arbitrary nth-prepare schedules are not guaranteed identical.
Independent review's **345** focused passes overlap these cases.
Main's exact 27-file serial/default runs each passed **1234** once; never sum them or substitute them for future host/full-repository gates.

### 7. Wrong vs Correct

```typescript
// Wrong: cache facts or a statement across validations/guards on this store.
if (cachedRow) return cachedRow;
// Correct: invocation-local payloadStatement, after this row's native gate.
payloadStatement ??= preparePayload(db, table);
visit(checkedPayload(payloadStatement, entry.cursor)); // Fresh get + raw hash.
```

Preparation reuse removes repeated SQL preparation only; every current row and complete retained graph still has to prove itself.
Measured benefit and setup accounting belong to [Quality Guidelines](./quality-guidelines.md#scenario-d-generated-dependency-propagation-and-partial-gates), not a new latency or resource-closure guarantee.

## Scenario: Isolated convergence selected validation and review transactions

### 1. Scope / Trigger

Candidate-only contract, before guarded LIVE integration: the sole private G2 candidate adds selected validation and terminal review persistence.
Earlier absent-issuer/full-history descriptions above are historical checkpoints, not this candidate's behavior.
Production `src/index.ts` is unchanged; G3 compilation and G4 execution remain unavailable.

### 2. Signatures

`checkShellCatalog(db, rootHash)`, `checkShellTask(db, rootHash, taskId)` and `auditTaskStorage(state, work?)` have distinct purposes.
Named `TaskStore.prepareReviewShell`, `registerReviewInteractionShell`, `issueReviewedShell` and `resolveReadonlyAgreementShell` require synchronous strict-undefined precommit.
`consumeReviewOutcome(outcome)` consumes exact same-store membership once after normal COMMIT.
These are trusted persistence APIs, not terminal authentication.

### 3. Contracts

Normal admission checks actual root/catalog/profile; selected operations validate returned/affected rows, indexed keys, necessary references and retained producer/source/record/Intent lineage.
Explicit audit and checked migration/recovery retain complete graph validation.
Invocation-local statement/decoded-data reuse cannot survive callback-bearing precommit as authority; repeat fresh affected witnesses on the original connection before callback-free CAS.
Review pages validate independently checked root, original preparation operation/event, immutable compile horizon, full plan bytes and core/supplementary producer bytes before slicing.
Registration validates the selected existing ticket row even on exact duplicate; count all consumed/unconsumed tickets at 256 before new append without rejecting/pruning inherited valid over-cap history.
Issuance checks approval absence by review identity independently of the local pointer; consume ticket, append approval/event and CAS together.
Readonly agreement requires earlier capture plus reciprocal adjacent Source/Intent operations and whole-objective carry/drop proof; no standalone acceptance or legacy gap supplies that proof.
Actual first-close uncertainty retains exact resources, fences and exclusion; COMMIT ambiguity installs no outcome seal.

### 4. Validation & Error Matrix

- Wrong selected keys/root/original operation/event/peer: `task-storage-invalid`, no usable bytes or writer attempts.
- Changed hashes/clocks/review/file or duplicate issuance: `task-conflict`, no overwrite/reissue.
- Nonvoid/thenable guard: refusal without `.then` access; no task transaction across await.
- Failed native closure: bounded failure and retained obstruction, never rollback/settlement inference.

### 5. Good/Base/Bad Cases

Good: informational progress reuses the original immutable pair with a separate fresh admission pin.
Base: unrelated corrupt history may be undisplayed while explicit audit detects it.
Bad: validate a row with its own claimed root, trust ticket JSON despite wrong indexed keys, or reseal later current facts.

### 6. Tests Required

Keep complete `task-review.test.ts`, `task-shell-session-store.test.ts`, `task-shell-source-store.test.ts`, G1, B/C, migration, precommit and close-fault suites.
Assert selected corruption refusal versus unrelated-history tolerance plus explicit-audit detection; last-guard root/catalog/private-byte mutation causes zero stale writer attempts.
Retain original-horizon reuse, reciprocal-pair carry/edit/drop, capacity/exact retry, review-identity uniqueness and same-store seal/COMMIT-loss negatives.

### 7. Wrong vs Correct

Wrong: remove full graph validation and retain only JSON hashing, or use postguard rollback as a zero-write proof.
Correct: enumerate selected key/reference/lineage predicates, repeat them after observations and before the first same-connection write; audit remains explicit.

## Scenario: G3 selected pure decode reuse (execution still disconnected)

### 1. Scope / Trigger

`src/task-shell-storage.ts#checkShellTask` may reuse pure decoded bytes inside its existing synchronous private query context.
This fixes repeated graph normalization in genuine terminal review without caching admission/currentness.

### 2. Signatures

Private `decodePayload(row, decoder, queries?)` recognizes exactly the Intent, Operation, ReviewIntent and PreparedSnapshot codecs.
The unknown-input boundary `checkTaskPreparedBytes(metadataValue, supplied)` still decodes metadata afresh; `checkTaskDecodedPreparedBytes(snapshot: TaskPreparedSnapshot, supplied)` factors only its byte routine for storage-owned already-decoded metadata.

### 3. Contracts

Every use still hydrates native raw bytes and runs the original SQL gates/hash checks.
Reuse requires the exact decoder and full byte equality; the initial codec result is recursively frozen.
All indexed keys, catalog/root, relationships, original horizons, full plan/material bytes and release witnesses run again.
At most 64 entries/4 MiB are retained; exhaustion uses ordinary decoding.
Locals are cleared on exit and never cross a guard, traversal, transaction, UI page or operation.
Both original catalog classifications remain independent.
Complete audits/default helpers retain ordinary decoding, not a new query/cache selector.
The typed byte helper still copies and checks length, raw hash, fatal UTF-8, canonical JSON plus LF and plan hash; it authenticates no metadata or receipt.

### 4. Validation & Error Matrix

- Different bytes/decoder: ordinary full decoding, never hash-only reuse.
- Rehashed corrupt metadata/relationship: existing `task-storage-invalid` refusal.
- Retention cap: ordinary decoding, not omitted checks or an expanded budget.
- Guard/native-close failure: existing refusal/retention; pure reuse proves no close.

### 5. Good/Base/Bad Cases

Good: identical fresh raw bytes avoid repeated pure normalization in one pass.
Base: the next pass starts empty and proves all current rows independently.
Bad: reuse a decoded scope as permission after a callback, or bypass metadata admission by calling the typed byte helper on arbitrary caller data.

### 6. Tests Required

Keep complete integrity-query, G1/G2 storage, review/approval, native resource and final-fence suites unchanged.
The private-helper regression tests exact bytes, decoder identity, immutable/copy isolation, separate invocations and both caps.
Genuine compiler tests compare full and typed byte paths and retain unknown-input metadata rejection.
Full SDK review must pass without changing original deadlines, pages, material/display content or per-page currentness.

### 7. Wrong vs Correct

Wrong: reuse a row hash or permission verdict captured before host callbacks.
Correct: hydrate/hash full raw bytes on every read, reuse only identical immutable pure decoding within that pass, then repeat all original-connection witnesses.

## Scenario: Locally decoded relations, not cached authority

### 1. Scope / Trigger

G3 independent review factors redundant pure decoding out of relation checks in `src/task-shell-storage.ts`.
Unknown-input and native observation boundaries stay strict.
This does not remove a query, byte read, catalog classification or witness.

### 2. Signatures

The `checkTaskDecodedIntentReferences`, `checkTaskDecodedOperationEvent`, `checkTaskDecodedReviewLinks` and `checkTaskDecodedPreparedInputBytes` routines in `src/task-shell-contracts.ts` accept metadata already decoded in the current synchronous operation.
Their original unknown-input wrappers still decode.

### 3. Contracts

Typed routines repeat all joins, hashes, context/set/aggregate checks, but do not normalize an already decoded graph again.
Intent reference contexts and operation payloads still enter their own independent budgets.
Material bytes are always freshly hashed.
The ReviewIntent codec reads its already decoded impacts directly for its depth floor.
No metadata, permissions or currentness result is cached across a guard, page, transaction or operation.
Native query counts and both catalog classifications remain unchanged.

### 4. Validation & Error Matrix

Unknown extra fields still refuse at unknown wrappers.
Fresh context/material or relation drift still refuses at typed routines.
A missing interaction remains a refusal, never an optional approval join.
Native failure/closure uncertainty keeps its original resource owner and failure precedence.

### 5. Good/Base/Bad Cases

Good: decode a freshly hydrated row once, then check its complete relations.
Base: a caller DTO uses the original unknown wrapper.
Bad: call a typed routine on a cast DTO, skip fresh native hydration, or reuse an old result after a callback.

### 6. Tests Required

Keep all original native query/resource/final-fence tests and complete genuine terminal files.
Appended `test/task-shell-durable-contracts.test.ts` checks typed versus unknown parity, stale independent contexts, identity/issuer joins, material mutation, aggregate/set bounds and retained unknown-field rejection.
The complete second-review watchdog must pass without deadline or body changes.

### 7. Wrong vs Correct

Wrong: `oldDecodedPermission` authorizes a later page.
Correct: freshly hydrate/hash/decode locally, run every relation, and repeat the original witnesses after callbacks before final CAS.

### Fixed native fixture runtime closure

Adding G3 imports can break original native-host scenarios before their first assertion.
`test/helpers/task-native-emit.ts` pins the actual explicit 53-source runtime closure, including the original G3/G4 dependencies and bounded closed-handoff owner, within the unchanged 64-source cap and original byte/resolve/load/close checks.
Update exact inventory assertions in all three emitter suites, never enable discovery or an unlisted fallback.
Qualify every complete helper caller (Open, source, source review and host I/O), not just emitter-only probes; fixture-emit-unlisted is not resource qualification.

### G3/C final catalog checks without cold helper acquisition

Checked opening may construct code-owned expected catalogs under the original tracked reference sites.
`checkShellTaskAfterGuard` and C's final commit/outcome classifications reuse only those immutable expected definitions; they still execute the actual catalog/root/structure/selected-row checks afresh on the original connection.
An unexpected newly additive layout cannot cause a cold reference DB to open after callback-bearing guards.
Generic cold `checkShellTask`/opening remain supported; no caller model flag selects reference construction and no actual verdict/row/currentness is cached.
Both classifications, native query/resource caps and original first-close obstruction remain mandatory.
The native query fixture identifies the actual factored `checkSelectedTask` body as well as its public wrappers; it preserves all original counts, pass/guard separation and failure assertions.

The bounded M1/M2 handoff table/profile and named selected wrappers are specified in [task-execution-guidelines.md](task-execution-guidelines.md#scenario-bounded-closed-family-handoff--selected-evidence-basis-m1m2-only).
Keep handoff SQL behind that fixed owner and the original TaskStore transaction; do not expose DB access, add another storage root, infer receipt membership from retained JSON, or allow ordinary observation to evolve the layout.
A task-DB witness alone does not cover the separately sealed G4 reports/journal: repeat their original checked observation after callback-bearing guards, then the selected task witness and pure original-action tail.

## Scenario: Isolated G5 optional knowledge over genuine source evidence

### 1. Scope / Trigger

Use when changing `src/task-knowledge.ts`, its named TaskStore wrappers, G5 model contracts, or optional publication.
Production remains disconnected.
The current implementation/evidence boundary is [knowledge controls handoff](../../tasks/10-06-cadence-readonly-history-knowledge-completion/research/knowledge-controls-handoff.md); historical missing-owner descriptions above are not permission to replace M1/M2 or Completion.

### 2. Signatures

`evolveKnowledgeShell(state, guard)`, `retainKnowledgeShell(state, task, input, guard)`, `selectKnowledgeShell(state, task)`, `inspectKnowledgeShell(state, task, id)`, `promoteKnowledgeShell(state, task, id, guard, confirmation?)`, and `withKnowledgePublicationScope(state, task, id, guard, body)` are fixed trusted-store operations.
`TASK_KNOWLEDGE_SCHEMA` adds marker/candidate/promotion/event tables to the original namespace.
Events are candidate, promotion, or genuine supplemental confirmation; no SQL callback/root selector exists.

### 3. Contracts

Retained assessment citation, whole-source BLOB/hash/range, root/task, and fatal UTF-8 quote checks are independent.
Automatic facts prove only an exact finite source quotation.
Normative applicability is a project-suggestion domain, not the factual quotation domain; hypotheses remain research.
Unknown/manual/foreign-pending claims and unresolved overlap never establish non-conflict.

Scan actual directory entries plus all bounded retained candidate/provenance/competing claims, including pending candidates.
Limits are 64 global candidates/promotions, 256 actual entries, 64 per-task candidates and 128 events.
Recheck at each pending G1 mutation boundary.
Exclude only that exact admitted operation's self/staging paths; directory absence does not skip private provenance.
Preserve original managed predecessor/claims; manual bytes are never a new baseline.

Exact scope/claim duplicate avoids another note regardless of topic; extra support stays private.
An exact native confirmation may authorize an existing conflict-stopped intent without changing its original desired bytes.
Retain bounded confirmation history, do not rewrite prior promotion or invent closure.
Optional work follows required acknowledgment and never gates or gets replayed by required finalization.

Incoming model DTOs remain collect-evidence/submit-assessment only, at 65536 bytes, 8192 nodes, depth 32.
Collection's optional page 0–127 displays context from the authenticated **whole** capture; UTF-8/BOM/CRLF are preserved and binary pages are bounded base64.
Displayed range/context is not authentication.
Exact-key decoding must conditionally include optional fields by own-field presence.

### 4. Validation & Error Matrix

Uncited/forged support or malformed closed fields: bounded invalid/conflict refusal.
Unsafe topic/device: path refusal.
Bound exhaustion: planning-limit, never partial scan proof.
Changed managed bytes/claims: conflict, no rebase.
Copied/native-looking confirmation: entry rejection.
Unknown first native close: retained obstruction, never success from error code/timeout/reclose.

### 5. Good / Base / Bad Cases

Good: faithful quote plus current complete domain publishes through original G1.
Base: a norm or uncertain claim is privately readable; exact native whole-candidate confirmation is separate.
Bad: publish because a cited file exists, because a model says PASS, or because only the private managed-note list is small.

### 6. Tests Required

Keep complete Completion/closed-handoff/crash/G1/codec/emitter/session/source/lifetime suites.
`project-knowledge.test.ts`, `task-knowledge-contracts.test.ts`, `task-evidence-context.test.ts`, and native G5 controls cover current source predicates, actual-directory bound, source-byte paging, schema budgets, manual preservation, pending identity and original native confirmation.
Require actual original task-DB before/after-first-close retention and departure veto, not wrapper success.
Preserve prior failed runs; targeted passes are not platform/full-gate acceptance.

### 7. Wrong vs Correct

Wrong: own newly committed norm makes its scan uncertain, or a foreign pending intent is presumed delivered.
Correct: exclude only the exact operation being published; retain foreign pending uncertainty and original receipt/view binding.
Wrong: optional page is listed in an exact-key decoder for every request.
Correct: admit that key only when it is an actual own field, then decode its finite integer bound.

## Scenario: Distinct readonly source-byte capacity

### 1. Scope / Trigger

Read when changing `recordTaskLocalFulfillment` in `src/task-completion-storage.ts`.

### 2. Signatures

`recordLocalEvidenceShell(state, task, input, originalSource, guard)` retains its genuine whole-source membership and synchronous guarded transaction.

### 3. Contracts

The 16-MiB per-task limit charges distinct `task_evidence_bytes` BLOBs, not each observation of already-retained content.
Before reuse, independently gate the existing BLOB at 1 MiB and compare its entire bytes to the genuine collected source.
New paths, identities and fulfillment references remain separately bounded and validated; reuse grants no currentness or Completion.

### 4. Validation & Error Matrix

Exact existing bytes at the cap remain admissible.
New bytes beyond the cap return `task-planning-limit` without new retained references.
A same-hash/different-byte BLOB remains `task-storage-invalid`.

### 5. Good/Base/Bad Cases

Good: two authentic whole-file observations share one original checked BLOB.
Base: a distinct source fits the remaining byte budget.
Bad: charge reused content again, or skip its byte comparison to permit reuse.

### 6. Tests Required

`task-completion-contracts.test.ts` reaches exactly 16 MiB through genuine collectors, admits a seventeenth observation reusing bytes, and refuses additional distinct bytes with unchanged observation count and applicable basis.
Keep the 30-second control watchdog and all original source/closure tests.

### 7. Wrong vs Correct

Wrong: check `total + source.length` before selecting an existing source hash.
Correct: validate the retained total, authenticate existing full bytes, and charge only a new BLOB before its insertion.
