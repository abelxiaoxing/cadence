# Checks, recovery, review and scratch ownership

## Verification stages and evidence reuse

### Stage 4 converges fast checks and pre-review before heavy checks and C0 sealing

Kind: contract

Why: When both fast and heavy checks exist, Stage 4 converges fast checks fail-fast and runs code pre-review before paying for heavy checks on single-parent `C0`.
Stage 5 runs optimistic `C0` checks and Stage 6 shell-free `learn()` before the run takes its landing turn; a zero-edit `learn()` reuses exact `C0` check evidence only when HEAD, tree, revision and source digest match identically.
No check ever runs in the user's checkout: the commit that lands is the commit that was checked.

Anchors: `src/service/workflows.ts#sealAndCheckC0`, `src/service/workflow-review-ledger.ts#ReviewLedger`, `test/workflow-delivery-runtime.test.ts`

Source: internalized from engineering/checks-review.md, 2026-11-22

### A merged candidate is held to what landed beside it

Kind: contract

Why: A run takes its lane's `LandingLog` mark with its baseline; when it absorbs the branch, `siblingChecks` adds the checks of every delivery that landed since on a source file this delivery also changes (same command once, still an ancestor of the new base), and they gate the round like its own.
The review is told which files both changed and which a worker reconciled, and reads what the branch gained through the `changes` tool's `frontier` scope (`frontierBase..base`).
Paths a declared build writes do not count as overlap.

Anchors: `src/service/workflows.ts#siblingChecks`, `src/service/merge-queue.ts#LandingLog`, `src/service/workflows.ts#frontierBrief`, `src/change-tools.mjs#createChangeTools`, `test/merge-queue-delivery.test.ts`

Source: this delivery, 2026-11-24

### Timed-out checks and nonzero workers need confirmed settlement before recovery

Kind: pitfall

Why: Direct-child close alone cannot authorize another editing worker after nonzero exit without settled cleanup diagnostics, and a timed-out shell check enters diagnosis/replan only when its POSIX process group is confirmed settled (`ESRCH`).
Unsettled timeouts and unknown closures never replay.

Anchors: `src/service/workflows.ts`, `test/workflow-review-ledger.test.ts`, `test/workflow-recovery-regressions.test.ts`

Source: internalized from engineering/checks-review.md, 2026-11-22

## Adaptive recovery, deviations and review verdicts

### Structured submissions arrive through tools and are decoded strictly

Kind: contract

Why: Diagnosis submits through `cadence_recovery`, route planning through `cadence_route`; `WorkflowTranscript.submission(tool)` retains the latest successful tool result beyond transcript bounds, and the step text is that object.
`decodeRecoveryDecision` and `decodeRoutePlan` parse exactly one complete object with `parseWireJson` (prose, fences, arrays, duplicate keys and unknown fields are refused, never salvaged), keep exact failed-step identity for `evidence`, and return field-specific objections; a missing submission is the objection.
Unchanged evidence with an identical approach still escalates `repair` -> `replan` -> `deviate`.

Anchors: `src/service/workflow-controller.ts#decodeRecoveryDecision`, `src/service/workflow-report.ts#WorkflowTranscript`, `test/workflow-controller.test.ts`, `test/workflow-revision.test.ts`, `test/worker-structure.test.mjs`

Source: engineering/checks-review.md, updated 2026-11-26

### Deviations require independent Agent review confirmation and never silence all checks

Kind: contract

Why: A declared check is set aside only by a recorded deviation naming it (`waived` in the acceptance record); it still runs and shows as failed, and a candidate whose every check was set aside is never accepted.
Automatic Agent review parses the complete selected message before display clipping, must confirm every deviation as necessary and minimal, and never sets `humanReviewed: true`.

Anchors: `src/service/workflows.ts`, `src/service/contracts/workflow.ts#WORKFLOW_DEVIATIONS`, `test/workflow-review-ledger.test.ts`

Source: internalized from engineering/checks-review.md, 2026-11-22

## Owner-managed temporary scratch environment

### RunEnvironment owns workspace-specific TMPDIR pools and never sweeps foreign roots

Kind: contract

Why: Admitted deliveries lazily allocate random `0700` workspace scratch directories under `<stateHome>/cadence-tmp-v1/` on the workspace's disk filesystem and inject `TMPDIR`/`TEMP`/`TMP` into workers, checks and Git commands.
Only completed work with confirmed settlement unlinks its own identity-checked roots; failure, cancellation or uncertain closure retains them, and unsuitable state-homes fail concretely without falling back to `/tmp` or `$HOME`.

Anchors: `src/service/run-environment.ts#RUN_TEMP_DIRECTORY`, `test/run-environment.test.ts`, `test/workflow-lifecycle.test.ts`

Source: internalized from engineering/checks-review.md, 2026-11-22
