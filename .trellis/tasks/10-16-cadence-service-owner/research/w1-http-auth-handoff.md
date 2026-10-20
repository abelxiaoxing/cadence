# W1 HTTP / access transport handoff

## Scope and status

Implemented the assigned HTTP/access boundary, portable HTTP/WS transport, exact port-zero policy seam and native security fixtures.
**Neither W1 nor the complete redesign is finished.**
There is no service CLI/generated build, model-context adapter, durable history writer, scheduler, browser application or terminal cutover in this change.
No service was deployed to the real checkout; no actual user/provider credentials, package installation, global SDK, task-state change, commit, push or publication was used.
All listeners, access material and TLS certificates in tests belong to newly allocated fixtures.

The ten frozen common source/test hashes still match `joint-interface-freeze.json`.
Their DTO/client/admission/port semantics were not changed and no private casts or accepting defaults replace missing integration.
The existing extension execution route remains unchanged pending W5.

## Files and public composition APIs

| Owner                                                                                | API / responsibility                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service/config.ts`                                                              | `HttpPolicy`, `decodeHttpPolicy`, numeric `loopbackAddress`, actual-port `localOrigin`.                                                                                      |
| `src/service/auth.ts`                                                                | `AccessMaterial.initialize`, constructor/load, `tokenLink`, durable `rotate`, `onRevoke`; `HttpAuthentication`; strict raw-header `requestBoundary`.                         |
| `src/service/http.ts`                                                                | `ServiceHttpServer({policy,auth,adapters,assets})`, explicit `listen`, `admit`, `quiesce`, original reusable `close`; `LiveProjectionPort` and fixed `StaticAsset` manifest. |
| `src/service-wire.ts`                                                                | One portable finite route/method/input/output/WS-envelope owner; calls the unchanged common DTO decoders.                                                                    |
| `src/service-http-client.ts`                                                         | `HttpServiceTransport implements ServiceTransport`; named reads/actions, explicit read-only subscription and detach; injected Fetch/public WebSocket factories.              |
| `src/service/coordination.ts`                                                        | Narrow requested `:0` versus actual positive endpoint distinction; recognizes `access-config.json` and `access.json`.                                                        |
| `test/service-auth.test.ts`, `test/helpers/service-http-fixture.ts`                  | Real Node HTTP, ws and CA-verified TLS proxy; deliberately injected task/history adapters.                                                                                   |
| `test/service-owner.test.ts`                                                         | Three additional port-zero/access-namespace regressions; all prior owner regressions retained.                                                                               |
| `licenses/pi-web-ui-MIT.txt`, `provenance/auth-reuse.json`, `THIRD_PARTY_NOTICES.md` | Full upstream MIT body, pinned source/destination hashes and specific auth adaptation notice.                                                                                |

### Required startup composition

Construction/import never listens, discovers tasks, starts workers or resolves provider auth.
`listen()` binds only the explicitly selected loopback host/port and returns the actual positive-port origin, initially with private admission closed.
The future composition must establish ownership and real adapters before calling `admit()`; port occupation refuses rather than selecting another port.
`ServiceCoordination.acquire(requestedOwnerConfig, actualBoundEndpoint)` retains the original requested config bytes/hash, records only the actual endpoint, and rejects substituted hosts or positive requested ports.
A missing resolved port for requested `:0` refuses before registry reservation.

Explicit initial private setup precedes the first registration; ordinary start/restart loads existing access material and must not call initialization to repair missing files.
`AccessMaterial.initialize` refuses if either access marker/material or an existing registration/owner lock is present.
This is a setup primitive, not an automatic start/restart migration.
The later CLI must preserve atomic registry overlap reservation and original ownership/readiness ordering rather than infer readiness from the bound listener or file-only status.

`HttpAdapters` explicitly requires slots for real `ActionAdmission`, `ProjectionPort`, receipt lookup and `LiveProjectionPort`, with `null` meaning unavailable.
Missing action/history ports return fixed unavailable/inconclusive results, never successful task creation, a fabricated durable receipt or execution.
The projection's session bootstrap supplies its real store/epoch/generation/capabilities; ingress verifies the epoch/generation and narrows capabilities to composed actions and authenticated authority.
The server owns the per-boot browser CSRF UUID; local sessions receive null CSRF.

`close()` shares one original promise across callers and waits the original native HTTP listener, WebSocket-server close and tracked socket close events.
It does not cancel workers or release checkout locks.
The real `ServiceOwner` must invoke it after its original process/auth/storage drain, not substitute HTTP closure for those facts.

## Access and proxy policy

`HttpPolicy` is closed, secret-free data: schema `cadence-service-http/1`, host `127.0.0.1 | ::1`, port `0..65535`, and null or `{origin,trustedAddresses}` HTTPS proxy policy.
The proxy origin must be a canonical exact HTTPS origin; trusted immediate addresses must be explicit numeric loopback addresses.
There is no DNS/private-LAN Host fallback, token-based Host bypass, trusted arbitrary forwarding header or non-loopback listener.
This decoder does not discover or rewrite configuration; CLI/full-policy selection and persistence remain composition work.

Access setup defaults to 32 random bytes encoded as base64url.
An explicit captured environment value or private raw UTF-8 token file is mutually exclusive; configured values retain exact bytes, require 32–1024 UTF-8 bytes and reject controls/formats.
The CLI must supply `CADENCE_WEB_TOKEN` explicitly; these modules do not read ambient credentials.
External token files use bounded regular/single-link/no-follow/private-mode reads, without newline trimming or copying their token into access metadata.
`access-config.json` records source/path; `access.json` records generation and only the generated-source token.
Missing, corrupt, linked, hardlinked, unsafe-mode or partial selected material is preserved/refused.

Only `GET /?token=...` accepts query credentials.
A wrong explicit token refuses even with a valid cookie; valid entry issues a checkout-specific HttpOnly, SameSite=Strict, Path=/, 12-hour cookie and 303 redirect to `/app`.
Secure is set only after the configured proxy boundary succeeds.
There is no browser Bearer/header-token authorization, localStorage token or later API/WS query token.
The cookie scheme deliberately remains the reference's encoded owner secret, not a signed-session/account framework.

Every request independently checks exact Host and supplied scheme-aware Origin.
Browser mutations require exact Origin plus `X-Cadence-CSRF`; browser WS requires exact Origin before upgrade.
Private cross-site fetches refuse, while the deliberate top-level token-link bootstrap remains possible.
Native `X-Cadence-Local` is a separate per-boot capability, accepted only on direct loopback without browser Origin, cookie/fetch metadata or forwarding assertions.
A body field claiming terminal authority never affects authentication.

Proxy ingress requires the exact public Host, an allowlisted immediate peer and **only** `X-Forwarded-Proto: https`.
RFC Forwarded, X-Forwarded-For/Host chains, X-Real-IP, multiple/unsolicited assertions and altered proto values refuse.
The real TLS fixture strips incoming assertions and inserts this sole backend assertion.
It verifies the test certificate through an explicit CA for HTTPS/WSS, with a negative missing-CA control; no TLS-disable environment or global network replacement is used.
This is a same-host isolated protocol fixture, not actual remote deployment or a second physical machine.

Local `tokenLink(origin)` is an explicit reveal primitive, never an HTTP response/status field.
File rotation durably writes replacement material before changing generation, revoking grants, aborting private reads and closing sockets.
Uncertain persistence fences access and retains bytes; environment-source rotation requires restart and refuses a RAM-only replacement.
Already admitted work continues; rotation/detach never calls Cancel.
A first query-bearing URL can still reach browser history, clipboard or external proxy logs; redirect cannot retract that exposure.

## Wire and attachment decisions

`HTTP_ROUTES` is the sole operation/path table.
Named GET readers use one strict `request=<JSON>` query value, decoded only after authentication; IDs/scopes/cursors are the frozen DTOs, never host paths.
Named POST preflight/command/cancel/detach routes use bounded JSON bodies, with common action decoders and real ActionAdmission.
Reader paths are fixed (`/api/v1/{tasks,runs,messages,tools,contents,checks,changes,reviews,entity,graph,snapshot,details,search,...}`), rather than a second set of dynamic path-ID decoders.
`/api/v1/history-events` is the paged reader; `/api/v1/events` is WS only.
Receipt lookup is `/api/v1/receipt?request=<uuid-json>`; cancellation is `/api/v1/cancel` with the common exact run/epoch/idempotency DTO.
No general sender, shell/PTY, filesystem-path, recovery or admin mutation route was added.
Those later management adapters must remain finite/local-only, not reuse an arbitrary path/body escape hatch.

A session request allocates or reattaches a bounded UUID and returns it in `X-Cadence-Attachment`.
HTTP mutations carry that header; browser WS carries only `?attachment=<uuid>` because browser WebSocket cannot set arbitrary headers.
The attachment is transport metadata, **not authentication**, and is never persisted.
At most 16 attachments/viewers exist; inactive HTTP-only attachments have the browser-lifetime idle bound.
One socket per attachment prevents an old socket from detaching a newly installed socket implicitly.
Explicit detach or genuine socket close invalidates that attachment's grants, not another attachment's confirmations or admitted work.
HTTP-only clients explicitly detach; an individual completed HTTP request is not interpreted as session departure.

Headers are bounded at 8 KiB, control JSON at 1 MiB and WS client messages at 16 KiB.
Duplicate raw headers, duplicate JSON/query fields, malformed UTF-8/percent encoding, binary controls and oversized chunked bodies refuse.
Private body allocation is admitted after authentication, with 16 body slots / 32 original readonly operations (HTTP and WS snapshots) and 64 native connections.
Detached unresolved snapshot originals retain their read slot until settlement; established mutation/detach controls do not consume that readonly pool.
Overlapping HTTP requests/upgrades on a busy connection close that connection instead of accumulating responses behind a stalled read; ordinary sequential keep-alive remains supported.
All errors are fixed common codes/effect/recovery, with no arbitrary exception payloads or request/credential logging.
Private/auth responses are no-store/no-referrer/nosniff, self-only executable CSP and no framing.
Assets come only from a fixed in-memory manifest (64 MiB aggregate / 16 MiB per asset); no filesystem mapping, discovery, traversal or source refill exists.

The Fetch client uses common response decoders, bounds streaming input, follows no redirects, retries no mutation and does not bootstrap authentication/preflight automatically.
Its public `addEventListener` socket interface accepts actual stock ws and browser-style WebSockets without importing Node into portable code.
The caller explicitly constructs/reconstructs a read connection; there is no reconnect-driven control replay.

## Live and export boundaries

`LiveProjectionPort.subscribe` registers synchronously **before** awaiting the authoritative snapshot.
The transport bounds pending events during that await, discards events at/below the snapshot watermark, delivers newer matching chains and requests a new snapshot on gaps/epoch mismatch.
A real committed watermark comes from the mandatory live port, never the last browser-delivered event.
Heartbeat is 5 seconds, stale threshold 15 seconds and read reconciliation 30 seconds.
Each viewer owns at most 256 queued messages / 1 MiB; 16 viewers imply a finite aggregate ceiling.
Overflow/slow viewers detach rather than backpressure/fail workers; producer callbacks do not await sockets.
Connection status is never execution outcome.

Detail/search cursor validation is a mandatory W3 adapter call, authenticated on every request and rechecked after awaits.
Search and export each allow two original concurrent readers; canceled pending originals retain their slot until settlement.
Export idle bound is 120 seconds; each output write is at most 256 KiB and rechecks generation/abort, including the trailer.
Original EOF, valid frame sequence/count and an independently computed emitted-stream digest are required before releasing an adapter-supplied trailer.
Rotation, cancellation, trailing frames, digest mismatch or missing trailer terminates incomplete, without a replacement trailer.
`/api/v1/export` transports typed NDJSON frames for the shared client; `/api/v1/download` emits NDJSON or Markdown bytes from the same adapter and selected format with attachment headers.
Both use token-free selection references.
Retained membership, artifact integrity, complete-scope coverage and durable history remain W3 responsibilities; the transport must not advertise those as implemented merely because it verifies an emitted digest.

## Reuse identity and executed verification

Reference source remained clean at `xing-shuyin/pi-web-ui@e8bab487af208bc9a1ab60a821652323f598127f`.
`provenance/auth-reuse.json` binds full upstream `server/auth-cookie.ts`, `server/host-guard.ts`, `server/index.ts`, `LICENSE` bodies and destination hashes.
The cookie builder/decoder, raw/decoded candidate handling, fixed-digest timing-safe comparison, numeric loopback subset and pre-upgrade authorization order were directly adapted, with deliberate tightened policy documented there.
`licenses/pi-web-ui-MIT.txt` is byte-identical to the complete upstream MIT license, including copyright 2026 xing-shuyin.
This is genuine auth implementation reuse, not a claim that the substantial W6 browser families or emitted dependency/font/vendor notices are finished.

Final evidence is in `w1-http-auth-checks.json`, including exact commands, raw log paths/hashes, actual runtime identities and pre/post source hashes.
Focused result: **314 passed / 0 failed / 0 skipped**, four files: 114 unchanged portable contracts, 96 owner tests (93 prior + 3 new), 25 legacy store/controller tests and 79 auth/transport tests.
The latter mix actual native HTTP/WS/TLS/filesystem controls with explicitly injected task/history ports and one labeled client-clock/socket timing control; they are not 79 full-product scenarios.
Whole `check`, `lint` and `check:agents` pass; lint retains only the two prior package-audit informational suggestions.
No full-suite, pack, extracted-service or product-completion claim follows.

Earlier runs are not added to these totals.
Initial local typecheck failures (missing helper exports, Node Fetch type differences and fixture types) were corrected before the passing gates.
One evidence-capture attempt completed its checks but failed while probing an unexported Pi package.json subpath; its logs remain preserved and no pre/post receipt was reconstructed from it.
Subsequent receipts use direct readonly manifest metadata, not SDK construction/import, and freshly capture inputs before executing commands.
The earlier 309-test receipt/logs are retained separately before the final public-socket/lost-ack controls; it is not the current total.
New JSON is formatted before the final whole-lint rerun.

## Remaining integration / review gates

- Main should independently review this boundary and deliberately update maintained service-owner/directory specs; this handoff does not overwrite their current core-only claims.
- W1 model-context/OAuth writeback, tracked original auth preparation, full selected configuration, local management/recovery adapters, authenticated CLI readiness/stop and generated service build are still pending.
- W3 must supply genuine journal/receipts/cursor/artifact/export integrity and bounded owner-side secret sanitization; browser/local access secrets must never be passed to workers as a redaction shortcut.
- W4 must supply real scheduler/action/check/review composition and execution capabilities.
  The tests' injected effects are not tasks, workers or durable recording.
- W5/W6 must use the shared client/attachment protocol, native consent, explicit detach and complete history/action UX; W6 still owns substantial pinned source-family adaptation.
- W7 must replace the old member policy deliberately, audit these new notices/source bodies plus all built assets, and execute source/extracted/full-product/browser/terminal acceptance.
- Available-host evidence is Node 26 / Linux with ws 8.21.3 and installed Pi 0.84.3 metadata.
  Node 22, native Windows/macOS, physical devices/humans/remote machines and paid-provider lanes remain unqualified.
