# Web Source Qualification Handoff

## Ownership and Sequence

W4's execution core has been independently checked; production actions still remain closed pending generate/check/review/current-view/Stop composition.
W6 now owns a serial build/source-correction slice, with no simultaneous backend editor/test process.
The source-only port and its eight concrete audit findings are not accepted browser behavior.

Assigned W6 paths: `web/**`, `test/web/**`, web build/check/test configuration/scripts, package scripts necessary for those routes, web reuse provenance/license note, and narrowly assigned shared seams below.
No pins/lock, worker/model/history/scheduler semantics, user Git state, existing data, credentials or deployment may change.
Use fresh0700 disk roots under `/home/mirako/abel`; do not reuse personal browser profiles or download browsers/dependencies automatically.

## Minimal Shared Corrections

- Export the existing `dependency` decoder through its portable facade, without another implementation.
- Add optional AbortSignal forwarding for ordinary readonly methods through ServiceClient/HTTP transport where required; never serialize it or turn read abort into task Cancel.
  Original pending reads remain accounted until actual settlement.
- Correct observation attachment lifecycle using existing session/subscribe/resync/detach semantics.
  A revoked attachment is not reusable; observation reconnect cannot renew/replay action grants or commands.
  Return must dispose timers/subscriptions/pending view work while preserving accepted work and unresolved command IDs.
- Correct action-specific exact confirmation, late-result correlation, query-byte refusals and native `download` route selection in W6 source.
- Backend current role/planning/savedGraphRef/current-change metadata remains W4-owned; keep that adapter explicitly unavailable rather than inventing refs or outcomes.
  Prospective plan IDs are proposals, never evidence of committed content.

## Assets and Policy

Prefer fixed flat `/assets/<name>.<ext>` outputs compatible with the existing finite static map.
Serve actual emitted WOFF2/WOFF/TTF fonts and SVG/JS/CSS with exact MIME/body/size manifests; no arbitrary URL-to-filesystem mapping, wildcard public directory, CDN or source-map fallback.
A package-relative compiled-asset loader is assigned if needed; it must preserve safe reads, exact content hashes and existing16MiB/member and64MiB/closure bounds.
The management CLI remains SDK-free; the host stays mutation-closed.

Externalize the adapted timeline's own injected stylesheet.
Retain `script-src 'self'`, no inline/eval executable code, framing restrictions, token/referrer/cache policy and local-only resources.
Necessary library-generated numeric style attributes may use explicit CSP `style-src-attr 'unsafe-inline'` while `style-src-elem 'self'` remains; never allow untrusted Markdown/HTML styles or weaken executable policy.
This is a declared CSS compatibility choice, not permission to skip actual CSP/hostile-text/browser qualification.
Prefer class/CSSOM styling for owned code; remove dormant upstream wall-clock/prose-derived timing and control branches rather than reconnect them.

The builder emits deterministic source/contract/asset identity and exact compiled manifests from reviewed package inputs, not credentials or timestamps.
An actual shared service/client build handshake is still required before integrated acceptance; do not claim compatibility from a guessed constant or merely echo the server's advertised ID.
W7 retains final exact package membership, all emitted font/vendor/license closure and source/extracted qualification.
Do not derive archive expectations from the artifact under test.

## Verification

First run real installed web/config typechecks and scoped lint, then adapted pure/component tests and two private-output deterministic builds with actual asset closure checks.
After correcting the now-stable combined source, run whole check/lint/Agent gates and affected HTTP/codec tests.
Use explicit web test includes outside the existing native test namespace; browser scenarios have their own runner, not duplicate auto-discovery.
New route scripts do not make unexecuted browser/owner/package lanes pass.
Final real browser-only/mixed/phone/native-download/workflow tests wait for actual W4 owner and an explicitly available isolated binary.
