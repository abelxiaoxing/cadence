# Provenance pins and generated outputs

## Pins and build identity

### Refresh destination hashes, not upstream pins or package membership, for a content-only edit

Kind: contract

Why: The reuse test hashes local `destinations` (including service sources, tests and bundles) but checks only the shape of referenced upstream digests; the pack audit compares shipped paths separately.

Anchors: `test/service-package.test.ts#reuse provenance pins every current adaptation and integration body`, `provenance/webui-reuse.json#destinations`, `scripts/pack-check.mjs#expectedMembers`

Source: this delivery, 2026-11-20

### A shared contract change affects both service and Web builds

Kind: pitfall

Why: A change to a DTO under `src/service/contracts`, the worker protocol, or the shared client/wire transport outside that directory changes `contractIdentity`, which feeds the owner bundle, the native client's generated identity and the browser manifest.

Anchors: `scripts/build-identity.mjs#contractIdentity`, `scripts/build-service.mjs#nativeIdentity`, `scripts/build-identity.mjs#browserIdentity`, `web/dist/manifest.json#contractHash`

Source: this delivery, 2026-11-20
