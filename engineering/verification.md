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
bun run test:web
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run test:browser
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
bun pm pack --destination /absolute/private-temp
```

Build/verification use a fresh private directory with `TMPDIR`, `TEMP` and `TMP` set explicitly, on the checkout's disk filesystem rather than a nearly full tmpfs.
`verify` includes native/unit tests, web tests, required real-browser scenarios and exact real-pack auditing; missing required browser is non-green, never an automatic download.
It needs a Node with TypeScript type stripping (official builds; a distro Node built without it fails `build:web:check`).
`verify` keeps short regressions and loopback browser scenarios; it runs no real PTY workflow, HTTPS-proxy browser lane or multi-MiB cold-history scan.
Fabricated loopback providers are distinct from physical humans/devices, paid accounts, package-manager installation and native Windows/macOS/ConPTY qualification.
Those additional lanes remain unqualified unless their own receipts exist.
No passing gate authorizes commit, push, publication, installation, deployment or cleanup.

## Development practice

Read affected source and adjacent tests, identify the actual owner of a contract, then make the smallest coherent change.
Use ordinary source editing and directly affected checks while developing; independently review complete capabilities and run full `verify` at stable integration boundaries.
Do not run the entire suite after every local edit, but do not replace final integration with unit mocks or citation counts.
`bun run test` runs every root file in one parallel group; there are no serial groups or separate fast/integration lanes.
Its workers load `test/no-fsync.mjs`, which makes fsync a no-op inside them (spawned owners and CLIs still flush): crash tests kill processes and no test simulates power loss.
Create a fresh 0700 root on the checkout's disk filesystem and explicitly set TMPDIR/TEMP/TMP to it; a nearly full tmpfs `/tmp` makes owners refuse at their free-space floor (`receipt-inconclusive`) and `web/dist` publication fail with EXDEV.
Keep that root's absolute path short: Chromium appends fixture and singleton-socket components, and an overly long path makes it abort before browser scenarios begin.
A test waits for the event it needs (both providers contacted, a row settled), not a wall-clock guess at how long process starts take; fixed waits stay only where time is the contract.
Use fabricated credentials, isolated browser/profile/state roots and local fixtures; never personal credentials, automatic downloads or unknown process cleanup.
Outer command budgets must cover whole suites and preserve original runner waits; existing SDK20s/child15s, PTY90s/interaction15s and browser120s/action15s fixture budgets are not increased to obtain green.
Preserve failed attempts; correct a demonstrated cause before rerunning, and never assign old failures a retrospective cause without evidence.
Do not recreate the removed project workflow integration unless explicitly requested.
Removing development tooling must never delete consumer `.cadence` data or private service state.

## Regression owners

- `service-contract`, `service-current`, `service-model-choice`, `service-auth`: closed DTOs, exact source/choice/current authority, security and compatibility.
- `service-owner`, `service-accepted-work`, `service-recovery`, `service-registry-recovery`: original operations, overlap, Stop, unknown fences and informed recovery.
- `worker-*`, `lightweight-sdk`, `lightweight-process-diff`: genuine SDK/tool capture, split redaction, no-spill bounds and original native facts.
- `service-history-*`: durable ordering, cold/no-index/restarted proof/search/export, corruption/torn/quota and expected-byte publication.
- `lightweight-shell`, `native-client`, `native-history`, `terminal-integration`: native consent, shared service, Unicode/paging and detach/cancel.
- `agent-panel`, `agent-panel-model`, `agent-panel-cadence`: panel keys/rendering and readonly owner observation that never starts, cancels or replays work.
- `test/web/`: adapted pure/SSR tests separately from actual built-browser contexts; `accepting-browser` drives one real SDK Start, check, review and departure-without-cancel workflow with mixed clients, focus/viewports and complete downloads.
- `package-*`, `distribution`, `service-package`, `independence`: exact tar/member/body/import/notice closure and nonactivating discovery.
- `service-autostart`, `project-start`, `install-config`: explicit `cadence server` registration on systemd (root system scope without linger, legacy user scope), launchd and the Windows Run key, separate named service definitions and directory owners, definition escaping, restart/disable/mask/foreign handling, orderly Stop before every change, the `.env` port and token lines and a package without install scripts.
- `service-cli`: real owners started from the `.env` port and token, reselection of a stopped workspace, edits while running and rotation of the token line.
- `workspace-landing`: no-default-workspace startup, explicit root refusal and noncreating native/readonly entry.
- `gateway-browser`: real same-origin project routing, browser-only authority, retirement on token rotation, continuing ordinary work and genuine multi-owner Stop over loopback.
- `gateway-recovery`: real crashed owners/resolvers, exact gateway-only release, preserved project fences and unfinished openings, retired/reopened associations, live/remote/changed/linked refusals, generated CLI diagnostics and native-TTY host/process/credential/storage acknowledgments.

## Builds and packaging

Regenerate operator/service/native/browser outputs only through their canonical builders; `--check` variants compare new private output without overwriting canonical bytes.
Publish `web/dist` from Node: Vite run under Bun lays out its preload helper differently, so a Bun build fails a Node `build:web:check`.
Review the independently enumerated package member list and every emitted body, not a count or an expected list generated from the tar under test.
Keep public Pi peers external for the extension, the exact Undici/ws runtime edges, the exact optional SDK pins for the standalone owner and all upstream/font/vendor notices.
Preserve original license bytes through their precise Git attributes; line-ending normalization must not invalidate audited source/notice hashes.

## Validation and regression lessons

| Condition                                                      | Required behavior                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Missing/unsafe/corrupt/partial selected state                  | Absent or fixed refusal; no bootstrap, adoption, repair or cleanup on observation                     |
| Native exit0 with recording/stdin/final/cleanup failure        | Preserve native zero independently; no workflow success                                               |
| Stale grant, selected task bytes or model/source identity      | Refuse and require fresh observation/confirmation                                                     |
| Unknown original stop/auth/storage or changed lease            | Retain fences/charges; no guessed process signaling or automatic release                              |
| Failed/unrun/stale check, partial child or incomplete coverage | Explicit issues review; preserve independent recorded outcomes                                        |
| Lost reply or detached view                                    | Observe original receipt/run; no mutation replay or implicit Cancel                                   |
| Invalid read proof or changed source/key                       | Refuse; never rebase or interpret budget exhaustion as absence                                        |
| Dirty/partial/extra compiled assets or unsafe archive          | Refuse in place; no source refill, wildcard serving or fallback build                                 |
| Extension import outside Pi aliases declared only as a peer    | Exact production dependency; Pi's install omits peers and Pi fails to start                           |
| Missing optional SDK or Pi `auth.json`                         | Project-less workbench may start without loading either; explicit project startup retains its refusal |
| Package files hard-linked into a package manager's store (Bun) | Packaged reads ignore link count, bind exact bodies; other files stay single-link                     |
| Host refuses during startup                                    | Fixed code/stage only; unregistered exits `refused`, registered stays `quarantined`                   |
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

Good: current context → explicit grant → durable acceptance → genuine original native/storage settlement → exact retained dependency → real checks → human review.
Base: a client leaves and another reattaches to the same accepted run without launching it again.
Bad: model prose, a valid cursor, a prepared graph, one native exit or a human Done checkbox becomes fabricated execution/check success.

Wrong: release a reservation when `Promise.race` reports a timeout, or retry a mutation when its reply is missing.
Correct: retain the original operation/fences and observe the exact receipt; a separately explicit safety request does not renew task consent.
Wrong: show only preview/ring text as full history, or sum overlapping test runs into a larger suite total.
Correct: expose bounded continuations/full exports and report the exact executed domain and final original exit.
