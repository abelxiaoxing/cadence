# Backend Development Guidelines

## Current scope

Native `/cadence` and the built WebUI now attach to one explicitly started accepting service.
Backend owns `src/`, direct worker/check execution, strict v1 summaries, durable private history, auth/coordination and distribution tooling.
`createServiceHost` composes real TaskActions/current/model/history/live/asset ports; no terminal controller, implicit startup or local fallback remains reachable.
Use the owner, orchestration and capture/history guides below; implementation and boundary evidence are not whole-product release qualification.

## Pre-Development Checklist

1. Read the active task PRD/design/implementation plan; distinguish the [shared workflow](./lightweight-workflow-guidelines.md) from the implemented [service capture/history boundary](./service-history-capture-guidelines.md).
2. Read [directory ownership](./directory-structure.md) and the topic guide below before changing that boundary.
3. Read adjacent code/tests and actual installed Pi public declarations for host/SDK changes; do not assume global documentation matches the installed peer.
4. Preserve consumer data and unrelated edits; do not introduce hidden execution, automatic Git/install/cleanup or a second executor.
5. Use [quality gates](./quality-guidelines.md), distinguishing local evidence from unexecuted platform/provider/human lanes.

## Maintained guides

| Guide                                                              | Owner / purpose                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| [Workflow](./lightweight-workflow-guidelines.md)                   | Native consent, owner auth/SDK, checks, freshness and bounded cancellation                        |
| [Directory structure](./directory-structure.md)                    | Native entrypoint, service/component owners and dependency direction                              |
| [Service owner core](./service-owner-guidelines.md)                | Private registry/locks, original-promise lifecycle and accepting host and management              |
| [Service orchestration](./service-orchestration-guidelines.md)     | Actual graph/actions/scheduler, current views, checks/review and native joins                     |
| [Service capture/history](./service-history-capture-guidelines.md) | Shared JS capture, one durable writer, typed bounded read progress, search/export and HTTP limits |
| [Storage](./database-guidelines.md)                                | Plain JSON records and new checkout coordination, not SQLite                                      |
| [Errors](./error-handling.md)                                      | Refusals, interruption, unknown stop and no fallback                                              |
| [Logging](./logging-guidelines.md)                                 | Bounded sanitized presentation and private diagnostics                                            |
| [Quality](./quality-guidelines.md)                                 | Tests, explicit budgets and honest evidence                                                       |
| [Distribution](./task-distribution-guidelines.md)                  | Exact archive/body/pin audits, operator and actual retirement                                     |

Presentation, native hooks and shipped Agents/skills/configuration are in [frontend](../frontend/index.md); the browser and native clients share the same owner.
Shared [reuse](../guides/code-reuse-thinking-guide.md) and [cross-layer](../guides/cross-layer-thinking-guide.md) thinking guides supplement these code contracts.

## Historical guidance

The other `task-*` guides in this directory are short historical pointers, not extra requirements.
[Byte-preserved pre-refresh bodies](../../tasks/archive/2026-10/10-06-cadence-retirement-distribution-qualification/research/retired-certified-specs/manifest.json) retain old SQL/compiler/seal/transaction/first-close guidance for historical reports only.
Do not restore those mechanisms to satisfy obsolete text or relabel their failures passed.
