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
The current `ready.yaml` receipt embeds one canonical `implementGraph`, its `implementGraphHash`, and the graph closure result; it has no alternate task-readiness summary.

Every approved behavior must retain a stable trace from Requirement to Scenario to Verification to Task.
Every task must state exactly one executable verification type, its Red command and expected target failure, Green behavior, affected suite, target files, approved dependency changes, impact-closure evidence, and structured AGENTS impact.

### Graph-proven structured verification

Design emits exactly one immutable `ImplementGraphBoundary` for the change.
It contains every task, each task's explicit `dependsOn`, each phase's `verificationInputs`, and every generated output as an id, safe relative path, producer task and phase, and `regular-file` postcondition.
A write set grants permission only; it never proves that an output exists.

Every direct verification input binds exactly once to either an existing workspace path or a graph output id.
A workspace binding must already be a safe regular file at Gate B. An output binding must resolve to one unique producer whose path is in that producer phase's write set.
A cross-task consumer must have the producer as a transitive DAG dependency.
Suggested waves, conflicts, resources, and verification locks do not create a dependency edge.
A phase may consume an output created by its own candidate or an earlier applied phase, but never one produced only by a later phase.

Design and Implement share `src/implement-graph.ts::assessImplementGraphReadiness`.
The same core receives the canonical graph, consumer root, current completed and blocked task facts, applied phases, and an optional candidate overlay.
Gate B and receipt creation require an executable static closure with no diagnostics; current dependency waiting is a dynamic readiness fact and does not invalidate that closure.
`ready.yaml` stores the exact `implementGraph`, `hashImplementGraphBoundary(implementGraph)` as `implementGraphHash`, and `verificationClosure: { executable: true, diagnostics: [] }`.

Runtime admits that same graph once, recomputes readiness before a task launch, checks declared outputs in the isolated candidate before verification, checks them again after main-workspace application and before phase or task completion, and publishes a cross-task output only after its producer task completes.
A blocked producer keeps its consumers `dependency-blocked`; a completed producer with an absent or unsafe output is `producer-output-unavailable`.

Fresh Implement reconstructs availability only from the receipt-bound graph and hash, parent-owned completed task facts, current in-process blocked facts, and a fresh safe scan of the workspace.
It never infers phase completion merely because a file exists and never persists Runtime state, retry budgets, sessions, or model output.
All path observations reject absolute or noncanonical paths, `..`, NUL, root escape, a symbolic link in any existing component, a non-directory parent, and a non-regular final input or output.

Design emits only the structured Runtime kinds `kind: "vitest"`, `kind: "package-script"`, `kind: "static-check"`, and `kind: "steps"`:

- `vitest` declares its runner, safe relative `testFiles`, explicit `args`, and `minTests`.
  It uses a consumer-installed local Vitest.
  Runtime alone injects the JSON reporter and checks assertion identity for Red.
- `package-script` pins the package manager, script name, exact Gate-B-approved `package.json` command, and argument array.
  The script and runner must already exist in the consumer repository.
- `static-check` declares a local binary, `npx` with `noInstall: true`, or a safe relative Node script.
  It covers static, typecheck, build, schema, and parent-only AGENTS checkpoint verification without Vitest arguments.
- `steps` is an ordered list of atomic contracts.
  Every precheck is an explicit expected-green step and only the final step carries the phase classification.
  A compound command must not use `&&` or another shell operator.

No kind admits an arbitrary shell command.
Tokens are passed without a shell; shell operators, path escapes, absolute paths, unsafe executable names, unapproved commands, and implicit download runners are rejected.
`npx` is compiled with `--no-install` and still requires its executable in the approved local `node_modules`.
Bun, npm, pnpm, and Yarn package scripts are allowed only when the named package manager and exact pinned script capability validate.

Runtime never invents `bun run check`, `bun run test:target`, or another consumer script.
A precheck or affected verification runs only as an explicit approved contract or ordered step.
Argv-only verification contracts are invalid; there is no legacy normalizer or parallel verification schema.

An unsupported shape is `design-readiness/verification-contract-unsupported`.
A missing approved script is `verification-adapter/script-missing`; other missing or drifted consumer capabilities use their closed `verification-adapter` code.
Only an unavailable Bubblewrap launch, Bun resolution, dependency path, or sandbox runtime is an `environment` failure.

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

### Implement graph and fixed task boundary

This boundary applies only to Implement.
The parent submits the receipt-bound graph once with `admit-graph`.
A ready task's first Red `task-attempt` opens one process-local task record from the graph; every later Green, Refactor, correction, or stale refresh is another `task-attempt` with only change/task/request/phase identity and a fresh dynamic snapshot.
The immutable task entry includes all phase-local exact read/write paths, verification input bindings, target and affected verification, scheduling declarations, explicit dependencies, approved dependency changes, impact closure, and AGENTS impact.
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
- Artifact, stale-snapshot, and transport failures share two non-cancelled launches per phase; exhaustion is `{ kind: "attempts-exhausted", cause, attemptsUsed: 2, lastFailure: { code, stage, details? } }` and cancellation is budget-neutral.
- `lastFailure` always preserves the final closed code and stage for artifact, stale, and transport exhaustion.
  Optional details are limited to final submission category, a bounded submit-attempt count, schema state, mismatched identity dimension names, and a validated verification id.
- Public outcomes never contain a prompt, diff, model output, excerpt, consumer file content, command or argv, endpoint, credential, environment value, or actual/expected identity value.
- Bubblewrap, dependency-path, sandbox, or external runtime failure is `{ kind: "environment", code: <closed-environment-code> }` and terminally blocks the current task.
- Unsupported verification contracts close Design readiness; missing scripts,
  runners, local executables, or inputs are closed `verification-adapter` failures
  and must not be reported as Bubblewrap or dependency environment failures.
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
