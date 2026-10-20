# W1 dependency and owner-core independent review

## Decision and scope

Fixed six concrete owner-core defects.
No further defect was found in the reviewed available-host core after the fixes.
**The whole-repository lint gate remains blocked by an unchanged, out-of-scope receipt formatting error.**
This is not unconditional whole-package approval, W1 completion or product acceptance.

Resolved the active task through `task.py current --source`; read the child manifest/artifacts, curated context, parent PRD/design/plan and both mandatory appendices, execution checkpoint, joint freeze, provisioning/application evidence, owner handoff/checks and all six delegated source/test bodies.
Reviewed the actual dependency diff and preserved inputs.
Parent selected contracts govern intentional changes from the maintained terminal-only product.

Changes in this review:

- `src/service/coordination.ts`
- `src/service/owner.ts`
- `test/service-owner.test.ts`
- `test/helpers/service-owner-child.mjs`
- This new report.

`src/service/private-files.ts` and `src/service/recovery.ts` were reviewed but not changed.
All ten frozen shared sources/tests, package/lock, legacy store/operator and existing receipts remained byte-identical.
No install/download, real credential access, production checkout service, task-state change, Git mutation, subagent, pack or publication was performed.
Git setup/index/worktree operations in existing tests were confined to newly allocated fixture repositories.
The new TCP listener was an isolated loopback test, not HTTP/service composition.

## Findings fixed

### 1. Remaining fences could be erased after release-state interference

`OwnerLease.removeOwnedFiles` originally validated the complete selected state only before the first removal.
A change to config/registration after capability removal did not prevent removing the owner and v1 locks.
A changed registry lock was detected only after those removals.
A standalone native Node probe against the original source actually admitted a subsequent legacy writer: `releaseThrew:false`, `legacyAcquired:true`, both remaining fences absent.

Release now advances its expected state only after each successful removal, revalidates all remaining selected files and expected absences before the next removal, and checks the held short registry lock, registry format, namespace and newly published roots snapshot.
A failed removal does not advance the expected state.
Later interference retains every remaining fence; already removed files are not recreated.

Five injected boundary mutations cover config, registration, registry lock, roots and registry format.
They perform real filesystem writes and subsequently exercise a separate native legacy contender.
A further regression mutates after owner-lock removal and requires the last v1 fence to remain.
The corrected standalone probe reports `releaseThrew:true`, `legacyAcquired:false`, both remaining fences present.

This remains ordered supported-writer hygiene, not hostile-same-user atomicity or a multi-file rollback/directory-durability certificate.
The timing of the interfering mutation is explicitly injected, not represented as an observed spontaneous race.

### 2. Reentrant Stop could start two drains

`stop()` originally published `attempt` only after calling `quiesce` and entering `drain`.
A synchronous adapter calling Stop from `quiesce` started a second drain; the counterexample observed two flush calls, and competing final releases could turn the result uncertain after fences were removed.

The shared attempt is now published before invoking any external synchronous callback.
Reentrant/concurrent callers observe the same original drain, flush, listener close and release.
Regression assertions require one flush/close and matching stopped reports.
Separate short/long reporting waits prove that one reporting expiry cannot be overridden into automatic release by another waiter.

### 3. A completed late listener close was repeated on explicit retry

A reporting timeout during listener close retained fences correctly, but a later explicit Stop called `closeListener` again even after the original close had succeeded.
Real Node servers reject a second close with an already-closed error, permanently quarantining an otherwise settled owner.

The owner now retains successful original listener closure independently of the management wait.
Late closure alone still cannot release locks; a new explicit Stop can finish without closing the same listener again.

An actual TCP connection held a native Node listener open beyond the shortened management wait.
Original-source probe: two close calls and retry quarantined.
Corrected probe: one close call, fences still present before retry, then stopped.
This establishes native listener lifecycle only; flush receipts remain injected and no HTTP/auth readiness is qualified.

### 4. Later stop callbacks could run after ownership loss

`requestStops` originally checked the lease once for the whole loop.
The first callback could lose ownership, yet the next callback was still invoked.
The regression observed that forbidden second invocation after a whitespace-only v1-lock mutation.

Each callback now has its own immediate lease check.
Requests remain concurrent with respect to settlement: none waits for an earlier original process to close.
The callback test is injected signaling evidence, not a claim to have reproduced PID reuse or killed unrelated processes.

### 5. Lease loss while awaiting originals could still start a flush

A changed v1 lock during the original-process drain was not checked until after `flush`.
The counterexample observed one new flush despite lost ownership.

`drain` now checks the lease before starting the original flush, in addition to the existing checks before listener/release effects.
Regression requires zero flush calls and retained fences.
Actual W3 writes are not supplied by these tests.

### 6. Refused late auth/storage originals disappeared from pending accounting

Late tracking quarantined safely but attached only rejection handlers, dropping the original operations from pending reports.
`trackAuth` also stopped at the first refusal without registering its independent settlement write.
The counterexample reported auth/storage counts zero while both original promises remained pending.

Late originals are now retained in accounting before refusal; `trackAuth` independently registers the settlement write even when auth registration refuses.
The 256-entry misuse guard still quarantines, but cannot discard already-started effects.
Actual capacity must be reserved before effects by W4; this tracker is not an admission gate or a hard memory bound for an arbitrarily broken internal adapter.
Late settlement never clears permanent uncertainty.
Tests observe auth and storage settle separately and retain fences throughout.

## Coordination and preservation checks

The reviewed core continues to:

- Serialize all-root overlap validation and reservation under one exclusive cross-process short lock, before root initialization/v1 acquisition.
  Nested Git, submodule-shaped actual gitfile/gitlink, mixed and non-Git cases run in both orders; aliases conflict; disjoint real worktrees can coexist.
- Reject simultaneous distinct nested-root owners as well as exact-root races.
  Tests wait original native fixture close handles.
  A positive legacy-acquisition control precedes the blocked native contender, rather than treating arbitrary launcher failure as exclusion.
- Hold v1 and new owner locks during idle lifetime.
  Native abrupt exit preserves restart refusal and does not replay work.
- Preserve an old, valid-looking short registry lock even with the PID of a fixture whose original native close was observed and an epoch-aged mtime.
  Status/recovery remain unavailable/refused; neither age nor PID absence reclaims the lock.
- Preserve missing state on passive inspection; refuse selected corrupt/linked/hardlinked/oversized/unsafe-mode state.
  Private helpers retain bounded/no-follow reads, descriptor/path stamps, canonical ambient paths and POSIX ownership/mode checks.
  Literal whitespace path bytes remain operational identities.
- Keep recovery non-accepting without W3's actual append/accounting implementation.
  Injected independent history facts, ESRCH and confirmation are insufficient to unlink anything.
  No fake accepting recovery was added.

These are bounded coordination guarantees within the selected state-home, not exclusion of external editors, escaped descendants, arbitrary older/custom-domain runtimes or hostile same-user mutation.
POSIX permission/UID and literal-path cases do not qualify Windows ACL/path behavior; Windows/macOS and their test producers remain unexecuted.

## Dependency application: readonly verification

The actual package equals the retained original plus exactly the reviewed **26 direct additions** and Node engine `>=22.19.0`.
`ws@8.21.3` is the sole production addition.
Scripts, public peers, Pi pins and unrelated manifest fields are unchanged.
All 26 selected installed manifests match their exact additions; Pi coding-agent/AI/TUI/agent-core remain0.84.3.

```text
package.json 2aa7fe4c464835cdebdafbed2cf5d4831cc02c753886eb6f0b42041c46f7464c
bun.lock     cc31e7ad885c21849b38515cb47bb9913b75801a3b484bf647e11fe354f47551
```

The lock is byte-identical to the independently reviewed standard-generated offline fixture.
Rehashed all11 application custody entries and recorded outputs, compared original preimages and real before/after invocation hashes, inspected the application helper and actual argv/environment.
The retained namespace differs from the parent and its route table is empty; Bubblewrap uses `--unshare-net`, readonly package/lock/cache mounts, a clean isolated HOME/config, `--frozen-lockfile --ignore-scripts --backend=copyfile`, and no online fallback.
Empty npm/Bun config bodies were verified.
The receipt records175 installed packages, distinct from the earlier342-package clean fixture.

This review did not repeat the previous403-artifact/full-cache/license audit or run an install; it binds the unchanged reviewed graph and application evidence.
The earlier provisioning pre-execution-input limitation and failed attempts remain historical, while this application has captured real pre/post inputs.
Nonhost artifacts, emitted asset/font/vendor notices and W7 exact package closure remain pending.
No package policy or product-boundary test was relaxed.

Application receipt SHA-256: `2381063377765b9d6926f5bda7f54b491ee5f312598a986e8ab71fd742d3612a`.

## Executed verification and evidence

Evidence root: `/tmp/cadence-w1-review-h8ndle0u` (new owned directory; previous evidence roots untouched).
Actual host: `/usr/bin/node`26.7.0, Bun1.3.14, Linux/x86_64, Pi0.84.3.
The application receipt's differing Bun install banner remains separately recorded; no Node22/nonhost/paid-provider qualification is inferred.

| Run                                                        | Result                                       | Evidence                      |
| ---------------------------------------------------------- | -------------------------------------------- | ----------------------------- |
| Original focused contract/owner/legacy-store baseline      | 217 passed,0 failed,0 skipped                | `baseline.log`                |
| First new counterexamples, original owner core             | 78 passed,7 failed                           | `counterexamples.log`         |
| Additional lost-lease-before-flush counterexample          | 86 passed,1 failed                           | `flush-counterexample.log`    |
| Registry-format release counterexample after initial fixes | 88 passed,1 failed                           | `registry-counterexample.log` |
| Final focused contract/owner/legacy-store                  | **232 passed,0 failed,0 skipped**            | `final-focused.log`           |
| `bun run check`                                            | **exit0**                                    | `final-check.log`             |
| `bun run lint`                                             | **exit1**, unchanged receipt formatting      | `final-lint.log`              |
| `bun run check:agents`                                     | **exit0**                                    | `final-agents.log`            |
| Scoped Biome on all six delegated bodies                   | **exit0**, no warnings                       | `final-scoped-biome.log`      |
| Separate `rumdl check .`                                   | **exit0**,41 files under existing exclusions | `final-markdown.log`          |

Final breakdown:114 frozen portable tests +93 owner tests +25 existing store/controller tests.
Fifteen owner regressions were added; intermediate/overlapping runs and standalone probes are not additional suite totals.
Initial failures and the initial scoped-format warning remain in their logs, not relabeled passed.

The new report also passed scoped `rumdl check --no-exclude` after sentence/table formatting; its initial findings and correction are retained in `report-lint.log`, `report-format.log` and `report-lint-final.log`.
This report-only check is separate from the earlier41-file Markdown run.

The final batch used:

```sh
bun run test -- test/service-contract.test.ts test/service-owner.test.ts test/lightweight-store-controller.test.ts
bun run check
bun run lint
bun run check:agents
node_modules/.bin/biome check src/service/private-files.ts src/service/coordination.ts src/service/owner.ts src/service/recovery.ts test/service-owner.test.ts test/helpers/service-owner-child.mjs
node_modules/.bin/rumdl check .
```

`verification.json` binds each final command's exit, log hash and pre/post source hashes; SHA-256 `a5fc255b22f54b8a591cf1eb2bc130417ca31e85b5b7cfde7f1c1bd93be1d1b1`.
Original native probe result: `native-before/result.json`, SHA-256 `a3f879a4f5b4e0800c354e383593592c69f9ff13636cf2abbe289523d7b71e7c`.
Corrected native probe result: `native-after-result.json`, SHA-256 `8cab27207c696da5be1b9d090cdc21088960989147e2d4a6e6b45b27b7b1f920`.
The probe bundles were executed by actual Node and exited0 as diagnostic producers; the original JSON contains the failed product expectations and is not a passing regression receipt.
They use locally bundled source, not installed/extracted service code.

### Remaining lint blocker outside permitted edits

Biome rejects compact-array formatting at `research/w1-owner-core-checks.json`'s check/lint/agents argv arrays.
Its original SHA-256 remains `715ce16757a2841b07b461c7d78f2b267b89dfafd04b7a03860f667005059607`.
The two existing package-audit suggestions are informational, not the failing gate.

This receipt is outside the permitted source/test/new-report edits and is referenced by the previous handoff, so it was not reformatted or silently rebound.
Main must handle that evidence-preserving correction under its own scope and rerun whole lint.
Scoped source lint and separate Markdown success do not replace the failed whole lint result.

## Final source identities

```text
src/service/private-files.ts          a0275cb8132d83a1614990a50485d9beeffcc1b3bc59262907790e734082f8a6
src/service/coordination.ts           1158e74ee8b054383fba4bb7c778d06e4b5f85fee738052eb013b7ab929e7109
src/service/owner.ts                  d62e35cdd7be3d26cc9827d00ea52f4cd4ea4f40b04324f4137993790825602c
src/service/recovery.ts               fdc239b4b6947abe28599a961000cdda11b22c619bdb83d1deda256d99d36a26
test/service-owner.test.ts            c005cc1a4f83d2d7dbde985f873a0085b3ca6f7c5ce2247ddae01388e57b2d91
test/helpers/service-owner-child.mjs  c7b3c6203d516f577062cb73722fd00beeb6547caf53abcb64639945d79261a0
```

Initial source/freeze identities are preserved in `inputs.json` and the six original source/test preimages; original owner handoff/checks and both consumer reports are unchanged.

## Prevention and remaining integration gates

Root causes were implicit temporal assumptions and missing boundary tests: one entry check was treated as authority across later callbacks/removals; a caller reporting deadline was conflated with the original listener lifecycle; refusal was mistaken for removal of already-started effects.
The initial release correction also needed registry-format coverage, demonstrated by a separately retained failing counterexample.
Regression ownership stays with the lifecycle/coordination owner, not a new generic security framework.

For subsequent adapters, publish shared operation identity before callbacks, retain original promises independently of caller waits, and revalidate remaining ownership before each effect.
Reserve capacity before starting effects; never solve excess late activity by dropping its accounting.
Actual W3/W4 composition must enforce these same contracts, not replace the tests' injected receipts with accepting defaults.

Required follow-ups remain the previously planned integration gates, not new findings against this bounded chunk: real W1 HTTP/token/Host/Origin/CSRF/WS, port0 listener/config composition, public Pi auth/writeback accounting and CLI/build; actual W3 journal/flush/recovery append; W4 scheduler/process wiring; W5/W6 clients and W7 distribution/assets/notices and integrated source/extracted acceptance.
Recovery remains intentionally unavailable.
No SDK, durable-history, browser, HTTP, pack/full-suite, Windows/macOS, physical-human or paid-provider pass is claimed.

Spec-update judgment: production still uses the old workflow and this review may not edit maintained specs.
Capture these executable lifecycle/release rules at the deliberate W1/W7 spec handoff; this report and regressions preserve them without prematurely declaring product cutover.
Main should independently rerun final checks.
W1 and the parent remain open.
