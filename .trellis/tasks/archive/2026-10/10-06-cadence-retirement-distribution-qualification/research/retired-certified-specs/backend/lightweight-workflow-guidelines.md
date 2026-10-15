# Lightweight Workflow Assistant

## Current authority

The user explicitly approved replacing certified autonomous execution/transaction application with a trusted Pi workflow assistant.
Current requirements/design are in the active G6 task's `prd.md`, `design.md`, `implement.md` and `research/lightweight-approval.md`.
This guide is the approved target during implementation; independent validation must establish implemented behavior before claiming completion.

Incompatible certified-runtime specs are HISTORICAL: they do not require retaining G3 proof graphs, seals, custom scheduling, private SQLite application/Completion or universal original-family closure in the new product.
Their failed results/preimages remain evidence for that retired contract, not passes.
Do not copy AGPL Trellis source into MIT Cadence.

## Minimal responsibilities

- One terminal-only `/cadence` facade, one foreground controller, small record store, ordinary SDK process/check runner and readonly diff projection.
- Native consent covers a displayed plan/work session; direct agent edits use host tools and are not certified future bytes, a sandbox or atomic multi-file application.
- Preserve current task/context across UI awaits with generation/revision checks, not a general permit registry.
  No model-callable task controller or script/RPC bypass.
- One Cadence-owned run per checkout, supported-writer coordination, explicit cancel/Continue/recovery.
  Ordinary chat/startup/replay/open/list never launches or creates task infrastructure.
- Worker success is not a test pass; parent commands and human review remain separate.
  No automatic retries, Git, installation, reset/cleanup, knowledge promotion or publication.

## State, safety and privacy

Project records use new `.cadence/assistant/tasks/<uuid>/task.json` and distinct magic/schema `cadence-workflow-assistant/1`; optional check configuration is `.cadence/assistant/config.json`.
Records are bounded human-readable context with goal/plan/result/check metadata/activity, not transcripts/raw logs/credentials.
Private `cadence-assistant-v1/<checkout-hash>` stores bounded sanitized diagnostics and coordination.

Absent observation stays absent.
Reject unsafe/linked/oversized/corrupt/unknown state without reset.
Atomic single-record writes and short write coordination suffice; no multi-file recovery/publication machinery.
Never open/migrate/delete old Cadence SQLite, approval, candidate, journal or uncertain resource data.

An active new lock excludes supported concurrent writers.
Normal owner release follows observed child close.
Unknown stop is not success and retains its lock.
Explicit stale-lock recovery requires informed native confirmation, dead/unchanged owner facts and no automatic process killing or consumer cleanup; it does not certify escaped descendants stopped.
External editors, old-version runtimes and arbitrary same-user code are outside this coordination guarantee; surface that limitation honestly.

## Host/runner API boundaries

Read actual Pi docs/types/examples before changing host bindings; global docs and installed peer can differ.
Use ctx mode/cwd/trust/idle/queue/model/session data.
`hasUI` alone admits RPC and is insufficient.
Command dispatch precedes input hooks; retain a small actual raw-terminal occurrence gate if needed, not fictional source fields.
Native dialogs/pagers/progress must handle Escape, stale responses, width/Unicode/resize and regular/fullscreen terminals.

One SDK child avoids Pi CLI startup migration/cleanup.
Resolve current request auth through public `modelRegistry.getApiKeyAndHeaders`; send bounded data by anonymous stdin, never credential argv/files/logs.
SDK runtime/settings/session/model/credential stores and resource loader are in-memory/explicit; disable automatic model-catalog refresh/downloads/discovery/retries/compaction.
No private runtime casts or silent model/API fallback.

Use official fixed-allowlisted API adapters and a native provider resolver for the exact resolved parent model/auth.
Resolved header/key values are LITERAL: never put them through config interpolation (`!` command/`$` expansion).
Function-defined custom provider behavior that cannot be reproduced refuses explicitly.
Auth can expire; a later explicit run resolves it again.
This is not token-lifetime certification.

Code-owned role tools: research/planning/diagnosis read-only; editor ordinary host editing/shell tools under user consent and instructions.
Tool names/cwd are not a sandbox.
Emit bounded lifecycle/tool names and final results, not raw tool payloads/thinking/auth.
Actual settled final message plus normal child close is required for worker-completed, but does not prove code correctness.
Cap prompt/output/line/events/time; refuse malformed/missing/incomplete/nonzero results.
Parent cancellation/timeout never becomes completed merely because exit0 follows.

POSIX group cancellation and Windows direct-child cancellation are operational features, not equal containment guarantees.
Wait boundedly and report unconfirmed close honestly.
No retired Windows Job/helper or Bubblewrap contract is silently inherited.

## Checks, review and data preservation

Execute only actual user-confirmed configured/manual check commands, with cwd/timeout visible.
Command strings are deliberately approved shell input; never interpolate task titles or model suggestions into them.
Record native exit/duration and bounded sanitized output.
Preserve failed/unrun/stale status even when a human closes a task as reviewed-with-issues.

Observe project changes at Start/check/review boundaries, not low-level I/O.
Show staged AND unstaged changes, untracked/deleted/renamed/binary files, baseline dirt and coverage limits; disable Git external diff/textconv and never mutate the index.
Distinguish administrative Cadence records from business changes.
Non-Git inventory must expose exclusions/limits.
Changed inputs invalidate check/review freshness; no target-only/CAS/sealed-application claim exists.

## Retirement and qualification

Delete obsolete production owners/generated consumers only from an exact reviewed inventory with preserved preimages and assertion dispositions.
Port retained consent/process/privacy/user-data/diff/check/package behavior; retire assertions whose product guarantee the user explicitly relinquished.
A smaller test count is not acceptance, and historical5547/5/9 remains failed/superseded evidence.

Keep standalone research/commit skills, missing-only config install, startup card, three pinned Agent names, MIT/third-party attribution and every-body real archive auditing.
No Trellis runtime dependency.
Package source closure must be genuinely small, not a thin entry importing the old engine.

Fast controller tests and real SDK/process/filesystem/package/PTY tests have separately explicit bounded budgets.
Old5000/1500/60000 certified-engine scenarios must not be retimed and called passed.
Execute a real loopback SDK tool/auth cycle without real credentials/provider cost, actual source/extracted regular/fullscreen production PTYs and frozen-input whole checks before local acceptance.

Release stays version-neutral: record actual Node/Pi/runtime/platform/capabilities; do not impose version predicates or alter engine/peer/dev locks.
Missing native OS, manager-install or physical-human/real-model evidence remains missing.
No automatic Git, dependency installation, task archive or release follows verification.
