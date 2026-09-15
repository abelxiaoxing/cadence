## Why

Implement can already execute independent tasks with a shared limit, but it waits for a launched batch before filling a released slot.
Verification also treats every declared input as if it had to exist in the original baseline, so a future Red test or one task's unavailable verifier can stop unrelated work.
The existing amendment and recovery path needs stronger, code-owned evidence to distinguish a correctable plan defect from an unsafe path, environment drift, or delivery-integrity failure.

## What Changes

- Extend the compiled task graph with explicit task baseline verification and code-owned verification-input timing across baseline, Red, Green, Refactor, affected, repair, cumulative, checkpoint, and post-apply consumers.
- Preserve every new acceptance test after it is produced while excluding future files from the immutable original baseline.
- Capture task baselines lazily and keep a local prerequisite failure from blocking independent runnable tasks.
- Drive scheduling from individual task settlement and shared-capacity events so available slots are refilled without waiting for slow siblings; retain the shared four-slot limit, dependency ordering, conflict safety, and FIFO cross-run fairness.
- Record bounded structured failure facts that distinguish absent input, unsafe input, environment or runner drift, candidate failure, external capability loss, and integrity or unknown failure.
- Admit automatic plan amendment only from trusted, evidence-bound technical defects; retain the same run, accepted behavior authority, completed compatible evidence, checkpoints, and consumed budgets across revision and reopen.
- Prevent unchanged resume from relaunching a Worker or repeating the same failed verification; allow only bounded probes tied to an observable prerequisite change.
- Keep cancellation, close, cumulative verification, currentness, transactional apply, and terminal completion as settlement and integrity barriers.
- Update Design and Implement guidance to describe executable task graphs, actual concurrency and blockers, and parent-owned same-stage continuation without repeated user approval.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-run-control-plane`: verification-input timing, task-local baseline prerequisites, continuous shared scheduling, evidence-bound recovery, retained amendment, and settlement barriers.
- `abel-workflow-prompt-package`: independently executable Design task graphs, truthful concurrency projection, and autonomous same-stage continuation within accepted authority.

## Impact

The change extends the existing compiler, durable verification composition, scheduler, status projection, amendment path, and stage prompts.
It reuses the existing state machine, shared four-slot capacity, isolated Worker runtime, checked storage, delivery proofs, and transactional apply.
It introduces no second execution engine, host-trusted execution mode, automatic stage activation, new external service, or publication action.
