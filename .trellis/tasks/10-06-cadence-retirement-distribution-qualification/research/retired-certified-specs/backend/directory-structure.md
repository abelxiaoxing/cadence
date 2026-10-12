# Directory Structure

## Current task-only source ownership

[Task Distribution and Retirement](../backend/task-distribution-guidelines.md) supersedes the historical stage/OpenSpec/evaluator ownership below.
The sole entry is `src/index.ts` → fixed completion shell; operators are bounded noncreating observations.
No historical Gate, ready receipt, automatic reopen, old cleanup or prompt marker is current authority.
All recorded earlier failures and qualification limits remain historical evidence, not current passes.

Candidate-only convergence: the appended scenario owns the reviewed isolated composition.
Earlier checkpoints remain historical, not LIVE integration or acceptance.

> How the Cadence backend code is organized in this project.

---

## Overview

The repository is a single Bun/TypeScript package (`@abelxiaoxing/cadence`), not a monorepo.
It is a Pi extension: the entrypoint is the private extension `src/index.ts`, declared in `package.json` under `pi.extensions`, with `bun.lock` as the lockfile.
The package has no web frontend; its two layers are the package code documented here and the Presentation & Content layer documented in `.trellis/spec/frontend/`.
Every module below is loaded inside the Pi process or by an explicit operator command; nothing listens on a port.

---

## Directory Layout

```text
cadence/
├── src/                # Extension + workflow implementation (TypeScript)
├── prompts/            # Four user entry prompts (abel-init/design/implement/diagnose)
├── skills/             # Shipped skills: context7-auto-research, grok-search, git-commit, _shared
├── agents/             # Three package-owned professional Agents (pinned, never discovered)
├── config/             # Example configuration (plan-draft examples, routes, .env)
├── openspec/           # OpenSpec core: config.yaml, specs/, active changes
├── provenance/         # adapted-modules.yaml Agent pins, package-members.json
├── scripts/            # Maintenance: check, pack, traceability, eval, CI helpers
├── test/               # Vitest suite: unit, integration, property, distribution
├── docs/               # Necessary platform notes only (windows-host-trusted.md)
├── licenses/           # Third-party license texts
├── .github/workflows/  # ci.yml platform matrix
└── AGENTS.md           # Project index (slim overview + managed Trellis block)
```

The packaged member set is exactly the `files` array in `package.json` (`prompts`, `skills`, `config`, `src`, `agents`, `README.md`, `LICENSE`, `THIRD_PARTY_NOTICES.md`, `licenses`), and it is verified against `provenance/package-members.json` by `scripts/pack-check.mjs` and `test/distribution.test.mjs`.
`openspec/config.yaml` selects the repository's spec-driven schema, while `prompts/abel-diagnose.md` is the explicit Diagnose entrypoint alongside the other three prompt files.

---

## Module Ownership by Domain

| Domain          | Modules (`src/`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Responsibility                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan & draft    | `plan-draft.ts`, `single-task-draft.ts`, `implement-plan.ts`, `plan-draft-summary.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Finite author expansion and inference of PlanDraft input; mechanical single-task expansion; the complete execution types; bounded final permissions, derivation sources, parallel eligibility and amendment policy; task `baselineVerification` binding immutable original-revision checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Design          | `design-journal.ts`, `design-control.ts`, `design-diagnostics.ts`, `change-contract-schema.ts`, `change-contract.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Owner-private Design facts and finalization leases; lease-guarded artifact mutation and bounded current-step guidance; bounded field/path/enum diagnostics with code-owned hints; Gate A tool/runtime structure and field-only diagnostics; normalized acceptance, constraints, scope policy                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Implement       | `workflow-engine.ts`, `workflow-state-machine.ts`, `implement-graph.ts`, `implement-continuation.ts`, `phase-execution.ts`, `workflow-policy.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Stable facade; sole Implement transition authority (delivery admission, approval classification, continuations, amendments, budgets, apply, recovery); graph readiness proof; session-local continuation and no-progress decisions; ordinary/repair candidate phases; typed service boundaries and policy decisions                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Delivery        | `delivery-compiler.ts`, `apply-transaction.ts`, `candidate-patch.ts`, `candidate-artifact.ts`, `submit-tool.ts`, `evidence-draft.ts`, `contracts.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Strict sealed-plan validation and the managed tasks.md verifier-binding region; currentness-checked journaled main-workspace application; symlink-safe structured patch operations and canonical unified diffs; byte/hash/path/segment validation where the executor owns recovery classification and commit timing; typed submit with owned chunking/hashes/sealing; completed evidence drafts; strict packet/result envelopes and closed failure codes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Verification    | `verification-capability.ts`, `verification-environment.ts`, `verification-environment-io.ts`, `verification-scan.ts`, `verification-identity.ts`, `change-verification.ts`, `execution-profile.ts`, `windows-job-backend.ts`, `windows-job.c`, `build-windows-job.mjs`, `isolation-backend.ts`, `workspace-io.ts`, `workspace-io-entry.mjs`, `workspace-io-worker.mjs`, `candidate-workspace.ts`, `package-verification.ts`                                                                                                                                                                                                                                                                                        | Shell-free Vitest/package-script/static/ordered-step adapter validation; disposable HOME, dependency views, tool caches; cancellable dependency I/O in the shipped worker; coalesced not-yet-started identity scans that never share older observations with later currentness checks; installed-bytes hashing bound to retained evidence; baseline/affected/cumulative/post-apply verification; operator execution-profile selection; native Windows Job protocol, source and build; Bubblewrap isolation; bounded cancellable Git capture/materialization; shared isolated Git patch operations; adapter execution with independent reports                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Storage         | `storage-schema.ts`, `sqlite-schema.ts`, `run-store.ts`, `state-root.ts`, `canonical.ts`, `package-state.ts`, `directory-sync.ts`, `control-contracts.ts`, `run-state.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Checked schema contracts and atomic additive migrations; owner-private run/design/engine stores; repository-external state-root safety; locale-independent identity ordering; version-gated open, backup-before-init, reset semantics; Windows directory-handle fsync capability; closed control command surface; stable run/delivery identity                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Operators       | `operator-tools.ts`, `operator-cli-entry.mjs`, `operator-cli.mjs`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Read-only `doctor`/`runs` inspection: package-manager selection with provenance, OpenSpec resolution, storage reads                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Activation      | `index.ts`, `pi-adapter.ts`, `model-source.ts`, `package-workflow.ts`, `package-candidate.ts`, `package-delivery.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Verified prompt activation/exit, single tool registration, interaction and presentation; cwd/model capability projection; the code-owned model port; service composition; restricted candidate execution; proof-bound delivery loading                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| I/O & lifecycle | `workspace-io.ts`, `workspace-io-entry.mjs`, `workspace-io-worker.mjs`, `remove-path.ts`, `startup-card.ts`, `route-policy.ts`, `worker-broker.ts`, `parent-provider.ts`, `packet-runtime.ts`, `child-session.ts`, `child-model.ts`, `scoped-tools.ts`, `scoped-grep-worker.mjs`, `transport-budget.ts`, `child-budget.ts`, `activity-contracts.ts`, `workflow-status.ts`, `workflow-scheduling.ts`, `workflow-recovery-policy.ts`, `delivery-revision.ts`, `durable-workflow.ts`, `durable-contracts.ts`, `artifact-store.ts`, `workspace-store.ts`, `task-ledger.ts`, `file-snapshot.ts`, `safe-path.ts`, `execution-retention.ts`, `activation.ts`, `agent-registry.ts`, `openspec-cli.ts`, `install-config.mjs` | Bounded cancellable Git capture/materialization off the parent event loop; Unicode-safe removal that never traverses directory links; nonblocking secret-free startup card; whole-file route policy; bounded health/failover/rebind; effective-provider snapshots; bounded Design/Diagnose packet admission with cancellation and single-launch route selection; explicit private child tool loop with stable submission identity and safe one-result classification; scoped read/grep/find/ls with a terminable regular-expression grep worker; request progress budgets; data-only activity vocabulary; fact-derived status projection; queue simulation; recovery policy; delivery revision comparison; durable resource lifetime/replay and composition over the narrow typed ports, phase resources excluding main-workspace transactions; sealed artifact bytes; durable phase/repair facts; per-path currentness; no-symlink path observation; unsettled-execution retention; activation state machine; immutable Agent registry; shell-free OpenSpec CLI resolution; postinstall config template |

Two names appear under two domains on purpose: the `workspace-io*` modules serve both general workspace capture and verification dependency/identity I/O.
The following paths are intentionally explicit because they are common ownership boundaries:

- Plan and graph projection: `src/plan-draft-summary.ts` exposes bounded permissions and parallel eligibility, and `src/implement-graph.ts` proves task/output readiness without performing transitions.
- Verification execution: `src/verification-environment.ts` prepares disposable execution resources, `src/package-verification.ts` runs adapters with independent reports, `src/verification-scan.ts` coalesces only identity reads that have not started, and `src/isolation-backend.ts` provides the Bubblewrap boundary.
- Workspace and artifact safety: `src/workspace-io.ts` brokers cancellable capture/materialization, `src/remove-path.ts` removes paths without traversing directory links, `src/file-snapshot.ts` records currentness bytes, and `src/candidate-workspace.ts` shares isolated Git patch operations.
- Candidate and delivery boundaries: `src/candidate-artifact.ts` validates retained bytes, `src/candidate-patch.ts` validates structured operations, `src/change-verification.ts` records baseline and cumulative evidence, and `src/delivery-revision.ts` compares proof-bound revisions.
- Workflow composition: `src/workflow-engine.ts` is the stable facade, while `src/workflow-policy.ts` contains typed policy decisions; `src/phase-execution.ts` runs ordinary and repair phases, `src/activity-contracts.ts` defines data-only lifecycle values, and `src/package-workflow.ts`, `src/package-candidate.ts`, and `src/package-delivery.ts` compose restricted candidate execution and proof-bound delivery services.
- Scoped child tools and native isolation: `src/scoped-tools.ts` confines child reads and searches, `src/scoped-grep-worker.mjs` supplies terminable regular-expression matching, `src/windows-job-backend.ts` implements the native Job protocol, and `src/windows-job.c` is its native helper source.

---

## Disconnected task-shell routing

`src/task-shell.ts` composes the isolated `/cadence` command with existing session/controller/Source/planning owners; `src/task-session.ts` owns Create/Return/Open authority and native interactions.
See [Session Adapter](../frontend/task-session-guidelines.md).
The D candidate is implemented but Gate 2/D remain unaccepted; `src/index.ts` stays unchanged.
The actual manifest has **124 members**, adding only `package/src/task-shell.ts`; this is not separate real-pack/all-body qualification.

## Generated Modules

Two `src/` files are build outputs, not sources:

- `src/workspace-io-worker.mjs` is built from source `src/workspace-io-entry.mjs` by `scripts/build-workspace-io.mjs` (Bun bundle, `target: "node"`, packages external, no sourcemap/minify).
- `src/operator-cli.mjs` is built from source `src/operator-cli-entry.mjs` by the same script.

Both start with the header comment `// Generated by scripts/build-workspace-io.mjs; edit <entry> and its source modules.`, and `bun run check` runs the builder with `--check` to fail on a stale bundle.
Both generated files are excluded from Biome formatting/linting/assist in `biome.json` overrides, because the bundle output is not formatter-stable.
Example: to change the workspace capture behavior, edit `src/workspace-io-entry.mjs` (and its imported `src/artifact-store.ts`, `src/workspace-store.ts`, `src/verification-environment-io.ts`, `src/verification-identity.ts` modules), then run `bun run build:workspace-io`.

---

## Shared Skill Assets

`skills/_shared/` holds the plain-JavaScript assets consumed by more than one shipped component:

- `skills/_shared/load-config.mjs` (typed by `skills/_shared/load-config.d.mts`) parses the research `.env` file with whole-file priority (project `.pi/cadence/.env` before user `~/.pi/agent/cadence/.env`), a 64 KiB regular-file read bound, and a nonblocking open.
- `skills/_shared/http-client.mjs` provides the bounded research HTTP calls for the skills.
- `src/startup-card.ts` imports the same `load-config`/`selectConfigPath` pair to display the secret-free configuration card, so card and skills always read identical configuration.

Example: the `context7-auto-research` and `grok-search` skills both call `loadConfig` with their required variable names, while the startup card calls it with `allowMissing: true` so an absent file yields anonymous Context7 defaults instead of an error.

---

## Naming Conventions

- Module files are kebab-case: `workflow-state-machine.ts`, `candidate-artifact.ts`.
- TypeScript (`.ts`) is for modules loaded by Pi or run with `node --experimental-strip-types` (operator CLI, evaluation scripts); plain JavaScript (`.mjs`) is for skills, workers, the postinstall script, and `scripts/`.
- Built-in entry scripts follow `<purpose>.mjs` under `scripts/` (`pack-check.mjs`, `traceability-check.mjs`, `check-agents.mjs`, `seed-acceptance.mjs`).
- Tests mirror their target: `src/plan-draft.ts` is covered by `test/plan-draft.test.ts`; integration coverage is `*.integration.test.ts`; property tests are `*.property.test.ts`; plain-JS assets use `*.test.mjs`.
- Generated bundles keep the source name plus `-worker` or the bare target name, and always carry the build header comment.

---

## Forbidden Patterns

- Never edit a generated bundle (`src/workspace-io-worker.mjs`, `src/operator-cli.mjs`) by hand; `bun run check` fails a stale bundle, and hand edits are overwritten on the next build.
- Never add a web/HTTP server layer to the package; operator entry points are the read-only `doctor`/`runs` CLIs, and host integration is through the Pi extension API only.
- Never discover the three professional Agents from user or project Agent directories; `src/agent-registry.ts` loads `agents/design-explorer.md`, `agents/implementation-worker.md`, and `agents/diagnosis-worker.md` relative to the package and exposes no override or search-path API.
- Never place trusted runtime state inside the consumer repository; private storage roots come from `src/state-root.ts`.
  Explicit bounded portable task narratives and operation-owned publication recovery siblings may live only in the checked `.cadence/` namespace; they grant no execution authority.
- Never let child (candidate/packet) code import parent apply or state authority; `test/architecture-boundaries.test.ts` enforces the import boundary, and the narrow ports in `src/durable-contracts.ts` are the only sanctioned seam.
- Never add a runtime fallback that traverses the relocated reference repository; it is read-only provenance evidence only, as stated in `provenance/adapted-modules.yaml`.

---

## Examples

- A clean owner module is `src/canonical.ts`: 20 lines, no dependencies, one purpose (locale-independent identity ordering and canonical JSON), consumed across storage, delivery and agents.
- A clean bounded I/O module is `src/directory-sync.ts`: one exported function returning a capability result (`"synced" | "unsupported-directory-barrier"`), with the Windows EPERM case explicitly documented as a missing barrier, not a permission to ignore file errors.

## Disconnected Task Foundation Owners (G1)

- `src/task-records.ts`: closed bounded portable record decoding, UUID/path/hash grammar and diagnostic vocabulary.
- `src/task-store.ts`: new private `task-v1` SQLite namespace, immutable snapshots and publication intents; no execution/approval API.
- `src/task-legacy.ts`: readonly quiescence proof under shared ownership for known core-only legacy stores; preserves history and rejects unknown/resource-bearing layouts.
- `src/task-publication.ts`: explicit intent-first publication/reconciliation and repository review-currentness checks.
- `src/task-files.ts`: bounded regular-file reads and managed parent creation.
- `src/task-import.ts`: readonly contextual discovery/import with divergent-ID detection; no local session/storage dependency.

Existing apply exclusive-install/claim-restore helpers remain local to `src/apply-transaction.ts`, unchanged.
Task publication uses its own deterministic-link/retained-claim protocol and must not reuse apply's claim-unlink policy.

These modules are packaged but disconnected from `src/index.ts`; the four existing production stages remain enabled unchanged.
`provenance/package-members.json` must list each new shipped source file exactly.
See [Database Guidelines](./database-guidelines.md#scenario-disconnected-g1-task-foundation) for signatures, limits, failure cases and qualification gaps.

## Disconnected G2 Storage Increment

- `src/task-shell-contracts.ts`: closed durable shell/planning/review data decoders and integrity links, never live authority.
- `src/task-store-read.ts`: shared bounded raw-byte/schema/retained-foundation readers.
- `src/task-shell-storage.ts`: checked G2 graph and narrow compound storage mechanics behind `TaskStore`.
- `src/task-observation.ts`: noncreating contextual G1/G2 listing without migration or publication replay.
- `src/storage-schema.ts#TASK_SHELL_SCHEMA`: complete additive G2 table namespace; existing G1 tables remain unchanged.

These extend storage only: controller, session navigation, terminal issuer and execution are not implemented by their existence.
See [Task Storage Guidelines](./task-storage-guidelines.md) for current APIs, migration/retention tests and explicit missing owner APIs.

`src/task-session.ts` is the disconnected G2 host-facing session owner for explicit Open/reconstruction and fresh-owner lifecycle checks.
It is not a production registrar or controller; see [Session Adapter Guidelines](../frontend/task-session-guidelines.md).
Its integrated A/B run/restriction/work lane is composed only by `src/task-planning-tools.ts`; original H1/H2 assertions now pass in the independently reviewed disconnected Linux Node/Pi slice, without B/G2 acceptance.

`src/task-lifetime.ts` is the sole negative resource owner, integrated with existing resource/session/source/controller/installer paths.
Its immutable native-process anchor retains exact original Promise/FD/Dir/DB cells across compatible same-build replacement; it grants no attachment, source or execution authority.
[Task Authoring](./task-authoring-guidelines.md#integrated-negative-lifetime-core) owns ABI/runtime/cold-upgrade/bounds; [Task Storage](./task-storage-guidelines.md#participating-resource-and-fence-boundary) owns checked checkout, borrowed stores and native adapters.
Do not introduce a second registry, host framework or copied helper.
`provenance/package-members.json` includes the sole added `package/src/task-lifetime.ts`; membership is not release acceptance.
The approved workspace-worker derived delta is produced only through the existing builder; operator CLI bytes stay unchanged.
Bundled helper code does not bootstrap an anchor or authorize worker participation.

`src/task-controller.ts` owns SDK-free selected status and bounded project read/list/literal-search; see [Task Observation](./task-observation-guidelines.md).
Its separate experimental authoring dispatch resolves proposals/materials and borrows guarded storage/publication; see [Task Authoring](./task-authoring-guidelines.md).
`src/task-planning-tools.ts` owns the isolated `cadence_task` installer, pure preparation, registry identity and hook/execute enforcement; see [Planning Host](../frontend/task-planning-guidelines.md).
The combined installer includes B's managed planning publication primitives but remains disconnected, experimental and unaccepted; production entry, storage schema, source acceptance and execution remain unchanged.

`src/task-source.ts` is the disconnected host-facing source/decision/progress service.
Accepted native N1/observable-currentness policy supersedes its historical universal-attempt claim, not the original failures; see [Source Host Guidelines](../frontend/task-source-guidelines.md).
Original unfinished-resource failures remain historical safety evidence; their corrected integrated assertions are not hidden-attempt exceptions or whole-G2 acceptance.

## Scenario: Candidate-only review owner and distribution seams

### 1. Scope / Trigger

The private convergence candidate adds two shipped review owners without activating production task routing.
Historical 124-member/no-issuer descriptions above are checkpoints only.

### 2. Signatures

`registerTaskShell(pi, {state, sessionDirectory, privateRoots})` is isolated composition.
`createTaskReviewService` connects trusted internal compiler receipts; its default production adapter is unavailable.
The registrar has no compiler or fixture selector.

### 3. Contracts

`src/task-review.ts` owns compiler/interaction receipts and terminal issuer orchestration.
`src/task-review-ui.ts` owns bounded reversible full overview/material transport, not terminal consent or execution.
Existing session/lifetime/storage/Source owners retain host authority, actual resource closure, named transactions and reciprocal readonly agreement.
`src/task-store-read.ts` remains a closed reexport facade of the shared storage owner, not a public skip-validation or version fallback.
Exactly 126 regular package members include the two review owners; helpers/tests/specs remain excluded.
`src/index.ts`, legacy activation, dependency/version/lockfile/content remain unchanged.

### 4. Validation & Error Matrix

Default unavailable compiler exposes neither plan identity nor affirmative control.
Missing/malformed selected facts, unknown close and currentness drift refuse, never invoke another owner as fallback.
Membership/body mismatch fails real pack qualification.

### 5. Good/Base/Bad Cases

Good: an excluded trusted test composition exercises the same terminal service/issuer.
Base: ordinary chat continues with unchanged production routing.
Bad: import a test adapter into the registrar or interpret a shipped module as activation.

### 6. Tests Required

Retain compiler/default-registrar negatives, actual session/Source/native suites, distribution and separate real pack/body hashes.
Assert exact exclusions and unchanged production entry independently of member count.

### 7. Wrong vs Correct

Wrong: the review modules ship, therefore G3 compilation/execution or G2 release is available.
Correct: keep default compiler unavailable, trusted fixture composition excluded and integration/acceptance main-owned.

### Unaccepted G3 compiler checkpoint

- `src/task-execution-schema.ts`: public TypeBox B DTO only; never imported at runtime by native storage codecs.
- `src/task-execution-draft.ts`: pure durable graph decode and B finite expansion.
- `src/task-plan-observation.ts`: original-work bounded native observations, not another store or admission service.
- `src/task-plan-compiler.ts`: genuine static compiler receipt/currentness adapter, composed only by `src/task-shell.ts`.

This checkpoint does not contain durable execution revisions, amendment certification or launch/apply admission.
