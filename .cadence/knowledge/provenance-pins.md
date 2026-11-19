# Provenance pins and generated outputs

## Pins and build identity

### webui-reuse.json pins service sources and generated outputs, not only web files

Kind: contract

Why: `destinations` hashes local bytes (including bundled sources, tests and generated files), `sources` preserves the original upstream hashes (the provenance test checks their shape, not upstream bytes), and `package-members.json` lists shipped paths rather than everything that went into a bundle.

Anchors: `provenance/webui-reuse.json#destinations`, `test/service-package.test.ts#reuse provenance pins every current adaptation and integration body`, `provenance/package-members.json#service-host.mjs`

Source: this delivery, 2026-11-17

### A shared contract change affects both service and Web builds

Kind: pitfall

Why: `contractIdentity` hashes the worker protocol, client/wire modules and every file under `src/service/contracts`; even a DTO-only edit changes the hash that `build:service` embeds in the owner and `src/native-build.ts` and the Node `build:web` builder records in the browser manifest.

Anchors: `scripts/build-identity.mjs#contractIdentity`, `scripts/build-service.mjs#nativeIdentity`, `scripts/build-web.mjs#browserIdentity`, `web/dist/manifest.json#contractHash`

Source: this delivery, 2026-11-18
