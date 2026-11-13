# Checks, publication and review

Legacy recording/regression semantics: how checks ran, task summaries publish and historical human Review binds.
Task mutation ingress and client controls are retired; these contracts preserve existing evidence, not a supported execution route.
The current execution product is described under Automatic conversation workflow below.
Read this before changing checks, change observation, task publication or Review.

## Checks and changes

- Existing configured/manual check and human Review records remain readable on both clients.
  New checks belong to the approved conversation workflow plan; clients cannot run legacy checks or submit legacy Review.
- Checks use the service launch's ordinary project environment, never resolved model auth or a browser environment overlay.
- Changes are bounded observations including pre-existing dirt, not proof of causation or a complete filesystem snapshot.
  The change identity hashes each Git command's complete raw output; a command cut off by its output or time bound contributes only its fixed outcome (for example `ENOBUFS`), never the partial bytes, and marks coverage incomplete.
  A wholly ignored directory is one uninspected entry, so files inside it do not move the identity.
- Failed, canceled, timeout, unknown, blocked, stale and not-run remain distinct.
  Done-with-issues preserves all execution/check facts.

## Checks, publication and review truth

Configured checks match exact name, command and timeout; missing obligations project not-run rather than fabricated execution records.
Manual checks require native local capability and fresh confirmation; browsers have no arbitrary-shell/PTY endpoint.
Use the frozen service-launch ordinary environment, stripped of access/control material; never merge resolved model auth or a browser environment overlay.
Service check output retains bounded complete stdout/stderr with independent UTF-8/sanitizer state and explicit observation labels, not the legacy64KiB preview.
Join both original stream tails, actual EOF/close and storage completion; Node may resume paused stdio while draining exit.
Known access-token rotation must update private redaction without sending access secrets into child environment.

A fresh check may account for exactly one owned generation advance bound to its check/operation/held gate.
Do not replace this proof with a general before≤after comparison.
Changes to files, definitions, epoch/cwd/environment or a foreign generation stale the current obligation without rewriting historical native exit or PASS.
Human Review binds exact selected run/graph/check/change identities and recaptures under a short exclusive barrier only after confirmation, not throughout the human modal.
One accepted Review folds its fixed committed snapshot (plan proof, selected run, check results) once; every barrier validation still rechecks raw task bytes, changes, configuration, choice and active work.
Acknowledgment permits reviewed-with-issues, never changes failed/partial/canceled/native/recording/check facts or revives blocked execution.
Unavailable concurrent views may display conservative stale status but cannot advance authoritative review revisions and invalidate an otherwise unchanged accepted Review.

Task v1 remains a strict human-readable summary; rich graph/transcript data never become unknown siblings beside `task.json`.
`TaskStore.loadSnapshot` includes raw-byte identity; save/publication requires exact expected bytes and revision.
A same-revision external edit conflicts and remains preserved.
Summary clipping is labeled and never clips retained detail; a subsequent publication failure remains separate from previously completed execution.
A retained task may have no live `task.json` (for example after a workspace rebuild).
Current reads then retain the requested task ID in an unavailable context, with no live task/plan or action authority; history snapshots and retained content remain readable without reconstructing the summary.
Stable absence is not `stale`; appearance/disappearance or changed identities during an observation still are.
Generic `stale` requests fresh observation/confirmation, not a diagnosis that `models.json` changed or an instruction to restart; build compatibility is evaluated separately from the session and independently built client identities.
Local operation errors neither hide an independent observation error nor imply that the service needs to be started.

## Automatic conversation workflow

Native/browser approval binds a version-3 delivery agreement: goal, explicit decisions, acceptance, the coordinator's assumptions, the initial route with its assignments and write paths, what each assignment and the review read first, exact setup/baseline/acceptance commands, the installation policy and the local delivery policy.
Goal, decisions, acceptance and assumptions stay as approved; the route, the assignments and the write scope are the owner's to revise after approval, without a repair budget and without asking again.
Version-2 agreements (a fixed write scope) and unversioned ones stay readable and cannot be approved for execution.
Setup never implicitly copies dependency trees, profiles or credentials.
Each new setup command declares `placement`: `target` preflight runs once in the original checkout before worktree creation; `candidate` preparation runs once in the stable candidate; `worktree` preparation runs in the candidate and every detached child.
Stages run in that order, retaining command order within each stage, with the conversation-relative cwd mapped into each checkout.
Target preflight never dispatches a repair editor into the original checkout: its failure ends the attempt, and successful preflight is followed by a fresh target check.
Its notice names the failed preflight and states that implementation and task-worktree creation have not begun, preserving the actual outcome and step evidence.
A target branch predicate does not belong in child preparation.
Placement and exact commands are displayed and approval-bound; recovery cannot change them.
Retained setup without placement keeps its original per-worktree meaning for reading, but cannot authorize a new run.
Recovery retries the failed setup command, not preceding successful commands and their effects.

The owner supplies the delivery's temporary environment; it is not a model-written setup task or a command prerequisite declaration.
The fixed policy from `run-environment.ts` is displayed in the proposal's runtime summary and bound into its observation; a retained proposal without that policy remains readable but cannot acquire it through approval.
Only an admitted delivery behind the checkout gate creates resources, on first use of each execution workspace; planning and readonly research allocate none.
`RunEnvironment` chooses an existing eligible parent from state-home and that workspace's parent, then exclusively creates a random 0700 directory outside Git and private service state, on the workspace's disk rather than tmpfs.
It never adopts inherited temporary directories, scans the host for alternatives, changes existing permissions or installs anything; if neither parent is suitable, or creation fails, the owner reports the concrete environment failure without a model diagnosis/retry loop.
The existing run journal records creation intent before effects and actual filesystem identity afterwards.
Checks, Git operations and SDK workers receive the same workspace-specific `TMPDIR`/`TEMP`/`TMP` overlay; the owner environment, model credentials and network policy stay unchanged.
Sequential commands and recovery reuse that directory, while candidate, parallel child and target workspaces have separate directories, including when their filesystems differ.
Only successfully completed work, after its workers/checks/auth and a durable nonterminal outcome checkpoint have settled, may remove its identity-checked scratch roots; failure, cancellation, uncertain closure and lost ownership retain the remaining roots, never an automatic sweep.
The live view and checkpoint remain nonterminal throughout cleanup, so a crash there is recovered as interrupted rather than completed.
Each removal rechecks cancellation and ownership; an in-flight removal still joins its original result, while Cancel/Stop prevent further removals and finalization rechecks both cancellation and quarantine before publishing the terminal outcome.
Cleanup and the final record are joined before releasing the checkout permit; actual merges and already-confirmed removals are never rolled back or relabelled as retained on restart.
This is private scratch ownership, not a sandbox or permission to modify other external files.

Baseline checks cannot require future outputs.
One stable candidate collects earlier outputs; each editing attempt is attributed against its own write scope, in the candidate or in its assignment's child worktree.
Initial cleanliness preconditions are not rerun against the delivery's own work.
Implementation and knowledge workers submit `cadence_report`, independently captured from successful tool-result content even after transcript preview overflow.
A later editing, shell or unknown tool invalidates the report; ordinary readonly inspection does not.
The SDK still needs real final-message/native/auth/storage closure; a report alone cannot override any of those outcomes.
A complete strict JSON final report remains an alternative structured report, never a prose inference.
Reports distinguish `completed`, `partial` (useful outputs with remaining assigned work) and `blocked` (a concrete unmet prerequisite).
Partial/blocked steps keep those statuses separately from their successful native closure; neither releases dependencies or approves delivery.
Malformed or missing reports remain failed attempts.
All incomplete attempts enter recovery, not inferred success.
The owner records a readonly diagnosis and a route revision with actual failed-step references before dispatching further work.
A revision has a level: `repair` stays inside the current write scope; `replan` may bring further repository paths into it (never credentials, keys, `.env`, `.git` or paths outside the repository, and for a fast-forward delivery never a path the target checkout has its own changes to); `deviate` records that an acceptance item or decision cannot be met as written, what is delivered instead, and which declared checks it sets aside.
While assignments are still being scheduled, a `replan` or `deviate` decision may also revise the route itself (`RecoveryRoute`): drop an assignment that has not started, add one, or give one again under its own ID to rewrite it.
An assignment that has started never changes (what remains of the failed one is the decision's work items), every assignment that waited for a dropped one must be dropped or rewritten in the same decision, the order stays acyclic and one run lists at most 48 assignments in all.
A new assignment may write anywhere in the run's scope, including what the same decision adds to it; those paths belong to that assignment, not to the tree that decided.
The run keeps its current route, its added scope and its deviations (`WorkflowRun.tasks`, `scope`, `deviations`, at most 16 deviations); later assignments are told the delivered variant.
Dependent assignments wait for completion.
Unknown originals, Cancel and authority/storage failures stop new work.
An editing worker with nonzero exit needs a settled, successful cleanup diagnostic before recovery; direct-child close alone cannot authorize another editor.
A timed-out shell check is not automatically replayed because descendant/tool closure was not established.
Checks and readonly Agent review still decide delivery.
Failed checks, rejected review, unparseable review and settled worker failures can enter diagnosis and repair without further routine confirmation.
Every declared check runs in every round.
A check is set aside only by a recorded deviation that names it: it still runs and is shown as failed, stops gating acceptance, and is listed in the acceptance record (`waived`); a candidate whose every check was set aside is never accepted.
The review is given every recorded deviation and must find each necessary and minimal; rejecting one sends the delivery back to recovery.
A completed run that deviated says so first in its final notice, composed after settlement so cleanup and the final writer cannot overwrite it.
Repeated operation/failure identity and unchanged source observation escalate the decision's level even when strategy or work instructions are rephrased.
Observable progress still permits further repairs without a fixed quota.
Current-round native exit/closure facts and labelled redacted result excerpts reach diagnosis, repair and review.
Check results also retain their exact command, actual mapped cwd, checkout placement, target binding and only the effective `TMPDIR`/`TEMP`/`TMP` launch values (null means unset in a retained launch), all sanitized before storage and again on reads.
Diagnosis and repair receive this context even for silent failures; older results explicitly say when it was not recorded.
Command-local environment does not persist into another process, and conditional project guidance cannot invent undeclared resources or markers.
A failed repair retains the original failing step identities alongside the latest repair, rather than replacing the original cause with a clipped report.
No worker needs permission to inspect private state or the owner process environment.
Old failures are historical context, not current check evidence; baseline and post-merge rounds collect their own original check identities.
Every relevant repair or knowledge edit triggers fresh checks/review on the combined candidate.
Successful verification records bind the agreement, cwd, exact approved-source identity and original step IDs.
Cross-worktree verification streams file bytes, including large files under directory scopes; placement-dependent stat identities remain observation fences only.
Cancellation joins the current read/close instead of abandoning it.
Source changes during checks require verification of the resulting bytes; changes during readonly review refuse stale evidence.
Project knowledge is maintained from actual implemented behavior and evidence, not copied from proposal prose; its ownership and context policy are in [project knowledge](project-knowledge.md).
Local-merge verification rounds first commit the approved candidate changes, then bind real checks and Agent review to that exact commit/tree and source identity.
Delivery notes and knowledge changes are included before final acceptance; new edits invalidate earlier acceptance.
Local-merge candidates receive another verification after delivery notes, before fast-forward integration.
Post-merge failures preserve the real merge: any repair happens in the owned candidate, is checked/reviewed there and fast-forwards the unchanged target again.
The user's unrelated index is never committed by recovery.
Local commit hooks/signing are disabled; verification is explicitly approved instead.
Git index flags that hide declared targets (`assume-unchanged` / `skip-worktree`) refuse isolated delivery; hidden entries anywhere in a candidate prevent clean-candidate acceptance or cleanup.
Working-copy snapshots also observe index-hidden paths rather than treating Git status as complete.
Workflow scope checks independently include staged changes, even when the worktree was restored to HEAD or a staged new file was removed.
A declared write path that names a directory covers the files below it, in plan overlap, scope, commit and observation alike; write paths refuse format characters (bidi, zero-width, BOM, line separators).
Working-copy delivery snapshots every worker and repair: in Git, edits outside the declared writes fail the run with the path list and are preserved, never reverted; the changed-file list is recorded.
Credential-looking plan and research text is redacted, not refused: the stored, displayed and approved plan is the redacted one.
Agent review verdicts are accepted bare, fenced or inside prose; a review step is `completed` for approve, `rejected` for an explicit negative verdict and `failed` for an unparseable reply or worker failure.
None of the latter outcomes counts as delivery approval.
The first settled review-step snapshot already contains its verdict, never a temporary process-success status that could end client observation early; retained native process and transcript outcomes remain independent.
Workflow delivery notes are written before the final candidate checks and say they are not a verification result.
Integration rechecks only the target branch, HEAD and the declared/committed targets; unrelated checkout edits do not block it, and `merge --ff-only` refuses genuine overlap.
Unmodified guidance is not part of the dirty check; explicitly approved knowledge write targets are.
Generated workflow notes travel in the candidate only when the fast-forward can deliver them, otherwise (ignored, untracked or dirty destination) they are written after the merge with an expected-bytes check.
Local-merge plans refuse declared write targets that Git ignores (`invalid`, naming them), since a commit could not carry them; before a worktree is removed, any leftover file anywhere in it, ignored ones included, retains it.
Successful post-merge checks and exact owned/delivered candidate evidence are prerequisites for cleanup; the named branch remains.
Failed or interrupted delivery retains its worktree.
An Agent review reply whose verdict objects disagree, repeat verdict keys or exceed complete-verdict inspection bounds counts as unparseable, never as approval.
The whole selected message is parsed before display clipping; bounded summary/issue excerpts cannot change the resulting verdict.
Version-1 proposals remain readable under their original rules, but cannot authorize the new adaptive executor; prepare/execute refuse them without effect and require a current agreement.
Git operations are recorded as `git` steps (candidate creation, commits, integration, merge and worktree removal).
Each generated commit must extend the observed baseline and change only its approved files; unexpected HEAD movement during setup/workers/checks refuses continuation.
Rejection preserves the index and worktrees; it never clears or resets them to manufacture an in-scope result.
Cleanup names the last confirmed delivered commit, never a freshly observed candidate HEAD: a clean but unmerged repair remains retained.
No implicit remote operation occurs.
Post-merge checks report the real resulting commit even on failure; no rollback is claimed.
Automatic outcomes retain `humanReviewed: false` and cannot satisfy legacy human Review.
Full sanitized process results are separate from labelled status previews; lookup verifies that the selected step belongs to the run.
Knowledge assignments preserve human text and update existing topic owners; ignored generated documents remain ignored and are published with expected-byte checks.
Workflow notes have a separate directory/version and never add unknown siblings to legacy task v1.

Delivery source observations bind the effective Pi settings/tool snapshot and display its runtime summary.
A changed preference needs a fresh proposal/confirmation before admission; accepted delivery retains one snapshot across implementation and independent fixed-candidate Review.
Inheritance neither grants editing to Review nor turns tool success into passing check evidence.
Source details live in `worker-tools.md`.
