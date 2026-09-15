## Context

Cadence already has a sealed task graph, isolated task execution, a shared four-session capacity, durable recovery budgets, batch-bound amendments, cumulative verification, and transactional application.
Three interactions keep that machinery from providing continuous autonomous parallel work:

1. verification inputs do not state when a file becomes available, so a future Red test may be required by the immutable original baseline;
2. baseline collection and a batch-wide wait can turn one local prerequisite or one slow sibling into a wider scheduling barrier;
3. recovery codes do not by themselves prove whether a failure is a plan defect, environment change, unsafe input, or integrity failure.

This design extends the existing compiler and state machine.
It does not add another scheduler, recovery platform, or execution authority.

## Goals and non-goals

The compiler must describe a graph whose tasks can be handed independently to fresh Workers.
Implement must keep safe runnable work moving as each task settles, within the existing shared limit of four.
Verification and recovery decisions must be derived from sealed contracts and parent observations, and accepted authority, work history, and compatible evidence must survive a technical revision.

The change does not permit cross-task phase speculation, direct main-workspace Worker writes, automatic trusted execution, weakened acceptance, automatic discard, or completion before global verification and apply settle.

## Task graph and input time

Each compiled task retains stable identity, dependency reasons, producer outputs, phase read/write/delete boundaries, acceptance ownership, conflicts, shared resources, verification locks, and capability prerequisites.
A code-owned projection derives current parallel groups and reasons for serialization from this graph instead of storing a second scheduling graph.

Verification inputs are checked at their consumption point:

| Consumer                              | Admissible input                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Original task or full baseline        | Safe regular bytes present in the run's immutable original revision                                 |
| Red                                   | Original inputs, current Red outputs, and outputs of completed dependencies                         |
| Green or Refactor                     | Current candidate, committed earlier phases of the same task, and outputs of completed dependencies |
| Affected or repair                    | Inputs available at the task's final phase and completed dependency outputs                         |
| Cumulative, checkpoint, or post-apply | Complete products and surviving original inputs at that barrier                                     |

A file that exists in the original revision remains a valid baseline input even when the task later modifies it.
A file first produced by Red is excluded from the original baseline and must remain in Red, later task verification, affected verification, cumulative verification, and final acceptance.
Compiler checks reject missing producer dependencies, consumption before production, and deletion before a required later consumer.

Failure attribution is reusable only when both the verification obligation and failure identity are comparable.
A new test or a changed execution obligation cannot inherit a pre-existing-failure exemption from a different baseline.

## Task-local baseline prerequisites

The durable verifier captures a task baseline only when that task becomes otherwise runnable.
Cache identity includes the original revision, verification contract, safe input observation, and verification environment identity.
Concurrent requests for the same observation may coalesce, but later currentness checks do not reuse an older observation as proof.

A successful task baseline remains retained when another task's baseline is unavailable.
The scheduler marks only the affected task and its dependents as blocked, continues independent safe work, and does not reserve Worker attempt budget for a task that has not passed preparation.
The complete baseline is filled lazily before a global acceptance barrier.
Any amended baseline still reads the retained run's original immutable revision rather than later main-workspace bytes.

## Continuous scheduling

The workflow state machine remains the sole transition authority.
Its scheduling loop repeatedly reads durable task facts, dependency completion, conflicts, queue order, capacity, and budget; reserves the existing authority; and launches safe tasks.
It then reacts to the first task settlement or a shared-capacity change, commits that result, rereads facts, and fills any newly available slot.

The four-slot limit applies across runs.
A release in one run wakes another run that has runnable work even when that run still has an active sibling.
Dependency, conflict, and capacity queues remain durable and FIFO under the existing policy.
Queueing consumes no Worker attempt budget.
Cross-task output consumption still waits for the producer task to finish with valid output facts.

Slot release follows execution and resource settlement.
A model response or cancellation request alone does not free capacity.
Candidate merge retains currentness checks, and final main-workspace apply remains parent-owned and serial.

## Failure evidence and recovery

Verifier admission observes declared inputs as safe regular files, absent paths, or unsafe paths including symlink components.
Unavailable results preserve bounded `{ path, kind }` evidence through phase and change verification adapters.
Runner and environment identity, revision identity, verification identity, producer facts, and failure sequence provide the remaining recovery prerequisites.

The parent grants a technical amendment only when trusted compiler or verifier facts prove an accepted-scope plan timing or verification-contract defect.
Worker strings, unknown errors, unsafe paths, delivery hash or receipt failures, currentness failures, cancellation, and exhausted budgets do not grant amendment authority.

An admitted amendment uses the existing batch-bound path.
It stops new affected launches, waits for active affected work to settle, compiles and validates the new delivery, and resumes the same Implement run.
Gate A and accepted behavior remain unchanged.
Compatible completed phases, candidate evidence, checkpoints, recovery history, and used budgets remain; only evidence invalidated by the changed contract is recaptured.

Resume compares the recorded prerequisite fingerprint with current code-owned observations.
If nothing changed, it returns the stable blocker without launching a Worker or repeating the failed verifier.
A changed input, completed producer, new valid delivery, recovered capability, or changed environment identity may permit one bounded probe or continuation under existing recovery limits.

## Status, settlement, and completion

Status projects completed, active, queued, and blocked tasks from facts already read by the state machine.
A blocked task does not turn an active independent sibling into a stopped run.
Blockers state their scope, minimum recovery condition, whether an automatic action exists, and which budget and evidence remain.
Status itself does not mutate storage, compile a delivery, or execute continuation.

Cancel and close fence new work and await every launched operation, verification, amendment, descendant, and resource cleanup before returning or closing storage.
A run is complete only after every required task and global checkpoint is valid, cumulative verification passes against the current candidate, transactional apply succeeds under currentness checks, post-apply verification passes, and all operations settle.
Local progress, a completed amendment, or a blocked sibling never implies completion.

## Prompt responsibilities

Design asks for the minimum executable graph and reports actual parallelism plus dependency, conflict, resource, and capability reasons for serialization.
It compiles and seals only through existing code-owned authority; it does not implement product code or claim readiness before checks pass.

Implement follows parent-owned continuations for proven technical repairs and newly valid deliveries in the retained stage.
It does not ask the user to repeat approval, switch stages, or move receipt data for an accepted-scope mechanical continuation.
When no legal automatic action exists, it reports the concrete blocker and lets safe independent work continue.

## Verification strategy

Deterministic tests use synthetic workspaces, controlled barriers, disposable state stores, and injected verifier results.
They prove input timing, lazy baselines, task settlement order, cross-run wakeup, budget retention, amendment fencing, reopen, and no-change resume without relying on timing races.

Real Linux Bubblewrap coverage separately proves isolation, dependency views, Red/Green execution, cancellation of descendants, cumulative verification, and apply boundaries.
Simulation results do not count as native Linux evidence, and Linux results do not imply native Windows or macOS execution support.

Final acceptance requires strict validation of this change, traceability, `bun run verify`, and applicable real Linux isolation tests, with pre-existing failures and unexecuted platform checks reported separately.
