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
Otherwise investigate first: resolve discoverable unknowns from repository evidence and choose reversible defaults within existing authority; only unresolved substantive choices require a user decision.
An explicit `--change <name>` resumes only that existing change; never reinterpret a misspelling as a new requirement.

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

Gate A approves the complete WHAT: goal, observable scenarios, failures, scope/non-goals, compatibility/migration/security policy, and success criteria.
Before approval, present the unresolved behavior decisions together.
After explicit approval:

1. resolve the final kebab-case change name and schema;
2. approve the complete WHAT contract through the transient-text operation below;
3. bind the final change name to the same run with `bind-change`, creating the change root only through later artifact writes;
4. materialize schema-ready behavior artifacts one at a time.

```json
{"action":"design","request":{"operation":"approve-gate","runId":"<run-id>","operationId":"<unique-operation>","gate":"gate-a","contract":"<complete-approved-what-contract>"}}
```

The control plane generates the canonical behavior-contract hash; the returned proof contains its approval revision, contract hash, and owner-private record hash.
`gate-a.yaml` is installed later by code-owned finalization, not hand-authored here.

Gate A is not tool permission and carries no session/model/timestamp identity.
A later behavior decision invalidates both Gates; a later technical decision or changed plan compilation invalidates Gate B only.
Compiling identical canonical bytes after unchanged decisions preserves the existing plan revision and both Gates, even with a new operation id.

## Technical contract and ImplementPlan

Derive HOW from Gate A plus repository evidence.
Ask only unresolved substantive technical decisions, then build a complete task DAG with stable Requirement → Scenario → Verification → Task references.

Each task must seal:

- stable id, objective, exact dependencies and edge reasons;
- exact phase-local read/write/delete paths and output producers;
- Red, Green, optional Refactor structured verification and exact verification inputs;
- task-affected and repair verification contracts;
- conflicts, resources, verification locks, dependency changes, impact closure, and existing-test evidence;
- AGENTS impact/target and managed-only ownership;
- precise context sufficient for a fresh Worker without a conversation transcript.

Seal the supporting repository files needed by the whole task, including callers, types, fixtures, and conventions; Workers may read the union of that task's approved phase paths.
Writes and deletes remain phase-local.
This task-wide read authority is part of the proposal, not an ad hoc escalation during Implement.
Keep tasks small enough for one complete patch using compact exact replacements, and separate independent outputs during planning.

Impact closure must name affected existing tests and fixtures; a suite made only from newly added tests is insufficient.
For public UI or API work, seal the relevant route authorization, page state, API response and contract, public HTML/template/theme behavior, and an approved browser E2E check when those surfaces are affected.

The plan admits only shell-free `vitest`, `package-script`, `static-check`, or ordered `steps` contracts.
`dev-browser` is required only by an approved browser E2E contract; its absence does not block unrelated tasks or stages.
Pin local runners, package scripts, arguments, `minTests`, classifications, and `noInstall` behavior.
Reject shell operators, implicit downloads, absolute/escaping paths, missing local capability, and unsupported verification shapes during Design readiness.

After current Gate A approval, send the complete draft through `write-artifact` only to the relative path `plan-draft.json`.
Before mutation-owning compilation, use the read-only typed preflight; it validates the same fixed draft and returns task/output counts plus hashes without installing canonical files or journaling a plan revision:

```json
{"action":"design","request":{"operation":"validate-plan-draft","runId":"<run-id>"}}
```

If preflight fails, use its safe structured diagnostics (`code`, and when applicable `taskId`, `phase`, `field`, `category`, `owner`, `verificationId`, or `outputId`) to repair the exact boundary.
Do not bisect the draft blindly or repeat an unchanged validation/finalization request.
After preflight succeeds, invoke code-owned compilation:

```json
{"action":"design","request":{"operation":"compile-plan","runId":"<run-id>","operationId":"<unique-operation>"}}
```

The compiler reads only that fixed safe path, validates capability and graph closure again, atomically installs canonical `implement-plan.json`, and returns its raw and canonical hashes.
Do not hand-assemble canonical plan bytes, hashes, generated task Markdown, or receipts.
The canonical `ImplementPlan` contains:

- tasks and regular-file outputs;
- target/affected/full-suite baselines and normalized failure identity policy;
- change-level affected, full-suite, and post-apply verification;
- an explicit `artifactCorrection.maxAttempts` of 2-3 attempts for a verification obligation and phase, including the initial attempt; operation ids, rollback lineage, route changes, task renaming, and rewording do not replenish it;
- bounded in-boundary repair policy and attribution classes `pre-existing | introduced | unresolved | environment`;
- parent-owned `tasks.md` tracking;
- when required, one sealed managed-block AGENTS operation per approved target, including impact, owning task ids, complete marker-bounded content, and verification.

Use the code-owned readiness proof to require an executable static closure with no diagnostics.
A write set grants authority but never proves that an output exists.
Every absent future input must be a unique declared output from a transitive dependency.

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
Successful finalization deactivates private dispatch before an unrelated later request.
Gate waits remain active for direct follow-up; if the user explicitly ends an unfinished Design interaction, send `{"action":"finish"}`.
Otherwise report the current Design state, retained evidence, and the one unresolved decision or artifact that prevents readiness.
Design `status` exposes only Design `legalOperations`; explicit stage exit is separately exposed as top-level `packetActions: ["finish"]`.
Never send `operation: "finish"`; exit only with `{"action":"finish"}`.

Do not implement product code and do not archive, publish, release, stage, or commit implicitly.

<!-- ABEL:END -->

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

Mechanical tasks may write document/data/config files (`.md`, `.txt`, `.json`, `.yaml`, `.yml`, `.toml`, `.lock`).
Refactor tasks preserve accepted verifier inputs.
Both must declare no public behavior change and require an explicitly allowed mode in Gate A. Specify task `verificationMode` and Green (plus optional Refactor); omit Red in the draft.
The compiler handles its internal compatibility representation.
Runtime captures baseline and executes Green with affected, cumulative and post-apply verification, without generating a Red candidate.
Behavior tasks continue to require Red/Green.

An AGENTS checkpoint additionally requires its exact target path in `policy.writeRoots`; a broad source root does not grant AGENTS authority.
