# W2 relocation/network/capability independent review

## Disposition

**Accepted for this first slice after one fixture failure-path fix.
No remaining in-scope findings.**
W2, the service integration and the complete product remain open.
No producer v2 cutover or package acceptance is implied.

Resolved the active task through `task.py current --source`; read the child manifests/artifacts, curated specs/research, shared-editor handoff, relocation identities, parent PRD/design/plan and both mandatory appendices.
Reviewed actual maintained JS/declarations, all three shims/facade, network extraction/runner, dual-lane vectors, capability tests/helper and installed public SDK declarations/implementation.
Read the official SDK/message/session documentation and relevant SDK examples; the installed 0.84.3 public APIs, not newer global examples, govern this fixture.

## Finding fixed

The capability helper's original `finally` called both unsubscribers and then awaited abort/dispose without independent error containment.
A synchronous unsubscribe error could skip all subsequent cleanup; an abort rejection could skip dispose.
Either could escape as a raw exception rather than a fixed secret-free failure.
This is a **fixture failure-path defect**, not a demonstrated production-worker defect.

Changed only:

- `test/helpers/worker-capability-child.mjs`: independently start and immediately handle all four cleanup attempts; retain fixture-only attempted/settled/failure masks; emit fixed cleanup failure text and native nonzero without projecting exception properties.
  The bounded observation on stdout is explicitly not a worker final/success frame.
- `test/worker-public.test.ts`: add three narrow cleanup fault controls after genuine SDK observations: synchronous unsubscribe throw, asynchronous abort rejection and asynchronous dispose rejection.
  Each injected error contains the fabricated canary.
  Require all four attempts/settlements, exact failure mask, raw canary absence, original exit1/close1, both EOFs and no force-stop.
  Existing normal modes still require exit0/close0 and empty stderr.

The masks are **fixture-only**: first unsubscribe1, second unsubscribe2, abort4, dispose8.
They are not the production worker diagnostic mask.
Fault injection occurs after the corresponding genuine public cleanup operation; these are controlled error-handling regressions, not spontaneous SDK cleanup failures.
Existing 20s test/15s child budgets remain unchanged.

## Relocation and declarations

- One portable executable core/domain/capture closure remains in `src/worker-public.mjs`, with no imports or Node/Pi/React runtime dependency.
- `src/worker-public.d.mts` remains the sole declaration owner.
  It has no imports, `any` or shim cycle.
  An independent strict standalone TypeScript check with `skipLibCheck:false` returned zero diagnostics.
- All three TS paths are explicit value/type re-exports only.
  History/budget/ports still consume that implementation; facade/error-class/constant/function identity tests pass.
- Independently compared the maintained JS AST against erasure of the retained local pre-relocation concatenated TS, and the declarations against its emitted declarations.
  Both are equal, retaining literal/identifier values while ignoring trivia.
  The temporary reference is supporting local evidence, not a newly recovered Git baseline for untracked W1 files; its exact hashes are recorded in [equivalence.json](w2-review-checks/equivalence.json).
- The shared suite runs the same 114 case bodies in two entry lanes, 228 tests.
  The direct lane overlays relocated exports only; history/budget/admission/client implementations retain their actual owners.
  The checker changed no original vector body or wrapper.
  A separate ordinary native Node process imports only a copied maintained `.mjs`, with no TS tree/loader.
- Every initial relocation identity matched at review entry.
  All production, shared-codec and shared-vector hashes remain unchanged by this review.
  Original freeze/relocation records were not rebound.

## Network and native runner

Independently compared the extracted bodies against `git show HEAD:src/subagent-process.ts`, whose hash matches the recorded pre-extraction identity.
After removing only import/export/type syntax, the network bodies are AST-equal.
The remaining runner AST is also equal after excluding the extracted declarations and their new import/re-export.

Consequently there is no new route parser or policy drift: DIRECT, validated exact proxy pair, raw URL/descriptor/scoped facts, capability checks, known-route redaction, serialization/freshness checks and the single native launch sequence remain intact.
Focused tests still enter through production `runWorker` and exercise these boundaries.
General environment, parent checks, stdin demand, cancellation/native close, stock worker and auth-file refusal behavior remain unchanged.

`safeChildEnv` is the same function through both public import paths.
`sdk-network.ts` is selection only, not service-startup attestation.
W1 model/auth code was not edited; configured service-auth routing remains refused pending its actual startup composition and qualification.
This review does not establish Node22 routing qualification.

## Actual SDK evidence and limits

Environment: Linux x64, `/usr/bin/node` v26.7.0, Bun1.3.14, Vitest4.1.10; installed coding-agent/agent-core/pi-ai0.84.3.

The guarded native fixtures use public `createAgentSession`, in-memory stores/settings/session, empty resources, numeric-loopback official adapter, fabricated auth and controlled tools/listeners.
No real profile, provider account, install, deployment, fetch/TLS replacement or private SDK import was used.

The original three modes still establish awaited assistant/end listeners, subscription order and prompt/idle settlement; sequential one-tool activity versus a parallel two-tool differential; three overlapping synchronous updates; and controlled two-slot overflow requesting nonawaited public core abort without self-settlement deadlock.
All final native receipts retain ignored stdin, both EOFs, no force-stop, empty home/work directories and raw canary absence.
Overflow remains a failed model operation even though the assertion fixture exits0.

These are controlled fixed-value listener-ingress counters, **not** an actual v2 producer, arbitrary-object sanitizer, durable W3 sink, real slow-disk experiment, source-wide backpressure or global SDK/provider memory bound.
Public subscribe cannot reserve before an earlier internal listener yields.
Those actual producer/source accounting gates remain W2 work.

## Verification

Fresh commands and final receipt hashes are indexed in [results.json](w2-review-checks/results.json).

| Gate                            | Result                                                                |
| ------------------------------- | --------------------------------------------------------------------- |
| Focused capability file         | 8 passed, 0 failed, 0 skipped                                         |
| Required eight-file focused set | 940 passed, 0 failed, 0 skipped; 170.32s                              |
| `bun run check`                 | Passed: JS syntax, canonical operator bytes, whole TypeScript no-emit |
| `bun run check:agents`          | Passed                                                                |
| `bun run lint`                  | Passed                                                                |

The eight-file command is unchanged from the implementation handoff:

```sh
bun run test -- test/service-contract.test.ts test/service-owner.test.ts test/service-auth.test.ts test/service-model-context.test.ts test/lightweight-store-controller.test.ts test/lightweight-process-diff.test.ts test/lightweight-sdk.test.ts test/worker-public.test.ts
```

940 includes the original937 cases plus three injected cleanup regressions.
The earlier standalone eight-case rerun overlaps and is not added to that total.
Native nonzero in the three negative controls is expected and independently asserted; it is not relabeled successful cleanup or inference.
No full suite, pack/extraction, service/client cutover, paid-provider or nonhost qualification was run.

The prior failed lint/newline receipt remains historical.
Main's already-present task JSON newline correction was not edited here; no logical task status, package/lock/spec, W1 owner/model/HTTP, Git state or unrelated bytes were changed by the checker.

## New source identities

| Path                                       | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `test/worker-public.test.ts`               | `85de74375631d26991fe70eaacff764693a561bd9697f415c1bf7ec5c256804e` |
| `test/helpers/worker-capability-child.mjs` | `91020d75486750635633ddce1436adf39421946f160cdbc94c9212f364f9a221` |

The original relocation identities and all old logs/receipts remain unchanged.
New review artifacts are only this report and `research/w2-review-checks/`.
Maintained product/spec/distribution updates remain with their assigned integration owners, not silently added to this slice.
