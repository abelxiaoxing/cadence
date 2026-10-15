# Lightweight Cadence — implementation design

## Approved model and source evidence

The user approved `research/trellis-inspired-simplification-proposal.md`. `prd.md` now owns the lightweight requirements. This design deliberately replaces the previous proof system, not its consumer data. Borrow ideas, not AGPL source. Current reports: `lightweight-host-design.md`, `lightweight-auth-runner-decision.md`, `lightweight-retirement-design.md` and its inventory. The auth decision supersedes the earlier host report's unnecessary ephemeral-auth limitation.

Use actual installed Pi public APIs/types and official docs/examples. Local peer0.84.3/global docs1.1.0 are inspected identities, never release eligibility. Runtime capability failures stay explicit. No private `modelRegistry.runtime` cast, CLI startup housekeeping, automatic dependency download or alternate executor.

## Small module closure

Reuse/replace existing owners instead of adding a framework:

- `index.ts` → rewritten `task-shell.ts`: sole native UI facade and existing startup card.
- `task-controller.ts`: one foreground task action, phases/generation/consent/result/check freshness; no Pi imports.
- `task-store.ts` + new `task-types.ts`: bounded plain records, short atomic updates and one checkout coordination lock.
- `subagent-process.ts` + new `sdk-worker.mjs`: one child/check process path, bounded framing/output/cancel; actual SDK child only for agents.
- new `task-diff.ts`: readonly Git or explicit bounded non-Git observations.
- `agent-registry.ts`, `verification-diagnostics.ts`: small fixed-role loader and pure safe diagnostics, no old retention/contracts imports.
- rewritten readonly `operator-tools.ts`, `operator-cli-entry.mjs`, generated `operator-cli.mjs`.
- unchanged `startup-card.ts`, `install-config.mjs`, declaration and independent skills/config helpers.

Expected16 source files/34 base regular archive members: the retirement proposal's15/33 plus `sdk-worker.mjs`. Review any necessary delta explicitly. Retire the other93 source owners and their unused generated workspace worker; no compatibility imports or old scheduler behind the new UI. Canonically build only the operator. The SDK worker is ordinary maintained JavaScript runnable from installed node_modules; no TS loader fallback.

## Task data and files

Use project records under a new, unambiguous namespace: `<workspace>/.cadence/assistant/tasks/<uuid>/task.json` with magic/schema `cadence-workflow-assistant/1`. Keep a small readable plan and result, either in the bounded record or fixed sibling Markdown files; one record is the operational source of truth, no multi-file transaction. Prefer bounded record-contained plan/result initially to avoid needless synchronization. Save user goal, kind, phase, plan, latest agent summary, check metadata, review freshness and bounded activity. No full transcript, credentials, raw auth or raw command output in project records.

Private `<state-home>/cadence-assistant-v1/<checkout-hash>/` holds bounded sanitized output logs and the new coordination lock. State-home follows explicit XDG/platform conventions; actual target cwd comes from Pi. The hash identifies a canonical checkout, not executable/permission attestation. Root/project resolution is explicit and readonly; use actual Git worktree root when available for coordination/diff, retaining the invocation cwd for commands. Non-Git falls back to the actual canonical cwd, not a guessed project.

List/load/doctor never create missing state. Validate bounded known format, UUID/path containment, regular files and managed ancestors; linked/unknown/corrupt data refuses without resetting it. Use atomic temp+rename for a single record, with expected revision and a short coordination lock for updates. No durable multi-file/crash-proof publication claim. Preserve failed temporary data rather than recursively cleaning user paths.

One exclusive checkout lock covers an active child/check and prevents another supported Cadence writer. Record parent PID/run ID and private token; only its owner releases it normally. Do not steal a live/ambiguous lock. A dead-host stale lock requires explicit informed terminal recovery, exact unchanged lock identity and acknowledgment that escaped processes may remain; this only clears NEW coordination metadata, never old runtime locks/material or claims original closure. Until confirmed recovery, unknown termination blocks another writer.

Never open/migrate/reset legacy Cadence SQLite. Do not parse old approval into new consent. An explanatory history notice and preserved files suffice; a second legacy executor/importer is out of scope. The UI warns users to stop older Cadence sessions before new editing; cross-version/raw external writers are not contained. Unknown old resources are not declared settled or cleaned.

## Controller and consent

Kinds: code/research/diagnosis. Small states: planning, running, review, interrupted, failed, done (exact names may be adjusted consistently). Done means human-reviewed workflow outcome, not certified code. Check status remains passed/failed/canceled/not-run/stale separately; a human accepting unresolved checks must see and explicitly acknowledge that label. Never turn failed/unrun checks green.

Create/Open are observations/planning actions. Code Start requires nonempty readable plan and a current terminal confirmation. A generation plus task revision/plan comparison rejects late/stale choices; no cryptographic receipt registry. Save/Edit invalidates previous check/review freshness. Continue is a NEW explicit run from current goal/plan/files and prior concise outcome, not checkpoint replay. No automatic retries or execution on reload/open.

Only one Cadence-owned editing run is active per checkout. Readonly planning/research/diagnosis also use the foreground controller, with fixed read/grep/find/ls tools. Code workers use ordinary Pi editing tools, including bash where needed, under explicit user consent and package instructions against Git mutation/install/cleanup. These are trusted-agent workflow rules and host tools, NOT filesystem confinement. External editors/extensions and hostile same-user code are outside this coordination guarantee.

Record intended action before spawn, and truthful result after settlement. Capture baseline dirt before a worker; show changes after success, failure or cancellation. No automatic application, compensation, rollback, commit, install or knowledge publication.

## Host binding and UI

Use native `registerCommand`, select/input/editor/confirm/custom components and current `ctx.cwd`, mode/UI/idle/queue/trust/model/session identity. Require terminal mode and fresh explicit terminal interaction; no model-callable task tool or RPC controller. `input` events occur after command dispatch, so use a SMALL transient raw-Enter latch from `ctx.ui.onTerminalInput`/editor contents where the host supplies it; consume once, invalidate on other input/session departure, do not arm on paste events. `/cadence <request>` only prefills creation. No opaque approval framework.

Use an ordinary menu → plan editor/review → confirmation → foreground cancellable progress screen → result/check/diff review. Prefer Pi primitives; one small width-safe pager/progress component if needed, with keyboard scrolling, Escape, resize and regular/fullscreen support. Preserve complete available material or visibly mark truncation; never silently treat an incomplete display as a machine verification result.

Keep a pure generation/current-context check around UI awaits and before actions. While the modal run is active, parent input/tool/user-bash hooks prevent accidental overlapping host work; outside it hooks are inert. Session navigation cancels and waits boundedly; cancellable navigation may refuse while stopping. Shutdown aborts and records interruption, without claiming universal descendant closure. Do not keep a hidden background executor.

## Model/auth and actual SDK child

Use one independently implemented SDK child, not Pi CLI main (which performs startup migrations/cleanup). Parent resolves the exact current model and public `modelRegistry.getApiKeyAndHeaders(model)` before launch. Parent auth refresh is normal host behavior. Resolve/cancel asynchronously with a post-resolution generation/signal check so late auth can never spawn after cancellation.

Send a bounded model/auth/prompt/role envelope over anonymous stdin, never secret argv/files/logs. Use safe inherited environment without exporting resolved credentials; provider-scoped auth env stays in the resolver. Strip inherited control/session IDs and set child/offline guards. Keep known secrets available only to in-memory output redaction, never task persistence. Unsupported function-defined provider transports fail explicitly rather than silently selecting a standard implementation.

Child creates public `ModelRuntime` with in-memory credential/model stores, modelsPath null, no initial/model network refresh; in-memory settings/session, no compaction/retry and an explicit empty ResourceLoader. Register one native provider using official fixed-allowlisted API adapter plus a local resolver returning the exact resolved parent request auth. This uniform route must be tested for normal keys, literal headers and OAuth-only API preflight; it is source-supported but the prior wire probe executed only ordinary-key forwarding. Never feed resolved key/header values into dynamic config interpolation (`!` commands/`$` substitutions). No private SDK casts or new dependencies.

Fixed role text plus bounded approved goal/plan and selected project conventions seed the child, not entire chat/history or arbitrary private files. Subscribe before prompt. Emit only bounded lifecycle/tool-name/progress/final frames; no raw tool payloads/thinking/auth. Successful worker result requires normal child close and a valid final non-error/non-aborted message after actual prompt settlement. Exit0/agent prose is not correctness. Missing/malformed/overflow/length-only termination is failed/incomplete.

Keep bounded output/line/event counts, worker timeout and cancellation escalation. POSIX can signal its process group; Windows direct-child cancellation is explicitly weaker, with no shipped Job helper guarantee. Observe direct-child close, wait boundedly, and preserve unknown status/lock when not confirmed. No process disappearance or later inspection is turned into original-family proof.

## Checks and diff

Check definitions are user/project configuration or manually entered terminal commands, never executable model suggestions by default. Show exact command/cwd/timeout and confirm before execution. A small explicit shell runner (`/bin/sh -c`, Windows command processor with AutoRun disabled) is acceptable for user-approved command strings; do not interpolate task titles/paths into commands. Parent records actual exit/duration/bounded sanitized output. No automatic install or Git operation is inserted. Model-origin shell actions remain ordinary trusted-agent actions, not passing parent checks.

Capture review fingerprint before/after checks and before Done. Git review observes staged and unstaged patches separately, untracked paths/content identities, deletions/renames/modes/binaries and baseline dirt; disable external diff/textconv and perform no Git mutation. Exclude only Cadence's explicit own metadata from business freshness while visibly accounting for administrative changes. Truncated/ignored/unreadable coverage is explicit. Do not send entire dirty/untracked content or secrets to the model automatically.

Non-Git uses bounded regular-file inventory with explicit exclusions/limits and additions/deletions; label what was not inspected. It is not a sandbox or transactional snapshot. A changed review/check input makes prior results stale. If coverage/checks are incomplete, human acceptance must explicitly remain reviewed-with-issues/unverified rather than green verification.

## Retirement, compatibility and validation

`lightweight-retirement-inventory.json` supplies hashed source/test dispositions. Retire compiler/scheduler/seal/transaction/native-isolation/old-helper contracts; port still-useful entry, privacy, cancellation, data preservation, dirty diff, actual command and packaging assertions before deleting their old suites. Keep all preimages and original failed evidence. No default old certification tests remain merely to demand guarantees the user explicitly dropped, and no broad deletion becomes proof of success.

New validation: fast deterministic controller/store/consent tests; real SDK child against local synthetic HTTP provider; actual process/cancel/output/lock/filesystem/diff/check cases; source/extracted production entry, exact reviewed34-member archive/pins, readonly operator and regular/fullscreen PTYs. Real integration budgets may be longer than controller tests; old engine5000-ms gates are superseded, not raised into passes. Keep version-neutral OS jobs for actual new capabilities; retire MSVC/Job/Bubblewrap obligations belonging solely to removed runtime, without claiming those historical lanes passed. Missing native Windows/macOS and human/provider loops remain visible release limits.

Rollback means stop the new action, preserve direct edits and records and restore source from development preimages if needed. It does not reset consumer history, replay an old executor or apply a compensating patch automatically.
