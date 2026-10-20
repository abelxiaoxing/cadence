# Complete Cadence WebUI and Terminal Redesign

## Goal and Approved Scope

Deliver one complete Cadence task workspace with independently usable terminal and WebUI clients, one persistent execution owner, multi-subagent collaboration, inspectable execution details, durable searchable/exportable history, personal remote access and a qualified distributable package.
The user confirmed this consolidated scope after explicitly rejecting a staged MVP/first-release strategy.
All agreed capabilities belong to this delivery; internal work packages and test ordering are not separate product releases.

The user permits substantial direct reuse from `/home/mirako/abel/pi-web-ui` and explicitly wants reuse to reduce development time and difficulty.
Adapt compatible implementation families rather than rebuilding equivalent functionality or limiting reuse to visual inspiration/small helpers.

## Authorization and Preservation

- Task creation, research/planning and the complete product scope are approved.
- The user explicitly approved the final reviewed design/execution plan with “批准”; see `research/implementation-authorization.json`. Execution starts with W1, and later children start only after their prerequisites. The parent remains the coordination/integration record, not a competing implementation target.
- Approved product choices: actionable WebUI; independent service surviving client departure; readonly parallelism with serialized checkout writes; single-owner remote access; token-link browser admission; existing Pi model configuration with SDK OAuth refresh/writeback.
- The latest confirmation includes full process inspection, durable paged history/search/export, desktop/phone usability, service management, package/docs/license work and integrated testing.
- Preserve all pre-existing dirty paths and historical artifacts; do not stage, clean, reset or migrate them.
- Do not invoke the Cadence/Abel runtime workflow, use actual provider credentials, expose a service, install dependencies, commit or publish merely to plan this redesign.
- Internal child tasks may be independently implemented/tested, but parent completion requires the entire integrated scope.

## Background and Source Evidence

These are inspected current-source facts, not newly executed tests.

- Cadence is currently a Pi terminal extension plus readonly operators, without a web application (`README.md`, `package.json`).
- Its workflow is plan → one agent → checks → changes → human review; code Start requires a readable plan, raw native terminal entry and fresh confirmation (`src/task-shell.ts:20-61`, `354-432`).
- Three shipped Agents are alternative instruction profiles, not a coordinated team (`src/agent-registry.ts:32-44`, `src/task-controller.ts:219-228`).
  Worker progress currently exposes readiness/tool-start names rather than correlated tool completion or full history (`src/sdk-worker.mjs:315-402`).
- Current terminal departure cancels owned work (`src/task-shell.ts:81-113`); the approved independent service deliberately changes that lifecycle.
- Existing readonly history projects stored `running` as `interrupted` without live-owner knowledge (`src/operator-tools.ts:29-50`); polling it cannot supply truthful live state.
- Existing task v1 rejects extra fields and task-directory siblings (`src/task-types.ts:166-182`, `src/task-store.ts:324-350`); new history cannot be added casually beside old records.
- Cadence is MIT, copyright 2026 Abel Xiaoxing (`LICENSE`).
  Reference pi-web-ui is MIT, copyright 2026 xing-shuyin, inspected clean at `e8bab487af208bc9a1ab60a821652323f598127f`; selected dependencies/assets still require their own notices.
- Reference paths in the next three bullets are relative to `/home/mirako/abel/pi-web-ui`.
  It creates its own SDK runtimes/PTYs rather than attaching to the existing terminal execution (`extensions/webui.ts:241-284`, `server/agent-service.ts:2695-2736`); its automatic restart continuation must not be imported (`server/agent-service.ts:3622-3654`).
- Its browser access uses startup `PI_WEB_TOKEN`, query/header/cookie candidates, an HttpOnly cookie and pre-upgrade WS authentication (`server/index.ts:195-219`, `289-393`, `1064-1081`).
  The client also stores the token in localStorage, strips the visible URL and reappends the token to selected requests (`web/src/auth-token.ts:15-46`, `web/src/use-chat.ts:1693-1698`); this is not the model-provider credential.
- Its normal model configuration reuses the Pi agent directory and `auth.json`/`models.json` (`server/agent-service.ts:2695-2732`, `2850-2862`; public SDK factory evidence in `research/pi-web-ui-model-auth-reference.md`).
  Public SDK OAuth resolution persists rotated credentials (`node_modules/@earendil-works/pi-ai/dist/auth/resolve.js:64-110`); writable sharing is explicitly approved, not mislabeled readonly.
- Maintained specs currently exclude WebUI, a service API and multi-agent scheduling.
  The reviewed redesign must deliberately update these product boundaries while preserving applicable consent, storage, process-outcome, check/review and distribution guarantees; obsolete certified/transactional mechanisms remain retired.

## Requirements

### R1 — Complete dual-surface operation

Both terminal and browser support task creation, planning/decomposition, explicit Start, cancellation requests, real parent checks, change inspection and human review.
Terminal operation needs no browser; browser operation needs no live Pi terminal.
Both use the same execution owner, not separate competing runtimes.

### R2 — Truthful subagent visibility

Show each subagent's identity, assignment, dependencies, waiting/running/settled state, elapsed observations and actual result.
Distinguish execution, connection freshness, tool outcomes, parent checks and human review.
Do not infer success from model prose, socket state, absence of streaming or a checklist percentage.

### R3 — Substantial reuse first

Directly reuse/adapt coherent pi-web-ui layout, navigation, transcript, tool-detail, Markdown, search, timeline, responsive, token-authentication and state-reconciliation code families where compatible.
Prefer thin data/action adapters over rebuilding equivalent UI or authentication machinery.
Record pinned source/destination groups, modifications and applicable licenses; preserve upstream copyrights/full notices.
Do not import incompatible execution/control policies merely because a reused component references them.

### R4 — Shared execution truth

One owner supplies authoritative task/run/assignment identities, outcomes and observations to both clients.
Reconnect, delayed updates, concurrent tabs/devices and stale actions cannot create duplicate executions or conflicting completion claims.
Historical state remains distinguishable from owner-confirmed current activity.

### R5 — Compatibility and data preservation

Preserve existing task/config/history bytes, unrelated working-copy changes, independent skills and startup behavior.
Retain honest bounded observation, baseline dirt, stale checks/review, cancellation and uncertain closure semantics.
Legacy records lacking rich detail remain readable as legacy context; do not reconstruct missing history, import old approvals, reset uncertain resources or promise old binaries understand new live collaboration.

### R6 — Explicit authority

Opening/listing/history/reconnect is not execution consent.
Both surfaces require explicit, context-bound Start/check/review actions and reject duplicate/stale mutation attempts.
Readonly work cannot acquire editing/check capabilities through a child assignment or generated plan.
Access authentication does not itself confirm a task action.
No automatic credential migration, arbitrary browser shell, nested autonomous scheduler or second executor is implied.

### R7 — Independent service lifetime

Explicitly started service-owned work continues when terminal/browser clients close while the service remains alive.
Reconnecting observes that work without reissuing Start.
Service restart exposes interrupted/uncertain work and never automatically resumes it.
Cancellation and explicit service stop must account for active processes; unconfirmed closure remains unknown rather than successful/canceled-by-assumption.
The service is not automatically enabled at login or started through ordinary extension discovery.

### R8 — Multi-subagent collaboration

Support readable task decomposition, dependencies, multiple subagents, bounded dispatch, individual progress/results and honest parent aggregation.
Independent readonly research/review can run in parallel; working-copy editing is serialized within each checkout across tasks.
The shared owner coordinates children; no recursive/unbounded spawning, autonomous retries or simultaneous supported writers.
Parent cancellation stops further child admission and requests bounded cancellation of active children without hiding partial results or unknown closure.

### R9 — Single-owner personal remote access

The owner can operate from another computer or phone through authenticated secure access.
Multiple devices/tabs are views of one owner, not tenants or independent credential/execution owners.
Local usage remains supported; remote exposure is explicit and never anonymous by default.
Browser access credentials and model-provider credentials remain separate.

### R10 — Reference-style token entry

Provide `?token=...` entry and authenticated subsequent HTTP/WS access, reusing/adapting pi-web-ui's approach without registration or an account database.
Preserve convenient entry while reducing repeated secret-bearing URLs, enforcing remote security and supporting explicit token replacement/invalidation.
A token grants workspace access, not automatic execution.

### R11 — Existing Pi model authentication

Use the selected existing Pi `auth.json`/`models.json` in its normal or explicitly selected agent directory; do not require a second Cadence profile/login for already configured supported providers.
SDK-managed OAuth renewal and credential writeback are approved future runtime behavior using supported coordination.
Keep provider secrets server-side and preserve unrelated credentials.
Do not silently replace corrupt data, copy credentials, create unrelated named-key stores, login/logout, or add browser credential management as incidental reuse side effects.

### R12 — One integrated delivery

All agreed requirements must be implemented and verified together before reporting completion.
No dashboard-only, backend-only, mocked-only or partial child-task milestone satisfies delivery.
Core functionality cannot be moved to a later product release without fresh user agreement.
Completeness does not mean unlimited resources, guarantees unsupported by evidence or whole-app pi-web-ui feature parity.

### R13 — Inspectable execution and durable history

Inspect each agent's recorded task context/messages, tool parameters/results, actual lifecycle timeline, associated change observations and check results rather than only summary cards.
Persist recorded task/run/child history independently of whether a viewer is connected.
Provide paged/lazy detail, search with stable hit navigation, historical visualization and export beyond the recent realtime buffer.
History reads/replay visualizations never execute work, repair transcripts or fabricate missing events.
Clearly report redaction, omissions, unavailable content, truncation and observation gaps; provider credentials/private authentication are never public transcript content.
Resource limits must not silently erase agreed history or masquerade a short preview as the complete record.

### R14 — Operational and distribution completeness

Deliver usable desktop/phone WebUI, terminal controls, explicit service management/diagnostics/manual recovery, installation and operation documentation, license/provenance material and actual packaged assets.
Verify real service/worker/check/terminal/browser boundaries, not only component mocks.
Record actual runtime/platform/provider evidence and honestly label unexecuted qualification; no unattended installation, Git mutation or publication follows from workflow use.

## Acceptance Criteria

- **AC1 / R1, R7:** terminal-only creation → plan → explicit Start → real check → change inspection → human review works without a browser.
- **AC2 / R2, R4:** real child runs produce matching live status/details in both clients; failed, canceled, timeout and unknown remain distinguishable from successful completion.
- **AC3 / R3:** major WebUI features map to directly adapted source families or a documented incompatibility reason; reused source/destination paths, pinned identity, modifications and all required notices are audited.
- **AC4 / R4, R5:** disconnect/reconnect, duplicate/reordered updates and a lost final update recover a consistent view without another launch or invented completion.
- **AC5 / R5, R6:** legacy/unknown state and unrelated dirt are preserved; passive viewing does not create/repair tasks or authorize work.
- **AC6 / R1, R4, R6:** browser task creation, readable plan/decomposition, explicit Start/cancel/check/review all operate against the shared owner; human Done never turns failed/unrun/stale checks into passes.
- **AC7 / R4, R6:** stale or duplicate actions cannot launch duplicate work or apply approval to changed task/plan/cwd/model context.
- **AC8 / R1, R7:** with the service configured, the browser starts work without a live Pi terminal; closing its initiating client does not stop the run, and either client can attach later.
- **AC9 / R5–R7:** service restart presents interrupted/unknown states without relaunch; uncertain surviving processes continue to block unsafe writers until explicit informed resolution.
- **AC10 / R2, R4, R8:** at least two independent readonly assignments overlap in real execution, with visible parent/child identities, assignments, dependencies and results.
- **AC11 / R5, R8:** competing editing assignments in the same checkout serialize across tasks; readonly assignments never receive editing authority merely because their parent is a code task.
- **AC12 / R4, R6, R8:** parent Cancel stops queued admission and requests cancellation of all active children; partial/failed/unknown outcomes remain inspectable and cannot aggregate into all-success.
- **AC13 / R1, R6, R9, R14:** authenticated secure remote operation from a second browser client/phone-sized view exposes usable status, confirmation and cancellation controls without a live terminal; actual physical-device qualification is distinguished from viewport simulation.
- **AC14 / R6, R9:** unauthenticated/unauthorized cross-origin HTTP/WS requests cannot read private task/detail/export data or control execution; public projections omit provider credentials.
- **AC15 / R6, R9, R10:** valid token-link entry establishes subsequent authenticated access without registration; invalid/missing credentials with no valid session refuse, public health/errors never reveal the secret, and documented rotation invalidates old access.
- **AC16 / R3, R5, R11:** an already configured supported provider works without a second login/profile; SDK-coordinated OAuth refresh/writeback preserves unrelated entries, and cancellation/refresh/storage failure cannot launch late work or silently reset/fallback authentication.
- **AC17 / R1–R14:** completion requires all agreed integrated acceptance, including the real distributed package; unexecuted lanes stay explicit rather than becoming assumed passes.
- **AC18 / R2, R13:** long retained messages/tool arguments/results remain inspectable through detail pages beyond preview/realtime-buffer limits, with stable child/tool associations and explicit capture/omission status.
- **AC19 / R4, R5, R13:** after restart, browse/search/open an exact hit beyond the initial page and export selected task/run/child messages, tool details, checks/review and recording-coverage metadata without creating a worker or modifying historical bytes.
- **AC20 / R7, R14:** documented service start/status/stop/diagnostic/manual-recovery behavior is exercised; orderly stop and abrupt crash are distinguished, and install/extension discovery performs no hidden service startup or task execution.
- **AC21 / R5, R13:** recording/storage exhaustion, corruption and denied detail access produce explicit incomplete/refused states; agreed retained history is not silently evicted and unknown legacy resources are not cleaned.
- **AC22 / R3, R12, R14:** actual package extraction contains the complete server/client/worker assets and notices, runs without a source-tree/TypeScript fallback for the service, and preserves independent skills and native terminal regressions.

## Out of Scope

- Multi-user accounts/tenant hosting, anonymous public access and a general-purpose Pi chat replacement.
- Browser shell/PTY, SCM mutation/commit UI, plugin marketplace/dynamic code loading, desktop/Electron application or unrelated SSH/DSH engine parity.
- Concurrent working-copy writers, recursive/unbounded workers, autonomous retry, restart auto-continuation, inferred completion or certified/transactional execution.
- Import/repair/migration/deletion of old consumer history, sessions, locks, databases or uncertain resources.
- Automatic credential copying, unrelated provider-key management, account login/logout or credential exports.
- Unlimited raw capture, guaranteed detection of every business secret, reconstruction of unavailable provider data, universal descendant closure or promises that unexecuted platforms/providers passed.
- Product implementation before final plan approval; actual deployment/credential changes, commit/push/publication without their applicable authorization.

## Planning State

The consolidated product scope is confirmed; there are no remaining blocking product-choice questions.
The final design, mandatory appendices and execution plan have been reviewed and approved for implementation; their current contracts govern W1–W7.
Material changes to the approved scope must return to the user instead of being silently narrowed or expanded.

## Research Index

All reports are source-inspection/planning evidence, not runtime/test qualification.
Current PRD choices supersede earlier minimal-extraction, observation-only, dedicated-profile and staged-MVP recommendations without erasing their factual source evidence.

- `research/cadence-runtime-web-seams.md`: source/test/API anchors, runtime/event gaps, compatibility and package constraints.
- `research/pi-web-ui-reuse.md`: pinned reuse inventory, runtime/security pitfalls and license/dependency obligations.
- `research/independent-service-auth-lifecycle.md`: public SDK routes, auth ownership, lifecycle/crash/check-environment constraints.
- `research/multi-subagent-scheduling-events.md`: finite scheduling, checkout coordination, durable observations, tool events and reconnect.
- `research/pi-web-ui-access-token.md`: exact reference access flow and cookie-first adaptation.
- `research/pi-web-ui-model-auth-reference.md`: actual Pi configuration reuse, OAuth write effects and incidental reference side effects.
- `research/complete-workspace-reuse.md`: substantial UI families, rich history/export gaps and integrated acceptance scenario.
- `research/working-tree-baseline.txt`: pre-implementation dirty-path inventory, not a content backup.

Project-scoped `trellis mem search 'webui'` recovered only this session; it was not an exhaustive search of all prior decisions.
