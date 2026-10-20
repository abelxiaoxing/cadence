# Graph Document Versus Page Limits

## Decision

Main resolves the maximum-graph review conflict by making the existing response categories explicit, not by raising a runtime ceiling or reducing accepted graph content.
The original design selected a512KiB graph and1MiB control envelope; the actual preexisting `decodeGraphPage`, `decodeExportFrame`, HTTP JSON writer and HTTP client's bounded reader already use the1MiB control bound.
The later generic wording about512KiB full responses was overbroad for standalone graph documents and export graph frames.

| Representation                                                                 | Required full encoded bound                                |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Graph body itself                                                              | 512KiB, unchanged                                          |
| Standalone graph data response, including request echo/proof and Reply wrapper | 1MiB, existing control envelope                            |
| Typed export frame, including a complete graph                                 | 1MiB, existing export-frame decoder bound                  |
| Paged history/search/detail/entity and proof-only responses                    | 512KiB, unchanged; full echoes/tokens count                |
| Decoded detail page text                                                       | 256KiB maximum, with encoded-page splitting as needed      |
| Each streamed HTTP output write                                                | 256KiB maximum, unchanged                                  |
| Worker capture encoded frame                                                   | 64KiB, unchanged and unrelated to HTTP graph/export frames |

A graph is one bounded control document, not an unbounded transcript or a collection page.
Live snapshots/updates continue to contain graph references only; no graph body is promoted into a512KiB live roster.
No HTTP header/body/read/native deadline is increased, no graph instructions are clipped, and no correlation echo is removed.

## Evidence and Required Regression

W3's `w3-progress-final-review.md` retained a valid exactly524288-byte graph whose wrapped normal and proof responses are524616 and526066 bytes, and an export graph frame524691 bytes.
Those values exceed a collection-page limit but fit their already implemented1MiB document/frame limit.
That original probe/report remains historical evidence of the wording conflict; it must not be rewritten as if it tested the clarified policy.

Require actual stored graph → W1 HTTP GET/readonly POST → ServiceClient roundtrips, ordinary and finite proof preparation, full graph equality/hash and both complete exports/digests/trailers.
Require over-limit graph-body and full1MiB-envelope refusals plus unchanged512KiB page/progress negatives.
No stronger bound is waived for other categories.
Main's continuous implementation authorization covers this in-scope technical clarification; independent review and actual regression results still govern acceptance.
