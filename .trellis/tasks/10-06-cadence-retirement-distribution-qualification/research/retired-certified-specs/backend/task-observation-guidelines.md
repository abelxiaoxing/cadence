# Disconnected Readonly-A Observation

Candidate-only convergence: the appended scenario records reviewed behavior before guarded LIVE integration.
Earlier checkpoints remain historical.

## 1. Scope / Trigger

Read before changing `src/task-controller.ts`, the readonly request/status additions in `src/task-shell-contracts.ts` / `src/task-observation.ts`, or the cooperative admission seam in `src/task-files.ts`.
This is bounded context gathering in recognized task conversations, not planning mutation, evidence certification or readiness.
The [planning host](../frontend/task-planning-guidelines.md) owns live selection, restrictions and model-run admission; this domain imports no Pi API.
Production `src/index.ts` stays disconnected.
This guide covers unchanged A operations, not all current controller methods.
[B authoring](./task-authoring-guidelines.md) adds separate `dispatchAuthoring` and selected readonly sections in these same owners; its qualified disconnected lifetime acceptance is bounded there, not whole-G2 acceptance or production readiness.
Registrar/Create/Return and review pager/compiler/issuer/executor remain absent.
C1–C3 structural/request observation is independently checked; C4 full gates/real pack and acceptance audit are pending, not new C acceptance.
It creates no verified evidence or source agreement.
A adds no schema or writer; existing [storage](./task-storage-guidelines.md) and [G1 publication](./database-guidelines.md) admission contracts remain.

## 2. Signatures

```typescript
createTaskPlanningController(state: ResolvedStateRoot, privateRoots: readonly string[])
// Frozen { state: Readonly<ResolvedStateRoot>, dispatch, dispatchAuthoring, dispatchPlanningC }
// A dispatch is unchanged; B and C have separate scopes.
dispatch(taskId: string, request: TaskPlanningRequest, guard: () => void,
  work?: LifetimeWork):
  TaskPlanningStatus | TaskPlanningObservation

decodeTaskPlanningRequest(value: unknown): TaskPlanningRequest
observeTaskPlanningStatus(state: ResolvedStateRoot, selectedTaskId: string,
  work?: LifetimeWork): TaskPlanningStatus
escapeTaskPlanningText(value: string, maximum?: number): { text: string; escaped: boolean }

readTaskFile(root: string, relative: string, maximum = TASK_LIMITS.artifactBytes,
  recoveryPeer?: string, beforeRead?: () => void, work?: LifetimeWork): Uint8Array | null
```

The factory re-resolves/checks configuration and freezes a detached state copy; compare actual resolved fields, not caller-object identity.
It pins project identity and privately retains checked exclusions for `stateBase`, `productRoot` and at most 256 supplied private/Pi roots.
Missing private directories are resolved through their existing canonical ancestor, not ignored.
The owner supplies `taskId`, the synchronous guard and exact optional `LifetimeWork`; model JSON supplies none of these capabilities or exclusion metadata.
Every dispatch independently decodes before guard/database access, requires the selected G2 status, then guards filesystem work and release.
No other-task fallback, portable import, storage bootstrap or durable observation receipt exists.

## 3. Contracts

### Closed requests and minimized status

All keys below are required; every object is closed.
`formatVersion` is exactly `1`.
The shared decoder preflights descriptors, symbols, cycles, sparse/nonplain data, malformed UTF-16 and the 64 KiB JSON envelope before canonical allocation; output is detached recursively frozen plain data.

| `op`      | `payload`                               | Bounds                                         |
| --------- | --------------------------------------- | ---------------------------------------------- |
| `status`  | `{}`                                    | No selectors                                   |
| `observe` | `{kind:"read", path, offset, limit}`    | Raw byte offset 0–1048576; limit 1–16384       |
| `observe` | `{kind:"list", path, limit}`            | One directory; limit 1–256 entries             |
| `observe` | `{kind:"search", path, literal, limit}` | Recursive directory search; limit 1–64 matches |

Numbers are finite safe integers, not coercible strings/nulls.
Paths are nonempty canonical root-relative UTF-8 strings of at most 4096 bytes; `.` is allowed only for list/search.
Reject absolute/drive/UNC/backslash/colon/ADS, empty/dot/dot-dot segments, trailing dot/space, control/format/Unicode separator characters and Windows device components on every platform.
Device checks include extensions, `conin$`/`conout$` and the supported superscript COM/LPT forms.
Do not normalize or lowercase a request into another file.
Literal is nonempty exact case-sensitive UTF-8, at most 256 bytes, without control/format/line-separator characters; ordinary spaces and regex/shell metacharacters remain literal.
Lexical validity is not privacy or filesystem admission.

Status contains only `formatVersion`, `authority:"context-only"`, `taskId`, escaped `title`, `kind`, `depth`, `localState`, `summary:string[]`, `intentRevision`, `recordRevision`, `eventSequence`, `readiness:"not-assessed"`, `implementation:"unavailable"`.
Summary includes statements, not their source IDs/kinds.
Retained approved state is still informational: no seed, receipt, session/binding/locator, approval provenance, full intent/draft or prepared bytes are exposed.
Escaped overbound status refuses rather than dropping facts.
`observeTaskPlanningStatus` uses one existing checked readonly snapshot, `readShellLocal` and `readTaskRecord`; it does not recognize a session or attach it.
No writable opener/checkout/migration/reconcile is allowed.
Readonly WAL may touch SQLite sidecars and retained-integrity validation may scan bounded records: neither zero OS I/O nor constant latency is promised.

### Privacy before opening or naming

Case-insensitive denial applies to every path component and before excluded-child inspection/open or name emission:

- `.git`, `.pi`, `.ssh`, `.gnupg`, `.aws`, `.azure`, `.kube`, `.npmrc`, `.netrc`, `.pypirc`, `auth.json`, `credential.json`.
- `.env` / `.env.*`, `credentials` / `credentials.*`, `secrets` / `secrets.*`, including examples.
- Prefixes `id_rsa*`, `id_ed25519*`; suffixes `.pem`, `.key`, `.p12`, `.pfx`, `.keystore`.
- Names ending in `.task-claim` or `.task-install`, including exact and operation-suffixed recovery siblings.
- Actual code-supplied private roots and descendants, including missing future private directories; a private root equal to/above the project denies project observation.

This intentionally overexcludes samples; it cannot find every secret in otherwise allowed source.
Public `.cadence/` planning files are allowed unless excluded, but remain context only.
No denied names or arbitrary exception text appear in diagnostics; omitted entries add generic `filtered`.

`Observation` pins root/absolute ancestry and visited directory/file identities, rechecking device/inode/type plus applicable link/size/timestamps around use.
Unrelated siblings outside the project are not a global timestamp lock.
Reject symlinks, hardlinked files, special files, ambiguous case resolution and changed/escaping ancestry; never use publisher recovery-link exceptions.
Directory enumeration uses incremental `opendirSync` with `bufferSize:1`, not unbounded `readdir` followed by truncation.
Node's runtime accepts `encoding:"buffer"`; the narrow `as BufferEncoding` bridge covers the declaration mismatch only.
Require `Buffer.isBuffer(entry.name)` and fatal UTF-8 decoding before name validation; a cast is not authority to accept replacement-decoded names.
Complete bounded scans detect case-fold collisions and sort allowed entries with `compareCanonicalStrings`.
Incomplete case inventories emit no names because unseen aliases could invalidate any partial selection.

### Resource, text and result boundaries

| Budget                               | Implemented bound                                                  |
| ------------------------------------ | ------------------------------------------------------------------ |
| Examined directory entries           | 1024/directory; 4096 total, including denied/skipped entries       |
| Directories / depth / examined files | 256 directories; 16 levels; 256 files                              |
| File / aggregate searched bytes      | 1 MiB/file; 4 MiB aggregate                                        |
| Cooperative observation time         | 250 ms monotonic, between iterations/admissions/reads              |
| Search snippet                       | At most 512 raw UTF-8 bytes, containing the entire literal match   |
| Domain JSON result                   | `(65536 - 512) / 2` = 32512 bytes, reserving SDK escaping/envelope |

Counters include path/case inventory work; directory-cap exhaustion uses `entry-limit`.
Stop admitting work after a reached cap; these bounds do not interrupt a slow syscall.
Oversized read files return empty incomplete `file-limit`, not an unbounded prefix.
Fatal decoding preserves BOM.
Read offset must be a UTF-8 boundary no later than EOF; end cuts back to a complete code point.
Read returns exact raw end-exclusive `startByte`/`endByte`; any range not covering the entire file is incomplete even if the requested slice was fulfilled.
Search performs exact non-normalized literal matching on validated UTF-8 and returns raw match/snippet ranges.
Malformed read text rejects; malformed search text is skipped with `filtered`.

Observation common fields are `formatVersion`, `authority:"context-only"`, `kind`, relative `path`, `escaped`, `incomplete`, `reasons`, `hint`.
Read adds `text/startByte/endByte`; list adds `entries:{path,kind:"file"|"directory"}[]`; search adds `matches:{path,startByte,endByte,snippetStartByte,snippetEndByte,text}[]`.
Escape C0/C1/DEL, format/bidi and Unicode line separators as visible `\u{hex}` text; LF remains a line break.
`escaped` describes display transformation, not source confirmation.
Incremental serialized budgeting includes quotes/backslashes; output expansion may shorten a read range or omit entries/matches with `output-limit`.
The host independently bounds the entire actual SDK result at 65536 bytes and does not duplicate payloads in details.

Closed sorted reasons: `byte-limit`, `entry-limit`, `file-limit`, `depth-limit`, `time-limit`, `filtered`, `output-limit`.
Any reason sets `incomplete:true` and the fixed hint `Narrow the path or request; partial results are not a stable page.`; otherwise hint is null.
No offset/token pagination guarantee, stable cross-call filesystem snapshot, universal no-match assertion, full-file hash, evidence/source ID, verifier PASS or semantic-relevance certification follows.

### Closure and admission ordering

The optional **fifth** `readTaskFile` parameter runs before allocation and every `readSync`, including the EOF probe.
The controller supplies `undefined` for recoveryPeer and rechecks currentness, then time, in this callback.
A private `ReadAdmissionFailure` wrapper preserves code-owned refusal identity only after successful file-descriptor closure; old callers omit the callback and keep their original behavior.
Keep its explicit field/assignment form: G1 subprocess consumers use Node strip-only loading, which does not support transformed parameter-property syntax.
A deadline stop discards unvalidated partial bytes and returns truthful incomplete `time-limit`, not I/O uncertainty.
A real close failure supersedes deadline/currentness refusal, maps to `task-io-failed` and must latch host uncertainty.
Directory `finally` closure has the same failure priority, including refusal immediately after open.
Selected-status SQLite close failure preserves `TaskPlanningError("task-io-failed")`; inventory/private-context APIs retain their existing foundation storage-error mapping.
A failed close cannot be reported as successful resource settlement.
Integrated dispatch tracks actual status/view/read DBs, directory scans and file FDs through the same exact work; sixth-argument reader work does not replace its fifth-argument guard.
No writable lease is acquired for readonly accounting; a required departure uses its pre-reserved child only after the original read/body resources close.
The anchor retains uncertain resources across compatible replacement even when an outer error boundary minimizes the error code.
[Task Storage](./task-storage-guidelines.md#participating-resource-and-fence-boundary) owns exact capture/closure and helper signatures; [Planning Host](../frontend/task-planning-guidelines.md) owns successor restrictions and final release.
No filesystem/SQL atomicity or hostile same-user race containment is claimed.

### C managed material observation

Implemented in `src/task-publication.ts` / `src/task-files.ts`, separately from A's no-peer filesystem policy:

```typescript
observeTaskMaterials(state: Readonly<ResolvedStateRoot>, selectedTaskId: string,
  privateRoots: readonly string[], proof: PublicationProjection,
  guard: () => void, work: LifetimeWork):
  { materials: MaterialFact[]; check: () => void }
verifyTaskEvidencePublicationFiles(state: Readonly<ResolvedStateRoot>,
  selectedTaskId: string, privateRoots: readonly string[],
  facts: CompletenessFacts, guard: () => void, work: LifetimeWork): () => void
```

The controller validates selected ID against the **same** checked local/record/witness and inventory; read scope's one-use `observedC` must match admission before files.
Explicit code-owned ID is location data, not a permit: a lawful empty publication projection cannot supply `rows[0].taskId`.
Both helpers assert exact work/root before callbacks or filesystem capture; no store/SQL connection/lookup callback/caller peer list is accepted.
[Task Storage](./task-storage-guidelines.md#c-selected-projection-and-private-witness) owns the detached producer/tail/outbox proof and noncreating private reader; an up-to-8-MiB private metadata projection must never go through the public 64-KiB serializer.
Historical evidence-request pages perform no live target/claim reads and remain readable after external edits.

Live completeness uses whole tracked sequential reads, not A prefixes or a generic scan.
Inventory and observed target totals each have a **16-MiB** budget; relevant historical claim/install/target work separately prebounds `sum(expected.bytes + 2*desired.bytes) ≤64 MiB`.
Evidence mutation additionally checks all historical publication targets, including noninventory index/required decisions and never-authored absence, in its own bounded pass.
These and the storage publication budget are separate domains, **not total per-invocation I/O/heap**; repeated validation is deliberate.
No writable opener, coordinator, mkdir, migration, publisher reconciliation or new resource site/profile is used by views/local review.

Capture target/claim/install/ancestor stamps and absence **before proof reads**, then compare around guarded reads and at final release; do not recapture changed bytes after a callback.
At most 12544 deduplicated stamps; actual private-root exclusions remain, including 256 configured roots.
`MaterialFact` retains role/path, expected/observed whole hashes and byte lengths (both observed null iff absent), inventory version, selected publication and path tail.
Private metadata never leaks into findings.
The returned code-owned checker is callback-free, compares original stamps without content reread/adoption/SQL/await, and survives until H3.

Delivered original claims must equal stored expected bytes, including expected-null absence; missing/changed required claims are fixed conflicts, not merely artifact-changed findings.
Pending/conflict rows may have no not-yet-created claim, but any present claim must match nonnull expected.
Claims require nlink=1 and cannot alias current targets.
Only an exact checked target/install pair may have nlink=2, with identical device/inode and desired bytes; no third/unknown/cross-target peer.
A same-byte hardlink to an original/restored claim is not install proof: C may conservatively refuse it without changing B recovery or G1 original-inode retention.
Older claims remain checked independently of current-tail selection; no cleanup, unlink, restore or inferred delivery occurs.
Safe absent/changed ordinary targets yield independent missing/changed findings; absent/unproved/pending/conflict selection yields undelivered.
Unsafe paths/private corruption/I/O remain errors.

Actual first native close owns completion.
Failed-before/after-syscall closure retains exact native resources and same-root negatives even if syscall counts balance or the OS object is already closed.
A bounded, typed C refusal with proved-closed resources can permit fresh admission; never infer closure from the outward error or a second close.
Existing ABI5 read6/write16 cleanup and H3 callback/private/file/pure ordering remain; no filesystem/SQL atomicity is promised.

## 4. Validation & Error Matrix

`TaskPlanningError` and `TASK_PLANNING_FAILURE_CODES` originated with A and are reused by B, not new foundation codes.
Their closed vocabulary is `task-record-invalid`, `task-path-unsafe`, `task-conflict`, `task-io-failed`, `task-storage-invalid`, `task-entry-rejected`, `task-planning-limit`, `task-tool-conflict`.

| Condition                                                | Boundary result                                                             |
| -------------------------------------------------------- | --------------------------------------------------------------------------- |
| Malformed/extra/missing/coercion-shaped/future operation | Pure decoder throws exactly plain `Error("task-record-invalid")` before I/O |
| Lexically valid denied/private/ambiguous path            | `task-path-unsafe`, never echo submitted name                               |
| Absent/G1 selected status                                | `task-entry-rejected`; create nothing                                       |
| Corrupt/missing selected G2 facts                        | Bounded retained-storage failure; no fallback                               |
| Observed root/ancestor/file identity drift               | `task-conflict`; no stale bytes                                             |
| Invalid UTF-8 read or nonboundary/past-EOF offset        | `task-record-invalid`                                                       |
| Filtered/oversized/time-limited traversal                | Explicit incomplete result with closed reasons                              |
| Unrepresentable bounded status/result                    | `task-planning-limit`, no silent status truncation                          |
| Unexpected I/O or file/directory/SQLite close failure    | `task-io-failed`; host retains uncertainty                                  |

Controller maps known overlapping foundation errors to A errors; unknown exceptions become `task-io-failed`, never parser/path text.
The host further projects fixed errors; do not forward thrown objects or stacks.

C: safe target absence/hash mismatch is a material finding; wrong/missing original claim → `task-conflict`; unproved alias/excluded path → `task-path-unsafe`; invalid work → `task-entry-rejected` before callbacks/files; budget overflow → `task-planning-limit`, no partial matrix.
Native close uncertainty → `task-io-failed` with retained obstruction, outranking a finding/refusal.

## 5. Good / Base / Bad Cases

- Good: selected G2 context reads a complete small BOM/multibyte source with raw ranges and `incomplete:false`; a narrower slice explicitly reports incompleteness.
- Base: a search filtering `.env.example` yields only allowed paths and generic `filtered`, not a certified project-wide absence of matches.
- Bad: listing first, then redacting denied names, or treating a valid lexical `.git/config` request as read permission.
- Bad: interpreting `localState:"approved"` as current readiness or returning private context pages as status.
- Good C: a checked target/install alias is observed without unlinking it; its captured checker rejects a later swap.
- Base C: empty-publication legacy inventory reports undelivered independently from matching/missing/changed bytes; private history survives file edits.
- Bad C: use current desired bytes as expected claim proof, or let a later cache hit/balanced close count settle an old unknown resource.

## 6. Tests Required

`test/task-controller.test.ts` has **141 cases** at independent domain-review handoff; it is not a full repository/distribution result.
`research/readonly-a-domain-review.md` under task `09-24-cadence-task-shell-and-approval` records **488 passed / five focused suites**, including G1/storage/contracts, not whole-A acceptance.
Preserve these concrete assertions:

| Test area / named case                                                                                       | Assertion points                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `does not confuse lexical acceptance with privacy or filesystem admission`                                   | Decoder acceptance never authorizes I/O                                                                                                                               |
| `returns useful selected status/read/list/literal search and detached rooted configuration`                  | Actual selected facts; immutable configuration; no model selectors                                                                                                    |
| `rejects all privacy families before path inspection/open or name emission, including missing private roots` | No excluded open/name/sentinel leakage                                                                                                                                |
| `keeps exact UTF-8 byte ranges, BOM and safe code-point cuts`                                                | Raw ranges and fatal-valid complete boundaries                                                                                                                        |
| Read-budget and closure faults                                                                               | No next data/EOF read after expiry; close error wins over refusal; successful deadline stop stays incomplete, not uncertain                                           |
| Added independent domain cases                                                                               | Invalid/private-ancestor roots deny before directory open; post-open refusal closes; close failure wins; 256-byte emoji literals fit wholly inside ≤512-byte snippets |

Retain writer/migration/publication, network/process/download traps during the exercised operation, business/Git/settings byte checks, case/link/ancestor swaps, malformed names/text and every resource/output bound.
The real special-file fixture is a Linux Unix socket addressed through `/proc/self/fd`; it is not native FIFO/device or Windows qualification.
Actual busy-turn SDK evidence belongs to the [planning host guide](../frontend/task-planning-guidelines.md), not direct controller calls.
Retain `test/task-lifetime-host-io.test.ts` and fencing/host suites: read-close failures survive replacement, no-marker same-root refusal persists, unrelated ordinary roots retain their own tools, and actual late completion never restores old authority.
Trap writable opener/checkout/mkdir/migration/reconcile on status/view/read and malformed input.
Full verify/distribution/real pack remain main-owned gates; do not substitute arithmetic test totals or member inventory for executed results.

C coverage: `test/task-planning-c-material.test.ts`, `task-planning-c-service-review.test.ts`, `task-planning-c-boundary-review.test.ts` and `task-planning-c-safety-review.integration.test.ts`.
Assert explicit selected ID with zero rows; wrong task/work before filesystem/guard; whole-byte and separate-budget boundaries; current-tail/older-claim proof; exact target/install alias versus restored claim/third link; capture-before-read reentry; first-close faults before/after syscall and replacement retention.
A's privacy, range, no-peer and noncreating assertions stay unchanged; C has no new PTY/tarball/native-platform qualification.

## 7. Wrong vs Correct

Wrong: `readTaskFile(root, request.path)` with privacy filtering after reading.
Correct: validate selected context and exclusions first, then call the checked reader with no recovery peer and the per-read admission guard:

```typescript
readTaskFile(root, relative, TASK_PLANNING_LIMITS.fileBytes, undefined, () => {
  checkCurrentness();
  checkRemainingBudget(); // Code-owned synchronous refusal; never a model flag.
}, work); // Exact host-supplied accounting, not a model field.
```

Wrong: catch every refusal as `time-limit`, or let a deadline exception hide `closeSync` failure.
Correct: preserve only private admission control flow after successful close; propagate bounded I/O uncertainty and release no partial bytes.

Wrong: mark filtered output as verified evidence or claim escaping redacts all secrets.
Correct: report exact ranges/display escaping and explicit incomplete reasons; observations create no durable authority.

Wrong: infer selected task from an outbox row, permit caller-supplied recovery peers, or bless fresh stamps after reading.
Correct: use the controller's same-facts selected ID, derive only checked target/install peers, and retain capture-before-proof stamps through final callback-free release.

## Scenario: Candidate-only stale display versus selected authority reads

### 1. Scope / Trigger

Applies to the sole private convergence candidate before LIVE integration, not a production entry switch.
Earlier absent-pager and complete-G2-display descriptions are historical.
A remains noncreating context gathering, never evidence or agreement.

### 2. Signatures

`observeTaskHistorySummaries`, `observeTaskDisplayDetails`, `observeTaskSessionMapping`, `observeTaskReview`, `observeTaskReviewBytes` and `auditTaskStorage` are explicit noncreating facades.
No raw connection, public skip-validation flag, writable ownership lease or cross-operation permission cache is exported.

### 3. Contracts

Display snapshots disclose `authority:"context-only"` and `stale:true`; freeze/detach only bounded displayed fields after actual DB/reference/FD close.
Sessions expose epoch/action/outcome/departure/returned; publications expose sequence/path/state, not locators/receipts/BLOBs.
Display pages have at most 64 rows and explicit continuation; selected detail/Open independently rereads.
Selected rows validate original bytes, indexed identities and required saga/event/reference joins; unrelated retained history is not implicitly audited.
Dedicated mapping completeness stays within 256 work units, includes foundation-only tasks and checks required nonmatching-row joins; incomplete mappings expose no partial ordinary-mode proof.
Full review-byte reads check the original immutable pair/root/producer and entire BLOB before returning bounded slices; page hashes never authorize issuance.
Readonly observation cannot mkdir, migrate, reconcile or acquire writable checkout; WAL sidecars are not zero I/O.

### 4. Validation & Error Matrix

Missing/rehashed selected dependencies refuse usable results.
Unrelated history corruption remains detectable by explicit audit, not a mandatory display precondition.
Actual failed close returns no snapshot and retains original resource uncertainty; a later sibling success cannot discharge it.

### 5. Good/Base/Bad Cases

Good: display stale summaries, then independently reread the selected Open target.
Base: intact private facts remain readable after external managed-file edits while mutation refuses.
Bad: use display continuation, a successful render or an empty partial mapping to enable tools.

### 6. Tests Required

Keep complete observation-composition, session-store, entry, review and resource suites.
Trap all writable entrances on readonly branches; assert summary privacy/freeze, actual native mapping queries, selected corruption refusal, explicit audit and failed-close/no-result retention.
Separate lawful capacity, maximum byte shape and pagination from representative complete interaction tests.
Exact native facade export/arity/descriptor parity must include `observeTaskReadonlyAgreementOutcome` and retain all four import orders.

### 7. Wrong vs Correct

Wrong: pass stale display records into attachment/ordinary recognition or trust an already decoded payload without key joins.
Correct: use the dedicated current mapping/selected reader, check indexed keys and references, close actual resources, then retain only detached context.

## Scenario: Private whole-local-source prerequisite (G5 incomplete)

### 1. Scope / Trigger

Read before changing the trusted collector at `task-controller.ts`.
This is source acquisition, not an SDK/model operation, readonly objective agreement/fulfillment, durable source storage or Completion.
The existing public A read/list/search contracts stay unchanged.

### 2. Signatures

- `controller.collectLocalEvidence(taskId, relative, guard, work)` returns `{receipt,path,sha256,bytes}`.
- `controller.consumeLocalEvidence(receipt, originalWork): TaskLocalEvidence` supplies detached owner-private raw bytes once.

### 3. Contracts

Require a real read work, checked selected research/diagnosis planning task and strict synchronous undefined-return guard.
Decode the relative file path before guards/I/O; use the original Observation privacy, complete case inventory, ancestry, one-MiB file and 250-ms cooperative limits.
Never use A's escaped/ranged output as source bytes.
All original selected DB/Dir/FD closes precede receipt creation; consumption rechecks original source stamps, selected intent revision and foreground after the selected DB closes.
One unconsumed exact-object slot belongs to that controller/work; it cannot be replaced, copied, transferred, replayed or revived after refusal.
Private metadata contains task/root/intent/path, byte range, raw hash and source-identity hash; no raw bytes enter the returned collection summary.
Filtered unrelated siblings do not omit bytes from a selected file: locate still requires a complete case inventory and rejects an ambiguous selected name.
This proves only observed whole bytes/currentness, not semantic relevance or the whole work family's closure.

### 4. Validation & Error Matrix

Malformed path → original pure decoder refusal; denied/link/alias → `task-path-unsafe`; changed source/intent or occupied slot → `task-conflict`; partial/deadline/overbound read → `task-planning-limit`.
Copied/foreign/spent receipt or foreign work → `task-entry-rejected`.
Unknown original first close → `task-io-failed`, no collection and sticky original lifetime obstruction, including after-syscall loss.
No native/retrieval fallback or new lifetime anchor/profile is installed.

### 5. Good/Base/Bad Cases

Good: privately collect exact BOM/UTF-8/control-containing whole source and persist it later through the owning checked writer.
Base: collect an empty or full one-MiB file; public excerpts remain context-only.
Bad: treat the receipt as objective fulfillment, use escaped excerpts, reuse bytes after source/foreground drift or publish them directly.

### 6. Tests Required

Complete `test/task-local-evidence.test.ts` covers both readonly kinds, exact raw bytes/ranges, one-shot membership, code/forged-work/nonvoid refusal, privacy/link/case/UTF-8/size/deadline and source/inode/foreground drift.
FD and selected Dir first-close faults on both syscall sides must exclude the original namespace before diagnostics, return no collection and obstruct exact work finish.
Keep complete A/resource/host-I/O suites and original deadlines unchanged.

### 7. Wrong vs Correct

Wrong: `sha256(escapedExcerpt)` or `if (read.incomplete === false) complete()`.
Correct: acquire the entire admitted raw file through original Observation, consume its exact private slot under current original work, then independently check objective/request applicability and normal work closure at the future completion owner.
