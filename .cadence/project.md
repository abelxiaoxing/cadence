# Project knowledge

Where things are decided.
Keep it short.

## Routes

- `src/service/http.ts`, `src/service/gateway.ts`, `src/service/auth.ts`, `src/service/auth-form.ts`, `src/service/auth-page.ts` -> `docs/remote-access.md#Explicit Personal HTTPS Access` — script-free 401, one-year login cookie, Origin and redirect guards
- `test/service-auth.test.ts`, `test/gateway-login.test.ts` -> `engineering/verification.md#Regression owners` — owner and gateway login regressions
- `src/worker-public.mjs`, `src/worker-public.d.mts` -> `engineering/limits.md` — shared limits and cookie lifetime
- `web/dist`, `src/native-build.ts`, `src/service-host.mjs`, `src/service-cli.mjs`, `src/model-preview.mjs` -> `engineering/verification.md#Builds and packaging` — canonical builders and byte checks
- `provenance/webui-reuse.json`, `provenance/package-members.json`, `scripts/build-identity.mjs` -> `.cadence/knowledge/provenance-pins.md` — content vs membership pins; shared build identity
- `test/research-tools.test.mjs`, `test/service-autostart.test.ts` -> `.cadence/knowledge/controlled-fixtures.md` — long socket paths; manager and cgroup fixtures
- `test/web/workspace-states.test.tsx` -> `.cadence/knowledge/web-test-fixtures.md` — a mocked model catalog's version must be UUID v4
- `src/service/checkout-gate.ts`, `src/service/workbench.ts` -> `engineering/lifetimes.md#Conversation workflow lifetime` — workflow permits vs ordinary Send concurrency
- `src/service/conversations.ts`, `test/conversation-input.test.ts`, `test/web/conversation-reader.test.tsx` -> `engineering/verification.md#Ordinary Send admission` — overlap, settlement, startup and draft outcomes
- `src/worker-capture.mjs`, `src/service/conversations.ts`, `src/service/conversation-records.ts`, `src/service/pi-sessions.ts`, `src/service/contracts/workbench.ts` -> `engineering/history.md#Ordinary conversation records` — capture/Pi handoff, thinking, versioning and read-time redaction
- `src/service/turn-capture.ts`, `src/service/workflow-report.ts` -> `engineering/history.md#Conversation workflow records` — retained snapshots and call state vs parent settlement
- `web/src/client/conversation-reader.ts`, `web/src/components/workspace`, `web/src/components/StreamMarkdown.tsx`, `web/src/rich/stream-markdown.ts`, `web/src/transcript` -> `engineering/clients.md#Streaming timelines` — render vs read identity, semantic Markdown, lazy details and scroll intent
- `test/helpers/runtime-timeline.ts`, `test/runtime-timeline.test.ts`, `test/workflow-runtime.test.ts`, `test/web/chat-timeline.test.tsx`, `test/web/stream-markdown.test.tsx`, `test/web/runtime-observation.test.tsx` -> `engineering/verification.md#Regression owners` — shared fixture contract, view wiring and SSR evidence limits
- `web/src/optical-tokens.css`, `web/src/reference.css`, `web/src/styles.css`, `web/src/components/workspace/design.css`, `web/src/timeline`, `test/web/theme.test.tsx` -> `.cadence/knowledge/web-theme-tokens.md` — source vs shipped CSS; timeline swatches
- `scripts/qualify-optical.mjs`, `scripts/optical-fixtures`, `scripts/quiet-workspace-observation.mjs`, `scripts/transcript-polish-observation.mjs` -> `engineering/verification.md#Optical presentation observation` — same-build probes, native geometry and glyph comparisons
- `web/src/components/workspace/WorkflowPanel.tsx`, `test/web/current-plan-entry.test.tsx`, `test/web/plan-proposal-presentation.test.tsx` -> `docs/conversation-mode.md#Restore a saved plan without sending a message` — plan disclosure vs validation and approval
- `web/src/components/workspace/CadenceModeButton.tsx`, `web/src/components/workspace/ChatWorkspace.tsx` -> `docs/conversation-mode.md` — one-click browser mode switch: bare /cadence enters, exit cadence leaves, draft unconsumed
- `provenance/webui-reuse.json` -> `docs/reuse-and-distribution.md#Emitted licenses` — pi-web-ui adaptation scope and MIT pins
