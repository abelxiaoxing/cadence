## Stage-one preparation tasks

This delivery prepares prototypes and native CI; it does not enable host-trusted or certify native execution. Deferred full-feature goals are retained in design.md. Native missing-capability results block later integration, not these Linux-executable preparation contracts.

- [x] `prep-build` Add closed request/build planning and standalone Windows launcher source with explicit native build manifest. Owns `specs/host-trusted-execution/spec.md#Standalone prototype build preparation/Build contract is testable without native execution` and `specs/host-trusted-execution/spec.md#Standalone prototype build preparation/Explicit build binds native outputs`.
- [x] `prep-harness` Add macOS group prototype, bounded fixtures and qualification CLI; depends on prep-build protocol and helper manifest contract. Owns `specs/host-trusted-execution/spec.md#Qualification harness preparation/Harness rejects misleading observations` and `specs/host-trusted-execution/spec.md#Qualification harness preparation/Native entrypoint fails closed until actually qualified`.
- [x] `prep-ci` Add ordinary native prototype CI lanes and honest handoff docs; depends on prep-build and prep-harness tools. Owns `specs/host-trusted-execution/spec.md#Staged CI and support boundary/Native CI is explicit and preserves existing coverage` and `specs/host-trusted-execution/spec.md#Staged CI and support boundary/Preparation delivery does not enable host support`.

## Verification boundaries

Each task creates its own Red Vitest test with a guarded missing-product assertion, then implements only its Green outputs. Red markers are [HOST-PREP:build-contract], [HOST-PREP:harness-contract] and [HOST-PREP:ci-contract]. Do not accept missing compiler/platform/import errors as Red. Green tests exercise actual JS contracts using injected process adapters where needed and explicitly label source checks/mocks as preparation evidence.

Retain test/isolation-backend.test.ts, test/distribution.test.mjs and test/traceability-check.test.mjs as unchanged regression inputs. Full baseline/change/post-apply verification uses the actual existing test script (vitest run). Native build/qualification runs are separate ordinary CI/manual entrypoints, not required local verifier commands. No new dependency or product src write is permitted. No binaries are model-generated; native build artifacts stay in explicit output directories. No package membership or generated worker bytes change.

AGENTS impact is none: this unshipped experiment does not change production ownership or runtime commands. Do not edit root AGENTS. Later host integration must update its managed index. Two artifact-correction attempts and one repair retain existing bounded policy.

<!-- ABEL:VERIFICATION-BINDINGS:START -->
## Compiled verification bindings

- Task `prep-build` (behavior)
  - Red: `verify-bbd463334fd845dfed83bb900de74a79fa51f2ce4ef5f19a370a03b6b44b286f`
  - Green: `verify-2c6bbab943d4699427e6475fd8507678dbbc46ce5eb01351c68bc3a19f850d70`
- Task `prep-ci` (behavior)
  - Red: `verify-0c209cb72e750ed85d745df75cce63e56c7a1cb9d24ce67ade727028a0ea5c9d`
  - Green: `verify-33922320c62a6b8430309bb36d5193932fd82d7993df14aef9f363a87af1f646`
- Task `prep-harness` (behavior)
  - Red: `verify-d6dad394c213cb1de3dba4750cdb6e60ec8c57d235f97e34b46c707d699dcf55`
  - Green: `verify-d6007b3248af69be0240618d7f4abb364dcadae73c3546f1bea7da60f5f44df8`
<!-- ABEL:VERIFICATION-BINDINGS:END -->

## Local implementation evidence

All three preparation tasks completed their named Red assertion before Green implementation.
Local `bun run verify` passed: 946 tests passed, 25 skipped, and 104 tarball members matched the approved set.
`bun run traceability:check`, `bun run check:agents` and `openspec validate add-host-trusted-execution --strict` passed.
The new preparation tests account for five tests; source assertions and controlled observations are not native lifecycle evidence.
Windows compilation and Windows/macOS qualification have not run in this Linux workspace; all six native CI lanes remain pending.
No production mode, package membership, generated module, user-run storage or AGENTS index was changed.
