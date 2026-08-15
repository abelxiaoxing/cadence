## Purpose

Provide a self-contained, installable Pi package that exposes the Abel four-stage workflow and its required skills without depending on a subagent runtime or machine-local workflow configuration.

## ADDED Requirements

### Requirement: Independently installable workflow package

The system SHALL provide the package as `@abel/pi-abel-workflow` under `packages/pi-abel-workflow/`, support Pi 0.84.1 or newer, and make it independently loadable from its npm package or a local package path.
The package SHALL support both user-scoped and project-scoped npm installation.
The first release SHALL NOT promise independent installation from the monorepo git source.

#### Scenario: User-scoped npm installation

- **WHEN** a user installs `npm:@abel/pi-abel-workflow` with Pi 0.84.1 or newer
- **THEN** Pi discovers the package's four workflow prompts and four bundled skills

#### Scenario: Project-scoped npm installation

- **WHEN** a user installs `npm:@abel/pi-abel-workflow` with Pi's project-local installation option
- **THEN** the trusted project discovers the same prompts and skills without requiring a user-global installation

#### Scenario: Unsupported older Pi version

- **WHEN** a user attempts to use the package with a Pi version older than 0.84.1
- **THEN** the package documentation identifies that host version as unsupported rather than claiming compatibility

#### Scenario: Independent git installation is not promised

- **WHEN** a user reads the first-phase installation documentation
- **THEN** it distinguishes supported npm and local-package loading from the monorepo git source and does not present the latter as an independent workflow-package installation

### Requirement: Four stable workflow prompt entry points

The package SHALL expose exactly the workflow prompts `abel-init`, `abel-design`, `abel-implement`, and `abel-diagnose` from the package prompt surface.
Each prompt SHALL declare a string-valued `argument-hint`, receive the complete Pi argument string through `$ARGUMENTS`, and place that expansion inside an explicit `<abel-request>` boundary.
Prompt discovery SHALL be non-recursive.

#### Scenario: Prompt frontmatter is valid

- **WHEN** Pi loads each packaged workflow prompt
- **THEN** its `argument-hint` is a YAML string matching the prompt's optional or required argument contract

#### Scenario: Complete arguments are expanded

- **WHEN** a user invokes a workflow prompt with quoted arguments or arguments containing spaces
- **THEN** the expanded `<abel-request>` contains the complete Pi argument value without a second prompt-defined tokenization pass

#### Scenario: Nested Markdown is not a prompt

- **WHEN** the package contains Markdown below a subdirectory of `prompts/`
- **THEN** Pi does not discover that nested file as an additional prompt

#### Scenario: Missing required input

- **WHEN** `abel-design`, `abel-implement`, or `abel-diagnose` receives no uniquely valid required input
- **THEN** the workflow stops and asks for the missing or ambiguous information rather than guessing

### Requirement: Self-contained shared workflow contract

The package SHALL bundle an `abel-workflow` skill that defines the shared four-stage responsibilities, Gate semantics, design-delivery integrity checks, Red-Green-Refactor rules, AGENTS index maintenance, and parent-versus-subagent boundaries needed to execute the workflow.
The prompts and bundled skill together SHALL remain understandable when no user-global `AGENTS.md` provides Abel-specific instructions.
Gate A and Gate B SHALL approve behavioral and technical contracts respectively and SHALL NOT approve tool permissions.

#### Scenario: No global Abel context exists

- **WHEN** a user invokes one of the four prompts without an Abel-specific global `AGENTS.md`
- **THEN** the package resources still provide the core rules needed to execute that stage

#### Scenario: Gate is not a permission prompt

- **WHEN** the workflow reaches Gate A or Gate B
- **THEN** it requests approval of the relevant contract without introducing interactive tool authorization or a permission package

#### Scenario: Shared rules are maintained once

- **WHEN** a rule applies to multiple workflow stages
- **THEN** the package can place the authoritative shared rule in `abel-workflow` instead of requiring unbounded copies in all four prompt bodies

### Requirement: Initialization behavior

`abel-init` SHALL accept an optional project path and use the current directory when it is omitted.
It SHALL preserve unrelated files, human-authored AGENTS content, baseline dirty state, and nested repository boundaries.
It SHALL select Bun when available and otherwise npm as the single JavaScript toolchain for that run.
If OpenSpec is missing, it SHALL install `@fission-ai/openspec@latest` globally with the selected toolchain, recheck the required CLI capabilities, and stop with the original error and an executable remediation when installation or recheck fails.
It SHALL load `abel-workflow` before modifying OpenSpec or AGENTS files and stop if that core skill is unavailable.
It SHALL inspect the discoverability of `context7-auto-research` and `grok-search`, report their resolved paths when present, and report actionable remediation when either is absent.
A missing research skill SHALL NOT prevent OpenSpec initialization or AGENTS repair, but the final report SHALL mark the environment as not fully ready.
Initialization SHALL NOT treat `git-commit`, `dev-browser`, or the removed `time` skill as required checks.
It SHALL initialize or safely update OpenSpec without a destructive force option, validate the resolved schema and templates, and create or repair only the managed portions of appropriate AGENTS indexes.
It MUST NOT edit `openspec/AGENTS.md`.

#### Scenario: Core workflow skill is unavailable

- **WHEN** `abel-init` cannot load the bundled `abel-workflow` skill
- **THEN** initialization stops before modifying OpenSpec or AGENTS files and reports how to restore or reinstall the package resource

#### Scenario: Research skills are available

- **WHEN** `context7-auto-research` and `grok-search` are discoverable during initialization
- **THEN** the final report identifies their resolved discovery paths

#### Scenario: Research skill is missing

- **WHEN** either bundled research skill cannot be discovered
- **THEN** initialization can still complete OpenSpec and AGENTS repair, but its final report marks the environment not fully ready and gives an actionable resource remediation

#### Scenario: Non-init skills are absent

- **WHEN** `git-commit`, `dev-browser`, or a dedicated `time` skill is unavailable during initialization
- **THEN** their absence does not affect the Init readiness check

#### Scenario: Default project path

- **WHEN** a user invokes `abel-init` without arguments
- **THEN** initialization targets the current directory

#### Scenario: OpenSpec is absent with Bun available

- **WHEN** OpenSpec is unavailable and Bun is usable
- **THEN** `abel-init` installs the latest OpenSpec CLI globally with Bun and rechecks all required capabilities

#### Scenario: Bun is unavailable and npm is available

- **WHEN** Bun cannot be used but npm can
- **THEN** `abel-init` selects npm for the whole run and uses npm for the OpenSpec installation if needed

#### Scenario: OpenSpec installation fails

- **WHEN** global OpenSpec installation or the post-install capability check fails
- **THEN** `abel-init` stops, preserves the original failure, and reports an executable remediation command

#### Scenario: Existing AGENTS content is present

- **WHEN** an AGENTS file contains human-authored content and a managed Abel index block
- **THEN** `abel-init` preserves the human content and makes only the minimum verified managed-block repair

### Requirement: Design behavior and trusted delivery

`abel-design` SHALL accept either a requirement or `--change <change_name>`, run before product implementation, and validate the root and relevant nested AGENTS indexes.
Before Gate A it SHALL remain read-only, explore available evidence, and submit every blocking non-mechanical decision to the user.
It SHALL separately obtain Gate A for the behavioral contract and Gate B for the technical implementation contract.
After Gate A it SHALL write only inside the resolved OpenSpec change root according to the artifact graph.
It SHALL define executable verification and AGENTS-impact contracts for every implementation task.
It SHALL report `READY_TO_IMPLEMENT` only when strict validation, receipts, hashes, traceability, artifact completeness, and zero blocking decisions all pass.

#### Scenario: New design reaches Gate A

- **WHEN** all behavior decisions are resolved for a new requirement
- **THEN** `abel-design` presents the behavioral contract and waits for explicit Gate A approval before creating the change

#### Scenario: Existing change is resumed

- **WHEN** a user invokes `abel-design --change <change_name>`
- **THEN** the workflow validates the resolved change, receipts, artifact hashes, and traceability before trusting completed gates

#### Scenario: Artifact integrity is invalid

- **WHEN** a receipt is missing, a covered artifact hash differs, or the artifact graph is inconsistent
- **THEN** `abel-design` resumes from the earliest affected stage and does not report implementation readiness

#### Scenario: Design is complete

- **WHEN** both gates are approved and all strict delivery checks pass
- **THEN** the workflow reports `READY_TO_IMPLEMENT` without modifying product code or repository AGENTS indexes

### Requirement: Implementation behavior

`abel-implement` SHALL require a change name and validate the design delivery in a fresh context before modifying code or tests.
It SHALL return to Design rather than recreate decisions when delivery validation fails.
Before writing, it SHALL run and record target, affected-suite, and full-suite baselines with stable failure identities and separate every pre-existing failure from the task Red.
Each task's exact affected-suite commands SHALL define that task's dynamic repair boundary: every reproducible pre-existing failure they expose, including a failure outside the original module, SHALL enter the current task for verified root-cause analysis and minimum repair.
A newly revealed failure SHALL be attributed as pre-existing, introduced by the current change, or unresolved before work continues; a pre-existing failure SHALL NOT satisfy the task Red, and an unresolved attribution SHALL block completion.
An environmental, transient, or external-service failure SHALL block completion with a reported executable recovery condition and SHALL NOT authorize speculative product edits.
If an included repair requires new product behavior, a data, security, privacy, or compatibility policy, a new dependency, cross-module architecture, an irreversible change, or another substantive decision, implementation SHALL stop and return to Design.
It SHALL execute every task using its Red-Green-Refactor contract, run the target verification after each code or test edit, run the affected suite after refactoring, update AGENTS indexes only at stable task checkpoints, and finish only when every target and affected verification passes and the full suite has no new failure relative to baseline.
Failures found only by the full suite outside the affected-suite boundary SHALL remain baseline evidence and SHALL NOT enter the task automatically.
It SHALL NOT modify unrelated dirty files or implicitly archive or publish the change.

#### Scenario: Valid cross-context handoff

- **WHEN** receipts, artifact hashes, traceability, strict validation, and task contracts are all valid in a new context
- **THEN** implementation proceeds without requesting Gate A or Gate B again

#### Scenario: Affected-suite baseline is green

- **WHEN** every exact affected-suite command passes before task writes
- **THEN** implementation proceeds without dynamically adding a repair to the task

#### Scenario: Existing affected failure is present

- **WHEN** an exact affected-suite command exposes a reproducible pre-existing failure inside or outside the original task module
- **THEN** that failure is recorded separately from the task Red and enters the current task for verified root-cause analysis and minimum repair

#### Scenario: Later run reveals a previously masked failure

- **WHEN** an affected-suite run reveals a failure that an earlier run did not report
- **THEN** implementation attributes it as pre-existing or introduced before repairing it and stops when the attribution cannot be established

#### Scenario: Affected failure is environmental

- **WHEN** an affected-suite failure is transient, environmental, external-service dependent, or not reproducible
- **THEN** implementation reports an executable recovery condition and blocks completion without making a speculative product repair

#### Scenario: Affected repair requires a substantive decision

- **WHEN** repairing an included affected-suite failure requires new behavior, policy, dependency, architecture, irreversibility, or another substantive decision
- **THEN** implementation stops and returns the expanded requirement to Design

#### Scenario: Full-suite-only baseline failure exists

- **WHEN** the full-suite baseline has a pre-existing failure outside every exact affected-suite command
- **THEN** that failure remains baseline evidence and does not automatically enter the current task

#### Scenario: Task Red fails for the wrong reason

- **WHEN** the specified Red command passes or fails for a reason other than its contract
- **THEN** implementation stops and returns the change to Design rather than improvising a new validation

#### Scenario: Implementation completes

- **WHEN** all target and affected verifications pass, every dynamically included repair is complete, and the full suite has no new failure relative to baseline
- **THEN** the workflow reports completion without automatically archiving or publishing

### Requirement: Diagnosis behavior

`abel-diagnose` SHALL require a description of one or more existing bugs, collect evidence, reproduce each issue, and falsify candidate root causes before generating a fix.
For every verified root cause it SHALL first add and run a regression verification that fails for the target defect, then apply the minimum repair, run target and affected suites, update AGENTS indexes at a stable checkpoint, and confirm no new full-suite failures relative to baseline.
If resolution requires new behavior, a substantive architecture decision, or a choice not uniquely determined by an existing contract, it SHALL stop and return the work to Design.

#### Scenario: Root cause is unverified

- **WHEN** a reported bug cannot be reproduced or its candidate root cause lacks confirming evidence
- **THEN** diagnosis marks it blocked and does not generate a repair

#### Scenario: Regression-first repair

- **WHEN** a root cause is verified
- **THEN** diagnosis establishes a failing regression verification before applying the minimum implementation fix

#### Scenario: Requested fix changes behavior

- **WHEN** fixing the report requires a new behavioral contract or substantive architecture
- **THEN** diagnosis stops and directs the requirement to `abel-design`

### Requirement: Bundled and external skills

The package SHALL bundle discoverable skills named `abel-workflow`, `context7-auto-research`, `grok-search`, and `git-commit` together with the distributable runtime resources required by those skills.
The workflow SHALL NOT automatically commit merely because `git-commit` is installed.
The dedicated `time` skill SHALL NOT be a distributed or validated prerequisite.
`dev-browser` SHALL remain external and SHALL block only a task whose approved verification contract explicitly requires browser E2E execution.

#### Scenario: Bundled skills are discovered

- **WHEN** the package is loaded independently
- **THEN** Pi discovers exactly the four bundled skill names from the package skill surface

#### Scenario: Commit skill is present without a commit request

- **WHEN** a workflow stage completes and the user has not requested a commit
- **THEN** the workflow does not invoke `git-commit` or commit automatically

#### Scenario: Browser E2E is not required

- **WHEN** a task's approved verification contract has no browser E2E step
- **THEN** absence of `dev-browser` does not block the task or other workflow stages

#### Scenario: Browser E2E is required but unavailable

- **WHEN** an approved task requires browser E2E and `dev-browser` is unavailable
- **THEN** the task stops with the missing capability and an executable remediation rather than reporting a passing verification

### Requirement: Safe package contents and independence

The package MUST NOT contain credentials, `.env` files, virtual environments, backup files, user or session state, scheduling state, or symbolic links to external workflow/configuration locations.
It MUST NOT modify, reference as a runtime dependency, or link to `/home/abelxiaoxing/work/AbelWorkflow`.
It MUST NOT require files from `/home/abelxiaoxing/.agents/` at runtime.
Its npm tarball SHALL contain the package metadata, user documentation, license, four prompts, four skills, and required skill runtime resources while excluding development indexes, tests, TypeScript/Vitest configuration, and internal working documents.

#### Scenario: Tarball is inspected

- **WHEN** the package tarball is created for validation
- **THEN** all required prompt, skill, documentation, license, and runtime-resource files are present and all prohibited development, secret, state, backup, and virtual-environment paths are absent

#### Scenario: Global deployment files are absent

- **WHEN** the package is loaded on a machine without the current deployment configuration
- **THEN** its prompt and skill resources do not resolve runtime files through `/home/abelxiaoxing/.agents/`

#### Scenario: Forbidden workflow checkout is absent

- **WHEN** the package is built, packed, or loaded without `/home/abelxiaoxing/work/AbelWorkflow`
- **THEN** no package resource requires, modifies, references as a runtime dependency, or links to that checkout

### Requirement: First-phase scope boundary and roadmap

The first phase SHALL remain prompts-first and MUST NOT modify `packages/pi-subagents`, create non-runnable package agent Markdown, implement runtime agent registration, schedule a DAG, isolate work with worktrees, introduce a permission package, add a UI, modify AbelWorkflow, publish to npm, or persist workflow runtime state.
The technical documentation SHALL record later phases for a `pi-subagents` agent-source registration API, workflow-owned professional agent Markdown, an Abel dependency/conflict-key orchestrator, deterministic Gate receipt and artifact SHA-256 tooling, and an optional single-command meta package without implementing them in this change.

#### Scenario: First-phase package is inspected

- **WHEN** the first-phase implementation diff is reviewed
- **THEN** it contains prompts, skills, package metadata, documentation, tests, registration, and index updates but none of the deferred runtime or orchestration implementations

#### Scenario: Roadmap is read

- **WHEN** a maintainer reads the technical design
- **THEN** the five later directions are clearly separated from the current change and are not presented as already runnable behavior
