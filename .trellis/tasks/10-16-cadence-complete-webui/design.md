# W6 — Boundary Design

## Mandatory Shared Design

Read the entire [parent design](../10-16-cadence-webui-terminal/design.md), especially sections **4,6,10–13**, and its PRD/plan before implementation/checking.
The referenced contracts are part of this child, not optional background.
Read [execution/history](../10-16-cadence-webui-terminal/design-runtime-history.md) and [client/distribution](../10-16-cadence-webui-terminal/design-clients-distribution.md) appendices completely as mandatory parent contracts.
No alternative versions, limits, auth/store policies or execution owners are introduced here.

## Owned Paths and Interfaces

- web/src workspace/transcript/tool/rich/review/history/timeline/client families
- Web configs/build script/generated web/dist; scoped browser dependency edges
- provenance/webui-reuse.json and adapted notices in coordination with W7
- test/web and test/browser DOM/integration fixtures

New paths are planned owners, not implemented artifacts.
Shared-file changes require a main-session ownership handoff; do not concurrently edit another child’s boundary.

## Data Flow and Compatibility

- Consume the common closed DTOs/ports; preserve unknown/refused/incomplete states rather than infer success.
- Keep durable committed observation separate from connection/progress and fresh mutation authority.
- Keep credentials out of public graphs/events/artifacts/logs and browser state.
- Preserve strict v1 expected-byte publication and unknown fences while adding the approved new behavior.
- Reuse compatible reference families with pinned source/license lineage, replacing only incompatible control/data seams.

## Dependency and Rollback

W1 DTO/auth/action contract frozen; W2/W3 detail/cursor formats agreed; W4 real owner required for integrated acceptance.
No deferred core history.

Follow parent design sections 12–13 for exact distribution/spec changes and rollback.
Do not retain an obsolete competing executor to keep old tests green; map intentional replacements to fresh tests.
On uncertain auth/process/storage settlement, preserve bytes/fences and stop unsafe admission.
Rollback only identified task-authored source after work is stopped; never reset pre-existing edits.
