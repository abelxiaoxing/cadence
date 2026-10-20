# W4 — Multi-agent orchestration, checks and review

## Goal

Own this work package within the [complete parent redesign](../10-16-cadence-webui-terminal/prd.md).
This is internal engineering organization, not a phased product release.

## Requirements and Prerequisites

Parent requirements: **R1–R2, R4–R8, R11–R13**.
Parent acceptance: **AC2,6–12,16–19**.
All parent preservation, explicit-authority, reuse and truthful-evidence constraints apply.

Prerequisites: W1 owner/admission, W2 real producer and W3 durable store integrated; typed-fixture development alone cannot satisfy execution acceptance.
Dependencies are explicit here; tree position is not a scheduler.
Status remains planning until final parent approval and this child is started.

## Acceptance Criteria

- **W4-AC1:** Real independent readonly children overlap while all checkout edits/checks serialize across tasks and aliases.
- **W4-AC2:** Fresh grants/exact roles/models/context and receipts bind admission; generated plans never dispatch themselves.
- **W4-AC3:** Stale dependencies and failure/cancel/unknown states preserve individual outcomes and stop unsafe admission without retries.
- **W4-AC4:** Actual checks preserve exact approved command/cwd/timeout/environment, native exit and independent freshness/not-run status.
- **W4-AC5:** Human review acknowledges current issues without rewriting child/check results; both clients share one projection.

## Out of Scope

- Partial-product release or deferring core scope.
- Unrelated dirty files, archive/consumer cleanup, credential export or automatic Git/install/publication.
- Competing execution owners or duplicate protocol/projection rules.
- Runtime success claims based only on source inspection or mocks.

## Authority

Read the [parent PRD](../10-16-cadence-webui-terminal/prd.md), [design](../10-16-cadence-webui-terminal/design.md) and [execution plan](../10-16-cadence-webui-terminal/implement.md).
Parent selected contracts supersede incompatible research recommendations.
