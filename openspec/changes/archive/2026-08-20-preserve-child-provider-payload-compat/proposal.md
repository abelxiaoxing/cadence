## Why

Isolated Subagent sessions currently reuse the parent Provider and auth but lose the parent session's effective Provider-payload compatibility rewrite. A child can therefore serialize a request the selected endpoint rejects even though the same parent model works, while generated implementation artifacts can pass structural diff checks yet fail to load and be misrouted into repeated Design/Implement cycles.

## What Changes

- Make each child Provider request reuse the selected effective parent Provider plus the parent session's payload-transform callback without loading parent, user, project, or other external extensions into the isolated child session.
- Fail closed before sending a child request when the inherited bridge or exposed effective callback cannot complete safely; do not fall back to an unmodified payload. Preserve Pi's parent-session semantics for an individual extension-handler error that Pi catches internally and does not expose to the callback caller.
- For `openai-responses` child requests, omit the optional serialized `max_output_tokens` field while retaining the existing timeout, cancellation, retry, and complete-result limits; do not invent another child output cap.
- Cover the boundary with a real `openai-responses` serialization regression, including transformed instructions/input, output-limit omission, and continued external-extension/resource isolation.
- Preflight generated implementation artifacts outside the main workspace before acceptance. Syntax, import/load, no-test, malformed-diff, and wrong-Red-identity failures receive only a finite artifact-correction budget; exhaustion blocks as an implementation-artifact delivery failure and MUST NOT automatically return the change to Design.
- After the one allowed identical Agent-request mechanical redispatch fails, return a sanitized, executable recovery condition that blocks that branch and its dependent successors, preserves independent accepted siblings, and distinguishes unchanged-contract retry exhaustion from changes that require Design.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `private-agent-orchestration`: Extend isolated child Provider compatibility, candidate-artifact preflight, and exhausted-recovery behavior.
- `abel-workflow-prompt-package`: Distinguish generated artifact rejection from a substantive contract defect so bounded implementation delivery cannot automatically cycle back to Design.

## Impact

- Affected runtime and workflow boundaries: parent/child Provider composition, isolated candidate-artifact admission, implementation failure classification, and the Abel implementation prompt contract.
- Affected verification: child-session/Provider integration, candidate-artifact acceptance/rejection, and runtime recovery tests, with a real local HTTP serialization path through the installed `openai-responses` adapter.
- No new external dependency, persistent state, public orchestration API, external extension loading, retry tier, or child output-budget platform.
