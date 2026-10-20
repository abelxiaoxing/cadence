# W3 read-progress composition — independent review

## Disposition

**Not ready for W3/product acceptance.**
One reproduced list-completion defect is fixed.
A reproduced maximum-graph response-size conflict remains for main's shared-contract decision.
The two historical 5-second control timeouts and W2 bash failure are not explained by later passing runs.
No product/package completion, task closure, release or platform qualification follows.

Reviewed the sealed-progress, validator-progress, read-completion and list/entity handoffs together with the parent read-progress decision, both independent design reviews, mandatory parent artifacts and curated W1/W2/spec context.
The review covers actual crypto/key/SHA, validator/traversal, source materialization, search/detail/list/entity/graph, export, typed client/wire/HTTP and preservation seams, not only primitive tests.
No agents, dependency installation, actual user credentials, deployment, Git index/ref operation, cleanup, W2 implementation edit or task-status change was performed.
All commands use the new private disk-backed root `/home/mirako/abel/.cadence-w3-progress-review-sB3x7v` through `TMPDIR`, `TEMP` and `TMP`.
Old roots, reports, failed receipts and source identities remain preserved.

## Fixed counterexample: suspended final list proof

`src/history/list-progress.ts` distinguished output exhaustion from normal traversal but not from a suspended final tail proof.
After `RetainedTraversal.finish()` advanced into `finish` and exhausted its quantum, the next request's `traversal.next()` returned null.
The list reader changed directly to `done`/`legacy`, without resuming `finish()`.
Thus a real preserved torn tail could disappear from final coverage.

The new regression writes retained text and a 200,000-byte unterminated tail to real temporary history, then injects a smaller work boundary **inside the original finish operation**.
Before the repair the second request completed with only one finish invocation.
After the repair it resumes the same validator, reaches actual EOF, reports incomplete/gap coverage and leaves the entire source tree unchanged.
The empty contents result is intentional: this owner-plan fixture has no worker content descriptor.
It tests zero-output proof completion, not invented content.
The first post-fix diagnostic used an incorrect expectation of one contents record; that fixture-only error and the original failing counterexample remain separately recorded.

The production correction is one transition: call `traversal.finish()` before treating a null output batch as terminal.
No deadline, read ceiling, schema, execution authority, source-integrity check or native outcome changed.

Changed product/test paths:

- `src/history/list-progress.ts` — resume the final proof before list completion.
- `test/service-history-progress-review.test.ts` — the counterexample and maximum-reference checkpoint control.

## Remaining functional blocker: legal maximum graph exceeds the response limit

A new ordinary Node probe constructs an exactly **524,288-byte**, shared-decoder-valid graph with sixteen legal readonly assignments and escaped instruction text.
The real `HistoryWriter.commit` and `admitRun` both commit it with the original retained plan and graph hash.
No provider, worker or actual task action is run.

Observed production read sizes:

| Route                                                    | Encoded bytes |
| -------------------------------------------------------- | ------------: |
| Ordinary `HistoryProjection.graph` data value            |       524,594 |
| Ordinary reply including `{kind:"ok",value:...}`         |       524,616 |
| Finite graph result echoing its authenticated navigation |       526,044 |
| Finite graph reply including wrapper                     |       526,066 |
| Largest NDJSON export frame                              |       524,691 |
| Largest Markdown export frame                            |        63,563 |

The finite control uses the real production `graphPreparation` issuer to select initial proof preparation explicitly, then the production retained graph reader against real stored bytes.
This initial selection is a fixture injection, not a claim that a failed HTTP GET caused the transition.
No token, key, private checkpoint or exception body appears in its receipt.
Both export formats reached genuine trailers in this probe; that is not evidence that the oversized NDJSON frame satisfies the requested limit.
The first development export request accidentally retained an extra `graph` key and correctly refused; the corrected request and that earlier failure are both preserved.

`decodeGraphPage` currently uses the default control-size bound, not `LIMITS.pageBytes`; its graph alone may consume the entire 512 KiB allowance.
A navigation echo and response wrapper necessarily exceed it.
The parent read-progress decision requires full response/frame accounting and the delegated review explicitly requires the 512 KiB full-response ceiling.
This is a representation conflict, not just a missing assertion or an inaccurate average-size fixture.

**Main action:** select and review a bounded graph transfer/page representation across the existing shared readers/clients, or explicitly resolve the conflicting graph-body versus full-response policy.
Do not silently raise the response limit, lower the accepted graph limit, truncate graph instructions, drop correlation echoes or call refusal of an otherwise legal graph complete history support.
No such contract redesign was made by this checker.
The probe source, bundle and receipts are bound in the new evidence manifest.

## Composition review and bounds

### Crypto and private format

The maintained JS cursor codec/declaration remains the sole portable navigation owner.
`HistoryReadProof` uses native AES-256-GCM with a fresh 12-byte nonce and full 16-byte tag.
No plaintext is returned before `decipher.final()` succeeds.
AAD includes purpose, exact normalized outgoing request, store/workspace/root and selected format/key incarnations; it does not use access generation or service epoch as historical authority.
Invalid present navigation cannot become an absent-index seed.

New explicit initialization creates the private key before the format3 marker.
Partial initialization, missing/unsafe keys and same-byte key reincarnation preserve/refuse rather than regenerate.
Format2 stays readonly, including writer/recovery admission; its private exporter does not require a key.
No proof enters admission/receipt conclusions, launch, auth preparation, recovery authority or lock release.
Fixed errors do not serialize crypto/filesystem exceptions.

The source uses the original request budget for key/format payload reads and prepays only exact fixed metadata completion reads.
The completion closure is one-shot; it does not admit arbitrary source work after the cooperative deadline.
The 100 ms limit is cooperative, not preemption of one synchronous decode/hash unit.
Metadata-only descriptor checks are not payload-read proof, and source initialization outside a named fixture read is not hidden key authority.

### Forward validator and selected-source reuse

Reviewed raw byte/SHA progress separately from structural record/count/sequence/commit progress.
Membership checks preserve marker first-occurrence order, reject extra/conflicting references and independently read required admission files.
Recovery compares actual predecessor raw size/hash/high sequence/committed sequence/offset and the next segment's byte-zero bridge placement.
Repeated bridges advance one validator rather than recursive byte-zero scans.
Original pending-job and unpublished-marker fences remain independent of browser navigation.

The new maximum-reference control uses two large real journal rows, each containing **2048 references**, with all references repeated in the second row.
It uses maximum legal reference numeric widths and body sizes, reconstructs the validator at every checkpoint, roundtrips the checkpoint through actual AEAD, compares the committed sequence and final raw SHA with original source/scanner facts, and checks charged bytes/token bounds.
These are structural reference-membership fixtures: they deliberately do not claim that nonexistent artifact bodies were captured or validated.
A separate ordinary Node probe completed the same maximum-reference family over four advancing quanta plus EOF without changing production ceilings.
Neither test is an exhaustive proof of every metadata shape or platform latency.

Snapshot/output/end/overlap/finish positions remain separate; output does not advance merely because a nonce changes.
End and overlap proof retain actual associations and scalar positions, and exact-hit cursors strip search navigation.
Selected row/artifact materialization rereads original bytes and validates hashes rather than treating a copied caller reference as membership.
Append handling re-proves the selected prefix or refuses; it does not silently select a newer snapshot.
Null list snapshots advance to the actual discovered full head through the dedicated typed transition.

**Attestation limit:** finite checkpoints authenticate earlier bounded observations under supported-writer immutability.
They do not retain all retired source incarnations or provide an atomic arbitrary-archive snapshot, hostile same-user CAS, change-and-revert detection or universal corruption detection after witness retirement.
The current warm/cold prefix, active-source/key/format and forged-bridge negative tests remain in the executed set.
This qualification is not a waiver of those tests.

### Readers, HTTP and export

Named list/entity/graph/detail progress stays distinct from data pages: no fake content reference, empty nonempty range or success fact is introduced.
The shared decoders/client enforce original request identity, snapshot transition and selector correlation; cryptographic and semantic progress remain history responsibilities.
The graph-size blocker above is the concrete remaining full-response violation found here.

Readonly POST uses the existing finite named routes and is chosen before transmission, not after a failed GET.
Current authorization, Host/Origin/proxy rules and POST CSRF/attachment checks precede body decoding and proof decryption.
Body transport is separate from action mutation; no grant, activation or accepted-effect receipt is created for these reads.
The existing HTTP adaptation provenance destination hashes remain unchanged and matching.

Exports retain one private iterator across renewed quanta, including old format2 with no key.
Original field end/aggregate hash, encoded frame count/digest, trailer and actual iterator EOF remain distinct checks.
Abort/revoke boundaries also apply during proof-only work; private computation is not download activity and no keepalive records are invented.
The tests retain actual W1 HTTP adapter coverage, not a claim of a composed production scheduler or browser client.

### Current-view versus retained-history scope

`workspace`, live `snapshot` and `checkObligations` remain bounded current-view APIs, not arbitrary-archive pagers.
Their intended W4 environment supplies current context/check configuration and an active-and-recent horizon; the named historical list/entity APIs are the archive route.
Large cold archives with missing/insufficient accelerators can still make those current-view methods inconclusive.
This is not silently called complete archive support, nor is absence of the future W4 live environment by itself a new W3 historical paging defect.
W4 must compose bounded live observations, active episode state and check/review barriers without using inconclusive historical reads as current authority.
Current configuration and human review never convert historical/native facts into verified current success.

The v1 publication request snapshot, expected-byte conflict checks, resource reservations, unknown facts and original-job recovery guards remain intact after format3 changes.
Async observer promises remain separate from original recording-commit settlement: notifications are scheduled independently, coalesce boundedly and do not join the writer's original promise chain.
No source edit was made to W2 capture/model/auth/execution, shared HTTP/auth source, package/dependencies or maintained specs.

## Historical timeout investigation

The requested full runs enable the existing opt-in aggregate `history-phase-metrics` instrumentation for the two historical 5-second cases.
It records fixture phases and original append/pending counts without payloads or credentials and preserves original promise identity.
There is no blanket test retiming or production-timer change.

Both broad attempts passed these controls without reproducing the old failure.
The final frozen-source measurements were:

| Case              |     Total |    Setup |  Reads / notification | Held commit | Teardown |
| ----------------- | --------: | -------: | --------------------: | ----------: | -------: |
| Check obligations | 726.25 ms | 88.20 ms |        41.11 ms reads |           — |        — |
| Pending observer  | 817.01 ms | 91.47 ms | 50.18 ms notification |   143.80 ms |  0.32 ms |

All observed append pending counts were zero on receipt completion, and the pending-observer case independently recorded `pendingWrites:0`.
Original append timings were 24.80–35.37 ms in the check case and 33.40–37.26 ms in the observer case.
Wall and monotonic times agree to rounding; fake timers were false at both boundaries.
These nested method timings overlap and must not be summed into an invented wall-time cause.
The initial broad attempt measured 735.42/821.10 ms separately; neither overlapping run is an additional capability/test total.

A later green run is not a root cause for the old 5138/5333 ms failures.
The available evidence does not establish a fixture-setup problem, stuck original promise, async-observer wait, fsync stall or load explanation for those old processes.
No setup-budget increase is recommended.
The unexplained W2 bash event-projection case remains with W2; this review does not patch or relabel it.

## Verification

[New evidence and identities](w3-progress-final-review-checks/evidence.json) bind commands, counts, native-versus-injected classifications, source inputs, logs and remaining limits.

- Final frozen-source all-history plus prior ten-file set: **1267 passed / 0 failed / 0 skipped; 28 files; 1176.76 seconds**, exit0.
- The two new review cases are included, not added again as separate capabilities.
  The prior shared codec vectors still overlap across their two entry surfaces.
- Initial broad attempt: 1265 passed /0 failed /0 skipped; 27 files; 1167.73 seconds.
  It began before the local repair and is mixed-input diagnostic evidence, not the final source binding.
- Final source/test/provenance manifests before and after the frozen run are byte-identical.
- Whole `bun run check`, `bun run lint` and `bun run check:agents` are separately recorded in the evidence directory.
  JSON and this new report are formatted before the last lint audit.
- Available host: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.
- Existing native SDK/disk capture, cold-process history/bridge/detail/list/entity/graph, original process/crash, real HTTP/export and namespace-only kernel ENOSPC tests are in the full executed set.
  The two new suite controls are real-file/crypto controls with an injected finish boundary and structural reference fixtures; neither adds an SDK/provider or physical-device claim.
  The maximum-graph probe is separate failed-contract evidence, not additional passing suite tests.
- Preserved development evidence includes the original list-tail counterexample, the post-fix fixture record-count mistake, initial Markdown formatting diagnostics and the malformed extra-key export request in the first graph probe.

No test process was killed to manufacture a result.
The graph response representation conflict is a concrete W3/W1 shared-read blocker; W4's current live authority composition, W5/W6 client cutover and W7 packaging remain distinct future gates.
Neither all-green focused tests nor a valid source hash resolves that demonstrated conflict.

No whole repository suite, real pack/extracted service, browser/terminal cutover, physical-human/device, paid-provider, Node22, Pi1.2, Windows/macOS or ConPTY qualification is claimed.
The existing greater-than-2-MiB W1→W2→W3 native/disk and isolated kernel-ENOSPC controls remain in the requested full command, with their original budgets and scope labels.
