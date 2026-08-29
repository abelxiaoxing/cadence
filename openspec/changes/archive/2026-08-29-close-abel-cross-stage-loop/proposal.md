## Why

Implement recovery is durable, but the surrounding workflow is not yet closed: Design evidence and decisions are conversational, Gate receipts self-assert approval, delivery compilation has no supported control-plane entry, approval-needed cannot explain how to obtain a new receipt, and stage activation has no terminal cleanup. In an internal-development package with no compatibility burden, these gaps should be removed now instead of preserving an incomplete protocol.

## What Changes

- **BREAKING** replace the current receipt/control contract without a compatibility reader: Design packets bind to one durable Design run, accepted evidence and resolved decisions persist as structural facts, and Gate A/B approval records are journaled before a receipt can be emitted.
- Add a small Design-only private control surface for recording decisions, approving a Gate, compiling the canonical plan, and finalizing delivery; the four public `/abel-init`, `/abel-design`, `/abel-implement`, and `/abel-diagnose` entrypoints remain unchanged.
- Bind both Gate approval proofs into Implement admission and durable run status.
- Make `approval-needed` expose the exact missing-authority category, required Gate, retained Implement run, and receipt precondition while keeping stage selection user-owned and preserving compatible work.
- End private stage activation when Design becomes ready, Implement reaches a terminal state, Diagnose finishes, or an explicit stage finish is issued.
- Keep Design/Diagnose packet results bounded and structural; never persist prompts, transcripts, hidden reasoning, credentials, or raw model output.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `abel-workflow-prompt-package`: close the four-command cross-stage user journey and describe explicit approval handoff and stage finish behavior.
- `private-agent-orchestration`: bind evidence packets to durable runs and terminate private tool activation safely.
- `workflow-run-control-plane`: add durable Design facts, authenticated-by-private-journal Gate bindings, code-owned compilation, and actionable same-run approval continuation.

## Impact

The internal control schema, delivery receipt schema, SQLite journal, packet envelope, prompt contracts, extension activation lifecycle, delivery loader, and their integration/property tests change. No new dependency, public service, slash command, compatibility adapter, publication behavior, or implicit archive/commit behavior is introduced.
