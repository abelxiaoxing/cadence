# Native Terminal Components

## Owners and integration

`src/task-shell.ts#registerTaskShell(pi: ExtensionAPI): void` owns the native facade.
Prefer Pi `select`, `input`, `editor` and `confirm`; only the review pager and foreground progress need `ctx.ui.custom<void>()`.
Do not create a second renderer or restore the retired activity widget.
[Workflow](../backend/lightweight-workflow-guidelines.md) owns action contracts; [hooks](./hook-guidelines.md) owns admission and currentness.

## Review pager

The shell-local `pager(ctx, text)` renders sanitized text using `diagnosticText(text, 256 * 1024)` and `wrapTextWithAnsi(line, Math.max(1, width))`.
Header/progress lines use `truncateToWidth`, never string length as terminal columns.
At each render, recompute wrapping and clamp scroll offset to the viewport: at least one row, at most 24 rows, bounded by terminal rows minus four.
`invalidate()` is currently empty because layout is rebuilt during render; do not add cached themed/width-specific output without invalidation.

Keys: Up/Down move one row; PageUp/PageDown move 12; Home/End select the bounds; Escape or Enter returns.
Use `matchesKey`/`Key` and `tui.requestRender()` after input.
Resize must preserve access to all available rows, including wide Unicode and long plans/results.
Truncation remains visibly marked; paging a bounded display does not make an incomplete observation complete.
Fingerprints use observed raw bytes, not redacted rendered text.

The Start review shows goal, plan, prior result and current changes.
The result review shows parent command/cwd/timeout/exit/duration/output, configured not-run obligations, pre-existing dirt, current changes and stale review labels.
Do not attribute every dirty file to Cadence or hide submodule/ignored/unreadable/truncated coverage limits.
[Diagnostics](../backend/logging-guidelines.md) owns secret/control stripping and its limits.

## Foreground progress

The shell-local `progress(ctx, action)` defers launch through a microtask and tracks cancellation before that launch.
Escape first sets the local canceled flag, displays stopping/waiting, and requests `controller.cancel()`; it must not merely dismiss the screen while work continues.
The action promise settles before normal `done()`; disposal also requests cancellation and prevents a later UI completion callback.
Departure separately awaits the controller's cancellation path.

Show bounded ready/tool-name notices, not raw tool arguments/results, thinking, auth or provider errors.
A progress failure emits fixed inspection guidance, not a success message.
Canceled/timeout/unknown is not completed; direct-child close is not proof that all escaped descendants stopped.
Keep the new lock when stop/release is unknown; do not add UI cleanup that clears it.

## Startup notification

`startupCardLines({cwd, home, projectTrusted}): string[]` only observes independent research configuration.
Untrusted projects do not read it; malformed explicit config produces fixed non-fallback text.
The pure projection includes an escaped path, but `src/index.ts` notifies only summary lines when a path line exists.
It uses nonpersistent `notify` in TUI/RPC with `hasUI`; print/JSON are silent.
No keys, endpoint/model values or parser payloads enter the notification.
Repeated session starts rebuild it without a saved dismissal, persistent widget or workflow activation.

## Tests and mistakes

`test/lightweight-shell.test.ts` covers pager/progress wiring and cancellation before the progress microtask with a fake host.
`test/terminal-integration.test.mjs` exercises actual source/extracted regular/fullscreen paging, Unicode, resize, Start/check/review/cancel and waited quit.
`test/startup-card.test.ts` covers trust, secret-free summaries and inert repeated notification.
Wrong: Escape closes the view and reports success while a child still runs.
Correct: show stopping, await bounded settlement, and preserve interruption/unknown ownership honestly.
