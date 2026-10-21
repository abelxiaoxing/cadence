# Cadence

`@abelxiaoxing/cadence` is a shared Pi task workspace with two independently usable clients: native `/cadence` and a browser WebUI.
One persistent service owns tasks, bounded subagent collaboration, real parent checks and retained history.
Ordinary conversations, resource discovery and opening history never start work or a service.
On Linux, Pi's user-scope install registers that service as a systemd user unit and starts its WebUI on the default address.

This is a trusted workflow assistant, **not a sandbox, certified executor or transactional application system**.
Code workers edit the chosen working copy directly; recovery can require human work.
Model prose, tool results and human Done do not certify checks or code.

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
cadence-service start --workspace /absolute/project
cadence-service status --workspace /absolute/project
cadence-service token-link --workspace /absolute/project --reveal
```

Use the installed `cadence-service` bin, or `node /absolute/cadence/src/service-cli.mjs` followed by those arguments.
Default binding is numeric loopback `127.0.0.1:17423`; `--foreground` is available for an explicitly configured supervisor.
Start reads the existing Pi agent directory (or an explicit private configuration), never creates another login/profile.
A directory that contains the private state home (the home directory and its ancestors, such as `C:\Users\<you>`) cannot be a workspace, so commands there use `~/cadence` instead of refusing; only `start` creates it, and `/cadence` started there attaches to that owner.
See [service management](docs/service-management.md) for configuration, model/auth policy, Stop, diagnosis and informed recovery.

### Linux autostart after `pi install`

`pi install npm:@abelxiaoxing/cadence` (user scope) writes `~/.local/share/systemd/user/cadence.service`, enables it and starts the owner for `~/cadence` on `http://127.0.0.1:17423`.
Set an existing absolute `CADENCE_WORKSPACE` at install to choose another workspace, or `CADENCE_AUTOSTART=0` to skip registration.
Enter the WebUI once with the link from `cadence-service token-link --workspace ~/cadence --reveal`; installation prints that command, not the token.
Each `pi update` restarts the unit through orderly Stop, so running work is stopped rather than detached; `systemctl --user disable --now cadence` or `mask` is kept across upgrades.
Run `cadence-service autostart remove` before `pi remove`.
The npm client hides dependency install-script output, and with `strict-allow-scripts` it skips those scripts entirely.
Approve Cadence once with `npm install-scripts approve @abelxiaoxing/cadence` inside `~/.pi/agent/npm` (or `npm config set allow-scripts=@abelxiaoxing/cadence --location=user`), or run `cadence-service autostart install`; `/cadence` names that command while no unit is registered.
Until the optional SDK and Pi's `auth.json` exist, registration or start waits instead of quarantining an owner.
See [the systemd user unit](docs/service-management.md#linux-systemd-user-unit) for exact behavior and limits.

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

### Browser

Open the locally revealed token link.
Valid bootstrap redirects to a token-free URL and uses an HttpOnly SameSite cookie for subsequent HTTP/WebSocket access; no localStorage token copy.
The browser can create/plan/Start/Cancel, run exact configured checks and record human review without a live Pi terminal.
A token grants workspace access, not action consent.
Every mutation needs its own context-bound preview/confirmation; stale/duplicate/lost replies do not silently replay work.
The WebUI provides task/run/assignment navigation, long retained messages and tool detail, exact literal search, timeline and complete scoped NDJSON/Markdown downloads.
Desktop panes and phone drawers retain cancellation and keyboard controls.

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
  Missing-only user `.env` template creation is the sole postinstall behavior; no service/build/Git/provider operation runs.
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

Build/verification use a fresh private directory with `TMPDIR`, `TEMP` and `TMP` set explicitly.
`verify` includes native/unit tests, web tests, required real-browser scenarios and exact real-pack auditing; missing required browser is non-green, never an automatic download.
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
| `src/service/host.ts`, `src/service/cli.ts`, `src/service/autostart.ts`                                | Real single-owner composition, explicit management and the generated Linux user unit; management entry stays SDK-free     |
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
| Install without the optional SDK or Pi `auth.json`             | No unit registration or start; a first owner without them quarantines               |
| Workspace containing the private state home                    | Land on `~/cadence` (only start creates it); never move state into the working copy |
| Upgrade changes the unit workspace or Node path                | Stop with the loaded unit definition before rewriting, not only SIGTERM             |

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
On this development host create fresh0700 disk roots under `/home/mirako/abel` and explicitly set TMPDIR/TEMP/TMP; `/tmp` is inode-exhausted.
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
- `test/web/`: adapted pure/SSR tests separately from actual built-browser contexts, HTTPS, mixed clients, focus/viewports and complete downloads.
- `package-*`, `distribution`, `service-package`, `independence`: exact tar/member/body/import/notice closure and nonactivating discovery.
- `service-autostart`, `install-config`: Pi user-scope gating, unit escaping, upgrade/disable/mask/foreign handling and orderly removal.
- `workspace-landing`: home-directory redirection to `~/cadence` across management, native attach and observation.

Regenerate operator/service/native/browser outputs only through their canonical builders; `--check` variants compare new private output without overwriting canonical bytes.
Review the independently enumerated package member list and every emitted body, not a count or an expected list generated from the tar under test.
Keep public Pi peers external for the extension, the exact Undici/ws runtime edges, the exact optional SDK pins for the standalone owner and all upstream/font/vendor notices.
Preserve original license bytes through their precise Git attributes; line-ending normalization must not invalidate audited source/notice hashes.

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
