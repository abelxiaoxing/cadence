# W6 source-port handoff — unqualified integration source

## Authority and scope

Main routing remains `.trellis/tasks/10-16-cadence-subagent-orchestration`.
This is the independently started W6 source-only pass assigned by the parent `research/nonoverlap-ui-port-handoff.md`.
No child or parent completion/acceptance is claimed.
No nested agent, commit, push, merge, installation, download, service/provider/browser/native fixture, test, typecheck, lint or build was run.
No root package/lock/scripts/TypeScript/Vitest/Biome/notices/shared DTO/client/backend/native-shell/task metadata was edited.
`licenses/pi-web-ui-MIT.txt` and `provenance/auth-reuse.json` pre-existed this pass and were preserved.

## Implemented source boundaries

- `web/src/App.tsx` composes actual same-origin `HttpServiceTransport` / `ServiceClient`, one shared `ProjectionTracker`, task navigation, three panes and responsive drawers.
  `main.tsx` is a source entry, not generated/shipped assets.
  No SDK, session server, plugin host or executor exists in the browser.
- Create/Generate/Start/configured Check/Review buttons invoke the finite preflight flow and display the exact returned preview before one-use confirmation.
  Save routes through the explicit metadata adapter below rather than inventing a plan reference.
  All in-session command IDs/receipts are retained independently, including pending/uncertain replies; receipt observation never resends a command.
  Explicit Cancel uses run/epoch/command identity; Return/unmount detaches without Cancel.
- Execution/native settlement, recording, publication, connection freshness, configured check obligations and human review remain independent shared fields.
  Failed/native/non-passed facts are not overwritten by Done or by lack of streaming.
- All nine list readers use their named existing methods and explicitly handle data/progress/snapshot.
  Each UI continuation is bounded and user-resumable; live watermarks do not rebase an established read.
  Detail/entity/graph progress is distinct from data; exact hit owner/version/field/UTF-8 range is preserved.
  Zero-hit + next does not mean finished.
  Content inventories retain context, partial/final argument/result fields, omissions and orphan associations beyond the loaded transcript/DOM window.
- Detail paging supports full retained-field clipboard collection with cancellation between original reads, exact immutable-field/contiguity checks and explicit incomplete-recording labeling.
  This materializes one allowed field for clipboard, not an archive.
  Partial canonical-JSON fields are never parsed as complete objects.
- Export requests the actual selected-scope named attachment route through `wireRequest`, using cookie navigation, without a giant Blob or service worker.
  Status is **download requested / completion unverified**, not success inferred from headers/click.
  Trailer/EOF/count/digest behavior and actual browser attachment qualification are still required below.
- The whole standalone run-trace client was adapted (not replaced with a new chart), retaining list/lanes/detail tabs, filtering, zoom, follow, replay and resize/disposal structure.
  Its thin read bridge consumes decoded committed facts only.
  The displayed axis is **page ordinal/committed order**, not wall time or native duration; raw facts retain recorded scalar/clock provenance.
  Replay uses explicit visualization steps and cannot execute anything.
  The full archive remains reachable through event pages and durable search, independent of this loaded page.
- Rich Markdown/math/code, readonly preview/ToC/line selection/diff, search/dialogs and lazy-height transcript helpers are directly adapted source families.
  External images/media/file paths/dynamic fences are removed; raw HTML is off by default and sanitized if explicitly selected.
  Desktop panes, phone drawers/inert background, focus/Escape return, keyboard resize, safe-area handling and44px primary targets are source implementations, **not browser accessibility qualification**.

## Explicit integration seams / remaining gates

1. **Owner metadata / Save:** `web/src/client/plan-metadata.ts#PlanMetadataPort` has no default production implementation.
   It needs actual current pinned role hashes, readable saved plan and saved-but-never-started graph, and the accepted-plan allocation seam now being implemented by W4.
   `read(context)` must return the exact current context/roles/saved data; `saveAction(context,draft)` must construct the actual shared save-plan action without preflight writes or fabricated ContentRefs.
   Align this port with W4's final shared draft DTO rather than creating another endpoint/schema.
   Save/add-default-assignment controls remain explicitly unavailable without those facts; an existing saved graph can still be previewed through the actual Start method.
2. **Generated proposal:** Generate is a separately confirmed readonly episode; its recorded result is inspectable through the actual run/content readers.
   Proposal text can be copied into the local readable plan; there is no automatic acceptance, graph synthesis, Save or Start.
   A convenient typed whole-proposal-to-local-draft acceptance adapter still needs W4's actual proposal metadata.
3. **Current change body:** the existing Changes reader supplies captured committed observations, and the UI labels them as captured, including stage/fingerprint/generation/coverage.
   It does not relabel a historical diff as a fresh current-file view.
   Wire any W4-owned current change-body/read-preview metadata explicitly; the current control observation alone is not a diff body.
4. **Abortable reads:** stale view callbacks are generation-guarded/discarded, subscriptions/timers are disposed, and full-field copy stops subsequent reads on cancellation.
   Current `ServiceClient`/`HttpServiceTransport` ordinary read methods have no per-read AbortSignal; this UI cannot cancel their already-started fetch through the existing API.
   Main should assign that shared transport seam if full in-flight cancellation is required; no private transport monkeypatch was added here.
5. **Build/protocol identity:** existing shared protocol decoding refuses incompatible protocol data, but no actual service/browser build-identity handshake exists in this source port.
   Add it through the real shared owner rather than a guessed version, token or accepting browser default.
6. **Build/distribution:** `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html` are source-only candidates.
   Root scripts/configs/package members were deliberately not touched.
   Fixed entry/chunk/font names and a local vis standalone chunk are configured, but exact emitted closure, collision refusal, separate vendor CSS policy, deterministic source build identity/temp output and no source fallback must be reconciled with W7's actual builder before any distribution claim.
   No `web/dist` files were generated.
7. **Live text / renderer:** the complete StreamMarkdown family is ported, but current shared live snapshots publish run projections, not an arbitrary provider delta feed.
   Stored text renders through actual detail pages.
   Do not wire upstream generic deltas or pretend a stored partial text page is current live inference.
8. **Required qualification:** frozen-input web typecheck + scoped lint (including adapted upstream JS/CSS cleanup), adapted pure/component tests, actual compiled browser flows, real W4 integration, auth/revocation/HTTPWS/downloads, keyboard/focus/phone geometry, and exact package/license/build audits remain unexecuted.
   In particular, real320×568/390×844/768×1024/1440×900 behavior, CSP under bundled style/math/timeline code, native browser downloads and original complete footer semantics need actual tests.
   No skipped or source-only gate is promoted to PASS.

## Pinned reuse and hashes

Reference checkout: `/home/mirako/abel/pi-web-ui`.
Read-only HEAD/status inspection found revision `e8bab487af208bc9a1ab60a821652323f598127f` with empty porcelain status.
Copied/adapted bodies are pinned to that immutable Git object, not unreviewed working-tree modifications.
`provenance/webui-reuse.json` records SHA-256 for35 upstream source/license files,65 destination source/config/license-note files and12 proposed upstream test-lineage files.
Hashes identify source bodies, **not executed behavior**.
The existing full MIT license remains byte-identical to the pinned upstream license (copyright2026 xing-shuyin).
New `licenses/pi-web-ui-reuse.md` is a concise reuse note; final root notices and emitted dependency/font/vendor notices remain W7-owned.

| Family | Pinned source files | Actual adaptation/removals |
| --- | --- | --- |
| workspace | `web/src/App.tsx`, `web/src/components/LeftPanel.tsx`, `web/src/components/RightPanel.tsx`, `web/src/styles.css`, `web/src/panel-sash.ts`, `web/src/swipe-drawer.ts`, `web/src/use-swipe-drawer.ts` | Three-pane composition and selected coherent CSS rule families; direct sash/swipe algorithms; props narrowed to task/run data. Add keyboard focus/inert drawers/44px controls. Delete composer, PTY, plugin slots, filesystem tree and model/provider administration. Correct open-drawer drag offset. |
| plan-navigation | `web/src/conv-groups.ts`, `web/src/components/PlanBoard.tsx` | Direct tree/collapse/orphan traversal; board expand/edit/add/delete/copy composition. Replace checkbox outcomes and prompt/clean-handoff dispatch with local Assignment drafts, explicit dependency selection and preflight actions. Real role/plan identity allocation stays an unavailable typed adapter seam, never fabricated hashes or ContentRefs. |
| transcript | `web/src/components/MessageList.tsx`, `web/src/components/Message.tsx`, `web/src/components/ToolCallBlock.tsx`, `web/src/components/LazyMount.tsx`, `web/src/components/CollapsibleHead.tsx`, `web/src/lazy-window.ts` | Direct lazy-window/height-hysteresis and collapsible card families; readonly Message/Tool composition narrowed to actual HistoryRecord owners/versions/associations. Independent server paging replaces full-array assumptions. No orphan suppression, inline-marker stripping, fork/reask/steer/retry, tool-kill, image/file preview bridge or prose-derived native status. |
| rich | `web/src/components/Markdown.tsx`, `web/src/components/StreamMarkdown.tsx`, `web/src/stream-markdown.ts`, `web/src/code-lines.ts`, `web/src/remark-backslash-math.ts`, `web/src/components/copy-button.tsx`, `web/src/use-copy-feedback.ts` | Direct Markdown/math/highlight/code-lines and streaming segmentation/smoothing modules. Remove executable fence/widget registration and pi-file paths. Safe link policy; omit images/media; optional raw HTML sanitized before nontrusted KaTeX/highlighting. Copy fallback restores focus and removes temporary DOM in finally. Streaming renderer is ported, not a claim of a live-text channel absent from current service projections. |
| review | `web/src/components/FilePreview.tsx`, `web/src/preview-toc.ts`, `web/src/components/SCMPanel.tsx` | Direct ToC/slug and SCM renderDiff, preview raw/Markdown/line-range/zoom composition. Bind only to retained content; page-local line numbers and captured-versus-current coverage explicit. No file editor, arbitrary host paths, HTML iframe/script enablement, attachments, Git stage/reset/commit or shell. Native checks/human review come from shared facts. |
| history-search-export | `web/src/components/GlobalSearchModal.tsx`, `web/src/components/SearchBar.tsx`, `web/src/session-url.ts`, `web/src/download.ts` | Reuse debounced request correlation, keyboard/result sections, exact DOM-range scroll/highlight helpers, fragment links and anchor download interaction. Replace ambient files/projects/plugins/session restoration with immutable scoped hits. Data/progress/snapshot handled in new reader adapters. No token storage/URL replay, timestamp guesses or giant Blob export. Native download explicitly requested/unverified; local page highlighting capped and labeled separately from complete durable search. |
| timeline | `plugins/run-trace/client/entry.mjs` | Direct whole standalone DOM client, not a replacement chart: lanes/list/four detail tabs/filter/zoom/follow/replay/resize/dispose retained. Finite typed read bridge instead of plugin send. Only pinned local vis import/CSS. Remove clear-history, CDN fallback, private redraw, external plugin update messages and active-window inference. Page ordinal/committed sequence visual axis; no browser clock extension of native spans, model-text timing, inferred file-change analysis or execution replay. |
| reconciliation-actions | `web/src/use-chat.ts`, `web/src/message-delta.ts`, `web/src/components/Dialog.tsx` | Adapt stale-socket generation/bounded reconnect and immutable same-entity append algorithm. Shared ProjectionTracker alone reduces execution projections; no copied upstream UiState/schema. Native dialog/focus replaces extension response sender. Finite preflight/named command/cancel/exact receipt; no automatic action retry or confirmation renewal. Disconnect/Return detaches, not Cancel. |
| build | `web/vite.config.ts` | Adapt React/Vite ES2022 advancedChunks groups and fixed output names. Remove time-derived build ID/service worker/public wildcard/proxies/xterm. No build executed. Final fixed member/font/vendor CSS separation, deterministic build identity/handshake and exact generated closure remain W7 integration gates. |

## Dependency edges

All directly imported external package/type edges already exist in the reviewed root manifest; no new dependency or transitive-only import was added.
Exact source-use inventory:

- React/DOM19.3.0 and their declared types; react-icons5.7.0, Feather (`fi`) only.
- react-markdown10.1.0; remark-gfm4.0.1, breaks4.0.0, math6.0.0; rehype-highlight7.0.2, katex7.0.1, raw7.0.0, sanitize6.0.0; highlight.js11.12.0; katex0.18.7.
- Direct type edges unified11.0.5, remark-parse11.0.0, micromark-util-types2.0.2, mdast-util-from-markdown2.0.3 and mdast-util-math3.0.0.
- vis-timeline8.5.4 public `standalone` export and declared styles, not incidental vis-data/vis-util imports or a CDN.
- Vite8.3.0/plugin-react6.1.1 for the unbuilt candidate config.

The actual emitted closure still requires full React/Feather/unified ecosystem/highlight BSD/KaTeX MIT+font OFL/vis standalone embedded-dependency notice auditing.
Installed-artifact availability and imports are not license/distribution/runtime acceptance.

## Source review / formatting evidence only

Readonly inspection covered the actual shared declarations/client/wire methods and selected pinned upstream families.
A source import inventory found only the declared external packages above, shared portable service client/contract/wire imports and local presentation modules.
No direct browser `fetch`, `appSend`, token localStorage, service worker, CDN fallback, SDK/private model import or private vis redraw call was introduced.
The `switch_session` string survives only in an explanatory removal comment.

Scoped formatter commands used fresh0700 disk directories under `/var/tmp/cadence-w6-source.*` with `TMPDIR`, `TEMP`, `TMP` all pointing to that command's new directory; no previous temporary directory was removed.
Commands were only `node_modules/.bin/biome format --write web/src` and later the same plus `web/tsconfig.json web/vite.config.ts` (and separately the provenance JSON).
The first source-format pass exited1 on a missing JSX expression brace in `ObservationPanel.tsx`; that source parser error was corrected.
Subsequent passes exited0; the latest source/config pass formatted63 files and fixed3.
This is source formatting/parser evidence, not lint, TypeScript, tests, browser execution, SDK/native qualification or a package build.
No suppression, formatter-with-errors, root override or test-budget change was added.

## Proposed adapted tests — not authored/run in this pass

`provenance/webui-reuse.json#proposedTestLineage` binds actual pinned bodies, rather than treating reference-valid paths as tests executed here.

- `tests/unit/conv-groups.test.ts` → task/run/assignment tree, collapse aggregates, orphan/cycle protection and settled/failed/unknown labels; no dispatch from navigation.
- `tests/unit/lazy-window.test.ts`, `tests/lazy-window-test.mjs` → direct height-hysteresis helpers and actual DOM scroll stability with immutable version changes, expanded long fields and explicit next-page access.
- `tests/unit/stream-markdown.test.ts` → frozen fence/list segmentation, final/static equivalence, Unicode smoothing and no semantic outcome from finishing animation.
- `tests/unit/message-delta.test.ts`, `tests/snapshot-delta-test.mjs` → immutable same-field append, exact owner/version/range, shared tracker stale sockets/gaps/restart/lost-final polling; zero mutation replay.
- `tests/unit/swipe-drawer.test.ts`, `tests/swipe-drawer-ui-test.mjs`, `tests/panel-layout-test.mjs` → open/closed gesture offsets, horizontal-scroll priority, keyboard resize, focus/Escape restoration, persistent Cancel and phone geometry.
- `tests/global-search-ui-test.mjs`, `tests/unit/search-folded.test.ts` → adapted keyboard/debounce/range-scroll behavior with actual durable literal search; zero hits with next, progress/snapshot, exact UTF-8 anchors beyond loaded DOM/ring, owner/version-specific highlights and no timestamp fallback.
- `tests/unit/copy-text.test.ts` → full allowed field paging/clipboard, redaction/source-limit/incomplete labels, cancellation and no partial-JSON parse.
- New reader/action integration controls must cover every data/progress/snapshot variant, no rebase on live update, stale view callback disposal, receipt uncertainty, exact check cwd/command/timeout/env, configured not-run and human review not rewriting failures.
- New timeline/browser controls must mount/unmount the adapted whole client, exercise lanes/filter/zoom/follow/replay/page/search/detail navigation, prove local-only assets, and assert no wall/native timing inferred from ordinal coordinates.
- New browser export controls must observe real server streaming attachments, revoked/truncated/missing-trailer cases, original EOF/completion digests and request-only UI labeling without giant buffering.
- Required source/extracted browser-only flow needs the actual W4 owner and fabricated isolated provider/check fixtures after backend work stabilizes; no mocked endpoint can close W6 acceptance.

## Exact source/config/license paths written

- `licenses/pi-web-ui-reuse.md`
- `web/index.html`
- `web/src/App.tsx`
- `web/src/client/actions.ts`
- `web/src/client/browser.ts`
- `web/src/client/message-delta.ts`
- `web/src/client/plan-metadata.ts`
- `web/src/client/use-workspace.ts`
- `web/src/components/actions/ActionDialog.tsx`
- `web/src/components/actions/ConfirmAction.tsx`
- `web/src/components/actions/ReceiptPanel.tsx`
- `web/src/components/history/ContentExplorer.tsx`
- `web/src/components/history/Coverage.tsx`
- `web/src/components/history/DetailPane.tsx`
- `web/src/components/history/EntityPane.tsx`
- `web/src/components/history/ExportDialog.tsx`
- `web/src/components/history/GlobalSearchModal.tsx`
- `web/src/components/history/GraphPane.tsx`
- `web/src/components/history/LocalSearchBar.tsx`
- `web/src/components/history/PageControls.tsx`
- `web/src/components/history/RunBrowser.tsx`
- `web/src/components/history/SearchBar.tsx`
- `web/src/components/plan/PlanBoard.tsx`
- `web/src/components/review/ArtifactPreview.tsx`
- `web/src/components/review/CheckPanel.tsx`
- `web/src/components/review/DiffView.tsx`
- `web/src/components/review/ObservationPanel.tsx`
- `web/src/components/rich/CopyButton.tsx`
- `web/src/components/rich/Markdown.tsx`
- `web/src/components/rich/StreamMarkdown.tsx`
- `web/src/components/transcript/CollapsibleHead.tsx`
- `web/src/components/transcript/LazyMount.tsx`
- `web/src/components/transcript/Message.tsx`
- `web/src/components/transcript/MessageList.tsx`
- `web/src/components/transcript/ToolCallBlock.tsx`
- `web/src/components/workspace/InspectorPanel.tsx`
- `web/src/components/workspace/RunSummary.tsx`
- `web/src/components/workspace/TaskSidebar.tsx`
- `web/src/history/download-export.ts`
- `web/src/history/history-url.ts`
- `web/src/history/readers.ts`
- `web/src/history/search-page.ts`
- `web/src/history/use-page.ts`
- `web/src/layout/ResizeHandle.tsx`
- `web/src/layout/panel-sash.ts`
- `web/src/layout/swipe-drawer.ts`
- `web/src/layout/use-drawer-focus.ts`
- `web/src/layout/use-swipe-drawer.ts`
- `web/src/main.tsx`
- `web/src/navigation/assignment-rows.ts`
- `web/src/reference.css`
- `web/src/review/preview-toc.ts`
- `web/src/rich/code-lines.ts`
- `web/src/rich/remark-backslash-math.ts`
- `web/src/rich/stream-markdown.ts`
- `web/src/rich/use-copy-feedback.ts`
- `web/src/styles.css`
- `web/src/timeline/TimelineView.tsx`
- `web/src/timeline/timeline-adapter.ts`
- `web/src/timeline/timeline-client.d.mts`
- `web/src/timeline/timeline-client.mjs`
- `web/src/transcript/lazy-window.ts`
- `web/src/types.ts`
- `web/tsconfig.json`
- `web/vite.config.ts`

Additional owned records: `provenance/webui-reuse.json`, `research/w6-source-port-boundary.md`, and this handoff.
Destination body hashes are in the provenance inventory; research artifacts are not product acceptance receipts.
Main should qualify and review the frozen combined inputs, not run a whole-tree gate against concurrently changing backend/UI source.
