## 1. Verification input timing

- [x] 1.1 Implement compiler-owned producer and consumption-time validation for original baseline, task phases, affected/repair, cumulative, checkpoint, and post-apply inputs.
      Regression evidence belongs in `test/verification-input-timing.test.ts`.
  - `specs/workflow-run-control-plane/spec.md#Time-bound verification inputs/A future Red test is declared`
  - `specs/workflow-run-control-plane/spec.md#Time-bound verification inputs/An original file will be modified`
  - `specs/workflow-run-control-plane/spec.md#Time-bound verification inputs/A consumer needs another task output`

- [x] 1.2 Preserve new acceptance tests and bind pre-existing-failure attribution to comparable verification obligations.
      Regression evidence belongs in `test/verification-input-timing.test.ts`, `test/task-baseline.test.ts`, and `test/verification-attribution.test.ts`.
  - `specs/workflow-run-control-plane/spec.md#Time-bound verification inputs/A new acceptance test fails later`

## 2. Task baseline and input evidence

- [x] 2.1 Distinguish absent and unsafe verification inputs, including symlink components, and preserve bounded observations through package, phase, and change adapters. `bun run test:target test/verification-capability.test.ts test/package-verification.test.ts` passed 42 tests; Red evidence is retained outside the repository at `/tmp/cadence-parallel-baseline/input-observation-red.log`.
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/Verification input is absent or unsafe`

- [x] 2.2 Capture and cache task baselines lazily against the immutable original revision, retain successful sibling evidence, and prevent unavailable preparation from consuming Worker attempts.
      Regression evidence belongs in `test/task-baseline.test.ts` and `test/workflow-engine.integration.test.ts`.
  - `specs/workflow-run-control-plane/spec.md#Task-local baseline prerequisites/One task baseline is requested`
  - `specs/workflow-run-control-plane/spec.md#Task-local baseline prerequisites/A local baseline prerequisite is unavailable`
  - `specs/workflow-run-control-plane/spec.md#Task-local baseline prerequisites/A baseline contract is amended`

## 3. Continuous shared scheduling

- [x] 3.1 Replace batch-wide waiting with individual settlement and shared-capacity wakeups while retaining the four-slot cross-run limit.
      Use controlled barriers in `test/workflow-engine.integration.test.ts` to prove overlap, refill order, and cross-run wakeup.
  - `specs/workflow-run-control-plane/spec.md#Continuous shared task scheduling/Independent work exceeds shared capacity`
  - `specs/workflow-run-control-plane/spec.md#Continuous shared task scheduling/A fast task settles before its siblings`
  - `specs/workflow-run-control-plane/spec.md#Continuous shared task scheduling/Another run releases shared capacity`

- [x] 3.2 Preserve durable dependency, conflict, verification-lock, and FIFO queues without reserving attempts before a task is runnable.
      Regression evidence belongs in `test/workflow-engine.integration.test.ts` and scheduling policy tests.
  - `specs/workflow-run-control-plane/spec.md#Continuous shared task scheduling/A dependency or conflict prevents launch`

## 4. Evidence-bound amendment and resume

- [x] 4.1 Admit technical amendments only from trusted input-timing or verification-contract evidence; fence affected work and retain the same run, accepted authority, compatible phase evidence, checkpoints, recovery history, and budgets across revision and reopen.
      Regression evidence belongs in `test/workflow-engine.integration.test.ts`.
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/A proven plan defect is amended`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Technical plan defect needs revision`

- [x] 4.2 Persist comparable prerequisite fingerprints so unchanged resume returns a stable blocker without Worker or verifier replay, while a proven prerequisite change permits only a bounded probe.
      Regression evidence belongs in `test/task-baseline.test.ts`, `test/workflow-engine.integration.test.ts`, and `test/workflow-status.test.ts`.
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/Resume observes no prerequisite change`
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/A prerequisite demonstrably changes`

- [x] 4.3 Withhold amendment authority for unsafe, unknown, cancelled, exhausted, currentness-invalid, hash-invalid, proof-invalid, and receipt-invalid failures.
      Regression evidence belongs in `test/workflow-engine.integration.test.ts`, `test/workflow-status.test.ts`, and delivery admission tests.
  - `specs/workflow-run-control-plane/spec.md#Evidence-bound recovery and amendment/Integrity or unknown failure is reported`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Automatic amendment keeps failing`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Explicit cancellation interrupts continuation`

## 5. Settlement and completion

- [x] 5.1 Fence and settle Workers, verification, amendments, descendants, and resource cleanup before cancel or close completes.
      Deterministic evidence belongs in `test/workflow-engine.integration.test.ts` and broker lifecycle suites; real Linux descendant evidence belongs in `test/isolation-real.integration.test.ts`.
  - `specs/workflow-run-control-plane/spec.md#Settlement and completion barriers/Cancellation or close races active work`

- [x] 5.2 Preserve global cumulative verification, currentness, transactional apply, post-apply verification, and complete command settlement as completion barriers.
      Regression evidence belongs in `test/task-baseline.test.ts`, `test/workflow-engine.integration.test.ts`, apply transaction tests, and real Linux isolation coverage where applicable.
  - `specs/workflow-run-control-plane/spec.md#Settlement and completion barriers/Local work completes while a required barrier is blocked`

## 6. Design and Implement guidance

- [x] 6.1 Update Design compilation and presentation so task contracts are independently executable and concurrency projections name actual parallel groups and serialization reasons.
      Regression evidence belongs in Design delivery and plan summary/diagnostic suites.
  - `specs/abel-workflow-prompt-package/spec.md#Delegable Design task graphs/A fresh Worker receives a task`
  - `specs/abel-workflow-prompt-package/spec.md#Delegable Design task graphs/Design projects parallel and serial work`
  - `specs/abel-workflow-prompt-package/spec.md#Delegable Design task graphs/A graph is not yet executable`

- [x] 6.2 Update Implement interaction so the parent follows evidence-bound same-stage continuations, reports concrete external blockers, and keeps status read-only and truthful during parallel work.
      Regression evidence belongs in stage activation, workflow status, and workflow engine integration suites.
  - `specs/abel-workflow-prompt-package/spec.md#Autonomous same-stage continuation/A technical continuation is available`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Implementation choice is delegated`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Parent recovery is presented to the user`
  - `specs/abel-workflow-prompt-package/spec.md#Autonomous same-stage continuation/No safe automatic action remains`
  - `specs/abel-workflow-prompt-package/spec.md#Autonomous same-stage continuation/Status is requested during parallel work`

- [x] 6.3 Keep isolated Red-Green-Refactor ordering, producer completion, new-test acceptance, and failure classification explicit in Implement guidance and runtime wiring.
      Regression evidence belongs in graph, verification timing, package verification, workflow engine, and isolation suites.
  - `specs/abel-workflow-prompt-package/spec.md#Verification-safe Implement guidance/A task consumes a producer output`
  - `specs/abel-workflow-prompt-package/spec.md#Verification-safe Implement guidance/A new test becomes available after Red`
  - `specs/abel-workflow-prompt-package/spec.md#Verification-safe Implement guidance/Verification infrastructure fails`

## 7. Final validation and synchronization

- [x] 7.1 Synchronize the accepted deltas into the current capability specifications and managed documentation only after implementation behavior is verified.

- [x] 7.2 Run strict validation for this change and `bun run traceability:check`; resolve every Scenario exactly once without manufacturing Gate, ready, receipt, or completion facts.

- [x] 7.3 Run `bun run verify`, record pre-existing versus introduced failures, and run applicable real Linux Bubblewrap regression separately from deterministic simulation.
      Report unexecuted Windows and macOS native checks without inferring them from Linux results.

## Acceptance evidence

All tasks above were verified against the implemented code and the final integration runs.
See `docs/autonomous-parallel-workflow-acceptance.md` at the package root for the a–h mapping, Red evidence, compatibility boundaries, and distinction between deterministic ports and real execution.
Final `bun run verify`: 1001 passed, 26 conditional skips, pack-check 104 members.
Real Linux isolation regression: 37 passed; enabled real OpenSpec Design/CLI contracts: 90 passed, 1 conditional skip.
Current specs and this change pass strict OpenSpec validation; traceability resolves 102 references exactly once across four active changes.
These checked engineering tasks do not manufacture a Gate, ready receipt, or product run completion fact.
