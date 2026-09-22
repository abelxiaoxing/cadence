# Component Guidelines

> How TUI components are built in this project: the subagent-activity widget and the startup card, both projections of bounded state through `pi-tui`.

---

## Overview

The package has exactly two always-available UI components: the subagent-activity widget (placed above the editor, `placement: "aboveEditor"`) and the startup configuration card.
Both are pure projections: they render from in-memory state that the control plane pushes to them, and neither can alter a run.
The implementation is `src/subagent-activity.ts` (activity widget, inline component, state mapping, sanitizers) and `src/startup-card.ts` (card lines).

---

## Component Structure

- The widget is created by `ensureWidget()` in the activity controller: `this.ui.setWidget(ACTIVITY_WIDGET_KEY, (tui, theme) => new ActivityWidget(...), { placement: "aboveEditor" })`, guarded by a `widgetInstalled` flag and a try/catch ("TUI failures are deliberately isolated from the run.").
- `ActivityWidget` implements the `pi-tui` `Component` interface: `render(width: number): string[]` maps entry lines through `line(value, width)` and applies the theme accent to the first line only; `invalidate()` is a no-op because the controller requests renders on a timer (`ACTIVITY_REFRESH_MS = 100`) and on state updates.
- `ActivityInlineComponent` renders one activity entry inline in a tool result, with an `expanded` flag that gates the bounded failure detail block.
- The startup card is not a `pi-tui` component at all: `startupCardLines()` returns a plain `string[]` that the extension sets with `ctx.ui.setWidget(STARTUP_CARD_KEY, lines)` — the same widget API, string-array form, which RPC hosts render directly.

---

## Width-Safe Rendering

Every emitted line passes `line(value, width)`, which truncates to the terminal width twice (once naively, once against `visibleWidth`) so wide Unicode and CJK text cannot wrap or overrun:

- The overflow summary degrades stepwise as width shrinks, in the exact order coded in `subagent-activity.ts`: `+12 more (3 running, 9 queued)` → `+12 (3r, 9q)` → `+12 3r 9q` → `+12 3/9` → `12:3/9` → `3/9`.
- State glyphs are fixed per display state: `queued` renders `…`; the in-progress states render spinner frames (`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`); `completed` renders `✓`; `failed`/`rejected` render `✗`; `cancelled`/`operation-cancelled` render `⊘`; `discarded` renders `◇`; `paused`/`approval-needed` render `!`; `timed-out` renders `⌛`.
- Elapsed time is compact: under a second renders `123ms`, under a minute `42s`, otherwise `3m07s` (`formatElapsed`).
- Metadata is bounded: `activityMetadata` emits at most `task <id>` (sanitized to 80 characters), `code <code>` (sanitized workflow code), `attempt n/m` (only when both are safe integers and `m >= n`), `wait <reason>` (80 characters), and `next <action>` (sanitized control action).

---

## Display-State Vocabulary

`subagent-activity.ts` maps control-plane results to display states, and the mapping is the contract:

- Nonterminal states — `queued`, `preparing`, `connecting`, `waiting-first-response`, `running`, `validating`, `retrying`, `verifying`, `paused`, `approval-needed`, `applying`, `recovering` — never render as completed.
  They carry spinner or `…`/`!` glyphs, and a result in one of them must not be summarized with `✓`.
- `operation-cancelled` is not run success: a paused result whose `pause.code` is `operation-cancelled`, an operation of kind `operation-cancelled`, or a result state `operation-cancelled` all map to the `⊘` display state, distinct from `completed`.
- `discarded` and `rejected` are non-success terminal states (`◇` and `✗`), distinct from the success terminal state `completed` (`✓`).
- The expandable failure detail renders only allowlisted bounded diagnostics: the inline component shows a `reason:` line (sanitized to 240 characters) and, when expanded, the bounded `designFailure` diagnostics from `src/design-diagnostics.ts` — never raw error text.

Concrete example: a Design evidence packet that is cancelled mid-flight renders as `⊘` with reason `cancelled`, and the same packet later resumed renders as a spinner state again; neither ever renders `✓`, and no persisted flag is involved — the mapping is computed from the result each time.

---

## Startup Card Widget Rules

- The card is a string-array widget under `STARTUP_CARD_KEY` (`cadence-configuration`), set on `session_start` when `ctx.hasUI`, and cleared (set to `undefined`) on `agent_start` — when work starts — and on `session_shutdown`.
- RPC hosts render the string-array widget as plain lines; print and JSON hosts are silent because a widget is a UI-only surface.
- The card is never persisted: it is rebuilt from live configuration on every session start, it never activates a workflow, and it never records a dismissal (the `src/index.ts` registration comment says "Presentation only: never persist a dismissal or inject a model message").
- Content is code-owned labels and paths only (see `logging-guidelines.md` for the exact rules and the untrusted-project single-line form).

---

## Process Activity Projection

The process-backed runner emits transient JSONL events, but the TUI consumes only a bounded projection.
Tool names, elapsed time, attempt metadata, and terminal state may be displayed.
Raw child stdout, prompts, credentials, and full provider diagnostics must not be displayed.
A child process ending with `cancelled`, `timed-out`, or `failed` remains distinct from `completed`, even when it emitted an assistant message before exit.

The runner may invoke callbacks while the child is active.
Those callbacks are presentation-only: callback exceptions are swallowed at the boundary, and orchestration continues to the actual child result.
The widget must not persist event streams or infer workflow authority from progress metadata.

## Forbidden Patterns

- Never render a nonterminal display state with the completed glyph or wording, and never render `operation-cancelled`, `discarded`, or `rejected` as success.
- Never persist active display or timer state; the widget, spinner frame, and card are all in-memory and rebuilt per session.
- Never let a TUI callback failure propagate into orchestration: widget installation and `onUpdate` emission are wrapped, "A renderer callback is not part of orchestration."
- Never render raw configuration values, credentials, or unbounded error text in any widget; sanitize first (`sanitizeDisplayText`, `sanitizeWorkflowCode`, `sanitizeFailureReason`) and bound the detail to the allowlisted diagnostics.
- Never add a third persistent widget; new presentation belongs to the two existing surfaces or to a tool result rendered by the host.

---

## Common Mistakes

- Assuming the widget re-renders on its own; the controller drives renders (`requestRender`) on a 100 ms clock and on each state update, so a missed notification means a stale line until the next tick.
- Treating the startup card as configuration input; it is display-only and the user edits the `.env` file directly, with the next session start showing the new state.
- Letting a long task title wrap; the fix is to shrink the sanitized length cap in `activityMetadata`, not to change the terminal width handling.
