# Disconnected Task Authoring and Negative Lifetime

## 1. Scope / Trigger

Read before changing B contracts/controller/storage/publication or `src/task-lifetime.ts`.
The lifetime owner is integrated with resource, session, source and planning owners, independently reviewed on **Linux x64 Node 26.7.0 / Pi 0.84.3**.
Original H1/H2 safety assertions now pass; their red history is preserved, not relabeled compatibility evidence.
Qualified disconnected B/lifetime is **accepted** under the [delegated decision](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-b-acceptance.md), limited to the environment above and compatible participating main-Node composition with cold deployment/build upgrades.
Whole G2 remains **unaccepted**; production `src/index.ts`, DDL, source acceptance and execution are unchanged.
No registrar/Create/Return rollout, full review paging, compiler, issuer, executor or business writer is supplied.
Full repository/distribution/real-pack gates remain separately main-owned; this guide asserts no current full-gate total.
[Planning Host](../frontend/task-planning-guidelines.md) owns live admission/H3 release; [Task Storage](./task-storage-guidelines.md) owns resource adapters/borrowing/fencing.
Accepted A/N1 and D1/R1/R2/immutable-provenance contracts below remain mandatory.
The earlier C1–C3 checkpoint described below predates [qualified C acceptance](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-c-acceptance.md); preserve its evidence as history, not D qualification.
Last accepted B/C composition is ABI5; current D core is ABI6 with only the partial reviewed checkpoint below, **not Gate 1 or D acceptance**.
C adds unfulfilled readonly-objective questions, two structural/request views and an inert local review request in existing owners; no evidence provider/fulfillment, semantic certifier, source acceptance or review consumer.
The Linux/main-Node/cold-upgrade and unknown-closure limits above still apply.

## 2. Signatures

```typescript
decodeTaskAuthoringRequest(value: unknown): TaskAuthoringRequest
observeTaskAuthoringSection(state, selectedTaskId, request, work?): TaskAuthoringSectionPage
observeTaskAuthoringCheckpoint(state, selectedTaskId, work?): { local: TaskLocal; record: PortableTask }

// createTaskPlanningController retains synchronous A dispatch and adds:
dispatchAuthoring(taskId, request, scope: TaskAuthoringExecutionScope):
  Promise<TaskAuthoringSectionPage | TaskAuthoringResult>

TaskStore.openExistingShell(state): TaskStore
store.authoringFacts(task)
store.prepareAuthoring(candidate, materialBytes = []): ShellAuthoringPrepared
store.authorShell(candidate, precommit: () => void, materialBytes = []): TaskLocal
store.selectAuthoringRetry(task, bindingEpoch, expected): ShellAuthoringSelection
store.withAuthoringPublicationScope(task, bindingEpoch, expected, guard, body)

new TaskPublisher(store, options?: TaskPublisherOptions | TaskPublisherOptions["boundary"])
publisher.verifyDelivered(operationId): void
publisher.verifyRetainedClaim(operationId): void
```

`TaskAuthoringCandidate` is code-owned resolved data, not a model permit.
`materialBytes` entries are `{publicationId, expected: Uint8Array}`; prepared output is `{operation,intent,publications}`; selection is `{operation,publications,clocks,bindingEpoch}`.
`TaskPublisherOptions` has optional `admit: () => void` and `boundary: (point: PublicationBoundary, operation: TaskPublication) => void`; the legacy boundary-function overload remains.
Fault instrumentation is never admission.

`TaskAuthoringExecutionScope` supplies `bindingEpoch`, optional internal `lifetimeWork`, `guard()`, `withStore(state, work)`, `committed(local, record)` and **`setReleaseCheck(check: () => void)`**.
The integrated host supplies exact work to A/B dispatch; absence is only a nonparticipating domain-call compatibility path.
The host owns closure; controller/publication borrow that exact `TaskStore`, never open a second checkout or close the borrowed store themselves.
The release checker is code-owned readonly state, not model input/result or a writable capability.
No new environment key or public writable flag exists.

### C service signatures

```typescript
decodeTaskPlanningCRequest(value: unknown): TaskPlanningCRequest
decodeEvidenceRequestInput(value: unknown): EvidenceRequestInput
controller.dispatchPlanningC(taskId: string, request: TaskPlanningCRequest,
  scope: TaskPlanningCScope): Promise<TaskPlanningCResult>
```

These are implemented in `src/task-shell-contracts.ts` and `src/task-controller.ts`, not a second installer or a model task selector.
Read/write scopes and local review ownership are in [Planning Host](../frontend/task-planning-guidelines.md); the event-only writer/seal belongs to [Task Storage](./task-storage-guidelines.md#c-event-only-writer-and-exact-outcome).

### Integrated negative core signatures

The accepted ABI5 internal seams are listed below (methods belong to `TaskLifetime` unless qualified); the D scenario adds the current, unaccepted ABI6 navigation vocabulary.

```typescript
taskLifetime(create = false): TaskLifetimeAccess
// {kind:"available", lifetime:TaskLifetime} | {kind:"absent"} | {kind:"unavailable"}
resourcesForTaskDatabase(db: DatabaseSync): LifetimeWork | undefined
registerOwner(root: LifetimeRoot, currentConsumerRoot: string): LifetimeOwner
observeRoot(root: LifetimeRoot, currentConsumerRoot: string): "clear" | "obstructed"
reserveOperation(owner: LifetimeOwner, profile: "read" | "write" | "open" | "departure"): LifetimeWork
reserveFD(work: LifetimeWork, site: LifetimeFDSite): LifetimeResource<number>
reserveDir(work: LifetimeWork): LifetimeResource<Dir>
reserveDB(work: LifetimeWork, site: LifetimeDBSite): LifetimeResource<DatabaseSync>
armInvocation(work: LifetimeWork, role: "body" | "inspection" | "fence"): LifetimeInvocation
checkoutAfterBegin(cell: LifetimeResource<DatabaseSync>): LifetimeCheckout
borrowCheckout(lease: LifetimeCheckout, work: LifetimeWork, root: LifetimeRoot,
  fence?: LifetimeFence): LifetimeBorrow
requireTaskLifetime(): TaskLifetime // module export, noncreating; absence refuses
```

Resources expose `capture(value)`, `cancelUnacquired()` and `close()`; invocations expose `observe(original: Promise<unknown>)` and `threw()`.
The `armInvocation(work, "body", "retained-source-return")` overload returns the preallocated negative `LifetimeSourceReturn` (`observe(returned: unknown)`, `threw()`); [Source Host](../frontend/task-source-guidelines.md) owns its synchronous composition contract.
Checkout exposes `borrow(work, root): LifetimeBorrow` and `close()`; a borrow exposes `release()`.
`reserveChildren(parent, "inspection-unwind" | "handoff")` returns two exact `LifetimeChild` handles; `enterChild`/`cancelChild` consume their respective transitions.
`assertCurrentWork(work, root?)`, `retireWork`, `finishWork`, `retireOwner(owner, expectedOpen?)`, `enterGuard(work).leave()` and `beginCleanup(work)` own negative lifetime transitions only.
These trusted code-owned handles are exact object membership, not JSON permits, caller closure flags, host authentication or SQL proof.
No new environment key, model wire or durable schema exists.

## 3. Contracts

### Wire, identity and privacy

Every envelope is `{formatVersion:1,op,payload}`, recursively closed with required keys; nullable means required `T|null`, not omission.
`Clocks = {intentRevision,recordRevision,eventSequence}`; `Pin = {clocks,sectionHash,totalBytes}`.
The four B payloads are:

- `authoring-view`: `{section,pin,offset,limit}`.
- `propose`: `{expected,intent,decisions,materials}`.
- `artifact`: `{expected,material}`.
- `retry-publication`: `{expected}` — no group/path/operation selector.

Every B operation, including view, requires explicit live attachment.
The pure decoder allocates no IDs and touches no I/O; installer preparation tries strict A, B, then C before SDK cloning, using a fresh combined schema.
Independent hook/execute decoding cannot infer attachment from accepted JSON.

Local items/refs are `{kind:"local",key}`; current retained items/refs are `{kind:"existing",id}` in the correct task/namespace and still included in the replacement.
Handles match `[A-Za-z][A-Za-z0-9_-]{0,63}` and are request-unique.
Source refs name existing checked genesis/receipt UUIDs usable as context, not new evidence or agreement.
Artifact refs are exact current `{kind:"existing",role,path,sha256}`, request `{kind:"material",key}`, or `{kind:"generated",role:"decisions"}` when this proposal generates that projection.
Changed references must explicitly rebind or disappear.

Intent reuses the durable vocabulary: code acceptance/checks/nullable draft versus research/diagnosis objectives/evidence requirements.
Structured verifier proposals forbid caller IDs and recursive `executionBindings`; they never execute or certify PASS.
Two-pass resolution budgets placeholder-resolved data before real UUID allocation; preserve draft identity/revision and unchanged same-position verifier children.
Reject stale/dangling/cross-kind/cyclic refs; fixed kind and nondecreasing depth, with declared impact forcing expanded.
Unanswered required inputs remain incomplete planning.
B adds only new **proposed** decisions, retains all versions/statuses and derives all current proposed blockers.
Carry private agreements only for unchanged exact subjects and historically valid checked sources; changed subjects lose the binding only in the new intent.
No caller status/agreement/blocker/lifecycle setter or paraphrase acceptance exists.

View sections: `intent-core`, `inputs`, `acceptance`, `checks`, `draft`, `objectives`, `decisions`, `sources`, `artifacts`, `publication-status`, `allocations`.
Wrong-kind sections reject; absent initial intent is explicit null.
Sources expose only `{id,kind,status,usableAsContextReference}`; agreement projection contains subject/source IDs, not quotations.
Latest decisions retain superseded facts/blockers; inventory is desired bytes, not current-file proof.
Allocations omit material/publication namespaces and operation IDs.
Never forward private seed/background/request/history/locator/binding/receipt/approval/prepared payloads or `authoringFacts`/checkpoint objects.

Pages return `{formatVersion,authority:"context-only",section,pin,startByte,endByte,nextOffset,text,encoding:"canonical-json-escaped",readiness:"not-assessed",implementation:"unavailable"}`.
First page requires null pin/offset zero; continuation pins clocks **and** entire escaped-section hash/length, including outbox-only drift.
Canonical reversible JSON escapes use valid surrogate pairs for non-BMP format characters, unlike A's display-only `\u{...}` spelling.
Concatenate checked UTF-8 ranges before parsing; fragments may split tokens/escapes.
No durable cursor/snapshot lease exists.

### Bounds and managed material

Preserve these independent limits; budget before allocation/BEGIN, never truncate facts:

- 64 KiB wire, each durable envelope and whole SDK result (escaping counts); 128 KiB group metadata.
- 4 KiB narrative; 32 KiB aggregate resolved planning text; **32 KiB total desired publication bytes including generated decisions/index**.
- 16 MiB aggregate expected bytes, bounded before hydration; 256 allocated IDs/group including draft/verifier/publication identities.
- **64 publication members including generated index/decisions**, separately 64 retained artifacts; 63 materials plus index can fit, 64 changed materials plus index cannot.
  Do not widen to 65.
- 1 MiB escaped section, 8192-byte page; durable 64-item/16-reference lists, 128 decisions, 256 receipts and 4096 operations with protected terminal reserves.
- Combined advertised schema fits existing 64 KiB/8192-node/depth-32 registry bounds.

`Material = {key,role,name,expectedHash,text}`.
Fixed roles `brief|requirements|design|plan` require null name and derive `brief.md|prd.md|design.md|implement.md`; research uses a checked portable stem and `research/<name>.md`.
Targets stay below selected `.cadence/tasks/<id>/`; readonly kinds reject `plan`.
Preserve exact UTF-8, one leading BOM, LF/TAB/CRLF; reject interior/repeated BOM, lone CR and other control/format/line separators.
Null expected hash requires no inventory, no target publication history and checked absence; nonnull binds inventory and complete live bytes.
Untracked equal-desired files are not adopted; standalone artifacts cannot change intent-referenced paths, combined proposals explicitly rebind.
Generated full latest `decisions.md` omits source IDs/receipts; canonical next portable `task.json` plus LF publishes last and is not inventoried.
Minimized prose is not universal secret detection.

### Atomic graph, R1/R2 and corrected D1

`openExistingShell` admits only exact retained G2 under checkout before writable task configuration and rechecks the actual connection; no absent/G1 creation/migration fallback.
`authorShell` prepares/bounds before BEGIN, checks retained integrity, runs synchronous code-owned precommit, then same-connection epoch/reservation/state/clocks/hash/barrier CAS/writes and postwrite integrity before COMMIT.
No await/foreign callback separates final admission from the narrow write; nonvoid/thenable precommit refuses.
Intent (proposal only), new decisions, derived record/inventory, separate invalidation, operation/event and outbox commit together.
Operations `authoring-proposal|authoring-artifact` pair with `authoring-proposed|authoring-materialized` events.
Group metadata binds original epoch/clocks/wire digest/allocations, before/after record/intent hashes, decisions, ordered publication links and invalidation IDs.
Wire digest is diagnostic identity, not a replay credential.
Original review/prepared/approval bytes and issuance provenance remain immutable.

Proposal advances intent/record/event once; artifact advances record/event only.
Relevant changes invalidate reuse separately; unbound research preserves it.
Portable title/kind/lifecycle/summary do not change; no-op rejects without facts/IDs/invalidation, and material-only changes use artifact.

**R1 fresh admission:** prove all-state same-target event-ordered outbox lineage with one checked shell owner (source pair at its decision event), expected equal preceding desired bytes, first expected null.
Generated predecessor is `absent` or `index|decisions-b|decisions-source`, binding owner/publication/identity/event/hash/length/checkpoint.
Index requires canonical retained record checkpoints and proved progress/B tails; unsupported legacy gaps block fresh admission.
Decisions use exact historical projections, not regenerated current history; inventory lag needs proved source lineage.
Separately check live target, original claims and aliases; no predecessor adoption/draining.

**R2 historical integrity:** check private checkpoint/BLOB links only through each group's original admission horizon and before-record.
`checkShellIntegrity` reads no project target/claim/alias and never reconciles.
External edits/missing claims leave intact status/view readable while mutation/retry refuses; corrupt private links reject observation.
Future legitimate transitions cannot extend an old group's proof horizon.

**D1 correction:** `checkAuthoringRecordTail` binds today's private record to the latest B checkpoint independently of delivered/pending state.
Subsequent progress must join exact checkpoint bytes and advance revision; source/binding/informational events cannot excuse drift.
Lawful legacy planning advances revision but ends exact-byte proof because it lacks before/after bytes; later progress resumes proof.
Do not fabricate the missing checkpoint, compare every old B record to today's record or inspect managed files to repair private integrity.

### Barrier, retry and publisher

One unresolved B group blocks conflicting writers; earlier non-B pending/conflicting work also blocks B without automatic drain.
Shared barriers cover legacy plan/decision/accepted compound source/progress and foundation revise/intent/settlement, including active publication scope.
Harmless pending/unconfirmed source metadata and necessary binding/departure facts remain allowed.
Publication scope admits only selected ordered IDs; direct B publication/settlement outside it refuses.

Retry selects the latest eligible group with current attachment/epoch/clocks, unchanged post-intent/record digests and only allowed binding/departure/nonaccepted source metadata and historically validated C evidence-request events after it.
This C informational exception does not allow append during an unresolved group or relax B committed/retry witnesses.
Reuse exact IDs/expected/desired bytes and original provenance, not old authority or a new predecessor.
No new proposal/event/IDs; old-CAS resubmission rejects.
Even delivered retry rechecks targets/claims/aliases; Open/status/view/history never publish.
Partial publication/release refusal preserves facts, not rollback or atomic multi-file visibility.

Optional publisher `admit` is separate from fault hooks, runs after callbacks and immediately before parent mkdir/flush, claim rename, exclusive install open, each write/fsync, target link, alias unlink, restoration and settlement.
Revoked mutable cleanup still needs admission; descriptor closure remains mandatory and close failure outranks refusal.
Do not persist admission refusal as content conflict.
Checked `publicationPolicy` derives B recovery: expected-equals-desired still claims/installs and retains the original inode; missing required claims cannot adopt manual desired bytes.
No-guard G1 behavior stays separate and unchanged.
`verifyRetainedClaim` permits newer targets without cleanup; `verifyDelivered` checks current target/claim/alias without reconciliation.

### C questions and nonauthoritative results

The separate closed C decoder preserves B's eleven sections and all A requests.
It accepts the same `{formatVersion:1,op,payload}` envelope:

| Operation          | Required payload                          | Boundary                                                  |
| ------------------ | ----------------------------------------- | --------------------------------------------------------- |
| `request-evidence` | `{expected,objectiveId,question,sources}` | Current research/diagnosis objective only                 |
| `request-review`   | `{expected}`                              | Current planning Intent; incomplete planning is legal     |
| `authoring-view`   | `{section,pin,offset,limit}`              | Section is `evidence-requests` or `planning-completeness` |

All C calls require explicit current attachment; code tasks retain B required-evidence/check proposals, not readonly-objective requests.
`expected` is the unchanged three-clock CAS; `objectiveId` uses SymbolId (`[A-Za-z0-9][A-Za-z0-9._:-]{0,127}`).
Question is 1–4096 UTF-8 bytes; sources are at most 16 unique `{kind:"existing",id:UUIDv4}` same-task genesis/receipt context refs, empty allowed.
No root/task/operation selector, result/fulfilled flag, provider, source acceptance or permission field is accepted.
Descriptor/cycle/sparse/UTF-8/plain-data preflight precedes cloning/allocation: 64 KiB, 8192 nodes, depth 32; no UUID or I/O during decoding.

Retain at most **64 requests including stale**, without eviction; 4096 operation/event and terminal-reservation bounds remain.
Sources retain the existing **256 total including genesis**, not 257; other B caps are unchanged.
A fresh exact semantic duplicate reuses its ID before capacity/UUID allocation but still needs current CAS/epoch/live checks.
Question identity pins full task/Intent revision/hash, objective ID/hash, exact question and sorted source versions; matching a hash alone is insufficient.
Only eventSequence advances on creation; Intent/record/portable/material/outbox bytes do not.

`EvidenceRequestResult` is `{formatVersion:1,authority:"planning-only",clocks,requestId,created,disposition:"requested",fulfillment:"unfulfilled",readiness:"not-assessed",implementation:"unavailable"}`.
Historical rows contain `{id,intentRevision,objectiveId,question,sourceIds,disposition,fulfillment,currentness,staleReasons}`; currentness is current/stale with sorted intent/objective/source-changed reasons.
Changed pins never retarget or fulfill a request; corrupt history is an error, not stale data.
`ReviewResult` substitutes `{requestId,pinHash,disposition:"pending",presentation:"unavailable"}` for evidence-specific fields; it creates no durable review/approval row.

C pages retain B's reversible escaped JSON envelope, 1-MiB section, 8192-byte page and exact clocks/hash/length pin; actual text-only SDK result is at most 64 KiB with `details:{}`.
Null pin requires offset zero; positive continuation must match the whole section and a UTF-8 boundary.
The wire decoder admits `offset === pin.totalBytes`, but the service refuses at/past actual EOF; a page too short for one scalar refuses rather than returning an empty continuation.
The private publication/witness projection is not a public result or an 8-MiB serializer allowance.
[Planning Host](../frontend/task-planning-guidelines.md#c-structural-projection-and-local-request) owns the twenty finding codes and semantic limits; [Observation](./task-observation-guidelines.md#c-managed-material-observation) owns readonly live-file proof.

### Integrated negative lifetime core

`taskLifetime()` peeks; `taskLifetime(true)` may install one immutable, nonenumerable/nonconfigurable/nonwritable own data property on native `node:process`, keyed by `Symbol.for("@abelxiaoxing/cadence/task-lifetime")`.
The last accepted B/C ABI **`cadence-negative-lifetime/5`** has 26 methods plus ABI/intrinsics (28 top-level fields), four intrinsic fields: **32 total descriptors, depth two**.
Current D core uses **`cadence-negative-lifetime/6`** at this same sole anchor, retaining those descriptor bounds; its partial checkpoint below does not inherit acceptance.
Before reflective inspection, `validAnchor` uses native `types.isProxy` at all three boundaries: anchor, intrinsic record and each method.
Frozen/prototype/key/descriptor checks must invoke no getters or proxy traps; an accessor, mutable/partial/unknown ABI or collision is unavailable, never overwritten/migrated or replaced with another symbol.
The first closure retains private Maps across compatible same-build Jiti generations and physical copies; CJS cache, module sets and EventBus are not lifetime owners.

Participation requires main-thread, main-realm native Node: public runtime identity, bounded native-process prototype chain and exact anchored intrinsic references.
Workers, foreign VM realms and Bun refuse owned admission.
Cold initial deployment and **every code/build upgrade** require a cold process restart; ABI equality does not detect same-ABI hot edits or adopt pre-amendment work.
[Planning Host](../frontend/task-planning-guidelines.md) owns explicit refusal handlers; a factory throw is not a host veto.
Unavailable composition may lose ordinary tool availability; unload removes enforcement.
Neither anchor nor handlers are a sandbox.

`resourcesForTaskDatabase` checks the own symbol descriptor first: absence returns `undefined` before runtime/SQLite lookup, including default workers.
Present unusable state refuses rather than silently dropping tracking; compatible state queries exact raw-DB membership, including unknown resources.
Lookup neither bootstraps ownership nor creates storage.
Shared schema readers use it, not a second scope registry.

`LifetimeRoot` binds checked `consumerRoot`, `consumerRootHash`, `productRoot`, `rootsDir` plus current consumer equality; canonical paths/coordinator path are bounded to 4096 bytes.
The core validates tuple shape/hash/layout, not filesystem realpath or host authentication; callers still check actual root.
Limits: **16 retained roots, 64 owners, 256 work cells including child reservations, 64 resources/work**.
One top-level operation per consumer root excludes competing readers/writers; named children alone reenter sequentially.
Idle private tuples may coexist; retained work forbids another private tuple for that consumer, without retargeting old cells.
Unrelated consumers remain independent; nonallocating observation still works at capacity.
`clear` means no recorded obstruction, never attachment, idle, source agreement, permission or settlement.

Fixed ordinary + cleanup resource banks are read **6+6**, write/Open/departure/unwind/provisional/final **16+16**; inspection has no native slots.
The current profiles reach at most 48 concurrent work cells and 32 resource slots/work, below defensive ceilings.
Reserve children/fences before I/O: B/source conditional unwind uses three cells; attached read reserves its departure child; Open replaces its completed inspection/unwind pair with provisional/final phases.
Retired/unknown work consumes capacity; only exact completion and resource-free retired-owner collection free it.
No TTL, eviction, GC, reset or numeric/hash/class-brand completion exists.
Unknown closure may cause bounded-count, indefinite same-root refusal until exact completion or process exit; there is no operator force-clear.
Count caps do not bound the full heap transitively retained by native/foreign Promise closures.

Reserve before actual invocation/acquisition; retain the original native Promise, never `Promise.race`, timeout output or a later successful inspection.
Body rejection can finish that invocation's outcome, not its resources; inspector/fence rejection, throw or unsupported return remains unknown.
A fulfilled resource-free `blocked` inspection refuses this request but can permit later fresh admission.
Late completion may drain only its exact cleanup; it cannot revive authority, resume proposal/publication or restore outgoing tools.
`TaskSessionSettlement` is a reviewed resource-free/no-escape/non-reentrant port, not a runtime classifier or model proof flag.

Native closure and SQL borrowing are owned at [Task Storage's resource boundary](./task-storage-guidelines.md#participating-resource-and-fence-boundary).
Core handles record exact membership, not SQL execution, host lineage or consent.
Parent work survives coordinator release through readonly final checks; a final close error retains process refusal without pretending a physical lock is still held.

## 4. Validation & Error Matrix

- Malformed/coercion/extra keys, illegal refs/material text → `task-record-invalid`; pure wire failure precedes storage.
- Missing/revoked attachment → `task-entry-rejected`; registry drift → `task-tool-conflict`.
- Stale clocks, no-op, unproved lineage, manual content or contention → `task-conflict`, never forced overwrite.
- Unsafe link/path/parent → `task-path-unsafe`; broken private graph/record tail → `task-storage-invalid`, never reset/repair.
- Allocation/output/aggregate publication budget → `task-planning-limit` (wire shape bounds may reject as invalid).
- Real I/O/close/release uncertainty → `task-io-failed`; postcommit failure is not rollback.

C preserves these errors: wrong kind/objective/source or malformed review view → `task-record-invalid`; old CAS/live conflict → `task-conflict`; broken historical links/root/catalog → `task-storage-invalid`.
C limits refuse without a partial green result; closed refusal may permit fresh admission, whereas an actual unknown native close remains anchored.

Errors are value-free, without raw SQL/parser/absolute-path/receipt content.
Success shape is `{formatVersion:1,authority:"planning-only",clocks,publication:"delivered",readiness:"not-assessed",implementation:"unavailable"}`.
This is planning data, not production readiness or B/G2 acceptance.

The negative core returns plain bounded errors: invalid/revoked/foreign handle, root/site/phase mismatch or present unusable DB lookup → `task-entry-rejected`; capacity → `task-planning-limit`; unsafe completion/release/native close or non-Promise invocation → `task-io-failed`.
Bootstrap incompatibility returns `{kind:"unavailable"}`, not a factory throw assumed to veto host work.
No low-level exception/path is forwarded; the integrated installer maps internal ownership refusal to its existing bounded vocabulary.

## 5. Good / Base / Bad Cases

- Good primitive: atomically retain linked intent/blocker/materials, publish index-last, recover response loss via view and exact explicit retry without new facts.
- Base primitive: absent intent is null; unresolved research objectives remain not-assessed; external edits preserve readable intact history but refuse retry.
- Bad: accept a rehashed divergent current record after delivery, derive expected bytes from today's file, remove blockers or silently rebind references.
- Bad host: reload admits Open/retry with an old FD open, or proposal while the original timed-out inspection is unfinished.
  These original H1/H2 assertions now pass and must remain enabled; the old failures stay historical.
- Good core: compatible copies see the same pending original Promise/native cell; actual completion plus resource closure permits a fresh operation without reviving the old one.
- Base core: anchor-free default DB lookup returns undefined even in a worker; two idle private configurations coexist but cannot run concurrent same-consumer work.
- Bad core: treat a fulfilled timeout race, successful later inspection, second close or checkout membership as closure/SQL/attachment authority.
- Good C: response loss followed by fresh clocks returns the exact old unfulfilled request ID, including at the request cap.
- Base C: legally incomplete readonly planning shows missing roles and separate agreement/evidence limitations; no dummy code plan.
- Bad C: call a question evidence, a statement quotation agreement on its separate evidence list, or structural completeness compiler readiness.

## 6. Tests Required

Retain `test/task-authoring-contracts.test.ts`, `task-authoring-store.test.ts`, `task-authoring-controller.test.ts`, `task-authoring-publication.test.ts`, `task-authoring-tools.integration.test.ts` and A/G1/source/native regressions.
Assert schema parity/preallocation, reference/decision/agreement retention, private projection/pins, repeated B/progress/source-lag predecessors, external-conflict readability, barriers and exact retry identities.
D1 includes original rehashed-current-record regression, proposal/artifact × pending/delivered corruption and lawful progress/source/legacy/legacy-then-progress controls.
Publisher tests retain same-byte original claims, per-step refusal/close priority and unguarded G1 compatibility.
Fresh strip-only subprocess cases cover named compound/commit/publication cuts including approval-invalidation/artifacts, **not an exhaustive crash/fence/native-close/power-loss matrix**.

Retain `test/task-lifetime{,-review,-core-regression,-anchor-review,-resources,-worker}.test.ts` and the host suites linked from the planning/session/source guides.
Assert current-shape proxy rejection with **zero traps** at anchor/intrinsics/method, unchanged descriptor, absent-worker lookup versus incompatible refusal, exact-copy/Jiti sharing, reachable caps, root separation, pending original Promise and native FD/Dir/DB before/after-close faults.
A cache hit, second no-op close, FD reuse or GC must not discharge unknown work.
Resource/fence tests must prove actual lock contention and retained original native objects, not counters alone.

Historical task research `planning-b-lifetime-integration-readiness.md` records independent **READY FOR FULL GATES**, not an acceptance verdict.
Its predecessor/component reviews preserve original reds and corrected findings, including D1/H3, proxy bootstrap, source and final Open result correlation.
Original H1/H2 and file-loaded supplements now pass against the integrated composition; the original H2 is inline SDK evidence, not itself a file-loader test.
Physical-copy/independent-SDK evidence carries forward across the final rejection-only proxy correction; it was not freshly rerun as that same scenario.
Actual process evidence is alive checked contender refusal, process exit, fresh SDK explicit Open without replay, then exact retry preserving group/publication bytes and original claims.
No lock availability alone proves external-worker settlement.
Node 22/24, native Windows/macOS, PTY/full CLI, installed-tarball, physical-human and G4 containment remain gaps.
Full review paging/issuer/compiler/executor and whole-G2 acceptance remain deferred; full gates/real pack are separate evidence.

C regressions: `test/task-planning-c-contracts.test.ts`, `task-planning-c-store.test.ts`, `task-planning-c-controller.test.ts` and `task-planning-c-boundary-review.test.ts` assert closed shapes, zero-allocation duplicates, all kinds/findings, runtime review projection, exact-undefined guards, honest results and bound refusals.
Storage/observation/host guides own the deeper fault matrices; focused C1–C3 evidence is not C4/full acceptance.

## 7. Wrong vs Correct

Wrong: compose generic `planShell`, `revise` and publication preparation as separate model-authoring transactions.
Correct: resolve/budget once, use `authorShell(candidate, precommit, materialBytes)`, then publish only the selected group with the same borrowed store.

Wrong: historical integrity reads live files or delivery exempts current-record validation.
Correct: separate private horizon/record-tail proof from fresh admission and explicit retry live checks.

Wrong: delivery checked before store closure remains current through later registry/getter callbacks.
Correct: transfer `scope.setReleaseCheck(check)`; after serialization/all host callbacks, check readonly private witnesses, filesystem stamps and finally pure lease/signal, with no further callback/await before lane return.
This preserves H3, not concurrent-filesystem/SDK-result-hook atomicity.

Wrong: module Map/Set or `pi.events` listeners survive actual reload and safely latch unfinished work.
Correct: the sole compatible native-process anchor retains exact original resources/Promises; fresh owners consult negatives before projection/admission.
A clear result still requires all ordinary currentness and explicit attachment checks.

Wrong: a timeout, wrapper close or fresh owner proves resources finished.
Correct: only the matching first native close's normal return and original invocation completion permit exact cleanup; unknown state remains obstructing through replacement.

Wrong: allocate an operation ID in the controller or route C through B `committed`/retry.
Correct: let `requestShellEvidence` select a fresh-CAS duplicate before allocation and consume its exact same-store seal; only that transition advances C's witness.

## Scenario: D navigation cleanup is not successful phase authority

### 1. Scope / Trigger

`src/task-lifetime.ts` adds purpose-specific ABI6 core phases under the [approved D design §9](../../tasks/09-24-cadence-task-shell-and-approval/research/approved-planning-d-v1/design.md#9-reviewed-cold-incompatible-lifetime-change).
Independent correction review closed L1: failed-but-closed navigation was incorrectly promoted to successful predecessor state.
Regressions now distinguish cleanup from authority; the registrar/host Create/Return loop remains absent, and this is **not Gate 1/D acceptance**.
Accepted ABI5 B/C, original H1/H2/H3/probe history and all prior resource/provenance limits remain preserved.

### 2. Signatures

Current internal `TaskLifetime` methods extend the accepted vocabulary without adding a model API:

```typescript
reserveOperation(owner: LifetimeOwner,
  profile: "read" | "write" | "open" | "create" | "return" | "departure"): LifetimeWork
reserveChildren(parent: LifetimeWork,
  pair: "inspection-unwind" | "handoff" | "return-handoff"):
  readonly [LifetimeChild, LifetimeChild]
retireOwner(owner: LifetimeOwner, expectedNavigation?: LifetimeWork): void
finishWork(work: LifetimeWork): void
```

`enterChild`, `borrowCheckout`/`lease.borrow`, `assertCurrentWork` and resource reservations still authenticate exact private membership, not IDs, labels or flags.
No DDL, durable outcome, public enumerator, new anchor or resource budget is added.

### 3. Contracts

- ABI6 uses the sole immutable `Symbol.for("@abelxiaoxing/cadence/task-lifetime")` native-process anchor; ABI5/6 incompatibility refuses, never overwrites/adopts live state.
  Cold initial deployment and every code/build upgrade remain mandatory; same-build reload is the target, same-ABI hot edits are undetected.
  This spec authorizes no user-process restart; unknown closure and unload limits are unchanged.
- Open/Create `handoff` is provisional → final; Return `return-handoff` is `return-recognize` → `return-outcome`.
  One exact parent plus two sequential children; no third/recursive/purpose-swapped pair or overlapping borrower.
  Inspection/unwind must drain before navigation reservation; fixed read6+6/write-family16+16/inspection0 banks and 16-root/64-owner/256-work/64-resource ceilings remain.
- Return recognition admits readonly observation/reference/header sites only: no checkout/task/probe writer site, either writer-borrow API, or safety-writer fallback.
  Only its exact outcome successor may borrow for the reserved Return write; this still proves no ordinary destination or terminal choice.
- Private phase `finished` means successful normal completion; `released` means genuine cleanup of failed navigation work.
  Retired/poisoned child or observed child/parent body rejection cannot become `finished` merely because resources closed.
  Phase two requires phase one **exactly finished**; canceled/released phases and removed old handles never enable successor entry or writer borrowing.
  Observed parent rejection also blocks pair reservation, phase entry and an already entered child's currentness/borrow.
- Actual original body/resource/fence/borrow closure is still required before removal; pending body/live FD/unknown first close cannot be called `released`.
  Cancel the unused second reservation to drain; close the coordinator only after required child/resource closure, and finish the parent before fresh top-level admission.
  Physical lock availability alone does not remove the parent's process negative.
- `beginCleanup` alone is not failure: a healthy normally completed child can still enable its exact successor.
  Expected navigation retirement of the waiting parent is not child failure either.
  Already admitted failed phases may finish their exact required same-child/same-store fence; that safety path does not restore currentness or cancel a required fence as healthy completion.
- Core handles provide negative accounting only.
  Original callback/manager/rendezvous/phase/deadline proof and reporting host exceptions remain session-owner obligations; unreported exceptions cannot be inferred by the core.
  Failed work's true cleanup permits **fresh admission checks only**, never old attachment, publication, ordinary-tool restoration or successful navigation inference.

### 4. Validation & Error Matrix

| Condition                                                                               | Required result                                                       |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Wrong purpose/order, canceled/released first child, rejected parent, old/foreign handle | `task-entry-rejected`; no successor or writer borrow                  |
| Return recognition requests writer site/borrow/safety route                             | `task-entry-rejected` before native I/O                               |
| Pending invocation/resource/fence or unknown first native close                         | `task-io-failed` on unsafe finish/release; exact obstruction retained |
| Capacity exhausted                                                                      | `task-planning-limit`; no increased bank, eviction or skipped closure |
| ABI5/6 collision or unsupported composition                                             | Unavailable/refusal under existing handlers; no replacement anchor    |

### 5. Good / Base / Bad Cases

- Good: retired recognition closes its real FD, becomes released, refuses outcome, drains the canceled sibling and original parent, then allows a fresh operation.
- Base: healthy original Open/Create phases, including cleanup-bank use, remain sequentially useful after expected parent retirement.
- Bad: `finishWork(first)` is treated as evidence of successful recognition, a rejected parent keeps a writer child current, or a second no-op close clears uncertainty.

### 6. Tests Required

`test/task-shell-d-lifetime.test.ts` covers all three navigation purposes, retired/rejected first and parent bodies at each phase, actual FD retention/closure, old-handle denial, useful later fresh work and recognition refusal at both borrow APIs/resource sites.
Retain healthy cleanup→successor controls, reserved same-store fences, capacity, ABI5↔6/physical-copy refusal and original-Promise/first-close negatives.
`test/task-lifetime-handoff-fence.test.ts` and `test/task-lifetime-open-result.integration.test.ts` retain original fence and saved/unsaved callback assertions.
Independent review passed 113 focused tests plus two selected current Open SDK positives in a separate run; its 15 core probe scenarios are not registrar/terminal evidence or additive full-suite totals.
Combined gates/generated freshness remain open as recorded in [Quality](./quality-guidelines.md#scenario-d-generated-dependency-propagation-and-partial-gates).

### 7. Wrong vs Correct

Wrong: mark every resource-free finished child `finished`, then admit phase two.
Correct: retain failed lineage as `released`; only a normal original phase is `finished`, while true closure still permits future fresh admission.
Root cause: conflated cleanup with authority (cross-layer contract/implicit assumption), not insufficient timeouts.
Apply the regression matrix to Open/Create/Return and both borrow routes; neither blanket permanent poisoning nor treating `beginCleanup` as failure is the fix.

## G3 owned compiler slice: closed draft v2 (unaccepted checkpoint)

### 1. Scope / Trigger

`src/task-execution-schema.ts` owns only the closed SDK wire schema and fixed local definitions.
`src/task-shell-contracts.ts` decodes B execution proposals with its existing plain-data codecs; native storage/physical-copy loading must not acquire a runtime TypeBox/SDK dependency.
`src/task-execution-draft.ts` owns pure durable graph decoding and B-only finite shorthand expansion through `src/implement-compiler.ts`.
No model supplies durable task/check/output IDs, execution bindings, approval IDs or report verdicts.
The controller resolves exact current/local step/check namespaces, derives output IDs from draft identity plus local handles, and persists a closed normalized v2 graph.
Draft v1 is unchanged planning data; `structural` is never silently relabeled `refactor`.

### 2. Signatures

```typescript
// Trusted composition only; no model/compiler selector.
createTaskPlanCompiler(): TaskReviewCompiler
prepare(input: TaskCompileInput, signal: AbortSignal,
  scope?: TaskCompilationScope): Promise<CompilerResult>
validateExisting(pair, signal: AbortSignal,
  scope?: TaskCompilationScope): Promise<CompilerResult>
materialize(receipt: object): { metadata: TaskPreparedSnapshot; bytes: Uint8Array }
assertCurrent(receipt: object, scope?: TaskCompilationScope): void
```

### 3. Contracts

`src/task-plan-compiler.ts` supplies genuine static preparation, exact-receiver/receipt materialization, original-horizon existing-pair validation and synchronous fresh `assertCurrent`.
It is installed only by the isolated registrar, with no runtime compiler selector.
Canonical JSON plus LF is the byte identity; graph hash is distinct from plan/raw byte hashes.
Permissions v2 include actual effects, dependency names, scheduled verifier occurrences, evidence timing, bounded original recovery declarations, profile/environment hashes and observed inputs.
No verifier or business process runs, and no execution authority is minted.
Planning evidence is current inspected bytes with meaning unassessed; future report evidence is not-run and cannot be substituted by a model PASS.

`TaskCompilationScope` carries exact selected task/root, original `LifetimeWork` and checkout, the pure original-family checker, actual private roots, inspected artifact roles/bytes and retained source excerpts.
Native observations reserve existing FD/Dir capacity before opening, retain first-close uncertainty, bound observations/bytes and recheck environment/profile.
Do not replace these with default untracked capability snapshots, open another task store or claim filesystem/SQL atomicity.
The current-input callback precedes repeated original-connection release witnesses and pure consume/CAS in the existing review transaction.
This changes no lifetime ABI, bank, catalog or durable execution lineage.

### 4. Validation & Error Matrix

- Draft v1: unavailable planning-only result; no prepared receipt.
- Wrong receiver/receipt, changed existing pair/bindings: `task-conflict`; no re-sealing of refreshed bytes.
- Non-code/malformed v2 input or wrong selected task/root: bounded refusal; no usable derivation.
- Other managed task/private/admin input: `task-path-unsafe` before opening.
- Canceled/retired/expired original work: entry refusal, with original pending body/resources still accounted.
- Native first-close failure: `task-io-failed` in existing native ownership paths; retained exact uncertainty, never retry-close or reset as proof.
- Observation/byte/resource exhaustion: refusal under existing caps, never truncate inputs or increase banks.

### 5. Good / Base / Bad Cases

- Good: current code v2, exact delivered roles/bytes, covered completion occurrences, fresh static observations and final original-connection witnesses.
- Base: unchanged v1 and readonly proposals remain planning data; no pseudo compilation.
- Bad: label a future report PASS, relabel structural to refactor, reuse stale bytes or treat a domain string/receipt as launch authority.

### 6. Tests Required

`test/task-execution-draft.test.ts`, `test/task-plan-compiler.test.ts` and `test/task-plan-compiler-resources.test.ts` cover DTO parity, direct genuine preparation/currentness, evidence timing, detached exact receipts and native uncertainty.
The initial real SDK terminal file had two expanded-review deadline failures, retained in `research/owned-slice-handoff.md` and external logs.
The subsequent `research/compiler-independent-review.md` records the complete 13-case pass at unchanged deadlines after narrow pure-decoding fixes, including genuine late-drift/cancellation and original native-close negatives.
Controlled terminal choices are not full CLI/native terminal proof; neither this slice nor earlier fixture positives supplies execution lineage or complete G3 acceptance.
Excluded paths now refuse before the first native safe-path stat, not merely before opening an FD.

### 7. Wrong vs Correct

```typescript
// Wrong: replay old timing/capability success or import the SDK into storage.
// Correct: re-observe through the original scope; keep wire schema separate.
service.assertCurrent(liveReceipt, compilationScope);
// Then repeat original-connection witnesses before pure consume/CAS.
```

The separation preserves native physical-copy membership and prevents a stale static result from acting as a currentness oracle.
No generic cache, second store, new certificate selector or execution admission is authorized by this checkpoint.
