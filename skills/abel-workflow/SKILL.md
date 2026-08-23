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
A missing receipt, invalid hash, or inconsistent artifact is a `delivery-invalid` stage blocker before Implement registers a task.

Every approved behavior must retain a stable trace from Requirement to Scenario to Verification to Task.
Every task must state exactly one executable verification type, its Red command and expected target failure, Green behavior, affected suite, target files, approved dependency changes, impact-closure evidence, and structured AGENTS impact.

## Verification discipline

Before writes, record target, affected-suite, and full-suite baselines with commands, exit codes, and normalized failure identities.
A pre-existing baseline failure is separate evidence and never satisfies a target Red.

Use Red-Green-Refactor for code, tests, and executable static contracts:

1. **Red:** add only the approved failing verification and run the exact command; it must fail for the specified target defect.
2. **Green:** implement the minimum approved change and run the target verification after every code or test edit.
3. **Refactor:** improve only in-scope structure or readability while target verification stays green; then run the affected suite.

Syntax, import/load, no-test, malformed-diff, and wrong-Red-identity failures are generated implementation-artifact rejection.
A wrong-Red result uses the same bounded artifact-correction path.
Every artifact rejection receives a finite correction budget shared with the phase's mechanical redispatch budget.
When the artifact correction budget is exhausted, terminally block the current Implement task as `attempts-exhausted`.
A Red candidate that passes is `{ kind: "artifact", code: "red-not-witnessed" }`; Runtime returns a bounded `{ kind: "retry", scope: "worker", cause: "artifact", remainingAttempts: 1 }`, and candidate success alone does not prove a Design defect.
If separate evidence proves that the approved command cannot witness the approved behavior without changing behavior, policy, dependency, architecture, scope, write-set, or verification contract, terminally block the current task as `verification-contract-insufficient` without consuming the artifact correction budget.

### Implement fixed task boundary

This boundary applies only to Implement.
The parent registers each ready task once with one immutable `TaskBoundary`; its first Red uses `open-task`, and every later Green, Refactor, correction, or stale refresh uses `phase-attempt` with only phase/request identity and a fresh dynamic snapshot.
The boundary includes all phase-local exact read/write paths, target and affected verification, scheduling declarations, approved dependencies, impact closure, and AGENTS impact.
Runtime never expands it.
Keep each command, exit code, normalized failure identity, reproducibility result, attribution, and root-cause evidence in context and the final report, not in a state file.
Every reproducible pre-existing affected failure remains separate from task Red and may be repaired only when its paths and behavior are already inside the approved boundary.
Classify later affected failures as `pre-existing`, `introduced`, or `unresolved`; make the minimum in-boundary repair, repair or revert an introduced failure, and block the current task when attribution is unresolved.
Environmental, transient, external-service-dependent, or non-reproducible failures terminally block the current task with typed evidence and never authorize speculative edits.
A full-suite-only baseline failure outside the affected commands remains baseline evidence and outside task scope.
Finish only when all target and affected verifications are green and the full suite has no new failure relative to baseline.
Do not archive, publish, or commit implicitly.

### Impact closure

A task changing route authorization, page state, API response, or public HTML structure must search existing code and tests by all relevant URLs, route names, handlers, and templates.
Classify every related existing E2E, theme/layout, authorization, HTML/template, and API contract test as current-task, explicit regression-task, or unaffected with cited evidence.
The affected suite must contain existing-test evidence and must not cover only a new test file.
Changes such as `/videos` and `/api/videos` require all five test surfaces to be checked.
This is a task-contract evidence check, not a business-specific source scanner.

## AGENTS indexes: stage-scoped authority

In the Design stage, every repository `AGENTS.md` is read-only.
Design may only audit stale routes and record `none | update-existing | create-index | remove-index`, an exact target, evidence, and `agentsManagedOnly: true` in the task contract; Design must not edit an index.
This Design read-only rule is not inherited by and does not apply to Implement.

In Implement, the parent applies the approved contract at a stable task checkpoint:

- `none`: no AGENTS target or write is allowed.
- `update-existing`: update the approved existing AGENTS path.
- `create-index`: create the approved AGENTS path.
- `remove-index`: remove the approved managed block, deleting the file only when no human content remains.

Treat indexes as verified routers, not architecture documents or session ledgers.
The parent must preserve all human-authored text and edit only the managed region delimited by `<!-- ABEL:AGENTS-INDEX:START -->` and `<!-- ABEL:AGENTS-INDEX:END -->`.
An approved AGENTS checkpoint is normal Implement work and must not become a boundary failure or stage-routing instruction.
A subagent must never receive an AGENTS write path or edit any index.

Before a parent index write, inspect the complete task diff and mechanically compare actual impact with the approved target and impact.
An unapproved behavior/architecture diff or required task/AGENTS contract change terminally blocks the current task with the matching `approval-boundary` code.
Validate paths, commands, removed references, marker uniqueness, and root-to-nested routes after every index update.
Never persist runtime user/session state, dirty-state ledgers, timestamps, or approval status in an index.

## Implement typed blockers

Implement reports facts about only the current task.
It does not select a user recovery action, recommend another workflow, or claim control over the parent-owned DAG.

- Generated artifact defects are closed typed failures: malformed diff, syntax/import/load, no-test or wrong command, wrong Red identity, duplicate/invalid structured result, and `red-not-witnessed`.
- Artifact, stale-snapshot, and transport failures share two non-cancelled launches per phase; exhaustion is `attempts-exhausted` and cancellation is budget-neutral.
- Bubblewrap, dependency-path, sandbox, or external runtime failure is `{ kind: "environment", code: <closed-environment-code> }` and terminally blocks the current task.
- Any required path, dependency, behavior, policy, architecture, conflict, resource, verification, or AGENTS expansion is the matching closed `approval-boundary` failure and never expands the boundary at runtime.
- Oversized output is `{ kind: "result-limit", limitBytes }`, terminal, and never yields a partial diff.

Expected Red failure, artifact defects, stale snapshots, environment failures, approved AGENTS checkpoints, approved docs/tests, and in-boundary compatibility repairs never produce stage-routing metadata.

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
- **Diagnose:** reproduce existing bugs, falsify candidate causes, establish a failing regression, and make the minimum repair.
  This regression-first algorithm is independent of Implement blockers; new behavior or substantive architecture is outside Diagnose scope.
