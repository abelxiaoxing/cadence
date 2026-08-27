## REMOVED Requirements

### Requirement: Per-role endpoint configuration key surface

**Reason**: One global or role-specific endpoint cannot express an ordered, inspectable, capability-aware recovery policy.
**Migration**: Replaced by `Visible route-policy configuration`; v1 single-endpoint keys have no compatibility requirement.

### Requirement: Three-tier whole-layer resolution

**Reason**: Resolving one identity and pinning it for the task lifetime prevents health-aware selection and explicit Worker replacement.
**Migration**: Replaced by `Capability and health aware route selection` and `Explicit run route rebinding`.

### Requirement: Fail-closed configuration errors

**Reason**: Treating an endpoint configuration issue as an immediate unrecoverable dispatch failure strands durable work.
**Migration**: Replaced by `Route-policy validation and recoverable unavailability`.

### Requirement: Custom endpoint request behavior

**Reason**: A single total phase timeout and one fixed custom identity do not provide bounded connect, first-response, idle, or failover behavior.
**Migration**: Replaced by `Bounded route-attempt behavior` while preserving credential privacy and dialect-correct request construction.

## ADDED Requirements

### Requirement: Visible route-policy configuration

Cadence SHALL resolve one complete route-policy source for a project, with project-local policy taking precedence over user policy as a whole and no secret or partial-value merging across sources.
The policy SHALL define an ordered set of allowed routes for each closed package-owned role and MAY include inherited-parent identity as an explicit route.
Each route SHALL declare enough non-secret capability metadata to determine supported dialect, context and output bounds, and eligibility for its role.
Users SHALL be able to inspect the selected policy source, route names, route kinds, capabilities, health state, and ordering without exposing URL values, API keys, credentials, or raw environment values.
The v2 policy format SHALL replace the v1 single-endpoint key contract without implicit migration or dual-stack resolution.

#### Scenario: Project policy exists

- **WHEN** both project and user route policies exist
- **THEN** only the complete project policy participates and no missing project value is filled from user policy

#### Scenario: Parent identity is allowed

- **WHEN** a role's ordered policy explicitly includes inherited-parent identity
- **THEN** that route is eligible according to its declared order and capability checks

#### Scenario: Effective policy is inspected

- **WHEN** local status presents endpoint routing
- **THEN** it reports the policy source and non-secret route metadata without URL, key, credential, or environment values

#### Scenario: V1 keys are present

- **WHEN** only the obsolete v1 single-endpoint configuration is supplied
- **THEN** v2 reports an unsupported configuration version and does not silently translate it

### Requirement: Capability and health aware route selection

Before a Worker attempt, the route broker SHALL filter the role's allowed ordered routes by configuration validity, required dialect and context capability, current policy health, and any approved run constraint.
It SHALL select only from routes explicitly present in the effective policy and SHALL NOT silently fall back to an undeclared endpoint, model, Provider, or parent identity.
Health and circuit state SHALL affect new attempts but SHALL NOT alter an already committed candidate or verification fact.
If no route is currently eligible, the owning packet or task SHALL pause as endpoint-unavailable while the run and committed independent work remain resumable.
Route health SHALL be observable through safe typed status without revealing endpoint or credential data.

#### Scenario: First route is unhealthy

- **WHEN** the first allowed route is in an open health state and a later allowed route satisfies the task capability
- **THEN** the broker selects the later route and records the non-secret selection fact

#### Scenario: No route is eligible

- **WHEN** every allowed route is invalid, unhealthy, incapable, or unavailable
- **THEN** the affected work pauses as endpoint-unavailable and no undeclared fallback is attempted

#### Scenario: Route recovers

- **WHEN** an allowed route later passes its required health and capability checks
- **THEN** a paused compatible operation may resume without repeating committed Gate or task facts

#### Scenario: Health changes after candidate acceptance

- **WHEN** a route becomes unhealthy after its candidate was sealed and accepted
- **THEN** the accepted artifact and control-plane verification facts remain valid independently of route health

### Requirement: Route-policy validation and recoverable unavailability

The broker SHALL validate the entire selected policy and each referenced route before network transmission.
An invalid URL, unsupported dialect, missing required identity field, invalid bound, duplicate route identity, inconsistent role reference, or unreadable policy SHALL produce a deterministic typed policy diagnostic without exposing configured values.
A policy diagnostic SHALL prevent a new Worker request under the invalid route but SHALL NOT corrupt or terminally block an existing durable run.
The run SHALL retain local status, permit corrected-policy resume, and require explicit rebinding when the corrected effective route set changes a paused task's selected identity outside already approved automatic policy.

#### Scenario: Route is partially configured

- **WHEN** an allowed route omits a field required for its route kind
- **THEN** no request is sent through it and status reports only the offending field name and typed policy code

#### Scenario: Policy is corrected

- **WHEN** the user corrects an invalid effective policy for a paused run
- **THEN** local validation succeeds and the run can resume or explicitly rebind without losing committed workflow facts

#### Scenario: Existing run is inspected under invalid policy

- **WHEN** current policy is invalid while a run is paused
- **THEN** `status` remains available and reports the run independently of endpoint parsing or network access

### Requirement: Bounded route-attempt behavior

Every route attempt SHALL have separately observable finite bounds for connection, first response, idle progress, and total phase duration, all cancellable through the owning operation signal.
A request SHALL use the selected route's configured model, credentials, dialect, context, and output capabilities.
Inherited-parent routes SHALL preserve the effective parent authentication and payload-composition contract; custom routes SHALL bypass parent payload transformation and use only their own configured request contract.
Provider-managed hidden retry SHALL remain disabled; route failover and retry SHALL be controlled and recorded by the route broker.
Timeout or transport failure SHALL update route health and the owning transport policy only and SHALL NOT consume stale, artifact, verification, or checkpoint policy.
Partial model output SHALL remain unusable unless it formed a valid sealed artifact under the delivery contract.

#### Scenario: Connection bound expires

- **WHEN** a selected route does not establish its request within the connection bound
- **THEN** the attempt is cancelled, transport evidence is recorded, and broker policy selects another allowed route or pauses the work

#### Scenario: First response never arrives

- **WHEN** connection succeeds but no first response arrives within its bound
- **THEN** the attempt ends as first-response-timeout without waiting for the total phase bound

#### Scenario: Stream becomes idle

- **WHEN** a response begins and then makes no accepted progress for the idle bound
- **THEN** the attempt ends as idle-timeout and no partial unsealed output is accepted

#### Scenario: Custom route sends a request

- **WHEN** a valid custom route is selected
- **THEN** the request uses only that route's dialect, model, optional credential, and bounds and does not invoke the parent payload callback

#### Scenario: Inherited route sends a request

- **WHEN** an inherited-parent route is selected
- **THEN** the request uses fresh parent authentication and effective parent payload composition for that attempt

### Requirement: Explicit run route rebinding

A durable task ledger SHALL NOT treat Provider or model identity as part of the immutable approved task boundary.
The route selected for one Worker attempt SHALL remain bound to that attempt and its sealed artifact provenance, while a later attempt MAY select another compatible allowed route.
Automatic route changes SHALL occur only within the effective ordered policy approved for the run.
A route or model change outside that automatic set SHALL require the versioned control surface's typed `rebind` command, identifying the stable run, paused task or evidence packet, and a named route from the corrected effective policy without accepting a caller-supplied URL, credential, task boundary, or delivery revision.
The command SHALL display non-secret old and new route identities, validate required capability, cancel the active attempt if any, and preserve the approved task contract and committed ledger.
Rebinding SHALL NOT validate prior Worker claims, expand paths, alter Gate authority, or bypass candidate preflight.

#### Scenario: Automatic allowed failover occurs

- **WHEN** an attempt fails and another compatible route is already in the run's allowed ordered policy
- **THEN** the next attempt may use that route without a Provider identity protocol error

#### Scenario: User explicitly rebinds

- **WHEN** a paused task is rebound to a compatible route outside its prior automatic selection set but inside the corrected effective policy
- **THEN** the control plane records the rebind and the replacement Worker resumes from the same approved ledger and boundary

#### Scenario: Rebind route lacks capability

- **WHEN** the requested replacement cannot satisfy the task's dialect, context, output, or role capability
- **THEN** rebinding is rejected before a child request and the prior paused state remains intact

#### Scenario: Rebind attempts to widen authority

- **WHEN** a rebind request also changes a task path, dependency, verification, behavior, or Gate contract
- **THEN** the control plane rejects it as an approval-boundary violation
