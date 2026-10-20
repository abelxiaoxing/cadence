# W4 Model Choice — Independent Scoped Review

## Disposition

**Three reproduced defects fixed; broader verification remains failed.**
The catalog/private-choice/quiescence/revision-floor/typed-transport slice has passing new controls, but this review does not approve W4 or the product.
The frozen12-file regression command returned **617 passed /19 failed /0 pending**.
All19 failures are in unchanged scheduler/human-review scenarios and remain unresolved; they are not declared unrelated merely because their files were unchanged.
Main must investigate them before claiming an integrated passing gate.

Production `modelChoice` and task admission remain absent/null.
The actual immutable-selection TaskActions guard still refuses configuration replacement even when idle.
No current views, nullable action selection, assets/handshake integration or frontend source was implemented.

Loaded task/parent artifacts and mandatory appendices, curated context, current composition contract/handoff/evidence, MAIN decision, applicable specs, public Pi documentation/examples and actual installed0.84.3 declarations/source.
The prior handoff's changed-source hashes matched before review.
No agents, dependency/lock changes, credential/profile access, deployment, task-status edits, Git mutation/status, historical receipt rewrite or cleanup occurred.
Initial readonly context/diff inspection preceded the explicit temp wrapper; every verification/build/diagnostic command used a newly allocated0700 `/home/mirako/abel/` disk root with matching TMPDIR/TEMP/TMP.

## Findings Fixed

### F1 — A different model could replace a stale selected credential source

The native stock-SDK/private-choice counterexample selected a model, changed its fabricated `auth.json` key, then requested a different model with the old choice version.
The previous implementation returned success and retired the prior selection instead of refusing.

`src/service/model-context.ts#replaceSelection` now validates existing selected sources before considering either reuse or replacement.
Changed selected sources refuse without changing selection IDs or the visible config/catalog revision.
The replacement counterexample passes; actual synchronous source/access/busy changes during new-model validation also refuse before installation.
These are private-core calls, not authenticated production HTTP choice acceptance.

### F2 — Freshness invoked a function provider before rejecting it

The SDK's public `getModel` can invoke a registered provider's synchronous `getModels`.
`fresh()` previously checked registered function transports only after that call.
An actual public native-provider registration with an invocation counter reproduced one callback during a supposedly refused freshness check.

The function/configured-extension guards now precede `getModel`, while retaining the later revalidation.
Static `models.json` providers remain eligible; registered transports are refused without invoking their callback through catalog/freshness/unchanged choice.
The test distinguishes SDK registration-time snapshot calls from Cadence read calls.
No `getAvailable`, `checkAuth`, `getAuth`, session or settings construction was added to a read.

### F3 — An unchanged choice incorrectly exhausted the revision counter

A real journal/publication/restart fixture replayed accepted metadata at `MAX_SAFE_INTEGER - 2`, then selected a model at the last representable revision.
Repeating that exact valid choice returned capacity instead of preserving its ID/version.

`src/service/model-choice.ts` now requires revision headroom only for a changed selector.
Unchanged valid selection remains stable; replacement at the ceiling refuses before retiring the active ID or changing visible state.
The constructor's overflow refusal and ordinary safe-integer codecs remain intact.

### Bounded-literal tightening

The catalog's unique-byte counter was correct, but its helper first flattened/spread uncharged intermediate string-reference lists.
It now visits the already validated private snapshot and charges each unique literal before retaining it, without those intermediate lists.
This is a source-backed allocation-order correction, not a reproduced heap-exhaustion claim.
New controls cover duplicate128KiB literals versus distinct values exceeding the unchanged256KiB allowance, scoped-env identifier collisions and ordinary-name header-template literals.
Unsafe/secret-bearing identifiers refuse; they are never redacted into another selectable ID or hashed into a public identity.

## Additional Boundary Review and Controls

- Catalog reads enumerate real configured-source `getModels`, preserve exact API/thinking metadata, expose SDK `max` only as nonselectable, and allocate no candidate selection IDs.
  Capacity is an empty explicit capacity roster, not a clipped complete list; exact selection remains independently validated.
- Existing low-level selection remains internal; the actual host starts with null choice and one runtime/choice owner, without settings/default/first-model fallback.
- New synchronous reentry controls inject an outstanding original, access rotation or selected model-file change during validation, then require no replacement/version change.
- Busy-original tests now begin with an existing selection and require its preservation for auth/work/storage/check originals and owner reservations.
  Actual TaskActions idle refusal and held/queued review barriers are tested separately; no accepting replacement hook was introduced.
- The accepted configuration floor survives a new epoch, legacy metadata admission without resource policy, and a real validated recovery bridge.
  Recovery's absent-PID observation and informed authority are explicitly injected; this is not native crash/takeover qualification.
  Corrupt original bytes refuse and stay unchanged; replay restores no current context or approval.
- Actual raw HTTP response controls accept exactly512KiB and reject512KiB+1 for catalog and choice, before whitespace normalization.
  Existing portable full-Reply limits remain.
- Optional reader/choice ports refuse; real HTTP cookie/Origin/CSRF/attachment/native boundaries reject malformed, mixed-location and escalated requests before the injected choice port.
  The accepting port in that test is deliberately an echo fixture, not the production host.
- Client epoch/access/config/catalog/selector substitution and lost-response controls retain uncertainty with exactly one dispatch, never automatic mutation retry.
- Existing Stop/original guards were not edited.
  Real owner/model/auth/accepted-work/check tests passed within the regression command; broader scheduler/review failures are retained below.

## Executed Verification

Evidence root: `/home/mirako/abel/cadence-model-choice-review-JCuo5WC2`.
The new [evidence JSON](w4-model-choice-review-evidence.json) records commands, original runner PIDs/waits/exits, logs, native receipts, preimages and source manifests.
Observed platform: Linux x86_64, `/usr/bin/node`26.7.0, Bun1.3.14, Pi0.84.3; `/home/mirako/abel` is on `/dev/sda2`.
No numeric runtime minimum or alternate-platform qualification is inferred.

| Gate                                         | Result                                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Initial three native counterexamples         | **3 failed**,23 filtered; original failed receipts preserved                                                         |
| Final model-choice and new boundary files    | **31 +10 passed**, subsets of the failed12-file command                                                              |
| Final12-file affected regression command     | **617 passed /19 failed**, exit1,1007.25s original supervisor wait                                                   |
| CLI scoped command                           | **23 passed /1 deliberately filtered**, exit0; excludes only unchanged retained-history-beyond-read-quantum scenario |
| Web tests                                    | **105 passed /7 files**, exit0; not browser execution                                                                |
| Canonical service generation                 | Exit0; only `src/service-host.mjs` changed bytes                                                                     |
| `check`, `lint`, `check:agents`, `check:web` | Exit0; lint has zero warnings/errors and eight existing informational suggestions                                    |
| `build:web:check`                            | Exit0; two private Vite productions match all canonical names/bytes                                                  |

Final371 executable/config/provenance inputs stayed identical through the regression run, diagnostics and final gates.
Operator/management/web assets remained byte-identical; service-host was canonically regenerated, never hand-edited.
Auth/web adaptation destination files were not changed, so their current provenance hashes were preserved.
No case/native/read/capture budget was raised; the1200s outer tool allowance waited the original1007.25s runner without termination.
The unchanged8MiB history stress suites were not rerun solely for a total.

### Failed broader gate and diagnostic limits

The failed command contains15 scheduler and four human-review failures:20s cases/10s hooks, unexpected quarantine, wait/settlement observations and a cold-lineage assertion.
Its original JSON/log and fixture diagnostics remain intact.
No source inputs changed during the command.

One controlled copied-source comparison ran the first failing scheduler overlap case once on the saved preimage and once on current source, using the same original case/native budgets and existing installed peers.
Both passed (9.00s versus8.81s case time).
That comparison did **not** reproduce or explain the broad-run failure and does not convert the19 failures into passes.
No broad retry, scheduler/history rewrite, deadline increase or retrospective explanation of older failures was performed.
Follow-up requires main-owned diagnosis of the preserved failing scheduler/review scenarios.

Intermediate new-test mistakes also remain preserved: an incorrect throw/null assertion for absent current context, attempting recovery after the fixture had released its required fences, and two header-union TypeScript errors.
These fixture corrections did not weaken product assertions or budgets.

## Changed Files

- `src/service/model-context.ts`: stale-source preservation, pre-invocation transport guard, incremental unique literal collection.
- `src/service/model-choice.ts`: unchanged-choice revision-ceiling behavior.
- `src/history/writer.ts`: getter documentation only; floor semantics unchanged.
- `test/helpers/service-model-choice-child.ts`, `test/service-model-choice.test.ts`: native private-core counterexamples and additional controls.
- `test/service-model-choice-review.test.ts`: new disk/HTTP/transport/floor controls.
- `test/service-accepted-work.test.ts`: immutable-owner and held/queued barrier control.
- `src/service-host.mjs`: canonical regeneration.
- This report and its new evidence JSON.

No shared DTO/wire schema, HTTP/auth implementation, scheduler/action implementation, check/native runner, dependency, frontend source, maintained spec or prior evidence body was changed.

## Remaining Gates

1. Resolve the19 preserved scheduler/human-review failures before an integrated passing claim.
2. Compose actual nullable choice/current metadata with the one TaskActions; do not remove its idle refusal prematurely.
3. Implement actual current/change/active metadata and W6 consumers, independent build compatibility and package-relative assets.
4. Only then open model-choice POST/task admission and qualify the authenticated full host workflow.
5. W1 proxy/informed recovery, W5 native cutover, full W6 browser and W7 distribution remain open.

The21 native model-choice scenarios use actual SDK/disk/readonly HTTP and private choice; busy/reentry/recovery authority barriers are labeled injections.
They are not accepting HTTP model selection, full host/browser workflows, extracted-package, paid-provider, physical-human/device or alternate-platform evidence.
No W4 completion, release or product acceptance follows.
