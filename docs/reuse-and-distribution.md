# Reuse and Distribution

## Source families

Cadence adapts `xing-shuyin/pi-web-ui@e8bab487af208bc9a1ab60a821652323f598127f`, MIT copyright 2026 xing-shuyin.
The full original license is `licenses/pi-web-ui-MIT.txt`.
Repository `provenance/webui-reuse.json` records source/destination hashes and explicit incompatible branches removed; `provenance/auth-reuse.json` records token/cookie adaptation.

| Source family                        | Package adaptation                                                       |
| ------------------------------------ | ------------------------------------------------------------------------ |
| App, panels, layout, drawers         | Three-pane task workspace and responsive phone navigation                |
| conv-groups, PlanBoard               | Task/run/child tree, editable finite graph and separate confirmations    |
| MessageList, Message, ToolCallBlock  | Paged transcript, stable tool associations and retained detail           |
| Markdown, StreamMarkdown, copy       | Sanitized Markdown/math/code, no script/external-image execution         |
| FilePreview, SCM presentation        | Readonly observed changes, no Git/file mutation API                      |
| GlobalSearchModal, search, deep link | Literal durable search, exact versioned hits and scoped export           |
| Standalone run-trace client          | Local vis timeline/filter/replay of observations, never execution        |
| use-chat, message-delta              | Shared typed reconciliation, gaps/resync and no mutation replay          |
| Token/cookie and upgrade guards      | Cookie-first authenticated HTTP/WS, explicit Host/Origin/CSRF boundaries |

No upstream runtime, general chat server, PTY, plugin loader, browser shell, credentials editor, reconnect continuation or task repair ships.
Cadence's finite owner/admission/history contracts replace those incompatible seams.

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
