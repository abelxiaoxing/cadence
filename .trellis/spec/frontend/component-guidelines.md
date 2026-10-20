# Native Terminal Components

## Owners and integration

`src/task-shell.ts#registerTaskShell(pi: ExtensionAPI): void` owns the native facade.
Prefer Pi `select`, `input`, `editor` and `confirm`; the retained pager uses `ctx.ui.custom<void>()`.
Do not create a second renderer or restore the retired activity widget.
[Workflow](../backend/lightweight-workflow-guidelines.md) owns action contracts; [hooks](./hook-guidelines.md) owns admission and currentness.

## Review pager

The shell-local `show(text)` renders bounded server pages using `diagnosticText(text, Number.MAX_SAFE_INTEGER)` without a second clipping cap and `wrapTextWithAnsi(line, Math.max(1, width))`.
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

## Service observations and departure

Native observations are projections from the shared service, not a local worker-progress owner.
Messages/tool args/results are sanitized retained fields with explicit coverage, not raw auth/provider envelopes or hidden thinking.
`NativeHistory` offers bounded progress/Next/Back and exact-hit navigation; preserve snapshot anchors, not the initial null-snapshot request.
`exportNative` writes an exclusive destination and only reports complete after count/digest/trailer/original EOF verification.
Finite fetches keep their10s timeout; streaming export keeps caller cancellation and owner idle policy without a total archive timeout.
Return, Escape from a reader and Pi departure detach/invalidate local work without canceling an accepted run.
Explicit active-run Cancel is independent of normal mutation compatibility and requests bounded stop; unconfirmed closure remains unknown.
Configured checks use indexed disambiguated labels so raw identity cannot collide with Return/paging controls or redacted display strings.

## Startup notification

`startupCardLines({cwd, home, projectTrusted}): string[]` only observes independent research configuration.
Untrusted projects do not read it; malformed explicit config produces fixed non-fallback text.
The pure projection includes an escaped path, but `src/index.ts` notifies only summary lines when a path line exists.
It uses nonpersistent `notify` in TUI/RPC with `hasUI`; print/JSON are silent.
No keys, endpoint/model values or parser payloads enter the notification.
Repeated session starts rebuild it without a saved dismissal, persistent widget or workflow activation.

## Tests and mistakes

`test/lightweight-shell.test.ts` covers native consent/menus/context/pager wiring with a fake host.
`test/terminal-integration.test.mjs` exercises actual source/extracted regular/fullscreen paging, Unicode, resize, Start/check/review/cancel and waited quit.
`test/startup-card.test.ts` covers trust, secret-free summaries and inert repeated notification.
Wrong: detaching a viewer silently cancels accepted work or reports it completed.
Correct: detach explicitly, preserve the owner/run, and use a separate fresh Cancel with honest stop observations.
