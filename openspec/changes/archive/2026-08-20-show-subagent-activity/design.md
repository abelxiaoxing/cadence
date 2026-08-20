## Context

See `proposal.md` for motivation and `specs/private-agent-orchestration/spec.md` for the approved behavior contract.

Cadence loads one private Pi extension from `src/index.ts`. Its `abel_dispatch` tool currently delegates every action to one process-local `Runtime`; `action=run` waits for a Scheduler outcome and returns raw structured content, details, and nested usage. The tool ignores Pi's partial-result callback and defines no custom renderers. Runtime request validation occurs before Scheduler admission, while the Scheduler alone knows when a validated request moves from `queued` to `running`. Child-session timeout and caller cancellation currently converge to error strings before the tool boundary.

Pi's installed extension API provides custom `renderCall`, `renderResult`, partial ToolResult updates, TUI-only Widget/status methods, renderer-local state, and official width-aware components. The package has no direct Pi TUI declaration today. Runtime state, retained diffs, child sessions, and the new active display state must remain process-local; the normal parent ToolResult may retain only approved compact terminal presentation metadata in TUI mode.

## Goals / Non-Goals

**Goals:**

- Feed accurate validated `queued`, admitted `running`, and typed terminal activity into both the current inline tool row and one temporary Widget without coupling Runtime or Scheduler to Pi TUI.
- Keep the existing model-facing ToolResult content and all non-TUI details byte-for-byte equivalent in shape and meaning.
- Make every rendered line width-safe and keep one bounded refresh loop regardless of active request count.
- Preserve scheduler admission, cancellation, timeout, redispatch, usage, retention, application, and drain semantics.

**Non-Goals:**

- Persisting or reconstructing an active queue, child conversation, child tool activity, or elapsed timer across Pi processes.
- Adding commands, settings, lifecycle events, public worker controls, Fleet navigation, or a child-session viewer.
- Replacing the existing scheduler, changing its concurrency policy, or making Runtime import TUI code.

## Decisions

### 1. Runtime lifecycle observation is a private per-invocation callback

`Runtime.execute()` will accept an optional private observer for `run` calls. After strict envelope validation and immediately before Scheduler scheduling, Runtime emits a `queued` event containing a cloned compact identity snapshot: request id, role, phase, objective, and one monotonic admission sequence. The Scheduler's execute closure emits `running` at the point where the entry has actually acquired an active slot, before phase authentication and child-session creation. Once the scheduled outcome settles, Runtime emits exactly one typed terminal event.

The observer is scoped to the accepted request object through the existing `runContexts` WeakMap entry rather than a process-wide event bus. The map value will carry both the existing RunContext and the observer. The observer is removed in the same `finally` block that currently removes RunContext, so repeated worker phases or equal request ids cannot receive another invocation's updates.

Observer exceptions will be caught and ignored at the Runtime notification boundary. Presentation therefore cannot reject, cancel, or otherwise alter a run.

Alternatives considered:

- Infer queue state around the tool Promise: rejected because a conflicting or saturated request would be shown as running before admission.
- Add a public event bus or status action: rejected because it creates a new orchestration surface and lifetime contract.
- Poll Scheduler internals: rejected because it duplicates state and makes ordering racy.

### 2. Terminal failure classification is typed below the display layer

The internal run failure union will carry `failureKind: "failed" | "cancelled" | "timed-out"` while preserving the existing `error` string. `runChildSession()` marks its own timeout explicitly; forwarded caller or Scheduler aborts are cancellation; validation, Provider, structural submission, and other failures are failed. Scheduler cancellation outcomes remain `cancelled`; Runtime maps them to the typed terminal observer event without changing the existing external DispatchResult.

The final non-TUI result still contains exactly the current fields. In TUI mode, `src/index.ts` appends one namespaced `activityDisplay` field to a shallow copy of the details after execution. The field contains only request id, role, phase, objective summary, terminal status, elapsed milliseconds, compact successful summary counts/text, or a sanitized failure reason. It never contains the complete `result`, diff, citations, Provider identity, paths, or child-session data.

Alternatives considered:

- Match timeout/cancellation strings in the renderer: rejected as unstable and capable of misclassifying Provider text.
- Keep terminal status only in renderer state: rejected because Pi could not reliably re-render the terminal state from the parent ToolResult.

### 3. One TUI-owned ActivityController coordinates partial rows and the Widget

The extension will create one process-local `ActivityController`. It accepts lifecycle events only when the tool's `ctx.mode` is `"tui"` and the request passed Runtime validation. Each active entry is keyed by Pi `toolCallId`, not request id, and records admission sequence, compact identity, state, start timestamp, and the current partial-update sink. This preserves independent rows for equal logical request ids and repeated phases.

The controller performs three responsibilities:

1. Translate lifecycle events into partial ToolResult details and invoke only that tool call's Pi `onUpdate` callback.
2. Maintain the active queued/running collection and refresh one above-editor Widget plus one `subagents` status line.
3. Produce the terminal `activityDisplay` metadata appended by the tool after `Runtime.execute()` settles.

The first active request installs one shared 100 ms timer. Each tick advances one spinner frame, refreshes elapsed values through partial updates, and requests one Widget render. The last terminal request clears the timer, Widget, status, and UI-context reference. Session start first clears stale controller state; session shutdown clears visible UI synchronously before awaiting Runtime drain and clears again afterward. The controller never calls Pi session persistence methods.

No controller or partial callback is constructed in print, JSON, or RPC mode. Those modes therefore execute the existing Runtime call and return the existing result object unchanged.

Alternatives considered:

- One interval per request: rejected because timer count would scale with concurrency and introduce teardown races.
- Use only a Widget: rejected because terminal state would disappear and foreground invocation would still be unclear.
- Use only tool partial updates: rejected because concurrently queued or running Agents would lack a persistent aggregate view.

### 4. Rendering uses official Pi TUI peers and width-aware components

The package will directly import `Text`, `truncateToWidth`, `stripTerminalSequences`, and `visibleWidth` from `@earendil-works/pi-tui`. It will declare `@earendil-works/pi-tui: "*"` as a peer and pin the installed development version in `devDependencies`; no ordinary dependency is added and no second TUI runtime is bundled.

`renderCall` always identifies the invocation as `Subagent` and, for valid run arguments, adds role, request id, phase, and a one-line objective. Non-run actions keep a compact `Abel Dispatch <action>` label. `renderResult` uses `activityDisplay` when present and otherwise falls back to the existing text, so pre-execution failures and non-TUI-restored data remain honest. Running partial details render the shared braille spinner, state, identity, elapsed time, and one objective line. Terminal details render status-specific styling; expanded success renders only approved evidence counts or diff summary, next step, risk count, and retained-result presence.

A small width-bounded component will compute each line at render time with `truncateToWidth`; it will not rely on `Text` wrapping for single-line contracts. Failure text is stripped of terminal sequences, collapsed to one whitespace-normalized line, bounded to the approved metadata, and then terminal-width truncated.

The Widget uses a component factory and reads current controller state at render time. It renders at most 12 lines total: one heading, two lines per visible request, and—when needed—one overflow line. It preserves admission order without grouping by state. The overflow line reports exact hidden counts as `+N more (X running, Y queued)`. All lines pass through `truncateToWidth` and are asserted with `visibleWidth(line) <= width`.

Alternatives considered:

- Copy a local width algorithm or component: rejected because ANSI and East Asian width behavior would diverge from Pi.
- Copy the reference Fleet and conversation viewer: rejected by the approved public-surface and privacy constraints.

### 5. Compact summaries are derived from validated result types

For a completed evidence result, the display stores only counts for conclusions, citations, risks, and blocking questions. For a completed diff result, it stores the validated `summary`, `nextStep`, risk count, and a boolean indicating that a retained result id exists. The objective, summary, next step, id, role, phase, and failure reason are normalized to single lines and width-bounded at render time.

The complete structured result remains in the existing ToolResult details for the parent Agent, exactly as before; custom rendering simply refuses to print its complete citations or diff. Rendering and Widget tests will include marker strings in complete diff/citation/path/model fields and assert that none appear in collapsed or expanded UI output.

### 6. Package and index impact remains narrow

Implementation will add `src/subagent-activity.ts` for display types, sanitization, controller, components, and renderer helpers; `src/index.ts`, `src/runtime.ts`, and `src/child-session.ts` will receive only the wiring and typed failure changes. The existing Scheduler execute closure already marks the exact admission boundary, so `src/scheduler.ts` requires no edit. `package.json` and `bun.lock` will declare the direct Pi TUI peer/dev surface. The exact tarball member sets in `test/distribution.test.mjs` and `scripts/pack-check.mjs` will include the new module.

The root AGENTS index currently routes child execution and scheduling but does not identify the new presentation owner or TUI boundary. It must be updated at the implementation checkpoint to route `src/subagent-activity.ts` and state that active display state is process-local and non-TUI behavior remains unchanged. No nested index is warranted because this is one file inside the existing `src/` context boundary.

## PBT Applicability

- **State-transition invariant (property):** for every valid transition trace, an admitted entry follows `queued -> running -> one terminal state`; invalid requests create no entry; terminal entries are absent from the active Widget; observer exceptions do not change Runtime outcomes.
- **Ordering and bound invariant (property):** arbitrary active sets render in admission order; every rendered line has visible width at most the supplied width; total Widget lines never exceed 12; hidden running and queued counts sum exactly to hidden active entries.
- **Mode non-interference (property/example):** for every non-TUI mode, adding presentation wiring produces no partial updates, Widget/status calls, or `activityDisplay` field, and the existing ToolResult content/details/usage are unchanged.
- **Usage and result invariants (existing properties/examples):** UI refresh count is independent of model call count; nested usage remains aggregated once; retained result and apply behavior remain unchanged.
- **Not applicable:** commutativity, associativity, monotonic business data, and round-trip serialization do not define this display's behavior. Exact status styles and summary examples are better covered by example/component tests.

## Risks / Trade-offs

- [Pi renderer and Widget APIs are peer APIs] → Declare the official peer, pin it for development, use only documented public exports, and run type, package, and real-tarball checks.
- [A display callback could throw during scheduling] → Catch observer and UI callback failures at their boundaries and test Runtime outcome non-interference.
- [Shared timer leaks after cancellation or shutdown] → Centralize timer ownership, clear it when active count reaches zero, and synchronously clear UI before shutdown drain.
- [Repeated request ids could overwrite activity] → Key active rows by Pi toolCallId and use an independent admission sequence.
- [Complete structured results remain in model-facing details] → Keep that existing delivery contract unchanged but ensure custom renderers persist and render only approved compact `activityDisplay` metadata.
- [Terminal text may contain hostile terminal sequences] → Strip terminal sequences, collapse whitespace, and width-truncate before rendering.
- [Adding one shipped source file changes exact package sets] → Update both independent tarball member lists in the same serial packaging task.

## Migration Plan

No runtime or persisted-data migration is required. Installation resolves the new Pi TUI peer through Pi's package environment. Rollback removes the activity module and wiring, the Pi TUI peer/dev declarations, package-list entries, tests, README presentation description, and the corresponding AGENTS route; existing orchestration results and saved parent sessions remain valid because renderers fall back to raw content when `activityDisplay` is absent.
