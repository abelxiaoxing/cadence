# Completion Publication Admission

## 1. Scope / Trigger

Owns the user-approved private-writer boundary in `task-session.ts`, `task-completion.ts`, `task-store.ts`, `task-shell-storage.ts` and `task-completion-storage.ts` under `src/`.
Only Cadence protocol-governed writers are supported during active private SQLite publication.
Unrelated external history mutation need not be detected at every file I/O; entry, recovery and pre-acknowledgment audits still refuse discovered corruption.
This deliberately changes detection timing and removes native failure opportunities unique to deleted audits.
It is not old/new native parity.
Business-file manual edits, original terminal approval/revocation, claims/CAS, retained native failures and first-close ownership remain protected.

## 2. Signatures

- `finalizeTaskCompletion(state, task, guard, observeWork?, publicationGuard = guard)` and service `complete`/`finalize` forward the internal live guard only to publication.
- `TaskStore.withCompletionPublicationScope(state, task, guard, body, publicationGuard = guard)` owns entry admission and the existing awaited scope.
- Private `#transaction(action, fence?, completionSettlement?)` rejects ordinary writes inside that scope before `BEGIN`; only `settle` supplies the selected result/archive ID.
- `readShellCompletionPublicationCurrent(db, rootHash, task)` reads current binding rows without catalog/history traversal.
- `readTaskCompletionPublicationCurrent(db, rootHash, task, selected)` and `assertTaskCompletionPublicationCurrent(db, rootHash, task, selected, entry, operationId)` perform fixed fresh owning-connection comparisons.

No schema, environment policy, store/controller, generic permission provider or transaction spanning await is added.
The deleted `taskCompletionPublicationWitness` has no remaining production caller.

## 3. Contracts

Completion's live guard runs actual host, mode/UI/idle/queue, leaf and locator callbacks before its pure original action/generation/revocation/work tail.
The full guard additionally observes selected history and repeats that pure tail.
Entry, post-publication-family and acknowledgment retain full guards; knowledge, collection and other operations do not inherit the cheap route.
Omitted publication callbacks default to the full guard.

The scope captures selected immutable Completion/group data and a current binding tuple, not permission or a successful validation cache.
Install exclusion before entry callbacks; clear only in the original awaited body's `finally`.
All ordinary same-store SQL/schema writers reach the private transaction gate, including async imports/prebuilds resumed during the scope.
Only exact selected delivery/conflict settlement and the original authenticated negative safety fence may write.
The fence retires permission; it cannot bless subsequent publication.
Authoring, knowledge and Completion scopes reject nesting symmetrically, including active transaction entry.
Other stores retain original physical coordinator and exact lifetime borrow exclusion; raw independent SQLite writers are outside that protocol.
Cleanup/close remains available and cannot manufacture normal first-close settlement.

Each actual admission rechecks original scope/work, enters/leaves its original guard frame, runs the callback, and then reads current rows on the owning connection:

- Local root/task/state, intent revision, event sequence, binding epoch, review and approval IDs.
- Reservation identity/session/consumed slots; session outcome and candidate locator; binding epoch/session/locator; portable record bytes/revision/lifecycle.
- Fresh Completion/group payload bytes, hashes and indexed identities, membership and acknowledged bit.
- Exact result/archive task/path/expected/desired identities, sequence ordering and states.
  Result must be delivered before archive; acknowledged retries require both delivered.
  A delivered original cannot regress.

Existing bounded decoders and byte gates remain.
The three group-index IDs are SQL-gated to exactly36 BLOB bytes before hydration, as is the Completion ID; never allocate an oversized index value merely to compare it afterward.
Archive mutation still reacquires current delivered-result/claim proof after callbacks; read cuts check that original proof.
Filesystem publisher, CAS, claim and flush algorithms are unchanged.
Original family normal closure precedes the private publication receipt and separate acknowledgment transaction.
Files delivered with corrupt history remain unacknowledged/pending privately; no reset or automatic overwrite follows.
Strict standalone, writer/after-guard and independent knowledge audits retain their own contracts.
The original-readonly snapshot exception remains separately owned by [Snapshot Boundaries](./task-read-snapshot-guidelines.md).

## 4. Validation & Error Matrix

| Condition                                                       | Required outcome                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------- |
| Ordinary same-store mutation or nested scope during publication | Refuse before transaction/mutation; unchanged rows/files         |
| Async writer resumes inside scope                               | Same gate; no schema writes or writer guard call                 |
| Exact selected settlement with live admission                   | Original monotonic transition only                               |
| Authenticated reserved negative fence                           | Fence allowed; retired publication refuses                       |
| Stale leaf/locator/generation/work or callback close            | Refuse next effect; no revived permission                        |
| Current row/index/identity/state mismatch                       | Bounded invalid/conflict refusal                                 |
| Unrelated raw historical drift after result delivery            | May deliver archive; recovery/pre-ack refuses, no acknowledgment |
| Native prepare/get/I/O/flush failure                            | Existing bounded refusal; no silent fallback                     |
| First close throws before/after syscall                         | Retain exact unknown original and namespace; no retry-close      |

Native exceptions in publisher boundaries may project to `task-io-failed`; corruption caught by the retained decoder remains `task-storage-invalid`.
Neither error proves closure.

## 5. Good / Base / Bad Cases

Good: one entry history audit plus live guards and fresh fixed current rows at file cuts, with full pre-ack audit after original normal closure.
Base: an old caller omits the new callback and continues using full guards.
Bad: memoize approval/basis/closure, retain a SQL snapshot across await, or silently restore broad per-I/O history work to handle unsupported external writers.

## 6. Tests Required

`test/task-completion-publication.test.ts` covers no per-I/O history audit, entry/ack checks, current rows, supported-writer exclusion, pre-entry async continuation, exact settlement, symmetric nesting, physical contention, negative fence, pending/acknowledged retry, manual edits, native failures and three oversized indexed IDs.
Fault writers must complete their actual mutation before setting reached flags.
Disable foreign keys only in the isolated corrupting connection where necessary; otherwise an FK failure can masquerade as reader validation.
The index hydration controls must fail on the unbounded preimage and pass with native results null, not merely assert eventual refusal.

Keep complete controls/contracts/crash/code/knowledge/storage/publication/lifetime/resource files, strict query/codec and additive snapshot oracles, including their authenticated preimages.
SDK controls retain actual leaf/session drift before result bytes and full knowledge guards.
The two assessment-drift variants retain corruption fixtures but now require recovery/pre-ack refusal after files may deliver, not mandatory archive absence.
Departure bodies remain5000 ms, refill1500 ms, native60000 ms and capacity4; late originals must be awaited and still fail.

The reviewed local departure file passes16/16.
The assembled gate remains **5470 passed/14 failed/9 skipped**, with13 engine and1 deletion/replay clock failures; this is not overall usability/release qualification.
See [independent review](../../tasks/10-06-cadence-retirement-distribution-qualification/research/g5-publication-simplification-independent-review.md) for exact inputs, waits, package and unavailable-lane evidence.
Separate overlapping counts are not added.

## 7. Wrong vs Correct

```ts
// Wrong: cached selected data grants later permission, or full history is
// walked at every file cut despite the approved supported-writer boundary.
return selected;
// Correct: exact original scope/work and live callbacks, then fresh bounded
// current rows and actual file/claim proof. Full audits remain at entry/ack.
assertTaskCompletionPublicationCurrent(db, rootHash, task, selected, entry, id);
```

Prevention: inventory every supported writer before reducing repeated audits; prove the gate at resumed commits as well as synchronous callbacks.
Distinguish logical refusal, prehydration bounds, actual mutation reach and original resource settlement.
