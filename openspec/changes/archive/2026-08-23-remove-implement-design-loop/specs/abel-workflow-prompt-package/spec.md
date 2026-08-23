## MODIFIED Requirements

### Requirement: Implementation behavior

`abel-implement` SHALL require a unique change name and SHALL validate receipts, artifact hashes, traceability, strict validation, and complete task contracts before registering any task or modifying code or tests.
Invalid trusted delivery SHALL produce one stage-level blocker before task registration and SHALL NOT be represented as a task failure or an automatic workflow transition.
Before writing, the parent SHALL record target, affected-suite, and full-suite baselines with stable failure identities and SHALL keep every pre-existing failure separate from the task Red.

For each ready task, the parent SHALL register one immutable approved boundary containing stable identity, phase-local read and exact write sets, target verification, scheduling declarations, approved dependencies, impact closure, and structured AGENTS impact.
Later phase attempts, stale refreshes, candidate decisions, and AGENTS checkpoints SHALL carry only their operation identity and dynamic facts and SHALL NOT restate or alter the stable boundary.
Every foreseeable compatibility test, fixture, and repair path SHALL be included in the approved phase boundary; discovering a required path, dependency, behavior, architecture, policy, or verification outside that boundary SHALL terminally block the task as an approval-boundary failure without expanding it at runtime.

Implementation SHALL recompute ready work from the trusted parent-owned task DAG and MAY dispatch compatible ready tasks concurrently only when their prerequisites and task-lifetime read/write, conflict, resource, validation-lock, and AGENTS-target declarations permit it.
A conflicting task open SHALL return immediately as deferred without registration, queueing, or consuming an Agent launch.
A registered task SHALL retain its conflict declaration across phase gaps and candidate or AGENTS-checkpoint review and SHALL release it only when the task becomes blocked or completed or the stage drains.
An independent task SHALL remain eligible after a sibling blocks or completes.

Task-local professional Agents SHALL return complete candidate unified diffs without writing the workspace, running validation, recommending another workflow stage, or selecting a recovery path.
The parent SHALL exclusively review candidates, execute isolated preflight, apply exact accepted diffs, run approved commands, update AGENTS indexes, compare affected and full suites, and advance tracked tasks.
Each candidate SHALL bind its stage, change, task, originating request, phase, launch, exact paths, and current file snapshot.
A sibling candidate SHALL remain current after unrelated changes and SHALL become stale before application if a bound read or write file changes.

Only Runtime-owned isolated preflight and exact application SHALL advance Red, Green, Refactor, or the AGENTS checkpoint.
Caller-supplied verification claims SHALL NOT advance a phase.
Each phase SHALL allow at most two non-cancelled Agent launches shared by transport, stale, and artifact correction; cancellation SHALL preserve state without consuming a launch.
AGENTS checkpoint correction SHALL have a separate maximum of two parent attempts.
An oversized result SHALL terminally block the task and SHALL NOT be truncated, partially applied, or converted into a request to select another workflow stage.

Blocked and completed task states SHALL be idempotent process-local terminal facts with no further child, preflight, apply, or budget-consuming transition.
A valid replay against a terminal task SHALL return the terminal fact with the current operation request identity, while a duplicate open or invalid transition SHALL remain a protocol error.
Task completion SHALL mean that every approved phase and required AGENTS checkpoint completed; it SHALL NOT replace the parent-owned affected-suite and full-suite completion gate.

Implement outcomes SHALL describe only the current task or operation and SHALL NOT claim that parent-owned dependent successors are blocked, recommend a next workflow stage, return a Design-routing action, or invoke another workflow.
Implementation SHALL finish only when all target and affected verifications pass and the full suite has no new failure relative to baseline.
It SHALL NOT modify unrelated dirty files, preserve an alias for the unreleased request or recovery protocol, or implicitly archive, commit, publish, or release the change.

#### Scenario: Valid cross-context handoff

- **WHEN** receipts, artifact hashes, traceability, strict validation, and task contracts are valid in a fresh context
- **THEN** implementation records baselines and may register the first approved task without requesting either Gate again

#### Scenario: Invalid trusted delivery

- **WHEN** a receipt, covered artifact hash, traceability edge, strict validation result, or required task contract is invalid
- **THEN** implementation emits a stage blocker before task registration and neither improvises a decision nor represents the failure as a task outcome

#### Scenario: Task boundary is opened

- **WHEN** a ready task submits its first approved Red attempt
- **THEN** the runtime registers its stable boundary exactly once and derives the Red Worker request from that boundary

#### Scenario: Stable facts are replayed

- **WHEN** a later phase attempt or operation restates or changes stable objective, scope, verification, dependency, impact, or AGENTS facts
- **THEN** the request fails as a protocol error before a child launch or state transition

#### Scenario: Conflicting task is opened

- **WHEN** a new task conflicts with a registered nonterminal task through a read/write path, edge, resource, validation lock, or AGENTS target
- **THEN** the new open returns deferred immediately without registration, queueing, waiting, or launch consumption

#### Scenario: Compatible tasks produce parallel results

- **WHEN** multiple ready tasks have accepted prerequisites and compatible task-lifetime declarations
- **THEN** their read-only Workers may run concurrently while the parent retains serial candidate review and application

#### Scenario: Unrelated sibling application preserves currency

- **WHEN** two concurrent candidates bind disjoint file snapshots and the parent applies the first candidate
- **THEN** the second candidate remains eligible because none of its bound read or write files changed

#### Scenario: Related file change makes a result stale

- **WHEN** a file in a candidate's bound read or write snapshot changes before application
- **THEN** the runtime rejects the candidate as stale and permits only the remaining launch within the unchanged approved boundary

#### Scenario: Worker delivers a task phase

- **WHEN** a task Worker returns a complete in-scope candidate bound to its originating request, phase, launch, paths, and current snapshot
- **THEN** the parent may review it without trusting Worker verification claims or recovery recommendations

#### Scenario: Candidate artifact cannot load or has the wrong Red identity

- **WHEN** isolated preflight finds an incomplete or malformed diff, source or test load failure, no target test, wrong command, or wrong Red identity
- **THEN** none of the candidate is applied and the typed artifact failure may consume only the phase's remaining shared launch

#### Scenario: Artifact correction budget is exhausted

- **WHEN** two non-cancelled launches in one phase end in artifact, stale, or transport failure
- **THEN** the task becomes terminally blocked for attempts exhausted with no third launch or partial result

#### Scenario: Worker diff exceeds its result boundary

- **WHEN** a Worker cannot submit its complete candidate within the configured result-size limit
- **THEN** the task becomes terminally blocked and no partial candidate or workflow-stage recommendation is usable

#### Scenario: Cancellation interrupts a launch

- **WHEN** a phase launch is cancelled before a candidate is accepted
- **THEN** the runtime returns cancelled while preserving the phase state and remaining non-cancelled launch budget

#### Scenario: Runtime apply advances a phase

- **WHEN** isolated preflight and exact application both succeed for the current candidate
- **THEN** the runtime advances only to the next approved phase or the required AGENTS checkpoint

#### Scenario: Parent reports verification without apply

- **WHEN** a caller submits a verification claim without a successful Runtime-owned candidate application
- **THEN** no task phase advances

#### Scenario: Approved compatibility path fails

- **WHEN** an affected test or fixture within the fixed approved boundary exposes a reproducible compatibility failure
- **THEN** the task may make the minimum behavior-preserving repair within its remaining approved phase scope

#### Scenario: Affected-suite baseline is green

- **WHEN** every exact affected-suite command passes before task writes
- **THEN** implementation proceeds within the approved phase boundary without adding a repair path

#### Scenario: Existing affected failure is present

- **WHEN** an exact affected-suite command exposes a reproducible pre-existing failure whose test, fixture, and repair paths are already in the approved boundary
- **THEN** the parent records it separately from task Red and the task may make only the minimum approved compatibility repair

#### Scenario: Later run reveals a previously masked failure

- **WHEN** a later affected-suite run reveals a failure that an earlier run did not report
- **THEN** the parent attributes it as pre-existing or introduced and the task blocks if attribution or an in-boundary repair cannot be established

#### Scenario: Affected failure is environmental

- **WHEN** an affected failure is environmental, transient, external-service dependent, or non-reproducible
- **THEN** the task terminally blocks with typed environment evidence and no speculative product edit

#### Scenario: Affected repair requires a substantive decision

- **WHEN** an affected failure requires new behavior, policy, dependency, architecture, irreversibility, path scope, or verification contract
- **THEN** the task terminally blocks with the matching approval-boundary code and does not select another workflow stage

#### Scenario: Full-suite-only baseline failure exists

- **WHEN** the full-suite baseline has a pre-existing failure outside every exact affected-suite command
- **THEN** the failure remains baseline evidence and does not enter the task or satisfy its Red

#### Scenario: Task Red fails for the wrong reason

- **WHEN** the Red candidate cannot load, runs no target test, uses the wrong command, or fails with an identity other than the approved defect
- **THEN** isolated preflight rejects it as a typed artifact failure without applying it or changing the task boundary

#### Scenario: Task Red contract is invalid

- **WHEN** separate evidence proves that the approved Red command cannot witness the approved behavior within the fixed boundary
- **THEN** the task terminally blocks with `verification-contract-insufficient` without consuming an artifact correction launch or choosing another workflow stage

#### Scenario: Repair requires boundary expansion

- **WHEN** a failure requires a new path, dependency, behavior, policy, architecture, conflict, resource, or verification contract
- **THEN** the task becomes terminally blocked as an approval-boundary failure without dynamically expanding its boundary

#### Scenario: AGENTS checkpoint is required

- **WHEN** the final code phase applies successfully and the approved task declares an AGENTS index impact
- **THEN** the task remains incomplete until the parent completes the exact managed-only checkpoint within its separate bounded attempts

#### Scenario: Terminal task is replayed

- **WHEN** a valid phase attempt targets a blocked or completed task identity
- **THEN** the runtime returns the cached terminal fact with the current request identity without checking snapshot currency or starting more work

#### Scenario: Implementation completes

- **WHEN** every task's approved phases and AGENTS checkpoint complete, every target and affected verification passes, and the full suite has no new failure relative to baseline
- **THEN** the workflow reports completion without claiming successor control or automatically archiving, committing, publishing, or invoking another workflow
