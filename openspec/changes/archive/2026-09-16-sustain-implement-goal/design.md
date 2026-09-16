## Context

The engine owns durable work and four shared Worker slots. The parent owns technical decisions and amendments. Prompt instructions alone cannot ensure that the parent follows a nonterminal control response, and a generic paused response does not identify which parent investigation can make progress.

## Goals / Non-Goals

Goals are to complete actionable work without repeated user continuation messages, make Design the user decision stage, and retain safe parallel execution and verification. Non-goals are unlimited retries, automatic stage activation after reload, scope expansion, changing accepted behavior, or hiding external failures.

## Decisions

1. Keep workflow transitions in the state machine. The host reads current status and schedules a parent turn; it does not perform amendments or authorize candidates itself.
2. Bind continuation to an explicitly activated Implement change and workspace. Honor cancellation, exit, interrupted model turns, and pending user input before queueing a continuation.
3. Measure progress from semantic work evidence and successful artifact revisions. Repeated status reads, operation IDs, and unchanged failed requests cannot perpetually restart a stopped parent.
4. Keep the accepted ChangeContract stable. Design presents its amendment policy separately from exact initial phase writes, and plans independent tasks with explicit integration dependencies.
5. Keep recovery recommendations conditional on current evidence and remaining budgets. A recommendation is not permission to execute an invalid command or reset consumed work.

## Risks / Trade-offs

Automatic continuation can otherwise compete with user steering or run an unchanged loop. Lifecycle tests cover those boundaries and completion of an amendment remains distinct from completion of the Implement run. Static Design review cannot guarantee later service availability; unresolved external prerequisites remain truthful blockers.

## Verification

Use deterministic parent-host lifecycle tests, including a real Pi session with a synthetic provider, alongside real workflow-engine tests for durable recovery. Run Design summary and activation regressions, full package verification, strict OpenSpec validation, traceability, and applicable Linux isolation contracts. Record executed evidence after completion; these engineering artifacts do not manufacture Gate or delivery receipts.
