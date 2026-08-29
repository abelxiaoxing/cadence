## ADDED Requirements

### Requirement: Self-contained explicit approval round trip

The package SHALL retain exactly `/abel-init`, `/abel-design`, `/abel-implement`, and `/abel-diagnose` as public entrypoints. Implement SHALL never invoke Design automatically. After the user explicitly completes a requested Design revision, a later explicit `/abel-implement <change>` in the same or a fresh context SHALL discover the verified newer receipt through local status and resume the original Implement run without requiring copied conversational state.

#### Scenario: Ordinary Implement failure remains in stage

- **WHEN** Implement encounters a recoverable artifact, transport, environment, stale, baseline, verification, or in-boundary repair failure
- **THEN** it stays in the same run and exposes no Design request or available cross-stage delivery

#### Scenario: User performs the approval round trip

- **WHEN** Implement reports missing authority, the user explicitly invokes Design for that change, and then explicitly invokes Implement after Design finalization
- **THEN** the second Implement invocation uses the locally discovered revision/hash to resume the retained run and preserves compatible committed work

#### Scenario: Public command inventory is inspected

- **WHEN** the installed package prompts are enumerated
- **THEN** exactly the same four Abel commands are present and no resume, approval, or handoff slash command has been added
