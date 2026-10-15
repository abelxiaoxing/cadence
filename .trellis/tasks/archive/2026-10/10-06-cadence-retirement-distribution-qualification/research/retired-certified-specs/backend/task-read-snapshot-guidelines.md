# Task Read Snapshot Boundaries

Original-owner contracts supplement [Task Distribution and Retirement](./task-distribution-guidelines.md).

## Scenario: approved original-readonly facts consolidation

### 1. Scope / Trigger

Use only inside the original selected readonly observation in `src/task-shell-storage.ts` (S) and its fixed `src/task-completion-storage.ts` (G) continuation.
The user explicitly approved removing the two duplicate C-facts traversals and the native failures detectable only there.
This is an implemented, independently reviewed data-flow change, not unchanged native fault parity, a passing deadline or release qualification.
Earlier investigation-only/pending-decision reports remain historical.

### 2. Signatures

- Private S `observe` owns readonly construction/open, `BEGIN`, catalog validation, selected integrity, projection and original first close. `observeTaskContext(state, request, work?)` enters it; full foreground guards create fresh observations; scoped publication live guards follow [Publication Admission](./task-publication-admission-guidelines.md).
- Private `checkSelectedTask(db, rootHash, task, allowReferenceConstruction, ownedQueries?, completionObservationCall?)` carries the invocation only on the original-observer hop.
  Existing strict wrappers cannot supply it.
- S `consumeCompletionObservationCall(call: object, db: DatabaseSync, rootHash: string, task: string): void` consumes only; there is no exported mint or acquisition API.
- G `checkTaskCompletionObservationRows(call: object, db: DatabaseSync, rootHash: string, task: string, queries: IntegrityQueries): void` consumes synchronously first, then enters private `checkCompletionRows(..., "original-observation")`.
- `checkTaskCompletionRows(db, rootHash, task, queries?)` still enters that same private body in `"strict"` mode. `selectTaskCompletionBasis(...)` retains its original acquisition order.
- Private `checkCurrentSnapshot(rootHash, snapshot, facts, queries?)`, `observationReadonlyBasis(...)` and `readonlyBasis(...)` share comparisons and the readonly basis remainder; they are not public data/permission providers.

Stored `TaskReadonlySnapshot` is an objective/source contract, not a native SQLite transaction capability.
No production environment selector chooses the reduced route.

### 3. Contracts

Plain `BEGIN` acquires the read horizon only at its first database read.
The original observer reads the catalog before selected G5 integrity.
An independent WAL commit after acquisition is already invisible until a later observer; repeated reads in that transaction are not a newer external horizon.
Readonly construction is not an OS sandbox.
A handle, `isTransaction`, `query_only`, frozen/query fields or a separate checkout coordinator does not authenticate the original invocation.
A supported callback/await/write/transaction restart/handle escape introduced into this segment invalidates its reviewed ownership argument.

S alone mints an empty object key in its selected-G2 branch after original constructor/open/BEGIN/catalog success.
A module-private `WeakMap<object, Readonly<{db, rootHash, task}>>` binds that invocation, not DB/path/stat/generation/receipt or a successful verdict.
The key travels only along the fixed private S→G call, never into native/host/decoder/public/query arguments or returned data.
Consumption uses lookup and **delete before binding comparison**, without token/context/DB reflection; wrong bindings burn the original key.
The S selected-call finally deletes pending keys even on no-Completion/early failure, before projection and first close.
Nested observers own independent keys; strict reentry cannot borrow one.
No module-initialization call, exported issuer, generic callback registry or public skip flag is permitted.

G consumes before its first native operation, then executes the complete first `readShellPlanningCFacts` at the original site.
Only after normal completion do those immutable facts become local input for two later readonly comparisons; neither in-progress data nor facts/verdict/basis/closure survives the call.
The completed-readonly branch alone uses `observationReadonlyBasis`; code/no-history/no-Completion behavior remains strict/unchanged.
The later readonly snapshot/source-horizon read still runs before the extracted comparisons.
The basis remainder still checks all requests, fulfillments, observations, objectives and canonical hashes.
Assessment index/verdict, Completion/group/publication/ack/event/orphan/byte totals, outer knowledge/shell integrity and final file/dev/inode checks remain distinct.
Original query-template restoration, locally owned clear and error/first-close precedence remain.
The shared 64-entry/4-MiB original-codec budget and public-copy/parser contracts are unchanged; this local facts continuation is not another cache.

Standalone, audits, `ShellExecutionRead`, writable/autocommit and after-guard routes retain the B1–B3 strict query oracles.
A writer sees its own changes inside `BEGIN IMMEDIATE`: preguard/postguard/postwrite checks cannot be consolidated.
No snapshot/key/facts crosses observer close, host callback, publication file effect, delivery transaction, acknowledgment family or subsequent observation.
Every retained native failure still fails closed.
Failures possible **only** at the deleted duplicate traversals have no replacement detection guarantee; do not insert a dummy SELECT or hide the divergence in an error filter.

### 4. Validation & Error Matrix

| Condition                                                                                  | Required behavior                                                                                        |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| Forged/copied/proxied/frozen/foreign-module key, wrong DB/root/task, consumed/replayed key | `task-storage-invalid`, no token/context getter or native operation; wrong binding burns the genuine key |
| Early selected/catalog/handoff/G5 failure or absent Completion profile                     | Pending key removed before projection/close; no in-progress facts retained                               |
| Corruption before acquisition or visible to the next observer                              | Original bounded refusal; facts success alone is not G5 success                                          |
| Independent commit after acquired snapshot                                                 | Original old view remains; next observer must independently validate                                     |
| Autocommit or owning-connection mutation                                                   | Strict later reads remain fresh; no reduced route from supplied queries                                  |
| Later assessment `basis_hash`, request/fulfillment or knowledge mismatch                   | Original later validation refuses, including paired-fault ordering                                       |
| Retained prepare/get/all/iterate/next/return/open failure                                  | Original fail-closed behavior; no permission or successful basis from error                              |
| Original return/close throws before or after syscall                                       | One attempt; preserve exact uncertain original, no retry or generic teardown settlement                  |
| Removed-only second-facts synthetic failure                                                | Explicit old refusal/new call-absent divergence, not physical EIO proof                                  |
| Original 5000/1500/60000-ms deadline exceeded                                              | Failed qualification even when original assertions finish later                                          |

`closeObservation` retains `TaskPlanningError("task-io-failed")` precedence; the public context boundary projects it to `task-storage-invalid` while the lifetime owner retains uncertainty.

### 5. Good / Base / Bad Cases

Good: independent commits stay hidden in the original snapshot and fail the next observer; a first-facts success cannot hide the later assessment-index refusal.
Base: the bounded completed-readonly fixture changes three facts traversals to one.
Its 3161→2357 native trace removes exactly804 tagged operations (114 prepare,464 get,40 all,58 iterate,128 next); every retained operation, including preparations, matches in order.
These finite counts are not a global SQL or timing theorem.
Bad: infer a stable native snapshot from a flag, reuse first-pass facts across a host guard, call a lost duplicate-only fault equivalent, or report late original bodies as clock passes.

### 6. Tests Required

`test/task-completion-snapshot.test.ts` and its excluded original-URL helper provide the additive observer oracle.
Run the complete file with `CADENCE_G5_SNAPSHOT_ORACLE` pointing to authenticated immediate-B3 preimages; current-only execution makes no differential claim.
Keep exact original/candidate construction/open/BEGIN/catalog/projection/first-close traces and the removed-site ledger, separate from existing strict oracles.
Required controls include key forgery/binding burn/foreign instance/replay/early cleanup, same/different-observer and strict reentry, before-first-read/mid-snapshot/next-observer DML/DDL, paired assessment failure, retained native faults and participating open/return/close uncertainty.
The helper's hooks are excluded instrumentation, not product authority or arbitrary-JS containment.

The seven-case reviewed file additionally builds a genuine request-linked completed readonly task, retains a quotation-backed knowledge candidate and collects an exact1048576-byte whole source.
The same B3/candidate fixture proves ordered native parity and refusals for rehashed fulfillment requestHash, knowledge payload hash and1048577-byte retained evidence corruption.
The corrupting writer alone disables its CHECK constraint for the last case; otherwise the mutation fails before the observer and proves no observer bound.
This is one populated profile, not exhaustive maximum-row/history/aggregate-byte/completed-code cross-product coverage.
Completed-code branch behavior is unchanged by inspection and covered by separate complete code/control suites; do not claim a new additive code-handoff oracle.

Keep complete `task-completion-codec`, both integrity-query files and explicit pre-B1/B1-B2 oracles: legacy729/G5 1951 native reads, narrow prepare/get exception, mutable/savepoint/autocommit/reentry/fault/return controls remain strict.
Keep complete compiler/Completion/crash/code/knowledge/observation/resource/first-close files and the original departure bodies/deadlines/cap4.
Counts from overlapping commands are not added into full verification.
The historical snapshot-only departure was5 passed/11 failed at5000 ms, with all eleven late originals awaited and four unknown families retained.
The later separately approved publication simplification passes16/16 locally; see [Publication Admission](./task-publication-admission-guidelines.md), not a retroactive snapshot timing pass.
Independent review authenticated that unchanged run rather than retrying it after test-only observer additions.
Fresh source/extracted package/native/PTY checks bind changed shipped bytes; trusted peer linkage/no-model POSIX PTY is not manager install, human/model full-loop, Windows, physical EIO or power-loss proof.

### 7. Wrong vs Correct

```ts
// Wrong: a matching handle and complete facts are not snapshot ownership.
if (db.isTransaction) return previousG5Success;
// Correct: existing public/writer paths always retain their strict acquisition.
checkTaskCompletionRows(db, rootHash, task, queries);
// Only the private original observer can mint the one-call key. The fixed
// G entry consumes it before native work, then validates facts normally.
```

Prevention: distinguish stable-view equivalence, distinct validation and eliminated native fault opportunities.
Preserve old fault evidence, authenticate exact preimages and add a separate observer relation instead of weakening the strict oracle.
Do not stack another cache or infer a passing clock from fewer calls.
