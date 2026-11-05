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

A readonly panel in the Pi TUI follows background agents: the child runs of Cadence's running owner and any agents another extension announces on Pi's shared event bus.
Every TUI session, not only `/cadence`, looks for the owner already running for its workspace half a second after start and every 15s while none answers; it never starts, recovers or selects one, skips an incompatible owner and only detaches on departure.
That observation holds one of the owner's viewer attachments, so departure (including Pi quit) waits up to 1.5s for the detach to reach the owner rather than leaving the slot to its idle expiry; `/cadence` departs the same way.
`CADENCE_AGENT_PANEL=off` turns that observation off.
It reads the active roster every 5s, and every 2s together with the task's snapshot while it follows an episode, announcing each child of the active episodes: its assignment ID as label, purpose as kind, lifecycle or latest tool as activity, and completed, canceled or any other outcome (with its reason) as done, cancelled or error.
A child whose outcome the session can no longer observe (no compatible owner a whole retry after losing it, or no settled row five looks after its run left the roster) ends as an error that says so; `/cadence-history` keeps the actual outcome.
Workflow research, implementation and review subagents are announced the same way from the workflow roster; the viewed one streams its retained transcript, others refresh their activity at most every 10s, and an unreadable run ends as not observed.
Elapsed time counts from when the session first observed a child (`—` for one first seen settled); no tokens are shown because the owner records no usage.
Opening a child reads its retained messages, tool calls and results through the history readers, up to 64KiB per field; complete fields, search and export stay in `/cadence-history`.
A retained `edit` call shows its call and result without Pi's diff preview, which would compare against the file as it is now.
Producers emit `subagent:start {id,label,kind,startedAt}`, `subagent:message {id,message,streaming?}`, `subagent:activity {id,activity,tokensIn?,tokensOut?}`, `subagent:stats {id,tokensIn,tokensOut?}` and `subagent:end {id,status,endedAt,error?}` with status `done`, `error` or `cancelled`; `startedAt: null` marks an unobserved start.
A message has the main session's message shape; `streaming: true` marks a snapshot that the next message replaces.
The panel emits `subagent:view {id}` (`id: null` when none) so a producer loads only the shown agent's messages.
Nothing shows while no agent runs.
Agents whose start was observed form a batch: the first one opens it, and later starts join it until it closes.
A start with `startedAt: null` joins no batch, so after a restart already finished children neither reopen the live view nor repeat a card.
While a batch is open, one block above the input shows a spinner header naming a shared kind (`2 Research agents running · 1 done`), then rows for its running, failed and cancelled members; a cleanly finished member is only counted, and rows past six fold into `+K more`.
Row text leads with the label unless the producer's activity already does.
Once every member ended, the block shows the card it is about to become for `SETTLE_MS` (1.5s); a start in that time joins the same batch.
Then the block is removed and the card is appended to the session as a display-only `cadence-agent-batch` entry, which is not part of the model's context and renders again on resume.
A collapsed card is one line when every member finished cleanly and otherwise also lists the failed and cancelled ones; Pi's tool-output expansion (Ctrl+O) lists every member with its final text and elapsed time.
A card holds only display text (kind, row text, status, elapsed), at most 64 members, and anything malformed in a session file renders nothing.
A batch that settled is carded in the session it ran in, even on departure; one still running carries over to the next session, and one that ended while no session showed it gets no card.
`CADENCE_AGENT_PANEL=always` keeps the last batch in the block, without a card, until the next batch begins.
With an empty input, ↓ opens a list below the input of this session's agents, at most 24 ended ones beyond the open batch and six rows at once plus `+K more`; ↑/↓ or Ctrl+P/N select, Enter shows that agent's transcript in place of the main view, PgUp/PgDn, Ctrl+U/D and Home/End scroll it, Esc returns to the list, and Esc or ↑ past the first row returns to the input and hides the list.
Every other input key, including Enter, Shift+Tab and Ctrl+J, stays Pi's; each agent view remembers its scroll position.
A new session drops the previous one's ended agents.
The panel never starts, cancels or keeps an agent or Pi alive; across restarts only the cards remain.
For manual checks, `pi -e ./src/index.ts -e ./scripts/agent-panel-demo.ts` adds `/agents-demo [count]`, which plays a batch of fake agents (the second fails), then a fake review agent with its own card, and runs nothing.

## Browser

Open the private link that `cadence server install` printed, or that `cadence token-link --reveal` reveals.
Valid bootstrap redirects to a token-free URL and uses an HttpOnly SameSite cookie for subsequent HTTP/WebSocket access; no localStorage token copy.
The unified browser entry opens on the conversation shell, without an execution cwd, SDK session or default workspace.
Choose a working folder from the lower-right button; before a folder is selected, New conversation offers the same picker and Send stays disabled.
Directory selection only remembers its canonical reference; it starts no service, creates no project-private state and requires no Pi login.
The current explicit Send prepares the selected owner through the same project-launch boundary as native entry (`CADENCE_AUTOSTART=0` refuses startup, not healthy reuse); no separate Open is required.
The gateway rechecks its own epoch/CSRF and the exact selected directory, and the existing serialized observer supplies a fresh compatible attachment.
A Send claims its exact message and image File list, conversation head, mode revision, cwd, displayed model selector and command ID synchronously before preparation or model-selection waits; continuation never rebases these fields.
An initially unchosen model may be resolved once, or changed by the waiting user's explicit picker choice; a concurrent newer default/selection cannot silently replace the captured selector.
An unreadable conversation (including half-finished owner setup) permits preparation only: it cannot supply a head or mode revision, so the draft waits for the user to review the restored context and Send again; startup never rebases it.
Preparation is not message admission or execution consent.
`project-entry.ts` reports `dispatched` only after local signal/build/body/identity preparation and the POST's handoff to fetch; that handoff is not proof of receipt.
Only a decoded response matching the selected project/path/cwd and a non-null epoch reports `confirmed`, before the serialized viewer attachment wait.
A request-before-dispatch failure cannot suggest owner startup; an unconfirmed dispatch is preparation-unknown with no message submitted, and an attachment failure cannot undo confirmation.
Final Send clears uncertainty only on a matched success or reliable `effect:none`; all other failures retain the original command ID for observation without replay.
Failure keeps the draft; losing an accepted Send reply keeps its original command ID for observation only.
Leaving the conversation or choosing another branch aborts its unsent continuation, never accepted startup or work.
Saved plan approval does not prepare a stopped owner: it still requires fresh live, exact-plan, attachment-bound confirmation.
Within that project, the browser opens on an ordinary conversation with a real message composer, retained multi-turn context and standard read/write/edit/bash tools; no Cadence task is created by Send.
Use `/cadence [goal]` at the beginning of an explicit Send, or select Cadence on Send, to enable persistent mode in that same conversation.
Prefix-only entry asks for a goal; ordinary subsequent messages, refresh, completion and cancellation retain mode until explicit exit.
Mode/plan/run links belong to the owner-private versioned conversation-control store; browser storage holds only drafts/display preferences and uncertain attempt IDs.
The coordinator is an isolated SDK child with only bounded research/proposal/status tools; it cannot call write/edit/bash, approve itself, or load arbitrary extensions.
It holds no checkout barrier while awaiting research, so the existing worker barrier cannot deadlock its parent and status conversation can proceed during implementation.
One coordinator turn per conversation is admitted at a time (bounded per owner); separate project owners remain independent.
A plan card persists across later messages until a new plan replaces it, the user exits or execution is admitted; a refused approval keeps the card.
Plans may be published while other workflows run; research is refused with an explanation only behind an approved implementation, and its run ID is recorded only once accepted.
An unreadable or incomplete control record degrades only its own conversation: the read carries a notice, every Cadence command there refuses, and nothing is repaired; other conversations and owner startup are unaffected.
Lost replies to Send or approval return the original receipt or run on a retry with the same command ID.
One human plan approval binds the exact visible proposal, conversation revision, the browser's settled last message to that conversation, the current Pi branch leaf, model, project observation, owner epoch and authenticated attachment/access generation.
Prepare is a fresh confirmation operation, not a background read; a second tab, changed context, departure or expired grant cannot inherit it.
The browser-specific approval channel retains browser authority and existing build/CSRF/origin checks; the native general workflow command remains forbidden to browsers.
Plan approval covers declared setup/check commands and local commits/integration, not a generic shell, push, publication, deployment or host recovery capability.
An accepted plan is consumed at the conversation boundary before dispatch; command loss or an uncertain attempt is observed, never replayed.
Full plan cards and retained run/step details replace daily task/Save/Start/Checks/Review management; automatic review is never human review.
Workflow progress is distinct from the ordinary/coordinator response status, including actual merge commits after failed post-merge checks.
The independent project workflow roster includes native-started work; missing observations never render as an empty complete roster.
Mode exit only detaches from orchestration; actual workflow cancellation remains a separately explicit, exact-run request and waits for original settlement.
A failed or interrupted coordinator turn stays in the session; a new explicit Send continues that branch as Pi would (errored replies are skipped and orphaned tool calls closed); no incomplete tool call is resumed.
A saved model preference is restored only on explicit Send, never readonly browsing; no silent model substitution.
The model catalog reports that preference read only as `remembered`, and only when it names a selectable entry of the same catalog, so the browser can show it as "used when you send" without installing it; an unreadable or no longer offered preference is simply absent.
The composer's model button shows the installed choice (or the remembered one, dimmed) and opens an anchored panel: models grouped by provider with a search, unavailable models listed with their reason, and the thinking level as a separate row.
One click is one explicit choice; choosing another model keeps the current thinking level when it offers it, otherwise the nearest offered level, and the panel shows the result at once.
The model panel locks choices while this conversation's reply is live; another conversation's work does not prevent choosing its own model.
A Send with no installed model and no remembered preference opens that panel instead of failing; the message waits there and is sent once after one explicit choice, or not at all if the panel is dismissed or sending stays impossible for ten seconds.
Remembering the chosen model is best-effort: a broken preference file never fails or reverts an installed choice.
Exit does not require a usable selected model.
There is no Legacy task creation entry or task composer.
The obsolete task-to-conversation navigation API is removed; stored task links and task evidence remain untouched.
The old task inspector is readonly content/check/change/review evidence, never an editor or execution control; no old task/history is rewritten into a new workflow.
Browser conversations are the project's Pi sessions, shared with the terminal rather than imported (see [Ordinary conversations](#ordinary-conversations)).
Shared history does not transfer native terminal grants, tool-restoration state or browser plan approval: mode and confirmation authority remain per surface.
All of this works without a live Pi terminal.
A lost Send is acknowledged only by its original command ID, not by an unrelated terminal append advancing the leaf.
A definite pre-acceptance Send refusal preserves the draft and permits another explicit Send or mode exit; it does not pin an impossible pending turn.
A token grants workspace access, not action consent.
Ordinary Send binds its exact text, session entry it continues, conversation/cwd, epoch, access and selected model; stale/duplicate/lost replies do not silently replay work.
The WebUI provides task/run/assignment navigation, long retained messages and tool detail, exact literal search, timeline and complete scoped NDJSON/Markdown downloads.
Desktop panes and phone drawers retain cancellation and keyboard controls.
Its chrome: a compact topbar with view tabs and icon actions, a sectioned task sidebar, pill inspector tabs, transcript/tool cards and a bottom statusbar; phones wrap the topbar into an action row and an icon tab row.
The topbar's More menu holds Refresh status, Disconnect this page (detach; started work keeps running) and the build/compatibility statement; the statusbar shows only connection state, active runs when there are any, an incompatible build and the working folder.
The composer's Cadence mode switch replaces the old mode select: off, it arms Cadence for the next Send (or clears a typed `/cadence`); on, it is the mode exit, alongside the typed `exit cadence`.
The left sidebar provides New conversation alongside running and retained conversations, terminal and browser alike and each labelled with where it started; Running conversations holds only queued or running replies, and the open conversation stays highlighted in history once its reply settles, where the count includes conversations.
There is no separate workflow list: a workflow belongs to the conversation that started it, browser or terminal, and appears there as one line; an active one is also listed under Running conversations.
A separate lower-left dock observes Cadence subagents — workflow research/implementation/review workers and legacy task children — and opens their retained transcripts in the main area.
The dock is only as tall as its rows, up to its default height, until a drag sets one; it stays folded while empty unless opened, and its heading count leads the total with the queued or running agents (`2 active · 5 total`).
When a workflow ID list changes, observations of still-listed live runs survive failed re-reads and remain visibly stale; changing client identity retires the cache.
A compact sidebar list notes only partial, redacted or omitted recording coverage; complete coverage needs no note there.
It is not a subagent engine.
The right sidebar uses the current conversation's cwd for readonly files, bounded text previews and path-only references; retained content/check/change/review evidence occupies its History details tab.
The lower-right folder button contains recent directories and selects one on the service host without starting its independent owner.
The unified entry switches project clients on the same origin, including an explicitly configured HTTPS proxy; it never changes a running task's cwd, registers a boot service or cancels the project left behind.
Backend cookies and native capabilities never reach the browser; proxied actions remain browser-authority actions, with owner-side consent/build/CSRF checks.
The gateway refuses the legacy project-level Open command and has no browser Open-start endpoint: selection and explicit-Send preparation are separate routes, neither returns an independent backend token link.
Direct legacy project entries remain available; only that compatibility route retains its older loopback-only cross-project navigation.
The interface is in English or Simplified Chinese: it follows the browser's first preferred language, and the topbar's globe chip (`中文` / `EN`) switches it, remembered only in that browser.
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
The coordinator retains IPC fd 4.
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
The session directory follows Pi's precedence: `PI_CODING_AGENT_SESSION_DIR`, then `sessionDir` in the project's `.pi/settings.json` or the agent directory's `settings.json`, then `<agentDir>/sessions/--<cwd>--`; session headers bind their own cwd within the owning checkout.
Same-checkout subdirectories share the owner's readonly session cache, not one execution cwd; another account's agent directory is never adopted.
Each browser turn records `cadence-browser-command/1` after each finalized Pi message, naming its actual user entry and owned prefix through the worker's public SessionManager; command identity and parent/offset checks, never prompt text, associate its entries.
A browser-created session carries a `cadence-webui/1` custom entry, which Pi keeps out of the model context; the terminal resumes it with `/resume` or `pi --session <id>` like any other session.
Pi writes each message when it ends, raw: thinking, signatures and tool output are stored as the terminal stores them, and the owner redacts its credentials from everything it returns instead.
Read redaction uses the owner's current literals, or the last ones observed while the model configuration is reloaded or edited; without any, reads refuse rather than return unredacted content.
The owner never rewrites, repairs or deletes a session file; its own private `service-v1/conversation-commands-v1` records each browser message's admission (command, the entry it continues, the file size then, status, auth journal and native closure), never content.
Their tools operate on the host, not in a sandbox.
Each turn holds the checkout's exclusive gate, so ordinary turns, Cadence children and parent checks cannot edit/read across one another's active write window; leaving a tab only detaches.
An active turn retains independent interruption authority; Stop or a timeout signals the worker, which aborts its Pi session first so the session records the interrupted reply as Pi does.
Access-token rotation revokes viewers, not admitted queued turns.
Each admitted turn/workflow records its original execution context; queue release and later workers never consult a mutable conversation/owner picker to replace it.
File views follow the retained conversation cwd, and directory navigation does not rewrite that cwd; choosing a different folder opens a separate conversation context.
The UI labels recorded context as fixed at admission, not as proof that tools ran.
Older records without a snapshot stay readable without invented model/directory evidence.
A Send names the entry it continues: the end of the branch the browser shows, or none for an empty session.
The owner admits one browser message per session at a time; a terminal may write the same session meanwhile, and a message continuing an entry the session has since moved past starts a new branch, never a conflict or a rewrite.
A turn whose entry Pi never wrote (a refusal before any model call, or a Cadence control reply) is shown after the branch end it was sent from until the branch moves on.
A turn records omitted thinking, media and unrecognized (`other`) blocks as `omitted` flags, never as a `notice` line, so a later failure reason is not displaced.
A failed or interrupted turn stays in the session with Pi's own error or abort record; the next explicit Send continues the branch, where Pi skips errored replies and closes orphaned tool calls.
A restart never resumes pending turns; a turn whose closure is unknown keeps fences.
There is no upstream goal/delegate loop, subagent tool/template pack, PTY, plugin loader, prompt composer or automatic retry/compaction; a terminal `/compact` is honoured when the session is continued.
Ordinary resources are Pi's base prompt, applicable `SYSTEM.md`/`APPEND_SYSTEM.md`/project instructions and the default skill directories, loaded on demand at Send; package extensions and package-discovered resources are not loaded into these workers, so a terminal extension's tools are shown in history but not offered to a browser turn.
When a turn's model or thinking level differs from the session's, the worker records the change, so a terminal resume keeps it.
Conversation and per-conversation turn counts have no lifetime admission cap; only active-work concurrency is bounded.
History lists the project's sessions by last modification, newest first, 50 per page; active conversations use a separate roster and never disappear merely because an older history page is selected.
Listing reads each file once and then only what Pi appends, ignoring a torn final line; a replaced or shortened file is read again from its start.
A conversation reads one branch, named by its last entry, as one continuous transcript: the head read gives the summary, the branch end, whether it still continues the one shown before, the branch and leaf counts and the terminal's workflows; each turn (a user message and what followed it) is read by position as listed steps, and a step's full item is read separately in parts that each fit one reply.
Without a chosen branch the WebUI follows Pi's current leaf, the entry appended last; a live browser turn ends the branch it was sent from until it settles.
A listing never carries a tool's arguments or output and keeps at most 16KiB of message text; the WebUI reads a tool's detail when its step is opened and a clipped message's rest when it is shown.
Terminal `!` commands, compaction and branch summaries and displayed extension messages are listed as steps; thinking and unsupported media are flagged as omitted.
Supported user images are small entry/index/MIME descriptors on their exact branch.
A live turn extends that view only with its verified command-owned prefix; before Pi flushes a new session, explicitly marked live-command descriptors read only that admitted turn's in-memory input, not arbitrary descendants or another durable store.
Authenticated `conversation-image` reads return bounded parts, including through stopped-owner readers; the browser creates and revokes local Blob URLs.
No session paths or remote image URLs are returned, and no session is rewritten.
The WebUI shows the newest turns first and reads earlier ones as the top of the transcript nears the viewport; turns far from the viewport render as placeholders of their measured height.
It polls the small head every second only while a turn is queued or running, every ten seconds otherwise; a settled turn is read again only when the branch grew inside it, and another branch is read afresh.
Branch navigation aborts obsolete readonly requests, including an away-and-back selection, and invalidates observation until the chosen head is read; it never cancels accepted work or enables Send from the previous branch.
A branch tree (Pi's `/tree`, user messages only) chooses the branch to read; "Continue from here" shows a turn's end, and the next message starts a new branch there; nothing is moved or deleted.
While a terminal holds a session, its extension notices entries it did not write and suggests `/resume`; a message sent there first continues from where the terminal is, as a new branch.
Pre-Pi Cadence conversations are no longer supported.
Their identities are refused as `retired-conversation`, never reused as empty Pi sessions; start a new conversation.
Old files remain untouched, without a migration UI/API or checkpoint decoder.
Older versions read neither the shared sessions nor messages sent since; going back leaves those conversations unreadable there.
Task history retains its existing independent bounds.
File browsing lists at most 200 entries from 2000 directory entries and previews at most 128KiB of UTF-8 text.
It refuses symlinks, hard-linked files, private state, Pi's agent directory (including its configured alias target), `.git`, `.env` variants, common credential directories such as `.ssh`/`.aws`, and credential/config filenames; limitations remain visible.
This is not a filesystem sandbox for model tools.

## WebUI contracts

`src/abort-scope.ts` owns finite local cancellation lifetimes with AbortController, listeners and an optional timer, without static `AbortSignal.any`/`timeout`, polyfills or dependencies.
A scope takes the first source reason (including pre-cancellation), removes listeners/timer on cancellation and is disposed in `finally` on normal or exceptional completion.
Disposal never cancels sources or service work.
Finite HTTP scopes cover fetch, the entire bounded body and decode; streaming export retains its separate existing budget.
Send preparation uses one scope through gateway observation, POST and fresh attachment; its budget is defined beside `SEND_PREPARATION_MS`.
History images keep one scope across all pages; parallel detail parts each dispose only their own scope, so an early Promise.all rejection cannot disconnect still-pending siblings from navigation cancellation.

Complete project/chat selection is parsed in `project-route.ts` without storage; explicit links take precedence over same-browser recent-project restoration (user-facing resume boundaries are in `docs/conversation-mode.md`).
Project readiness, viewer freshness and actual work status are separate observations.
A failed/unavailable readiness read retains earlier history identity but marks it stale/unknown; a pending re-observation or epoch change cannot make a retained value current.
Positive stopped/not-started observations keep preparation guidance in the statusbar, not a global banner; explicit Send still displays its local preparation progress.
Normal first observation and attachment waits show a neutral connecting status, not a stale warning or a ready claim, including after project readiness arrives but before the first viewer data.
Once viewer data or a failure has been observed, resetting its attachment does not become a new quiet first load; unavailable, failed and retained stale observations remain visible.
App preserves the existing attachment through uncertainty, labels retained work counts as last-observed, and keeps local, project and viewer errors visible together.

WebUI text is keyed by its English source: fixed text goes through `useT().t`, whose type requires a `web/src/i18n/zh.ts` entry with the same `{name}` marks, and run-time status words or kept notices through `tx`, which passes unknown text and codes through.
The timeline client takes the chosen language from its bridge and is remounted on a switch.
The browser is conversation-first, including before any project is selected: ordinary chat and explicitly enabled Cadence conversations share its sidebar, while a lower-left dock observes actual Cadence child identities.
The empty entry has no project welcome screen or Create shortcut; its one central action, Choose a folder…, offers nonactivating selection, and its sidebar has no separate New conversation entry.
The bottom-right folder control is always present, and its picker lists recent projects.
Conversation history remains checkout-scoped, with each conversation's retained cwd shown independently of the directory-navigation entry; the unselected entry lists recent directories, and one click selects one without starting execution (all entries wait during selection; failure names that directory and selects nothing else).
An unselected first entry returns to the last selected project, remembered only in that browser as its opaque key, after one readonly observation finds its existing history identity; this is navigation, never Open, even when execution is stopped.
A never-prepared directory with no owner state may also restore into its empty conversation shell.
An unknown established history identity leaves a read-failure notice; any navigation or folder choice during the check wins.
The gateway observes execution readiness independently of conversation identity.
Stopped-owner ordinary/coordinator history, full stored steps and Cadence mode/plan cards remain readable without an execution attachment, model runtime or implicit Open.
The conversation shell keeps its selected directory/connection identity separate from the conversation cwd.
New drafts use a stable checkout/conversation key, never the owner epoch or the particular same-checkout directory entry used to open that conversation.
Known older history/directory draft namespaces remain usable in place; they are not copied or deleted, and an intentionally emptied primary draft stays empty.
Existing browser draft/pending namespaces are read and retained in place; new directories use that key before history exists, so startup cannot lose their drafts.
A positively observed new epoch replaces only the serialized execution attachment, never a pending Send or approval.
A stopped execution owner is labelled as such, not as an incompatible build.
Message dispatch, model changes and approval still require a live compatible owner; only current Send may prepare one.
The gateway folder picker and draft remain available while stopped, and a failed first readiness observation does not hide independently readable conversations.
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
Its steps, checks, delivery and diagnostics are not in the chat: the line opens the workflow's own view, whose steps link to each subagent's view, and the dock lists the subagents.
These views open in the center over the conversation, which stays mounted (draft, scroll and observations) behind them.
The chat reads the newest workflows of the terminal's and the browser's lists at first (`RUN_WINDOW` each) and earlier ones while the loaded turns could hold them.
A run that cannot be read again keeps its last observation with an unavailable note; an ID never read (a terminal attempt the owner refused leaves one) shows nothing and is retried every ten seconds, never taken as settled or absent.
A live workflow's phase leads the conversation's header and sidebar status in either mode, but a reply that ended badly keeps its own status, beside the phase in the header and in its place in the sidebar row (the workflow is listed under Running conversations); a plan awaiting approval also stays beside it.
Running conversations lists active workflows with their exact-run cancel; one that belongs to a browser conversation opens that conversation, a native-started one opens its run card.
In Cadence mode a failed, interrupted or unknown turn keeps its actual status in the header and sidebar; approval is available after a failed, canceled or timed-out turn and waits while the turn is live or unknown.
An approval attempt guards only its own in-flight request: the owner consumes a plan once, so a lost reply is resolved by the next observation, not by a browser-side lock.
Ordinary Send does not depend on the Cadence-mode read; when that read fails the owner still refuses an ordinary Send to a Cadence conversation.
Only `/cadence` (with the slash) at the start of a Send activates the mode; a sentence beginning with "cadence" is ordinary text.
Task tools/context/timeline/runs and export/link actions live under Details, shown only for a task or child scope; an ordinary conversation has no view switch and folds its tool calls into the transcript.
An ordinary turn shows one speaker label: everything through its last tool call folds into a steps line that names what the tools touched (live while running; it opens by itself when the turn ends without an answer, until the user toggles it), and the assistant text after it is the answer.
Tool names are model-chosen data: one matching no known kind, `constructor` included, counts as a plain tool.
Runs puts the current snapshot's owner projection above the retained run pages.
The right panel defaults to files; its History details inspector remains bound to the containing task and selected watermark even when viewing a child.
Historical child links bind exact scope and watermark.
Bounded history and Back never silently rebase; running conversations offer an explicit new-activity update, and source limitations/progress stay visible even when complete-record metadata is folded.
Cancel uses the independent active roster (including the fallback strip when workspace discovery fails); navigation, project selection and hiding panels never cancel or authorize execution.

Native research/plan/start claim their shared conversation state synchronously before attachment or model awaits; a concurrent mutation in that generation refuses before dispatch, while status and explicit Cancel remain available.
Each mutation carries its own claim through dispatch and response handling; navigation retires its admission authority without canceling its original, blocking a new generation or letting an old finally release a newer claim.
Research replies carry exact run/step identities.
`cadence_status` accepts an explicit `runId` for retained results/transcripts without changing the current selection or acknowledging a different current unknown run.
Cancel pins the displayed run identity before its confirmation dialog.
Session changes invalidate in-flight dispatch/response handling; no command is replayed.
