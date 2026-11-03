# History and diagnostics

Cadence has one engineering execution path: enter `/cadence`, discuss a goal and approve the exact plan.
History is evidence, not a second task manager or renewed execution consent.

## Current workflows

- In the conversation, select a workflow's line to open its steps: actual checks, Agent review, delivery and failures.
  **Open subagent context** shows the retained transcript; **Read retained step result** reads the retained result rather than its clipped status preview.
- A workflow belongs to the conversation that started it, in the browser or in the terminal, and its line stays after the turn it started in.
  An active workflow is also listed under **Running conversations** in the browser sidebar.
- In a trusted Pi terminal, `/cadence-history` lists workflows without asking a model.
  The listing is paged in ID order, not chronological order; larger histories show scan progress first, and **Continue scanning** resumes it.
  An expired scan requires a fresh observation, and an unreadable record stays visibly unavailable; nothing is deleted, repaired or resumed.
  `/cadence-history <run-id>` opens one exact run directly.
  Use **Full result** or **Subagent transcript** for step evidence, and the arrow/page/Home/End keys to read long text.

The native history command only attaches to an already-running project owner; it never starts a service, selects a model, approves work, executes tools or cancels a run.
It remains usable without a selected model.
If no owner is available, use the explicit service commands in [Service management](service-management.md).
Known omitted or truncated source content is still omitted or truncated; viewing a full retained result cannot recreate unrecorded data.
Automatic Agent review is never human review, and a check's actual exit is independent of model prose.

## Shared conversation history

Browser conversations are the project's Pi sessions, the same files `pi -r` and `/resume` list in the terminal.
The browser sidebar lists sessions started in either place, newest first, and labels where each one started.
A conversation can be continued from either side: open it in the browser, or run `/resume` (or `pi --session <id>`) in the terminal.
Only sessions started in the project's root folder are listed, and only those of the account the service runs as.

Pi keeps a session as a tree.
When a message continues an earlier point, the session gains a branch instead of losing anything:

- In the browser, **Continue from here** under an earlier reply shows the conversation up to that point; the next message starts a new branch there.
- **Branches** in the conversation header opens the tree of messages; choose a line to read that branch, and **Show the latest** to follow the newest again.
- In the terminal, `/tree` shows the same tree.

A terminal holds its own copy of an open session.
If the browser continues it meanwhile, the terminal says so; run `/resume` and choose the session again to see those messages.
A message sent in the terminal first starts a new branch from where the terminal is.

Sessions are stored as Pi writes them, including tool output; the browser redacts the service's credentials from what it shows.
Browser conversations from before 2.0.31 are added to the shared history only when you choose **Add them to the shared history** in the sidebar; the old records are kept.

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
