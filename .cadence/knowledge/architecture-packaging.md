# Architecture and packaging

## Module ownership and SDK isolation

### Gateway and service management stay strictly SDK-free

Kind: boundary

Why: `build-service.mjs` bundles the gateway separately and refuses any Pi SDK import in its transitive closure.
Model preview runs in the isolated `src/model-preview.mjs` child over a fixed private pipe returning credential-free `ModelPreview` only, without creating owners, sessions or project state.

Anchors: `scripts/build-service.mjs#gateway`, `src/service/gateway.ts`, `src/service/model-preview-process.ts`, `src/service/maintenance.ts#insideUnit`

Source: internalized from engineering/architecture.md, 2026-11-22

### Ordinary conversations never acquire the workflow checkout gate

Kind: contract

Why: `Workbench` passes `CheckoutGate` to `Workflows`, not to `Conversations`.
Ordinary turns in separate Pi sessions behave like separate Pi terminals (they can overwrite one another), while a workflow holds the checkout only while it writes its working files.

Anchors: `src/service/workbench.ts`, `src/service/checkout-gate.ts#CheckoutGate`, `src/service/workflows.ts`

Source: internalized from engineering/architecture.md, 2026-11-22

### Legacy task execution is retired while history persistence remains readonly

Kind: boundary

Why: `TaskActions`, `TaskScheduler`, `ActionAdmission` and `TaskController` are deleted and checked absent in `service-host.mjs`. `host.ts` still wires `HistoryWriter` for bootstrap, auth fallback and Stop; retained task/check/Review evidence remains readonly without reconstructing execution.

Anchors: `test/service-package.test.ts`, `src/service/host.ts`, `src/history/writer.ts`

Source: internalized from engineering/architecture.md, 2026-11-22

## Packaging, dependencies and release automation

### Extension peers stay external while standalone owners load optional SDK pins

Kind: contract

Why: Pi loads `src/index.ts` and omits peer dependencies, supplying only its own packages and Typebox; any other extension runtime import must be an exact production dependency (`undici`, `ws`).
Standalone owners/workers import `pi-coding-agent` and `pi-ai` from optional dependencies, and `pack-check` verifies the real tarball import closure.

Anchors: `package.json`, `scripts/pack-check.mjs`, `scripts/package-audit.mjs`, `src/index.ts`

Source: internalized from engineering/architecture.md, 2026-11-22

### Publish npm releases only through the GitHub Actions OIDC workflow

Kind: contract

Why: Local `npm publish` or token fallbacks bypass clean-checkout artifact auditing and Trusted Publishing. `.github/workflows/publish.yml` and `scripts/npm-release.mjs` bind exact source, tag, archive and registry confirmation with one monotonic deadline; delayed visibility retries readonly checks only, never replays publication.

Anchors: `.github/workflows/publish.yml`, `scripts/npm-release.mjs`, `docs/reuse-and-distribution.md`

Source: internalized from engineering/architecture.md, 2026-11-22

### Four pinned agent profiles carry instructions, never execution authority

Kind: boundary

Why: `agents/{design-explorer,route-planner,implementation-worker,diagnosis-worker}.md` are private extension resources pinned by SHA-256 in `provenance/adapted-modules.yaml` and checked by `check-agents.mjs` and `package-audit.mjs`; the package ships no install hooks.

Anchors: `src/agent-registry.ts`, `provenance/adapted-modules.yaml`, `scripts/check-agents.mjs`, `agents/route-planner.md`

Source: internalized from engineering/architecture.md, 2026-11-22
