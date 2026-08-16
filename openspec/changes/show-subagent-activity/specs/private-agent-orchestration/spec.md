## MODIFIED Requirements

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

### Requirement: Ephemeral bounded runtime lifecycle

The private Agent registry, queue, run records, Worker sessions, retained diffs, and user-interface activity records SHALL exist only in the current Pi process memory.
The runtime SHALL use one package-wide active-run limit, one batch-size limit, one phase timeout, and one complete-result size limit; it SHALL not implement role-specific budget tiers, context-percentage thresholds, scan-byte accounting, Worker lifetime ledgers, or a compatibility platform.
Each child session SHALL use an empty package-defined resource loader plus in-memory Session and Settings managers, with Provider retry disabled.
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
- **THEN** it uses package-owned prompts and tools with empty resource discovery, in-memory session and settings, and disabled Provider retry

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

## ADDED Requirements

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
