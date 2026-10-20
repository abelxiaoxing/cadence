# W4 — Implementation Plan

## Gate

Read manifests → child artifacts → all parent artifacts → relevant research/specs.
Prerequisites: W1 owner/admission, W2 real producer and W3 durable store integrated; typed-fixture development alone cannot satisfy execution acceptance.
Do not implement until final parent-plan approval and `task.py start` targets this child.
Dispatch prompts start with the actual `task.py current` path.

## Ordered Work

- [ ] Implement validated frozen graphs, role mapping, dependency context and deterministic fair dispatch.
- [ ] Wire pre-auth reservations, checkout gates, late-abort checks and durable effect ordering.
- [ ] Implement create/save-plan/readonly-generate/Start/Cancel through common admission.
- [ ] Port real checks/change/human-review semantics and named versus native-manual authority.
- [ ] Integrate committed snapshots/heartbeats and actual worker/store/check failure scenarios.

## Independent Planning Review Corrections

- [ ] Enforce exact bounded dependency handoffs including JSON/auth overhead and committed input identity.
- [ ] Drain blocked/expired episodes and require revised graph plus new Start; Done/reconnect cannot reauthorize them.

## Verification Targets

These are affected/proposed targets to create or update, not passing evidence:

- `test/service-scheduler.test.ts`
- `test/service-owner.test.ts`
- `test/lightweight-store-controller.test.ts`
- `test/service-history.test.ts`

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

## Initial Implementation Gate

Parent planning and continuous implementation approval are recorded; W1 mutation-closed host and W1/W2/W3 native/store foundations now meet the implementation prerequisite.
Main's source-bound results are W3 `research/main-integration-checks/` (1307/32files) and W1 `research/main-host-checks/` (200/3files), with check/lint/Agent checks.
These overlapping results are not product acceptance or explanations of historical failures.
Begin by persisting the minimal shared-seam choices, then implement graph/actions/scheduler against actual components and qualify native concurrency/checks before opening production task admission.
