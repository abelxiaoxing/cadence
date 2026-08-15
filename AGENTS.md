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
- Child execution: `src/child-session.ts` owns isolated in-memory sessions, `src/empty-resource-loader.ts` supplies no discovered resources, and `src/parent-provider.ts` owns phase-local parent Provider/auth bridging with retries disabled. `src/worker.ts` owns the process-local logical Worker registry: pinned identity, non-snapshot contract, fresh phase auth, and exactly one mechanical redispatch before blocking.
- Scheduling: `src/scheduler.ts` owns bounded FIFO DAG-ready admission, declared conflict/resource/verification-lock serialization, cancellation, and one optional mechanical redispatch. `src/runtime.ts` binds request snapshots as safe bounds, merges write-target snapshots, and serializes parent applies through a process-local FIFO with recovery; `src/file-snapshot.ts` owns bound/currentness helpers. `src/drain.ts` owns the unified idempotent drain (admission closed, results and Worker registry erased, only dispatcher activation removed); lifecycle state stays in memory only.
- Structural delivery: `src/submit-tool.ts` accepts one final result; `src/result-store.ts` retains diffs only in memory; `src/patch.ts` owns parent-only snapshot checks and exact ordinary Git patch application; child code never imports the patch module. `src/contracts.ts` is the strict envelope and ordinary textual patch-header screening route (unified header pairs, regular-file mode rules, copy/rename/binary rejection).
- Standalone commands: `bun run check`, `bun run lint`, `bun run test`, `bun run test:target <files>`, `bun run check:agents`, `bun run pack:check`, `bun run traceability:check`, `bun run verify` (check && lint && test && pack:check), and fresh-process seed acceptance `bun scripts/seed-acceptance.mjs`.
  Distribution: `provenance/adapted-modules.yaml` pins package-shipped Agent identity; `scripts/pack-check.mjs` verifies the real tarball member set and `scripts/traceability-check.mjs` verifies the 81 unique Requirement/Scenario entries resolve exactly once.
- The relocated reference repository is read-only implementation, attribution, license, and provenance evidence; no standalone command or package resolution traverses it.
- Run OpenSpec commands from this target root.
- Target test: `bun run test -- test/distribution.test.mjs`.
- Real pack route: from this package directory, run `bun pm pack --destination <tmp>`.
- Distribution suite: `bun run verify` (check && lint && test && pack:check); traceability: `bun run traceability:check`.
<!-- ABEL:AGENTS-INDEX:END -->
