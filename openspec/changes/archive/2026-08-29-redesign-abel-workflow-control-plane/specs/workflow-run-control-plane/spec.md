## Purpose

Provide a durable private control plane that makes Abel Design and Implement runs observable, resumable, idempotent, approval-bound, and transactionally complete without making Worker availability the owner of workflow progress.

## ADDED Requirements

### Requirement: Versioned change-oriented run commands

The control plane SHALL assign every run one immutable identity that does not contain an approved delivery revision.
For a named run, the stable lookup key SHALL be canonical project root, eligible Abel stage, and unique change name; a raw-requirement Design start SHALL receive a durable provisional identity and SHALL bind the Gate-A-approved change name to that same run rather than replacing it.
Approved Gate A and Gate B delivery revisions SHALL be versioned bindings on the stable run, not run-identity components.
Design and Implement callers SHALL operate on that run through versioned `start`, `status`, `resume`, `rebind`, `cancel`, and `discard` commands without supplying a canonical graph, graph hash, task boundary, file snapshot, launch identity, or apply identity.
The control plane SHALL derive and validate all mechanical identities from the canonical project, approved OpenSpec delivery, and durable run state.
Every state-changing command SHALL be idempotent for the same operation identity, and a repeated command SHALL return the committed fact rather than duplicate work.
`status` SHALL be served from local authoritative state without requiring a Worker, Provider, endpoint, or model request.

#### Scenario: A change run starts

- **WHEN** a caller starts an eligible named stage, or starts Design from a raw requirement before Gate A
- **THEN** the control plane creates or returns one stable run, permits the pre-Gate Design run to have no approved delivery binding, and derives execution identities without caller-supplied graph or snapshot data

#### Scenario: Start is repeated

- **WHEN** `start` is repeated for the same stable root, stage, and change key, including after a newer delivery revision exists
- **THEN** the control plane returns the same run status without admitting a duplicate graph, task, or operation, and accepts any newer revision only through validated versioned binding

#### Scenario: Status is requested while every endpoint is unavailable

- **WHEN** a caller requests `status` for an existing run and no configured Worker route is reachable
- **THEN** the control plane returns the committed local lifecycle, current task or Gate, pause reason, and available legal commands without a network request

#### Scenario: An active operation is cancelled

- **WHEN** a caller sends `cancel` while a child, verification, apply preparation, or journaled final-apply operation is active
- **THEN** no partial child result is accepted; work before the first main-workspace mutation returns to the last committed paused checkpoint, while an apply that has mutated any file first enters recovery and reaches paused only after the transaction safely rolls forward or rolls back

#### Scenario: A run is discarded

- **WHEN** a caller explicitly sends `discard`
- **THEN** active work stops and the run becomes terminally discarded with idempotent private-state cleanup, except that an in-flight final apply first retains transaction and rollback material and settles through recovery before any destructive cleanup

### Requirement: Durable journal and restart recovery

Every accepted Gate, plan revision, task transition, candidate decision, verification fact, retry or pause classification, change-workspace merge, and final-apply transaction step SHALL be durably committed before the corresponding success is acknowledged.
After process reload, session replacement, model replacement, or host restart, the control plane SHALL reconstruct the run from its journal and private change workspace, revalidate current receipts and workspace facts, and continue from the last valid committed checkpoint.
Recovery SHALL NOT infer a completed task or phase solely from file existence, an unchecked diff, a child transcript, or a model claim.
An operation that was active but not committed when execution stopped SHALL recover as interrupted and resumable rather than completed or terminally blocked.
The v2 journal and delivery protocol SHALL reject v1 runtime records and v1 embedded-graph receipts without a dual-protocol compatibility path.

#### Scenario: Host restarts between phases

- **WHEN** the host process stops after Red was committed in the private change workspace but before Green starts
- **THEN** the next `resume` revalidates Red and continues with Green without repeating Gate approval or treating file existence alone as proof

#### Scenario: Host stops during an uncommitted operation

- **WHEN** execution stops after an operation begins but before its success transition is committed
- **THEN** recovery marks that operation interrupted, preserves the last committed checkpoint, and exposes a legal resume or discard action

#### Scenario: Durable state is inconsistent

- **WHEN** journal integrity, delivery binding, or private workspace provenance cannot be revalidated
- **THEN** the run pauses with a typed integrity reason, preserves evidence for inspection, changes no main-workspace file, and does not guess a completed state

#### Scenario: A v1 delivery is supplied

- **WHEN** Implement receives a v1 embedded-graph receipt or an obsolete runtime protocol record
- **THEN** the control plane rejects it with a versioned delivery error before creating or modifying a run and does not invoke a v1 compatibility adapter

### Requirement: Recoverable lifecycle classification

The public run lifecycle SHALL distinguish at least ready, queued, connecting, running, validating, verifying, paused, retryable, approval-needed, change-verifying, applying, recovering, completed, discarded, and rejected states.
Transport, endpoint, environment, capacity, generated-artifact, stale-snapshot, resource-conflict, verification, and repairable compatibility failures SHALL NOT by themselves create an unrecoverable task terminal.
Resource conflicts SHALL remain queued until their declared conflict clears.
Retryable failures SHALL preserve separate policy counters and final typed evidence for transport, artifact correction, stale refresh, verification repair, and parent checkpoint work.
Artifact correction SHALL use the canonical plan's 2-3 total candidate-attempt bound independently for each task phase and operation, SHALL count the initial candidate launch, and SHALL reset only after phase commitment or a later explicit operation.
Exhausting an automatic policy SHALL pause the run for explicit resume, Worker rebinding, task reshaping, approval revision, or discard; it SHALL NOT erase already committed independent work.
Only successful completion, explicit discard, or a deterministic contract or integrity rejection with no legal revision path SHALL terminate a run.

#### Scenario: Endpoint transport fails repeatedly

- **WHEN** the active Worker route exhausts its bounded automatic transport policy
- **THEN** the run pauses with the final safe transport code and permits resume or policy-authorized rebinding without consuming artifact or verification repair policy

#### Scenario: Two tasks conflict

- **WHEN** a ready task conflicts with a running task by path, resource, verification lock, or AGENTS target
- **THEN** the later task remains durably queued and becomes ready automatically after the conflict clears without a parent polling loop

#### Scenario: Generated candidate remains invalid

- **WHEN** automatic artifact correction is exhausted while the approved task boundary remains valid
- **THEN** the task pauses with bounded validation evidence and can resume with a replacement Worker while accepted sibling work remains available

#### Scenario: Full verification introduces a failure

- **WHEN** change-level verification finds a failure attributable to the isolated cumulative change
- **THEN** the run becomes repairable, schedules an in-boundary repair against the private change workspace, and does not mark the task or change completed

### Requirement: Approval revision binding and controlled continuation

Every run SHALL bind the exact approved Gate A and Gate B delivery revision it executes.
A discovered requirement, behavior, policy, dependency, architecture, path, conflict, resource, verification, or AGENTS boundary gap SHALL pause the run as approval-needed with structured safe evidence and SHALL NOT expand authority automatically.
A behavior-affecting revision SHALL require renewed Gate A and Gate B approval; a purely technical boundary revision SHALL require renewed Gate B approval only.
After a newly approved delivery revision is supplied, the control plane SHALL attach it as a new binding to the existing stable run, compare its behavior, task, path, verification, output, and dependency contracts with retained work, invalidate only facts no longer justified, revalidate the private change workspace, and continue when the revised contract permits it.
Gate approval SHALL remain a product or implementation-contract approval and SHALL NOT become tool permission.

#### Scenario: A missing technical path is discovered

- **WHEN** an approved implementation cannot continue without an additional technical path and no observable behavior changes
- **THEN** the run pauses for a Gate B revision, retains its private workspace, and performs no out-of-boundary write

#### Scenario: A behavior change is required

- **WHEN** continuing would change an approved observable outcome, compatibility rule, safety policy, or scope
- **THEN** the run pauses until both Gate A and Gate B revisions approve that change

#### Scenario: A revised receipt is accepted

- **WHEN** a newer valid receipt revision is approved for a paused run
- **THEN** the control plane preserves the run identity, records the newer revision binding, revalidates retained facts against it, discards only invalidated isolated work, and resumes from the earliest justified checkpoint

#### Scenario: A Gate revision narrows authority

- **WHEN** a revised delivery removes a path, dependency, output, or verification authority used by retained work
- **THEN** that work is invalidated inside the private workspace before execution continues and no removed authority reaches the main workspace

### Requirement: Private run-data retention and cleanup

Durable run state and change workspaces SHALL live outside the repository and OpenSpec change root in a user-private location inaccessible to other users under ordinary filesystem permissions.
After canonicalizing the consumer root and resolved per-consumer state path, the control plane SHALL reject the state path before creating any directory or database when it is equal to or contained by the canonical consumer root.
The journal SHALL contain only structural identities, hashes, lifecycle facts, safe typed diagnostics, bounded normalized verification facts, and references needed for recovery.
Raw prompts, hidden reasoning, complete child transcripts, raw model output, credentials, endpoint secrets, and environment values MUST NOT be persisted by the control plane.
The private change workspace MAY contain repository content and sealed candidate artifacts required for recovery, and its existence and cleanup state SHALL be visible through local status.
Completed and explicitly discarded runs SHALL remove private change content and recoverably finish cleanup; paused and approval-needed runs SHALL retain it until resume or explicit discard.
Runtime state MUST NOT be written into AGENTS indexes, tracked OpenSpec artifacts, the Git worktree, or package contents.

#### Scenario: A run pauses

- **WHEN** a run enters paused or approval-needed state
- **THEN** its private journal and change workspace remain available for resume while no credential, raw prompt, or raw child transcript is persisted

#### Scenario: A run completes

- **WHEN** final application and postconditions commit successfully
- **THEN** private code content and sealed candidate artifacts are removed and only the minimum terminal structural fact needed for idempotent status remains

#### Scenario: Cleanup is interrupted

- **WHEN** the process stops during completed-run or discarded-run cleanup
- **THEN** recovery resumes idempotent cleanup without reapplying the change or reviving the run

#### Scenario: Repository state is inspected

- **WHEN** state-root resolution or a paused-run inspection examines the project worktree, OpenSpec artifacts, and AGENTS indexes
- **THEN** any candidate state path equal to or below the canonical consumer root is rejected and none contains a runtime session ledger, retry budget, credential, transcript, or private control-plane database

### Requirement: Transactional change completion

Implement SHALL perform Red, Green, Refactor, declared output checks, affected verification, full-suite comparison, and approved AGENTS checkpoint work against a private cumulative change workspace before final delivery to the main workspace.
The main workspace SHALL remain unchanged by Implement candidates until the complete change is verified and ready to apply.
Before final application, the control plane SHALL compare every bound main-workspace input and target with the baseline on which the verified cumulative change depends.
A stale main workspace SHALL pause for rebase and revalidation without overwriting user changes.
Final application SHALL be journaled and recoverable so a successful terminal result exposes the entire cumulative change and an unsuccessful or recovered transaction does not report completion with an unaccounted partial change.
After the first per-file mutation, cancellation or discard SHALL record a pending intent, keep prepared and rollback material, and force the run through `recovering`; only a safely settled transaction MAY transition to paused or perform discard cleanup.
Only after final application, required postconditions, and post-apply verification commit SHALL the run become completed.

#### Scenario: Red succeeds as an expected failure

- **WHEN** an approved Red candidate witnesses the target defect in the private change workspace
- **THEN** Red is committed only to that workspace and the main workspace remains byte-for-byte unchanged

#### Scenario: Change verification succeeds

- **WHEN** every task, declared output, affected verification, full-suite comparison, and AGENTS checkpoint succeeds in the cumulative change workspace
- **THEN** the run becomes ready for one currentness-checked final application rather than marking tasks complete in the main workspace phase by phase

#### Scenario: Main workspace became stale

- **WHEN** a bound main-workspace file changes after the cumulative change baseline was captured
- **THEN** final application writes none of the stale cumulative change, preserves the user modification, and pauses for rebase and revalidation

#### Scenario: Apply is interrupted

- **WHEN** the process stops, or cancellation or discard is requested, after a journaled final application has mutated at least one file
- **THEN** recovery identifies the transaction, retains rollback material, completes a safe roll-forward or rollback according to current file facts, and permits completion, pause, or destructive cleanup only after the transaction is safely settled
