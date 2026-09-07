# private-agent-orchestration Specification

## Purpose
Provide workflow-owned professional Agent registration and a small bounded in-memory delegation kernel so Abel stages can use specialized read-only Workers without an external Subagent package.
## Requirements
### Requirement: Bounded read-only requests

Every dispatch request SHALL identify its eligible stage, package-owned role, packet or task identifier, bounded path scope, relevant AGENTS and approved-contract context, declared read and write sets where applicable, output contract, and cancellation signal.
Professional Agents SHALL receive only package-scoped `read`, `grep`, `find`, and `ls` capabilities plus one structural final-submission tool.
They MUST NOT receive shell, editing, Git, arbitrary extension, network-research, validation-command, or persistent-state capabilities.
An empty request, unknown role, missing bound, path escape, symbolic-link escape, or requested mutation SHALL fail before or during execution without changing repository state.

#### Scenario: Read-only evidence request is dispatched

- **WHEN** Design or Diagnose dispatches a valid bounded evidence packet
- **THEN** the selected Agent can inspect only the permitted scope and return evidence without workspace mutation

#### Scenario: Structured-patch request is dispatched

- **WHEN** Implement dispatches a valid bounded task phase
- **THEN** the Worker returns exact structured file operations without authoring diff hunks, editing the workspace, or running validation

#### Scenario: Request is structurally invalid

- **WHEN** a request is empty or omits a valid stage, role, identifier, path bound, or output contract
- **THEN** it is rejected before an Agent run starts and no workflow state advances

#### Scenario: Read scope escape is attempted

- **WHEN** an Agent requests an absolute, parent-traversal, out-of-scope, or symlink-escaping path
- **THEN** the scoped tool rejects that request without returning escaped content or mutating state

#### Scenario: Mutation or command is attempted

- **WHEN** a professional Agent attempts to write, execute a command, change Git, use an undeclared tool, or alter a persistent resource
- **THEN** the attempt fails closed and no mutation is applied

### Requirement: Private workflow control surface

The package SHALL load one private orchestration extension and three immutable package-owned professional Agent definitions for Design exploration, implementation, and diagnosis.
It SHALL register one private Abel control tool but keep it inactive outside a verified `abel-design`, `abel-implement`, or `abel-diagnose` invocation; `abel-init` and ordinary prompts SHALL NOT activate it.
The stage-specific tool schema SHALL expose only the closed change-oriented `start`, `status`, `resume`, `rebind`, `cancel`, and `discard` commands during Implement; one closed Design action family plus bounded evidence-packet operations during Design; and bounded packet operations during Diagnose. All three stages SHALL additionally accept the exact session-exit envelope `{"action":"finish"}` without extending the durable command union. Exit SHALL await active-operation settlement before restoring ordinary tools and SHALL retain paused work; malformed or mixed exit envelopes SHALL fail closed. At the Implement tool boundary, provider-required padding for known fields owned by another command SHALL be projected away and nullable absent fields SHALL be canonicalized before exact command validation; unknown fields and malformed fields owned by the selected command SHALL still be rejected before durable-engine execution or state mutation.
A Design start SHALL accept either a unique change name or a transient raw requirement and return an immutable run id used by every later Design action; an Implement start SHALL accept a unique change name. Gate-approved delivery revisions SHALL bind to rather than replace the owning run. Callers SHALL NOT construct provisional hashes, contract hashes, graph admissions, phase snapshots, retained candidate identities, or stable task boundaries.
Stage finish, replacement, reload, session replacement, or shutdown SHALL deactivate the tool and interrupt active operations while preserving a resumable durable run unless it completed or was explicitly discarded.
The package SHALL expose no general Subagent command, public orchestration API, cross-extension service, external Agent override, or public raw run-store access.

#### Scenario: Eligible stage activates control

- **WHEN** a verified Design, Implement, or Diagnose prompt begins
- **THEN** the extension activates the private control tool and, for Design only, enforces its separately specified read-only parent-tool boundary

#### Scenario: Ordinary prompt inspects tools

- **WHEN** no eligible Abel stage is active
- **THEN** the private control tool is inactive and no public workflow-run API or Agent override is exposed

#### Scenario: Parent submits graph mechanics

- **WHEN** a Design or Implement caller attempts to supply a protocol version, graph hash, dynamic snapshot, launch identity, or stable task boundary
- **THEN** the operation is rejected before run mutation because those facts belong to the control plane

#### Scenario: Strict provider pads an Implement command

- **WHEN** constrained sampling supplies every flat-schema property and represents fields absent from the selected Implement command with values or `null`
- **THEN** the tool boundary projects only known non-selected-command fields, canonicalizes absent optional resume fields, preserves unknown or selected-command fields for exact validation, and dispatches no malformed command

#### Scenario: Stage ends with paused work

- **WHEN** an eligible stage session ends while its run is paused or interrupted
- **THEN** active children are disposed and tool activation is removed while the durable run remains available to a later verified resume

### Requirement: Sealed structured artifact delivery

Design and diagnosis Agents SHALL return structured evidence with originating identity, bounded scope, concise claims, exact citations, constraints, dependencies, risks, open questions, and implementation-boundary hints.
The authoring tool MAY complete omitted code-owned identity and advisory fields before strict result validation; explicit incorrect values SHALL be rejected, and citations, constraints, risks and open questions SHALL remain explicit.
Implementation Workers SHALL make one terminal submission containing either a complete ordered structured patch or a typed request for context, task reshaping, or capacity handling.
Context refs SHALL distinguish requested paths with read or write access, source citations with path and line, and contract or diagnostic refs; only normalized requested paths SHALL participate in path-boundary computation.
One structurally rejected submission MAY be corrected once inside the same disposable child session; a second rejection SHALL end that session, and only one accepted terminal result may survive.
The trusted submit tool SHALL bind that submission to one originating run, task, phase, Worker attempt, approved path set, and isolated snapshot; validate exact replacements, rewrites, creates, and deletions against the isolated workspace and approved phase boundary; generate the unified diff; and own internal chunking, byte limits, hashing, and atomic sealing. The Worker SHALL NOT supply diff headers or hunks, sequence, byte-count, encoding, hash, or separate seal metadata.
A Worker SHALL NOT select approval-needed, an approval code, a workflow Gate result, approve authority, apply a candidate, or declare verification success. Boundary-review-needed SHALL remain a trusted control-plane classification rather than a Worker-selectable string.
AGENTS context SHALL be classified against the sealed AGENTS contract independently of ordinary path declarations, and no Worker context request or ordinary write set SHALL grant AGENTS write authority.
Delivery MUST NOT expose hidden reasoning, a child transcript, tool-call history, credential, or unfiltered raw logs in public outcomes.
Capacity exhaustion SHALL pause or request approved task reshaping and SHALL NOT yield a truncated candidate or terminally destroy the task.

#### Scenario: Evidence packet succeeds

- **WHEN** an evidence Agent completes a bounded packet
- **THEN** the parent receives the required structured claims and exact citations without the child conversation or tool trace

#### Scenario: Candidate is sealed

- **WHEN** one identity-consistent complete structured patch compiles within its byte and approved-path bounds
- **THEN** the control plane seals one immutable candidate artifact that may enter parent-owned validation

#### Scenario: Candidate remains incomplete

- **WHEN** a Worker stops before a candidate is completely sealed
- **THEN** no partial bytes can be applied or treated as a candidate and the task remains resumable from its last committed checkpoint

#### Scenario: Worker needs more context

- **WHEN** a Worker cannot safely produce an approved candidate from its supplied context
- **THEN** it returns typed requested-path, source-citation, and diagnostic facts and the control plane either supplies already approved facts or pauses without inventing authority or trusting a Worker-selected approval category

#### Scenario: Context refs mix citations and diagnostics

- **WHEN** a context request includes `tests/file.test.mjs:209`, `phase-contract.writeSet`, and one requested path
- **THEN** the control plane treats the first as a source citation, the second as a contract diagnostic, and computes authority only from the normalized requested path

#### Scenario: Worker requests an AGENTS write

- **WHEN** a Worker reports that an AGENTS path needs mutation
- **THEN** the control plane denies Worker write authority and either retains the parent-owned sealed AGENTS operation or requires an AGENTS-contract approval without adding that path to the ordinary Worker write set

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
The canonical Implement plan SHALL seal `artifactCorrection.maxAttempts` as 2 or 3 automatic recovery attempts per verification obligation and phase, including the initial attempt. Typed artifact, stale-candidate, and verification rejection SHALL consume this shared durable counter; another operation id SHALL NOT reset exhaustion. The next Worker SHALL receive structured recovery feedback. Operation ids, route replacement, rollback lineage, task renaming, and contract rewording SHALL NOT replenish an exhausted verification obligation. Dedicated private recovery facts and a run-wide pre-reserved work budget SHALL bound retries across process restart. Workers MAY read their task phase paths and request ordinary regular files inside sealed task roots; dynamically granted reads SHALL remain bound to merge, retained evidence, and final currentness. Phase write/delete authority remains unchanged.
Each failure SHALL retain its safe closed code, stage, policy class, attempt count, and legal continuation without exposing endpoint secrets, prompts, code excerpts, or raw model output in public outcomes.
Automatic policy exhaustion SHALL pause the affected task rather than terminally block it. The parent MAY explicitly grant one additional attempt against a current incident and failure sequence while retaining all consumed work. Environment, report protocol and resource failures SHALL remain unavailable verification and SHALL NOT become product failure baselines.
Cancellation SHALL interrupt the active operation without consuming an automatic retry or accepting partial output.
An environment or endpoint failure SHALL permit resume after capability recovery.
An approved route-policy change or explicit rebind SHALL permit a replacement Worker to continue from the structured task ledger without changing the approved task contract.
An approval-boundary gap SHALL become approval-needed and SHALL never authorize spontaneous scope expansion.

#### Scenario: Connection deadline expires

- **WHEN** a configured route does not connect within its bounded connection policy
- **THEN** the control plane records a transport attempt, selects another already allowed route when policy permits, or pauses with an explicit continuation

#### Scenario: Automatic attempts are exhausted

- **WHEN** one policy class reaches its automatic attempt bound
- **THEN** the task pauses with final evidence; shared artifact/stale/verification exhaustion survives restart and unchanged resume, while transport and parent-checkpoint policies remain separate

#### Scenario: Replacement Worker resumes

- **WHEN** the user or approved route policy rebinds a paused task to a compatible Worker
- **THEN** the next attempt receives the same approved boundary and committed ledger and the former Provider identity is not treated as a protocol mismatch

#### Scenario: Result capacity is insufficient

- **WHEN** a complete candidate cannot fit one configured result envelope
- **THEN** the trusted submit tool may internally chunk and seal one complete artifact or the task pauses for approved reshaping, and no truncated artifact is accepted

#### Scenario: Estimated capacity exceeds an available route

- **WHEN** an authorized healthy route meets the 16,000 context and 8,000 output hard minima but falls below the task's heuristic estimate
- **THEN** it remains eligible as a fallback or explicit rebind; automatic selection prefers routes meeting the estimate, preserving declared order within each preference tier and all health and retry bounds


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
Private child conversations, Provider request objects, live Scheduler promises, AbortControllers, and active UI widgets SHALL remain process-local and disposable.
Each child execution SHALL use a Cadence-owned explicit model/tool loop with package-owned prompts, no external resource discovery, disabled Provider-managed retry, and cancellation forwarded through authentication, requests, tool execution, and private conversation disposal.
The loop SHALL NOT create a Pi AgentSession, replace Agent termination hooks, or depend on session-event history ordering. It SHALL execute only tool calls from complete normal responses, count structural attempts before argument validation, allow at most one missing-submit reminder, and retain the original deadline.
Inherited Provider requests SHALL snapshot the effective Provider, selected model, and fresh authentication for the admitted attempt without mutating the host registry, requiring a parent request, or capturing host-session payload callbacks.
Provider-owned stream behavior and model configuration SHALL remain effective; host-session request callbacks SHALL NOT be implicitly inherited. Custom endpoint requests SHALL use only their selected configured route behavior. Output bounds SHALL follow the declared model/Provider contract without implicit payload cap removal.
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
- **THEN** activity displays recovering when a parent-owned automatic continuation is available, retaining the safe boundary code and keeping the underlying Gate requirement inspectable

#### Scenario: Tool call returns a paused outcome

- **WHEN** the owning Tool invocation settles while the durable run remains paused
- **THEN** re-rendering preserves paused state rather than converting Tool settlement into workflow completion

#### Scenario: Non-TUI status is requested

- **WHEN** print, JSON, or RPC mode requests status
- **THEN** it receives the same semantic state and legal commands without presentation-only fields or network activity

### Requirement: Control-plane domain outcomes and Tool errors

The private extension SHALL return valid domain outcomes normally for run-created, run-resumed, route-rebound, status, queued, connecting, candidate-sealed, candidate-rejected, phase-committed, retryable, paused, approval-needed, verifying, applying, recovering, completed, operation-cancelled, discarded, and rejected operations.
Recoverable, paused, approval-needed, verification-failed, and operation-cancelled outcomes SHALL NOT be Pi Tool errors merely because the run did not complete.
Unknown actions, invalid command or packet schemas, incompatible run identity, illegal state transitions, forged mechanical identities, missing retained artifacts, journal integrity failure at mutation time, and internal invariant violations SHALL throw so Pi reports a real Tool error.
The extension SHALL NOT synthesize an `isError` flag inside a normal domain payload as a substitute for throwing.
TUI presentation SHALL NOT change domain or Tool-error classification.

#### Scenario: Run pauses normally

- **WHEN** a valid operation produces a typed recoverable pause
- **THEN** Pi receives a normal Tool result containing the pause state and legal commands

#### Scenario: Operation is cancelled

- **WHEN** cancellation interrupts a valid active operation
- **THEN** Pi receives a normal operation-cancelled result and the run remains at its last resumable checkpoint

#### Scenario: Protocol request is invalid

- **WHEN** a request violates the active stage schema, run identity, transition, or artifact binding
- **THEN** the extension throws and Pi reports a real Tool error before unauthorized state mutation

#### Scenario: Internal invariant fails

- **WHEN** the control plane encounters an impossible or unclassified internal state
- **THEN** the exception propagates as a Tool error without keyword-based domain classification

### Requirement: Run-bound durable Design evidence

Every Design evidence packet SHALL bind the durable Design run that requested it. Only a structurally valid, in-scope result accepted by the parent SHALL be recorded as a bounded evidence fact; packet failure SHALL record no trusted evidence. Repeating the same packet identity with the same result SHALL be idempotent, while a conflicting result for that identity SHALL fail closed. Status after process or session replacement SHALL expose the accepted evidence identities and hashes without depending on a child session.

#### Scenario: Evidence survives a restart

- **WHEN** an accepted Design packet completes and the host process restarts
- **THEN** Design status for the bound run exposes the same accepted evidence fact without rerunning the child

#### Scenario: Packet targets another run

- **WHEN** a Design packet supplies an absent, non-Design, or different-root run identity
- **THEN** the packet is rejected before trusted evidence is recorded

#### Scenario: Evidence replay conflicts

- **WHEN** an existing packet identity is submitted with different structured evidence
- **THEN** the new result is rejected and the original durable fact remains unchanged

### Requirement: Minimal durable Design control data

The private journal SHALL retain only normalized Design evidence, decision records, Gate approvals, compiled-plan identity, idempotent operation outcomes, and hashes needed for recovery. Raw requirement text and transient decision or Gate contract text SHALL be normalized and hashed in-process and MUST NOT be persisted. The journal also MUST NOT retain raw prompts, hidden reasoning, child transcripts, credentials, environment values, or unfiltered model output.

#### Scenario: Design state is inspected

- **WHEN** a Design run is resumed in a fresh context
- **THEN** status exposes bounded evidence, latest decisions, current Gate proofs, and compiled-plan identity but none of the prohibited raw data

### Requirement: Enforced parent Design tool boundary

During a verified Design stage, the parent SHALL receive only the package's read-only workspace tools and `abel_dispatch`; previously active write-capable or unknown tools SHALL be unavailable to the model. The extension SHALL restore the exact pre-Design non-dispatch tool set when Design completes, explicitly finishes, switches to another verified stage, or the session shuts down. Tool isolation SHALL NOT affect Implement or Diagnose activation.

#### Scenario: Design starts with write tools active

- **WHEN** a verified Design invocation begins while shell, edit, write, or an unknown tool is active
- **THEN** those tools are removed for Design while read, grep, find, ls when previously active, and `abel_dispatch` remain available

#### Scenario: Design exits

- **WHEN** Design finalizes, explicitly finishes, switches to Implement or Diagnose, or the session ends
- **THEN** the exact pre-Design non-dispatch tool set is restored and only the stage-owned dispatcher lifecycle is changed

### Requirement: Safe private Design artifact mutation

The Design control surface SHALL provide code-owned write and delete operations only for the active run's OpenSpec change artifacts. It SHALL accept bounded UTF-8 content and safe relative paths limited to the change metadata, proposal, design, tasks, delta specs, and fixed plan draft; it SHALL create safe missing directories atomically, reject symlink components, and forbid product files plus code-owned Gate, ready, and compiled-plan artifacts. Operation replay SHALL be idempotent and conflicting reuse SHALL fail closed.

#### Scenario: Parent writes a Design artifact

- **WHEN** the active Design run writes an allowed proposal, design, tasks, delta spec, metadata, or plan-draft path through private control
- **THEN** the exact bytes are installed beneath that run's change root and a bounded hash outcome is recorded

#### Scenario: Parent targets product code

- **WHEN** the Design write operation targets a path outside its change root or a reserved Gate, ready, or compiled-plan file
- **THEN** the operation is rejected before any filesystem mutation

#### Scenario: Parent deletes an obsolete delta spec

- **WHEN** the active Design run requests deletion of an allowed existing delta-spec file
- **THEN** only that safe regular file is removed, operation replay is idempotent, and no parent directory or unrelated artifact is removed

### Requirement: Bound context discovery

A Worker MAY request additional ordinary regular-file reads within sealed task roots. The parent SHALL persist exact admitted paths, exclude hidden and private-key files from this automatic expansion, supply them to subsequent attempts, and bind them to candidate merge, retained evidence checks, and final application currentness. This permission SHALL NOT expand write or delete authority.

#### Scenario: A supporting file was omitted from the task

- **WHEN** a Worker requests an ordinary supporting read inside the sealed root
- **THEN** the next attempt receives its exact read capability without a new user decision

#### Scenario: Discovered context changes in the main workspace

- **WHEN** the user changes a dynamically admitted supporting file before final application
- **THEN** currentness validation pauses application and preserves the user's changes

### Requirement: Isolated verification runtime

The verifier SHALL provide private HOME and tool caches while protecting consumer dependencies. Vitest SHALL use a fresh bounded report file independently of bounded diagnostic logs. Environment, resource and report protocol failures SHALL NOT count as product failures. Approved package scripts SHALL execute intact through the package manager with their manifest, lockfile and configuration inputs bound to currentness.

#### Scenario: A normal package manager project runs tests

- **WHEN** an npm project uses a normal Vitest configuration and emits configuration logs
- **THEN** verification runs with private HOME and writable Vite caches, validates its independent report, and leaves consumer dependencies unchanged

#### Scenario: Logs and reports exceed the old output threshold

- **WHEN** tests emit more than the log capture budget or a valid report larger than 1 MiB
- **THEN** logs are truncated without stopping execution and the report is evaluated under its separate bounded limit

#### Scenario: Verification cannot produce valid evidence

- **WHEN** a report is missing, unsafe, malformed, contradictory or oversized
- **THEN** verification pauses as unavailable without recording a product failure or launching speculative product repair

#### Scenario: Approved scripts contain shell composition

- **WHEN** a bound package script uses quotes, variables, hooks or chained commands
- **THEN** the package manager executes the original script inside isolation and later input drift invalidates the capability

#### Scenario: A candidate changes an authorized configuration file

- **WHEN** a candidate changes a manifest or configuration path already writable by the admitted plan
- **THEN** isolated verification permits that planned change while checking the exact approved entry command and currentness of the actual invocation; admission and undeclared paths retain their bound hashes

#### Scenario: Configuration contains harmless documentation

- **WHEN** a package manager configuration contains comments or ordinary values mentioning tokens or shell settings
- **THEN** those words do not block verification; effective unsupported credential and host-execution directives remain rejected

#### Scenario: A Red witness falls outside retained diagnostic logs

- **WHEN** a non-Vitest verifier emits its expected Red witness between large log segments or across output chunks
- **THEN** bounded stream matching preserves the witness independently of displayed logs without synthesizing a witness by concatenating the retained head and tail

#### Scenario: Failure sets exceed presentation limits

- **WHEN** baseline and current verification contain more than 256 failure identities, including enough to exceed ledger projection limits
- **THEN** complete baseline evidence is retained as an integrity-checked private artifact across restart, attribution compares complete sets, and only introduced-failure feedback and public summaries are bounded to 256 identities

#### Scenario: Equivalent verification contracts have different display identities

- **WHEN** baseline and current non-Vitest contracts execute the same command and arguments under different display identifiers
- **THEN** unchanged failure evidence has the same identity; distinct runners, commands or arguments remain distinct, and evidence under an older runtime policy is revalidated before reuse

### Requirement: Verification environment identity

Verification SHALL bind installed dependency bytes and runner identity in addition to repository inputs. Identity collection SHALL be bounded, cancellable and outside the parent event loop for dependency trees. A changed environment SHALL invalidate retained baseline and phase-policy evidence; unavailable or drifting environments SHALL not supply product failure evidence. Disposable tool caches SHALL not change identity.

#### Scenario: Installed runner or dependency changes

- **WHEN** installed executable or transitive dependency bytes change without changing the lockfile
- **THEN** currentness fails and old verification evidence cannot be reused as current

#### Scenario: A run resumes in a different environment

- **WHEN** a retained run reopens with a changed installed environment
- **THEN** it rebuilds the baseline and revalidates retained phases while reusing compatible sealed candidates

#### Scenario: Final application resumes after environment drift

- **WHEN** final apply is interrupted and its host reopens with a different verification environment
- **THEN** the retained transaction rejects old evidence, safely rolls back and allows a later resume to revalidate before a new application
