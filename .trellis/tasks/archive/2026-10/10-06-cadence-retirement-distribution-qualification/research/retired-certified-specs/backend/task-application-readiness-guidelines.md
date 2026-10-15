# Application Authority and Readiness Declarations

## 1. Scope / Trigger

The user-approved A+B+C continuation supplements [Execution Admission](./task-execution-admission-guidelines.md).
Only the original admitted G3 reader supplies retained declarations and live application authority.
Supported private writers remain excluded; unrelated external private-history corruption may wait until the next retained strict transaction proof.
This authority change is not native-query parity, fewer input observations, passing clocks or release qualification.
[Publication](./task-publication-admission-guidelines.md) and [Readonly Snapshot](./task-read-snapshot-guidelines.md) keep their separate boundaries.

## 2. Signatures

- Captured `checkTaskExecutionApplicationAuthority(selected, held)` calls original `TaskStore.checkExecutionApplicationAuthority(selected, scope)`.
- Captured `checkTaskExecutionApplicationInputs(selected, held)` calls original `TaskStore.checkExecutionApplicationInputs(selected, scope)`.
- Private `#executionApplicationAuthority` matches the engine-owned selection to the original reader and returns only to that store's continuation.
- `prepareExecutionGraphReadiness(unknown)` / `assessPreparedExecutionGraphReadiness(root, data, facts)` share the strict graph observer.
- `prepareExecutionInputDeclarations(plan)` / `observeExecutionInputDeclarations(data, options)` separate immutable declarations from fresh graph/timing/capability observations.
- `prepareTaskExecutionInputs` retains that child; `assertTaskExecutionInputsCurrent` reobserves its complete original domain.

These data helpers confer no approval, reader acquisition, proof, apply permission or closure.
No new schema, module, controller, mode, public skip flag or persistent state is introduced.

## 3. Contracts

### A: exact current application authority

Only `WorkflowEngine.#assertLaunch`'s two application brackets and its seven already-named materialization binding calls use the new authority port.
The finite original application diagnostic has74 full G3 selections: replace49, retain25 (one explicit entry plus24 inside eight original transaction proofs).
`checkTaskApplicationAuthority`, `checkTaskApplyAdmission`, independent manifests/artifacts/seals/reports/producer membership, G4 leases/spending and pre-write/pre-result proofs stay strict.

Match exact revision/hash, approval, prepared metadata and plan bytes to the admitted selection; fresh binding/head/current indexed bytes still bracket guards.
The engine's synchronous defensive copy before callbacks/deferral and intrinsic bounded scope copies remain mandatory.
Missing admission uses strict selection without initializing against partially applied files.
Foreign, closed, initializing or mismatched owners refuse; never catch a conflict into fallback.
No SQL snapshot crosses an await or callback, and no historical permission verdict is cached.

A real `beforeFileMutation` callback may commit unrelated historical corruption that the live authority route does not detect.
The next original strict transaction proof must reject it before the target effect; standalone-port refusal alone does not prove this placement.
Discovered native failures still refuse; removed-only historical scans have no immediate detection guarantee.

### B: immutable declarations, original dynamic order

One original reader retains newly owned deeply frozen records/arrays/scalars, never frozen Map/Set shells, transient getters or caller plan aliases.
Graph indexes intentionally retain the first duplicate; timing maps retain the last.
Graph omits nonbehavior Red while timing visits all declared phases; preserve those distinct semantics.
The existing64-entry/4-MiB codec budget and task/output/plan/source/artifact bounds are unchanged.
Original close clears declarations; an uncertain first close remains the exact unknown original.

Strict unknown wrappers prepare graph, timing and capability groups at their original boundaries.
Transient timing getters preserve lazy construction/error order only within that strict call; materialize plain owned data before retention.
Construct path operations at the original point, then always observe availability even when survival is false.
Observe valid output safe paths before checking declared-test membership.
Default AGENTS native I/O still uses its original default observation route.
All capability occurrences remain fresh and ordered: `P+3N+3+A`, normally `5N+3`; equal contracts are not deduplicated.
Native inputs, negative search/membership, manifest/scripts/locks/config, environment, safe ancestors and complete executable bytes remain fresh.
No old filenames, stat/image digest, readiness result or PASS survives as currentness.

`structuredClone` does not preserve null prototypes.
Every dictionary lookup must use own-key membership, including graph `outputs`/`outputPaths` and timing `outputByPath`.
Missing `toString`, `constructor` or `__proto__` is not a declared producer.
Return fresh nested diagnostics; changing one result cannot mutate another observation or retained declarations.

### C: equivalent zero-owned-effect input continuation

`DurableWorkflowComposition.assertTaskInputsCurrent` first compares the actual resource plan to selected bytes and freshly calls original `nativeOwnedInputs`.
Only its actual empty result selects the captured input port.
The matching original reader supplies declarations, not a successful observation; live exact authority brackets every fresh input observation.
Missing admission still invokes original `assertTaskExecutionCurrent(selected, scope)`, without creating a reader.
Nonempty journal-owned input handling remains original `assertTaskApplicationInputsCurrent`.
A prepared/applying journal can have zero owned effects: test the actual returned effects, not journal existence or a mocked array.

Retain all29 input joins and eight native proofs in the finite application diagnostic.
No target-only CAS, executable-path classification, positive digest cache, reduced after-await/pre-write checks or weaker post-apply materialization is permitted.
Untouched business/config edits, current claims/modes/deletion/recreation, independent verification, conditional compensation and original normal closure stay authoritative.
Original5000/1500/60000-ms deadlines, cap4, counts and budgets are unchanged; late original bodies must be awaited and still fail.

## 4. Validation & Error Matrix

| Condition                                                                     | Required behavior                                                     |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Selected revision/approval/prepared/bytes, scope or original receiver differs | Bounded refusal; no weak fallback or new admission                    |
| Current head/revocation/index/counter/plan bytes drift                        | Immediate live refusal                                                |
| Unrelated old-history corruption in pre-write callback                        | Live route may pass; next strict proof refuses before target mutation |
| No admitted reader, partial business files                                    | Original strict builder/authority; no initialization                  |
| Empty genuine journal-owned effects                                           | Fresh declaration-driven inputs; all native observations remain       |
| Nonempty effects                                                              | Unchanged journal-aware input algorithm                               |
| Cloned dictionaries or mutable returned diagnostics                           | Own-key semantics; defensive result copies                            |
| Malformed later declarations plus earlier native faults                       | Original construction, observation, error and diagnostic order        |
| Retained I/O or before/after-close fault                                      | Fail closed; one original close attempt, unknown family retained      |
| Original deadline exceeded                                                    | Failed qualification even after supervised late fulfillment           |

## 5. Good / Base / Bad Cases

Good: own one static declaration child, freshly compare the exact current selection and read complete input/image bytes at every original cut.
Base: a recovery reader lacking admission takes strict routes and never learns a new baseline from partial application.
Bad: bind a different caller graph, treat empty effects as permission, reuse historical PASS, or report fewer static builds as a passing deadline.

## 6. Tests Required

- `task-application-reader` covers missing admission, selected/scope/receiver/closed substitutions, captured methods, one preparation, head/bytes/revocation and strict historical refusal.
- Preserve all46 `task-execution-reader` regressions, including actual caller mutation, initial/derived native traces, copy bounds, physical-writer exclusion and original close uncertainty.
- `task-execution.integration` retains all36 original controls plus genuine callback historical corruption and empty-journal input/error parity.
  The latter must fail with the authenticated no-C native provider, not merely a mocked input list.
  Keep original per-file/CAS/environment/claims/deletion/replay/post-apply checks.
- `execution-readiness-declarations` authenticates original graph/compiler URLs and compares79 cases/3803 ordered projected native records, exact errors and reached default-AGENTS/close faults; no error filtering.
  The projection is stat mode/size/kind and read-byte hashes, not every OS field or physical EIO proof.
  Copied graph dictionaries have separate three-case preimage-red controls.
- Complete graph/property/compiler/timing/capability/continuation/amendment/immutability/native/currentness/resource files and explicit pre-B1/B1-B2/B3 strict oracles remain required.
- One final unprofiled complete engine/execution/lifecycle/departure run and one justified assembled full verify retain original clocks and exact late bodies.
  Separate new126-member body/pin audit, source/extracted native and four production PTYs do not establish manager installation, human/model, Windows or universal release readiness.

## 7. Wrong vs Correct

```ts
// Wrong: structuredClone can turn this into an inherited producer lookup.
const output = outputs[id];
// Correct: plain copied declarations still require own membership.
const output = Object.hasOwn(outputs, id) ? outputs[id] : undefined;
```

```ts
// Wrong: a journal, cached input list or prior successful reader is permission.
if (journalExists) return lastSuccessfulInputCheck;
// Correct: fresh original effects select only the static-data continuation.
const owned = originalNativeOwnedInputs();
if (owned.length === 0) checkTaskExecutionApplicationInputs(selected, held);
else assertTaskApplicationInputsCurrent(selected, held.compilation, owned);
```

Prevention: distinguish logical data reuse, live authority, native fault sites and real transaction effects.
Preserve preimages and exact failing assertions before changing evidence; no overlapping focused totals or unchanged-red retries manufacture qualification.
