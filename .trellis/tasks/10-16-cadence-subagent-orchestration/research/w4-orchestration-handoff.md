# W4 handoff — accepted-plan slice, orchestration still open

## Disposition

Implemented the first assigned shared seam, not all W4.
Production `createServiceHost` still configures `admission:null`, actions false and manualChecks false.
No accepting TaskActions/scheduler, alternate controller, dummy current context, new SDK runtime or second process/writer/reducer was installed.
Main can continue immediately with the remaining assigned slices below; independent review of these changes is required.
No routine product reapproval is requested.

Read the task manifests/artifacts, complete parent PRD/design/both appendices/plan, both readiness-context parts, host composition handoff/review and current history/owner guidance.
The selected contracts were persisted in `w4-selected-integration-contracts.md` before product edits.
Task status, maintained specs, dependencies/lock, actual credentials, actual-checkout deployment, unrelated dirty paths and historical artifacts were not changed.
No agents, commits, pushes, merges, installs or cleanup were performed.

## Implemented APIs and data flow

1. `src/history/plans.ts#proposePlanContent(plan, version, secrets)` produces a prospective UUID/selected version/UTF-8 count/SHA reference without filesystem effects.
   `assertPlanContent` checks the exact bounded approved bytes and refuses sanitizer-changing content rather than silently replacing the approved plan.
   Owner literals are explicit inputs, not credential discovery.
2. `HistoryWriter.retainAcceptedPlan(operationId, secrets)` consumes only the already committed save-plan action.
   It accepts no caller replacement text, ID or version.
   It checks accepted action/task/epoch/current control identity, original selected task bytes, next graph/task revision, exact plan hash/length, sanitization and existing proposal/open-content/artifact/committed-content identity collisions.
   Other action types, unknown operations, stale task/context and duplicates refuse without new retained bytes.
3. Retention goes through the existing owner content/artifact/journal writer and its original-lifetime hook.
   One internal-only selected ID/version path exists after accepted-action checks; ordinary worker/owner content still uses random IDs/version1.
   Bounded ingress is reserved before retaining the selected action/literal/event copies.
   UTF-8 chunk-boundary retreat has explicit allowance for one extra chunk.
   Reporting timeout does not refund the original lease, clear quarantine, publish v1 or activate work.
4. `publicationRecord` now requires a save-plan field to originate from that exact accepted operation, with task entity/version and null run/child ownership.
   It cannot adopt unrelated older retained text just because its bytes match.
   Actual publication still uses `writer.publishTask` and unchanged v1 expected-byte/revision semantics; no separate task-file writer was added.
5. `HistoryReader.publishedPlan(taskId, snapshotSeq)` uses original committed task batches, the existing `OperationState`, complete selected content membership/bytes and actual publication.
   It returns the latest published saved graph descriptor, including successful v1 raw identity/revision, or null only after conclusive bounded absence.
   A later pending/conflicted/uncertain save refuses rather than reviving an older graph.
   Exhausted metadata reads remain inconclusive; there is no whole-archive graph cache or passive write.
   The descriptor is historical metadata, not current Start authority.

The saved graph reference is `{recordId: acceptedOperationId, revision: graph.revision, sha256: SHA256(canonicalJson(graph))}`.
Plan content retains its separately approved content ID/version.
Historical decoding and existing run-associated graph readers remain unchanged.
The new lookup is NOT yet wired into the graph HTTP/proof/export route or executable current task context.
Default readonly/explicit legacy episode production is also not supplied by this slice.

## Changed paths

- `src/history/plans.ts` — new pure proposal/assertion helper and published descriptor type.
- `src/history/writer.ts` — accepted-action-only retention and private content-version support.
- `src/history/publication.ts` — exact accepted-operation plan membership.
- `src/history/reader.ts` — bounded latest published-plan descriptor lookup.
- `test/service-history-plans.test.ts` — 17 new cases.
- `src/service-host.mjs` — regenerated actual host bundle.
- This report, `w4-selected-integration-contracts.md`, and `w4-plan-slice-evidence.json`.

`src/service-cli.mjs` was rebuilt by the canonical script but its bytes did not change from the preceding W1 reviewed identity.
No changes were made to `src/service/host.ts`, `src/service/admission.ts`, `src/history/run-state.ts`, library pins or lockfile.
Exact source/test/generated hashes and log hashes are recorded in `w4-plan-slice-evidence.json`.
Its manifest was written after execution; these sources were not edited between the passing seven-file run and that manifest.
It is not a retroactive claim of a separately captured pre-run freeze.

## Executed verification

Fresh private disk root: `/home/mirako/abel/w4-orchestration-tpiPmM`, mode0700.
All subsequent shell commands explicitly selected TMPDIR/TEMP/TMP there.
Actual Node: `/usr/bin/node` v26.7.0; platform Linux x64; installed Pi0.84.3.
No provider/profile construction was added to the new tests.

| Command / evidence              | Result                                                            |
| ------------------------------- | ----------------------------------------------------------------- |
| New plan tests, initial run     | 15 passed; later superseded by added controls, not an extra total |
| New plan tests, final cases     | 17 passed, one file                                               |
| Seven-file focused boundary run | 209 passed, seven files,303.47s; includes those17                 |
| `bun run build:service`         | Exit0                                                             |
| `bun run check`                 | Exit0: syntax, operator/service byte checks, TypeScript           |
| `bun run check:agents`          | Exit0                                                             |
| `bun run lint`                  | Exit1: untouched W4 `task.json` lacks a final newline             |

The seven-file run selected plan, publication/recovery, semantics, service-history, graph-boundary, projection and CLI tests.
Its complete command, identities and hashes are in the evidence JSON.
The whole-lint failure was preserved rather than changing task metadata outside this slice.
Only that task-file formatting error and the two existing package-audit informational suggestions appeared.
Scoped changed-source lint and explicit task-report Markdown checks are recorded in the private root after final formatting.

New cases use real private filesystem/coordination, committed Create/save-plan, immutable artifacts, exact v1 publication and package Agent hashes.
They cover empty/UTF-8/max-length plans, non-v1 content versions, no proposal writes, unknown/wrong operations, sanitizer/hash/length/kind/task/context mismatches, duplicates/collisions, later pending plans, publication conflict, unrelated content adoption and reopened corrupted-artifact refusal.
Context/model authority remains fixture input: this is not actual ActionOwner consent, SDK scheduler overlap or host task activation.
The original-write stall is an explicit write-observer injection around actual disk work; it exercises the unchanged real five-second reporting bound and original retained reservation.
Broader preexisting native SDK/CLI cases are separate evidence within the focused run, not proof of new W4 runtime composition.

Preserved development failures: `check-1.log` has the TypeScript `void` versus `undefined` job-return error, fixed without changing behavior; `markdown-1.log` has report sentence-per-line formatting failures; `lint-1.log` retains the untouched task-metadata error.
No prior50018ms/event35 or other historical failure is explained or relabeled by these passes.
No full-suite, pack/extraction, browser, PTY, physical-human, paid-provider, other peer or Windows/macOS qualification is claimed.

## Exact remaining W4 work

1. Wire accepted plan lookup into bounded saved-graph GET/readonly POST, finite cold progress, current-view descriptors and both exports BEFORE first Start.
   Add actual goal-only readonly/default-one-assignment and explicit legacy new-episode plan producers without imports of old approval or passive writes.
   Generated plan remains a separately confirmed readonly proposal; accepting/saving/Start must be distinct.
   Apply owner-literal sanitization BEFORE consent/admission, not just in post-accept retention.
2. Implement real `src/service/graph.ts`: actual pinned role definitions/purpose mapping, exact model selections, bounded safe root hints and freshness, no duplicated handoff,96/128KiB request accounting and exact committed16/32KiB dependency inputs.
3. Extend the SAME shared fact/RunState/projectRunObservation/finite progress/export owners with per-child wait/ready/preparing/closing/unstarted reasons, parent admission-close reasons and per-reservation gate identity.
   Implement exact own-check generation advancement, preserving old decoding and independent native/coverage facts.
4. Implement ONE `src/service/task-actions.ts` AdmissionOwner using existing ActionAdmission with real observe/currentAccess/run/activate/cancel/quarantine callbacks.
   Bind metadata busy/active episode fences, post-commit controlRev+1 and each operation's own expected-byte v1 publications.
   Resolve own-publication graph/task freshness without changing frozen graph bytes or overwriting external edits.
   Old receipts/restarts must never activate work.
5. Implement `src/service/scheduler.ts`:8 episodes/128 queued/2 actual reservations, retained-byte accounting, deterministic parent round-robin/frozen node order and fair whole-checkout reader/writer/check exclusion.
   Use actual W3 disk reservations, `prepareTracked`, mandatory capture sink, pre-launch intent and original worker/write/auth lifetime accounting.
   Obtain real two-child native SDK overlap and cross-task/alias exclusion evidence.
6. Implement first-failure/block/expiry drain,10-minute waits/6-hour episode deadlines, synchronous all-child cancellation before journaling waits, late-preparation no-launch, durability/ownership/unknown-close quarantine and no retry/revival through Done/reconnect.
7. Implement actual configured/native-local checks through existing runCheck/runProcess with frozen ordinary environment, service/control stripping, full allowed sanitized retained output, original EOF/native close and exact own-generation freshness.
   Implement actual changes, obligations and human review binding/recapture/issue acknowledgment without rewriting failures.
8. Supply real bounded current/active/recent/sibling ReadEnvironment and ReviewContext; expose all retained readers and existing live reconciliation.
   Only then compose actual ActionAdmission at the host's one-time HTTP configuration boundary and qualify actual Create→save-plan→Start/check/review, HTTP attachments/rotation/disconnect and generated accepting CLI.

W1 outbound auth proxy/informed recovery, W5/W6 native/browser cutover and W7 complete integrated distribution remain distinct open gates.
The parent is not complete, and no core scope is deferred to a later product release.
