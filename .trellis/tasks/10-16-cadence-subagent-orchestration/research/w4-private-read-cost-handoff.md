# W4 Private Read Cost — Implementation Handoff

## Disposition and scope

**The narrow correction passes the requested available-host gates; independent review is still required.**
The original complete writer-preference case now settles within its unchanged20s deadline on changed production bytes.
This does not explain earlier failed runs, open production admission, complete W4 or qualify the integrated product.

Followed [the main-owned handoff](private-read-cost-handoff.md), current owner/storage/history/orchestration contracts, child and complete parent artifacts/appendices, and the prior Generate/preference review/evidence.
Only `src/task-store.ts`, `src/service/private-files.ts`, one new focused test, canonical generated bundles and this report/evidence were changed.
Scheduler, OwnerLease, writer/index/publication, check/native/read budgets and original-lifetime implementations are unchanged.
The production host still installs `admission:null`.

Exact pre/post hashes, command arguments/environments/exits, complete stage/native receipts, failed logs and preserved historical identities are in [the evidence JSON](w4-private-read-cost-evidence.json).
The359-input final manifest remained identical through all three final regression batches and root/web/Agent/generated-byte gates.
The separate preference measurement preceded only bundle regeneration and additional focused-test controls; its production primitives and original preference scenario are the same final bytes.

## 1. Scope / trigger: demonstrate work before optimizing

Fresh private root: `/home/mirako/abel/cadence-private-read-N7rtsqfP`, mode0700, observed `/dev/sda2` ext4.
All verification commands selected explicit TMPDIR/TEMP/TMP beneath its `tmp/`, and an isolated HOME; existing native fixtures further selected fabricated profiles and numeric-loopback providers.
Available identity: `/usr/bin/node`26.7.0, Bun1.3.14, Pi0.84.3, Linux x64.
No user profile, credentials or actual-checkout service was used.

The new real-file control wraps actual synchronous filesystem operations and `Buffer.alloc` with fixed scalar counters.
It retains no buffers, Stats, argument/result histories or promises; wrappers return the actual results and are restored.
The allocation wrapper covers only the synchronous selected read; fixture setup/assertions and the bounded JSON receipt write occur outside that window.
The original scheduler uses its already-reviewed bounded test-only diagnostics without changes.
No diagnostic callback awaits, joins an original, sleeps or writes during the measured preference case.

Before production edits, the corrected baseline24-test run demonstrated:

| Work on a real15-byte file, independent maximum1MiB |             Before |   After |
| --------------------------------------------------- | -----------------: | ------: |
| Readonly directory `lstat` calls                    |                 95 |      23 |
| Of those, namespace `lstat` calls                   |                 11 |       2 |
| Complete `PrivateFiles.read` `lstat` calls          |                120 |      48 |
| Actual allocation count                             |                  1 |       1 |
| Actual allocated bytes                              |            1048577 |      16 |
| Opens / closes / reads                              |            2 /2 /2 | 2 /2 /2 |
| Existing-directory create=true `lstat` calls        | original formula95 |      95 |

The namespace depth was7 and target depth11.
Before: each of five private components called the full ambient traversal, plus its own permission stat: sum of `2 * depth + 1` =95.
After: one root observation plus two legacy traversal stats per nonroot component =23; private permission checks consume those observations.
The inner bounded reader still performs its independent full ambient traversal.
This is a deterministic work-count/allocation correction, not a timing-only rerun seeking green.

## 2. Signatures

The existing helper now has an additional readonly overload:

```ts
safeDirectory(path: string, create?: boolean): boolean;
safeDirectory(
  path: string,
  create: false,
  inspectExisting: (path: string, stat: Stats) => void,
): boolean;
```

The sole production hook caller is the readonly branch of `PrivateFiles.directory`.
The hook runs synchronously for root and each existing ancestor before visiting its child, outside the filesystem ENOENT catch.
A hook refusal carrying ENOENT is not converted to absence or permission to create.
The default traversal and stepwise create=true path retain their original checks and effects.

`PrivateFiles.read` retains its independent caller maximum, then calls `readBounded(path, opened.size)` rather than `readBounded(path, maximum)`.
It additionally requires the returned length to equal the selected size before returning the original bytes/hash/stamp shape.

## 3. Contracts retained

- Containment is the existing segment-aware `relative` check; the private boundary is exact normalized path equality, never string-prefix containment.
- Every ambient ancestor remains checked for directory type/link refusal.
  Every existing selected private ancestor, including the namespace/root case, receives the same mode/uid policy before any missing child can return absent.
- Readonly observation creates nothing.
  Unsafe parents block descendant creation; create=true still walks/checks each component before its creation effect.
- No file maximum is reduced or raised.
  The exact inner allocation retains the extra growth sentinel, including an empty file.
- Before/opened/final descriptor and final selected-path identity checks remain, including device/inode/size/times/mode/uid/link count; O_NOFOLLOW and single-link policy remain.
- `readBounded` retains its own complete pre-open ancestor traversal, bounded IO and independent opened-file checks.
  No descriptor or path guard was replaced by a source hash.
- Hash and stamp remain actual returned-byte SHA-256 and selected stat identity; atime is intentionally not part of that identity.
- Every existing OwnerLease/effect-boundary assertion, commit/index write, original-lifetime fence and native join remains unchanged.
- No cross-call/await/effect cache, coalesced commit, dropped index, alternative reader/runner, fallback or cleanup was added.

This remains supported-writer hygiene, not directory CAS, hostile same-user isolation or change-and-revert detection.
The synchronous observer contract is internal; it is not task/auth/recovery authority.

## 4. Validation and error controls

The final new `test/service-private-files.test.ts` contains34 cases, including parameterized controls:

| Boundary                                                                                                 | Expected and observed                                                           |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Empty/exact-size/max/max+1                                                                               | Exact bytes/hash/stamp; independent overflow refusal before open                |
| Missing namespace/parent/file                                                                            | Absent, no creation                                                             |
| Namespace/ancestor/leaf unsafe modes                                                                     | Refusal even with missing child; no descendant creation                         |
| Sibling-prefix/escape/normalized/relative/root namespace                                                 | Exact containment and private-boundary handling                                 |
| Ambient/namespace/ancestor/leaf links; dangling link/non-directory parent                                | Refusal, original targets/bytes preserved                                       |
| Selected symlink/hardlink/directory/mode                                                                 | Refusal without repair                                                          |
| Growth/shrink/same-byte replacement/mode at outer-open, inner-open, after-read and final-stat boundaries | Refusal with all opened descriptors closed                                      |
| Symlink substituted after each selected path stat                                                        | Refusal; no-follow/identity defenses remain                                     |
| Ancestor link substituted after outer open                                                               | Inner reader's independent walk refuses                                         |
| Empty file grows after inner fstat                                                                       | One-byte growth sentinel refuses                                                |
| Changed mode on next call after await                                                                    | Fresh refusal; no stale cache                                                   |
| Foreign uid                                                                                              | Refusal; explicitly injected uid observation, not actual foreign-user execution |
| Inspection callback throws ENOENT                                                                        | Exact refusal propagates, not absence                                           |
| Legacy default mode/stepwise creation                                                                    | Original behavior remains                                                       |

Boundary mutations are deterministic injections into real isolated filesystem calls, not spontaneously reproduced hostile races.
POSIX mode/uid controls executed on Linux; Windows-specific policy and ACL behavior are not qualified by them.

## 5. Complete original preference case

The **unchanged entire test** `checkout writer preference excludes native readers across tasks and stale queued work never relaunches` passed: **14219.575ms**,1 passed /30 filtered, with the original topology, assertions, native guard and20s case /15s child /8MiB100ms read /5s capture limits.

Primary receipts: `tmp/cadence-w4-native-Rj9k0e/{scheduler-timings,sdk-receipt}.json` under the private root.
Relative to diagnostic start:

| Stage                                    | Milliseconds |
| ---------------------------------------- | -----------: |
| Actual host ready                        |          983 |
| Creates published                        |   1373 /1688 |
| Saves published                          |   2153 /2609 |
| First capture-ready /provider request    |   5764 /5893 |
| First reply supplied                     |         6737 |
| First original worker completion         |         7264 |
| Writer gate-held fact submitted          |         8616 |
| Second capture-ready /provider request   | 10944 /11066 |
| Second original worker completion        |        11863 |
| Writer gate-release fact submitted       |        12557 |
| Parent-settled facts submitted           | 12701 /13519 |
| Final publication reports returned       | 13647 /14134 |
| Both scheduler settlement waits returned |        14134 |
| Case finally /teardown begins            | 14161 /14162 |

Gate/parent markers are submissions, not claimed commit timestamps.
Both native original closes were exit0, nonoverlapping; durable native facts retained delivered stdin, valid final, settled cleanup and completed recording.
The older parent is completed; the younger parent is blocked/stale-dependency with no launched children, not silently retried.
Both final publication facts are `published` (seq146/149), and actual v1 summaries are revision4, phases review/failed respectively.
The original production reducer/assertions establish the case result; supplemental raw retained-fact extraction in the evidence is not a replacement validator.
At final diagnostic snapshot the owner is stopped, pending originals/writer jobs are empty, and scheduler episodes/reservations/retained allowance are zero.

Current inclusive costs:

| Boundary                      |    Calls |   Total ms |
| ----------------------------- | -------: | ---------: |
| Private selected reads        |    17820 |       4291 |
| Lease assertions              |     1834 |       4030 |
| Navigation prepare            |       72 |       1257 |
| Navigation publish            |       72 |       4053 |
| Navigation active publication |       72 |         59 |
| Private create /replace       | 991 /307 | 2286 /1305 |

These counters overlap and **must not be summed**.
There were142 ordinary and8 safety original write jobs; longest ordinary original605ms, safety297ms, append109ms and auth-original321ms.
No observed original reached the5s reporting stall.
The completed case performs more work than the prior timed-out/quarantined trace; counts were not reduced to manufacture a pass.

The later complete scheduler regression batch also passed all31 cases; its unchanged preference diagnostic (`cadence-w4-native-RsOeNY`) returned both scheduler waits at13060ms with two original zero closes, published summaries and stopped/empty final accounting.
This is broader regression coverage, not another attempt to obtain green after failure.

The prior20s failures remain failed, their logs/trace/native hashes unchanged.
Neither current improvement nor this available-host pass establishes their precise causes, exclusive CPU/kernel/flush attribution or a universal performance guarantee.

## 6. Verification and generated bodies

Three disjoint final batches on the same359-input manifest: **1442 passed /0 failed /0 skipped across40 files**.
The separate preference, baseline24 and intermediate31-case private controls overlap these selections and are not added to that total.
The suite includes injected/unit controls and actual filesystem/SDK/process/HTTP cases; it is not1442 native SDK runs.

| Final batch /gate                                                                     | Result                                                                  |
| ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Owner/private/store/contract/diagnostics,8 files                                      | 591 passed;204.47s                                                      |
| All22 history files plus scheduler-facts/core-review/publication-parity,25 files      | 341 passed;841.93s                                                      |
| SDK/process/public/recording/capture/canonical-budget plus complete scheduler,7 files | 510 passed;288.19s                                                      |
| Canonical operator/service rebuilds                                                   | Exit0                                                                   |
| Root check                                                                            | Exit0; syntax, both generated-byte checks, TypeScript                   |
| Lint                                                                                  | Exit0; zero warnings/errors, six pre-existing informational suggestions |
| Agent index check                                                                     | Exit0                                                                   |
| Web typecheck                                                                         | Exit0                                                                   |
| Web generated-byte check                                                              | Exit0; two real private Vite builds match unchanged canonical assets    |

Generated `src/operator-cli.mjs`, `src/service-cli.mjs` and `src/service-host.mjs` were rebuilt only through canonical scripts, not hand-edited or exempted from checks.
The shared store helper is in all three bundles.
Existing provenance contains no destination-body pin for these owned primitives/bundles; auth/web source-body pins, dependency lock and all web bytes remain unchanged.
No distribution member policy was weakened or claimed qualified.

Preserved development failures: the initial formatter found an untyped test local; four initial tests incorrectly compared atime after a real read (20 others passed).
The local received an explicit type; comparisons now assert every production identity/stamp field without claiming access time stays unchanged.
The corrected pre-edit baseline passed24 cases before product edits; final34 controls passed in the broad batch.
No production failure was masked by these test corrections.
The first scoped report check also failed on table alignment/sentence wrapping; only this new report's formatting was corrected and the failed log retained.

## 7. Review, recurrence prevention and remaining gates

The demonstrated issue is a cost/implicit-assumption and test-coverage gap: composing complete ancestor validators at each private segment repeats work, and a maximum is not necessarily a suitable allocation when an exact stable size is already selected.
The selected fix lives in those shared owners, not scheduler delays, warmed authority, fewer commits or broader budgets.
The fixed counters and counterexamples prevent recurrence while preserving the independent maximum and final identity obligations.
Wrong: reuse a prior directory result/lease across an await, or treat a smaller allocation as permission for partial reads.
Correct: one synchronous full traversal with private inspection, then exact-size inner read plus all original independent guards.
Base: missing state stays absent, unsafe existing state stays refused.

Spec-sync judgment: after independent review, main should record the narrow readonly overload, unchanged default/create behavior, exact-size read contract and current evidence in the owner/storage/orchestration specs.
This delegation deliberately leaves maintained specs/task status unchanged; concrete signatures, invariants and regression anchors are persisted here rather than widening the assigned edit set.
No template synchronization or commit is authorized.

**Main must dispatch independent review; this implement agent did not spawn agents or claim independent acceptance.**
Remaining product gates are unchanged: accepting-owner checks/full output/exact generation/review, current/cold metadata and explicit model choice, whole-episode/metadata Stop composition, W1 proxy/informed recovery, W5 native cutover, W6 accepting metadata/build handshake and W7 complete distribution/integrated acceptance.
No full verify/pack/extraction/browser/terminal/remote HTTPS/paid-provider/physical-human/other-platform qualification was performed here.

Preservation/deviations: no dependency, frontend, task-status, repository Git/staging, actual credentials, deployment or cleanup actions.
The mandatory initial task-path command preceded temp isolation; this is disclosed, not described as compliant with the every-command environment rule.
An initial `mktemp -m 700` attempt failed because that flag is unsupported; ordinary `mktemp -d` then created the observed0700 root.
A compound find probe was rejected by the harness wrapper; fixed-root Python enumeration supplied the real measurement receipts afterward.
All failed and successful logs/roots remain preserved.
