# W4 scheduler IO diagnosis — one complete execution

## Disposition

**Diagnostic evidence, not a product repair or an explanation of the previous eleven failures.**
One new instrumented complete scheduler file passed **31/31, no skips**.
The actual original Vitest Node runner exited **0**, observed through its owned process handle; no timeout, signal or forced teardown was used by the supervisor.
Production `createServiceHost` still supplies `admission:null`.
No production source, generated body, dependency, native/read/capture budget or assertion was changed.
Do not rerun unchanged merely to replace the old failed gate with green.

Exact commands, case outcomes, input identities, first/late observations and artifact hashes are in [the new evidence JSON](w4-scheduler-io-diagnosis-evidence.json).
The old20-pass/11-fail scheduler log/report and the nine earlier failed artifacts were rehashed unchanged.
Main's separate current-resource probe remains evidence about its own observation window, not the old failures.

## Execution and immutable inputs

- Run root: `/home/mirako/abel/cadence-w4-io-run-bPrZ3O`, mode0700, home-disk device8:2 (`/dev/sda2`, ext4).
- Actual runner: `/usr/bin/node`, PID1637519, Node26.7.0, Linux x64; installed Pi0.84.3 and Vitest4.1.10.
- Command: `/usr/bin/node node_modules/vitest/vitest.mjs run --no-file-parallelism test/service-scheduler.test.ts --reporter=verbose --reporter=json --outputFile=<run-root>/scheduler-result.json`.
- This owns Vitest itself rather than a Bun/shell wrapper.
  It uses the package test script's existing `--no-file-parallelism` route and unchanged default pool configuration; one complete file, no name filter/retry/concurrent research/build/test.
- Outer allowance1200s; all31 original cases remain20s, child controls15s, Stop observation5000ms, existing read8MiB/100ms and capture5s unchanged.
- Vitest duration165.74s, including164.18s tests.
  Supervisor elapsed168.909s includes its2-second post-wait observation, not a168.909s test or an extended assertion budget.
- All362 executable/source/test/build/dependency inputs match before/after.
  Against the prior359-input freeze, only `test/service-scheduler.test.ts` and `test/helpers/scheduler-diagnostics.ts` differ; the three added inputs are diagnostic helpers/controls.
  All existing production and generated inputs match that prior freeze.
  This is the repository-input/lock/pin freeze, not an exhaustive before/after hash of every installed transitive dependency; actual Node executable hash and observed installed peer versions are recorded separately.
- Fresh private temporary/home roots contain only fabricated profiles/workspaces.
  TMPDIR/TEMP/TMP point to the same0700 disk root.
  No credentials, installation, Git mutation/status, deployment, task-status change, user-process signal, tmpfs execution or old-root cleanup.

One isolation deviation is disclosed: the initial readonly `task.py current --source` command named a not-yet-created home-disk temporary path.
The actual0700 root was then allocated; no test/build/provider execution used the earlier path.
All subsequent executable commands used the allocated private root.

## Instrumentation and its limits

Changed/added files are strictly test harnesses:

- `test/helpers/scheduler-io-diagnostics.ts`: opt-in bounded measurements of the actual Node filesystem entrypoints, directory handle methods, original FileHandle promises, fsync-only process CPU deltas, per-case CPU/resource snapshots and original SDK lifecycle events.
- `test/service-scheduler.test.ts`: opt-in module instrumentation and case-context wrapping; all existing bodies/arguments/options/limits remain.
  Records Stop reports and provider-close observations without changing teardown order or joining additional work.
- `test/helpers/scheduler-diagnostics.ts`: exposes the existing finite snapshot so the first per-fixture receipt and a later snapshot can both survive, without overwriting the first receipt.
- `test/helpers/scheduler-io-run.py`: owns the actual runner and samples bounded current process/thread/disk metadata before/during/after.
  Only its own runner handle could be signaled by the unused outer watchdog; discovered PIDs never become signal authority.
- `test/scheduler-io-diagnostics.test.ts`: exact argument/receiver/result/throw/promise/handle identity, actual file/directory calls, late case attribution, registration/deadline preservation and disabled-mode controls.

The wrappers return the original results/promises and do not await/replace them, inspect exception properties, defer original callbacks, retain payloads/paths/arguments/environments, or write per syscall.
AsyncLocalStorage preserves originating-case provenance for late callbacks instead of assigning them to whichever case is currently displayed.
Per-case process CPU still includes other worker threads and overlapping prior work; it is not exclusive call-stack CPU profiling.

Bounds:64 cases,8192 lifecycle events,256 snapshots,1201 CPU samples,256 descriptor classifications; supervisor at most1205 samples/8MiB retained encoded metadata,64 processes and32 threads/process.
Final combined harness receipt is capped4MiB; actual size1399163 bytes, no drops.
Supervisor retained162 samples,993417 encoded bytes, no scan/process/thread/sample limit hit.
Diagnostic serialization happens after the case teardown or after the file, never inside a write callback.
Supervisor uses a regular log file rather than a backpressured output pipe.

**These are native-API-enclosed wall durations, not kernel-exclusive syscall durations.** `strace` and `perf` were unavailable; no installation, privilege escalation or fabricated kernel timer was substituted.
Promise durations include libuv queuing and event-loop scheduling.
Node internals and SDK-child filesystem calls are not comprehensively intercepted.
One-second `/proc` syscall-number/wait-channel samples corroborate some kernel waits but cannot reconstruct every syscall or exclude short interference.

## Measured work: validation, CPU and fsync are separate facts

The instrumented test worker consumed124.996s process CPU (82.452s user,42.545s system) over164.156s between first-case and final snapshots.
It had no major faults or recorded block reads,114000 `resourceUsage.fsWrite` blocks and241648 additional voluntary context switches.
`fsWrite` is a resource counter, not application bytes or fsync count.
The original runner's reaped-child usage, which also includes native children, is retained separately and is not added to worker CPU.

| Observed entrypoint       |    Calls | Inclusive elapsed | Largest call |
| ------------------------- | -------: | ----------------: | -----------: |
| `lstatSync`               | 15589104 |           44.192s |     15.703ms |
| `fstatSync`               |   780040 |            1.278s |      5.865ms |
| `readSync`                |   536864 |            1.122s |      5.821ms |
| `openSync`                |   547767 |            2.929s |      0.235ms |
| `writeFileSync`           |    12541 |            0.208s |      7.028ms |
| `fsyncSync`, file         |    12410 |           13.918s |     33.043ms |
| `fsyncSync`, directory    |    19245 |            4.612s |     33.083ms |
| FileHandle `sync`         |      930 |            1.255s |     34.502ms |
| `fs/promises.open`        |      930 |            6.604s |    190.396ms |
| FileHandle `stat` promise |      930 |           12.615s |    203.693ms |

All remaining read/write/directory counters and errors are retained per case in the evidence.
A thrown stat can be an expected absence probe, not a test failure.
Async durations and high-level private-read/create/lease/navigation durations overlap; **do not sum them into a causal decomposition**.

Synchronous file/directory fsync boundaries accumulated18.530s wall time but only1.508s process CPU during those boundaries.
Samples observed12 syscall74 (`fsync` on this Linux x64 host),10 `jbd2_log_wait_commit` waits and one `folio_wait_bit_common` wait.
This establishes actual flush-related blocking in this run alongside substantial repeated validation/CPU work.
It does not identify the historical360-create/13720ms delay, prove all non-CPU time was disk wait, or license dropping directory durability/index/lease work.

### Complete writer-preference case

The unchanged assertions passed in12860.443ms, including teardown.
It made995 measured private creates/2218.454ms,17859 private reads/4075.920ms,1838 lease assertions/3796.173ms and72 navigation publications/3821.865ms; those high-level timings overlap.
Lower-boundary observations were1262604 lstats/3604.938ms,1018 file fsyncs/1239.509ms and1540 directory fsyncs/365.119ms.
Its total worker CPU delta was9522.103ms; synchronous fsync-boundary CPU103.032ms.
Two actual SDK children exited/closed0, nonoverlapping: first spawn3752.8ms/close5930.5ms; second spawn8804.5ms/close10105.9ms, relative to case entry.
Parent assertions retained completed older work and blocked stale younger work with no children; final owner stopped, writerPending0, pending original IDs empty and all scheduler counts0.

This resembles the old *isolated passing* execution in cost scale, not the old full-file failed partial trace.
It neither repairs that failed execution nor proves a cold-cache, disk, CPU or process-interference explanation for it.
Current early/late per-call stat costs remain similar; different case workloads alone make raw early/late case durations incomparable.

## Fixture teardown: actual retained resources, not assumed causality

All29 launched SDK children have original `exit` and `close` observations:21 exit0, one intentional exit1 and seven intentional SIGTERM/null-exit cancellations.
All31 provider listeners recorded their fixture close begin/end; no SDK child remained unclosed at its case teardown.
At final observation all tracked original/report IDs and observed async-IO pending counts were empty.
Those facts do **not** prove every scheduler episode or transport was cleanly released.

- Stop reported stopped/known for22 cases and quarantined/uncertain for9 (11,13–19,31); all reports had process/auth/storage pending0.
- Case11, the intentionally stalled-journal Cancel control, entered teardown with **two writer jobs pending**.
  Stop then reported quarantine; its final scheduler retained one episode, one queued assignment and two reservations.
  The case body had joined its write/native boundaries, not the scheduler episode's whole completion.
- Case19 retained its intentionally unknown episode, one queued assignment and one reservation; case31 retained its publication-conflict episode.
  These must not be cleared or relabeled clean merely for test teardown.
- Late filesystem calls retained originating contexts11,13–19:13962 observed calls,41.784ms combined API elapsed.
  Most were reads/stats; case19 also had one file and two directory fsyncs.
  No late SDK spawn was observed.
  These measurements expose some prior-case work, but do not identify every late call's stack or explain multi-second historical delays.
- Resource snapshots accumulate with quarantined fixtures.
  At file end they contain10 TCPServerWrap and10 Timeout entries, versus no TCPServerWrap and one Timeout at first case entry.
  Counts include current/closing handles and runner timers; they are not an exact leak-object identity proof.

The source explains why **transport teardown is not guaranteed by the current fixture**: `test/service-scheduler.test.ts` only awaits `h.owner.stop(5000)` after its provider close.
`src/service/owner.ts#drain` returns quarantined before `closeListener` when uncertainty is retained.
`src/service/host.ts` connects `quiesce` only to HTTP, and only `closeListener` calls `live.close()`/`http.close()`; it does not yet compose `TaskActions.quiesce()`.
`src/service/http.ts#quiesce` does not clear the heartbeat or close the server; `closeTransport` does.
That is a demonstrated fixture teardown/qualification gap and an already-open host-composition boundary, **not a newly proved product correctness defect or the cause of the old11 failures**.
Original runner exit0 is not proof that Vitest's worker naturally drained these retained handles; the supervisor did not observe that worker's independent native wait result.

## Current machine/process observations

Before, after original runner exit, and after the additional2-second observation, selected same-user Node/Bun/Vitest/Chromium lists were empty.
During the run the observer found only the owned runner tree in those categories, at most four simultaneously selected processes;31 sampled identities include29 SDK children plus runner/worker.
There were no concurrently launched research/build/test commands from this session.
This is bounded sampling and category selection, not proof that other processes/users/short-lived work could not consume machine resources.

Available RAM ranged68141644–68970872KiB; Dirty1944–7976KiB, Writeback0–200KiB.
Available disk bytes805165375488→805109862400, inodes59656771→59644468.
Root-partition counters advanced50770 writes,1438872 written sectors and18468 write-ms; no reads advanced.
These are **machine-wide** disk deltas, not exclusive attribution to Cadence or proof of contention.
Supervisor CPU was4.962s over its complete observation/serialization lifetime; instrumentation overhead is real and has no paired uninstrumented measurement in this assignment.

## Cases, verification and next step

The evidence lists every exact case name/outcome/duration and its prior outcome.
All31 passed this time; the old failures were cases1–7 and9–12.
No old failure, deadline or assertion was weakened or rewritten.
Eight diagnostic controls across two files passed; the earlier overlapping eight-case run is not added again.
No-emit TypeScript and scoped Biome checks passed; two pre-existing scheduler template-string informational suggestions remain.
Initial harness-only type/lint failures are retained in the evidence.
No whole verify/build/pack/browser/terminal/provider/platform acceptance was run or inferred.

**Minimal next step:** isolate and correct the **test fixture's retained transport teardown**, not scheduler/storage performance.
In a separately scoped focused control, preserve the first quarantined Stop report and all fences/native/results, then explicitly observe original closure of only fixture-owned live/HTTP transports; establish case11's scheduler-versus-writer completion distinction.
Do not turn pending0 into successful Stop, release locks, discard retained uncertainty, add waits to existing assertions, change directory durability/index policy or relax budgets.
The public `live.close()` and `http.close()` seams already exist; no production spawn/storage abstraction is needed.

No production repair is justified by this diagnostic pass.
The earlier11 failures remain unexplained; tracing this new pass cannot supply their missing fsync/CPU/resource data retrospectively.
Keep the accepting host closed and retain the separate checks/review/current metadata/original Stop, W1/W5/W6/W7 integration and distribution gates.
