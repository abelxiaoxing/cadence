# Worker tools, settings and observation

## Tool composition and capability boundaries

### Worker toolkits compose Pi standard tools directly with exact active-name verification

Kind: contract

Why: `createWorkerToolkit` composes Pi's editing or readonly tools directly without a second schema or batch/cursor engine, adding `cadence_report` only for nonconversation editing, `changes` only for fixed-candidate review, and the private owner bridge only for coordinators. `sdk-worker.mjs` passes explicit allowlists (omitting them enables SDK defaults) and verifies active tool names match exactly before capture ingress.

Anchors: `src/worker-toolkit.mjs#createWorkerToolkit`, `src/sdk-worker.mjs`, `test/worker-toolkit.test.mjs`

Source: internalized from engineering/worker-tools.md, 2026-11-22

### Readonly search tools stay offline and bind relative operations to the first root

Kind: contract

Why: `createResearchTools` preserves Pi's `read`/`grep`/`find`/`ls` schemas and `.gitignore` behavior, binds relative paths to the first investigation root via `executionDirectory`, refuses known nonregular read targets (sockets, devices, pipes), and requires `PI_OFFLINE=1` so missing `rg`/`fd` binaries error without automatic downloads or shell fallback.

Anchors: `src/research-tools.mjs#createResearchTools`, `src/worker-workspace.mjs#executionDirectory`, `test/research-tools.test.mjs`, `test/research-tools-schema.test.mjs`

Source: internalized from engineering/worker-tools.md, 2026-11-22

### Fixed-revision review evidence streams Git under backpressure without arbitrary refs

Kind: contract

Why: `src/change-tools.mjs` (`changes`) accepts only owner-supplied immutable base/candidate OIDs, literal checkout-relative paths and one-use nullable cursors (`CHANGE_LIMITS`).
It streams Git with replacements, external diff, textconv and pagers disabled, joins actual child closure on cancel/disposal, and never labels binary, invalid UTF-8 or unavailable objects as complete empty results.

Anchors: `src/change-tools.mjs#CHANGE_LIMITS`, `src/git-environment.mjs`, `test/change-tools.test.mjs`

Source: internalized from engineering/worker-tools.md, 2026-11-22

## Admission snapshots and original-operation settlement

### Admitted workers freeze one inert Pi settings snapshot for their whole lifetime

Kind: contract

Why: Proposal/admission observes persisted Pi settings and project trust readonly via `SettingsManager.fromStorage` and projects them into an inert snapshot (`WORKER_POLICY` disables cache warming and provider-internal retries).
Later edits to `.pi/settings.json` invalidate pending proposals but never reconfigure admitted work, and child `SettingsManager.inMemory` never writes back to disk.

Anchors: `src/service/worker-settings.ts`, `src/worker-model.mjs#WORKER_POLICY`, `test/worker-settings.test.ts`

Source: internalized from engineering/worker-tools.md, 2026-11-22

### Standard file tools join actual async settlement on cancellation instead of early SDK abort

Kind: pitfall

Why: Installed SDK `read`, `find`, `ls`, `write` and `edit` tools can reject their abort observer before underlying I/O finishes, so the toolkit checks cancellation before admission, runs them without the early-reject signal, and reports cancellation only after actual settlement (explicitly allowing that an admitted write may have completed).
Pi's `grep`, shell and `changes` keep native child stop-and-join paths.

Anchors: `src/worker-toolkit.mjs#createWorkerToolkit`, `test/research-tools-settlement.test.mjs`, `test/research-tools-process.test.mjs`

Source: internalized from engineering/worker-tools.md, 2026-11-22
