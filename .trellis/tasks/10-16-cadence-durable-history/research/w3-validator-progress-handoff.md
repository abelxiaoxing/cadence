# W3 finite validator, search and retained export handoff

## Disposition

**Core finite traversal is implemented and its positive targets executed.
W3/product acceptance is NOT claimed.**
The final requested 24-file run has **1237 passed / 2 failed / 0 skipped** (759.84s).
Both failures hit unchanged 5000ms deadlines in `test/service-history-live-detail.test.ts`:

- `check native exit and historical pass stay distinct from stale current obligations`
- `a pending asynchronous observer never holds original commit settlement, and capacity is finite`

Their separate unchanged-source diagnostic passed **2 / 0, with17 filtered skips** in2.34s.
That does **not** repair the failed broad receipt, establish a cause, or make the broad count1239 passed.
Main must resolve/qualify those failures and commission independent review.
List/entity/graph progress and the remaining accelerated-detail limitation below also keep W3 open.

[Evidence, exact source hashes and original logs](w3-validator-progress-evidence.json) bind this pass.
The1215-case prerequisite receipt and all earlier freeze identities remain historical.
The old LIMITATION assertion was replaced by actual completion, not another passing refusal.
No task state, maintained spec, package/dependency, worker/model/auth source, Git state, credential store or deployment was changed.

## Production boundaries and APIs

All paths are repository-relative.

| Owner                                         | Implemented behavior                                                                                                                                                                                                                                                                              |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/history/validator.ts`                    | `ForwardValidator.next(budget)`, `checkpoint()`, `batch(pointer,budget)`, `revalidate(budget)` and strict `decodeValidator`. One forward original-byte/sequence validator; no recursive recovery replay in this traversal.                                                                        |
| `src/history/retained-progress.ts`            | Closed finite `RetainedProgress`: snapshot/output/finish/done, one output validator plus at most one end/overlap/admission worker, fixed snapshot/end/admission witnesses, coverage and at most1023 overlap bytes. No serialized rows, batches, reference lists, whole lines or recursive stacks. |
| `src/history/retained-traversal.ts`           | Resumable snapshot, output, actual end lookup, exact same-field/link overlap, selected frozen admission lookup and tail observation. One worker is reused, not nested validators. Exact inline content in the already-proved snapshot batch avoids a second archive scan.                         |
| `src/history/search.ts`                       | Production issuance/opening of authenticated finite checkpoints; meaningful state/position advancement; full response headroom; ordinary envelope-free exact hits. `RetainedScan.renew()` changes the budget, not the logical iterator.                                                           |
| `src/history/export.ts`                       | One private `RetainedScan` survives every renewed quantum. Original field-end/hash accounting, encoded counts/digest, one trailer/EOF, abort boundaries and coverage remain. Format2 export needs no key or browser token.                                                                        |
| `src/history/detail-progress.ts`, `reader.ts` | `readRetainedDetail` and `HistoryReader.readDetail` produce genuine data-or-progress replies for submitted detail proofs and cold/no-head-index reads. Exact anchors do not depend on the searcher's RAM hints. The existing `detail` primitive remains for accelerated/legacy reads.             |
| `src/history/projection.ts`                   | Production detail routes use `readDetail`. Cursor ingress returns `progress-needed`, not a second independent membership scan or a claim of completed proof; the named reader performs original-budget validation.                                                                                |
| `src/history/read-proof.ts`, `read-io.ts`     | Native AEAD remains the authenticity boundary. Completion metadata IO is prepaid at its actual selected size; safe incarnation checks and bounded actual-prefix reproof handle a supported append, never a silent snapshot rebase.                                                                |
| `src/history/files.ts`                        | Required-admission identity-hash read seam; existing raw admission selection/decoding remains. Recovery rechecks its pinned key after awaited guards and before subsequent body/marker/publication effects, including after original close.                                                       |

No shared cursor/worker DTO, HTTP/auth/wire/client implementation or provenance body changed in this pass.
The prior sole-editor handoff already supplied the additive replies and readonly POST route.
The HTTP destination hash still matches its existing provenance entry.

### Original-source validation

Validator phases are `select`, `locate`, `decode`, `members`, `admission`, `commit`, `ready`, `eof`, `done`.
Raw SHA advances over bounded original ranges, including complete uncommitted rows and the final fragment.
A located complete line is reread/decoded independently; completed unit coordinates are installed before another cooperative budget check.
The admission subphase carries only its selected run ID/canonical identity hash, allowing the required original file read to resume separately from decoding a large source row.

Commit admission checks actual sequence/count/body checksum and exact marker artifact membership.
The finite ordered-set check avoids a quadratic serialized join: a source reference must match a marker entry; its first appearance must be the next marker ordinal, while repeats may only point backwards to equal metadata.
The bounded transient marker map rejects duplicate keys; reaching every ordinal proves no missing/extra entries and preserves first-occurrence order.
No marker/reference array enters a token.

A recovery bridge must be the next segment's first row at byte0 in its single-row commit.
It is compared with actual preceding size/raw SHA/high sequence/committed sequence/committed offset, including preserved uncommitted rows and torn bytes.
Original publication fences are checked before exposing a committed pointer and selected batch.
The old administrative scanner remains an independent differential oracle and is still used by nonconverted administrative/reader paths; no browser proof enters admission, receipt conclusions, recovery or lock release.

### Budget and source semantics

The original8MiB/100ms cooperative request limits,8192 encoded/6000 plaintext proof limits, native20s/15s lanes,5s recorder stall and download idle policy are unchanged.
Before a bounded synchronous unit, proof completion prep reads current format/key and reserves the bytes for its two exact metadata rereads in the **same original** budget.
Only this prepaid finite completion can run after a completed synchronous unit crosses the cooperative deadline; it cannot renew a work budget or read arbitrary bodies.
Selected-format/key reads, source rereads and prefix reproof are charged; whole response decoding counts echoed and next tokens.
Native cold fixture construction separately opens the format before the named operation; it does not supply hidden key/hash authority.

Current format/key and active/selected source incarnations are revalidated.
Changed active predecessors, same-byte key replacement, different keys and format replacement refuse.
A supported same-inode append can reuse an immutable selected prefix only after actually rereading/hash-comparing that prefix; large/unfinished reproof can still refuse under the original budget.
It never silently rebases the requested snapshot.

This authenticates prior bounded observations under supported-writer immutability, **not an atomic current-byte snapshot of every retired archive source**.
Fixed slots cannot retain all old incarnations; arbitrary older edits after retirement, same-user change-and-revert, OS stamp collisions and races after observation are not universally detected.
All existing warm/cold corruption negatives remain in the requested run.

## Executed positives and negatives

### Original blocker and causal repair

The originally captured pre-edit bundle was replayed on a real new exactly8388608-byte predecessor plus785-byte recovery bridge:15 pages, no hit, final `receipt-inconclusive`, `featureComplete:false`.
The retained fixture uses actual append/flush and original waited producer exit77, with fabricated local recovery confirmation—not a real operator consent claim.
Its construction was batched in32-row writes after the old one-row producer exceeded its existing15s fixture budget; no production deadline increased.

The new native tests require:

- Exactly8MiB predecessor, no index authority, a **new ordinary Node process for every search and detail continuation**, exact hit owner/range/content SHA and unchanged history tree.
- A second genuine recovery after a complete uncommitted row plus torn fragment, not a no-op committed marker; the same forward validator reaches the exact result.
- Both full NDJSON and Markdown exports with independent encoded counts/digest/trailer/EOF checks and retained target text; recovery coverage remains incomplete/gap rather than fabricated full source coverage.
- Cold exact-hit detail through actual progress/data replies, not RAM hints or a copied search token.

Early new-engine runs refused after materializing an entire batch consumed the quantum before any output unit advanced.
Lazy, bounded selected-row decoding fixed that repeated-unit defect; metadata/admission state is preserved before subsequent checks.
The first combined detail probe found that an empty `indexes/` directory was incorrectly treated as usable acceleration; routing now tests for a head hint and selects real finite detail preparation when absent.

### Long fields, export and transport

- Native-process continuations resolve an end and a1023-byte same-field UTF-8 overlap across **more than8MiB of interleaved original metadata**.
  Actual suspended end and overlap phases are observed; hit range/content, detail text and both complete exports are checked.
- A separate9MiB retained field is exported fully in both formats for format3 and a deliberately constructed readonly format2 fixture.
  Independent reconstructed field hashes/byte counts plus encoded stream counts/digest/trailer are required.
  Format2 has no selected proof key and its bytes remain unchanged.
- The9MiB fixture was changed to await each bounded recording input after its earlier bulk pipelining hit the unchanged5s recorder guard.
  This is export-fixture ingress control, **not** a repaired production recorder or a faster-producer qualification.
  Existing W2 pipeline/native controls are unchanged.
- Proof-only export cancellation is scheduled at a real validator boundary: no output frame/trailer and no subsequent validator read after observed abort.
  No heartbeat/export keepalive is invented.
- A genuinely issued production proof traverses W1 readonly POST and `ServiceClient`; missing access refuses, rotation invalidates the old attachment, and newly authenticated access can resume unchanged history.
- Existing cookie/Origin/CSRF/capability, export write-boundary revocation, native SDK and original pending-write accounting controls are retained in the requested broad command.

### Finite state and corruption

- Actual incremental completion is compared with the independent administrative scanner's commit sequence/high sequence/original raw hash.
- Reachable validator checkpoints and compound output/worker states are roundtripped; the1023-byte overlap, all three witness slots and the full256-character admitted stamp-slot ceilings fit6000 plaintext/8192 encoded bounds.
  Padded tuples are **codec ceiling fixtures**, not claims of real OS incarnations or exhaustive platform qualification.
- Independently sealed unknown phase, impossible offset/hash count, extra fields and oversized overlap refuse; valid AEAD alone does not make a checkpoint valid.
- Genuine progress followed by active-source/key/format replacement refuses without repair.
- Recovery same-byte key reincarnation at both journal and post-sync observer boundaries refuses, preserves the replacement/original bytes and coordination, and retains incomplete-write fencing.
- Original forged-high-sequence coverage remains; six additional checksum-recomputed cases exercise size/hash/committed-offset/committed-sequence/placement/marker-previous claims.
  The committed-sequence/marker pair cases overlap semantically; they are not independent extra capabilities.

## Verification and preserved failures

Fresh0700 disk roots, always explicit `TMPDIR`/`TEMP`/`TMP` for product/test commands:

- `/home/mirako/abel/.cadence-w3-validator-session`
- `/home/mirako/abel/.cadence-w3-validator-final`

Old roots were not cleaned.
Available host: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.
Initial disk observations were758GiB available and60,702,241 free inodes.

- Final all-history plus prior ten-file command: **1237 passed,2 failed,0 skipped;24 files;759.84s**.
  All newly added24 cases passed in this run.
- Same-source two-deadline diagnostic: **2 passed,17 filtered skips**; separate, not added to the broad count.
- `bun run check` and `bun run check:agents`: exit0.
- Lint is recorded in the evidence file after formatting that file; no suppressed warnings or changed test deadlines.
- Before/after final broad-run source hashes are equal.

Preserved development failures include direct Node strip-only invocation, a missing `./` Bun entry, two timed-out original fixture constructions, the initial syntax typo, finite batch-materialization refusals, empty-index detail routing, tests assuming a single data reply, the multi-segment45s failure, HTTP fixture session/epoch mismatch, bulk9MiB recorder exhaustion, one220s interrupted diagnostic command, and later5s/30s timing failures.
The exact-snapshot inline optimization repaired the additional second-scan cost without increasing the original45s test deadline; subsequent focused and final broad multi-segment tests passed.
The broad5s failures remain unresolved.
Variable native fixture setup/commit latencies were observed, but neither disk behavior nor unrelated load is asserted as their proven root cause.

## Exact remainder / main handoff

1. Independent review of the new validator, checkpoint invariants, source attestation, prepaid completion accounting, scope/admission lookup and export lifecycle is still required.
2. Resolve or qualify the two broad deadline failures under their original bounds; an isolated pass is not whole-suite acceptance.
3. List readers do not yet issue finite progress; entity/graph progress variants are not composed.
   These paths retain their older bounded/inconclusive behavior.
4. Detail uses the finite path for submitted proofs and missing head acceleration.
   A present but unusable/insufficient accelerator can still enter the old bounded path and refuse; this is **not** claimed as universally repaired large-detail preparation.
5. Large supported append reproof may refuse; no unrestricted continuation during concurrent churn is promised.
   Strict source changes never silently rebase.
6. Further maximal metadata/admission/reference stress and hostile-source timing review remain appropriate.
   The executed codec-ceiling and differential tests are not a proof of every legal history's latency on every platform.
7. No full repository/distribution/browser/terminal/service-owner composition, paid-provider, physical-human, Windows/macOS/ConPTY or Node22 acceptance was executed here.
   W4/W5/W6/W7 and parent acceptance remain separate.

No commit, publication, task closure, maintained-spec update or W3 acceptance is authorized by this handoff.
