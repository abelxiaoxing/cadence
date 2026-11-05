# Cadence conversation mode

In a trusted Pi terminal or a WebUI conversation in an explicitly selected project, enter `/cadence <goal>` once (or `/cadence` to discuss the goal).
Cadence stays enabled for the entire conversation, including after a goal finishes.
Continue using normal messages; do not repeat the command for clarification or another goal.
Type `退出 Cadence` or `exit cadence` (in Pi also `/cadence exit`) to leave the mode explicitly; in the browser the composer's **Cadence mode** switch enters it on the next Send and leaves it when on.
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
The browser and the terminal share the conversation itself (it is the same Pi session), but each keeps its own Cadence mode and plan approval: entering Cadence in one does not enter it in the other.
A workflow started in either place appears in that conversation in the browser as one line after the turn it started in.
A saved native mode is active only in a trusted interactive terminal; print/RPC sessions keep ordinary tools and can still exit with `/cadence exit`.
In Pi, the agent panel shows only running subagents belonging to the current conversation, not other Pi conversations in the same directory.
With an empty focused input, press ↓ to choose a running agent and Enter to read it; ended agents leave the list automatically.
A transcript you already opened stays readable when its agent finishes, without further background queries.
With none running, ↓ stays with the editor.
Completion keeps a compact summary; use `/cadence-history` (or `cadence_status` for one step) when you explicitly need retained results/transcripts.
Resuming the same Pi conversation can observe its ongoing work; new and forked conversations do not inherit that live display.
Resume and compaction retain the mode/context, not execution grants.
Opening a different conversation does not enable Cadence there.
Restore never replays a command or automatically resumes an interrupted queue.
When an observation reply is lost, ask for status; do not infer that the action was absent.

## Resume a sent conversation on another device

Open the same authenticated workbench on the other device with the **complete conversation link**: `/app?project=<project-key>#chat=<session-id>`.
The project and chat identities in that link select the same server-held conversation even with empty or blocked browser storage.
Its sent history, Cadence mode, working directory, model preference and linked work come from the service, not from the first device's pending-send display.
A link grants neither access nor plan approval: authenticate normally and make any new execution confirmation explicitly.
Without that complete link, the other browser is not promised an automatic return to the first browser's last conversation.

Opening the link only observes; browsing never prepares or starts the project's execution service.
Only an explicit **Send** may prepare it on demand.
Leaving, closing or disconnecting a viewer does not cancel accepted work; reconnecting does not resend a message, resume an interrupted queue or inherit approval.
A stale or unavailable observation keeps readable history but cannot establish that work stopped; distinguish connection freshness from the workflow's last observed status.

Unsent text and images are not synchronized across devices.
Text drafts are local to that browser session when storage is available; images remain local to the tab.
A preparation failure keeps the local draft and explains whether preparation was never dispatched, is unconfirmed, or was confirmed before a later wait failed.
An uncertain final Send keeps its original command identity for observation only: do not send it again merely because its reply was lost.

## Images in the WebUI

Use **Add images**, paste a screenshot, or drop image files onto the composer.
Preview and remove images before Send; a message can contain images without text.
PNG, JPEG and WebP are supported.
Cadence imposes no image count or size limit; available browser/host memory and the selected model provider still constrain what can be sent.
Choose a model whose catalog supports image input.
An incompatible model refuses the message rather than dropping its images.
Ordinary and Cadence conversations use the same image input.
Images alongside an approval phrase are a discussion message, not plan approval.

Selecting images is local to the tab and does not upload or start execution.
Only Send uploads them, bound to that exact conversation, branch, model and message; navigating away abandons an unsent continuation, never an admitted turn.
Unsent pictures are not saved in browser storage and disappear on refresh; the text draft remains.
After Pi records a sent image, it appears in the conversation history and remains viewable after refresh (including retained reads when the project owner is stopped).
Click a history thumbnail to open it at full size.
Unsupported media from existing Pi sessions remains omitted; unavailable images show a notice without changing their session files.
Images are private conversation content, not public download links.
Text redaction does not sanitize words or secrets inside pixels: inspect screenshots before sending them to a model.

## Models and project knowledge

The first native use defaults to the current Pi provider/model/API/thinking selection.
Each conversation keeps its own working directory and exact provider/model/API/thinking preference.
Ask Cadence to change its model in Pi, or use the model button beside the browser composer; it changes future messages and plans in that conversation, not other conversations or admitted runs.
An explicit model choice is also remembered in `<agent-dir>/cadence/settings.json` (normally `~/.pi/agent/cadence/settings.json`) as the default for new conversations across projects; restoring an existing conversation does not replace that default.
The browser restores an available saved preference on explicit Send and shows it dimmed until then; reads/login do not install a choice.
With no choice and no saved preference, Send opens the model list and sends the message right after the choice.
If no usable preference exists, choose once; an unreadable preference file falls back to the current Pi model, and choosing a model rewrites it.
An accepted message or workflow keeps its original directory and exact model, including while queued.
Different subdirectories of one repository can have independent conversations while sharing one checkout owner and execution gate.
Tools and check commands use the conversation directory; a plan's declared write paths stay relative to the displayed checkout root, including in isolated Git worktrees.
Changing the current conversation's model makes its older unaccepted plan require fresh planning/approval; changing another conversation's model does not.
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
Failures, timeouts and unknown process/auth/storage outcomes remain distinct; an owner that cannot settle unknown work restarts itself and recovers automatically.

## Service and compatibility

An explicit native mode entry/current user Send may start or reuse its local project owner on demand.
It does not install a system service, enable boot startup, select another account's credentials or expose a public listener.
Pi says once which command stops an owner it started; when Pi runs on Bun, Node must be on `PATH`.
An existing owner/configuration is reused, not silently replaced after a connection failure.
System-service installation and remote access remain separate explicit operations described in [Service management](service-management.md) and [Remote access](remote-access.md).

`/cadence-history [run-id]` provides readonly diagnostics without model calls or service startup; see [History and diagnostics](history.md).
The WebUI uses the same execution engine with a separate, context-bound browser confirmation path.
Its main composer stays in the same conversation; the plan card appears inline, and each workflow is one line after the turn it started in, showing what it is doing (with **Stop**) or how it ended: its merge commit, or the reason it did not complete.
Select the line to open the workflow's steps, checks, delivery and diagnostics in the main area; while it runs, the conversation's status names its phase.
Research, implementation and review subagents are listed in the lower-left **Subagents** dock, together with legacy task children; selecting one (or **Open subagent context** on a step) opens its full transcript and retained result in the main area, and **Back to conversation** returns.
Active workflows are listed under **Running conversations** with **Cancel workflow — request stop**; this includes native-started workflows, and an unavailable observation is not proof of no work.
The old task creation/Save/Start/check/human-Review controls are retired on both clients and refused by the service.
Existing task records remain readonly; they are not converted into workflows.
Existing browser conversations enter the new mode only on explicit Send/activation; old tasks are not converted into workflows.
Approval grants are neither stored in the browser nor restored after restart.
Losing a response only observes its original command/run identity; it never retries execution.
Exit does not stop accepted work, and **Cancel workflow — request stop** remains independent of conversation mode.
There is no generic browser shell/PTY, service management/recovery or checkpoint pause/resume feature.
Conversation response completion is distinct from workflow completion; read the workflow's line and view for actual delivery/check outcomes.

### Research scope, timing and retained results

Each research call accepts one or two questions and optional specific `roots` (default: the conversation directory).
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
