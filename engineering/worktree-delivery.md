# Named branches and adaptive worktree delivery

One approved local delivery has one named branch and one stable candidate worktree.
`Workflows` remains the execution owner; `DeliveryController` keeps evidence-led recovery and `project-knowledge.ts` keeps verified learning.
This is not a second executor, fixed task pipeline, Git daemon, sandbox or transactional application system.

## Entry and authorization

Enabling `/cadence`, discussing a goal, researching, refreshing or reconnecting creates no Git branch or worktree.
Only admission of a freshly approved version-2 `local-merge` agreement authorizes creation.
Each new admitted delivery has its own run ID, branch and worktree; clarification and recovery within that delivery reuse them.
Completion keeps conversation mode enabled; a new goal still needs its own agreement and approval.
`working-copy` remains separately explicit, never a fallback after isolated delivery fails.

An owner-generated `DeliveryBinding` participates in both the proposal digest and fresh observation:

- canonical target checkout and shared Git common directory;
- repository incarnation, complete local branch ref and approved baseline commit;
- the named-branch creation, acceptance, integration and retention policy.

The target is the owner's current local branch, never a hard-coded main or a model-selected remote.
Changing the binding invalidates approval; old proposals without it remain readable but cannot execute local delivery.
Both native and WebUI show the target/ref/base and delivery policy before confirmation.
Native raw-terminal and browser conversation/attachment consent stay independent adapters to the same owner.
There is no implicit fetch, pull, push, deployment or switch of the user's checkout.

## Placement and ownership

`workflow-delivery.ts` owns one candidate's resources, exact acceptance preflight and safe cleanup.
`repository-coordination.ts` owns short shared-repository mutation leases and indexed workspace ownership.
`workflow-git.ts` owns bounded Git identity, ancestry, scope and residue observations; `contracts/workflow.ts` owns the closed portable DTOs.
Git mutations still run through the workflow's recorded native runner, including the noninterruptible target fast-forward.

The branch is `refs/heads/cadence/<sanitized-goal>-<full-run-id>`.
The goal is a readable label; the unique run ID is the identity, and existing refs/paths are never adopted or overwritten.
The stable candidate lives at `<stateHome>/cadence-worktrees-v1/<project-hash>/<run-id>/integration`.
All implementation, diagnosis, recovery and knowledge assignments use that candidate; there are no new per-subtask worktrees or cherry-pick handoffs.
Earlier detached task worktrees stay untouched.
`worker-workspace.mjs` still only maps the pinned conversation-relative cwd into the selected tree.
The Pi conversation, its cwd/model and the user's original branch are not moved or copied.

Creation intent precedes Git effects; actual registration, common directory, branch, HEAD and filesystem identity are checked before worker use.
A partial creation remains visible and retained, not reported as atomic success.
Local delivery requires Git with `--no-lazy-fetch`, an existing branch, commit identity and no unfinished Git operation.
Missing partial-clone objects refuse instead of triggering downloads.
Declared targets must be clean, nonignored and visible in the index; unrelated user changes stay allowed and are never stashed, reset or copied into the candidate.
Dependencies do not travel with a worktree: any setup needs explicit agreement commands, never automatic copying or installation.
Host tools and Git filters are not an OS sandbox.

## Original lifetimes and shared repository coordination

Linked worktrees share refs even when their checkout roots differ.
Recorded Git mutation groups take a lease keyed by the common directory, after the existing checkout permit.
They never hold that short lease while waiting for a worker, check, model or another checkout.
The account registry's short lock is not held across Git/model execution.
Lease wait and active-resource bounds live in `repository-coordination.ts`; no live lease expires by age.

Creation intents are indexed by owner root and epoch before shared reservations are written.
Release joins original native/auth/storage settlement, not an observer timeout or rejected promise.
Unconfirmed closure or failed persistence quarantines the owner and retains fences for existing recovery.
After its exact holder/worker checks, the owner healer may release a dead epoch's coordination records, never Git refs, worktrees or user files.
Confirmed workspace identity remains beside the run; completed history does not grow the account's active lease index.
Damaged records are archived; an unidentifiable shared holder needs explicit doctor confirmation, and a replacement owner's valid resource stays untouched.

Managed worktrees cannot acquire a second project owner, even after settlement.
Directory inspection does not grant takeover authority.
Coordination covers one state home, not arbitrary external Git commands, other accounts or other state homes.

## Exact candidate acceptance

There is no delivery-duration or fixed repair-round quota.
The main adaptive controller preserves partial outputs, diagnoses settled failures and changes the in-scope route; original scope, commands, acceptance and closure protections remain authoritative.
Worker failures, rejected/unparseable review and check failures retain their actual evidence.
Repeated unchanged evidence and an identical strategy cannot become an endless retry loop.

Every local verification round:

1. Checks owned placement and the last owner-recorded HEAD, preserving legitimate uncommitted partial work.
2. Commits only the approved scope, including approved knowledge and owner-generated delivery notes when applicable.
3. Records the exact candidate commit/tree and invalidates earlier acceptance.
4. Runs the declared real checks and a separate readonly Agent review.
5. Rechecks source identity, candidate HEAD, index, worktree and complete committed scope before recording current check/review references bound to the agreement and execution context.

Checks that change approved source require a new candidate and fresh verification; changes during readonly review refuse stale evidence.
Editing attempts invalidate acceptance before dispatch.
A structured assignment report is not check success, and `humanReviewed` remains false.
Knowledge maintenance uses the main source-backed selector and approved existing documents, followed by combined-candidate checks/review; proposal prose never becomes project truth.
Full-message verdict parsing and diagnostic clipping retain the main review semantics.

Only a trusted review request receives fixed root/base/candidate Git observations through `changes`.
That tool streams paths, patches and base/candidate content with worker-local one-use cursors and actual-child closure, without arbitrary refs, shell, writes or source copies.
Incomplete, binary or unavailable evidence cannot be labelled complete.

## Integration, recovery and retention

Under a repository mutation lease, delivery rechecks acceptance, exact candidate/ref/workspace, committed scope, ancestry, target repository/branch and target cleanliness.
It merges the fixed candidate OID using the existing noninterruptible `merge --ff-only`, then independently observes the actual target ref/HEAD.
Unknown results never trigger replay.

The original approved binding is immutable.
Only this run's independently confirmed merges advance its integration baseline; external target movement, a branch switch or overlapping user edits block delivery and preserve the candidate.
Post-merge failures keep the actual merge and checks visible.
Recovery edits the same owned candidate, invalidates acceptance and reruns checks/review; another merge is allowed only while the target still equals this run's last confirmed delivery.
The user's unrelated index is never committed, and no automatic rebase, force update, reset or rollback is attempted.
Ignored/dirty generated workflow notes retain their separate expected-byte publication rules and are not claimed to belong to the accepted Git candidate.

`DeliveryObservation` separates preparation/workspace state, current candidate acceptance, actual integration, post-checks and cleanup.
A previously applied merge stays independently visible when a later candidate is not yet accepted or cannot integrate.
Terminal and WebUI show those owner facts, not model prose.

Successful delivery keeps the named branch.
Worktree removal requires successful post-checks, confirmed original settlement, exact ownership/ref/HEAD, delivered ancestry and no uncommitted, untracked, ignored or index-hidden residue anywhere.
Only ordinary `git worktree remove` and removal of already empty parent directories are used; no force, recursive deletion or branch deletion is automatic.
Failure, cancellation, unknown closure, a blocked repair or unmet cleanup conditions retain the artifacts.
Departure detaches; Cancel/Stop retains actual closure semantics.
Restart marks incomplete stages unknown without resuming implementation, commits, integration or cleanup.

## Regression owners

- `task-worktree`: real Git branch/ref/candidate/scope, exact acceptance, repeated deliveries and residue retention.
- `workflow-delivery-runtime`: adaptive owner plus delivery controller with controlled native/worker ports; partial work, recovery beyond old quotas, verified knowledge, exact final acceptance, post-merge repair, changed targets and cancellation.
- `workflow-delivery-admission`: proposal/receipt persistence and bound target; the longer full admission case remains slow.
- `repository-coordination`, `repository-recovery`: original-operation leases, managed-owner refusal and exact-epoch archive/recovery boundaries.
- `change-tools`, `worker-toolkit`, `workflow-runtime`: readonly fixed-revision capabilities, complete review interpretation and original-resource lifetime.
- Native/Web workflow tests retain separate client approval, execution context and display contracts.

Follow [verification](verification.md): `bun run verify` is the sole integration gate.
Controlled tests do not qualify paid providers, a real browser, service managers or unexecuted platforms.
