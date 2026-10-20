# W2 canonical reservation correction

## Disposition

**Demonstrated over-reservation repaired; original native event35 cause remains unknown.**
Ready for the main session's independent W2 check, not W2/parent/product closure.
A new, separate W3 metadata-projection timeout keeps the broad integration command failed.
Do not relabel either historical failure or infer all native scheduling cases from these controls.

Active task resolved to `10-16-cadence-worker-capture` through `task.py current --source`.
Read the complete manifests, W2 artifacts, parent PRD/design/plan and both appendices, W3's complete `w2-bash-failure-source-diagnosis.md`, all five referenced original logs, relevant specs, installed public declarations and official SDK/message/session documentation.
Installed Pi0.84.3 declarations and actual behavior govern, not newer global documentation.
No agents, repository Git operations, dependency changes, credentials, deployments, shared DTO/limits/history/model/auth/scheduler/spec/task-status edits or cleanup were performed.

All new execution used a fresh0700 disk directory, with TMPDIR/TEMP/TMP explicitly set: `/home/mirako/abel/.cadence-w2-bash-diagnosis-Pyvrcivz` (**E** below).
Filesystem inspection reports `ext2/ext3`, not tmpfs.
Exact source/peer/executable/log hashes and command classifications are in [the evidence index](w2-canonical-reservation-evidence.json).

## Discriminating original-code control

`test/helpers/worker-canonical-overlap.mjs` uses the exported `CaptureEmitter`, `CaptureQueue`, `SdkCapture` and `ToolIngress` with a valid begun single tool occurrence.
Three tiny own-data updates each carry242 charged ingress bytes.
A controlled Writable holds its first original callback; no SDK private code, production capacity, timeout, scheduling or update payload is changed.
The same three updates are compared with one-at-a-time original settlement.
Original event promises govern ingress release; the fixture releases the held callbacks and waits originals/drain, including on failure.
It validates update association, exact decoded UTF8 detail, ended details and final selection on the positive path.

Before (E/`17-frozen-before.json`):

- Serialized: three fulfilled, no failure, all leases released.
- Overlapping: two fulfilled, third rejected at **queue-reserve**, requesting **1114112 data bytes**.
- First-fault snapshot: data/total bytes2229750, data/total slots7, active canonical details3, active updates3, ingress3/726 bytes, pending writes2/800 bytes.
- 2229750 +1114112 exceeds the unchanged3145728-byte data allowance.
- After the rejected original settles, two pending writes and2229508 charged bytes remain.
  They are not refunded until their original callbacks settle.
- A worker-failure control still fits; there is no successful final.
  Original cleanup reaches zero bytes/slots/ingress.

The frozen before execution uses byte-identical pre-edit copies of the three Cadence modules, current frozen shared JS codec and identical final fixture helpers in E/`original/`.
Its sole `node_modules` link points to the already installed project peers; no installation or global/private SDK fallback.
This is an **injected Writable/source-snapshot counterexample**, not a native reproduction of event35.
The first direct pre-edit run (E/`02-overlap-before.json`) showed the same arithmetic; it is preserved, not summed as another capability.

After (E/`18-final-after.json`): both serialized and overlapping paths have three fulfilled originals.
The overlapping held snapshot is **198534 bytes**, including three ingress copies/726 bytes and three pending writes/1200 bytes.
Three canonical details and three updates really overlap; all leases return to zero after original settlement.
The queue high-water still reaches3MiB because the existing synchronous `reserveSource()` briefly reserves all available data capacity before measurement/shrink.
That is **not**3MiB of observed persistent output retention, and was not changed to improve the graph.

## Production change and ownership

Only these production files changed:

- `src/worker-capture.mjs`: remove the unconditional1MiB canonical surcharge; keep `4 * knownLiteralBytes +65536` text/prefix/expansion allowance.
  Pass the actual queue reservation function into canonical traversal.
- `src/worker-redaction.mjs`: require that reservation function; charge sorted-key tables before push/sort, key sanitization/escaping/comparison before copying, and bounded string slices before slice/projection.
  Hold leases across generator yields, nested traversal and awaited writes.
  Transfer comparison ownership before releasing the prior key lease.
  Finally blocks release only lexical copies no longer in use, never original emitter leases.
- `src/worker-redaction.d.mts`: declare the internal generator reservation parameter.
  No common worker/service DTO, limit or port change.

Canonical own-data traversal already exists; reusing its `TextSanitizer` is safer than serializing raw sensitive subtrees into a new parser.
The partial/owner lexer is unchanged.
The8192-byte completed-key ceiling matches the existing downstream lexer; oversized keys now refuse before worker key serialization rather than relying on owner refusal.
Sensitive subtrees, sorted/collision checks, malformed own-data refusal, finite depth/node measurement and known-secret/UTF8 behavior remain.
Charges conservatively cover key references/storage, sanitized keys, escaped output, source slices and known-prefix expansion; they are not an assertion about all transient SDK/V8 allocations or total heap/RSS.
No new unbounded queue, serialized callback backlog, source pacing, capacity increase, refund-on-timeout, raw spill, retry or weakened guard was introduced.

## Fixture observation and native receipts

`test/helpers/worker-accounting-observer.mjs` observes only exported Cadence classes.
It records fixed first-failure branches, requested bytes/lane, queue counts, active canonical/update counts, pending writes and ingress, bounded high-water values and allowlisted event counts.
Wrappers return the original promise and rethrow the original failure; observation does not delay, refund or replace work and does not inspect exception properties.
Its final hardening uses own-data/nonthrowing event/descriptor observation and saturating counters.

`test/helpers/worker-accounting-preload.mjs` opens exactly one bounded private receipt before loading the **unchanged** bash guard, then retains only that write/close capability.
It does not change the guard's exact permitted commands, working directory, process or network policy.
A transparent spawn observer returns the original child and counts native stdout/stderr chunks plus original shell exit/close.
It is not a private SDK patch or a new permitted host operation.
No payload/command/source-ID/auth/header/env/exception/stack fields enter these receipts.

`test/worker-capture.test.ts` keeps the actual shell positive and full expected redacted tool result unchanged:77849 raw bytes,77834 redacted result bytes, two model requests, empty working directory, empty successful stderr, final/zero original close.
All native SDK budgets remain20s/test and15s/child.
`onNative` independently retains required-stdin delivery, final and original worker close; request counts are separately measured.
Only fixture observation/receipt assertions were added, not a slower/reduced positive or an expected overload result.

Native results:

- One instrumented original-code positive passed before the repair (E/`03-native-before.log`); active updates high-water1.
  This did not reproduce the old failure.
- The broad run's repaired positive passed; readonly and intentional invalidUTF8 lanes also passed.
- Final42-case worker regression ran after fixture-only observation hardening; the same unchanged native positive and negatives passed again.
  This is overlapping verification, not another independent product capability or a retry after a native failure.
- Native positive receipts show exact raw bytes, shell exit0/close, worker completed/exit0/direct-child-close, delivered stdin, valid final, two requests, zero remaining queue/ingress and equal entered/settled updates.
- InvalidUTF8 remains worker failed/exit1/final missing with delivered stdin and one request, despite observed shell exit0.
  The observer's `first:null` there means none of its instrumented branches observed the bash-internal decoding fault, **not** absence of a worker failure.
- Public BashOperations.exec's exact promise identity and worker stdout/stderr EOF are not separately exported by this observation.
  Native shell exit/close, SDK update settlement and `onNative` facts must not be substituted for unavailable facts.

No new failed native bash attempt was observed.
Thus there is **no native first-fault receipt connecting H1 to event35**.
Original event35's callback partition, active details, failing operation, bash settlement and request count remain unrecoverable from its retained log.
All five old log hashes still match W3's diagnosis.

## Verification and preserved failed experiments

| Execution                                 | Actual result / classification                                                                                          |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Frozen before / final after controls17–18 | exit0 each; asserted original rejection versus corrected exact completion; injected Writable, not native cause evidence |
| Final worker controls19                   | **42 passed /0 failed /0 skipped**, two files; deterministic negatives plus actual native positive/readonly/invalidUTF8 |
| Broad boundary run12                      | **1234 passed /1 failed /0 skipped**,22 files; failed integration command, not overall PASS                             |
| check / lint / check:agents               | exit0; lint retains two unrelated pre-existing informational useTemplate notices in package-audit tests                 |

The22-file run covers all worker public/capture/recording controls, installed public Agent capability/overlap behavior, service contracts, owner/auth/model context, legacy process/SDK/store controls and eleven durable-history files, including real SDK-to-durable-writer integration.
The W2 production bytes were unchanged between this run and final worker controls.
Only the fixture observer's own-data/nonthrowing hardening followed it.
Do not sum overlapping42-case/12-case/focused runs with the broad total.

New broad failure: `test/service-history-projection.test.ts`, “multisegment no-viewer metadata archive advances zero-result pages, restart cursors and bounded native IO”, exceeded its existing45000ms test budget (reported test duration50018ms).
Source inspection shows an8200-row direct append/navigation/projection fixture, not a worker launch or canonical producer call.
This distinguishes the boundary, **not its timeout cause**.
No history code/budget was changed and no identical retry was run.
Main should return that exact receipt to W3 for independent diagnosis; W4 integration is not claimed green.

Other preserved development failures:

- 01: initial callback fixture invoked its release twice in finally (`ERR_MULTIPLE_CALLBACK`); fixed one-shot fixture release before02.
  Not a product failure or native settlement receipt.
- 05: new test incorrectly required identical serialized UTF8 bytes after independent owner lexical encoding.
  Split surrogate pairs can be represented by JSON escapes with exactly equal decoded values and independent hashes.
  Corrected the assertion to exact decoded-field equality; no sanitizer behavior was changed to hide it.
- 07: scoped formatting reported an unused import and implicit-any fixture variable; fixed locally.
  No warning suppression or broad exclusion was added.

## Independent check and remaining gates

Review incremental reservation lifetime at every yield/throw/close, bounded sensitive-key expansion, exact original write retention and observer noninterference.
New tests cover three-way overlap/serial comparison, large nested keys, huge/malformed/colliding keys, secret/UTF8 source and owner splits, one-byte secret expansion, real capacity/control headroom, callback error, synchronous write throw and unchanged5s stalled/late original-write settlement.
Existing accumulator exhaustion, pending/throw/reject ingress, invalidUTF8, no-spill/guard, native cleanup/auth/model/proxy and durable recording controls remain.

This corrects a causally demonstrated availability defect without attributing the old failure.
Main's independent review, the new W3 timeout diagnosis and full W4/W7 integration remain open; no distribution, deployment, platform/paid-provider or complete-product acceptance follows.
No maintained spec change was authorized in this pass; main may capture the reviewed accounting lesson later.
