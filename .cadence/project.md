# Project knowledge

Where things are decided.
Keep it short.

## Routes

- `src/index.ts`, `src/service/`, `package.json`, `agents/` -> `.cadence/knowledge/architecture-packaging.md` — module boundaries, SDK isolation, OIDC npm release and agent pins
- `src/service/workflows.ts`, `src/service/workflow-git.ts`, `src/service/workflow-links.ts` -> `.cadence/knowledge/workflow-v5-delivery.md` — V5 planning, auto-links and worktrees
- `src/service/workflow-landing.ts`, `src/service/workflow-derived.ts` -> `.cadence/knowledge/landing-and-conflicts.md` — replay, conflicts, landing, uncommitted changes
- `src/service/workflow-delivery.ts`, `src/service/workflow-review-ledger.ts`, `src/service/run-environment.ts` -> `.cadence/knowledge/checks-and-review.md` — Stage 4 checks, recovery, Agent review and scratch pools
- `src/service/gateway.ts`, `src/service/checkout-gate.ts`, `src/service/merge-queue.ts`, `src/service/host-capacity.ts`, `src/service/self-heal.ts` -> `.cadence/knowledge/lifetimes-and-recovery.md` — preparation, checkout, landing order, host load, Stop and self-heal
- `src/worker-toolkit.mjs`, `src/worker-tools.mjs`, `src/research-tools.mjs`, `src/change-tools.mjs`, `src/sdk-worker.mjs` -> `.cadence/knowledge/worker-tools-and-sdk.md` — worker capabilities, frozen settings and cancel settlement
- `src/worker-capture.mjs`, `src/service/pi-sessions.ts`, `src/service/conversation-records.ts`, `src/service/workflow-report.ts` -> `.cadence/knowledge/history-and-redaction.md` — Pi session sharing, live capture handoff and redaction
- `src/coordinator-context.ts`, `src/cadence-mode.ts`, `src/native-command-input.ts`, `web/src/components/workspace`, `web/src/rich/stream-markdown.ts` -> `.cadence/knowledge/coordinator-and-clients.md` — coordinator memory, approval binding and streaming timelines
- `src/service/knowledge-store.ts`, `src/service/project-knowledge.ts`, `src/service/investigations.ts` -> `.cadence/knowledge/project-knowledge-store.md` — store limits, reading budget, investigations and Stage 6 curation
- `src/worker-public.mjs`, `src/worker-model.mjs`, `src/service/contracts/workflow.ts` -> `.cadence/knowledge/resource-ceilings.md` — no Agent deadlines, workflow ceilings and storage floor
- `scripts/verify.mjs`, `scripts/build-web.mjs`, `scripts/qualify-optical.mjs`, `test/no-fsync.mjs` -> `.cadence/knowledge/verification-and-builds.md` — verify gate, disk TMPDIR, Node-only web builds and slow tags
- `test/workflow-v5-planning.test.ts`, `test/gateway-prepare.test.ts`, `test/web/chat-timeline.test.tsx`, `test/service-package.test.ts` -> `.cadence/knowledge/regression-owners.md` — targeted regression suites across workflow, gateway, Web and packaging
- `provenance/webui-reuse.json`, `provenance/package-members.json`, `scripts/sync-provenance.mjs`, `.cadence/derived.json` -> `.cadence/knowledge/provenance-pins.md` — content vs membership pins, declared builds
- `test/research-tools.test.mjs`, `test/service-autostart.test.ts` -> `.cadence/knowledge/controlled-fixtures.md` — long socket paths, manager and cgroup fixtures
- `test/web/workspace-states.test.tsx` -> `.cadence/knowledge/web-test-fixtures.md` — mocked model catalog versions must be UUID v4
- `web/src/optical-tokens.css`, `web/src/styles.css`, `web/src/timeline`, `test/web/theme.test.tsx` -> `.cadence/knowledge/web-theme-tokens.md` — source vs shipped CSS and timeline swatches
- `src/service/http.ts`, `src/service/auth.ts`, `src/service/auth-form.ts` -> `docs/remote-access.md#Explicit Personal HTTPS Access` — script-free 401, login cookie, Origin and redirect guards
- `web/src/components/workspace/WorkflowPanel.tsx`, `web/src/components/workspace/CadenceModeButton.tsx` -> `docs/conversation-mode.md#Restore a saved plan without sending a message` — deferred mode switch, plan disclosure and browser approval
- `provenance/bundled-notices.json`, `licenses/` -> `docs/reuse-and-distribution.md#Emitted licenses` — pi-web-ui adaptation scope, bundled notices and package closure
