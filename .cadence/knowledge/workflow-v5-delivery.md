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

Why: After worktree setup and baseline checks, `planRoute` runs readonly `route-planner` (`planning` phase, `purpose: "plan"`), which submits its RoutePlan through the `cadence_route` tool; the owner decodes the retained tool result with `decodeRoutePlan` (one complete object, never prose) plus owner gates (`.cadence/` write exclusion, managed-link non-overlap, and `git check-ignore` on `integration` failing closed on Git errors), retrying objections up to `PLAN_OBJECTIONS` (2) or aborting with zero edits on `blocked`.
A missing submission is itself the objection.

Anchors: `src/service/workflows.ts#planRoute`, `src/service/workflow-controller.ts#decodeRoutePlan`, `src/service/workflow-controller.ts#PLAN_OBJECTIONS`, `test/workflow-v5-planning.test.ts`, `test/worker-structure.test.mjs`

Source: internalized from engineering/worktree-delivery.md, updated 2026-11-26

### Parallel child worktrees never own overlapping writes or adopt sibling drift

Kind: pitfall

Why: Ready assignments with disjoint writes fork detached child worktrees from the committed candidate and cherry-pick back onto it; before widening a child's repair scope, recovery compares its fork against the candidate's current HEAD so already-integrated sibling files route to a queued follow-up instead of recreating stale copies.

Anchors: `src/service/workflows.ts#integrateChild`, `src/service/repository-coordination.ts#RepositoryCoordination`, `test/workflow-recovery-regressions.test.ts`

Source: internalized from engineering/worktree-delivery.md, 2026-11-22
