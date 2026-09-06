## ADDED Requirements

### Requirement: Change-specific verification evidence

Behavior tasks SHALL retain Red/Green verification. Explicitly authorized mechanical and behavior-preserving refactor tasks MAY use baseline and postcondition evidence without a Red candidate. Compilation SHALL reject these modes without structured authority, reject declared public behavior impact, restrict mechanical write types and protect accepted refactor verifier inputs. All modes SHALL retain affected, cumulative and post-apply verification and transactional completion.

#### Scenario: A nonbehavioral task executes

- **WHEN** an approved mechanical or refactor task satisfies its compiler checks
- **THEN** execution starts at Green after baseline capture and produces no fabricated Red candidate or failure fact

### Requirement: Live workflow evaluation

Development evaluation SHALL distinguish deterministic regression, package activation preflight and live-model consumer execution. Live measurements SHALL include completion, interventions, repeated amendments, elapsed time and reported usage/cost, without retaining raw conversations. Independent final oracles SHALL check successful consumer behavior. Provider failure, cancellation and Design-only completion SHALL not count as successful implementation.

#### Scenario: A live model cannot execute

- **WHEN** the host reports a provider error before useful execution
- **THEN** evaluation records model unavailability separately from user intervention and never reports a successful workflow

#### Scenario: The host is replaced between stages

- **WHEN** the restart evaluation replaces its host after finalized Design
- **THEN** Implement must discover the retained delivery in the new context and pass the final consumer oracle
