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

Use `cadence-service token-link --workspace /absolute/project --reveal` to reveal a private entry link deliberately.
Only root GET token entry accepts query credentials; subsequent private reads, exports and WS use the HttpOnly SameSite=Strict Secure cookie.
Browser mutations/readonly POSTs require exact Origin and CSRF; access does not grant Start/check/review consent.
A bad explicit token refuses even with an older cookie.
Never put provider credentials in a browser or URL.

`token-rotate` invalidates old links/cookies, pending grants, authenticated sockets and incomplete downloads without canceling admitted tasks.
Environment-backed tokens require explicit Stop/restart with changed environment instead.
Links may already exist in clipboard/history or external logs; redirecting cannot retract disclosure.
Use [management and recovery](service-management.md) for Stop, uncertainty and exact local resolution.
Loopback HTTPS/viewport tests are not physical-device or second-machine deployment qualification.
