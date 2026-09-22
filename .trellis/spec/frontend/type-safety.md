# Type Safety

> Type patterns in this project: TypeBox schemas for tool/prompt boundaries, structural validation in the kernel, strict JSON configuration, and canonical identity.

---

## Overview

The package validates at every boundary, but with two deliberately different tools.
At the model/tool boundary it uses `typebox` (peer dependency `typebox` + `typebox/value`): JSON-Schema-like envelopes that Pi can publish and that the model can see.
Inside the control plane it uses structural validation only: `src/contracts.ts` states "Strict request/result contracts for the private orchestration kernel.
Structural validation only; no runtime dependency on a schema library."
Identity is never string concatenation: it is `src/canonical.ts` canonical ordering plus SHA-256.

---

## Type Organization

- `src/contracts.ts` is the shared vocabulary module: `STAGES`, `ROLES` (`design-explorer`, `implementation-worker`, `diagnosis-worker`), `PHASES` (`evidence`, `red`, `green`, `refactor`), `OUTPUT_KINDS`, the closed failure-code arrays, `LIMITS`, `VERIFICATION_LIMITS`, `RELATIVE_PATH_PATTERN`, and the structural validators (`validateVerificationContract`, `isValidRelativePath`).
- Domain modules define their own record types next to the logic that owns them: `src/implement-plan.ts` (`ImplementPlan`, `PlanTaskDraft`), `src/change-contract.ts` (`ChangeContract`), `src/control-contracts.ts` (the closed `CONTROL_COMMANDS` surface), `src/run-state.ts` (`RUN_STAGES`, `RUN_STATES`, `TASK_STATES`, `DeliveryGate`).
- Host-facing capability types are minimal on purpose: `src/model-source.ts#ParentModelSource` and `PackageContext` are the whole host surface the control services may see.
- Plain-JS assets carry their own type files: `skills/_shared/load-config.d.mts` types `skills/_shared/load-config.mjs` for TypeScript consumers.

---

## Validation at the Model Boundary (TypeBox)

- `src/change-contract-schema.ts` builds `CHANGE_CONTRACT_SCHEMA` with a local `object()` helper that always sets `additionalProperties: false`; verification schemas are literal unions (`ATOMIC_VERIFICATION_SCHEMAS` for `vitest`/`package-script`/`static-check`, plus `VERIFICATION_SCHEMA` = atomic or bounded `steps` with 1–8 steps).
  Its `changeContractDiagnostics` converts `Value.Errors` into field-only `DesignPlanDiagnostic`s — bounded to 32, each with `code: "change-contract-field-invalid"`, a `field` path, and the failing `category` (keyword) — "without submitted dynamic keys": only the schema's declared fields are named, and nested checks add exact sub-paths such as `contract.acceptance.0.verification.expectedFailure`.
- `src/evidence-draft.ts#evidenceDraftSchema` builds the authoring-side evidence envelope per request: identity fields are `Type.Optional(Type.Literal(requestId))`-style (omitted or exactly matching — "Omit: bound by the submit tool.
  If supplied, must match this request."), paths use `relativePath()` with the pattern "no absolute paths, ./, .., backslashes, or trailing slash" (max 512), every object is `additionalProperties: false`, and advisory fields (`existing_structures`, `open_questions`, ...) are optional string arrays.
  The module comment states the shape rule: "The authoring boundary is smaller than the sealed EvidenceResult.
  Only code-owned identity and explicitly advisory fields may be omitted."
- `src/submit-tool.ts` types the two accepted submits (one final typed result, or one structured candidate patch plus requested paths/source citations/contract diagnostics), and derives context authority from the typed request rather than trusting Worker approval strings.

---

## Strict JSON Configuration

- The plan-draft examples are compiler-checked: `config/plan-draft.example.json` and `config/plan-draft.multiple-tasks.example.json` flow through the same `expandPlanDraft`/`compileImplementPlan` pipeline as runtime drafts, so a stale example fails `bun run check`-adjacent test runs, not just a linter.
- `src/single-task-draft.ts` enforces closed key sets: required (`taskId`, `objective`, `context`, `roots`, `read`, `greenWrite`, `verification`, `fullSuite`, `impactClosure`, `agents`) and optional (`redWrite`, `expectedFailure`, `verificationMode`, `recovery`); any other key throws `single-task-draft-invalid`; `behavior` mode requires `redWrite` plus `expectedFailure` and every other mode rejects both.
  Example: a `mechanical` task that still carries `expectedFailure` fails with `single-task-red-unexpected` before any compiler work.
- Worker routing is one whole JSON file: `src/route-policy.ts` reads `routes.json` (project before user), bounded at 1 MiB (`MAX_POLICY_BYTES`); route kinds are the closed `ROUTE_DIALECTS` set; custom routes reference credentials only through `apiKeyEnv`; capability fields are clamped against the parent model (`contextWindow`/`maxTokens` take the minimum).
- The research `.env` parser (`skills/_shared/load-config.mjs#parseEnvFile`) is strict: names must match `^[A-Za-z_][A-Za-z0-9_]*$`, values may be single- or double-quoted with a terminator check, and every failure names the 1-based line; a dangling symlink is retained by `lstat` and fails closed when opened instead of being treated as absent.

---

## Kernel Envelopes and Identity

- `src/contracts.ts` defines the strict packet/result envelopes (`PacketEnvelope`, `EvidenceResult`, `DiffResult`, `ChildFailure`, ...) and the closed safe failure codes; the shared `LIMITS` bound them: `maxActiveChildSessions: 4`, `maxEnvelopeBytes: 64 * 1024`, `phaseTimeoutMs: 20 * 60 * 1000`, `maxCompleteResultBytes: 64 * 1024`, and `VERIFICATION_LIMITS` (`minSteps 1 / maxSteps 8`, `minTestFiles 1 / maxTestFiles 64`).
- Verification commands are token-checked, not shell-parsed: `UNSAFE_VERIFICATION_TOKEN` rejects backticks and shell metacharacters (`;`, `&`, `|`, `$`, `<`, `>`, line breaks, NUL) in commands and arguments, and `src/verification-capability.ts` resolves runners without a shell.
- `src/canonical.ts` is the identity standard: `compareCanonicalStrings` uses UTF-16 code-unit order ("never host collation"), and `canonicalJson` serializes objects with sorted keys and dropped `undefined` values.
  Plan sealing hashes `${canonicalJson(plan)}\n`; agent pins hash the file bytes; storage identity chains hash canonical payloads — the same two functions everywhere.

---

## Forbidden Patterns

- Never use `any` in source; Biome's recommended preset keeps `noExplicitAny` on, and it is relaxed only for `*.test.ts` fixtures (see `biome.json`).
- Never add a dynamic (unlisted) key to a sealed envelope or schema; every object at a boundary is `additionalProperties: false` or a structural check that rejects unknown keys.
- Never type-assert where validation exists: the kernel validates structurally and the boundary validates with TypeBox; a cast that skips both is a review blocker.
- Never build an identity by string concatenation or locale comparison; use `canonicalJson`/`compareCanonicalStrings` and SHA-256.
- Never let host types beyond `ParentModelSource` (cwd, model, modelRegistry) appear in a control service import.

---

## Common Mistakes

- Writing a schema that accepts "something like" a path; the house standard is `RELATIVE_PATH_PATTERN` plus `isValidRelativePath` plus, for on-disk observation, `src/safe-path.ts#observeSafePath` (no symlink, no special file).
- Trusting a Worker's approval string or a model-echoed hash; authority derives from the code-owned fields (request ID, role, literals) that `evidence-draft.ts` binds, and from hashes the control plane computed itself.
- Using locale-sorted keys in a "canonical" comparison; host collation order changes between platforms and breaks identity chains, which is why `canonical.ts` is the only comparator.
