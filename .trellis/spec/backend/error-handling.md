# Error Handling

> How the Cadence backend fails: fail-closed admission, bounded code vocabularies, code-owned correction hints, and no silent fallback.

---

## Overview

The package never converts a structural failure into a softer outcome.
Admission points (stage startup, plan compilation, store open, execution-profile selection, route health) either admit a fully validated object or raise a typed failure with a bounded code.
Human-facing text is generated from those codes by code-owned projection functions, so the same failure renders identically in tool results and in the TUI.
Free-form error strings are never used as identities, authority, or storage keys.

---

## Stage Startup Validation

`src/index.ts` admits a stage only for an idle raw slash invocation with package provenance, and every rejection path has a bounded code and an operator-facing text:

| Code                            | Trigger                                                                                | Behavior                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `abel-stage-requires-idle`      | the invocation arrives with streaming behavior                                         | startup rejected; the message tells the operator to resubmit the original slash command through `session.prompt` while the session is idle                                                               |
| `abel-stage-provenance-invalid` | the prompt name matches but `hasPackageProvenance` fails                               | startup rejected; no stage authority granted                                                                                                                                                             |
| `abel-stage-unverified-input`   | an expanded stage prompt reaches the agent without passing `isVerifiedStageInvocation` | the message is neutralized without granting authority: "No new stage authority was granted by this rejected request."                                                                                    |
| `abel-stage-tools-unavailable`  | the dispatch tool cannot be registered for a verified start                            | the failed startup is rolled back: `pi.setActiveTools(toolsBefore)` and `activation.drain()` restore the prior tool set, and "no partially applied Design restrictions or a falsely active stage" remain |

`startupErrorText(code)` renders each rejection as a "Cadence configuration error:" message that names the code and instructs the model not to execute the workflow or substitute shell/subagent tools for abel_dispatch, to inspect host extension-load errors and tool filters, and to resubmit the original slash command while the session is idle.
The prompt entrypoints carry the same diagnostic contract: for example `prompts/abel-design.md` instructs the model to "stop and report `Cadence configuration error: abel-stage-tools-unavailable`" when `abel_dispatch` is missing, and to never claim the stage started.

---

## Sealed Plan Validation

Plan compilation fails with one structured error carrying every independent finding, never a partial plan:

- `src/delivery-compiler.ts#compileImplementPlan` runs expansion (single-task, then draft), input-binding, normalization, graph readiness, input timing and delivery verification checks, and throws a single `DesignPlanValidationError` whose message embeds the canonical JSON of all diagnostics.
- The compiled result reports its static checks separately from authority: `checks: { structure: "passed", verificationCapability: "passed", contractCoverage: "passed" | "not-checked", sealing: "not-performed" }`.
- `src/contracts.ts` graph validation "collects independent task/output and rejected-task field errors without admitting a partial plan," and `DesignPlanValidationError` (defined in `src/design-diagnostics.ts`) deduplicates and canonically sorts its diagnostics, so the same error set is stable across runs.

Concrete example: a draft that names a producer output a consumer cannot reach produces the `producer-output-unavailable` diagnostic with a code-owned hint ("Keep the declared producer output available at this consumer, including after intermediate deletes and AGENTS checkpoints.") rather than a generic validation failure.

---

## Bounded Diagnostic Projection

`src/design-diagnostics.ts#projectDesignDiagnostic` is the single projection for tool feedback and TUI:

- Only an allowlisted set of identity keys survives (`code`, `taskId`, `phase`, `field`, `category`, `owner`, `verificationId`, `acceptanceId`, `outputId`, `dependencyTaskId`, `producerTaskId`, `producerPhase`, `command`, `reason`, `systemCode`, `exitCode`), each matched against `^[a-z0-9](?:[a-z0-9._:-]{0,126}[a-z0-9])?$`.
- `path` values must be valid repository-relative paths without control characters; path and value arrays are deduplicated, canonically sorted, and capped at 32 entries with a `pathsTruncated` flag.
- A code-owned `HINTS` map supplies the correction guidance for each diagnostic code, e.g. `duplicate-path` → "Remove the repeated path at the indicated index; keep the existing declaration and do not widen phase permissions." and `script-command-mismatch` → "command must equal the literal package.json scripts[script] value, not an invocation such as npm run test.
  In PlanDraft, omit command to bind it from the manifest.
  Explicit commands ... remain exact and must be corrected rather than silently replaced."

`src/verification-diagnostics.ts` applies the same discipline to execution feedback: `diagnosticText` strips ANSI sequences and redacts `Bearer <token>`, `api_key|token|password|secret = value`, and `http(s)://user:pass@` before truncating to 4096 bytes (head + tail with a `…[truncated]…` marker), and the `VerificationFeedback` store keeps at most 32 operation-local entries with at most 4 failure lines (256 bytes each), 512 bytes of stdout and 1024 bytes of stderr.
Its header comment is the rule: "Diagnostic text is evidence for repair, never a failure identity or authority."

---

## Closed Failure Vocabularies

`src/contracts.ts` defines the failure codes as closed const arrays, and the types are derived from them:

- `ARTIFACT_FAILURE_CODES` — ~50 codes for candidate/artifact problems, e.g. `git-apply-failed`, `write-set-mismatch`, `baseline-shape`, `outside-managed-region`, `red-not-witnessed`, `producer-output-unavailable`.
- `STALE_FAILURE_CODES` — drift codes such as `baseline-file-drift`, `baseline-directory-drift`, `stale-snapshot`.
- `ENVIRONMENT_FAILURE_CODES` — host/environment codes such as `bubblewrap-launch-failed`, `child-provider-authentication-failed`, `bun-executable-unavailable`, `dependency-path-unsafe`.
- Transport failures use `src/transport-budget.ts` codes: `first-progress-timeout`, `stream-idle-timeout`, `attempt-timeout` (a `TransportTimeout` distinguishes request scope from attempt scope).

Other modules keep the same shape: `src/state-root.ts` exports `STATE_ROOT_ERROR_CODES`, `src/package-state.ts` throws `PackageStateError` with codes, and `src/openspec-cli.ts` throws `OpenSpecCliError` carrying both a phase (`resolution` / `spawn` / `execution` / `protocol`) and a bounded reason.

---

## Recovery and Route Decisions

- `src/workflow-recovery-policy.ts#decideRecoveryAction` is the one policy for every nested recovery action: a request is allowed only when its attempt is a positive safe integer within the limit from the plan (`verification.repair.maxAttempts` or `verification.artifactCorrection.maxAttempts`, or 1 when the grant itself is the authority).
  Exhaustion returns the closed codes `repair-attempts-exhausted` or `artifact-attempts-exhausted`.
  Recovery grants are validated before readiness, and a rejected grant retains a truthful paused state instead of a silent retry.
- `src/worker-broker.ts` restores routes from stored health: an `open` route with a future `retryAt` (30 s `cooldownMs`) is a cooldown, not a capability failure; a `half-open` route with an in-flight probe is not re-probed; health history is never cleared by restoration.
- `src/execution-profile.ts` selects the verification profile from operator configuration only: an unknown `ABEL_EXECUTION_MODE` throws `execution-mode-invalid` (no implicit fallback to a trusted mode), `ABEL_VERIFICATION_ENV` is rejected in `isolated` mode (`verification-environment-requires-trusted-mode`), and a `host-trusted` helper path must be an absolute path without NUL (`windows-job-helper-path-invalid`).

---

## TUI and Callback Boundaries

Presentation failures are isolated from orchestration, but they are isolated deliberately, not by swallowing: `src/subagent-activity.ts` wraps the widget install in try/catch ("TUI failures are deliberately isolated from the run.") and wraps observer callbacks ("A renderer callback is not part of orchestration.").
The contrast is the rule: a failed *stage startup* rolls back the tool set and activation (it changes execution-relevant state), while a failed *render* cannot.

---

## Process-Backed Subagent Contract

### 1. Scope / Trigger

This contract applies whenever a worker is executed through `src/subagent-process.ts` or its packet/candidate adapters.
The child is a fresh Pi CLI process, not an in-process `pi-ai` turn and not an operating-system sandbox.

### 2. Signatures

- `runSubagentProcess(input: SubagentProcessInput): Promise<SubagentProcessResult>`
- Child invocation: `pi --mode json -p --no-session --no-extensions --no-context-files --no-approve --tools <allowlist>`
- Parent candidate adapter: child edits a disposable proposal root; the parent captures a diff, validates it, and then runs candidate sealing, verification, and merge.

### 3. Contracts

- Required input: role, disposable `cwd`, prompt, optional inherited `provider/id` model reference, and optional `AbortSignal`.
- Result status is one of `completed`, `failed`, `cancelled`, `timed-out`, or `output-limit`; final assistant text, usage, bounded stderr, exit code, and bounded event metadata are observational only.
- `CADENCE_PI_EXECUTABLE` and `PI_EXECUTABLE` may select the CLI executable; credentials are resolved by the child Pi installation, not by an in-memory parent provider.
- `CADENCE_SUBAGENT_CHILD=1` prevents a child from registering Cadence workflow tools if an extension is explicitly injected.

### 4. Validation & Error Matrix

- Missing/unavailable executable or non-zero exit → bounded `failed` result; never successful fallback.
- Malformed JSONL, invalid UTF-8 boundary, prompt/output limit → bounded failure or `output-limit`.
- Parent cancellation → terminate the process group where supported, wait for pipes to close, then return `cancelled`.
- Deadline exceeded → terminate and return `timed-out`; do not classify it as provider success.
- Child `cwd` or `--tools` → capability hints only; parent write-set/diff checks remain authoritative.

### 5. Good / Base / Bad Cases

- Good: a child edits only approved files in a disposable root; the parent restores the baseline, validates the diff paths, and applies it once.
- Base: a read-only child returns one final JSON evidence block; the parent validates the domain result once and records only the bounded result.
- Bad: treating the child working directory as a sandbox, silently selecting another model route, accepting malformed output, or applying a child diff while leaving the child edits in the proposal root.

### 6. Tests Required

- Runner tests must cover successful final message extraction, malformed event, output limit, non-zero exit, cancellation, bounded UTF-8 output, and callback failure isolation.
- Packet tests must assert stage activation, evidence parsing, failure and cancellation states.
- Candidate tests must assert disposable edits/deletions, baseline restoration, diff path validation, sealing, one-time apply, and revision capture.
- Platform qualification must separately cover native process cancellation and authentication; local Linux tests do not prove Windows behavior.

### 7. Wrong vs Correct

#### Wrong

```ts
// cwd is not an OS sandbox and the child output is not authority.
spawn("pi", ["-p"], { cwd: consumerCheckout });
```

#### Correct

```ts
const child = await runSubagentProcess({
  role: "implementation-worker",
  cwd: disposableProposalRoot,
  prompt,
  signal,
});
// Parent captures and validates the resulting diff before applying it.
```

## Forbidden Patterns

- Never return or store a free-form error message as an identity or decision input; use a code from one of the closed arrays and project text at the boundary.
- Never fall back silently: unknown execution mode, unmatchable schema, ambiguous lockfile, or missing isolation each raise (see `execution-profile.ts`, `SqliteSchemaError`, `operator-tools.ts`, and the CI opt-in flags).
- Never repair a partial or ambiguous stored state in place; the admission points (`run-store.ts`, `package-state.ts`) reject or back it up instead.
- Never let a rejected request grant authority: unadmitted expanded stage messages are neutralized, and failed startup rolls back to the pre-startup tool set.
- Never log or display un-redacted transport details; `diagnosticText` is the only path from raw output to display.

---

## Common Mistakes

- Catching an admission error and retrying the same request with a different route before checking whether the failure is a cooldown versus an exhaustion; `worker-broker.ts` encodes the distinction so callers do not re-invent it.
- Treating a `paused` result as failed; paused states (`paused`, `approval-needed`, `operation-interrupted`) are truthful workflow states that continuation and status projection act on, not errors to clear.
- Writing a new error class with a string code that duplicates an existing closed array; search `src/contracts.ts` for the failure family before adding a code.
