# abel-workflow-prompt-package Specification

## Purpose
Provide a self-contained, installable Pi package that exposes the Abel four-stage workflow and its required skills without depending on a subagent runtime or machine-local workflow configuration.
## Requirements
### Requirement: Standalone installable workflow package

The system SHALL provide the standalone package as `@abelxiaoxing/cadence` and make it independently loadable from local absolute and relative package directories, from the published npm registry package, and from an isolated package directory produced by installing or unpacking its real tarball.
The supported user interface SHALL remain the four established workflow commands and four established skills while package loading additionally registers the private workflow orchestration extension and package-owned professional Agents.
The package SHALL NOT require users to copy Agent definitions into user or project Agent directories.
The package MUST NOT inspect the Pi host version, reject or warn based on it, maintain a host-version compatibility matrix, or claim a supported Pi version range.
The development host used by tests is reproducibility evidence only and is not a product compatibility contract.
The package SHALL be published to the npm registry and to pi packages under `@abelxiaoxing/cadence`; publication SHALL NOT promise installation from the relocated reference-monorepo Git source.

#### Scenario: Local package directory installation succeeds

- **WHEN** a user installs or loads the standalone package by an absolute or relative local package directory
- **THEN** Pi discovers the four workflow prompts, four bundled skills, private extension, and package-owned professional Agents without reference-monorepo configuration

#### Scenario: Future npm installation preserves resources

- **WHEN** the package has been published to the npm registry and a user installs `@abelxiaoxing/cadence` at user or project scope
- **THEN** Pi discovers the same prompts, skills, private extension, and professional Agents without requiring a second Agent installation

#### Scenario: Host version is not classified

- **WHEN** the extension loads on a Pi host
- **THEN** the package neither probes nor classifies the host version as supported, unsupported, verified, or unverified

#### Scenario: Publication limits are documented

- **WHEN** a user reads delivery guidance for this change
- **THEN** it distinguishes verified local-directory, installed-tarball-directory, and published npm-registry loading and does not promise installation from the relocated reference-monorepo Git source

### Requirement: Private-orchestration MVP scope boundary

This change SHALL establish the standalone package, package-owned professional Agent definitions, a private in-memory read-only execution kernel, bounded Design and task-DAG dispatch, compact structured delivery, file-related snapshot validation, parent-side patch checking and application, cancellation, and independent engineering verification.
It SHALL use one explicitly bounded seed wave only to establish the standalone package and minimum runnable private Worker and patch-application path; subsequent semantic orchestration and workflow integration work SHALL use Worker-generated diffs.
It MUST NOT introduce a general Subagent command, supported public orchestration API, cross-extension service, user or project Agent overrides, background Agent management, result query or resume commands, UI, worktree or container isolation, permission package, interactive tool approval, private orchestration persistence, custom transaction or rollback platform, multi-level budget platform, host-version compatibility platform, npm publication, remote-repository creation, or automatic release configuration.
Gate A and Gate B SHALL remain product and implementation contract approvals and SHALL NOT become tool-permission approvals.

#### Scenario: MVP package excludes a general platform

- **WHEN** the implementation and real package artifact are reviewed
- **THEN** they contain the approved private workflow capability and none of the excluded general platform, UI, isolation, permission, persistence, compatibility, publication, or release features

#### Scenario: Seed wave remains bounded

- **WHEN** the minimum standalone Worker and patch-application path has passed its seed acceptance
- **THEN** the one-time parent bootstrap exception ends and remaining semantic implementation is delivered through task-local Worker diffs

#### Scenario: Gate approval is not tool permission

- **WHEN** Design presents Gate A or Gate B
- **THEN** the user approves behavior or implementation contracts without an additional tool-permission flow

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
Before Gate A it SHALL remain read-only, decompose broad exploration into bounded evidence packets, dispatch independent packets concurrently through package-owned read-only professional Agents, validate their compact structured evidence, and submit every blocking non-mechanical decision to the user.
The parent Agent SHALL NOT silently replace failed delegated exploration with its own broad exploration.
It SHALL separately obtain Gate A for the behavioral contract and Gate B for the technical implementation contract.
After Gate A it SHALL write only inside the resolved OpenSpec change root according to the artifact graph.
It SHALL define executable verification and AGENTS-impact contracts for every implementation task.
It SHALL report `READY_TO_IMPLEMENT` only when strict validation, receipts, hashes, traceability, artifact completeness, trusted delegated evidence, and zero blocking decisions all pass.

#### Scenario: New design reaches Gate A

- **WHEN** all behavior decisions are resolved and every required evidence packet is trusted
- **THEN** `abel-design` presents the behavioral contract and waits for explicit Gate A approval before creating a new change

#### Scenario: Independent Design packets run concurrently

- **WHEN** broad exploration has independent bounded evidence packets
- **THEN** Design dispatches them concurrently within the runtime limit and validates every returned packet before synthesis

#### Scenario: Delegated Design evidence remains untrusted

- **WHEN** a required packet is malformed, uncited, out of scope, cancelled, incomplete, or still untrusted after its allowed mechanical redispatch
- **THEN** Design blocks the affected decision path without entering its next Gate or silently performing broad replacement exploration

#### Scenario: Existing change is resumed

- **WHEN** a user invokes `abel-design --change <change_name>`
- **THEN** the workflow validates the resolved change, receipts, artifact hashes, traceability, and strict delivery before trusting completed Gates

#### Scenario: Artifact integrity is invalid

- **WHEN** a receipt is missing, a covered artifact hash differs, or the artifact graph is inconsistent
- **THEN** Design resumes from the earliest affected stage and does not report implementation readiness

#### Scenario: Design is complete

- **WHEN** both Gates are approved and all delivery checks pass
- **THEN** the workflow reports `READY_TO_IMPLEMENT` without modifying product code or repository AGENTS indexes

### Requirement: Implementation behavior

`abel-implement` SHALL require a change name and validate the design delivery in a fresh context before modifying code or tests.
It SHALL return to Design rather than recreate decisions when delivery validation fails.
Before writing, it SHALL run and record target, affected-suite, and full-suite baselines with stable failure identities and separate every pre-existing failure from the task Red.
Each task's exact affected-suite commands SHALL define that task's dynamic repair boundary: every reproducible pre-existing failure they expose SHALL enter the task for verified root-cause analysis and minimum repair, while a full-suite-only baseline failure outside those commands SHALL not.
Environmental, transient, external-service-dependent, non-reproducible, or unattributable failures SHALL block completion without authorizing speculative product edits.
A repair that requires new behavior, policy, dependency, architecture, irreversibility, or another substantive decision SHALL return to Design.

Implementation SHALL recompute ready work from the trusted task DAG and MAY dispatch compatible ready tasks concurrently only when their prerequisites, declared read and write sets, conflict edges, shared resources, and validation locks permit it.
Each Worker result SHALL bind hashes for the files it actually read and every path it proposes to create, modify, or delete.
The parent SHALL review and apply accepted results serially.
A sibling result SHALL remain current after an unrelated file changes, but SHALL become stale before application if any file in its bound read or write snapshot changed.
A stale result MUST NOT be applied and MAY receive only the single allowed identical mechanical redispatch.
Red, Green, and optional Refactor results SHALL each bind a fresh current file snapshot.

Task-local professional Agents SHALL return complete unified diffs without writing the workspace or running validation.
The parent SHALL exclusively accept or reject results, apply exact accepted diffs, run approved commands, return compact normalized validation evidence, update AGENTS indexes, and advance task state.
It SHALL run target verification after every applied code or test diff, run the affected suite after refactoring, update AGENTS indexes only at stable task checkpoints, and finish only when target and affected verification pass and the full suite has no new failure relative to baseline.
It SHALL NOT modify unrelated dirty files or implicitly archive or publish the change.

#### Scenario: Valid cross-context handoff

- **WHEN** receipts, artifact hashes, traceability, strict validation, and task contracts are valid in a fresh context
- **THEN** implementation proceeds without requesting either Gate again

#### Scenario: Compatible tasks produce parallel results

- **WHEN** multiple ready tasks have accepted prerequisites and compatible declared scopes, conflicts, resources, and validation locks
- **THEN** their read-only Workers may run concurrently within the runtime limit while the parent retains serial result review and application

#### Scenario: Unrelated sibling application preserves currency

- **WHEN** two concurrent results bind disjoint file snapshots and the parent applies the first result
- **THEN** the second result remains eligible for review because none of its bound read or write files changed

#### Scenario: Related file change makes a result stale

- **WHEN** a file in a result's bound read or write snapshot changes before that result is applied
- **THEN** the parent rejects it as stale and does not apply it without an allowed identical redispatch

#### Scenario: Worker delivers a task phase

- **WHEN** a task Worker returns a trusted Red, Green, or Refactor result with a complete in-scope unified diff bound to the current file snapshot
- **THEN** the parent may accept and apply that exact diff, run the approved verification, and retain sole ownership of AGENTS and task-state changes

#### Scenario: Worker diff exceeds its result boundary

- **WHEN** a Worker cannot return its complete unified diff within the configured result-size limit
- **THEN** implementation blocks the task and returns to Design to split it rather than accepting a truncated diff

#### Scenario: Affected-suite baseline is green

- **WHEN** every exact affected-suite command passes before task writes
- **THEN** implementation proceeds without dynamically adding a repair to the task

#### Scenario: Existing affected failure is present

- **WHEN** an exact affected-suite command exposes a reproducible pre-existing failure
- **THEN** the failure is recorded separately from task Red and enters the task only for verified root-cause analysis and minimum repair

#### Scenario: Later run reveals a previously masked failure

- **WHEN** a later affected-suite run reveals a failure that an earlier run did not report
- **THEN** implementation attributes it as pre-existing or introduced and stops if attribution cannot be established

#### Scenario: Affected failure is environmental

- **WHEN** an affected failure is environmental, transient, external-service dependent, non-reproducible, or cannot be attributed
- **THEN** implementation reports an executable recovery condition and blocks without speculative repair

#### Scenario: Affected repair requires a substantive decision

- **WHEN** an included repair requires new behavior, policy, dependency, architecture, irreversibility, or another substantive decision
- **THEN** implementation returns the expanded requirement to Design

#### Scenario: Full-suite-only baseline failure exists

- **WHEN** the full-suite baseline has a pre-existing failure outside every exact affected-suite command
- **THEN** that failure remains baseline evidence and does not automatically enter the task

#### Scenario: Task Red fails for the wrong reason

- **WHEN** the specified Red command passes or fails for a reason other than its approved contract
- **THEN** implementation stops and returns the change to Design rather than improvising another verification

#### Scenario: Implementation completes

- **WHEN** every target and affected verification passes and the full suite has no new failure relative to baseline
- **THEN** the workflow reports completion without automatically archiving or publishing

### Requirement: Diagnosis behavior

`abel-diagnose` SHALL require a description of one or more existing bugs, delegate bounded read-only evidence collection and candidate-cause falsification to package-owned professional Agents, reproduce each issue, and verify each root cause before generating a fix.
For every verified root cause, a task-local Worker SHALL first return a complete failing-regression diff and, only after the parent applies it and confirms the approved Red command, return a minimum-repair diff bound to a fresh current file snapshot.
The parent SHALL remain solely responsible for applying diffs, running target and affected suites, returning compact validation evidence, updating AGENTS indexes at a stable checkpoint, and confirming no new full-suite failures relative to baseline.
If resolution requires new behavior, a substantive architecture decision, or a choice not uniquely determined by an existing contract, it SHALL stop and return the work to Design.

#### Scenario: Root cause is unverified

- **WHEN** a reported bug cannot be reproduced or its candidate root cause lacks confirming evidence
- **THEN** diagnosis marks it blocked and does not generate a repair

#### Scenario: Regression-first repair

- **WHEN** a root cause is verified
- **THEN** the Worker proposes a complete failing-regression diff before the minimum implementation fix

#### Scenario: Parent confirms regression Red

- **WHEN** the parent accepts and applies the regression diff and the approved command fails for the expected defect
- **THEN** the next repair request uses compact validation evidence and a fresh file snapshot

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

The package MUST NOT contain credentials, real `.env` files, virtual environments, backup files, user or session state, scheduling state, child-session transcripts, model outputs, or symbolic links to external workflow, configuration, or reference-repository locations.
It MUST NOT load, import, link to, or reference as a runtime, development, test, packing, or installation dependency `/home/abelxiaoxing/work/AbelWorkflow`, `/home/abelxiaoxing/.agents/`, either reference-repository path, `@gotgenes/pi-subagents`, or another `@gotgenes/*` package.
Read-only implementation evidence citations and required third-party attribution or license text SHALL not constitute product resolution dependencies.
Its tarball SHALL contain package metadata, user documentation, license and attribution, four prompts, four skills, the private extension runtime, package-owned professional Agent definitions, and required skill runtime resources while excluding development indexes, tests, OpenSpec artifacts, toolchain configuration, credentials, and runtime state.

#### Scenario: Tarball is inspected

- **WHEN** the real package tarball is created for validation
- **THEN** every required runtime, documentation, license, attribution, Prompt, Skill, extension, and Agent file is present while prohibited development, secret, state, backup, virtual-environment, and external-link paths are absent

#### Scenario: Global deployment files are absent

- **WHEN** the package is loaded without the current machine-local deployment configuration
- **THEN** no package resource resolves through `/home/abelxiaoxing/.agents/`

#### Scenario: Forbidden workflow checkout is absent

- **WHEN** the package is built, packed, installed, or loaded without `/home/abelxiaoxing/work/AbelWorkflow` and the reference repository
- **THEN** no supported resource resolves through those external locations

#### Scenario: Reference attribution remains self-contained

- **WHEN** the standalone package includes attribution or license material for adapted reference code
- **THEN** that material is packaged locally and does not require the reference checkout at runtime or during validation

#### Scenario: Delegation leaves no private state files

- **WHEN** professional Agent runs complete, fail, are cancelled, or the stage ends
- **THEN** the filesystem contains no private-runtime-created child transcript, result, model-output, queue, schedule, checkpoint, or Worker-session state file beyond Pi's ordinary host-owned parent transcript

### Requirement: Standalone repository extraction

The current target root SHALL become the standalone single-package source repository for `@abelxiaoxing/cadence` and SHALL NOT require a nested workspace or reference-monorepo directory for development, validation, packing, installation, or runtime use.
Before orchestration product implementation begins, the standalone package baseline SHALL be extracted and the complete reference `pi-packages` repository SHALL be relocated to `/home/abelxiaoxing/work/subagent/pi-packages` with its Git metadata, local commits, modified files, untracked files, and untracked workflow-package copy preserved.
The relocation MUST NOT delete, clean, overwrite, or normalize reference-repository content.
After relocation, implementation MAY inspect that repository as read-only implementation, attribution, license, or provenance evidence, but standalone source, imports, dependencies, tests, commands, symbolic links, packing, installation, and runtime resolution MUST NOT depend on either its old or relocated path.

#### Scenario: Reference repository state is preserved

- **WHEN** the standalone layout is established and the reference repository is relocated
- **THEN** the destination retains the complete pre-migration Git history, local commits, dirty files, and untracked files without cleanup or normalization

#### Scenario: Standalone root replaces nested workspace

- **WHEN** a maintainer inspects the standalone package directory after extraction
- **THEN** the root directly contains the single package source, tests, documentation, OpenSpec root, and AGENTS index without the nested reference workspace

#### Scenario: Reference evidence is consulted

- **WHEN** implementation needs to verify an adapted invariant, attribution, license, or provenance fact
- **THEN** it may read the relocated repository as evidence without modifying it or making a standalone product or validation path resolve through it

#### Scenario: Reference repository is unavailable to the product

- **WHEN** the relocated reference repository is absent while the standalone package is checked, tested, packed, installed, or loaded
- **THEN** every standalone command and supported package capability continues without resolving that repository

### Requirement: Independent engineering delivery

The standalone repository SHALL provide concrete Bun-based commands for checking, linting, target tests, the affected suite, the complete suite, and real package creation.
Its manifest and lockfile MUST NOT depend on a workspace catalog, workspace-filtered execution, the reference repository, or an `@gotgenes/*` package.
A real package artifact SHALL contain every required runtime resource while excluding development-only files and runtime state.
This change SHALL validate local absolute and relative package directories, create and inspect a real tarball, install or unpack that tarball into an isolated package directory, and load that directory with Pi.
It MUST NOT claim that Pi loads the tarball file itself as a local package or that an unpublished npm registry package was installed.
This change SHALL NOT publish the package, create a remote repository, or configure an automatic release system.

#### Scenario: Fresh standalone checkout is validated

- **WHEN** dependencies are installed in a fresh standalone checkout using the declared Bun toolchain
- **THEN** check, lint, target, affected, complete-suite, and pack commands run without a parent workspace, workspace catalog, reference repository, or `@gotgenes/*` package

#### Scenario: Installed tarball directory is loaded

- **WHEN** the produced tarball is inspected and installed or unpacked into an isolated package directory
- **THEN** Pi loads that directory and discovers all required prompts, skills, private extension, and package-owned Agent resources

#### Scenario: Tarball file is not treated as a local package directory

- **WHEN** distribution acceptance describes or executes tarball validation
- **THEN** it does not pass the `.tgz` file itself to Pi as though that local file were a complete Pi package

#### Scenario: Delivery performs no publication

- **WHEN** this change is completed
- **THEN** no npm publication, registry-install success claim, remote-repository creation, or automatic-publication configuration has occurred

