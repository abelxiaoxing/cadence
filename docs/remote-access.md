# Explicit Personal HTTPS Access

Remote exposure is an operator action, not part of installation or extension discovery.
The backend stays on numeric loopback; configure one public HTTPS origin and trust only the immediate same-host proxy address.
Use a private0600 JSON file with actual absolute paths:

```json
{
  "schema": "cadence-service-host/1",
  "cwd": "/absolute/project",
  "agentDir": "/absolute/existing/pi-agent",
  "tokenSource": "generated",
  "tokenFile": null,
  "http": {
    "schema": "cadence-service-http/1",
    "host": "127.0.0.1",
    "port": 17423,
    "proxy": {
      "origin": "https://cadence.example.net",
      "trustedAddresses": ["127.0.0.1"]
    }
  }
}
```

`tokenSource` is `generated`, `environment` (`CADENCE_WEB_TOKEN`), `file` (the whole `tokenFile` is the token) or `config` (`tokenFile` names an `.env` whose [`CADENCE_PORT` and `CADENCE_TOKEN`](service-management.md#port-and-token) apply; its port must equal `http.port`).
Explicitly start with `cadence-service start --workspace /absolute/project --config /absolute/private-config.json`.
The host refuses arbitrary forwarding chains, alternate authorities and non-loopback binding.
Native/management capability traffic remains direct loopback, separate from browser credentials.

## Caddy example — configuration only

```caddyfile
cadence.example.net {
    # Do not enable query/access logging for the token-bearing bootstrap URL.
    reverse_proxy 127.0.0.1:17423 {
        header_up -Forwarded
        header_up -X-Forwarded-For
        header_up -X-Forwarded-Host
        header_up -X-Real-IP
        header_up Host cadence.example.net
        header_up X-Forwarded-Proto https
    }
}
```

Audit any additional proxy-generated forwarding headers against the exact backend policy before use.
Forward `/app`, `/assets/start.js`, `/ui/` and the API to the same Cadence instance, without shared caching or rewriting asset failures to the app HTML.
For a stale page, compare the authenticated `/app` response's `X-Cadence-Web-Build` with the `/ui/<build>/assets/cadence.js` URL in that response and the browser's loaded module.
An old entry served by a still-running process is not fixed by clearing browser data.
Do not share cookies, access codes or full authenticated network traces.
Recovery runs in the delivered page: if the proxy itself serves a 502 instead of the initial HTML, no Cadence script can retry from that document.
Never enable proxy retries for all methods to compensate; a lost command response is not permission to repeat the command.
HTTP and WebSocket upgrade must use the same authenticated route; no public backend bypass or insecure credential-bearing HTTP.
This example does not install Caddy, provision DNS/certificates, change a firewall or deploy a service.

Use `cadence-service token-link --workspace /absolute/project --reveal` to reveal a private entry link deliberately.
The background service prints its link at `cadence server install` and `restart`.
Unauthenticated `GET /` and `GET /app` answer 401 with a script-free password page (no script, no value backfill, no storage) that posts the key to `POST /auth`.
That page is the only `Referrer-Policy: same-origin` response, so a browser native form submits a valid Origin.
A correct key sets the `HttpOnly` `SameSite=Strict` cookie for one year (`Max-Age=31536000`) and 303s to the sanitized entry.
A wrong key redirects to the error page with a neutral notice and expires any stale cookie it carried; a sanitized `next` parameter preserves the selected project for another attempt.
Only the root `GET /?token=` bootstrap still accepts query credentials, and it sets the same one-year cookie.
Subsequent private reads, exports and WS use that cookie.
Browser mutations/readonly POSTs require exact Origin and CSRF.
`POST /auth` requires a present, exact Origin (missing/`null`/external is 403).
Access does not grant Start/check/review consent.
A bad explicit token refuses even with an older cookie.
An invalid or rotated cookie is answered 401 (password page for HTML acceptors, JSON otherwise) and the cookie is expired.
Never put provider credentials in a browser or URL.

`token-rotate` invalidates old links/cookies, pending grants, authenticated sockets and incomplete downloads without canceling admitted tasks.
Environment-backed tokens require explicit Stop/restart with changed environment instead; an `.env` token's rotation rewrites only its `CADENCE_TOKEN` line.
Links may already exist in clipboard/history or external logs; redirecting cannot retract disclosure.
Use [management and automatic recovery](service-management.md) for Stop, recovery and `cadence doctor`.
Loopback HTTPS/viewport tests are not physical-device or second-machine deployment qualification.

## Unified workbench entry

The default workbench can route associated projects on the same HTTPS origin; it does not redirect remote browsers to a project owner's loopback port.
Its explicit `cadence workbench start --config /absolute/private-http-policy.json` accepts the HTTP policy object (schema `cadence-service-http/1`, `host`, `port`, `proxy`), not a project HostConfig or an execution cwd.
Use the same `proxy.origin` and trusted immediate proxy addresses as above; the `.env` remains authoritative for the port and token.
The selected policy is retained in private workbench state, so after orderly `cadence workbench stop` a default `cadence server install` can register that entry without a project or a default workspace.
Do not install over an independently running detached entry; stop it explicitly first.
The gateway authenticates and validates Host/Origin before routing, rejects browser local-capability headers and management paths, and forwards project requests with browser cookies, not native authority.
Its unauthenticated `GET /` and `GET /app?project=` answer the same script-free 401 password page and `POST /auth` one-year cookie login as the owner; the sanitized entry preserves the `?project=` parameter.
Project attachment IDs, owner CSRF/build compatibility, consent, retained read proofs and exports remain owner-validated.
A workbench token rotation revokes its routes and retires its exact browser viewers without cancelling admitted project work.
Project ports, backend cookies and local capabilities remain server-side.
This is one entry for a trusted service account, not multi-tenant filesystem isolation or an OS sandbox.
