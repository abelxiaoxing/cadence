# W1 HTTP/auth independent review

## Result and boundary

**Seven concrete defects fixed; no known issue remains in this assigned transport chunk.**
W1 and the complete product remain unfinished.
Missing future model/CLI/history/scheduler/client integration was not treated as a transport defect or replaced with accepting defaults.

Reviewed the complete current HTTP/auth/config/coordination and wire/HTTP-client source, including untracked files, current task/parent artifacts and both mandatory appendices, curated specifications, tests/fixture and pinned auth reuse/notice bodies.
The finite wire-route differences are documented adapters to the frozen DTOs, not a generic sender.

## Findings demonstrated and fixed

| Finding                         | Reproduction before fix                                                                                                        | Narrow correction                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| WS resync generation race       | A queued gap started snapshot two; snapshot one's `finally` cleared its ingress flag. Event4 was lost while snapshot3 awaited. | Stop the old queue drain on generation change; only its matching generation may clear `reading`.                                        |
| Token-entry exception too broad | Cross-site cors/no-cors/same-origin subresource requests received303 and a cookie.                                             | Restrict the cross-site exception to navigate/document; retain explicit top-level token entry.                                          |
| Native metadata discrimination  | Native-capability requests with destination/user or navigate-mode metadata received200.                                        | Reject browser-only fetch metadata and unexpected modes; preserve Node Fetch's actual lone cors-mode header.                            |
| Failed session attachment leak  | Sixteen failed projections exhausted attachments; a repaired projection still returned429.                                     | Detach a newly allocated attachment on failure and remove its response header; do not reset existing attachments on projection failure. |
| Detached session stale response | Detach completed while session projection awaited; the old request subsequently returned200/private bootstrap.                 | Recheck attachment existence/authority after the await before returning session data.                                                   |
| Reentrant listener close        | A live unsubscribe reentered close, producing different promises and a second native close error.                              | Publish the one close promise before invoking teardown callbacks; preserve original native listener/socket waits.                       |
| Export read after revocation    | Revocation immediately after the native write callback still advanced the injected history iterator twice.                     | Recheck access/abort after the awaited write, before requesting the next original chunk.                                                |

The last and reentrant-close cases use explicitly injected callback timing around real Node HTTP/ws resources, not claims of spontaneous OS races.
All added regression assertions were exercised against failing source before their respective fixes, except the additional passing pool/preservation/native-Fetch controls.

The initial metadata correction was overbroad: actual Node Fetch automatically supplies `Sec-Fetch-Mode: cors`, causing six existing tests to fail.
That failed focused attempt (**322 passed /6 failed**) is retained unchanged.
The correction permits only this lone native mode without Origin/cookie/site/destination/user/forwarding authority; the new genuine Node request observation and existing public stock-ws adapter tests pass.
No negative control, deadline, shared contract or TLS verification was weakened to repair it.

## Files changed in this review

- `src/service/auth.ts`: bootstrap fetch policy and native/browser metadata discrimination.
- `src/service/http.ts`: attachment cleanup/freshness, generation-owned resync, original reentrant close and pre-read export freshness.
- `test/service-auth.test.ts`:15 added tests plus stronger original-export-slot assertions after observer abort and before original settlement.
- `provenance/auth-reuse.json`: updated changed destination hashes and precise adaptation description.
- This report and `w1-http-auth-review-evidence.json` only.

`src/service/config.ts`, `src/service/coordination.ts`, `src/service-wire.ts`, `src/service-http-client.ts`, owner tests and fixture were inspected but unchanged.
All ten frozen interface/source/test hashes, package/lock bytes, full MIT license and notice bytes remain unchanged.
Upstream remains clean at `e8bab487af208bc9a1ab60a821652323f598127f`; every pinned source/destination/license hash matches.
Existing owner/release and requested-port0 policy tests remain intact: no unresolved/substituted endpoint or prior-policy rewrite was introduced.

## Verification

Available host: **Node v26.7.0 (`/usr/bin/node`), Linux x64, ws8.21.3**; installed Pi metadata remains0.84.3.
Exact other identities, commands, pre/post input hashes and log hashes are in [the new evidence JSON](w1-http-auth-review-evidence.json).

- Focused contracts + owner + legacy-store/controller + auth: **329 passed /0 failed /0 skipped**, four files (114 +96 +25 +94).
- Whole `bun run check`, `bun run lint`, `bun run check:agents`: exit0.
- Lint retains only the two prior `test/package-audit.test.mjs` informational suggestions.
- New evidence JSON is formatted before the final whole-lint rerun; its separate native receipt/log paths are recorded in that JSON.
- Baseline314, filtered failing/passing regressions and the failed metadata attempt are preserved separately, never summed into the final total or relabeled.

Native coverage includes raw HTTP/header/body rejection, bounded partial bodies, canceled-search/export slot retention until original settlement, stock ws public `addEventListener`, WS-first snapshot races, CA-verified HTTPS/WSS with missing-CA rejection, selected private files and the existing original-process owner controls.
Execution/receipts/history projections remain explicitly injected.
HTTP close does not prove worker settlement; stream digest/count/EOF validation does not establish W3 retained-scope membership or artifact integrity.
No HTTP/read path constructs model/auth sessions or processes in this chunk; real model-context composition is still pending.

No full-suite, pack/extracted-service, SDK/provider, complete browser/terminal, Node22, Windows/macOS, physical remote/device/human or product-completion pass is claimed.
No task state, actual credentials, installation, deployment, Git mutation or unrelated historical bytes were changed.

## Main-session follow-up

Continue the approved complete delivery and rerun final gates.
When updating maintained service-owner specs under main ownership, capture the resync-generation/original-close/attachment cleanup contracts and the observed native-Fetch metadata distinction; current core-only documentation does not yet describe this implemented transport boundary.
Keep real W1 model/management composition, W3 durable history, W4 scheduling and W5–W7 clients/distribution qualification explicit rather than treating these native transport fixtures as their acceptance.
