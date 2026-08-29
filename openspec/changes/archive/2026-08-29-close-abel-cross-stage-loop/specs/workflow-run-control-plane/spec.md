## ADDED Requirements

### Requirement: Durable Design decisions and Gate proofs

The private control plane SHALL record versioned behavior and technical decisions for one Design run and SHALL derive Gate currentness from their durable order. Gate A approval SHALL become stale after a later behavior decision; Gate B approval SHALL become stale after any later substantive decision or plan recompilation. Every Gate approval SHALL bind a canonical contract hash and produce an owner-private record hash. Repeating one operation id SHALL replay its committed outcome.

#### Scenario: Behavior changes after Gate A

- **WHEN** a later behavior decision is recorded after Gate A approval
- **THEN** Gate A and Gate B are no longer current until explicitly approved again

#### Scenario: Technical decision changes after Gate B

- **WHEN** a later technical decision or different compiled plan follows Gate B approval
- **THEN** Gate B becomes stale while an unchanged Gate A remains current

#### Scenario: Approval operation is replayed

- **WHEN** the same approval operation id is repeated
- **THEN** the control plane returns the original record rather than creating another approval revision

### Requirement: Code-owned Design delivery compilation

After current Gate A approval, the Design control plane SHALL read one fixed safe plan-draft path, compile and validate the canonical implementation plan, and write the canonical plan artifact without asking the parent to construct hashes or receipts. Gate B approval SHALL bind that exact canonical plan hash. Finalization SHALL require current Gate A and Gate B proofs, strict and complete OpenSpec artifacts, exact traceability, and executable verification closure before code-owned generation of Gate A and ready receipts. Failure SHALL write no partial ready delivery.

#### Scenario: Plan is compiled before Gate B

- **WHEN** a Gate-A-approved Design run submits a valid plan draft
- **THEN** the control plane produces a canonical plan identity for Gate B review and records it durably

#### Scenario: Parent hand-assembles a ready receipt

- **WHEN** a receipt lacks current private Gate proofs or does not bind the stored canonical plan
- **THEN** Implement rejects it before Worker launch even if repository hashes are internally consistent

#### Scenario: Delivery finalization succeeds

- **WHEN** both Gate proofs are current and all artifact, traceability, OpenSpec, and verification checks pass
- **THEN** the control plane writes one complete canonical delivery, marks Design completed, and returns its delivery revision and receipt hash

#### Scenario: Finalization fails

- **WHEN** any required proof, artifact, traceability link, strict validation, or executable capability is invalid
- **THEN** Design remains nonterminal and no new ready receipt is installed

### Requirement: Actionable approval-needed continuation

An approval-needed Implement outcome SHALL include one closed missing-authority category, the required Gate set, the retained run id and delivery revision, and a receipt precondition. Safe missing path or dependency references SHALL be included when available. Status SHALL distinguish an immediately executable command from a command whose receipt precondition is not yet satisfied; resume without a newer receipt SHALL not be presented as progress.

#### Scenario: Approval-needed status is inspected

- **WHEN** an Implement run is waiting for expanded authority
- **THEN** status identifies the required Design revision and exposes resume only with its newer-receipt precondition

#### Scenario: Resume omits the required receipt

- **WHEN** the caller resumes approval-needed without a newer revision and matching receipt hash
- **THEN** the run remains unchanged and the result repeats the unmet receipt precondition explicitly

### Requirement: Both Gate proofs bind Implement admission

Implement admission SHALL validate both Gate A and Gate B receipt proofs against owner-private Design journal records for the same canonical root and change. The durable Implement run SHALL bind both proofs for each accepted delivery revision. A repository-only forged approval, stale Gate proof, mismatched plan hash, or proof from another change SHALL fail before Worker execution.

#### Scenario: Repository receipts are forged

- **WHEN** canonical receipt files claim approval but no matching private Design approval facts exist
- **THEN** Implement returns delivery-invalid before creating a private implementation workspace or launching a Worker

#### Scenario: Both current proofs are accepted

- **WHEN** the ready receipt matches current private Gate A and Gate B facts and the exact compiled plan
- **THEN** Implement records both delivery bindings and may begin execution

