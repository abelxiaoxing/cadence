# Service Capture and Durable History

## 1. Scope / Trigger

Use for W2 capture, W3 recording/readers, and W4/W5/W6 consumers of those boundaries.
The production host composes these components with real action/current/model/auth ports, and both native/browser clients consume them.
No shell-local executor or mutation-closed admission placeholder remains in production.
See [orchestration](./service-orchestration-guidelines.md) for actual execution/check/review joins.
Keep [owner lifecycle](./service-owner-guidelines.md), [legacy storage](./database-guidelines.md) and [quality/evidence](./quality-guidelines.md) distinct.
The approved redesign deliberately replaces tiny worker-transcript limits, not native consent, exact auth/model identity, actual close, readonly capabilities or unknown fences.

Source anchors below are repository-relative paths and symbols.
Neither history navigation nor a successful fixture grants execution/recovery authority.
No SDK session construction, auth refresh, task execution, import, cleanup or repair belongs on a history read.

## 2. Actual Signatures and Owners

```ts
// src/subagent-process.ts: same native launcher, not a second executor
preparedWorker(prepared: PreparedModelContext, request: WorkerPublicRequest,
  link: RecordingLink, ownerSecrets: readonly string[], timeoutMs?: number);
// Returns { request, launch(signal: AbortSignal, sink: CaptureSink): Promise<WorkerCompletion> }

// src/history/files.ts
HistoryFiles.open(coordination: ServiceCoordination): HistoryFiles | undefined;
HistoryFiles.initialize(lease: OwnerLease): HistoryFiles; // explicit setup only

// src/history/writer.ts
new HistoryWriter(lease: OwnerLease, options?: HistoryWriterOptions);
// Writer methods:
lookup(commandId: string): Promise<StoredLookup>;
commit(input: AdmissionIntent): Promise<AdmissionCommit>;
admitRun(runId: string, identity: RunIdentity, graph?: Graph | null,
  observedMs?: number): Promise<PersistenceResult>;
capture(link: RecordingLink): CaptureSink;
owner(): OwnerJournalPort;
publishTask(request: TaskPublicationRequest): Promise<TaskPublicationResult>;
flush(): Promise<PersistenceResult>;
settled(): Promise<void>;
// readonly writer.auth: AuthAccountingPort; writer.processes: ProcessAccountingPort

// src/service/ports.ts: both ingress ports use one-shot synchronous reservations
CaptureSink.reserve(budget: CaptureBudget);
CaptureReservation.grow(additional: CaptureBudget);
CaptureReservation.commit(input: PublicRecordingInput): Promise<PersistenceResult>;
CaptureReservation.release(); // unused lease only, not a timed-out original write

// src/history/projection.ts implements ProjectionPort from src/service/ports.ts
new HistoryProjection(reader: HistoryReader, environment: ReadEnvironment);
// Named tasks/runs/messages/tools/contents/events/checks/changes/reviews:
ProjectionPort.messages(request: ListRequest): Promise<HistoryReadResult>;
ProjectionPort.detail(cursor: ReadCursor): Promise<DetailReadResult>;
ProjectionPort.entity(request: EntityReadRequest): Promise<EntityReadResult>;
ProjectionPort.graph(request: GraphReadRequest): Promise<GraphReadResult>;
ProjectionPort.search(cursor: ReadCursor): Promise<SearchPage>;
ProjectionPort.export(request: ExportRequest, signal: AbortSignal): AsyncIterable<ExportFrame>;
```

- `src/worker-public.mjs` and `.d.mts` own executable portable core/domain/capture codecs, limits and declarations. `src/service/contracts/{core,domain,capture}.ts` are **re-export shims**, not parallel validators. `contracts/history.ts` owns public history/read unions; `contracts/budget.ts` owns shared retention accounting; `service-contract.ts` is the facade.
- `worker-capture.mjs`/`.d.mts` own stateful original-wire validation, occurrences, emitter and SDK projection; `worker-redaction.mjs`/`.d.mts` own incremental field sanitization; `worker-tools.mjs`/`.d.mts` own narrow bash/update ingress.
  These are maintained JS, not generated or TypeScript child fallbacks.
- `worker-recording.ts` validates/transforms into the supplied sink.
  `history/types.ts` owns private disk records; `RunState`/`OperationState` in `run-state.ts` own semantic reduction.
  Private auth/process accounting is not an extra public auth transcript.

Public response unions are exactly:

```ts
type DetailReadResult = DetailPage | DetailProgress;
type HistoryReadResult = HistoryPage | RequestProgress<ListRequest> | HistorySnapshotTransition;
type EntityReadResult = EntityPage | RequestProgress<EntityReadRequest>;
type GraphReadResult = GraphPage | RequestProgress<GraphReadRequest>;
// DetailProgress: { kind: "progress", cursor, next, coverage }
// RequestProgress<T>: { kind: "progress", request: T, next: T, coverage }
// HistorySnapshotTransition: { kind: "snapshot", request, next, coverage }
```

Data pages are **untagged**, not `{kind:"data"}`.
`SearchPage` remains `{cursor,hits,next,coverage}`; zero-hit advancing search pages are valid.
`validateCursor()` returns `valid | progress-needed | refused` status; unfinished proof is not validated membership.
Use the shared `decode*ReadResult`, `historyReplyMatches` and `ServiceClient` correlation, not local casts or empty-record substitutes.

## 3. Request, Response, Environment and Storage Contracts

### Capture → sanitized committed content

`src/sdk-worker.mjs` subscribes to the public **awaited core** `session.agent.subscribe`, verifies the existing `toolExecution` capability, then sets/readbacks sequential execution.
Making a synchronous `AgentSession.subscribe` callback async does not create core-agent backpressure.
Inspect installed public declarations; global Pi documentation may describe a different peer.
Synchronous tool updates/bash `onData` can still overlap the awaited listener: reserve before copying, selecting retained values or yielding.
Abort through a separately handled promise; never await the run's own settlement inside its awaited subscriber.

`ToolIngress` retains handed-off copies until the original listener releases them, including callback throw/rejection.
`sanitizedJsonChunks` reserves the key table before push/sort, grows before each retained key, acquires the next sanitized comparison-key lease before releasing the previous one, and reserves string slices/escaping before copying.
Nested tables/keys/slices survive `yield` and the consumer's original awaited write; iterator return/throw releases only obsolete lexical ownership.
Do not reinstate the removed flat 1 MiB worker canonical-traversal reservation or refund a still-pending emitter write; owner lexical/prefix allowances remain unchanged.
These are bounded Cadence queues, not total SDK/V8/provider heap guarantees.

Keep genuine message/block/call occurrence associations, partial versus finalized fields, source-ID unavailable/redacted dispositions, and orphan/ambiguous observations.
Tool-start is an SDK observation, not proof of native command launch; `isError` is not a parent check.
Final selection is the ordered finalized-field concatenation without invented separators or a second cross-field sanitization.
Hidden thinking/signatures/media/provider envelopes are omitted with coverage, not exported or reconstructed.

Worker sanitization precedes stdout; `WorkerRecording` applies owner-only literals before persistence, including source names/IDs and omitted MIME text.
Retain split UTF-8/secret prefixes and escaped/structured sensitive-field handling; per-chunk `diagnosticText` is insufficient.
Validate original wire offsets/hashes first; W3 assigns **independent stored** offsets, hashes, versions and exact detail mappings.
Browser/local secrets never enter child stdin merely for redaction.
`captureBash` uses public `createLocalBashOperations` with a Cadence-owned, charged redacted accumulator: no stock `OutputAccumulator`, raw spill or following spill paths.
Source-limited previews remain distinct from full allowed retained results; invalid UTF-8/exhaustion fails, not green truncation.

The prepared adapter allocates parser/sink reservations inside encoding, before W1's final source/size/cancel check and single launch.
Owner commits are submitted in source order without serializing each acknowledgment; W3 alone serializes/batches writes and native stdout pauses at the bounded ingress window.
The 5-second reporting stall stops/fences but retains original charges; late success cannot repair the returned failure/uncertainty.
No accepting default sink or fabricated `ContentRef` is allowed.
Native exit/close/stdin/final/cleanup, final recording, and durable process settlement are separate facts; W4 must commit launch intent before launch and original completion before dependent eligibility.

### One writer, strict summaries, no replay

`HistoryWriter` joins admission, immutable run allocation, auth preparation/settlement, process launch/settlement, owner facts and capture into one global committed sequence.
Exclusive command intent precedes artifact/admission flush → journal rows/checksummed commit marker → original sync/close → published watermark → derived locator/checkpoint publication and notifications.
Immutable index nodes may be prepared before append, but only the committed marker anchors their root; they cannot independently authorize effects.
Safety transitions flush immediately; progress batches use 100 ms/256 KiB bounds, segments 8 MiB/4096 records, immutable artifact parts 256 KiB.
Readers cannot publish a page-cache-visible marker while its original write remains unsettled.
Candidate reducer state and observer callbacks are not commit authority; notifications coalesce separately and never join original write settlement.

`StoredLookup` is `found | absent | inconclusive`.
Only conclusive absence permits fresh admission consideration; partial intents, corrupt/unbounded lookup and stale indexes never authorize another launch.
Accepted receipt lookup never reactivates work.
Restart reconstructs uncertainty, not dispatch: unmatched auth preparation is credential-uncertain independently of unmatched launch/native closure.
Indexes are accelerators; missing/corrupt hints use bounded original-source fallback without writes.
Torn tails preserve a validated committed prefix with gap coverage; interior corruption is not skipped.

`publishTask` snapshots its request before awaiting and records expected-byte intent → held `TaskStore.save` → observed identity → committed publication outcome.
Same-revision external edits conflict and remain untouched; publication conflict/uncertainty fences unsafe continuation.
Strict v1 keys/directories and 128 KiB record, 8 KiB goal, 32 KiB plan, 16 KiB result/baseline, 32 checks/64 activity and 1000-task ceilings remain.
`publication.ts#summary` labels bounded previews and retained run linkage; clipping a summary never clips retained content.
`publicationPhase`: unsettled → running; completed → review (generate-plan → planning); failed/blocked → failed; canceled/timeout/unknown → interrupted; only explicit human review can produce done.
Checks, required not-run/stale obligations, native outcomes and human review are not interchangeable.

Quota defaults remain 10 GiB/checkout, 512 MiB/episode reservation, 256 MiB free-space floor and 1 MiB episode control headroom; count indexes/orphans too.
Reservations do not guarantee free disk.
ENOSPC/quota failure preserves readable committed bytes, pending originals and unknown fences, with no TTL/eviction/cleanup.
`HistoryRecovery` can record a guarded bridge only with supplied fresh local authority and independent process/credential/storage resolution; it never releases W1/v1/registry locks.
`service/recovery.ts#resolveRecovery` now composes native-local expiring authority, the original guarded recovery append and exact ordered coordination release.
Neither an ESRCH observation nor a boolean/cursor is sufficient; see [owner recovery](./service-owner-guidelines.md).

### Formats and read proof

Private path remains `<privateRoot>/service-v1/history-v2/`; workspace/state-home identity and safe files follow existing `TaskStore`/`PrivateFiles` policy.
Explicit `HistoryFiles.initialize` creates format **`cadence-history-store/3`**, publishing exclusive 0600 `read-proof-key.json` before the final format marker, with file/directory durability attempts.
The closed `cadence-history-read-key/1` record binds storeId to 32 random bytes in canonical base64url.
Partial setup, unsafe/missing key or key reincarnation refuses/preserves; passive open/read never creates a key/index or migrates bytes.
Recognized **format2 remains readonly**, including refusal of writer/recovery append; private streaming export can traverse it without a key, while cold stateless old-format search retains its explicit limits.
Public worker/export protocol2 is unchanged by private format3.

`HistoryReadProof` uses native AES-256-GCM: fresh 12-byte nonce, full 16-byte tag, `rp1.` canonical envelope, plaintext ≤6000 bytes, navigation ≤8192 ASCII bytes.
Authenticate completely before parsing/exposing plaintext.
AAD binds purpose, store/workspace/root, selected format/key incarnations and normalized request identity excluding navigation.
Purposes are search/list/detail/entity/graph; epoch/access generation are deliberately absent so unchanged history can resume after restart with **fresh independent authentication**.
No token/key/checkpoint/crypto exception belongs in public history/logs.
A valid seal is navigation integrity, never auth, receipt-absence, execution, recovery or lock-release authority.

`ForwardValidator`, `RetainedTraversal`, `source-row.ts` and the named `*-progress.ts` readers preserve finite original-source proof:

- Snapshot discovery, output/target materialization, end/overlap/admission work and finish are separate coordinates; one active worker, not serialized row/artifact arrays or recursive continuation stacks.
- Checkpoint standard SHA-256 state (eight words, exact count, ≤63 residual bytes), scalar positions/counters and ≤1023 overlap bytes; compare resumed hashing against native SHA-256.
- Resume large rows, reference membership and required admission files independently.
  Repeated recovery bridges advance the same forward validator, checking actual predecessor raw size/SHA/high sequence/committed offset/sequence and next-segment byte-zero placement.
- Verify selected output/artifact bytes and final field end/aggregate hash from original sources.
  Empty unfinished fields and suspended `finish()` must still produce incomplete coverage; output exhaustion is not proof completion.
- Charge key/format reads, repeated proof work and selected payload reads to the **same original 8 MiB/100 ms cooperative quantum**, before allocation/IO.
  Fixed completion metadata is prepaid, not a renewed arbitrary read budget.
- Revalidate active selected file incarnations before resume/publication; changed source/key/format refuses, never silently rebases or falls back from an invalid present token.
  A fresh nonce alone is not semantic progress.

This authenticates prior bounded observations under supported immutable-writer assumptions, **not an atomic current snapshot of every retired file**.
Finite tokens cannot retain every past incarnation; no hostile same-user CAS/change-and-revert detection follows.
Keep warm/cold corruption, forged-bridge and active-source negatives despite that limit.

### Reader categories, HTTP and complete exports

| Representation / operation                                                            |                        Existing ceiling |
| ------------------------------------------------------------------------------------- | --------------------------------------: |
| Graph body (`decodeGraph`)                                                            |                                 512 KiB |
| Standalone graph full Reply / typed export frame                                      |                                   1 MiB |
| Ordinary list/search/entity/detail/progress full Reply, including snapshot transition |                                 512 KiB |
| Decoded detail text / each streamed HTTP download write                               |                                 256 KiB |
| Encoded worker frame / decoded worker chunk                                           |                          64 KiB / 8 KiB |
| Retained detail / child protocol                                                      |                        32 MiB / 128 MiB |
| Worker queue / owner queue, with control headroom inside each                         | 4 MiB + 1024 slots / 8 MiB + 2048 slots |
| Read quantum / literal query                                                          |    8 MiB or 100 ms / 1–1024 UTF-8 bytes |
| Default / maximum page entries                                                        |                                50 / 200 |

Full Reply accounting includes the **22-byte** `{"kind":"ok","value":...}` JSON wrapper, echoed/next navigation and escaping.
`service-wire.ts#httpOutputLimit` and `HttpServiceTransport.request` also enforce **original raw HTTP UTF-8 bytes**, before normalization can discard whitespace/alternate escapes.
Graph data uses 1 MiB; graph proof-only uses 512 KiB.
Do not shrink legal graphs, omit echoes or raise page/worker limits to fix packing.

Cursors bind store/scope/query/snapshot/entity/version/offset; only first null-snapshot list requests select a watermark, via `HistorySnapshotTransition` when needed.
Continuations pin it.
Literal case-sensitive search carries overlap within one field, never across unrelated fields; hits retain exact owner/version/UTF-8 range and **strip search navigation** before direct detail reads.
A progress reply has no data, fabricated empty range or completion fact.
W5/W6 must show progress/coverage, retain `next`, yield/cancel between bounded requests and resume the same read, not loop unlimited requests inside a UI action.

`wireRequest` selects GET or finite readonly POST **before sending** on existing named routes; navigation-bearing/large inputs use POST, not failed-GET retry.
`readonlyBody` is independent of `mutation`: session/workspace stay bodyless GET; reads remain effect:none with no grants/activation.
Current cookie/local authority, exact Host/proxy/Origin checks and browser POST CSRF precede body/proof work.
Reject mixed query/body, duplicate fields, malformed UTF-8, wrong content type/encoding, headers >8 KiB or body >1 MiB.
No provider auth resolution on reads.

`exportHistory` streams selected retained task/run/child scope, not the DOM/ring: manifest/provenance, graph/identities, context/messages/tools, lifecycle/check/change/review and coverage, then exact count/digest/watermark trailer.
NDJSON and Markdown use `encodeExportFrame`; one private iterator survives renewed quanta without emitting proof keepalives or putting private navigation into the export.
W1 checks access generation/abort before and after bounded writes, including before pulling the next original item/trailer; two search/two export readers, 120-second download idle bound.
Private computation does not reset download activity.
Cancellation/revocation stops reading, not execution, and withholds completion.
The HTTP transport verifies encoded counts/digest; `ServiceClient.export` withholds the trailer until original EOF and rejects trailing frames.
Missing trailer/incomplete coverage is not complete original-source capture.

`IndexTree.heads` uses a **128-node local synchronous memo** under one root, discarded before updates/awaits/effects; misses still safe-read/hash/decode original bytes.
`HistoryNavigation.write` uses exact create readback size or `max(oldBytes,newBytes)` for replacement, **after** independent `RECORD_BYTES` (1 MiB +64 KiB) validation; nodes independently cap at16 KiB.
Do not promote this optimization into cross-await authority or weaken independent record ceilings.
When `HistoryNavigation.publish` receives a prepared journal-anchored head, it writes the immutable root/entity or roster links but does not also rewrite the unused legacy mutable `entities`/`rosters` hint.
The no-root compatibility writer retains its old mutable-head path; existing hint bytes are preserved, not adopted or cleaned.
Readers still verify original committed batches and fall back on missing/corrupt hints; no fsync, original promise, read budget, index/record limit or safety transition is removed.
`service-history-metadata-cost` asserts this exact write reduction and preservation; `service-history-projection` retains stale-hint/skipped-predecessor corruption with explicitly fabricated legacy hints.

Environment remains owner-controlled: state-home selection is unchanged; resolved model auth stays RAM/anonymous stdin, not browser overlays or check env.
Existing Pi credential storage/SDK OAuth writeback is separate from public history.
The dedicated owner's `AuthNetwork` now composes the shared startup policy and post-SDK public dispatcher for owner auth; worker routing and its qualification remain independent.
TaskActions supplies actual `ReadEnvironment` session/current context/check selections/legacy inventory, active-and-recent horizon and checkout/check/review barriers.
`workspace`, live `snapshot` and `checkObligations` are bounded **current views**, not arbitrary-archive pagers; inconclusive history cannot provide current action authority.
The service-launch check-environment policy is exercised by real owner/native fixtures; historical reader tests alone do not qualify it.

## 4. Validation & Error Matrix

| Boundary                                                      | Required outcome                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Missing passive store; partial/linked/corrupt selected files  | Absent or fixed refusal; no init, adoption, repair or cleanup                                     |
| Original write visible but unsettled; observer pending        | No premature committed publication; original charges/fences retained; observer cannot hold commit |
| Duplicate command / inconclusive receipt                      | Return known matching receipt or conflict/inconclusive; never activate again                      |
| Native zero with failed recording/cleanup/stdin/final         | Preserve zero as native fact, not successful durable workflow                                     |
| Quota/ENOSPC or 5-second reporting stall                      | Stop/fence, preserve original promises and prior bytes; no retry/refund/eviction                  |
| Manual same-revision v1 edit                                  | Publication conflict, preserve external bytes and retained history                                |
| Torn tail / unfinished field / suspended finish               | Only verified prefix and explicit gap; no false complete empty page/export                        |
| Invalid seal, changed active source/key/format, forged bridge | `corrupt-selected`/fixed refusal; no rebase, token reset or authority crossover                   |
| Valid unfinished read proof                                   | Typed progress/snapshot transition; budget exhaustion never means absence                         |
| Oversized full Reply or raw HTTP bytes                        | `oversize`; preserve graph/page categories, no silent truncation                                  |
| Revoke/disconnect during export                               | Original read accounting settles; no trailer, no task cancellation                                |
| Missing W4 current environment or management authority        | Unavailable/inconclusive; no invented live context or accepting recovery default                  |

## 5. Good / Base / Bad Cases

- Good: real prepared SDK worker → supplied W3 sink → committed exact final mapping → original native completion → committed process settlement; only then W4 considers dependencies.
- Base: cold no-index detail returns `DetailProgress`; a later independently authenticated request resumes the same proof and yields real UTF-8 data without changing the source tree.
- Good: a legal 512 KiB graph survives the 1 MiB graph/export envelope, while an escaped detail page splits to keep its full Reply ≤512 KiB.
- Bad: map proof-only output to `records: []`, stop at a zero-hit page, or treat a new nonce as proof that a stalled scan advanced.
- Bad: a green rerun supplies a cause for an old timeout/event35, or source citations qualify CLI/browser/package cutover.

## 6. Concrete Tests and Evidence

Keep affected tests by boundary; use [quality gates](./quality-guidelines.md) for broader changes, not a historical count as a required gate.

| Tests (under `test/`)                                                                                                                                                                              | Assertions to retain                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `service-contract.test.ts`, `worker-public.test.ts`                                                                                                                                                | Same codec semantics through facade/JS; closed unions, exact request/next/snapshot correlation, no authority from structure                                                                   |
| `worker-capture.test.ts`, `worker-canonical-budget.test.ts`, `worker-recording.test.ts`                                                                                                            | Genuine occurrence/final association, split/escaped redaction, pre-copy key/table/slice charging, overlapping original lifetime, slow/refusing sink and no accepting fallback                 |
| `lightweight-sdk.test.ts`, `lightweight-process-diff.test.ts`                                                                                                                                      | Actual SDK/native bash full-result/no-spill/invalid-UTF8; exact model/auth/proxy/thinking, original close/stdin/cleanup/cancel/unknown; readonly tools and ordinary checks                    |
| `service-history.test.ts`, `service-history-semantics.test.ts`                                                                                                                                     | Actual W1 preparation → W2 SDK → W3 >2 MiB/no-viewer capture; committed membership, separate auth/process facts, crash windows and no replay                                                  |
| `service-history-publication-recovery.test.ts`, `service-history-final-review.test.ts`, `service-history-blocker-repair.test.ts`                                                                   | Real strict-v1 publication/conflicts, original-job/generation fences, torn/interior/linked preservation; quota/control accounting and isolated native ENOSPC                                  |
| `service-history-progress.test.ts`, `service-history-validator.test.ts`, `service-history-read-completion.test.ts`, `service-history-lookahead.test.ts`, `service-history-progress-review.test.ts` | AEAD/SHA native parity, format2 nonmutation, cold/restarted exact8MiB predecessor/repeated bridges, dense references, end/overlap/finish and incomplete-tail coverage                         |
| `service-history-list-contract.test.ts`, `service-history-list-entity.test.ts`, `service-history-search-export.test.ts`, `service-history-search-scope.test.ts`                                    | Exact entity/version/snapshot transition; advancing zero-hit search and cold hit detail; full NDJSON/Markdown beyond pages/ring with digest/trailer/EOF                                       |
| `service-history-proof-http.test.ts`, `service-history-export-http.test.ts`, `service-history-graph-boundary.test.ts`, `service-history-graph-boundary-review.test.ts`                             | Real readonly GET/POST auth/correlation, revoked streams, maximum legal graph, 22-byte wrapper and original raw-wire at/over limits; unchanged files                                          |
| `service-history-projection.test.ts`, `service-history-live-detail.test.ts`, `service-history-metadata-cost.test.ts`                                                                               | Multi-segment8200-row/1200-message/70-task fixture, lost-final resync, nonblocking observers, 128-node eviction/reread, independent record/node ceilings and exact growing/shrinking readback |

The [main integration receipt](../../tasks/10-16-cadence-durable-history/research/main-integration-checks/results.json) records frozen-source available-host checks, not a whole-product gate or new execution by this spec update.
Keep native SDK/filesystem/HTTP evidence separate from injected reducer facts, callback timing, smaller proof quanta and namespace-only kernel ENOSPC (not physical-disk/power-loss qualification).
The [graph/page review](../../tasks/10-16-cadence-durable-history/research/w3-graph-boundary-review.md), [metadata review](../../tasks/10-16-cadence-durable-history/research/w3-metadata-cost-review.md) and [canonical reservation review](../../tasks/10-16-cadence-worker-capture/research/w2-canonical-reservation-review.md) bind the relevant source/test corrections.
Preserve original failed receipts: the two old5s controls, the45s archive scenario (observed50018ms), and native event35 remain causally unresolved.
Demonstrated canonical over-reservation and metadata inefficiency are real fixes, **not retroactive causes**; later passes do not rewrite earlier failures.
No whole repository/pack/extracted service, complete W4 integration, native/browser cutover, paid-provider, physical-human/device, Node22/Pi1.2 or Windows/macOS/ConPTY qualification is inferred.

## 7. Wrong vs Correct

```ts
// Wrong: erases proof/snapshot transitions and can misreport completion.
const records = "records" in page ? page.records : [];

// Correct consumer shape for HistoryReadResult (one bounded UI step):
if ("kind" in page) {
  switch (page.kind) {
    case "progress":
    case "snapshot":
      showReadProgress(page.coverage);
      retainNext(page.next); // yield; allow cancel/resume, no tight retry loop
      return;
  }
}
appendRecords(page.records);
retainNext(page.next);
showCoverage(page.coverage);
```

Wrong: release a capture lease when `Promise.race` reports timeout; regenerate a missing proof key; accept an index/checkpoint as receipt absence.
Correct: retain original accounting/fences until original settlement, refuse/preserve partial format3, and use authoritative committed lookup with explicit inconclusive state.
Wrong: canonical JSON size alone proves the raw HTTP Reply fits, or graph-body size is the graph Reply limit.
Correct: enforce the full encoded wrapper **and original wire bytes** under the actual page/graph category, without changing worker or retained-detail limits.
