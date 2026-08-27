## MODIFIED Requirements

### Requirement: Private-orchestration MVP scope boundary

The package SHALL provide the four Abel workflow prompts, immutable package-owned professional Agent definitions, a private workflow-only control plane, bounded scoped Worker execution, durable run status and recovery, approval-bound delivery compilation, private change-workspace isolation, transactional final application, cancellation, and independent engineering verification.
The private control plane SHALL remain available only to verified Abel Design, Implement, and Diagnose stages and SHALL NOT become a general Subagent command, supported public orchestration service, cross-extension service, cloud queue, remote state service, permission package, interactive tool-approval system, background autonomous Agent manager, or public Agent override platform.
It MAY maintain owner-private local run journals, sealed artifacts, and isolated change workspaces outside the repository only under the approved retention and privacy contract.
It SHALL NOT add implicit commit, archive, publication, remote-repository creation, release, or host-version promises.
Gate A and Gate B SHALL remain behavior and implementation contract approvals and SHALL NOT become tool-permission approvals.
The internal v2 control and delivery protocol SHALL replace the v1 process-local `admit-graph` and `task-attempt` protocol without a dual-stack compatibility requirement.
For this change's single bound bootstrap receipt only, v1 activation SHALL remain selected until every bootstrap task and approved acceptance check succeeds; before selecting v2, the package SHALL durably commit a v2 handoff from which either side of a host reload can finish cutover without asking v2 to parse a v1 receipt.

#### Scenario: MVP package excludes a general platform

- **WHEN** the implementation and real package artifact are reviewed
- **THEN** they contain the approved private durable workflow capability and none of the prohibited general, cross-extension, cloud, permission, publication, or release platforms

#### Scenario: Seed wave remains bounded

- **WHEN** every task and approved acceptance check for the one bound v1 bootstrap succeeds and its resumable v2 handoff is durably committed
- **THEN** activation switches to v2, the bootstrap exception closes, a reload resumes from the handoff rather than the v1 receipt, and all later semantic delivery follows the v2 private control-plane contract

#### Scenario: Private recovery state exists

- **WHEN** an eligible Abel run pauses or the host restarts
- **THEN** only the approved owner-private structural journal and change workspace may persist outside the repository for later recovery

#### Scenario: Obsolete internal protocol is invoked

- **WHEN** a caller submits the v1 embedded graph or phase-attempt protocol
- **THEN** the package returns a versioned delivery rejection and does not activate a compatibility implementation

#### Scenario: Gate approval is not tool permission

- **WHEN** Design presents Gate A or Gate B
- **THEN** the user approves behavior or implementation contracts without an additional tool-permission flow

### Requirement: Design behavior and trusted delivery

`abel-design` SHALL accept either a requirement or `--change <change_name>`, validate the root and relevant AGENTS indexes, and create or recover one durable Design run.
Before Gate A it SHALL keep the repository and OpenSpec change artifacts read-only while permitting only private structural run state outside the repository.
It SHALL decompose broad exploration into bounded evidence packets, dispatch independent packets concurrently through package-owned read-only professional Agents, validate their structured evidence, and retain accepted evidence in the run ledger independently of any child session.
A transport, endpoint, environment, capacity, cancellation, or malformed-evidence failure SHALL pause only the affected evidence packet and SHALL permit policy-authorized Worker replacement; it SHALL NOT force completed independent evidence to be repeated.
The parent Agent SHALL remain responsible for evidence validation and SHALL NOT silently treat an untrusted packet as proof.

Design SHALL submit only unresolved behavior decisions to Gate A and unresolved substantive technical decisions to Gate B.
Reversible mechanical decisions uniquely determined by repository facts or an approved contract SHALL be recorded without interrupting the user, and related decisions owned by one Gate SHALL be presented together.
After Gate A it SHALL write only inside the resolved OpenSpec change root according to the artifact graph and approved behavior contract.

Design SHALL produce one versioned, machine-readable implementation plan containing every task, explicit dependency, phase scope, verification-input binding, output provenance and postcondition, approved dependency, impact closure, scheduling declaration, and AGENTS-impact contract.
A code-owned delivery compiler SHALL validate and canonicalize that plan, calculate its identity and verification closure, and generate the receipt bindings; the parent model SHALL NOT hand-assemble a Runtime graph admission, graph hash, dynamic file snapshot, or operation identity.
Before Gate B and again before final readiness, Design SHALL require strict OpenSpec validation, a complete trace from Requirement to Scenario to Verification to Task, and an executable static verification closure with no diagnostics.
The ready receipt SHALL bind the exact compiled plan artifact and its canonical identity by safe relative path and hash rather than embedding an alternate caller-supplied graph copy.
Design SHALL report `READY_TO_IMPLEMENT` only when both Gates, receipts, artifact hashes, traceability, plan compilation, closure, and zero blocking decisions all pass.

#### Scenario: New design reaches Gate A

- **WHEN** behavior evidence is trusted and all behavior decisions are resolved
- **THEN** Design presents one consolidated behavior contract and waits for explicit Gate A approval before creating a new OpenSpec change

#### Scenario: Independent Design packets run concurrently

- **WHEN** broad exploration has independent bounded evidence packets
- **THEN** Design may run them concurrently and durably retain each trusted result independent of sibling or Provider failure

#### Scenario: Delegated Design evidence remains untrusted

- **WHEN** a required packet is malformed, uncited, out of scope, cancelled, incomplete, or still untrusted after its automatic policy
- **THEN** only that evidence path pauses and Design does not treat it as proof or enter a Gate that depends on it

#### Scenario: Evidence Worker becomes unavailable

- **WHEN** an evidence packet cannot complete under its current Worker route
- **THEN** that packet pauses with typed status and may resume under an allowed replacement without invalidating trusted sibling evidence

#### Scenario: Mechanical choices remain non-blocking

- **WHEN** a reversible design detail is uniquely determined by repository convention and changes no approved observable behavior
- **THEN** Design records it for Gate review without creating a separate blocking question

#### Scenario: Existing change is resumed

- **WHEN** a user invokes `abel-design --change <change_name>` after process or model replacement
- **THEN** Design validates durable run state, receipts, artifact hashes, traceability, and current OpenSpec status and continues from the earliest valid checkpoint

#### Scenario: Artifact integrity is invalid

- **WHEN** a receipt is missing, a covered artifact hash differs, or the compiled plan and artifact graph are inconsistent
- **THEN** Design pauses at the earliest affected Gate, retains unrelated trusted evidence, and does not report implementation readiness

#### Scenario: Delivery is compiled

- **WHEN** the approved technical plan is complete
- **THEN** the code-owned compiler produces its canonical identity and closure while the caller supplies neither graph hashes nor file snapshots

#### Scenario: Design is complete

- **WHEN** both Gates are approved and all delivery checks pass
- **THEN** Design binds the compiled plan artifact in the ready receipt and reports `READY_TO_IMPLEMENT` without modifying product code or AGENTS indexes

### Requirement: Implementation behavior

`abel-implement` SHALL require a unique change name and SHALL create, return, or resume one durable Implement run through the change-oriented control protocol.
Before creating a private change workspace it SHALL validate the v2 receipts, covered artifact hashes, traceability, strict OpenSpec status, compiled plan identity, static verification closure, and complete task contracts.
Invalid delivery SHALL reject or pause the run before Worker execution and SHALL NOT modify the main workspace.
The control plane SHALL load the approved plan, derive current snapshots and operation identities, and compute ready DAG work without requiring the parent model to submit or repeat stable graph facts.

Before candidate work, the parent SHALL record target, affected-suite, and full-suite baselines with stable normalized failure identities and SHALL keep pre-existing failures separate from task Red.
The run SHALL create a private cumulative change workspace from the approved current baseline.
Every Red, Green, Refactor, generated output, compatibility repair, AGENTS checkpoint, and verification operation SHALL occur in that workspace until change-level verification succeeds.
Professional Agents SHALL remain unable to mutate either workspace or run validation commands; the parent-owned control plane SHALL exclusively validate and apply sealed candidates to the private change workspace.

Each task SHALL retain an authoritative structured context ledger containing the approved objective and boundary, previous phase commands and normalized results, accepted candidate identities, current isolated snapshot, produced outputs, and bounded correction evidence.
A later phase or replacement Worker SHALL receive the relevant ledger facts and SHALL NOT depend on a prior child session remaining alive.
Red SHALL commit only after the approved verification witnesses the target failure for the approved identity.
Green SHALL implement the minimum approved behavior and keep the target verification green after every accepted edit.
Refactor SHALL remain inside the approved behavior and paths while target and affected verification remain green.

The durable scheduler SHALL derive readiness from the approved DAG and committed run facts.
Conflicting work SHALL remain queued and automatically become eligible when its declared path, resource, verification, or AGENTS conflict clears.
Independent work SHALL remain valid after a sibling pauses, retries, requires approval, or completes.
Declared outputs SHALL become available to dependent tasks only after their producer and required task verification commit in the cumulative workspace.

Transport, endpoint, environment, capacity, artifact, stale, resource, verification, and repairable compatibility failures SHALL produce typed recoverable states rather than terminal task blockers.
Automatic policies SHALL be bounded and independently accounted; exhaustion SHALL pause for explicit resume, typed route `rebind`, Worker replacement, task reshaping, or approval revision without erasing committed work.
Cancellation SHALL interrupt the active operation, reject partial output, and preserve the last committed resumable checkpoint; after final apply mutates any main-workspace file, cancellation or discard SHALL first settle the journaled transaction through recovery.
A required behavior, policy, dependency, architecture, path, conflict, resource, verification, or AGENTS expansion SHALL pause as approval-needed and SHALL NOT expand authority automatically.

When every task and affected verification is green, the control plane SHALL run the approved full-suite comparison and output postconditions against the cumulative private workspace.
An introduced failure SHALL return the owning in-boundary task to repairable work; an unresolved or out-of-boundary failure SHALL pause with typed attribution evidence.
Only after the cumulative change, full suite, output postconditions, and AGENTS checkpoint succeed SHALL final application become eligible.
Final application SHALL compare the main workspace with its bound baseline, preserve unrelated dirty files, reject stale bound files, and commit the cumulative change through a recoverable transaction.
The run SHALL become completed only after application and required post-apply checks commit.
Implement SHALL NOT implicitly archive, commit, publish, release, or modify unrelated user files.

#### Scenario: Valid cross-context handoff

- **WHEN** the caller supplies a unique change name whose v2 delivery is valid
- **THEN** the control plane derives the compiled plan and creates or returns the one matching durable run without caller-supplied graph or snapshots

#### Scenario: Invalid trusted delivery

- **WHEN** a receipt, artifact hash, traceability link, plan identity, closure, or strict validation is invalid
- **THEN** Implement reports a typed delivery state before Worker execution and changes no main-workspace file

#### Scenario: Worker delivers a task phase

- **WHEN** a sealed Red candidate passes parent-owned isolated validation and witnesses the approved target failure
- **THEN** it advances Red only in the private change workspace and records normalized evidence in the task ledger

#### Scenario: Stable facts are replayed

- **WHEN** Green starts under a new child session or replacement Worker
- **THEN** it receives the approved Red command, normalized failure identity, accepted Red artifact facts, current isolated snapshot, and unchanged task boundary

#### Scenario: Worker route fails

- **WHEN** the current implementation Worker route exhausts its bounded transport policy
- **THEN** the task pauses and may resume under an allowed replacement while committed Red, sibling work, and retry classifications remain intact

#### Scenario: Conflicting task is opened

- **WHEN** a ready task conflicts with active task-lifetime declarations
- **THEN** the scheduler keeps it durably queued and admits it automatically after the conflict clears

#### Scenario: Related file change makes a result stale

- **WHEN** a file bound by a candidate changes before private-workspace acceptance
- **THEN** none of that candidate is accepted, the task becomes retryable with a fresh snapshot, and no main-workspace file changes

#### Scenario: Verification finds an introduced failure

- **WHEN** target, affected, or change-level verification finds a failure attributable to in-boundary cumulative work
- **THEN** the owning task becomes repairable and cannot be marked completed until the repair is verified

#### Scenario: Repair requires boundary expansion

- **WHEN** a repair requires unapproved behavior or technical authority
- **THEN** Implement pauses as approval-needed, retains the private workspace, and applies no wider change until the required Gate revision is approved

#### Scenario: Main workspace changed

- **WHEN** a bound main-workspace path differs from the baseline used by the verified cumulative change
- **THEN** final application preserves that user change, writes none of the stale cumulative transaction, and pauses for rebase and revalidation

#### Scenario: Task boundary is opened

- **WHEN** the compiled plan makes a Red task ready for its first Worker attempt
- **THEN** the control plane derives and durably binds its immutable approved boundary before dispatch without accepting caller-restated stable facts

#### Scenario: Compatible tasks produce parallel results

- **WHEN** two ready tasks have satisfied dependencies and disjoint path, resource, verification-lock, and AGENTS declarations
- **THEN** they may run against isolated child workspaces and merge independently after currentness checks

#### Scenario: Unrelated sibling application preserves currency

- **WHEN** one accepted task merges into the cumulative workspace without changing a file bound by an independent sibling candidate
- **THEN** the sibling remains current and may continue without redispatch

#### Scenario: Candidate artifact cannot load or has the wrong Red identity

- **WHEN** disposable-workspace preflight finds an incomplete artifact, source or test load failure, missing target test, wrong command, wrong Red identity, or unexpectedly passing Red
- **THEN** none of the candidate is accepted and the task enters typed artifact correction or paused state inside its approved boundary

#### Scenario: Artifact correction budget is exhausted

- **WHEN** the bounded automatic artifact-correction policy is exhausted
- **THEN** the task pauses with the final safe artifact evidence and may resume under a replacement Worker without becoming a permanent blocker

#### Scenario: Worker diff exceeds its result boundary

- **WHEN** a complete candidate cannot fit one configured result envelope
- **THEN** the Worker uses approved sealed segments or the task pauses for reshaping, and no truncated or partial candidate is accepted

#### Scenario: Cancellation interrupts a launch

- **WHEN** cancellation interrupts a child launch, preflight, verification, or apply preparation before commit
- **THEN** partial output is rejected and the run returns to its last durable resumable checkpoint without consuming an unrelated policy budget

#### Scenario: Runtime apply advances a phase

- **WHEN** a sealed candidate passes parent-owned preflight, is applied to the private cumulative workspace, and its approved verification and outputs succeed
- **THEN** only the Runtime-owned committed fact advances the task phase

#### Scenario: Parent reports verification without apply

- **WHEN** a caller reports successful verification without a matching Runtime-owned candidate acceptance and execution fact
- **THEN** no phase, output, checkpoint, task, or change state advances

#### Scenario: Approved compatibility path fails

- **WHEN** an approved existing compatibility test or fixture fails because of cumulative in-boundary work
- **THEN** the owning task becomes repairable in the private workspace and cannot complete until the failure is repaired or reverted

#### Scenario: Affected-suite baseline is green

- **WHEN** the affected-suite baseline is green and later cumulative verification fails
- **THEN** the failure is classified as introduced and final application remains ineligible until repair succeeds

#### Scenario: Existing affected failure is present

- **WHEN** affected verification has a reproducible baseline failure before candidate work
- **THEN** the control plane records it separately and does not use it as task Red or attribute it to the cumulative change without evidence

#### Scenario: Later run reveals a previously masked failure

- **WHEN** a later affected run exposes a baseline failure that was previously masked by ordering or environment
- **THEN** the control plane rechecks attribution and pauses unresolved ownership rather than guessing or marking completion

#### Scenario: Affected failure is environmental

- **WHEN** affected verification fails because of a reproducible environment capability problem
- **THEN** the run pauses as environment-unavailable with its private workspace intact and does not authorize speculative code changes

#### Scenario: Affected repair requires a substantive decision

- **WHEN** repairing an affected failure changes approved behavior, architecture, policy, dependency, or scope
- **THEN** the run becomes approval-needed at the owning Gate and preserves the cumulative workspace without applying wider authority

#### Scenario: Full-suite-only baseline failure exists

- **WHEN** full-suite baseline contains a reproducible failure outside every affected contract
- **THEN** it remains baseline evidence outside task scope and does not prevent completion unless the cumulative change introduces or worsens it

#### Scenario: Task Red fails for the wrong reason

- **WHEN** the approved Red command fails without witnessing its approved target identity
- **THEN** Red does not advance and the candidate enters typed artifact correction or verification-contract review

#### Scenario: Task Red contract is invalid

- **WHEN** separate evidence proves the approved verification cannot witness the approved behavior under the current contract
- **THEN** the run becomes approval-needed for a verification-contract revision without consuming artifact-correction policy

#### Scenario: AGENTS checkpoint is required

- **WHEN** cumulative task work declares an approved AGENTS impact
- **THEN** the parent-owned managed-only checkpoint and its verification must succeed in the private change workspace before final application eligibility

#### Scenario: Terminal task is replayed

- **WHEN** a valid command replays a completed, discarded, or deterministically rejected run fact
- **THEN** the control plane returns that committed terminal fact idempotently without launching a child or mutating the workspace

#### Scenario: Implementation completes

- **WHEN** every task, output, affected verification, full-suite comparison, AGENTS checkpoint, final application, and required post-apply check succeeds
- **THEN** the run becomes completed, cleans private change content, and reports no new failure relative to baseline

### Requirement: Safe package contents and independence

The package MUST NOT contain credentials, real `.env` files, virtual environments, backup files, user run data, child-session transcripts, model outputs, or symbolic links to external workflow, configuration, state, or reference-repository locations.
It MUST NOT load, import, link to, or reference as a runtime, development, test, packing, or installation dependency `/home/abelxiaoxing/work/AbelWorkflow`, `/home/abelxiaoxing/.agents/`, either reference-repository path, `@gotgenes/pi-subagents`, or another `@gotgenes/*` package.
Read-only implementation evidence citations and required third-party attribution or license text SHALL not constitute product resolution dependencies.
Its tarball SHALL contain package metadata, user documentation, license and attribution, four prompts, four skills, the private extension runtime, package-owned professional Agent definitions, and required runtime resources while excluding development indexes, tests, OpenSpec artifacts, toolchain configuration, credentials, and runtime state.

At runtime the package MAY create only the approved owner-private control-plane journal, sealed artifacts, and change workspace outside the package, project repository, and OpenSpec change root.
It MUST NOT persist raw prompts, hidden reasoning, complete child transcripts, raw model outputs, credentials, endpoint secrets, or environment values.
Completed and discarded runs SHALL clean their private code and artifact content idempotently; paused and approval-needed runs SHALL retain only the data authorized by the run-retention contract.

#### Scenario: Tarball is inspected

- **WHEN** the real package tarball is created for validation
- **THEN** every required runtime, documentation, license, attribution, Prompt, Skill, extension, and Agent file is present while prohibited development, secret, state, backup, virtual-environment, and external-link paths are absent

#### Scenario: Global deployment files are absent

- **WHEN** the package is loaded without machine-local deployment configuration
- **THEN** no package resource resolves through `/home/abelxiaoxing/.agents/`

#### Scenario: Forbidden workflow checkout is absent

- **WHEN** the package is built, packed, installed, or loaded without the reference workflow checkouts
- **THEN** no supported resource resolves through those external locations

#### Scenario: Reference attribution remains self-contained

- **WHEN** the standalone package includes attribution or license material for adapted reference code
- **THEN** that material is packaged locally and does not require a reference checkout at runtime or during validation

#### Scenario: Paused run state is inspected

- **WHEN** an eligible Abel run is paused
- **THEN** its approved private journal and change workspace exist only in the owner-private runtime location and contain no credential, raw prompt, or raw child transcript

#### Scenario: Finished run state is inspected

- **WHEN** a run completes or is explicitly discarded and cleanup settles
- **THEN** no private code workspace, sealed candidate, child transcript, raw model output, queue, or retry ledger for that run remains in package or repository locations

#### Scenario: Delegation leaves no private state files

- **WHEN** a run completes or is discarded and recoverable cleanup finishes
- **THEN** delegation leaves no private-runtime-created code workspace, sealed result, child transcript, model output, queue, schedule, or task ledger for that run in package, project, or OpenSpec locations
