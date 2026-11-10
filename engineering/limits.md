# Resource ceilings

Current defaults and ceilings across the service, history and clients.
Byte values are UTF-8/encoded bounds where specified; they are not targets to silently increase when a fixture fails.

The code is the source of truth.
Each row names its owner: `LIMITS` keys refer to `src/worker-public.mjs` and are listed in the order their values appear, and `test/independence.test.ts` fails when a value no longer appears in that order.
Rows naming a module are maintained by hand; update them in the same change as the constant.

| Boundary              | Default / ceiling                                                                                                                                                      | Source                                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Graph / assignments   | 512KiB body; 1–16 required assignments                                                                                                                                 | `LIMITS`: `graphBytes`, `assignments`                                                                    |
| Scheduling            | 8 historical episodes; 2 preparing/running/closing child-or-check reservations                                                                                         | `LIMITS`: `episodes`, `childReservations`                                                                |
| Dependency input      | 16KiB per predecessor; 32KiB aggregate; oversized required input blocks, not clips                                                                                     | `LIMITS`: `predecessorBytes`, `handoffBytes`                                                             |
| Worker request        | 96KiB public pre-auth plus 32KiB reserve; actual complete envelope 128KiB                                                                                              | `LIMITS`: `publicRequestBytes`, `workerRequestBytes`                                                     |
| Process stop          | TERM then KILL after 1000ms; unknown after 3000ms without confirmed close                                                                                              | `LIMITS`: `terminateGraceMs`, `unconfirmedStopMs`                                                        |
| Native service checks | 16MiB aggregate raw output; 64KiB raw chunk; 32MiB retained detail; legacy 256KiB/64KiB behavior unchanged                                                             | `src/service/check-recording.ts`                                                                         |
| Capture               | 64KiB encoded frame; 8KiB decoded chunk; 32MiB per detail; 4096 unresolved protocol entries                                                                            | `LIMITS`: `frameBytes`, `chunkBytes`, `detailBytes`, `captureEntries`                                    |
| Capture queues        | Worker 4MiB/1024 frames; owner 8MiB/2048; original write backpressure has no elapsed-time failure                                                                      | `LIMITS`: `workerQueueBytes`, `workerQueueFrames`, `ownerQueueBytes`, `ownerQueueFrames`                 |
| Change observation    | 3s Git budget; 16MiB raw output per Git command hashed whole, otherwise a fixed outcome; 2000 inventoried files, 1MiB each, 8MiB in all; 128KiB display text           | `src/task-diff.ts`                                                                                       |
| Task v1               | 128KiB record; goal 8KiB/plan 32KiB/result and baseline 16KiB; 32 checks/64 activity; 1000-task compatibility ceiling                                                  | `src/task-types.ts`, `src/task-store.ts`                                                                 |
| Read quantum          | 8MiB or 100ms cooperative work, including resumed proof/accounting                                                                                                     | `LIMITS`: `searchBytes`, `searchMs`                                                                      |
| Read replies          | 512KiB full paged/progress Reply; 256KiB detail text; graph data/export-frame 1MiB with graph body 512KiB                                                              | `LIMITS`: `pageBytes`, `detailPageBytes`, `graphBytes`                                                   |
| Paging/search         | 50 default/200 maximum entries; literal case-sensitive query 1–1024 bytes                                                                                              | `LIMITS`: `pageEntries`, `maxPageEntries`, `queryBytes`                                                  |
| Navigation            | 8192 bytes of encoded ASCII; encrypted plaintext 6000 bytes; no execution authority                                                                                    | `LIMITS`: `navigationBytes`                                                                              |
| Live/export           | 16 viewers, 256 messages/1MiB each; 2 search/2 export readers; 120s download idle, not total archive timeout                                                           | `LIMITS`: `viewers`, `viewerMessages`, `viewerBytes`, `searchReaders`, `exportReaders`, `downloadIdleMs` |
| Storage               | 10GiB checkout quota; 512MiB reserved per episode; 256MiB free-space floor; no TTL cleanup                                                                             | `LIMITS`: `checkoutQuotaBytes`, `episodeReservationBytes`, `freeSpaceFloorBytes`                         |
| Self-healing          | 10min legacy boot margin; 5s PID-reuse slack; 1min torn-lock age; workers TERM then KILL within 5s                                                                     | `src/service/liveness.ts`, `src/service/self-heal.ts`                                                    |
| Recovery log/archive  | 50 events (one recovery merges within 2min); archive 30 days or 2GiB; WebUI notices 7 days                                                                             | `src/service/recovery-log.ts`                                                                            |
| Process ledger        | 512 workers per epoch, 64KiB file; evidence only                                                                                                                       | `src/service/process-ledger.ts`                                                                          |
| Owner self-restart    | 30s settle before exit 75; 3 consecutive restarts within 10min; successor waits 60s                                                                                    | `src/service/host.ts`                                                                                    |
| Unified workbench     | 128 selected directories; 1024 durable startup/association preparation receipts (warm reuse writes none); 64 connections; bounded proxy frames and bodies; no eviction | `src/service/gateway.ts`, `src/service/gateway-store.ts`                                                 |
| Assets                | 16MiB per member/64MiB closure; fixed complete manifest and all font bodies                                                                                            | `src/service-assets.ts`                                                                                  |

Image input has no Cadence-specific count, byte, dimension or pixel quota; browser/host memory, provider limits and the existing control/session read budgets still apply.
`src/image-content.mjs` (`IMAGE_LIMITS`) keeps upload/history chunks at 256KiB base64 characters and ephemeral staging valid for 10min idle; base64 adds about one third.
The private worker image pipe is checked against the exact owner-declared byte length and SHA-256, not a fixed image payload ceiling; each active turn separately holds its admitted message bytes.

Conversation workflow bounds live in `src/service/contracts/workflow.ts` (`WORKFLOW_LIMITS`) and `src/service/workflows.ts`: 16 initial assignments (IDs up to 48 characters) and at most 48 listed by one run once revisions add and supersede some (`route`), eight questions per research run, 16 checks per set and four explicit setup commands.
How many workflow workers of one run are in flight is an execution limit, not a plan bound: `PARALLEL` in `src/service/workflows.ts` (default 4, at most 16), set by `CADENCE_PARALLEL` in the owner's environment; a value that is not a whole number from 1 is the default.
An owner lets 64 auth preparations wait their turn (`PREPARATIONS` in `src/service/model-context.ts`).
Adaptive delivery and every Agent have no fixed repair-round count or total runtime deadline.
New setup/check definitions omit `timeoutMs` by default; explicit values (100–2147483647ms, the native timer range) remain exact, including already approved plans.
Historical task-check codecs retain their original 20min validation boundary; they grant no current execution authority.
Implementation uses one stable candidate on a new named branch after approval, plus at most one temporary child worktree per assignment (256 recorded artifacts per run).
`CHANGE_LIMITS` in `src/change-tools.mjs` bounds four live Git evidence streams, 2KiB raw pages, 120s idle expiry and a 30s active-page budget; stop joins actual child closure.
`src/service/repository-coordination.ts` bounds lease waiting at 30s with 50ms polling and recovery inspection at 256 active owner intents; no live lease expires by age.
Pi's effective settings own agent-layer request retries/backoff; `WORKER_POLICY` in `src/worker-model.mjs` keeps provider-internal retries and cache warming off.
No Cadence retry count replaces the configured Pi policy.
A successful model response resets that request's retry counter; waits and requests remain inside one original SDK session, with no second workflow-level network retry loop.
The default `httpIdleTimeoutMs: 0` uses Pi 1.5.0's public disabled setting; an explicit Pi idle policy is honored.
`src/sdk-worker.mjs` uses the admitted value for its owned direct/proxy Undici header/body timeouts.
Pi internally maps that setting to its maximum provider-request timer, so this is not proof of unlimited provider latency or a removal of upstream SDK/proxy policies.
This does not extend an upstream proxy's timeout, reconnect an ended stream or promise a maximum total latency of only the summed backoff.
At most four workflows are active (one approved implementation at a time); retained history has no lifetime run or journal cap, only the existing 256MiB free-space floor.
The fast-forward merge has no timeout and is never signalled (output beyond 256KiB is dropped and labelled), so a hung `git merge` holds the run, the checkout gate and orderly Stop until Git exits; other recorded in-run Git commands also have no default execution timeout; admission observation is names-only with a 64MiB/30s bound and target contents are stream-hashed.
A declared directory's identity hashes up to 20,000 entries; a larger one is refused as `invalid` with a request for narrower paths.
Run snapshots allow 384KiB and 256 recent status steps.
Settled prefixes move into immutable 128-step pages at the count bound or with 64KiB snapshot headroom remaining, retaining exact membership and results without limiting the lifetime number of attempts.
Workflow check/Git results use the existing 256KiB launcher output bound (`ProcessSpec.retainOutput` in `src/subagent-process.ts`), not its legacy 64KiB preview; legacy previews and native output/stop budgets remain unchanged.
`WORKFLOW_RESULT_BYTES` in `src/service/workflow-result.ts` bounds the redacted JSON-encoded result to 240KiB, reserving wrapper space below the 384KiB record, 256KiB file-text DTO and 512KiB reply limits.
Diagnostic head/tail clipping is explicitly flagged, including JSON escaping and redaction expansion; an implementation report is independently parsed from its complete selected message within 16KiB before field sanitation or display clipping.
A subagent transcript beyond the conversation capture bounds (384KiB, 256 items) keeps a labelled prefix and the worker continues.
Only owned worktrees at their accepted, delivered commit and without any residue (ignored files included) are removed after successful post-merge checks with plain `git worktree remove`; other worktrees and the named task branch remain.
Worker context remains the existing 32KiB bound and is refused rather than clipped.

Browser coordination permits one active SDK coordinator turn per conversation and at most 8 per project owner (`conversation-workflow.ts`).
There is no per-Send bridge-call or investigation-batch quota; each investigation batch has at most two readonly workers.
Conversation-control records have no retained-directory admission cap; the bounded cache is not a storage quota.
The bridge refuses requests/replies above 64KiB; status and investigation evidence previews label truncation and omitted steps.
Control records are bounded at 384KiB and project the most recent 200 workflow links; links remain independently retained, without a lifetime attempt cap or history eviction.
There are at most 16 outstanding browser confirmation grants, each with the existing 120s lifetime.
The additional coordinator slot is owner-accounted and does not expand the two implementation-worker slots or bypass the checkout barrier.

The current checkout gate permits one holder and at most 16 waiting operations (`CHECKOUT_WAITERS` in `src/service/checkout-gate.ts`).
Waiting cancellation releases only that queue entry; holder abort/Stop/quarantine never releases an uncertain original.

Workflow history reads at most 200 directory entries per quantum and returns at most 20 summaries per page, retaining 21 candidate IDs per scan (`WORKFLOW_LIMITS.historyScanEntries`, `historyPage`).
At most 16 scans hold readonly directory handles; 120s idle expiry or owner teardown closes them (`historyScans`, `historyIdleMs`).
These are read budgets, not a lifetime retained-run cap; history is never evicted to satisfy them.

Ordinary readonly file tools use the installed Pi SDK's output limits and notices; Cadence no longer owns a second scanner, batch quota, page quantum or ordinary cursor limit.
SDK output truncation is not a bound on all underlying filesystem I/O or a claim of complete coverage.
There is no cumulative tool-call quota or early final-report cutoff.
The launcher has no Agent deadline, including SDK bootstrap.
The toolkit joins admitted file-tool originals before settling cancellation.
Fixed-revision Git evidence retains the separate `CHANGE_LIMITS` beside `src/change-tools.mjs`; worker capture and transport ceilings are unchanged.
Explicit investigation roots are limited to eight (`bindWorkerWorkspace` in `src/worker-workspace.mjs`); omitted roots select the conversation cwd.

Conversations are Pi session files with no Cadence-side lifetime byte, turn or count cap (`src/service/pi-sessions.ts`).
Session reads use 64KiB chunks and an 8MiB body LRU per opened session, with no 64MiB total-file refusal; unreadability never proves a requested ID absent.
A listing considers the newest 10,000 file names, and settings files are read up to 1MiB.
One JSONL record must still fit host parsing memory; the entry/branch index and Pi 1.5.0 SessionManager retain metadata/full SDK history proportional to entry count.
A truly paged index and SDK manager need a separate storage-interface change; neither compaction nor cache eviction deletes original history.
The reader caches eight parsed sessions and 64 built turns; neither bounds what is retained.
History pages hold 50 summaries; the tree read returns the newest `TREE_NODES` (1000) user messages and says when more exist.
A step-detail part holds at most 200KiB of encoded text and 48KiB of encoded arguments, so every part fits one 512KiB reply.
Conversation reads have no turn-count or byte page: the head carries a summary and a count, and each read covers one turn or one part of one step.
The head's context size looks back at most `USAGE_WALK` (256) entries from the branch end, reading message bodies only, and an opened session remembers 64 such results (`src/service/pi-sessions.ts`).
A turn read lists at most `STEP_READ` (24) steps, each with at most `STEP_TEXT_BYTES` (16KiB) of encoded text and a 1KiB tool target (arguments over 1MiB name none), which always fits one 512KiB reply; the client reads further ranges itself (`src/service/contracts/workbench.ts`).
The WebUI keeps four reads in flight per conversation.
Workbench read replies of at least 1KiB are gzip-compressed when the request accepts it; session replies never are.
A live browser turn's preview keeps at most 64KiB per streamed message or tool output (labelled when clipped), for its eight most recent messages and eight most recent tools, and 64 open details; the rest is read from the session once Pi writes it (`src/service/conversations.ts`).
A session's index names its last 64 browser messages; the owner caches 512 message states and admits eight browser turns at a time, one per session.
A conversation name is one trimmed line of at most `CONVERSATION_NAME_CHARS` (100) code points (`src/service/contracts/workbench.ts`).
A rename child may run for `SESSION_RENAME_MS` (60s, `src/subagent-process.ts`); an owner runs four at once, one per session, and keeps the outcome of its last 64 rename commands for a repeated command (`src/service/conversations.ts`).
Archive records are one small file per archived session, without a count limit.
Admission retains the 256MiB free-space floor for the owner's records; Pi's own writes are bounded only by the disk, as in the terminal.
Instantaneous protocol/memory and concurrency protections remain; cumulative bytes and SDK events are diagnostics, not worker lifetime quotas.

Stopped-owner conversation and file views (`src/service/gateway-conversations.ts`) cache at most 16 reader instances, each using the bounded Pi session and command caches; file reads keep the owner's 200-entry listing and 128KiB preview bounds.
Replacement, access rotation and workbench Stop discard their read caches; eviction affects only reads, never retained data or execution.
Conversation-control projections (`src/service/conversation-controls.ts`) cache at most 512 records; they retain the existing 384KiB record bound and never cache transient I/O failures.

Browser explicit-Send preparation uses `SEND_PREPARATION_MS` in `web/src/client/conversation-send.ts`, separate from model/worker execution.
Its deadline abandons only an unsent client continuation; it never kills the owner or releases accepted work.
Message bytes share `CONVERSATION_SEND_BYTES` with the owner decoder.
The composer's browser-local bounds sit beside their code: `PROMPT_HISTORY_MAX` recalled prompts per checkout in `web/src/composer/prompt-history.ts` (halved when sessionStorage is full), `MENTION_ROWS` rows of one `@` listing in `web/src/composer/at-mention.ts`, and the text area's `COMPOSER_MIN_HEIGHT`/`COMPOSER_MAX_HEIGHT` in `web/src/components/workspace/ChatComposer.tsx`.

Conversation context records use `BYTES` in `src/service/conversation-contexts.ts` (16KiB); there is no aggregate conversation-settings eviction/quota.
Their model selections reuse the existing `OwnerModelContext` cache bounded by `LIMITS.maxPageEntries`, sharing one source per exact selector rather than one per conversation.
Preference revision and encoded-byte checks precede source installation or persistent writes.

Checkout session discovery considers at most 256 directory sources and remembers 128 explicitly observed cwd-to-session-directory resolutions in memory (`src/service/pi-sessions.ts`).
The one shared reader retains its existing eight parsed-session and 64 built-turn bounds across those sources, not one cache per directory; no checkout tree is scanned and no session directory is created by discovery.

Project knowledge observations use `KNOWLEDGE_LIMITS` in `src/service/project-knowledge.ts`: 160 candidate documents, depth 3, 64KiB observed per file, 8KiB per named source and 4KiB per discovered one, and at most 16KiB of selected context (less when the existing 32KiB worker context needs the room).
The managed store's budget is `KNOWLEDGE_STORE` in `src/service/knowledge-store.ts`: a 4KiB route table, 8KiB per topic, 1KiB per entry, 200KiB in all and 64 topic files; a delivery that leaves it over budget does not pass; a route no worker was routed to for eight curated deliveries (`idleDeliveries`) is named to the curator.
Recorded investigations use `INVESTIGATIONS` in `src/service/investigations.ts`: 32 cited files per record out of 256 path-like words examined, files up to 2MiB, and reuse of an answer for 14 days.
A worker's report may propose five lessons of 400 characters; one delivery keeps 32 (`LESSONS` in `src/service/workflows.ts`).
Selected excerpts and omitted sources are labelled.
These are per-observation bounds, not delivery budgets.

Model preview discovery (`src/service/model-preview-protocol.ts`) permits two original child processes, a 15s total startup/import/read deadline and a 1MiB private input; output shares `LIMITS.pageBytes`.
Identical in-flight inputs coalesce, but completed results and SDK runtimes are not cached in the gateway.
A timed-out child uses the existing `LIMITS.terminateGraceMs` and `LIMITS.unconfirmedStopMs`; a reporting failure never releases its process charge before native close.

## Agent-limit audit

- **Removed:** Agent/episode/ready-wait execution deadlines, unused queued-assignment/auth-wait constants, cumulative capture/event ceilings, elapsed recording-failure timers and the recorded Git runner's default deadline.
  Historical task/graph evidence codecs remain.
- **Refactored:** active capture state is reclaimed on message/tool settlement; native command output and shell results retain redacted, explicitly truncated previews rather than aborting for cumulative logs.
  OAuth preparation and writeback stay owner-owned; each request re-resolves the pinned source over private IPC, with a two-minute request validity margin rather than whole-worker validity.
  External identity/source replacement refuses; no refresh retry layer is added.
- **Retained:** one SDK request-retry layer (Pi-configured retries per failed model response, not thought rounds), consent/read/write scopes, exact candidates, real checks and independent Agent Review; frame/detail/live-queue bounds, real storage/free-space errors, connection establishment checks and post-cancel TERM/KILL/unknown timers.
  Checkout serialization is unchanged.
  Readonly Git admission/evidence budgets bound observations, not an Agent's lifetime or an accepted Git mutation.
- **Separate prerequisites:** fully paged Pi history/tree storage requires an appropriate public SDK session interface; provider/SDK transport policies and real OAuth/provider behavior require their own qualification.
  No service restart, workflow replay or history deletion substitutes for these prerequisites.

### Pi preference observations

`WORKER_SETTINGS_BYTES` beside the private runtime codec in `src/worker-model.mjs` bounds one preference snapshot to 32 KiB, sharing the existing private launch-envelope bound.
`SETTINGS_FILE_BYTES` in `src/service/worker-settings.ts` bounds each settings/trust observation to 1 MiB.
Neither accumulates across an Agent lifetime.
Malformed selected sources/preferences or unavailable configured tools refuse; user sources are never repaired, deleted or imported.
