# W1 contract revision — independent follow-up review

## Verdict

**Three local defects fixed; no remaining blocking defect found in this candidate chunk.**

The revised bounded-admission, capture/transform/final-selection, parent/check settlement, bootstrap and paged-history contracts substantially resolve the earlier consumer findings in executable code, not just prose.
The common ports are ready for consumers to implement against, subject to main recording reciprocal agreement and the planned single-owner JS codec handoff.
Actual HTTP, SDK, filesystem writer and scheduler behavior remains owning-child implementation/qualification, not a prerequisite to passing this portable contract review.
Do not interpret this result as W1 or product completion.

Resolved `task.py current --source` to `.trellis/tasks/10-16-cadence-service-owner` (session source).
Loaded the child artifacts/curated context, complete parent PRD/design/both mandatory appendices/plan, revision handoff, and original W2/W3 fit reports.
Read all ten candidate source/test files completely, including the facade and five portable contract modules.
Inspected Git status/diff; the candidate files are untracked, so reviewed their actual full bodies, not an empty tracked diff.
All initial candidate hashes matched `w1-contract-revision-handoff.md`.
Preserved the unrelated archive/qualification changes and original reports.

## Fixed findings

### R1 — Mutation clients accepted receipts incompatible with the submitted action

Owner: `src/service-client.ts`, `ServiceClient.execute` and `cancel`.

The client checked a receipt's command ID (and Cancel's run ID), but did not apply the existing stored-command correlation rules.
An accepted Create with `created: null`, an accepted Start without a run, a check with parent-SDK aggregation, or a Cancel carrying a created task could pass the client despite being rejected by `decodeStoredCommand` at admission/history boundaries.
This made the new created-task/bootstrap and discriminated settlement contracts inconsistent across consumers.

Fix: reuse `decodeStoredCommand` with the already decoded request identity after the existing command-ID check.
No second validator, transport retry, new command ID or accepting adapter was introduced.
Malformed mutation responses yield fixed uncertain errors; receipt-only observation remains distinct.

Regression: `revision review response consistency` tests malformed and valid Create/Start/check responses and the impossible Cancel-created-task combination.
The initial Create counterexample returned `ok` and failed the new test before the fix.

### R2 — An SDK run row could display a different result than its exact committed final selection

Owner: `src/service/contracts/history.ts`, `decodeRunProjection`.

A completed SDK row could carry the correct `settlement.recording.detail.content` but an unrelated `result` record/version/field.
Both references independently decoded, allowing the displayed/dependency-facing result shortcut to disagree with the newly frozen exact-final mapping.

Fix: when an SDK recording is committed and the row exposes a non-null result, require exact content-reference equality.
This preserves independently known native zero and already committed result data under a failed overall outcome; it does not synthesize missing results, hash storage bytes, or turn recording failure into success.

Regression: a valid completed row passes; unrelated final-text record, changed version and streaming-message reference refuse; failed cleanup still retains the original committed result.
The unrelated-result counterexample was accepted and failed the new test before the fix.

### R3 — Run/child views could attach another task's current control context

Owner: `src/service/contracts/history.ts`, shared `runInView` used by snapshot and update decoding.

Task-scoped views checked the current task identity, but run/child-scoped views only checked workspace identity and scope membership.
A valid historical row for task T could therefore be paired with a current/unavailable control context for another task or no task.
This is different from legitimately retaining T's older model/graph admission while its current configuration is unsafe.

Fix: centralize scope/workspace/task correlation for represented rows, reusing it in both decoders.
The immutable historical context is not rewritten and a truthful unavailable context for the same task still passes.
No SDK/auth construction or fresh mutation authority is inferred from history.

Regression: both run and child scopes accept same-task unavailable control; foreign/null task contexts refuse in snapshots and updates.
Both scope counterexamples failed the new tests before the fix.

## Reviewed non-finding — private accounting is not the public export schema

I initially considered the absence of auth/process-accounting variants in public `OwnerFact`/`HistoryRecord` an export freeze blocker.
On re-reading the selected design, that conflated the **private commit journal** with the **public retained projection**; that blocker is withdrawn.

`src/service/ports.ts:157–188` already supplies concrete `AuthPreparationIntent`, `AuthPreparationSettlement`, `AuthAccountingPort` and `ProcessAccountingPort` signatures.
These exchange credential-free operation/source/run/child facts and the exact worker completion with the same `PersistenceResult`/committed sequence contract.
W3 can implement these together with admission, capture and owner journal ports through its one writer; no accepting adapter or second executor is present here.
Private journal types/validation and original-promise/crash settlement are W3/W1 implementation responsibilities.

The parent requires committing auth intent before getAuth, retaining unmatched preparation as credential-uncertain, and recording original-promise settlement independently of launch.
It does not require dumping every private journal record into the public transcript/export taxonomy.
Public `OwnerFact` already carries the requested check/change/review/publication/parent/handoff data; actual SDK process results are independently available through `RunSettlement` and worker completion.
An auth preparation cannot be disguised as a genuine worker capture event, but it need not be: it has its own accounting port.

The in-process codec probe accurately showed that a gate fact decodes while proposed auth/launch wrappers do not.
That is **not** an executable counterexample to the selected private accounting contract, and does not justify adding a new public event family or child-link convention during review.
No SDK/provider/service/disk writer was constructed by this probe.

W1/W3 must still qualify the actual shared writer, unmatched-auth recovery, original promise tracking, native settlement and truthful public/admin projections at their assigned gates.
This review does not claim those unimplemented runtime behaviors passed, or require an additional proof framework before consumers can implement them.

## Prior consumer findings — disposition

| Concern                                                    | Follow-up assessment                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W3 F1: unbounded same-attachment/submit retention          | Resolved in the candidate. Synchronous reservations precede decode/queueing; 32 MiB permits eight conservative ordinary entries. Stalled originals remain charged after timeout; five awaited boundaries are exercised. Added same-ID and different-ID submit saturation vectors.                                                                                                                                            |
| Cancel under ordinary stalls/quota                         | Resolved as a portable admission contract. Separate bounded lane, current-authority exact-run safety fallback and owner coalescing preserve stop requests without unbounded async overflow. Existing tests cover saturation, rotation, one request per target and late original settlement. Native stop remains an owning-child gate.                                                                                        |
| No late activation                                         | Existing timeout/fence regressions pass for observe, lookup, commit and post-commit observation. New queue vectors retain every original lookup charge and prohibit late commit/activation after release.                                                                                                                                                                                                                    |
| W3 F2: parent versus SDK/check closure                     | Resolved. Parent has the exact ordered frozen required set and no fabricated native process; SDK success remains strict; ordinary checks have actual absent-stdin/native facts without assistant-final fiction. Partial/unconfirmed/recording-failed children cannot form completed parent settlement.                                                                                                                       |
| W2 F1–2: occurrences, context, typed content and omissions | Representable now. Local call/message/block links, declaration/start/result distinctions, explicit ambiguous/orphan results, tool-result links, context components, final-versus-stream stages and metadata-only omissions are closed DTOs. Actual SDK association/source authenticity remains W2's declared stateful gate.                                                                                                  |
| W2 F3: wire versus transformed storage                     | Resolved at the common seam. Zero-to-many events and source sequence/time ranges avoid forged wire offsets/hashes. Pool tests exercise prefix retention, expansion, one-shot lifetime and control headroom inside aggregate ceilings. Actual sanitizer/fast-producer/disk-stall behavior remains W2/W3 work.                                                                                                                 |
| W2 F4: exact final result                                  | Worker completion, detail-to-content mapping and recording-state alternatives now supply the necessary identity. R2 fixes the inconsistent run-row shortcut. W3 still verifies actual committed association/hash membership.                                                                                                                                                                                                 |
| W3 F3: owner-origin recording                              | Check/change/review/publication/handoff/parent facts and owner content use the common committed batch contract without fictitious children. Existing auth/process accounting ports can feed that same W3 writer; private journal decoding and runtime settlement remain assigned implementation gates.                                                                                                                       |
| W3 F4: immutable admission versus current context          | Resolved, with R3 fixing run/child correlation. Different historical graph/model identities survive unavailable current control. Metadata-only updates do not fabricate rows.                                                                                                                                                                                                                                                |
| W3 F5/F6: bootstrap, Create, first pages and ownership     | Concrete typed session/workspace/Create identity and bounded reader-specific initialization/continuation/ownership paths exist. R1 makes client responses enforce the existing action correlation. Snapshot horizon and full run paging are independent.                                                                                                                                                                     |
| Multi-row committed updates                                | Resolved: one update applies all changed sibling rows atomically; filtered global sequences may skip numbers; invalid sibling/reparenting refuses before installation.                                                                                                                                                                                                                                                       |
| Export framing/completion                                  | Concrete bounded format/manifest/detail/record/trailer contracts exist. Added original-EOF, trailing-frame and cancellation controls: a received trailer is withheld until original EOF. Digest verification and per-chunk access revocation remain explicitly W3/HTTP responsibilities. Actual retained export coverage remains W3 qualification; this review does not require exporting every private coordination record. |
| Maintained JS codec                                        | The recorded single-owner move/re-export plan is adequate for W2 handoff; no duplicate JS codec was added. Main still owns granting that move.                                                                                                                                                                                                                                                                               |

The structural codecs are not proofs of genuine source observations, actual storage integrity, fsync, OAuth writeback, native close, HTTP authentication or upstream memory bounds.
Their absence as implementations is expected here, not additional findings.
No new elapsed-time, platform, provider or framework requirement was invented.

## Changes and verification

Changed only:

- `src/service-client.ts` — existing shared receipt validation reused.
- `src/service/contracts/history.ts` — final-result and view/task correlation.
- `test/service-contract.test.ts` — nine additional regression cases; original 105 cases retained.
- This new report.

No package/lock/spec/worker/controller/shell/frontend edits, installs/downloads, real credentials/services/providers, task-status changes, nested agents, staging or commits.
Maintained spec updates remain with actual integration, not claims that these unimplemented runtime ports already execute the product.

Environment: Linux x64; `/usr/bin/node` v26.7.0; Bun 1.3.14; Vitest 4.1.10.
No Pi runtime was constructed; no new SDK API was implemented.

| Executed command                                        | Result                                                                                                                                                                                   |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial `bun run test -- test/service-contract.test.ts` | Exit 0; 105 passed, zero failed/skipped.                                                                                                                                                 |
| New R1/R2 regressions before fixes                      | Exit 1; 105 passed, 2 failed, confirming the counterexamples.                                                                                                                            |
| Expanded intermediate regression run                    | Exit 1; 110 passed, 4 failed: two genuine R3 failures and two overly strict new queue-fixture expectations, explained below.                                                             |
| Final `bun run test -- test/service-contract.test.ts`   | Exit 0; **114 passed, zero failed/skipped**, one file, runner start 23:50:21.                                                                                                            |
| Final `bun run check`                                   | Exit 0; JS syntax, unchanged canonical operator byte comparison and configured whole-package TypeScript no-emit.                                                                         |
| Final `bun run lint`                                    | Exit 0; Biome checked 164 files; rumdl checked 41 under existing exclusions. Two pre-existing informational `useTemplate` suggestions in `test/package-audit.test.mjs` remain untouched. |

Queue-test correction: timer/microtask ordering may start other already-reserved readonly lookups before their individual timer callbacks fire.
The original new test incorrectly demanded exactly one such original; the contract requires bounded retention, original-promise charges, no late effects and no replay, not one readonly lookup across all queued requests.
Corrected only that new expectation to count and verify every retained original within the established bound; no production admission change or old assertion weakening was made.

The new report was also checked with `rumdl check --no-exclude` after formatting its sentence wrapping/tables; that explicit one-file check passed.
Ordinary whole lint retains its existing task-directory exclusions.

Counts are overlapping reruns, not additive evidence.
All 114 cases are portable codec/resource/reducer or injected-memory transport/admission evidence.
No whole-suite, pack/extraction, native SDK/process/storage, browser/terminal, actual auth or paid-provider acceptance was run or claimed.

## Reviewed final source identities

SHA-256 values bind the final candidate, including unchanged reviewed files:

| Path                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `src/service-contract.ts`          | `7d166451e88e89b9ef86b3e48c38716324637dd736b89d5ab679cde5b8acebff` |
| `src/service-client.ts`            | `a61ae7f04a6b3665b077b550193f24dc3134ee39d4645d86f7f0e52dc7e63c79` |
| `src/service/admission.ts`         | `c44a27cfe505bb6ac524928a4682a157b291fe777ed5b8979f3f07c0cde78cbd` |
| `src/service/ports.ts`             | `7134c4576caa55718d8ba914bb4c4f19f2dbeed4317eba041e53614e3e6c028e` |
| `src/service/contracts/core.ts`    | `c0872f2f0dce34c5ebfb73827b5200675b4d8ecfa312b2bb722c8e4bb51afb41` |
| `src/service/contracts/domain.ts`  | `f24eb52dafd058614828209135a3f9ac372232a74bcbf06c20c79ec05057b32a` |
| `src/service/contracts/capture.ts` | `1063989d0b7ae4b6a982243da272e3f01905013ba79bb145362fde1f15deddb7` |
| `src/service/contracts/history.ts` | `07810b6052e3a5c012a62388c4b77ddd24121be753294c4f63bde2c0ee48bf82` |
| `src/service/contracts/budget.ts`  | `968c85e35fb1e34c8e77ded90e29c41535728077a07be041b014068362a5463d` |
| `test/service-contract.test.ts`    | `4f5cf173e61219912e814ae8ae5e20ea052f15b4cb9c17f60d8a197a727f545e` |

W2's represented producer/transform/final interfaces are fit for the planned implementation handoff, subject to reciprocal agreement and the single JS-owner move.
No additional common-port blocker remains from this review.
Main still records the reciprocal freeze and shared-file ownership handoff; W1 and the integrated product remain incomplete.
