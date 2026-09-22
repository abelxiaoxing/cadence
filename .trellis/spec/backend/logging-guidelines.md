# Logging Guidelines

> How the Cadence backend reports: bounded, secret-free diagnostic projections instead of free-form logging.

---

## Overview

The package has no log stream: it runs inside the Pi session, and everything it shows must be either part of a tool result, part of the TUI, or a read-only operator inspection.
So "logging" means bounded diagnostic projection — fixed field sets, code-owned correction text, redaction, and hard byte/entry caps — produced by a small set of named functions that the rest of the codebase is expected to use.

---

## Design Diagnostics

`src/design-diagnostics.ts` projects any Design failure into `SafeDesignDiagnostic`, a record of strings/booleans/string-arrays:

- Allowed keys are an allowlist of identities (`taskId`, `phase`, `field`, `category`, `owner`, `verificationId`, `acceptanceId`, `outputId`, `dependencyTaskId`, `producerTaskId`, `producerPhase`, `command`, `reason`, `systemCode`, `exitCode`), each value matched against a bounded code pattern; anything else is dropped, not rendered.
- Path values must pass `isValidRelativePath` and contain no Cc/Cf control characters; path arrays are deduplicated, canonically sorted, capped at 32, and flagged with `pathsTruncated: true` when they were not.
- Guidance is code-owned: the `HINTS` map gives each diagnostic code its correction text, e.g. `public-impact-incomplete` → "Public impact requires non-empty searchEvidence, relatedTests and affectedSuite; every affectedSuite path must have a relatedTests entry.
  Keep the actual changedSurfaces; do not substitute none."
- `DesignPlanValidationError` normalizes its diagnostics (dedupe + canonical sort) at construction, so identical failure sets produce identical projections in `src/index.ts` tool results and in `src/subagent-activity.ts`.

---

## Verification Diagnostics

`src/verification-diagnostics.ts` owns the only path from raw execution output to display:

- `diagnosticText(value, maximum = 4096)` strips ANSI sequences and redacts secrets: `Bearer <token>` → `Bearer [redacted]`, `(api_key|token|password|secret) <sep> <value>` → `[redacted]`, and `http(s)://user:pass@host` → `http(s)://[redacted]@host`; over-long text is cut to half the cap at the head and half at the tail with a `…[truncated]…` marker.
- `VerificationFeedback` is operation-local: it observes verification results, drops entries that were accepted or cancelled, and keeps at most 32 entries; `current()` returns at most 4 failure lines (256 bytes each), 512 bytes of stdout and 1024 bytes of stderr per entry, with a `truncated` flag.
- The module comment states the boundary: "Diagnostic text is evidence for repair, never a failure identity or authority."
  Failure *identity* comes from the closed code arrays in `src/contracts.ts`; the text only explains.

---

## TUI Display

`src/subagent-activity.ts` is the only place that renders activity, and it renders sanitized, width-bounded projections:

- Display text passes through `sanitizeDisplayText` (task IDs capped at 80 characters) and `sanitizeWorkflowCode` before any line is built; lines are truncated to the terminal width, and the overflow summary degrades stepwise ("+12 more (3 running, 9 queued)" down to "3/9" as width shrinks).
- Expandable Design failure diagnostics come from the `designFailure` detail produced by the tool-result projection in `src/index.ts` — the same bounded `SafeDesignDiagnostic`, allowlisted and code-hinted, not raw error text.
- TUI failures are isolated from the run: widget installation and observer callbacks are wrapped in try/catch with the comments "TUI failures are deliberately isolated from the run." and "A renderer callback is not part of orchestration."

---

## Startup Configuration Card

`src/startup-card.ts#startupCardLines` displays a nonblocking, secret-free research-configuration card:

- Only code-owned labels and paths enter the UI: the selected (or expected) configuration path, and per-service status labels (for example "anonymous mode, no key required", "key configured", "awaiting configuration", "disabled").
  Values, endpoints, models, parser errors, and credentials from the configuration file never appear — the catch-all failure line is the fixed string "research configuration could not be read or parsed: please check the configuration file; no fallback to another configuration was made."
- The card is shown on every UI session load/reload/resume (`pi.on("session_start")` when `hasUI`), cleared when work starts (`agent_start`) and at `session_shutdown`, never activates a workflow, and never persists a dismissal.
- RPC hosts render it as a string-array widget; print/JSON hosts stay silent (the widget is a UI-only surface).
- An untrusted project yields a single fixed line and no configuration read at all.
- `test/startup-card.test.ts` covers presentation, trust, repeated loads, and activation isolation.

---

## Operator-Only Inspection

`src/operator-tools.ts` (entry `src/operator-cli-entry.mjs`, generated as `src/operator-cli.mjs`; run via `bun run doctor <root>` or `bun run runs <root>`) is read-only:

- `doctor` reports environment checks with selection provenance: it selects the package manager from the project declaration or an unambiguous lockfile and reports that provenance, and never silently resolves multi-manager ambiguity.
- `runs` reads the owner-private run storage and prints run records.
- Neither command mutates state, opens a network channel, or starts a stage.

---

## What Is Never Logged or Persisted

- Request headers are observation only: `src/child-model.ts` exposes an `onHeaders` observer so the transport budget can schedule its first-progress timer, and nothing downstream records header contents.
- Active display/timer state is never persisted: `src/subagent-activity.ts` keeps its entries in memory with a 100 ms refresh, and the startup card widget is rebuilt from live configuration on each session start.
- Credentials never leave the environment: `config/routes.example.json` references custom credentials only by environment-variable name (`apiKeyEnv`), and the research `.env` file is local-only ("Keep this file local and never commit it" is the header of the template written by `src/install-config.mjs`).
- Usage is bounded: evaluation traces (`scripts/workflow-evaluation.mjs`) freeze operation/stage/usage records at the deadline instead of appending to a growing log.

---

## Forbidden Patterns

- Never display, store, or return raw transcripts, raw HTTP responses, or un-redacted error text; `diagnosticText` is the only sanctioned transformer.
- Never let a user configuration file contribute values to the UI; the startup card renders code-owned labels and paths only.
- Never use diagnostic text as a key, identity, or decision input; identities are codes, hashes, and IDs from the closed vocabularies in `src/contracts.ts` and `src/design-diagnostics.ts`.
- Never add a persistent log file to the consumer workspace; durable records go to the owner-private SQLite stores (see `database-guidelines.md`) and operator inspection stays read-only.

---

## Common Mistakes

- Logging a provider error `message` directly into a tool result; the provider text must pass `classifyProviderFailure` (`src/child-budget.ts`) into a bounded failure kind first, and any excerpt must pass `diagnosticText`.
- Reading an unbounded configuration file; the shared loader (`skills/_shared/load-config.mjs`) enforces a 64 KiB regular-file bound with a nonblocking open, and the startup card reuses it so startup can never hang on a FIFO or a huge file.
- Persisting "the user dismissed the card" or "the spinner was at frame 4"; both are ephemeral by design and would mislead the next session.
