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
`start` also accepts `--foreground`, `--config`, `--agent-dir`, `--host` (loopback only), `--port`, `--token-file` and `--state-home`.
Defaults are loopback `127.0.0.1:17423`, normal Pi agent configuration, and detached service lifetime.
An explicit port0 selects and persists a positive port once; restart uses the selected configuration, not a fallback endpoint.
Missing/corrupt existing setup is preserved, not filled in or reset.
A workspace that contains the private state home (the home directory and its ancestors, such as `C:\Users\<you>` with `%LOCALAPPDATA%` or `~` with `~/.local/state`) would expose private history and locks to change observation, so every command there uses `~/cadence` (`%USERPROFILE%\cadence`) instead of refusing.
Only `start` creates it; `status` reports `absent` without creating it, an explicit `--workspace` adds one informational line, and JSON output names the effective `workspace` only when it differs.
`/cadence` started in such a directory attaches to the same owner, and real project directories are never redirected.
Apart from the background service below, there is no supervisor installation, provider login or credential migration.

## Background service

```sh
cadence server install [--workspace /absolute/project] [--no-linger]
cadence server status
cadence server restart
cadence server stop
cadence server uninstall
```

Only these explicit commands register, change or remove the service; no package install, update hook, `/cadence` or browser visit does.
The package postinstall only creates a missing research `.env` template, so npm skipping it (`allow-scripts`, npm 12's default) changes nothing else.
`install` works from any package location and runs `start --foreground --workspace` (Linux, macOS) or `start --workspace` (Windows) from that copy with the installing Node, without `--port`.
The workspace is `~/cadence` (created if missing), an existing absolute `--workspace`, or on later installs the one the definition already runs; a workspace containing the service's state home lands on `~/cadence` with a note.
A new workspace selects `http://127.0.0.1:17423`; a port saved by an earlier start of that workspace still wins, and an occupied endpoint fails instead of falling back.
Browser entry still requires the explicitly revealed token link; install prints the `token-link --reveal` command, never the token.
`restart` rewrites an existing definition with the current Node and package paths, keeping its workspace and the user's disable choices, and starts it; run it after an npm upgrade, a Node change or a `models.json` edit.
`stop` stops the owner orderly and keeps the registration for the next boot or login.
`uninstall` stops it orderly and deletes only what Cadence generated; workspace, state home, history, linger and Pi sources stay.
Because npm runs no uninstall script, uninstall the service before `npm uninstall -g`; a left-behind definition fails to start once its CLI path disappears.
A definition Cadence did not generate is left unchanged (`foreign`), and `status` reports `absent` when none is registered.

Pi's installer omits peers, so the standalone owner and workers load the Pi SDK (`pi-coding-agent`, `pi-ai`) from exact 0.84.3 optional dependencies.
Package files may be hard links into the package manager's store (Bun's default install); Cadence binds their exact content, not their link count.
Missing or unusable Pi sources refuse before an owner registers; a new owner without the SDK quarantines.
`install` therefore writes nothing while the SDK is unresolvable (for example, optional dependencies omitted), and registers without starting while Pi's `auth.json` is missing (`waiting-for-pi-login`); log in to Pi, then run `cadence server restart`.

While no service is registered, Pi's session-start card shows a separate warning naming `cadence server install` for an installed package copy (`node <copy>/src/service-cli.mjs server install` for Pi's managed copy, which puts no bin on `PATH`); a checkout loaded with `pi -e` stays quiet.
It is a warning rather than part of the info card because Pi's TUI replaces one info status with the next.
`/cadence` names the same command when it finds no owner.
A machine without a supported user service manager and `CADENCE_AUTOSTART=0` keep both quiet; with `CADENCE_LINGER=0` they suggest `--no-linger`.

### Linux systemd user unit

`install` writes `~/.local/share/systemd/user/cadence.service`, enables it for `default.target` (also undoing a `disable`, never a `mask`) and starts it.
A user unit runs with the user manager, which starts at login unless logind lingers the user, so install also enables linger when it is off.
It first calls `SetUserLinger` through `busctl` with `interactive=false` and no interactive authorization (bounded to 15s), because `loginctl enable-linger` always requests an interactive check that a desktop polkit agent can turn into a password dialog even with `--no-ask-password`.
Only where polkit requires authorization for `set-self-linger` (older systemd defaults) does it then run `loginctl enable-linger`, which may ask for your password; that comes after the start, so an interrupted prompt never leaves the owner stopped, and a refusal reports `"linger":"refused"` with a login-only unit.
`--no-linger` or `CADENCE_LINGER=0` skips linger; `restart` never changes it, so `loginctl disable-linger` is kept.
The unit bakes the installer's PATH (minus npm lifecycle entries), LANG/LC_ALL, an absolute XDG_STATE_HOME and a custom PI_CODING_AGENT_DIR, so shell management sees the same state home and Pi sources.
Proxy variables are not baked; add a validated pair with `systemctl --user edit cadence`.
It carries `ConditionPathExists=` for the CLI, `auth.json` and both SDK packages.

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
Without `auth.json` the agent is written but not loaded.
Because launchd stops a job only by signaling it, `restart`, `stop`, `uninstall` and a reinstall first stop the owner through the authenticated orderly Stop, and change nothing when that Stop is `unconfirmed`, `quarantined` or `unavailable`.
Only then does Cadence unload (`bootout`) or replace the agent; `stop` leaves it loaded, and the finished job starts again at the next login.
There is no `KeepAlive`: launchd has no start limit, and a restart never clears fences, so a failed owner stays down until `cadence server restart`.
`restart` keeps a `launchctl disable` and reports `disabled` without loading.
At logout or shutdown launchd signals the job, which is not orderly Stop and can leave recovery fences; run `cadence server stop` first while work is running.

### Windows login Run entry

`install` writes `%LOCALAPPDATA%\cadence-server\cadence.vbs`, beside rather than inside the private state home, and the per-user value `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Cadence`, which runs it with `wscript.exe` at login; no administrator rights are needed.
The launcher is UTF-16 with a byte-order mark, so non-ASCII paths work, and runs `start --workspace` with window style 0, so no console window appears; the detached owner keeps running after the launcher exits.
It bakes only a custom PI_CODING_AGENT_DIR, because the login environment already carries PATH and `%LOCALAPPDATA%`.
`install` also removes Task Manager's `StartupApproved` switch for the entry (undoing a disable there); `restart` keeps both the entry and that switch, and `status` reports a disabled entry.
Without `auth.json` the entry is registered but nothing starts.
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
  The owner loads `models.json` once at start: after it changes, the model catalog, the chosen model and the workspace view refuse as `stale` (credential changes in `auth.json` are read fresh).
  Restart the service to reload it (`cadence server restart`, or `stop` then `start`), then choose the owner model again.
- A foreground owner can be managed from another terminal.
  Ctrl-C, SIGTERM, machine crash or terminal destruction is **not** the authenticated orderly Stop route and can leave recovery fences.
  A recovered `stopped` registration means acknowledged fence release, not retroactive native closure certification.

`diagnose` reports fixed pending/recording facts and `proxyAuth: direct|validated-proxy`.
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

Inspection is readonly.
It displays the epoch, exact coordination/history digests, owner PID/host observation and independent process/credential/storage uncertainty.
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
