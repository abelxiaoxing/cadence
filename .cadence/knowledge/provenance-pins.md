# Provenance pins and generated outputs

## Pins and build identity

### webui-reuse.json pins service sources and generated outputs, not only web files

Kind: contract

Why: editing a pinned body such as `src/service/conversation-records.ts` or `src/model-preview.mjs` requires refreshing its SHA-256 in `destinations`, independently of package membership.
The top-level `sources` map holds the original upstream pi-web-ui hashes, checked for 64-hex shape only; provenance refreshes touch `destinations`, whose entries the test hashes against the on-disk files.
`package-members.json` lists bodies shipped as themselves: bundled sources such as `src/service/gateway.ts` need no member entry; their generated executables do.

Anchors: `provenance/webui-reuse.json#destinations`, `test/service-package.test.ts#reuse provenance pins every current adaptation and integration body`, `provenance/package-members.json#service-host.mjs`

Source: this delivery, 2026-11-17

### Service contract sources feed the web build identity

Kind: pitfall

Why: `contractIdentity` hashes shared protocol inputs, including `src/worker-public.mjs`, client/wire modules and every file under `src/service/contracts`, so even a DTO-only change alters the browser manifest's `contractHash` without a Web source edit.
Use the canonical Node `build:web` builder; the exact input list and resulting staleness are owned by the build scripts, not inferred from the changed directory.

Anchors: `scripts/build-identity.mjs#contractIdentity`, `scripts/build-web.mjs#web-build-stale`, `web/dist/manifest.json#contractHash`

Source: this delivery, 2026-11-17
