# Regression Owners

## Core Workflow and Service Suites

### Workflow V5 planning, links, delivery and review

V5 two-stage planning, auto-discovered `node_modules` links, worktree isolation, parallel execution, evidence-led recovery, acceptance deviations and Stage 5 Agent review ledgers are owned by the workflow test suites.
Run directly affected files while iterating before `bun run verify`.

Anchors: `test/workflow-v5-planning.test.ts`, `test/workflow-links.test.ts`, `test/workflow-delivery-runtime.test.ts`, `test/workflow-review-ledger.test.ts`, `test/workflow-recovery-regressions.test.ts`, `test/task-worktree.test.ts`, `test/workflow-landing.test.ts`, `test/merge-queue-delivery.test.ts`, `test/workflow-contract.test.ts`, `test/workflow-controller.test.ts`

### Gateway, owner lifetimes, self-heal and maintenance

Multi-project gateway preparation, concurrent Send queueing, owner overlap protection, startup self-heal of provably dead holders, checkout, landing-queue and host-capacity ordering and OS service maintenance (`install`/`restart`/`stop`/`uninstall`/`upgrade`) are covered by the gateway, owner and maintenance suites.

Anchors: `test/gateway-prepare.test.ts`, `test/gateway-send.test.ts`, `test/gateway-availability.test.ts`, `test/service-owner.test.ts`, `test/self-heal.test.ts`, `test/checkout-gate.test.ts`, `test/merge-queue.test.ts`, `test/host-capacity.test.ts`, `test/service-maintenance.test.ts`

## Runtime, Client and Packaging Suites

### Coordinator, workers, capture and history

Dual-surface coordinator tools, native raw-terminal `/cadence` mode, browser plan revalidation, worker toolkit capabilities, live capture-to-Pi handoff, shared Pi session reading and workflow history projections are owned by the coordinator, worker and history suites.

Anchors: `test/workbench-cadence-control.test.ts`, `test/cadence-mode.test.ts`, `test/plan-revalidation.test.ts`, `test/worker-toolkit.test.mjs`, `test/worker-capture.test.ts`, `test/pi-sessions.test.ts`, `test/conversation-records.test.ts`, `test/runtime-timeline.test.ts`, `test/service-history-projection.test.ts`

### WebUI rendering, packaging and release audits

Browser workflow approvals, streaming Markdown/timeline SSR identity, plan restoration, theme token checks, real-tarball packaging closure, npm release metadata and standalone independence invariants are owned by the Web and packaging suites.

Anchors: `test/web/workflow.test.tsx`, `test/web/chat-timeline.test.tsx`, `test/web/current-plan-entry.test.tsx`, `test/web/stream-markdown.test.tsx`, `test/web/theme.test.tsx`, `test/service-package.test.ts`, `test/package-audit.test.mjs`, `test/npm-release.test.mjs`, `test/independence.test.ts`
