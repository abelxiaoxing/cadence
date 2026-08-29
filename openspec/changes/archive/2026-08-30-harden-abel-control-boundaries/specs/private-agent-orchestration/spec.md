## ADDED Requirements

### Requirement: Enforced parent Design tool boundary

During a verified Design stage, the parent SHALL receive only the package's read-only workspace tools and `abel_dispatch`; previously active write-capable or unknown tools SHALL be unavailable to the model. The extension SHALL restore the exact pre-Design non-dispatch tool set when Design completes, explicitly finishes, switches to another verified stage, or the session shuts down. Tool isolation SHALL NOT affect Implement or Diagnose activation.

#### Scenario: Design starts with write tools active

- **WHEN** a verified Design invocation begins while shell, edit, write, or an unknown tool is active
- **THEN** those tools are removed for Design while read, grep, find, ls when previously active, and `abel_dispatch` remain available

#### Scenario: Design exits

- **WHEN** Design finalizes, explicitly finishes, switches to Implement or Diagnose, or the session ends
- **THEN** the exact pre-Design non-dispatch tool set is restored and only the stage-owned dispatcher lifecycle is changed

### Requirement: Safe private Design artifact mutation

The Design control surface SHALL provide code-owned write and delete operations only for the active run's OpenSpec change artifacts. It SHALL accept bounded UTF-8 content and safe relative paths limited to the change metadata, proposal, design, tasks, delta specs, and fixed plan draft; it SHALL create safe missing directories atomically, reject symlink components, and forbid product files plus code-owned Gate, ready, and compiled-plan artifacts. Operation replay SHALL be idempotent and conflicting reuse SHALL fail closed.

#### Scenario: Parent writes a Design artifact

- **WHEN** the active Design run writes an allowed proposal, design, tasks, delta spec, metadata, or plan-draft path through private control
- **THEN** the exact bytes are installed beneath that run's change root and a bounded hash outcome is recorded

#### Scenario: Parent targets product code

- **WHEN** the Design write operation targets a path outside its change root or a reserved Gate, ready, or compiled-plan file
- **THEN** the operation is rejected before any filesystem mutation

#### Scenario: Parent deletes an obsolete delta spec

- **WHEN** the active Design run requests deletion of an allowed existing delta-spec file
- **THEN** only that safe regular file is removed, operation replay is idempotent, and no parent directory or unrelated artifact is removed
