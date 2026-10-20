# W1 model/auth boundary — independent review

## Scope and verdict

Reviewed the delegated model/config adapter, its native fixtures, original handoff/evidence, installed public Pi0.84.3 declarations and supporting implementation, and the parent PRD/design/plan including both mandatory appendices.
The global Pi docs/examples describe1.2.0; the installed0.84.3 shapes remain authoritative.
No user credentials, login, installation, deployment, repository Git mutation, task-state change, shared-interface edit or additional agent was used.

**Four adapter defects fixed; no remaining in-scope adapter defect identified.**
This is not complete W1, an accepting worker port, or integrated product acceptance.
Configured service-auth proxy startup and real W2/W3/W4 composition remain gates.

## Findings fixed

| Finding                                                   | Cause / narrow correction                                                                                                                                                                                                                                                                                         | Regression                                                                                                                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Invalid compatibility values admitted                     | SDK `model-config.js` uses a union of permissive objects. A malformed field can validate through a different member that does not declare it. Closing keys alone did not validate values. `model-config.ts#compat` now validates the installed peer's boolean/enum/scalar/routing shapes before SDK construction. | `bad-compat-boolean`, `bad-compat-enum`, `bad-compat-routing` fail before the fix; `valid-compat` preserves a valid mixed nested configuration through the stock SDK and prepared envelope.       |
| Supported literal credential incorrectly refused          | A regex found an apparent environment reference inside an invalid braced literal, although the SDK treats the whole braced segment literally. `templateNames` now walks the installed grammar without resolving values or executing commands.                                                                     | `template-literal-braces` preserves the exact literal through the stock public `getAuth`.                                                                                                         |
| Synchronous cancellation bypassed final consumption check | `check()` examined abort state before calling `current()`. That callback could cancel and still return true, allowing the encoded material to reach the consumer. Recheck abort/closed/generation after the callback; already-closed requests do not call it.                                                     | `abort-during-current` triggers cancellation during the final callback and requires consumer calls0.                                                                                              |
| OAuth validity became insufficient during encoding        | Consumption checked remaining validity before invoking the encoder, not after it. Keep the same timeout+120s requirement and check it again immediately before use.                                                                                                                                               | `oauth-expiry-during-encode` uses genuine stock Radius refresh, then an explicitly injected clock change at the encoder boundary; it requires consumer calls0. This is not elapsed-hour evidence. |

Six targeted regressions failed on the inherited adapter, then passed after correction.
The original failing run remains in `w1-model-context-review-checks/regressions-before.log`: five cases had original exit1; the expiry fixture also required its existing15s force-stop after the failed assertion.
That failed cleanup is preserved, not relabeled clean.
The repaired targeted run and final full focused run require original unforced settlement.
No child/test/auth/validity/envelope budget was increased.

### Fixture corrections and portability

- Strengthened the test guard from arbitrary numeric-loopback admission to the exact fixture-owned ports, propagated to the competing stock SDK process.
- Public file-read/open/write API guards now restrict data to the fresh fixture and readonly module loading to the trusted bundle/installed peer closure.
  They reject canonical alias escapes before a credential read; these are test controls, not an OS sandbox or universal native-I/O interception.
- Added two negative native controls: outside-fixture read and unassigned loopback connection.
  Their required original exit91 proves the guard fired; ENOENT, connection refusal or forced termination cannot satisfy them.
- POSIX chmod-negative cases are explicitly skipped on Windows rather than treating POSIX mode bits as an ACL premise.
  On this Linux run both executed and passed; Windows ACL behavior remains unqualified.
- No fetch/TLS/global-dispatcher substitution, outbound provider access or actual credential access was added.
  Native worker spawns remain0.

## Preserved contracts reviewed

- Passive observation has no file/SDK/auth activity.
  Selection IDs are random, secret-free and not credential hashes; configuration/raw credential identities remain owner memory.
- Existing safe bounded auth/models reads precede SDK construction; unknown/corrupt/linked/oversized input and command/file-backed auth refuse without repair.
  Actual supported JSON comments/trailing commas and model/header schemas remain intact.
- Public `ModelRuntime.create` uses explicit selected paths, in-memory models storage, `allowModelNetwork:false`, `refreshOnCreate:false`; no inference session, resource discovery, copied credentials or alternate profile.
- Exact model/API/thinking is checked without clamping or fallback.
  Returned base URL, literal headers/null suppression and scoped environment remain private server material; config null headers still visibly refuse because this installed models schema supports strings only.
- Two preparation reservations are taken before awaits, with path-local serialization.
  Intent precedes `getAuth`; an independent non-caller-aborted signal and original promise/settlement-write tracking survive reporting timeout, cancellation and refused late tracking.
  The30s default reporting bound is not refresh settlement.
- Observed access/refresh/expiry renewal advances private expected credentials without changing selection IDs.
  Opaque unobserved external changes conservatively require fresh confirmation, not a claim of model replacement.
- Consumption is one-use and checks the actual serialized128KiB string plus current sources/context before the native-consumer seam.
  The seam itself does not launch workers or implement an accepting production port.
- Configured proxy/bypass/opt-in/preload routes refuse before `getAuth`.
  Stock Node26 probes again show no-opt-in sink1/proxy0 and startup-opt-in sink0/proxy1 with fixed502.
  Fixed502 is route observation, not successful proxy OAuth or inference.

## Verification and evidence

Commands are run from the package root:

```sh
bun run test -- test/service-model-context.test.ts test/service-contract.test.ts test/service-owner.test.ts test/service-auth.test.ts test/lightweight-store-controller.test.ts
bun run check
bun run check:agents
bun run lint
```

- Inherited baseline: **396 passed /0 failed /0 skipped**, five files.
- Final focused run: **405 passed /0 failed /0 skipped**, five files:76 model-context tests plus329 existing contract/owner/auth/legacy-store tests.
- Check, Agent check and final lint: see the exact command/log/exit/hash record in [results.json](w1-model-context-review-checks/results.json).
  Scoped formatting is applied before final lint.
- Available host: `/usr/bin/node`26.7.0, Linux x64; Bun1.3.14; installed coding-agent/AI/agent-core/TUI0.84.3, Undici8.9.0, Vitest4.1.10.
- The final76 model-context cases retain76 top-level original Node receipts:74 exit0 and two expected guard exit91, all unforced.
  The stock competing SDK child is additionally waited in its scenario, not counted as another test.
  The index binds only fixtures created during the final run, not old temporary history.
- All W3 receipts/flushes remain injections.
  Five named `getAuth` cases remain public-boundary injections; other timing/freshness controls are explicitly injected.
  Real Radius loopback refresh/shared-file coordination is genuine SDK mechanics with fabricated credentials, not paid auth/inference or durable journal qualification.
- Selected reruns overlap the final total and are not added to405.
  Target filters explain their skipped rows.
  Previous handoff/failure/evidence files remain unchanged.

An attempted identity query through the unexported package.json subpath failed; versions were subsequently read directly from installed package metadata without importing/constructing the SDK.
This diagnostic mistake is recorded separately from product checks.

## Changed files and handoff

Adapter fixes: `src/service/model-config.ts`, `src/service/model-context.ts`.
Test changes: `test/service-model-context.test.ts`, `test/helpers/service-model-context-child.mjs`, `test/helpers/service-model-context-guard.mjs`, `test/helpers/service-model-route-probe.mjs`.
The fourth helper, `test/helpers/service-model-auth-competitor.mjs`, was reviewed and remains unchanged.
New report/evidence only: this file and `research/w1-model-context-review-checks/`.

All readonly scope hashes, including frozen contracts/ports, owner/HTTP/auth/coordination, package/lock and legacy worker/controller/shell, remain equal to the inherited handoff and final input snapshot.
The main session can record the compatibility-union and reentrant-consumption pitfalls in maintained specs when assigned; this delegation deliberately does not edit specs.

Remaining work is unchanged: qualified service-auth startup routing (including successful plain/compressed OAuth responses and the relevant Node22 lane), genuine W3 intent/settlement/crash recovery, W4 admission/gates and W2 encoding/native launch, then service CLI and integrated clients/package qualification.
No full-suite, extracted service, browser/terminal cutover, native Windows/macOS, paid-provider or release-completion claim follows from this review.
