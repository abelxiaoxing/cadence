# W4 Current Views — Focused Implementation Handoff

## Disposition

Implemented the assigned nullable-choice/current-metadata/prospective-plan slice.
Focused checks pass; **independent review is required**.
Production model-choice POST, current metadata binding and task admission remain closed.
No accepting-host/full-HTTP workflow, assets/compatibility handshake or W6 binding is claimed.

The prior model-choice review's **617 passed /19 failed** command remains **failed and unexplained**.
New scheduler/review passes do not establish a cause, relabel that receipt or prove those failures unrelated.

Authority/context: active W4 manifests and artifacts, complete parent design/appendices/plan, MAIN model-current decision and complete composition research, latest model/check/review/lifetime reports and maintained backend/shared contracts.
Exact selected APIs were recorded before implementation in [the current-view contract](w4-current-views-contract.md).
No agents were dispatched.

## Actual APIs and Data Flow

### One nullable action owner

`TaskActionsOptions` is the existing narrow host dependency set plus exactly one of `{choice: OwnerModelChoice}` or the immutable legacy `{selection: ModelSelection}`.
No incomplete ServiceHost cast or new action owner/runtime is installed.

- Structural `alive()` validates owner/writer/lease, actual cwd, frozen environment and pinned role/hint sources independently of a selected model.
- `choiceSnapshot()` consumes the actual choice revision above the replayed floor.
  `requireChoice()` and `assertChoice(expected)` validate the exact selected source/model/config before mutation and accepted effects.
  Accepted episodes retain their frozen selection; unrelated access rotation is not retargeting.
- The final configuration guard permits replacement only for the actual nullable consumer, after the existing admission/original/metadata/review/scheduler/owner/writer/model guards.
  Immutable fixtures still refuse replacement when idle.
  The existing cwd and one-owner tests are unchanged and passed; no earlier unrelated failure was substituted for their assertions.
- Check environment is the actual frozen ordinary launch object.
  Its generation starts at one within this fresh epoch/cwd identity; reads never advance checkout generation.
- `observeCurrent` is the one synchronous current-source builder used by nullable current views and all action previews.
  It has no internal asynchronous source gap; it rereads selected raw task, choice/access/control and actual source guards before return.
  Existing action/SDK/original-write continuations keep their post-await checks.
  A returned observation does not certify future bytes while a client is waiting.
- The nullable consumer uses one stable prospective default graph for the current raw task/choice, including first readonly or manual code Start.
  Its bounded RAM IDs are proposals, not retained graph membership.
  Eviction/choice/raw-byte changes stale the old context.
  The legacy immutable fixture path preserves its original action-specific default rule; final composition must use `choice`, not bind the legacy mode as the new client authority.

### Current DTOs and ports

Portable codecs live in `src/service/contracts/current.ts` and `active.ts`, exported by `src/service-contract.ts`.
They reuse existing role/domain/history decoders; no second history reducer or circular history/current import is introduced.

```ts
CurrentRequest = { storeId: string; taskId: string | null };
TaskActions.current(request, signal?): CurrentView;
TaskActions.currentChanges(request, signal?): CurrentChanges;
TaskActions.activeRuns(signal?): ActiveRuns;
TaskActions.context(taskId): ControlContext;
TaskActions.workspace(): ReadEnvironment workspace data;
TaskActions.checkObligations(taskId): CheckObligations;
```

`CurrentView` echoes the request and binds workspace, epoch, committed sequence, ControlContext, actual raw task identity, exactly three pinned role hashes, current-v1 readable text and saved graph selection.
No old ContextVersion is needed to obtain initial metadata.
Initial no-choice exposes readonly roles/plan with unavailable authority.

Readable plan includes `source:"current-v1"`, `editable` and capture coverage.
Known-literal redaction makes it noneditable and mutation context unavailable, never a byte-exact editable replacement.
`OwnerModelContext.viewRedactionLiterals()` reuses the existing bounded catalog source/literal policy before any choice; it does not enumerate/select models, resolve auth, construct a session, read settings or write configuration.
Current private access/local/model literals remain owner RAM only.
Configured check text also refuses known-secret projection rather than exporting it.

Saved graph is exactly:

- `{status:"none"}` only after conclusive absence of an accepted saved graph;
- `{status:"saved", request:GraphReadRequest, planRevision}` after existing cold publication-lineage/content proof;
- `{status:"unavailable", error}` for pending/conflicted/stale/inconclusive proof.

The existing graph reader owns large bodies and finite progress.
No graph body enters current/workspace snapshots; no progress is converted into null.
Current reads do not retain plans or publish summaries.
Old saved source IDs remain historical after restart and require explicit rebind/Save/new Start.

`CurrentChanges` carries the same current identities, one actual change capture's ObservationFact/text/git/coverage, not a fabricated ContentRef.
That capture supplies both context fingerprint and displayed body.
Whole success Reply is at most512KiB; current plan32KiB and changes text128KiB remain unchanged bounds.
No view advances generation.

`ActiveRuns` is a complete bounded roster or an explicit unavailable result, with store/workspace/epoch.
At most eight references contain task/run/operation/epoch, Start/Generate/Check kind and accepted-unallocated/active/draining stage.
The roster joins only the existing scheduler table and actual accepted originals.
It includes the admission/allocation gap and draining checks; uncertain pre-acceptance observation is not an empty complete set.
Retired old-epoch unknown history and PID observations are not active references.
Workspace accepts an additive optional roster; its absence on old uncomposed readers is not complete-empty evidence.

### Checks and retained projection

Actual `TaskActions.checks`, `context`, `workspace` and `checkObligations` callbacks can be installed on the existing HistoryProjection.
The additive optional `ReadEnvironment.checkObligations` callback carries the owner's relevant-result revision; old retained fixtures preserve their existing fallback policy.

Both current obligations and human review reuse `currentChecks`, including exact configured selection, not-run, epoch/cwd/environment/checkout generation and real after-observation freshness.
The owner revision changes with relevant result/definition state, rather than only configuration.
Own-generation PASS stays fresh; later external change stales the current projection without rewriting native/check facts.
There is no check-environment or provider-auth merge.

### Typed readonly transport

`CurrentMetadataPort` is optional on HttpAdapters.
`/api/v1/current` and `/api/v1/current-changes` support existing authenticated GET and finite readonly POST; `/api/v1/active-runs` is bodyless GET.
Missing ports refuse unavailable.
Production host deliberately supplies none.

The same `ServiceClient` / `HttpServiceTransport` methods forward optional AbortSignal, use full raw512KiB response limits, shared decoders and exact request correlation.
Existing Host/Origin/CSRF/local/attachment rules remain; reads have effect:none and grant no action authority.
The new actual HTTP test composes a separate readonly listener against real owner methods, not an accepting production host or fake current authority.

### Portable prospective plan

`src/plan-proposal.ts#proposePlan(current, readablePlan, assignments, crypto)` returns a prospective save-plan Action.
Crypto injects `uuid()` and synchronous/asynchronous `sha256(Uint8Array)`; browser Web Crypto and native hashing produce equal UTF-8 hashes.

The helper decodes/copies inputs before the digest await, uses real task/graph/plan revisions, validates exact current roles/model and shared graph/action bounds, and refuses unavailable/redacted metadata.
Its internal structural digest placeholder never returns or enters storage.
It does not look up membership, retain data, rebind old assignments, accept generated prose or call preflight/Save/Start.
Save still requires separate explicit preview/confirmation.
W6's PlanMetadataPort remains intentionally unbound.

## Files and Canonical Outputs

Source/test changes:

- `src/service/task-actions.ts`, `scheduler.ts`, `model-context.ts`, `ports.ts`.
- `src/service/contracts/{current,active,history}.ts`, `src/service-contract.ts`.
- `src/history/projection.ts`, new `src/plan-proposal.ts`.
- `src/service-client.ts`, `service-http-client.ts`, `service-wire.ts`, `service/http.ts`.
- New `test/service-current.test.ts`.
- `provenance/auth-reuse.json`: current HTTP destination hash plus an append-only revision note; prior pins/notes preserved.

Canonical regeneration changed only `src/service-host.mjs`, `web/dist/manifest.json`, and `web/dist/assets/cadence.js`.
Management/operator, all other browser bodies/fonts and renderer sources stayed byte-identical.
No build-handshake/asset-loader logic, dependency/pin/lock, maintained spec, task status or historical evidence was edited.

## Executed Verification and Freeze

[Evidence JSON](w4-current-views-evidence.json) records exact paths/hashes, runner waits/exits where separately captured, commands, native receipts, intermediate type errors and generated-output comparisons.

Final368-input manifest: `/home/mirako/abel/cadence-current-RpG9tP/inputs-final.json`.
Actual environment: Linux x86_64, ext4 `/dev/sda2`, `/usr/bin/node`26.7.0, Bun1.3.14, Pi0.84.3.
Test providers/credentials/workspaces/homes/state were fabricated and isolated.

| Gate                                                   | Result / scope                                                                                                                                                 |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New current file, final revision                       | **13 passed**, original exit0;41.85s. Real owners/disk/SDK/check/readonly HTTP plus explicitly labeled timing/response faults.                                 |
| Final core/current batch                               | **94 passed /6 files**, original exit0;577.82s. Includes then-current12 tests and all31 unchanged scheduler cases, checks/review/accepted-original/core cases. |
| Model/current/contract/auth batch                      | **455 passed /6 files**, original exit0. Includes earlier9 current tests; precedes final bounded active-tail/check-text refinements.                           |
| History/publication/graph/HTTP batch                   | **130 passed /6 files**, original exit0;125.99s. Actual lineage/projection/finite proof/response-boundary coverage.                                            |
| Earlier core batch                                     | **82 passed /5 files**; overlaps the final core batch, not an additional total.                                                                                |
| `check`, `lint`, `check:agents`, `check:web`           | Exit0; lint zero warnings/errors and eight existing informational suggestions.                                                                                 |
| `test:web`                                             | **105 passed /7 files**, exit0; no browser execution claim.                                                                                                    |
| Canonical service/web generation and `build:web:check` | Exit0; actual private double web production matches canonical names/bytes.                                                                                     |

Do not sum overlapping batches or call this a single whole-repository frozen suite.
Final core covered final production TypeScript; the later13th current case and strengthened initial-none privacy assertion changed tests only.
Gates used identical executable source inputs; the final test revision receives a final type/lint check below.

New controls include no-choice legacy text with no private writes, actual choice/revision/grant invalidation, exact current→first research/code Start, saved graph before Start and after own summary/review, restart floor/old-source refusal, actual check PASS/not-run/stale and result revision, active discovery on an older task page, known-literal noneditability, raw task/model source changes, pending Save/external-byte refusal, real readonly GET/POST/abort/correlation, exact UTF-8 plan bound, raw512KiB/+1 HTTP limit, and prospective hash parity/no-retarget after await.
Native intervals/outcomes are not inferred from model prose.

No20s case,15s child,8MiB/100ms read,5s recording or native stop budget was increased.
New multi-operation cases have explicit60s fixture budgets.
Original runners were waited, not force-terminated.
All commands selected fresh0700 home temporary roots with TMPDIR/TEMP/TMP; initial context commands used `.cache`, later commands used `/home/mirako/abel`.
Service/web canonical generation shared one new supervisor root; subsequent gates each allocated separate roots.
No old temporary data was cleaned.

Preserved development failures are type-level fixture/API corrections: optional closed-codec signature/union assignment, HistoryFiles.directory versus nonexistent root, and OwnerStopReport.state versus status.
No test failure or old receipt was overwritten to obtain the passing results.
The historical19 failures and earlier unresolved failures remain unchanged.

## Remaining Gates

1. Independent review of this implementation, especially current-source timing, null-choice/legacy-mode separation, active original joins, privacy and current-check revisions.
2. Actual host current/choice/action/secret/lifetime composition, package-relative assets and independently computed build compatibility.
   Production gates must remain closed until then.
3. W6 metadata/chooser/current-changes/active-run binding using these shared APIs.
   Preserve explicit graph progress and revalidate current identity after awaited graph/digest work.
   Add `src/plan-proposal.ts` to actual build-source inputs when the adapter imports it; no compatibility identity is supplied by echoing the server.
4. Accepting authenticated full workflows, same-attachment capability refresh, complete Stop windows and browser/native cutover qualification.
   This readonly HTTP fixture is not that lane.
5. W1 outbound proxy/informed recovery, W5 terminal, W7 exact distribution/notices/extraction/full acceptance.
   Paid-provider, physical-human/device and alternate-native-platform claims remain unqualified.

No agents, Git/status/commit/push/merge, installation, real credentials/profile, deployment, cleanup or task-status mutation occurred.

## Final Test-Revision Gates

`check`, whole `lint` and explicit two-document Markdown check all exited0 after the final13-case test revision.
Original runner receipts/logs: `/home/mirako/abel/cadence-current-jKPNQI/`.
All368 frozen executable/config/provenance inputs still matched afterward.
The first explicit documentation check's53 formatting issues remain recorded in `/home/mirako/abel/cadence-current-ONKEY2/docs.log`; scoped formatting fixed them without changing source/test behavior.
