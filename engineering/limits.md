# Resource ceilings

Current defaults and ceilings across the service, history and clients.
Byte values are UTF-8/encoded bounds where specified; they are not targets to silently increase when a fixture fails.

The code is the source of truth.
Each row names its owner: `LIMITS` keys refer to `src/worker-public.mjs` and are listed in the order their values appear, and `test/independence.test.ts` fails when a value no longer appears in that order.
Rows naming a module are maintained by hand; update them in the same change as the constant.

| Boundary              | Default / ceiling                                                                                                     | Source                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Graph / assignments   | 512KiB body; 1–16 required assignments                                                                                | `LIMITS`: `graphBytes`, `assignments`                                                                        |
| Scheduling            | 8 episodes; 128 queued assignments; 2 preparing/running/closing child-or-check reservations                           | `LIMITS`: `episodes`, `queuedAssignments`, `childReservations`                                               |
| Policy deadlines      | 6h episode; 10min ready wait; 20min default worker                                                                    | `LIMITS`: `episodeMs`, `readyWaitMs`, `workerMs`                                                             |
| Dependency input      | 16KiB per predecessor; 32KiB aggregate; oversized required input blocks, not clips                                    | `LIMITS`: `predecessorBytes`, `handoffBytes`                                                                 |
| Worker request        | 96KiB public pre-auth plus 32KiB reserve; actual complete envelope 128KiB                                             | `LIMITS`: `publicRequestBytes`, `workerRequestBytes`                                                         |
| Process stop          | TERM then KILL after 1000ms; unknown after 3000ms without confirmed close                                             | `LIMITS`: `terminateGraceMs`, `unconfirmedStopMs`                                                            |
| Native service checks | 16MiB aggregate raw output; 64KiB raw chunk; 32MiB retained detail; legacy 256KiB/64KiB behavior unchanged            | `src/service/check-recording.ts`                                                                             |
| Capture               | 64KiB encoded frame; 8KiB decoded chunk; 32MiB detail; 128MiB child protocol                                          | `LIMITS`: `frameBytes`, `chunkBytes`, `detailBytes`, `childProtocolBytes`                                    |
| Capture queues        | Worker 4MiB/1024 frames; owner 8MiB/2048; 5s reporting stall retains original charges                                 | `LIMITS`: `workerQueueBytes`, `workerQueueFrames`, `ownerQueueBytes`, `ownerQueueFrames`, `recordingStallMs` |
| Task v1               | 128KiB record; goal 8KiB/plan 32KiB/result and baseline 16KiB; 32 checks/64 activity; 1000-task compatibility ceiling | `src/task-types.ts`, `src/task-store.ts`                                                                     |
| Read quantum          | 8MiB or 100ms cooperative work, including resumed proof/accounting                                                    | `LIMITS`: `searchBytes`, `searchMs`                                                                          |
| Read replies          | 512KiB full paged/progress Reply; 256KiB detail text; graph data/export-frame 1MiB with graph body 512KiB             | `LIMITS`: `pageBytes`, `detailPageBytes`, `graphBytes`                                                       |
| Paging/search         | 50 default/200 maximum entries; literal case-sensitive query 1–1024 bytes                                             | `LIMITS`: `pageEntries`, `maxPageEntries`, `queryBytes`                                                      |
| Navigation            | 8192 bytes of encoded ASCII; encrypted plaintext 6000 bytes; no execution authority                                   | `LIMITS`: `navigationBytes`                                                                                  |
| Live/export           | 16 viewers, 256 messages/1MiB each; 2 search/2 export readers; 120s download idle, not total archive timeout          | `LIMITS`: `viewers`, `viewerMessages`, `viewerBytes`, `searchReaders`, `exportReaders`, `downloadIdleMs`     |
| Storage               | 10GiB checkout quota; 512MiB reserved per episode; 256MiB free-space floor; no TTL cleanup                            | `LIMITS`: `checkoutQuotaBytes`, `episodeReservationBytes`, `freeSpaceFloorBytes`                             |
| Registry recovery     | 1024 namespace entries; 128 immutable attempts per lock incarnation; no evidence eviction                             | `src/service/coordination.ts`                                                                                |
| Unified workbench     | 128 associated projects; 1024 durable opening receipts; 64 connections; bounded proxy frames and bodies; no eviction  | `src/service/gateway.ts`, `src/service/gateway-store.ts`                                                     |
| Assets                | 16MiB per member/64MiB closure; fixed complete manifest and all font bodies                                           | `src/service-assets.ts`                                                                                      |
