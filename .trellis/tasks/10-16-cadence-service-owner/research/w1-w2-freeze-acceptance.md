# W1 → W2 reciprocal consumer freeze acceptance

## Decision

**ACCEPT — the revised W1 producer/owner-transform interfaces are implementable by W2 without a private protocol.**

No blocking counterexample remains from the four findings in `w1-w2-contract-fit.md` on the exact source identities below.
The closed contracts now represent genuine local occurrences, declaration/start/result distinctions, context and content ownership, omissions, zero-to-many owner transformation, reservation lifetime, exact final selection and independent native/durable settlement.
This is W2's consumer acceptance input to the W1-owned joint freeze, not a claim that W3 has accepted, an authorization to edit shared files, or a task-status change.

The planned single-owner move into maintained `src/worker-public.mjs` plus `src/worker-public.d.mts` is accepted as the implementation handoff described below.
Its absence today, and the absence of an actual W2 producer, are **not freeze blockers**.
W1 retains shared-file ownership until the main session explicitly assigns that move.

## Scope and evidence boundary

- `python3 ./.trellis/scripts/task.py current --source` resolved `.trellis/tasks/10-16-cadence-service-owner`, source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`.
- Read W1's curated `implement.jsonl`/`check.jsonl` context, child PRD/design/plan, parent PRD/design/plan and **both complete mandatory appendices**.
  Read the execution checkpoint, original W2 fit report, revised handoff and independent revision review, plus W2's PRD/design/plan.
- Read the complete actual `src/service-contract.ts`, all five `src/service/contracts/{core,domain,capture,history,budget}.ts` files and `src/service/ports.ts`.
  Inspected the relevant contract-test bodies, including producer/store vectors and corrected final-reference/task-context cases.
- Rechecked relevant installed public SDK declarations and agent-loop source, without importing or constructing the SDK.
  Read the complete official `docs/sdk.md`, `docs/message-types.md`, `docs/session-format.md` and SDK minimal/tools/full-control examples under the documented global Pi package root.
  Those newer documentation examples are not the selected installed peer or permission to adopt their default discovery, persistence or retry behavior.
- **Static review only:** no tests, SDK/services, provider requests, installs/network, credentials, product edits, status changes or nested agents.
  The sole authored artifact is this new report; unrelated dirty history/qualification files are untouched.
- The **114 passed / 0 failed / 0 skipped** result is existing evidence from `w1-contract-revision-review.md` and `execution-checkpoint.md`, not a run performed here.
  It remains portable codec/resource/reducer and injected-memory evidence, not native capture, durable storage or product qualification.

Parent authority applied: PRD R2/R4–R6/R8/R13; `design.md` §§2,5–6; `design-runtime-history.md` §§7–10, especially exact dependency inputs, genuine capture, pre-await accounting, independent wire/stored integrity and durable settlement; and the client/distribution appendix's one executable/package ownership policy.
Earlier terminal-only/tiny-transcript restrictions do not supersede this approved design.

## Exact accepted source identities

SHA-256 values were read from the current files and match the independent revision review's final candidate, including the corrected `history.ts` and test bodies.
Paths are repository-relative.

| Path | SHA-256 |
| --- | --- |
| `src/service-contract.ts` | `7d166451e88e89b9ef86b3e48c38716324637dd736b89d5ab679cde5b8acebff` |
| `src/service/contracts/core.ts` | `c0872f2f0dce34c5ebfb73827b5200675b4d8ecfa312b2bb722c8e4bb51afb41` |
| `src/service/contracts/domain.ts` | `f24eb52dafd058614828209135a3f9ac372232a74bcbf06c20c79ec05057b32a` |
| `src/service/contracts/capture.ts` | `1063989d0b7ae4b6a982243da272e3f01905013ba79bb145362fde1f15deddb7` |
| `src/service/contracts/history.ts` | `07810b6052e3a5c012a62388c4b77ddd24121be753294c4f63bde2c0ee48bf82` |
| `src/service/contracts/budget.ts` | `968c85e35fb1e34c8e77ded90e29c41535728077a07be041b014068362a5463d` |
| `src/service/ports.ts` | `7134c4576caa55718d8ba914bb4c4f19f2dbeed4317eba041e53614e3e6c028e` |
| `test/service-contract.test.ts` | `4f5cf173e61219912e814ae8ae5e20ea052f15b4cb9c17f60d8a197a727f545e` |

Acceptance concerns these semantics and identities, not arbitrary subsequent edits.
The relocation will necessarily have new hashes; its handoff must bind those new files and retain the same semantic/negative vectors.

## Original findings: resolved at the shared seam

### 1. Occurrence/declaration/start/result linkage — accepted

`capture.ts:36–321,334–542` provides `SourceIdentity`, `CallDeclarationLink`, block-local ownership and all relevant closed event variants.

- `call-declaration` identifies local call/message/block/index and partial/final stage independently of execution.
- `tool-start` carries its established declaration link or null; it observes SDK start, not a proven shell/file effect.
- `tool-end` carries the actual observed name/source, result detail, `isError`, association and `startObserved` without needing a fabricated start.
  Orphan/ambiguous results require `startObserved:false`; execution-only requires a start; declared results require their declaration link.
- A tool-result message can explicitly name the existing local call via `resultCallId`, rather than becoming a duplicate call.
- `tool-update.semantics` is exactly `snapshot`, not an undocumented append/delta convention.

Constructive fit: two calls with the same safe SDK ID can retain distinct local C1/C2 occurrences under different message/block links.
If an end cannot genuinely be matched, W2 can allocate a separate orphan/ambiguous result occurrence with its observed name/source and no invented start/link.
A partial declaration can remain unexecuted; a validation-rejected start can retain its error result without claiming command execution.
Unsafe source IDs can be explicitly redacted while RAM-only correlation remains possible.
None of these cases requires joining on sanitized text, nearest message or nullable/reused provider IDs.

`history.ts:1240–1492` preserves message/tool/content/omission/capture-fact forms, including declaration stage and start observation.
W2 must establish authentic associations; W3 must validate/reduce their committed linkage.
Structural decoding intentionally does not prove that a claimed occurrence was observed in the SDK.

### 2. Context/content/omission semantics — accepted

`capture.ts:44–229` supplies the missing shared semantic descriptors:

- Context components distinguish request context, prompt, instructions, role and effective system prompt.
- Handoff content identifies `dependencyIndex` and committed source `ContentRef`; the complete frozen source/run/child/range/text/coverage is in `DependencyHandoff` (`domain.ts:670–733`) and the owner handoff fact (`history.ts:829–835,919–927`).
  The descriptor need not duplicate the entire request or introduce a private range convention.
- Message blocks carry local ID, index and stream/final stage; tool blocks distinguish partial/final/execution arguments, update snapshots and results.
- `DetailDescriptor` binds ownership to the correct semantic field and UTF-8/canonical-JSON encoding.
  Final/execution arguments are ordinary canonical JSON data; partial argument text may remain UTF-8.
  JSON is rendered tool data, not a hidden control/association schema that downstream readers must guess.
- `OmittedBlock` retains owner/index/stage and safe source-type/MIME/reason metadata, with no binary or hidden-thinking body slot.
  Source truncation/capture gaps remain independently represented by `CaptureCoverage`.

Final-text selection is explicitly the ordered concatenation of **actual finalized text blocks, without inserted separators**, not the streaming preview.
Individual final blocks, call declarations and omissions remain separately addressable; `message-end.finalBlockCount` bounds the final projection.
W2 can preserve different streamed/final content and metadata-only media/opaque omissions without flattening all source content into unlabeled prose.

The context/detail owners are bound to the child through `RecordingLink` and retained `RecordOwner`; history content decoding checks descriptor/owner and field agreement (`history.ts:1438–1492`).
No raw auth/provider envelope is needed to capture normal supplied context.

### 3. Wire → owner transformation and reservation lifetime — accepted

`capture.ts:841–961` separates original `CaptureFrame` from `PublicRecordingInput`.
Original wire chunks/ends contain offsets and hashes; transformed `stored-chunk`/`stored-end` deliberately do not.
`RecordingEvent.source` and the enclosing `SourceRange` preserve worker sequence/time provenance through buffering and rechunking.
W3 owns independent stored offsets, content hashes, versions and global committed sequence.

Constructive fit for the original counterexample: a secret prefix from source frame 5 can yield no stored event yet, remain in a charged prefix lease, and combine with frame 6 into zero, one or several bounded stored chunks with source range 5–6.
An eventual tail flush references its contributing source range, not an invented new worker sequence.
W3 can append those sanitized bytes and calculate its own integrity, while W2 has already validated the original wire sequence/offset/hash.
Source ranges are provenance, not a demand that sink-call order invent another worker timeline.

The exact handoff is:

```ts
CaptureSink.reserve(budget: CaptureBudget):
  | { status: "reserved"; reservation: CaptureReservation }
  | { status: "refused"; error: PublicError };

CaptureReservation.grow(additional: CaptureBudget):
  | { status: "reserved" }
  | { status: "refused"; error: PublicError };
CaptureReservation.commit(input: PublicRecordingInput): Promise<PersistenceResult>;
CaptureReservation.release(): void;
```

`CaptureBudget` has `sourceFrames`, `retainedBytes`, `outputBytes`, `outputChunks` and `lane`.
`ports.ts:109–155` specifies reservation **before copying/awaiting**, source frames counted once, decoder/prefix retention, encoded expansion, one-shot commit and no timeout refund of an outstanding original write.
Acquire destination prefix/expansion capacity before releasing its source capacity.

`CaptureBudgetPool` (`budget.ts:13–148`) implements the accounting boundary: shared 8 MiB/2048 owner ceilings, `max(1, sourceFrames + outputChunks)` slots per lease, and data exclusion from the internal 1 MiB/256-slot control headroom.
Its worker-control lane admits only ready/capture-status/worker-failure/final, not data disguised as control.
An in-flight lease cannot be released as unused; only original settlement discharges it.
It is deliberately not a writer, sanitizer, timeout manager or total-heap guarantee.
These missing runtime bodies are W2/W3 gates, not missing protocol facts.

### 4. Exact final selection → committed result → process settlement — accepted

The explicit path now is:

```text
final(messageId, detailId)
  → WorkerCompletion.selected
  → FinalRecording(committed exact DetailCommit OR pending/refused/uncertain)
  → ProcessAccountingPort.settlement(link, completion)
  → committed process-settlement watermark
  → W4 dependency eligibility using that exact final-text ContentRef
```

`capture.ts:638–840,962–1007` defines and decodes `FinalSelection`, `DetailCommit`, `FinalRecording`, `WorkerCompletion` and `CommittedBatch`.
The batch maps `(childRunId, detailId)` to a committed `ContentRef` and watermark; it is no longer an unassociated list of references.
The selected detail must agree with the committed mapping and have field `final-text`; completion checks selected identity consistency and child identity.
W2/W3 additionally validate that this exact detail belongs to that finalized assistant message from its retained descriptor, not merely that both UUIDs decode.

`PreparedWorkerPort.launch(signal, sink): Promise<WorkerCompletion>` and `ProcessAccountingPort.settlement(link, completion): Promise<PersistenceResult>` are concrete (`ports.ts:178–195`).
The worker does not fabricate a storage reference in stdout and does not wait for a process-settlement commit that requires its own completion first.
W4 combines the returned completion with the later durable settlement receipt.

Native zero can coexist with pending/refused/uncertain recording.
`settlementOutcome`/`childSatisfied` (`capture.ts:733–815`) do not promote that state to completed; every required child needs native completion, committed final recording and a settlement watermark.
`history.ts:282–316` also prevents a non-null SDK run `result` shortcut from naming another final/streaming record/version than its exact committed selection.
The reviewed final-reference defect is corrected in the actual accepted source.

## Remaining boundaries are explicit, not private workarounds

- `domain.ts:734–854` retains role/purpose authority, 96 KiB public request and independent 128 KiB actual serialized auth-envelope limits, and strict native-success requirements.
  Exact model/auth/cwd preparation stays in the owner-only closure, not the public DTO.
- `advanceCapture` (`capture.ts:570–594`) owns header/order checks only.
  W2 owns genuine event association, detail lifecycle/hash validation, source event totals and prompt/final/drain/cleanup/stdin/native-close facts.
  Its current lack of a complete runtime association machine is not a new freeze finding.
- Ordinary parent checks use `CheckNativeSettlement`, not invented assistant-final/stdin facts.
  Owner check/change/review facts and content feed `OwnerJournalPort`, with no fictitious child.
- `AuthAccountingPort` (`ports.ts:157–177`) already accounts for private credential-free preparation/settlement separately from worker capture.
  W1/W3 must commit intent before getAuth and track its original promise after cancellation/crash.
  **Public export of private auth journals is not required for this acceptance.**
  They must not be smuggled into public capture events, nor must auth secrets be copied into transcripts.

## Installed public SDK fit: source evidence only

Installed `pi-coding-agent`, `pi-agent-core` and `pi-ai` metadata each reports **0.84.3**.
The relevant source facts still support the intended adapter:

- `node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts:57–70`: public `toolExecution` and awaited `Agent.subscribe` listeners with the active signal.
- `pi-agent-core/dist/types.d.ts:316–337,395–412`: content/details, synchronous tool updates and actual tool ID/name/args/result/error observations.
- `pi-ai/dist/types.d.ts:236–345,400–449`: text/image/thinking/tool-call blocks, optional assistant source ID, tool-result identity and content-indexed partial/final events.
- `pi-agent-core/dist/agent-loop.js:195–280,287–318,393–551`: shallow streamed message copies, separate final message, start-before-validation/nonexecution cases, collected asynchronous update emissions and separately emitted tool-result messages.
- `pi-coding-agent/dist/core/tools/bash.d.ts:22–50`: public local bash operations and synchronous `onData` seam.

Only the first path is fully prefixed above; the other SDK paths are under the same repository `node_modules/@earendil-works/` root.
These justify the representability decision, not runtime capability qualification or permission to deep-import inspected implementation files.
A newer global SDK, version string or mock cannot substitute for the selected installed public behavior.

## Single-owner executable codec handoff

W1/main retains `src/service-contract.ts`, the five contract modules, `src/service/ports.ts` and shared contract tests until an explicit editor handoff.
After reciprocal consumer agreement, assign **one W2 editor** the following bounded move:

1. Move the executable **core/domain/capture dependency closure** into maintained portable `src/worker-public.mjs`, with its public declaration owner `src/worker-public.d.mts`.
   Moving the complete dependency closure avoids a partial extraction that secretly needs a TypeScript loader in the maintained worker.
2. Remove the superseded executable TS bodies, or leave re-export/type-only shims.
   Preserve one implementation of limits, strict JSON/own-data primitives, request/frame/content/final/settlement decoders and their dependencies.
3. Keep `src/service-contract.ts` the public facade; make service/history/budget consumers reuse that same JS implementation/declaration owner.
   No parallel worker-local parser, DTO casts, limit table or validation branch; no Node/Pi/React dependency in the portable codec.
4. Reuse the **same** semantic and negative vectors through the direct JS worker import and service/browser-facing facade.
   Record relocated hashes, actual checks and any packaging/member/build impacts in the handoff; do not retain duplicate bodies merely to keep tests green.
5. Changes to semantics/limits/ports return to W1 and affected consumers before integration.
   W2 owns SDK adaptation/stateful validation/sanitization; W3 owns durable writer/stored integrity; neither silently replaces the other's contract.

This report accepts that plan; it does not perform or grant the ownership transfer itself.

## Owning implementation/qualification gates

| Owner | Required gate after freeze; not claimed executed here |
| --- | --- |
| W2 / W2-AC1 | Genuine installed-SDK traces for absent/unsafe/reused IDs, interleaving, partial/unexecuted declarations, validation-failed starts, orphan/ambiguous results, snapshot updates and result-message association; no guessed joins or duplicate executions. Validate block/detail lifecycle and actual finalized-versus-stream content. |
| W2 / W2-AC2 | Bounded own-data projection and field-aware incremental sanitization before stdout and again before owner storage, including UTF-8, split/escaped secrets, structured arguments/results and metadata-only omissions. Authenticate source ranges and original wire integrity before transformation; never export opaque/provider/auth data. |
| W2 / W2-AC3 | Public custom `ToolDefinition` with `createLocalBashOperations`, not stock bash's raw `OutputAccumulator`; actual command/cancel behavior and no Cadence raw-spill path. Trusted host tools remain outside any universal sandbox/privacy claim. |
| W2 + W3 / W2-AC4–5 | Actual fast SDK producer/slow recorder, synchronous overlapping updates, prefix/expansion reservations, queue/control caps, 5-second stalled recording, quota refusal and handled abort without waiting on the current listener's own settlement. Original unresolved writes remain charged/fenced; no late unrecorded success. |
| W2 / W2-AC4 | Version-2 request/ready/emitter/decoder together; actual serialized stdin size/delivery, malformed UTF-8/JSON/frames, sequence/hash/association/flood failures, cleanup failures, nonzero exit, cancel/timeout and unconfirmed close. Keep exact model/thinking/auth/proxy/readonly constraints, original native close and TERM/KILL/unknown bounds; emitted final never suffices. |
| W3 + W4 | Stored independent offsets/hashes/versions, exact detail mapping and committed membership; launch intent before spawn, native result/closure commit before dependents, exact frozen final-text/range input and required-child aggregation. Recording/native/publication remain separate; crash/torn/corrupt state preserves uncertainty and no replay. |
| W1 + W3 | Original auth-promise accounting, refresh/writeback crash uncertainty, no late spawn and shared writer settlement; no public private-journal export requirement. |
| W1/main + W2 + W7 | Explicit single-editor relocation, same-vector verification, new source hashes, package-local maintained JS/declarations and extracted service/worker dependency closure without source-tree/TS/global-SDK fallback. W7 retains final integrated source/package/client evidence. |

Existing inspected vectors are in `test/service-contract.test.ts:700–952` (request/frame/native boundaries), `2342–2471` (parent/check settlement), `2472–2730` (occurrences/content/omissions), `2731–2976` (transform/final mapping/reservations), `2977–3121` (owner seam) and `3788–3865` (corrected exact final and task-context correlation).
They are appropriate shared regression inputs for the relocation, not substitutes for those real runtime gates.

**Final disposition: ACCEPT for W2 consumer interface freeze.**
No new product or safety-completion claim; W1, W2 and the complete integrated delivery remain open.
