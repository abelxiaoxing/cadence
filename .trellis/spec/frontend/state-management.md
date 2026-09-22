# State Management

> Display state vs durable state in this project: what is never persisted, and what is derived from already-read facts.

---

## Overview

The package keeps two strictly separated state layers.
Display state — activity entries, spinner frames, the startup card — lives only in process memory and is rebuilt on every session.
Durable state — runs, design facts, deliveries, budgets, phase facts — lives in owner-private SQLite (see `.trellis/spec/backend/database-guidelines.md`) and is mutated only by the owning services.
Everything in between is a projection: `src/workflow-status.ts` derives status from facts the state machine already read, without storage access or execution callbacks.

---

## State Categories

| Layer          | Where it lives                                                                                                              | Who mutates it                                                            | Lifetime                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------ |
| Display        | `src/subagent-activity.ts` in-memory entries; `src/startup-card.ts` widget lines                                            | the activity controller on state updates; the extension on session events | one process/session; never persisted |
| Timers         | `src/transport-budget.ts` first-progress/idle timers in `src/child-model.ts`; widget refresh clock                          | the child model stream consumer; the widget clock                         | one request / one session            |
| Derived status | `src/workflow-status.ts` projections (blockers, decision batches, continuations, budgets, queues)                           | nobody — pure function of inputs                                          | recomputed on demand                 |
| Durable        | owner-private SQLite via `src/run-store.ts`, `src/design-journal.ts`, `src/task-ledger.ts`, `src/apply-transaction.ts`, ... | the owning service under its lease/transaction                            | across sessions and hosts            |

---

## Display State Is Never Persisted

- `src/subagent-activity.ts` keeps its activity entries in memory; the module's contract is that "active display/timer state is not persisted."
  The widget is installed per session (`ensureWidget`), refreshed on a 100 ms clock, and detached on stage exit.
- The startup card is rebuilt from live configuration at every `session_start` and cleared when work starts; there is no dismissal record anywhere.
- Child-session transport state (first-progress timer, stream-idle timer, cancellation drain) is created per request in `src/child-model.ts` from `src/transport-budget.ts#REQUEST_BOUNDS` and discarded with the request; headers trigger an observation callback only and are never stored.

---

## Status Is Derived, Never Re-Queried

`src/workflow-status.ts` documents its contract in the header: "Project already-read facts; no storage access, callbacks or workflow transitions."

- Its input is `WorkflowStatusFacts` — the engine run rows, task rows, projections, and pause/budget facts that `src/workflow-state-machine.ts` already read to make its decision.
- Its output is the bounded status the UI and the implement continuation consume: blockers (decision, verification, budget kinds), decision batches, continuations, `WorkflowResourceBudget` projections, and queue order — for example the `change-work-budget-exhausted` and `change-recovery-budget-exhausted` codes projected from the durable `workflow_work_budget` values.
- It also projects conditional parent-recovery guidance for Implement: the continuation driver in `src/implement-continuation.ts` reads exactly this projection before scheduling a parent follow-up, and it owns no transition authority and no budget replenishment — "The driver never owns workflow transitions or replenishes budgets."
- The state machine owns collection and transitions; `src/durable-workflow.ts` owns resource lifetime and replay composition; `src/workflow-scheduling.ts` simulates queue decisions "without storage access or launch authority" (`selectRunnableTasks`).

Concrete example: a paused task with `pause.code = "operation-interrupted"` plus an unconsumed recovery grant is projected as a truthful `paused` continuation suggestion; the same facts after the grant is consumed project an exhaustion code instead.
No status call reopens a database or starts a verification.

---

## Durable Authority: Design Journal Inheritance

`src/design-journal.ts#inheritFinalizedAuthority` is the reference pattern for durable authority that is inherited, never invented:

- It seeds a new revision only from a completed, privately finalized delivery: it queries sibling `abel-design` runs for the same root and change name in state `completed`, picks the highest `deliveryRevision` finalization fact, and verifies the plan bytes against the stored `rawSha256`, both gate proofs current, the receipt hash, and the canonical plan hash (`verifyFinalizedDelivery`).
- Any verification failure throws `design-inherited-authority-invalid` and nothing is seeded; on success it appends the `inheritance` fact plus the decision and approval facts, so the new revision carries the finalized authority with its provenance.
- Unchanged compilation is preserved: re-approving the same plan keeps the compiled artifact (a new gate approval above the approved sequence marks Gate B current when the proof hash matches the plan hash), while a changed compilation marks prior gate projections stale with `staleReason: "plan-recompiled"` instead of silently reusing them.
- `src/design-control.ts` applies the same discipline to artifact mutation: every write/delete/compile/finalize runs under an acquired finalization lease (`acquireFinalizationLease` ... `commitArtifactOperation`/`releaseFinalizationLease`) and re-checks that the on-disk artifact (e.g. `tasks.md`) has not changed since the lease-protected read.

---

## Child Session Context Bounds

`src/child-session.ts` bounds the explicit private child tool loop with `CHILD_EXECUTION_LIMITS`: `maxTurns: 64` and `maxContextBytes: 4 * 1024 * 1024` (4 MiB).

- `src/child-model.ts` adapts the public model stream to complete turns without Pi session hooks, owning the per-request first-progress/idle timers from `src/transport-budget.ts`; headers are observation only, and local tool gaps have no stream timer.
- The turn counter increments per complete turn and the loop stops at the bound; only complete, normal turns may execute tools, including the terminal submit.
- There is exactly one bounded missing-submit reminder: when a turn completes without an accepted result, the child receives "No result has been accepted.
  Submit existing findings through abel_submit_result, not prose. ...
  This is the only missing-submit reminder; the original deadline still applies." — guarded by a `reminderUsed` flag, never repeated.
- `src/child-budget.ts#childContextBudget` computes the conservative admission estimate (at most 4 MiB, derived from the model's `contextWindow`/`maxTokens`): it is explicitly "not a tokenizer or a claim about provider billing."
- Structural correction (a rejected submit re-issued with the code-owned diagnosis) happens under the original deadline; it does not restart it.

---

## Shared Budgets and Queues

Durable budgets are per-run rows, not globals:

- `workflow_work_budget` holds `used`/`max_work` with `phase_high_water`, `hard_limit` (default 512) and `recovery_policy` (see `database-guidelines.md`).
- The shared execution capacity is `LIMITS.maxActiveChildSessions: 4` in `src/contracts.ts`: `src/packet-runtime.ts` clamps concurrency to it for Design/Diagnose packets, and `src/workflow-state-machine.ts` refills settled shared slots across runs, admitting baselines before Worker budget reservation.
- The bounded same-stage amendment budget is the `workflow_amendment_budget` table capped at `CHECK (used <= 64)`.
- `src/execution-retention.ts` keeps unsettled host execution resources as settlement receipts that block re-admission and reset until settled.
- The state machine atomically pauses settled exceptional work and repairs legacy interrupted-operation projections under the run-exclusive lease, without resetting delivery, phase evidence, or budgets.
- Compilation supplies Gate B and resume discovers revised delivery; the extension admits batch-bound same-change amendments without a stage switch, and root-scoped regular-file read discovery is bound to exact child capabilities so merge/apply currentness preserves phase-local writes.

---

## Forbidden Patterns

- Never persist display or timer state into a store or a file; if a value must survive a session, it is a durable fact owned by a backend service.
- Never compute status by reopening storage or invoking an execution callback; status is a pure projection of already-read facts (`src/workflow-status.ts`).
- Never inherit or replay authority without re-verifying the retained proof (hash, receipt, gate currentness); the journal throws on mismatch instead of guessing.
- Never let a projection mutate: the status, scheduling, and recovery-policy modules (`src/workflow-scheduling.ts`, `src/workflow-recovery-policy.ts`) calculate decisions from facts and leave transitions to the state machine.
- Never repeat the missing-submit reminder or extend a deadline; both bounds are one-shot by design.

---

## Common Mistakes

- Storing "the widget was showing state X" to restore a UI; the next session start rebuilds the widget from live facts, and the old frame was never authoritative.
- Treating a durable `queued` position as a launch; queue positions are scheduling facts consumed by `selectRunnableTasks`, and only the state machine launches.
- Deriving a budget decision from a timestamp or PID instead of the durable budget rows; `src/execution-retention.ts` exists precisely because live-process intuition is wrong after a host restart.
