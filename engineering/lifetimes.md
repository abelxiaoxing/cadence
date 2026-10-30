# Admission, execution and lifetimes

How work is admitted, scheduled, stopped and recovered, and which original operations hold fences.
Read this before changing admission, scheduling, Stop, registry or recovery behavior.

## Execution graph

- Graphs contain 1–16 required assignments with explicit purposes/dependencies and exact model choice; no recursive spawning or autonomous retry.
- Two readonly children may overlap; checkout editing and parent checks serialize across tasks and aliases against readers/writers.
- Research/diagnosis never gain editing or parent-shell authority through a plan or child prompt.

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

## Workbench Stop and recovery

Workbench state lives separately under `<state-home>/cadence-assistant-v1/workbenches-v1/<configuration-hash>/`, not in a hidden substitute workspace.
Whole-workbench Stop joins its accepted openings and associated exact-epoch project owners, serializing their final registry releases; unrelated, unassociated owners are not stopped.
A changed epoch, uncertain launch or unconfirmed Stop keeps the workbench fenced, but does not prevent Stop from reaching its other known associated owners.
Workbenches never repair missing private state or automatically erase uncertain locks.
`cadence workbench recover inspect|resolve` offers explicit local recovery after a dead gateway, with exact resources, durable evidence and fresh terminal acknowledgments; it preserves project fences/history and retires only the old workbench associations until another explicit Open.
Registrations from older versions without a hostname additionally require independent same-host attestation; unknown provenance is not recoverable by guessing a PID.
Service restart never resumes the old queue.
Uncertain process/auth/storage settlement keeps fences; use documented local informed recovery, not PID-only deletion or automatic cleanup.
