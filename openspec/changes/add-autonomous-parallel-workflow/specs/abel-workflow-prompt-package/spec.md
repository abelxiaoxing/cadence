## ADDED Requirements

### Requirement: Delegable Design task graphs

Design SHALL produce the smallest executable task graph within accepted authority.
Every task SHALL state stable identity, goal and acceptance ownership, dependency reasons, producer outputs, phase read/write/delete boundaries, conflicts, shared resources, verification locks, capability prerequisites, and baseline through final verification obligations.
Design SHALL derive actual parallel groups and serialization reasons from the compiled graph and SHALL NOT claim readiness or executable parallelism before code-owned compilation, proof, and delivery checks succeed.

#### Scenario: A fresh Worker receives a task

- **WHEN** an independently runnable task is dispatched to a Worker with no conversational history
- **THEN** the sealed task contract provides its authorized context, inputs, producers, phase boundaries, outputs, acceptance, resources, and verification prerequisites without requiring scope invention

#### Scenario: Design projects parallel and serial work

- **WHEN** Design presents the implementation graph
- **THEN** it identifies tasks that can actually run together and names each dependency, conflict, resource, producer, or global barrier that requires serialization

#### Scenario: A graph is not yet executable

- **WHEN** timing, authority, verification coverage, capability, proof, or delivery validation is incomplete
- **THEN** Design reports the specific defect and does not label the delivery ready, approved, sealed, or safe to implement

### Requirement: Autonomous same-stage continuation

Within an accepted change, the parent SHALL follow a code-owned continuation for a proven technical repair or newly valid delivery without asking the user to repeat approval, switch stages, or transfer internal receipt data.
When no legal automatic action exists, it SHALL report the scoped blocker, preserved progress and budget, and minimum external recovery condition while allowing safe independent work to continue.
Status SHALL remain a read-only projection and SHALL NOT execute continuation or mutate authority.

#### Scenario: A technical continuation is available

- **WHEN** status returns a current evidence-bound amendment or resume continuation within accepted authority
- **THEN** the parent performs that action in the retained Implement stage and rechecks the resulting delivery before further execution

#### Scenario: No safe automatic action remains

- **WHEN** a prerequisite is external, unsafe, unknown, cancelled, exhausted, or unchanged since the retained failure
- **THEN** the parent reports the affected tasks, preserved evidence and budgets, and minimum recovery condition without repeated approval requests or false completion

#### Scenario: Status is requested during parallel work

- **WHEN** some tasks are completed, active, queued, or blocked
- **THEN** status truthfully projects each state and queue reason without launching work, changing storage, or treating a blocked sibling as completion of the run

### Requirement: Verification-safe Implement guidance

Implement guidance SHALL keep each task's Red, Green, and optional Refactor sequence inside its isolated candidate and SHALL consume another task's outputs only after that producer completes.
It SHALL preserve all introduced acceptance tests through affected, cumulative, and final verification.
It SHALL NOT create a missing future test in the original baseline, delete acceptance to obtain success, enable trusted execution, bypass proof or currentness checks, or classify launch, timeout, environment, unsafe, unknown, cancellation, or termination failures as expected Red evidence.

#### Scenario: A task consumes a producer output

- **WHEN** an isolated Worker needs an output owned by another task
- **THEN** Implement waits for the producer task's valid completion fact and exposes only the output authorized for the consuming phase

#### Scenario: A new test becomes available after Red

- **WHEN** Red creates an approved regression that was absent from the original revision
- **THEN** Implement excludes it from original baseline capture and retains it in Green, affected, cumulative, and final acceptance

#### Scenario: Verification infrastructure fails

- **WHEN** execution cannot start, times out, loses capability, observes an unsafe path, is cancelled, or cannot terminate safely
- **THEN** Implement records an unavailable or paused result and never treats the event as an expected product failure or permission to weaken verification
