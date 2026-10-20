# Proposed execution graph + durable public history contract

## 1. Status, evidence and integration boundary

- Planning recommendation for the **complete** approved PRD (especially R2/R4–8/R13, AC2/4/7/9–12/18–21), not implementation approval, executed tests or a staged/ring-only product.
  Main-session `design.md` remains authoritative.
- Active task resolved through `python3 ./.trellis/scripts/task.py current --source`; read the rewritten `prd.md`, `multi-subagent-scheduling-events.md`, `complete-workspace-reuse.md` and maintained backend workflow/storage/logging specs.
  Only this research file is intentionally written; no agents, credentials, installs, services, model calls, tests or task start.
- Source anchors: `src/task-store.ts:193–214,266–399` (namespace/lock/strict v1/single-file save); `src/task-types.ts:1–61` (record/outcome); `src/task-controller.ts:145–290` (checks/authority); `src/subagent-process.ts:107–253` (native close/cancel/framing); `src/sdk-worker.mjs:231–402` (fixed tools/session/events); `src/verification-diagnostics.ts` (whole-string sanitizer).
- Installed Pi coding-agent/agent-core/pi-ai are **0.84.3**.
  Read global `docs/sdk.md`, `message-types.md`, `session-format.md`, `cli-integration.md`, `json.md` completely and SDK examples `01-minimal.ts`, `12-full-control.ts`; installed public declarations/source govern actual API details.
  No Context7 invocation: that CLI can read configured credentials, excluded by this delegation.
- `U:` = `/home/mirako/abel/pi-web-ui`, HEAD inspected as `e8bab487af208bc9a1ab60a821652323f598127f`.
  Reuse inventory below builds on the complete-workspace report; citations are source inspection, never qualification.

## 2. Frozen graph and explicit admission

- Versioned `Graph{schema:"cadence-graph/2",taskId,planRevision,planDigest,checkoutId,cwd,assignments[]}`; persist a sanitized readable plan alongside its graph.
  Graph digest detects change, **not** certification or authority.
  Edits create another graph revision; a running graph never expands.
- `Assignment{id,label,purpose:"research"|"diagnosis"|"review"|"edit",instructionsRef,expectedOutput,dependencies:[{id,inputMode:"current"|"historical-context"}],role:{id,packageDigest,instructionsRef},model:{provider,id,api,thinkingLevel,configRevision},timeoutMs}`.
  All assignments are required; one attempt per assignment per parent run, no optional-success arithmetic, retry policy or recursive tool.
  Checks and recovery cannot be smuggled in as purpose values.
- Use UUID-v4 task/parentRun/childRun IDs; assignment IDs are unique within the frozen graph (ASCII `[a-z][a-z0-9-]{0,47}`).
  Runtime row adds lifecycle, outcome, closure (`not-launched|direct-child-closed|unconfirmed`), block reason, observations, result refs and capture coverage; do not mutate the frozen definition to report progress.
- Validate 1–16 nodes, at most 15 dependencies/node, no missing/self/duplicate edges, acyclic graph, label ≤256 B, instruction ≤16 KiB/node, expected output ≤2 KiB, whole graph ≤512 KiB.
  Topological order with graph-order tie break is deterministic.
  An invalid node refuses the whole Start before admission.
- Resolve roles from shipped `src/agent-registry.ts` definitions: edit→implementation-worker, research/review→design-explorer plus explicit advisory-review instructions, diagnosis→diagnosis-worker.
  Pin exact effective instructions, including bounded untrusted AGENTS context; capability derives from purpose/parent kind, never role text.
  Research/diagnosis parents cannot contain edit nodes or parent shell checks.
- Freeze provider/model/API/thinking and selected agent-directory configuration identity at Start; use the service's approved existing-Pi auth resolver.
  Credentials are RAM-only and may refresh through coordinated SDK writeback; refresh alone is not a model change.
  Auth/model/config mismatch or fallback refuses; UI selection changes never retarget queued work.
  Configuration revision describes public executable model policy, not the auth-file hash; never hash/store credential values as graph metadata.
- `Start{actionId,serviceEpoch,taskId,expectedTaskBytesIdentity,expectedTaskRevision,graphDigest,contextRevision,confirmationId}` consumes a fresh single-use confirmation bound to displayed cwd/graph/model/tools/limits.
  Default confirmation TTL 60 s; first dispatch must begin within 15 min; episode deadline 6 h.
  Deadline expiry stops admission and requests active cancellation, not continuation.
- Persist one accepted command receipt before acknowledging or dispatching.
  Same actionId + same canonical payload returns the same receipt; same ID + different payload is conflict.
  Validate old receipts before rejecting an old epoch, so a lost response remains discoverable; an unseen old-epoch action never executes.
  Receipts are retained with history, not evicted by TTL.
- Planning generation is a separately confirmed readonly episode with its own recorded context/results; a generated graph is only a proposal.
  Checks/review are separate explicit commands, never automatically scheduled graph nodes.
  One active parent episode per task; historical prior children are not imported as new execution success.

## 3. Scheduling, exclusion and freshness

- One service-owned dispatcher, not multiple `TaskController.start()` instances.
  Limits: 4 preparing/running/closing process reservations service-wide, at most 2 readonly children/checkout, 8 admitted episodes and 128 queued assignments service-wide.
  Parent checks consume a process slot too and require the target parent graph to have drained; confirmation binds its settled state and check definition.
  Refuse excess admission; do not enqueue unbounded browser requests.
- Reserve slot and checkout gate **before** async auth/preparation; recheck abort/context/owner/store after every await and immediately before spawn.
  Auth preparation retains 30 s abortable bound; children default to 20 min.
  No automatic retries, SDK compaction/recovery or model substitutions; preserve existing no-discovery/in-memory-session setup.
- Outer gate: hold existing `checkout.lock` once for active service work/metadata transitions in that canonical checkout; owner reuses its token for v1 publication.
  Private v2 journal writes additionally have one serialized writer.
  Browsing acquires neither gate and creates nothing.
- Inner gate across **all tasks** in a checkout: multiple readonly assignments share; edit or parent check is exclusive against reads, edits and checks for its entire preparation→confirmed-close interval.
  Checks may generate files/caches.
  One service writer does not prove arbitrary shell descendants are serialized; set/verify public `session.agent.toolExecution="sequential"` for code workers too.
- Fairness: round-robin admitted parents, oldest eligible checkout ticket first; a waiting writer blocks younger readers but not already admitted readers.
  Do not reserve a process slot for a dependency-blocked node.
  Terminal states release slots only after confirmed no-launch/direct-child close; unknown closure retains reservation and checkout quarantine.
- Git aliases/subdirectories converge through `resolveWorkspace`; reject overlapping non-Git registrations without an explicit shared root.
  All supported clients must use the same coordination state-home.
  Separate state-homes/older clients/external editors are not excluded by a private lock; do not claim OS sandboxing.
- Readiness requires all predecessor outcomes completed with closed process, durable public result and no mandatory recording gap.
  Lifecycle: `queued → preparing → launch-intent → running → stopping? → settled`; `blocked`/`canceled-before-launch` are terminal nonexecutions, with null exit facts.
  Show dependency/writer/auth/storage/stale wait reasons separately.
- Record before/after bounded `ChangeView`, raw fingerprint, completeness and durable checkout generation for each relevant child/check.
  Advance generation at writer/check admission and close, even if no diff is detected.
  External changes detected between gates invalidate the last owner observation; never attribute all dirt to Cadence.
- Default `current` edges require equal generation and compatible complete before/after observations when consuming a readonly result (validate against the pre-reservation generation before advancing the consuming writer’s generation); a later write by **another task or sibling** can stale it.
  Preserve stale result; block dependent admission and require explicit revised plan/new Start, never rerun silently.
- `historical-context` edges permit explicitly reviewed historical/advisory input, still labeled stale; they cannot satisfy current human review/check requirements.
  A prior editor's output binds its post-write observation, allowing ordinary serial dependencies.
  Root nodes compare to the latest expected owner observation, not an impossible eternally frozen pre-edit baseline.
- Equal bounded fingerprints do not prove unchanged ignored files or exclude external change-and-revert.
  Incomplete observations require visible issues; if a declared current dependency cannot be established, block it.
  Parent check and human-review freshness compare exact definitions/context plus current observations across tasks, not just task revision.

## 4. Failure, cancellation and aggregate truth

- Policy: first failed/timed-out/canceled child freezes further admission for its parent.
  Already-running independent siblings settle normally; preserve their actual outcomes.
  Unstarted descendants get dependency-blocked; other unstarted siblings get parent-stopped.
  No failure-driven replanning or retry.
- Unknown closure, changed owner lock or durability failure additionally closes checkout-wide admission and requests bounded stop of all its active processes.
  Unknown outcome is not a completed promise permitting gate release.
  No dead-PID/lease expiry shortcut proves worker/descendant closure.
- Parent Cancel closes admission synchronously, records intent, then aborts preparing/active children concurrently using all-settled bookkeeping.
  Cancel is a safety exception: if its journal write fails, still request stop but return durability-unknown, not a durable receipt.
  Queued children become canceled/no-launch; already settled children keep their results.
- Preserve current TERM→KILL at 1 s→unknown at 3 s native bound, concurrently across children, not N×3 s.
  If cancellation is committed before successful settlement, outcome stays canceled even with later zero exit; a previously committed success is never rewritten.
  Native exit/signal/close observations remain separate from cancellation intent.
- Parent projection includes full roster and counts completed/failed/canceled/timeout/unknown/blocked/not-started, plus first stop cause.
  Active/settling status persists while known active children remain.
  On drain: any unknown→unknown; otherwise failed→failed, timeout→timeout, cancel→canceled, blocked→blocked; completed only when every node completed with required capture/context conditions.
  Preserve all contributing reasons, not only precedence winner.
- Separate axes: execution, recording coverage, process closure, connection freshness, actual parent checks and human review.
  A native successful execution with recording loss remains inspectable as native exit0 plus recording-failed/unqualified workflow, never an unqualified all-success.
  Policy-excluded thinking is not accidental capture loss.
- Real check record: checkRunId, exact command/name/timeout/cwd, definition revision, start/end observations, native outcome/close/exit/signal, output artifact and coverage.
  Passed requires actual successful native closure and applicable unchanged inputs; missing obligations are not-run.
  Tool cards, timeline durations, `isError:false` and parsed “exit 0” prose are **not parent-check evidence**.
- Human review records reviewed graph/run/check/change identities, issue acknowledgment and observed freshness through a short exclusive observation barrier; no lock held while a dialog is open.
  Done never changes failed/unrun/stale checks or child results.
  Agent review remains advisory.
  Native terminal consent protections need deliberate client adaptation, not removal.
- Client departure detaches only.
  Orderly service stop closes admission and requests cancellation before releasing known-closed resources.
  Restart creates a new epoch, never resumes queues/work: queued authorization expires; any old launch intent without durable settlement is interrupted/unknown, including intent without PID.
  Durable terminal outcomes remain terminal after reconnect/restart.

## 5. New plain-file store, without changing task v1

```text
<privateRoot>/execution-history-v2/
  format.json                         # explicit new-store identity, limits/schema
  ledger/000000000001.jsonl ...        # ordered segmented authoritative journal
  runs/<parentRunId>/admission.json    # immutable sanitized task/graph/context refs
  runs/<parentRunId>/artifacts/<id>/000001.part ...  # immutable sanitized chunks
  indexes/<generation>/...             # bounded derived locator/catalog pages
  checkpoint.json                     # replaceable bounded state + committed cursor
```

- Closed schemas distinguish `cadence-execution-history/2` store, `cadence-event/2`, `cadence-checkpoint/2`, graph, artifact and receipt records; unknown selected schema refuses, never falls back to a legacy interpretation.
  New store only under `TaskStore.privateRoot` (`cadence-assistant-v1/<rootHash>`), outside checkout freshness.
  Do not add siblings to `.cadence/assistant/tasks/<id>`, extend v1 keys, import Pi transcripts, adopt unknown directories or scan/delete unrelated logs.
  Passive reads of a missing store return unavailable, not bootstrap.
- Preserve strict v1 read/write codecs and ≤128 KiB records.
  New service-created tasks can retain v1 readable summaries; pre-existing task/config/history stays byte-preserved unless the human explicitly edits that selected task.
  Linking a legacy task to new work does not import old approval or invent old message/tool history.
- V2 is authoritative for new run state; v1 publication is a separately tracked best-effort projection using expected raw byte identity.
  Save conflicts preserve user bytes, record publication-conflict and block unsafe continuation; never rollback journal or overwrite changed v1.
  Reconnect/viewing does not repair either store.
  Old binaries are not collaboration-aware controllers.
- Every owned path uses validated IDs, private 0700 directories/0600 files on POSIX, current-user ownership, no links/special files, single-link descriptor checks, bounded reads and no-follow where supported.
  Reject unauthorized selected artifacts without revealing paths/content.
  Windows ACL/directory durability needs separate qualification; portable mode bits are not an ACL claim.
- All task/graph/context/message/tool/check/change/review content entering this store is already sanitized.
  Record original-source availability/counts only when known; never persist raw credentials, provider payloads, hidden thinking/signatures or raw auth errors, even in a private diagnostic/temp file.
- One checkout journal provides a **global increasing decimal sequence** across epochs/runs, avoiding false cross-run atomicity from separate run checkpoints.
  Data envelope: `{schema,seq,epoch,taskId,parentRunId?,childRunId?,kind,ownerObservedAt,ownerMonotonicMs?,payload,prevHash}`; hashes detect corruption, not hostile-user tamperproof evidence.
- Journal payloads reference artifact IDs/versions/chunk lengths/hashes, not arbitrary paths; events include commands/receipts, graph admission, gate reservations/generation, launch/PID observations, messages/tools, check/review, capture gaps and settlements.
  Worker seq is distinct from owner seq; owner is the only reducer/ordering authority.
- Group commit: write exclusive immutable artifact chunks/admission first, fsync their descriptors and affected directories; append bounded event lines followed by `COMMIT{throughSeq,count,batchHash,previousCommitHash,artifactRefsDigest}`, fsync ledger; only then expose committed watermark, return durable receipts or dispatch dependent effects.
  Index/checkpoint updates follow and are not prerequisites for journal truth.
- Flush progress batches every ≤100 ms or 256 KiB; flush admission, launch intent, cancel, native settlement, gate release, review and final outcomes immediately.
  No browser gets uncommitted content labeled durable.
  Each segment seals before the next batch would exceed 8 MiB or 4096 event records, with a linked footer before opening the next; never delete/compact sealed history automatically.
- Crash windows: admission files without accepted commit are inert preserved orphans; accepted command without launch intent is never auto-replayed; launch intent without known settlement is uncertain; native close before its durable commit is not recoverable success.
  No exact-once spawn guarantee across crash—the safe guarantee is no duplicate replay plus explicit ambiguity.
- On native close, first finish bounded pipe decode/artifact drain, then commit close facts + derived settlement + gate release in one journal batch.
  No successful response/success-dependent dispatch before this commit.
  Lost WS/final HTTP responses recover that committed success; a missing worker final is a failure, not recoverable from prose.
- `checkpoint.json` uses existing exclusive-temp→fsync→rename idiom **plus directory fsync where supported**, naming its journal commit hash/cursor; it contains only bounded active scheduler state and index roots.
  It is an accelerator, never sole evidence or restart launch authority.
  Validate references and replay later committed records without executing effects.
- Derived indexes: per-segment offset tables; paged task/run/child/message/tool/artifact catalogs; receipt actionId→ledger location, payload digest and result.
  Pages ≤256 KiB, append/copy-on-write changed pages only (not whole-history copies per flush), with immutable per-sealed-segment indexes; stale/missing indexes fall back to bounded ledger scan with continuation.
  Reader may build RAM indexes, never writes/rebuilds on GET.
  Explicit owner maintenance may append a new index generation without editing historical bytes.
- Receipt lookup must finish against the committed journal before accepting an unknown action ID; if lookup budget/index is unavailable, return busy/refused, not “not found, launch again.”
  Never prune receipts while retaining their effects.
  A committed accepted receipt identifies the parent run even when the caller missed its response.
- Startup/recovery verifies framing, chain, referenced chunks and commit boundary.
  Partial final UTF-8/JSON/batch bytes stay untouched: readonly prefix is exposed with `incomplete-tail` and exact last committed cursor; affected control refuses.
  Interior corruption/hash mismatch or missing committed artifact refuses the affected range/run, never skips lines and reports complete history.
- An explicit informed local recovery may append a new epoch/fence segment referencing the verified prefix and preserved damaged tail; it never truncates/repairs old bytes or resumes old runs.
  Clearing checkout/process quarantine is a **separate** manual risk acknowledgment, not implied by index repair or dead service PID.
  Unsupported fsync semantics must be refused or visibly unqualified, not sold as crash-proof storage.

## 6. Retention and saturation defaults

| Resource                 | Proposed default and behavior                                                                                                                                                                                                                                                                                                 |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Total store              | 10 GiB/checkout including indexes/orphans; never automatic deletion. Reserve 512 MiB per admitted episode against quota and free space; require an additional 256 MiB free-space safety floor. Refuse new work when insufficient.                                                                                             |
| Episode / child          | 512 MiB actual new store bytes/episode; 128 MiB protocol bytes/child (last 1 MiB reserved for control); 100,000 data frames + reserved 256 control frames/child; 1,000,000 observed SDK events/child. Counters include discarded/unsupported events to prevent floods.                                                        |
| Individual public detail | 32 MiB/message text, arguments object or tool-result document; 256 KiB immutable disk chunks; max65,536 part files/episode with sharded directories; chunked retrieval, not one giant JSON response. Exceeding mandatory capture cap stops the run with explicit omitted-tail count/status, not a silently shortened success. |
| Wire                     | Existing 128 KiB request bound retained; strict 64 KiB encoded JSONL frame, ≤8 KiB decoded text/data chunk, ≤64 KiB undecoded line buffer; large final prose is an artifact reference, not a 16 KiB final-field limit.                                                                                                        |
| Memory / live            | Worker emitter ≤4 MiB/1024 queued frames; owner ingestion ≤8 MiB/2048 frames/child; preview 4 KiB/field; recent replay 1024 events or 2 MiB/run. These rings never own retained history.                                                                                                                                      |
| Reads / subscribers      | List/message/event pages default 50/max200, ≤512 KiB response; detail page ≤256 KiB; 8 subscribers/checkout each ≤256 messages/1 MiB, detach/resync slow clients without canceling work.                                                                                                                                      |

- These deliberately replace current 256 KiB aggregate/4096-frame/16 KiB-final limits, which cannot serve rich history.
  Defaults are frozen in admission/export metadata; operator increases affect only newly confirmed runs, not silently enlarge a running contract.
  Count raw incoming size before sanitization too; malformed/oversized values must not allocate unbounded copies.
- Backpressure pauses worker-pipe intake and bounds local queues; stop admitting when persistence cannot keep up.
  After 5 s sustained stalled drain or any hard limit, record capture-failed, request bounded cancellation, preserve the committed prefix and retain unknown closure if necessary.
  Never drop oldest retained messages to keep a run green.
- Reserve 1 MiB control headroom/episode inside its quota for failures/cancel/close/coverage records; preflight disk space and handle ENOSPC anyway.
  Reservation is accounting, not guaranteed disk allocation.
  If even failure metadata cannot persist, expose RAM-only durability-unknown and keep the lock; restart recovers uncertainty from the earlier durable launch intent.
- Read/search/export remain available for valid retained prefixes after quota exhaustion.
  Manual export or raising limits does not delete history or auto-resume work.
  No “retention period” expiry and no full-history promise beyond declared capture policy; complete public record and upstream/source omission are separate facts.

## 7. Worker protocol v2 and native outcome linkage

- Extend `src/sdk-worker.mjs` emitter and `src/subagent-process.ts` decoder **together**; new owner requires version 2, with no permissive v1 fallback.
  Keep runProcess's native close/TERM/KILL/input-delivery semantics; do not replace it with the upstream chat runtime.
- Request includes `protocol:2`, parentRunId/childRunId, assignment identity/digests, role/model context, limits and ephemeral request auth.
  First `ready{v:2,childRunId,capabilities,modelIdentity}` confirms exact requested setup; unknown keys/types/versions and identity substitutions refuse.
- Frames carry strictly increasing child `workerSeq`, child-local monotonic observation, and typed payload: `message_start`, `text_chunk`, `message_end`, `tool_start`, `tool_update`, `tool_end`, `detail_begin/chunk/end`, `capture_status`, `worker_failed`, terminal `final`.
  Owner stamps receipt time; worker times are observations, never inferred business duration.
- Project user prompt and effective role/system/tool declarations as owner-supplied context with provenance; capture genuine SDK user/assistant/toolResult messages separately.
  In installed 0.84.3 there is no public system-message role in `pi-ai/dist/types.d.ts:297–344`; never fabricate an SDK system event to bridge newer docs.
- SDK mapping: `message_update.assistantMessageEvent.text_delta` supplies text chunks keyed by messageId/contentIndex; ignore cumulative `message`/`partial` snapshots and thinking deltas.
  `message_end` supplies authoritative sanitized finalized text/tool-call blocks.
  Retain original observed stream and final version; replacement in UI is not deletion of durable observations.
- SDK `tool_execution_start{toolCallId,toolName,args}`, `update{partialResult}`, `end{result,isError}` are real lifecycle source (`pi-agent-core/dist/types.d.ts:396–412`).
  Preserve source call IDs when safely publishable plus stable local `callOccurrenceId=(childRunId,ordinal)` and source-message/block association.
  Unsafe/redacted IDs retain only local identity, with explicit source-ID omission; never derive identity from tool name/prose.
- Match using the exact raw SDK ID in worker RAM before redaction, allowing reuse only after prior completion; duplicate active ID, orphan/duplicate end, mismatched name or post-final frame is protocol failure.
  ToolResult messages point to the same call occurrence/artifact; they remain reachable even if UI normally suppresses standalone tool results.
- Tool start occurs **before** validation/preparation and can represent a nonexecuted truncated call (`agent-loop.js:256–318,332–359`).
  Label “SDK call started,” not “command launched.”
  Installed end has no durationMs: compute observed start/end elapsed, not claimed native-tool duration.
  Record `isError` and public error content separately from parent outcome; a handled tool error does not automatically fail a completed agent.
- Detail framing: begin declares type/encoding/entity/field/version, then ordered byte-offset chunks, then end declares actual byte count/hash/coverage.
  Reject overlapping/gapped chunks, hash/UTF-8 mismatch, unknown references, duplicate closure and out-of-limit nested JSON (max depth32/100,000 values).
  Traverse own data descriptors only, reject getters/cycles/non-JSON values with explicit capture failure; stream JSON traversal, never JSON.stringify an unbounded SDK object first.
- Preserve complete sanitized public tool args/results and safe structured details, not upstream preview caps.
  Do not stream unparsed partial toolcall JSON; finalize/validate args before projection.
  Tool updates are explicitly snapshot or append per adapter, never guessed; default is to retain every SDK-emitted public update snapshot.
  Only consecutive assistant text delivery is coalesced below; no content is dropped, and final public results remain mandatory.
- Recommended capture hook is awaited **public `session.agent.subscribe`**, whose promise participates in settlement (`pi-agent-core/dist/agent.d.ts:60–70`); drain bounded framing queues there.
  `session.subscribe` callbacks are synchronous and NOT awaited (`core/agent-session.js:296–300,538–546`), so merely making them async cannot provide backpressure.
  Keep session-only fixed diagnostics on a nonthrowing bounded callback; never subscribe twice to duplicate core events.
- Streaming flush coalesces consecutive text for ≤50 ms or 8 KiB, preserving first/last observation time.
  All emitter writes honor stdout `drain`; failures are fixed labels and handled aborts, never unhandled provider exceptions.
  Do not await browser delivery in any worker callback; owner storage failures are control failures, viewer failures are not.
- After prompt settles with final assistant stop `stop`, drain all public artifacts/messages, ensure no unfinished tool/detail frames, await unsubscribe/abort/dispose/owned-network cleanup and emit one final control frame with `stopReason:"stop"`, finalMessageRef, frame/artifact counts, capture status and cleanup-settled.
  Await stdout drain; do not force process.exit to bypass pending writes.
- Parent completion requires valid ready+final, matching durable detail refs/sequence, successful cleanup, no earlier cancel/protocol/input failure, native zero `close` (not merely `exit`) and committed settlement.
  `agent_end`, `agent_settled` and final prose alone never satisfy it.
  Reserve final/control queue space; overflow can cause honest failure but cannot silently discard a successful terminal state.

## 8. Redaction boundary and source limitations

- Apply schema allowlisting and secret removal **before worker stdout**; owner repeats sanitization before private disk/index/previews/HTTP/WS/export.
  Validate worker wire byte counts/hashes in RAM **before** owner redaction, then assign independent stored offsets/hashes to the sanitized artifacts; wire offsets are never persisted search offsets.
  Private request auth never enters public DTO construction.
  Build fresh primitive objects, never spread model/provider events or stringify errors/getters.
  No raw-stream “debug log.”
- Always exclude auth/header/env envelopes, provider response/request payloads, deferred handles, response IDs/diagnostics, signatures and all thinking blocks.
  Binary/images are metadata-only omissions (MIME/known size/reason), not base64 export or auto-CAS writes.
  Text tool details use safe field codecs; unknown structured fields get an omission marker, not blind recursive transport of credentials.
- Known literals come from resolved request credentials (including headers/env values), SDK refresh results and owner access-token/session material, held in RAM only.
  Longest-match redaction precedes truncation/escaping; structured secret-named values are replaced, including JSON-escaped representations after logical decoding.
  Do not send browser tokens to workers just to redact them; owner is the second boundary.
- Streaming sanitizer maintains one state per logical field: strict incremental UTF-8 decoder, high-surrogate handling for SDK string deltas, literal-prefix matcher retaining up to longest known secret−1, and stateful Bearer/secret-assignment/URL-userinfo/control stripping.
  Chunk boundaries are not field ends.
  Hold potential URL authority/control sequences until disambiguated; bound unresolved token state at 64 KiB, replacing an overlong ambiguous span and marking omission rather than leaking it.
- Do not reuse `diagnosticText(chunk)` as streaming protection: independent chunks can expose split secrets/OSC/UTF-8.
  For bounded completed JSON fields, sanitize decoded keys/values before chunking.
  At terminal/cancel, flush only safe suffixes; unresolved secret prefixes are redacted with a marker.
  Final and streaming projections use the same policy/version; retain redaction counts, never hashes/previews of removed secrets.
- Coverage per entity: `{policyVersion,source:"sdk"|"owner"|"check",observedBytes?,retainedBytes,redacted,omissions[],sourceTruncated,recordingComplete,finalObserved,throughSeq}`.
  Count unknown bytes as unknown, not zero.
  A tool's already-truncated source result can be completely recorded **as returned**, but is not the entire source file/command output; UI/export must show both distinctions.
- **Additional SDK gap:** stock bash uses `OutputAccumulator` and persists truncated raw output before a subscriber sees it (`core/tools/bash.js:247–320`; `core/tools/output-accumulator.js#append/ensureTempFile` writes original Buffer chunks with `createWriteStream`).
  Never claim subscriber-only redaction protects disk.
  Use a thin bounded bash ToolDefinition adapter with public `createLocalBashOperations`, retaining shell/cancel semantics while replacing its accumulation with the shared redacted stream/detail sink; no stock raw spill file or arbitrary fullOutputPath reader.
  Its synchronous `onData` callback must cap its own queue and abort on overflow; an awaited agent subscriber alone cannot backpressure shell callbacks.
- That adapter records shell stream as a separate source artifact, actual operations-returned exit fact and model-visible result as distinct values; it is still **not a parent check**.
  Other stock read/grep/find/ls results may truncate before SDK events; retain their actual public text/details and source-limit markers, never follow an arbitrary path later to “fill” historical gaps.
  Do not reconstruct unavailable text by rereading changed files.
- Parent checks need the same incremental sanitize-and-record sink before display/disk, but retain ordinary approved project environment, not SDK auth.
  Reject credential-bearing action fields detected before persistence; do not silently change executable commands during sanitization.
  Keep private auth paths out of normal file-tool recording routes where enforceable.
  This remains trusted host tools, not prevention of all user shell writes or detection of every encoded/unknown business secret.

## 9. Paged history, literal search, export and reconciliation

- Authenticated readers operate on **committed immutable data**, never construct SDK sessions, acquire execution consent, repair transcripts, write export caches or start workers.
  Task/run/child catalogs, message pages, tool/detail ranges, timeline events, check/change/review pages and export all share one reader/coverage model; no path-taking endpoint.
- Cursor is a versioned validated opaque encoding of storeId, scope/filter/query identity, snapshot commit seq+hash, entity/version, next ordinal/byte offset.
  It is navigation, not authority; authenticate every request.
  Deterministic keyset ordering `(admissionSeq,parentRunId,childOrdinal,entityOrdinal,fieldOrdinal,byteOffset)`; no offset paging over a changing list or timestamp-prefix guessing.
- First request freezes a high-watermark; subsequent pages exclude later events and keep final/partial entity versions as of that watermark.
  Valid cursors survive service restart, independent of service epoch; token rotation still requires reauthentication.
  Bad scope/hash/version or corruption returns explicit invalid/unavailable, never silently restarts at page1.
  Opening a hit resolves an exact entity/version range even outside loaded pages.
- Search all retained public task/plan/context/messages, canonical tool args/results, checks/change observations/review text within selected workspace/task/run/child filters.
  Default literal UTF-8 case-sensitive substring, query 1–1024 B; no regex, glob, shell or provider query.
  Match exact stored sanitized text; no locale folding that changes hit offsets.
  Return matched field IDs and UTF-8 byte ranges, not merely message timestamps.
- Search uses catalog/offset indexes plus streaming scans of canonical public detail (final version if available at snapshot; otherwise committed partial).
  No transcript-prefix cap or max200-run discovery ceiling.
  Carry query-length−1 bytes across chunks; do not match across unrelated fields.
  Ignore superseded stream duplicates by default; timeline search can explicitly include observed updates.
- Each request returns ≤50 hits (max200), scans ≤8 MiB or 100 ms then returns a resumable cursor, even if **zero** hits yet; include scanned/eligible bytes where known, unavailable ranges and `complete:false`.
  Continue to EOF to establish no more matches.
  Cross-request cursor carries overlap position (not secret-bearing text); rescan at most query-length−1 bytes and deduplicate by exact hit offset.
  At most 2 searches/checkout; aborted/slow reads never occupy execution slots.
  Source redaction/omissions mean “complete retained search,” not complete original source search.
- JSON export is a streaming `cadence-public-export/2` document with manifest, selected task/graph/run/child identities, context/messages/tool artifacts, native outcomes/timeline, checks/change/review, source provenance/policy/coverage and a final trailer `{complete,throughSeq,recordCounts,digest}`.
  Markdown exports the same selected content with stable headings/anchors, escaped code fences and a coverage appendix; no hidden tool omission because the DOM was collapsed.
- Export may select one task or finite run/child set; defaults to all retained public fields within that selection, **not the recent ring**.
  Stream chunks and JSON escaping without building the archive in RAM; max2 concurrent downloads/checkout, 120 s idle timeout, no fixed total-byte cutoff below retained scope.
  Network cancellation stops reading, not work; incomplete stream/missing trailer is an incomplete download, never a valid complete archive.
- Known unavailable/corrupt selected ranges yield a preflight refusal or explicit incomplete manifest with scoped reason; never silently skip.
  Artifacts are inline streamed text/JSON, not server paths; no auth/session-cookie/lock tokens or secret-bearing links.
  Export authorization is rechecked at start and token-revocation checkpoints; responses are private/no-store and safe attachment filenames.
- Snapshot/subscription handshake freezes committed sequence while registering delivery, then sends only newer events; duplicates are ignored, gaps trigger readonly resync, epoch change invalidates actions not historical cursors.
  Snapshot includes live-owner availability, committed/earliest-realtime cursor and coverage; an evicted replay ring uses durable pages, not “history unavailable.”
- Heartbeat every 5 s carries current committed watermark; clients request fresh snapshot if watermark outruns their view or heartbeat ages past 15 s.
  Retry final-snapshot publication until delivered or client detached; bound all queues.
  Thus a dropped final event with **no following activity** converges without another Start.
  Replaying timeline uses recorded timestamps only, never estimated token-speed dates or execution effects.

## 10. Reuse seams and required contract tests (none executed)

| Source → proposed destination family                                                                                                                 | Adaptation / required test                                                                                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cadence `task-store.ts`, `subagent-process.ts`, `task-diff.ts`, `agent-registry.ts` → service store/process adapters                                 | Reuse canonical roots, strict files/native close/actual changes/fixed instructions; extend, do not spin up independent controllers or rewrite SDK/provider runtime. New tests `test/service-scheduler.test.ts`, `test/history-store.test.ts`.                             |
| `U:web/src/components/{MessageList,Message,ToolCallBlock,LazyMount,StreamMarkdown}.tsx`, `message-delta.ts` → `web/src/history/`                     | Adapt cohesive rendering/scroll/copy/reducer family with paged refs and explicit status, remove thinking/actions/inferred streaming success; preserve local IDs and orphan tool-result navigation. Port `tests/unit/{message-delta,lazy-window,stream-markdown}.test.ts`. |
| `U:web/src/components/{GlobalSearchModal,SearchBar}.tsx`, `session-url.ts`; `server/session-search.ts` → `web/src/history/`, `src/history-reader.ts` | Reuse interaction/correlation/anchor formatting, replace ambient-session scans, 256K text/16MiB scan caps, silent corrupt-line skip and timestamp anchors. Port search-folded fixtures; add exact-hit tests past first page/segment/old 16MiB cap.                        |
| `U:plugins/run-trace/client/entry.mjs`, `web/src/{copy-text,download}.ts` → timeline/export UI                                                       | Reuse full timeline client via restricted bridge and export UX; remove inferred durations/clear-history/CDN hooks. New server JSON/Markdown readers are necessary, not screenshot-as-archive. Preserve MIT 2026 xing-shuyin/full notice and audit bundled dependencies.   |
| `U:web/src/use-chat.ts:1080–1106,1822–1846`, `U:server/index.ts:2409–2442` → client transport adapter                                                | Reuse revision/resync/backpressure/final retry patterns, add durable watermarks and bounded all-traffic queues. Never import `resumeInterrupted`, transcript repair, roleOutcomeOf or shell/model fallbacks.                                                              |

- **Scheduler:** real-process two-reader overlap; cross-task read/write/check no-overlap including aliases; writer fairness; graph cycles/limits/escalation; reserved async-auth slots; late credentials after Cancel never spawn; failure freezes admissions but preserves independent sibling outcomes; unknown fences whole checkout; fresh/history-context edge semantics after sibling/external writes.
- **Receipts/crash:** kill at artifact write/fsync, command commit, launch intent, spawn-before-PID, native close-before-settlement, settlement-before-notify and v1 publication conflict; exactly one launch on duplicate actions/lost replies, zero restart launches.
  Same ID/different payload refuses; corrupt/missing receipt index never authorizes another launch; owner-redacted content must have independent valid stored hashes/offsets after wire validation.
  Preserve damaged/orphan bytes.
- **History/storage:** >1024 events and >16MiB detail across segments, restart then page/search/open exact tool hit/export equal retained contents; zero SDK/session constructors and byte-identical old files.
  Torn UTF-8/JSON/commit, interior hash mismatch, symlink/hardlink/permissions/missing chunk, ENOSPC/control reserve exhaustion and quota admission all produce explicit coverage/refusal, no deletion.
- **Worker:** extend actual stock-SDK/fabricated loopback lanes in `test/lightweight-sdk.test.ts` plus `test/lightweight-process-diff.test.ts`: real call IDs/args/end/isError, validation-not-executed call, reused/interleaved IDs, oversized args/results, multibyte chunk splits, absent/duplicate/orphan/post-final events, unmatched tools at final, cleanup/nonzero close/input error despite final.
  Test awaited agent hook versus nonawaited session callback explicitly.
- **Privacy:** canary fake keys/headers/env/access tokens across every byte and SDK string split, nested/escaped args, final+stream mismatch, ANSI/OSC/Bearer/userinfo, tool/check error text and auth failures; assert worker-known literals absent in **raw child stdout/stderr** and all recording files.
  Owner-only token canaries must be absent after owner ingestion and in every file/index/HTTP/WS/export; do not claim a worker can redact an owner-only literal it never received.
  Verify no thinking/signature/opaque diagnostics and no stock raw bash spill; unknown business-secret detection remains unclaimed.
- **Capture/backpressure:** field/frame/SDK-event/store floods fail closed; pause disk sink and subscriber independently; final control cannot be evicted, native exit0 plus incomplete capture never all-green; UTF-8 offsets/search spans survive chunk/segment boundaries.
  Check upstream source-truncated versus recorder-truncated badges and export manifests independently.
- **Integrated clients:** terminal and browser share run/tool/check IDs; active client departure does not cancel; duplicate/reordered/gapped updates and dropped final converge by heartbeat; no-client run records complete public detail.
  Long detail and exact-hit navigation work on desktop/phone viewport; authenticated/cross-origin detail/export refusal and token rotation are exercised separately from physical-device claims.

## 11. Integration contradictions / gaps for main design

- Earlier scheduler report's recent-ring/minimal result store, no-args progress and “history/exposure still unchosen” sections are superseded.
  Full durable recording/search/export and remote single-owner access are approved; do not defer them or reopen settled product questions.
- Existing strict v1 32-check/64-activity/16KiB-result/1000-task-list bounds remain compatibility limits, **not v2 history limits**.
  Decide explicit create/list behavior at 1000 legacy-compatible tasks; never silently hide old/new tasks or reshape v1 to bypass its decoder.
- Main design must align service instance/checkout lock/state-home identity, role/model config revisions, readonly plan command recording, fresh terminal/browser confirmations, auth refresh literal propagation and local recovery authorization with this journal.
  A token authenticates access but never grants a graph/check/review action by itself.
- Subscriber backpressure and SDK bash raw spill are new concrete integration hazards; source event richness alone is insufficient.
  The bash accumulation shim is required if promising redaction before recording disk; arbitrary host-tool side effects remain outside that guarantee.
  Global 1.2 docs' system messages/durationMs cannot be assumed on installed 0.84.3.
- Filesystem durability, directory fsync/ACL behavior, process-group closure, raw event/tool adapter compatibility and packaged worker assets need real target-platform/peer qualification.
  Shared sanitization of args/results and shell output must not silently change the command actually confirmed or turn model-facing previews into the retained detail contract.
  The proposed journal is a small single-owner plain-file commit protocol, not a certified executor, general database, filesystem transaction or provider-truth guarantee.
