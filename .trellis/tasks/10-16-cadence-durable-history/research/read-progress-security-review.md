# W3 read-progress security review

## 1. Disposition and evidence boundary

**ACCEPT the optional encrypted progress envelope and same-route readonly POST direction, with the concrete adjustments below.** This is an implementation recommendation, not acceptance of a working repair. No new human product-choice question is necessary; main owns the explicit W1/W3 design/schema handoff.

Resolved `python3 ./.trellis/scripts/task.py current --source` to `.trellis/tasks/10-16-cadence-durable-history`, source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`. This new file is the only authored artifact. No production edits, installs, tests, services, Git/status changes, consumer credential/store reads, or agents were performed.

Read child manifests/artifacts, complete parent PRD/design/plan and mandatory appendices, `research/w3-progress-repair.md`, relevant specs/guides and actual cursor/wire/HTTP/client/auth/navigation/read/recovery sources. Inspected regression bodies and installed Node crypto declarations. Parent contracts override earlier research.

The progress report's exactly-8MiB predecessor, 785-byte bridge and failed cold-process probe are **prior evidence**, not rerun here. The predecessor plus mandatory metadata cannot fit one 8MiB request; avoiding archive rescans or faster parsing cannot solve this lower bound. The public cursor checksum cannot attest reusable SHA/parser/end proof.

### Decisions for main

| Topic | Recommendation |
| --- | --- |
| Public shape | One optional `ReadCursor.navigation` opaque string, at most 8192 **encoded ASCII bytes**, absent on seeds and ordinary exact-hit detail cursors. No public proof object or arbitrary arrays. |
| Confidentiality/integrity | Native AES-256-GCM, dedicated random 32-byte store key, fresh random 12-byte nonce per seal, full 16-byte tag; verify before interpreting plaintext. No MAC-only payload. |
| Persistence | New explicit setup writes private format revision 3 and its exclusive private key. Recognize revision 2 for readonly legacy behavior; no automatic migration, key adoption, repair or reset. |
| Source truth | Authenticate earlier bounded work, then revalidate current key/format and relevant source incarnations; still validate actual markers, bridge placement, final predecessor facts and selected artifacts. Supported-writer/non-atomic guarantee only. |
| Transport | Finite readonly POST variants on the existing named reader paths, same DTOs/output/auth plus browser Origin/CSRF checks, existing 1MiB body limit. Preserve old small GET. Separate body/CSRF policy from execution-mutation classification. |
| Acceptance | Positive cold/no-index completion and exact retained results/exports, together with existing corruption negatives. Ciphertext changes, advancing outer cursors and safe refusal alone are not successful progress. |

## 2. Actual source map

- `src/worker-public.mjs:995-1028`, `src/worker-public.d.mts:466-477`: closed cursor decoder/declaration; the TS facade is not the executable owner.
- `src/history/types.ts:50-66`: format 2 has no secret; recovery references whole-byte hash/size/sequence, not block proofs.
- `src/history/search.ts:91-146,326-438`: public-checksum cursor and nonresumable local end/overlap scans.
- `src/history/files.ts:354-550`: authoritative canonical/sequence/checksum/reference scan; even `verifyArtifacts=false` checks required admission files. Recovery restarts that scanner through its predecessor.
- `src/history/navigation.ts:488-698,733-839`: actual marker/bridge placement, snapshot and publication checks. Caches are locators, not persistent proof.
- `src/history/files.ts:77-91`, `src/history/read-io.ts:21-85`: shared native byte/time admission and non-atomic descriptor/path hygiene.
- `src/service-wire.ts:76-78,161-212`, `src/service/http.ts:185-202,360-526`, `src/service-http-client.ts:77-143`: 8KiB target/headers, 1MiB body, authentication-before-JSON, and mutation/method/body/CSRF coupling.
- `src/history/export.ts:126-161,176-371`: scans are recreated between windows; original content hash/end/trailer checks must survive the repair.

## 3. Encryption and bounded decoding

### Accept AES-GCM, not MAC-only state

The risk is not just forging a boolean. Standard SHA continuation contains up to 63 unprocessed source bytes. Recovery scans traverse private accounting/unselected records and preserved torn bytes, not only the public selected transcript. Parser buffers and overlap can also contain text not selected for publication. A MAC authenticates those bytes but does not hide them. Base64 is not encryption.

Use native AES-256-GCM rather than a handwritten cipher. Keep one private progress-key purpose: it is not an owner token, cookie signing system, provider credential, per-boot local capability, grant key or receipt key. Do not derive it from UUIDs, file hashes, history digests, provider/access secrets or process identity. Do not pass it into workers or child/check environments.

Use a fixed version prefix plus canonical unpadded base64url of `nonce || ciphertext || tag`; no caller-selected algorithm/tag length/key paths. Every seal needs a fresh cryptographic nonce, including identical progress and after restart. A restarted RAM counter is unsafe under the durable key. Random nonces provide probabilistic, not absolute, collision resistance.

**8192 bounds the final string, not plaintext.** A `v1.` prefix, plaintext cap 6000 bytes, 12-byte nonce and 16-byte tag fit after base64url encoding. Check actual maximal state/framing sizes before publication; no compression/truncation fallback.

Decode in this order:

1. Ordinary current HTTP authorization first. Portable closed cursor decoding admits only the bounded optional opaque string; it does not establish proof validity.
2. Check exact prefix, canonical base64url alphabet/length/round-trip encoding and minimum/maximum decoded lengths before allocating/decrypting. Reject padding aliases, whitespace, junk suffixes, truncation and oversize.
3. Load/revalidate the current selected private key and format; reconstruct fixed canonical AAD from the decoded outer context.
4. Set the full expected tag/AAD and complete native GCM authentication. **Do not parse, log, dispatch on, or expose the bytes from `decipher.update` before `final` succeeds.** On failure discard partial plaintext and return a fixed refusal, not an OpenSSL exception or supplied token echo.
5. Only then strict-parse the bounded plaintext, reject duplicate/extra keys, invalid UTF-8, unknown versions/phases, unsafe numbers and impossible relationships. Successful GCM authentication does not excuse decoder/state-machine validation.

Absent envelopes may use the stateless path; invalid present envelopes must not downgrade to it or become an absent-index fallback.

### Domain binding

AAD should have an unambiguous canonical encoding containing a fixed domain such as `cadence-history-read-progress/1`, envelope version, store/workspace/root identity and the **entire normalized outer cursor excluding `navigation`**: scope kind/id, exact query bytes/null, snapshot sequence, record ID/version, field and offset. Include a finite purpose discriminator so a search progress token cannot be interpreted as detail, export, receipt or recovery authority. Do not normalize case/Unicode/whitespace in the query.

Also bind actual snapshot address/marker identity, format/key incarnation and source identities inside the encrypted state. Reject changed context/cross-store transplantation; caches require the same bindings.

Do **not** bind historical progress to service epoch/attachment/access generation. Authenticate the current caller independently: rotation invalidates access, while a newly authenticated owner may reuse unchanged historical progress after restart.

## 4. Key lifecycle and smallest honest compatibility rule

### New explicit setup

Use a bounded closed `read-proof-key.json`: fixed schema, `storeId`, canonical encoding of exactly 32 random bytes. Reuse private single-link/no-follow/current-owner/0600-file/0700-directory hygiene. No keyring/rotation service or account mechanism is needed.

Revision 3 identifies this setup. The existing `history-v2/` path and journal/bridge layouts can remain; the manifest revision determines key semantics.

Create only from the explicit new-history setup under the original lease. `HistoryFiles.initialize` currently returns an existing store unchanged (`files.ts:125-146`); revise its compatibility outcome deliberately, not by inserting key creation into `open` or a read accessor. Both key and manifest require exclusive creation and durability attempts before writer acceptance. No multipart atomicity claim: interrupted setup stays an incomplete preserved store and refuses automatic completion. Existing directory/unknown contents cannot become permission to initialize a fresh key over them.

### Current-key changes

A warm reader must not keep accepting/sealing with a cached key after its selected file changed or disappeared. Revalidate the exact format/key bytes and file identity before resumption and again before publishing a newly issued progress token/result that depends on it. Account for these reads in the same request budget; do not charge only journal bytes.

Bind key incarnation inside encrypted state. Different bytes fail GCM; identical bytes in a replacement inode must invalidate old progress too, including cold reopen. Test same-byte replacement, permissions/links and format replacement, not just wrong secrets.

On missing/corrupt/linked/replaced revision-3 key: no generation, reset, fallback secret, silent adoption or old-key RAM grace. Refuse affected progress and unsafe writer admission while preserving bytes/fences. Key-independent stateless history reads can remain available where their own original-source validation succeeds; this is not permission to accept a submitted invalid envelope by ignoring it. Losing the progress key does not make retained history disappear or resolve old execution uncertainty.

### Compatibility recommendation

| Selected state | Behavior |
| --- | --- |
| No history namespace | Passive open remains absent. Only explicit new setup may create revision 3/key. |
| Valid revision 3/key | New writer and encrypted progress allowed through their existing independent admission rules. |
| Recognized revision 2 | Readonly using existing original-source validators, including honest bounded refusal where progress cannot finish. No key creation, automatic migration or new writes/recovery append. |
| Revision 2 plus submitted navigation token | Refuse unsupported progress; do not infer a key from some other service credential. |
| Revision 3 with missing/unsafe key | Preserve/refuse affected operation as above; never reinterpret as revision 2. |
| Unknown/partial format | Preserve/refuse; no adoption or cleanup. |

No actual new-history consumer requires a migration mechanism. Task-v1 compatibility stays separate/unchanged. Format-3 fixtures must satisfy positive W3 acceptance; old bounded refusals cannot be relabeled repaired. Existing small legacy reads remain; old-store upgrade/recovery setup is not proposed.

`src/history/recovery.ts:38-82` currently hashes **all** private history files, including any newly placed key file. This is not a raw key export and an aggregate SHA over a high-entropy key is not, by itself, a demonstrated key-recovery attack. Still inventory this new secret-bearing input: keep recovery accounting private, never publish the key/per-key fingerprint or diagnostic file bodies, and do not silently exclude the key from recovery freshness without an equivalent private exact-current check. `usage()` should continue counting its bytes. Navigation authentication must never be accepted by `HistoryRecovery.append` in place of its local authority/unchanged-fence checks.

## 5. Finite proof states and real progress

### Serializable SHA is algorithm state, not `Hash.copy()`

Installed Node crypto declarations expose `Hash.copy()` for in-process copies; they do not provide a portable cold-restart state export/import API. Copying an OpenSSL object, serializing a digest, or using a secret-derived ad hoc hash does not resume standard SHA-256.

Standard SHA-256 state has eight unsigned 32-bit chaining words, bounded exact byte count and <=63 pending bytes, with `pending.length === count % 64`. Specify count semantics, endianness and standard padding; reject impossible states. Use a reviewed serializable standard implementation, not a new hashing scheme or serialized OpenSSL object. No install is authorized. Compare split/resume/padding results independently with native SHA-256; encryption cannot validate a faulty algorithm.

### A bounded state model

Keep outer publication position separate from one nested read-work position. A workable finite discriminated model is:

- `snapshot`: forward original membership proof up to the exact selected commit;
- `predecessor`: raw predecessor hashing plus structural validation progress, with a finite return purpose (`snapshot`, `scan`, `find-end`, `overlap`, `finish`), not an arbitrary continuation stack;
- `find-end`: one target origin/detail/content occurrence and forward row/event address, plus the unchanged outer source item;
- `overlap`: the same exact target, next expected stored offset, forward address, and at most `queryBytes - 1` (1023) accumulated overlap bytes;
- `scan` / `finish`: ordinary outer traversal or final snapshot/tail revalidation, with finite coverage facts.

W3 owns the closed union, address bounds, invariants and transitions. Repeated recoveries feed one forward validator, not recursive rescans. Use fixed named source slots (format/key, snapshot, active segment, target/origin/end), not growing segment/detail/batch/artifact lists.

For the predecessor proof, retain raw SHA state/byte offset separately from structural high-sequence/last-commit/committed-offset/tail facts. Checkpoints cannot merely assert those facts because the whole-byte digest eventually matches: both actual parsing and hashing must have advanced over the same source incarnation. Check the next bridge at its real segment `previous.segment + 1`, offset zero, and validate its real marker/count/sequence/checksum/publication boundary.

At completion compare **all** original predecessor fields: full size, full SHA, actual committed offset, committed sequence and highest complete row, including valid uncommitted rows and preserved final incomplete bytes. A final fragment is not a complete JSON record; an invalid complete interior line is not a recoverable tail. Preserve the scanner's existing distinction rather than accepting a caller-chosen boundary.

### Do not serialize a batch to solve parser resumption

A journal record can exceed 1MiB (`RECORD_BYTES = 1MiB + 64KiB`); a bounded batch can exceed an 8KiB token, and `CommitMarker.artifacts` permits many references. Therefore copying `pending`, rows, marker artifact arrays or an entire partial JSON line into the token is not a viable implementation.

Prefer checkpointing complete validated batch/record boundaries and re-reading the bounded active source unit to reconstruct temporary arrays. If work must pause within dependency/admission/marker validation, store only the source address, phase and scalar row/event/reference index; reconstruct and revalidate from the real selected batch before continuing. Preserve exact artifact-set equality/conflicting-duplicate checks rather than replace them with counts, and retain required admission-file verification. Raw tail hashing can advance by bounded byte chunks without carrying the raw tail as parser state. A dedicated partial-parser state, if necessary, must be a finite closed state machine, not a dumped JSON parser object.

Budget repeated reads and cold decoding. If the smallest retried unit cannot fit 100ms/8MiB, refine finite parser/proof stages, not ceilings/timeouts/acceptance claims. Static review does not prove maximal-record CPU progress.

### End/overlap correctness

The retained end must come from its actual committed batch at or before the snapshot, with the exact origin, detail ID, content record/version/field and task/run/child/entity association. Re-read/validate its source when using a retained end result; an encrypted `ContentRef` alone is not current membership authority. A found end is not proof that every artifact body matches its aggregate hash.

Keep the outer item unconsumed while nested end/overlap proof advances. Zero-hit pages may advance proof only. Overlap requires exact next UTF-8 byte offsets in the same field, never interleaved fields/gaps. Preserve scalar boundaries and exact query-byte hit ranges. Snapshot reached without an end means incomplete/gap, not fabricated completion.

Persist the finite accumulated coverage needed by the continuation; do not let a new `RetainedScan` forget already observed omissions and later report whole-scan completeness. During final checks, an exhausted proof is unfinished navigation, not evidence that the source is complete or truncated. Export's original per-content hash/byte accounting and actual end/trailer rules stay independent. A live export can retain bounded private progress in RAM between its windows; it need not expose internal encrypted navigation in exported records or change `ExportRequest`.

### Monotonic progress is semantic

Today `searchHistory` accepts an inconclusive window only if the outer `ScanPoint` changed; `decodeSearchPage` also rejects unchanged outer position (`search.ts:741-845`, `contracts/history.ts:530-600`). Both require the handoff. Permit a continuation with unchanged outer position when authenticated **nested work** advanced. W3 must compare phase/address/count advancement, not token string inequality: fresh GCM nonces make identical state look different and could otherwise mask an infinite loop.

Readonly replay may repeat work/results, never effects; no single-use registry is needed. Require bounded calls and positive completion on stable sources, not an arbitrary empty-success cutoff.

## 6. Revalidation and honest filesystem guarantees

Authentication says this store previously issued these proof facts. It does **not** say the backing files still have the same bytes.

For every resumed proof, validate safe directories and the relevant original regular single-link file descriptors/path stamps, binding device/inode/size/mode/owner/link count/ctime/mtime (or the existing platform equivalent). Check before and after native reads and before proof/result publication. Revalidate format, current key, original snapshot marker, active predecessor, and target/end sources whose previously observed state is being reused. Re-read actual selected artifacts and compare their recorded lengths/hashes before publishing text. Preserve in-process unpublished-write fences; a token cannot make an unsynced marker durable.

A replaced/truncated/edited predecessor must invalidate the accumulated SHA state even if the remaining suffix would make its old digest match. Same-size edits and changed bridge highSeq/committedBytes/placement must not slip through. On any relevant incarnation change discard/refuse the progress; never silently rebase to a newer snapshot or mint “completed proof” for old bytes. A fresh seed may start new proof against an explicitly selected snapshot through normal read behavior.

Distinguish sealed sources from a live segment that can append beyond the selected commit. For exact predecessor proofs, any size/stamp change invalidates the proof. For a selected immutable subrange of an appendable segment, either conservatively invalidate progress or explicitly re-prove the old selected range under the budget before continuing. Do not ignore changed size/mtime as “probably just append.” Conservative refusal can interrupt a continuation during active writes; document it and keep the selected historical identity unchanged rather than promise uninterrupted progress during arbitrary concurrent churn.

**Limit the claim:** a constant-size token cannot retain and recheck an unbounded archive's complete incarnation set, and a single current-file stamp/directory mtime is not such a set. After prior source slots are retired, reliance on committed segments staying unchanged is the existing supported-writer assumption. Metadata checks do not prevent privileged/same-user change-and-revert, stamp collisions or races after validation, nor make a multi-request filesystem snapshot atomic. Do not claim that encrypted progress detects every later edit anywhere in a previously scanned archive. If that stronger property were required, this representation would need a different source/proof contract; it is not provided by AES-GCM.

Keep the existing **actual** warm/cold corruption controls intact rather than using this qualification to delete them. In particular, `test/service-history.test.ts:1016-1121` first proves successful cold/warm detail reads then changes snapshot/interior journal data and expects rejection; `test/service-history-publication-recovery.test.ts:1054-1091` recomputes a checksum around forged recovery highSeq and still requires refusal. Extend these to changed source/key between encrypted continuations.

## 7. Concrete shared-code pitfalls to adjust

1. **Shared codec owner.** Add the optional field/limit in the maintained JS owner and `.d.mts`, and propagate through portable facade/client/response tests. Choose one no-envelope representation; omission with `navigation?: string` is the smallest rule. If null is also accepted, normalize it once in that shared decoder. No frontend-local token interpretation.
2. **Search reply progress.** The current outer-only next-cursor ordering rejects legitimate proof-only pages. Permit the new structural shape without calling the portable decoder a proof verifier; W3 enforces authenticated semantic advancement.
3. **Exact hits must strip navigation.** `searchHistory` currently constructs hit cursors with `{ ...cursor, recordId, recordVersion, field, offset }` (`search.ts:797-810`). With the new field this would copy an outer-bound encrypted token onto a different record, causing invalid AAD and leaking unnecessary private progress to detail/navigation/export. Construct an ordinary hit cursor explicitly with no envelope. Preserve content versus entity versions and exact byte ranges.
4. **Validation is operation-aware.** `HistoryProjection.validateCursor` currently tries `parseScanCursor` then falls back to detail for query-bearing cursors (`projection.ts:796-819`). A present invalid/tampered navigation token must not enter that fallback. Reject progress on unrelated detail routes rather than reinterpret it as an ordinary cursor. Search validation must not perform a second full independent source scan before the real shared-budget scan.
5. **Whole DTO size.** Existing search accounting reserves about 2KiB initially and 4KiB near the page bound. Two 8KiB progress strings (`cursor` and `next`) exceed that slack. Count the actual complete response, including both envelopes and escaping; stop adding hits earlier without truncating a token or a retained field. Ordinary hit cursors must not multiply the envelope by up to 200 hits.
6. **No-index exact detail is still independent.** `HistoryReader.selected/parts` (`reader.ts:230-374`) can require a full prefix, and `detail` independently proves the snapshot (`reader.ts:435-505`). The search envelope does not automatically repair all cold no-index exact-detail paths. Keep ordinary hit cursors envelope-free as requested and verify the required cold exact-hit fixture explicitly. A smaller prior cold fixture or warm `sourceHints` is not evidence for arbitrary long no-index detail. If this still blocks the concrete acceptance case, report that remaining source-address/progress gap rather than silently attach search proof to hits or weaken membership checks.
7. **No authority crossover.** Admission/receipt lookup, launch/settlement, `appendRecovery`, lock release and auth writeback must not consume browser-supplied proof states. Sharing a bounded parser implementation is fine; sharing a “trusted by encrypted cursor” shortcut into those authorities is not.

## 8. Transport: same routes, finite readonly POST

An 8192-byte envelope exhausts the 8KiB target allowance before JSON/percent encoding/path/query overhead. Do not raise the header bound or move progress into cookies/Authorization/custom headers; cookie/header overhead still matters.

Add readonly POST to a finite allowlist of the **same** existing named reader paths. The minimal needed path is `/api/v1/search`; `/api/v1/details` can use the same body transport for large ordinary cursors. Other existing request-DTO readers may be included through an explicit reviewed allowlist, not an arbitrary operation/path endpoint. No new generic `send` API, `/read` dispatcher, mutation replay or DTO fork is needed.

The wire descriptor needs separate concepts:

- operation semantics: reader versus preflight/command/cancel/detach;
- transport input location/method: GET query or POST JSON body;
- request security: POST requires the existing browser exact Origin and CSRF checks, independent of whether it has execution effects.

`mutation(operation)` currently controls all of these at once. Do **not** mark search/detail as mutations to borrow body parsing. Preserve readonly concurrency accounting (`reads`, two searches/two exports), no grant consumption, no accepted/uncertain execution-effect reporting, no command ID and no activation. A read POST must never route through admission.

Server requirements:

- Authenticate cookie/native capability and enforce Host/proxy/Origin/fetch-metadata/CSRF before parsing private JSON or decrypting progress. Native capability still requires direct loopback/no browser Origin/forwarding; a body field cannot supply authority.
- POST only on the named allowlist, with **no query input**, exact `application/json`, no content encoding and existing byte/count/time body admission. Reject mixed query/body, duplicate keys, duplicate headers, malformed UTF-8 and over-1MiB input. GET retains its existing no-body/small-target policy.
- Decode the same DTO and dispatch to the same reader. Recheck current access generation after awaited reads and before response; exports keep every-chunk revocation/cancellation and missing-trailer semantics. Keep no-store/no-referrer/fixed errors and do not log request bodies/cursors/query text.
- Requiring a live attachment for readonly POST is not intrinsically necessary for source authority; whichever existing session/CSRF policy main selects must match the client and never create/renew an action grant. A simple explicit session bootstrap followed by read POST is sufficient; no hidden session refresh is needed.

Client requirements:

- Choose POST deterministically **before** sending for navigation-bearing cursors, even if a particular small token could fit GET. Preserve small GET for old no-envelope requests. Do not optimistically send an oversized URL and retry a different method after failure.
- Use existing session-provided CSRF and same-origin credentials; do not add provider/access-token query overlays or redirect follow. Missing/stale session yields an explicit failure, not automatic preflight/action retry.
- Keep typed `search`/`detail`/other named methods and existing request/reply correlation. The internal finite HTTP helper does not become a public arbitrary sender.

Actual HTTP, not just direct-reader tests, must accept maximal POST envelopes with cookie/CSRF overhead and reject oversized GET without disclosure.

## 9. Concrete acceptance constraints, not executed here

These are the discriminating checks for the proposed repair, not new certification machinery or a generic security wishlist:

1. **Original positive blocker:** real legal exactly-8MiB predecessor plus real recovery bridge; no indexes, readonly tree, separate cold processes per continuation. Finish at the original snapshot with the exact expected hit/content digest, not only moving cursors. Repeated recoveries must not restart recursive byte-zero proof.
2. **Long nested progress:** long/interleaved fields whose end/overlap crosses windows; zero-hit proof-only pages, UTF-8/query boundary match, no cross-field match, missing end remains incomplete. Stable ordinary exact-hit detail cursor opens the actual retained text after cold restart. Both export formats cover selected scope, original content hashes/counts and truthful trailer/coverage with unchanged source bytes.
3. **Token controls:** wrong key/store/scope/query/snapshot/outer offset/purpose; flip nonce/ciphertext/tag; truncated/oversized/noncanonical base64; unknown phase/version and impossible decoded SHA/offset states. For schema-invalid authenticated plaintext, use explicitly injected fixture keys to test the private decoder. Refuse without fallback, raw exception, source writes or unrelated body reads.
4. **Source/key controls:** after genuine progress, edit an already hashed predecessor prefix, replace the key (different and identical bytes), delete/link/chmod key, replace format, alter bridge highSeq/committed offset/placement and recompute its unkeyed checksum. Test warm and cold paths and final-check timing. Existing successful-read-then-corruption negatives remain negative; unchanged key/source survives an owner restart.
5. **Boundedness:** actual encoded token <=8192 for every reachable maximal state, not only an average sample. Native IO including repeated metadata/admission/artifact reads stays <=8MiB/window; 100ms cooperative checks remain. Require semantic phase advancement and no regenerated-identical-state loop. Standard SHA split/resume results match native digests around block/padding boundaries and large inputs.
6. **Transport/auth independence:** same-route POST round-trip of maximal state, small GET compatibility, strict body/query handling, wrong/missing/rotated cookie/CSRF/Origin and read revocation. A valid progress token without current access cannot read anything, preflight, launch, settle, recover or release a fence. POST errors still report no execution effect.
7. **Preservation/compatibility:** revision-2 bytes remain readable where supported and never migrated; incomplete revision-3 setup/key failures do not regenerate. Passive GET and readonly POST create no key/index/checkpoint/task or SDK/auth/session effects beyond ordinary HTTP attachment state. Denied writes/quota conditions do not silently truncate history or turn incomplete export into success.

The unchanged LIMITATION test at `test/service-history-publication-recovery.test.ts:1093-1134` documents safe refusal, not completion. Its replacement positive assertion requires a demonstrated repair while retaining its original failure evidence. This review ran no suite, helper, formatter or crypto/HTTP experiment and claims no passing lane, repaired source or W3/parent completion.

## 10. Handoff and reviewed source identities

Main owns the canonical revision-3/field/POST handoff and single-editor assignment. W3 owns private proof/SHA/source validation and fixtures; W1 owns shared codec/declaration/reply correlation and wire/HTTP/client policy. This review took no shared-file ownership.

SHA-256 values observed after source inspection (not execution evidence):

| Path | SHA-256 |
| --- | --- |
| `src/worker-public.mjs` | `7b9db72f4ec299d339bd84b68f16b2c5c31ff0596d567c752d5a9c3fe2680ca3` |
| `src/service-wire.ts` | `96af240b17bfa8d6cbe0f2285a332544df91e710ee836aa224fa1a52daca4bb1` |
| `src/service/http.ts` | `5a09abed7628af7dd553e61b130fd7149f21422efde37d2d82779eaf4483ac9e` |
| `src/history/files.ts` | `33b34b379e36a1935f1ff6a7694f6b95f504938a2c7f190288db631db0378138` |
| `src/history/search.ts` | `e52322c224f584905f35bd7eaa32f615c9068116033fa2504b4fa68f2406a8f5` |
| Parent `design.md` | `98e4db2bfafd5ac8c1fbe50568114366d81610eec734f7414d5e19dea29a4310` |
| Parent `design-runtime-history.md` | `5c02f848eb9c7b6943cc778d205eadcb3f739087f64bf56a16ae4ab3f77ab63f` |
| W3 `research/w3-progress-repair.md` | `c63391f5658a6fb60ff18c768a4d939c1071f5e5bb182224498b97197a121545` |

**Bottom line:** the design direction is acceptable with current-key/source revalidation, genuinely finite resumable proof, shared codec/transport changes and explicit compatibility limits. AES-GCM fixes caller forgery/confidentiality of carried state; it does not alone fix parser progress, historical membership, access authorization or exact-detail availability. Those remain real implementation/acceptance work.
