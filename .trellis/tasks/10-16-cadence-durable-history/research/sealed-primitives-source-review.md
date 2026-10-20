# Sealed read-progress primitives — independent source review

## Disposition and scope

**One concrete implementation finding: recovery append stops checking its pinned key incarnation after its initial guards (§1).** No additional concrete defect was found in the inspected AES-GCM/SHA primitives, portable progress correlation, or finite readonly POST changes. This is a source audit, not cryptographic certification or executed qualification.

Resolved `python3 ./.trellis/scripts/task.py current --source` to `.trellis/tasks/10-16-cadence-durable-history`, source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`. The only authored artifact is this new report. No product/test/spec/config edits, tests, product execution, agents, installs, Git/status operations, or prior-report changes were performed. Source searches, file reads and source SHA-256 observations are not test runs.

Authority: child manifests/PRD/design/plan; complete parent PRD/design/plan and both mandatory appendices; parent `research/read-progress-decision.md`; W3 `research/w3-sealed-progress-handoff.md` and its checks record. Also inspected the prior read-progress implementation/security reviews and relevant storage, quality, logging, workflow, service-owner and cross-layer/reuse guidelines. The selected parent decision supersedes older recommendations.

The finite validator/checkpoint parser is explicitly **not implemented**. Its absence, production navigation refusal, uncomposed entity/graph progress, existing detail double-read path and unfinished export iterator are **not new defects in this prerequisite audit**. This review does not claim repaired progress or W3 acceptance. The reported **1215 passed / 0 failed / 0 skipped** remains prior partial-pass evidence, includes the `LIMITATION` refusal, and does not qualify W3.

## 1. Verified source finding — P2: recovery can commit after an already-pinned key is replaced with identical bytes

### Evidence

- `src/history/files.ts:202-264`: first key use saves `proofSnapshot`; `assertWritable()` subsequently compares the original private-file incarnation through `assertIncarnation`, not just key bytes. This correctly rejects a same-byte replacement when called.
- `src/history/recovery.ts:193-195`: an in-flight recovery pins that key via `files.assertWritable()`.
- `src/history/files.ts:697-702`: `appendRecovery()` checks it at entry and after its first awaited `assertCurrent()`.
- **`src/history/files.ts:717-733`: subsequent guards and effects never call `assertWritable()` again.** After awaiting `assertCurrent()`, it writes the body, invokes the journal observer, awaits another `assertCurrent()`, writes/syncs the marker, invokes the commit observer, awaits another guard and eventually clears the publication fence/returns committed success.
- `src/history/recovery.ts:220-231`: those later `assertCurrent()` calls check local authority, coordination and `digestHistory(files, path)`, but not the previously pinned key incarnation.
- `src/history/recovery.ts:38-75`: `digestHistory` hashes relative names, lengths and bytes. `PrivateFiles.read` checks that each newly selected file is safe/stable during its own read; its returned `stamp` is not included in this digest or compared with the recovery's original key stamp. The format is separately pinned by `assertFormat()`, but the key is not.

### Concrete reachable sequence, derived from source (not executed here)

1. Begin an otherwise valid explicitly authorized recovery; its format3 key is pinned.
2. At the existing `"journal"` observer boundary, replace `read-proof-key.json` with a new private, regular, single-link inode containing **exactly the same bytes**. Keep any preserved original/replacement staging file outside the history tree, so the selected tree's names and bytes are unchanged.
3. The next `assertCurrent()` sees the same history byte digest and unchanged coordination. Its safe file read accepts the replacement as a safe current file.
4. No subsequent `assertWritable()` compares the changed key stamp. The marker can be written and the recovery returned as committed, even though the already-pinned `files.assertWritable()` would now reject this key.

This is a sustained change before an explicit guarded effect, not a demand for hostile same-user filesystem CAS or detection of a change after the final observation. It concerns an **already-pinned in-flight recovery**, not an unsupported expectation that a fresh cold selection can discover an unrecorded earlier incarnation.

### Impact and bounded correction

The format3 writer-incarnation rule claimed by this pass is not applied consistently to recovery append. It can publish a recovery bridge and clear its in-process publication fence despite loss of its pinned immutable key identity. This does **not** demonstrate GCM forgery, disclosure, unauthenticated recovery, process-lock release or duplicate execution; original local recovery authorization is still required.

Reapply the existing pinned `assertWritable()` guard after the awaited recovery checks and before subsequent append/publication effects; do not substitute a byte-only digest or silently repin the key. On refusal, preserve partial recovery bytes and the fence. The existing cheap incarnation guard is sufficient; no per-frame full key decoding, new key mechanism or engine redesign is needed.

A narrowly discriminating regression belongs beside the existing recovery write-boundary test: replace the key with identical bytes at `"journal"` and require refusal/no successful recovery fact, preserved coordination/history bytes, and retained incomplete-write fencing. Also cover the later pre-publication boundary. These are proposed tests, not executed results.

### Why the inspected tests do not settle this finding

- `test/service-history-progress.test.ts:524-583` replaces key/format files and then explicitly invokes proof opening and `f.files.assertWritable()`. Those controls exercise the guard itself, not recovery's later guard placement.
- `test/service-history-publication-recovery.test.ts:619-636` changes predecessor **bytes** after the recovery body. The byte digest catches that case; it does not exercise same-byte key reincarnation.

## 2. Cryptographic and storage audit observations

### AES-GCM, AAD and plaintext handling

`src/history/read-proof.ts:21-143` uses native AES-256-GCM, a fresh random 12-byte nonce and full 16-byte tag. The envelope is fixed `rp1.` plus canonical unpadded base64url. Opening checks prefix/alphabet/encoded bound, decoded size and re-encoding equality. Plaintext is nonempty and at most6000 bytes; the maximum emitted envelope is8042 ASCII bytes, below8192. No compression/truncation fallback or caller-selected algorithm exists.

AAD contains a versioned domain, distinct search/detail/list purpose, store/workspace/root, original format/key stamps, and SHA-256 of the shared-decoded outer request with **only** navigation removed. Thus exact query/scope/snapshot/entity/offset (and list reader/limit/after) remain bound. Service epoch, browser attachment and access generation are deliberately absent. Source inspection found no binding to provider/browser/local/grant secrets.

`decipher.update()` output stays local; `decipher.final()` must succeed before plaintext is returned. There is no parsing, callback or publication of partial plaintext. Both operations reread/revalidate format/key before use and before returning, against the supplied budget. Except for the explicit budget-inconclusive signal, crypto failures map to fixed `corrupt-selected`, without token/key/raw exception logging. Returning authenticated bytes rather than a parsed checkpoint is the intentionally limited primitive contract.

The current context union supports only search/detail/list. Entity/graph purposes are not accidentally accepted through a generic purpose string; add their distinct domains only if their later composition actually requires them. Journal/source checkpoint validation is not provided by this primitive and was not inferred from successful decryption.

### Format3/key lifecycle and source incarnation

`src/history/files.ts:117-165`, `202-264`, `301-316`, `360-367`; `src/service/private-files.ts`; `src/history/read-io.ts`:

- Explicit new initialization exclusively creates a random32-byte key record before the final format marker, with existing0600/private-directory/file-fsync/directory-durability attempts. Existing partial namespaces refuse rather than being completed/cleaned.
- The key has closed schema/store binding, fatal UTF-8/duplicate-aware JSON parsing, maximum512-byte read and canonical43-character base64url representing exactly32 bytes.
- Warm key use compares identity and incarnation; AAD also binds format/key incarnations for cold token reopening. Proof operations reread actual key bytes; the writer's shortcut only validates the already-decoded immutable file.
- `read-io.ts` uses the same `dev, ino, size, mode, uid, nlink, ctimeMs, mtimeMs` tuple as `PrivateFiles`, with private-parent, regular/single-link, no-follow and pre/post descriptor/path checks. These are supported-writer observations, not atomic archive-wide snapshots.
- Format2 retains the original closed manifest fields. Writer construction, initialization of an existing store and recovery append pass through `assertWritable()` and refuse format2 without creating a key. Key-independent stateless reads remain possible; that is allowed by the decision, not a missing format3 read guard.
- Selected size is charged before budgeted payload allocation/read; repeated format/key reads are charged too. This source accounting is not a measured native-I/O or100ms performance result.

The exception is the later recovery guard placement in §1. No new history cleanup, secret export or automatic format migration was found in these paths. Recovery's aggregate private history digest still includes key-file bytes; it is not a public per-key fingerprint or a demonstrated key-recovery attack.

### Standard SHA-256 checkpoint

`src/history/sha256-state.ts` implements standard SHA-256 IV/constants, big-endian block loading,64-round schedule/compression and standard length padding. It does not hash independent chunk digests together or serialize private OpenSSL state.

The closed `sha256/1` decoder requires eight uint32 words, an exact safe count bounded by the segment ceiling, canonical pending base64url of length `bytes % 64` and at most63 bytes, and IV words before the first compressed block. Snapshots copy state; resumed updates consume the saved residual; `digest()` works on a copy and appends the original total bit count. No concrete roundtrip/padding defect was identified by inspection.

`test/service-history-progress.test.ts:587-657` contains native SHA comparisons for empty/known strings, padding/block boundaries, random split states and a full8MiB buffer, JSON checkpoint roundtrips, repeated digest calls and malformed-state controls. These are inspected test bodies and previously reported runs—not tests rerun here. The8MiB in-memory vector is not recovered-history acceptance.

## 3. Portable cursor/reply and finite readonly transport audit

- Shared ownership remains `src/worker-public.mjs#decodeNavigation/decodeCursor` plus `.d.mts`; facade/domain propagation reuses that implementation. Navigation is optional, nonempty, bounded8192 printable ASCII; malformed present values are not normalized to absence.
- `src/service/contracts/history.ts#progressPair`, `decodeDetailReadResult`, `decodeHistoryReadResult`: progress-only replies have no text/range/content/records. They require unchanged normalized read identity and a changed nonempty next token. That is structural correlation, explicitly **not semantic advancement**. Data ranges retain their existing positive-byte rule.
- `decodeSearchPage` permits same-position/token-only continuation, preserves store/scope/query/snapshot, and rejects navigation on exact-hit anchors. `src/history/search.ts#scanCursor/parseScanCursor` consistently exclude navigation from the old public checksum; hit construction uses `readIdentity(cursor)`.
- `src/service-client.ts:209-225,395-429` checks the complete echoed cursor/request, including incoming navigation. List correlation permits first-snapshot selection, but not changing a supplied snapshot. It does not loop arbitrary quanta or retry actions. Shared page decoders size the complete page value, including echo/next tokens and escaping; actual future producer packing remains explicitly unfinished in the handoff.
- `src/service/ports.ts:229-236` adds `progress-needed` independently of `valid`. HTTP can continue the named read; it does not translate that status into admission authority.
- Production search/detail/list/validation paths explicitly refuse submitted navigation today (`search.ts:738`, `reader.ts:437`, `projection.ts:589,663,802`). No invalid-token-to-seed fallback was found. This conservative prerequisite state is not claimed as functional resumed history.
- `src/service-wire.ts:162-219,230-265` has a finite same-route readonly POST allowlist, preserves bodyless session/workspace GET, rejects mixed query/body including an empty query delimiter, and chooses POST before sending for navigation or encoded targets over2KiB. It does not mark readers as mutations or retry failed GETs.
- `src/service/http.ts:360-398,461-545` authenticates POST using existing exact Host/proxy/Origin/CSRF/native-capability rules before JSON body decoding; explicit attachment policy matches the client. Existing strict type/encoding/length/fatal UTF-8/duplicate parsing is reused. Read POST still occupies the readonly pool; search/export retain their dedicated pools. Only command/cancel set the execution-dispatched flag, so thrown read refusals retain effect:none.
- `src/service-http-client.ts` sends selected POST JSON using existing attachment/CSRF state, same-origin credentials, no-store and redirect refusal. Missing session is explicit failure, not hidden bootstrap. Export uses the same deterministic method selection.
- Current access is rechecked after awaited reads and at export output boundaries. Export retains digest/trailer/EOF and cancellation checks; the transport addition does not reset idle time for private computation. The proof key/token does not enter authentication/admission/recovery authority paths.

No additional concrete defect was identified in these inspected changes. This does not qualify an actual issued-proof HTTP integration: the current HTTP tests inject projections and opaque navigation strings, not a production finite validator.

## 4. Evidence limits and source binding

`test/service-history-progress.test.ts` provides source-visible controls for maximal navigation/query transport, malformed bodies/UTF-8/type/encoding, mixed input, CSRF/Origin, no-reader/no-admission paths, progress response correlation, access rotation, format preservation, nonce/ciphertext/tag tampering, warm/cold file replacement and SHA parity. Those controls do not test semantic checkpoint phases, original-source resumption or complete long-history exports; that is accurately disclosed by the handoff.

`test/service-history-publication-recovery.test.ts:1093-1134` still asserts `receipt-inconclusive` for the recovered-large-archive `LIMITATION`. Preserve it and all prior reports as historical failed-feature evidence until the independently required positive replacement exists. This review supplies no new pass totals, runtime receipts or W3/parent completion.

Observed hashes below match the corresponding entries in `research/w3-sealed-progress-checks.json`. They bind inspected source, not execution or a clean working tree. `provenance/auth-reuse.json` also lists the observed HTTP hash.

| Path | SHA-256 |
| --- | --- |
| `src/history/read-proof.ts` | `91f5c07aca196815dbd2929114044de6d7b52caa4735280e2e12199e6002af40` |
| `src/history/sha256-state.ts` | `38d88f1885d68f59584b73047305b2b2b75145341d6e328aee9a96ae434522a7` |
| `src/history/files.ts` | `38c3923fdff51f39006a4770c9a5be93222f1563618aa3676e0816e2d7498355` |
| `src/history/read-io.ts` | `e7e809a545fbc521878c1106ad5d8d1c801f3e83d16f04512e3fb9d7c169689b` |
| `src/history/recovery.ts` | `379e72bd2dd19bb309ab36f414879230587326260909c8a68a03788ad34bcc84` |
| `src/service/contracts/history.ts` | `30efe15044b2903128b9e10a8bba7fb28ede9fd3e33320191668f0f3951277c5` |
| `src/service-client.ts` | `fe10d86662d47977d4c4d0cfe3c70a7ce0b877dcbcd68f96db1b9656caa971bc` |
| `src/service-wire.ts` | `17f565872f45330b377a4bca2b6eb0426892b4990ae1aa7b206b73ecb380f834` |
| `src/service/http.ts` | `c225248cd0c14fa8b6039bdef47e4d951f18efbf76ba6678775b3301024245ba` |
| `src/service-http-client.ts` | `8be7e46fe4a19ca74dc8bb089b9318b259f36125263d3264cca0a803ba2b6d1e` |
| `test/service-history-progress.test.ts` | `269329865cc66d22757ac3674247f94ddc924e83b55d3eef3d10b7eaa86ca947` |

**Handoff:** fix the specific recovery key-incarnation gap without changing authority or budgets; continue the already-approved finite engine work. This source review must not be promoted into completed read-progress or W3 qualification.
