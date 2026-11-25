# Cadence conversation mode

In a trusted Pi terminal or a WebUI conversation in an explicitly selected project, enter `/cadence <goal>` once (or `/cadence` to discuss the goal).
Cadence stays enabled for the entire conversation, including after a goal finishes.
Continue using normal messages; do not repeat the command for clarification or another goal.
Type `退出 Cadence` or `exit cadence` (in Pi also `/cadence exit`) to leave the mode explicitly; in the browser the mode switch beside **Send** sets whether your next message uses Cadence without sending immediately: turning it on enters Cadence when you send your next message, and turning it off exits Cadence and sends your next message as an ordinary turn.
Leaving, closing Pi/browser and switching conversations detach; they do not cancel accepted work.
Browser conversation mode is retained by the project owner, not by a browser-only toggle, and works without a live Pi terminal.

## Normal path

1. Cadence delegates focused readonly repository investigations, reuses existing project documentation, and consolidates questions in the main conversation.
2. Discuss requirements and decisions until nothing that changes the result is left open.
   This is the last time you are asked: what Cadence decides on your behalf is listed in the agreement as its assumptions.
3. Cadence presents one readable delivery agreement: expected result, high-level technical design, acceptance, decisions, assumptions, setup/check commands, managed dependency links, documents to update and delivery policy.
   In the browser, use **View current plan** beside the conversation title.
   The proposal stays in this conversation; you can keep discussing it and reopen it there, including after refresh.
   Open **Technical details** for paths, commands, managed links, the exact binding and agreement.
   Opening or closing the proposal does not validate or approve it.
   After approval the service first runs a readonly route planner against the isolated candidate to split parallel tasks and write scopes, then finishes on its own: it repairs and re-plans, may bring further files of the repository into the write scope (never credentials, keys, `.env`, `.git` or anything outside the repository), and installs dependencies only if the agreement says revisions may.
   If an acceptance item proves impossible it delivers the closest achievable result and records the deviation: what could not be met, why, what was delivered instead and any declared check set aside because of it.
   The automatic review must confirm each deviation, and a run that deviated says so first when it completes; the task branch is kept, so the merge can be undone.
4. Type `按计划实施` after the plan to authorize those exact bytes.
   In the browser, review the proposal from the conversation title, then click **Implement this plan** or enter and send the exact approval phrase.
   The phrase belongs to the proposal and context you reviewed.
   If either changes, or a reload restores only the text, the old phrase stays in the editor: it neither approves nor sends a message.
   Opening the new proposal does not transfer that approval; use its button or enter the phrase anew.
   If execution is stopped or its plan binding is outdated, this first restores and validates the plan instead; review the updated context and choose **Confirm implementation** afterward (see below).
   In Pi, the Start tool can alternatively present one native confirmation of the complete plan.
   Native confirmation retains its raw-terminal guard.
   Quoted/generated text, an old session entry and vague agreement are not approval; browser authentication alone is not consent.
5. The persistent owner implements, reviews, verifies and delivers.
   Nothing asks for more approval.
   It stops early only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, an installation the agreement does not allow, or a missing tool.
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

## Restore a saved plan without sending a message

A stopped or restarted execution service does not require another discussion or a model-generated replacement plan.
**View current plan** shows the conversation's current proposal even when you are reading an older branch; return to the latest branch to validate or approve it.
Use **Restore execution and validate plan** on the plan card; if the service is already running, **Validate plan again** refreshes its execution context.
The exact `按计划实施` input follows the same validation path when the service or model binding is not current.

Validation may start or reuse the selected project's owner and applies the model shown in the composer, without substituting another model or changing the account's default.
It keeps the plan content, records a fresh execution binding and leaves the original snapshot intact.
It sends no chat message, calls no model, creates no task branch/worktree and approves no implementation.
Review the displayed model, runtime and target branch; changed environment evidence is labelled, and this tab also shows the previous context for comparison.
Then click **Confirm implementation** or enter a fresh approval phrase for the revalidated proposal.
A current plan remains directly approvable; validation is not an extra step for every ordinary approval.

An unknown turn outcome, unreadable plan, changed conversation or unavailable selected model still blocks safely.
If an approval reply is lost, the page observes its original request rather than submitting another execution; reloading does not repeat it.
Browsing, reconnecting and choosing a model alone never start the execution service.
`CADENCE_AUTOSTART=0` still refuses on-demand startup, not healthy reuse.

## Messages while a reply is running

An ordinary browser turn starts independently of turns in other Pi sessions, even in the same directory.
**Starting** means the service has accepted the turn and is preparing it, not that it is queued or the model has replied.
You can stop it without stopping the other sessions.
Only one browser run at a time is allowed in a session.
If the owner refuses a new Send (for example because storage is full), no turn is created; your draft stays editable and nothing sends it later.
The owner does not limit how many sessions have a turn running.

The service accepts a further message for a reply that is still running, in one of two ways.
A **steer** reaches the model at its next opportunity, after the tool calls in progress and before its next request, and continues the conversation as its own turn from there.
A **queued** message waits and is sent once the reply has ended normally.
Either one uses the running reply's directory and model, carries no images, and is never read as plan approval, mode entry or exit.
A queued message that is still waiting can be withdrawn; a steer is in the model's queue as soon as it is accepted.
If the reply fails, is stopped or the service restarts first, a waiting message is not delivered and nothing sends it later: the conversation says which messages were left, and you send one again if you still want it.
Stopping the reply stops all of it, including what was sent into it.
In the browser, type while the reply runs: **Enter** steers, **Alt+Enter** queues, and the two buttons beside Stop do the same.
Waiting messages are listed under the conversation with a control to withdraw each one, or to withdraw it and put its text back into the message box; a message left undelivered offers its text back the same way.

## Resume a sent conversation on another device

Open the same authenticated workbench on the other device with the **complete conversation link**: `/app?project=<project-key>#chat=<session-id>`.
The project and chat identities in that link select the same server-held conversation even with empty or blocked browser storage.
Its sent history, Cadence mode, working directory, model preference and linked work come from the service, not from the first device's pending-send display.
A link grants neither access nor plan approval: authenticate normally and make any new execution confirmation explicitly.
Without that complete link, the other browser is not promised an automatic return to the first browser's last conversation.

Opening the link only observes; browsing never prepares or starts the project's execution service.
Only an explicit **Send** or plan-validation action may prepare it on demand.
Leaving, closing or disconnecting a viewer does not cancel accepted work; reconnecting does not resend a message, resume an interrupted queue or inherit approval.
A stale or unavailable observation keeps readable history but cannot establish that work stopped; distinguish connection freshness from the workflow's last observed status.

Unsent text and images are not synchronized across devices.
Text drafts and pending model choices are local to that browser session when storage is available; images remain local to the tab.
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
A confirmed model choice is also remembered in `<agent-dir>/cadence/settings.json` (normally `~/.pi/agent/cadence/settings.json`) as the default for new conversations across projects; restoring an existing conversation does not replace that default.
The WebUI can list and select models as soon as it opens, even before choosing a folder or starting the project's execution service.
This is a readonly view of Pi's configured models, not a provider connectivity check; opening the list never starts execution, calls a model or refreshes credentials.
Before execution is ready, a model/thinking choice stays with the local draft.
A choice on the folder-less entry carries into the next new conversation you open.
Send starts or reuses the project service, verifies that exact selection and only then submits the message; if it is unavailable, the draft stays and no other model is substituted.
Reopening the picker reads the current configuration again without starting execution.
A preview read failure has a **Read again** action, not a requirement to start a service.
The browser restores an available saved preference on explicit Send or plan validation and shows it dimmed until then; reads/login do not install a choice.
With no choice and no saved preference, Send opens the model list and continues the original message after your choice when the same service connection is ready.
Closing the picker or stopping/replacing that service ends the unsent continuation; your draft stays, and choosing a model never restarts a stopped service.
Exiting Cadence changes mode, not your pending model choice.
If no usable preference exists, choose once; an unreadable preference file falls back to the current Pi model, and choosing a model rewrites it.
An accepted message or workflow keeps its original directory and exact model.
Conversations in different subdirectories of one checkout share the same owner, not one working directory.
Tools and check commands use the conversation directory; a plan's declared write paths stay relative to the displayed checkout root, including in isolated Git worktrees.
Changing the current conversation's model makes its older unaccepted plan require fresh validation and approval in the browser, not another chat message; changing another conversation's model does not.
An unavailable remembered model is not silently substituted.
Pi's original model and authentication sources remain authoritative; Cadence does not copy credentials.

Repository investigation and discussion do not edit business code.
Approved work maintains the relevant existing project documents named in the agreement and publishes readable workflow notes under `.cadence/assistant/workflows/<run-id>/`.
`.cadence/project.md` is a compact knowledge index; optional `.cadence/knowledge/` topics fill gaps, not duplicate existing `engineering/`, `docs/` or `.trellis/spec/`.
Human text and unrelated conventions are preserved.
Workers receive actual selected project knowledge, the approved goal/decisions/acceptance, their assignment and relevant failure/check evidence.
Source paths and partial coverage are recorded; longer documents remain available for on-demand reads.
After implementation, Cadence extracts useful source-backed lessons and updates approved documentation automatically, then checks and reviews the combined candidate.
No knowledge-maintenance or finish command is required.
Private proposals, grants, native/auth outcomes and transcripts stay outside the checkout.
Markdown is not execution authority.
Old task summaries and history are neither imported nor reset.

## Execution and delivery

The plan chooses one delivery policy:

- **Local merge:** requires an existing Git branch and configured commit identity.
  After approval, each delivery creates its own `cadence/<goal>-<run-id>` branch and one stable worktree; mode entry and research create neither.
  Assignments that neither depend on one another nor write the same file run side by side, each in a temporary worktree beside it, with no limit on how many run at once.
  Assignments, diagnosis, recovery and knowledge updates reuse that candidate, preserving partial work.
  The target is the current local branch displayed in the agreement, not necessarily `main`; the conversation stays in its original directory.
  The agreement binds that branch, not a commit of it: the run starts from the branch's head when it is admitted, and another delivery landing in the meantime does not make a plan you have not approved yet go stale.
  The owner commits only declared file changes, runs independent readonly Agent review and real checks, then moves the target branch to that exact commit.
  Local task commits and moving the target branch are included in the plan approval.
  Git hooks and commit signing are disabled for these internal commits; verification is explicitly declared instead.
  No remote push occurs.
- **Working copy:** explicit direct host-tool editing, serialized among workflows, including for non-Git directories.
  No commit or merge.
  Failed or canceled work leaves actual edits in place; this is not transactional application or a sandbox.

A local-merge plan works from committed history: uncommitted changes in your checkout are not its input and do not stop it from starting.
When it lands, uncommitted and staged changes to other files are kept as they are by Git's own fast-forward, and no other file of yours is touched.
Uncommitted changes to the very files the delivery changes are carried over onto the new commit instead of stopping it.
Those files are first saved as they are (staged state, worktree state and untracked files of the same name) in a commit under the private reference `refs/cadence/wip-backup/<run-id>`; your own stash list is not used.
Then each is brought forward: where Git can merge your change with the delivered one it does, and what you had staged stays staged; a file a declared build derives takes the delivered version; a file one side deleted, or that is not text, stays as you had it, as an uncommitted change against the delivered one; and text both changed is reconciled by a worker in a copy of its own, never in your checkout, with a file it cannot settle handed back to you holding both versions between Git's conflict markers.
The result names every such file and what was done with it.
`git show refs/cadence/wip-backup/<run-id>:<file>` prints a file as it was, and `git stash apply --index refs/cadence/wip-backup/<run-id>` puts all of them back once those files have no uncommitted changes; the reference is deleted, by its exact commit, 30 days after the run settled.
Bytes that `git update-index --assume-unchanged` or `--skip-worktree` hide are carried over the same way, and the flag is left on.
A write path naming a directory covers the files below it; in Git, working-copy edits outside the declared writes fail the run (the edits stay).
A target branch that moved while the delivery worked, through another delivery or your own commits, is followed: the delivery's single commit is replayed onto the branch's current head and checked and reviewed again as the commit that will land.
Conflicts are settled in three layers, the cheapest first.
What a declared build derives is never merged: outputs a build writes as a whole are left as the branch has them and rebuilt from the merged sources, and a file a build only refreshes (a table of content hashes) has its values recomputed on all three sides before it is merged, so only entries both sides changed are left.
The same file changed in different places merges by itself.
Lines Git cannot merge go to a worker that is given both versions and what the branch gained, and has to keep what both sides do; it edits only those files, and the delivery does not continue while a line Git marked is still there.
If that does not produce something that passes, recovery may give the merge up and do the work again on the branch as it is now.
The merged commit is then checked with this agreement's checks and with the checks of every delivery that landed on the same source files in the meantime, and the review reads what the branch gained (the `changes` tool's `frontier` scope) to confirm none of it was dropped.
`AGENTS.md` files changed on the branch in the meantime are put before that review, which judges the candidate against their current text.
Verified work is never thrown away: when nothing can be put on the branch (it was deleted, no merge with what it gained passes verification, or your checkout has an uncommitted submodule pointer or a file where the delivery has a directory of the same name), the last commit that passed checks and review is delivered on the task branch, the run completes, and its result says first that it was not merged, why, and the `git merge` command that takes it in.
Cadence never force-pushes, never uses your stash list and never silently cleans an uncertain worktree; the only files of yours it rewrites are the ones a landing changes that you had uncommitted changes to, and only after saving them under the private reference above.
Ignored generated Markdown remains ignored and is published without forcing it into Git.
The named task branch is kept.
Only owned worktrees at the delivered commit, after it landed and without any residue, are removed with plain `git worktree remove`.
Ignored setup/build output such as `node_modules` also retains the worktree; failures, cancellation and unknown outcomes never trigger cleanup.
Separate WebUI or terminal conversations may run independent local-merge workflows concurrently; the owner does not limit how many runs or investigations are active.
Shell steps (setup, builds and checks) of all runs are admitted by what the machine can take right now: a `heavy` check counts as four cores and 2 GiB, any other step as one core and 512 MiB, and a step that does not fit waits in arrival order instead of being refused.
Model workers are not held back; a provider's own rate limits are absorbed by request retries.
A single conversation still permits only one approved implementation at a time; open another conversation for an independent goal.
A local-merge workflow holds a checkout only for a `target` setup command and for the fast-forward of the worktree that has its target branch checked out; everything else it does holds nothing.
When no worktree has that branch checked out, for example because you switched your checkout to another branch, the branch reference alone is moved and no working file is touched.
Nothing is checked in your checkout: every declared check runs on the exact commit, in the delivery's own worktree.
Deliveries to the same target branch land in the order they became ready; deliveries to different branches never wait on one another.
Those that are ready at the same time, and are set up and built the same way, land together: the first in line replays each of the others onto the one before it in its own worktree, rebuilds what the builds derive and commits it as that delivery's own commit, then runs every member's checks once on the last commit and has it reviewed once, with each member's goal and acceptance before the reviewer.
The branch is then moved once, and every delivery keeps its own commit, task branch and record, which says which run verified it and at which commit.
If that last commit does not pass, half as many are tried, on commits that are already there, down to the first delivery alone, which then goes its ordinary way with repairs; a delivery that cannot be placed on the one before it without a decision, or that does not build there, stays in line with everyone behind it.
The commits in between are built but not verified by themselves; only the last one of a group is.
A branch you are rebasing, a checkout with an unfinished merge or unresolved conflicts in its index, and files you are saving at that very moment are waited for without a deadline; the delivery lands once they are free.
So is a fast-forward Git itself refuses: nothing is touched, the reason Git gave is shown, and the next look at the checkout takes what is there then into account.
Ordinary browser conversations do not wait for this access.
Like separate Pi terminals, they can edit the same files as each other or as a workflow.
Coordinate overlapping edits yourself: a delivery lands through Git and never overwrites uncommitted work, but ordinary conversations edit files directly and can overwrite one another.
There is no fixed delivery-duration or repair-round quota.
Agents have no fixed total runtime deadline.
Setup/check commands default to no timeout; an explicitly approved per-command timeout still applies, including in older plans.
A settled failure can trigger diagnosis and continuation, not automatic goal termination.
Cancel/Stop never interrupt the moving of the target branch (a hung Git command therefore delays Stop until Git exits).
Local-merge plans need nonignored code and knowledge targets; use working-copy delivery for ignored documentation.
Generated workflow notes remain separate.
After an owner restart, an unfinished run is shown as `unknown` with its retained worktrees; it is never resumed.
Credential-looking text in plans and research questions is shown and approved redacted.

An isolated worktree does **not** inherit ignored build output, credentials or profiles.
For `local-merge` agreements without dependency installation (`policy.installs: false`), omitting `links` lets the owner auto-discover plain untracked Git-ignored `node_modules` directories at proposal time, display and bind them into the approval digest, and unlink them strictly after identity verification during cleanup (passing `links: []` disables auto-discovery).
A repository declares what its builds derive in `.cadence/derived.json`: `{"build": [{"name", "command", "outputs"?, "refreshes"?, "timeoutMs"?}]}`, at most eight steps, run in order.
`outputs` are paths the command writes as a whole from the sources (bundles, generated code); `refreshes` are files whose entries people maintain and whose values the command only recomputes in place; a step names at least one path, and a path is one or the other.
An agreement that leaves `build` out is bound to that declaration when it is published, and the plan card shows the commands for approval with the rest; `build: []` declares none, and an explicit list replaces it.
The owner runs the steps after edits and again after every merge with the target branch; a step that changes anything it did not declare fails the round.
Investigate any other prerequisites during planning.
If dependencies/setup are needed, include the exact commands and their execution placement in the plan for explicit approval: `target` for original-checkout preflight, `candidate` for preparation needed once in the stable candidate, or `worktree` for the candidate and each parallel child.
Every delivery worktree has a detached HEAD, so a check must not depend on the name of the checked-out branch.
The plan's displayed service runtime policy includes private temporary directories for this delivery: Cadence supplies `TMPDIR`, `TEMP` and `TMP` to checks and workers, including recovery, so the plan can simply name the project commands.
These directories are centralized under `<stateHome>/cadence-tmp-v1/`, outside Git and on each workspace's disk; concurrent workspaces are isolated, and no terminal export or extra setup confirmation is needed.
If that configured location is unsuitable, execution reports the problem rather than scattering fallback directories in HOME or next to the checkout.
Only the service's own scratch directories may be removed after successful work and confirmed worker/check closure; the run stays active until cleanup settles.
Cancel/Stop retain the remaining directories, not undo a removal or delivery already completed; failures report retained resource paths.
This permits no dependency installation, profile copying, service restart or unrelated external writes.
Other command-local exports still do not persist into later processes.
No dependency/browser download or source-profile copying is implicit.
Baseline checks are separate from acceptance checks that need newly implemented files.
Failed candidate/worktree setup, baseline, implementation, checks or review enter source-backed diagnosis when their actual operations have settled.
A failed target preflight ends without dispatching an editor into the original checkout.
Incomplete assignment reports show `partial` or `blocked`, not a process crash; their outputs remain available, but dependencies and final delivery still require completion and real verification.
Cadence can preserve partial outputs, split remaining work and choose alternative implementations within the approval; it never expands permissions or weakens acceptance.
Transient model-request failures recover inside the original SDK worker, with visible, cancellable backoff; completed tool results stay with that worker, and a workflow stage that holds checkout access keeps it.
A subagent keeps retrying far longer than an interactive session does (12 retries, about half an hour of backoff, unless you turned Pi's retries off), and the retry line shows what the provider said.
An exhausted or nonretryable model request stops the delivery with partial work preserved and the provider's reason on the failed step, rather than rerunning the entire step or launching another model just to diagnose an unavailable provider.
An unchanged failure and identical recovery strategy cannot become an endless replay loop.
A concrete external blocker is reported with preserved work, not a generic request to type “continue”.
Final candidate checks must pass before the target branch is moved, and the commit that lands is the commit that passed them.
Repairs stay in the same named candidate, invalidate its earlier acceptance, and are checked/reviewed against a new exact candidate.
A delivery whose turn to land finds the branch moved makes one attempt, in its turn, to take the new head in and verify again; if that needs repair it steps aside, repairs in its own worktree and is next again, so no other delivery waits for the repair.
The user’s unrelated index is never committed.
Unresolved failures remain failures; no rollback is fabricated.
Automatic review is never recorded as human review.

To request orderly closure, ask Cadence to cancel in Pi, or use **Cancel workflow — request stop** in the browser (the browser coordinator cannot cancel).
A pending or unknown cancellation is not reported as stopped.
Failures, timeouts and unknown process/auth/storage outcomes remain distinct; an owner that cannot settle unknown work restarts itself and recovers automatically.

## Waiting for an unstable provider

The WebUI shows the retry number and scheduled delay when a model stream breaks, then shows when the replacement request is in progress.
There is no need to send the same message again while recovery is active.
Refreshing or leaving the page only detaches; return to observe the same accepted turn, or use its existing Stop/Cancel control.
Automatic recovery resends only the failed model request: it does not repeat completed tool operations, renew approval, switch models or replay work after a service restart.
A failed partial answer stays in history and is not presented as a complete reply.
Waiting, requests and tool work stay in the same SDK session without a total runtime deadline.

`OpenAI Responses stream ended before a terminal response event` means the stream ended without a protocol completion event, not necessarily that the local timeout was too short.
An already closed stream cannot be repaired by waiting on that connection.
If every attempt fails the same way, check the upstream provider/proxy's streaming support and timeout policy; automatic recovery is not a fix for a consistently malformed stream.

Native Pi's main dialogue uses Pi's own retry settings, separately from Cadence's service workers.
Cadence does not change those settings or load a user profile into a worker.
If a native dialogue stops, distinguish exhausted retries from disabled/overridden settings or cancellation before changing its retry limits.

## Service and compatibility

An explicit native mode entry, current user Send or browser plan-validation action may start or reuse its local project owner on demand.
It does not install a system service, enable boot startup, select another account's credentials or expose a public listener.
Pi says once which command stops an owner it started; when Pi runs on Bun, Node must be on `PATH`.
An existing owner/configuration is reused, not silently replaced after a connection failure.
System-service installation and remote access remain separate explicit operations described in [Service management](service-management.md) and [Remote access](remote-access.md).

`/cadence-history [run-id]` provides readonly diagnostics without model calls or service startup; see [History and diagnostics](history.md).
The WebUI uses the same execution engine with a separate, context-bound browser confirmation path.
Its main composer stays in the same conversation; the agreement card appears inline, and each workflow is one line after the turn it started in, showing what it is doing (with **Stop**) or how it ended: its merge commit, or the reason it did not complete.
Select the line to open the workflow's steps, checks, delivery and diagnostics in the main area; while it runs, the conversation's status names its phase.
Research, implementation, diagnosis, knowledge and review subagents are listed in the lower-left **Subagents** dock, together with legacy task children; selecting one (or **Open subagent context** on a step) opens its full transcript and retained result in the main area, and **Back to conversation** returns.
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

Each research call accepts as many independent questions as the goal needs (up to 32) and optional specific `roots` (default: the conversation directory).
The service asks all of them at once; a provider's own rate limits are absorbed by request retries.
Every question has its own outcome.
An answer is recorded as soon as it is given, whatever happens to the other questions; a question whose subagent failed is asked once more by itself after the others, and if it still has no answer the result says why in the provider's own words.
The investigation is complete when any question was answered.
Provide the actual investigation directory, especially for large mounted/backup trees; do not begin by enumerating `/` or broad parent directories.
Research tools are readonly and bounded.
Search limits and omitted coverage are reported explicitly; a partial search does not prove that no other matching file exists.
The bounded `grep` tool searches literal text, not regular expressions.
No files are copied to accelerate research.

Readonly runs hold no checkout access and never wait for a delivery; questions inside a run overlap too.
An investigation in a conversation with its own active implementation waits for that implementation, while other conversations remain independent.
Agents have no total process deadline or substitute idle/step/tool-call quota.
Leaving the page or losing a coordinator bridge does not cancel accepted investigations.
Explicit Cancel/Stop retain their actual closure and recorded source.
A timeout that confirms direct-child close does not prove all descendants stopped, nor does it prove any survived.

Research replies include `runId` and step identities.
Ask for `cadence_status` with the exact `runId`, `stepId`, and optionally `transcript: true` to inspect an earlier result after another run.
Selecting a retained run is readonly and does not replace the current run or restart work.
Native status/history and the browser's **Owner timing and runtime** details show the actual owner build/epoch and recorded queue/worker timestamps; the worker SDK version can differ from the terminal Pi host.
A parent session may record a whole batch of tool results together, so those timestamps are not the service's completion times.

Long workflows retain earlier steps in readonly pages rather than stopping at a step count.
Open **Earlier workflow steps** in the WebUI, **Earlier steps** in native history, or use `cadence_status` with the returned `stepsBefore` as `before`.
Route revisions and failed attempts remain visible; a later successful attempt never rewrites their original outcomes.
A revision may also change the assignments that have not started yet (drop, rewrite or add one); the workflow view shows which revision did, and a dropped assignment stays listed as superseded.

## Discover active Pi work

The unified WebUI sidebar automatically lists active work in this account and state home, including projects you have never selected.
An interactive terminal must load the Cadence extension: a real model/tool round appears even without `/cadence`, but an idle terminal or idle owner does not.
Terminal rounds are observe-only; owner turns and workflows show their actual phases (including ordinary turn startup and workflow queueing) and existing authorized controls.
In the selected project, a conversation with a live reply or linked workflow stays at the front of history.
Its workflow disclosure names each run; work without a reliable conversation link has a separate details entry.
Readonly discovery still distinguishes separate terminal instances and does not repeat owner work already represented here.

Click an activity to remember its directory and read the shared Pi session at the observed branch.
This does not start or associate an owner, grant execution consent or expand workbench Stop.
If Pi has not flushed its first session file, the page says history is not yet readable; it never invents messages or treats that session as a new draft.
A different session-directory configuration can leave an activity visible but its history unavailable; Cadence never follows an arbitrary reported session path.
A fixed observed branch stays fixed until you choose another branch; background discovery cannot take over your open page.

Finished activity leaves the list without closing its history page.
Lost or partial observations are explicitly stale/unknown, not evidence of success or completion; uncertain rows have a short retention window.
This discovers neither idle terminals nor other accounts/hosts, and does not provide remote control of ordinary CLI Pi.

## Investigating installed packages

Cadence research, diagnosis and review remain readonly, but their search roots are defaults rather than a barrier around the checkout.
Use Pi's standard `read`, `ls`, `grep` and `find` with an explicit host path to inspect an installed package; `~` refers to the service account's home.
Searches follow Pi's `.gitignore` behavior; inspect ignored dependencies and backups with explicit file paths and directory listings rather than treating no matches as proof that they do not exist.
`grep` accepts one regular expression by default, or `literal: true` for exact text; `find` accepts glob patterns such as `**/*.ts`.
Read one file at a time with `offset` and `limit`, following the next-offset notice for remaining text.
For truncated searches or listings, follow the tool's limit notice or narrow the query; ordinary file tools have no `depth`, batch or cursor parameters.
Searches use already available `rg` and `fd`/`fdfind` binaries or Pi's existing tool cache; missing tools are reported without automatically downloading or installing them.

Readonly subagents do not have shell or editing tools: use the direct listing, search and read tools rather than a `bash` pipeline.
Approved implementation workers keep their existing shell and editing tools.
This distinction preserves execution consent; it is not an OS sandbox or permission to copy credentials or profiles.

### Pi settings and tools

On Send, Cadence captures persisted Pi preferences from its owner's selected agent directory and the conversation directory.
Pi merges user settings with trusted project `.pi/settings.json`.
Automatic compaction (including model-specific token settings), agent-level request retries and configured standard tools take effect without a second Cadence configuration.
For example, Pi's `defaultTools: ["+grep", "+find", "+ls"]` adds those tools to its normal coding defaults.
Selecting `powershell` is also supported when that backend is available on the host.

A delivery agreement shows the runtime summary.
Changing settings/tools requires a fresh agreement before execution; accepted work keeps its snapshot through implementation and independent readonly Review.
Workers do not copy profiles into worktrees or write settings back.
Persisted Pi project trust controls project **settings**, not execution consent.
Terminal-only overrides and extension/MCP closures are not silently loaded; unavailable configured tools refuse instead of silently falling back.

Service differences remain explicit: cache warming and provider-internal retries are off; HTTP idle timeout defaults to disabled unless configured in Pi.
This does not add an Agent lifetime deadline.
Shell output is bounded/redacted rather than written to raw spill files; per-command timeout and explicit Cancel/Stop still apply.
