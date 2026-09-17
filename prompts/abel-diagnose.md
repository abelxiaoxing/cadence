---
description: Diagnose and minimally repair one or more existing bugs
argument-hint: "<problem-description>"
---

This procedure applies only when the user explicitly invokes `/abel-diagnose`.
Reading this file, mentioning the command, or finding OpenSpec artifacts does not activate it.
Read the complete value inside `<abel-request>` without tokenizing it a second time.

<abel-request>
$ARGUMENTS
</abel-request>

<!-- ABEL:PROMPT:abel-diagnose -->

Before following this procedure, check that `abel_dispatch` is actually callable in this model request.
If it is missing, stop and report `Cadence configuration error: abel-stage-tools-unavailable`.
Do not substitute bash, subagent, or terminal tools, and do not claim the stage started.
Ask the operator to enable the Cadence extension together with its package prompts, inspect extension-load errors and tool filters, then resubmit the original slash command while the session is idle.
A prompt marker or historical active/inactive message is not evidence that the tool is available.

This stage is scoped to the invoked task.
Direct answers and same-task continuations stay in this stage.
If the user ends the workflow or requests an unrelated task, first send `{"action":"finish"}` to `abel_dispatch`, then handle the new task normally with the restored tools.
Exit preserves resumable work and never means completion or discard.
Never start another stage automatically.

The request must uniquely identify one or more existing defects.
If required input is missing or ambiguous, stop before work and ask one focused question.

## Independent Diagnose contract

Diagnose is not an Implement recovery route and does not inherit Implement task states, retry budgets, approval codes, delivery revisions, or Gate routing.
A transport, environment, artifact, or verification failure in Diagnose remains a typed Diagnose pause with retained evidence; it never becomes an instruction to change workflow stage.

Use bounded `abel_dispatch` packets with `action: "run"`, `stage: "abel-diagnose"`, and role `diagnosis-worker` only when evidence collection benefits from isolation.
Each packet covers one defect or one falsification question.
Do not send an Implement control command from Diagnose.

The parent runs reproduction and verification commands and applies accepted diffs.
A diagnosis Worker is read-only: it proposes cited evidence or one complete candidate diff and never claims that it executed a command or observed a passing result.

## Evidence-first algorithm

For each defect, keep this order:

1. Record target, affected-suite, and full-suite baselines.
   Keep unrelated and pre-existing failures separate.
2. Reproduce the reported symptom with exact inputs and an observable failure identity.
3. List plausible root causes and actively falsify each one.
   Accept a root cause only when evidence rules out material alternatives.
4. Add the smallest executable regression verification and run it.
   It must fail for the reproduced defect, not for syntax, setup, environment, or another reason.
5. Apply the minimum repair within the existing behavior and architecture contract.
   Run the regression after every edit and the affected suite after refactoring.
6. Compare the full suite with baseline and require no introduced failure.
   Classify any AGENTS impact and apply only a verified managed-region update at a stable parent checkpoint.
   Preserve every byte outside `<!-- ABEL:AGENTS-INDEX:START -->` and `<!-- ABEL:AGENTS-INDEX:END -->`; never give a Worker an AGENTS write path or put runtime/session ids, credentials, or approval state in the index.

If reproduction is unavailable, root-cause evidence is insufficient, the regression cannot witness the defect, or an external capability is unavailable, return `paused` with the exact safe evidence and a concrete resume condition.
Do not invent a repair.

If the requested result actually requires new observable behavior, a new dependency, wider paths, substantive architecture/policy, or another product decision, return `scope-decision-required` with the evidence and decision that the user must make.
Do not silently widen Diagnose and do not transform an ordinary repair failure into that result.

When an approved browser E2E check cannot run, pause only that check and provide executable remediation; continue independent non-browser evidence when safe.

Finish only when reproduction, falsification, failing regression, minimum repair, affected verification, and baseline comparison are all evidenced.
After presenting the final structural diagnosis/repair result, send `{"action":"finish"}` so private dispatch is deactivated.
A resumable evidence or capability pause remains active for direct follow-up and must not send finish.
Never archive, publish, or commit implicitly.
