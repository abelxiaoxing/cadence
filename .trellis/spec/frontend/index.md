# Presentation & Content Guidelines

## Scope

Production presentation is native Pi plus the built `web/` client, shipped Agents, independent skills and configuration examples.
Both clients use one explicitly started owner; whole-delivery qualification is distinct from implemented behavior.
Use [shared service clients](./service-client-guidelines.md) for the shared adapters and native departure/consent contracts.
`src/index.ts` registers one `/cadence` workflow through `src/task-shell.ts`; ordinary engineering and resource discovery never activate it.
The lightweight replacement is implemented and independently reviewed locally, not certified or release-qualified across all platforms.

## Pre-Development Checklist

1. Read the active task artifacts and the [implemented workflow contract](../backend/lightweight-workflow-guidelines.md), which owns cross-layer APIs, fields, bounds and refusal behavior.
2. Read [directory ownership](./directory-structure.md) and the relevant native UI/content guide below.
3. Inspect adjacent source/tests and the installed Pi public declarations; global documentation may describe a different host identity.
4. Keep presentation separate from service admission/storage authority: history, model prose and a rendered plan never grant Start consent.
5. Preserve independent skills, Agent licenses/pins and consumer data; the approved WebUI is a service client, never a model-callable workflow tool or second executor.
6. Use [quality checks](./quality-guidelines.md) appropriate to the change and label unexecuted qualification honestly.

## Maintained guides

| Guide                                             | Responsibility                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [Service clients](./service-client-guidelines.md) | Approved shared native/browser client, typed progress, reuse and qualification boundaries |
| [Directory structure](./directory-structure.md)   | Source/content ownership, role mapping and independent config                             |
| [Components](./component-guidelines.md)           | Native dialogs, pager, cancellable progress and startup summary                           |
| [Hooks](./hook-guidelines.md)                     | Raw terminal entry, stale context and waited departure                                    |
| [State](./state-management.md)                    | Transient display versus durable context, checks and human review                         |
| [Types](./type-safety.md)                         | Shared decoders, host signatures and literal auth/config boundaries                       |
| [Quality](./quality-guidelines.md)                | Fake-host versus production PTY evidence, content and package audits                      |

[Backend storage](../backend/database-guidelines.md), [diagnostics](../backend/logging-guidelines.md) and [distribution](../backend/task-distribution-guidelines.md) own their respective operational contracts.
Shared [reuse](../guides/code-reuse-thinking-guide.md) and [cross-layer](../guides/cross-layer-thinking-guide.md) guides supplement these specs.
Write maintained documentation in English and keep each injected file below 32768 bytes.

## Historical routes

[Session](./task-session-guidelines.md), [source](./task-source-guidelines.md) and [planning](./task-planning-guidelines.md) are tombstones linking exact archived bodies, not additional live requirements.
The removed activity widget, stage prompts, Gate/compiler/approval lineage and certified Completion are not hidden current surfaces.
Historical failures remain failed/superseded; archived requirements do not authorize consumer migration, cleanup, Git mutation or publication.
