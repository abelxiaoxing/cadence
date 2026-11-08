# Admission, execution and lifetimes

How work is admitted, scheduled, stopped and recovered, and which original operations hold fences.
Read this before changing admission, scheduling, Stop, registry or recovery behavior.

## Conversation workflow lifetime

Conversation workflows have their own versioned private journal under the existing exact project owner.
They acquire the same checkout gate as ordinary conversations and retain it until all original workers/checks/auth/storage settle.
Model-request recovery stays inside the original SDK session and worker deadline; its checkout gate remains held during abortable backoff.
The SDK alone retries failed responses, retaining completed tool results and never repeating the user's Send, a tool operation or a whole workflow step.
A terminal model-request failure (recovery exhausted or nonretryable) ends delivery after actual cleanup, rather than starting a second network retry or provider-dependent diagnosis loop.
Unknown closure never releases the gate, and cleanup quarantine cannot be overwritten by a completed workflow status.
Within that barrier, implementation assignments run in one stable candidate, preserving predecessor and partial-attempt outputs.
The initial dependency order can share write paths; readonly questions within a research run may still overlap.
A local-merge candidate lives under `<stateHome>/cadence-worktrees-v1/<project-hash>/<run>/integration` (0700, outside the private service namespace and checkout).
The candidate is on one named task branch created only after approval; mode entry, research and clarification create no Git resources.
Git mutation groups also hold a short common-directory lease after the checkout permit, never while waiting for workers or checks.
Managed candidate worktrees cannot start another owner; exact-owner healing releases coordination records without deleting retained Git artifacts.
See [worktree delivery](worktree-delivery.md) for creation, exact acceptance and retention.
Retained task worktrees from earlier releases remain untouched.
Direct working-copy delivery serializes edits without Git mutation.
The terminal is never an embedded executor.
One fresh 120s grant binds the exact displayed version-2 delivery agreement, model source, project observation and owner epoch.
The agreement explicitly allows service-owned diagnosis, remaining-work splitting and alternative implementations inside its immutable goal, decisions, acceptance, write paths and exact commands; a model cannot change those permissions.
There is no total delivery deadline or fixed repair-round quota.
Each worker/check still has its native deadline and original closure requirements.
Settled failures enter readonly diagnosis; authority, scope, storage, cancellation and unknown-closure failures never authorize another attempt.
Identical strategy and unchanged failure/source evidence stop a nonprogressing route.
A concrete external blocker is retained as an unsuccessful delivery, never success or a fabricated user request.
The general workflow command remains native-only.
Browser confirmation uses a separate conversation-bound boundary; both reach the same execution owner.
Browser grants additionally bind the authenticated attachment/access generation and exact conversation revision/head, and are consumed before dispatch; a parallel tab cannot accept the same proposal twice.
Browser access authentication is not execution consent.
A fresh conversation Send can report no effect only from a healthy owner, after excluding prior/partial attempts and before registering original work or writing control/acceptance state.
A server-only refusal type carries this proof to HTTP; error names alone never establish it.
Prior attempts, partial writes and lost replies remain uncertain and observe-only.
Coordinator turns are owner-accounted originals but hold no checkout barrier; only their finite delegated investigations acquire that gate.
Coordinator interruption joins its own investigations, not a previously approved implementation.
No restart replays an unfinished workflow.
At startup a run left queued/running (or accepted without a snapshot) is recorded as `unknown` with a notice that the owner restarted, nothing was inferred or replayed, and worktrees and partial edits are retained (an integrating run may have fast-forwarded); unreadable records stay untouched and do not fence startup.
Stop joins the shared owner accounting.
Workflow cancel needs only the lease and epoch, so it works while the owner is quarantined or stopping; the fast-forward merge itself is never interrupted, and if HEAD cannot be re-read after it the run ends `unknown`, not failed.
An interrupted run's notice says it was interrupted and that starting it again continues the work; its outcome is still `unknown`, never inferred.
A native workflow command refused before any write, grant or admission for a never-attempted ID, by a healthy owner, reports no effect; anything else stays uncertain.
Access rotation does not revoke an accepted worker's pinned model choice; source/epoch changes still refuse.

## Retired task execution

The old task action/admission/graph scheduler and foreground controller are deleted.
Current workflows and ordinary turns use the independent `CheckoutGate`, not an old task object.
Legacy HTTP task preflight/command/cancel operations refuse; an archived run ID is not a handle to a live process.
Current workflow Cancel, conversation Interrupt and exact-owner Stop remain independent.
Historical graph/check/publication facts retain their original meaning, but no task execution is reconstructed from them.
The remaining historical writer and transport coupling is documented in [architecture](architecture.md).

## Admission, execution and original lifetimes

- One canonical checkout/state-home domain has one persistent owner, including while idle.
  Explicit project launch uses a new port only for a new checkout selection; reopened projects retain their saved default cwd/port/history, and no project navigation changes another owner's execution.
  Root Git observations require Git's own ownership check: reset `safe.directory` exceptions per command, drop inherited `SUDO_UID` and disable fsmonitor, without configuration writes or ownership changes.
  Merely selecting a foreign-owned repository cannot grant permission to run its clean/process filters; use its owning account instead.
  Ordinary-user Git trust behavior remains unchanged.
  System services require uid0, bypass user managers/logind entirely and require confirmed native Stop before manager stop or definition replacement; changed state-home inputs, old user units and detached running owners refuse implicit adoption.
  Registry reservation atomically rejects canonical ancestor/descendant overlaps, including nested Git roots and aliases; a different state-home does not coordinate arbitrary other owners.
- The short global registry lock never expires by age; see [self-healing](#self-healing) for when its holder is proven dead.
  Missing retained project directories do not invalidate the global registry: canonical existing ancestors, aliases and overlaps are still checked, and a dead owner's reservation is released by the next start or `cadence doctor`.
- Generated Linux units exclude deterministic foreground refusal exit78 from restart; manager acceptance without authenticated readiness is not reported as successful startup.
- Native entry requires fresh raw Enter within1500ms, trusted/idle TUI, no pending modal/messages and no child guard.
  Browser authentication grants access, not task consent; normal mutation ingress also requires independently built compatible client/service/assets identities.
- Boot installs no conversation model.
  Explicit Send/model choice restores its own credential-free preference (or the default/current Pi model for a new conversation) into a retained source selection.
  Already admitted turns/workflows own immutable cwd/checkout/model snapshots; fresh proposals and approvals still validate the current conversation version.
  The project process and model source runtime launch at the checkout root; a provably removed saved default cwd remains metadata and cannot strand other valid conversation directories.
  Unscoped callers do not silently fall back to the root.
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
  Within a running owner, a reporting timeout, a caught promise, PID absence or an empty roster cannot release resources; only a successor's startup heal reclaims them.
  Stop publishes one shared attempt, quiesces all admissions, requests stops before awaiting children and joins permitted original continuation/safety writes.
  Already-started publication can finish; new post-Stop ordinary publication cannot start.
- TERM/KILL recheck lease ownership at each signal boundary.
  Stop sends TERM and arms KILL/unknown timers before observer or coordinator interruption callbacks; lifecycle observation performs no synchronous journal I/O.
  Native close is authoritative for the direct child, not `exit`, EOF or escaped-descendant closure.
  Unknown process/auth/storage settlement quarantines the running owner; late completion never retroactively repairs an unknown result.
  A quarantined owner lets original work settle (bounded), stops its own ledger-recorded workers and exits; the replacement (a successor it spawns, or its systemd unit) recovers it at startup.
- Return, navigation, browser disconnect and Pi quit detach accepted work.
  Reconnect does not resend mutations; a refused Cancel permits only another explicit click, not automatic retry.

## Workbench Stop

Workbench state lives separately under `<state-home>/cadence-assistant-v1/workbenches-v1/<configuration-hash>/`, not in a hidden substitute workspace.
Whole-workbench Stop joins its accepted Send preparations and associated exact-epoch project owners, serializing their final registry releases; unrelated, unassociated owners are not stopped.
An associated owner that is not running (stopped, crashed, restarted under a new epoch or its directory removed) has nothing to stop; one whose Stop is unconfirmed keeps its own state, and the workbench still releases its own registration.
The gateway follows an associated project's restarted owner (same canonical path, new epoch) instead of refusing its page as stale.
Selected-only directories have a null epoch and are not Stop associations; browsing their existing owner never changes that.
A Send preparation registers its original before launching, so departure cannot abandon startup and Stop joins any owner it creates.
Warm already-associated reuse writes no preparation receipt; a lost preparation response never submits a message.
Service restart never resumes the old queue.

Readonly model discovery has no execution authority, but its child processes have owned lifetimes: the gateway starts Stop on them immediately, then joins actual native close before releasing its registration.
Concurrent identical requests share one child; an HTTP disconnect only abandons the viewer, not the bounded original or its process charge.
Timeout/invalid output request TERM and then KILL under the original lease and process identity; unconfirmed closure quarantines discovery and keeps its charge/ledger, even if a later close arrives.
A workbench that cannot close its discovery child stops its associated owners, preserves its registration/worker ledger and exits 75 for supervisor/startup recovery, without replaying project work.
The child has a parent-owned IPC channel and exits on parent loss; its own process group is also recorded in the existing exact-identity ledger for recovery after a dead workbench.
Startup refuses recovery while a ledger worker is live but unidentifiable or its identity is unknown, rather than treating an unreadable identity as proof of closure.

## Service restart and upgrade

Stopping a systemd unit ends every process in its cgroup, including a management command that one of the service's own tools started, however it was detached (`nohup`, `setsid`, double fork).
The `server install|restart|stop|uninstall|upgrade` commands therefore compare `/proc/self/cgroup` with the unit's `ControlGroup` before any change, including the `.env` key append, and refuse inside it with `inside-service`; child-process cleanup is never weakened to make them survive.
The WebUI's restart and upgrade run the same CLI outside that cgroup: the gateway proves its own unit (cgroup name, generated definition, `InvocationID` equal to its `INVOCATION_ID`, its own `.env`) and starts `systemd-run --collect` as `cadence[-NAME].maintenance.service`, whose fixed name admits one job at a time, with the environment the definition bakes plus the gateway's `HOME`.
A request names the version, target, epoch and running-work count the browser confirmed; any difference is `stale`, and running work is named and stopped only by its orderly Stop.
The job records its outcome in `maintenance.json` beside the workbench registration; a job that ends without reporting reads as `interrupted`, and the job's journal never carries the private link.
An upgrade (Linux, a proven Pi/npm/Bun installation the account can write) resolves one exact version through its own package manager and prefetches both that and the previous version while the service still runs.
Pi's user settings select npm or Bun; version pins and custom wrapper commands refuse, without any settings edit.
Global roots come from the managers; Bun additionally needs its own lock evidence because its listing also accepts npm trees.
Local installs require a direct dependency and an unambiguous manager lockfile; Pi-managed prefixes cannot fall back into that route.
Linked checkouts and ambiguous sources refuse.
Bun prefetches in fresh private staging with scripts disabled, then removes only that staging; no configuration or profile is copied.
The installation and installed version are rechecked after the fetch, before orderly Stop; only the same prefix/manager may install and roll back.
The new copy's own `server restart` must exit successfully and become ready, and its actual installed version must match; failed/partial installs restore the previous version before any restart rather than starting a broken copy.
An attempted new-owner startup that does not confirm readiness is not proof of exit: its own orderly Stop must confirm before rollback may overwrite it; an unconfirmed Stop leaves the installed version intact.
Service definitions retain explicit package-manager location/config-file environment paths, never registry credentials.
On macOS and Windows, restart and upgrade stay in a terminal: their managers' process tracking for a job that outlives the service has not been qualified.

## Self-healing

A process that ends without its orderly Stop (power loss, shutdown, crash, `kill -9`, a supervisor's SIGKILL) leaves its registration and locks.
Every start (`cadence start`, `project open`, workbench start, native `/cadence`, the host itself) heals them before acquiring, through `src/service/self-heal.ts`:

- New locks (registry, owner, checkout, gateway) carry the holder's boot identity and process start identity (`src/service/liveness.ts`).
  A different boot, an absent PID, a PID owned by another account or a PID whose start identity differs proves the holder dead.
  Legacy marks without those fields fall back to the lock's mtime against process start and boot time, with a ten-minute margin.
- A dead owner's leftover workers, listed by exact PID and start identity in `<namespace>/process-ledger-v1/<epoch>.json`, are stopped (TERM, then KILL) before its fences are released; after a reboot none can remain.
- Release follows the orderly order: registration to `stopped`, reservation, capability, owner lock, checkout lock; every file is asserted against the snapshot that was classified.
- The registry is healed first: a dead short lock is released; a damaged registry is archived and rebuilt from the live owners' own registrations; every dead reservation in the account is released, including one whose directory was removed.
- Half-written selection metadata, a workbench without a readable registration and interrupted `pending-*.json` temporaries are archived under `<namespace>/recovery-archive-v1/`; archives expire after 30 days or beyond 2 GiB.
- With the lease held, the new owner continues its history (`src/history/recovery.ts`): a torn final batch or unsettled facts of the dead epoch get one recovery bridge in a new segment (the old bytes stay), and history that cannot be scanned is archived and started afresh.
- Each recovery is recorded once in `<namespace>/recovery-log-v1/` (later steps of the same recovery merge into it), printed by the CLI and shown once in the WebUI.

A live owner is never reclaimed.
A running owner that does not answer, a holder on another host and a PID that can be neither identified nor shown absent are reported with one sentence and the next step; `cadence doctor --fix` handles them after one confirmation (`--yes` for scripts).
Stopping an unresponsive owner requires its recorded start identity; taking over a foreign or unidentifiable holder touches no process.
Recovery never replays work: interrupted runs and turns settle as interrupted (`unknown`), worktrees and partial edits stay, and a new run needs fresh consent.

Research runs share the exclusive checkout gate; up to two questions within one admitted run execute concurrently and are joined before release.
Queue time is outside the process deadlines; ongoing tool/model activity never renews a worker's total deadline.
Readonly investigations use Pi's standard file tools with explicit paths and default search roots (conversation cwd by default), never an arbitrary shell.
Pi owns matching, ignore behavior and truncation; partial output is not exhaustive evidence or an atomic source snapshot.
Workers remain offline for tool discovery: searches use already available binaries, without implicit downloads or installation.
No file-tool call grants editing or execution consent.
Tool calls have no cumulative quota or early final-report cutoff; the parent process deadline and explicit cancellation remain authoritative.
The toolkit joins admitted standard file-tool originals rather than letting the SDK's early abort rejection stand for I/O closure; a canceled edit may have completed and is never replayed or described as rolled back.
Pi's grep, shell, fixed-Git evidence and the coordinator bridge retain their native stop-and-join lifetimes.
The tool and coverage semantics are defined in [worker tools](worker-tools.md).
These scope checks are not a filesystem sandbox.
