# W3 maximum-graph response gate

## Disposition

The demonstrated maximum-graph policy conflict is resolved by the main decision and **actual regression**, without increasing any limit or changing a format.
No remaining concrete W3 retained-history blocker was identified by this scoped gate.
This is not W3/product completion: independent review, consolidated testing and W1/W4 current-view/live composition remain separate gates.
W5/W6 client cutover and W7 distribution are not qualified here.
The old timeout and W2 bash causes remain unproven; these tests neither investigate nor repair them.

Authority: [graph response resolution](../../10-16-cadence-webui-terminal/research/graph-response-limit-resolution.md), amended [read-progress decision](../../10-16-cadence-webui-terminal/research/read-progress-decision.md) and mandatory parent artifacts.
The prior [review](w3-progress-final-review.md), maximum-graph probe and failed-policy evidence remain unchanged, not relabeled passed.

## Actual maximum-graph control

`test/service-history-graph-boundary.test.ts` constructs a shared-decoder-valid graph with exactly **524288 encoded bytes**, sixteen assignments and escaped instructions.
Each instruction/output remains within its existing field bound.
A real retained plan supplies the graph's content reference; real `HistoryWriter.commit` and `admitRun` commit its command, identity and complete graph.
Owner/context IDs are fabricated fixture inputs, not a real Start or SDK launch.
No graph instructions, request echo or reference content is omitted to fit a response.

The final focused run retained graph SHA-256:

```text
850257d4a6e3c960d5ceac357144f284c51746822477676a94a311b2445b5e47
```

The 59-byte retained plan hashes to `71567c24375bf66d2d6d2639da319158c9305d0b77136dd95c1c4d0e517d6328`.
Fixture UUIDs vary across independent executions; the receipt binds the actual final run, not a universal golden hash.

| Measured representation                        | Encoded bytes | Unchanged limit |
| ---------------------------------------------- | ------------: | --------------: |
| Graph body                                     |        524288 |          524288 |
| Ordinary graph Reply                           |        524616 |         1048576 |
| Initial proof-only Reply                       |          2167 |          524288 |
| Finite graph Reply including navigation echo   |        526066 |         1048576 |
| Largest NDJSON export frame, without delimiter |        524691 |         1048576 |
| Largest Markdown typed export frame            |         63564 |         1048576 |
| Largest actual streamed HTTP write             |        262144 |          262144 |

Actual graph frames also fit with their NDJSON delimiter included.
Production `HistoryProjection`, real W1 HTTP GET/readonly POST, `HttpServiceTransport` and `ServiceClient` roundtrip the exact graph and hash.
The finite path explicitly selects the real `graphPreparation` issuer once, as in the old probe; this is a labelled initial-selection injection, not a simulated deadline or failed GET.
The proof is subsequently consumed by the real retained graph reader through the real client POST path.
The exact returned navigation echo is asserted; removing it in an injected adapter response is refused.

Both formats complete through `ServiceClient.export` and the actual authenticated `/download` route:

- NDJSON: 22 frames including trailer; 575450 pre-trailer bytes, 575774 total bytes per export.
- Markdown: 78 frames including trailer; 574532 pre-trailer bytes, 574870 total bytes per export.
- Independent native SHA-256/count/ordinal/encoding checks verify the entire prefix, trailer and scope/snapshot; the receipt records each export's distinct digest.
- Original iterator EOF is observed before the client trailer is accepted, and download completion follows actual HTTP EOF.
- Parsed exported graph objects and exact original canonical graph bytes are checked independently of previews, with the complete retained plan.
- Real response writes are observed without replacing the native implementation; the large graph demonstrably spans 256KiB writes.
- Before/after history-tree hashes remain equal.
  There is no admission adapter, SDK/model-auth construction, worker launch, repair or index write on reads.

## Reproduced enforcement defect and narrow repair

An additional real-file/real-HTTP detail control demonstrated **524310 bytes** for a Reply containing an otherwise 524288-byte escaped detail page.
The previous packer and portable readers counted the value but omitted its 22-byte success wrapper.
This violates the clarified unchanged **full** 512KiB page policy, independently of the graph's valid 1MiB category.
[The original failing assertion](w3-graph-boundary-checks/page-wrapper-counterexample.log) is preserved.

The conditional single-editor shared-read handoff permits this demonstrated enforcement repair:

- `src/history/reader.ts`: binary splitting counts the actual success Reply, not just its detail value.
- `src/history/list-progress.ts`: collection packing includes the Reply around both request/next envelopes.
- `src/history/graph-progress.ts`: proof-only output accounting includes its Reply; graph data remains in the control category.
- `src/service/contracts/history.ts`: detail/search/collection/entity/progress decoders count the same wrapper; standalone graph decoding counts it under the existing control limit.

No field, wire shape, constant, deadline, cryptographic identity, worker/model/auth policy, HTTP authorization implementation, dependency or package metadata changed.
No new protocol or read authority was introduced.
The graph/export body is unchanged; the fix does not substitute a graph page/reference for the complete graph.
The escaped detail regression now returns an exactly **524288-byte full Reply**, then the remainder, with exact full-content hash and unchanged history.
Source before/after identities are recorded separately; historical W1 freeze hashes are not rewritten.

## Negative controls

- A 524289-byte graph refuses shared decoding and actual writer admission before filesystem effects.
- Oversized graph envelopes and graph export frames injected at the real W1 projection boundary refuse; no graph/trailer is exposed from the failed export.
- A separate real loopback raw-wire fixture sends the same valid graph Reply padded to 1048576 and 1048577 bytes: the former passes, the latter refuses in the actual transport and client.
- That fixture also checks the per-line export-frame decoder at/over 1MiB, separately from complete-export evidence; the newline is not part of that decoder's line input.
- Size-first structural vectors retain 512KiB detail/search/collection/entity/proof and 64KiB worker-frame refusals.
  These deliberately oversized shapes are not claimed to be valid semantic DTOs or native worker executions.
- Existing shared-contract, HTTP/auth, progress, integrity, list/entity and detail regressions remain in the executed set.

## Verification and evidence boundaries

[Evidence manifest](w3-graph-boundary-checks/evidence.json) binds logs, receipt, source inputs and the preserved failed assertion.

- Focused history/shared-contract set: **303 passed, 0 failed, 0 skipped; 9 files; 453.86s**.
  The literal command also contained nonexistent `test/service-http.test.ts`; Vitest matched nine actual files, not ten.
  This is recorded, not counted as HTTP coverage.
- Actual HTTP/auth suite `test/service-auth.test.ts`: **94 passed, 0 failed, 0 skipped; 1 file; 19.03s**.
- `bun run check`, `bun run lint`, `bun run check:agents`: passed separately.
- The four new cases are already included in the 303, not added again.
  The shared vectors overlap across facade/maintained-JS entry surfaces; suite counts are not independent capability counts.
- All source/test inputs were identical before and after the focused run.
  Whole-source hashes and unchanged auth adaptation destinations are in the evidence.
- Available host: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.
- Every command uses the new 0700 disk-backed ext4 root `/home/mirako/abel/.cadence-w3-graph-boundary-er37If` via `TMPDIR`, `TEMP` and `TMP`; free bytes/inodes were checked.
  No old root was cleaned or reused.

No complete 1267+ consolidated rerun, native W2 repair qualification, full repository suite, pack/extracted service, browser/terminal cutover, paid provider, physical-human/device, Node22/Pi1.2, Windows/macOS or ConPTY qualification occurred here.
No agents, installs, task-state/spec edits, credential reads or Git staging/commit/push/merge occurred.
The broader supported-writer immutability and historical/current-authority qualifications in the previous review remain applicable.
