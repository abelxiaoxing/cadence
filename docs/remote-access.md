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
HTTP and WebSocket upgrade must use the same authenticated route; no public backend bypass or insecure credential-bearing HTTP.
This example does not install Caddy, provision DNS/certificates, change a firewall or deploy a service.

Use `cadence-service token-link --workspace /absolute/project --reveal` to reveal a private entry link deliberately; the background service prints its link at `cadence server install` and `restart`.
Only root GET token entry accepts query credentials; subsequent private reads, exports and WS use the HttpOnly SameSite=Strict Secure cookie.
Browser mutations/readonly POSTs require exact Origin and CSRF; access does not grant Start/check/review consent.
A bad explicit token refuses even with an older cookie.
Never put provider credentials in a browser or URL.

`token-rotate` invalidates old links/cookies, pending grants, authenticated sockets and incomplete downloads without canceling admitted tasks.
Environment-backed tokens require explicit Stop/restart with changed environment instead; an `.env` token's rotation rewrites only its `CADENCE_TOKEN` line.
Links may already exist in clipboard/history or external logs; redirecting cannot retract disclosure.
Use [management and recovery](service-management.md) for Stop, uncertainty and exact local resolution.
Loopback HTTPS/viewport tests are not physical-device or second-machine deployment qualification.

## Unified workbench entry

The default workbench can route associated projects on the same HTTPS origin; it does not redirect remote browsers to a project owner's loopback port.
Its explicit `cadence workbench start --config /absolute/private-http-policy.json` accepts the HTTP policy object (schema `cadence-service-http/1`, `host`, `port`, `proxy`), not a project HostConfig or an execution cwd.
Use the same `proxy.origin` and trusted immediate proxy addresses as above; the `.env` remains authoritative for the port and token.
The selected policy is retained in private workbench state, so after orderly `cadence workbench stop` a default `cadence server install` can register that entry without a project or a default workspace.
Do not install over an independently running detached entry; stop it explicitly first.
The gateway authenticates and validates Host/Origin before routing, rejects browser local-capability headers and management paths, and forwards project requests with browser cookies, not native authority.
Project attachment IDs, owner CSRF/build compatibility, consent, retained read proofs and exports remain owner-validated.
A workbench token rotation revokes its routes and retires its exact browser viewers without cancelling admitted project work.
Project ports, backend cookies and local capabilities remain server-side.
This is one entry for a trusted service account, not multi-tenant filesystem isolation or an OS sandbox.
