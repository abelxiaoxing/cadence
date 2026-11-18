# Project knowledge

Where things are decided.
Keep it short.

## Routes

- `src/service/http.ts`, `src/service/gateway.ts`, `src/service/auth.ts`, `src/service/auth-form.ts`, `src/service/auth-page.ts` -> `docs/remote-access.md#Explicit Personal HTTPS Access` — unauthenticated entry, the script-free 401 password page, POST /auth one-year cookie, Origin and next sanitization
- `test/service-auth.test.ts`, `test/gateway-login.test.ts` -> `engineering/verification.md#Regression owners` — fast auth and login regressions for the owner and gateway entries
- `src/worker-public.mjs`, `src/worker-public.d.mts` -> `engineering/limits.md` — shared LIMITS constants including the one-year cookie lifetime
- `web/dist`, `src/service-host.mjs`, `src/service-cli.mjs`, `src/model-preview.mjs` -> `engineering/verification.md#Builds and packaging` — canonical builders only; web/dist staleness against service contract sources
- `provenance/webui-reuse.json`, `provenance/package-members.json` -> `.cadence/knowledge/provenance-pins.md` — which provenance file pins which bodies, and when a member entry is needed
- `test/research-tools.test.mjs`, `test/service-autostart.test.ts` -> `.cadence/knowledge/controlled-fixtures.md` — long-TMPDIR socket binding and the injected CLI manager/cgroup boundary
- `src/worker-capture.mjs`, `src/service/conversations.ts`, `src/service/conversation-records.ts`, `src/service/pi-sessions.ts`, `src/service/contracts/workbench.ts` -> `engineering/history.md#Ordinary conversation records` — capture/Pi ownership and handoff, body-free thinking, content versions and read-time activity redaction
- `src/service/turn-capture.ts`, `src/service/workflow-report.ts` -> `engineering/history.md#Conversation workflow records` — tool snapshot publication to retained reads and explicit call state, independent of parent settlement
- `web/src/client/conversation-reader.ts`, `web/src/components/workspace`, `web/src/components/StreamMarkdown.tsx`, `web/src/rich/stream-markdown.ts`, `web/src/transcript` -> `engineering/clients.md#Streaming timelines` — render versus read identity, semantic Markdown, lazy details, resize/follow wiring and separate runtime observations
- `test/helpers/runtime-timeline.ts`, `test/runtime-timeline.test.ts`, `test/workflow-runtime.test.ts`, `test/web/chat-timeline.test.tsx`, `test/web/stream-markdown.test.tsx`, `test/web/runtime-observation.test.tsx` -> `engineering/verification.md#Regression owners` — contract-connected backend/Web fixtures, actual view wiring and SSR/browser evidence boundaries
- `web/src/reference.css`, `web/src/styles.css`, `web/src/timeline/timeline.css`, `web/src/timeline/timeline-client.mjs`, `test/web/theme.test.tsx` -> `.cadence/knowledge/web-theme-tokens.md` — glass tiers, theme-test token scope and the same-tool-same-colour timeline palette
- `provenance/webui-reuse.json` -> `docs/reuse-and-distribution.md#Emitted licenses` — pi-web-ui adaptation scope and preserved upstream MIT/source pins
