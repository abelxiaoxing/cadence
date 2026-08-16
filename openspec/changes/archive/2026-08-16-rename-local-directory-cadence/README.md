# rename-local-directory-cadence

Rename the local repository directory to `cadence` and remove hard-coded absolute paths from the main spec.

## Why

The product is published as `@abelxiaoxing/cadence` on npm, pi packages, and GitHub (`abelxiaoxing/cadence`). The local development directory is still `pi-abelpackages`, a historical name from the workspace era. Keeping the local directory consistent with the published identity avoids confusion and stale references.

## What

- The local repository directory is renamed to `cadence`.
- The main spec scenario "Standalone root replaces nested workspace" no longer hard-codes the absolute machine path; it refers to the standalone package directory instead.
- The README local-directory example uses `./cadence`.
