# W3 metadata archive cost — measured handoff

## Disposition

**A bounded index-preparation/readback inefficiency is corrected; the historical timeout cause remains unproven.**
The unchanged8200-row assertion scenario passes below its original45s deadline on the measured host.
The gain is modest, not a guarantee against future deadline failures or evidence that the original50018ms failure was reproduced and repaired.
Independent review and main's consolidated checks remain required before W4 integration/acceptance decisions.
No W3 or product acceptance is claimed.

[Evidence index](w3-metadata-cost-checks/evidence.json) contains exact source/fixture/log hashes, raw aggregate receipts, experiment dispositions and separately bound verification revisions.
The original22-file receipt is copied byte-for-byte into that directory and remains unchanged at its original W2 location: SHA256 `dc8dba5fb84ceaa680a1e49adb4495e60d1494f1654d449e2212df915ee524d2`.
It remains **1234 passed /1 failed**, not a repaired historical pass.
Original event35 and the two historical5s failures remain unattributed; no W2 source was changed.

## Causal observation before optimization

The first instrumented execution used frozen original production, without optimization.
Its43.31s measured phases were:

- Real append/index82×100 rows:37.62s.
- Event paging/restart/zero-result:0.72s.
-1200 message aggregates:3.99s. -70-task listing:0.55s.
- Setup and before/after tree observation: the remainder.

Additional nested attribution on the same original production showed repeated immutable-node discovery plus original private filesystem/lease work dominating preparation/publication.
The proposed partial-message full-archive-scan hypothesis did **not** occur in these executions: message reads used anchored `entityBatches`; no `ForwardValidator` or `RetainedTraversal` fallback was entered.
This discriminates the measured fixture, not the unavailable phase distribution of the older failed run.
No generic load explanation, longer budget or expected-timeout assertion was substituted.

The fixture still performs82 real append/sync/close/index batches,1200 partial-message rows and70 task rows; crosses original4096-record segments; removes **only** `indexes/commits/<latest>.json`; retains the independent latest head/tree; pages events with the existing explicit early-window injection; reconstructs projections; pages aggregates/tasks; and compares all original history bytes.
Existing45s,8MiB/100ms, page/loop bounds and assertions remain.
The initial fixture body was reconstructed by reversing only instrumentation edits and verified against its existing historical SHA256 `79aa8a40d7c727bfbc21110da45805340f9a78e395b31983486169185353d280`.

## Production change

Only two production owners changed:

- `src/history/index-tree.ts`: `heads()` discovers the current batch's prior heads using one synchronous, at-most128-node memo under the same original immutable root.
  Every miss performs the existing safe read, SHA check and closed decode.
  The memo is discarded before update/effects; each separate invocation rereads original bytes, including missing/corrupt sources.
  Results are only the already-required current-batch head set, not an archive map.
  The existing long-lived read cache and its128-node bound remain; no read token, public schema or serialized checkpoint changes.
- `src/history/navigation.ts`: preparation uses that bounded discovery; derived-file create/readback uses its exact encoded length, and replacement uses `max(oldLength,newLength)`.
  The original `RECORD_BYTES` ceiling is explicitly checked independently of that allocation size.
  `IndexTree` creation similarly uses exact bytes after its existing `MAX_NODE` canonical encoder check.

Every native write, file/directory fsync and original lease assertion remains on the same implementation path.
No shared private-files/coordination helper, storage format, crypto, limit, reader membership/absence proof, source attestation, pending-write fence or fallback was replaced.
This does not cache authority across an await or claim hostile-same-user atomic isolation.
There is no multi-target continuation representation, snapshot rebase, new read loop or index repair.

## Same-instrumentation before/after

Final paired runs use byte-identical fixture and aggregate-observer sources, original native IO and unchanged accounting.
Production-before is copied source with only the installed peer link; no source fallback, install or global/private SDK resolution.
Random fixture UUIDs remain random, so radix shapes/file counts vary slightly; native timing and exact syscall counts are not universal invariants.
The separate equal-root test fixes that variable and proves25 identical-root lookups read25× the bytes/calls of one unit, with equal present/absent results and fresh reads on the next invocation.

| Aggregate                                | Frozen before | Changed paired run |
| ---------------------------------------- | ------------: | -----------------: |
| Total measured fixture phases            |     41310.7ms |          40001.4ms |
| Append/index phase                       |     35703.0ms |          34451.8ms |
| Navigation preparation                   |     13589.6ms |          11853.8ms |
| Message aggregation                      |      4004.7ms |           3979.0ms |
| Append/index `lstatSync` calls           |       6056384 |            5568827 |
| Append/index payload read calls          |         91076 |              85478 |
| Append/index requested native read bytes |   13410504585 |         5313794960 |
| Append/index actual payload read bytes   |     164647995 |          161207646 |
| Append/index JSON parses                 |         10115 |               7421 |
| Append/index native hash updates         |         66669 |              61176 |

Requested bytes count the actual native read lengths, including max-sized EOF probes; they are **not** bytes of retained history or actual disk transfer.
Hash/parse totals cover instrumented native SHA/JSON operations; they are not all allocations or total CPU cost.
Nested method times overlap and must not be summed.
The selected head-discovery reuse and reduced readback allocation explain concrete operation reductions; wall time alone is not the evidence.
The paired total gain is approximately3.2%, while preparation improves approximately12.8%.
Original lease checking still accounts for roughly14s; no lease/flush work was removed to make the case green.

Both paired runs have matching within-run before/after tree hashes; the final-source run likewise preserves all4469 files/3540036 bytes with tree SHA256 `f655d624fc2ba2952863bb3415cd985868907c8cde0b2a1a0d4ecdf5ebbb1ad7`.
Cross-run tree hashes intentionally differ because IDs and native fixture identities differ.

## Diagnostics and experiments

`test/helpers/history-metadata-{cost,counters}.ts` records only fixed-name aggregate phase/IO/parse/hash/target counters, timings and two tree digests.
Wrappers retain original receivers/returns/throws and never replace or await original native operations.
Unlike the existing phase helper's Vitest spies, these wrappers retain no per-call arguments/buffers; there is no payload/path/token/exception log.
`test/service-history-projection.test.ts` also replaces its global `vi.fn(readSync)` buffer-retaining argument history with primitive call/requested-byte counters, preserving the exact IO-limit/no-read assertions.
That diagnostic correction alone did **not** materially improve measured time and is not claimed as the old timeout cause.

Preserved distinct experiments are not identical retries hoping for green:

1. Initial original phase measurement, then added nested attribution.
2. Bounded head reuse/exact allocation candidate.
3. An additional original-index read helper experiment reduced some calls but supplied no useful timing gain; it was removed completely.
   `src/history/read-io.ts` matches its original bytes.
4. Original production with bounded diagnostic counters isolates that observer change.
5. Final matched-observer frozen/changed comparison, then broader regressions.

Two development typecheck failures were fixture overload typing (`Hash.update`, then `readSync`), not runtime history failures; logs are retained.
Final self-review caught that passing an exact allocation maximum also needed an **independent original record ceiling**.
The explicit guard and new over-ceiling negative followed the590-case run; this was a source-review correction, not a reproduced native failure.
The subsequent73-case run binds final bytes.
No assertions were weakened, and no historical receipt was rewritten.

## Verification

- Broad affected native/disk/HTTP/portable set: **590 passed /0 failed /0 skipped,17 files,747.60s**.
  It covers no-index/recovery/list/entity, graph/page/detail/search, both exports, source corruption/key/format/pending-source negatives, actual SDK-to-writer recording and HTTP/auth boundaries.
  Genuine cold-process controls and original resource/data limits remain.
  This precedes only the explicit index-size guard and its test; the exact input manifest is retained.
- Final-source follow-up: **73 passed /0 failed /0 skipped,4 files,123.93s**: metadata-cost, projection, native durable history and maximum-graph boundary.
  Its unchanged8200-row fixture measured40.37s; the broader run measured38.91s.
  Three new controls prove equal-root reuse, cross-call changed/missing-source refusal, exact readback allowances and the original record ceiling.
- `bun run check`, `bun run check:agents`: exit0 on final source.
- Final lint is recorded after evidence formatting in the evidence index.

Do not sum overlapping runs or count filtered tests as executed capabilities.
The two paired case-only invocations each ran1 case and filtered23; neither is a full-file pass.
The590 and73 sets have distinct source bindings, not an invented663-case final qualification.

All execution after bootstrap used a fresh0700 ext4 directory, `/home/mirako/abel/.cadence-w3-metadata-cost-zdcU808u`, with explicit equal `TMPDIR`/`TEMP`/`TMP`; available bytes/inodes were checked.
Host: actual `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3 and Vitest4.1.10.
No dependencies/package/task status/specs/credentials/Git refs or consumer history were changed; no cleanup, agents or deployment occurred.
No full repository/pack/extracted product, browser/terminal cutover, physical-human/device, paid provider, Node22/Pi1.2, Windows/macOS or ConPTY acceptance is inferred.

## Independent review / main handoff

Review the memo's synchronous bounded lifetime, unchanged original read/hash checks, absence semantics, exact-length allocation versus independent size ceiling, and primitive observer noninterference.
The actual bottleneck is metadata construction, not the proposed full-archive message fallback in these runs.
The cost correction is measured and the unchanged deadline case is green, but main should retain an explicit unresolved historical-timeout attribution rather than claim a complete causal repair from later passes.
Further optimization of shared private filesystem/lease policy would require an explicit ownership/design handoff; it was not attempted here.
Maintained-spec reconciliation is deferred to main under the delegated no-spec-edit boundary.
