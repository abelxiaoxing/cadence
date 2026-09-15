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
Gate A SHALL record user authorization and Gate B SHALL be a compiler-owned plan proof; neither SHALL become a tool-permission approval.

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

### Requirement: Self-contained stage contracts

Each of the four prompts SHALL contain the instructions needed for its own stage without a shared workflow Skill prerequisite or full copies of other stage procedures. The package SHALL NOT distribute an `abel-workflow` Skill.
The stage prompts SHALL remain understandable when no user-global `AGENTS.md` provides Abel-specific instructions. Shared activation, Gate validation, delivery integrity, and durable execution invariants SHALL be enforced by their owning runtime modules; architecture explanations belong in ordinary documentation.
Gate A SHALL record behavioral authorization and Gate B SHALL certify the compiled technical realization; neither SHALL approve tool permissions.

#### Scenario: No global Abel context exists

- **WHEN** a user invokes one of the four prompts without an Abel-specific global `AGENTS.md`
- **THEN** the package resources still provide the core rules needed to execute that stage

#### Scenario: Gate is not a permission prompt

- **WHEN** the workflow reaches Gate A or Gate B
- **THEN** it requests approval of the relevant contract without introducing interactive tool authorization or a permission package

#### Scenario: Shared rules are maintained once

- **WHEN** a rule applies to multiple workflow stages
- **THEN** the owning runtime module enforces the invariant and each prompt describes only the stage-specific operation or decision needed from its parent

### Requirement: Initialization behavior

`abel-init` SHALL resolve one canonical target root, preserve baseline dirty and human-authored content, respect nested repository boundaries, select exactly one usable Bun-or-npm toolchain, and probe OpenSpec capability before and after any write.
It SHALL execute from its self-contained prompt without loading a shared workflow Skill. Generated AGENTS indexes SHALL describe repository locations and commands without requiring ordinary engineering work to enter an Abel workflow.
It SHALL initialize only an absent OpenSpec root and otherwise repair only missing or mechanically invalid configuration without `--force` or wholesale replacement.
It SHALL create or update only verified marker-bounded AGENTS regions, preserve every byte outside those regions, never edit `openspec/AGENTS.md`, and be idempotent for a second identical invocation.
Missing optional bundled research Skills SHALL make final readiness partial with executable remediation but SHALL NOT prevent safe OpenSpec or AGENTS repair.

#### Scenario: Init has no shared workflow dependency

- **WHEN** the package exposes its Init prompt without any shared workflow Skill
- **THEN** initialization uses its own deterministic procedure and does not request restoration of a removed resource

#### Scenario: Research skills are available

- **WHEN** `context7-auto-research` and `grok-search` are discoverable during initialization
- **THEN** the final report identifies their resolved discovery paths

#### Scenario: Research skill is missing

- **WHEN** either bundled research Skill cannot be discovered
- **THEN** initialization can still complete OpenSpec and AGENTS repair, but reports partial readiness and actionable resource remediation

#### Scenario: Non-init skills are absent

- **WHEN** `git-commit`, browser automation, or a dedicated `time` Skill is unavailable during initialization
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

#### Scenario: Existing project is initialized twice

- **WHEN** Init completes successfully and the same request is invoked again without an external project change
- **THEN** the second run performs the same post-write capability checks and produces no additional repository change

#### Scenario: Optional research Skill is missing

- **WHEN** OpenSpec and AGENTS repair can succeed but a bundled research Skill cannot be resolved
- **THEN** Init completes the safe repair, reports partial readiness, and supplies package-resource remediation rather than failing or dispatching a Worker

### Requirement: Design behavior and trusted delivery

`abel-design` SHALL accept either a requirement or `--change <change_name>`, validate the root and relevant AGENTS indexes, and create or recover one durable Design run.
It SHALL use one Design action envelope from the initial start onward: the caller supplies transient requirement and canonical contract text, the control plane derives provisional and contract hashes without persisting that raw text, and Gate B automatically binds the current compiled plan hash.
Before Gate A it SHALL keep the repository and OpenSpec change artifacts read-only while permitting only private structural run state outside the repository.
It SHALL decompose broad exploration into bounded evidence packets, dispatch independent packets concurrently through package-owned read-only professional Agents, validate their structured evidence, and retain accepted evidence in the run ledger independently of any child session.
A transport, endpoint, environment, capacity, cancellation, or malformed-evidence failure SHALL pause only the affected evidence packet and SHALL permit policy-authorized Worker replacement; it SHALL NOT force completed independent evidence to be repeated.
The parent Agent SHALL remain responsible for evidence validation and SHALL NOT silently treat an untrusted packet as proof.

Design SHALL present unresolved behavior and substantive technical choices together; Gate B SHALL be generated by the compiler without a separate user approval round.
Reversible mechanical decisions uniquely determined by repository facts or an approved contract SHALL be recorded without interrupting the user, and related substantive decisions SHALL be presented together. For clear requirements, Design SHALL aim for one consolidated round covering behavior, technical choices, and authority to compile their mechanical realization; the compiler SHALL produce Gate B from that accepted authority without a separate confirmation when no new substantive choice is introduced.
After Gate A it SHALL write only inside the resolved OpenSpec change root according to the artifact graph and approved behavior contract.

Design SHALL produce one canonical machine-readable implementation plan containing every task, explicit dependency, phase scope, verification-input binding, output provenance and postcondition, approved dependency, impact closure, scheduling declaration, and AGENTS-impact contract.
A code-owned delivery compiler SHALL validate and canonicalize that plan, calculate its identity and verification closure, and generate the receipt bindings; the parent model SHALL NOT hand-assemble a Runtime graph admission, graph hash, dynamic file snapshot, or operation identity.
Before Gate B and again before final readiness, Design SHALL require strict OpenSpec validation, a complete trace from Requirement to Scenario to Verification to Task, and an executable static verification closure with no diagnostics.
The ready receipt SHALL bind the exact compiled plan artifact and its canonical identity by safe relative path and hash rather than embedding an alternate caller-supplied graph copy.
Design SHALL report `READY_TO_IMPLEMENT` only when both Gates, receipts, artifact hashes, traceability, plan compilation, closure, and zero blocking decisions all pass.
Design SHALL NOT launch an implementation Worker, create or apply a product candidate, run product validation, execute Red-Green-Refactor, or modify AGENTS indexes.
Mechanical receipt, hash, formatting, tracked-checkbox, traceability, or stale-artifact repair SHALL invalidate only the affected artifact and SHALL NOT reopen an unchanged Gate.

#### Scenario: New design reaches Gate A

- **WHEN** behavior evidence is trusted and all behavior decisions are resolved
- **THEN** Design presents one consolidated behavior contract and waits for explicit Gate A approval before creating a new OpenSpec change

#### Scenario: Design begins without caller hashing tools

- **WHEN** a parent starts Design from a raw requirement or records a decision or Gate A approval
- **THEN** the control plane derives the required canonical hash and persists no raw transient contract text

#### Scenario: Independent Design packets run concurrently

- **WHEN** broad exploration has independent bounded evidence packets
- **THEN** Design may run them concurrently and durably retain each trusted result independent of sibling or Provider failure

#### Scenario: Delegated Design evidence remains untrusted

- **WHEN** a required packet is malformed, uncited, out of scope, cancelled, incomplete, or still untrusted after its automatic policy
- **THEN** only that evidence path pauses and Design does not treat it as proof or enter a Gate that depends on it

#### Scenario: Evidence Worker becomes unavailable

- **WHEN** an evidence packet cannot complete under its current Worker route
- **THEN** that packet pauses with typed status and may resume under an allowed replacement without invalidating trusted sibling evidence

#### Scenario: Mechanical choices remain non-blocking

- **WHEN** a reversible design detail is uniquely determined by repository convention and changes no approved observable behavior
- **THEN** Design records it for Gate review without creating a separate blocking question

#### Scenario: Existing change is resumed

- **WHEN** a user invokes `abel-design --change <change_name>` after process or model replacement
- **THEN** Design validates durable run state, receipts, artifact hashes, traceability, and current OpenSpec status and continues from the earliest valid checkpoint

#### Scenario: Artifact integrity is invalid

- **WHEN** a receipt is missing, a covered artifact hash differs, or the compiled plan and artifact graph are inconsistent
- **THEN** Design pauses at the earliest affected Gate, retains unrelated trusted evidence, and does not report implementation readiness

#### Scenario: Delivery is compiled

- **WHEN** the approved technical plan is complete
- **THEN** the code-owned compiler produces its canonical identity and closure while the caller supplies neither graph hashes, Gate B hashes, nor file snapshots

#### Scenario: Design is complete

- **WHEN** both Gates are approved and all delivery checks pass
- **THEN** Design binds the compiled plan artifact in the ready receipt and reports `READY_TO_IMPLEMENT` without modifying product code or AGENTS indexes

#### Scenario: Mechanical delivery evidence changes

- **WHEN** a resumed Design run finds a mechanical receipt, hash, formatting, checkbox, traceability, or stale-artifact defect while approved behavior and technical authority are unchanged
- **THEN** it regenerates only the invalidated artifacts, preserves compatible decisions and evidence, and does not request Gate A or Gate B again

#### Scenario: Design evidence is collected

- **WHEN** Design needs repository evidence for an approved question
- **THEN** it may use bounded read-only evidence packets but never starts an implementation phase or runs product validation

### Requirement: Implementation behavior

`abel-implement` SHALL require a unique change name and SHALL create, return, or resume one durable Implement run through the change-oriented control protocol.
Before creating a private change workspace it SHALL validate the current receipts, covered artifact hashes, traceability, strict OpenSpec status, compiled plan identity, static verification closure, and complete task contracts.
Invalid delivery SHALL reject or pause the run before Worker execution and SHALL NOT modify the main workspace.
Invalid or mechanically stale delivery SHALL NOT be classified as approval-needed unless its diagnostics separately prove missing authority.
The control plane SHALL load the approved plan, derive current snapshots and operation identities, and compute ready DAG work without requiring the parent model to submit or repeat stable graph facts.

Before candidate work, the parent SHALL record target, affected-suite, and full-suite baselines with stable normalized failure identities and SHALL keep pre-existing failures separate from task Red.
The run SHALL create a private cumulative change workspace from the approved current baseline.
Every Red, Green, Refactor, generated output, compatibility repair, AGENTS checkpoint, and verification operation SHALL occur in that workspace until change-level verification succeeds.
Professional Agents SHALL remain unable to mutate either workspace or run validation commands; the parent-owned control plane SHALL exclusively validate and apply sealed candidates to the private change workspace.

Each task SHALL retain an authoritative structured context ledger containing the approved objective and boundary, previous phase commands and normalized results, accepted candidate identities, current isolated snapshot, produced outputs, and bounded correction evidence.
A later phase or replacement Worker SHALL receive the relevant ledger facts and SHALL NOT depend on a prior child session remaining alive.
Red SHALL commit only after the approved verification witnesses the target failure for the approved identity.
Green SHALL implement the minimum approved behavior and keep the target verification green after every accepted edit.
Refactor SHALL remain inside the approved behavior and paths while target and affected verification remain green.

The durable scheduler SHALL derive readiness from the approved DAG and committed run facts.
Conflicting work SHALL remain queued and automatically become eligible when its declared path, resource, verification, or AGENTS conflict clears.
Independent work SHALL remain valid after a sibling pauses, retries, requires approval, or completes.
Declared outputs SHALL become available to dependent tasks only after their producer and required task verification commit in the cumulative workspace.

Transport, endpoint, environment, capacity, artifact, stale, resource, verification, and repairable compatibility failures SHALL produce typed recoverable states rather than terminal task blockers.
Automatic policies SHALL be bounded and independently accounted; exhaustion SHALL pause for explicit resume, typed route `rebind`, Worker replacement, task reshaping, or approval revision without erasing committed work.
Cancellation SHALL interrupt the active operation, reject partial output, and preserve the last committed resumable checkpoint; after final apply mutates any main-workspace file, cancellation or discard SHALL first settle the journaled transaction through recovery.
A required behavior, policy, dependency, architecture, path, conflict, resource, verification, or AGENTS expansion SHALL enter approval-needed internally until the parent records its recommended implementation choice and compiles revised authority under the accepted Design. This state SHALL NOT itself require a user answer; Workers SHALL NOT expand their own authority.
No ordinary failure outcome SHALL contain workflow-stage routing metadata, a `nextStep`, or an automatic instruction to invoke `/abel-design`.
Only a proven expansion of sealed authority SHALL use approval-needed; artifact, wrong-Red, transport, endpoint, environment, capacity, stale, conflict, cancellation, baseline, verification-attribution, approved AGENTS checkpoint, and introduced in-boundary repair failures SHALL remain paused, retryable, queued, repairable, or recovering in the same Implement run.

When every task and affected verification is green, the control plane SHALL run the approved full-suite comparison and output postconditions against the cumulative private workspace.
An introduced failure SHALL return the owning in-boundary task to repairable work; an unresolved or out-of-boundary failure SHALL pause with typed attribution evidence.
Only after the cumulative change, full suite, output postconditions, and AGENTS checkpoint succeed SHALL final application become eligible.
Final application SHALL compare the main workspace with its bound baseline, preserve unrelated dirty files, reject stale bound files, and commit the cumulative change through a recoverable transaction.
The run SHALL become completed only after application and required post-apply checks commit.
Implement SHALL NOT implicitly archive, commit, publish, release, or modify unrelated user files.

#### Scenario: Valid cross-context handoff

- **WHEN** the caller supplies a unique change name whose current delivery is valid
- **THEN** the control plane derives the compiled plan and creates or returns the one matching durable run without caller-supplied graph or snapshots

#### Scenario: Invalid trusted delivery

- **WHEN** a receipt, artifact hash, traceability link, plan identity, closure, or strict validation is invalid
- **THEN** Implement reports a typed paused or rejected delivery state before Worker execution, changes no main-workspace file, and does not request approval unless a separate diagnostic proves missing authority

#### Scenario: Ordinary Implement failure occurs

- **WHEN** an approved in-boundary task encounters an artifact, wrong-Red, transport, environment, stale, conflict, baseline, or verification-attribution failure
- **THEN** the same run retains compatible progress and exposes a typed pause, retry, repair, rebind, or resume outcome without selecting Design or another workflow stage

#### Scenario: Worker delivers a task phase

- **WHEN** a sealed Red candidate passes parent-owned isolated validation and witnesses the approved target failure
- **THEN** it advances Red only in the private change workspace and records normalized evidence in the task ledger

#### Scenario: Stable facts are replayed

- **WHEN** Green starts under a new child session or replacement Worker
- **THEN** it receives the approved Red command, normalized failure identity, accepted Red artifact facts, current isolated snapshot, and unchanged task boundary

#### Scenario: Worker route fails

- **WHEN** the current implementation Worker route exhausts its bounded transport policy
- **THEN** the task pauses and may resume under an allowed replacement while committed Red, sibling work, and retry classifications remain intact

#### Scenario: Conflicting task is opened

- **WHEN** a ready task conflicts with active task-lifetime declarations
- **THEN** the scheduler keeps it durably queued and admits it automatically after the conflict clears

#### Scenario: Related file change makes a result stale

- **WHEN** a file bound by a candidate changes before private-workspace acceptance
- **THEN** none of that candidate is accepted, the task becomes retryable with a fresh snapshot, and no main-workspace file changes

#### Scenario: Verification finds an introduced failure

- **WHEN** target, affected, or change-level verification finds a failure attributable to in-boundary cumulative work
- **THEN** the owning task becomes repairable and cannot be marked completed until the repair is verified

#### Scenario: Repair requires boundary expansion

- **WHEN** a repair requires unapproved behavior or technical authority
- **THEN** Implement pauses as approval-needed, retains the private workspace, and applies no wider change until the required Gate revision is approved

#### Scenario: Main workspace changed

- **WHEN** a bound main-workspace path differs from the baseline used by the verified cumulative change
- **THEN** final application preserves that user change, writes none of the stale cumulative transaction, and pauses for rebase and revalidation

#### Scenario: Task boundary is opened

- **WHEN** the compiled plan makes a Red task ready for its first Worker attempt
- **THEN** the control plane derives and durably binds its immutable approved boundary before dispatch without accepting caller-restated stable facts

#### Scenario: Compatible tasks produce parallel results

- **WHEN** two ready tasks have satisfied dependencies and disjoint path, resource, verification-lock, and AGENTS declarations
- **THEN** they may run against isolated child workspaces and merge independently after currentness checks

#### Scenario: Unrelated sibling application preserves currency

- **WHEN** one accepted task merges into the cumulative workspace without changing a file bound by an independent sibling candidate
- **THEN** the sibling remains current and may continue without redispatch

#### Scenario: Candidate artifact cannot load or has the wrong Red identity

- **WHEN** disposable-workspace preflight finds an incomplete artifact, source or test load failure, missing target test, wrong command, wrong Red identity, or unexpectedly passing Red
- **THEN** none of the candidate is accepted and the task enters typed artifact correction or paused state inside its approved boundary

#### Scenario: Artifact correction budget is exhausted

- **WHEN** the canonical plan's 2-3 automatic candidate-attempt bound for one verification obligation and phase is exhausted by typed artifact rejection
- **THEN** the task pauses with the final safe artifact evidence and may receive one explicit parent-authorized attempt within the retained cumulative budget without resetting automatic exhaustion

#### Scenario: Green reports a same-task Red constraint

- **WHEN** Green reports citations to an accepted same-task Red test, a contract diagnostic, or an erroneous AGENTS assumption rather than a genuinely new product path
- **THEN** Implement types those refs, preserves compatible Red evidence, reopens bounded artifact correction under the existing attempt limit, and does not emit approval-needed or a Design request

#### Scenario: Persisted context approval is locally recoverable

- **WHEN** status or resume encounters a legacy boundary-review-needed approval whose normalized requested paths prove no new authority
- **THEN** Implement atomically reclassifies the same run and delivery to a recoverable artifact pause while genuine retained approvals still require a newer receipt

#### Scenario: Repair budget is exhausted

- **WHEN** bounded automatic in-boundary repair attempts are exhausted
- **THEN** the run pauses at its last committed phase; exhausted artifact, stale-candidate, and verification correction remains exhausted across unchanged `resume`, and internal revision changes, rewording, task renaming, and route replacement SHALL NOT replenish the same exhausted obligation

#### Scenario: Worker patch exceeds its candidate boundary

- **WHEN** the generated diff for one complete structured patch exceeds the configured candidate byte limit
- **THEN** the trusted submit tool internally chunks and seals one complete Worker submission, or Implement attempts bounded compact-patch correction before pausing for reshaping; no truncated or partial candidate is accepted

#### Scenario: Cancellation interrupts a launch

- **WHEN** cancellation interrupts a child launch, preflight, verification, or apply preparation before commit
- **THEN** partial output is rejected and the run returns to its last durable resumable checkpoint without consuming an unrelated policy budget

#### Scenario: Runtime apply advances a phase

- **WHEN** a sealed candidate passes parent-owned preflight, is applied to the private cumulative workspace, and its approved verification and outputs succeed
- **THEN** only the Runtime-owned committed fact advances the task phase

#### Scenario: Parent reports verification without apply

- **WHEN** a caller reports successful verification without a matching Runtime-owned candidate acceptance and execution fact
- **THEN** no phase, output, checkpoint, task, or change state advances

#### Scenario: Approved compatibility path fails

- **WHEN** an approved existing compatibility test or fixture fails because of cumulative in-boundary work
- **THEN** the owning task becomes repairable in the private workspace and cannot complete until the failure is repaired or reverted

#### Scenario: Affected-suite baseline is green

- **WHEN** the affected-suite baseline is green and later cumulative verification fails
- **THEN** the failure is classified as introduced and final application remains ineligible until repair succeeds

#### Scenario: Existing affected failure is present

- **WHEN** affected verification has a reproducible baseline failure before candidate work
- **THEN** the control plane records it separately and does not use it as task Red or attribute it to the cumulative change without evidence

#### Scenario: Later run reveals a previously masked failure

- **WHEN** a later affected run exposes a baseline failure that was previously masked by ordering or environment
- **THEN** the control plane rechecks attribution and pauses unresolved ownership rather than guessing or marking completion

#### Scenario: Affected failure is environmental

- **WHEN** affected verification fails because of a reproducible environment capability problem
- **THEN** the run pauses as environment-unavailable with its private workspace intact and does not authorize speculative code changes

#### Scenario: Affected repair requires a substantive decision

- **WHEN** repairing an affected failure changes approved behavior, architecture, policy, dependency, or scope
- **THEN** the run becomes approval-needed at the owning Gate and preserves the cumulative workspace without applying wider authority

#### Scenario: Full-suite-only baseline failure exists

- **WHEN** full-suite baseline contains a reproducible failure outside every affected contract
- **THEN** it remains baseline evidence outside task scope and does not prevent completion unless the cumulative change introduces or worsens it

#### Scenario: Task Red fails for the wrong reason

- **WHEN** the approved Red command fails without witnessing its approved target identity
- **THEN** Red does not advance and the candidate enters typed artifact correction or verification-contract review

#### Scenario: Task Red contract is invalid

- **WHEN** separate evidence proves the approved verification cannot witness the approved behavior under the current contract
- **THEN** the run becomes approval-needed for a verification-contract revision without consuming artifact-correction policy

#### Scenario: AGENTS checkpoint is required

- **WHEN** cumulative task work declares an approved AGENTS impact
- **THEN** the parent-owned managed-only checkpoint and its verification must succeed in the private change workspace before final application eligibility

#### Scenario: Terminal task is replayed

- **WHEN** a valid command replays a completed, discarded, or deterministically rejected run fact
- **THEN** the control plane returns that committed terminal fact idempotently without launching a child or mutating the workspace

#### Scenario: Implementation completes

- **WHEN** every task, output, affected verification, full-suite comparison, AGENTS checkpoint, final application, and required post-apply check succeeds
- **THEN** the run becomes completed, cleans private change content, and reports no new failure relative to baseline

### Requirement: Diagnosis behavior

`abel-diagnose` SHALL operate independently from Implement run state, delivery revisions, retry budgets, approval codes, and recovery routing.
For each existing defect it SHALL keep the order reproduction, active falsification of plausible causes, an executable failing regression that witnesses the defect, and the minimum in-contract repair.
The parent SHALL run reproduction and verification and apply accepted candidates; a diagnosis Worker SHALL remain read-only, submit one cited evidence object or one complete candidate diff, and SHALL NOT claim an unobserved command result.
If evidence is insufficient or an external capability is unavailable, Diagnose SHALL pause with the exact retained evidence and resume condition rather than inventing a repair.
A request that actually requires new observable behavior, dependency, path, architecture, or policy SHALL produce a user scope decision; an ordinary diagnosis or repair failure SHALL NOT be transformed into a stage transition.

#### Scenario: Root cause is unverified

- **WHEN** a reported bug cannot be reproduced or its candidate root cause lacks confirming evidence
- **THEN** Diagnose pauses with the evidence gap and does not generate a repair

#### Scenario: Regression-first repair

- **WHEN** a root cause is verified
- **THEN** the Worker proposes one complete failing-regression diff before any minimum implementation repair is requested

#### Scenario: Parent confirms regression Red

- **WHEN** the parent accepts and applies the regression diff and the approved command fails for the expected defect
- **THEN** the separate minimum-repair request receives compact validation evidence and a fresh current snapshot

#### Scenario: Requested fix changes behavior

- **WHEN** fixing the report requires a new behavioral contract or substantive architecture
- **THEN** Diagnose reports the exact user scope decision without selecting another workflow stage or silently expanding authority

#### Scenario: Existing defect is repaired

- **WHEN** the symptom is reproduced, competing causes are materially falsified, and the smallest regression fails for the verified root cause
- **THEN** Diagnose applies the minimum repair, proves the regression and affected suite green relative to baseline, and reports only evidenced results

#### Scenario: Root cause is not proven

- **WHEN** reproduction is unavailable, falsification remains inconclusive, or the regression fails for setup or another reason
- **THEN** Diagnose pauses with the evidence gap and concrete resume condition and does not invent or apply a repair

#### Scenario: Diagnosis requires new product scope

- **WHEN** resolving the request requires new behavior, architecture, policy, dependency, or wider paths rather than repairing the existing contract
- **THEN** Diagnose reports the exact scope decision for the user without selecting Design, inheriting Implement state, or silently widening authority

### Requirement: Bundled and external skills

The package SHALL bundle discoverable skills named `context7-auto-research`, `grok-search`, and `git-commit` together with the distributable runtime resources required by those skills.
The workflow SHALL NOT automatically commit merely because `git-commit` is installed.
The dedicated `time` skill SHALL NOT be a distributed or validated prerequisite.
Unavailable browser automation SHALL block only checks whose approved verification contract requires it.

#### Scenario: Bundled skills are discovered

- **WHEN** the package is loaded independently
- **THEN** Pi discovers exactly the three bundled skill names from the package skill surface

#### Scenario: Commit skill is present without a commit request

- **WHEN** a workflow stage completes and the user has not requested a commit
- **THEN** the workflow does not invoke `git-commit` or commit automatically

#### Scenario: Browser E2E is not required

- **WHEN** a task's approved verification contract has no browser E2E step
- **THEN** unavailable browser automation does not block the task or other workflow stages

#### Scenario: Browser E2E is required but unavailable

- **WHEN** an approved task requires browser E2E and browser automation is unavailable
- **THEN** only the affected check pauses with the missing capability and an executable remediation rather than reporting a passing verification

### Requirement: Safe package contents and independence

The package MUST NOT contain credentials, real `.env` files, virtual environments, backup files, user run data, child-session transcripts, model outputs, or symbolic links to external workflow, configuration, state, or reference-repository locations.
It MUST NOT load, import, link to, or reference as a runtime, development, test, packing, or installation dependency `/home/abelxiaoxing/work/AbelWorkflow`, `/home/abelxiaoxing/.agents/`, either reference-repository path, `@gotgenes/pi-subagents`, or another `@gotgenes/*` package.
Read-only implementation evidence citations and required third-party attribution or license text SHALL not constitute product resolution dependencies.
Its tarball SHALL contain package metadata, user documentation, license and attribution, four prompts, three skills, the private extension runtime, package-owned professional Agent definitions, and required runtime resources while excluding development indexes, tests, OpenSpec artifacts, toolchain configuration, credentials, and runtime state.

At runtime the package MAY create only the approved owner-private control-plane journal, sealed artifacts, and change workspace outside the package, project repository, and OpenSpec change root.
It MUST NOT persist raw prompts, hidden reasoning, complete child transcripts, raw model outputs, credentials, endpoint secrets, or environment values.
Completed and discarded runs SHALL clean their private code and artifact content idempotently; paused and approval-needed runs SHALL retain only the data authorized by the run-retention contract.

#### Scenario: Tarball is inspected

- **WHEN** the real package tarball is created for validation
- **THEN** every required runtime, documentation, license, attribution, Prompt, Skill, extension, and Agent file is present while prohibited development, secret, state, backup, virtual-environment, and external-link paths are absent

#### Scenario: Global deployment files are absent

- **WHEN** the package is loaded without machine-local deployment configuration
- **THEN** no package resource resolves through `/home/abelxiaoxing/.agents/`

#### Scenario: Forbidden workflow checkout is absent

- **WHEN** the package is built, packed, installed, or loaded without the reference workflow checkouts
- **THEN** no supported resource resolves through those external locations

#### Scenario: Reference attribution remains self-contained

- **WHEN** the standalone package includes attribution or license material for adapted reference code
- **THEN** that material is packaged locally and does not require a reference checkout at runtime or during validation

#### Scenario: Paused run state is inspected

- **WHEN** an eligible Abel run is paused
- **THEN** its approved private journal and change workspace exist only in the owner-private runtime location and contain no credential, raw prompt, or raw child transcript

#### Scenario: Finished run state is inspected

- **WHEN** a run completes or is explicitly discarded and cleanup settles
- **THEN** no private code workspace, sealed candidate, child transcript, raw model output, queue, or retry ledger for that run remains in package or repository locations

#### Scenario: Delegation leaves no private state files

- **WHEN** a run completes or is discarded and recoverable cleanup finishes
- **THEN** delegation leaves no private-runtime-created code workspace, sealed result, child transcript, model output, queue, schedule, or task ledger for that run in package, project, or OpenSpec locations

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

### Requirement: Explicit invocation and stage isolation

The private dispatch tool SHALL become active only after a user explicitly invokes a package-proven `/abel-design`, `/abel-implement`, or `/abel-diagnose` prompt; `/abel-init` SHALL remain local and dispatch-free.
Merely discovering prompt or Skill files, an OpenSpec change, an AGENTS index entry, or ordinary text mentioning Abel SHALL NOT activate workflow authority.
Only interactive or RPC user input SHALL supply invocation authority. Extension-generated commands SHALL be stopped before prompt expansion.
Each active stage SHALL admit only its own command or bounded packet schema plus the exact session-exit envelope `{"action":"finish"}`, and no stage SHALL inherit another stage's write, Gate, retry, or recovery authority. Inactive dispatch execution SHALL fail closed even if a stale tool reference is retained.

#### Scenario: Ordinary engineering work mentions Abel

- **WHEN** a user asks for ordinary engineering work without invoking an `/abel-*` prompt, even if repository context contains Abel resources
- **THEN** the dispatch tool remains inactive and no Gate or Abel stage contract is applied

#### Scenario: Verified workflow prompt is invoked

- **WHEN** a user explicitly invokes a package-proven Design, Implement, or Diagnose prompt whose expanded marker is valid
- **THEN** only that stage's private control surface becomes available and unrelated active tools remain unchanged

#### Scenario: Init is invoked

- **WHEN** a user explicitly invokes `/abel-init`
- **THEN** Init executes its deterministic local procedure without activating Subagent dispatch

### Requirement: Closed four-entrypoint approval handoff

The package SHALL continue to expose exactly `/abel-init`, `/abel-design`, `/abel-implement`, and `/abel-diagnose` as its Abel prompt entrypoints. An Implement run that lacks approved authority SHALL remain the same durable run, expose the missing-authority category and required Gate revision, and wait for a newer receipt produced through `/abel-design --change <change>`. The workflow SHALL distinguish this explicit user-owned Design revision from ordinary Implement recovery and SHALL NOT automatically invoke another stage.

#### Scenario: Ordinary Implement failure remains local

- **WHEN** Implement encounters an artifact, transport, environment, stale, baseline, or in-boundary repair failure
- **THEN** it exposes a same-run resume or rebind condition without requiring Design

#### Scenario: Technical authority is missing

- **WHEN** Implement proves that a new path, dependency, verification, resource, or AGENTS boundary is required without changing behavior
- **THEN** it retains the run, identifies Gate B as required, and exposes a complete decision batch for a same-change amendment within Implement, followed by locally discovered resume

#### Scenario: Behavior authority is missing

- **WHEN** Implement proves that observable behavior, compatibility, safety, or scope must change
- **THEN** it retains the run, identifies Gate A and Gate B as required, and waits for an explicitly approved revised delivery

#### Scenario: Revised delivery resumes implementation

- **WHEN** Design finalizes a newer receipt for an approval-needed Implement run
- **THEN** the user resumes that same Implement run with the new revision and receipt hash and compatible committed work is preserved

### Requirement: Explicit stage completion

Each eligible stage SHALL keep private dispatch active only while a multi-turn workflow interaction is in progress. Design readiness, Implement terminal settlement, Diagnose completion, or an explicit finish SHALL remove only `abel_dispatch`, clear the active stage identity, and preserve unrelated active tools. A nonterminal Gate wait or resumable pause SHALL remain active for its immediate same-task user follow-up. For an unrelated task or an explicit user exit, the parent SHALL first send `{"action":"finish"}`; the extension SHALL settle active operations, clear stage authority, restore the pre-Design tool set where applicable, and retain resumable progress without marking it completed or discarded. A verified Init invocation SHALL leave any previous stage before its local procedure. Each new parent interaction SHALL receive the current activation boundary so historical workflow text cannot independently reactivate a stage.

#### Scenario: Design becomes ready

- **WHEN** Design finalizes a valid delivery and reports `READY_TO_IMPLEMENT`
- **THEN** its private dispatch activation ends before an unrelated later request

#### Scenario: Implement pauses for a follow-up

- **WHEN** Implement returns a nonterminal pause or approval-needed state
- **THEN** the same verified stage remains active for a direct resume, approval, or inspection follow-up

#### Scenario: Implement terminates

- **WHEN** an Implement run becomes completed, discarded, or rejected
- **THEN** private dispatch is deactivated without changing other active tools

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

### Requirement: Compiler-owned plan confirmation

Design SHALL investigate repository-resolvable unknowns before asking about implementation details. The accepted proposal SHALL consolidate behavior, substantive technical choices, defaults, and compilation authority. Successful compilation SHALL record the canonical plan and current Gate B proof atomically, without an additional user confirmation or approval tool call. Existing decision identities SHALL be reused rather than restating their contract text.

#### Scenario: Compilation completes the accepted proposal

- **WHEN** a valid draft realizes current accepted choices
- **THEN** compilation supplies the private Gate B proof and finalization proceeds without a second decision round

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

### Requirement: Delegable Design task graphs

Design SHALL produce the smallest executable task graph within accepted authority.
Every task SHALL state stable identity, goal and acceptance ownership, dependency reasons, producer outputs, phase read/write/delete boundaries, conflicts, shared resources, verification locks, capability prerequisites, and baseline through final verification obligations.
Design SHALL derive actual parallel groups and serialization reasons from the compiled graph and SHALL NOT claim readiness or executable parallelism before code-owned compilation, proof, and delivery checks succeed.

#### Scenario: A fresh Worker receives a task

- **WHEN** an independently runnable task is dispatched to a Worker with no conversational history
- **THEN** the sealed task contract provides its authorized context, inputs, producers, phase boundaries, outputs, acceptance, resources, and verification prerequisites without requiring scope invention

#### Scenario: Design projects parallel and serial work

- **WHEN** Design presents the implementation graph
- **THEN** it identifies tasks that can actually run together and names each dependency, conflict, resource, producer, or global barrier that requires serialization

#### Scenario: A graph is not yet executable

- **WHEN** timing, authority, verification coverage, capability, proof, or delivery validation is incomplete
- **THEN** Design reports the specific defect and does not label the delivery ready, approved, sealed, or safe to implement

### Requirement: Autonomous same-stage continuation

Within an accepted change, the parent SHALL follow a code-owned continuation for a proven technical repair or newly valid delivery without asking the user to repeat approval, switch stages, or transfer internal receipt data.
When no legal automatic action exists, it SHALL report the scoped blocker, preserved progress and budget, and minimum external recovery condition while allowing safe independent work to continue.
Status SHALL remain a read-only projection and SHALL NOT execute continuation or mutate authority.

#### Scenario: A technical continuation is available

- **WHEN** status returns a current evidence-bound amendment or resume continuation within accepted authority
- **THEN** the parent performs that action in the retained Implement stage and rechecks the resulting delivery before further execution

#### Scenario: No safe automatic action remains

- **WHEN** a prerequisite is external, unsafe, unknown, cancelled, exhausted, or unchanged since the retained failure
- **THEN** the parent reports the affected tasks, preserved evidence and budgets, and minimum recovery condition without repeated approval requests or false completion

#### Scenario: Status is requested during parallel work

- **WHEN** some tasks are completed, active, queued, or blocked
- **THEN** status truthfully projects each state and queue reason without launching work, changing storage, or treating a blocked sibling as completion of the run

### Requirement: Verification-safe Implement guidance

Implement guidance SHALL keep each task's Red, Green, and optional Refactor sequence inside its isolated candidate and SHALL consume another task's outputs only after that producer completes.
It SHALL preserve all introduced acceptance tests through affected, cumulative, and final verification.
It SHALL NOT create a missing future test in the original baseline, delete acceptance to obtain success, enable trusted execution, bypass proof or currentness checks, or classify launch, timeout, environment, unsafe, unknown, cancellation, or termination failures as expected Red evidence.

#### Scenario: A task consumes a producer output

- **WHEN** an isolated Worker needs an output owned by another task
- **THEN** Implement waits for the producer task's valid completion fact and exposes only the output authorized for the consuming phase

#### Scenario: A new test becomes available after Red

- **WHEN** Red creates an approved regression that was absent from the original revision
- **THEN** Implement excludes it from original baseline capture and retains it in Green, affected, cumulative, and final acceptance

#### Scenario: Verification infrastructure fails

- **WHEN** execution cannot start, times out, loses capability, observes an unsafe path, is cancelled, or cannot terminate safely
- **THEN** Implement records an unavailable or paused result and never treats the event as an expected product failure or permission to weaken verification
