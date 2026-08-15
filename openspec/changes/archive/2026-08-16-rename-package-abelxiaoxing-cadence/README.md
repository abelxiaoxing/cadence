# rename-package-abelxiaoxing-cadence

Rename the published package identity to @abelxiaoxing/cadence and record the approved publication contract.

## Why

The package was provisionally named `@abel/pi-abel-workflow` with an explicit no-publication scope. The owner has approved publishing to the npm registry, pi packages, and GitHub under the unified identity `@abelxiaoxing/cadence`. This change records the new identity and updates the delivery contract wording from "no publication" to "published".

## What

- Package identity `@abel/pi-abel-workflow` becomes `@abelxiaoxing/cadence` everywhere in product surfaces: manifest, AGENTS index, README, configuration paths (`.pi/cadence/.env`), User-Agent, tests, and lockfile.
- The publication decision is recorded: the package is published from this repository to npm and pi packages as `@abelxiaoxing/cadence`; the GitHub repository is `abelxiaoxing/cadence`.
- The host-version non-policy, standalone-directory loading, installed-tarball loading, and reference-repository non-dependency contracts are unchanged.

## Non-goals

- No version-support matrix, no supported-version claims, no auto-publish tooling, no CI release pipeline in this change.
