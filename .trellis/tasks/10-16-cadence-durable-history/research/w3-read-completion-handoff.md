# W3 read completion — partial handoff

## Disposition

**The delegated task is NOT finished.
W3 and product acceptance remain open.**
This pass implements unusable-accelerator detail preparation and explicit cold graph progress.
It does **not** implement finite list aggregation or entity progress.
A fresh full requested focused run passes **1246 tests / 0 failed / 0 skipped,25 files,799.77s**, but those remaining features have an independently executed failing completion probe below.
The earlier1237/2 receipt remains failed; its two timeout causes have not been established by the new passing run.
Independent full review is still required.

[Evidence and source hashes](w3-read-completion-evidence.json) record exact inputs, commands, logs, native/injected classifications and unfinished work.
No existing report/hash, task state, package/dependency/spec, worker/model/auth/launch semantics, real credential store, deployment or Git state was edited.
No agent was spawned and no old temporary root was cleaned.
The active task resolved to `.trellis/tasks/10-16-cadence-durable-history`.

## Implemented boundaries

All source paths below are repository-relative.

### Detail preparation

- `src/history/reader.ts#readDetail` retains the ordinary accelerated data path and directly resumes submitted proofs through `readRetainedDetail`.
- For format3, the accelerated attempt and fixed completion metadata IO share **one original** `HistoryReadBudget`.
  Only `receipt-inconclusive` from an initial accelerator attempt selects an explicit progress reply.
  It does not renew the read window or run a second scan within that call.
- `src/history/detail-progress.ts#detailPreparation` seals the transition from the completed unsuccessful acceleration attempt into original-source preparation.
  That first proof contains initial original-source coordinates, not invented content or a partial successful page.
  The next request bypasses acceleration; subsequent replies must advance the actual validator state/address.
- Submitted navigation is never caught and restarted as a seed.
  `invalid`, genuine selected-source corruption and changed selected identity are not caught by the new outer fallback.
- `src/history/navigation.ts#partRange/partCount` classify malformed **accelerator decoding** as unavailable acceleration.
  These narrow catches do not surround artifact/source reads.
- Existing nonempty ranges, exact content versions/offsets, ordinary envelope-free exact-hit anchors and format2 readonly behavior remain.

Actual new tests exercise malformed counts, missing part directories and malformed range hints with a present head.
Every detail continuation runs in a new ordinary Node process, verifies the entire encoded response bound, exact text/ranges/content and unchanged source tree.
The test decrypts genuine progress only inside the fixture to compare semantic checkpoints, not just random ciphertext inequality.
A tampered submitted proof and actual journal corruption refuse without new-seed fallback.

The existing exact8MiB recovery fixture now also runs `probe-bad-head`: a present invalid head before cold search, exact-hit detail and both full exports.
The original `probe` and `probe-twice` controls remain, with original waited producer status77, actual preserved torn bytes and the same read/native budgets.
Fabricated local recovery confirmation remains explicitly distinct from human consent.

### Graph point preparation and transport

```ts
interface GraphReadRequest {
  navigation?: string; // existing8192-byte opaque structural limit
  storeId: string;
  scope: Scope;
  snapshotSeq: string;
  graph: { recordId: string; revision: number; sha256: string };
}
type GraphReadResult = GraphPage | RequestProgress<GraphReadRequest>;

HistoryReader.graph(request: GraphReadRequest): Promise<GraphReadResult>;
ServiceClient.graph(request: GraphReadRequest): Promise<Reply<GraphReadResult>>;
decodeGraphReadResult(value: unknown): GraphReadResult;
```

- `src/service/contracts/history.ts` owns the additive request/union decoder; `src/service-contract.ts` exports it.
  The existing data-page shape is unchanged.
- `src/service/ports.ts`, `src/service-client.ts` and `src/service-wire.ts` consume the union and retain exact outer request correlation.
  Progress cannot change store, scope, snapshot or graph identity.
- `src/history/read-proof.ts` adds only the domain-separated `graph` purpose using the same format/key/AAD/AEAD boundary.
  It does not change auth, worker/capture schemas, limits or execution authority.
- `src/history/graph-progress.ts` uses `RetainedTraversal`/`ForwardValidator`, the shared point decoder and the existing original admission decoder/hash check.
  Its finite checkpoint holds original source coordinates and validator witnesses, never serialized graph/admission bodies or whole-history arrays.
  Snapshot validation and selected admission reads use the same original budget; incomplete work is explicit progress.
- `HistoryReader.graph` keeps its simple indexed path for ordinary requests.
  Initial acceleration exhaustion transitions once into the original-source path; submitted graph proofs go directly there without reset.
- `src/service/http.ts` and `src/service-http-client.ts` did not need edits: their existing finite readonly body routing already covers graph/navigation requests.
  The HTTP source hash and `provenance/auth-reuse.json` remain unchanged.

A real9MiB multi-segment no-index fixture completes graph navigation through fresh native processes on every continuation.
It checks exact graph/plan/model identities, strict full-response size, semantic proof advancement and unchanged history.
The genuine native-issued proof then crosses the actual W1 HTTP server, shared wire decoder and `ServiceClient` over readonly POST; unauthenticated POST refuses401.
The fixture provides no admission adapter and performs no SDK/command effects.
A separately labeled injected transport vector rejects mismatched graph replies; codec vectors cover unknown fields, oversized navigation and changed selectors.

## Two old5s failures: diagnosis, not a claimed repair

The historical failed cases are unchanged in name and **5000ms** budget:

1. `check native exit and historical pass stay distinct from stale current obligations`
2. `a pending asynchronous observer never holds original commit settlement, and capacity is finite`

`test/helpers/history-phase-metrics.ts` adds opt-in, fixture-only aggregate instrumentation via `CADENCE_W3_PHASE_LOG`.
It records setup/commit/admission/observation/read/teardown timings and bounded method counts/times/pending counts.
It logs no payloads, paths, tokens, credentials or exception bodies.
Wrappers return the exact original result/promise, observe settlement on a separately handled branch and do not replace native/file promises or reporting deadlines.

Inspected `HistoryWriter.enqueue/schedule/notify/deliverNotice`, `HistoryLive.drain/pump/close`, navigation preparation/publication and these actual fixture bodies:

- Derived index preparation/publication is synchronous within the serialized original writer operation, not a detached index writer.
- The original append promise remains awaited and charged; reporting timers clear after original settlement.
- Notifications start through `setImmediate`; one original async callback per viewer can remain pending, independently of writer settlement.
- These two cases have no HTTP listener/keepalive or child-process teardown.
  Their check native facts are **injected history facts**, not a newly executed shell command.
  Their journal append/flush/close operations are real filesystem work.
- No fake timer was active at either measured case's start or finish; wall and monotonic durations agree within rounding.

Measured on the new disk-backed root:

| Phase / case                    | Before cleanup correction | Fresh broad run |
| ------------------------------- | ------------------------: | --------------: |
| Check-obligations whole case    |                  741.63ms |        768.66ms |
| Check setup                     |                   85.39ms |         88.13ms |
| Check reads                     |                   43.69ms |         43.69ms |
| Pending-observer whole case     |                  781.60ms |        826.39ms |
| Observer setup                  |                   84.67ms |        101.25ms |
| Observer notification wait/work |                   48.62ms |         55.77ms |
| Observer held-commit            |                  145.17ms |        165.69ms |
| Observer teardown               |                    0.24ms |          0.23ms |

The broad check case's four original appends measured33.63/34.12/29.66/22.72ms.
The observer case's four measured25.67/32.12/35.54/41.13ms.
All observed original append pending counts were0 at report completion; the observer case also asserts writer pendingWrites0.
Index publication took75–119ms per measured commit, including nested guarded metadata IO and fsync-bearing create/replace calls.
These nested timings overlap and must not be summed into an invented wall-time explanation.
They do not isolate kernel fsync latency from descriptor/path/canonical validation or prove what happened in the old failing process.

**Fixture lifecycle correction:** the pending observer gate release, unsubscribe and `HistoryLive.close()` now run in `finally`, not only after all assertions pass.
This prevents assertion/error paths from bypassing fixture cleanup.
It is a source-identified lifecycle defect, **not a demonstrated cause of the historical timeouts**.
No production writer/live scheduling behavior changed.

The original failures provide only overall5138/5333ms timing, not phase/native-IO traces.
The whole-file pre-change diagnostic, targeted after-control and new broad run did not reproduce them.
Consequently no causal conclusion about leaked work, disk contention, fsync, CPU load, clock mocks or setup budgeting is justified.
No test-budget increase is recommended: measured setup is about0.1s, not evidence that5s is inappropriate.
The historical timing cause remains an explicit qualification blocker rather than being relabeled repaired because a later run passed.

## Actual unfinished functionality

A new ordinary Node diagnostic used the same real9MiB no-index graph archive, all original read limits and production `HistoryProjection` methods.
It tried every list reader with both null and exact snapshots, then an exact accepted-Create entity near the archive end.
The fixture source tree stayed unchanged.
The diagnostic process exits0 only to preserve observations; **this is failed feature-completion evidence, not19 passing tests**.

| Boundary                                                                             | Actual result                                                   |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| tasks/runs/messages/tools/contents/events/checks/changes/reviews, snapshot discovery | All9 refuse `receipt-inconclusive`; no advancing typed progress |
| Same9 list readers, exact committed snapshot                                         | All9 refuse `receipt-inconclusive`                              |
| Exact retained Create task entity at the selected snapshot                           | Refuses `receipt-inconclusive`                                  |

Machine-readable results: `/home/mirako/abel/.cadence-w3-read-completion-GcoiqN/remaining-probe.json`.

The remaining implementation is already authorized; this is **not** a request for another routine approval or permission to narrow scope:

1. `HistoryProjection.page/tasks` still reject submitted list navigation.
   `HistoryNavigation.latest/snapshot` discovery must become resumable before selecting a first-page snapshot; no early-head or empty-complete substitution.
2. `HistoryProjection.entityAt/batches/records/runState` still prepare aggregated entities/runs through bounded synchronous scans/arrays.
   Compose finite original-source locators and one shared target reducer, not arbitrary serialized rows or a second state-inference protocol.
   Inner aggregation must itself advance across windows; merely wrapping the outer page scan will still stall forever on a cold target.
3. Entity request/progress union, shared decoder/port/client correlation and readonly transport composition remain unimplemented.
   Do not claim graph completion also supplies entity completion.
4. Complete all list/aggregation/exact-entity/recovered-snapshot controls, then rerun the full requested focused set and commission independent full review.
5. The original two timeout causes remain unresolved as described above.
   Keep phase instrumentation available for the next causally comparable failure; do not retime or call the old failures repaired without evidence.

The separate old W2 bash diagnostic remains tracked in [its unchanged report](w2-bash-failure-source-diagnosis.md).
No W2 source was edited under this read scope.

## Verification and preservation

Fresh root: `/home/mirako/abel/.cadence-w3-read-completion-GcoiqN`, mode0700, ordinary `/dev/sda2` storage, not tmpfs.
Every shell/test/build command explicitly set TMPDIR/TEMP/TMP to that root.
Available space remained about757GiB with over60million free inodes; old/exhausted roots were preserved.

Available environment: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.

- Full all-history plus prior ten-file set: **1246 passed /0 failed /0 skipped**,25 files,799.77s.
  Seven added cases: three cold degraded-detail cases, one proof/source-corruption case, one native large-graph plus HTTP case, one portable graph/client vector, and one exact8MiB bad-head mode.
- Focused final point/transport file:6 passed,0 failed,28.61s; overlapping, not added to the broad total.
- `bun run check`, `bun run lint`, `bun run check:agents`: exit0.
  Lint retains only the two pre-existing informational package-audit notices; no warning suppression or broad formatting ignore was added.
- Frozen broad before/after hashes are equal.
  The existing actual W1 preparation → W2 stockSDK → real journal greater-than2MiB case and original exact8MiB/repeated-bridge/full-export/crypto/key/format/source-corruption/native-capture lanes are included.
- The initial scoped formatter warning/error and all diagnostic logs remain preserved; final touched-source formatting/checks are clean.
- No full repository/package/extraction/browser/terminal/service-owner integration, physical-human/paid-provider, Windows/macOS/ConPTY or Node22 qualification was executed here.

This is a partial engineering handoff with a fresh regression run, not completion of the delegated task or the complete redesign.
