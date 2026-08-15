---
name: git-commit
description: Create one repository-compliant commit only after an explicit user commit request and deterministic safety audit
---

# Git commit

Activate this Skill only when the user explicitly asks to commit or invokes this Skill.
Workflow completion does not authorize a commit, Gate approval never authorizes a commit, and an installed Skill does not authorize or execute a commit by itself.

## Safety audit

After an explicit request:

1. Read the repository root and all relevant nested `AGENTS.md` files.
2. Inspect `git status --short`, `git diff`, and `git diff --staged` so staged and unstaged changes are both visible.
3. Exclude every `.env` file, credential, private key, user or session state, workflow state, and obviously unrelated path.
4. Review deletions and renames explicitly; never infer that an ambiguous deletion is safe.
5. Decide whether the remaining safe relevant paths form exactly one logical commit.

If changes contain multiple logical groups, unrelated dirty files, ambiguous deletions, unsafe files, or no uniquely safe group, leave the index and history unchanged and ask the user which logical group to commit.

## One safe logical commit

When the audit identifies one unambiguous logical commit:

1. Stage only the explicit path list with `git add -- <paths>`.
2. Reinspect `git diff --staged` and confirm it contains only that path list and no prohibited content.
3. Derive a repository-compliant Conventional Commit message from the actual staged diff.
4. Execute one normal commit and report its received output.

## Prohibited operations

Never use `git add .`, `git add -A`, `git add -p`, `--no-verify`, `--amend`, reset, force push, or `git config` mutation.
Never bypass hooks, rewrite history, discard work, or broaden the explicit path list.

If a commit hook fails, report the failure as received, preserve the staged state for inspection, and do not bypass the hook.
