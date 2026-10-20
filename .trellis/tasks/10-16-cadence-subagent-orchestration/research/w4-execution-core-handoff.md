# W4 execution-core handoff — production actions remain closed

## Disposition and ownership

Implemented the executable Create → save-plan → graph-before-Start → Start milestone against real W1/W2/W3 components.
This is **not W4 completion, accepting production HTTP, or product delivery**.
`createServiceHost` still installs `admission:null`, actions false and manualChecks false.
Generate-plan/check/review are explicitly unavailable in the new action owner.
No accepting stub, TaskController instance, second SDK runtime, process runner or writer was introduced.

Read the active manifests/artifacts, both complete readiness-context parts, all parent artifacts/appendices, runtime/nonoverlap handoffs, W1 host/lifetime reports, current specs and adjacent implementation/tests.
Used installed public Pi0.84.3 declarations rather than assuming global1.2 documentation matches.
No agents, Git mutation, staging, commit, deployment, real credentials, dependency/pin/lock changes, capture-protocol edits or consumer cleanup.
No `web/` or W6 provenance edits and no whole-tree lint during the parallel UI port.
The existing task metadata and historical lint failure were not rewritten.

## Selected APIs and actual behavior

### Admission and current sources

`src/service/task-actions.ts#TaskActions` implements the existing `AdmissionOwner` and owns one actual `ActionAdmission` and `TaskScheduler` per `ServiceOwner`.
A duplicate action owner for the same lifecycle owner refuses.
Create/save-plan metadata registers a synchronous busy fence before asynchronous publication; Start registers its episode before returning to admission.
Only newly committed commands activate; receipt lookup does not.

Readonly previews use actual TaskStore snapshots/raw identities, canonical cwd, captureChanges, selected model validation, package role identities and bounded root AGENTS bytes.
`OwnerModelContext.assertCurrent(selection)` exposes readonly selected-source validation, never getAuth or inference.
The admission adapter retains the exact pre-commit snapshot for its immediate post-commit comparison, allowing only the writer's own controlRev+1.
Execution separately tracks its actual running/final v1 publication identities so these cannot self-stale the accepted child.
Unrelated task control revisions and access rotation are not execution cancellation authority.
Selected external task/hint/model changes still refuse.
The bounded owner publication cache is not a restart/current-view adapter; that remaining gate is listed below.

`HistoryWriter.lookupForAdmission(commandId)` waits already scheduled original jobs, without flushing on read or treating inconclusive as absent.
Ordinary `lookup` keeps its prior immediate-inconclusive behavior under an original publication fence.
This distinction is independently tested at a real unflushed marker.
Authenticated exact-run Cancel closes admission and requests all selected stops before waiting for its cancellation journal commit.
Rotation during the earlier receipt lookup still denies an unauthorized stop; rotation after an already-authorized safety request cannot undo it.

### Plans and saved graph reads

`retainAcceptedPlan(operationId,secrets)` remains save-plan-only; its wrong-operation negative is retained.
`retainAcceptedRunPlan(operationId,graph,secrets)` is a separate default/legacy Start producer: it derives text from the exact selected raw task and requires the accepted context's graph identity/revision.
It does not accept replacement plan text, write during preflight, reuse old approval or adopt an existing saved plan.
`planRecording` is the shared internal chunk builder, not a public content-ID override.
Goal-only readonly Start now has actual retained empty-plan/default-assignment execution evidence.
The explicit legacy path uses the same raw-task producer but lacks a separate new native legacy fixture in this pass.

Saved graphs now pass the real graph reader before any Start, including finite original-source proof continuations.
`history/saved-graph-state.ts` stores only fixed source locators/counters in navigation; it validates exact accepted plan chunks/end and delegates publication transitions to `OperationState`.
Existing graph HTTP limits, original-source validation and full response correlation remain.
Exports retain accepted saved graph documents together with their independent publication facts; an exported proposal is not executable authority.
The actual mutation-closed host HTTP/client tests exercise saved graph GET, proof POST and both completed exports before Start.

The maximum512KiB graph plus maximum32KiB plan reproduced an admission failure from serializing the same identity twice.
Private `admission-compact` disk encoding now stores one intent identity and receipt, reconstructing the unchanged in-memory admission shape.
Old duplicated canonical rows remain readable.
No graph, record, plan, worker, HTTP, read or native budget was enlarged.
The combined maximum case passes real committed retention/publication; existing maximum graph HTTP/proof/export controls also pass.
Those are separate cases, not a claim that the combined maximum was repeated through every host route.

### Graph, scheduler and original lifetimes

`service/graph.ts#GraphContext` loads actual pinned Agent bodies/hashes and safe bounded root conventions.
Purpose controls capability; a readonly child of a code task receives no bash/write/edit tools.
Role instructions, readable plan, assignment/goal/expected output/conventions and handoff are placed once in the bounded public request.
The existing decoder enforces96KiB before auth; actual prepared consumption retains the independent128KiB envelope check.
Oversized composition refuses rather than clipping reviewed content.

`dependencyHandoff` joins genuine committed successful native predecessor settlement and exact selected final content, UTF-8 ranges/hash/coverage and16/32KiB bounds.
W3 independently rejoins supplied bytes before recording the handoff.
Current dependencies also bind the committed after-observation and compatible checkout generation; they never use previews or hidden synthesis.

`TaskScheduler` has eight episode/128 queued bounds, conservative retained-byte allowances and two preparing/running/closing reservations.
Waiting work does not occupy child slots.
Parent selection is round-robin with frozen assignment order; a ready writer excludes younger readers, and held writers exclude all other lanes.
W3 alone reserves disk.
The core freezes decoded graph/task/intent copies after capacity admission.

The execution chain is actual default-plan retention if needed → immutable run allocation → own v1 running publication → gate/before-change/handoff facts → `prepareTracked` → launch intent → maintained `preparedWorker` with mandatory W3 sink → immediate original ServiceOwner tracking → durable native settlement → after-change facts → original preparation drain → gate release → parent settlement/final v1 publication.
Actual bounded before/after text is retained through owner content and real returned references, not fabricated SDK events.
A selected first baseline feeds the strict v1 summary publisher.

First failure stops further admission for that parent but lets independent native siblings finish.
Wait expiry/stale required context/overflow drain; the six-hour policy deadline and explicit Cancel abort active selections concurrently.
No queued assignment is retried or revived.
Unknown storage/ownership/native closure quarantines; signaling rechecks ownership for each selected child.
Known no-launch refusal is distinguished from unconfirmed native closure.
A canceled/failed native child with no selected final can drain without inventing a final result; selected pending/uncertain recording still fences and no incomplete child can satisfy all-success.

### One fact/projection owner

Shared closed `OwnerFact` adds `assignment-state` (waiting/ready/preparing/closing/unstarted), `admission-closed`, and optional per-reservation gate IDs.
Membership, lane and transitions bind actual allocation; old run-wide gates remain readable.
Scheduler observations cannot assert native closure or success.
The same `RunState`, `projectRunObservation`, finite `run-progress-state`, retained readers and exports consume the additions.
Cold finite projection is tested against the shared reducer, including individual wait-expired reasons and unknown-holder refusal.
No client-only scheduler reducer was added.

## Executed verification and exact evidence

Fresh disk-backed0700 root: `/home/mirako/abel/w4-core-jOR5tzlJ`.
All subsequent development commands selected this root through TMPDIR/TEMP/TMP.
New native fixtures use explicit fabricated agentDir/HOME, allowlisted environment and numeric-loopback providers.
The test-only spawn wrapper preserves real native processes and adds the existing SDK network guard; original close intervals/exit observations are asserted.
Final fixture receipts are `cadence-w4-native-*/sdk-receipt.json`; these contain no auth/environment dumps.

Actual environment: Linux x64, `/usr/bin/node` v26.7.0, Bun1.3.14, installed Pi0.84.3 and Vitest4.1.10.
Exact source/command/log/fixture identities are in `research/w4-execution-core-evidence.json`.
Its commands include explicit selected paths, not a whole-suite claim.

Successful disjoint verification batches on the shared backend revision:

- `lookup-core-regressions.log`: service-history + scheduler + service-contract,279 passed/3 files.
- `history-four.log`: plans, graph-boundary, graph-boundary-review, final-review;41 passed/4 files.
- `history-progress-six.log`: progress, progress-review, read-completion, lookahead, validator, metadata-cost;53 passed/6 files.
- `history-read-six.log`: projection, live-detail, list-contract, list-entity, search-export, search-scope;80 passed/6 files.
- `history-boundary-six.log`: blocker-repair, export-http, proof-http, publication-recovery, semantics, scheduler-facts;113 passed/6 files.
- `owner-four.log`: service-owner, auth, model-context, CLI;297 passed/4 files.
- `native-guards-seven.log`: lightweight process/diff, SDK, store/controller and worker public/recording/capture/canonical-budget;504 passed/7 files.

These disjoint batches cover1367 cases/36 files, not a whole repository/pack/browser suite.
Later edits were limited to the new scheduler/action core and its native test (policy-clock option, truthful wait reasons, frozen copies and allowlisted fixture receipts).
The final `final-core-eleven-2.log` replaces the earlier core evidence with **11 passed/2 files**, including all nine actual-core scenarios and two injected-fact tests.
Do not add overlapping reruns to1367.
The final evidence manifest lists exactly which inputs differ from the broad-batch freeze.

Final canonical service build, `bun run check`, `bun run check:agents` and explicit changed-source Biome checks pass.
The scoped Biome result has one informational template-literal suggestion, no error/warning.
Scoped spec/report Markdown checks are recorded separately.
Whole-tree lint waits for main's W6 barrier.

Native core assertions cover:

1. Actual Create/save-plan/publication and graph HTTP/proof/export before Start; two simultaneous stock-SDK readonly requests with original native overlap and exact model/tools.
2. Exact predecessor text delivered once, only after durable result and original native close.
3. Cancel of two active SDK children, no third launch, truthful canceled native facts and unstarted child reason.
4. Goal-only readonly default-plan production and completed native execution.
5. First provider failure with a still-running independent sibling draining successfully; parent remains failed and the queued node never launches.
6. Cross-task writer preference/exclusion with actual readonly versus editor tools; later queued work blocks on changed service generation instead of silently launching.
7. Cancellation during a real persisted preparation's injected continuation barrier retains its slot/original settlement and never launches late.
8. Injected ten-minute wait policy drains two real active siblings without canceling them and leaves the queued node blocked.
9. Injected six-hour policy cancels real native children; native canceled facts remain distinct from parent timeout.

Clock/continuation injections are not wall-clock six-hour execution or a real pending OAuth HTTP qualification.
The existing W1 original-auth/write and native-process/SDK controls were also rerun, but do not substitute for every new orchestration failure combination.
No paid-provider, physical-human/device, browser/terminal cutover, extracted-package, proxy-auth, recovery takeover or other native platform qualification is claimed.

## Preserved failures and corrections

The evidence directory preserves all failed/intermediate logs, including missing HttpPolicy schema/import/type errors, the combined maximum-plan/graph reproducer, initial normal-Cancel inconclusive/timeout findings, and the old Cancel-order assertions.
The ordering assertion was intentionally replaced with stop-before-journal behavior plus a new rotation-before-authorization negative, not deleted wholesale.

A broad1200-second command ended at the tool aggregate deadline without a final test receipt and logged the passive-lookup regression.
After its correction, a22-file900-second aggregate also lacked a final receipt; neither is a passing run or an observed successful native suite exit.
The final explicit smaller batches retained every original per-test/native/read budget.
Their measured durations include558.73 seconds for the six retained-reader files and250.95 seconds for six progress files; aggregate tool allowances are not individual test bounds.
The passive lookup fix keeps ordinary reads nonblocking and adds only the admission-specific original barrier.

No new result explains or rewrites historical50018ms/event35/other native failures, or the earlier task-newline lint failure.

## Remaining gates — main must not open host actions yet

1. Implement readonly Generate-plan as its own accepted episode/proposal; never dispatch the saved graph or accept its output automatically.
2. Implement actual configured/native-local manual checks through existing runCheck/runProcess: frozen ordinary environment with service-control stripping, full allowed sanitized output, original native facts and exact own-generation transition.
3. Implement actual current obligations/changes/review context and short review barrier with issue acknowledgment, preserving all child/check outcomes.
4. Bind accepted episode and metadata lifetime/quiesce to the real host Stop lifecycle, including accepted-but-not-yet-launched, unknown storage and ownership-loss windows.
   Current native tests exercise original worker/auth/writer tracking and Cancel, not accepting-host Stop under every stage.
5. Supply the bounded current/active/recent ReadEnvironment and finite shared role/savedGraphRef metadata for W5/W6.
   Owner-only `savedGraph` is not a completed public current-descriptor endpoint; the host intentionally still projects unavailable current authority.
   Reconstruct own-publication lineage for cold current views without treating old context as authority or retaining all archive graphs in RAM.
6. Add remaining actual orchestration capacity/saturation, selected-range/overflow/corruption, source-change, aliases, crash/restart, current-view and unknown-stop composition controls.
   Existing lower-boundary integrity tests and the new small exact handoff do not qualify every combined scenario.
7. Independently review this source revision before enabling any accepting host path.
   W1 outbound proxy/informed recovery, W5 terminal cutover, W6 browser integration and W7 distribution/full acceptance remain distinct gates.

Spec-sync judgment: appended an explicitly partial execution-core scenario to `service-history-capture-guidelines.md`, documenting these executable APIs, compact encoding, lookup distinction and regression requirements.
No W4/parent task completion or product-release claim follows.
