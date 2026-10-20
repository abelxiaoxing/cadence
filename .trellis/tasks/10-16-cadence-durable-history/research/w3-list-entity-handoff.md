# W3 list and entity progress handoff

## Disposition

Implemented finite progress for all nine named list methods and exact task/message/tool entities.
The requested focused suite passes **1265 tests, 0 failed, 0 skipped, 27 files, 1177.33s**, on unchanged before/after source/test hashes.
This is an implementation handoff for independent comprehensive review, **not W3 or product closure**.
No named list/entity path is deliberately left returning unsupported/unavailable because its continuation algorithm is absent.
The broader read limitations and test classifications below remain explicit.

[Evidence, source identities and commands](w3-list-entity-evidence.json) bind this pass.
The earlier1246 pass and all failed historical receipts remain unchanged.
No subagent, commit, deployment, dependency/package change, maintained-spec/status edit, actual credential access or consumer cleanup occurred.

## APIs and correlation

All paths are repository-relative.

```ts
// src/service/contracts/history.ts; exported through src/service-contract.ts
interface EntityReadRequest {
  navigation?: string;
  storeId: string;
  scope: Scope;
  snapshotSeq: string;
  kind: "task" | "message" | "tool";
  id: string;
  version: number;
}
type EntityReadResult = EntityPage | RequestProgress<EntityReadRequest>;
interface HistorySnapshotTransition {
  kind: "snapshot";
  request: ListRequest;
  next: ListRequest;
  coverage: CaptureCoverage;
}
type HistoryReadResult =
  | HistoryPage
  | RequestProgress<ListRequest>
  | HistorySnapshotTransition;
```

- `decodeEntityReadResult` and `decodeHistoryReadResult` own the closed unions.
  `ProjectionPort.entity`, `ServiceClient.task/message/tool` and the wire reply decoder consume the entity union.
- A null-snapshot discovery request keeps its exact request echo while validating the original head across quanta.
  It cannot publish an early prefix as the complete archive.
  Discovery completion returns `kind: "snapshot"` with the exact pinned snapshot in `next`, before data.
  Only this transition may change null to a concrete snapshot; subsequent pages never rebase.
- Progress-only replies contain no records or invented entity.
  Next proofs are sealed against their **own next request**, including any new pinned snapshot or output continuation.
  Reader, scope, limit, snapshot and entity/version are part of the authenticated identity.
- The existing accelerated path can still return a genuine empty data page after scanning a nonmatching prefix, with an advancing source cursor.
  That is not a proof-only response, empty completion substitute, or an unimplemented algorithm returning success.
  Cold preparation instead uses explicit proof progress.
- `src/history/reader.ts#page` propagates the list union through its existing events/contents compatibility surface; it no longer rejects submitted navigation.
- Existing readonly HTTP routing already selects POST for navigation-bearing entity/list requests.
  Actual HTTP/client tests exercise this route and unauthenticated refusal without an admission adapter.
  Neither HTTP implementation nor auth adaptation provenance needed changes.

## Original-source traversal and aggregation

### `src/history/list-progress.ts`

One finite request state separates head discovery, snapshot preparation, output position, one target worker, legacy projection and completion.
It composes the existing `ForwardValidator` and `RetainedTraversal`; there is no second journal parser, writable cursor registry, new index, SDK construction or execution owner.
Both snapshot and target work use the original8MiB/100ms cooperative request budget.
A completed expensive unit is checkpointed before another deadline check; no read quantum is renewed inside a request.

The output worker emits bounded actual pages and keeps at most one entity/run target in progress.
Target scans themselves resume, rather than repeatedly restarting an inner full-history lookup.
The request can return data already collected while preserving unfinished next-target work.
The encoded page fit check includes the echoed request, records, next request and maximum next navigation envelope; the final shared decoder checks the actual whole response against512KiB.

### Shared projection and original locators

- `src/history/entity-state.ts` owns occurrence/version reduction and task/message/tool materialization for **both** accelerated and finite reads.
  Fixed first/latest/result/detail slots hold original-source locators, not prose, rows or arbitrary aggregation maps.
  Final text and accepted task plans resolve their actual original end records in a separately advancing detail-selection phase.
  Partial declarations, unexecuted calls, orphan results and owner-versus-content versions remain distinct.
- `src/history/source-row.ts` reads selected original bytes through existing private-file guards, verifies their SHA-256 and uses the existing journal decoder.
  `ForwardValidator.batch` and `HistoryNavigation.batch` issue locators only from their validated original batch bytes.
  The accelerated entity reader reuses its budget-scoped original batch/stamp/checksum guard rather than adding duplicate row IO.
  Finite readers reread selected original rows before materialization/publication.
- `src/history/run-progress-state.ts` retains a single run/selected-child observation, fixed source slots, bounded counters and coverage, rather than serializing an entire admission, child roster or native result into a token.
  `src/history/run-state.ts#projectRunObservation` is shared with `RunState.projections`; lifecycle/outcome/native facts are not independently inferred by the client or a second run renderer.
  Historical admissions are kept separate from the environment's current/unavailable context.
- Source incarnation/hash and format/key checks remain separate from AEAD authenticity.
  Invalid submitted proofs are not treated as missing acceleration or restarted as seeds.
  Optional absent/unusable indexes do not become authoritative absence.
- Legacy tasks use the existing readonly environment inventory and unchanged v1 records.
  Continuations bind the bounded legacy identity; no import, publication, approval or rewrite occurs.
  A separately executed native cold-read control also loads a real fabricated v1 file through `TaskStore.loadSnapshot` and preserves its exact bytes.

The fixed navigation plaintext ceiling remains6000 bytes and encoded ceiling8192 bytes.
Graph/detail/search/export implementations, crypto representation, worker/model/auth/admission ownership and all production limits remain unchanged apart from shared source-locator plumbing.
Format2 remains readonly with its existing legacy limits, not silently keyed/migrated.

## Verification

All shell/build/test commands used the new mode0700 disk-backed root: `/home/mirako/abel/.cadence-w3-list-entity-eFj8CF`, with TMPDIR/TEMP/TMP set together.
No old temporary root was cleaned.
The available native host is `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14 and installed Pi0.84.3.

### New suites

`test/service-history-list-entity.test.ts` has15 cases:

- All nine categories, both null discovery and exact snapshots, through a fresh ordinary Node process for **every** continuation.
- An exact8MiB original predecessor, two genuine recovery appends, preserved torn/uncommitted bytes, missing indexes and an explicitly malformed latest head.
- Exact expected record count/order/versions, no duplicates, semantic checkpoint advancement, full encoded response size and unchanged history bytes.
- Six exact entity selections, including a late Create, partial/final message versions and partial/final/orphan tools.
- A genuinely empty selected checks/changes/reviews range remains empty only after complete traversal; it is not fabricated feature completion.

The archive uses actual native append/flush/close and original waited producer exit77.
Its task/capture/accounting/check observations and recovery confirmation are fabricated fixture inputs, **not additional native tool/check/human execution**.
Unrelated canonical synthetic check observations make the archive large without inventing thousands of selected task items.
The new archive setup and multi-continuation case budgets are90s/120s; each cold native child retains15s.
No existing SDK20s/child15s, read100ms/8MiB or capture5s bound was increased.

`test/service-history-list-contract.test.ts` has4 cases:

- Closed snapshot/entity progress selectors and GET/POST routing.
- Genuine issued proofs through actual W1 HTTP, wire decoding and `ServiceClient`, with auth refusal/no history effects.
- Wrong kind/scope/limit/version/snapshot, cross-purpose/tampered proof, original-source corruption and changed private key refusals.
- Nonempty finite check lists retain historical native exit0/pass facts while unavailable current context produces stale and configured not-run obligations separately.
  The native facts in this last case are injected history observations, not a newly run shell check.

Existing assertions explicitly consume/narrow progress through `test/helpers/history-data-read.ts`, rather than casts pretending progress has records.
The prior broad corruption, exact-hit detail, graph, search, both exports, real W1/W2/journal integration, native SDK/process and original timing controls remain in the27-file run.
The19 new cases are included in1265; overlapping development reruns are not added.
`bun run check`, `bun run lint` and `bun run check:agents` all exit0.
Lint retains only the two pre-existing informational package-audit notices; no suppression or ignore was added.

### Additional legacy control

An excluded probe, separately labeled rather than added to the suite total, performed real cold native list/entity continuation over the recovered archive while loading an actual fabricated strict-v1 record through `TaskStore`.
It observed43 list progress replies,42 entity progress replies, both retained tasks, exact legacy revision7, unchanged history and unchanged v1 bytes.
An earlier Bun-hosted probe is preserved as development evidence and is **not** the native receipt.
The corrected ordinary-Node probe and its source/bundle hashes are in the evidence index.

### Preserved development failures

- The initial sparse fixture tried noncanonical whitespace padding; the real journal decoder correctly refused it.
  The fixture now uses canonical actual records, not relaxed decoding.
- Its initially chosen20s aggregate setup budget did not cover the new multi-recovery archive fixture.
  The new setup/case budgets above describe orchestration; all original production/native limits are unchanged.
- A four-minute shell diagnostic cutoff is preserved, not called a completed test.
- An initial one-record-only finite output strategy exceeded an existing100-page assertion.
  The implementation now accumulates bounded pages; the assertion was not relaxed.
- An attempted conversion of already-valid accelerated zero-result data pages into fresh cold proof scans added avoidable work and exceeded an existing45s case.
  It was removed: real scanned-prefix pages retain their existing representation, while unavailable preparation uses the new proof representation.
  Temporary phase diagnostics were removed; their logs remain.
- Initial type/format issues were fixed without `any`/progress casts or warning suppressions in owned tests.

None of these observations explains the **older two5s failures** or the older W2 bash unknown.
Those historical causes remain unresolved, separately tracked, and are not relabeled repaired by1265 passing tests.

## Remaining boundaries

- Independent comprehensive review follows; this report does not mark task/parent acceptance complete.
- No known unimplemented continuation remains in the nine named list methods or exact task/message/tool entity methods.
- `workspace()`, active/recent `snapshot()` and `checkObligations()` retain their existing bounded current-view contracts and have no new request/progress union.
  Their synchronous preparation can still refuse on a sufficiently large cold index-free source; this pass does **not** qualify those distinct bootstrap/current-view paths as arbitrary-archive readers.
  Main must judge/resolve that broader composition boundary before claiming all W3/service reads complete.
- The actual W4/environment inventory remains responsible for bounded legacy/current context loading; a callback that cannot finish within its budget is not silently made unbounded here.
- The new large native matrix has nonempty task/run/message/tool/content/event data; nonempty check progress is separately exercised on real small files, and existing change/review regressions remain.
  It is not evidence that every possible nonempty large check/change/review combination, maximal16-child checkpoint or malicious source rewrite was executed.
- Supported-writer immutable history is not hostile same-user CAS or an atomic attestation of every retired source file forever.
- No whole-repository/package/extraction/browser/terminal cutover, physical-human, paid-provider, Windows/macOS/ConPTY or Node22 qualification was run.
  W7 still owns package membership for new maintained files.
