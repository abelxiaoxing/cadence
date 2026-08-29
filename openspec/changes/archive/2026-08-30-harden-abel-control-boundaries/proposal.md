## Why

The four-command workflow now avoids automatic cross-stage routing, but several residual gaps can still split Design finalization state, accept a command that status declares illegal, make a fresh-context approval handoff depend on copied receipt data, or rely on prompt obedience for the parent Design write boundary. Because this package is still under internal development, these private contracts should be replaced cleanly now instead of accumulating compatibility or recovery exceptions.

## What Changes

- **BREAKING** serialize Design finalization with one durable per-run lease and hash-owned cleanup so concurrent operations cannot duplicate a delivery revision or remove another operation's committed receipt.
- Make `approval-needed` command legality executable rather than advisory: `rebind` and a receipt-less `resume` fail closed until a newer verified delivery is available.
- Let local Implement status discover an owner-private-proof-verified newer receipt and expose its exact revision/hash, allowing a fresh explicit `/abel-implement` invocation to resume the retained run without copied conversational state.
- Replace regex/default approval classification with a closed exhaustive authority-code map and exact Gate requirements.
- Enforce the parent Design write boundary by temporarily exposing only read-only parent tools plus `abel_dispatch`, restoring the prior tool set on stage exit, and routing OpenSpec artifact writes through a safe Design-only private operation.
- Add a real extension-level Implement approval → explicit Design revision → same Implement resume journey while retaining exactly the four public Abel prompts.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `workflow-run-control-plane`: serialize Design delivery commitment, strictly enforce approval-state commands, expose verified local delivery availability, and use closed typed authority classification.
- `abel-workflow-prompt-package`: make the four-entrypoint fresh-context approval journey self-contained without automatic stage invocation.
- `private-agent-orchestration`: enforce and restore the parent Design tool boundary and admit only safe change-artifact writes.

## Impact

The private SQLite schema, Design controller/journal, delivery source, Implement status projection, stage activation tool policy, private `abel_dispatch` Design request schema, prompts, shared Skill, AGENTS index, and integration/property tests change. No public prompt, dependency, compatibility reader, publication behavior, or implicit commit/archive behavior is added.
