# Integrated Implementation and Verification Plan

## Status and Completion Rule

The user approved the final complete PRD/design/plan summary with “批准”; authorization is recorded in `research/implementation-authorization.json`.
Start the owning child, not this coordination parent, through `task.py start`; later children retain their explicit prerequisite gates.
All work packages below belong to one delivery; none is a standalone MVP or permission to defer core functionality.

Read order for every dispatched worker: its manifests → child PRD/design/implement → parent PRD/design, both mandatory design appendices and implement → applicable research.
Parent `design.md`, `design-runtime-history.md` and `design-clients-distribution.md` jointly own the authoritative cross-child contract and resolve conflicting research alternatives.

## 1. Work Packages and Dependencies

All paths below are relative to `.trellis/tasks/`.

| ID  | Child task                             | Prerequisites                                                  | Owns                                                                                                                   | Parent acceptance                                 |
| --- | -------------------------------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| W1  | `10-16-cadence-service-owner`          | Final parent planning approval                                 | Shared DTO/client ports, explicit owner/coordination, HTTP/WS access, Pi model context, management CLI/build.          | AC5,7–9,14–16,20 plus interfaces for all clients. |
| W2  | `10-16-cadence-worker-capture`         | W1 contract/ID/error/limit freeze                              | Worker v2, genuine messages/tools, incremental sanitization, bounded bash capture and native settlement.               | AC2,11–12,18,21 native producer responsibilities. |
| W3  | `10-16-cadence-durable-history`        | W1 persistence/admission interfaces; W2 frame contract agreed  | Durable receipts/journal/artifacts, legacy publication, paging/search/export and coverage.                             | AC4–5,7,9,18–19,21.                               |
| W4  | `10-16-cadence-subagent-orchestration` | W1–W3 integrated producer/store ports                          | Graph/queue/gates, owner action admission, cancel/failure, real checks/change/human review.                            | AC2,6–12,16–19.                                   |
| W5  | `10-16-cadence-terminal-client`        | W1 typed client; W4 action contract integrated                 | Native complete client, consent, detach/cancel, history/detail/export, removal of embedded production executor.        | AC1,4–9,12,18–20 and native regressions.          |
| W6  | `10-16-cadence-complete-webui`         | W1 frozen DTOs; W2/W3 detail formats; W4 owner for integration | Substantial reused workspace, transcripts/tools/review/history/timeline, responsive actions, browser build/provenance. | AC2–8,10,12–15,18–19,22 browser responsibilities. |
| W7  | `10-16-cadence-integrated-delivery`    | All W1–W6 implementation; can prepare fixtures/docs earlier    | Exact distribution/notice/build/spec audit and whole-product source/extracted/browser/terminal qualification.          | AC1–AC22 final integration.                       |

W2/W3 can develop against the frozen W1 interfaces concurrently with nonoverlapping file ownership.
W5/W6 can port presentation against typed fixtures after contracts freeze, but cannot close integration acceptance against mocked endpoints.
No child owns a second copy of contracts, reducers, state parsing or auth rules.
W1 owns the joint interface-freeze handoff and `test/service-contract.test.ts`; W2/W3 review producer/sink/coverage signatures together, not after each other’s completed implementation.
Use `research/interface-freeze.md` as the proposed shape and record actual frozen typed signatures in W1’s handoff.
The main session assigns one editor at a time for shared contracts/tests/package files.
Explicit dependencies above—not tree position—control ordering.

## 2. Before Any Product Edit

- [x] Obtain final artifact approval; record it in the parent and start W1 with `task.py start`.
- [x] Re-read `git status --porcelain=v1 -uall` and compare unrelated paths with `research/working-tree-baseline.txt`; preserve existing deleted/untracked archives and qualification data.
- [x] Record current source/Node/Bun/Pi/platform identities and a fresh baseline of existing quality commands, clearly separating pre-existing failures from new failures.
- [x] Read before-dev/spec guides for every affected owner; consult `research/approved-design-boundaries.md` and `research/assertion-dispositions.md` so old terminal-only assertions are deliberately replaced, not ignored wholesale.
- [x] Confirm upstream reference SHA/cleanliness; use pinned source bodies or explicitly review changed upstream inputs before copying.
- [x] Freeze common DTO/action/history/worker versions, limits, errors and ownership in W1 contract tests before parallel implementation; reciprocal reports and exact hashes are in W1 `research/joint-interface-freeze.json`.
- [x] Verify and apply the26 exact dependency additions through explicitly authorized isolated provisioning and externally offline lifecycle-disabled lock/install; see W1 dependency reports.
- [ ] Qualify the explicitly available isolated browser against actual built assets; no personal profile or automatic browser download.
  Follow existing isolated offline/cache lock-generation policy; missing artifacts are provisioning blockers, not permission for a silent online fallback or feature cut.
- [x] Keep planning, tests and later fixtures on fabricated auth/isolated directories; do not deploy a real service on the user's checkout or rotate actual Pi tokens as a side effect of development.

## 3. Ordered Engineering Checklist

### W1 — Owner and shared contract

- [x] Add portable closed-schema DTOs/runtime decoders, typed client ports and fixed errors;114 focused codec/admission tests pass.
      Joint consumer freeze is accepted; real runtime integration remains pending.
- [x] Add private registration/original-promise lifecycle primitives and unchanged v1 lock acquisition; file-only status preserves absence/unknown and does not invent authenticated readiness.
- [ ] Compose actual service startup/HTTP readiness, stop/diagnosis and CLI against real history/auth ports.
- [x] Atomically serialize registry overlap-check plus reservation; native temporary-root tests reject nested Git/submodule-shaped/mixed/non-Git overlaps and concurrent owners, while allowing disjoint worktrees.
- [ ] Add exact installed-public-peer model context, existing Pi config policy and independently accounted auth preparation/refresh; no inference session on view/startup.
- [ ] Commit credential-free auth-preparation intent/settlement independently of worker launch; test crashes during refresh/writeback with no worker present.
- [ ] Adapt reference token/cookie/WS admission code and tests; implement cookie-first bootstrap, Host/Origin/CSRF, native local capability, rotation and explicit HTTPS proxy deployment contract.
- [ ] Add explicit CLI and canonical generated service build with package-relative worker/Agent/web paths; do not replace the readonly operator.
- [ ] Implement management stop/quarantine/manual recovery with truthful native/auth uncertainty, no PID-only success or restart queue replay.
- [ ] Expose execution commands only when real scheduler/history ports are integrated; unavailable operations fail explicitly, never return fabricated success.

### W2 — Native worker producer

- [ ] Version request/ready/event/final together; preserve exact model/thinking/auth, stdin delivery, proxy and native close semantics.
- [ ] Capture genuine correlated messages/tools/details with bounded framing and awaited supported SDK capture hooks.
- [ ] Implement shared field-aware streaming sanitizer; redact before stdout and owner disk, including chunk-split/escaped literals and UTF-8 boundaries.
- [ ] Reserve synchronous ingress/in-flight budgets before awaits, avoid self-waiting abort deadlocks and qualify real fast-provider/slow-recorder behavior without claiming SDK-wide memory bounds.
- [ ] Replace only the stock bash raw-spill accumulation path through public operations; preserve actual command semantics and distinguish tool output from parent checks.
- [ ] Add source-limit/capture-limit/omission metadata, bounded queues and honest terminal failure; no final/frame or cleanup failure can become success.
- [ ] Port existing framing/flood/cancel/actual-SDK regressions to v2 with their original intent and newly reviewed bounds.

### W3 — Durable state and history

- [ ] Implement strict private history/graph/receipt/artifact codecs and safe owned file primitives without extending task v1 or importing old stores.
- [ ] Implement command intent → durable journal admission → launch intent → durable native settlement ordering; derived indexes cannot authorize effects.
- [ ] Preserve torn/uncommitted/corrupt bytes, explicit committed-prefix coverage and recovery fences; never truncate/repair on view/restart.
- [ ] Track v1 summary publication separately with exact expected-byte checks and explicit conflict status.
- [ ] Freeze conservative v1 phase mapping and labeled bounded previews; long retained final detail must not cause size-only summary publication failure.
- [ ] Implement complete paged lists/detail/timeline, literal exact-anchor search and streamed NDJSON/Markdown exports beyond the realtime ring.
- [ ] Enforce quota/reservations/control headroom and slow-disk behavior without automatic history deletion or green truncated capture.
- [ ] Verify replay/read/search/export constructs no SDK session and performs no passive writes.

### W4 — Orchestration and complete task actions

- [ ] Implement frozen graph validation, deterministic ready ordering, capacity reservations and fair checkout reader/writer gates.
- [ ] Wire explicit create/save-plan/readonly-generate/Start/Cancel/check/review to real admission receipts and worker/store ports.
- [ ] Bind roles/model/authority; readonly cannot escalate; stale dependencies require explicit revised work, not autonomous retry.
- [ ] Freeze exact dependency result/version/range handoffs within serialized128KiB requests; test large/multiple/escaped inputs and no silent clipping/synthesis.
- [ ] Test wait/stale/handoff-blocked episode drain and revised-graph/new-Start transitions; human review/reconnect cannot unblock execution.
- [ ] Preserve independent sibling results on parent failure, concurrent cancellation and whole-checkout unknown fencing.
- [ ] Run configured/native-manual checks with actual shell/cwd/timeout/launch-environment confirmation; track native exit and freshness separately.
- [ ] Project actual changes, baseline dirt, missing obligations and human issues review without certification or automatic Git/install actions.
- [ ] Integrate live snapshots/watermarks and final-update resync independent of subscribers.

### W5/W6 — Complete clients and reuse

- [ ] Convert native shell to the typed shared service, keeping native entry/confirmation/paging and adding all graph/detail/history operations.
- [ ] Clearly separate Return/detach from Cancel; invalidate pending dialogs on departure without canceling accepted service runs.
- [ ] Remove the embedded production executor path after all native actions use the service; no fallback when owner is absent.
- [ ] Adapt complete upstream layout/navigation/transcript/tool/Markdown/review/search/timeline/responsive families, not token helpers alone.
- [ ] Record source/destination hashes, modifications and notices while copying; port relevant upstream tests with source provenance.
- [ ] Replace generic appSend/session switching/repair/retry/plugin/PTY branches with finite typed action/read adapters; enforce server-side capability checks too.
- [ ] Implement real paged long detail and exact-hit navigation, not only DOM virtualization or silently clipped previews.
- [ ] Keep desktop/phone status and cancellation visible, dialogs keyboard accessible, and history visualization entirely nonexecuting.
- [ ] Build deterministic browser JS/CSS/font/vendor assets without CDN/service-worker or implicit external resource loading.

### W7 — Unified delivery gate

- [ ] Review exact generated/service/browser asset membership and body provenance, all licenses/fonts/vendor notices and dependency closure.
- [ ] Update current README/AGENTS/spec contracts for actual implemented owners/behavior; preserve historical evidence and independent skills.
- [ ] Complete assertion-disposition mappings and test every replacement intent; no blanket removal of negative safety tests.
- [ ] Execute the full integration matrix below against source and extracted artifacts, including both terminal modes and real browser.
- [ ] Bind actual outputs/identities/commands/exit codes to evidence; report unavailable platform/provider/human lanes precisely.
- [ ] Independent full-scope review of R1–R14 and AC1–AC22; fix/recheck findings before any completion claim.
- [ ] Perform spec-update judgment, then propose commits of task-authored changes only and request separate commit consent; never include the pre-existing dirty archive set silently.
- [ ] No push, publication, consumer cleanup or archive until their separate authorized workflow steps.

## 4. Verification Commands

Current baseline routes (run after implementation approval, not claimed run by this planning document):

```sh
bun run check
bun run lint
bun run test
bun run check:agents
bun run test -- test/distribution.test.mjs
bun run pack:check
bun pm pack --destination <private-temporary-directory>
```

Add and exercise these routes as part of the redesign, with real exact targets in package.json:

```sh
bun run build:service
bun run build:web
bun run build:check
bun run check:web
bun run test:service
bun run test:web
CADENCE_BROWSER_PATH=<explicit-existing-browser> bun run test:browser
bun run verify
```

`verify` must include root/web typecheck, generated-byte checks, lint, Agent check, all tests, required browser integration and pack audit.
Use explicit Vitest paths/config include patterns rather than shell wildcard assumptions; browser `.e2e.mjs` files have one dedicated runner to avoid duplicate execution.
`test:browser` uses isolated `playwright-core` with an explicitly available binary, not a personal persistent browser profile.
Missing browser/dependency/platform evidence is non-green/unqualified for its required lane, never an automatic install or skip promoted to pass.

Targeted proposed owners: `test/service-contract.test.ts`, `service-auth.test.ts`, `service-owner.test.ts`, `service-scheduler.test.ts`, `service-history.test.ts`, `service-package.test.ts`, existing lightweight process/SDK/store/shell tests, `test/web/*.test.{ts,tsx}` and `test/browser/*.e2e.mjs`.
Rename targets only through the corresponding child plan and final traceability update, not a silent narrower test command.

## 5. Integrated Acceptance Matrix

| Scenario          | Required observed behavior                                                                                                        | AC               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Native-only       | Source/extracted × regular/fullscreen Pi terminal create/plan/Start/check/change/review; no browser required.                     | 1,5–7,20,22      |
| Browser-only      | Real compiled service, no live Pi terminal, authenticated task/plan/Start/multi-agent/check/review.                               | 2,6,8,10,13–16   |
| Mixed clients     | Two browser contexts plus terminal share exact IDs/outcomes; close clients while owner continues, then reconnect.                 | 2,4,7–8,10,12    |
| Scheduling        | Real readonly overlap, serialized reads-versus-writes/checks, cross-task aliases, dependency/stale/failure reasons.               | 10–12            |
| Process/capture   | Actual SDK tool args/results/calls, huge paged content, UTF-8/secret splits, input/cleanup/nonzero/unknown handling.              | 2,11–12,18,21    |
| Crash windows     | Admission/launch intent/spawn/native close/publication boundaries; no restart launch, no duplicate action, preserved uncertainty. | 4–5,7,9,12,20–21 |
| History           | No-viewer capture; restart then hit beyond first page/ring/old caps, exact detail and full selected export with trailer/coverage. | 18–19,21         |
| Auth/remote       | Wrong/missing/rotated token, cookie-only navigation, invalid Host/Origin/CSRF/WS/detail/export; real HTTPS proxy fixture.         | 13–16            |
| Model credentials | Fabricated key/OAuth provider with coordinated renewal/writeback, unrelated fields preserved, no late spawn/secret projection.    | 16               |
| Review truth      | Child failure plus passed check stays partial/failed; not-run/stale/failed checks remain after Done-with-issues.                  | 6,11–12          |
| Desktop/phone     | Actual DOM/focus/drawers/long text/timeline/actions in 1440×900, 768×1024, 390×844 and 320×568 viewports.                         | 13,18,22         |
| Package/reuse     | Real pack/extract from unrelated cwd, exact JS/CSS/fonts/service/worker paths, source-body/pins/notices and no source fallback.   | 3,17,22          |

Use new browser scenarios with explicit 120s scenario/15s action budgets; preserve existing SDK20s/child15s and PTY90s/interaction15s budgets unless a separately reviewed new boundary justifies a change.
Fixtures must wait original process handles and distinguish clean from forced/unknown teardown; no unrelated process/port killing.
Evidence classification fixes reporting scope, not product feature scope or unsupported pass claims.

| Lane                                                                                                   | Classification                                                | Owner / meaning                                                                               |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Available-host native source/extracted service, actual SDK/fake-provider/check and crash/history tests | Required for this delivery                                    | W1–W4/W7; actual process/filesystem behavior.                                                 |
| Source/extracted regular/fullscreen native Pi terminal flows                                           | Required for this delivery                                    | W5/W7; original PTY process facts.                                                            |
| Real isolated browser, two contexts, full controls/history and phone-sized accessible layouts          | Required for this delivery                                    | W6/W7; actual DOM, not physical device/human evidence.                                        |
| Actual HTTPS proxy HTTP/WS route and hostile-origin/auth/export controls                               | Required for this delivery                                    | W1/W7; secure remote protocol boundary, not a second physical machine claim.                  |
| Generated-byte/asset/license/member audits, full suite and separate real pack/extract                  | Required for this delivery                                    | W7; AC3/17/22 cannot pass by source inspection.                                               |
| Physical phone/human and separate-machine field exercise                                               | Additional qualification                                      | Record separately; never infer from contexts/viewport/loopback TLS.                           |
| Native Windows/macOS/ConPTY and package-manager installation                                           | Additional qualification until executed in those environments | Preserve lanes and report missing results; Linux/extraction cannot qualify them.              |
| Actual paid-provider/account OAuth exercise                                                            | Additional qualification                                      | Fabricated providers verify mechanics, not account eligibility or universal adapter coverage. |

Required available-environment lanes exercise all AC behavior, including secure remote access; extra hardware/provider lanes qualify broader deployment claims rather than waive functional criteria.
A missing required lane keeps W7/parent open with an explicit blocker.
A missing additional lane remains unqualified; final reporting names the actual qualified environment and never calls that lane passed.

## 6. Risk Owners, Stop Points and Rollback

| Risk / stop point                                             | Owner and required response                                                                                                                           |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Public SDK capture/auth capability or peer resolution differs | W1/W2: inspect declarations and run isolated capability fixtures; refuse unsupported behavior, no private SDK imports/global guessing/forced upgrade. |
| Dependency/font/license/browser artifacts unavailable         | W6/W7: stop provisioning/build qualification and request the specific needed access/action; do not cut agreed UI/history or install silently.         |
| Shared credential corruption/refresh cancellation uncertainty | W1: preserve selected bytes where not SDK-authorized mutation, block launch, fixed diagnostics; no reset/copy/relogin.                                |
| History durability/privacy/unknown closure defect             | W2–W4: stop further writer admission, preserve fences/evidence, fix and re-run native/secret/crash controls.                                          |
| Upstream UI action introduces hidden runtime/PTY/repair       | W6: replace at adapter boundary and add import/action negative test; do not keep unsafe action behind a hidden button.                                |
| Existing v1 task/check/list limits reached                    | W3/W4: explicit refusal with available history reads; no covert schema change or record deletion.                                                     |
| Intentional old assertion change lacks replacement evidence   | W7: block final completion until disposition and fresh corresponding lane exist.                                                                      |
| Actual scope differs materially from approved design          | Parent: update artifacts and obtain renewed review before widening implementation.                                                                    |

Rollback is not automatic checkout rollback.
Stop/quiesce service work first, retain unknown fences and new private records, and revert only identified task-authored source changes after review.
Never reset unrelated user changes or downgrade a live service into an old executor.

## 7. Planning-Only Verification

Before presenting the final plan:

- [x] PRD convergence read: confirmed scope, no unresolved product-choice question, all original R/AC identities/constraints preserved.
- [x] All seven children have nonempty PRD/design/implement and real spec/research entries in implement/check manifests; parent links and dependencies agree.
- [x] Run `task.py validate` for parent and each child; verify every task remains planning and current task remains the parent.
- [x] Scoped Markdown/link/JSON checks on newly authored task artifacts only; do not format archived/history files.
- [x] Independent readonly planning review for missed requirements, inconsistent contracts, scope cuts and untestable claims; resolve blocking findings in artifacts.
- [x] Present final plan summary (goal/in-scope/out-of-scope/acceptance/key decisions/risks/artifact state), then wait for a fresh explicit implementation approval.

## Current Main Integration Checkpoint

W1/W2/W3 foundations passed the main1307-case32-file frozen boundary run plus check/lint/Agent checks; no product cutover or full distribution claim.
Follow [runtime/orchestration ownership](research/runtime-orchestration-handoff.md) and W4's source-backed readiness review next: real mutation-closed W1 host, minimal shared seams, then actual W4 orchestration.
W1–W3 remain open for integration; historical unexplained failures remain preserved.
