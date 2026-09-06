---
name: abel-implement
description: Execute one approved change through the durable control plane
category: abel
tags: [abel, implement, openspec, TDD, recovery]
argument-hint: "<change_name>"
---

This procedure applies only when the user explicitly invokes `/abel-implement`.
Reading this file, mentioning the command, or finding OpenSpec artifacts does not activate it.
Read the complete value inside `<abel-request>` without tokenizing it a second time.

<abel-request>
$ARGUMENTS
</abel-request>

<!-- ABEL:PROMPT:abel-implement -->

This stage is scoped to the invoked task.
Direct answers and same-task continuations stay in this stage.
If the user ends the workflow or requests an unrelated task, first send `{"action":"finish"}` to `abel_dispatch`, then handle the new task normally with the restored tools.
Exit preserves resumable work and never means completion or discard.
Never start another stage automatically.
<!-- ABEL:START -->

# Implement outcome

The request must resolve to exactly one existing change.
If it is missing, absent, or ambiguous, stop before execution and ask for the unique change name.

Implement is a durable, resumable execution stage.
The private control plane owns task scheduling, Red-Green-Refactor progression, candidate application, verification attribution, repair, task checkbox updates, AGENTS checkpoints, and the final transaction.
The parent interprets state and makes product decisions; it must not reproduce those mechanics manually.

## Trusted admission

Before the first Worker launch, load the current `ready.yaml` and referenced canonical `implement-plan.json`; verify both current owner-private Gate proofs and the finalization fact binding the exact delivery revision, receipt hash, and canonical plan hash, plus the Gate A binding, raw and canonical hashes, OpenSpec strict/planning status, Requirement → Scenario → Verification → Task traceability, capability closure, exact path/output contracts, repair policy, tracking contract, and sealed AGENTS operations.

An invalid or incomplete delivery is one aggregated `delivery-invalid` admission result.
Report every safe diagnostic together.
Do not launch a Worker, consume a retry, mutate the main workspace, or infer a missing contract.

Gate approval is not tool permission.
A fresh context validates existing approval facts and does not ask the user to approve unchanged decisions again.

## Closed control surface

For durable run operations, use `abel_dispatch` only with the change commands below; never send `version`; never send `action: "run"`; and never send `admit-graph`, `task-attempt`, caller-owned snapshots, completed/blocked arrays, or apply identities.

```json
{"command":"start","stage":"abel-implement","change":"<change>","operationId":"<unique-operation>"}
{"command":"status","stage":"abel-implement","change":"<change>"}
{"command":"resume","stage":"abel-implement","change":"<change>","operationId":"<unique-operation>"}
{"command":"rebind","stage":"abel-implement","change":"<change>","operationId":"<unique-operation>","routeId":"<approved-route>"}
{"command":"cancel","stage":"abel-implement","change":"<change>","operationId":"<unique-operation>"}
{"command":"discard","stage":"abel-implement","change":"<change>","operationId":"<unique-operation>"}
```

When the user approves a revised delivery boundary, resume the same run with both `deliveryRevision` and `receiptHash`.
The engine revalidates retained phase/repair facts, invalidates only incompatible tasks, rebuilds tracking, and preserves compatible work.

`status` is local and must remain useful when every Worker endpoint is unavailable.
`discard` is an explicit destructive request; leaving the workflow uses `{"action":"finish"}` and preserves the run instead.
Repeating the same operation id returns its committed outcome.
Use a new operation id for a new attempt.

For an approval-needed retained run, a later explicit Implement invocation must inspect local `status`.
When a newer owner-private-proof-bound receipt is present, status exposes its exact pair in `availableDelivery`, adds `resume` to `legalCommands`, and fills the matching `conditionalCommands` arguments.
Resume with that discovered pair; do not require the user to copy revision or hash data from a prior Design conversation.
Discovery never admits the delivery: `resume` still performs the full artifact, traceability, capability, and currentness validation before any Worker starts.

## Execution and verification

Before any candidate, the engine records target-contract, task-affected, and full-suite baselines with normalized failure identities.
A pre-existing failure remains separate and never satisfies Red or becomes evidence that this change caused it.

For each ready task the engine runs:

1. Red in a disposable child revision; the declared target must fail with the approved identity.
2. Green with the minimum approved implementation; the declared target and task-affected contract must pass relative to baseline.
3. Optional Refactor with behavior unchanged and verification still green.
4. Parent-owned task completion and exactly one `tasks.md` checkbox update in the private cumulative revision.

Independent tasks may merge only after currentness and declared conflict checks.
Conflicting tasks remain durably queued without spending a Worker attempt.
Workers make one atomic structured-patch submission whose operations stay within their approved write/delete sets; unused authorized paths need not be touched.
The trusted submit tool validates exact replacements and file operations, generates the unified diff, and owns internal chunking, hashes, byte limits, and sealing; Workers never hand-author hunk ranges or write the workspace, AGENTS, task state, or the main repository.

After all tasks, run every task-affected contract, the approved full suite, output postconditions, and the code-owned managed-only AGENTS checkpoint.
Only then prepare one journaled, currentness-checked cumulative apply and the declared post-apply verification.
The main workspace stays unchanged before that transaction.

## Failure attribution and recovery

Ordinary failures stay inside this Implement run:

- `artifact`, wrong-Red identity, invalid/incomplete patch operation, stale candidate, or transport failure: use the bounded automatic attempt policy; after exhaustion pause with the last safe code and retain the last committed revision.
- Artifact correction alone consumes the sealed `artifactCorrection.maxAttempts` of 2-3 total candidate launches per task phase and operation, including the initial launch; a later `resume` starts a fresh operation budget.
- `environment` or `verification-adapter`: pause without speculative edits.
  Resume after the capability is restored; baseline facts and completed phases are reused.
- `pre-existing`: keep as baseline evidence.
  It does not authorize a code change and does not fail completion unless the change worsens it.
- `introduced` in a task-affected contract: reopen the owning task as `repairable`, perform the minimum bounded repair inside its approved paths, record `repair-verified`, and re-run attribution automatically.
- `unresolved` full-suite attribution: pause with failure identities and retained cumulative state; resume after evidence resolves ownership.
- `workspace-revision-stale`, conflict, cancellation, process interruption, or apply recovery: preserve user edits and resume from the last durable checkpoint.
  Cancellation is budget-neutral.
  During a partially visible final apply, recovery must settle before pause or discard.
- `result-limit`: pause as `needs-task-split`; never accept a partial patch.

No item above carries stage-routing metadata or asks the user to restart the approved workflow.

## The only approval-needed boundary

Use `approval-needed` only when continuing requires authority not present in the sealed delivery: new observable behavior, architecture or policy; a new/changed dependency; an undeclared write/delete/read target; expanded conflict/resource authority; a changed verification contract; an AGENTS target/impact/managed block change; or another irreversible scope decision.

Classify only codes in the closed authority table.
An unknown Worker, verifier, or internal approval code is an `approval-code-invalid` integrity pause; never guess a category or Gate from keywords.

Report the exact missing authority and retained run state.
Do not discard compatible work.
Expose `approval.category`, `approval.requiredGates`, safe `approval.refs`, and `approval.designRequest` as `/abel-design --change <change>` user guidance only; never invoke Design automatically.
Bare `resume` is not immediately executable progress while approval is missing, so keep it out of `legalCommands` and expose it only in `conditionalCommands` with a `deliveryRevision` greater than the retained revision and the matching `receiptHash` precondition.
If the user supplies that newly approved receipt revision, resume the same run with the revision/hash pair.
A generated artifact defect, endpoint outage, stale snapshot, environment failure, pre-existing failure, introduced in-boundary repair, approved documentation/test edit, or approved AGENTS checkpoint is never `approval-needed`.

## AGENTS and tracking

Design-time AGENTS read-only authority does not carry into Implement.
Gate B seals `none | update-existing | create-index | remove-index`, exact targets, owning task ids, verification, and the complete managed block.
The parent control plane applies those operations only in the private cumulative revision, preserves all human text outside `<!-- ABEL:AGENTS-INDEX:START -->` and `<!-- ABEL:AGENTS-INDEX:END -->`, and never gives an AGENTS write path to a Worker.

`remove-index` deletes a file only if no human content remains.
Runtime/session ids, credentials, approval state, and dirty-state ledgers never enter an index.

Task checkboxes are parent-owned progress facts.
The loader may normalize only `[x]`/`[X]` to `[ ]` for the sealed task ids when checking the delivery hash; every other byte remains integrity-bound.

When an approved browser E2E check requires `dev-browser` and it is unavailable, pause only that check; continue independent work when safe.

## Truthful completion

Treat `queued`, `connecting`, `waiting-first-response`, `running`, `validating`, `retrying`, `verifying`, `paused`, `approval-needed`, `applying`, and `recovering` as nonterminal activity states.
`operation-cancelled` ends only the current operation; `discarded` and `rejected` are non-success terminal run states.
Tool-call settlement is not success.
Report success only when the durable state is `completed`, final application and post-apply verification committed, and private run content was cleaned.
Terminal `completed`, `discarded`, or `rejected` settlement deactivates private dispatch; a nonterminal pause or approval wait keeps it active for direct follow-up.

On a nonterminal result, report the safe code, affected task/scope when present, retained progress, and the exact legal command that continues or inspects the same run.
Never hide an incomplete run behind a success checkmark.

Do not archive, publish, release, stage, or commit implicitly.

<!-- ABEL:END -->
