# W3 — Implementation Plan

## Gate

Read manifests → child artifacts → all parent artifacts → relevant research/specs.
Prerequisites: W1 persistence/admission interfaces frozen; W2 frame/coverage contract agreed.
Real W2 ingestion is required before integration acceptance.
Do not implement until final parent-plan approval and `task.py start` targets this child.
Dispatch prompts start with the actual `task.py current` path.

## Ordered Work

- [ ] Implement strict history/graph/receipt/artifact codecs and private owned paths.
- [ ] Implement serialized artifact/journal commit ordering, command-intent lookup, indexes/checkpoints and crash refusal.
- [ ] Track expected-byte v1 publication separately and expose conflicts.
- [ ] Implement bounded page/detail readers, stable literal-search continuation and streaming exports.
- [ ] Exercise large/no-viewer/restart/read-only/corruption/quota controls and integrate real W2 capture.

## Independent Planning Review Corrections

- [ ] Record auth uncertainty and exact dependency input references/projections, separate from launch/closure facts.
- [ ] Map long retained results into labeled bounded v1 summaries and conservative phases without truncating retained history.

## Verification Targets

These are affected/proposed targets to create or update, not passing evidence:

- `test/service-history.test.ts`
- `test/lightweight-store-controller.test.ts`
- `test/service-contract.test.ts`

### Verification Checklist

- [ ] Run targeted actual-boundary tests; label injected versus real process/SDK/browser evidence.
- [ ] Run `bun run check` and `bun run lint`, plus relevant implemented web/build/Agent checks.
- [ ] Verify error/refusal paths and preservation of unrelated bytes.
- [ ] Main session dispatches independent check; fix verified findings and rerun checks.
- [ ] Record changed paths, commands/exits/identities, evidence limitations and remaining cross-child integration in a child handoff.
- [ ] Do not mark parent acceptance passed from child-only fixtures; W7 owns final integrated gates.

## Stop Points

Material API/storage/capture/auth/dependency scope changes return to parent review.
Missing capabilities/artifacts are explicit blockers, not silent downloads/fallback/deletion or feature cuts.
Child completion is not product completion; commits require separate user consent.
