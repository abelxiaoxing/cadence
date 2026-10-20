# Shared Service Client Presentation

## 1. Scope / Trigger

The approved dual-surface redesign replaces terminal-local execution with one service owner.
The production native entry and built WebUI now use the accepting service; the legacy controller is not reachable or shipped.
Apply this guide to both adapters; boundary evidence and final integrated qualification remain separate.
Presentation never owns a worker, auth refresh, storage writer or execution outcome.

## 2. Signatures and Owners

Use the actual portable `ServiceClient`, `ServiceTransport` and `ProjectionTracker` in `src/service-client.ts`, shared decoders in `src/service-contract.ts` and maintained `worker-public.mjs`/`.d.mts`.
`ServiceClient` exposes `preflight(expected: ContextVersion, action: Action)`, named `create/savePlan/generatePlan/start/check/review` commands, `cancel(CancelCommand)`, `detail(ReadCursor)`, `graph(GraphReadRequest)` and typed history readers.
`ServiceTransport` alone carries the generic `preflight(PreflightRequest)` / `command(Command)` wire boundary; presentation does not gain an arbitrary sender.
Use existing HTTP/WS adapters rather than upstream generic send/session/runtime APIs.
TaskActions supplies current roles, saved graphs/proposals, changes, check obligations and independent active runs; a component fixture or client inference is not that authority.
`WorkspaceObserver.observe(scope, publish)` serializes observation sessions and returns view cleanup, not task Cancel.
`loadWebAssets()` defaults to package-relative `web/dist` and returns the checked manifest, finite static bodies and raw-manifest identity; `scripts/web-output.ts` is build-only publication, not a runtime writer.

## 3. Contracts

- Bootstrap is server token-link →303 clean URL→HttpOnly/SameSite cookie.
  No token localStorage, repeated token queries, provider login/profile UI or credentials in client DTOs.
  Keep CSRF/attachment state in RAM through the existing transport.
- Native local capability requests must use `NativeConnection`'s owned public direct dispatcher, not the Pi process's provider-proxy/global dispatcher.
  The canonical registration pins numeric loopback; redirects remain refused.
  Detach joins the original owned close and never changes/restores the parent's dispatcher.
  `native-client.test.ts` exercises an actual configured public proxy with zero native local contacts and unchanged global identity.
- Default native browser fetch must retain its global receiver (`globalThis.fetch.bind(globalThis)`); Node or injected arrow-fetch tests do not prove this browser API contract.
  Initial app rendering is not a successful session/workspace observation.
- Detach failure retains the exact attachment and blocks replacement allocation; a known successful session header remains tracked even if its original body fails.
  Without a validated CSRF challenge, that uncertain allocation stays blocked rather than silently acquiring replacement slots.
  Handle the actual `unauthenticated` DTO code, including revocation with no selected task/socket; obsolete cleanup cannot detach a replacement scope.
- Explicit preflight previews and fresh confirmation precede commands.
  Lost reply/reconnect observes a command receipt; it never replays a mutation or silently renews consent.
  Return/unmount detaches; only explicit Cancel requests stop.
  Cancel disables only its in-flight request: preserve every exact receipt and permit a new explicit stop after refusal/uncertainty, never automatic retry or assumed settlement.
- An already-attached viewer must observe another client's explicit model choice.
  Refresh capabilities on the same attachment when the observed owner model changes; do not retain initial unavailable capabilities forever, allocate a new session or infer task consent from model selection.
- Lists return data, `kind:progress`, or initial `kind:snapshot`; detail/entity/graph return data or progress.
  Progress has no records/text/success fact.
  Follow the exact next request, preserve coverage, abort stale view work and never rebase an established snapshot.
  A zero-hit search with next is not query completion.
- Use authoritative parent/child/native/check/review/recording fields independently.
  Model prose, checkbox percentage, connection state, SDK tool-error and human Done cannot become execution/check success.
- Keep every retained field reachable through actual pages; DOM virtualization, preview text and live rings are not archives.
  Exact-hit anchors stay ordinary record/version/field/range navigation and can need independent detail proof.
  Only a genuine completion trailer/original EOF supports export completion; browser download requested is not a verified-complete claim.
- Full paged/progress replies stay512KiB including the22-byte Reply envelope and raw HTTP bytes; text detail256KiB.
  Graph bodies512KiB use the existing1MiB standalone graph/export-frame envelope.
  Frontend rendering must not silently clip data to make these contracts appear satisfied.
- Adapt coherent pinned reference families with source/destination provenance and MIT attribution.
  Do not import appSend, browser SDK/session ownership, transcript repair, retries, PTY, plugins, Git/file mutation or dynamic executable code fences.
  HTML/Markdown, links and tool text remain untrusted after credential redaction.
  No automatic external images/CDN/script loading; preserve code/math safely.
- Use measured stored sequence/timing and explicit unavailable timing, never prose/token-speed reconstruction.
  Timeline replay is visualization only.
- Desktop three panes and phone drawers/full-height details retain visible status/Cancel, keyboard/focus restoration and44px primary targets.
  Both drawer regions have a programmatic `tabIndex=-1` target; `useDrawerFocus` focuses it when no enabled descendant exists (for example after restart with null owner model).
  Escape and Tab must still reach that empty/disabled drawer, then restore trigger focus; never strand focus behind an inert overlay.
  Build/protocol incompatibility disables actions rather than selecting a fallback executor.
  Independently compiled identity inputs include shared browser/native proposal code (`src/plan-proposal.ts`), not only wire decoders and `web/src`; a changed imported helper must invalidate compatibility.
- The reviewed web closure requires all fixed JS/CSS/HTML members and all60 KaTeX font bodies, exact hashes/sizes, safe ancestors/regular single-link leaves and unchanged read incarnations.
  Limits remain16MiB/member and64MiB/closure.
  Build publication validates existing manifest/member/body closure before building and again before replacement; dirty/partial/extra/linked output refuses in place, never becomes a foreign-file backup.
  Stage and validate the new copy before touching the published tree; build/check/comparison failures preserve it.
  These checks are supported-writer hygiene, not malicious-manifest authenticity, hostile-filesystem CAS or a whole-package notice/member audit.

## 4. Validation and Error Matrix

| Observation                                  | Required presentation                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------ |
| Missing/unavailable service                  | Exact explicit management guidance; no autostart/embedded executor       |
| Unauthorized/rotated access                  | Stop private reads; explicit re-entry guidance; no secret echo           |
| Stale/expired preflight                      | New observation and new human confirmation, not automatic retry          |
| Accepted command with lost reply             | Observe exact command ID/receipt and run; no second launch               |
| Read progress/snapshot transition            | Loading/progress with preserved identity, never fake empty completion    |
| Capture gap/source limit/partial result      | Visible independent coverage; keep all retained material accessible      |
| Failed child plus passed check or human Done | Keep original failed native/child facts and issue acknowledgment         |
| Old epoch/history                            | Historical labels; no fabricated current activity or mutation permission |
| Interrupted export                           | Incomplete/unconfirmed, not success from HTTP headers or button click    |

## 5. Good / Base / Bad

Good: a real owner provides exact child IDs and durable data; both clients consume the same decoded facts, including empty progress pages and source gaps.
Base: pure component fixtures qualify layout/interaction only; unavailable actual owner keeps execution acceptance open.
Bad: copying upstream automatic continuation, interpreting no stream as done, slicing a long tool result and labeling it full, or treating a component prop as actual native execution evidence.

## 6. Required Tests

Port relevant upstream pure tests with pinned lineage and add hostile text, stale view, typed-progress, exact-hit, focus/drawer/keyboard and unknown-state controls.
`test:browser` is the single dedicated `.e2e.mjs` runner in verify.
Its accepting lanes include cold owner Stop/restart with no model re-selection/replay, exact retained hit and complete exports, an actual Pi readonly PTY alongside two browser contexts, and real CA-validated HTTPS HTTP/WS against the generated owner.
The four viewport assertions establish actual drawer focus before Escape and await closure/restored trigger focus, including null-model/disabled-inspector state.
Integrated gates use actual built assets and isolated `playwright-core` with an explicitly available binary, two browser contexts, actual owner actions/history and1440×900/768×1024/390×844/320×568 layouts.
No authenticated personal profile or automatic browser download.
Accepting-browser controls retain an already-open second tab through model choice and an injected no-effect Cancel refusal followed by one explicit retry.
Lost-reply fixtures await their original route fetch/abort before removing interception and match the exact command receipt, not an older unrelated error message.
The scoped `test:web:assets-browser` route additionally tests actual compiled readonly history/Markdown/math/Unicode-copy/timeline/focus/drawers at all four viewports using explicitly injected records and closed action admission.
It asserts a real session response, not just a heading; native downloads from the fixture exporter retain requested/unverified UI wording.
Timeline string rerenders must restore exact keyboard focus, and phone headers/rulers must not collapse retained list/detail regions to their padding.
Neither this readonly lane nor its original empty-workspace scenario qualifies an accepting owner workflow, durable archive or independently observed browser process/descendant closure.
Native gates retain real regular/fullscreen Pi entry/consent and original PTY process facts.
Synthetic input, fabricated providers and viewport simulation are not physical-human/device or paid-provider qualification.

## 7. Wrong Versus Correct

Wrong: `records = reply.value.records ?? []`, then show no results and stop loading.
Correct: explicitly narrow data/progress/snapshot, continue the exact next request and render data only when present.

Wrong: reuse generic upstream send/repair/retry hooks behind hidden controls.
Correct: adapt compatible renderer/layout/timeline families around the finite shared client, with execution authority remaining in the owner.
