# W1 → W2 producer-contract fit review

## Decision and evidence boundary

**NOT READY for joint W1/W2/W3 interface freeze.**
The request budgets and native-outcome separation are usable, and the installed public SDK exposes the required capture/tool extension points.
Four shared-interface gaps remain: occurrence/content linkage, typed context/content metadata, sanitized recording input, and final-result identity handoff.
These are missing cross-child facts, not a request to implement W2 during W1, add private SDK access, or reduce the approved rich-history scope.

Active-task resolution: `python3 ./.trellis/scripts/task.py current --source` returned `.trellis/tasks/10-16-cadence-service-owner`, source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`.
Read the actual contract/ports, W1 handoff/review, W2 artifacts, parent PRD/design/plan and both mandatory appendices, interface-freeze, relevant specs, and installed SDK declarations/implementation.
Official global SDK/message-type docs and SDK examples were read as documentation only; the locally installed public peer is the capability source of record.

This is **static interface/source review only**.
No SDK/provider construction, tests, services, credentials, installation, task-state changes, Git mutations, or delegation occurred.
The only authored artifact is this file.
The reported 80 passing tests belong to the prior W1 review, not this review and not native capture evidence.

Reviewed identities:

| File | SHA-256 |
| --- | --- |
| `src/service-contract.ts` | `56482a492910a9a58f3004b1ba854f0910de3b8d2cc16ba1505ab6cff118a0a0` |
| `src/service/ports.ts` | `2a1c6281d03b3dd62d1c7b6e9515f3cc9c7adbec474d5e0d29b8434eb24ce8ed` |
| `test/service-contract.test.ts` | `2fe77e940a25bb109ed4c7d342bccc08fce1b7501f097e75ebd060f193500342` |

These match the post-fix identities in `research/w1-contract-review.md`.
Installed `@earendil-works/pi-coding-agent`, `pi-agent-core`, and `pi-ai` package metadata all say `0.84.3`.
No version string alone establishes runtime eligibility.

## Authoritative requirements applied

Paths in this paragraph are under `.trellis/tasks/10-16-cadence-webui-terminal/`.

- `design-runtime-history.md:54-67`: one shared JS codec, genuine local/source occurrence identity, reused/interleaved IDs and orphan results, normal context, separate final content, metadata-only media omissions.
- `design-runtime-history.md:69-94`: public awaited capture, synchronous bounded ingress, two-stage incremental sanitization, independent wire/stored integrity, public custom bash, sequential code tools, native plus durable settlement.
- `design-runtime-history.md:9-15,29-42,110-116`: exact committed final-text/version handoffs and native/durable readiness, not final-frame success.
- `research/interface-freeze.md:13-19,23-27,34-41`: actual identity linkage, concrete recording/commit ports, pre-await reservation, and reciprocal W2/W3 review without local protocol forks.

The earlier W1 review explicitly leaves sanitizer expansion/chunking, final-reference handoff, and shared JS codec agreement open (`research/w1-contract-review.md:122-136`).
Its finding-free disposition for that focused chunk is not reciprocal consumer approval.

## Public SDK capability facts — available in source, not qualified by execution

All SDK paths below are beneath this repository's `node_modules/@earendil-works/`.
Reading implementation files here is evidence inspection, not a recommendation to deep-import them.

| Needed behavior | Actual public declaration and implementation |
| --- | --- |
| Awaited capture | `pi-coding-agent/dist/core/agent-session.d.ts:198` exposes `readonly agent`; `pi-agent-core/dist/agent.d.ts:57-70` declares awaited `Agent.subscribe(event, signal)`. `pi-agent-core/dist/agent.js:380-419` awaits listeners in order. |
| Session callback distinction | `pi-coding-agent/dist/core/agent-session.d.ts:108,278-282` declares a void listener; `dist/core/agent-session.js:295-299` invokes it without awaiting. Making that listener async is not producer backpressure. |
| Sequential code tools | `pi-agent-core/dist/agent.d.ts:57-58` exposes `toolExecution`; `dist/agent-loop.js:287-293` selects the sequential path when configured. No private setter is needed. |
| Real message/content identity | `pi-ai/dist/types.d.ts:302-327` has no mandatory assistant-message ID; `responseId` is optional. `AssistantMessageEvent` at `:400-449` supplies `contentIndex` and separate text/tool-call stream variants. `pi-agent-core/dist/agent-loop.js:203-240` emits shallow copies during streaming and the finalized message at end: object identity or a provider ID is not a universal message key. |
| Real tool/result identity | `pi-agent-core/dist/types.d.ts:395-412` has `toolCallId`, name, args, partial result/result, and `isError`, but no assistant local occurrence ID. `pi-ai/dist/types.d.ts:328-344` supplies tool-result message content/details and `toolCallId`. |
| Start is not execution proof | `pi-agent-core/dist/agent-loop.js:295-318,393-450` emits start before lookup/argument validation/approval; errors can finish without executing. `:263-280` also emits start/end for truncated calls that are deliberately not executed. |
| Synchronous overlapping ingress | `pi-agent-core/dist/types.d.ts:331-337` gives a void tool update callback. `dist/agent-loop.js:453-478` starts emissions from it, collects their promises, and awaits them later. An awaited subscriber alone does not cap all upstream queues. |
| Public spill-free bash seam | `pi-coding-agent/dist/index.d.ts:7-8,24` exports `ToolDefinition`, `defineTool`, and `createLocalBashOperations`. `dist/core/tools/bash.d.ts:22-50` exposes `exec` with synchronous `onData(Buffer)`. Stock `dist/core/tools/bash.js:243-261,289-301` still constructs/appends to `OutputAccumulator` and requests persistent snapshots. |
| Normal context, not raw payload | `pi-coding-agent/dist/core/agent-session.d.ts:301` exposes `systemPrompt`; the public worker request already carries context/instructions/prompt. No raw provider payload callback is needed to retain these allowed values. |

The public route therefore exists for W2 to qualify.
Actual awaited behavior under a fast producer/slow recorder, supported-peer refusal, cleanup, original child close, and bash no-spill behavior remain W2 native tests.
No private API, global-runtime fallback, new SDK upgrade, or provider execution was necessary to establish the source facts above.

## 1. Blocking: call occurrences cannot be linked to assistant content without an extra convention

### Current facts

`CaptureEvent` in `src/service-contract.ts:1258-1323` has local message IDs and local call IDs, but:

- `tool-start` has `callId/sourceId/name/argsDetailId` and **no message ID or assistant content-block identity**.
- `message-text` has only `messageId/detailId`; there is no typed assistant tool-call block/declaration, block ordering, or streamed-versus-final call-argument observation.
- `message-end.finalDetailId` can identify a final text/detail, but supplies no typed call-occurrence references within final message content.
- `tool-end` has `callId/resultDetailId/isError/orphan`, but no name/source metadata when the result has no preceding start.
- `detail-begin` has one owner ID; a detail owned by a tool does not also establish the tool's containing assistant message.

The closed decoders enforce exactly these keys (`decodeCaptureEvent`, `:1342-1449`).
Adding `messageId` or a block reference locally would be rejected, not transparently forwarded.

### Why it matters to the approved producer

A missing assistant source ID is normal, not exceptional.
Unsafe tool IDs must be omitted, and reused IDs cannot serve as unique joins even when safe.
After emitting local message M and local call C, the current transport contains no explicit M → C edge.
Joining by the nearest preceding message, matching sanitized args/name, or nullable/reused source ID would invent a relationship in W3/UI.

The installed SDK also distinguishes assistant `toolcall_*` content from `tool_execution_*` observations.
A partial or finalized assistant call may exist without execution; a start can fail validation without execution; an interrupted stream may have only a partial call.
Treating all of those as `tool-start`, or retaining only calls that reach execution start, loses that distinction.
For an orphan result, fabricating a start with empty arguments just to carry its name would fabricate an observation.
The SDK's finalized tool-result message is emitted separately (`pi-agent-core/dist/agent-loop.js:525-551`); its relationship to an already captured result must be defined rather than double-counted as another call.

### Minimal freeze change

Freeze a closed, local occurrence/content linkage that preserves:

1. Assistant message local ID plus content-block/occurrence identity and order.
2. Call declaration/partial arguments/final arguments separately from an observed execution start; an unexecuted or unfinished call need not receive a fabricated end.
3. Result → call association, including an explicit unresolved/orphan case carrying the actually observed name and optional safe source ID **without requiring a made-up start**.
4. No asserted association when the actual public observations are ambiguous, including reused same-name IDs; private RAM correlation must not become a guessed public edge.

This can extend the existing event family or use a shared typed content manifest; it does not require importing the upstream protocol.
Keep `message-text` versus `message-end.finalDetailId`: that is already a useful separation for differing streamed/final text.
Freeze whether each tool update is a distinct observed snapshot or a delta; the current `tool-update.detailId` alone does not specify append/replacement semantics.
W2 owns the correlation algorithm and stateful validation once these representable facts are agreed.

## 2. Blocking: context and structured/media content have storage slots but no shared semantic projection

### Current facts

- `WorkerPublicRequest` names `role/context/instructions/prompt/handoff` (`src/service-contract.ts:1196-1243`), but capture has only `ownerKind: "context"`, an otherwise unspecified `ownerId`, and generic `field: "context"` (`:1294-1301`).
  There is no frozen binding from a context detail to the request component, effective role/system prompt, or dependency input.
- `Field` is a coarse searchable field taxonomy (`:395-417`), not a content-block schema.
- `detail-begin.media` is only `"text" | "json"`; `decodeCaptureEvent` validates that label, not a normalized structured-content format (`:1415-1432`).
- `CaptureCoverage` records omission categories and overall source/observation/redaction state (`:1094-1131`), but not which content block/type was omitted or its safe media metadata.
- `ContentRef` contains record/version/field/bytes/hash only (`:498-514`).
  It does not by itself recover the above semantics after storage.

The installed SDK results contain separate `content` blocks and `details`, and images have `mimeType` plus a body that must not be exported (`pi-ai/dist/types.d.ts:251-264,328-344`; `pi-agent-core/dist/types.d.ts:316-330`).
A `binary` omission bit is useful coverage, but it is not the approved metadata-only representation of an omitted image in a particular message/result.

### Minimal freeze change

Agree a **small shared normalized descriptor/projection**, not an arbitrary upstream object:

- A declared context owner binding and component/source tag for the actually supplied context, prompt, role/system instructions and frozen handoff inputs; retain their safe content/provenance through detail references.
- Distinct text, structured tool args/result/update data, and metadata-only omitted blocks, with local owner/block identity and safe source-type/media information where actually available.
- A specified final-message content projection that can reference text and call blocks while marking excluded opaque/thinking/media data, instead of silently flattening everything to text.
- A fixed relationship between detail encoding (`text`/canonical JSON), semantic field, observation phase, and stored content reference/descriptor.

These facts may be carried in a shared, closed descriptor alongside the existing chunked bodies.
There is no need for binary bodies, arbitrary provider metadata, a second media store, or a new credential-bearing field.
Writing an undocumented JSON object or prose heading into a `media: "json"`/text body would technically fit the current string slot, but would leave W3 and clients to invent another decoding/projection contract.
That is the missing freeze agreement; bounded field-aware projection/sanitization itself is W2 implementation work.

## 3. Blocking: the recording input conflates original worker framing with post-owner-sanitizer output

### Current facts

`PublicRecordingInput.frame` is exactly `CaptureFrame` (`src/service/ports.ts:96-103`).
`CaptureReservation.commit` accepts one such input once, while `reserve(bytes, frames)` accepts a count without a defined accounting representation (`:104-118`).
The comment correctly requires validation/sanitization before the sink and independent stored offsets/hashes.
However, the input still contains the worker's `workerSeq`, bounded `detail-chunk.offset/text`, and `detail-end.bytes/sha256` (`src/service-contract.ts:1302-1330,1433-1449,1485-1537`).

`advanceCapture` requires exactly the next worker sequence and original child/ready/final ordering.
Each decoded chunk is at most 8 KiB and an encoded frame at most 64 KiB.
There is no distinct sanitized recording-event type, source-frame range, multi-output mapping, or specified rule for the transformed offset/hash fields.

### Concrete incompatibility to settle

The owner has its own secrets which are deliberately not supplied to the worker.
Its incremental sanitizer can hold a prefix from frame N until N+1, remove bytes, or expand a replacement enough to require rechunking.
Consequently a validated input frame can yield zero, one, or several stored chunks; stored offsets and the final checksum need not equal the wire values.

Keeping the original offsets/hashes beside transformed text would be false integrity metadata.
Replacing them makes that object a transformed recording event, not the original validated worker frame.
Splitting it requires a defined relationship to worker sequence and byte/frame reservation, not invented extra worker events or a whole-detail buffer outside the queue budget.
The current signatures/comments do not select that relationship.
This is a cross-child contract gap even though an implementation could invent local conventions to work around it.

### Minimal freeze change

Separate original wire validation from the sanitized sink contract, or specify an equivalently unambiguous typed transform:

1. Validate worker sequence, offsets, byte totals and hashes in W2 **before** owner sanitization.
2. Give recording output safe source provenance (child/detail/occurrence and source sequence or sequence range), without pretending transformed chunks are newly observed worker frames.
3. Permit zero-to-many bounded sanitized output chunks and final sanitizer-tail flush; W3 owns independent stored offsets/hashes/commit order.
4. Define reservation units and lifetime: source event/in-flight allowance plus bounded retained/output bytes and chunk count, including prefix state, encoded expansion and rechunking; reserve before copying/awaiting and fail closed before unreserved retention.
5. Preserve the existing worker/owner ceilings, stall timeout and control headroom; source-frame totals and stored-chunk totals are distinct counters.

No particular queue implementation is demanded.
A batch reservation or per-output reservation can work if the exact one-shot consumption, expansion accounting and source linkage are frozen together.
The present synchronous reservation shape is a good starting point, not evidence that those rules already exist.
The parent explicitly requires independent wire/stored integrity (`design-runtime-history.md:77-80`).

## 4. Blocking: native completion does not deliver a typed identity for its committed final result

### Current facts

- Worker `final` names a `messageId/detailId` (`src/service-contract.ts:1322`).
- `NativeSettlement.final` is only `valid|missing|invalid`; it has no final message/detail identity (`:1538-1548`).
- `PreparedWorkerPort.launch(signal, sink)` returns only `Promise<NativeSettlement>` (`src/service/ports.ts:156-158`).
- `CommittedBatch.references` is an unassociated `ContentRef[]` (`:82-85`); there is no declared detail-ID → content-reference mapping or rule assigning a worker detail ID as `recordId`.
- `ProcessAccountingPort.settlement` then requires `finalResult: ContentRef | null` (`:141-150`), while dependency handoffs require a committed `final-text` reference/version (`src/service-contract.ts:1133-1194`).

A caller can wrap the sink and remember callbacks, but that alone does not define which reference belongs to the final detail or which committed version is the dependency result.
Selecting the last reference, the last assistant text, or a matching hash/field is not an identity contract.
The current shape also does not say how a final result awaiting/refused persistence is returned alongside an independently known native exit zero.

### Minimal freeze change

Freeze an explicit identity path:

`final(message occurrence, detail occurrence) → correlated committed ContentRef + watermark → process settlement → dependency result`.

The minimum is a typed mapping in recording commit results and a typed worker completion/final-selection handoff (or an explicit equivalent sink resolver).
State that the selected result is the `final-text` projection of that exact finalized assistant message, not the streaming preview or whichever content record was written last.
Make pending/refused/uncertain recording distinguishable from a committed result; preserve native close/exit facts even when the recording half fails.
Only committed process settlement plus the exact committed result may unblock a dependent.

Do **not** put a durable content reference into the child's stdout as though the child owned storage.
Do **not** make a native `completed` observation or emitted final frame sufficient for scheduler success.
W2 still owns prompt/cleanup/stdin/native validation, and W3 still owns durable result/settlement publication.
The missing piece is how their concrete ports exchange the identity, not their unimplemented runtime bodies.

## What already fits; what remains ordinary W2 work

- `decodeWorkerPublicRequest`, `decodeHandoff`, and `assertWorkerEnvelopeSize` (`src/service-contract.ts:1146-1256`) preserve 96 KiB public/128 KiB actual envelope budgets, exact bounded predecessor text, local IDs, purpose/role checks and secret-free selection.
  Actual model/auth/cwd/tool preparation belongs in the owner-only closure; their absence from this public DTO is not a defect.
- Separate `message-text` and `message-end.finalDetailId` permit streamed and final text to differ.
  They need the agreed content/linkage semantics above, not a return to a single clipped transcript string.
- `NativeSettlement` already separates closure, exit/signal, required stdin, final validity, cleanup and capture (`:1538-1597`).
  It retains exit zero under a failed overall result, and accepts observed Windows signed/unsigned status values without treating them as success.
- `CaptureCoverage` already distinguishes observed completeness from original-source availability and redaction.
  Source truncation need not become a false capture gap; an actually incomplete mandatory capture must not become successful.
- `advanceCapture` is explicitly only a header/order validator (`:1513-1537`).
  Not implementing a complete detail/call state machine there is **not** a defect; W2 owns it.
- The sanitizer algorithm, descriptor-safe bounded SDK snapshots, genuine occurrence maps, bash accumulator, stdout/owner queues, control/data accounting, handled abort/drain, original process close and real fault/flood tests are W2 implementation responsibilities.
  Their absence from this first W1 chunk is not an additional freeze finding.
- Ordinary parent-check capture/closure must not fake SDK message/final observations to fit `NativeSettlement`; this review does not require a second check executor or move W4 checks into tools.

`test/service-contract.test.ts:740-851` validates individual variants/header progression; its final-frame fixture can reference otherwise undeclared random message/detail IDs because it deliberately does not test association validation.
`:852-888` tests native codec distinctions.
These are useful codec checks, but neither they nor the prior total of 80 establish actual message/tool linkage, sanitizer expansion, disk commits or SDK behavior.

## Shared executable codec and minimal next handoff

`src/service-contract.ts` currently owns executable request/capture decoders and limits.
The maintained worker is JavaScript, and the planned `src/worker-public.mjs` plus declaration does not yet exist.
That absence alone is **not** a W1 runtime defect: the parent assigns its implementation to W2.
But the joint freeze must select one executable owner and grant the shared-file move before W2 starts, rather than accepting a second handwritten JS copy of `decodeCaptureEvent`, `parseWireJson`, limits or request validation.
The W1 handoff already acknowledges this requirement (`research/w1-contract-handoff.md:83-85`).
The parent-selected maintained JS codec, with portable TS imports/re-exports/declarations under one-editor ownership, is compatible; no Node/Pi dependency may be introduced into the portable contract.

Minimal follow-up, with no product-scope or resource-limit change:

1. W1 assigns one shared-file editor; W2/W3 agree the four fact sets above and the JS codec ownership/export arrangement.
2. Amend the shared DTO/port signatures and their precise ordering/mapping semantics; do not solve them with child-local casts or undocumented JSON bodies.
3. Add shared contract vectors for missing/redacted/reused IDs, orphan/no-execution calls, differing streamed/final content, context/media descriptors, zero-to-many sanitized chunks, and final-reference/recording failure correlation.
4. Record new source identities and reciprocal W2/W3 acceptance before calling the interface frozen.
5. Leave native SDK/backpressure/bash/process and actual persistence qualification to the started owning children, with their real evidence lanes.

**Bottom line:** the public SDK is not the identified blocker; the current frozen-candidate DTOs omit essential joins and transform/result semantics.
Resolve those narrow shared contracts first, then W2 can implement the complete approved producer without private APIs, duplicated codecs or fabricated associations.
