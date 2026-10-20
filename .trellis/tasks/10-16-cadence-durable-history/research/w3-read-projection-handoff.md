# W3 retained reads, indexes, projections and live handoff

## Disposition

Implemented the assigned read/projection/live boundary, not another semantics-only checkpoint.
**W3 and the parent remain open.**
Search/export, actual strict-v1 publication and guarded recovery are still the explicitly assigned following pass.
No independent review of this pass or the preceding 1059-case semantics pass is claimed.
Main should review them together before composition.

Only `src/history/**`, two new history test files and this new report/evidence directory were changed.
The original history tests/helpers, admission codec, W1/W2/shared contracts, package/lock, maintained specs, task status and unrelated dirty files were preserved.
No agents, installs, deployment, user credential reads, repository commits/push/merge or repository index/ref changes were used.
The temporary diagnostic edits to the original native test were restored byte-for-byte before qualification.

## Implemented owners

| Path                                       | Responsibility                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/history/navigation.ts`                | Bounded original-batch navigation, exact snapshot validation, derived locators, verified entity chains and roster navigation. |
| `src/history/index-tree.ts`                | Immutable, content-addressed radix routing nodes anchored by the original journal marker; no execution authority.             |
| `src/history/read-io.ts`                   | Shared private descriptor/path/permission checks, pre-admitted ranged reads and payload-free quota inventory.                 |
| `src/history/projection.ts`                | Every non-search/non-export ProjectionPort method; explicit current-environment callbacks and immutable historical records.   |
| `src/history/live.ts`                      | W1-compatible subscriptions/watermarks, per-run bounded rings, atomic sibling updates, queued observers and resync.           |
| `src/history/types.ts`                     | Original private codecs plus optional navigation-root membership and bounded, copy-isolated decoded-line memoization.         |
| `src/history/files.ts`                     | Original journal/flush authority, read budgets, navigation-root emission and guarded stat-only quota accounting.              |
| `src/history/reader.ts`                    | Indexed selected UTF-8 pages, graph/admission navigation and delegation of metadata pages to the shared projection owner.     |
| `src/history/run-state.ts`                 | The existing single run reducer, now also projecting native/recording/publication states and coverage.                        |
| `src/history/writer.ts`                    | Index preparation/publication, committed-only notifications, exact handoff/review/metadata-publication joins.                 |
| `test/service-history-projection.test.ts`  | Retained APIs, multi-segment/restart/IO/index controls and actual W1 HTTP/WS composition.                                     |
| `test/service-history-live-detail.test.ts` | Selected detail, obligations/review/handoff, complete-group horizons, no-viewer rings and cache/inventory regressions.        |

`src/history/admission.ts`, `test/service-history.test.ts`, `test/service-history-semantics.test.ts` and both original history helpers are unchanged from the preceding handoff.

## Concrete API

```ts
// src/history/projection.ts
export type RetainedProjectionPort = Omit<ProjectionPort, "search" | "export">;

export interface ReadEnvironment {
  session(): SessionBootstrap;
  workspace(): {
    rootLabel: string;
    models: ModelSelection[];
    context: ControlContext;
  };
  context(taskId: string): ControlContext;
  checks(taskId: string): {
    revision: number;
    selections: CheckSelection[];
  };
  legacyTasks(budget: HistoryReadBudget): readonly TaskRecord[];
}

new HistoryProjection(reader: HistoryReader, environment: ReadEnvironment);
// Implements session/workspace/tasks/runs/messages/tools/contents/events/checks/
// changes/reviews/entity/graph/detail/checkObligations/snapshot/validateCursor.

// src/history/live.ts
new HistoryLive(writer: HistoryWriter, projection: HistoryProjection);
subscribe(scope: Scope, onEvent: (event: LiveEvent) => void): () => void;
watermark(scope: Scope): LiveEvent;
replay(runId: string, after: string): readonly LiveEvent[] | null;
close(): void;

// src/history/writer.ts -- original writer remains the only writer
subscribeCommitted(callback: (notice: CommitNotice) => void): () => void;
// CommitNotice: { seq, tasks, runs, gap }; bounded asynchronous notification only.

// Required for a separately admitted human review:
HistoryWriterOptions.reviewContext?: (taskId: string) => {
  checks: CheckObligations;
  observation: ObservationFact;
};
```

Current session/model/control/check values must come from genuine W1/W4 cached observations.
There is no SDK/auth construction, provider probing, accepting default context or reconstruction of current authority from an old admission.
Missing current model authority does not prevent immutable admission/graph reads.
The read-only legacy callback supplies a bounded **legacy-only** inventory disjoint from committed Create records; any native payload IO must reserve the supplied budget first.
Legacy entries expose goal/revision context, a null rich-plan reference and incomplete coverage, not an imported transcript or renewed approval.
W4 must supply this real current-environment adapter; tests do not qualify a completed production owner composition.

Do not cast this class to full `ProjectionPort` before implementing search/export.
The actual HTTP test supplies explicit unavailable search/export functions solely to satisfy W1's complete adapter type; neither is a fake successful empty response.

## Retained navigation and integrity

### Original membership, not mutable index authority

An optional `navigationRoot` is added to the existing private commit marker, without changing the public protocol or strict task-v1 schema.
Immutable radix nodes are flushed before that marker and counted against storage.
The root binds entity-head sequence and predecessor-chain hashes plus the active roster identity.
After original append/sync/close, the writer publishes small commit, entity, run, roster, content and part locators.

A mutable head is no longer trusted to prove that a later entity update is absent.
Readers resolve the original committed root, verify immutable node hashes and the full selected predecessor proof, then validate the actual referenced journal batches.
Stale run locators fall back to verified chains; restored old mutable entity heads cannot hide a committed message end.
Corrupt/missing nodes or unavailable original membership are inconclusive/refused, never permission to accept or replay an action.
Admission/receipt/control decisions continue to use their existing authoritative source paths, not this tree.

Nodes use bounded leaves/branches and immutable copy-on-write paths.
Retained index storage is proportional to changed paths, not a full-history copy per small batch.
All node/index/orphan bytes count; there is no deletion, compaction or cleanup.
Index preparation failure may leave an original commit unindexed rather than erase safety accounting.
An old root is not carried over unindexed source facts, and reads never rebuild indexes.
Older records without this root remain preserved and use bounded authoritative reads or explicit inconclusive results.

### IO and cursor behavior

- `HistoryReadBudget` admits actual selected payload sizes before allocation/native reads, with the existing 8 MiB/100 ms request bounds.
- Ranged reads verify private ancestry, current-user permissions on POSIX, regular/single-link files, no-follow where available and descriptor/path stamps around the original read.
- Metadata pages advance through actual batch/row/item positions, including zero-result pages when a verified scan prefix exhausts its budget.
- Cursors bind store, reader, scope, snapshot, limit and position.
  Unknown/future snapshots, changed queries/scopes/versions and malformed positions refuse; no silent rebasing.
- A proven pointer can be reused within the same read budget.
  A missing commit locator can use the independently validated current head only when it names the **exact same** snapshot.
- Task pages stream committed metadata first, then separately cursor the supplied legacy inventory; changed legacy goal/revision data invalidates its continuation.
- Standalone reads that cannot establish a verified position within the budget return inconclusive.
  In particular, a large cold snapshot may require a new observation; it does not silently omit active rows or manufacture an empty result.

Selected detail lookup uses range hints only to choose a candidate.
It then verifies that candidate's original committed chunks cover the exact requested offset and validates the selected artifact's actual bytes/hash.
Binary search does not decode every unrelated median batch or open unrelated retained bodies.
A bad hint refuses rather than supplying absence or a different range.
UTF-8 boundaries remain exact; content-record version is not an entity occurrence version.

If a detail page exhausts IO after a verified nonempty prefix, it returns that prefix with an advancing continuation, not false EOF or capture truncation.
Only the selected page is retained in memory.
The original `selected`/`parts` full-integrity helpers remain internal writer/verification tools, not unbounded HTTP routes.
Search/export must use the bounded public navigation rather than casually wiring those helpers to a GET.

### Bounded caches and startup work

Caches retain metadata, not complete artifact/transcript bodies.
The decoded-line cache holds at most the active and preceding journal segments: 16 MiB encoded metadata / 8192 lines.
It is keyed by exact bytes and returns copies; every consuming scan still reads original bytes and verifies the marker/checksum and selected membership.
Priming it during encoding cannot publish a pending marker or authorize effects.
Navigation batch/block and radix caches also have finite independent bounds.
These are encoded/accounting bounds, not a total V8/SDK/process-heap guarantee.

Quota inventory uses the same descriptor/path hygiene but reads sizes, not every orphan/index payload again.
It is not content verification: original ledger/artifact validation still occurs independently.
Unsafe or oversized selected inventory entries refuse, and bytes are never removed.

## Projections and semantic joins

The existing `RunState` is shared by writer validation, restart accounting and reads.
No second raw-journal state reducer or alternate protocol was introduced.

- Message/tool records retain partial/final declarations, unexecuted calls, orphan results and actual occurrence ownership.
- Exact entity revisions, immutable content versions, omission occurrence versions and final-text membership remain separate.
- Parent/native/check settlement, mandatory recording, publication, human review and current connection state are separate fields.
- Current unconfirmed native closure projects quarantine/closing, not renewed preparation; old-epoch unclosed facts remain unknown without invented successful closure or launch absence.
- Parent coverage combines committed source/end/native coverage; publication conflict never repairs execution.
- Configured check obligations match name, command and timeout.
  Changed current observation/generation produces stale obligations while historical native exit/status remains unchanged.
- Frozen graphs and old model selections stay readable when current context is unavailable or a later model/epoch is selected.
- Snapshots include every active group and newest whole settled groups fitting 200 rows/512 KiB.
  Rich graph/transcript bodies are not embedded.
  Historical run pages are independent of this horizon.

Handoffs now join the exact admitted graph/destination/dependency index, source run/child, durable native/final settlement, content version, reviewed range, coverage and supplied text.
Changed text/range/version refuses; no clipping or synthesis call supplies missing input.
Human review requires its separately accepted operation, selected change content/identity, current observation and check revision/obligations.
A missing review-context callback refuses.
Repeated review accounting or a clean review of blocked/unresolved obligations cannot change the original execution into success.
Metadata-only publication accounting cannot borrow another operation's intent or written identity.
Actual TaskStore publication is still not performed here.

## Live adapter and W1 composition

W1's prescribed order is preserved: subscribe synchronously, obtain the snapshot, then deliver only newer committed updates.
The projection supplies bounded snapshot-key notices so removals and sibling updates are coherent with that snapshot.
Every update contains the whole changed group at one watermark; it is never split into same-sequence sibling messages.
Filtered delivery chains `previousSeq`, not numeric global sequence adjacency.

The adapter maintains at most 1024 events/2 MiB per run, independently of viewers, with a finite aggregate ring ceiling.
Eviction returns resync rather than treating the ring as the archive.
A lost final update is detected by W1's actual committed heartbeat and repaired by a new snapshot without mutation replay.
Epoch/generation gaps and oversized/inconclusive projections take the same resync path.

There are at most sixteen viewers, each with bounded message/byte queues and one original asynchronous callback in flight.
Writer notices are separately bounded/coalesced and delivered after original commit promises; neither writer nor native worker awaits a viewer.
Thrown/rejected observers cannot change recording results.
This is asynchronous cooperative callback isolation, not protection from hostile CPU-blocking code in the same JavaScript process.

## Verification

Definitive source identities and receipts are in [the evidence index](w3-read-projection-checks/evidence.json), bound to `handoff-inputs.json`.
Earlier passing and failed runs remain separate and are not rebound to the final bytes.

- Required prior focused set plus the two new files: **1088 passed, 0 failed, 0 skipped; 14 files; 367.29 seconds**.
- The original 1059 cases are preserved; the two new files add 29 cases.
- Whole `bun run check` and `bun run check:agents` passed on those inputs.
- Final whole lint and scoped report validation are recorded separately in the evidence index.
- The shared 114 codec vectors through two surfaces still overlap; they are not 228 independently qualified capabilities.

### Actual versus injected boundaries

- The unchanged original W1 model preparation + W2 guarded stock SDK/native launch + real W3 journal case still retains more than 2 MiB, exact canary redaction, more than eight UTF-8 pages, delivered stdin, valid final, original zero close, settled cleanup and one launch/contact.
  **Its 20-second test and 15-second child budgets are unchanged.**
- Original waited Node crash cases and all prior process/auth/lease/unknown controls remain in the focused set.
- New native filesystem cases cover real immutable nodes, committed pointers, multi-segment continuation, stale/corrupt/missing accelerators, selected hashes, no passive writes, cache alias protection and quota stat behavior.
- The large archive has 8200 structural journal rows across multiple original-size segments, 1200 message occurrences and 70 Create-shaped metadata records; it crosses first-page and realtime-ring horizons and survives repeated reopened readers with observed native ranged IO bounds.
  Those shaped rows are not additional W1 admission/task-publication or SDK executions.
  Its 45-second fixture budget covers construction plus several full read traversals; request IO bounds remain unchanged.
- The 13-group horizon fixture yields 187 rows with all 17 active rows, while historical paging returns all 221 rows.
  It carries actual returned allocation IDs for unstarted required sets instead of repeatedly rescanning history to rediscover them.
- A real no-viewer writer drives ring eviction while retained detail remains addressable.
- Actual W1 HTTP/WS uses this writer/projection with fabricated access material: subscribe/snapshot race, atomic updates, deliberately lost final notification, real heartbeat/resync and no viewing-triggered action/provider launch.
  Search/export are explicitly unavailable in that test adapter.
- Check/review/handoff/native-unknown facts in the new focused controls are fabricated owner/public-boundary inputs over real W3 files, not additional real shell, OAuth, provider or scheduler qualification.
- IO-exhaustion timing, lost-notification and slow-observer gates are labelled injections.
  Existing ENOSPC/free-space controls remain injections, not actual disk-full qualification.

Available host: `/usr/bin/node` v26.7.0, Linux x86_64, Bun 1.3.14, installed Pi packages 0.84.3.
No complete repository suite, pack/extracted service, browser/terminal cutover, physical-human/device, paid-provider, Node22, modern Pi1.2, native Windows/macOS/ConPTY or completed-product acceptance was executed.

## Preserved failures and corrections

`w3-read-projection-checks/` preserves all intermediate whole/focused failures and diagnostic runs.
Do not count selector-induced skips or overlapping development reruns as additional capabilities.

The consequential corrections were:

1. Mutable index heads could conceal later entity facts: replaced that trust with original-marker-anchored immutable roots and predecessor proofs.
2. Eager median/last-batch decoding exhausted detail IO before selecting the requested page: hints now choose candidates, and actual selected membership/bytes are validated afterward.
3. Detail budget exhaustion after real progress threw instead of returning a continuation: verified prefixes now advance without a false completion.
4. The native integration's final restart/read work crossed 20 seconds.
   Fixed-field phase/counter diagnostics identified decoder thrash: 4214 retained lines exceeded a 4096-line cache, causing complete misses on repeated scans.
   The cache now spans the active and preceding bounded segments, with copy isolation and unchanged original-byte checks; quota inventory no longer rereads payloads just to count them.
   No native test/child, recording-stall or request IO budget was increased.
5. A new horizon fixture unnecessarily rediscovered already returned allocation data through a bounded full scan.
   It now carries the actual allocated required set, matching the owner contract.
6. A draft archive fixture batched 100 command acceptances together, unlike the real immediate control-flush route, and hit the bounded reader refusal.
   The retained fixture now places one Create-shaped record in each applicable batch; the failed diagnostic remains and is not labelled repaired native admission evidence.
7. Additional development failures covered wrong owner DTO shape, missing W1 attachment routing and mechanical type/formatter mistakes; their logs remain preserved.

Temporary diagnostic hooks were removed.
Original raw numeric diagnostic JSON bytes are retained as `.json.txt` alongside formatter-clean JSON projections.
No actual routes, auth values, provider exceptions or user credential stores are diagnostic fields.

## Remaining work and composition requirements

Continue W3 immediately with:

1. Literal search over every selected retained field, cross-part UTF-8 overlap, exact stable hits, bounded continuations and concurrency limits.
2. Streaming NDJSON/Markdown export from retained readers, full selected scope/provenance/coverage, actual trailer digest/count/EOF, access-generation revocation, cancellation and idle bounds.
3. Real strict-v1 expected-byte publication and bounded labelled summary mapping, including long-result and external-conflict tests; no extra v1 keys or task-directory siblings.
4. Guarded recovery inspection/append under genuine W1 local authority, preserving original unknown facts, damaged bytes and fences.
5. Broader remaining W3 quota/control-exhaustion/recovery/crash composition and any explicit rebuilding strategy for unavailable navigation generations; no rebuild on GET.

W1/W4 must supply real current-environment/review callbacks and compose the actual owner/scheduler/HTTP lifecycle.
W5/W6 still own client cutover and W7 owns exact source/extracted packaging and integrated acceptance.
Legacy rows here are bounded context, not a newly retained legacy plan/transcript.
Receipt/control lookup still uses bounded authoritative observation and can remain inconclusive; no index absence was promoted to dispatch authority.

## Spec-update judgment

The original-marker index root, per-call native IO admission, exact occurrence/content versions, callback-supplied current context, committed-only live publication and decoded-cache non-authority belong in maintained backend storage/service-owner guidance after independent review.
This delegation keeps those specs read-only, so their executable signatures, failure semantics and regression evidence are recorded here for main.
None of this is a sandbox, business-file transaction, certified executor, exactly-once effect guarantee, total-memory bound or universal descendant/privacy guarantee.
