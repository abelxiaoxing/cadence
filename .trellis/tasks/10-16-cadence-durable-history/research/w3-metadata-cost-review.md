# W3 metadata-cost independent review

## Disposition

**No remaining blocking finding in the assigned metadata-cost boundary.**
The final production guard/memo revision is ready for main's consolidated source/native checks and subsequent W4 integration; this narrow review does not close W3, qualify W4 composition or accept the complete product.
The historical50018ms failure, event35 and the two historical5s failures remain unexplained, not repaired by later green runs.

Read the active child manifest/artifacts, curated context, full parent PRD/design/plan and both mandatory appendices before review.
Inspected the current dirty-tree inventory, the complete handed-off patch and final source, adjacent private-file/lease/read paths and original test assertions.
The six final handoff source hashes matched before edits.
Only the diagnostic helper and metadata-cost tests changed; no production source, shared private-files/lease policy, worker, public contract, crypto/format/limits, package/dependencies, spec, task status or Git state was modified.
No nested agent, cleanup, installation, deployment or credential operation occurred.

[Evidence and exact source bindings](w3-metadata-cost-review-checks/evidence.json) retain the commands, failed counterexample, successful final run, aggregate phase receipt and input manifests.
Existing reports/receipts and temporary roots remain untouched.

## Production review

- `src/history/index-tree.ts`: `heads()` creates a new local memo, calls only synchronous `find/load` under one original root, and discards it before `update` or any await/effect.
  Eviction keeps at most128 decoded nodes; the returned map contains only requested current-batch heads, not the archive.
  Every miss retains `PrivateFiles.read`, original SHA verification and closed decoding.
  The pre-existing read-budget cache cannot satisfy a writer miss: no-budget writer discovery/update does not match its budget-reuse branch.
  Separate discoveries and updates reread selected bytes; missing/corrupt nodes refuse, not cached absence or repair.
- `src/history/navigation.ts`: `prepare()` preserves key/auth/active-head semantics while sharing prior-root discovery.
  Native update/publication/lease/flush paths are unchanged.
  `write()` explicitly checks `RECORD_BYTES` before charging/effects, independently of its exact readback allocation.
  Creation uses the encoded size; replacement uses `max(previous.bytes.length, newBytes)`, preserving both shrinking and growing original-file checks.
  Node creation still passes through the separate `canonicalJson(node, MAX_NODE)` ceiling.
- Existing selected-reader fallback and journal-membership checks remain unchanged.
  No on-read index repair, snapshot rebase, token change, authority reuse across awaits, accepting persistence fallback or weakened pending-write fence was introduced.
  Supported immutable-history coordination is not hostile-same-user CAS or an atomic archive snapshot.

## Finding fixed and added controls

**Diagnostic-only noninterference defect:** `metadataCost()` replaced `JSON.parse` with an arrow that first called `Buffer.byteLength(text)`.
Native `JSON.parse(null)` succeeds, but the observer threw before native parsing; it also dropped the receiver.
The new regression failed on the original helper with that exact TypeError.
The fix uses an ordinary function and `Reflect.apply` with original receiver/arguments, counting bytes only for actual strings without extra coercion.
It preserves returned object identity, reviver/native exceptions and one-time source coercion.
This does not change production parsing and is not a cause attribution for the old archive timeout.

Changed paths:

- `test/helpers/history-metadata-cost.ts`: the narrow parse observer fix.
- `test/service-history-metadata-cost.test.ts`: five additional review cases.

New controls cover:

1. Observer parse coercion/receiver/result/opaque-throw identity, wrapped method receiver/result/throw, native hash return identity and fixed primitive counter state after1000 calls.
2. A real immutable radix fixture with129 distinct leaf routes plus branch/root nodes: the first leaf is evicted and safely reread, then reread again on the next invocation.
3. Hash-valid unknown-key, malformed-JSON and over16KiB node files refuse and preserve bytes; the independent node encoder ceiling refuses before charge/effect.
4. Source corruption after discovery and an await is not reused by update; an explicitly injected lease refusal still prevents node/head publication.
5. Real growing/shrinking private-file replacements retain exact old/new allowance and readback contents.

The original equal-root25-lookups-to-one-unit, changed/missing node, record-ceiling and exact allocation controls remain.
Observers retain fixed primitive counters/timings and two tree digests, not native argument/buffer histories.
The fixture's original full before/after byte assertions remain deliberately intact; this is not a claim to bound total test/SDK heap usage.
Lease faults and method-boundary observer controls are labelled injections, not spontaneous native ownership races.

## Measurement and historical evidence

Verified hashes for the prior paired phase receipts, metric receipts, command logs and original failed22-file receipt.
The original failure remains1234 passed/1 failed, with its unchanged historical receipt hash.

The frozen-before comparison really measures8200 structural rows in82 append/index batches,1200 partial messages and70 tasks.
Append/index takes35.70s of41.31s and performs6,056,384 `lstatSync` calls.
Message aggregation uses anchored `entityBatches`; the receipts show no `ForwardValidator`/`RetainedTraversal` fallback in those phases.
Thus the measured bottleneck is metadata construction, not the proposed quadratic message full-archive scan.
This says nothing conclusive about the unavailable phase distribution of the older failed run.

The prior paired total41.31s→40.00s is a modest approximately3.2% gain, supported by concrete discovery/readback operation reductions.
Random fixture identities affect tree shapes; requested read lengths include EOF probes and are not actual transferred/history bytes.
Nested method timings overlap and cannot be summed.
Neither this pair nor the current pass attributes or repairs the historical50018ms failure, event35 or two old5s failures.

Current final-source structural fixture phases:

| Phase                               | Observed time |
| ----------------------------------- | ------------: |
| Setup                               |       86.65ms |
| 82 real100-row append/index batches |    32691.97ms |
| Before-tree observation             |      163.97ms |
| Event paging/restart/zero-result    |      682.46ms |
| 1200 message aggregates             |     3961.59ms |
| 70 task listing                     |      418.33ms |
| After-tree observation              |      178.06ms |

Total measured phases: **38183.02ms**, within the unchanged45000ms scenario budget.
Before/after4443 files and3565722 bytes have the same tree SHA256 `d5891f22d7b5f0557135b4cf23895817ede1751486f34c3d8d2a9bbc82146fb3`.
No timing threshold, native budget, read quantum, assertion, count or loop bound was loosened.
This is one final execution, not repeated identical green-seeking or a new runtime upper-bound guarantee.

## Verification and limits

Final command:

```sh
bun run test -- test/service-history-metadata-cost.test.ts test/service-history-projection.test.ts test/service-history.test.ts test/service-history-graph-boundary.test.ts
```

**78 passed /0 failed /0 skipped,4 files,122.45s**: original73 cases plus five review controls.
It includes the existing actual SDK-to-durable-writer, filesystem/crash, projection/HTTP and maximum-graph assertions; structural fixtures and injections are not additional provider/platform capabilities.
Do not add this total to overlapping prior590/73-case runs.
`bun run check`, `bun run check:agents` and final `bun run lint` passed; exact logs are bound in the evidence index.

All execution used a newly allocated0700 ext4 root, `/home/mirako/abel/.cadence-w3-metadata-review-177OEInW`, with identical explicit `TMPDIR`/`TEMP`/`TMP` and checked available bytes/inodes.
Actual host: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.
No tmpfs or namespace/subprocess substitute was used for qualification.

Preserved development failures: the intended observer counterexample; one test-only formatting/lint finding corrected before final tests; initial identity collection incorrectly tried an unexported package metadata subpath, then used a filesystem-only package metadata read without SDK construction.
The first new-report formatting check also preceded creation of its linked evidence file; it fixed table alignment and reported that temporarily missing link, which was then created and checked.
None is hidden or relabelled a native history failure/pass.

Main still owns consolidated source/native checks, W4 composition and maintained-spec reconciliation.
No full repository/pack/extracted product, browser/terminal cutover, paid-provider, physical-human/device, Node22/Pi1.2, Windows/macOS or ConPTY acceptance is inferred.
