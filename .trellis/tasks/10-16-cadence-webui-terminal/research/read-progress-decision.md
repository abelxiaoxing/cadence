# Read Progress Decision and Single-Editor Handoff

## Authority and Reason

The user's continuous-implementation authorization approves in-scope technical recommendations without another routine approval round.
Main accepts the independently reviewed read-progress design to finish the existing bounded, restart-stable history requirements; no feature or integrity requirement is dropped.
See W3 `w3-progress-repair.md`, `read-progress-security-review.md` and `read-progress-implementation-review.md`.
The actual legal8MiB predecessor plus recovery metadata cannot fit a single8MiB read window, and the old public checksum cannot authenticate suspended validation.
Earlier refusal-only tests remain failed feature evidence until positive completion is demonstrated.

## Selected Representation

- Add optional `ReadCursor.navigation?: string`, maximum8192 encoded ASCII bytes, absent on ordinary seeds and exact search-hit anchors.
- Apply the same optional navigation field to `ListRequest` for its bounded/recovered proof continuations.
  Entity/graph request types may use this same explicit field and typed progress response where their bounded no-index preparation actually needs it; do not invent another private wire protocol or unbounded point lookup.
- Keep existing data-page shapes and strict nonempty byte-range rules.
  Add explicit typed progress-only responses: detail uses `{kind:"progress", cursor, next, coverage}`; request-based readers use `{kind:"progress", request, next, coverage}`.
  These contain no fabricated content reference, text/range, records or success fact.
  Update shared decoders, typed ports/client correlation and future clients to handle the union explicitly.
- A proof-only next response must preserve exact read identity and advance authenticated semantic phase/address/count, not merely use a new ciphertext/nonce.
  Structural portable validation is not cryptographic or stored-membership verification.
- Extend the private cursor-validation result with an explicit progress-needed disposition when appropriate, rather than calling an unfinished membership proof complete.
  HTTP may continue that read operation, never promote it into execution authority.
  Validation and the actual history step must share one original request budget; any per-request internal context is only accounting, not persistent cursor authority.
- Pack the actual complete response, including echoed/next tokens and escaping, under its existing category limit.
  Paged/progress responses remain512KiB; standalone graph data/Reply and export frames use the existing1MiB control bound while the graph body remains512KiB; see `graph-response-limit-resolution.md`.
  Ordinary hit anchors must strip search progress; direct detail can then advance through its own explicit progress responses if necessary.

## Private Format and Cryptography

New explicit history initialization uses `cadence-history-store/3` at the existing `history-v2/` path and creates one exclusive0600 `read-proof-key.json` first, then publishes the final format marker with existing file/directory durability attempts.
The closed key record binds its storeId to32 CSPRNG bytes in canonical base64url.
Partial initialization stays preserved/refused; no automatic adoption, key regeneration or cleanup.
Recognized format2 remains readonly with its original exact schema/bytes and validation paths, never silently migrated or admitted for new writes/recovery append.
A private streaming exporter can still traverse old format2 across internal quanta without a key; cold stateless old-format search retains honest legacy limits.
No actual deployed new-history consumer needs an automatic migration.

Use native AES-256-GCM: fresh random12-byte nonce per seal, full16-byte tag, versioned canonical base64url envelope, maximum6000 plaintext bytes and8192 final encoded bytes.
Authenticate fully before parsing/dependent use; no partial `decipher.update` plaintext is observable before `final` succeeds.
AAD domain-binds purpose/version, store/workspace/root and the normalized outer request excluding navigation.
Separate search/list/detail/entity/graph purposes; no binding to service epoch/access generation so unchanged historical progress survives restart and renewed authentication.
The key is not provider/browser/local-capability/grant material and cannot authorize admission, launch, receipt conclusions, recovery or lock release.
No key, per-key fingerprint, plaintext private checkpoint, token or raw crypto exception is logged/exported as task history.

A narrowly owned versioned standard SHA-256 checkpoint implementation may expose eight32-bit words, exact bounded byte count and at most63 residual bytes; independently compare it with native SHA-256 across known/random/block/padding/full-segment cases.
Do not use private OpenSSL state, an ad-hoc hash combination, compression/truncation fallback or an incidental new dependency.

## Finite Resumption and Source Truth

Keep output progress separate from snapshot discovery and one active end/overlap/finish/proof worker.
Use finite named phases/source slots, scalar addresses/counters, bounded SHA state and at most1023 overlap bytes, never serialized row/batch/artifact/segment arrays or arbitrary continuation stacks.
Legal large records, many references and required admission files need independently resumable validation stages, not retries of a unit that cannot fit the window.
Repeated bridges advance the same forward validator, not recursive byte-zero scans.
At completion retain exact actual raw size/SHA, highSeq, committed offset/sequence, marker/reference/admission validation and next-segment byte-zero bridge placement.
Missing end remains incomplete; budget exhaustion is not evidence of absence or completeness.

Revalidate current format/key and the relevant original safe file incarnations before resume and proof/result publication; count those reads and repeated source work in the original8MiB/100ms cooperative window.
A changed active predecessor/key/source invalidates state, without silent rebase or invalid-token fallback.
Selected output/end/snapshot batches and artifact bytes still require actual original integrity checks.
Keep unpublished-original-write fences and existing warm/cold prefix/forged-bridge negatives.

This authenticates prior bounded observations under supported-writer immutable-history assumptions, **not an atomic current-byte snapshot of every retired source in an arbitrary archive**.
A fixed token cannot retain all past file incarnations; no directory mtime or valid AEAD tag proves arbitrary older files stayed unchanged forever.
No hostile same-user CAS, change-and-revert detection or execution certification is claimed.
These limits do not permit removing the actual corruption regressions.

Export keeps one bounded private iterator/validator across renewed read quanta, rather than recreating it each time or sealing browser tokens into exports.
Preserve original end/content hashes, exact encoded counts/digest/trailer/EOF and cancellation boundaries.
Do not reset download idle time for private computation or invent empty progress frames to hide a stalled export.

## Finite Readonly POST Transport

Add explicit POST JSON variants on the same named input-bearing reader paths; preserve small GET forms.
Session/workspace remain bodyless GET.
Choose POST before sending for navigation-bearing requests and other inputs that cannot safely fit the original target/header allowance; no failed-GET retry scheme.
Keep route semantics, input location and POST security separate: a body does not make a read a task mutation.
All variants use the same DTO/reader, current cookie/local authorization, exact Host/proxy/Origin rules, and existing browser CSRF policy for POST.
Native capability still requires direct loopback/no browser Origin/forwarding.
Reject mixed query/body, wrong content type/encoding, duplicates, malformed UTF8 and oversized input before reader work.
Header8KiB, body1MiB, read/search/export pools and page limits remain unchanged.
Readonly errors retain effect:none; no grant, command ID, activation, SDK/auth construction or history/index write is introduced.

## Ownership

Main assigns one W3 editor, then one independent checker, the precise cross-owner read fix:

- `src/history/**` and relevant history fixtures/tests.
- W1-owned shared `src/worker-public.mjs` / `.d.mts` cursor field/limit only; capture/model/worker semantics unchanged.
- `src/service/contracts/history.ts`, `src/service-contract.ts`, `src/service/ports.ts`, `src/service-client.ts`: additive request/progress unions and exact correlation.
- `src/service-wire.ts`, `src/service/http.ts`, `src/service-http-client.ts`: finite readonly body transport/accounting only; existing authentication/cancel/export-revocation guarantees unchanged.
- Corresponding shared contract/HTTP tests.

No concurrent editor, new dependency, auth/model/scheduler rewrite, task-state/commit/deployment or unrelated data edit is authorized.
Record new identities and this change against the historical W1 freeze; do not rewrite the original acceptance hashes as if they described new bytes.
Update auth adaptation destination provenance if the assigned HTTP file changes.

## Acceptance Gate

Require actual successful cold/no-index/restarted search and both full exports for the exactly8MiB predecessor, repeated recoveries and long/interleaved end/overlap cases; exact retained owners/ranges/digests and unchanged bytes.
Require cold exact-hit detail via its real progress/data API, not RAM hints.
Keep forged/checksummed bridge, changed active predecessor/key/format, unsafe files, incomplete fields, current-auth/revocation and all existing integrity negatives.
Test maximal legal checkpoint phases/encoded sizes, SHA/native parity, AEAD tampering and unknown states, proof-only semantic progress, old format2 nonmutation, strict readonly POST and no authority crossover.
Run on fresh private disk-backed temporary roots with bytes/inodes checked; no old `/tmp` cleanup or longer native/read budgets.
Independent review and fresh main checks are mandatory; source design reviews and the old LIMITATION pass are not implementation evidence.
