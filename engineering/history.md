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
Ordinary-conversation workers share that launcher/auth/capture boundary but load only the explicit ordinary resource policy in [clients](clients.md#ordinary-conversations) and continue the selected branch through Pi's file-backed SessionManager.
Verify exact model and effective thinking before READY/prompt; no provider discovery, credential argv/file envelope or implicit network fallback.
Use the awaited public core-agent subscription for backpressure, reserving synchronous tool/update ingress before any copy or await.
Custom bash uses public local operations plus the bounded redacted accumulator, not the stock raw-spill accumulator.
Never await a run's own settlement from inside its awaited subscriber.
Pi system-message start/end events are input-control occurrences, not user or assistant output.
Their pairing remains checked; the initial effective prompt is captured once as context, while SDK system-message bodies (including section/tool-loadout patches) carry explicit context-source omissions rather than being copied into chat or silently labelled complete.
Unknown message roles, overlapping occurrences and unfinished system messages still refuse capture.

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

## Ordinary conversation records

`conversation-records.ts` and `conversation-controls.ts` share the original decoders, membership checks, transcript paging and degraded-control rules between live owners and the authenticated workbench.
A stopped-owner view pins its registration and selected configuration, checking both and the stopped coordination state before and after reads; it never repairs, migrates, opens an SDK session or reconstructs an execution lease.
A live or inconclusive owner stays on its real transport.
A cold reader's empty original-turn map must never turn live work into an inferred interruption.
Workbench access rotation and Stop close retained view handles; an owner restart or view eviction invalidates their continuations without restarting a scan.

Conversation content lives in the project's Pi session files, which Pi writes as the terminal does (see [clients](clients.md#ordinary-conversations)); the owner reads them and keeps no copy.
`src/service/pi-sessions.ts` folds each file line by line into a listing summary and, for an opened session, an entry tree, reading only what was appended since and ignoring malformed or torn lines as Pi does; a replaced or shortened file is read from its start.
A branch is the path from the root to one entry; it splits into turns at user messages, and each turn becomes chat items: text, tool calls paired with their results, terminal `!` commands, compaction and branch summaries and displayed extension messages.
Built turns are cached by content and secret set; redaction applies to every returned field, and large fields split into parts by their exact encoded size.
A live browser turn adds, by count, only the streamed messages and tool output its worker has not yet written to the session.
The owner's `conversation-commands-v1` keeps per message `accepted.json` (command, session, parent entry, file size, execution snapshot and selected session path), an expected-byte `state.json` (status, notice, omitted flags, its user entry), the auth journal, `launch.json` and `native.json`, plus a per-session index of the last 64 messages.
An accepted command ID is never admitted again; a lost reply observes its original record.
Read projections reapply current redaction to failed attempts and live previews as well as Pi content.
Summaries and turns use the matching durable browser settlement, not a Pi stop reason as proof of native/auth/storage success.
Startup refuses while a session's latest browser message has an unknown closure; one that was queued or running when the owner stopped reads as interrupted.
Old `conversations-v1` transcripts are unsupported and never decoded, migrated, rewritten or deleted.
The presence of an old identity/session record refuses reuse of that ID; current Pi sessions without those old records remain supported.
Workflow-to-conversation links are retained separately at admission, without an old-control-directory scan fallback; the recent window does not limit new investigations or approvals.
The terminal's workflows are found from its `cadence-conversation-mode/1` entries in the session that started them.

## Conversation workflow records

The owner-private `workflows-v1` namespace is separate from task history and ordinary conversation turns.
It stores immutable versioned agreements/accepted commands, expected-byte run snapshots, original auth/native settlements, sanitized worker transcripts and bounded process results with explicit diagnostic truncation.
Version-2 runs additionally retain route revisions, launch knowledge manifests and immutable earlier-step pages with exact step membership.
Snapshot step bounds are view bounds, not lifetime attempt quotas; native/Web history can select earlier pages without rebasing live execution.
All original results remain retained.
New snapshots also retain the immutable target binding, named branch/worktree, exact candidate acceptance, independent integration/post-checks and cleanup outcomes.
Restart marks applying/preparing stages unknown and retains artifacts without replay; shared delivery resource records are coordination, not another history store.
One-use confirmation grants remain ephemeral; persisted mode or Markdown never reconstructs them.
The shared capture sanitizer is reused, not a second credential policy.
Worker result rendering includes owner literals as well as prepared-model literals; retained result text/output are sanitized before writing, not just in previews.
Selected final-result previews come from the sanitized complete captured message or independently captured structured assignment report before clipping, not a raw prefix that could bisect a known literal.
Detail reads reapply the shared structural sanitizer for currently known secrets, including pre-fix records, without rewriting or migrating retained bytes.
Run and archived-step preview reads also reapply current known literals without changing stored bytes or live execution state.
Status previews label clipping and offer exact retained step-result lookup.
Workflow check/Git results use the launcher's bounded output rather than its legacy preview; `workflow-result.ts` then budgets the JSON-encoded result, including redaction expansion and the outer record/reply wrappers.
If the retained diagnostic cannot fit, a scalar-aligned head/tail excerpt and truncation flag preserve coverage honestly without losing native exit/closure facts.
Detail reads apply the same bounds after current redaction and report limitations, without rewriting older records or reconstructing missing output.
Output or final-text clipping sets the aggregate result's truncation flag independently of native exit; this flag is not the completeness of a separately selected implementation report.
Structured diagnosis replies retain their own codec allowance, not the smaller ordinary-text preview allowance.
Restart treats incomplete work as uncertain, never completed or a resumable mutation queue.
No incidental migration or cleanup occurs.

Browser control records use `service-v1/conversation-workflows-v1`, with immutable binding markers in the ordinary conversation namespace.
Missing/deleted bound controls refuse instead of silently reverting to ordinary editing tools.
Explicit activation binds an existing/new conversation without rewriting its session; nothing is imported or migrated incidentally.
Control revision, accepted proposal and run-attempt identities are retained separately from the session.
Approval evidence records the exact proposal/revision and authenticated caller, never a reusable grant or browser cookie.
Ordinary and coordinator live previews still use the existing capture sanitizer; their content is written by Pi to the session.
A separate bounded IPC channel admits only named research/plan/status requests; it cannot carry a browser/native execution capability.

## Readonly diagnostics

Native `/cadence-history` and browser History details retain old task search/export without its creation, plan editing, checks or human Review controls.
Workflow history selects exact IDs in ID order with bounded directory-scan continuations, then reads at most `WORKFLOW_LIMITS.historyPage` retained summaries.
A progress reply is not an empty or complete page; its one-use scan token resumes the same exclusive ID boundary.
Scans retain only the next page plus lookahead and a bounded native directory buffer, never the full inventory.
Idle expiry and owner teardown close only owned readonly handles; expired, consumed or foreign-owner tokens refuse and require an explicit fresh observation, never replay of work.
The cursor is an exclusive ID boundary, not an immutable snapshot: concurrent new IDs before it require a new first-page observation.
Unreadable run entries remain visibly unavailable; unsafe directory entries refuse, and listing never repairs or removes records.
Step results and subagent transcripts are selected by exact run/step identity, independent of model availability.
Workflow history has full retained detail lookup, not the legacy task engine's exact-search/export protocol.

New workflow observations retain owner acceptance, checkout acquisition and settlement times, plus worker preparation, native spawn, stop request, direct-child close and original settlement.
Process lifecycle callbacks update memory only; normal capture/result settlement persists these observations under the original owner lifetime, never ahead of stop signals.
Unconfirmed native settlement stays unknown; a late close cannot update the settled observation or release its fence.
Owner version/source fingerprint is embedded by the service builder, not inferred from the extension or a subsequently replaced package manifest; PID, epoch, entry, platform and Node identify the process.
Worker READY reports its imported public SDK version and observed worker-source hash.
These are diagnostic observations, not execution authority or an atomic proof against package replacement.
Missing observations are labelled unrecorded, never reconstructed from a parent session's batched tool-result times or filesystem mtimes.
Reads do not migrate retained records.

## Conversation execution context

`conversation-contexts.ts` keeps credential-free selectors, immutable cwd and a preference revision under `service-v1/conversations-v1/contexts/<id>.json`.
Reading an absent context uses the Pi session header when present; it neither creates settings nor invents the model used by old turns.
A context/identity mismatch or malformed record refuses only that context and preserves its bytes.
An explicit choice compares the observed record; restoring unchanged settings installs only a live source and does not rewrite the record or the default for new conversations.
New turn headers and workflow runs retain `ExecutionContext` (cwd, checkout root, bound version and selected model), never credentials or approval capabilities; old records omit it without migration.
Stopped-owner reads use the same context decoder and exact registration/config snapshots as other retained conversation reads.
