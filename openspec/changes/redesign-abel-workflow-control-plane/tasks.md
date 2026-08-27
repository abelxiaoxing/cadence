## 0. Execution contract

The seven tasks form the immutable DAG `T1 -> {T2, T3} -> T4 -> T5 -> T6 -> T7`, where T4 directly depends on T1 and T3 for contracts/artifacts and on T2 as a `conflict-order` barrier, T5 depends on T1-T4, T6 depends on T1-T5, and T7 depends on T6. Suggested waves are `[T1]`, `[T2, T3]`, `[T4]`, `[T5]`, `[T6]`, `[T7]`. Only T2 and T3 are parallel-eligible because their exact write sets, resources, and task-lifetime verification locks are disjoint: T2 uses `vitest-cadence-v2-route-policy`, T3 uses `vitest-cadence-v2-workspace-revisions`, and every serialized task uses `vitest-cadence-v2`. Every task uses roots `["."]` and approved dependency changes `[]`; conflicts are `[]` except that T4 declares `[T2-route-policy-broker]` to mirror its approved `conflict-order` barrier.

Before T1, the parent validates `gate-a.yaml`, `ready.yaml`, every bound hash, strict OpenSpec validation, graph closure, local Bun/Vitest capability, and the current workspace snapshot. Before each task, record target, affected-suite, and `bun run test` baselines with exit codes and normalized failure identities. A pre-existing failure never witnesses Red. Each Red phase writes only its new target test and must fail solely at `[CADENCE-V2:<task-id>]`; parse/import/load/no-test/wrong-identity failures reject the artifact. Each Green phase preserves the Red test, makes the target pass, and then permits only clarity-preserving refactoring within its Green write set while the target stays Green. The parent then runs the affected suite. With the exact v1 bootstrap selector still active, final T7 acceptance separately runs `bun run check`, `bun run lint`, `bun run test`, `bun run pack:check`, `bun run traceability:check`, `bun scripts/seed-acceptance.mjs`, `bun run check:agents`, strict OpenSpec validation, and `git diff --check`, with no new failure relative to baseline. Only after those facts commit may T7 write the resumable v2 handoff and perform the selector compare-and-swap; T7 is not complete before that cutover settles.

The phase verification shape is fixed: `kind: vitest`; runner `{ kind: package-script, packageManager: bun, script: test:target, command: "vitest run" }`; one exact `testFiles` entry; `args: []`; `minTests: 1`; Red classification `expected-red` with the task identity; Green classification `expected-green`. Each Red/Green verification binds the task's Red-test graph output and workspace `package.json` exactly once. Verification-lock names follow the task mapping above and therefore do not serialize the approved T2/T3 wave. Every declared graph output has postcondition `regular-file`. AGENTS and OpenSpec paths are parent-only and never enter a Worker phase write set.

## 1. Control contracts, durable store, and delivery compiler

- [ ] 1.1 `T1-control-store-delivery` — replace caller-owned workflow mechanics with v2 control contracts, durable state primitives, and a canonical delivery compiler.
  - Objective: define stable run identity with versioned delivery bindings, discriminated `start`/`status`/`resume`/`rebind`/`cancel`/`discard` commands, legal run/task projections, repository-external owner-private XDG state resolution, SQLite event/projection/lease contracts, and `PlanDraftV2 -> ImplementPlanV2` compilation while preserving the current v1 receipt only as this change's bootstrap.
  - Direct prerequisites: `[]`; dependency edges: none; required outputs for successors are the v2 control schema, run state/store API, state-root policy, graph/readiness v2 contract, and delivery compiler.
  - Requirement/Scenario ownership:
    - `specs/abel-workflow-prompt-package/spec.md#Private-orchestration MVP scope boundary/Private recovery state exists`
    - `specs/abel-workflow-prompt-package/spec.md#Private-orchestration MVP scope boundary/Obsolete internal protocol is invoked`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Delivery is compiled`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Valid cross-context handoff`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Invalid trusted delivery`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Stable facts are replayed`
    - `specs/workflow-run-control-plane/spec.md#Durable journal and restart recovery/Host restarts between phases`
    - `specs/workflow-run-control-plane/spec.md#Durable journal and restart recovery/Host stops during an uncommitted operation`
    - `specs/workflow-run-control-plane/spec.md#Durable journal and restart recovery/Durable state is inconsistent`
    - `specs/workflow-run-control-plane/spec.md#Durable journal and restart recovery/A v1 delivery is supplied`
    - `specs/workflow-run-control-plane/spec.md#Approval revision binding and controlled continuation/A missing technical path is discovered`
    - `specs/workflow-run-control-plane/spec.md#Approval revision binding and controlled continuation/A behavior change is required`
    - `specs/workflow-run-control-plane/spec.md#Approval revision binding and controlled continuation/A revised receipt is accepted`
    - `specs/workflow-run-control-plane/spec.md#Approval revision binding and controlled continuation/A Gate revision narrows authority`
    - `specs/workflow-run-control-plane/spec.md#Private run-data retention and cleanup/A run pauses`
    - `specs/workflow-run-control-plane/spec.md#Private run-data retention and cleanup/A run completes`
    - `specs/workflow-run-control-plane/spec.md#Private run-data retention and cleanup/Cleanup is interrupted`
    - `specs/workflow-run-control-plane/spec.md#Private run-data retention and cleanup/Repository state is inspected`
  - Dispatch context: root AGENTS managed index; Gate receipts; proposal; all four delta specs; design decisions 1-5 and 12; `src/contracts.ts`, `src/implement-graph.ts`, `src/safe-path.ts`, `src/verification-capability.ts`, and the existing contract/readiness tests.
  - Red phase: read `src/contracts.ts`, `src/implement-graph.ts`, `test/contracts.property.test.ts`, `test/implement-graph-readiness.property.test.ts`, and `package.json`; write only new `test/run-control-plane.property.test.ts`. Verification id `T1-control-store-delivery-red`; expected failure `[CADENCE-V2:T1-control-store-delivery]` because stable revision-independent run identity, the closed command surface including `rebind`, canonical compilation, durable replay/idempotency, or repository-external state-root invariants do not exist.
  - Green phase: read the Red scope plus `test/run-control-plane.property.test.ts`; write `src/contracts.ts`, `src/implement-graph.ts`, new `src/control-contracts.ts`, new `src/run-state.ts`, new `src/run-store.ts`, new `src/state-root.ts`, new `src/delivery-compiler.ts`, `test/contracts.property.test.ts`, and `test/implement-graph-readiness.property.test.ts`. Verification id `T1-control-store-delivery-green`; Green establishes stable run identity across Gate revision bindings, typed command discrimination including `rebind`, canonical round-trip/hash stability, event/projection replay equivalence, command idempotency, lease fencing, rejection of a resolved state path equal to or below the canonical consumer root, and closed v1 rejection.
  - Planned outputs: Red `test/run-control-plane.property.test.ts`; Green `src/control-contracts.ts`, `src/run-state.ts`, `src/run-store.ts`, `src/state-root.ts`, `src/delivery-compiler.ts`.
  - Scheduling: wave 1; `serial`; resources `[control-store-schema, delivery-v2]`; no declared conflict because the DAG orders every overlapping successor.
  - Verification type: `property`. Target: `bun run test:target test/run-control-plane.property.test.ts`. Affected suite: `bun run test:target test/run-control-plane.property.test.ts test/contracts.property.test.ts test/implement-graph-readiness.property.test.ts`.
  - Impact closure: changed surfaces `[none]`; `rg -n "ImplementGraphBoundary|ready.yaml|admit-graph|task-attempt|RunStore|receipt" src test prompts skills` supplies private-contract evidence. Current-task tests are all three affected tests; the latter two are pre-existing evidence. No route/page/API/public HTML/auth/template surface is changed.
  - AGENTS impact: `{ impact: none, managedOnly: true }`; no index path or checkpoint is authorized for this task.

## 2. Route policy and Worker broker

- [ ] 2.1 `T2-route-policy-broker` — replace environment endpoint pinning with a visible, bounded, capability-aware route broker.
  - Objective: load project-or-user JSON policy as a whole, validate closed role routes and `apiKeyEnv`, implement explicit inherited/custom provider composition, health/cooldown/failover/rebind behavior, and ensure status remains local when routes are unavailable.
  - Direct prerequisites: `[T1-control-store-delivery]`; edge type `contract`; consumes v2 control/run-store outputs so route provenance and recoverable operation state are durable and typed.
  - Requirement/Scenario ownership:
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Worker route fails`
    - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Connection deadline expires`
    - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Automatic attempts are exhausted`
    - `specs/subagent-endpoint-config/spec.md#Visible route-policy configuration/Project policy exists`
    - `specs/subagent-endpoint-config/spec.md#Visible route-policy configuration/Parent identity is allowed`
    - `specs/subagent-endpoint-config/spec.md#Visible route-policy configuration/Effective policy is inspected`
    - `specs/subagent-endpoint-config/spec.md#Visible route-policy configuration/V1 keys are present`
    - `specs/subagent-endpoint-config/spec.md#Capability and health aware route selection/First route is unhealthy`
    - `specs/subagent-endpoint-config/spec.md#Capability and health aware route selection/No route is eligible`
    - `specs/subagent-endpoint-config/spec.md#Capability and health aware route selection/Route recovers`
    - `specs/subagent-endpoint-config/spec.md#Capability and health aware route selection/Health changes after candidate acceptance`
    - `specs/subagent-endpoint-config/spec.md#Route-policy validation and recoverable unavailability/Route is partially configured`
    - `specs/subagent-endpoint-config/spec.md#Route-policy validation and recoverable unavailability/Policy is corrected`
    - `specs/subagent-endpoint-config/spec.md#Route-policy validation and recoverable unavailability/Existing run is inspected under invalid policy`
    - `specs/subagent-endpoint-config/spec.md#Bounded route-attempt behavior/Connection bound expires`
    - `specs/subagent-endpoint-config/spec.md#Bounded route-attempt behavior/First response never arrives`
    - `specs/subagent-endpoint-config/spec.md#Bounded route-attempt behavior/Stream becomes idle`
    - `specs/subagent-endpoint-config/spec.md#Bounded route-attempt behavior/Custom route sends a request`
    - `specs/subagent-endpoint-config/spec.md#Bounded route-attempt behavior/Inherited route sends a request`
    - `specs/subagent-endpoint-config/spec.md#Explicit run route rebinding/Automatic allowed failover occurs`
    - `specs/subagent-endpoint-config/spec.md#Explicit run route rebinding/User explicitly rebinds`
    - `specs/subagent-endpoint-config/spec.md#Explicit run route rebinding/Rebind route lacks capability`
    - `specs/subagent-endpoint-config/spec.md#Explicit run route rebinding/Rebind attempts to widen authority`
    - `specs/workflow-run-control-plane/spec.md#Recoverable lifecycle classification/Endpoint transport fails repeatedly`
  - Dispatch context: T1 outputs and ledger evidence; design decision 9; endpoint delta; `src/subagent-endpoint.ts`, `src/parent-provider.ts`, `src/contracts.ts`, `src/control-contracts.ts`, `src/run-state.ts`, `src/run-store.ts`, `config/.env.example`, and the endpoint tests.
  - Red phase: read those source/config paths plus `test/subagent-endpoint.integration.test.ts`, `test/subagent-endpoint.property.test.ts`, and `package.json`; write only new `test/worker-broker.integration.test.ts`. Verification id `T2-route-policy-broker-red`; expected failure `[CADENCE-V2:T2-route-policy-broker]` because whole-file policy precedence, explicit inherited routes, bounded progress timers, cooldown, and authorized rebind do not exist.
  - Green phase: read the Red scope plus `test/worker-broker.integration.test.ts`; create `src/route-policy.ts`, `src/worker-broker.ts`, `config/routes.example.json`, `test/route-policy.integration.test.ts`, and `test/route-policy.property.test.ts`; modify `src/parent-provider.ts` and `config/.env.example`; delete `src/subagent-endpoint.ts`, `test/subagent-endpoint.integration.test.ts`, and `test/subagent-endpoint.property.test.ts`. Verification id `T2-route-policy-broker-green`; Green enforces 5s connect/headers, 30s first delta, 60s idle, 10m total, one attempt per eligible route per operation, and a 30s half-open cooldown with no undeclared fallback.
  - Planned outputs: Red `test/worker-broker.integration.test.ts`; Green `src/route-policy.ts`, `src/worker-broker.ts`, `config/routes.example.json`, `test/route-policy.integration.test.ts`, `test/route-policy.property.test.ts`.
  - Scheduling: wave 2; `eligible` in parallel only with T3; resources `[route-policy, provider-runtime]`; exact writes are disjoint from T3.
  - Verification type: `example`. Target: `bun run test:target test/worker-broker.integration.test.ts`. Affected suite: `bun run test:target test/worker-broker.integration.test.ts test/route-policy.integration.test.ts test/route-policy.property.test.ts`.
  - Impact closure: changed surfaces `[none]`; `rg -n "SUBAGENT_|subagent-endpoint|ParentProvider|onResponse|Provider" src test config` classifies the private endpoint/provider surface. Current-task tests are the three new route/broker tests; the two removed endpoint suites are replacement evidence. No application route, page, API response, public HTML, auth, or template surface exists.
  - AGENTS impact: `{ impact: none, managedOnly: true }`.

## 3. Artifact store and immutable workspace revisions

- [ ] 3.1 `T3-workspace-revisions` — introduce content-addressed artifacts, immutable workspace manifests, and an isolation backend boundary.
  - Objective: capture dirty and approved untracked baselines without Git worktrees, enforce safe exact paths and immutable revision deltas, support disjoint merge commutativity and stale overlap rejection, and fail closed when Bubblewrap is unavailable.
  - Direct prerequisites: `[T1-control-store-delivery]`; edge type `contract`; consumes safe v2 path/output and state-root contracts. It produces workspace revision APIs required by T4.
  - Requirement/Scenario ownership:
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Related file change makes a result stale`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Main workspace changed`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Compatible tasks produce parallel results`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Unrelated sibling application preserves currency`
    - `specs/private-agent-orchestration/spec.md#Parent-owned change-workspace acceptance/Candidate reaches the main workspace early`
  - Dispatch context: T1 outputs; design decisions 5-6 and 12; `src/file-snapshot.ts`, `src/safe-path.ts`, `src/candidate-preflight.ts`, `src/patch.ts`, `test/file-snapshot.property.test.ts`, and `test/candidate-diff-admission.property.test.ts`.
  - Red phase: read those paths plus `package.json`; write only new `test/workspace-store.property.test.ts`. Verification id `T3-workspace-revisions-red`; expected failure `[CADENCE-V2:T3-workspace-revisions]` because immutable manifest round-trip, blob integrity/refcounts, dirty baseline capture, merge commutativity, and isolation capability closure do not exist.
  - Green phase: read the Red scope plus `test/workspace-store.property.test.ts`; create `src/artifact-store.ts`, `src/workspace-store.ts`, and `src/isolation-backend.ts`; modify `src/file-snapshot.ts`, `src/safe-path.ts`, `test/file-snapshot.property.test.ts`, and `test/candidate-diff-admission.property.test.ts`. Verification id `T3-workspace-revisions-green`; Green proves content hashes/byte counts, atomic writes, exact absent/file facts, no symlink escape, disjoint merge commutativity, and overlapping stale rejection.
  - Planned outputs: Red `test/workspace-store.property.test.ts`; Green `src/artifact-store.ts`, `src/workspace-store.ts`, `src/isolation-backend.ts`.
  - Scheduling: wave 2; `eligible` in parallel only with T2; resources `[artifact-store, workspace-revisions]`; exact writes are disjoint from T2.
  - Verification type: `property`. Target: `bun run test:target test/workspace-store.property.test.ts`. Affected suite: `bun run test:target test/workspace-store.property.test.ts test/file-snapshot.property.test.ts test/candidate-diff-admission.property.test.ts`.
  - Impact closure: changed surfaces `[none]`; `rg -n "fileSnapshot|safe-path|worktree|bundle|Bubblewrap|candidate" src test` captures every private filesystem and isolation consumer. All three tests are current-task, with the latter two pre-existing evidence; no web or public contract surface changes.
  - AGENTS impact: `{ impact: none, managedOnly: true }`.

## 4. Transactional candidate verification and final apply

- [ ] 4.1 `T4-transactional-apply` — move all candidate and cumulative verification into immutable revisions and make final delivery recoverable.
  - Objective: reconstruct private revisions, run strict/current verification through `IsolationBackend`, prepare a journaled compare-and-swap apply intent, record each file step, and recover by safe roll-forward or rollback without overwriting external edits.
  - Direct prerequisites: `[T1-control-store-delivery, T2-route-policy-broker, T3-workspace-revisions]`; edge types `contract`, `conflict-order`, and `artifact`; T2 is an explicit scheduling barrier so T2/T3 is the only parallel wave, while T1/T3 supply the control/store and artifact/workspace/isolation outputs. It produces apply/preflight facts required by T5 and T6.
  - Requirement/Scenario ownership:
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Verification finds an introduced failure`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Repair requires boundary expansion`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Runtime apply advances a phase`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Parent reports verification without apply`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Affected-suite baseline is green`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Existing affected failure is present`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Later run reveals a previously masked failure`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Affected failure is environmental`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Affected repair requires a substantive decision`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Full-suite-only baseline failure exists`
    - `specs/private-agent-orchestration/spec.md#Parent-owned change-workspace acceptance/Current candidate is accepted`
    - `specs/private-agent-orchestration/spec.md#Parent-owned change-workspace acceptance/Candidate preflight fails`
    - `specs/private-agent-orchestration/spec.md#Parent-owned change-workspace acceptance/Caller claims verification`
    - `specs/private-agent-orchestration/spec.md#Transactional cumulative delivery/Task phase succeeds`
    - `specs/private-agent-orchestration/spec.md#Transactional cumulative delivery/Full suite fails`
    - `specs/private-agent-orchestration/spec.md#Transactional cumulative delivery/Final currentness passes`
    - `specs/private-agent-orchestration/spec.md#Transactional cumulative delivery/Final application is interrupted`
    - `specs/workflow-run-control-plane/spec.md#Transactional change completion/Red succeeds as an expected failure`
    - `specs/workflow-run-control-plane/spec.md#Transactional change completion/Change verification succeeds`
    - `specs/workflow-run-control-plane/spec.md#Transactional change completion/Main workspace became stale`
    - `specs/workflow-run-control-plane/spec.md#Transactional change completion/Apply is interrupted`
  - Dispatch context: accepted T1/T2/T3 outputs; design decisions 6, 10, and 12; `src/candidate-preflight.ts`, `src/patch.ts`, `src/verification-capability.ts`, `src/file-snapshot.ts`, `src/safe-path.ts`, and all candidate/apply/checkpoint tests below.
  - Red phase: read T1/T3 produced APIs, those existing source files, `test/candidate-preflight.property.test.ts`, `test/patch.integration.test.ts`, `test/agents-checkpoint.integration.test.ts`, `test/verification-capability.test.ts`, `test/text-patch-headers.integration.test.ts`, and `package.json`; write only new `test/apply-transaction.integration.test.ts`. Verification id `T4-transactional-apply-red`; expected failure `[CADENCE-V2:T4-transactional-apply]` because interruption recovery, per-file CAS, external-edit preservation, and cumulative private verification are absent.
  - Green phase: read the Red scope plus `test/apply-transaction.integration.test.ts`; create `src/apply-transaction.ts`; modify `src/candidate-preflight.ts`, `src/patch.ts`, `src/verification-capability.ts`, and the five existing test suites named in the Red phase while preserving the Red test unchanged. Verification id `T4-transactional-apply-green`; Green proves intent-before-mutation, step recording, idempotent recovery, cancel/discard pending intents that retain rollback data until safe settlement, strict/current isolated verification, typed attribution, and unchanged dependency policy.
  - Planned outputs: Red `test/apply-transaction.integration.test.ts`; Green `src/apply-transaction.ts`.
  - Scheduling: wave 3; `serial`; conflicts `[T2-route-policy-broker]` because the approved graph permits no T2/T4 overlap; resources `[workspace-revisions, apply-transaction, verification-sandbox]`.
  - Verification type: `example`. Target: `bun run test:target test/apply-transaction.integration.test.ts`. Affected suite: `bun run test:target test/apply-transaction.integration.test.ts test/candidate-preflight.property.test.ts test/patch.integration.test.ts test/agents-checkpoint.integration.test.ts test/verification-capability.test.ts test/text-patch-headers.integration.test.ts`.
  - Impact closure: changed surfaces `[none]`; `rg -n "preflightCandidate|applyRetainedPatch|AGENTS checkpoint|verification-capability|currentness" src test` locates all private acceptance consumers. The new apply test and five existing suites are current-task evidence; no public route/page/API/HTML/auth/template surface changes.
  - AGENTS impact: `{ impact: none, managedOnly: true }`; T7 owns the only index checkpoint after the architecture stabilizes.

## 5. Sealed artifacts, task ledger, and replaceable child sessions

- [ ] 5.1 `T5-worker-artifacts-ledger` — replace one-shot diff retention and conversational continuity with sealed segments and a durable task ledger.
  - Objective: admit ordered 128 KiB segments up to an 8 MiB sealed candidate, retain exact candidate bytes in the artifact store, normalize bounded phase evidence in `TaskLedger`, and reconstruct every new child session from ledger projections plus scoped reads.
  - Direct prerequisites: `[T1-control-store-delivery, T2-route-policy-broker, T3-workspace-revisions, T4-transactional-apply]`; edge types `contract` and `artifact`; consumes route, artifact, revision, apply, and control facts so a replacement Worker can continue without a transcript.
  - Requirement/Scenario ownership:
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Worker delivers a task phase`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Candidate artifact cannot load or has the wrong Red identity`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Artifact correction budget is exhausted`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Worker diff exceeds its result boundary`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Task Red fails for the wrong reason`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Task Red contract is invalid`
    - `specs/private-agent-orchestration/spec.md#Sealed structured artifact delivery/Evidence packet succeeds`
    - `specs/private-agent-orchestration/spec.md#Sealed structured artifact delivery/Candidate is sealed`
    - `specs/private-agent-orchestration/spec.md#Sealed structured artifact delivery/Candidate remains incomplete`
    - `specs/private-agent-orchestration/spec.md#Sealed structured artifact delivery/Worker needs more context`
    - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Replacement Worker resumes`
    - `specs/private-agent-orchestration/spec.md#Recoverable attempts and Worker replacement/Result capacity is insufficient`
    - `specs/private-agent-orchestration/spec.md#Task context ledger continuity/Green follows Red in a new session`
    - `specs/private-agent-orchestration/spec.md#Task context ledger continuity/Artifact correction starts`
    - `specs/private-agent-orchestration/spec.md#Task context ledger continuity/Worker claim conflicts with the ledger`
    - `specs/private-agent-orchestration/spec.md#Task context ledger continuity/Warm session is lost`
    - `specs/private-agent-orchestration/spec.md#Durable run and ephemeral child lifecycle/Child session is disposed`
    - `specs/private-agent-orchestration/spec.md#Durable run and ephemeral child lifecycle/Nested usage is recorded`
  - Dispatch context: accepted T1-T4 outputs; design decisions 7-9; `src/result-store.ts`, `src/submit-tool.ts`, `src/child-session.ts`, `src/scoped-tools.ts`, parent payload/provider boundaries, and all child/scoped-tool tests below.
  - Red phase: read `src/artifact-store.ts`, `src/workspace-store.ts`, `src/apply-transaction.ts`, `src/route-policy.ts`, `src/worker-broker.ts`, `src/result-store.ts`, `src/submit-tool.ts`, `src/child-session.ts`, `src/scoped-tools.ts`, `test/child-session.integration.test.ts`, `test/child-session-cancellation.test.ts`, `test/openai-responses-child.integration.test.ts`, `test/scoped-tools.property.test.ts`, and `package.json`; write only new `test/task-ledger.integration.test.ts`. Verification id `T5-worker-artifacts-ledger-red`; expected failure `[CADENCE-V2:T5-worker-artifacts-ledger]` because sealed ordering/hash/size bounds and restart-safe Red-to-Green evidence do not exist.
  - Green phase: read the Red scope plus `test/task-ledger.integration.test.ts`; create `src/task-ledger.ts`; modify `src/result-store.ts`, `src/submit-tool.ts`, `src/child-session.ts`, `src/scoped-tools.ts`, and the four existing test suites named in the Red phase while preserving the Red test unchanged. Verification id `T5-worker-artifacts-ledger-green`; Green rejects partial/duplicate/out-of-order segments, pauses oversize work as `needs-task-split`, never persists raw prompts/transcripts/model output, and supplies bounded trustworthy evidence to a fresh replacement child.
  - Planned outputs: Red `test/task-ledger.integration.test.ts`; Green `src/task-ledger.ts`.
  - Scheduling: wave 4; `serial`; resources `[artifact-store, task-ledger, child-session]`.
  - Verification type: `example`. Target: `bun run test:target test/task-ledger.integration.test.ts`. Affected suite: `bun run test:target test/task-ledger.integration.test.ts test/child-session.integration.test.ts test/child-session-cancellation.test.ts test/openai-responses-child.integration.test.ts test/scoped-tools.property.test.ts`.
  - Impact closure: changed surfaces `[none]`; `rg -n "ResultStore|submit|child session|scoped-tools|observedRead|usage" src test` covers every private child delivery consumer. The new ledger test and four existing suites are current-task evidence; public application surfaces are unaffected.
  - AGENTS impact: `{ impact: none, managedOnly: true }`.

## 6. Workflow engine, durable scheduler, and private control tool

- [ ] 6.1 `T6-workflow-engine` — make `WorkflowEngine` the sole v2 transition authority and integrate durable scheduling, recovery, cancellation, and lifecycle control behind the active bootstrap selector.
  - Objective: admit only v2 delivery inside the new engine, derive readiness and operations there, queue conflicts durably, drive route-bound ephemeral attempts, commit verified revision deltas, recover leases/apply including pending cancel/discard, expose local status and typed `rebind`, and prepare a resumable bootstrap handoff while keeping the exact v1 bootstrap activation selected through T7 acceptance.
  - Direct prerequisites: `[T1-control-store-delivery, T2-route-policy-broker, T3-workspace-revisions, T4-transactional-apply, T5-worker-artifacts-ledger]`; edge type `contract`; consumes every lower-level v2 service and produces the final control surface for T7.
  - Requirement/Scenario ownership:
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Conflicting task is opened`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Task boundary is opened`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Cancellation interrupts a launch`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/AGENTS checkpoint is required`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Terminal task is replayed`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Implementation completes`
    - `specs/private-agent-orchestration/spec.md#Private workflow control surface/Eligible stage activates control`
    - `specs/private-agent-orchestration/spec.md#Private workflow control surface/Ordinary prompt inspects tools`
    - `specs/private-agent-orchestration/spec.md#Private workflow control surface/Parent submits graph mechanics`
    - `specs/private-agent-orchestration/spec.md#Private workflow control surface/Stage ends with paused work`
    - `specs/private-agent-orchestration/spec.md#Durable graph scheduling and conflict queueing/Approved plan is loaded twice`
    - `specs/private-agent-orchestration/spec.md#Durable graph scheduling and conflict queueing/Conflicting task becomes ready`
    - `specs/private-agent-orchestration/spec.md#Durable graph scheduling and conflict queueing/Independent tasks finish concurrently`
    - `specs/private-agent-orchestration/spec.md#Durable graph scheduling and conflict queueing/Producer output is unavailable`
    - `specs/private-agent-orchestration/spec.md#Durable run and ephemeral child lifecycle/Process shuts down`
    - `specs/private-agent-orchestration/spec.md#Durable run and ephemeral child lifecycle/One run completes`
    - `specs/private-agent-orchestration/spec.md#Control-plane domain outcomes and Tool errors/Run pauses normally`
    - `specs/private-agent-orchestration/spec.md#Control-plane domain outcomes and Tool errors/Operation is cancelled`
    - `specs/private-agent-orchestration/spec.md#Control-plane domain outcomes and Tool errors/Protocol request is invalid`
    - `specs/private-agent-orchestration/spec.md#Control-plane domain outcomes and Tool errors/Internal invariant fails`
    - `specs/workflow-run-control-plane/spec.md#Versioned change-oriented run commands/A change run starts`
    - `specs/workflow-run-control-plane/spec.md#Versioned change-oriented run commands/Start is repeated`
    - `specs/workflow-run-control-plane/spec.md#Versioned change-oriented run commands/Status is requested while every endpoint is unavailable`
    - `specs/workflow-run-control-plane/spec.md#Versioned change-oriented run commands/An active operation is cancelled`
    - `specs/workflow-run-control-plane/spec.md#Versioned change-oriented run commands/A run is discarded`
    - `specs/workflow-run-control-plane/spec.md#Recoverable lifecycle classification/Two tasks conflict`
    - `specs/workflow-run-control-plane/spec.md#Recoverable lifecycle classification/Generated candidate remains invalid`
    - `specs/workflow-run-control-plane/spec.md#Recoverable lifecycle classification/Full verification introduces a failure`
  - Dispatch context: accepted T1-T5 outputs; design decisions 1-3, 10-11; `src/runtime.ts`, `src/worker.ts`, `src/scheduler.ts`, `src/drain.ts`, `src/activation.ts`, `src/index.ts`, and all runtime/lifecycle tests below.
  - Red phase: read all produced v2 service APIs plus the six runtime modules, `test/runtime-recovery.property.test.ts`, `test/runtime-scheduler.integration.test.ts`, `test/runtime-verification-readiness.integration.test.ts`, `test/runtime-activity.property.test.ts`, `test/scheduler.property.test.ts`, `test/lifecycle.integration.test.ts`, `test/drain.property.test.ts`, `test/workflow-routing.integration.test.ts`, `test/two-worker.e2e.test.ts`, `test/file-concurrency.integration.test.ts`, `test/activation.test.ts`, `test/prompt-activation.integration.test.ts`, `test/usage.property.test.ts`, `test/runtime-subagent-endpoint.integration.test.ts`, and `package.json`; write only new `test/workflow-engine.integration.test.ts`. Verification id `T6-workflow-engine-red`; expected failure `[CADENCE-V2:T6-workflow-engine]` because current Runtime remains process-local and caller-driven, has no exposed typed `rebind`, and reports exhausted blocked activity as completed.
  - Green phase: read the Red scope plus `test/workflow-engine.integration.test.ts`; create `src/workflow-engine.ts` and `test/runtime-worker-broker.integration.test.ts`; modify `src/runtime.ts`, `src/worker.ts`, `src/scheduler.ts`, `src/drain.ts`, `src/activation.ts`, `src/index.ts`, `test/runtime-recovery.property.test.ts`, `test/runtime-scheduler.integration.test.ts`, `test/runtime-verification-readiness.integration.test.ts`, `test/runtime-activity.property.test.ts`, `test/scheduler.property.test.ts`, `test/lifecycle.integration.test.ts`, `test/drain.property.test.ts`, `test/workflow-routing.integration.test.ts`, `test/two-worker.e2e.test.ts`, `test/file-concurrency.integration.test.ts`, `test/activation.test.ts`, `test/prompt-activation.integration.test.ts`, and `test/usage.property.test.ts`; delete `test/runtime-subagent-endpoint.integration.test.ts`; preserve the Red test unchanged. Verification id `T6-workflow-engine-green`; Green proves idempotent start/status/resume/rebind/cancel/discard, stable run identity across delivery revisions, durable queue/restart/lease/apply recovery, recovery-before-pause-or-discard after apply mutation, local status without Worker access, engine-only v2 transitions, truthful non-completed paused activity, a resumable bootstrap handoff path, continued exact-receipt v1 bootstrap selection, and no early main-workspace writes.
  - Planned outputs: Red `test/workflow-engine.integration.test.ts`; Green `src/workflow-engine.ts`, `test/runtime-worker-broker.integration.test.ts`.
  - Scheduling: wave 5; `serial`; resources `[workflow-engine, scheduler, private-tool]`.
  - Verification type: `example`. Target: `bun run test:target test/workflow-engine.integration.test.ts`. Affected suite: `bun run test:target test/workflow-engine.integration.test.ts test/runtime-worker-broker.integration.test.ts test/runtime-recovery.property.test.ts test/runtime-scheduler.integration.test.ts test/runtime-verification-readiness.integration.test.ts test/runtime-activity.property.test.ts test/scheduler.property.test.ts test/lifecycle.integration.test.ts test/drain.property.test.ts test/workflow-routing.integration.test.ts test/two-worker.e2e.test.ts test/file-concurrency.integration.test.ts test/activation.test.ts test/prompt-activation.integration.test.ts test/usage.property.test.ts`.
  - Impact closure: changed surfaces `[none]`; `rg -n "admit-graph|task-attempt|Runtime|Scheduler|activate|drainStage|ToolResult|completed" src test` captures the complete private control and lifecycle-activity surface, including the existing v1 blocked-as-completed regression. All affected tests are current-task; all except the two new v2 tests are pre-existing evidence. No public app route/page/API/HTML/auth/template surface changes.
  - AGENTS impact: `{ impact: none, managedOnly: true }`; index text waits for the stable T7 package surface.

## 7. Workflow UX, prompts, Agents, and distribution

- [ ] 7.1 `T7-workflow-ux-distribution` — project durable semantic state truthfully, synchronize the v2 workflow/package contract, and close the one-time bootstrap safely.
  - Objective: update activity rendering, Design/Implement prompts, shared Skill, professional Agents, docs, package metadata, seed/pack checks, and provenance so users operate the closed change-oriented v2 command surface and only an actually completed run receives a success checkmark; keep v1 selected while the complete acceptance matrix runs, then durably commit `BootstrapHandoff` before the one-way v2 selector cutover.
  - Direct prerequisites: `[T6-workflow-engine]`; edge type `contract`; consumes the final engine command/outcome/activity schema. It is the only task with a parent-owned AGENTS checkpoint.
  - Requirement/Scenario ownership:
    - `specs/abel-workflow-prompt-package/spec.md#Private-orchestration MVP scope boundary/MVP package excludes a general platform`
    - `specs/abel-workflow-prompt-package/spec.md#Private-orchestration MVP scope boundary/Seed wave remains bounded`
    - `specs/abel-workflow-prompt-package/spec.md#Private-orchestration MVP scope boundary/Gate approval is not tool permission`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/New design reaches Gate A`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Independent Design packets run concurrently`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Delegated Design evidence remains untrusted`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Evidence Worker becomes unavailable`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Mechanical choices remain non-blocking`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Existing change is resumed`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Artifact integrity is invalid`
    - `specs/abel-workflow-prompt-package/spec.md#Design behavior and trusted delivery/Design is complete`
    - `specs/abel-workflow-prompt-package/spec.md#Implementation behavior/Approved compatibility path fails`
    - `specs/abel-workflow-prompt-package/spec.md#Safe package contents and independence/Tarball is inspected`
    - `specs/abel-workflow-prompt-package/spec.md#Safe package contents and independence/Global deployment files are absent`
    - `specs/abel-workflow-prompt-package/spec.md#Safe package contents and independence/Forbidden workflow checkout is absent`
    - `specs/abel-workflow-prompt-package/spec.md#Safe package contents and independence/Reference attribution remains self-contained`
    - `specs/abel-workflow-prompt-package/spec.md#Safe package contents and independence/Paused run state is inspected`
    - `specs/abel-workflow-prompt-package/spec.md#Safe package contents and independence/Finished run state is inspected`
    - `specs/abel-workflow-prompt-package/spec.md#Safe package contents and independence/Delegation leaves no private state files`
    - `specs/private-agent-orchestration/spec.md#Truthful private lifecycle activity/Transport policy is retrying`
    - `specs/private-agent-orchestration/spec.md#Truthful private lifecycle activity/Task needs approval`
    - `specs/private-agent-orchestration/spec.md#Truthful private lifecycle activity/Tool call returns a paused outcome`
    - `specs/private-agent-orchestration/spec.md#Truthful private lifecycle activity/Non-TUI status is requested`
  - Dispatch context: accepted T6 output and full change workspace; design decisions 4, 9, and 11 plus the migration cutover; `src/runtime.ts`, `src/worker.ts`, `src/scheduler.ts`, `src/drain.ts`, `src/activation.ts`, `src/index.ts`, `src/subagent-activity.ts`; both workflow prompts; shared Skill; all four package Agents; README/package/distribution/provenance files; and all UX/package/activation tests below.
  - Red phase: read `src/runtime.ts`, `src/worker.ts`, `src/scheduler.ts`, `src/drain.ts`, `src/activation.ts`, `src/index.ts`, `src/subagent-activity.ts`, `prompts/abel-design.md`, `prompts/abel-implement.md`, `skills/abel-workflow/SKILL.md`, `agents/design-explorer.md`, `agents/implementation-worker.md`, `agents/diagnosis-worker.md`, `agents/contract-reviewer.md`, `README.md`, `package.json`, `scripts/pack-check.mjs`, `scripts/seed-acceptance.mjs`, `provenance/adapted-modules.yaml`, `config/routes.example.json`, `test/workflow-engine.integration.test.ts`, `test/runtime-worker-broker.integration.test.ts`, `test/runtime-recovery.property.test.ts`, `test/runtime-activity.property.test.ts`, `test/activation.test.ts`, `test/prompt-activation.integration.test.ts`, `test/subagent-activity.property.test.ts`, `test/subagent-activity.integration.test.ts`, `test/prompts.test.mjs`, `test/stage-contracts.test.mjs`, `test/workflow-skill.test.mjs`, `test/distribution.test.mjs`, `test/package-contract.test.mjs`, and `test/independence.test.ts`; write only new `test/workflow-ux.integration.test.ts`. Verification id `T7-workflow-ux-distribution-red`; expected failure `[CADENCE-V2:T7-workflow-ux-distribution]` because prompts/package/UI still describe v1 graph attempts, the package lacks an acceptance-gated resumable cutover, and tool settlement is conflated with completion.
  - Green phase: read the Red scope plus `test/workflow-ux.integration.test.ts`; modify `src/runtime.ts`, `src/worker.ts`, `src/scheduler.ts`, `src/drain.ts`, `src/activation.ts`, `src/index.ts`, `src/subagent-activity.ts`, `prompts/abel-design.md`, `prompts/abel-implement.md`, `skills/abel-workflow/SKILL.md`, `agents/design-explorer.md`, `agents/implementation-worker.md`, `agents/diagnosis-worker.md`, `agents/contract-reviewer.md`, `README.md`, `package.json`, `scripts/pack-check.mjs`, `scripts/seed-acceptance.mjs`, `provenance/adapted-modules.yaml`, `test/activation.test.ts`, `test/prompt-activation.integration.test.ts`, `test/subagent-activity.property.test.ts`, `test/subagent-activity.integration.test.ts`, `test/prompts.test.mjs`, `test/stage-contracts.test.mjs`, `test/workflow-skill.test.mjs`, `test/distribution.test.mjs`, `test/package-contract.test.mjs`, and `test/independence.test.ts`; preserve `config/routes.example.json`, the T6 engine/recovery/activity tests, and the Red test unchanged. Verification id `T7-workflow-ux-distribution-green`; Green exposes queued/connecting/waiting/running/validating/retrying/verifying/paused/approval-needed/applying/recovering/cancelled/discarded/rejected/completed truthfully, exposes `rebind`, keeps the exact v1 bootstrap selected through all acceptance checks, commits a reload-resumable v2 handoff before selector CAS, rejects every other v1 delivery after cutover, ships routes example and v2 resources, raises Node to `>=22.13.0`, and retains no hidden checkout/global deployment dependency.
  - Planned output: Red `test/workflow-ux.integration.test.ts`; all Green paths already exist and therefore are postconditions rather than new graph outputs.
  - Scheduling: wave 6; `serial`; resources `[workflow-engine, scheduler, private-tool, workflow-contracts, package-distribution, activity-ui, bootstrap-cutover]`.
  - Verification type: `example`. Target: `bun run test:target test/workflow-ux.integration.test.ts`. Affected suite: `bun run test:target test/workflow-ux.integration.test.ts test/workflow-engine.integration.test.ts test/runtime-worker-broker.integration.test.ts test/runtime-recovery.property.test.ts test/runtime-activity.property.test.ts test/activation.test.ts test/prompt-activation.integration.test.ts test/subagent-activity.property.test.ts test/subagent-activity.integration.test.ts test/prompts.test.mjs test/stage-contracts.test.mjs test/workflow-skill.test.mjs test/distribution.test.mjs test/package-contract.test.mjs test/independence.test.ts`.
  - Impact closure: changed surfaces `[none]`; `rg -n "abel-design|abel-implement|Subagent|completed|nextStep|admit-graph|task-attempt|BootstrapHandoff|rebind" README.md package.json src prompts skills agents scripts provenance test` captures the whole private package UX/distribution and cutover surface. Every affected test is current-task, and all except the new v2 UX test are pre-existing evidence. This package has no application route/page/API/auth/template surface.
  - AGENTS impact: `{ impact: update-existing, target: AGENTS.md, managedOnly: true }`. After Green and complete diff inspection, the parent updates only the managed block to route v2 control/store/compiler, broker/policy, artifact/workspace/isolation, ledger, engine/apply, activity, prompt, package, and verification ownership; verify with `bun run check:agents`. The Worker never receives `AGENTS.md` in a write set.
