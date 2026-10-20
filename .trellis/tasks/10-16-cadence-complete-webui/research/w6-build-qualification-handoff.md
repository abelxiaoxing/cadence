# W6 Serial Source and Build Qualification

## Result and Evidence Boundary

The eight source-audit defects have source corrections and scoped regression coverage.
This is **not W6 completion or integrated product acceptance**.
Production `src/service/host.ts` still installs `admission: null`; no accepting backend metadata or build handshake was invented.
The exact commands, exits, 276 frozen source-input hashes, output hashes, retained failures and notice bindings are in [the evidence JSON](w6-build-qualification-evidence.json).
All ten final gates exited zero, with unchanged source inputs before and after the serial run.
Root lint still reports **44 warnings (43 CSS and one test optional-chain suggestion), plus 6 informational diagnostics**, not a warning-free frontend.
No warning suppressions, dependency changes, old evidence rewrites or increased existing test budgets were used.

Execution used fresh mode-0700 disk roots under `/home/mirako/abel/cadence-w6-NtrygzPb`, with explicit `TMPDIR`, `TEMP` and `TMP` on commands.
Previous roots and failed logs remain preserved.
Existing provisioning notices under the earlier `/tmp/cadence-w1-provision-ar5oshfh` were read and rehashed only, not reused as execution temp directories or modified.
Observed identities: Linux x86_64, Node 26.7.0, Bun `--version` 1.3.14 with the distinct canary run banner, installed Pi 0.84.3, Vite 8.3.0 and Playwright 1.63.0.
The optional browser fixture used the explicitly available Chromium 151.0.7922.34 binary, never a personal profile or download.

## Corrections and Actual Coverage

| Finding                                   | Correction                                                                                                                                                                                                                                         | Scoped evidence                                                                                                                                                                               |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing dependency export/config checking | `src/service-contract.ts` re-exports the existing maintained decoder; separate web/config TypeScript projects include build configurations and web tests.                                                                                          | Facade identity assertion and both actual no-emit checks.                                                                                                                                     |
| Revoked attachment reuse/leaks            | `web/src/client/observer.ts` owns serialized detach, original session acquisition, snapshot/subscription and reconnect; polling/refresh does not acquire sessions. Late unused sessions are detached; authorization refusal stops private viewing. | Actual loopback HTTP/WS: 20 task switches, repeated refresh, dropped socket, token rotation and departure during session allocation. Projection state is injected, not W4 execution evidence. |
| Asset/font/CSP mismatch                   | Flat fixed assets, WOFF/TTF MIME support, bounded hash-bound loader, external timeline CSS and exact vendor CSS extraction; explicit `style-src-attr 'unsafe-inline'` with `style-src-elem 'self'`.                                                | Real Vite closure, actual HTTP body/MIME checks and the narrow real-browser CSP probe below.                                                                                                  |
| Return leaves work alive                  | Return disables the observation hook, closes subscriptions/timers, aborts ordinary view reads and invalidates late callbacks. Accepted command identities remain in RAM and reconnect is observational.                                            | Pure lifetime controls, HTTP late-session disposal and a real empty-workspace Return observation across the one-second tick. No accepted execution was running in this browser fixture.       |
| Wrong export route                        | `web/src/history/download-export.ts` selects existing `download`, with `.md` versus `.ndjson` filenames.                                                                                                                                           | Anchor-initiation fixture plus existing HTTP export regressions; native browser download completion remains unqualified.                                                                      |
| Inexact confirmation                      | `ActionProposal` displays CREATE kind/goal, proposed SAVE plan/full graph/assignments/models and exact REVIEW task/run/change/check/issue acknowledgment from decoded `preview.action`.                                                            | React SSR assertions; no accepting plan metadata/default graph was supplied.                                                                                                                  |
| Late callbacks/receipt downgrade          | Shared view tickets invalidate dismissed/changed/departed work; exact-ID/operation and committed-sequence merges preserve newer receipts. Lookup never resends a command.                                                                          | Immutable merge, lost-reply one-submit and lifetime controls; modal/focus interaction is not inferred from SSR.                                                                               |
| Search byte overflow                      | Shared 1024-byte query limit/decoder, no clipping, request abort/generation checks and catch/finally handling.                                                                                                                                     | ASCII/multibyte boundary and exact-anchor tests; zero-hit continuations stay explicitly unfinished.                                                                                           |

Optional readonly AbortSignal parameters are forwarded through `ServiceClient` and `HttpServiceTransport`, never serialized or converted into Cancel.
The original HTTP reader accounting was not changed or refunded early.
Session acquisition in the observation owner is deliberately not abandoned on departure: its original result is awaited so any acquired attachment can be detached before replacement.
Ordinary refresh does not renew preflight/command consent.

The standalone timeline retains lanes, list, four detail tabs, filtering, zoom, follow, visual replay, resize and disposal.
Dormant wall-clock flow, inferred idle windows and tool/prose-derived duration analysis were removed, not hidden.
The plot remains explicitly ordinal across independent clocks; details expose stored worker-local ranges and separately recorded native check duration where available.
A missing local vendor is visibly degraded, not reported as a complete chart.
Retained events and long fields remain independently paged/searchable beyond the loaded plot window.

## Real Builder and Additional CSP Finding

`scripts/build-web.mjs` invokes installed Vite production builds twice into new private output directories, compares exact names/bytes, then publishes `web/dist` while preserving the prior output.
`build:web:check` repeats private generation and compares canonical output without modifying it.
The builder disables dotenv/public-directory/source-map inputs, filters its child environment, rejects unexpected/colliding names and checks local references.
It emits local source/contract/build identities; it does not echo a server identity as compatibility.
`src/service-assets.ts` loads only the finite package-relative manifest/body closure with safe reads, exact hashes and unchanged 16 MiB/member and 64 MiB/closure limits.
The native-strip-only builder imports the existing maintained JS codec directly, not a transitive TypeScript parameter-property facade.

Current output contains **69 assets / 70 files including the manifest**, totaling 2,868,982 asset bytes.
It includes all **60** actual KaTeX TTF/WOFF/WOFF2 bodies, six fixed JS chunks, two CSS files and HTML.
Build identity: `8316df74d33ba10d92a99557a651e5b7db4c70fa3ffca5fc799663264504a41f`.
These are web-output facts, not a replacement for the independently reviewed final package-member policy.

Inspection found that the selected vis standalone itself injects **15** inline stylesheets, beyond the original audit's timeline-owned stylesheet.
`web/build-vis-style.ts` accepts only source SHA-256 `82ce3dd35a440340e760e06c2a4045e2e72edc65b397f4c6bfc021354d2fe421`, parses its exact static CSS string literals without evaluating JavaScript and emits them as `assets/vis-timeline.css`.
Different source bytes or extraction counts refuse; the unused injection function is removed by the real bundler.
This preserves CSP executable and stylesheet-element restrictions rather than allowing inline stylesheet elements.

The generated `src/service-host.mjs` was refreshed through the canonical service builder for the assigned HTTP changes.
`src/service-cli.mjs` rebuilt byte-identically and remains SDK-free.
The production host has **not** been changed to compose the new asset loader or final browser/service build handshake; main must join those real boundaries without opening task actions prematurely.

## Verification

Every row below ran with the explicit private-temp environment recorded in the evidence JSON.
Web tests use an explicit `.test.tsx` include, outside native `.test.ts`/`.test.mjs` discovery.
The optional browser uses a separate `.e2e.mjs` runner and existing Vitest source-fixture transformation, not a production service TypeScript fallback.

| Command                                                  | Result and scope                                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `bun run check:web`                                      | Exit 0; browser TypeScript/declarations/tests and Vite/Vitest/browser configs; JavaScript is parsed by the actual build. |
| Scoped Biome command                                     | Exit 0; owned web/test/build/shared edits, with visible CSS warnings.                                                    |
| `bun run test:web`                                       | **80 passed / 0 failed / 0 pending**, 7 files; pure/SSR plus explicitly labeled filesystem/HTTP/WS controls.             |
| `bun run build:web`                                      | Exit 0; two actual private Vite outputs matched before publication.                                                      |
| `bun run build:web:check`                                | Exit 0; two fresh outputs matched each other and canonical bytes.                                                        |
| `CADENCE_BROWSER_PATH=… bun run test:web:assets-browser` | **1 passed / 0 failed**, separate readonly browser scenario.                                                             |
| `bun run check`                                          | Exit 0; syntax, exact operator/service generated bytes and native TypeScript.                                            |
| `bun run lint`                                           | Exit 0; 44 warnings (43 CSS, one test suggestion) and 6 informational diagnostics remain; Markdown gate passed.          |
| `bun run check:agents`                                   | Exit 0.                                                                                                                  |
| Six explicit HTTP/codec/history regression targets       | **354 passed / 0 failed / 0 pending**, 6 files; exact argv and individual JSON results retained.                         |

Direct test ports preserve pinned lazy-window, streaming-Markdown and swipe families.
Additional tests adapt tree, immutable delta/copy and search intent to Cadence's retained records and include safe HTML/Markdown, diff, unknown outcomes, progress/snapshot and command receipts.
These tests do not establish DOM focus, physical touch, real task execution or universal text safety.

The real browser scenario used **two isolated contexts**, at 1440×900 and 390×844, against actual compiled assets served by the real HTTP/auth boundary with injected unavailable readonly workspace state and closed admission.
It observed unauthenticated app refusal, token-to-clean-URL bootstrap, no JS-readable cookie/localStorage token, WOFF2/WOFF/TTF loading, imported compiled vis without stylesheet violations, allowed numeric style attributes, blocked inline script/style elements and Return without control requests.
It did **not** exercise an accepting task workflow, Markdown/math DOM rendering, an instantiated interactive chart, native attachment downloads or all responsive/focus layouts.
Browser close and fixture cleanup promises settled; this is not an independently observed browser OS exit-code or descendant-closure claim.

## Preservation, Notices and Remaining Gates

Original failed type/lint/build/test/browser receipts remain failed.
Notable fixture corrections were a genuine Chromium Unix socket-path limit (SIGABRT, then a new shorter owned leaf), an unavailable Node transform flag, and Vite's rewriting of a serialized evaluate callback.
No existing native/browser scenario deadline was increased, and no browser download repaired those failures.
The new reconnect assertion allows the production one-second backoff inside its unchanged five-second test case.
The first whole check's stale generated-host failure was repaired by regeneration, not by removing its check.
An initial notice-binding comparison incorrectly included official template copyright placeholders; the corrected comparison binds the full substantive OFL body and actual font-derived copyright/reserved-family text instead.

Original pi-web-ui source/test pins and full MIT bytes were preserved.
Current destination hashes and explicit serial revision notes were refreshed in `provenance/webui-reuse.json` and the assigned HTTP entry of `provenance/auth-reuse.json`.
All 60 emitted fonts match both their prior exact-package SHA-256 and recorded source Git-blob identities.
The full separate OFL/reserved-family notice inputs were rehashed, and the installed vis ESM body matched the preserved audited tar member.
The prior 13-family embedded-vendor audit and its full notice bodies were rehashed; the prior 502-source comparison was **not rerun or relabeled as this execution**.
Complete emitted dependency-notice assembly and final package membership remain W7 gates.

Main still owns the actual planning/current-role/saved-graph/current-change metadata, final shared build handshake and production asset-loader composition.
Full browser-only and mixed-client workflows, native downloads with real completion, all four viewport/focus/drawer/timeline/history interactions, native terminal cutover, whole `verify`, real pack/extraction and final notice/member audits remain open.
No provider credentials, consumer history, user Git state, dependency pins/lock, task status or unrelated archived evidence was changed.
No commit, push, merge, install, deployment, publication or consumer cleanup occurred.
