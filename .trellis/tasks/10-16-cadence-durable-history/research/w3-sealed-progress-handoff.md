# W3 sealed progress — implementation pass 1 (incomplete)

## Disposition

**The selected read-progress repair is NOT complete.
Continue implementation immediately; no new routine approval is requested.**
This pass implements the shared transport/reply and private format/crypto/SHA prerequisites, not the finite resumable history validator.
The mandatory exactly-8MiB predecessor, repeated-recovery, long end/overlap, cold exact-hit detail and complete-export positives remain blocked by the existing traversal.
The old `LIMITATION` refusal test remains in the suite and is **not feature acceptance**.
No W3/parent acceptance, task-status change, release, deployment or independent review is claimed.

Exact final source hashes, checks and preserved log hashes are in [w3-sealed-progress-checks.json](w3-sealed-progress-checks.json).
All previous freeze/source/evidence hashes remain historical and unchanged.

## Implemented source boundaries

| Paths                                                                      | Actual implementation                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/worker-public.mjs`, `.d.mts`                                          | Optional bounded ASCII `ReadCursor.navigation`; shared `decodeNavigation`; `LIMITS.navigationBytes = 8192`. Ordinary cursors retain their old shape. No capture/model/worker protocol change.                                                                                                                                                                                                                                                    |
| `src/service/contracts/history.ts`, `src/service-contract.ts`              | Optional `ListRequest.navigation`; additive `DetailReadResult` and `HistoryReadResult` unions and decoders; exact identity/progress correlation; search permits structural token-only next cursors; exact hit anchors cannot contain navigation. Original data-page schemas and positive byte-range requirements remain.                                                                                                                         |
| `src/service/contracts/domain.ts`                                          | One compatibility-shim re-export of `decodeNavigation`. This necessary propagation line was not named separately in the editor handoff: the existing exact exported-value closure test exposed the omission. No second decoder or behavior lives here.                                                                                                                                                                                           |
| `src/service-client.ts`, `src/service/ports.ts`                            | Typed data-or-progress detail/list results; exact response/request correlation; explicit `progress-needed` cursor-validation disposition. Client never loops unlimited read quanta or retries actions.                                                                                                                                                                                                                                           |
| `src/service-wire.ts`, `src/service/http.ts`, `src/service-http-client.ts` | Explicit finite same-route readonly POST allowlist; separate body transport, POST security and mutation semantics; deterministic client selection before sending; explicit existing session/attachment/CSRF for POST; GET compatibility.                                                                                                                                                                                                         |
| `src/history/types.ts`, `files.ts`, `writer.ts`, `recovery.ts`             | New initialization uses private format3 and exclusive0600 random32-byte key, key fsync before final manifest. Partial setup refuses. Recognized format2 opens readonly, never initializes a key, admits a writer or appends recovery. Existing writer operations revalidate their originally decoded key incarnation.                                                                                                                            |
| `src/history/read-io.ts`                                                   | Descriptor/path/permission guarded immutable-file incarnation check, using the existing private-file tuple. No payload allocation/read for the writer's already-decoded key guard.                                                                                                                                                                                                                                                               |
| `src/history/read-proof.ts`                                                | Private native AES-256-GCM primitive: fresh12-byte nonce, full16-byte tag, canonical `rp1.` base64url, plaintext6000 and final8192 bounds, complete authentication before returning plaintext. Current format/key are read and revalidated within the supplied original budget before and after use. AAD binds purpose/store/workspace/root, normalized request digest and original format/key incarnations; no epoch/access-generation binding. |
| `src/history/sha256-state.ts`                                              | Standard SHA-256 with eight uint32 words, bounded exact byte count and <=63 residual bytes; strict checkpoint decoder. Native known/random/split/block/padding/full8MiB differential tests pass. This is not yet wired into journal proof traversal.                                                                                                                                                                                             |
| `src/history/search.ts`, `reader.ts`, `projection.ts`                      | Navigation excluded from the old public scan checksum; exact-hit construction strips navigation. **Until the finite validator is composed, every submitted navigation token is explicitly refused by production readers**, never ignored or downgraded to an ordinary locator.                                                                                                                                                                   |
| `provenance/auth-reuse.json`                                               | Assigned HTTP destination hash updated to the final body. Source lineage and all other destinations retained.                                                                                                                                                                                                                                                                                                                                    |
| `test/service-history-progress.test.ts`                                    | 21 new controls: actual HTTP with injected projections; portable reply correlation; real temporary-file format/key/incarnation preservation; native crypto and SHA differential tests.                                                                                                                                                                                                                                                           |

The crypto primitive returns authenticated private bytes, not validated journal membership.
There is deliberately no production token issuer or accepting checkpoint parser in this pass.
Do not connect arbitrary decrypted objects to existing `ScanState` or use the public checksum as proof.
Entity/graph navigation/progress variants have not been added yet; determine their actual bounded preparation needs when composing the validator.

## Concrete API usage

```ts
const reply = await client.detail(cursor);
if (reply.kind === "ok") {
  const value = reply.value;
  if ("kind" in value && value.kind === "progress") {
    cursor = value.next; // another explicit bounded read; no content/text exists here
  } else {
    render(value.text);
    cursor = value.next;
  }
}
```

List methods similarly return a data page or `{kind: "progress", request, next, coverage}`.
Search keeps its existing page shape and may structurally represent zero hits with token-only advancement.
Portable decoders enforce exact outer identity and a changed nonempty token, **not** semantic advancement or cryptographic validity; the unfinished history owner must enforce those.
Both original data and progress decoders bound the entire encoded response, including both echoed and next tokens.
Actual producer-side response packing still needs to account for those envelopes when the new traversal emits them.

`wireRequest(operation, input)` chooses POST for any navigation-bearing input and for encoded GET targets exceeding2KiB (headroom under the unchanged8KiB header bound).
It never first sends an oversized GET, retries, refreshes a session or adds query credentials.
`session`/`workspace` stay bodyless GET; the named input-bearing readers use their existing DTOs on either GET or POST.
Readonly POST authenticates and checks Origin/CSRF/attachment before body decoding, retains readonly capacity/effect:none, and cannot enter admission merely because it carries a body.
The existing export digest/trailer/EOF/revocation transport remains; a large-input POST export was exercised against an injected two-frame fixture, **not** full retained-history export acceptance.

## Native regression found and repaired in this pass

The first broad run had two failures: the missing compatibility-shim export and a native W2 bash event-projection failure.
The export guard was fixed with the one re-export; the unchanged native bash case passed its separate diagnostic rerun and final broad run.
Its earlier failure is preserved, not explained away as proven unrelated or relabeled passed.

The next broad run and a focused rerun hit the existing >2MiB SDK-to-durable-writer15s child timeout.
This pass had added full key reads/JSON decoding to every writer guard and a redundant guard in `retainOriginal`.
The existing aggregate profile showed17,368 private reads in a successful diagnostic run near the boundary.
The repair removes that redundant retention guard and revalidates the originally decoded immutable key by the existing safe descriptor/path/incarnation tuple on writer checks.
Actual **key-consuming proof operations still read and compare key bytes**, counted before allocation under their original budget; they do not use this writer shortcut.
Writer guards continue to reject replacement (including identical bytes), edits, disappearance, links and unsafe metadata.

The subsequent profile had8,426 private reads, with successful unchanged native/input/final/cleanup checks; the separately rerun native/key controls and final broad suite pass.
Those profiles are observations with different natural batch counts, not a controlled benchmark or a universal timing guarantee.
No native20s/15s, read8MiB/100ms, download-idle or output/queue ceiling changed.
Pre-repair source copies and all failed logs remain in the private evidence root.

## Executed verification

All product test/build/verification helper invocations used explicit `TMPDIR`, `TEMP` and `TMP` pointing to the newly allocated0700 disk-backed root:

`/home/mirako/abel/.cadence-w3-sealed-progress-blJlHLn5`

Available host: `/usr/bin/node`26.7.0, Linux x64, Bun1.3.14, installed Pi0.84.3; actual test runner reports Vitest4.1.10.
Initial filesystem observations:759GiB available and60,802,509 free inodes.
No old roots were cleaned; no real credential store, dependency install, Git operation, consumer migration or deployment was performed.

- Targeted transport failure→repair:3 failing tests before implementation, then3 passing tests.
- Final new file:21 passing tests, no skips.
- Final explicit all-history plus prior ten-file command: **1215 passed / 0 failed / 0 skipped, 21 files,555.99s**.
  This includes the prior1194 cases (including the unchanged limitation-refusal case) plus21 new cases; overlapping reruns are not additional test totals.
- `bun run check`, `bun run lint`, `bun run check:agents`: exit0.
  Lint retains two pre-existing informational template-literal notices in `test/package-audit.test.mjs`; no new warning suppression or unrelated edits.
- Final changed-source/provenance hashes were equal before/after the broad run; HTTP provenance matches.
- Separate filtered diagnostics intentionally skip unrelated cases; they are not whole-suite passes.

These results qualify this partial source pass on the available host, not the missing feature positives, whole repository suite, distribution/browser/terminal integration, physical-human/paid-provider or other-platform lanes.
Independent review is still required after complete composition.

## Immediate continuation — unfinished required work

1. Implement the closed finite journal validator and checkpoint decoder.
   Separate raw line location/hash, one-line decode, row/marker membership, exact first-occurrence artifact-reference joins, required admission-file validation, commit, segment EOF and bridge phases.
   Preserve all complete uncommitted rows/torn-fragment distinctions and publication fences.
   No arrays of rows/references, whole JSON line or recursive stack in sealed state.
2. Use one forward validator through repeated bridges.
   Compare actual raw size/SHA/highSeq/committed offset/sequence and next-segment byte0 bridge placement.
   Revalidate active source incarnations on every quantum.
   Save each completed unit's state before the next cooperative time check.
   Test every maximal reachable state, not only6000 opaque crypto bytes.
3. Compose separate output and snapshot state plus **one** resumable end/overlap/finish worker, <=1023 overlap bytes and accumulated coverage.
   End absence differs from budget exhaustion.
   Require actual semantic advancement before sealing; fresh nonces alone cannot produce progress.
4. Replace the explicit navigation refusal guards only when authenticated checkpoint decoding and original-source revalidation are active. `HistoryProjection.validateCursor` still has the old detail fallback/double-read path for navigation-free inputs; validation and step must share one original request budget, with a per-request context rather than persistent authority.
5. Produce real detail/list progress replies from the reader; cold exact-hit detail remains an independent no-index preparation problem.
   Add entity/graph progress only if their actual preparation requires it.
   Exact hits must remain ordinary envelope-free anchors.
6. Keep **one private retained iterator** through export quanta.
   `export.ts` is unchanged in this pass and still recreates traversal.
   Format2 large exports need this key-independent iterator too; legacy stateless search limitations stay explicitly legacy.
7. Replace the old exactly8MiB LIMITATION refusal with true successful search/hit and both complete exports in separate cold Node continuations, readonly/no-index; add repeated recoveries, interleaved long fields/end/overlap, exact scalar/overlapping hits and cold detail via the real data/progress API.
   Keep a separate genuine-unresolvable negative and all prior corruption controls.
8. Add authenticated malformed checkpoint-state/unknown-phase tests, active predecessor mutation-between-quanta, maximal phase envelopes and native IO accounting including revalidation/rereads.
   The native8MiB SHA test here is an in-memory differential vector, **not** an8MiB recovered-history acceptance case.
9. Exercise actual valid issued proof through W1 HTTP under current access and revocation; this pass's maximal transport payload is deliberately opaque fixture data.
   Preserve no access/action/receipt/recovery crossover, exact encoded export checks and cancellation through proof-only work.
10. Run all positives and original regressions again, then independent review.
    Do not promote this prerequisite pass, encryption alone, the old refusal test or these source hashes into W3/product completion.

Source attestation remains supported-writer, non-atomic observation of active/selected immutable sources, not an arbitrary archive-wide current-incarnation or hostile same-user CAS guarantee.
