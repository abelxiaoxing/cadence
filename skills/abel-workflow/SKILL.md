---
name: abel-workflow
description: Shared contract for the Abel Init, Design, Implement, and Diagnose workflow stages
---

# Abel workflow

This Skill is the authoritative shared contract for `/abel-init`, `/abel-design`, `/abel-implement`, and `/abel-diagnose`.
Load it before executing any stage; the package remains usable when no user-global `AGENTS.md` contains Abel-specific instructions.
Stage prompts own their input contract and stage-specific procedure, while rules shared across stages live here.

## Gates and trusted delivery

Gate A approves the complete product behavior contract.
Gate B separately approves the complete technical implementation contract.
Neither Gate authorizes a tool permission; they do not grant permission authorization, identity signing, or approval to bypass repository controls.

Design and Implement may run in different contexts.
A handoff is trusted only when versioned Gate receipts bind the same change and schema, every covered artifact's normalized relative path and SHA-256 hash is valid, the Gate A receipt hash is valid, OpenSpec strict validation passes, and the artifact graph is complete.
Normalize only the tracked task file's completed Markdown checkboxes before hashing; reject absolute paths, `..`, path escapes, and symbolic-link escapes.
A missing receipt, invalid hash, or inconsistent artifact returns the change to Design rather than recreating a decision in Implement.

Every approved behavior must retain a stable trace from Requirement to Scenario to Verification to Task.
Every task must state exactly one executable verification type, its Red command and expected target failure, Green behavior, affected suite, target files, and AGENTS impact.

## Verification discipline

Before writes, record target, affected-suite, and full-suite baselines with commands, exit codes, and normalized failure identities.
A pre-existing baseline failure is separate evidence and never satisfies a target Red.

Use Red-Green-Refactor for code, tests, and executable static contracts:

1. **Red:** add only the approved failing verification and run the exact command; it must fail for the specified target defect.
2. **Green:** implement the minimum approved change and run the target verification after every code or test edit.
3. **Refactor:** improve only in-scope structure or readability while target verification stays green; then run the affected suite.

If Red passes, uses an invalid command, or fails for another reason, stop and return to Design rather than substituting an improvised verification.

### Implement affected-suite repair boundary

This boundary applies only to Implement.
For each task, its exact affected-suite commands define a dynamic cross-module repair boundary.
Keep each command, exit code, normalized failure identity, reproducibility result, attribution, and root-cause evidence in the implementation context and final report, not in a state file.
Every reproducible pre-existing failure enters the current task separately from the task Red and requires a verified root cause plus minimum repair, including a failure outside the original module or target-file list.
Only an attributed failure inside this boundary authorizes an additional repair path.
Classify a failure newly visible on a later affected run as `pre-existing`, `introduced`, or `unresolved`; include and minimally repair a pre-existing failure, repair or revert an introduced failure, and block completion when attribution is unresolved.
An environmental, transient, external-service-dependent, or non-reproducible failure blocks completion with an executable recovery condition and never authorizes a speculative product edit or repair.
If an included repair requires new behavior, policy, dependency, architecture, irreversibility, or another substantive decision, return the expanded requirement to Design.
A full-suite-only baseline failure outside the affected commands remains outside automatic scope.
Finish only when all target and affected verifications are green and the full suite has no new failure relative to baseline.
Do not archive, publish, or commit implicitly.

## AGENTS indexes

Treat AGENTS indexes as verified routers, not architecture documents or session ledgers.
Preserve all human-authored text and edit only the managed region delimited by `<!-- ABEL:AGENTS-INDEX:START -->` and `<!-- ABEL:AGENTS-INDEX:END -->`.
Update an index only at a stable task or diagnosis checkpoint when module routes, entrypoints, public/configuration surfaces, commands, ownership, data-flow boundaries, or indexed invariants changed.
Otherwise record `none` with evidence.
Never persist runtime user or session state, dirty-state ledgers, timestamps, or approval status in an index.

Before an index write, inspect the complete task diff and compare actual impact with the approved contract.
Stop and return to Design if the diff exposes unapproved behavior or architecture.
Validate paths, commands, removed references, managed-marker uniqueness, and root-to-nested routes after every index update.

## Parent and subagent authority

The parent agent owns Gate handling, patches, repository writes, AGENTS index updates, and task completion state.
A subagent receives bounded relevant index context and may perform only the delegated read-only exploration or review.
A subagent must not approve a Gate, apply a patch, edit an index, or advance a task checkbox.

## External browser E2E

`dev-browser` is external and is required only when an approved task verification contract explicitly names browser E2E.
Its absence does not block another task or workflow stage whose approved contract has no browser E2E step.
When an approved browser-E2E task requires `dev-browser` and it is missing or unavailable, stop that task, report the missing capability and an executable remediation, and do not report the verification as passing.

## Stage responsibilities

- **Init:** initialize or safely repair OpenSpec and verified AGENTS routes without destructive overwrite.
- **Design:** resolve blocking decisions, obtain Gate A and Gate B, write only OpenSpec change artifacts after Gate A, and deliver a strictly validated traceable change.
- **Implement:** validate the trusted delivery in a fresh context, execute task contracts in tracked order through Red-Green-Refactor, and maintain indexes at stable checkpoints.
- **Diagnose:** reproduce existing bugs, falsify candidate causes, establish a failing regression, and make the minimum repair; new behavior or substantive architecture returns to Design.
