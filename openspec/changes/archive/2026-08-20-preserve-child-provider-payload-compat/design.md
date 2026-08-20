## Context

See `proposal.md` and the two delta specs for the approved behavior. The current child already uses `EmptyResourceLoader`, in-memory session/settings, five scoped tools, the selected Provider, fresh phase auth, and `maxRetries: 0`. What is missing is the parent Agent's effective `ProviderRequestOptions.onPayload`, because Pi creates that callback on the parent Agent and passes it in request options rather than storing it on the Provider returned by `ModelRegistry`.

The repeated Design/Implement loop exposed a separate trust-boundary defect. `validateDiffResult()` currently accepts ordinary headers without consuming hunk arithmetic or trailing bytes; two Revision-D candidates with impossible hunk counts, including one with `*** End Patch`, therefore passed structural submission and failed only at parent `git apply --check`. Revision E split strict admission from isolated preflight and fixed that API ambiguity, but its first Task 1.1 Red launch and the sole identical transport redispatch both ended before structural submission with `bootstrap-no-accepted-result`; no candidate or partial output was retained and no main-workspace byte changed.

Read-only recovery proved three Revision-E bootstrap defects. It hash-bound `semanticContract` without placing those bytes in the Agent system prompt; it collapsed public text-stop, Provider error/abort, schema/identity/strict-submit error, and repair exhaustion into one missing-result code; and it inherited the global thinking level even though its successful feasibility probe used `low`. Separately, two existing `test/contracts.property.test.ts` controls declared impossible hunk counts or omitted final LF, so a conforming strict parser would break the approved affected suite outside Task 1.1's write set. Revision F repairs only these HOW defects; Gate A behavior and all prior rejected outputs remain unchanged.

Current public Pi APIs are sufficient for both repairs. `ModelRegistry.registerProvider(Provider)` replaces a native Provider by id, Provider request options publicly expose `onPayload`, session/model lifecycle events are public, and the installed Responses adapter invokes `onPayload` after constructing params and before network send. Pi's effective callback intentionally catches individual extension-handler errors internally; Cadence inherits that observable result and does not inspect private runner state.

## Goals / Non-Goals

**Goals:**

- Capture one live parent-session effective payload callback through public Provider request options and reuse the unwrapped effective Provider for child requests.
- Keep callback/delegate ownership generation-scoped, process-local, non-recursive, and clear on every lifecycle boundary.
- Compose child callback, inherited callback, object validation, and final Responses normalization in a fixed order.
- Strictly consume complete ordinary unified diffs and preflight candidate artifacts outside the main workspace before parent application.
- Separate Agent transport redispatch from one finite semantic artifact correction and provide stable terminal recovery classifications.
- Give one task identity a task-level immutable contract plus phase-local identity, write set, snapshot, and verification contract.

**Non-Goals:**

- Loading or discovering parent/user/project extensions in a child, reading private `ExtensionRunner` handlers, or replaying any parent hook other than the exposed effective payload callback.
- Persisting callback references, payloads, candidate checkouts, transcripts, validation ledgers, Worker state, or retry state.
- Adding a dependency, public tool action, public orchestration API, compatibility DSL, fallback Provider, output cap, or unbounded correction loop.
- Treating generated syntax/import/no-test/wrong-Red defects as product behavior defects.

## Decisions

### 1. Use a session-owned public Provider bridge with explicit unwrapping

Add `src/parent-payload-bridge.ts`. A `ParentPayloadBridge` owns one monotonically increasing in-memory generation and a package-private symbol brand for wrappers. Its public-to-package operations are:

- `beginSession(sessionId)`: invalidate all prior captures and start a new generation;
- `install(model, registry)`: obtain the current effective Provider, recursively unwrap only package-branded wrappers, and register exactly one same-id wrapper through `ModelRegistry.registerProvider()`;
- `capture(modelKey)`: return a ready immutable capture only when session generation and exact model key match;
- `clear()`: invalidate captures and queues;
- `wrapProvider(delegate)`: capture the parent request's `options.onPayload` without invoking it, then delegate the parent stream unchanged.

The exact model key is `(provider, id, api, baseUrl)`. The ready capture contains only generation, session id, model key, original effective Provider reference, effective callback reference, and a generation-local FIFO tail. It never stores callback inputs or outputs.

`session_start` calls `beginSession(ctx.sessionManager.getSessionId())` and installs a wrapper for `ctx.model` when present. `model_select` invalidates the prior model capture and installs for the newly selected model. `before_agent_start` calls the same idempotent installation once more immediately before the parent request; this absorbs Provider re-registration or recomposition since the previous event. `session_shutdown` clears the bridge before `Runtime.drain()`. `finish`/drain also clears it after active work settles.

The wrapper snapshots `options.onPayload` and forwards the original options unchanged. A callback capture becomes ready only after the returned parent stream reaches successful completion. The wrapper forwards every stream event and preserves the original result; error, abort, or incomplete settlement discards the provisional capture. Both `stream` and `streamSimple` use the same helper, while the wrapper delegates only to the matching original method. Child phase Providers always receive the stored unwrapped delegate, never the Cadence wrapper, so child traffic cannot overwrite capture state or recurse.

Alternatives rejected:

- Loading the compatibility extension in `EmptyResourceLoader`: violates resource isolation.
- Reading `Agent`/`ExtensionRunner` internals: private, stale after reload, and cannot preserve supported Pi semantics.
- Capturing at `abel_dispatch`: too late; the callback exists only in the preceding parent Provider request options.
- Object spread alone: can drop future Provider capabilities. The wrapper explicitly overrides only stream methods and otherwise uses a proxy/delegating object; `fetchDeferred`, `cancelDeferred`, auth, models, and unknown fields remain delegated.

### 2. Compose payload callbacks once, then normalize Responses last

`runtimeFromContext(ctx, bridge, signal)` requires a ready capture matching `ctx.model`, resolves fresh phase auth from the current registry, and constructs a phase Provider around the capture's original delegate.

For each Provider request the phase Provider supplies one `onPayload` callback in this order:

1. Check the request signal and bridge generation before queue entry.
2. Run the child SDK callback from the incoming options once; `undefined` means unchanged.
3. Require a non-null, non-array object.
4. Enter the generation-local FIFO and recheck signal and bridge generation.
5. Run the captured parent effective callback once; `undefined` means unchanged.
6. Require a non-null, non-array object.
7. For `model.api === "openai-responses"`, shallow-clone the result and delete `max_output_tokens`.
8. Return the final object to the original delegate.

The original Provider method is invoked exactly once. Request signal, timeout, transport, cache/session options, sampling options, response callback, and unknown options are preserved; fresh auth/base URL/headers/env override their parent equivalents and `maxRetries` is forced to zero. Missing/stale capture, cancellation, exposed callback rejection, or unsafe result rejects before the Provider fetch. There is no untransformed or builtin fallback.

The FIFO is conservative because a parent extension callback may assume session-local ordering. Once a callback starts it is allowed to settle before the next enters; cancellation is checked before entry and before send. A generation change makes queued work stale. Pi-internal handler errors that the effective callback does not expose retain Pi's parent behavior.

### 3. Make complete-diff admission an independent first task

Task 1.1 owns only strict ordinary-unified-diff admission. Replace header-only `diffWritePaths()` parsing with a consumer that accepts optional ordinary `diff --git`, index, and regular-file create/delete metadata, then requires one matching `---`/`+++` pair and one or more valid `@@ -a,b +c,d @@` hunks per target. It counts context/removal/addition lines against each declared range, requires final LF, and allows only the next valid file section or EOF after a hunk.

It rejects binary, rename, copy, submodule, unsupported mode transition, duplicate target, escaping/noncanonical path, hunk underflow/overflow, no-hunk patch, missing final LF, Markdown fences, `*** End Patch`, and every other unconsumed suffix. `validateDiffResult()` invokes this parser before `createSubmitTool()` can retain a candidate; `applyRetainedPatch()` reuses it defensively before Git screening. Git remains the authority for applicability and ordinary all-or-nothing application: the parser establishes complete consumption and policy, not patch application.

Task 1.1 has a direct, non-circular Red against existing public/package functions. Red adds `test/candidate-diff-admission.property.test.ts`, which imports `validateDiffResult()`, `diffWritePaths()`, and the real `createSubmitTool()` without an optional module seam, and normalizes only the two malformed pre-existing ordinary-diff controls in `test/contracts.property.test.ts`: the multi-file control becomes `@@ -1 +1,2 @@` with ` old`/`+new`, followed immediately by `@@ -5,2 +5,2 @@` with its two context lines and a final empty array element to preserve LF; `validDiffResult()` changes only `@@ -1,2 +1,3 @@` to `@@ -1,2 +1,2 @@`, declaring its two actual new lines. Those normalizations must remain Green against the current header-only parser and are not the target Red. The dedicated target proves valid ordinary add/modify/delete controls and fails only because bad hunk counts, unconsumed suffixes/fences, missing final LF, forbidden forms, duplicate/escaping targets, or over-limit results are accepted.

Green changes only `src/contracts.ts`. The real submit tool already invokes `validateDiffResult()`, and `applyRetainedPatch()` already invokes `diffWritePaths()`, so `src/submit-tool.ts` and `src/patch.ts` are validation-only unless the accepted Red falsifies those verified call boundaries; changing either would then be a Design-required write-set expansion. No checkout or execution API is introduced in Task 1.1.

### 4. Add isolated preflight as a dependent second task with a fixed API

Task 1.2 adds `src/candidate-preflight.ts`, owned by the parent apply boundary. It is a package-internal library used by `applyRetainedPatch()` and the Implement parent; it adds no `abel_dispatch` action. The exported contract is fixed before Red so tests do not invent flags:

```ts
interface BaselineEntry {
  path: string;
  kind: "file" | "deleted";
  sha256?: string;      // required for kind=file
  bytes?: number;       // required for kind=file
  executable?: boolean; // required for kind=file
}

interface VerificationContract {
  id: string;
  argv: string[];
  classification: "expected-red" | "expected-green" | "expected-refactor";
  expectedFailure?: string; // required only for expected-red
  minTests: number;
}

interface CandidatePreflightInput {
  root: string;
  diff: Buffer;
  writeSet: string[];
  snapshot: Bound;              // real src/file-snapshot.ts Bound
  baseline: BaselineEntry[];
  verification: VerificationContract;
  packageManifest: FileBound;
  lockfile: FileBound;
  dependencyTarget: FileBound | DirBound;
  signal?: AbortSignal;
}

type CandidatePreflightResult =
  | { ok: true; classification: VerificationContract["classification"]; targets: string[]; commandId: string; exitCode: number; testCount: number; identityMatch: boolean; checkoutRemoved: true }
  | { ok: false; class: "artifact" | "environment" | "stale" | "cancelled"; code: string; commandId?: string; exitCode?: number; testCount?: number; identityMatch?: boolean; checkoutRemoved: true; excerpt?: string };

interface CandidatePreflightDependencies {
  mkdtemp: typeof mkdtempSync;
  remove: typeof rmSync;
  spawn: typeof spawnSync;
  realpath: typeof realpathSync;
  bwrapPath: string;
}

preflightCandidate(input: CandidatePreflightInput, dependencies?: CandidatePreflightDependencies): Promise<CandidatePreflightResult>
```

Production callers omit `dependencies`; tests may inject only those process/temp primitives to observe command argv, forced environment failures, and finally cleanup. No boolean shortcuts such as `bwrap:false` or `forceVerificationFailure` are admitted. Snapshots come from `snapshotFiles()`/`mergeBounds()` and are checked with `isCurrent()`; no ad hoc digest strings are valid. `ResultStore` retains the exact diff bytes plus this verification/baseline/bound-input contract and artifact correction count.

`preflightCandidate()` performs one transaction:

1. Recheck strict diff/write-set bounds and the current merged `Bound`.
2. Create a private sibling directory and run argv-only `git clone --no-hardlinks --no-local --no-checkout <root> <temp>` plus detached checkout. Reject alternates, submodules, symlinks, renames/copies, path escapes, ignored inputs, or a baseline entry the typed manifest cannot represent.
3. Reconstruct approved tracked modifications, tracked deletions, and approved untracked regular files exactly, preserving executable bits; verify reconstructed read/write and verification inputs.
4. Apply the exact retained bytes in the checkout.
5. Require Bubblewrap. Unshare network, mount a tmpfs `/tmp`, expose the checkout as the only writable repository tree, bind the package dependency target read-only at checkout `node_modules`, and keep host workspace/home/config/credentials absent or read-only.
6. Run `bun run check`, then the exact argv-only target. Only `bun run check` or `bun run test:target <test/...>` is valid; reject shell strings, env assignments, lifecycle/package-manager commands, metacharacters, absolute paths, traversal, and undeclared test paths.
7. Normalize command id, exit code, test count, failure class, stable assertion identity, expected-reason match, and a bounded sanitized excerpt. Recheck host/dependency manifests and main snapshot.
8. Delete the checkout in `finally`; `checkoutRemoved: true` describes verified cleanup, not a Worker assertion.

`applyRetainedPatch()` invokes preflight inside its existing process-local FIFO and applies the identical bytes to main only for an admitted expected Red/Green/Refactor result. The Implement parent immediately reruns the same target command in main as authoritative TDD evidence. No checkout path, raw log, diff body, credential, Provider diagnostic, or dependency content enters a public result or persistent state.

Task 1.2 Red uses a non-literal optional import and exact seam `not_ready: isolated candidate preflight is not implemented`. At least eight tests use the fixed API and real `Bound` values: valid expected Red/Green controls; malformed/loadability/no-test/wrong-identity rejection; stale snapshot; tracked deletion reconstruction; deterministic cleanup on success/failure/cancel; host/dependency immutability; and environment classification. The parent reference harness independently admits Task 1.1 strict-diff Red/Green and Task 1.2 isolated-preflight Red/Green; product/reference conformance precedes retirement, so candidate code never admits itself.

Alternatives rejected:

- A monolithic first task: the failed delivery proved that strict syntax, checkout execution, and an unspecified API make one oversized and ambiguous self-hosting packet.
- Applying to main and reverting or using `git worktree`: exposes invalid artifacts or mutates repository worktree metadata.
- Syntax-only transpilation: cannot prove import resolution, test discovery, Red identity, or isolation.
- Boolean testing shortcuts, a long-lived daemon, or a ledger: creates an untyped bypass or persisted runtime state.

### 5. Separate task identity, transport retry, and artifact correction

Extend diff requests with stable `taskId` and phase-local `id`. `abel_submit_result.taskId` must match the request's `taskId`; its `id` still matches the phase request id. `WorkerRegistry` is keyed by `taskId` and stores:

- immutable task contract: stage, role, task id, semantic objective, roots, AGENTS/contract context, prerequisites/conflicts/resources, output kind, and provider/model identity;
- current phase id, phase, exact phase write set, snapshot, and verification contract;
- one Agent transport redispatch bit for the current phase;
- one artifact-correction count for the current phase.

Phase write set, snapshot, verification, and request id are deliberately excluded from task-level equality and validated by the current phase contract instead. A later Red→Green→Refactor phase may advance only after the prior candidate was parent-preflighted/applied/validated; Runtime records this transition in memory when apply succeeds. A repeated current phase must be identical except the one permitted refreshed snapshot.

Transport and artifact states are independently classified but share one strictly decreasing process-launch cap:

- **Global launch cap:** one initial child request plus at most one additional Agent process launch for the phase. Launch index is `0 | 1`; a request for launch 2 is rejected before child creation. Thus transport redispatch and artifact correction are alternative uses of launch 1, never additive entitlements.
- **Agent transport state:** if launch 0 fails before a structurally accepted candidate, launch 1 may be one identical mechanical redispatch. Failure again is terminal `mechanical-redispatch-exhausted`; no semantic correction process remains.
- **Artifact correction state:** if launch 0 structurally submits a candidate that strict parsing or isolated preflight rejects, launch 1 may be one corrected candidate. Correction uses the same `taskId`, phase, role, stage, semantic objective, roots, AGENTS/contract context, prerequisites/conflicts/resources, exact write set, verification contract, and provider/model identity; only phase-local `request.id`, refreshed current snapshot, and compact normalized rejection evidence differ. The registry binds predecessor request/candidate hashes and admits that new id only as `correction=1`, never as Red→Green. A rejected launch-1 candidate is terminal `implementation-artifact-delivery-blocked`.
- **Pre-acceptance bootstrap repair:** before real structural submission, one shared token covers either a Pi/TypeBox schema error, identity/product/reference strict-submit error, or one ordinary no-submit assistant stop repaired by public same-run `Agent.followUp()`. It creates neither another Agent process nor a candidate. Provider `error`/`aborted` never consumes this token or receives a follow-up; a second pre-acceptance fault after the token was used terminates that launch as `bootstrap-pre-acceptance-repair-exhausted` and is classified by the process-launch state above.

The parent discards each rejected candidate before correction. `implementation-artifact-delivery-blocked` has no automatic outgoing transition. Only a proven need to change behavior, architecture, dependency, policy, scope, write set, or approved verification contract yields `design-required`. Environment failures yield `environment-blocked`. This makes every automatic path finite and prevents artifact defects from returning to Design.

### 6. Return stable structured recovery without leaking diagnostics

Failed Runtime results may include a `recovery` object with these stable fields:

- `code`: `mechanical-redispatch-exhausted | implementation-artifact-delivery-blocked | environment-blocked | design-required`;
- `taskId`, `requestId`, and `phase`;
- `branchBlocked: true`, `dependentsBlocked: true`, `partialResultUsable: false`;
- `independentResultsPreserved: true`;
- `next`: one of `finish-unaffected`, `correct-artifact`, `repair-environment`, or `return-to-design`.

For mechanical exhaustion and later calls against that exhausted phase, `next` permits only unaffected completion or return to Design before contract change. Artifact exhaustion never chooses `return-to-design`. Cancellation keeps its existing classification and has no recovery object. Error text mirrors the stable code without raw first/second failures, payloads, paths, credentials, model/Provider ids, extension identity, or complete validation logs.

### 7. Use a hash-bound SDK bootstrap with finite pre-submit syntax repair

Product `abel_dispatch` cannot deliver its own repair before the payload bridge is live. Tasks 1.1, 1.2, 2.1, and 3.1 therefore use a transaction-local SDK harness. Task 4.1 uses a fresh repaired-route SDK host as end-to-end acceptance: the host reuses the same in-memory retry-disabled settings, explicitly loads only the working-tree Cadence package plus the approved compat extension, enables the package-owned `abel-implement` prompt provenance, exposes only `abel_dispatch` to the host Agent, and lets product `runChildSession()` create the actual five-tool/zero-resource Worker. The host is a fresh process so it loads the applied 3.1 source; it does not use CLI/global retry settings.

The parent extracts the two fenced source blocks below into mode-0600 files outside the workspace and verifies their hashes before every phase. The bootstrap executes with Bun (the package runtime), public `createAgentSession()`, `SessionManager.inMemory()`, `SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } } })`, a hash-bound public-clamp thinking policy, a no-discovery `DefaultResourceLoader`, the one explicitly approved compat extension, and exactly the package's scoped `read`, `grep`, `find`, `ls`, plus a guarded real `createSubmitTool()`. It loads no Skills, Prompts, themes, context files, project/user extension discovery, mutation tools, commands, or session files. `ModelRuntime` resolves the parent-selected provider/model identity supplied by the Implement context and fresh configured auth; the contract never hard-codes a model or copies credentials. The exact hash-bound `semanticContract` is appended to the immutable package Agent prompt inside `<task-contract>` markers before `createAgentSession()`; capability must prove the Provider observed those bytes.

The thinking request is always literal `low`, but Pi's public model contract determines the effective level: `supported = getSupportedThinkingLevels(model)` and `effective = clampThinkingLevel(model, "low")`. The parent packet and attempt digest bind `[provider, model, requested="low", effective, supported]` in stable array order. The bootstrap loads the exact selected model, independently recomputes the same policy before auth or any Provider request, and fails closed as `bootstrap-thinking-policy-drift` unless requested, effective, and the ordered supported-level list match byte-for-byte. `createAgentSession()` receives only the recomputed effective value, and both public session thinking fields must equal it. This is not inheritance from global settings: for the current `gpt/gpt-5.6-sol` metadata, public clamp yields requested `low`, supported `["xhigh","max"]`, effective `xhigh`; a model that publicly supports `low` yields effective `low`.

The guarded `abel_submit_result` preserves the real tool's schema/name/identity/clone/termination semantics. Before delegating unchanged params, it checks exact stable bootstrap identity, calls product `validateDiffResult()`, then the reference strict parser. Public `tool_execution_end` accounts for schema errors that occur before wrapper execution; wrapper and event accounting deduplicate by tool-call id. A composed public `session.agent.shouldStopAfterTurn` preserves any inherited SDK hook and synchronously ends the run after the terminal fault turn, while public abort signals in-flight cancellation; the terminal exhaustion classification is not overwritten by the resulting abort/error event. The first schema/identity/strict-submit error consumes the one shared pre-acceptance repair token and returns a bounded stable tool error. If a public `turn_end` instead contains an ordinary `stop`/`length` with no tool call and no accepted result, that same token may queue one fixed public `session.agent.followUp()` reminder inside the current run. Provider `error`/`aborted` is classified immediately without follow-up. A second fault after the token was used terminates with `bootstrap-pre-acceptance-repair-exhausted`; no third Provider turn is added by this repair path.

The guard never executes Git, tests, Bubblewrap, or semantic preflight and never edits candidate bytes, so it is pre-acceptance control flow rather than candidate admission. Cleanup unsubscribes, calls the public `Agent.reset()` lifecycle method to erase transcript/runtime/queues, then disposes the session; it never accesses a private handler or persists session state. A successful real-tool execution yields only an **untrusted delivered candidate bundle** with `status=candidate`; it is not retained in `ResultStore`, admitted, or applicable. Only the parent may turn that delivery into an accepted artifact after reference/product isolated preflight; only that post-submit parent rejection can consume artifact-correction budget.

Before Task 4.1, the current real submit tool requires `id === taskId === requestId`; the bootstrap faithfully uses one stable tool-facing task id. Revision-E Task 1.1 delivery identity and both launch allowances are historical exhausted evidence and can never be reused. Revision F Task 1.1 uses the new transaction-local tool-facing identity `preserve-child-provider-payload-compat-1.1-f`; its changed semantic contract, Red write set, verification binding, bootstrap hash, and public-clamp thinking policy make it a newly approved technical contract rather than a renamed third launch.

Every fresh process has parent-only `dispatchAttemptId`, `launchIndex`, `correctionIndex`, and SHA-256 bindings for the immutable semantic contract, write set, verification, snapshot, provider/model/requested-effective-supported thinking policy, predecessor candidate, and normalized rejection. These are transaction metadata, not `RequestEnvelope`, `DiffResult`, public API, or persistent state. A correction appendix is separately hashed; the base package Agent prompt and semantic contract remain byte-identical across that Revision-F task's phases and attempts.

Each phase has at most two Agent process launches total: launch 0 is initial; launch 1 is either one identical transport redispatch or one semantic artifact correction. They are not additive. A requested launch 2 is rejected before process creation. Inside each pre-bridge bootstrap launch, ordinary model/tool turns may occur for scoped reads, but the explicit pre-acceptance repair path adds at most one Provider turn through the shared token above. A second pre-acceptance fault fails that launch. The repaired-route Task 4.1 host does not add this wrapper: it exercises product strict submission/preflight state directly. If final launch 1 fails before structural submission the result is `mechanical-redispatch-exhausted`; if it submits a candidate that parent preflight rejects the result is `implementation-artifact-delivery-blocked`. No automatic edge returns artifact exhaustion to Design.

Reference admission applies to Tasks 1.1 and 1.2. For Task 1.1 it independently parses the two-file Red candidate and runs two reference transactions over the identical candidate bytes, each in a fresh detached checkout and each preceded by `bun run check`: (A) `expected-green`, argv `bun run test:target test/contracts.property.test.ts`, minimum 1 test; (B) `expected-red`, argv `bun run test:target test/candidate-diff-admission.property.test.ts`, the approved dedicated assertion identity, minimum 1 test. Both transactions must pass their classifications before any main application, so an existing-control failure cannot be hidden by the target Red. The parent then applies identical admitted bytes, reruns the existing-control command as the main precheck, and runs the dedicated authoritative Red command. Parent review also confirms the existing-file edits are limited to the two specified fixture normalizations. Green uses one expected-green reference transaction for each target over identical candidate bytes and must conform to the reference strict parser. Task 1.2 Red/Green additionally uses the full clone/Bubblewrap path and product/reference conformance, then deletes both extracted files after its stable checkpoint. Later phases use product strict parsing/preflight. Revision-D outputs and Revision-E Task 1.1 attempts are historical rejection/exhaustion evidence only: they confer no candidate, correction, identity, retry, or launch authority and are never supplied to a Worker.

#### Bootstrap SDK harness

Implement extracts bytes between `ABEL:BOOTSTRAP-HARNESS:START` and `ABEL:BOOTSTRAP-HARNESS:END`, excluding markers and fence, preserving final LF. SHA-256 MUST be `7dfce44e427bcc297e5513805ab9a3198d51e2a2418e5197c23de2430983061c`. Its faux capability must report `status=ready`, `sdk=true`, `fiveTools=true`, `inMemorySession=true`, `retryDisabled=true`, `strictGuard=true`, `semanticContractDelivered=true`, `classifiedTermination=true`, `sameProcessNoSubmitRepair=true`, `sharedPreAcceptanceRepairBound=1`, `maxSubmitCallsPerLaunch=2`, `requestedThinkingLevel=low`, `clampedThinkingPolicy={requested:low,effective:xhigh,supported:[xhigh,max]}`, `lowControlThinkingPolicy={requested:low,effective:low,supported:[off,minimal,low,medium,high]}`, and `realProviderRequests=0`. Cases must cover both policy controls, valid submit, strict malformed repair, TypeBox schema repair, ordinary no-submit repair, no-submit exhaustion, strict-error then no-submit shared exhaustion, schema-error then no-submit shared exhaustion, two strict errors, two schema errors, and Provider error without follow-up. Every exhausted two-fault case must stop after two Provider turns even when a third faux response is scripted. A separately hash-consistent forged policy must fail before Provider access as `bootstrap-thinking-policy-drift`.

<!-- ABEL:BOOTSTRAP-HARNESS:START -->
```javascript
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const fail = (code) => {
  throw new Error(code);
};
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const canonical = (value) => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
};
const same = (left, right) => canonical(left) === canonical(right);
const importAt = (path) => import(pathToFileURL(path).href);

function regular(path, expectedHash) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) fail("bootstrap-input-kind");
  const digest = sha256(readFileSync(path));
  if (expectedHash && digest !== expectedHash) fail("bootstrap-input-drift");
  return digest;
}

async function loadModules(root, referencePath, referenceHash) {
  const referenceDigest = regular(referencePath, referenceHash);
  const [pi, ai, faux, typebox, submit, contracts, scoped, snapshots, reference] = await Promise.all([
    importAt(join(root, "node_modules/@earendil-works/pi-coding-agent/dist/index.js")),
    importAt(join(root, "node_modules/@earendil-works/pi-ai/dist/index.js")),
    importAt(join(root, "node_modules/@earendil-works/pi-ai/dist/providers/faux.js")),
    importAt(join(root, "node_modules/typebox/build/index.mjs")),
    importAt(join(root, "src/submit-tool.ts")),
    importAt(join(root, "src/contracts.ts")),
    importAt(join(root, "src/scoped-tools.ts")),
    importAt(join(root, "src/file-snapshot.ts")),
    importAt(referencePath),
  ]);
  if (typeof reference.strictDiff !== "function") fail("bootstrap-reference-api");
  return { pi, ai, faux, typebox, submit, contracts, scoped, snapshots, reference, referenceDigest };
}

function wrapReadTools(modules, roots, observer) {
  const { defineTool } = modules.pi;
  const { Type } = modules.typebox;
  const order = ["read", "grep", "find", "ls"];
  return modules.scoped.createScopedTools({ roots, observer })
    .sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name))
    .map((tool) => defineTool({
      name: tool.name,
      label: tool.name,
      description: tool.description,
      parameters: tool.name === "grep"
        ? Type.Object({ path: Type.String(), pattern: Type.String() }, { additionalProperties: false })
        : Type.Object({ path: Type.String() }, { additionalProperties: false }),
      async execute(_id, params) {
        const result = await tool.execute(params);
        return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
      },
    }));
}

function guardedSubmit(modules, input, repair) {
  const real = modules.submit.createSubmitTool({
    requestId: input.taskId,
    role: input.role,
    phase: input.phase,
    output: "diff",
  });
  let preAcceptRejects = 0;
  const tool = modules.pi.defineTool({
    ...real.tool,
    async execute(id, params, signal, onUpdate, ctx) {
      try {
        if (
          params.id !== input.taskId ||
          params.taskId !== input.taskId ||
          params.role !== input.role ||
          params.phase !== input.phase
        ) {
          throw new Error("identity");
        }
        const structural = modules.contracts.validateDiffResult(params);
        if (!structural.ok) throw new Error(`product-${structural.reason}`);
        modules.reference.strictDiff(params.diff);
      } catch (error) {
        preAcceptRejects++;
        if (repair.used >= 1) {
          repair.terminal = "bootstrap-pre-acceptance-repair-exhausted";
          ctx.abort();
        } else {
          repair.used++;
          repair.kind = "submit-error";
          repair.consumedSubmitCalls.add(id);
        }
        const code = error instanceof Error ? error.message : "diff-format";
        throw new Error(`bootstrap-pre-submit-rejected:${code}`);
      }
      return real.tool.execute(id, params, signal, onUpdate, ctx);
    },
  });
  return { real, tool, getPreAcceptRejects: () => preAcceptRejects };
}

function thinkingPolicy(modules, model, requested = "low") {
  if (requested !== "low") fail("bootstrap-thinking-policy");
  const supported = modules.ai.getSupportedThinkingLevels(model);
  const effective = modules.ai.clampThinkingLevel(model, requested);
  if (!Array.isArray(supported) || supported.length === 0 || !supported.includes(effective))
    fail("bootstrap-thinking-policy");
  return { requested, effective, supported };
}

async function sessionFor(modules, input) {
  const computedPolicy = thinkingPolicy(modules, input.model, input.thinking.requested);
  if (!same(computedPolicy, input.thinking)) fail("bootstrap-thinking-policy");
  const settings = modules.pi.SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
  });
  const sessions = modules.pi.SessionManager.inMemory(input.root);
  const deliveredSystemPrompt = `${input.systemPrompt}\n\n<task-contract>\n${input.semanticContract}\n</task-contract>`;
  const loader = new modules.pi.DefaultResourceLoader({
    cwd: input.root,
    agentDir: input.agentDir,
    settingsManager: settings,
    additionalExtensionPaths: input.compatPath ? [input.compatPath] : [],
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPromptOverride: () => deliveredSystemPrompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();
  const extensionResult = loader.getExtensions();
  if (extensionResult.errors.length !== 0) fail("bootstrap-extension-load");
  if (input.compatPath && extensionResult.extensions.length !== 1)
    fail("bootstrap-extension-count");
  const observed = {};
  const readTools = wrapReadTools(modules, input.roots, (entry) => {
    const existing = observed[entry.path];
    const captured = entry.kind === "dir"
      ? modules.snapshots.snapshotDirManifest(input.root, entry.path)
      : modules.snapshots.snapshotFile(input.root, entry.path);
    observed[entry.path] = captured ?? { kind: "absent", absent: true };
    if (existing && !same(existing, observed[entry.path])) fail("bootstrap-read-drift");
  });
  const repair = { used: 0, kind: null, terminal: null, consumedSubmitCalls: new Set() };
  const submit = guardedSubmit(modules, input, repair);
  const tools = [...readTools, submit.tool];
  const names = tools.map((tool) => tool.name);
  if (!same(names, ["read", "grep", "find", "ls", "abel_submit_result"]))
    fail("bootstrap-tool-set");
  const created = await modules.pi.createAgentSession({
    cwd: input.root,
    modelRuntime: input.modelRuntime,
    model: input.model,
    thinkingLevel: input.thinking.effective,
    tools: names,
    customTools: tools,
    resourceLoader: loader,
    sessionManager: sessions,
    settingsManager: settings,
  });
  const session = created.session;
  const inheritedShouldStop = session.agent.shouldStopAfterTurn;
  session.agent.shouldStopAfterTurn = async (context, signal) =>
    repair.terminal !== null || Boolean(await inheritedShouldStop?.(context, signal));
  if (session.sessionFile !== undefined || sessions.getSessionFile() !== undefined)
    fail("bootstrap-session-persistence");
  if (!same([...session.getActiveToolNames()].sort(), [...names].sort()))
    fail("bootstrap-active-tools");
  if (
    session.thinkingLevel !== input.thinking.effective ||
    session.agent.state.thinkingLevel !== input.thinking.effective
  ) fail("bootstrap-thinking-policy");
  let submitCalls = 0;
  let submitErrors = 0;
  let autoRetries = 0;
  let acceptedCalls = 0;
  const turns = [];
  const userMessage = (text) => ({
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  });
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "auto_retry_start" || event.type === "auto_retry_end") autoRetries++;
    if (event.type === "tool_execution_start" && event.toolName === "abel_submit_result") {
      submitCalls++;
      if (submitCalls > 2) session.agent.abort();
    }
    if (event.type === "tool_execution_end" && event.toolName === "abel_submit_result") {
      if (event.isError) {
        submitErrors++;
        if (!repair.consumedSubmitCalls.has(event.toolCallId)) {
          if (repair.used >= 1) {
            repair.terminal = "bootstrap-pre-acceptance-repair-exhausted";
            session.agent.abort();
          } else {
            repair.used++;
            repair.kind = "submit-error";
            repair.consumedSubmitCalls.add(event.toolCallId);
          }
        }
      } else if (event.result?.details?.accepted === true) acceptedCalls++;
    }
    if (event.type === "turn_end") {
      const calls = event.message.content
        .filter((item) => item.type === "toolCall")
        .map((item) => item.name);
      turns.push({ stopReason: event.message.stopReason, calls });
      if (submit.real.getResult() || calls.length > 0) return;
      if (event.message.stopReason === "error" || event.message.stopReason === "aborted") {
        repair.terminal ??= `bootstrap-provider-${event.message.stopReason}`;
        return;
      }
      if (repair.used === 0) {
        repair.used++;
        repair.kind = "no-submit";
        session.agent.followUp(userMessage(
          "Pre-acceptance repair 1/1: call abel_submit_result now with one complete contract-compliant unified diff; emit no prose.",
        ));
      } else {
        repair.terminal = "bootstrap-pre-acceptance-repair-exhausted";
      }
    }
  });
  return {
    session,
    settings,
    submit,
    observed,
    repair,
    turns,
    deliveredSystemPrompt,
    thinking: computedPolicy,
    unsubscribe,
    stats: () => ({ submitCalls, submitErrors, autoRetries, acceptedCalls }),
  };
}

function result(taskId, phase, diff) {
  return {
    id: taskId,
    role: "implementation-worker",
    kind: "diff",
    taskId,
    phase,
    summary: "bootstrap capability",
    diff,
    expectedVerification: "parent-owned verification",
    risks: [],
    nextStep: "parent admission",
    contractCompliant: true,
  };
}

async function fauxCase(modules, packet, name, responses, policyShape = "clamped") {
  const provider = modules.faux.fauxProvider({
    provider: `bootstrap-${name}`,
    api: "faux",
    models: [{ id: `bootstrap-${name}-model`, reasoning: true }],
  });
  if (policyShape === "clamped") {
    provider.models[0].thinkingLevelMap = {
      off: null,
      minimal: null,
      low: null,
      medium: null,
      high: null,
      xhigh: "xhigh",
      max: "max",
    };
  }
  let semanticContractDelivered = false;
  provider.setResponses(responses.map((response) => (context) => {
    semanticContractDelivered = context.systemPrompt.includes("<task-contract>\nCAPABILITY-CONTRACT\n</task-contract>");
    return response;
  }));
  const runtime = await modules.pi.ModelRuntime.create({
    credentials: new modules.ai.InMemoryCredentialStore(),
    modelsStore: new modules.ai.InMemoryModelsStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runtime.registerNativeProvider(provider.provider);
  const model = runtime.getModel(provider.getModel().provider, provider.getModel().id);
  if (!model) fail("bootstrap-faux-model");
  const thinking = thinkingPolicy(modules, model);
  const harness = await sessionFor(modules, {
    root: packet.root,
    roots: [packet.root],
    agentDir: packet.agentDir,
    compatPath: packet.compatPath,
    systemPrompt: "Submit the supplied result.",
    semanticContract: "CAPABILITY-CONTRACT",
    taskId: "T",
    role: "implementation-worker",
    phase: "red",
    modelRuntime: runtime,
    model,
    thinking,
  });
  try {
    await harness.session.prompt("submit", { expandPromptTemplates: false });
    const stats = harness.stats();
    return {
      name,
      providerCalls: provider.state.callCount,
      preAcceptRejects: harness.submit.getPreAcceptRejects(),
      realSubmitAttempts: harness.submit.real.getAttempts(),
      accepted: Boolean(harness.submit.real.getResult()),
      repairUsed: harness.repair.used,
      repairKind: harness.repair.kind,
      terminal: harness.repair.terminal,
      turns: harness.turns,
      thinking: harness.thinking,
      semanticContractDelivered,
      ...stats,
    };
  } finally {
    harness.unsubscribe();
    harness.session.agent.reset();
    harness.session.dispose();
    if (harness.settings.drainErrors().length !== 0) fail("bootstrap-settings-write");
  }
}

async function capability(packet) {
  const root = realpathSync(packet.root);
  const compatHash = regular(packet.compatPath, packet.compatHash);
  const modules = await loadModules(root, packet.referencePath, packet.referenceHash);
  const good = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
  const bad = `${good}*** End Patch\n`;
  const toolCall = (diff) => modules.faux.fauxAssistantMessage(
    modules.faux.fauxToolCall("abel_submit_result", result("T", "red", diff)),
    { stopReason: "toolUse" },
  );
  const schemaCall = (id) => modules.faux.fauxAssistantMessage(
    modules.faux.fauxToolCall("abel_submit_result", { id: "T" }, { id }),
    { stopReason: "toolUse" },
  );
  const text = (value) => modules.faux.fauxAssistantMessage(value, { stopReason: "stop" });
  const providerError = modules.faux.fauxAssistantMessage("", {
    stopReason: "error",
    errorMessage: "sanitized capability error",
  });
  const valid = await fauxCase(modules, packet, "valid", [toolCall(good)]);
  const lowControl = await fauxCase(modules, packet, "low-control", [toolCall(good)], "supports-low");
  const malformedRepair = await fauxCase(modules, packet, "malformed-repair", [toolCall(bad), toolCall(good)]);
  const schemaRepair = await fauxCase(modules, packet, "schema-repair", [schemaCall("schema-repair-1"), toolCall(good)]);
  const textRepair = await fauxCase(modules, packet, "text-repair", [text("not submitted"), toolCall(good)]);
  const textExhausted = await fauxCase(modules, packet, "text-exhausted", [text("not submitted"), text("still not submitted")]);
  const malformedThenText = await fauxCase(modules, packet, "malformed-then-text", [toolCall(bad), text("not submitted")]);
  const schemaThenText = await fauxCase(modules, packet, "schema-then-text", [schemaCall("schema-text-1"), text("not submitted")]);
  const malformedTwice = await fauxCase(modules, packet, "malformed-twice", [toolCall(bad), toolCall(bad), toolCall(good)]);
  const schemaTwice = await fauxCase(modules, packet, "schema-twice", [schemaCall("schema-twice-1"), schemaCall("schema-twice-2"), toolCall(good)]);
  const error = await fauxCase(modules, packet, "provider-error", [providerError]);
  if (!(valid.accepted && valid.providerCalls === 1 && valid.realSubmitAttempts === 1))
    fail("bootstrap-capability-valid");
  if (!(
    lowControl.accepted &&
    lowControl.providerCalls === 1 &&
    same(lowControl.thinking, {
      requested: "low",
      effective: "low",
      supported: ["off", "minimal", "low", "medium", "high"],
    })
  )) fail("bootstrap-capability-low-control");
  if (!same(valid.thinking, {
    requested: "low",
    effective: "xhigh",
    supported: ["xhigh", "max"],
  })) fail("bootstrap-capability-clamped-policy");
  if (!(malformedRepair.accepted && malformedRepair.providerCalls === 2 && malformedRepair.preAcceptRejects === 1 && malformedRepair.realSubmitAttempts === 1 && malformedRepair.repairKind === "submit-error"))
    fail("bootstrap-capability-malformed-repair");
  if (!(schemaRepair.accepted && schemaRepair.providerCalls === 2 && schemaRepair.submitErrors === 1 && schemaRepair.realSubmitAttempts === 1 && schemaRepair.repairKind === "submit-error"))
    fail("bootstrap-capability-schema-repair");
  if (!(textRepair.accepted && textRepair.providerCalls === 2 && textRepair.realSubmitAttempts === 1 && textRepair.repairKind === "no-submit"))
    fail("bootstrap-capability-text-repair");
  if (!(!textExhausted.accepted && textExhausted.providerCalls === 2 && textExhausted.terminal === "bootstrap-pre-acceptance-repair-exhausted"))
    fail("bootstrap-capability-text-exhausted");
  if (!(!malformedThenText.accepted && malformedThenText.providerCalls === 2 && malformedThenText.terminal === "bootstrap-pre-acceptance-repair-exhausted" && malformedThenText.repairUsed === 1))
    fail("bootstrap-capability-shared-budget");
  if (!(!schemaThenText.accepted && schemaThenText.providerCalls === 2 && schemaThenText.terminal === "bootstrap-pre-acceptance-repair-exhausted" && schemaThenText.repairUsed === 1))
    fail("bootstrap-capability-schema-shared-budget");
  if (!(!malformedTwice.accepted && malformedTwice.providerCalls === 2 && malformedTwice.terminal === "bootstrap-pre-acceptance-repair-exhausted" && malformedTwice.repairUsed === 1))
    fail("bootstrap-capability-malformed-twice");
  if (!(!schemaTwice.accepted && schemaTwice.providerCalls === 2 && schemaTwice.terminal === "bootstrap-pre-acceptance-repair-exhausted" && schemaTwice.repairUsed === 1))
    fail("bootstrap-capability-schema-twice");
  if (!(error.providerCalls === 1 && error.repairUsed === 0 && error.terminal === "bootstrap-provider-error"))
    fail("bootstrap-capability-provider-error");
  const cases = [valid, lowControl, malformedRepair, schemaRepair, textRepair, textExhausted, malformedThenText, schemaThenText, malformedTwice, schemaTwice, error];
  if (cases.some((item) =>
    item.autoRetries !== 0 ||
    item.submitCalls > 2 ||
    item.providerCalls > 2 ||
    item.thinking.requested !== "low" ||
    !item.thinking.supported.includes(item.thinking.effective) ||
    !item.semanticContractDelivered
  )) fail("bootstrap-capability-budget");
  console.log(JSON.stringify({
    status: "ready",
    sdk: true,
    fiveTools: true,
    inMemorySession: true,
    retryDisabled: true,
    strictGuard: true,
    semanticContractDelivered: true,
    classifiedTermination: true,
    sameProcessNoSubmitRepair: true,
    sharedPreAcceptanceRepairBound: 1,
    maxSubmitCallsPerLaunch: 2,
    requestedThinkingLevel: "low",
    clampedThinkingPolicy: valid.thinking,
    lowControlThinkingPolicy: lowControl.thinking,
    realProviderRequests: 0,
    compatHash,
    referenceHash: modules.referenceDigest,
    cases,
  }));
}

function validateAttempt(value) {
  if (!value || typeof value !== "object") fail("bootstrap-attempt-shape");
  if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(value.dispatchAttemptId ?? ""))
    fail("bootstrap-attempt-id");
  if (value.launchIndex !== 0 && value.launchIndex !== 1)
    fail("bootstrap-launch-index");
  if (value.correctionIndex !== 0 && value.correctionIndex !== 1)
    fail("bootstrap-correction-index");
  const hashes = [
    "contractDigest",
    "writeSetDigest",
    "verificationDigest",
    "snapshotDigest",
    "providerModelDigest",
    "systemPromptDigest",
  ];
  if (!hashes.every((field) => /^[0-9a-f]{64}$/u.test(value[field] ?? "")))
    fail("bootstrap-attempt-binding");
  if (value.correctionIndex === 0) {
    if (value.predecessorDigest !== null || value.rejectionDigest !== null)
      fail("bootstrap-initial-predecessor");
  } else if (
    !/^[0-9a-f]{64}$/u.test(value.predecessorDigest ?? "") ||
    !/^[0-9a-f]{64}$/u.test(value.rejectionDigest ?? "") ||
    value.launchIndex !== 1
  ) {
    fail("bootstrap-predecessor");
  }
}

async function run(packet) {
  validateAttempt(packet.attempt);
  if (!packet.snapshot || typeof packet.snapshot !== "object") fail("bootstrap-snapshot-required");
  if (regular(packet.agentPath, packet.agentHash) !== packet.agentHash)
    fail("bootstrap-agent-drift");
  if (sha256(packet.systemPrompt) !== packet.attempt.systemPromptDigest)
    fail("bootstrap-system-prompt-drift");
  const packetThinking = {
    requested: packet.requestedThinkingLevel,
    effective: packet.effectiveThinkingLevel,
    supported: packet.supportedThinkingLevels,
  };
  const computedBindings = {
    contractDigest: sha256(packet.semanticContract),
    writeSetDigest: sha256(canonical(packet.writeSet)),
    verificationDigest: sha256(canonical(packet.verification)),
    snapshotDigest: sha256(canonical(packet.snapshot)),
    providerModelDigest: sha256(canonical([
      packet.provider,
      packet.model,
      packetThinking.requested,
      packetThinking.effective,
      packetThinking.supported,
    ])),
  };
  for (const [field, digest] of Object.entries(computedBindings)) {
    if (packet.attempt[field] !== digest) fail("bootstrap-attempt-binding");
  }
  const root = realpathSync(packet.root);
  const compatHash = regular(packet.compatPath, packet.compatHash);
  const modules = await loadModules(root, packet.referencePath, packet.referenceHash);
  const runtime = await modules.pi.ModelRuntime.create({
    modelsStore: new modules.ai.InMemoryModelsStore(),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  const model = runtime.getModel(packet.provider, packet.model);
  if (!model || model.provider !== packet.provider || model.id !== packet.model)
    fail("bootstrap-model-unavailable");
  const thinking = thinkingPolicy(modules, model, packet.requestedThinkingLevel);
  if (!same(thinking, packetThinking)) fail("bootstrap-thinking-policy-drift");
  const auth = await runtime.checkAuth(packet.provider, { signal: AbortSignal.timeout(15_000) });
  if (!auth || !["api_key", "oauth"].includes(auth.type)) fail("bootstrap-auth-unavailable");
  const harness = await sessionFor(modules, {
    root,
    roots: packet.roots.map((path) => realpathSync(resolve(root, path))),
    agentDir: packet.agentDir,
    compatPath: packet.compatPath,
    systemPrompt: packet.systemPrompt,
    semanticContract: packet.semanticContract,
    taskId: packet.taskId,
    role: packet.role,
    phase: packet.phase,
    modelRuntime: runtime,
    model,
    thinking,
  });
  const timer = setTimeout(() => void harness.session.abort(), packet.timeoutMs);
  try {
    await harness.session.prompt(packet.userPrompt, { expandPromptTemplates: false });
    const accepted = harness.submit.real.getResult();
    const stats = harness.stats();
    if (!accepted || harness.submit.real.getAttempts() !== 1 || stats.acceptedCalls !== 1) {
      if (harness.repair.terminal) fail(harness.repair.terminal);
      const last = harness.turns.at(-1);
      fail(last ? `bootstrap-no-accepted-result:${last.stopReason}` : "bootstrap-no-accepted-result:no-turn");
    }
    if (stats.submitCalls > 2 || stats.autoRetries !== 0)
      fail("bootstrap-budget-drift");
    const assistants = harness.session.messages.filter((message) => message.role === "assistant");
    const final = assistants.at(-1);
    const finalCalls = final?.content.filter((item) => item.type === "toolCall") ?? [];
    const nonEmptyText = final?.content.some((item) => item.type === "text" && item.text.trim().length > 0) ?? true;
    const foreignCall = finalCalls.some((item) => item.name !== "abel_submit_result");
    if (!final || finalCalls.length !== 1 || foreignCall || nonEmptyText)
      fail("bootstrap-final-shape");
    if (!modules.snapshots.isCurrent(root, packet.snapshot)) fail("bootstrap-snapshot-stale");
    if (!modules.snapshots.isCurrent(root, harness.observed)) fail("bootstrap-observed-stale");
    const boundSnapshot = modules.snapshots.mergeBounds(packet.snapshot, harness.observed);
    const bundle = {
      result: accepted,
      boundSnapshot,
      dispatchAttemptId: packet.attempt.dispatchAttemptId,
      launchIndex: packet.attempt.launchIndex,
      correctionIndex: packet.attempt.correctionIndex,
      predecessorDigest: packet.attempt.predecessorDigest,
      rejectionDigest: packet.attempt.rejectionDigest,
    };
    const body = `${canonical(bundle)}\n`;
    if (!packet.outputPath.startsWith(`${dirname(packet.packetPath)}/`))
      fail("bootstrap-output-scope");
    writeFileSync(packet.outputPath, body, { mode: 0o600, flag: "wx" });
    chmodSync(packet.outputPath, 0o600);
    console.log(JSON.stringify({
      status: "candidate",
      dispatchAttemptId: packet.attempt.dispatchAttemptId,
      correctionIndex: packet.attempt.correctionIndex,
      taskId: packet.taskId,
      phase: packet.phase,
      candidateSha256: sha256(body),
      diffSha256: sha256(accepted.diff),
      preAcceptRejects: harness.submit.getPreAcceptRejects(),
      submitCalls: stats.submitCalls,
      preAcceptanceRepairUsed: harness.repair.used,
      preAcceptanceRepairKind: harness.repair.kind,
      terminationTurns: harness.turns,
      requestedThinkingLevel: harness.thinking.requested,
      effectiveThinkingLevel: harness.thinking.effective,
      supportedThinkingLevels: harness.thinking.supported,
      deliveredSystemPromptDigest: sha256(harness.deliveredSystemPrompt),
      boundSnapshotDigest: sha256(canonical(boundSnapshot)),
      compatHash,
      agentHash: packet.agentHash,
      referenceHash: modules.referenceDigest,
    }));
  } finally {
    clearTimeout(timer);
    harness.unsubscribe();
    harness.session.agent.reset();
    harness.session.dispose();
    if (harness.settings.drainErrors().length !== 0) fail("bootstrap-settings-write");
  }
}

async function main() {
  const packetPath = resolve(process.argv[3] ?? "");
  if (!packetPath || !existsSync(packetPath)) fail("bootstrap-packet-required");
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  packet.packetPath = packetPath;
  if (process.argv[2] === "--capability") await capability(packet);
  else if (process.argv[2] === "--run") await run(packet);
  else fail("bootstrap-mode");
}

try {
  await main();
} catch (error) {
  const code = error instanceof Error ? error.message : "bootstrap-failed";
  console.log(JSON.stringify({ status: "blocked", code }));
  process.exitCode = 2;
}
```
<!-- ABEL:BOOTSTRAP-HARNESS:END -->

#### Reference admission harness (Tasks 1.1 and 1.2 only)

Implement extracts bytes between `ABEL:REFERENCE-HARNESS:START` and `ABEL:REFERENCE-HARNESS:END`, excluding markers and fence, preserving final LF. SHA-256 MUST be `e1df08b6ac0fea4f55b57591f06ae4febbb77342046cae92bfa652dce268ec28`. Its deliberately narrow capability MUST report exactly the independent admission primitives it witnesses: `status=ready`, `bwrap=true`, `strictDiff=true`, and `realProviderRequests=0`. SDK identity, five-tool, retry, session, and bounded-submit invariants belong only to the bootstrap capability and are not claimed by this harness. The exported `strictDiff` is also the bootstrap pre-submit syntax guard.

<!-- ABEL:REFERENCE-HARNESS:START -->
```javascript
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const FAIL = (code) => {
  throw new Error(code);
};
const SHA256 = (value) =>
  createHash("sha256").update(value).digest("hex");
const PATH = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!.*\\)(?!.*\0).{1,512}$/u;
const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u;
const META = /^(?:diff --git |index |new file mode 100(?:644|755)$|deleted file mode 100(?:644|755)$)/u;

function headerPath(line, prefix) {
  const value = line.slice(prefix.length);
  if (value === "/dev/null") return null;
  const path = value.replace(/^[ab]\//u, "");
  if (!PATH.test(path) || path.includes("//") || path.startsWith("./")) FAIL("diff-path");
  return path;
}

function strictDiff(text) {
  if (typeof text !== "string" || !text.endsWith("\n")) FAIL("diff-format");
  if (/^(?:GIT binary patch|Binary files |rename |copy |old mode |new mode )/mu.test(text)) FAIL("diff-form");
  const lines = text.slice(0, -1).split("\n");
  const paths = [];
  let i = 0;
  while (i < lines.length) {
    while (i < lines.length && META.test(lines[i])) i++;
    if (i >= lines.length || !lines[i].startsWith("--- ")) FAIL("diff-tail");
    const oldPath = headerPath(lines[i++], "--- ");
    if (i >= lines.length || !lines[i].startsWith("+++ ")) FAIL("diff-header");
    const newPath = headerPath(lines[i++], "+++ ");
    const target = newPath ?? oldPath;
    if (!target || (oldPath && newPath && oldPath !== newPath) || paths.includes(target)) FAIL("diff-path");
    paths.push(target);
    let hunks = 0;
    while (i < lines.length && lines[i].startsWith("@@ ")) {
      const match = lines[i++].match(HUNK);
      if (!match) FAIL("diff-hunk");
      const oldNeed = Number(match[2] ?? 1);
      const newNeed = Number(match[4] ?? 1);
      let oldSeen = 0;
      let newSeen = 0;
      while (oldSeen < oldNeed || newSeen < newNeed) {
        if (i >= lines.length) FAIL("diff-hunk");
        const mark = lines[i][0];
        if (mark === " ") {
          oldSeen++;
          newSeen++;
        } else if (mark === "-") oldSeen++;
        else if (mark === "+") newSeen++;
        else FAIL("diff-hunk");
        if (oldSeen > oldNeed || newSeen > newNeed) FAIL("diff-hunk");
        i++;
        if (i < lines.length && lines[i] === "\\ No newline at end of file") i++;
      }
      hunks++;
    }
    if (hunks === 0) FAIL("diff-hunk");
  }
  return paths;
}

function run(cwd, command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    shell: false,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    ...options,
  });
  return { code: result.status ?? 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function safePath(root, rel) {
  if (!PATH.test(rel)) FAIL("manifest-path");
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(`${root}${sep}`)) FAIL("manifest-path");
  return abs;
}

function digestFile(path) {
  const bytes = readFileSync(path);
  return `${bytes.length}:${SHA256(bytes)}`;
}

function snapshot(root, paths) {
  const out = {};
  for (const rel of paths) {
    const abs = safePath(root, rel);
    if (!existsSync(abs)) out[rel] = "absent";
    else {
      const stat = lstatSync(abs);
      if (!stat.isFile() || stat.isSymbolicLink()) FAIL("manifest-kind");
      out[rel] = digestFile(abs);
    }
  }
  return out;
}

function same(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function copyBaseline(root, checkout, manifest) {
  for (const entry of manifest) {
    if (!entry || typeof entry !== "object" || typeof entry.path !== "string") FAIL("manifest-shape");
    const source = safePath(root, entry.path);
    const target = safePath(checkout, entry.path);
    if (entry.kind === "deleted") {
      rmSync(target, { force: true, recursive: true });
      continue;
    }
    if (entry.kind !== "file" || !existsSync(source)) FAIL("manifest-shape");
    const stat = lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) FAIL("manifest-kind");
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
}

function validVerification(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.argv)) return false;
  if (!["expected-red", "expected-green", "expected-refactor"].includes(value.classification)) return false;
  const argv = value.argv;
  if (argv[0] !== "bun" || argv.length < 3) return false;
  if (argv.some((part) => typeof part !== "string" || /[;&|`$<>\n\r]/u.test(part) || part.includes("..") || part.startsWith("/"))) return false;
  if (argv[1] !== "run" || !["check", "test:target"].includes(argv[2])) return false;
  if (argv[2] === "test:target" && argv.slice(3).some((part) => !part.startsWith("test/") || !PATH.test(part))) return false;
  return typeof value.id === "string" && typeof value.minTests === "number";
}

function normalize(output, code, verification) {
  const text = `${output.stdout}\n${output.stderr}`.slice(-8192);
  const testMatches = [...text.matchAll(/(\d+)\s+(?:tests?|passed|failed)/giu)].map((match) => Number(match[1]));
  const testCount = testMatches.length ? Math.max(...testMatches) : 0;
  const expected = verification.expectedFailure;
  const identityMatch = typeof expected !== "string" || text.includes(expected);
  const ok = verification.classification === "expected-red"
    ? code !== 0 && testCount >= verification.minTests && identityMatch && !/(parse_error|syntaxerror|failed to load|cannot find module|no test files)/iu.test(text)
    : code === 0 && testCount >= verification.minTests;
  return { ok, code, testCount, identityMatch, excerpt: text.replaceAll(/[^\x20-\x7e\n]/gu, "?").slice(-1024) };
}

function capability() {
  const probe = run("/", "bwrap", [
    "--unshare-net", "--die-with-parent", "--new-session", "--proc", "/proc", "--dev", "/dev",
    "--tmpfs", "/tmp", "--ro-bind", "/usr", "/usr", "--ro-bind", "/etc", "/etc",
    "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64", "/usr/bin/bun", "--version",
  ]);
  if (probe.code !== 0) FAIL("bwrap-unavailable");
  const good = "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n";
  if (strictDiff(good).join(",") !== "a.txt") FAIL("diff-capability");
  for (const bad of [`${good}*** End Patch\n`, good.replace("@@ -1 +1 @@", "@@ -1,2 +1 @@"), good.slice(0, -1)]) {
    let rejected = false;
    try { strictDiff(bad); } catch { rejected = true; }
    if (!rejected) FAIL("diff-capability");
  }
  console.log(JSON.stringify({ status: "ready", bwrap: true, strictDiff: true, realProviderRequests: 0 }));
}

function main(packetPath) {
  const packet = JSON.parse(readFileSync(packetPath, "utf8"));
  const root = realpathSync(packet.root);
  const diff = readFileSync(packet.diffPath, "utf8");
  const paths = strictDiff(diff);
  if (!Array.isArray(packet.writeSet) || paths.some((path) => !packet.writeSet.includes(path))) FAIL("write-set");
  if (!validVerification(packet.verification)) FAIL("verification-contract");
  const boundPaths = [...new Set([...(packet.boundPaths ?? []), ...paths])].sort();
  const before = snapshot(root, boundPaths);
  if (packet.snapshot && !same(before, packet.snapshot)) FAIL("stale-snapshot");
  const temp = mkdtempSync(join(tmpdir(), "cadence-preflight-"));
  const checkout = join(temp, "candidate");
  try {
    let result = run(temp, "git", ["clone", "-q", "--no-hardlinks", "--no-local", "--no-checkout", root, checkout]);
    if (result.code !== 0) FAIL("clone-failed");
    result = run(checkout, "git", ["checkout", "-q", "--detach", "HEAD"]);
    if (result.code !== 0) FAIL("checkout-failed");
    const alternates = join(checkout, ".git", "objects", "info", "alternates");
    if (existsSync(alternates)) FAIL("clone-alternates");
    copyBaseline(root, checkout, packet.baseline ?? []);
    result = run(checkout, "git", ["apply", "--check", "--whitespace=nowarn", "-"], { input: diff });
    if (result.code !== 0) FAIL("git-check");
    result = run(checkout, "git", ["apply", "--whitespace=nowarn", "-"], { input: diff });
    if (result.code !== 0) FAIL("git-apply");
    const dependencies = realpathSync(join(root, "node_modules"));
    const manifestBefore = `${digestFile(join(root, "package.json"))}:${digestFile(join(root, "bun.lock"))}`;
    const sandbox = [
      "--unshare-net", "--die-with-parent", "--new-session", "--proc", "/proc", "--dev", "/dev",
      "--tmpfs", "/tmp", "--ro-bind", "/usr", "/usr", "--ro-bind", "/etc", "/etc",
      "--ro-bind", "/lib", "/lib", "--ro-bind", "/lib64", "/lib64",
      "--bind", checkout, checkout, "--ro-bind", dependencies, join(checkout, "node_modules"),
      "--chdir", checkout, "/usr/bin/bun",
    ];
    const check = run(checkout, "bwrap", [...sandbox, "run", "check"]);
    if (check.code !== 0) {
      console.log(JSON.stringify({ ok: false, code: check.code, testCount: 0, identityMatch: false, class: "loadability", excerpt: `${check.stdout}\n${check.stderr}`.slice(-1024), paths, checkoutRemoved: true }));
      process.exitCode = 2;
      return;
    }
    const command = packet.verification.argv;
    result = run(checkout, "bwrap", [...sandbox, ...command.slice(1)]);
    const normalized = normalize(result, result.code, packet.verification);
    const after = snapshot(root, boundPaths);
    const manifestAfter = `${digestFile(join(root, "package.json"))}:${digestFile(join(root, "bun.lock"))}`;
    if (!same(before, after) || manifestBefore !== manifestAfter) FAIL("host-mutated");
    console.log(JSON.stringify({ ...normalized, paths, checkoutRemoved: true }));
    if (!normalized.ok) process.exitCode = 2;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

export { strictDiff };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "--capability") capability();
  else if (process.argv[2]) main(resolve(process.argv[2]));
  else FAIL("packet-required");
}
```
<!-- ABEL:REFERENCE-HARNESS:END -->

## Data Flow

```text
parent turn
  -> before_agent_start idempotently wraps current effective Provider
  -> parent Agent passes its effective onPayload in Provider options
  -> wrapper snapshots callback and delegates original Provider unchanged
  -> successful parent stream commits ready generation/model capture
  -> parent emits abel_dispatch tool call

child phase
  -> Runtime resolves ready capture + fresh auth
  -> isolated child serializes fresh payload through original Provider
  -> child SDK callback
  -> generation FIFO + inherited effective parent callback
  -> object check + final Responses max_output_tokens deletion
  -> original effective Provider sends once
  -> Worker parameters pass bounded bootstrap syntax guard
  -> real submit tool structurally submits candidate
  -> product strict complete-diff consumer
  -> ephemeral checkout + check + exact phase verification
  -> exact same bytes applied to main workspace only after preflight
```

## Risks / Trade-offs

- [Provider re-registration can replace the wrapper] → Reinstall idempotently at `before_agent_start`, unwrap only package-branded wrappers, and require a new successful parent request before child admission.
- [A successful Provider stream must be observed without consuming it twice] → Return a forwarding `AssistantMessageEventStream` that mirrors events once and commits capture only on a successful terminal result.
- [Parent callback is stateful or non-reentrant] → Serialize entry per generation and invalidate queued work on lifecycle change.
- [Pi hides an internal handler error] → Preserve Pi's effective callback result; do not claim stronger observability than the public API provides.
- [Dirty baseline reconstruction can drift] → Bind a normalized status manifest including modifications, deletions, modes, and approved untracked paths; compare reconstructed bounds and block as environment failure when any status cannot be represented safely.
- [Candidate tests could mutate host paths or dependencies] → Require Bubblewrap, unshare network, expose only the checkout writable, bind dependencies read-only, avoid Git alternates, and compare host/dependency manifests after execution; capability absence is environment-blocked.
- [A verification argv could become arbitrary command execution] → Admit only a strict `bun` package-script/test grammar, execute without a shell, and bind the exact argv in Gate B and each phase envelope.
- [Strict parser diverges from Git] → Limit it to complete-consumption and ordinary-text policy, then still require Git check/apply.
- [The first strict parser and preflight implementation cannot admit themselves] → Use the hash-bound reference strict parser for Task 1.1 and the full reference clone/Bubblewrap path for Task 1.2; require product/reference conformance before retirement, so candidate code never validates its own admission.
- [Bootstrap harness could drift from product child semantics or omit its bound contract] → Hash-bind the reviewed SDK/reference source, import the real `createSubmitTool`, `validateDiffResult`, scoped tools, and snapshot helpers, prove the exact semantic contract reaches the Provider-visible system prompt, fix thinking to `low`, classify public turn/tool outcomes, run faux capability before every phase, and record only resolved provider/model plus compat hashes in session evidence; any drift is `environment-blocked`.
- [The repaired route could remain unproven or inherit CLI retries] → Task 4.1 candidates must be produced through a fresh SDK host that loads only the working-tree package and compat extension with in-memory host retry disabled; product `abel_dispatch` must then create the real five-tool child, and faux target evidence must show no host or child auto-retry before real route use.
- [Artifact correction prompts overfit raw errors] → Return only stable codes, normalized identities, optional relative line, and a bounded sanitized excerpt.
- [Package distribution gains modules] → Task 1.2 adds only `package/src/candidate-preflight.ts` to both exact member lists; Task 2.1 adds only `package/src/parent-payload-bridge.ts`; each task runs its distribution target and pack/verify checkpoint before successors.

## Migration Plan

1. In a fresh Implement context, validate the new Gate receipts/hashes and record target, affected, and full-suite baselines.
2. Verify both Gate-B harness hashes and capabilities. Start Revision-F Task 1.1 under its new transaction identity: Red adds the dedicated strict-admission property target and normalizes only the two named existing diff fixtures; Green changes only `src/contracts.ts`. Deliver both through the repaired SDK bootstrap and reference admission, proving the full semantic contract is delivered, all pre-acceptance faults share one same-run token, and malformed parameters never become candidates. Deliver Task 1.2 through the same bootstrap plus full reference admission, require product/reference conformance, prove malformed/loadability/wrong-Red candidates never mutate main, then retire both extracted harness files.
3. Implement the pure bridge and callback composition; then wire public lifecycle Provider interception and product child dispatch, running the real installed Responses serializer against injected local fetch to prove final wire payload/isolation. Tasks 2.1 and 3.1 use product strict preflight after Task 1.2.
4. Add typed exhausted-recovery results and finite task/phase correction state, generating Task 4.1 candidates through the repaired product `abel_dispatch` route as its end-to-end acceptance.
5. At each stable task checkpoint update only the root AGENTS managed block when routing knowledge changed, then run target, affected, `bun run verify`, and `bun run check:agents`. Task 1.2 and Task 2.1 each update only their newly introduced shipped member in both exact distribution lists and run the distribution target plus pack check. After the final task, run package-wide regression `bun run traceability:check` and separately rerun the change-local 34/34 exactly-once Scenario audit bound in the Gate receipt; the package-wide script does not substitute for that audit.
6. Rollback is an ordinary code/test/prompt/index revert. No stored data migration or cleanup exists because all bridge, candidate, and recovery state is ephemeral.
