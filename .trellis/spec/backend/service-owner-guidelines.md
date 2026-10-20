# Shared Service Owner Core

## 1. Scope / Trigger

Use when changing `src/service/` coordination/lifecycle primitives or composing their adapters.
The real accepting host, shared native/browser clients, public Pi model-auth and durable capture/history are composed.
D4 adds outbound owner-auth routing and local informed recovery; complete distribution/whole-delivery qualification remains W7-owned.
See [capture/history](./service-history-capture-guidelines.md) and the [operations guide](../../../docs/service-management.md).
Focused source/native/fixture evidence is not whole-product, paid-provider or other-platform qualification.

## 2. Signatures

```ts
// src/service/coordination.ts
interface OwnerConfig {
  schema: "cadence-service-owner-config/1";
  endpoint: string; // requested loopback HTTP policy; explicit :0 is allowed
  policyIdentity: string; // secret-free service policy, NOT credential identity
}
new ServiceCoordination(workspace, stateHome?);
coordination.initialize(config); // explicit private setup only
coordination.inspect(); // readonly: absent/unavailable/stopped/stopping/quarantined
coordination.acquire(config, resolvedEndpoint?); // OwnerLease, holds v1 + new locks
lease.assert(); lease.phase(phase); lease.release();

// src/service/owner.ts
interface OwnerLifecyclePorts {
  quiesce(): void;
  flush(): Promise<PersistenceResult>;
  closeListener(): Promise<void>;
}
new ServiceOwner(lease, ports);
owner.trackWorker(originalCompletion, requestStop);
owner.trackCheck(originalNativeSettlement, requestStop);
owner.trackAuth(originalGetAuth, originalRecordedSettlement);
owner.trackPersistence(originalWrite);
owner.stop(waitMs = 60000); // known stopped OR quarantined + pending counts
owner.detach(); // no stop

// src/service/recovery.ts
inspectRecovery(coordination, historyInspectionPort?);
resolveRecovery(coordination, LocalRecoveryConfirmation, HistoryRecovery);
// Native CLI owns the expiring exact-resource callback, never a body boolean.
coordination.prepareRecoveryRelease(expectedDigest, assertAuthority);
// Returns a one-use closure requiring the original durable-history guard.

// src/service/auth-network.ts, used only by the dedicated owner process
new AuthNetwork(); // capture before SDK imports; startup flag/opt-in required for proxy
network.initialize(); // public Undici installation AFTER SDK imports
network.assert(scopedEnv); network.close(); // exact facts/identity and original close
```

`src/service-contract.ts` is the portable facade.
`worker-public.mjs`/`.d.mts` now own the executable core/domain/capture codec and declarations; `contracts/{core,domain,capture}.ts` are re-export shims.
`contracts/history.ts` owns history/read unions; `contracts/budget.ts` owns shared retention accounting.
`service-client.ts` uses named operations and the shared projection tracker, never mutation replay or UI-local record casts.
`service/ports.ts` owns concrete admission/auth/process/capture/owner/read seams; a port signature alone is not an accepting implementation.
Preserve the one shared JS dependency closure and vectors, not a second TS/JS validator.

## 3. Contracts

### Private filesystem and registry

Reuse `TaskStore`, `resolveWorkspace`, `safeDirectory` and `readBounded`; do not weaken legacy storage to accommodate the service.
`PrivateFiles` adds owned namespace permissions, current-user/single-link/no-follow bounded reads, descriptor/path stamps and exact byte identities.
Ambient state-home alias resolution remains TaskStore-owned.
No passive inspection creates paths, repairs selected bytes or scans unrelated task/log history.

Paths within `<state-home>/cadence-assistant-v1/`:

- `service-registry-v1/{format.json,roots.json,registry.lock}`.
- `<checkout-hash>/service-v1/{format.json,config.json,registration.json,owner.lock,local-capability.json}`.
- `history-v2/` beneath service-v1 is now owned by `src/history/`; explicit format3/key initialization and preserved readonly format2 are specified in [capture/history](./service-history-capture-guidelines.md), never initialized by passive coordination inspection.

Registry limits are128 roots/1MiB; selected metadata16KiB; legacy lock8192 bytes.
An exclusive short registry lock serializes overlap checking **and** reservation before per-root initialization/acquisition.
Reject all canonical ancestor/descendant overlaps regardless of Git classification, exact-root duplicates and endpoint conflicts; disjoint worktrees can coexist.
Unknown/partial/corrupt/linked state and uncertain registry locks stay preserved; neither age nor PID absence authorizes reclamation.
Selected state-home is one coordination domain, not global exclusion of arbitrary old/custom-domain runtimes.

Hold the unchanged v1 checkout lock and new owner lock for the full owner lifetime, including idle.
Registration pins root/state-home/config/endpoint/epoch/original PID/host/owner/check-out tokens and phase.
Local capability is private per-boot32-byte random material, separate from browser/provider credentials.
File-only idle registration is **unavailable**, not authenticated readiness.
`OwnerConfig.endpoint` may request port0; `acquire(config, resolvedEndpoint)` requires the actual positive bound endpoint matching that loopback policy.
Persist the requested policy unchanged and register the actual endpoint; unresolved/substituted endpoints refuse, not an implicit config rewrite.

### Release and stop

Release checks original process/host and exact raw bytes plus file stamps, not only TaskStore's semantic lock equality.
Publish stopped registration and registry removal under the short lock, then remove capability, owner lock, and **v1 last**.
After each successful removal, update only that expected absence and revalidate all remaining selected state and held registry identity before the next effect.
Interference/failure retains remaining fences; do not recreate removed files, roll back arbitrary state or claim multi-file atomicity.
Private writes use exclusive0600 files, file fsync and POSIX directory-fsync attempts; Windows ACL/durability remains separately unqualified.

Publish one shared Stop attempt **before** invoking external `quiesce`/stop callbacks, so reentry cannot start a second drain.
Close admission first; request stops without serially awaiting children, checking lease ownership immediately before each callback.
Track original worker/check/auth/storage promises, not caller timeout wrappers.
Even refused late registrations retain already-started effects and quarantine; independently register auth's settlement-write promise if auth tracking refuses.
The256-entry misuse guard is not a hard memory guarantee for a broken internal adapter: real capacity must be reserved before effects by admission/scheduler/writer.

After originals settle, revalidate ownership before flush/listener/release effects.
Only committed flush and original successful listener close permit known release; compose the real `HistoryWriter.flush`, not injected accepting receipts.
A60s management timeout reports uncertainty and retains fences, even when an original later settles.
A new explicit Stop can finish a merely pending now-known drain; permanent native/credential/storage uncertainty remains fenced.
Remember successful original listener close across explicit retries; do not close the same native server twice.
Detach never cancels accepted work, and construction/restart never replays queues.

`recover inspect` is readonly.
`recover resolve` requires actual local stdin/stdout TTYs, bounded raw-input confirmation within120s, separate process/credential/storage acknowledgments and the exact epoch.
Pipes, body booleans, multiline/bracketed paste and `--yes` cannot authorize it; no network recovery endpoint exists.
The CLI callback binds the unchanged inspection and expires; inspect itself never grants authority.
Same-host ESRCH is necessary but never proves descendants/auth/storage settled: operator acknowledgment is not certification.
W3's original guarded append/flush/close completes before W1 changes registration/registry, then removes capability, owner and exact associated v1 lock last.
Every effect checks absent owner, original safe bytes/incarnations, local authority, history digest and held registry; capability incarnation is bound privately without publishing its secret hash.
Live/remote/ambiguous/refreshed/old-format/partial resources refuse; failures preserve bridge/remaining fences, never rollback, repair on read or arbitrary legacy-lock release.
Unknown historical outcomes remain unknown and new work requires fresh Start.

### Owner-auth outbound networking

`hostEnvironment` and workers use the ONE `sdk-network.ts` parser/own-descriptor policy; no second URL parser, ALL/bypass/scoped promotion or direct fallback.
Management is SDK-free.
It validates/snapshots the route, strips access/control/preloads, and supplies the exact uppercase pair, opt-in and actual supported `--use-env-proxy` flag before starting the owner.
After SDK imports, `AuthNetwork.initialize` installs one owned PUBLIC `EnvHttpProxyAgent`, verifies public getter identity and retains allocation even on setter failure.
DIRECT has no Undici effects.
Configured auth checks exact ambient/scoped facts and dispatcher identity around preparation; route literals remain RAM-only redaction inputs.
Original getAuth/refresh/writeback/intents/cancellation remain model-context-owned; ordinary checks use frozen launch env, not resolved model auth.
Orderly Stop joins original route and listener closes; failed setup closes allocated routing independently while preserving quarantine.

Already-started `HistoryWriter.publishTask` intent/save/outcome jobs use its existing continuation lane during Stop.
Admission is checked synchronously before that pipeline; new post-Stop publication and fenced/old-generation writes still refuse.
The deterministic before-save Stop regression catches the cross-layer mistake of treating original publication continuation as new ordinary work.

## 4. Validation & Error Matrix

| Boundary                                                                     | Required behavior                                                                               |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Missing passive selected state                                               | Absent, no directory/task/credential/history creation.                                          |
| Unknown schema, link/hardlink, unsafe mode/owner, oversized/partial metadata | Refuse/preserve; status unavailable rather than repair.                                         |
| Nested/aliased/concurrent overlapping roots or selected endpoint conflict    | At most one owner; losing start cannot create another execution owner.                          |
| Whitespace-only lock change or release-boundary interference                 | Exact conflict; retain remaining fences and deny supported legacy acquisition where v1 remains. |
| Reentrant/concurrent Stop                                                    | One original drain/flush/close/release, not competing attempts.                                 |
| Pending original beyond reporting deadline                                   | Quarantined with pending facts; no late automatic release.                                      |
| Lease loss before another stop callback or flush                             | No new callback/write effect under lost ownership.                                              |
| Late auth plus journal settlement registration                               | Both originals remain accounted, even on refusal.                                               |
| Dead PID or boolean-only confirmation                                        | No release without native local authority and original durable bridge.                          |
| Proxy startup/dispatcher/freshness unavailable                               | Fixed refusal; no fallback or route/credential disclosure.                                      |
| Recovery interruption/interference                                           | Preserve bridge/remaining fences; never claim clean native closure.                             |

## 5. Good / Base / Bad Cases

- Good: two separate native starters race nested roots; one reserves, the other refuses, and legacy writers remain excluded while the owner is idle.
- Base: original listener close completes after a management timeout; fences remain until another explicit Stop finishes without calling close again.
- Bad: remove capability, observe changed registration, then continue removing owner/v1 locks because the initial check passed.
- Bad: drop an already-started auth/write promise because its late tracking registration was rejected.

## 6. Tests Required

`test/service-owner.test.ts` and its locally bundled `test/helpers/service-owner-child.mjs` own actual temporary-filesystem/native-second-process coverage: absence, symmetric nested Git/submodule-shaped/mixed/non-Git exclusion, aliases, disjoint worktrees, original waited closes, abrupt exit/restart refusal and idle legacy exclusion.
Keep unsafe selected state, literal whitespace paths, stale registry-lock preservation and denied writes.
Release-boundary mutations are injected real-filesystem timing controls followed by native legacy contenders; do not call them spontaneous OS races.
Native TCP listener-close coverage is not HTTP/auth qualification.
Auth/history receipts, lifecycle callbacks and foreign-UID observations are labeled injections, not real OAuth/durable writer/foreign-user evidence.

Retain regressions for every release boundary including registry format/roots, reentrant Stop, differing concurrent reporting waits, lost ownership before callbacks/flush, and separate late auth/write counts.
`service-auth-network` separates public-resource mocks from `service-auth-proxy` actual generated-owner plain/gzip OAuth+worker routing, zero direct sink hits, unrelated credential preservation, redaction and original close.
`service-recovery` exercises original dead owners, torn/auth/launch history, exact guarded release, stale/live/remote/partial fences and actual generated-CLI TTY confirmation/paste/cancel/nonTTY behavior.
`service-cli` retains real start/status/diagnose/stop/token rotation/lost-ack behavior; `service-history-publication-recovery` includes deterministic Stop during an original publication.
Run shared `test/service-contract.test.ts` and legacy `test/lightweight-store-controller.test.ts` alongside changes, then whole typecheck/lint/Agent gates.
Full package/source-extracted/SDK/browser and nonhost acceptance remain separate; the old archive policy is not a pass for added source bodies.

## 7. Wrong vs Correct

```ts
// Wrong: callback can synchronously reenter before attempt is published.
ports.quiesce();
this.attempt = drain();

// Correct pattern: reserve/publish the one attempt first, then call adapters.
this.attempt = originalAttempt;
closeAdmission();
startOriginalDrain();
```

Wrong: `await timeout(originalClose)` and call `closeListener()` again on retry.
Correct: retain original closure independently, retain fences on the reporting timeout, and reuse known closure only on a fresh explicit Stop.
Wrong: one lease check authorizes a whole removal/callback loop.
Correct: revalidate remaining expected state and held registry identity before each next effect; this is supported coordination, not hostile-writer atomic isolation.
