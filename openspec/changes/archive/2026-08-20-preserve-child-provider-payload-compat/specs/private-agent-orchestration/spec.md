## MODIFIED Requirements

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

The private Agent registry, queue, run records, Worker sessions, and retained diffs SHALL exist only in the current Pi process memory.
The runtime SHALL use one package-wide active-run limit, one batch-size limit, one phase timeout, and one complete-result size limit; it SHALL not implement role-specific budget tiers, context-percentage thresholds, scan-byte accounting, Worker lifetime ledgers, or a compatibility platform.
Each child session SHALL use an empty package-defined resource loader plus in-memory Session and Settings managers, with Provider retry disabled.
Each child Provider request SHALL reuse the selected parent Provider's effective stream behavior and the parent session's effective payload-transform callback while the child resource loader continues to discover no parent, user, project, package-external, or arbitrary extension resources.
The callback already loaded by the parent session MAY inspect and replace the child's serialized Provider payload, including request-specific input and tool data needed for the same effective parent compatibility semantics; this callback invocation is part of the parent-session bridge, while no extension factory, handler discovery, command, tool, Skill, Prompt, theme, context resource, callback transcript, or transformed payload SHALL be copied into or persisted by the child runtime.
The callback SHALL execute once against each fresh child serialized payload, and the bridge SHALL fail closed before network send if it is unavailable or stale, if invocation of the effective callback exposed to the Provider throws or rejects, or if the exposed callback yields an unsafe non-object payload; the runtime MUST NOT silently send a separately reconstructed or untransformed payload. An individual parent extension-handler error that Pi catches internally and does not expose to the Provider callback caller SHALL retain Pi's parent-session behavior; Cadence SHALL NOT claim to rediscover that hidden error by inspecting private handlers or loading the extension in the child.
For a child model using the `openai-responses` API, after the exposed effective callback has inspected or replaced the payload, the final serialized request payload MUST omit the optional `max_output_tokens` field and the runtime MUST NOT substitute another child output-token cap; phase timeout, cancellation, Provider retry disablement, and complete-result size limits remain in force.
Cancellation, timeout, completion, failure, stage finish, reload, session replacement, and shutdown SHALL dispose affected child sessions and clear queued or retained state as applicable.
Nested model usage SHALL be aggregated once into the dispatcher ToolResult usage and SHALL not be double-counted by a second private accounting layer.
The runtime MUST NOT write child transcripts, model outputs, result files, queues, schedules, checkpoints, or Worker state to package, project, user, temporary, or external locations.
OpenSpec Gate receipts remain design audit artifacts and are not orchestration runtime state.

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
- **THEN** its signal is aborted, its partial output is unusable, and its session is disposed

#### Scenario: Dispatcher returns nested usage

- **WHEN** one dispatcher invocation runs one or more child model calls
- **THEN** their usage is aggregated exactly once in the dispatcher ToolResult

#### Scenario: Pi lifecycle ends the stage

- **WHEN** the stage finishes or Pi reloads, replaces the session, or shuts down
- **THEN** active work is cancelled, queued and retained work is cleared, child sessions are disposed, and no resumable private state is persisted

#### Scenario: Filesystem is inspected after delegation

- **WHEN** package, project, user, and temporary locations are inspected after Agent execution
- **THEN** no private child transcript, result, model-output, queue, schedule, checkpoint, or Worker-state file exists, while Pi's ordinary host-owned parent transcript is not treated as such a file
