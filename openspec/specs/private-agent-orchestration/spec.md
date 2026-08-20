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
Implement and Diagnose Workers SHALL return task and phase identity, concise summary, contract-compliance statement, complete unified diff, expected verification result, risks or blockers, and recommended next step.
A successful result MUST come through the structural final-submission tool, match its request identifiers, and satisfy its schema and configured complete-result size limit.
Delivery MUST NOT expose hidden reasoning, a child transcript, tool-call history, or unfiltered raw logs.
A unified diff MUST be complete and MUST NOT be truncated or reconstructed from a summary.
In interactive TUI mode, each valid Subagent run SHALL additionally provide a compact inline activity presentation containing its package-owned role, request identifier, phase, single-line objective summary, elapsed time, and current or terminal state.
The inline state vocabulary SHALL distinguish queued, running, completed, failed, cancelled, and timed-out runs.
A failed inline presentation SHALL include a sanitized, width-bounded single-line reason without exposing Provider or model identity, accessed paths, or terminal control sequences.
Every inline presentation line SHALL remain within the available terminal width.
Expanded successful presentation SHALL expose only a compact evidence-count summary or compact diff summary and next-step metadata; it MUST NOT expose the complete diff or complete citations through the display layer.

#### Scenario: Structured evidence succeeds

- **WHEN** an evidence Agent completes a bounded packet
- **THEN** the parent receives the required compact fields and exact citations without the child conversation or tool trace

#### Scenario: Complete diff delivery succeeds

- **WHEN** an Implement or Diagnose Worker completes an approved phase
- **THEN** the parent receives concise metadata and the complete unified diff needed for path and contract review

#### Scenario: Result schema is invalid

- **WHEN** a result misses required fields, contradicts request identity, bypasses structural submission, or contains an invalid diff
- **THEN** the parent treats it as untrusted and neither applies a patch nor advances workflow state

#### Scenario: Complete result exceeds its limit

- **WHEN** a Worker cannot submit its complete diff within the configured complete-result size limit
- **THEN** the task blocks with an executable return-to-Design split condition and no partial result is usable

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
- **THEN** the display shows compact evidence counts or diff summary and next-step metadata without rendering the complete citations or complete diff

### Requirement: Parent-owned review application and validation

The parent Agent SHALL exclusively own Gate decisions, result acceptance and rejection, patch review and application, command execution, validation classification, AGENTS index changes, and task completion state.
A trusted diff result SHALL be retained only in process memory until the parent applies or discards it or the stage ends.
Before application, the parent SHALL verify the retained result identifier, approved path bounds, current file snapshot, and ordinary `git apply --check` result.
It SHALL then apply exactly the retained unified diff with ordinary all-or-nothing `git apply`; it MUST NOT use reject fragments, reconstruct Worker semantics, or implement a private before-image or filesystem rollback platform.
A failed check or application SHALL not advance Gate, AGENTS, or task state and SHALL return an explicit recovery condition.
For an applied phase, the parent SHALL return only compact validation evidence containing the approved command identifier, exit code, expected classification, normalized failure identity, expected-reason match, and minimum output excerpt.

#### Scenario: Parent accepts a current result

- **WHEN** a trusted retained diff passes identifier, path, file-snapshot, and `git apply --check` review
- **THEN** the parent may apply exactly that diff and run its approved verification

#### Scenario: Patch check or application fails

- **WHEN** `git apply --check` or ordinary `git apply` rejects the retained diff
- **THEN** no task, Gate, or AGENTS state advances and the branch reports an executable recovery condition

#### Scenario: Worker output is untrusted

- **WHEN** output is invalid, out of scope, inconsistent with the approved contract, truncated, or stale
- **THEN** the parent applies none of it and does not silently author replacement semantic content

#### Scenario: Parent returns validation evidence

- **WHEN** an accepted phase's approved command completes
- **THEN** the next request receives compact normalized evidence rather than the raw command log or a child transcript

#### Scenario: Non-text task is approved

- **WHEN** approved work cannot be represented by an ordinary textual unified diff
- **THEN** Design must first define it as an exact deterministic `parent-mechanical` task and a Worker does not improvise it

### Requirement: File-snapshot-aware bounded concurrency

The dispatcher SHALL derive ready work from direct prerequisites, declared read and write sets, conflict edges, shared resources, and validation locks.
It SHALL use one package-wide concurrency limit and one batch-size limit and SHALL not start tasks whose declared conflicts or locks require ordering.
Each completed result SHALL bind content hashes for every file actually read and every existing file it proposes to modify or delete, and SHALL bind an explicit absent marker for every proposed new path.
The parent SHALL apply accepted results serially and compare only that result's bound files immediately before application.
A change outside those files SHALL NOT make the result stale.
A content or existence change to a bound read or write file SHALL make it stale and prohibit application.
Each Red, Green, and optional Refactor phase SHALL receive and return a fresh file snapshot after the preceding accepted phase.

#### Scenario: Independent Design packets are ready

- **WHEN** multiple evidence packets have independent scopes and no ordered dependency
- **THEN** they may run concurrently within the package-wide limit

#### Scenario: Compatible implementation tasks are ready

- **WHEN** multiple tasks have accepted prerequisites and compatible declared scopes, conflicts, resources, and validation locks
- **THEN** their read-only Workers may run concurrently while results remain subject to serial parent review and application

#### Scenario: Declared tasks conflict

- **WHEN** ready tasks have a read/write or write/write overlap or an incompatible conflict, resource, or validation lock
- **THEN** the dispatcher serializes them and does not start the later task early

#### Scenario: Unrelated sibling change is applied

- **WHEN** one parallel result is applied and it changes no file bound by an independent sibling result
- **THEN** the sibling result remains current and may be reviewed without redispatch

#### Scenario: Bound file changed

- **WHEN** a file in a result's read or write snapshot changes content or existence before application
- **THEN** the parent rejects that result as stale and applies none of it

#### Scenario: Next phase begins after an accepted diff

- **WHEN** a task's accepted phase changes the workspace
- **THEN** the next phase is dispatched with a fresh snapshot and cannot reuse the prior phase snapshot

### Requirement: Single mechanical redispatch and branch isolation

Provider-managed retry SHALL be disabled with `maxRetries: 0`, and the private runtime SHALL implement no cooldown, circuit breaker, or hidden request retry.
After one failed Agent request, the dispatcher MAY perform at most one mechanical redispatch only when request content, role, scope, prerequisites, conflict contract, and declared write set are identical.
A stale file snapshot also MAY consume that one identical redispatch after the parent supplies only the refreshed hashes and unchanged request contract.
A second Agent-request failure SHALL block the affected branch and its dependent successors and SHALL return a sanitized executable recovery condition that identifies the exhausted request, states that no third Agent attempt or partial result is usable, preserves independently accepted siblings, and directs the parent to either finish unaffected work or return to Design when recovery requires any contract change.
Generated implementation artifacts SHALL NOT be trusted or applied to the main workspace until parent-owned preflight outside that workspace proves complete-diff consumption, current snapshot and declared-path conformance, source/test loadability, and the approved phase verification identity. Syntax, import/load, no-test, malformed-diff, and wrong-Red-identity failures SHALL be classified as implementation-artifact rejection rather than target Red or a substantive Design defect. Artifact rejection MAY receive only the approved finite artifact-correction budget; exhaustion SHALL block the affected branch and dependent successors with a sanitized implementation-artifact recovery condition and SHALL NOT automatically return the change to Design.
Any required scope, dependency, write-set, behavior, architecture, policy, or approved verification-contract change SHALL block the affected branch and its dependent successors without redispatch and SHALL require Design.
Independently accepted sibling results SHALL remain usable.
Cancellation SHALL signal active work, prevent queued work from starting, and never treat partial output as successful.

#### Scenario: First request fails within an unchanged contract

- **WHEN** a request fails and its complete approved contract can be redispatched byte-for-byte apart from refreshed snapshot hashes
- **THEN** the dispatcher may make one final mechanical redispatch

#### Scenario: Mechanical redispatch fails again

- **WHEN** the single allowed Agent-request redispatch also fails
- **THEN** the affected branch and dependent successors block with a sanitized executable condition naming the request, declaring the Agent-request retry exhausted and partial output unusable, preserving independent accepted siblings, and allowing only unaffected-work completion or return to Design for a changed contract

#### Scenario: Candidate artifact passes structural submission but cannot load

- **WHEN** a generated diff is structurally submitted but isolated preflight finds an unconsumed suffix, syntax or import/load failure, no target test, or a Red failure identity other than the approved one
- **THEN** none of the candidate is applied to the main workspace, the failure is classified as implementation-artifact rejection, and it may consume only the finite artifact-correction budget

#### Scenario: Artifact correction budget is exhausted

- **WHEN** the approved finite artifact-correction budget ends without one candidate passing isolated preflight
- **THEN** the affected branch and dependent successors block with a sanitized implementation-artifact recovery condition, independent accepted siblings remain usable, and no automatic transition returns the change to Design

#### Scenario: Recovery would expand the contract

- **WHEN** recovery requires a changed scope, prerequisite, conflict, write set, behavior, policy, dependency, or architecture
- **THEN** the dispatcher does not redispatch and directs the work to the appropriate Design decision

#### Scenario: One parallel branch fails

- **WHEN** one concurrent branch fails while an independent sibling result has already been accepted
- **THEN** the failed branch blocks without invalidating or discarding the accepted sibling result

#### Scenario: User cancels a batch

- **WHEN** the user cancels active delegation
- **THEN** active runs receive cancellation, queued runs do not start, partial outputs remain unusable, and already accepted independent results remain available

### Requirement: Ephemeral bounded runtime lifecycle

The private Agent registry, queue, run records, Worker sessions, retained diffs, and user-interface activity records SHALL exist only in the current Pi process memory.
The runtime SHALL use one package-wide active-run limit, one batch-size limit, one phase timeout, and one complete-result size limit; it SHALL not implement role-specific budget tiers, context-percentage thresholds, scan-byte accounting, Worker lifetime ledgers, or a compatibility platform.
Each child session SHALL use an empty package-defined resource loader plus in-memory Session and Settings managers, with Provider retry disabled.
Each child Provider request SHALL reuse the selected parent Provider's effective stream behavior and the parent session's effective payload-transform callback while the child resource loader continues to discover no parent, user, project, package-external, or arbitrary extension resources.
The callback already loaded by the parent session MAY inspect and replace the child's serialized Provider payload, including request-specific input and tool data needed for the same effective parent compatibility semantics; this callback invocation is part of the parent-session bridge, while no extension factory, handler discovery, command, tool, Skill, Prompt, theme, context resource, callback transcript, or transformed payload SHALL be copied into or persisted by the child runtime.
The callback SHALL execute once against each fresh child serialized payload, and the bridge SHALL fail closed before network send if it is unavailable or stale, if invocation of the effective callback exposed to the Provider throws or rejects, or if the exposed callback yields an unsafe non-object payload; the runtime MUST NOT silently send a separately reconstructed or untransformed payload. An individual parent extension-handler error that Pi catches internally and does not expose to the Provider callback caller SHALL retain Pi's parent-session behavior; Cadence SHALL NOT claim to rediscover that hidden error by inspecting private handlers or loading the extension in the child.
For a child model using the `openai-responses` API, after the exposed effective callback has inspected or replaced the payload, the final serialized request payload MUST omit the optional `max_output_tokens` field and the runtime MUST NOT substitute another child output-token cap; phase timeout, cancellation, Provider retry disablement, and complete-result size limits remain in force.
Cancellation, timeout, completion, failure, stage finish, reload, session replacement, and shutdown SHALL dispose affected child sessions and clear queued or retained state as applicable.
Nested model usage SHALL be aggregated once into the dispatcher ToolResult usage and SHALL not be double-counted by a second private accounting layer.
The runtime MUST NOT write child transcripts, model outputs, result files, queues, schedules, checkpoints, Worker state, or user-interface activity state to package, project, user, temporary, or external locations.
OpenSpec Gate receipts remain design audit artifacts and are not orchestration runtime state.
In interactive TUI mode, the package SHALL maintain a temporary above-editor Agents activity display containing only valid queued and running top-level Subagent requests in stable admission order.
Each visible activity item SHALL identify the role, request, phase, single-line objective summary, elapsed time, and queued or running state.
The activity display SHALL remove a request immediately after any terminal outcome, SHALL clear itself and its related status indication when no active request remains, and SHALL accurately report hidden active counts when available space cannot show every item.
Invalid requests MUST NOT enter the activity display.
Session shutdown SHALL clear the activity display even while work is being drained.

#### Scenario: Child session is created

- **WHEN** a valid Agent request starts
- **THEN** it uses package-owned prompts and tools with empty resource discovery, in-memory session and settings, disabled Provider retry, the selected parent Provider, and the parent session's payload-transform callback without loading external extensions into the child

#### Scenario: Parent payload compatibility rewrites a child request

- **WHEN** the selected parent Provider/model and parent session payload callback inspect or replace a serialized request
- **THEN** the child delegates through the same effective parent Provider, applies the callback to the child request, and sends the final transformed payload rather than a separately reconstructed Provider payload

#### Scenario: Parent payload compatibility cannot complete

- **WHEN** the inherited payload bridge is unavailable or stale, the exposed effective callback invocation rejects, or its final payload cannot be sent safely
- **THEN** the child request fails before network transmission, no untransformed fallback is sent, no result is trusted, and normal bounded redispatch policy applies

#### Scenario: Pi contains an internal parent handler error

- **WHEN** Pi catches an individual parent payload handler error internally and the effective callback exposed to the Provider completes without exposing that error
- **THEN** the child observes the same effective callback result as the parent request, and Cadence neither inspects private handler state nor loads that extension into the child

#### Scenario: OpenAI Responses child request has no optional output cap

- **WHEN** a child request is serialized for an `openai-responses` model
- **THEN** the final network payload omits `max_output_tokens` while timeout, cancellation, retry, and complete-result bounds remain active

#### Scenario: Runtime bound is reached

- **WHEN** a batch or active-run request exceeds its single configured bound
- **THEN** the dispatcher rejects or queues it according to that bound without creating another budget tier

#### Scenario: Phase times out

- **WHEN** an Agent phase exceeds the configured phase timeout
- **THEN** its signal is aborted, its partial output is unusable, its session is disposed, and its TUI terminal state is timed out

#### Scenario: Dispatcher returns nested usage

- **WHEN** one dispatcher invocation runs one or more child model calls
- **THEN** their usage is aggregated exactly once in the dispatcher ToolResult

#### Scenario: Pi lifecycle ends the stage

- **WHEN** the stage finishes or Pi reloads, replaces the session, or shuts down
- **THEN** active work is cancelled, queued and retained work and visible activity are cleared, child sessions are disposed, and no resumable private state is persisted

#### Scenario: Filesystem is inspected after delegation

- **WHEN** package, project, user, and temporary locations are inspected after Agent execution
- **THEN** no private child transcript, result, model-output, queue, schedule, checkpoint, Worker-state, or user-interface activity file exists, while Pi's ordinary host-owned parent transcript is not treated as such a file

#### Scenario: Multiple Subagents are active

- **WHEN** two or more valid Subagent requests are queued or running concurrently in interactive TUI mode
- **THEN** the temporary Agents display lists them in stable admission order and preserves every still-active request when a sibling terminates

#### Scenario: Activity display overflows

- **WHEN** terminal space cannot show every queued or running Subagent item
- **THEN** every rendered line remains within the available width and an overflow summary accurately accounts for all hidden active items

#### Scenario: Invalid request is rejected

- **WHEN** a dispatch run fails structural request validation before admission
- **THEN** no Subagent activity item is created and the existing validation error remains the tool result

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

