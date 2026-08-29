## 1. Durable Design state

- [x] 1.1 Add failing restart/idempotency/privacy tests, then implement the owner-private Design journal, run-bound evidence recording, versioned decisions, approval currentness, plan identity, and status projection.
  - Owns `specs/private-agent-orchestration/spec.md#Run-bound durable Design evidence/Evidence survives a restart`
  - Owns `specs/private-agent-orchestration/spec.md#Run-bound durable Design evidence/Packet targets another run`
  - Owns `specs/private-agent-orchestration/spec.md#Run-bound durable Design evidence/Evidence replay conflicts`
  - Owns `specs/private-agent-orchestration/spec.md#Minimal durable Design control data/Design state is inspected`
  - Owns `specs/workflow-run-control-plane/spec.md#Durable Design decisions and Gate proofs/Behavior changes after Gate A`
  - Owns `specs/workflow-run-control-plane/spec.md#Durable Design decisions and Gate proofs/Technical decision changes after Gate B`
  - Owns `specs/workflow-run-control-plane/spec.md#Durable Design decisions and Gate proofs/Approval operation is replayed`

## 2. Proof-bound compiler and admission

- [x] 2.1 Add failing compiler/admission tests, replace the receipt schema with private Gate proofs, implement fixed-path plan compilation and atomic finalization, and bind both verified Gate facts during Implement admission.
  - Owns `specs/workflow-run-control-plane/spec.md#Code-owned Design delivery compilation/Plan is compiled before Gate B`
  - Owns `specs/workflow-run-control-plane/spec.md#Code-owned Design delivery compilation/Parent hand-assembles a ready receipt`
  - Owns `specs/workflow-run-control-plane/spec.md#Code-owned Design delivery compilation/Delivery finalization succeeds`
  - Owns `specs/workflow-run-control-plane/spec.md#Code-owned Design delivery compilation/Finalization fails`
  - Owns `specs/workflow-run-control-plane/spec.md#Both Gate proofs bind Implement admission/Repository receipts are forged`
  - Owns `specs/workflow-run-control-plane/spec.md#Both Gate proofs bind Implement admission/Both current proofs are accepted`

## 3. Actionable same-run handoff

- [x] 3.1 Add failing approval journey tests, introduce structured missing-authority requirements and conditional commands, then prove Design revision resumes the original Implement run while ordinary failures remain local.
  - Owns `specs/abel-workflow-prompt-package/spec.md#Closed four-entrypoint approval handoff/Ordinary Implement failure remains local`
  - Owns `specs/abel-workflow-prompt-package/spec.md#Closed four-entrypoint approval handoff/Technical authority is missing`
  - Owns `specs/abel-workflow-prompt-package/spec.md#Closed four-entrypoint approval handoff/Behavior authority is missing`
  - Owns `specs/abel-workflow-prompt-package/spec.md#Closed four-entrypoint approval handoff/Revised delivery resumes implementation`
  - Owns `specs/workflow-run-control-plane/spec.md#Actionable approval-needed continuation/Approval-needed status is inspected`
  - Owns `specs/workflow-run-control-plane/spec.md#Actionable approval-needed continuation/Resume omits the required receipt`

## 4. Stage lifecycle and package contract

- [x] 4.1 Add failing activation teardown tests, end activation at semantic completion, and synchronize the four prompts, shared Skill, README, package/distribution assertions, and AGENTS managed index without adding a slash command.
  - Owns `specs/abel-workflow-prompt-package/spec.md#Explicit stage completion/Design becomes ready`
  - Owns `specs/abel-workflow-prompt-package/spec.md#Explicit stage completion/Implement pauses for a follow-up`
  - Owns `specs/abel-workflow-prompt-package/spec.md#Explicit stage completion/Implement terminates`

## 5. Completion

- [x] 5.1 Run targeted restart/handoff/activation tests, full check/lint/test/pack verification, exact traceability, fresh-process seed acceptance, AGENTS validation, and real OpenSpec strict validation; remove the temporary plan draft and archive this completed change only after all evidence is green.
