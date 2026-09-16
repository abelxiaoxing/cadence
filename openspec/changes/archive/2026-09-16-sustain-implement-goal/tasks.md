## 1. Design handoff

- [x] 1.1 Present bounded accepted recovery policy and decision ownership; update Design guidance and test policy preservation and legacy behavior.
  - `specs/abel-workflow-prompt-package/spec.md#Design recovery handoff/A structured contract is handed off`
  - `specs/abel-workflow-prompt-package/spec.md#Design recovery handoff/A historical plan has no structured policy`

## 2. Sustained execution

- [x] 2.1 Implement and verify current-status-bound host continuation, including in-progress amendments and a real Pi session.
  - `specs/abel-workflow-prompt-package/spec.md#Host sustained Implement execution/The parent stops before an available continuation`
  - `specs/abel-workflow-prompt-package/spec.md#Host sustained Implement execution/A technical amendment is unfinished`
- [x] 2.2 Verify semantic no-progress protection and lifecycle interruption boundaries. Host continuation/activation regression: 59 passed.
  - `specs/abel-workflow-prompt-package/spec.md#Host sustained Implement execution/Unchanged attempts make no progress`
  - `specs/abel-workflow-prompt-package/spec.md#Host sustained Implement execution/The user or model interrupts execution`
- [x] 2.3 Project and verify conditional parent recovery guidance with preserved authority and budgets. Recovery/status/engine regression: 105 passed.
  - `specs/abel-workflow-prompt-package/spec.md#Host sustained Implement execution/Recovery requires parent investigation`
  - `specs/abel-workflow-prompt-package/spec.md#Host sustained Implement execution/An explicit invocation resumes interrupted work`
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/Verification input is absent or unsafe`
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/A proven plan defect is amended`
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/Resume observes no prerequisite change`
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/A prerequisite demonstrably changes`
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/Integrity or unknown failure is reported`
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/An exhausted correction needs a different strategy`

## 3. Integration

- [x] 3.1 Synchronize current specs and package member inventory after implementation; run full verification, strict OpenSpec validation, traceability, and applicable real Linux isolation tests.

## Acceptance evidence

- `bun run verify`: TypeScript/syntax, lint, 1048 passing tests with 26 conditional skips, and real pack verification with 105 package members.
- Review regressions: 22 targeted tests passed after reproducing cancellation during a real Pi settlement status read and identical projected recovery failures. Continuation retains the aborted run signal; status and tool-result progress fingerprints exclude retry counts and derived batch IDs while preserving changed evidence and live authority envelopes.
- `CADENCE_REAL_ISOLATION=1 bun run test:target test/isolation-real.integration.test.ts`: 13 passed using Linux Bubblewrap.
- `CADENCE_REAL_OPENSPEC=1 bun run test:target test/openspec-cli.test.ts test/design-delivery.integration.test.ts`: 90 passed, 1 conditional skip.
- `openspec validate --all --strict --no-interactive`: 9 items passed.
- `bun run traceability:check`: 116 Scenario references across 5 active changes resolve exactly once.
- Independent reviews identified settlement cancellation and retry-bookkeeping progress defects; the review regressions above cover both fixes.

The real Pi continuation tests use a synthetic Provider and an injected engine; they verify actual host queue/settlement behavior without claiming live-model completion or production endpoint reliability.
Durable engine and real Linux isolation suites separately verify the execution and persistence boundaries.
These engineering completion facts do not create Gate approvals, ready receipts, or a completed consumer run.
