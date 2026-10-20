# pi-web-ui reuse research

## Scope, provenance and evidence limits

Planning-only, read-only source inspection for R1–R6 in the task PRD.
The active task was confirmed with `python3 ./.trellis/scripts/task.py current --source`: `.trellis/tasks/10-16-cadence-webui-terminal` (session source).
This file is the only intentional write.
No dependencies were installed, services launched, workflows activated, tests executed, code copied, or product/spec files edited.

Upstream checkout:

- Path: `/home/mirako/abel/pi-web-ui`.
- Origin: `https://github.com/xing-shuyin/pi-web-ui.git`.
- Revision: `e8bab487af208bc9a1ab60a821652323f598127f`.
- Commit date: `2026-10-16T12:49:31+08:00`.
- Subject: `fix(brand): 固定品牌徽标官方经典样式不受主题影响，修复纯图标模式徽标隐形`.
- Package: `pi-web-ui@0.106.0`; Node `>=22.19.0` (`package.json:2-8`, `package.json:55-57`).
- Working tree: **clean**.
  `git status --porcelain=v1` returned no entries at the beginning and again near the end; HEAD was unchanged.
  Ignored build artifacts were not audited.

**Anchor convention:** paths below refer to that upstream checkout/revision unless prefixed `Cadence:`.
GitHub permalink prefix: `https://github.com/xing-shuyin/pi-web-ui/blob/e8bab487af208bc9a1ab60a821652323f598127f/`.
Line anchors are source-inspection evidence, not executed acceptance evidence.

Read `AGENTS.md`, `package.json`, `LICENSE`, `docs/architecture-core.md`, `docs/architecture-terminal.md`, `docs/deployment.md`, `plugins/run-trace/README.md`, and the actual sources cited below.
Inspected tracked dependency metadata and embedded vendor notices.
No external library API implementation was attempted; remote repository/registry freshness was not verified.

## Executive finding

**Reuse presentation and reconciliation ideas, not the application runtime.**
Best small candidates are the pure conversation-tree helpers, immutable delta reducer, subagent/status row presentation, tool-execution cards, and authoritative snapshot/resync pattern.
A richer optional candidate is the run-trace timeline presentation, but its history-derived timings/file changes are heuristic and must not become evidence.

**pi-web-ui is not a browser attached to the already-running terminal Pi session.**
It launches/owns separate SDK runtimes and its own PTYs.
It can read/resume the same Pi transcript files, which is different from attaching to the same live execution owner.
Its restart recovery can automatically send “Continue”; importing that behavior would directly conflict with Cadence’s current explicit-Start/no-replay boundary.

The research does **not** choose dashboard versus actionable workspace, single versus multiple workers, or local versus remote/multi-user deployment.
None of the candidates below requires deciding those questions by importing upstream defaults.

## 1. What owns execution and sessions?

### 1.1 Terminal extension is a launcher, not a session bridge

`extensions/webui.ts:171-175` registers `/webui` and obtains the host session ID.
That ID keys the extension’s local child-process bookkeeping (`:294-305`), not a transport subscription to the host session.

Actual launch (`extensions/webui.ts:241-284`):

1. Select a port and working directory.
2. Locate the host SDK **package path**, optionally passing `PI_WEB_SDK_DIR`.
3. Inherit `process.env`; set WebUI port/cwd/data-dir variables.
4. Spawn a Node server with stdin ignored and stdout/stderr redirected to a log.

The process is stopped on terminal `session_shutdown` (`extensions/webui.ts:326-334`).
There is no forwarded terminal event stream or host session object in this launch path.
Sharing the SDK version or cwd does not share runtime identity, native terminal consent, or current auth resolution.

### 1.2 Browser attachment creates/reuses server-owned runtimes

- Browser generates an independent per-tab `clientId` in `sessionStorage` (`web/src/use-chat.ts:1534-1556`) and sends it in `hello` (`:2023-2037`).
  It is a client routing identifier, not a user principal or authorization credential.
- `AgentService.attach` looks in the server’s own `clients`/`pending` maps, may adopt an orphaned WebUI client, or creates a new `ClientSession` (`server/agent-service-daemon.ts:1126-1207`).
  This adoption concerns runtimes already owned by **this server**, not the CLI/TUI runtime.
- `ClientSession.create` selects `SessionManager.continueRecent` or `SessionManager.create`, then calls `createAgentSessionRuntime` (`server/agent-service.ts:2695-2736`).
  Its own comments explicitly identify the SDK per-project session directory as shared with the CLI/TUI (`:2710-2712`).
- The runtime factory creates SDK services with resource-loader overrides and a shared model runtime, then creates an agent session with custom tools (`server/agent-service.ts:2850-2872`, `:3147-3178`).
  This is an execution host, not a readonly transcript viewer.
- Duplicate-transcript owner detection searches only `this.clients` (`server/agent-service-daemon.ts:151-168`).
  The reviewed guard provides **no evidence of coordination with a separately running terminal Pi process**.
  Concurrent access to the same transcript therefore needs separate investigation/coordination; do not assume this guard prevents an external second writer.

### 1.3 Subagents and terminals belong to that server

`server/subagents.ts:10-24` describes a subagent as an `isSubagent` conversation using the existing runtime/message pipeline.
Implementation creates a new `TerminalManager`, `SessionManager.inMemory` or persisted session, and `createAgentSessionRuntime` (`server/agent-service.ts:1104-1137`), records `parentId`, and subscribes the new session to SDK events (`:1139-1162`).

The visible terminal is **a new conversation-owned PTY**, not the original terminal where `/webui` was typed: `server/terminals.ts:1-25` imports `node-pty`; `docs/architecture-terminal.md`, “终端管理/输出合并,” describes conversation ownership and socket-independent lifetime.
It also documents separate native-bash and terminal-backed-bash execution routes.
Installing xterm UI would not attach Cadence’s existing checks or worker processes to it.

### 1.4 Important incompatible implicit side effects

- **Restart recovery executes:** attach invokes `resumeInterrupted` (`server/agent-service-daemon.ts:1255`).
  That function reopens interrupted session files and sends “Continue” automatically (`server/agent-service.ts:3622-3654`, `:3697-3705`).
  Ordinary socket reconnection and service-restart recovery must not be conflated.
- **History opening can repair transcripts:** `repairTranscriptFileBeforeOpen` and `openManagerAndRuntime` call `repairSessionFile` (`server/agent-service.ts:9972-9975`, `:10055`); the create path also reports repair notices (`:2726-2728`).
  This is inappropriate for Cadence’s preserve-old/uncertain-history requirement without a separately approved maintenance operation.
- **No conversation can trigger creation:** snapshot emission has a self-healing `newChat()` branch (`server/agent-service.ts:5167-5174`).
  A Cadence observation endpoint must not acquire a runtime merely to make an empty view render.
- **Browser readiness causes unrelated discovery:** `ready` handling requests files, models, commands, and update checks (`web/src/use-chat.ts:2106-2121`).
  Do not import `useChat()` as an innocent read-only subscription hook.

## 2. Concrete reuse/adapt/avoid matrix

“Reuse” below means a candidate for a later approved extraction, not authorization to copy now.
License **U** means upstream MIT copyright/license preservation; **D** means additional dependency/asset obligations listed in section 6.
All rows need a pinned source-group record if adopted.

| Source group and anchors                                                                                                                                | Disposition                                                       | Concrete useful portion / required adaptation                                                                                                                                                                                                                                                                                                                             | Coupling and attribution                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web/src/conv-groups.ts:29-53`, `:56-155`; `tests/unit/conv-groups.test.ts:26-117`                                                                      | **Reuse small pure helpers**                                      | Parent/child flattening, collapse counts, orphan/cycle guards, grouping that does not flash when active ID and cwd arrive separately. Replace conversation type with a narrow task/run view model. Include failed/canceled/unknown/stale aggregates; upstream aggregates only streaming/error/question. A tree can display one worker and does not authorize a scheduler. | Type-only `ConversationSummary`; no React runtime required. U.                                                                                                                                                                                                                                                                 |
| `web/src/components/LeftPanel.tsx:1-43`, `:1353-1427`                                                                                                   | **Adapt row presentation, not whole panel**                       | Parent indentation, subagent badge, current selection, collapsed descendant counts, failure/waiting indicators. Give canceled/unknown outcomes explicit visible labels, separate from connection and streaming.                                                                                                                                                           | Whole panel pulls project/history CRUD, context-menu slots, composer, `use-chat`, i18n, icons, CSS and app-global capabilities. Extract small props-only rows; do not bring dismissal/takeover/rename actions implicitly. U + D (React/icons).                                                                                 |
| `web/src/components/ToolCallBlock.tsx:208-215`, `:279-309`; `server/agent-service.ts:4390-4419`                                                         | **Adapt activity card**                                           | Clearly distinguishes tool running, tool ended awaiting message reconciliation, final tool result, error, duration and known exit code. This is more useful than a generic animated “working” badge. Cadence must supply its own parent-check/worker evidence.                                                                                                            | Whole component also depends on Markdown, custom tool renderers, plugin slots, preview/context-menu machinery and app actions. Upstream failure exit-code fallback parses text; do not reuse it as Cadence check evidence. U + D.                                                                                              |
| `web/src/message-delta.ts:1-11`, `:42-83`; `tests/unit/message-delta.test.ts:33-107`                                                                    | **Reuse/adapt pure reducer**                                      | Immutable streaming patches, stable message identity, token-usage merge; useful for incremental prose if later required. Keep terminal outcome outside this reducer.                                                                                                                                                                                                      | Structural types only; protocol assumptions still need adaptation. Sequence checking happens in `use-chat`, not this helper. U.                                                                                                                                                                                                |
| `server/protocol.ts:3257-3326`; `server/agent-service.ts:5167-5210`; `web/src/use-chat.ts:1080-1106`, `:1822-1846`, `:2125-2165`                        | **Adapt protocol/reconciliation pattern**                         | Authoritative full snapshot; append delta with `baseRev`/`rev`; full resync on gaps; small live events for responsiveness. Design a Cadence projection instead of copying full `UiState` or making a second runtime store.                                                                                                                                                | Upstream protocol is a huge general chat/admin/terminal API; snapshot construction depends on ClientSession’s stable serialized message references. `use-chat` is about 3,000 lines and tightly application-coupled. U.                                                                                                        |
| `server/index.ts:2409-2442`, `:2850-2862`; `web/src/use-chat.ts:2023-2037`, `:2790-2807`                                                                | **Adapt transport mechanics only**                                | Snapshot backpressure with delayed retry, idempotent hello, stale-socket guards, bounded reconnect delay. Preserve controller-owned work while subscribers reconnect.                                                                                                                                                                                                     | Express/ws + engine dispatcher + ClientSession; not standalone transport modules. Revisit non-snapshot queue limits and final-state delivery, rather than accepting “must always get through” as a guarantee. U + D (Express/ws if selected).                                                                                  |
| `web/src/base-url.ts:25-70`; `server/host-guard.ts:53-87`; `server/auth-cookie.ts:17-32`, `:51-57`                                                      | **Reuse selected helpers / adapt policy**                         | Base-path URL consistency, defensive cookie decoding, testable Host checks. Keep host/origin/auth policy explicit for the chosen exposure boundary.                                                                                                                                                                                                                       | Base helper consults DOM/Vite fallback. Host helper allows private LAN hosts and bypasses checks with token; TLS helper trusts forwarded headers. These defaults are not automatically Cadence policy. U.                                                                                                                      |
| `web/src/components/Markdown.tsx:29-53`, `:75-91`, `:228-271`                                                                                           | **Adapt minimal renderer**                                        | Readable plans/results, code-copy presentation; raw HTML off by default and sanitize if enabled. Omit dynamic plugin widgets/fences and file-opening side effects unless separately required.                                                                                                                                                                             | ReactMarkdown + remark/rehype + highlight.js + KaTeX CSS/fonts + plugin registry/preview bridges. A plain text/minimal Markdown option avoids substantial coupling. U + D.                                                                                                                                                     |
| `plugins/run-trace/index.mjs:16-29`, `:42-49`, `:359-443`; `plugins/run-trace/client/entry.mjs:140-186`, `:436`, `:1440`; `plugins/run-trace/README.md` | **Adapt optional timeline presentation, avoid inferred evidence** | Lanes for input/model/tool events, select-to-inspect details, bounded previews, lazy detail fetch, follow/replay presentation. Feed Cadence-owned events if such a view is chosen. Clearly label estimated timing; never call guessed paths an authoritative diff.                                                                                                        | Plugin `host.getActiveConversation/onRunEvent/onAttach/onMessage/broadcast` plus custom DOM/CSS and vis-timeline vendor; not a React component. History timings are estimated and files are inferred from tool names/arguments. Remove CDN fallback and review subscriber scoping. U + D (vis and bundled transitive notices). |
| `web/src/components/PlanBoard.tsx:26-40`, `:54-85`, `:125-153`                                                                                          | **Adapt visual checklist only**                                   | Expand/collapse steps, current step, progress summary and Markdown export are presentation ideas. Distinguish self-reported checklist progress from checked/reviewed completion.                                                                                                                                                                                          | Current board directly edits statuses and sends `set_plan_mode` followed by `prompt` to start implementation. Also contains clean-handoff actions. Do not reuse those commands as native Start consent. React/icons/i18n/global `appSend`. U + D.                                                                              |
| `server/subagents.ts:29-95`; `server/subagent-helpers.ts:40-113`; `server/agent-service.ts:1052-1162`                                                   | **Avoid runtime/status model as-is**                              | Learn relationship/visibility patterns only. Do not import scheduling, templates, retries, hidden session creation, or `!streaming ⇒ done` semantics.                                                                                                                                                                                                                     | SDK/typebox, ClientSession/Conversation, goal service, terminals, model/settings/resource loaders. `SubagentState` lacks failed/unknown and carries errors separately. U if any later extraction; secondary-reference notes discussed in section 6.                                                                            |
| `extensions/webui.ts:241-284`; `server/agent-service-daemon.ts:1126-1255`; `server/agent-service.ts:2695-2736`, `:3622-3654`                            | **Avoid execution bootstrap and recovery**                        | Not a bridge to current terminal execution. Reusing launcher/runtime would add a separate owner, persistent transcript handling and automatic continuation.                                                                                                                                                                                                               | Full host environment, global SDK resolution, ambient Pi credentials/resources, per-tab runtimes, client-state storage. U if ever selected; not an acceptable shortcut to R1/R4/R5/R6.                                                                                                                                         |
| `server/terminals.ts:21-25`, `:205-209`; `docs/architecture-terminal.md`; `package.json:92-103`, `:130-160`                                             | **Avoid by default; conditional UI only**                         | xterm presentation is useful only if the eventual scope explicitly needs an interactive browser shell. A status/log dashboard does not need PTY creation or terminal input.                                                                                                                                                                                               | Native node-pty, platform patching, shell lifecycle, xterm, terminal bridge. SSH/DSH/Electron/updaters/plugin marketplace/browser control are unrelated application scope, not necessary reuse. U + D if selected.                                                                                                             |

## 3. Status/progress truth: strengths and pitfalls

### Useful distinctions already visible upstream

- `ConversationSummary` separates `isStreaming`, `error`, `canceled`, `parentId`, and `hasQuestion` (`server/protocol.ts:2658-2685`).
  Connection openness lives elsewhere in the client state.
- Subagent row expansion permits inspecting live conversation/tool output, rather than just seeing a spinner (`web/src/components/LeftPanel.tsx:1353-1427`).
- Immediate `tool_status` records `isError`, optional `exitCode`, and elapsed time before the transcript snapshot catches up (`server/protocol.ts:3314-3326`).
  The tool card makes this transition visible.
- Pending questions and approvals are represented in snapshots as well as live messages, avoiding disappearing prompts after refresh (`docs/architecture-core.md`, “待答问卷进快照”; `web/src/use-chat.ts:1080-1105`, `:2125-2148`).

### Do not copy outcome inference

`subagentRunOutcome` inspects the last assistant message’s `errorMessage`/`stopReason`; it returns no outcome on retry or read failure (`server/subagent-helpers.ts:40-65`). `roleOutcomeOf` defaults that absence to `done` (`:68-73`). `toSubagentSnapshot` chooses `running`, `canceled`, or `done`, with `error` separate (`:76-113`). `isSubagentTerminal` is simply `!!r && !r.streaming` (`server/subagents.ts:57-61`).

This is not model-prose completion parsing, but it is still **insufficient for Cadence**: no durable completion/closure evidence may exist, failed runs can have `state: done` plus an error flag, and a temporarily unreadable session can appear idle/done.
The inspected normal subagent row displays error/question/streaming but does not visibly render its `canceled` field (`LeftPanel.tsx:1374-1427`).

Cadence already distinguishes worker `completed/failed/canceled/timeout/unknown`, closure, exit code/signal, checks `passed/failed/canceled/stale`, task phases, and human review (`Cadence:src/task-types.ts:5-58`).
These are **separate dimensions**, not one inherited “done” badge.
Future browser presentation must not equate:

- socket open with worker running;
- socket closed with canceled or completed;
- token silence with failure or completion;
- last assistant text with successful execution;
- successful tool call with passing parent checks;
- checklist percent with checked work;
- checked work with human review.

### Timeline-specific honesty

The optional run-trace plugin is valuable visual reference, but:

- `estTextMs` estimates text duration from character count, bounded 0.8–120 seconds (`plugins/run-trace/index.mjs:42-49`); history rendering scales estimates to fit the next message (`:195-229`).
  Historical tool duration can consequently use an inferred call start (`:232-265`).
  Live `tool_end` can use measured event duration (`:425-435`).
  Mark measured versus reconstructed data separately.
- File-change segments are inferred from tool-name regexes and argument path keys (`:24-29`, `:51-60`, `:278-280`), not a repository diff or attribution of actual writes.
- It retains only a bounded recent conversation set and rebuilds from the active transcript (`:16-22`, `:359-395`); it is not a durable multi-run event ledger.
- It broadcasts segments to plugin subscribers (`:393-395`, `:422`, `:443`) and has one active-conversation focus.
  Review scoping before any multi-user or multi-workspace adaptation; do not assume isolation.

## 4. Reconnect and shared-truth lessons

### Reusable mechanisms

1. **Authoritative snapshot over opportunistic deltas.**
   Match both conversation identity and base revision before merging (`web/src/use-chat.ts:1080-1106`).
   Sequence gaps schedule a 300 ms debounced `get_state` (`:1822-1846`).
   On reconnect, request a fresh full state (`:2106-2107`).
   Do not replay a Start command to recover a view.
2. **Retry the final dropped snapshot.**
   Upstream specifically addresses the case where backpressure drops the last update and no later event arrives (`server/index.ts:2418-2436`).
   Merely waiting for the next sequence gap cannot repair a silent tail loss.
3. **Subscriptions are not runtime ownership.** `detachSink` removes the browser sink, not the conversation or its PTYs (`server/agent-service.ts:3751-3758`).
   After reconnect, lists/settings/questions/terminals are repushed (`:3711-3748`).
   Cadence can preserve its own bounded lifecycle semantics without making browser presence a run-success signal.
4. **Prevent duplicate attach and stale sockets.**
   Server guards repeated hello on one connection (`server/index.ts:2850-2862`); client guards old sockets and uses exponential 1–10 s reconnect delay (`web/src/use-chat.ts:2790-2807`).
   This is not command-level exactly-once execution.
5. **Narrow render dependencies.**
   Pure helpers and stable message references allow memoized rows/cards to avoid rerendering for every token (`LeftPanel.tsx:45-48`; `server/agent-service.ts:5160-5185`).
   Do not put high-frequency snapshots into a whole-app singleton store.

### Remaining design work if transport is adopted

- Upstream revisions/sequence numbers are in-memory protocol state, not a durable event log.
  A Cadence projection needs unambiguous task/run identity and restart/epoch handling so old updates cannot affect a new run.
  Precise schema is deferred to design.
- The upstream `tool_status` message lacks `conversationId`/sequence, unlike `tool_delta` and `message_delta` (`server/protocol.ts:3290-3326`).
  Do not use only a tool-call ID as a cross-run check-result key.
- Snapshot dropping bounds one class of traffic, but non-snapshot deltas are always sent by the inspected `send` path (`server/index.ts:2409-2442`).
  Bound all subscriber queues and payloads; “not deliberately dropped” is not a delivery guarantee across disconnects.
- Preserve a stale/unknown observation state until resync completes.
  A cached last-known view must not masquerade as fresh liveness.
- Per-tab session creation is upstream UX, not an appropriate default identity model for multiple views of one Cadence task.
  Separate viewer identity from execution identity; do not import orphan adoption or runtime takeover to solve ordinary viewing.
- If browser mutations are later authorized, server-side authorization, stale-revision checks, explicit command results and duplicate-request handling need their own contract.
  Existing WebUI hello idempotency does not provide those properties.
- **Exclude automatic restart continuation and transcript repair.**
  Those are execution/storage policies, not reconnect necessities.

## 5. Security and authority lessons

### Positive patterns to retain conceptually

- Default bind is `127.0.0.1` (`server/index.ts:201-202`); HTTP Host validation precedes routes (`:271-285`), and WS upgrade enforces origin/host and optional token checks (`:980-1001`, `:1064-1081`).
  Localhost alone does not prevent DNS-rebinding or cross-site WebSocket requests.
- Token comparison hashes to fixed size before `timingSafeEqual` (`server/index.ts:319-328`).
  Cookie decoding tolerates malformed input (`server/auth-cookie.ts:51-57`).
- Authenticated cookies use `HttpOnly; SameSite=Strict`, with conditional `Secure` (`server/auth-cookie.ts:29-32`).
  Anonymous health checks do not receive the real token (`server/index.ts:354-380`; regression at `tests/token-auth-test.mjs:151`).
- Provider key wire types carry names, not values or masked fragments (`server/protocol.ts:2638-2648`).
  Cadence should not expose its parent-auth snapshot in a browser task DTO.
- Model content is still untrusted rendering input: despite “trust model” wording in some docs, actual raw-HTML Markdown path uses `rehypeRaw` then `rehypeSanitize` (`web/src/components/Markdown.tsx:84-91`).
  Preserve sanitization; avoid dynamic plugin widget execution in a minimal task view.

### Defaults that need redesign or explicit scope acceptance

1. **Shared password is not authorization per action or per user.** `PI_WEB_TOKEN` is optional (`server/index.ts:216-219`) and gates the broad application.
   It does not distinguish observer from executor/reviewer.
   A hidden browser button is not an authority boundary; reading a task must remain distinct from Start/check/review permission.
2. **Do not copy token storage/URLs casually.** `web/src/auth-token.ts:17-25` stores the token in localStorage and scrubs the initial address bar; `:41-45` re-appends it to subsequent URLs.
   JavaScript-readable persistent storage and URL-based tokens introduce XSS/log/referrer exposure considerations.
   The HttpOnly cookie does not remove those exposures.
3. **Origin check is useful but not complete auth.**
   No-Origin clients are admitted by the origin predicate; optional token checks still apply separately (`server/index.ts:991-997`, `:1075-1081`).
   Host helper permits private LAN addresses and treats a configured token as sufficient (`server/host-guard.ts:77-87`).
   These are upstream policies, not proof of remote or multi-user readiness.
4. **Origin/TLS normalization needs testing.**
   Actual origin comparison strips the scheme and parses authorities through an HTTP URL (`server/index.ts:970-997`); it is not a complete scheme-aware browser-origin comparison.
   TLS detection trusts forwarded headers (`server/auth-cookie.ts:17-25`).
   Any reverse-proxy design must define trusted proxy headers and exact origins, rather than blindly importing these helpers.
5. **Validate wire data at runtime.**
   The ingress starts with `JSON.parse(...) as ClientMessage` (`server/index.ts:2840-2848`), followed by various field checks.
   TypeScript unions are not runtime validation.
   A narrow Cadence API should explicitly validate messages, bounds, identifiers, paths and authorized operations; this is not a claim that every upstream handler is unvalidated.
6. **Remove incidental network execution.**
   Run-trace dynamically falls back to esm.sh JavaScript (`plugins/run-trace/client/entry.mjs:168-179`).
   Offline/local expectations and privacy are undermined by an implicit CDN fallback.
   The normal hook also checks updates on ready.
   None is necessary for observing a task.
7. **Browser output expands the disclosure surface.**
   Plans, prompts, file paths, tool output and errors may contain secrets or untrusted markup.
   Bounded summaries are not redaction.
   Keep Cadence’s sanitization/private-diagnostic distinction; do not export arbitrary transcripts, parent credentials or the full process environment merely because upstream does.
8. **A browser shell is execution authority.** xterm input, SCM mutation actions, provider management, plugin loading, terminal creation and remote SSH are not dashboard conveniences.
   They require separate scope/authority decisions and should not arrive transitively with a reused panel.

Remote access, multi-user identity, TLS termination, session expiry/revocation, CSP and role/access checks remain **unqualified**, not implicitly supported by this research.
No security tests or penetration checks were run.

## 6. Licensing, attribution and dependency coupling

### Upstream source license

`LICENSE:1-21` is MIT, copyright **(c) 2026 xing-shuyin**; `package.json:5-8` confirms MIT and author identity.
Copies/substantial portions must include the copyright and permission notice (`LICENSE:12-13`); retain the full license including disclaimer.
MIT permits modification/redistribution; it does not require adopting upstream application architecture or imply endorsement.

No standalone `NOTICE`, `THIRD_PARTY_NOTICES`, or extra LICENSE-named file was found in the inspected checkout outside `.git`.
**This does not mean all shipped bytes are exclusively covered by the root MIT license.**
Embedded vendor notices exist, including:

- `plugins/run-trace/client/vendor/vis-timeline.bundle.mjs:1-26`: vis-timeline 8.5.4, Almende B.V./visjs contributors, Apache-2.0 **or** MIT choice; `:44-49` also contains Hammer.JS MIT attribution.
- `plugins/vscode-editor/client/entry.mjs:42838-42854`: bundled xterm MIT notices and original-author provenance.
  This editor bundle is outside the recommended reuse scope.

Source comments acknowledge other projects as conceptual references (`server/subagents.ts:6-8`: tintinweb/nicobailon pi-subagents; `PlanBoard.tsx:36`: DSH/narumitw/plannotator).
That is not evidence that those projects’ code was copied, nor a complete secondary provenance audit.
If substantial code from these particular groups is selected later, verify that provenance before redistribution; preserving root MIT alone must not be assumed to resolve unidentified third-party material.

### Proposed attribution record for later approved reuse

For each selected source group, record upstream URL + pinned SHA + source paths + destination paths + modifications + applicable licenses.
Preserve full upstream MIT text in the distributed license material and identify pi-web-ui in the package notices.
Cadence already ships `THIRD_PARTY_NOTICES.md` and `licenses/` (`Cadence:package.json:16-24`), so there is an existing place to extend **after implementation approval**, without overwriting Cadence’s own license.

Keep original embedded notices when copying vendor code/assets.
Audit bundled browser dependencies and transitive licenses independently of package.json’s top-level license.
If choosing the Apache license for a dual-licensed dependency, satisfy its license/notice/modification requirements; using its MIT option still requires preserving that dependency’s MIT notice.
Avoid copying branding/screenshots/generated bundles simply to accelerate UI extraction.

### Dependency metadata inspected (not an installed-artifact legal audit)

| Candidate dependency             | Pinned lock version / recorded license | Upstream anchor / implication                                                                                                                                                      |
| -------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| React / React DOM                | 19.3.0 / MIT                           | `package-lock.json:11304`, `:11314`; new browser build surface for Cadence.                                                                                                        |
| react-icons                      | 5.7.0 / MIT package metadata           | `package-lock.json:11327`; selected icon sets also need their own provenance/license verification, not only the wrapper’s license.                                                 |
| react-markdown / rehype-sanitize | 10.1.0 / 6.0.0, MIT                    | `package-lock.json:11337`, `:11482`; Markdown extraction otherwise drags more remark/rehype/KaTeX/plugin machinery.                                                                |
| highlight.js                     | 11.12.0 / BSD-3-Clause                 | `package-lock.json:8075`; preserve BSD notice/disclaimer and no-endorsement condition if bundled.                                                                                  |
| vis-timeline                     | 8.5.4 / `(Apache-2.0 OR MIT)`          | `package-lock.json:13003`; standalone vendor has bundled dependencies and notices; use only if richer timeline is selected.                                                        |
| xterm / addon-fit / node-pty     | 6.0.0 / 0.11.0 / 1.1.0, MIT            | `package-lock.json:4472`, `:4465`, `:10533`; native PTY installation/platform complexity is unnecessary for readonly output.                                                       |
| Express / ws                     | 5.2.1 / 8.21.3, MIT                    | `package-lock.json:7180`, `:13345`; transport ideas do not require adopting this server stack.                                                                                     |
| Vite                             | 8.3.0 / MIT                            | `package-lock.json:13044`; build-only tooling is distinct from shipped JS/license inventory.                                                                                       |
| Pi coding-agent SDK              | 1.1.0 / MIT                            | `package-lock.json:1387`; upstream optional dependency requires `>=1.1.0`, peer is `*` (`package.json:105-111`). Do not assume this runtime API matches Cadence’s development pin. |

Upstream puts React/Vite/xterm/browser-rendering libraries in devDependencies because it ships built assets (`package.json:20-33`, `:121-160`).
“Dev dependency” does not remove attribution obligations for code bundled into delivered JS/CSS/fonts.

Cadence currently declares Node `>=22.13.0`, Pi SDK development pin `0.84.3`, and no React/Express/xterm dependency (`Cadence:package.json:7-9`, `:48-64`).
Upstream additionally couples DSH, ssh2, Electron updater and archive/update tooling (`package.json:92-103`).
Copying its package manifest/build pipeline would silently expand platform requirements and application scope.
A future extraction should select source groups first, then explicitly justify each dependency; no installation was performed here.

## 7. Existing tests worth adapting later, not passing evidence

- Tree/grouping and collapse: `tests/unit/conv-groups.test.ts:26-117`.
- Immutable streaming and identity changes: `tests/unit/message-delta.test.ts:33-107`.
- Revision-chain snapshots: `tests/snapshot-delta-test.mjs:109-145`.
- Host admission: `tests/unit/host-guard.test.ts:60-74`.
- Token non-reflection: `tests/token-auth-test.mjs:151`; cookie encoding/TLS behavior: `tests/unit/auth-cookie.test.ts`.
- Existing lifecycle test sources: `tests/offline-takeover-test.mjs`, `tests/takeover-rollback-test.mjs`, `tests/subagent-takeover-test.mjs`, `tests/subagent-ui-context-test.mjs`.
  These exercise WebUI-owned sessions, not terminal attachment.

Future Cadence verification must additionally cover browser absent; disconnect during tool/check execution; lost final snapshot; stale/reordered frames across restart/new run; repeated view/hello without execution; failed/canceled/timeout/unknown distinctions; checks versus human review; and, only if authorized, duplicate/stale browser control requests and access policy.
No current upstream test reference proves those Cadence criteria.
A static existence/line-range check of explicit upstream anchors in this report found no missing files or out-of-range references; that is documentation validation only.
Final upstream HEAD/status verification remained unchanged and clean.

## 8. Planning decisions left open

1. **Observation or actionable workspace?**
   Row/tool-card/snapshot reuse works for either.
   Start/stop/check/review controls must wait for the product authority decision; upstream `appSend` actions are not a shortcut.
2. **One worker or coordinated workers?**
   A single-worker view benefits from the same status vocabulary.
   Tree/timeline presentation does not justify a scheduler or importing subagent spawn tools.
3. **Local single-user or remote/multi-user?**
   Loopback/auth/origin lessons apply now, but shared-token/orphan-adoption/broadcast semantics do not establish remote-user isolation.
4. **Lifecycle owner and storage boundary?**
   Required design work is how to project the existing Cadence owner’s records/live observations without restarting work or becoming another writer.
   Reusing Pi transcript sessions is not that design.

**Bottom line:** extract small presentation/pure-function groups and transport lessons; keep Cadence’s existing execution/check/review authority intact pending reviewed product/design decisions.
The largest risks are a second execution owner, automatic restart continuation/history repair, misleading derived completion, and importing a full privileged chat/PTY/plugin application under the label of UI reuse.
