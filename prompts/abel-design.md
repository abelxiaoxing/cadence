---
name: abel-design
description: Produce a validated, approved, directly executable OpenSpec delivery without implementing product code
category: abel
tags: [abel, design, openspec, PBT, evidence]
argument-hint: "<requirement> | --change <change_name>"
---

Load the bundled `abel-workflow` Skill and read the complete value inside `<abel-request>` without tokenizing it a second time.

<abel-request>
$ARGUMENTS
</abel-request>

<!-- ABEL:PROMPT:abel-design -->
<!-- ABEL:START -->

# Design outcome

Design resolves product and technical decisions, collects cited evidence, and compiles one trusted delivery.
It never launches an implementation Worker, creates a product-code candidate, applies a product diff, runs Red/Green/Refactor, or mutates the main workspace.

If the requirement/change is missing, absent, ambiguous, or not unique, stop before exploration and ask one focused question.
An explicit `--change <name>` resumes only that existing change; never reinterpret a misspelling as a new requirement.

## Write boundary

- Before explicit Gate A approval, all repository work is read-only.
  A provisional Design run may exist only in the repository-external private run store.
- After Gate A, write only inside the canonical `openspec/changes/<change>/` root and only the next schema-ready artifact or a mechanically invalidated receipt.
- Every repository `AGENTS.md` remains read-only throughout Design.
  Audit it and seal any needed `none | update-existing | create-index | remove-index` operation into the implementation plan; never edit the index here.
- Never edit OpenSpec schemas, `openspec/config.yaml`, generated OpenSpec skills/commands, product code, tests, package manifests, or repository state outside the change root.

## Durable Design identity

Use `start` once to create or recover the Design run identity and `status` to inspect it.
A new requirement may begin with a code-generated SHA-256 `provisionalKey`; after Gate A fixes the change name, a named `start` binds the same provisional run.
These commands record lifecycle only and do not execute implementation work.

```json
{"version":2,"command":"start","stage":"abel-design","provisionalKey":"<sha256>","operationId":"<unique-operation>"}
{"version":2,"command":"start","stage":"abel-design","change":"<change>","provisionalKey":"<same-sha256>","operationId":"<unique-operation>"}
{"version":2,"command":"status","stage":"abel-design","change":"<change>"}
```

## Read-only evidence packets

Use `abel_dispatch` with `action: "run"` only for bounded Design evidence.
Each packet is one tool call, has `stage: "abel-design"`, role `design-explorer`, phase `evidence`, an exact read scope, an empty write set, and output `evidence`.
Never send an implementation phase to a Design packet.

```json
{
  "action":"run",
  "request":{
    "stage":"abel-design",
    "role":"design-explorer",
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
Validate packet id, scope, citations, and structure before synthesis; uncited, conflicting, or out-of-scope claims require a bounded follow-up or a minimal parent check.

Evidence packets may read code and tests but may not execute validation.
Design may inspect manifests and verification capability statically; it must not run product tests as a substitute for Implement evidence.

## Decision ledger and Gate A

Maintain a decision ledger with id, `behavior | technical`, question, cited evidence, alternatives, recommendation, user decision, status, and affected artifacts.

Ask the user only for substantive choices: observable behavior, scope/non-goals, data/security/privacy/compatibility/migration policy, new dependencies, architecture/policy, irreversible changes, and technical choices with real trade-offs.
Resolve reversible details mechanically from one established repository convention and do not ask them repeatedly.

Gate A approves the complete WHAT: goal, observable scenarios, failures, scope/non-goals, compatibility/migration/security policy, and success criteria.
Before approval, present the unresolved behavior decisions together.
After explicit approval:

1. resolve the final kebab-case change name and schema;
2. create the change only if it does not already exist;
3. materialize schema-ready behavior artifacts one at a time;
4. compile `gate-a.yaml` with code-owned canonical serialization and raw SHA-256 bindings.

Gate A is not tool permission and carries no session/model/timestamp identity.

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
Pin local runners, package scripts, arguments, `minTests`, classifications, and `noInstall` behavior.
Reject shell operators, implicit downloads, absolute/escaping paths, missing local capability, and unsupported verification shapes during Design readiness.

Compile one canonical `ImplementPlan` with `compileImplementPlan`.
It contains:

- tasks and regular-file outputs;
- target/affected/full-suite baselines and normalized failure identity policy;
- change-level affected, full-suite, and post-apply verification;
- an explicit `artifactCorrection.maxAttempts` of 2-3 total candidate launches per task phase and operation, including the initial launch;
- bounded in-boundary repair policy and attribution classes `pre-existing | introduced | unresolved | environment`;
- parent-owned `tasks.md` tracking;
- when required, one sealed managed-block AGENTS operation per approved target, including impact, owning task ids, complete marker-bounded content, and verification.

Use the shared readiness proof to require an executable static closure with no diagnostics.
A write set grants authority but never proves that an output exists.
Every absent future input must be a unique declared output from a transitive dependency.

## Gate B and trusted delivery

Gate B approves the complete HOW: substantive technical choices, task DAG, exact boundaries, verification/repair contracts, output postconditions, dependency changes, scheduling declarations, tracking, and AGENTS operations.
Do not request approval while any capability, closure, traceability, or blocking decision is unresolved.

After explicit approval, write remaining schema artifacts one at a time, run OpenSpec strict validation, then generate in this order:

1. canonical `implement-plan.json`;
2. canonical Gate A/plan/artifact/traceability bindings;
3. `ready.yaml` last, using `compileReadyReceipt`.

`ready.yaml` references the plan path, schema version, raw-byte hash, canonical plan hash, executable verification closure, Gate A hash, artifact hashes, and traceability hash.
It does not embed caller-owned runtime task state, completed/blocked arrays, snapshots, launch identities, or retry budgets.

Only the sealed task checkboxes may be normalized from `[x]`/`[X]` to `[ ]` when validating the tracked `tasks.md` hash.
Every other byte remains bound.

## Recovery without approval loops

On resume, validate current artifacts and receipts first.
Preserve decisions whose bound content did not change.
A mechanical hash, formatting, checkbox, stale path, or traceability repair regenerates only invalidated artifacts and does not reopen a Gate.
Reopen Gate A only for changed behavior authority; reopen Gate B only for changed technical authority.
Report the exact invalidated decision/artifact instead of restarting the whole Design process.

Endpoint/transport failure in an evidence packet pauses that packet and retains other evidence.
Missing package scripts/runners or a non-executable verification contract must be corrected before Gate B; they must not be deferred as an Implement surprise.

Report `READY_TO_IMPLEMENT` only when strict validation passes, both Gates have zero unresolved decisions, all artifacts/hashes/traceability resolve, and the canonical plan is executable.
Otherwise report the current Design state, retained evidence, and the one unresolved decision or artifact that prevents readiness.

Do not implement product code and do not archive, publish, release, stage, or commit implicitly.

<!-- ABEL:END -->
