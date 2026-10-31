# Cadence conversation mode

In a trusted Pi terminal or a WebUI conversation in an explicitly selected project, enter `/cadence <goal>` once (or `/cadence` to discuss the goal).
Cadence stays enabled for the entire conversation, including after a goal finishes.
Continue using normal messages; do not repeat the command for clarification or another goal.
Type `退出 Cadence` or `exit cadence` (in Pi also `/cadence exit`) to leave the mode explicitly.
Leaving, closing Pi/browser and switching conversations detach; they do not cancel accepted work.
Browser conversation mode is retained by the project owner, not by a browser-only toggle, and works without a live Pi terminal.

## Normal path

1. Cadence delegates focused readonly repository investigations, reuses existing project documentation, and consolidates questions in the main conversation.
2. Discuss requirements and decisions until the implementation and acceptance criteria are clear.
3. Cadence presents one readable plan: scope, dependencies, setup, baseline checks, acceptance checks, repair budget and delivery policy.
4. Type `按计划实施` after the plan to authorize those exact bytes.
   In the browser, click **Implement this plan** or send that exact approval phrase for the currently displayed plan.
   In Pi, the Start tool can alternatively present one native confirmation of the complete plan.
   Native confirmation retains its raw-terminal guard.
   Quoted/generated text, an old session entry and vague agreement are not approval; browser authentication alone is not consent.
5. The persistent owner implements, reviews, verifies and delivers within that boundary.
   Routine internal steps do not ask for more approval.
6. Completion returns the conversation to Cadence **ready**, not ordinary mode.
   Ask for status, more detail, cancellation, or the next goal normally.

Native mode is branch-aware; browser mode follows its server-owned conversation identity.
A saved native mode is active only in a trusted interactive terminal; print/RPC sessions keep ordinary tools and can still exit with `/cadence exit`.
In Pi, the agent panel lists workflow subagents and opens their transcripts; `cadence_status` can read one step's transcript.
Resume and compaction retain the mode/context, not execution grants.
Opening a different conversation does not enable Cadence there.
Restore never replays a command or automatically resumes an interrupted queue.
When an observation reply is lost, ask for status; do not infer that the action was absent.

## Models and project knowledge

The first native use defaults to the current Pi provider/model/API/thinking selection.
The selected preference is remembered in `<agent-dir>/cadence/settings.json` (normally `~/.pi/agent/cadence/settings.json`) and reused across projects.
Ask Cadence to change its model in Pi, or use **Model** in the browser.
The browser restores an available saved preference on explicit Send; reads/login do not install a choice.
If no usable preference exists, choose once; an unreadable preference file falls back to the current Pi model, and choosing a model rewrites it.
An accepted run keeps its original exact model.
An unavailable remembered model is not silently substituted.
Pi's original model and authentication sources remain authoritative; Cadence does not copy credentials.

Repository investigation and discussion do not edit business code.
Approved work publishes a managed region in `.cadence/project.md` and readable plan/result notes under `.cadence/assistant/workflows/<run-id>/`.
Existing human text outside the managed region is preserved.
Existing architecture and development documents should be referenced, not duplicated.
Each worker receives the approved goal/design/decisions/acceptance and its exact assignment; oversized context is refused rather than silently clipped.
Private proposals, grants, native/auth outcomes and transcripts stay outside the checkout.
Markdown is not execution authority.
Old task summaries and history are neither imported nor reset.

## Execution and delivery

The plan chooses one delivery policy:

- **Local merge:** requires an existing Git branch and configured commit identity.
  Independent tasks use separate worktrees, up to two at once; dependencies are applied before their consumers.
  The owner commits only declared file changes, integrates them into a separate candidate, runs independent readonly Agent review and real checks, then fast-forwards the unchanged target branch.
  Local task commits and the merge are included in the plan approval.
  Git hooks and commit signing are disabled for these internal commits; verification is explicitly declared instead.
  No remote push occurs.
- **Working copy:** explicit direct host-tool editing, serialized, including for non-Git directories.
  No commit or merge.
  Failed or canceled work leaves actual edits in place; this is not transactional application or a sandbox.

A local-merge plan does not adopt existing dirty inputs into its committed baseline.
Dirty declared targets refuse before implementation; unrelated user changes made during a run are preserved and do not block integration (Git refuses a genuine overlap).
A write path naming a directory covers the files below it; in Git, working-copy edits outside the declared writes fail the run (the edits stay).
Unresolved conflicts or a changed target stop integration.
Cadence never resets, stashes, force-pushes or silently cleans uncertain worktrees.
Ignored generated Markdown remains ignored and is published without forcing it into Git.
Clean worktrees are removed after a successful merge (plain `git worktree remove`, which also deletes their ignored setup output such as `node_modules`); dirty or moved ones and all results are retained.
Only one approved implementation runs at a time; approving a second while one is active is refused with `conflict`.
The 90-minute budget starts when the run acquires the checkout; Cancel/Stop never interrupt the final fast-forward (a hung `git merge` therefore delays Stop until Git exits).
Local-merge plans cannot declare files that Git ignores; use working-copy delivery for those.
After an owner restart, an unfinished run is shown as `unknown` with its retained worktrees; it is never resumed.
Credential-looking text in plans and research questions is shown and approved redacted.

An isolated worktree does **not** inherit ignored `node_modules`, build output, credentials or profiles.
Investigate prerequisites during planning.
If dependencies/setup are needed, include the exact commands in the plan for explicit approval.
No dependency/browser download or source-profile copying is implicit.
Baseline checks are separate from acceptance checks that need newly implemented files.
Failed declared baseline checks stop before editing.
At most two approved repair rounds may follow failed review/checks; repairs cannot expand scope or weaken acceptance.
Final candidate checks must pass before merge.
Post-merge failures remain failures and report the actual merge commit; no rollback is fabricated.
Automatic review is never recorded as human review.

To request orderly closure, ask Cadence to cancel in Pi, or use **Cancel workflow — request stop** in the browser (the browser coordinator cannot cancel).
A pending or unknown cancellation is not reported as stopped.
Failures, timeouts and unknown process/auth/storage outcomes remain distinct; unknown resources retain fences for explicit informed recovery.

## Service and compatibility

An explicit native mode entry/current user Send may start or reuse its local project owner on demand.
It does not install a system service, enable boot startup, select another account's credentials or expose a public listener.
Pi says once which command stops an owner it started; when Pi runs on Bun, Node must be on `PATH`.
An existing owner/configuration is reused, not silently replaced after a connection failure.
System-service installation and remote access remain separate explicit operations described in [Service management](service-management.md) and [Remote access](remote-access.md).

`/cadence-history [run-id]` provides readonly diagnostics without model calls or service startup; see [History and diagnostics](history.md).
The WebUI uses the same execution engine with a separate, context-bound browser confirmation path.
Its main composer stays in the same conversation; the plan card, workflow progress and actual merge outcomes appear inline.
Research, implementation and review subagents are listed in the lower-left **Subagents** dock, together with legacy task children; selecting one (or **Open subagent context** on a step) opens its full transcript and retained result in the main area, and **Back to conversation** returns.
Active workflows are listed under **Running conversations** with **Cancel workflow — request stop**; this includes native-started workflows, and an unavailable observation is not proof of no work.
The old task creation/Save/Start/check/human-Review controls are retired on both clients and refused by the service.
Existing task records remain readonly; they are not converted into workflows.
Existing browser conversations enter the new mode only on explicit Send/activation; old tasks and Pi transcripts are not converted or imported.
Approval grants are neither stored in the browser nor restored after restart.
Losing a response only observes its original command/run identity; it never retries execution.
Exit does not stop accepted work, and **Cancel workflow — request stop** remains independent of conversation mode.
There is no generic browser shell/PTY, service management/recovery or checkpoint pause/resume feature.
Conversation response completion is distinct from workflow completion; read the workflow card for actual delivery/check outcomes.

### Research scope, timing and retained results

Each research call accepts one or two questions and optional specific `roots` (default: the selected project directory).
Provide the actual investigation directory, especially for large mounted/backup trees; do not begin by enumerating `/` or broad parent directories.
Research tools are readonly and bounded.
Search limits and omitted coverage are reported explicitly; a partial search does not prove that no other matching file exists.
The bounded `grep` tool searches literal text, not regular expressions.
No files are copied to accelerate research.

Separate runs in one project wait for the shared checkout gate; questions inside a run can overlap.
The worker's total process deadline includes model and tool time, is not an inactivity timer, and is not renewed by progress.
A timeout that confirms direct-child close does not prove all descendants stopped, nor does it prove any survived.

Research replies include `runId` and step identities.
Ask for `cadence_status` with the exact `runId`, `stepId`, and optionally `transcript: true` to inspect an earlier result after another run.
Selecting a retained run is readonly and does not replace the current run or restart work.
Native status/history and the browser's **Owner timing and runtime** details show the actual owner build/epoch and recorded queue/worker timestamps; the worker SDK version can differ from the terminal Pi host.
A parent session may record a whole batch of tool results together, so those timestamps are not the service's completion times.
