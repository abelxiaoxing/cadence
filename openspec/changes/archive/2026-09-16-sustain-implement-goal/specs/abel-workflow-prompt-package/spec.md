## ADDED Requirements

### Requirement: Design recovery handoff

Design SHALL resolve substantive user decisions and known operator prerequisites before describing a change as ready for unattended execution. Its bounded preflight summary SHALL present stable acceptance and constraint identities and the accepted policy for technical amendments, separately from initial task permissions. The summary SHALL remain review data without runtime or approval authority.

#### Scenario: A structured contract is handed off

- **WHEN** Design preflights a plan with a structured ChangeContract
- **THEN** the summary presents its accepted write roots, dependencies, verification modes, acceptance and constraint IDs, and parent-owned recovery strategy without modifying authority

#### Scenario: A historical plan has no structured policy

- **WHEN** a historical plan is summarized without a ChangeContract
- **THEN** the summary identifies retained legacy boundaries and does not invent a broader amendment policy

### Requirement: Host sustained Implement execution

For an explicitly activated Implement change, the host SHALL schedule a same-stage parent continuation when the parent stops while current local workflow evidence supplies an actionable next step. The host SHALL retain state-machine transition authority, accepted scope, budgets, and completion barriers. It SHALL NOT require a user continuation message for ordinary internal recovery.

#### Scenario: The parent stops before an available continuation

- **WHEN** a parent turn ends with a current actionable amendment or resume and no cancellation or competing user input
- **THEN** the host rereads local status and schedules internal parent guidance for the same change without activating another stage or impersonating user approval

#### Scenario: A technical amendment is unfinished

- **WHEN** the parent ends after a successful intermediate amendment operation
- **THEN** continuation retains the amendment context and continues toward finalization and run verification without treating artifact completion as product completion

#### Scenario: Unchanged attempts make no progress

- **WHEN** successive parent turns only poll unchanged status or repeat the same unsuccessful operation
- **THEN** a bounded no-progress guard stops automatic turn generation without resetting durable budgets or reporting completion

#### Scenario: The user or model interrupts execution

- **WHEN** the stage exits, the user cancels, a model turn is interrupted, pending user input takes precedence, or the session reloads
- **THEN** the host does not revive the interrupted work through automatic continuation

#### Scenario: Recovery requires parent investigation

- **WHEN** a known recoverable failure has current parent-owned evidence and available recovery capacity
- **THEN** status supplies bounded investigation or recovery guidance without executing it, granting new authority, or asking the user to make the technical decision

#### Scenario: An explicit invocation resumes interrupted work

- **WHEN** the user explicitly invokes Implement for a retained process-interrupted run whose state admits resume
- **THEN** status supplies a current automatic resume continuation through the existing recovery path, preserving task budgets and settling retained apply journals without automatically activating after session reload
