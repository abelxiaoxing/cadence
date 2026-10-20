# W2 codec/network relocation and SDK capability handoff

## Disposition and scope

The assigned first slice is implemented; W2 and the integrated product remain open.
No v2 producer cutover, accepting history sink, scheduler, service-startup routing, HTTP/model-context change, package/lock/spec edit, install, commit or task-state change was made.
Pre-existing archive and source work remains untouched.
The main-assigned editor transfer is `shared-editor-handoff.json`; W1's old acceptance and freeze hashes remain historical and unchanged.
[New relocation identities](relocation-identities.json) bind before/after source bytes, including unchanged history, budget, ports and stock worker.

Loaded the child manifest/artifacts, complete parent PRD/design/both appendices/plan, applicable current specs, W1 revision/acceptance/model handoffs and installed public declarations.
Read complete official SDK/message/session/configuration/model/provider/settings documentation and the relevant SDK examples.
The installed coding-agent/agent-core/pi-ai declarations and actual 0.84.3 runtime govern the tests, not newer global documentation.
No actual user credentials or profile were read.

## One executable codec and declaration owner

- `src/worker-public.mjs` now owns the complete portable core/domain/capture executable dependency closure: constants, fixed errors, strict own-data and duplicate-key JSON primitives, all former domain/capture decoders, ordering, associations and settlement predicates.
- `src/worker-public.d.mts` is its sole public declaration owner, including generic signatures and all discriminated DTOs.
  It contains no imports, `any` or circular reference to the TS shims.
- `src/service/contracts/{core,domain,capture}.ts` retain their exact export surfaces as explicit value/type re-exports only.
  They have no executable decoder bodies or local DTO definitions.
- `src/service-contract.ts` remains the public facade.
  Its export surface is unchanged; only its ownership comment changed.
  History and budget consume the same JS implementation through the shims, without semantic/import edits.
- The initial move used local TypeScript erasure and declaration emission in private temporary space.
  The adopted JS and declarations are maintained source, not generated distribution outputs, a second TS implementation or a build-time source fallback.
  No generator/framework was added.

Exact primary SHA-256 identities:

| Owner                     | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| `src/worker-public.mjs`   | `7b9db72f4ec299d339bd84b68f16b2c5c31ff0596d567c752d5a9c3fe2680ca3` |
| `src/worker-public.d.mts` | `bbf12619e4984fa0d4de830c0a89504c512cfa2b309f239bb83635a2fd19346e` |
| `src/sdk-network.ts`      | `8284b710cd419d0d87639bcb4931a989dde06a797aea5405e2a2994f61ef9468` |
| `src/subagent-process.ts` | `dd79396eef36d2f621fc5e19b183bdd974a9e300d536da01920de94fee81d984` |

The new identity record contains the remaining facade/shim/test/fixture hashes and original W1 identities.
A normalized TypeScript AST comparison of initial erased JS versus maintained JS is equal; the extracted network bodies also compare equal after the explicitly added exports/type erasure.
This mechanical check ignores comments/formatting/nonsemantic list punctuation; it is supporting evidence, not runtime qualification.

## Shared route policy without service enablement

`src/sdk-network.ts` owns `safeChildEnv`, `networkSnapshot`, `scopedNetwork`, `sameNetwork`, `sdkNetworkEnvironment`, and the readonly `NetworkSnapshot` type.
`safeProxyURL`, finite selected keys and descriptor facts remain internal to that owner.
`scopedNetwork` accepts an object instead of importing `WorkerRequest`, avoiding a runner dependency; its exact descriptor reads and refusal behavior are unchanged.
`subagent-process.ts` imports the helpers and re-exports the identical `safeChildEnv` function for existing consumers.

The runner's capture → auth-file refusal → selection → known literals → unchanged serialization → serialized/scoped/ambient freshness → single native launch sequence is unchanged.
No native runner, general env allowlist, parent-check environment, stdin demand, protocol/output limit, cancellation timer or stock SDK-worker body changed.
DIRECT/VALIDATED_PROXY, URL/raw-authority policy, duplicate cases, capability checks, NODE_OPTIONS policy, scoped-only refusal and whole-route RAM redaction literals retain one implementation.
The route tests still enter through production `runWorker`; no alternate launcher or test-only selector replaces it.

This is selection, not a service-startup attestation or a complete service environment builder.
The returned worker environment deliberately contains the existing child guard/narrow allowlist.
W1's model-context configured-route refusal remains in place until its CLI can establish and qualify the selected pre-import service-auth route.
No parent dispatcher, global fetch, TLS or service-auth fallback was introduced.

## Before/after semantic vectors and verification

Logs and native receipts are under `w2-checks/`; [results.json](w2-checks/results.json) indexes commands, outcomes and evidence limits.

| Run                                                              | Actual result                                                                        |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Before edits: contract/owner/auth/model/legacy-store, five files | 405 passed, 0 failed, 0 skipped                                                      |
| Relocated contract vectors                                       | The same 114 cases execute through the facade and direct maintained JS: 228 passed   |
| Final focused eight-file run                                     | 937 passed, 0 failed, 0 skipped; 165.71s                                             |
| Whole `bun run check`                                            | Passed: JS syntax, unchanged canonical operator bytes, package TypeScript no-emit    |
| `bun run check:agents`                                           | Passed                                                                               |
| Whole `bun run lint`                                             | Blocked by missing final newline in active `task.json`; task metadata was not edited |
| Separate whole `rumdl check .`                                   | Passed, 42 files                                                                     |

Final focused command:

```sh
bun run test -- test/service-contract.test.ts test/service-owner.test.ts test/service-auth.test.ts test/service-model-context.test.ts test/lightweight-store-controller.test.ts test/lightweight-process-diff.test.ts test/lightweight-sdk.test.ts test/worker-public.test.ts
```

The second contract lane overlays only the relocated core/domain/capture exports; history/budget and injected owner/client tests retain their real owners.
Every original semantic/negative test body remains; no assertion was relaxed or protocol/flood/proxy fixture changed.
Identity tests verify all shim exports and shared facade exports refer to the identical JS functions/constants/error class, not merely equal results.
An ordinary native Node process also imports a copied standalone JS codec from a directory containing no TS tree or loader.
New capability tests retain 20s test/15s original-child budgets. 937 counts include both 114-case entry lanes and the five new tests; overlapping development reruns are not additional totals.

Preserved development failures:

- First relocation typecheck found the test wrapper's old type namespace references; a type-only namespace import fixed it without changing vectors or production code.
- First new-test run had four passes and one identity-test failure: Vitest represents namespace exports with accessor descriptors, so reading descriptor `.value` was wrong.
  The test now uses actual namespace property access; no production codec change was needed.
- The first auxiliary AST comparator accidentally included SourceFile full text/JSDoc, reporting unequal despite its stated intent.
  The corrected structural comparator retains identifier/literal text and excludes trivia; both original failed result and correction remain.
- Whole lint's only error is the unedited active-task JSON newline.
  Existing package-audit template suggestions remain informational.
  Do not describe whole lint as passed or silently change task metadata to obtain green.

## Actual public SDK capability observations

Environment: Linux x64, `/usr/bin/node` v26.7.0, installed coding-agent/agent-core/pi-ai **0.84.3**, Bun 1.3.14 and Vitest 4.1.10.
`test/helpers/worker-capability-child.mjs` uses public `createAgentSession`, its public `session.agent`, in-memory credentials/models/settings/session, an explicit empty loader, one official OpenAI-completions adapter and two fabricated custom tool calls.
The existing test preload forbids nonnumeric/nonloopback network, discovery/state access and subprocess installation; it does not replace fetch/TLS or the SDK.
Fresh child HOME/cwd/temp/env contain no inherited provider/proxy/session secrets.
This is a native SDK integration with **controlled in-process listener/tool gates and counters**, not an actual W2 producer or W3 slow disk.

Final native receipts are `sequential-782366.json`, `parallel-782379.json` and `capture-overflow-782392.json`.
All three retain original exit0 then close0, both output EOFs, ignored stdin, no force-stop, empty stderr and no workspace/home files.
Native fixture exit0 means its capability assertions passed, not that a canceled model operation succeeded.
Raw output contains no fabricated auth canary; exact request path/model/auth/tool set and result-call cycle are asserted in RAM and not exported as auth bodies.

1. **Awaited subscriptions:** holding an actual assistant `message_end` listener prevents tool start.
   Holding the actual `agent_end` listener keeps prompt and public `waitForIdle()` pending and `isStreaming` true.
   A second subscriber remains uncalled until the first releases.
   The public active signal matches the listener signal.
2. **Sequential tools:** public `toolExecution = "sequential"` reads back exactly and produces start1/end1/start2/end2 with maximum one active custom tool and two HTTP requests including genuine results.
   The parallel differential reaches maximum two active tools against the same two-call response, demonstrating the fixture detects overlap.
3. **Overlapping updates:** three synchronous `onUpdate` calls return `undefined` before this subscriber enters (`immediateCallbacks: 0` in all three receipts).
   Three listener reservations are then simultaneously retained before release.
   The SDK waits for those listener promises before emitting tool end.
   **Awaited subscription alone does not bound upstream/source ingress**; the session's earlier internal listener can yield before ours runs.
4. **Controlled overflow/abort:** a two-value reservation cap copies two values, refuses the third and calls public nonawaited core abort without awaiting its own run.
   After releasing outstanding reservations, the original prompt/idle settle, only one tool executes and only one HTTP request occurs.
   The actual last assistant stop is `error`, not `stop`; no success is inferred or normalized to a fabricated aborted result.
   Retained count returns to zero only after original listener settlements.

These capabilities are available on the selected installed peer; there was no private import, fallback peer or missing-capability substitution.
The three fixed-value counters do not establish arbitrary-object projection safety, source byte budgets, durable recording, complete SDK/provider memory bounds or the later worker's native settlement contract.

## Remaining W2 and integration gates

- Stateful genuine message/call/block/detail association, reused/unsafe/absent IDs, partial declarations, orphan/ambiguous results and finalized-versus-stream content.
- Shared field-aware incremental sanitizer before stdout and persistence, split/escaped secrets/UTF-8, own-data projection, omissions and independent wire/stored integrity.
- Actual v2 request/ready/emitter/decoder cutover together; source/frame/detail/aggregate accounting, queue/control headroom, five-second stalls, drains and no late unrecorded success.
- Public custom bash ToolDefinition using `createLocalBashOperations`, with synchronous ingress ownership rather than stock raw-spill accumulation.
- Actual fast producer/slow W3 recorder, original unresolved-write charges/fences and bounded cancellation without listener self-deadlock.
- W1 service startup/auth routing composition; W3 durable result/accounting; W4 dependency eligibility; W7 source/extracted package and integrated clients.
- Maintained specs and package/member/build closure must deliberately adopt the new JS/declaration/network owners in their assigned integration slice.
  No old 34-member or extracted-distribution PASS applies to the new closure.

No full-suite, pack, extracted service, browser/terminal cutover, Node22, Windows/macOS, paid-provider or physical-human qualification is claimed here.
Main/checker can review the relocated boundaries and resolve the task-JSON formatting blocker without changing task state.
