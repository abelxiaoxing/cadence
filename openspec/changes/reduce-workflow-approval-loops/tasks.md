## 1. Approval continuity

- [x] 1.1 Implement and verify idempotent plan compilation, reference-only decision repair, and finalized authority inheritance.
  - `specs/workflow-run-control-plane/spec.md#Approval continuity across mechanical work/Identical compilation preserves approval`
  - `specs/workflow-run-control-plane/spec.md#Approval continuity across mechanical work/Technical revision inherits behavior`
  - `specs/workflow-run-control-plane/spec.md#Approval continuity across mechanical work/Reference repair preserves approval`
  - `specs/workflow-run-control-plane/spec.md#Durable Design decisions and Gate proofs/Behavior changes after Gate A`
  - `specs/workflow-run-control-plane/spec.md#Durable Design decisions and Gate proofs/Technical decision changes after Gate B`
  - `specs/workflow-run-control-plane/spec.md#Durable Design decisions and Gate proofs/Approval operation is replayed`

## 2. Autonomous recovery

- [x] 2.1 Implement and verify durable recovery feedback, task-wide reads, bounded compact correction, and restart/rebind behavior.
  - `specs/workflow-run-control-plane/spec.md#Durable autonomous recovery/Stale candidate is refreshed automatically`
  - `specs/workflow-run-control-plane/spec.md#Durable autonomous recovery/Exhausted recovery is not reset by resume`
  - `specs/workflow-run-control-plane/spec.md#Durable autonomous recovery/Route replacement preserves exhaustion`
  - `specs/abel-workflow-prompt-package/spec.md#Autonomous work within task authority/Another phase already authorizes a supporting read`
  - `specs/abel-workflow-prompt-package/spec.md#Autonomous work within task authority/Complete patch exceeds the output limit`
  - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Connection deadline expires`
  - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Automatic attempts are exhausted`
  - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Replacement Worker resumes`
  - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Result capacity is insufficient`

## 3. Interaction and validation

- [x] 3.1 Update prompts, current specifications, README and index; complete distribution and regression checks.
  - `specs/abel-workflow-prompt-package/spec.md#Consolidated user decisions/Compilation needs no new decision`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/New design reaches Gate A`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Design begins without caller hashing tools`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Independent Design packets run concurrently`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Delegated Design evidence remains untrusted`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Evidence Worker becomes unavailable`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Mechanical choices remain non-blocking`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Existing change is resumed`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Artifact integrity is invalid`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Delivery is compiled`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Design is complete`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Mechanical delivery evidence changes`
  - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Design evidence is collected`

## 4. workflow-run-control-plane closure

- [x] 4.1 Implement and verify the loop-prevention contracts and production wiring.
  - `specs/workflow-run-control-plane/spec.md#Batched amendments inside Implement/Concurrent gaps are collected together`
  - `specs/workflow-run-control-plane/spec.md#Batched amendments inside Implement/Amendment continues without switching stages`
  - `specs/workflow-run-control-plane/spec.md#Batched amendments inside Implement/Stale or unrelated amendment is submitted`
  - `specs/workflow-run-control-plane/spec.md#Persistent recovery reservations/Internal rollback repeats the same failure`
  - `specs/workflow-run-control-plane/spec.md#Persistent recovery reservations/Nested work consumes the retained budget`
  - `specs/workflow-run-control-plane/spec.md#Persistent recovery reservations/Recovery metadata changes`

## 5. private-agent-orchestration closure

- [x] 5.1 Implement and verify the loop-prevention contracts and production wiring.
  - `specs/private-agent-orchestration/spec.md#Bound context discovery/A supporting file was omitted from the task`
  - `specs/private-agent-orchestration/spec.md#Bound context discovery/Discovered context changes in the main workspace`

## 6. abel-workflow-prompt-package closure

- [x] 6.1 Implement and verify the loop-prevention contracts and production wiring.
  - `specs/abel-workflow-prompt-package/spec.md#Compiler-owned plan confirmation/Compilation completes the accepted proposal`

## 7. Delegated implementation decisions

- [x] 7.1 Implement parent-owned recommendation/continuation, technical amendments, persistent mutation reservations and truthful recovery presentation; verify cancellation, restart and real delivery round trips.
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Implementation choice is delegated`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Technical plan defect needs revision`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Automatic amendment keeps failing`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Explicit cancellation interrupts continuation`
  - `specs/workflow-run-control-plane/spec.md#Parent-owned implementation continuation/Parent recovery is presented to the user`
