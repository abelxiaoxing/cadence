## Cadence

`@abelxiaoxing/cadence` is a dual-surface task workspace: native `/cadence` and built WebUI share one persistent service.
Ordinary engineering and resource discovery never activate execution or start a service.
Only explicit `cadence server install` registers and starts the generated boot service (Linux system/root unit without linger or explicit legacy user unit, LaunchAgent on macOS, Run entry on Windows); no package install hook does, `server restart|stop|uninstall|upgrade` go through orderly Stop, and disable/mask/disable-linger are respected.
Server commands that would stop the service they run in refuse inside it; the WebUI restarts or upgrades its Linux service only after a confirmation naming the work it stops, through a transient unit outside the service.
Native and browser `/cadence [goal]` enable a persistent conversation mode until explicit exit; completion never disables it. Native entry/current user Send may start or reuse a local project owner without installing a boot service.
Code workflows require a readable plan and fresh context-bound execution consent, then service-owned host-tool edits, real checks and automatic Agent review (never labelled human review). Approved local delivery may include isolated parallel Git worktrees, bounded repairs, local task commits and fast-forward integration; no implicit push, deployment or source/profile copying. Legacy task execution controls are retired; existing check/human Review evidence remains readonly.
Native entry retains raw-terminal guards; browser access authentication is not action consent. Browser execution uses an exact-plan, conversation/attachment-bound approval, never a native capability. Owner-held conversation mode survives refresh; the bounded SDK coordinator cannot edit or approve itself and does not hold the checkout gate while waiting for subagents.
Client departure detaches, never cancels admitted work; explicit Cancel/Stop preserve actual closure, and an owner that cannot settle its work restarts itself after stopping its own workers.
No terminal embedded executor, automatic replay or profile copying is allowed.
Startup self-heals what a provably dead Cadence process left behind (an earlier boot, an absent or reused PID, then its leftover workers stopped by exact identity) and records what it did; a live, unresponsive, foreign-host or unidentifiable holder is never reclaimed without one explicit confirmation (`cadence doctor --fix`).
This is not a sandbox, certified executor or transactional application system.
Research/diagnosis are readonly; ordinary conversations are the project's Pi sessions, shared with the terminal (Pi writes them; Cadence reads, continues and branches them, never rewrites or imports them), and use direct host tools only on explicit Send, under the shared checkout gate.
Human-readable legacy summaries live under `.cadence/assistant/tasks`; new workflow notes use `.cadence/assistant/workflows` and managed project context uses `.cadence/project.md`; private history and coordination use `cadence-assistant-v1` outside the working copy.
The unified workbench has no project cwd and never creates a default workspace; private-state ancestors are refused as project roots, never redirected.
Explicit Open associates independent project owners behind one authenticated origin and follows an associated project's restarted owner; navigation detaches, while whole-workbench Stop joins its associated exact-epoch owners.
Consumer data must never be imported, reset or cleaned incidentally; damaged or half-written private state is archived (expiring after 30 days), never silently deleted, before a clean start.
`cadence project open` explicitly starts or reuses a directory owner on its own selected port, never a task; named Linux services keep projects independent, and root operation never copies another account's credentials or adopts its state.

## Development

Cadence is currently in internal development. Prioritize clean, readable code, clear module boundaries and straightforward designs that remain easy to extend and maintain; avoid unnecessary abstractions and speculative complexity.
Prefer simplifying or replacing outdated designs within the affected scope over layering workarounds onto them. Do not retain obsolete APIs, compatibility shims, deprecated paths or duplicate implementations solely for historical compatibility unless an explicit requirement or a documented contract requires them.
When replacing an implementation, remove superseded code within the affected scope and update its callers, tests and documentation together rather than leaving transitional scaffolding behind; preserve required behavior and regression coverage.
These principles do not relax the data-preservation, security, consent or lifecycle contracts above, and do not authorize unrelated rewrites or cleanup.

`engineering/` holds project architecture, executable contracts, limits, regression lessons and verification guidance, one file per area; `README.md` stays a short user guide.
Before changing a boundary, read the area file the project index names and the affected source/tests; read `engineering/verification.md` before integrating.
Keep each fact in one place: limits beside their constants, operations in `docs/`, and new release evidence appended to `engineering/releases.md`, which is not required reading.
Handle ordinary engineering directly; no task-management framework, task creation, archive ceremony or workflow-specific agent is required.
Keep research and commit skills independent; Git commits, pushes, installation, publication and deployment require their applicable explicit authorization.
Preserve unrelated working-tree changes and actual native/auth/storage outcomes.
Use the installed public Pi declarations rather than assuming global documentation matches the peer.

## Verification

- Use directly affected tests while developing; run full `verify` at a stable integration boundary.
- `CADENCE_BROWSER_PATH=<existing-browser> bun run verify` includes root/web checks, generated bytes, lint, Agent pins, native/unit/web/browser tests and real pack audit.
- Run `bun pm pack --destination <private-temp>` for a separate real-pack route.
- Point `TMPDIR`, `TEMP` and `TMP` at one fresh 0700 directory on the checkout's disk filesystem, never a nearly full tmpfs `/tmp`: owners refuse below their free-space floor and `web/dist` publication renames across it.
- `verify` needs a Node with TypeScript type stripping (a distro Node built without it fails `build:web:check`), and an existing Chromium.
- Do not download a browser/dependency automatically, refill extracted package bodies from source, enlarge existing test budgets or claim unexecuted environments passed.
- See `docs/service-management.md`, `docs/remote-access.md` and `docs/reuse-and-distribution.md` for operations and distribution.

<!-- ABEL:AGENTS-INDEX:START -->
## Project index

- `package.json` defines the standalone package; `README.md` is the user guide.
- `src/index.ts` is the sole Pi extension entrypoint; `src/service/` owns the shared execution service.
- `src/history/` owns durable recording and retained readers; `web/src/` owns the browser client.
- `agents/`, `skills/` and `config/` contain the shipped independent profiles, skills and examples.
- `engineering/architecture.md`: module ownership, maintained seams, packaging and shipped content.
- `engineering/lifetimes.md`: admission, scheduling, Stop, registry and automatic recovery.
- `engineering/checks-review.md`: checks, change observation, task publication and Review.
- `engineering/history.md`: capture, redaction and retained history readers.
- `engineering/clients.md`: the native client, the agent panel, the WebUI and ordinary conversations.
- `engineering/limits.md`: resource ceilings and their owning constants.
- `engineering/verification.md`: commands, development practice, regression owners and lessons.
- `engineering/releases.md`: append-only release evidence, not required reading.
<!-- ABEL:AGENTS-INDEX:END -->
