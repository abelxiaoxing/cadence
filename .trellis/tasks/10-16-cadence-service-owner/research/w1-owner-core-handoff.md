# W1 owner-core implementation handoff

## Scope and completion boundary

Implemented the assigned dependency application and actual private filesystem coordination/lifecycle core.
**W1 and the parent remain open.**
This is not an HTTP service, model-auth adapter, CLI, scheduler, history writer or product release.
No actual checkout service was bound, no provider/user credential was used, and no worker execution action is accepted by this core.
No commit/push/merge, global install, browser download, old-state cleanup or task-state change was performed.
Git writes in tests were confined to newly allocated fixture repositories (init/fast-import/index/worktree); no `git commit` invocation was used.

The [dependency application](dependency-application.md) records the separately authorized offline setup.
Frozen `service-contract.ts`, `service-client.ts`, admission, ports, all shared codecs and `test/service-contract.test.ts` remained byte-identical to `joint-interface-freeze.json` before and after this work.
`src/task-store.ts` and `src/operator-cli.mjs` are unchanged; no extraction/export or operator regeneration was necessary.
Pre-existing dirty archive/qualification paths were not edited or reverted.

## New owners and signatures

- `src/service/private-files.ts`: `PrivateFiles.directory/read/assert/create/replace/remove`, exact `FileSnapshot`, bounded strict UTF-8/duplicate-key JSON parsing and hashing.
  Reuses `safeDirectory` and `readBounded`, adding private ownership/mode and descriptor/path identity checks.
  It is a small owned-files helper, not a second portable codec or general storage framework.
- `src/service/coordination.ts`: `ServiceCoordination(workspace, stateHome?)`, `initialize(config)`, `inspect()`, `acquire(config)`, `recoverySnapshot()`; `OwnerLease.assert/phase/release` and held v1 `checkout` token.
  Uses `resolveWorkspace` and `TaskStore`'s canonical/default-state-home/private-root, `acquire/assertOwner/release` behavior unchanged.
- `src/service/owner.ts`: `ServiceOwner(lease, mandatoryPorts)`, `trackWorker(original, requestStop)`, `trackCheck(original, requestStop)`, `trackAuth(original, recordedSettlement)`, `trackPersistence(original)`, `stop(waitMs=60000)`, `quarantine()`, `detach()`.
  `OwnerLifecyclePorts` requires synchronous `quiesce`, original `flush` and `closeListener` promises, with no accepting defaults.
  `execution()` always refuses `unavailable`; this is deliberately not a stub `AdmissionOwner.activate`.
- `src/service/recovery.ts`: readonly `inspectRecovery(coordination, historyPort?)` and **non-accepting** `resolveRecovery(coordination, informedLocalConfirmation, historyPort?)`.
  `RecoveryInspectionPort` provides independent affected-history digest and process/credential/storage facts, not an invented W3 append implementation.
- `test/service-owner.test.ts`, `test/helpers/service-owner-child.mjs`: isolated filesystem, native second-process and explicitly injected-boundary regressions.
  The native fixture is locally bundled with Bun and executed by the actual Node executable, not an installed service or production TypeScript fallback.

## Implemented filesystem/lifecycle behavior

Explicit initialization creates only new private owner metadata; passive inspect/recovery never creates tasks, directories, credentials or history.
Existing partial/unsafe metadata refuses without adoption/reset.
Paths are:

```text
<state-home>/cadence-assistant-v1/service-registry-v1/
  format.json, roots.json, registry.lock
<existing-per-root-privateRoot>/service-v1/
  format.json, config.json, registration.json, owner.lock, local-capability.json
```

`history-v2` is recognized as the separate future W3-owned directory, not scanned or initialized here.
Unrelated private logs/tasks/legacy resources are not enumerated or cleaned.
Local capability is per-boot 32 random bytes, private and separate from future browser-token material; no web authentication has been implemented.

The registry is bounded to **128 roots / 1MiB**, selected metadata to **16KiB**, and the legacy lock to its unchanged **8192 bytes**.
Its short exclusive lock covers all-root overlap validation **and** durable reservation before root initialization/legacy acquisition.
Canonical ancestor/descendant overlaps are symmetric and independent of Git classification; disjoint worktrees may coexist with different endpoints.
Exact aliases cannot create another owner; endpoint/config conflicts refuse.
Registry corruption, partial writes and uncertain short locks are preserved; there is no age/PID stale-lock reclamation or alternate state-home fallback.
Content mutation after reservation keeps the reservation/short lock on failure.

Both the unchanged v1 lock and new owner lock are held through idle lifetime.
Release rechecks original process/host, raw bytes, inode/time identities and private state, supplementing TaskStore's semantic check against whitespace-only modification.
Writes use exclusive private temporaries/file fsync/rename; POSIX directory fsync is attempted.
Failed temporaries remain selected uncertainty.
Release is ordered, not a multi-file transaction: registration/registry publication precedes capability/owner removal, and v1 is the last per-checkout fence removed.
A failure preserves remaining files/registry lock; it does not roll back already completed removals or promise hostile-same-user atomicity/universal directory durability.

Stop closes admission first, coalesces concurrent stop requests, and waits original process/auth/persistence promises before flushing, closing the listener and releasing known-owned locks.
The 60-second management wait is reporting only; tests shorten that reporting wait without changing native worker cancellation budgets.
A reporting timeout retains quarantine/locks; late settlement cannot release them automatically.
Another explicit stop can finish a merely pending, now-known drain; explicit native/auth/storage/release uncertainty remains fenced.
A failed/late tracking registration also fences, rather than losing an already-started promise into a later clean stop.
Ownership loss does not authorize signaling an old PID.
Detach never stops the owner, and no restart path reads or dispatches an old queue.

File-only status cannot truthfully prove authenticated readiness: an idle registration projects unavailable until a future transport challenge exists.
Initialized/no-boot metadata projects stopped with no epoch; known stopping/quarantine and clean stopped states remain distinguishable.

Recovery binds exact registration/owner/v1/registry/config identities plus W3's independent affected-history digest and separately reviewed facts.
Known live/ambiguous owners, stale choices, missing acknowledgment or unresolved process/credential/storage facts refuse.
Even ESRCH plus all injected facts does **not** unlink anything: without actual W3 recovery append/original-promise accounting, resolution explicitly refuses `unavailable`.
No arbitrary legacy lock or uncertain global registry lock is a recovery target.

## Exact verification

[Original machine receipt](w1-owner-core-checks.preformat.txt) SHA-256: `715ce16757a2841b07b461c7d78f2b267b89dfafd04b7a03860f667005059607`.
It binds pre/post source hashes, frozen-source hashes, commands/exits, actual identities, hashed logs and the verification helper.
Main preserved these original bytes as `.preformat.txt` after the reviewer found receipt formatting issues.
`w1-owner-core-checks.json` is now a formatting-only equivalent, not a rerun or changed result.
Evidence root: `/tmp/cadence-w1-apply-yb6pics9`.

Executed final checks:

- `bun run test -- test/service-contract.test.ts test/service-owner.test.ts test/lightweight-store-controller.test.ts`: **217 passed, 0 failed, 0 skipped**, three files.
  Breakdown: **114** frozen portable contracts, **78** new owner tests, **25** existing store/controller tests.
- `bun run check`: **exit0**, including unchanged canonical operator byte check and whole-package no-emit TypeScript check.
- `bun run lint`: **exit0**, only the two pre-existing informational package-audit suggestions.
- `bun run check:agents`: **exit0**.

Available host: `/usr/bin/node` **26.7.0**, `/usr/bin/bun` **1.3.14** (install banner separately `1.3.14-canary.1 (0d9b296a)`), Bubblewrap **0.11.2**, Linux/x86_64; Pi coding-agent/AI/TUI/agent-core **0.84.3**.
No Node22, Windows/macOS/ConPTY, physical-human, paid-provider or manager-install qualification is implied.

Native/filesystem coverage includes passive noncreation, concurrent original processes, legacy exclusion while idle, aliases, nested repositories/submodule-shaped gitfile+gitlink fixtures/non-Git/mixed roots in both orders, disjoint real worktrees, literal whitespace paths, unsafe metadata/registry, exact changed-lock refusal, actual denied writes, native original close and abrupt original exit/restart refusal.
The submodule fixture uses actual Git metadata/index entries; it does not invoke remote clone or `git submodule add`.

Injected evidence is separately labeled: W3 commit/flush receipts, auth promises, listener close, worker/check DTOs, release failure and foreign UID observation.
These do **not** prove real OAuth/writeback, durable journal append, native foreign-owner creation, HTTP readiness or SDK execution.
Actual pending process tests wait the original spawned handle; a requested stop, PID absence or mock promise is not substituted for close.

Earlier failures are retained, not relabeled:

- First owner run: **71 passed / 4 failed**, because the test-only Node26 invocation rejected `--experimental-transform-types` with original exit9 before fixture readiness.
  The correction was local-source Bun bundling, not a production loader fallback or native pass by inference.
- Intermediate typecheck caught the inferred literal `60000` parameter type, corrected to `number` with the same runtime bound.
- Initial scoped Biome findings were fixed; logs remain in the receipt's prior-attempt bindings.
- A corrected earlier candidate separately passed75 owner tests; it is not added to the final217 total.

## Source identities

```text
src/service/private-files.ts          a0275cb8132d83a1614990a50485d9beeffcc1b3bc59262907790e734082f8a6
src/service/coordination.ts           fcbb2a9bda8417ba02d80893c6374840fa712086ce6758e569390ee142ebdb37
src/service/owner.ts                  f7c1eba77fe8898cf248f56306c3221b48757927ab00b5874c8ae47cd11a4822
src/service/recovery.ts               fdc239b4b6947abe28599a961000cdda11b22c619bdb83d1deda256d99d36a26
test/service-owner.test.ts            f30efcfab6cdcbb416075e8da6678bdddb1ca9792d206575fcae95a28495a642
test/helpers/service-owner-child.mjs  e8afe3ca8eba054dbbcb187906d68d6132c864376eb1d11826f47ef23a4187b0
```

## Required next integration/review gates

1. Main-session independent review of this core before composing an actionable service; no child/parent completion is recorded here.
2. W1 HTTP/token/cookie/Host/Origin/CSRF/WS admission and actual readiness/status, rotation, secure proxy, local-capability admission and management CLI/build remain unimplemented.
   Coordination currently accepts an already-selected positive loopback endpoint, not a port0 listener.
   Future HTTP composition must safely supply the actual resolved endpoint and handle explicit full service configuration/reconfiguration; it must not overwrite existing private config to bypass a conflict.
3. W1 public Pi resolver, original OAuth preparation/settlement accounting and fabricated-provider writeback/no-late-launch qualification remain unimplemented.
   Lifecycle auth tests are injected promises only.
4. W3 must implement real flush/receipt/history/recovery append ports and accounting before any execution or successful recovery composition.
   Recovery currently preserves all fences and refuses resolution.
5. W4 must wire actual scheduler/admission/process handles and all original persistence promises; low-level `OwnerLease.release` is not a product stop endpoint or bypass around `ServiceOwner.stop`.
6. W2 shared-JS relocation and all other frozen-file handoffs still require main assignment.
   No frozen contract was changed in this pass.
7. W5/W6/W7 own native/browser cutover, complete generated assets/licenses, deliberate assertion/spec replacements and integrated source/extracted/package acceptance.
   No full suite/pack/SDK/browser/product success is claimed; the existing exact member policy was deliberately not weakened.

Spec-update judgment: these are new uncomposed primitives, while current production remains the old terminal workflow.
Preserve maintained contracts until the owning deliberate replacement/spec gate; this handoff records the executable core and its tests without claiming the product boundary has already switched.
