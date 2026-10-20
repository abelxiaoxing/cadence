# Native Host Hooks

## Entry is not execution consent

`src/index.ts` composes `registerTaskShell(pi)` and the independent startup card; `CADENCE_SUBAGENT_CHILD=1` registers neither.
The shell registers only `/cadence [request]`, no workflow tool, prompt alias or RPC controller.
Its optional argument prefills a new goal and cannot Start work.
See the [workflow contract](../backend/lightweight-workflow-guidelines.md) for shared client/owner signatures and refusal matrix.

Pi dispatches commands before the ordinary `input` event, so `TerminalEntryLatch` observes `ctx.ui.onTerminalInput` plus `getEditorText()`.
A raw Enter for a single-line `/cadence` command arms one exact argument match for less than 1500 ms; consume clears it even on mismatch.
Bracketed paste never arms it; other raw input and departure clear it.
This is transient terminal provenance, not durable approval or proof of physical-human reading.
Require `mode === "tui"`, `hasUI`, trusted project, idle host, no pending messages and no active Cadence modal.
RPC with `hasUI`, print/JSON, quoted/replayed/model-generated commands and startup cannot launch tasks.

## Lifecycle map

- `session_start`: Invalidate/depart, unsubscribe prior raw input, clear local selection and install the TUI listener.
- `session_shutdown`: Invalidate/depart and unsubscribe raw input.
- `session_before_switch`, `session_before_fork`, `session_before_tree`, `session_before_compact`, `model_select`: Invalidate local dialogs/read activity and begin detach, never Cancel accepted work or veto host navigation for service lifetime.
- `input`, `tool_call`, `user_bash`: Guard only the active native modal; outside it ordinary Pi interactions are independent.

`depart()` increments epoch, clears the latch, aborts supported dialogs, dismisses the pager and starts the original `NativeConnection.detach()` with handled rejection.
The command's finally block joins detach; unconfirmed release retains the exact attachment and gives fixed guidance.
Host hooks never await the whole service job lifetime.
No new attachment can replace an uncertain original resource silently.

## Await boundaries and choices

Capture epoch, session ID and cwd at command admission; check those and current eligibility after UI awaits.
Use the shell-local current-context closure around awaits and shared CurrentView/ContextVersion for owner-side raw-byte/plan/model/action freshness, including same-revision manual changes.
Editors without a dialog abort option still require post-await currentness checks.
Capture host model/thinking to invalidate a departed native dialog; execution uses the independently selected owner model and owner-side public auth accounting.
Unsupported APIs or native/custom function transports refuse, not fallback.

Code Start requires a nonempty readable plan, a pager review and a fresh native confirmation showing model, cwd and direct-edit limitations.
Generate plan is a separate confirmed readonly action; it does not grant subsequent editing consent.
Research/diagnosis may Start from a goal with the explicitly displayed readonly plan/assignment context, with read/grep/find/ls only and no parent Checks menu; the owner independently rejects readonly shell checks.
Continue is a new explicit run, never automatic retry or checkpoint replay.
New/Open/history restore context only, never a worker or check.

Every parent check shows exact command, cwd and timeout in its own native confirmation.
Checks inherit the frozen service-launch ordinary project environment (possibly ambient credentials); SDK auth uses the separate narrow-env/anonymous-pipe route.
Do not execute a model suggestion because it appeared in a plan.
Recovery is the separate native-local management CLI with exact history/coordination binding and independent acknowledgments, never a shell fallback or arbitrary legacy-lock deletion.

## Regression anchors

`test/lightweight-shell.test.ts` owns the broad production-registrar/fake-host negative matrix: raw latch, mode/trust/queue/busy/child/stale controls, same-revision edits, unsupported transports, pre-launch Escape and waited navigation.
`test/terminal-integration.test.mjs` owns actual source/extracted regular/fullscreen positive flows and cancellation; do not claim every negative was repeated in a native terminal.
Wrong: a saved plan, successful worker or reopened history implicitly authorizes Start.
Correct: recheck current context and selected record around fresh native interaction; refuse stale choices without overwriting external edits.
