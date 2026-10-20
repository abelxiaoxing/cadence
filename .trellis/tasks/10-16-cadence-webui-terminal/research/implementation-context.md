# Bounded Implementation Context

## Authority and Complete Source Access

This concise source/design index replaces oversized research bodies in injected manifests so no important tail is silently truncated.
It is not a reduced product scope.
Read the parent `prd.md`, `design.md`, **both mandatory `design-runtime-history.md` and `design-clients-distribution.md` appendices**, and `implement.md` completely.
Read the original topic reports below on demand with offset/limit until complete; they remain preserved research evidence, not competing specifications.

The selected design supersedes older recommendations for a dashboard, staged MVP, helper-only reuse, independent credential profile, forced SDK upgrade, signed-session framework, OS-home registry, legacy-task copying and ring-only history.
One integrated complete delivery and substantial source adaptation are mandatory.

## Current Cadence Boundaries

- Native shell owns current raw latch/confirmation/foreground cancellation (`src/task-shell.ts:20-61,81-133,354-432`); new client preserves fresh native entry but moves ownership to service and departure to detach.
- Current controller is one selected task/active operation (`src/task-controller.ts:32-83,190-245,293-369`); do not instantiate several competing controllers as a scheduler.
- Canonical root and v1 lock are in `src/task-store.ts:114-139,193-214,266-399`.
  Nested Git roots have different hashes: registry overlap-check/reservation must atomically reject all ancestor/descendant execution-root overlaps, not only non-Git roots.
- V1 record decoder/directory shape is strict (`src/task-types.ts:166-182`, `src/task-store.ts:324-350`).
  New rich history stays outside task directories; v1 result/baseline16KiB and plan32KiB are labeled summary bounds, not history truncation.
- Native close/required stdin/protocol/cancel and SDK versus ordinary-check environment distinctions live in `src/subagent-process.ts:107-253,448-537`.
  Current child only emits readiness/tool name/final (`src/sdk-worker.mjs:315-402`); frontend reuse cannot supply missing backend capture.
- Check obligations/freshness/human review live in `src/task-controller.ts:145-173,247-290,375-401`; worker prose and tool exit-like text are never check PASS.

Full reports: `cadence-runtime-web-seams.md`, `multi-subagent-scheduling-events.md`, `design-execution-history.md`.

## Public SDK Facts to Preserve

Inspected local coding-agent/agent-core/pi-ai are0.84.3; global docs are1.2.0.
Do not guess APIs from a newer example or import private SDK implementation files.

- Public ModelRuntime.create accepts authPath/modelsPath/modelsStore/allowModelNetwork/refreshOnCreate; getModel/getError/getAuth are declared in local coding-agent `dist/core/model-runtime.d.ts:3-24,53-79`.
  It has no public dispose or agentDir option.
- Use getAuth(model, overrides), not provider-ID-only resolution when configured model headers matter.
  Existing Pi auth/models reuse and SDK OAuth writeback are approved; no second profile/login is required.
- Public auth refresh uses CredentialStore.modify and writes rotated OAuth data (`pi-ai/dist/auth/resolve.js:64-110`).
  Commit secret-free preparation intent before getAuth and settlement after the original tracked promise; caller cancellation does not justify replay or assume no credential effects.
- Local AuthStorage read with an explicit signal propagates errors where signal-less paths may fall back to cached state; constructor/config prevalidation remains necessary.
  This is implementation evidence, not permission to deep-import AuthStorage.
- Public Agent.subscribe listeners are awaited and toolExecution is exposed (`pi-agent-core/dist/agent.d.ts:57-72`), unlike synchronous AgentSession callbacks.
  However synchronous tool updates and provider event queues can run ahead: reserve Cadence ingress budgets before await/copy, avoid awaiting your own abort settlement, and do not claim total upstream memory bounds.
- createLocalBashOperations and ToolDefinition are public root exports.
  Supplying custom operations to stock createBashToolDefinition still uses OutputAccumulator and raw spill.
  Implement the narrow custom ToolDefinition with Cadence's bounded redacted accumulator instead.
- Actual tool lifecycle has toolCallId/name/args/update/result/isError; allocate local message/call occurrence IDs where no stable public ID exists.
  Tool start can precede validation; it is not native command-launch evidence.

Full reports: `independent-service-auth-lifecycle.md`, `pi-web-ui-model-auth-reference.md`, `design-service-contract.md`, `design-execution-history.md`, `planning-architecture-review.md`.
Official docs are under `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs`; follow relevant links and read complete Markdown when investigating new Pi APIs.
Do not read actual user credentials or execute SDK/provider construction merely to inspect an API.

## Reference Source and Substantial Reuse

Reference root `/home/mirako/abel/pi-web-ui`, clean inspected SHA `e8bab487af208bc9a1ab60a821652323f598127f`, MIT copyright2026 xing-shuyin.
Preserve source/destination provenance and actual dependency/vendor/font notices; the root MIT license does not cover all bundled material by itself.

- Workspace: `web/src/App.tsx`, `components/LeftPanel.tsx`, `RightPanel.tsx`, associated layout/CSS and responsive drawers.
- Tree/plan: `web/src/conv-groups.ts`, nested LeftPanel rows, `components/PlanBoard.tsx`.
- Transcript/tools: complete MessageList/Message/LazyMount/ToolCallBlock/StreamMarkdown families plus helpers/tests, not just styling.
- Rich content/review: Markdown/math/code helpers, FilePreview and SCM change/diff presentation; remove editor/script/Git mutation authority.
- History: GlobalSearchModal/SearchBar/session-url and readonly reader/search formatting; adapt to durable cursor/coverage/stable-record APIs.
- Timeline: whole `plugins/run-trace/client/entry.mjs` through a narrow read bridge plus audited vis vendor assets; no plugin manager/CDN/clear-history or inferred token-speed timestamps.
- Reconciliation: use-chat revision/resync/stale-socket/final-update machinery and message-delta; no per-tab SDK owner, generic appSend or reconnect mutation replay.
- Authentication: `server/index.ts:289-393,1064-1081`, `server/auth-cookie.ts`, `web/src/auth-token.ts`.
  Adapt simple token/cookie/upgrade patterns, remove optional-remote-auth, token localStorage/repeated query and Host bypass; no account framework.

Reference history row/switch_session can instantiate runtimes, repair files and resume work; never reuse those side effects for passive history.
Reference serialization/preview/search have lossy bounds; reuse their UI, not those bounds as the durable archive.
Reference full task/run/check/history export is an integration gap to implement in this delivery, not defer or replace with a screenshot.

Full reports: `pi-web-ui-reuse.md`, `complete-workspace-reuse.md`, `pi-web-ui-access-token.md`, `design-ui-distribution.md`.

## Build and Dependency Pin Inventory

The inspected upstream lock supplies candidate exact versions, not evidence of downloaded/license-audited/runnable artifacts:

- React/DOM19.3.0; react-icons5.7.0; matching React type packages19.3.0.
- react-markdown10.1.0; remark-gfm4.0.1/breaks4.0.0/math6.0.0; rehype-highlight7.0.2/katex7.0.1/raw7.0.0/sanitize6.0.0; highlight.js11.12.0; katex0.18.7.
- Direct imported type edges: unified11.0.5, remark-parse11.0.0, micromark-util-types2.0.2, mdast-util-from-markdown2.0.3, mdast-util-math3.0.0.
- vis-timeline8.5.4 and its actual bundled notices; no CDN fallback.
- Sole new production dependency ws8.21.3; dev @types/ws8.18.1.
- Vite8.3.0/plugin-react6.1.1; playwright-core1.63.0 with explicitly available isolated browser, no auto-download.

Retain current Pi development pins/public peers initially, no duplicate bundled SDK/global search/private subpath.
Service builds to `src/service-cli.mjs` so worker/Agent URLs resolve package-locally; browser assets use audited fixed names under `web/dist`.
All generated outputs must rebuild byte-for-byte in private temp; real tar extraction must run without source/TS fallback.
Full dependency/notice/version table and tests: `design-ui-distribution.md` sections4–8, subject to the selected authoritative appendix and actual artifact verification.

## Review Corrections and Evidence

Apply the parent's resolved all-root registry overlap, pre-await ingress, bounded exact dependency handoff, blocked-episode termination/new-Start, durable auth uncertainty, v1 summary mapping and export-revocation contracts.
W1 owns the joint W2/W3 producer-sink/coverage freeze and shared contract tests; reciprocal agreement is not a circular completed-implementation dependency.

All research is inspected source/planning evidence.
No mocks, citation validation, old suite count or planning validation substitutes for native process/SDK/browser/terminal/package acceptance.
The parent evidence-lane table separates required integrated execution from additional physical/platform/provider qualification without claiming them passed.
