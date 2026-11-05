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
bun run test
bun run test:target test/service-contract.test.ts
bun run test:service
bun run test:web
bun run verify
bun pm pack --destination /absolute/private-temp
```

`bun run verify` is the sole integration and release gate, not a preliminary pass before another suite.
It runs every independent check at once: syntax, generated bundles, incremental type checks, deterministic web build checks, lint, Agent pins, fast root tests, Web unit/SSR tests and exact real-pack auditing, with a time and outcome for each stage.
There is no full verification mode, browser automation runner or browser dependency; unknown options fail before any stage starts.
Keep new gate checks short and deterministic.
Slow process/SDK/PTY/service-manager tests are not release prerequisites or automatic follow-ups, including when those areas change.
A green gate qualifies only those executed checks, not real-browser interaction, long-running process behavior, paid providers or native Windows/macOS/ConPTY operation.
Older release receipts remain historical evidence, not requirements for future releases.
No passing gate authorizes commit, push, publication, installation, deployment or cleanup.

Build/verification use a fresh private directory with `TMPDIR`, `TEMP` and `TMP` set explicitly, outside every Git working copy and on the checkout's disk filesystem rather than a nearly full tmpfs.
`scripts/verification-temp.mjs` checks this before `verify` starts any stage; it refuses invalid input without creating, redirecting or cleaning directories.
It needs a Node with TypeScript type stripping (official builds; a distro Node built without it fails `build:web:check`), but no Chromium.

## Development practice

Read affected source and adjacent tests, identify the actual owner of a contract, then make the smallest coherent change.
Use ordinary source editing and directly affected fast tests while developing; run `verify` once at a stable integration boundary or before release, not after every local edit.
`test`, `test:target` and `test:service` default to excluding the `slow` tag; `verify` also avoids importing whole files tagged `slow`.
Test workers load `test/no-fsync.mjs`, which makes fsync a no-op inside them (spawned owners and CLIs still flush): crash tests kill processes and no test simulates power loss.
A root test is tagged `slow` (`{ tags: ["slow"] }`, or `// @module-tag slow` as a whole file's first line) when it takes about 0.4 s or more alone, usually because it starts real owners, SDK workers, CLIs or crash children; short process tests stay untagged.
Retained slow tests are for explicitly requested, file-targeted diagnosis only, using `node node_modules/vitest/vitest.mjs run test/<file>.test.ts --tags-filter=slow`; do not run them as another suite or imply they passed with `verify`.
The real systemd diagnostic additionally requires `CADENCE_SYSTEMD_E2E=1` and a running user manager; it uses and removes a temporary unit under `$XDG_RUNTIME_DIR/systemd/user`, never a production service.

Use the external private temp root described above for targeted tests too.
Development may explicitly link already installed matching dependencies rather than copy/install them; `node_modules` links are ignored and Vite preserves their logical module paths, while the unchanged notice audit verifies all module bytes and membership.
This is not implicit dependency setup for consumer workflows.
A checkout-local `.cache` root makes non-Git fixtures inherit the checkout and triggers `Private state home must be outside the working copy`; this is an invalid test environment, not evidence that unrelated features broke.
A nearly full tmpfs `/tmp` makes owners refuse at their free-space floor (`receipt-inconclusive`) and `web/dist` publication fail with EXDEV.
When a plan's one-time setup has already created and marked its private temp root, implementation/check/review/repair reuse that exact directory: validate its owner marker and `assertVerificationTemp`, never recreate it or treat its expected existence as a conflict.
Keep prior evidence; each targeted Vitest JSON report uses a new filename.
Before a targeted run, assert that every named test file exists; afterward require a matching `testResults` entry for every exact path and at least one `assertionResults` item with `status: "passed"` in each file, with no failed tests/files.
Missing files, omitted files and files containing only skipped/todo cases fail coverage even if Vitest exits zero.
This targeted coverage check is not a substitute for the sole integration gate or independent automatic Agent review.
Use fabricated credentials, isolated homes/state and local fixtures; never personal credentials, automatic downloads or unknown process cleanup.
A DIRECT process-test environment has all routing variables absent, including `NO_PROXY`/`no_proxy`; wildcard bypass variables are unsupported, not a way to request direct access.
The `cadence-mode`, `history-shell`, `startup-card` and `agent-panel-cadence` fake terminal fixtures explicitly clear an inherited `CADENCE_SUBAGENT_CHILD` for their external-Pi scenario and restore it afterward; child-refusal cases set it themselves.
Production workers and checks retain the guard, including when they run verification.
A test waits for the event it needs, not a wall-clock guess; fixed waits stay only where time is the contract.
Outer command budgets must cover the selected tests; existing SDK20s/child15s and PTY90s/interaction15s fixture budgets are not increased to obtain green.

Preserve failed attempts; correct a demonstrated cause before rerunning, and never assign old failures a retrospective cause without evidence.
Do not recreate the removed project workflow integration unless explicitly requested.
Removing development tooling must never delete consumer `.cadence` data or private service state.

## Regression owners

This index includes retained slow diagnostics; their presence does not add them to the gate.
Real-browser automation has been removed, not replaced by a claim that unit tests exercise a browser.

- `cadence-mode`, `cadence-mode-pty`, `workflow-contract`, `service-workflow`: persistent conversation activation/exit/branch restoration, actual Pi POSIX TUI/on-demand-owner flow, conversation-bound models/defaults, exact plan approval, DAG validation, real SDK worktrees/checks/local integration and cancellation.
- `service-conversation-workflow`, `test/web/workflow.test.tsx`: actual SDK dialogue tools, persistent mode/model restoration, caller-bound single admission, exit/cancel separation, browser-only approval/local merge and lost-reply observation.
- `workflow-delivery`, `workflow-delivery-runtime`, `workflow-delivery-admission`, `repository-coordination`, `repository-recovery`, `change-tools`: named branch/receipt binding, exact acceptance, original-operation leases, readonly Git evidence, staged/committed scope, false merge/cleanup success and preservation/recovery.
  The full real admission case is tagged slow; controlled runtime/recovery seams are not paid-provider or real-owner qualification.
- `workflow-git`, `workbench-send-admission`: staged-versus-worktree scope, actual commit ancestry, and pre-/post-acceptance error classification without erasing uncertain attempts.
- `pi-sessions`, `service-conversation-pages`, `service-conversation-retention`, `conversation-retirement`, `conversation-records`, `test/web/conversation-reader.test.tsx`: conversations as the project's Pi sessions (directory precedence, incremental and torn-line reads, turns, read redaction, lossless parts), a browser turn's file and branches, the branch tree, live-preview counting, noncreating oversized-session refusal, command/entry correlation, current redaction, durable status and unsupported old identities without storage changes.
- `conversation-images`, `service-conversation-images`, `test/web/images.test.tsx` plus `pi-sessions`/`gateway-conversations`: chunked image uploads without count/size quotas, exact Send/caller binding, SDK images through the private pipe, model capability refusal, readonly history/branch/media projection, image-only Send, upload failure and retained preview projection.
- `abort-scope`, `service-http-client-abort`: missing static cancellation APIs individually/together, pre-cancel/first reason, full-body deadline, normal/error cleanup and no command replay or service cancellation; finite transport fixtures do not start a real owner.
- `test/web/{project-entry,conversation-send,send-observation}.test.tsx`: pre-dispatch versus unconfirmed/confirmed preparation, attachment timeout after confirmation, pinned Send fields and original uncertain command IDs, scoped wait cleanup and same-epoch reattachment without replay.
- `test/web/{project-resume,conversation-reader,workbench,stale-banner,locale}.test.tsx`: complete-link selection without storage, readonly server-held history/mode/context/work restoration, image pagination/parallel detail cancellation, retained stale observations and independent localized status/errors.
  Pure/controlled-fetch/SSR coverage is not physical Edge/Chrome/Android or production validation.
- `service-contract`, `service-model-choice`, `service-auth`: closed DTOs, exact source/choice/current authority, security and compatibility.
- `checkout-gate`, `service-owner`, `self-heal`: original operations, overlap, Stop, and startup self-healing from real crashed owners, registry locks, partial reservations, orphan workers, torn/unreadable history, half-written metadata, removed project directories and dead workbenches (live owners never reclaimed).
- `worker-*`, `lightweight-sdk`, `lightweight-process-diff`, `research-tools`, `research-tools-settlement`, `workflow-lifecycle`: genuine SDK/tool capture, split redaction, no-spill bounds and original native facts.
  `worker-toolkit` covers trusted capability assembly and immutable placement; `research-tools` covers real continuations/coverage and `research-tools-settlement` covers retained original I/O/close charges; `coordinator-tools` owns bridge admission and disposal.
  `research-tools-schema` checks object-root schemas with the installed public SDK validator and pre-send Responses serialization, not a paid-provider request.
- `service-history-*`: durable ordering, cold/no-index/restarted proof/search/export, corruption/torn/quota and expected-byte publication.
- `history-shell`, `native-client`, `native-history`, `terminal-integration`: readonly entry guards, shared service, Unicode/paging and detach; daily native approval/cancel belongs to `cadence-mode`.
- `agent-panel`, `agent-panel-model`, `agent-panel-cadence`: panel keys/rendering and readonly owner observation that never starts, cancels or replays work.
- `test/web/`: fast pure/SSR tests for presentation, client state, scoped Send/approval, retained history/images, built-asset serving, auth and content policy; no browser launch, real DOM interaction or viewport qualification.
- `package-*`, `distribution`, `service-package`, `independence`: exact tar/member/body/import/notice closure and nonactivating discovery.
- `service-autostart`, `project-start`, `install-config`: explicit `cadence server` registration on systemd (root system scope without linger, legacy user scope), launchd and the Windows Run key, separate named service definitions and directory owners, definition escaping, restart/disable/mask/foreign handling, orderly Stop before every change, the `.env` port and token lines and a package without install scripts.
- `service-installation`, `service-maintenance`, `service-maintenance-systemd`, `test/web/service-dialog.test.tsx`: exact Pi/npm/Bun copy and manager discovery (including conflicting global-directory evidence and Pi-prefix fallback refusal), pinned/ambiguous/unwritable refusal, unchanged Pi settings, explicit npm scope, complete Bun deprecation metadata, successful restart exit, confirmed new-owner Stop before rollback and partial-install restoration, cgroup and `InvocationID` proofs, the job record, and against a real user manager a child inside the service that is refused without change and a WebUI restart that a transient unit completes.
- `service-conversation-context`, `service-workflow-context`: same-checkout subdirectories and same-cwd conversations, queued/admitted model snapshots, exact stale-plan refusal, worktree/check cwd, restart/default preservation, old-identity refusal and conversation model isolation.
- `service-cli`: real owners started from the `.env` port and token, reselection of a stopped workspace, edits while running, rotation of the token line, a runtime fault's worker stop/successor/recovering restart and the readable refusal for a removed project directory.
- `workspace-landing`: no-default-workspace startup, explicit root refusal and noncreating native/readonly entry.
- `gateway-conversations`, `gateway-send`, `test/web/{conversation-send,send-observation}.test.tsx`: stopped-owner history/mode/step reads without startup or writes, unchanged draft identity across selection/first startup/Stop/refresh, exact stopped-state guards and readonly restoration; real same-origin project routing, browser-only authority, retirement on token rotation, continuing ordinary work, nonactivating selection followed by a Send that reclaims a provably dead registry lock and genuine multi-owner Stop over loopback.
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
