# Provenance pins and generated outputs

## Pins and build identity

### webui-reuse.json pins service sources and generated outputs, not only web files

Kind: contract

Why: editing a pinned body such as `src/service/gateway.ts` or `src/model-preview.mjs` without refreshing its SHA-256 in the `destinations` map fails the reuse provenance test, and this file is a separate pin store from `package-members.json`.

Anchors: `provenance/webui-reuse.json#destinations`, `test/service-package.test.ts#reuse provenance pins every current adaptation and integration body`

Source: this delivery, 2026-11-16

### Service contract sources feed the web build identity

Kind: pitfall

Why: `contractIdentity` hashes `src/worker-public.mjs`, `src/service-contract.ts`, the client and wire modules and `src/service/contracts/*`, so editing any of them changes the `contractHash` in `web/dist/manifest.json` and `build:web:check` fails with `web-build-stale` until the web build is regenerated from Node.

Anchors: `scripts/build-identity.mjs#contractIdentity`, `web/dist/manifest.json#contractHash`

Source: this delivery, 2026-11-16

### Bundled service sources need no package-members entry

Kind: contract

Why: `package-members.json` lists the files that ship as themselves; `src/service/http.ts`, `gateway.ts`, `auth.ts` and `auth-page.ts` exist only inside the generated `service-host.mjs` and `service-cli.mjs`, which are the listed members.

Anchors: `provenance/package-members.json#service-host.mjs`

Source: this delivery, 2026-11-16
