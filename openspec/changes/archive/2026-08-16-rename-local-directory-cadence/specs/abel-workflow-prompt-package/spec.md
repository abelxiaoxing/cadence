## MODIFIED Requirements

### Requirement: Standalone repository extraction

The current target root SHALL become the standalone single-package source repository for `@abelxiaoxing/cadence` and SHALL NOT require a nested workspace or reference-monorepo directory for development, validation, packing, installation, or runtime use.
Before orchestration product implementation begins, the standalone package baseline SHALL be extracted and the complete reference `pi-packages` repository SHALL be relocated to `/home/abelxiaoxing/work/subagent/pi-packages` with its Git metadata, local commits, modified files, untracked files, and untracked workflow-package copy preserved.
The relocation MUST NOT delete, clean, overwrite, or normalize reference-repository content.
After relocation, implementation MAY inspect that repository as read-only implementation, attribution, license, or provenance evidence, but standalone source, imports, dependencies, tests, commands, symbolic links, packing, installation, and runtime resolution MUST NOT depend on either its old or relocated path.

#### Scenario: Reference repository state is preserved

- **WHEN** the standalone layout is established and the reference repository is relocated
- **THEN** the destination retains the complete pre-migration Git history, local commits, dirty files, and untracked files without cleanup or normalization

#### Scenario: Standalone root replaces nested workspace

- **WHEN** a maintainer inspects the standalone package directory after extraction
- **THEN** the root directly contains the single package source, tests, documentation, OpenSpec root, and AGENTS index without the nested reference workspace

#### Scenario: Reference evidence is consulted

- **WHEN** implementation needs to verify an adapted invariant, attribution, license, or provenance fact
- **THEN** it may read the relocated repository as evidence without modifying it or making a standalone product or validation path resolve through it

#### Scenario: Reference repository is unavailable to the product

- **WHEN** the relocated reference repository is absent while the standalone package is checked, tested, packed, installed, or loaded
- **THEN** every standalone command and supported package capability continues without resolving that repository
