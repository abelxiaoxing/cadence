## ADDED Requirements

### Requirement: Structured change authority

Gate A MAY accept a structured ChangeContract with stable acceptance IDs, verification obligations, explicit constraints and write/dependency/verification-mode policy. New Design work SHALL use this form. The controller SHALL normalize, persist and inherit that authority. Compilation SHALL inject the approved contract and reject substitution, omitted required verification or policy expansion. Automatic Implement amendments SHALL NOT renew Gate A, record replacement behavior decisions, or rewrite accepted proposal/spec artifacts. Prose-only historical approvals SHALL remain readable without granting new implicit scope.

#### Scenario: A technical label attempts to weaken acceptance

- **WHEN** an automatic revision removes accepted verification, expands its policy or replaces behavior authority
- **THEN** the controller rejects it before publishing the revised executable authority

#### Scenario: A structured contract is reopened

- **WHEN** the Design journal reopens or inherits finalized Gate A authority
- **THEN** the same normalized goal, acceptance, constraints and policy remain available and bound to compilation

### Requirement: Parent-owned nested recovery decisions

Every nested affected repair, cumulative repair and Red correction SHALL ask the parent recovery policy whether its next action is allowed. The parent SHALL check its lease, apply the shared automatic or explicit one-attempt policy, and retain the existing durable work reservation authority. The executor SHALL sequence effects without independently choosing retry limits.

#### Scenario: A nested repair reaches its bound

- **WHEN** a repair requests work beyond its automatic limit or single additional grant
- **THEN** the parent refuses the action without launching another candidate or refunding previous work
