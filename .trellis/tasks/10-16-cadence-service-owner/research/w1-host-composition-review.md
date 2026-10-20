# W1 mutation-closed host composition — independent review

## Disposition and scope

**Accepted for the assigned mutation-closed composition boundary, after four fixes.**
No unresolved finding remains in that boundary.
This is not W4 action acceptance, complete W1 recovery/proxy qualification, or product delivery.

Read the child manifests/artifacts, mandatory parent artifacts/appendices, runtime-orchestration handoff, complete W4 readiness report, applicable specs/research, composition handoff, installed public ModelRuntime declarations and relevant Pi SDK documentation/examples.
Installed Pi remains0.84.3; newer global documentation did not replace its actual declarations.

The prior composition's33 frozen input hashes matched the review preimages.
Existing unrelated changes, historical evidence, dependencies/lockfile, worker/capture/read-progress semantics, specs and task state were preserved.
No agents, repository Git mutation, installation, actual provider credentials, actual-checkout service deployment or unrelated cleanup were performed.
Native fixtures used explicit fake agent directories/state homes and allowlisted environments.
The only task artifact added is this requested report.

## Findings reproduced and fixed

### F1 — Rotation crossed selected-state/ownership boundaries without revalidation

After replacing an external token file, `AccessMaterial.rotate` previously published `access.json` without checking whether the access configuration or the just-written external file had changed.
Two real-filesystem boundary injections reproduced successful rotation instead of refusal.
The target's own expected-byte check did not attest the other selected files.

`src/service/auth.ts` now revalidates all selected access incarnations before the next publication and before accepting the new RAM generation.
The actual host binds a rotation-only lease assertion in `src/service/host.ts`, checked at each rotation boundary.
A third regression changes the real registration after the external replacement and proves no later access-metadata publication, revoked RAM access and retained owner/v1 fences.
Revocation on uncertainty is still required; no rollback or restoration is attempted.

The callback is deliberately **rotation-only**.
An initial broader placement also changed ordinary authentication/error behavior and added full registry/lease reads to every access-current check.
The failed intermediate run is retained below.
Existing readonly authentication/current-material checks and their budgets are unchanged in the final implementation.

### F2 — Stop could release with originals registered during flush/close still pending

The initial activity drain covered originals registered while awaiting earlier work, but not new safety history jobs registered during `flush` or `closeListener`.
Injecting a pending original at either boundary reproduced `stopped` and released fences while storage was outstanding.

`src/service/owner.ts` now rechecks/drains exact original activities after both boundaries, including their rejection paths.
The set is rechecked in the caller's continuation before the next effect, not merely inside an awaited helper.
Four regressions cover flush/listener × resolved/rejected boundaries.
Reporting expiry retains the pending count and fences; late completion cannot release automatically.
A separate explicit Stop can finish a known-clean case, while rejected lifecycle boundaries remain quarantined.

This does not replace originals with reporting races, change capture reservations, grant safety work execution authority, or turn the lifecycle misuse guard into a resource allowance.

### F3 — Native management timeout was idle-only, not a bounded operation

A real numeric-loopback HTTP responder writing one space every50ms kept `nativeCall` pending beyond its nominal2s timeout.
The regression observed `still-pending` at2.4s before fixture teardown.

`src/service/cli.ts` now applies the same2s allowance as an absolute request deadline and settles premature close.
Only that HTTP request is destroyed; the service is never killed or restarted.
Bounded response size and exact-epoch response checks remain.

### F4 — Foreground reporting could convert uncertainty into CLI exit0

A native temporary driver using the production management implementation printed `{"status":"unconfirmed"}` but exited0 after its fixture child closed.
The foreground branch had already printed the result and returned `null`, bypassing the management failure-status check.

Foreground startup now preserves a failed reporting status before waiting, and a nonzero/signal original child close cannot become manager success.
Detached behavior is unchanged: no parent-exit signal, restart or worker-lifetime coupling.
Two regressions cover unconfirmed foreground reporting with fixture child exit policies0 and7.
These are native management/fixture-child controls, not inference, healthy-host readiness, or paid-provider evidence.

### Additional lifetime control

A real `HistoryWriter` regression throws synchronously from `onOriginal` and requires one registration, zero write-observer effects, unchanged selected bytes, settled original accounting, zero pending writes and retained lease files.
This strengthens the existing pre-effect hook coverage; it does not treat an observer promise as durable commitment.

## Reviewed composition and frozen W4 API

```ts
// src/service/runtime.ts
interface HostInput {
  workspace: string;
  stateHome: string;
  config: HostConfig;
  environmentToken: string | null; // RAM/anonymous stdin only
}
// HostConfig: schema cadence-service-host/1, HttpPolicy, absolute cwd/agentDir,
// tokenSource generated|environment|file, and nullable tokenFile.

// src/service/host.ts
createServiceHost(input: HostInput): Promise<ServiceHost>;
// ServiceHost exposes owner-only actual objects:
// coordination, owner, writer, reader, projection, live, models, access, http,
// endpoint, checkEnvironment: Readonly<NodeJS.ProcessEnv>.

// src/service/model-context.ts
models.prepareTracked(input: ModelPreparationInput): {
  result: Promise<ModelPreparation>;
  settled: Promise<void>;
};
// input: request, operationId, epoch, timeoutMs, signal, current.
// prepare(input) remains the reporting compatibility wrapper.

// src/service/ports.ts / history/writer.ts
writer.auth.original!(report: Promise<PersistenceResult>): Promise<PersistenceResult>;
// Real writer maps that exact report to its original via WeakMap.
// lifetimeTracked reflects the installed lifecycle hook, not network authority.

// Writer construction in the actual host:
new HistoryWriter(lease, {
  onOriginal: (original, safety) => owner.trackHistory(original, safety),
  onFence: () => owner.quarantine(),
});
```

`result` may refuse while `settled` and capacity remain pending.
`settled` includes this preparation's original SDK and accounting jobs, not global `pending === 0`; late completion cannot launch or refund early.
The original auth tail remains serialized.
The writer's synchronous registration precedes scheduling/effects, including safety writes and late auth settlement while ordinary admission is closed.
Existing native unknown/no-launch distinctions and original writer budgets remain authoritative.

Startup ordering was reviewed through the actual factory and native controls:

1. Validate selected configuration/source; bind HTTP with admission closed.
2. Resolve the positive endpoint; exclusively initialize/reserve genuinely new selected state under the registry lock and acquire the lifetime new/v1 lease.
3. Open/init actual history, writer/read/live/access/model owners; configure HTTP exactly once.
4. Track/await the original dynamic model-runtime load; then enable authenticated readonly admission and exact-epoch readiness.

Port0 is bootstrap-only for the real host.
Restart pins the positive selected endpoint/configuration; conflicting flags and unsafe/partial access/history/configuration refuse without repair/adoption.
Canonical aliases, all-root overlap and supported legacy writer exclusion remain coordination-owned.
The SDK-free management executable and separate host executable preserve environment admission before dynamic SDK loading.
Model construction is distinct from `getAuth` and creates no inference session.

Management requires direct native capability authentication before body consumption.
Browser cookie/Origin/forwarding cannot confer local authority.
Stop acknowledgement precedes the shared drain; only a received exact-epoch accepted acknowledgement plus complete exact-epoch lease-release observation confirms Stop.
Lost acknowledgement and PID absence never manufacture that result.
Token/link/environment material does not enter normal output, argv, history or check environment.
The source-selected token and per-boot capability remain separate.

The actual HTTP composition still has **`admission: null`**, `actions:false`, `manualChecks:false` and unavailable current task/check authority.
Historical projection/receipts come from actual W3 owners, not accepting fixtures.
W4 must insert its real admission/current-environment ports at the factory's one-time configuration boundary; it cannot configure the returned HTTP server a second time or use the closed surface as an accepting default.
`owner.execution()` remains unavailable.
`checkEnvironment` is a frozen ordinary launch snapshot, not a qualified parent-check runner.

## Verification and preserved failures

All executable verification used the fresh0700 ext4 root:

`/home/mirako/abel/cadence-w1-review-CX3o8pMp`

`TMPDIR`, `TEMP`, `TMP` selected that root; native fixtures further isolate their own fake homes/agent directories/state/temp.
Actual identity: Linux x86_64, `/usr/bin/node` v26.7.0, Bun1.3.14, installed coding-agent/pi-ai0.84.3, ws8.21.3, Vitest4.1.10.
`identity.json` records package-body identities.
No real provider profile was used.

| Evidence                                                                       | Result                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-fix ten-file run, unchanged production source plus newly added regressions | 663 original tests passed;4 new tests failed;342.15s. **Failed run**, not a frozen passing baseline.                                                                                                     |
| Isolated rotation/drain counterexamples                                        | 4 failed; filtered tests remain skipped, not extra passes.                                                                                                                                               |
| Isolated slow-response counterexample                                          | 1 failed; original management wait remained pending.                                                                                                                                                     |
| Foreground native counterexample                                               | Printed unconfirmed; actual manager exit0. Preserved under `foreground-probe/`.                                                                                                                          |
| First post-fix ten-file run                                                    | 670 passed /2 failed /0 skipped;380.17s. **Failed and preserved** in `final-tests.log`.                                                                                                                  |
| Corrected complete CLI/host file                                               | 24 passed /0 failed /0 skipped;80.82s. Includes the original20.                                                                                                                                          |
| Final frozen ten-file verification                                             | **674 passed /0 failed /0 skipped;346.38s.** Original663 plus11 new regressions.                                                                                                                         |
| Separate legacy store/controller file                                          | 25 passed /0 failed /0 skipped; not added to674.                                                                                                                                                         |
| Final `bun run check`                                                          | Exit0; syntax, operator/service deterministic generated-byte checks and TypeScript no-emit.                                                                                                              |
| Final `bun run check:agents`                                                   | Exit0.                                                                                                                                                                                                   |
| Final `bun run lint`                                                           | Exit0 after JSON/report formatting; see `lint-674-final.log`/`lint-674-final.exit`. Two existing informational Biome diagnostics, no errors. The report also passes explicit `rumdl check --no-exclude`. |

The intermediate failures were the existing ownership-loss assertion receiving423 rather than409 under the overbroad access guard, and the retained-history fixture's unchanged60000ms deadline plus an unconfirmed afterEach Stop.
Narrowing the guard restored the intended boundary; fresh corrected controls and the final suite passed.
The timeout receipt is not erased or treated as proof of a precise historical timing cause.
No fixture/read/capture/report limit was enlarged.
The original20/15-second SDK/native allowances,100ms/8MiB read quantum,5s capture stall,10s startup reporting and existing retained-history deadline remain unchanged.

The final command selected:

```sh
bun run test -- test/service-cli.test.ts test/service-owner.test.ts \
  test/service-auth.test.ts test/service-model-context.test.ts \
  test/service-contract.test.ts test/service-history.test.ts \
  test/service-history-semantics.test.ts \
  test/service-history-publication-recovery.test.ts \
  test/service-history-final-review.test.ts test/service-history-proof-http.test.ts
```

All logs, preimages and85-input manifests are retained under the root above.
Its `frozen-comparison.json` binds the original33 composition inputs; `frozen-evidence-hashes.json` retains hashes of the prior producer's frozen receipts.
The final85 source inputs matched before/after tests/check/Agent checks, with only the ten reviewed paths below changed from delegation.

| File under review root                            | SHA-256                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------ |
| `inputs-before.json`                              | `8a71b6c0b8a15b6e5d52c19ff96cb9854241451725d64a593cad84989793fca1` |
| `inputs-674-before.json`, `inputs-674-after.json` | `ba07ae820f178d0a08ac484cb9344c28e7babf954c0dc5d639fb06fe0ac2ab59` |
| `tests-674.log`                                   | `61469685c0f4143950729d42de8dc41873ac1073d104128255bc242243a3c30c` |
| `check-674.log`                                   | `6de17e4bf4234c4eecf065c2988d1bb9bee715f226572eaefab255ca433b46cc` |
| `agents-674.log`                                  | `fc459b9f542bbe9546842994f18a74f6a80e908f467ce497916608c24531eebf` |

Separate selected tests overlap these totals.
The old1307 result and older50018ms/event35/native failures remain historical evidence, with no retroactive causal attribution.
These results do not qualify extracted distribution, browsers, terminal cutover, native Windows/macOS, actual remote deployment, physical-human actions or paid providers.
Real writer/native closure facts are distinct from fabricated OAuth/admission/role inputs.

## Changed paths

- `src/service/auth.ts`, `src/service/host.ts`: narrow rotation state/lease revalidation.
- `src/service/owner.ts`: original-job drain across flush/listener settlement.
- `src/service/cli.ts`: absolute native request deadline and truthful foreground exit status.
- `test/service-auth.test.ts`, `test/service-owner.test.ts`, `test/service-cli.test.ts`: eleven regression/control cases; existing tests/budgets retained.
- `src/service-cli.mjs`, `src/service-host.mjs`: regenerated from maintained sources.
- `provenance/auth-reuse.json`: changed auth destination hash only; upstream/source/license hashes preserved.
- This new report.
  No package/dependency/lock/spec/task-state edit was made by this review.

## Concrete remaining integration gates

1. **Owner OAuth proxy:** DIRECT-only refusal remains.
   A real qualified pre-import host network route is required before enabling configured proxy auth; W2 worker routing or a caller boolean is not that evidence.
2. **Recovery:** management `recover inspect|resolve` remains explicitly unavailable.
   Compose informed local exact-resource authority, independent process/credential/storage facts, original-job fencing and W3 guarded history recovery with coordinated takeover.
   PID absence is not release authority.
3. **W3 scheduler facts:** add the reviewed closed per-child wait/admission-stop/closing observations and reservation identities, retaining native launch/no-launch/closure as separate facts; update the same reducers/read/export owners rather than inventing a scheduler shadow projection.
4. **Accepted plans:** produce immutable approved plan identities/content from committed actions and expose the latest actually published saved graph, including readonly/default/legacy continuation.
   No preflight writes or silently substituted references.
5. **Checks/current environment:** implement check-ID-linked durable native check facts, configured not-run/stale obligations, bounded generation/observation barriers, actual frozen ordinary parent-check environment and human review.
   The present unavailable callbacks are not accepting implementations.
6. **W4 and product:** real role-pinned scheduler/dispatch, shared action admission and current context must be composed before actions are enabled.
   Then W5/W6 client cutover and W7 complete package/assets/notices/source-extracted qualification remain.
   Preserve one owner, pre-effect reservations and original lifetime accounting throughout.

## Root cause and recurrence prevention

These were cross-layer/implicit-assumption and test-coverage gaps: a file replacement did not attest other selected state; an early drain did not cover later registered work; socket activity was mistaken for a bounded operation; and a printed foreground report bypassed exit-status propagation.
The added negative and positive controls exercise those exact seams instead of weakening old assertions.

The first broad guard fix demonstrated why ownership checks must stay at the responsible effect boundary rather than being indiscriminately added to every hot readonly path.
Its failure and the corrected evidence are both retained.
This report captures the lesson within the delegated scope; maintained-spec updates and repository commits were explicitly outside this review's authority.
