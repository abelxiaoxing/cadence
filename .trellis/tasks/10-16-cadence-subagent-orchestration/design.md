# W4 — Boundary Design

## Mandatory Shared Design

Read the entire [parent design](../10-16-cadence-webui-terminal/design.md), especially sections **3,5–10,13**, and its PRD/plan before implementation/checking.
The referenced contracts are part of this child, not optional background.
Read [execution/history](../10-16-cadence-webui-terminal/design-runtime-history.md) and [client/distribution](../10-16-cadence-webui-terminal/design-clients-distribution.md) appendices completely as mandatory parent contracts.
No alternative versions, limits, auth/store policies or execution owners are introduced here.

## Owned Paths and Interfaces

- src/service/{graph,scheduler,task-actions}.ts
- Owner action-route integration and extracted TaskController semantic helpers
- Graph/scheduler/check/review tests; shared changes coordinated with W1

New paths are planned owners, not implemented artifacts.
Shared-file changes require a main-session ownership handoff; do not concurrently edit another child’s boundary.

## Data Flow and Compatibility

- Consume the common closed DTOs/ports; preserve unknown/refused/incomplete states rather than infer success.
- Keep durable committed observation separate from connection/progress and fresh mutation authority.
- Keep credentials out of public graphs/events/artifacts/logs and browser state.
- Preserve strict v1 expected-byte publication and unknown fences while adding the approved new behavior.
- Reuse compatible reference families with pinned source/license lineage, replacing only incompatible control/data seams.

## Dependency and Rollback

W1 owner/admission, W2 real producer and W3 durable store integrated; typed-fixture development alone cannot satisfy execution acceptance.

Follow parent design sections 12–13 for exact distribution/spec changes and rollback.
Do not retain an obsolete competing executor to keep old tests green; map intentional replacements to fresh tests.
On uncertain auth/process/storage settlement, preserve bytes/fences and stop unsafe admission.
Rollback only identified task-authored source after work is stopped; never reset pre-existing edits.

## Main Integration Handoff

The mutation-closed W1 host now composes real owner/history/model/read/live components and per-preparation/original-write lifetimes; see W1 `research/w1-host-composition-review.md`.
Main independently reran200 host/lifetime/model cases plus check/lint/Agent checks on unchanged sources.
The parent [runtime/orchestration handoff](../10-16-cadence-webui-terminal/research/runtime-orchestration-handoff.md) explicitly assigns one W4 editor the minimal accepted-plan, saved-graph, per-assignment gate/fact, check-output/environment and exact own-generation seams identified in `research/implementation-readiness.md`.
Record concrete selected API details before editing; no routine reapproval is needed for these already assigned corrections.
Use the existing real host, ActionAdmission, prepared worker, writer/reducer and process helpers; no new accepting defaults or duplicate executor.
Keep host action admission closed until actual action/scheduler/check/review paths are composed and checked, and keep W1 proxy/recovery/client/distribution gates distinct.
