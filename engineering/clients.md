# Clients: terminal, agent panel and WebUI

Behavior contracts of the native `/cadence` client, the background agent panel, the browser WebUI and ordinary conversations.
Read this before changing a client, its consent rules or what the WebUI shows.

## Native terminal

In a trusted, idle Pi TUI, type `/cadence [goal]` using fresh native Enter.
The optional goal does not Start; pasted/replayed/nonterminal command dispatch cannot grant native entry.
The client attaches to the existing owner and never falls back to a local executor or starts one implicitly.
Choose the exact owner model/API/thinking level explicitly: initial selection is absent.
Create or open a task, edit a readable plan and finite assignments/dependencies, preview and confirm Start.
Readonly Generate is advisory and requires a separate Save/Start.
Native menus expose child messages/tools/timeline, checks, current changes, review, retained history/search/export and independent active-run Cancel.

Return, session departure and Pi quit **detach; admitted work continues** while the service is alive.
Reattach to observe the same IDs without replay.
Explicit Cancel requests bounded stop; it is not proof that every escaped descendant stopped.

## Background agent panel

A readonly panel in the Pi TUI follows background agents: the child runs of Cadence's running owner and any agents another extension announces on Pi's shared event bus.
Every TUI session, not only `/cadence`, looks for the owner already running for its workspace half a second after start and every 15s while none answers; it never starts, recovers or selects one, skips an incompatible owner and only detaches on departure.
That observation holds one of the owner's viewer attachments, so departure (including Pi quit) waits up to 1.5s for the detach to reach the owner rather than leaving the slot to its idle expiry; `/cadence` departs the same way.
`CADENCE_AGENT_PANEL=off` turns that observation off.
It reads the active roster every 5s, and every 2s together with the task's snapshot while it follows an episode, announcing each child of the active episodes: its assignment ID as label, purpose as kind, lifecycle or latest tool as activity, and completed, canceled or any other outcome (with its reason) as done, cancelled or error.
A child whose outcome the session can no longer observe (no compatible owner a whole retry after losing it, or no settled row five looks after its run left the roster) ends as an error that says so; `/cadence` History keeps the actual outcome.
Elapsed time counts from when the session first observed a child (`—` for one first seen settled); no tokens are shown because the owner records no usage.
Opening a child reads its retained messages, tool calls and results through the history readers, up to 64KiB per field; complete fields, search and export stay in `/cadence` History.
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
Use `cadence <goal>` or `/cadence <goal>` at the beginning of the input, or select Cadence task, then Send to create a task in the background and begin readonly analysis.
New task opens the same composer in task mode; there is no task-kind picker or creation dialog.
Mentions, quotations and fenced code do not select task mode.
Analysis appears in the task transcript.
Review implementation plan opens the retained proposal for one explicit Confirm plan and execute approval: save those exact bytes, then start only the matching graph under a fresh grant.
Changed context, failed publication or an uncertain reply stops the sequence without automatic retry.
Configured checks and human review remain separate.
A task created from an existing ordinary conversation retains a navigation link back; the old conversation is not converted and its history is not silently injected into the task.
All of this works without a live Pi terminal.
A token grants workspace access, not action consent.
Task Send authorizes only creation and readonly analysis.
It reads the workspace again at Send and binds the project, access and selected model shown; the working-tree observation, checkout generation and control revision are those observed at Send, while plan approval still binds the exact observation.
A `stale` refusal names the context fields that moved (for example `stale: observation`) from one more readonly read, without retrying.
Editing requires context-bound plan confirmation; the advanced inspector retains independent Save/Start controls.
Ordinary Send binds its exact text, conversation head, epoch, access and selected model; stale/duplicate/lost replies do not silently replay work.
The WebUI provides task/run/assignment navigation, long retained messages and tool detail, exact literal search, timeline and complete scoped NDJSON/Markdown downloads.
Desktop panes and phone drawers retain cancellation and keyboard controls.
Its chrome: a compact topbar with view tabs and icon actions, a sectioned task sidebar, pill inspector tabs, transcript/tool cards and a bottom statusbar; phones wrap the topbar into an action row and an icon tab row.
The left sidebar provides New conversation and New task alongside running/retained conversations; a separate lower-left dock observes Cadence subagents and opens their retained transcripts.
It is not a subagent engine.
The right sidebar defaults to readonly files, bounded text previews and path-only references; task plan/check/change/review controls occupy its Task details tab.
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
The browser is conversation-first, including before any project is selected: ordinary chat and explicit Cadence task conversations share its sidebar, while a lower-left dock observes actual Cadence child identities.
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
The center shows ordinary streamed messages or retained task text as Markdown.
Task tools/context/timeline/runs and export/link actions live under Details, shown only for a task or child scope; an ordinary conversation has no view switch and folds its tool calls into the transcript.
Runs puts the current snapshot's owner projection above the retained run pages.
The right panel defaults to files; its Task details inspector remains bound to the task's current plan/check/change/review context even when viewing a child.
Historical child links bind exact scope and watermark.
Bounded history and Back never silently rebase; running conversations offer an explicit new-activity update, and source limitations/progress stay visible even when complete-record metadata is folded.
Cancel uses the independent active roster (including the fallback strip when workspace discovery fails); navigation, project selection and hiding panels never cancel or authorize execution.
