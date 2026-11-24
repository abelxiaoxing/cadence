# Replay, conflicts and landing

## Onto the branch as it is now

### Candidates are sealed on their own base and replayed onto the branch's real head

Kind: contract

Why: Local delivery runs detached in `<stateHome>/cadence-worktrees-v1/<project-hash>/<run-id>/integration`, pinning intermediate commits under private `refs/cadence/runs/<run-id>/checkpoints/<n>` refs.
`candidate` seals one commit on the commit the work stands on, reads `refs/heads/<B>` from Git and, when it moved, has `absorb` bring that commit onto the new head; the builds rerun and the result is sealed there.
The merge base is the sealed commit's parent, so a rewritten history is followed too.
Checkpoint refs delete by exact OID only after the landing and residue-free worktree removal; `taskBranch` always stays.

Anchors: `src/service/workflow-delivery.ts#WorkflowDelivery`, `src/service/workflows.ts#candidate`, `src/service/workflows.ts#absorb`, `test/task-worktree.test.ts`, `test/merge-queue-delivery.test.ts`

Source: this delivery, 2026-11-24

### A landing moves the branch to the verified commit and verifies nothing in the user's checkout

Kind: contract

Why: An agreement binds its target branch, not a commit or uncommitted bytes, so one delivery landing never invalidates another's plan card; a run takes the branch's head at admission.
In its `MergeQueue` turn `land` re-reads the branch: unchanged lands the accepted commit as is, moved gets one replay-and-verify attempt in the turn, and a failure there steps aside to repair with the same ticket.
`planLanding` picks compare-and-swap of the ref when no worktree has the branch checked out, Git's fast-forward where one has, and a wait while the branch is being rebased; `AGENTS.md` changes taken in are put before later reviews.

Anchors: `src/service/workflows.ts#land`, `src/service/workflow-landing.ts#planLanding`, `src/service/workflow-landing.ts#observeTarget`, `test/workflow-landing.test.ts`

Source: this delivery, 2026-11-24

## What Git cannot merge

### What a build derives is rebuilt or recomputed, never reconciled

Kind: contract

Why: `twin` replays the sealed commit with every declared `outputs` path as its parent has it (composed in a private index), so derived bytes never enter the merge and the branch's version stands until the builds rerun.
A `refreshes` file both sides changed is put in place once per side, its declared commands run, and the three results are merged: equal values leave only entries both sides changed.
That merge uses the file form of `git merge-file` on private copies, because `--object-id` aborts inside a linked worktree (Git 2.53).

Anchors: `src/service/workflows.ts#twin`, `src/service/workflows.ts#mergeRefreshed`, `src/service/workflow-derived.ts#classifyConflicts`, `test/workflow-derived.test.ts`

Source: this delivery, 2026-11-24

### An unfinished replay stays in the worktree, and each recovery level means something for it

Kind: contract

Why: `settleMerge` hands marked text files to a worker through `ConflictRepair`, whose first answer needs no diagnosis, and paths no marker settles (deleted on one side, links, submodules) to a decision; a file is staged only when every labelled line Git wrote is gone.
The failure text tells whoever decides that `repair` reconciles in place while `replan` or `deviate` gives the merge up: `discardMerge` puts the worktree back on the branch's head before that work starts.

Anchors: `src/service/workflows.ts#settleMerge`, `src/service/workflow-controller.ts#ConflictRepair`, `src/service/workflows.ts#discardMerge`, `src/service/workflow-derived.ts#conflictMarkers`

Source: this delivery, 2026-11-24

### Verified work that cannot land is delivered on the task branch, and the run completes

Kind: contract

Why: `live.accepted` remembers the last candidate that passed checks and review; when the landing ends in a settled failure (branch deleted, recovery exhausted or blocked, uncommitted overlap) `deliverOnBranch` moves the task branch to it, sets `integration.status` to `branch` and makes the reason the first line of the result.
A cancellation, or a landing whose outcome is unknown, is never converted; `failed` is left to runs that never had an accepted candidate.

Anchors: `src/service/workflows.ts#deliverOnBranch`, `src/service/workflow-delivery.ts#retainOnBranch`, `test/workflow-delivery-runtime.test.ts`

Source: this delivery, 2026-11-24

## Uncommitted changes in the checkout

### Uncommitted changes to files a landing changes are saved, then carried over

Kind: contract

Why: `carryOver` saves exactly the overlapping files as a stash-format commit under `refs/cadence/wip-backup/<run-id>` (untracked ones as its third parent), previews both the worktree and the index state with `git merge-tree`, and `planFusion` decides per file: merged, delivered version (a build derives it), kept as the user's, or text for a worker.
Only those paths are rewritten: restored to HEAD, fast-forwarded, then written from the fused tree through a private index, with staged content restored separately; a refused fast-forward is undone with `git stash apply --index`.
Index flags that hide bytes are lifted for the duration and put back.

Anchors: `src/service/workflows.ts#carryOver`, `src/service/workflows.ts#snapshotUncommitted`, `src/service/workflow-landing.ts#planFusion`, `test/merge-queue-delivery.test.ts`

Source: this delivery, 2026-11-24

### Reconciling the user's text happens in a child worktree, inside the landing turn

Kind: contract

Why: `carryOver` runs under the checkout's permit and the repository lease, so it never waits on a worker: it returns a request, and `land` keeps its turn while `reconcileUncommitted` replays the uncommitted state onto the candidate in a child worktree and asks one worker once.
The result is used only for the exact state it was made for (a key over the trees); a state that changed meanwhile, or files written since the snapshot (`fingerprint`), is waited for.
The worker is run without `editAttempt`, which would void the candidate's acceptance.

Anchors: `src/service/workflows.ts#reconcileUncommitted`, `src/service/workflows.ts#land`, `src/service/workflow-landing.ts#fingerprint`, `test/workflow-delivery-runtime.test.ts`

Source: this delivery, 2026-11-24
