# W3 — Durable history, search and export

## Goal

Own this work package within the [complete parent redesign](../10-16-cadence-webui-terminal/prd.md).
This is internal engineering organization, not a phased product release.

## Requirements and Prerequisites

Parent requirements: **R4–R7, R12–R14**.
Parent acceptance: **AC4–5,7,9,18–19,21**.
All parent preservation, explicit-authority, reuse and truthful-evidence constraints apply.

Prerequisites: W1 persistence/admission interfaces frozen; W2 frame/coverage contract agreed.
Real W2 ingestion is required before integration acceptance.
Dependencies are explicit here; tree position is not a scheduler.
Final parent plan and continuous implementation are approved.
W1 persistence/read contracts and W2 frame/coverage interfaces are jointly accepted; W2 producer is implemented and independently checked.
Main starts W3 for actual durable ingestion and history integration; W1/W2 remain open for subsequent composition.

## Acceptance Criteria

- **W3-AC1:** Accepted commands and launch/settlement ordering cannot authorize duplicate launch or restart replay after controlled crashes.
- **W3-AC2:** Only sanitized committed content is published; corrupt/torn/linked bytes are preserved without on-read repair.
- **W3-AC3:** Long messages/tool details beyond previews/rings remain addressable through stable pages and exact search hits.
- **W3-AC4:** NDJSON/Markdown export covers selected retained history with completion/coverage metadata, not loaded DOM only.
- **W3-AC5:** Quotas/ENOSPC preserve readable history and unknown fences without cleanup or silent successful truncation.

## Out of Scope

- Partial-product release or deferring core scope.
- Unrelated dirty files, archive/consumer cleanup, credential export or automatic Git/install/publication.
- Competing execution owners or duplicate protocol/projection rules.
- Runtime success claims based only on source inspection or mocks.

## Authority

Read the [parent PRD](../10-16-cadence-webui-terminal/prd.md), [design](../10-16-cadence-webui-terminal/design.md) and [execution plan](../10-16-cadence-webui-terminal/implement.md).
Parent selected contracts supersede incompatible research recommendations.
