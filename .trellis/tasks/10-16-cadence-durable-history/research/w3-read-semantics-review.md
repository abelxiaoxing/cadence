# W3 read and semantic continuation — independent review

## Disposition and scope

**No known blocking finding remains in the reviewed continuation on the tested host after these fixes.
W3 and the parent remain incomplete.**
This independently reviews both the immutable-admission/semantic continuation and the subsequent retained-read/index/projection/live pass, not just their previous green tests.
It is not W3 acceptance, production-owner composition, package qualification or complete-product approval.

Loaded the task manifest/artifacts, curated context, both complete parent design appendices and parent PRD/design/plan, W1's accepted ports, W2 handoff/review, and both W3 handoffs/foundation review.
Read every current history source/test/helper and inspected the shared DTOs and actual W1 HTTP/WS subscription, buffering, heartbeat and resync integration.
No nested agents, installations, deployments, real-account credentials, task-status changes, Git index/ref changes or commits were used.
W1/W2/shared/public/package/lock/spec files and earlier reports, failures and hashes remain unchanged.

## Findings and repairs

Counterexample logs are retained in [the new evidence directory](w3-read-semantics-review-checks/).
Tests use real isolated history files unless explicitly noted; their fabricated owner/native facts are not executions of those effects.

| Finding                                           | Counterexample and repair                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Interior row sequences broke tool reads           | Two real writer jobs batched at one watermark made tool paging treat an interior row sequence as a snapshot. Tool occurrence lookup now uses the actual snapshot and the first source occurrence.                                                                                                                                                                                                   |
| Child run pages were empty                        | The owner-link prefilter discarded every child-scoped parent allocation before selecting its child row. Run pages now select the exact child from the admitted group without returning siblings.                                                                                                                                                                                                    |
| Dense rows could not advance                      | A single retained row with 300 message starts rebuilt every entity before emitting any page; the 100 ms budget repeatedly expired at the same row. Paging now yields bounded source-event slots lazily and resumes after the last emitted slot, including sibling subslots. The restart traversal returns all 300 IDs exactly once.                                                                 |
| Damaged accelerators became read authority        | Missing immutable nodes and altered predecessor links refused even small fully readable committed entities. Verified chains remain the fast route; unavailable/corrupt hints now fall back to the same bounded authoritative scan. Validated suffixes are not duplicated during fallback, and no index is written or repaired.                                                                      |
| Marker-only watermark validation was insufficient | A checksum-valid marker advertised sequence 999 outside its actual row range. Boundary validation now correlates first/last/count with previous and actual contiguous rows. The counterexample was also run with only this new guard removed, then restored.                                                                                                                                        |
| Artifact IO escaped its budget or selected page   | A verifying scan read artifact payloads without charging the supplied budget. A missing detail locator caused a 256 KiB page to read all 700,000 retained bytes. Artifact reads now share the original budget; fallback pages validate selected real part hashes without rereading the entire body. Full aggregate verification remains available to writer/verification callers.                   |
| Torn tails appeared complete in public pages      | A preserved partial line after a committed prefix returned complete page coverage. Bounded tail observation now reports an incomplete gap without publishing, repairing or deleting the tail.                                                                                                                                                                                                       |
| Accepted operation IDs could be reused            | A new action or Cancel reused an accepted command operation; auth preparation could alias its parent operation. Command/run and auth identities are checked against committed use. Freshness refusals still precede conflict for stale actions; no completed-ID cache or replay path was added.                                                                                                     |
| Metadata publication receipts never advanced      | Create publication facts committed, but lookup remained pending/reserved at the acceptance sequence; conflict/uncertainty did not fence the live writer. One metadata operation reducer and the shared publication transition now drive validation and receipt reads, including exact publication identity and watermark. Conflict/uncertainty fences only after the original commit.               |
| Owner chunks could change ownership               | A later chunk/end with the same operation/detail ID but another task committed. It now must match the original retained task/run ownership before bytes can be recorded.                                                                                                                                                                                                                            |
| Coverage was erased or overstated                 | Check capture gaps disappeared from run coverage; a child's retained redaction/source-limit coverage disappeared after native settlement. Per-child and check coverage now survive the shared reducer independently of native exit. Native zero plus an incomplete retained final detail cannot obtain accepted successful final-recording settlement. The original native result is not rewritten. |
| Historical blocked work became unknown            | A durably blocked, never-started child changed to unknown under a newer epoch. Its recorded parent-stopped disposition now survives restart; genuinely unmatched auth/launch facts remain unknown.                                                                                                                                                                                                  |
| Fresh review of old history was rejected          | Actual lease release/reacquisition created a new epoch, but current change/review observations were incorrectly required to use the old run epoch. Historical run identity stays immutable; separately admitted current review remains bound to its own epoch/action and current observation/obligations. Execution never resumes.                                                                  |
| Review operation membership was incomplete        | Two review facts in one original batch both passed the disk-only duplicate check; a human review could also borrow content from another operation. Candidate operation reduction rejects the duplicate before commit, and review content must belong to the exact admitted review operation.                                                                                                        |
| Unknown gate and empty-view identity gaps         | A committed unknown checkout gate left live admission open and omitted quarantine from projection. It now fences immediately and retains the reservation; release also names the held lane. Empty snapshots additionally reject mismatched session-store or current-context workspace/task identities instead of relying on a nonempty roster to catch them.                                        |

The semantic owner remains `RunState`, with `OperationState` for separately accepted metadata/review commands and one shared publication transition.
Candidate state is not installed as launch/read authority before original commit.
No new public protocol, execution owner, accepting recovery adapter or in-memory durable substitute was introduced.

## Files changed

Six history owners:

- `src/history/files.ts`: artifact-budget propagation.
- `src/history/navigation.ts`: exact marker range, bounded accelerator fallback and tail observation.
- `src/history/projection.ts`: lazy event-slot pages, child/tool selection, current identity correlation and page coverage.
- `src/history/reader.ts`: budgeted prefix revalidation and page-only fallback artifact reads.
- `src/history/run-state.ts`: metadata/review operation reduction, shared publication transitions, retained coverage and historical/unknown-state distinctions.
- `src/history/writer.ts`: unique IDs, committed metadata receipt/fence joins, owner linkage, review ownership and incomplete-final refusal.

Tests/helpers:

- `test/service-history.test.ts`
- `test/service-history-semantics.test.ts`
- `test/service-history-projection.test.ts`
- `test/service-history-live-detail.test.ts`
- `test/helpers/history-crash.ts`

The crash helper now allocates an independent auth operation ID rather than aliasing the parent ID; its original waited exit77 boundary and expected committed sequence remain unchanged.
`src/history/live.ts`, `index-tree.ts`, `admission.ts`, `read-io.ts`, `types.ts` and the original fixture helper were reviewed but not changed.
Exact before/final SHA-256 identities are in [evidence.json](w3-read-semantics-review-checks/evidence.json) and `tested-inputs-final.json`.

## Verification and classifications

Final frozen-input run:

- **1113 passed, 0 failed, 0 skipped; 14 files; 387.53 seconds.**
- **132 history cases** plus the unchanged **981-case prior ten-file set**; this adds 25 cases to the 1088 baseline, not totals from overlapping reruns.
- Whole `bun run check` and `bun run check:agents` passed on the final inputs.
- Whole lint and scoped new-report validation are recorded separately in the evidence index, after formatting new JSON evidence.
- Source/test/package bytes were identical before and after the final run.

Available host: `/usr/bin/node` v26.7.0, Linux x64, Bun1.3.14, installed Pi coding-agent/agent-core/pi-ai0.84.3, Vitest4.1.10.

### Genuine native/integration evidence retained

The original guarded W1 model preparation → W2 stock SDK/native launch → real W3 journal case still retains more than2MiB, exact worker/owner canary redaction, more than eight UTF-8 pages, one launch/provider contact, delivered stdin, valid final, settled cleanup and original zero close.
Its **20-second test / 15-second child budgets are unchanged**.
The seven original waited Node crash windows, prior native child/check/auth controls and no-viewer capture remain in the executed set.

Actual W1 HTTP/WS tests use the current writer/projection, original subscription-before-snapshot ordering, buffered snapshot race, deliberately lost final notification and real five-second heartbeat/resync.
They use fabricated access material and current-context callbacks, not a composed production scheduler or real-account service.
Search/export explicitly refuse in that test adapter; they are not fake successful empty responses.

### New structural and filesystem evidence

New cases exercise real private journal/index/artifact bytes, exact dense-row restart paging, missing/corrupt accelerator preservation, actual file-budget admission, metadata receipts, ownership and reducer joins.
The later-epoch review case performs actual coordination release/reacquisition but uses fabricated run/native/check facts.
The 700,000-byte fallback case measures actual selected artifact reads; it is not a newly executed32MiB stress lane.
Check exit0, publication outcomes, unknown gates and owner-redaction/native coverage distinctions in new cases are injected facts, not additional shell, TaskStore save, OAuth or unknown-process executions.
Original ENOSPC/free-space and observer/disk timing controls remain labelled injections.

The unchanged archive fixture still traverses8200 structural rows across multiple segments,1200 messages and70 Create-shaped metadata records with bounded native IO, zero-hit continuation and reopened readers.
The active/recent horizon, complete sibling groups, bounded no-viewer ring, thrown/pending observers, exact handoffs and selected-corruption controls also pass.
Structural Create/publication facts are not actual strict-v1 task publication.
Shared114 codec vectors through two surfaces still overlap; they are not228 distinct capabilities.

## Review conclusions and preserved limits

- Index/checkpoint files remain accelerators, never admission or launch authority.
  Their copy-on-write paths and caches remain finite; this review added no per-batch full-history index rebuild or unbounded completed-record map.
- Fallback scans consume the same8MiB/100ms request budget.
  A standalone lookup that cannot establish its selected snapshot/entity within that budget remains explicitly inconclusive, not false absence or permission to retry execution.
  It does not promise arbitrary damaged large-store navigation without explicit later rebuilding/recovery work.
- List continuation now advances within dense rows as well as across batches/segments.
  Source-event slots are private cursor encoding; cursors remain snapshot/query/scope/store bound and survive reader restart on these bytes.
- Selected artifact hashes are checked from actual bytes, not stat-only cached bodies.
  Metadata-only reads do not reopen unrelated large artifacts.
  Full retained integrity is not replaced with a preview or a global all-artifacts read on each GET.
- Current session/config/check authority stays callback-supplied and distinct from immutable older admissions.
  Parent required-set settlement, auth completion, native closure, coverage, publication and human review stay separate.
- Live changes continue to use whole sibling groups and `previousSeq` chaining; observers do not hold original writes.
  Lost final/epoch/ring gaps require observation/resync, never mutation replay.

The two earlier tests that expected corrupt index hints always to refuse were deliberately changed to require correct bounded source fallback plus unchanged damaged bytes.
Their preservation/safe-no-absence intent was retained, not deleted.
The initial development whole-history run also exposed the changed stale-versus-conflict error precedence; original stale refusal was restored before final qualification.
A new fixture's widened inferred string types caused a typecheck failure and were corrected with the existing options type.
All diagnostic failures and earlier130/1112 passing runs remain preserved; only the final1113 run is bound as definitive.

## Remaining work and spec judgment

Continue the explicitly assigned next W3 pass: literal search, complete streaming NDJSON/Markdown exports with revocation/trailers, actual strict-v1 expected-byte publication/summary mapping, and guarded recovery under genuine W1 authority.
Broader quota/control-exhaustion/recovery/crash composition and explicit navigation rebuilding policy remain unfinished W3 work.
W1/W4 production owner/scheduler/current-observation wiring, W5/W6 client cutover and W7 package/build/distribution/integrated acceptance remain separate gates.

No whole repository suite, pack/extracted service, browser/terminal cutover, paid provider, physical-human/device, Node22, modern Pi1.2, native Windows/macOS or ConPTY qualification was executed here.
No W3 criterion or parent criterion was marked complete.
These are supported-owner recording/coordination guarantees, not exactly-once effects, hostile-writer CAS, total heap limits, a sandbox or universal descendant/privacy guarantees.

Maintained specs were expressly read-only in this delegation.
The owning main session should capture event-slot continuation, bounded accelerator fallback, one publication reducer, current-review versus historical-run epochs, and independent native/capture facts after completing the remaining boundary.
Do not document search/export/publication/recovery as implemented from these tests.
