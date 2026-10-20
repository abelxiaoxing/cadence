# W1 real host and management composition handoff

## Disposition and authority

Implemented the assigned mutation-closed host slice under the existing continuous implementation authorization.
No agents, task-state/spec edits, Git mutation, installation, real credentials, actual-checkout service deployment or cleanup.
W4 actions remain **closed**; this is internal integration, not an MVP or complete delivery.

Read the W1 manifests/artifacts, parent PRD/design/both appendices/plan, runtime-orchestration handoff, complete W4 readiness review, current owner/history contracts and installed public ModelRuntime declarations.
Installed Pi remains0.84.3, not the newer global documentation.
Existing unrelated untracked history was left alone.

## Actual factories and ownership

`src/service/host.ts#createServiceHost(input: HostInput): Promise<ServiceHost>` is the actual composition, not an admission fixture.
`HostInput` is closed: canonical workspace/state-home selection, `HostConfig`, and nullable RAM-only environment token.
The factory independently checks configured cwd belongs to the selected canonical checkout.

The returned owner-only object contains `coordination`, `owner`, `writer`, `reader`, `projection`, `live`, `models`, `access`, `http`, `endpoint`, and frozen `checkEnvironment`.
These are actual ServiceCoordination/ServiceOwner/HistoryWriter/HistoryReader/HistoryProjection/HistoryLive/OwnerModelContext/AccessMaterial/ServiceHttpServer objects.
No public endpoint returns this object.
Existing native monotonic/time APIs remain the clocks; no fixture clock or accepting current-context callback is installed.

Startup is: validate selected config/source → bind HTTP with gates closed → resolve positive endpoint → reserve all-root registry and initialize genuinely new config/access under its short lock → acquire lifetime v1/new lease → explicit new format3/key history initialization → actual writer/read/live/access/model objects → one-time `http.configure(...)` → original tracked model-runtime load → authenticated readonly admission/readiness.
Model construction uses the existing selected Pi files; there is no inference session or getAuth on startup/read/status/token helpers.
The actual SDK is dynamically imported only in the separate host process after selected environment admission.

`ServiceCoordination.acquire(config, resolvedEndpoint, initializeNew?)` calls the new initializer only for genuinely absent selected metadata, under the existing registry reservation, before registration.
Failure retains the existing partial fences.
`configuration()` and `localAccess()` are readonly; the latter is private native material, never a public projection.
The lease additionally pins the host-config incarnation/raw identity.

Port0 is initial bootstrap only.
`host-config.json` stores closed `cadence-service-host/1` with actual positive HttpPolicy port, selected cwd/agentDir and token source/path (no environment token).
Its canonical identity is bound by the unchanged owner-config schema; registration pins that positive endpoint.
Restart reuses exact selected bytes/port; explicit conflicting flags, missing/unsafe access/history/key or interrupted setup refuse without adoption, fallback ports or repair.
The generic coordination primitive retains its preexisting port0-policy support for other tests; the real host never persists port0.

`ServiceHttpServer.configure({auth,adapters,management})` is single-use before admission; deferred construction contains no accepting dummy objects.
Existing constructor callers remain compatible.
Actual adapters are the entire HistoryProjection/HistoryLive and writer receipt lookup.
Admission is null, session actions/manualChecks are false, selected models are only genuine RAM selections, and current control/check authority is explicitly unavailable until W4.
Readonly bounded legacy inventory uses TaskStore validation and the caller read budget; it never imports approvals or rewrites running records.
All retained list/entity/graph/detail/search/export/progress/snapshot unions pass through existing shared owners, not local substitute results.

## Original-lifetime seams

- `OwnerModelContext.prepareTracked(input)` returns `{result: Promise<ModelPreparation>, settled: Promise<void>}`.
  `prepare` remains the reporting compatibility wrapper.
  `settled` belongs to this preparation's original SDK work and exact accounting jobs, carries no auth material, and is not global pending==0 or a Promise.race receipt.
  Original tail/capacity remain held after reporting refusal/cancel; no late preparation resumes getAuth/launch.
- `AuthAccountingPort.original(report)` maps that exact write report to its original job.
  Real HistoryWriter supplies it using a WeakMap.
  `lifetimeTracked` reflects the actually installed writer lifecycle hook, not a network/authority attestation.
- `HistoryWriterOptions.onOriginal(original,safety)` runs synchronously before scheduling/effects.
  It does not await a viewer or alter journal/capture/progress formats.
  Throwing registration refuses/fences the job before effects.
  The actual host connects every job to `owner.trackHistory`.
- `ServiceOwner.trackHistory` retains original jobs; safety settlements and the owner's flush may finish with admission closed.
  Late ordinary jobs/lease loss refuse.
  `trackAuth` can omit a duplicate settlement registration when the real writer already tracks it.
  Drain loops over newly registered originals, including auth's later journal write, even on quarantine paths.
  The existing reentrant shared Stop, per-effect lease checks, original listener close and no-late-auto-release rules remain.
- The internal misuse guard now accommodates the already bounded W3 owner plus two child queues and256 internal-operation slots.
  It is not a new capture ceiling or reservation authority; real scheduler/writer reservations must precede effects.

## CLI and management protocol

Package bin `cadence-service` points to generated `src/service-cli.mjs`; the separate generated `src/service-host.mjs` owns runtime construction.
Both are ordinary Node ESM with external installed peers, package-relative paths and no TS/global-SDK fallback.
`scripts/build-service.mjs [--check]` rebuilds deterministically; check writes only fresh private temporary outputs and compares exact bytes.
Root `check` includes both generated-byte checks.
Biome's existing generated-output override now names precisely these two outputs as well; syntax/type/build checks remain enabled.

```text
cadence-service start [--workspace PATH] [--state-home PATH]
  [--config PRIVATE_JSON] [--agent-dir PATH] [--host 127.0.0.1|::1]
  [--port PORT] [--token-file PRIVATE_FILE] [--foreground]
cadence-service status|diagnose|stop|token-rotate [--workspace PATH] [--state-home PATH]
cadence-service token-link --reveal [--workspace PATH] [--state-home PATH]
cadence-service recover inspect|resolve  # explicit refusal; no informed adapter yet
```

`--config` supplies the same closed HostConfig schema, not credentials or environment overlays.
It is optional; later starts use the selected private configuration.
Token sources are mutually exclusive generated/file/environment (`CADENCE_WEB_TOKEN`); generated/file rotation is durable and revokes sockets/grants, while environment rotation refuses and requires explicit restart with changed environment.
Normal output omits tokens/capabilities.
`token-link --reveal` is the explicit local reveal.

Default startup spawns the actual Node executable detached, with selected environment before SDK imports, bounded16KiB anonymous stdin and bounded private readiness output.
It validates authenticated exact-epoch local status before reporting alive.
The unchanged10s bound reports unconfirmed without killing/restarting the original; parent departure only detaches.
Foreground waits the original child.
No process.env mutation, inherited preloads, alternative executable, provider fallback or provider credentials in argv were added.

Finite `/local/v1/admin/{status,diagnose,stop,token-link,token-rotate}` routes require direct loopback native capability, no browser Origin/cookie/forwarding.
Status/diagnose are bodyless GET; the other routes are POST `{}`, except token-link requires `{reveal:true}`.
Unknown fields/body authority cannot confer local access.
The management client has bounded native HTTP response/timeout handling.
There is no browser arbitrary-shell/manual-check/task route.
Selected access-file/external-token incarnations are rechecked on authentication/current-access boundaries.
Existing Host/Origin/CSRF/proxy/WS/export-revocation rules remain.

Stop acknowledges the exact authenticated epoch before scheduling the shared drain; it never waits for the server to close its own response socket.
Only a received accepted acknowledgement followed by exact-epoch complete lease-release observation yields stopped.
Inconclusive samples during the short release lock remain bounded waits.
Lost acknowledgement stays unconfirmed even when the original host later closes and files say stopped.
No PID absence, signal or stale reclaim establishes success.
Quarantine/ownership loss blocks later effects; pending originals retain resources, and late settlement does not auto-release.
Diagnosis remains restricted; startup failure after ownership retains fences rather than silently returning a healthy owner.

The service freezes ordinary launch environment and removes service/control inputs; environment access token travels only on startup stdin.
Native capability never enters browser/history/logs/check env.
`checkEnvironment` excludes the injected PI_OFFLINE startup marker and contains no resolved model auth; it is not yet a qualified W4 parent-check runner.
Configured outbound proxy/bypass/preload presence is refused before launch, including empty values.
W2 worker routing does not qualify owner getAuth, and no asserted boolean enables it.

## Verification and evidence limits

Fresh disk-backed0700 root: `/home/mirako/abel/cadence-w1-host-01a1434b`; TMPDIR/TEMP/TMP were selected there for development/check commands.
Native CLI/host fixtures use fresh fake cwd/HOME/agentDir/state/temp and explicit environment allowlists, fabricated credentials and numeric loopback.
Files/receipts are retained, not cleaned.

Actual host: Linux x64, `/usr/bin/node` v26.7.0, Bun1.3.14, installed coding-agent/pi-ai0.84.3, ws8.21.3.
Pins and bun.lock are unchanged; package edits are bin/build/check only.

Frozen final run: **663 passed /0 failed /0 skipped,10 files**,343.39s.
The command selected service-cli, service-owner, service-auth, service-model-context, service-contract, service-history, service-history-semantics, service-history-publication-recovery, service-history-final-review, and service-history-proof-http.
`bun run check` and `bun run check:agents` exited0.
The33-input manifest matched after all three commands.
Final lint is recorded below after this evidence is formatted.

The20 new tests include actual ordinary-Node detached/foreground CLI+host startup, selected positive-port/restart config equality, duplicate/conflicting start, overlap/disjoint roots, absent/unsafe/partial preservation, generated/file/environment token sources, wrong/stale/browser-forbidden native management, closed actions/current authority, retained legacy/read surfaces, actual10s unconfirmed original survival, lost Stop acknowledgement versus original close, and ownership-loss refusal.
The real composed host also retains/searches/details/exports more than one8MiB read quantum through the actual shared HTTP client with unchanged files.
Both NDJSON and Markdown complete through verified trailers/original EOF.
The local factory fixture injects **historical content/admission/role inputs**, not accepting task/current authority or model inference.

Two additional native controls inside that20 use the actual HistoryWriter/ServiceOwner and stock public SDK/fabricated Radius OAuth.
Actual five-second writer reports retain per-preparation/original storage reservations.
Cancel/short Stop while genuine OAuth HTTP is pending, then stalled original settlement recording, keeps fences after all late completions; intent stall contacts0, OAuth lane contacts1, launches0.
The small Stop waits are reporting injections, not retimed recording/native-worker limits.
Viewer promises are not joined to commits.

These are source/generated-local-artifact/native/component evidence, **not an extracted-package audit, real deployed checkout, W4 execution, physical operator/human, paid-provider or browser/terminal-cutover qualification**.
Existing HTTP/proof tests exercise shared progress/snapshot contracts; the new composed large-history lane exercises real search continuation/detail/export, not every cold/no-index progress variant under the host factory.
Earlier failed development logs remain: fixture scope/relative-Bun-path errors and the temporary adapter-copy regression were corrected, not relabeled passed.
The earlier frozen main1307 and old unexplained timeout/event35 failures remain separate; no new historical causality claim or summed test totals.

## Remaining handoff gates

1. Main independently review this frozen slice before W4 activation.
   W4 must implement real AdmissionOwner/scheduler/current observations and the separately assigned plan/fact/check-generation/check-output seams.
   No accepting defaults are installed here.
2. W1 accepting-management/owner outbound proxy plain+compressed fabricated OAuth and composed inbound HTTPS proxy lanes remain pending.
   Current outbound configured route explicitly refuses.
3. Informed exact-resource recovery is still unavailable; no lock release or history repair was implemented through recovery.
4. W5 native detach/cancel/client cutover and W6 real browser are pending; legacy extension remains reachable and is excluded by the lifetime v1 lock while this service owns the checkout.
5. W7 complete archive/member/license/build/browser/terminal/real extraction and full-suite qualification remain pending.
   Old package policy is not regenerated or represented as qualifying new bodies.
   No release/commit/publication approval follows.
6. Main may update maintained owner/history/directory specs after independent review; this delegation intentionally did not edit maintained specs/task status.
   Exact source APIs above are the serial W4 handoff, not rewritten historical interface-freeze hashes.

## Frozen identities

Full33-path manifest: `/home/mirako/abel/cadence-w1-host-01a1434b/frozen-inputs.json`.
Source/test/package/provenance hashes below identify this revision, not prior freeze acceptance.

| Path                                    | SHA-256                                                            |
| --------------------------------------- | ------------------------------------------------------------------ |
| `package.json`                          | `5f3e8e63e8a46dfdf100886f4d509943413fad6d00c9ff35c3844e7475c6a467` |
| `biome.json`                            | `5a0f89511d646353b40bc2cc3cc9d080f490301ad51c219f075d89acee4778db` |
| `bun.lock`                              | `cc31e7ad885c21849b38515cb47bb9913b75801a3b484bf647e11fe354f47551` |
| `provenance/auth-reuse.json`            | `4cf69feedeb86c538429b41597861f1ee2f300cac4f1c0ead6f298a8da6e54a9` |
| `scripts/build-service.mjs`             | `7576c72991f6d0a31e5d4af246cd7afa5960f8134c3d37724b79632ea4805481` |
| `src/service-cli-entry.mjs`             | `f2099f4138f3ef307e2d92ac03c4d28cc0190472280eb11438a5eb951d169819` |
| `src/service-host-entry.mjs`            | `aab60dfca01b22a4f0cff3a50d8b908d15de50ee86934a041f51722799f4e619` |
| `src/service-cli.mjs`                   | `c7cf5737caa34639fe02a4f27747ad94e13d2a2e10a716ab4b6712e2fcd734bb` |
| `src/service-host.mjs`                  | `b6cf9abb20987659c5da06c7bb4891b85273d2f57c481792ddd31686c7d0b858` |
| `src/history/writer.ts`                 | `c9e1328f6783e2c1b71f17d479dcfdcd8f6ac0059dcdc83a9f47711d426861c4` |
| `test/service-cli.test.ts`              | `08809f38c0ed24ff853125d7adecdd6e4de5d3d757b809c0a1a36cc47e5ff3db` |
| `src/service/auth.ts`                   | `4b912c42db832de1d8d33dc8aab3e19b9a3b9a5f986a7a8fa527d8560d8c7de1` |
| `src/service/cli.ts`                    | `e3b3898e7898be637256b85bb7ff30cb28e5f90258a772f4e8296a092322859f` |
| `src/service/coordination.ts`           | `160a21cde4ca0e39cfb7106cf8d9134171ed846771f6bfcec6ff66405c45d7dc` |
| `src/service/host.ts`                   | `b36df937363ecc5f2eb2c4fa38d9d7e0becd0644beaec0779bf1c7141d2a406e` |
| `src/service/http.ts`                   | `38a212511f15b71f19f1c5b1984dd46faead18754c475d52787dd6700313d948` |
| `src/service/model-context.ts`          | `c7bfd0e1d2fd516c709a4902c010dcd122408616f74795b879b21639078cb578` |
| `src/service/owner.ts`                  | `cbd06916d84b23b3553102ee5bcf12ad1f4f9a4891af7b9bef27baae48960de4` |
| `src/service/ports.ts`                  | `f5bd4149953426c1fb9e56b09e897a3636c86b06697ed498d2439531e9b880a2` |
| `src/service/runtime.ts`                | `96e4ceb6b5212aedc0f0647a6ab2b35783c4956926bff09a56e7c7de212949e1` |
| `test/helpers/service-host-delayed.mjs` | `8f49cbe518d3174aa1d3bd5f1351a2b2c3d4aa33f4d6b03c40b3203412d35040` |
| `test/helpers/service-delayed-cli.mjs`  | `1847767f6d36daa296a5f7754478ef3df5328664de97262df1ffcdab2fd62a50` |
| `test/helpers/service-host-lifetime.ts` | `e5dd09882811eaf82bd925dfa4693edf4199eb1bc38510a9ffcefc67099252d2` |
| `test/helpers/service-host-fixture.ts`  | `63ce3cae380744e84f70a9c6230d42fc953b666840dc87fdaf84af72ccbe004a` |

| Evidence file under private root | SHA-256                                                            |
| -------------------------------- | ------------------------------------------------------------------ |
| `frozen-inputs.json`             | `9adaaf7698ac2c010e5802485f6027785c2ca05d57f77994ca9857b707bae759` |
| `identity.json`                  | `de97f91e7c8478ca56ece99921808044246d9c469787c6dce0179a0843a298ad` |
| `frozen-tests.log`               | `edf9fb87d8daa3f1906b4e36d9049757bd820038fb646413ce6d765db0e3549e` |
| `frozen-check.log`               | `6de17e4bf4234c4eecf065c2988d1bb9bee715f226572eaefab255ca433b46cc` |
| `frozen-agents.log`              | `fc459b9f542bbe9546842994f18a74f6a80e908f467ce497916608c24531eebf` |
| `frozen-exits.txt`               | `33075866b405f3ff15132c67d0342f66cb3bc2b0a23b783237c86bc2e39e7d50` |

### Final lint

`bun run lint` exited0: no warnings/errors, only the two pre-existing package-audit informational suggestions.
This report is formatted before the final rerun; its post-format receipt is `/home/mirako/abel/cadence-w1-host-01a1434b/final-lint-after-evidence.log`.
The prior successful `frozen-lint.log` SHA-256 is `851922b5ffa15490389c9fdc30c23b5d33ef6528cdb96b86b48c2fb66800ac2c`.
New handoff Markdown is also checked explicitly with `rumdl --no-exclude`; normal whole lint retains the existing task exclusion.
