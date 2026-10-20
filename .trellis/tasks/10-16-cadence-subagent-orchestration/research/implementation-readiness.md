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

### Slice 3 — Actual request construction and launch chain

The request must contain real reviewed material, not fixture role hashes, `current: () => true`, dummy environment generations or preview-only predecessor text.

1. Load the three package definitions with `loadAgentDefinitions`; bind actual SHA-256 and `roleForPurpose`. Review maps to the readonly design profile; capability follows purpose, never parent-code status or role prose.
2. Freeze actual safe project hints/conventions and their selection identity. The existing shell reads root `AGENTS.md` with `readBounded(...,32768)` and labels it untrusted (`task-shell.ts:413–427`). Reuse that safe-file primitive/intent, not general resource discovery. Missing is distinguishable from unsafe/oversized refusal. Recheck selected hint/role bytes after preparation awaits and before launch; encode changes in current config/context freshness without leaking credential identities.
3. Put pinned role instructions, assignment instructions, expected output, goal/plan/context in explicit fields without duplicating large bodies. `WorkerPublicRequest.instructions` is 16 KiB; context and prompt are each 32 KiB. Blindly concatenating a 16 KiB assignment plus role plus 32 KiB hints into instructions is invalid. Define the builder once; oversized composed requests refuse visibly before auth, not silently clip reviewed instructions.
4. Resolve dependency selections from actual committed predecessor final detail and settlement. Use actual membership locators/hints from W3, never preview/ring/model prose. Current dependencies require native known close, successful mandatory recording and current selected observation/generation. Historical/advisory selections retain their exact source IDs/version/range and are not fresh execution consent.
5. Supply whole final text or the explicitly approved UTF-8 range: at most 16 KiB per predecessor and 32 KiB aggregate. Record exact bytes, ContentRef, range, coverage and frozen edge order. `writer.assertHandoff` already independently joins these to real source bytes; W4 additionally owns observation freshness. Do not summarize, read private history through worker tools or call a hidden model to fit a handoff.
6. Enforce canonical public request ≤96 KiB before auth, leaving the selected 32 KiB allowance; the **actual** model/auth/cwd serialized envelope must still pass 128 KiB in one-use consumption. Escaping, labels, model metadata, headers and auth expansion count. Passing the pre-auth check is not a guarantee of post-auth fit.
7. Persist allocation with `writer.admitRun(runId, identity, graph)` before auth. Record gate/before-change/handoff facts through `writer.owner()`; use only actual returned `batch.ownerDetails` references. Every write is budgeted and sanitized before persistence. Generate-plan uses one separately allocated readonly assignment and graph=null, never the saved executable graph.
8. Call `OwnerModelContext.prepare`/the tracked seam using a **new auth operationId**, distinct from the parent operation. It uses `writer.auth`, timeout +120 s validity, and a current-context predicate that checks ownership, selected task/graph/cwd/role/hints/model and cancellation after awaits. Already accepted work must not be canceled solely because a viewer detaches or access token rotates.
9. After actual auth settlement and freshness, await `writer.processes.launchIntent(link, parentOperationId)`. Recheck again, obtain `writer.capture(link)`, and call `preparedWorker(...).launch(signal, sink)` exactly once. Track its original completion with ServiceOwner immediately; never await the run from its own capture listener. Browser secrets stay owner-side.
10. Record `writer.processes.settlement(link, completion)` before dependency eligibility; preserve original native zero/nonzero/cancel/timeout/unknown separately from mandatory capture and durable result. Reobserve changes, advance expected checkout generation under the actual gate, and only release known-settled reservations. Aggregate with the shared required-child settlement helpers and then publish v1 separately.

Missing sink, changed source, failed stdin, cleanup/protocol failure or lost recording never becomes a successful workflow. Test known no-launch cancellation separately from unknown launched work: the current `ServiceOwner.trackWorker` conservatively quarantines all refused recording results, while preparedWorker can return refused recording with `closure:not-launched`. Compose/classify that path explicitly; do not invent a child close or call a known no-spawn refusal an unconfirmed process.

### Slice 4 — Failure, expiry, cancel and drain

- First child failure/timeout/cancel closes admission for its parent. Already-running independent siblings drain normally; preserve their results. No retry, model fallback, requeue or generated follow-up dispatch.
- Ready wait is 10 min; episode deadline 6 h; worker default 20 min. Use monotonic elapsed observations. Wait-expired, required-handoff overflow and stale required inputs stop further admission and **drain** independent active siblings before a blocked settlement. The episode deadline instead requests bounded cancellation of active work and retains timeout facts.
- A current dependency accepts the expected transition caused by its predecessor's own serialized edit. Compare against the committed after-observation and compatible generation, not an eternally unchanged initial fingerprint. Incomplete whole-checkout coverage stays a warning unless that edge requires completeness; missing/changed selected input always blocks. Bounded equality is not proof against external change-and-revert.
- Explicit Cancel synchronously closes admission/sets cancelRequested, aborts all preparing/active children concurrently and keeps original handles. Use existing TERM→1 s KILL→3 s unconfirmed bounds, not N sequential waits. Separate command-id idempotency and exact run/epoch targeting from progress revisions.
- Persistence failure cannot prevent an authenticated exact-run safety stop; retain ActionAdmission's non-durable uncertainty path. Unknown process close, ownership/durability uncertainty or publication conflict quarantines the checkout and requests stop of its other active work.
- Late auth/write settlement is still recorded but cannot launch. A stopped/blocked/expired episode never becomes eligible again because of Done, reconnect, a timer reset or a repeated command. Remaining work requires a saved/reviewed revised graph and new Start; old results are selectable historical inputs only.
- Parent settlement waits for every required child disposition and every original auth preparation settlement. Unstarted nodes have explicit reasons, not fabricated native outcomes. All-success requires every required assignment satisfied under existing shared settlement semantics.

### Slice 5 — Checks, changes, human review and publication

Checks are separately confirmed parent operations after the target parent drains, not graph nodes or bash tool messages. Capture exact configured name/command/timeout, real canonical cwd and launch-env policy/generation in the preview; permit manual checks only from the ingress-created local Caller. `surface:terminal` in JSON supplies no authority.

Use the same fair exclusive lane. Commit `check-start` before native launch, track the original native check, retain sanitized output, capture actual before/after, and commit `check-settled` before exposing durable status. Preserve command native exit independently of passed/failed/canceled/stale and configured not-run obligations. Extract `TaskController`'s definition matching (name+command+timeout), stale-review/issue policy and phase intent if useful; do not copy its locking, 32-entry overwrite behavior or selected-task executor.

Reuse `captureChanges` for staged/unstaged/untracked/pre-existing dirt and explicit non-Git/submodule/ignored/bounded coverage. Its raw-byte fingerprint is distinct from sanitized display; own task administration is excluded, check configuration is not. It is neither an exhaustive filesystem snapshot nor attribution of every diff to Cadence. Persist actual before/after/review text as owner content, with bounded omission status.

Human review binds selected graph/run/check/change identities. Reobserve under a short checkout barrier immediately before the accepted review effect and v1 publication; never hold a lane while a human dialog is open. Supply real cached `reviewContext` to HistoryWriter, matching actual current obligations and observation. Require issue acknowledgment for partial/failed/unknown execution, incomplete capture/observation and failed/stale/canceled/unrun checks. Do not clear historical failures to obtain an unqualified review.

`writer.publishTask({operationId,cwd?,result?,baseline?})` remains the only v1 publisher. Preserve its returned published/conflict/uncertain/refused status and observed identity. Existing summary limits (goal 8 KiB, plan 32 KiB, result/baseline 16 KiB, 64 activity entries, 128 KiB record, 1000 tasks/32 checks) are compatibility limits, not history truncation. Never increase them, delete checks/history or bypass strict v1 to make a new scheduler test pass. Explicit human review alone publishes done; it does not change child/check outcomes.

### Slice 6 — Wire the real current view and all retained readers

Construct `HistoryProjection(reader, environment)` with actual RAM-only `session/workspace/context/checks` and budget-aware readonly legacy inventory. `ControlContext.unavailable` is a legitimate read state when current config/task/ownership cannot be established; do not substitute an old run's context to enable actions. Keep a bounded active/current working set backed by committed facts, not an all-history execution cache.

`workspace`, `snapshot` and `checkObligations` are **bounded current-view APIs**, not archive traversal. A cold large archive without usable accelerators may return inconclusive; that is not absence or approval. The current `writer.lookup` also performs bounded authoritative scans and may be inconclusive. Do not replace it with an empty not-found response to make admission work. Reuse verified original membership hints/locators where adding a control/current-view fast path is necessary; missing or changed hints must preserve authoritative fallback/refusal. Browser read-proof tokens do not authorize command absence, recovery or execution.

Connect the actual `HistoryLive` to writer notifications and existing W1 subscribe-before-snapshot reconciliation. Include all active parents/children, then complete recent episode groups within 200 rows/512 KiB, with `horizon.historicalRuns` for the rest. Keep whole sibling updates, previousSeq chaining, 5 s watermarks, 15 s stale status and 30 s reconciliation. A viewer gap/disconnect/ring eviction cannot change execution or block recording. No-viewer capture remains mandatory.

Expose **all** existing tasks/runs/messages/tools/contents/events/checks/changes/reviews/entity/graph/detail/search/export methods; no empty-success stubs or ring-only history adapter. Future W5/W6 callers must exhaust the actual unions:

- List data page: render records, retain coverage, follow its exact `next`.
- `kind:progress`: no data/completion is implied; continue the exact authenticated request/next identity with abortable bounded UI work.
- `kind:snapshot`: initial null list snapshot discovery has selected a committed watermark; follow `next`, without treating it as data or silently rebasing subsequent pages.
- Detail/entity/graph proof-only versus data replies remain distinct. Exact-hit anchors have no search-progress token; detail may need its own proof progress.
- Search can return zero hits **and** a continuation. Only real exhaustion ends the selected retained query.
- Export consumes the real streaming iterator and verifies trailer/count/digest/original EOF; abort, revocation or missing trailer is incomplete, not successful export.

Readonly POST is selected before transmission for navigation/oversized inputs; retain GET compatibility and all current auth/Host/Origin/CSRF rules. Preserve 8 KiB headers, 1 MiB body, 8 MiB/100 ms read quantum, 512 KiB full page/progress Replies, 256 KiB detail text/stream writes, 512 KiB graph body and existing 1 MiB standalone graph/export-frame envelopes. No automatic retry of a failed GET, write-on-read or proof-only response fabricated as an empty completed page.

### Slice 7 — W1 finishes management; W5 removes the old reachable executor

After W4's actual owner passes its gates, return shared lifecycle/CLI ownership to W1/main for accepting startup/readiness, configured auth proxy route, stop/diagnose and informed recovery qualification. W3 history format3/key is explicit-new-initialization only; format2 remains readonly/preserved. Restart uses a fresh epoch, reconstructs observation/fences and **never dispatches old queues or refreshes unmatched auth work**.

Recovery must bind exact unchanged registration/lock/history digests, genuine native-local interactive authority and separate process/credential/storage acknowledgments. Reject known live/ambiguous owners. W3's guarded append is followed only by W1's revalidated exact identified service-lock release; never an arbitrary unlink, legacy-lock recovery, PID-only success, automatic stale reclaim or process signaling after ownership loss. Old unknown outcomes and damaged bytes stay unchanged; fresh Start remains required.

W5 then converts the real shell to the common client and removes reachable TaskController execution. Until that cutover, the service's lifetime v1 lock must exclude legacy supported writers. Keep existing regression intent while moving helpers; do not copy old executor source under a different name to claim compatibility.

## 5. Shared ownership acceptance checklist

| Owner | Minimal anticipated edits | Must not change incidentally |
| --- | --- | --- |
| W1/main | Actual host/CLI/lifecycle composition; original preparation/write-drain seam; closed scheduler fact/check-generation contract alignment; current access/env/config adapters; management recovery/proxy startup. | Authentication rules, grants/idempotency semantics, no-late-spawn, no private SDK imports, no different model/runtime fallback. |
| W2 owner, after handoff | Narrow real-check environment/native/output hook in the existing process path; actual fixed role/context request composition is primarily W4. | v2 wire, native-close authority, BashOperations/no-spill capture, stdin delivery, ingress budgets, sanitizer/canonical reservation repair and existing deadlines. |
| W3 owner, after handoff | Accepted-plan allocation/saved-graph read seam; scheduler facts in the shared reducer/finite read state; check generation semantics; real original-job lifecycle exposure if selected. | One writer, independent hashes/membership, expected-byte publication, quota/control headroom, format3/proof/readonly POST and preservation/recovery constraints. |
| W4 | Graph/action owner, bounded scheduler/gate, current observations/check/review adapter and integration tests. | No competing controller, SDK runtime, process launcher, DTO/reducer, storage writer or framework. |

Freeze each shared edit set before its checker runs; record replacement identities without rewriting old evidence. Nonoverlapping graph policy work can proceed separately only after main's explicit ownership assignment. The simplest order is host composition → shared seam correction → W4 action/scheduler slices → independent check → W1 accepting management → W5/W6 real clients → W7 complete qualification.

## 6. Focused qualification gates — all future work, not results of this review

1. **Portable/policy controls:** actual shared decoders and one graph builder; cycle/duplicate/role/model errors, stale grants/raw task/hints/config/env, exact escaped 96/128 KiB requests, UTF-8 16/32 KiB handoffs, capacity/fairness/deadline transitions. Inject clocks only for expiry logic; label them. Synthetic events do not qualify native overlap or timeout behavior.
2. **Real action/publication path:** isolated real coordination/TaskStore/history + ActionAdmission + actual TaskActions. Create → manual save-plan (without preflight writes) → graph read before Start → explicit Start. Duplicate/lost receipt, different command racing Start, metadata busy, altered plan/role/hints, readonly goal-only and advisory generation. Check current task/graph/raw publication identity after every stage; never rely on invented references.
3. **Actual SDK/fabricated-provider single child:** installed public peers, actual preparedWorker and real writer, genuine role hashes/current callbacks. Assert delivered stdin, actual request/tool capability/model/thinking, valid final and original close, mandatory recording, no-viewer >ring detail/search/export. Keep existing SDK 20 s/test and 15 s/child fixtures unchanged; no paid credentials or SDK/global-route mocks as acceptance.
4. **Real multi-child/gate lane:** at least two independent readonly native SDK children overlap. Concurrent tasks and canonical aliases, a waiting editor ahead of younger readers, two writers/checks never overlap, and an editor cannot overlap a readonly child. Record actual launch/close intervals plus writer facts; gate unit timestamps alone are not evidence. All processes use isolated fixture checkout/provider endpoints.
5. **Dependencies and partial results:** genuine successful predecessor result consumed byte-for-byte after durable settlement; approved range/large escaped whole result overflow; source corruption/stale context/external mutation; missing selected input; unrelated incomplete coverage warning versus required completeness. Failure closes admission while an already-running sibling finishes; no hidden retry or synthesis. Reopen the history and assert the same individual reason/outcome/coverage.
6. **Real parent checks/review:** actual shell commands exercise cwd, service-launch env pinning, secret/control stripping and exact timeout. Confirm exit0+changed files is stale, no-change successful check is not self-staled by its own generation, missing changed configured definitions remain not-run, output beyond preview remains retained or explicitly limited, and failed child+passing check+Done-with-issues never becomes execution success. Native-manual authority denied to browser callers.
7. **Stop/cancel/failure originals:** cancel while lane waiting, getAuth pending, original write stalled, immediately before spawn and while multiple children/checks run; assert all stop requests issued without N-times waits, no late spawn/refund, truthful native facts and exact pending-write accounting. Distinguish known no-launch from unknown direct-child close. Abrupt controlled crashes at accepted intent/allocation/auth/launch/native-close/result/publication windows never replay after restart. Ownership loss denies later signals/effects.
8. **Storage/recovery:** actual quota exhaustion, real filesystem failures and preserved committed prefix/unknown fences. Reuse existing kernel-ENOSPC lane with its exact namespace-only/lower-level classification; do not call it an admitted production SDK disk-full episode. Genuine W1 local recovery/lock-release and separate auth/storage acknowledgments require new actual composition evidence; W3 callback fixtures are insufficient.
9. **HTTP/current/historical composition:** real W1 auth/HTTP + W4 + W3 + shared client, including two attachments, disconnect without cancel, token rotation with admitted work continuing, stale actions, lost final updates and complete sibling snapshots. Cold/restarted missing-index data/progress/snapshot responses, selected hit detail and both complete exports remain functional without SDK construction or history writes. Test active current state separately from large historical traversal.
10. **W5/W6/W7 required later gates:** source/extracted service CLI; real native regular/fullscreen Pi; actual built isolated browser two-context/phone-sized views, full actions/check/review/history; real HTTPS proxy HTTP/WS/auth/revocation; exact package/build/assets/licenses and complete suite. No fixture HTTP client is browser acceptance. Physical phone/human, second physical machine, paid-provider, Node22/other peer and native Windows/macOS/ConPTY remain separately labeled until actually executed.

Use fresh private disk-backed roots with bytes/inodes checked, original waited process receipts and unchanged explicit budgets. Do not retry broad suites merely to obtain green or attribute old failures from a later pass. Run focused slices plus check/lint/Agent gates and independent review after implementation; main owns consolidation. Parent R1–R14/AC1–AC22 and one integrated delivery remain unchanged.

## 7. Bottom line

The retained producer/store/read foundation is sufficiently implemented and currently source-bound to main's green checks to proceed. The real readiness work is **specific owner composition**, not another research phase or new framework: accepted plan identity, per-child durable scheduler observations, original auth/write lifetime access, service-check env/output and generation semantics, then genuine W1 management. Assign those seams to one editor at a time and implement the finite scheduler against real ports. Keep production actions unavailable until that composition actually exists; keep W4 and the parent open until their native and integrated gates pass.
