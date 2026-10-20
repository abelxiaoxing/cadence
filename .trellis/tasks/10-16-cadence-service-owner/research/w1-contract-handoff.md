# W1 contract/admission implementation handoff

## Scope and status

First substantive W1 chunk only; **not W1 completion, a release, or parent acceptance**.
The parent approved artifacts and both mandatory appendices were read completely.
The active task was resolved through `task.py current --source` as this W1 task.
No task status was changed.

The pre-edit boundary was stated in the implementation transcript: add only the portable contract/client, admission, a necessary typed-port helper, their focused tests and this handoff.
Existing runtime surfaces, package/lock, generated output, frontend, maintained specs and unrelated archives remain untouched.

These are concrete executable contract candidates for main-session and W2/W3 review.
**Reciprocal interface-freeze approval has not occurred.**
Do not interpret this document or the injected-memory tests as that approval or as native product evidence.

## Changed files

| File                            | Responsibility                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service-contract.ts`       | Closed portable DTOs/decoders, fixed errors/statuses, canonical credential-free identity, duplicate-aware bounded JSON parsing, graph validation, worker public/capture/closure shapes, cursor/read/projection shapes. |
| `src/service-client.ts`         | Finite named control/read methods through injected transport; response correlation; observation-only snapshot/event reconciliation.                                                                                    |
| `src/service/admission.ts`      | Single-use fresh-action grants, serialized admission, durable receipt-before-effect boundary, explicit run cancellation and uncertainty fences.                                                                        |
| `src/service/ports.ts`          | Concrete owner, persistence, recording reservation, auth/process accounting, prepared-worker and projection interfaces. No implementation or fallback executor.                                                        |
| `test/service-contract.test.ts` | 67 portable/injected-memory tests; no service, SDK/provider, disk-durability or native-process qualification.                                                                                                          |
| This file                       | Review handoff and evidence limits.                                                                                                                                                                                    |

No external source was copied in this chunk.
Local `task-types.ts` UUID/check visibility and explicit-decoder conventions were adapted without importing its Node `Buffer` runtime boundary.
The finite service protocol is newly authored; upstream's general chat protocol was not imported.
Substantial pi-web-ui authentication/UI reuse and its attribution remain later owning work, not satisfied by this chunk.

## Exported contract groups

- Versions/constants: `SERVICE_PROTOCOL`, `WORKER_PROTOCOL`, `GRAPH_SCHEMA`, `HISTORY_SCHEMA`, `EXPORT_SCHEMA`, `LIMITS`, `ERROR_CODES`.
- Errors/identity: `ContractError`, `PublicError`, `ErrorCode`, `publicError`, `errorStatus`, `utf8Bytes`, `canonicalJson`, `parseWireJson`, `decodeId`, `decodeHash`, `decodeSequence`, `compareSequence`.
- Graph/context: `TaskKind`, `Purpose`, `Field`, `ModelSelection`, `RoleSelection`, `ContentRef`, `ByteRange`, `DependencySource`, `Dependency`, `Assignment`, `Graph`, `TaskVersion`, `ContextVersion`; `decodeModelSelection`, `roleForPurpose`, `decodeContentRef`, `decodeGraph`, `decodeContext`.
- Admission: `CheckSelection`, `Action`, `Issue`, `ActionPreview`, `PreflightRequest`, `Preflight`, `Command`, `CancelCommand`, `CommandIdentity`, `StoredCommand`, `Receipt`, `ReceiptLookup`, `Reply`; `decodeAction`, `decodePreview`, `decodePreflightRequest`, `decodePreflight`, `decodeCommand`, `decodeCancel`, `decodeCommandIdentity`, `decodeStoredCommand`, `decodeReceipt`, `decodeReceiptLookup`, `decodePublicError`, `decodeReply`.
- Capture/handoff: `CaptureCoverage`, `HandoffInput`, `DependencyHandoff`, `WorkerPublicRequest`, `CaptureEvent`, `CaptureFrame`, `CapturePosition`, `NativeSettlement`, `ExecutionOutcome`, `Closure`, `Publication`; `decodeCoverage`, `decodeHandoff`, `decodeWorkerPublicRequest`, `assertWorkerEnvelopeSize`, `decodeCaptureEvent`, `decodeCaptureFrame`, `advanceCapture`, `decodeNativeSettlement`.
- Read/projection: `Scope`, `ReadCursor`, `RunProjection`, `Snapshot`, `LiveEvent`, `DetailPage`, `SearchHit`, `SearchPage`; `decodeScope`, `decodeCursor`, `decodeRunProjection`, `decodeSnapshot`, `decodeLiveEvent`, `decodeDetailPage`, `decodeSearchPage`.
- Client: `ServiceTransport`, `ServiceClient`, `ObservationState`, `ProjectionTracker`.
- Admission core: `ActionAdmission`.
- Ports: `Caller`, `StoredLookup`, `AdmissionIntent`, `AdmissionCommit`, `AdmissionPersistence`, `RunTarget`, `AdmissionOwner`, `AdmissionClock`, `CommittedBatch`, `PersistenceResult`, `RecordingLink`, `PublicRecordingInput`, `CaptureReservation`, `CaptureSink`, `AuthPreparationIntent`, `AuthPreparationSettlement`, `AuthAccountingPort`, `ProcessAccountingPort`, `PreparedWorkerPort`, `ProjectionPort`.
  The ports module re-exports the single contract-owned `CommandIdentity`/`StoredCommand` definitions.

All unknown wire data is reconstructed through closed decoders; no public `any` or `Record<string, unknown>` escape hatch exists.
Descriptor validation refuses getters and non-data shapes without invoking them.
JSON text adapters must call `parseWireJson` with the actual encoded boundary limit before DTO decoding, otherwise duplicate keys and original encoded size have already been lost.
Its structural nesting ceiling is 64; this is a parser resource guard, not a model/runtime-version predicate.

## Producer/sink and admission agreement requested

### W2 producer → W3 recording sink

1. `WorkerPublicRequest` is protocol 2 and at most 96 KiB serialized before auth.
   Graph/control budgets remain separate: 512 KiB / 1 MiB.
   The owner must check the **actual** serialized anonymous-stdin envelope with `assertWorkerEnvelopeSize` after auth; 128 KiB is not increased.
2. Purpose/parent-kind/role checks prevent readonly-to-edit escalation.
   Shipped role mappings are research/review → design-explorer, diagnosis → diagnosis-worker, edit → implementation-worker.
   Actual package role hashes, model source eligibility and exact model/effective-thinking preparation remain owner/W2 obligations.
3. Frozen handoffs carry assignment/dependency index, committed source run/child/result/version/range, supplied public text and coverage.
   Whole-source/range byte counts must match; no silent clipping; 16 KiB per input and 32 KiB aggregate.
   W4/W3 must additionally resolve actual committed source bytes, hash/range UTF-8 boundaries, graph order, native settlement and current-context freshness; schema validation alone cannot prove these.
4. `CaptureFrame` has protocol/child identity, worker sequence, observed monotonic milliseconds and a closed event.
   Message/tool occurrence IDs, context/detail fields, text chunks, independent final-message detail, source-limit/redaction/omission coverage and failure/final observations are explicit.
   Tool `isError` is not a parent-check outcome.
5. `advanceCapture` validates child/header progression and ready/final ordering only.
   W2 still owns stateful detail associations, checksum validation, total/control budgets, genuine public SDK capture and incremental sanitization.
   Do not label structurally valid input authentic SDK evidence.
6. `CaptureSink.reserve(bytes, frames)` is synchronous, before producer await/copy.
   A reservation has exactly one `commit(PublicRecordingInput)` or `release()`.
   Commit returns a durable `PersistenceResult`, never browser delivery.
   W3 assigns independent stored offsets/hashes and global committed sequence.
   W2 and owner must sanitize before sink publication; types do not certify sanitization.
7. `NativeSettlement` retains native closure, exit/signal, stdin/final/cleanup and capture facts independently.
   This is the **SDK child** settlement shape, not an ordinary parent-check success predicate.
   `PreparedWorkerPort` is an owner-only closure retaining private auth in RAM, not a public credential DTO.
   W4 parent-check adapters must preserve their separate absent-input/native-exit rules.
8. `AuthAccountingPort.preparation` must commit before getAuth; `settlement` is after the original tracked promise, even after caller cancellation.
   These ports contain no auth objects, key/header values, endpoints or secret-derived hashes.
   They do not implement SDK refresh/writeback.

The maintained JS worker/public-codec integration is deliberately not edited here.
W2 must arrange a single executable codec owner with W1 rather than creating a divergent TS/JS validator copy.
That move requires a main-session shared-file handoff.

### W3 persistence → W1 admission → W4 effects

- `AdmissionPersistence.lookup` distinguishes found, conclusively absent with watermark, and inconclusive. `StoredCommand` identity excludes disposable grant/attachment IDs but includes the exact canonical action and displayed context (or cancel epoch/run).
- `commit` reserves command identity and flushes accepted receipt before returning committed.
  It atomically compares expected context and advances that task's (or create-workspace's) control revision by one.
  `AdmissionOwner.observe` must see that revision before commit resolves.
  W3/W4 must implement this exact shared-owner coordination, not independent state copies.
- `ActionAdmission.preflight` makes readonly owner observations only and issues a 120-second, attachment-bound, single-use grant.
  Unknown fields, stale displayed context, unsupported graph/model, browser manual shell, unconfigured browser check commands and stale review run/check versions refuse.
- Input is decoded/snapshotted before awaits.
  The grant binds the complete preview, including readable plan/graph, root/cwd labels, selected configuration, observation, check definitions and review issues.
  Progress watermark is not a control revision.
- `submit` observes existing receipts before checking old epoch/grant freshness.
  Same ID/canonical identity returns the recorded receipt without activating; changed identity conflicts.
  Concurrent different-ID Starts cannot consume the same control revision.
  A current active run prevents a new episode.
- Only a newly committed receipt calls synchronous `AdmissionOwner.activate`.
  This is an enqueue port, not a process launcher.
  Owner execution context is re-observed after commit.
  W4 must revalidate after preparation awaits and before spawn, independently of browser attachment.
- Accepted work survives detach, token rotation and elapsed dialog time.
  Unconsumed or still-preflighting confirmations are invalidated on departure/revocation.
  Late execution-context/ownership changes prevent activation and preserve accepted-but-not-launched uncertainty/fences rather than replaying work.
- Generate-plan remains its own readonly action; it carries no dispatchable generated graph.
  Accepting a proposed plan and Start remain separate commands.
- Cancel uses command/run/epoch identity only.
  It does not queue behind unrelated preflight admission and does not depend on a progress revision or grant.
  The writer owns atomic duplicate reservation; the owner coalesces original-handle stops.
  Recording waits are bounded by the existing 5-second recording-stall budget; a late promise remains handled and cannot replay effects.
  W3 must retain/track the original uncertain write for shutdown/recovery.
- Inconclusive/failed cancel recording still requests stop of an exactly identified current run with current authority, returning non-durable uncertainty.
  A cancellation receipt is not native closure.
  Known historical duplicate cancellation only observes its receipt.

Owner observations must resolve actual selected storage/configuration, not echo untrusted input: literal paths, current record/graph identities, configured check definitions, review run/check revisions, supplied plan references/content identities and private registration belong to the actual W1/W3/W4 adapters.
No accepting default owner/persistence implementation is shipped.

### W5/W6 client observations

`ServiceClient` exposes `preflight`, `create`, `savePlan`, `generatePlan`, `start`, `check`, `review`, `cancel`, `receipt`, `snapshot`, `detail`, `search`.
It neither mints command IDs nor retries/replays mutations.
Transport failure after a mutation is uncertain, not conclusive refusal/absence.
The transport owns authentication separately.

`ProjectionTracker.beginSnapshot()` issues a read-correlation ticket; pass it after the read to `install(snapshot, now, ticket)`.
Stale responses and committed-watermark rollback cannot replace the current view.
Its returned subscription generation rejects callbacks from old sockets.
Duplicate events are ignored; gaps, epoch/store/scope changes and heartbeat watermark mismatches require resync.
Progress events may retain the same control context.
`tick` marks stale after 15 seconds; `needsPoll` requires 30-second reconciliation even without subsequent events.
Neither connection state nor final-message prose changes recorded execution outcomes.

Read cursors bind store/scope/query/snapshot/entity/version/field/offset without an epoch, permitting restart-stable history navigation.
Detail/search response correlation validates exact cursor and content associations.
HTTP/WS authentication, subscription delivery, read access checks and export streaming/revocation are not implemented by these portable fixtures.

## Executed verification

Environment: Linux x64; Node `v26.7.0`; Bun `1.3.14`; locally installed coding-agent package identity `0.84.3` (package metadata read only, no SDK construction).
Test runner reported Vitest `4.1.10`.

| Command                                                                                                                                                   | Actual result                                                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run test -- test/service-contract.test.ts`                                                                                                           | Exit 0; 1 file, **67 passed, 0 failed, 0 skipped**. Last recorded run 22:52:54 local runner time.                                                                                                                                                                                       |
| `bun run check`                                                                                                                                           | Exit 0; syntax checks, generated operator byte comparison and whole configured TypeScript no-emit.                                                                                                                                                                                      |
| `bun run lint`                                                                                                                                            | **Exit 1**: Biome formatting failure in unowned `.trellis/tasks/10-16-cadence-webui-terminal/research/baseline/results.json`. Left untouched. Two informational pre-existing template-string suggestions in `test/package-audit.test.mjs` also appear. The script stopped before rumdl. |
| `node_modules/.bin/biome check src/service-contract.ts src/service-client.ts src/service/admission.ts src/service/ports.ts test/service-contract.test.ts` | Exit 0; five owned source/test files, no changes or findings.                                                                                                                                                                                                                           |
| `node_modules/.bin/rumdl check .`                                                                                                                         | Exit 0; 41 files under existing exclusions. Run separately because whole lint stopped at Biome.                                                                                                                                                                                         |

An earlier focused run passed 62 tests but `bun run check` caught a test fixture's widened historical-source discriminant; it was fixed with a literal type and all listed checks were rerun.
The earlier passes are overlapping runs, not additional tests.
No whole-suite/pack/new native service/paid-provider/browser/terminal success is claimed.
The supplied parent baseline remains historical, not a new run on these source bytes.

The tests cover malformed/duplicate/unknown/oversized values, UUID/versions/graph cycles and escalation, handoff limits, capture/header/native-fact distinctions, exact read identity, stale/expired/consumed grants, both same-ID and different-ID races, old-epoch/lost-reply receipt observation, failed/inconclusive persistence, no late activation, configured-check/review binding, queued departure, durable-acceptance survival, cancellation identity/outage/stall behavior, and client no-replay/reconciliation.
Their memory-port CAS and flush markers are injected mechanics—not actual disk durability, authentication or native closure.

The new handoff was also checked explicitly with `node_modules/.bin/rumdl check --no-exclude .trellis/tasks/10-16-cadence-service-owner/research/w1-contract-handoff.md`: exit 0 after formatting this owned file only.
Its initial explicit check found 55 sentence/table formatting issues, all fixed by the scoped formatter; repository exclusions were not changed.

## Source identities at handoff

| File                            | SHA-256                                                            |
| ------------------------------- | ------------------------------------------------------------------ |
| `src/service-contract.ts`       | `0101f10f47a45b9340ff278f40c68fae98b56b8dd4ef54e117230de6b0e25d48` |
| `src/service-client.ts`         | `fbfdaa793a4eac73bcc687817254f96e2f7d69172149d24b6f18716dd8dc406d` |
| `src/service/admission.ts`      | `4d3bc8a2890517ec6f7be3e4212d901b350bcec0d77408c8d532b69ffd6cc0c1` |
| `src/service/ports.ts`          | `2a1c6281d03b3dd62d1c7b6e9515f3cc9c7adbec474d5e0d29b8434eb24ce8ed` |
| `test/service-contract.test.ts` | `bc7ea085ba5d7b4774cbe84f6f0dacac4db1e8bb131b8f7895fe4fff560363c3` |

## Remaining work and editor handoff

Main session owns independent review and explicit one-editor-at-a-time handoff of these shared files.
W2/W3 should review the request/frame/detail/reservation/commit/receipt/coverage signatures together; W4 reviews control CAS, graph/handoff, configured-check/review and cancellation semantics; W5/W6 review the read/action adapters.
No other child edited or approved these files in this dispatch.

Still required in W1: real owner lifecycle/registry/overlap/v1 lock coordination, HTTP/WS/token-cookie/Host-Origin-CSRF/local capability/rotation, installed-public-SDK model/auth original-promise accounting, management/quarantine/recovery, generated service CLI/build and package edges.
In particular, there is no real auth provider, service endpoint, executable action route or persistence implementation in this chunk.

W2–W7 still own real capture/sanitization/process tests, durable history/read/search/export/v1 publication, scheduler/dependency/gates/checks/review, complete native/browser clients and substantial reference reuse, exact generated/package/license/member/spec work and integrated acceptance.
The existing exact package-member policy was deliberately not changed; distribution closure must be updated under its later ownership before pack qualification.
Current specs likewise remain unchanged by explicit assignment scope.

Preserved: all pre-existing archived research deletions/untracked material, actual credentials and `.env`, current runtime/worker/controller/shell/operator, package/lock and task status.
No dependencies installed/downloaded; no service started on the real checkout; no staging, commit, push or cleanup.
