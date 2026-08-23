## Why

The Implement runtime currently repeats stable task contracts across phases, converts typed candidate failures into strings, and exposes Design-routing metadata that the runtime cannot truthfully own. This makes equivalent requests fragile, leaves conflicts unprotected between phase calls, and reports ordinary domain blockers as Tool errors.

## What Changes

- **BREAKING** Replace repeated Implement request contracts with one immutable task boundary plus phase-local attempts.
- **BREAKING** Remove Implement outcomes and recovery metadata that select or recommend Design; invalid trusted delivery remains a pre-registration stage blocker, while authorization-boundary failures become terminal task blockers.
- Make Runtime-owned preflight and exact apply the only facts that advance Red, Green, Refactor, and AGENTS checkpoint state.
- Keep task conflicts active across phase gaps and candidate/checkpoint review, immediately defer conflicting opens, and release conflicts only at terminal state or drain.
- Carry child, preflight, apply, and checkpoint failures as closed typed values with shared bounded launch budgets, cancellation-safe behavior, terminal replay, and no partial oversized result.
- **BREAKING** Remove `DiffResult.nextStep` package-wide while leaving the Diagnose workflow algorithm unchanged.
- Return ordinary Implement domain outcomes normally and surface only protocol or internal exceptions as real Pi Tool errors.
- Delete the unreleased duplicate protocol, equality comparators, string-based failure classification, and compatibility paths rather than preserving aliases.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `abel-workflow-prompt-package`: Change Implement behavior, shared Worker result metadata, workflow-stage ownership, and completion/blocking semantics.
- `private-agent-orchestration`: Change Implement admission, retained-candidate identity, typed failure flow, task-lifetime conflict, terminal lifecycle, activity rendering, and Pi Tool error behavior.

## Impact

The change affects the private TypeScript extension under `src/`, package-owned Agents, the Implement prompt and shared workflow skill, both modified OpenSpec capabilities, and their contract, integration, lifecycle, distribution, and traceability tests. It adds no dependency, persistent runtime state, public orchestration API, automatic workflow transition, archive, commit, publication, or compatibility layer.
