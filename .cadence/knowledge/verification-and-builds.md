# Verification and Builds

## Fast Gate and Temp Scope

### Sole verification gate and private disk TMPDIR

`bun run verify` is the sole integration and release gate; it runs typechecks, generated-byte checks, Biome/rumdl lint, Agent provenance pins, fast root and Web tests, and real npm-pack auditing concurrently (`Promise.all`).
Point `TMPDIR`, `TEMP` and `TMP` at one `0700` session directory under `${XDG_CACHE_HOME:-$HOME/.cache}/cadence/tmp/` on the checkout's disk filesystem — outside every Git working copy and never a small tmpfs `/tmp` (`assertVerificationTemp`).
In bash, assign `TMPDIR` on one line before `export TMPDIR TEMP="$TMPDIR" TMP="$TMPDIR"` so `$TMPDIR` expands after assignment.

Anchors: `scripts/verify.mjs#Promise.all`, `scripts/verification-temp.mjs#assertVerificationTemp`, `scripts/build-web.mjs#explicit-private-disk-temp-required`

### Node-only web builds vs Bun preload drift

`build:web` and `build:web:check` must execute under an official Node build that supports TypeScript type stripping, never under Bun's Vite runtime, because Bun preload alters emitted chunk bytes and breaks deterministic `web/dist` and `provenance/bundled-notices.json` verification.
Generated runtime executables (`src/service-host.mjs`, `src/service-cli.mjs`, `src/model-preview.mjs`) and `web/dist` must match their canonical builders byte-for-byte before integration.

Anchors: `scripts/build-web.mjs`, `package.json`

## Test Tagging and Fixtures

### Slow tag policy and no-fsync fast test harness

Tag a root test `// @module-tag slow` when it takes about 0.4 s or more (usually by spawning real owners, SDK workers, CLIs or crash children).
Default test commands and `bun run verify` exclude `slow` tests; run them only for targeted file-level diagnosis, never as an automatic follow-up to `verify`.
Fast root suites load `test/no-fsync.mjs` to avoid redundant disk sync latency without weakening contract assertions or enlarging test budgets.

Anchors: `test/no-fsync.mjs`, `test/service-package.test.ts`

### Fixture hygiene and optional optical probes

Subprocess tests must clear inherited `CADENCE_SUBAGENT_CHILD` when simulating top-level owners and honor system Git `safe.directory` configs rather than relying on checkout-local `.cache` paths.
Real systemd user-manager E2E (`test/service-maintenance-systemd.test.ts`) is opt-in via `CADENCE_SYSTEMD_E2E=1`.
Optional browser optical comparisons (`scripts/qualify-optical.mjs`) run manually against the same build when auditing WebUI typography or layout changes; browser automation is not part of `verify`.

Anchors: `scripts/qualify-optical.mjs`, `test/service-maintenance-systemd.test.ts`
