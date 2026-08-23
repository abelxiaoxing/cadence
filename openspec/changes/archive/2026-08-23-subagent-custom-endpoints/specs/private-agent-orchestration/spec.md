## MODIFIED Requirements

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
