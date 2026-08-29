## 1. Serialized Design finalization

- [x] 1.1 Add failing overlap, expiry-recovery, and post-commit replay tests; then implement the durable per-run finalization lease, ownership assertions, revision serialization, and hash-owned cleanup.
  - Owns `specs/workflow-run-control-plane/spec.md#Serialized Design delivery commitment/Two finalizations overlap`
  - Owns `specs/workflow-run-control-plane/spec.md#Serialized Design delivery commitment/Finalization owner is interrupted`
  - Owns `specs/workflow-run-control-plane/spec.md#Serialized Design delivery commitment/Run completion fails after journal commitment`

## 2. Approval command and type boundary

- [x] 2.1 Add failing command-state and authority-mapping tests; then reject approval-state rebind/receipt-less resume and replace regex/default classification with an exhaustive typed map.
  - Owns `specs/workflow-run-control-plane/spec.md#Executable approval command boundary/Rebind is attempted during approval-needed`
  - Owns `specs/workflow-run-control-plane/spec.md#Executable approval command boundary/Resume omits a newer receipt`
  - Owns `specs/workflow-run-control-plane/spec.md#Executable approval command boundary/Runtime detects an empty write contract`
  - Owns `specs/workflow-run-control-plane/spec.md#Executable approval command boundary/Approval code is unknown`

## 3. Fresh-context delivery discovery

- [x] 3.1 Add failing discovery and admission-separation tests; then implement local proof-bound `discoverLatest`, status decoration with exact resume arguments, and prompt-driven same-run continuation.
  - Owns `specs/workflow-run-control-plane/spec.md#Locally discoverable newer delivery/New Design receipt is available in a fresh context`
  - Owns `specs/workflow-run-control-plane/spec.md#Locally discoverable newer delivery/Repository receipt is forged or stale`
  - Owns `specs/workflow-run-control-plane/spec.md#Locally discoverable newer delivery/Discovered delivery fails full admission`
  - Owns `specs/abel-workflow-prompt-package/spec.md#Self-contained explicit approval round trip/Ordinary Implement failure remains in stage`

## 4. Enforced parent Design boundary

- [x] 4.1 Add failing tool-isolation, restoration, safe-write, forbidden-target, delete, replay, and symlink tests; then implement Design tool snapshots plus bounded private artifact mutation.
  - Owns `specs/private-agent-orchestration/spec.md#Enforced parent Design tool boundary/Design starts with write tools active`
  - Owns `specs/private-agent-orchestration/spec.md#Enforced parent Design tool boundary/Design exits`
  - Owns `specs/private-agent-orchestration/spec.md#Safe private Design artifact mutation/Parent writes a Design artifact`
  - Owns `specs/private-agent-orchestration/spec.md#Safe private Design artifact mutation/Parent targets product code`
  - Owns `specs/private-agent-orchestration/spec.md#Safe private Design artifact mutation/Parent deletes an obsolete delta spec`

## 5. Four-entrypoint seam and package contract

- [x] 5.1 Add an extension-level explicit Implement → Design → Implement same-run journey and keep prompt/distribution/Skill/README/AGENTS contracts synchronized without adding a public command.
  - Owns `specs/abel-workflow-prompt-package/spec.md#Self-contained explicit approval round trip/User performs the approval round trip`
  - Owns `specs/abel-workflow-prompt-package/spec.md#Self-contained explicit approval round trip/Public command inventory is inspected`

## 6. Completion

- [x] 6.1 Run targeted Red-Green-Refactor suites, full check/lint/test/pack verification, exact traceability, fresh-process seed acceptance, AGENTS validation, real pack, and strict OpenSpec validation; archive only after every artifact and invariant is green.
