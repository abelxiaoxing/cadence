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

If the requirement/change is missing, absent, ambiguous, or not unique, stop before exploration and ask one focused question.
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
A later behavior decision invalidates both Gates; a later technical decision or plan compilation invalidates Gate B only.

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
- an explicit `artifactCorrection.maxAttempts` of 2-3 total candidate launches per task phase and operation, including the initial launch;
- bounded in-boundary repair policy and attribution classes `pre-existing | introduced | unresolved | environment`;
- parent-owned `tasks.md` tracking;
- when required, one sealed managed-block AGENTS operation per approved target, including impact, owning task ids, complete marker-bounded content, and verification.

Use the code-owned readiness proof to require an executable static closure with no diagnostics.
A write set grants authority but never proves that an output exists.
Every absent future input must be a unique declared output from a transitive dependency.

## Gate B and trusted delivery

Gate B grants no tool permission or authority beyond its recorded scope.
Gate B approves the complete HOW: substantive technical choices, task DAG, exact boundaries, verification/repair contracts, output postconditions, dependency changes, scheduling declarations, tracking, and AGENTS operations.
Do not request approval while any capability, closure, traceability, or blocking decision is unresolved.

After explicit approval, materialize any remaining schema artifacts through `write-artifact` one at a time and complete the code-owned sequence below.
First approve Gate B; the control plane accepts only a plan compiled after the current Gate A approval and latest substantive decisions, then binds that stored canonical hash so the caller never copies or recomputes it:

```json
{"action":"design","request":{"operation":"approve-gate","runId":"<run-id>","operationId":"<unique-operation>","gate":"gate-b"}}
```

Then request finalization:

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
Preserve decisions whose bound content did not change.
A mechanical hash, formatting, checkbox, stale path, or traceability repair regenerates only invalidated artifacts and does not reopen a Gate.
Reopen Gate A only for changed behavior authority; reopen Gate B only for changed technical authority.
Report the exact invalidated decision/artifact instead of restarting the whole Design process.

Endpoint/transport failure in an evidence packet pauses that packet and retains other evidence.
Missing package scripts/runners or a non-executable verification contract must be corrected before Gate B; they must not be deferred as an Implement surprise.

Report `READY_TO_IMPLEMENT` only when strict validation passes, both Gates have zero unresolved decisions, all artifacts/hashes/traceability resolve, and the canonical plan is executable.
Successful finalization deactivates private dispatch before an unrelated later request.
Gate waits remain active for direct follow-up; if the user explicitly ends an unfinished Design interaction, send `{"action":"finish"}`.
Otherwise report the current Design state, retained evidence, and the one unresolved decision or artifact that prevents readiness.
Design `status` exposes only Design `legalOperations`; explicit stage exit is separately exposed as top-level `packetActions: ["finish"]`.
Never send `operation: "finish"`; exit only with `{"action":"finish"}`.

Do not implement product code and do not archive, publish, release, stage, or commit implicitly.

<!-- ABEL:END -->
