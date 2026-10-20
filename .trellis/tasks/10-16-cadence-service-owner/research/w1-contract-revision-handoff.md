# W1 shared-contract revision handoff

## Status and scope

This revision addresses the concrete admission and shared-interface findings in `w1-w2-contract-fit.md` and `w1-w3-contract-fit.md`.
It is a revised candidate for reciprocal W2/W3/W4 review, **not joint-freeze approval, W1 completion, or product completion**.
Original reviews and handoffs remain unchanged.

Resolved the active task through `task.py current --source` to `.trellis/tasks/10-16-cadence-service-owner`.
Loaded the child artifacts, curated context, complete parent PRD/design/both appendices/implementation plan, and all three requested review reports.
Parent-approved replacement contracts take precedence over historical terminal-only constraints.
No subagents, service, SDK session, provider, actual credentials, dependency installation, task-status change, commit, or package qualification were used.

Changed owners:

- `src/service-contract.ts`: unchanged public entry path; explicit re-export facade.
- `src/service/contracts/core.ts`: shared limits, errors, strict JSON/data primitives.
- `src/service/contracts/domain.ts`: existing task/action/graph/context/handoff/request/native/cursor contracts, extracted without a second implementation.
- `src/service/contracts/capture.ts`: occurrence/content, wire-to-recording transformation, result mapping and settlement contracts.
- `src/service/contracts/history.ts`: receipts, owner journal facts, immutable/live projections, bootstrap, readers and exports.
- `src/service/contracts/budget.ts`: executable resource accounting only; no accepting persistence adapter.
- `src/service-client.ts`, `src/service/admission.ts`, `src/service/ports.ts`, `test/service-contract.test.ts`.

Internal dependency order is core → domain → capture → history → budget; consumers use the public facade.
No Node/Pi/React imports or private SDK casts were added to portable modules.
The resource pool does not implement a sink, filesystem writer, scheduler or timer.

## Finding disposition

### W3 F1 — finite admission before decoding or asynchronous retention

`ActionAdmission.preflight` and `submit` reserve synchronously before decoding/snapshotting or appending a closure to the serialized tail.
Ordinary work has a 16-entry ceiling and 32 MiB conservative encoded-data budget; each request reserves four control-envelope budgets (4 MiB), so the byte ceiling currently permits eight simultaneous ordinary entries.
This covers retained request/preview/comparison data, not total JavaScript heap or caller/network buffers.
Grants remain separately bounded by 16 viewers and the 1 MiB preview boundary.
Replacing a same-attachment confirmation no longer permits unlimited queued closures.

Cancel has a separate 16-entry/64 KiB lane (4096 bytes per entry).
When that lane is full, a synchronous exact-epoch/run/current-authority safety path still requests stop and reports non-durable uncertainty without starting another lookup/write.
`RunTarget.cancelRequested` is exposed synchronously by `AdmissionOwner.requestCancel`; repeated requests coalesce against the owner's existing bounded original-run handles.
Quota exhaustion cannot deny that authorized safety stop.
It is not a native close receipt.

One timer-bound 5000 ms reporting deadline starts at reservation, including queue time and all observe/lookup/commit/post-commit waits.
It does not depend on a wall-clock subtraction that can extend after clock rollback.
Original promises remain immediately rejection-handled, retained and charged after timeout until they actually settle.
Timeout with outstanding work fences the owner, revokes grants and never re-enters activation when the original promise later resolves.
No timeout refunds an unresolved write or authorizes replay.
Late durable acceptance remains observable through existing receipt lookup.

Existing fresh-grant, same/different-ID race, detach/rotation-after-acceptance, old-epoch receipt, configured/manual-check and concurrent-quarantine tests remain.
New tests stall all five boundaries, saturate same-attachment requests before decoding, saturate Cancel accounting, reject rotated authority, retain unresolved charges, and verify no late activation/write replay.

### W3 F2 — parent aggregate, SDK and ordinary check settlement

`RunSettlement` is explicitly discriminated:

```ts
type RunSettlement =
  | { kind: "sdk"; native: NativeSettlement;
      recording: FinalRecording; settlementSeq: string | null }
  | { kind: "parent"; outcome: ExecutionOutcome;
      required: RequiredChildSettlement[] }
  | { kind: "check"; native: CheckNativeSettlement;
      capture: CaptureCoverage; settlementSeq: string | null };
```

`RunIdentity.assignments` freezes assignment-to-child allocation, including order.
Parent projections must settle exactly that required set, not a successful subset.
Completed parents require every member's completed strict SDK-native facts, exact committed final result and committed process settlement.
There is no parent PID, native exit, stdin, assistant final, or invented collective `direct-child-closed` fact.
Receipts refuse SDK-child settlement as a parent command result.

`NativeSettlement` retains its strict existing success semantics, including delivered stdin, valid final, settled cleanup, complete mandatory capture, original zero close and no overriding failure.
`CheckNativeSettlement` instead requires actual `stdin: "not-required"`, native outcome/closure/exit/signal/duration, with no SDK final or cleanup fiction.
Owner check facts separately retain freshness/status/coverage; native zero remains visible under stale or failed recording.
`CheckObligations` preserves exact configured definitions and explicit not-run records with no invented check ID.
No partial-success enum was introduced.

### W2 findings 1–2 — genuine associations and typed public content

The capture family now includes:

- `SourceIdentity { disposition: observed | unavailable | redacted, value }`; source values are never unique occurrence joins.
- `call-declaration` with local call ID, message/block linkage, index, partial/final stage and optional argument detail.
- `tool-start` with its explicit declaration link or null; `startObserved` records SDK start observation, not proof a command/file operation happened.
- `tool-end` with actual name/source, declared/execution-only/orphan/ambiguous association and `startObserved`, without requiring a fabricated start.
- `tool-update` with the sole `semantics: "snapshot"`; no implicit append/delta interpretation.
- Tool-result messages explicitly link to the existing local call occurrence where actually established.
- `ContentOwner` for request context/prompt/instructions, role/effective system context, exact handoff input, message block/stage, tool block/stage and finalized-message text projection.
- `DetailDescriptor` binds semantic field and UTF-8/canonical-JSON encoding to that owner/stage.
  Observed partial argument JSON text can be UTF-8; finalized/execution arguments are canonical ordinary JSON data.
- `OmittedBlock` identifies observed ownership/index/stage, safe source type/MIME and omission reason, with no media or hidden-thinking body.

Finalized-message text is explicitly the ordered concatenation of actual finalized text blocks with no inserted separators, distinct from streaming content and from individual final block descriptors.
Nontext blocks remain separate declared/omitted observations.
`message-end.finalBlockCount` closes the final block projection; partial/unexecuted declarations and interrupted messages remain representable.
W2 still owns the genuine public-SDK correlation/state machine, association/hash validation and source coverage, rather than guessing nearest messages or trusting a structural codec as proof of SDK origin.

Inspected installed public text/image/tool-call/result and agent-event declarations under `node_modules/@earendil-works/pi-ai/dist/types.d.ts` and `pi-agent-core/dist/types.d.ts`.
No SDK construction or new external API route was used.

### W2 findings 3–4 — transformation reservations and exact final-result handoff

Original `CaptureFrame` remains wire validation input.
`PublicRecordingInput` no longer contains that frame:

```ts
interface PublicRecordingInput {
  link: RecordingLink;
  source: SourceRange;
  events: RecordingEvent[];
}
interface SourceRange {
  first: number; last: number;
  firstObservedMs: number; lastObservedMs: number;
}
interface RecordingEvent {
  source: SourceRange;
  event: SanitizedCaptureEvent;
}
```

Zero-to-many events represent delayed prefixes, redaction expansion/rechunking and tail flush.
Transformed `stored-chunk` carries detail occurrence/text, **not wire offset/hash**; `stored-end` carries detail/coverage.
W3 assigns independent stored offsets, hashes, versions and commit ordering.
Source sequence/time ranges retain worker-observed provenance; they are not newly invented worker frames or service-clock timestamps.

```ts
interface CaptureBudget {
  sourceFrames: number; retainedBytes: number;
  outputBytes: number; outputChunks: number;
  lane: "data" | "control";
}
interface CaptureReservation {
  grow(additional: CaptureBudget):
    { status: "reserved" } | { status: "refused"; error: PublicError };
  commit(input: PublicRecordingInput): Promise<PersistenceResult>;
  release(): void;
}
```

Reserve/grow before copying or awaiting, including encoded output expansion and retained sanitizer prefixes.
The shared `CaptureBudgetPool` enforces aggregate 8 MiB/2048 slots; a lease costs `max(1, sourceFrames + outputChunks)` while both representations are retained.
Prefix-only leases consume a slot and charged bytes; transfer must reserve the destination before releasing the source.
Data cannot consume the internal 1 MiB/256-slot owner control headroom.
These are queue reservations inside the existing ceilings, distinct from episode disk headroom and cumulative wire-frame limits.
The resource lease permits one begin, then only original-settlement release; unused leases permit one release.
A reporting timeout is not settlement.
Actual storage stalls/fencing and fast-producer/slow-recorder behavior remain W2/W3 runtime obligations.

`CommittedBatch` returns `details: DetailCommit[]` and separate `ownerDetails: OwnerDetailCommit[]`, each binding detail occurrence to committed `ContentRef` and watermark.
No provisional detail is a completed content reference.

```ts
interface WorkerCompletion {
  childRunId: string;
  native: NativeSettlement;
  selected: FinalSelection | null;
  recording: FinalRecording;
}
// FinalSelection = { messageId, detailId }
// FinalRecording = committed exact selection/detail mapping,
//   or pending/refused/uncertain with the same selected identity.
PreparedWorkerPort.launch(signal: AbortSignal, sink: CaptureSink):
  Promise<WorkerCompletion>;
ProcessAccountingPort.settlement(link: RecordingLink,
  completion: WorkerCompletion): Promise<PersistenceResult>;
```

Native completion returns before owner process-settlement commit; there is no circular requirement that the worker first manufacture that commit.
W4 uses the returned process-settlement watermark plus exact committed final detail before dependencies can run.
Native exit zero remains independent when result recording is pending/refused/uncertain.

### W3 F3 — owner-origin facts in the same writer

`OwnerJournalPort.reserve(CaptureBudget)` returns a one-shot `OwnerReservation.commit(OwnerRecordingInput)`.
It feeds the **same** W3 sequence/artifact writer as capture, auth and process accounting, not another journal.
`OwnerLink` is `{epoch, operationId, taskId, runId: string|null}` with no fictitious child.
Owner input carries actual service observation time separately from worker-source clocks.

Closed `OwnerFact` variants cover parent admission/aggregate settlement, gate, exact handoff/observation, changes, check start/settlement, human review, and publication intent/outcome.
Owner content begin/chunk/end supports plan/check/change/review text with real owner linkage.
Publication intent carries expected revision/raw identity and next revision/identity; outcome retains published/conflict/uncertain and the actually known observed bytes identity.
Conflict does not replace native execution facts or modify external bytes.
Auth accounting signatures and original-promise ownership are preserved.
Actual writer, gate, check executor and publication implementation remain W3/W4 work.

### W3 F4–F6 — immutable history, current availability and complete read seams

`ControlContext` is available with a current `ContextVersion`, or unavailable with workspace/task identity and a fixed refusal.
Historical `RunIdentity` independently retains operation/command/kind, original context/model/epoch, frozen graph reference and required child allocation.
Unsafe current task/configuration therefore does not force invented mutation authority or erase otherwise readable retained history.

Bootstrap and creation:

- `ServiceClient.session()` decodes authenticated capability/epoch/CSRF projection; no owner token or local capability value is returned.
- `workspace()` supplies the actual task-null context for first Create or an unavailable context.
- `AdmissionIntent.createdTaskId` is allocated before acceptance.
- Create receipts expose `created: {kind:"task", taskId, state:"reserved"|"published"}`; acceptance alone is explicitly not successful task publication.

Readers:

- Named client methods: tasks/runs/messages/tools/contents/events/checks/changes/reviews, graph, task/message/tool, checkObligations, detail, search and export.
- `ListRequest` binds reader/store/scope/snapshot/continuation/limit; a first request may select a null snapshot, whereas continuations require the exact resolved snapshot and reader.
- `HistoryPage` is capped at 200 entries/512 KiB, carries coverage/continuation and refuses rebasing or a nonprogressing cursor.
- `RecordOwner` retains task/run/child/entity ID **and entity version**, independently of detail-record version.
- `HistoryRecord` has closed task/run/message/tool/content/omission/owner-fact/capture-fact variants; orphan/partial/unexecuted calls are not reconstructed as starts.
- Search hits include exact ownership and existing literal UTF-8 range/detail cursor; entity readers navigate the actual containing occurrence/version, not a guessed detail-to-message version.
- `ProjectionPort` requires W3 to reject unknown/future snapshots and validate actual committed membership/hashes.
  Codec validity is not authorization or filesystem integrity.

The snapshot horizon is all active parent/child rows, followed by newest fully settled groups fitting both existing page ceilings.
Its `historicalRuns` first-page request exposes the independent complete retained run list at the snapshot watermark.
Snapshots do not embed full graphs/transcripts or silently claim to contain all retained history.

### Multi-row committed updates

Selected rule: one `LiveEvent.update` carries **all** `runs` and explicit `removed` rows at its committed watermark, plus current control availability.
`runs: []` permits metadata-only changes.
Filtered global sequences need not be numerically contiguous; `previousSeq` must match the previous delivered snapshot/update.
If a complete update cannot fit, the producer requires resync rather than splitting sibling rows across the same watermark.
The tracker validates on a copy, rejects reparented/relabeled immutable admissions, refuses removal of an active row, then installs all changes atomically.
Existing stale-socket, old snapshot ticket, heartbeat gap and periodic lost-final reconciliation remain.

### Export contract

`ExportRequest` pins store/scope/snapshot/NDJSON-or-Markdown.
`ExportFrame` has export ID and ordinal, then a closed manifest, retained record/graph/detail or Markdown chunk, and trailer.
The manifest includes exporter build identity, capture policy, protocols and coverage; original run/role/model provenance remains retained data, not reconstructed source claims.
The trailer carries completeness/coverage, prior-frame count, exact prior encoded-byte count, digest and committed watermark.
`encodeExportFrame` owns exact NDJSON and Markdown framing; digest covers prior encoded UTF-8 bytes, excluding trailer.

`ExportTracker` validates order, identity, scope, counts and watermark; its positive state is deliberately `complete-unverified-digest`, not a fabricated digest verification.
The actual streaming adapter must verify the digest and recheck access generation before every bounded output chunk, including trailer.
Revocation or client cancellation stops reading, not execution, and yields no completion trailer.
`ServiceClient.export` holds a received trailer until original EOF, rejects trailing frames and never creates a replacement trailer or retries a mutation.
Two-reader/120-second-idle policy remains the runtime port obligation.

## Executable codec transition and editor ownership

The present executable codec owner is the portable module closure behind `src/service-contract.ts`; there is no maintained-JS copy yet.
The selected W2 transition remains the parent-planned `src/worker-public.mjs` plus `src/worker-public.d.mts` route:

1. Main assigns one editor and records the handoff before W2 changes shared files.
2. Move the core/domain/capture executable dependency closure into that maintained portable JS owner, with one public declaration owner for its types.
3. Update the TS facade/history/budget imports to reuse that JS implementation; remove superseded executable TS bodies or leave only re-exports.
4. Run the same semantic/negative vectors through the JS worker import and portable service/browser-facing facade.
   No handwritten second `parseWireJson`, request/frame decoder, limit table, association DTO or validation branch.
5. W2 owns genuine SDK adaptation/stateful validation/sanitization, not a new private protocol.
   W3 owns stored integrity and commits, not rewritten wire validation.

No producer relocation or worker change was performed here.
This is the concrete handoff plan to review, not a claim that consumers already approved these revised signatures.
W2/W3 should review framing/transform/final mappings together; W4 reviews allocations/aggregate/check/publication contracts, and W5/W6 review bootstrap/read/action parity.
Main retains shared-file edit ownership until that reciprocal review completes.

## Executed verification

Environment: Linux x64, `/usr/bin/node` v26.7.0, Bun 1.3.14, Vitest 4.1.10.

| Command                                         | Result                                                                                                       |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `bun run test -- test/service-contract.test.ts` | Exit 0; **105 passed, 0 failed, 0 skipped**, one file; final runner start 23:41:01.                          |
| `bun run check`                                 | Exit 0; syntax checks, unchanged generated-operator byte check, configured whole-package TypeScript no-emit. |
| `bun run lint`                                  | Exit 0; Biome checked 164 files, rumdl checked 41 files under existing exclusions.                           |

Existing informational `useTemplate` suggestions in `test/package-audit.test.mjs` remain untouched.
Intermediate development checks exposed and then corrected the expected migration/type/format issues, two initial projection/receipt fixture failures, and one portability-test false positive from a prose `process.` token.
Do not add overlapping rerun totals to the final 105.
Tests are codec/resource-accounting/reducer and injected-memory admission/transport vectors, **not native process, real auth, durable disk, browser, terminal or provider evidence**.
No full-suite, pack, extracted distribution, durability or `check:agents` run was performed in this revision.
The main session's earlier Agent gate remains its separate evidence.

Final source SHA-256 values:

| Path                               | SHA-256                                                            |
| ---------------------------------- | ------------------------------------------------------------------ |
| `src/service-contract.ts`          | `7d166451e88e89b9ef86b3e48c38716324637dd736b89d5ab679cde5b8acebff` |
| `src/service-client.ts`            | `d6424be4b17b2d384da2c61e152d5fe44724b3426e0a8ae028d6ec83a0204582` |
| `src/service/admission.ts`         | `c44a27cfe505bb6ac524928a4682a157b291fe777ed5b8979f3f07c0cde78cbd` |
| `src/service/ports.ts`             | `7134c4576caa55718d8ba914bb4c4f19f2dbeed4317eba041e53614e3e6c028e` |
| `src/service/contracts/core.ts`    | `c0872f2f0dce34c5ebfb73827b5200675b4d8ecfa312b2bb722c8e4bb51afb41` |
| `src/service/contracts/domain.ts`  | `f24eb52dafd058614828209135a3f9ac372232a74bcbf06c20c79ec05057b32a` |
| `src/service/contracts/capture.ts` | `1063989d0b7ae4b6a982243da272e3f01905013ba79bb145362fde1f15deddb7` |
| `src/service/contracts/history.ts` | `bb958dd29f0db3177ac34a2247cb3c35a1fcb6f57396dc9053da0a8a7efbd1b4` |
| `src/service/contracts/budget.ts`  | `968c85e35fb1e34c8e77ded90e29c41535728077a07be041b014068362a5463d` |
| `test/service-contract.test.ts`    | `0b6aed8fbfc0d20f2056302e8dd34962b6da971fe96e4990756624b75f0ad007` |

## Remaining gates and preservation

Real HTTP/auth/lifecycle/model runtime, SDK worker capture, filesystem recording/search/export, scheduler/check execution, native/browser adapters and distribution remain owning-child work.
Actual origin/CSRF/rotation/export-revocation enforcement, native settlement and disk durability cannot be inferred from these types or memory fixtures.
The complete integrated product and package/member/build closure remain pending.
Exact frontend/type-package provisioning still needs its separate authorization; none was required here.

No package/lock/spec/AGENTS/controller/worker/shell edits, installs/downloads, Git mutations, unrelated archive changes, old review rewrites or status transitions were made.
Maintained spec changes are deliberately deferred to the owning integration work, rather than describing these unimplemented runtime ports as executed product behavior.
