# Capture, history and privacy

What workers capture, how it is sanitized, and how retained history is stored, read, searched and exported.
Read this before changing capture, redaction, the history writer or any history reader.

## Retained history

Human-readable summaries remain `.cadence/assistant/tasks/<id>/task.json`; optional checks remain `.cadence/assistant/config.json`.
Private coordination/history use `<state-home>/cadence-assistant-v1/<checkout-hash>/service-v1/`.
Rich `history-v2` is independent of the recent live buffer; new stores use private format3 and authenticated bounded navigation.
Legacy/unknown formats remain preserved, never auto-migrated.
View/search/export are readonly and cannot resume work or repair history.
Exact task/run/child exports require the completion trailer, counts, digest and original EOF; a short preview or revoked download is not a complete archive.
Capture reports redaction, omitted binary/hidden data, source truncation and incomplete recording explicitly.
Known-secret redaction is not universal detection of business secrets.
Storage exhaustion refuses new work rather than silently evicting history.

## Capture, retained history and privacy

Task workers use public SDK APIs, explicit empty resources, in-memory session/settings and disabled retries/compaction/cache warming.
Ordinary-conversation workers share that launcher/auth/capture boundary but load only the explicit ordinary resource policy in [clients](clients.md#ordinary-conversations) and restore their own bounded sanitized checkpoint into an in-memory SessionManager.
Verify exact model and effective thinking before READY/prompt; no provider discovery, credential argv/file envelope or implicit network fallback.
Use the awaited public core-agent subscription for backpressure, reserving synchronous tool/update ingress before any copy or await.
Custom bash uses public local operations plus the bounded redacted accumulator, not the stock raw-spill accumulator.
Never await a run's own settlement from inside its awaited subscriber.

Sanitize known literals, structured sensitive values and terminal controls before stdout and again before owner persistence.
Preserve split UTF-8, escaped literals, surrogate pairs and possible secret prefixes across chunks; independent per-chunk string replacement is insufficient.
Tool-start is an SDK observation, not proof of native execution; tool error is not a parent check result.
A prompt/preflight/non-success terminal response is labeled `worker-failure: prompt`, not `capture`; the recorded message stop reason, actual exit and cleanup facts stay independent.
A browser settlement timeout must retain its last receipt/active-roster facts before fixture teardown: a later Stop and its uncertain publication are not evidence that capture caused the original wait failure.
Hidden thinking, signatures, provider envelopes and binary/media bodies remain explicitly omitted.
Known-secret sanitation is not universal business-secret detection or an OS privacy sandbox.

Only the serialized history writer assigns committed sequence and persisted content references.
Commit actual admission/auth/launch/result facts in order; an index, observer callback or candidate reducer cannot authorize effects.
Quota/exhaustion/refusal stops unsafe work without eviction; torn tails retain a verified prefix and visible gaps, while interior corruption refuses affected ranges.
Derived indexes are optional accelerators: readers validate original batches/artifacts, use bounded fallback and never repair on view.
Live task/run/child views share an already observed containing snapshot only within one notification drain, retaining its exact context and committed watermark.
Narrowing requires the requested parent/child to be present; a historical run outside the task horizon still takes its independent reader, and no observation is cached into the next drain or used as renewed action consent.
Transient reuse keeps at most one page-sized source per viewer, rather than retaining every unobserved run ring.
Current/plan/review reads replay a task's batches, so per-file cost bounds them: on a slow host (Windows Node 22) that replay once exceeded the 100ms read quantum after review, leaving the task `unavailable`.
`PrivateFiles` reuses a directory walk only within one synchronous `DirectoryWalks` scope (a read budget or lease check), after re-observing that directory's identity; an await or later call walks again, and the quantum is never raised instead.
When a batch settles a task's publication, the owner writer remembers in process memory that task's fold state (check facts, latest run, plan/lineage progress with original admission locators) under its chain head's sequence and hash, a bounded number of tasks and states.
Readers in that process resume from the newest remembered state at or before the snapshot whose chain link still matches and fold only newer original batches; an evicted, restarted, foreign-process or diverged miss folds the original chain, and nothing is persisted, authenticated or repaired.
A quantum that makes no semantic progress because its wall-clock time ran out (a host stall: GC, scheduling, scanning) is repeated with a fresh quantum at most twice before its refusal stands; byte exhaustion and every other refusal stay final, and no progress is ever faked.
The wall-clock quantum belongs only to client-facing cooperative reads: owner-internal authority reads (current views, admission, publication, Review and receipt facts) are bounded by the same bytes but never by time, so host speed cannot turn an owner's own decision into a refusal.
Plan proofs and Review selections read their small plan text through its content/part indexes under the validated snapshot, verifying the original chunk batches, artifacts and aggregate hash; absent or faulty indexes fall back to the complete validated-prefix scan, which no longer runs per current view.
Prepared journal heads avoid redundant mutable legacy hints; no-root compatibility and its original integrity checks remain.

New history uses private format3 at `service-v1/history-v2/`, with exclusive private read-proof key creation before the final format marker.
Format2 remains readonly, without silent migration or key regeneration.
AES-256-GCM navigation authenticates bounded suspended source validation; cursors never grant authentication, admission, recovery or lock-release authority.
Resume must advance actual semantic work and revalidate selected source/key/format incarnations, not merely produce a new nonce or reset proof budgets.
These are supported-writer observations, not atomic snapshots of every archived file or change-and-revert detection.

History data pages are untagged; list readers also return explicit `progress` or initial `snapshot`, while detail/entity/graph return data or progress.
`SearchPage` has hits/next/coverage: zero hits with next is not completion.
Keep exact snapshot/entity/version/UTF-8 ranges and source coverage; do not map progress to an empty successful page or rebase Back navigation.
Readonly POST uses the same finite security/decoder boundary when inputs cannot fit GET; it is not execution consent.
Exports stream task/run/child scope with actual counts/digest/watermark/trailer and original EOF; revoked or interrupted output has no successful completion.
Browser download requested is not UI-verified completion; native export verifies the complete stream and creates destinations exclusively.
