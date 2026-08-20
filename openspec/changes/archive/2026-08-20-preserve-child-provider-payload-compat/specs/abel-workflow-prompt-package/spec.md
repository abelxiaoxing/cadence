## MODIFIED Requirements

### Requirement: Implementation behavior

`abel-implement` SHALL require a change name and validate the design delivery in a fresh context before modifying code or tests.
It SHALL return to Design rather than recreate decisions when delivery validation fails.
Before writing, it SHALL run and record target, affected-suite, and full-suite baselines with stable failure identities and separate every pre-existing failure from the task Red.
Each task's exact affected-suite commands SHALL define that task's dynamic repair boundary: every reproducible pre-existing failure they expose SHALL enter the task for verified root-cause analysis and minimum repair, while a full-suite-only baseline failure outside those commands SHALL not.
Environmental, transient, external-service-dependent, non-reproducible, or unattributable failures SHALL block completion without authorizing speculative product edits.
A repair that requires new behavior, policy, dependency, architecture, irreversibility, or another substantive decision SHALL return to Design.

Implementation SHALL recompute ready work from the trusted task DAG and MAY dispatch compatible ready tasks concurrently only when their prerequisites, declared read and write sets, conflict edges, shared resources, and validation locks permit it.
Each Worker result SHALL bind hashes for the files it actually read and every path it proposes to create, modify, or delete.
The parent SHALL review accepted candidates serially and SHALL NOT apply a generated implementation artifact to the main workspace until parent-owned isolated preflight proves complete diff consumption, current snapshot and declared-path conformance, source/test loadability, and the approved phase verification identity.
A sibling result SHALL remain current after an unrelated file changes, but SHALL become stale before application if any file in its bound read or write snapshot changed.
A stale result MUST NOT be applied and MAY receive only the single allowed identical mechanical redispatch.
Red, Green, and optional Refactor results SHALL each bind a fresh current file snapshot.

Task-local professional Agents SHALL return complete unified diffs without writing the workspace or running validation.
The parent SHALL exclusively accept or reject results, preflight and apply exact accepted diffs, run approved commands, return compact normalized validation evidence, update AGENTS indexes, and advance task state.
Syntax, import/load, no-test, malformed-diff, and wrong-Red-identity failures SHALL be classified as generated implementation-artifact rejection rather than target Red or a substantive Design defect.
An artifact rejection MAY receive only the task's approved finite correction budget; exhaustion SHALL block that task and its dependents with a sanitized implementation-artifact recovery condition and SHALL NOT automatically return the change to Design.
Only a required change to behavior, policy, dependency, architecture, scope, write set, or the approved verification contract SHALL return the affected work to Design.
Implementation SHALL run target verification after every applied code or test diff, run the affected suite after refactoring, update AGENTS indexes only at stable task checkpoints, and finish only when target and affected verification pass and the full suite has no new failure relative to baseline.
It SHALL NOT modify unrelated dirty files or implicitly archive or publish the change.

#### Scenario: Valid cross-context handoff

- **WHEN** receipts, artifact hashes, traceability, strict validation, and task contracts are valid in a fresh context
- **THEN** implementation proceeds without requesting either Gate again

#### Scenario: Compatible tasks produce parallel results

- **WHEN** multiple ready tasks have accepted prerequisites and compatible declared scopes, conflicts, resources, and validation locks
- **THEN** their read-only Workers may run concurrently within the runtime limit while the parent retains serial result review and application

#### Scenario: Unrelated sibling application preserves currency

- **WHEN** two concurrent results bind disjoint file snapshots and the parent applies the first result
- **THEN** the second result remains eligible for review because none of its bound read or write files changed

#### Scenario: Related file change makes a result stale

- **WHEN** a file in a result's bound read or write snapshot changes before that result is applied
- **THEN** the parent rejects it as stale and does not apply it without an allowed identical redispatch

#### Scenario: Worker delivers a task phase

- **WHEN** a task Worker returns a complete in-scope Red, Green, or Refactor candidate diff bound to the current file snapshot and isolated preflight proves its approved phase contract
- **THEN** the parent may accept and apply that exact diff, run the approved verification, and retain sole ownership of AGENTS and task-state changes

#### Scenario: Candidate artifact cannot load or has the wrong Red identity

- **WHEN** isolated preflight finds an unconsumed diff suffix, syntax or import/load failure, no target test, or a Red failure identity other than the approved one
- **THEN** none of the candidate is applied to the main workspace, the parent reports a compact normalized artifact rejection, and only the finite artifact-correction path may continue

#### Scenario: Artifact correction budget is exhausted

- **WHEN** the approved finite correction budget ends without a candidate passing isolated preflight
- **THEN** the task and dependent successors block with a sanitized implementation-artifact recovery condition and no automatic transition returns the change to Design

#### Scenario: Worker diff exceeds its result boundary

- **WHEN** a Worker cannot return its complete unified diff within the configured result-size limit
- **THEN** implementation blocks the task and returns to Design to split it rather than accepting a truncated diff

#### Scenario: Affected-suite baseline is green

- **WHEN** every exact affected-suite command passes before task writes
- **THEN** implementation proceeds without dynamically adding a repair to the task

#### Scenario: Existing affected failure is present

- **WHEN** an exact affected-suite command exposes a reproducible pre-existing failure
- **THEN** the failure is recorded separately from task Red and enters the task only for verified root-cause analysis and minimum repair

#### Scenario: Later run reveals a previously masked failure

- **WHEN** a later affected-suite run reveals a failure that an earlier run did not report
- **THEN** implementation attributes it as pre-existing or introduced and stops if attribution cannot be established

#### Scenario: Affected failure is environmental

- **WHEN** an affected failure is environmental, transient, external-service dependent, non-reproducible, or cannot be attributed
- **THEN** implementation reports an executable recovery condition and blocks without speculative repair

#### Scenario: Affected repair requires a substantive decision

- **WHEN** an included repair requires new behavior, policy, dependency, architecture, irreversibility, or another substantive decision
- **THEN** implementation returns the expanded requirement to Design

#### Scenario: Full-suite-only baseline failure exists

- **WHEN** the full-suite baseline has a pre-existing failure outside every exact affected-suite command
- **THEN** that failure remains baseline evidence and does not automatically enter the task

#### Scenario: Task Red fails for the wrong reason

- **WHEN** the specified Red candidate cannot load, runs no target test, or fails for a reason other than its approved target identity while the approved behavior and verification contract remain sufficient
- **THEN** implementation rejects the artifact without applying it to the main workspace and does not return to Design automatically

#### Scenario: Task Red contract is invalid

- **WHEN** the specified Red command passes against a preflighted candidate or cannot witness the approved behavior without changing scope, behavior, architecture, dependency, write set, or verification contract
- **THEN** implementation stops and returns the substantive contract defect to Design rather than improvising another verification

#### Scenario: Implementation completes

- **WHEN** every target and affected verification passes and the full suite has no new failure relative to baseline
- **THEN** the workflow reports completion without automatically archiving or publishing
