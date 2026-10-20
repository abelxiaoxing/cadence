# W1 — Shared service and authentication

## Goal

Own this work package within the [complete parent redesign](../10-16-cadence-webui-terminal/prd.md).
This is internal engineering organization, not a phased product release.

## Requirements and Prerequisites

Parent requirements: **R1, R4–R7, R9–R11, R14**.
Parent acceptance: **AC5,7–9,14–16,20**.
All parent preservation, explicit-authority, reuse and truthful-evidence constraints apply.

Prerequisites: Final parent artifact approval; freeze shared interfaces before W2/W3/W4.
Dependencies are explicit here; tree position is not a scheduler.
Final parent implementation approval is recorded and this child is now in_progress.
Read `research/execution-checkpoint.md` for current implementation evidence and provisioning/freeze gates; this child and the parent are not complete.

## Acceptance Criteria

- **W1-AC1:** Explicit service lifecycle preserves missing/unsafe state and never creates a task on discovery or view.
- **W1-AC2:** Token/cookie, exact Host/Origin/CSRF/WS admission, local capability and rotation refuse unauthorized access without leaking secrets.
- **W1-AC3:** Existing Pi configuration and SDK refresh/writeback preserve unrelated credentials; cancellation prevents late worker launch.
- **W1-AC4:** Owner/v1 lock and stop/auth uncertainty are retained; no embedded executor or global-SDK fallback.
- **W1-AC5:** Portable codecs and persistence/worker/client ports are concrete and frozen for dependent children.

## Out of Scope

- Partial-product release or deferring core scope.
- Unrelated dirty files, archive/consumer cleanup, credential export or automatic Git/install/publication.
- Competing execution owners or duplicate protocol/projection rules.
- Runtime success claims based only on source inspection or mocks.

## Authority

Read the [parent PRD](../10-16-cadence-webui-terminal/prd.md), [design](../10-16-cadence-webui-terminal/design.md) and [execution plan](../10-16-cadence-webui-terminal/implement.md).
Parent selected contracts supersede incompatible research recommendations.
