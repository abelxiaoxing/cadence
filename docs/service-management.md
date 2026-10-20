# Explicit service management

The native `/cadence` view and browser are clients of the same explicitly started owner.
Opening either view, extension discovery, installation and login do not start it.
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
There is no login autostart, supervisor installation, provider login or credential migration.

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
