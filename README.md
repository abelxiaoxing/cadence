# Cadence

`@abelxiaoxing/cadence` is a shared Pi task workspace with two independently usable clients: native `/cadence` and a browser WebUI.
One persistent service owns tasks, bounded subagent collaboration, real parent checks and retained history.
Ordinary conversations, resource discovery and opening history never start work or a service.
`cadence server install` registers that service with the user's service manager and starts its WebUI on the default address.

This is a trusted workflow assistant, **not a sandbox, certified executor or transactional application system**.
Code workers edit the chosen working copy directly; recovery can require human work.
Model prose, tool results and human Done do not certify checks or code.

## Install

Cadence needs Node `>=22.19.0` with npm and [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent), installed and logged in to a model provider: the service reads Pi's `auth.json` and `models.json` and never creates its own login.

```sh
npm install -g @abelxiaoxing/cadence
cadence server install
```

The global install puts `cadence` (and its alias `cadence-service`) on `PATH`.
Cadence ships no install script, so npm 12 and Bun, which skip untrusted install scripts by default, change nothing.
They may still report blocked scripts from the pinned Pi SDK's dependencies: `@google/genai`'s preinstall only echoes `no-op`, and `protobufjs`'s postinstall only warns about a dependent's version scheme, so neither needs approval.
`cadence server install` registers and starts the background service for `~/cadence` on `http://127.0.0.1:17423`; `--workspace /absolute/project` selects another workspace.
It prints the private link to open, `http://127.0.0.1:17423/?token=…`.
The port and that token live with the research settings in `~/.pi/agent/cadence/.env`.
Install creates that file from the research template when missing (Pi's startup card names the path until it exists), and adds either line when it is missing, never changing an existing one:

```sh
CADENCE_PORT=17423
CADENCE_TOKEN=<random 43 characters>
```

A file you made yourself works as it is, like Pi's own sources: any permissions (a note suggests `chmod 600` when other users can read it) and dotfiles links; a refusal names the line and reason.
The token admits anyone who has it to the workspace, so keep the file and the link private; a token you choose needs at least 32 characters.
To change either, edit the line and run `cadence server restart`, which prints the new link; old links and browser cookies stop working.
A workspace that an earlier version started with a generated token switches to the file at that restart and keeps its history.

| Platform | Service                                                                                     | Starts                                       |
| -------- | ------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Linux    | systemd user unit `~/.local/share/systemd/user/cadence.service`                             | At boot through linger, else at login        |
| macOS    | LaunchAgent `~/Library/LaunchAgents/com.abelxiaoxing.cadence.plist`                         | At login                                     |
| Windows  | `HKCU\…\CurrentVersion\Run\Cadence`, starting `%LOCALAPPDATA%\cadence-server\cadence.vbs`   | At login, without a console window           |

On Linux, install enables linger without a prompt when logind allows it, and otherwise asks `loginctl enable-linger`, which may want your password; `--no-linger` (or `CADENCE_LINGER=0`) keeps the service to login.
Open the printed private link once; the browser then keeps an HttpOnly cookie, and `http://127.0.0.1:17423/` alone only says how to get the link.
For native `/cadence`, let Pi load the same copy: `pi install "$(npm root -g)/@abelxiaoxing/cadence"` records that path and loads it in place, so an npm upgrade updates both.

```sh
cadence server status
cadence server restart     # after an upgrade or a models.json change
cadence server stop
cadence server uninstall   # before npm uninstall -g, which runs no Cadence script
```

Upgrade with `npm install -g @abelxiaoxing/cadence@latest`, then `cadence server restart`, which rewrites the service definition with the current Node and package paths.
Restart, stop and uninstall go through the authenticated orderly Stop, so running work is stopped, not detached; on macOS and Windows a Stop that is not confirmed changes nothing.
`stop` keeps the registration, so the service starts again at the next boot or login.
Uninstall removes only the generated definition; workspace, history, linger and Pi sources stay.

Pi's own package install (`pi install npm:@abelxiaoxing/cadence`) still loads the native client, but its copy has no `cadence` on `PATH`; register the service with `node ~/.pi/agent/npm/node_modules/@abelxiaoxing/cadence/src/service-cli.mjs server install`, the command Pi's startup warning names while no service is registered.
Keep one copy: two copies drift apart on upgrade, and a native client refuses an owner whose service contract differs from its own.
A unit registered by an earlier version's Pi install hook keeps running; `cadence server restart` from the copy you keep rewrites it, and `pi update` no longer restarts it.
See [the background service](docs/service-management.md#background-service) for exact behavior and limits.

## Load and start explicitly

The package can be loaded as a reviewed local package, extracted tarball or installed npm package through Pi's package mechanism.
For a local checkout, add its absolute or relative path to Pi's `packages` setting, or try `pi -e ./cadence`.
Pi loads `src/index.ts`; the service, worker and readonly operator are ordinary JavaScript with no TypeScript/source-tree fallback.
The manifest does not impose a Pi version range; inside Pi the extension uses Pi's own public packages.
Development pins, declared Node baseline (`>=22.19.0`) and actual tested runtime identities are separate facts, not universal compatibility promises.
Required installed peers are public Pi packages and Typebox; `undici` and `ws` are exact production dependencies.
Pi's package installer omits peers and supplies only its own packages and Typebox to the extension, so any other extension import must be a production dependency.
The standalone owner and workers run outside Pi and import `pi-coding-agent`/`pi-ai` by bare name, so they load the exact tested copy (0.84.3) from optional dependencies; an install that omits optional dependencies cannot start an owner.
Browser assets are prebuilt, not compiled by consumer postinstall.

Before using the shared owner, stop older Cadence sessions and choose one coordination state-home for the checkout.
No old records, databases, credentials or uncertain locks are imported, reset or cleaned.

```sh
cadence start --workspace /absolute/project
cadence status --workspace /absolute/project
cadence token-link --workspace /absolute/project --reveal
```

Use the installed `cadence` bin (or `cadence-service`), or `node /absolute/cadence/src/service-cli.mjs` followed by those arguments.
Default binding is numeric loopback `127.0.0.1:17423`; `--foreground` is available for an explicitly configured supervisor.
Start reads the existing Pi agent directory (or an explicit private configuration), never creates another login/profile.
A directory that contains the private state home (the home directory and its ancestors, such as `C:\Users\<you>`) cannot be a workspace, so commands there use `~/cadence` instead of refusing; only `start` creates it, and `/cadence` started there attaches to that owner.
See [service management](docs/service-management.md) for configuration, model/auth policy, Stop, diagnosis and informed recovery.

### Native terminal

In a trusted, idle Pi TUI, type `/cadence [goal]` using fresh native Enter.
The optional goal does not Start; pasted/replayed/nonterminal command dispatch cannot grant native entry.
The client attaches to the existing owner and never falls back to a local executor or starts one implicitly.
Choose the exact owner model/API/thinking level explicitly: initial selection is absent.
Create or open a task, edit a readable plan and finite assignments/dependencies, preview and confirm Start.
Readonly Generate is advisory and requires a separate Save/Start.
Native menus expose child messages/tools/timeline, checks, current changes, review, retained history/search/export and independent active-run Cancel.

Return, session departure and Pi quit **detach; admitted work continues** while the service is alive.
Reattach to observe the same IDs without replay.
Explicit Cancel requests bounded stop; it is not proof that every escaped descendant stopped.

### Background agent panel

A readonly panel in the Pi TUI follows background agents: the child runs of Cadence's running owner and any agents another extension announces on Pi's shared event bus.
Every TUI session, not only `/cadence`, looks for the owner already running for its workspace half a second after start and every 15s while none answers; it never starts, recovers or selects one, skips an incompatible owner and only detaches on departure.
That observation holds one of the owner's viewer attachments, so departure (including Pi quit) waits up to 1.5s for the detach to reach the owner rather than leaving the slot to its idle expiry; `/cadence` departs the same way.
`CADENCE_AGENT_PANEL=off` turns that observation off.
It reads the active roster every 5s, and every 2s together with the task's snapshot while it follows an episode, announcing each child of the active episodes: its assignment ID as label, purpose as kind, lifecycle or latest tool as activity, and completed, canceled or any other outcome (with its reason) as done, cancelled or error.
A child whose outcome the session can no longer observe (no compatible owner a whole retry after losing it, or no settled row five looks after its run left the roster) ends as an error that says so; `/cadence` History keeps the actual outcome.
Elapsed time counts from when the session first observed a child (`—` for one first seen settled); no tokens are shown because the owner records no usage.
Opening a child reads its retained messages, tool calls and results through the history readers, up to 64KiB per field; complete fields, search and export stay in `/cadence` History.
A retained `edit` call shows its call and result without Pi's diff preview, which would compare against the file as it is now.
Producers emit `subagent:start {id,label,kind,startedAt}`, `subagent:message {id,message,streaming?}`, `subagent:activity {id,activity,tokensIn?,tokensOut?}`, `subagent:stats {id,tokensIn,tokensOut?}` and `subagent:end {id,status,endedAt,error?}` with status `done`, `error` or `cancelled`; `startedAt: null` marks an unobserved start.
A message has the main session's message shape; `streaming: true` marks a snapshot that the next message replaces.
The panel emits `subagent:view {id}` (`id: null` when none) so a producer loads only the shown agent's messages.
Nothing is mounted until the first agent arrives (`CADENCE_AGENT_PANEL=always` keeps `● main` visible).
Then a launched/finished block sits above the input and one row per agent below it: at most six recently active rows plus `+K more`.
With an empty input, ↓ moves focus to the rows; ↑/↓ or Ctrl+P/N select, Enter shows that agent's transcript in place of the main view, PgUp/PgDn, Ctrl+U/D and Home/End scroll it, and Esc returns to the main view and then to the input.
Every other input key, including Enter, Shift+Tab and Ctrl+J, stays Pi's; each agent view remembers its scroll position.
The panel never starts, cancels or keeps an agent or Pi alive, and keeps nothing across restarts.
For manual checks, `pi -e ./src/index.ts -e ./scripts/agent-panel-demo.ts` adds `/agents-demo [count]`, which plays fake agents (the second fails) and runs nothing.

### Browser

Open the private link that `cadence server install` printed, or that `cadence token-link --reveal` reveals.
Valid bootstrap redirects to a token-free URL and uses an HttpOnly SameSite cookie for subsequent HTTP/WebSocket access; no localStorage token copy.
The browser can create/plan/Start/Cancel, run exact configured checks and record human review without a live Pi terminal.
A token grants workspace access, not action consent.
Every mutation needs its own context-bound preview/confirmation; stale/duplicate/lost replies do not silently replay work.
The WebUI provides task/run/assignment navigation, long retained messages and tool detail, exact literal search, timeline and complete scoped NDJSON/Markdown downloads.
Desktop panes and phone drawers retain cancellation and keyboard controls.
Its chrome follows pi-web-ui: a compact topbar with view tabs and icon actions, a sectioned task sidebar, pill inspector tabs, transcript/tool cards and a bottom statusbar; phones wrap the topbar into an action row and an icon tab row.

## Execution, checks and review

- Graphs contain 1–16 required assignments with explicit purposes/dependencies and exact model choice; no recursive spawning or autonomous retry.
- Two readonly children may overlap; checkout editing and parent checks serialize across tasks and aliases against readers/writers.
- Research/diagnosis never gain editing or parent-shell authority through a plan or child prompt.
- Configured checks are available on both clients.
  Manual shell checks require the native local capability and fresh command/cwd/timeout confirmation.
- Checks use the service launch's ordinary project environment, never resolved model auth or a browser environment overlay.
- Changes are bounded observations including pre-existing dirt, not proof of causation or a complete filesystem snapshot.
- Failed, canceled, timeout, unknown, blocked, stale and not-run remain distinct.
  Done-with-issues preserves all execution/check facts.

## History and preservation

Human-readable summaries remain `.cadence/assistant/tasks/<id>/task.json`; optional checks remain `.cadence/assistant/config.json`.
Private coordination/history use `<state-home>/cadence-assistant-v1/<checkout-hash>/service-v1/`.
Rich `history-v2` is independent of the recent live buffer; new stores use private format3 and authenticated bounded navigation.
Legacy/unknown formats remain preserved, never auto-migrated.
View/search/export are readonly and cannot resume work or repair history.
Exact task/run/child exports require the completion trailer, counts, digest and original EOF; a short preview or revoked download is not a complete archive.
Capture reports redaction, omitted binary/hidden data, source truncation and incomplete recording explicitly.
Known-secret redaction is not universal detection of business secrets.
Storage exhaustion refuses new work rather than silently evicting history.

Service restart never resumes the old queue.
Uncertain process/auth/storage settlement keeps fences; use documented local informed recovery, not PID-only deletion or automatic cleanup.

## Personal remote access

Keep the backend on loopback and configure one explicit HTTPS origin and trusted immediate reverse proxy.
See [the Caddy example](docs/remote-access.md); it installs or deploys nothing.
Host/Origin/CSRF and pre-upgrade WebSocket checks apply in addition to authentication.
Do not expose credential-bearing plain public HTTP.
Token links may remain in clipboard/history or external logs; redirection cannot retract disclosure.
Local token rotation invalidates old cookies/grants/sockets/downloads, not admitted tasks.
Provider credentials remain server-side; browser tokens and model credentials are separate.
Outbound provider proxy policy is independent of inbound HTTPS and refuses unsupported routes instead of falling back direct.

## Independent shipped content

- `skills/context7-auto-research` and `skills/grok-search` remain independent research tools.
- `skills/git-commit` requires an explicit commit request and deterministic audit; task review never commits.
- Three pinned professional profiles in `agents/` provide readonly design/diagnosis and direct-edit implementation instructions, not execution authority.
- `config/` contains optional research/check examples.
  The package has no install script; `cadence server install` creates a missing user `.env` template, and no build/Git/provider operation runs at install.
- `node /absolute/cadence/src/operator-cli.mjs doctor|runs [workspace]` remains readonly and independent of service startup.

## Development and evidence

```sh
bun run check
bun run check:web
bun run build:check
bun run lint
bun run check:agents
bun run test:service
bun run test:web
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run test:browser
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
bun pm pack --destination /absolute/private-temp
```

Build/verification use a fresh private directory with `TMPDIR`, `TEMP` and `TMP` set explicitly, on the checkout's disk filesystem rather than a nearly full tmpfs.
`verify` includes native/unit tests, web tests, required real-browser scenarios and exact real-pack auditing; missing required browser is non-green, never an automatic download.
It needs a Node with TypeScript type stripping (official builds; a distro Node built without it fails `build:web:check`) and NSS `certutil` for the isolated HTTPS browser scenario.
Source/extracted PTYs, fabricated loopback providers and isolated HTTPS are distinct from physical humans/devices, paid accounts, package-manager installation and native Windows/macOS/ConPTY qualification.
Those additional lanes remain unqualified unless their own receipts exist.
No passing gate authorizes commit, push, publication, installation, deployment or cleanup.

## Engineering knowledge

This section is the temporary, tool-independent home for project knowledge formerly spread across development-task records.
Ordinary engineering uses source edits, focused tests and code review directly; no task-management extension, task creation, archive step or workflow-specific agent is required.
Do not recreate the removed project workflow integration unless explicitly requested.
`AGENTS.md` is a short entry guide; this section owns the maintained engineering contracts.
Historical logs are not runtime dependencies, and removing development tooling must never delete consumer `.cadence` data or private service state.

### Source ownership and API boundaries

| Owner                                                                                                  | Responsibility                                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`, `src/task-shell.ts`, `src/native-*.ts`                                                 | Nonactivating Pi entry, raw native consent, typed service attachment, paging and verified export; no embedded executor    |
| `src/agent-panel.ts`, `src/agent-panel-model.ts`, `src/agent-panel-cadence.ts`                         | Readonly agent panel over Pi's `subagent:*` bus, fed with a running owner's children; never starts or cancels work        |
| `src/service/host.ts`, `src/service/cli.ts`, `src/service/{autostart,launchd,login-run}.ts`            | Single-owner composition, explicit management and generated per-user service definitions; management stays SDK-free       |
| `src/service/{coordination,private-files,owner,recovery}.ts`                                           | Canonical overlap exclusion, exact locks, original-operation lifetime and informed local recovery                         |
| `src/service/{admission,task-actions,graph,scheduler}.ts`                                              | Context-bound actions, actual current views, finite graph scheduling, check/review barriers                               |
| `src/service/{model-config,model-context,model-choice,auth-network}.ts`, `src/sdk-network.ts`          | Existing Pi sources, explicit exact model/thinking, original OAuth writeback and strict shared network policy             |
| `src/worker-public.mjs` and `.d.mts`, `src/service-contract.ts`                                        | One portable core/domain/capture codec with matching declarations and facade; TS core/domain/capture modules re-export it |
| `src/service/contracts/`, `src/service-client.ts`, `src/service-wire.ts`, `src/service-http-client.ts` | Closed DTOs, typed named operations, reply correlation, transport bounds and one projection tracker                       |
| `src/subagent-process.ts`, `src/sdk-worker.mjs`, `src/worker-{capture,redaction,tools}.mjs`            | Same native worker/check launcher, genuine SDK capture, incremental sanitizer and bounded no-raw-spill bash adapter       |
| `src/history/{writer,run-state,publication}.ts`                                                        | One committed sequence authority, shared semantic reducers and expected-byte strict-v1 summaries                          |
| `src/history/` readers/proof/search/export/live modules                                                | Original-source integrity, bounded retained navigation, exact search and complete nonblocking exports                     |
| `src/task-store.ts`, `src/task-types.ts`, `src/task-diff.ts`                                           | Literal workspace identity, bounded plain summaries/configuration and honest change observation                           |
| `web/src/`                                                                                             | Reused presentation and thin shared-client adapters, not SDK/session/execution ownership                                  |
| `scripts/`, `provenance/`, `licenses/`                                                                 | Reproducible builds, exact package/body/reference/notice audits and pinned reuse                                          |

The native path is `index → shell → native client → service → scheduler/process/history`.
`src/task-controller.ts` remains a legacy regression subject, not a reachable or shipped production executor.
The readonly operator and independent research/startup modules must not gain service startup or execution side effects.
Inspect actual installed public Pi declarations before changing host/SDK bindings; never import private SDK implementation paths or select a global substitute.

Key maintained seams include `TaskActions.current/currentChanges/activeRuns/checkObligations`, `ServiceClient.preflight` and named action methods, `HistoryWriter.commit/capture/publishTask`, and `NativeConnection.attach/refresh/detach`.
Use their current declarations rather than copying DTO parsing, reducers, a second controller, or process ownership into a client.

### Admission, execution and original lifetimes

- One canonical checkout/state-home domain has one persistent owner, including while idle.
  Registry reservation atomically rejects canonical ancestor/descendant overlaps, including nested Git roots and aliases; a different state-home does not coordinate arbitrary other owners.
- Native entry requires fresh raw Enter within1500ms, trusted/idle TUI, no pending modal/messages and no child guard.
  Browser authentication grants access, not task consent; normal mutation ingress also requires independently built compatible client/service/assets identities.
- Boot model choice is absent until explicitly selected.
  Preserve exact provider/model/API/thinking/source identities; unsupported transport or thinking refuses without fallback or clamping.
  Choice changes refuse while accepted work, admissions, barriers or original operations are busy.
- A120s one-use grant binds exact action, epoch/access/config/control/task raw bytes/graph/cwd/model/check-environment and relevant observations.
  Durable acceptance precedes effects; identical command IDs observe the same receipt, conflicting identities refuse, and inconclusive lookup never means absent.
- Generate is a separate readonly advisory episode, with no saved graph execution or automatic plan replacement, Save or Start.
  A prospective plan UUID/hash is not a committed reference; accepted retention and successful expected-byte publication establish saved membership.
- Independent readonly assignments may overlap; writers and native parent checks exclude readers and other writers across tasks.
  Reserve bounded slots/bytes before copying/auth/effects; dependencies use exact committed predecessor content only after actual native and recording settlement.
  Overflow, stale dependencies, first failure or wait expiry closes admission without retry; independent already-running siblings retain their own outcomes.
  Each assignment or check observes the working copy at its baseline, immediately before its native launch and after exit; the steps between recheck ownership, sources and definitions without another Git/file capture.
- Register the original accepted control flow before its first effect, in addition to separate native/auth/storage originals.
  Reporting timeout, a caught promise, PID absence or an empty roster cannot release resources.
  Stop publishes one shared attempt, quiesces all admissions, requests stops before awaiting children and joins permitted original continuation/safety writes.
  Already-started publication can finish; new post-Stop ordinary publication cannot start.
- TERM/KILL recheck lease ownership at each signal boundary.
  Native close is authoritative for the direct child, not `exit`, EOF or escaped-descendant closure.
  Unknown process/auth/storage settlement preserves fences; late completion never retroactively repairs an unknown result.
- Return, navigation, browser disconnect and Pi quit detach accepted work.
  Reconnect does not resend mutations; a refused Cancel permits only another explicit click, not automatic retry.

### Checks, publication and review truth

Configured checks match exact name, command and timeout; missing obligations project not-run rather than fabricated execution records.
Manual checks require native local capability and fresh confirmation; browsers have no arbitrary-shell/PTY endpoint.
Use the frozen service-launch ordinary environment, stripped of access/control material; never merge resolved model auth or a browser environment overlay.
Service check output retains bounded complete stdout/stderr with independent UTF-8/sanitizer state and explicit observation labels, not the legacy64KiB preview.
Join both original stream tails, actual EOF/close and storage completion; Node may resume paused stdio while draining exit.
Known access-token rotation must update private redaction without sending access secrets into child environment.

A fresh check may account for exactly one owned generation advance bound to its check/operation/held gate.
Do not replace this proof with a general before≤after comparison.
Changes to files, definitions, epoch/cwd/environment or a foreign generation stale the current obligation without rewriting historical native exit or PASS.
Human Review binds exact selected run/graph/check/change identities and recaptures under a short exclusive barrier only after confirmation, not throughout the human modal.
One accepted Review folds its fixed committed snapshot (plan proof, selected run, check results) once; every barrier validation still rechecks raw task bytes, changes, configuration, choice and active work.
Acknowledgment permits reviewed-with-issues, never changes failed/partial/canceled/native/recording/check facts or revives blocked execution.
Unavailable concurrent views may display conservative stale status but cannot advance authoritative review revisions and invalidate an otherwise unchanged accepted Review.

Task v1 remains a strict human-readable summary; rich graph/transcript data never become unknown siblings beside `task.json`.
`TaskStore.loadSnapshot` includes raw-byte identity; save/publication requires exact expected bytes and revision.
A same-revision external edit conflicts and remains preserved.
Summary clipping is labeled and never clips retained detail; a subsequent publication failure remains separate from previously completed execution.

### Capture, retained history and privacy

The maintained worker uses public SDK APIs, explicit empty resources, in-memory session/settings and disabled retries/compaction/cache warming.
Verify exact model and effective thinking before READY/prompt; no provider discovery, credential argv/file envelope or implicit network fallback.
Use the awaited public core-agent subscription for backpressure, reserving synchronous tool/update ingress before any copy or await.
Custom bash uses public local operations plus the bounded redacted accumulator, not the stock raw-spill accumulator.
Never await a run's own settlement from inside its awaited subscriber.

Sanitize known literals, structured sensitive values and terminal controls before stdout and again before owner persistence.
Preserve split UTF-8, escaped literals, surrogate pairs and possible secret prefixes across chunks; independent per-chunk string replacement is insufficient.
Tool-start is an SDK observation, not proof of native execution; tool error is not a parent check result.
Hidden thinking, signatures, provider envelopes and binary/media bodies remain explicitly omitted.
Known-secret sanitation is not universal business-secret detection or an OS privacy sandbox.

Only the serialized history writer assigns committed sequence and persisted content references.
Commit actual admission/auth/launch/result facts in order; an index, observer callback or candidate reducer cannot authorize effects.
Quota/exhaustion/refusal stops unsafe work without eviction; torn tails retain a verified prefix and visible gaps, while interior corruption refuses affected ranges.
Derived indexes are optional accelerators: readers validate original batches/artifacts, use bounded fallback and never repair on view.
Current/plan/review reads replay a task's batches, so per-file cost bounds them: on a slow host (Windows Node 22) that replay once exceeded the 100ms read quantum after review, leaving the task `unavailable`.
`PrivateFiles` reuses a directory walk only within one synchronous `DirectoryWalks` scope (a read budget or lease check), after re-observing that directory's identity; an await or later call walks again, and the quantum is never raised instead.
When a batch settles a task's publication, the owner writer remembers in process memory that task's fold state (check facts, latest run, plan/lineage progress with original admission locators) under its chain head's sequence and hash, a bounded number of tasks and states.
Readers in that process resume from the newest remembered state at or before the snapshot whose chain link still matches and fold only newer original batches; an evicted, restarted, foreign-process or diverged miss folds the original chain, and nothing is persisted, authenticated or repaired.
A quantum that makes no semantic progress because its wall-clock time ran out (a host stall: GC, scheduling, scanning) is repeated with a fresh quantum at most twice before its refusal stands; byte exhaustion and every other refusal stay final, and no progress is ever faked.
The wall-clock quantum belongs only to client-facing cooperative reads: owner-internal authority reads (current views, admission, publication, Review and receipt facts) are bounded by the same bytes but never by time, so host speed cannot turn an owner's own decision into a refusal.
Plan proofs and Review selections read their small plan text through its content/part indexes under the validated snapshot, verifying the original chunk batches, artifacts and aggregate hash; absent or faulty indexes fall back to the complete validated-prefix scan, which no longer runs per current view.
Prepared journal heads avoid redundant mutable legacy hints; no-root compatibility and its original integrity checks remain.

New history uses private format3 at `service-v1/history-v2/`, with exclusive private read-proof key creation before the final format marker.
Format2 remains readonly, without silent migration or key regeneration.
AES-256-GCM navigation authenticates bounded suspended source validation; cursors never grant authentication, admission, recovery or lock-release authority.
Resume must advance actual semantic work and revalidate selected source/key/format incarnations, not merely produce a new nonce or reset proof budgets.
These are supported-writer observations, not atomic snapshots of every archived file or change-and-revert detection.

History data pages are untagged; list readers also return explicit `progress` or initial `snapshot`, while detail/entity/graph return data or progress.
`SearchPage` has hits/next/coverage: zero hits with next is not completion.
Keep exact snapshot/entity/version/UTF-8 ranges and source coverage; do not map progress to an empty successful page or rebase Back navigation.
Readonly POST uses the same finite security/decoder boundary when inputs cannot fit GET; it is not execution consent.
Exports stream task/run/child scope with actual counts/digest/watermark/trailer and original EOF; revoked or interrupted output has no successful completion.
Browser download requested is not UI-verified completion; native export verifies the complete stream and creates destinations exclusively.

### Current resource ceilings

Byte values are UTF-8/encoded bounds where specified; they are not targets to silently increase when a fixture fails.

| Boundary              | Default / ceiling                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Graph / assignments   | 512KiB body;1–16 required assignments                                                                            |
| Scheduling            | 8 episodes;128 queued assignments;2 preparing/running/closing child-or-check reservations                        |
| Policy deadlines      | 6h episode;10min ready wait;20min default worker                                                                 |
| Dependency input      | 16KiB per predecessor;32KiB aggregate; oversized required input blocks, not clips                                |
| Worker request        | 96KiB public pre-auth plus32KiB reserve; actual complete envelope128KiB                                          |
| Process stop          | TERM then KILL after1000ms; unknown after3000ms without confirmed close                                          |
| Native service checks | 16MiB aggregate raw output;64KiB raw chunk;32MiB retained detail; legacy256KiB/64KiB behavior unchanged          |
| Capture               | 64KiB encoded frame;8KiB decoded chunk;32MiB detail;128MiB child protocol                                        |
| Capture queues        | Worker4MiB/1024 frames; owner8MiB/2048;5s reporting stall retains original charges                               |
| Task v1               | 128KiB record; goal8KiB/plan32KiB/result and baseline16KiB;32 checks/64 activity;1000-task compatibility ceiling |
| Read quantum          | 8MiB or100ms cooperative work, including resumed proof/accounting                                                |
| Read replies          | 512KiB full paged/progress Reply;256KiB detail text; graph data/export-frame1MiB with graph body512KiB           |
| Paging/search         | 50 default/200 maximum entries; literal case-sensitive query1–1024 bytes                                         |
| Navigation            | 8192 encoded ASCII bytes; encrypted plaintext6000 bytes; no execution authority                                  |
| Live/export           | 16 viewers,256 messages/1MiB each; two search/two export readers;120s download idle, not total archive timeout   |
| Storage               | 10GiB checkout quota;512MiB reserved per episode;256MiB free-space floor; no TTL cleanup                         |
| Assets                | 16MiB per member/64MiB closure; fixed complete manifest and all font bodies                                      |

### Validation and regression lessons

| Condition                                                      | Required behavior                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Missing/unsafe/corrupt/partial selected state                  | Absent or fixed refusal; no bootstrap, adoption, repair or cleanup on observation   |
| Native exit0 with recording/stdin/final/cleanup failure        | Preserve native zero independently; no workflow success                             |
| Stale grant, selected task bytes or model/source identity      | Refuse and require fresh observation/confirmation                                   |
| Unknown original stop/auth/storage or changed lease            | Retain fences/charges; no guessed process signaling or automatic release            |
| Failed/unrun/stale check, partial child or incomplete coverage | Explicit issues review; preserve independent recorded outcomes                      |
| Lost reply or detached view                                    | Observe original receipt/run; no mutation replay or implicit Cancel                 |
| Invalid read proof or changed source/key                       | Refuse; never rebase or interpret budget exhaustion as absence                      |
| Dirty/partial/extra compiled assets or unsafe archive          | Refuse in place; no source refill, wildcard serving or fallback build               |
| Extension import outside Pi aliases declared only as a peer    | Exact production dependency; Pi's install omits peers and Pi fails to start         |
| Server install without the optional SDK or Pi `auth.json`      | No SDK: nothing written; no `auth.json`: registered, not started (no quarantine)    |
| Package files hard-linked into a package manager's store (Bun) | Packaged reads ignore link count, bind exact bodies; other files stay single-link   |
| Host refuses during startup                                    | Fixed code/stage only; unregistered exits `refused`, registered stays `quarantined` |
| Workspace containing the private state home                    | Land on `~/cadence` (only start creates it); never move state into the working copy |
| Restart changes the definition's workspace or Node path        | Stop with the loaded definition before rewriting, not only a signal                 |
| npm 12 or Bun skips untrusted install scripts by default       | Ship none; `cadence server install` registers the service and creates the template  |
| Service manager that only signals (launchd, Windows login)     | Orderly Stop first; an unconfirmed Stop changes nothing; no SIGTERM or `taskkill`   |
| Pi's TUI replaces an info status with the next one             | The missing-service hint is its own warning notification                            |
| Token source the user edits (`CADENCE_TOKEN` in `.env`)        | Read once before binding, never bound for the run: an edit cannot fence Stop        |
| Saved port/token source differs from `.env`                    | Only when stopped, reselect just those under the reservation; running ones refuse   |
| User-made `.env` (0755/0644, umask 002, dotfiles links)        | Like Pi's sources: ownership only, links followed; each refusal names its reason    |

Good: current context → explicit grant → durable acceptance → genuine original native/storage settlement → exact retained dependency → real checks → human review.
Base: a client leaves and another reattaches to the same accepted run without launching it again.
Bad: model prose, a valid cursor, a prepared graph, one native exit or a human Done checkbox becomes fabricated execution/check success.

Wrong: release a reservation when `Promise.race` reports a timeout, or retry a mutation when its reply is missing.
Correct: retain the original operation/fences and observe the exact receipt; a separately explicit safety request does not renew task consent.
Wrong: show only preview/ring text as full history, or sum overlapping test runs into a larger suite total.
Correct: expose bounded continuations/full exports and report the exact executed domain and final original exit.

### Development and verification practice

Read affected source and adjacent tests, identify the actual owner of a contract, then make the smallest coherent change.
Use ordinary source editing and directly affected checks while developing; independently review complete capabilities and run full `verify` at stable integration boundaries.
Do not run the entire suite after every local edit, but do not replace final integration with unit mocks or citation counts.
`bun run test` runs unit files in parallel, then `serialProcessFiles` (real PTY/SDK process flows) and `serialScanFiles` (>8MiB cold scans) from `vitest.config.ts` one at a time; a file belongs there only when it measurably exceeds its own waits under shared CPU.
Create a fresh 0700 root on the checkout's disk filesystem and explicitly set TMPDIR/TEMP/TMP to it; a nearly full tmpfs `/tmp` makes owners refuse at their free-space floor (`receipt-inconclusive`) and `web/dist` publication fail with EXDEV.
A test waits for the event it needs (both providers contacted, a row settled), not a wall-clock guess at how long process starts take; fixed waits stay only where time is the contract.
Use fabricated credentials, isolated browser/profile/state roots and local fixtures; never personal credentials, automatic downloads or unknown process cleanup.
Outer command budgets must cover whole suites and preserve original runner waits; existing SDK20s/child15s, PTY90s/interaction15s and browser120s/action15s fixture budgets are not increased to obtain green.
Preserve failed attempts; correct a demonstrated cause before rerunning, and never assign old failures a retrospective cause without evidence.

Regression owners:

- `service-contract`, `service-current`, `service-model-choice`, `service-auth`: closed DTOs, exact source/choice/current authority, security and compatibility.
- `service-owner`, `service-accepted-work`, `service-stop-continuation`, `service-recovery`: original operations, overlap, Stop, unknown fences and informed recovery.
- `service-scheduler`, `service-checks`, `service-human-review`, `service-accepting-host`: real SDK overlap/exclusion, native checks, review and publication.
- `worker-*`, `lightweight-sdk`, `lightweight-process-diff`: genuine SDK/tool capture, split redaction, no-spill bounds and original native facts.
- `service-history-*`: durable ordering, cold/no-index/restarted proof/search/export, corruption/torn/quota and expected-byte publication.
- `lightweight-shell`, `native-client`, `native-history`, `terminal-integration`: native consent, shared service, Unicode/paging, detach/cancel and actual source/extracted PTYs.
- `agent-panel`, `agent-panel-model`, `agent-panel-cadence`: panel keys/rendering and readonly owner observation that never starts, cancels or replays work.
- `test/web/`: adapted pure/SSR tests separately from actual built-browser contexts, HTTPS, mixed clients, focus/viewports and complete downloads.
- `package-*`, `distribution`, `service-package`, `independence`: exact tar/member/body/import/notice closure and nonactivating discovery.
- `service-autostart`, `install-config`: explicit `cadence server` registration on systemd, launchd and the Windows Run key, definition escaping, restart/disable/mask/foreign handling, orderly Stop before every change, the `.env` port and token lines and a package without install scripts.
- `service-cli`: real owners started from the `.env` port and token, reselection of a stopped workspace, edits while running and rotation of the token line.
- `workspace-landing`: home-directory redirection to `~/cadence` across management, native attach and observation.

Regenerate operator/service/native/browser outputs only through their canonical builders; `--check` variants compare new private output without overwriting canonical bytes.
Publish `web/dist` from Node: Vite run under Bun lays out its preload helper differently, so a Bun build fails a Node `build:web:check`.
Review the independently enumerated package member list and every emitted body, not a count or an expected list generated from the tar under test.
Keep public Pi peers external for the extension, the exact Undici/ws runtime edges, the exact optional SDK pins for the standalone owner and all upstream/font/vendor notices.
Preserve original license bytes through their precise Git attributes; line-ending normalization must not invalidate audited source/notice hashes.

### Release 2.0.8 acceptance snapshot

Full `verify` passed on the 2.0.8 release tree (`7a40be6` plus the version bump), in the 2.0.3 environment below.
It ran 1948 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests, 5 real-browser scenarios and the 132-member pack audit, and CI 40201203720 passed 12/12 on the candidate `1c372b2` (this commit before its snapshot).
The fix answers a 2.0.7 report: `cadence server install` refused existing `.env` files with one message.
The 2.0.7 refusal was reproduced for a 0755 directory from the older `mkdir -p` docs, 0644 editor files, umask 002 and a symlinked `~/.pi`.
Those layouts now install, a dotfiles link stays a link, and a remaining refusal (an `export` line) names its line.

### Release 2.0.7 acceptance snapshot

Full `verify` ran on the 2.0.7 release tree (`7973e23` plus the version bump), in the 2.0.3 environment below.
It passed 1945 root tests in 78 files (27 Windows-only controls skipped on Linux); `service-history-projection`'s multisegment archive test hit its 45s budget under shared load and passed alone (24 tests, 27s).
The 111 web tests, 5 real-browser scenarios and 132-member pack audit passed, and CI 40194654384 passed 12/12 on the candidate `7341cf6` (this commit before its snapshot).
`cadence server install|restart|uninstall` ran end to end in an isolated home, with a fake `systemctl` that runs the unit's own ExecStart and ExecStop.
The printed link entered the WebUI, and an earlier generated-token workspace was reselected to the `.env`.
An edit while running applied only at restart, and rotation changed only the `CADENCE_TOKEN` line.
Real systemd, launchd and Windows registration were not exercised for this release.

### Release 2.0.6 acceptance snapshot

Full `verify` passed on the 2.0.6 release tree (`8d31512` plus the version bump): 1940 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests, 5 real-browser scenarios and the 132-member pack audit, in the 2.0.3 environment below.
The package ships no install script: in isolated global installs, Bun 1.3.14 blocked three scripts for 2.0.5 (Cadence's postinstall and the Pi SDK's `@google/genai` and `protobufjs` scripts) and only those two SDK scripts for 2.0.6, and npm 11 lists only them.

### Release 2.0.5 acceptance snapshot

Full `verify` passed on the 2.0.5 release tree (`dce261b` plus the version bump): 1940 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests, 5 real-browser scenarios and the 133-member pack audit, in the 2.0.3 environment below.
On that host `cadence server status` read the live unit that 2.0.4's Pi install hook had registered as `active` and `enabled` with linger on, so earlier units stay manageable.
The launchd and Windows Run backends ran only against injected launchctl, reg.exe and orderly-Stop fakes; real macOS and Windows registration remains unqualified.

### Release 2.0.4 acceptance snapshot

Full `verify` passed on `3987f65` (the `max` thinking change): 1925 root tests in 78 files, 111 web tests, 5 real-browser scenarios and the 132-member pack audit, in the 2.0.3 environment below.
On the same host, against a real Pi 1.4.0 user-scope install and a user-configured OpenAI-compatible provider, an owner model chosen in the WebUI ran a readonly research Start end to end: the child used `ls`/`find`/`read`, settled `completed`, published its summary and recorded hidden thinking as omitted.
A concurrent Pi TUI's agent panel followed that child from launch through its tool calls to `finished (ok=1)`.
A DeepSeek model whose `thinkingLevelMap` maps only `max` became selectable at `max` and its child made tool calls at that level; editing `models.json` during that run turned the owner's views `stale` until restart, as now documented.

### Release 2.0.3 acceptance snapshot

Full `verify` passed on `c27b8ca`: 1924 root tests in 78 files (27 Windows-only controls skipped on Linux), 111 web tests in 8 files, 5 real-browser scenarios in 3 files and the 132-member real pack audit.
Observed environment: Linux x86_64, official Node 22.22.1, Bun 1.3.14, the pinned Pi SDK 0.84.3 and Chrome for Testing 153.0.8010.12; later commits change only tests and this section.
The GitHub matrix (Windows and Ubuntu × Node 22/24 × `parallel`, `serial-process`, `serial-scan`) runs on the separate CI branch.
A real Pi 1.4.0 user-scope install of the packed candidate, installed into Pi's own npm layout, registered and enabled the unit, enabled linger without a prompt and, on upgrade, stopped the old owner in order before starting the new one.
That owner started with the agent directory Pi had created at 0775 and served the built WebUI to Chromium at 1440, 390 and 320px widths.
No model-backed task ran there (no Pi provider login); macOS, physical phones, paid accounts and every adapter, and a second machine remain unqualified.

### Prior integrated acceptance snapshot

Before removal of development-workflow tooling, the integrated redesign passed full `verify`:1839 root tests/69 files,110 web tests/8 files and5 real-browser scenarios/3 files, with27 existing Windows-only controls skipped on Linux.
It also passed separate129-member/35-runtime-source real pack/extraction, all four source/extracted regular/fullscreen Pi PTYs, mixed clients, CA-validated HTTPS/WSS, plain/gzip OAuth proxy, informed recovery and complete retained-history exports.
Observed environment: Linux x86_64, Node26.7.0, Bun1.3.14, Pi0.84.3 and Chromium151.0.7922.34.
These are prior executed results, not a claim that every later edit or other environment has been tested.
The implementation/docs/evidence checkpoints are Git commits `b0fde94`, `531b158` and `2fd28b0`; historical failed/unknown outcomes are not rewritten by this summary.
Additional Windows/macOS/ConPTY, Node22/other peers, paid accounts/every adapter, physical phone/human/second-machine, package-manager installation and real deployment remain unqualified.

## Licenses and reuse

Cadence is MIT.
The substantial pinned pi-web-ui adaptations, original notices, emitted dependencies, Feather icons, KaTeX OFL fonts and vis embedded vendors are documented in [reuse and distribution](docs/reuse-and-distribution.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
Not all bundled material is covered by Cadence's MIT license.
