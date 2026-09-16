## Why

The previous roadmap required native prototype qualification before any preparation could be delivered, while no prototype/build/test entrypoint existed. Implement correctly refused the unsealed delivery. The user approved splitting preparation from native qualification and integration. This revision fixes the delivery boundary, not the runtime admission checks.

## What Changes

- Deliver standalone, non-production Windows Job launcher source and explicit build tooling under scripts/host-prototype/.
- Deliver a macOS process-group prototype, bounded lifecycle fixtures and a native qualification entrypoint, with Linux-runnable protocol/build-planning/harness tests.
- Add ordinary native CI jobs and documentation. Native jobs build/test the prototypes and retain identity-bound outputs; CI configuration itself is not a qualification result.
- Keep preparation acceptance distinct from native lifecycle evidence and eventual host integration. No host-trusted mode is enabled in this delivery.

## Capabilities

### New Capabilities

- `host-trusted-execution`: staged preparation tooling and truthful native qualification boundary; the capability name denotes the initiative, not production support.

### Modified Capabilities

None. Existing execution, recovery, storage, receipts and budgets remain unchanged.

## Scope

This change now seals stage one only. Three tasks deliver build/source preparation, harness/prototype preparation, and CI/documentation preparation. Existing accepted full-feature objectives remain a deferred target in design.md, not unchecked hidden implementation obligations in this delivery.

No native evidence is required to prove that the preparation tooling exists and obeys its local test contract. Actual native results are mandatory before dependent integration or a native support claim. The parent may choose recommended bounded implementation details, record material choices and continue verification without another selection round.

## Non-goals

No production host backend, environment adaptation, package-state migration, status redesign, user-run recovery, binary candidate submission, generic remote runner/evidence import, sandbox, VM, new dependency, runtime download/compilation, release or commit.

## Impact

New scripts/host-prototype sources and three targeted test files, existing .github/workflows/ci.yml, and docs/host-trusted-preparation.md. Prototype scripts/docs/tests are outside package.json shipped files; no package manifest/member change or generated worker regeneration is needed. Existing tarball tests verify this boundary. Root AGENTS remains unchanged because no production module ownership, workflow API or supported command changes; a later integration delivery must update the managed index.

## Evidence status

Read-only Design rechecked package.json, root AGENTS, CI, execution-profile, distribution and isolation tests. Diagnose previously repaired spec heading levels and reported Linux 941 passed/25 skipped; those are historical results, not tests executed in this Design or native qualification. Prior user 904/25 results remain historical. No user run or database is operated.
