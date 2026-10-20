# W2 — Rich worker capture protocol

## Goal

Own this work package within the [complete parent redesign](../10-16-cadence-webui-terminal/prd.md).
This is internal engineering organization, not a phased product release.

## Requirements and Prerequisites

Parent requirements: **R2, R4–R6, R8, R13**.
Parent acceptance: **AC2,11–12,18,21**.
All parent preservation, explicit-authority, reuse and truthful-evidence constraints apply.

Prerequisites: W1 identity/error/limit contract frozen; agree W3 artifact sink and coverage before producer changes.
Dependencies are explicit here; tree position is not a scheduler.
Final parent plan and continuous implementation are approved; reciprocal W1/W2/W3 interfaces are accepted.
Main starts this child with the single-editor handoff in `research/shared-editor-handoff.json`; no W1/product completion is implied.

## Acceptance Criteria

- **W2-AC1:** Genuine SDK messages/tool IDs/start/update/end/args/results produce strict correlated v2 events rather than prose-derived status.
- **W2-AC2:** Field-aware sanitization prevents known-secret/auth/opaque-data leakage across chunk, UTF-8 and escaped-value boundaries.
- **W2-AC3:** Public bash capture avoids stock raw spill while retaining actual command/cancel semantics.
- **W2-AC4:** Input/framing/flood/cleanup/nonzero/unknown failures cannot pass because a final frame was emitted.
- **W2-AC5:** Source limits, recording loss and native outcomes remain separate with mandatory capture failure surfaced.

## Out of Scope

- Partial-product release or deferring core scope.
- Unrelated dirty files, archive/consumer cleanup, credential export or automatic Git/install/publication.
- Competing execution owners or duplicate protocol/projection rules.
- Runtime success claims based only on source inspection or mocks.

## Authority

Read the [parent PRD](../10-16-cadence-webui-terminal/prd.md), [design](../10-16-cadence-webui-terminal/design.md) and [execution plan](../10-16-cadence-webui-terminal/implement.md).
Parent selected contracts supersede incompatible research recommendations.
