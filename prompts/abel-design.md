---
name: abel-design
description: Produce a validated, approved, directly executable OpenSpec delivery without implementing product code
category: abel
tags: [abel, design, openspec, PBT, evidence]
argument-hint: "<requirement> | --change <change_name>"
---

This procedure applies only when the user explicitly invokes `/abel-design`.
Reading this file, mentioning the command, or finding OpenSpec artifacts does not activate it.
Read the complete value inside `<abel-request>` without tokenizing it a second time.

<abel-request>
$ARGUMENTS
</abel-request>

<!-- ABEL:PROMPT:abel-design -->

This stage is scoped to the invoked task.
Direct answers and same-task continuations stay in this stage.
If the user ends the workflow or requests an unrelated task, first send `{"action":"finish"}` to `abel_dispatch`, then handle the new task normally with the restored tools.
Exit preserves resumable work and never means completion or discard.
Never start another stage automatically.
<!-- ABEL:START -->

# Design outcome

Design resolves product and technical decisions, collects cited evidence, and compiles one trusted delivery.
It never launches an implementation Worker, creates a product-code candidate, applies a product diff, runs Red/Green/Refactor, or mutates the main workspace.

If no requirement can be identified or several changes cannot be distinguished, ask one focused question about the target.
Otherwise make Design `start` the first control call, before repository discovery.
It creates only private resumable identity and does not approve scope.
Then resolve discoverable unknowns from repository evidence and choose reversible defaults within existing authority; only unresolved substantive choices require a user decision.
An explicit `--change <name>` resumes only that existing change; never reinterpret a misspelling as a new requirement.

## Durable Design identity

Use the same `action: "design"` envelope from the first call through finalization.
Call `start` once with either the complete new requirement or an explicit existing change name, then use the returned `runId` for every later Design operation.
For a new requirement, the control plane normalizes and hashes the transient text itself; the raw requirement is not written to the durable journal.
After Gate A fixes its name, bind that same provisional run with `bind-change` rather than starting a second run.
Use `status` by `runId` to recover local lifecycle and Design facts without a model or endpoint request.
A completed Design run is immutable; an explicit later `--change <change>` starts the next durable Design revision for that change while preserving prior approval facts for receipt verification.

```json
{"action":"design","request":{"operation":"start","requirement":"<complete-requirement>","operationId":"<unique-operation>"}}
{"action":"design","request":{"operation":"start","change":"<existing-change>","operationId":"<unique-operation>"}}
{"action":"design","request":{"operation":"status","runId":"<run-id>"}}
{"action":"design","request":{"operation":"bind-change","runId":"<run-id>","operationId":"<unique-operation>","change":"<gate-a-approved-change>"}}
```

## Focused evidence collection

For a local change with known paths, read applicable repository instructions, the package manifest, the affected implementation and existing tests in the same assistant turn when independent.
Expand to callers, fixtures or architecture only for a concrete unresolved impact or verification question.
Once observable behavior, authorized scope, existing-test impact and an executable verification command are established, proceed to the accepted contract and draft.
Do not continue broad directory traversal or read Cadence implementation sources to reconstruct its protocol; use the current tool schema, its installed example paths and returned field diagnostics.
The `start` / `status` response includes a current-step hint; it is guidance, not new approval authority.
Evidence packets are optional: use them only for independent evidence gaps that justify another model call.

## Write boundary

- During verified Design, the parent tool set is mechanically limited to the previously active `read`, `grep`, `find`, and `ls` tools plus `abel_dispatch`.
  Shell, edit, write, and unknown tools are unavailable until Design exits; never try to recover them or write through another tool.
- Before explicit Gate A approval, all repository work is read-only.
  A provisional Design run may exist only in the repository-external private run store.
- After Gate A, mutate only the canonical `openspec/changes/<change>/` root through the private `write-artifact` or `delete-artifact` Design operations.
  Use a path relative to the active change root; it may be only `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, `plan-draft.json`, or `specs/<safe-segments>/spec.md`.
  Content is exact bounded UTF-8 text; send it directly, never as Base64.
- Code-owned `gate-a.yaml` and `ready.yaml` receipts are forbidden targets.
  Code-owned `implement-plan.json` is also unreachable through artifact mutation; only `compile-plan` may install it.
- Every repository `AGENTS.md` remains read-only throughout Design.
  Audit it and seal any needed `none | update-existing | create-index | remove-index` operation into the implementation plan; never edit the index here.
- Never edit OpenSpec schemas, `openspec/config.yaml`, generated OpenSpec skills/commands, product code, tests, package manifests, or repository state outside the change root.

Write one artifact per operation and use a unique operation id.
Delete only an obsolete allowed artifact; no directory is ever removed.
Identical replay is idempotent and conflicting reuse of an operation id fails closed.

```json
{"action":"design","request":{"operation":"write-artifact","runId":"<run-id>","operationId":"<unique-operation>","path":"proposal.md","content":"<exact-utf8-content>"}}
{"action":"design","request":{"operation":"delete-artifact","runId":"<run-id>","operationId":"<unique-operation>","path":"specs/<capability>/spec.md"}}
```

## Read-only evidence packets

Use `abel_dispatch` with `action: "run"` only for bounded Design evidence.
Each packet is one tool call, has `stage: "abel-design"`, role `design-explorer`, phase `evidence`, an exact read scope, an empty write set, and output `evidence`.
It must include the exact `runId` returned by Design `start`.
Never send an implementation phase to a Design packet.

```json
{
  "action":"run",
  "request":{
    "stage":"abel-design",
    "role":"design-explorer",
    "runId":"<durable-design-run-id>",
    "id":"<unique-packet-id>",
    "phase":"evidence",
    "objective":"<bounded evidence question>",
    "roots":["."],
    "context":{"agents":"<applicable index context>","contract":"<exact read-only contract>"},
    "declared":{"read":["<safe relative path>"],"write":[],"conflicts":[],"resources":[]},
    "output":"evidence"
  }
}
```

When two or more independent packets are needed, issue all sibling calls in the same assistant turn.
Do not wrap them in a `requests` array.
The control plane validates the run before launch and records only a bounded normalized evidence fact after structural acceptance.
An identical packet/result replay is idempotent; a conflicting result for one packet id fails closed.
Validate packet id, scope, citations, and structure before synthesis; uncited, conflicting, or out-of-scope claims require a bounded follow-up or a minimal parent check.

Evidence packets may read code and tests but may not execute validation.
Design may inspect manifests and verification capability statically; it must not run product tests as a substitute for Implement evidence.

## Decision ledger and Gate A

Maintain the conversational decision presentation with id, `behavior | technical`, question, cited evidence, alternatives, recommendation, user decision, status, and affected artifacts.
After the user resolves a substantive decision, send its concise canonical contract text and artifact references through the private control operation.
The control plane normalizes and hashes that transient text and persists only the hash, identity, category, and refs:

```json
{"action":"design","request":{"operation":"record-decision","runId":"<run-id>","operationId":"<unique-operation>","decisionId":"<stable-id>","category":"behavior","contract":"<canonical-decision-contract>","refs":["<artifact-anchor>"]}}
```

Do not put prompts, transcripts, hidden reasoning, credentials, environment values, or raw model output in this request; `contract` is only the concise decision being bound.

Ask the user only for substantive choices: observable behavior, scope/non-goals, data/security/privacy/compatibility/migration policy, new dependencies, architecture/policy, irreversible changes, and technical choices with real trade-offs.
Resolve reversible details mechanically from one established repository convention and do not ask them repeatedly.

Aim for one consolidated user decision round for a clear requirement.
Investigate repository evidence before asking about implementation details.
Present the observable contract, any substantive technical trade-offs, and your recommended defaults together; include authorization to mechanically compile and seal the plan within those choices.
An explicit acceptance of that complete proposal covers both its behavior and the presented technical choices.
Do not ask a second time merely because the compiler has now produced the exact task DAG or receipt.
Ask a further focused question only when new evidence changes a substantive choice that was not covered by the accepted proposal.
Explain that difference, retain all other decisions, and group related unresolved choices into the same question.
Existing instructions and accepted same-task decisions are authorization evidence; do not require the user to restate them.
Design settles the goal, main decisions, explicit constraints, and non-goals.
Make the implementation delegation clear in the accepted proposal: the parent will choose its recommended solution for later implementation choices within those constraints, record material decisions, and continue to verified results without another selection or confirmation round.
Do not ask the user to approve this delegation separately or attempt to enumerate every future implementation detail.

Design owns the user decision boundary for this change.
Discuss the outcome and real constraints here, including likely repair scope, dependency choices, environment prerequisites that require the operator, and any irreversible operation.
Treat the task DAG as the initial execution strategy: the parent may revise its technical decomposition, supply context, repair failures, and recompile within the accepted contract during Implement.
Do not make incidental file lists or a guessed decomposition into product constraints.
Choose `policy.writeRoots` to cover the affected modules, their regression tests, and necessary integration repairs justified by repository evidence; keep initial phase writes precise.
An explicit user authorization for repository-wide work may be represented by `"."`; never infer it from convenience, and still name any authorized AGENTS target exactly.
Set dependency and verification-mode policy from the accepted choices, so known requirements do not become authorization requests during execution.

## Structured authority for new work

Use a structured `ChangeContract` as the Gate A `contract` for new designs: `goal`, `acceptance` (stable `id`, accepted `statement`, complete structured `verification`), `constraints` (stable `id` and `statement`), and `policy` (`writeRoots`, allowed dependency names in `dependencies`, and `verificationModes`).
Use `behavior` by default; explicitly permit `mechanical` or `refactor` only for suitable work.
Present the accepted goal, constraints and scope together with the recommended choices.
Do not include secrets or raw conversation in the contract.

Code normalizes and hashes the object.
The journal retains the normalized authority and injects it into compiled plans; callers do not compute hashes.
Keep acceptance IDs and statements stable when reshaping a plan.
Compilation rejects missing acceptance verification, outside-policy writes/dependencies, or substituted authority.
Historical prose approvals remain readable; their existence does not authorize new scope.

Gate A approves the complete WHAT: goal, observable scenarios, failures, scope/non-goals, compatibility/migration/security policy, and success criteria.
Before approval, present the unresolved behavior decisions together.
After explicit approval:

1. resolve the final kebab-case change name and schema;
2. approve the complete WHAT contract through the transient-text operation below;
3. bind the final change name to the same run with `bind-change`, creating the change root only through later artifact writes;
4. materialize schema-ready behavior artifacts one at a time.

```json
{"action":"design","request":{"operation":"approve-gate","runId":"<run-id>","operationId":"<unique-operation>","gate":"gate-a","contract":{"goal":"<accepted goal>","acceptance":[{"id":"<acceptance-id>","statement":"<accepted behavior>","verification":{"kind":"static-check","id":"<acceptance-verifier-id>","runner":{"kind":"node","script":"<observed-test-path>"},"args":[],"classification":"expected-green"}}],"constraints":[],"policy":{"writeRoots":["<approved-source-path>","<approved-test-path>"],"dependencies":[],"verificationModes":["behavior"]}}}}
```

The control plane generates the canonical behavior-contract hash; the returned proof contains its approval revision, contract hash, and owner-private record hash.
`gate-a.yaml` is installed later by code-owned finalization, not hand-authored here.

Gate A is not tool permission and carries no session/model/timestamp identity.
A later behavior decision invalidates both Gates; a later technical decision or changed plan compilation invalidates Gate B only.
Compiling identical canonical bytes after unchanged decisions preserves the existing plan revision and both Gates, even with a new operation id.

## Technical contract and ImplementPlan

Derive HOW from Gate A plus repository evidence.
Ask only unresolved substantive technical decisions, then build a complete task DAG with stable Requirement → Scenario → Verification → Task references.

For one local task with no new dependencies, deletes, outputs or scheduling conflicts, prefer the package's [quick single-task author example](../config/plan-draft.quick.example.json).
Write it to the same `plan-draft.json` artifact.
Its `singleTask` is expanded mechanically by the existing compiler; do not also supply `tasks` or duplicate verification bookkeeping.
Keep the observed full suite, impact evidence, AGENTS impact, phase writes and Red witness explicit.
Recovery defaults are two artifact corrections and one repair; override `recovery` only for an intentional resource choice.
Use the full draft for work outside those limits.
This shortcut does not infer acceptance evidence or change Gate approval.

Start from the package's [single-task PlanDraft example](../config/plan-draft.example.json), resolved relative to this prompt's installed path.
It describes a small Node consumer with `package.json`, `src/add.mjs` exporting `add`, and one existing `test/add.test.mjs` that uses Node assertions and currently covers `add(0, 0) === 0`.
The Red phase preserves that assertion and adds `add(2, 3) === 5` with the failure marker `[ADD:positive-integers]`; Green repairs the function.
The example's nested `changeContract` also shows the structured Gate A shape.
Replace its goal, acceptance, paths, context, impact evidence, and verification commands with observed repository facts before approval; its sample evidence is not evidence about the current project.
Use the project's actual full suite when adapting this single-test example.
The control plane inherits the approved `changeContract`, so the draft may omit that duplicate object.
Keep author input separate from the complete sealed execution plan; execution never reads author shorthand.
Reuse an atomic command through `verificationDefinitions` and `{ "use": "name" }`; place `expectedFailure` on its Red use.
Definitions contain an existing atomic verifier's command fields, without identity, classification, bindings, nested references, or arbitrary use-site overrides.
Inline atomic contracts may also omit `id` and `classification`; the compiler derives stable purpose identities and phase classifications.
In PlanDraft, omit a package-script `command` (including in a named definition or package-script runner) to bind the literal package.json script value before identity generation.
An explicit `command` must be that exact manifest value, never a launcher such as `npm run test`.
Gate A acceptance verifiers remain complete explicit contracts; use the observed literal script value there.
Explicit task `read` supplies common reads to its phases, unioned with any phase-local `read`; writes, deletes, roots, dependencies, and output producers remain explicit.
The compiler also supplies fixed baseline/repair boundary fields and `agents.managedOnly`; retain recovery attempt limits and observed AGENTS impact.
It supplies an empty AGENTS checkpoint only when every explicitly declared impact is `none`.
The [dependent-task example](../config/plan-draft.multiple-tasks.example.json) shows a Red-produced test consumed by another task's ordered verification, with an explicit dependency and producer.
Ordered `steps` remain complete inline contracts; reuse means separate verification executions, never reuse of a prior successful report.
Omit `tracking` to generate parent-owned `tasks.md` metadata from the task ids; an explicitly supplied block must match those ids and the fixed tracking policy.
In the author portion of `tasks.md`, write one checkbox with each backticked task ID, its objective and its owned backticked `specs/<capability>/spec.md#Requirement title/Scenario title` references.
Every Scenario must have exactly one reference.
Do not copy generated phase verifier IDs into this text.
Compilation installs their code-owned `ABEL:VERIFICATION-BINDINGS` region while preserving the author text.
Editing tasks afterward requires recompilation before finalization.
Omit phase `verificationInputs`: the compiler derives the exact paths from each verification contract and binds them to a unique declared output or an existing workspace file.
Keep supporting sources and fixtures in `read`; input derivation never adds read/write paths, outputs, or dependencies.
Omit each `relatedTests` entry's `disposition` and `regressionTaskId` to derive ownership from task writes; retain its observed `path` and `evidence`.
An ambiguous producer or test owner requires an explicit correction; explicitly supplied fields are checked, never silently replaced.
Scope, verification choices, recovery limits, and necessary AGENTS operations remain explicit.

Mechanical tasks may write document/data/config files (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`, `.lock`).
Refactor tasks preserve accepted verifier inputs.
Both must declare no public behavior change and require an explicitly allowed mode in Gate A. Specify task `verificationMode` and Green (plus optional Refactor); omit Red in the draft.
The compiler handles its internal compatibility representation.
Runtime captures baseline and executes Green with affected, cumulative and post-apply verification, without generating a Red candidate.
Behavior tasks continue to require Red/Green.

An AGENTS checkpoint additionally requires its exact target path in `policy.writeRoots`; a broad source root does not grant AGENTS authority.

Each task must seal:

- stable id, objective, exact dependencies and edge reasons;
- exact phase-local read/write/delete paths and output producers;
- Red, Green, optional Refactor structured verification and exact verification inputs;
- an original-revision `baselineVerification`, task-affected and repair verification contracts;
- conflicts, resources, verification locks, dependency changes, impact closure, and existing-test evidence;
- AGENTS impact/target and managed-only ownership;
- precise context sufficient for a fresh Worker without a conversation transcript.

Seal the supporting repository files needed by the whole task, including callers, types, fixtures, and conventions; Workers may read the union of that task's approved phase paths.
Writes and deletes remain phase-local.
This task-wide read authority is part of the proposal, not an ad hoc escalation during Implement.
Keep tasks small enough for one complete patch using compact exact replacements, and separate independent outputs during planning.
Give each dependency its reason in task context: a consumed producer output, an unresolved shared interface, or a concrete resource constraint.
Use `summary.parallelism.initiallyRunnableGroup` to inspect the bounded, conflict-free initial group, assuming shared slots are available.
The labelled static pairs describe eventual compatibility; inspect producer waits, all serialization causes, and global verification barriers before claiming concurrency.
Runtime capacity and capabilities still require Implement admission.
Keep reads precise so unrelated module tasks can run concurrently; shared interface or manifest changes need one explicit owner and dependent consumers.

For work spanning independent modules, plan independent tasks that can fill the four shared Worker slots, followed by dependent integration where necessary.
Do not chain tasks merely to prescribe an order or put every task behind the same resource label.
Do not split a small task solely to increase Worker count.
Use `summary.implementation` to inspect the accepted amendment policy and stable acceptance/constraint IDs alongside the initial phase permissions.
Its `review-only` authority and `runtimePrerequisites: "not-assessed"` are explicit: it neither grants broader scope nor certifies a working environment.
Before finalizing, resolve known missing runners, supported execution profile, required services, and credentials with the user in Design when repository evidence cannot resolve them.
Record the observed prerequisites and recovery approach in `design.md`; retain the existing prohibition on executing product tests during Design.
Do not describe a known unavailable prerequisite as ready for unattended execution.

Task `baselineVerification` may be omitted only when every affected input is a safe regular file in the original snapshot; the compiler then projects that exact affected contract.
For a new Red test, declare its output and keep it in the phase, affected, repair, cumulative and post-apply contracts.
Bind the original baseline to executable existing regression coverage or an existing full suite, without creating that future test in the baseline or dropping acceptance.
An existing file which is also a future modification output remains readable at its original bytes for baseline verification.

Impact closure must name affected existing tests and fixtures; a suite made only from newly added tests is insufficient.
In `impactClosure.relatedTests`, `current-task` means this task edits that test: its path must appear in a phase's `write` set.
Use `regression-task` with `regressionTaskId` when another planned task owns the edit; use `unaffected` with evidence when an existing test is preserved without edits, even if it remains in `affectedSuite`.
Do not expand write sets merely to satisfy a disposition label.
For public UI or API work, seal the relevant route authorization, page state, API response and contract, public HTML/template/theme behavior, and an approved browser E2E check when those surfaces are affected.

The plan admits only shell-free `vitest`, `package-script`, `static-check`, or ordered `steps` contracts.
Pin local runners, package scripts, arguments, `minTests`, and `noInstall` behavior; sealed classifications are derived from phase/purpose when omitted.
Reject shell operators, implicit downloads, absolute/escaping paths, missing local capability, and unsupported verification shapes during Design readiness.

After current Gate A approval, send the author draft through `write-artifact` only to the relative path `plan-draft.json`.
Before mutation-owning compilation, use the read-only typed preflight; it validates the same fixed draft and returns task/output counts plus hashes without installing canonical files or journaling a plan revision:

```json
{"action":"design","request":{"operation":"validate-plan-draft","runId":"<run-id>"}}
```

If preflight fails, correct the returned diagnostic batch using `field`, `path`, `expectedPaths`, `actualPaths`, and code-owned `hint` where available.
Path lists marked `pathsTruncated` are partial; inspect only the identified boundary when more detail is needed.
Do not bisect the draft blindly or repeat an unchanged validation/finalization request.
After preflight succeeds, invoke code-owned compilation:

```json
{"action":"design","request":{"operation":"compile-plan","runId":"<run-id>","operationId":"<unique-operation>"}}
```

The compiler reads only that fixed safe path, validates capability and graph closure again, installs the generated verification bindings into the existing `tasks.md` and canonical `implement-plan.json` under the same compilation lease, and records the plan only after both writes succeed.
It returns the plan’s raw and canonical hashes.
Do not hand-assemble canonical plan bytes, hashes, generated task Markdown, or receipts.
The canonical `ImplementPlan` contains:

- tasks and regular-file outputs;
- target-contract identities, task original-baseline contracts, full-suite baseline and normalized failure identity policy;
- change-level affected, full-suite, and post-apply verification;
- an explicit `artifactCorrection.maxAttempts` of 2-3 attempts for a verification obligation and phase, including the initial attempt; operation ids, rollback lineage, route changes, task renaming, and rewording do not replenish it;
- bounded in-boundary repair policy and attribution classes `pre-existing | introduced | unresolved | environment`;
- parent-owned `tasks.md` tracking;
- when required, one sealed managed-block AGENTS operation per approved target, including impact, owning task ids, complete marker-bounded content, and verification.

Use the code-owned readiness proof to require an executable static closure with no diagnostics.
A write set grants authority but never proves that an output exists.
Every absent future input must be a unique declared output available at its consumer's phase: the same task's current/prior phase, or a completed transitive dependency.
Affected/repair consume final task outputs; cumulative and post-apply consume outputs at their global barriers.
A deletion must have a causally later rewrite before consumption.
Original baseline contracts cannot consume future outputs.

## Gate B and trusted delivery

Gate B is a code-owned plan certificate, not a second user decision round.
The accepted proposal covers behavior, substantive technical choices, and authority to compile their realization.
Ask about any newly discovered substantive choice before recording that changed decision; preserve all existing decisions by id instead of restating their contract text.
`compile-plan` atomically records the validated plan and its Gate B proof after the current Gate A and substantive decisions.
Do not request a separate Gate B confirmation or an extra approve-gate call after successful compilation.
Finalization still validates strict OpenSpec artifacts, traceability, graph closure, and the current private proofs.

Request finalization:

```json
{"action":"design","request":{"operation":"finalize-delivery","runId":"<run-id>","operationId":"<unique-operation>"}}
```

Finalization revalidates both current private Gate proofs, the stored plan, strict/planning-complete OpenSpec state, artifact coverage, exact traceability, and executable verification closure.
It atomically installs canonical `gate-a.yaml`, writes `ready.yaml` last, rereads the installed delivery, removes `plan-draft.json`, marks the Design run completed, and returns `deliveryRevision` plus `receiptHash`.
Any failure leaves Design nonterminal and installs no new `ready.yaml`.

Finalization serializes artifact mutation through an expiring ownership lease; never bypass a lease conflict or manually repair code-owned receipt bytes.

The canonical receipts bind the Gate A and Gate B approval revisions, canonical contract hashes, and owner-private record hashes.
`ready.yaml` references the plan path, raw-byte hash, canonical plan hash, executable verification closure, Gate A hash, artifact hashes, and traceability hash.
It does not embed caller-owned runtime task state, completed/blocked arrays, snapshots, launch identities, or retry budgets.

Only the sealed task checkboxes may be normalized from `[x]`/`[X]` to `[ ]` when validating the tracked `tasks.md` hash.
Every other byte remains bound.

## Recovery without approval loops

On resume, validate current artifacts and receipts first.
Use Design `status` to recover bounded accepted-evidence identities/hashes, latest decision revisions, Gate currentness, and compiled-plan identity without relying on a prior child session.
A new revision of a completed change inherits decisions, Gate authority, and the canonical plan from the latest completed owner-private finalization for that same root and change.
Evidence packets are not inherited as current observations: recheck affected repository facts.
Technical-only changes keep Gate A; changed behavior invalidates both Gates.
Preserve decisions whose bound content did not change.
A mechanical hash, formatting, checkbox, stale path, or traceability repair regenerates only invalidated artifacts and does not reopen a user decision.
Reopen Gate A only for changed behavior authority; ask about changed substantive technical authority only when it is not already accepted.
The compiler regenerates Gate B as needed without a separate confirmation.
Report the exact invalidated decision/artifact instead of restarting the whole Design process.

Endpoint/transport failure in an evidence packet pauses that packet and retains other evidence.
Missing package scripts/runners or a non-executable verification contract must be corrected before Gate B; they must not be deferred as an Implement surprise.

Report `READY_TO_IMPLEMENT` only when strict validation passes, user decisions are resolved and both private proofs are current, all artifacts/hashes/traceability resolve, and the canonical plan is executable.
After successful code-owned finalization, return one brief readiness response with the change and delivery revision.
Do not reread receipts, survey directories or restate the full decision history after that success; finalization has already reread and validated the delivery.
Successful finalization deactivates private dispatch before an unrelated later request.
Gate waits remain active for direct follow-up; if the user explicitly ends an unfinished Design interaction, send `{"action":"finish"}`.
Otherwise report the current Design state, retained evidence, and the one unresolved decision or artifact that prevents readiness.
Design `status` exposes only Design `legalOperations`; explicit stage exit is separately exposed as top-level `packetActions: ["finish"]`.
Never send `operation: "finish"`; exit only with `{"action":"finish"}`.

Do not implement product code and do not archive, publish, release, stage, or commit implicitly.

<!-- ABEL:END -->
