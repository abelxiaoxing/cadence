# subagent-endpoint-config Specification

## Purpose

Cadence workers run as fresh Pi CLI processes using the active parent model and Pi authentication. Endpoint routing is intentionally not a Cadence configuration surface.

## Requirements

### Requirement: Inherited Pi execution

Cadence SHALL start workers with `pi --mode json -p --no-session`, pass the parent `provider/id` when available, and SHALL NOT read project or user `routes.json` files. Worker configuration SHALL come from the host Pi model and authentication configuration.

#### Scenario: Worker starts

- **WHEN** an Abel stage dispatches a worker
- **THEN** the worker uses the inherited Pi model and no custom endpoint route is selected

#### Scenario: Legacy route configuration exists

- **WHEN** `.pi/cadence/routes.json` or `~/.pi/agent/cadence/routes.json` exists
- **THEN** Cadence ignores it and does not expose its values, credentials, or health state

### Requirement: Bounded process lifecycle

The runner SHALL use an explicit built-in tool allowlist, a bounded prompt and output size, a bounded execution time, and cancellation that escalates from TERM to KILL. A process failure, malformed JSONL event, timeout, cancellation, or result-adaptation failure SHALL NOT be reported as worker success.

#### Scenario: Child is cancelled

- **WHEN** the parent operation is cancelled
- **THEN** the child is terminated, its pipes settle, and the parent reports cancellation

#### Scenario: Child output is malformed

- **WHEN** no valid final result can be adapted from the bounded assistant output
- **THEN** the parent reports a retryable result failure without treating model text as authority

### Requirement: Parent-owned authority

Child output SHALL be a lightweight final text/result only. Cadence SHALL retain stage activation, disposable proposal workspaces, approved write/delete-set checks, candidate sealing, durable workflow state, and verification in the parent control plane. No child submit tool, child identity binding, route health, or custom provider adapter SHALL be required for a successful worker.

#### Scenario: Implement child edits

- **WHEN** an implementation child edits its disposable workspace
- **THEN** the parent captures a bounded diff, rejects out-of-bound paths, restores the proposal baseline before applying the candidate, and owns verification

### Requirement: Secret-free observability

Progress SHALL expose only bounded lifecycle state, usage, duration, and sanitized failure codes. Credentials, raw child output, endpoint URLs, and model provider secrets SHALL not appear in activity or tool results.
