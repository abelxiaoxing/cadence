# Backend Directory Structure

## Small source closure

There are 16 regular source files in the reviewed package; see `provenance/package-members.json` for the independent exact member policy.
Repository-relative owners:

| Files                                                                         | Responsibility                                                                |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/index.ts`, `src/task-shell.ts`                                           | Sole registration, inert startup notification and native workflow facade      |
| `src/task-controller.ts`                                                      | One foreground operation, current choice, transitions, check/review freshness |
| `src/task-types.ts`                                                           | Shared plain types and task/check boundary decoders                           |
| `src/task-store.ts`                                                           | Workspace resolution, bounded records/config/logs and new lock                |
| `src/task-diff.ts`                                                            | Readonly Git/non-Git bounded observations                                     |
| `src/subagent-process.ts`                                                     | SDK/check process owner, environment, protocol, stop and auth wait bounds     |
| `src/sdk-worker.mjs`                                                          | Maintained JavaScript SDK child, in-memory exact model/auth and fixed tools   |
| `src/agent-registry.ts`                                                       | Three package-relative role files and content hashes                          |
| `src/verification-diagnostics.ts`                                             | Pure bounded presentation/redaction                                           |
| `src/operator-tools.ts`, `src/operator-cli-entry.mjs`, `src/operator-cli.mjs` | Readonly doctor/runs and the one generated bundle                             |
| `src/startup-card.ts`                                                         | Independent nonactivating research-configuration summary                      |
| `src/install-config.mjs`, `src/install-config.d.mts`                          | Missing-only user research template and declaration                           |

## Dependency direction

`index → shell → controller → store/process/diff → types` is the workflow path.
The shell also reads fixed role text and bounded root `AGENTS.md`; the registry uses store's bounded read helper.
The readonly operator imports store/diagnostics, not controller/process/SDK.
The startup card imports `skills/_shared/load-config.mjs`; independent skill clients share config/HTTP helpers, not task execution.
Keep validation with its data owner rather than re-parsing unknown values in the UI.

`scripts/build-operator.mjs` canonically generates only `src/operator-cli.mjs`; `--check` compares exact bytes.
Regenerate it after edits to bundled store/types/diagnostics/operator code.
`sdk-worker.mjs` is not generated and resolves installed peers through ordinary package URLs.
Pi loads the extension TypeScript; installed operator/SDK child must not fall back to repository TypeScript loaders.

## Runtime paths are not source layout

Project context lives under `.cadence/assistant/tasks/<uuid>/task.json`; optional check definitions are `.cadence/assistant/config.json`.
Private diagnostics/coordination live outside the working copy under `cadence-assistant-v1/<checkout-hash>`.
[Storage](./database-guidelines.md) owns resolution and refusal behavior.
`provenance/`, `scripts/`, `test/`, `.trellis/` and diagnostic fixtures do not ship.

Do not reintroduce old compiler/scheduler/SQLite/workspace-worker/native-helper imports or generated bodies.
No compatibility executor, custom graph framework, receipts-as-authority or Trellis runtime dependency belongs in this closure.
[Distribution](./task-distribution-guidelines.md) owns preserved retirement evidence and member audits.
