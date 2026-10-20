# Independent planning scope/readiness review

## Verdict and review boundary

**Complete scope is preserved; one coordination-contract correction should precede final plan approval.**
No MVP, dashboard-only milestone, deferred core history, or second production executor is proposed.
The modules, reuse strategy, public SDK seams, dependency/provenance gates and integrated verification plan are otherwise coherent enough to proceed through the stated approval gate.
This review does not authorize implementation or qualify any runtime behavior.

The main session owns corrections and the final user-facing review.
Only this report was intentionally written; no product/spec/task-metadata edits, dependency installation, product tests/builds, service/browser/provider execution, credential access, task start, delegation or Git mutation occurred.
Readonly JSON/path inspection below is planning evidence, not product-test evidence.

### Material read

- Read parent `prd.md`, `design.md` and `implement.md` completely from disk.
- Read `research/work-package-map.json` completely; its location is under `research/`, not the parent directory root.
- Read all seven linked children's complete `prd.md`, `design.md`, `implement.md`, `task.json`, `implement.jsonl` and `check.jsonl`.
- Read the parent metadata and both manifests; inspected every manifest entry's file existence.
- Read `research/{approved-design-boundaries,assertion-dispositions,design-service-contract,design-execution-history,design-ui-distribution,complete-workspace-reuse,pi-web-ui-access-token,pi-web-ui-model-auth-reference}.md`.
- Spot-checked maintained backend/frontend indexes and quality guides, backend distribution and the cross-layer guide; reviewed relevant actual store/process/worker/build/package sources.
- Read official global Pi SDK documentation and the full-control example; checked proposed APIs against installed public declarations and implementation rather than substituting the global version's behavior.
- Rechecked upstream HEAD as `e8bab487af208bc9a1ab60a821652323f598127f`, with empty upstream porcelain status; inspected its dependency lock entries.

## 1. Blocking correction

### B1 — Registration overlap exclusion stops at non-Git roots

**Severity:** blocking coordination-design gap for R5/R8, AC11; W1 owns the correction, with W4/W7 verification.

**Exact plan location:** parent `design.md:83–102`, especially line 88, restricts overlap rejection to “overlapping registered non-Git roots.”
Per-owner reader/writer gates then cover only that owner's root.
The same paragraph also does not expressly make registry overlap-check plus registration reservation one cross-process critical section.

**Verified source basis:**

- `src/task-store.ts:114–138` resolves Git roots through `git rev-parse --show-toplevel`; a nested Git repository/submodule has a different canonical root from its containing checkout.
- `src/task-store.ts:193–203,266–279` hashes that root into a different private directory and acquires a root-specific lock.
  Holding both root-specific locks therefore does not exclude the other owner.
- Current code workers receive ordinary write/edit/bash tools (`src/sdk-worker.mjs:250–259`); there is no path boundary preventing the containing checkout's assignment from editing the nested checkout's files.
  Parent checks also run ordinary host commands (`src/subagent-process.ts:514–538`).
- `research/design-service-contract.md` §2 already identified nested checkouts and a short registry mutation lock.
  The reviewed parent keeps the documented state-home domain, but its selected overlap wording loses the nested-Git protection.

**Concrete failure:** start supported owners for `/project` and `/project/nested`, where both are Git roots, in the same state-home with different explicit ports.
Each can acquire its own v1/service lock and its own exclusive writer lane.
A parent assignment writing `nested/file` and a nested assignment writing `file` can then run together against the same physical file.
These are two supported service owners, not merely an unrelated external editor or escaped descendant.
Even the stated non-Git overlap rule needs serialized registry reservation to survive two concurrent starts.
This is a source-derived counterexample, not an executed reproduction.

**Smallest correction:** in parent design §3.2, require the state-home registry to reject canonical ancestor/descendant execution-root overlaps **regardless of Git classification**, and serialize overlap validation plus reservation under one short registry coordination lock with the existing unknown-lock preservation policy.
Do not create a new global-home discovery system, recursive scheduler or general filesystem sandbox.
Disjoint worktrees remain independent; existing unknown registrations/fences remain preserved.
Add one W1 checklist item and explicit `test/service-owner.test.ts` scenarios for nested Git/mixed/non-Git roots and simultaneous registrations, with W7 integration traceability to AC11.
A normal same-root alias test alone does not cover this case.

## 2. Improvements and implementation qualification gates

These are not missing product features or reasons to narrow the approved scope.

### I1 — Awaited capture does not bound every upstream SDK buffer

**Priority:** important W2 qualification clarification, not a claim that the selected public hook is nonexistent.

The installed `pi-agent-core@0.84.3` really exposes awaited `Agent.subscribe()` and sequential `toolExecution` (`dist/agent.d.ts:57–72`); `dist/agent.js:380–419` awaits listeners in order.
The design is correct to avoid treating asynchronous `AgentSession.subscribe()` callbacks as backpressure.
However, `pi-ai/dist/utils/event-stream.js:2–31,44–58` has an unbounded producer queue, and `pi-agent-core/dist/agent-loop.js:201–225` awaits downstream emission while consuming that queue.
Thus awaiting the recorder can pause consumption without establishing end-to-end provider-stream backpressure.
The proposed worker/owner queue ceilings do not themselves bound this upstream buffer.

**Smallest improvement:** add a sentence to parent §8 distinguishing bounded Cadence queues from SDK/provider buffering, and a W2 actual-SDK fast-provider/slow-recording fixture in `test/lightweight-sdk.test.ts`.
Exercise cancellation while consumption is stalled, observed ingress limits, final drain and native settlement; do not count a synthetic awaited-listener test alone as this evidence.
If qualification requires additional ingress accounting, place it at a supported public stream boundary and review it there, not by importing SDK internals or silently upgrading peers.
Retain explicit incomplete capture on failure and do not claim a universal process-memory ceiling.

### I2 — Freeze the v1 summary projection, not just its total-file ceiling

**Priority:** small W3/W4 contract clarification before parallel implementation.

Parent §9 correctly separates authoritative retained history from strict v1 human-readable summaries.
Actual `src/task-types.ts:121–130` also bounds plan to 32KiB, result/baseline to 16KiB and activity to 64 entries, beyond the parent paragraph's named 1000-task/32-check/128KiB ceilings.
Existing `TaskController` truncates its summary fields; that old behavior must not accidentally become truncation of the new retained detail.

**Smallest improvement:** assign W3 the bounded v1-summary mapping explicitly: short labeled summaries with stable run references in existing text fields, never new v1 keys; full detail remains in history-v2.
Specify how unknown/blocked/recording-failed outcomes map conservatively into v1's smaller phase vocabulary.
Add one long-final-message plus legacy-summary assertion to `test/service-history.test.ts`/`test/lightweight-store-controller.test.ts`.
An otherwise valid long retained result should not encounter an unexpected publication failure merely because the implementation copied its whole body into `task.result`.

### I3 — Make the joint W2/W3 contract freeze and shared-test handoffs explicit

**Priority:** execution-plan precision; no inherent dependency cycle found.

W2 requires agreement on W3's artifact sink; W3 requires agreement on W2's frames.
This is compatible with the parent's W1 interface freeze and concurrent implementation, because these are interface agreements, not mutual completed implementations.
The children repeatedly identify `test/service-contract.test.ts` and several other shared test files, while the parent correctly prohibits concurrent shared-file edits.

**Smallest improvement:** name one W1-owned freeze handoff containing the agreed producer/sink/coverage signatures with W2/W3 review, and name the editor/handoff for shared contract tests before dispatch.
Do not interpret the existing reciprocal agreement language as “wait for the other child to finish.”
No extra product stage or child is needed.

### I4 — Classify required evidence lanes before final completion review

**Priority:** W7 reporting precision.

The plan correctly distinguishes actual source/extracted service, native PTYs, real browser, loopback/fabricated OAuth, TLS proxy and viewport evidence from physical phone/human, second-machine, manager-install, paid-provider and Windows/macOS/ConPTY qualification.
It also correctly says a blocked required lane keeps the parent open.
The remaining ambiguity is which additional named lanes are mandatory acceptance gates versus explicitly unqualified supported-environment claims.

**Smallest improvement:** W7's acceptance/evidence table should mark each lane `required-for-this-delivery` or `additional-qualification`, with its AC, execution boundary and blocker/receipt owner.
Do not change any AC or waive a required lane through this classification; return any material scope decision to the user.
In particular, two local browser contexts plus a phone viewport must never be relabeled as a physical phone or second-machine receipt.
No historical green suite, source citation or successful reference-map validation supplies missing execution evidence.

### I5 — Parent metadata still describes the earlier narrower idea

**Priority:** low, main-session metadata correction only.

Parent `task.json:4–5` says “WebUI ... alongside terminal execution” and “selective reuse,” while the PRD now approves two independent clients, a persistent owner and substantial family reuse.
All children have appropriate current descriptions and reciprocal links.
Update only the parent title/description to summarize the current complete redesign; leave status `planning` until the explicit approval gate.
The stale description does not override the PRD and was not treated as a scope cut in this review.

## 3. Complete-scope coverage

Every R1–R14 and AC1–AC22 is represented in the parent design, a work-package owner and the integrated acceptance matrix.
The following is a coverage finding, **not a passed-test map**.

| Requirement group | Concrete planned delivery                                                                                                                                    | Principal owners / acceptance           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| R1                | Both clients create, plan/decompose, Start, Cancel, check, inspect changes and record human review; neither needs the other client.                          | W1/W4/W5/W6; AC1,6,8                    |
| R2                | Stable child identities, dependencies, wait/lifecycle/closure/outcome, messages/tools and actual timeline; connection and checks remain separate.            | W2/W4/W5/W6; AC2,10,12,18               |
| R3                | Directly adapted layout/navigation/transcript/tool/rich/review/search/timeline/responsive/reconciliation/auth families, pinned provenance and notices.       | W1/W6/W7; AC3,22                        |
| R4                | Shared owner, context-bound commands, durable receipts, one active episode/task, snapshot watermarks, no mutation replay and lost-final reconciliation.      | W1/W3/W4 and both clients; AC2,4,7,9,19 |
| R5                | Strict legacy bytes, expected-byte publication, explicit old-detail absence, baseline dirt/staleness, separate private history and unknown fences.           | W1/W3/W4/W7; AC5,9,11,19,21; B1 applies |
| R6                | Explicit Start/check/review, advisory plan generation, readonly capabilities, local-only manual checks; no browser shell or authority from access/reconnect. | W1/W4/W5/W6; AC5–7,12,14–15             |
| R7                | Explicit service management, client detach, concurrent bounded cancellation, accounted auth writes, no restart dispatch, informed recovery.                  | W1/W4/W5; AC1,8–9,20                    |
| R8                | Finite graph, bounded readonly overlap, fair exclusive writers/checks, dependency freshness and honest partial aggregation.                                  | W4 with W1–W3; AC10–12; B1 applies      |
| R9                | Explicit same-host HTTPS proxy route, exact Host/Origin and cookie/CSRF/WS policy, usable remote owner controls.                                             | W1/W6/W7; AC13–14                       |
| R10               | Token-link bootstrap before application load, clean redirect, HttpOnly cookie, explicit invalidation/rotation, no accounts.                                  | W1/W6; AC15                             |
| R11               | Existing selected Pi auth/models, public ModelRuntime, coordinated OAuth writeback, no second login/profile, no fallback/late spawn.                         | W1/W2/W4; AC16                          |
| R12               | W7 requires the whole source/extracted/client/service/history/package acceptance set; children are not product releases.                                     | W7; AC17,22                             |
| R13               | Viewer-independent rich capture, committed immutable pages, exact search hits beyond first page/ring, full selected NDJSON/Markdown export and coverage.     | W2/W3/W5/W6; AC18–21                    |
| R14               | Desktop/phone controls, CLI/status/stop/diagnosis/recovery, operation docs, actual assets/notices and boundary-specific qualification.                       | W1/W5/W6/W7; AC13,17,20,22              |

No requirement is displaced by unrelated general-chat, PTY, SCM mutation, plugin-marketplace, account-management, restart-continuation or credential-management features.
Those exclusions are consistent with the PRD, not a hidden MVP.
The legacy terminal-only/departure-cancels/no-production-dependency assertions are deliberately superseded, with retained safety intent recorded in `assertion-dispositions.md`.
They are not blockers to this approved redesign.

## 4. Technical feasibility and reuse findings

### Public SDK/capture contracts

- Inspected local coding-agent/agent-core/pi-ai identities are all **0.84.3**, matching `package.json` development pins; their metadata requires Node `>=22.19.0`.
  The proposed engine update is grounded in dependencies, not runtime qualification of every eligible Node.
- Public `ModelRuntime.create` options include `authPath`, `modelsPath`, `modelsStore`, `allowModelNetwork` and `refreshOnCreate`; `getAuth` accepts `minOAuthValidityMs`.
  No nonexistent `agentDir` construction flag or `ModelRuntime.dispose()` is required by the selected parent design.
- Installed `pi-ai/dist/auth/resolve.js:66–116` refreshes under `CredentialStore.modify`, uses the caller signal in refresh and rejects an explicitly requested validity window that a refreshed token cannot cover.
  Keeping a separate nonaborted owner operation signal and tracking its original promise is material for this pinned version; global 1.2 documentation is not substituted for it.
- `createLocalBashOperations` and `ToolDefinition` are root public exports (`pi-coding-agent/dist/index.d.ts:7,24`).
  `core/tools/bash.js:246` constructs the stock `OutputAccumulator` even when operations are supplied.
  Consequently the research's narrow custom ToolDefinition using public operations is the correct adaptation; merely passing custom operations to the stock accumulator would not remove its raw-spill path.
- Installed tool lifecycle events contain actual `toolCallId`, args, updates, result and `isError` (`pi-agent-core/dist/types.d.ts:395–417`).
  Message events carry message objects, not a guaranteed universal public message ID; W2 must allocate its own stable local occurrence/message IDs rather than assume a newer peer field.
- Source inspection supports these seams, but does not establish native cleanup, ingress/backpressure, redaction, OAuth coordination or provider-network success.
  The W1/W2 actual-boundary qualification gates are necessary and remain unexecuted here.

### Modules, package paths and licenses

- Contract/client, lifecycle/auth/admission, graph/scheduler/actions, history reader/writer/search/export, worker codecs/process settlement and the two presentation clients have coherent ownership.
  The design explicitly removes the reachable embedded TaskController executor rather than preserving a competing fallback.
- Generated `src/service-cli.mjs` is consistent with `scripts/build-operator.mjs`'s local-source/external-package pattern and the worker launcher's `new URL("./sdk-worker.mjs", import.meta.url)` at `src/subagent-process.ts:503`.
  Actual generated/extracted tests must still prove asset resolution; source-path consistency is not proof of bundler output.
- Browser `web/dist` assets, worker/Agent paths, new bin, exact member/body audits and the previous 64-entry diagnostic cap are assigned to W6/W7.
  Pack must use already-built assets and cannot rely on TypeScript loaders or consumer compilation for the service.
- Upstream locked React19.3.0/Vite8.3.0/plugin-react6.1.1/ws8.21.3/playwright-core1.63.0/vis-timeline8.5.4/KaTeX0.18.7 entries match the research inventory.
  These are inspected lock identities only, not assertions that dependencies are locally provisioned or runnable.
- Substantial reuse is specified at source-family level, including the whole standalone timeline client and associated layout/styles/helpers/tests, not just a few token helpers.
  Removal of appSend, runtime-open/repair, auto-continue, plugin/PTY/Git controls and inferred status/timing is appropriately at the adapters/composition boundary.
- Full upstream MIT copyright/notice, actual bundled closure/font/vendor notices, source/destination hashes and audited package assets are explicit gates.
  Missing dependency/license/browser bodies are correctly provisioning blockers; SPDX lock fields alone are not treated as a completed license audit.

## 5. Task graph, manifests and quality readiness

`task.py current --source` resolved `.trellis/tasks/10-16-cadence-webui-terminal` through the current Pi session.
The parent and all seven children are still `planning`; each child points back to the parent and the parent lists exactly those seven children.
No completed date/commit is recorded.

Both manifests contain real spec/research entries for every task, with no missing referenced file observed:

| Task                      | Implement entries | Check entries |
| ------------------------- | ----------------: | ------------: |
| Parent                    |                16 |            16 |
| W1 service-owner          |                12 |            12 |
| W2 worker-capture         |                10 |            10 |
| W3 durable-history        |                10 |            10 |
| W4 subagent-orchestration |                10 |            10 |
| W5 terminal-client        |                12 |            12 |
| W6 complete-webui         |                14 |            14 |
| W7 integrated-delivery    |                16 |            16 |

The dependency order is actionable: W1 shared interfaces → W2/W3 agreed producer/store → W4 real orchestration → W5/W6 integrated clients → W7 whole-product qualification.
Presentation ports may start against frozen typed fixtures, but none can satisfy real acceptance until the owner/producer/store exist.
W7 may prepare fixtures/docs earlier without being a product release or a prerequisite implementation cycle.
I3 clarifies a handoff rather than repairing a circular task graph.

Named test targets exist as present/proposed responsibilities rather than asserted passes.
The parent distinguishes pure/fake-host tests, actual filesystem/native processes/SDK fixtures, real PTYs, real browser DOM and source/extracted package execution.
It requires negative auth, stale/duplicate actions, unknown closure, crash windows, quotas/corruption, long history, no-viewer capture and truthful check/review semantics, not only happy-path mocks.
Missing browser/dependencies fail the required lane rather than triggering installation or a green skip.
No test, build, package extraction, browser session, task validator or runtime qualification was run in this review.

## 6. Smallest main-session follow-up

1. Correct B1 in parent §3.2 and W1's coordination/test checklist; keep the current state-home and preservation boundaries.
2. Consider I1–I4 at the existing W1/W2/W3/W7 freezes, and refresh the stale parent metadata wording in I5.
3. Complete the parent's planning-only validation checklist on the revised artifacts and record the correction disposition.
4. Present the full plan for the user's fresh implementation approval; until then leave every task `planning`.

No feature cut, extra product phase, credential action or new speculative subsystem is recommended.
