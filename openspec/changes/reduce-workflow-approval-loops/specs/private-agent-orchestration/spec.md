
## MODIFIED Requirements

### Requirement: Recoverable attempts and Worker replacement

Provider-managed hidden retry SHALL remain disabled, while the control plane SHALL apply separately observable bounded policies for connection, first response, idle progress, total phase time, transport attempts, stale refresh, artifact correction, verification repair, and parent checkpoint correction.
The canonical Implement plan SHALL seal `artifactCorrection.maxAttempts` as 2 or 3 automatic recovery attempts per verification obligation and phase, including the initial attempt. Typed artifact, stale-candidate, and verification rejection SHALL consume this shared durable counter; another operation id SHALL NOT reset exhaustion. The next Worker SHALL receive structured recovery feedback. Operation ids, route replacement, rollback lineage, task renaming, and contract rewording SHALL NOT replenish an exhausted verification obligation. Dedicated private recovery facts and a run-wide pre-reserved work budget SHALL bound retries across process restart. Workers MAY read their task phase paths and request ordinary regular files inside sealed task roots; dynamically granted reads SHALL remain bound to merge, retained evidence, and final currentness. Phase write/delete authority remains unchanged.
Each failure SHALL retain its safe closed code, stage, policy class, attempt count, and legal continuation without exposing endpoint secrets, prompts, code excerpts, or raw model output in public outcomes.
Automatic policy exhaustion SHALL pause the affected task rather than terminally block it. The parent MAY explicitly grant one additional attempt against a current incident and failure sequence while retaining all consumed work. Environment, report protocol and resource failures SHALL remain unavailable verification and SHALL NOT become product failure baselines.
Cancellation SHALL interrupt the active operation without consuming an automatic retry or accepting partial output.
An environment or endpoint failure SHALL permit resume after capability recovery.
An approved route-policy change or explicit rebind SHALL permit a replacement Worker to continue from the structured task ledger without changing the approved task contract.
An approval-boundary gap SHALL become approval-needed and SHALL never authorize spontaneous scope expansion.

#### Scenario: Connection deadline expires

- **WHEN** a configured route does not connect within its bounded connection policy
- **THEN** the control plane records a transport attempt, selects another already allowed route when policy permits, or pauses with an explicit continuation

#### Scenario: Automatic attempts are exhausted

- **WHEN** one policy class reaches its automatic attempt bound
- **THEN** the task pauses with final evidence; shared artifact/stale/verification exhaustion survives restart and unchanged resume, while transport and parent-checkpoint policies remain separate

#### Scenario: Replacement Worker resumes

- **WHEN** the user or approved route policy rebinds a paused task to a compatible Worker
- **THEN** the next attempt receives the same approved boundary and committed ledger and the former Provider identity is not treated as a protocol mismatch

#### Scenario: Result capacity is insufficient

- **WHEN** a complete candidate cannot fit one configured result envelope
- **THEN** the trusted submit tool may internally chunk and seal one complete artifact or the task pauses for approved reshaping, and no truncated artifact is accepted

#### Scenario: Estimated capacity exceeds an available route

- **WHEN** an authorized healthy route meets the 16,000 context and 8,000 output hard minima but falls below the task's heuristic estimate
- **THEN** it remains eligible as a fallback or explicit rebind; automatic selection prefers routes meeting the estimate, preserving declared order within each preference tier and all health and retry bounds


## ADDED Requirements

### Requirement: Bound context discovery

A Worker MAY request additional ordinary regular-file reads within sealed task roots. The parent SHALL persist exact admitted paths, exclude hidden and private-key files from this automatic expansion, supply them to subsequent attempts, and bind them to candidate merge, retained evidence checks, and final application currentness. This permission SHALL NOT expand write or delete authority.

#### Scenario: A supporting file was omitted from the task

- **WHEN** a Worker requests an ordinary supporting read inside the sealed root
- **THEN** the next attempt receives its exact read capability without a new user decision

#### Scenario: Discovered context changes in the main workspace

- **WHEN** the user changes a dynamically admitted supporting file before final application
- **THEN** currentness validation pauses application and preserves the user's changes


### Requirement: Isolated verification runtime

The verifier SHALL provide private HOME and tool caches while protecting consumer dependencies. Vitest SHALL use a fresh bounded report file independently of bounded diagnostic logs. Environment, resource and report protocol failures SHALL NOT count as product failures. Approved package scripts SHALL execute intact through the package manager with their manifest, lockfile and configuration inputs bound to currentness.

#### Scenario: A normal package manager project runs tests

- **WHEN** an npm project uses a normal Vitest configuration and emits configuration logs
- **THEN** verification runs with private HOME and writable Vite caches, validates its independent report, and leaves consumer dependencies unchanged

#### Scenario: Logs and reports exceed the old output threshold

- **WHEN** tests emit more than the log capture budget or a valid report larger than 1 MiB
- **THEN** logs are truncated without stopping execution and the report is evaluated under its separate bounded limit

#### Scenario: Verification cannot produce valid evidence

- **WHEN** a report is missing, unsafe, malformed, contradictory or oversized
- **THEN** verification pauses as unavailable without recording a product failure or launching speculative product repair

#### Scenario: Approved scripts contain shell composition

- **WHEN** a bound package script uses quotes, variables, hooks or chained commands
- **THEN** the package manager executes the original script inside isolation and later input drift invalidates the capability

#### Scenario: A candidate changes an authorized configuration file

- **WHEN** a candidate changes a manifest or configuration path already writable by the admitted plan
- **THEN** isolated verification permits that planned change while checking the exact approved entry command and currentness of the actual invocation; admission and undeclared paths retain their bound hashes

#### Scenario: Configuration contains harmless documentation

- **WHEN** a package manager configuration contains comments or ordinary values mentioning tokens or shell settings
- **THEN** those words do not block verification; effective unsupported credential and host-execution directives remain rejected

#### Scenario: A Red witness falls outside retained diagnostic logs

- **WHEN** a non-Vitest verifier emits its expected Red witness between large log segments or across output chunks
- **THEN** bounded stream matching preserves the witness independently of displayed logs without synthesizing a witness by concatenating the retained head and tail

#### Scenario: Failure sets exceed presentation limits

- **WHEN** baseline and current verification contain more than 256 failure identities, including enough to exceed ledger projection limits
- **THEN** complete baseline evidence is retained as an integrity-checked private artifact across restart, attribution compares complete sets, and only introduced-failure feedback and public summaries are bounded to 256 identities

#### Scenario: Equivalent verification contracts have different display identities

- **WHEN** baseline and current non-Vitest contracts execute the same command and arguments under different display identifiers
- **THEN** unchanged failure evidence has the same identity; distinct runners, commands or arguments remain distinct, and evidence under an older runtime policy is revalidated before reuse
