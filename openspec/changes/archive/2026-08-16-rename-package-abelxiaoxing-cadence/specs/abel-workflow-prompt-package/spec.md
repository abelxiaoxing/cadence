## MODIFIED Requirements

### Requirement: Standalone installable workflow package

The system SHALL provide the standalone package as `@abelxiaoxing/cadence` and make it independently loadable from local absolute and relative package directories, from the published npm registry package, and from an isolated package directory produced by installing or unpacking its real tarball.
The supported user interface SHALL remain the four established workflow commands and four established skills while package loading additionally registers the private workflow orchestration extension and package-owned professional Agents.
The package SHALL NOT require users to copy Agent definitions into user or project Agent directories.
The package MUST NOT inspect the Pi host version, reject or warn based on it, maintain a host-version compatibility matrix, or claim a supported Pi version range.
The development host used by tests is reproducibility evidence only and is not a product compatibility contract.
The package SHALL be published to the npm registry and to pi packages under `@abelxiaoxing/cadence`; publication SHALL NOT promise installation from the relocated reference-monorepo Git source.

#### Scenario: Local package directory installation succeeds

- **WHEN** a user installs or loads the standalone package by an absolute or relative local package directory
- **THEN** Pi discovers the four workflow prompts, four bundled skills, private extension, and package-owned professional Agents without reference-monorepo configuration

#### Scenario: Future npm installation preserves resources

- **WHEN** the package has been published to the npm registry and a user installs `@abelxiaoxing/cadence` at user or project scope
- **THEN** Pi discovers the same prompts, skills, private extension, and professional Agents without requiring a second Agent installation

#### Scenario: Host version is not classified

- **WHEN** the extension loads on a Pi host
- **THEN** the package neither probes nor classifies the host version as supported, unsupported, verified, or unverified

#### Scenario: Publication limits are documented

- **WHEN** a user reads delivery guidance for this change
- **THEN** it distinguishes verified local-directory, installed-tarball-directory, and published npm-registry loading and does not promise installation from the relocated reference-monorepo Git source
