# Admission, execution and lifetimes

How work is admitted, scheduled, stopped and recovered, and which original operations hold fences.
Read this before changing admission, scheduling, Stop, registry or recovery behavior.

## Conversation workflow lifetime

Conversation workflows have their own versioned private journal under the existing exact project owner.
They acquire the same checkout gate as ordinary conversations and retain it until all original workers/checks/auth/storage settle.
Within that barrier, independent implementation assignments use separate Git worktrees (two at once); dependent worktrees consume committed ancestor outputs in topological order.
Worktrees live under `<stateHome>/cadence-worktrees-v1/<project-hash>/<run>/` (0700, outside the private service namespace, never nested with the checkout): `integration` plus a disjoint `tasks/<task-id>` per task; valid task IDs cannot collide with internal names.
Worktrees created by 2.0.21 inside the service namespace are left where they are.
Direct working-copy delivery serializes edits.
The terminal is never an embedded executor.
One fresh 120s grant binds the exact proposal/plan, model source, project observation and owner epoch; accepted durable work owns the declared finite steps, not fabricated user clicks.
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
  Explicit project launch uses a new port only for a new checkout selection; reopened projects retain exact cwd/port/history, and no project navigation changes another owner's execution.
  Root Git observations require Git's own ownership check: reset `safe.directory` exceptions per command, drop inherited `SUDO_UID` and disable fsmonitor, without configuration writes or ownership changes.
  Merely selecting a foreign-owned repository cannot grant permission to run its clean/process filters; use its owning account instead.
  Ordinary-user Git trust behavior remains unchanged.
  System services require uid0, bypass user managers/logind entirely and require confirmed native Stop before manager stop or definition replacement; changed state-home inputs, old user units and detached running owners refuse implicit adoption.
  Registry reservation atomically rejects canonical ancestor/descendant overlaps, including nested Git roots and aliases; a different state-home does not coordinate arbitrary other owners.
- The short global registry lock never expires or auto-reclaims from PID absence.
  `recover inspect|resolve` handles a valid dead same-host lock explicitly before project recovery, with fresh local-terminal acknowledgments, exact registry/unreserved-project checks and a flushed exclusive evidence receipt.
  Concurrent or interrupted resolvers cannot remove a successor lock; all project reservations, locks and history remain intact.
  Unreserved partial release, unsafe/corrupt registry or receipt bytes, live/remote/ambiguous holders and changed resources stay fenced.
  Readonly diagnosis and project Open name `registry-locked`; see [global registry recovery](../docs/service-management.md#residual-global-registry-lock).
  Missing retained project directories do not invalidate the global registry: their exact reservations and private fences remain, while canonical existing ancestors, aliases and overlaps are still checked.
  Unbound `recover` addresses account/workbench state, not cwd; project recovery requires explicit `--workspace`.
- Workbench recovery is local and interactive, never acquire-on-dead-PID.
  A bounded flushed receipt precedes exact gateway fence release; project registrations, locks, incomplete opening receipts and history are untouched.
  The receipt retires the exact old project-reference incarnations from proxy/Stop association until explicit Open republishes them, preventing a deleted old directory from re-quarantining the next orderly Stop.
  New workbench registrations record their host; legacy hostless registrations require an extra fresh same-host attestation, never automatic host inference.
  Live/foreign/ambiguous owners and changed or unsafe resources refuse.
  Generated Linux units exclude deterministic foreground refusal exit78 from restart; manager acceptance without authenticated readiness is not reported as successful startup.
- Native entry requires fresh raw Enter within1500ms, trusted/idle TUI, no pending modal/messages and no child guard.
  Browser authentication grants access, not task consent; normal mutation ingress also requires independently built compatible client/service/assets identities.
- Boot model choice is absent until selected; native mode resolves the remembered credential-free preference (or current Pi choice on first use) into a new exact owner selection.
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
  Stop sends TERM and arms KILL/unknown timers before observer or coordinator interruption callbacks; lifecycle observation performs no synchronous journal I/O.
  Native close is authoritative for the direct child, not `exit`, EOF or escaped-descendant closure.
  Unknown process/auth/storage settlement preserves fences; late completion never retroactively repairs an unknown result.
- Return, navigation, browser disconnect and Pi quit detach accepted work.
  Reconnect does not resend mutations; a refused Cancel permits only another explicit click, not automatic retry.

## Workbench Stop and recovery

Workbench state lives separately under `<state-home>/cadence-assistant-v1/workbenches-v1/<configuration-hash>/`, not in a hidden substitute workspace.
Whole-workbench Stop joins its accepted openings and associated exact-epoch project owners, serializing their final registry releases; unrelated, unassociated owners are not stopped.
A changed epoch, uncertain launch or unconfirmed Stop keeps the workbench fenced, but does not prevent Stop from reaching its other known associated owners.
Workbenches never repair missing private state or automatically erase uncertain locks.
`cadence workbench recover inspect|resolve` offers explicit local recovery after a dead gateway, with exact resources, durable evidence and fresh terminal acknowledgments; it preserves project fences/history and retires only the old workbench associations until another explicit Open.
Registrations from older versions without a hostname additionally require independent same-host attestation; unknown provenance is not recoverable by guessing a PID.
Service restart never resumes the old queue.
Uncertain process/auth/storage settlement keeps fences; use documented local informed recovery, not PID-only deletion or automatic cleanup.

Research runs share the exclusive checkout gate; up to two questions within one admitted run execute concurrently and are joined before release.
Queue time is outside the workflow/process budgets; ongoing tool/model activity never renews a worker's total deadline.
Readonly investigations use bounded native filesystem tools at explicit roots (project cwd by default), not bash or an unbounded SDK search subprocess.
They report partial coverage for time, entry, depth, byte/output bounds and omitted files; they do not follow tree symlinks, interpret `.gitignore`, copy sources, or silently drop backup trees.
Grep is explicitly literal-only.
The final-report reserve refuses new tool calls without inventing a completed investigation or abandoning outstanding I/O.
These scope checks are not a filesystem sandbox.
