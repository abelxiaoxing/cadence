# W3 final independent review — integration remains blocked

## Disposition

**Six defects fixed; one demonstrated W3 search/export blocker and two final verification failures remain.
Do not close W3 or declare it fit for complete W1/W4 integration yet.**
The tested smaller-store interfaces are usable for continued composition, not complete acceptance.
No product/package/client-cutover, recovery-management takeover or release approval follows from this report.

Loaded the child manifest/artifacts, curated context, complete parent PRD/design/plan and both mandatory appendices, latest search/export and publication/recovery handoffs/evidence, prior independent reviews and frozen W1/W2 interfaces.
Reviewed all `src/history/` source and history tests/helpers, plus relevant actual W1 owner/recovery/HTTP, private-file and common cursor/export/client boundaries.
No agents, credentials belonging to the user, installations, deployment, task-state edits, Git index/ref changes, commits, cleanup, or shared W1/W2/package/spec edits were performed.
Earlier reports, hashes and failed runs remain preserved.

## Findings fixed

Each defect below has a failing regression before its repair in [new evidence](w3-final-review-checks/evidence.json).

| Finding                                                                   | Correction and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mutable publication request changed after admission to the queue          | `publishTask` snapshots its request before the first await. The counterexample mutated both operation ID and cwd immediately after calling it; the actual originally selected task now publishes, without selecting caller-mutated state.                                                                                                                                                                                                                                                                                                  |
| Recovery could race an original queued write before journal append        | Two real-file gates at `intent` and `artifacts` allowed recovery to commit while the writer still had an original promise. Store-wide original-job accounting now starts synchronously at enqueue and ends only on original settlement. Recovery refuses while it is nonzero, even with injected ESRCH and fabricated accepting local authority. Recovery also advances an in-process writer generation: pre-recovery handles cannot subsequently save/flush, while a newly constructed writer must independently validate retained bytes. |
| Checksummed bridge could invent its sequence gap in navigation            | The full scanner rejected a modified `highSeq`, but snapshot/navigation accepted it after its checksum was recomputed. Every navigation bridge now validates original predecessor sequence/offset facts through the same scanner, plus exact segment-start placement. Cached bridge batches revalidate that dependency too. No arbitrary gaps or source-file repair are accepted. The stronger bounded proof exposes the remaining large-archive blocker below.                                                                            |
| A begun, zero-byte, unfinished field exported as complete                 | Shared retained traversal now checks genuine end membership for selected begins, not just chunks. Search and both export formats retain incomplete/gap coverage even when there was no chunk to trigger the earlier gap detection. End/aggregate hashes and actual original EOF remain independently required.                                                                                                                                                                                                                             |
| Search lost coverage at its max-hit exit                                  | Coverage is combined before entering the hit loop. A page ending mid-field after 50 hits now preserves that field's source-limited/redacted facts instead of returning complete-original-source metadata. Scalar overlap, exact ranges and continuation encoding are unchanged.                                                                                                                                                                                                                                                            |
| Explicit metadata-only omissions disappeared without a later status event | One history-owned `captureCoverage` helper projects genuine omitted-block facts into search/export, run reduction and reader coverage. It reports limited source and the actual reason, without claiming missing media/thinking was captured. The old projection test now additionally requires its existing `unsupported` omission; its prior source-limit/redaction assertions remain.                                                                                                                                                   |

The pending-write controls use fabricated process-status/local-authority observations around actual queued filesystem operations; they are not genuine owner-death or authenticated management qualification.
Existing ordinary waited dead-child recovery controls remain separate and still execute.
No no-op production authority adapter, alternate DTO/reducer, replay path, accepting durability fallback or W3 lock-release authority was added.

## Remaining blocker: bounded proof cannot advance across a large recovery

`test/service-history-publication-recovery.test.ts` contains the explicitly named **LIMITATION** control.
An ordinary Node child appends 600 Create-shaped structural rows with 7900-byte goals through real `HistoryFiles.append`/flush, producing more than the 8 MiB read window, adds a torn final suffix and exits with the original waited code77.
These are retained structural facts, not actual TaskStore creations or SDK executions.
A genuine dead-owner inspection and guarded recovery then preserve those bytes and append a new bridge.

Search at the recovered watermark advances some zero-hit snapshot-proof pages, then returns `receipt-inconclusive` rather than reaching the selected retained goal.
The bridge's predecessor proof requires a bounded prefix scan that does not itself carry progress across requests.
Export uses the same retained snapshot/traversal and therefore cannot be qualified for complete recovered archives at this boundary either.
The test's PASS verifies **truthful refusal and preservation**, not fulfillment of complete search/export requirements.
This remains an actual W3-AC3/AC4 integration blocker, not a future browser/package qualification detail.

Main should assign further W3 implementation of resumable bridge/membership proof, with cold-process, missing/stale-index, repeated-recovery and zero-hit continuations across the original 8 MiB/100 ms windows.
Keep the exact predecessor bytes/high sequence/committed offset checks; do not restore hash-only acceptance, increase budgets, rebuild indexes on GET, or claim an inconclusive read is absence/completion.
Long-field end lookahead should be exercised under the same interleaved large-store conditions.
This report does not silently redesign the frozen cursor contract or authorize edits to W1/shared interfaces.

## Native ENOSPC improvement

The available host supports `/usr/bin/bwrap` with unshared user/mount/PID/network namespaces.
The new excluded helper and test mount a **16 MiB namespace-only tmpfs**, bind only runtime libraries and the fixture read-only, clear the environment, and use no network, real credentials, host mounts changed in place or `/dev/full`.

[Native receipt](w3-final-review-checks/native-enospc-final.json) records:

- Real regular immutable-history artifact writes encounter kernel `ENOSPC` after 63 successful parts.
- A subsequent real journal `FileHandle.writeFile` also encounters `ENOSPC`; its original handle is opened once and closed once.
- Previously committed ledger prefix and coordination-lock bytes remain identical.
- A separate ordinary Node reader exits0 with null signal/empty stderr and observes committed sequence1 plus a torn-tail marker.
- The **unchanged 256 MiB admission floor refuses** ordinary writer admission on this filesystem.

This is native **HistoryFiles failure-boundary** evidence, not an admitted SDK run that bypasses the floor, physical-disk/power-loss durability or production recovery qualification.
It uses direct lower-level append/artifact operations with a real held lease after demonstrating the normal admission refusal; no product guard/default was weakened.
Namespace teardown removes only the isolated fixture mount when its process exits; no consumer history is cleaned.
The extra standalone receipt repeats the suite control and is not an additional test count.
Unavailable bwrap/non-Linux environments remain outside this lane; no skip is promoted to a native pass.

## Verification

The final frozen-input command covers all nine history files and the unchanged prior ten-file set, using the explicitly allocated private temporary root recorded in `w3-final-review-checks/temporary-root.json`:

- **1189 passed, 2 failed, 0 skipped; 19 files; 561.54 seconds.**
- **210 history cases (208 passed / 2 failed) + 981 passing prior-ten-file cases**.
  Ten cases were added to the1181 baseline: eight defect regression cases across six mechanisms, one native ENOSPC case and one explicit limitation/refusal case.
- Whole `bun run check` and `bun run check:agents` passed.
  Whole lint is recorded in the evidence index after formatting new JSON/report evidence.
- The89-file final input manifest was unchanged after the final test attempt; exact SHA-256 identities and command/log hashes are in the evidence directory.
- The shared114 codec vectors still execute through two surfaces.
  Their overlap and development reruns are not extra independent capabilities.

Available host: `/usr/bin/node` v26.7.0, Linux x86_64, Bun1.3.14, installed Pi0.84.3.
The prior tmpfs run passed the genuine W1 model preparation → W2 stock SDK/native worker → W3 retained journal case beyond2 MiB.
The final disk-backed run **failed that existing case**: native outcome timeout, direct-child-closed, null exit code, missing final and unconfirmed cleanup.
Do not substitute its prior pass for this failed original process.
Its20-second test /15-second child limits were unchanged.
Actual W1 HTTP download/client export framing, digest/count/EOF checks, cookie/local admission, revoke/cancel accounting, native crash windows and prior quota/control-headroom tests remain in the executed set.
Those HTTP fixtures are not a composed production scheduler or client cutover.

Preserved failures include the first five failing cases, bridge and coverage/omission counterexamples, a fixture build path missing its `./`, and the first large-load probe's30-second timeout.
The latter was replaced by fewer larger structural rows preserving the greater-than8-MiB condition, not a larger deadline.
The first full run had1190 passes/1 failure because its old expected omission array omitted the now-retained `unsupported` fact; the expectation was strengthened and the entire19-file set rerun.
That1191-pass run preceded a type annotation and unused-import correction in the new test/helper, and is not relabelled as final evidence.
The subsequent final-input attempt on shared `/tmp` failed with931 passes/7 failed tests and two collection-failed suites after inode exhaustion.
A readonly capacity check found only71 free inodes out of1048576 despite54 GiB free space; no old temporary or consumer data was deleted.
The namespace-only ENOSPC mount was independent of this environmental failure.
A new0700 temporary directory on the existing disk-backed filesystem had over760 GB and60 million free inodes.
The complete rerun there produced the final1189/2 result above.
Besides the native SDK timeout, `foundation review: warm detail revalidates snapshot in a later segment` failed on its initial cold read with `receipt-inconclusive` under the original100 ms budget.
The exact causes of these filesystem-sensitive failures are not established by this report; both remain blocking verification work, not accepted flakes.
No deadline or assertion was relaxed, and no further repeated full-suite attempts were made to seek a green result.

## Changed files

- `src/history/files.ts`: original-job/generation accounting; shared predecessor validation.
- `src/history/navigation.ts`: bridge placement and cached dependency validation.
- `src/history/writer.ts`: original-job lifetime, old-handle refusal and request snapshot.
- `src/history/search.ts`: unfinished-field and early-return coverage.
- `src/history/types.ts`, `run-state.ts`, `reader.ts`: one explicit capture-omission coverage projection.
- New `test/service-history-final-review.test.ts`, `test/helpers/history-enospc-child.ts`.
- `test/service-history-publication-recovery.test.ts`, `test/helpers/history-publication-child.ts`: bridge counterexample, stale writer-handle assertions and large-store limitation fixture.
- `test/service-history-projection.test.ts`: strengthened existing omission expectation.
- This report and new formatter-clean evidence only.

## Integration gates retained

- **W3:** resolve the demonstrated recovered-archive progress blocker and diagnose/fix the final native-throughput and cold-read failures under unchanged budgets before integration acceptance.
- **W1:** genuine local interactive authority, exact coordinated lock release, outstanding original auth/storage/process accounting, real management CLI/startup/stop composition.
  W3 still never clears locks; W1's actual resolution remains nonaccepting.
- **W4:** actual scheduler/current observation barriers, launch/settlement joins, check obligations and issue-aware review/publication use.
  Historical/native/publication facts remain separate; the fixture facts are not real check executions.
- **W5/W6:** complete native/browser actions, detach/reconnect and exact retained navigation against the integrated owner; no embedded execution fallback.
- **W7:** maintained spec updates, reproducible generated/service/browser assets, exact package/member/notice audits, source/extracted/client and full-product acceptance.

No whole repository suite, pack/extracted or generated service, browser/terminal cutover, physical-human/device, paid-provider, Node22, Pi1.2, Windows/macOS or ConPTY qualification was executed here.
No exactly-once, hostile-writer atomicity, total-heap, universal secrecy/descendant closure or power-loss guarantee is claimed.

## Exact final attempt identities

- 89-file source/test input manifest: `8370e83639b5b1cea7d05f1dc9481544fa6937adaae3fee40f04498c1ebe5d26` ([file](w3-final-review-checks/inputs-qualified.json)).
- Final 1189-pass / 2-fail log: `d926f6f7726b1b6b7f4dfbc6186106904c1e528118bfc3fea7a043633703bf6f` ([file](w3-final-review-checks/focused-private-temp.log)).
- Final native namespace ENOSPC receipt: `bc5f924e8f4fa068aa0d490ea289bfbc58f35342635850737f8ef1e410b2be9a` ([file](w3-final-review-checks/native-enospc-final.json)).
