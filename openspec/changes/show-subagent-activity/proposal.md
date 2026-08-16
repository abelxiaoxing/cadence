## Why

Cadence currently exposes Subagent execution only as the generic `abel_dispatch` tool with raw structured output, so interactive Pi users cannot clearly see that a package-owned professional Agent was queued, started, or completed. The TUI needs a bounded activity surface that makes delegation apparent without exposing private child-session data or changing orchestration behavior.

## What Changes

- Add a compact inline TUI presentation for each valid Subagent run, including role, request identity, phase, objective summary, elapsed time, and queued, running, completed, failed, cancelled, or timed-out state.
- Add a temporary above-editor Agents widget that aggregates active queued and running requests in stable admission order, accurately summarizes overflow, removes terminal requests, and clears itself when no requests remain.
- Keep expanded successful results compact: summarize evidence counts or diff metadata without exposing complete citations or diffs.
- Preserve print, JSON, and RPC output and event behavior, existing tool-result fields, scheduling, cancellation, usage, retention, and patch-application semantics.
- Keep active Widget and refresh state process-local; retain only approved compact terminal presentation metadata in the ordinary parent TUI ToolResult, while continuing to withhold child transcripts, tool activity, file paths, model identity, hidden reasoning, and complete results.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `private-agent-orchestration`: Add the user-observable TUI activity and privacy contract for private Subagent invocation while retaining the existing private orchestration boundary.

## Impact

- Affects the private extension presentation and lifecycle reporting around `src/index.ts` and the runtime/scheduler state transitions that feed it.
- Adds focused renderer/widget tests and extends lifecycle, cancellation, timeout, usage, and non-TUI compatibility coverage.
- May require a direct Pi TUI peer dependency for width-safe components; that choice remains a Gate B technical decision.
- Does not add a public Subagent API, command, Fleet, child-session viewer, transcript, persistent runtime state, or orchestration behavior change.
