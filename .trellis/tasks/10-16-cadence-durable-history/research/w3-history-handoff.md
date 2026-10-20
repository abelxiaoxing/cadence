# W3 durable history — foundation pass, not W3 completion

## Disposition

**Partial implementation; keep W3 and the parent open.
Do not wire this as a complete `ProjectionPort` or close any W3 acceptance criterion.**
The approved complete scope is unchanged.
This pass establishes actual filesystem ingestion and selected retained reads, not a reduced product release.
The remaining work below requires another implementation pass followed by independent review.
No accepting search/export/projection/recovery stub was added to disguise missing functionality.

Loaded the active W3 manifests/artifacts, parent PRD/design/plan and both appendices, reciprocal W1 acceptance, W2 handoff/review, relevant storage/lifecycle/spec contracts and adjacent source/tests.
No shared W1/W2 contracts or implementations, package/lock, legacy TaskStore/operator, task status, credentials belonging to a user, Git index/refs, or unrelated archive paths were edited.
Only the seven new source/test files below and this child's new research/evidence were authored.

## Implemented files and APIs

| Path                              | Implemented boundary                                                                                                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/history/types.ts`            | Closed private format, journal/commit/artifact/detail schemas; shared public codecs remain authoritative. Private auth accounting is not public transcript taxonomy.                                                      |
| `src/history/files.ts`            | Explicit held-lease initialization, private reads, immutable bounded artifact parts, ordered native append/fsync, segment rotation, commit checksum/ref verification, readonly prefix scans and quota inventory.          |
| `src/history/writer.ts`           | One serialized original-write chain; real `AdmissionPersistence`, bound `auth` and `processes` ports, `capture(link)` and `owner()` ingress ports, current-context CAS, original pending accounting and flush/checkpoint. |
| `src/history/reader.ts`           | Passive open, committed snapshot validation, selected retained detail/part access, bounded single-detail locator and limited events/contents pages. It intentionally does not implement the full `ProjectionPort`.        |
| `test/service-history.test.ts`    | Filesystem, original subprocess crashes, controlled faults/stall, UTF-8/cache/receipt controls and actual W1/W2/native SDK ingestion.                                                                                     |
| `test/helpers/history-fixture.ts` | Isolated fabricated coordination/action inputs; current context is explicitly injected, not inferred from a real task record.                                                                                             |
| `test/helpers/history-crash.ts`   | Bundled ordinary-Node subprocess, original exit77 crash windows; no provider/worker dispatch on restart.                                                                                                                  |

Explicit setup is `HistoryFiles.initialize(heldLease)` followed by `new HistoryWriter(heldLease)`.
`HistoryReader.open(coordination)` returns absent without creating anything.
Current context must be supplied separately by W4 through `supplyContext`; reopening a writer does not manufacture model/config/current task authority from historical admissions.
No extension, CLI, HTTP, scheduler or client currently instantiates this writer in production.

### Durable write/read behavior established in this pass

- Exclusive canonical credential-free command intent precedes acceptance.
  Same identity returns the original stored command; differing identity conflicts.
  Partial intent is inconclusive, never replay permission.
- Action CAS uses explicitly supplied current context and advances its control revision once after commit.
  Original epoch/action identity remains historical.
- Auth preparation/settlement and process launch/settlement use the same journal.
  Actual W1 preparation commits through these auth ports, not injected successful accounting receipts.
- Actual W2 prepared launch supplies its sanitized recording inputs to this writer.
  Exact final selected content is independently hashed and its committed mapping is checked before recording process settlement.
- Pipelined ingress uses shared synchronous budget pools.
  Progress is scheduled at the shared100ms/256KiB threshold; control writes schedule immediately.
  Artifact parts coalesce within a batch and never exceed256KiB.
- Commit publication follows artifact writes, journal events, checksum/ref marker and original native file sync.
  POSIX parent directory sync includes the service directory entry; Windows directory durability/ACLs are not qualified here.
- Original pending writes remain tracked and charged after the five-second reporting deadline.
  Late settlement does not clear quarantine or repair the caller's returned uncertainty.
- Scans validate exact sequence/count/checksum/artifacts before yielding a batch, hold bounded segments rather than a complete transcript, and preserve torn/uncommitted final bytes.
  Interior corruption and selected linked/unsafe/altered artifacts refuse.
- Orphan/index bytes count in startup inventory; quota/free-space refusals never delete retained history.
  Defaults reuse the shared10GiB/512MiB/256MiB/1MiB values.
  Metadata charging is conservative.
- Reconstructed unmatched auth, launch or unfinished details fence writer admission.
  Construction does not dispatch any historical work.
  Checkpoints are never consulted as execution authority.
- Stored text has independent byte offsets/hashes.
  A bounded single-detail locator is revalidated against retained segment prefixes and actual artifact hashes, so later legitimate appends preserve historical cursors while altered content refuses.
- UTF-8 page boundaries neither split nor skip a scalar.
  The recent ring is not involved in archive ingestion or detail access.

These are supported-owner filesystem mechanisms, not hostile-writer CAS, exactly-once execution, an OS sandbox, complete SDK heap bounds, universal secret detection, power-loss certification or universal descendant closure.

## Verification and evidence classification

Final command/results/source identities are in `w3-history-checks/evidence.json` and its bound logs.
The focused command includes the current ten-file W1/W2/legacy set **plus** `test/service-history.test.ts`.
Separate reruns and the shared codec vectors exercised through two facades are not extra independent capabilities.
Whole check, lint and Agent checks are separate gates.
Full pack/full repository suite are not claimed; W7 still owns the reviewed complete member policy.

The history file currently contains24 test cases:

- Real private filesystem initialization/noncreation, exclusive intent/CAS/idempotency, absence/current-context separation, unfinished auth/launch fences, retained owner details, sibling commit mapping isolation, exact UTF-8 page boundaries, cache revalidation, torn prefix and corruption/link/mode preservation.
- Original waited Node subprocess crashes after intent, uncommitted journal append, committed marker, auth intent, launch intent and checkpoint.
  These exercise the journal/coordination boundary, not a paid provider or a spontaneous OS crash.
- Controlled original-write stall retains charges past five seconds.
  ENOSPC is an **injected error**, not actual filesystem capacity exhaustion.
  Free-space floor is an injected observation.
  Orphan-byte quota inventory uses real files.
- **One actual SDK/native composition case:** real `OwnerModelContext` over fabricated private Pi files, durable auth intent/settlement, real one-use preparation, durable launch intent, guarded stock SDK/native child, more than2MiB of final text, provider and owner-only fabricated secret redaction, exact selected durable result and recorded original settlement.
  It retains the original20s test/15s child limits, asserts one launch/contact, original close/exit0, delivered stdin, valid final and settled cleanup; more than eight detail pages reconstruct the complete retained text without a viewer.
  This is real W1 + W2 + this W3 journal, unlike the earlier W2 disk fixture's synthetic content references.
- Direct calls to capture/owner ports elsewhere are labelled structural/fabricated inputs, not additional provider-wire runs.
  Snapshot current context in fixtures is supplied explicitly, not a real W4 observation/check/review result.

Available host: Node26.7.0 (`/usr/bin/node`), Linux x64, Bun1.3.14, installed Pi0.84.3.
No native Windows/macOS/ConPTY, Node22, modern1.2 peer, physical-human/device, paid-provider, actual disk-full, packaged service/browser/terminal or release qualification was executed.

## Preserved development failures

`w3-history-checks/development/` retains intermediate failures, not rewritten passes:

- The initial fixture incorrectly used controlRev0; the closed contract requires a positive revision.
- The SDK fixture initially created a nonprivate agent directory; W1 correctly refused it.
- Per-chunk file sync and per-reservation lease filesystem validation made the real large native case exceed its unchanged child budget.
  Artifact batching and checking ownership at actual write boundaries fixed the mechanism rather than increasing timeouts.
- Repeated full journal parsing on every detail page exceeded the unchanged whole-case budget.
  The bounded revalidated locator replaced that repeated work, without caching full transcript text or trusting a stale index.
- The temporary timing diagnostic run is preserved, including its selector-induced skipped cases; it is not a successful full run or an added suite total.
  Temporary timing prints were removed.
- Early type/format diagnostics are retained.
  No old assertion was removed or weakened to make this new boundary pass.

## Exact remaining W3 work — do not confuse with composition-only work

1. **Full private semantic admission/owner accounting:** immutable `runs/<id>/admission.json`, frozen graph storage/read membership, full owner fact/content-reference relationship validation, exact handoff/check/change/review/publication joins and receipt lifecycle updates.
   Current native process final selection is checked, but generic owner facts are only closed DTOs, not yet all cross-record semantic proofs.
2. **Long-store indexes and strict per-call scan accounting:** derived checkpoint/index generation and bounded authoritative continuations.
   Receipt negative scans currently conservatively return inconclusive on their observation budget; they do not supply the planned restart-stable scan continuation, and byte/time budget checks are not yet a strict lower-level IO admission budget.
   Never treat inconclusive as absence.
3. **Complete quota/lifetime semantics:** per-episode reservation release after committed parent drain, full owner-detail/operation lifetime bounds, active child/owner ingress policy, explicit policy-generation admission and verified control-headroom exhaustion.
   Current default ceilings, real inventory and fail-closed writes are a foundation, not completion of W3-AC5.
4. **Complete `ProjectionPort` and live adapter:** task/run/child/message/tool/omission/entity/graph/check obligations, immutable historical admissions versus separately supplied current authority, snapshot horizons, all-sibling watermark updates, bounded ring and subscribe-before/after snapshot reconciliation.
   Only selected detail and limited events/contents paging exist now.
5. **Literal search:** not implemented.
   Needs exact UTF-8 cross-part/not-cross-field matching, every selected retained field, stable exact hit navigation, zero-hit continuations and the actual8MiB/100ms budgets.
6. **NDJSON and Markdown exports:** not implemented.
   Must use the complete retained reader, graph/provenance/omissions/native/check/review facts and actual `encodeExportFrame`/HTTP digest/EOF/revocation integration, without an archive-size cutoff or giant array.
7. **Strict v1 summary publication:** not implemented.
   No `task-store.ts` seam or operator regeneration was needed in this pass.
   Expected-byte/revision intent/outcome, conservative phase mapping and visible clipping without rich-history loss remain mandatory.
8. **Guarded recovery:** no concrete append-fenced recovery seam or W1 `RecoveryInspectionPort` adapter yet.
   Existing W1 resolution remains nonaccepting.
   Damaged bytes/locks must not be cleared using this pass's source/tests as recovery authority.
9. **Remaining required native/fault matrix:** before/after artifact/publication and real-worker-close crash windows; actual native slow-recorder composition, additional W1 original-auth cancellation/crash controls, large multi-segment/no-index navigation, full search/export/trailer/digest, multiple-model/epoch projections, full quota/control-headroom and summary-conflict cases.

W1 CLI/recovery/startup composition, W4 scheduler/actions/checks/review, W5 native cutover, W6 browser/live consumers and W7 exact package closure remain subsequent cross-child gates as well.
Do not close W3 on the24 new cases or on the absence of an existing integration consumer.

## Recommended next pass

Keep W3 active and finish the owner semantic reducers/indexed reader first, then search/export, summary publication and guarded recovery append over this same writer.
Do not add a second accepting recorder or route unfinished `ProjectionPort` methods to empty lists.
Before W4 composition, independently review durability, pending-original lifetime, membership/ownership and private/public coverage at the finished boundary, then rerun the required complete W3 and current focused gates.
