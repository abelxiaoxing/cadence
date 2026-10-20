# Presentation and Content Structure

## Native presentation owners

- `src/index.ts`: sole Pi extension entry, child guard and independent startup notification.
- `src/task-shell.ts`: `/cadence [request]`, native service menu/editor/confirm, retained pager and owner observation; no foreground executor.
- `src/startup-card.ts`: pure bounded research-configuration summary, not task activation or a persistent widget.
- `src/verification-diagnostics.ts`: shared sanitized/byte-bounded display projection.
- `src/service-client.ts` and `service-contract.ts`: both UIs consume shared typed actions/current/history, never a terminal-local TaskController.

There is no `subagent-activity.ts`, task-session adapter, task-review-ui owner, web frontend or shipped workflow prompt directory.
[Backend directory structure](../backend/directory-structure.md) lists the complete 16-source closure.

## Fixed Agents

`src/agent-registry.ts#roleInstructions(kind)` selects only these package-relative resources:

| Kind / action             | Agent                             | Tools in `src/sdk-worker.mjs`           |
| ------------------------- | --------------------------------- | --------------------------------------- |
| code Start / Continue     | `agents/implementation-worker.md` | read, grep, find, ls, write, edit, bash |
| research or Generate plan | `agents/design-explorer.md`       | read, grep, find, ls                    |
| diagnosis                 | `agents/diagnosis-worker.md`      | read, grep, find, ls                    |

`loadAgentDefinitions()` uses bounded regular/single-link reads (32768 bytes each) and computes raw-content SHA-256.
No project/user role discovery overrides these files.
The shell adds at most 32768 bytes of root `AGENTS.md`, labeled untrusted local content, not the full conversation or private history.
Plans are advisory until native code Start; code edits are direct host-tool edits, not disposable candidates or sandboxed transactions.
All roles forbid Git mutation, installation, consumer cleanup, publication, nested editing and automatic retry; those instructions are not OS enforcement.

Keep MIT/pi-subagents attribution in `THIRD_PARTY_NOTICES.md` and `licenses/`.
Review Agent body changes together with `provenance/adapted-modules.yaml` pins and exact-body assertions.
Runtime content hashes do not turn provenance YAML into authorization.
Do not transplant Trellis AGPL source/templates or add a Trellis runtime dependency.

## Independent skills and configuration

- `skills/context7-auto-research/`: library documentation research; absent configuration permits anonymous defaults.
- `skills/grok-search/`: bounded Grok/Tavily research with explicit credential configuration.
- `skills/git-commit/`: only an explicit human commit request permits its deterministic audit/commit route; task completion never invokes it.
- `skills/_shared/`: shared HTTP/config clients and declarations, independent from task execution.
- `config/.env.example`: research configuration only, not task consent or SDK credentials.
- `config/workflow-task.example.json`: `cadence-assistant-checks/1` named command/timeout example for optional project `.cadence/assistant/config.json`; not a compiled task graph.

Research selection uses one whole file: `<cwd>/.pi/cadence/.env` before `<home>/.pi/agent/cadence/.env`, with no per-key fallback or process-environment merge.
An explicit malformed/unreadable file refuses instead of falling back; the loader is nonblocking and bounded to a regular file of 64 KiB.
This independent loader is not the task store's no-link policy.
`src/install-config.mjs` creates only a missing user research template using exclusive creation; existing paths are preserved.
Startup never runs that installer or creates task/check configuration.

[Distribution](../backend/task-distribution-guidelines.md) owns the manually reviewed 129-member candidate policy, every-body/pin audit and excluded development assets.
Old prompts, examples and consumer copies are neither current aliases nor cleanup targets.
