# W4 execution-core independent review

## Disposition

**Reviewed execution-core corrections pass the affected gates.
Production actions must remain closed.**
No reproduced defect remains unfixed in the exercised boundary.
This is not W4 completion, accepting-host qualification, or parent/product acceptance.
Generate-plan, checks/review, current client metadata and complete Stop composition remain subsequent work, not accepting stubs.

Loaded the active check manifest, child artifacts, complete canonical parent artifacts/appendices, both readiness-context parts, selected contracts, prior execution-core handoff/evidence, W1 host/lifetime reports and applicable specs.
Initial core hashes matched the previous handoff.
The broad dirty Git state was inspected, not staged/reset/cleaned.
No agents, dependency/pin/lock changes, worker-capture edits, real credentials, deployment, spec/task-status edits or consumer cleanup.
W6 source is unchanged and remains unqualified.

## Findings and fixes

### F1 — Cancel waited for original storage before requesting stop

A real two-child SDK scenario held an unrelated original journal append after its marker write.
Authenticated Cancel left `cancelRequested:false` while that original was pending.
The initial native counterexample failed its 500ms fixture assertion; this did not change the native stop/reporting budgets.

`TaskActions` now supplies immediate `lookup` separately from `lookupForAdmission`.
Cancel checks current authority and exact run identity, rejects known ID conflicts, and requests all stops **before** joining the journal barrier.
Only afterward may it perform serialized receipt observation/commit.
Inconclusive never becomes absent, and a failed durable receipt remains uncertain.

`HistoryWriter.lookupForAdmission` now inserts one readonly observation at the exact existing original-chain boundary.
Later jobs follow that observation; it does not repeatedly chase a moving tail.
This writes nothing, flushes nothing and invents no receipt.
A disk-backed two-original regression proves the lookup finishes while the subsequently registered original is still held.

An intermediate nonblocking-only change made ordinary native Cancel return uncertain during normal capture.
The final implementation retains stop-before-wait **and** actual serialized receipt lookup afterward; the original successful native Cancel assertion passes unchanged.

### F2 — Conflicting command IDs could borrow the safety overflow path

Source review found that the saturated Cancel branch bypassed identity lookup.
Added bounded pending-command identity claims under existing admission reservations and a selected-intent-only `reservedIdentity` port.
Both ordinary and cancel requests refuse a known conflicting pending identity.
The saturated safety path also checks the real selected command intent synchronously before requesting stop.

`reservedIdentity` returns a safely decoded credential-free identity or unknown/null, never a receipt or absence claim.
Pending claims remain charged until their original admission operations settle.
The production action adapter supplies the real writer method; compatibility fixtures do not become production defaults.

Regressions cover conflicting in-flight IDs and previously reserved identities under saturated accounting, plus reuse of an actual Start command ID during the stalled native Cancel scenario.
No stop of the conflicting target is allowed.
Existing authority-rotation-before-lookup, quota, duplicate/lost-response and no-activation tests remain passing.
This finding was source-backed with replacement regression evidence, not a claimed separate pre-fix native reproduction.

### F3 — Accepted plan work incorrectly reapplied access-generation freshness

Real access rotation after accepted default Start caused the episode to become unknown without launching.
Admission correctly normalized access rotation after commitment, but `retainAcceptedRunPlan` still required the old access generation in its full context comparison.
The same mismatch existed in save-plan retention.

Both accepted-plan producers now normalize **only accessGeneration** when comparing their already accepted context.
Exact epoch, controlRev+1, model/config/observation/task/raw-byte/graph identities remain checked.
New actual-host controls cover default Start completing after real token rotation and save-plan retaining/publishing after rotation, without a new grant or automatic dispatch.

### F4 — Gate reduction allowed contradictory modes and premature release

Two real-disk injected-fact counterexamples committed mixed legacy run-wide and per-reservation gates in either order.
A third committed per-child release while that child's auth preparation had no settlement.

The existing `RunState` now enforces one gate mode per run, requires per-child auth/native settlement before release, and rejects incompatible simultaneously held per-reservation lanes.
Historical legacy-only facts stay readable.
Native settlement, unknown closure and mandatory recording remain separate; no scheduler hint can create success.
The same reducer still feeds finite/historical projection.
Existing membership/unknown and projection parity tests remain passing.

### F5 — Displayed task cwd could differ from the host's actual launch cwd

In a fresh fixture Git checkout, `TaskActions` accepted a nested task cwd even though the real model adapter was configured to launch from the checkout root.
Same-checkout validation alone did not bind the approved working directory.

`TaskActions` now reads the selected host configuration and requires exact canonical cwd equality before registering its single owner.
It retains the actual launch-path spelling and revalidates its canonical target at current-context checks, including after awaits.
The regression demonstrates refusal before reservation; a matching cwd still constructs normally.
The only Git initialization was inside the new isolated fixture, never this repository.

## Boundary audit and strengthened controls

- **Freshness:** post-commit raw task whitespace, root hints and business-file changes all return stale/accepted with no episode/worker.
  The saved-graph pre-acceptance snapshot is not a cached task/change preview: actual task bytes, pinned roles/hints/model and changes are reobserved.
  Only the command's own controlRev increment is normalized.
- **Ownership:** one `TaskActions` per real `ServiceOwner`; metadata busy fencing precedes async publication.
  A held metadata operation refuses another preview, while same-ID/lost receipts return observation without another publication/activation.
  Scheduler reservations and signals remain under the existing owner lease; no alternate executor or TaskController was added.
- **Native lanes:** actual readonly SDK children overlap with readonly tools; cross-task writer preference/exclusion and editor tools remain exercised.
  A new actual SDK write to the guard-approved `fixture.txt` advances the service generation and permits its current dependent after original native close and durable result.
  Expected own edits are not treated as foreign changes.
- **Dependencies:** actual retained predecessor text is supplied exactly once.
  A new >16KiB predecessor blocks whole-result handoff, an explicitly selected valid UTF-8 range succeeds, and a split-codepoint selection blocks.
  No clipping, retry or synthesis.
  Existing codecs retain per-predecessor16KiB/aggregate32KiB and public96KiB/full-envelope128KiB limits.
- **Original lifetimes:** cancellation of two active SDK children is requested before a stalled original write settles.
  A separate post-native exit0 settlement-write stall reaches the real unchanged5s reporting deadline while retaining the child slot, episode and encoded allowance.
  Dependent work never launches, v1 stays running, and late original completion does not clear quarantine/refund the scheduler reservation or publish parent success.
  Preparation-continuation, wait-expiry and episode-timeout controls remain explicitly injected clocks/barriers, with real native children where asserted.
- **Plans/history:** real saved-graph HTTP GET/proof POST and both exports before Start remain exercised; accepted proposals and successful current publication stay distinct.
  Maximum graph plus maximum plan, retention collisions/sanitization/selected versions and publication conflicts retain their existing tests.
  A new disk control converts a compact row to the historical canonical duplicated representation and verifies actual raw checksums/readability; contradictory duplicate identities and checksums over the wrong encoding refuse without normalization or repair.
- **Failure:** independent siblings drain after first failure and wait expiry without retries.
  Native close, mandatory capture, committed process settlement, gate release and parent publication remain separate joins.
  Known no-launch is not unconfirmed closure.
  W1 original-auth/write/ownership/stop controls and W2 native/capture guards were rerun, not inferred from these new core tests.

## Executed verification

Successful execution root: `/home/mirako/abel/w4-core-review-0rjH10Bf`, fresh mode0700 on `/dev/sda2` ext4.
TMPDIR/TEMP/TMP selected it for all successful executable checks; fixtures further isolate home/agentDir/state and use fabricated credentials/numeric-loopback providers.
Actual identity: Linux x64, `/usr/bin/node` v26.7.0, Bun1.3.14, installed Pi0.84.3.

Initial setup mistakenly selected `/tmp/cadence-w4-review-QqTLSpJV`, which inspection then showed was tmpfs, not disk.
Its first Vitest import failed ENOSPC before collecting tests; `df -i` showed almost exhausted tmpfs inodes.
Those files/logs were preserved, and the review moved to the fresh ext4 root without cleanup.
The mandatory initial task-path command also preceded temp allocation.
These are explicit deviations, not successful disk-backed evidence.

All test commands used `bun run test --` (Vitest `run --no-file-parallelism`) with the explicit paths below.
No case/native/read allowance was increased.
These are disjoint final batches: **1389 passed, 37 files**, not a whole-repository suite or a sum of overlapping reruns.

| Log under evidence root      | Explicit selected test paths under `test/`                                                                                                                                                                                              | Passed / files | Duration |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------: | -------: |
| `final-core-3.log`           | `service-scheduler`, `service-scheduler-facts`, `service-core-review`, `service-contract` (`.test.ts`)                                                                                                                                  |        261 / 4 |  216.48s |
| `final-history-core-2.log`   | `service-history`, `service-history-plans`, `service-history-semantics`, `service-history-publication-recovery`, `service-history-final-review`, `service-history-graph-boundary`, `service-history-graph-boundary-review` (`.test.ts`) |        181 / 7 |  159.95s |
| `final-owner.log`            | `service-owner`, `service-auth`, `service-model-context`, `service-cli` (`.test.ts`)                                                                                                                                                    |        297 / 4 |  209.72s |
| `final-history-read.log`     | `service-history-projection`, `service-history-live-detail`, `service-history-list-contract`, `service-history-list-entity`, `service-history-search-export`, `service-history-search-scope` (`.test.ts`)                               |         80 / 6 |  560.06s |
| `final-history-progress.log` | `service-history-progress`, `service-history-progress-review`, `service-history-read-completion`, `service-history-lookahead`, `service-history-validator`, `service-history-metadata-cost` (`.test.ts`)                                |         53 / 6 |  251.39s |
| `final-history-boundary.log` | `service-history-blocker-repair`, `service-history-export-http`, `service-history-proof-http` (`.test.ts`)                                                                                                                              |         13 / 3 |   14.46s |
| `final-native.log`           | `lightweight-process-diff`, `lightweight-sdk`, `lightweight-store-controller`, `worker-public`, `worker-recording`, `worker-capture`, `worker-canonical-budget` (`.test.ts`)                                                            |        504 / 7 |  129.88s |

All seven commands exited0.
The core batch includes22 scheduler/action cases, five injected-fact cases, two new disk/encoding cases and232 portable contract cases; it is not261 native SDK scenarios.

| Gate                                             | Result                                                                                                                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run build:service`                          | Exit0; canonical generated service rebuilt.                                                                                                                                                                            |
| `bun run check`                                  | Exit0; syntax, operator/service generated-byte checks, TypeScript no-emit.                                                                                                                                             |
| `bun run check:agents`                           | Exit0.                                                                                                                                                                                                                 |
| `node_modules/.bin/biome check src test scripts` | Exit0,178 files; six informational suggestions, no warning/error.                                                                                                                                                      |
| `bun run lint`                                   | **Exit1**, unchanged W6 frontier. Expanded Biome log records59 errors/51 warnings in `web/`; six informational diagnostics are in tests. Rumdl was not reached by the `&&` script. No suppression or web fix was made. |

The native fixture spawn wrapper launches the actual executable/stock worker with the existing network/write guard and observes original close intervals/exits.
The new write fixture initially requested `actual.txt`, which that guard forbids: it produced actual exit91 and a failed parent, correctly not success.
The corrected fixture requests the already allowed `fixture.txt`; no guard or product policy was weakened.

Other failed/intermediate receipts remain: initial counterexamples, premature nonblocking-only Cancel, one writer-preference timeout, fixture scope/type errors, and an unnecessary inconclusive-lookup payload extension rejected by the existing exact unflushed-marker test.
The payload extension was removed: ordinary `StoredLookup` remains exactly found/absent/inconclusive, with selected identity conflict checks on the separate internal port.
The writer-preference timeout is not given a fabricated historical cause.
No later green result explains or rewrites older50018ms/event35/native failures.

## Frozen identities and changed paths

Full285-input final manifest: `/home/mirako/abel/w4-core-review-0rjH10Bf/inputs-final.json`.
SHA-256: `5501c76bfacbcf1aa5c61e2676b1a8f71001e7a324275b2ed746ae88b0589a86`.
It includes source/tests/scripts, package/config/lock, specs and the unchanged web frontier.
The only late changes after the seven-boundary review began were the cwd check and two tests in `task-actions.ts`/`service-scheduler.test.ts`; `final-core-3` and final gates cover them.
Shared writer/admission/reducer inputs stayed unchanged across the final history/owner/native batches.

Exact commands/exits/log hashes, runtime identity and all own native receipt hashes (including failed/intermediate runs, not relabeled passes): `/home/mirako/abel/w4-core-review-0rjH10Bf/review-evidence.json`.
SHA-256: `de9eb36affa15ff9d00c919e7e14ffdf42d623cf9d226b159c50cccb387dbdeb`.
Preimages/status and intermediate/final input manifests are preserved alongside it.

| Changed source/test/generated path     | Final SHA-256                                                      |
| -------------------------------------- | ------------------------------------------------------------------ |
| `src/history/run-state.ts`             | `842ef3b3ff2c1cab0876d4d108459263476c7eb4f5954351d791f7b7ed8ea630` |
| `src/history/writer.ts`                | `ea41bd328e9f1b1637affb26e248ce589b5ba10e37297b514d1d0c0bbc82c41d` |
| `src/service/admission.ts`             | `9019c32dd46b9ef95ef3877db4747d0977b2252847edae5c22772f3097cdccae` |
| `src/service/ports.ts`                 | `2ca0c23a0d7c62d54db38906b8717d2bf801fa82d1209cd88196c330bdfe7b32` |
| `src/service/task-actions.ts`          | `15a793e5205e049d737f4cea37d7b384701488526734d191f122954a33a6462b` |
| `src/service-host.mjs`                 | `8d9b2186c0d88cf2a72aaf74fadfdf2725fd67deda134a0b8c0fb425fb2eed57` |
| `test/service-contract.test.ts`        | `193c7ab314a35cb8a5cb8f34c41629793ebd623753e48281cdef949c883d3a84` |
| `test/service-core-review.test.ts`     | `f00612815cb357478c467b4f69442a4a25d96d4b9f2c1387f51ee030397cb0d3` |
| `test/service-scheduler-facts.test.ts` | `fe73027afc9569ec8a6f9ee5cb1ef1960365c6f98a69303ef72e8a6111c8eb9b` |
| `test/service-scheduler.test.ts`       | `5661dae93ab29aeb073da736a3c460415a42b8cf9d24a86f024240607fe4a177` |

The only additional repository edit is this report.
No historical evidence hash was rewritten to describe new bytes.
`graph.ts`, `scheduler.ts`, capture code, model/owner implementation, public graph/worker budgets and library pins remain unchanged by this review.

## Residual core qualification versus future composition

### Execution-core coverage still required before wider claims

- End-to-end saturation of all eight episodes/128 queued assignments, dynamic readiness fairness combinations and alias-driven multi-task execution; count formulas and existing coordination tests are not that native qualification.
- W4-composed genuine pending OAuth/network uncertainty, unknown native stop, ownership loss during every stage, crash/restart windows and selected-source mutation at every auth/publication boundary.
  New barriers are labeled injections; existing lower-boundary tests do not qualify every combined scenario.
- A separate native legacy-task continuation control and broader historical/range/corruption combinations.
  Default-plan production and exact raw-task checks do not imply every legacy path was executed.

These are explicit unexecuted combinations, not an assertion that the small core suite qualifies all parent acceptance.

### Subsequent W4/W1/W5/W6/W7 work

1. Implement actual readonly Generate-plan, configured/native-manual parent checks with frozen ordinary environment/full retained output, exact own-generation check freshness and human issues review.
2. Bind accepted episode/metadata lifetimes and quiesce to actual host Stop, including accepted-but-not-launched and uncertain storage phases.
3. Supply bounded current/active/recent metadata and reconstruct own-publication lineage without importing historical approval.
   Keep `admission:null`, actions/manualChecks false until real paths are composed and independently checked.
4. Complete W1 proxy/informed recovery, W5 terminal cutover, W6 browser integration and lint, W7 source/extracted assets/license/package/full acceptance.
5. Physical human/device, paid provider, other native platforms/peers and real deployment remain unqualified.
   No commit/publication authorization follows.

Spec-sync judgment: preserve these corrections in the eventual main-owned contract update, especially stop-before-original-barrier, conflict-only identity lookup, gate-mode/drain invariants, accepted-access versus execution freshness and exact launch cwd.
Specs were explicitly outside this review's edit scope.
