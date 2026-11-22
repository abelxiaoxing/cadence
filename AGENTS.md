## Cadence

`@abelxiaoxing/cadence` is a dual-surface task workspace: native `/cadence` and built WebUI share one persistent service.
Ordinary engineering and resource discovery never activate execution or start a service.
Only explicit `cadence server install` registers and starts the generated boot service (Linux system/root unit without linger or explicit legacy user unit, LaunchAgent on macOS, Run entry on Windows); no package install hook does, `server restart|stop|uninstall|upgrade` go through orderly Stop, and disable/mask/disable-linger are respected.
Server commands that would stop the service they run in refuse inside it; the WebUI restarts or upgrades its Linux service only after a confirmation naming the work it stops, through a transient unit outside the service.
Native and browser `/cadence [goal]` enable a persistent conversation mode until explicit exit; completion never disables it. Native entry, current user Send or explicit browser plan revalidation may start or reuse a local project owner without installing a boot service; revalidation preserves the plan content and sends no message or execution approval.
A coordinator's own tool call is refused by naming the field at fault, and it corrects and repeats that call itself: there is one plan, never a reduced variant of it and never a request that the user reply to try again.
Code workflows require a readable delivery agreement and explicit user authorization, after which a readonly route planner splits parallel tasks from the codebase before service-owned host-tool edits, real checks and automatic Agent review (never labelled human review). Only approved local delivery creates a named task branch and one stable worktree, plus temporary worktrees for assignments that run side by side; mode entry and research create neither. Approved local delivery uses that stable candidate and finishes without further confirmation: evidence-led recovery, a route and write scope the owner may revise inside the repository, recorded deviations from the acceptance that the automatic review must confirm, verified project-knowledge updates, local commits and fast-forward integration; no implicit push, deployment or source/profile/credential copying (for `local-merge` without installs, omitted `links` auto-discover plain untracked Git-ignored `node_modules` at proposal time, bind them into the approval digest and card, and unlink only after identity verification). Legacy task execution controls are retired; existing check/human Review evidence remains readonly.
Honor authorization already given for the current task. Routine diagnosis, repairs, replanning and replacement isolated test runs within the authorized goal, acceptance, model, target and external-effect boundaries do not require the user to repeat that authorization. Bind each newly admitted execution to its current exact plan and authenticated context through the supported approval interface; never reuse a consumed grant, replay a command or revive a canceled or uncertain operation. Ask for new user confirmation only when the proposed action exceeds the existing authorization.
Native entry retains raw-terminal guards; browser access authentication is not action consent. Browser execution uses an exact-plan, conversation/attachment-bound approval, never a native capability. Owner-held conversation mode survives refresh; the bounded SDK coordinator cannot edit or approve itself and does not hold the checkout gate while waiting for subagents.
Conversation cwd and model preferences are independent; each admitted run pins its context. Checkout roots retain owner overlap protection and workflows retain their checkout gate and worktree/write-path checks.
Client departure detaches, never cancels admitted work; explicit Cancel/Stop preserve actual closure, and an owner that cannot settle its work restarts itself after stopping its own workers.
No terminal embedded executor, automatic execution replay or profile copying is allowed. Bounded SDK recovery may repeat only a failed model request inside its original worker lifetime, retaining completed tool results and cancellation authority; it never resends a user command or restarts a workflow step, except that a readonly research question whose worker failed is asked once more by a new worker.
Startup self-heals what a provably dead Cadence process left behind (an earlier boot, an absent or reused PID, then its leftover workers stopped by exact identity) and records what it did; a live, unresponsive, foreign-host or unidentifiable holder is never reclaimed without one explicit confirmation (`cadence doctor --fix`).
This is not a sandbox, certified executor or transactional application system.
Research/diagnosis are readonly; ordinary conversations are the project's Pi sessions, shared with the terminal (Pi writes them; Cadence reads, continues and branches them, never rewrites or imports them), and use direct host tools only on explicit Send. Ordinary turns in different Pi sessions do not acquire the workflow checkout gate: like separate Pi terminals they can edit the same file concurrently and overwrite one another.
Human-readable legacy summaries live under `.cadence/assistant/tasks`; legacy workflow notes under `.cadence/assistant/workflows` remain readable, while version-4 and version-5 workflow reports and review ledgers stay in private service storage under `cadence-assistant-v1` and managed project context uses `.cadence/project.md`.
The browser is folder-first: one conversation shell, lower-right directory switching and inline first-use setup, not a separate workbench/project home; directory selection never sends a draft or changes admitted work.
Private-state ancestors are refused as project roots, never redirected.
Directory selection is nonactivating; current user Send or explicit plan revalidation prepares and associates independent project owners behind one authenticated origin and follows an associated project's restarted owner; navigation detaches, while whole-workbench Stop joins its associated exact-epoch owners.
Consumer data must never be imported, reset or cleaned incidentally; damaged or half-written private state is archived (expiring after 30 days), never silently deleted, before a clean start.
`cadence project open` explicitly starts or reuses a directory owner on its own selected port, never a task; named Linux services keep projects independent, and root operation never copies another account's credentials or adopts its state.

## Development

Cadence is currently in internal development. Prioritize clean, readable code, clear module boundaries and straightforward designs that remain easy to extend and maintain; avoid unnecessary abstractions and speculative complexity.
Prefer simplifying or replacing outdated designs within the affected scope over layering workarounds onto them. Do not retain obsolete APIs, compatibility shims, deprecated paths or duplicate implementations solely for historical compatibility unless an explicit requirement or a documented contract requires them.
When replacing an implementation, remove superseded code within the affected scope and update its callers, tests and documentation together rather than leaving transitional scaffolding behind; preserve required behavior and regression coverage.
These principles do not relax the data-preservation, security, consent or lifecycle contracts above, and do not authorize unrelated rewrites or cleanup.

`.cadence/project.md` routes source paths to `.cadence/knowledge/*.md` (source-anchored architecture, contracts, limits, verification guidance and regression owners) and `docs/` (shipped user and operations manuals); `README.md` stays a short user guide.
Before changing a boundary, follow `.cadence/project.md` to the relevant `.cadence/knowledge/` card and the affected source/tests; read `.cadence/knowledge/verification-and-builds.md` before integrating.
Keep each fact in one place: limits beside their constants, operations in `docs/`, engineering invariants in `.cadence/knowledge/`, and release history in Git tags and GitHub releases.
Handle ordinary engineering directly; no task-management framework, task creation, archive ceremony or workflow-specific agent is required.
Keep research and commit skills independent; Git commits, pushes, installation, publication and deployment require their applicable explicit authorization.
Preserve unrelated working-tree changes and actual native/auth/storage outcomes.
Use the installed public Pi declarations rather than assuming global documentation matches the peer.

## npm publication

- Publish npm releases **only through GitHub Actions**: the existing `.github/workflows/publish.yml` (`Publish npm`) and its npm Trusted Publishing/OIDC job.
- Never run local `npm publish`, `bun publish`, a token-based fallback or another publication route; do not bypass CI when a release is delayed or fails.
- After explicit release authorization, follow `docs/reuse-and-distribution.md#maintainer-releases-from-any-computer`: verify the candidate, push the release commit to `main`, then push its matching annotated `vMAJOR.MINOR.PATCH` tag.
- Confirm the CI outcome and registry version, `latest` and audited artifact digests before claiming publication; if visibility is pending, use the documented readonly check, never replay publication or move the tag.

## Temporary-file hygiene

- Never scatter temporary directories, logs, reports, package archives or audit snapshots directly in `$HOME`, project parents, the desktop or arbitrary sibling directories.
- Ordinary engineering uses one fresh private scope under `${XDG_CACHE_HOME:-$HOME/.cache}/cadence/tmp/`; on Windows use `%LOCALAPPDATA%/cadence/tmp/`. Keep all scratch for the same engineering session inside that scope, including tests, builds and commit audits. A delivery worker instead uses its inherited owner-prepared `TMPDIR` and never creates or cleans the owner's scope.
- Validate the designated location against the verification rules below. If it is unsuitable, stop and name the problem; do not invent a fallback location or relocate consumer state.
- Prefer stdout/in-memory inspection. A normal Git audit needs no persistent diff/hash archive or new temporary directory.
- Before finishing, remove only this session's own temporary scope once every command and child has settled and its contents are no longer needed. Keep failed-attempt evidence while diagnosing, not forever after a successful resolution. If retention is necessary, keep it in the designated scope and report its exact path and reason.
- Never sweep shared temp/cache containers, other sessions, old directories or consumer data; uncertain/live work is retained. Pre-existing clutter requires a separate, explicitly scoped cleanup request. See `.cadence/knowledge/verification-and-builds.md` for the engineering recipe and the service's separate resource ownership.

## Verification

- Use directly affected fast tests while developing; `bun run verify` is the sole integration and release gate. Do not add a full-suite, browser or service-manager prerequisite to a commit, push or release.
- `verify` runs root/web checks, generated bytes, lint, Agent pins, fast root/Web tests and real pack audit concurrently. Browser automation and its runner are removed; Web unit/SSR tests and deterministic web build checks remain.
- Tag a root test `slow` when it takes about 0.4 s or more, usually by starting real owners, SDK workers, CLIs or crash children. Default test commands exclude it; retained slow tests are only for explicitly requested, file-targeted diagnosis, never an automatic follow-up to `verify`.
- Run `bun pm pack --destination <private-temp>` for a separate real-pack route.
- Point `TMPDIR`, `TEMP` and `TMP` at the single 0700 session scope from Temporary-file hygiene, **outside every Git working copy**, on the checkout's disk filesystem, never a nearly full tmpfs `/tmp`. Checkout-local `.cache` is not suitable: fixtures inherit its parent Git root and private-state paths are refused. Owners also enforce a free-space floor, and `web/dist` publication renames across the temp filesystem.
- `verify` needs a Node with TypeScript type stripping (a distro Node built without it fails `build:web:check`); no browser is required.
- Do not download a browser/dependency automatically, refill extracted package bodies from source, enlarge existing test budgets or claim unexecuted environments passed.
- See `docs/service-management.md`, `docs/remote-access.md` and `docs/reuse-and-distribution.md` for operations and distribution.

<!-- ABEL:AGENTS-INDEX:START -->
## Project index

- `package.json` defines the standalone package; `README.md` is the user guide.
- `src/index.ts` is the sole Pi extension entrypoint; `src/service/` owns the shared execution service.
- `src/history/` owns durable recording and retained readers; `web/src/` owns the browser client.
- `agents/`, `skills/` and `config/` contain the shipped independent profiles, skills and examples.
- `docs/` holds shipped user and operations manuals (`docs/conversation-mode.md`, `docs/service-management.md`, `docs/remote-access.md`, `docs/reuse-and-distribution.md`).
- `.cadence/project.md` routes code areas to source-anchored engineering cards under `.cadence/knowledge/`.
- `.cadence/knowledge/verification-and-builds.md` and `.cadence/knowledge/regression-owners.md` document the verification gate, temp hygiene and test ownership.
<!-- ABEL:AGENTS-INDEX:END -->
