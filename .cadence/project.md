# Project knowledge

Where things are decided.
Keep it short.

## Routes

- `src/service/http.ts`, `src/service/gateway.ts`, `src/service/auth.ts`, `src/service/auth-page.ts` -> `docs/remote-access.md#Explicit Personal HTTPS Access` — unauthenticated entry, the script-free 401 password page, POST /auth one-year cookie, Origin and next sanitization
- `test/service-auth.test.ts`, `test/gateway-login.test.ts` -> `engineering/verification.md#Regression owners` — fast auth and login regressions for the owner and gateway entries
- `src/worker-public.mjs`, `src/worker-public.d.mts` -> `engineering/limits.md` — shared LIMITS constants including the one-year cookie lifetime
- `web/dist`, `src/service-host.mjs`, `src/service-cli.mjs`, `src/model-preview.mjs` -> `engineering/verification.md#Builds and packaging` — canonical builders only; web/dist staleness against service contract sources
- `provenance/webui-reuse.json`, `provenance/package-members.json` -> `.cadence/knowledge/provenance-pins.md` — which provenance file pins which bodies, and when a member entry is needed
- `test/research-tools.test.mjs`, `test/service-autostart.test.ts` -> `.cadence/knowledge/controlled-fixtures.md` — long-TMPDIR socket binding and the spawned CLI manager boundary
