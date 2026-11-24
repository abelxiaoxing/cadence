# Admission, lifetimes, Stop and self-healing

## Gateway preparation concurrency and failure bounds

### Gateway preparation serializes per project root and runs up to 4 projects concurrently

Kind: contract

Why: Replacing the old global boolean lock, `gateway.ts` queues pre-admission waiters per canonical project root without counting them (`effect: "none"` on pre-admission refusal, disconnect abort or Stop), coalesces cold-to-warm tabs onto the warm fast-path without extra `commands/*.json`, runs up to `MAX_CONCURRENT_PREPARATIONS` (4) distinct projects at once, and evicts settled preparation failures past `MAX_SETTLED_PREP_FAILURES` (64 FIFO) while keeping disk intent receipts fail-closed.

Anchors: `src/service/gateway.ts#MAX_CONCURRENT_PREPARATIONS`, `src/service/gateway.ts#MAX_SETTLED_PREP_FAILURES`, `src/service/gateway.ts#associatedWork`, `test/gateway-prepare.test.ts`

Source: internalized from engineering/lifetimes.md, 2026-11-22

### waitForRegistry backs off only on provably live registry locks

Kind: contract

Why: The global registry lock never expires by age and synchronous `ServiceCoordination.acquire()` stays fail-closed.
Async startup paths (`host.ts`, `cli.ts`, `self-heal.ts`, `gateway.ts`) wrap registry operations in `waitForRegistry` (up to 2s at 30ms intervals) only while `registryLockDiagnostic()?.owner === "live"`; dead, foreign or unreadable locks fail immediately for self-heal or `cadence doctor`.

Anchors: `src/service/coordination.ts#waitForRegistry`, `src/service/self-heal.ts#healProjectAt`, `test/gateway-prepare.test.ts`

Source: internalized from engineering/lifetimes.md, 2026-11-22

## Checkout gate, auth queues and workflow lifetimes

### The checkout is held only while its working files are written; landing order is per branch

Kind: contract

Why: `CheckoutGate` is one FIFO holder per checkout directory with uncounted waiters: a working-copy delivery for its whole run, a local-merge delivery only for a target-placement setup command and for the fast-forward of the worktree that has its branch checked out.
Research and isolated work hold nothing; deliveries to one branch finish in `MergeQueue` ticket order, and a run that steps aside re-enters first with its own ticket.
`HostCapacity` admits shell steps of all runs from live core count and available memory and queues the rest; cancellation removes waiters only, never an unsettled holder.

Anchors: `src/service/checkout-gate.ts#CheckoutGate`, `src/service/merge-queue.ts#MergeQueue`, `src/service/host-capacity.ts#HostCapacity`, `test/checkout-gate.test.ts`, `test/merge-queue.test.ts`, `test/host-capacity.test.ts`

Source: this delivery, 2026-11-24

### Repository Git leases wait in arrival order and only for a provably running holder

Kind: contract

Why: `RepositoryCoordination.mutate` takes turns inside one process and polls another process's lease only while its holder is live, without a deadline.
A dead, foreign or unreadable holder is named and refused at once, and a lease this owner kept after an unconfirmed settlement refuses until restart; only the holder's own healer settles a dead epoch, whose resources are not counted.

Anchors: `src/service/repository-coordination.ts#assertWaitable`, `src/service/repository-coordination.ts#recoverDeliveryResources`, `test/repository-coordination.test.ts`

Source: this delivery, 2026-11-24

### Model-request retries stay inside one SDK session and auth preparations queue cleanly

Kind: pitfall

Why: Unattended workflow workers apply `UNATTENDED_RETRY` as a floor over Pi retry settings unless retries are disabled, retrying only failed responses inside the original worker without replaying commands or steps (except one lone retry for a failed readonly research question).
Overlapping SDK startup auth resolutions serialize through the worker auth bridge and the owner's preparation queue, which runs one at a time and does not count its waiters, rather than failing on concurrent preflight.

Anchors: `src/worker-model.mjs#UNATTENDED_RETRY`, `src/service/model-context.ts#prepareTracked`, `test/worker-model.test.mjs`, `test/workflow-research.test.ts`

Source: internalized from engineering/lifetimes.md, 2026-11-22

## Stop, maintenance units and startup self-healing

### Service commands refuse inside their own unit; WebUI restarts via a transient unit

Kind: contract

Why: Stopping a systemd unit kills every process in its cgroup regardless of `nohup`/`setsid`, so `server install|restart|stop|uninstall|upgrade` compare `/proc/self/cgroup` against the unit's `ControlGroup` and refuse inside it.
WebUI restart/upgrade proves its unit and launches `systemd-run --collect` outside the cgroup after a confirmation digest naming all stopped work; rollbacks require confirmed Stop of the new owner first.

Anchors: `src/service/maintenance.ts#insideUnit`, `src/service/installation.ts`, `test/service-maintenance.test.ts`

Source: internalized from engineering/lifetimes.md, 2026-11-22

### Startup self-healing reclaims only provably dead holders and archives damaged state

Kind: contract

Why: Every start heals dead locks/reservations using boot and process-start identity (`liveness.ts`), stopping exact-identity orphan workers from `process-ledger-v1` before releasing fences in orderly order and archiving damaged state under `recovery-archive-v1` (30 days / 2 GiB).
Live, unresponsive, foreign-host or unidentifiable holders are never reclaimed without explicit `cadence doctor --fix`, and interrupted runs settle as `unknown` without replay.

Anchors: `src/service/self-heal.ts#healProjectAt`, `src/service/liveness.ts`, `test/self-heal.test.ts`, `test/service-owner.test.ts`

Source: internalized from engineering/lifetimes.md, 2026-11-22
