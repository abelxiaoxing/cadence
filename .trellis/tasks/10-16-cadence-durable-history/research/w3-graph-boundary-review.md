# W3 graph/page boundary — independent review

## Disposition

**The retained W3 interface is ready for actual W4 integration at this reviewed boundary.**
The maximum-graph regression and 22-byte page-wrapper correction are accepted; one additional reproduced raw-wire accounting gap was fixed.
No in-scope finding remains on the tested host.
This is not W3 acceptance/closure, integrated product completion, a package qualification or a repair claim for the historical timeouts/native-bash failure.
Main still owns consolidated verification after the separate W2 repair.

Read the child manifests/artifacts, mandatory parent PRD/design/appendices/plan, graph-limit resolution, read-progress decision, handoff and prior review.
The four handed-off production files and original graph-boundary test matched their recorded hashes before and after this review.
Inspected the current dirty-tree inventory and applicable read/decoder/producer/client/export code without changing unrelated work.
The original freeze identities, graph probe, failed assertion, handoff and previous review remain byte-preserved.

[Evidence, commands and source identities](w3-graph-boundary-review-checks/evidence.json) bind this review's results.

## Graph policy versus reproduced behavior

The earlier report measured a valid graph exceeding the then-requested generic page policy; it did **not** reproduce a failed graph HTTP runtime roundtrip.
Its source-only policy discrepancy must not be relabeled a repaired runtime defect.
Main explicitly resolved that wording conflict using the already-existing categories, not a larger runtime cap or smaller graph.

| Representation                                     | Existing bound confirmed |
| -------------------------------------------------- | -----------------------: |
| Encoded graph body                                 |             524288 bytes |
| Standalone graph Reply, including exact echo/proof |            1048576 bytes |
| Typed export frame, including graph                |            1048576 bytes |
| Full paged/search/entity/detail/progress Reply     |             524288 bytes |
| Decoded detail text per page                       |             262144 bytes |
| Each streamed HTTP export/download write           |             262144 bytes |
| Encoded worker capture frame                       |              65536 bytes |

`decodeGraph` still enforces the graph body; `decodeGraphPage` counts the success wrapper under the existing default control limit.
`decodeExportFrame` independently checks its complete frame under that control limit, and still validates its nested graph.
Graph proof-only responses use the page limit instead.
HTTP graph serialization and the transport's maximum graph reader remain 1MiB; live rosters still carry graph references, not complete graph documents.
No limit, deadline, wire shape, graph instruction, correlation echo or source-integrity check was removed or increased.

The real writer/admission → projection → HTTP GET/readonly POST → ServiceClient regression passed again:

- Stored graph: exactly524288 bytes; ordinary full Reply524616; finite graph Reply526066; proof-only Reply2167.
- Graph SHA-256 for this run: `bb8a33344ba4f67e0088f0ce990a7079592b7c5362857352a09f454c916707b8`.
  Fixture UUIDs vary; this is the executed run's identity, not a universal golden hash.
- Exact original graph/plan, every assignment and the navigation echo survived; a deliberately missing echo refused.
- Complete NDJSON:22 frames,575450 pre-trailer bytes,575774 total; largest typed frame524691 bytes.
- Complete Markdown:78 frames,574532 pre-trailer bytes,574870 total; largest typed frame63564 bytes.
- Both actual client/export and authenticated download paths independently verified ordinal/count/digest/trailer and original EOF; the new receipt retains their separate digests.
- Actual writes reached262144 bytes without exceeding that bound; before/after history-tree hashes matched.
- Over-limit graph body, graph response and graph export frame refused without graph truncation or a fabricated completion trailer.

The finite graph initial selection is the same explicitly injected call to the real proof issuer, not a reproduced timeout or failed-GET retry.
Owner IDs/admission facts are fabricated fixtures; real files, writer, projection, HTTP and clients execute, but no SDK/worker/Start is claimed.

## Accepted wrapper correction and propagation

The preserved earlier failing detail control produced a524310-byte Reply because the524288-byte value omitted its22-byte success wrapper from accounting.
Its repaired real-file/HTTP regression now returns an exactly524288-byte full Reply and then the remainder, with exact retained text/hash and unchanged history.

Reviewed all related branches:

- Detail accelerated and ordinary packing calls `boundedDetail`, which measures the complete Reply while splitting at UTF-8 boundaries.
- Retained collection packing includes the full Reply, original request and worst-case next navigation before consuming a record position; ordinary collection packing retains conservative32KiB headroom.
- Search keeps conservative envelope/token headroom and finishes through the shared full-Reply decoder.
- Detail, search, collection, snapshot transition, entity and graph-progress decoders all count the wrapper before closed-schema/correlation validation.
  Cold/finite detail/entity/list/progress producers finish through those same decoders; no alternate accepting projection bypass was introduced.
- Graph data remains in the control category, while graph preparation/progress stays in the page category.
- Shared client request equality and next/snapshot correlation remain intact.

Nine added portable vectors use **structurally valid** DTOs at the page boundary and just over it, rather than only oversized unknown-key padding.
They grow decimal sequence strings within the portable schema to isolate wrapper accounting; they are not claims of actual committed huge-sequence snapshots.
Each also verifies closed-key refusal.
A tenth vector separately checks valid standalone graph/typed export envelopes exactly at and one byte over1MiB.
These tests do not treat portable decoding as stored membership or cryptographic verification.

## Additional reproduced finding fixed: raw-wire normalization gap

`HttpServiceTransport.request` previously read every response up to1MiB, parsed JSON, then relied on canonical DTO size checks.
A real loopback raw-response fixture sent a valid detail Reply padded with JSON whitespace to **524289 bytes**.
The original transport accepted it because parsing discarded the padding before the page decoder counted the wrapper.
This is a reproduced transport-enforcement gap, not evidence that the repaired production HTTP encoder emits oversized pages.
The pre-fix failing assertion is retained separately from a fixture-only model-field typo.

Narrow correction:

- `src/service-wire.ts`: one `httpOutputLimit` categorizes the existing collection/detail/search/entity limits and graph proof-only branch; it reuses the named reader taxonomy.
- `src/service-http-client.ts`: limit ordinary paged reads before parsing, then recheck **original UTF-8 wire bytes** after identifying graph data versus proof-only output.
  Graph data retains1MiB.
  Graph proof identification does not expose a response before its512KiB check.
- `test/service-history-graph-boundary-review.test.ts`:11 added tests, including a real raw-wire at/over512KiB control for every named collection reader's data/progress/snapshot branches, detail data/progress, search, entity data/progress and graph progress.

The original maximum-graph raw-wire at/over1MiB regression still passes.
No authentication, request selection, CSRF, HTTP server implementation, grant, execution, model/worker protocol or export framing change was needed.
The auth adaptation destinations and provenance remain unchanged and matching.
[The patch](w3-graph-boundary-review-checks/review.patch) was reconstructed against, and byte-hash-verified with, the initial source manifest.

## Verification and evidence limits

- Requested397-test set plus11 new regressions: **408 passed /0 failed /0 skipped;11 files;475.34s**, exit0.
  Unlike the old handoff command, this command names the real `test/service-auth.test.ts`, not nonexistent `test/service-http.test.ts`.
- `bun run check`, `bun run check:agents`, `bun run lint`: exit0; final lint follows formatting of the new report/JSON evidence.
- 149 source/test/provenance/package/lock inputs are identical before and after the focused run.
  Compared with review entry, only the two transport/category files and the new test changed.
- Available environment: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.
- Review/test commands after context/bootstrap use a fresh0700 ext4 root, `/home/mirako/abel/.cadence-w3-graph-review-bTJEkm`, with `TMPDIR`, `TEMP` and `TMP` equal; bytes/inodes were checked.
  The initial empty `/tmp/cadence-w3-graph-review-iIYKdT` bootstrap root and every historical root are preserved, not reused or cleaned.
- Preserved development failures: invalid test-only `modelId` field, demonstrated wire overrun, and a subsequent test-only tasks scope corrected to workspace.
  None is hidden, counted as a final pass or attributed to the historical native failures.

Counts describe executed cases, not independent capabilities; facade/maintained-JS shared semantics overlap, and development reruns are not added to408.
The new raw-wire fixture is an intentionally noncanonical server response, not production service/auth or native-worker evidence.
The existing real retained-history/HTTP/progress/integrity/export tests remain included.
No new credentials, service deployment, installs, agents, task/spec/status change, Git staging/commit/push or package/dependency edit occurred.

## W4 handoff and remaining qualification

W4 may integrate this retained-history interface; this review found no remaining graph/page-size blocker.
`workspace`, live `snapshot` and `checkObligations` remain bounded current-view APIs requiring W4's actual current context/configuration, active-and-recent horizon, checkout barriers and original settlement composition.
They are not arbitrary-archive pagers, and inconclusive historical lookup must never supply current action authority.
This gate does not supply that future environment or mark W4 integration complete.

The historical5138/5333ms control timeouts and W2 native-bash failure remain unexplained by this review.
A later green focused run is not a causal repair; there was no native-bash investigation or deadline increase here.
The prior supported-writer immutability/attestation limits remain applicable; no hostile same-user snapshot/CAS or universal process/privacy guarantee is inferred.

No new20-minute consolidated1267+ run, full repository suite, real pack/extracted service, browser/terminal cutover, paid provider, physical-human/device, Node22/Pi1.2, Windows/macOS or ConPTY qualification is claimed.
Main consolidation, actual W1/W4 composition, W5/W6 cutover and W7 distribution/product gates remain open.
Spec-update judgment: the category/full-wire accounting lesson is recorded here under the delegated no-spec-edit boundary; main/W7 owns deliberate maintained-spec reconciliation, not silent changes during this narrow check.
