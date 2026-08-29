## Context

The current implementation already has durable Design facts, receipt-schema-v4 Gate proofs, a stable Implement run, and explicit user-owned stage selection. The remaining failures sit at the seams: Design receipt files are mutated before a unique durable finalization owner exists; approval legality is projected separately from command enforcement; newer receipts are known to Design but not discoverable by a fresh Implement status; and child read confinement is stronger than the parent Design tool boundary.

The package is internal and has no compatibility requirement. The public constraint is only that the four existing slash commands remain unchanged.

## Goals / Non-Goals

**Goals:**

- Make finalization single-owner and recoverable across processes without holding a SQLite transaction across OpenSpec inspection or filesystem I/O.
- Make status, command enforcement, and Gate requirements derive from the same closed facts.
- Close the fresh-context user journey without automatic stage execution.
- Turn the parent Design product-code read-only rule into an actual tool capability boundary.

**Non-Goals:**

- No new slash command, public orchestration API, background watcher, migration adapter, or general filesystem transaction framework.
- No automatic admission or resume merely because a receipt appears.
- No attempt to classify arbitrary third-party tools as read-only.

## Decisions

### 1. One expiring durable lease per Design run

Add a small `design_finalization_leases` table keyed by `run_id`, with operation id, random token, and expiry. Acquisition occurs in `BEGIN IMMEDIATE` before any receipt removal or inspection. A different unexpired owner receives `design-finalization-busy`; an expired owner can be replaced, after which the new operation revalidates from the start. The owner token is asserted immediately before receipt installation and private commitment, then released in `finally`.

This is preferable to holding a SQLite transaction across asynchronous OpenSpec commands, which would block the shared run database, and preferable to a process-local mutex, which would not protect fresh processes. The existing journal-first/run-transition-second ordering remains: its replay convergence is already safe once competing filesystem mutation is excluded.

Cleanup compares the installed raw receipt hash with the current operation's bytes before unlinking. This provides a second fence if a lease expires at an unfortunate boundary.

### 2. Closed approval facts and strict state commands

Replace regex classification and the default category with an exhaustive record keyed by all accepted approval codes. Internal path-boundary codes are explicit members. Creating or projecting `approval-needed` with an unknown code is an integrity error.

`rebind` accepts only paused/retryable transport-style states. `resume` in approval-needed requires both newer revision and receipt hash and rejects a missing or non-new pair before delivery loading. This makes `legalCommands` descriptive of executable behavior rather than UI advice.

### 3. Lightweight local discovery, full admission on resume

Extend the internal delivery source with `discoverLatest`. The package implementation reads only `ready.yaml` and its Gate-A receipt, checks their raw binding, change, revision, and both current private Gate proofs, and returns `{deliveryRevision, receiptHash}`. It does not run OpenSpec, inspect every artifact, change a run, or contact a Worker.

After any command returns an approval-needed Implement projection, the engine decorates it with a newer discovered pair when available. At that point `resume` becomes immediately legal and the exact pair appears in both `availableDelivery` and the structured resume command. Actual resume still calls the existing full loader and admission path, so discovery is never authority by itself.

This is preferable to copying receipt data through prompts and preferable to Design mutating an Implement run, which would be an automatic cross-stage action.

### 4. Snapshot, restrict, and restore Design parent tools

On entry to verified Design, snapshot active non-dispatch tools and expose only the intersection with `read`, `grep`, `find`, and `ls`, plus `abel_dispatch`. Unknown tools are treated as potentially mutating. On every semantic exit or switch, restore the snapshot before applying the destination stage's normal dispatcher lifecycle.

Because Design must still author OpenSpec, add `write-artifact` and `delete-artifact` to the existing private Design action family. The controller resolves the active run's change and admits only `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, `specs/<safe segments>/spec.md`, and `plan-draft.json`. Code-owned `gate-a.yaml`, `ready.yaml`, and `implement-plan.json` remain unreachable. Writes use safe component observation, bounded UTF-8 bytes, safe directory creation, and atomic rename; deletes accept only an allowed regular file.

This is narrower than adding a new public tool and more enforceable than maintaining a blacklist of known shell/edit names.

### 5. Test the seam, not only each component

Retain component tests for journal, delivery, and activation, and add one extension-level journey that begins in Implement approval-needed, explicitly switches to Design, finalizes, re-enters Implement in a fresh parent context, discovers the receipt, and resumes the same run. Package/distribution assertions continue to enforce exactly four prompts.

## Risks / Trade-offs

- **A finalization exceeds its lease** → use a conservative bounded TTL, assert ownership before mutation/commit, and hash-fence cleanup; a later operation restarts validation rather than adopting partial work.
- **A legitimate custom read-only tool is removed during Design** → intentionally fail closed; evidence children retain the package-owned read tool set, and the original parent tool set is restored on exit.
- **Discovery sees a valid receipt whose other artifacts are corrupt** → expose it only as a candidate; full resume admission remains authoritative and returns aggregated diagnostics.
- **Large artifact content expands a private tool call** → retain the existing 16 MiB ceiling and UTF-8 requirement; normal OpenSpec artifacts remain far below it.

## Migration Plan

The private database schema is bumped without a compatibility reader. Tests and internal development runs start with the new schema. Update prompts and the shared Skill together with code, run targeted Red-Green-Refactor suites, full package verification, fresh-process acceptance, exact traceability, and strict OpenSpec validation before archiving this change.
