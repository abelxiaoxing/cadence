# W4 Accepted-work Lifetime Handoff

## Disposition

Implemented **only** the assigned accepted-work/original-lifetime and fixture-transport slice.
Final affected checks: **1111 passed, 0 failed, 0 skipped across18 files**, original Vitest runner exit0.
The original31 scheduler cases and their topology/assertions/deadlines remain; their only fixture change is explicit original-aware transport disposal.
**Independent review is required and has not been performed.
W4 and the product remain incomplete.**

Production `src/service/host.ts` remains unchanged with `admission:null`.
No checks/review, model chooser/current metadata, build handshake, frontend, dependency/pin/lock, deployment, credential administration, recovery, user Git operation, task-status change or cleanup was added.
All fixtures use isolated fabricated profiles/workspaces; source tests' Git fixture operations never target this checkout.

Authority/read context: active child manifest/artifacts; complete parent PRD/design/plan and both mandatory appendices; current owner/history/orchestration specs; latest IO diagnosis, `model-current-view-composition.md` §8 and `accepted-work-lifetime-handoff.md`.
The implementation choices were recorded first in `w4-accepted-work-lifetime-contract.md`.
The narrow native signal guard below was added after a new concrete counterexample, not as a protocol or executor replacement.

## Actual Lifetime Contract

### Owner registration and synchronous Stop

`src/service/owner.ts` adds:

```ts
type AcceptedWorkResult = { status: "settled" | "uncertain" };
owner.registerActions(quiesce: () => void): void;
owner.trackAccepted(original: Promise<AcceptedWorkResult>): void;
owner.acceptedPending: number;
owner.settled(): Promise<void>;
```

These are owner-private APIs, not wire authority or task outcomes.
`registerActions` accepts exactly one actual action owner while its lease is valid and admission open, including externally constructed core fixtures.
Stop publishes its coalesced attempt before callbacks, closes action admission/grants/queues synchronously, requests all selected stops before awaiting originals, and preserves the existing per-callback lease checks.
HTTP quiesce remains independently composed by the actual host.

The original accepted-work promise is an additional `work` activity; native, auth and storage originals remain separately tracked.
Its explicit uncertain result or rejection quarantines; a caught `Promise<void>`, no native children, or pendingWrites0 cannot prove completion.
The private Stop report now includes `pending.work`; existing process/auth/storage counts remain separate.
`settled()` joins the current original Stop attempt without retrying it or upgrading an earlier bounded report.
Late permitted storage registrations still join before flush/listener/release, including the previously existing flush/listener regression boundaries.

### Commit through activation, metadata and whole episode

`src/service/task-actions.ts` uses a narrow `Pick<ServiceHost,...>` containing only its actual coordination/owner/writer/reader/models/access dependencies; no unfinished-host casts.
It installs its synchronous quiesce participant on the real owner.

The accepted control-flow original is registered **before the first commit microtask**, covering the commit-to-postcommit-observation-to-activation gap as well as accepted-but-unallocated episodes.
The admission reply and original lifetime are distinct promises.
A genuinely committed action waits for its actual metadata/episode completion or quiesce disposition; duplicate receipt observation never reactivates it.
Metadata busy visibility remains synchronous.
Stop before its first metadata microtask prevents plan retention/publication; Stop during pending original work cannot allow later ordinary saves.

`TaskScheduler.activate` returns the whole episode's `Promise<AcceptedWorkResult>` after synchronously publishing its bounded episode identity.
That original joins the existing initialization, cancellation/close, wait-observation, child-execution and finalization continuations.
Its job accounting is part of the existing scheduler, not another dispatch engine.
Failures mark uncertainty; completion does not refund quarantined episodes/reservations.
An ended but unpublished episode's current target is explicitly unknown, not left apparently active.
Queued work cannot allocate/launch after quiesce; already-active native/auth/storage work remains independently joined.

`TaskActions.settledAll()` observes these exact originals for fixtures.
`TaskScheduler.settled/settledAll` observe episode control-flow completion, not successful execution or authorization to clear its reservation.
The existing fair gate, two reservation ceiling, graph/dependency logic, child timeout and no-retry behavior are unchanged.

### Writer effects and truthful nonapplication

`src/history/writer.ts` adds a synchronous `quiesce()` ordinary-effect gate and `abandonPublication(operationId)`.
The existing single writer checks quiescence at ordinary job/effect boundaries, including actual publication-before-save.
No alternate writer, candidate, run allocation or v1 bytes are fabricated to close an accepted action.

Necessary closed admission/closing/unstarted/gate-release/parent/native/auth settlement facts remain original tracked work.
Already-launched capture drainage is a **separate private continuation flag**, not safety permission to ignore a recording fence or use control headroom for data.
It retains the original capture budgets, membership validation and per-batch lease/write checks.
Ordinary Stop closure and recording-failure quarantine are not conflated.

`abandonPublication` reads the actual accepted operation and latest publication fact.
It settles an existing candidate's exact publication ID when one exists; otherwise it records a distinct uncertain/null-observation publication without making a candidate.
Already-recorded conflict/uncertainty is not rewritten.
The same `RunState` publication transition now permits only exact accepted-operation **uncertain/null** nonapplication before parent allocation; successful pre-allocation publication remains impossible.
Actual reopened receipt and export controls preserve execution/settlement=null and absence of parent-admitted facts.

This slice deliberately does **not** publish a new ordinary summary after Stop.
Interrupted accepted work whose publication cannot finish retains uncertain publication and fences, even if its native child closed cleanly.
Idle/already-completed clean Stop still releases through the original flush/listener/lease path.
This conservative result is not a claim that all active-work Stops are clean shutdowns or that summary/publication uncertainty was resolved.

### Native signal-time ownership correction

The first new loss-of-ownership test failed: the scheduler correctly declined its stop callback, but recording failure inside `runProcess` could still issue TERM.
The existing runner now accepts optional owner-private `maySignal`, passed by the service scheduler through `preparedWorker`.
Every actual TERM and KILL, including recorder/protocol failure and escalation, checks the current lease at the signal boundary.
A false/throwing guard does not signal; original close or the unchanged unknown deadline still decides native closure.
Legacy workers/checks without that service guard retain their previous behavior.

No worker frame/envelope/protocol, SDK route, dependency, new spawn runner, timeout or process-recovery authority changed.
The real SDK ownership-loss case now receives original zero close without TERM, while recording/publication remains uncertain.
A separately labeled injected-native-handle test proves the guard is checked again between TERM and KILL and cannot invent closure.

## Fixture Ownership and Teardown

`test/service-scheduler.test.ts` now observes the first Stop report, joins exact accepted/writer/current-Stop originals, then explicitly closes its own `HistoryLive` and `ServiceHttpServer` transports before closing its provider.
The HTTP close implementation joins its original listener, WS server and selected socket closes and clears the heartbeat.
New `service-accepted-work` fixtures use the same ownership discipline.

This disposal runs even when the production owner is deliberately quarantined and would retain restricted diagnosis.
It does not call recovery, unlink private locks, refund unknown scheduler reservations, rewrite results, or substitute fixture transport closure for production Stop success.
The final run retained40 fixture receipts:31 scheduler receipts and9 new lifetime receipts.
Those selected fixtures observed29 and5 actual SDK children respectively; these are **not** the native-child count of the entire1111-case suite.
The receipts preserve original native observations, early Stop reports and late uncertainty/retained-lock facts.
No supervisor force-stop was needed.

## Verification and Preserved Failures

Evidence: [w4-accepted-work-lifetime-evidence.json](w4-accepted-work-lifetime-evidence.json).
It records all final case names/outcomes/durations, source hashes, original runner PIDs/exits, command arguments, gate logs and selected fixture receipts/hashes.
Overlapping development runs are not added to the final count.

Root: `/home/mirako/abel/cadence-accepted-lifetime-tIqJSJkX`, mode0700, `/dev/sda2` ext4.
Runtime: Linux x86_64, `/usr/bin/node`26.7.0, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.
TMPDIR/TEMP/TMP selected that root for every command after allocation.
Initial task discovery/bootstrap used the existing `/home/mirako/abel` parent before allocation; this is an explicit setup deviation, not a private-root test execution.

| Executed gate                    | Result                                                      |
| -------------------------------- | ----------------------------------------------------------- |
| Final18-file affected run        | 1111/0/0; original exit0,577.039s supervisor elapsed        |
| Complete original scheduler file | 31/0/0; included above, unchanged20s cases                  |
| New actual-host lifetime file    | 9/0/0; included above,20s cases/15s SDK children            |
| `bun run build:service`          | Exit0; canonical rebuild only                               |
| `bun run check`                  | Exit0; syntax, operator/service byte checks, TypeScript     |
| `bun run lint`                   | Exit0; no warning/error, existing informational suggestions |
| `bun run check:agents`           | Exit0                                                       |
| `bun run check:web`              | Exit0                                                       |
| `bun run build:web:check`        | Exit0; canonical web bytes unchanged                        |

The final run used actual `/usr/bin/node node_modules/vitest/vitest.mjs run --no-file-parallelism` with18 explicit file paths and JSON/verbose reporters.
The supervisor waited that original process, with1800s outer allowance; no assertion/read/native/capture budget was increased.
All359 selected executable/source/test/build/provenance/config inputs matched before/after the final tests.
This manifest is not an exhaustive hash of all installed transitive dependencies or historical task documents.

Affected files: service-accepted-work, service-scheduler, service-owner, service-cli, service-model-context, service-core-review, service-scheduler-facts, service-contract, service-history, service-history-plans, service-history-semantics, service-history-publication-recovery, service-history-final-review, service-publication-parity-review, lightweight-process-diff, lightweight-sdk, worker-recording and worker-capture.
These include real native/filesystem/HTTP controls and injected portable/fault controls;1111 is not1111 native scenarios.

Preserved intermediate evidence:

1. Initial TypeScript failure: the publication scan's fact wrapper was accessed incorrectly; corrected before runtime checks.
   Original log retained.
2. First three-file run:112 passed/1 failed.
   The new native lease-loss signal counterexample above reproduced an actual gap; its original failure remains failed.
3. Subsequent complete scheduler plus new lifetime run:39/0/0 before the queued-Stop addition; not added to final totals.
4. First broad run:1110 passed/1 failed.
   The existing >2MiB actual W1/W2/W3 capture case returned timeout at its original15s child budget.
   A redundant per-capture lease read introduced in this slice was removed, retaining existing batch/effect checks.
   Later success **does not prove that duplication caused the timeout**.
5. Broad1111/0/0 then final1111/0/0 after explicitly marking ended/unpublished current targets unknown.
   Both receipts/source freezes remain distinct.

The prior diagnostic31/31 and older20-pass/11-fail scheduler evidence remain untouched.
Neither the demonstrated whole-work/transport gap nor these fresh passing runs explain those older eleven failures, previous event35, or historical platform/provider/timeouts.
No unchanged rerun was used to erase a failure; each post-failure execution followed an identified source correction and retains its predecessor receipt.

## Changed Paths and Remaining Gates

Six maintained production files:

- `src/service/{owner,task-actions,scheduler}.ts`
- `src/history/{writer,run-state}.ts`
- `src/subagent-process.ts`

Generated: `src/service-host.mjs` only; management/operator/browser outputs stayed byte-identical.
Tests: new `test/service-accepted-work.test.ts`; existing `service-owner`, `service-scheduler`, `service-publication-parity-review`, `lightweight-process-diff` tests.
Research: contract note, this handoff and its evidence JSON.
No historical acceptance hash was rewritten as current-source evidence.

Next step is main-dispatched **independent review** of this frozen slice, particularly commit-to-activation accounting, continuation-versus-safety classification, candidate-less publication parity, signal-time lease checks and retained unknown reservations.
No subagent was spawned here.
Main should deliberately synchronize maintained owner/orchestration/history specs after that review; the executable changes and limitations are recorded here, not silently relabeled as fully integrated behavior.

Still open: accepting-host action composition, actual checks/human review, current model/metadata/lineage/build handshake, W1 proxy/informed recovery, W5 terminal cutover, W6 accepting browser, W7 full distribution/whole-product acceptance.
No package extraction/full verify, physical-human/device, paid-provider, Windows/macOS/ConPTY, Node22/Pi1.2 or deployment qualification is supplied by this slice.
