# subagent-endpoint-config Specification

## Purpose
Defines the per-role custom endpoint configuration contract for Cadence Subagents: the configuration key surface, three-tier whole-layer resolution, fail-closed configuration errors, request behavior under a custom endpoint identity, and endpoint key privacy.
## Requirements
### Requirement: Endpoint key privacy

Configured endpoint key values SHALL never appear in dispatch results, Subagent activity display, error messages, or logs.
Configuration error text SHALL identify offending configuration key names only.

#### Scenario: Error names keys not values

- **WHEN** a configuration error is reported
- **THEN** the error text names the offending key names and contains no configured key or URL secret values

#### Scenario: Key absent from observable output

- **WHEN** a dispatch runs under a committed configuration that includes an API key
- **THEN** the key value appears in no dispatch result, activity display, error message, or log

### Requirement: Visible route-policy configuration

Cadence SHALL resolve one complete route-policy source for a project, with project-local policy taking precedence over user policy as a whole and no secret or partial-value merging across sources.
When neither source exists, Cadence SHALL synthesize a complete default policy that routes every package-owned role through the current inherited parent identity so a fresh installation can dispatch immediately.
An explicit project or user file SHALL replace that default as a whole; an invalid explicit file SHALL fail closed and SHALL NOT silently fall back to the parent.
The policy SHALL define an ordered set of allowed routes for each closed package-owned role and MAY include inherited-parent identity as an explicit route.
Each route SHALL declare enough non-secret capability metadata to determine supported dialect, context and output bounds, and eligibility for its role.
Users SHALL be able to inspect the selected policy source, route names, route kinds, capabilities, health state, and ordering without exposing URL values, API keys, credentials, or raw environment values.
The canonical policy format SHALL be the only accepted route configuration; obsolete single-endpoint keys SHALL NOT be translated or resolved in parallel.

#### Scenario: Project policy exists

- **WHEN** both project and user route policies exist
- **THEN** only the complete project policy participates and no missing project value is filled from user policy

#### Scenario: No policy file exists

- **WHEN** neither project nor user route policy is configured
- **THEN** every package-owned role uses the synthesized inherited-parent route without reporting endpoint-unavailable solely because configuration is absent

#### Scenario: Parent identity is allowed

- **WHEN** the synthesized default or an explicit role policy includes inherited-parent identity
- **THEN** that route is eligible according to its declared order and capability checks

#### Scenario: Effective policy is inspected

- **WHEN** local status presents endpoint routing
- **THEN** it reports the policy source and non-secret route metadata without URL, key, credential, or environment values

#### Scenario: Obsolete endpoint keys are present

- **WHEN** only obsolete single-endpoint configuration keys are supplied
- **THEN** Cadence reports an invalid configuration and does not silently translate it

### Requirement: Capability and health aware route selection

Before a Worker attempt, the route broker SHALL filter the role's allowed ordered routes by configuration validity, required dialect and context capability, current policy health, and any approved run constraint.
It SHALL select only from routes explicitly present in the effective policy and SHALL NOT silently fall back to an undeclared endpoint, model, Provider, or parent identity.
Health and circuit state SHALL affect new attempts but SHALL NOT alter an already committed candidate or verification fact.
If no route is currently eligible, the owning packet or task SHALL pause as endpoint-unavailable while the run and committed independent work remain resumable.
Restoring a persisted binding or explicitly rebinding a capable but cooling route SHALL report temporary endpoint-unavailable rather than capability insufficiency, without clearing its health history.
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
A present but invalid explicit policy SHALL remain the selected failing source until corrected and SHALL NOT be treated as if no file existed.
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

Each model request SHALL have finite first-progress and stream-idle bounds owned by the child model adapter, cancellable through the owning operation signal.
The broker SHALL retain a finite per-attempt total bound, covering preparation and all request/tool turns, and SHALL remain the sole retry owner.
HTTP headers SHALL be observation only, not evidence of TCP/TLS connection or accepted model progress.
Only nonempty text, thinking or tool-call deltas SHALL refresh idle timing; a complete terminal response SHALL settle without requiring a delta.
Local tool gaps SHALL have no model stream timer; every subsequent request SHALL start a new first-progress budget.
Historical timeout facts SHALL remain readable without reinterpretation.
A request SHALL use the selected route's configured model, credentials, dialect, context, and output capabilities.
Inherited-parent routes SHALL snapshot the effective Provider, selected model and freshly resolved authentication for each attempt, without parent registry mutation or implicit host-session payload callback inheritance; custom routes SHALL use only their own configured request contract.
Provider-owned stream behavior SHALL remain effective, but no route SHALL require a prior parent request to capture a callback.
Provider-managed hidden retry SHALL remain disabled; route failover and retry SHALL be controlled and recorded by the route broker.
Timeout or transport failure SHALL update route health and the owning transport policy only and SHALL NOT consume stale, artifact, verification, or checkpoint policy.
Partial model output SHALL remain unusable unless it formed a valid sealed artifact under the delivery contract.

#### Scenario: Headers arrive after eleven seconds

- **WHEN** a local server receives a request promptly but delays headers for eleven seconds and then supplies a normal terminal response within the first-progress budget
- **THEN** the request succeeds without a connection timeout or retry

#### Scenario: First response never arrives

- **WHEN** a request supplies no accepted progress within its first-progress bound, whether or not headers arrived
- **THEN** the attempt ends as first-progress-timeout without waiting for the per-attempt total bound

#### Scenario: Stream becomes idle

- **WHEN** a response begins and then makes no accepted progress for the idle bound
- **THEN** the attempt ends as stream-idle-timeout and no partial unsealed output is accepted

#### Scenario: Custom route sends a request

- **WHEN** a valid custom route is selected
- **THEN** the request uses only that route's dialect, model, optional credential, and bounds and does not invoke the parent payload callback

#### Scenario: Inherited route sends a request

- **WHEN** an inherited-parent route is selected
- **THEN** the request uses fresh parent authentication and the admitted effective Provider/model snapshot for that attempt without invoking host-session payload callbacks

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
