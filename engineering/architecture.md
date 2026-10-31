# Architecture and packaging

Module ownership, maintained seams, how Pi loads the package and what it ships.
Read this before moving a responsibility between modules, adding an import or changing package contents.

## Source ownership and API boundaries

| Owner                                                                                                      | Responsibility                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`, `src/task-shell.ts`, `src/native-*.ts`                                                     | Nonactivating Pi entry, raw native consent, typed service attachment, paging and verified export; no embedded executor     |
| `src/agent-panel.ts`, `src/agent-panel-model.ts`, `src/agent-panel-cadence.ts`                             | Readonly agent panel over Pi's `subagent:*` bus, fed with a running owner's children; never starts or cancels work         |
| `src/service/host.ts`, `src/service/cli.ts`, `src/service/{autostart,system-service,launchd,login-run}.ts` | Single-owner composition, explicit project launch and generated system/user service definitions; management stays SDK-free |
| `src/service/{coordination,private-files,owner,recovery}.ts`                                               | Canonical overlap exclusion, exact locks, original-operation lifetime and informed local recovery                          |
| `src/service/{admission,task-actions,graph,scheduler}.ts`                                                  | Context-bound actions, actual current views, finite graph scheduling, check/review barriers                                |
| `src/service/{model-config,model-context,model-choice,auth-network}.ts`, `src/sdk-network.ts`              | Existing Pi sources, explicit exact model/thinking, original OAuth writeback and strict shared network policy              |
| `src/worker-public.mjs` and `.d.mts`, `src/service-contract.ts`                                            | One portable core/domain/capture codec with matching declarations and facade; TS core/domain/capture modules re-export it  |
| `src/service/contracts/`, `src/service-client.ts`, `src/service-wire.ts`, `src/service-http-client.ts`     | Closed DTOs, typed named operations, reply correlation, transport bounds and one projection tracker                        |
| `src/subagent-process.ts`, `src/sdk-worker.mjs`, `src/worker-{capture,redaction,tools}.mjs`                | Same native worker/check launcher, genuine SDK capture, incremental sanitizer and bounded no-raw-spill bash adapter        |
| `src/history/{writer,run-state,publication}.ts`                                                            | One committed sequence authority, shared semantic reducers and expected-byte strict-v1 summaries                           |
| `src/history/` readers/proof/search/export/live modules                                                    | Original-source integrity, bounded retained navigation, exact search and complete nonblocking exports                      |
| `src/task-store.ts`, `src/task-types.ts`, `src/task-diff.ts`                                               | Literal workspace identity, bounded plain summaries/configuration and honest change observation                            |
| `web/src/`                                                                                                 | Reused presentation and thin shared-client adapters, not SDK/session/execution ownership                                   |
| `scripts/`, `provenance/`, `licenses/`                                                                     | Reproducible builds, exact package/body/reference/notice audits and pinned reuse                                           |

`src/service/{gateway,gateway-store,gateway-cli}.ts` owns the no-project entry, private workbench coordination and same-origin project routing, not task execution.
A root access rotation retires its proxy attachment IDs and detaches those exact browser viewers at the owners, without cancelling admitted work.
The first version requires a selected project for ordinary Send/tools; the empty workbench presents the conversation shell with Send disabled, not an unbound chat executor.
`src/service/{workbench,conversations,workbench-files}.ts` owns ordinary conversations, their private retained turns, readonly files and explicit project navigation; `src/service/contracts/workbench.ts` is the portable closed DTO boundary.
Conversation auth intents and original settlements use their own flushed private journal, never fabricated task/history receipts.
Their original Stop lifetime and exclusive checkout barrier belong to the existing service owner and scheduler.

The daily native path is `index → cadence-mode → native client → Workbench/Workflows → shared scheduler barrier/process owner`.
`src/service/conversation-workflow.ts` owns browser conversation mode, proposal/run binding, finite delegation and attachment-bound approval; `src/cadence-instructions.ts` shares the dialogue policy with native Pi.
`src/coordinator-tools.mjs` is a bounded private child/owner IPC bridge, never an HTTP or general-purpose execution interface.
`src/service/workflows.ts` owns the private proposal/grant/run journal and automated workflow; `src/service/workflow-git.ts` owns bounded Git observations/scopes; `src/service/contracts/workflow.ts` owns closed portable workflow DTOs.
`src/cadence-preferences.ts` stores credential-free global model preference.
The legacy inspector path remains `index → shell → native client → service → scheduler/process/history`.
`src/task-controller.ts` remains a legacy regression subject, not a reachable or shipped production executor.
The readonly operator and independent research/startup modules must not gain service startup or execution side effects.
Inspect actual installed public Pi declarations before changing host/SDK bindings; never import private SDK implementation paths or select a global substitute.

Key maintained seams include `TaskActions.current/currentChanges/activeRuns/checkObligations`, `ServiceClient.preflight` and named action methods, `HistoryWriter.commit/capture/publishTask`, and `NativeConnection.attach/refresh/detach`.
Use their current declarations rather than copying DTO parsing, reducers, a second controller, or process ownership into a client.

## Packaging and loading

The package can be loaded as a reviewed local package, extracted tarball or installed npm package through Pi's package mechanism.
For a local checkout, add its absolute or relative path to Pi's `packages` setting, or try `pi -e ./cadence`.
Pi loads `src/index.ts`; the service, worker and readonly operator are ordinary JavaScript with no TypeScript/source-tree fallback.
The manifest does not impose a Pi version range; inside Pi the extension uses Pi's own public packages.
Development pins, declared Node baseline (`>=22.19.0`) and actual tested runtime identities are separate facts, not universal compatibility promises.
Required installed peers are public Pi packages and Typebox; `undici` and `ws` are exact production dependencies.
Pi's package installer omits peers and supplies only its own packages and Typebox to the extension, so any other extension import must be a production dependency.
The standalone owner and workers run outside Pi and import `pi-coding-agent`/`pi-ai` by bare name, so they load the exact tested copy (0.84.3) from optional dependencies; an install that omits optional dependencies cannot start an owner.
Browser assets are prebuilt, not compiled by consumer postinstall.

## Shipped content

- `skills/context7-auto-research` and `skills/grok-search` remain independent research tools.
- `skills/git-commit` requires an explicit commit request and deterministic audit; legacy task review never commits.
  Conversation workflows may perform only their explicitly plan-authorized local commits/merge.
- Three pinned professional profiles in `agents/` provide readonly design/diagnosis and direct-edit implementation instructions, not execution authority.
- `config/` contains optional research/check examples.
  The package has no install script; `cadence server install` creates a missing user `.env` template, and no build/Git/provider operation runs at install.
- `node /absolute/cadence/src/operator-cli.mjs doctor|runs [workspace]` remains readonly and independent of service startup.
