# Resource ceilings

Current defaults and ceilings across the service, history and clients.
Byte values are UTF-8/encoded bounds where specified; they are not targets to silently increase when a fixture fails.

The code is the source of truth.
Each row names its owner: `LIMITS` keys refer to `src/worker-public.mjs` and are listed in the order their values appear, and `test/independence.test.ts` fails when a value no longer appears in that order.
Rows naming a module are maintained by hand; update them in the same change as the constant.

| Boundary              | Default / ceiling                                                                                                                                                      | Source                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Graph / assignments   | 512KiB body; 1–16 required assignments                                                                                                                                 | `LIMITS`: `graphBytes`, `assignments`                                                                        |
| Scheduling            | 8 episodes; 128 queued assignments; 2 preparing/running/closing child-or-check reservations                                                                            | `LIMITS`: `episodes`, `queuedAssignments`, `childReservations`                                               |
| Policy deadlines      | 6h episode; 10min ready wait; 20min default worker                                                                                                                     | `LIMITS`: `episodeMs`, `readyWaitMs`, `workerMs`                                                             |
| Dependency input      | 16KiB per predecessor; 32KiB aggregate; oversized required input blocks, not clips                                                                                     | `LIMITS`: `predecessorBytes`, `handoffBytes`                                                                 |
| Worker request        | 96KiB public pre-auth plus 32KiB reserve; actual complete envelope 128KiB                                                                                              | `LIMITS`: `publicRequestBytes`, `workerRequestBytes`                                                         |
| Process stop          | TERM then KILL after 1000ms; unknown after 3000ms without confirmed close                                                                                              | `LIMITS`: `terminateGraceMs`, `unconfirmedStopMs`                                                            |
| Native service checks | 16MiB aggregate raw output; 64KiB raw chunk; 32MiB retained detail; legacy 256KiB/64KiB behavior unchanged                                                             | `src/service/check-recording.ts`                                                                             |
| Capture               | 64KiB encoded frame; 8KiB decoded chunk; 32MiB detail; 128MiB child protocol                                                                                           | `LIMITS`: `frameBytes`, `chunkBytes`, `detailBytes`, `childProtocolBytes`                                    |
| Capture queues        | Worker 4MiB/1024 frames; owner 8MiB/2048; 5s reporting stall retains original charges                                                                                  | `LIMITS`: `workerQueueBytes`, `workerQueueFrames`, `ownerQueueBytes`, `ownerQueueFrames`, `recordingStallMs` |
| Change observation    | 3s Git budget; 16MiB raw output per Git command hashed whole, otherwise a fixed outcome; 2000 inventoried files, 1MiB each, 8MiB in all; 128KiB display text           | `src/task-diff.ts`                                                                                           |
| Task v1               | 128KiB record; goal 8KiB/plan 32KiB/result and baseline 16KiB; 32 checks/64 activity; 1000-task compatibility ceiling                                                  | `src/task-types.ts`, `src/task-store.ts`                                                                     |
| Read quantum          | 8MiB or 100ms cooperative work, including resumed proof/accounting                                                                                                     | `LIMITS`: `searchBytes`, `searchMs`                                                                          |
| Read replies          | 512KiB full paged/progress Reply; 256KiB detail text; graph data/export-frame 1MiB with graph body 512KiB                                                              | `LIMITS`: `pageBytes`, `detailPageBytes`, `graphBytes`                                                       |
| Paging/search         | 50 default/200 maximum entries; literal case-sensitive query 1–1024 bytes                                                                                              | `LIMITS`: `pageEntries`, `maxPageEntries`, `queryBytes`                                                      |
| Navigation            | 8192 bytes of encoded ASCII; encrypted plaintext 6000 bytes; no execution authority                                                                                    | `LIMITS`: `navigationBytes`                                                                                  |
| Live/export           | 16 viewers, 256 messages/1MiB each; 2 search/2 export readers; 120s download idle, not total archive timeout                                                           | `LIMITS`: `viewers`, `viewerMessages`, `viewerBytes`, `searchReaders`, `exportReaders`, `downloadIdleMs`     |
| Storage               | 10GiB checkout quota; 512MiB reserved per episode; 256MiB free-space floor; no TTL cleanup                                                                             | `LIMITS`: `checkoutQuotaBytes`, `episodeReservationBytes`, `freeSpaceFloorBytes`                             |
| Self-healing          | 10min legacy boot margin; 5s PID-reuse slack; 1min torn-lock age; workers TERM then KILL within 5s                                                                     | `src/service/liveness.ts`, `src/service/self-heal.ts`                                                        |
| Recovery log/archive  | 50 events (one recovery merges within 2min); archive 30 days or 2GiB; WebUI notices 7 days                                                                             | `src/service/recovery-log.ts`                                                                                |
| Process ledger        | 512 workers per epoch, 64KiB file; evidence only                                                                                                                       | `src/service/process-ledger.ts`                                                                              |
| Owner self-restart    | 30s settle before exit 75; 3 consecutive restarts within 10min; successor waits 60s                                                                                    | `src/service/host.ts`                                                                                        |
| Unified workbench     | 128 selected directories; 1024 durable startup/association preparation receipts (warm reuse writes none); 64 connections; bounded proxy frames and bodies; no eviction | `src/service/gateway.ts`, `src/service/gateway-store.ts`                                                     |
| Assets                | 16MiB per member/64MiB closure; fixed complete manifest and all font bodies                                                                                            | `src/service-assets.ts`                                                                                      |

Image input has no Cadence-specific count, byte, dimension or pixel quota; browser/host memory, provider limits and the existing control/session read budgets still apply.
`src/image-content.mjs` (`IMAGE_LIMITS`) keeps upload/history chunks at 256KiB base64 characters and ephemeral staging valid for 10min idle; base64 adds about one third.
The private worker image pipe is checked against the exact owner-declared byte length and SHA-256, not a fixed image payload ceiling; each active turn separately holds its admitted message bytes.

Conversation workflow bounds live in `src/service/contracts/workflow.ts` (`WORKFLOW_LIMITS`) and `src/service/workflows.ts`: 16 tasks (IDs up to 48 characters), two concurrent isolated workers, 16 checks per set, four explicit setup commands, at most two repair rounds and a 90min deadline counted from acquiring the checkout gate.
At most four workflows are active (one approved implementation at a time); retained history has no lifetime run or journal cap, only the existing 256MiB free-space floor.
The fast-forward merge has no timeout and is never signalled (output beyond 256KiB is dropped and labelled), so a hung `git merge` holds the run, the checkout gate and orderly Stop until Git exits; other in-run Git operations have 10min; admission observation is names-only with a 64MiB/30s bound and target contents are stream-hashed.
A declared directory's identity hashes up to 20,000 entries; a larger one is refused as `invalid` with a request for narrower paths.
Run snapshots allow 384KiB and 256 status steps.
Workflow check/Git results use the existing 256KiB launcher output bound (`ProcessSpec.retainOutput` in `src/subagent-process.ts`), not its legacy 64KiB preview; legacy previews and native output/stop budgets remain unchanged.
`WORKFLOW_RESULT_BYTES` in `src/service/workflow-result.ts` bounds the redacted JSON-encoded result to 240KiB, reserving wrapper space below the 384KiB record, 256KiB file-text DTO and 512KiB reply limits.
Diagnostic head/tail clipping is explicitly flagged, including JSON escaping and redaction expansion; an implementation report is independently parsed from its complete selected message within 16KiB before field sanitation or display clipping.
A subagent transcript beyond the conversation capture bounds (384KiB, 256 items) keeps a labelled prefix and the worker continues.
Clean worktrees at their expected commit are removed after a merge with plain `git worktree remove`; any other worktree is retained and listed.
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

Readonly investigation tools use `RESEARCH_LIMITS` in `src/research-tools.mjs`: 30s cooperative work per call, 2000 visited entries, depth 8, 100 results, 1MiB per text file, 8MiB read per call and 32KiB output.
There is no cumulative tool-call quota or early final-report cutoff.
The parent launcher alone enforces the total process deadline, including SDK bootstrap.
These are cooperative I/O limits: outstanding filesystem operations and directory/file closure are joined, never abandoned on timeout; the unchanged parent worker deadline is the hard process bound.
Explicit investigation roots are limited to eight; omitted roots select the conversation cwd.

Conversations are Pi session files with no Cadence-side lifetime byte, turn or count cap (`src/service/pi-sessions.ts`).
A session larger than `SESSION_BYTES` (64MiB) retains its identity through a bounded `HEADER_BYTES` (16KiB) header read but cannot be opened or continued; unreadability never proves a requested ID absent; a listing considers the newest 10,000 file names, and settings files are read up to 1MiB.
The reader caches eight parsed sessions and 64 built turns; neither bounds what is retained.
History pages hold 50 summaries; the tree read returns the newest `TREE_NODES` (1000) user messages and says when more exist.
A step-detail part holds at most 200KiB of encoded text and 48KiB of encoded arguments, so every part fits one 512KiB reply.
Conversation reads have no turn-count or byte page: the head carries a summary and a count, and each read covers one turn or one part of one step.
A turn read lists at most `STEP_READ` (24) steps, each with at most `STEP_TEXT_BYTES` (16KiB) of encoded text and a 1KiB tool target (arguments over 1MiB name none), which always fits one 512KiB reply; the client reads further ranges itself (`src/service/contracts/workbench.ts`).
The WebUI keeps four reads in flight per conversation.
Workbench read replies of at least 1KiB are gzip-compressed when the request accepts it; session replies never are.
A live browser turn's preview keeps at most 64KiB per streamed message or tool output (labelled when clipped), for its eight most recent messages and eight most recent tools, and 64 open details; the rest is read from the session once Pi writes it (`src/service/conversations.ts`).
A session's index names its last 64 browser messages; the owner caches 512 message states and admits eight browser turns at a time, one per session.
Admission retains the 256MiB free-space floor for the owner's records; Pi's own writes are bounded only by the disk, as in the terminal.
Worker deadline/protocol and concurrency protections are unchanged.

Stopped-owner conversation views (`src/service/gateway-conversations.ts`) cache at most 16 reader instances, each using the bounded Pi session and command caches.
Replacement, access rotation and workbench Stop discard their read caches; eviction affects only reads, never retained data or execution.
Conversation-control projections (`src/service/conversation-controls.ts`) cache at most 512 records; they retain the existing 384KiB record bound and never cache transient I/O failures.

Browser explicit-Send preparation uses `SEND_PREPARATION_MS` in `web/src/client/conversation-send.ts`, separate from model/worker execution.
Its deadline abandons only an unsent client continuation; it never kills the owner or releases accepted work.
Message bytes share `CONVERSATION_SEND_BYTES` with the owner decoder.

Conversation context records use `BYTES` in `src/service/conversation-contexts.ts` (16KiB); there is no aggregate conversation-settings eviction/quota.
Their model selections reuse the existing `OwnerModelContext` cache bounded by `LIMITS.maxPageEntries`, sharing one source per exact selector rather than one per conversation.
Preference revision and encoded-byte checks precede source installation or persistent writes.

Checkout session discovery considers at most 256 directory sources and remembers 128 explicitly observed cwd-to-session-directory resolutions in memory (`src/service/pi-sessions.ts`).
The one shared reader retains its existing eight parsed-session and 64 built-turn bounds across those sources, not one cache per directory; no checkout tree is scanned and no session directory is created by discovery.
