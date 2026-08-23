## Context

See `proposal.md` for motivation. The current private Implement path accepts one repeated `RequestEnvelope` for every phase, copies stable task and phase contracts into `WorkerRegistry`, compares those copies structurally, converts typed preflight failures into strings, and wraps domain stops in a recovery object that claims control over Design and parent-owned successors. Scheduler conflicts end with each invocation, retained candidates lack complete origin identity, and the extension returns a synthetic `isError` field that Pi does not use for final Tool classification.

The repository is in development with an intentionally dirty baseline. Existing isolated candidate preflight, exact ordinary Git apply, scoped child tools, provider payload bridging, cancellation forwarding, bounded concurrency, in-memory lifecycle, and parent-owned AGENTS checkpoints remain safety constraints.

## Goals / Non-Goals

**Goals:**

- Register one immutable task boundary before any await or child launch and use phase-local attempts thereafter.
- Keep stable identity, approved boundary, derived task-lifetime conflict, and the complete task state in one process-local record.
- Preserve closed typed failures from child submission through preflight, exact apply, checkpoint, and terminal outcome.
- Make Runtime-owned preflight and exact apply the only phase-transition facts.
- Keep conflicts active between tool calls while preserving independent siblings and terminal replay.
- Align parent Tool return/throw behavior with the locked Pi Agent Loop contract.
- Remove the unreleased recovery protocol, string classification, contract comparators, and shared `nextStep` field without aliases.

**Non-Goals:**

- Owning or executing the parent task DAG inside Runtime.
- Changing Design or Diagnose run envelopes or the Diagnose regression-first algorithm.
- Adding dependencies, persistent state, public orchestration APIs, a general state-machine framework, waiting/resume, leases, dynamic repair tasks, partial diffs, or unbounded retry.
- Moving cross-invocation task lifetime into Scheduler or weakening path, snapshot, dependency, verification, AGENTS, or isolated-preflight checks.

## Decisions

### 1. Split stable registration from dynamic attempts

Implement uses a strict `open-task | phase-attempt` run union. `open-task` contains one `TaskBoundary` and its first Red `PhaseAttempt`; every later attempt contains only change/task/request identity, phase, and a fresh bound snapshot. Role and output are fixed by the Implement branch rather than caller fields.

Admission validates the complete boundary synchronously: initial Red, exact regular-file phase writes, contained reads, root uniqueness and non-overlap, duplicate-free set-like arrays, approved dependency and impact-closure shape, AGENTS contract, and a complete initial snapshot. Design and Diagnose retain their existing envelopes. A second open or an identity/transition mismatch is a protocol error; no canonical serializer, digest, equality comparator, or compatibility alias is introduced.

### 2. Make one task record the stable source of truth

`src/worker.ts` owns a registry keyed by canonical workspace root plus change and task. Each `TaskRecord` pins the selected Provider/model identity, immutable boundary, derived conflict declaration, and one `TaskState`:

- `ready(phase, launchIndex, correction?)`
- `candidate-pending(phase, launchIndex, originRequestId, resultId)`
- `agents-checkpoint-pending(finalPhase, attemptIndex)`
- `blocked(phase, failure)`
- `completed(finalPhase)`

The registry retains terminal facts until drain but excludes them from conflict admission. It does not copy separate task/phase contracts or infer a changed-contract reason.

### 3. Preserve typed producer failures and retained identity

Candidate and task failures are closed discriminated unions. Each producer keeps a colocated closed code set; free text is display or bounded correction evidence only. `src/submit-tool.ts` and `src/child-session.ts` minimally distinguish typed structural, cancellation, timeout/transport, and result-limit failures so Runtime never recovers control state from `error` text.

Candidate preflight renames its former Design class to `approval-boundary`. `applyRetainedPatch()` and the AGENTS checkpoint return typed success/failure results instead of interpolated strings. Unknown exceptions throw.

`ResultStore` binds every retained candidate to stage, canonical root, change, task, originating request, phase, launch, exact write/dependency facts, and snapshot. Implement apply/discard supplies only the current operation request plus result ID and typed rejection; Runtime resolves all retained identity itself. An artifact discard may add bounded evidence but cannot patch the boundary.

### 4. Use one bounded transition table

Each phase permits two non-cancelled child launches shared by artifact, stale, and transport failure. The first eligible transport failure may redispatch identically inside the invocation; the first eligible stale or artifact failure permits one later attempt with refreshed snapshot or bounded evidence. The second eligible failure blocks as attempts exhausted. Cancellation preserves state and budget; result-limit, environment, and approval-boundary failures are terminal.

Only successful isolated preflight plus exact apply advances a phase. Red advances to Green, Green advances to Refactor when declared, and the final phase advances to completed or AGENTS checkpoint pending. Checkpoint has its own two parent attempts for artifact/stale correction. Final ordinary Git apply remains authoritative once its non-interruptible apply starts.

Blocked/completed replay returns the cached fact with the current operation request ID without snapshot currentness, child launch, preflight, apply, budget use, or reclassification. `completed` is task-local and does not replace parent affected/full-suite acceptance.

### 5. Keep task lifetime in Runtime and scheduling in Scheduler

Runtime derives one conflict declaration from every phase read/write union, explicit conflicts/resources, verification locks, and a non-none parent-owned AGENTS target. Before registration it compares that declaration with all nonterminal task records. A conflict returns immediate `deferred` without registration, queueing, waiting, or launch consumption.

The declaration remains active across phase gaps and candidate/checkpoint pending states and releases at blocked, completed, or drain. `src/scheduler.ts` only generalizes its existing pure conflict predicate to accept a small declaration type; it retains no TaskRecord, reservation, waiter, lease, or cross-call state.

### 6. Return domain outcomes and throw protocol/internal errors

Implement returns its domain union directly: deferred, candidate, applied, checkpoint-required, retry, completed, blocked, or cancelled. It does not wrap those outcomes in `ok/action/recovery`, claim dependent successors, or expose a user recovery command.

The extension returns valid domain outcomes normally. Unknown action/schema, duplicate open, illegal transition, root/change/task/provider identity mismatch, result binding mismatch, illegal candidate-pending operation, and internal invariant failure throw through `abel_dispatch.execute`. The locked Pi 0.84.1 contract then produces the real Agent Loop `isError`; returning a synthetic property is removed. The existing real-Agent-Loop test fixture is extended without installing an `isError`-rewriting hook or creating a Provider test platform.

TUI maps candidate/applied/completed to success, deferred/retry/checkpoint-required to warning, blocked/cancelled to neutral, and thrown errors to Pi's error presentation. Presentation metadata remains absent from print/JSON/RPC domain payloads.

### 7. Delete the old control channel package-wide

`DiffResult.nextStep` is removed from the shared contract, structural submit schema, implementation and diagnosis Agent output, fixtures, and TUI summaries. Diagnose otherwise retains its envelope and regression-first algorithm. Implement Prompt and shared Skill no longer contain Design recovery or next-workflow recommendations; the Design Prompt is updated only to emit the new fixed boundary/task contract. The contract reviewer reports delivery-invalid or approval-boundary evidence without selecting another stage.

No alias, dual parser, dead enum, fallback rendering, or migration shim remains for the unreleased protocol.

### 8. Keep parent gates, baselines, traceability, and AGENTS ownership external

The five tasks execute strictly `S1 → S2 → S3 → S4 → S5`; their overlapping Runtime writes make every task serial. Each task performs delegated Red, Green, optional Refactor, target verification after every applied diff, affected verification, and a parent-only AGENTS checkpoint when declared.

S1–S4 update only the managed block of root `AGENTS.md` at stable checkpoints because each changes indexed module ownership; S5 changes no route ownership and declares no AGENTS write. Worker scopes always exclude AGENTS and OpenSpec receipts/tracking.

The historical `scripts/traceability-check.mjs` remains unchanged. This change owns every delta Scenario exactly once in `tasks.md`; Gate B review, receipt hashes, a dedicated read-only reference audit, and strict OpenSpec validation prove the new graph. The historical command remains a regression check.

Target, affected, and full-suite baselines are rerun after trusted delivery and before any product/test write. No baseline result is stored in the repository.

## Risks / Trade-offs

- [Wide unreleased protocol cutover invalidates many local fixtures at once] → S1 owns every known Implement-envelope fixture and no old parser survives.
- [Typed conversion can accidentally weaken currentness or exact apply] → S2 changes representation only and keeps isolated bundle reconstruction, full diff consumption, dependency screening, ordinary Git checks, exact bytes, and deterministic cleanup in its affected suite.
- [Repeated Runtime edits can conceal transition regressions] → Five tasks are strictly serial and every accepted phase reruns its task target before the next phase or task.
- [A task record could become a hidden scheduler or recovery platform] → The state vocabulary, two-launch budget, two-checkpoint-attempt budget, no-wait behavior, and drain boundary are closed in the contract.
- [Tool error tests could validate the wrong layer] → The test drives a real Agent Session and asserts final ToolResult flags; direct `execute()` return fields and flag-rewriting hooks are excluded.
- [Package-wide `nextStep` removal could alter Diagnose] → S5 changes only the shared field and fixtures, with existing diagnosis stage contracts retained in the affected suite.
- [Dirty baseline could be overwritten or misattributed] → Every Worker diff is snapshot-bound and parent-reviewed; unrelated hunks are preserved and full-suite comparison uses fresh pre-write evidence.

## Migration Plan

1. Validate the Gate receipts, hashes, strict change, trace ownership, and dirty baseline.
2. Execute S1 through S5 in order using delegated Red-Green-Refactor and parent-only exact application.
3. Delete the old request/recovery/comparator/string-classification/`nextStep` paths as their replacement slice becomes green; do not leave aliases.
4. Run target and affected commands at every task checkpoint, then the complete repository acceptance commands and compare against baseline.
5. Leave the OpenSpec change active for an explicitly authorized archive; do not commit, publish, release, or archive automatically.

Rollback during development is a targeted reversal of only this change's accepted diffs while preserving the pre-existing dirty baseline; it is not a runtime compatibility mode.
