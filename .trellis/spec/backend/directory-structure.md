# Backend Directory Structure

## Live entrypoint and package closure

`provenance/package-members.json` records the complete129-member/35-runtime-source dual-surface closure; the historical34/16 policy is superseded.
The live path is `index → shell → NativeConnection → ServiceClient → accepting service`; WebUI uses the same ports.
The owner alone composes model/auth, graph/scheduler, checks/review, capture/history and assets; the old controller is not shipped.
Exact body audits and actual source/extracted qualification, not member counts alone, establish the exercised boundary.
Retained source owners:

| Files                                                                         | Responsibility                                                              |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `src/index.ts`, `src/task-shell.ts`                                           | Sole registration, inert startup notification and native workflow facade    |
| `src/task-controller.ts`                                                      | Legacy regression subject, not a production executor                        |
| `src/task-types.ts`                                                           | Shared plain types and task/check boundary decoders                         |
| `src/task-store.ts`                                                           | Workspace resolution, bounded records/config/logs and new lock              |
| `src/task-diff.ts`                                                            | Readonly Git/non-Git bounded observations                                   |
| `src/subagent-process.ts`                                                     | SDK/check process owner, environment, protocol, stop and auth wait bounds   |
| `src/sdk-worker.mjs`                                                          | Maintained JavaScript SDK child, in-memory exact model/auth and fixed tools |
| `src/agent-registry.ts`                                                       | Three package-relative role files and content hashes                        |
| `src/verification-diagnostics.ts`                                             | Pure bounded presentation/redaction                                         |
| `src/operator-tools.ts`, `src/operator-cli-entry.mjs`, `src/operator-cli.mjs` | Readonly doctor/runs and generated readonly operator                        |
| `src/startup-card.ts`                                                         | Independent nonactivating research-configuration summary                    |
| `src/install-config.mjs`, `src/install-config.d.mts`                          | Missing-only user research template and declaration                         |

## Implemented service and capture owners

See [owner lifecycle](./service-owner-guidelines.md) and [capture/history contracts](./service-history-capture-guidelines.md) before changing these boundaries.

| Files                                                                                           | Responsibility                                                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `src/worker-public.mjs`, `.d.mts`; `src/service-contract.ts`                                    | Sole maintained portable core/domain/capture codec/declaration and public facade                        |
| `src/service/contracts/{core,domain,capture}.ts`                                                | Re-export shims only, not duplicate TS validators                                                       |
| `src/service/contracts/{history,budget}.ts`                                                     | Public history/read/progress DTOs and shared retention accounting                                       |
| `src/service-client.ts`, `src/service-wire.ts`, `src/service-http-client.ts`                    | Typed operations/reconciliation, finite route/body categories, raw transport limits; no mutation replay |
| `src/service/{ports,admission}.ts`                                                              | Explicit owner/persistence/read interfaces and context-bound command admission                          |
| `src/service/{coordination,private-files,owner,recovery}.ts`                                    | Registry/locks, safe files, original-promise lifecycle and native informed management recovery          |
| `src/service/{config,auth,http}.ts`                                                             | Selected inbound policy, token/cookie/local capability, authenticated HTTP/WS and readonly POST/export  |
| `src/service/{model-config,model-context}.ts`, `src/sdk-network.ts`                             | Existing Pi model/auth preparation and shared strict owner/worker SDK network policy                    |
| `src/worker-{capture,redaction,tools}.mjs` and matching `.d.mts`                                | Stateful v2 capture, incremental sanitization, charged tool ingress and no-raw-spill bash               |
| `src/worker-recording.ts`, `src/subagent-process.ts`, `src/sdk-worker.mjs`                      | Mandatory sink transformation and same prepared/legacy native launcher/SDK child                        |
| `src/history/{types,files,writer,admission,run-state}.ts`                                       | Private codecs/files, single durable sequence authority, admission adapter and semantic reducers        |
| `src/history/{publication,recovery}.ts`                                                         | Strict expected-byte v1 summaries and guarded history bridge; no lock release                           |
| `src/history/{reader,projection,search,export,live}.ts`                                         | Committed reads, complete retained exports and nonblocking live projection                              |
| `src/history/{navigation,index-tree,read-io,source-row}.ts`                                     | Bounded accelerators, original safe source materialization and IO accounting                            |
| `src/history/{read-proof,sha256-state,validator,retained-progress,retained-traversal}.ts`       | Private AEAD navigation, standard resumable hash and finite original-source proof                       |
| `src/history/{detail-progress,list-progress,graph-progress,entity-state,run-progress-state}.ts` | Typed bounded detail/list/entity/graph preparation and aggregation                                      |

## Dependency direction

`index → shell → native client → service → store/process/diff/history` is the workflow path.
The service prepares fixed role text and bounded root `AGENTS.md`; the registry uses store's bounded read helper.
The readonly operator imports store/diagnostics, not controller/process/SDK.
The startup card imports `skills/_shared/load-config.mjs`; independent skill clients share config/HTTP helpers, not task execution.
Keep validation with its data owner rather than re-parsing unknown values in the UI.

The service path is shared DTO/client → authenticated transport/admission → supplied owner ports; W2 prepared launch → validated sanitized sink → one W3 writer → committed readers/projections.
The mandatory sink is not an optional in-memory durability fallback.
`runWorker` remains a same-v2 compatibility/regression adapter; W5 removed foreground execution reachability and it is not part of the shipped native import closure.
Historical readers do not construct SDK/auth runtimes; W4 supplies current control/check environment separately from immutable admissions.

`scripts/build-operator.mjs` canonically generates only `src/operator-cli.mjs`; `--check` compares exact bytes.
Regenerate it after edits to bundled store/types/diagnostics/operator code.
`sdk-worker.mjs` is not generated and resolves installed peers through ordinary package URLs.
Pi loads the extension TypeScript; installed operator/SDK child must not fall back to repository TypeScript loaders.

## Runtime paths are not source layout

Project context lives under `.cadence/assistant/tasks/<uuid>/task.json`; optional check definitions are `.cadence/assistant/config.json`.
Private diagnostics/coordination live outside the working copy under `cadence-assistant-v1/<checkout-hash>`.
New history is beneath `service-v1/history-v2/`: explicit format3/key initialization, preserved readonly format2, and no passive migration/index repair.
[Storage](./database-guidelines.md) owns legacy resolution/refusal; [capture/history](./service-history-capture-guidelines.md) owns the separate private journal and read contracts.
`provenance/`, `scripts/`, `test/`, `.trellis/` and diagnostic fixtures do not ship.

Do not reintroduce retired certified compiler/scheduler/SQLite/workspace-worker/native-helper bodies.
The implemented finite service scheduler is not that retired executor; it uses the shared ports and native launcher.
No competing compatibility executor, custom graph framework, navigation-as-authority or Trellis runtime dependency belongs in this closure.
[Distribution](./task-distribution-guidelines.md) owns preserved retirement evidence and member audits.
