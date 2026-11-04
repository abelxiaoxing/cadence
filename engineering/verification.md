# Development and verification

How to develop, test and verify Cadence, which tests own which contracts, and the regression lessons every change must keep.
Read this before integrating any change.

## Commands and environment

```sh
bun run check
bun run check:web
bun run build:check
bun run lint
bun run check:agents
bun run test:service
bun run test:unit
bun run test:slow
bun run test:web
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run test:browser
bun run verify
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify:full
CADENCE_SYSTEMD_E2E=1 bun run test test/service-maintenance-systemd.test.ts
bun pm pack --destination /absolute/private-temp
```

Build/verification use a fresh private directory with `TMPDIR`, `TEMP` and `TMP` set explicitly, outside every Git working copy and on the checkout's disk filesystem rather than a nearly full tmpfs.
`scripts/verification-temp.mjs` checks this before `verify` starts any stage; it refuses invalid input without creating, redirecting or cleaning directories.
`verify` runs every independent check at once (syntax, generated bundles, incremental type checks, the web build check, lint, Agent pins, the root tests not tagged `slow`, web tests and exact real-pack auditing) and reports each stage with its time.
`verify:full` then runs the `slow`-tagged root tests and the required real-browser scenarios, one lane at a time; a missing browser is non-green, never an automatic download.
Run `verify:full` before a release and after changing a real-process or browser path; `verify` never says those lanes passed.
It needs a Node with TypeScript type stripping (official builds; a distro Node built without it fails `build:web:check`).
`verify:full` keeps short regressions and loopback browser scenarios; it runs no HTTPS-proxy browser lane or multi-MiB cold-history scan.
Fabricated loopback providers are distinct from physical humans/devices, paid accounts, package-manager installation and native Windows/macOS/ConPTY qualification.
Those additional lanes remain unqualified unless their own receipts exist.
No passing gate authorizes commit, push, publication, installation, deployment or cleanup.
The systemd lane is opt-in: it needs a running user manager and adds a temporary unit under `$XDG_RUNTIME_DIR/systemd/user`, which it removes; run it for any change to service management.

## Development practice

Read affected source and adjacent tests, identify the actual owner of a contract, then make the smallest coherent change.
Use ordinary source editing and directly affected checks while developing; independently review complete capabilities and run `verify` at stable integration boundaries.
Do not run the entire suite after every local edit, but do not replace final integration with unit mocks or citation counts.
`bun run test` runs every root file in one parallel group, `test:unit` skips the `slow` tag and `test:slow` runs only it.
Its workers load `test/no-fsync.mjs`, which makes fsync a no-op inside them (spawned owners and CLIs still flush): crash tests kill processes and no test simulates power loss.
A root test is tagged `slow` (`{ tags: ["slow"] }`, or `// @module-tag slow` as a whole file's first line) when it takes about 0.4 s or more alone, usually because it starts real owners, SDK workers, CLIs or crash children; short process tests stay untagged, so `verify` keeps them and stays fast.
Use the external private temp root described above for targeted tests too.
A checkout-local `.cache` root makes non-Git fixtures inherit the checkout and triggers `Private state home must be outside the working copy`; this is an invalid test environment, not evidence that unrelated features broke.
A nearly full tmpfs `/tmp` makes owners refuse at their free-space floor (`receipt-inconclusive`) and `web/dist` publication fail with EXDEV.
Keep that root's absolute path short: Chromium appends fixture and singleton-socket components, and an overly long path makes it abort before browser scenarios begin.
A test waits for the event it needs (both providers contacted, a row settled), not a wall-clock guess at how long process starts take; fixed waits stay only where time is the contract.
The same-checkout restart browser scenario observes stopped readiness and successful cold conversation head/context reads before its one explicit Send; a read refusal racing Stop permits preparation only, not message admission.
Use fabricated credentials, isolated browser/profile/state roots and local fixtures; never personal credentials, automatic downloads or unknown process cleanup.
Outer command budgets must cover whole suites and preserve original runner waits; existing SDK20s/child15s, PTY90s/interaction15s and browser120s/action15s fixture budgets are not increased to obtain green.
The browser local-delivery scenario uses those distinct bounds: a consumed plan and a displayed result are UI observations (15s each); the accepted run is observed readonly under the original 120s scenario deadline, begun before setup, with its final action window reserved for UI/teardown.
`test/helpers/workflow-observation.ts` never renews that deadline on progress or retries a mutation; a merge hash alone is not settlement, and every terminal non-success remains non-success.
Its receipt records the latest run/read refusal and sampled state changes before fixture Stop, then records cleanup failures separately; observation timestamps are not native step timing.

Preserve failed attempts; correct a demonstrated cause before rerunning, and never assign old failures a retrospective cause without evidence.
Do not recreate the removed project workflow integration unless explicitly requested.
Removing development tooling must never delete consumer `.cadence` data or private service state.

## Regression owners

- `cadence-mode`, `cadence-mode-pty`, `workflow-contract`, `service-workflow`: persistent conversation activation/exit/branch restoration, actual Pi POSIX TUI/on-demand-owner flow, conversation-bound models/defaults, exact plan approval, DAG validation, real SDK worktrees/checks/local integration and cancellation.
- `service-conversation-workflow`, `workflow-observation`, `test/web/workflow.test.tsx`, `test/web/cadence-browser.e2e.mjs`: actual SDK dialogue tools, persistent mode/model restoration, caller-bound single admission, exit/cancel separation, browser-only approval/local merge and lost-reply observation.
- `workflow-git`, `workbench-send-admission`: staged-versus-worktree scope, actual commit ancestry, and pre-/post-acceptance error classification without erasing uncertain attempts.
- `pi-sessions`, `service-conversation-pages`, `service-conversation-retention`, `conversation-retirement`, `conversation-records`, `workbench-browser`, `conversation-history-browser`, `test/web/conversation-reader.test.tsx`: conversations as the project's Pi sessions (directory precedence, incremental and torn-line reads, turns, read redaction, lossless parts), a browser turn's file and branches, a browser turn continuing a 1000-turn terminal session among 205, the branch tree, live-preview counting, noncreating oversized-session refusal, command/entry correlation, current redaction, durable status and unsupported old identities without storage changes.
- `service-contract`, `service-model-choice`, `service-auth`: closed DTOs, exact source/choice/current authority, security and compatibility.
- `checkout-gate`, `service-owner`, `self-heal`: original operations, overlap, Stop, and startup self-healing from real crashed owners, registry locks, partial reservations, orphan workers, torn/unreadable history, half-written metadata, removed project directories and dead workbenches (live owners never reclaimed).
- `worker-*`, `lightweight-sdk`, `lightweight-process-diff`, `research-tools`, `research-tools-settlement`, `workflow-lifecycle`: genuine SDK/tool capture, split redaction, no-spill bounds and original native facts.
- `service-history-*`: durable ordering, cold/no-index/restarted proof/search/export, corruption/torn/quota and expected-byte publication.
- `history-shell`, `native-client`, `native-history`, `terminal-integration`: readonly entry guards, shared service, Unicode/paging and detach; daily native approval/cancel belongs to `cadence-mode`.
- `agent-panel`, `agent-panel-model`, `agent-panel-cadence`: panel keys/rendering and readonly owner observation that never starts, cancels or replays work.
- `test/web/`: adapted pure/SSR tests separately from actual built-browser contexts; `accepting-browser` seeds fabricated archived records without a task executor or model call, then checks a cold generated owner, retired controls, exact search, complete downloads and viewports; `cadence-browser` covers current browser approval/execution/cancel.
- `package-*`, `distribution`, `service-package`, `independence`: exact tar/member/body/import/notice closure and nonactivating discovery.
- `service-autostart`, `project-start`, `install-config`: explicit `cadence server` registration on systemd (root system scope without linger, legacy user scope), launchd and the Windows Run key, separate named service definitions and directory owners, definition escaping, restart/disable/mask/foreign handling, orderly Stop before every change, the `.env` port and token lines and a package without install scripts.
- `service-maintenance`, `service-maintenance-systemd`, `test/web/service-dialog.test.tsx`: cgroup and `InvocationID` proofs, the job record, upgrade fetch/stop/install/rollback order, and against a real user manager a child inside the service that is refused without change and a WebUI restart that a transient unit completes.
- `service-conversation-context`, `service-workflow-context`, `conversation-context-browser`: same-checkout subdirectories and same-cwd conversations, queued/admitted model snapshots, exact stale-plan refusal, worktree/check cwd, restart/default preservation, old-identity refusal and two-tab model isolation.
- `service-cli`: real owners started from the `.env` port and token, reselection of a stopped workspace, edits while running, rotation of the token line, a runtime fault's worker stop/successor/recovering restart and the readable refusal for a removed project directory.
- `workspace-landing`: no-default-workspace startup, explicit root refusal and noncreating native/readonly entry.
- `gateway-conversations`, `gateway-send`, `gateway-browser`, `send-entry-browser`, `test/web/{conversation-send,send-observation}.test.tsx`: stopped-owner history/mode/step reads without startup or writes, unchanged draft identity across selection/first startup/Stop/refresh, exact stopped-state guards and readonly restoration; real same-origin project routing, browser-only authority, retirement on token rotation, continuing ordinary work, nonactivating selection followed by a Send that reclaims a provably dead registry lock and genuine multi-owner Stop over loopback.
  Preparation needs fresh auth/build/CSRF, sends no message or approval, does not adopt a merely browsed independent owner, and adds no warm-Send receipt quota; lost preparation/Send replies and departure cannot replay or rebind a message.
  Same-epoch re-entry waits for the new observation generation, never the previous attachment.

## Builds and packaging

Regenerate operator/service/native/browser outputs only through their canonical builders; `--check` variants compare new private output without overwriting canonical bytes.
Publish `web/dist` from Node: Vite run under Bun lays out its preload helper differently, so a Bun build fails a Node `build:web:check`.
Review the independently enumerated package member list and every emitted body, not a count or an expected list generated from the tar under test.
Keep public Pi peers external for the extension, the exact Undici/ws runtime edges, the exact optional SDK pins for the standalone owner and all upstream/font/vendor notices.
Preserve original license bytes through their precise Git attributes; line-ending normalization must not invalidate audited source/notice hashes.

## Validation and regression lessons

| Condition                                                      | Required behavior                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Missing/unsafe/corrupt/partial selected state                  | Readonly observation changes nothing; startup archives what a dead owner left half-written            |
| Native exit0 with recording/stdin/final/cleanup failure        | Preserve native zero independently; no workflow success                                               |
| Stale grant, selected task bytes or model/source identity      | Refuse and require fresh observation/confirmation                                                     |
| Unknown original stop/auth/storage or changed lease            | Quarantine, settle, stop own ledger workers, exit; the successor's startup heal recovers it           |
| Failed/unrun/stale check, partial child or incomplete coverage | Explicit issues review; preserve independent recorded outcomes                                        |
| Lost reply or detached view                                    | Observe original receipt/run; no mutation replay or implicit Cancel                                   |
| Invalid read proof or changed source/key                       | Refuse; never rebase or interpret budget exhaustion as absence                                        |
| Dirty/partial/extra compiled assets or unsafe archive          | Refuse in place; no source refill, wildcard serving or fallback build                                 |
| Extension import outside Pi aliases declared only as a peer    | Exact production dependency; Pi's install omits peers and Pi fails to start                           |
| Missing optional SDK or Pi `auth.json`                         | Project-less workbench may start without loading either; explicit project startup retains its refusal |
| Package files hard-linked into a package manager's store (Bun) | Packaged reads ignore link count, bind exact bodies; other files stay single-link                     |
| Host refuses during startup                                    | Fixed code/stage only; a registered host exits too and the next start recovers its registration       |
| Workspace containing the private state home                    | Refuse the project selection; no redirection, default directory or state relocation                   |
| Restart changes the definition's workspace or Node path        | Stop with the loaded definition before rewriting, not only a signal                                   |
| npm 12 or Bun skips untrusted install scripts by default       | Ship none; `cadence server install` registers the service and creates the template                    |
| Service manager that only signals (launchd, Windows login)     | Orderly Stop first; an unconfirmed Stop changes nothing; no SIGTERM or `taskkill`                     |
| Pi's TUI replaces an info status with the next one             | The missing-service hint is its own warning notification                                              |
| Token source the user edits (`CADENCE_TOKEN` in `.env`)        | Read once before binding, never bound for the run: an edit cannot fence Stop                          |
| Saved port/token source differs from `.env`                    | Only when stopped, reselect just those under the reservation; running ones refuse                     |
| User-made `.env` (0755/0644, umask 002, dotfiles links)        | Like Pi's sources: ownership only, links followed; each refusal names its reason                      |
| Credential value inside a provider/model ID (Ollama `ollama`)  | Withhold and count only that catalog entry; choosing it refuses; others selectable                    |
| Git output past its buffer/time bound (`node_modules` listing) | Hash a fixed outcome, never pipe-timed partial bytes: an unchanged tree keeps one identity            |
| Long streamed reply captured chunk by chunk                    | Track sizes and preview heads incrementally; rescans stalled the owner and failed reads               |
| models.json edited while the owner runs                        | Redact session reads with the last observed literals; never fail history or return it unredacted      |
| A terminal message sent from the same entry as a browser turn  | Use the worker-recorded command/user-entry marker, including when both sides send identical text      |
| A turn's steps watched live, then failing without an answer    | Derive the fold from the settled turn on every render, not from mount-time state; user toggles win    |
| A shown list re-read in the background (sidebar polling)       | Keep the rows in place; only a page with no rows yet shows its reading hint                           |
| Power loss or shutdown while an owner runs (idle or busy)      | Next start proves the holder dead (boot ID, PID, start identity) and recovers; no typed confirmation  |
| Systemd unit pointing at a removed project directory           | Readable refusal, exit78 (no restart loop); its dead reservation is released account-wide             |

Good: current context → exact plan approval → durable acceptance → genuine original native/auth/storage settlement → real checks → automatic Agent review.
Archived human Review is not a new workflow approval.
Base: a client leaves and another reattaches to the same accepted run without launching it again.
Bad: model prose, a valid cursor, a prepared graph, one native exit or a human Done checkbox becomes fabricated execution/check success.

Wrong: release a reservation when `Promise.race` reports a timeout, or retry a mutation when its reply is missing.
Correct: retain the original operation/fences and observe the exact receipt; a separately explicit safety request does not renew task consent.
Wrong: show only preview/ring text as full history, or sum overlapping test runs into a larger suite total.
Correct: expose bounded continuations/full exports and report the exact executed domain and final original exit.
