<!-- Exact body excerpt from implementation-readiness.md; original SHA256 81c2d9bb5b6f04c27c7f8986036e5372deac7723a5e76c21d48803ca110e27e9; context part 1/2. Read all parts; this is not a new review or executed evidence. -->

# W4 implementation readiness and single-owner integration plan

## 1. Disposition and evidence boundary

**Ready to begin the approved W4 integration work, with the concrete shared seams below assigned first. Not yet an accepting production service or a W4 acceptance pass.** The absence of a scheduler is W4's work, not a reason to repeat product planning. W1's actual startup/management composition remains required; it must not be replaced by a fixture owner, several TaskControllers, or an embedded-executor fallback.

`python3 ./.trellis/scripts/task.py current --source` resolved `.trellis/tasks/10-16-cadence-durable-history`, source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`. This report uses the delegation's explicit exception for its one W4 research output. It does not start W4 or change task status. Main should perform the owning-child handoff/start before implementation.

Read W4's manifests/PRD/design/plan, the complete parent PRD/design/plan and both mandatory appendices, approval and continuous-implementation authorization, interface freeze/read-progress/graph-limit decisions, relevant maintained specs, actual source and independent reports. The parent contracts supersede obsolete terminal-only specs. Routine in-scope engineering does not require another user approval. Real credentials, deployment, installation, Git operations, publication and commits are not authorized by this review.

This delegation performed source/document/receipt inspection only: no agents spawned, tests/check commands run, product edits, installs, service starts or Git commands. New issues identified below are **source-backed integration constraints, not newly reproduced runtime failures**.

### Current frozen evidence

- W3 `research/main-integration-checks/results.json` records **1307 passed, 32 files**, plus `check`, `check:agents` and `lint`, all exit 0. Its four log hashes matched during this review.
- Both main input manifests contain 174 paths; every current file matched both recorded hashes during this review. This is a readonly hash comparison, not another test run.
- Latest W3 graph-boundary review accepts the retained interface, including maximum legal graphs, full Reply accounting and raw-wire limits. The earlier graph-size blocker is resolved by the recorded category decision and later actual HTTP/export controls, not erased from history.
- Latest W3 metadata-cost review accepts its narrow guard/memo changes. Latest W2 canonical-reservation review accepts the demonstrated over-reservation correction. Their counts overlap main's checks and must not be added together.
- The historical 50018 ms failure, earlier control/native timeouts and event35 are **not causally explained** by those repairs or the new green main run. Preserve their receipts and labels.
- The real W1 model preparation → W2 prepared native worker → W3 writer case exists in `test/service-history.test.ts:547–694`: real public SDK/fabricated provider, native process, real durable content beyond 2 MiB, exact redaction and pages. Its role hash, current-context callback and parent orchestration are fixture inputs; it is not real role-pinned graph dispatch, multi-child scheduling or CLI composition.

Relevant reports: W3 `w3-graph-boundary-review.md`, `w3-metadata-cost-review.md`, `w3-progress-final-review.md`, `w3-read-semantics-review.md`, `w3-final-review.md`, `w3-publication-recovery-handoff.md`; W2 `w2-producer-review.md`, `w2-canonical-reservation-review.md`; W1 `w1-model-context-review.md`.

## 2. Actual interfaces that should be reused

| Boundary | Actual owner/API | W4 use and limitation |
| --- | --- | --- |
| Finite graph and worker request | `src/worker-public.mjs`, `.d.mts`; facade `src/service-contract.ts` | `decodeGraph`, `roleForPurpose`, `decodeHandoff`, `decodeWorkerPublicRequest`, `assertWorkerEnvelopeSize`. Already rejects cycles, duplicate/missing dependencies, invalid roles and readonly edit escalation. No second decoder. |
| Explicit action admission | `src/service/admission.ts#ActionAdmission`; `src/service/ports.ts#AdmissionOwner` | Real single-use grants, exact preview comparisons, durable command lookup, serial submit, separate safety cancel. Implement its owner callbacks, not another grant engine. |
| Lifetime/locks | `src/service/owner.ts#ServiceOwner`, `coordination.ts#ServiceCoordination` | One lifetime lease, original-process/auth/storage accounting and bounded stop. `ServiceOwner.execution()` still refuses; it is not an action executor. |
| Auth/model | `src/service/model-context.ts#OwnerModelContext` | Explicit `load`, `select`, `observe`, `prepare`; one-use `PreparedModelContext.consume`. Existing public SDK/auth source validation, no provider calls during preflight. Per-preparation original-completion visibility needs the narrow seam in section 3. |
| Native worker | `src/subagent-process.ts#preparedWorker` | Requires exact request/link, owner-only secret set and mandatory real sink. Uses the maintained v2 SDK worker and one `runProcess`; not legacy `runWorker`'s synthetic routing IDs. |
| Capture | `src/worker-recording.ts#WorkerRecording` | Existing second sanitization, source/stored identities, budget leases, pipelined writes and mandatory selected final. No accepting sink or fabricated ContentRef. |
| Durable acceptance | `src/history/writer.ts#HistoryWriter` | `supplyContext`, `currentContext`, `lookup`, `commit`, `admitRun`; existing episode/disk accounting. `commit` advances controlRev before returning. |
| Durable effects | `writer.auth`, `writer.processes`, `writer.capture(link)`, `writer.owner()` | Preparation intent/settlement; launch intent/settlement; worker and owner content/facts all enter the same writer. Sink construction requires a committed launch allocation. |
| v1 publication | `writer.publishTask`, `src/history/publication.ts` | Actual expected-byte intent → held `TaskStore.save` → observation → journal outcome. Existing strict summaries and phase mapping, not W4 JSON writes. |
| Read/live | `HistoryReader`, `HistoryProjection`, `HistoryLive`; `ProjectionPort`, `ReadEnvironment` | Actual history pages/search/export/progress plus committed notifications. W4 supplies real bounded current context/check/legacy observations; history does not manufacture current authority. |
| HTTP/client | `ServiceHttpServer`, `HttpAuthentication`, `ServiceClient`, `HttpServiceTransport`, `ProjectionTracker` | Existing finite control/read routes, auth/CSRF, subscriptions, correlation and resync. Wire these, do not build another protocol. |
| Changes/check semantics | `TaskStore`, `captureChanges`, `runCheck`/`runProcess`, `TaskController` | Preserve canonical paths, exact byte checks, real native shell/close and issue semantics. Extract shared pure policy where useful; do not instantiate TaskController inside the service. |

Public SDK inspection confirms the local `ModelRuntime.create/getAuth(model, overrides)` signatures in installed `node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts`. Global SDK/models/providers/message/configuration documentation and SDK credential/full-control examples were consulted; their newer shapes are not permission to replace the installed 0.84.3 route, enable discovery/retry or use private SDK modules.

## 3. Concrete seams to resolve before claiming executable integration

### A. Saved-plan content identity has no complete production producer yet

Evidence:

- `Action.save-plan` already contains the readable plan and a `Graph` whose `plan` is a ContentRef; `decodeGraph` requires `plan.version === planRevision`.
- `publicationRecord` verifies that exact committed plan bytes and owner version equal the accepted action before publishing.
- `HistoryWriter.openDetail/end` currently allocates a random recordId and emits content version 1 (`writer.ts:1709–1798`). There is no API accepting the already-confirmed prospective plan identity.
- Existing structural graph fixtures retain a plan first, then build the graph with the returned reference. That is not an acceptable production workaround involving writes during preflight or an undeclared upload action.
- `HistoryReader.graphData` presently finds graphs through `parent-admitted`/run admission files, not a saved-but-never-started plan.

**Recommended narrow W3 seam:** add writer-owned `retainAcceptedPlan(operationId)` (name proposed), deriving the plan and its selected prospective identity from the already committed action, not from arbitrary caller replacement bytes. For save-plan, validate the proposed reference's hash/length/version against the exact sanitized approved plan, reserve/check the ID against existing storage, retain it through the same artifact/journal machinery, and return the actual committed reference. An identity in an unaccepted draft is a proposal, never evidence of committed content. Do not silently allocate a different reference and mutate the accepted graph afterward. Refuse sanitized-text mismatches before consent; do not disclose unsanitized secrets merely to preserve a hash.

This can retain the existing wire Graph shape: introduce only an internal, narrowly guarded plan allocation path instead of allowing arbitrary IDs through every content-begin. Preserve ordinary immutable worker detail allocation. Explicitly support fresh immutable plan identity/version selection without assuming all subsequent plans are version 1.

Provide one retained lookup for the **latest published saved graph**, deriving it from the accepted save-plan action plus actual publication and plan membership. Reuse original command/journal locators; expose it through the shared graph projection/current task adapter, including finite progress if needed. A failed/pending publication must not become the current executable graph. No unbounded in-memory map of every historical graph.

Create/goal-only readonly/default-single-assignment and explicitly continued legacy tasks also need a defined plan-reference producer. It may retain an empty/advisory plan under the accepted action, with the exact default assignment shown before Start. Opening a legacy task must not write a plan or import its old approval. Generated output is a proposal; its private retained result/v1 advisory summary is not an accepted executable graph.

### B. The durable fact vocabulary cannot yet describe all actual scheduler states

Evidence: `OwnerFact` in `src/service/contracts/history.ts:868–946` has a run-level gate, but no per-assignment waiting/admission-stop fact. `RunState` keeps one private `gate`; held→held is rejected, and its release names only the lane. `projectRunObservation` derives child queued/preparing/running from auth/launch facts and maps every unlaunched child after parent settlement to blocked/parent-stopped. It cannot retain wait-expired versus stale-dependency versus handoff-overflow, or truthful individual closing/wait reasons. `run-progress-state.ts` shares the same projection but stores only one gate locator.

**Required shared W1/W3 extension:** finite closed scheduler-observation facts, keyed by existing allocated childRunId (and parent admission-close reason), plus per-reservation gate identity or an equivalently validated aggregate-count transition. Recommended gate identity is a childRunId for assignments and checkId for checks; validate membership and bound the map to the frozen assignments. Do not overload `observedMs`, tool text or a new UI-only state map to hide missing facts.

Record waiting/ready/preparing/closing/unstarted reasons and the episode admission-closed reason. Native launch/settlement and selected-content membership remain their existing owners: a scheduler hint must never assert process close or success. Extend **the same** `RunState`/`projectRunObservation`, finite `run-progress-state`, recovery reduction and exports, preserving old facts and cold/restarted projection. Native/live and historical UI must agree after RAM is gone. No duplicate scheduler-specific result reducer.

### C. Auth reporting completion is not original preparation completion

`OwnerModelContext.prepare` returns `Promise.race(operation, closedWait)`; its private tail and `pending` retain the original work after the 30 s report/caller abort. `ServiceOwner.trackAuth` correctly tracks the original getAuth and its recorded settlement, but W4 cannot identify an individual child's original preparation drain from the returned refusal alone.

**Minimal W1 API:** expose a secret-free preparation handle, e.g. `prepareTracked(input): { result: Promise<ModelPreparation>; settled: Promise<void> }`, backed by the current original operation, with the current `prepare` delegating if compatibility is still needed. The settled promise must include original auth-accounting completion; a timed-out journal acknowledgment is still uncertainty. It must not expose auth material or permit another consume/refresh. Alternatively expose an equivalent operation-ID-bound original completion notification through the existing real accounting composition; do not poll global `pending === 0` as proof about one child.

Reserve the child slot and checkout lane before preparation. Reporting timeout/cancel closes launch admission immediately, but cannot refund that child's still-running auth/write reservation or declare the parent drained. This is a composability seam, not a request to rewrite already qualified auth resolution.

### D. Original W3 writes need explicit lifecycle composition

`HistoryWriter.enqueue` retains an internal original job but returns a 5 s reporting race; `pendingWrites` and `settled()` expose its real remaining lifetime. Merely passing each returned race to `ServiceOwner.trackPersistence` does not track that original. Writer fences already preserve safety; this finding does not claim they currently release unknown locks.

Choose one W1/W3-owned connection before startup acceptance: expose a bounded original-job lifecycle hook to the owner **before effects**, or give the lifecycle mandatory `settleWrites`/pending-write observation backed by `writer.settled()`/`pendingWrites`. If using the latter, update `ServiceOwner.drain` to account for it even on its uncertain branch, which currently returns before `flush`. A reporting deadline still returns quarantine, never waits forever before reporting; late original completion cannot automatically clear the fence. Avoid duplicate registrations masquerading as independent operations and avoid joining viewer callbacks to writer completion.

### E. Real checks need a service environment/output adapter, not a copied process runner

`runCheck(check, cwd, signal)` currently captures `{ ...process.env, CADENCE_SUBAGENT_CHILD: "1" }` at invocation (`subagent-process.ts:595–618`). This would inherit service access secrets/control markers. It has no injected immutable launch-environment policy or service check-output sink. Nonprotocol `runProcess` bounds aggregate output at 256 KiB, then returns a diagnostic preview capped at 64 KiB. That preview is not full retained check output.

Add a narrow optional service-check context to `runCheck`/the existing `ProcessSpec` path: frozen explicit launch env, native settlement observation and bounded sanitized owner-content recording. Keep the ordinary project environment, shell/CMD quoting, stdin-absent EOF, timeouts, native close and TERM/KILL handling. Strip service/local/browser access material and control markers by the selected launch policy; never merge resolved model auth and never substitute the SDK's narrow `safeChildEnv` for normal checks. Keep the trusted-child guard as appropriate. No browser env overlay or arbitrary-shell route; only configured checks or authenticated native-local manual selection.

Use owner `content-begin/chunk/end` for field `check`; do not counterfeit SDK frames to reuse WorkerRecording. Preserve all allowed observed output up to the explicitly selected capture limit and report exhaustion/coverage honestly. Keep old `RunResult.output` as a preview if needed, but never persist only that preview as complete. Apply streaming redaction/budget reservation before copies/awaits; no raw spill or chunk-local secret sanitizer. Link the returned real ContentRef to `check-settled` only after commit.

### F. Check generation advancement and PASS currently conflict if composed naively

`decodeOwnerFact(check-settled)` requires full canonical equality of `before` and `after` for passed status, including checkoutGeneration (`history.ts:1012–1049`). `RunState.check-start` also binds before to the originally confirmed context. `HistoryProjection.checkObligations` requires the current generation to equal the result's after generation. The parent requires service writers/checks to advance generation conservatively.

Thus incrementing at check completion makes every check stale; incrementing just after recording makes an unchanged PASS immediately stale; incrementing at acquisition breaks the existing before-context join. This is a concrete source contract alignment to test, not permission to disable generation tracking.

Recommended shared correction: record the actual before generation and the check's own exclusive after generation, validate the permitted owner transition in the shared reducer, and distinguish that **own operation advance** from a changed observed fingerprint or intervening operation. PASS still requires native success, known close, mandatory capture, unchanged selected observed bytes/coverage and no foreign/intervening generation. Current obligations bind the actual after generation. Never use a general `before <= after` relaxation. Later edits/checks conservatively stale earlier results. Preserve incomplete observation as a review issue independently of the native exit/status.

### G. W1 management/proxy remains a genuine composition gate

- No `src/service/cli.ts`/generated service executable composition exists in the inspected owners. `ServiceHttpServer.listen/admit`, coordination, access and history are usable parts, not a complete startup route.
- `OwnerModelContext.directAuthRoute` refuses any configured/inherited proxy/bypass/opt-in/preload key, including empty values (`model-context.ts:88–116`). W2's validated worker proxy path does **not** prove owner-side OAuth networking. Preserve refusal until W1 qualifies explicit service-process startup with public APIs, successful plain/compressed fabricated OAuth responses and no direct fallback. Existing fixed-502 probes prove route observation only.
- `src/service/recovery.ts#resolveRecovery` still always refuses. W3 `HistoryRecovery.append` writes a guarded fact but never releases locks. A no-op local-authority callback or ordinary `TaskStore.recover` is not the missing management adapter.

These gates do not prevent developing W4 against real isolated DIRECT primitives. They prevent claiming full configured service/proxy/recovery acceptance. No new external blocker was established by this readonly review; any actually missing runtime capability must be demonstrated and reported without installs, credential substitution or scope cuts.

## 4. One-editor order and focused implementation slices

### Slice 0 — W1 host composition, with mutations closed

One W1/main editor owns `service/{cli,owner,coordination,recovery,model-context,http}.ts`, the service entry/build and any shared port changes. Do not concurrently assign them to W4.

Compose explicit canonical workspace/state-home/config selection; listener binding with gates closed; resolved endpoint/port-0 registration; lifetime v1/service lease; explicit history initialization only for a genuinely new owned store; reader/writer/live; one model context; existing token/native authority. Unknown existing format/key/registration/lock refuses without repair. Use actual authenticated readiness, not file-only idle status. The HTTP source explicitly documents bind → acquire/register → admit. Default detached startup waits 10 s and reports unconfirmed rather than killing/restarting.

Supply mandatory lifecycle callbacks and original-write/auth tracking. Keep `HttpAdapters.admission = null`/actions unavailable until the real action owner is connected. Read/status/diagnose must work without constructing an inference session or resolving provider auth. Quarantine needs restricted local diagnosis, not a falsely healthy accepting listener.

Freeze the exact composition object and hand it to W4, including selected env generation, local capability/access-generation supplier, lease assertion, actual writer, model adapter, clock and stop/quarantine callback. No permissive defaults.

### Slice 1 — Shared fact/plan/check seams, then W4 graph/actions

Assign one editor the minimal cross-owner corrections in section 3, followed by independent review. Shared codec changes belong to their existing owners; preserve W2's maintained JS/declaration facade identity and W3's read-progress semantics. Do not rewrite historical freeze hashes as current acceptance.

W4 owns `src/service/{graph,scheduler,task-actions}.ts` and focused tests. Suggested local responsibilities (names proposed, not current exports):

- `graph.ts`: validate against the real task snapshot, current model selection and loaded package role hashes; construct the finite request and exact dependency handoff using existing decoders.
- `task-actions.ts`: one `AdmissionOwner` implementing the **actual existing** `observe/currentAccess/run/activate/requestCancel/quarantine` signatures; create/save-plan/generate/start/check/review orchestration and the current-view callbacks.
- `scheduler.ts`: one bounded episode table, one fair checkout gate, one dispatch pump, original handles and deadlines. It calls the existing prepared worker/check helpers, never owns an SDK session or another spawn implementation.

`observe` must be local/readonly: task raw identity, current control/config/check environment, root/cwd identity, current observation, readable plan/graph, actual role hashes and model selection. No getAuth, worker, publication or history repair. Failed current observation is not permission to use an old admission context.

`activate` must synchronously register the accepted episode/check and its activeRunId before returning to ActionAdmission. Metadata operations also need a bounded busy fence until publication; a null runId is not permission for overlapping save-plan/review mutations. It schedules only this newly committed command. Existing receipts/restarts never invoke it.

Use `writer.currentContext` after commit: ActionAdmission's post-commit comparison expects **only controlRev +1** (access rotation normalized), not prematurely published task revisions. Publish/update the task snapshot afterward. Separate frozen admission identity from expected task bytes advanced by this episode's own v1 publications; otherwise legitimate running/final publication will self-stale the worker or overwrite external edits. Progress watermarks never increment controlRev by themselves.

### Slice 2 — Finite scheduling and pre-auth reservation

Use the shared constants: 8 admitted episodes, 128 queued assignments, 2 preparing/running/closing child-or-check slots. Retain bounded graphs/IDs and at most the preparing requests, not a fully expanded request for every queued assignment. Bound retained graph/request bytes as well as counts before copying or awaiting; include escaped JSON, role/context and retained handoff buffers. W3's committed episode reservation remains the single disk/quota authority: default 512 MiB per episode, 10 GiB checkout, 256 MiB free-space floor, 1 MiB control headroom. Do not create a second optimistic disk allowance or refund timed-out writes.

Under ActionAdmission's single submit mutex, observe capacity, then register/reserve synchronously in activate before any asynchronous preparation. Other dispatch paths cannot increase accepted parent counts. If an additional pre-commit RAM reservation is needed, add it to that one admission path, with exact no-effect release semantics, rather than reserving execution during preflight.

Dispatch ready parents round-robin and assignments in frozen graph order. A ready writer/check blocks younger readers across **all tasks**. Reader lanes may overlap; writer/check excludes every other reader/writer from preparation through confirmed native/auth/storage drain. Do not reserve both child slots for work merely waiting on a lane when that prevents already-held work from draining. Cancellation must remove queued waiters without granting a canceled waiter.

Use one canonical checkout gate behind the lifetime lease. Exact-root aliases reach the same owner; nested/overlapping roots remain W1 registry refusals; disjoint worktrees are independent. No per-task TaskStore lock reacquisition/release inside the lifetime lease.

