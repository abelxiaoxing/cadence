# Clients: terminal, agent panel and WebUI

Behavior contracts of the native `/cadence` client, the background agent panel, the browser WebUI and ordinary conversations.
Read this before changing a client, its consent rules or what the WebUI shows.

## Native terminal

`src/cadence-mode.ts` owns persistent conversation mode; `/cadence [goal]` enables it until explicit `exit cadence`, `退出 Cadence` or `/cadence exit`.
The exit phrase is named in the activation message, command description and instructions; it is trimmed before matching, accepted while Pi is busy and from RPC input, and never cancels accepted work.
A saved mode engages only in a trusted interactive terminal for the same cwd; in print, RPC or untrusted sessions it is inert (ordinary tools, nothing injected), and `/cadence exit` still leaves it.
Mode instructions go into the per-turn system prompt; a context filter keeps only the newest small Cadence state message.
Tool sets change only in a session that actually applied Cadence tools; `/tree` navigation elsewhere leaves other extensions' tool choices alone.
A completed goal leaves the conversation in ready mode, not ordinary mode.
Subsequent messages never require another activation command.
Active-branch session entries retain mode and the last observed run, not a reusable proposal/grant or an execution replay.
Session replacement restores normal tools before rebinding the new branch; compaction does not disable the mode.
Entry and typed exact plan approval require fresh trusted/idle raw-terminal evidence; paste, quoted commands, RPC and extension-origin input cannot provide it.
Planning tools expose coordinated readonly subagents, proposals and observations rather than uncoordinated edits.
Product choices use one batch with stable question and option IDs, tradeoffs, recommendations, related acceptance and optional dependencies on earlier answers.
Native Pi keeps the editable draft in its branch entries and resumes it with `/cadence design`.
The browser owner retains it with its conversation revision and rejects stale edits.
At tool ingress only, omitted `when`, `null` and the provider's pair of empty dependency IDs mean an independent question.
Partial, unknown and forward dependencies refuse the complete batch with a field path; the saved representation has no `when` for independent questions.
A pending batch opens a modal in the visible conversation once answering is available.
Closing it leaves a single-line reminder strip above the composer with saved choices intact; polling and editing the same draft do not reopen a dismissed modal.
Submitting replaces the composer strip with a compact single-line summary anchored in the scrolling transcript at the turn that published the batch (or at the end when undated), where it can reopen the modal to view or revise choices without prompting again.
Filling recommendations preserves explicit answers.
No modal is inferred from assistant prose or from a refused publication.
Selecting or revisiting a question requires no model turn.
Submission sends the confirmed choices for the implementation card.
Revising a submitted choice keeps the modal open and retires the previous plan card.
Approving a plan for execution retires the design batch on both native and browser surfaces so further edits are rejected and only the submitted conversation text remains in history.
Execution uses the existing exact-plan approval on the originating surface.

Both surfaces declare `cadence_knowledge`, `cadence_design`, `cadence_research` and `cadence_plan` from one schema (the parameter definitions in `src/coordinator-tools.mjs`) that states shape only: no counts or sizes, so Pi's own argument check never turns a call down for a bound the model could not know.
The service completes and checks the call (`researchInput`, `workflowPlanInput` in `src/service/contracts/workflow.ts`): a plan field that may be empty may be left out, a question list loses its blank and repeated entries, and whatever cannot be accepted is refused as `<field>: <what it holds and what is accepted>`.
The coordinator corrects that field and repeats the call in the same turn; nothing in the instructions or a notice lets it publish a reduced plan or ask the user to reply first.
The browser worker reports invalid design/plan input as a tool error with the original field diagnostic.
Within that worker it refuses to send the last invalid design again unchanged, including queued duplicates; it never caches project observations, plan bindings or admission outcomes.
A reading names a recorded investigation by a completed research step's `investigation` value or by that step's own id; the browser checks that an answer is recorded under it before publishing, and a worker is told when one it was given is not.
`cadence_plan` returns the complete plan in its own tool result; no message is injected while a tool call is open, and workflow results notify at once and are appended as a message once Pi is idle.
An attempted run ID is restored on a definite refusal (and Start keeps its proposal); one the owner proves absent is forgotten on observation; an `unknown` run blocks new research or planning until one `cadence_status` has observed it.
Start, Cancel and the model picker list the safe choice first and accept the acting choice only by a typed, non-paste Enter at least 250ms after the dialog opened; the approval grant is prepared after that confirmation.
The main conversation consolidates clarification; only native confirmation of the complete current plan or exact fresh `按计划实施` authorizes execution.
On-demand project owner startup is explicit mode/user-Send behavior, not discovery; `CADENCE_AUTOSTART=0` refuses it.
It runs the service CLI with `node` when Pi itself runs on Bun, counts a killed or non-zero launch as failure, and tells the user once per project which command stops the started owner.
A connection whose owner restarted or stopped is re-attached on the next call (and by `/cadence` while the mode is on); a live owner's configuration is never replaced.
A lost/uncertain command reply is not replayed.
Departure only detaches; the owner holds accepted work through actual closure.
The native and browser conversation key is Pi's public session ID; its cwd is validated independently.
Tree navigation keeps the identity; fork/new sessions get separate settings, without importing or copying their transcripts.
Native model calls name that key and cwd.
Dialogs retain their original generation/location across awaits; navigation cannot apply a selection to the new session.
Per-conversation preferences are authoritative; the user's agent-directory preference is only a default for a new conversation.
An unreadable default falls back to the current Pi model with one warning only when that conversation has no own preference; an explicit model choice atomically replaces the default.

`/cadence-history [run-id]` is readonly diagnostics with the original raw-entry/session/departure guards and typed attachment; it never starts an owner, selects a model, calls a provider or submits work.
It lists retained workflows and reads exact step results/transcripts without an LLM, plus old task history/search/verified export.
The old `/cadence-inspect` execution interface is removed.

## Background agent panel

A readonly panel in the Pi TUI follows the current conversation's Cadence workflow children and agents another extension announces on this Pi runtime's event bus.
The conversation identity is the public Pi session ID, pinned when the observer attaches; sharing a cwd is not sharing an observation scope.
The feed admits only roster runs whose immutable `execution.version.conversation.id` matches that session ID, before reading their steps or transcripts.
Copied/forked session entries and reconstructed workflow links cannot transfer that attribution; missing admission context stays invisible rather than falling back to a project-wide broadcast.
Resuming the same conversation (including in another terminal) observes its still-running work; a different/new/forked conversation does not inherit it.
Every TUI session looks for its workspace's already-running owner after startup and retries absent owners; it never starts, recovers or selects one and only detaches on departure.
Build differences do not suppress an authenticated owner's activity.
That observation holds one of the owner's viewer attachments, so departure (including Pi quit) waits up to 1.5s for the detach to reach the owner rather than leaving the slot to its idle expiry; `/cadence` departs the same way.
`CADENCE_AGENT_PANEL=off` turns that observation off.
The small workflow roster uses the idle interval until this conversation has a followed run, then the active interval; timing constants live in `src/agent-panel-cadence.ts`.
Only research, implementation, diagnosis, knowledge and review steps first observed running are announced; first-seen settled steps and unattributed legacy tasks are not loaded into the native panel.
Workflow review rejections are announced and counted as `rejected`, never as agent errors; assignment reports retain `partial` and `blocked` separately too.
Native cards and the browser dock do not count those as crashes or completed assignments.
The workflow view counts incomplete reports on the selected step page without inferring a delivery outcome.
Legacy task history remains independent of session attribution.
A run that leaves the active roster remains attributed until its final observation; a failed roster read is not proof of completion.
A child whose outcome the session can no longer observe (no readable owner a whole retry after losing it, or a persistently unreadable workflow) ends as an error that says so; `/cadence-history` keeps the actual outcome.
An abandoned run is not automatically readmitted while it remains in the roster; only its ID is retained until it leaves, preventing repeated failed reads and duplicate agent batches.
Explicitly reopening the conversation creates a fresh observer; the owner's execution and retained history are unaffected.
The viewed child streams its transcript; unviewed running children refresh activity at the bounded background interval.
On settlement, only an already-viewed transcript gets one final read, before the end event, even if an earlier transcript read failed; a failed final read cannot discard the observed outcome or trigger repeated historical reads.
Settled children leave the feed immediately; completed runs are no longer read.
Elapsed time counts from when this session first observed a child; no tokens are shown because the owner records no usage.
Opening a running child reads its retained messages, tool calls and results through the workflow reader, with bounded text fields; full retained evidence stays in `/cadence-history`.
A retained `edit` call shows its call and result without Pi's diff preview, which would compare against the file as it is now.
Producers emit `subagent:start {id,label,kind,startedAt}`, `subagent:message {id,message,streaming?}`, `subagent:activity {id,activity,tokensIn?,tokensOut?}`, `subagent:stats {id,tokensIn,tokensOut?}` and `subagent:end {id,status,endedAt,error?}` with status `done`, `rejected`, `partial`, `blocked`, `error` or `cancelled`; `startedAt: null` marks an unobserved start.
A message has the main session's message shape; `streaming: true` marks a snapshot that the next message replaces.
The panel emits `subagent:view {id}` (`id: null` when none) so a producer loads only the shown agent's messages.
Nothing shows while no agent runs.
Agents whose start was observed form a batch: the first one opens it, and later starts join it until it closes.
A start with `startedAt: null` joins no batch, so after a restart already finished children neither reopen the live view nor repeat a card.
While a batch is open, one summary line above the input names its shared kind and running/done/rejected/failed/cancelled counts; individual rows belong only to the agent browser.
Once every member ended, the block shows the card it is about to become for `SETTLE_MS` (1.5s); a start in that time joins the same batch.
Then the block is removed and the card is appended to the session as a display-only `cadence-agent-batch` entry, which is not part of the model's context and renders again on resume.
A collapsed card is one line when every member finished cleanly and otherwise also lists the rejected, failed and cancelled ones; Pi's tool-output expansion (Ctrl+O) lists every member with its final text and elapsed time.
A card holds only display text (kind, row text, status, elapsed), at most 64 members, and anything malformed in a session file renders nothing.
A batch that settled is carded in the session it ran in, even on departure; a running batch is discarded on departure, without fabricating an outcome or carrying it into another session.
Ended agents are dropped from memory after their batch becomes a card; an already-open transcript may retain its own display snapshot until closed.
`CADENCE_AGENT_PANEL=always` keeps the last batch summary in the block, without a card, until the next batch begins; it never keeps ended agents browsable.
With an empty focused input and at least one running agent, ↓ opens the adapted upstream readonly session browser: Pi's continuous selection list, with up to ten visible **running** rows and stable ID selection as activities change.
An ended row disappears immediately, without waiting for the batch card; if it was selected, selection moves to the nearest running row.
Keyboard and mouse openings recheck the exact live row; a click on an ended row never opens it or silently redirects to its replacement.
With none running, ↓ belongs to the editor again.
A transcript already being read stays open as a snapshot when its agent ends, but releases its producer subscription and cannot be reopened from the running list.
An already-open empty list says no agents are running; it does not fetch history or unexpectedly redirect keys into the editor.
Enter opens the upstream transcript pane in that same interaction; ↑/↓ or j/k scroll content, the host's paging bindings and Shift+↑/↓ page, Home/End and the host's top/bottom bindings jump, and Ctrl+O toggles retained tool output locally.
Esc, q or Ctrl+C in a transcript return to the selected live row (or the empty list); Esc in the list returns to input.
No browser key controls execution.
The fullscreen browser is a focused overlay, so viewport keys and its normalized mouse wheel reach the browser rather than the parent conversation.
Pi's current regular mode uses the upstream docked mounting behavior to avoid baking overlay chrome into scrollback; this is one browser for the two current renderers, not a legacy Pi compatibility implementation.
Transcript chrome costs two rows and short content does not fill the screen; long content is capped at 70% of terminal height.
There is no duplicate bottom queue.
Each agent's reading position survives switches; new output follows only at the bottom, while paused reading stays put and is labelled paused.
Tool output and thinking start folded.
Messages outside the retained view remain in `/cadence-history`; an empty view reports that no retained messages have been observed, not that the agent finished without output.
The mounted browser is disposed on departure and announces no viewed child after detach.
A new session drops all of the previous session's agents; late reads from its stopped observer cannot publish into the new session.
The panel never starts, cancels or keeps an agent or Pi alive; across restarts only the cards remain.
For manual checks, `pi -e ./src/index.ts -e ./scripts/agent-panel-demo.ts` adds `/agents-demo [count]`, which plays a batch of fake agents (the second fails), then a fake review agent with its own card, and runs nothing.

## Streaming timelines

### Stable rendering and details

An ordinary turn shows the user's message, then one speaker label over the reply in recorded order.
`traceGroups` folds a continuous stretch of three confirmed completed steps (two after answer prose) behind one disclosure; it never crosses prose or another user turn.
An inactive thinking placeholder with no body can share a group but does not count as a result.
Failed, unknown and in-flight calls stay visible.
Revealing the process restores its keyed rows, not their detail bodies; focused or explicitly opened members stay readable through regrouping.
The main conversation keeps explicit group choices above its lazy window, by turn and member render identity.
Advancing the latest leaf does not retire them; switching branches does.
No detail body or DOM row is retained to restore a group.
In both the conversation and a subagent transcript, pausing follow protects individually displayed steps in the viewport when a new result crosses the folding threshold.
That visibility is local to the mounted view, not a saved choice.
A fine rail joins adjacent rows but stops at prose.
A body-free observation shares the icon slot without offering a disclosure; only an opened detail has a glass backing.
The disclosure fills the row, keeping the chevron in a fixed end column beside shrinkable text.
A tool row names the tool and what it acted on, and reads its arguments and output only while opened.
Opened details refresh when their full-content version, coordinates or execution state changes, even with the same parts count; reply termination makes a final read.
Closing a detail or leaving its conversation retires pending reads, and stale results cannot replace the current selection.
A thinking block starts folded and reads its text through the step-detail read when opened, shown as recorded; a live body-free activity placeholder is not expandable and hands off in place to readable Pi thinking under the same identity.
No thinking body or signature is streamed, and a thinking block is neither answer text (it is not copied with the reply) nor evidence that an earlier tool call has a result.
Ordinary replies render every received text snapshot immediately through stable Markdown prefix segments and an active tail, not an artificial character-paced catch-up animation.
`segmentStream` parses the whole snapshot with the same CommonMark/GFM/dollar-and-backslash-math syntax as `MarkdownBody`, splitting only independent top-level roots; lists, quotes, indented/fenced code and math containers stay intact.
From the first root containing a reference or definition (including nested definitions and footnotes), the remaining document is rendered together to preserve resolution, numbering, backlinks and one final footnote footer.
Segments retain exact source slices, separators, indentation and line endings, keyed by real UTF-16 source offsets; new syntax may revise the dependent suffix, while unchanged prefixes remain memoized rather than being promised immutable forever.
Ordinary `StreamMarkdown` uses the same `MarkdownBody` pipeline even for an incomplete fence, preserving its safe-link/media rules and code controls; streaming versus terminal status alone neither repartitions text nor switches renderers.
The separate workflow stream renderer consumes the shared semantic segments but retains its existing pacer and plain open-fence preview; ordinary chat does not use that pacer.
With explicit rendering metadata, the same block component and rendering identity survive preview/durable/terminal observations, independently of changing read coordinates and earlier-page positions.
`ConversationReader` derives `LoadedTurn.renderId` from the user step's rendering identity; `ChatWorkspace` uses `turn.renderId ?? turn.header.id` on the outer Fragment around the entire turn, not only on its inner message/tool blocks.
The row's `id` stays `turn.header.id`: `LazyMount` registration and measurement, `data-lazy-id`, jump pins, question tracking, branch versions and workflow placement use that read/navigation coordinate.
Edit/continue anchors and Send retain their recorded parent/end branch entries, never rendering identities.
A command-to-Pi handoff can therefore update those coordinates without replacing the rendered row and its opened details.
Legacy history without explicit metadata falls back to its recorded identity; equal text or list positions never manufacture a link.
The reader publishes a complete head/turn observation together and rejects mixed paged snapshots and obsolete navigation/detail replies; legitimate identical text from distinct occurrences stays distinct.
History readability is independent of execution readiness.
`useConversation` keeps the branch reader mounted and identifies each uninterrupted ready attachment by a local generation: loss and recovery start a different generation even with identical epoch and attachment version.
Each head sync captures its generation **before** issuing the read.
Only that head with all required turn pages can confirm activity; a replacement starts a readonly sync and retires the previous one's success or failure, not the displayed turns or their lazy detail readers.
`observedReplyClock` and composer flow use the same observation.
Until confirmed (or after a failed read), the footer says activity is unavailable rather than Working; a confirmed live reply resumes at its recorded start, without a duration if none was recorded.
Only thinking or tool activity on the displayed branch’s last running turn lights the composer.
An opened `edit` or `write` card shows those arguments as the requested change (each replacement's removed and added lines, or the content to write), built from the recorded call alone and never compared with the file; an errored call is labelled as requested and not applied, and arguments that are not such a call's complete ones stay as recorded.
The initial change preview shows up to 400 lines; the write-body copy button takes the complete recorded `content`, including its final line break, not those displayed lines, the path or the tool output.
Its glyph states only the explicit call state: pending/running, a recorded result, a recorded error, or no observed result.
Neither a later assistant message, a stable step nor reply completion proves a tool result; old history without explicit state stays neutral unless it records an error.
This rule also applies to workflow subagent cards: completed/failed tool observations survive a failed or canceled reply, while a pending/running call without a result becomes neutral once the reply ends, never an endless spinner or inferred success.
Tool result/error labels state only the recorded call outcome, independently of reply, assignment and workflow delivery status.

### Workflow tool observations

`WorkflowAgentView` reads the selected subagent's bounded retained `workflow-transcript` every second while its step is queued/running (or its run is not yet observed); a step's terminal observation switches the interval to zero and triggers one final read, including failure, cancellation and unknown closure.
Its tool snapshots become observable at the [capture publication boundaries](history.md#conversation-workflow-records), not merely when the assistant next speaks.
Unlike ordinary conversation listings, that workflow read already contains full retained items: `recordedTurn` hides tool bodies behind a local detail closure, which changes with each newly observed transcript even when the item identity and parts count stay the same and no content-version field is recorded.
The actual `ChatTurnView`/`ToolStep` path refreshes an opened detail from that closure while keeping its previous displayed value and expansion state until the new value arrives; closed tool cards do not invoke it.
The separate retained step result (`workflow-detail`) is requested only while opened, polls while the step is live and also gets a final read when its live interval stops.
Changing client, run or step retires the view's polling and expanded-detail lifetime; late reads cannot populate the replacement view, and navigation never cancels the worker.

### Scroll intent

The WebUI loads the newest turns first and reads earlier ones as the top of the transcript nears the viewport; displayed turns remain in source order, and turns far from the viewport render as placeholders of their measured height.
Content, image and opened-detail growth follows the bottom only while the reader is already following (within the existing 80px boundary); scrolling up keeps that reading position, earlier-page loading retains its anchor, and Latest messages explicitly resumes following.
In the main conversation, `ChatWorkspace` passes its stable `keepEnd` callback to `useLazyWindow`'s `onContentResize`: the hook observes both the scroll container and registered row elements, so image/detail height changes can follow without a new head read or parent render.
That callback reads the current `stick` ref and is shared with composer resizing; height changes never turn following back on.
The in-flow composer ends the scrollport; its protected reading shelf fades to an opaque backing before the Latest button and reserves room for the final line.
The shelf does not intercept input.
Row removal unregisters its observation, and hook cleanup disconnects the observer and cancels its pending window sweep.

The subagent view is not windowed: `useFollowResize` observes the mounted transcript body for initial layout and size changes.
A new `workflow-transcript` response updates the displayed turn and its open details, but is never by itself a reason to scroll.
Within 80px of the bottom, a same-height poll leaves the exact offset alone; real growth follows the new end.
Scrolling up to a gap of 80px or more pauses follow for that view.
A disclosure, poll, or late scroll event (even after shrinking content) cannot resume it.
**Latest messages** jumps to the end and resumes resize-follow.
Selecting another child starts a fresh scroll lifetime.

## Browser

Open the private link that `cadence server install` printed, or that `cadence token-link --reveal` reveals.
A valid bootstrap redirects to a token-free URL and sets an HttpOnly SameSite cookie for one year for subsequent HTTP/WebSocket access; no localStorage token copy.
An unauthenticated `GET /` or `GET /app` answers 401 with a script-free password page that posts the key to `POST /auth`; a correct key sets the same one-year cookie, a wrong key shows a neutral notice, and an invalid or rotated cookie is expired in the 401.
The password page's responsive CSS is permitted by an exact SHA-256 CSP hash; its default-src remains none, with no scripts, remote assets or inline style attributes.
Reduced-motion and forced-color preferences are respected.
Both entries decode the same bounded, unambiguous native form; owner login shares its existing ingress slots, and failed login preserves a sanitized project destination without reflecting the submitted key.
The browser has one folder-first conversation interface, not a workbench/project home or a return-to-home action.
The lower-right folder button is the persistent directory switcher; its picker holds recent folders on the service host.
A complete project/conversation link wins over browser preferences; otherwise entry restores the last associated readable folder, even when its execution owner is stopped.
First use, a missing folder or failed restoration stays in that same shell with an inline Choose a folder action, not a project list or a fabricated default directory.
Before selection, New conversation opens the same picker; text and model preselection are local draft input, and Send stays disabled.
An unfinished first-use draft waits for an explicit directory choice rather than restoring another folder over it.
Only that explicit choice hands the draft to a freshly identified conversation, persisting its exact directory namespace before history loads; activity links and restoration never inject it into existing sessions.
No draft handoff is a Send intent, pending command, model installation or execution consent; blocked browser storage retains the in-memory handoff and a failed persistence attempt does not delete the stored source.
The target retires that initialization handoff after mounting, so returning to a conversation cannot resurrect its already-used text or model when browser storage is unavailable.
Directory selection only remembers its canonical reference; it starts no service, creates no project-private state and requires no Pi login.
The current explicit Send or plan-validation action prepares the selected owner through the same project-launch boundary as native entry (`CADENCE_AUTOSTART=0` refuses startup, not healthy reuse); no separate Open is required.
The closed `/workbench/v1/prepare-send` and `/workbench/v1/prepare-plan` routes share one preparation implementation and retain distinct command identities; validation requires a captured conversation location, and neither route accepts message text, a model choice or an execution grant.
The gateway rechecks its own epoch/CSRF and the exact selected directory, and the existing serialized observer supplies a fresh authenticated attachment.
Build fingerprints are diagnostic metadata, not access or operation gates: different or absent client builds never disable history, activity, model selection, directory changes, Send or service controls.
Requests still have to express a supported operation; no capability is inferred from a build header, and a browser cannot become a native caller by naming one.
Connection and build changes never reload a mounted conversation or resend work; text drafts and unsent images stay in the current tab.
The initial workbench GET has a bounded read and retries transient failures at the observation retry interval; going online wakes a pending retry.
Only the direct owner's explicit invalid-route reply selects its standalone UI.
Authentication refusals stop retrying; explicit sign-in keeps validated chat/branch IDs for a one-time return to the same entry.
The authenticated, uncached document names one build in every module, stylesheet and font URL.
Its dependency-free startup script has a stable revalidated URL so a replaced build can still report a failed entry module.
Before mounting only, an authenticated fresh document announcing a different build permits one guarded reload of the same address; auth failure, blocked tab storage, a failed recovery chain or the same build leaves a manual retry.
No failed API request triggers navigation.
The service dialog lists the project and identity of each affected workflow or conversation.
The version button confirms an upgrade, and restart keeps its own confirmation.
For a mounted page, only the requesting page reloads automatically, after observing its own successful upgrade and the target version serving; no command is replayed.
Across the restart it checks only the version and job from the authenticated service status, independently of the next release's confirmation fields.
A transient proxy page, unreadable reply or old instance still serving is not a terminal outcome.
Auth refusal stops the observation; the deadline or a failed job leaves manual recovery available.
A Send claims its exact message and image File list, conversation head, mode revision, cwd, displayed model selector and command ID synchronously before preparation or model-selection waits; continuation never rebases these fields.
An initially unchosen model may be resolved once, or changed by the waiting user's explicit picker choice; a concurrent newer default/selection cannot silently replace the captured selector.
An unreadable conversation (including half-finished owner setup) permits preparation only: it cannot supply a head or mode revision, so the draft waits for the user to review the restored context and Send again; startup never rebases it.
The authenticated session advertises `capabilities.actions` when the live owner can handle workbench actions, even before a model is chosen; Send restores or asks for the model of its captured conversation only after acquiring the fresh viewer.
An expired viewer handoff reports a timeout, not a changed conversation.
Preparation is not message admission or execution consent.
`project-entry.ts` reports `dispatched` only after local signal/body/identity preparation and the POST's handoff to fetch; that handoff is not proof of receipt.
Only a decoded response matching the selected project/path/cwd and a non-null epoch reports `confirmed`, before the serialized viewer attachment wait.
A request-before-dispatch failure cannot suggest owner startup; an unconfirmed dispatch is preparation-unknown with no message submitted, and an attachment failure cannot undo confirmation.
A preparation response's reliable `effect:none` is preserved through the client and reported as a refusal with no owner startup, not as an unknown outcome.
Final Send clears uncertainty only on a matched success or reliable `effect:none`; all other failures retain the original command ID for observation without replay.
Failure keeps the draft; losing an accepted Send reply keeps its original command ID for observation only.
Leaving the conversation or choosing another branch aborts its unsent continuation, never accepted startup or work.
A saved plan has a separate explicit recovery path: Restore execution and validate plan, or Validate plan again when already connected.
The exact approval phrase uses that same path when execution or the plan's model/owner binding is not current, and ends at validation rather than approving afterward.
`cadence-revalidate` captures the displayed proposal/revision, Pi leaf, durable conversation context and exact displayed model before startup; the current owner's model choice version is observed afterward and checked before installation.
The owner verifies the settled conversation/branch, installs only that choice without changing the account default, and uses the ordinary proposal builder to publish a fresh immutable execution binding of the exact same plan content.
The previous proposal remains intact and is named by `revalidatedFrom`; no coordinator call, conversation append, grant, worker or Git resource is created, and obsolete unused grants are retired at both the browser and executor layers.
The new snapshot displays current model/runtime/target/base and, while this tab retains it, the prior context for comparison; changed environment evidence is labelled.
A separate fresh confirmation approves only that displayed snapshot.
Neither a stopped owner nor expired context requires an artificial chat message or model-generated replacement plan.
Unknown turn closure, changed conversation/context, unsupported retained agreements and unavailable selected models refuse without fallback; a failed validation refreshes observation but is never automatically replayed.
Within that project, the browser opens on an ordinary conversation with a real message composer, retained multi-turn context and standard read/write/edit/bash tools; no Cadence task is created by Send.
Use `/cadence [goal]` at the beginning of an explicit Send, or toggle Cadence on for the next Send, to enable persistent mode in that same conversation.
Toggling the browser mode switch only sets local next-Send intent without sending a message or starting an owner: turning it on enters Cadence with the next message (`cadence-send` with `intent: "enter"`), and turning it off while in Cadence atomically exits Cadence and runs the next message as an ordinary turn (`send` with `exitRevision`, retiring unapproved plans/designs while leaving accepted workflows untouched); a manual `/cadence` prefix enters or keeps Cadence and updates the toggle, while explicit `退出 Cadence` / `exit cadence` still uses model-independent `cadence-exit`.
Prefix-only entry asks for a goal; ordinary subsequent messages, refresh, completion and cancellation retain mode until explicit exit.
Mode/plan/run links belong to the owner-private versioned conversation-control store; browser storage holds only drafts (with the anchor of a message being rewritten), the prompts this tab sent (sessionStorage, for recall), display preferences and uncertain attempt IDs.
The coordinator is an isolated SDK child with only bounded research/proposal/status tools; it cannot call write/edit/bash, approve itself, or load arbitrary extensions.
Its static dialogue policy travels in `request.instructions` (`LIMITS.instructionsBytes`), while per-turn placement, run/plan/design state and the project route table are budgeted together into `request.context` (`COORDINATOR_CONTEXT_BYTES`, 32KiB) and mounted into Pi's `appendSystemPrompt` section so Pi's shared session `.jsonl` records only the user's message.
A research call returns one entry per question in the order asked (`status`, the first 4KiB of its text and, for an answered one, its `investigation`), not the run record; a bridge refusal carries the service's fixed error code.
It holds no checkout barrier while awaiting research, so the existing worker barrier cannot deadlock its parent and status conversation can proceed during implementation.
One coordinator turn per conversation is admitted at a time (bounded per owner); separate project owners remain independent.
While that turn runs it takes further messages like an ordinary reply (see [Ordinary conversations](#ordinary-conversations)): they join the turn the mode names, change no mode or plan state and are never read as approval, exit or mode entry.
The owner retains one current proposal until replacement, mode exit or admission.
**View current plan** at the conversation title opens it above the mounted transcript; refresh, further discussion or a new binding starts collapsed.
No approval control follows later messages down the stream.
Native Undo and Redo restore editor text, never plan approval.
An edit restored within one uninterrupted ordinary discussion can still be sent as discussion; when origins conflict, matching text alone cannot authorize it.
Details disclose the full agreement, execution binding and (after an explicit revalidation in this view) the previous context.
Plans and research in another conversation may proceed while an implementation runs; a conversation with its own accepted implementation cannot start another implementation or investigation until it settles.
Research IDs are recorded only once accepted.
WebUI and native sessions use the same scheduling and isolation rules in [lifetimes](lifetimes.md).
An unreadable or incomplete control record degrades only its own conversation: the read carries a notice, every Cadence command there refuses, and nothing is repaired; other conversations and owner startup are unaffected.
Lost replies to Send or approval return the original receipt or run on a retry with the same command ID.
One human plan approval binds the exact visible proposal, conversation revision, the browser's settled last run in that conversation, the current Pi branch leaf, model, project observation, owner epoch and authenticated attachment/access generation.
That run is the coordinator turn the mode names together with every message sent into it: all of them must have ended with a known closure, and the branch must end in the turn of the newest one Pi was given.
Prepare is a fresh confirmation operation, not a background read; a second tab, changed context, departure or expired grant cannot inherit it.
The browser-specific approval channel retains browser authority and existing CSRF/origin checks; the native general workflow command remains forbidden to browsers.
Both surfaces display the owner-bound target/ref/base and named stable-worktree policy before approval, then recorded candidate acceptance, actual integration, post-checks and retention.
The conversation cwd/session stays unchanged; observing a managed worktree never starts another owner.
Version-3 agreement approval covers the goal, explicit decisions, acceptance and the coordinator's listed assumptions, the declared commands and installation policy, and the owner finishing on its own: revising the route and the write scope inside the repository, recovery, recorded deviations confirmed by the automatic review, and verified project-knowledge maintenance.
Both surfaces show that statement with the plan before approval.
It covers declared setup/check commands and local commits/integration, not a generic shell, push, publication, deployment or host recovery capability.
An accepted plan is consumed at the conversation boundary before dispatch; command loss or an uncertain attempt is observed, never replayed.
Full plan cards and retained run/step details replace daily task/Save/Start/Checks/Review management; automatic review is never human review.
Workflow progress is distinct from the ordinary/coordinator response status, including actual merge commits after failed post-merge checks.
Browsing an archived step page keeps the current run status polling independently; navigation to another run resets the archive cursor, selected detail and polling state.
The independent project workflow roster includes native-started work; missing observations never render as an empty complete roster.
Active workflow links come only from immutable admission context, never copied/forked terminal entries or the retired browser workflow-link index; existing index files remain untouched.
Mode exit only detaches from orchestration; actual workflow cancellation remains a separately explicit, exact-run request and waits for original settlement.
A failed or interrupted coordinator turn stays in the session; a new explicit Send continues that branch as Pi would (errored replies are skipped and orphaned tool calls closed); no incomplete tool call is resumed.
A saved model preference is restored only on explicit Send or plan validation, never readonly browsing; no silent model substitution.
The model catalog reports that preference read only as `remembered`, and only when it names a selectable entry of the same catalog, so the browser can show it as "used when you send" without installing it; an unreadable or no longer offered preference is simply absent.
The composer's model button shows the installed choice (or the remembered one, dimmed) and opens an anchored panel: models grouped by provider with a search, unavailable models listed with their reason, and the thinking level as a separate row.
One click is one explicit choice; choosing another model keeps the current thinking level when it offers it, otherwise the nearest offered level, and the panel shows the result at once.
The model panel is usable before execution starts, including on the project-less entry: the authenticated gateway exposes a separate credential-free `ModelPreview`, never a fabricated owner epoch, choice version or source selection.
`gateway-models.ts` resolves the account's configured Pi sources (the saved project agent directory when one exists); unknown/half-written selected configuration refuses rather than falling back to another account or source.
The SDK-free gateway delegates to the fixed-purpose `src/model-preview.mjs` child; `model-preview.ts` constructs only Pi's offline model registry there, with a readonly credential snapshot, an in-memory model store and both network/availability refresh disabled.
The child creates no owner, AgentSession, tools, project state, auth refresh or preference write and exits on completion, parent IPC loss or its total deadline.
Identical concurrent inputs share one original through actual native close; no SDK runtime, credential snapshot or result cache remains in the gateway afterward.
Opening the picker reads the preview again, or asks the live owner to reload its local model catalog.
Ordinary observations do not install a catalog.
A successful changed catalog retires the old choice versions, not conversation preferences or tasks; an invalid read installs nothing.
The preview and live owner share `model-catalog.ts` projection/validation, capability rules, credential redaction and limits; changed source files across discovery refuse the read.
Preview choices are local draft intent, persisted with the conversation's text draft where browser storage works; folder setup uses the same explicit new-conversation handoff described above, not an existing/linked conversation.
A stopped project's retained conversation model precedes the account default.
Preview candidates are configuration observations, never a claim of provider availability or an installed choice.
Send captures that exact preselection before startup, checks it against the live catalog and installs only that choice through the existing conversation-bound model command.
An unavailable choice refuses without substitution and keeps the draft; a lost choice reply is never automatically retried or treated as a sent message.
The post-choice read must match the confirmed version and source selection before continuing; departure, changed owner/choice and stale reads cannot rebind the Send.
A locally pending different model requires explicit plan validation before approval.
Validation captures and installs that exact selection, shows the fresh execution binding and consumes the local model draft only on its matched successful response; it never sends the text draft.
A live picker retains its existing explicit server choice behavior.
Preparation/connection remain neutral progress, and preview or live read failures offer a readonly retry; an installation build difference is not a model restriction.
Opening/refreshing a panel never prepares execution, restores a preference or submits a message.
A retained preference without a catalog remains last-used, not guaranteed usable.
`web/src/client/use-model-catalog.ts` binds one readonly catalog to the scoped client, observed owner epoch, attachment generation and conversation context revision; readiness recovery, replacement and explicit refresh invalidate old data and read again, without polling model sources.
When execution is not ready, the optional gateway preview reader has its own scoped lifetime; switching sources/clients, readiness recovery and explicit refresh invalidate obsolete preview results before effect cleanup.
Obsolete reads are aborted and their late results ignored even before effect cleanup; a choice finishing in an obsolete lifetime cannot update the picker or resume a waiting Send.
The composer and picker share that catalog for the displayed/captured model rather than a separate retained model ref; the original Send still captures its own fixed intent before preparation or model-choice waits.
It locks choices while this conversation's reply is live; another conversation's work does not prevent choosing its own model.
Its scope note names future messages in this conversation, not every project conversation or already-admitted work.
A Send with no installed model and no remembered preference opens that panel instead of failing; the message waits there and is sent once after one explicit choice, or not at all if the panel is dismissed or sending stays impossible for ten seconds.
Both preview and live choices can complete that waiting intent; a preview choice is marked for installation, never treated as an installed choice.
Continuation keeps the original message/images/head/command ID and prepared owner epoch, waits for authenticated readiness and never runs owner preparation again.
A known Stop, replacement epoch or dismissal retires the wait and keeps the local draft; choosing a model cannot restart a stopped owner.
Cadence exit preserves an unconsumed model draft on direct success and on receipt observation alike; only an ordinary/coordinator Send's own persisted command marker permits receipt observation to consume that draft.
Older or unknown receipt kinds conservatively keep the model choice, never infer consumption from text or a different command.
Remembering the chosen model is best-effort: a broken preference file never fails or reverts an installed choice.
Exit does not require a usable selected model.
There is no Legacy task creation entry or task composer.
The obsolete task-to-conversation navigation API is removed; stored task links and task evidence remain untouched.
The old task inspector is readonly content/check/change/review evidence, never an editor or execution control; no old task/history is rewritten into a new workflow.
Browser conversations are the project's Pi sessions, shared with the terminal rather than imported (see [Ordinary conversations](#ordinary-conversations)).
Shared history does not transfer native terminal grants, tool-restoration state or browser plan approval: mode and confirmation authority remain per surface.
All of this works without a live Pi terminal.
A final Send needs an `accepted` receipt for its original command ID; another result kind, even with that ID, leaves its outcome uncertain.
A later record of that command in this conversation resolves the uncertainty without another Send.
An unrelated terminal append advancing the leaf or another tab's live reply does not acknowledge it; the pending draft cannot be steered or queued into that reply.
A definite pre-acceptance Send refusal preserves the draft and permits another explicit Send or mode exit; it does not pin an impossible pending turn.
A token grants workspace access, not action consent.
Ordinary Send binds its exact text, session entry it continues, conversation/cwd, epoch, access and selected model; stale/duplicate/lost replies do not silently replay work.
The WebUI provides task/run/assignment navigation, long retained messages and tool detail, exact literal search, timeline and complete scoped NDJSON/Markdown downloads.
Desktop panes and phone drawers retain cancellation and keyboard controls.
`web/src/layout/AppShell.tsx` owns the one shared topbar, More menu, navigation/files panes, resizing, focus-contained drawers and statusbar for both folder setup and selected conversations.
It also heads the inspector with its tabs and a collapse button, which folds the pane exactly as the topbar toggle does.
Its chrome is conversation-first: a compact topbar, collapsible conversation navigation, transcript/tool cards and a bottom statusbar; the inspector is closed by default, including before a folder is selected.
`FolderSetup.tsx` supplies only initial input and guidance; the superseded `WorkbenchHome` and its project-list navigation are removed.
Cross-folder active work remains in the existing sidebar discovery, and service management remains in More, not a separate home.
Desktop navigation/inspector visibility and widths are display-only browser preferences, written on explicit choices, never service state.
`web/src/layout/workspace-layout.ts` owns the shared pane bounds and center-space budget: a narrow desktop overlays the inspector rather than squeezing the conversation, and both pointer and keyboard resizing account for the other docked pane.
Effective widths shrink without overwriting wider-window preferences; phones use independent drawers, and overlays retain focus containment, Escape, a backdrop and inert covered content.
Headings and messages share the reading width; the composer frame allows inset padding and its toolbar wraps instead of pushing controls out of a narrow center.
The topbar's More menu holds Refresh status, Disconnect this page (detach; started work keeps running) and diagnostic build metadata; the statusbar shows only connection state with the service round trip, the open conversation's context size, cache hit and turn count, a live reply's elapsed time, active runs when there are any and the working folder.
Its items are compact icon-and-value observations (`web/src/layout/StatusItem.tsx`) that wrap rather than clip; the elapsed time counts from the live turn's recorded start and is absent when that start is unrecorded.
The open conversation reports its own turn count, live turn, context size and session cache totals to the statusbar; another conversation's last report is never shown for it, and no cost, generation-rate or host-resource figure appears there.
The connection item appends the service round trip in milliseconds (`web/src/client/latency.ts`): the fastest of the last minute's requests to this origin's service API, from the request leaving to the reply's first byte, read from the browser's resource timing of requests the page already makes.
It sends and polls nothing, includes the service's own time for that fastest request, is green below 100ms, amber below 300ms and red from there, and is absent while no request is recent or while the connection is being made, stale or lost.
The context item (`web/src/layout/ContextStatus.tsx`) states the tokens the head read reports (see [Ordinary conversations](#ordinary-conversations)) and, when the model catalog already read for the composer has an entry for that reply's provider and model with a context window, the window beside them and a ring filled to the share in use: green below half, amber from half and red from four fifths.
Without such an entry it states the tokens only; after a compaction, or while the head read states no context size, it is a dash.
Its title states the figures with the percentage (a figure above the window as more than 100%, never clamped), says the figure is as of the last completed model response and leaves out the messages after it; it adds no read or poll of its own.
The cache item (`web/src/layout/CacheStatus.tsx`) states the share of the session's input tokens read from the provider's prompt cache, from the head read's session totals, green from 70%, amber from 40% and red below; its title gives the read, written and uncached counts, and it is a dash while those totals state no input tokens.
The current conversation folder stays in the lower-right statusbar, without a duplicate directory line beneath the conversation heading; its chip shows the folder's own name, with the whole path as its title and in the picker.
The conversation header holds the title (the session's name once it has one), a quiet note of the mode and where the session started (left out on phones, where the composer's Cadence control and the sidebar row say the same), an Archived mark for a conversation the history leaves out, the branch count of a forked session (it opens the Branches tab) with the way back to the latest branch, and the current plan disclosure when a proposal exists.
The controls can wrap on a narrow screen.
The connection item is an always-present keyboard disclosure.
Its summary names confirmed states; during read recovery it stays neutral.
Opening it shows per-source diagnostics, a readonly refresh, or a sign-in action when access was revoked.
No observation failure inserts a row above the conversation or task; unrelated operation errors remain separate.
A transient local result is a toast under the topbar (`web/src/layout/toasts.ts`, browser-local): a copied link, a failed copy, or a refusal that reached no owner (a Send, image, rename or archive the browser itself refused, or one the owner answered with `effect:none`).
An error toast stays until dismissed or until its conversation's next attempt, the others pause while hovered or focused; an unknown outcome, an owner-side effect (execution prepared, a Stop or approval reply) and every observation statement stay in place, never in a toast.
It never claims retained history is displayed when none was read, nor diagnoses a stale code as a model-source failure or prescribes service startup.
Missing history/files have explicit reading or unavailable states, not empty success; Files names the conversation directory rather than the host `/`.
The Files pane is a crumb trail from that directory (its name, never a bare root), a `..` row for the parent and one row per entry whose actions appear on hover or focus and stay visible on touch screens: download (files only), reference path only, copy name and copy path, which is the entry's full path on the service host.
A download (`web/src/client/file-download.ts`) reads the file's exact bytes through `file-part` reads, one file at a time, refuses a file whose parts disagree on size or version rather than save a mixture, and hands the bytes to the browser's save picker or an ordinary download; a refusal is a toast naming the file, leaving the folder's conversation abandons the read, and nothing claims a completed save.
Its name filter narrows the entries already listed and reads nothing; the readonly/reference statement, which also says that a download is the file's own unredacted bytes, opens from the help crumb, while bounded-listing and limited-preview notes stay in place.
A previewed file is shown verbatim through the Markdown code renderer: numbered lines, a copy action and, for a known extension, the bundled highlighter.
The composer's Cadence control names off, armed for the next Send, confirmed on and unobserved states distinctly, including on phones; arming is neither a confirmed mode change nor plan approval.
Beside Send it shows **Ordinary send** until armed.
Off, it arms Cadence for the next Send (or clears a typed `/cadence`); on, it is the mode exit, alongside the typed `exit cadence`.
In an observed new conversation the welcome and composer share the center; clicking **New conversation** in the sidebar enters that centered layout immediately and focuses the editor while background reads verify the freshly minted session ID (retiring immediately to the real error/history view if any read fails or finds records, and backing off idle context/mode polling once confirmed empty; clicking **New conversation** again while already on an untouched empty conversation focuses the editor without remounting).
Passive reading placeholders and the initial unobserved-context composer notice wait a brief grace period (`READING_GRACE_MS`, 180ms) before showing the header reading bar and reading silhouettes so fast local switches settle cleanly without a flash; real read failures surface immediately, and Send still requires confirmed context, head and mode observations.
The two starters fill an empty draft only; existing records use the dock immediately and a confirmed first receipt moves the same editor there without replaying the command.
The model and thinking level stay visible on the closed picker.
The composer (`ChatComposer.tsx`) edits the conversation's draft and holds no message state: its text area grows with the text up to a bound, and a keyboard-operable handle on its top edge sets a fixed height remembered in that browser.
Up and Down on the first and last visual line recall the prompts this tab sent in the checkout (Escape returns to the draft), and an `@` typed there opens a popup that completes a path one folder at a time from the bounded Files listing and inserts the same path reference as the Files pane; none of these sends, reads a file's contents or starts anything.
The question rail sits beside, not over, the native scrollbar.
Its marks reveal labels or the list on hover or keyboard focus; the same arrow-key group jumps to loaded or earlier messages, and phones still hide it.
Plans use a neutral decision card, not the error-banner style; unavailable approval explains its blocking observation/turn/attempt without changing any admission gate.
The sidebar lists active conversations before the paged history.
A reply, its linked active workflows and shared-history terminal reports from the selected project share one row per session ID, even without a summary or outside the loaded page.
A static activity mark is separate from the selected background; changing elapsed time or workflow phase does not rewrite the row.
A stale observation is not a settled run.
Eligible history rows offer Rename and Archive (`ConversationRow.tsx`), revealed on hover or focus and always shown on touch screens.
Rename turns the row into a field: Enter or Save requests the name, Escape or leaving the row keeps the recorded one, an emptied field clears the name so the first message titles the conversation again, and a name over the limit is refused in the browser.
The history heading's archive control swaps the list for the archived conversations (the `conversations` read with `archived`, read only while shown and never on a timer), each with Unarchive; a failed read there says so and is never an empty list.
Each request is one command and nothing is changed ahead of it: the row says what is in flight, an accepted or unknown outcome re-reads the lists (and the head of the conversation, when it is the open one), and only those reads change a title or a list.
A refusal that changed nothing is a toast, and an unknown outcome stays under its row without a retry.
When the live owner cannot take a history action, the button is disabled and its reason is available on the control and in the footer's connection details; readiness changes never insert a notice into the history or archive list.
History rows are grouped by this browser's calendar day (today, yesterday, earlier), and a filter box narrows the rows already listed by title and reads nothing: active rows are never filtered, and pages not loaded are not searched.
The row disclosure keeps each terminal’s explicit session/leaf navigation and each owner workflow’s exact-run controls separate; unattributed work has its own compact disclosure rather than a fabricated session.
The lower-left Subagents dock follows the open conversation, not the whole activity roster.
Active candidate IDs come from that conversation's owner-issued roster links; retained IDs in Pi or browser history are hints, not ownership (a fork may copy them).
The chat lines and dock share one workflow reader.
It admits a run only when the returned ID matches the request and its immutable `execution.version.conversation.id` matches the open session; a foreign or unattributed run supplies no rows, counts, transcript link or further live polling in this conversation.
The dock shows this conversation's active and recent observed runs.
Switching conversations retires the old reads; a legacy task view shows only children from the selected task snapshot, without scanning other tasks.
The dock is only as tall as its rows, up to its default height, until a drag sets one; it stays folded while empty unless opened, and its heading count leads the total with the queued or running agents (`2 active · 5 total`).
Workflow subagents are grouped per run, live ones first: a group's head names the run, counts its assignments by state when the run lists them (queued ones have no row yet) and opens the run's own view, and a row whose step works on an assignment shows that assignment's state under the step's own status.
When a workflow ID list changes, observations of still-listed live runs survive failed re-reads and remain visibly stale; changing client identity retires the cache.
A compact sidebar list notes only partial, redacted or omitted recording coverage; complete coverage needs no note there.
It is not a subagent engine.
The right sidebar uses the current conversation's cwd for readonly files, bounded text previews, downloads and path-only references; retained content/check/change/review evidence occupies its History details tab.
An open conversation adds a Branches tab: the session's user messages as a tree with one rail per fork level, the branch shown marked by a filled dot and weight as well as its tint, a filter over the rows listed, a click that shows a message in its branch, and per-row "Edit and resend" and "Continue from here" (see [Ordinary conversations](#ordinary-conversations)).
The lower-right folder button contains recent directories and selects one on the service host without starting its independent owner.
The unified entry switches project clients on the same origin, including an explicitly configured HTTPS proxy; it never changes a running task's cwd, registers a boot service or cancels the project left behind.
Backend cookies and native capabilities never reach the browser; proxied actions remain browser-authority actions, with owner-side consent/CSRF checks.
The gateway refuses the legacy project-level Open command and has no browser Open-start endpoint: selection and explicit execution preparation are separate routes, neither returns an independent backend token link.
Direct legacy project entries remain available; only that compatibility route retains its older loopback-only cross-project navigation.
The interface is in English or Simplified Chinese: it follows the browser's first preferred language, and the topbar's globe chip (`中文` / `EN`) switches it, remembered only in that browser.
Mineral Alabaster and Obsidian Optical follow the system until the theme chip selects a scheme; the browser remembers that choice and applies it before the first render.
`web/src/optical-tokens.css` supplies the palette, rims, recessed code surfaces, reading measure and material tiers, including history trace swatches.
The welcome screen uses the same plain background as the transcript.
A selected conversation with no durable turn still shows the transcript rather than the welcome screen when its head reports an attempt, waiting input or an undelivered message; the body, status and applicable recovery action remain visible.
The script-free access page follows the system's scheme without storing a separate preference.
Error codes, identifiers, commands and recorded content stay untranslated.

### Image admission

`web/src/client/images.ts` uploads only on explicit Send, in bounded `image-upload` commands through the existing build/Origin/CSRF/attachment checks and gateway routing.
The owner keeps staging in `conversation-images.ts`, bound to the full original command (including mode revision, context/model and head), authenticated attachment and access generation.
Upload is not message admission, model selection or mode entry.
A lost upload reply abandons that continuation; a lost Send reply observes only its original command ID.
There are no image-specific count, byte or dimension quotas, including for incomplete staging; idle staging is ineligible and swept on the next upload, and is cleared on owner close.
No consumer file is cleaned.
At admission the exact selected model must support images and the live turn takes the bytes independently of viewer departure.
Only image count enters the public worker request; the owner-only fd 3 payload is bound by its exact byte length/SHA-256 in the private envelope.
IPC stays on fd 4: credential replies, a coordinator's tool calls and the messages sent into a running reply, which carry no images.
The worker verifies the payload, declared count, format/dimensions and pinned model capability, then supplies Pi's public `prompt` image option.
Pi alone writes the durable content.
Preview Blob URLs are created only after the shared format/header and nonzero-dimension check.
The composer keeps its image action and previews without a permanent format, quota or draft-retention help paragraph.
The browser's unsent images stay in memory, not sessionStorage; its draft controls lock during a pending Send/model choice.
Image-only turns are valid, but images never authorize a plan or mode exit.
Text redaction cannot remove secrets contained in image pixels.
File header/dimension validation is not an image codec or sandbox.

## Ordinary conversations

Ordinary conversations run through the same isolated SDK process launcher, exact model/auth sources and orderly Stop as tasks.
A conversation is one of the project's Pi sessions, the JSONL files the terminal writes: the WebUI lists and reads them, and a browser turn's worker continues one with Pi's own `SessionManager`, so the terminal and the browser share one history without copying or importing it.
A rename is the same kind of write: `conversation-rename` lets the fixed-purpose `src/session-rename.mjs` child append one `session_info` entry through Pi's `SessionManager`, as the terminal's `/name` does, and is acknowledged only once the owner reads that name back from the session; an empty name clears it, so the first message titles the session again.
The owner refuses a rename while a browser turn is live in that session (its worker holds its own copy, so the entry would become a side branch), while another rename of it runs, for a session Pi has not written and for a name its reads would redact; a Send to a session being renamed is refused as a conflict, and a repeated rename command observes its original outcome while this owner runs.
The child opens only an existing current-format file whose header names that session, ends a torn last line as a browser turn's worker does, and is the owner's accepted work: Stop signals it and an unknown closure quarantines.
A terminal holding the session keeps its old name until `/resume`; its next message leaves the name record beside it, which the reader does not count as a branch.
The session directory follows Pi's precedence: `PI_CODING_AGENT_SESSION_DIR`, then `sessionDir` in the project's `.pi/settings.json` or the agent directory's `settings.json`, then `<agentDir>/sessions/--<cwd>--`; session headers bind their own cwd within the owning checkout.
Same-checkout subdirectories share the owner's readonly session cache, not one execution cwd; another account's agent directory is never adopted.
Each browser turn records `cadence-browser-command/1` after each finalized Pi message, naming its actual user entry and owned prefix through the worker's public SessionManager; command identity and parent/offset checks, never prompt text, associate its entries.
New markers optionally name the capture message UUID (`captureMessageId`); that occurrence plus the real content index identifies each preview and durable block, including messages with no visible text.
The reader validates command/run/user/parent/branch ownership before using the link and withholds an unmarked Pi tail during live handoff; neither equal bodies nor the number of visible messages establishes a match.
Old markers and terminal history remain readable under their recorded identities, without invented capture links.
A message sent into a running reply is recorded the same way under its own command, from the user entry Pi writes for it, and also names the reply's command (`run`); the reader splits the run's entries where each such message began.
A browser-created session carries a `cadence-webui/1` custom entry, which Pi keeps out of the model context; the terminal resumes it with `/resume` or `pi --session <id>` like any other session.
Pi writes each message when it ends, raw: thinking, signatures and tool output are stored as the terminal stores them, and the owner redacts its credentials from everything it returns instead.
Read redaction uses the owner's current literals, or the last ones observed while the model configuration is reloaded or edited; without any, reads refuse rather than return unredacted content.
The owner never rewrites, repairs or deletes a session file; its own private `service-v1/conversation-commands-v1` records each browser message's admission (command, the entry it continues, the file size then, status, auth journal and native closure), never content.
A message sent into a running reply has the same record with that reply's command in place of an entry to continue; the auth journal and native closure are the reply's.
Archiving is the owner's own record too: `conversation-archive` writes or removes `service-v1/conversations-v1/archive/<session>.json`, whose presence is the whole fact, and never moves, rewrites or deletes the session file, so `pi -r` still lists the session.
The record covers the checkout: one owner lists every same-checkout session, and other checkouts are unaffected.
Ordinary turns in different Pi sessions can run concurrently on the same checkout, even when a workflow holds its exclusive permit.
Their tools operate on the host and can overwrite each other's edits.
An ordinary turn's first durable state is `starting`: the owner has accepted it and is preparing the worker, including auth.
This is an active, cancellable turn even before Pi writes a user entry; neither `starting` nor the switch to `running` after auth is evidence of model output.
A coordinator Send still begins `queued`; workflow transcript statuses and the queue for further messages inside one reply are separate from ordinary Send startup.
Leaving a tab only detaches; Cancel targets that turn alone, while owner Stop signals all its turns.
A signalled worker aborts its Pi session first so the session records the interrupted reply as Pi does.
Access-token rotation revokes viewers, not admitted turns.
Each admitted turn/workflow records its original execution context; later workers never consult a mutable conversation/owner picker to replace it.
File views follow the retained conversation cwd, and directory navigation does not rewrite that cwd; choosing a different folder opens a separate conversation context.
The UI labels recorded context as fixed at admission, not as proof that tools ran.
Older records without a snapshot stay readable without invented model/directory evidence.
A Send names the entry it continues: the composer's anchor when one is set, else the end of the branch the browser shows; none for an empty session or a rewritten first message.
The owner admits one browser run per session at a time; a terminal may write the same session meanwhile, and a message continuing an entry the session has since moved past starts a new branch, never a conflict or a rewrite.
While a run's reply is in progress, `conversation-input` sends it a further message, bound to that run and owner epoch and without a head, model or image: `steer` is handed to Pi at once and reaches the model at Pi's next opportunity (after the tool calls in progress, before its next request), and `queue` waits in the worker and becomes its next prompt once the reply has ended normally.
The owner records such a message durably before its worker hears of it and hands it over only once the worker's ready frame shows it listening; the worker tells Pi's deliveries apart by the order it handed the messages over, never by their text.
It is no admission of its own: the run keeps its admitted directory and model, one worker and one native settlement across every message; stopping the run ends all of it.
Nothing about a waiting message outlives that worker.
A reply that fails for good or is stopped delivers nothing further (the worker takes back what Pi still holds before Pi can continue into it), a reply ending just as a message arrives may leave it behind, and each such message is recorded as not delivered: nothing sends it again.
`conversation-input-cancel` withdraws a message Pi has not been given, at once while only the owner holds it and otherwise when the worker confirms it was still waiting; one Pi holds or has delivered refuses as a `conflict` that changes nothing.
The bounds are in [limits](limits.md).
The WebUI offers both from the composer while a reply of this conversation runs (`ChatComposer.tsx`, `conversation-inputs.ts`): with text typed, a split control beside Stop queues it behind the reply or steers the reply, and Enter steers while Alt+Enter queues; Stop stays.
The text is offered only when it has no image, would not turn Cadence mode on or off, no send anchor is set and fewer than eight messages wait; otherwise the composer says which of these holds and the draft stays.
Only an accepted command clears the draft; a refusal that changed nothing is a toast with the draft kept, and an unknown outcome keeps the draft and leaves it to the next head read, never a second command.
Waiting messages (`pending`) are listed after the transcript as the user's own dashed rows with how each was sent (`WaitingMessages.tsx`): each can be withdrawn, or withdrawn and put back into an empty message box when its whole text is known (this tab sent it, or the head's 256 bytes are clearly all of it); a withdrawal refused because Pi already holds the message says so.
A message its reply ended without delivering (`undelivered`) is shown with its reason and a control that puts its text back into the message box; nothing sends it again.
The transcript shows a delivered message as the ordinary turn it is.
A turn whose entry Pi never wrote (a refusal before any model call, or a Cadence control reply) is shown after the branch end it was sent from until the branch moves on, and so is each message its reply ended without delivering (`undelivered`), with its reason.
A turn reports unreadable thinking, omitted media and unrecognized (`other`) blocks as `omitted` flags, never as a `notice` line, so a later failure reason is not displaced.
The thinking flag a live capture records for its message stays in that record but is not reported: the capture carries no thinking body or signature, and the session holds what Pi wrote.
Body-free thinking activity carries only its occurrence, real content index and phase; it occupies the same timeline position as a later readable Pi block, or ends explicitly unavailable without a fake detail affordance.
A failed or interrupted turn stays in the session with Pi's own error or abort record; the next explicit Send continues the branch, where Pi skips errored replies and closes orphaned tool calls.
A restart never resumes pending turns.
After the previous owner's death, a turn still recorded as `starting`, `running` or historically `queued` reads as interrupted (`unknown`); the read does not rewrite its record.
It does not prevent startup once the previous owner's workers have been stopped by exact identity; an unconfirmed native closure still does.
A message sent into a reply shares that reply's worker and follows it in both cases: left queued by a dead owner it is interrupted, and an unknown closure of the reply leaves it unknown too and refuses startup even when the session's newest record is such a message.
There is no upstream goal/delegate loop, subagent tool/template pack, PTY, plugin loader or prompt composer.
SDK-native automatic compaction is enabled, and terminal `/compact` entries are honoured when continued; original history is retained.
The service-owned SDK session retries transient model-request errors with the bounded policy in `src/worker-model.mjs`; native Pi's main dialogue retains its own settings, which Cadence neither changes nor copies.
The owner projects credential-free waiting/requesting progress separately from error notices; refresh observes the same admitted turn and never resends it.
That progress carries the provider's reason when the worker could keep one, and the retry line shows it.
Pi keeps failed attempts in raw history and appends context edits to omit them from later model requests; completed tool results remain in context.
Low-level `agent_end` and retry-end events do not establish turn completion: the original prompt, actual stop reason and native/auth/storage closure still decide the result.
Ordinary resources are Pi's base prompt, applicable `SYSTEM.md`/`APPEND_SYSTEM.md`/project instructions and the default skill directories, loaded on demand at Send; package extensions and package-discovered resources are not loaded into these workers, so a terminal extension's tools are shown in history but not offered to a browser turn.
When a turn's model or thinking level differs from the session's, the worker records the change, so a terminal resume keeps it.
Conversation and per-conversation turn counts have no lifetime admission cap; only active-work concurrency is bounded.
History lists the project's sessions that are not archived by last modification, newest first, 50 per page, and a read may ask for only the archived ones instead; active conversations use a separate roster and never disappear merely because an older history page is selected.
An archived conversation stays in that roster while a reply runs and still reads by link, where its summary says it is archived; the stopped-owner reader applies the same records.
Listing reads each file once and then only what Pi appends, ignoring a torn final line; a replaced or shortened file is read again from its start.
A conversation reads one branch, named by its last entry, as one continuous transcript: the head read gives the summary, the branch end, whether it still continues the one shown before, the branch and leaf counts, the terminal's workflows and the branch's context size; each turn (a user message and what followed it) is read by position as listed steps, and a step's full item is read separately in parts that each fit one reply.
While a reply runs the head also lists the messages sent into it that Pi has not written (`pending`: command, mode and a short prefix of the text), oldest first, so a client can show them beside the reply and withdraw one.
The context size is what the branch's last completed model response reported: its token total by Pi's rule for a valid usage (a reply neither failed nor aborted, above zero), with that reply's provider and model, both redacted like other session text.
It leaves out Pi's own estimate of the messages after that response, is unknown (`null`) once a compaction follows it, and is absent when no such response lies within the reader's walk of the branch end; a live browser turn counts the entries Pi has written for it, so the figure follows each model call.
The reader has no model registry, so it never states a window or a percentage: the model catalog and the gateway preview give a model's context window when its source states a positive one, and matching that to the reply's provider and model is left to the browser.
The head also states the session's cache totals (`cache`): the input tokens sent uncached, read from the provider's prompt cache and written to it, summed as Pi's own session statistics sum them, over every usage record of the session file (usage entries, compactions, branch summaries, assistant messages and tool results) on every branch.
They are folded while the file's lines are indexed, so no body is read for them and an appended line is counted once; a count Pi could not have recorded adds nothing, a replaced file is summed again, and the field is absent while the file records no input tokens.
A turn read names the turn's last entry and the entry its user message continues (the parent Pi recorded, which may be an entry that is not shown, or the admitted head while Pi has not written the message): a Send from the former continues after the turn, and one from the latter starts a branch beside it.
Without a chosen branch the WebUI follows Pi's current leaf, the entry appended last; a live browser run ends the branch where its newest message began until it settles: the entry it was sent from, then, each time Pi writes a message sent into it, the entry that message continues.
The run's earlier messages are by then ordinary turns of that branch, each ended as Pi recorded its reply, and its newest is the one live turn.
A head read that names an earlier end of the live run follows it to the current one, so a client that chose the branch it sent from keeps the run in view; turn, step and image reads name their branch exactly.
A listing never carries a tool's arguments or output or a thinking block's text, and keeps at most 16KiB of message text; the WebUI reads a tool's detail or a thinking block's text when its step is opened and a clipped message's rest when it is shown.
Optional `renderId`, full-redacted-content `version` and explicit block `state` separate rendering identity, data revision and execution observations from turn/step/part read coordinates.
The live turn header's `activity` is the last actual capture event kind and sequence, not a progress estimate or execution receipt; optional tool names follow the [read-time redaction contract](history.md#ordinary-conversation-records), not only capture-time sanitation.
Terminal `!` commands, compaction and branch summaries and displayed extension messages are listed as steps.
A readable thinking block is a step of its own role in its recorded place, read in full through the step-detail read like a tool's output; its signature is never returned.
Thinking Pi stored unreadable (redacted, or a signature without text) and unsupported media are flagged as omitted.
Supported user images are small entry/index/MIME descriptors on their exact branch.
A live turn extends that view only with its verified command-owned prefix, the entries of the run's newest message; before Pi flushes a new session, explicitly marked live-command descriptors read only that admitted turn's in-memory input, not arbitrary descendants or another durable store.
Authenticated `conversation-image` reads return bounded parts, including through stopped-owner readers; the browser creates and revokes local Blob URLs.
A chat image, recorded or still an unsent draft, opens enlarged in a modal viewer with zoom controls over its own Blob URL of the same validated bytes; opening it reads and sends nothing.
No session paths or remote image URLs are returned, and no session is rewritten.
Timeline loading and resize-follow behavior are defined under [Scroll intent](#scroll-intent).
A jump to a message not shown yet (a bar of the question rail, a Branches row, another version) reads back to its turn, every turn in between included because the shown turns stay gap-free, and a branch entered at one of its messages opens there rather than at its end.
It polls the small head every second while a turn is active (including `starting`), every ten seconds otherwise; a settled turn is read again only when the branch grew inside it, and another branch is read afresh.
Branch navigation aborts obsolete readonly requests, including an away-and-back selection, and invalidates observation until the chosen head is read; it never cancels accepted work or enables Send from the previous branch.
The branch shown (the view) and the entry the next message continues (the anchor) are separate: the view is chosen from one `conversation-tree` read for the branch shown (Pi's `/tree`, user messages only; made again when that branch gains or changes a message, not for each entry of a reply), which feeds the inspector's Branches tab, a version pager on each message where the session forks (the user messages that follow the same earlier one) and the question rail; choosing any of them only reads.
The anchor is the end of the view unless one is set: "Edit and resend" on a user message sets it to the entry that message continued, loads the message's text into the composer and reads its images back as bytes into the in-memory draft, and "Continue from here" on a turn's last message sets it to that turn's end with an empty draft.
The turns the new message will not have in its context stay shown, dimmed under a divider that says so, and a strip above the composer names what is rewritten or continued, states that only the conversation is rewound (files on disk are untouched) and has Cancel, which restores the draft set aside; an accepted Send restores it too and follows the new branch as the latest.
An anchor is kept with the conversation's draft in sessionStorage, is released when another branch is chosen, and is not offered while a reply is active; a service that predates the turn's `parent` leaves a rewrite only where the previous shown turn's end can stand in, never for a first message.
Nothing is moved or deleted, and setting or cancelling an anchor sends nothing.
While a terminal holds a session, its extension notices entries it did not write (a name recorded from the browser is not one) and suggests `/resume`; a message sent there first continues from where the terminal is, as a new branch.
Pre-Pi Cadence conversations are no longer supported.
Their identities are refused as `retired-conversation`, never reused as empty Pi sessions; start a new conversation.
Old files remain untouched, without a migration UI/API or checkpoint decoder.
Older versions read neither the shared sessions nor messages sent since; going back leaves those conversations unreadable there.
Task history retains its existing independent bounds.
File browsing lists at most 200 entries from 2000 directory entries and previews at most 128KiB of UTF-8 text.
It refuses symlinks, hard-linked files, private state, Pi's agent directory (including its configured alias target), `.git`, `.env` variants, common credential directories such as `.ssh`/`.aws`, and credential/config filenames; limitations remain visible.
A download reads a file's exact bytes in parts of `FILE_PART_BYTES` (192KiB, whose base64 fits one reply) and refuses a file over `FILE_DOWNLOAD_BYTES` (64MiB) as oversize; each part states the file's size and an identity that changes with the file, and a part past the file's end is stale.
It keeps those path refusals and the preview's stale checks around every read, but the bytes are the file's own: unlike the text preview they are neither decoded, scanned nor redacted, so a project file that holds a credential downloads as it is.
A live owner answers these reads; while it is stopped, or before the folder was ever prepared, the gateway's stopped-owner reader answers them with the same directory rule (`assertConversationDirectory`), bounds, refusals and redaction, writing nothing and starting nothing.
Without readable Pi sources to redact with, it refuses rather than return unredacted bytes.
This is not a filesystem sandbox for model tools.

## WebUI contracts

`src/abort-scope.ts` owns finite local cancellation lifetimes with AbortController, listeners and an optional timer, without static `AbortSignal.any`/`timeout`, polyfills or dependencies.
A scope takes the first source reason (including pre-cancellation), removes listeners/timer on cancellation and is disposed in `finally` on normal or exceptional completion.
Disposal never cancels sources or service work.
Finite HTTP scopes cover fetch, the entire bounded body and decode; streaming export retains its separate existing budget.
The browser transport bounds ordinary requests too, so a stalled fetch cannot freeze its polling loop.
One client-chosen attachment ID survives a lost session header or body; a session read on that same ID recovers CSRF so detach can release it before replacement.
Retained readonly GET requests do not carry an execution attachment.
Each observation poll checks the existing session too, so an ordinary chat without a socket keeps its viewer alive and detects owner replacement even when its model list is unchanged; session, workspace, active-roster and snapshot epochs must agree before readiness is reported.
Routine reconciliation on the same current viewer leaves confirmed controls in place while the reads are pending; it does not flash a disabled history list or interrupt a rename.
Reading a conversation's first head, following a live reply or recognizing a previously sent message updates the conversation, not the viewer's action ticket; history and running-work lists have their own reads.
A session that withdraws action capability disables controls immediately, and restoring it requires a completed current observation.
Explicit refresh still invalidates the previous observation immediately.
Detach is idempotent after authenticated release, including after a lost reply, so gateways can retire the exact viewer mapping; a refused old CSRF is recovered by a readonly session check on that same ID before the next detach.
The serialized observer retries transient acquisition/detach failures and Refresh can reconnect it immediately; failed observation never requires a new Send or a page reload.
Access revocation still stops observation until the user authenticates again.
Reattachment never renews a plan grant, repeats a user command or cancels admitted work.
Send and plan-validation preparation use one scope through gateway observation, POST and fresh attachment; their shared budget is defined beside `SEND_PREPARATION_MS`.
History images keep one scope across all pages; parallel detail parts each dispose only their own scope, so an early Promise.all rejection cannot disconnect still-pending siblings from navigation cancellation.

Complete project/chat selection is parsed in `project-route.ts` without storage; explicit links take precedence over same-browser recent-project restoration (user-facing resume boundaries are in `docs/conversation-mode.md`).
The chat hash also names a chosen branch (`leaf`): the conversation replaces it in place when the branch shown changes, which is no navigation, so a refresh shows that branch again and following the latest removes it.
The owner running, this gateway being associated with its project, and the viewer having current data are separate facts; none states the outcome of work.
A running but unassociated owner is browse-only: the history stays readable without allocating viewer sessions, and browsing does not invoke execution preparation.
An authenticated workspace read supplies a history-only CSRF challenge for bounded read bodies.
Pagination carries the reader's original continuation, not a new query or execution CSRF; the gateway translates the challenge only on the binding that issued it.
Owner credential expiry retires that binding without expiring the gateway login, evicting a successor or replaying the request.
A failed/unavailable readiness read retains earlier history identity but marks it stale/unknown; a pending re-observation or epoch change cannot make a retained value current.
Positive stopped/not-started observations keep preparation guidance in the statusbar, not a global banner; explicit Send still displays its local preparation progress.
First observation, transient failure and resync keep the same neutral connection item, without a recovery prompt, banner or ready claim.
Readonly retries continue in the background; coming online wakes a waiting entry read.
Explicit action errors and permanent access refusals remain distinct from read retries.
The closed footer never announces automatic repairs.
Recovery records remain available to the service diagnostics.
A positive observation, not another attempt, clears the last failure.
A successful project GET does not complete an outstanding explicit viewer read.
Chat context, head and workflow read failures share the footer disclosure.
Retry rereads the failing sources without discarding known workflow rows or clearing the outcome of a Send, approval or Stop.
`test/web/stale-banner.test.tsx` renders the actual App in English and Chinese with controlled viewer/project results and callback lifetimes.
Together with the protocol fixture in `send-observation` this checks state and handler wiring, not a mounted browser, actual keyboard focus, viewport geometry or live service availability.
App preserves a safety attachment through an inconclusive read of the same selection, not across an epoch handoff or an observed workspace identity mismatch.
Stop and running-reply input handlers check the rendered allocation at dispatch: replacement retires them before React commits, even at the same epoch.
Only the explicit preparation awaiting a fresh viewer can take its new action ticket.
A revoked viewer cannot regain authority from a successful project read; the sign-in action reloads the authenticated entry, without preparing execution.
Retained work counts are labelled as last-observed, and local, project and viewer errors remain visible together.

WebUI text is keyed by its English source: fixed text goes through `useT().t`, whose type requires a `web/src/i18n/zh.ts` entry with the same `{name}` marks, and run-time status words or kept notices through `tx`, which passes unknown text and codes through.
The timeline client takes the chosen language from its bridge and is remounted on a switch.
On the loaded history page, a tool update takes its list and lane swatch from an explicitly named start or end with the same epoch, run, child and call ID.
An update with no matching name or disagreeing endpoints stays unassigned; the bridge never edits the raw event, clock or position.
The browser is conversation-first, including before any project is selected: ordinary chat and explicitly enabled Cadence conversations share its sidebar, while a lower-left dock observes actual Cadence child identities.
The empty entry has no project welcome screen or Create shortcut; its one central action, Choose a folder…, offers nonactivating selection, and its sidebar has no separate New conversation entry.
The bottom-right folder control is always present, and its picker lists recent projects.
Conversation history remains checkout-scoped, with each conversation's retained cwd shown independently of the directory-navigation entry; the unselected entry lists recent directories, and one click selects one without starting execution (all entries wait during selection; failure names that directory and selects nothing else).
An unselected first entry returns to the last selected project, remembered only in that browser as its opaque key, after one readonly observation finds its existing history identity; this is navigation, never Open, even when execution is stopped.
A never-prepared directory with no owner state may also restore into its empty conversation shell.
An unknown established history identity leaves a read-failure notice; any navigation or folder choice during the check wins.
The gateway observes execution readiness independently of conversation identity.
Stopped-owner ordinary/coordinator history, full stored steps, Cadence mode/plan cards and the conversation folder's files remain readable without an execution attachment, model runtime or implicit Open.
The Files pane is enabled once the selected folder has been observed, whatever its execution state, and reads again when execution starts, stops or is replaced.
The conversation shell keeps its selected directory/connection identity separate from the conversation cwd.
New drafts use a stable checkout/conversation key, never the owner epoch or the particular same-checkout directory entry used to open that conversation.
Known older history/directory draft namespaces remain usable in place; they are not copied or deleted, and an intentionally emptied primary draft stays empty.
Existing browser draft/pending namespaces are read and retained in place; new directories use that key before history exists, so startup cannot lose their drafts.
A positively observed new epoch replaces only the serialized execution attachment, never a pending Send or approval.
A stopped execution owner is labelled as such.
Message dispatch, server-side model installation, approval, rename and archive still require a live authenticated owner; local model preselection does not, and only a current explicit Send or plan-validation action may prepare one.
The gateway folder picker and draft remain available while stopped, and a failed first readiness observation does not hide independently readable conversations.
An unreadable context does not lock local draft editing; an in-flight or uncertain Send and its captured images retain their original locks and identity.
When conversation reads fail, the composer still accepts a new draft for preparation-only Send; it cannot infer a head or submit that message until a subsequent explicit Send observes the restored context.
Legacy task/workflow detail and active rosters remain owner observations; a failed observation is never displayed as proof of no running work.
Browsing or dismissing the picker never opens a project or sends a message.
The picker has no separate Browse step: its location trail, folder list and Enter in the path entry navigate; Use this folder names the exact selection.
Selection of a typed or recent path first makes one fresh readonly observation and selects only that canonical folder; a failed read selects nothing and keeps the typed path and previous listing in view.
The footer selection is disabled while any observation is pending, including the first one; a recent entry can supersede it with its own fresh observation.
Every navigation makes a fresh readonly observation, including retrying the same path after a read failure; it never prepares or replays a Send.
Folder browsing accepts `~` for the service account's home and reports a missing folder as `invalid`, a file or linked component as `forbidden` and a read failure as `unavailable`; the gateway passes these public codes on so the picker can explain them.
One service still owns one checkout.
The recent-directory list records only explicit selections in the same private namespace; navigation reads that directory's authenticated entry, never changes a live owner's cwd, imports Pi sessions or adopts another account's state.
The center shows ordinary/coordinator messages, exact plan cards and one line per workflow, plus retained legacy task text.
A workflow's line follows the newest turn shown that began before the owner accepted it (Pi's turn timestamp against the owner's acceptance time), so later messages follow it rather than it staying below the newest message; with no earlier turn left to read, a run older than every turn heads the transcript, an undated record ends it, and nothing is placed before any turn is read.
Workflows belong to the conversation, not to a branch: on any branch a line goes where its time falls.
The line names what a live workflow is doing (its phase and running steps) with an orderly Stop request, or how it ended: its status, local merge commit and owner-measured duration, plus the first line of the reason when it did not complete.
Once assignments run side by side (several at once, or one in its own worktree) and while any is still queued or running, the live line counts them by state (`implementing · 2 running · 1 queued · 3 done`) in place of step names; a serial run, and a service that lists no assignments, keep the names.
A completed run that recorded deviations says so on its line (`delivered with 2 deviations`), in words with a warning glyph; on a phone the state goes under the goal rather than being cut off.
Its steps, checks, delivery and diagnostics are not in the chat: the line opens the workflow's own view, whose steps link to each subagent's view, and the dock lists the subagents.
That view leads with every recorded deviation (what could not be met, why, what was delivered instead, the checks it set aside and its revision), then a board of the current route's assignments from the run's own list: each one's state as an icon and a word, what it waits for, its own worktree when it ran beside others (integrated, kept for inspection with its path) and the listed steps that carry its ID.
An assignment a route revision added, rewrote or dropped says which revision did; a dropped one is `superseded`, struck through and counted apart, never as waiting.
It also states the number of route revisions and the paths they added to the write scope.
The run header shows its phase beside its own status capsule; each expandable step summary shows the step identifier and its own status capsule, including `unknown` without inferring any task state.
A check step that a recorded deviation set aside is labelled as set aside beside its failed status, and the acceptance line then says how many checks were set aside instead of that the checks passed.
The label comes from the acceptance record, or for a direct working-copy delivery from the verified round whose failed check a deviation names; an earlier failure of the same check stays a plain failure.
These views open in the center over the conversation, which stays mounted (draft, scroll and observations) behind them.
Subagent transcript polling and lazy details follow [Workflow tool observations](#workflow-tool-observations).
The chat reads the newest workflows of the terminal's and the browser's lists at first (`RUN_WINDOW` each) and earlier ones while the loaded turns could hold them.
A run that cannot be read again keeps its last observation with an unavailable note; an ID never read (a terminal attempt the owner refused leaves one) shows nothing and is retried every ten seconds, never taken as settled or absent.
The transcript line and run detail keep phase and step progress; the history row stays quiet until its last active item settles.
Workflow details retain exact-run cancel under its existing authority.
A failed, interrupted or unknown turn retains its recorded status.
Approval is available after a failed, canceled or timed-out turn and waits while the turn is live or unknown.
An uncertain approval keeps its original command ID in this tab's sessionStorage where available and observes that exact workflow as well as the conversation's run links.
It blocks further approval/revalidation until resolved; refresh never repeats the command.
Only a reliable no-effect refusal clears the attempt for a fresh action, while observed conversation consumption resolves an accepted one.
Ordinary Send does not depend on the Cadence-mode read; when that read fails the owner still refuses an ordinary Send to a Cadence conversation.
Only `/cadence` (with the slash) at the start of a Send activates the mode; a sentence beginning with "cadence" is ordinary text.
Task tools/context/timeline/runs and export/link actions live under Details, shown only for a task or child scope; search and the History details tab also appear only in those scopes, rather than as permanently disabled ordinary-chat controls; an ordinary conversation has no view switch and shows its tool calls as cards in the transcript.
Streaming identity, Markdown and detail reads follow [Stable rendering and details](#stable-rendering-and-details).
The line "Thinking that could not be read is not shown" appears only for the `omitted.thinking` flag: thinking Pi stored unreadable, or in a workflow subagent's transcript thinking its capture did not keep.
A failed or incomplete assistant attempt is its own labelled block, never joined to the answer.
The turn's meta line gives its recorded start time and the model fixed at admission; the admitted directory opens from that model label, and a record without a snapshot shows neither.
The reply's action bar sits in its byline, the user's below its bubble; hover and focus reveal the controls and touch screens always show them.
A single settled answer needs no duplicate part-copy button; live, failed and multipart text keep their individual copies.
The action bar copies the message (for a reply, its answer text in recorded order, without thinking blocks, tool cards or failed attempts); the user's message also offers "Edit and resend" where the entry it continued is known, and the last message of an earlier settled turn (the reply when there is one) offers "Continue from here".
Neither anchor action is offered while a reply is active or a Send is in flight, and a reply still being written has no bar.
Tool names are model-chosen data: one matching no known kind, `constructor` included, counts as a plain tool.
Runs puts the current snapshot's owner projection above the retained run pages.
The right panel defaults to files; its History details inspector remains bound to the containing task and selected watermark even when viewing a child.
Historical child links bind exact scope and watermark.
Bounded history and Back never silently rebase; running conversations offer an explicit new-activity update, and source limitations/progress stay visible even when complete-record metadata is folded.
Cancel uses the independent active roster (including the fallback strip when workspace discovery fails); navigation, project selection and hiding panels never cancel or authorize execution.
Reply activity and workflow outcomes stay in the conversation; there is no separate runtime status strip above the composer.

Native research/plan/start claim their shared conversation state synchronously before attachment or model awaits; a concurrent mutation in that generation refuses before dispatch, while status and explicit Cancel remain available.
Each mutation carries its own claim through dispatch and response handling; navigation retires its admission authority without canceling its original, blocking a new generation or letting an old finally release a newer claim.
Research replies carry exact run/step identities.
Browser research replies include a `result` pointer for each answered or failed step, beyond the bounded initial preview.
The browser coordinator passes that pointer to `cadence_status` to read the retained JSON result, then passes `next` unchanged until it is null; this never starts another investigation.
Each continuation binds the run, step and digest of the current redacted projection, so a changed projection refuses instead of silently joining incompatible pages.
The original result's `limited` flag remains independent of pagination: reaching the last page does not recover bytes the worker capture did not retain.
Only runs linked to that conversation can be read through this coordinator tool; the existing private bridge bound is unchanged.
`cadence_status` accepts an explicit `runId` for retained results/transcripts without changing the current selection or acknowledging a different current unknown run.
Cancel pins the displayed run identity before its confirmation dialog.
Session changes invalidate in-flight dispatch/response handling; no command is replayed.

Adaptive delivery progress adds `recovering` and `learning` phases, route-revision counts and readonly earlier-step paging.
A child failure remains visible while the service diagnoses or continues the same admitted goal; no client-triggered Send or automatic mutation replay is involved.
Version-1 plans stay readable but cannot authorize the new executor.

## Activity discovery

`src/activity.ts` reports real interactive TUI activity independently of `/cadence` and the Agent panel.
It registers no idle timer: `agent_start` creates one instance/activity/session-bound report, automatic retries and continuations keep it, and `agent_settled` or session shutdown withdraws it.
Pi 1.5's public settlement event, not `agent_end`, is authoritative; new/resume/fork/reload retires the old runtime, while idle tree navigation creates no activity.
Publication failures never cancel Pi work, and renewal timers are unreferenced.
Reports contain no prompt, output, token, capability or session-file path.
`activity-files.ts` owns the private same-agent-directory/host namespace, atomic single-writer publication, finite scans and exact dead-report archival; corrupt/uncertain bytes are retained rather than silently repaired.
The normal 30-day recovery archive policy applies to archived dead reports.
No report is execution authority or a checkout lock.

`activity-discovery.ts` combines those reports with the registry's authenticated owner summaries, regardless of their build fingerprints.
Owner summaries project original in-memory turn/workflow lifetimes without reading history or creating viewer attachments; ordinary turn startup, workflow queueing, recovery, Stop and settlement remain distinct.
A summary is complete only for a healthy owner whose original accepted-work count matches the projected roster; quarantine or an unprojected original cannot prove absence.
The admitted execution context alone supplies conversation/cwd attribution; missing context stays unattributed.
Candidate worktrees remain execution locations of their original owner; native reports inside the managed namespace cannot create a second project.
One gateway shares a bounded, round-robin cached sweep across tabs; discovery neither prepares owners nor adds Stop associations.
Native checkout resolution is asynchronous and cancellable; registry owners reuse their already canonical checkout identity without a new Git process.
Closing or invalidating the observer aborts only its reads; it cannot cancel execution.
Only work represented in the selected project’s history prefix is subtracted from discovery: owner work by source, epoch and run/command ID, terminal work by instance and activity ID.
Other projects, incompatible reader scopes and reports without a session remain separate, even when their session IDs match.
An incomplete discovery read can retain a missing local terminal as stale in its original disclosure; it does not make incompatible history navigable or grant Stop.
Limits and uncertainty windows live beside the constants in these modules.
On a failed read, the general discovery list drops reports whose observation is more than 120 seconds old.
Capacity, corrupt state and missing observations can also make a successful response partial, even when empty.
For the selected directory only, history keeps the last attributable work missing from a failed or partial read as a **stale observation**, not running work or a source of Stop permission.
A complete read releases absent work; a session leaves the prefix only after its last item is gone.
These display identities do not transfer across directory, discovery epoch or loss of access.
Discovery does not locate idle terminals, other hosts/accounts or another Pi configuration scope.

The unified sidebar shows independent activity rows, including work in never-selected projects, without a visible heading, project/session totals or deduplication note.
When there are no additional rows or observation warnings, discovery occupies no space.
Only an explicit click remembers a directory and reads its session/branch; no background refresh navigates.
A session whose first JSONL has not been flushed stays visibly history-unavailable, not a fabricated empty transcript, and cannot be sent to as a new session.
Custom session-directory overrides that differ from the gateway's existing reader remain visible but cannot navigate history: the report's directory-scope hash must match the configured reader, and discovery never follows a reported session-file path.
Ordinary CLI work has no remote Stop or control endpoint.
History outcomes and the existing owner's authorized exact-run controls remain independent of discovery.

Service Agents inherit persisted Pi execution preferences and standard tool selection at Send/admission, not the terminal's live extension registry or transient overrides.
A delivery plan displays its runtime summary and requires fresh confirmation if preferences change before admission.
Already admitted work keeps its snapshot across worktree placement, review and auth renewal.
Configuration/trust resolution and the explicit service exceptions are owned by `worker-tools.md`; this does not change the separate ordinary context/skill resource seam.
