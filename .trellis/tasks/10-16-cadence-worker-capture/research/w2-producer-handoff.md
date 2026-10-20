# W2 rich producer and native recording handoff

## Disposition

The actual v2 producer/decoder/native-launch boundary is implemented and locally tested, not merely a schema relocation.
Ready for independent implementation review and W3/W4 composition; this report does **not** close W2 or qualify the integrated product.
No task status, W1 implementation, shared frozen DTO/port semantics, package/lock, maintained spec, credential profile, consumer history or Git state was changed.
The earlier relocation/freeze identities and failed experiments remain historical, not rebound to these bytes.

[Evidence and current source identities](w2-producer-checks/producer-evidence.json) and [assertion dispositions](w2-producer-checks/assertion-map.json) are the machine-readable handoff.
All paths below are repository-relative.

## Implemented owners

| Owner                                 | Actual responsibility                                                                                                                                                                                                                         |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sdk-worker.mjs`                  | Mandatory v2 private envelope/public-request validation; unchanged literal exact model/auth/proxy/thinking setup; awaited public core subscription; sequential public tools; context/handoff, capture/final and independent cleanup.          |
| `src/worker-capture.mjs` / `.d.mts`   | One stateful original-wire validator used by emitter and native parent; message/call/block/detail relationships, original SHA-256/offsets, final text membership, frame/data/control limits; bounded output queue and genuine SDK projection. |
| `src/worker-redaction.mjs` / `.d.mts` | Own-data selection/measurement, incremental literal/control/heuristic sanitization, escaped JSON strings and sensitive fields, streamed large ordinary JSON tool values. No provider error/envelope serialization.                            |
| `src/worker-tools.mjs` / `.d.mts`     | Narrow public bash definition with injected public `createLocalBashOperations`; bounded redacted accumulation, fatal UTF-8, synchronous update ingress and one shared worker queue. No stock bash definition or raw accumulator/spill.        |
| `src/worker-recording.ts`             | Mandatory supplied sink, preallocated parser retention, original wire-to-stored transformation, owner-only second secret set, prefix/expansion leases, serialized original commits, five-second reporting stall and exact final mapping.      |
| `src/subagent-process.ts`             | The single native launcher/close/stdin/TERM/KILL/unknown implementation; v2 decoding, legacy presentation adapter and service prepared-context adapter. Network policy still belongs to unchanged `src/sdk-network.ts`.                       |

`src/worker-public.mjs` and its declaration remain the one relocated portable codec/limit/DTO implementation.
No worker-local protocol or v1 parser was retained.
W1 facade/shims/history/budget/ports/model/HTTP/coordination were not edited.
The new helpers are maintained package-local JavaScript, not generated code or a TypeScript fallback for the child.

## W1 / W3 / W4 wiring

```ts
preparedWorker(prepared: PreparedModelContext,
  request: WorkerPublicRequest, link: RecordingLink,
  ownerSecrets: readonly string[], timeoutMs?: number)
// returns { request, launch(signal, sink: CaptureSink): Promise<WorkerCompletion> }
```

1. W4 must commit its existing `ProcessAccountingPort.launchIntent` before calling `launch` and retain the preparation/checkout reservation.
2. `PreparedModelContext.consume` encodes its actual RAM-only material and immediately enters the same native launcher.
   The actual serialized envelope is independently bounded.
   Request/link mismatch, consumed preparation, abort and missing sink cannot launch.
3. The anonymous stdin envelope is `{request,cwd,model,auth}`; `request` is the existing shared v2 public DTO.
   Browser/local access secrets are not inserted into it.
4. Worker frames are validated for identity, order, detail integrity and association **before** owner redaction.
   Stored events carry source ranges, never original hashes/offsets masquerading as stored integrity.
5. `WorkerRecording` consumes the existing synchronous `reserve/grow`, one-shot `commit` and unused-lease `release` port.
   W3 assigns independent content references/hashes/offsets and committed sequence.
6. Native facts and exact selected `(messageId,detailId)` return separately from final recording (`committed/pending/refused/uncertain`).
   A late original write does not retroactively repair the returned failure/uncertainty.
7. W4 must commit the original `WorkerCompletion` through `ProcessAccountingPort.settlement` before dependency eligibility.
   There is no worker wait for its own process-settlement commit, fabricated production ContentRef, in-memory durable fallback or accepting default sink.

The prepared adapter snapshots the recording link and checks public request equality during consumption.
Caller/W1 freshness, durable launch authorization and service quarantine remain their existing owners; this adapter is not an alternate scheduler/admission system.
W1's configured **service-auth** startup-route refusal is unchanged.
Worker proxy qualification does not enable or qualify service-auth networking.

### Temporary W5 compatibility seam

`runWorker(WorkerRequest, signal, progress?, timeout?)` remains only for the old foreground controller until W5 removes embedded production execution.
It constructs synthetic routing IDs and a v2 public request, uses the **same** `launchEncoded → runProcess → sdk-worker.mjs` path and returns the old bounded presentation/native `RunResult`.
Those IDs and results are not durable service records.
This adapter has no sink, makes no storage-success assertion and is not a service fallback.
W5 must remove this reachability when the native shell becomes a service client.

## Capture and resource semantics

- Await `session.agent.subscribe`, not synchronous AgentSession forwarding.
  Require an existing supported public execution mode before setting/reading back sequential execution; assigning a new ignored JavaScript property is not capability support.
  Prompt hooks retain original receiver, return/promise/throw identity and zero retries.
- Local UUID occurrences are authoritative associations.
  Partial/final declarations retain their actual message/content-index link, including a source ID learned later.
  Raw source IDs remain RAM correlation keys; unsafe IDs publish a redacted disposition.
- Tool declaration/start/result are separate.
  Unique genuine raw ID/name matches may bind occurrences; ambiguous/orphan observations never invent a start or nearest-message join.
  An unresolved started occurrence prevents a valid final.
- Streamed text and finalized blocks are distinct fields.
  Final selection is the ordered finalized text concatenation without inserted separators; parent validation also checks its hash/bytes against finalized text blocks.
  Hidden thinking/media bodies are not read/exported; omissions are explicit.
- Context components and frozen handoff sources are recorded before prompt.
  The effective system prompt comes from the public session getter.
  The `role` component contains selected role/hash metadata; full supplied instruction text is separately recorded.
- Worker output, synchronous tool-update copies and sanitizer retention share one 4 MiB/1024-slot accounting domain, including internal control headroom.
  Source update capacity is reserved before selecting/copying ordinary values; actual size measurement does not encode a whole large source string.
- Ordinary large tool JSON is streamed and escaped after field sanitization, rather than collected into an unbounded intermediate JSON string.
  Each detail still has the shared 32 MiB ceiling.
- Bash uses public command/cwd/signal/timeout operations.
  It retains bounded **redacted** result text, not a spill path.
  Update previews are explicitly source-limited snapshots; the final result retains the full allowed redacted output.
  Invalid UTF-8 or capture exhaustion aborts/fails rather than manufacturing successful replacement text.
- Owner parser/control retention is reserved before spawn.
  Data/control source leases, output expansion and retained prefixes share W3's existing 8 MiB/2048 accounting.
  Destination capacity precedes prefix release.
  Original pending writes stay charged after a five-second reporting stall; no viewer participates in the sink.
- Required stdin, actual native close, cleanup failure, cancel/timeout and unconfirmed stop remain independent gates.
  The service native projection reports cleanup as unconfirmed for nonzero closure: a provider/protocol failure does not establish which teardown operation failed.
  Fixed worker diagnostics and original nonzero outcomes remain preserved; no successful cleanup is inferred from an error.
  General checks retain ordinary environment/ignored absent stdin and original command semantics.

These are bounded Cadence-owned queues and projections, **not** a total SDK/provider/heap bound, sandbox, universal secret detector or descendant-closure guarantee.
Canonical JSON keys that become ambiguous/reordered through secret redaction refuse rather than buffering/reordering an unbounded object.
An unfinished/invalid partial argument JSON stream remains an incomplete prefix and refuses final capture rather than silently discarding its pending syntax.
Source-absent/ambiguous tool events are retained without invented associations; when starts cannot genuinely be closed, successful final settlement is intentionally unavailable.

## Verification and assertion replacements

Final focused command (available Linux host):

```sh
bun run test -- test/service-contract.test.ts test/service-owner.test.ts test/service-auth.test.ts test/service-model-context.test.ts test/lightweight-store-controller.test.ts test/lightweight-process-diff.test.ts test/lightweight-sdk.test.ts test/worker-public.test.ts test/worker-capture.test.ts test/worker-recording.test.ts
```

**955 passed / 0 failed / 0 skipped, 10 files, 221.45s.**
This includes the previous eight-file 940-case set with intentionally migrated fixture representations, plus 15 new cases.
The shared 114 codec case bodies still execute through two entry surfaces (228 included cases); those overlapping semantics are not 228 independent capabilities.
Separate development reruns are not added to the total.
Whole `check`, `lint` and `check:agents` are recorded separately in the evidence index.

New cases are explicitly separated:

- **Five actual SDK/native cases:** three guarded direct worker cases (readonly response, real bash output beyond stock preview size with exact returned tool content and no spill, invalid bash UTF-8 refusal), and two prepared-launch cases with real SDK plus controlled disk writes.
- **Ten portable/injected cases:** split literal/escaped field sanitization; original wire/hash/association negatives; partial/final/unexecuted/omitted-source projection; controlled real Writable queue saturation; 100,000-data/256-control limits; absent/reused/unsafe occurrence vectors.
  The aggregate-byte counter probe is explicitly an arithmetic injection, not a native 128 MiB flood.
- The two disk cases use real `appendFile` and the actual shared budget pool, but **fixture commit references**, not W3's durable journal.
  The stalled case proves original charges remain after reporting and clear only after the original gate/write settles; no retroactive successful completion.
- Existing genuine loopback API/auth/header/null/baseURL/Azure/xhigh/tool-result and DIRECT/validated-proxy lanes remain.
  Public-resource and effective-option mocks remain labelled mocks with original native cleanup/EOF/exit assertions where applicable.

Intentional replacements, not deleted safety intent:

- Protocol fixtures now carry full v2 detail/hash/link frames. `captureSummary` validates every original v2 frame before projecting the old ready/tool/final assertion vocabulary; raw secrecy/native wait assertions still use unprojected bytes.
- Old 16 KiB final / 256 KiB transcript refusal lanes now positively prove retained final sizes (16,385 bytes and more than 2 MiB).
  New shared limits are independently tested; no preview is called the retained archive.
- Metadata/flood attempts invalid under the stricter closed v2 schema refuse earlier.
  The diagnostic-room control now exercises the maintained writer at the new remaining-byte boundary with explicitly injected accounting, not invented native output.
- `max` thinking is outside the frozen v2 enum and now refuses before SDK construction; valid enum equality and effective getter refusals remain tested.
- The Codex routing source pin was deliberately advanced to the reviewed current worker bytes; old receipts/hashes remain unchanged.
  The evidence manifest binds the complete new helper closure as well.

## Preserved failed development evidence

`w2-producer-checks/` and its `development/` directory retain the intermediate failures, including the initial 256 legacy-fixture failures, fixture API/serialization/lease-method corrections, new 100,000-frame test's initial default-budget timeout, and the final UTF-8 fixture initially sending the wrong command.
The dedicated new CPU-bound frame test uses 30s; existing native SDK 20s/child15s budgets were not increased.
Temporary stack-debug experiments used fabricated loopback material only and were removed before qualification.
An early bash assertion matched text in the assistant's **arguments**, not the returned tool message.
It was corrected to assert the exact tool-role returned content; the real command and no-spill control were rerun afterward.
A source counter accidentally made const by an intermediate formatter pass was corrected and all final lanes rerun.
Earlier 954-case passing snapshots precede subsequent shared-queue/UTF-8 refinements and are not the final identity claim.

## Remaining composition / qualification

- Independent W2 review remains required; no task acceptance/status was marked passed by this implement agent.
- W3 must supply its real single-writer sink, validate committed membership/independent stored integrity, persist final/native settlement and exercise its crash/quota/flush semantics.
  Controlled fixture disk writes are not that evidence.
- W4 must wire durable launch/settlement, exact dependency handoffs and unknown/quarantine ownership.
  W5 owns removal of the legacy embedded path.
- W7 must add every maintained helper/declaration to the exact source/extracted package closure and build audits.
  No package expectations were weakened, no archive/source fallback added and no pack/release PASS claimed.
- Actual SDK source-absent/reused/orphan edge traces are supplemented by labelled public-event injection; do not relabel those injected associations as provider-wire evidence.
- No full repository suite, packaged service/client, physical-human, paid-provider, Node22, Windows/macOS or ConPTY qualification was executed here.
  The available-host identity is Node26.7.0/Linux x64 with installed Pi packages0.84.3 and Bun1.3.14.
