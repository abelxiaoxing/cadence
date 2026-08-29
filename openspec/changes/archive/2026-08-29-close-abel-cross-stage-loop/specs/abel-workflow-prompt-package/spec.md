## ADDED Requirements

### Requirement: Closed four-entrypoint approval handoff

The package SHALL continue to expose exactly `/abel-init`, `/abel-design`, `/abel-implement`, and `/abel-diagnose` as its Abel prompt entrypoints. An Implement run that lacks approved authority SHALL remain the same durable run, expose the missing-authority category and required Gate revision, and wait for a newer receipt produced through `/abel-design --change <change>`. The workflow SHALL distinguish this explicit user-owned Design revision from ordinary Implement recovery and SHALL NOT automatically invoke another stage.

#### Scenario: Ordinary Implement failure remains local

- **WHEN** Implement encounters an artifact, transport, environment, stale, baseline, or in-boundary repair failure
- **THEN** it exposes a same-run resume or rebind condition without requiring Design

#### Scenario: Technical authority is missing

- **WHEN** Implement proves that a new path, dependency, verification, resource, or AGENTS boundary is required without changing behavior
- **THEN** it retains the run, identifies Gate B as required, and tells the user to revise that change through Design before resuming with the new receipt

#### Scenario: Behavior authority is missing

- **WHEN** Implement proves that observable behavior, compatibility, safety, or scope must change
- **THEN** it retains the run, identifies Gate A and Gate B as required, and waits for an explicitly approved revised delivery

#### Scenario: Revised delivery resumes implementation

- **WHEN** Design finalizes a newer receipt for an approval-needed Implement run
- **THEN** the user resumes that same Implement run with the new revision and receipt hash and compatible committed work is preserved

### Requirement: Explicit stage completion

Each eligible stage SHALL keep private dispatch active only while a multi-turn workflow interaction is in progress. Design readiness, Implement terminal settlement, Diagnose completion, or an explicit finish SHALL remove only `abel_dispatch`, clear the active stage identity, and preserve unrelated active tools. A nonterminal Gate wait or resumable pause SHALL remain active for its immediate user follow-up.

#### Scenario: Design becomes ready

- **WHEN** Design finalizes a valid delivery and reports `READY_TO_IMPLEMENT`
- **THEN** its private dispatch activation ends before an unrelated later request

#### Scenario: Implement pauses for a follow-up

- **WHEN** Implement returns a nonterminal pause or approval-needed state
- **THEN** the same verified stage remains active for a direct resume, approval, or inspection follow-up

#### Scenario: Implement terminates

- **WHEN** an Implement run becomes completed, discarded, or rejected
- **THEN** private dispatch is deactivated without changing other active tools

