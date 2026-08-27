## REMOVED Requirements

### Requirement: Private workflow-only Agent surface

**Reason**: Its stage-drain semantics erase all run state and its dispatcher surface exposes the obsolete one-shot protocol.
**Migration**: Replaced by `Private workflow control surface`, which keeps the tool private while allowing durable paused runs and change-oriented commands.

### Requirement: Compact structured delivery

**Reason**: Complete single-result diffs and terminal result-size failure couple task progress to one child response.
**Migration**: Replaced by `Sealed structured artifact delivery`, which accepts bounded structured evidence and atomically sealed candidate artifacts without partial application.

### Requirement: Parent-owned review application and validation

**Reason**: It applies every accepted phase directly to the main workspace and explicitly excludes transaction support.
**Migration**: Replaced by `Parent-owned change-workspace acceptance` and `Transactional cumulative delivery`.

### Requirement: File-snapshot-aware bounded concurrency

**Reason**: Its graph, task, conflicts, terminal facts, and deferrals are process-local and require caller-driven reopening and polling.
**Migration**: Replaced by `Durable graph scheduling and conflict queueing`.

### Requirement: Single mechanical redispatch and branch isolation

**Reason**: A shared two-launch budget turns unrelated transport, stale, artifact, environment, capacity, and approval failures into permanent blockers.
**Migration**: Replaced by `Recoverable attempts and Worker replacement` with separately classified bounded automatic policies and explicit continuation.

### Requirement: Ephemeral bounded runtime lifecycle

**Reason**: Process-only state, pinned Provider identity, and terminal blocked facts prevent restart recovery and legal Worker replacement.
**Migration**: Replaced by `Durable run and ephemeral child lifecycle` plus the workflow-run control-plane capability.

### Requirement: TUI-only private activity compatibility

**Reason**: It forbids status and resume controls and removes activity at terminal domain outcomes even when the workflow remains recoverable.
**Migration**: Replaced by `Truthful private lifecycle activity`.

### Requirement: Implement domain outcomes and Pi Tool errors

**Reason**: Its outcome vocabulary treats blocked as a terminal task fact and lacks run-level recovery states.
**Migration**: Replaced by `Control-plane domain outcomes and Tool errors`.

## ADDED Requirements

### Requirement: Private workflow control surface

The package SHALL load one private orchestration extension and four immutable package-owned professional Agent definitions for Design exploration, contract review, implementation, and diagnosis.
It SHALL register one private Abel control tool but keep it inactive outside a verified `abel-design`, `abel-implement`, or `abel-diagnose` invocation; `abel-init` and ordinary prompts SHALL NOT activate it.
The v2 tool schema SHALL discriminate the closed change-oriented `start`, `status`, `resume`, `rebind`, `cancel`, and `discard` commands from Worker-internal operations so invalid or irrelevant fields are rejected before state mutation.
An initial parent caller SHALL identify the stage and either a unique change name or a raw Design requirement; the control plane SHALL return an immutable run id used by later commands, and Gate-approved delivery revisions SHALL bind to rather than replace that run. Callers SHALL NOT construct graph admissions, phase snapshots, retained candidate identities, or stable task boundaries.
Stage finish, replacement, reload, session replacement, or shutdown SHALL deactivate the tool and interrupt active operations while preserving a resumable durable run unless it completed or was explicitly discarded.
The package SHALL expose no general Subagent command, public orchestration API, cross-extension service, external Agent override, or public raw run-store access.

#### Scenario: Eligible stage activates control

- **WHEN** a verified Design, Implement, or Diagnose prompt begins
- **THEN** the extension activates the private control tool without removing another active tool

#### Scenario: Ordinary prompt inspects tools

- **WHEN** no eligible Abel stage is active
- **THEN** the private control tool is inactive and no public workflow-run API or Agent override is exposed

#### Scenario: Parent submits graph mechanics

- **WHEN** a v2 Design or Implement caller attempts to supply a graph hash, dynamic snapshot, launch identity, or stable task boundary
- **THEN** the operation is rejected before run mutation because those facts belong to the control plane

#### Scenario: Stage ends with paused work

- **WHEN** an eligible stage session ends while its run is paused or interrupted
- **THEN** active children are disposed and tool activation is removed while the durable run remains available to a later verified resume

### Requirement: Sealed structured artifact delivery

Design and review Agents SHALL return structured evidence with originating identity, bounded scope, concise claims, exact citations, constraints, dependencies, risks, open questions, and implementation-boundary hints.
Implementation Workers SHALL return either a complete candidate artifact, a bounded artifact segment for an unsealed candidate, or a typed request for context, task reshaping, boundary approval, or capacity handling.
Candidate segments SHALL bind one originating run, task, phase, Worker attempt, approved path set, and isolated snapshot; no segment SHALL be usable until the control plane validates ordering, total bounds, complete coverage, and an atomic final seal.
A Worker SHALL NOT select a workflow Gate result, approve authority, apply a candidate, or declare verification success.
Delivery MUST NOT expose hidden reasoning, a child transcript, tool-call history, credential, or unfiltered raw logs in public outcomes.
Capacity exhaustion SHALL pause or request approved task reshaping and SHALL NOT yield a truncated candidate or terminally destroy the task.

#### Scenario: Evidence packet succeeds

- **WHEN** an evidence Agent completes a bounded packet
- **THEN** the parent receives the required structured claims and exact citations without the child conversation or tool trace

#### Scenario: Candidate is sealed

- **WHEN** every bounded segment of one candidate is present, ordered, identity-consistent, complete, and within the approved path set
- **THEN** the control plane seals one immutable candidate artifact that may enter parent-owned validation

#### Scenario: Candidate remains incomplete

- **WHEN** a Worker stops before a candidate is completely sealed
- **THEN** no segment can be applied or treated as a diff and the task remains resumable from its last committed checkpoint

#### Scenario: Worker needs more context

- **WHEN** a Worker cannot safely produce an approved candidate from its supplied context
- **THEN** it returns a typed bounded context request and the control plane either supplies already approved facts or pauses without inventing authority

### Requirement: Parent-owned change-workspace acceptance

The parent-owned control plane SHALL exclusively own Gate decisions, candidate acceptance and rejection, command execution, validation classification, isolated-workspace mutation, AGENTS checkpoint production, final transaction application, and completion tracking.
A sealed candidate SHALL bind its run, delivery revision, task, phase, Worker attempt, exact approved paths, approved dependencies, originating isolated snapshot, and verification identity in the private artifact store.
Before acceptance, the control plane SHALL verify the sealed artifact, retained identity, exact phase paths, dependency policy, current isolated snapshot, source and test loadability, approved verification identity, declared output postconditions, and ordinary patch applicability against a disposable child of the change workspace.
An accepted candidate SHALL be applied exactly to the private cumulative change workspace and SHALL NOT directly modify the main workspace.
Caller-supplied verification claims, restated stable facts, or raw Worker output SHALL NOT advance a phase.
Unknown exceptions SHALL remain internal errors rather than being classified through message parsing.

#### Scenario: Current candidate is accepted

- **WHEN** a sealed candidate passes identity, path, dependency, snapshot, loadability, verification, output, and patch checks
- **THEN** the control plane may apply exactly that candidate to the private change workspace and advance only from Runtime-owned verification facts

#### Scenario: Candidate preflight fails

- **WHEN** disposable-workspace preflight returns a typed artifact, stale, environment, approval, cancellation, or capacity result
- **THEN** none of the candidate reaches the cumulative or main workspace and the run enters the matching recoverable state

#### Scenario: Caller claims verification

- **WHEN** a caller reports that a command passed without a matching control-plane execution fact
- **THEN** no phase, task, output, checkpoint, or change state advances

#### Scenario: Candidate reaches the main workspace early

- **WHEN** a task phase succeeds before complete change verification
- **THEN** its accepted content remains only in the private change workspace

### Requirement: Durable graph scheduling and conflict queueing

The control plane SHALL load exactly one approved compiled implementation plan per delivery revision and SHALL durably bind every task, dependency, phase verification input, generated output, path scope, conflict, resource, verification lock, and AGENTS target.
It SHALL derive current readiness from that plan, committed phase and task facts, published outputs in the private change workspace, and safe current snapshots.
It SHALL NOT infer readiness from caller-supplied completed or blocked arrays or from file existence alone.
Conflicting ready tasks SHALL remain in a durable FIFO queue without consuming a Worker attempt and SHALL become eligible automatically when the conflicting declaration clears.
Independent tasks MAY execute concurrently against isolated child snapshots and SHALL merge into the cumulative change workspace only after currentness and declared conflict checks succeed.
A produced cross-task output SHALL publish only after its producer's required phase and task verification commits, and a consumer SHALL require an explicit transitive dependency.

#### Scenario: Approved plan is loaded twice

- **WHEN** the same run and delivery revision is started or resumed repeatedly
- **THEN** the control plane returns the existing plan admission and does not duplicate graph or task state

#### Scenario: Conflicting task becomes ready

- **WHEN** a task ahead of it releases the last conflicting declaration
- **THEN** the queued task becomes eligible automatically in stable order without parent polling or a new task registration

#### Scenario: Independent tasks finish concurrently

- **WHEN** two isolated task candidates have disjoint approved snapshots and declarations
- **THEN** both may merge into the cumulative workspace after currentness checks without invalidating each other

#### Scenario: Producer output is unavailable

- **WHEN** a dependency claims completion but its declared regular-file output is absent or unsafe in the cumulative workspace
- **THEN** the producer returns to repairable or integrity-paused state and the consumer does not launch

### Requirement: Recoverable attempts and Worker replacement

Provider-managed hidden retry SHALL remain disabled, while the control plane SHALL apply separately observable bounded policies for connection, first response, idle progress, total phase time, transport attempts, stale refresh, artifact correction, verification repair, and parent checkpoint correction.
Each failure SHALL retain its safe closed code, stage, policy class, attempt count, and legal continuation without exposing endpoint secrets, prompts, code excerpts, or raw model output in public outcomes.
Automatic policy exhaustion SHALL pause the affected task rather than terminally block it.
Cancellation SHALL interrupt the active operation without consuming an automatic retry or accepting partial output.
An environment or endpoint failure SHALL permit resume after capability recovery.
An approved route-policy change or explicit rebind SHALL permit a replacement Worker to continue from the structured task ledger without changing the approved task contract.
An approval-boundary gap SHALL become approval-needed and SHALL never authorize spontaneous scope expansion.

#### Scenario: Connection deadline expires

- **WHEN** a configured route does not connect within its bounded connection policy
- **THEN** the control plane records a transport attempt, selects another already allowed route when policy permits, or pauses with an explicit continuation

#### Scenario: Automatic attempts are exhausted

- **WHEN** one policy class reaches its automatic attempt bound
- **THEN** the task pauses with that class's final evidence while counters for unrelated artifact, verification, stale, and checkpoint work remain unchanged

#### Scenario: Replacement Worker resumes

- **WHEN** the user or approved route policy rebinds a paused task to a compatible Worker
- **THEN** the next attempt receives the same approved boundary and committed ledger and the former Provider identity is not treated as a protocol mismatch

#### Scenario: Result capacity is insufficient

- **WHEN** a complete candidate cannot fit one configured result envelope
- **THEN** the Worker may use bounded sealed segments or the task pauses for approved reshaping, and no truncated artifact is accepted

### Requirement: Task context ledger continuity

For every task, the control plane SHALL durably retain the approved objective and context references, delivery revision, phase state, exact command identifiers, exit codes, normalized expected and actual classifications, bounded safe failure identity, accepted artifact identity, isolated snapshot identity, output facts, and correction category needed by a later phase.
The ledger SHALL distinguish control-plane verified facts from Worker claims and SHALL preserve the order of Red, Green, Refactor, affected verification, repair, and checkpoint events.
Each Worker attempt SHALL receive only the relevant approved ledger projection and scoped repository context.
Raw command logs, raw prompts, hidden reasoning, and complete model output SHALL NOT be persisted in the ledger.
A warm child session MAY improve efficiency but SHALL NOT be authoritative; disposing or replacing it SHALL NOT erase task context or prevent resume.

#### Scenario: Green follows Red in a new session

- **WHEN** Red committed and its child session was disposed before Green
- **THEN** Green receives the verified Red command identity, exit classification, bounded failure evidence, accepted artifact identity, and current isolated snapshot from the ledger

#### Scenario: Artifact correction starts

- **WHEN** preflight rejects a candidate with a typed artifact defect
- **THEN** the replacement attempt receives the exact safe defect category, affected approved identity dimensions, and current phase context rather than a generic failure label

#### Scenario: Worker claim conflicts with the ledger

- **WHEN** a Worker claims a phase or verification fact not committed by the control plane
- **THEN** the claim is ignored and cannot alter task state

#### Scenario: Warm session is lost

- **WHEN** a Provider, model, child session, or Pi session is replaced
- **THEN** the durable task context remains sufficient to resume under a compatible Worker

### Requirement: Transactional cumulative delivery

The control plane SHALL maintain one private cumulative change workspace per active Implement run and disposable child workspaces for candidate preflight or concurrent task work.
Every accepted phase SHALL update only the cumulative workspace after currentness checks, and every affected verification SHALL execute against that cumulative state.
After all task work succeeds, the control plane SHALL run full-suite comparison, required output checks, and the approved AGENTS checkpoint before final application eligibility.
The final cumulative patch SHALL bind every main-workspace input and target on which it depends.
Final application SHALL be serialized, journaled before mutation, currentness-checked, and recoverable after interruption.
Once any main-workspace file has been mutated, cancellation or discard SHALL become a pending recovery intent; rollback material and transaction facts SHALL remain retained until recovery establishes a safe roll-forward or rollback, after which the run MAY pause or discard cleanup MAY begin.
A successful completion SHALL expose the entire approved cumulative result; stale or failed application SHALL preserve user changes and SHALL NOT report completion.

#### Scenario: Task phase succeeds

- **WHEN** an accepted Green or Refactor phase passes its verification
- **THEN** its result is committed to the cumulative workspace and no main-workspace file is changed

#### Scenario: Full suite fails

- **WHEN** full-suite comparison finds an introduced failure
- **THEN** the cumulative workspace remains available, the responsible in-boundary task becomes repairable, and final application is ineligible

#### Scenario: Final currentness passes

- **WHEN** the fully verified cumulative patch still matches every bound main-workspace baseline fact
- **THEN** the control plane begins one journaled final application

#### Scenario: Final application is interrupted

- **WHEN** the host stops or cancel/discard is requested after the final transaction mutates its first file
- **THEN** recovery retains transaction material and finishes a safe roll-forward or rollback before permitting pause, destructive cleanup, another run transition, or a completed result

### Requirement: Durable run and ephemeral child lifecycle

Run journals, plan bindings, task ledgers, sealed artifacts, cumulative workspace facts, retry classifications, and terminal cleanup facts SHALL follow the private durable control-plane contract.
Child sessions, Provider request objects, parent payload capture, live Scheduler promises, AbortControllers, and active UI widgets SHALL remain process-local and disposable.
Each child session SHALL use package-owned prompts and scoped tools with no external resource discovery, disabled Provider-managed retry, and cancellation forwarded through creation, prompting, and disposal.
Inherited Provider requests SHALL preserve effective parent payload composition; custom endpoint requests SHALL use only their selected configured route behavior.
Stage exit or process shutdown SHALL cancel and dispose live resources, durably mark uncommitted operations interrupted, and leave paused runs recoverable.
Nested model usage SHALL be aggregated exactly once into the owning operation facts.
Completion or discard SHALL idempotently clean private code and artifact state without deleting unrelated runs.

#### Scenario: Child session is disposed

- **WHEN** a child completes, fails, is cancelled, times out, or its route is replaced
- **THEN** live session and Provider resources are disposed while committed run and task facts remain recoverable

#### Scenario: Process shuts down

- **WHEN** Pi reloads, replaces the session, or shuts down with an active operation
- **THEN** the operation becomes interrupted, live queues and widgets drain, and the durable run can resume from its prior checkpoint

#### Scenario: One run completes

- **WHEN** a run completes cleanup while another run is paused
- **THEN** only the completed run's private code and artifact state is removed

#### Scenario: Nested usage is recorded

- **WHEN** one operation invokes one or more child model calls
- **THEN** their usage is aggregated exactly once without making usage data the source of lifecycle truth

### Requirement: Truthful private lifecycle activity

Interactive activity SHALL render the authoritative control-plane state rather than infer success from Tool-call completion.
The visible vocabulary SHALL distinguish queued, connecting, waiting-first-response, running, validating, retrying with policy count, verifying, paused with safe code, approval-needed, applying, recovering, cancelled operation, discarded run, rejected run, and completed run.
A blocked, paused, retryable, deferred, dependency-waiting, approval-needed, or failed-verification outcome MUST NOT display a completed check mark or completed label.
Every visible item SHALL identify the stage or role, run or task, phase, concise objective, elapsed time, current bounded wait or policy when applicable, and one legal next action without exposing Provider identity, endpoint, path, code, credential, prompt, or raw failure output.
Print, JSON, and RPC modes SHALL receive the same semantic lifecycle states without ANSI or Widget data.
Presentation failure SHALL NOT alter scheduling, cancellation, recovery, verification, or application behavior.

#### Scenario: Transport policy is retrying

- **WHEN** a task is between bounded transport attempts
- **THEN** activity displays retrying with the transport attempt count and never displays completed

#### Scenario: Task needs approval

- **WHEN** a boundary gap pauses a task
- **THEN** activity displays approval-needed with a safe boundary code and the Gate required to continue

#### Scenario: Tool call returns a paused outcome

- **WHEN** the owning Tool invocation settles while the durable run remains paused
- **THEN** re-rendering preserves paused state rather than converting Tool settlement into workflow completion

#### Scenario: Non-TUI status is requested

- **WHEN** print, JSON, or RPC mode requests status
- **THEN** it receives the same semantic state and legal commands without presentation-only fields or network activity

### Requirement: Control-plane domain outcomes and Tool errors

The private extension SHALL return valid domain outcomes normally for run-created, run-resumed, route-rebound, status, queued, connecting, candidate-sealed, candidate-rejected, phase-committed, retryable, paused, approval-needed, verifying, applying, recovering, completed, operation-cancelled, discarded, and rejected operations.
Recoverable, paused, approval-needed, verification-failed, and operation-cancelled outcomes SHALL NOT be Pi Tool errors merely because the run did not complete.
Unknown actions, invalid v2 schemas, incompatible run identity, illegal state transitions, forged mechanical identities, missing retained artifacts, journal integrity failure at mutation time, and internal invariant violations SHALL throw so Pi reports a real Tool error.
The extension SHALL NOT synthesize an `isError` flag inside a normal domain payload as a substitute for throwing.
TUI presentation SHALL NOT change domain or Tool-error classification.

#### Scenario: Run pauses normally

- **WHEN** a valid operation produces a typed recoverable pause
- **THEN** Pi receives a normal Tool result containing the pause state and legal commands

#### Scenario: Operation is cancelled

- **WHEN** cancellation interrupts a valid active operation
- **THEN** Pi receives a normal operation-cancelled result and the run remains at its last resumable checkpoint

#### Scenario: Protocol request is invalid

- **WHEN** a request violates the v2 schema, run identity, transition, or artifact binding
- **THEN** the extension throws and Pi reports a real Tool error before unauthorized state mutation

#### Scenario: Internal invariant fails

- **WHEN** the control plane encounters an impossible or unclassified internal state
- **THEN** the exception propagates as a Tool error without keyword-based domain classification
