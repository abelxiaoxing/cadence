# Resource Ceilings

## Agent Lifetime Policy

### No wall-clock Agent timeouts or repair-round quotas

Cadence enforces no wall-clock runtime deadline and no fixed repair-round cap on autonomous Agent work (`WORKER_POLICY`).
Workers stop only on completion, explicit user Cancel/Stop, unrecoverable external/process failure or owner shutdown.
All concrete numeric ceilings live directly beside their owning constants in `src/worker-public.mjs` (`LIMITS`) rather than duplicated in Markdown tables, so updating a constant never causes documentation drift.

Anchors: `src/worker-model.mjs#WORKER_POLICY`, `src/worker-public.mjs#LIMITS`, `test/agent-lifetime.test.mjs`

## Service and Workflow Bounds

### Workflow, coordinator and gateway ceilings

Workflow admission and execution bounds are centralized in `WORKFLOW_LIMITS` (task counts, write-scope entries, deviation notes, check output caps and worktree concurrency).
Coordinator working memory is capped at `COORDINATOR_CONTEXT_BYTES` (32 KiB) so static prefixes and dynamic state stay prompt-cache friendly.
Gateway directory preparation caps parallel owner startups via `MAX_CONCURRENT_PREPARATIONS` so bursts of concurrent browser Send/revalidation calls do not exhaust file descriptors or memory.

Anchors: `src/service/contracts/workflow.ts#WORKFLOW_LIMITS`, `src/coordinator-context.ts#COORDINATOR_CONTEXT_BYTES`, `src/service/gateway.ts#MAX_CONCURRENT_PREPARATIONS`

### Session walks, workflow results and storage floor

Shared Pi session scanning bounds file counts and byte walks via `USAGE_WALK`, and persisted workflow result projections enforce `WORKFLOW_RESULT_BYTES` so large command logs stay bounded in service storage and HTTP responses.
Before starting owners, preparing worktrees or packing artifacts, Cadence enforces the free-space floor and cookie/socket/buffer ceilings defined in `LIMITS`, failing explicitly rather than corrupting private state on a nearly full disk.

Anchors: `src/service/pi-sessions.ts#USAGE_WALK`, `src/service/workflow-result.ts#WORKFLOW_RESULT_BYTES`, `src/worker-public.mjs#LIMITS`
