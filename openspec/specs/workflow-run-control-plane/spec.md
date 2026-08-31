# workflow-run-control-plane Specification

## Purpose
Provide a durable private control plane that makes Abel Design and Implement runs observable, resumable, idempotent, approval-bound, and transactionally complete without making Worker availability the owner of workflow progress.
## Requirements
### Requirement: Change-oriented run commands

The control plane SHALL assign every run one immutable identity that does not contain an approved delivery revision.
For a named run, the stable lookup key SHALL be canonical project root, eligible Abel stage, and unique change name; a raw-requirement Design start SHALL receive a code-derived durable provisional identity and SHALL bind the Gate-A-approved change name to that same run rather than replacing it.
Approved Gate A and Gate B delivery revisions SHALL be ordered bindings on the stable run, not run-identity components.
Design callers SHALL use one private Design action family from `start` and `status` through change binding, decisions, Gates, artifact mutation, compilation, and finalization; a new start SHALL supply the transient requirement rather than a caller-computed provisional hash, and later operations SHALL use the returned run id.
Implement callers SHALL operate through the separate `start`, `status`, `resume`, `rebind`, `cancel`, and `discard` command surface.
Neither surface SHALL accept a caller-supplied protocol version, canonical graph, graph hash, task boundary, file snapshot, launch identity, or apply identity.
The control plane SHALL derive and validate all mechanical identities from the canonical project, approved OpenSpec delivery, and durable run state.
Every state-changing command SHALL be idempotent for the same operation identity, and a repeated command SHALL return the committed fact rather than duplicate work.
`status` SHALL be served from local authoritative state without requiring a Worker, Provider, endpoint, or model request.

#### Scenario: A change run starts

- **WHEN** a caller starts Implement for an eligible named change, or starts Design with a named change or raw requirement before Gate A
- **THEN** the control plane creates or returns one stable run, permits the pre-Gate Design run to have no approved delivery binding, and derives execution identities without caller-supplied graph or snapshot data

#### Scenario: Start is repeated

- **WHEN** an active Design start or any Implement start is repeated for the same stable root, stage, and change key, including after a newer delivery revision exists
- **THEN** the control plane returns the same run status without admitting a duplicate graph, task, or operation, and accepts any newer revision only through a validated binding

#### Scenario: Status is requested while every endpoint is unavailable

- **WHEN** a caller requests Design status by run id or Implement status by change and no Worker route is reachable
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
The current journal and delivery format SHALL reject obsolete runtime records and embedded-graph receipts without a dual-protocol compatibility path.

#### Scenario: Host restarts between phases

- **WHEN** the host process stops after Red was committed in the private change workspace but before Green starts
- **THEN** the next `resume` revalidates Red and continues with Green without repeating Gate approval or treating file existence alone as proof

#### Scenario: Host stops during an uncommitted operation

- **WHEN** execution stops after an operation begins but before its success transition is committed
- **THEN** recovery marks that operation interrupted, preserves the last committed checkpoint, and exposes a legal resume or discard action

#### Scenario: Durable state is inconsistent

- **WHEN** journal integrity, delivery binding, or private workspace provenance cannot be revalidated
- **THEN** the run pauses with a typed integrity reason, preserves evidence for inspection, changes no main-workspace file, and does not guess a completed state

#### Scenario: An obsolete delivery is supplied

- **WHEN** Implement receives an embedded-graph receipt or an obsolete runtime protocol record
- **THEN** the control plane rejects it with a delivery-format error before creating or modifying a run and does not invoke a compatibility adapter

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

#### Scenario: Green is constrained by the same task Red artifact

- **WHEN** Green reports an extra path because an accepted same-task Red test or assertion imposed the wrong constraint and the canonical plan does not authorize that extra output
- **THEN** the control plane preserves the compatible Red revision, reopens bounded Red or artifact correction under the existing candidate-attempt limit, accepts no partial patch, and emits no approval-needed or Design request

#### Scenario: Legacy context approval is reclassified

- **WHEN** status or resume loads a persisted approval-needed boundary-review-needed task whose typed refs prove only a same-task Red constraint, citation, diagnostic, or allowed AGENTS read
- **THEN** the control plane atomically converts it to a recoverable artifact pause on the same delivery revision, retains compatible private progress, and permits bare resume without discard

#### Scenario: Genuine retained approval remains bound

- **WHEN** a persisted context approval still proves a new dependency, product path, verification contract, or AGENTS contract boundary after reclassification
- **THEN** it remains approval-needed and bare resume still requires a newer matching delivery receipt

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

### Requirement: Durable Design decisions and Gate proofs

The private control plane SHALL record ordered behavior and technical decisions for one Design run and SHALL derive Gate currentness from their durable order. Gate A approval SHALL become stale after a later behavior decision; Gate B approval SHALL become stale after any later substantive decision, Gate A reapproval, or plan recompilation. The control plane SHALL normalize and hash transient decision and Gate-A contract text itself, persist only the resulting canonical hash, and bind Gate B only to a plan compiled after the current Gate A approval and latest substantive decisions without accepting a caller-supplied hash. Every Gate approval SHALL produce an owner-private record hash. Repeating one operation id SHALL replay its committed outcome.

#### Scenario: Behavior changes after Gate A

- **WHEN** a later behavior decision is recorded after Gate A approval
- **THEN** Gate A and Gate B are no longer current until explicitly approved again

#### Scenario: Technical decision changes after Gate B

- **WHEN** a later technical decision or different compiled plan follows Gate B approval
- **THEN** Gate B becomes stale while an unchanged Gate A remains current

#### Scenario: Approval operation is replayed

- **WHEN** the same approval operation id is repeated
- **THEN** the control plane returns the original record rather than creating another approval revision

### Requirement: Code-owned Design delivery compilation

After current Gate A approval, the Design control plane SHALL read one fixed safe plan-draft path, compile and validate the canonical implementation plan, and write the canonical plan artifact without asking the parent to construct hashes or receipts. Gate B approval SHALL automatically bind that exact current canonical plan hash. Finalization SHALL require current Gate A and Gate B proofs, strict and complete OpenSpec artifacts, exact traceability, and executable verification closure before code-owned generation of Gate A and ready receipts. Failure SHALL write no partial ready delivery.

#### Scenario: Plan is compiled before Gate B

- **WHEN** a Gate-A-approved Design run submits a valid plan draft
- **THEN** the control plane produces a canonical plan identity for Gate B review and records it durably

#### Scenario: Parent hand-assembles a ready receipt

- **WHEN** a receipt lacks current private Gate proofs or does not bind the stored canonical plan
- **THEN** Implement rejects it before Worker launch even if repository hashes are internally consistent

#### Scenario: Delivery finalization succeeds

- **WHEN** both Gate proofs are current and all artifact, traceability, OpenSpec, and verification checks pass
- **THEN** the control plane writes one complete canonical delivery, marks Design completed, and returns its delivery revision and receipt hash

#### Scenario: Finalization fails

- **WHEN** any required proof, artifact, traceability link, strict validation, or executable capability is invalid
- **THEN** Design remains nonterminal and no new ready receipt is installed

### Requirement: Actionable approval-needed continuation

An approval-needed Implement outcome SHALL include one closed missing-authority category, the required Gate set, the retained run id and delivery revision, and a receipt precondition. Safe missing path or dependency references SHALL be included when available. Status SHALL distinguish an immediately executable command from a command whose receipt precondition is not yet satisfied; resume without a newer receipt SHALL not be presented as progress.

#### Scenario: Approval-needed status is inspected

- **WHEN** an Implement run is waiting for expanded authority
- **THEN** status identifies the required Design revision and exposes resume only with its newer-receipt precondition

#### Scenario: Resume omits the required receipt

- **WHEN** the caller resumes approval-needed without a newer revision and matching receipt hash
- **THEN** the run remains unchanged and the result repeats the unmet receipt precondition explicitly

### Requirement: Both Gate proofs bind Implement admission

Implement admission SHALL validate both Gate A and Gate B receipt proofs against owner-private Design journal records for the same canonical root and change. The durable Implement run SHALL bind both proofs for each accepted delivery revision. A repository-only forged approval, stale Gate proof, mismatched plan hash, or proof from another change SHALL fail before Worker execution.

#### Scenario: Repository receipts are forged

- **WHEN** canonical receipt files claim approval but no matching private Design approval facts exist
- **THEN** Implement returns delivery-invalid before creating a private implementation workspace or launching a Worker

#### Scenario: Both current proofs are accepted

- **WHEN** the ready receipt matches current private Gate A and Gate B facts and the exact compiled plan
- **THEN** Implement records both delivery bindings and may begin execution

### Requirement: Serialized Design delivery commitment

The control plane SHALL admit at most one active delivery-finalization operation for a Design run. The ownership fact SHALL be durable, recoverable after interruption, and checked before repository receipt mutation. A competing operation SHALL fail without writing or removing delivery artifacts. Cleanup after an uncommitted failure SHALL remove only bytes owned by that operation, while replay after a committed finalization SHALL converge the Design run to completed without replacing the committed receipt.

#### Scenario: Two finalizations overlap

- **WHEN** one Design finalization holds the run's delivery-commitment ownership and another operation attempts to finalize the same run
- **THEN** the competing operation returns a typed busy outcome before receipt mutation and the owner's valid receipt remains installed

#### Scenario: Finalization owner is interrupted

- **WHEN** a finalization stops before commitment and its durable ownership expires
- **THEN** a later operation may acquire ownership, revalidate the delivery from the beginning, and commit exactly one next revision

#### Scenario: Run completion fails after journal commitment

- **WHEN** receipt bytes and the private finalization fact commit but the run completion transition fails
- **THEN** the receipt remains installed and replay of the same operation completes the run before returning the committed outcome

### Requirement: Executable approval command boundary

An approval-needed Implement status SHALL derive its authority category and exact Gate set from one closed typed code table. Unknown approval codes SHALL fail closed as control-plane integrity errors. Status and execution SHALL agree: until a newer verified delivery is available, only status and discard are immediately legal; receipt-less resume and rebind SHALL NOT mutate the run or route binding.

#### Scenario: Rebind is attempted during approval-needed

- **WHEN** a caller sends rebind while the run still lacks approved authority
- **THEN** the command is rejected and the task and run route bindings remain unchanged

#### Scenario: Resume omits a newer receipt

- **WHEN** a caller sends resume during approval-needed without an exact verified newer delivery revision and receipt hash
- **THEN** the command is rejected without consuming progress or changing the retained delivery binding

#### Scenario: Runtime detects an empty write contract

- **WHEN** an admitted task phase unexpectedly has no approved write or delete path
- **THEN** approval status classifies the gap as a Gate-B path-boundary requirement rather than reopening observable behavior through a default fallback

#### Scenario: Approval code is unknown

- **WHEN** any Worker, verifier, or internal path attempts to create approval-needed with a code outside the closed authority table
- **THEN** the control plane pauses as an integrity failure and does not invent a category or Gate requirement

### Requirement: Locally discoverable newer delivery

For an approval-needed Implement run, local status SHALL inspect the current repository receipt without a Worker or network request and expose an exact available delivery only when it is newer than the retained revision, matches the change, and both Gate proofs resolve to current owner-private Design facts. Discovery SHALL NOT admit the delivery or mutate the run. A later resume using the exposed revision and hash SHALL perform full delivery validation before preserving or invalidating retained work.

#### Scenario: New Design receipt is available in a fresh context

- **WHEN** Design has finalized a newer proof-bound receipt and a fresh explicit Implement context requests status for the retained approval-needed run
- **THEN** status exposes the exact newer delivery revision and receipt hash and presents resume as immediately executable with those arguments

#### Scenario: Repository receipt is forged or stale

- **WHEN** the repository receipt is not newer, has a mismatched hash/change, or either Gate proof is absent or not current in the private journal
- **THEN** status exposes no available delivery and leaves resume conditional

#### Scenario: Discovered delivery fails full admission

- **WHEN** a caller resumes with a locally discovered pair but full artifact, traceability, capability, or currentness validation fails
- **THEN** the run remains nonterminal with aggregated delivery diagnostics and does not start a Worker
