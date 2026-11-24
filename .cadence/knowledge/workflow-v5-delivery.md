# V5 two-stage workflow and worktree delivery

## Stage 1 agreements and 3D managed dependency links

### Only version-5 agreements admit execution; earlier versions stay readonly

Kind: contract

Why: Version-5 Stage 1 agreements omit `tasks` and `reviewReads`, add `investigations` and advisory `areas`, and forbid `.cadence/` in `documents`.
Version-4 and older agreements remain readable readonly and cannot be approved; revalidation binds exact unchanged plan content into a fresh snapshot linked to its immutable predecessor.

Anchors: `src/service/contracts/workflow.ts#CURRENT_WORKFLOW_PLAN_VERSION`, `src/service/workflows.ts`, `test/workflow-contract.test.ts`

Source: internalized from engineering/worktree-delivery.md, 2026-11-22

### Omitted links on local-merge without installs auto-discover ignored node_modules at proposal time

Kind: contract

Why: `discoverManagedLinks` scans plain, untracked, Git-ignored `node_modules` up to depth 2 (skipping symlinks, hidden dirs, nested `.git` repos and secret-bearing paths) and binds them into `proposal.digest`; explicit `[]` disables discovery.
Cleanup unlinks only after verifying parent/symlink `dev`, `ino` and target, refusing and retaining the worktree on any replacement or retargeting.

Anchors: `src/service/workflow-links.ts#discoverManagedLinks`, `src/service/workflow-links.ts#unlinkManagedLinks`, `test/workflow-links.test.ts`

Source: internalized from engineering/worktree-delivery.md, 2026-11-22

## Stage 2 route planning and parallel worktrees

### Readonly route-planner splits approved agreements behind deterministic owner gates

Kind: contract

Why: After worktree setup and baseline checks, `planRoute` runs readonly `route-planner` (`planning` phase, `purpose: "plan"`) and validates its single JSON `RoutePlan` via `decodeRoutePlan` plus owner gates (`.cadence/` write exclusion, managed-link non-overlap, and `git check-ignore` on `integration` failing closed on Git errors), retrying objections up to `PLAN_OBJECTIONS` (2) or aborting with zero edits on `blocked`.

Anchors: `src/service/workflows.ts#planRoute`, `src/service/workflow-controller.ts#decodeRoutePlan`, `src/service/workflow-controller.ts#PLAN_OBJECTIONS`, `test/workflow-v5-planning.test.ts`

Source: internalized from engineering/worktree-delivery.md, 2026-11-22

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

### Parallel child worktrees never own overlapping writes or adopt sibling drift

Kind: pitfall

Why: Ready assignments with disjoint writes fork detached child worktrees from the committed candidate and cherry-pick back onto it; before widening a child's repair scope, recovery compares its fork against the candidate's current HEAD so already-integrated sibling files route to a queued follow-up instead of recreating stale copies.

Anchors: `src/service/workflows.ts#integrateChild`, `src/service/repository-coordination.ts#RepositoryCoordination`, `test/workflow-recovery-regressions.test.ts`

Source: internalized from engineering/worktree-delivery.md, 2026-11-22
