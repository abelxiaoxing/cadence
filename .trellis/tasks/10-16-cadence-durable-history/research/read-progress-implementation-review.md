# W3 read-progress implementability review

## Scope and evidence

Active task was resolved with `python3 ./.trellis/scripts/task.py current --source` to `.trellis/tasks/10-16-cadence-durable-history` (session source). This is a readonly source/design review; the only authored file is this report. No code, tests, installs, Git/status commands, task metadata changes or nested agents are authorized/performed here. No W3 completion or passing-test claim follows.

Read the child manifests/requirements/design/plan, parent PRD/design/implementation plan and both mandatory canonical appendices, `research/w3-progress-repair.md`, and the actual history/files/navigation/search/reader/export and portable HTTP/cursor owners. The parent preservation, bounded-read, committed-source and truthful-evidence requirements remain authoritative. The earlier progress probe's failure is prior reported evidence, not a newly executed observation.

## Confirmed root causes

- `src/history/files.ts:526-554`, `validateRecovery`, starts `scan()` from zero through the predecessor on every call. `scan()` resets every `ScanState` member (355-374); passing an outer cursor cannot resume it. Its `readBudgeted` reserves a whole segment before reading it (214-232). A legal 8MiB segment plus mandatory format bytes cannot fit the unchanged 8MiB window. `scan()`'s tail crossing calls `recoveryAfterTail`, which calls `validateRecovery` again (507-607): repeated recoveries can recursively replay old prefixes.
- `src/history/navigation.ts:491-587,591-698` validates bridge placement, checksum and sequence, but delegates the expensive raw predecessor proof to that restarting function. Even cached batches call `validateBridge`; a warm cache is neither a progress representation nor durable evidence.
- `src/history/search.ts:88-144` encodes only output/snapshot navigation into public UUID/integer fields. The checksum is unkeyed and publicly recomputable. It cannot attest earlier validation, hash state, committed offset or highSeq. `prepare` (190-221) can advance ordinary batch positions but not a suspended nested bridge proof.
- `RetainedScan.ending`, `hasEnd`, `overlap` (`search.ts:333-428`) keep their positions and partial results in locals. Each new scan loses them. The unconsumed output item remains at the same position, so subsequent requests repeat lookahead. `searchHistory` (723-845) treats only changes to `ScanPoint` or hits as progress, and refuses when nested work made no visible output progress.
- `exportHistory` (`src/history/export.ts:130-150,271-349`) reconstructs `RetainedScan` for each read quantum. It correctly retains output hashes and open-field accounting outside that loop, but discards nested lookahead and validation state. An export is a private async iterator, not a browser cursor chain: it can retain bounded internal state without a portable token at all.
- `src/service-wire.ts:160-217` puts all input-bearing readonly operations into percent-encoded query strings and restricts methods by `mutation()`. `src/service/http.ts:502-513` uses that same mutation flag for body decoding; `src/service-http-client.ts:93-115,197-212` does the same. An 8192-byte navigation token cannot fit alongside cursor JSON, URL encoding and ordinary headers in the existing 8KiB header allowance.
- `src/service/contracts/history.ts:550-562` currently rejects a search continuation whose entity/offset fields do not advance. It must recognize token-only progress. `search.ts` spreads the input cursor into exact hits; adding navigation without clearing it there would attach unrelated scan state to detail anchors.

## Direction

Recommend the optional bounded authenticated-encrypted progress field plus **new-initialization-only private format 3**, and a separate finite readonly-POST transport classification. Do not implement it as a MAC over existing caller-chosen cursor positions, a RAM cursor registry, a GET-created index, or an execution capability.

The critical implementation condition is that the token contains **positions and bounded summaries, not pending batches or artifact lists**. A whole-batch checkpoint alone is not sufficient: legal batches have up to `2 * RECORD_BYTES` of rows, a `RECORD_BYTES` marker, and potentially many independently referenced artifacts/admission files. Byte accounting and CPU/decode progress need separate explicit phases. Detailed finite-state recommendations and verification targets follow below.

## 1. Exact checkpoint model

### Public wrapper and private trust

Add `ReadCursor.navigation?: string` (absent on old seeds; nonempty when present; at most8192 UTF-8 bytes). Prefer absent rather than introducing both null and absent normalization rules. W1's actual codec/declaration owners are `src/worker-public.mjs#decodeCursor` and `src/worker-public.d.mts#ReadCursor`; `service-contract.ts` and the TS domain modules re-export them. Do not implement a second TS decoder.

Use a versioned AEAD envelope, for example `rp1.<base64url(nonce || ciphertext || tag)>`, AES-256-GCM with a fresh96-bit random nonce and128-bit tag. Native crypto is sufficient for sealing/opening; no new library or signed browser-session scheme is required. Authenticate before parsing the plaintext. Bind the purpose/version, private format/store/workspace/root identity, and canonical public request with `navigation` removed as associated data. A hash of that canonical request is fixed-size; do not duplicate arbitrary query/sequence strings inside the token. A search continuation and a detail locator need different purpose tags. No service epoch, access-generation or browser-session binding: normal HTTP authorization is rechecked separately, whereas historical progress must survive service restart and token rotation.

The **encoded envelope**, not plaintext JSON, has the8192-byte ceiling. A strict binary/fixed-tuple payload ceiling6000 bytes plus12-byte nonce/16-byte tag fits that ceiling with prefix/base64url overhead; target substantially less. Enumerate exact maximum sizes for each variant before implementation acceptance. Reject unknown versions/keys/enums, noncanonical base64url, duplicate JSON keys if JSON is used, invalid counters and trailing bytes. Never truncate state to make it fit. Encryption is useful even without credentials: raw SHA residual bytes can include a preserved torn/private journal fragment. Tokens must not be logged as public history or included in exported events.

A fresh nonce is **not** progress. Compare a deterministic decoded progress coordinate before/after a quantum, then seal only if work/output advanced. Otherwise return the existing explicit inconclusive refusal. Reject invalid/tampered navigation rather than silently ignoring it and treating its public fields as a new seed. Old navigation-free inputs still use independent validation, not a manufactured `validatedThrough` flag.

### Separate consumers and proof workers

Keep these independent coordinates:

1. **Output**: original batch address, row/event/subslot and text byte offset; advance only after the item/hits were consumed.
2. **Snapshot discovery**: forward source position and proof state, until the actual requested commit is found. Then retain its original batch address and byte identity, not an assertion that every arbitrary earlier pointer is trusted.
3. **End lookahead**: exact begin/chunk occurrence being resolved, forward row/event position and its own proof state. On success retain an original end locator and a digest of its exact detail/owner association; reread that source before use. No `ContentRef` copied from the caller is authoritative.
4. **Overlap lookahead**: current output occurrence, exact next content byte offset, forward event position and at most `queryBytes - 1` (1023) raw overlap bytes. This suffix may end partway through a UTF-8 scalar because it is a byte search buffer, not independently renderable text.
5. **Finish/tail observation**: a real traversal phase, not an exception converted into a fabricated absent end. Preserve accumulated coverage across pages.

Do not require all those workers simultaneously. Snapshot discovery precedes output. End lookup finishes before overlap starts. While output is parked, retain its checkpoint plus **one** active lookahead/proof worker and a return-to enum. A nested bridge pauses that worker's consumer; it must not recursively call a fresh archive scan. Export can retain richer bounded private objects but should use the same validator semantics.

A traversal checkpoint contains scalar facts: current segment and selected observed size/incarnation; next line start/end; complete-line count; batch start/body length; first/last/count; previously committed sequence/offset; highest complete row; segment raw SHA state; batch SHA state; pending validation phase and a few source locators. At a segment transition retain the preceding segment's final size/raw SHA/highSeq/committedSeq/committed offset/tail fact until the next first row has been checked. No array of all traversed segments, bridges, rows, artifacts or open fields belongs in the token.

`decodeSequence` actually permits up to1MiB of decimal text (`worker-public.mjs:240-243`). Do not copy arbitrary decoded sequences into a supposedly fixed-size token. A fully validated sequence in this format is bounded by the number of complete rows in at most999999999999 twelve-digit segments, each at most4096 records: it fits a safe integer. Encode validated counters compactly and compare source decimal values with their exact decimal representation. This is a derived bound for an actually validated contiguous history, not permission to impose a new arbitrary limit on unvalidated public requests. Bind an oversized/unproved requested sequence by its request digest and refuse it if no actual boundary exists.

### Source checks and the limits of attestation

Before resuming partial hash/parser work, reselect its original path through the existing directory/no-follow/descriptor/mode/owner/single-link guards. Compare the observed incarnation tuple (`dev, ino, size, ctime, mtime, mode, uid, nlink`), using the same policy as `read-io.ts`, and preserve format/key identity. Read every new byte through budgeted range IO. Check the active source again after a quantum and before accepting its completed proof. A changed active source invalidates that checkpoint; it must not be rebased onto the new bytes.

A supported append to a snapshot's active segment is not proof of prefix corruption, but also cannot simply bypass the stamp check. Either restart that segment's pinned-prefix verification, comparing the previously authenticated prefix digest before reuse, or return an explicit restartable stale/inconclusive observation. Never silently admit the new size as though it had been hashed. Sealed/recovered predecessors are immutable under the supported writer.

**Important qualification:** a fixed token cannot contain incarnation witnesses for an arbitrary archive. A single `verifiedThrough` integer must not be used to skip all future source checks, and a directory mtime does not detect in-place file changes. Each independent output/end/overlap walker carries its own actually reached prefix state; an arbitrary index pointer or public cursor never inherits that state merely because its sequence is numerically smaller. Revalidate the selected output/end/snapshot batch's original byte identity on reuse, and the active raw predecessor throughout its multi-quantum proof. New navigation-free reads still validate their required original prefix.

This attests prior observations under the existing supported-writer/immutable-history model, not an atomic current-byte snapshot of every already traversed file against a hostile same-user editor. If main intends the stronger rule “changing any earlier traversed file between any two continuation calls must always be detected before any later output,” **this proposal alone is insufficient**. That rule needs an additional resumable source-inventory revalidation pass (with authenticated expected inventory digest), a nonremovable producer source-generation/proof mechanism, or stronger immutable storage. Such a pass still is not multi-file filesystem CAS. Record the precise supported-writer claim; do not conceal this distinction behind AEAD or a stat comparison of only the current file. Preserve the existing cold/warm interior-corruption controls and add active-predecessor mutation-between-quanta controls.

## 2. Legal batch sizes: checkpoint phases, not serialized pending arrays

`RECORD_BYTES = 1MiB +64KiB`; `encodeBatch` permits up to `2 * RECORD_BYTES` of row text plus one marker (`files.ts:664-699`). `batchArtifacts` deduplicates by run/artifact/part, rejects conflicting duplicates and preserves **first-occurrence order** (`types.ts:562-579`). Its result can contain2048 references, each potentially naming a256KiB artifact. Owner rows may also require separate immutable run-admission reads. Thus “verify one complete batch then checkpoint” is not a valid universal8MiB/100ms design, despite the journal text alone fitting the byte window.

### Recommended finite-state validator

Implement a reusable incremental validator, rather than teaching `validateRecovery` to accept a caller-supplied `ScanState`. The administrative unbounded scanner can remain a reference initially; the incremental validator must enforce the same structural rules and have differential tests against it. An internal open/advance/checkpoint API takes authenticated state or a fresh zero state, never an arbitrary public prior-state object.

**A. Raw bytes and line location.** Read bounded ranges (for example64KiB), updating the raw segment SHA. If a line crosses a window, store its start and scanned end, not its partial text. Locate its newline incrementally; once located, a separate phase reads/decodes that one bounded complete line from the original source. This reread is charged too. A legal line fits `RECORD_BYTES`; a final unterminated fragment remains preserved tail, while an oversized complete line refuses. Do not retain an8MiB segment buffer merely to hash it.

**B. Row/marker structure.** Validate one row at a time and update count, sequence, pending-body bytes and batch checksum. Persist immediately at the completed-line boundary, including after a large decode. On a marker, validate count/first/last/previous/checksum and save its source address/hash plus candidate committed boundary. Do not publish that candidate until remaining batch membership checks finish. Empty commits, interior malformed lines, illegal gaps, over-limit pending bodies and record counts still refuse.

**C. Artifact-reference equality.** A token cannot preserve the `Map` used by `batchArtifacts`. Two workable choices exist:

- Fast path: validate/reconstruct one bounded batch in transient memory when it fits this quantum. If metadata verification completes, checkpoint a **source-identity-bound metadata-verified phase**, not the rows/map themselves. Artifact-body/admission verification then uses one source-selected reference at a time.
- General fallback, required if the fast path cannot finish: resumable constant-space exact joins over the source rows and marker. First, for each source chunk occurrence, select one exact reference, locate it in the marker and require equal metadata. Second, for each marker entry, scan the source occurrences for that key, reject conflicting metadata, require at least one occurrence, and record its first ordinal. Require those first ordinals to increase strictly across marker entries. Together these enforce no missing/extra/duplicate references and the existing first-occurrence order, without retaining a set. Each inner scan checkpoints its row/event/marker position and at most one selected reference. It is intentionally a slower fallback, not a new journal format or weakened hash equality.

The slow join has finite but potentially quadratic work. That is a meaningful tradeoff: no fixed number of search requests may be called “complete” instead of traversing it. Do not make the browser/export pay this fallback when a private iterator can retain the already bounded batch/map across quanta. Qualify its actual latency before treating it as adequate UX; there is no measured performance claim here.

**D. Required original files.** Separate admission and, where required by the consumer, artifact verification. Keep source row/event or marker-entry ordinal and one reference, not a pending-file array. Read/check each actual file through the existing bounded helper, then checkpoint the next ordinal. `validateRecovery` currently calls `scan(..., false, ...)`: it validates marker artifact **membership**, not all unrelated artifact bodies, but it still validates required parent-admission files. Preserve that distinction; do not accidentally add hundreds of MiB of unrelated body reads to bridge proofs or skip admission membership. Search/detail/export still verify selected artifacts before publishing their text.

**E. Commit and segment finalization.** Only after A–D succeed advance committedSeq/committed offset. Continue raw hashing through every original byte, including complete uncommitted rows and the final torn fragment. The latter changes raw size/hash but never highSeq. Complete uncommitted rows advance highSeq and must obey the original sequence rules. At EOF retain final raw hash/size and the exact last committed offset/sequence; pending complete rows or fragment set tail.

**F. Bridge.** The next bridge is legal only as the first row at byte0 of segment `previous.segment + 1`, in its required single-row committed batch. Compare *all* of `previous.bytes`, raw SHA, committedBytes, committedSeq and highSeq with the actual completed predecessor state; compare marker.previous and bridge row sequence with that state; call the existing publication fence check. Then advance this same forward validator. A second recovery uses the just-computed next predecessor, not another byte-zero recursion. A bridge from segment0 requires the exact empty baseline. The authoritative scanner's ordinary segment-boundary and tail-without-bridge rules must remain identical.

No effect/admission/receipt lookup may accept a read-progress token as proof of a writable/settled store. This machinery is only a read-progress optimization.

### CPU and hashing details that cannot be skipped

Node `Hash.copy()` is an in-process copy, not a serializable SHA continuation. To retain the current whole-original SHA-256 definition across cold processes, use a narrowly owned/tested incremental SHA-256 implementation exposing eight chaining words, byte count and at most63 residual bytes. There is no valid construction that simply hashes/concatenates independent chunk digests to obtain the existing whole-file SHA. Pin the checkpoint representation to its own version, validate count/remainder relations, and test against native SHA-256 across randomized splits and known vectors. Avoid private OpenSSL/Node internals or an incidental dependency addition.

Budget checks are cooperative, as in the current code: every real read and bounded decode/work unit must be admitted; do not claim synchronous JSON parsing can be preempted at exactly100ms. Crucially, save the completed unit's state **before** the next time check. Repeatedly decoding a large row/marker and throwing before storing any progress recreates the bug. A selected scalar occurrence can be extracted as part of that bounded decode unit; never force its prerequisite decode to be repeated merely to reach the next phase. Every legal phase has a bounded next unit; budget exhaustion returns a distinct advanced state, not a newly encrypted copy of the old one.

## 3. Long fields, exact hits and export

### Lookahead

Replace the three local loops with an explicit suspend/resume operation. Preserve their original occurrence identity: worker/owner origin, detailId, artifact/content ID, owner/task/run/child and requested version/field. A later end for another reused detailId must not satisfy the original begin. Bind found-end locators to the actual original row/event and validated snapshot boundary. Retain only one selected end result/locator across requests; arbitrary interleaving may require repeated finite lookahead, not an unbounded serialized `ends` map.

For overlap, advance through interleaved unrelated events without appending their text. Require the exact next byte offset and same content/origin; only1023 bytes can be pending. Preserve output byte position separately so resumption neither loses nor repeats overlapping matches. Consume a hit's UTF-8 start once; advance to the next scalar boundary exactly as today. Reaching the actual pinned snapshot with no end marks gap/incomplete; budget exhaustion is **not** evidence of no end.

### Public cursor consequences

`decodeSearchPage` must permit identical public output coordinates with a changed nonempty navigation value, while still binding store/scope/query/snapshot and rejecting an identical continuation. The portable decoder cannot decrypt/prove progress; the history owner checks the authenticated monotone state. Do not treat merely changing arbitrary token text as server-validated work.

Exact-hit cursors must not inherit the search-progress token via `{...cursor}`. Either remove `navigation`, or issue a separately bound **detail-locator** variant containing original snapshot/end/chunk locators and exact content association. Prefer the latter for cold, index-free exact-hit navigation: current `sourceHints` is RAM-only and `HistoryReader.selected/parts` otherwise rescan the whole archive. Every locator is checked against actual original batches/parts before reading text.

There is a separate public-contract trap: `DetailPage` currently cannot represent a zero-byte progress-only result for a nonempty field. `range()` requires `end >= start + 1` (`worker-public.mjs:463-466`), and `decodeDetailPage` requires next offset equality plus otherwise identical cursor (`contracts/history.ts:479-499`). An optional navigation field alone does **not** fix arbitrarily expensive no-index detail preparation. If the intended repair includes those direct detail requests, choose an explicit additive progress response variant (cursor/next/coverage, no fabricated content/text), with shared decoder/client support, or prove a genuinely bounded source-locator read path for the exact-hit cases. Do not relax all byte-range validity, label empty content as a page, or run unlimited detail quanta inside one bounded request. This is a main-session API decision, not a silently implemented scope expansion. Search completion and full export can be repaired without claiming this broader detail gap closed.

Search response sizing must count both returned navigation tokens and any per-hit locator tokens, plus cursor echo and worst-case JSON escaping. Existing `pageBytes - 4096` headroom is not enough to reserve an8192-byte continuation (`search.ts:785-791`). Pack the **actual full page** and stop before its next item; do not increase512KiB or assume200 hits always fit.

### Export must use a private resumable iterator

Keep one `RetainedScan`/incremental-validator state for the generator lifetime; replace/renew its **budget** at quantum boundaries, not its logical state. It may retain one bounded journal batch/marker, one selected artifact, bounded end-locator cache, and the existing bounded run/open-field hashes across quanta. No token sealing/key is needed for in-process suspension, and no browser storage is involved. This also permits readonly format2 exports to use the new internal traversal without writing a key or upgrading that store.

Keep `consume`'s original-field accounting in `export.ts:170-268`: hash exact emitted text, enforce contiguous offsets and matching ContentRef, and finalize only on the actual committed end event. Do not delete the open entry when a chunk merely reaches claimed content length. Preserve graph/run/check/review/coverage events, manifest, ordinal/count/digest and exactly one original trailer/EOF. Both Markdown and NDJSON must go through the same retained items. A missing end/corrupt body, cancellation or revocation must not produce a successful completion trailer.

Yield to cancellation between bounded work quanta even during no-output proof/lookahead. Do not reset the HTTP120s idle timer just because private CPU/IO progressed; it is a download-idle bound. The normal private iterator's bounded retained batch/map avoids the token fallback's quadratic scans. If a legal case still cannot produce output within that existing bound, record a blocker rather than increasing it or emitting fake export frames/coverage to keep the socket alive.

`http.ts:677-760` already checks access generation at every bounded output chunk, stops reading after disconnect/revocation, checks the encoded export digest and holds the trailer until iterator EOF. Preserve those semantics; a browser POST does not change them.

## 4. Format3 initialization and format2 preservation

Recommended private layouts (journal/artifact schemas need not change):

- Existing `history-v2/format.json` with `schema: cadence-history-store/2`: retain its exact closed schema and all bytes. Open it through a readonly legacy branch. No key creation or schema rewrite; no assumption that an existing directory is a newly initialized empty store.
- Newly explicitly initialized `history-v2/format.json` with `schema: cadence-history-store/3`: retain storeId/workspaceId/rootIdentity fields; require the separate immutable `read-proof-key.json`.
- `read-proof-key.json`: exact closed schema such as `{schema: "cadence-history-read-key/1", storeId, key}`; `key` is canonical base64url encoding of exactly32 CSPRNG bytes. Keep this path private,0600, and its parent0700. Use existing exclusive-create, bounded no-follow/ownership/link guards and actual file/directory flushes. Do not include the key or a secret-derived fingerprint in public DTOs, journal, diagnostics, exports or worker environments.

Create/flush the key before publishing the final new format marker. Interrupted initialization preserves its partial directory/files and refuses adoption; no cleanup/reset retry. `HistoryFiles.initialize` currently returns an existing opened store (`files.ts:125-145`): that branch must not generate a key or pretend format2 was upgraded. A format3 key that is missing, malformed, replaced, unsafe or from another store cannot be regenerated or substituted with access/local/auth material. Refuse the affected progress path and preserve bytes. New service epochs reload the same key safely; per-boot secrets must not determine cursor validity.

If format2 is selected as readonly (recommended), enforce that at `HistoryWriter` construction and history-recovery append as well as UI messaging; simply declining token issuance while still mutating format2 is not the proposed preservation policy. Reads without progress remain available where independently provable. A retained private export iterator can make multi-quantum progress without a key. Cold stateless search on an old maximum-size recovered format2 archive retains its explicit limitation unless a separately approved non-passive migration/setup is designed. This is preservation of an older prototype, not a claim that the old format acquired format3 capabilities.

There is no equivalent no-common-field repair in the current disk representation: its private format contains no secret, a bridge has only one whole-original SHA, and indexes may be absent. Existing public cursor space cannot carry both general hash continuation plus authentication and overlap. Writer-produced **mandatory** immutable proof nodes with committed roots could change the representation, but optional indexes or a committed hash of caller-supplied state cannot. Merkle inclusion of a saved block establishes membership of that block; it does not by itself establish that the skipped original predecessor bytes are currently intact, or derive exact original highSeq/committed offset. Such a redesign is not the minimal remedy and is not recommended as a handwaved no-field alternative.

## 5. Readonly POST without mutation authority

Keep `mutation(operation)` unchanged: preflight/command/cancel/detach retain their existing admission/attachment/CSRF semantics. Add a separate finite transport classifier for body-bearing **read** operations. Generate POST with JSON on the same existing paths for all input-bearing reads (lists, selected entities/graphs/snapshots, detail/search, receipt/check-obligations, export/download); session/workspace stay bodyless GET. Retain the current small GET forms for compatibility if desired, under the same old target/header bound. Do not auto-retry a failed GET as POST after dispatch; choose the method before sending.

`readRoute` should report the input source (`none | query | body`) explicitly. A read POST accepts no query at all, not query-plus-body with precedence. A GET never accepts a nonempty body/transfer encoding. Mutation POST still rejects query data. Both forms use the same `decodeHttpInput` and same projection method; no alternate generic dispatcher, arbitrary route or execution owner.

HTTP changes:

1. Keep raw target/header validation and authentication **before** decoding private JSON. Existing8KiB headers and1MiB bounded JSON-body/time/concurrency accounting remain unchanged.
2. Decode a read POST with the existing bounded UTF-8/duplicate-aware JSON body helper, not `mutation()` as the criterion for reading the body. Keep read concurrency and search/export slots; it is not exempt just because its method is POST.
3. Preserve cookie/local capability, exact Host, foreign/null Origin and fetch-site restrictions. Require exact allowed Origin for cookie-authenticated read POST; retain native local capability's direct-loopback/no-Origin/no-forwarding rule. This is a transport boundary, not task consent. A read POST need not acquire a mutation grant or execute an attachment action. There is no reason to issue a new auth key/session framework; the existing access check is still required even for a valid progress token.
4. In `HttpServiceTransport`, separate JSON-body/content-type selection from `headers(write)`'s mutation-only attachment/CSRF requirements. Add the same explicit POST body to `export()` (which currently bypasses the ordinary request helper). Keep no-store, same-origin credentials, redirect:error, cancellation and no automatic retry.
5. Keep errors effect:none for a failed readonly POST. Do not mark it dispatched/accepted merely because a body was parsed. Private static/auth/bootstrap and WS routing are unchanged.

An8192-byte token plus a legal1024-byte query/JSON escaping must pass this body route with ordinary headers, while oversized headers and bodies continue to refuse. Enlarging `maxHeaderSize`, shortening/truncating a token or putting it in a new header does not solve the contract.

## 6. Minimal ownership/file map

| Owner/file | Necessary change |
| --- | --- |
| `src/history/types.ts` | Discriminated private format2/3 decoding; unchanged old exact keys; private key/checkpoint schemas either here or the new progress owner. Reuse sequence/artifact/recovery rules. |
| `src/history/files.ts` | Explicit format3/key initialization/read selection; budgeted partial raw proof seam; preserve publication fences, original-file semantics and noncreation. Do not accept a public prior `ScanState`. |
| `src/history/read-io.ts` | Reusable checked incarnation/range-read seam for resumption, without exposing arbitrary caller paths. |
| NEW `src/history/read-progress.ts` | AEAD closed-envelope codec/key selection and finite incremental validation state machine. Keep crypto/progress inaccessible to admission authority. Split a small SHA implementation into its own private file only if needed for auditability. |
| `src/history/navigation.ts` | Incremental next/batch/bridge integration; no recursive restart; hints remain hints and selected original content remains checked. |
| `src/history/search.ts` | Separate output/snapshot/end/overlap state; persistent coverage; token-only continuation; exact page-size packing and safe detail-hit token handling. |
| `src/history/export.ts` | One private retained iterator across read quanta; retain bounded state/hash accounting, cancellation and original trailer semantics. No browser token dependency. |
| `src/history/reader.ts` | Detail-locator consumption and existing strict source checks. If progress-only detail is selected, implement its explicit response variant rather than abusing text ranges. |
| `src/history/writer.ts`, `src/history/recovery.ts` | Small format2-readonly guards if main selects that policy; no new writer proof/index format required. |
| W1-owned `src/worker-public.mjs`, `.d.mts` | One optional bounded cursor field/limit in the actual shared JS codec and declaration; do not modify worker frame protocol or add worker use of the key. |
| W1-owned `src/service/contracts/history.ts`, `src/service-client.ts` | Continuation correlation/size handling, original request echo; any separately selected detail-progress variant. Re-export facade changes only where necessary. |
| W1-owned `src/service-wire.ts`, `src/service/http.ts`, `src/service-http-client.ts` | Separate body/read/mutation classification and same-route readonly POST through existing auth/limits/export transport. |

This is not only a local `validateRecovery` edit. Main should record the format/source-attestation/detail-response decisions and shared-file handoff before its sole-editor implementation. Do not concurrently edit W1 contracts or alter the frozen frame/capture protocol to make a history cursor fit.

## 7. Required discriminating tests (proposed, not executed)

### Progress and original recovery truth

- Reuse the actual full8MiB legal predecessor + final bounded torn line + real bridge pattern from `w3-progress-repair.md`; independent cold Node processes for every search continuation, indexes absent. Require finite completion, exact target hit owner/range/digest and unchanged historical tree, not merely changing cursors or refusal.
- Repeat recovery at least twice with complete uncommitted rows in predecessors. Verify exact highSeq, committed offset/sequence, raw SHA/size and segment/byte0 placement. Exercise segment0, ordinary rollover and recovery after a preserved fragment. No recursive byte-zero replay.
- Keep `service-history-publication-recovery.test.ts:1057` checksum-valid forged-highSeq negative. Add forged committedBytes/committedSeq/size/raw SHA, bridge moved within a segment, wrong segment, duplicated bridge and marker.previous alterations, with recomputed public checksums. None may be converted to complete search/export.
- Mutate/truncate/replace/hardlink/symlink/change mode of an **active predecessor already partially hashed** between continuation processes; verify refusal, no checkpoint rebase and exact byte preservation. Keep the cold/warm later-snapshot/interior corruption controls in `service-history.test.ts:1016-1088` intact. Separately document/test the selected supported-writer attestation scope for already traversed prefixes; do not assert hostile multi-file CAS.
- Force quantum boundaries inside a large line scan, after decoded row, before/after marker validation, during membership joins, between required admission files, between artifact validations, before bridge compare and during finish/tail observation. Include legal maximum pending row text, many tiny rows, large marker, repeated/conflicting artifact keys and enough required files to exceed8MiB. Every legal state fits the envelope ceiling without truncation and advances a meaningful phase/counter.
- Differential completed incremental scans versus original administrative scanner on ordinary/torn/recovered/corrupt fixtures. Check all current source sequence/count/offset/publication-fence rules, not just final digest equality.
- Assert actual per-quantum admitted bytes, bounded reads and no zero-progress nonce churn. Native/cold paths must not depend on module caches, `sourceHints`, parsed-line caches or same-process hash handles.

### Long fields and export

- A retained field larger than a read window, with begin and real end separated by more than one window; dense and sparse/interleaved variants, tiny chunks and UTF-8 boundaries. Test missing end, wrong origin/detailId, gaps, conflicting content version and absent indexes.
- Cross-chunk literal matches requiring up to1023 overlap bytes, with unrelated events/fields between source chunks. Resume while output is unchanged but end/overlap proof advances; assert exact-once overlapping hits and no cross-field false hit.
- Cold exact-hit detail navigation after the searching process has exited and hints are absent. Exercise whichever explicit locator/progress response design main selects; do not count a warm-only hit opening as this acceptance.
- Both NDJSON and Markdown must export the selected long field **in full**, plus its original end/coverage and other selected records. Independently reconstruct exact field text and digest, verify original export counts/digest/watermark/one trailer/EOF. Include legal interleaving near existing open-field bounds. A preview/ring-sized output cannot satisfy the predicate.
- Abort/revoke during proof-only quanta and between output writes. No further history read after cancellation is observed at the bounded boundary; no trailer on incomplete/revoked stream; task execution is unaffected. Preserve existing HTTP trailer/digest/backpressure negatives (`test/service-history-export-http.test.ts`).

### Codec, crypto, old stores and HTTP

- SHA known vectors and split-state round trips versus native SHA, including63/64/65-byte boundaries and the full8MiB predecessor. AEAD tampering in nonce/ciphertext/tag, wrong key/store/scope/query/snapshot/purpose/offset, malformed state and oversize envelope all refuse.
- Restart with the same private key accepts original valid progress; access rotation still requires newly valid HTTP credentials. A progress token alone never authenticates HTTP or enables command/admission/launch/recovery.
- Explicit brand-new format3 initialization creates the one private32-byte key; passive absence and readonly format2 access create nothing. Missing/corrupt/linked/wrong-mode key and interrupted initialization remain preserved/refused. No generated-key fallback, automatic upgrade or byte reset.
- Readonly GET/POST parity for finite readers; maximum legal navigation/query works through POST without changing header/body limits. Reject mixed query/body, duplicate JSON/headers, invalid UTF-8, compression/content-type misuse, cross-origin cookie POST and forwarded/native-capability confusion **before** invoking projection. Test no mutation/preflight adapter calls and effect:none on refusal.
- Preserve per-read/page/reader-count limits, secret canaries, no GET/POST history writes, no on-read index rebuilding, no SDK construction or process launch. Strict old-format fixtures and unrelated bytes must remain unchanged.

## Main-session decision summary

1. **Proceed with** an optional AEAD read-progress envelope, new-initialization-only private format3/key, and same-route readonly POST with transport semantics separate from mutation.
2. **Require** bounded phase checkpoints, two independently positioned walkers (output plus one active lookahead), original raw predecessor validation and nonrecursive bridge traversal. Tokenizing the current `ScanPoint` or an arbitrary pending `ScanState` is not the repair.
3. **Use** one private stateful export iterator across quanta; do not make full exports depend on browser cursor serialization or reconstruct a new scan each quantum.
4. **Record explicitly** the supported-writer source-attestation scope and the additional direct-detail progress decision. Do not claim an8192-byte token supplies an arbitrary archive-wide current-incarnation list, or that current `DetailPage` can carry empty progress.
5. **Gate claims on fresh positives plus existing negatives.** This report supplies implementation recommendations and source-supported failure analysis only. The earlier failure remains failed, the LIMITATION test remains a blocker until genuinely repaired, and W3/parent acceptance remain open.

## Implementation clarifications for the sole editor

### Nonrecursive transition/state sketch

Use a closed union, not a recursively serializable call stack:

| Phase | Durable-in-token progress | Next successful boundary |
| --- | --- | --- |
| `locate-line` | raw read offset/SHA, line start, newline-search offset | newline or original selected EOF located |
| `decode-line` | selected line start/length, raw-source incarnation | one decoded row/marker and its scalar validation facts |
| `row-ref` | batch/row/event address, one selected artifact reference | this occurrence located/equal in original marker |
| `marker-ref` | marker entry index, one reference, source scan address, first occurrence ordinal, previous first ordinal | all occurrences checked and this marker entry accounted |
| `required-file` | original row/event or marker index and one reference | one admission/artifact fully checked |
| `commit` | candidate boundary plus completed validation counters/digests | committed sequence/offset advanced |
| `segment-end` | actual raw hash/size, highSeq, last committed boundary, tail | next original segment selected or genuine EOF |
| `bridge` | just-finished predecessor facts and exact first-row/marker locator | actual bridge comparison complete; advance forward |

An active lookahead's consumer phase (`find-end | overlap | finish`) is separate from this validator phase. It resumes only after `commit` exposes a validated batch. Output can remain unchanged while either phase advances. Do not serialize a deferred Promise, Node Hash handle, parsed row, marker list, graph body or exception as checkpoint state.

A practical fixed binary allocation can reserve:192 bytes envelope-state header, two1024-byte walker slots,512 bytes for the active membership/file submachine,768 bytes for output/snapshot/end/occurrence locators,1024 bytes for overlap length+bytes,128 bytes for coverage/progress counters (4672 total). Store UUIDs/hashes/counters as fixed binary values and enums as numeric tags; store source observations as fixed numeric fields, not arbitrary caller strings. This is a concrete **allocation proposal**, not a measured encoding implementation: implement and audit every field/variant against it before claiming the6000-byte plaintext ceiling. Unused phases consume no variable lists; any overflow means a state-design bug, never authorization to clip a legal history.

Charge metadata/key revalidation and rereads as well as newly traversed raw bytes. Do not rely on `HistoryFiles.open` doing an extra unaccounted key read outside the read budget. A loaded immutable key snapshot can be held privately, but original selected key/format guards still apply on use.

### Avoid a new circular cursor binding bug

When adapting `scanCursor`, remove `navigation` from its existing public checksum input. Construct the outgoing public output/snapshot fields first, then AEAD-seal the private state with those outgoing fields (minus navigation) as associated data. `parseScanCursor` uses the same navigation-excluded checksum; envelope opening separately verifies its authenticated binding. Hashing the old token into the new public checksum and then binding the new token back to that checksum would couple generations incorrectly. Exact-hit detail locators must be freshly purpose-bound to their exact outgoing anchor, not copied from the scanning request.
