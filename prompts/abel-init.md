---
description: Initialize or safely repair an Abel OpenSpec project
argument-hint: "[project-path]"
---

This procedure applies only when the user explicitly invokes `/abel-init`.
Reading this file, mentioning the command, or finding OpenSpec artifacts does not activate it.
Read the complete value inside `<abel-request>` without tokenizing it a second time.

<abel-request>
$ARGUMENTS
</abel-request>

<!-- ABEL:PROMPT:abel-init -->

The request is an optional project path; when absent, use the current working directory.
Resolve and report the canonical target root before action.

## Deterministic boundary

- Init performs no Subagent or `abel_dispatch` work.
  Probe and repair locally in a fixed order.
- Preserve the baseline dirty state, unrelated files, all human-authored AGENTS text, and every nested repository boundary.
- Never use `--force`, replace an existing OpenSpec tree wholesale, follow a symlink escape, or edit `openspec/AGENTS.md`.
- Choose Bun when usable, otherwise npm, and use only that toolchain for this run.
  If neither works, stop with the original probe errors and an executable remediation.

## Fixed procedure

1. Inspect the canonical root, repository boundaries, OpenSpec presence, project configuration, and root/nested AGENTS marker structure without writing.
2. Probe the required OpenSpec CLI capabilities, schema selection, schema validation, templates, status, instructions, and strict validation.
3. If OpenSpec is absent, install `@fission-ai/openspec@latest` globally with the selected toolchain (`bun add --global @fission-ai/openspec@latest` or `npm install --global @fission-ai/openspec@latest`), then repeat the complete capability probe.
   If installation or recheck fails, preserve the original error and stop with the exact remediation command.
4. Initialize only when no OpenSpec root exists.
   Otherwise repair only missing or mechanically invalid configuration that can be changed without discarding project choices.
5. Resolve and validate the selected schema and templates before claiming readiness.
6. Create or repair only verified `<!-- ABEL:AGENTS-INDEX:START -->` … `<!-- ABEL:AGENTS-INDEX:END -->` managed regions.
   Preserve every byte of human content outside those markers and do not cross nested repositories.
   Keep the index descriptive: file locations and ordinary project commands only; never instruct ordinary tasks to enter an Abel workflow.
   Never record runtime/session ids, credentials, approval state, or dirty-state ledgers.
7. Re-run all probes after writes.
   A second identical Init must produce no additional changes.

Discover the bundled `context7-auto-research` and `grok-search` Skills and report their resolved paths.
Their absence does not prevent OpenSpec or AGENTS repair, but final readiness is `partial` and must include an actionable package-resource restore command.
Do not probe `git-commit`, external `dev-browser`, or a dedicated time Skill; none is an Init prerequisite.

Report one final result with the root, selected toolchain, actions actually taken, OpenSpec capability/schema/template evidence, AGENTS files changed or unchanged, research-Skill paths or remediation, and `ready | partial | paused`.
Never report success from the initial probe when the post-write recheck did not pass.

Init ends with that report; later ordinary tasks use normal engineering behavior.
Never start another Abel stage, archive, publish, release, stage, or commit implicitly.
