# Provenance pins and generated outputs

## Pins and build identity

### Refresh destination hashes, not upstream pins or package membership, for a content-only edit

Kind: contract

Why: The reuse test hashes local `destinations` (including service sources, tests and bundles) but checks only the shape of referenced upstream digests; the pack audit compares shipped paths separately.
`node scripts/sync-provenance.mjs` rewrites exactly those hashes in place and nothing else; adding or removing an entry (and `newIntegrationFiles`, package members) stays a hand edit.

Anchors: `test/service-package.test.ts#reuse provenance pins every current adaptation and integration body`, `provenance/webui-reuse.json#destinations`, `scripts/sync-provenance.mjs#refreshDestinations`, `scripts/pack-check.mjs#expectedMembers`

Source: this delivery, 2026-11-20

### The repository declares its own builds, and the pin refresher runs last

Kind: contract

Why: `.cadence/derived.json` lists the operator, service and Web bundles as wholly derived `outputs` and the pin table as a file the last step only `refreshes`; an agreement that omits `build` is bound to it at publication.
A delivery therefore never merges bundle bytes or hash lines: bundles are rebuilt from merged sources, and the table's values are recomputed on all three sides before its entries are merged.
The refresher leaves the pin of an absent file as it is (exit 0), because it also runs on older versions of the table; a missing pinned file is the package test's failure.

Anchors: `.cadence/derived.json#build`, `scripts/sync-provenance.mjs#repositoryHash`, `src/service/workflow-derived.ts#readDerived`, `test/sync-provenance.test.mjs`

Source: this delivery, 2026-11-24

### A shared contract change affects both service and Web builds

Kind: pitfall

Why: A change to a DTO under `src/service/contracts`, the worker protocol, or the shared client/wire transport outside that directory changes `contractIdentity`, which feeds the owner bundle, the native client's generated identity and the browser manifest.

Anchors: `scripts/build-identity.mjs#contractIdentity`, `scripts/build-service.mjs#nativeIdentity`, `scripts/build-identity.mjs#browserIdentity`, `web/dist/manifest.json#contractHash`

Source: this delivery, 2026-11-20
