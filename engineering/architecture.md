# Architecture and packaging

Module ownership, maintained seams, how Pi loads the package and what it ships.
Read this before moving a responsibility between modules, adding an import or changing package contents.

## Source ownership and API boundaries

| Owner                                                                                                      | Responsibility                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`, `src/history-shell.ts`, `src/native-*.ts`                                                  | Nonactivating Pi entry, raw native consent, typed service attachment, paging and verified export; no embedded executor     |
| `src/agent-panel.ts`, `src/agent-panel-model.ts`, `src/agent-panel-cadence.ts`, `src/agent-browser/`       | Readonly agent panel over Pi's `subagent:*` bus, fed with a running owner's children; never starts or cancels work         |
| `src/service/host.ts`, `src/service/cli.ts`, `src/service/{autostart,system-service,launchd,login-run}.ts` | Single-owner composition, explicit project launch and generated system/user service definitions; management stays SDK-free |
| `src/service/{coordination,private-files,owner}.ts`                                                        | Canonical overlap exclusion, exact locks and original-operation lifetime                                                   |
| `src/service/{liveness,self-heal,process-ledger,recovery-log,doctor}.ts`                                   | Holder liveness evidence, startup self-healing, recovery log/archive and `cadence doctor`                                  |
| `src/service/checkout-gate.ts`, `src/service/workflows.ts`                                                 | Exclusive checkout ownership and the sole current engineering orchestrator                                                 |
| `src/service/{model-config,model-context,model-choice,auth-network}.ts`, `src/sdk-network.ts`              | Existing Pi sources, explicit exact model/thinking, original OAuth writeback and strict shared network policy              |
| `src/worker-public.mjs` and `.d.mts`, `src/service-contract.ts`                                            | One portable core/domain/capture codec with matching declarations and facade; TS core/domain/capture modules re-export it  |
| `src/service/contracts/`, `src/service-client.ts`, `src/service-wire.ts`, `src/service-http-client.ts`     | Closed DTOs, typed named operations, reply correlation, transport bounds and one projection tracker                        |
| `src/subagent-process.ts`, `src/sdk-worker.mjs`, `src/worker-{capture,redaction,tools}.mjs`                | Same native worker/check launcher, genuine SDK capture, incremental sanitizer and bounded no-raw-spill bash adapter        |
| `src/history/{writer,run-state,publication}.ts`                                                            | One committed sequence authority, shared semantic reducers and expected-byte strict-v1 summaries                           |
| `src/history/` readers/proof/search/export/live modules                                                    | Original-source integrity, bounded retained navigation, exact search and complete nonblocking exports                      |
| `src/workspace.ts`, `src/service/checkout-lock.ts`, `src/task-diff.ts`                                     | Literal workspace identity, exact existing lock semantics and honest change observation                                    |
| `web/src/`                                                                                                 | Reused presentation and thin shared-client adapters, not SDK/session/execution ownership                                   |
| `scripts/`, `provenance/`, `licenses/`                                                                     | Reproducible builds, exact package/body/reference/notice audits and pinned reuse                                           |

`src/activity.ts` and `src/service/activity-files.ts` own activity-only native reports; `src/service/activity-discovery.ts` is the readonly registry/report aggregation boundary, with closed projections in `contracts/activity.ts`.
`src/service/{gateway,gateway-store,gateway-cli}.ts` owns the no-project entry, private workbench coordination, nonactivating directory selection, explicit-Send owner preparation and same-origin project routing, not task execution.
`src/service/maintenance.ts` owns the in-service refusal, the WebUI's transient restart/upgrade job and its record, and the upgrade with rollback; `src/service/installation.ts` identifies the exact Pi/npm/Bun installation and owns its package-manager commands.
Both stay SDK-free like the rest of management.
A root access rotation retires its proxy attachment IDs and detaches those exact browser viewers at the owners, without cancelling admitted work.
Proxy attachments name their exact owner epoch: a confirmed stopped epoch or authenticated successor retires that old viewer without forwarding old CSRF through a new owner's cookie; unknown outcomes remain unavailable, and prior work is neither canceled nor replayed.
The first version requires a selected project for ordinary Send/tools; the empty workbench presents the conversation shell with Send disabled, not an unbound chat executor.
`src/service/{workbench,conversations,workbench-files}.ts` owns ordinary conversations (browser admission and live preview), readonly files and explicit project navigation; `src/service/contracts/workbench.ts` is the portable closed DTO boundary.
`src/service/conversation-images.ts` owns ephemeral upload staging; `src/image-content.mjs` owns portable format/header validation.
The conversation launcher delivers admitted bytes on its private image pipe, not through the public control envelope.
`src/service/pi-sessions.ts` reads the project's Pi session files, the shared conversation store, and never writes them; a browser turn's SDK worker writes through Pi's `SessionManager`, and `src/session-entries.mjs` names the custom entries Cadence adds.
Pre-Pi Cadence conversations are unsupported: no migration endpoint, old checkpoint codec or transcript reader remains.
A readonly identity-presence guard refuses reuse and preserves the old files; current context/binding/link metadata retains its existing paths.
`src/service/turn-capture.ts` retains workflow subagent turns from capture frames; `src/session-sharing.ts` is the extension's readonly notice when the browser continued the session a terminal holds.

`src/service/{conversation-records,conversation-controls}.ts` owns readonly conversation, transcript and mode/plan decoding; it has no execution owner, SDK or write path.
The live owner supplies its original turn map and lease assertion; `gateway-conversations.ts` supplies an exact stopped-owner observation instead, checked before and after each read.
The gateway reads only associated stopped owners through these shared readers; a live, starting, quarantined or unresponsive owner is never replaced by an empty live map.
A never-prepared selection can read its existing Pi sessions without preparing an execution owner; it projects an empty conversation only when none exists.
Retained conversation reads and browser draft identity no longer depend on an execution attachment; legacy task/workflow detail still uses its owner.
Conversation auth intents and original settlements use their own flushed private journal, never fabricated task/history receipts.
The gateway preparation route cannot carry message text, select a model or grant plan consent; it reuses `openProjectDirectory`, also reached by native `project open`.
Directory entries retain distinct cwd identities even when they resolve to the same checkout owner; old root-keyed entries remain readable without migration.
Preparation binds the original Send's conversation location independently of its directory-navigation entry; it never replaces that entry's identity.
Only successfully prepared epochs join whole-workbench Stop; browsing an independently running owner never adopts it, and directory aliases are joined once per exact owner epoch.
Their original Stop lifetime and exclusive checkout barrier belong to the existing service owner and checkout gate.

The daily native path is `index → cadence-mode → native client → Workbench/Workflows → shared checkout gate/process owner`.
`src/service/conversation-workflow.ts` owns browser conversation mode, proposal/run binding, owner-accounted delegation and attachment-bound approval; `src/cadence-instructions.ts` shares the dialogue policy with native Pi.
`src/coordinator-tools.mjs` is a bounded private child/owner IPC bridge, never an HTTP or general-purpose execution interface.
`src/worker-toolkit.mjs` owns trusted capability composition and tool originals; `src/worker-workspace.mjs` binds immutable tool placement and maps the existing execution context into an owner-selected tree.
`src/research-tools.mjs` binds the installed public Pi readonly file tools to investigation roots; ordinary file schemas, output and search semantics remain Pi-owned.
`src/change-tools.mjs` adds fixed-revision readonly review evidence; `src/git-environment.mjs` shares the physical-checkout Git policy without replacement objects.
See [worktree delivery](worktree-delivery.md) for the approved-plan-to-local-delivery contract.
See [worker tools](worker-tools.md) for capability, continuation, coverage and disposal contracts; SDK bootstrap no longer duplicates role-specific tool lists.
`src/service/workflow-history.ts` owns bounded readonly ID-selection continuations and their idle/owner-close cleanup.
`src/service/workflows.ts` owns the private agreement/grant/run journal, original processes and delivery operations; `workflow-controller.ts` owns evidence-led continuation and route revisions, `workflow-report.ts` owns structured reports and bounded capture projection, while `project-knowledge.ts` owns source selection and verified knowledge-assignment policy (see [project knowledge](project-knowledge.md)); `src/service/workflow-git.ts` owns bounded Git observations/scopes; `src/service/contracts/workflow.ts` owns closed portable workflow DTOs.
`src/service/workflow-delivery.ts` owns the named stable candidate, exact-candidate acceptance preflight and safe retention; `src/service/repository-coordination.ts` owns short common-directory Git mutation leases and indexed workspace identity, without replacing the adaptive controller or execution owner.
`src/service/workflow-result.ts` owns the shared bounded, redacted process-result projection for workflow retention and reads, independent of native settlement and structured task completion.
`src/service/conversation-contexts.ts` owns readonly context records and explicit per-conversation model installation/capture; it shares the existing bounded `OwnerModelContext` source cache, not one runtime per conversation.
`src/conversation-identity.ts` supplies domain-separated context-version identities without importing the executor into Pi.
`src/cadence-preferences.ts` stores only the credential-free default for new conversations.
The readonly diagnostics path is `index → history-shell → native client → history/workflow readers`; it cannot create, approve, execute, check, review or select a model.
`TaskActions`, `TaskScheduler`, `ActionAdmission`, the old graph executor and foreground `TaskController` are removed, along with their execution-only tests and prospective-plan helper.
`Workbench`, `Workflows` and `Conversations` take `CheckoutGate` directly.
A canceled waiter is removed; an aborted holder remains held until original settlement, and quarantine/Stop cannot refund it.
`ServiceCoordination` owns a `CheckoutStore`, not task CRUD.
Retained task readers/writers use an explicit `legacyTaskStore` adapter; current path/filesystem consumers import `workspace.ts` directly.
Conversation choice versions bind their durable preference revision, identity/cwd, live source selection, owner epoch and access generation; no model is reconstructed from task history.
The explicit low-level unscoped model slot remains owner-local; changing it cannot evict retained conversation sources.
Global configuration replacement checks the original owner activities, model preparations and the checkout gate; a conversation preference does not replace another conversation's configuration.
The remaining retirement work is explicit: `host.ts` still initializes `HistoryWriter`/history identity for bootstrap, auth fallback and Stop; worker/client protocols still carry retired task shapes.
Those persistence/recovery/transport dependencies are not yet a separate readonly archive layer and must not be described as fully retired.
The readonly operator and independent research/startup modules must not gain service startup or execution side effects.
Inspect actual installed public Pi declarations before changing host/SDK bindings; never import private SDK implementation paths or select a global substitute.

Key maintained current seams include `CheckoutGate.acquire`, `ServiceOwner.registerRuntime`, `Workflows.command`, `Workbench.command/read`, and `NativeConnection.attach/refresh/detach`.
The historical writer/receipt/read contracts remain separate regression subjects until the remaining persistence retirement is completed.
Use their current declarations rather than copying DTO parsing, reducers, a second controller, or process ownership into a client.

## Packaging and loading

The package can be loaded as a reviewed local package, extracted tarball or installed npm package through Pi's package mechanism.
For a local checkout, add its absolute or relative path to Pi's `packages` setting, or try `pi -e ./cadence`.
Pi loads `src/index.ts`; the service, worker and readonly operator are ordinary JavaScript with no TypeScript/source-tree fallback.
The native extension requires Pi 1.5.0 or a compatible 1.x host; inside Pi it uses the host's own public packages, never a second TUI runtime.
Development pins, declared Node baseline (`>=22.19.0`) and actual tested runtime identities are separate facts, not universal compatibility promises.
Required installed peers are public Pi packages and Typebox; `undici` and `ws` are exact production dependencies.
Pi's package installer omits peers and supplies only its own packages and Typebox to the extension, so any other extension import must be a production dependency.
The standalone owner and workers run outside Pi and import `pi-coding-agent`/`pi-ai` by bare name, so they load the exact tested copy (1.5.0) from optional dependencies; an install that omits optional dependencies cannot start an owner.
Browser assets are prebuilt, not compiled by consumer postinstall.

## Repository release automation

`.github/workflows/publish.yml` owns the explicitly pushed stable-tag release lane; `scripts/npm-release.mjs` owns exact source/tag/package/registry binding and post-publication byte confirmation.
The readonly preparation job uses the existing sole gate and `scripts/package-audit.mjs`; the separate OIDC job re-audits the immutable artifact against a clean checkout and publishes it without project dependencies or lifecycle scripts.
Registry confirmation has one monotonic deadline spanning requests, response bodies and delays; original publish outcomes and later visibility remain separate facts.
It can repeat readonly observations, never publication or registry repair.
These are repository tooling, not shipped runtime entrypoints or service activation.
Repository/tag/workflow protections and the npm trusted-publisher binding remain external authority, not guarantees supplied by editable workflow code.
Setup and release operations live in [reuse and distribution](../docs/reuse-and-distribution.md#maintainer-releases-from-any-computer).

## Shipped content

- `skills/context7-auto-research` and `skills/grok-search` remain independent research tools.
- `skills/git-commit` requires an explicit commit request and deterministic audit; legacy task review never commits.
  Conversation workflows may perform only their explicitly plan-authorized local commits/merge.
- Three pinned professional profiles in `agents/` provide readonly design/diagnosis/review and direct-edit implementation/knowledge instructions, not execution authority.
- `config/` contains the optional research environment example; the obsolete task-check example is removed.
  The package has no install script; `cadence server install` creates a missing user `.env` template, and no build/Git/provider operation runs at install.
- `node /absolute/cadence/src/operator-cli.mjs doctor|runs [workspace]` remains readonly and independent of service startup.

The native agent browser reuses the readonly session navigator, transcript pane/content renderer and labeled rules from `gotgenes/pi-packages`; `provenance/agent-browser-reuse.json` pins source bytes and describes the small Cadence adaptations.
Its source adapter consumes only the existing bus and never loads an upstream agent manager or execution API.
Native Cadence observation is scoped by the workflow admission context to the current Pi conversation; the browser lists only running agents.
