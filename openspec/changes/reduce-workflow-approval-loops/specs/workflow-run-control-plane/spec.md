## ADDED Requirements

### Requirement: Batched amendments inside Implement

Implement SHALL expose every known task or change authority gap in one stable decision batch bound to the retained run and delivery revision. After the parent selects and records its recommended implementation choices under the accepted Design, a narrow amendment envelope SHALL permit only the same change's existing private artifact operations, without activating Design or exposing product writes. Stale batch identities and unrelated change runs SHALL fail before mutation. Resume SHALL discover and fully validate a newer local delivery without requiring the user to supply receipt identifiers.

#### Scenario: Concurrent gaps are collected together

- **WHEN** independent tasks report different missing authority
- **THEN** status exposes both gaps and their combined proof requirements in a stable batch

#### Scenario: Amendment continues without switching stages

- **WHEN** the parent submits a current batch-bound amendment for the retained change
- **THEN** inherited authority, artifact compilation, and finalization remain within Implement and a later receipt-less resume discovers the verified delivery

#### Scenario: Stale or unrelated amendment is submitted

- **WHEN** the batch no longer matches the current delivery or the requested revision belongs to another change
- **THEN** the controller rejects it before artifact mutation

### Requirement: Persistent recovery reservations

Recovery incidents SHALL be stored separately from display diagnostics and indexed by verification obligation and phase rather than route, task naming, or workspace revision lineage. Before execution the control plane SHALL reserve a finite run-wide work unit; nested candidate proposals SHALL reserve additional units through the same authority. Reopen and post-launch cancellation SHALL NOT refund consumed work. A changed repair limit SHALL NOT invalidate unchanged task evidence or implicitly replenish an exhausted incident.

#### Scenario: Internal rollback repeats the same failure

- **WHEN** a rejected correction creates a rollback revision and the unchanged operation is resumed repeatedly
- **THEN** the existing incident remains exhausted and no new candidate is requested

#### Scenario: Nested work consumes the retained budget

- **WHEN** nested proposals consume all work reservations and the engine is reopened
- **THEN** further execution remains blocked without new model work and status reports the consumed budget

#### Scenario: Recovery metadata changes

- **WHEN** a new valid delivery changes only repair limits
- **THEN** compatible verified task facts remain valid while future execution reads the current policy


### Requirement: Approval continuity across mechanical work

The control plane SHALL preserve unchanged authorization across identical plan compilation and reference-only decision updates. A new Design revision SHALL inherit authority only from the latest completed private finalization for the same root and change, without treating inherited evidence as current observation.

#### Scenario: Identical compilation preserves approval

- **WHEN** a new operation compiles identical plan bytes after unchanged substantive decisions
- **THEN** the plan revision, current Gate proofs, and existing receipt bytes remain unchanged

#### Scenario: Technical revision inherits behavior

- **WHEN** a completed change is revised only for technical authority
- **THEN** its unchanged Gate A remains current and the new delivery can finalize after Gate B without another behavior approval

#### Scenario: Reference repair preserves approval

- **WHEN** a decision keeps its normalized contract but updates artifact references
- **THEN** the journal retains the updated references without invalidating either Gate

### Requirement: Durable autonomous recovery

Implement SHALL automatically correct retryable artifacts, stale candidates, and verification failures within bounded task authority and pass structured recovery feedback to the next Worker. Exhaustion SHALL survive resume, restart, rollback, route replacement, task renaming, and contract rewording for the same verification obligation. Dedicated checked storage SHALL retain recovery facts independently of display diagnostics, and a pre-reserved run-wide work budget SHALL bound all launches, including nested repair.

#### Scenario: Stale candidate is refreshed automatically

- **WHEN** a candidate becomes stale and recovery capacity remains
- **THEN** the next attempt receives refresh feedback and continues without a user decision

#### Scenario: Exhausted recovery is not reset by resume

- **WHEN** an exhausted task resumes with unchanged recovery facts after process restart
- **THEN** no Worker is launched and status identifies the prerequisite for progress

#### Scenario: Route replacement preserves exhaustion

- **WHEN** an exhausted task is rebound to a different approved route binding
- **THEN** the same exhausted verification obligation retains its budget and no Worker is launched merely because the route changed

### Requirement: Parent-owned implementation continuation

Invoking Implement SHALL delegate remaining implementation choices to the parent model's recommended solution under the accepted Design goal, explicit constraints and non-goals. Status SHALL identify the parent as decision owner, expose an automatic amendment continuation for known authority gaps and the closed delivery-invalid/task-split technical pauses, and expose automatic receipt-less resume when a newer local proof-bound delivery is discovered. Neither Worker authority nor readiness checks SHALL be bypassed. Cancellation and unclassified integrity or external capability failures SHALL NOT manufacture a plan amendment. Each run SHALL retain a 64-attempt mutation budget for amendments across restart and batch changes; failed mutations SHALL consume reservations before side effects, committed replay and read-only status/preflight SHALL not consume them. TUI SHALL show automatic parent continuation as non-success recovery without a manual resume hint. The parent SHALL continue in the same turn and summarize material decisions in its final result.

#### Scenario: Implementation choice is delegated

- **WHEN** a known authority gap requires an implementation choice after Design
- **THEN** status assigns the recommended choice to the parent without requiring a user answer, and the same-stage amendment remains proof-bound

#### Scenario: Technical plan defect needs revision

- **WHEN** delivery admission fails or compact patch recovery requires smaller tasks
- **THEN** the parent can use a current batch-bound amendment without a fabricated authority gap and resume from the newer locally discovered delivery; a rejected revision/receipt pair SHALL remain excluded from automatic resume recommendations across restart

#### Scenario: Automatic amendment keeps failing

- **WHEN** failed amendment mutations exhaust the persistent budget and the process restarts
- **THEN** mutation is rejected before side effects and status offers no further automatic amendment while retaining progress

#### Scenario: Explicit cancellation interrupts continuation

- **WHEN** the user cancels a retained authority wait
- **THEN** automatic continuation is removed and the previous batch cannot authorize another mutation

#### Scenario: Parent recovery is presented to the user

- **WHEN** a nonterminal result supplies an automatic parent continuation
- **THEN** activity remains recovering rather than completed or waiting for a user decision, and no manual resume hint is displayed

## MODIFIED Requirements

### Requirement: Durable Design decisions and Gate proofs

The private control plane SHALL record ordered behavior and technical decisions for one Design run and SHALL derive Gate currentness from their durable order. Gate A approval SHALL become stale after a later behavior decision; Gate B approval SHALL become stale after any later substantive decision, Gate A reapproval, or changed plan recompilation. Identical compilation after unchanged substantive decisions SHALL preserve the plan revision and Gates; reference-only decision updates SHALL preserve authority. A new Design revision SHALL inherit unchanged decisions and Gates only from the latest completed owner-private finalization for the same root and change, revalidating current artifacts before delivery. The control plane SHALL normalize and hash transient decision and Gate-A contract text itself, persist only the resulting canonical hash, and bind Gate B only to a plan compiled after the current Gate A approval and latest substantive decisions without accepting a caller-supplied hash. Every Gate approval SHALL produce an owner-private record hash. Repeating one operation id SHALL replay its committed outcome.

#### Scenario: Behavior changes after Gate A

- **WHEN** a later behavior decision is recorded after Gate A approval
- **THEN** Gate A is no longer current until the changed behavior is approved, and Gate B is regenerated by compilation afterward

#### Scenario: Technical decision changes after Gate B

- **WHEN** a later technical decision or different compiled plan follows Gate B approval
- **THEN** Gate B becomes stale while an unchanged Gate A remains current

#### Scenario: Approval operation is replayed

- **WHEN** the same approval operation id is repeated
- **THEN** the control plane returns the original record rather than creating another approval revision
