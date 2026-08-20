# AGENTS.md

<!-- ABEL:AGENTS-INDEX:START -->
## Project index

- `openspec/` contains the target root's OpenSpec core.
- `openspec/config.yaml` selects the spec-driven schema.
- The root is the standalone `@abelxiaoxing/cadence` package: manifest `package.json`, lockfile `bun.lock`, private extension `src/index.ts`, and immutable professional Agents under `agents/`.
- Prompt entrypoints: `prompts/abel-init.md`, `prompts/abel-design.md`, `prompts/abel-implement.md`, and `prompts/abel-diagnose.md`.
- Shared workflow: `skills/abel-workflow/SKILL.md` is authoritative for Gates, receipts/hashes, traceability, Red-Green-Refactor, AGENTS maintenance, and parent/worker boundaries.
- Configuration and HTTP boundary: `skills/_shared/load-config.mjs`, `skills/_shared/http-client.mjs`, and `config/.env.example`.
- Research skills: `skills/context7-auto-research/` and `skills/grok-search/`; commit skill: `skills/git-commit/`.
- Child execution: `src/child-session.ts` owns isolated in-memory sessions and separate stable-task/phase-request submission identity while forwarding tool/Scheduler cancellation across session creation, prompt, and disposal; `src/scoped-tools.ts` confines read/grep/find/ls to declared read/write paths within approved roots; `src/empty-resource-loader.ts` supplies no discovered resources; `src/parent-payload-bridge.ts` owns generation/model-bound parent callback capture, unwrapped delegation, FIFO composition, lifecycle invalidation, and final Responses normalization; `src/parent-provider.ts` owns abortable phase-local fresh auth and capture-required Provider composition with retries disabled; `src/worker.ts` owns the process-local stable-task-keyed Worker registry, phase-local contract/correction state, and shared two-launch cap.
- Scheduling: `src/scheduler.ts` owns bounded FIFO DAG-ready admission, declared conflict/resource/verification-lock serialization, and per-batch/all-batch cancellation with settlement. `src/runtime.ts` routes runs and cancel/drain through that scheduler, binds each Pi tool signal only to its run batch, enforces the shared transport/artifact two-launch cap, returns typed sanitized recovery, requires complete safe phase snapshots before dispatch, merges write-target snapshots, and serializes parent applies through a process-local FIFO; `src/file-snapshot.ts` owns bound/currentness helpers. `src/drain.ts` owns the unified idempotent state cleanup (admission closed, results and Worker registry erased, only dispatcher activation removed); lifecycle state stays in memory only.
- TUI presentation: `src/subagent-activity.ts` owns the process-local interactive Subagent activity controller, width-safe inline/widget rendering, compact terminal metadata, and the non-TUI boundary; active display/timer state is never persisted.
- Structural delivery: `src/submit-tool.ts` accepts one final result; `src/result-store.ts` retains diffs, typed verification/baseline contracts, and snapshots only in memory; `src/candidate-preflight.ts` owns parent-only strict/current isolated candidate verification with private bundle-based sibling reconstruction, Bubblewrap execution, and deterministic cleanup; `src/patch.ts` serializes that preflight before exact ordinary Git application and defensively reuses candidate admission; child code never imports either parent boundary; `src/contracts.ts` owns strict envelopes and complete ordinary textual unified-diff admission (full hunk consumption, final-LF and regular-file mode rules, copy/rename/binary/tail rejection).
- Standalone commands: `bun run check`, `bun run lint`, `bun run test`, `bun run test:target <files>`, `bun run check:agents`, `bun run pack:check`, `bun run traceability:check`, `bun run verify` (check && lint && test && pack:check), and fresh-process seed acceptance `bun scripts/seed-acceptance.mjs`.
  Distribution: `provenance/adapted-modules.yaml` pins package-shipped Agent identity; `scripts/pack-check.mjs` verifies the real tarball member set and `scripts/traceability-check.mjs` verifies the 81 unique Requirement/Scenario entries resolve exactly once.
- The relocated reference repository is read-only implementation, attribution, license, and provenance evidence; no standalone command or package resolution traverses it.
- Run OpenSpec commands from this target root.
- Target test: `bun run test -- test/distribution.test.mjs`.
- Real pack route: from this package directory, run `bun pm pack --destination <tmp>`.
- Distribution suite: `bun run verify` (check && lint && test && pack:check); traceability: `bun run traceability:check`.
<!-- ABEL:AGENTS-INDEX:END -->
