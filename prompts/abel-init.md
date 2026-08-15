---
description: Initialize OpenSpec and AGENTS indexes for an Abel workflow project
argument-hint: "[project-path]"
---

Load the bundled `abel-workflow` Skill before inspecting or modifying OpenSpec or AGENTS files.
If that core Skill is unavailable, stop before any write and report an executable package-resource restore or reinstall command.
Read the complete value inside `<abel-request>` without a second whitespace-tokenization pass.

<abel-request>
$ARGUMENTS
</abel-request>

The request is an optional project path; when absent, target the current working directory.
Resolve that root before action and preserve unrelated files, all human-authored AGENTS content, baseline dirty state, and nested repository boundaries.
Never overwrite or cross a nested repository boundary merely because it is below the selected root.

## Prerequisites

Select Bun when it is usable; otherwise select npm.
Use that single JavaScript toolchain for the whole run.
If neither is usable, stop with the original probe errors and executable remediation.

Discover the bundled `context7-auto-research` and `grok-search` Skills.
Record each resolved discovery path when present.
When either is missing, report an actionable package-resource restore or reinstall command, continue OpenSpec initialization and AGENTS repair, and mark the final environment as not fully ready.
A missing research Skill does not prevent OpenSpec initialization or AGENTS repair.
The absence of `git-commit`, external `dev-browser`, or a dedicated `time` Skill does not affect Init readiness; do not check them as Init prerequisites.

Probe OpenSpec and all CLI capabilities required by the shared workflow.
If OpenSpec is absent, install `@fission-ai/openspec@latest` globally with the selected toolchain (`bun add --global @fission-ai/openspec@latest` or `npm install --global @fission-ai/openspec@latest`), then recheck every required capability.
If installation or the recheck fails, stop, preserve the original error, and report the exact executable remediation command for the selected toolchain.

## Initialization

Initialize or safely update OpenSpec without `--force` or another destructive force option.
Resolve and validate the selected schema and its templates before reporting success.
Create or repair only the verified managed blocks of appropriate root and nested AGENTS indexes, preserving all human-authored text and unrelated content.
You must not edit `openspec/AGENTS.md`.

Report the resolved project root, selected toolchain, OpenSpec capability results, schema/template validation, AGENTS repairs, research-Skill discovery paths or remediation, and final readiness.
A missing research Skill makes the environment not fully ready even when OpenSpec and AGENTS repair completed.
