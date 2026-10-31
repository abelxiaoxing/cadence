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
Model preferences persist as exact selectors in the user's agent directory (Pi's `getAgentDir()`, symlinked directories followed), never credentials, grants or source selection IDs.
An unreadable preference file falls back to the current Pi model with one warning; an explicit model choice atomically replaces it.

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
Nothing is mounted until the first agent arrives (`CADENCE_AGENT_PANEL=always` keeps `● main` visible).
Then a launched/finished block sits above the input and one row per agent below it: at most six recently active rows plus `+K more`.
With an empty input, ↓ moves focus to the rows; ↑/↓ or Ctrl+P/N select, Enter shows that agent's transcript in place of the main view, PgUp/PgDn, Ctrl+U/D and Home/End scroll it, and Esc returns to the main view and then to the input.
Every other input key, including Enter, Shift+Tab and Ctrl+J, stays Pi's; each agent view remembers its scroll position.
The panel never starts, cancels or keeps an agent or Pi alive, and keeps nothing across restarts.
For manual checks, `pi -e ./src/index.ts -e ./scripts/agent-panel-demo.ts` adds `/agents-demo [count]`, which plays fake agents (the second fails) and runs nothing.

## Browser

Open the private link that `cadence server install` printed, or that `cadence token-link --reveal` reveals.
Valid bootstrap redirects to a token-free URL and uses an HttpOnly SameSite cookie for subsequent HTTP/WebSocket access; no localStorage token copy.
The unified browser entry opens on the conversation shell, without an execution cwd, SDK session or default workspace.
Choose a working folder from the lower-right button; before a folder is selected, New conversation offers the same picker and Send stays disabled.
Only explicit Open starts or reuses a project owner.
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
One human plan approval binds the exact visible proposal, conversation revision/head, model, project observation, owner epoch and authenticated attachment/access generation.
Prepare is a fresh confirmation operation, not a background read; a second tab, changed context, departure or expired grant cannot inherit it.
The browser-specific approval channel retains browser authority and existing build/CSRF/origin checks; the native general workflow command remains forbidden to browsers.
Plan approval covers declared setup/check commands and local commits/integration, not a generic shell, push, publication, deployment or host recovery capability.
An accepted plan is consumed at the conversation boundary before dispatch; command loss or an uncertain attempt is observed, never replayed.
Full plan cards and retained run/step details replace daily task/Save/Start/Checks/Review management; automatic review is never human review.
Workflow progress is distinct from the ordinary/coordinator response status, including actual merge commits after failed post-merge checks.
The independent project workflow roster includes native-started work; missing observations never render as an empty complete roster.
Mode exit only detaches from orchestration; actual workflow cancellation remains a separately explicit, exact-run request and waits for original settlement.
Known closed failed coordinator turns may continue on a new explicit Send from the last complete checkpoint; no incomplete tool call is resumed.
A saved model preference is restored only on explicit Send, never readonly browsing; no silent model substitution.
Remembering the chosen model is best-effort: a broken preference file never fails or reverts an installed choice.
Exit does not require a usable selected model.
There is no Legacy task creation entry or task composer.
Historical task-origin links still read, but cannot be created.
The old task inspector is readonly content/check/change/review evidence, never an editor or execution control; no old task/history is rewritten into a new workflow.
Native Pi session transcripts are not imported into browser conversations.
All of this works without a live Pi terminal.
A definite pre-acceptance Send refusal preserves the draft and permits another explicit Send or mode exit; it does not pin an impossible pending turn.
A token grants workspace access, not action consent.
Ordinary Send binds its exact text, conversation head, epoch, access and selected model; stale/duplicate/lost replies do not silently replay work.
The WebUI provides task/run/assignment navigation, long retained messages and tool detail, exact literal search, timeline and complete scoped NDJSON/Markdown downloads.
Desktop panes and phone drawers retain cancellation and keyboard controls.
Its chrome: a compact topbar with view tabs and icon actions, a sectioned task sidebar, pill inspector tabs, transcript/tool cards and a bottom statusbar; phones wrap the topbar into an action row and an icon tab row.
The left sidebar provides New conversation alongside running/retained conversations and an on-demand Workflow history listing; a separate lower-left dock observes Cadence subagents — workflow research/implementation/review workers and legacy task children — and opens their retained transcripts in the main area.
It is not a subagent engine.
The right sidebar defaults to readonly files, bounded text previews and path-only references; retained content/check/change/review evidence occupies its History details tab.
The lower-right folder button contains recent projects, browses directories on the service host and explicitly opens another independent project owner.
The unified entry switches project clients on the same origin, including an explicitly configured HTTPS proxy; it never changes a running task's cwd, registers a boot service or cancels the project left behind.
Backend cookies and native capabilities never reach the browser; proxied actions remain browser-authority actions, with owner-side consent/build/CSRF checks.
The gateway refuses the legacy project-level Open command: all project openings use its own association route, without returning an independent backend token link.
Direct legacy project entries remain available; only that compatibility route retains its older loopback-only cross-project navigation.
The interface is in English or Simplified Chinese: it follows the browser's first preferred language, and the topbar's globe chip (`中文` / `EN`) switches it, remembered only in that browser.
Error codes, identifiers, commands and recorded content stay untranslated.

## Ordinary conversations

Ordinary conversations run through the same isolated SDK process launcher, exact model/auth sources and orderly Stop as tasks, with a separate private `service-v1/conversations-v1` store rather than fabricated task records or imported Pi sessions.
Their tools operate on the host, not in a sandbox.
Each turn holds the checkout's exclusive gate, so ordinary turns, Cadence children and parent checks cannot edit/read across one another's active write window; leaving a tab only detaches.
Conversation identities are not recreated when their metadata disappears, unaccepted turn directories are never adopted, and rolling private writes compare their exact expected bytes.
An active turn retains independent interruption authority even when its metadata is unavailable; readonly views do not reconstruct that metadata.
Access-token rotation revokes viewers, not admitted queued turns.
A completed turn retains sanitized text and tool exchanges for its next explicit Send.
The bounded checkpoint passes through an anonymous pipe and owner-side credential redaction before persistence; hidden thinking, signatures and media are not retained.
A turn records omitted thinking, media and unrecognized (`other`) blocks as `omitted` flags, never as a `notice` line, so a later failure reason is not displaced; turns saved before the flags decode with all three unset.
Releases through 2.0.19 refuse a turn that carries the flags, so going back to one leaves conversations written since unreadable there.
Assistant usage keeps only the counts every Pi message carries; optional provider breakdowns such as `reasoning` or `cacheWrite1h` are dropped, not refused.
Failed, interrupted or over-budget turns remain visible but currently require a new conversation instead of replaying incomplete context.
A restart never resumes pending turns; unknown work keeps fences.
There is no upstream goal/delegate loop, subagent tool/template pack, PTY, plugin loader, prompt composer or automatic retry/compaction.
Ordinary resources are Pi's base prompt, applicable `SYSTEM.md`/`APPEND_SYSTEM.md`/project instructions and the default skill directories, loaded on demand at Send; package extensions and package-discovered resources are not loaded into these workers.
Limits are explicit: 200 conversations, 1000 turns per conversation, eight admitted turns (serialized within one checkout), 384KiB per retained visible turn, 2MiB continuation context, and 512MiB/10,000 entries for the separate conversation store, without eviction.
Task history retains its existing independent bounds.
File browsing lists at most 200 entries from 2000 directory entries and previews at most 128KiB of UTF-8 text.
It refuses symlinks, hard-linked files, private state, Pi's agent directory (including its configured alias target), `.git`, `.env` variants, common credential directories such as `.ssh`/`.aws`, and credential/config filenames; limitations remain visible.
This is not a filesystem sandbox for model tools.

## WebUI contracts

WebUI text is keyed by its English source: fixed text goes through `useT().t`, whose type requires a `web/src/i18n/zh.ts` entry with the same `{name}` marks, and run-time status words or kept notices through `tx`, which passes unknown text and codes through.
The timeline client takes the chosen language from its bridge and is remounted on a switch; browser scenarios pin `locale: "en-US"` so English assertions do not follow the host's `LANG`.
The browser is conversation-first, including before any project is selected: ordinary chat and explicitly enabled Cadence conversations share its sidebar, while a lower-left dock observes actual Cadence child identities.
The empty entry has no project welcome screen or central Create shortcut; New conversation offers folder selection until a project is explicitly opened.
The bottom-right folder control is always present, and its picker lists recent projects.
Conversation history belongs to each project owner, so the unselected entry's history section says so and lists the recent projects; choosing one only preselects its folder in the picker.
An unselected first entry returns to the last selected project, remembered only in that browser as its opaque key, after one readonly conversation listing proves that owner still runs in its associated epoch; this is navigation, never Open.
A stopped, changed or unknown owner stays stopped: the entry remains and names the last project as not running, and any navigation, Open or folder choice during the check wins.
Browsing or dismissing the picker never opens a project or sends a message.
The picker has no separate Browse step: its location trail, folder list and Enter in the path entry navigate, and the footer names the exact Open target.
Open of a typed or recent path first makes one fresh readonly observation and opens only that observation's canonical folder; a failed read opens nothing and keeps the typed path and previous listing in view.
The footer Open is disabled while any observation is pending, including the first one; a recent entry still opens, because its own fresh observation supersedes the pending read.
Every navigation makes a fresh readonly observation, including retrying the same path after a read failure; it never replays Open.
Folder browsing (not Open) accepts `~` for the service account's home and reports a missing folder as `invalid`, a file or linked component as `forbidden` and a read failure as `unavailable`; the gateway passes these public codes on so the picker can explain them.
One service still owns one checkout.
The recent-project directory records only explicit project openings in the same private namespace; navigation opens that project's independent authenticated entry rather than changing global cwd, importing Pi sessions or adopting another account's state.
The center shows ordinary/coordinator messages, exact plan cards and actual workflow progress/results as Markdown, plus retained legacy task text.
A workflow subagent's transcript and retained result open in the center as their own view over the conversation, which stays mounted (draft, scroll and observations) behind it; the chat card links to that view instead of embedding the transcript.
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
