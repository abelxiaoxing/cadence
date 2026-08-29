---
name: abel-workflow
description: Shared contract loaded only after an explicit /abel-init, /abel-design, /abel-implement, or /abel-diagnose invocation; never activate it for ordinary engineering work
---

# Abel workflow

This Skill applies only after the user explicitly invokes `/abel-init`, `/abel-design`, `/abel-implement`, or `/abel-diagnose`.
Merely finding these files, an OpenSpec change, an AGENTS index entry, or the word “Abel” does not activate a workflow.
Load this Skill only for the invoked stage and do not carry stage authority into an ordinary engineering request.

Stage prompts own their input and procedure.
This file owns the cross-stage integrity, recovery, verification, and authority rules.

## Gates and trusted delivery

Gate A approves the complete observable behavior contract.
Gate B separately approves the complete technical implementation contract.
Neither Gate grants tool permission, repository permission, identity, or authority outside its recorded scope.

Design and Implement may run in fresh contexts.
Trusted delivery requires:

- canonical receipt-schema-v4 Gate A and Gate B proofs for the same root/change/schema, each binding its approval revision, canonical contract hash, and owner-private journal record hash;
- an owner-private finalization fact binding the exact delivery revision, ready-receipt raw hash, both Gate proofs, and canonical plan hash;
- safe relative artifact paths and exact raw SHA-256 bindings;
- a canonical `implement-plan.json` with schema version, raw hash, and canonical hash;
- OpenSpec strict validity and planning completeness;
- Requirement → Scenario → Verification → Task traceability exactly once;
- executable verification closure and complete output/path/dependency/AGENTS contracts.

The loader aggregates all safe delivery diagnostics as `delivery-invalid` before a Worker starts.
Only tracked task checkbox markers for sealed task ids may normalize `[x]`/`[X]` to `[ ]`; every other byte remains hash-bound.

A fresh context validates existing approvals and never asks the user to approve unchanged decisions.
A new receipt revision is needed only when approved authority changes.

## Stage separation

- **Init** is deterministic local setup/repair.
  It uses no Subagent dispatch, preserves dirty/human content and nested repositories, and is idempotent.
- **Design** is evidence and delivery compilation only.
  Product code, tests, implementation candidates, and AGENTS files are read-only.
  The parent sees only its previously active `read`, `grep`, `find`, and `ls` tools plus `abel_dispatch` while Design is active.
  Design may use bounded read-only `design-explorer` packets.
- **Implement** uses only the durable change command surface.
  It executes the sealed plan in private immutable revisions and applies the complete change once.
- **Diagnose** independently follows reproduce → falsify → failing regression → minimum repair.
  It does not inherit Implement state, retry policy, or approval classification.

Design and Diagnose bounded packets use `action: "run"` with their own stage; every Design packet also binds the durable Design `runId` that requested it.
Implement never uses that packet protocol.
Cross-stage calls fail closed.

## Durable Design control

Design uses one closed private `action: "design"` family with `record-decision`, `approve-gate`, `write-artifact`, `delete-artifact`, `compile-plan`, and `finalize-delivery`.
The owner-private SQLite journal retains only normalized evidence identities/hashes, versioned decision hashes and refs, Gate proof facts, canonical compiled-plan identity/bytes, finalization identity, and idempotent operation outcomes.
It never retains prompts, transcripts, hidden reasoning, credentials, environment values, or raw model output.

Accepted evidence is recorded only after structural validation.
Same packet/result replay is idempotent; conflicting evidence for one packet id fails closed.
A later behavior decision invalidates both Gates; a later technical decision or plan compilation invalidates Gate B only.

The extension snapshots the exact pre-Design non-dispatch tool set; during Design it retains only the previously active `read`, `grep`, `find`, and `ls` tools plus `abel_dispatch`.
It removes every write-capable or unknown tool and restores the snapshot on finalization, explicit finish, verified stage switch, session start, or shutdown.
Private artifact mutation accepts bounded UTF-8 only at `.openspec.yaml`, `proposal.md`, `design.md`, `tasks.md`, `plan-draft.json`, and `specs/<safe-segments>/spec.md` relative to the active change root.
It creates missing directories component-wise without following symlinks, writes atomically, deletes only an allowed regular file, journals only bounded path/hash outcomes, and replays idempotently.
Code-owned `gate-a.yaml` and `ready.yaml` receipts remain forbidden; `implement-plan.json` remains unreachable except through compilation.

All filesystem-mutating Design operations serialize against the durable expiring finalization lease.
A competing or stale owner cannot inspect, replace, remove, or commit another operation's receipt bytes, and cleanup is fenced by the current operation's raw receipt hash.
After current Gate A, the parent sends the fixed `plan-draft.json` input only through `write-artifact`.
`compile-plan` owns canonical plan construction and installation.
Gate B binds that exact stored canonical plan hash.
`finalize-delivery` validates current proofs, OpenSpec, artifacts, traceability, and executable closure, writes Gate A and ready receipts atomically with `ready.yaml` last, rereads them, removes the draft, and completes Design.

## Canonical ImplementPlan

`ImplementPlan` is the only machine source for implementation mechanics.
It seals:

- exact task ids, dependencies, objectives, context, paths, deletes, conflicts, resources, and locks;
- structured Red, Green, optional Refactor verification plus verification inputs;
- unique regular-file outputs and their producer task/phase;
- task-affected and repair verification;
- target/affected/full-suite baselines and normalized failure identity;
- change affected/full-suite/post-apply verification;
- an explicit `artifactCorrection.maxAttempts` of 2-3 total candidate launches per task phase and operation, including the initial launch;
- bounded repair policy with `pre-existing | introduced | unresolved | environment` attribution;
- parent-owned Markdown checkbox tracking;
- approved managed-only AGENTS operations and verification.

The compiler, not prose parsing or the caller, canonicalizes and validates the plan.
A write set grants authority only; it never proves output existence.
An absent input must resolve to one declared output from a transitive dependency.
Unsafe paths, symlink components, missing local capability, cycles, conflicts without ordering, unsupported verification, and unbound outputs close readiness before Gate B.

Impact closure must cover existing compatibility evidence, not only newly added tests.
For public UI or API changes it seals the relevant route authorization, page state, API response and contract, public HTML/template/theme behavior, and approved browser E2E checks.

Verification supports only shell-free `vitest`, `package-script`, `static-check`, and ordered `steps` contracts.
Local runners/scripts, exact command bindings, args, classifications, verification inputs, `minTests`, and `noInstall` semantics are sealed.
Arbitrary shell, `&&`, path escape, and implicit downloads are forbidden.

## Durable control

Implement accepts only `start`, `status`, `resume`, `rebind`, `cancel`, and `discard` with stage, change, and operation identity where required.
The internal-development command surface has no caller-supplied protocol version.

- `start` is idempotent for one change run.
- `status` is local and requires no Worker endpoint.
- `resume` continues from durable facts; with a new approved `deliveryRevision` and `receiptHash`, it revalidates retained work and invalidates only incompatible tasks.
- `rebind` selects another route already allowed by policy; it does not change the task contract.
- `cancel` stops the active operation and preserves accepted progress.
  It is budget-neutral.
- `discard` is the only explicit destructive terminal command.
  During apply it waits for safe recovery before cleanup.

Repeated operation ids replay their committed outcomes.
Private state retains run journals, plan bindings, normalized task evidence, artifacts, revisions, retry classification, and apply recovery facts; it never stores credentials, environment values, raw prompts, hidden reasoning, transcripts, or raw model output.
Completed/discarded runs clean private change content after safe settlement.

## Red-Green-Refactor and attribution

Before the first candidate, record target-contract, task-affected, and full-suite baselines.
Pre-existing failures remain separate and never satisfy Red.

1. **Red:** the approved target must fail with its exact witness identity.
   Syntax/setup/no-test/wrong-identity failures are artifact defects.
2. **Green:** apply the minimum approved candidate in a disposable child revision and require target plus task-affected verification.
3. **Refactor:** optional in-boundary improvement with behavior and verification unchanged.

The parent control plane alone applies accepted candidate bytes to the private cumulative revision, records `phase-verified`/`repair-verified`, advances one task checkbox, verifies outputs, and schedules dependents.
A Worker only proposes one complete diff within the declared path set.

After all tasks, re-run every affected contract, compare the full suite with baseline, apply and verify sealed AGENTS operations, verify output postconditions, then prepare one currentness-checked journaled transaction and post-apply verification.
The main workspace remains unchanged before final application eligibility.

Attribution behavior:

- `pre-existing`: baseline evidence; do not blame or speculatively edit.
- `introduced`: reopen the owning task as `repairable` and perform bounded minimum repair inside its sealed boundary.
- `unresolved`: pause with normalized identities and retained cumulative state until ownership evidence is available.
- `environment`: pause before speculative edits and resume after capability restoration.

A full-suite-only baseline failure outside affected contracts does not block completion unless the change introduces or worsens it.

## Recovery versus approval

Artifact defects, wrong Red, stale revisions, transport errors, environment/adapter failures, capacity, conflicts, cancellation, process interruption, baseline failures, and introduced in-boundary repairs are recoverable Implement facts.
They never select a workflow stage and never erase compatible progress.

Automatic attempts are finite.
Artifact correction uses the sealed `artifactCorrection.maxAttempts` independently for each task phase and operation; only typed artifact rejection consumes its 2-3 total-launch budget.
Exhaustion pauses with the final safe code, scope, and last committed revision.
A later `resume` starts a new operation budget while reusing durable baseline and phase facts.
Oversized output becomes `needs-task-split`; partial diffs are never accepted.

Use `approval-needed` only when continuing requires new authority: observable behavior, architecture/policy, dependency, undeclared path, conflict/resource permission, verification contract, AGENTS target/impact/content, or another irreversible scope decision.
Report the exact missing authority.
After the user approves a new canonical delivery revision, resume the same run and preserve compatible work.

An approval-needed status exposes the closed authority category, required Gate set, safe refs, retained run/revision, and `/abel-design --change <change>` as user guidance only.
It never invokes Design automatically.
Bare `resume` or `rebind` is not an immediately legal approval continuation; `conditionalCommands` exposes resume only with a newer `deliveryRevision` and matching `receiptHash`.
Authority classification uses one exhaustive typed code map; an unknown approval code becomes an `approval-code-invalid` integrity pause rather than a guessed Gate.
A later explicit Implement status may locally discover a newer receipt only when its change, revision/hash, both current Gate proofs, and owner-private finalization fact match; it exposes the exact pair without admitting it or mutating the run.

Do not label an approved AGENTS checkpoint, documentation/test edit, endpoint outage, artifact error, stale snapshot, environment problem, baseline failure, or in-boundary repair as approval-needed.

## AGENTS indexes

Design audits AGENTS read-only.
Gate B seals `none | update-existing | create-index | remove-index`, exact target, owner task ids, complete managed block, and verification.

Implement applies the sealed operation code-first in the private cumulative revision.
It preserves every byte outside `<!-- ABEL:AGENTS-INDEX:START -->` and `<!-- ABEL:AGENTS-INDEX:END -->`; `remove-index` deletes the file only when no human content remains.
A Worker never receives an AGENTS write path.
Runtime/session ids, timestamps, credentials, approval state, and dirty-state ledgers never enter an index.

## Parent and Worker authority

The parent owns user decisions, Gates, delivery compilation, candidate acceptance, verification classification, cumulative revisions, tracking, AGENTS, final apply, recovery, and truthful status.

Evidence/diagnosis/implementation Agents receive only bounded context and scoped tools.
They cannot approve a Gate, expand a boundary, apply a patch, edit AGENTS, advance a checkbox, choose a user recovery action, or report completion.

`dev-browser` is required only by an explicitly approved browser-E2E contract.
Its absence pauses that verification only and does not block unrelated tasks or stages.

## Truthful finish

`queued`, `connecting`, `waiting-first-response`, `running`, `validating`, `retrying`, `verifying`, `paused`, `approval-needed`, `applying`, and `recovering` are nonterminal activity states.
`operation-cancelled` ends only the current operation; `discarded` and `rejected` are non-success terminal run states.
Tool settlement is not completion.
Only durable `completed` after cumulative apply and postconditions receives success.
Successful Design finalization, terminal Implement settlement, Diagnose `finish`, explicit stage finish, and session shutdown deactivate only `abel_dispatch`, drain packets, clear the parent bridge, and clear active stage identity.
Gate waits and resumable pauses remain active for direct follow-up.
Never archive, publish, release, stage, or commit implicitly.
