# Coordinator and Clients

## Dual-Surface Coordination

### Unified coordinator memory with static-first layout

Native `/cadence` and browser conversations share one unified working memory built by `buildCoordinatorContext` under the 32 KiB `COORDINATOR_CONTEXT_BYTES` budget: static instructions and the project-knowledge summary come first for prompt-cache stability, followed by dynamic active-workflow state, current-plan binding and recent investigation citations.
When a plan is already current or `proposal: false` is passed, `cadence_status` stays lightweight without re-emitting stale proposals; `cadence_status({ proposal: true })` surfaces the active delivery proposal cleanly.

Anchors: `src/coordinator-context.ts#buildCoordinatorContext`, `src/coordinator-context.ts#COORDINATOR_CONTEXT_BYTES`

### Raw-terminal native consent vs browser approval binding

Native `/cadence` retains raw-terminal guards so approval requires direct local terminal input, never a piped or automated stream.
Browser access authentication is never action consent: browser execution requires an exact-plan, conversation-bound and attachment-bound approval (`ApprovalScope`) rather than a native capability.
Owner-held conversation mode survives browser refresh; the bounded SDK coordinator cannot edit files or approve its own plan, and releases the checkout gate while waiting for subagents.

Anchors: `src/cadence-mode.ts#registerCadenceMode`, `src/service/conversation-workflow.ts#BROWSER_COORDINATOR_INSTRUCTIONS`, `web/src/components/workspace/WorkflowPanel.tsx#ApprovalScope`

## Browser Shell and Streaming

### Folder-first directory switching and pinned Send

The browser presents one folder-first conversation shell with lower-right directory switching and inline first-use setup rather than a separate workbench home.
Switching directories never sends a draft or alters admitted work; ordinary Send or explicit plan revalidation prepares and associates independent project owners behind one authenticated origin within `SEND_PREPARATION_MS`.
Each admitted run pins its conversation `cwd`, model preferences and `CURRENT_WORKFLOW_PLAN_VERSION` so later navigation detaches without cancelling active work.

Anchors: `web/src/components/workspace/ChatWorkspace.tsx#CURRENT_WORKFLOW_PLAN_VERSION`, `web/src/client/conversation-send.ts#SEND_PREPARATION_MS`

### Streaming renderId vs readId and semantic Markdown

Streaming ordinary conversations decouple stable rendering identity (`renderId`) from backend capture/Pi correlation (`readId`) so turns do not remount or jump when capture hands off to the settled Pi session JSONL.
`segmentStream` splits streaming Markdown with the real syntax parser so container blocks, code fences and reference links keep stable keys and exact source slices across streaming and settlement.
Scroll behavior follows explicit user intent rather than yanking readers back to the bottom.

Anchors: `web/src/rich/stream-markdown.ts#segmentStream`, `web/src/client/conversation-reader.ts`, `test/web/chat-timeline.test.tsx`

## Activity and Agent Panel

### Background agent panel and Activity discovery

The native agent panel and browser Activity surfaces observe live and settled background work (`WORKFLOW_KINDS`) through service snapshots and `agent_settled` events rather than polling local files.
`ActivityDiscovery` aggregates workflow runs, research workers and recent recoveries across associated owners without starting dormant services during passive browsing.
Legacy task execution buttons remain retired; historical check and human-review evidence renders strictly readonly.

Anchors: `src/agent-panel-cadence.ts#WORKFLOW_KINDS`, `src/activity.ts#agent_settled`, `src/service/activity-discovery.ts#ActivityDiscovery`
