# W3 blocker repair — partial; integration remains blocked

## Disposition

**The native throughput and cold-detail verification failures have repairs and fresh passing evidence.
The recovered-archive search/export progress blocker is NOT fixed.**
This does not fulfill the delegated full repair and does not accept W3 or the product.
The existing named LIMITATION case still passes only truthful refusal/preservation; it is not successful complete-navigation acceptance.
No unavoidable shared-contract defect has been established: remaining proof/long-field work still belongs to W3, not an implicit handoff to another owner.

The final focused suite reports **1194 passed / 0 failed / 0 skipped, 20 files, 545.21s**.
That includes the unchanged limitation/refusal case and therefore does not make the feature scope green.
Independent recheck remains required even for the repairs described below.

## Boundary and preservation

Read the active task context, canonical parent design/plan and both mandatory appendices, actual history implementation, frozen interfaces and final failed receipts.
Changed only four history implementation files, two existing history tests, three new history test/helper files and this new research/evidence set.
No shared W1/W2 implementation/contracts, package/lock, maintained specs, task status, Git index/refs, consumer stores or previous evidence were changed.
No agents, actual credentials, installation, deployment, commit, push, merge or cleanup were used.

All test/build/helper invocations selected a new0700 root, `/home/mirako/abel/.cadence-w3-repair-Qpb7l5P5`, with `TMPDIR`, `TEMP` and `TMP` explicitly set.
It is on the existing **ext4 disk**, not the inode-exhausted shared `/tmp` or a faster replacement tmpfs.
At the first probe the disk had760GiB available and60875205 free inodes; the final inventory records814774677504 available bytes and60803429 free inodes.
The old review root and shared `/tmp` remain untouched; `/tmp` still had only70 free inodes in the final capacity observation.
The unchanged deliberate namespace-only16MiB ENOSPC control remains separate from ordinary fixture storage and passed in the full set.

## Native throughput: observations and correction

The preserved previous final attempt timed out the actual W1 model preparation → W2 stock SDK/native child → W3 durable writer case.
Its native15s and test20s budgets, greater-than2MiB content, delivered stdin, original close/exit, final/cleanup, canary, one-contact/one-launch and retained-page assertions are unchanged.

An opt-in fixture-only profiler records fixed aggregate counts/times, never payloads, credentials, exceptions or per-event logs.
It measures actual `HistoryFiles`, navigation, private-file and original native `FileHandle.sync` calls.
Nested timings are **inclusive and cannot be summed**.
The isolated before probe passed but was near its test limit; it does not erase the prior native timeout.

| Observation                                                   | Before isolated probe | After final full run |
| ------------------------------------------------------------- | --------------------: | -------------------: |
| Entire native test, including preparation/settlement/readback |            19554.92ms |           17806.42ms |
| Original journal appends                                      |                    70 |                   71 |
| Validated batch encodings                                     |                   140 |                   71 |
| Encoding time                                                 |             1697.65ms |             672.66ms |
| Original journal syncs                                        |                    70 |                   71 |
| Original journal sync time                                    |              115.02ms |             142.65ms |
| Derived active publication calls                              |                    70 |                   71 |
| Derived active publication time                               |              660.44ms |              87.61ms |
| Private creates / replacements                                |             553 / 238 |            491 / 173 |

Batch counts can vary with actual ingress scheduling; the regression invariant is **one encoding per append**, not an identical batch count or a faster-machine timing assertion.
The same70-append intermediate comparison reduced the test to17725.51ms, encodings to70 and replacements to171.

The evidence does not support blaming journal fsync latency alone.
Repeated canonical encoding, unchanged derived-roster rewrites, private-path revalidation and index publication consumed substantially more observed time.
The native case has no concurrent history viewer: reader/writer contention was not its prerequisite.
No global environment speed claim or universal throughput guarantee follows.

Repairs:

- `src/history/files.ts` exposes only exact encoded row/trailer **sizes** to a synchronous pre-append charging callback.
  The original validated bytes are encoded once, charged before any append effect and then written through the unchanged append/sync/selected-byte/close publication fence.
  The callback cannot replace the encoded body.
- `src/history/writer.ts` charges that exact encoding instead of serializing/validating the batch twice plus separately canonicalizing each row for quota accounting.
- `src/history/navigation.ts` coalesces part-head updates within a batch.
  Unchanged active membership is not rewritten/fsynced on every progress watermark.
  Reads still require the immutable anchored active hash and an index sequence between that membership's last change and the requested snapshot; an index cannot authorize effects.
- Artifact flushes, journal flushes, original promises, quotas, control headroom and unknown fences remain intact.
  No faster-only filesystem, smaller content, fabricated references or longer deadline was substituted.

## Cold detail: observations and correction

The original final failure occurred on the initial requested read, before the later corruption assertion.
The first isolated warm-process probes passed; this was insufficient discrimination because writing primes the bounded decoded-line memo.
A new ordinary Node helper performs the same first read in a **fresh process**, with no decoder cache or warmup.

With only the first navigation refactor, both cold controls still failed:

- Snapshot-segment case: `receipt-inconclusive`,442.41ms.
- Intervening-segment case: `receipt-inconclusive`,490.70ms.

Those failures are preserved, not relabeled flaky.
The actual cause included thousands of canonical fixed `owner-epoch` records repeatedly passing generic descriptor/tree serialization and cloning, plus a separate marker-search pass followed by rereading/redecoding the batch.

Repairs:

- `HistoryNavigation.nextBoundary` now uses the same original validated batch traversal as `next`; snapshot roots/positions are registered from that parse instead of independently parsing JSON, rereading the payload and decoding it again.
- Per-row time admission checks remain in batch and forward decoding.
- `src/history/types.ts` recognizes the **entire exact canonical fixed owner-epoch representation**, then uses the existing shared ID/sequence validators.
  Other variants still use the complete existing decoder.
  Duplicate keys, noncanonical whitespace, bad IDs/sequences, extra keys and unknown variants still refuse.
  Each fast-path result is a fresh object, not mutable shared decoder authority.
- Both existing corruption cases now require a separate original Node process to return the exact expected content hash/length before the original warm read and subsequent altered-prefix refusal/preservation assertions.

Final cold-process receipts: **66.66ms** and **71.49ms**, each an actual successful11-byte read under the unchanged100ms admission window, native exit0/null signal/empty stderr.
These timing values are evidence, not new test thresholds.
No full-prefix integrity check was removed to obtain them.
The narrowly optimized fixed record is not a claim that every possible unindexed point lookup now fits100ms.

## Additional regression discovered by the first full attempt

The first full changed-input run was **1193 passed / 1 failed**.
The multisegment metadata fixture required at least one zero-result page by assuming4000 small epoch rows would necessarily consume100ms before reaching matching messages.
The faster exact decoder legitimately removed that timing prerequisite; all records had been returned, but the zero-page count was0.

The fixture now explicitly injects one early `receipt-inconclusive` **after the first genuinely read/validated nonmatching batch**.
It retains restart-cursor advancement, wrong-reader refusal, native byte admission, all1200 messages/events, all task identities and unchanged historical bytes.
This is labeled deterministic scheduling coverage, not observed native disk latency or an increased budget.
The targeted six-case run then passed; a missing TypeScript receiver annotation in the new spy was corrected before the final typecheck and full rerun.
No identical full-suite rerun was used to seek green.

## Still-open required repair

`HistoryFiles.validateRecovery` still starts `scan` at byte zero through the predecessor segment.
`HistoryNavigation.validateBridge` and `recoveryAfterTail` invoke that proof while navigating a bridge.
A greater-than8MiB archive therefore requires more than one request's original8MiB allowance inside a single nonresumable subproof.
Advancing `RetainedScan.prepare`'s outer position does not advance this inner proof; the next call repeats it.
`exportHistory` reuses the same proof path, so it has the same unresolved complete-export gate.

`RetainedScan.hasEnd`, `ending` and overlap lookahead also keep their forward-search position only in the current call.
A long field with an end beyond the window, particularly among interleaved fields without usable indexes, needs independently resumable lookahead rather than repeatedly restarting at the same begin/chunk.
The required successful cold/restart/missing-or-stale-index/repeated-recovery and long-field acceptance controls were **not implemented in this pass**.

Do not replace original predecessor sequence/committed-offset/raw-byte/placement checks with a caller-supplied digest or treat the existing cursor's publicly recomputable binding as authenticated proof.
Do not skip a corrupt prefix, rebuild indexes on reads, enlarge windows or convert the existing limitation test into a weaker success assertion.
Main should continue this W3 implementation boundary and require actual successful complete search and both exports before requesting W3 acceptance.
This report proposes no hidden shared-schema change or feature cut.

## Break-loop analysis

### 1. Root cause category

- **B — Cross-layer contract:** W2's bounded pipeline made W3's per-commit canonical/index costs visible inside the unchanged native deadline.
  A sink accepting batches is not evidence that its durable native path has adequate progress.
- **D — Test coverage gap:** warm writer/reader processes and tmpfs passing receipts concealed cold decoding and disk-backed aggregate costs.
  The limitation test asserted refusal, not the required completed navigation.
- **E — Implicit assumption:** outer cursor advancement was mistaken for resumability of every nested integrity/lookahead operation; the zero-page fixture also assumed a minimum execution time.

### 2. Why earlier local fixes missed the failure

1. Strengthening bridge integrity correctly rejected invented sequence gaps, but reused a whole-prefix scanner without carrying its progress.
   Correct refusal did not preserve feature progress.
2. Earlier batching fixes measured encoded ingress sizes but did not account for duplicate canonical work and derived metadata rewrites in the real durable consumer.
3. A warm decoder memo made cold correctness depend on incidental earlier operations.
   Removing one redundant parse was insufficient: the fresh-process counterexample still failed until the fixed-record decoding cost was addressed.
4. A timing-dependent zero-page assertion became invalid after genuine optimization; deterministic scheduling is now explicit rather than slowing production to satisfy the fixture.

### 3. Prevention mechanisms

| Priority | Mechanism                                                                                     | Status                |
| -------- | --------------------------------------------------------------------------------------------- | --------------------- |
| P0       | Original15s/20s native SDK → durable disk path, original completion/secrecy/readback gates    | Passed on final bytes |
| P0       | Fresh-process positive detail reads before original corruption negatives                      | Added and passed      |
| P0       | Resumable nested bridge/end/overlap proofs with cold complete-navigation acceptance           | **Open**              |
| P1       | Deterministic one-encoding-per-append and no identical active-roster rewrite invariants       | Added and passed      |
| P1       | Exact canonical fast-path parity and invalid-form/mutation regressions                        | Added and passed      |
| P1       | Zero-result continuation through a labeled early-budget schedule, not minimum machine latency | Corrected and passed  |

### 4. Systematic expansion

Review nested proof work in search, export, inline-detail and snapshot membership together: bounded outer loops do not bound or resume their callees.
Review derived metadata work separately from durable artifact/commit ordering; coalesce accelerators rather than weakening the authority path.
Keep cold-process and real-disk fixtures distinct from injected schedules, warm caches, native journal sync timings and overall SDK test duration.

### 5. Knowledge capture

This new report captures the analysis because maintained specs were explicitly read-only in this delegation.
Main's eventual maintained-spec update should require nested-proof progress, fresh-process positive controls and mechanism-count performance invariants.
No spec synchronization or commit was performed contrary to the ownership/commit prohibition.

## Evidence and remaining qualification

[Evidence index](w3-blocker-repair-checks/evidence.json) binds the final92-file input manifest, logs, profiles and runtime/filesystem identity.
Final manifest bytes remained unchanged after the full run; all previously manifested shared/package inputs remained unchanged.
The final total is **213 history cases +981 prior-ten-file cases**, not a sum of development reruns or the two embedded cold-process controls.
The114 shared codec vectors still overlap across two entry surfaces.
Whole `check`, `check:agents` and final `lint` are recorded separately.

Available host: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3, ext4 fixture storage, public proxy startup capability present and Linux bwrap ENOSPC control available.
No full repository/pack/extracted service, scheduler/client cutover, browser/terminal product, physical-human/device, paid-provider, Node22, modern Pi1.2, Windows/macOS or ConPTY qualification occurred.
The passing native ENOSPC test is still lower-level isolated failure-boundary evidence, not an admitted SDK run bypassing the unchanged free-space floor or a power-loss proof.
**W3/product completion remains blocked by the unresolved functional progress requirement and independent recheck.**
