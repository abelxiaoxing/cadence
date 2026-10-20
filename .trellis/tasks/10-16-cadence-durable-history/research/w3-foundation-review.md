# W3 foundation — independent review

## Disposition and boundary

**No known in-scope blocking finding remains on the tested host after the fixes below.**
This reviews the implemented foundation only; **W3 and the complete product remain incomplete**.
Do not treat this report as acceptance of any complete W3 criterion, a production integration approval or recovery authority.
The remaining work enumerated in `w3-history-handoff.md` is unchanged.

Loaded the active task/check manifest, referenced context, child artifacts, canonical parent PRD/design/plan and both mandatory appendices.
Reviewed the actual four history owners, fixtures, shared ports/budgets/admission/private-file primitives, W1/W2 handoffs and their evidence.
The existing dirty tree and historical failures were preserved.
No agents, actual user credentials, installs, deployments, task-state updates, Git index/ref changes or commits were used.
Shared W1/W2 code, contracts, package/lock, maintained specs and other tasks were read-only.

## Findings fixed

Each defect had a failing regression before its repair; additional positive controls cover concurrent distinct commands, immediate control flushing and original-write lifetime.

| Finding                                                           | Counterexample and correction                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Marker visibility preceded durability                             | While the actual `FileHandle.sync` was gated, a readonly open already returned the new watermark and receipt. `HistoryFiles` now shares a small live publication-prefix fence across same-process opens until the original append, sync, selected-byte validation and close succeed. Failed originals preserve the fence; no file is repaired.                                                                      |
| Settled identities could authorize repeated effects               | Auth settlement removed the only operation-ID guard; process settlement removed the child-ID guard. Repeating either intent then returned committed. Existing bounded authoritative scans now reject previously used identities; inconclusive scans cannot authorize another preparation/launch. No unbounded completed-ID cache was added.                                                                         |
| Tentative launch state was externally usable                      | A blocked launch journal append had already installed `ChildState`, allowing `capture(link)` before durable launch acceptance. Child state is installed only after original commit; serialized later jobs cannot bypass that boundary.                                                                                                                                                                              |
| Final-result validation trusted mutable or insufficient RAM facts | A caller could mutate the returned content reference, supply an older watermark, or alter the selected artifact before process settlement. Returned references are copies; each ended detail retains its actual committed batch watermark. Settlement requires that exact mapping and revalidates retained membership, part hashes and aggregate content through the existing reader. Native facts remain separate. |
| Unknown settlement fenced only after restart                      | A committed unconfirmed closure left the live writer writable. Live and restart handling now both fence unconfirmed closure and pending/uncertain recording; the actual settlement remains recorded, not rewritten as successful stop.                                                                                                                                                                              |
| Async acceptance overwrote changed current context                | Replacing supplied current context during original commit IO was followed by accepted acknowledgment and restoration of the old context. Exact-context checks now bracket append publication; changed context is preserved, the caller receives uncertainty, and admission stays fenced. A durable historical acceptance is never replayed to compensate.                                                           |
| Grown reservations bypassed progress batch sizing                 | Queue sizing used the original budget rather than the grown input: a valid grown ingress batch retained over 2 MiB before one flush. Batching now measures the actual validated encoded input; resource leases still retain their full reserved capacity until original settlement. Charging conservative reservation ceilings instead caused a native timeout and was rejected.                                    |
| Warm locators trusted stale snapshot/store identity               | Cached detail reads survived corruption of a later snapshot segment, an intervening segment, or replacement of `format.json`. The bounded locator now revalidates every contributing prefix segment through the exact snapshot, and selected reads/writes recheck the original format snapshot. Artifact validation and historical cursors after legitimate append remain intact.                                   |

The live publication fence is **not another journal, accepting in-memory store or cross-process filesystem lock**.
It prevents the single live owner's read adapters from treating page-cache visibility as original-write settlement.
An independent process after crash validates surviving committed bytes and does not dispatch them; this is not a power-loss or arbitrary concurrent external-reader guarantee.
The prefix fence retains only sequence/segment/length/hash metadata, not transcript bodies.

## Changed files

- `src/history/files.ts`: live publication cut, original append/sync/close ordering and selected format identity.
- `src/history/writer.ts`: spent identities, commit-visible launch state, exact final mapping/membership, uncertainty fences, async context CAS and actual encoded batch sizing.
- `src/history/reader.ts`: bounded warm-locator prefix/snapshot/store revalidation.
- `test/service-history.test.ts`: sixteen review controls; original twenty-four cases retained.
- This new report and `w3-foundation-review-checks/`: new evidence only.

`src/history/types.ts`, both original history helpers and every shared source/package/test file remain unchanged.
Exact before/tested identities, commands and log hashes are bound in [review evidence](w3-foundation-review-checks/evidence.json).
All snapshotted source/test/package inputs remained byte-identical during the final focused run.

## Verification

- Requested history plus current ten-file focused set: **1021 passed, 0 failed, 0 skipped; eleven files, 276.78 seconds**.
- This is the prior 1005-case set plus sixteen review controls, not a sum of overlapping reruns.
- Whole `bun run check`, `bun run check:agents` and final `bun run lint`: passed; receipts are in the evidence index.
- Scoped new-report Markdown validation is recorded separately.
- No full repository suite, pack/extracted package, release or completed-product acceptance was claimed.

The original C1 integration still uses **real W1 model preparation/auth accounting, W2 prepared native launch and this W3 journal**, not fixture commit references.
Its fabricated loopback provider returns more than 2 MiB; exact redacted retained text, more than eight pages, original close/exit0, delivered stdin, valid final, settled cleanup, one launch/contact and canary absence remain asserted.
The original 20-second test and 15-second child budgets are unchanged.
The six original waited Node exit77 crash windows remain unchanged; constructor/open performs no automatic dispatch or repair.

New controls use actual isolated private files with fabricated DTOs, controlled source/byte changes and injected scheduling.
The sync controls gate the **actual original** file-handle operation, then execute its real sync: before release the writer retains leases/pending counts and readers cannot publish its marker.
After the five-second reporting timeout, late original success releases charges and can become readable history, but cannot repair the returned uncertainty or clear quarantine.
The control-flush test deliberately holds virtual batching timers; it is scheduling coverage, not a native timing qualification.
The snapshot controls create real additional ledger segments and preserve their altered bytes on refusal.
ENOSPC and free-space observations in the original cases remain **injections**; this is not actual disk-full qualification.

Available host: `/usr/bin/node` v26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3.
Native Windows/macOS/ConPTY, Node22, modern Pi1.2, paid-provider, physical-human/device and packaged service/client lanes remain unqualified here.

## Preserved development failures

The new evidence directory retains every regression/development log, including selector-induced skips; those are not whole-suite or extra platform results.
The initial ten-control run failed nine controls and passed the distinct-command race control.
Further runs exposed async context replacement, grown-budget batch sizing and stale intervening-segment/store identity.

A zero-sized growth fixture was initially invalid and was corrected to reserve one retained byte before growth.
Its first assertion only checked eventual success; it was strengthened to measure actual artifact bytes per batch, exposing the oversized batch.
Using conservative reservation sizes for batching then caused the genuine native C1 timeout; actual encoded sizing repaired the mechanism without extending its budgets.
The growth regression was narrowed from 270 to 40 simultaneous details: it still exceeds the 256 KiB batch ceiling, while avoiding the explicitly unfinished repeated long-store scan path.
The larger intermediate run and failure remain preserved, not relabeled passed or used as evidence that strict scan continuation is finished.

## Remaining work and limits

Do not file the documented missing search/export/projections/quota-release/v1-summary/recovery work as newly discovered foundation regressions.
Full immutable admissions/graphs, generic owner fact joins and receipt lifecycle, strict lower-level IO continuations/indexes, complete quota/operation lifetimes, complete projections/live reconciliation, literal search, NDJSON/Markdown export, v1 publication and guarded recovery still require implementation and review over this same writer.
Existing per-call scan checks are not strict IO admission budgets; the new bounded cache does not complete that work.
W1/W4 production composition, W5/W6 client cutover and W7 package/integrated acceptance remain open.

These mechanisms are supported-owner coordination, not hostile-writer atomicity, exactly-once execution, total SDK/heap bounds, universal secret detection, a sandbox or descendant-closure proof.
No maintained spec was changed because this delegation keeps shared specs read-only; the owning completion pass must deliberately document the finished executable contracts.
