# W5 — Implementation Plan

## Gate

Read manifests → child artifacts → all parent artifacts → relevant research/specs.
Prerequisites: W1 typed client available; W4 full action API integrated for real terminal qualification.
UI fixtures alone are insufficient.
Do not implement until final parent-plan approval and `task.py start` targets this child.
Dispatch prompts start with the actual `task.py current` path.

## Ordered Work

- [ ] Replace shell execution/auth ownership with typed client while retaining native consent UI.
- [ ] Add complete plan/assignment/action and paged detail/check/change/review menus.
- [ ] Separate detach and Cancel; invalidate only pending local confirmation on departure.
- [ ] Add durable history/search/hit/export and service status/diagnostic flows.
- [ ] Remove embedded production execution and port fake-host plus all real native modes.

## Verification Targets

These are affected/proposed targets to create or update, not passing evidence:

- `test/lightweight-shell.test.ts`
- `test/terminal-integration.test.mjs`
- `test/service-contract.test.ts`
- `test/distribution.test.mjs`

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
