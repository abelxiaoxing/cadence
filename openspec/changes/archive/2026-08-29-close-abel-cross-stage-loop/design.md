## Context

Implement already has a durable engine, private revisions, typed recovery, and transactional application. Design currently creates only a paused run identity; its packets are not run-bound, decisions are conversational, compiler functions have no supported stage entry, receipt approval is repository-self-asserted, and extension activation is cleared only at session boundaries. The package is still under internal development, so the corrected protocol replaces these incomplete semantics directly.

## Goals / Non-Goals

**Goals:**

- Make a fresh Design context sufficient to recover accepted evidence, resolved decisions, current Gate approvals, and compiled-plan identity.
- Give Design one small supported private control path for decision, approval, plan compilation, and delivery finalization.
- Make Implement approval pauses actionable while preserving the original run and preventing automatic stage invocation.
- Prove both Gate receipts against owner-private facts rather than repository bytes alone.
- End activation at real stage completion without breaking multi-turn Gate and resume conversations.

**Non-Goals:**

- User identity, signatures, cloud approval, team review, a public workflow API, arbitrary draft mutation, or a generic orchestration platform.
- Persisting prose conversations, raw child results, command logs, or model reasoning.
- Supporting the prior incomplete receipt/control behavior.

## Decisions

### 1. Keep four slash commands and add one Design action family internally

The public prompt surface remains unchanged. `abel_dispatch` gains `action: "design"` with four closed operations:

- `record-decision`
- `approve-gate`
- `compile-plan`
- `finalize-delivery`

Evidence remains `action: "run"`, now with a required Design `runId`; `cancel` and `finish` remain lifecycle actions. This is smaller than adding another slash command or exposing every compiler primitive as a public tool.

Alternative rejected: a generic `put-state` or arbitrary JSON builder. It would move schema authority back to the parent model and make recovery facts impossible to validate narrowly.

### 2. Use one minimal append-only Design journal beside the existing run database

A package-owned `DesignJournal` uses the existing owner-private SQLite database and adds only:

- append-only normalized facts for evidence, decision, approval, and plan identity;
- idempotent operation outcomes;
- a current compiled-plan record containing canonical plan bytes/hashes, never conversational input.

Each fact has a per-run sequence and canonical hash. Latest decision revisions determine currentness. A later behavior decision invalidates both Gates; a later technical decision or plan compile invalidates Gate B. Evidence is immutable by packet id.

Alternative rejected: putting Design state in OpenSpec artifacts. Before Gate A that violates the read-only boundary, and it would mix private workflow state with the product contract.

### 3. Compile from one fixed draft path and install delivery atomically

After Gate A, the parent may write `openspec/changes/<change>/plan-draft.json`. `compile-plan` reads only that exact safe regular file, calls the code-owned compiler, persists its identity, and atomically writes canonical `implement-plan.json`. Human `tasks.md` remains the traceability projection because it owns Requirement/Scenario references; finalization validates it rather than replacing it with a lossy generated file.

After Gate B binds the stored plan hash, `finalize-delivery` reuses the package OpenSpec inspection and delivery validation path, computes artifact and traceability bindings, writes `gate-a.yaml` and `ready.yaml` through temp-file rename with `ready.yaml` last, then rereads the installed delivery. Failure before the last rename leaves no new ready receipt; stale prior receipts are removed before compilation begins.

Alternative rejected: returning multi-megabyte canonical bytes for the parent to write. It creates another untrusted transport and still lacks atomic installation.

### 4. Treat private Gate facts as approval evidence, not user identity

Receipt schema version 4 contains for each Gate:

- approval revision;
- canonical contract hash;
- private record hash.

Gate A binds the canonical behavior-contract hash supplied when the parent records the user's explicit approval. Gate B must bind the exact stored canonical plan hash. Production Implement admission verifies both records against the Design journal for the same root/change before returning a trusted delivery. This proves that the verified workflow recorded an approval; it deliberately does not claim cryptographic human identity.

Alternative rejected: HMAC/signatures. They add key lifecycle and identity semantics the package does not otherwise own.

### 5. Separate executable and conditional continuations

`legalCommands` contains only commands executable now. Approval-needed status adds:

- `approval.category`
- `approval.requiredGates`
- `approval.refs`
- `approval.designRequest` (`/abel-design --change <change>` as user guidance, never automatic execution)
- `conditionalCommands`, where Implement `resume` requires a newer `deliveryRevision` and matching `receiptHash`.

Ordinary failures keep their current same-run commands. This removes the current false implication that bare `resume` can make approval progress.

### 6. End activation only at a semantic terminal boundary

The extension deactivates `abel_dispatch` when:

- Design finalization succeeds;
- Implement returns `completed`, `discarded`, or `rejected`;
- Diagnose explicitly sends `action: "finish"` after its final evidence/repair report;
- any stage explicitly finishes or the session shuts down.

Gate waits and nonterminal pauses remain active for direct follow-up. Deactivation clears `activePrompt`, drains packet execution, clears the parent bridge, and removes only `abel_dispatch`.

## Risks / Trade-offs

- **[Parent falsely records approval]** Private facts prove workflow recording, not human identity. → Keep approval calls available only in a verified Design stage and require prompts/tests to call them only after explicit user approval.
- **[Plan draft becomes an extra artifact]** It can confuse OpenSpec delivery coverage. → Treat the fixed draft as Design input, exclude it from receipts, and remove it after successful finalization.
- **[Interrupted finalization]** Gate A or plan bytes may be written before ready. → Remove stale ready first, use atomic per-file replacement, write ready last, and require Implement to validate the complete installed set.
- **[Existing tests encode the incomplete contract]** Static no-routing and repository-only receipt fixtures will fail. → Replace them with end-to-end Design approval/finalize/Implement-resume tests rather than add a compatibility branch.

## Migration Plan

1. Archive the already completed v2 redesign so the main specs become the only baseline.
2. Add the Design journal and run-bound packet contract behind failing tests.
3. Replace receipt schema with proof-bound version 4 and add code-owned finalization.
4. Add actionable approval continuation and dual-Gate Implement binding.
5. Add semantic activation teardown and synchronize all four prompts, Skill, README, package checks, and AGENTS index.
6. Run the full test, pack, traceability, fresh-process, and stage-journey matrix; archive this change only after every task is complete.

Rollback before release is a normal source revert plus removal of the owner-private development database. No receipt or journal compatibility migration is provided.
