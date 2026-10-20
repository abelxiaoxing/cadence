# Service Orchestration Core

Implemented shared-owner contracts; component evidence is not whole-product acceptance.
Read [capture/history](./service-history-capture-guidelines.md) and [owner lifecycle](./service-owner-guidelines.md) together.

## 1. Scope / Trigger

Use when composing the new `service/{graph,scheduler,task-actions}.ts` core with the existing writer and lifecycle owner.
`createServiceHost` installs real TaskActions admission/current/choice/check/history/live ports and package-relative assets before accepting actions.
Initial model selection remains null; independently compiled compatibility is checked on mutation ingress.
Readonly Generate is advisory; Start, checks and human review are separate explicit admissions.

## 2. Signatures

- `TaskActions` implements the existing `AdmissionOwner` and owns one `ActionAdmission` plus one `TaskScheduler` per `ServiceOwner`.
- `GraphContext` loads actual pinned package roles and bounded root hints; `dependencyHandoff` reads exact committed predecessor content.
  `planningAssignment(model)` and `planningRequest(task,model,runId,childRunId)` supply one fixed research-purpose `design-explorer`, not the saved graph.
- `EpisodeInput` distinguishes `{kind:"start",graph:Graph,planUnretained:boolean}` from `{kind:"generate-plan",graph:null,planUnretained:false}`.
- `HistoryWriter.lookupForAdmission(id)` inserts one readonly observation at the exact existing original-chain boundary; subsequent jobs follow it.
  It never chases a moving tail, writes, flushes or claims absence from uncertainty.
  Ordinary `lookup(id)` remains immediately inconclusive when publication is fenced; Cancel uses that immediate lookup BEFORE stop, then the serialized barrier afterward.
- `retainAcceptedPlan(operationId,secrets)` remains save-plan-only.
  Separate `retainAcceptedRunPlan(operationId,graph,secrets)` derives default/legacy plan text from the accepted Start's exact raw task and binds the proposed graph to its accepted context hash.
- `OwnerFact` adds closed `assignment-state` and `admission-closed`; gate facts optionally name an allocated `reservationId`.
  Historical run-wide gates remain readable.

## 3. Contracts

The same `RunState`, `projectRunObservation`, finite read state and exports retain these facts.
Scheduler hints never create native outcomes or closure; membership and transitions are validated against actual allocation.
A pending recording with no selected final after canceled/failed native closure is not an outstanding selected-result write.
It still cannot satisfy successful child completion; selected pending results and unconfirmed native closure remain uncertain.

Generate remains code-kind-only at admission, with one readonly planner, exact selected model/role/hints and null durable admission graph.
It uses the same pre-auth reservation, original promises and native/capture settlement as Start, but no accepted-plan producer or graph handoff fact.
A genuine invalid/oversized advisory final remains retained native output; it is not parsed, clipped into graph authority or automatically saved/started.
Publication preserves even an empty readable plan and all checks; result text explicitly labels the proposal advisory.
Current saved-graph lineage across own Generate summaries is validated from committed publication history on cold load; it restores readable context, never approval.
Save preview shows the exact proposed readable plan and graph while version identity still names the current selection.

A later pre-effect publication refusal after `published` may record `uncertain` with a distinct publicationId and null observed bytes, without a new candidate intent.
The shared reducer retains prior intent provenance, blocks continuation and preserves separate execution facts/external bytes.
Reused latest IDs, invented publication success and non-null observed candidate-less refusal reject.
Exports retain the earlier lifecycle projection and subsequent publication facts separately; an earlier published projection is not the final publication outcome.

Private journal encoding now writes `admission-compact`: one intent identity plus receipt, decoded to the existing in-memory admission shape.
Old duplicated canonical admission rows remain readable; no record, graph, plan, worker or read ceiling is raised.
The maximum graph and maximum plan must fit together, not only in separate tests.

Saved graph reads join accepted operation, exact retained plan and successful publication before Start, including finite proof continuations.
Exports also retain accepted saved graph documents with their independent publication facts; an exported graph is not executable authority.
Original auth, worker and storage promises stay distinct from reporting deadlines.
Accepted episodes ignore detach/access rotation, but selected sources and exact own-publication identities remain fresh.
Accepted plan producers normalize ONLY accessGeneration after committed acceptance; epoch/controlRev+1/model/config/observation/task/raw-byte/graph checks remain exact.
TaskActions requires exact canonical equality with the configured launch cwd, not merely same-checkout membership; retain actual spelling and revalidate the target after awaits.

Cancel rejects known conflicting pending command IDs and actual reserved intent identities before safety effects, including saturation.
The separate `reservedIdentity` port is credential-free conflict evidence only, not a receipt/absence claim.
Pending identities remain charged through original admission settlement.
Current exact-run authority must be rechecked after any earlier await; then stop all selected children BEFORE joining an original journal barrier.
Do not put the safety lane behind a stalled unrelated write.

RunState permits one legacy/per-reservation gate mode per run, rejects incompatible held lanes and requires actual child auth/native settlement before release.
A native exit0 followed by a stalled original settlement write retains its slot/episode/encoded allowance and blocks dependents/parent success.
Late original completion does not clear quarantine or refund that unknown reservation.
Post-commit source checks reread actual task, hints/model/roles and business observations; a cached old preview is not a current source.
`TaskActions.obligationsFor` advances its review revision only from an available current context.
An unavailable viewer may conservatively display a passed check as stale, but cannot mutate the last authoritative check signature/revision: a pending own publication can make another tab unavailable between acceptance and post-commit validation.
`service-human-review` injects that actual viewer read at the original commit boundary and requires unchanged accepted Review to publish Done, while existing raw-task/config/check/change negatives still refuse.

## 4. Validation / Error Matrix

| Condition                                                        | Required result                                                                            |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Wrong-operation plan producer or changed selected task           | Refuse; no imported approval or substituted content                                        |
| Pending original publication during passive receipt read         | Inconclusive, not absent and not a blocking wait                                           |
| Authenticated Cancel before its journal wait                     | Close admission and abort selected children; later failure cannot undo that safety request |
| Access changes during receipt lookup before safety authorization | No stop or new effect under the old caller                                                 |
| Unknown reservation, illegal success hint, wrong role/lane       | Refuse/fence, never native success by scheduler declaration                                |
| Ready wait expires or required input becomes stale               | Stop that parent admission; drain independent active siblings                              |
| Invalid/oversized Generate proposal with genuine native success  | Retain full advisory output and native facts; no automatic Save or Start                   |
| External task edit before a subsequent candidate can be prepared | Distinct uncertain publication fact, preserve bytes and quarantine                         |

## 5. Good / Base / Bad Cases

Good: allocate durably, reserve the checkout lane, prepare exact current auth, record launch intent, launch the maintained worker with the real sink, then commit native settlement before handoff.
Base: a newly accepted readonly goal-only Start retains its own empty plan and explicitly displayed default assignment.
Bad: call the save-plan producer with a Start ID, treat absent final selection as a successful result, or enable production HTTP before missing named actions exist.

## 6. Tests Required

`service-scheduler` exercises actual isolated SDK children, overlap, tools, durable handoff, reader/writer exclusion, Cancel, first-failure sibling drain and default plan production.
Its preparation continuation barrier and monotonic policy-expiry clocks are explicit injections; they do not qualify real OAuth stalls or six hours of native execution.
`service-scheduler-facts` exercises real disk plus injected facts through the shared finite projection and membership negatives.
`service-history-plans` covers maximum graph plus maximum plan; existing graph HTTP/proof/export and corruption/progress tests retain their original integrity and bounds.
`service-accepting-host`, `service-current`, `service-checks`, `service-human-review` and `service-stop-continuation` exercise real accepting composition and publication joins.
Historical W4 handoffs retain their original source identities/failures; the parent delivery ledger owns current status.
Keep controls for actual native write→current dependency, selected UTF-8/oversized handoff, token rotation after acceptance, post-commit external source changes, stalled-write Cancel/conflicting IDs, exact cwd and raw historical duplicated admission checksums.
The independent review records1389 cases/37 files, not1389 native SDK scenarios or whole-product qualification.
Whole lint at that revision failed on the unchanged unqualified W6 frontier; later fixes cannot rewrite that receipt.

Generate controls retain one readonly child despite saved edit assignments, full48022-byte output, unchanged empty/saved plan, no late auth/launch after changed task/hints/files, rotation/detach and explicit Cancel.
`service-publication-parity-review` joins actual disk, reopened receipt, finite projection and both complete export encodings/digests without creating candidate bytes or changing execution.
Its owner facts are injected, not native evidence.
`helpers/scheduler-diagnostics.ts` retains bounded test-only stages/original-promise identities and overlapping cost counters without awaiting originals or retaining payloads.
The historical writer-preference20s failure remains failed; its traces showed continued write/gate progress and native zero closes, not an established exclusive cause.
Do not raise budgets, cache stale authority, move assertions outside the case, or give old failures a retrospective cause from these observations.

## 7. Wrong vs Correct

Wrong: make all receipt reads await original writes, causing a passive read to block the fixture/operator that must settle that write.
Correct: keep ordinary lookup immediately inconclusive; only the bounded admission path waits on the original chain without a write-on-read or an absence fallback.
Wrong: persist the same maximum graph twice inside one journal admission and raise the record limit when it fails.
Correct: use the closed compact internal encoding while preserving historical decoding and every existing public limit.
