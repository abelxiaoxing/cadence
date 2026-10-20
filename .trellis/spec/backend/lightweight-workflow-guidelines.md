# Shared Task Workflow

## 1. Scope / Trigger

Explicit native `/cadence` and authenticated WebUI are clients of one persistent owner per canonical checkout.
Ordinary conversation, resource discovery, history viewing and installation never execute work or start a service.
This is direct trusted host-tool work, not an OS sandbox, certified executor, transactional application or universal descendant-closure system.
`TaskController` remains a legacy regression subject, not a reachable/shipped production executor.
See [owner](./service-owner-guidelines.md), [orchestration](./service-orchestration-guidelines.md), [capture/history](./service-history-capture-guidelines.md) and [clients](../frontend/service-client-guidelines.md) for their single-owner contracts.

## 2. Signatures

```ts
// src/native-client.ts
NativeConnection.attach(cwd: string): Promise<ServiceClient>;
NativeConnection.refresh(): Promise<SessionBootstrap>;
NativeConnection.detach(): Promise<void>;
// src/service/task-actions.ts owns current state, not UI-local task inference.
TaskActions.current(input: CurrentRequest, signal?: AbortSignal): CurrentView;
// src/task-store.ts: strict human-readable v1 summaries, not rich history
TaskStore.loadSnapshot(id: string): { record: TaskRecord; identity: string } | undefined;
TaskStore.save(record: TaskRecord, expectedRevision: number,
  held?: CheckoutLock, expectedIdentity?: string): TaskRecord;
// src/subagent-process.ts / src/task-diff.ts
runCheck(check: CheckDefinition, cwd: string, signal: AbortSignal): Promise<RunResult>;
captureChanges(root: string): ChangeView;
```

Use actual installed public Pi declarations for host binding; global docs may describe a different peer.
Owner-side `ModelRuntime.getAuth` resolves selected existing credentials; native clients do not call parent auth, spawn workers or construct SDK inference sessions.
`src/index.ts` registers `/cadence` and independent startup presentation only.

## 3. Contracts

### Native consent and shared authority

`TerminalEntryLatch` accepts actual `onTerminalInput` Enter plus editor text, consumes once within1500ms and rejects bracketed paste/replay.
Admission requires TUI/hasUI, trusted project, idle host, no pending messages/modal and no `CADENCE_SUBAGENT_CHILD=1`.
Session/cwd/epoch/context and selected owner model are rechecked around awaits.
Code Start requires a nonempty readable plan and fresh preview/confirmation; Generate is readonly/advisory and cannot dispatch its proposal.
Research/diagnosis cannot acquire edit/bash/check authority through parent kind, role prose or generated plans.
Opening tasks, exact hits, receipts and reconnect are observations, never Start.

Both clients use shared closed decoders and original IDs; browser authentication is not action consent and a caller's surface label cannot grant native capability.
Normal mutations require independently compiled compatible client/service/assets identities.
Initial owner model is null until explicit exact provider/model/API/thinking selection. 120s single-use grants bind displayed context/action; lost replies are observed through command receipts, never automatically resent with new IDs.
Separate explicit run-ID Cancel remains discoverable even when normal actions are stale/unavailable.
Departure invalidates pending local dialogs/reads and joins attachment release, **not admitted work**.
Absent/unavailable owner gives explicit management guidance without fallback or autostart.

### Selected model/auth and network

Owner prepares each admitted child against its selected existing Pi auth/models files through public SDK APIs with no discovery, login, copying, key-command execution or fallback.
Original OAuth refresh/writeback and its journal settlement remain tracked independently of caller timeout/cancel; late completion cannot spawn canceled work.
Unrelated credentials are preserved; ambiguous storage remains fenced.
Worker auth is literal RAM/anonymous-stdin data, never credential argv/files/browser DTOs.
Resolved baseURL overrides the model URL, resolved headers preserve null suppression, scoped env stays in the resolver rather than process.env.
Custom function transports and ambient credential-file auth refuse; no model/API substitution.

Allowlisted adapters: openai-completions, openai-responses, openai-codex-responses, anthropic-messages, google-generative-ai, mistral-conversations, azure-openai-responses.
SDK worker uses package-relative ordinary JS, in-memory settings/session/credentials and an explicit empty loader; `modelsPath:null`, `allowModelNetwork:false`, `refreshOnCreate:false`, retry/compaction disabled, cacheWarming off and stream maxRetries0.
Verify exact model and effective public thinking getter once before stream wrapping/subscription/READY/prompt; missing/mismatched/throwing values refuse, never clamp/set/retry.
These controls are not a billing/request-count or token-validity guarantee.

One strict `sdk-network.ts` own-descriptor parser governs owner and SDK startup routing.
DIRECT has no proxy capability/dispatcher effect; ambient NODE_OPTIONS alone remains dropped for workers.
Proxy requires exact equal effective HTTP/HTTPS pair, no conflicting cases, ALL/bypass entries or NODE_OPTIONS, and optional opt-in exactly1.
Only bounded credential-free HTTP(S) bare-authority/root URLs are supported: reject userinfo, percent-bearing authority, query/fragment, hidden normalization paths, controls, backslashes and invalid ports.
No URL normalization into equality, scoped-only promotion, guessed runtime, fallback, install or TLS override.
Capability uses actual Node identity and public allowedNodeEnvironmentFlags `--use-env-proxy`, not a numeric eligibility heuristic.
Capture/serialize/revalidate selected ambient/scoped facts before one launch; compatible auth.env route entries remain literal stdin only.
Only worker startup env adds validated uppercase pair/opt-in to the narrow allowlist.
Post-SDK-import public EnvHttpProxyAgent installation/getter identity and original owned close are separately necessary for configured routing.
No private SDK imports, global fetch/WebSocket replacement or `undici.install()`.
Native/management local-capability traffic uses direct owned networking and cannot traverse provider proxies.
Retain route literal only in RAM redaction inputs, never hashes/persistence/logs.

### Native process, checks and review

General worker env is PATH, HOME, USERPROFILE, SystemRoot, WINDIR, COMSPEC, TMP/TEMP/TMPDIR, LANG/LC_ALL and PATHEXT plus child guard/offline/no-color.
No provider secrets, NODE_OPTIONS or session/control IDs leak from ambient env.
Absent process input uses ignored EOF; explicit empty/nonempty payload uses a strict pipe.
Required stdin failure overrides valid final/native zero; original close, not exit or process disappearance, owns settlement.
TERM escalates after1000ms; unconfirmed close after3000ms remains unknown/fenced.
POSIX signals owned group, Windows direct child; direct close never proves escaped descendants stopped.
Service capture uses mandatory worker v2 and the richer limits in [capture/history](./service-history-capture-guidelines.md), not legacy ready/tool/final-only history.
Legacy `runWorker` controls remain regression intent, not the production owner protocol.

`CheckDefinition` is exact name/command/timeout; configured obligations match all three, not just names or recorded runs.
Checks use the frozen service-launch ordinary environment, stripped of service/access/control secrets, never resolved model auth or browser overlays.
Browser checks are exact configured selections; Manual requires native local capability, displayed command/cwd/timeout and fresh confirmation.
Windows check-only CMD arguments are `/d /s /c` plus one outer quote pair and windowsVerbatimArguments; do not apply that to SDK/direct Node launches.
Code checks take exclusive checkout access after parent drain.
Changed-during-check input is stale even at exit0; preserve native exit independently of runner/capture outcome.
Review recaptures fingerprint under the owner barrier and requires issues acknowledgment for incomplete observation, missing/not-run/failed/stale/canceled checks or partial execution.
Human Done never changes execution/check outcomes or grants another run.

`ChangeView` is bounded readonly observation of staged/unstaged/untracked and existing dirt, with raw-byte fingerprints and sanitized display.
Disable Git external diff/textconv, strip inherited GIT_* and set GIT_OPTIONAL_LOCKS=0.
Remove only Git's output terminator from filesystem identity, never trim path whitespace.
Submodule/ignored/unreadable/linked/oversized content and exhausted bounds limit coverage explicitly.
Existing observation limits remain3s, Git512KiB,2000 entries,1MiB/file,8MiB aggregate, non-Git depth16 and rendered128KiB.
Task administrative metadata is excluded from business freshness; check configuration is not.
No fingerprint is hostile-writer CAS or complete change-and-revert detection.

## 4. Validation & Error Matrix

| Boundary                                     | Required outcome                                                  |
| -------------------------------------------- | ----------------------------------------------------------------- |
| Synthetic/nonterminal/busy/untrusted entry   | No native attachment authority, execution or owner startup        |
| No owner/model, incompatible build           | Explicit unavailable; no local executor or model fallback         |
| Empty plan, stale/raw-byte changed context   | Refuse; fresh action required                                     |
| Client departure after accepted Start        | Detach, preserve same owner/run; no implicit Cancel/replay        |
| Unsupported/changed route/auth/thinking      | Fixed no-launch refusal; no credential/route exception disclosure |
| Native zero with bad stdin/final/cleanup     | Preserve native fact; workflow cannot become completed            |
| Unconfirmed child/auth/storage settlement    | Unknown/quarantined; retain original promises and fences          |
| Failed/unrun/stale check or incomplete diff  | Explicit human issues acknowledgment, never fabricated check PASS |
| Reconnect/history/export/recovery inspection | Readonly; no worker, refresh, migration, repair or deletion       |

## 5. Good / Base / Bad Cases

Good: native or browser previews a saved graph, explicitly Starts, observes genuine children, confirms real checks and records review.
Base: Pi quits while a child is pending; another client attaches to the same run and explicitly Cancels.
Bad: instantiate TaskController when the service is absent, infer completion from prose, or use old confirmation after reconnect.

## 6. Tests Required

`lightweight-shell` retains native latch/trust/idle/replay/context negatives through production registration with a fake host.
`native-client` exercises real generated owner, direct local capability, exact check identities and six complete scope/format exports.
`service-accepting-host`, `service-accepted-work`, `service-orchestration` retain durable action/model/check/review/cancel/Stop integration.
`lightweight-process-diff` and `lightweight-sdk` retain actual stdin/native close/env/route/thinking/tool-cycle and redaction controls; label injected faults separately.
`terminal-integration` uses source/extracted regular/fullscreen actual Pi PTYs with parsed HTTP4 pending, departure/quit, same-run reattachment, explicit Cancel and original waits.
`test/web/*.e2e.mjs` is the dedicated real built-browser route; fake-host/unit counts cannot qualify it.
See [quality](./quality-guidelines.md) for unchanged budgets and additional unqualified platform/provider/human lanes.

## 7. Wrong vs Correct

Wrong: `task.checks.every(c => c.status === "passed")` proves all configured checks ran.
Correct: match name, command and timeout against every current definition; not-run is a projected obligation, never a fabricated execution record.
Wrong: a timeout wrapper releases the original resource or a closed browser cancels a run.
Correct: retain original worker/auth/storage/close accounting; only explicit Cancel/Stop requests bounded stop, and unknown remains fenced.
