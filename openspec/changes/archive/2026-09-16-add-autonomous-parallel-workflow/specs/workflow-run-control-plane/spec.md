## ADDED Requirements

### Requirement: Time-bound verification inputs

The compiler SHALL bind every verification input to its declared consumer and an admissible producer state.
Original baselines SHALL read only safe regular bytes from the run's immutable original revision.
Candidate and final consumers SHALL admit outputs only after their producer state is valid and SHALL reject an input deleted before consumption.
A test introduced by the delivery SHALL remain required by its producing phase, affected and repair verification, cumulative verification, and final acceptance.
Failure attribution SHALL be reused only between comparable verification obligations and failure identities.

#### Scenario: A future Red test is declared

- **WHEN** a task creates a test during Red and later verification consumes it
- **THEN** compilation requires explicit baselines over existing safe inputs, rejects a baseline that consumes the future path, and retains the future test in every applicable candidate and final consumer

#### Scenario: An original file will be modified

- **WHEN** a safe regular file exists in the original revision and the task later writes that path
- **THEN** the original baseline reads the retained original bytes and later consumers read only the valid candidate version for their stage

#### Scenario: A consumer needs another task output

- **WHEN** a verification input is produced by another task or deleted before the declared consumer
- **THEN** compilation requires a reachable completed producer and rejects consumption before production or after deletion

#### Scenario: A new acceptance test fails later

- **WHEN** a produced test participates in affected, cumulative, or post-apply verification
- **THEN** its failure remains an acceptance failure and cannot inherit a pre-existing-failure exemption from a different verification obligation

### Requirement: Task-local baseline prerequisites

Implement SHALL capture each task baseline against the retained original revision only when that task is otherwise runnable.
The cache SHALL bind the verification contract, original input identity, and environment identity.
An unavailable task baseline SHALL block only that task and its dependents, retain successful sibling observations, consume no Worker attempt budget, and allow independent safe tasks to continue.
Complete acceptance baselines SHALL still be present before the global verification barrier.

#### Scenario: One task baseline is requested

- **WHEN** one runnable task needs baseline evidence while unrelated tasks are not yet runnable
- **THEN** Implement captures or reuses only that task's matching observation and fills remaining baseline evidence lazily before the global barrier

#### Scenario: A local baseline prerequisite is unavailable

- **WHEN** one task cannot obtain its input or verifier capability but an independent task is runnable
- **THEN** the affected task and its dependents remain blocked without a Worker reservation while the independent task continues and the run remains incomplete

#### Scenario: A baseline contract is amended

- **WHEN** a retained run accepts a technical revision that changes only a task baseline contract
- **THEN** recapture uses the run's immutable original revision and preserves compatible completed phases, sibling evidence, checkpoints, and consumed budgets

### Requirement: Continuous shared task scheduling

Implement SHALL schedule safe independent tasks through the existing state machine and shared capacity of four across all runs.
It SHALL react to individual task settlement and shared-capacity changes, refill released capacity without waiting for active siblings, and preserve dependency, conflict, verification-lock, and FIFO queue rules.
Waiting for dependency, conflict, or capacity SHALL consume no Worker attempt budget.

#### Scenario: Independent work exceeds shared capacity

- **WHEN** more than four conflict-free tasks are runnable across one or more runs
- **THEN** at most four execute concurrently and the remainder retain durable ordered capacity queue positions without spending attempt budget

#### Scenario: A fast task settles before its siblings

- **WHEN** one of four active tasks settles while other active tasks remain held and another task is runnable
- **THEN** the scheduler starts the next safe task in the released slot before the held siblings settle

#### Scenario: Another run releases shared capacity

- **WHEN** a run has an active task and a capacity-queued sibling while a different run releases a shared slot
- **THEN** the waiting run wakes, rechecks durable prerequisites, and starts its next safe task without waiting for its active sibling

#### Scenario: A dependency or conflict prevents launch

- **WHEN** a task waits for a producer, an earlier conflicting owner, or a verification lock
- **THEN** it remains durably queued in policy order, does not consume unfinished producer output, and receives no attempt reservation until runnable

### Requirement: Evidence-bound recovery and amendment

The parent control plane SHALL classify recovery from code-owned contract, path, revision, environment, producer, and failure-sequence observations.
It SHALL distinguish absent input, unsafe input, dependency or runner drift, candidate failure, external capability loss, and integrity or unknown failure.
Only a proven accepted-scope plan timing or verification-contract defect SHALL authorize the existing batch-bound technical amendment.
An admitted revision SHALL continue the same run without renewing accepted behavior authority or resetting retained work and recovery facts.

#### Scenario: Verification input is absent or unsafe

- **WHEN** verifier admission observes either an absent path or an unsafe path including a symlink component
- **THEN** the result retains the bounded path and distinct observation kind through phase and change adapters without classifying either as product failure

#### Scenario: A proven plan defect is amended

- **WHEN** trusted evidence proves an accepted-scope input timing or verification-contract defect and the current amendment batch remains valid
- **THEN** the parent fences affected launches, settles affected work, publishes a fully validated revision, and continues the same run with compatible evidence, checkpoints, history, and budgets retained

#### Scenario: Resume observes no prerequisite change

- **WHEN** resume sees the same delivery, inputs, producers, environment identity, and failure sequence as a retained blocker
- **THEN** it returns the stable blocker without launching a Worker, repeating the failed verification, consuming budget, or fabricating progress

#### Scenario: A prerequisite demonstrably changes

- **WHEN** a required producer completes, a valid delivery appears, an input or environment identity changes, or an external capability is observed restored
- **THEN** the parent may perform only the bounded probe or continuation admitted by the existing recovery authority

#### Scenario: Integrity or unknown failure is reported

- **WHEN** failure evidence is unsafe, unknown, cancelled, exhausted, currentness-invalid, or inconsistent with delivery hashes, proofs, or receipt bindings
- **THEN** the control plane withholds plan-amendment authority, preserves retained facts, and pauses the affected integrity scope with a concrete recovery condition

### Requirement: Settlement and completion barriers

The control plane SHALL fence new work before cancellation, close, or delivery amendment and SHALL await every launched Worker, verifier, amendment, descendant, and resource cleanup before the command or storage lifetime settles.
It SHALL report completion only after all required tasks and global checkpoints are valid, cumulative verification and currentness succeed, transactional application completes, post-apply verification passes, and no operation remains active.

#### Scenario: Cancellation or close races active work

- **WHEN** cancel or close occurs while Workers, verification, amendment, or descendant processes are active
- **THEN** new launches are fenced and the command waits for all active effects and resource cleanup before returning or closing storage

#### Scenario: Local work completes while a required barrier is blocked

- **WHEN** some tasks or a technical amendment complete but a dependency, global verification, currentness check, apply transaction, post-apply check, or settlement remains incomplete
- **THEN** status preserves the completed facts and reports the run as active or paused rather than completed

## MODIFIED Requirements

### Requirement: Parent-owned implementation continuation

Invoking Implement SHALL delegate remaining implementation choices to the parent model's recommended solution under the accepted Design goal, explicit constraints and non-goals.
Status SHALL identify the parent as decision owner, expose an automatic amendment continuation for known authority gaps, proven original-baseline input defects, and the closed task-split technical pause, and expose automatic receipt-less resume when a newer local proof-bound delivery is discovered.
Neither Worker authority nor readiness checks SHALL be bypassed.
Cancellation and unclassified integrity or external capability failures SHALL NOT manufacture a plan amendment.
Each run SHALL retain a 64-attempt mutation budget for amendments across restart and batch changes; failed mutations SHALL consume reservations before side effects, committed replay and read-only status/preflight SHALL not consume them.
TUI SHALL show automatic parent continuation as non-success recovery without a manual resume hint.
The parent SHALL continue in the same turn and summarize material decisions in its final result.

#### Scenario: Implementation choice is delegated

- **WHEN** a known authority gap requires an implementation choice after Design
- **THEN** status assigns the recommended choice to the parent without requiring a user answer, and the same-stage amendment remains proof-bound

#### Scenario: Technical plan defect needs revision

- **WHEN** parent-owned observations prove an accepted-scope original-baseline input defect or compact patch recovery requires smaller tasks
- **THEN** the parent can use a current batch-bound amendment without a fabricated authority gap and resume from the newer locally discovered delivery; a bare delivery admission error or invalid hash, proof, receipt, currentness, unsafe path, or unknown failure SHALL NOT authorize amendment, and a rejected revision/receipt pair SHALL remain excluded from automatic resume recommendations across restart

#### Scenario: Automatic amendment keeps failing

- **WHEN** failed amendment mutations exhaust the persistent budget and the process restarts
- **THEN** mutation is rejected before side effects and status offers no further automatic amendment while retaining progress

#### Scenario: Explicit cancellation interrupts continuation

- **WHEN** the user cancels a retained authority wait
- **THEN** automatic continuation is removed and the previous batch cannot authorize another mutation

#### Scenario: Parent recovery is presented to the user

- **WHEN** a nonterminal result supplies an automatic parent continuation
- **THEN** activity remains recovering rather than completed or waiting for a user decision, and no manual resume hint is displayed
