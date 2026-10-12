# Native Host Hooks

## Entry is not execution consent

`src/index.ts` composes `registerTaskShell(pi)` and the independent startup card; `CADENCE_SUBAGENT_CHILD=1` registers neither.
The shell registers only `/cadence [request]`, no workflow tool, prompt alias or RPC controller.
Its optional argument prefills a new goal and cannot Start work.
See the [workflow contract](../backend/lightweight-workflow-guidelines.md) for exact controller/auth signatures and refusal matrix.

Pi dispatches commands before the ordinary `input` event, so `TerminalEntryLatch` observes `ctx.ui.onTerminalInput` plus `getEditorText()`.
A raw Enter for a single-line `/cadence` command arms one exact argument match for less than 1500 ms; consume clears it even on mismatch.
Bracketed paste never arms it; other raw input and departure clear it.
This is transient terminal provenance, not durable approval or proof of physical-human reading.
Require `mode === "tui"`, `hasUI`, trusted project, idle host, no pending messages and no active Cadence modal.
RPC with `hasUI`, print/JSON, quoted/replayed/model-generated commands and startup cannot launch tasks.

## Lifecycle map

- `session_start`: Await departure/cancel, unsubscribe prior raw input, clear controller, reset dialog abort and install the TUI listener.
- `session_shutdown`: Await departure/cancel and unsubscribe raw input.
- `session_before_switch`, `session_before_fork`, `session_before_tree`, `session_before_compact`: Invalidate first, await cancel; return `{cancel:true}` if previously busy or still blocked.
- `model_select`: Depart: invalidate dialogs/choices and await cancel.
- `input`: While controller busy, return `{action:"handled"}`; otherwise inert.
- `tool_call`: While busy, return explicit block/reason; otherwise inert.
- `user_bash`: While busy, return canceled exit-1 result; otherwise inert.

`depart()` increments epoch, clears the latch, aborts supported dialogs, dismisses the pager and awaits `controller.cancel()`.
Do not claim coverage for host callbacks that were never delivered or universal descendant closure.
Input/tool/bash guards cover active foreground work, not every moment a planning menu is open.
Ordinary conversations outside it remain independent; no tool-set replacement/restoration framework is needed.

## Await boundaries and choices

Capture epoch, session ID and cwd at command admission; check those and current eligibility after UI awaits.
Use `CurrentChoice` (generation, task ID, revision, raw-byte identity) and `assertCurrent()` to reject stale records, including same-revision manual changes.
Editors without a dialog abort option still require post-await currentness checks.
Capture the current model and compare its serialized identity after confirmation/auth; exact public auth resolution is bounded and late results never spawn canceled work.
Unsupported APIs or native/custom function transports refuse, not fallback.

Code Start requires a nonempty readable plan, a pager review and a fresh native confirmation showing model, cwd and direct-edit limitations.
Generate plan is a separate confirmed readonly action; it does not grant subsequent editing consent.
Research/diagnosis may Start from a goal alone, with read/grep/find/ls only and no parent Checks menu; the controller independently rejects readonly shell checks.
Continue is a new explicit run, never automatic retry or checkpoint replay.
New/Open/history restore context only, never a worker or check.

Every parent check shows exact command, cwd and timeout in its own native confirmation.
Checks inherit ordinary project environment (possibly ambient credentials); SDK auth uses the separate narrow-env/anonymous-pipe route.
Do not execute a model suggestion because it appeared in a plan.
New-lock recovery needs informed confirmation, a dead local owner and unchanged lock identity; it never inspects/clears legacy locks or kills escaped processes.

## Regression anchors

`test/lightweight-shell.test.ts` owns the broad production-registrar/fake-host negative matrix: raw latch, mode/trust/queue/busy/child/stale controls, same-revision edits, unsupported transports, pre-launch Escape and waited navigation.
`test/terminal-integration.test.mjs` owns actual source/extracted regular/fullscreen positive flows and cancellation; do not claim every negative was repeated in a native terminal.
Wrong: a saved plan, successful worker or reopened history implicitly authorizes Start.
Correct: recheck current context and selected record around fresh native interaction; refuse stale choices without overwriting external edits.
