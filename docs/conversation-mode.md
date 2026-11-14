# Cadence conversation mode

In a trusted Pi terminal or a WebUI conversation in an explicitly selected project, enter `/cadence <goal>` once (or `/cadence` to discuss the goal).
Cadence stays enabled for the entire conversation, including after a goal finishes.
Continue using normal messages; do not repeat the command for clarification or another goal.
Type `退出 Cadence` or `exit cadence` (in Pi also `/cadence exit`) to leave the mode explicitly; in the browser the composer's **Cadence mode** switch enters it on the next Send and leaves it when on.
Leaving, closing Pi/browser and switching conversations detach; they do not cancel accepted work.
Browser conversation mode is retained by the project owner, not by a browser-only toggle, and works without a live Pi terminal.

## Normal path

1. Cadence delegates focused readonly repository investigations, reuses existing project documentation, and consolidates questions in the main conversation.
2. Discuss requirements and decisions until nothing that changes the result is left open.
   This is the last time you are asked: what Cadence decides on your behalf is listed in the agreement as its assumptions.
3. Cadence presents one readable delivery agreement: expected result, acceptance, decisions, assumptions, the initial route and write scope, setup/check commands, documents to update and delivery policy.
   The technical route is an initial suggestion.
   After approval the service finishes on its own: it repairs and re-plans, may bring further files of the repository into the write scope (never credentials, keys, `.env`, `.git` or anything outside the repository), and installs dependencies only if the agreement says revisions may.
   If an acceptance item proves impossible it delivers the closest achievable result and records the deviation: what could not be met, why, what was delivered instead and any declared check set aside because of it.
   The automatic review must confirm each deviation, and a run that deviated says so first when it completes; the task branch is kept, so the merge can be undone.
4. Type `按计划实施` after the plan to authorize those exact bytes.
   In the browser, click **Implement this plan** or send that exact approval phrase for the currently displayed plan.
   If execution is stopped or its plan binding is outdated, this first restores and validates the plan instead; review the updated context and choose **Confirm implementation** afterward (see below).
   In Pi, the Start tool can alternatively present one native confirmation of the complete plan.
   Native confirmation retains its raw-terminal guard.
   Quoted/generated text, an old session entry and vague agreement are not approval; browser authentication alone is not consent.
5. The persistent owner implements, reviews, verifies and delivers.
   Nothing asks for more approval.
   It stops early only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, an installation the agreement does not allow, or a missing tool.
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
Use **Restore execution and validate plan** on the plan card; if the service is already running, **Validate plan again** refreshes its execution context.
The exact `按计划实施` input follows the same validation path when the service or model binding is not current.

Validation may start or reuse the selected project's owner and applies the model shown in the composer, without substituting another model or changing the account's default.
It keeps the plan content, records a fresh execution binding and leaves the original snapshot intact.
It sends no chat message, calls no model, creates no task branch/worktree and approves no implementation.
Review the displayed model, runtime and target branch/base; changed environment evidence is labelled, and this tab also shows the previous context for comparison.
Then click **Confirm implementation** or send the approval phrase again to approve that fresh snapshot.
A current plan remains directly approvable; validation is not an extra step for every ordinary approval.

An unknown turn outcome, unreadable plan, changed conversation or unavailable selected model still blocks safely.
If an approval reply is lost, the page observes its original request rather than submitting another execution; reloading does not repeat it.
Browsing, reconnecting and choosing a model alone never start the execution service.
`CADENCE_AUTOSTART=0` still refuses on-demand startup, not healthy reuse.

## Messages while a reply is running

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
The picker reuses its already-read preview when reopened; **Refresh models** reads the configuration again without starting execution.
A preview read failure has a **Read again** action, not a requirement to start a service.
The browser restores an available saved preference on explicit Send or plan validation and shows it dimmed until then; reads/login do not install a choice.
With no choice and no saved preference, Send opens the model list and continues the original message after your choice when the same service connection is ready.
Closing the picker or stopping/replacing that service ends the unsent continuation; your draft stays, and choosing a model never restarts a stopped service.
Exiting Cadence changes mode, not your pending model choice.
If no usable preference exists, choose once; an unreadable preference file falls back to the current Pi model, and choosing a model rewrites it.
An accepted message or workflow keeps its original directory and exact model, including while queued.
Different subdirectories of one repository can have independent conversations while sharing one checkout owner and execution gate.
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
  Assignments that neither depend on one another nor write the same file run side by side, each in a temporary worktree beside it, as many at once as `CADENCE_PARALLEL` allows.
  Assignments, diagnosis, recovery and knowledge updates reuse that candidate, preserving partial work.
  The target is the current local branch displayed in the agreement, not necessarily `main`; the conversation stays in its original directory.
  The owner commits only declared file changes, runs independent readonly Agent review and real checks, then fast-forwards the unchanged target branch.
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
The named task branch is kept.
Only owned worktrees at the delivered commit, after successful post-merge checks and without any residue, are removed with plain `git worktree remove`.
Ignored setup/build output such as `node_modules` also retains the worktree; failures, cancellation and unknown outcomes never trigger cleanup.
Only one approved implementation runs at a time; approving a second while one is active is refused with `conflict`.
There is no fixed delivery-duration or repair-round quota.
Agents have no fixed total runtime deadline.
Setup/check commands default to no timeout; an explicitly approved per-command timeout still applies, including in older plans.
A settled failure can trigger diagnosis and continuation, not automatic goal termination.
Cancel/Stop never interrupt the final fast-forward (a hung `git merge` therefore delays Stop until Git exits).
Local-merge plans need clean, nonignored code and knowledge targets; use working-copy delivery for dirty or ignored documentation.
Generated workflow notes remain separate.
After an owner restart, an unfinished run is shown as `unknown` with its retained worktrees; it is never resumed.
Credential-looking text in plans and research questions is shown and approved redacted.

An isolated worktree does **not** inherit ignored `node_modules`, build output, credentials or profiles.
Investigate prerequisites during planning.
If dependencies/setup are needed, include the exact commands and their execution placement in the plan for explicit approval: `target` for original-checkout preflight, `candidate` for preparation needed once in the stable candidate, or `worktree` for the candidate and each parallel child.
Parallel children have detached HEADs; target branch checks must not run there.
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
Transient model-request failures recover inside the original SDK worker, with visible, cancellable backoff; completed tool results and the checkout gate stay with that worker.
A subagent keeps retrying far longer than an interactive session does (12 retries, about half an hour of backoff, unless you turned Pi's retries off), and the retry line shows what the provider said.
An exhausted or nonretryable model request stops the delivery with partial work preserved and the provider's reason on the failed step, rather than rerunning the entire step or launching another model just to diagnose an unavailable provider.
An unchanged failure and identical recovery strategy cannot become an endless replay loop.
A concrete external blocker is reported with preserved work, not a generic request to type “continue”.
Final candidate checks must pass before merge.
Post-merge failures retain the actual merge commit.
Repairs stay in the same named candidate, invalidate its earlier acceptance, and are checked/reviewed against a new exact candidate.
Only this run’s last confirmed merge can serve as the next integration baseline; external target movement or branch switching blocks integration.
Repairs can fast-forward that unchanged target again; the user’s unrelated index is never committed.
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
The service runs as many of them at once as `CADENCE_PARALLEL` allows (default 4, at most 16) and queues the rest; set it in the service's environment to match what your model provider or local model server can serve.
Every question has its own outcome.
An answer is recorded as soon as it is given, whatever happens to the other questions; a question whose subagent failed is asked once more by itself after the others, and if it still has no answer the result says why in the provider's own words.
The investigation is complete when any question was answered.
Provide the actual investigation directory, especially for large mounted/backup trees; do not begin by enumerating `/` or broad parent directories.
Research tools are readonly and bounded.
Search limits and omitted coverage are reported explicitly; a partial search does not prove that no other matching file exists.
The bounded `grep` tool searches literal text, not regular expressions.
No files are copied to accelerate research.

Separate runs in one project wait for the shared checkout gate; questions inside a run can overlap.
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
Terminal rounds are observe-only; owner turns and workflows retain their actual queue, execution, recovery and settlement phases and existing authorized controls.
The counts deduplicate projects and sessions, while separate terminal instances and owner work keep their own sources.

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
