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

Native/browser workflow approval includes exact setup, separate baseline/acceptance checks, delivery policy and a finite repair budget.
Setup never implicitly copies dependency trees, profiles or credentials.
Baseline checks cannot require future outputs.
Local-merge candidates receive readonly Agent review, whole-candidate checks and another check after generated documentation before fast-forward integration into the unchanged target.
Local commit hooks/signing are disabled; verification is explicitly approved instead.
Workflow scope checks independently include staged changes, even when the worktree was restored to HEAD or a staged new file was removed.
A declared write path that names a directory covers the files below it, in plan overlap, scope, commit and observation alike; write paths refuse format characters (bidi, zero-width, BOM, line separators).
Working-copy delivery snapshots every worker and repair: in Git, edits outside the declared writes fail the run with the path list and are preserved, never reverted; the changed-file list is recorded.
Credential-looking plan and research text is redacted, not refused: the stored, displayed and approved plan is the redacted one.
Agent review verdicts are accepted bare, fenced or inside prose; a review step is `completed` for approve and `failed` for reject or an unparseable reply, and passing checks with an unparseable verdict stop the run instead of spending repairs.
Workflow delivery notes are written before the final candidate checks and say they are not a verification result.
Integration rechecks only the target branch, HEAD and the declared/committed targets; unrelated checkout edits do not block it, and `merge --ff-only` refuses genuine overlap.
`AGENTS.md` and `.cadence/project.md` are not part of the dirty check; notes travel in the candidate only when the fast-forward can deliver them, otherwise (ignored, untracked or dirty destination) they are written after the merge with an expected-bytes check, merging the managed region into the user's text.
Local-merge plans refuse declared write targets that Git ignores (`invalid`, naming them), since a commit could not carry them; before a worktree is removed, any leftover file under its approved paths, ignored ones included, retains it.
An Agent review reply whose verdict objects disagree counts as unparseable, never as approval.
Proposals retained from 2.0.21 keep reading under the older plan rules; preparing or executing one that breaks the current rules refuses `invalid` without effect.
Git operations are recorded as `git` steps (worktrees, dependencies, commits, integration, merge and worktree removal).
Each generated commit must extend the observed baseline and change only its approved files; unexpected HEAD movement during setup/workers/checks refuses continuation.
Rejection preserves the index and worktrees; it never clears or resets them to manufacture an in-scope result.
No implicit remote operation occurs.
Post-merge checks report the real resulting commit even on failure; no rollback is claimed.
Automatic outcomes retain `humanReviewed: false` and cannot satisfy legacy human Review.
Full sanitized process results are separate from labelled status previews; lookup verifies that the selected step belongs to the run.
Project Markdown uses a managed region preserving outside human text; ignored generated documents remain ignored and are published with expected-byte checks.
Workflow notes have a separate directory/version and never add unknown siblings to legacy task v1.
