# Bounded multi-subagent scheduling and durable observations

## Scope and evidence

Planning research only.
`python3 ./.trellis/scripts/task.py current --source` resolved `.trellis/tasks/10-16-cadence-webui-terminal` through the current session.
Read the current PRD and both existing research reports; their earlier one-worker/terminal-owner recommendations are superseded by the PRD's selected independent owner and bounded collaboration, not by implementation approval.
Only this file was written.
No agents spawned, installs, service launches, model calls, tests, task activation, commits or cleanup.
Source/test references below are inspected contracts and proposed verification, **not executed evidence**.
A static file/line-range inspection of 46 explicit citation ranges found no missing or out-of-range references; this does not validate behavior.
`U:` means `/home/mirako/abel/pi-web-ui` at `e8bab487af208bc9a1ab60a821652323f598127f`; HEAD and clean tracked/untracked status were reconfirmed.
Local installed Pi agent-core is 0.84.3; global coding-agent docs are 1.2.0.
Read complete global `docs/sdk.md`, `json.md`, related lifecycle/message references and SDK examples; exact event fields below come from local declarations.
No external documentation/network lookup was needed.

## 1. Concrete seams and constraints

| Current owner / anchor                                                           | Finding relevant to this design                                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/task-controller.ts:32-83,190-245,293-369`                                   | One selected task, one active abort/settled pair, one checkout lock per operation. Calling several existing controllers' `start()` in parallel will contend on that lock; it does not produce a shared scheduler.                                       |
| `src/task-store.ts:193-214,266-316,352-399`                                      | Canonical-root private namespace; exclusive `checkout.lock`; `save(..., heldLock, expectedIdentity)` already permits the owning process to write metadata without reacquiring. Recovery checks a dead parent PID, not worker closure.                   |
| `src/task-types.ts:25-58,166-182`; `src/task-store.ts:324-350`                   | Task v1 has no assignment/run/event fields; unknown top-level fields and task-directory siblings refuse. Even a new non-UUID directory under `tasks/` breaks listing. `RunResult` distinguishes outcome from closure, including no-spawn `closed:true`. |
| `src/sdk-worker.mjs:231-270,286-289,315-402`                                     | Explicit readonly versus code tools; no discovered extensions, spawning tools or persistent SDK transcript; retries disabled. Only ready/tool-name/final are emitted, despite richer SDK events.                                                        |
| `src/subagent-process.ts:107-253`                                                | Native `close` plus valid ready/final and zero exit determine success. TERM→KILL→unknown bounds, strict UTF-8, output/frame caps and cancellation precedence already exist. Observer callback exceptions currently enter frame failure handling.        |
| `src/task-controller.ts:145-173,247-290,375-401`; `src/task-diff.ts:9-19,92-150` | Checks and human review use bounded checkout observations; missing configured checks remain not-run. Only task metadata is excluded from freshness. Fingerprints are not filesystem snapshots or complete read sets.                                    |
| `src/task-shell.ts:81-133`; `src/operator-tools.ts:29-50`                        | Terminal departure currently cancels, and foreground host activity is blocked. History always projects persisted running as interrupted; neither behavior is suitable unchanged for service-owned live work.                                            |

**Recommendation:** one service-owned admission/transition engine, task/run registry, bounded dispatcher and checkout coordinator; terminal/browser are clients of that owner.
Reuse process/store/check primitives, not independent controller instances or the upstream chat runtime.
A small fixed assignment graph is scheduling data, not a revival of the retired compiler/certified executor.

## 2. Minimal assignment and admission model

| Identity / immutable input    | Recommended meaning                                                                                                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `taskId`                      | Existing durable task UUID; viewing it never selects or mutates another client's active task.                                                                                                                                                |
| `planRevision` / graph digest | Versioned finite assignment list tied to the readable plan, raw task identity at admission, canonical checkout and execution cwd. The digest detects changes; it is not consent or a byte-certification seal.                                |
| `assignmentId`                | Stable logical unit within that graph: label, purpose (`research`, `review`, `edit`), bounded instruction, dependency IDs, expected output and required freshness. A role name alone is not identity or authority.                           |
| `parentRunId`                 | One explicitly authorized execution episode of a frozen graph. Continue creates a new episode; old successes/results remain history, not a replay instruction.                                                                               |
| `childRunId`                  | Unique execution attempt for one assignment. Record `not-started` separately from a launched process; never use the checkout lock's runId as every child's identity.                                                                         |
| `serviceEpoch` / ownership    | New boot identity and an internal checkout-lock acquisition identity. Clients must not reuse old action grants after restart; an epoch does not prove a surviving process stopped.                                                           |
| `actionId` / expected version | Durable duplicate-action receipt plus operation-specific task/plan/run versions. Same ID and same payload returns the prior receipt; same ID with a different payload refuses. Unknown/expired receipts never authorize silent re-execution. |

- Start reviews the graph as part of the readable plan, including edit authority and concurrency.
  A readonly planning action may propose decomposition, but cannot admit its own proposal.
  Freeze assignments before Start; no recursive spawning, runtime graph expansion, autonomous retries or implicit check/review nodes.
- Illustrative initial **technical limits for design review**, not selected user preferences: 16 assignments per episode, at most 2 active child processes service-wide (therefore two readonly children can overlap), 8 admitted episodes, and a bounded total queue.
  Reserve a slot during asynchronous preparation, not only after spawn.
  Keep existing 30-second abortable auth preparation and 20-minute child ceiling unless deliberately revised; bound instruction/dependency/result bytes and queued-consent validity too.
- Validate unique IDs, all dependency targets, acyclicity, capability ceilings, cwd and limits before admitting anything.
  Recommended first graph supports only success dependencies: ready means every predecessor has `completed`, confirmed no outstanding direct child, durable result, and compatible context/freshness.
  Failed dependencies become explicitly blocked; they do not disappear from totals.
- Schedule ready work fairly across admitted tasks, with deterministic tie-breaking and a waiting-writer barrier.
  Allocate capacity and checkout access before awaiting preparation; recheck cancellation, graph identity, authority and observed inputs immediately before dispatch.
  Expected predecessor edits are part of the approved episode, not permission to ignore unrelated context changes.
- Use per-run immutable instructions, effective tool policy and service-resolved model/auth context, never the currently selected UI row.
  Model-selection/credential-source policy remains a separate service design decision; no ambient credential inheritance or fallback is implied.
  Authority is enforced from assignment kind even inside a code parent; readonly output is returned to the owner, not written through a worker edit tool.
- Keep lifecycle (`queued`, `preparing`, `running`, `stop-requested`, `settled`, `blocked`) separate from result (`completed`, `failed`, `canceled`, `timeout`, `unknown`) and closure (`not-launched`, `direct-child-closed`, `unconfirmed`).
  Record blocking reasons such as dependency, writer gate, stale input, auth or storage unavailability.

**Alternative:** fixed read-wave → serial edit-wave → read-review-wave is simpler than an arbitrary DAG and satisfies the confirmed minimum.
A small validated DAG avoids forcing unrelated research into barriers; either should remain finite and human-reviewed.
Model-directed dynamic scheduling and an external job-queue platform are not needed for this iteration.

## 3. Checkout coordination without lock-per-child conflicts

Use **two different layers**, not one filesystem lock for each assignment:

1. **Owner exclusion:** acquire the existing exclusive checkout lock once for the service's active/admitted work in that canonical checkout.
   All owner metadata saves reuse that held token and are serialized through the owner.
   Retain it until all admitted work has drained with known closure and no unresolved coordination state.
   Passive history/viewing acquires nothing.
   New metadata actions while work is active go through the same owner rather than competing `TaskStore.save()` calls without `held`.
2. **Internal access gate:** one service-local readers/writer gate per checkout, spanning all tasks and including preparing/closing reservations.
   Multiple readonly assignments share access; an editing assignment or parent shell check takes exclusive access.
   No child owns/releases the outer lock.
   Before each launch/save verify that outer ownership remains unchanged.

| Operation               | Minimal gate policy                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Research / agent review | Parallel readers, but no overlap with a service-managed editor/check in that checkout.                                                                                                                                   |
| Code assignment         | One exclusive writer for the full child lifetime, not merely individual edit tool calls.                                                                                                                                 |
| Explicit parent check   | Exclusive: arbitrary approved commands can write generated files or caches. Still require separate command/cwd/timeout confirmation.                                                                                     |
| Human review            | Do not hold a checkout hostage to an open browser. Return an observation/version token; acquire a short barrier and recapture before recording Done. Refuse if an editor/check is active or the reviewed inputs changed. |

This is deliberately stricter than merely serializing editors: parallel readers and a writer can observe inconsistent files.
Allowing that overlap is an alternative only with explicitly advisory/stale results and robust read-set validation; no snapshot/worktree/Git automation is proposed.
Cross-task exclusion keys the canonical checkout, not task ID, cwd spelling, branch name or UI client.
Subdirectories and aliases of one Git worktree converge through `resolveWorkspace` (`src/task-store.ts:114-139`).
Supported clients/services must agree on the coordination state-home; different homes currently create different locks.
Service registration must not silently create a second coordination domain for the same workspace.
Non-Git nested roots/overlapping registrations need rejection or an explicit shared workspace identity; `realpath(cwd)` alone does not merge them.
Unknown closure keeps the checkout quarantined and capacity reserved; a timed lease expiry cannot safely release an ordinary host-tool writer.
If ownership is lost, stop admission, request bounded cancellation, preserve uncertainty and refuse automatic lock replacement.
The gate does not stop editors, ordinary Pi conversations, older unsupported clients, or escaped shell processes outside supported coordination.
Keep that limitation visible and re-observe inputs; do not claim OS isolation or silently activate workflow interception for ordinary conversations.

## 4. Stale reads, review and check truth

- Attach source-context observations to each readonly result: plan/graph revision, bounded before/after checkout fingerprint plus completeness, and a service checkout generation.
  Advance that generation conservatively around every service writer/check; do not require a detected diff to acknowledge a possible mutation.
- Before consuming a result for an edit/review, compare its relevant context with current inputs.
  A later writer from **another task** can stale it even if its own parent has not changed.
  Preserve the result with a stale/incomplete label; block required freshness-dependent dispatch rather than automatically rerunning research.
  Explicit replanning/reconfirmation decides reuse.
- No-overlap reader waves prevent service-caused mixed reads during a run, but equal before/after fingerprints do not prove immutable inputs: external edits can change-and-revert, ignored files/submodules can be unobserved, and capture is bounded.
  Never label this a verified snapshot.
  Detailed read-set/snapshot support is an alternative, not a minimum claim.
- Agent review is advisory output, not human review or a parent check.
  A successful child may still contain findings/issues; an SDK tool error may be handled later without making the whole child fail.
  Preserve both child outcome and individual tool errors rather than deriving either from prose.
- Parent execution aggregate should expose counts and the complete roster: succeeded/failed/canceled/timed-out/unknown/blocked/not-started. “2 of 4 assignments settled” is activity, not “50% of requirements satisfied.”
  All-success requires every required assignment to complete with known closure and no unresolved publication/context condition; partial results stay individually available.
- Keep three independent axes: execution outcome, actual parent-check coverage/freshness, human review.
  A later passing check must not erase earlier child failure/unknown, and human Done with issues must never rewrite checks as passed.
  Extend `done()` issue calculation to include child/graph issues; its current phase/check-only calculation is insufficient after collaboration.
- Checks retain exact definition matching and before/after freshness; later writes stale checks/reviews across tasks at projection time.
  A readonly parent cannot gain shell-check or edit authority from its children.
  Final summaries can be deterministic; an optional model synthesis would itself be an explicitly planned, bounded readonly assignment, not a hidden extra call.

## 5. Failure, cancellation and service epochs

**Recommended simple failure policy:** stop admitting further assignments in that episode on a failed/timed-out/canceled child; allow already-running independent siblings to settle, retain partial results and mark undispatched work blocked.
A dependency-only continuation policy is a valid alternative, but adds partial-success rules; neither may automatically retry.
An unknown child additionally quarantines the entire checkout, stops all its admission and requests cancellation of other active work there.
Parent Cancel first closes admission (including queued/preparing children), records the request, and aborts all active/preparing children concurrently.
Recheck after every awaited preparation so late credentials cannot spawn.
Wait with `allSettled`-style bookkeeping: one child rejection must not skip others' closure processing.
Existing per-process stop bounds must not become N×3 seconds through serial abort waits.
Queued work records canceled/not-launched; an actual closed child retains its real canceled/timeout/failure result.
Already completed children stay completed.
A lost native close records unknown, never canceled-by-assumption.
Aggregate cancellation intent and resource closure are separate; a promise settling unknown is not release permission.
Retain the lock on uncertain release as well as uncertain child closure (`src/task-controller.ts:337-369`).
Client disconnect/navigation only detaches observation under R7; explicit Cancel remains a control.
Explicit service shutdown closes admission and requests bounded cancellation; an abrupt crash cannot supply closure evidence.
After restart, all old launching/running/stopping entries without durable closure become interrupted/unknown, and never-started queued entries require fresh authorization.
New clients receive that snapshot, not a resumed queue.
Persist launch intent **before** spawning, then process identity when available.
A crash between intent and PID persistence is conservatively ambiguous; PID absence or a dead service PID is not proof of no surviving worker.
No browser “recover” shortcut, automatic PID killing, stale-lock expiry or imported `resumeInterrupted()` is appropriate.
Existing informed local dead-owner recovery remains a separate operation and must not be presented as newly proven child closure.

## 6. Durable state and strict v1 compatibility

**Minimal recommendation:** a new explicitly versioned run store under a dedicated private subtree, e.g. `<privateRoot>/runs-v1/<parentRunId>.json`, while retaining v1 task JSON as bounded human-readable context/summary.
Use strict new codecs, bounded single-link files, private permissions, ownership checks and selected-resource refusal.
The example path is a proposal; refuse existing unrecognized content rather than adopting it.
Do not put `events.jsonl` beside existing `task.json`, add assignment keys to task v1, or add a telemetry directory under `tasks/`.
Do not scan/import/repair old histories.
Private storage also avoids telemetry invalidating business fingerprints (`src/task-diff.ts:9-11,92-97`).
New clients treat missing run data as “legacy context / detailed observation unavailable,” not inferred child success.
Old readers can still read v1 summaries; **old binaries cannot be promised collaboration-aware control or live truth**.
For a small graph, one bounded run checkpoint can contain immutable admission, assignment states/results, closure facts, cancellation intent, action receipts, projection sequence and a recent event ring.
Atomically replace that file through one writer; flush critical admission/launch/settlement transitions before acknowledging or scheduling successors.
Define platform-specific file/directory durability guarantees and crash behavior rather than claiming existing single-file rename is a transaction.
Duplicate-action lookup also needs a bounded durable checkout admission index (`actionId` → payload identity and `parentRunId`), not just a receipt hidden inside an undiscoverable run file.
Persist the prepared run and its index mapping before any launch/accepted response; serialize this ordering in the owner.
An incomplete or conflicting index/run pair after a crash blocks that action rather than permitting another spawn.
Expired grants and old epochs refuse even if a receipt has left the bounded lookup window.
Checkpointing outcomes and publishing v1 summaries are separate writes.
Treat the run checkpoint as execution authority; record publication status/expected task identity.
If v1 publication conflicts, preserve external bytes, expose unsynchronized metadata and stop unsafe continuation; do not overwrite or reconstruct a successful outcome from the old task phase.
Observation/reconnect must not repair records.
A checkpoint cannot authorize the next process after restart, even if it contains a prior accepted action.
A storage failure closes admission, surfaces durability uncertainty, requests bounded stop of active work and retains coordination until safely resolved; never acknowledge a durable success that could not be stored.
Preserve a corrupt/torn/unknown selected checkpoint, refuse that run's control and keep last-known observations explicitly stale.
A crash after launch intent but before completion persistence must not be “replayed to finish.”
**Alternative:** append-only versioned transition journal plus checkpoint gives a deeper timeline but requires bounded segments, torn-tail handling, sequence validation and explicit compaction semantics.
A separate transactional database can make action receipts/queue updates easier but adds dependency/packaging and migration scope; it is not required for a single-owner bounded first release and is not permission to reopen retired databases.
A recent ring limits replay, not total storage.
Bound active runs, per-run bytes/results, subscriber queues and total newly-owned store quota.
Until retention is selected, reaching the total quota should refuse new admission rather than delete history.
No retention duration, full transcript storage or automatic pruning of existing resources is assumed.

## 7. Genuine tool lifecycle and bounded reconnect

Current local declarations provide `tool_execution_start/update/end`, `toolCallId`, `toolName`, `isError` (`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:396-412`); no `durationMs` is declared there, unlike global 1.2 JSON documentation.
Extend both `src/sdk-worker.mjs:366-402` and `src/subagent-process.ts:169-195`, not only a UI callback.

- Introduce an explicit worker protocol version in the request/first ready frame and a closed schema for `tool_start` / `tool_end`; reject unsupported versions, malformed fields, orphan/duplicate ends, duplicate active calls and post-final frames.
  Ship emitter/decoder together; no silent permissive fallback.
- Correlate real SDK start/end through a bounded per-child map.
  Prefer local opaque occurrence IDs on the public projection (raw provider IDs can contain arbitrary content); scope them with `childRunId`.
  Support interleaved calls and reused SDK IDs only after the earlier occurrence ends; never match solely on tool name.
- Project only bounded name/local ID/end `isError` and owner-observed times initially; no raw args, output, thinking, credentials or exception text.
  Full transcript/output detail remains a product decision.
  Sanitize display fields and never expose internal lock tokens or auth envelopes.
  Locally measured start-to-end elapsed time is observation latency, not guaranteed tool execution duration.
- Important nuance: the pinned SDK emits start **before validation/preparation**, including truncated tool calls which are never executed (`node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:256-318,332-359,525-532`).
  These are genuine SDK lifecycle events, not proof a shell spawned or a file changed.
  End `isError:false` is a tool result, not a parent check pass; do not extract check exit codes from text.
- A successful final must not leave unmatched tool starts.
  Cancellation/crash may leave them unfinished; show “end not observed,” never synthesize a successful end.
  Final assistant text still waits for native zero close and cleanup; tool completion, `agent_end` and `agent_settled` cannot replace `runProcess` settlement.
- One admitted writer does not necessarily serialize tools *inside* that worker: the pinned agent supports parallel tool batches (`agent-loop.js:287-293`).
  Public `Agent.toolExecution` exists (`dist/agent.d.ts:57-58`).
  If literal write serialization is required, explicitly select/verify sequential code-worker tool execution; do not assume the assignment gate changes SDK defaults.
  Arbitrary bash descendants remain outside any universal serialization guarantee.
- Preserve the current 128 KiB input / 256 KiB process-output / 64 KiB pending / 4096-frame / 16 KiB final bounds, or review changes explicitly (`src/subagent-process.ts:78-79,172-223`; `src/sdk-worker.mjs:79-84`).
  Adding ends increases frame consumption; test boundary cases and reserve/control final-event capacity, not unlimited streaming.

Owner events should carry `{schema, serviceEpoch, taskId, parentRunId, childRunId?, seq, observedAt, kind, data}`.
Assign sequence in the owner per parent run, with one shared reducer for live and restored projections.
Durable critical transitions and the bounded recent lifecycle ring drive both surfaces; a UI does not invent result transitions.
Run outcomes/results survive ring eviction.
Snapshots include current state, last committed sequence, earliest replayable sequence, truncation/gap flags and current live-owner availability.
For reconnect, subscribe and capture a snapshot at a defined sequence boundary; replay only later events.
A cursor outside the retained range, sequence gap, changed epoch or unsupported schema forces full snapshot/resync with an explicit history gap.
Old-epoch events cannot alter new-epoch state.
Lost final updates need a retry/resync mechanism even when no next delta arrives.
Reconnect never reissues Start.
Bound **all** subscriber traffic by count/bytes and detach slow clients or coalesce to a latest-snapshot notification.
Do not await browser delivery in SDK/process callbacks or let subscriber exceptions fail a worker.
Durability-writer faults are different: fail admission safely, not silently discard authoritative transitions.
If progress is batched, label the committed watermark and possible crash-tail loss; do not promise a complete event audit.

## 8. What to borrow, and deliberate contract changes

- Borrow the **idea** of reserving concurrency during async creation and retaining terminal rows without counting them as active (`U:server/agent-service.ts:1043-1102,1133-1158`; `U:tests/unit/subagents.test.ts:895-926`).
  Replace streaming-based slot release with native closure; unknowns still reserve capacity.
- Adapt pure parent/child grouping and props-only status/tool cards described in `pi-web-ui-reuse.md`; include canceled/unknown/blocked/stale explicitly.
  Snapshot revision checks and delayed resync are useful (`U:server/protocol.ts:3257-3275`; `U:web/src/use-chat.ts:1080-1106,1822-1846`).
  Retry the final dropped snapshot (`U:server/index.ts:2409-2442`), but bound non-snapshot traffic too.
- Do **not** reuse outcome inference (`U:server/subagent-helpers.ts:21-85`), model fallback (`U:server/agent-service.ts:1210-1222`), automatic continuation (`:3622-3654`), recursive spawn tools, steering-as-start, PTYs, transcript repair or auto-retry policy.
  Upstream `tool_status` lacks run/conversation identity (`U:server/protocol.ts:3314-3326`) and parses exit text (`U:server/agent-service.ts:4386-4418`); neither is a Cadence evidence contract.
- If code is later extracted, pin source/destination groups and retain upstream MIT copyright **2026 xing-shuyin**, full license and dependency notices per the existing reuse report.
  No code was copied here.
- Intentional changes needing maintained-spec/test review: terminal-only authority → two explicit client authority paths; terminal departure cancellation → service-owned lifetime; one foreground operation → bounded multi-task/child registry and checkout gate; string progress → versioned structured events; task-only history → separate versioned run observations.
  Preserve native terminal consent, readonly capabilities, exact nonfallback worker setup, process uncertainty, configured checks, human review, strict old-record decoding and no automatic Git/worktrees/restart execution.

## 9. Proposed independently verifiable child deliverables

| Deliverable                                    | Boundary / prerequisite                                                                                                                                                                                                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Execution-owner and admission foundation    | Headless service lifecycle, canonical workspace registration, authority/version/action receipts, SDK/model/auth sourcing, lock ownership and restart refusal. Terminal-only client path remains usable; no browser dependency. Exposure choice must converge first. |
| B. Bounded assignments and checkout scheduling | Graph codec/admission, identities, finite capacity, dependency readiness, shared readers/writer gate, cancellation aggregation and child issue tracking. Depends on A; deterministic fake-worker tests plus real process closure lanes.                             |
| C. Worker events and durable observations      | Versioned start/end decoder/emitter, run checkpoint and replay projection, bounded storage/subscribers, crash/corruption/compatibility behavior. A supplies ownership; agree B's IDs/outcomes before implementation. Can be qualified without UI.                   |
| D. Terminal/WebUI clients                      | Same owner projection, decomposition/plan display, child status/results, explicit Start/Cancel/check/review and stale-action handling. Depends on A–C contracts; small licensed UI reuse, no per-client runtime.                                                    |
| E. Integration and distribution qualification  | Cross-client reconciliation, source/extracted terminal routes, browser service-without-terminal, shutdown/restart/unknown lanes, packaging/member/license audits. Depends on A–D; not satisfied by source citations.                                                |

These are suggested boundaries, not newly created Trellis tasks.
Record dependencies explicitly; parent/child task hierarchy alone is not a scheduler.

## 10. Test matrix ideas — none executed

| Lane               | Assertions / existing anchors to extend                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admission          | Reject cycles/missing IDs/oversize graphs, readonly escalation, changed plan/cwd/model context, reused action ID with altered payload; duplicate Start creates exactly one episode including after a lost response.                                                                                                                                         |
| Capacity/readiness | Two readonly children truly overlap; queued/preparing children count toward limits; terminal rows do not consume released capacity; only successful/fresh dependencies admit successors; no nested spawning/retries.                                                                                                                                        |
| Checkout           | Two editing tasks and parent checks never overlap; aliases/subdirectories share the gate; readers do not overlap writers; waiting writers are not starved; two service processes cannot claim one coordination domain. Extend `test/lightweight-store-controller.test.ts:67-132`.                                                                           |
| Freshness          | Cross-task write between research and consumption, external change-and-revert limitations, incomplete capture, stale agent review and stale human Done; not-run check definitions remain visible (`test/lightweight-store-controller.test.ts:270-306,646-667`).                                                                                             |
| Cancel             | Parent cancel before/after slot reservation, during late auth, during tools, and racing success; no queued launch; siblings settle independently; multiple unclosed children stop within one aggregate bound. Extend `:504-548,588-645` in the same test file.                                                                                              |
| Native closure     | Valid final/nonzero close, cleanup failure, TERM ignored, stdin fault, unknown escaped pipe; retain lock and capacity for uncertainty, including release failure (`test/lightweight-process-diff.test.ts:1273-1367`; existing SDK cleanup lanes).                                                                                                           |
| Tool wire          | Genuine SDK read/edit tool cycles emit matching starts/ends; interleaving/reused IDs, error/validation-not-executed calls, orphan/duplicate ends, UTF-8 splits, secret-bearing IDs/names, post-final frames, frame/byte floods and incomplete cancellation. Extend actual SDK fixtures at `test/lightweight-sdk.test.ts:68-220`, not only mocked callbacks. |
| Durability         | Crash before/after admission, launch intent, spawn, native close, checkpoint and v1 publication; disk-full/torn/linked/unknown files; same-revision external task edit preserved (`test/lightweight-store-controller.test.ts:350-435`). Never replay a spawn or infer closure.                                                                              |
| Reconnect          | Duplicates/reorder/gaps, evicted cursor, changed epoch, lost final snapshot without later events, bounded slow subscriber, subscriber throw, legacy-only records; browser/TUI converge without Start replay or false success.                                                                                                                               |
| Restart/recovery   | Service crash with surviving child, no PID receipt, confirmed old terminal outcomes, canceled-but-unclosed child; viewing starts nothing, new writers stay blocked, recovery never silently clears uncertainty.                                                                                                                                             |
| Review truth       | Child failure followed by passing parent check remains failure/partial work; human acknowledgment does not pass failed/unrun/stale checks; child review never records human approval.                                                                                                                                                                       |
| Integration/pack   | Browser absent and terminal absent separately; either client closes while service continues; no ordinary-conversation activation. Preserve source/extracted PTY and distribution routes, update exact package membership and reuse notices deliberately.                                                                                                    |

## 11. Remaining product decisions

Only the PRD's genuine blockers remain: **deployment exposure/identity scope** and **required progress/history detail**, including whether anything beyond bounded lifecycle/results must survive restart.
Full transcripts, retention duration and remote access are not chosen here.
Scheduler limits, conservative failure policy, storage layout and access-gate alternatives above are concrete design recommendations for review, not additional product answers or implementation permission.
Model-selection/credential sourcing belongs in the independent-service design; this report neither chooses it nor imports upstream defaults.
