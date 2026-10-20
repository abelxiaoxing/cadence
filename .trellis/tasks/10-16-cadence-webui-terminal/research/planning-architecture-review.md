# Independent architecture planning review

## Verdict and evidence boundary

**The architecture is implementable with the inspected public Pi APIs, but the selected registration policy has one high-severity coordination gap (F1) that should be corrected before final approval.**
F2–F5 are medium-severity contract clarifications to settle before W1/W2/W3/W4 interface freeze.
None requires a smaller product, another executor, a general workflow platform, private SDK imports, or an SDK upgrade.
No critical finding is asserted.

This is **source-inspection/planning evidence only**.
No tests, SDK sessions, providers, servers, installs, credential reads, task starts, commits, or product/spec edits were performed.
Proposed verification below is **not executed evidence**.
Implementation remains unauthorized pending the user's final artifact review and subsequent explicit approval.

- Resolved the task using `python3 ./.trellis/scripts/task.py current --source`: `.trellis/tasks/10-16-cadence-webui-terminal`, session source `pi_01a1434b-d5a8-75bd-a752-9b20360b70f8` on the explicit repeat lookup.
- Read parent `prd.md`, `design.md`, `implement.md`, and `research/approved-design-boundaries.md` completely.
  Read W1–W4 child PRD/design/implementation plans completely, the assertion-disposition ledger, and relevant portions of prior source research.
- Rechecked actual Cadence source, installed Pi declarations/implementation, and reference token/auth source.
  Installed coding-agent is **0.84.3** (`node_modules/@earendil-works/pi-coding-agent/package.json:3`); reference HEAD is `e8bab487af208bc9a1ab60a821652323f598127f`.
  This review did not establish upstream working-tree cleanliness.
- Read official local SDK/model/provider/configuration/message/session-format/settings/security/containerization documentation and credential/full-control examples.
  Those global docs describe a newer API generation; the **installed declarations and implementation**, not newer examples' system-message shapes, establish the capability findings here.
- Source paths below are repository-relative unless absolute.
  `P` means `.trellis/tasks/10-16-cadence-webui-terminal`.
  Pi implementation files are inspected evidence, **not proposed import targets**.

## Findings

### F1 — High / approval blocker: overlap rejection excludes nested Git workspaces

**Selected contract:** design §3.2 (`P/design.md:83–102`) rejects overlapping registered **non-Git** roots, uses one owner/gate per canonical root, and promises exclusion of supported writers.
W4-AC1 requires edits/checks to serialize across tasks and aliases.

**Actual source:**

- `src/task-store.ts:114–139` canonicalizes with `git rev-parse --show-toplevel`, otherwise uses the actual cwd.
  It does not collapse a nested repository/submodule and its enclosing checkout into one root.
- `src/task-store.ts:192–213` hashes that returned root to select an independent `checkout.lock`.
- `src/task-store.ts:266–301` acquires/asserts/releases only that root's lock.
- The shipped code worker has write/edit/bash (`src/sdk-worker.mjs:253–269`).
  The proposed design retains those ordinary host-tool semantics; no rule forbids a parent-root assignment from editing a nested directory.

**Counterexample:** services registered at `/work/outer` and `/work/outer/nested` where both are Git roots obtain different lock/gate domains.
An outer task editing `nested/file.ts` and a nested task editing `file.ts` can therefore be admitted concurrently.
Both operate inside their declared workspace trees, with the same supported service/state-home mechanism.
This is not an external editor, arbitrary alternate state-home client, or escaped-descendant limitation.
A nested checkout being separately identifiable by Git does not make the filesystem write scopes disjoint.

**Minimal correction:** remove the Git-status qualifier.
Under one serialized registry registration operation, reject any ancestor/descendant canonical workspace-root overlap, including Git/Git and Git/non-Git pairs, while preserving an exact-root registration's existing attach/conflict behavior.
Apply the same rule to stopping/quarantined registrations; an uncertain overlapping owner must continue to fence the area.
Nonoverlapping Git worktrees need not be collapsed into one execution owner merely because they share a Git common directory.

**Future verification:** nested Git repository and submodule registration in both orders; mixed Git/non-Git overlap; concurrent registration; canonical aliases; unknown overlapping owner; disjoint roots accepted.
No fixture was created or run in this review.

**Clears when:** §3.2 and W1 coordination contract/tests explicitly cover all physical root overlaps.
No new execution architecture is needed.

### F2 — Medium / producer contract: awaited listeners do not bound every SDK producer queue

**Selected contract:** design §8 (`P/design.md:306–325`) correctly chooses awaited core-agent subscription, bounded emitter/owner queues, a bash capture adapter, and failure after stalled recording.
These are available capabilities, not a reason to force an upgrade.
However, “awaited capture” must not be implemented as an assumed end-to-end producer backpressure guarantee.

**Actual source:**

- Public `node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:58–70` exposes sequential tool execution and an awaited listener. `dist/agent.js:417–419` actually awaits listeners.
- `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.js:296–300` does not await session-level listeners, as the design already recognizes.
- `node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js:453–482` invokes tool-update emission from a synchronous callback, collects promises in `updateEvents`, and awaits them only after tool execution.
  Overlapping update callbacks are possible even when tool calls themselves execute sequentially.
- Public `node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.d.ts:19–37` gives `onData: (data: Buffer) => void`; it has no drain/pause return contract.
- `node_modules/@earendil-works/pi-ai/dist/utils/event-stream.js:2–31` has a push queue with no capacity/drain signal.
  The adapter producer starts independently (`dist/api/openai-completions.js:146–190`).
  Awaiting the agent consumer does not make this upstream queue bounded.

**Risk:** counting only frames already enqueued after an awaited sanitizer/write misses callbacks and source objects waiting to reach that queue.
Simply making `onData`/`onUpdate` async also does not stop the producer.
Calling `await session.abort()` from the awaited listener can additionally wait for the very listener that has not returned; the current worker's separately accounted abort promise (`src/sdk-worker.mjs:66–76`) is an important intent to retain.

**Minimal correction:** state in §8/W2 that synchronous callback admission reserves byte/event/in-flight budgets **before the first await**, snapshots only allowed bounded values, rejects/aborts on overflow, and never waits for its own run settlement inside the listener.
The bash adapter owns a bounded synchronous-ingress queue and accounts for any tool-update promises; a resolved SDK update callback is not a shell drain acknowledgment.
Explicitly scope the advertised 4MiB/8MiB queue bounds to Cadence-owned queues; do not describe them as a total SDK/provider memory ceiling.
Preserve the existing stall/cancel limits and source-limit disclosure rather than claim unprovided upstream backpressure.

For the bash replacement, name the intended implementation precisely: a thin public **ToolDefinition using `createLocalBashOperations`**, with Cadence's accumulator/sink.
Supplying `operations` to the stock `createBashToolDefinition` alone does not remove its `new OutputAccumulator` (`core/tools/bash.js:238–246,289–301`; `core/tools/output-accumulator.js:45–55,173–181`).
The compatible research already describes the ToolDefinition approach; promote it into the selected W2 contract so “operations adapter” is not misread.

**Future verification:** overlapping synchronous updates while the sink is stalled; queue budget before async copying; abort during an awaited listener; no raw spill; final/control drain; provider stream queued ahead of its consumer.
No capability fixture was run.

### F3 — Medium / cross-child protocol gap: dependency results have no bounded input handoff contract

**Selected contract:** design §7 allows 1–16 assignments and current/historical dependency edges (`P/design.md:257–275`). §8 permits 32MiB public detail while retaining a **128KiB entire worker request** (`P/design.md:321`). §13/R13 require truthful inspectability of the actual context supplied to each agent.

**Actual source:** the current `WorkerRequest` contains inline strings, not history references (`src/subagent-process.ts:15–23`).
`runProcess` rejects an input over 128KiB before spawn (`src/subagent-process.ts:76–79`), and the worker independently enforces the same limit (`src/sdk-worker.mjs:144–159`).
Retaining this bound is a selected design decision, not an obsolete test to remove.

**Gap:** a dependency edge currently specifies freshness but not which predecessor result/version/field is supplied, in what order, or how it fits alongside role, prompt, model and private auth in the actual request.
A valid predecessor can produce more than the entire downstream input allowance.
“Use the result” cannot mean concatenate every retained detail, silently truncate it, or let a downstream worker read the service's private store with arbitrary filesystem authority.
A 2KiB *expected-output description* is not a bound on the actual result.

**Minimal correction:** freeze a finite dependency-input selection structure in W1/W3/W4: exact predecessor run/assignment and committed result version, selected text/field/range, deterministic ordering and explicit supplied/omitted coverage.
Define one aggregate serialized request budget including JSON escaping and auth overhead.
Before auth/effects where possible, refuse an over-budget required handoff or require an explicitly revised/acknowledged selection; do not silently summarize with another model or make the preview look complete.
Retain the predecessor's full allowed history independently.
Record the exact child input projection, not just a link to a result larger than what the child received.

This does not require an arbitrary history-reading tool or removal of the 128KiB bound.
A bounded, explicitly selected handoff is sufficient.

**Future verification:** multiple predecessor outputs, one result larger than 128KiB, escaping overhead, changed result version, source-truncated input, missing committed detail, and cancellation before a refused handoff could launch.
Not run.

### F4 — Medium / scheduling authority gap: define how a blocked queue can leave “fresh review required”

**Selected contract:** design §7 says a ready node waiting ten minutes blocks for fresh user review and stale current dependencies block continuation (`P/design.md:267–275`).
The closed mutation set is create/save-plan/generate-plan/start/check/review (`P/design.md:205`), Start permits one active episode, and human review never changes execution facts (§§6–7, lines 229–232 and 283–286).

**Gap:** no selected transition says whether this block ends the episode, leaves it admitted, or may be cleared by `review`.
An implementer must not repurpose final human Done/review into queue execution consent, silently refresh the timer, or resubmit Start against a still-active episode.
The child plans defer to the parent and do not resolve this transition.

There is a related ordinary-input case that needs an explicit rule: `src/task-diff.ts:143–152,169–182` marks observations incomplete for submodules/ignored files.
“Required current context” must distinguish unchanged bounded observation, observed staleness and unverifiable required input.
Treating every incomplete whole-checkout observation as either fully current or automatically fatal is not an adequate dependency policy.

**Minimal correction:** select and document one finite exit policy.
The smallest that uses the existing action set is: expire/stop admission for the blocked episode, allow active siblings to drain, preserve completed results and blocked-node reasons, then require a separately saved/reviewed revised graph and **new explicit Start** for remaining work.
Previously completed results can be explicitly selected as historical/advisory input, never silently imported approval.
If same-episode reauthorization is intended instead, it needs its own exact payload/grant/control-revision transition; ordinary human review is not that action.
Also define readiness for incomplete observations at the dependency's declared scope, preserving explicit unavailable/stale reasons and the acknowledged bounded-observation limitation.

**Future verification:** wait expiry with another child still active; no auto-dispatch after a viewer reconnects; Done cannot unblock; new confirmation does not rerun completed children implicitly; ignored-file/submodule and genuinely stale dependency cases.
Not run.

### F5 — Medium / crash-accounting clarification: persist authentication preparation uncertainty, not just worker launch intent

**Selected contract:** design §5 correctly tracks a nonaborted auth operation separately from the caller's 30s wait (`P/design.md:182–186`); §3.3 requires shutdown/recovery to account for unknown auth work (`P/design.md:110–122`).
The §9 ordering explicitly names acceptance, launch intent and closure, but not the auth-preparation boundary (`P/design.md:343–360`).

**Actual source:** SDK auth resolution can rotate and write credentials **before any worker exists**: `node_modules/@earendil-works/pi-ai/dist/auth/resolve.js:69–110` calls `credentials.modify`, performs refresh, and validates the returned credential; `node_modules/@earendil-works/pi-coding-agent/dist/core/auth-storage.js:114–153,378–395` performs the lock-protected write.
The current `awaitWithAbort` (`src/subagent-process.ts:539–564`) only bounds a caller wait; it is not persistent operation accounting.

**Gap:** on a crash during refresh/writeback, a later owner cannot inspect the dead process's outstanding-promise set.
“Accepted, no worker launch intent” proves no *recorded worker launch*, not “no credential effect.”
Treating all such accepted/preparing episodes conservatively as credential-uncertain would be safe, but that policy is not yet explicit in the authoritative design.

**Minimal correction:** include credential-free auth-preparation intent/settlement facts in the journal, with intent committed before `getAuth` and settlement after its original promise settles; or explicitly define conservative auth uncertainty for every accepted episode whose preparation cannot be excluded.
Do not persist credential bytes/digests.
On restart, an unmatched preparation stays unknown and cannot authorize refresh replay or reset; credential diagnosis remains distinct from process-lock resolution.
Live cancellation keeps the original promise accounted even after no-launch is final for that child.
This is a small event-schema addition, not a credential transaction protocol.

**Future verification:** crash before auth intent, during fake refresh, after writeback before auth settlement, and after auth settlement before worker launch; caller timeout followed by late auth success; stop while the original auth promise is pending.
Not run.

## Verified compatible choices / no new blocker found

### Public Pi model/auth route and no late spawn

The selected public route is real: `ModelRuntime.create`, `getModel`, `getError`, and both `getAuth` overloads exist (`node_modules/@earendil-works/pi-coding-agent/dist/core/model-runtime.d.ts:5–24,53–79`).
In-memory model storage, disabled create-time refresh and absence of a resource loader are compatible with the owner role.
The model overload applies configured model headers (`dist/core/model-runtime.js:339–354`), so W1 should use it rather than only `getAuth(providerId)` when resolving a selected model.

The nonaborted operation signal is important for two independent reasons: preserving refresh/writeback settlement and avoiding SDK best-effort stale-read fallback.
`AuthStorage.readLatestData` falls back to cached state without a signal in some error paths but propagates errors with a supplied signal (`dist/core/auth-storage.js:330–365`).
Constructor reload itself swallows read errors (`307–319`), so the selected bounded prevalidation and runtime `getError()` check must remain mandatory.
These are already compatible with §5, not evidence that the plan needs a new credential store.

SDK stored-credential precedence and minimum OAuth validity are implemented (`pi-ai/dist/auth/resolve.js:30–55,69–110`).
The design appropriately refuses insufficient validity rather than assuming refresh always succeeds.
Reservations before async auth plus abort/context rechecks after awaits and immediately before launch (§7) preserve no-late-spawn intent.
A returned auth result or an accepted receipt alone must never invoke the worker.

### Legacy owner lock and recovery

Holding the unchanged v1 lock for the service lifetime is compatible with actual `TaskStore.save(..., held, ...)`, including pid/host/owner checks (`src/task-store.ts:351–399`).
The service must not reuse the old standalone `TaskStore.recover()` as its entire recovery mechanism: that helper uses exact lock equality plus local PID absence and acknowledgment (`303–316`), whereas selected §3.3 deliberately requires service-registration/history identity and process/auth accounting.
W1 already owns a distinct recovery module, so this is an implementation caution, not a discovered requirement to restore the old lifecycle.

During W1 contract freeze, spell out startup/shutdown ordering and exact service-to-v1-lock association, including crashes between lock acquisition and registration publication.
An unattributable partial lock must remain refused, not be adopted as “probably ours.”
This follows the selected preservation rule; it does not promise that every damaged lock is recoverable.

### Receipts, journal and publication

The selected command-intent → committed acceptance → launch intent → durable native settlement order is coherent.
It does not require exactly-once spawn across arbitrary crashes.
Separating task-v1 publication conflicts from native execution is necessary given the existing expected-byte save check (`src/task-store.ts:368–395`); the design preserves that distinction.

Keep duplicate lookup authenticated but ahead of fresh-epoch/grant rejection for an existing exact command, as required by §6's “same receipt after restart” behavior.
Inert partial intents and inconclusive receipt lookup must refuse, not authorize new execution.
Derived indexes must not become effect authority.
The stated preserved-prefix behavior is compatible with append-only recovery segments and does not require truncating torn tails.

### Browser/native/remote authority

No critical auth-policy contradiction found in selected §4.
Mandatory access, sole query-token bootstrap, token-free subsequent URLs, exact Host/Origin, CSRF on mutations, pre-upgrade WS auth, read-only WS commands and a distinct local capability fit together.
In particular, trusted-loopback proxy traffic is **not** native authority: remote requests still cannot supply the private capability, and the proxy's enforced forwarding assertion disqualifies them from the native route.
Do not copy upstream's token-enabled Host bypass: `/home/mirako/abel/pi-web-ui/server/index.ts:272–275` explicitly documents that reference behavior; selected §4 intentionally replaces it.

Freeze a route/admission matrix that allows normal bootstrap/navigation/subresource GET requests without inventing an Origin header, while refusing supplied foreign Origins and requiring exact Origin for mutations/WS.
Define whether already-streaming HTTP exports are interrupted at access-generation changes; closing WS alone does not revoke an in-flight export.
Compatible prior research already recommends export revocation checkpoints.
These are concrete HTTP qualification details, not grounds to replace the selected simple cookie with an account/JWT system.

### Honest recording, outcomes and limits

The distinctions between source truncation, recording failure, native closure, checks and human review are sound.
Large retained text can be paged independently of previews/rings.
Wire hashes preceding owner sanitization and independent stored hashes afterwards avoid an otherwise direct offset/integrity contradiction.
Preserving actual native exit0 while refusing overall success on capture failure is also coherent.

This review does **not** flag the declared absence of sandbox isolation, universal secret detection, universal descendant closure, hostile-writer atomic filesystem CAS, or unexecuted platform/provider qualification as concealed defects.
Nor does it propose reintroducing migration, certified execution, automatic restart continuation, a dedicated credential profile, or a partial release.

## Minimal disposition before approval / interface freeze

1. **Resolve F1 in the selected registration policy** and carry the all-root-overlap intent into W1/W4 verification.
2. Freeze F2's actual capture boundary and thin ToolDefinition accumulation replacement; keep upstream buffering limitations honest.
3. Freeze F3's exact bounded dependency handoff and F4's blocked-episode/reconfirmation transition so both clients and the scheduler share one contract.
4. Add F5's durable auth-preparation uncertainty rule to W1/W3 recovery/event ports.
5. Then obtain the user's fresh implementation approval.
   Execute the already planned real source/extracted/SDK/process/browser/terminal/crash/auth lanes later; this report supplies no passes for them.

Only this research report was authored.
Parent/child plans, product code, maintained specs and historical artifacts were not changed.
