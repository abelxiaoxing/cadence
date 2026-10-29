# Explicit service management

The native `/cadence` view and browser are clients of the same owner, started explicitly or by the [background service](#background-service).
Opening either view, extension discovery, login and package installation do not start it.
Use one coordination state-home for the checkout; a different state-home is not a recovery route.
Stop older Cadence sessions before starting the shared service.

```sh
cadence start --workspace /absolute/project
cadence status --workspace /absolute/project
cadence diagnose --workspace /absolute/project
cadence token-link --workspace /absolute/project --reveal
cadence token-rotate --workspace /absolute/project
cadence stop --workspace /absolute/project
```

`cadence-service` is the same command, and the equivalent package-relative command is `node <cadence>/src/service-cli.mjs ...`.
`--help` lists the finite interface.
`start` also accepts `--foreground`, `--config`, `--agent-dir`, `--host` (loopback only), `--port`, `--token-file`, `--server-config` ([port and token](#port-and-token)) and `--state-home`.
Defaults are loopback `127.0.0.1:17423`, normal Pi agent configuration, and detached service lifetime.
An explicit port0 selects and persists a positive port once; restart uses the selected configuration, not a fallback endpoint.
Missing/corrupt existing setup is preserved, not filled in or reset.
Commands without `--workspace` address the unified workbench, which has no execution cwd and never creates `~/cadence`.
Use `cadence workbench start|status|diagnose|stop|token-link|token-rotate` to name that target explicitly.
Its start accepts `--foreground`, `--state-home`, `--agent-dir`, `--server-config` and a private `--config` containing an `HttpPolicy` object (the schema used below for project HTTP policy).
The configuration's port/token come from the `.env`; a selected HTTP policy is retained across orderly restarts.
A project root containing the private state home is refused, with no alternate directory creation; native `/cadence` also requires a real project selection.
Existing `~/cadence` content is never removed, relocated or automatically adopted.
A directory inside `cadence-assistant-v1` is never an engineering workspace, even for root or `project open --create`.
Apart from the background service below, there is no supervisor installation, provider login or credential migration.

## Open a project directory

```sh
cadence project open /absolute/existing-project
cadence project open /absolute/new-project --create
# Optional explicit sources, without copying them:
cadence project open /srv/project --agent-dir /root/.pi/agent --state-home /root/.local/state
```

Without a path, `project open` uses the current directory; a missing directory refuses unless `--create` was supplied.
The project may be a Git checkout or an ordinary directory, including spaces and Unicode names; it need not be inside `~/cadence` or the package directory.
The command explicitly starts a detached owner, or observes the already running exact owner; it never creates a task, chooses a model, renews a grant or starts a worker.
New projects bind port0 and retain the resulting positive port, avoiding the default17423 collision; existing selections keep their exact port, cwd, agent sources and history.
The JSON result reports the canonical workspace, actual task cwd and endpoint; the private entry link is printed separately to stderr, like `server install`.
Keep that link private.
Open Pi in the same project and use `/cadence` for the native client; explicit `cadence stop --workspace <path>` stops only that project.
Opening another project never changes the cwd or cancels work in the former one.
The default workbench routes all associated projects through one origin, including a configured HTTPS proxy.
Its project picker browses directory names readonly; only **Open this project** starts or reuses an owner, without admitting a task or model call.
Project navigation remounts only the browser client; the original owner's work continues.
Browser proxy traffic keeps browser authority and the owner's own attachments, CSRF/build checks, grants and history proofs; native management routes and local-capability headers are not forwarded.
The gateway also refuses the legacy project-level Open command, so every opening is associated through the workbench instead of returning an independent backend token link.
The gateway's token, backend cookies and native capabilities are never returned in project DTOs or stored in browser localStorage.
Token rotation retires and detaches its exact browser attachments without cancelling admitted work.
The private account state stores bounded project references and opening receipts, not copied worktrees, Pi profiles or imported transcripts.
Private coordination/Pi credential directories and foreign-owned project selections are refused.
Direct project entry links remain available as a compatibility route; that route alone still uses separate loopback project entries.
Git subdirectories and aliases resolve to the same checkout, while overlapping parent/child owners still refuse.
An unknown, quarantined or inaccessible selection is never treated as a new project or recovered by choosing another state home.

When run as root, Git observation requires a repository Git recognizes as root-owned: Cadence clears `safe.directory` exceptions per command, removes inherited `SUDO_UID` and disables fsmonitor.
A foreign-owned repository refuses even if a global `safe.directory=*` would allow it; selecting a path is not consent to execute its configured clean/process filters.
Use the repository's owning account instead, or deliberately provision a root-owned checkout outside Cadence; no Git configuration edit, `chown`, credential import or permission reset is performed.
Ordinary-user Git trust behavior remains intact.
Trusted repositories can still carry executable Git configuration; root is not an isolation or sandbox guarantee.
Changing to root changes the effective account and its private namespace: stop all old Cadence owners before doing so, since different accounts/state homes do not coordinate each other's original work.

## Background service

```sh
cadence server install [--workspace /absolute/project] [--system|--user] [--no-linger]
cadence server status
cadence server restart
cadence server stop
cadence server uninstall
```

Only these explicit commands register, change or remove the service; no package install, update hook, `/cadence` or browser visit does.
The package has no install script, so npm 12 and Bun skipping untrusted scripts by default changes nothing; the pinned Pi SDK's blocked `@google/genai` preinstall only echoes `no-op`, and its `protobufjs` postinstall only warns about version schemes.
Linux server commands accept `--system` or `--user` after the action; root defaults to system scope and other accounts to user scope.
`--system` requires root and never runs sudo itself; `--user` explicitly selects the legacy per-user manager, even when invoked by root.
Linux also accepts `--name <name>` on every server command to select `cadence-<name>.service`, and `install` accepts `--port <1-65535>` for a missing port setting.
Names must start with a letter or digit and contain only letters, digits, `_` and `-` (at most48characters).

`install` also creates the research template `~/.pi/agent/cadence/.env` when it is missing, never overwriting it, whatever the service result, and adds its [port and token](#port-and-token) lines when they are missing.
`install` without `--workspace` runs `workbench start --foreground --server-config <file>` (Linux, macOS), or without `--foreground` on Windows.
The service process may use its package directory as a technical launch cwd; it is never an agent workspace and no project scan or model runtime is initialized there.
An explicit `--workspace` retains single-project service compatibility and must name an existing suitable directory.
A reinstall without `--workspace` explicitly selects the unified entry after orderly Stop of the old generated definition; it neither deletes the former workspace nor imports its data.
A plain `restart` retains the definition's existing target, including an older explicit project service, rather than silently migrating it.
The `.env` [port and token](#port-and-token) select the endpoint (17423 by default) and the token; an occupied endpoint fails instead of falling back.
Install and restart print the private entry link once the owner answers; the JSON result on stdout never carries the token.
`restart` rewrites an existing definition with the current Node and package paths, keeping its workspace and the user's disable choices, and starts it; run it after an npm upgrade, a Node change or a `models.json` edit.
`stop` joins the workbench's accepted openings and associated exact-epoch project owners, then closes the entry; unrelated project owners stay independent.
If one associated owner refuses or has a changed epoch, Stop still reaches the other known owners serially, while the workbench remains fenced rather than reporting a successful Stop.
Project-specific `stop --workspace <path>` remains scoped to that owner.
The generated registration stays for the next boot or login.
`uninstall` stops it orderly and deletes only what Cadence generated; workspace, state home, history, linger and Pi sources stay.
Because npm runs no uninstall script, uninstall the service before `npm uninstall -g`; a left-behind definition fails to start once its CLI path disappears.
A definition Cadence did not generate is left unchanged (`foreign`), and `status` reports `absent` when none is registered.

Pi's installer omits peers, so the standalone owner and workers load the Pi SDK (`pi-coding-agent`, `pi-ai`) from exact 0.84.3 optional dependencies.
Package files may be hard links into the package manager's store (Bun's default install); Cadence binds their exact content, not their link count.
Missing or unusable Pi sources refuse before an owner registers; a new owner without the SDK quarantines.
The no-project workbench starts without either an SDK runtime or Pi authentication; missing sources are reported only when a project is explicitly opened.
For an explicit single-project definition, the older guards remain: no SDK means no definition, and missing `auth.json` means registered but waiting for Pi login.

While no service is registered, Pi's session-start card shows a separate warning naming `cadence server install` for an installed package copy (`node <copy>/src/service-cli.mjs server install` for Pi's managed copy, which puts no bin on `PATH`); a checkout loaded with `pi -e` stays quiet.
It is a warning rather than part of the info card because Pi's TUI replaces one info status with the next.
`/cadence` names the same command when it finds no owner.
A machine without a supported user service manager and `CADENCE_AUTOSTART=0` keep both quiet; with `CADENCE_LINGER=0` they suggest `--no-linger`.

### Port and token

The background service reads two lines of the research configuration `~/.pi/agent/cadence/.env`:

```sh
CADENCE_PORT=17423
CADENCE_TOKEN=<at least 32 characters, no control or format characters>
```

The file keeps the research skills' syntax (`KEY=value` lines, `#` comments, one optional pair of quotes), and each of these keys may appear only once.
`install` and `restart` create the file from the research template when it is missing, as your own 0600 file.
They append a missing `CADENCE_PORT` (17423) or `CADENCE_TOKEN` (random, 43 characters) under a comment, in the file's own line endings, and never change an existing line.
It is your own file, made by hand, by older docs (`mkdir -p ~/.pi/agent/cadence`) or by a dotfiles manager, so it is read like Pi's sources: its mode bits are not checked (0644, or 0664 under umask 002, work), links in its path and the file itself are followed, and a rewrite goes to the real file, written 0600, leaving the links in place.
When other users can read it, `install` and `restart` add a note naming `chmod 600`, without refusing.
Only a file that cannot be the user's own configuration makes them change nothing: missing or a link to nothing, not a regular file, not owned by you or in a directory you do not own, hard-linked, over 64 KiB or not UTF-8, a line the research skills would also refuse, a duplicate key, a port outside 1-65535 or a short token.
Each refusal names its reason and line number, never a byte of the file.
A project's `.pi/cadence/.env`, which the research skills prefer, is never read for the service.
`start --server-config <.env>` makes these lines authoritative.
The host reads them once before binding, like an environment token, so editing them while the owner runs changes nothing and can never fence access or the orderly Stop; the next start applies them, and `cadence server restart` does both.
A workspace whose token comes from the file follows it at every `start`, also without `--server-config`; a contradicting `--port`, `--token-file` or `CADENCE_WEB_TOKEN` refuses.
`CADENCE_WEB_TOKEN` stays the separate process-environment source; sourcing the `.env` in a shell sets `CADENCE_PORT` and `CADENCE_TOKEN`, which Cadence never reads from its environment.
The token never enters Cadence's state home, and status and diagnosis never print it.
`token-rotate` replaces only the `CADENCE_TOKEN` line's value with a new random token, keeping every other byte, and invalidates old links and cookies without stopping work.
It refuses without any effect when that token was edited since the start, so a pending edit is never overwritten.

A stopped workspace selected earlier with a generated, environment or file token, or another port, is reselected to the file at its next `start --server-config`.
Under the new owner reservation Cadence retires the previous token with a new access generation and replaces the selected port and token source; the history and every other selected setting stay.
A different agent directory, host or proxy still conflicts, and a running owner refuses until it has stopped.
An interrupted replacement keeps the reservation as a fence and is never repaired automatically, like any interrupted start.

### Linux systemd system/root unit (no linger)

```sh
# Root must already have its own usable Pi credentials and SDK installation.
sudo -H cadence server install --system --workspace /srv/project
sudo -H cadence server status --system
sudo -H cadence server restart --system
sudo -H cadence server stop --system
sudo -H cadence server uninstall --system
```

Use an absolute Node and package CLI path with `sudo -H` if `cadence` is not on root's PATH.
These commands generate `/etc/systemd/system/cadence.service` with `User=root` and `WantedBy=multi-user.target`, and use `systemctl --system`.
They never consult or change linger, require no logged-in user manager and start at boot independently of root login.
The definition freezes HOME, PATH, LANG/LC_ALL, an explicit XDG_STATE_HOME and custom PI_CODING_AGENT_DIR; root must own its selected Pi sources, and no normal-user profile or credentials are copied.
Root runs the agent and approved checks with full root privileges: browser authentication remains access, not permission to Start, and this is not a sandbox.
Status and install output identify system scope; Pi's root startup hint recommends `--system`, never `loginctl enable-linger`.

A prior user-scope definition of the same name causes `scope-conflict`, never automatic migration.
For a root account's older user unit, explicitly run `cadence server uninstall --user` first, then install `--system`; this preserves its workspace, private history, credentials and linger setting.
For another account's service, first stop/uninstall it as that account; root must not silently import its private state or assume its owners are absent.
A detached owner already running in the target directory causes `project-running`; stop it explicitly before installing a different supervisor.
An old but inactive unit does not own a subsequently detached owner: install, restart, stop and uninstall also refuse in that case, without sending Stop to it, and changing the requested target does not bypass the old directory's check.
An unconfirmed or quarantined Stop, changed generated file, changed HOME/XDG state selection, a mask or a foreign unit prevents replacement/adoption.
`restart`, `stop` and `uninstall` await the authenticated original owner Stop before invoking systemctl, so manager timeouts are never used as proof of settlement.
Restart keeps disablement and does not unmask anything; uninstall removes only the generated definition, never data or linger.
Direct systemctl shutdown still has the unit's ExecStop and timeout behavior described below; it is not an alternative recovery mechanism.

### Independent named Linux services

```sh
sudo -H cadence server install --system --name api --workspace /srv/api --port 17424
sudo -H cadence server install --system --name web --workspace /srv/web --port 17425
sudo -H cadence server status --system --name api
sudo -H cadence server restart --system --name web
```

The units, ports, access tokens, working directories and owner lifetimes are separate; restarting or stopping one does not touch another.
A named service uses `~/.pi/agent/cadence/servers/<name>.env` under its effective account, never a copy of the default token or research/provider configuration.
A new named configuration requires `--port`; existing port/token lines are preserved, and a conflicting `--port` refuses instead of rewriting them.
Edit the selected named file explicitly and restart that same `--name` to change its port.
An occupied port still refuses rather than silently falling back; use `project open` when an automatically selected detached port is preferable.
All projects still share one coordination state home for their account, retaining canonical overlap checks and uncertain fences.

### Linux systemd user unit

`install --user` writes `~/.local/share/systemd/user/cadence.service`, enables it for `default.target` (also undoing a `disable`, never a `mask`) and starts it.
A user unit runs with the user manager, which starts at login unless logind lingers the user, so install also enables linger when it is off.
It first calls `SetUserLinger` through `busctl` with `interactive=false` and no interactive authorization (bounded to 15s), because `loginctl enable-linger` always requests an interactive check that a desktop polkit agent can turn into a password dialog even with `--no-ask-password`.
Only where polkit requires authorization for `set-self-linger` (older systemd defaults) does it then run `loginctl enable-linger`, which may ask for your password; that comes after the start, so an interrupted prompt never leaves the owner stopped, and a refusal reports `"linger":"refused"` with a login-only unit.
`--no-linger` or `CADENCE_LINGER=0` skips linger; `restart` never changes it, so `loginctl disable-linger` is kept.
The unit bakes the installer's PATH (minus npm lifecycle entries), LANG/LC_ALL, an absolute XDG_STATE_HOME and a custom PI_CODING_AGENT_DIR, so shell management sees the same state home and Pi sources.
Proxy variables are not baked; add a validated pair with `systemctl --user edit cadence`.
It carries `ConditionPathExists=` for the CLI; explicit single-project definitions also require `auth.json` and both SDK packages, while the project-less workbench does not.

`restart` stops an active unit with its loaded definition, rewrites the file and starts it, without enabling a disabled unit; a masked unit is never enabled or started.
`ExecStop` is the authenticated orderly Stop, so admitted work is stopped, not detached; `stop` and `uninstall` (`disable --now`) use it too.
`KillMode=mixed` sends systemd's SIGTERM only to the management client.
An owner still settling after `TimeoutStopSec=90` (for example a quarantined one) is SIGKILLed, which is not orderly Stop and can leave recovery fences.
`Restart=on-failure` is bounded to three starts in five minutes; a restart never removes fences, so a crashed owner keeps refusing until informed recovery.
Without linger, user units start at login and stop at logout through the same Stop.
Linger starts the user manager, with every enabled user unit, at boot and keeps it running after logout.
`status` reports `linger` as `on` or `off`, and Pi's startup card names `loginctl enable-linger` while an enabled unit is login-only; a disabled or masked unit (also `mask --runtime`) keeps it quiet.
To keep the service off while Cadence stays installed, use `systemctl --user disable --now cadence` or `mask`.

### macOS LaunchAgent

`install` writes `~/Library/LaunchAgents/com.abelxiaoxing.cadence.plist` with `RunAtLoad`, runs `launchctl enable` (undoing a `launchctl disable`) and loads it into `gui/<uid>` with `launchctl bootstrap`, which starts it; launchd loads it again at every login.
It bakes the same PATH, LANG/LC_ALL, XDG_STATE_HOME and PI_CODING_AGENT_DIR as the Linux unit and logs to `~/Library/Logs/cadence.log`.
For an explicit single-project service, missing `auth.json` leaves the agent written but not loaded; the project-less workbench can start without Pi login.
Because launchd stops a job only by signaling it, `restart`, `stop`, `uninstall` and a reinstall first stop the owner through the authenticated orderly Stop, and change nothing when that Stop is `unconfirmed`, `quarantined` or `unavailable`.
Only then does Cadence unload (`bootout`) or replace the agent; `stop` leaves it loaded, and the finished job starts again at the next login.
There is no `KeepAlive`: launchd has no start limit, and a restart never clears fences, so a failed owner stays down until `cadence server restart`.
`restart` keeps a `launchctl disable` and reports `disabled` without loading.
At logout or shutdown launchd signals the job, which is not orderly Stop and can leave recovery fences; run `cadence server stop` first while work is running.

### Windows login Run entry

`install` writes `%LOCALAPPDATA%\cadence-server\cadence.vbs`, beside rather than inside the private state home, and the per-user value `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Cadence`, which runs it with `wscript.exe` at login; no administrator rights are needed.
The launcher is UTF-16 with a byte-order mark, so non-ASCII paths work, and runs `workbench start` (or `start --workspace` for an explicit project) with window style 0, so no console window appears; the detached owner keeps running after the launcher exits.
It bakes only a custom PI_CODING_AGENT_DIR, because the login environment already carries PATH and `%LOCALAPPDATA%`.
`install` also removes Task Manager's `StartupApproved` switch for the entry (undoing a disable there); `restart` keeps both the entry and that switch, and `status` reports a disabled entry.
For an explicit single-project service, missing `auth.json` leaves the entry registered but starts nothing; the project-less workbench can start without Pi login.
Nothing supervises the detached owner, so a failed owner is not restarted, and every `restart`, `stop`, `uninstall` and reinstall first runs the authenticated orderly Stop and changes nothing unless it is confirmed; Cadence never kills a process.
A `Cadence` Run value without Cadence's launcher is `foreign` and left unchanged; registry values are only tested for presence, because `reg.exe` prints them in the console code page.
At sign-out or shutdown Windows ends the owner without orderly Stop, which can leave recovery fences; run `cadence server stop` first while work is running.

## Status, departure and Stop

- `alive` requires an authenticated exact-epoch reply.
  It is not a PID probe.
  `actions:false` can mean that no owner model has been explicitly selected yet.
- Return, browser close and Pi quit detach clients; admitted work continues.
  Use the client's **Cancel** for a run or management **stop** for the service.
- Stop closes admission and waits original processes, credential writes, history writes, already-started publication continuations, owned networking and listener closure before releasing fences.
  Checks, native process outcomes and human review remain separate facts.
- `unconfirmed` means startup/Stop acknowledgment or settlement was not established within its reporting bound.
  It is not permission to restart, kill a guessed PID or remove a lock.
  `quarantined` preserves uncertain process/auth/storage work and prevents unsafe writers.
- A host that refuses during `start` reports `{"status":"refused","error":<code>,"stage":<stage>}` and exits without registering an owner.
  Stages are `package` (installed web assets or Agent profiles), `pi-agent-directory`, `pi-auth`, `pi-models` and `service`; stderr names the selected Pi source to fix.
  `quarantined` with stage `pi-runtime` or `service` means the owner registered first; it keeps its fences for informed recovery.
  Reports carry fixed codes and stages only, never paths, configuration bytes or OS error text.
- The selected Pi agent directory must be a real directory (not a symlink) owned by you; `auth.json` and `models.json` must be your own single-link regular files.
  Their mode bits are not checked: Pi creates its agent directory with your umask (0755, or 0775 under umask 002), and Cadence's own state stays 0700 regardless.
  `models.json` may use only fields the pinned SDK supports.
  `supportsMidConvoSystemMessages` from newer Pi is accepted because the pinned SDK has no system-role conversation message; other unknown fields refuse rather than being silently ignored.
  The owner model choice offers every thinking level the pinned SDK supports for a model, `off` through `xhigh` and `max`; a model whose `thinkingLevelMap` maps only `max` (as some DeepSeek configurations do) is chosen at `max`, and a child runs only at exactly that level.
  A model whose provider or model ID contains a known credential value is withheld from the catalog, since showing the ID would reveal that value; the catalog says how many models are withheld, and the rest stay selectable.
  Credential values are `auth.json` keys, `models.json` `apiKey` and header values (and the variables they name) and service-environment variables whose names contain `KEY`, `TOKEN`, `SECRET`, `PASS`, `AUTH` or `COOKIE`.
  The common Ollama placeholder `"apiKey": "ollama"` under a provider named `ollama` is such a case: give the placeholder a value that matches no provider or model ID (for example `"local-no-auth"`), then restart the service.
  The owner loads `models.json` once at start: after it changes, the model catalog, the chosen model and the workspace view refuse as `stale` (credential changes in `auth.json` are read fresh).
  Restart the service to reload it (`cadence server restart`, or `stop` then `start`), then choose the owner model again.
- A foreground owner can be managed from another terminal.
  Ctrl-C, SIGTERM, machine crash or terminal destruction is **not** the authenticated orderly Stop route and can leave recovery fences.
  A recovered `stopped` registration means acknowledged fence release, not retroactive native closure certification.

`diagnose` reports fixed pending/recording facts and `proxyAuth: direct|validated-proxy` when the owner is reachable; a blocked global registry instead reports its fixed lock reason and local recovery hint.
No normal status/diagnosis prints access secrets, provider credentials or outbound proxy URLs.
Keep the explicitly revealed token link private.
Browser entry redirects to a token-free URL and uses an HttpOnly cookie; that does not retract a link already copied into history, a clipboard or external logs.
File/generated token rotation invalidates old access and pending confirmations, not admitted work.
Environment-token replacement requires explicit Stop/restart with changed environment.
Inbound remote access still requires the selected same-host HTTPS reverse-proxy policy; outbound proxy routing below is independent.
Browser access, even with a valid token, cannot perform local management/recovery or arbitrary manual shell checks.
The native client's local capability uses an owned direct loopback dispatcher, never the Pi process's provider proxy.
Detach joins that client's original dispatcher closure without changing the parent's global dispatcher or canceling service work.

## Outbound owner authentication and workers

Set one credential-free HTTP(S) proxy URL as an equal HTTP/HTTPS pair in the **service launch** environment.
Matching uppercase/lowercase duplicates are supported; conflicting or partial pairs refuse.
No `ALL_PROXY`, `NO_PROXY`/bypass, URL userinfo, non-root path, query/fragment, percent-bearing authority, unsafe controls or `NODE_OPTIONS` (including empty entries) is accepted.
`NODE_USE_ENV_PROXY` can be absent or exactly `1` with the pair.
A standalone opt-in refuses.
The service launcher projects the validated uppercase pair and opt-in before SDK imports, and uses the actual runtime's public `--use-env-proxy` capability.
Missing capability refuses before launch, without finding/installing another Node.

After SDK imports the dedicated owner installs one owned public Undici dispatcher, verifies its identity and uses it for public SDK getAuth/OAuth refresh.
Workers retain their separately validated startup/post-import route.
Scoped provider route entries must exactly match the captured route; they cannot select a route or become process environment.
Changed route facts/dispatcher identity refuse, never silently fall back to direct traffic.
DIRECT adds no dispatcher work.
No TLS override, global fetch replacement or private SDK networking is used.
Proxy URLs are RAM-only known redaction literals, not persisted route hashes or public history fields.

Pi's selected existing `auth.json`/`models.json` remain the model sources; OAuth renewal writes back through public SDK coordination, preserving unrelated credentials.
Cancel stops launch admission but does not claim an already-started refresh/writeback was rolled back.
Checks inherit the owner's frozen ordinary launch environment (including the canonical configured proxy pair/opt-in), minus service/access/control material.
Resolved model auth is never merged into checks.
Local fabricated-provider plain/gzip routing tests are not paid-provider, all-adapter, Node22 or other-platform qualification.

## Informed local recovery

```sh
cadence recover inspect --workspace /absolute/project
cadence recover resolve --workspace /absolute/project
```

Inspection is readonly and handles the global registry lock before project-owner recovery.

### Residual global registry lock

`status` and `diagnose` report `reason: "registry-locked"` and the lock holder observation (`live`, `absent`, `ambiguous` or `unreadable`).
Project Open reports `registry-locked` instead of an opaque `unavailable`; the folder picker explains the local recovery command.
This lock is shared by every project in the selected state home, so trying a different project does not bypass it.
Use the same account and `--state-home` as the owner; omit that flag only when it uses the default state home:

```sh
cadence recover inspect --workspace /absolute/project --state-home /absolute/state-home
cadence recover resolve --workspace /absolute/project --state-home /absolute/state-home
```

With a registry lock present, inspection reports `scope: "global-registry"`, the exact lock-incarnation digest, holder PID/host, reservation count and any previous resolver's liveness.
A project with no selected owner can be used to address this global operation; it still must be an existing suitable directory.
Resolve requires the same four fresh local-terminal acknowledgments described below, with the displayed lock-incarnation digest instead of a service epoch.
The holder must be on this host and its PID probe must specifically report absence; age, a remote host, permission denial or a reused live PID never authorizes release.

Recovery validates the registry and checks that unreserved project selections have no remaining owner/checkout fences.
A normally stopped project whose working directory was later removed is checked through its retained private metadata; recovery neither requires nor reconstructs that directory.
An interrupted reservation remains reserved even when its project initialization is incomplete: unrelated projects can reopen, but that project's uncertain resources are not repaired.
An older release interrupted after removing a reservation but before releasing its project locks is unsafe and remains blocked, as do corrupt/partial registry bytes, linked files and changed resources.
Inspection reports `blocked-preserve-state` when it cannot establish those conditions; preserve that state for manual diagnosis rather than deleting locks.

Before releasing only `registry.lock`, the resolver exclusively creates, flushes and closes a private receipt under `service-registry-v1/recovery-v1/<lock-incarnation>/<attempt>.json`, retaining the original lock bytes and acknowledged digest.
It then rechecks the lock incarnation, registry, unreserved project selections, receipt and terminal authority.
Concurrent resolvers cannot release a successor lock.
If a resolver dies after the receipt but before release, a new inspection and fresh terminal confirmation may append the next attempt after that resolver's same-host PID is absent; neither receipt nor lock is silently reclaimed.
Torn or unsafe receipts remain preserved and refused.
Inspection is bounded to 1024 namespace entries and 128 attempts for one lock incarnation; it never evicts evidence to make space.

All project reservations, owner locks, checkout locks, capabilities, history and unknown outcomes remain unchanged.
No Open/Start is replayed, no process is signaled, and no service is installed or started by recovery.
After success, explicitly open the desired project again.
If its own owner is still fenced, run `recover inspect` again and follow project-owner recovery separately; restoring global registry access does not certify or release that owner's work.

### Project-owner recovery

With no registry lock present, inspection displays the epoch, exact coordination/history digests, owner PID/host observation and independent process/credential/storage uncertainty.
Those digests identify preserved resources, not successful work or credential validity.
A journal with no unmatched intent does not prove every escaped descendant or external credential writer stopped.

Before resolve, independently inspect and stop old processes externally, inspect the selected Pi credential file and SDK locks, and inspect retained storage/history.
Cadence does not signal arbitrary processes, reclaim SDK locks, repair credentials, truncate damaged history, migrate old formats or delete old resources.
Resolve requires a native local TTY, four fresh typed responses within120seconds and the same unchanged resources: separate process/escaped-descendant, credential/writeback and storage acknowledgments, then the exact displayed epoch.
There is no `--yes`, piped-input confirmation, browser body boolean, HTTP recovery endpoint or pasted multiline authorization.
An SSH terminal executes locally on the owner host; this is an operator interaction boundary, not proof of a physical human's identity.

Only a same-host owner whose PID probe specifically reports absence is eligible; live, remote, ambiguous, refreshed or partial resources refuse.
Absence alone never clears anything.
The original durable append/flush/close of a new fenced recovery fact completes first.
Then exact registration and registry state are updated, and the exact capability, owner lock and associated v1 lock are released in order, rechecking remaining resources, history and local authority before every effect.
Other workspace reservations remain untouched.
The v1 lock is last.
An unrelated legacy lock is never eligible.

Recovery preserves old unknown outcomes and damaged bytes.
Its result is **operator acknowledgment, not certification**; restart chooses a new epoch and never replays queues/auth work.
New work requires fresh plan/action consent.
Failure/crash between append and release can leave a durable bridge and partial fences.
A refused command is not proof of no effects.
Reinspect and preserve that state; reading/restart does not repair it, and automatic retry/reset is not a safe resolution.
Recognized old history formats stay readonly and are not migrated to enable recovery.
