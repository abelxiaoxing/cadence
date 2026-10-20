# Execution and History Contract

This is a mandatory authoritative appendix to [design.md](design.md), not an alternative research proposal.
Read it completely with the parent design; sections retain their original numbers for child references.

## 7. Graph, Scheduler, Checks and Review

Graph schema `cadence-graph/2` contains task/plan revision, readable plan reference and 1–16 assignments.
Assignment IDs match `[a-z][a-z0-9-]{0,47}`; purpose is research/diagnosis/review/edit; instructions are at most 16KiB, expected output 2KiB, graph 512KiB.
Dependencies must be unique, existent and acyclic; all assignments are required.
Each edge declares current or historical/advisory context and a frozen input selection: whole predecessor final-text or an explicitly reviewed UTF-8 range; historical inputs name an existing committed run/record/version.
Current-episode references resolve to allocated child IDs and exact committed final-result versions at dispatch.
Default handoff is whole final text, at most16KiB per predecessor/32KiB aggregate; oversized required whole results block rather than being silently clipped or model-summarized.
Order inputs by frozen graph order and record source/version/field/range, exact supplied public projection and omitted/redacted/source-limit coverage; full allowed predecessor history remains independently retained.
Pre-auth serialized public request fields must fit96KiB, reserving32KiB for auth/serialization; the actual complete serialized request must still fit128KiB after auth or refuse before spawn.
No private-history filesystem access or hidden synthesis call works around handoff limits.
Roles map to shipped instructions, pinned by content identity; capability comes from purpose and parent kind, never prose.
Default all children inherit the explicitly selected exact model/thinking; no hidden model selection or fallback.

Defaults: 8 admitted episodes, 128 queued assignments, 2 preparing/running/closing child/check reservations per owner; an exclusive writer/check uses the only checkout access lane.
Reserve before async auth, recheck after every await and immediately before launch.
Fair round-robin ready parents with deterministic graph order and waiting-writer preference.
Episode deadline is 6h; expiry stops admission and requests bounded cancellation of active children with timeout facts.
A ready node waiting10min stops further episode admission with wait-expired rather than silently executing indefinitely later.
Wait expiry, required-handoff overflow or stale required dependencies close episode admission, let already-running independent siblings drain, then settle blocked while preserving completed/partial results.
Remaining work then requires a separately saved/reviewed revised graph and new Start/episode; old results can be explicitly selected as historical input, never silently imported execution or approval.
Human Done/review, reconnect or timer refresh cannot unblock the old episode.
Workers default to 20min; current cancellation bounds remain.

Lifecycle, outcome, closure, capture coverage and UI connection are separate dimensions.
A dependency is ready only after predecessor native settlement, durable result and required current context.
Record bounded before/after observations and checkout generation; service writers/checks advance it conservatively.
External/cross-task changes can stale results; preserve them visibly and stop current-dependent admission instead of rerunning automatically.
Default current-input freshness means unchanged within the displayed bounded observation scope and compatible service generation, not a complete filesystem snapshot.
Incomplete whole-checkout coverage remains a visible warning and review issue, not silently complete or automatically fatal when unrelated to selected recorded input.
A graph may require complete observation for an edge; that requirement blocks incomplete coverage.
Missing/changed selected input always blocks.
Expected predecessor edits update expected context rather than requiring an eternally unchanged initial fingerprint.
Equal bounded fingerprints do not exclude external change-and-revert.

First child failure/timeout/cancel stops further admission for that parent; already-running independent siblings may settle normally.
Unstarted nodes retain explicit dependency/parent-stopped reasons.
Unknown closure or durability/ownership failure quarantines the checkout and requests stop of its other active work.
Completed children keep their facts; all-success requires every required assignment completed with known native closure and mandatory recording conditions.
Preserve native exit0 separately if recording later fails; do not upgrade the whole workflow to success.

Checks are separately confirmed service-parent operations, never graph nodes or agent prose.
They take exclusive checkout access after the target parent has drained, use exact name/command/timeout/cwd and before/after freshness, and preserve configured not-run obligations.
Human review captures graph/run/check/change versions, recaptures under a short barrier, and requires issue acknowledgment when needed.
Done changes neither execution nor check facts; agent review is advisory.

## 8. Rich Worker Capture and Privacy Boundary

Service workers use a mandatory version-2 request/ready protocol; emitter and decoder ship together without a permissive v1 fallback.
Keep exact model/auth setup, in-memory SDK session/resources and original process-close authority.
A maintained shared JS codec/sanitizer avoids duplicated TS/JS boundary rules.

Frames have childRunId, strictly increasing workerSeq, observed monotonic time and a closed event variant: ready; message start/text/end; tool start/update/end; detail begin/chunk/end; capture status; worker failure; final.
Use genuine SDK tool IDs in RAM to correlate occurrences; publish safe source IDs plus local occurrence IDs, or only local IDs when source IDs are unsafe.
Handle interleaved/reused IDs, orphan results and validation-before-execution tool events honestly.
Tool-start is an SDK call observation, not proof a process/file operation occurred.
Tool `isError` is not a parent check result.

Capture normal prompt/role context, assistant text, tool arguments/results/public updates and actual check/change/review observations.
Final SDK message content is retained separately from observed streaming updates when they differ.
Do not export auth envelopes, raw provider requests/responses/errors, signatures, hidden/opaque thinking or unavailable provider internals.
Binary/media source bodies are explicit metadata-only omissions in this text/code workflow, not silently reconstructed attachments.

Use the public awaited core-agent subscription where the selected installed peer supports it; synchronous AgentSession callbacks cannot supply backpressure by merely becoming async.
Qualify this exact public behavior before extending capture; unsupported capability refuses rather than using private imports.
SDK tool-update/bash onData callbacks may be synchronous and overlapping: reserve byte/event/in-flight budgets before the first await/copy, snapshot only bounded allowed values, and reject/abort on overflow.
The bash adapter owns bounded synchronous ingress and accounts for outstanding update promises.
Request abort through a separately handled promise; never await the current run's own settlement inside its awaited listener.
Memory/queue ceilings cover Cadence-owned queues, not every SDK/provider buffer or total process memory; test a real fast producer against a slow recorder.
Drain bounded stdout queues, handle subscriber failures without unhandled exceptions, and preserve control capacity for final/stop facts.

Sanitize known literal secrets, structured sensitive values, terminal controls and supported heuristics before worker stdout, and again before owner persistence/publication.
Incremental UTF-8/field-aware sanitization retains possible secret prefixes across chunks; independent `diagnosticText(chunk)` is forbidden.
Never send browser tokens into worker auth just to redact them; owner handles its own secret set.
Wire offsets/hashes are validated before owner sanitization; persisted sanitized content gets independent offsets/hashes.
Known-secret handling is not universal business-secret detection and must be labeled accordingly.

The SDK's stock bash output accumulator can spill raw output to disk before event subscribers see it.
Use a narrow public ToolDefinition implemented with createLocalBashOperations and Cadence's bounded redacted accumulator, not merely custom operations passed to the stock createBashToolDefinition, which still constructs its raw OutputAccumulator.
Keep actual command semantics/cancellation; never follow arbitrary spill paths to fabricate history.
Other source-truncated SDK tool output remains source-truncated, with complete-as-observed distinguished from complete-original-source.
Arbitrary trusted host tools can still write files; this is not a sandbox/privacy guarantee for all process side effects.

Defaults: request 128KiB; encoded frame 64KiB; decoded chunk 8KiB; detail 32MiB; child protocol 128MiB with reserved control headroom; 100,000 data frames plus 256 control frames; one million observed SDK events.
These replace old tiny transcript/protocol totals deliberately, not by removing flood tests.
Worker queue ≤4MiB/1024 frames; owner queue ≤8MiB/2048 frames per child; stalled recording beyond 5s or quota overflow stops admission/cancels boundedly with explicit capture failure.
Set/verify sequential code-worker tool execution through the public agent capability; still do not claim arbitrary bash descendants are serialized.

Successful settlement requires prompt/final assistant stop, valid complete frame/detail associations, handled cleanup, delivered required stdin, native zero close, no overriding cancel/timeout/protocol failure and durable recorded settlement.
Final prose, agent_end, agent_settled or an emitted final frame alone cannot pass.

## 9. Durable History, Receipts and Legacy Publication

```text
<privateRoot>/service-v1/history-v2/
  format.json
  commands/<commandId>/intent.json
  ledger/<segment>.jsonl
  runs/<parentRunId>/admission.json
  runs/<parentRunId>/artifacts/<artifactId>/<part>.part
  indexes/<generation>/...
  checkpoint.json
```

One serialized owner writer assigns global monotonic decimal sequence strings across runs/epochs.
The journal contains command acceptance, graph/gate observations, auth-preparation intent/settlement, launch/close observations, exact dependency handoffs, content references, checks/review, coverage and recovery facts.
Artifact chunks are immutable sanitized 256KiB parts, referenced by validated IDs/lengths/content hashes, never arbitrary paths.
This is a small recording protocol, not a seal, certified event graph or transactional business-file system.

Durable ordering:

1. Exclusively reserve a command ID with its credential-free canonical payload identity; existing conflicting/partial intent refuses or returns known receipt, never allows another spawn.
2. Write/flush immutable admission/artifact data required by the batch.
3. Append bounded journal events and a commit marker containing sequence range/count/batch checksum and referenced artifact integrity; flush before advancing the committed watermark.
4. Only committed acceptance permits effects/accepted acknowledgment; commit auth-preparation intent before getAuth, launch intent before spawn, and closure/result before dependents/durable success.
   Commit auth settlement independently after the original promise finishes, including canceled/no-launch episodes.
5. Update derived indexes/checkpoints afterward; they are accelerators, never authority or restart execution permission.

Progress batches commit at ≤100ms or 256KiB; safety/admission/settlement transitions flush immediately.
Seal/rotate segments at 8MiB or 4096 records; do not automatically delete/compact recorded history.
File/directory durability behavior is explicitly qualified per platform, not assumed from rename alone.

The command directory addresses duplicate requests directly; the journal determines accepted/settled truth.
A missing/stale index falls back to bounded committed scans with continuation; inconclusive receipt lookup refuses new dispatch instead of assuming not-found.
Crash before accepted commit leaves inert preserved intent; launch intent without durable close remains unknown; close observed only in dead-process RAM is not recreated as success.
No exactly-once execution claim across arbitrary crashes—guarantee no automatic replay, with explicit ambiguity.

Partial final lines/uncommitted tails remain untouched and expose only a validated committed prefix with an incomplete-tail marker.
Interior corruption or missing committed artifacts refuses affected control/ranges, not silent line skipping.
An explicit informed recovery can append a new fenced epoch referencing preserved prior bytes; reading never truncates/repairs.
Persistence failure closes admission and requests stop even if its own final diagnostic cannot be saved.

New service tasks retain strict v1 human-readable summaries under `.cadence/assistant/tasks/<uuid>/task.json`; graph/transcript/receipts stay private.
W3 owns bounded v1 mapping: goal≤8KiB, plan≤32KiB, result/baseline≤16KiB, activity≤64 entries, record≤128KiB; use visibly labeled previews and stable run IDs in existing text fields, never new keys/full rich bodies.
Queued/preparing/running projects running; completed execution projects review (advisory planning returns planning); failed/blocked/mandatory-recording-failed projects failed; canceled/timeout/unknown projects interrupted; explicit human closure alone projects done.
Summary clipping never truncates retained detail; a long valid final message remains in history-v2 without causing a publication error merely due to its size.
Expected-byte/revision publication is a separate recorded operation; conflict preserves external bytes, exposes publication conflict and blocks unsafe continuation.
Existing selected tasks can be explicitly edited/continued as new episodes, but history opening never imports approval or rewrites their bytes.
Existing 1000-task/32-check/128KiB v1 bounds are retained compatibility ceilings: creation/additional v1 publication refuses visibly at the limit rather than hiding records or corrupting v1; run history pagination is independent.

Storage defaults: 10GiB per checkout; reserve up to 512MiB per admitted episode plus a 256MiB free-space safety floor; 1MiB episode control headroom.
Count artifacts/indexes/orphans against quota; reservations do not guarantee actual disk space.
No TTL deletion or cleanup of history; saturation refuses new work and preserves retained readable content.
Changing resource ceilings is explicit local configuration for newly confirmed episodes, not a silent running-contract change.

## 10. Read/Search/Export and Live Reconciliation

Readers use only committed immutable data, no SDK session/auth construction, repair, task creation or filesystem write on GET.
Opaque validated cursors bind store/scope/query, snapshot commit and entity/version/offset; they are navigation, never authentication.
Historical cursors survive service restart; current mutations still require the new epoch.

Defaults: pages 50 entries, max200/512KiB; detail pages 256KiB; previews 4KiB; recent ring 1024 events or 2MiB/run.
Long details remain separately paged; record preview limits do not truncate retained content.
Message/tool associations and orphan results stay accessible across pages and exact search hits.

Literal case-sensitive UTF-8 search covers retained task/plan/context/messages, canonical tool args/results, check/change/review text.
Query 1–1024 bytes, no regex/shell/provider search.
Each request scans ≤8MiB or 100ms and returns a continuation even with zero hits; max50 hits by default/max200.
Carry overlap across chunks, not across unrelated fields; exact hits identify record/version/field/byte range.
Report incomplete indexed/captured ranges; complete retained search is not a claim about redacted/unavailable source data.

Export selected task/run/child scope as streaming `cadence-public-export/2` NDJSON plus readable Markdown from the same reader.
Include manifest, graph/identities, context/messages/tool details, observed lifecycle/outcomes, checks/change/review, provenance and omission coverage, then a completion trailer with counts/digests/watermark.
It is not DOM screenshot export, recent-ring export or raw config/credential download.
Use authenticated no-store attachment responses and stable token-free references; recheck access generation at every bounded output chunk and terminate revoked streams without a completion trailer.
Stop reading on client cancellation without stopping execution.
Missing trailer/incomplete range is visibly incomplete, not silently successful; no giant in-memory archive or fixed cutoff below the selected retained scope.
Limit searches and exports to two concurrent readers each, with 120s idle timeout on downloads.

Subscribe at a defined snapshot watermark and deliver only newer committed events.
Duplicates are ignored; gaps/epoch changes force resync without mutation replay.
Heartbeat every 5s carries committed watermark; stale after 15s, with a 30s reconciliation poll to repair lost final updates even without later activity.
At most16 viewers, each ≤256 queued messages/1MiB; detach/resync slow observers rather than block/fail workers.
Connection status never changes recorded execution outcome.

## Read-Progress Technical Resolution

The mandatory [read-progress decision](research/read-progress-decision.md) resolves the demonstrated legal8MiB predecessor/read-window conflict without increasing budgets or weakening original integrity.
It adds bounded authenticated-encrypted navigation, explicit progress-only read responses, finite readonly POST transports and new-initialization-only private format3/key; public worker/export protocol2 and the history-v2 path remain unchanged.
Old format2 remains readonly/preserved, with no automatic migration or key creation.
The decision owns the finite resumption/source-attestation/detail-response and single-editor handoff constraints; this is navigation integrity only, not execution/auth/recovery authority.

The [graph response limit resolution](research/graph-response-limit-resolution.md) distinguishes the existing1MiB standalone graph/export-frame envelope from512KiB paged/progress responses.
Graph bodies remain512KiB, worker frames64KiB, and streamed HTTP writes256KiB; this clarifies existing code limits rather than increasing them.
