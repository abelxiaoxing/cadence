# pi-web-ui access-token flow and Cadence adaptation

## Scope and decision

Planning-only source inspection.
Upstream `/home/mirako/abel/pi-web-ui` remained clean at `e8bab487af208bc9a1ab60a821652323f598127f`; source paths below refer to that checkout.
No server, browser, tests, login, provider request or actual credential inspection was performed.
Test references are inspected source, not passing evidence.

The user explicitly requests a similar `?token=...` access scheme and direct implementation reuse.
This resolves browser-access UX toward one owner token rather than accounts/tenants.
It does not make the access token a model-provider key or authorize current credential writes.

## Actual reference chain

| Step                       | Actual behavior                                                                                                                                                                                                                                                                                                           | Source                                                                                                                 |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Configuration              | Server reads and trims `PI_WEB_TOKEN` once at startup. Default bind is `127.0.0.1`; the token is optional upstream. Without it, token middleware/checks are not enabled. No JWT/account store is used by this access path.                                                                                                | `server/index.ts:195-219`                                                                                              |
| HTTP credential extraction | Accepts `Authorization: Bearer`, `X-PI-Token`, URL `token`, and `pi_web_token` cookie; **any** matching candidate authenticates. Cookie raw and percent-decoded variants are tried defensively.                                                                                                                           | `server/index.ts:289-317`; `server/auth-cookie.ts:35-58`                                                               |
| Comparison                 | Hashes candidate and configured token to fixed SHA-256 digests before `timingSafeEqual`; no claim that this alone solves every timing/security issue.                                                                                                                                                                     | `server/index.ts:319-329`                                                                                              |
| Cookie bootstrap           | Valid query/header/cookie auth can issue `pi_web_token` containing the percent-encoded shared token. Flags: Path=/, HttpOnly, SameSite=Strict, Max-Age=31536000; Secure when its TLS detector says the request is TLS. Cookie is reissued only when its value differs, not a guaranteed sliding refresh on every request. | `server/index.ts:354-393`; `server/auth-cookie.ts:17-32`                                                               |
| Rejection/rotation         | Wrong/missing candidates produce 401 except `/api/health`. A stale cookie is expired. Changing the startup token and restarting makes the old token/cookie invalid; entering a valid new token repairs the cookie. Public health never issues the actual token to an unauthenticated caller.                              | `server/index.ts:354-393`; `tests/token-auth-test.mjs:145-229`                                                         |
| Frontend entry             | `initAuthToken()` runs before initial rendering/requests, saves the URL token under `pi-web-ui:token` in localStorage, and uses `history.replaceState` to remove it from the address bar.                                                                                                                                 | `web/src/main.tsx:85-86`; `web/src/auth-token.ts:15-31`                                                                |
| Later requests             | `withToken()` reads localStorage and appends an encoded query token to selected HTTP URLs and the WS URL. Ordinary navigation/static resources can use the HttpOnly cookie. Clearing the address bar does **not** mean the token no longer appears in requests.                                                           | `web/src/auth-token.ts:33-46`; `web/src/use-chat.ts:1693-1698`; callers in file previews/download/theme/locale modules |
| WebSocket                  | Uses the same page authority/base path and ws/wss according to page scheme. Server checks Host/Origin and the same token candidates **before** upgrade. `clientId` in the later hello routes clients; it is not authentication.                                                                                           | `web/src/use-chat.ts:1693-1698,2017-2039`; `server/index.ts:980-1001,1064-1081`                                        |

With a valid cookie, entering a URL with no token—or even an incorrect query token—can still authenticate because the server accepts any matching credential candidate.
The shared token grants owner access; it is a reusable bearer secret, not a one-use invitation, per-user role or a particular task's Start confirmation.

## Security/compatibility details that matter to reuse

- HTTPS/WSS or an explicitly protected tunnel is necessary for personal remote use; a query token does not encrypt transport.
  Upstream documents TLS reverse proxy for public deployment (`docs/deployment.md:119`).
- Initial query tokens may reach reverse-proxy logs, browser history capture, copied links or referrers.
  Address-bar cleanup cannot retract earlier disclosure.
  LocalStorage also keeps a JS-readable copy, and repeated token query URLs widen exposure.
- Upstream `httpHostAllowed()` bypasses Host restriction when a token is configured (`server/host-guard.ts:77-87`).
  WS explicit allowlists add checks, but origin matching compares normalized authority rather than full scheme-aware origin.
  An authenticated app should still maintain explicit Host/Origin policy; this is an adaptation, not a claim that upstream already does so everywhere.
- `isTlsRequest()` trusts forwarded TLS headers without an explicit trusted-proxy configuration in that helper.
  Cadence must only trust configured proxy paths, not client-supplied forwarding headers.
- The shared secret stored in the cookie is not a separate server-side session ID.
  HttpOnly prevents JS reading that cookie; upstream simultaneously storing the same value in localStorage reduces that protection.
  Token rotation must also account for existing authenticated WS connections; upstream restart naturally closes them, but a new hot-rotation feature would require explicit invalidation.
- Upstream's optional-token behavior is not suitable unchanged for the selected remotely actionable Cadence workspace.
  Missing remote auth must fail closed, not silently expose host-tool execution.

## Proposed Cadence adaptation (not implemented)

Preserve the reference experience: operator configures one owner secret; open `https://<host>/?token=<secret>`; no registration/account database or extra provider login merely to open the UI.

Reuse/adapt request-token parsing, constant-time digest comparison, cookie encode/decode, middleware/WS admission patterns and related tests.
Use Cadence-specific env/header/cookie names to avoid collision with a concurrently deployed pi-web-ui.
Preserve upstream MIT copyright/license and source/destination provenance.

Recommended narrow adaptation:

1. Valid token-bearing entry establishes an HttpOnly/SameSite cookie and redirects to a clean URL before loading the application.
   Keep the `?token=` entry UX, but prefer cookie-authenticated same-origin HTTP/WS afterward instead of persistent localStorage plus a token in every request URL.
   CLI/native clients may use Bearer auth.
   This avoids a new session database while reducing repeated secret-bearing URLs.
2. Require a strong nonempty configured owner token and authenticated API/event/control access for remote operation.
   Loopback remains the default listener; remote exposure is an explicit deployment step.
3. Validate exact allowed Host/Origin and state-changing requests independently of possessing a cookie; use HTTPS/WSS or a reviewed protected tunnel, with narrowly configured reverse-proxy trust.
   No credentials in ordinary app logs/health errors; document query redaction at the external proxy and residual first-link exposure.
   Use no-referrer/no-store policies for bootstrap/auth responses as appropriate.
4. Changing/revoking the owner secret invalidates its sessions/connections under an explicit policy; never treat reconnection as replaying Start.
   Test missing/wrong/special-character/stale tokens, cookie-only requests, forbidden origins, WS rejection and health non-disclosure.
5. Token admission grants access to the single-owner workspace, not automatic execution.
   Plan/Start/check/review actions retain explicit confirmation, versions and duplicate-action protection.

Session lifetime, exact names and deployment commands remain technical design details for final review.
The user's reference-like token choice is selected; the above hardening is a proposal, not new executed behavior or a promise of complete secret detection.

## Separate model authentication

`research/pi-web-ui-model-auth-reference.md` traces the other leg: standard pi-web-ui reuses Pi's existing agent directory (`~/.pi/agent` by default or an explicitly configured directory), `auth.json` and `models.json`.
It does not use `PI_WEB_TOKEN` for model inference and does not require a dedicated WebUI provider account.

Propose the same normal Pi configuration route for Cadence rather than forcing a separate credential subsystem.
Explain that the public SDK normally writes refreshed OAuth credentials back to the chosen auth store; this is writable sharing, not readonly observation.
The pending user-owned question is whether that normal refresh/write behavior is also accepted.
No provider configuration, keys, login, refresh, copying or migration was performed during research.
