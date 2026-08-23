## Purpose

Defines the per-role custom endpoint configuration contract for Cadence Subagents: the configuration key surface, three-tier whole-layer resolution, fail-closed configuration errors, request behavior under a custom endpoint identity, and endpoint key privacy.

## ADDED Requirements

### Requirement: Per-role endpoint configuration key surface

The system SHALL read Subagent endpoint configuration from the cadence env file: the project file `<project>/.pi/cadence/.env` wins over the user file `~/.pi/agent/cadence/.env` as a whole file, with no merging and no interpolation.
The global layer SHALL consist of the keys `SUBAGENT_API_URL`, `SUBAGENT_API_KEY`, `SUBAGENT_MODEL`, `SUBAGENT_API`, `SUBAGENT_CONTEXT_WINDOW`, and `SUBAGENT_MAX_TOKENS`.
Each of the four closed roles SHALL have a same-shaped role layer whose key prefix is `SUBAGENT_` followed by the role name with hyphens converted to underscores: `SUBAGENT_DESIGN_EXPLORER_*`, `SUBAGENT_CONTRACT_REVIEWER_*`, `SUBAGENT_IMPLEMENTATION_WORKER_*`, and `SUBAGENT_DIAGNOSIS_WORKER_*`.
A key whose value is empty SHALL be treated as absent.

#### Scenario: Project file wins as a whole

- **WHEN** both the project cadence env file and the user cadence env file exist
- **THEN** only values from the project file are considered and no user-file value is merged or substituted

#### Scenario: Empty value is absent

- **WHEN** a layer key exists with an empty value
- **THEN** it is treated as absent and does not commit its layer

#### Scenario: Role key mapping

- **WHEN** `SUBAGENT_IMPLEMENTATION_WORKER_MODEL` and `SUBAGENT_IMPLEMENTATION_WORKER_API_URL` are set
- **THEN** those values apply to the `implementation-worker` role and to no other role

### Requirement: Three-tier whole-layer resolution

The system SHALL resolve each dispatch's endpoint identity in exactly three tiers: the dispatching role's layer commits when any of its six keys is non-empty; otherwise the global layer commits when any of its six keys is non-empty; otherwise the dispatch inherits the parent identity unchanged, with fresh phase-local parent authentication and capture-required parent payload composition.
A committed layer SHALL be evaluated as a whole; missing values are never merged or substituted from another layer.
A committed layer without `CONTEXT_WINDOW` or `MAX_TOKENS` SHALL use the internal defaults of 256000 context window and 128000 max output tokens, and the resulting custom model identity SHALL declare reasoning support; these defaults are not layer values and do not merge layers.
For an Implement task, the resolved identity SHALL be pinned at task admission and remain fixed across every phase launch for that task; later configuration edits do not change an admitted task's identity.
One-shot evidence requests SHALL resolve their identity at dispatch.

#### Scenario: Role layer commits

- **WHEN** the role layer has a complete committed configuration
- **THEN** that role's Subagent dispatch uses the role layer values and ignores the global layer

#### Scenario: Global layer commits when role absent

- **WHEN** no key of the role layer is non-empty and the global layer is committed
- **THEN** the dispatch uses the global layer values

#### Scenario: No committed layer inherits parent identity

- **WHEN** neither layer has any non-empty key
- **THEN** the dispatch inherits the parent model with fresh phase-local parent authentication and capture-required parent payload composition, exactly as before configuration existed

#### Scenario: Committed layer does not merge missing values

- **WHEN** the role layer sets model and URL but not dialect while the global layer sets a dialect
- **THEN** the dispatch uses the default dialect and ignores the global dialect value

#### Scenario: Absent bounds use internal defaults

- **WHEN** a committed layer omits both bounds keys
- **THEN** the resolved identity uses context window 256000 and max output tokens 128000 with reasoning support declared, without reading any value from another layer

#### Scenario: Admitted task identity is stable

- **WHEN** an Implement task is admitted with a resolved identity and the configuration file changes before a later phase launch
- **THEN** every phase launch for that task continues to use the identity pinned at admission

### Requirement: Fail-closed configuration errors

When a committed layer lacks `MODEL` or `API_URL`, when `API_URL` is not a parseable http or https URL, when `API` holds a value other than `openai-completions`, `openai-responses`, or `anthropic-messages`, or when `CONTEXT_WINDOW` or `MAX_TOKENS` is present but not a positive safely representable integer, the dispatch SHALL fail immediately with a typed configuration error before any child launch.
A configuration error SHALL NOT be retried and SHALL NOT consume a transport-shared child launch.
The failure SHALL be deterministic for identical configuration state.

#### Scenario: Partial layer fails dispatch

- **WHEN** a committed layer contains a model but no URL
- **THEN** the dispatch fails immediately with a typed configuration error and no child session is launched

#### Scenario: Configuration error is not retried

- **WHEN** a dispatch fails with a configuration error
- **THEN** the runtime performs no retry and consumes no transport-shared child launch

#### Scenario: Invalid URL fails closed

- **WHEN** a committed layer's `API_URL` is not a parseable http or https URL
- **THEN** the dispatch fails immediately with a typed configuration error

#### Scenario: Unknown dialect fails closed

- **WHEN** a committed layer's `API` value is not one of the three supported dialects
- **THEN** the dispatch fails immediately with a typed configuration error

#### Scenario: Invalid bounds fail closed

- **WHEN** a committed layer's `CONTEXT_WINDOW` or `MAX_TOKENS` is zero, negative, non-integer, infinite after parsing, or larger than the largest safely representable integer
- **THEN** the dispatch fails immediately with a typed configuration error

### Requirement: Endpoint key privacy

Configured endpoint key values SHALL never appear in dispatch results, Subagent activity display, error messages, or logs.
Configuration error text SHALL identify offending configuration key names only.

#### Scenario: Error names keys not values

- **WHEN** a configuration error is reported
- **THEN** the error text names the offending key names and contains no configured key or URL secret values

#### Scenario: Key absent from observable output

- **WHEN** a dispatch runs under a committed configuration that includes an API key
- **THEN** the key value appears in no dispatch result, activity display, error message, or log

### Requirement: Custom endpoint request behavior

When a dispatch resolves a custom endpoint identity, the child request SHALL be sent to the configured URL with the configured model, credentials, and dialect, and SHALL bypass the parent payload-transform chain; parent payload bridge availability SHALL NOT affect such a dispatch.
When the committed layer has no API key, the request SHALL be sent without an API-key credential.
When the committed layer has no dialect, `openai-completions` SHALL be used.
The child model identity SHALL use the configured context window and max output tokens, or the internal defaults when those keys are absent.
Provider retry SHALL remain disabled and phase timeout, cancellation, and complete-result bounds SHALL remain unchanged for custom endpoint dispatches.

#### Scenario: Request reaches configured endpoint

- **WHEN** a role with a complete committed configuration dispatches
- **THEN** the child request is sent to the configured URL with the configured model and credentials

#### Scenario: Payload bridge is bypassed

- **WHEN** a dispatch runs under a custom endpoint identity
- **THEN** the parent payload callback is never invoked and parent payload bridge unavailability does not fail the dispatch

#### Scenario: Optional API key endpoint

- **WHEN** a committed layer has model and URL but no API key
- **THEN** the child request is sent to the configured URL without an API-key credential

#### Scenario: Default dialect

- **WHEN** a committed layer has no dialect value
- **THEN** the child request uses `openai-completions`

#### Scenario: Configured bounds shape the child model

- **WHEN** a committed layer sets `CONTEXT_WINDOW` and `MAX_TOKENS`
- **THEN** the child model identity uses those configured bounds
