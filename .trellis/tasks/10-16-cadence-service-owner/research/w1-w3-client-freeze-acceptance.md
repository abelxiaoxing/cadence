# W1 → W3 reciprocal acceptance and W4/W5/W6 seam review

## Decision

**ACCEPT the revised portable contract for W3 consumption, with W4/W5/W6 seams accepted at the interface boundary.**
No unrepresentable approved requirement or remaining concrete counterexample was found in the reviewed bytes.
The original W3 F1–F6 and multi-row-update concerns have concrete dispositions below; this is not acceptance of the original candidate.

This report records this delegated consumer agreement only.
Main must combine it with reciprocal W2 agreement and record the joint freeze before W2/W3 implementation starts.
W1 remains the shared contract/client/ports/test editor; the maintained-JS codec move requires its explicit single-editor handoff.
This does not start another child, complete W1 or the parent, authorize provisioning, or establish runtime acceptance.

## Scope and method

Resolved `python3 ./.trellis/scripts/task.py current --source` to `.trellis/tasks/10-16-cadence-service-owner`, source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`.
The sole write is this newly created research file.
Inspected working-tree status without changing unrelated archive/qualification material.
No product edits, installs, network, services, tests, SDK/provider construction, credential reads, task/status changes, nested agents, staging or commits occurred.

Read W1's supplied artifacts and both curated manifests, every referenced curated spec/research document, the complete parent PRD/design/implementation plan and **both mandatory appendices**.
Read the original `w1-w3-contract-fit.md`, revised handoff/review and execution checkpoint completely.
Read the entire actual facade, five portable contract modules, `src/service/ports.ts`, `src/service-client.ts` and `src/service/admission.ts`.
Inspected relevant actual contract-test bodies for admission, settlement, history, clients and all three revision fixes; tests were not executed here.
No new Pi API is proposed or inferred from global documentation by this portable-interface review.
Selected parent contracts supersede incompatible historical terminal-only constraints.

## 1. W3 can implement one writer

The shared signatures do not force a worker-only journal or a second accepting adapter.
One W3 serialized writer can implement these entrypoints over the same private sequence/artifact authority:

| Input boundary                                  | Accepted representation and ordering                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AdmissionPersistence.lookup/commit`            | `AdmissionIntent` holds command/operation/run/created-task IDs and canonical credential-free `CommandIdentity`. Lookup distinguishes found, conclusively absent and inconclusive. Exact-context CAS advances the relevant control revision once before commit resolves; acceptance is not action execution or v1 publication. |
| `AuthAccountingPort.preparation/settlement`     | Credential-free operation/epoch/run/child/source-selection/validity facts. Commit preparation before getAuth; settle only after the original promise, retaining `admissionClosed`. Allocated child identity does not claim a worker launched.                                                                                 |
| `ProcessAccountingPort.launchIntent/settlement` | Real recording linkage and exact `WorkerCompletion`; commit launch intent before effects and native/result settlement before dependent admission.                                                                                                                                                                             |
| `CaptureSink.reserve`                           | Bounded one-shot `CaptureReservation.commit(PublicRecordingInput)`; zero-to-many sanitized events with worker source ranges, not reused wire offsets/hashes.                                                                                                                                                                  |
| `OwnerJournalPort.reserve`                      | Bounded one-shot owner input with operation/task/optional-run linkage and genuine owner observation time; no invented child identity. Parent/gate/handoff/check/change/review/publication facts and content feed the same writer.                                                                                             |

Anchors: `src/service/ports.ts:45–68,105–232`; `src/service/contracts/capture.ts` (`PublicRecordingInput`, `CommittedBatch`); `src/service/contracts/history.ts` (`OwnerFact`, `OwnerRecordingInput`).

**Private accounting taxonomy is not public transcript/export taxonomy.**
W3 may define its private journal record codecs under its assigned storage ownership and implement the concrete admission/auth/process ports alongside owner/capture input.
There is no requirement to add auth-preparation envelopes or every coordination record to public `OwnerFact`/`HistoryRecord`.
An unmatched auth preparation must remain credential-uncertain independently of process recovery, but it need not masquerade as a worker event or become a public auth transcript.
The revision review's withdrawn private/public-taxonomy finding is correctly withdrawn.

The capture/store transformation boundary is sufficient:

- `SourceRange` preserves original sequence/time provenance through delayed prefixes and rechunking.
- `stored-chunk` contains transformed text and detail occurrence; `stored-end` contains coverage.
  W3 owns stored byte offsets, hashes, versions and committed membership.
- `CommittedBatch.details` maps `(childRunId, detailId)` to an exact `ContentRef` and commit sequence. `ownerDetails` independently maps `(operationId, detailId)` without a fictitious child.
- `CaptureBudgetPool` and port contracts charge source retention, prefixes, encoded expansion and output slots before copying/awaiting.
  Data cannot consume control headroom inside the same aggregate ceiling.
  An in-flight write is not refunded by a reporting timeout.
- Neither recording port waits for a viewer.
  Actual disk publication and slow-recorder handling remain implementation work, not missing portable signatures.

Inspected vectors: `test/service-contract.test.ts:2731–3121` cover transformed mappings, final selections, resource leases, owner-native checks and expected-byte publication.
These are structural/memory vectors, not durable-write evidence.

## 2. Original W3 findings resolved

### F1 — finite admission and original-promise accounting: accepted

`ActionAdmission.reserve/bounded/reserved` reserves synchronously before request decoding and serialized retention.
Ordinary requests have both count and encoded-byte limits (currently eight conservative 4 MiB reservations fit the 32 MiB budget).
A separate Cancel lane retains at most sixteen 4096-byte reservations.
The 5000 ms deadline includes queue time and awaited observation/lookup/commit boundaries; pending originals remain handled and charged until settlement.
Timeout/fencing cannot activate a later successful write.

At Cancel saturation the synchronous, exact-run/current-authority path coalesces stop against existing owner handles without another async lookup/write.
It reports non-durable uncertainty, not confirmed cancellation.
This preserves safety without recreating the unbounded retained queue.
Inspected tests: `2068–2284`, `3677–3706`, `3867–3923`.
Actual HTTP ingress/body buffers and native stop are W1/W4 gates, not proof supplied by these budgets.

### F2 — aggregate versus SDK versus check settlement: accepted

`RunSettlement` discriminates `parent`, `sdk` and `check`.
A parent has no invented PID, stdin or collective direct-child-close fact.
Its ordered required set must match `RunIdentity.assignments`; completed aggregation cannot discard an unstarted, failed, unknown or unrecorded required child.
Ordinary checks use `CheckNativeSettlement` with `stdin: not-required`, not an assistant-final fiction.
SDK-native success retains delivered stdin, valid final, settled cleanup, actual zero close and complete observed capture.
Inspected tests: `2342–2471`.

### F3 — owner-origin recording: accepted

`OwnerFact` and `OwnerRecordingInput` represent parent admission/settlement, gates, exact dependency handoffs/observations, checks, changes, human review, and expected-byte publication intent/outcome.
Owner content uses real task/check/change/review ownership and the same committed-batch result.
Check native exit, freshness/obligations, capture and publication remain separate facts.
Auth/process accounting uses the existing separate private ports, not an additional public event family.
Inspected tests: `2977–3121`.

### F4 — immutable admission versus unavailable current context: accepted

`RunIdentity` retains original command/operation/kind/context/model, frozen graph reference and assignment allocation.
`ControlContext` independently represents available current authority or a fixed unavailable state tied to workspace/task.
An old G1/M1 run and later G2/M2 run can remain readable while today's selected task/configuration is corrupt or unavailable.
Historical admission values need not be fabricated into a current mutation context.
Metadata-only updates use `runs: []`; they do not relabel existing admissions.

Revision fix R3 also correlates run/child-scoped rows with the same task's current/unavailable context via `runInView`.
Inspected tests: `3196–3260`, `3828–3865`.

### F5 — bounded readers, ownership and export: accepted

Initial reads and continuations now have shared concrete contracts:

- `ListRequest` binds reader, store, scope, snapshot, entity/version/offset continuation and limit.
  Only a first page may select a null snapshot; resolved pages and continuations pin the selected commit.
- Named tasks/runs/messages/tools/contents/events/checks/changes/reviews methods share `HistoryPage`, request correlation and fixed ceilings.
  An events continuation cannot quietly become a tools continuation.
- Snapshots explicitly expose an active-and-recent horizon plus a separate `historicalRuns` request at the watermark.
  Rich history is not squeezed into the live row limit.
- `RecordOwner` retains task/run/child/entity **and entity version**, independently of content-record version.
  Message/tool/content/omission records preserve partial, unexecuted, orphan and ambiguous occurrences.
- `EntityReadRequest/Page`, `GraphReadRequest/Page`, detail pages and search-hit owners permit exact navigation rather than guessed source-ID joins or detail-to-message version substitution.
- `ProjectionPort` explicitly assigns actual snapshot existence, committed membership, linkage/hash validation and no silent rebasing to W3.
  A structurally valid cursor is not authority to access bytes.

Literal search is representable without another protocol: seed `ReadCursor` at the chosen committed snapshot with query and null record fields/offset zero; continue with its returned cursor.
`decodeSearchPage` binds query, scope, store, snapshot and exact UTF-8 hit length/range, with owner/version and independently usable detail cursor.
Zero-hit advancing pages remain valid.
Query text has no regex/shell/provider semantics.
W3 still implements scan order, cross-chunk overlap, no cross-field matching, real byte comparisons and bounded continuations.

Exports have explicit selected scope/snapshot/format, manifest/provenance, retained record/graph/detail or Markdown chunks, and completion/coverage/count/digest/watermark trailer.
`encodeExportFrame` owns the digest byte framing; `ExportTracker` truthfully reports `complete-unverified-digest`, not cryptographic verification.
The streaming adapter must verify actual bytes/digest and recheck access generation at every bounded chunk, including the trailer.
`ServiceClient.export` withholds a received trailer until original EOF and rejects trailing frames, abort or missing trailer without retrying mutations.
This supports full retained export rather than DOM/ring export.

Coverage remains explicit across records/pages/exports: complete-as-observed is not complete-original-source; redaction, limited/unavailable source, omissions and recording gaps do not disappear because navigation finished.
Inspected tests: `3312–3675`, `3925–4000`, plus existing cursor/search vectors at `998–1113`.

### F6 — bootstrap/Create/action parity: accepted

`session()` supplies authenticated capability/epoch/CSRF metadata, never the owner token or local capability value.
`workspace()` supplies a genuine task-null Create context or an unavailable context; an empty invented task snapshot is unnecessary.
Create allocates `AdmissionIntent.createdTaskId` before acceptance and returns `Receipt.created` with reserved/published state.
An accepted reservation is not successful task publication.

Both clients have finite create/save-plan/generate-plan/start/check/review/cancel/receipt/read methods and the same decoders.
Configured checks remain available to browser and local clients; manual shell checks require actual ingress-created local authority, not a supplied surface label.
Generate-plan remains a readonly advisory episode, separate from saving a proposal and fresh Start.
Inspected tests: `1439–1674`, `3124–3195`.

## 3. W4 exact-result and check/review seam

The usable dependency path is now concrete and noncircular:

1. W2 validates actual worker-v2 associations/wire hashes and supplies sanitized recording input.
2. W3 returns an exact detail-to-content commit mapping.
3. `PreparedWorkerPort.launch` returns `WorkerCompletion` with original native settlement, selected final message/detail and `FinalRecording` (committed, pending, refused or uncertain).
4. W4 records that completion through `ProcessAccountingPort.settlement` and obtains the committed process-settlement sequence.
5. Only strict native completion **and** committed selected final content **and** committed settlement can satisfy a required predecessor.
   W4 also verifies frozen graph order/range, current/historical selection and observation freshness before dispatch.

Worker completion does not require the worker to manufacture its own owner process-commit fact.
Native zero can coexist with pending/refused/uncertain final recording; it cannot become durable workflow success.
Revision R2 additionally prevents an SDK projection's `result` shortcut from differing from its committed selected final reference, including record/version/field mismatches (`history.ts`, `decodeRunProjection`; test `3788–3826`).

`DependencyHandoff` carries exact final-text source/version/range, destination assignment/dependency index, actual supplied text and coverage.
The 16 KiB predecessor/32 KiB aggregate limits and independently serialized 96 KiB public/128 KiB actual envelope bounds remain intact.
Whole-result overflow must block, not clip or synthesize context.
A null/unconfirmed required child's facts can be retained in failed/blocked/unknown aggregation without inventing a successful subset.

Parent checks remain separately confirmed operations, not graph tool results.
`check-start` records exact selection/cwd/environment generation/before observation; `check-settled` retains native facts, output reference, freshness status and coverage.
`CheckObligations` retains exact configured selections and real not-run obligations with null check IDs.
Review binds selected run/check revision/change identity and issue acknowledgment; review/publication facts do not rewrite execution or check outcomes.
Actual checkout barriers, process settlement, stale-input decisions and summary mapping remain W4/W3 responsibilities.

## 4. W5/W6 live and nonreplaying client seam

The selected live producer rule is explicit: **one update contains every changed row at that committed watermark**, plus explicit removals and current control availability.
`previousSeq` chains delivered projections; filtered global sequences need not be numerically contiguous.
If a complete update cannot fit, the producer requests resync rather than emitting several same-sequence sibling updates.

`ProjectionTracker` validates on a copy and installs atomically, rejects relabeled immutable admissions and active-row removals, and updates the historical-run watermark.
Metadata-only updates are representable.
Old socket generations, stale snapshot tickets, sequence gaps and epoch changes do not produce executions or new outcomes.
Heartbeat watermark detection and the separate 30-second poll repair a lost final update even without later worker activity; stale connection status remains separate from execution.
Inspected tests: `1872–2066`, `3261–3311`.

Receipt handling is observational, not a retry mechanism:

- Admission checks existing canonical identity before current grant freshness and returns recorded receipts without `activate`.
- A changed payload conflicts; inconclusive lookup cannot become absence; only newly committed acceptance enters activation.
- Client methods do not mint IDs, retry, refresh auth, repeat preflight or replay after transport uncertainty.
- Revision R1 reuses `decodeStoredCommand` to correlate action and response, rejecting accepted Create without its task, Start without its run, check with parent settlement, or Cancel with a created task (`test:3708–3787`).
- After restart a receipt can still be observed under fresh transport authentication; that does not renew an old action's authority.
- Detach invalidates unconsumed confirmations, not already admitted service work.
  Explicit Cancel remains a run/epoch/idempotency action rather than a progress-version-sensitive modal.

This is enough for common native/browser adapters without client-local protocol casts or competing reducers.
It does not establish actual terminal entry, HTTP authentication, WS delivery or browser usability.

## 5. Future owning-child runtime gates — not freeze blockers

These are retained approved implementation/qualification obligations, not a generic request to expand the interface or finish another child before freezing ports.

| Owner   | Required future evidence                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W1 + W3 | Actual exclusive command intent/commit/CAS and receipt lookup across crash windows; auth intent before getAuth and original-promise settlement after cancellation; unmatched auth and launch uncertainty retained independently; no late launch or restart replay. Real Host/Origin/CSRF/local capability/WS/rotation and stop/fence behavior.                                                                                   |
| W2 + W3 | Genuine SDK occurrences, native close/input/cleanup, incremental redaction and wire-to-store association/integrity; fast producer versus slow recorder, prefix/expansion budgets and preserved failed recording. Maintained JS codec relocation with one executable owner and shared semantic vectors.                                                                                                                           |
| W3      | Real journal/artifact flush ordering and validated committed prefixes; torn/interior-corrupt/missing/linked data preservation; indexes are accelerators; quota/ENOSPC and unresolved writes fence without cleanup. Long/no-viewer/restart paging, exact literal hits, full selected exports, digest/trailer integrity and revocation/cancellation without stopping work. Passive reads perform no repair/write/SDK construction. |
| W3 + W4 | Strict v1 bounded labeled summaries and expected-byte publication/conflicts without rich-history clipping; native completed versus mandatory recording failure remain distinct. Real readonly overlap, fair checkout exclusion, dependency/wait/failure/cancel drain, actual parent checks and issue-aware review.                                                                                                               |
| W5 + W6 | Native/browser create → plan → explicit Start → Cancel/check/change/review and history/search/export against the same owner; fresh consent, no embedded fallback, no reconnect replay, atomic multi-row projection and lost-final recovery. Real terminal modes and real browser desktop/phone-sized accessibility, not only fixture rendering.                                                                                  |
| W7      | Integrated source/extracted package, service/worker/client assets and notices/build/member audit; all required parent acceptance lanes, with physical-device/platform/paid-provider qualification separately labeled.                                                                                                                                                                                                            |

Actual native filesystem implementation is **not** needed to freeze these concrete interfaces.
Its absence is neither a reason to fabricate durable evidence nor a new freeze blocker.

## 6. Evidence classification and source binding

Observed the existing `parent-revision-checks/results.json` and `contract-tests.log`: the prior main-session targeted command reports **114 passed, zero failed/skipped**, with check/lint/check:agents exits 0.
The independent revision reviewer separately records its three repaired defects and 114-case rerun.
These are overlapping prior portable codec/resource/reducer and injected-memory admission/transport results, not new tests run here, native storage/auth/process evidence or completion.
Current hashes match that review and main-session record.

SHA-256 of actual reviewed product/test files:

| Path                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `src/service-contract.ts`          | `7d166451e88e89b9ef86b3e48c38716324637dd736b89d5ab679cde5b8acebff` |
| `src/service-client.ts`            | `a61ae7f04a6b3665b077b550193f24dc3134ee39d4645d86f7f0e52dc7e63c79` |
| `src/service/admission.ts`         | `c44a27cfe505bb6ac524928a4682a157b291fe777ed5b8979f3f07c0cde78cbd` |
| `src/service/ports.ts`             | `7134c4576caa55718d8ba914bb4c4f19f2dbeed4317eba041e53614e3e6c028e` |
| `src/service/contracts/core.ts`    | `c0872f2f0dce34c5ebfb73827b5200675b4d8ecfa312b2bb722c8e4bb51afb41` |
| `src/service/contracts/domain.ts`  | `f24eb52dafd058614828209135a3f9ac372232a74bcbf06c20c79ec05057b32a` |
| `src/service/contracts/capture.ts` | `1063989d0b7ae4b6a982243da272e3f01905013ba79bb145362fde1f15deddb7` |
| `src/service/contracts/history.ts` | `07810b6052e3a5c012a62388c4b77ddd24121be753294c4f63bde2c0ee48bf82` |
| `src/service/contracts/budget.ts`  | `968c85e35fb1e34c8e77ded90e29c41535728077a07be041b014068362a5463d` |
| `test/service-contract.test.ts`    | `4f5cf173e61219912e814ae8ae5e20ea052f15b4cb9c17f60d8a197a727f545e` |

Canonical parent inputs, paths relative to `.trellis/tasks/10-16-cadence-webui-terminal/`:

| Path                             | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `prd.md`                         | `27f39c91020d81f92c63462a6fba9fb0af12d235f616d5dd15a8f3be1d3d0f40` |
| `design.md`                      | `98e4db2bfafd5ac8c1fbe50568114366d81610eec734f7414d5e19dea29a4310` |
| `design-runtime-history.md`      | `5c02f848eb9c7b6943cc778d205eadcb3f739087f64bf56a16ae4ab3f77ab63f` |
| `design-clients-distribution.md` | `15d5134f4307c76b412e483b524cb318045ff71b0731f399266d410e4c764ea1` |
| `implement.md`                   | `eaf1d319d1fc64ee6c721f48590c255eb3a3ee225cc34561957220f22b3d0fb0` |

Review lineage, paths relative to this research directory:

| Path                              | SHA-256                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `w1-w3-contract-fit.md`           | `4eeb773dd06eeab68b099dc54d9f7eb2815e1f0882e3612e912a8c771e438981` |
| `w1-contract-revision-handoff.md` | `4f46ab5a398e35f2384fdba0125c2bf34e6581e47b0853c97eb6e1acab70de6b` |
| `w1-contract-revision-review.md`  | `17b0acad6cbf89ef15716a9b542a8cf77e43ec65227f3830ed7d6171f58a670f` |

**Handoff:** W3 consumer acceptance and the requested W4/W5/W6 seam review are recorded for these bytes.
Main retains joint-freeze/ownership coordination; no shared editor transfer or child start occurred here.

## Artifact-only validation

Recomputed the ten product/test SHA-256 values and the parent/review input hashes after writing; all remained unchanged and matched the recorded identities.
The first scoped Markdown check found sentence-wrapping/table-alignment issues in this new report only; scoped formatting corrected them.
`node_modules/.bin/rumdl check --no-exclude .trellis/tasks/10-16-cadence-service-owner/research/w1-w3-client-freeze-acceptance.md` then passed (exit 0).
This is document validation, not a product test or runtime qualification.
