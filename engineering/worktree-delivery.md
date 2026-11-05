# Task branches and worktree delivery

Owner-controlled local delivery for an approved conversation workflow.
The execution owner remains `Workflows`; this is not a second task framework, Git daemon, sandbox or transactional application system.

## Entry and authorization

Enabling `/cadence`, refreshing, reconnecting, asking a question or running research creates no Git branch or worktree.
An exact, freshly approved `local-merge` plan authorizes one finite run: a new named task branch, isolated worktrees, declared setup/checks, bounded repairs, local commits and conditional fast-forward delivery.
The target is the starting owner's current local branch, not a hard-coded main or a model-selected remote.
`working-copy` remains a separately explicit policy, never a fallback after isolated delivery fails.
Completion keeps Cadence enabled; every new implementation still needs a new plan and approval.
Native raw-terminal and browser conversation/attachment consent remain separate adapters to the same owner.

A proposal carries an owner-generated `DeliveryBinding`, not just display text:

- canonical target checkout and Git common directory;
- repository directory incarnation, complete local ref and baseline commit;
- the `task-branch-v1` creation, acceptance, integration and retention policy.

The binding participates in both the proposal digest and fresh observation checks.
Changing it cannot reuse the old plan approval.
Old proposals remain readable, but a local-merge proposal without the new binding must be republished before execution.
The plan displays the target, base, execution directory mapping, branch naming rule and delivery boundary before confirmation.
There is no implicit fetch, pull, push, deployment or branch switch.

## Ownership and placement

`src/service/workflow-delivery.ts` owns task-branch/worktree placement, exact resource checks, acceptance preflight and safe cleanup.
`src/service/workflows.ts` remains the sole orchestrator and recorded process runner, including the noninterruptible target fast-forward.
`src/service/workflow-git.ts` owns Git identity, ancestry, scope and residue observations.
`src/service/repository-coordination.ts` owns short shared-repository mutation leases and indexed resource ownership, using the existing private-files/liveness/recovery infrastructure.
The portable DTOs and native/browser render helpers live in `src/service/contracts/workflow.ts`.

One approved run has one user-visible `refs/heads/cadence/<sanitized-goal>-<full-run-id>` branch.
The title is only a readable label; the run ID supplies identity, and existing refs/paths are never adopted or overwritten.
The existing external worktree layout is retained:

```text
<stateHome>/cadence-worktrees-v1/<project-hash>/<run-id>/
  integration/       # named task branch and final candidate
  tasks/<task-id>/   # detached internal assignment worktrees
```

The owner records creation intent before Git effects and confirms the actual worktree registration, common directory, ref, HEAD and filesystem identity before worker use.
A partial branch/worktree creation remains visible and retained; it is not reported as an atomic transaction.
`worker-workspace.mjs` still only maps the pinned conversation-relative cwd into an owner-selected tree.
Pi sessions, conversation cwd/model preferences and the original checkout branch are not moved or copied.
Existing parallel assignments and dependency handoffs remain inside the one workflow; no per-subtask named-branch UI is added.

Local delivery requires Git with `--no-lazy-fetch`, an existing branch, commit identity and no unfinished merge/rebase/cherry-pick/revert/bisect operation.
Missing partial-clone objects refuse instead of triggering an implicit fetch; configured host tools/filters are still not an OS sandbox.
Declared write targets must not overlap staged/unstaged user changes or be ignored by Git.
Unrelated dirt remains allowed and is never stashed, reset, cleaned or copied into the candidate.
Missing worktree dependencies require explicitly approved setup, not automatic installation or copying of dependencies, profiles or credentials.
Host tools are not an OS sandbox: cwd binding and owner scope checks do not make an arbitrary shell incapable of external effects.

## Original lifetimes and repository coordination

Linked worktrees share Git refs even when their checkout roots differ.
Recorded Git mutation groups take a lease keyed by the canonical common directory, after the existing checkout permit.
They never hold that lease while waiting for another checkout or for an implementation/review worker.
The account registry's short lock is not held across Git/model execution.
Lease wait and active-resource bounds live in `repository-coordination.ts`; waiting is not permission to reclaim a holder by age.

Creation intents are indexed by owner root and epoch before shared reservations are written.
Release joins the original native operation and persistence, not a reporting timeout or rejected observer.
Unconfirmed closure or failed reservation persistence quarantines the owner and keeps its fences for existing recovery.
Only the owner healer, after its exact holder/worker checks, can recover a dead epoch's coordination records.
It releases active coordination records and the interrupted run retains its artifacts; it never replays a Git operation or deletes Git/user files.
Confirmed filesystem ownership is immutable evidence beside the run; completed runs do not accumulate in the account-wide active lease directories.
A damaged owner index is archived; an unidentifiable shared resource needs the existing explicit doctor takeover before archival/recovery.
A different owner's replacement resource is left alone.

The managed worktree namespace cannot acquire a second project owner, including after a run settles.
Directory inspection and displaying a path do not confer takeover authority.
This version has no automated workspace-handoff or task-branch deletion operation.
The coordination domain is one state home; external editors/Git commands, other state homes and other accounts are not globally locked or sandboxed.

## Exact candidate acceptance

Owner commits verify ancestry and changed paths, including concealed staged bytes.
Integration starts from the recorded baseline, applies task commits in order and records each original task commit's actual applied commit.
It does not assume that cherry-pick preserves commit IDs.
Unexpected HEAD or branch changes in managed worktrees refuse subsequent owner effects.
The complete candidate delta must remain inside approved task/document paths; a clean checkout alone is not proof of scope.

Documents that travel in Git are committed before final acceptance, never added after the last review.
Each verification/repair round:

1. Confirms the owned worktree/ref and records exact candidate commit/tree and plan/context identity.
2. Runs the plan's real acceptance checks, retaining their actual native/closure/recording outcomes.
3. Requires the candidate HEAD, index and worktree to remain unchanged.
4. Runs a separate readonly Agent review with current-round evidence and fixed-revision changes access.
5. Rechecks the same candidate and records references to the passing check steps and approved review step.

Repair creates a new candidate and reruns checks/review; old PASS records cannot authorize it.
A malformed/unavailable review is not approval, and an unparseable verdict with passing checks does not consume repair rounds.
Review verdicts are parsed from the independently retained complete selected message before preview clipping; diagnostic clipping is a separate fact.
Conflicting verdicts or exhausting the bounded verdict scan refuse approval rather than ignoring a contrary tail.
An acceptance record is owner evidence, not a user approval capability; `humanReviewed` remains false.

The trusted review request may carry fixed `root/base/candidate` Git observation binding.
Only that review worker receives the `changes` capability in addition to ordinary readonly observations.
`src/change-tools.mjs` streams paths, patches and base/candidate file contents through one-use worker-local cursors with real pipe positions and backpressure.
It accepts no arbitrary refs, shell commands, writes or network operations, uses literal pathspecs, and exposes continuation and completeness in model-visible content.
Binary/invalid/unavailable text cannot produce complete coverage; cancellation, expiry and cleanup join the actual Git child closure without spilling source copies.
`src/git-environment.mjs` shares the existing physical-checkout Git environment policy and disables replacement objects so fixed OIDs describe actual objects.

## Integration and result truth

Immediately before delivery, under the mutation lease, the owner checks the exact acceptance, candidate/ref/workspace, complete committed scope, ancestry, target repository/ref/base and target write-path cleanliness.
It merges the fixed candidate OID, never a movable branch name, using the existing noninterruptible `merge --ff-only` runner.
It then observes the actual target ref/HEAD and repository identity.
Unknown results never cause automatic replay.

Target movement, branch switching or overlapping user edits block delivery and preserve the candidate.
A new baseline requires a new explicit plan approval; no automatic rebase, conflict resolution, force update, reset or rollback occurs.
When a merge completed but post-merge checks failed, the real applied commit remains visible independently of the failed check.
A post-merge identity that cannot be confirmed remains unknown, not a fabricated success or no-effect claim.
Publication of ignored/dirty managed-region notes retains expected-byte checks and user text protection; these notes are not claimed to be part of the accepted Git candidate.
Final results belong to the owner journal, not self-referential commits or a Markdown success checkbox.

`DeliveryObservation` separates preparation, artifacts, candidate acceptance, actual integration, post-merge checks and cleanup.
Terminal and WebUI display those recorded facts and reasons, rather than inferring them from model prose or browser state.
Historical fields are not silently updated to follow manually moved worktrees/refs; absent old fields remain unrecorded.

## Retention and cleanup

Successful delivery keeps the task branch.
Automatic worktree removal requires exact ownership/registration/ref/HEAD, confirmed original settlement, a delivered candidate, and no uncommitted, untracked or ignored residue anywhere in that worktree.
For detached subtask trees it also verifies the recorded applied commit belongs to the delivered candidate, not that the original pre-cherry-pick OID is an ancestor.
Those ancestry observations use the target checkout and remain available after the candidate worktree is removed.
Only ordinary `git worktree remove` and removal of already empty parent directories are used.
No force, recursive deletion, reset, clean, branch deletion or historical-worktree migration is automatic.
Ignored dependencies/build outputs can therefore keep a worktree; the UI reports why.

Failure, cancellation, unknown closure, post-merge failure or unmet cleanup conditions retain artifacts.
Cleanup outcome does not erase an independently completed merge or change old check facts.
Departure and mode exit only detach; explicit Cancel/Stop retains actual original closure semantics.
Restart marks interrupted stages unknown and artifacts retained, without resuming implementation, commits, integration or cleanup.

## Regression owners

- `workflow-delivery`: real Git branch/ref/candidate/scope checks, immutable placement, residue retention and cherry-pick cleanup mapping.
- `workflow-delivery-runtime`: controlled owner/worker/native seam for ordering, bounded repair, invalidation, cancellation and independent merge/post-check outcomes; not a running SDK/provider.
- `workflow-delivery-admission`: real proposal/receipt persistence and bound target observation; the longer full admission case is tagged slow.
- `repository-coordination`, `repository-recovery`: shared leases, lifetime retention, managed-owner refusal, exact-epoch recovery and archive/confirmation boundaries; liveness is controlled in the recovery fixture.
- `change-tools`, `worker-toolkit`, `workflow-runtime`: fixed Git observations, readonly capabilities, full-message review interpretation and original-operation lifetime.
- Existing `self-heal` process fixtures retain actual boot/PID/worker-stop proof coverage.
- `test/web/workflow.test.tsx`, `cadence-mode` and retained service workflow/context tests keep the separate client, consent, context and native settlement contracts.

Follow [verification](verification.md): `bun run verify` is the sole integration gate, with a separate real-pack route.
No browser, paid-provider or service-manager prerequisite is added, and passing unit/SSR checks do not qualify those environments.
