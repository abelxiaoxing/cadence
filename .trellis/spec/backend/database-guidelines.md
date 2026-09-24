# Database Guidelines

> Owner-private SQLite storage for the Cadence control plane: checked schemas, atomic additive migrations, legacy admission, and package-state reset semantics.

---

## Overview

All durable state is owner-private SQLite accessed synchronously through Node's built-in `node:sqlite` (`DatabaseSync`).
There is no database server and no ORM: schema contracts are checked-in string constants in `src/storage-schema.ts`, enforced at open time by `src/sqlite-schema.ts`.
Trusted stores live in the repository-external state root prepared by `src/state-root.ts`, never inside the consumer project.
The disconnected G1 task foundation additionally supports bounded portable narrative files in `.cadence/`; those are context, never trusted execution state.
The owner (the user's machine and Pi account) is the only client; per-workspace external locks and version gating in `src/package-state.ts` keep concurrent hosts safe.

---

## Schema Contracts

Every table is declared `STRICT` in `src/storage-schema.ts`, so a type mismatch in a column insert fails instead of coercing.
The contracts are exported as frozen string constants:

- `RUN_SCHEMA` / `LEGACY_RUN_SCHEMA_V2` — run, delivery binding, event, task, operation, route health, artifact, workspace revision, apply transaction and bootstrap handoff tables.
- `DESIGN_SCHEMA` — `design_facts`, `design_operations`, `design_compiled_plans`, `design_finalization_leases`.
- `ENGINE_SCHEMA` — `workflow_engine_runs`, `workflow_engine_deliveries`, `workflow_engine_tasks`, `workflow_engine_operations`.
- `RECOVERY_SCHEMA` — `workflow_context_reads`, `workflow_work_budget`, `workflow_recovery_incidents`, `workflow_recovery_events`.
- `AMENDMENT_SCHEMA`, `REJECTED_DELIVERY_SCHEMA`, `TASK_SCHEMA`, `APPLY_SCHEMA`, `ROUTE_HEALTH_SCHEMA` — additive namespaces defined independently so existing stores can absorb them without touching prior tables.

Concrete examples of the house style:

```sql
-- src/storage-schema.ts: budget invariants are CHECK constraints, not code
CREATE TABLE IF NOT EXISTS workflow_work_budget (
  run_id TEXT PRIMARY KEY REFERENCES runs(run_id) ON DELETE CASCADE,
  used INTEGER NOT NULL CHECK (used >= 0),
  max_work INTEGER NOT NULL CHECK (max_work > 0 AND used <= max_work),
  phase_high_water INTEGER NOT NULL DEFAULT 0,
  hard_limit INTEGER NOT NULL DEFAULT 512,
  recovery_policy INTEGER NOT NULL DEFAULT 0
) STRICT;
```

```sql
-- src/storage-schema.ts: enum-ish columns are CHECK-constrained,
-- and identity chains use prior_hash/event_hash columns
CREATE TABLE IF NOT EXISTS workflow_recovery_events (
  run_id TEXT NOT NULL REFERENCES runs(run_id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  incident_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('failure', 'resolved', 'repair', 'launch')),
  PRIMARY KEY (run_id, sequence)
) STRICT;
```

Payloads are stored in `*_json` columns alongside `*_hash` integrity columns (e.g. `design_facts.payload_json` + `canonical_hash` + `prior_record_hash`), and child tables cascade from `runs(run_id)`.

---

## Migrations

Migrations are checked in as data and applied atomically; there is no migration runner process.

- `src/sqlite-schema.ts` owns `configureSqlite`, `ensureSqliteSchema`, `matchesSqliteSchema` and the fail-closed `SqliteSchemaError` (code `storage-schema-invalid`).
- `src/run-store.ts#ensureCurrentSchema` wraps schema work in `BEGIN IMMEDIATE`.
  If another opener already completed the same migration, the store is reused: the code comment says "Another opener may have already completed the same migration."
- Additive changes are declared as column maps, e.g. `ENGINE_ADDITIONS` (adds `baseline_workspace_revision`, `route_fingerprint`, ... to `workflow_engine_runs`) and `RECOVERY_ADDITIONS` (adds `hard_limit`, `recovery_policy`, ... to `workflow_work_budget`).
- New namespaces use independent table sets: `AMENDMENT_SCHEMA` documents this with the comment "Independent namespace so existing recovery stores remain atomically additive."

Example of an additive-only rule in practice: the current run schema adds the proof columns `approval_revision`, `contract_hash`, `record_hash` to `delivery_bindings`, and the v2 legacy schema is literally the same table without them (the `DELIVERY_PROOF_COLUMNS` fragment), so a v2 store migrates by adding columns, never by rewriting rows.

---

## Legacy Store Admission

`src/run-store.ts` admits checked legacy control stores without inventing authority:

- `LEGACY_SCHEMA_VERSIONS` maps schema version `2` to `LEGACY_RUN_SCHEMA_V2` and version `4` to the current schema.
- `supportedLegacyVersion` requires a `schema_meta` table whose only column is `version` with exactly one row, and the actual table set must match the claimed legacy schema via `matchesSqliteSchema`.
- A v2 store that already contains any of the proof columns (`approval_revision`, `contract_hash`, `record_hash`) is rejected: the code comment says "A v2 database cannot already contain any proof fields.
  Do not repair a partial/ambiguous upgrade or reinterpret malformed fields as authority."
- Any mismatch raises `RunStoreFormatError`; the store is not opened, never partially repaired.

`test/sqlite-schema.test.ts` covers preservation, rollback and malformed-schema rejection, and Design startup plus concurrent migration are covered by the delivery/control-plane integration suites.

---

## Package Upgrade and Reset

`src/package-state.ts` gates the package service lifecycle around the recorded package version:

- Open is version-gated: a readable same-version marker retains state; a readable downgrade fails closed; an upgrade backs up the whole old or unversioned state directory and initializes a fresh store.
- Reset abandons old task/lease/apply facts without settlement: notices carry `oldRunsAbandoned: true`, `workspaceRestored: false`, and a warning about partial apply plus checking the Git diff.
  No main-workspace rollback is performed.
- An interrupted reset is resumable: the reset intent (backup name plus notice fields) is persisted before the old state is removed, so reopening completes the abandoned reset instead of starting over.
- Unreadable or missing control stores with retained resources are backed up too, including the runtime run-data layouts; notice reasons are `package-upgrade`, `unversioned-store`, `unreadable-store`, `missing-store`.
- The service holds a per-workspace external SQLite lock for its lifetime; observable package-ownership/SQLite locks and unsafe paths still block open, so old hosts and descendants must be stopped by the operator.
- Low-level storage migration and read-only operator inspection never reset state.

`test/package-state.test.ts` covers retention, opaque-state abandonment, real-layout apply journals, links, ownership and interrupted recovery; package responses expose the bounded reset notices.

---

## Naming Conventions

- Tables and columns are snake_case; JSON payloads are `*_json`, hashes are `*_hash`, timestamps are `*_at`.
- Every child table references `runs(run_id) ... ON DELETE CASCADE`, and unique identity is a composite primary key (e.g. `PRIMARY KEY (run_id, gate, revision)`).
- New columns for an existing table get `NOT NULL DEFAULT <value>` so old rows stay valid; the CHECK constraint style above is the default for bounded integer/enum columns.

---

## Directory Persistence

`src/directory-sync.ts#syncDirectory` centralizes the one portable directory-flush exception: on Windows, Node's read-only directory handle rejects `fsync` with EPERM, and that exact case returns `"unsupported-directory-barrier"`.
The function documentation is explicit that this is a missing directory barrier, not permission to ignore file flush, open, close, rename or other I/O errors, which remain fatal; on Windows it provides process-crash recovery, not a POSIX power-loss guarantee.
Callers (`src/artifact-store.ts`, `src/workspace-store.ts`, `src/package-state.ts`, `src/execution-retention.ts`) flush file bytes before publishing a directory entry and keep their own integrity checks or write-ahead records.
`test/directory-sync.test.ts` covers native publication, injected syscall faults and apply recovery, and the storage platform CI runs it with engine-reopen contracts on all three operating systems at Node 24.13.0.

---

## Forbidden Patterns

- Never modify or recreate an existing table; migrations add columns or tables only (additive-only, per the `storage-schema.ts` contract comments).
- Never invent approval, delivery proof, or recovery facts during migration or reset; the v2 columns are added as schema only, and reset abandons facts rather than reinterpreting them.
- Never skip the `BEGIN IMMEDIATE` migration transaction or the `matchesSqliteSchema` check; an unmatchable schema is an error, not an upgrade path.
- Never persist trusted runtime state inside the consumer repository; `src/state-root.ts` owns repository-external root safety.
  Only explicit `TaskPublisher` requests may publish portable contextual records in its closed `.cadence/` path grammar; they carry no execution authority.
- Never treat the Windows directory `EPERM` as "fsync works here" or "fsync is irrelevant"; it is exactly one capability result with the semantics documented in `syncDirectory`.

---

## Common Mistakes

- Writing a one-off `CREATE TABLE` in a service module instead of extending the `src/storage-schema.ts` constants; the schema check at open time then rejects the store.
- Assuming a recycled PID or a missing settlement receipt means an execution is gone; `src/execution-retention.ts` writes a settlement receipt before launching host processes precisely so reopening does not infer ownership from live PIDs.
- Backing up only the SQLite file while the workspace still has retained execution roots; the notice/backup flow in `src/package-state.ts` covers the runtime run-data layouts too.

## Scenario: Disconnected G1 Task Foundation

### 1. Scope / Trigger

`src/task-*.ts` supplies infrastructure only; production `src/index.ts` does not import it.
No task command, approval issuance, execution launch, knowledge promotion policy, or old-protocol retirement is implemented by these modules.

### 2. Signatures

- `TaskStore.open(resolvedStateRoot)` / `close()` hold the shared checkout fence.
- `create(title, kind, depth)`, `get(id)`, and `revise(record)` manage planning context only.
- `freezeReview(id, suppliedBytes)` stores immutable whole-file snapshots; `review(id, revision)` checks their hashes.
- `TaskPublisher.prepare(id, path, expectedBytesOrNull, desiredBytes, operationId?)` commits a publication intent.
- `TaskPublisher.reconcile(operationId)` explicitly reconciles that exact operation; no background loop exists.
- `importTask(root, id)` / `discoverTasks(roots)` return `authority: "context-only"` without opening private storage.
- `TASK_FOUNDATION_SCHEMA` in `src/storage-schema.ts` owns five STRICT domain tables: protocol, records, reviews, review bytes, and publications; SQLite separately owns its internal sequence table.

### 3. Contracts

Private storage is `<productRoot>/task-v1/<canonicalRootHash>/control.sqlite3`, a sibling of legacy `roots/`, so package reset cannot move it.
It uses WAL/FULL, private directory/file modes on POSIX, symlink/hardlink rejection, canonical hashes, exact version/root binding, and exact schema SQL plus structural checks before opening an existing store for mutation.
Initial schema/root insertion is transactional; a partial or empty retained database is rejected, not silently recreated.
`acquireCheckoutOwnership` in `src/package-state.ts` is the shared SQLite lifetime fence, extracted without changing legacy reset behavior.
`requireLegacyQuiescence` in `src/task-legacy.ts` provides a narrow read-only proof: exact current `RUN_SCHEMA`, optional checked package-version marker, empty resource/authority tables, and either no runs or terminal event-only history with checked root/projection/hash-chain and committed lease-free operations.
Only run-created/state-transitioned history is supported; historical execution stores with engine namespaces, applied transactions, delivery bindings or retained resources are not interpreted as settled.
The database must have the supported WAL header and be closed/checkpointed (no WAL/journal/shared-memory sidecars), at most 64 MiB, with bounded JSON rows; empty artifacts/workspaces/transactions scaffolds are allowed.
An immutable read-only SQLite URI prevents creation of legacy WAL sidecars during inspection; no `RunStore.open`, migration, reset, deletion or moving history occurs.
Rollback-journal headers are not admitted: immutable inspection bypasses SQLite locks, including exclusive locks that may have no journal file yet.
Unknown/malformed/live/partial layouts and coordinator reset/backup evidence remain blocked without guessed PID settlement.

Portable records have closed version-1 fields, code-generated UUIDv4 IDs, bounded title/narratives, informational lifecycle, monotonic revisions, and a separate all-artifact inventory.
Only local planning-context revisions are writable; imported approved/archived text cannot change local lifecycle or mint approval.
Records are at most 64 KiB; artifacts and aggregate imported/reviewed content are at most 16 MiB; inventories are at most 64 entries; discovery visits at most 256 entries across at most 16 roots.
Review publication preflights the declared aggregate before any read and passes the smaller of the declared size and remaining budget to each bounded read.
Research/knowledge basenames reject Windows devices (`con`, `prn`, `aux`, `nul`, `com1`–`com9`, `lpt1`–`lpt9`) on every platform, even with `.md` extensions.
Review snapshots bind whole compact `brief.md` bytes or the expanded requirements/design/plan set (readonly tasks omit plan).
Results, research and progress summaries are outside the review manifest.
`reviewCurrent` checks current repository bytes; changed brief bytes make the old review stale without altering its private snapshot.

Publication persists expected and desired bytes in the same transaction as its identity and sequence, before creating repository paths.
The path grammar permits only the task's own documented artifacts/index and single-level bounded knowledge filenames.
Existing targets are renamed to `<target>.<operationId>.task-claim`, then **rechecked**; desired bytes are flushed at `<target>.<operationId>.task-install` before exclusive hard-link installation, never an unconditional replacing rename.
These names derive from the committed operation identity, not a PID/random temp or glob search.
After a link-before-unlink crash, only that exact target/install or target/restored-claim pair may have `nlink === 2`; both must be regular files with identical device/inode and no third link.
Install bytes must exactly match the durable desired bytes before install-alias cleanup; wrong inodes, unrelated links and edited recovery bytes are never cleaned up automatically.
An edit racing the claim is restored with an exclusive link where possible; the claim name is retained even after restoration.
**The original claimed inode is never unlinked by G1**, including after delivery: an editor can save through its original descriptor after any last content check.
The deterministic claim is identifiable recovery material for such late saves; a later cleanup policy must establish its own justified retention boundary, not merely reread it or glob-delete it.
Delivered operations are terminal acknowledgments of publication, not assertions that retained claims stayed unchanged; reopening/delivered retry does not delete or automatically restore recovery material.
Partial pre-link install bytes or divergent claims remain explicit conflicts with private desired bytes retained.
This deliberately differs from legacy apply cleanup without changing that owner's semantics; neither protocol is filesystem-wide atomicity or a sandbox against a hostile same-user process racing every path syscall.
Windows directory persistence retains `syncDirectory`'s process-crash-only qualification; POSIX mode checks do not prove Windows ACL privacy.

### 4. Validation & Error Matrix

| Condition                                                         | Result                                             |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| Unknown fields, malformed identities, oversized records           | `task-record-invalid`                              |
| Unsafe artifact grammar, symlink/special/hardlinked file          | `task-path-unsafe`                                 |
| Wrong schema/version/root or damaged stored hashes                | `task-storage-invalid`, no reset                   |
| Live owner, unproved legacy layout/resources/reset evidence       | `task-ownership-unresolved`, old bytes retained    |
| Changed expected bytes, competing target, retry identity mismatch | `task-conflict` or retained publication `conflict` |
| Snapshot does not match supplied/current bytes                    | `task-review-stale` or `reviewCurrent === false`   |
| Filesystem failure                                                | `task-io-failed`, desired intent bytes retained    |

### 5. Good / Base / Bad Cases

- Good: a reopened publisher reconciles a claimed prior file after process death and delivers the same desired bytes once.
- Base: a foreign archived record restores context with no session file and no local checkpoint; a closed, exact core-only legacy history remains byte-for-byte unchanged beside new task storage.
- Bad: invoking `acquirePackageState` to reset old state before opening the task store, or treating a portable approved lifecycle as a grant.

### 6. Tests Required

`test/task-foundation.test.ts` covers strict records, imported authority rejection, schema tamper/no-mutation, process reopen, shared ownership, conservative legacy coexistence, intent/claim/write/result interruption, real child exit with ownership held, syscall-level link-before-unlink exits, retained-descriptor saves after the final read, unrelated/edited recovery links, closed legacy positives and malformed/partial negatives with byte preservation, aggregate review preflight/read limits, direct record/review/publication corruption, device basenames, manual edits, unsafe entries, exact retry identities, immutable review bytes, and divergent discovery.
Keep `test/package-state.test.ts`, `test/sqlite-schema.test.ts`, `test/directory-sync.test.ts`, `test/remove-path.test.ts`, and `test/apply-transaction.integration.test.ts` passing after changing shared primitives.
Native Windows ACL/power-loss and hostile directory-swap guarantees are not established by these Linux tests.

### 7. Wrong vs Correct

Wrong: read a target, then `renameSync(desiredTemp, target)` and call it compare-and-swap.
Correct: commit intent/bytes, claim and recheck the old target, install with operation-owned exclusive linking, retain the original claimed inode and conflicts, then commit delivered.
Wrong: another last-minute read makes unlinking an editor's original inode safe.
Correct: preserve its deterministic claim name through delivery; only remove an exact desired-byte install alias whose target still names the same inode.
Wrong: use portable `lifecycle: "approved"` as execution admission.
Correct: return context only; G1 contains no approval issuer or execution-admission implementation.
