## Cadence

`@abelxiaoxing/cadence` is a Pi extension that provides four explicit Abel workflow stages: `/abel-init`, `/abel-design`, `/abel-implement`, and `/abel-diagnose`.
Ordinary engineering work never activates the workflow; only a user-issued idle raw slash invocation starts a stage.
Implement is durable and resumable across sessions and hosts: owner-private SQLite state, sealed deliveries, bounded recovery, and platform-specific verification isolation (Linux Bubblewrap, Windows x64 native Job).
The package ships three immutable professional Agents (`agents/`), research and commit skills (`skills/`), stage prompts (`prompts/`), and example configuration (`config/`) as pinned, compiler-checked content.

Project-specific development guidelines live in `.trellis/spec/`.
The `backend/` layer covers the package code: the `src/` modules, `scripts/`, owner-private storage, the workflow engine, delivery, verification, and operator tooling.
The `frontend/` layer is repurposed as "Presentation & Content": the TUI projection in `src/subagent-activity.ts` and `src/startup-card.ts`, plus the package-shipped `prompts/`, `skills/`, `agents/`, and `config/` content.
This repository has no web frontend.

## Distribution routes

- Target test: `bun run test -- test/distribution.test.mjs`.
- Real pack route: from this package directory, run `bun pm pack --destination <tmp>`.
- Distribution suite: `bun run verify` (check && lint && test && pack:check); traceability: `bun run traceability:check`.

<!-- ABEL:AGENTS-INDEX:START -->
## Project index

- `openspec/` and `package.json` define the target package and OpenSpec root.
- `src/index.ts` is the Pi extension entrypoint; package-shipped prompts, skills, Agents, and config are documented in `.trellis/spec/frontend/`.
- Backend implementation conventions live in `.trellis/spec/backend/`.
<!-- ABEL:AGENTS-INDEX:END -->

<!-- TRELLIS:START -->
# Trellis Instructions

These instructions are for AI assistants working in this project.

This project is managed by Trellis. The working knowledge you need lives under `.trellis/`:

- `.trellis/workflow.md` — development phases, when to create tasks, skill routing
- `.trellis/spec/` — package- and layer-scoped coding guidelines (read before writing code in a given layer)
- `.trellis/workspace/` — per-developer journals and session traces
- `.trellis/tasks/` — active and archived tasks (PRDs, research, jsonl context)

If a Trellis command is available on your platform (e.g. `/trellis:finish-work`, `/trellis:continue`), prefer it over manual steps. Not every platform exposes every command.

If you're using Codex or another agent-capable tool, additional project-scoped helpers may live in:
- `.agents/skills/` — reusable Trellis skills
- `.codex/agents/` — optional custom subagents

Managed by Trellis. Edits outside this block are preserved; edits inside may be overwritten by a future `trellis update`.

<!-- TRELLIS:END -->
