# Focused Service Parent Checks — Implementation Handoff

## Disposition

Implemented the assigned check slice against the actual action/scheduler/native/history owners.
**Independent review is required.
Production HTTP admission remains null; W4 and product delivery remain incomplete.**
No agents, task-state changes, dependency/pin/lock edits, user Git/status/staging, real credentials, deployment, cleanup or renderer rewrites were performed.
Existing unrelated source/history and failed receipts were preserved.

Read the active manifest/context, child and mandatory parent artifacts/appendices, main service-check handoff, latest accepted-work lifetime review and actual interfaces before editing.
The pre-implementation choices and later source-backed pipe correction are in [the selected contract](w4-service-checks-contract.md).
[Evidence](w4-service-checks-evidence.json) binds source hashes, commands, original waits, results and native fixture receipts; it does not replace independent review.

## Actual APIs and Data Flow

- `TaskActions.observe/activate` now handles Check through the existing `ActionAdmission`, including exact configured selection, code-kind and drained-target checks, native-local manual authority, normal accepted-work accounting and expected-byte publication.
  Manual selection retains the existing `Manual`/120000ms contract; browser manual preflight refuses.
- `TaskActions.checks(taskId)` is a real readonly configured-obligation callback returning `{revision,selections}` from `TaskStore.checks()`.
  It does not use a TaskController, import old approvals or create a current-environment default.
  The future real `ReadEnvironment` still must compose this callback and current identities.
- Check previews add the optional closed `checkEnvironmentPolicy: "service-launch-ordinary/1"` alongside actual command/name/timeout/cwd and context epoch/environment generation.
  Historical previews without this field retain their decoding.
- `EpisodeInput` adds `{kind:"check", graph:null, planUnretained:false, check, cwd, environment, secrets, definitionCurrent}`.
  Durable `RunIdentity` has `kind:"check"`, graph null and zero assignments; its internal check reservation is not an SDK node or fake frame.
  The same fair scheduler holders and two-child-or-check ceiling cover all tasks.
- `runCheck(check,cwd,signal,service?)` adds owner-only `ServiceCheckContext` with frozen environment, `CheckRecording`, mandatory `maySignal` and `onNative(CheckNativeSettlement)`.
  It calls the existing `runProcess`, preserving shell/CMD construction, ignored stdin EOF, native close and TERM/KILL/unknown bounds.
  The native original is registered before the launch microtask; a fresh guard runs inside that microtask.
- `HistoryWriter.checkOutput(link,checkId)` validates the actual started check/operation/held gate and supplies a narrowly scoped content continuation through the existing owner writer/reservations.
  Ordinary quiesce may drain that already-started content; a recording fence still refuses it.
  Original storage accounting is unchanged; no alternate writer, raw spill, archive string or accepting sink exists.
- `CheckRecording` applies independent fatal UTF-8 decoders and existing `TextSanitizer` instances to stdout/stderr before owner-content persistence.
  It emits one real `check` detail, with explicit stream labels and observation-order disclaimer, returning the actual committed ContentRef.
  Chunk labels may split an original string; this format is not a byte-identical merged OS stream or an asserted total write order.
- Check-start precedes spawn; check-settled follows actual native result and output end/reference.
  Native exit0 is retained independently of failed/incomplete capture, cancellation, timeout or freshness.
  Native checks require no SDK final assistant message.

### Output budgets and native drain correction

Service-only raw ingress is16MiB aggregate stdout+stderr, with64KiB maximum native chunks; retained detail remains32MiB and the existing owner8MiB/2048 queue, disk quota/control headroom and5s reporting bounds remain.
Legacy256KiB aggregate/64KiB preview behavior and its negative controls are unchanged.
Each raw buffer is charged before asynchronous retention; transform/prefix/output reservations remain bounded separately.
No capacity/UTF-8/recording refusal can become a green check.

The initial large-output control exposed a real Node close-path issue: Node can resume paused stdio during exit drainage.
A simplistic pause-plus-last-promise implementation admitted overlapping receive continuations and exhausted its transform charges.
The corrected implementation charges a bounded per-stream raw queue before retaining work, runs one decoder/transform per stream, and joins both original recorder tails before end—including when later runner callbacks were discarded after stop.
This correction does not raise a ceiling or replace the legacy runner.
The initial failures and diagnostic pool counts remain preserved.

### Exact own-generation and current obligations

New optional `check-settled.ownAdvance = {operationId,reservationId,from,to}` requires exactly `to === from + 1`.
The shared RunState joins it to the actual check ID, admitted operation and held per-check gate at `from`.
PASS additionally requires unchanged fingerprint/completeness, complete committed output and native completed/zero/known close.
Historical absent-field facts keep their old exact before/after equality rule.
No arbitrary <= normalization is used.

The check advances conservatively once while its lane is held.
A foreign generation cannot be borrowed as that advance; changed files/definitions remain stale or not-run independently of native facts.
`HistoryProjection.checkObligations` additionally compares the originating epoch and start cwd/environment identity with current context.
Historical passed/failed facts are not rewritten when their current obligation becomes stale.

### Private redaction and environment

`AccessMaterial.redactionLiterals()` and `OwnerModelContext.redactionLiterals(selection)` expose owner-private known literals only.
The latter uses validated selected Pi snapshots, static/known key/OAuth/header/scoped-env and sensitive launch-env literals without getAuth, refresh, interpolation or credential writes.
Checks also include the actual private local capability; browser/access material is not sent to the check to accomplish redaction.
These arrays and secret-derived identities are not public DTOs.

TaskActions pins the frozen actual `host.checkEnvironment`; replacement refuses current authority.
The existing host policy strips CADENCE/PI/ABEL/TRELLIS/GIT control inputs and the SDK startup marker while retaining its ordinary launch-environment policy.
Later terminal/browser environment changes and resolved model auth are never merged.
Known-literal sanitation is not universal business-secret detection.

## Verification

Available environment: Linux x86_64, ext4 `/home/mirako/abel`, `/usr/bin/node`26.7.0, Bun1.3.14, installed Pi0.84.3.
All executable commands selected fresh0700 home-disk TMPDIR/TEMP/TMP roots.
The operator/service build pair shared one newly allocated root; the six verification gates each used a separate fresh root.
No original native, read, recording or scheduler deadline was enlarged.
New multi-operation check cases explicitly use60s outer case budgets, with SDK children still15s.

| Gate                                                                   | Result                                                                        |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Complete affected service/owner/scheduler/native/history/contracts run | **1494 passed,0 failed,45 files**, original exit0;1342.04s supervisor elapsed |
| Original complete scheduler file                                       | **31 passed**, included above, original20s cases unchanged                    |
| Final expanded check files                                             | **14 passed,0 failed,2 files**, original exit0; overlaps the full run         |
| `bun run check`                                                        | Exit0; syntax, generated operator/service comparison and TypeScript           |
| `bun run lint`                                                         | Exit0; zero warnings/errors,9 informational suggestions                       |
| `bun run check:agents`                                                 | Exit0                                                                         |
| `bun run check:web`                                                    | Exit0                                                                         |
| `bun run test:web`                                                     | **105 passed,7 files**, exit0                                                 |
| `bun run build:web:check`                                              | Exit0; canonical compiled bytes matched                                       |
| Canonical operator/service/web rebuilds                                | Exit0; no source/TS fallback or dependency change                             |

The full run froze355 inputs before/after and across all six gates.
Only `test/service-checks.test.ts` changed afterward, adding/expanding native unknown and reader/editor exclusion cases; all production/generated inputs remain identical.
The final14-case complete focused run covers that final test file.
Do not sum overlapping counts or describe1494 as an executed final1496-case run.
The evidence records the original runner PIDs/waits/exits and12 final check fixture receipts; it does not infer universal descendant closure.

### Native versus injected evidence

Actual isolated SDK task then real configured/manual shell checks demonstrate frozen cwd/environment, no auth merge/calls, ignored-input EOF, both stream closures, >140KiB retained output, split Unicode/secrets and actual committed output membership.
Actual shell mutation/nonzero exit/cancel/timeout/invalid UTF-8 retain independent outcomes.
A real task-record conflict preserves external bytes and quarantines publication.
Both readonly Generate and editing-capability SDK work are excluded by an active cross-task check; foreign-generation old acceptance blocks, then fresh consent (and a newly saved graph for Start) launches only after check close.

Explicit injections: current epoch/cwd/environment/generation perturbations in the real obligation projection; an original writer commit barrier after real native exit0; a real-file lease-identity change before native timeout signaling; malformed reducer candidates; slow/refusing unit ports.
The ownership-loss lane observes unconfirmed native settlement, retained reservation/fences, then the actual unforced child exit0 without repairing the earlier unknown.
The unit raw-chunk-limit/refusing-port controls are not native full16MiB/quota exhaustion qualification.
Broad existing native/process/history exhaustion, signal-guard and integrity tests passed separately within the complete suite.

### Preserved failures

Initial5-case run:3 passed/2 failed (pipe accounting defect and fixture manual timeout violating the existing120000ms contract).
Two instrumented focused pipe probes remained failed, not green reruns.
After the queue correction, one fixture incorrectly expected a cwd string to remain contiguous across documented stream labels; reconstruction now verifies each full fixture stream.
A later expanded exclusion fixture wrongly attempted Start on the old blocked graph; the existing admission refusal was preserved, and the fixture now explicitly saves/reviews a new graph.
All failed logs are retained and hashed in the evidence.
None explains or relabels prior eleven scheduler failures, event35 or earlier native/history failures.

## Changed Owners and Remaining Work

Source edits: `src/service/{task-actions,scheduler,check-recording,model-context,auth}.ts`, `src/subagent-process.ts`, `src/history/{writer,run-state,projection}.ts`, `src/service/contracts/history.ts`, and shared `src/worker-public.mjs`/`.d.mts` preview codec/declaration.
Tests: new `test/service-checks.test.ts` and `test/service-check-recording.test.ts`.
Current auth destination provenance was refreshed; historical hashes were not rewritten.
Canonical operator/service outputs were rebuilt and web `cadence.js`/manifest rebuilt for real contract inputs; no renderer source changed.

Main must dispatch independent review; none was spawned here.
Still mandatory: human review, actual current metadata/model choice/lineage, build handshake/asset composition, accepting HTTP host, W1 proxy/informed recovery, W5 native cutover, W6 accepting browser and W7 exact package/full delivery.
No extracted-package, accepting-browser/terminal, paid-provider, physical-human/device, Windows/macOS/ConPTY or other-runtime qualification is supplied.
Maintained-spec synchronization should follow independent acceptance; this delegation records the executable changes without marking W4/product complete.
