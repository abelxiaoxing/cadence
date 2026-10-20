# W3 continuation — immutable admission and durable drain, not W3 completion

## Disposition and scope

**W3 is still incomplete.
Keep W3 and the parent open and continue implementation.**
The requested filename does not assert that the complete history boundary is finished.
This pass finishes a coherent run-admission/control-lifetime surface over the reviewed foundation; it is not a reduced product release, full ProjectionPort, or acceptance of W3-AC1–5.
No new independent review has been performed on these changes.

Loaded the W3 manifests/artifacts, complete parent PRD/design/plan and both canonical appendices, W1 accepted interfaces, W2 producer handoff/review, foundation handoff/review, relevant specs and actual adjacent source/tests.
Only history-owned source, history tests/helpers and this new report/evidence were edited.
Shared W1/W2/public contracts, package/lock, maintained specs, task status, original reports/evidence, credentials belonging to a user, Git index/refs and unrelated dirty paths were not changed.
No agents, installations, deployments, credentials from a real account, commits, push or publication were used.

## Implemented APIs and ownership

| Path                                      | Boundary                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/history/admission.ts`                | Closed private `RunAdmission`, immutable identity/allocation and exact graph/hash/model/order validation.                                                                               |
| `src/history/run-state.ts`                | One finite per-run semantic reducer shared by candidate validation, restart accounting and receipt reads.                                                                               |
| `src/history/files.ts`                    | Exclusive `runs/<runId>/admission.json`, committed membership validation, selected metadata read budgeting and existing single journal/flush authority.                                 |
| `src/history/writer.ts`                   | Explicit admission seam, exact auth/launch/drain/check/publication-accounting joins, committed-only control installation, episode/operation limits and safety-only terminal accounting. |
| `src/history/reader.ts`                   | Exact immutable admission and frozen graph readers, separate from unavailable current authority; existing detail/events/contents readers remain.                                        |
| `test/service-history.test.ts`            | Original forty cases retained with explicit allocation/auth fixtures; one added original-process admission-file crash window.                                                           |
| `test/service-history-semantics.test.ts`  | Thirty-seven actual-filesystem/structural/fault controls for the new semantics.                                                                                                         |
| `test/helpers/history-{fixture,crash}.ts` | Explicit fabricated owner/auth fixtures and the existing ordinary-Node waited crash producer.                                                                                           |

`src/history/types.ts` is unchanged.
The new private admission schema is not a second public protocol, recorder or execution owner.
All changes still use the existing journal sequence, artifacts, shared DTO decoders, ingress pools and original native writer.

### W4/W1 signatures

```ts
// After AdmissionPersistence.commit has durably accepted the command:
writer.admitRun(
  runId: string,
  identity: RunIdentity,
  graph: Graph | null = null,
  observedMs = 0,
): Promise<PersistenceResult>;

// Existing bound ports, now joined to the immutable allocation:
writer.auth.preparation(intent);
writer.auth.settlement(originalSettlement);
writer.processes.launchIntent(link, parentOperationId);
writer.processes.settlement(link, originalWorkerCompletion);
writer.owner();
writer.lookup(commandId);

// Passive selected readers, no context or SDK construction:
reader.admission(runId, snapshotSeq): RunAdmission;
reader.graph(request: GraphReadRequest): Promise<GraphPage>;
readRunState(files, runId, snapshotSeq?, budget?): RunState;
```

Use `admitRun` for Start so the exact full frozen graph is supplied to the one writer.
The generic owner port also records parent-admitted facts for graph-null Generate-plan/check identities through the same validation/write path; it cannot invent an absent Start graph.
For Start, the graph's plan reference must already identify committed retained task-plan content, including its actual entity version and selected integrity.
An immutable admission file without the associated committed parent-admitted fact is inert preserved data, never an acknowledged allocation or restart permission.
The shared `AdmissionPersistence.commit` signature was not changed.

W4 must supply current context separately through `supplyContext`, commit the command, await run allocation, then prepare auth and launch.
It must retain each process settlement result's actual `batch.committedSeq` for the parent required set.
Auth operation IDs are independent per-child preparation IDs, **not** aliases of the parent's command operation ID.
No W1/W2 interface ownership change was necessary for this surface.

## Executable contracts

### Immutable admission and original facts

- Admission joins the exact accepted command/operation/run/kind/context; the graph hash, task/plan identity, selected models and ordered assignment allocation are frozen.
- Allocated child IDs cannot be reused by later episodes, even if a previous child never launched.
- Auth intent requires the admitted run, allocated child, original epoch and exact source selection; one preparation per child, no implicit retries.
- Launch requires that child's durably resolved, admission-open auth preparation and the exact parent operation/task/epoch; tentative or unknown allocation cannot expose capture authority.
- Candidate reducer state is installed only after original append, sync, selected-byte validation and close.
  Returned command/detail references do not provide a mutable alias to installed authority.
- Restart reduces unresolved runs with the same semantic reducer, not another success-inference owner.
  It reconstructs fences/control floors, not SDK contexts, active dispatch or execution queues.
  Accepted-but-unallocated/undrained episodes remain quarantined.

### Parent/check drain and receipts

- Parent settlement must name the entire immutable ordered required set.
  Every launched child's native facts, recording facts and exact committed process-settlement watermark must match.
  An unstarted child has no invented native result/content/settlement sequence.
- All original auth preparations must have a committed settlement before parent drain.
  Native child closure, mandatory recording, parent outcome, gate release and publication remain separate facts.
- Child close or model final alone does not release the parent reservation.
  Release follows durable terminal required-set drain, settled auth, known native closure/recording and committed release of an actually held gate.
  Human review does not release reservations or change execution.
- Check admission allocates no SDK children.
  Check-start binds the exact confirmed selection, cwd/environment generation and before observation; check-settled retains ordinary check-native facts with `stdin:not-required`, never an assistant-final fiction.
- Receipt lookup derives committed parent/check execution and publication lifecycle; a metadata-only intent is still not execution.
  Sequential publication intents bind the prior expected revision/identity and exact next observed identity.
  Conflict/uncertainty is preserved and fences unsafe continuation.
  **These publication facts do not yet perform actual TaskStore saves.**

### Resource and late-settlement behavior

- Default quota/reserve/floor/headroom constants are unchanged.
  Actual encoded journal bytes now consume the associated episode reservation as well as artifact bytes; data cannot consume the episode's control headroom.
- Live run state is bounded by admitted episodes; auth/prepared/native reservations are bounded before another preparation/launch, not only when a capture pool is constructed.
- Unfinished owner operations have a finite sixteen-operation/two-thousand-forty-eight-total-detail metadata bound using existing shared ceilings; ending details releases their operation state.
- Reporting timeouts retain original leases/pending writes until original settlement.
- After quarantine, only existing original auth/native settlement and validated terminal owner facts have a safety-only accounting path.
  This does not authorize new admissions, arbitrary owner content or worker capture, and never clears quarantine.
  Torn/uncertain append state still refuses through the same file writer; this is not recovery or repair.
- A canceled original auth settlement can be recorded after a sibling's unknown native closure without erasing the independent process fence.

### Selected metadata reads

- Admission/graph requests validate store, selected scope, immutable graph bytes and actual committed snapshot membership; future snapshots and unrelated child scopes refuse.
- `HistoryReadBudget` reserves selected native payload sizes before allocating/reading ledger/admission/intent payloads and checks the existing time budget at bounded scan boundaries.
  A size increase between observation/read exceeds the same reserved read ceiling and refuses.
- Receipt/prior/run-control/frozen-graph scans validate committed metadata without opening every unrelated artifact.
  They still verify immutable admissions and refuse inconclusive lookup rather than claim absence.
- **This is not the planned long-store index/continuation implementation.**
  A long metadata scan can still return inconclusive/refused rather than an advancing continuation.
  Existing detail/events/contents paths still have the foundation's repeated-prefix/artifact-scan limitations.
  No missing index is repaired, and no all-history text map was added.

## Validation/error matrix

| Condition                                                     | Observed behavior                                                                                                 |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Immutable admission written but journal acknowledgment absent | File preserved; selected admission unavailable; no capture authority.                                             |
| Changed command/context/allocation/model/graph                | Refusal before accepted parent allocation; no substitution.                                                       |
| Wrong child/source selection, pending or canceled auth        | No accepted launch or capture authority.                                                                          |
| Parent omits a child or substitutes native facts/watermark    | No terminal commit or episode release.                                                                            |
| Native unknown followed by original canceled auth settlement  | Both facts retained independently; quarantine/reservation remain.                                                 |
| Data consumes remaining episode data allowance                | Capture refuses; reserved control can record genuine failed native/parent settlement without reopening admission. |
| Publication claims a different expected/written identity      | Refusal; no invented published receipt.                                                                           |
| Historical current authority unavailable                      | Immutable allocation/graph remains readable where within the bounded lookup; no manufactured current context.     |
| Metadata IO budget unavailable                                | Refusal/inconclusive before the selected segment payload read, not false absence.                                 |

Good: pass the actual committed child-settlement watermark into the exact parent required set, then release only after the original durable drain.
Base: an admitted historical run remains unknown/quarantined after restart without reissuing auth or launch.
Bad: treat a surviving `admission.json`, a successful child frame or a held gate's disappearance from RAM as permission to launch/release.

Wrong: rescan a large journal to guess the child-settlement sequence while the owner already holds its actual committed result.
Correct: W4 carries the original returned sequence, while independent historical navigation uses the bounded retained reader and its future authoritative continuations.
Wrong: call publication-accounting tests evidence of actual v1 expected-byte saves.
Correct: keep TaskStore publication and its real filesystem conflict tests explicitly unfinished below.

## Verification and evidence classification

[Evidence and source identities](w3-complete-history-checks/evidence.json) bind the final run and logs.
The tested source snapshot is `w3-complete-history-checks/tested-inputs.json`; its source hashes were rechecked after the run.

- History plus the requested current ten-file set: **1059 passed, 0 failed, 0 skipped; twelve files; 295.77s**.
- Forty-one foundation/history cases plus thirty-seven new semantic cases; the remaining981 cases are the unchanged W1/W2/legacy set.
- Whole `bun run check`, `bun run check:agents` and lint passed.
  Scoped Markdown validation of this report is separate.
- The shared114 codec vectors through two surfaces remain overlapping semantics, not228 independently qualified capabilities.
  Development and pre-style reruns are not added to the totals.

The existing genuine W1 preparation + W2 guarded native SDK + this W3 journal case still retains more than2MiB, exact canary redaction, more than eight UTF-8 detail pages, original close/exit0, delivered stdin, valid final, settled cleanup and one launch/contact.
It now also records immutable allocation and exact parent drain; **test20s/child15s are unchanged**.
The new admission-file crash case adds one original waited Node exit77 boundary to the six existing crash windows; it does not use a fake receipt or infer original close from PID absence.

The37 new semantic cases otherwise use actual isolated private files with fabricated closed DTO/native facts, controlled scheduling or read-budget observations.
The late-canceled-auth/sibling-unknown case is structural accounting coverage, **not another real OAuth or unknown-native-process run**.
Check native facts in these new cases are fabricated; actual ordinary checks remain in the unchanged focused legacy tests.
The quota case exercises the actual writer's configured accounting over real files; it is not actual disk-full qualification.
Original ENOSPC/free-space observations remain labeled injections.
No full repository suite, pack/extracted service, clients/browser/terminal integration, physical-human/device, paid provider, Node22, modern Pi1.2, native Windows/macOS/ConPTY, or completed-product acceptance was executed.
Available host remains `/usr/bin/node` v26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3.

### Preserved development results

The new evidence directory preserves intermediate logs; original foundation/W2 reports, failures and hashes were not edited.
The first new control run exposed a legitimate100ms inconclusive metadata scan in the native fixture's parent-settlement helper.
The fixture now carries the actual already-returned settlement result, as W4 must, instead of making a redundant long historical lookup.
This does **not** qualify missing long-store continuation behavior or raise a native budget.
Two subsequent fixture errors were a wrong codec export name and incorrectly putting content-begin in the control lane; both were corrected without changing shared codecs or lane rules.
The initial1059-pass snapshot preceded removal of new non-null-assertion lint warnings; the final1059-case run binds the narrowed final source.
Existing unrelated package-audit informational lint suggestions were left untouched.

## Exact next work — continue W3 immediately

1. **Finish semantic joins:** exact dependency handoff/source/range/supplied-text joins; separately admitted metadata/review operations; check obligations/revisions, review/change/current-observation relationships and publication scopes beyond the implemented run lifecycle.
   Plan/change/review/check-output references now check committed content ownership/integrity, but this is not the full owner semantic boundary.
2. **Implement indexes and authoritative continuations:** derived bounded indexes/checkpoints after commits; restart-stable bounded scans across many segments, including zero-hit advancement and stale/missing indexes.
   Remove the selected-detail/full-prefix repeated IO bottleneck without trusting cached metadata or verifying unrelated32MiB bodies to return one page.
   Extend pre-read budgets to every read surface, not merely the new metadata scan paths.
3. **Finish policy/lifetime semantics:** persisted explicit new-episode resource policy generation, complete owner-operation admission joins and remaining control-exhaustion/late-IO matrix.
   The implemented finite lifetimes and exact reserve release do not alone complete W3-AC5.
4. **Implement complete ProjectionPort/live:** task/run/child/message/tool/omission/entity/check/change/review records, configured obligations, active-and-recent snapshots and full historical paging; all changed siblings at each watermark, bounded ring and gap/resync adapter.
   No accepting empty-list adapter was installed.
5. **Implement literal search:** all selected retained fields, cross-part UTF-8 overlap without cross-field matches, exact stable hits and advancing8MiB/100ms continuations.
6. **Implement both streaming exports:** common encodeExportFrame/tracker, complete selected retained scope/graphs/provenance/coverage, actual digest/count/watermark trailer at original EOF, HTTP revocation/cancel/idle and concurrency controls.
7. **Implement actual strict v1 publication:** held checkout lock, exact expected bytes/revision, conservative bounded visibly labeled summaries/stable run refs, real long-final and external-conflict tests; no new v1 keys/siblings or silent compatibility-limit deletion.
8. **Implement guarded recovery inspection/append:** exact history+coordination choice, genuine W1 local authority callback, preserved damage/unknown facts, new safe segment and monotonic sequence; no accepting authority default or lock release in W3.
9. **Finish required evidence:** larger multi-segment/no-index reads/search/export, complete projection/live/HTTP integration, remaining actual artifact/native-close/publication crash windows, real summary conflicts and native slow-writer composition.

Then obtain independent W3 review and rerun the requested gates on the completed boundary.
W1 production service/recovery composition, W4 scheduler/actions, W5 native cutover, W6 browser/live clients and W7 exact packaging/integrated acceptance remain separate subsequent gates.

## Spec-update judgment

The immutable-admission versus current-authority separation, exact parent required-set drain, original safety-settlement path and pre-read budget contracts belong in backend storage/service-owner specs once the full boundary is reviewed.
This delegation expressly keeps maintained specs read-only; this report records concrete signatures/contracts/errors/tests for the owning main session rather than silently changing shared documentation.
Do not promote the pending reads/export/publication/recovery boundaries to maintained implemented contracts yet.
These mechanisms remain supported-owner coordination, not hostile-writer atomicity, exactly-once effects, total SDK/heap bounds, universal redaction, a sandbox or descendant-closure proof.
