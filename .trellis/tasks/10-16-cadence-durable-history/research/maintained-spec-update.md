# W3 Maintained-Spec Update

## Scope and File List

Documentation-only delegation under main ownership; no production/test/package/Agent/task-status/Git/installation/credential edits.
Existing dirty and historical files remain preserved.
No agents or Cadence workflow were invoked.

| File                                                                | Why changed                                                                                                                                     |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `.trellis/spec/backend/service-history-capture-guidelines.md` (new) | Seven-section executable contract for implemented W2/W3 capture, durable writing, bounded typed history progress and transport/export consumers |
| `.trellis/spec/backend/index.md`                                    | Correct the obsolete “HTTP/auth/history not implemented” status, link the new guide and distinguish component integration from product cutover  |
| `.trellis/spec/backend/directory-structure.md`                      | Map actual JS/declaration/TS shim, service adapter and history owners; retain the live legacy path and pending package closure                  |
| `.trellis/spec/backend/service-owner-guidelines.md`                 | Only necessary implementation-status, shared-codec, history-path, flush/recovery-composition and link corrections                               |
| This new research note                                              | Record scope, source anchors, prior evidence attribution and targeted document checks                                                           |

Legacy workflow/storage/logging/quality guides and all prior reports/receipts were not rewritten.
The new guide explicitly distinguishes the still-live foreground entrypoint from implemented, not yet product-composed service components.

## Source Anchors and Consumer Rules

- `src/worker-public.mjs`/`.d.mts`, `service/contracts/{core,domain,capture}.ts`: one maintained executable codec/declaration owner and TS re-export shims; unchanged named resource categories.
- `src/sdk-worker.mjs`, installed public `pi-agent-core/dist/agent.d.ts`: awaited core subscription and verified sequential tool capability, distinct from synchronous session forwarding/concurrent tool updates.
- `src/worker-redaction.mjs#sanitizedJsonChunks`, `worker-capture.mjs#CaptureEmitter`, `worker-tools.mjs#ToolIngress/captureBash`, `worker-recording.ts#WorkerRecording`: pre-copy key/table/slice charging, original subscription/write settlement, bounded redaction, no raw bash spill and one supplied durable sink.
- `src/subagent-process.ts#preparedWorker`, `service/model-context.ts#PreparedModelContext`, `service/ports.ts`: final freshness/size/cancellation check after reservation, native facts separate from final recording and committed process settlement.
- `src/history/{files,writer,run-state,publication,recovery}.ts`: one original writer, command/auth/process accounting, publication fences, expected-byte strict-v1 summaries, independent quota/unknown states and guarded bridge without lock release.
- `src/history/{read-proof,sha256-state,validator,retained-progress,retained-traversal,source-row,read-io}.ts`: format3/key versus readonly2, native AEAD, finite source-attested proof, original snapshot/target/end/overlap/finish work and explicit source-incarnation limits.
- `src/service/contracts/history.ts`: exact `DetailReadResult`, `HistoryReadResult`, `EntityReadResult`, `GraphReadResult`, `DetailProgress`, `RequestProgress`, `HistorySnapshotTransition`; untagged data pages and unchanged `SearchPage`, not invented `kind:"data"` or empty data substitutes.
- `src/history/{projection,detail-progress,list-progress,graph-progress,search,export}.ts`, `service-client.ts`: stable snapshot/entity/version/UTF-8 hit navigation, bounded progress and complete selected exports; W4 current `ReadEnvironment` remains distinct from arbitrary-archive paging.
- `src/service-wire.ts#wireRequest/readonlyBody/httpOutputLimit`, `service/http.ts`, `service-http-client.ts#HttpServiceTransport.request`: readonly POST chosen before sending; full512KiB page/progress Replies including22-byte wrapper and original raw HTTP bytes; graph body512KiB, graph Reply/export frame1MiB, detail text/download writes256KiB, worker frame64KiB; unchanged8MiB/100ms read quantum.
- `src/history/index-tree.ts#IndexTree.heads`, `navigation.ts#HistoryNavigation.write`: synchronous128-node memo discarded before effects, exact growing/shrinking readback allowance and independent record/node ceilings.

W4/W5/W6 should consume typed progress explicitly, preserve `next` and coverage, yield/cancel between bounded reads, and never treat navigation, missing data or an inconclusive lookup as current action authority.
CLI/management, scheduler/current environment, native/browser cutover and full distribution remain separate integration obligations.

## Evidence Attribution and Historical Failures

Read the latest [W2 canonical review](../../10-16-cadence-worker-capture/research/w2-canonical-reservation-review.md), [W3 progress review](w3-progress-final-review.md), [graph/page review](w3-graph-boundary-review.md), [metadata review](w3-metadata-cost-review.md), and W1 HTTP/model plus W2/W3 earlier handoffs/reviews alongside actual source.
The newer graph/page category resolution supersedes that earlier progress review's graph-policy blocker; the older report and its source-only probe classification remain unchanged.
The guide links concrete tests/assertions rather than requiring a historical aggregate count.

Main's [results.json](main-integration-checks/results.json) and `01.log` record **1307 passed /0 failed /0 skipped,32 files**, plus separate successful `check`, `lint` and `check:agents`, with `inputsUnchanged:true`.
That is main's already-executed focused W1/W2/W3 evidence on frozen sources, **not tests executed by this documentation update**, a whole-repository/product/package gate or historical-failure causality.
No full20-minute suite was rerun here.

The two old5-second failures, the45-second multisegment scenario's50018ms failure, and native event35 remain causally unresolved.
Their source-bound failed receipts remain linked through the preserved reviews/evidence, not relabelled after later passing runs.
Demonstrated canonical over-reservation and metadata-construction inefficiency are independently evidenced corrections, not established causes of those historical failures.
No paid-provider, physical-human/device, Node22/Pi1.2, Windows/macOS/ConPTY, extracted service or browser/terminal cutover qualification is inferred.

## Document Verification

Only the five named Markdown paths are eligible for scoped formatting/lint.
Commands use main's existing disk-backed root `/home/mirako/abel/.cadence-main-w3-qualification-eslv9yjq` for all of `TMPDIR`, `TEMP` and `TMP`; no new root, cleanup or consumer data operation is needed.
Initial scoped lint found88 sentence-wrapping/table-alignment issues; `rumdl fmt --no-exclude` on only these five paths fixed them, and the scoped check passed.
Source review also corrected the owner's stale port0 comment/signature against `ServiceCoordination.acquire(config, resolvedEndpoint)`; requested policy stays unchanged while the actual bound positive endpoint is registered.

```sh
node_modules/.bin/rumdl check --no-exclude \
  .trellis/spec/backend/service-history-capture-guidelines.md \
  .trellis/spec/backend/index.md \
  .trellis/spec/backend/directory-structure.md \
  .trellis/spec/backend/service-owner-guidelines.md \
  .trellis/tasks/10-16-cadence-durable-history/research/maintained-spec-update.md
```

Result: exit0, no issues in5 files; rerun after the final note/status correction.
A readonly SHA-256 comparison also matched all174 main frozen input files and all four preserved command logs; no product test was executed to obtain that identity check.
No whole lint/typecheck/test/Agent/package suite was rerun for these Markdown-only edits.
