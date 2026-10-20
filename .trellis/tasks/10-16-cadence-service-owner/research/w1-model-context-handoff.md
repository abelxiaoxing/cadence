# W1 owner model/auth preparation handoff

## Scope and status

Implemented `src/service/model-context.ts` and its private configuration helper `src/service/model-config.ts`.
Added `test/service-model-context.test.ts` and four `test/helpers/service-model-*.mjs` fixtures.
No existing owner, frozen contracts/ports, HTTP/auth/client/coordination, package/lock, worker/controller/shell or task-state files were edited.
No install, real credential inspection, login, deployment, commit or provider-account operation was performed.
All credential writes were SDK operations against explicitly created fabricated test stores.

This is **not complete W1 or product acceptance**.
The adapter is not yet wired to HTTP, W3's actual journal, W4 admission/scheduling, W2 native launch or a service CLI.
Configured service-auth proxy routing remains an explicit integration blocker, not silently direct-routed work.

## Implemented boundary

- `OwnerModelContext` takes fixed service-launch home/cwd/environment and optional agentDir, a real `ServiceOwner`, and the mandatory `AuthAccountingPort`.
  It resolves the documented normal `~/.pi/agent` or explicit/configured directory without a new credential profile.
  One loaded runtime per owner and two outstanding preparation reservations are enforced before asynchronous work.
- `observe()` returns only previously selected `ModelSelection` values, with random UUID source-selection IDs.
  It performs no filesystem/SDK/auth/provider work. Constructor environment capture does not invoke accessors.
  No auth/config digests or raw objects enter that projection.
- Explicit `load()` validates bounded existing auth/models files with existing private-file hygiene before the public `ModelRuntime.create` call.
  It uses the installed public `InMemoryModelsStore`, `allowModelNetwork:false`, and `refreshOnCreate:false`.
  There is no inference session, resource loader, catalog/availability refresh, settings/key seeding or login.
  Missing auth, corrupt/duplicate/unknown fields, links/hardlinks, unsafe POSIX mode, command expressions and ambient-file auth refuse without repair.
  Models support the selected peer's line-comment/trailing-comma/BOM syntax; raw original bytes still govern freshness.
  Optional absent models stay absent. Unknown nested metadata keys refuse instead of relying on the SDK's permissive additional-property handling.
- `select()` uses the exact public runtime model and `getSupportedThinkingLevels` from the public pi-ai root.
  No model/API/thinking substitution or clamping occurs. Registered custom/native transports refuse.
  Saved keys, named environment references, static custom model/header configuration and supported OAuth paths are exercised.
  Named variables are captured from service launch, checked against the still-current process facts where the installed SDK uses ambient interpolation, and never accepted from browser overlays.
- `prepare()` validates the shared `WorkerPublicRequest` and actual owner epoch, serializes preparations, and commits credential-free intent before invoking `getAuth(model, overrides)`.
  The public promise receives an independent never-caller-aborted signal and `minOAuthValidityMs = child timeout + 120000`.
  Caller cancellation/default 30000ms reporting timeout closes admission, not the already-started SDK refresh/writeback.
  Original promises and their independent settlement-write continuation are immediately handled and registered with `ServiceOwner`.
  Settlement is invoked only after the original auth promise settles. It contains only operation ID, fixed outcome and admission-closed fact.
  Reservation lifetime includes original writes even when late tracking is refused. Stop accounting retains those originals, not timeout wrappers.
- Fresh source/model/environment/context checks surround awaits and precede consumption.
  Known observed OAuth renewal advances private expected credential bytes without changing public selection IDs; canceled callers can still have a recorded completed renewal.
  Rejected auth remains conservatively quarantined by the existing owner, including short-validity refresh that already wrote rotated credentials.
- Prepared material is held only in an opaque server closure. Its JSON contains no credentials.
  W2 must supply its real encoder/native consumer to the one-use synchronous `consume()` seam.
  The complete actual serialized string is checked against 128KiB after encoding and immediately before consumption, in addition to the initial private-envelope check.
  Auth headers, null suppression, base URL and scoped environment remain literal; parent-resolved model headers are removed from the model.
  This closure does **not** implement an accepting `PreparedWorkerPort` or launch any worker.

## Installed public API and qualification

Read complete official global README, SDK, providers, models, custom-provider, configuration, security and environment documentation plus relevant SDK examples.
The installed coding-agent/pi-ai **0.84.3** public declarations and implementations govern this code, not global 1.2.0 examples.
No private SDK imports or global SDK fallback were added.

The focused run covers **396 passed / 0 failed / 0 skipped**, five files: the new **67** model-context cases plus the existing **329** contract/owner/auth/legacy-store regressions.
Whole `check`, `lint`, and `check:agents` results and exact source/log hashes are in [results.json](w1-model-context-checks/results.json).
These overlapping development runs are not additional test totals.

Evidence distinctions:

- Every new scenario runs in an isolated original Node process with fabricated HOME/config/state/environment, a 15s child/20s test budget, bounded captured output, native `close`, exit0, EOF and no force-stop requirement.
  A test-only network/process guard permits numeric loopback, readonly workspace Git lookup and the specifically named competing SDK fixture only.
  It does not replace fetch, TLS or a dispatcher.
- Stock public SDK saved-key/static-model/header/env tests use real files and APIs.
  Stock Radius OAuth against a numeric-loopback HTTP fixture performs genuine SDK refresh, proper credential-store coordination, rotated writeback and preservation of unrelated provider entries.
  A second original SDK process waits against the same file while the first HTTP refresh is pending; both settle with one refresh request.
  This is auth mechanics, **not Radius inference or a paid account qualification**.
- Cancellation/shortened reporting wait, competing selected models, minimum-validity failure, failed HTTP refresh, source changes, stalled settlement and owner stop have separate assertions.
  Actual SDK original promise identity and settlement-before-write ordering are observed through transparent public-method wrappers.
- Five named scenarios inject the public `getAuth` boundary: `stalled-original`, `late-auth-tracking`, `opaque-rejection`, `opaque-auth`, `literal-projection`.
  They cover permanently pending-until-released work, late registration, opaque error/getter refusal and literal/null transport projection. They are not real-provider evidence.
- **All W3 preparation/settlement/flush receipts are injections.** No genuine durable journal or auth-crash recovery is claimed.
- Two separate stock-SDK startup routing probes record actual Node26.7.0 behavior: with HTTP/HTTPS pair but no startup opt-in, sink1/proxy0 and refresh succeeds; with `NODE_USE_ENV_PROXY=1`, sink0/proxy1 and the fixture's fixed502 refuses refresh.
  Fixed502 proves route observation only, not successful refresh through a working proxy or owner proxy qualification.
- Native worker spawns are zero. Encoder-consumer calls in fixtures are explicitly not native launches.
  SDK/secret canaries stay out of public projections, accounting and raw child output; receipts omit auth/config bodies.

## Concrete limitations and next integration work

1. **Owner auth proxy route is not complete.** The installed `ModelRuntime` has no public per-runtime auth dispatcher or startup-route attestation.
   The native probes establish that post-startup environment values alone cannot justify assuming an opted-in route.
   The current worker selector is private and readonly in this delegation; the service CLI startup owner does not exist yet.
   This adapter therefore refuses every configured routing/bypass/opt-in/preload request before `getAuth`, rather than duplicate the frozen worker selector, install a global dispatcher/fetch replacement or silently use DIRECT.
   Main should assign one editor to extract/reuse the current validated route policy and compose an explicit pre-import service startup route, then qualify real successful plain/compressed OAuth responses and applicable Node22 behavior.
   The Node26 fixed502 receipt is not permission to mark that work done or drop approved proxy functionality.
2. **Opaque external OAuth identity:** public credentials have provider-specific extra fields but no generic account/refresh provenance API.
   Observed in-operation renewal with unchanged identity fields preserves the selection.
   An unobserved between-admission change to access/refresh/expiry conservatively requires a new explicit selection; it cannot safely be classified as coordinated renewal versus replacement from opaque bytes alone.
   Main should review this conservative limitation rather than invent public secret fingerprints, parse arbitrary JWTs as universal identity, or claim every external renewal is distinguishable.
3. **SDK supported-writer assumptions:** prevalidation/freshness is bounded hygiene, not hostile same-user filesystem CAS.
   The default SDK store owns its existing lock/read/refresh/write protocol; Cadence never reclaims or manipulates those locks.
   SDK constructor fallback behavior is guarded by pre/post reads, and signaled public auth reads propagate failures; arbitrary manual changes inside SDK operations cannot be made atomic with a public configuration option.
4. **Peer syntax/capabilities:** installed models.json accepts string headers only; config null headers visibly refuse. Returned `AuthResult` null suppression is preserved and separately tested.
   Unsupported future model metadata or command/function/file-backed authentication refuses, never downgraded configuration.
5. W3 must provide genuine committed auth accounting/flush and unmatched-intent crash handling; W4 must supply admission/gates; W2 must supply the actual v2 encoder and native launcher before any accepting worker port is exposed.
   Keep original-promise accounting and the final actual-envelope/context check at that composition boundary.

No full suite, package/extracted service, browser/terminal cutover, paid provider, physical-human, native Windows/macOS or release claim follows from this handoff.
Development hypothesis failures remain preserved in the evidence index; particularly, the initial proxy-gap hypothesis was falsified by the actual Node26 opt-in probe, not relabeled a product failure or hidden behind a mock.
