# W1 — Implementation Plan

## Gate

Read manifests → child artifacts → all parent artifacts → relevant research/specs.
Prerequisites: Final parent artifact approval; freeze shared interfaces before W2/W3/W4.
Do not implement until final parent-plan approval and `task.py start` targets this child.
Dispatch prompts start with the actual `task.py current` path.

## Ordered Work

- [x] Implement portable closed DTOs/errors/limits and contract tests; revised candidates passed114 focused tests, with reciprocal consumer acceptance recorded in `research/joint-interface-freeze.json`.
- [x] Add private registration/config, atomic all-root registry, lifetime owner/v1 locks and original-promise lifecycle primitives; main232-test scoped verification is recorded.
- [ ] Compose the actual HTTP-managed service and compiled CLI; primitives alone do not meet complete lifecycle acceptance.
- [ ] Adapt token/cookie/upgrade helpers and implement secure remote/local capability policy.
- [ ] Add public Pi model-context resolver with original auth-promise accounting and fabricated-provider tests.
- [ ] Add stop/quarantine/manual-recovery contracts; execution routes stay explicitly unavailable until W4 supplies real ports.

## Independent Planning Review Corrections

- [x] Atomically reserve registry roots with all Git/non-Git ancestor/descendant overlap rejection; native temporary-directory tests cover nested repositories/submodule-shaped roots in both orders, simultaneous starts and uncertain registrations.
- [ ] Commit auth-preparation intent/settlement and qualify refresh crash windows before any worker launch.
- [x] Own the joint W2/W3 producer/sink/coverage freeze; source hashes and accepted single-editor handoff policy are in `research/joint-interface-freeze.json`.
      The W2 executable-JS relocation is not assigned yet.

## Verification Targets

These are affected/proposed targets to create or update, not passing evidence:

- `test/service-contract.test.ts`
- `test/service-auth.test.ts`
- `test/service-owner.test.ts`
- `test/service-package.test.ts`

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
