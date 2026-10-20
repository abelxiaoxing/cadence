# W4 Current-host Composition — Partial Handoff

## Disposition

**PARTIAL; production task admission and model-choice mutation remain closed.**
The requested complete model/current-view/assets/build/HTTP/W6 composition is not finished.
No external SDK/provisioning blocker was established; this pass stops at the safe catalog/private-choice boundary rather than supplying missing current/build authority with defaults.
The remaining work below is still required in this delivery, not deferred product scope.
Independent review is required and has **not** occurred; the main session must dispatch it.
No agents were spawned.

Loaded the active task manifest/artifacts, canonical parent artifacts and both mandatory appendices, MAIN model/current-view decision and complete composition research, current human-review/check/lifetime reports, owning specs, actual W6 metadata/assets adapters, relevant Pi documentation/examples and installed0.84.3 public declarations.
The older research's cold-lineage/check-secret gaps were already repaired by later work; those implementations were reused/preserved, not replaced.
The concrete contract was recorded before edits in [w4-current-host-contract.md](w4-current-host-contract.md), with the later explicit closed-production boundary appended.

## Implemented APIs and Actual Host Boundary

### Shared model contract and transport

`src/service/contracts/models.ts`, exported by `src/service-contract.ts`, owns closed `ChoiceVersion`, `ModelCandidate`, `ModelCatalog`, `ModelChoiceState` and `ChooseModelRequest` codecs.
`decodeModelSelector` factors the existing maintained worker model-selection decoder without changing its supported API/thinking vocabulary.
SDK `max` may appear only as a nonselectable catalog level; selection never clamps it.

- Catalog contains only provider/model, supported API or null, at most seven SDK thinking levels/selectability and fixed eligibility.
- No model body, base URL, headers, env, credential fingerprint, pricing or catalog-entry selection ID is returned.
- At most200 candidates; overflow is explicit `status:capacity, entries:[]`, not a clipped complete roster.
- Whole catalog/choice Reply limit is512KiB, including the wrapper and raw HTTP byte limit.
- `ServiceClient.models(signal?)` and `HttpServiceTransport.models(signal?)` preserve optional readonly abort.
- Typed `chooseModel(request)` uses the exact expected epoch/access/config/catalog and selector, validates response correlation, and never retries or automatically refreshes/replays a POST.
- `GET /api/v1/models` and `POST /api/v1/model-choice` use the existing finite route/auth/attachment/Origin/CSRF rules.
- `HttpAdapters.models` and `modelChoice` are separate optional ports; missing ports refuse, not empty-success defaults.

The actual `createServiceHost` constructs one `OwnerModelChoice` beside its one loaded `OwnerModelContext` and exposes the **real catalog reader only**.
It does not install `modelChoice` or task admission.
All production model-choice POSTs therefore refuse unavailable, including authenticated native requests; no selection changes.
The generated management executable remains SDK-free.
There is no new startup settings/profile/default-model path.

### One runtime and private explicit choice

`OwnerModelContext.catalog()` uses actual public `getModels(provider)`, `getModel` and supported-thinking metadata for configured source providers only.
It never calls `getAvailable`, `checkAuth`, `getAuth`, refresh or inference.
Selected files, runtime errors, function transports, named environment and unsafe/known-secret-bearing identity strings refuse without redacting into a different selectable ID.
Literal checks include named template values from the frozen ordinary launch environment, not only variable names that look sensitive.
The cumulative unique literal allowance is charged before adding entries; no public secret-derived identity is introduced.

`OwnerModelChoice` starts null each boot, in RAM only, and is unique per ServiceOwner.
Its config revision starts strictly above the actual historical accepted revision floor.
A changed exact choice increments configRev/catalogId; a valid unchanged choice reuses its source ID/revision.
Successful quiescent replacement retains only one active source ID, while historical source IDs stay historical/stale.
Final source/access/version and quiescence checks happen synchronously before installation, with no intervening await.
No host-config or credential write is performed by choice/catalog.

`HistoryWriter.configurationRevisionFloor` now includes validated accepted action context revisions across epochs, including metadata-only admissions.
It is not just the resource-policy generation, which is epoch-scoped and can be absent on metadata.
This exposes a scalar floor; it does not replay selection, approvals or execution.

### Quiescence and incomplete action consumer

`ServiceOwner.assertQuiescent()` covers every tracked native/auth/storage/accepted-work original, Stop/flush state and an installed action configuration guard.
An action owner without that guard refuses configuration changes.
Writer pending/fenced/episode/owner/child reservations and model loading/preparation are independently checked by the choice owner.
`TaskScheduler.assertQuiescent()` includes episodes, holders, queued/held review barriers and pumping.
The real TaskActions participant checks its admission/original, accepted-unallocated, metadata/review and scheduler state.

**TaskActions still has its existing immutable required selection.**
Its configuration guard deliberately ends in unavailable even when idle; opening choice against that incomplete consumer would leave its selection stale.
Replacing that final refusal with actual nullable-choice integration is required next.
There is no callback that silently retargets or cancels accepted work.
The existing action owner, scheduler, writer and semantic reducers are not reconstructed or duplicated.

## Verification

[Evidence JSON](w4-current-host-composition-evidence.json) records exact commands, original runner waits/PIDs/exits, file hashes, frozen inputs, build outputs and preserved failures.
All shell commands in this pass selected a newly allocated0700 home-disk TMPDIR/TEMP/TMP; no tmpfs cleanup or personal profile was used.
Observed runtime: Linux x86_64, `/usr/bin/node`26.7.0, Bun1.3.14, installed Pi0.84.3.
Native fixtures use fresh fabricated homes/agent directories/state and guarded numeric-loopback networking.

- Final complete affected run: **1548 passed,0 failed,0 pending,48 files**, original exit0;1658.56s supervisor elapsed.
- All31 scheduler cases,19 check cases and19 human-review cases remain included under their original budgets.
- New model-choice file:23 cases, including13 original native child closes; this is a subset of1548.
- Separate web suite: **105 passed,7 files**, exit0; not included in1548.
- `bun run check`, `lint`, `check:agents`, `check:web`: all exit0.
- Lint: zero warnings/errors, eight existing informational suggestions.
- Canonical service regeneration and exact generated service/operator byte checks passed.
- Canonical web production used two private Vite builds before publication; a separate double `build:web:check` matched canonical names/bytes.
- The final365-input source/test/build/config/provenance freeze stayed unchanged across the complete affected run and was checked afterward.

Original20s cases,15s native fixture children,8MiB/100ms read and5s capture/write-report limits remain unchanged.
The3600s outer allowance waited the original test runner without termination.
No unchanged failing broad run was retried merely for green: the second full run followed the concrete source/fixture corrections below.

### Qualified versus injected

The new native driver bundles the source factory into an ordinary Node artifact with actual installed peers and the existing test-only public API network/filesystem guard.
It observes one real ModelRuntime, zero getAuth/availability calls, initial no selection, real catalog data, private exact choice/reuse/replacement, capacity, unsafe/literal/template identifier refusal, same-attachment readonly session refresh, cookie rotation and real disk/restart floor reconstruction.
Both native capability and cookie clients perform actual HTTP reads.
The factory's production choice refusal is explicitly asserted before each scenario.

Private `OwnerModelChoice.choose` is called directly in the fixture because the production mutation gate remains closed.
Those cases are **not authenticated HTTP choice acceptance**, accepting task workflows, browser UI or build-handshake qualification.
Busy-original cases use explicitly injected pending original promises; they are not newly executed OAuth refreshes or shell checks.
The replay-floor case injects an accepted Create identity into the real writer and performs real publication/stop/restart; it is not HTTP task consent.
The broader existing suite separately exercises its real SDK/check/history/lifetime boundaries, without completing this missing host composition.
No universal descendant-close, physical-human/device, paid-provider, alternate-runtime/platform or extracted-package claim follows.

## Preserved Failures and Corrections

1. Early typechecks caught fixture HttpPolicy schema and missing stdin-disposition mistakes, plus a scoped-env typing error.
   Their logs remain; no production limit/type bypass was added.
2. Initial22-case native/model run:20 passed/2 failed.
   The revision-floor getter incorrectly considered only current-epoch resource policy; historical accepted metadata configRev37 restarted at1.
   The separate accepted-context floor fixed that demonstrated defect.
   The rotation fixture also attempted mutation through a revoked attachment; explicit refresh corrected the test assumption without hidden transport reacquisition.
3. First complete affected run: **1546 passed/2 failed**, retained with original exit1.
   The new template-secret fixture used a `CADENCE_*` variable, which the existing host intentionally strips as control material; the corrected fixture uses an ordinary named launch variable.
   The new catalog literal list counted the same128KiB credential twice before deduplication, breaking the existing auth-size scenario before its intended envelope refusal.
   Unique incremental charging fixes that root cause without increasing the256KiB literal allowance or128KiB worker envelope.
4. Corrected complete model files passed99 cases; this overlaps the final1548, not additional totals.
5. Prior scheduler/event35/native/history failures remain historical and unexplained; these fixes and new passes do not assign them retrospective causes.

## Files and Generated Outputs

New files:

- `src/service/contracts/models.ts`
- `src/service/model-choice.ts`
- `test/service-model-choice.test.ts`
- `test/helpers/service-model-choice-child.ts`
- This handoff, the contract note and evidence JSON.

Changed existing owners:

- `src/worker-public.mjs`, `.d.mts`, `src/service/contracts/domain.ts`, `src/service-contract.ts`: shared selector factoring/exports.
- `src/service/model-context.ts`: bounded catalog, shared exact validation, private replacement and identifier privacy.
- `src/service/{owner,scheduler,task-actions}.ts`: quiescent checks and explicit incomplete-consumer refusal.
- `src/history/writer.ts`: accepted configuration revision floor.
- `src/service/{ports,http,host}.ts`, `src/service-{wire,client,http-client}.ts`: finite typed transport/read-only host composition.
- `provenance/auth-reuse.json`: current HTTP destination hash plus revision note; upstream pins/licenses preserved.
- Canonical `src/service-cli.mjs`, `src/service-host.mjs`, `web/dist/manifest.json`, `web/dist/assets/cadence.js`.

All other compiled web bodies, including60 fonts, remain byte-identical to the preserved prior build.
No W6 source renderer, dependency/pin/lock, maintained spec, task status, user Git/status, credential, deployment or cleanup operation was performed.
No generated file was hand-edited.
Source/test/generated hashes and preserved prior web output location are in the evidence JSON.

## Exact Remaining Work — Do Not Open Admission Early

1. Supply the one TaskActions with actual nullable `OwnerModelChoice.snapshot()` and real config/check-env generations.
   Split structural liveness from requiring a model; use one action-neutral current observation builder with post-await source checks.
   Replace the immutable-selection configuration refusal only when this integration is real.
2. Implement shared current/current-changes/active metadata: actual roles, current-v1 readable plan and coverage, saved graph reference using existing cold lineage/progress, actual changes/check obligations and at most8 active references.
   Use the same prospective default graph identity for current display and Start; no old-context authority, all-archive cache or fake empty graph.
3. Bind the existing W6 PlanMetadataPort, explicit chooser, current/active/change views and same-attachment capability refresh.
   Add the one portable bounded prospective plan UUID/hash helper and explicit rebind/Save semantics for old source IDs.
4. Extract the nonexecuting contract-hash helper, independently embed service identity, load actual package-relative assets before HTTP construction/listen, and add closed bootstrap/build negotiation.
   Enforce normal ingress and UI compatibility; preserve separately compatible explicit Cancel.
   Compiled service must have no TS/source fallback and source factories need real explicit identity.
   This pass rebuilt outputs but did **not** implement asset serving/build negotiation in the actual host.
5. Compose actual nullable actions/current/live/private secret sources and all named paths once, with original/quiesce hooks installed before admission.
   Only then install the production `modelChoice` and action ports and advertise mutation capabilities.
6. Execute the requested source/generated authenticated full Create→Save→pre-Start graph→Generate advisory→Start→shell Check→current changes→ReviewDone workflow and all two-attachment/duplicate/lost-reply/busy/rotation/detach/restart/Stop/build negatives.
   This acceptance is not supplied by the current1548/105 component checks.
7. Main-owned independent review remains mandatory.
   W1 outbound proxy/informed recovery, W5 terminal cutover, W6 full accepting browser and W7 complete distribution/integrated acceptance remain open.

Spec-sync recommendation for main after review: document catalog-versus-selection authority, explicit capacity, source/literal-safe identifiers, historical accepted revision floors, original-work quiescence and the still-closed actual host.
Do not update maintained text to claim current/build/browser composition is complete.
