## Goal

Clear requirements should require at most one consolidated decision round when existing authorization is insufficient. Mechanical compilation, recovery and supporting reads stay autonomous. Remaining implementation choices are delegated to the parent recommendation under the accepted Design; the parent records them and continues in the retained Implement stage without another user decision round.

## Approval and plan continuity

The journal preserves identical compilation, reference-only updates and privately finalized authority inheritance. The production compiler atomically records its plan and Gate B certificate; Gate B no longer requires a separate parent approval call. Gate A and accepted substantive choices still constrain compilation, and finalization checks OpenSpec, traceability, capabilities and both private proofs. Existing proof serialization is retained; a general structured ChangeContract replacement is not necessary for this repair.

Implement status projects all blockers, a revision-bound stable decision batch and its combined proof requirements. The extension admits a narrow `action: "amend"` channel while that exact batch is pending, including allowlisted delivery-invalid and task-split technical pauses. It verifies the same change before forwarding the existing private artifact operations, rejects stale batches and unrelated revision runs, and retains the Implement activation throughout. The amendment holds the original Implement run lease; artifact commitment rechecks that authority, cancellation fences late mutation, and cancellation/close settle outstanding amendments before storage closes. Finalization reports amendment readiness rather than Implement completion. Typed compilation/finalization diagnostics remain available to correct the draft in the same stage. The parent records its recommended implementation choices under the accepted Design; technical-only revisions inherit Gate A. Receipt-less resume discovers a newer local proof-bound delivery and performs full admission. Failed admission records the attempted revision/receipt pair in a checked private namespace, so discovery never recommends automatically retrying that rejected pair; a repaired, newly finalized delivery can continue. No stage-switching directive is emitted.

Status owns a parent continuation contract: known choices use `resolution.owner: parent`, `strategy: recommended`, and `requiresUserInput: false`; the parent follows the returned amendment or locally discovered resume action in the same turn. Workers still need compiled, verified authority before executing wider paths. Design goals, explicit constraints and acceptance criteria remain binding. TUI projects this continuation as recovery and omits the manual resume hint.

A separately checked amendment namespace retains a maximum of 64 mutating control attempts per Implement run. Reservations precede mutation; failed compilation consumes capacity, committed operation replay is free, and read-only status/preflight is exempt. Batch changes, cancellation and restart do not replenish it. Exhaustion removes the automatic amendment continuation without claiming completion. Cancelled runs and unrelated external/integrity pauses do not receive a plan-repair batch.

## Durable bounded recovery

Recovery facts live in a separate checked SQLite namespace, not attempt diagnostic JSON. The incident key binds the Red verification obligation with its non-semantic verification id removed, plus the current phase. Route, operation, task name, context prose and private workspace lineage are not recovery identities. A successful verified phase resolves its active episode; the append-only run history retains consumption. Cumulative repair cycle counts also survive restart.

Work remains reserved before execution and nested candidates use the same authority. The independent 24-failure stop is removed. Capacity is 24 plus three units per largest admitted phase count, capped by the host limit captured at run start (default 512); used work is never refunded. Ordinary resume/rebind does not replenish automatic correction. A parent may explicitly grant one launch against the current incident/failure sequence, with atomic reservation and durable replay fencing. Details and migration rationale are maintained in `docs/design/verification-runtime-and-recovery.md`.

The existing durable executor retains its bounded local repair mechanics, while their launches now share the parent reservation authority. Automatic correction still receives safe structured feedback. The parent can now submit a revised task decomposition through the existing compiler; an executor-owned dynamic DAG synthesis algorithm and general environment installation remain separate capabilities; output compaction is not described as task splitting, and missing external capabilities are reported truthfully.

## Supporting context without new product authority

The sealed task roots allow discovery of exact ordinary regular-file reads. Hidden paths and private-key files do not receive this automatic capability. The parent persists exact admitted reads across attempts and restart, passes them to the isolated child, and binds them to candidate merge, delivery evidence revalidation and final main-workspace currentness. Private-only declared outputs remain subject to the existing graph checks. The Worker still has phase-local writes/deletes, and a context request never grants a directory tree or a write path.

Changes to recovery limits retain compatible task evidence. Future attempts use the current plan policy while existing phase facts retain their original delivery identity. Safety-sensitive verification and authority fields remain in the compatibility comparison.

## Verification

Permanent regression coverage exercises the actual rejected-correction/rollback/resume composition for Red and Green, route replacement, retained budgets, nested reservations, combined authority gaps, same-stage amendment followed by fresh-session receipt-less resume, compiler-generated proof, preserved sibling evidence and discovered-read currentness. Existing isolation, lifecycle cancellation, Red-Green-Refactor, delivery forgery, apply recovery and package verification remain required.

Validation: `bun run verify` passed with 667 tests passed and 7 opt-in/platform skips; the real tarball contains the expected 67 members. Explicit real Bubblewrap validation passed all 3 isolation tests. Fresh-process seed acceptance passed 141 tests and type/syntax checks. Strict OpenSpec validation, all 42 active scenario traceability references, AGENTS checks, and whitespace checks passed.

## 完整归因与路由偏好

失败身份集合不再受模型摘要上限约束：完整基线封存到现有私有 ArtifactStore，ledger 保存 revision 和内容哈希引用，旧内联基线仍可读取。归因比较完成后，Worker、修复事件和公共状态最多保留 256 条相关失败。非 Vitest 失败身份绑定执行义务与证据，排除合同显示 ID；运行时策略升级为 `report-file-v3` 以触发旧证据重验。

Implement 路由保留 16,000 context / 8,000 output 硬下限，复杂度估算只决定自动选择的优先级。各优先级内保持配置顺序；满足硬下限的健康路由仍可 fallback 或显式 rebind。
