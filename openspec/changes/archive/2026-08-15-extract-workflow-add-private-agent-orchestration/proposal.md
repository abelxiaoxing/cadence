## Why

`@abel/pi-abel-workflow` currently lives as an untracked prompts-first package inside a modified reference monorepo and delegates to unspecified host-managed subagents. It needs to become a standalone Pi package whose bundled private, maintainable orchestration capability preserves the Abel workflow without depending on `@gotgenes/pi-subagents`, another `@gotgenes/*` package, or the reference repository.

## What Changes

- Establish the current root as the standalone single-package repository and relocate the complete reference `pi-packages` repository intact to `/home/abelxiaoxing/work/subagent/pi-packages` before product implementation, preserving its Git history, local commits, dirty files, and untracked files.
- Permit the relocated reference repository to be consulted only as read-only implementation, attribution, license, and provenance evidence; prohibit every product, package-resolution, runtime, test-import, command, symlink, packing, and installation dependency on either reference-repository path.
- Preserve the package name, four workflow commands, four bundled Skills, and research configuration paths while adding an automatically loaded private extension and four package-owned professional Agents for Abel Design, Implement, and Diagnose.
- Register one `abel_dispatch` tool but keep it inactive by default; activate it only for a verified eligible Abel stage and restore it to inactive when that stage finishes, is cancelled, is replaced, reloads, or shuts down.
- Keep delegated Agents read-only and require compact structured evidence or compact delivery metadata with a complete unified diff; keep Gate decisions, result review, patch application, command execution, validation, AGENTS updates, and task completion exclusively with the parent Agent.
- Allow bounded parallel evidence and task work only when dependencies, declared read/write sets, conflicts, and resource locks permit it. Bind each result to hashes of the files it actually read or proposes to write so unrelated sibling changes do not make it stale.
- Disable Provider retries and private cooldowns (`maxRetries: 0`). After a failed request, permit at most one mechanical redispatch with the identical request, scope, dependencies, and write set; otherwise block the affected branch while retaining independent accepted results.
- Keep the private registry, runs, queues, retained diffs, and Worker sessions in process memory only and release them on completion, failure, cancellation, stage finish, reload, or shutdown. Pi's ordinary host-owned parent transcript may retain results already returned to the parent.
- Validate local absolute and relative package directories, create and inspect a real tarball, install or unpack that tarball into an isolated directory, and load the installed package directory with Pi. Do not treat the tarball file itself as a directly loadable local Pi package.
- Perform no Pi host-version validation, rejection, warning, compatibility-matrix admission, or version support claim. Use the package-standard unconstrained Pi host peer declaration and treat the current development host only as reproducible test evidence.
- Limit the first implementation to a small private dispatcher, immutable Agent definitions, scoped read-only tools, structured submission, a simple ready-set/concurrency limiter, cancellation, file snapshots, in-memory retained results, and parent-side patch checking and application.
- Use one explicitly bounded seed wave to establish the standalone package and minimum runnable private Worker/application path; after that seed, use Worker-generated diffs for the remaining orchestration and workflow integration tasks.
- Exclude a general Subagent command or API, cross-extension service, Agent overrides, permission or approval system, UI, worktree/container isolation, private runtime persistence, custom transaction or rollback platform, multi-level budget platform, compatibility platform, npm publication, remote-repository creation, and automatic release configuration.

## Capabilities

### New Capabilities

- `private-agent-orchestration`: Package-owned professional Agent registration, bounded read-only execution, compact result delivery, file-related concurrency checks, cancellation, and lifecycle cleanup for the Abel workflow.

### Modified Capabilities

- `abel-workflow-prompt-package`: Change the prompts-first package into a standalone Prompt, Skill, and private-extension package while preserving its established workflow commands, configuration, Gate authority, and safety boundaries.

## Impact

- Repository layout and Git boundary at `/home/abelxiaoxing/work/pi-abelpackages`.
- One-time relocation of the intact reference repository to `/home/abelxiaoxing/work/subagent/pi-packages`, followed by standalone implementation with only explicit read-only evidence access to that repository.
- `@abel/pi-abel-workflow` manifest, distribution allowlist, prompts, shared workflow Skill, README, tests, and independent Bun toolchain configuration.
- A private extension, four package-owned Agent definitions, an in-memory execution kernel, result envelopes, cancellation, bounded concurrency, file snapshots, and parent-side patch application.
- Existing AGENTS routing claims that describe a nested workspace and a prompts-only package will require checkpointed updates during implementation.
- No runtime, development, test, packing, installation, or publication dependency on the reference repository or an `@gotgenes/*` package.
