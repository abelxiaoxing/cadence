## Why

The Abel four-stage workflow currently depends on machine-local prompt and context configuration, so it cannot be installed, validated, or maintained as an independent Pi package.
The first phase establishes a prompts-first distribution boundary before any integration with the `pi-subagents` runtime.

## What Changes

- Add the independently maintained `@abel/pi-abel-workflow` package under `packages/pi-abel-workflow/` for Pi 0.84.1 or newer.
- Preserve `/abel-init`, `/abel-design`, `/abel-implement`, and `/abel-diagnose` as the four user-facing entry points, with string `argument-hint` values and complete argument delivery through `$ARGUMENTS`.
- Make the package self-contained enough to execute the core workflow without a machine-global `AGENTS.md`, while centralizing shared rules in its bundled `abel-workflow` skill.
- Bundle the `context7-auto-research`, `grok-search`, and `git-commit` skills and their required distributable resources without credentials, virtual environments, backups, or runtime state.
- Treat `dev-browser` as an external prerequisite only for an approved browser E2E verification contract, and remove the dedicated `time` skill from the workflow.
- Keep `/abel-init` responsible for loading the core workflow skill, reporting bundled research-skill discovery, installing a missing OpenSpec CLI globally with the selected Bun-or-npm toolchain, and then validating its required capabilities; missing research skills do not prevent OpenSpec or AGENTS repair but leave the environment not fully ready.
- Support independent npm installation at user and project scope plus local-package validation; do not promise an independent git installation from the monorepo.
- Register the package in the monorepo settings, README, release-please configuration, manifest, workspace lockfile when needed, and AGENTS indexes.
- Add executable coverage for prompt argument expansion, frontmatter, package resource discovery, and npm tarball contents.
- Resolve the Implement contract conflict by making each task's exact affected-suite commands a dynamic scope boundary: every reproducible pre-existing failure they expose is included for root-cause verification and minimum repair, including failures outside the original module, while affected-suite completion remains all-green.
- Record later integration phases without implementing runtime agent registration, professional agent Markdown, orchestration, deterministic receipt tooling, or a meta package in this change.

## Capabilities

### New Capabilities

- `abel-workflow-prompt-package`: Defines the installable Pi prompt and skill resources, four-stage workflow behavior, compatibility and installation contract, external prerequisite handling, and distribution safety requirements.

### Modified Capabilities

None.

## Impact

- Adds `packages/pi-abel-workflow/` and its prompt, skill, documentation, test, and development-index resources.
- Updates the monorepo's local Pi package registration, package catalog documentation, release-please component configuration, release manifest, root package index, and lockfile only when dependency resolution requires it.
- Does not modify `packages/pi-subagents`, AbelWorkflow, permission packages, runtime agent APIs, UI, schedulers, or worktree behavior.
- Changes the shared Implement and verification contract plus its executable static coverage; it does not retroactively rerun completed tasks.
- Does not publish to npm and does not persist user, session, approval, credential, or scheduling state.
