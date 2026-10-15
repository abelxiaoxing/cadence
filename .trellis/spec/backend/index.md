# Backend Development Guidelines

## Current scope

Cadence is one explicit terminal-only Pi workflow assistant, not a certified executor.
Backend ownership is `src/`, process/check execution, plain task records, readonly observations and distribution tooling.
The approved lightweight replacement is implemented and independently reviewed locally; it remains unreleased with external qualification limits.

## Pre-Development Checklist

1. Read the active task PRD/design/implementation plan and [implemented workflow contract](./lightweight-workflow-guidelines.md).
2. Read [directory ownership](./directory-structure.md) and the topic guide below before changing that boundary.
3. Read adjacent code/tests and actual installed Pi public declarations for host/SDK changes; do not assume global documentation matches the installed peer.
4. Preserve consumer data and unrelated edits; do not introduce hidden execution, automatic Git/install/cleanup or a second executor.
5. Use [quality gates](./quality-guidelines.md), distinguishing local evidence from unexecuted platform/provider/human lanes.

## Maintained guides

| Guide                                             | Owner / purpose                                                                  |
| ------------------------------------------------- | -------------------------------------------------------------------------------- |
| [Workflow](./lightweight-workflow-guidelines.md)  | Native consent, controller, auth/SDK, checks, freshness and bounded cancellation |
| [Directory structure](./directory-structure.md)   | Sixteen source owners and dependency direction                                   |
| [Storage](./database-guidelines.md)               | Plain JSON records and new checkout coordination, not SQLite                     |
| [Errors](./error-handling.md)                     | Refusals, interruption, unknown stop and no fallback                             |
| [Logging](./logging-guidelines.md)                | Bounded sanitized presentation and private diagnostics                           |
| [Quality](./quality-guidelines.md)                | Tests, explicit budgets and honest evidence                                      |
| [Distribution](./task-distribution-guidelines.md) | Exact archive/body/pin audits, operator and actual retirement                    |

Presentation, native hooks and shipped Agents/skills/configuration are in [frontend](../frontend/index.md); there is no web frontend.
Shared [reuse](../guides/code-reuse-thinking-guide.md) and [cross-layer](../guides/cross-layer-thinking-guide.md) thinking guides supplement these code contracts.

## Historical guidance

The other `task-*` guides in this directory are short historical pointers, not extra requirements.
[Byte-preserved pre-refresh bodies](../../tasks/archive/2026-10/10-06-cadence-retirement-distribution-qualification/research/retired-certified-specs/manifest.json) retain old SQL/compiler/seal/transaction/first-close guidance for historical reports only.
Do not restore those mechanisms to satisfy obsolete text or relabel their failures passed.
