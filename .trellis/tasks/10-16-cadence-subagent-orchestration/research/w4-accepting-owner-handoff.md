# W4 accepting-owner assignment — partial implementation handoff

## Disposition

**Partial, not acceptance-ready.
Production HTTP task admission remains null.**

Implemented a real Generate-plan path and two adjacent correctness fixes, not the complete accepting-owner assignment.
The existing writer-preference native scenario still fails its unchanged20s deadline.
Do not open production admission or claim W4/product completion from this handoff.
Independent review is required before main acceptance.

Concrete pre-edit contracts and remaining integration boundaries are in [w4-accepting-owner-contracts.md](w4-accepting-owner-contracts.md).
Exact before/after hashes, commands/exits/log hashes,351-input manifests and native receipts are in [w4-accepting-owner-evidence.json](w4-accepting-owner-evidence.json).

No agents, user Git/status/staging, dependency/pin/lock changes, real credentials, deployment, cleanup, task-status changes or historical receipt rewrites.
All source edits are within the assigned core/publication seams.
Existing historical1389/37 and W6 counts remain historical, not this session's qualification.

## Implemented source boundary

### Generate-plan is a genuine separate readonly episode

- `TaskActions.observe/activate` now supports `generate-plan` through the existing ActionAdmission.
  Existing independent code-kind authorization remains; readonly tasks cannot use Generate to gain capability.
- `EpisodeInput` is a discriminated union: `{kind:"start",graph:Graph,planUnretained:boolean}` or `{kind:"generate-plan",graph:null,planUnretained:false}`, with the existing shared episode callbacks/context.
- `TaskScheduler` allocates one planner for Generate, preserves accepted kind `generate-plan`, and records null `RunIdentity.graph` and null `RunAdmission.graph`.
  It neither runs the saved graph nor invokes Start's accepted-plan producer or graph handoff fact.
- `GraphContext.planningAssignment(model)` supplies a fixed research-purpose `design-explorer` assignment from actual package role content/hash.
  `planningRequest(task,model,runId,childRunId)` reuses the shared public request builder, exact model, readable context and bounded root hints.
  Empty handoff uses the existing positive wire version1; it is not a graph reference or approval.
- The same fair scheduler, pre-auth reservation, preparedWorker, public SDK, capture sink, writer, auth/native/storage joins and limits remain.
  No new SDK session owner, executor, runner, writer, reducer or provider profile.
- Output is advisory readable decomposition.
  Instructions request at most16 suggested assignments, purposes/dependencies/outputs/checks.
  Genuine final bytes are retained independently; invalid/oversized proposal text is not parsed into authority, clipped into an accepted graph or used to fabricate native failure.
  Structured automatic proposal import is **not implemented**.
  Explicit local draft editing/Save and separate Start remain required.

### Publication preserves the saved plan

`src/history/publication.ts` no longer copies a generated result into `task.plan`.
Generate updates only the ordinary summary/phase/baseline/activity through the existing expected-byte publisher, clearly labels its result advisory and retains full final bytes in history.
Empty plans remain empty; a generated result cannot make an empty code task eligible for Start.
Existing plan/check bytes and saved graph content remain distinct from the generated result.

`TaskActions.observe(save-plan)` now displays the exact proposed plan and graph, rather than the old readable plan and null graph.
ContextVersion continues to describe the selected current task/graph, not prospective committed content.

### Subsequent pre-effect publication uncertainty

The new actual Generate/external-task-edit regression exposed a pre-existing reducer gap: a running summary had already published, then a later summary could not prepare candidate bytes because raw task bytes changed.
The writer attempted its existing uncertain pre-effect fact, but `publicationTransition` accepted that shape only before the first publication.
Historical receipt stayed at the earlier `published` fact despite owner quarantine.

The same shared reducer now accepts a **new distinct** publicationId with uncertain status and null observed bytes from the prior published state.
It retains the earlier intent for provenance, fences further publication and never invents candidate bytes, successful save or replay authority.
Duplicate IDs, fabricated success and non-null observed pre-effect refusal still reject.
The actual native result remains independently completed/exit0; external task bytes remain unchanged and the latest publication becomes uncertain.

## Files changed

- `src/service/graph.ts`: one fixed readonly planner and shared request composition.
- `src/service/scheduler.ts`: start/generate episode union and correct non-Start allocation/dispatch.
- `src/service/task-actions.ts`: Generate admission/activation, exact Save preview and existing saved-graph identity across own Generate publications.
- `src/history/publication.ts`: advisory result without automatic plan overwrite.
- `src/history/run-state.ts`: subsequent pre-effect uncertain publication transition.
- `test/service-scheduler.test.ts`: six added Generate cases, including one added variant of the existing preparation-barrier control; existing Save helper checks its existing preview without extra observation.
- `test/service-history-publication-recovery.test.ts`: three subsequent-publication mutation variants plus three negative authority controls.
- `src/service-host.mjs`: canonical rebuild; management bundle unchanged.
- Three new research records: contracts, this handoff and evidence JSON.

No portable DTO/wire/client/browser source changed.
Browser source/build identity and canonical assets remain byte-identical.
No current provenance destination hash changed because the touched source is not an adapted destination.
Maintained spec synchronization is recommended after independent review: Generate is now locally executable in the closed core; complete host actions/current metadata/Stop remain pending.
Do not update specs to claim the full accepting composition.

## Executed evidence

Fresh0700 home-disk root: `/home/mirako/abel/cadence-w4-accepting-VzLBMo`, observed on `/dev/sda2`.
Commands used isolated HOME and explicit TMPDIR/TEMP/TMP under it.
The initial required task-path probe and directory allocation preceded that environment; this deviation is retained.
Native fixtures further isolate fabricated agentDir/HOME and allowlist the environment; provider contacts are numeric loopback.
Actual Node26.7.0 `/usr/bin/node`, Bun1.3.14, Linux x64, installed Pi0.84.3.

| Gate                                                   | Result and evidence scope                                                                                                               |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Final Generate selection                               | 6 passed /22 filtered,39.73s. Actual core/native/disk, except explicitly injected preparation continuation. Not a whole scheduler pass. |
| Contract/publication/plan/semantics/final-review batch | 362 passed /5 files,114.27s. Final maintained inputs; generated host rebuild followed this batch.                                       |
| SDK/process/recording/public-codec/owner batch         | 532 passed /5 files,109.11s. Mixed actual native/disk and labelled mocks; not532 native scenarios.                                      |
| CLI/proof-HTTP/export-HTTP/graph-boundary-review batch | 45 passed /4 files,98.52s. Actual mutation-closed host/read integration, not accepting actions.                                         |
| `bun run check`                                        | Exit0: syntax, canonical operator/service byte checks, root TypeScript.                                                                 |
| `bun run lint`                                         | Exit0, no errors/warnings; six pre-existing informational suggestions.                                                                  |
| `bun run check:agents`                                 | Exit0.                                                                                                                                  |
| `bun run check:web`                                    | Exit0.                                                                                                                                  |
| `bun run test:web`                                     | 105 passed /7 files. Pure/SSR/filesystem/HTTP/WS, no new real browser run.                                                              |
| `bun run build:service`                                | Exit0; canonical host rebuilt, management unchanged.                                                                                    |
| `bun run build:web:check`                              | Exit0; two real private Vite builds matched canonical69-asset closure. No canonical web mutation.                                       |

Final351-input manifest remained unchanged across the final Generate/native/host-read/build/type/lint/web gates.
Separate/intermediate selections overlap; do not sum them into a fabricated whole-suite total.
No full verify, pack/extraction, physical browser/human/provider or platform qualification was performed.

The Generate fixtures demonstrate one original SDK child despite two saved edit assignments; exact selected model and readonly read/grep/find/ls tools; genuine final/stdin/cleanup/original zero close; graph-null historical admission; full48022-byte invalid-structured/oversized-for-plan final retention; preserved saved/empty plan; duplicate command observation without another child; real token rotation/detach without implicit Cancel; explicit Cancel with original closure; raw-byte publication conflict preserving external bytes and completed native outcome separately.

The preparation test deliberately holds a post-accounting continuation and cancels before provider contact.
It demonstrates retained slot/no late launch, **not genuine pending OAuth or network refresh**.
The raw-task mutation and negative publication facts are intentional fixture injections on actual disk.
Native receipt files preserve original worker launch/close/exit observations; they are not universal descendant closure evidence.

## Preserved failures and unresolved gate

1. Initial typecheck failed because AgentDefinition.role is a general string, not the closed RoleSelection union.
   Fixed the planner's role to the actual selected literal `design-explorer`; subsequent typechecks pass.
   Original log retained; initial numeric exit was not captured, so evidence does not invent it.
2. First core batch:33 passed /2 failed,264.59s.
   The new subsequent-publication regression failed as described above; fixed and independently exercised by the focused/native/disk controls.
3. The existing writer-preference case timed out at20000ms in that batch (reported20653ms including teardown).
   The new helper originally performed a redundant full Save observation.
   Removing it did **not** establish a repair: corrected focused run still timed out (reported20539ms), with1 other test passed /26 filtered.
4. Both writer-preference receipts remain failed.
   The second receipt observed two actual original SDK closes with exit0, but that does not establish full episode settlement within the required budget.
   No elapsed limit was increased, no assertion weakened, and no unchanged rerun was used to obtain green.
   Exact cause remains unestablished; targeted stage/original-write diagnostics are the recommended next investigation, not larger budgets.

These failures prevent acceptance of this partial slice.
Earlier historical timeouts/event35/platform failures remain unexplained and untouched.

## Exact remaining implementation and qualification gates

1. Diagnose/fix the writer-preference deadline failure with bounded stage/original-write evidence, preserving current20s/15s/read/capture limits; independently review this partial source and new publication transition.
2. Complete real configured/native-local manual checks on runCheck/runProcess: frozen ordinary environment, private known literal collection without getAuth, full bounded incremental stdout/stderr retention, fair shared gate/two slots, pre-effect check-start and original EOF/close/write settlement.
3. Exact own check-generation transition, later stale/not-run obligations, actual changes body/coverage and short-barrier human review.
   Preserve native/recording/failed/partial facts and strict v1 publication.
4. Register accepted metadata/whole episodes before effects and compose real synchronous host quiesce/Stop across accepted-but-unallocated, queued checks/review, auth/native/post-native writes.
   Existing closed host Stop does not yet own TaskActions as a whole; no claim otherwise.
5. Cold durable own-publication lineage, bounded active/recent ReadEnvironment and discoverable activeRunRefs; actual current roles/readable plan/savedGraphRef/changes/obligations DTOs with finite progress and optional AbortSignal.
   Current16-entry RAM publication cache is not restart authority.
6. Resolve actual model selection before constructing the core.
   Installed public ModelRuntime exposes getModels/getModel; do not guess a registry property, first model or source ID.
   Use existing selected configuration plus explicit finite owner choice, refuse while busy, and never resolve auth/probe/write configuration on metadata reads.
7. Bind W6 PlanMetadataPort to those actual shared metadata/proposal APIs.
   Compose package-relative loadWebAssets and compare boot metadata with the compiled LOCAL browser identity; mismatch closes normal actions, not a fallback executor.
   Preserve independent compatible Cancel.
8. Only then open admission and qualify authenticated full Create/Save/graph/Generate/Start/check/changes/review flow, native/browser authority distinctions, two attachments/detach/rotation, lost reply, cold restart/no replay, all Stop stages and affected combined capacity/range/alias/crash/unknown controls.
9. W1 outbound-auth proxy and informed recovery, W5 native cutover, W6 accepting browser workflow and W7 distribution/notices/full verify remain open.
   Paid-provider, physical-human/device and other native platform/runtime lanes remain unqualified.

The full assignment remains mandatory; this handoff is not a redesigned smaller product or permission to defer its core features.
