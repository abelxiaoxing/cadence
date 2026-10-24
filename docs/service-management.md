# Explicit service management

The native `/cadence` view and browser are clients of the same owner, started explicitly or by the [Linux systemd user unit](#linux-systemd-user-unit).
Opening either view, extension discovery and login do not start it.
Use one coordination state-home for the checkout; a different state-home is not a recovery route.
Stop older Cadence sessions before starting the shared service.

```sh
cadence-service start --workspace /absolute/project
cadence-service status --workspace /absolute/project
cadence-service diagnose --workspace /absolute/project
cadence-service token-link --workspace /absolute/project --reveal
cadence-service token-rotate --workspace /absolute/project
cadence-service stop --workspace /absolute/project
```

The equivalent package-relative command is `node <cadence>/src/service-cli.mjs ...`.
`--help` lists the finite interface.
`start` also accepts `--foreground`, `--config`, `--agent-dir`, `--host` (loopback only), `--port`, `--token-file` and `--state-home`.
Defaults are loopback `127.0.0.1:17423`, normal Pi agent configuration, and detached service lifetime.
An explicit port0 selects and persists a positive port once; restart uses the selected configuration, not a fallback endpoint.
Missing/corrupt existing setup is preserved, not filled in or reset.
A workspace that contains the private state home (the home directory and its ancestors, such as `C:\Users\<you>` with `%LOCALAPPDATA%` or `~` with `~/.local/state`) would expose private history and locks to change observation, so every command there uses `~/cadence` (`%USERPROFILE%\cadence`) instead of refusing.
Only `start` creates it; `status` reports `absent` without creating it, an explicit `--workspace` adds one informational line, and JSON output names the effective `workspace` only when it differs.
`/cadence` started in such a directory attaches to the same owner, and real project directories are never redirected.
Apart from the Linux user unit below, there is no supervisor installation, provider login or credential migration.

## Linux systemd user unit

On Linux, Pi's user-scope install (`pi install npm:@abelxiaoxing/cadence`, npm in `<agent-dir>/npm`) and every `pi update` run the package postinstall, which calls `cadence-service autostart refresh`.
Refresh acts only when the package is exactly Pi's managed user copy; checkouts, project (`-l`), temporary and global installs, other platforms and `CADENCE_AUTOSTART=0` are left alone.

The first refresh writes `~/.local/share/systemd/user/cadence.service`, enables it for `default.target` and starts it.
A user unit runs with the user manager, which starts at login unless logind lingers the user, so that first registration also runs `loginctl --no-ask-password enable-linger` when linger is off; `CADENCE_LINGER=0` at install skips it.
It never prompts: where polkit requires authorization for `set-self-linger` (older systemd defaults), the unit stays login-only and the result reports `"linger":"refused"`.
Later refreshes do not change linger, so `loginctl disable-linger` is kept across upgrades.
The workspace is `~/cadence` (created if missing) or an existing absolute `CADENCE_WORKSPACE`, which lands on `~/cadence` with a note when it contains the unit's state home; later refreshes keep the unit's workspace unless that variable is set again.
The unit runs `start --foreground --workspace` without `--port`, so a new workspace selects `http://127.0.0.1:17423`.
A port saved by an earlier start of that workspace still wins, and an occupied endpoint fails the unit instead of falling back.
It bakes the installer's PATH (minus npm lifecycle entries), LANG/LC_ALL, an absolute XDG_STATE_HOME and a custom PI_CODING_AGENT_DIR, so shell management sees the same state home and Pi sources.
Proxy variables are not baked; add a validated pair with `systemctl --user edit cadence`.
Browser entry still requires the explicitly revealed token link; installation prints the `token-link --reveal` command, never the token.

An upgrade refresh stops an active unit with its loaded definition, rewrites the file and starts it again.
`ExecStop` is the authenticated orderly Stop, so admitted work is stopped, not detached.
A disabled unit is refreshed but not re-enabled, and restarted only if it was running; a masked unit is never enabled or started; a unit file Cadence did not generate is left unchanged.
`KillMode=mixed` sends systemd's SIGTERM only to the management client.
An owner still settling after `TimeoutStopSec=90` (for example a quarantined one) is SIGKILLed, which is not orderly Stop and can leave recovery fences.
`Restart=on-failure` is bounded to three starts in five minutes; a restart never removes fences, so a crashed owner keeps refusing until informed recovery.

Pi's installer omits peers, so the standalone owner and workers load the Pi SDK (`pi-coding-agent`, `pi-ai`) from exact 0.84.3 optional dependencies.
Package files may be hard links into the package manager's store (Bun's default install); Cadence binds their exact content, not their link count.
Missing or unusable Pi sources refuse before an owner registers; a new owner without the SDK quarantines.
Refresh therefore does not register the unit while the SDK is unresolvable (for example, optional dependencies omitted), and enables without starting it while `auth.json` is missing; the unit carries `ConditionPathExists=` for all three files.
After logging in to Pi, start it with `systemctl --user start cadence`.
Without linger, user units start at login and stop at logout through the same Stop.
Linger starts the user manager, with every enabled user unit, at boot and keeps it running after logout.
Because npm hides the install guidance, Pi's session-start card names `autostart install --linger` while Pi's managed copy has no unit, and `loginctl enable-linger` while the enabled unit is login-only.
A disabled or masked unit, `CADENCE_AUTOSTART=0` or `CADENCE_LINGER=0` in Pi's environment keeps the card quiet.

```sh
cadence-service autostart install [--workspace /absolute/project] [--linger]
cadence-service autostart status
cadence-service autostart remove
```

`install` registers, enables and starts the unit from any package location unless it is masked.
With `--linger` it also runs `loginctl enable-linger`, which may ask for your password; `status` reports `linger` as `on` or `off`.
`remove` disables it through `ExecStop` and deletes only the generated file; workspace, state home, history and Pi sources stay.
Because npm runs no uninstall script, run `remove` before `pi remove`; a left-behind unit skips start once its CLI path disappears.

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
- The selected Pi agent directory must be a real directory owned by you with mode 0700; `auth.json` and `models.json` must be your own single-link regular files with mode 0600.
  `models.json` may use only fields the pinned SDK supports.
  `supportsMidConvoSystemMessages` from newer Pi is accepted because the pinned SDK has no system-role conversation message; other unknown fields refuse rather than being silently ignored.
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
cadence-service recover inspect --workspace /absolute/project
cadence-service recover resolve --workspace /absolute/project
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
