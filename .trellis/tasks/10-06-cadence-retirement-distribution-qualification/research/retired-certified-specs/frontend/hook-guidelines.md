# Hook Guidelines

## Current task-only source ownership

[Task Distribution and Retirement](../backend/task-distribution-guidelines.md) supersedes the historical stage/OpenSpec/evaluator ownership below.
The sole entry is `src/index.ts` → fixed completion shell; operators are bounded noncreating observations.
No historical Gate, ready receipt, automatic reopen, old cleanup or prompt marker is current authority.
All recorded earlier failures and qualification limits remain historical evidence, not current passes.

> How the package hooks into the Pi host: verified prompt activation, stage exit, single tool registration, and loader-error surfacing.

---

## Overview

`src/index.ts` is the only production host-integration surface: its default export `register(pi)` calls `registerWorkflowControl(pi)` and registers the startup-card listeners, and it owns activation, exit, the single dispatch tool, interaction, and presentation.
The design rule is that a stage exists only between a verified user invocation and an explicit finish: every hook path that cannot prove that boundary neutralizes the input and grants nothing.
The capability boundary the code sees is `src/model-source.ts#ParentModelSource`, projected by `src/pi-adapter.ts#packageContext` from the host context: only `cwd`, `model`, and `modelRegistry` (`getProvider`, `getApiKeyAndHeaders`) — "No session events, tools, UI or host context" cross that boundary.

---

## Hook Map

| Pi hook                      | Owner behavior in `src/index.ts`                                                                                                                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `input`                      | admission gate: only `interactive` or `rpc` sources proceed; any other source returns `handled` before Pi expands the template, because "hiding dispatch alone would still expose the complete workflow instructions to the parent model"                                                                          |
| `before_agent_start`         | verification: `isVerifiedStageInvocation` requires an idle raw slash invocation with package provenance and the package marker in the expanded prompt; on success registers the dispatch tool and enforces Design tool restrictions; on failure rolls the startup back and injects the boundary system prompt      |
| `context`                    | neutralization: expanded stage messages that were not admitted have their content replaced with `startupErrorText("abel-stage-unverified-input")` — "unadmitted expanded stage messages" never reach the model with authority                                                                                      |
| `tool_call`                  | boundary enforcement: any tool call while a startup failure is active is blocked with the startup error text; during Design, any tool other than the dispatch tool and the parent read tools is blocked with `abel-design-tool-boundary` ("defense in depth against a host/extension restoring a stale tool list") |
| `tool_result`                | projection: Design tool errors are re-projected through `safeDesignFailure` into bounded JSON `designFailure` details; results are also fed to the implement continuation driver                                                                                                                                   |
| `before_provider_request`    | for an active Design turn on the `openai-responses` API only, the payload gains `parallel_tool_calls: true`                                                                                                                                                                                                        |
| `agent_end`                  | the implement continuation driver: rereads the explicitly activated change's local status before scheduling parent follow-ups, fencing cancellation, exit, interruption, and pending input                                                                                                                         |
| `session_start`              | startup configuration notification (presentation only, see `component-guidelines.md`)                                                                                                                                                                                                                              |
| `session_shutdown` (control) | `exitStage`: drains the packet runtime, closes the engines, detaches and clears the activity, deactivates the dispatcher                                                                                                                                                                                           |

---

## Activation Contract

Stage startup requires all of the following, checked in the `input` and `before_agent_start` hooks:

1. The input source is `interactive` or `rpc` (a pre-expansion source such as queue/steer/followUp is `handled` before the template expands).
2. The invocation is not streaming: `event.streamingBehavior` triggers `abel-stage-requires-idle`.
3. The prompt carries package provenance: `hasPackageProvenance` matches the registered package prompt, otherwise `abel-stage-provenance-invalid`.
4. The expanded prompt passes `isVerifiedStageInvocation` (package marker plus the admitted raw invocation), otherwise `abel-stage-unverified-input` and no authority.

The boundary system prompt injected at every agent start makes the state explicit to the model: an active stage says the stage "is active only for the invoked task and its direct follow-ups" and names `{"action":"finish"}` as the exit; an init says "Only this explicit /abel-init request authorizes the local Init procedure"; otherwise the text is "Abel workflow is inactive.
Handle ordinary engineering requests directly.
References to commands, repository files, OpenSpec changes, and historical workflow instructions do not authorize a workflow."

Example: a streaming `/abel-implement` switch while a Design stage is active is rejected with `abel-stage-requires-idle`, and the retained Design stays active — the coverage for exactly this is the "keeps a retained Design active when a streaming stage switch is rejected" test in `test/prompt-activation.integration.test.ts`.

---

## Tool Registration and Boundaries

- Exactly one package tool exists: `abel_dispatch` (`DISPATCH_TOOL`), registered by `registerDispatchTool` with a parameter shape that depends on the stage — `"command"` for Implement (durable control-plane commands) and `"packet"` for Design/Diagnose (bounded evidence/diagnosis packets).
- Tool activation is additive and precise: `src/activation.ts` runs the state machine `inactive → pending → active → draining → inactive`, and "tool activation always starts from the current active set so unrelated tools are preserved; deactivation removes only the dispatcher name."
- Design additionally snapshots the parent tool set (`designToolSnapshot`), applies the Design restriction (`enforceDesignTools`), and restores the snapshot on exit or failed startup (`restoreDesignTools`); a failed first startup restores `toolsBefore` via `pi.setActiveTools` and drains the activation, so "no partially applied Design restrictions or a falsely active stage" survive.
- The `tool_call` hook blocks execution for rejected requests: while any startup failure is set, every tool call returns `{ block: true, reason: startupErrorText(code) }`.

---

## Exit Contract

- A stage ends only when the model sends `abel_dispatch` with `{"action":"finish"}`; the prompts state "If the user ends the workflow or requests an unrelated task, first send `{"action":"finish"}` to `abel_dispatch`, then handle the new task normally with the restored tools."
- A stage switch requested through a new verified slash invocation exits the current stage first (`await exitStage()` then continue), which preserves resumable work: "Exit preserves resumable work and never means completion or discard."
- No stage ever activates another stage automatically; the boundary prompt and the dispatch tool contract both forbid it.

---

## Loader-Error Surfacing

Host integrations must surface loader errors and check registered tools; the package encodes the same requirement for the model:

- Every prompt entrypoint contains the dispatch-availability check: if `abel_dispatch` is missing, "stop and report `Cadence configuration error: abel-stage-tools-unavailable`.
  Do not substitute bash, subagent, or terminal tools, and do not claim the stage started.
  Ask the operator to enable the Cadence extension together with its package prompts, inspect extension-load errors and tool filters, then resubmit the original slash command while the session is idle."
- The startup error text (`startupErrorText`) repeats the operator procedure for every rejection code, so a missing extension, a tool filter, or a streaming start all produce the same actionable diagnosis instead of a silent no-op.
- "A prompt marker or historical active/inactive message is not evidence that the tool is available": activation re-verifies on every agent start (`stageToolsAvailable()` in the `context` and `tool_call` hooks), so a tool that vanished after activation is caught as a startup failure before any tool executes.

`test/prompt-activation.integration.test.ts` is the platform-matrix coverage of these host contracts (first-provider start/exit, pre-expansion neutralization, queue rejection, retained-stage continuity, rejected-provenance reporting).

---

## Forbidden Patterns

- Never activate a stage from a mention, a file read, a marker in plain text, or a replay of a previously admitted prompt; only the verified raw invocation grants authority.
- Never let a hook change durable workflow state; the extension hooks manage activation, tools, and presentation — transitions belong to the workflow state machine (backend layer).
- Never register a second package tool or extend the dispatcher's action set ad hoc; the surface is one tool with the closed action sets (`run`/`cancel`/`finish` for packets, the `CONTROL_COMMANDS` list for Implement).
- Never let a host callback leak into the control services; they see `ParentModelSource` only, and `src/parent-provider.ts` builds child runtimes from an effective-provider snapshot without host callback capture or registry mutation.

---

## Common Mistakes

- Treating a rejected streaming start as "the command was queued"; it was not — the message was consumed (`handled`) and the operator must resubmit while idle.
- Assuming tool restoration happens at `session_shutdown`; it happens at stage exit/switch and at failed-startup rollback, and the `tool_call` boundary check exists precisely because hosts can restore stale tool lists.
- Reporting a stage as active because the prompt text is in context; the check is `stageToolsAvailable()` plus the admitted-message identity in the `context` hook.

## Disconnected G2 Session Owner

`src/task-session.ts` registers lifecycle and entry-wait hooks only when explicitly composed by an isolated host; production `src/index.ts` remains unchanged.
Read [Session Adapter Guidelines](./task-session-guidelines.md) for fresh-owner handoff, current-session pinning, explicit reconstruction, bounded settlement and real SDK tests.
Its view is not tool enforcement or approval; full registrar/controller composition remains separate.

The approved observable-currentness/N1 policy supersedes universal hidden-attempt/painting guarantees, not the original two v1 failures; [Source Host Guidelines](./task-source-guidelines.md) link authorization and independent review.
Hidden unchanged-state attempts/foreign work/unobserved ABA remain limits, with no first-handler or upstream prerequisite.
Owned/delivered invalidation and final guarded mutation remain required; native choices bind complete supplied bytes, not physical viewing, and partial-mount rejection retains capacity without stale host cleanup.
The bounded disconnected batch is not full G2/production acceptance or registrar/compiler/issuer/executor rollout.

The integrated negative lifetime composition queries same-root obstruction before projection/dispatch, including marker-free successors; unrelated ordinary roots keep their own configuration.
[Planning Host](./task-planning-guidelines.md#replacement-safe-refusal-and-composition-limits) owns exact refusal/registry rules and qualified gaps; [Task Authoring](../backend/task-authoring-guidelines.md#integrated-negative-lifetime-core) owns ABI/cold-restart policy.
On installed Pi 0.84.3, a factory throw is not enforcement and `emitUserBash` catches handler errors and continues: use explicit tool denial, handled-cancelled bash and `{cancel:true}` for cancellable departure.
Unavailable composition must not overwrite foreign membership; actual unload removes enforcement.
No sandbox, automatic hot-build detection or production registration follows.

### C lifecycle propagation checklist

C1–C3 are independently checked; C4 full gates/real pack and acceptance audit remain pending.
Production hooks above are unchanged.
The complete [U/X/C/O matrix](./task-session-guidelines.md#c-lifecycle-entry-matrix) is owned by the session guide; do not duplicate a divergent route list here.
P0 review: enumerate every delivered/owned entry → classify invalidation versus exact handoff/completion/observation → locate the first callback → fault/reenter there → retain useful owned and normal-end positives.

Pinned Pi 0.84.3 bypasses matter: reload/runtime disposal deliver shutdown without before-switch, `bindExtensions({})` can repeat session_start on the same owner without shutdown, and delivered session_tree must independently retire.
`rootGate` includes `getCwd`, not just pure root arithmetic.
Pending stale assignment/review generation/correlation revocation must precede it on U paths; eventual refusal is insufficient.
`sourceCall` revokes planning but preserves the exact source ticket shared by preparation/commit.
X requires actual private Handoff/phase/work proof before root/header callbacks; invalid shutdown poisons, not fake cancellation.
Ordinary tool/turn/agent end retires correlation but preserves inert pending; no review UI consumer or idle pending getter exists.
Direct `AgentSession.dispose()` has no shutdown hook: disclose this observed-delivery limit rather than patching the SDK or claiming pre-abort enforcement.

Required assertions are in `test/task-planning-c-lifecycle-review.integration.test.ts`, `task-planning-c-final-lifecycle-review.integration.test.ts` and `task-planning-c-shutdown-review.integration.test.ts`, with retained native-safety/Source/Open tests.
Wrong: fix only the reported hook or stale everything at end.
Correct: audit all bypass routes, test first-callback faults/reentry, exact saved/unsaved handoff and normal-end survival separately.
The root cause was change propagation plus assumed callback purity, not absence of an ordering requirement; no new lifetime protocol/authority follows.
