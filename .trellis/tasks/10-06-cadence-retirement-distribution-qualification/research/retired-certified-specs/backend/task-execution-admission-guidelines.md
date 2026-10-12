# Original Execution Reader Admission

[Application Authority and Readiness](./task-application-readiness-guidelines.md) extends only the named application launch/materialization authority calls and genuine zero-owned-effect input continuation.
Its strict entry/transaction and fresh native-input requirements narrow the earlier blanket application exclusion below; no other cut changes.

## 1. Scope / Trigger

The user-approved G4 usability continuation separates static declarations, live private authority and effect-boundary native inputs in the **original engine reader**.
It supplements [Distribution](./task-distribution-guidelines.md), not a new public permission API.
[Publication](./task-publication-admission-guidelines.md) and [Readonly Snapshot](./task-read-snapshot-guidelines.md) retain their separate contracts.

Supported G3 writers use the original coordinator/checkout borrow.
Active direct external private-DB tampering is unsupported: unrelated historical corruption and errors possible only at deleted intermediate scans need not be detected at every no-effect poll.
Discovered corruption still refuses.
Current revocation/head/plan identity never waits until a launch.
External business-input drift at omitted polls must refuse at the next retained pre-spending/preparation/worker/verifier/spawn/apply boundary before its effect.

This is a scoped detection-timing/native-fault-footprint change, not old/new query parity or a passing deadline.
Standalone, amendment, writer, recovery and journaled application APIs remain strict.
No schema, receipt, executable hash identity, approval, scheduler, capacity, budget or clock changes.

## 2. Signatures

- `TaskEngineStorage.admissionReader(storage, state, compilation)` admits one original readonly `TaskStore` under the existing engine borrow.
- Captured-prototype `admitTaskExecutionReader(selected, held)`, `checkTaskExecutionBinding(held)`, `checkTaskExecutionInputs(held)` call only their original `TaskStore` methods/private receiver.
- `TaskStore.admitExecutionReader(selected, scope)` performs full original selection/lineage/compiler observation and post-observation reselection; retains one private head's declarations, detached scope data and comparison identities.
- `TaskStore.checkExecutionReaderBinding(scope)` checks original work/borrow/scope, fresh bounded current shell rows and exact current revision/plan bytes. `checkExecutionReaderInputs(scope)` brackets fresh declaration-driven observation with that check.
- `readShellExecutionCurrent(db, rootHash, task)` and `assertTaskExecutionHead(db, rootHash, selected)` are fixed internal current-row readers, not substitutes for public strict selection.
- `prepareTaskExecutionInputs(selected, scope)` retains normalized declarations after strict build; `assertTaskExecutionInputsCurrent(data, scope)` reruns native algorithms.
  Their plain data confer no reader/work/approval authority.
- `WorkflowEngine.assertTaskMaterializationCurrent(runId)` is the fixed binding-only method; `assertTaskOperationCurrent` remains the full effect-boundary check.
- `DurableWorkflowEngineOptions.assertMaterialization?` is wired only from the captured original engine method.
  The four phase/three change materialization acquisitions fall back to `options.assertLaunch` **with its original receiver** when absent.

## 3. Contracts

### Engine selection ownership

`WorkflowEngine.#taskControl` synchronously takes its single defensive selection copy **before** the deferred body or foreign guard.
Full entry validates that same copy.
The permit, engine binding, recovery keys, worker graph and application branch all use it; none returns to caller-owned selection data after admission.
Worker requests remain defensive copies.

The private reader's successful currentness check does not compare arbitrary engine selections.
A frozen `selected.prepared` child does not freeze the public parent, revision/recovery arrays or plan bytes.
Rehashing caller mutations can satisfy engine row consistency without authenticating approval.
The review's reached entry-guard/bind-guard/lease tests demonstrated an unapproved worker write path before this ownership repair.
Do not restore expensive full selectors at every launch to compensate for a caller-alias bug.

### Reader lifetime and supported writers

The reader retains one original scope and head.
Copied receivers/scopes, foreign work/checkout, missing entry, concurrent initialization and closed/uncertain owners refuse.
Different approved heads require normally closing the old owner and fresh full admission; legitimate technical amendments do not silently update an active reader.

The original borrow/coordinator excludes supported G3 authoring, review, Return, Completion, knowledge and schema writers, including another physical module copy and async/pending work.
The separate G4 control/ledger/apply databases continue to commit original leases, spending and effects.
They are not frozen by this optimization.
Negative fencing/revocation remains immediate.
No DB snapshot spans a host callback or await.

`close()` clears admission and codec data before original close.
Uncertain native close leaves the exact original family retained; no retry, reopen, PID disappearance or later successful diagnostic repairs that uncertainty.

### Static data and bounds

Only original strict-selected/compiled normalized declarations and expected identities survive in private fields.
Initial and derived admission retain full plan/coverage/permission/lineage checks.
Recursive freezing is applied to newly owned data, not used as proof that arbitrary input is trusted.

The scope is detached once: at most258 private roots,64 artifacts and256 sources, with separate16-MiB aggregate artifact/source byte caps checked before copying.
Capture each array and checked count once, then copy bounded indices without caller iterators or repeated array getters.
Use the intrinsic typed-array byte-length accessor and intrinsic `set`, as at strict review preparation: a shadowed `.byteLength` and `Uint8Array.from` can otherwise allocate beyond the checked cap or invoke a foreign iterator.
Detached buffers refuse before observation; no partially initialized admission is retained.
Roots still undergo original path/4096-byte checks; retained source IDs/duplicates and source bytes still enter original validation.
Plan bytes remain at most16 MiB; revisions remain64 KiB/4096 generations.
This one-reader data lifetime is not another multi-key cache.
Existing original-codec64-entry/4-MiB charging, strict parser behavior and public copies remain unchanged.
Arrays, artifact/source byte buffers and later caller getters do not alias the private continuation; root/task/review-depth/work/checkout scalar identity still stays live.

### Fresh live and input cuts

Live checks read current local/record/reservation/session/binding/root/Intent/review/approval, event/operation/Intent counts and tails, invalidation and publication barrier.
Current payloads are SQL-byte-gated before hydration, hash-checked with indexed columns, and compared to admitted values.
Head, revision count/sequence, revision metadata and exact freshly hydrated plan bytes stay current.
No claimed hash or unchanged head alone is enough.

The input continuation starts from original **declarations**, never replay of an old filename list.
It reruns original readiness/input timing/verifier protection/capability occurrences, scope/source bindings, artifacts, manifest/scripts/locks/configuration, PATH/PATHEXT/profile/environment, safe ancestors, absence/kinds/symlinks and search/glob membership.
It reads complete current executable bytes even for equal size/restored mtime, path or PID.
No positive native result, permission, relational/currentness or first-close verdict is retained.

`observeTaskPlanInputs` retains its original per-I/O pure scope check, work-currentness check, bounded operations/bytes/rows, pre/open/post identities, sticky failure and first-close owner.
Do not reintroduce whole reader admission per64-KiB chunk.
Whole observation is bracketed by reader live checks; supported callbacks/awaits keep their existing fresh guards.

Only scheduler polling, task entry and seven named materialization acquisition callbacks are binding-only.
Entry/control binding, actual preparation and after-await, pre-reservation (including initial/denied/granted paths), separate post-reservation worker, context verification, verifier/environment/spawn and application remain fresh.
Changed inputs spend no next attempt; failure after reservation never refunds it.
Thirty-work limits, FIFO/shared cap4 and1500-ms refill remain.

Baseline capture, candidate/Git/process `assertForeground`, ApplyTransaction `post-apply-verification-` materialization, independent reports/seals/CAS and every business-file application guard are **excluded** from the cheap route.
Do not globally replace `assertForeground` or widen cuts to fit a deadline.

## 4. Validation & Error Matrix

| Condition                                                                       | Required result                                                                                                             |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Original caller selection mutated by guard, lease callback or pending microtask | Engine uses its admitted owned copy; next explicit entry with altered data refuses; no altered worker scope/recovery ledger |
| Copied receiver/scope, wrong work/head, missing/closed entry                    | Bounded refusal before launch/spending                                                                                      |
| Current row/index/bytes/counter/revocation drift or oversize                    | Immediate binding refusal; no full-history PASS memo                                                                        |
| Business/config/search/environment/executable drift after admission             | Mandatory next effect input check refuses; no next spending/worker                                                          |
| Post-reservation signal/input drift                                             | Separate launch check refuses; original attempt remains spent                                                               |
| Caller array/getter/buffer changes                                              | Cannot change privately owned declarations; scalar drift refuses                                                            |
| Unsupported active private history mutation                                     | No immediate poll-detection guarantee; strict discovered corruption still refuses                                           |
| Retained native read/open/close failure                                         | Original fail-closed behavior and exact unknown family, no retry                                                            |
| Original5000/1500/60000-ms limit exceeded                                       | Failed qualification even when original body later fulfills                                                                 |

## 5. Good / Base / Bad Cases

Good: one strict static build, fresh current head at every poll and fresh image bytes before spending and worker invocation.
Base: the finite one-unit regression measures one static build/six native image reads instead of nine whole builds; it is not a full-engine latency guarantee.
Bad: check the reader's original facts, then bind a separately mutable caller graph; use path/stat caches; weaken journal application checks; label an awaited late body passed.

## 6. Tests Required

`test/task-execution-reader.test.ts` covers genuine original-reader initialization/close/copies, captured methods, physical-copy writer exclusion, separate G4 writes, derived/initial ordered input traces, current-row/head/counter bounds, scope-copy caps/getters/intrinsic byte copies, negative search, disposable same-size/restored-mtime executable bytes and original before/after FD/DB close uncertainty.
Engine guard/bind/lease/pending-microtask controls must mutate the **actual original caller object**, authenticate an unchanged stored revision/spending count and worker graph, then refuse changed explicit Continue.

Keep complete runtime-repair/admission/amendment/execution-store/crash/compiler/continuation/capability/native/currentness/resource suites.
The four runtime drift controls preserve pre-reservation refusal and additionally retry explicit Continue; a no-effect paused projection is not new authority.

Strict legacy729/G5 1951 read oracles, B3 codec/budget/refusal controls and the separate readonly snapshot oracle are unchanged and require their explicit authenticated original preimages.
Do not filter errors or repurpose strict fixtures to qualify this new route.

Complete engine44/execution36/lifecycle9/departure16 run unprofiled at original cap4/clocks, supervising exact original late bodies.
Actual full verify, new real126-member body/pin audit, source/extracted native and production regular/fullscreen PTY evidence remain separate gates.
No focused sum, extracted peer link or no-model PTY proves installed human/model, native Windows/manager, physical EIO/power-loss or universal release readiness.

## 7. Wrong vs Correct

```ts
// Wrong: reader checks one private graph while engine binds another caller graph.
admitTaskExecutionReader(selected, held);
guard();
const permit = { selected: structuredClone(selected), held };
// Correct: own once BEFORE deferral/callbacks, validate and use that exact value.
const owned = structuredClone(selected);
// Later original entry: admitTaskExecutionReader(owned, held).
// Permit, revision binding, recovery and application all keep owned.
```

```ts
// Wrong: a cheap acquisition callback replaces every foreground/effect check.
options.assertForeground = cheap;
// Correct: only named materialization sites choose the fixed callback.
(options.assertMaterialization ?? options.assertLaunch)?.call(options, runId);
```
