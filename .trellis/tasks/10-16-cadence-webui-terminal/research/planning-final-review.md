# Independent Final Planning Re-review

## Verdict

**No remaining approval-blocking architecture, scope or cross-child contract contradiction was identified in the revised selected design.**
F1–F5/B1 and I1–I5 are resolved at the planning-contract level, including the additional HTTP/export and context-loading clarifications.
The full integrated delivery remains intact; none of these dispositions is an implementation or runtime pass.

The main session should finish the pending scoped JSON formatting/newline follow-up and final planning-artifact review, then present the complete plan for fresh user approval.
This report does not authorize implementation, start a child, complete planning validation on the main session's behalf, or close any product acceptance criterion.

## Evidence Boundary and Material Reviewed

- Resolved the active task with `python3 ./.trellis/scripts/task.py current --source`: `.trellis/tasks/10-16-cadence-webui-terminal`, session source `pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`.
- Read current parent `prd.md`, `design.md`, both mandatory `design-runtime-history.md` and `design-clients-distribution.md` appendices, and `implement.md` completely.
- Read `research/planning-architecture-review.md`, `planning-scope-readiness-review.md`, `planning-review-resolution.md`, `interface-freeze.md`, `implementation-context.md` and `work-package-map.json` completely.
- Read W1–W4 PRD/design/implementation artifacts, including their correction checklists; checked W5/W6 implementation prerequisites and W7 implementation/evidence ownership against the seven-child map.
- Read parent/child metadata and performed readonly JSON/path/size inspection of both manifests for all eight tasks.
  This was not `task.py validate`, a formatter run or a product test.
- Spot-checked actual Cadence source and installed public Pi declarations/implementation for the coordination, request-size, capture, auth and v1-summary corrections.
  Local coding-agent/agent-core/pi-ai metadata still identifies version **0.84.3**.
- Read global official SDK/model/provider/configuration/security/message/session-format documentation and SDK full-control/tools/credential examples.
  Those docs are version **1.2.0**; installed declarations and implementation, not newer example assumptions, ground the public-capability conclusions below.
  Examples were read, not executed.

**Source-inspection/planning evidence only.**
No product tests/builds, service/browser/worker/provider execution, actual credential access, dependency installation, task start, additional delegation or Git mutation occurred.
Only this report was written.
The caller reports eight task validations without warnings and a scoped 43-file Markdown check as green; those are caller-reported planning results, not independently rerun results here.
The caller also reports pending JSON formatting/newline work.
This report does not claim final validation is complete.

Paths below are repository-relative unless absolute.
`P` means `.trellis/tasks/10-16-cadence-webui-terminal`; W1–W7 mean the children named in `P/research/work-package-map.json`.
Earlier review line numbers describe earlier revisions; the anchors below identify the revised contracts.

## Corrected Findings Disposition

### F1 / B1 — All-root atomic registration exclusion: resolved

`P/design.md:83–101` now requires canonical ancestor/descendant exclusion **regardless of Git classification**, explicitly including nested repositories/submodules and mixed roots.
Overlap validation and reservation occur under one short cross-process registry lock.
Uncertain, stopping and quarantined registrations remain fences; ambiguous registry locks are preserved.
Exact-root aliases attach or conflict, while genuinely disjoint worktrees remain independent.

This closes both the nested-Git counterexample and the concurrent-start check/reservation race from the earlier reports without inventing a broader OS sandbox or another state-home fallback.
The limitation concerning arbitrary older/custom-domain/external processes remains explicit rather than being mistaken for coverage of supported concurrent registrations.

Actual `src/task-store.ts:114–139,193–214` still confirms why the extra registry rule is necessary: canonical Git roots can differ and produce different private lock directories.
The revised design does not mistakenly rely on those separate v1 locks alone.
W1's correction checklist explicitly includes both registration orders, nested repositories/submodules, simultaneous starts and uncertain registrations (`.trellis/tasks/10-16-cadence-service-owner/implement.md:18–22`); parent W1 work and W4/W7 integration preserve the AC11 responsibility.
**Runtime exclusion is still to be implemented and exercised.**

### F2 / I1 — Capture ingress, public bash replacement and abort accounting: resolved

`P/design-runtime-history.md:69–94` now states all of the material distinctions:

- Awaited core-agent subscription is not obtained by making a synchronous AgentSession listener async.
- Synchronous/overlapping source callbacks reserve byte/event/in-flight capacity before the first await/copy and snapshot only bounded allowed values.
- The bash adapter owns synchronous ingress and accounts for outstanding update promises.
- Abort is requested through a separately handled promise; an awaited listener must not await its own run's settlement.
- Queue ceilings cover Cadence-owned queues, **not every SDK/provider buffer or total process memory**.
- The replacement is a public **ToolDefinition using `createLocalBashOperations` and Cadence's accumulator**, not custom operations passed into the stock accumulator.

Rechecked source supports these distinctions: `node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:57–70` exposes awaited listeners and tool execution strategy; `dist/agent-loop.js:453–482` accumulates update-emission promises from synchronous callbacks.
`node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js:2–31` has a separate producer queue.
Public exports are in coding-agent `dist/index.d.ts:7,24`; `dist/core/tools/bash.d.ts:19–49` exposes synchronous `onData` and public local operations, while `dist/core/tools/bash.js:230–300` still constructs the stock `OutputAccumulator` independently of custom operations.
Existing `src/sdk-worker.mjs:66–76` separately accounts for abort settlement.

W2's checklist names the custom ToolDefinition and pre-await/fast-provider/slow-disk/no-self-deadlock qualification explicitly (`.trellis/tasks/10-16-cadence-worker-capture/implement.md:18–21`).
The correction is feasible at the stated boundary; it does not falsely solve upstream memory buffering by declaration.
Real stalled-recorder/native-settlement qualification remains mandatory.

### F3 — Exact bounded dependency handoff: resolved

`P/design-runtime-history.md:8–18` now defines the actual child input rather than just a dependency relation: committed predecessor result identity/version, whole final text or explicitly reviewed UTF-8 range, deterministic graph order, exact supplied public projection and omission/redaction/source coverage.
Historical selections name existing committed run/record/version; current-episode selections resolve to allocated child IDs and committed result versions at dispatch.

The selected limits are coherent: default whole-result handoff is at most 16KiB per predecessor/32KiB aggregate, pre-auth serialized public fields fit 96KiB, and the complete serialized envelope must independently fit 128KiB after auth.
This includes escaping/serialization rather than relying on source string length.
Oversized required input blocks; it cannot silently clip, invoke another summarizer or grant private-store reading authority.
Full allowed predecessor history remains separately retained.

That addresses the actual inline-request boundary in `src/subagent-process.ts:15–23,76–79`.
W1's joint freeze includes the dependency port; W3 records the exact handoff and W4 enforces identity/budget checks in their correction checklists.
No increased request ceiling or unbounded concatenation is needed to satisfy the revised contract.

### F4 — Blocked episode termination and new Start: resolved

`P/design-runtime-history.md:20–39` now gives a finite transition: wait expiry, required-handoff overflow or stale required dependencies close episode admission; active independent siblings drain; the episode settles blocked with completed/partial results preserved.
Remaining work needs a separately saved/reviewed revised graph and a **new explicit Start/episode**.
Historical inputs may be explicitly selected; old execution approval is not imported.
Done/review, reconnect and timer refresh cannot reopen the episode.

The same section distinguishes unchanged bounded observation from complete filesystem knowledge.
Unrelated incomplete whole-checkout coverage is visible, not silently complete or universally fatal; explicitly required complete coverage and missing/changed selected input block.
Expected predecessor edits update expected context.
This removes the previous ambiguity between human review and renewed execution authority without adding a new action family.
W4's correction checklist includes drain/revised-graph/new-Start and the negative Done/reconnect cases (`.trellis/tasks/10-16-cadence-subagent-orchestration/implement.md:18–21`).

### F5 — Durable credential-preparation uncertainty: resolved

`P/design.md:186–193` and `P/design-runtime-history.md:111–126` now jointly require credential-free preparation intent committed **before `getAuth`**, with settlement only after the original tracked promise settles, including canceled/no-launch episodes.
Operation/source-selection identities and fixed outcomes are recorded, not credential bytes or secret digests.

An unmatched preparation after a crash remains credential-uncertain even without worker launch intent.
Refresh is not replayed; process-lock resolution cannot clear credential uncertainty.
The caller's 30s wait and cancellation close worker admission without pretending that an already-started refresh/writeback was rolled back.
Shutdown retains original-promise accounting.

Actual `node_modules/@earendil-works/pi-ai/dist/auth/resolve.js:64–110` still performs refresh through `credentials.modify` before returning usable auth.
Public model-aware `getAuth` and minimum-validity options remain available in coding-agent `dist/core/model-runtime.d.ts:20–24,53–79`.
W1 and W3 correction checklists plus `P/research/interface-freeze.md` explicitly own the journal boundary and no-worker crash windows.
The lack of a worker is no longer treated as evidence of no credential effect.

### I2 — Bounded v1 projection and conservative phases: resolved

`P/design-runtime-history.md:138–145` explicitly assigns W3 the v1 summary mapping and names goal 8KiB, plan 32KiB, result/baseline 16KiB, 64 activity entries and the 128KiB record ceiling.
It uses labeled previews/run references in existing fields, not extra v1 keys or full rich bodies.

Phase mapping is conservative: queued/preparing/running → running; completed execution → review; advisory planning → planning; failed/blocked/mandatory-recording-failed → failed; canceled/timeout/unknown → interrupted; explicit human closure alone → done.
These names match the actual vocabulary in `src/task-types.ts:5–11,110–130`; strict fields and remaining bounds are retained in `decodeTask`.

Long retained final text stays in history-v2 and must not cause size-only publication failure through copying it wholesale into `task.result`.
Publication conflict remains separate from native outcome; human Done does not rewrite check/execution facts.
W3's explicit correction item covers this distinction.

### I3 — Joint interface freeze and seven-child dependency map: resolved

`P/implement.md:14–33` and `P/research/interface-freeze.md` name W1 as owner of shared DTO/client ports and `test/service-contract.test.ts`, W2/W3 as joint producer/sink/coverage reviewers, and the main session as the single-editor handoff coordinator.
The handoff is expressly a planning shape; actual exported typed signatures/tests are W1 deliverables before dependent parallel implementation, not purported existing code.

The dependency map remains acyclic at the implementation-completion level:

1. W1 freezes shared owner/admission/recording/client contracts after approval.
2. W2/W3 jointly agree frame/sink/coverage interfaces, then implement their nonoverlapping producer/store responsibilities.
   Reciprocal interface review does not mean waiting for each other's completed implementation.
3. W4 integrates real W1–W3 ports before execution acceptance.
4. W5/W6 can port against frozen typed fixtures, but require the real W4 owner for integration acceptance.
5. W7 can prepare fixtures/docs earlier; final qualification requires all W1–W6 implementations and the entire integrated acceptance set.

Child prerequisites and correction checklists agree with this map.
W1's unavailable execution routes before real integration are an internal safety boundary, not a partial released product or a second executor.

### I4 — Required versus additional qualification: resolved

`P/implement.md:150–187` now separates required available-host source/extracted native/SDK/history/crash, both native terminal modes, real isolated browser/multiple contexts/phone-sized layouts, actual HTTPS proxy HTTP/WS and package/build/notice lanes from additional physical-device/second-machine, other-native-platform/ConPTY, package-manager-install and paid-account/provider qualification.

Missing **required** evidence keeps W7/parent open.
Missing additional evidence remains explicitly unqualified; viewport/loopback TLS/fabricated OAuth cannot be labeled physical-phone/second-machine/paid-account proof.
W7's correction checklist explicitly adopts this classification.
The PRD's R1–R14 and AC1–AC22 remain present; classification bounds the claims made from evidence rather than moving a capability into a later release.

### I5 — Parent description: resolved

`P/task.json` now describes the complete independent terminal/WebUI workspace, persistent shared owner, multi-agent orchestration, rich durable history, personal remote token access and substantial reuse.
Parent and all seven children remain `planning`, with reciprocal parent/child links.
No old selective-reuse/terminal-owned-execution description overrides the current PRD.

### HTTP/export clarification: resolved

`P/design.md:136–158` permits ordinary navigation/subresource GET without requiring a nonexistent browser Origin, while rejecting supplied foreign/null Origins and requiring exact browser mutation/WS Origin.
Browser access cannot impersonate native authority through a surface label or trusted-proxy traffic.

Rotation revokes old token access and pending grants and closes authenticated sockets.
`P/design-runtime-history.md:166–173` additionally requires access-generation checks at **every bounded export output chunk**, with revoked streams terminated without a completion trailer.
Stable history cursors are navigation only and are independently authenticated on reads.
Thus WS closure is no longer the only specified mechanism for revoking an already-streaming export.
Already delivered bytes cannot be retracted; this contract governs subsequent server output, not reversal of prior disclosure.
Accepted tasks continue unless separately canceled.
The simple reference-style owner-token/cookie choice is preserved; no alternative account/JWT system is needed to resolve this finding.

### Bounded context and mandatory appendices: resolved

The authoritative split is explicit in the parent and every child design, and the dispatch read order requires both appendices completely. `P/research/implementation-context.md` is a source index, not an abbreviated replacement for those contracts.

Readonly inspection found the following byte sizes: parent PRD 19,526; main design 28,391; runtime/history appendix 17,682; client/distribution appendix 7,147; implementation plan 24,396; bounded context index 9,168.
All are below 32,768 bytes.
All eight tasks' implement/check manifest references exist and none of those referenced files exceeds that bound.
The oversized original reports remain on disk for complete on-demand reads, with parent authority explicitly resolving older recommendations.
This removes the identified injection-truncation problem without discarding research or reducing product scope.
These size/path observations are not a claim that final task/link/format validation has been rerun or that every future harness can never truncate context.

## Remaining Gates, Not New Design Blockers

No new feature, rejected MVP/auth alternative, second executor or speculative subsystem is requested by this review.
The selected complete design is sufficiently coherent for final user review after the main session's pending planning hygiene.

The following remain real obligations, not passes supplied by this report:

- Finish the pending scoped JSON formatting/newline follow-up and accurately record final planning checks; preserve unrelated artifacts.
- Obtain fresh explicit user implementation approval.
  Keep all tasks planning until the authorized owning-child transition.
- Produce W1's actual typed interface/test handoff before parallel implementation, retaining the correction contracts above.
- Qualify public capture/auth behavior, registry crash/race handling, durable recording/recovery, v1 publication, token/export revocation and client action parity at their actual process/storage/HTTP/SDK boundaries.
- Verify exact dependency/browser/license availability and complete generated/extracted package assets under the existing provisioning policy.
  No availability, upstream working-tree cleanliness, package execution or license-closure pass was independently established by this re-review.
- Execute every required integrated lane and distinguish additional unexecuted qualification precisely.
  A source citation, planning validator, mock fixture or this review cannot satisfy a missing runtime acceptance lane.

**Final disposition: planning corrections accepted; no remaining design approval blocker identified.
Implementation remains unauthorized pending the user's fresh approval.**
