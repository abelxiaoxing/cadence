# Private Read Cost — Main-Owned Narrow Handoff

## Observed Evidence, Not Historical Attribution

The latest instrumented unchanged writer-preference case failed at20s while making progress.
It measured17,400 private selected reads (inclusive8036ms),1,798 lease assertions (inclusive6024ms), and71 navigation publications (inclusive5839ms).
Inclusive counters overlap and cannot be summed.
Two native workers closed zero; no original recording job reached its5s stall.
This does not establish the precise cause of older failures or a universal performance guarantee.

## Concrete Source Candidates

`PrivateFiles.directory` currently calls `safeDirectory` for the namespace and each successive private component.
Each `safeDirectory` walks every ambient ancestor again, yielding quadratic repeated readonly ancestor inspections inside one synchronous path validation.
Each private ancestor still needs its own mode/uid validation.

`PrivateFiles.read` checks independent maximum size and exact before/opened identity, then calls `readBounded(path, maximum)`.
That helper allocates maximum+1 despite the outer operation already selecting an exact size and requiring unchanged final descriptor/path metadata.
Registry maximum can be1MiB for a much smaller actual file.
These are inspectable work patterns; a controlled counter/allocation fixture must demonstrate them before claiming a repair.

## Assigned Minimal Implementation

One editor may change `src/task-store.ts`, `src/service/private-files.ts`, focused tests and canonical generated bundles.
Do not change scheduler topology/budgets, indexes, effect-boundary lease assertions, reporting/settlement, task data or publication semantics.

1. Add a narrow synchronous existing-directory inspection hook to the existing shared `safeDirectory` traversal, default behavior unchanged for legacy callers.
   Use it only for the readonly `PrivateFiles.directory(...,false)` branch so one full ambient traversal also validates each selected private ancestor's directory type/mode/uid.
   A missing child must not hide an unsafe existing private parent.
   Do not use string-prefix containment, cache across calls/awaits/effects, follow links or omit any ancestor.
   Preserve the existing stepwise create=true behavior and its checks before each directory-creation effect.
2. In `PrivateFiles.read`, pass the selected observed byte size to the inner bounded reader, while retaining the independent caller maximum, exact before/opened/final descriptor and selected-path checks, no-follow/hardlink/private-mode policy and original returned hash/stamp.
   Growth, shrink, replacement and identity changes must still refuse; no smaller accepted file limit or partial-success read.
3. Retain the inner reader's full pre-open ancestor traversal and every actual mutation's existing lease revalidation.
   This is not directory CAS or hostile change-and-revert protection; neither old nor new code promises that.

## Required Controls and Measurement

Demonstrate old repeated-walk/allocation work with real private files and bounded test counters, then test the changed implementation.
Cover missing/unsafe ancestors, namespace boundaries, links/hardlinks, modes, exact max/max+1, empty/growing/shrinking/replaced files and unchanged bytes/hash/stamp.
Confirm create=true still refuses unsafe parents before making descendants.
No diagnostic callback may become an awaited lifetime, unbounded retained trace or secret log.

Measure the complete original preference case on changed production source, keeping its exact20s/15s/8MiB100ms/5s limits, topology, guards and assertions.
Keep the failed baseline receipts failed; a fresh pass validates current bytes, not old causes.
Run affected owner/private/store/history/capture/native controls and independent review before claiming this cost correction accepted.
No cleanup, real credentials/deployment, dependency changes, Git mutation, production admission or unrelated frontend edits.
