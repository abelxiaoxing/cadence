# Generate/publication review and writer-preference diagnosis

## Disposition

**BLOCKED: the unchanged writer-preference20s case remains failed; no performance repair is claimed.**
Production `createServiceHost` admission remains null.
The implemented Generate/publication boundary passed the focused checks below, with no newly reproduced production correctness defect in that boundary.
This is not acceptance of the whole scheduler, accepting host or complete product.
No production source or generated service/browser body was changed in this review.

Read the active check context, child artifacts, complete parent artifacts and both mandatory appendices, latest accepting-owner contracts/handoff/evidence, original execution-core review, W1/W6 handoffs and applicable specs.
Exact commands, input manifests, receipt/log hashes, failures and unchanged production identities are in [the evidence JSON](w4-generate-preference-review-evidence.json).

## Preserved failures inspected first

- Prior accepting-owner `core-batch.log`:33 passed /2 failed, including writer preference at20653ms and the separately repaired publication regression.
- Prior `corrected-focused.log`:1 passed /1 failed /26 filtered, writer preference at20539ms after removal of the redundant observation.
- Prior independent `core-expanded.log`: writer preference at20263ms; this failed run also contains two other failures.
- The prior native receipts `cadence-w4-native-ACLwOi/sdk-receipt.json` and `cadence-w4-native-aeMDju/sdk-receipt.json` each contain two original zero closes.
  Their association with the old case is chronological correlation; the old receipt schema does not itself name a test.

All remain unchanged failed evidence.
None contains the stage/cost information needed to assign its precise cause retroactively.

## New diagnostic observations

### Instrumentation and limits

`test/helpers/scheduler-diagnostics.ts` is test-only.
The writer-preference fixture optionally records setup/Create/Save/Start/observation, auth report versus original settlement, worker original, capture-ready, gate and parent/publication stages.
It observes the actual original promises delivered to `ServiceOwner.trackHistory`/`trackWorker`, using WeakMap numeric identities and bounded pending/event slots.
It returns the original promises/handles unchanged and never awaits them, adds no sleeps, performs no diagnostic disk IO during the measured case, and retains no arguments, results, auth/config payloads, exceptions or raw stacks.
Synchronous counters measure selected real filesystem/lease/navigation calls; their inclusive timings **overlap and must not be summed**.

The real native spawn wrapper, guard, original close intervals and receipts are unchanged.
Diagnostic output is written only during existing teardown, with fixed unavailable reporting if that write fails.
Prototype wrappers are restored independently of teardown success.
Dedicated tests verify original-promise identity/pending behavior, payload omission, bounded2048-slot snapshots and nonthrowing diagnostic IO failure.
These tests are not native-performance evidence.

The existing fixture topology, requests, assertions and20s case/15s child/8MiB100ms read/5s capture limits were not reduced or increased.
No assertion moved outside the case, no persistent cache or authority bypass, no outer timeout converted into success.

### Executed diagnostic runs

Fresh0700 ext4 root: `/home/mirako/abel/cadence-w4-generate-review-lmJ9Ek`, observed on `/dev/sda2`.
All executable verification used explicit TMPDIR/TEMP/TMP under its `tmp/`.
The recorded test/gate runner also isolates HOME; native fixtures further use fabricated per-fixture homes/agent directories.
Node26.7.0 `/usr/bin/node`, Bun1.3.14, Pi0.84.3, Linux x64; actual native workers used numeric-loopback fabricated providers.

| Run                          | Purpose                                                    | Result                         |
| ---------------------------- | ---------------------------------------------------------- | ------------------------------ |
| `preference-diagnostic`      | Stage/original/read/lease observations                     | Failed20000ms; reported20463ms |
| `preference-cost-diagnostic` | Added navigation/create/replace and capture-ready counters | Failed20000ms; reported20752ms |

The second execution answered the new cost-attribution question; it was not an unchanged rerun seeking green.
Both exact instrumented input manifests and complete traces/native receipts are retained.
Later diagnostic-only changes add type annotations, teardown-start labeling, IO-failure handling, a pending-ID cap and unit controls; they do not constitute a product repair or a new run of the failed case.

Second run, relative to case diagnostic start:

| Observation                             | Milliseconds |
| --------------------------------------- | -----------: |
| Actual host ready                       |          953 |
| Two Creates published                   |   1490 /2002 |
| Two Saves published                     |   2774 /3512 |
| First capture-ready /provider request   |   7938 /8107 |
| First provider reply supplied           |         9557 |
| First original worker completion        |        10365 |
| Writer gate-held fact submitted         |        12679 |
| Second capture-ready /provider request  | 15819 /15992 |
| Second original worker completion       |        17339 |
| Writer gate-release fact submitted      |        18505 |
| Parent-settled facts submitted          | 18761 /20180 |
| First final publication report returned |        20398 |
| Scheduler settlement waits returned     |        20713 |

Gate/parent markers name fact submission, not durable commitment.
Worker completion includes the maintained native/recording join; raw native close intervals are independently retained.
Both original native closes were exit0, with no overlap between the reader and writer.
No native close was stuck at the deadline.
The final scheduler waits returning **after** timeout do not establish successful parent publication: timeout teardown has already intervened, the snapshot is quarantined with one retained episode, and the case is failed.

Measured inclusive counters in that same run:

| Boundary                                | Calls | Total ms | Maximum ms |
| --------------------------------------- | ----: | -------: | ---------: |
| Private selected-file reads             | 17400 |     8036 |      11.68 |
| Lease assertions                        |  1798 |     6024 |      18.84 |
| Navigation prepare                      |    71 |     1865 |     104.67 |
| Navigation publish                      |    71 |     5839 |     282.23 |
| Navigation active publication           |    71 |      105 |      10.82 |
| Private create                          |   968 |     2631 |      34.67 |
| Private replace                         |   301 |     1717 |       8.04 |
| Action observation synchronous portions |    24 |      898 |      60.09 |

There were140 ordinary and8 safety original history jobs; the longest observed ordinary registration-to-settlement was1267ms, safety487ms, append201ms and auth-original582ms.
The original-job queue and gate transitions continued progressing; no original recording operation reached the5s reporting stall in this trace.
The first diagnostic independently observed the same continuing chain, with maximum ordinary original1207ms and two native zero closes.
These are observed durations under instrumentation, not portable timing guarantees.

### Explained versus unknown

**Observed:** the case exhausts its total budget during a long but progressing sequence of preparations, writes, validation and final publication, rather than a demonstrated queue/gate deadlock or native-close delay.
Navigation work and repeated selected-file/lease validation are substantial measured contributors.
Source inspection joins these counters to `HistoryWriter.schedule`, `HistoryNavigation.prepare/publish`, `PrivateFiles.read/directory` and `OwnerLease.assert`.
Those guards and derived writes currently have real integrity/lifetime responsibilities.

**Not established:** a specific redundant operation that can safely be removed, the exclusive CPU versus kernel/flush share, a timing guarantee on other hosts, or the precise causes of any old failure.
This review did not optimize an unproven hypothesis, coalesce required effect boundaries, drop indexes, weaken ownership revalidation, or reuse a cross-await authority cache.
A safe measured correction and counterexamples still need an explicitly reviewed implementation before rerunning the complete original case on changed production source.
The current measurements narrow the investigation but do not close it.
No break-loop bug-fix claim is recorded because no causal production correction was established.

## Generate/publication audit

- Generate is separately accepted through ActionAdmission, code-kind-only, one fixed research-purpose `design-explorer`, exact selected model/role/root hints, and null graph in both RunIdentity and RunAdmission.
  It does not dispatch saved edit assignments, call accepted-plan producers or acquire write tools.
- Durable command/allocation and lane/auth/native ordering remain the same owners as Start.
  Added task-byte/hint/business-file post-commit controls prove refusal with zero model preparation and zero provider contacts; original Start variants remain.
- The actual48022-byte invalid/oversized-for-Save advisory final remains fully retained with genuine native completed/zero-close/input/final/cleanup facts.
  Empty and saved plan/check bytes stay unchanged, saved graph lineage survives own summaries, duplicate commands do not launch again, and empty code plans still cannot Start.
- Current output is **advisory text**, not validated executable proposal metadata.
  There is no structured proposal import/usability DTO; clients must not infer usable decomposition from native completion.
  Typed planning/proposal metadata and cold saved-plan lineage remain accepting-owner work, not qualified by these tests.
- Access rotation/detach do not cancel accepted work; explicit Cancel still joins original native closure.
  The preparation continuation test is an injection, not genuine pending OAuth evidence.
- Subsequent pre-effect uncertainty has a distinct committed publicationId and null observed bytes, with exactly one earlier candidate intent retained.
  External raw bytes, execution outcome and native facts are independent.
  Existing duplicate-ID/invented-success/non-null-observed negatives pass.
- Added actual-disk parity covers reopened quarantined writer/receipt, finite historical projection, both complete export encodings with exact digest/count/trailer/original EOF and unchanged disk tree.
  Export retains earlier lifecycle snapshots **and later publication facts**; an earlier published snapshot must not be mistaken for the final publication outcome.
  This parity fixture injects owner execution facts and is not a native SDK test.

No additional scoped production defect was reproduced in this implemented boundary.
The failing writer-preference requirement and incomplete accepting-owner requirements remain unresolved findings, not waived by focused passes.

## Verification

Every command/exit/input/log hash is in the evidence JSON.
Separate selections overlap; **do not sum them into a whole-suite total**.

| Gate                                                           | Result                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Generate plus post-commit freshness selection                  | 12 passed /19 filtered;48.51s test time                                        |
| Adjacent scheduler/native/original-lifetime selection          | 7 passed /24 filtered;81.29s test time                                         |
| Contract/publication/plans/semantics/final-review/facts/parity | 368 passed /7 files;118.25s test time                                          |
| SDK/process/recording/public codec/owner                       | 532 passed /5 files;107.35s test time                                          |
| Diagnostic helper controls                                     | 3 passed;19ms test time                                                        |
| Root check                                                     | Exit0, including syntax, canonical operator/service byte checks and TypeScript |
| Lint                                                           | Exit0, zero errors/warnings, six pre-existing informational suggestions        |
| Agent index check                                              | Exit0                                                                          |
| Web typecheck                                                  | Exit0                                                                          |
| Web generated-byte check                                       | Exit0, two actual private Vite builds match canonical assets                   |

The scoped native/history batches used identical349-input manifests; only the diagnostic helper and its new unit file changed afterward.
Final350-input manifest covers the final diagnostic controls/check/lint.
All production, dependency and compiled asset inputs remain identical across every run.
No full scheduler/full verify, pack/extraction, browser/terminal workflow, remote HTTPS, paid-provider, physical-human/device or other native-platform qualification was performed.

Preserved development failures: diagnostic prototype wrappers initially lacked explicit TypeScript `this`; the parity fixture initially used a broad ListScope for an export Scope.
Both type errors were corrected; their logs remain and final root/web typechecks pass.
The first report link check failed before its evidence JSON existed; a later cached check repeated that diagnostic after creation.
An explicit uncached check verifies the real present target; both failures remain recorded.
The initial parity run passed runtime assertions before its fixture type correction; it is not substituted for the later full history batch.

## Changed files and remaining work

Changed repository paths:

- `test/service-scheduler.test.ts`: optional diagnostic attachment and three additional Generate freshness variants; original preference scenario/assertions/budgets preserved.
- `test/helpers/scheduler-diagnostics.ts`: bounded noninterfering timing observer.
- `test/scheduler-diagnostics.test.ts`: three diagnostics-only controls.
- `test/service-publication-parity-review.test.ts`: one real-disk parity/export control.
- `.trellis/spec/backend/service-orchestration-guidelines.md`: narrow reviewed Generate/publication contract and unresolved performance evidence limits.
- This report and its evidence JSON.

Remaining: a demonstrated safe performance fix; actual configured/native-local checks and exact generation/review; accepted-metadata/whole-episode Stop ownership; cold/current metadata and proposal usability; actual finite model selection; W6 planning/build handshake and accepting host; W1 proxy/recovery; W5 cutover; W7 complete distribution and integrated acceptance.
No production admission is opened.

Preservation/deviations: no agents, dependencies, credentials, deployment, Git mutations, cleanup, commit or task-status changes.
Initial context/read-only `git status` probes and root allocation preceded explicit temp isolation; the Git probes were contrary to the narrower no-Git delegation and are disclosed, not described as compliant.
Subsequent review used saved preimages/hash manifests and a non-Git diff, with explicit disk temp selection for every executable check.
All old/new failed roots and receipts remain preserved.
