# Workflow State and Presentation

## Owners, not a second state machine

`src/service/task-actions.ts#TaskActions` owns actions/current freshness; `src/task-store.ts` persists bounded v1 summaries and the private history writer owns rich committed facts.
Both clients use ServiceClient decoders/projection IDs; TaskController is not a production execution path.
`src/task-shell.ts` owns only native interaction and transient display.
Use the [workflow contract](../backend/lightweight-workflow-guidelines.md) for full signatures and [storage](../backend/database-guidelines.md) for validation/locks.
There is no SQLite store, sealed candidate, certified Completion or restart continuation driver; the finite service graph queue is explicitly admitted and never replayed.

- Raw Enter latch, epoch, modal flag, dialog abort/dismiss: Shell memory for the current host session/interaction.
- Pager offset/rows, progress/canceled/disposed flags: One `ctx.ui.custom` instance; never restored from task records.
- Selected task/command IDs and read cursors: Client memory; grants/active episodes/original promises belong to the owner, not restored consent.
- Goal/plan/result/baseline, check metadata, review and bounded activity: Project `.cadence/assistant/tasks/<uuid>/task.json`.
- Checkout/service locks and rich committed history: Private `cadence-assistant-v1` namespace; no credential envelope or hidden thinking.

## Phases and action results

`TaskPhase` is `planning | running | review | interrupted | failed | done`.
Create starts planning; Edit plan returns to planning and invalidates checks/review.
Agent/check intent is saved before launch; a completed agent moves to review, failure to failed, cancellation/timeout/unknown to interrupted.
Successful Generate plan instead stores an advisory draft and returns to planning; another native Start is required to edit.
Goal-only research/diagnosis use readonly tools and human review, not a manufactured code plan or shell-check obligation.

The live owner distinguishes active work from historical uncertainty; the independent legacy readonly operator projects stored running as interrupted without rewriting bytes.
It restores useful context, not exact execution, old consent or an automatic retry.
Continue uses current files and fresh native consent/auth.
Selected state that is unknown/corrupt/linked/oversized refuses without reset; missing state remains absent.
No historical all-log scan or old consumer-store import belongs on this path.

Shared ContextVersion includes the selected record's raw-byte identity/revision and exact current plan/model context.
Even same-revision content or formatting changes invalidate the choice and final save; external bytes must survive conflicts.
This is ordinary optimistic single-record replacement, not atomic filesystem CAS against arbitrary editors.
Explicit run-ID Cancel closes owner admission and requests concurrent bounded stop; unknown stop/release retains blocking fences.
Direct-child close does not certify escaped descendants stopped.

## Checks and human review are separate facts

`CheckRecord.status` is `passed | failed | canceled | stale`; `not-run` is a projection of missing current configured obligations, not an invented run record.
A recorded check matches an obligation only by name **and command and timeout**.
Duplicate/reserved configuration names refuse rather than ambiguously discharging work.
Display native command/cwd/exit/duration independently from model prose and coverage.
Changed-during-check inputs are stale even with exit zero; later observed changes invalidate check/review freshness.

`ChangeView` supplies `fingerprint`, `text`, `complete`, `git`.
Baseline dirt is not attributed to Cadence.
Gitlinks/submodule internals, ignored/unreadable/oversized/linked content and truncation keep coverage incomplete; bounded non-Git inventory is not an exhaustive snapshot.
Filesystem identifiers preserve whitespace; escape only their display, never `trim()` operational roots.
Own task metadata is excluded from business freshness, but check configuration is not.

The owner review action binds run/change/check revisions and re-observes the fingerprint under its barrier, refusing changed inputs.
Incomplete coverage, non-review phase, missing code checks, unrun configured definitions or non-passed runs require explicit issues acknowledgment.
Persist `review.outcome` as `reviewed` or `reviewed-with-issues`; neither is certified completion and neither changes failed/unrun checks to passed.
The UI must keep prior review visibly stale after later edits.

## Test points

`test/lightweight-store-controller.test.ts`: inert reopen, goal-only readonly, advisory plan, same-revision conflicts/final-save preservation, partial configured execution, issues acknowledgment and unknown-lock retention.
`test/lightweight-process-diff.test.ts`: actual command exits/environment, whitespace paths, index preservation, incomplete submodule/ignored/non-Git coverage and changed-during-check facts.
Wrong: `checks.every(c => c.status === "passed")` proves all configured checks ran.
Correct: project current missing definitions as not-run and require current fingerprint/coverage plus explicit human review.
