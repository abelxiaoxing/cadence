# Named branches and adaptive worktree delivery

One approved local delivery has one named branch and one stable candidate worktree; assignments that run side by side each use a temporary child worktree beside it.
`Workflows` remains the execution owner; `AssignmentRunner` and `VerificationGate` (`workflow-controller.ts`) separate remaining-obligation assignment closure from candidate verification/review convergence, `workflow-review-ledger.ts` tracks behavior families privately, `workflow-links.ts` manages narrow dependency symlinks, and `project-knowledge.ts` keeps verified learning.
This is not a second executor, fixed task pipeline, Git daemon, sandbox or transactional application system.

## Entry and authorization

Enabling `/cadence`, discussing a goal, researching, refreshing or reconnecting creates no Git branch or worktree.
Only admission of a freshly approved version-4 `local-merge` agreement (`task-branch-v2`) authorizes creation; earlier agreements (`task-branch-v1`) remain readable readonly.
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

The branch is `refs/heads/cadence/<sanitized-goal>-<full-run-id>`, atomically reserved at the baseline commit when the candidate is prepared and advanced only to the final signed-off delivery commit right before `merge --ff-only`.
The goal is a readable label; the unique run ID is the identity, and existing refs/paths are never adopted or overwritten.
The stable candidate lives at `<stateHome>/cadence-worktrees-v1/<project-hash>/<run-id>/integration` on a detached HEAD (`task-branch-v2`), pinning intermediate development, sibling-merge and delivery commits under private refs (`refs/cadence/runs/<run-id>/checkpoints/<n>`) with intent-before-ref journaling so Git GC never reaps them while `taskBranch` stays clean.
Before sealing final delivery, the owner builds one single-parent commit (`C0` before knowledge curation, or `C1` if shell-free knowledge curation edits files) directly on top of the verified target frontier via `git commit-tree` + `git reset --soft`.
Only after confirmed post-merge checks and confirmed worktree removal are this run's confirmed private checkpoint refs deleted by exact expected OID; `taskBranch` is always retained, and failure, cancellation or unknown closure retain both worktrees and private checkpoint refs.
Owner-managed dependency links declared in `plan.links` (`workflow-links.ts`) record parent and symlink `dev`/`ino`/`target` before confirming and are unlinked strictly before `worktreeResidue()` only when that exact identity still holds; any replaced or retargeted entry refuses unlink and retains the worktree.
The candidate collects all work, and checks, review, knowledge maintenance and recovery of the combined result use it.
`Workflows.assignments` schedules the current route until none of its assignments is left: the agreement's, as plan revisions changed the ones that had not started (`WorkflowTaskState` lists every one, a dropped one as `superseded`, each with the revision that last changed it).
One whose dependencies are integrated and whose write paths no running assignment owns is ready; up to the execution limit (`parallelLimit`) run at once and the rest wait.
A revision wakes the scheduler, so an added assignment can start beside the ones already running; a dropped one never starts and running siblings carry on.
With nothing running and exactly one ready assignment, it runs in the candidate itself, so a serial plan never creates another worktree and keeps predecessor and partial-attempt outputs in place.
When several are ready, what the candidate holds is committed first and each gets a child worktree at `<run-id>/tasks/<assignment-id>`, detached at the candidate's commit (it never owns or moves a branch) and recorded as a `DeliveryArtifact`.
Only setup commands placed at `worktree` run in each child (the placement contract is in [checks and review](checks-review.md)); its worker and its own recovery are confined to the paths it owns (its declared writes plus what its revisions add, never a path a running sibling owns).
A child remains a fork-time snapshot: later completed siblings are in the combined candidate, not necessarily in that child.
Worker placement names its assignment, fork and relative readonly candidate location; assignment reports judge their own work, not missing sibling or queued build outputs.
Before widening a child's repair scope, recovery compares its fork with the current candidate's committed paths, repeating the comparison if integration advanced during that read.
Paths already changed there are repaired through a queued follow-up after the required dependencies, not recreated in the old child; unrelated repository-local additions remain allowed, and current running ownership is checked after those asynchronous reads.
On success the owner commits that scope in the child, cherry-picks the commit onto the candidate (still one parent per candidate commit) and removes the child with plain `git worktree remove` only when nothing at all is left in it.
Because assignments that run together never own the same path a pick cannot conflict; whether their results fit together is decided by the combined checks and review, and repaired in the candidate.
After one assignment fails for good, nothing further starts or is integrated, every started one is joined, and unintegrated work stays in its retained child worktree.
Direct working-copy delivery has no worktrees and always runs one assignment at a time.
Earlier detached task worktrees stay untouched.
`worker-workspace.mjs` still only maps the pinned conversation-relative cwd into the selected tree.
The Pi conversation, its cwd/model and the user's original branch are not moved or copied.

Creation intent precedes Git effects; actual registration, common directory, branch, HEAD and filesystem identity are checked before worker use.
A partial creation remains visible and retained, not reported as atomic success.
Local delivery requires Git with `--no-lazy-fetch`, an existing branch, commit identity and no unfinished Git operation.
Workers leave edits uncommitted; a local-delivery agreement's commits belong to the owner.
An unrecorded candidate or assignment HEAD refuses with its worktree path, expected and observed commits; files and commits are retained without adoption or replay.
Missing partial-clone objects refuse instead of triggering downloads.
Declared targets must be clean, nonignored and visible in the index; unrelated user changes stay allowed and are never stashed, reset or copied into the candidate.
Dependencies do not travel with a worktree: any setup needs explicit agreement commands, never automatic copying or installation.
Host tools and Git filters are not an OS sandbox.

## Original lifetimes and shared repository coordination

Linked worktrees share refs even when their checkout roots differ.
Recorded Git mutation groups take a lease keyed by the common directory, after the checkout permit when the stage touches the target.
Isolated implementation holds its workspace reservation, not a target checkout permit, so other candidates can start and deliver while it works.
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
The main adaptive controller preserves partial outputs, diagnoses settled failures and revises the route, including its write scope inside the repository boundary and, as a last level, a recorded deviation; the approved goal, decisions, acceptance, assumptions, declared commands and closure protections remain authoritative (see [checks and review](checks-review.md)).
Worker failures, rejected/unparseable review and check failures retain their actual evidence.
Repeated unchanged evidence and an identical approach move the decision up a level and cannot become an endless retry loop.

Every local verification round:

1. Checks owned placement and the last owner-recorded HEAD, preserving legitimate uncommitted partial work.
2. Commits only the run's current write scope (the agreement's plus what recorded revisions added), including approved documents and owner-generated delivery notes when applicable.
3. Records the exact candidate commit/tree and invalidates earlier acceptance.
4. Runs the declared real checks and, if the gating checks pass, a separate readonly Agent review (unchanged accepted candidates follow the [exact-evidence reuse rules](checks-review.md)).
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
Before its first delivery, only a verified sibling on the same branch whose own post-checks passed may advance a pending run's in-memory frontier.
The frontier exists from admission, even while the run is queued before its first checkout permit.
Start preflight compares the target checkout to that frontier and refuses overlapping writes or changed instructions before setup; candidate creation still uses the original approval commit.
Under exclusive checkout access, the candidate merges that frontier without rewriting either history, moves its own diff base to the sibling commit, and repeats checks and automatic Agent review before knowledge maintenance and publication.
Managed knowledge is curated only after refresh under that same exclusive permit: independent implementations must not conflict merely because both deliveries maintain the shared store.
The candidate scope and Review's fixed-revision evidence therefore exclude incorporated sibling paths; overlapping writes or any changed `AGENTS.md` refuse the refresh.
External target movement, a branch switch or overlapping user edits block delivery and preserve the candidate; a merge conflict is retained without automatic resolution.
Only this run's independently confirmed merges advance its post-merge recovery baseline.
Post-merge failures keep the actual merge and checks visible.
Recovery edits the same owned candidate, invalidates acceptance and reruns checks/review; another merge is allowed only while the target still equals this run's last confirmed delivery.
The user's unrelated index is never committed, and no automatic rebase, force update, reset or rollback is attempted.
Failed or unknown post-checks never advance a sibling frontier; restart retains no resumable in-memory frontier.
Ignored/dirty generated workflow notes retain their separate expected-byte publication rules and are not claimed to belong to the accepted Git candidate.

`DeliveryObservation` separates preparation/workspace state, current candidate acceptance, actual integration, post-checks and cleanup.
A previously applied merge stays independently visible when a later candidate is not yet accepted or cannot integrate.
Terminal and WebUI show those owner facts, not model prose.
A target-position refusal names the detection stage, expected ref/commit and the ref and HEAD read at that check (including detached or unreadable values); no history view fills them in later.
A settled pre-worktree refusal has no executed candidate or acceptance stage; a missing candidate seal after preparation, or an interrupted run without evidence, is not proof that edits were lost.

Successful delivery keeps the named branch.
Worktree removal requires successful post-checks, confirmed original settlement, exact ownership/ref/HEAD, delivered ancestry and no uncommitted, untracked, ignored or index-hidden residue anywhere.
Only ordinary `git worktree remove` and removal of already empty parent directories are used; no force, recursive deletion or branch deletion is automatic.
Failure, cancellation, unknown closure, a blocked repair or unmet cleanup conditions retain the artifacts.
Departure detaches; Cancel/Stop retains actual closure semantics.
Restart marks incomplete stages unknown without resuming implementation, commits, integration or cleanup.

## Regression owners

- `task-worktree`: real Git branch/ref/candidate/scope (`task-branch-v1` retained and `task-branch-v2` detached checkpoints, private refs, single-parent sealing, exact ref cleanup), exact acceptance, repeated deliveries and residue retention.
- `workflow-links`: owner-managed dependency link validation, identity-recorded provisioning, safe unlinking under trailing-slash `.gitignore`, and refusal/retention when replaced, retargeted or accompanied by unknown ignored residue.
- `workflow-review-ledger`: behavior-family convergence (`ReviewLedger`), V4 review verdicts/reports, Stage 4 fast+pre-review ordering before heavy checks, and POSIX process-group settlement gating for timed-out checks.
- `workflow-delivery-runtime`: adaptive owner plus `AssignmentRunner`/`VerificationGate` with controlled native/worker ports; optimistic Stage 5 `C0` checks before `exclusive`, shell-free zero-edit `learn()` same-OID `C0` reuse vs `C1` re-verification, private-only reports, `target:skip` with mandatory ref/source checks, post-merge repair on top of merged history, changed targets, cancellation and crash checkpoint-intent recovery.
- `workflow-delivery-admission`: proposal/receipt persistence and bound target; the longer full admission case remains slow.
- `repository-coordination`, `repository-recovery`: original-operation leases, managed-owner refusal and exact-epoch archive/recovery boundaries.
- `workflow-delivery-runtime`: overlapping implementations and delivery while a sibling still works, refresh-before-curation ordering, final guidance and post-check branch/HEAD fences (controlled ports).
- `workflow-parallel`: successful-sibling frontier advancement, real Git candidate merge and fresh acceptance, external/overlapping/guidance refusal (slow diagnostic).
- `change-tools`, `worker-toolkit`, `workflow-runtime`: readonly fixed-revision capabilities, complete review interpretation and original-resource lifetime.
- Native/Web workflow tests retain separate client approval, execution context and display contracts.

Follow [verification](verification.md): `bun run verify` is the sole integration gate.
Controlled tests do not qualify paid providers, a real browser, service managers or unexecuted platforms.
