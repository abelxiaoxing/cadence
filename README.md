# @abelxiaoxing/cadence

Prompts, skills, and a private orchestration extension exposing the Abel four-stage workflow:

- `/abel-init [project-path]` — initialize OpenSpec and repair AGENTS indexes.
- `/abel-design <requirement> | --change <change_name>` — parallelize read-only exploration and design a dependency/conflict-aware task DAG through Gate A and Gate B.
- `/abel-implement <change_name>` — orchestrate task-local professional Agents over the approved DAG with delegated Red-Green-Refactor and parent-owned verification.
- `/abel-diagnose <problem-description>` — verify a root cause before a minimal repair.

The package is standalone: one repository, one manifest, one lockfile, no workspace, no reference-monorepo checkout, and no dependency on an external Subagent package.
Loading the package registers a private extension and four package-owned professional Agents; the `abel_dispatch` tool is registered but inactive unless a verified Design, Implement, or Diagnose stage activates it.

The shared workflow rules live once in the bundled `abel-workflow` skill.

## Install

```sh
npm install -g @abelxiaoxing/cadence
# or with bun: bun add -g @abelxiaoxing/cadence
```

Loading paths, all verified:

- **npm package** — install `@abelxiaoxing/cadence` from the npm registry at user or project scope; Pi discovers the four prompts, four skills, the private extension, and the package-owned Agents.
- **Local package directory** — point Pi at this repository's absolute or relative path (for example `./pi-abelpackages`).
  Pi discovers the same resources.
- **Installed tarball directory** — run `bun pm pack --destination <tmp>` to produce a real tarball, install or unpack it into an isolated directory, and point Pi at that directory.
  The tarball file itself is never passed to Pi as a local package.

The package never inspects or classifies the Pi host version, never claims a version range, and never installs from the relocated reference repository source.

## Development

```sh
bun install
bun run check       # syntax + type checks
bun run lint        # biome + rumdl
bun run test        # complete suite
bun run test:target <files>   # targeted tests
bun run check:agents          # AGENTS index validation
```
