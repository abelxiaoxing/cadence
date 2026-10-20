# W3 literal search and streaming export handoff

## Disposition

Implemented the assigned search/export surface over the reviewed retained journal and projection.
`HistoryProjection` now implements **the complete `ProjectionPort`**, including working search and export methods, without an unavailable/empty accepting adapter.
**W3 and the complete product remain open.**
Actual strict-v1 expected-byte publication and guarded recovery are the next pass, not claimed implemented here.
Independent review of this pass remains required.

Loaded the task context, prior semantic/read handoffs and independent review, accepted W1/W3 interfaces, W2 producer/review, relevant specs, parent PRD/design/plan and both mandatory appendices.
Inspected the actual frozen cursor/search/export codecs, common encoder/tracker, portable client and W1 HTTP download/export/read accounting.
No agents, installation, deployment, real-account credentials, task-status changes, commits, staging, push or cleanup were used.

## Changed owners

- `src/history/search.ts`: literal search and the shared retained traversal, source-position cursors, exact selected fields, immutable selection ownership and source-addressed inline projections.
- `src/history/export.ts`: full retained NDJSON/Markdown generation, original field integrity, bounded formatting, provenance, digest/count/watermark trailer and abort checks.
- `src/history/navigation.ts`: narrow snapshot-at-position seam and finite readonly source-locator memoization; no index publication on reads.
- `src/history/reader.ts`: exact inline goal/handoff navigation, frozen-plan selection membership and full-JSON-size-aware UTF-8 detail paging.
- `src/history/projection.ts`: concrete full-port wiring, search cursor ingress validation and reuse of the existing run projection reducer.
- `test/helpers/history-read-fixture.ts`, `test/helpers/history-read-child.ts`: fabricated retained content and an ordinary fresh Node read producer.
- `test/service-history-search-export.test.ts`, `test/service-history-search-scope.test.ts`, `test/service-history-export-http.test.ts`: 27 new cases.
- `test/service-history-live-detail.test.ts`: additional search/detail/export assertions on the existing genuine committed handoff fixture; its original rejection assertions remain.

Compared with the previous review's source manifest, the only changed previously existing files are navigation, reader, projection and the last test above.
The writer, semantic reducer, private codecs, W1/W2/shared/public/HTTP/model files, package/lock, maintained specs and earlier reports/evidence remain byte-identical.
New files are listed separately in the final input manifest.

## Concrete interfaces

```ts
// Full existing shared port; no new wire request/response convention.
HistoryProjection.search(cursor: ReadCursor): Promise<SearchPage>;
HistoryProjection.export(
  request: ExportRequest, signal: AbortSignal,
): AsyncIterable<ExportFrame>;

// Internal search entry, used by the projection and focused maximum-page tests.
searchHistory(reader: HistoryReader, cursor: ReadCursor,
  limit: number = LIMITS.pageEntries): Promise<SearchPage>;

// Internal shared retained traversal and exact snapshot-address validation.
RetainedScan;
HistoryNavigation.snapshotHint(seq, budget);
HistoryNavigation.snapshotAt(position, seq, budget);
```

The frozen public search request has no limit field: the public method defaults to50, while the internal implementation supports the existing maximum200 and512KiB encoded-page bound.
No private RPC field was added to evade that interface.
The existing `ServiceClient.export`, `ExportTracker`, `encodeExportFrame`, HTTP routes and authentication implementation were not modified.

## Search and retained navigation

Search uses case-sensitive UTF-8 byte comparisons, not regex, shell, provider calls or a realtime ring.
It traverses retained goal, plan, context/message/final text, canonical tool arguments/updates/results, owner check/change/review content and exact supplied dependency projections.
The same scan selects export content.

- Continuations bind store, selected scope, query, committed snapshot and source position, including the next byte within a chunk.
  They contain no epoch, auth token, writable cursor registry or process-local continuation requirement.
- Missing indexes can require an incremental snapshot-proof scan first.
  These requests return advancing zero-hit continuations, not false absence or a repeated scan from byte zero.
  Once proven, the cursor carries the selected original snapshot address, which is reread and validated on continuation.
- Metadata, selected artifacts, overlap and snapshot checks share one original `HistoryReadBudget` per search request.
  Native payload capacity is admitted before reads; the existing8MiB/100ms bounds were not raised.
  These are cooperative bounded-read checks, not preemption of an indefinitely stalled native synchronous filesystem call.
- Overlap follows only the same content ID and contiguous stored offsets.
  It never joins unrelated fields.
  After a hit the next scalar boundary is used, retaining overlapping matches without duplicating/skipping hits at a page limit.
- Hits retain exact UTF-8 ranges, original content identity/version and an independently usable detail cursor.
  Record occurrence versions are not replaced by content versions.
- A run/child can select a task-owned plan through its exact committed frozen graph.
  That selection is owned by the immutable run/child occurrence, **not** an invalid task entity with a run link bolted onto it.
  The graph retains the original task/plan identity; the content reference remains unchanged.
  Other draft plans and sibling transcript bodies are excluded.
- Inline goals and supplied handoffs get deterministic source-addressed public projections, not fabricated persisted artifacts or SDK occurrences.
  Their detail reads validate the original retained row/slot and selection.
  Handoff content records retain the genuine source reference and dependency index, with the reviewed range in the frozen graph/owner fact.

The additional source-locator memo holds at most2048 entries/2MiB of accounted metadata across stores.
It contains no transcript bodies, does not survive process restart and never writes an index.
Every selected locator still resolves through the original committed batch and real part hash.
Part-count hints cannot override the existing actual on-disk count with a smaller count learned from one earlier part.
Original fallback-prefix revalidation remains: the earlier warm-detail interior-corruption regression still passes unchanged.

Standalone point lookups retain the reviewed bounded refusal policy when their snapshot/content membership cannot be established within the budget.
An inconclusive lookup is not absent content or permission to execute; this pass does not introduce an on-read rebuild or promise arbitrary damaged large-store point navigation.
The new full-scan search/export continuations do not require such a rebuild.

## Export, coverage and privacy

Both formats use the same retained traversal and source checks.
There is no DOM, preview, recent-ring or fixed archive-size cutoff.
Only bounded batches, one selected artifact, active field digests and the finite active run set are retained in memory.

NDJSON carries the existing `cadence-public-export/2` manifest, public records, frozen graph/identity, content ranges and completion trailer.
Markdown emits only the frozen manifest/Markdown/trailer frame variants through the **same common encoder**.
It has readable identity/observation headings, indented literal text ranges, frozen JSON metadata and explicit coverage.
Arbitrary recorded fences are not executable output.

Actual provenance comes from immutable graphs/model/role identities and captured context/source ranges, not reconstructed prose or invented timestamps.
The manifest hashes the actual exporter module file in source execution; a generated service will hash its actual bundle at the same `import.meta.url` seam.
This source-module identity is not a claim of a qualified release or whole-development-closure attestation.
Generated service/package behavior remains W7 qualification.

Artifact content is checked against actual part bytes and the full aggregate content hash.
A field digest remains live until its real committed end, not merely until a chunk claims the expected length.
Native execution, recording, publication and historical unknown states use the existing `RunState` projection, not a second outcome reducer.
Private auth-preparation/credential/control envelopes are never exported as transcript records.

The original trailer:

- counts every preceding frame and exact `encodeExportFrame` bytes in the selected format;
- hashes those exact bytes, excluding the trailer;
- names the pinned committed watermark;
- distinguishes capture/source/redaction/omission coverage from reaching the traversal boundary.

Source-limited/redacted-but-complete-as-observed content can finish traversal without claiming complete original source.
A torn suffix or unfinished retained field remains explicitly incomplete.
Corrupt selected parts, aggregate mismatch, unavailable required membership or abort cannot manufacture a complete trailer.
Normal unfinalized prefixes without a committed content reference remain a recording gap, not invented completed detail.

Detail pages additionally check actual complete JSON encoding size.
Ordinary256KiB pages remain unchanged where they fit; heavily escaped text is split on a UTF-8 scalar boundary before the512KiB DTO limit, with a truthful advancing continuation.
Export uses smaller bounded text chunks and validates every full frame through the common decoder.

## Actual W1 route/client composition

New tests compose the real retained writer/reader/projection with the **unchanged** W1 HTTP server, authentication, HTTP transport and `ServiceClient`.
They exercise:

- local-header search/detail and typed `/export` for both formats;
- cookie-authenticated `/download` returning actual chosen-format bytes with attachment/no-store headers;
- absent credentials refusing private downloads;
- actual response-write callback rotation, before another reader payload/trailer;
- independent W1 digest/count/ordinal/EOF checks rejecting missing, trailing, malformed and wrong-digest adapters;
- two canceled exports retaining slots until their original gated adapter reads settle;
- two canceled searches retaining slots until original validation settles, with no late source search;
- the real120000ms idle registration, with explicitly injected timer firing rather than a claim of a120-second native timing test.

The original HTTP access-generation recheck remains before each bounded output write and before requesting another original source item.
The client withholds the trailer until original EOF.
No replacement trailer, task cancellation, mutation replay or SDK/auth construction is added on a read.
The existing actual HTTP/WS live suite also remains in the final run; its older live-only adapter deliberately refuses search/export, while the new route tests use the full implementation.

## Verification and evidence classification

[Evidence index](w3-search-export-checks/evidence.json) binds commands, output hashes and the82-file final source/test/package input manifest.
Final inputs were identical before and after the run.

- **1140 passed, 0 failed, 0 skipped;17 files;440.60 seconds.**
- This is the prior1113-case set plus27 new cases:159 history cases and the unchanged981-case prior ten-file set.
- Whole `bun run check`, `bun run lint` and `bun run check:agents` passed; final post-report receipts are recorded separately.
- Shared114 codec vectors through two entry surfaces still overlap; they are not228 independent capabilities.
- Overlapping development runs are not added to these totals.

Available host: `/usr/bin/node` v26.7.0, Linux x64, Bun1.3.14, installed Pi coding-agent0.84.3.

### Genuine native/filesystem boundaries

- Actual immutable journal/part files, multi-segment append/fsync, missing indexes, large retained text beyond2MiB, selected scope, exact source bytes and unchanged stored-tree hashes.
- A1200-row Create-shaped archive spans multiple segments and exceeds8MiB of metadata.
  Search has zero-hit continuations, reopens readers, selects the late exact goal and exports both full selected formats.
  Create-shaped source facts are not actual TaskStore publication evidence.
- Two ordinary fresh Node read processes exercise cold no-index mid-chunk continuation at the old snapshot and an exact late source-addressed detail.
  Their original waited exit0, null signal and empty stderr are asserted; these are read processes, not SDK workers.
- Actual W1 HTTP writes, cookie/header admission, common client transport/tracker and selected-format downloads over real retained files.
- Real modified artifact/journal bytes demonstrate corrupt-part, torn-tail and aggregate-hash failure without repair or a fabricated completion trailer.

The original guarded **W1 preparation → W2 stock SDK/native launch → real W3 journal** case still retains more than2MiB, exact canary redaction, original native zero close, delivered stdin, valid final, settled cleanup, one launch/contact and paged retained detail.
Its **20-second test /15-second child budgets are unchanged**.
The seven original waited crash windows and prior native auth/check/process/unknown controls also remain in the executed set.
New large export fixtures use fabricated owner/capture inputs over real storage; they are not additional paid-provider/SDK executions.

### Explicit injections and limits

Worker field/lifecycle, role/model and limited/redacted fixtures are closed public DTO inputs, not newly observed provider-wire events.
Read-window scheduling, gate stalls, response-write rotation timing, adapter corruption and idle firing are labelled injections around real boundaries.
They do not qualify native disk-full, an indefinitely blocked filesystem syscall or a wall-clock120-second idle lane.
Existing ENOSPC/free-space observations retain their prior injected classification.

No whole repository suite, pack/extracted service, generated build, browser/terminal cutover, physical-human/device, paid provider, Node22, modern Pi1.2, Windows/macOS or ConPTY qualification was executed here.
No W3 or parent acceptance criterion was marked complete.

## Preserved failures and corrections

All intermediate logs remain in the new evidence directory; earlier reports/hashes/failures were not edited.
The significant corrections were:

1. Strict task ownership cannot be relabelled with a run ID: frozen selections now use the real immutable run/child occurrence and retain the original content reference.
2. Export graph requests cannot spread format/search-cursor extras into the closed graph request.
3. A source-locator count from one early part must not hide the later real part count.
4. An experimental general direct-source snapshot shortcut bypassed the original warm fallback interior-prefix check; it was removed, and that unchanged regression was rerun successfully.
5. Inline goal/handoff fields need their own source-complete handling, not an awaited artifact-end event.
   The first full run retained1139 passes/1 failure before that correction; the final1140 pass is on the corrected frozen inputs.
6. Early fixture failures included syntax, graph plan-version mismatch, a scheduling threshold that did not actually exhaust the read window, and formatter idempotence.
   None was repaired by raising a native SDK/child/request budget or weakening the original safety assertions.

## Next pass and spec judgment

Continue immediately with actual strict-v1 expected-byte publication/labelled summaries and guarded recovery under genuine W1 local authority, then the remaining W3 quota/crash/recovery composition.
W1/W4 still own production owner/scheduler/current-observation composition; W5/W6 own client cutover; W7 owns generated distribution and complete integrated acceptance.

Maintained specs were read-only in this delegation.
After review, main should document the full projection signatures, source-position search continuation, immutable plan/dependency selection ownership, actual encoded-size paging, original end/digest/EOF rules and bounded locator non-authority.
These are supported-owner history/coordination guarantees, not exactly-once effects, a business-file transaction, total process-memory bound, sandbox or universal privacy/descendant guarantee.
