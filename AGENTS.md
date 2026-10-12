## Cadence

`@abelxiaoxing/cadence` is a Pi extension with one explicit terminal-only `/cadence` task workflow.
Ordinary engineering and resource discovery never activate it.
Code tasks require a readable plan and fresh native terminal Start consent, then direct host-tool edits, real parent checks and human review.
This is not a sandbox, certified executor or transactional application system.
Research/diagnosis are readonly; ordinary conversations remain independent.
New human-readable records live under `.cadence/assistant/tasks`; private diagnostics and coordination use `cadence-assistant-v1`.
Old history and uncertain resources are never imported, reset or cleaned.
The package ships three pinned professional Agents (`agents/`), independent research and commit skills (`skills/`), and optional check configuration (`config/`).

Project-specific development guidelines live in `.trellis/spec/`.
The backend layer covers `src/`, `scripts/`, record storage, foreground execution, checks and operator tooling.
The frontend layer is Presentation & Content: native TUI projection plus shipped Agents/skills/config.
This repository has no web frontend.

## Distribution routes

- Target test: `bun run test -- test/distribution.test.mjs`.
- Real pack route: from this package directory, run `bun pm pack --destination <tmp>`.
- Distribution suite: `bun run verify` (check && lint && test && pack:check).
- Traceability: `bun run traceability:check --map <repository-relative-map.json>`; valid references are not executed evidence.

<!-- ABEL:AGENTS-INDEX:START -->
## Project index

- `package.json` defines the standalone package; maintained safety contracts live in `.trellis/spec/`.
- `src/index.ts` is the sole Pi extension entrypoint; shipped skills, Agents and configuration are documented in `.trellis/spec/frontend/`.
- Backend implementation and distribution conventions live in `.trellis/spec/backend/`.
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
