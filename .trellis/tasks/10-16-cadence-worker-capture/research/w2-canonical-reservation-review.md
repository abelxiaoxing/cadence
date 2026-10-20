# W2 canonical reservation — independent review

## Disposition

**Accept the demonstrated over-reservation correction; no blocking issue remains in this bounded review.**
Added six regression cases for reservation lifetime/order and fixture noninterference; no production changes were needed.
The original native event35 failure remains unexplained.
This is not W2, parent, product or distribution closure.
The separate W3 multisegment metadata timeout remains failed/open and was not rerun here.

Active task resolved to `.trellis/tasks/10-16-cadence-worker-capture`.
Reviewed the child context/artifacts, complete parent PRD/design/plan and both appendices, W2 handoff/evidence, W3 readonly diagnosis, applicable specs, installed public declarations and official SDK/message/session documentation.
Inspected the current tracked diff and untracked owners without changing Git state; reviewed the narrow production diff against the handoff's hash-verified frozen copies rather than attributing unrelated repository dirt to this repair.

Execution evidence root (**E**): `/home/mirako/abel/.cadence-w2-canonical-review-uftckHRI`, mode0700, filesystem reported `ext2/ext3`.
Every test/check/format command explicitly set TMPDIR/TEMP/TMP to E. Initial readonly context inspection used a newly allocated0700 `/tmp/cadence-w2-review-NL6Z45j8`; it was discovered to be tmpfs and left untouched before any test or edit.
The initial task-path lookup preceded that allocation.
No real credentials, installs, deployment, nested agents, repository Git mutation, task-state changes, shared-file edits or manual cleanup occurred.
Node was `/usr/bin/node` v26.7.0, Linux x64; installed Pi peers0.84.3, Bun1.3.14, Vitest4.1.10.
Exact commands, source/peer/native-receipt/log hashes and preserved development failures are in [review evidence](w2-canonical-reservation-review-evidence.json).

## Reservation audit

- The canonical detail no longer prepays1MiB throughout all awaited frames.
  The real `CaptureQueue` still charges the shared text/literal prefix allowance; capacity and control headroom are unchanged.
- Object traversal reserves its table before push/sort and grows it before each retained key.
  Key sanitization, escaped output and comparison retention obtain a separate lease before copying.
  The next comparison lease is acquired before releasing the old one.
- String slices reserve bounded expansion before slicing/projecting.
  The lease survives each yielded output and the consumer's awaited write; remaining literal/heuristic prefixes stay covered by the detail prefix lease.
- Nested `yield*` retains ancestor tables/comparison keys.
  Normal completion, iterator return, thrown opaque values and capacity refusal unwind only obsolete lexical ownership.
  No iterator cleanup refunds an original emitter write or unrelated input lease.
- Original stdout callbacks retain their own encoded charges beyond the unchanged5s reporting timeout.
  Update ingress remains charged until original subscriber settlement; no serialization/pacing, timeout refund, spill, increased quota or no-op reservation was introduced.
- Partial JSON and owner lexical behavior remain unchanged.
  Large/invalid/colliding keys, depth/accessor refusal, one-byte literal expansion, UTF8/secret splits, independent decoded owner equality and real capacity/control refusal are covered.
- These are conservative Cadence retention/expansion charges, not a byte-exact V8/SDK heap or universal source/privacy bound.
  Synchronous source validation is not a claim to bound every engine allocation.
- The observer uses fixed bounded facts and own-data event/descriptor inspection, does not inspect opaque exceptions, and preserves original promise/tool-return/lease/throw identity in the tested seams.
  The native preload retains the unchanged bash guard and returns the original child; receipts are observations, not new execution or settlement authority.

## Fresh discriminating controls

The frozen module/helper/peer hashes and all five historical W3 log hashes matched the handoff before execution.
`01-before.json` and `02-after.json` are injected Writable controls using exported Cadence classes, **not native reproductions of event35**.

Before:

- Serial: three fulfilled originals; no failure; all charges released.
- Overlap: first fault `queue-reserve`, requested1114112 data bytes, existing2229750 bytes/7 slots, three canonical details, three updates, three ingress copies/726 bytes and two pending writes/800 bytes.
- 2229750 +1114112 exceeds the unchanged3145728-byte data ceiling.
- After the rejected original settles,2229508 bytes and two ingress leases remain until original callbacks settle.
  Failure control still fits; no final success is manufactured.

After:

- Both serial and overlap complete three originals, with exact decoded update content and valid associations/final selection.
- Held overlapping charge198534 bytes includes three ingress copies and three pending writes/1200 bytes; all return to zero after originals settle.
- High-water3145728 includes the existing temporary `reserveSource()` full-capacity measurement reservation; it is not a measured3MiB retained output body.

## Review fixes and unchanged native positive

Only test/research files were authored in this review:

- `test/worker-canonical-budget.test.ts`: five new cases — nested return/throw, pre-push table growth with pre-sort refusal, pre-copy slice refusal preserving unrelated input, and depth/accessor refusal.
- `test/worker-accounting-observer.test.mjs`: one new fixture-only identity/nonthrowing observation case.
  It exercises actual exported JS classes without widening frozen production declarations.
- This report and its new evidence index.

Final focused execution includes the unchanged actual bash command/full-result assertions, readonly and invalidUTF8 cases, actual public SDK subscription/overlap controls, canonical/protocol/redaction/recording negatives, legacy native process/SDK regressions and shared contract vectors.
All native SDK test20s/child15s limits, production first-fault classification and bash guard remain unchanged.

Final positive receipt `cadence-w2-producer-vg5cAO.native.json`: two model requests,77849 observed raw bash bytes, actual shell exit0/close, delivered stdin, valid final, worker completed/exit0/direct-child-close,25 entered/settled updates and zero remaining queue/ingress.
The existing assertion still checks the entire77834-byte redacted tool result and empty successful stderr/working directory.
Readonly receipt `cadence-w2-producer-FyYZS2.native.json`: one request, completed/exit0/delivered stdin/valid final.
Its absent bash observer remains unavailable, not fabricated zero observations.
InvalidUTF8 receipt `cadence-w2-producer-Bzh8so.native.json`: one request, worker failed/exit1/delivered stdin/missing final, despite shell exit0/close.
Observer first=null does not identify the internal decoder fault or mean no production failure; native cleanup remains unconfirmed in that projection.

No new native bash failure occurred.
Public BashOperations original promise identity and individual worker EOF facts are not separately attested by these fixture receipts; no inference from shell/worker close replaces them.

## Verification

- Final focused command (`12-final-focused.log`): **708 passed /0 failed /0 skipped,8 files**.
- Selected actual W1 preparation → W2 SDK → W3 durable writer >2MiB/no-viewer case (`08-native-history.log`): **1 passed /0 failed /41 filtered skips**, original test budget unchanged.
  The other history cases were deliberately not selected; this is not a whole-history PASS.
- `bun run check`: exit0 (`11-check.log`).
- `bun run check:agents`: exit0 (`13-agents.log`).
- `bun run lint`: exit0 (`15-lint.log`), retaining two unrelated pre-existing informational `useTemplate` notices in `test/package-audit.test.mjs`.
- New evidence was formatted before whole lint; the report also receives an explicit nonexcluded Markdown check.

The earlier708-case7-file run and18-case development runs overlap these tests; do not add them to final totals.
The8-file run moved the same observer case into JS, not an extra case.
Preserved review-development failures: the initial Array.push spy interfered with its own call recording (17 passed/1 failed); replaced only that fixture probe with synchronous transparent wrappers.
Initial formatting found two implicit-any variables; explicit unknown types fixed them.
Initial typecheck rejected the JS observer import/internal detail declaration and an incomplete fabricated result; the observer control was moved to a normal JS fixture test with a complete result, without casts, suppressions or frozen declaration edits.
No production repair was hidden in those changes.

## Exact reviewed source identities

Production identities are unchanged from the implementation handoff:

```text
src/worker-capture.mjs
c85677217edfabef622656950b4f6d1f11e6f06cae1985ea8b218d2fc88fbe1d
src/worker-redaction.mjs
cc453cc09ac8c8c86a35f9aa762f746da5eaa43e48c91c55e3c9a2675b09eafc
src/worker-redaction.d.mts
c4b8a29a362dab1c595a8037b65dfa5f4defeb18b39e639dd5b6f91ea185b775
test/worker-canonical-budget.test.ts
3cf670611b2cce5e37ae65cdb374a17a57d601007a7d9fbb6e2cc2894bffcff9
test/worker-accounting-observer.test.mjs
c1e6f835534ccd3711962572bec6a63292ee2071dfda48032014203ab9217eb4
```

The evidence index binds the remaining production closure, fixtures, peers and native receipts.

## Boundaries left open

No whole-history rerun, W3 timeout retry, full package/distribution, clients, W4 scheduling, platform/physical-human or paid-provider qualification was performed.
Preserve the previous1234/1 failed integration command and the original event35 failure.
The deterministic arithmetic proves this over-reservation defect and its correction, not the historical failure's cause.
Main may consolidate this review and continue W4 while separately handling W3's timeout; it must not mark W2/product complete from these controls.
Maintained spec edits were frozen: the pre-copy reservation/original-settlement lesson is captured here for main's later deliberate spec update.
