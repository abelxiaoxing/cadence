# Independent W6 Source and Build Review

## Verdict and Boundary

The reviewed serial W6 slice has concrete fixes and fresh passing scoped checks.
**No known in-scope blocker remains after the checks below; W6 and the integrated product are not complete.**
Production `src/service/host.ts` still installs `admission: null` and does not compose the asset loader or final browser/service build handshake.
Current planning/role/saved-graph/current-change metadata and accepting-host composition remain required main-session gates.
No successful owner action, native terminal cutover, whole `verify`, package extraction or final notice closure is inferred.

The review loaded the active child artifacts, current check context, complete parent PRD/design/mandatory appendices/plan, serial boundary, original source audit and prior handoff/evidence.
The previous eight-defect audit and prior80-web/354-regression/one-empty-browser receipts remain historical and unchanged.
The new [evidence JSON](w6-build-qualification-review-evidence.json) binds **284 source/dependency inputs**, exact output hashes, commands/environments/exits, test JSON, browser receipts and preserved diagnostic logs.
Those inputs were unchanged across the final run and rechecked afterward.

All commands used explicit `TMPDIR`, `TEMP` and `TMP` beneath fresh0700 home-disk roots.
Main review root: `/home/mirako/abel/cadence-w6-review-FGUigfkq`.
The browser used the separately allocated short root `/home/mirako/abel/w6b-FXGCJV`, isolated launch homes and new contexts, never personal profiles or downloads.
Observed identities: Linux x86_64, Node26.7.0, Bun `--version`1.3.14, Pi0.84.3, Vite8.3.0, React19.3.0, vis8.5.4, Playwright1.63.0 and Chromium151.0.7922.34.
These are executed identities, not new eligibility predicates.

## Findings Fixed

| Finding                                                                       | Correction and counterexample evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native browser fetch failed before HTTP                                       | `HttpServiceTransport` stored native fetch and called it with the transport as receiver. Node/arrow-fetch fixtures tolerated this; the populated browser showed no session request. Bind the default to `globalThis`. Both browser scenarios now require actual session access; a separate receiver mock preserves the counterexample. An initial heading alone was never a valid successful-session assertion.                                                                                                                                         |
| Revocation without a selected socket did not stop observation                 | The observer tested nonexistent `unauthorized` instead of the actual `unauthenticated` DTO code. Handle the real code, clear private projections and stop polling even with null scope/no WebSocket. Actual cookie rotation exercises this path.                                                                                                                                                                                                                                                                                                        |
| Uncertain detach forgot the attachment before reacquisition                   | The transport unconditionally cleared attachment state on failure and the observer swallowed detach errors. Retain the exact ID on uncertain release and block automatic replacement acquisition. Successful release, authoritative stale and rotated access remain distinct from network uncertainty. Tests cover actual HTTP attachment reuse plus explicitly injected lost detach delivery.                                                                                                                                                          |
| Malformed session response could lose a known allocated slot                  | Retain a valid successful session response header while draining/decoding its original body. Without validated CSRF, keep the known allocation blocked rather than creating replacement sessions. Twenty explicit observation attempts after injected malformed delivery still make only one session allocation. Actual failed server preparations and late successful allocation after departure have separate release controls. This is not universal knowledge of an allocation whose headers never arrived, nor a cross-reload leak-free guarantee. |
| Obsolete cleanup could detach the replacement view                            | Make stop idempotent, scope poll cleanup to its owner generation and ignore obsolete returned cleanup. Actual HTTP/WS tests cover task switching beyond16 slots, old cleanup after replacement, refresh without allocation, reconnect and rotation. No preflight/action renewal or mutation replay is added.                                                                                                                                                                                                                                            |
| A self-consistent partial asset manifest was accepted                         | Require every reviewed fixed JS/CSS/HTML member and all60 finite font names, positive bounded sizes, closed references and the derived build identity. Check selected file/directory incarnations around closure reads. Tests reject trimmed manifests, dirty/partial/extra trees, links, hardlinks, query names and an injected identical-byte replacement during a read.                                                                                                                                                                              |
| Publication could touch the old tree before validating its copied replacement | `scripts/web-output.ts` validates the original published closure before builds and again before replacement, copies the new output into private staging and validates it before any rename. Invalid prior output stays at its original path, never in a foreign-file backup. Tests compare original bytes and absence of a backup after refusals, failed candidates and changed prior identity. This is not crash-atomic directory publication or hostile-writer CAS.                                                                                   |
| Selected graph/entity view state could survive changed inputs                 | Key the exact selected entity/graph request and remount run browsing on task changes; show actual progress coverage without inventing nonexistent data-page coverage fields. Established continuation requests remain pinned. All nine list dispatchers are exercised through shared data/progress/snapshot decoding.                                                                                                                                                                                                                                   |
| Higher-sequence receipt could substitute a created task or erase known facts  | Preserve command/operation/run/created-task identity and refuse contradictory later admission, created publication, execution or settlement facts. Keep the prior receipt and display conflict rather than replacing it by HTTP arrival order. Existing older/equal-sequence and lost-reply one-submit controls remain; no receipt lookup resubmits a command.                                                                                                                                                                                          |
| Phone drawer retained upstream fixed panel width                              | Override the actual scoped panel width, not a lower-specificity generic `.panel` rule. Browser geometry checks require inner and outer drawer widths to match and Escape restores the opener.                                                                                                                                                                                                                                                                                                                                                           |
| Timeline row selection lost keyboard focus                                    | Its reused string renderer replaced focused controls. Restore the exact keyed row/tab/scope/replay control after rendering, without following a different replay selection. The real browser regression first failed on focus loss, then passed after correction.                                                                                                                                                                                                                                                                                       |
| Phone timeline collapsed retained panes                                       | The wrapped header/ruler exhausted the fixed-height plot; the actual browser measured list16px/detail24px. Let the phone chart participate in outer scrolling with bounded independently scrollable retained panes. All four viewport cases now have readable list/detail regions and no document-wide horizontal overflow.                                                                                                                                                                                                                             |

The43 CSS warnings were resolved without lint suppression or dependency changes.
Removed warning-bearing retired mode overrides, reordered independent typography rules, retained ordinary copied/code styles through normal cascade, and enabled authored animation/transitions only under `prefers-reduced-motion: no-preference` instead of blanket `!important` overrides.
The remaining optional-chain test warning was also corrected.
Root lint now has **zero warnings/errors and six pre-existing informational suggestions** outside this slice.
The coherent reused renderer, layout, timeline and test families remain; this is not replacement by a thin dashboard.

## Source and Output Changes

Runtime/build changes:

- `src/service-http-client.ts`, `src/service-assets.ts`.
- `scripts/build-web.mjs`, new `scripts/web-output.ts`.
- `web/src/App.tsx`, `web/src/client/{observer,receipts}.ts`.
- `web/src/components/history/{EntityPane,GraphPane}.tsx`.
- `web/src/{reference,styles}.css`, `web/src/timeline/timeline-client.mjs`, `web/src/timeline/timeline.css`.

Regression/records:

- `test/web/{assets,observation,presentation,history-timeline}.test.tsx`.
- `test/web/assets-browser.e2e.mjs`, new `test/web/readonly-browser-fixture.tsx`.
- Current destination hashes/revision note in `provenance/webui-reuse.json`.
- Focused executable-contract update in `.trellis/spec/frontend/service-client-guidelines.md`.
- This new review and its evidence JSON; no task-status/manifests/history rewrites.

Canonical web changes are limited to `web/dist/manifest.json` and `assets/{cadence.css,cadence.js,timeline-client.js}`.
All other compiled bodies, including all60 fonts, remain unchanged.
Both service executables were canonically rebuilt and stayed byte-identical; HTTP/auth source and its existing adaptation destination hashes remain current without rewriting them.
No scheduler/task-action/history/model/worker semantics, dependency pins/lock, user Git/data/credentials or old qualification failures were changed.

## Build, Asset and Safety Review

The final browser build is `effd8ae1885672c95cfa5471cbc4e27d1da91968a9c91a0ac727a808ec1a64d8`.
It contains69 assets,70 files including the manifest and2,869,712 asset bytes.
Every build performs two actual private Vite productions and compares exact names/bytes before publication.
`build:web:check` independently repeats the double production and compares canonical bytes without mutating them.
The loader remains package-relative and finite, with16MiB/member and64MiB/closure limits, not CWD/URL filesystem serving or TypeScript fallback.
These manifests describe the reviewed web closure, not a replacement for the final independent package-member policy or malicious-manifest authenticity.

A separate copied-source check ran from an unrelated cwd with fabricated `.env` and `.env.production` files plus an ambient Vite canary.
It used only an explicit link to existing installed peers, no install/download.
Both actual outputs still matched canonical names/bytes, and neither canary appeared in compiled bodies.
The builder checks portable text outputs and source-map absence; source/contract/build identities remain local inputs, not an echoed server compatibility claim.

The pinned vis standalone SHA remains `82ce3dd35a440340e760e06c2a4045e2e72edc65b397f4c6bfc021354d2fe421`.
Its15 exact static CSS literals are extracted without evaluating JS; changed source/count refuses.
The actual emitted local stylesheet, self-only executable/stylesheet-element CSP and explicit numeric style-attribute compatibility policy remain unchanged.
No script/eval, user CSS, media, CDN or service-worker authority was added.
Default and optional raw Markdown safety retain their existing sanitization/KaTeX trust controls; optional raw HTML has SSR coverage, not a newly claimed full browser lane.

All35 upstream source/license pins and12 reference-test lineage pins were reread from the pinned Git objects.
Current web/auth destination hashes match; full MIT bytes were preserved.
All60 emitted font hashes match both installed source bodies and the prior audited font hashes.
The full emitted dependency/vendor/font notice assembly and final package membership remain W7 gates; the prior embedded-vendor source-map audit was not rerun or relabeled.

## Fresh Verification

All commands and exact arguments, private environments, exits, durations and log hashes are retained in the evidence JSON.
Every final gate exited zero on the same284 frozen inputs.

| Gate                                                     | Actual result and scope                                                                                                                                               |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check:web`                                      | Browser/tests and Vite/Vitest/browser config no-emit checks passed.                                                                                                   |
| `bun run test:web`                                       | **105 passed,0 failed,0 pending**,7 files: pure/SSR plus explicitly identified filesystem/HTTP/WS controls.                                                           |
| `bun run build:web`                                      | Two real Vite outputs matched before publication.                                                                                                                     |
| `bun run build:web:check`                                | Two new outputs matched each other and canonical assets; no canonical mutation.                                                                                       |
| Copied-source unrelated-cwd/canary build check           | Exit0; exact same output bytes despite fabricated dotenv/ambient canaries.                                                                                            |
| `bun run build:service`                                  | Canonical management/host regeneration, byte-identical.                                                                                                               |
| `CADENCE_BROWSER_PATH=… bun run test:web:assets-browser` | **2 passed,0 failed,0 pending**, one dedicated file; actual compiled assets, readonly data and closed action admission.                                               |
| `bun run check`                                          | Syntax, generated operator/service byte checks and native TypeScript passed.                                                                                          |
| `bun run lint`                                           | Exit0, zero warnings/errors; six unchanged informational suggestions; Markdown gate passed.                                                                           |
| `bun run check:agents`                                   | Exit0.                                                                                                                                                                |
| Eight explicit regression files                          | **389 passed,0 failed,0 pending**:232 contract,97 auth,9 export HTTP,11 graph-boundary review,4 graph-boundary,1 proof HTTP,11 fake-host native shell,24 service CLI. |

The six HTTP/codec/history files account for354 of the389 regression cases; the additional35 are shell/CLI guards.
Do not add overlapping earlier runs to these counts or call the entire set native/browser execution.
Existing original-read reservation, abort-without-Cancel, HTTP/WS authentication, raw-byte limits and export revocation controls remain passing under their original budgets.

## Actual Browser Evidence and Limits

The original empty-workspace scenario retains two isolated contexts, cookie-only clean entry, all three font formats, compiled vendor import, blocked inline script/style elements and Return without new control requests.
It now also asserts an actual successful session HTTP response, preventing the fetch-receiver defect from masquerading as successful access.

The new populated **readonly injected-record** scenario uses two additional isolated contexts and1440×900,768×1024,390×844 and320×568 viewports.
It exercises the real built React/HTTP/WS paths for task selection, message expansion, detail progress, Markdown/code/math, oversized-query refusal, zero-hit continuation, exact Unicode hit highlighting and full-field clipboard copy beyond256KiB.
It preserves displayed limited-source/redaction coverage.
It also instantiates the actual local vis chart, operates recorded metadata tabs/visual replay, checks keyboard focus, drawer geometry/Escape restoration/reduced motion, and explicitly rejects the vendor load in fresh documents to observe the degraded state with retained rows still reachable.
The fixture records no control requests and no external resource requests.

Two actual native browser downloads used the named Markdown `download` route and received the real server filename `cadence-export.md`.
The small injected exporter produced manifest/trailer-only files; the test checks downloaded final-frame boundary, count, encoded prefix bytes and digest after `saveAs`/`failure()` settlement.
The UI still says **requested — completion not verified**, and does not acquire a giant Blob/archive or service worker.
This does not qualify a complete durable task/run/child archive download or revocation during a real owner workflow; those remain separate required acceptance.

Browser close/context/server cleanup promises settled.
**Original browser OS exit-code and descendant closure were not independently observed and remain unqualified.**
Viewport simulation, scripted keyboard/clipboard input, injected timing/faults and fabricated records are not physical-human/device, paid-provider or full accepting-owner evidence.
The session/metadata fixtures do not manufacture current roles, graphs, model authority or passing execution outcomes.

## Preserved Failures and Remaining Gates

Earlier failing typechecks and assertions from this review remain in its owned logs.
They include the actual fetch-receiver defect, timeline focus loss and phone pane collapse; fixture corrections for unavailable task-scoped snapshot metadata and exact accessible-label matching; initial test-type assumptions about data-page coverage and the tasks reader's workspace scope.
No deadline, production bound or dependency was increased to repair them.
The earlier green frozen run is separately retained; the final receipt is the subsequent105/389/2 freeze after the additional receipt/footer counterexamples.
No explanation is assigned to historical history/SDK timeouts, Windows failures or prior qualification failures by these later passes.

Required remaining composition/qualification:

1. Actual W4 generate/check/review/current-environment/Stop composition and current planning/role/saved-graph/current-change metadata.
2. Real browser/service build compatibility negotiation and production asset-loader composition before opening actions; no local fallback executor.
3. Browser-only/mixed-client accepting workflows, actual worker/check/review outcomes, accepted work surviving detach, stale/duplicate/lost-reply actions and real durable full-history export/revocation.
4. Native terminal service-client cutover and required source/extracted regular/fullscreen workflows.
5. W7 emitted notices, reviewed exact package members, real pack/extraction and whole `verify`.
6. Separately labeled platform/runtime/provider/physical-human qualification; no Node22/Pi1.2, Windows/macOS/ConPTY, second-machine, paid-provider or physical-phone pass is inferred here.

No agents were spawned and no commit, push, merge, install, publication, deployment, task closure or consumer cleanup occurred.
