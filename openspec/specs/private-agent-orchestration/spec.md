# private-agent-orchestration Specification

## Purpose
Provide workflow-owned professional Agent registration and a small bounded in-memory delegation kernel so Abel stages can use specialized read-only Workers without an external Subagent package.

## Requirements

### Requirement: Private workflow-only Agent surface

The package SHALL load one private orchestration extension and four immutable package-owned professional Agent definitions for Design exploration, contract review, implementation, and diagnosis.
It SHALL register `abel_dispatch` but keep that tool inactive by default.
Only a verified invocation of `abel-design`, `abel-implement`, or `abel-diagnose` SHALL activate it; `abel-init` and ordinary non-Abel prompts SHALL NOT.
Stage finish, cancellation, replacement, reload, session replacement, or shutdown SHALL remove `abel_dispatch` from the active set while preserving unrelated active tools.
The package SHALL expose no general Subagent command, supported public orchestration API, cross-extension service, or external Agent override mechanism and MUST NOT depend on an `@gotgenes/*` package.

#### Scenario: Package load registers an inactive dispatcher

- **WHEN** Pi loads the package outside an eligible Abel stage
- **THEN** `abel_dispatch` appears in the registered tool catalogue but not in the active tool set

#### Scenario: Eligible Abel stage activates dispatch

- **WHEN** a verified Design, Implement, or Diagnose prompt begins
- **THEN** the extension adds `abel_dispatch` to the active tools without removing another extension's or built-in tool

#### Scenario: Init does not activate dispatch

- **WHEN** `abel-init` runs
- **THEN** `abel_dispatch` remains inactive

#### Scenario: Stage cleanup restores inactive state

- **WHEN** an eligible stage finishes, is cancelled or replaced, or its extension reloads or shuts down
- **THEN** active and queued work is drained and `abel_dispatch` is inactive while unrelated tool activation is preserved

#### Scenario: External Agent has the same name

- **WHEN** a user or project supplies an Agent definition matching a package-owned role name
- **THEN** Abel uses the immutable package-owned definition and does not load the external definition

#### Scenario: General orchestration surface is inspected

- **WHEN** a user or another extension inspects supported commands, exports, and services
- **THEN** it finds no general Subagent command, supported public orchestration API, or cross-extension orchestration service

### Requirement: Bounded read-only requests

Every dispatch request SHALL identify its eligible stage, package-owned role, packet or task identifier, bounded path scope, relevant AGENTS and approved-contract context, declared read and write sets where applicable, output contract, and cancellation signal.
Professional Agents SHALL receive only package-scoped `read`, `grep`, `find`, and `ls` capabilities plus one structural final-submission tool.
They MUST NOT receive shell, editing, Git, arbitrary extension, network-research, validation-command, or persistent-state capabilities.
An empty request, unknown role, missing bound, path escape, symbolic-link escape, or requested mutation SHALL fail before or during execution without changing repository state.

#### Scenario: Read-only evidence request is dispatched

- **WHEN** Design or Diagnose dispatches a valid bounded evidence packet
- **THEN** the selected Agent can inspect only the permitted scope and return evidence without workspace mutation

#### Scenario: Diff-generation request is dispatched

- **WHEN** Implement or Diagnose dispatches a valid bounded task phase
- **THEN** the Worker returns proposed text without editing the workspace or running validation

#### Scenario: Request is structurally invalid

- **WHEN** a request is empty or omits a valid stage, role, identifier, path bound, or output contract
- **THEN** it is rejected before an Agent run starts and no workflow state advances

#### Scenario: Read scope escape is attempted

- **WHEN** an Agent requests an absolute, parent-traversal, out-of-scope, or symlink-escaping path
- **THEN** the scoped tool rejects that request without returning escaped content or mutating state

#### Scenario: Mutation or command is attempted

- **WHEN** a professional Agent attempts to write, execute a command, change Git, use an undeclared tool, or alter a persistent resource
- **THEN** the attempt fails closed and no mutation is applied

### Requirement: Compact structured delivery

Design and review Agents SHALL return a structured evidence object containing request identity and scope, concise conclusions, exact file-and-line citations, constraints and dependencies, risks, blocking questions, and write-set, verification, and AGENTS-impact hints.
Implement and Diagnose Workers SHALL return task and phase identity, concise summary, contract-compliance statement, complete unified diff, expected verification result, and risks or blockers.
Worker results SHALL NOT contain a recommended next workflow step or another control field that selects parent recovery.
A successful result MUST come through the structural final-submission tool, match its originating request identity, and satisfy its schema and configured complete-result size limit.
Delivery MUST NOT expose hidden reasoning, a child transcript, tool-call history, or unfiltered raw logs.
A unified diff MUST be complete and MUST NOT be truncated or reconstructed from a summary.
An oversized result SHALL be a terminal typed task failure and SHALL NOT produce a partial result or Design-routing instruction.

In interactive TUI mode, each valid Subagent run SHALL additionally provide a compact inline activity presentation containing its package-owned role, request identifier, phase, single-line objective summary, elapsed time, and current or terminal state.
The inline state vocabulary SHALL distinguish queued, running, completed, failed, cancelled, and timed-out runs.
A failed inline presentation SHALL include a sanitized, width-bounded single-line reason without exposing Provider or model identity, accessed paths, or terminal control sequences.
Every inline presentation line SHALL remain within the available terminal width.
Expanded successful presentation SHALL expose only a compact evidence-count summary or compact diff summary and risk count; it MUST NOT expose a next-step field, complete diff, or complete citations through the display layer.

#### Scenario: Structured evidence succeeds

- **WHEN** an evidence Agent completes a bounded packet
- **THEN** the parent receives the required compact fields and exact citations without the child conversation or tool trace

#### Scenario: Complete diff delivery succeeds

- **WHEN** an Implement or Diagnose Worker completes an approved phase
- **THEN** the parent receives candidate facts and the complete unified diff without a Worker-selected recovery or workflow step

#### Scenario: Result schema is invalid

- **WHEN** a result misses required fields, contradicts its request identity, bypasses structural submission, includes a forbidden control field, or contains an invalid diff
- **THEN** the parent treats it as untrusted and neither applies a patch nor advances workflow state

#### Scenario: Complete result exceeds its limit

- **WHEN** a Worker cannot submit its complete diff within the configured complete-result size limit
- **THEN** the task terminally blocks with a typed result-limit failure and no partial result or stage-routing instruction is usable

#### Scenario: Interactive run is visibly delegated

- **WHEN** a valid Subagent request is queued or running in interactive TUI mode
- **THEN** its inline tool presentation identifies the role, request, phase, objective summary, elapsed time, and queued or running state

#### Scenario: Interactive run reaches a terminal state

- **WHEN** a visible Subagent run completes, fails, is cancelled, or reaches its phase timeout
- **THEN** its inline tool presentation retains the corresponding completed, failed, cancelled, or timed-out terminal state

#### Scenario: Interactive run fails with an unsafe reason

- **WHEN** a failed Subagent reason contains multiple lines, terminal controls, Provider or model identity, or accessed paths
- **THEN** the inline presentation shows a sanitized single-line reason within the available width without exposing those values

#### Scenario: Successful result is expanded

- **WHEN** a user expands a completed Subagent tool result
- **THEN** the display shows a compact evidence count or diff summary and risk count without next-step metadata, complete citations, or the complete diff

### Requirement: Parent-owned review application and validation

The parent Agent SHALL exclusively own Gate decisions, candidate acceptance and typed rejection, patch review and application, command execution, validation classification, AGENTS index changes, and task completion tracking.
A trusted candidate SHALL be retained only in process memory and SHALL bind its result identifier, stage, canonical root, change, task, originating request, phase, launch, exact paths, approved dependencies, and current snapshot.
Implement apply and discard operations SHALL identify the current operation request without restating candidate identity or the stable task boundary; the runtime SHALL resolve and verify retained identity itself.
An artifact discard MAY provide bounded correction evidence but SHALL NOT change scope, verification, dependencies, or other stable boundary facts.

Before application, the parent-owned runtime SHALL verify retained identity, exact phase path bounds, approved dependency changes, complete-diff consumption, current snapshot, source and test loadability, approved phase verification identity, and ordinary Git checkability in isolation from the main workspace.
It SHALL apply exactly the retained unified diff with ordinary all-or-nothing Git application and MUST NOT use reject fragments, reconstruct Worker semantics, or implement a private rollback platform.
Preflight, ordinary Git, and AGENTS-checkpoint producers SHALL return closed typed success or failure values without encoding control classes into free-form error strings.
An unknown exception SHALL propagate as an internal error rather than being classified by regular expression or keyword.
For an applied phase, the parent SHALL return compact validation evidence containing the approved command identifier, exit code, expected classification, normalized failure identity, expected-reason match, and minimum output excerpt.

#### Scenario: Parent accepts a current result

- **WHEN** a retained candidate passes identity, exact-path, dependency, snapshot, complete-diff, loadability, verification-identity, and ordinary Git checks
- **THEN** the runtime may apply exactly that diff and advance only from the resulting Runtime-owned apply fact

#### Scenario: Typed preflight rejects a candidate

- **WHEN** isolated preflight returns an artifact, stale, environment, approval-boundary, cancellation, or result-limit failure
- **THEN** the runtime branches exhaustively on the typed value without parsing free-form text and applies none of the candidate

#### Scenario: Patch check or application fails

- **WHEN** ordinary Git screening or exact application rejects the retained candidate
- **THEN** no phase, AGENTS checkpoint, or tracked task advances and the runtime returns the producer's typed failure

#### Scenario: Worker output is untrusted

- **WHEN** output is invalid, out of scope, inconsistent with the approved boundary, truncated, stale, or bound to another identity
- **THEN** the parent applies none of it and does not silently author replacement semantic content

#### Scenario: Caller restates retained identity

- **WHEN** an Implement apply or discard operation attempts to override stage, root, change, task, phase, launch, scope, or verification facts
- **THEN** the request fails before candidate application and task state does not advance

#### Scenario: Parent returns validation evidence

- **WHEN** an accepted phase's approved command completes
- **THEN** later parent processing receives compact normalized evidence rather than a raw command log or child transcript

#### Scenario: Non-text task is approved

- **WHEN** approved work cannot be represented by an ordinary textual unified diff
- **THEN** the technical contract must define an exact deterministic parent-mechanical task and a Worker does not improvise it

### Requirement: File-snapshot-aware bounded concurrency

The dispatcher SHALL register each Implement task's complete immutable boundary before awaiting a child or Scheduler admission and SHALL retain one task record containing stable identity, phase-local scope, conflict declaration, and current state.
The first task request SHALL be Red and later phase attempts SHALL contain only dynamic operation identity and a fresh approved snapshot.
The dispatcher SHALL reject duplicate task opens, invalid phase transitions, stable identity changes, repeated set members, duplicate roots, and overlapping root ancestry before a child launch.

The runtime SHALL derive a task-lifetime conflict declaration from the union of every approved phase read and exact write path, explicit conflict edge, resource, verification lock, and non-none parent-owned AGENTS target.
It SHALL compare a new open with every registered nonterminal task before Scheduler queueing.
A conflict SHALL return immediate deferral without registration, queueing, waiting, or launch consumption.
An admitted declaration SHALL remain active across phase gaps and candidate or checkpoint review and SHALL be released only at blocked, completed, or drain.
The Scheduler MAY serialize admitted attempts but SHALL NOT own the cross-invocation task lifetime.

Each completed candidate SHALL bind content hashes for every file actually read and every existing file it proposes to modify or delete and SHALL bind an explicit absent marker for every proposed new path.
The parent SHALL apply accepted candidates serially and compare only that candidate's bound files immediately before application.
A change outside those files SHALL NOT make the candidate stale.
A content or existence change to a bound read or write file SHALL make it stale and prohibit application.
Each Red, Green, and optional Refactor phase SHALL receive and return a fresh snapshot after the preceding accepted phase.

#### Scenario: Task boundary is admitted

- **WHEN** a valid first Red request has no task-lifetime conflict
- **THEN** the runtime atomically registers its task record before any await or child launch and submits only the Red attempt to the Scheduler

#### Scenario: Independent Design packets are ready

- **WHEN** multiple Design evidence packets have independent scopes and no ordered dependency
- **THEN** they may run concurrently within the existing package-wide limit without creating an Implement task record

#### Scenario: Compatible implementation tasks are ready

- **WHEN** multiple task opens have accepted prerequisites and compatible task-lifetime declarations
- **THEN** each may be admitted while their phase attempts remain subject to bounded Scheduler execution and serial parent application

#### Scenario: Duplicate task open is submitted

- **WHEN** a task identity already has a registered record and another open is submitted
- **THEN** the runtime rejects the duplicate as a protocol error without comparing or replacing the stored boundary

#### Scenario: Phase-local write scope is enforced

- **WHEN** a Red candidate writes a path approved only for Green or Refactor
- **THEN** the candidate is rejected even if the path belongs to the task's lifetime conflict union

#### Scenario: Declared tasks conflict

- **WHEN** a new task has a read/write, write/write, edge, resource, validation-lock, or AGENTS-target conflict with a registered nonterminal task
- **THEN** the runtime immediately defers the new open without queueing or consuming a launch

#### Scenario: Conflict persists between phases

- **WHEN** an admitted task waits for a later phase, candidate decision, or AGENTS checkpoint
- **THEN** its complete task-lifetime declaration continues to block conflicting opens

#### Scenario: Terminal task releases conflict

- **WHEN** a task becomes blocked or completed
- **THEN** its terminal record remains replayable but no longer participates in conflict admission

#### Scenario: Unrelated sibling change is applied

- **WHEN** one parallel candidate is applied and it changes no file bound by an independent sibling candidate
- **THEN** the sibling candidate remains current and may be reviewed without redispatch

#### Scenario: Bound file changed

- **WHEN** a file in a candidate's read or write snapshot changes content or existence before application
- **THEN** the parent rejects that candidate as stale and applies none of it

#### Scenario: Next phase begins after an accepted diff

- **WHEN** exact application advances a task to its next approved phase
- **THEN** the next attempt uses that phase's own scope, verification, and a fresh current snapshot without restating the stable boundary

### Requirement: Single mechanical redispatch and branch isolation

Provider-managed retry SHALL remain disabled with `maxRetries: 0`, and the private runtime SHALL implement no cooldown, circuit breaker, hidden request retry, waiting resume, or partial-result path.
Each Implement phase SHALL allow at most two non-cancelled child launches shared by transport failure, stale refresh, and generated-artifact correction.
After the first eligible transport failure the runtime MAY redispatch the identical phase within the same invocation; after the first eligible stale or artifact failure it MAY accept one later phase attempt with only refreshed dynamic facts or bounded artifact evidence.
A second eligible failure SHALL terminally block the task as attempts exhausted and SHALL NOT start a third child.
Cancellation SHALL not consume a launch or become a blocker.
An oversized child result, environment failure, or approval-boundary failure SHALL terminally block the current task without partial application or stage-routing metadata.

Generated implementation artifacts SHALL NOT be trusted or applied until parent-owned isolated preflight proves complete-diff consumption, current snapshot and exact phase-path conformance, source and test loadability, and the approved phase verification identity.
Syntax, import/load, no-test, wrong-command, malformed-diff, wrong-Red-identity, and unexpectedly passing Red candidates SHALL be typed artifact failures rather than target Red or approval-boundary failures.
Artifact correction evidence SHALL be bounded and SHALL NOT alter the immutable task boundary.

An approval-boundary failure SHALL use a closed code for an unapproved dependency, insufficient behavior or architecture contract, insufficient task scope, insufficient verification contract, or insufficient AGENTS contract.
The runtime SHALL stop only the current task, preserve accepted independent sibling candidates, and SHALL NOT claim authority over parent-owned dependent successors, recommend another workflow, or select a user recovery action.

#### Scenario: First request fails within an unchanged contract

- **WHEN** the first non-cancelled child launch fails in transport and the approved phase is unchanged
- **THEN** the runtime may make one identical redispatch within the same invocation

#### Scenario: First stale candidate occurs

- **WHEN** the first non-cancelled launch produces a candidate whose bound snapshot becomes stale
- **THEN** the runtime may accept one later attempt for the same phase with only refreshed dynamic snapshot facts

#### Scenario: First artifact rejection occurs

- **WHEN** the first non-cancelled launch produces a typed generated-artifact failure
- **THEN** the runtime may accept one correction attempt with bounded evidence and the unchanged task boundary

#### Scenario: Mechanical redispatch fails again

- **WHEN** a second non-cancelled launch in one phase ends in transport, stale, or artifact failure
- **THEN** the current task terminally blocks as attempts exhausted with no third launch or partial candidate

#### Scenario: Candidate artifact passes structural submission but cannot load

- **WHEN** isolated preflight finds an unconsumed diff suffix, syntax or import/load failure, no target test, wrong command, wrong Red identity, or an unexpectedly passing Red
- **THEN** none of the candidate is applied and the typed artifact failure can consume only the phase's shared bounded launch

#### Scenario: Artifact correction budget is exhausted

- **WHEN** the second non-cancelled launch in a phase also produces a typed artifact failure
- **THEN** the current task terminally blocks as artifact attempts exhausted and no automatic workflow transition or third launch occurs

#### Scenario: Cancellation occurs

- **WHEN** a child launch or interruptible preflight is cancelled
- **THEN** the runtime preserves the task's current state and launch budget and returns cancelled without accepting partial output

#### Scenario: Complete result exceeds its limit

- **WHEN** a Worker cannot submit its complete candidate within the configured limit
- **THEN** the current task terminally blocks with a typed result-limit failure and no partial diff is usable

#### Scenario: Recovery would expand the contract

- **WHEN** continuing requires an unapproved dependency, behavior, architecture, path, conflict, resource, verification, or AGENTS contract
- **THEN** the runtime terminally blocks the current task with the matching approval-boundary code and performs no redispatch

#### Scenario: One parallel branch fails

- **WHEN** one concurrent task terminally blocks while an independent sibling candidate or completed task exists
- **THEN** the blocked task does not invalidate the independent sibling and the runtime makes no claim about parent-owned successor scheduling

#### Scenario: User cancels a batch

- **WHEN** the user cancels active delegation
- **THEN** active runs receive cancellation, queued Scheduler attempts do not start, partial outputs remain unusable, and independently accepted candidates remain available

### Requirement: Ephemeral bounded runtime lifecycle

The private Agent registry, Scheduler queue and runs, task records, conflict declarations, terminal facts, Worker sessions, retained candidates, parent payload bridge, and user-interface activity records SHALL exist only in the current Pi process memory.
Each task record SHALL pin the canonical workspace root, change and task identity, resolved Provider/model identity, immutable approved boundary, derived lifetime conflict, and current task state for its process lifetime.
The resolved Provider/model identity - inherited parent identity or the role's committed custom endpoint identity - SHALL be pinned at task admission and remain fixed across every phase launch for that task.
Ready, candidate-pending, AGENTS-checkpoint-pending, blocked, and completed SHALL be the complete Implement task-state vocabulary.
Blocked and completed states SHALL have no child, preflight, apply, budget-consuming, or reclassification transition; a valid terminal replay SHALL return the cached fact with the current operation request identity.

The runtime SHALL use one package-wide active-run limit, one batch-size limit, one phase timeout, one complete-result size limit, at most two non-cancelled child launches per phase, and at most two parent attempts for an AGENTS checkpoint.
It SHALL not implement role-specific budget tiers, context-percentage thresholds, scan-byte accounting, Worker lifetime ledgers, a persistent recovery platform, or waiting resume.
Each child session SHALL use an empty package-defined resource loader plus in-memory Session and Settings managers, with Provider retry disabled.
Each child Provider request SHALL either reuse the selected parent Provider's effective stream behavior and parent-session payload-transform callback when the resolved identity is inherited, or send directly to the role's committed custom endpoint with its configured credentials and dialect without the parent payload-transform callback when the resolved identity is a custom endpoint, while discovering no external resource.
For an `openai-responses` child, the final payload SHALL omit optional `max_output_tokens` after any applied payload-transform callback without substituting another child output-token cap.

Cancellation, timeout, completion, failure, stage finish, reload, session replacement, and shutdown SHALL dispose affected child sessions and clear queued or retained state as applicable.
Stage drain SHALL idempotently close admission, settle Scheduler work, erase retained candidates and task records including terminal facts and conflicts, invalidate the parent payload bridge, and remove only dispatcher activation owned by this extension.
Nested model usage SHALL be aggregated once into the dispatcher ToolResult usage and SHALL not be double-counted.
The runtime MUST NOT write child transcripts, model outputs, result files, queues, schedules, checkpoints, task records, terminal facts, or activity state to any filesystem location.
OpenSpec Gate receipts remain design audit artifacts and are not orchestration runtime state.

In interactive TUI mode, the package SHALL maintain a temporary above-editor Agents activity display containing only valid queued and running top-level Subagent requests in stable admission order.
Each visible item SHALL identify the role, request, phase, single-line objective summary, elapsed time, and queued or running state.
The display SHALL remove a request immediately after a terminal outcome, clear itself when no active request remains, and accurately report hidden active counts.
Invalid requests MUST NOT enter the activity display, and session shutdown SHALL clear it while work drains.

#### Scenario: Task identity is pinned

- **WHEN** a valid Implement task open is admitted
- **THEN** the runtime stores its canonical root, change, task, Provider/model, boundary, conflict, and ready Red state in one process-local record

#### Scenario: Task identity changes

- **WHEN** a later attempt supplies a different root, change, task, Provider, or model identity
- **THEN** the runtime throws a protocol error before a child launch or state transition

#### Scenario: Task reaches a terminal state

- **WHEN** an Implement task becomes blocked or completed
- **THEN** it releases conflict admission while retaining an idempotently replayable process-local terminal fact with no child out-edge

#### Scenario: AGENTS checkpoint correction is bounded

- **WHEN** the first parent-owned AGENTS checkpoint attempt returns an eligible typed artifact or stale failure
- **THEN** one final checkpoint attempt remains without consuming a child launch

#### Scenario: AGENTS checkpoint attempts are exhausted

- **WHEN** the second AGENTS checkpoint attempt returns an eligible artifact or stale failure
- **THEN** the task terminally blocks as checkpoint attempts exhausted

#### Scenario: Child session is created

- **WHEN** a valid Agent request starts
- **THEN** it uses package-owned prompts and tools with empty resource discovery, in-memory session and settings, disabled Provider retry, the pinned resolved Provider/model identity, and, for an inherited identity, the parent-session payload callback

#### Scenario: Parent payload compatibility rewrites a child request

- **WHEN** the effective parent callback inspects or replaces a serialized child request
- **THEN** the child sends the final transformed payload rather than a separately reconstructed request

#### Scenario: Parent payload compatibility cannot complete

- **WHEN** the inherited payload bridge is unavailable or stale, callback invocation rejects, or its final payload cannot be sent safely
- **THEN** the child request fails before network transmission and only the phase's remaining bounded launch can continue

#### Scenario: Pi contains an internal parent handler error

- **WHEN** Pi catches an individual parent payload handler error internally and the effective callback exposed to the Provider completes without exposing that error
- **THEN** the child observes the same effective callback result and Cadence neither inspects private handler state nor loads the parent extension into the child

#### Scenario: OpenAI Responses child request has no optional output cap

- **WHEN** a child request is serialized for an `openai-responses` model
- **THEN** the final network payload omits `max_output_tokens` while timeout, cancellation, retry-disablement, and complete-result bounds remain active

#### Scenario: Runtime bound is reached

- **WHEN** a batch or active-run request exceeds the existing package-wide bound
- **THEN** the dispatcher rejects or queues it according to that bound without creating another budget tier or changing a task boundary

#### Scenario: Phase times out

- **WHEN** an Agent phase exceeds the configured timeout
- **THEN** its signal aborts, its partial output is unusable, its session is disposed, and its TUI state is timed out

#### Scenario: Dispatcher returns nested usage

- **WHEN** one dispatcher invocation runs one or more child model calls
- **THEN** their usage is aggregated exactly once in the dispatcher ToolResult

#### Scenario: Pi lifecycle ends the stage

- **WHEN** the stage finishes or Pi reloads, replaces the session, or shuts down
- **THEN** admission closes, active work is cancelled, queued and retained work, task records, conflicts, terminal facts, bridge state, and visible activity are cleared, and dispatcher activation returns to its prior state

#### Scenario: Filesystem is inspected after delegation

- **WHEN** package, project, user, and temporary locations are inspected after Agent execution
- **THEN** no private child transcript, result, model output, queue, schedule, checkpoint, task record, terminal fact, or activity file exists

#### Scenario: Multiple Subagents are active

- **WHEN** two or more valid requests are queued or running concurrently in interactive TUI mode
- **THEN** the temporary Agents display lists them in stable admission order and preserves every still-active request when a sibling terminates

#### Scenario: Activity display overflows

- **WHEN** terminal space cannot show every queued or running item
- **THEN** every rendered line remains within the available width and an overflow summary accounts for all hidden active items

#### Scenario: Invalid request is rejected

- **WHEN** a dispatch run fails structural validation before admission
- **THEN** no Subagent activity item or task record is created and the protocol error remains observable

### Requirement: TUI-only private activity compatibility

Subagent activity enhancements SHALL affect only interactive TUI presentation.
For an interactive TUI run, the ordinary parent ToolResult details MAY retain one presentation-only field containing only the approved compact terminal metadata needed to reproduce the inline terminal state; this field MUST NOT contain active Widget state, child transcripts, tool activity, accessed paths, Provider or model identity, hidden reasoning, complete citations, or complete diffs.
Print, JSON, and RPC modes SHALL preserve their existing tool-result content, details, usage, result identifiers, error semantics, and lifecycle event behavior, and their ToolResult details MUST NOT contain the presentation-only field.
Non-TUI modes MUST NOT receive added activity messages, ANSI styling, Widget output, or lifecycle events.
Presentation failure MUST NOT alter request validation, admission order, conflict serialization, cancellation, timeout, mechanical redispatch, result retention, nested usage aggregation, patch application, or stage cleanup outcomes.
The display layer MUST NOT expose child transcripts, child tool activity, accessed file paths, Provider or model identity, hidden reasoning, complete citations, or complete diffs.
It MUST NOT add a Fleet, child-session viewer, public stop, resume, or steering control, general Subagent command, public orchestration API, or persistent display setting.

#### Scenario: Interactive TUI receives activity presentation

- **WHEN** a valid Subagent request runs in interactive TUI mode
- **THEN** the inline presentation and temporary Agents display expose only the approved compact activity metadata

#### Scenario: TUI result is rendered again

- **WHEN** Pi re-renders an interactive parent ToolResult after its Subagent run reached a terminal state
- **THEN** the presentation-only details reproduce the approved compact terminal state without reconstructing it from an error string or exposing private child data

#### Scenario: Non-TUI request runs

- **WHEN** the same valid request runs in print, JSON, or RPC mode
- **THEN** its tool-result and event behavior remain unchanged, its details contain no presentation-only field, and no presentation-only output or ANSI styling is emitted

#### Scenario: Display layer encounters an error

- **WHEN** activity rendering or Widget refresh cannot complete
- **THEN** the underlying Subagent run, cancellation, result, usage, and cleanup outcomes remain governed solely by the existing orchestration contract

#### Scenario: Private child data is inspected through the display

- **WHEN** a user expands an inline result or observes the temporary Agents display
- **THEN** no child transcript, tool activity, accessed path, model identity, hidden reasoning, complete citation set, or complete diff is exposed

#### Scenario: Public controls are inspected

- **WHEN** a user or extension inspects commands, tools, settings, and activity controls after this change
- **THEN** it finds no new Fleet, child viewer, stop, resume, steering, general Subagent, public orchestration, or persistent display control

### Requirement: Implement domain outcomes and Pi Tool errors

The private extension SHALL return valid Implement domain outcomes normally for deferred, candidate, applied, checkpoint-required, retry, completed, blocked, and cancelled operations.
Blocked and cancelled outcomes SHALL NOT be marked as Pi Tool errors merely because work did not complete.
Unknown actions, invalid schemas, duplicate opens, illegal phase transitions, identity mismatches, missing or mismatched result identifiers, illegal candidate-pending operations, and internal invariant failures SHALL throw so the Pi Agent Loop produces a real Tool error.
The extension SHALL NOT synthesize an `isError` flag inside ordinary ToolResult content as a substitute for throwing.
A presentation hook MAY render status metadata but MUST NOT change the final Tool error classification or add TUI-only data to print, JSON, or RPC domain payloads.

#### Scenario: Task is blocked within its boundary

- **WHEN** a valid Implement operation returns a terminal blocked outcome
- **THEN** the Pi Agent Loop reports a normal Tool result whose domain payload contains the typed blocker and whose Tool error flag is false

#### Scenario: Task is cancelled

- **WHEN** a valid Implement operation returns cancelled
- **THEN** the Pi Agent Loop reports a normal Tool result with a false Tool error flag

#### Scenario: Protocol request is invalid

- **WHEN** an Implement request violates its schema, identity, transition, result binding, or duplicate-open rule
- **THEN** the extension throws and the Pi Agent Loop reports a real Tool error

#### Scenario: Internal invariant fails

- **WHEN** the runtime encounters an unknown exception or impossible state
- **THEN** the exception propagates as a real Tool error without keyword-based domain classification

#### Scenario: Non-TUI mode receives an outcome

- **WHEN** the dispatcher runs in print, JSON, or RPC mode
- **THEN** its domain payload, details, usage, and error semantics contain no presentation-only status metadata
