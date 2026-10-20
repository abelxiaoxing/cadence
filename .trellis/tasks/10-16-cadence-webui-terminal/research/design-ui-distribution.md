# Complete client integration and distribution design recommendations

## Evidence and boundary

- Active task resolved with `python3 ./.trellis/scripts/task.py current --source`: `.trellis/tasks/10-16-cadence-webui-terminal`, session source.
- Read rewritten `prd.md` and `research/complete-workspace-reuse.md`; current PRD supersedes that report's residual “once agreed” language and older helper-only/MVP recommendations.
- `U:` means `/home/mirako/abel/pi-web-ui`, origin `https://github.com/xing-shuyin/pi-web-ui`, version `0.106.0`, clean inspected HEAD `e8bab487af208bc9a1ab60a821652323f598127f`.
- Inspected U package/lock/build config, component imports, run-trace client/vendor, browser fixtures and architecture; Cadence package/build/audit/tests/specs; global Pi SDK/extension/TUI/package docs and examples, checked against installed peer metadata.
- **Planning/source inspection only:** no network lookup, install, build, test, service/browser/provider launch, task activation, code copying, spec/product edit or nested agent.
  This report is the sole intentional write; main owns final design/implementation artifacts.
- Recommendation: one complete React/Vite task workspace, native Pi terminal client and persistent service owner.
  Replace control/data seams, not the substantial reusable UI.
  No separate browser runtime, fallback terminal executor or deferred core history/control feature.

## 1. Source-family → destination → adapter → dependencies/licenses/tests

All destinations are proposed repository-relative paths, not existing implementation.
Retain coherent JSX/CSS/helper families; record omitted privileged branches explicitly.
`MIT-U` means full U MIT notice, copyright 2026 xing-shuyin; dependency letters resolve in §4.
Test names below are proposed Cadence owners, not claims of passing upstream tests.

| Pinned U source family                                                                                                                                     | Proposed destination                                                                                                                                        | Thin adapter / required policy changes                                                                                                                                                                                                                                                                                                                                                                                            | Dependency, license and test mapping                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `web/src/App.tsx`, `components/{TopBar,FooterBar,LeftPanel,RightPanel}.tsx`, `styles.css`, `panel-sash.ts`, `left-sections.ts`, `topbar-fit.ts`            | `web/src/App.tsx`, `components/workspace/{TopBar,FooterBar,TaskSidebar,InspectorPanel}.tsx`, `styles.css`, `layout/`                                        | Adapt three-column composition, sizing/collapse, headers, active/history sections and style tokens together. Task/run/assignment navigation replaces conversations/projects; inspector tabs are Plan, Checks, Changes, Review. Remove composer/terminal/admin/plugin composition rather than stub their senders.                                                                                                                  | A/MIT-U; `test/web/layout.test.ts`, `test/browser/workspace.e2e.mjs`; port U `panel-layout-test.mjs` geometry assertions.                                          |
| `conv-groups.ts`, nested rows in `components/LeftPanel.tsx`, `components/PlanBoard.tsx`                                                                    | `web/src/navigation/assignment-rows.ts`, `components/plan/{PlanBoard,AssignmentTree}.tsx`                                                                   | Adapt grouping/tree/collapse and editable plan presentation; add dependency edges, capability, assignment text, waiting reason, model and actual outcome. Tree is navigation, not scheduler DAG. Checkbox edits change drafts, never execution outcomes; replace prompt/clean-handoff/plan-mode Start.                                                                                                                            | A/MIT-U; `test/web/plan.test.ts`, browser workspace; port `tests/unit/conv-groups.test.ts`.                                                                        |
| `components/{MessageList,Message,CollapsedMessage,LazyMount,CollapsibleHead}.tsx`, `lazy-window.ts`, `scroll-classify.ts`, `skill-block.ts`                | `web/src/components/transcript/` and `web/src/transcript/` matching modules                                                                                 | Reuse full transcript rendering, stable-height windows, scrolling/follow, expansion and role/tool composition. `transcript-adapter.ts` projects recorded IDs, pages and tool links; remove retry/fork/reask/steering/TTS/upload/plugin actions. Do not strip apparent inline control markers from recorded text. Render orphan tool results explicitly.                                                                           | A+B/MIT-U; `test/web/transcript.test.ts`, `test/browser/history.e2e.mjs`; port lazy-window/stream-markdown tests.                                                  |
| `components/ToolCallBlock.tsx`, `tool-args.ts`, copy-feedback and command-highlighting helpers                                                             | `web/src/components/transcript/ToolCallBlock.tsx`, `web/src/transcript/tool-args.ts`, `tool-detail-adapter.ts`                                              | Keep expandable structured/raw arguments, result panes, command chrome, copy and assignment briefs. Tool identity is `(runId, assignmentId, toolCallId)`; status/closure supplied by owner, never `streaming && !result`. Replace regex child links with IDs; remove bash-kill, questionnaire submission and server/tool-manager imports.                                                                                         | A/MIT-U; transcript unit + history browser tests for missing start/end, duplicate call IDs across children, refused detail.                                        |
| `components/{Markdown,StreamMarkdown}.tsx`, `stream-markdown.ts`, `code-lines.ts`, `remark-backslash-math.ts`, code-copy helpers                           | `web/src/components/rich/{Markdown,StreamMarkdown}.tsx`, `web/src/rich/` matching helpers                                                                   | Preserve Markdown/GFM/math/code-line/copy/streaming pipeline. No generic fence/widget loader; unknown fences remain code. Replace file-preview bridge with captured artifact IDs. Default raw HTML off; retain sanitize path if explicitly used. External images blocked by default; safe links omit credentials/referrers.                                                                                                       | A+B/MIT-U; highlight BSD-3-Clause and font notices; port U markdown/html/math/chunks/code-lines tests into `test/web/rich.test.tsx`; browser XSS/link/image tests. |
| `components/FilePreview.tsx`, `preview-toc.ts`, `components/SCMPanel.tsx:593-628,899-1080`, `scm-sidebar.ts`                                               | `web/src/components/review/{ArtifactPreview,ChangePanel,DiffView}.tsx`, `web/src/review/`                                                                   | Adapt preview chrome, raw/Markdown, ToC, line navigation, zoom/fullscreen plus complete change-list/diff presentation. `change-adapter.ts` reads observation/artifact IDs, labels baseline dirt, captured versus current and incomplete coverage. Delete editor/save/script-preview, filesystem browser, upload/extract and all Git/terminal mutation controls.                                                                   | A+B/MIT-U; `test/web/review.test.ts`, browser review checks Unicode/binary/deletion/long diff, stale checks and issues acknowledgment; no new diff library needed. |
| `components/{GlobalSearchModal,SearchBar}.tsx`, `search-req-id.ts`, `search-folded.ts`, `session-url.ts`                                                   | `web/src/components/history/{HistorySearch,SearchBar}.tsx`, `web/src/history/{search-req-id,search-folded,history-url}.ts`                                  | Reuse modal sections, debounce, request correlation, keyboard/hit navigation and highlighting. `history-client.ts` supplies server cursors and exact message/tool anchors; no `switch_session`, plugin search or composer quotation. Token-free deep links identify task/run/child/record, not timestamp guesses.                                                                                                                 | A/MIT-U; `test/web/history-navigation.test.ts`; port folded-search tests and adapt global-search UI fixture to real persisted history.                             |
| `plugins/run-trace/client/entry.mjs` **whole standalone client** and its embedded style family; `client/vendor/{vis-timeline.bundle.mjs,vis-timeline.css}` | `web/src/timeline/timeline-client.mjs`, `timeline.css`, `TimelineView.tsx`, `timeline-adapter.ts`; audited vendor artifacts under `web/dist/assets/vendor/` | React wrapper calls `mount(element, ctx)` and returned disposer. Keep lanes, list, four detail tabs, zoom/follow/filter/search/replay; add assignment lanes and canceled/unknown/blocked states. Narrow context only reads state/event pages/detail; remove `clear`, CDN import and unrestricted plugin host. Replace synthetic char-rate timing/regex file attribution with recorded observations and explicit unknown duration. | C/MIT-U + vis/embedded notices; `test/web/timeline.test.ts`, browser history replay/mount-dispose/resize/long-page tests. Visualization never starts/resumes work. |
| `use-chat.ts` reducer/rev-gap/reconnect/final-resync families, `message-delta.ts`, `app-globals.ts` read-subscription pattern                              | `web/src/client/{use-workspace,workspace-reducer,message-delta,view-preferences}.ts`                                                                        | Preserve immutable/stable-reference delta merge, stale-socket guards, bounded backoff and final resync. Shared portable `src/service-client.ts` owns transport/decoding; use service epoch + persisted cursor. Global preferences hold only display state, **no `appSend`, generic `send(ClientMessage)` or action bus**.                                                                                                         | A/MIT-U; `test/web/reconciliation.test.ts`, `test/service-contract.test.ts`, browser reconnect/lost-final tests; adapt U message-delta/snapshot-delta fixtures.    |
| `auth-token.ts`, `session-url.ts`, token/cookie/origin/upgrade helpers in `server/index.ts:195-393,1064-1081`                                              | `web/src/client/auth-entry.ts`, `web/src/history/history-url.ts`; server counterpart `src/service-auth.ts`                                                  | Adapt reference token-link admission/URL stripping and pre-upgrade auth; cookie-first thereafter. No localStorage token or repeated query token. Entry exchange validates the reusable owner token and yields an opaque HttpOnly session cookie; invalidation epoch closes old WS and rejects old cookies. Native client uses private local admission, not browser URL secrets.                                                   | D/MIT-U; `test/service-auth.test.ts`, `test/browser/auth.e2e.mjs`; adapt U token-auth negative cases, add Origin/CSRF/export/rotation cases.                       |
| `components/Dialog.tsx`, `shortcut-stack.ts`, `use-floating-panel.ts`, `use-swipe-drawer.ts`, `swipe-drawer.ts`, responsive blocks in `styles.css`         | `web/src/components/actions/{ActionDialog,StartDialog,CheckDialog,ReviewDialog}.tsx`, `web/src/layout/`                                                     | Reuse dialog/escape/focus and drawer/gesture mechanics with explicit typed callbacks. Sticky connection+run status and Cancel stay reachable; drawers yield to horizontal code/table scroll. Add keyboard focus containment/return and phone keyboard/safe-area behavior.                                                                                                                                                         | A/MIT-U; `test/web/actions.test.ts`, `test/browser/responsive.e2e.mjs`; adapt U swipe-drawer/layout tests.                                                         |
| `copy-text.ts`, `download.ts` naming/error UX                                                                                                              | `web/src/history/{copy-text,download-export}.ts`, `components/history/ExportDialog.tsx`                                                                     | Reuse text/Markdown copy and download interaction; add durable scoped export through history API, not DOM screenshot or arbitrary-file download. Do not import html-to-image/SaveImageDialog: image export is outside agreed core and cannot substitute for recorded history.                                                                                                                                                     | A/MIT-U; history/export service + browser tests, selected child scope and incomplete-download cases.                                                               |

## 2. Shared client contract, actions and terminal parity

- New `src/service-contract.ts` owns JSON-safe DTOs, discriminated outcomes, runtime decoders and protocol version; no Node/Pi/React imports. `src/service-client.ts` is a portable fetch/subscription client with explicit methods, consumed by terminal and browser; platform admission/socket construction is injected. `web/src/types.ts` reexports only these public DTO types, never U's general chat protocol or server SDK objects.
- One projection contains owner epoch, task/plan revisions, task/run/assignment IDs, dependency/wait state, observed lifecycle and closure, check status/fingerprint, human-review status, coverage and last observed sequence/time.
  Connection freshness is a separate field; disconnected is not canceled, idle is not success, human Done is not check PASS.
- Suggested read methods: `listTasks`, `getTask`, `listRuns`, `getAssignment`, `getMessages`, `getTool`, `getContentChunk`, `getEvents`, `getChanges`, `searchHistory`, `getActionReceipt`, `streamExport`, `subscribe`.
  Suggested writes: `createTask`, `editPlan`, `prepareAction`, `confirmStart`, `requestCancel`, `confirmCheck`, `recordReview`.
  Encode separate schemas/routes; reject unknown actions/fields server-side.
- Action flow: load authoritative context → display goal, full readable plan/decomposition, cwd, model/thinking, roles/capabilities, baseline dirt and side effects → prepare action bound to that displayed revision (prepare must include expected identities, not silently capture newer state) → fresh affirmative confirmation → submit unique action ID + one-use prepared context → show authoritative receipt.
  Proposed preparation expiry: 60 seconds.
  Expiry/change requires reread/reconfirmation, not automatic renewal.
- Bind Start to owner epoch, selected task/run context, raw plan identity/revision, checkout/cwd, model/auth-configuration identity (not secrets), assignment graph and capabilities.
  Check binds exact named definition/command/cwd/timeout and observed inputs; Review binds actual check/change observations and unresolved issues.
  Server validation remains decisive even when a button is disabled.
- Adapt U `i18n.tsx`/selected locale keys to `web/src/i18n.tsx` and `web/src/locales/`, retaining its fallback/key-parity behavior but removing server locale/config mutations.
  Use local display preferences only.
  Add import-boundary assertions rejecting upstream `appSend`, server runtime/SDK imports, plugin/PTY loaders and arbitrary network send interfaces from browser modules.
- On request timeout/disconnect, display “admission outcome unknown” and query the same action receipt after reconnect; never generate a replacement action ID or automatically resend a mutation.
  Duplicate action IDs return the existing receipt; mismatched reuse/stale context refuses.
  Cancel uses immutable run identity so unrelated view changes cannot cancel a replacement run.
- Plan edits/save/create are inert.
  “Generate plan” is a separately confirmed bounded readonly assignment; its draft never dispatches editing.
  No child changes its own capability, no plan-board status toggle settles a run, no retry/fork/Continue-as-chat path bypasses fresh Start.
- `src/task-shell.ts` becomes a service client facade, not a controller/SDK owner.
  Keep raw terminal entry latch, native `select/editor/confirm`, trusted/idle/context checks, Unicode-width helpers and pager.
  Keep `/cadence` the sole Pi command; SDK auth resolution moves to service, terminal sends validated selection references rather than provider credentials.

| Operation             | Native menu / browser surface                                                     | Shared authority and evidence                                                                                                 |
| --------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Create/open           | New; Open/history / sidebar and New task dialog                                   | Explicit create only; open/list performs no task/store repair or launch.                                                      |
| Plan/decompose        | Plan editor + assignment/dependency menus / PlanBoard                             | Same draft/revision API; readonly Generate plan requires its own confirmation.                                                |
| Start/cancel          | Review plan → native confirm; explicit Cancel / StartDialog and persistent Cancel | Same preparation/receipt contract; generated prompt text and browser access never authorize execution.                        |
| Observe/detail        | Runs → child → messages/tools/timeline pagers / transcript and timeline           | Same IDs/status/coverage; terminal needs no browser, browser needs no live terminal.                                          |
| Checks/change/review  | Checks; Changes; Review/Done / inspector tabs + dialogs                           | Real service-parent commands, same observation freshness and unresolved-issues acknowledgment.                                |
| History/search/export | History → search/hit/detail/export / history explorer                             | Same durable paged readers; explicit terminal export writes only a chosen new local file, never transcript repair.            |
| Service operations    | Service status/diagnostics; explicit management command / status/help panel       | Show active owner, connection, process uncertainty and storage health; starting/stopping/recovery is explicit, not discovery. |

- Preserve native manual-check usability through a private local authenticated capability and explicitly confirmed one-shot check-definition path (never a client-claimed `source: terminal` flag); browser selects owner-configured named checks only, with no arbitrary command/PTY endpoint.
  This is capability parity for real checks, not a generic remote shell.
  Main should spell this distinction into the common check contract.
- Terminal menu Return/window departure detaches only; do not cancel accepted service-owned work in `session_shutdown`/model navigation.
  Label **Return — work continues** separately from **Cancel run — request stop**.
  Pending native confirmations expire on departure; already accepted runs retain their captured context.
  Cancel acknowledgment distinguishes requested/settled/unknown.
- Retain ordinary-host noninterference, and assess same-checkout write guards against live owner admission rather than `controller.busy`.
  Guards are not an OS sandbox or a promise that arbitrary other terminals cannot edit.
  Never retain a parallel terminal executor to emulate old departure behavior.

## 3. Durable pages, privacy and remote usability

- Capture is service/worker-owned and independent of subscribers.
  Do not reuse U `serialize.ts` truncation as storage, session repair/open-runtime readers, ambient Pi history scans, or the ten-conversation run-trace memory cache as archive truth.
- Proposed display defaults: task/message/search pages 50, maximum 100; event pages 200, maximum 500; previews 4 KiB; text-detail chunks 64 KiB; JSON page response bound 1 MiB.
  Oversized individual content is a reference with retained byte length, not squeezed into a page.
  These bound transport/rendering, **not retained-history eviction**.
- Every page carries stable cursor/snapshot upper sequence, `hasMore`, coverage and omission metadata.
  Search literal recorded content across ordinary messages, task context, tool args/results and checks; stable hit `(recordId, field, byte range)` resolves a surrounding page directly.
  Keep UTF-8 byte offsets distinct from displayed character indices.
  Index/capture gaps return partial/refused, not “no matches.”
- MessageList windows only loaded DOM while history client fetches earlier/later pages.
  Opening a hit loads its exact record and required tool counterpart regardless of current window; unavailable counterpart is explicit.
  Long raw JSON/tool text stays paged/copyable/downloadable with offsets and total retained length; no 5,000-line preview masquerading as complete content.
- Timeline paginates time ranges/events; overview uses labeled recorded summaries rather than fake durations.
  Its own search delegates to durable search beyond the loaded range.
  Page changes/replay never switch SDK sessions.
  Unmount disposes subscriptions, timers, RAF, ResizeObserver and vis instance.
- Export selects task/run/child IDs and a snapshot cursor; stream `application/x-ndjson` (optional gzip via Node zlib) with manifest, identities/graph, messages/context, tool records/content chunks, lifecycle, change observations, checks/review, coverage/redaction and a completion trailer with counts/digests.
  Offer readable Markdown from the same reader.
  No screenshot dependency, unbounded in-memory concatenation or credential/config export.
- Downloads use authenticated same-origin requests, safe content-disposition, no token-bearing URLs, and explicit completion validation before reporting success.
  A missing trailer/truncated stream is incomplete; a recording quota/corrupt body/denied detail is a visible reason.
  Historical reads/export do not rewrite bytes or rebuild missing events.
- Admit `?token=` before loading application resources: exchange then redirect to a clean URL with `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; cookie HttpOnly/SameSite and Secure on explicit HTTPS remote route.
  Keep public health minimal; enforce configured origin/host, mutation CSRF protection and authenticated pre-upgrade WS.
  Rotation revokes sessions and live sockets, not just future links.
- No credentials in browser state/diagnostics/export.
  No service worker/offline authenticated cache, CDN/vendor fallback, dynamic plugin imports, automatic external images or third-party telemetry.
  CSP restricts scripts/connect/fonts/media to the chosen origin; account explicitly for React/vis dynamic styles rather than claiming impossible blanket inline-style prohibition.
- Desktop: resizable navigation/transcript/inspector; phone: drawers and full-height detail dialogs, persistent current run/Cancel, touch targets ≥44px, visible stale/offline/error labels, keyboard/focus restoration.
  Test 1440×900, 768×1024, 390×844 and 320×568, portrait/landscape and zoom; viewport emulation is not physical-phone evidence.

## 4. Dependency/build decision from actual manifests and lock

U `package-lock.json` is lockfile v3; versions below are its resolved entries, not network queries.
U has **no local node_modules** here; dependency full-license bodies/fonts and a working Vite build have not been inspected/executed.
Treat lock SPDX fields as inventory leads, not completed license audit.

| Set                  | Exact proposed additions / treatment                                                                                                                                                                                                          | Why and license leads                                                                                                                                                                                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A: browser           | Dev dependencies `react@19.3.0`, `react-dom@19.3.0`, `react-icons@5.7.0`, `@types/react@19.3.0`, `@types/react-dom@19.3.0`                                                                                                                    | Bundle React/DOM/icons into browser JS, not Pi runtime deps. All lock metadata MIT; keep only Feather (`fi`) icons, replace isolated Lucide (`lu`) use with equivalent Feather or audit Lucide's own notice if retained.                                                                   |
| B: rich rendering    | Dev dependencies `react-markdown@10.1.0`, `remark-gfm@4.0.1`, `remark-breaks@4.0.0`, `remark-math@6.0.0`, `rehype-highlight@7.0.2`, `highlight.js@11.12.0`, `rehype-katex@7.0.1`, `katex@0.18.7`, `rehype-raw@7.0.0`, `rehype-sanitize@6.0.0` | Matches reused pipeline; MIT except highlight BSD-3-Clause. Audit KaTeX CSS/font licenses individually, including font-specific notices where applicable. No Mermaid/plugin renderer required.                                                                                             |
| B type imports       | Explicit dev edges `unified@11.0.5`, `remark-parse@11.0.0`, `micromark-util-types@2.0.2`, `mdast-util-from-markdown@2.0.3`, `mdast-util-math@3.0.0`                                                                                           | U Markdown/backslash-math directly import these types; do not rely on npm-hoisted transitive imports under Bun. Lock metadata MIT.                                                                                                                                                         |
| C: timeline          | Dev `vis-timeline@8.5.4` for reproducible vendor generation; adapt U `scripts/build-runtrace-vendor.mjs`                                                                                                                                      | Copy exact standalone ESM and CSS, no plugin install. Header permits MIT or Apache-2.0; choose MIT for vis code and retain embedded dependency obligations (lock includes vis-data8.0.5, vis-util6.0.2, Hammer2.0.17, moment2.30.1). Do not assume root MIT covers the standalone bundle.  |
| D: service transport | Sole new production dependency `ws@8.21.3`; dev `@types/ws@8.18.1`                                                                                                                                                                            | Native `node:http`/crypto/zlib suffice for finite routes/static/auth; ws supplies audited upgrade/socket handling. MIT. Optional bufferutil/utf-8-validate are not required or installed by this feature. No Express/compression/node-pty/SSH/tar/yauzl/Electron/DSH.                      |
| Build/test           | Dev `vite@8.3.0`, `@vitejs/plugin-react@6.1.1`, `playwright-core@1.63.0`                                                                                                                                                                      | Vite/plugin MIT; Playwright Apache-2.0, test-only. Reuse existing Bun builder, TypeScript6.0.3/Vitest4.1.8/Biome/rumdl rather than U TypeScript7/Vitest5/esbuild tooling. No jsdom30.1.0 (requires Node22.22.2+ in lock), testing-library, React Compiler or browser auto-download needed. |

- Vite8/plugin6 lock engines are `^20.19.0 || >=22.12.0`; resolved Rolldown1.2.9 has same engine and platform-specific optional build bindings.
  U config already uses function-compatible `advancedChunks.groups`, not removed object `manualChunks`; plugin React compiler/Babel/OXC peers are optional.
  Confirm compatibility in real approved build, not by borrowing U's entire lock.
- Retain Cadence's existing public Pi peers `@earendil-works/{pi-coding-agent,pi-tui,pi-ai}: *`, `typebox: *`, `undici: ^8.9.0`; installed/dev Pi0.84.3 and Undici8.9.0 are separate qualification identities.
  Do not bundle Pi or add U optional SDK `>=1.1.0`, a private SDK subpath, resolver shim, npm upstream package dependency or hidden peer install.
- No new `pi-agent-core` direct peer unless implementation actually imports it.
  Existing engine `>=22.13.0` stays unless main approves an independently justified metadata change; installed SDK/Undici require22.19.0, a known dependency fact, not proof lower eligible runtimes worked.
- Browser/build packages are dev-only because shipped JS/CSS/fonts contain their runtime code.
  Service bundle leaves public Pi/Undici/ws imports external; extracted fixtures must provide every declared edge, including ws, from trusted existing roots.
  Do not assume Pi supplies ws or browser dependencies.
- Later authorized dependency work updates only `package.json`/`bun.lock` through normal lifecycle-disabled lock generation under repository isolation policy; stop on unavailable artifacts instead of online fallback.
  No dependency installation is authorized by this report.

## 5. Compiled CLI, stable assets and exact archive policy

- Add `src/service-cli-entry.mjs` and `scripts/build-service.mjs`; generate **`src/service-cli.mjs`** (Node ESM, shebang, local TS bundled, `packages: "external"`, no source map/minification), following existing `build-operator.mjs` exact-byte `--check` pattern.
  Manifest bin: `cadence-service` → `./src/service-cli.mjs`.
- Management grammar: explicit `start`, `status`, `stop`, `diagnose`, `recover`, `token rotate`; define finite validated flags in main design.
  `status/diagnose` never start/create/repair; stop/recovery/token changes require their own explicit command/confirmation and active-process accounting.
  No login service/autostart or task Start command hidden in install hooks.
- Keeping generated service next to current `sdk-worker.mjs` preserves `new URL("./sdk-worker.mjs", import.meta.url)` in bundled `subagent-process.ts:503` and `../agents/` in `agent-registry.ts:12-13`.
  Centralize explicit package-relative runtime paths from the compiled entry; test actual worker/Agent/static resolution, not assumptions about Bun's bundling of `import.meta.url`.
- Worker remains maintained ordinary JS at `src/sdk-worker.mjs`, running installed public peers.
  Web root resolves `../web/dist/` from compiled service; neither service nor worker invokes tsx/jiti/Pi CLI or reads repository-only TS for execution.
  Pi alone still loads `src/index.ts` through its supported extension loader.
- Add `web/tsconfig.json` (strict, ES2022 target, DOM/DOM.Iterable, react-jsx, bundler resolution) and a web-test no-emit config; keep backend TS environment Node-only.
  Shared contract/client must typecheck in both environments.
  Root `check` includes all configs, not an optional frontend check.
- Adapt U `web/vite.config.ts`: root `web`, target `es2022`, no sourcemaps, no service worker/public wildcard copying; deterministic build ID from reviewed source+lock, not U wall-clock timestamp.
  Keep React/Markdown named vendor groups, remove xterm group and upstream /plugins,/themes proxies.
  Dev server is opt-in and same-origin proxying must preserve production auth, not disable it.
- **Choose fixed artifact names**, not hash-bearing filenames: `web/dist/index.html`, `assets/cadence.js`, `assets/cadence.css`, named `assets/react.js`, `assets/markdown.js`, `assets/timeline-client.js`, `assets/vendor/vis-timeline.bundle.mjs`, `assets/vendor/vis-timeline.css`, and enumerated `assets/fonts/<original-name>.<ext>`.
- Configure one HTML entry (`entryFileNames: "assets/cadence.js"`), deterministic named chunks (`chunkFileNames: "assets/[name].js"`), `cssCodeSplit:false`, CSS asset filename fixed, fonts un-hashed, `assetsInlineLimit:0`.
  Name lazy entry module `timeline-client`; vendor loader uses only fixed same-origin artifact URLs.
  Build must fail on collisions/unexpected chunks; final reviewed membership includes every emitted referenced font/asset, not a guessed count.
- Use `Cache-Control: no-cache`/ETag for fixed public assets, no-store for HTML/auth/private API; protocol/build mismatch disables mutations and asks reload.
  Never mark fixed-name assets immutable.
  Content SHA-256 belongs in audit/provenance, not mandatory filename entropy.
- `build:web` writes artifacts; `build:check` rebuilds operator/service/web into fresh private temp and compares exact names/bytes against checked-in generated artifacts without overwriting them.
  Remove nondeterministic timestamp/absolute-source-path output.
  Pack requires freshness, never repairs/rebuilds implicitly during consumer install or `bun pm pack`.
- Update `package.json.files` with `web/dist` and shipped operation docs/licenses, while retaining existing extension/skills/Agents/config.
  Exclude `web/src`, Vite config, tests/build scripts, source maps, dev server, Trellis and private state.
  Explicitly review new service source members admitted by existing `src` inclusion.
- Extend reviewed `provenance/package-members.json` by exact members; do not generate expected membership from tar/build output under test.
  Replace 34/16 constants only after review.
  Preserve safe tar/body/link/pin checks in `scripts/package-audit.mjs`; add asset URL closure/MIME/no-external-fetch and license/build-provenance checks.
- `test/distribution.test.mjs` currently truncates diagnostic member checks with `expected.slice(0,64)`; revise to cover all reviewed members with a separately justified byte-bound receipt, not silently omit new fonts/assets.
  Retain after-extract/after-copy/after-peer audits and hostile Unicode/space/percent/bang paths.
- Extracted service qualification invokes `node <installed>/src/service-cli.mjs` from unrelated cwd with package source fallback unavailable.
  Verify service help/status/start/stop, static JS/CSS/fonts, actual SDK child/tool/check, no TS loader, required peer/ws resolution, and missing/altered worker/asset refusal without source refill.
  Raw pack remains `bun pm pack --destination <private-temp>`; no manager install/publication implicit.

## 6. Exact proposed quality routes and ownership

| Script          | Proposed command/role                                                                                                                    |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `build:service` | `bun scripts/build-service.mjs`                                                                                                          |
| `build:web`     | `node scripts/build-web.mjs` (invokes pinned Vite + deterministic vendor/assets steps)                                                   |
| `build`         | `bun run build:operator && bun run build:service && bun run build:web`                                                                   |
| `build:check`   | `bun scripts/check-builds.mjs` (temp regeneration + exact comparison, all three outputs)                                                 |
| `check:web`     | `tsc -p web/tsconfig.json --noEmit && tsc -p tsconfig.web-tests.json --noEmit`                                                           |
| `check`         | `node scripts/check-syntax.mjs && bun run build:check && tsc --noEmit && bun run check:web`                                              |
| `test:web`      | `vitest run test/web --no-file-parallelism`; add `.tsx` to existing Vitest includes, use real browser rather than jsdom for DOM behavior |
| `test:service`  | `vitest run test/service-*.test.ts --no-file-parallelism`                                                                                |
| `test:browser`  | `node test/browser/run.mjs` using playwright-core and explicitly available browser binary                                                |
| `verify`        | `bun run check && bun run lint && bun run check:agents && bun run test && bun run test:browser && bun run pack:check`                    |

- Keep `test`, `test:target`, `pack:check`, distribution target and traceability routes; `test/browser/*.e2e.mjs` avoids accidental double execution by Vitest's `*.test.*` glob. `check-syntax.mjs` must also cover authored timeline MJS and compiled entry; Biome checks authored web TSX/CSS, generated/vendor exclusions are exact and replaced by reproducible-byte/license audits, not blanket source lint waivers.
- `test/service-contract.test.ts`: decoders, identical native/browser projections, unknown actions, stale/duplicate admission and receipts; `test/service-auth.test.ts`: HTTP/WS authorization, cookie/token rotation, CSRF/origin/host, authenticated detail/export and sanitized errors.
- `test/service-owner.test.ts`: actual service lifetime, client detach/reconnect, cancellation/stop/crash/restart/no-resume, two parallel readonly children and serialized checkout writers across tasks; inject failures separately from native closure evidence.
- `test/service-history.test.ts`: durable capture without viewers, full text beyond preview/ring bounds, pagination/search/exact hit/export after restart, orphan tools, corruption/quota/denied content and byte preservation. `test/service-package.test.ts`: compiled extracted CLI/static/worker resolution and explicit management behavior.
- `test/web/*.test.{ts,tsx}` owns pure adapted algorithms/reducers/adapters/SSR render contracts; browser suites own actual DOM geometry, focus/scroll/Markdown/tool/diff/timeline/dialog behavior.
  Port relevant upstream assertions, not auto-SKIP/fixed-port/freePort/ambient-env fixture policies.
- `test/browser/run.mjs` launches **real compiled/extracted service + real SDK workers + loopback fabricated provider + actual checks**, isolated home/agent dir/checkout/private state, ephemeral owned ports, two separate browser contexts.
  Reuse production PTY helper for dual-surface parity; no mock HTTP responses on integrated happy paths.
- Browser cases include browser-only create→plan→Start→child details→check→diff→review; terminal attach sees matching IDs; closing both viewers leaves run alive; duplicate/reordered/lost-final updates converge; Cancel queued/active children; crash/restart history-only reads/search/export; token-link admission and rotation; unauthenticated/cross-origin HTTP/WS refusal; second context and phone-sized controls.
- Require `CADENCE_BROWSER_PATH` or an explicitly documented existing binary discovery, record executable/version.
  Missing browser is **unqualified/nonzero** in required browser gate, not green skip; never download browsers or use dev-browser's authenticated persistent profile.
  CI provisioning is separately explicit.
  Fabricated auth/local provider is not real-provider/OAuth qualification.
- Proposed new browser bounds: 120s per integrated scenario, 15s action/assertion wait, 30s service startup, bounded traces/screenshots under owned fixture; distinguish these from existing PTY90s/interaction15s and SDK20s/child15s budgets.
  Teardown waits original owned processes and reports forced/unknown separately; no `pkill -f` or unrelated-port killing.
- Real remote TLS second-machine and physical phone/keyboard/accessibility review require separate human/physical receipts.
  Automated viewport/headless/loopback evidence remains labeled as such; neither missing paid-provider nor native Windows/macOS/ConPTY evidence can be promoted by browser tests.
  Completion still requires the entire PRD acceptance set and explicit qualification gaps.

## 7. Legacy assertion disposition and maintained documentation

- **Retain unchanged intent:** independent research/commit/install/startup suites; no prompt aliases/model-callable task tools; raw native consent/paste/replay/trust/stale guards; readonly no escalation; real parent checks/freshness/issues review; environment/auth isolation; literal paths; actual exit/close/unknown distinctions; legacy corrupt/absent byte preservation; archive malicious-member/body/pin rejection.
- **Replace with mapped assertions, do not blanket-delete:** `lightweight-shell.test.ts` “waited navigation aborts it” → departure detaches accepted service run plus invalidates pending consent; Escape-before-launch no late spawn remains. `terminal-integration.test.mjs` four source/extracted × regular/fullscreen cases retain real checks/paging/resize/explicit cancel/waited original quit, add service-continuation observations rather than equating quit with cancellation.
- `package-contract.test.mjs` production-dependencies-absent assertion becomes exact `ws` allowlist, with host peers unchanged; 34-member/16-source checks become independently reviewed new manifest closure. `distribution.test.mjs` blanket `scheduler` name ban narrows to exact retired modules/mechanisms: approved finite owner scheduling is now required, certified/compiler/transaction machinery remains forbidden.
- Keep `operator-cli.mjs doctor|runs` readonly and rejecting Start/reset/recover/run; new explicit service CLI owns management separately.
  Preserve old v1 `running`→historical interrupted projection when no live-owner confirmation; new live client must not use readonly operator output to overwrite authoritative status.
- Existing SDK tests that assert no file-backed credentials **inside workers** can remain; replace terminal-as-auth-owner assumptions with service public-SDK auth tests while preserving no late spawn/fallback/secret leakage.
  Rich-capture protocol bounds need reviewed new assertions; do not delete malformed/flood/unknown-closure tests merely because event shapes change.
- Main should add a task-local assertion disposition ledger before implementation: old file/title/contract → retained, adapted replacement test/AC, or superseded reason.
  Preserve original failed/retired evidence and qualification hashes; static maps are not executed results.
- After implementation approval update `AGENTS.md` introduction/index, package description and README: explicit terminal + browser clients, one service owner, independent lifetime, scoped captured history and manual service management; retain no autoactivation/install/Git/publish, no sandbox/certification and old-data preservation. `scripts/check-agents.mjs` retains route/pin guards and learns new existing owner paths, not task-state/timestamp entries.
- Update `.trellis/spec/frontend/{index,directory-structure,component-guidelines,hook-guidelines,state-management,type-safety,quality-guidelines}.md` to own React/native presentation, typed client/action dialogs/history/responsive/test boundaries, replacing “no web UI”, terminal-only Start and departure-cancel absolutes deliberately.
- Update `.trellis/spec/backend/{index,directory-structure,lightweight-workflow-guidelines,database-guidelines,error-handling,logging-guidelines,quality-guidelines,task-distribution-guidelines}.md` for service authority/scheduling/protocol/capture/auth/unknown closure/new builds and exact membership.
  Preserve applicable old guarantees and tombstones, not retired executors.
  No spec change is performed by this research.

## 8. Scoped provenance and notice completion gate

- Add `provenance/webui-reuse.json` with pinned repository/SHA, source group and individual source hashes, destination files, retained behaviors, policy removals/modifications, ported tests, dependency/asset lineage and notice paths.
  Keep existing Agent provenance/pins intact; ship a reviewed concise `docs/reuse-provenance.md` so attribution is available outside the source checkout.
- Expand `THIRD_PARTY_NOTICES.md` beyond its current “no reference code shipped verbatim” claim (scope that sentence to earlier pi-subagents invariants).
  Add full `licenses/pi-web-ui-MIT.txt`; preserve Cadence MIT copyright and existing pi-subagents notice, plus U 2026 xing-shuyin attribution in adapted source headers and distributed notices.
- Add reviewed `licenses/browser-dependencies.txt` containing full required license/copyright/NOTICE texts for the **actual bundled closure**: React/DOM/scheduler, selected icon set, unified/remark/rehype/micromark ecosystem, highlight.js CSS/code, KaTeX CSS/fonts, vis standalone internals and any copied CSS/SVG.
  Manifest/license SPDX alone is insufficient; verify font licenses/attribution separately when package artifacts become available.
- Record vis vendor prebuilt hashes and original header, dependency closure and selected dual-license branch; retain third-party embedded notices even if minifier removes comments.
  No CDN fallback.
  Tooling-only Playwright/Vite licenses belong to dev/source provenance, not falsely claimed shipped JS; ws remains an external runtime dependency with its own package notice and dependency inventory.
- Build audit maps each JS/CSS/font/vendor output to input/pin/license groups, checks mandatory notice bodies/members and all relative asset references, rejects unexpected remote resource-fetch URLs (not inert license links/namespaces) and unavailable vendor files.
  Runtime serves a local Notices link; minified JS/CSS distribution still carries notices in package assets/docs.
- **Current evidence gap:** upstream lock and committed vis header are inspectable, but upstream dependency/license/font bodies are absent locally.
  Final lock/build/full-notice audit and browser/runtime/package qualification are mandatory implementation gates, not completed research evidence or a reason to drop rich rendering/timeline/core scope.
