## Why

Users should approve goals and meaningful trade-offs once, then let Implement make progress inside that authority. Identical plan compilation currently invalidates Gate B, completed Design revisions lose their usable approvals, and ordinary recovery can repeat without carrying actionable feedback or remembering exhaustion across resume.

## What Changes

- Preserve current Gates for identical compilation and reference-only decision repair.
- Seed a new Design revision from the latest completed private finalization for the same root and change, preserving unchanged decisions and approval authority.
- Consolidate Design questions and reuse explicit approval of technical choices when sealing their mechanical realization.
- Allow task-wide approved reads while retaining phase-local writes and deletes.
- Automatically retry artifact, stale-candidate, verification, and compact-patch correction with structured feedback and durable bounded recovery.
- Persist recovery incidents independently of diagnostics; prevent rollback, route changes, task renaming and prose changes from replenishing exhaustion.
- Reserve a finite shared work budget before execution, including nested repair and restart.
- Generate Gate B with compilation and collect all real authority gaps into a stable batch.
- Delegate remaining Implement choices to the parent recommendation; follow automatic same-change amendment and receipt-less resume without another user decision round.
- Admit allowlisted technical plan repairs through the same channel and bound mutation attempts durably across failed compilation, new batches and restart.
- Bind dynamically discovered ordinary reads to merge and final currentness while preserving phase write/delete limits.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-run-control-plane`: approval inheritance, idempotent compilation, and durable recovery.
- `private-agent-orchestration`: shared durable correction policy and task-wide read authority.
- `abel-workflow-prompt-package`: consolidated decisions and autonomous recovery inside approved task authority.

## Impact

Design journal/controller, Implement state machine and Worker composition, context classification, prompts, documentation, and regression tests. No new dependency, external service, automatic stage activation, unapproved product write, or publication is introduced. The private Implement tool schema adds a batch-bound amendment envelope and storage adds checked recovery/context namespaces.
