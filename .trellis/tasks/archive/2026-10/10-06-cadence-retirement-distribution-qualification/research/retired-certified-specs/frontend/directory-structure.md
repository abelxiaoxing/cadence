# Presentation and Content Structure

## Current ownership

This repository has no web frontend and no shipped workflow prompts.
`src/index.ts` installs one fixed terminal-only task completion shell; native task UI is owned by `task-session.ts`/`task-review-ui.ts`.
`subagent-activity.ts` and `startup-card.ts` render bounded observational facts and never own durable authority.
The package manifest exposes one extension and the independent skills.

## Shipped content

- `skills/context7-auto-research/`: documentation research, anonymous defaults only when configuration is absent.
- `skills/grok-search/`: bounded Grok/Tavily requests with explicit credential configuration.
- `skills/git-commit/`: explicit-request-only deterministic commit audit; no automatic task commit.
- `skills/_shared/`: one HTTP/config owner, `.d.mts` typing, whole-file project-before-user selection, 64-KiB regular-file bound and nonblocking open.
  Malformed explicit config fails instead of hiding behind defaults.
- `agents/design-explorer.md`, `agents/implementation-worker.md`, `agents/diagnosis-worker.md`: fixed package-owned roles returning bounded planning facts, disposable candidates or readonly assessments.
  No project/user discovery override and no child PASS/approval/Completion authority.
- `config/task-plan-draft.quick.example.json`, `config/task-plan-draft.example.json`, `config/task-plan-draft.multiple-tasks.example.json`: strict authoring envelopes compiled through genuine task review.
  Local identities are authoring references, not caller durable IDs/approval.
- `config/.env.example`: research/native execution template.
  Postinstall writes the user template only when absent.

Agents remain adapted MIT resources with attribution in `THIRD_PARTY_NOTICES.md` and `licenses/`.
A reviewed adaptation updates exact `provenance/adapted-modules.yaml` SHA-256 pins; runtime computes package-local content identity, not a YAML rejection protocol.
The reviewed `provenance/package-members.json` is independent of actual archive output.
Content changes must update pins/tests/member policy together and pass all-body real-pack checks.
No tests, fixtures, acceptance maps, private state or prototypes ship.

## Historical retirement

Four stage prompts, Gate-bound examples, upstream installers and stage/RPC evaluator resources were deliberately retired.
They are not `/cadence` template aliases and consumer-owned copies are never deleted or converted into authority.
Safety preservation is documented in [Task Distribution and Retirement](../backend/task-distribution-guidelines.md).
The Trellis-managed block in `AGENTS.md` is outside package-owned edits and must remain byte-identical.
