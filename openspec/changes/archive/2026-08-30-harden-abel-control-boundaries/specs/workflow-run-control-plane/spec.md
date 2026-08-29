## ADDED Requirements

### Requirement: Serialized Design delivery commitment

The control plane SHALL admit at most one active delivery-finalization operation for a Design run. The ownership fact SHALL be durable, recoverable after interruption, and checked before repository receipt mutation. A competing operation SHALL fail without writing or removing delivery artifacts. Cleanup after an uncommitted failure SHALL remove only bytes owned by that operation, while replay after a committed finalization SHALL converge the Design run to completed without replacing the committed receipt.

#### Scenario: Two finalizations overlap

- **WHEN** one Design finalization holds the run's delivery-commitment ownership and another operation attempts to finalize the same run
- **THEN** the competing operation returns a typed busy outcome before receipt mutation and the owner's valid receipt remains installed

#### Scenario: Finalization owner is interrupted

- **WHEN** a finalization stops before commitment and its durable ownership expires
- **THEN** a later operation may acquire ownership, revalidate the delivery from the beginning, and commit exactly one next revision

#### Scenario: Run completion fails after journal commitment

- **WHEN** receipt bytes and the private finalization fact commit but the run completion transition fails
- **THEN** the receipt remains installed and replay of the same operation completes the run before returning the committed outcome

### Requirement: Executable approval command boundary

An approval-needed Implement status SHALL derive its authority category and exact Gate set from one closed typed code table. Unknown approval codes SHALL fail closed as control-plane integrity errors. Status and execution SHALL agree: until a newer verified delivery is available, only status and discard are immediately legal; receipt-less resume and rebind SHALL NOT mutate the run or route binding.

#### Scenario: Rebind is attempted during approval-needed

- **WHEN** a caller sends rebind while the run still lacks approved authority
- **THEN** the command is rejected and the task and run route bindings remain unchanged

#### Scenario: Resume omits a newer receipt

- **WHEN** a caller sends resume during approval-needed without an exact verified newer delivery revision and receipt hash
- **THEN** the command is rejected without consuming progress or changing the retained delivery binding

#### Scenario: Runtime detects an empty write contract

- **WHEN** an admitted task phase unexpectedly has no approved write or delete path
- **THEN** approval status classifies the gap as a Gate-B path-boundary requirement rather than reopening observable behavior through a default fallback

#### Scenario: Approval code is unknown

- **WHEN** any Worker, verifier, or internal path attempts to create approval-needed with a code outside the closed authority table
- **THEN** the control plane pauses as an integrity failure and does not invent a category or Gate requirement

### Requirement: Locally discoverable newer delivery

For an approval-needed Implement run, local status SHALL inspect the current repository receipt without a Worker or network request and expose an exact available delivery only when it is newer than the retained revision, matches the change, and both Gate proofs resolve to current owner-private Design facts. Discovery SHALL NOT admit the delivery or mutate the run. A later resume using the exposed revision and hash SHALL perform full delivery validation before preserving or invalidating retained work.

#### Scenario: New Design receipt is available in a fresh context

- **WHEN** Design has finalized a newer proof-bound receipt and a fresh explicit Implement context requests status for the retained approval-needed run
- **THEN** status exposes the exact newer delivery revision and receipt hash and presents resume as immediately executable with those arguments

#### Scenario: Repository receipt is forged or stale

- **WHEN** the repository receipt is not newer, has a mismatched hash/change, or either Gate proof is absent or not current in the private journal
- **THEN** status exposes no available delivery and leaves resume conditional

#### Scenario: Discovered delivery fails full admission

- **WHEN** a caller resumes with a locally discovered pair but full artifact, traceability, capability, or currentness validation fails
- **THEN** the run remains nonterminal with aggregated delivery diagnostics and does not start a Worker
