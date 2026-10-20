# Service/control/auth contract — design recommendation

**Planning recommendation, not implementation approval or executed evidence.**
The rewritten PRD's complete integrated scope supersedes older reports' MVP, readonly-auth and terminal-owner alternatives.
Active task was confirmed by `task.py current --source`; all seven existing Markdown research reports and relevant maintained storage/workflow/distribution specs were read.
Only this research artifact is written; no installs, tests, services, providers, credential files, task activation or Git mutations were used.
Main session owns authoritative `design.md` / `implement.md`.

## 1. Selected architecture, paths and operating interface

- One explicit, long-lived **execution owner per canonical checkout**, with task-local state rather than a globally selected task.
  Native `/cadence` and browser are clients; neither creates an independent SDK executor.
  Closing either client detaches observation, not work.
  Service restart never resumes admitted queues or workers.
- Implement `src/service/{cli,owner,protocol,http,auth,admission,receipts,model-runtime,coordination,recovery}.ts`, compiled to `dist/service/*.js`; package bin `cadence-service` points to `dist/service/cli.js`.
  Use Node HTTP plus `ws`, adapting upstream middleware/cookie/upgrade/reconciliation families rather than importing its general chat server.
  No runtime TypeScript fallback.
  Worker launch remains a single owner-internal route adapted from `runWorker` / `runCheck`.
- `cadence-service start --workspace <path> --config <absolute-file>` validates and starts a detached owner with ignored terminal stdin and private bounded logs; it waits at most 10s for authenticated readiness, then reports actual state or `startup-unconfirmed`, never kills/relaunches on timeout.
  `--foreground` supports explicit process-supervisor operation; supplied examples have automatic restart/login enablement **off**.
  Installation/discovery never starts it.
- `status [--json]` performs bounded authenticated owner inquiry plus readonly registration/receipt inspection; absent means absent, unreachable means unavailable, not dead. `stop` requests quiesce/cancellation and waits up to 60s; it does not mean `kill(pid)`. `diagnose` emits redacted paths, generations, runtime identities, lock/quarantine/receipt/recording health, never environment values or credentials. `recover inspect` and `recover resolve` are local-only (§8). `token-link` and `token-rotate` are explicit local administration, not task execution.
- Default HTTP listener is `127.0.0.1:17423`; occupied port refuses instead of selecting a hidden alternative.
  Port override is explicit and registered.
  No browser required for terminal-only operation.
  If the owner is absent/incompatible, `/cadence` explains the exact start command and stays observational; **no embedded executor or automatic service-start fallback**.
- Preserve native raw-entry latch, trust/idle checks, readable plan pager and fresh Start/check/review confirmations in the terminal adapter.
  Navigation/model selection invalidates local dialogs but cannot change a frozen run.
  Escape offers explicit Cancel versus detach; disposing progress only detaches.
  No service session is created through RPC/print-mode `/cadence` or a model-callable tool.
- Readonly `src/operator-cli.mjs doctor|runs` stays readonly and backward-compatible.
  Service-aware live inspection belongs to the new client/CLI.
  Ordinary conversations/independent skills remain independent; scoped busy guards while explicitly attached must not silently activate Cadence for other conversations.
  Other editors/unmodified Pi instances remain outside coordination.

## 2. Canonical registration, storage and writer exclusion

- Resolve the physical cwd/Git worktree root with existing `resolveWorkspace`, preserving path bytes and removing inherited Git overrides for observations.
  Use canonical root plus filesystem identity where available, not branch name/cwd spelling.
  Reject overlapping registered non-Git roots, nested checkouts and aliases that would create overlapping supported writers; separate nonoverlapping worktrees may have separate owners.
- Add a **per-OS-user registry at a fixed OS-account-home location**, independent of caller `HOME`/`USERPROFILE` and `XDG_STATE_HOME`/`LOCALAPPDATA` overrides: `~/.local/state/cadence-assistant-v1/service-registry-v1` (Windows: `~/AppData/Local/cadence-assistant-v1/service-registry-v1`).
  Resolve the account home from the OS identity, not arbitrary process environment.
  Registration pins root identity, selected legacy state-home, service data path and endpoint; supported operation uses one OS account, not competing users sharing a checkout.
  A short exclusive registry mutation lock serializes overlap/registration decisions; its uncertain ownership is not expired by time or PID disappearance.
  Different state-home requests for an already registered root refuse, not create a second domain.
- Service-owned data lives at `<selected-state-home>/cadence-assistant-v1/<root-hash>/service-v1/`; strict owned manifests, 0700 directories / 0600 files on POSIX, equivalent qualified ACL policy on Windows.
  Selected unsafe links, foreign ownership, unknown schemas or excessive bounds refuse.
  New service directories must be absent or have a matching owned manifest; never adopt arbitrary existing material.
- On normal start acquire a service owner lock **and the unchanged v1 `checkout.lock` for the entire service lifetime**, including idle time. v1 token/pid/host/runId/root encoding stays intact.
  This intentionally blocks existing supported v1 writers using the same state-home while the service owns the checkout; service metadata saves reuse the held lock.
  Registry registration persists across clean stop; lifetime locks are released only after known safe settlement.
- Inside the owner use a fair readers/writer gate across all tasks: at most two readonly assignments overlap; editing assignments and real shell checks take exclusive access for their entire preparing/running/closing interval.
  A waiting writer bars later readers.
  Default ceilings: 8 admitted episodes, 16 assignments/episode, 128 queued assignments, 2 active/preparing children total; unknown closure retains its reservation and quarantines the checkout.
  No recursive spawning or autonomous retry.
- Old binaries using different state-homes or their old PID-only recovery are **not compatible live controllers**.
  Document that users must stop these before service operation; the service cannot make them understand new quarantine.
  Preserve old locks/history unchanged; an unrecognized legacy lock blocks new startup/control and is not a target for new `recover`.
- Strict task v1 remains unchanged: no new keys, non-UUID entries under `tasks/`, or siblings beside `task.json`.
  Previously existing tasks are view-only legacy context; continuing work creates a new task with explicitly selected context, not imported approvals/detail or an automatic migration.
  New tasks can retain v1 human-readable summaries with service-v1 authoritative run/receipt/history records outside the checkout; failed summary publication is visible and never repaired on read/restart.
- This is supported-writer coordination, not a sandbox or universal filesystem lock.
  Other processes can edit or escape process groups.
  Retain bounded before/after observations, baseline dirt, cross-task stale checks/review and explicit incomplete coverage; identical fingerprints do not certify immutable inputs.

## 3. Root runtime configuration and model/auth boundary

- One local, owner-selected private config (`schema: cadence-service-config/1`, max 64KiB) binds canonical root, allowed execution cwd IDs, agentDir, exact allowed provider/model/API/thinking selections, runtime module root, listener/public-origin/proxy policy, check-environment policy and resource ceilings.
  Config is local-operator-managed; browser cannot set filesystem paths, environment, SDK roots, endpoint credentials or discovery.
  No root config is written into the strict existing check config.
- First setup defaults `agentDir` to public `getAgentDir()` (normal Pi directory or its explicit environment override), then pins the canonical path; explicit `--agent-dir` can override at setup.
  Use the existing `<agentDir>/auth.json` and `models.json`; **no second profile/login, copy, named-key store or browser provider management**.
  Missing optional models.json means bundled models, but explicit selected custom-model absence refuses; missing auth.json never gets initialized as an incidental read.
- Resolve SDK peers from the installed package's public package resolution, or one explicitly configured SDK module root shared by owner and worker; never guess/search global directories, auto-install or bundle duplicate Pi registries.
  Recommend a development/qualification baseline of **SDK/AI 1.2.0 and Node >=22.19**, with actual public-capability/behavior checks and recorded identities, not a claim that every version above a number works.
  Keep Pi peers host-provided; existing 0.84.3 auth behavior is not silently substituted.
- Construct one shared root `ModelRuntime.create({authPath, modelsPath, modelsStore: new InMemoryModelsStore(), allowModelNetwork:false, refreshOnCreate:false})` after explicit start/config validation, not on attach/history.
  This is model/auth infrastructure, not a parent `AgentSession`.
  No settings/resource loader, MCP, provider extension, catalog fetch, login/logout or configured key command is loaded by this service path.
  `getError()` is a refusal gate; exact `getModel(provider,id)` selection cannot fall back to another model.
- Prevalidate selected existing auth/models files with bounded descriptor reads (recommend 1MiB each), regular-file/private-path hygiene, JSON object/schema validation and safe supported expressions before SDK construction/admission.
  Default file storage can create a missing file and keep an old in-memory snapshot after some errors; therefore prevalidation plus explicit-signal auth calls and postchecks are mandatory, not an assumption that SDK reads fail closed.
  Refuse corrupt/denied/changed-to-missing data; never replace with `{}`.
  These guards cover supported cooperative writers, not hostile same-user change-and-revert/TOCTOU; qualify that limitation rather than claiming a credential-file CAS.
- Supported baseline: current seven official worker adapters, static built-in/configured chat models, saved literal API keys and normal saved OAuth.
  `models.json` literal and named environment interpolation may be used only from the pinned operator environment, with exact source shown.
  Reject leading key/header `!command`, extension-defined/function/virtual transports, ambient cloud files and unspecified credential sources; explain unsupported configuration rather than demanding another login or trying an alternate source.
  A full normal-Pi configuration is not a promise of every Pi feature's compatibility.
- Admission binds a secret-free `ModelSnapshot` (provider/model/API/thinking, runtime/config generation, route identity, credential-source kind and an opaque server-owned credential selection revision).
  Keep raw auth, headers, model-config secret fields and any secret-derived digest off all public DTOs/history.
  Revalidate model metadata/config bytes and selected source immediately before every child; no auth resolution during preflight, listing, reconnect or export.
- Resolve auth **at each actual child admission**, not once for a queued graph: `runtime.getAuth(model,{signal: authOperationSignal,minOAuthValidityMs: childBudgetMs + 120000})`, default child budget 20min.
  Use a real nonaborted service-owned signal so storage errors are not intentionally served from best-effort cached reads.
  Validate post-resolution selected stored credential/config and adapter requirements before passing the literal result through bounded anonymous stdin; never put it in argv, transcript, files or check env.
  If refreshed OAuth cannot cover that validity window, refuse; no promise of validity or mid-child refresh, no reduced-budget fallback.
- Before SDK construction/auth, wait boundedly for any existing Pi auth lock to disappear; do not manually expire/reclaim it.
  A stale/ambiguous lock or unsupported SDK coordination behavior refuses.
  The SDK uses `proper-lockfile`, whose documented lease/reclamation policy is **not** suitable for Cadence checkout locks; cross-process refresh must be qualified against the selected Pi implementation, including lock compromise.
  No second independent credential lock is claimed to coordinate with Pi.
- **Cancellation accounting:** action cancellation stops waiting/admission, but does not abort an already-started credential refresh/persistence.
  Retain the original getAuth promise in an auth-inflight registry; no late worker can launch after cancellation/30s admission deadline.
  Serialize Cadence auth preparations per selected auth path; other Pi owners coordinate through the SDK's credential-store lock.
  Once started, let SDK renewal/writeback finish and account for it at stop; do not call a nonexistent public `ModelRuntime.dispose()`/auth `waitForIdle()`.
- SDK 1.2.0 refresh uses a 15s provider deadline and detaches started renewal from caller cancellation; file lock acquisition can take ~30s.
  A 60s owner stop budget accommodates the normal envelope but is not a hard proof of completion.
  If auth remains unresolved, leave service `stopping/credential-uncertain`, block admission, and require informed forced shutdown/recovery; a timed-out caller is not proof no token rotated.
- Normal OAuth rotation within the same selected provider/source and approved SDK policy does not invalidate the plan.
  A changed key/type/account identity where available, login/logout, selected model/config change, or unexplained auth-file change observed before resolution requires new preflight; legitimate cross-process SDK rotation may be accepted as token renewal, not as byte-identical auth.
  Account identity is provider-dependent: do not invent universal account-binding proof from opaque credentials.
  In-flight unexpected replacement refuses.
  Preserve unrelated credential entries semantically; SDK refresh can reserialize auth.json, so do not promise byte preservation of that explicitly writable file.
- Refresh/store/network failure yields fixed sanitized auth refusal, no ambient/key/model fallback or automatic retry.
  Disk failure/crash after remote rotation is credential uncertainty, not rollback; no automatic re-login/reset.
  Default SDK store's lock/writeback supplies the approved coordination, but not a transactional credential vault or coordination with arbitrary manual editors.
  Never inspect private SDK internals to implement a replacement auth subsystem.

## 4. Service environment and checks

- Capture the explicit launcher's **ordinary project environment once in owner memory**; call it `service-launch-environment/<epoch>`.
  Strip service access/proxy secrets and control/session markers before checks; never merge resolved model auth into it.
  Preserve ordinary project variables (which may intentionally contain project credentials), PATH and approved shell behavior.
  Display environment policy ID/epoch and shell identity, not values; it is not the later client's shell or a persisted secret dump.
  Restart creates a new environment generation and invalidates grants.
- Config can add an explicitly reviewed local environment file; it is private, bounded, parsed as data, never shell-sourced, and frozen on startup.
  Browser/native task actions cannot upload environment overlays.
  Service itself and host tools run as the operator OS user: hiding tokens from DTOs does not protect files from that user/tools.
- Read existing `.cadence/assistant/config.json` using its strict decoder.
  Both clients select configured check IDs; server binds exact name/command/timeout/cwd/config identity and displays them for fresh confirmation.
  Browser receives no general shell/PTY or arbitrary command endpoint.
  Preserve a separately confirmed **native-local-only manual check** (default 120s); capability comes from authenticated local transport, never `surface:"terminal"` supplied by a browser.
- Checks take the same exclusive checkout lane as editing, inherit documented environment with child guard, and preserve `/bin/sh -c` / Windows CMD quoting and actual native close/exit facts.
  No checks for readonly tasks, no generated-plan check escalation.
  Before/after observations and current check definitions determine stale/not-run coverage independently of execution outcome; human Done records issues rather than turning them into passes.
- Preserve the existing narrow SDK-worker environment/proxy validation, separate from checks and browser reverse proxy.
  OAuth renewal networking belongs to the service's reviewed outbound environment and needs its own qualification; an inbound HTTPS proxy says nothing about provider routing.
  Unsupported outbound proxy/runtime configuration refuses without direct-route fallback.

## 5. Browser admission, sessions, Host/Origin and TLS policy

- Mandatory owner access token even on loopback: generate **32 random bytes, canonical unpadded base64url (43 chars)**; no human-chosen passwords.
  Store token, generation and independent 32-byte cookie signing key in one atomic private credential file outside checkout; default token lifetime **30 days**, warning within 7 days.
  Missing token on first explicit start may create it; corrupt/expired existing token never regenerates automatically.
  `token-link` reads it only after explicit local invocation and displays only to an attached TTY, not default startup/status/log output.
- Adapt upstream `server/index.ts` token extraction/digest comparison/HTTP middleware/pre-upgrade checks and `server/auth-cookie.ts`, pinned at `e8bab487af208bc9a1ab60a821652323f598127f`, into `src/service/auth.ts` + `http.ts`; retain upstream full MIT notice/copyright and provenance.
  Replace optional-token, permissive Host/forwarded-TLS and raw-token-cookie defaults.
  Adapt `web/src/auth-token.ts` to clean-cookie navigation; remove token localStorage and `withToken()` URL reinsertion.
- Only `GET /?token=<single-valid-token>` accepts query credentials; require top-level document navigation when Fetch Metadata is present, no duplicate/oversized fields, and never accept token query on API/WS/assets.
  Constant-time compare fixed-size digests.
  Successful entry sets an authenticated cookie and **303 redirects to `/` before any application resources load**; optional deep linking happens later via token-free app navigation.
  Invalid explicit query token returns generic 401 even if another cookie is valid; no ambiguous “any credential wins.”
  No query token in errors, request logs, analytics, referer or redirect Location.
  Clean `GET /` may serve an unprivileged entry shell with no workspace data; it checks `/api/v1/session` after navigation before loading the workspace, so a cross-site redirect chain suppressing a Strict cookie does not lose an otherwise established session.
- Cookie is a signed bounded session value, **not the owner token**: `{v,workspaceId,tokenGeneration,issuedAt,expiresAt,nonce}` plus HMAC-SHA256.
  Max lifetime **12h absolute**, non-sliding, capped by token expiry; no user/account database.
  Remote cookie `__Host-cadence_session` has `Secure; HttpOnly; SameSite=Strict; Path=/`, no Domain.
  Explicit loopback HTTP uses `cadence_local_session` without Secure; it is never accepted on the remote authority.
  A separate RAM-only CSRF value is derived/bound to that session and returned by authenticated `GET /api/v1/session`.
- Every authenticated HTTP request validates signature, root, generation and expiry; browser mutations additionally require matching Origin and `X-Cadence-CSRF`.
  Browser GETs may omit Origin, but reject supplied foreign/null Origin and `Sec-Fetch-Site: cross-site`; the top-level token-entry route is the deliberate cross-site-navigation exception.
  No CORS allowance, no cookie credentials in cross-origin APIs; reject OPTIONS mutation preflight.
  SameSite alone is not the CSRF mechanism.
- Native/CLI client uses a **separate per-boot 32-byte local capability** in `Authorization: CadenceLocal <value>`, read from the private service registration file, only on the direct loopback authority with no Origin/forwarding headers; reject multiple credential methods.
  It expires with the owner epoch and is never included in token links/browser sessions.
  This keeps local stop/rotation available after browser-token expiry.
  Native task access still needs context-bound action grants.
  Browser requests with Origin never gain native/manual-check capability from that header.
  HTTP/WS request body/frame runtime validation is mandatory, not a TypeScript cast.
- **Host rule:** exact allowlist per transport: configured loopback authority (default `127.0.0.1:17423`) and, only in remote mode, exactly one configured `https://host[:port]` public origin, root path only.
  Validate one raw Host, legal DNS/IP/port, effective port, no userinfo/control/backslash/comma/trailing-dot ambiguity or wildcard/private-LAN shortcut; absolute-form URL authority must match or refuse.
  Compare normalized host case/default port only, not scheme-stripped authority.
  Possessing a valid token never bypasses Host validation.
- **Origin rule:** browser mutation and WS require one exact scheme-aware origin equal to that request's approved public or loopback origin; reject `null`, multiple values and missing browser WS Origin.
  Direct native local-capability WS may omit Origin.
  An HTTP foreign Origin is forbidden even with valid auth.
  Frame/body controls are HTTP only; WS accepts bounded subscribe/resync/ping messages, never Start/check/review.
- **TLS/proxy rule:** listener remains loopback; direct non-loopback bind is unsupported by this default contract.
  Remote requests must arrive from an explicitly configured immediate proxy IP (default only `127.0.0.1`, never CIDR `0.0.0.0/0`) **and** carry a separate random `X-Cadence-Proxy-Key`, exact public Host and exactly `X-Forwarded-Proto: https`.
  Proxy strips incoming forwarding/proxy-key headers and overwrites them.
  Reject other Forwarded/X-Forwarded-* authority chains or duplicate/comma values; do not infer TLS from an arbitrary header.
  Normalize mapped socket addresses before exact peer comparison.
  Direct local requests bearing forwarding headers refuse.
- Remote deployment path: manually configure a same-machine TLS reverse proxy (Caddy recommended operational example) for one owner-controlled hostname/certificate; it forwards HTTP and WS to the loopback port, preserves the configured Host, installs the private proxy-key header and sole HTTPS assertion, and disables/redacts query/Cookie/Authorization/proxy-key logging.
  Expose only proxy TCP443 via explicit firewall/VPN setup; backend port stays private.
  Plain HTTP public entry refuses **without redirecting a token-bearing URL**.
  A private-network HTTPS hostname is sufficient; no anonymous public listener/account service is required.
- Auth responses/API/detail/export use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`; browser shell uses CSP self-only scripts/connect, no framing (`frame-ancestors 'none'`), no third-party scripts/images by default.
  Local assets are bundled.
  Initial token URLs can still reach browser history/clipboard and external proxy logs: document residual exposure, never claim redirect erases it.
- `token-rotate` atomically replaces token/signing key and increments generation; invalidates preflights, closes authenticated WS immediately, and invalidates every old cookie/token link on next request.
  The local admin capability stays usable, but native preflights are invalidated too.
  With no owner running, explicit local rotation can update only its known access file after exclusive registration/ownership checks; ambiguous ownership refuses, not force-rotates.
  Expiry checks run on every HTTP request and at least every 30s on WS; no eternal upgraded connection.
  Rotation/expiry revoke access and unconsumed grants, **not already-admitted execution**.
  Operator must explicitly Cancel/stop if desired.
- Bounds: 8KiB request headers, 128KiB JSON control body, 16KiB WS client frame, 16 viewers/owner; bootstrap failures limited to 5/min per direct peer and 30/min globally (429, no secret reflection).
  Proxy peer rate accounting is conservatively shared, not based on untrusted client-IP headers.
  Auth/session errors are fixed and public health only reports protocol/alive, never paths/task counts/token/config details.

## 6. Creation, planning, preflight and approval

- `GET`/attach/search/export never construct a model session, resolve auth, acquire execution consent, repair storage or create a task.
  Explicit Create saves kind/goal/allowed cwd selection and optional user-entered draft with an idempotent command receipt.
  A selected cwd is a registered server ID, not an arbitrary browser path.
  No task selection changes another client's selection.
- Editing/saving a plan is metadata only.
  Generate plan is a separately confirmed, recorded **readonly** model operation, with research tools even for code parents; it returns an advisory readable draft/finite DAG.
  It does not save code authority or start its own proposal.
  User edits/accepts the draft via another revision-bound metadata command.
  Freeze graph before Start; no dynamic assignment growth, implicit synthesis/checks or recursive scheduling.
- Preflight is an authenticated POST that performs bounded local checks/observations and creates only a RAM-held, single-use, 120s grant; it never contacts a provider or spawns.
  Return the complete action preview, warnings and opaque grant.
  Bind owner epoch, auth generation/principal, task raw identity + task/control revision, plan/graph digest, cwd/root, model/config/env generation, relevant checkout observation/generation and action payload (including checks/review issue acknowledgment).
  Native client additionally binds its local session/model/dialog epoch.
- Fresh confirmation consumes that grant in `POST /api/v1/commands`; neither the signed-in session nor a previous confirmation suffices.
  Server revalidates all bound state under its admission mutex, then reserves capacity/records admission before async auth.
  Readonly parents/assignments cannot request edit or shell-check capability regardless of prose/parent kind.
  User-facing authority comes from explicit UI action, not a boolean claiming a physical human was cryptographically attested.
- Start admits one frozen finite episode, not each future client reconnect.
  Grant expiry limits initial submission; accepted graph admission can last up to **6h** in the same epoch, with a **10min ready-but-undispatched wait limit**.
  Each child rechecks cancellation, context, dependencies, lane and source policy before auth and again before launch.
  Expected predecessor changes are explicitly recorded graph context; unexplained external/cross-task changes block, never silently replan/retry.
  After restart even never-launched accepted children need a new explicit episode.
- Parent Cancel is its own explicit action with current epoch/run ID and idempotency ID; it does **not** require unchanged rapidly moving progress revision or an extra confirmation modal.
  It closes admission first, requests stop of all preparing/running children and checks, and preserves completed/partial results.
  Service stop has a separate impact preview/confirmation.
  Review uses a captured change/check/graph issue version, short checkout barrier and recapture; changed context refuses Done.
  `reviewed-with-issues` never alters check/execution facts.

## 7. Crash-consistent receipts and versioning

- All mutations include UUIDv4 `commandId`; use direct file addressing under owned `commands/<commandId>/`, not a volatile idempotency cache.
  An immutable admission receipt contains schema, canonical action/context payload digest (excluding grant/CSRF/access credentials), epoch/auth generation, action/context, operation IDs, expected record identities and admission time; never raw credentials/grants.
  Run/operation IDs are allocated before side effects and referenced in that receipt.
  Retain receipts alongside retained history; quota exhaustion refuses new commands rather than evicting deduplication state.
- Serialize validation/admission through one owner mutex.
  Create immutable receipt via exclusive creation, flush file and parent-directory metadata; a present incomplete/torn selected receipt means unknown/refused, not “missing, safe to retry.”
  Persist versioned operation transitions in an ordered journal with committed sequence/watermark; artifact/history files referenced by a committed transition must already be durable.
  Flush launch-intent before spawn; record native process identity after spawn; flush closure/result before admitting dependents or acknowledging durable completion.
- Same command ID + same canonical payload returns its recorded receipt/state even after a lost response or new epoch; **never invokes dispatch twice**.
  Same ID + altered payload is 409.
  Lookup existing receipt before rejecting a request's old epoch, but only after current access authentication; replay returns observations, not renewed authorization.
  Missing receipt + stale epoch/grant refuses; clients query receipt/snapshot after uncertainty, never automatically mint a new command ID and retry Start.
- Two tabs with different command IDs still race on task/control revision and active-episode uniqueness: only one Start is admitted, the other conflicts.
  Receipt creation advances the authoritative control revision before releasing the mutex.
  Progress sequence is separate, so streaming does not continually stale unrelated confirmations.
  No global “selected task” or client socket owns these versions.
- Metadata commands record expected old task bytes and intended new bytes/digest in admission before saving the v1 summary, then append publication outcome.
  Crash between those writes leaves `publication-uncertain`; viewing never applies intended bytes or declares success merely because they look similar.
  Preserve conflicting external bytes and block further affected mutations pending explicit resolution.
  This is not a multi-file transaction or rollback system.
- Crash windows are deliberately conservative: before durable admission = no launch allowed; admitted/no launch-intent = no worker launch authorized after restart; launch-intent/no native close = interrupted/unknown even without recorded PID; native close seen but not durable = unknown to the next epoch; durable closure/result = historical result, not permission to continue the queue.
  Acknowledgment is `accepted`, never “execution completed.”
- Service startup reads owned manifests/journal to project state, **does not rewrite old receipts/history or truncate torn tails**.
  Corrupt selected control state quarantines mutation; readable unaffected retained history stays available with explicit gaps.
  If persistence fails live, stop admission and request bounded cancellation using existing handles even when a cancel receipt cannot be written; expose `persistence-unconfirmed`, retain fences and never claim durable success.
  Export/read operates only on committed retained records, no SDK sessions/import/repair.

## 8. Stop, restart and informed recovery

- Persist an owner epoch UUID and ownership nonce before accepting commands; record service executable/runtime identity, host, OS boot identity and process creation identity when available.
  Record launch intent, child ID, native PID/group, birth observation and any owned containment handle identity.
  These are diagnostics/fencing context, **not permission to signal a PID after restart**.
  A fresh authenticated owner challenge verifies a live service; PID probe alone never proves ownership or death.
- While the original owner holds native child handles, preserve bounded TERM → KILL (1s escalation) → unknown (3s native-close budget), concurrently across children, not N×3s.
  Actual close/protocol success still determines outcome; group signaling/direct close does not certify every escaped descendant.
  Unknown child or lock release blocks the whole checkout and stops further admission.
  Browser/terminal disappearance never enters this path.
- Orderly stop: enter quiescing, revoke grants, record stop intent, cancel queued/preparing work, signal active children/checks, wait for native settlement and outstanding auth persistence, flush final receipts/recording coverage, close subscribers/listener and release only unchanged known-owned locks.
  If closure/storage/credential settlement remains uncertain at 60s, report `stop-incomplete`; retain owner in restricted diagnostic mode and fences rather than reporting stopped or automatically forcing exit.
  SIGTERM follows the same path.
- Abrupt crash/power loss cannot write a clean-stop fact.
  New start uses a new epoch and can expose **observation-only quarantine** once service process absence is established using platform birth/boot evidence or explicit informed local recovery; it never reuses old grants/process handles or launches queued work.
  Preserve old checkout lock as the fence.
  If process identity is unavailable or ambiguous, refuse takeover and use offline diagnostics; not `kill(pid,0) == ESRCH ⇒ safe`.
- `recover inspect` shows exact selected registration/epoch/receipt digest, pending children/auth operations, known/missing launch/close facts and original lock identity, without mutation/signaling.
  `recover resolve` requires local interactive confirmation bound to that unchanged digest and explicit evidence that the old owner/workers have been stopped externally (owned supervisor/containment-empty evidence, host reboot observation, or documented operator intervention with acknowledgment of unprovable escaped descendants).
  No generic force-unlock button or browser recovery endpoint.
- Resolution appends a **new service-owned recovery record**, retains original interrupted/unknown outcomes, and may retire/release only exact service-created ownership files identified in that record after rechecking them.
  It does not erase history, turn unknown into success/canceled, kill guessed PIDs, clean old locks or repair credentials/transcripts.
  Known surviving or ambiguous processes remain blocking until informed resolution; accepting residual risk is explicit, not a new closure guarantee.
  A clean new Start is still required afterwards.

## 9. Typed wire sketch and routes

```ts
// Runtime closed-schema decoders accompany these sketches; IDs are opaque, not paths.
type Version = { epoch: string; configRev: number; controlRev: number;
  taskRevision?: number; taskIdentity?: string; planRevision?: number };
type ModelSnapshot = { provider: string; modelId: string; api: string;
  thinking: string; modelRevision: string; authSource: 'stored-key'|'stored-oauth'|'models'|'env' };
type Action =
  | { kind: 'create'; taskKind: 'code'|'research'|'diagnosis'; goal: string; cwdId: string }
  | { kind: 'save-plan'; taskId: string; plan: string; assignments: AssignmentDTO[] }
  | { kind: 'generate-plan'|'start'; taskId: string; modelId: string }
  | { kind: 'check'; taskId: string; checkId: string }
  | { kind: 'review'; taskId: string; observationId: string; acknowledgeIssues: boolean };
type Preflight = { grant: string; expiresAt: string; version: Version;
  preview: ActionPreviewDTO; issues: IssueDTO[]; model?: ModelSnapshot };
type Command = { commandId: string; expected: Version; grant: string; action: Action };
type Cancel = { commandId: string; epoch: string; runId: string }; // separate endpoint
// Receipt/projection distinguishes admission, execution, publication and closure.
type Receipt = { commandId: string; operationId?: string; runId?: string;
  state: 'accepted'|'settled'|'refused'|'uncertain'; committedSeq: number;
  execution?: 'completed'|'failed'|'canceled'|'timeout'|'unknown';
  closure?: 'not-launched'|'direct-child-closed'|'unconfirmed'; publication: string };
type Envelope<T> = { schema: 'cadence-control/1'; workspaceId: string;
  epoch: string; seq: number; observedAt: string; liveOwner: boolean; data: T };
type ErrorDTO = { code: string; message: string; commandId?: string;
  effect: 'none'|'accepted'|'uncertain'; retry: 'observe'|'fresh-confirmation'|'operator' };
```

| Route                                                                                       | Contract                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /healthz`; `GET /`; `GET /?token=…`                                                    | Minimal public health/unprivileged entry shell; sole token bootstrap. Everything private below requires authentication.                                                                                                                                 |
| `GET /api/v1/session`, `/workspace`, `/tasks?cursor=…`, `/tasks/:id`                        | Session/CSRF, capabilities/model labels, paged current + explicitly legacy task projections; no secret/runtime bootstrap.                                                                                                                               |
| `POST /api/v1/preflight`; `POST /api/v1/commands`; `GET /api/v1/commands/:id`               | Preview/grant; durable mutation admission; authoritative idempotency receipt (202 accepted, 200 known receipt, never optimistic completion).                                                                                                            |
| `POST /api/v1/runs/:id/cancel`; `GET /api/v1/runs/:id`                                      | Explicit intent and frozen run/assignment/outcome/coverage projection. Model IDs are approved selection IDs, not client-authored model objects.                                                                                                         |
| `GET /api/v1/tasks/:id/changes`, `/checks`, `/review`                                       | Scoped bounded change observations, actual checks/obligations and human review; no arbitrary filesystem browsing.                                                                                                                                       |
| `GET /api/v1/runs/:id/{events,messages,tools}?cursor=…`; `GET /api/v1/details/:id?cursor=…` | Durable paged detail keyed by stable recorded IDs, capture/redaction/omission metadata; denied/missing detail is explicit. Default 100 entries, maximum 200/512KiB response; long content continues via byte/chunk cursors.                             |
| `GET /api/v1/search?q=…&cursor=…`; `GET /api/v1/export?...`                                 | Stable exact-hit navigation and streaming selected-scope export beyond realtime/page limits; scope IDs validated, no credential/private-diagnostic paths, no on-read repair. History owner defines exact retained-content manifest.                     |
| `GET /api/v1/events` (WS upgrade)                                                           | Same auth/Host/Origin before upgrade; subscribe/resync only. Snapshot + committed seq/epoch, heartbeat 15s; client stale after 30s, reconnect never submits actions. Bound queue 1MiB/256 events; overflow sends resync/close, not worker backpressure. |
| `POST /local/v1/admin/{preflight,stop,token-rotate}`; `GET /local/v1/diagnose`              | Local-capability-only administration; stop/rotation bind epoch + preview + command ID. No browser-cookie access, even on loopback; expire/rotate browser access without losing local recovery.                                                          |
| Local `recover` / native manual-check adapter                                               | Offline recovery or authenticated quarantined-owner resolution uses exact selected ownership digest; manual-check has its own local-only preflight/command schema. Neither is a browser DTO variant.                                                    |

Lost final-update defense: heartbeat carries latest committed sequence; mismatch or 30s reconciliation poll fetches snapshot/receipt even if no further event arrives.
Changed epoch/gap/reordered duplicates cannot invent completion.
Historical envelopes carry original run epoch plus current reader epoch/live-owner provenance; old run events never mutate a newly admitted episode.
No viewer delivery is awaited by process callbacks.

## 10. Error matrix, integration obligations and handoff

| Condition                                                                        | Response / effect                                                                                                                              |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing/invalid/expired/rotated access                                           | 401 `access-required`, no private data; WS upgrade refused/established session closed.                                                         |
| Bad Host/Origin/proxy/CSRF or forbidden capability                               | 403 `access-boundary`, no execution; do not reveal expected secret/paths.                                                                      |
| Invalid schema/unknown field/ID; oversized control data                          | 400 `invalid-request` / 413 `request-too-large`; `effect:none`.                                                                                |
| Current authenticated receipt unknown                                            | 404 `receipt-not-found`; query state; old epoch/grant cannot relaunch.                                                                         |
| Changed task bytes/plan/model/config/env/epoch, consumed grant, concurrent Start | 409 `context-changed` / `already-admitted`; fresh confirmation, except exact duplicate returns prior receipt.                                  |
| Same command ID with different canonical payload                                 | 409 `command-id-conflict`; never execute altered payload.                                                                                      |
| Grant expired                                                                    | 410 `confirmation-expired`; new preflight and human confirmation.                                                                              |
| Unsupported auth/model/adapter, invalid graph, readonly escalation               | 422 `unsupported-context` (403 for capability); no fallback/no worker.                                                                         |
| Missing/corrupt/denied auth or failed refresh/writeback                          | 503 `auth-unavailable` / `credential-uncertain`; no late spawn, operator/fresh action after diagnosis.                                         |
| Capacity/rate limit                                                              | 429 `capacity-limited`; no hidden queue/retry beyond admitted bounded graph.                                                                   |
| Owner unavailable/stopping, lock conflict, interrupted unknown child             | 503 `owner-unavailable` / 423 `checkout-quarantined`; observe/local recovery, no fallback.                                                     |
| Corrupt selected history/control or denied selected detail                       | 409 `record-unreadable` / 403 `detail-denied`; preserve bytes, report gaps, quarantine affected control.                                       |
| Storage quota/I/O/flush failure                                                  | 507 `recording-unavailable`; `effect:uncertain` if admission/side effects may exist, cancel boundedly, keep fences; no history eviction/reset. |
| Cancel/stop accepted but close unconfirmed                                       | 202 receipt with pending/unknown closure; never successful/canceled solely from requested intent.                                              |

**Main-session deviations to incorporate:** update intentional product/spec boundaries, package Node/runtime qualification and SDK development baseline; add fixed registry outside configurable state-home; service lifetime holds v1 lock; legacy tasks remain view-only; native-only manual checks; separate per-boot local capability and explicit administration/secure reverse-proxy deployment.
Terminal adapter, worker protocol/process launcher, packaging/member manifest/notices and new browser assets necessarily change outside `src/service/*`; do not pretend the service directory alone delivers R1–R14.
Keep `dist/service` as the compiled CLI/server route and package-relative worker assets; exact shared protocol/history filenames should be unified with sibling designs, not implemented twice.

**Required integrated evidence (none executed):** real source/extracted service and native-terminal clients; browser without terminal; two readonly overlapping children and serialized cross-task writers/checks; disconnect/duplicate/lost-final recovery; crash at receipt/launch/close/publication boundaries; native stop/unknown/recovery; fake OAuth rotation/cancel/store failures preserving unrelated entries; invalid/cross-origin HTTP/WS/detail/export and rotation; exact remote HTTPS proxy route plus phone viewport versus actual-device evidence; long retained history/search/export and full package assets/notices.
No partial child milestone satisfies completion.

**Source/API verification:** existing research supplies detailed current/upstream anchors.
Newly rechecked `src/task-store.ts:114–214,246–316` explains canonicalization/state-home/v1 lock limits; maintained `database-guidelines.md`, `lightweight-workflow-guidelines.md`, `task-distribution-guidelines.md` remain current contracts pending redesign approval.
Public declarations: local SDK 0.84.3 `dist/core/model-runtime.d.ts`; global SDK 1.2.0 same file (`create`, `getModel`, `getAuth`, no dispose), global pi-ai `dist/auth/types.d.ts` (`CredentialStore`, `AuthResult`, signal), SDK `ModelRuntimeAuthOverrides` (validity), pi-ai `dist/models-store.d.ts` plus root re-exports (`InMemoryModelsStore`), SDK root exports (`ModelRuntime`, `getAgentDir`).
Implementation inspection only: global pi-ai `dist/auth/resolve.js:46–123` and SDK `dist/core/auth-storage.js` confirm decoupled renewal, lock/persistence and best-effort cached-read caveats; these internals are evidence, **not import targets**.

Also read installed `proper-lockfile@4.1.2/README.md` completely and its public `index.js`: `.lock`/release, `realpath`, stale/update and compromised-lock semantics are documented; differing lease settings/manual removal can defeat exclusion.
This is a coordination caveat to qualify, not a new dependency or private SDK import recommendation.

Official local docs read completely under `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent`: `README.md`, `docs/{sdk,configuration,providers,models,security,environment-variables,packages,settings,custom-provider,cli-integration,sessions,session-format,message-types,extensions,tui,skills,prompt-templates,containerization,compaction}.md`, plus `examples/sdk/README.md`, credential and full-control examples.
Relevant cross-references informed the no-discovery/no-session-import decision; unused MCP/image/router/PTY APIs are not proposed.
Context7 skill was read, but no gateway/config/credential access was performed; installed official declarations/docs are the version-specific evidence.
All defaults above are design choices requiring implementation and qualification, not claims that current Cadence already provides them.
