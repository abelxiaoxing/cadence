# W6 source-port readiness review

## Scope and verdict

**Not ready for build/integrated acceptance. Substantial reuse is real, but concrete source defects and shared integration gates remain.**

`python3 ./.trellis/scripts/task.py current --source` resolved `.trellis/tasks/10-16-cadence-subagent-orchestration` (session source). This audit targets independently started W6 under the explicit delegation; this new report is its sole authored file. The W6 PRD/design/plan, boundary/handoff/provenance, complete parent PRD/design/appendices/plan, current frontend guide, browser source, portable client/HTTP transport/read unions, reference objects and relevant installed public declarations were inspected.

No build, typecheck, lint, test, browser, service, provider, native fixture, install, agent dispatch or Git mutation was run. Readonly source/hash comparisons below are not executed behavioral tests. Existing license/reference/working-tree bytes were not edited. W6's earlier `/var/tmp` formatting roots qualify no native lane; future execution must wait for main's scheduling and use a fresh main-approved **home-disk** root, not those roots.

## Prioritized findings

### P1 — 1. PlanBoard imports a name absent from the public facade

- `web/src/components/plan/PlanBoard.tsx:13–17` imports `dependency` from `src/service-contract.ts` and calls it at `:338–343,375–377`.
- The facade's domain export list (`src/service-contract.ts:75–129`) does **not** export `dependency`. Its existing implementation is re-exported by `src/service/contracts/domain.ts:39` from the maintained worker codec.
- This is a source-proven unresolved named import, expected to block web typechecking/bundling; neither was executed here. The local web tsconfig also excludes `web/vite.config.ts` (`web/tsconfig.json:14`), and root checking does not qualify this browser tree.

**Next:** coordinate the minimal shared-facade exposure with its owner (or another explicitly approved existing public route); do not copy a dependency decoder or cast away the error. Include the build config in a separately appropriate check.

### P1 — 2. Reconnect/task switching reuses a server-revoked attachment

- `web/src/client/use-workspace.ts:93–138` reconnects via `transport.subscribe` after polling, without a new session attachment. Its cleanup closes the old socket on task/refresh/session changes (`:144–151`).
- `src/service-http-client.ts:264–284` keeps and reuses the same attachment in the WS URL; socket closure does not renew it. Session is the existing acquisition route (`:113–124`).
- The actual server closes a viewer **and deletes its attachment**, invalidating grants (`src/service/http.ts:889–902,380–387`); WS upgrade requires an existing attachment (`:243–251`). Thus a dropped connection, or task selection that closes the preceding subscription, cannot simply reopen with this ID. Polling GET snapshots can still work, concealing why live/action access stays unavailable. Unauthorized/revoked failures also enter the unconditional reconnect path instead of explicit re-entry handling.

**Next:** reconcile attachment/scope lifetimes with W1 using the existing session/subscribe/detach contracts. Renew readonly observation attachment when appropriate, invalidate confirmations on departure, stop on revoked access, and never renew/replay preflight or commands as part of reconnect. Qualify task A→B, refresh, dropped socket and rotation against the real owner.

### P1 — 3. Fixed assets/fonts and CSP currently disagree with the real server

- `web/vite.config.ts:19–45` emits a nested `assets/vendor/vis-timeline.bundle.mjs` and `assets/fonts/[name][extname]`. `src/service/http.ts:184–195` only admits `/app` or **flat** `/assets/<name>.(js|css|woff2|svg)`. Supplying the candidate vendor/font closure to this constructor would refuse it, not serve it.
- `StaticAsset.contentType` only includes `font/woff2` (`src/service/http.ts:82–90`). Actual imported `katex/dist/katex.min.css` (`web/src/components/rich/Markdown.tsx:14`) references WOFF2, WOFF and TTF; the readable installed CSS shows all three at `node_modules/katex/dist/katex.css:2–4`. There are 60 installed font files. This is an actual source dependency edge, not a hypothetical browser font requirement.
- The server sends `style-src 'self'` without inline authorization (`src/service/http.ts:126–130`), while the adapted timeline inserts an inline `<style>` (`web/src/timeline/timeline-client.mjs:294–421`) and HTML style attributes (`:1079–1118,1232–1249`). That stylesheet/HTML-style path is incompatible with this policy. React style-property assignment is not automatically the same CSP mechanism; math/vis styling still needs actual browser qualification, not a blanket claim that every inline style is safe or blocked.

**Next:** W6/W1/W7 must agree exact audited paths/MIME types, externalize the timeline stylesheet and reconcile necessary dynamic styles under the existing safe-resource policy. Do not solve this by wildcard filesystem serving, CDN fallback or weakening script policy. The current `cssCodeSplit:false`/single CSS output also does not yet implement the separately reviewed fixed vendor-CSS artifact; resolve its actual emitted closure with W7.

### P2 — 4. Return hides the UI but leaves observation work alive

- `web/src/App.tsx:59–70` installs workspace/observation hooks before the `detached` early return (`:236–245`). Return only clears the modal, requests HTTP detach and sets state (`:268–274`). Neither hook receives a disabled/disposed condition.
- The observation interval and reconnect callback continue until effect cleanup (`web/src/client/use-workspace.ts:125–149`), which Return does not trigger. Pending command callbacks can still call `workspace.refresh()`/`observation.refresh()` (`web/src/App.tsx:201–208`), allowing a hidden session read after detachment.

**Next:** make attachment/view lifetime explicit and dispose timers/subscriptions/pending view work on Return, while retaining known command IDs and leaving accepted service work untouched. Unmount/Return must not become Cancel. There is no automatic mutation replay in this code; the defect is incomplete detachment.

### P2 — 5. Native export uses the framed API instead of the download route

- `web/src/history/download-export.ts:7` calls `wireRequest("export", …)`, then suggests a `.md` filename when Markdown was selected (`:12`).
- Both routes already exist (`src/service-wire.ts:55–56`). The actual server emits readable Markdown/its footer only for **`download`**; `export` emits canonical protocol-frame NDJSON even for a Markdown request (`src/service/http.ts:779–795`). Its response filename is consequently `.ndjson` as well.

**Next:** use the existing named `download` route for native attachments, without a new endpoint or giant Blob. Retain the honest “requested — completion unverified” wording (`web/src/components/history/ExportDialog.tsx:40–55`); neither click nor response headers prove original EOF/trailer/count/digest completion.

### P2 — 6. Confirmation does not display the complete proposed action

- `web/src/components/actions/ConfirmAction.tsx:94–108` displays only `preview.readablePlan`/`preview.graph`. There is no create-goal/task-kind or save-plan-payload branch; the remaining branches only cover check/review/generate (`:109–129`). Review also omits the selected run/check/change identities from its visible summary.
- Current W4 source explicitly returns the **previous saved** plan and `graph:null` for Save (`src/service/task-actions.ts:261–272`). The real action contains the proposed `plan` and `graph` (`src/worker-public.d.mts:309–320`); admission validates that action graph (`src/service/admission.ts:251–264`). Thus wiring the missing metadata port as-is would show old text/no proposed assignments at final Save confirmation.

**Next:** render exact action-specific create/save/review targets from the decoded shared preview, and reconcile W4's preview semantics before opening production actions. Do not infer a graph/ref/model or accept metadata merely to make the buttons usable. Existing check command/cwd/timeout/environment-generation presentation should be retained.

### P2 — 7. Some late async callbacks can overwrite newer observation/confirmation state

- `ReceiptPanel` starts a lookup, then merges it with the **captured old** `value` (`web/src/components/actions/ReceiptPanel.tsx:41–45`); App replaces the whole command observation (`web/src/App.tsx:118–124`). A user can dismiss an in-flight confirmation, observe its pending receipt, receive the final command reply, then have the older lookup replace that newer receipt with the old pending value. The panel also prioritizes `lookup.receipt` unconditionally (`ReceiptPanel.tsx:14–15`).
- App installs a preflight reply without a view-generation/departure guard (`web/src/App.tsx:132–154`), and `InspectorPanel`'s awaited `saveAction` invokes `onAction` without one (`web/src/components/workspace/InspectorPanel.tsx:123–128`). Context comparison/server admission still prevent silently confirming changed context, but these callbacks do not satisfy the handoff's blanket stale-callback disposal claim.

**Next:** correlate late responses by view generation and exact command identity; merge receipt observations without discarding newer committed facts. Preserve uncertain command IDs and allow observation, never resend the mutation. Ordinary read hooks already have useful generation/disposal guards; apply the same discipline to these remaining callbacks.

### P2 — 8. Oversized search input leaves a rejected promise and pending UI

- `GlobalSearchModal` awaits `client.search` without catch/finally (`web/src/components/history/GlobalSearchModal.tsx:33–43`) and its query input has no UTF-8-byte validation (`:94–98`).
- `ServiceClient.search` validates **before** its catch (`src/service-client.ts:418–420`); the shared cursor decoder enforces `LIMITS.queryBytes = 1024` (`src/worker-public.mjs:74,1018–1021`). Pasting a larger query rejects rather than returning an error Reply, so the modal leaves `pending` true and the timer-launched promise unhandled.

**Next:** use the shared byte limit/decoder and handle rejected reads with stale-safe error/finally logic; test multi-byte boundaries. Do not truncate the query or raise the limit silently.

## Backend-owned integration seams — not permission for UI protocols

These are still missing/unqualified, including those already disclosed by the W6 handoff:

1. **Real planning/current-role/saved graph metadata.** `web/src/client/plan-metadata.ts:20–32` has no production implementation; `web/src/main.tsx:32–35` mounts `<App />` without it. Current roles must come from the owner, not shipped-name guesses or made-up hashes. `src/service/contracts/history.ts:714–791` exposes session/workspace/model/context, not this metadata. Current W4 `savedGraph()` validates publication and returns a descriptor (`src/service/task-actions.ts:119–141`), but that is not yet a portable browser reader.
2. **Accepted-plan/ref allocation and readonly proposal acceptance.** The current public Save still requires `plan:string` plus a full Graph/ContentRef (`src/worker-public.d.mts:315–320`); do not manufacture these refs in `saveAction`. Align with W4's selected shared draft/allocation seam. Generate's recorded proposal needs a typed route to an explicitly accepted local draft; never automatically Save/Start it. The current `task-actions.ts:175–178` only admits create/save/start observation and is not proof of a finished Generate/check/review owner.
3. **Saved-but-never-started graph and current change body.** `RunBrowser.tsx:43–61` only reads graphs obtained from run admission. This cannot substitute for the current saved graph before first Start. `ObservationPanel.tsx:23–38` correctly identifies captured change/check/review facts; add actual current change-body metadata through its owner, not by relabeling these historical bytes.
4. **Read cancellation.** `src/service-client.ts:65–88` ordinary reads take no AbortSignal and `src/service-http-client.ts:90–105` starts fetch without one. `readFullText` cancels between original reads (`web/src/history/readers.ts:64–76`), not the already-started request. Assign this shared seam to W1; UI generation guards cannot claim network cancellation.
5. **Build identity and production admission.** Session decoding checks protocol, but has no browser/service build identity (`src/service/contracts/history.ts:714–754`). The current host still exposes actions false/unavailable context and admission null (`src/service/host.ts:170–198`), appropriately. Do not open it until real W4 composition and checks are complete. Browser build/protocol mismatch must become a shared explicit refusal/reload state, not a guessed constant or accepting default.

## Reuse, safety and history observations

These are source findings, not runtime/security/performance/accessibility acceptance.

- **Substantial direct reuse exists.** Pinned layout/sash/swipe, tree/PlanBoard, lazy transcript/collapsible/tool, rich Markdown/stream/code/math/copy, preview/ToC/diff, search/range-scroll and reconciliation families are present, not merely CSS inspiration. The whole `plugins/run-trace/client/entry.mjs` is directly adapted into the 1779-line `web/src/timeline/timeline-client.mjs`: list/lanes/four detail tabs/filter/zoom/follow/replay/resize/dispose remain. Its finite bridge is in `timeline-adapter.ts`, not an upstream plugin dispatcher. For example, retained `planWindow`/`pickAlways`/`applyPlan`, swipe-axis/pull helpers and search range/scroller bodies can be compared to the pinned objects. Source identity is not proof that their adapted tests ran.
- **No accepting metadata fallback/fake outcomes found in the inspected composition.** Missing roles disable Add/Save (`PlanBoard.tsx:76–80,98–105,422–424`; `InspectorPanel.tsx:118–120`). Model selection comes from ContextVersion. `RunSummary.tsx:19–38`, `ToolCallBlock.tsx:19–26,46–48` and `CheckPanel.tsx:50–78` retain native/SDK/check/coverage distinctions; human Done is not assigned to those fields.
- **Progress/snapshot are not treated as empty data.** All nine named list methods are selected by `history/readers.ts:11–34`; `PageControls.tsx:12–38` distinguishes data/progress/initial snapshot and follows the actual `next`. `use-page.ts:6–14,31–49` freezes established read identity rather than rebasing on live watermarks. Detail/entity/graph similarly narrow their read unions. Search is its own `SearchPage` shape (not a `kind` union); `GlobalSearchModal.tsx:153–172` correctly continues zero-hit windows with `next`.
- **Retained access is independent of DOM/ring.** Messages/tools/context/events/runs/checks/changes/reviews have actual paged entry points. Long tool fields and orphan/omitted associations remain reachable via `ContentExplorer`. Exact hits retain owner/entity/version/field/UTF-8 range; `DetailPane.tsx:79–101` highlights byte ranges, and `history-url.ts:9–30` strips only navigation proof rather than inventing timestamps. `message-delta.ts:14–26` checks immutable ref/hash/bytes/contiguity for full-field copy. This materializes one field, not an archive. No partial canonical-JSON tool page is parsed as a complete object.
- **Rich safety boundaries are materially adapted.** `Markdown.tsx:26–87,104–117` keeps raw HTML off by default, sanitizes the optional raw path before math/highlight, uses KaTeX `trust:false`, excludes executable/media/form elements, replaces images with omission text and filters links to credential-free HTTP(S)/fragments with no referrer. Generic fences/plugins/file previews were removed. Timeline untrusted detail/title/metadata enters HTML through `esc` (`timeline-client.mjs:136–144,1259–1284`), not raw tool HTML. Browser XSS/CSP/URL/math fixtures are still required.
- **Cookie/CSRF and no replay are preserved at the intended API boundary.** `browser.ts:1–9` uses the portable client and same-origin transport, not browser SDK/session runtime. Transport uses same-origin cookies and RAM CSRF/attachment state (`service-http-client.ts:54–85,99–124`); no browser token persistence/provider credential UI was found. `actions.ts:33–59` consumes the local submit guard before await and calls finite named methods; receipt observation is not a second command. The attachment URL parameter is not the owner token. Findings 2/4/7 still need lifecycle fixes.
- **Timeline is ordinal, not measured.** `timeline-adapter.ts:23–42,75–81` maps page ordinals to synthetic display coordinates and labels them, leaving raw stored clock facts intact. `fmtClock` and the vis axis say page event/ordinal; `flowLive()` returns false (`timeline-client.mjs:815–817`); replay uses explicit visualization steps (`:1378–1385`). Dormant upstream `activeWindow`/wall-clock-flow/analysis code and comments remain (`:792–797,917–1047,1216–1249`); remove/narrow them in the cleanup rather than later reconnecting inferred work/idle metrics. `ensureVis():260–274` also silently returns null on local-vendor load failure and uses the hand-drawn fallback (`:1085ff`): report degraded/missing vendor explicitly rather than implying the complete zoom/follow library loaded. No CDN import or clear-history/control sender remains in this adapted client.

## Dependency/build/license inspection

- Installed Vite is **8.3.0** and plugin-react **6.1.1**. `defineConfig`/default plugin imports use declared public exports. Vite's declaration explicitly accepts deprecated `build.rollupOptions` as a `rolldownOptions` alias (`node_modules/vite/dist/node/index.d.ts:2899–2908`); installed Rolldown declares `advancedChunks` and `asset.names` (`node_modules/rolldown/dist/shared/define-config-BLptERXo.d.mts:137–143,888–891`). **Do not misdiagnose this as a Vite-8 Rollup-options incompatibility.** It is not a successful build either.
- Installed `vis-timeline@8.5.4` explicitly exports `./standalone` and `./styles/*`; its standalone ESM includes Timeline/DataSet and embedded code. The source imports those public edges, not incidental vis-data/vis-util packages. The complete dependency inventory in `provenance/webui-reuse.json` matches installed package versions for the inspected direct source/type imports (React/DOM19.3.0, Feather via react-icons5.7.0, declared rich/type families, vis/Vite). No missing direct package edge was found; finding 1 is an internal export defect.
- `package.json` has no web build/check/test/browser scripts or `web` package member yet; `web/dist` is absent. `web/vite.config.ts` is a candidate, not a deterministic builder: exact collision refusal, fixed closure, source build identity, private-temp byte comparison and no-source-fallback packaging remain W7 gates. This source audit ran none of them.
- Existing full pi-web-ui MIT bytes match the pin and were preserved. `licenses/pi-web-ui-reuse.md` truthfully does not license the emitted dependency closure. Actual imports require React/DOM/scheduler, selected Feather MIT, unified ecosystem, highlight.js BSD-3-Clause CSS/code, KaTeX MIT plus font-specific obligations, and vis standalone embedded notices. The installed standalone includes core-js and Hammer license markers (`node_modules/vis-timeline/standalone/esm/vis-timeline-graph2d.mjs:8045,17751–17752`), so auditing just vis's top-level MIT notice is insufficient. The installed KaTeX top-level `LICENSE` is MIT code text, not a supplied full font-OFL notice. Full font/embedded notice sourcing remains a distribution blocker to resolve from approved available artifacts, not permission to download/add dependencies.

## Source identities only

Readonly Git inspection found the reference clean at `e8bab487af208bc9a1ab60a821652323f598127f`. Recomputed SHA-256 values matched all **35 upstream source/license**, **65 destination**, and **12 proposed test-lineage** entries in `provenance/webui-reuse.json`; the latter are reference test bodies, not executed tests. Existing MIT SHA-256: `a8068b68c721f3c80c9e17ecf31b325e12e85cb4da9be5b48bd60f36b1ff039c`.

Shared source at inspection (backend work can subsequently change these):

| Path | SHA-256 |
| --- | --- |
| `src/service-contract.ts` | `a0a71d9571f230ac28566a06582f0b22d5aa23aea377ea55aa889cccb3590687` |
| `src/service-http-client.ts` | `ae786a924510ca19cd3c52c1597bc3d2a7d1a6c747454662180ed4552a174584` |
| `src/service/http.ts` | `38a212511f15b71f19f1c5b1984dd46faead18754c475d52787dd6700313d948` |
| `src/service/task-actions.ts` | `99f8b02abc7e80350f59a56d932ef4a158e5e13c26cb7b5581727bb91d42c4af` |
| `src/service/host.ts` | `2e63538b2f02cc732a46c6591ff94e7990add0570e4bb97b0444a167bdbd7a9f` |

## Minimal next W6 pass

1. **Main assigns shared corrections; W6 fixes owned source.** Fix findings 1–8, use the existing download route, and agree attachment lifetime/static CSP+asset closure. Keep production actions closed and metadata unavailable until the actual backend seams land. Preserve provenance/license/working-tree inputs and refresh only W6-owned hashes after authorized edits.
2. **After concurrent backend qualification finishes, freeze inputs and isolate on main-approved home disk.** Run installed web TypeScript checking (including a suitable config check) and scoped source lint; first failure is not permission to raise budgets/add deps. Author/run adapted pure/component tests for progress/snapshot/zero-hit, byte anchors/copy, search oversize, receipt ordering, stale dismissal/detach, safe rich text, lazy windows/drawers and timeline ordinal/disposal behavior. These qualify adapters/components only.
3. **Build through the W7-owned deterministic route into fresh private output.** Audit fixed JS/CSS/vendor/font names and MIME/CSP, collisions/reference closure, build identity, exact license bodies and reproducible bytes. Do not let an ad hoc Vite build overwrite existing generated assets or count source hashes as build evidence.
4. **Then actual owner/browser qualification.** Exercise built assets with the available isolated browser and real W4 owner: full browser-only plan/Start/check/review, two clients, task switching/reconnect/rotation/no replay, Return vs Cancel, history beyond DOM/ring, exact search hits, original export EOF/trailer and revoked/truncated downloads. Include 1440×900/768×1024/390×844/320×568, keyboard/focus/visible Cancel and hostile text/CSP. Required native/backend/HTTPS/extracted-package lanes remain their owners' work; no source-only performance, accessibility, physical-device or runtime acceptance claim follows from this report.
