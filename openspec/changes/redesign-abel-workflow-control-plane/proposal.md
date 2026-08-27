## Why

The current Design and Implement workflows bind execution progress to process-local task records, one-shot Worker sessions, manually assembled protocol envelopes, and terminal fail-closed outcomes. Transient endpoint, environment, artifact, verification, or boundary failures therefore strand otherwise valid work, while phase-by-phase application can leave the main workspace in a partially implemented state.

The package is still in development and has no active OpenSpec changes to migrate, so this is the appropriate point to replace that MVP execution contract with a durable, resumable, transactional workflow rather than preserve its recovery limitations.

## What Changes

- **BREAKING** Replace the internal v1 `admit-graph` / `task-attempt` orchestration protocol and embedded-graph receipt with a versioned v2 change-oriented control protocol whose mechanical graph, hash, snapshot, operation identity, and scheduling facts are produced and validated by code.
- Introduce stable durable Design and Implement run identities that remain unchanged as approved delivery revisions advance, with locally queryable status, idempotent `start`/`status`/`resume`/`rebind`/`cancel`/`discard` commands, and recovery across host-process or model-session restarts.
- Make Worker providers replaceable execution resources. Preserve authoritative task context in a structured workflow ledger and permit policy-controlled endpoint/model rebinding without changing an approved behavior or technical contract.
- Execute the complete Implement task DAG in a private change workspace. Keep the main workspace unchanged until every task, affected verification, full-suite comparison, output postcondition, and AGENTS checkpoint succeeds, then apply the cumulative change through a currentness-checked transaction.
- Replace terminal handling of transport, environment, capacity, artifact, stale, conflict, and verification failures with typed recoverable states. Reserve run-terminal outcomes for completion, discard, and deterministic rejection; operation cancellation leaves the run recoverably paused after any required apply recovery.
- Allow an Implement run that discovers an approval-boundary gap to pause with structured evidence, accept a newly approved Gate A or Gate B receipt revision, revalidate the retained change workspace, and continue without losing already valid work.
- Consolidate Design questions at their owning Gate, keep reversible mechanical choices non-blocking, and make activity presentation reflect queued, connecting, running, verifying, paused, approval-needed, applying, and completed states truthfully.
- Persist only private structural state and an isolated change workspace outside the repository, rejecting any resolved state path equal to or contained by the canonical consumer root; never persist credentials, environment values, raw prompts, or raw model output. Remove retained run data on completion or explicit discard, but settle any in-flight final application through recovery before destructive cleanup.

## Capabilities

### New Capabilities

- `workflow-run-control-plane`: Durable, versioned, idempotent Design and Implement run lifecycle, status, recovery, approval revision binding, private state retention, and transactional completion semantics.

### Modified Capabilities

- `abel-workflow-prompt-package`: Change Design and Implement user-visible workflow behavior, Gate interaction, delivery v2, recovery commands, completion criteria, and removal of the MVP prohibition on private persistence, isolation, status, resume, and transaction support.
- `private-agent-orchestration`: Replace process-local terminal task execution with Worker-independent context, recoverable task states, private change-workspace execution, cumulative verification, currentness-checked transactional apply, and truthful lifecycle activity.
- `subagent-endpoint-config`: Replace one fixed per-role endpoint identity with a visible policy-controlled route set, capability and health selection, bounded external waits, and explicit run rebinding while preserving configuration precedence and secret handling.

## Impact

- Workflow contracts and entrypoints: `skills/abel-workflow/SKILL.md`, `prompts/abel-design.md`, `prompts/abel-implement.md`, and private tool registration in `src/index.ts`.
- Control and state: `src/contracts.ts`, `src/runtime.ts`, `src/worker.ts`, `src/scheduler.ts`, `src/drain.ts`, `src/result-store.ts`, and new private run-store/control-plane modules.
- Execution isolation and delivery: `src/child-session.ts`, `src/candidate-preflight.ts`, `src/patch.ts`, `src/file-snapshot.ts`, `src/implement-graph.ts`, and new change-workspace/transaction adapters.
- Provider routing and presentation: `src/subagent-endpoint.ts`, `src/parent-provider.ts`, `src/subagent-activity.ts`, configuration examples, README, and distribution metadata where new modules are shipped.
- Tests will replace v1 protocol assertions and add restart recovery, stable run identity across delivery revisions, explicit provider rebinding, repository-external state-root rejection, approval revision, private-state cleanup, apply cancellation/discard recovery, atomic application, stale-main-workspace, and truthful activity acceptance coverage.
- The one-time bootstrap keeps v1 activation until the complete bootstrap task and acceptance matrix succeeds; before the selector switches, it commits a resumable v2 handoff so a reload at the cutover boundary cannot strand this change.
- Installed v2 intentionally has no v1 orchestration or receipt compatibility path; the exact pre-v2 bootstrap selector only creates the durable v2 handoff described above and never makes v2 parse a v1 receipt. Gate authority, scoped Worker access, path and symlink safety, parent-owned acceptance, and the prohibition on implicit commit/archive/publish/release remain unchanged.
