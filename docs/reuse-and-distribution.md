# Reuse and Distribution

## Emitted licenses

`licenses/bundled-web.txt` contains full original notices with stable labeled boundaries: React/DOM/scheduler; react-icons and the selected Feather family; unified/Markdown/HTML utilities; highlight.js; KaTeX code; vis-timeline and the versions actually embedded by its standalone build.
KaTeX's 60 emitted TTF/WOFF/WOFF2 fonts retain their original bytes and separate SIL OFL1.1 plus reserved-family copyright notices.
The vis bundle includes its own Babel/core-js/moment/vis-data/vis-util and other dependencies; project-resolved package versions are not substituted for those embedded versions.
Both offered license texts are retained where supplied; extra notices do not imply extra runtime dependencies.

Repository `provenance/bundled-notices.json` binds rendered module bodies, exact source artifacts, per-module output chunks, font bodies and exact notice byte ranges/digests.
Provisioned official notice bodies were reused locally; builds never download licenses or dependencies.
`build:web:check` checks the actual rendered module set against that reviewed policy as well as deterministic output bytes and local asset references.

## Runtime/package closure

Only the native extension's explicit import closure, maintained SDK worker/shared JS capture modules, generated management/host/operator executables, Agents, independent skills/configuration, documentation, notices and complete built assets ship.
Service/worker execution uses ordinary Node with exact production `undici` and `ws` and the Pi SDK (`pi-coding-agent`, `pi-ai`) from the exact optional dependency versions in `package.json`, because Pi's installer omits peers; no source-tree or TypeScript fallback, SDK bundle or consumer compilation.
Pi's package installer omits peers and aliases only its own packages and Typebox, so every other runtime import reachable from `src/index.ts` must be a production dependency; otherwise Pi fails to load the extension at startup.
The retired shell-local controller is not a shipped competing executor.

`provenance/package-members.json` is a reviewed source/import/asset policy, not generated from the archive being tested.
The real pack audit rejects missing/extra/duplicate/linked/special/unsafe members, altered bodies, pin/notice/font drift and linked extraction roots/ancestors.
The pack gate also parses each shipped module and rejects a relative runtime import the archive does not contain, so a module left out of `files` cannot reach an installed Pi.
Extracted tests use tar-only package bodies and explicitly linked existing fixture peers; they never fill missing package files from source.
No version bump, dependency install or publication is implied by this redesign.

## Folder-first browser entry

The browser opens directly on conversations, with folder selection and recent folders in the lower-right statusbar, not a separate workbench/project home.
First use asks for a folder in that same interface; later visits restore the last available selection, while complete conversation links keep their own destination.
`web/src/Workbench.tsx` composes directory routing and the shared conversation shell without importing the upstream session/execution service.
The Cadence-owned gateway uses the existing authentication, public codecs, private-files discipline and independently coordinated project owners.
Initial folder setup never initializes an SDK session, manufactures a checkout, creates `~/cadence`, or repairs a missing project directory.
A technical service-process cwd is not a model/tool workspace.
The built same-origin routing covers both HTTP requests and WebSockets, while browser authority and project consent remain distinct from native management capability.
New Linux manager tests exercise the no-workspace default; macOS/Windows generated-definition tests are not native-platform execution qualification.

## Maintainer releases from any computer

`.github/workflows/publish.yml` publishes through GitHub Actions and npm Trusted Publishing (OIDC).
Only tag pushes trigger this workflow; there is no branch, pull-request, GitHub Release or manual-dispatch trigger.
Creating and pushing a stable `vMAJOR.MINOR.PATCH` tag is an explicit publication action; a local tag alone does nothing.
The workflow is repository-owned, not tied to the developer's computer or Pi session.
An agent can perform the release steps after an explicit user release request, using authorized GitHub access; it needs no npm token.
The workflow does not install Cadence globally, restart a service, deploy an application or create a GitHub Release.

### One-time setup

1. Review, commit and push the workflow and its helper/tests to `abelxiaoxing/cadence` on `main` before creating a release tag.
2. In GitHub repository **Settings → Environments**, create `npm-release` and restrict deployment to selected tags matching `v*`.
   For deliberately unattended publishing, this dedicated environment must not require approval on every run; review existing organization/environment policies rather than silently removing protections.
   Protect `main` and workflow changes, and use repository rulesets to restrict release-tag creation to trusted maintainers and prevent tag updates/deletion.
   A maintainer allowed to change the publishing workflow or create an eligible release tag is being entrusted with npm publication.
3. In the npm package **Settings → Trusted publishing**, add a GitHub Actions publisher with these exact values:

   | Field             | Value                                                         |
   | ----------------- | ------------------------------------------------------------- |
   | Organization/user | `abelxiaoxing`                                                |
   | Repository        | `cadence`                                                     |
   | Workflow filename | `publish.yml` (not its full path)                             |
   | Environment       | `npm-release`                                                 |
   | Allowed actions   | Enable direct **`npm publish`**, not only `npm stage publish` |

   Complete the maintainer authentication requested by npm for this one-time trust configuration.
   Existing trust connections must be reviewed; do not revoke another publisher incidentally.
4. No `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is required.
   Account 2FA can remain enabled, including npm's **Require two-factor authentication and disallow tokens** setting: it restricts traditional tokens, not this OIDC publisher.
   Stage-only permission still requires a human to approve each version and is not the unattended route.
   After a successful migration, separately review whether old automation tokens are still needed; this workflow never revokes them.

This lane requires GitHub-hosted runners; npm does not currently support self-hosted runners for this trust flow.
See npm's [Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers) for current platform and permission requirements.
The workflow pins its runtimes and third-party actions; review pin updates together with the normal verification gate.

### Release a new version

From a clean `main` checkout on any authorized computer:

1. Explicitly choose an unused stable version newer than npm's current `latest`; update `package.json` and regenerate operator/service/Web outputs through the canonical builders.
   Configure the external private disk-backed temporary directory required by the repository's verification instructions.
2. Run `bun run verify`, review the candidate, and make the explicitly authorized release commit.
   There is no additional slow/browser/paid-model/service-manager release gate.
3. Push that commit to `main`, then create and push its matching annotated tag:

   ```sh
   git push origin main
   version=$(node -p "require('./package.json').version")
   git tag -a "v$version" -m "Release $version" HEAD
   git push origin "refs/tags/v$version"
   ```

   These commands publish the selected version; do not use the current already-published version as a test.
   Do not force-move or delete a release tag to repair a failed release.
4. Follow **Actions → Publish npm**.
   A successful dispatch or artifact upload is not proof of npm publication.
   The final step verifies registry version/integrity, the `latest` tag and the actual downloaded tarball bytes.

The tag must name the checked-out event commit, match `package.json`, and already belong to `main`.
Pre-release/build-metadata tags, forks, moved/deleted tags, dirty checkouts, existing versions and versions behind the observed `latest` are refused.
This stable-release lane owns registry, access and dist-tag options; `package.json` must not add a competing `publishConfig`.

The preparation job has no OIDC permission.
It installs the frozen lockfile on its disposable runner, runs the sole gate, and audits a separate real Bun tarball.
A fresh publish job installs no project dependencies and builds nothing.
It downloads the immutable artifact by ID, checks its SHA-256 and every body against the clean tagged source, then calls `npm publish` once with lifecycle scripts disabled.
Only that job receives the OIDC permission.
No profile, private-state directory or local credential file is copied into either job.

Releases are serialized without cancelling an in-progress publish.
GitHub can replace a pending run when another is queued, so push one release tag at a time and inspect each run's outcome.
There is no automatic retry of `npm publish`, version bump, unpublish, dist-tag repair or staged-package approval.
After a failed or interrupted publish, inspect npm before retrying: the registry may have accepted the request despite a lost client reply.
Confirmation makes bounded readonly observations for propagation and does not convert a failed publish command into a successful command receipt.
The live-ref/latest checks are not a transaction with other maintainers; an external publication can still race and must be investigated rather than overwritten.

### Delayed or unconfirmed publication

npm can accept `npm publish` and then process the package asynchronously before its version, `latest` and tarball become publicly visible.
The confirmation helper uses one monotonic observation deadline for metadata requests, body reads and polling delays; its total window, interval and unchanged per-request ceiling live beside the constants in `scripts/npm-release.mjs`.
Candidate-version or tarball 404s and a lagging `latest` are retried with readonly requests only.
Digest, identity, tarball URL, streamed-byte mismatches and a newer `latest` refuse immediately; other HTTP, transport and malformed-response failures are not treated as propagation.
Each request is limited by the remaining total time, aborted on expiry and awaited through settlement; successful or failed reads dispose their timers.

The confirmation step records the original publish-step outcome separately in its failure log and job summary.
A successful publish followed by an observation timeout means **publication is still unconfirmed**, not that the publish command failed or the version is safe to reuse.
Keep that run's original audited artifact and digest, then independently recheck registry metadata, `latest` and downloaded bytes against that same artifact.
Do not rerun the publish job or workflow, replay `npm publish`, move/delete its tag, or repair registry state automatically.
A later matching readonly observation can confirm publication, but does not rewrite the earlier run's failed outcome; confirmation also cannot turn an originally failed publish command into a successful receipt.
