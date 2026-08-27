## Context

See `proposal.md` for motivation and the capability deltas for observable behavior. The existing extension has four properties that shape this design:

1. `src/runtime.ts` and `src/worker.ts` retain graphs, task state, retry budgets, conflicts, and terminal facts only in process memory.
2. `src/child-session.ts` creates and disposes a fresh in-memory child session for every launch, so the prompt's apparent same-Worker Red/Green/Refactor continuity is not a real runtime property.
3. Candidate preflight already reconstructs a private sibling from a Git bundle and Bubblewrap, but accepted phases are then applied directly to the consumer workspace.
4. Implement's caller-facing request has no conditional JSON Schema and requires the parent model to assemble a graph, hash, dynamic snapshots, and exact apply/discard identities.

The extension is loaded by a Node >=22 Pi host, has no runtime dependency other than its Pi peers and TypeBox, already rejects symlink/path escapes component by component, and must remain a private Abel-only facility. The repository currently has no active change or durable run requiring migration. Node's built-in `node:sqlite` is available without a third-party native dependency when the minimum engine is raised to Node 22.13.0.

## Goals / Non-Goals

**Goals:**

- Make a code-owned WorkflowEngine the sole authority for run and task transitions.
- Make accepted workflow progress durable and recoverable independently of Pi, child-session, Provider, or model lifetime.
- Keep the main workspace unchanged until a complete cumulative Implement change passes its approved verification and currentness gate.
- Make every Worker attempt replaceable from an authoritative structured task ledger.
- Replace caller-assembled graph mechanics with a versioned, compiled delivery artifact and discriminated control commands.
- Preserve parent-owned approval, candidate validation, verification, AGENTS maintenance, and final application.
- Keep status and lifecycle presentation locally available and semantically truthful.
- Preserve scoped path, dependency, output-provenance, verification, and secret-handling protections.

**Non-Goals:**

- A public or cross-extension orchestration service, remote queue, cloud state store, or background autonomous Agent daemon.
- Application-layer encryption or a credential vault; persisted data instead excludes secrets and relies on owner-only filesystem permissions.
- A non-isolated fallback when the platform lacks an approved isolation backend.
- Transparent v1 delivery, endpoint-configuration, or runtime-state migration.
- Automatic Gate approval, implicit commit, archive, publication, release, or repair outside an approved boundary.
- Redesigning the user-visible Init or Diagnose algorithms in this change.

## Decisions

### 1. Separate the deterministic control plane from replaceable execution

`WorkflowEngine` will own all legal transitions and compose small deterministic services:

```text
ControlToolV2
  -> WorkflowEngine
       -> DeliveryCompiler
       -> RunStore
       -> DurableScheduler projection
       -> WorkerBroker -> ephemeral ChildSession
       -> ArtifactStore / TaskLedger
       -> WorkspaceStore / IsolationBackend
       -> VerificationEngine
       -> ApplyTransaction
       -> ActivityProjection
```

The parent supplies a change-oriented command. The engine loads the approved delivery, derives operation identity and current snapshots, and decides the next legal work. A Worker proposes evidence or candidate bytes but never owns run state, approval, verification, apply, or recovery selection.

Alternative rejected: extending `WorkerRegistry` with more process-local variants. That retains the current coupling between a Tool invocation, one model identity, retry exhaustion, and terminal task state.

### 2. Use a per-root SQLite event journal plus transactional projections

The state root will resolve to `$XDG_STATE_HOME/abel-cadence` when `XDG_STATE_HOME` is an absolute safe directory, otherwise `~/.local/state/abel-cadence`. Resolution canonicalizes both the consumer root and the final per-consumer state path, then rejects `state-root-inside-consumer` before creating any directory or database when that path is equal to or contained by the canonical consumer root. This includes an `XDG_STATE_HOME` below the repository and the fallback when the consumer root is the user's home; there is no in-repository fallback. Each accepted canonical consumer root receives an owner-private directory keyed by `sha256(canonicalRoot)`:

```text
roots/<root-hash>/
  control.sqlite3
  artifacts/
  workspaces/
  transactions/
```

Directories use mode `0700`; newly created state, journal, artifact, and transaction files use `0600`. Existing components are rejected if they are symlinks or have an incompatible type. The database enables `foreign_keys`, WAL journaling, `synchronous=FULL`, and a bounded busy timeout.

RunStore allocates one immutable run identity independent of delivery revisions. Named Design and Implement lookup is unique by canonical root hash, stage, and change; a raw-requirement Design run starts under a provisional identity and Gate A binds the approved change name to that same run. The logical schema contains:

- `schema_meta`: exact control schema version; only v2 is accepted.
- `runs`: immutable run id, canonical root hash, stage, provisional/final change binding, current state and terminal tombstone.
- `delivery_bindings`: ordered Gate A/Gate B revision bindings and their validity state for the stable run.
- `events`: append-only per-run sequence, typed payload, prior-event hash and event hash.
- `tasks`: materialized task and phase projection.
- `operations`: idempotency key, state, lease token and lease expiry.
- `route_health`: route fingerprint, safe health state and next half-open eligibility.
- `artifacts`: content hash, size, seal state, ownership and reference count.
- `workspace_revisions`: immutable parent revision and manifest hash.
- `apply_transactions`: intent, baselines, prepared content, completed steps and recovery state.
- `bootstrap_handoffs`: the one exact v1-bootstrap binding, committed acceptance facts, selector CAS intent and v2 recovery cursor; no general v1 record is admitted.

An accepted transition appends its event and updates the materialized projection in one SQLite transaction before returning success. Projections are rebuildable from the checked event chain. A state-changing command uses a deterministic operation idempotency key; replay returns the committed outcome.

Long operations do not hold a SQLite write transaction. They hold a renewable operation lease, checkpoint before external work, and commit results only when the same lease and preconditions remain current. An expired lease is recovered as `interrupted`, never as success. `status` is a read-only local query and does not acquire a Worker route.

Alternative rejected: append-only JSON plus lock files. Correct crash recovery, multi-process status, lease compare-and-swap, projection updates, integrity checks, and cleanup would recreate a weaker database protocol in application code.

### 3. Model operation cancellation separately from run termination

`cancel` aborts the current child, validation, or apply-preparation operation and returns the durable run to `paused` at its last checkpoint. It does not erase accepted progress. Once final apply has completed its first per-file compare-and-swap, `cancel` records a pending pause and routes through `recovering`; it cannot expose a paused run until roll-forward or rollback safely settles. `discard` is the explicit terminal destructive command, but during `applying` or `recovering` it records a pending discard and retains every prepared/rollback artifact until recovery settles before cleanup and the terminal tombstone.

The run projection distinguishes:

```text
created -> validating-delivery -> ready -> executing
executing -> change-verifying -> ready-to-apply -> applying -> completed

executing -> queued | retryable | paused | approval-needed
applying  -> recovering -> applying | paused | completed
non-apply nonterminal -> paused by operation cancellation
non-apply nonterminal -> discarded by explicit discard
applying | recovering + cancel  -> recovering -> paused | applying | completed
applying | recovering + discard -> recovering -> discarded | applying | completed
invalid immutable contract -> rejected
```

Task projections distinguish pending, queued, phase-ready, phase-running, validating, phase-verified, repairable, retryable, paused, approval-needed and verified. `blocked` is removed as an undifferentiated terminal state.

### 4. Compile one canonical `ImplementPlanV2`

Design will maintain a typed `PlanDraftV2` in the private run store and mutate it through schema-specific builder operations. The builder accepts one bounded task, output, verification, or scheduling declaration at a time; it does not accept a generic arbitrary object.

At Gate B the code-owned `DeliveryCompiler` will:

1. Validate task and scenario identity, dependency acyclicity, verification capability, outputs, impact closure and AGENTS contracts.
2. Require exact write, delete, and new-output paths. Runtime write globs are not supported.
3. Resolve approved read selectors to an exact manifest with matched paths, scan count, `truncated: false`, and expansion hash.
4. Generate canonical `implement-plan.json` with sorted object keys and normalized set ordering.
5. Generate the human `tasks.md` projection from that same plan.
6. Calculate the plan SHA-256 and executable verification closure.
7. Generate receipt artifact bindings mechanically.

The v2 `ready.yaml` stores a safe relative `plan.path`, plan schema version, raw-byte SHA-256, canonical plan hash, closure and artifact hashes; it does not embed another graph copy. Implement loads the referenced artifact and supplies no caller-owned completed/blocked arrays, graph hash, phase snapshot, launch identity or apply identity.

This change is bootstrapped through its one exact current-v1 ready receipt. The active selector stays on the bounded v1 bootstrap path while the v2 engine is built and the complete bootstrap task plus acceptance matrix runs. Before selector cutover, the bootstrap path transactionally commits a v2 `BootstrapHandoff` containing the exact bound receipt/artifact facts, accepted bootstrap facts, and any pending cutover/apply intent. A reload before the selector compare-and-swap returns to the bootstrap finalizer; a reload after it enters v2 and resumes the same handoff. V2 never parses or admits the v1 receipt, and no other v1 change or protocol receives a compatibility adapter.

Alternative rejected: parsing prose in `tasks.md` as the machine source of truth. Markdown is retained as a projection, not a protocol.

### 5. Use exact path sets and catalogued verification capabilities

Gate B write authority is a set of exact safe relative paths. Future outputs must have exact paths even when absent at Gate B. Read discovery may start from anchored selectors but the compiler seals only their exact, non-truncated expansion.

A `VerificationCatalog` builds available adapters from the current package manifest, installed local executables, test configuration and discovered test layout. It does not hard-code `test/` and `tests/`; paths such as colocated `*.test.ts`, `__tests__`, E2E and project-specific layouts are admitted when the catalog and task contract declare them.

Every verification remains a shell-free atomic contract or ordered steps contract. Runners cannot download implicitly. Design readiness validates the exact consumer capability before Gate B.

### 6. Use content-addressed immutable workspace revisions instead of Git worktrees

`ArtifactStore` stores blobs by SHA-256 with atomic temp-write, fsync, rename, byte-count verification and reference counting. `WorkspaceStore` stores immutable manifests mapping safe relative paths to blob hash, mode, size or absent state.

The initial revision captures the approved current source baseline, including current tracked modifications and approved untracked regular files, rather than only `HEAD`. `.git`, the control state root and dependency directories are excluded. Approved dependency directories and runner paths are mounted read-only into verification sandboxes.

Each task attempt materializes a disposable child of the current cumulative revision. Candidate preflight and phase verification run there. A successful attempt becomes a revision delta. Merge compares the task's base bindings with the current cumulative revision:

- disjoint deltas commute and can merge independently;
- a changed bound path makes only that attempt stale;
- an overlapping write or resource conflict remains queued or retryable;
- cross-task outputs publish only after producer task verification commits.

Bubblewrap remains the first `IsolationBackend`. The interface owns dependency mounts, network denial, executable mounts, temp space and process cancellation. Absence of a compatible backend pauses the run; it never authorizes verification in the unisolated main workspace.

Alternative rejected: Git worktrees. They begin from committed trees, do not faithfully represent arbitrary dirty and untracked baselines, and still require a separate transaction for final application.

### 7. Persist task evidence, not child conversations

`TaskLedger` is the authoritative ordered phase history. It records delivery revision, approved task boundary, command contract id, exit code, normalized classification, test/assertion or compiler diagnostic identity, sealed candidate hash, isolated revision, output facts, correction category and route-rebind facts.

It does not store raw prompts, hidden reasoning, complete command logs, child transcripts or raw model output. Runner-specific normalizers retain actionable bounded facts such as safe in-scope path, line, diagnostic code, assertion id and expected/actual classification.

Every child session remains new and disposable. A later Green, Refactor, repair, or replacement Worker receives a bounded `TaskLedgerProjection` plus scoped repository reads. A warm session may be added later as an optimization but can never be authoritative.

Alternative rejected: keeping a live child session across phases. It improves warm context only while the process survives and conflicts with restart recovery and Worker rebinding.

### 8. Seal large candidates in bounded segments

The child submit surface becomes a stateful but scoped artifact protocol:

- a segment is at most 128 KiB;
- one phase candidate is at most 8 MiB;
- every segment binds run, task, phase, attempt, sequence and bytes;
- sealing binds segment count, total bytes and final SHA-256;
- no segment can enter preflight before the complete artifact seals;
- invalid order, duplicate sequence or hash mismatch rejects the unsealed artifact;
- total-capacity exhaustion pauses as `needs-task-split` rather than producing a partial diff or terminal blocker.

The sealed bytes must still parse as one complete ordinary textual unified diff and pass exact-path admission. The larger transport changes delivery capacity, not write authority.

### 9. Replace endpoint pinning with a visible route broker

The v2 configuration is JSON:

```text
<project>/.pi/cadence/routes.json
~/.pi/agent/cadence/routes.json
```

The project file wins as a whole. A policy contains named routes and an ordered route list per closed role. Custom credentials are referenced only by environment variable name (`apiKeyEnv`); keyless custom routes omit it. `inherited` is an explicit route kind rather than an implicit hidden fallback.

The default bounds are:

- response headers / effective HTTP connection: 5 seconds;
- first model delta after headers: 30 seconds;
- accepted stream progress idle: 60 seconds;
- total phase: 10 minutes;
- one automatic attempt per eligible route per operation;
- one half-open probe after a 30-second route-health cooldown.

The broker composes an AbortSignal for each bound and observes Provider `onResponse` plus child-session message deltas. Provider-managed retry stays disabled. An operation may advance only through routes already present in its allowed ordered policy. A change outside that set requires explicit `rebind`, capability validation and a new attempt; Provider/model identity is attempt provenance, not an immutable task-boundary field.

Custom routes use their dialect and bypass parent payload transformation. Inherited routes retain fresh parent authentication and effective parent payload composition. Route status persists only name, non-secret fingerprint, safe health state and retry time; URL and credential values never enter outcomes or the run database.

Tests inject their state root, clock, route policy and Provider factory. They never resolve the developer's real home configuration.

Alternative rejected: silent fallback to the parent model or another configured endpoint. Route changes must be visible and policy-authorized.

### 10. Make final delivery a recoverable transaction

After every task and affected verification commits, the engine runs the approved change-level suite, output postconditions and managed-only AGENTS checkpoint in the cumulative workspace. An introduced failure returns the owning task to repairable; no main-workspace candidate has been applied yet.

`ApplyTransaction` then:

1. Computes the cumulative baseline-to-final patch and exact target set.
2. Rechecks every bound main-workspace input and target.
3. Prepares final file bytes and modes in owner-private transaction storage.
4. Saves original bytes, modes and absent facts needed for rollback.
5. Commits the full transaction intent to SQLite before the first mutation.
6. Applies each file with per-file compare-and-swap and records every completed step.
7. Runs declared postconditions and post-apply verification.
8. Commits completion, or rolls back only files still matching transaction-produced bytes.

After interruption, no new apply can start until recovery safely rolls forward or rolls back the prior intent. If an external editor changes an overlapping file during apply, the engine preserves that edit, reports `recovery-required`, and never reports completion or overwrites the new bytes.
Cancellation or discard after the first recorded file step only sets a pending control intent and wakes recovery. It never deletes transaction storage or transitions directly to paused/discarded while main-workspace visibility may still be partial.

Ordinary filesystems do not provide instantaneous multi-file visibility. This design guarantees a recoverable terminal all-or-none outcome: `applying` and `recovering` are explicit nonterminal states, and completion is impossible until every step and postcondition is established.

### 11. Project activity from durable semantic state

`ActivityProjection` maps the authoritative state to TUI, print, JSON and RPC representations. Tool-call settlement is not a completion signal. Only run or operation state controls the glyph and label.

Interactive presentation includes queued, connecting, waiting-first-response, running, validating, retrying with policy count, verifying, paused with safe code, approval-needed, applying, recovering, operation-cancelled, discarded, rejected and completed. Only completed uses a success check mark. Rendering failure cannot change engine behavior.

### 12. Verify stateful invariants with properties and crash matrices

Property-based tests cover:

- legal state transitions, invalid-transition closure and replay equivalence;
- command idempotency and event/projection reconstruction;
- canonical delivery round-trip and hash stability;
- whole-file route precedence, no undeclared fallback and counter separation;
- artifact segment ordering, sealing, duplicate rejection and size boundaries;
- workspace manifest round-trip, disjoint merge commutativity and overlapping merge rejection;
- symlink/path escape closure;
- apply interruption at every transaction step and eventual roll-forward or rollback;
- truthful activity mapping for every nonterminal and terminal state.

Integration tests use temporary state roots, fake clocks, fake Providers and disposable repositories. The real developer route policy and user state are never read.

## Risks / Trade-offs

- **[Node 22.13 minimum]** `node:sqlite` is not available without the experimental gate in early Node 22 releases. → Raise `engines.node` to `>=22.13.0`, validate it in package tests and fail extension activation clearly on an older host.
- **[Private workspace disk usage]** Immutable revisions and sealed candidates retain code bytes while a run is paused. → Deduplicate by content hash, reference-count blobs, expose retained size through status, and clean completed or discarded runs idempotently.
- **[SQLite WAL artifacts]** WAL and shared-memory files survive a crash. → Keep them in the owner-private root, use SQLite checkpoint/recovery on open, and treat them as database internals rather than orphan run data.
- **[Lease clock skew]** Wall-clock movement can affect an expiry. → Use generous renewable leases, require the prior lease token for result commit, and recover ambiguous work as interrupted rather than successful.
- **[No instantaneous multi-file atomic visibility]** A process can stop between file replacements. → Journal intent before mutation, block competing applies, record every step, retain rollback content and make recovery precede all later transitions.
- **[External edit during apply]** An editor does not honor Cadence's private lease. → Per-file compare-and-swap, preserve externally changed bytes and enter explicit recovery-required state without reporting completion.
- **[Large repository snapshot cost]** Full source manifests can be expensive. → Hash incrementally, deduplicate blobs, exclude dependency and VCS stores, and permit only non-truncated safe manifests to authorize work.
- **[Normalized diagnostics may omit useful raw context]** Raw logs would improve repair but can leak secrets and bloat state. → Add runner-specific structured normalizers and bounded in-scope diagnostics; raw logs remain ephemeral.
- **[Breaking configuration]** Existing `SUBAGENT_*` keys no longer select Workers. → Ship `config/routes.example.json`, report a precise unsupported-v1 diagnostic, and provide documentation without an automatic compatibility reader.
- **[Isolation platform coverage]** The initial secure backend remains Linux Bubblewrap. → Keep isolation behind an explicit capability interface and pause safely on unsupported hosts until another backend satisfies the same contract.
- **[Bootstrap asymmetry]** This change itself is delivered by the v1 runtime it replaces. → Bind one exact v1 graph for this change, keep its activation selected through all bootstrap tasks and acceptance, durably create a v2 handoff before the one-way selector CAS, and reject every other v1 receipt or protocol after cutover.

## Migration Plan

1. Implement and verify v2 contracts, stable run/delivery binding, RunStore and DeliveryCompiler while v1 remains the bootstrap caller for this change only.
2. Implement route policy and workspace primitives behind new internal modules without changing the active dispatcher selector.
3. Implement transactional preflight/apply, sealed artifacts and TaskLedger.
4. Integrate WorkflowEngine, durable recovery and the typed v2 command schema behind the still-active, exact-receipt bootstrap selector; do not remove v1 activation or make v2 parse the v1 receipt.
5. Update Design/Implement prompts, shared Skill, professional Agents, activity rendering, docs, example policy and distribution lists, including the root AGENTS managed-block checkpoint after the package surface is stable.
6. Run the complete v2 restart, rebind, stale workspace, transaction crash, activity and package acceptance matrix, followed by `bun run check`, `bun run lint`, `bun run test`, `bun run pack:check`, `bun run traceability:check`, `bun scripts/seed-acceptance.mjs`, and `bun run check:agents` as separate steps while v1 bootstrap activation remains selected.
7. After every bootstrap task and acceptance fact is committed, transactionally write `BootstrapHandoff`, then switch the single activation selector by compare-and-swap and retire v1 graph/task-attempt handling. A reload on either side resumes the handoff; subsequent v2 activation rejects all v1 receipts and records.

Rollback during implementation discards the private implementation candidate before final application. After package deployment, rollback means reinstalling the prior package version and explicitly discarding any v2 private run state; no v1 state conversion or automatic product-workspace rollback is promised.
