# Task Execution Compiler Building Blocks

## 1. Scope / Trigger

Read before changing `src/implement-compiler.ts`, `src/task-plan.ts` or their shared execution graph/draft seams.
These are disconnected G3 building blocks, not complete G3 admission or release acceptance.
The isolated shell still uses the unavailable review compiler; production `src/index.ts` is unchanged.
No draft-v2 storage, resource-aware review adapter, execution lineage, amendment writer or launch/apply port is implemented by these modules.

## 2. Signatures

- `validateExecutionGraphBoundary(value)` validates tasks/outputs without a protocol identity.
- `assessExecutionGraphReadiness(root, value, facts)` uses the same phase/output/timing algorithm as the legacy graph owner.
- `prepareExecutionPlan(draft)` performs finite structural expansion without filesystem observation.
- `compileExecutionPlan(draft, {consumerRoot, bindExecutionInputs?})` performs static graph/timing/capability checks, never runs verification.
- `decodeTaskExecutionAuthoring(value)` accepts internal `{formatVersion:1,execution,evidenceBindings}` data only.
- `compileTaskPlan(input, authoring, {consumerRoot,privateRoots,retainedSources?})` joins an existing checked code compile Intent to explicit execution and returns normalized static data.
- `copyTaskExecutionAuthoringData(value)` reuses the existing planning codec before detaching data; it grants no authority.

## 3. Contracts

`ExecutionGraphPlan` contains tasks, outputs and PlanVerification, never change identity, Gate proof or Markdown tracking.
Legacy wrappers retain their checked identity/contract/tracking behavior and share normalization/timing helpers rather than duplicating them.
Named verifier expansion uses full command semantics and purpose-local identities; the task path never synthesizes `tasks.md`.
Strict core tasks require explicit original-baseline declarations.
Concise single-task expansion mechanically binds the explicitly supplied original full suite as baseline.

Task units join exactly the existing draft's steps by ID, objective, dependencies, actual write/delete roots and scheduled local check references.
Every scheduled verifier occurrence matches a reviewed check's complete `verificationObligation`, including ordered child semantics.
Every declared check must actually be scheduled.
Executable acceptance requires implementing effects and eligible Green/Refactor/affected/cumulative/post-apply occurrences, not baseline/Red/repair alone.
A deletion produces an absence effect, not a regular-file output.
Planning source bindings match supplied exact retained bytes; artifact bindings match declared role/path/hash references.
Artifact delivery/currentness is explicitly the future review adapter's responsibility, not proved here.
Completion-report obligations remain `completion-planned` / `not-run`; planning bindings remain `planning-bound` / `not-assessed`.

Actual reads/writes/deletions/verifier inputs exclude `.git`, `.cadence`, `.pi` and supplied private roots.
Write and delete roots are independent; actual manifest/lockfile/installed-tree effects require their declared categories.
Initial dependency names are captured exactly, separately from those categories.
Operator profile mode must match reviewed mode.
Retained `structural` never silently becomes `refactor`; draft-v2/refactor scope evolution remains outstanding.
Structural/scope/coverage failures precede filesystem capability reads in the task semantic path.

The existing finite 64-KiB planning codec is reused before cloning.
Task semantics bound units/outputs to 64, sources to 256 and their aggregate bytes to 16 MiB, and normalized plan bytes to 16 MiB.
Retry arithmetic must remain safe; no budget spending/refund or durable authority is implemented.
A boundary fingerprint captures intent meanings, obligations, scope, dependency names, profile, original baselines and maximum declared retries/recovery.
A fingerprint is data, not certification or permission to amend.

## 4. Validation & Error Matrix

Malformed fields, unknown authority/legacy fields, dangling/missing coverage, unsupported methods, unsafe retry arithmetic and model-supplied execution bindings refuse.
Core diagnostics retain the legacy bounded Design vocabulary; task semantic refusals use `task-record-invalid` and existing bounded path failures.
Unsupported/unavailable runners, missing original inputs and broken producer survival return no partial plan.
Static success reports execution `not-run` and approval `not-performed`, never PASS or a usable terminal receipt.
Default capability helpers remain nonparticipating filesystem inspection; they must not be installed in the terminal review lane without the required resource-aware adapter.

## 5. Good / Base / Bad Cases

Good: explicit reviewed units compile without OpenSpec/Gate/tracking and map acceptance to actual scheduled checks/effects.
Base: exact planning-byte references and future reports remain honest about assessment/run timing.
Bad: feed static plan metadata to issuance, adopt a fixture domain, infer approval from a path/hash or run the core untracked inside participating review.

## 6. Tests Required

`test/implement-compiler.test.ts` covers neutral closure/hashes, legacy equivalence, strict baselines, single/named expansion, graph cycles, future/deleted producer timing and unsupported capability.
`test/task-plan.test.ts` covers real static positive, many-to-many coverage, unscheduled/Red-only/false-obligation refusals, source/material/report timing, absence effects, separate scope/profile/category exclusions, mechanical versus structural, codec failures and safe retry arithmetic.
Keep all existing legacy compiler/input-timing and G1/G2/native resource suites enabled.
In a fixture, detach reviewed check bytes from execution contracts before changing only one side: an aliased mutation changes both meanings and is not a mismatch test.
These tests do not replace genuine review, issuance, storage/crash, amendment, admission or native execution qualification.

## 7. Wrong vs Correct

Wrong: add dummy change/tracking fields to call the legacy compiler, or treat a matching verifier ID as coverage.
Correct: validate neutral task fields directly and match the entire scheduled obligation to reviewed implementing owners.
Wrong: a static core pass or boundary fingerprint authorizes execution.
Correct: require the still-outstanding resource-aware compiler receipt, actual local initial approval lineage and fresh launch/apply checks.

## G6 unreleased neutral retirement contract

The main-reviewed local G3–G5 composition supersedes the earlier disconnected checkpoint above; it does not qualify production or release.
Retire transient ImplementPlan/PlanTracking/change/Gate envelopes and legacy shorthand flags, keeping the same finite neutral expansion, graph/compiler and bounded diagnostics.
Every task baseline is explicit, except the concise shorthand's mechanically bound original full suite; omitted-baseline historical plans are refused, never upgraded.
Remove tracking checkpoints and unsupported lifecycle fallbacks only while retaining independent baseline/phase/affected/repair/cumulative/post-apply/AGENTS evidence and exact native catalog/report/obligation/recovery identities.
Readonly historical quiescence remains owned by task-legacy-history, never by a writable compatibility reducer or migration.
Assertion retirement is per title: obsolete public authority positives retire; canonical/schema/input-timing/privacy/output/role safety ports require actual neutral/task assertions.
Unported scheduling/storage/retry fault tests stay preserved until the next native-test owner ports their complete bodies and watchdogs.
No reset, permission backfill, second scheduler, report rekey or spending refund follows from retirement.

### 1. Scope / trigger: actual G6 owners

This is the neutral runtime/wrapper retirement slice, not production/content/distribution acceptance.
Historical notes above are not instructions to restore a legacy compiler, migrating constructor or Gate.

### 2. Signatures: neutral data and native close

`PlanTaskDraft.baselineVerification` is required.
`normalizeExecutionPlan(value)` and `compileExecutionPlan(value, options)` accept only neutral execution data.
`WorkflowRunLifecycle` retains only optional `close(): void`; no cleanup/reset hook exists.
`projectWorkflowStatus` consumes `TaskRunProjection`; `projectWorkflowActivity` projects observation, never stage or approval authority.

### 3. Contracts: keys, roles and inert status

Preserve physical native catalog/event, deliveryRevision, report, obligation, recovery and baseline keys, including existing `"legacy"` hash sentinels.
Historical event tags are readonly hash-chain data, not admitted native events.
Generic evidence/diff validators retain the known three-role set, exact fields and complete-result bounds; their advisory output does not choose a worker lane or grant writes.
The production candidate composition fixes the implementation worker independently of submitted JSON.
Native terminal/exhausted status advertises only `status`; observation never grants apply or automatic continuation.

### 4. Validation / error matrix

- Missing task baseline → `execution-task-baseline-required` at normalization and compilation.
- Change/tracking/control/unknown task fields or submitted bindings → closed-boundary refusal, no partial authority.
- Old aggregate PASS cache without full contract binding → ignored for reuse; current original-baseline observations still run.
- Private rejected values or submitted diagnostic keys → bounded, code-owned field/code only, never echo.
- Submitted automatic continuation metadata → no recovering state inference or hidden manual status hint.

### 5. Good / base / bad cases

Good: mechanically bind a single draft's explicitly declared original full suite, or author each graph task baseline explicitly.
Base: a known-role advisory result may validate its data shape without proving any execution/Completion claim.
Bad: patch the generic result kernel with obsolete role-to-stage restrictions, infer a missing baseline from affected tests, or convert a paused observation into automatic recovery.

### 6. Tests required: actual replacements and untouched fault bodies

`task-neutral-runtime`, `task-schema-retirement`, `task-envelope-retirement` and `task-verification-retirement` provide actual absence, all-three-example compilation, fixed-seed graph, field-only privacy, exact original step/file bounds, 64-KiB input/output/role controls and old-cache nonauthority assertions.
`verification-input-timing` retains phase/affected/repair/cumulative/post-apply/AGENTS and future/unsafe original-input negatives.
Every retired/ported title is listed in task-local `research/neutral-assertion-dispositions.json`; references alone are not execution evidence.
Preserve complete unported native engine/storage/FIFO/lease/retry/COMMIT/unknown-close bodies and their original watchdogs for the next owner.

### 7. Wrong vs correct: no resurrected authority

Wrong: clear old caller errors by restoring `ImplementPlan`, `RunStore.open`, legacy Engine controls, `acquirePackageState`, tracking or Gate APIs.
Correct: port the actual assertion to the original task/native owner, preserving guards, counters and independent evidence, or explicitly retire only its obsolete public-authority claim.

## Scenario: Typed verifier-input immutability

### 1. Scope / trigger

Neutral normalization, genuine task preparation/currentness, retained plan decoding and finite permission amendments must preserve accepted verifier inputs.
This ports a real safety rule, not old ChangeContract/Gate authority.

### 2. Signatures

`executionVerifierProtectionDiagnostics(plan: ExecutionGraphPlan): DesignPlanDiagnostic[]` is pure and issues no permission. `normalizeExecutionPlan` applies it before capability observation. `proveTaskTechnicalAmendment` refuses a candidate violating it.

### 3. Contracts

Collect typed input paths from every ordered verifier child, original/task/global/affected/repair/post/AGENTS contract and phase workspace or resolved output binding, including affected/related tests.
The compiler-bound `VERIFICATION_CONFIGURATION_PATHS` participate for every runner (including Node module/package policy), plus non-Node installed runner trees; dependency categories cannot bypass that protection.
Command/prose/ID strings are never parsed as path permissions.

Refactor-mode Green/Refactor cannot write/delete overlapping protected paths.
Mode is authority: a Refactor phase inside reviewed behavior/TDD is not a refactor-mode relabeling.
Declared TDD Red outputs may still be created/restored under the original timing and obligation checks.
Red cannot delete original-baseline inputs (including ancestor overlap); it is not a broad ban on TDD test creation.
Fold case and compare whole segments in both directions.
`.` or a wildcard segment conservatively covers its parent prefix; no glob interpreter or broader roots grant writes.
Nonbehavioral public-impact declarations refuse independently of scope allowances.
Existing obligation equality, mode policy, receipt membership, captured baselines, report hash spelling, original input currentness, invalidation and spent-budget rules remain unchanged.

### 4. Validation / error matrix

- Protected effect → `execution-verifier-protection-invalid`, diagnostic code `execution-verifier-input-mutation`, exact `phases.<phase>.<write|delete>.<index>` field, no submitted path/value.
- Nonbehavioral public surface → `execution-mode-public-impact` at `impactClosure.changedSurfaces`.
- Durable task DTO/codec → existing bounded `task-record-invalid`, no parser/private-value echo.
- Unsafe technical amendment → `review-needed`, no token/head/permission backfill.
- Genuine input drift → existing currentness refusal; original certification/provenance remains immutable.

### 5. Good / base / bad cases

Good: refactor source implementation while accepted checks remain immutable; an in-scope helper amendment invalidates all unsupported unit/global evidence.
Base: behavior Red introduces a declared regression output without putting it in the original baseline.
Bad: replace a compound child runner, delete an inherited verifier ancestor, or treat a path-looking output ID/model PASS as authority.

### 6. Tests required

Complete `task-verifier-immutability`, `task-verifier-immutability-native.integration`, `task-plan-compiler` and unchanged `legacy-workflow-retirement.integration` assertions cover valid positives, exact/case/ancestor/wildcard effects, ordered compound children, typed output links, non-path identities, public/adapter privilege, planned-not-run evidence, genuine issuance/amendment/invalidation/currentness and immutable provenance.
Keep complete task-plan/neutral graph/draft/capability/candidate/admission/G3/G4 application/closed-basis suites and original 5000/60000-ms bounds.

### 7. Wrong vs correct

Wrong: observe/hash a verifier now, then grant permission to replace it under a refactor label.
Correct: refuse that permission at neutral normalization, preserve ordered obligations and original metadata, and independently recheck genuine inputs at issuance/launch/apply.
