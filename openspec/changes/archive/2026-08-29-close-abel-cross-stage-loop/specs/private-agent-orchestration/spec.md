## ADDED Requirements

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

The private journal SHALL retain only normalized Design evidence, decision records, Gate approvals, compiled-plan identity, idempotent operation outcomes, and hashes needed for recovery. It MUST NOT retain raw prompts, hidden reasoning, child transcripts, credentials, environment values, or unfiltered model output.

#### Scenario: Design state is inspected

- **WHEN** a Design run is resumed in a fresh context
- **THEN** status exposes bounded evidence, latest decisions, current Gate proofs, and compiled-plan identity but none of the prohibited raw data

