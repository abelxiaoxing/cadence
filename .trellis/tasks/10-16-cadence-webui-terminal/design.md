# Complete Redesign — Technical Design

## 1. Authority and Design Decisions

This design implements the confirmed parent PRD as one integrated delivery.
The user approved this final design and its mandatory appendices for implementation; the authorization record binds the reviewed artifact hashes.
Product verification remains to be executed.
The PRD owns outcomes; this file owns architecture/contracts; `implement.md` owns work order and verification.

Selected decisions resolve the alternatives in research:

- One explicitly started service per canonical checkout, two clients, no embedded-executor fallback and no browser-owned Pi session.
- Preserve/adapt current process, file, diff, role and check primitives; replace the shell-local execution owner with a service registry/scheduler.
- Reuse substantial React/Vite pi-web-ui module families, its standalone timeline client and token/cookie patterns; do not copy its general chat server.
- Existing Pi configuration and normal SDK OAuth writeback; no new credential profile, account database or provider-management subsystem.
- Simple shared owner-token bootstrap and HttpOnly cookie, not JWT/account management or a second signed-session framework.
- New private plain-file history with a small single-writer commit journal; no legacy SQLite import, certified graph compiler, transaction-application or general workflow platform.
- Full retained public text/tool detail, paged search/export and explicit coverage; the realtime ring is never the archive.
- Preserve current installed Pi development pins initially; qualify their public capabilities instead of forcing an unrelated SDK upgrade.
  Raise package Node metadata to `>=22.19.0` to match existing SDK/Undici requirements and the new supported service baseline, not as proof that every later runtime works.
- Keep the generated service executable beside the maintained worker (`src/service-cli.mjs`), rather than moving runtime-relative assets into a second dist layout.
- Keep one documented coordination state-home per checkout, with exact registration checks; do not introduce OS-account-home discovery or claim locks exclude arbitrary older/custom-state-home clients.
- Legacy tasks remain readable and can receive explicitly authorized new episodes under expected-byte checks; no forced copy/migration and no imported old execution approval.

Research reports are recommendation/evidence inputs, not additional competing specifications.
The constants, paths and policies below supersede conflicting research defaults (60s versus 120s grants, subscriber counts, store names, SDK upgrades, signed cookies, fixed OS registry and legacy-readonly-only proposals).

## 2. System and Source Ownership

```text
native /cadence client ─┐
                       ├─ authenticated control/read API ─ shared owner
React WebUI client ────┘                                   │
                  ┌────────────────────────────────────────┤
                  │                                        │
          admission + scheduler                    model/auth preparation
                  │                                        │
          checkout reader/writer gate ── runWorker / runCheck
                  │                            │
                  │                    ordinary SDK child/host tools
                  └──────── capture + history writer ──────┘
                                      │
                            committed projection/read API
```

| Proposed owner                                                                       | Responsibility                                                                                                                                      |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service-contract.ts`                                                            | Portable closed-schema DTOs, decoders, versions, IDs, limits and outcome taxonomy; no Node/Pi/React imports.                                        |
| `src/service-client.ts`                                                              | Portable typed methods, receipts, snapshot/subscription reconciliation; injected transport/auth, no generic arbitrary send.                         |
| `src/service/{cli,owner,http,auth,model-context,admission,coordination,recovery}.ts` | Explicit lifecycle, private registration, finite routes, token/local admission, shared Pi model runtime, fresh action grants and management.        |
| `src/service/{graph,scheduler,task-actions}.ts`                                      | Frozen assignments/dependencies, capacity/read-write gates, check/review orchestration and task v1 publication.                                     |
| `src/history/{types,writer,reader,search,export}.ts`                                 | New private journal/artifacts, committed projections, cursors, literal search and streaming exports.                                                |
| `src/worker-public.mjs` plus declaration                                             | Shared bounded public event codecs/stream redaction usable by maintained JS worker and TS owner; no auth serialization or unrelated diagnostics.    |
| `src/subagent-process.ts`, `src/sdk-worker.mjs`                                      | Version-2 capture/decoding, real SDK tooling, exact model/auth setup, original native process settlement.                                           |
| `src/task-store.ts`, `task-types.ts`, `task-diff.ts`, `agent-registry.ts`            | Retained canonical paths, strict v1 records/config, lock primitives, actual observations and pinned role content, extended only at necessary seams. |
| `src/task-shell.ts`                                                                  | Native consent/menus/pagers as service client; no worker/auth owner.                                                                                |
| `web/src/`                                                                           | Substantially adapted workspace/transcript/tool/review/history/timeline UI with narrow DTO/action adapters.                                         |
| `src/service-cli-entry.mjs` → `src/service-cli.mjs`                                  | Canonical generated Node ESM executable, analogous to the existing generated readonly operator.                                                     |
| `web/dist/`, `scripts/build-{service,web}.mjs`                                       | Audited compiled browser assets and deterministic service/web builds.                                                                               |

The old `TaskController` must not remain a reachable competing production executor after client cutover.
Reuse its semantic helpers in the owner; retain test intent rather than preserving a second execution path for convenience.
Readonly `doctor|runs`, independent skills and nonactivating startup summaries stay independent.

## 3. Service Lifecycle, Registration and Coordination

### 3.1 Explicit management

New package bin: `cadence-service`, backed by `src/service-cli.mjs`.
Commands: `start`, `status`, `stop`, `diagnose`, `token-link`, `token-rotate`, `recover inspect`, `recover resolve`.
`start --workspace <path> [--config <private-file>] [--foreground]` is explicit; default detached start waits for authenticated readiness for 10 seconds.
An unconfirmed start is reported as such, never killed/retried automatically.
Default bind is `127.0.0.1:17423`; another port is explicit, including port 0 for isolated qualification.
Occupied selected ports refuse; extension import, normal conversation, installation and history viewing never start a service.

Each registration pins canonical checkout, selected state-home, service-config identity, endpoint, original process/host information and epoch.
A private per-boot local capability permits native client/admin access; it is not the browser token and is never sent to the browser or child environment.
Explicit `/cadence` resolves the selected registration; missing/incompatible/unavailable owner gives the exact management guidance and refuses execution, not a local fallback.

`status`/`diagnose` are readonly and distinguish absent, alive, unavailable, stopping and quarantined.
Stop is an explicit local administrative operation, not browser disconnect or a guessed PID kill.
No OS-login autostart or automatic supervisor restart is installed; documentation may show explicit foreground supervisor use without enabling it.

### 3.2 Owned paths and locks

Use the existing canonical workspace resolver and private root: `<state-home>/cadence-assistant-v1/<sha256(canonical-root)>`.
Add `service-v1/` under that root with an owned-format manifest, registration, owner lock, access material and `history-v2/`.
A bounded registry under the same state-home rejects canonical ancestor/descendant execution-root overlap regardless of Git classification, including nested repositories/submodules and mixed Git/non-Git roots, as well as conflicting endpoints/configurations.
Serialize overlap validation plus registration reservation under one short cross-process registry lock; uncertain/stopping/quarantined registrations continue to fence their roots.
Exact-root aliases attach to the existing registration or conflict; disjoint worktrees remain independent even when they share Git metadata.
Preserve ambiguous registry locks rather than expiring them by time/PID alone.
Supported clients pin that domain; a different state-home is not an alternate fallback.
Older runtimes, other OS users and arbitrary processes with different coordination domains remain outside the guarantee and must be stopped before use.

The owner holds the unchanged v1 `checkout.lock` for its lifetime, including idle time, plus its own service lock.
This blocks supported legacy v1 writers in the same domain; metadata saves reuse the held token.
Only the original owner releases unchanged locks after known settlement.
Unknown schemas, links, hardlinks, foreign ownership, oversized files and uncertain locks refuse without deletion/adoption.
Use existing descriptor/no-follow/0600-file/0700-directory hygiene; Windows ACL and directory-durability claims require actual qualification.

Within the owner, a fair reader/writer gate covers every task in the checkout: readonly assignments may share; editing assignments and parent checks are exclusive against both readers and writers for preparation through confirmed close.
A waiting writer blocks younger readers.
Observation dialogs do not hold a gate indefinitely; human review recaptures under a short barrier.
This is supported-process coordination, not an OS sandbox or exclusion of external editors/escaped descendants.

### 3.3 Departure, shutdown and recovery

Client departure only detaches and invalidates its unconsumed confirmations.
Explicit Cancel closes episode admission and aborts preparing/active children concurrently, preserving real outcomes.
Retain TERM → KILL after 1s → unknown if close is unconfirmed after 3s, not N times that budget for N children.

Orderly service stop quiesces admission, revokes grants, cancels runs/checks, waits original child handles and outstanding credential-write promises, flushes history, then closes clients/listener and releases known-owned locks.
A 60s management wait is a reporting bound, not proof of settlement.
Unresolved stop leaves restricted diagnosis/quarantine and fences; no automatic force-exit reported as clean stop.

Restart uses a new epoch and never dispatches the old queue.
Durably settled outcomes remain history; old launch intent without durable closure is unknown even if no PID was recorded.
Process challenge/host/PID/birth observations, where available, are clues, not universal descendant proof.
No automatic stale-lock reclamation, PID-only successful recovery or PID signaling after ownership loss.

Local interactive recovery binds the exact unchanged registration/lock/affected-history digest, displays unknown children/auth work, and requires operator confirmation that old processes were stopped externally with acknowledgment of escaped-process uncertainty.
Known live or ambiguous owners refuse takeover.
Resolution appends a new recovery fact and may release only exact identified service-owned fences; original unknown outcomes and damaged bytes remain unchanged.
Unknown legacy locks are not new-service recovery targets.
Credential/storage recovery and process recovery do not silently repair each other; fresh Start is still required.

## 4. Browser Token Access and Remote Route

Adapt pi-web-ui token parsing, fixed-digest timing-safe comparison, cookie encoding/decoding and pre-upgrade authorization directly.
Use Cadence-specific names to avoid collision with pi-web-ui.

- Default explicit service setup generates 32 random bytes encoded as base64url into a private access file; an explicitly supplied `CADENCE_WEB_TOKEN` or token-file source is also supported, mutually exclusive.
  Configured tokens must be nonempty, bounded and at least 32 bytes; generated entropy is preferred.
  Never display the secret in normal startup/status/logs; `token-link` is an explicit local reveal.
- The owner token is reusable until explicit rotation; no unrelated mandatory provider login or account lifecycle.
  Missing/corrupt existing access material refuses, not automatic reset.
- Only `GET /?token=...` accepts query credentials.
  Valid entry sets a checkout-specific HttpOnly, SameSite=Strict, Path=/ cookie with a 12-hour browser lifetime and immediately redirects 303 to a token-free URL before loading app resources.
  HTTPS mode adds Secure; no Domain attribute.
  The cookie contains the encoded owner secret, matching the reference's simple scheme; no localStorage copy or token on subsequent API/WS URLs.
- Wrong explicit bootstrap tokens refuse even if an old cookie exists; normal private requests require a valid cookie or the explicitly supported native local capability.
  Authentication is checked before private static application bootstrap/data/events/detail/export.
  A minimal entry shell and minimal health response may be public, with no workspace information or real-token cookie reflection.
- Authenticated `/api/v1/session` returns capabilities, epoch and a per-boot CSRF challenge; mutations require exact allowed Origin plus `X-Cadence-CSRF`.
  Native local-capability requests are accepted only directly on loopback with no browser Origin/forwarding headers.
  A caller-supplied `surface: terminal` never grants local authority.
- Exact configured Host and scheme-aware Origin checks remain required even with valid credentials.
  Normal navigation/subresource GET may omit Origin; reject supplied foreign/null Origin and cross-site private fetches, while allowing the deliberate top-level token-entry exception.
  Browser mutations and WS require exact allowed Origin; WS also requires a valid cookie before upgrade and carries only subscribe/resync/ping, never control commands.
- Backend remains loopback-bound.
  Personal remote operation uses an explicitly configured HTTPS reverse proxy on the same host, one public origin and explicitly trusted immediate proxy addresses.
  The proxy strips incoming forwarding headers and sets the expected Host and sole HTTPS assertion; the backend rejects unexpected chains/authorities and never trusts arbitrary client-supplied forwarding headers.
  Provide a Caddy example; it is configuration/documentation, not an installer or new runtime dependency.
- Plain public HTTP is not a supported credential-bearing entry route; use HTTPS/WSS or the documented protected route.
  Proxy/application logs must omit credential/query material; responses use no-store/no-referrer/nosniff, CSP self-only executable resources and no framing.
  A first token-bearing URL can still reach browser history/clipboard/external logging: redirect does not retract prior disclosure.
- File-backed `token-rotate` atomically replaces the token, increments access generation, revokes pending grants and closes authenticated sockets.
  Old cookies/links fail; already admitted tasks continue unless explicitly canceled.
  For environment-sourced tokens rotation is an explicit restart with changed environment, not an inconsistent RAM-only replacement.

Transport bounds: headers8KiB, encoded control/preflight request1MiB (enough for the512KiB graph), WS client frame16KiB; decode before dispatch and refuse oversized/duplicate fields.
Live snapshots contain bounded state/roster plus graph/content references, not entire rich bodies; use the paged/detail readers for large content.
No browser account database, tenant roles, signed-token framework, external analytics, CDN code, service worker cache or general plugin authority is introduced.

## 5. Pi Model Context, Credentials and Check Environment

One owner-side public `ModelRuntime` serves the checkout; it is not an inference session.
Resolve normal/explicit Pi agentDir once and use its existing `auth.json` and optional `models.json` with public APIs.
Use an in-memory model cache, `allowModelNetwork:false`, `refreshOnCreate:false`, and no resource loader/extension/MCP/skill discovery.
Missing required selected credentials or invalid custom configuration refuses; opening a UI does not trigger login, auth resolution or provider probing.

Prevalidate selected configuration with bounded safe reads, require existing usable auth data and refuse errors before SDK construction/admission.
Default SDK storage can write locks/refresh records; normal OAuth writeback is approved, but corrupt replacement, credential copying, named-key seeding and login/logout are not.
Known SDK storage limitations and cooperative-writer assumptions must be tested, not disguised as hostile-writer atomic isolation.

Use exact selected provider/model/API/thinking with the currently supported official adapters and literal resolved auth semantics.
Support saved keys/OAuth and supported static custom-model configuration; show unsupported function transports, ambient credential-file auth or key-command expressions explicitly, with no fallback.
Named environment references use the documented service-launch environment, not browser overlays.
Configuration errors, model substitution or silently clamped thinking refuse.

Freeze secret-free model/config/source selection in the graph; retain raw configuration/auth identities only in owner memory where needed for freshness.
No API keys, auth-header values, auth env, secret-derived fingerprints or raw credential objects enter public graph/receipt/history DTOs.
Resolve auth per child when admitted, not once for an arbitrarily long queue.
Request OAuth validity for the child timeout plus 2 minutes; if the provider cannot supply it, refuse visibly without secretly changing the budget/model.
This does not guarantee provider-side token validity or enable mid-child refresh.

Commit credential-free auth-preparation intent before getAuth and settlement only after its original promise settles; include operation/source-selection IDs and fixed outcome, never credential bytes/digests.
Track that original promise with a nonaborted operation signal independently of the caller's 30s admission wait.
Cancel/timeout closes worker admission but allows already-started SDK refresh/writeback to settle; no late spawn.
After crash, unmatched preparation intent is credential-uncertain even without worker launch intent; do not replay refresh, reset credentials or clear it merely by resolving process locks.
Serialize service auth preparation for the selected path while using SDK coordination with other Pi clients; do not import private storage APIs or manually reclaim SDK locks.
Shutdown tracks outstanding promises; auth uncertainty is not rolled-back rotation.
Normal coordinated OAuth renewal is not a model change; unexpected selected key/source/model changes require fresh confirmation.

Parent checks inherit the explicit service launch's ordinary project environment, not the initiating browser or later terminal's environment.
Strip service/local access secrets and control markers; never merge resolved model auth into check env.
Display the environment-policy/epoch, actual cwd, command and timeout at confirmation, not secret values.
Keep configured checks available on both clients; preserve native-local manual checks through local capability and explicit confirmation.
The browser does not gain a generic arbitrary-shell/PTY endpoint.
Outbound SDK proxy and provider-auth routing are separate from inbound HTTPS; preserve validated worker proxy behavior and qualify service auth networking without direct-route fallback.

## 6. Portable Contract and Action Admission

All wire values are decoded from unknown through one portable closed-schema owner; no UI-local casts or raw upstream protocol imports.
IDs are opaque UUIDs/validated assignment IDs, never arbitrary filesystem paths.

```ts
type ContextVersion = {
  epoch: string; configRev: number; controlRev: number;
  taskRevision?: number; taskIdentity?: string; graphRevision?: number;
};
type ActionKind = 'create' | 'save-plan' | 'generate-plan' | 'start' | 'check' | 'review';
type Preflight = {
  grant: string; expiresAt: string; version: ContextVersion;
  preview: ActionPreview; issues: Issue[];
};
type Command = {
  commandId: string; expected: ContextVersion; grant: string; action: Action;
};
type Receipt = {
  commandId: string; operationId: string; runId?: string;
  admission: 'accepted' | 'refused' | 'uncertain';
  committedSeq: string; execution?: ExecutionOutcome;
  closure?: 'not-launched' | 'direct-child-closed' | 'unconfirmed';
  publication: 'pending' | 'published' | 'conflict' | 'uncertain';
};
```

Preflight requires the caller's expected displayed identities; it cannot silently approve a newly changed plan.
It performs local validation/observation only, returns a 120s single-use RAM grant and complete preview, and makes no provider call.
Bind epoch/access generation, task raw bytes/control revision, readable plan/graph, cwd/root, model/config/check-env generation, relevant observations and exact action payload.
Fresh confirmation consumes the grant under the admission mutex.
Progress sequence is distinct from control revision so every text chunk does not stale a plan dialog.

Persist accepted command/operation identity before effects or accepted acknowledgment.
Same commandId and same canonical action/context returns the recorded receipt, including after lost response/restart; different payload conflicts.
A missing/uncertain receipt or stale epoch never causes silent action replay.
Two different command IDs racing Start still contend on task revision and one-active-episode-per-task.
Cancel is a separate explicit run-ID/epoch/idempotency action without a rapidly changing progress revision or extra modal.
Even if recording fails, request bounded stop and report non-durable uncertainty.

Generate plan is a separately confirmed readonly episode returning an advisory readable plan/finite graph proposal.
It cannot dispatch its output; accepting/editing the draft is a separate metadata action and Start is separate again.
Manual readable plans can default to one explicitly displayed assignment; multi-agent graphs are editable before Start.

| Routes                                                                   | Meaning                                                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `GET /healthz`, `/`, `/?token=...`                                       | Minimal health/entry/token bootstrap only.                                                         |
| `GET /api/v1/session`, `/workspace`, `/tasks`, `/tasks/:id`, `/runs/:id` | Authenticated capabilities, models without secrets, paged tasks and authoritative run projections. |
| `POST /api/v1/preflight`, `/commands`; `GET /api/v1/commands/:id`        | Context preview, explicit durable admission, receipt observation.                                  |
| `POST /api/v1/runs/:id/cancel`                                           | Stop admission/request bounded cancellation.                                                       |
| `GET /api/v1/tasks/:id/{changes,checks,review}`                          | Actual observation/check/human-review projections.                                                 |
| `GET /api/v1/runs/:id/{events,messages,tools}`, `/details/:id`           | Paged retained data, stable IDs and coverage; no arbitrary path input.                             |
| `GET /api/v1/search`, `/export`                                          | Snapshot-bound literal search and streamed selected-scope export.                                  |
| `GET /api/v1/events` WS upgrade                                          | Authenticated read subscription/resync/heartbeat, not control.                                     |
| `/local/v1/admin/*`, local manual-check/recovery adapters                | Separate local capability, finite explicit operations, no browser escalation.                      |

Errors carry fixed code, effect `none|accepted|uncertain` and recovery `observe|fresh-confirmation|operator`, never raw provider/OS exceptions.
Use 400/413 invalid/oversize, 401/403 auth/boundary, 409 stale/conflict/corrupt-selected, 410 expired grant, 422 unsupported context, 423 quarantine, 429 capacity, 503 unavailable/auth and 507 recording exhaustion.
An accepted cancel with unconfirmed close is not a successful stop.

## 7–10. Mandatory Execution and History Appendix

Read [design-runtime-history.md](design-runtime-history.md) completely.
It owns frozen graph/dependency handoffs, stop/block transitions, actual worker v2 and pre-await capture limits, durable auth/command/process facts, bounded v1 summaries, rich recording, paged search/export and live reconciliation.
These are required parts of the design, not deferred features or optional research.

## 11–12. Mandatory Client and Distribution Appendix

Read [design-clients-distribution.md](design-clients-distribution.md) completely.
It owns substantial source-family reuse, complete native/browser adapters, exact dependency/build/asset/license policy and intentional assertion replacements.
Both appendices must be loaded before implementation/check dispatch; smaller files prevent context-injection truncation without dropping requirements.

## 13. Rollout, Rollback and Verification Boundary

This is one delivery, not progressive product releases.
The branch can contain dependent implementation work packages, but cannot be reported/released complete before full integrated acceptance.
No new service auto-starts during installation/upgrade; users explicitly stop older sessions and start the shared owner.
Keep old records and new history in separate versioned namespaces.

Rollback requires stopping/quiescing the new service and resolving any uncertain processes first.
An old binary cannot control or interpret new live collaboration/history; leave new private records preserved and use legacy context only, never auto-downgrade/migrate/delete them.
Source rollback must touch only task-authored changes after explicit review, never the pre-existing dirty archive set.

Verification covers real source/extracted service, both terminal modes, browser-only operation, multi-child overlap/exclusion, actual checks, rich history beyond old bounds, crash/unknown windows, token/TLS/Origin/CSRF and credential writeback with fabricated providers, phone viewport/keyboard, complete package assets/license/build audit.
Physical phone/human, second-machine, actual Windows/macOS/ConPTY and paid-provider lanes remain separately labeled until executed; mocks or source citations cannot satisfy them.
If a required acceptance lane is blocked, report the blocker and keep the parent open rather than quietly calling the complete redesign delivered.

### Bounded History Read Transport Resolution

The [read-progress decision](research/read-progress-decision.md), accepted under the user's continuous implementation authorization and two independent source reviews, adds finite readonly POST variants on existing reader paths and explicit bounded proof-progress replies.
GET compatibility, header/body/read budgets and all current authentication/CSRF/no-execution guarantees remain; a POST body is not task mutation consent.
Its private format3/key and source-observation limits are mandatory parts of section10, not a separate product feature or a lowered completeness bar.
