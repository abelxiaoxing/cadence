# History and diagnostics

Cadence has one engineering execution path: enter `/cadence`, discuss a goal and approve the exact plan.
History is evidence, not a second task manager or renewed execution consent.

## Current workflows

- In the conversation, open a workflow's steps to see actual checks, Agent review, delivery and failures.
  **Open subagent context** shows the retained transcript; **Read retained step result** reads the retained result rather than its clipped status preview.
- In the browser sidebar, expand **Workflow history** to find retained runs, including completed native-started work.
  The listing is paged in ID order, not chronological order.
  Larger histories show scan progress before a complete page; use **Continue reading history** in the browser or **Continue scanning** in Pi.
  An expired scan requires a fresh observation; it never deletes history or resumes execution.
  A new run may appear before a page you already read; return to the first page and refresh to observe it.
  An unreadable record stays visibly unavailable rather than disappearing or being repaired.
- In a trusted Pi terminal, `/cadence-history` lists workflows without asking a model.
  `/cadence-history <run-id>` opens one exact run directly.
  Use **Full result** or **Subagent transcript** for step evidence, and the arrow/page/Home/End keys to read long text.

The native history command only attaches to an already-running project owner; it never starts a service, selects a model, approves work, executes tools or cancels a run.
It remains usable without a selected model.
If no owner is available, use the explicit service commands in [Service management](service-management.md).
Known omitted or truncated source content is still omitted or truncated; viewing a full retained result cannot recreate unrecorded data.
Automatic Agent review is never human review, and a check's actual exit is independent of model prose.

## Existing task archives

The old `/cadence-inspect` interface and browser **Legacy task** creation route are removed.
Old create, Save, Generate, Start, check and human-Review requests are refused by the service, including from stale clients.
There is no feature flag to re-enable them.

Existing task summaries, private history and task-to-conversation links are preserved without migration, reset or cleanup.
Use **Retained task history** in `/cadence-history`, or select a retained task in the browser:

- Read recorded plans, runs, children, checks, changes and human Review evidence.
- Search the selected task/run/child scope with exact, case-sensitive literal search.
- Export that scope as Markdown or NDJSON.
  Native export requires an explicitly confirmed new destination and verifies the complete stream, digest, trailer and EOF.
  A browser download request alone is not proof that the download completed.

These task search/export formats do not apply to the separate workflow store; current workflows provide retained run/step results and transcripts instead.
A historical record cannot restart work or confer approval.

## Cancellation and uncertain outcomes

Leaving history, switching conversations/projects or closing a client only detaches.
For current work, use the conversation's explicit Cancel workflow action or ask Cadence to cancel in Pi.
Archived task IDs are not current process handles and cannot be canceled through the retired task API.
Orderly Stop of the exact running owner remains available separately; an older running owner must be stopped before switching implementations.
No history read clears locks, repairs uncertain state, retries execution or infers that missing observations mean work has stopped.
