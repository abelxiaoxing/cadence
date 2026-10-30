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
Service/worker execution uses ordinary Node with exact production `undici` and `ws` and the Pi SDK (`pi-coding-agent`, `pi-ai`) from exact 0.84.3 optional dependencies, because Pi's installer omits peers; no source-tree or TypeScript fallback, SDK bundle or consumer compilation.
Pi's package installer omits peers and aliases only its own packages and Typebox, so every other runtime import reachable from `src/index.ts` must be a production dependency; otherwise Pi fails to load the extension at startup.
The retired shell-local controller is not a shipped competing executor.

`provenance/package-members.json` is a reviewed source/import/asset policy, not generated from the archive being tested.
The real pack audit rejects missing/extra/duplicate/linked/special/unsafe members, altered bodies, pin/notice/font drift and linked extraction roots/ancestors.
Extracted tests use tar-only package bodies and explicitly linked existing fixture peers; they never fill missing package files from source.
No version bump, dependency install or publication is implied by this redesign.

## Unified entry without a default workspace

`web/src/Workbench.tsx` composes the project selector and existing project UI without importing the upstream session/execution service.
The Cadence-owned gateway uses the existing authentication, public codecs, private-files discipline and independently coordinated project owners.
The no-project entry never initializes an SDK session, manufactures a checkout, creates `~/cadence`, or repairs a missing project directory.
A technical service-process cwd is not a model/tool workspace.
The built same-origin routing covers both HTTP requests and WebSockets, while browser authority and project consent remain distinct from native management capability.
New Linux manager tests exercise the no-workspace default; macOS/Windows generated-definition tests are not native-platform execution qualification.
