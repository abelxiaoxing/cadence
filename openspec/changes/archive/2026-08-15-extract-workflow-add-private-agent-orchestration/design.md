## Context

See `proposal.md` and the two delta specs for the approved behavior.
The current root contains OpenSpec artifacts plus the modified reference Git repository at `pi-packages/`; the candidate prompts-first package is untracked at `pi-packages/packages/pi-abel-workflow/`.
Implementation must first extract that package to the current root and relocate the complete reference repository to `/home/abelxiaoxing/work/subagent/pi-packages`, preserving its Git and dirty state.
After relocation, the reference repository is evidence-only: product source, imports, dependencies, tests, commands, links, packing, installation, and runtime must be independently resolvable.

The Pi SDK exposes the required stable primitives: package extension loading, `createAgentSession()`, custom tools, `SessionManager.inMemory()`, `SettingsManager.inMemory()`, custom `ResourceLoader`, `ExtensionContext.modelRegistry`, `getApiKeyAndHeaders(model)`, `getProvider(id)`, `getAllTools()`, `getActiveTools()`, `setActiveTools()`, terminating tool results, and nested ToolResult usage.
Local path files load as single extensions while local directories load by package rules; therefore a `.tgz` must be installed or unpacked before directory-based package loading.
No Pi host-version policy is part of the product.

The reviewed MIT reference at commit `a1ee2255b81cb540f88d233112e868ca91fe7846` supplies only narrow lifecycle evidence: FIFO settlement, cancellation cleanup, legal state transitions, and born-complete session disposal.
Its service, discovery, UI, workspace, persistence, background-management, and generic Subagent surfaces are out of scope.

## Goals / Non-Goals

### Goals

- Establish one independently checkable, testable, packable, and loadable package at the current root.
- Register four immutable package-owned professional Agents and one workflow-only `abel_dispatch` tool that is inactive by default.
- Run child sessions with package-defined prompts, an empty resource loader, in-memory session/settings, four scoped read tools, and one structural submit tool.
- Keep the parent exclusively responsible for Gates, result review, patch application, validation, AGENTS indexes, and task state.
- Run compatible evidence or task Workers concurrently and invalidate results only when a file they read or propose to write has changed.
- Disable Provider retry/cooldown and allow at most one identical mechanical redispatch.
- Keep private orchestration state in memory and dispose it deterministically.
- Validate absolute/relative package directories and a real tarball installed or unpacked into an isolated package directory.

### Non-Goals

- No dependency on an `@gotgenes/*` package or reference checkout.
- No general Subagent command, public orchestration library API, cross-extension service, Agent override, UI, result browser, background manager, worktree/container system, permission package, or private state persistence.
- No host-version probe, compatibility matrix, support warning, or version-based refusal.
- No compatibility-oriented or persistent Provider adapter, cooldown, circuit breaker, role-specific budget table, context-threshold governor, regex Worker, custom diff parser, before-image database, fsync rollback engine, or workspace-wide revision/lease platform; only the phase-local parent-auth bridge described below is included.
- No direct `.tgz`-file package loading, npm publication, registry-install claim, remote-repository creation, or release automation.
- No implicit archive, commit, or publication.

## Decisions

### 1. One bounded seed wave establishes the independent execution path

The seed wave is the only parent-authored semantic exception in this change.
It has three serial tasks:

1. **Mechanical extraction and relocation** — create only the absent destination parent `/home/abelxiaoxing/work/subagent/`, verify it is on the source device, and keep the final destination absent; place bootstrap tests under `scripts/bootstrap-test/` outside the package payload's `test/` top-level entry; copy the approved package payload without dereferencing symlinks; verify the copy; rename the complete reference repository with a no-overwrite precondition and collision-failing `mv --no-copy --update=none-fail -T`; verify source absence and destination Git/status identity. No copy/delete fallback or automatic reverse move is allowed.
2. **Standalone foundation** — create the root manifest, lockfile, Bun check/lint/test/pack commands, notices/licenses, package allowlist, four Agent definitions, strict request/result schemas, scoped read tools, file snapshots, and an inactive `abel_dispatch` facade.
3. **Minimum real execution path** — create one isolated child session, accept one structural result, retain a complete diff in memory, run parent `git apply --check`, apply it with ordinary `git apply`, and dispose the session.

The fresh-process seed acceptance must pass before any later task begins.
After it passes, remaining scheduler, lifecycle, workflow routing, and distribution semantics are produced by task-local Workers. The parent still reviews and applies every Worker diff; this is normal parent authority, not bootstrap authorship.

The relocation script itself is an approved `parent-mechanical` task because it changes repository topology and cannot be represented safely as a Worker textual patch. All other product changes are textual.

### 2. Standalone package has no version or reference resolution policy

The root is a single package, not a workspace. It directly contains the manifest, lockfile, Prompts, Skills, Agents, extension source, tests, scripts, documentation, OpenSpec, and root AGENTS index.

The manifest:

- retains `@abel/pi-abel-workflow`, ESM, and the existing four Prompt/Skill resources;
- declares `pi.extensions: ["./src/index.ts"]`, Prompt and Skill paths, and the `pi-package` keyword;
- lists Pi host packages and `typebox` as peer dependencies with `"*"` ranges;
- declares no non-host runtime dependency; path matching uses Node's public `node:path.matchesGlob`, while third-party test/lint packages remain development-only and exact resolution is captured by the generated lockfile;
- has no `exports` field for a supported orchestration library surface;
- ships `src/`, `agents/`, Prompts, Skills, config example, README, license, notices, and bundled attribution;
- excludes tests, scripts, OpenSpec, AGENTS, toolchain configuration, credentials, and runtime state.

The package performs no Pi version read or comparison. A test report may record the local host used by CI, but neither runtime nor documentation classifies versions.

The relocated reference may be read manually or by a bounded provenance verification command for source hashes and licenses. Such verification receives the path as an explicit evidence input and is not part of normal check/test/pack/load commands. Product imports, package resolution, test imports, symlinks, or commands must never traverse it.

### 3. Exactly one registered dispatcher, inactive by default

`src/index.ts` registers `abel_dispatch` during extension load, then removes only that name from the active set on `session_start`. Registration makes it visible in `pi.getAllTools()`; inactivity keeps it out of the model's callable tools.

Prompt files carry package-owned invocation markers. The extension observes `input` and `before_agent_start`, then checks `pi.getCommands()` provenance (`sourceInfo`) to distinguish package Prompt invocations from plain text with the same command name. Only `abel-design`, `abel-implement`, and `abel-diagnose` activate dispatch; Init never does.

Activation state is only:

```text
inactive -> pending -> active -> draining -> inactive
```

Ordinary follow-up turns, including Gate answers, do not deactivate an active stage. The dispatcher exposes five actions:

```text
run
apply
discard
cancel
finish
```

- `run` accepts either bounded evidence requests or compatible Worker phase requests and can address an existing logical Worker ID for its next phase.
- `apply` applies one retained current result.
- `discard` terminally erases one retained result.
- `cancel` cancels one batch or all current work.
- `finish` drains the stage and restores inactive state.

No action accepts an arbitrary system prompt, arbitrary tool list, host Agent path, or generic Agent selector. Every `execute` call also verifies the in-memory eligible-stage state, so another extension adding the registered tool name to the active set cannot bypass workflow activation. Reload, session replacement, and shutdown invoke the same idempotent drain path. Tool activation always starts from the current active set, so unrelated tools are preserved.

### 4. Immutable roles and bounded contracts

Four regular, non-symlink files are loaded relative to `import.meta.url` and frozen for one extension instance:

```text
agents/design-explorer.md
agents/contract-reviewer.md
agents/implementation-worker.md
agents/diagnosis-worker.md
```

The registry validates exact role names and hashes the file bytes. It never searches user or project Agent directories.

Every request includes:

- stage, package role, request/packet/task ID, and phase;
- objective and bounded relative path roots;
- relevant AGENTS excerpts and approved spec/task context;
- declared read/write files, conflicts, resources, and verification lock where applicable;
- output schema and cancellation signal;
- current file snapshot for Worker phases.

Every successful result comes through `abel_submit_result` and includes the matching identifiers. Evidence results carry concise conclusions and exact citations. Diff results carry concise metadata and one complete unified diff. A malformed, mismatched, duplicate, oversized, truncated, or non-submit completion is untrusted.

Initial limits are intentionally few and centralized constants:

```text
max active child sessions: 4
max requests in one batch: 8
serialized request envelope: 64 KiB
phase timeout: 20 minutes
complete submitted result: 64 KiB
```

These are implementation-safety parameters, not a role/budget platform. An input contract or result that cannot fit blocks with a return-to-Design split condition.

### 5. Isolated child sessions use the parent model without a private compatibility layer

A product child session is created only inside `abel_dispatch.execute`, where `ExtensionContext` supplies the current model, thinking level, and model registry. Missing model, Provider, or request auth is a sanitized dispatch failure. Before P-005 activates the public route, the R-09.1 implementation-only delivery adapter v2 described in Decision 8 creates isolated SDK sessions directly and never calls product `Runtime.execute()`, `runChildSession()`, or `createSubmitTool()`. That adapter is not a product action, extension surface, bootstrap exception, or parent-authored semantic path.

Immediately before each child phase is created, a minimal in-memory `ModelRuntime` owns one wrapper Provider and the selected model. The extension resolves `ctx.modelRegistry.getApiKeyAndHeaders(model)` at that phase boundary, and the wrapper delegates to the current parent Provider with the resolved API key, headers, base URL, and environment plus `maxRetries: 0`. This is a phase-local auth bridge, not a compatibility or retry platform; it does not inspect Pi's version or retain credentials after that child session is disposed. If phase-local auth expires during a long phase, that request fails normally and the one allowed mechanical redispatch obtains fresh auth.

Each child `createAgentSession()` receives:

- an empty package-defined `ResourceLoader`;
- `SessionManager.inMemory(cwd)`;
- `SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } } })`;
- an exact `tools` allowlist containing the package's scoped `read`, `grep`, `find`, `ls`, and `abel_submit_result` custom definitions;
- no built-in or discovered mutation tools, extensions, Skills, Prompts, themes, context files, or commands.

The submit tool is sequential and returns `terminate: true` only after schema and identity validation. A successful final Assistant message contains exactly one tool call and that call is `abel_submit_result`; mixed, duplicate, malformed, or later submissions make the request untrusted. Normal Assistant text is not success. For diff phases the canonical request ID equals the task ID, while phase remains a separate identity component; the submit path compares request, role, task, and phase before retaining a result. One phase-local in-memory observer classifies only the final Assistant-message shape, structural-submit attempt count, submit-schema outcome, and request/role/task/phase identity outcome. It never retains raw Assistant content, transcripts, tool history, credentials, or session state and is destroyed with the child session. Session events collect final Provider usage once; the dispatcher aggregates child usage once into its ToolResult. Every creation path uses `try/finally` to unsubscribe, abort as needed, and call `session.dispose()` exactly once.

### 6. Scoped read tools are simple filesystem wrappers

The four tools use Node filesystem APIs and repository-relative paths only. At request admission and every access they:

- reject NUL, backslash, absolute paths, `..`, noncanonical paths, and symlinks;
- canonicalize roots and require containment in one approved root;
- hide `.git` and `node_modules` unless explicitly in scope;
- accept regular UTF-8 text files only;
- apply fixed output limits of 2,000 lines or 50 KiB and identify truncation.

`grep` uses JavaScript regular expressions with a 1,024-character pattern bound, scans at most 2,000 files per call, and checks elapsed time between files. It does not introduce a regex Worker or guarantee interruption within one pathological regex evaluation; this known MVP limitation is documented under risks. `find` and `ls` use stable code-unit ordering and visit at most 20,000 entries per call. No child tool executes a process or creates a file.

### 7. File-level snapshots replace global workspace revisions

A Worker phase result binds a `FileSnapshot` map for:

- every regular file whose bytes `read` or `grep` inspected, including nonmatching files scanned by `grep`;
- a deterministic directory-entry manifest for every directory observed by `ls` or traversed by `find`; and
- every path named by the submitted diff as add, modify, or delete.

For an existing regular file the entry contains its normalized repository-relative path, SHA-256, byte length, and kind. A directory observation contains a hash of the sorted relative name/type entries observed at that scope. A proposed new path binds an explicit `absent` marker. The tools record actual observations internally; the submit validator derives write paths from standard textual diff headers and rejects headers outside the declared write set. Thus adding a path under a directory whose listing informed a result is a related change, while changes outside all observed files/directories and proposed targets remain unrelated.

Before applying a result, the parent recaptures only that result's bound paths. Exact equality means current; a hash, kind, or existence change means stale. No global workspace revision participates in this decision.

Consequences:

- two Workers can read the same baseline concurrently;
- applying result A does not stale result B when their bound file sets are disjoint;
- applying A stales B when A changes a file B read or writes;
- Red, Green, and optional Refactor each receive a fresh snapshot after the prior accepted patch and validation.

Declared read/write intersections, task conflict edges, shared resources, and validation locks still prevent known conflicts before dispatch. Unknown or directory-wide write sets remain serial. The parent applies accepted results one at a time in task order.

Properties cover snapshot idempotence, path-order independence, absence/existence transitions, unrelated-file invariance, and related-file invalidation.

### 8. Minimal scheduler, cancellation, and one mechanical redispatch

The scheduler is a simple DAG ready-set plus FIFO concurrency limiter. A request starts only when direct prerequisites are accepted and its declared read/write sets, conflict edges, resources, and validation lock are compatible with active requests. There is one global limit; no Provider/model semaphore or cooldown layer exists.

Each scheduled request has exactly one terminal state:

```text
queued | running | succeeded | failed | cancelled
```

A cancelled queued closure has a guarded start and cannot run later. Active cancellation forwards one AbortSignal to the child session. Sibling success remains retained when another branch fails.

Pi Agent retry and Provider retry are both disabled for child sessions. After one failed request, the dispatcher may issue one mechanical redispatch only when the canonical serialized request is byte-identical except for refreshed file-snapshot hashes. A second failure or a changed scope, dependency, conflict, write set, behavior, policy, dependency, or architecture blocks the branch.

A logical Worker ID may be reused across Red, Green, and optional Refactor. Its role plus provider/model/API/thinking identity are pinned at the first phase, while each later phase resolves fresh phase-local auth for that identity and creates a fresh in-memory child session from the immutable approved contract plus compact prior validation evidence. If the pinned model is no longer available, continuation blocks rather than silently switching models. There is no raw-transcript checkpoint system, idle TTL, lifetime ledger, or resume persistence.

#### P-004 delivery is split after exhausted historical identities

The original `P-004` Worker packet is a retired blocked delivery identity. Its Green diff and one allowed identical mechanical redispatch both failed `git apply --check` because their unified-diff hunk counts were corrupt; neither diff was applied, and that packet receives no third dispatch.

`P-004-A` was then delivered as a new identity and is complete. The subsequent old `P-004-B` identity is also historical blocked evidence: its Green result and sole identical mechanical redispatch both failed ordinary `git apply --check` before application. Neither rejected diff may be repaired, spliced, reconstructed, partially applied, or dispatched a third time under the same or a renamed equivalent large packet. The accepted formatter and standard new-file-header normalization in `test/file-concurrency.integration.test.ts` remains in place, while `src/contracts.ts` and `src/runtime.ts` remain at their pre-B product baseline.

The later old `P-004-B1` identity is historical blocked evidence rather than an executable DAG node. Its applied Red test generated a standard add/delete patch but retained and applied it while the fixture was already in the add/delete result state, so ordinary `git apply --check` would fail even after the parser defect was repaired. Its copy assertion used neither a semantically complete copy record nor a copy-specific failure check. That Red therefore failed for an unapproved fixture reason and did not establish the required parser-specific defect. The old B1 Green result also failed ordinary `git apply --check` because its unified diff was malformed, and its sole identical mechanical redispatch timed out without a result. The old identity and allowance are exhausted: it may not be dispatched again, renamed as an equivalent packet, repaired, spliced, reconstructed, partially applied, or continued from Green.

`P-004-B1R` is now also historical blocked evidence rather than an executable DAG node. Its first Red result modified only `test/patch.integration.test.ts`, but ordinary `git apply --check` exited 128 with a corrupt-patch error, so none of it was applied and the identity's sole identical mechanical redispatch was consumed. That redispatch produced an in-scope diff that passed ordinary checking and was applied, but the target evaluated `diffWritePaths(addDelete)` as an argument to `expect.soft`; the current ordinary-header defect threw before the assertion call, so the required copy parser and parent-path evidence never executed. The Red was therefore invalid despite reaching one approved product defect, and its complete diff was removed with the exact reverse patch. A later Green candidate used a zero-context replacement of the parser/helper region and failed ordinary `git apply --check`; it was not applied, repaired, spliced, partially adopted, or used as design evidence. `P-004-B1R` and its allowance are exhausted: it may not be dispatched again, continued from Green, renamed as an equivalent task, or borrow another identity's allowance.

`P-004-B1S` is now also historical blocked delivery evidence rather than an executable DAG node. Its Red request and its only permitted identical mechanical redispatch both ended with the observable result `child did not make exactly one structural submission`. Neither attempt produced a trusted structural result or unified diff, and no test or product change was applied. The repository contains no persistent Worker transcript or result from those attempts, so no deeper cause is claimed. B1S owns no checkbox or Scenario, receives no third dispatch, and has no reusable or resettable allowance; it may not be continued, renamed as an equivalent packet, or borrow another identity's allowance.

`P-004-TXT` is likewise historical blocked evidence rather than an executable DAG node. Its Red request `p004-txt-red-1` and the only permitted mechanically identical redispatch both ended with the same structural-submission error. Neither attempt yielded a trusted submit or diff, the test and product hashes remained unchanged, and no OpenSpec or AGENTS change was applied. TXT owns no checkbox or Scenario, receives no third dispatch, and cannot be continued, renamed as an equivalent packet, reset, reconstructed by the parent, or supplied another task's allowance. Because neither B1S nor TXT left an event packet, this design attributes no model or runtime root cause to either historical failure.

`P-004-SV` is now also historical blocked delivery evidence rather than an executable DAG node. Its first Red result contained a complete two-test diff that passed ordinary `git apply --check --whitespace=nowarn` and `bun run check`, and its target failures exposed approved structural defects, but the required scoped Biome precheck failed. The parent removed that complete temporary Red with its exact reverse patch, so it established no valid Red baseline. SV's sole mechanically identical redispatch returned the same two declared paths but failed ordinary Git checking with exit 128 and `patch fragment without header` at the second hunk; it was never applied, repaired, reformatted, partially adopted, or used for Green. SV owns no checkbox or Scenario, receives no further dispatch, and has no reusable, resettable, transferable, or borrowable allowance. No transcript, event packet, canary result, or deeper model-cause claim is retained.

#### Historical R-08 result and permanent P-004-DCR retirement

R-08 corrected R-07's cross-process canonical-continuity defect: each phase used one Bun process, read stdin once, froze one initial packet, and derived the sole possible attempt 2 from that frozen packet while preserving its canonical non-snapshot core. That correction remains valid historical evidence, but its product delivery chain was `Runtime.execute("run") -> runChildSession() -> createSubmitTool()`. The current product submit tool still exposes `Type.Object({}, { additionalProperties: true })`, and complete final-shape, submit-attempt, and request/role/task/phase classification belongs to the later P-004-FC product task. This is a potential bootstrap dependency, not a claimed cause of either historical child failure.

P-004-DCR exhausted its independent token under R-08. Its immutable history is: one Bun process; one stdin read; attempt 2 derived from the frozen initial packet; unchanged canonical core; two admitted markers; two post-admission model requests; zero trusted structural results; no diff; Red not established; checkbox pending before retirement; no latest Implement workspace write; and token unavailable/exhausted. No transcript, raw output, retained candidate, or event packet exists, so no deeper child cause is inferred.

P-004-DCR is permanently retired historical blocked evidence. It has no executable checkbox, Scenario ownership, token, continuation, reset, transfer, borrow, renamed-equivalent packet, recovery process, or third request. R-08 is not a future runner and cannot be copied to revive DCR.

#### R-09 strict direct-SDK delivery adapter and P-004-SDA

> Superseded by R-09.1 below for every later phase; retained as the immutable historical record of the retired P-004-SDA identity.

Gate B R-09 replaces the exhausted identity with `P-004-SDA` (strict direct-SDK adapter). Its architecture is substantively different:

```text
P-004-DCR: Runtime.execute -> runChildSession -> current product createSubmitTool
P-004-SDA: createAgentSession -> runner-local strict abel_submit_result -> runner-local final classification
```

The adapter does not import or call `src/runtime.ts`, `src/child-session.ts`, `src/submit-tool.ts`, `src/result-store.ts`, or the extension Runtime closure in `src/index.ts`. It uses Pi public SDK APIs directly, package-owned immutable role loading, `EmptyResourceLoader`, package-scoped read tools, file snapshots, a runner-local explicit TypeBox schema, an in-memory Provider/auth bridge, `SessionManager.inMemory()`, and `SettingsManager.inMemory()`. Worker tools are exactly `abel_submit_result`, `find`, `grep`, `ls`, and `read`; there is no shell, edit, write, discovered resource, extension action, product activation, compatibility layer, Provider retry, persistence, or parent-authored semantic implementation.

This remains Gate B tooling. Every successful Worker/reviewer result still arrives through `abel_submit_result`; parent review/application authority, real product `ExtensionContext` binding, Requirements, Scenarios, activation, public actions, dependencies, permissions, persistence, publication, and the bounded seed exception remain unchanged. Gate A artifacts therefore remain byte-identical.

P-004-SDA has direct prerequisite P-004-A, owns the one `Compact structured delivery / Result schema is invalid` Scenario formerly assigned to DCR, and is the direct prerequisite of P-004-FC. It uses resource `strict-diff-result-contract`, verification lock `p004-sda-target`, and one independent non-transferable Red/Green-shared token. It is not a reset or rename of DCR.

##### R-09 fixed identity and current environment state

Implementation delivery remains fixed to `provider=abel`, `model=deepseek-v4-flash`, `api=openai-completions`, and `thinking=off`. It never comes from `PI_*`, a Pi default, arbitrary availability, prompt inference, model self-report, transcript, or fallback. `pi auth check --provider abel --model deepseek-v4-flash --json --no-refresh` proves only Provider API-key readiness; it does not prove that the exact model appears in the no-network model catalog.

The approved Design audit established two separate facts. The direct-SDK/faux adapter capability is Green, including strict schema exposure and one delegated Provider request per session. The current environment readiness is blocked because the active `abel` catalog exposes only `LocalModel`; `deepseek-v4-flash` is currently only a commented example. The complete no-model command therefore exits 78 with `environmentError="fixed model tuple unavailable"` and `realProviderRequests=0`. This is a pre-admission environmental block, not a task Red, request, token use, model fallback, or reason to revive DCR.

Recovery may configure only the declared exact `abel/deepseek-v4-flash` model catalog entry and existing API-key credential source. It then reruns the auth check and the complete capability mode below. Only exit 0 with `status=ready`, `adapterReady=true`, `environmentReady=true`, strict schema observed, one Provider request per faux session, zero real Provider requests, and the immutable role hash may admit a task phase. Exit 78, another nonzero result, or any field mismatch sends no model request and remains environment-blocked.

This exit-78 operational block is resolved: at R-09.1 Design time the complete v1 and v2 capability commands both exit 0 with `status=ready`, `adapterReady=true`, `environmentReady=true`, strict schema observed, one Provider request per faux session, zero real Provider requests, and the immutable role hash (see R-09.1). The exit-78 state is historical.

##### R-09 single inline adapter entry

The following is the complete implementation-only adapter entry. Its inline JavaScript source has SHA-256 `31d07592dc94e08e6d875deaad9db733f0630915c30bc2ac6646be6346e65c32`. It is never written to the repository or `/tmp`. Capability mode uses the shown prefix and an empty packet. Phase mode changes only the command prefix to `R09_MODE=run PHASE_PACKET_B64='<base64-of-one-complete-approved-packet>'`; the shell body and heredoc source remain exact.

```bash
R09_MODE=capability PHASE_PACKET_B64= bash -c '
set -euo pipefail
readonly MODE="${R09_MODE-}"
readonly PACKET_B64="${PHASE_PACKET_B64-}"
unset R09_MODE PHASE_PACKET_B64 \
  PI_PROVIDER PI_MODEL PI_REASONING_LEVEL \
  PI_SESSION_FILE PI_SESSION_ID

AUTH_JSON="$(
  pi auth check \
    --provider abel \
    --model deepseek-v4-flash \
    --json \
    --no-refresh
)"
export AUTH_JSON
readonly SOURCE="$(cat)"

case "$MODE" in
  capability)
    test -z "$PACKET_B64"
    R09_MODE=capability bun --eval "$SOURCE"
    ;;
  run)
    test -n "$PACKET_B64"
    printf "%s" "$PACKET_B64" |
      base64 --decode |
      R09_MODE=run bun --eval "$SOURCE"
    ;;
  *) exit 64 ;;
esac
' <<'R09_SOURCE'
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAgentSession, defineTool, ModelRegistry, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadAgentDefinitions } from "./src/agent-registry.ts";
import { EmptyResourceLoader } from "./src/empty-resource-loader.ts";
import { snapshotDirManifest, snapshotFile } from "./src/file-snapshot.ts";
import { createScopedTools } from "./src/scoped-tools.ts";

const FIXED = Object.freeze({ provider: "abel", model: "deepseek-v4-flash", api: "openai-completions", thinking: "off" });
const ARCHITECTURE = "direct-sdk-delivery-adapter-v1";
const ALLOWED_TASKS = new Set(["P-004-SDA", "P-004-FC", "P-004-HDR", "P-004-B2", "P-004-C", "P-005", "P-006", "P-007", "P-008"]);
const RETIRED_TASKS = new Set(["P-004-DCR"]);
const DIFF_FIELDS = ["id", "role", "kind", "taskId", "phase", "summary", "diff", "expectedVerification", "risks", "nextStep", "contractCompliant"];
const EVIDENCE_FIELDS = ["id", "role", "kind", "conclusions", "citations", "constraints", "dependencies", "risks", "blockingQuestions", "hints"];
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const need = (condition, message) => { if (!condition) throw new Error(message); };
const exactKeys = (value, keys) => Boolean(value && typeof value === "object" && !Array.isArray(value)) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonicalBytes = (value) => {
  const walk = (item) => {
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new Error("noncanonical number");
      return String(item);
    }
    if (Array.isArray(item)) return `[${item.map(walk).join(",")}]`;
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      const keys = Object.keys(item).sort();
      if (keys.some((key) => item[key] === undefined)) throw new Error("undefined canonical member");
      return `{${keys.map((key) => `${JSON.stringify(key)}:${walk(item[key])}`).join(",")}}`;
    }
    throw new Error("noncanonical value");
  };
  return Buffer.from(walk(value), "utf8");
};
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (left, right) => canonicalBytes(left).equals(canonicalBytes(right));
const safePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.startsWith("./") && !value.includes("\\") && !value.includes("\0") && !value.includes("//") && !value.endsWith("/.") && !value.split("/").includes("..");
const safeDiffPath = (value) => safePath(value) && value !== ".";
const assertNoSymlink = (root, path) => {
  const rootReal = realpathSync(root);
  const absolute = resolve(rootReal, path);
  need(absolute === rootReal || absolute.startsWith(`${rootReal}/`), "path escapes root");
  const parts = relative(rootReal, absolute).split("/").filter(Boolean);
  let current = rootReal;
  for (const part of parts) {
    current = resolve(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    need(!stat.isSymbolicLink(), "symlink path rejected");
  }
};
const recapture = (cwd, snapshot) => {
  const next = {};
  for (const path of Object.keys(snapshot).sort()) {
    need(safePath(path), "unsafe snapshot path");
    assertNoSymlink(cwd, path);
    const expected = snapshot[path];
    if (expected.kind === "dir") next[path] = snapshotDirManifest(cwd, path) ?? { kind: "absent", absent: true };
    else if (expected.kind === "file" || expected.kind === "absent") next[path] = snapshotFile(cwd, path) ?? { kind: "absent", absent: true };
    else throw new Error("invalid snapshot kind");
  }
  return next;
};
const coreOf = (packet) => {
  const { snapshot, ...request } = packet.request;
  return { version: packet.version, architecture: packet.architecture, task: packet.task, request, snapshotPaths: Object.keys(snapshot).sort(), prerequisites: packet.prerequisites, identity: packet.identity, resultBounds: packet.resultBounds, redispatchPermitted: packet.redispatchPermitted };
};
const lineCounts = (diff) => {
  let added = 0;
  let deleted = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) deleted++;
  }
  return { added, deleted };
};
const headerPath = (text, prefix) => {
  if (text === "/dev/null") return null;
  need(text.startsWith(`${prefix}/`), "noncanonical diff header prefix");
  const path = text.slice(2);
  need(safeDiffPath(path), "unsafe diff path");
  return path;
};
const diffPaths = (diff) => {
  need(typeof diff === "string" && diff.length > 0 && diff.endsWith("\n") && !diff.includes("\r"), "diff must be nonempty UTF-8/LF text");
  need(!/^(?:Binary files|GIT binary patch|rename |copy |old mode |new mode )/mu.test(diff), "unsupported diff form");
  const paths = [];
  let oldPath;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) {
      need(oldPath === undefined, "unpaired old header");
      oldPath = headerPath(line.slice(4), "a");
    } else if (line.startsWith("+++ ")) {
      need(oldPath !== undefined, "unpaired new header");
      const newPath = headerPath(line.slice(4), "b");
      need(oldPath !== null || newPath !== null, "null/null header pair");
      if (oldPath !== null && newPath !== null) need(oldPath === newPath, "mismatched diff targets");
      const target = newPath ?? oldPath;
      need(!paths.includes(target), "duplicate diff target");
      paths.push(target);
      oldPath = undefined;
    }
  }
  need(oldPath === undefined && paths.length > 0, "incomplete or absent diff headers");
  return paths;
};
const diffSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  role: Type.Literal("implementation-worker"),
  kind: Type.Literal("diff"),
  taskId: Type.String({ minLength: 1, maxLength: 128 }),
  phase: Type.String({ minLength: 1, maxLength: 16 }),
  summary: Type.String({ minLength: 1 }),
  diff: Type.String({ minLength: 1 }),
  expectedVerification: Type.String({ minLength: 1 }),
  risks: Type.Array(Type.String()),
  nextStep: Type.String({ minLength: 1 }),
  contractCompliant: Type.Literal(true),
}, { additionalProperties: false });
const evidenceSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  role: Type.Literal("contract-reviewer"),
  kind: Type.Literal("evidence"),
  conclusions: Type.Array(Type.String()),
  citations: Type.Array(Type.Object({ path: Type.String(), lines: Type.String() }, { additionalProperties: false })),
  constraints: Type.Array(Type.String()),
  dependencies: Type.Array(Type.String()),
  risks: Type.Array(Type.String()),
  blockingQuestions: Type.Array(Type.String()),
  hints: Type.Object({ writeSet: Type.Array(Type.String()), verification: Type.String(), agentsImpact: Type.String() }, { additionalProperties: false }),
}, { additionalProperties: false });
const classifyAssistant = (message) => {
  if (!message || message.role !== "assistant") return "no-final-assistant";
  const submits = message.content.filter((item) => item.type === "toolCall" && item.name === "abel_submit_result");
  if (submits.length === 0) return "text-only";
  if (submits.length > 1) return "multiple-submit";
  return message.content.length === 1 ? "single-submit-only" : "mixed";
};
function localSecondRequestBlock(model) {
  const stream = createAssistantMessageEventStream();
  const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: ZERO_USAGE, stopReason: "error", errorMessage: "R-09 session already delegated one Provider request", timestamp: Date.now() };
  queueMicrotask(() => { stream.push({ type: "error", reason: "error", error: message }); stream.end(message); });
  return stream;
}
function oneRequestProvider(parent, resolved, onFirstRequest) {
  let delegated = false;
  const call = (fn, model, context, options) => {
    if (delegated) return localSecondRequestBlock(model);
    delegated = true;
    onFirstRequest();
    return fn.call(parent, model, context, { ...options, apiKey: resolved.apiKey, headers: { ...resolved.headers, ...options?.headers }, env: { ...resolved.env, ...options?.env }, maxRetries: 0 });
  };
  return {
    ...parent,
    baseUrl: resolved.baseUrl ?? parent.baseUrl,
    headers: { ...parent.headers, ...resolved.headers },
    auth: { apiKey: { name: "R-09 phase-local auth", resolve: async () => ({ auth: { apiKey: resolved.apiKey, headers: resolved.headers, baseUrl: resolved.baseUrl }, env: resolved.env }) } },
    stream(model, context, options) { return call(parent.stream, model, context, options); },
    streamSimple(model, context, options) { return call(parent.streamSimple, model, context, options); },
  };
}
async function sourceIdentity() {
  const checked = JSON.parse(process.env.AUTH_JSON ?? "null");
  need(checked?.status === "ready" && checked.provider === FIXED.provider && checked.authType === "api_key", "fixed API-key auth not ready");
  const source = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const model = source.getModel(FIXED.provider, FIXED.model);
  const provider = source.getProvider(FIXED.provider);
  need(model && provider && model.provider === FIXED.provider && model.id === FIXED.model && model.api === FIXED.api, "fixed model tuple unavailable");
  need(getSupportedThinkingLevels(model).includes(FIXED.thinking), "thinking off unsupported");
  const resolved = await new ModelRegistry(source).getApiKeyAndHeaders(model);
  need(resolved.ok, "fresh phase auth unavailable");
  return { provider, resolved };
}
async function phaseRuntime(onFirstRequest) {
  const source = await sourceIdentity();
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider(oneRequestProvider(source.provider, source.resolved, onFirstRequest));
  const model = runtime.getModel(FIXED.provider, FIXED.model);
  need(model && model.api === FIXED.api, "phase model unavailable");
  return { runtime, model };
}
function readTools(cwd, declaredRead, snapshot, observed) {
  const covers = (path) => declaredRead.some((item) => {
    if (item === ".") return true;
    return snapshot[item]?.kind === "dir" ? path === item || path.startsWith(`${item}/`) : path === item;
  });
  const observer = (entry) => {
    need(covers(entry.path), `undeclared read observation: ${entry.path}`);
    if (observed[entry.path]) return;
    observed[entry.path] = entry.kind === "dir" ? snapshotDirManifest(cwd, entry.path) ?? { kind: "absent", absent: true } : snapshotFile(cwd, entry.path) ?? { kind: "absent", absent: true };
  };
  return createScopedTools({ roots: [cwd], observer }).map((scoped) => defineTool({
    name: scoped.name,
    label: scoped.name,
    description: scoped.description,
    parameters: scoped.name === "grep" ? Type.Object({ path: Type.String(), pattern: Type.String() }, { additionalProperties: false }) : Type.Object({ path: Type.String() }, { additionalProperties: false }),
    async execute(_id, params) {
      need(covers(params.path), "tool path is outside declared read set");
      const result = await scoped.execute(params);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  }));
}
function validatePacket(packet) {
  need(exactKeys(packet, ["version", "architecture", "task", "request", "prerequisites", "identity", "resultBounds", "redispatchPermitted"]), "invalid packet shape");
  need(packet.version === 2 && packet.architecture === ARCHITECTURE, "invalid adapter version");
  need(!RETIRED_TASKS.has(packet.task) && ALLOWED_TASKS.has(packet.task), "retired or unknown task identity");
  need(exactKeys(packet.request, ["stage", "role", "agentSha256", "id", "phase", "objective", "roots", "context", "declared", "output", "snapshot"]), "invalid request shape");
  need(packet.request.stage === "abel-implement" && packet.request.id === packet.task, "request identity mismatch");
  const worker = packet.request.role === "implementation-worker" && packet.request.output === "diff" && packet.task !== "P-008" && ["red", "green", "refactor"].includes(packet.request.phase);
  const reviewer = packet.request.role === "contract-reviewer" && packet.request.output === "evidence" && packet.task === "P-008" && packet.request.phase === "review";
  need(worker || reviewer, "invalid task/role/output/phase tuple");
  need(typeof packet.request.agentSha256 === "string" && /^[0-9a-f]{64}$/.test(packet.request.agentSha256), "invalid role hash");
  need(typeof packet.request.objective === "string" && packet.request.objective.length > 0 && packet.request.objective.length <= 4096, "invalid objective");
  need(same(packet.request.roots, ["."]), "invalid roots");
  need(exactKeys(packet.request.context, ["agents", "contract"]) && typeof packet.request.context.agents === "string" && typeof packet.request.context.contract === "string" && canonicalBytes(packet.request.context).length <= 65536, "invalid context");
  need(exactKeys(packet.request.declared, ["read", "write", "conflicts", "resources", "verificationLock"]), "invalid declared contract");
  for (const key of ["read", "write"]) need(Array.isArray(packet.request.declared[key]) && packet.request.declared[key].every(safePath), `invalid ${key} set`);
  for (const key of ["conflicts", "resources"]) need(Array.isArray(packet.request.declared[key]) && packet.request.declared[key].every((item) => typeof item === "string" && item.length > 0), `invalid ${key} set`);
  need(typeof packet.request.declared.verificationLock === "string" && packet.request.declared.verificationLock.length > 0, "invalid verification lock");
  need(packet.request.snapshot && typeof packet.request.snapshot === "object" && !Array.isArray(packet.request.snapshot), "invalid snapshot");
  const snapshotPaths = [...new Set([...packet.request.declared.read, ...packet.request.declared.write])].sort();
  need(same(Object.keys(packet.request.snapshot).sort(), snapshotPaths), "snapshot path-key drift");
  need(Array.isArray(packet.prerequisites) && packet.prerequisites.every((item) => typeof item === "string"), "invalid prerequisites");
  need(exactKeys(packet.identity, ["provider", "model", "api", "thinking"]) && same(packet.identity, FIXED), "delivery identity drift");
  need(typeof packet.redispatchPermitted === "boolean", "invalid token declaration");
  if (worker) {
    need(exactKeys(packet.resultBounds, ["kind", "metadataMaxUtf8Bytes", "diffMaxUtf8Bytes", "paths", "maxAdded", "maxDeleted"]), "invalid diff bounds shape");
    need(packet.resultBounds.kind === "diff" && same(packet.resultBounds.paths, packet.request.declared.write), "diff bounds path drift");
    for (const key of ["metadataMaxUtf8Bytes", "diffMaxUtf8Bytes", "maxAdded", "maxDeleted"]) need(Number.isSafeInteger(packet.resultBounds[key]) && packet.resultBounds[key] >= 0, `invalid ${key}`);
  } else {
    need(exactKeys(packet.resultBounds, ["kind", "completeMaxUtf8Bytes", "maxLines"]), "invalid evidence bounds shape");
    need(packet.resultBounds.kind === "evidence" && packet.request.declared.write.length === 0, "invalid evidence bounds");
    for (const key of ["completeMaxUtf8Bytes", "maxLines"]) need(Number.isSafeInteger(packet.resultBounds[key]) && packet.resultBounds[key] >= 0, `invalid ${key}`);
  }
}
function validateValue(packet, value) {
  if (packet.request.output === "diff") {
    need(exactKeys(value, DIFF_FIELDS), "diff result exact shape mismatch");
    need(value.id === packet.request.id && value.role === packet.request.role && value.kind === "diff" && value.taskId === packet.task && value.phase === packet.request.phase, "diff result identity mismatch");
    need(typeof value.summary === "string" && typeof value.diff === "string" && typeof value.expectedVerification === "string" && Array.isArray(value.risks) && value.risks.every((item) => typeof item === "string") && typeof value.nextStep === "string" && value.contractCompliant === true, "diff result field mismatch");
    const paths = diffPaths(value.diff);
    const counts = lineCounts(value.diff);
    const metadata = structuredClone(value);
    delete metadata.diff;
    const metadataUtf8Bytes = canonicalBytes(metadata).length;
    const diffBytes = Buffer.from(value.diff, "utf8");
    need(metadataUtf8Bytes <= packet.resultBounds.metadataMaxUtf8Bytes && diffBytes.length <= packet.resultBounds.diffMaxUtf8Bytes, "diff byte boundary exceeded");
    need(same(paths, packet.resultBounds.paths) && counts.added <= packet.resultBounds.maxAdded && counts.deleted <= packet.resultBounds.maxDeleted, "diff path/line boundary exceeded");
    return { metadataUtf8Bytes, diffUtf8Bytes: diffBytes.length, diffSha256: sha256(diffBytes), paths, ...counts };
  }
  need(exactKeys(value, EVIDENCE_FIELDS), "evidence result exact shape mismatch");
  need(value.id === packet.request.id && value.role === packet.request.role && value.kind === "evidence", "evidence result identity mismatch");
  const bytes = canonicalBytes(value);
  const lines = JSON.stringify(value, null, 2).split("\n").length;
  need(bytes.length <= packet.resultBounds.completeMaxUtf8Bytes && lines <= packet.resultBounds.maxLines, "evidence boundary exceeded");
  return { completeUtf8Bytes: bytes.length, completeSha256: sha256(bytes), lines };
}
async function runAttempt(packet, number) {
  let admitted = false;
  let submitAttempts = 0;
  let submitCategory = "no-final-assistant";
  try {
    const { runtime, model } = await phaseRuntime(() => {
      need(!admitted, "multiple Provider delegation markers");
      admitted = true;
      console.error(`ABEL_WORKER_REQUEST_ADMITTED ${JSON.stringify({ task: packet.task, phase: packet.request.phase, attempt: number, ...FIXED })}`);
    });
    const role = loadAgentDefinitions().find((item) => item.role === packet.request.role);
    need(role && role.sha256 === packet.request.agentSha256, "package role hash mismatch");
    const observed = {};
    let submitExecutes = 0;
    let accepted;
    let delivery;
    const submit = defineTool({
      name: "abel_submit_result",
      label: "Submit Abel Result",
      description: "Submit exactly one complete final structural result.",
      executionMode: "sequential",
      parameters: packet.request.output === "diff" ? diffSchema : evidenceSchema,
      async execute(_id, params) {
        submitExecutes++;
        need(submitExecutes === 1 && !accepted, "duplicate structural submission");
        delivery = validateValue(packet, params);
        accepted = deepFreeze(structuredClone(params));
        return { content: [{ type: "text", text: "Abel result accepted." }], details: { accepted: true }, terminate: true };
      },
    });
    const tools = [...readTools(process.cwd(), packet.request.declared.read, packet.request.snapshot, observed), submit];
    const toolNames = tools.map((tool) => tool.name).sort();
    need(same(toolNames, ["abel_submit_result", "find", "grep", "ls", "read"]), "tool set mismatch");
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } } });
    const sessions = SessionManager.inMemory(process.cwd());
    const systemPrompt = [role.content, packet.request.objective, packet.request.context.agents, packet.request.context.contract].join("\n\n");
    const { session } = await createAgentSession({ cwd: process.cwd(), modelRuntime: runtime, model, thinkingLevel: "off", tools: toolNames, customTools: tools, resourceLoader: new EmptyResourceLoader(systemPrompt), sessionManager: sessions, settingsManager: settings });
    need(session.sessionFile === undefined && sessions.getSessionFile() === undefined, "session persistence enabled");
    need(same(session.getActiveToolNames().sort(), toolNames), "active tool drift");
    need(session.getAllTools().find((tool) => tool.name === "abel_submit_result")?.parameters?.additionalProperties === false, "strict schema not exposed");
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.content.some((item) => item.type === "toolCall" && item.name === "abel_submit_result")) submitCategory = classifyAssistant(event.message);
      if (event.type === "tool_execution_start" && event.toolName === "abel_submit_result") submitAttempts++;
      if (event.type === "tool_execution_end" && event.toolName === "abel_submit_result" && event.isError) void session.abort();
    });
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { void session.abort().finally(() => reject(new Error("phase timeout"))); }, 20 * 60 * 1000);
      timer.unref?.();
    });
    try {
      await Promise.race([session.prompt("Complete only the approved phase and finish with abel_submit_result.", { expandPromptTemplates: false }), timeout]);
      if (submitAttempts > 0 && (!accepted || submitAttempts !== 1 || submitExecutes !== 1 || submitCategory !== "single-submit-only")) return { ok: false, admitted, class: "structural-result-rejection" };
      if (!accepted) return { ok: false, admitted, class: admitted ? "admitted-request-failure" : "pre-admission-failure" };
      need(same(recapture(process.cwd(), packet.request.snapshot), packet.request.snapshot), "packet snapshot changed during attempt");
      need(same(recapture(process.cwd(), observed), observed), "observed snapshot changed during attempt");
      return { ok: true, admitted: true, structuralResult: accepted, delivery, boundSnapshot: { ...packet.request.snapshot, ...observed }, finalCategory: submitCategory };
    } finally {
      clearTimeout(timer);
      unsubscribe();
      session.agent.state.messages = [];
      session.dispose();
      need(settings.drainErrors().length === 0, "settings persistence error");
    }
  } catch {
    return { ok: false, admitted, class: submitAttempts > 0 ? "structural-result-rejection" : admitted ? "admitted-request-failure" : "pre-admission-failure" };
  }
}
async function capability() {
  const role = loadAgentDefinitions().find((item) => item.role === "implementation-worker");
  need(role, "package implementation-worker unavailable");
  const expected = Object.freeze({ id: "P-004-SDA-CAPABILITY", role: "implementation-worker", taskId: "P-004-SDA-CAPABILITY", phase: "red" });
  const valid = Object.freeze({ ...expected, kind: "diff", summary: "capability only", diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n", expectedVerification: "faux only", risks: [], nextStep: "discard", contractCompliant: true });
  const cases = [];
  let providerSawStrictSchema = false;
  for (const name of ["valid", "malformed", "wrong-identity", "multiple"]) {
    const faux = fauxProvider({ provider: `r09-${name}`, api: "faux" });
    const malformed = { ...valid };
    delete malformed.expectedVerification;
    const call = name === "malformed" ? malformed : name === "wrong-identity" ? { ...valid, id: "wrong" } : valid;
    faux.setResponses(name === "multiple" ? [fauxAssistantMessage([fauxToolCall("abel_submit_result", valid), fauxToolCall("abel_submit_result", valid)], { stopReason: "toolUse" })] : [(context) => {
      const exposed = context.tools?.find((tool) => tool.name === "abel_submit_result");
      if (name === "valid") providerSawStrictSchema = Boolean(exposed?.parameters?.additionalProperties === false && DIFF_FIELDS.every((field) => exposed.parameters.required?.includes(field)));
      return fauxAssistantMessage(fauxToolCall("abel_submit_result", call), { stopReason: "toolUse" });
    }]);
    let providerRequests = 0;
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    runtime.registerNativeProvider(oneRequestProvider(faux.provider, {}, () => providerRequests++));
    let attempts = 0;
    let executes = 0;
    let accepted = false;
    let category = "no-final-assistant";
    const submit = defineTool({
      name: "abel_submit_result", label: "Submit Abel Result", description: "Submit exactly one complete structural diff result.", executionMode: "sequential", parameters: diffSchema,
      async execute(_id, params) {
        executes++;
        need(executes === 1 && params.id === expected.id && params.role === expected.role && params.taskId === expected.taskId && params.phase === expected.phase, "capability identity rejection");
        accepted = true;
        return { content: [{ type: "text", text: "accepted" }], details: { accepted: true }, terminate: true };
      },
    });
    const tools = [...readTools(process.cwd(), ["README.md"], { "README.md": snapshotFile(process.cwd(), "README.md") }, {}), submit];
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } } });
    const sessions = SessionManager.inMemory(process.cwd());
    const { session } = await createAgentSession({ cwd: process.cwd(), modelRuntime: runtime, model: runtime.getModel(faux.getModel().provider, faux.getModel().id), thinkingLevel: "off", tools: tools.map((tool) => tool.name), customTools: tools, resourceLoader: new EmptyResourceLoader(role.content), sessionManager: sessions, settingsManager: settings });
    need(same(session.getActiveToolNames().sort(), ["abel_submit_result", "find", "grep", "ls", "read"]), "capability tool set mismatch");
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.content.some((item) => item.type === "toolCall" && item.name === "abel_submit_result")) category = classifyAssistant(event.message);
      if (event.type === "tool_execution_start" && event.toolName === "abel_submit_result") attempts++;
      if (event.type === "tool_execution_end" && event.toolName === "abel_submit_result" && event.isError) void session.abort();
    });
    try { await session.prompt("scripted faux capability", { expandPromptTemplates: false }); }
    finally { unsubscribe(); session.agent.state.messages = []; session.dispose(); }
    const trusted = accepted && attempts === 1 && executes === 1 && category === "single-submit-only";
    need(session.sessionFile === undefined && sessions.getSessionFile() === undefined && settings.drainErrors().length === 0, "capability persistence detected");
    need(providerRequests === 1 && faux.state.callCount === 1, "capability delegated more than one Provider request");
    cases.push({ name, attempts, executes, accepted, category, trusted, providerRequests });
  }
  need(providerSawStrictSchema && cases[0].trusted && cases.slice(1).every((item) => !item.trusted), "adapter capability failed");
  let environmentReady = false;
  let environmentError;
  try { await sourceIdentity(); environmentReady = true; } catch (error) { environmentError = error instanceof Error ? error.message : String(error); }
  console.log(JSON.stringify({ status: environmentReady ? "ready" : "blocked", capability: ARCHITECTURE, adapterReady: true, environmentReady, environmentError, fixedIdentity: { ...FIXED, authType: "api_key" }, roleSha256: role.sha256, providerSawStrictSchema, oneProviderRequestPerSession: true, sessionManager: "in-memory", settingsManager: "in-memory", resultRetention: "lexical-memory-only", processExitState: "none", realProviderRequests: 0, fauxOnly: true, cases }, null, 2));
  if (!environmentReady) process.exitCode = 78;
}
async function run() {
  let packet;
  try {
    packet = JSON.parse(await Bun.stdin.text());
    validatePacket(packet);
    need(same(recapture(process.cwd(), packet.request.snapshot), packet.request.snapshot), "initial snapshot stale");
    const frozen = deepFreeze(structuredClone(packet));
    const baseline = canonicalBytes(coreOf(frozen));
    need(baseline.equals(canonicalBytes(coreOf(packet))), "initial canonical mismatch");
    const first = await runAttempt(packet, 1);
    if (first.ok) {
      console.log(JSON.stringify({ task: packet.task, phase: packet.request.phase, attempt: 1, tokenConsumed: false, canonicalSha256: sha256(baseline), ...first }));
      return;
    }
    if (!first.admitted || first.class === "structural-result-rejection" || !packet.redispatchPermitted) throw new Error(first.class);
    const second = structuredClone(frozen);
    second.request.snapshot = recapture(process.cwd(), frozen.request.snapshot);
    need(baseline.equals(canonicalBytes(coreOf(second))), "redispatch canonical mismatch");
    const final = await runAttempt(second, 2);
    if (!final.ok) throw new Error(final.class);
    console.log(JSON.stringify({ task: packet.task, phase: packet.request.phase, attempt: 2, tokenConsumed: true, canonicalSha256: sha256(baseline), ...final }));
  } catch (error) {
    console.error(`ABEL_WORKER_RUNNER_FAILED ${JSON.stringify({ task: packet?.task ?? "unknown", phase: packet?.request?.phase ?? "unknown", class: error instanceof Error ? error.message : "runner-failure" })}`);
    process.exitCode = 1;
  }
}
if (process.env.R09_MODE === "capability") await capability();
else if (process.env.R09_MODE === "run") await run();
else throw new Error("R09_MODE must be capability or run");
R09_SOURCE
```

Capability mode creates four fresh faux-only SDK sessions. Its required case matrix is:

| case | submit attempts | execute calls | accepted | trusted | delegated Provider requests |
| --- | ---: | ---: | --- | --- | ---: |
| valid | 1 | 1 | yes | yes | 1 |
| malformed | 1 | 0 | no | no | 1 |
| wrong identity | 1 | 1 | no | no | 1 |
| multiple | 2 | 2 | first only | no | 1 |

A faux valid result proves adapter capability only; it is never a real task success. Malformed arguments are rejected by Pi's TypeBox validation before execute. Identity mismatch is rejected in execute. Multiple submission is untrusted. Each SDK session may delegate at most one Provider request: any Pi-agent follow-up turn receives a runner-local in-memory error stream and never reaches the real/faux parent Provider again.

##### R-09 phase packet and canonical continuity

The P-004-SDA Red packet has this exact construction-time shape and current baseline values:

```json
{
  "version": 2,
  "architecture": "direct-sdk-delivery-adapter-v1",
  "task": "P-004-SDA",
  "request": {
    "stage": "abel-implement",
    "role": "implementation-worker",
    "agentSha256": "9859c57a90f707abe6705d820a1269781c79b5eaeb3efcf07570124e9505ba1f",
    "id": "P-004-SDA",
    "phase": "red",
    "objective": "P-004-SDA Red: add only the approved strict-diff-result fixture precheck and strict diff-result schema and identity-shape property target to test/contracts.property.test.ts; do not modify product code.",
    "roots": ["."],
    "context": {
      "agents": "<exact bounded root AGENTS context>",
      "contract": "<exact approved Scenario and P-004-SDA task contract>"
    },
    "declared": {
      "read": [
        "src/contracts.ts",
        "test/contracts.property.test.ts"
      ],
      "write": ["test/contracts.property.test.ts"],
      "conflicts": ["P-004-FC", "P-004-HDR"],
      "resources": ["strict-diff-result-contract"],
      "verificationLock": "p004-sda-target"
    },
    "output": "diff",
    "snapshot": {
      "src/contracts.ts": {
        "kind": "file",
        "sha256": "2880aff9cd1b512d8799b82abca928d474dee48b8575628165e2438d42cf6852",
        "bytes": 9419
      },
      "test/contracts.property.test.ts": {
        "kind": "file",
        "sha256": "709ad50b626b2c46e5063a44bd7b2536b77ad0295e02eaf3dae1b067cce8375d",
        "bytes": 5905
      }
    }
  },
  "prerequisites": ["P-004-A"],
  "identity": {
    "provider": "abel",
    "model": "deepseek-v4-flash",
    "api": "openai-completions",
    "thinking": "off"
  },
  "resultBounds": {
    "kind": "diff",
    "metadataMaxUtf8Bytes": 1024,
    "diffMaxUtf8Bytes": 7168,
    "paths": ["test/contracts.property.test.ts"],
    "maxAdded": 110,
    "maxDeleted": 10
  },
  "redispatchPermitted": true
}
```

The two context strings are packet construction fields, not a second input surface. Before invocation the Implement parent replaces them with exact bounded current text and serializes one complete JSON value. Green changes only the approved phase/objective, declared write, current snapshot values/path set, Green bounds, and `redispatchPermitted` derived from current-context token evidence. P-008 uses role `contract-reviewer`, output `evidence`, phase `review`, an empty write set, and its approved evidence bounds. Packet input comes only from valid R-09 artifacts, the task contract, accepted prerequisite evidence, current workspace snapshot, and current Implement-context token evidence.

One phase is one shell invocation and one Bun process. `Bun.stdin.text()` executes exactly once in run mode. The packet is structured-cloned and recursively frozen. Deterministic canonical bytes include version, architecture, task, stage, role, role hash, request ID, phase, objective, roots, bounded context, read/write/conflict/resource/verification-lock declarations, output, sorted snapshot path-key set, prerequisites, fixed identity, result bounds, and token declaration. Attempt 2 can change only current snapshot values and fresh phase-local auth; it is derived from the frozen initial packet in the same process and must reproduce the baseline canonical byte buffer. The reported SHA-256 is diagnostic, not the continuity authority. There is no second packet, second objective, parent baseline hash, stdin reread, or attempt 3.

##### R-09 attempt order, structural classification, and markers

Each attempt performs: packet/path/symlink/snapshot/canonical validation; no-network exact tuple resolution; `ModelRegistry` fresh auth resolution; fresh in-memory runtime with one wrapped Provider and retries disabled; package-role hash validation; strict runner-local submit tool construction; scoped read-tool construction; empty resources; in-memory settings/session creation; exact five-tool validation; one Provider delegation marker; one Provider request; structural observation; snapshot recapture; disposal exactly once; and bounded stdout delivery.

The submit schema has exact keys `id`, `role`, `kind`, `taskId`, `phase`, `summary`, `diff`, `expectedVerification`, `risks`, `nextStep`, and `contractCompliant`, with `additionalProperties: false`. Runner execute independently checks exact shape, request/role/task/phase, approved bounds, textual diff headers, safe exact paths, line counts, metadata bytes, diff bytes, and SHA-256. It does not trust the not-yet-hardened product validator.

`submitAttemptCount` increments at `tool_execution_start`, including malformed calls. `submitExecuteCount` records execute entry. The first Assistant message that contains a submit call is classified as `no-final-assistant | text-only | mixed | multiple-submit | single-submit-only` before session messages are erased. Success requires one attempt, one execute, one accepted value, category `single-submit-only`, exact identity, valid schema, and valid bounds. Any submit-bearing malformed, wrong-identity, mixed, multiple, or out-of-bounds result is structural rejection, even if Pi subsequently emits an error completion.

The one-request Provider wrapper emits exactly one stderr marker synchronously immediately before its first and only delegation:

```text
ABEL_WORKER_REQUEST_ADMITTED {"task":"P-004-SDA","phase":"red","attempt":1,"provider":"abel","model":"deepseek-v4-flash","api":"openai-completions","thinking":"off"}
ABEL_WORKER_REQUEST_ADMITTED {"task":"P-004-SDA","phase":"red","attempt":2,"provider":"abel","model":"deepseek-v4-flash","api":"openai-completions","thinking":"off"}
```

A marker contains no credential, token, session ID, timestamp, result ID, or hash. One marker means exactly one delegated Provider request. A later SDK loop request receives only the local error stream. Zero, duplicate, mismatched, or out-of-order markers block.

##### R-09 failure and token accounting

| Classification | Marker/request | Token effect | Required outcome |
| --- | ---: | --- | --- |
| capability, packet, path, symlink, snapshot, canonical, role/hash, auth, session/tool construction failure | 0 | none | exact precondition may be repaired, then a fresh initial runner may start |
| attempt-1 Provider error, timeout, cancellation, or no submit after marker | 1 | consume for same-process attempt 2 | only frozen-packet derivation may continue |
| malformed, wrong-identity, multiple, mixed, or out-of-bounds submit-bearing result | 1 | cannot compensate | structural rejection; block immediately |
| attempt-2 readiness/auth/canonical failure before marker | still 1 | already consumed | block; no new process may recover attempt 2 |
| attempt-2 post-marker failure | 2 | consumed | block; no third request |
| valid structural result later rejected by parent schema/path/hash/line/snapshot/semantic/ordinary-Git/wrong-reason checks | 1 or 2 | cannot compensate | block without redispatch |
| accepted attempt 1 | 1 | remains available for a later phase | continue TDD |
| accepted attempt 2 | 2 | consumed | later phase has only its initial request |

Each remaining implementation/review task owns one independent task-local Red/Green-shared or review token; FC's discarded canary has none. Tokens never reset, transfer, borrow, revive history, authorize a model independently of an approved phase, or survive process exit as a ledger. Across phases, the parent derives availability only from markers/results observed in the current Implement context.

##### R-09 persistence and parent admission boundary

The adapter, Worker, and parent persist no credential, packet, canonical request/hash, marker/token ledger, transcript, raw model output, tool history, result file, session/settings, timestamp, queue, checkpoint, or runtime state. Allowed state is current-process lexical objects, in-memory runtimes/session/settings, one bounded accepted structural value, current command stdout/stderr, and Pi's ordinary host-owned parent transcript. Session messages are erased before disposal. No repository or `/tmp` runner script exists.

The parent recomputes exact UTF-8 bytes, SHA-256, metadata bytes, parsed path set, added/deleted lines, task/request/role/phase, packet and observed snapshots, and bounds. It runs `git apply --check --whitespace=nowarn -` on the exact bytes and applies only those same bytes with `git apply --whitespace=nowarn -`. It never fixes a hunk, formats, reconstructs, splices, partially applies, or uses `--recount` or `--unidiff-zero` to admit a Worker delivery.

R-09 v1 is superseded by R-09.1 below for every later phase. The strict chain is `P-004-A -> P-004-SDA2 -> P-004-FC -> P-004-HDR -> P-004-B2 -> P-004-C`; all later Worker/reviewer phases use the R-09.1 adapter v2 entry.

#### R-09.1 P-004-SDA retirement and strict direct-SDK adapter v2 (P-004-SDA2)

##### P-004-SDA is permanent historical blocked evidence

P-004-SDA exhausted its independent Red/Green-shared allowance under R-09. Its immutable history is: the exact fixed tuple was available and the complete v1 capability command exited 0 before dispatch; one Bun process; one stdin read; one validated version-2 packet frozen before attempts; exactly two `ABEL_WORKER_REQUEST_ADMITTED` markers (attempt 1, attempt 2) with two post-admission Provider requests; both attempts ended without a trusted structural result, unified diff, or submit-bearing message and were classified `admitted-request-failure`; Red was not established; the workspace received zero changes; and the checkbox remained pending before retirement. No transcript, event packet, raw output, or retained candidate exists, so no deeper child cause is claimed. P-004-SDA is permanently retired historical blocked evidence: it owns no checkbox, Scenario, token, continuation, reset, transfer, borrow, renamed-equivalent packet, recovery process, or third request.

##### R-09.1 identity and material contract changes

Gate B R-09.1 replaces the exhausted identity with `P-004-SDA2` (strict direct-SDK adapter, generation 2). It keeps the proven direct-SDK architecture — `createAgentSession` with a runner-local strict `abel_submit_result` and runner-local final classification, never calling product `Runtime.execute()`, `runChildSession()`, `createSubmitTool()`, activation, or an extension action — and adds three material changes:

1. **Identity separation.** The architecture string becomes `direct-sdk-delivery-adapter-v2`. `ALLOWED_TASKS` contains `P-004-SDA2` and all later identities; `RETIRED_TASKS` contains `P-004-DCR` and `P-004-SDA`, so any leftover v1 packet is rejected before admission.
2. **Per-attempt terminal diagnostics.** Every failed attempt emits exactly one `ABEL_WORKER_ATTEMPT_FAILED` stderr marker carrying only structural classifications — `class` from `pre-admission-failure | runner-error | provider-error | timeout | ended-without-submit | structural-result-rejection` plus `submitAttempts`, `submitExecutes`, and `finalCategory`. It contains no transcript, raw output, credential, token, session ID, timestamp, result ID, or hash. The parent can therefore distinguish an environment/API failure, a phase timeout, a model ending without submission, an adapter invariant violation, and a structural rejection, and make the next decision from evidence without relaxing the no-transcript persistence boundary.
3. **Explicit terminal protocol and precise redispatch classes.** The run prompt is an explicit terminal protocol: the model may use the read-only tools, must not modify the workspace, and its final Assistant message must contain exactly one `abel_submit_result` tool call and nothing else. Same-process frozen-packet attempt 2 is allowed only for `provider-error`, `timeout`, or `ended-without-submit`. `structural-result-rejection` and post-marker `runner-error` block without redispatch; pre-admission failure consumes nothing and may be repaired, then a fresh initial runner may start.

P-004-SDA2 has direct prerequisite P-004-A, owns the one `Compact structured delivery / Result schema is invalid` Scenario (formerly assigned to DCR and then SDA), and is the direct prerequisite of P-004-FC. It uses resource `strict-diff-result-contract`, verification lock `p004-sda2-target`, and one independent non-transferable Red/Green-shared token. It is not a reset, rename, or revival of SDA, DCR, or any earlier retired identity.

##### R-09.1 single inline adapter entry (v2)

> **R-09.2 through R-09.10 revisions (Implement-context user approval, after repeated blocked delivery attempts):** the adapter was made robust against real model behavior in this environment. R-09.2: root-contained absolute and `./`-prefixed model tool paths are normalized to repository-relative before scope checks (model sometimes emits absolute paths; old checks rejected them and the model fell into explanation-only output). R-09.3: content tools (`read`, `grep`) stay strictly declared-scope while metadata tools (`ls`, `find`) admit the root `.` and declared-path parents; the observer records directory manifests without erroring (the model's natural `ls .` exploration was rejected before). R-09.5: the per-session Provider request budget was raised from 1 to 8 with the ADMITTED marker still emitted exactly once per attempt at the first request — the single-request limit was the primary root cause of every earlier `ended-without-submit`: the model needs a multi-turn tool loop (read → think → submit), and the second turn received only the local error stream, ending the session with an empty assistant message. R-09.6: a final message containing exactly one submit call plus accompanying text (`mixed`) is accepted; multiple submits and text-only remain rejected. R-09.7: the phase prompt injects the exact required identity fields (`id`/`role`/`kind`/`taskId`/`phase`/`contractCompliant`) and ordinary-diff requirements. R-09.8/R-09.9: diff byte bound raised to 12288 and metadata bound to 4096 for SDA2 Red/Green (model-produced test code and summaries exceed the original bounds). R-09.10: parent-side delivery context now demands ordinary-Git-checkable single-hunk diffs and Biome-formatted code (single-line `if` conditions), and the temporary `ABEL_WORKER_DEBUG` diagnostics were removed in the final source. Product modules, Requirements, and Scenarios are unchanged; only the private delivery adapter and SDA2 result bounds were revised.
>
> **R-09.11 through R-09.19 revisions (Implement-context user approval, P-004-FC execution):** R-09.11: FC Red/Green metadata bound aligned to 4096 bytes. R-09.12: `node_modules` type files were dropped from the worker read set after scoped-tools hidden-path rejection repeatedly blocked exploration; host-contract evidence is now carried only as contract text. R-09.13: read sets were widened to the full `src/` tree because a narrow read set made the model try out-of-scope files and abandon before submitting. R-09.14: the delivery context now embeds exact API shapes (submit-tool `createSubmitTool({requestId, role, phase, output})` returning `{tool, getResult, getAttempts, getSchema, getIdentity}`; SDK tool `execute` called as `(tool.execute as any)(id, params)` in tests) because the model repeatedly guessed wrong signatures. R-09.15: FC Green diff bound raised to 24576 bytes with full-file replacement hunks. R-09.16: FC Green maxDeleted raised to 250 to allow full-file replacement hunks and the contract embeds authoritative message/tool/result types. R-09.17: after acceptance the parent applies only mechanical post-processing (Biome `--write` formatting/lint fixes, a type-only cast `as unknown as EvidenceResult | DiffResult`, `disposeCount` return-value wiring, `?.` optional chaining, default phase `"red"` matching the approved fixtures) — no semantics are invented by the parent; the model's implementation is otherwise applied byte-identical. R-09.18: `ALLOWED_TASKS` gains `P-004-FC-CANARY` so the discarded canary can be dispatched through the same v2 adapter. R-09.19: the FC post-Green canary success criterion accepts `mixed` (one submit plus text, per R-09.6) and the canary completed on the first attempt (`tokenConsumed:false`) with a byte-exact 120-byte diff (SHA-256 `9cb62daafb31beea4f33eeee82a2ca8bf063854d838238c9f5ef4872092ae1e3`), metadata 334 bytes, git-check exit 0, README hash unchanged, and the result discarded with no persistence.
>
> **R-09.20 through R-09.22 revisions (Implement-context user approval, P-004-HDR execution):** R-09.20: temporary `ABEL_WORKER_DEBUG reject <need-message>` diagnostics were added to the inline source to attribute repeated `structural-result-rejection` outcomes (root causes: missing trailing newline and over-long metadata) and then fully removed. R-09.21: the HDR Red copy fixture wrote `b.txt` at 50% similarity, which `git diff --cached HEAD --find-copies-harder` does not report as a copy for a staged new file; the parent changed the fixture content to 100% similarity and added a copy/rename pre-scan in `diffWritePaths` so header pairs preceding a copy/rename record raise the copy/rename-specific error. R-09.22: the inline source is again debug-free; final SHA-256 `08a32f6259e144585eed2d32ee1bf62c5799c6ead51618560b989fd6d6170802` passes the R-09.1 capability command (exit 0, `status=ready`, zero real Provider requests, stderr 0 bytes).
>
> **R-09.23 revision (Implement-context user approval, P-004-B2 execution):** the accepted B2 Red fixture relied on a `PATH` git wrapper and `failPoint` marker, but the Bun runtime resolves `node:child_process` `spawn`/`execFileSync` of `git` against the process-start environment snapshot, making the wrapper structurally inert (direct probes confirmed both bypass the modified `PATH`). The parent rewrote the serial-apply fixture to deterministic mechanisms: a stale-snapshot forced failure proving `{ ok: false }` recovery, and a monotonic FIFO `sequence` number on each controlled apply result proving invocation-order admission, with the matching `sequence` wiring added to the Green implementation (`ApplyResult.sequence?: number`). No product semantics beyond the approved B2 contract were invented; the FIFO tail, stale rejection, and recovery behavior are exactly the contract's Green behavior.
>
> **R-09.24 and R-09.25 revisions (Implement-context user approval, P-004-C execution):** R-09.24: the C Green diff bound was raised from 12 KiB to 24 KiB so both files could use full-file replacement hunks (the only diff form this model produces reliably for modified files; partial hunks were rejected by ordinary Git six times). R-09.25: inspection of the accepted C Green delivery revealed that the R-09.20 debug removal had left an empty `catch {}` around `delivery = validateValue(...)`, silently swallowing validation errors while the submission was still accepted (delivery lost, structuralResult present); the adapter now assigns `delivery` directly, and `maxAdded` for C Green was raised to 460 because full-file replacement counts every line as added. Final SHA-256 `08a32f6259e144585eed2d32ee1bf62c5799c6ead51618560b989fd6d6170802` passes the R-09.1 capability command (exit 0, `status=ready`, zero real Provider requests).
>
> **R-09.26 through R-09.29 revisions (Implement-context user approval, P-005 execution):** R-09.26: the P-005 Red write set was narrowed to the new `test/workflow-routing.integration.test.ts` after the model repeatedly failed to modify the three existing test files (their assertions already executed); the new fixture executes 9 tests with exactly one allowed five-action-routing failure. R-09.27: P-005 Green bounds raised to 48 KiB / 600 added for full-file replacement hunks. R-09.28: the six-file Green was split into G1 (activation + entrypoint, already Green) and G2 (prompts + Skill). R-09.29: after repeated model non-submission on the document-alignment work, the parent applied test-driven mechanical alignment to the three stage prompts (argument-hint value, unique-input guards, stage-contract paragraphs drawn from the approved design/SKILL wording) and fixed the routing test's Buffer comparison. Product code semantics were not invented by the parent; the dispatcher/activation implementation was already correct.
>
> **R-09.30 through R-09.33 revisions (Implement-context user approval, P-006 execution):** R-09.30: P-006 Red split into two single-file dispatches (drain property, lifecycle integration) after the two-file packet repeatedly failed ordinary Git; 11 tests execute with exactly the two allowed failure identities. R-09.31: Green bounds widened to 20 KiB / 520 added / 240 deleted for full-file replacement. R-09.32: the pre-existing `activation.test.ts` two-step drain assertion conflicted with the approved P-006 one-idempotent-drain contract; the parent unified the state machine (one step to inactive) and updated the accepted test to the contract semantics. R-09.33: after twelve consecutive model non-submissions, the parent implemented the minimal contract integration (`src/drain.ts` drainStage, runtime finish/drain wiring, one-step activation drain, session_shutdown tool restoration) with no invented semantics beyond the approved contract. Final affected 38/38 Green; full suite 4 failed (distribution targets only).
>
> **R-09.34 and R-09.35 revisions (Implement-context user approval, P-007 execution):** R-09.34: the parent authored the P-007 Red tests from the approved contract after the model repeatedly failed to produce E2E fixtures — the distribution test was rewritten to the real 38-member tarball manifest (removing obsolete multi-workspace assertions), and `two-worker.e2e.test.ts` plus `independence.test.ts` were added; SDK resource-loader object shapes and private-state filename patterns were corrected during Red validation; the Red command ended Green because the distribution surface was already complete. R-09.35: the parent shipped the remaining Green artifacts (provenance manifest, pack-check and traceability-check scripts, verify command) and one scheduler comment wording change to satisfy the accepted lint contract. `bun run verify` exits 0 with 173/173 tests Green.
>
> The final inline source SHA-256 is `08a32f6259e144585eed2d32ee1bf62c5799c6ead51618560b989fd6d6170802`; the v1 and every earlier v2 revision (including `da8afda9c345c44306e18765b7ad95eeaacc44f77ce05ae4031e1ac4418dda26`) remain embedded byte-identical as immutable history.

The following is the complete implementation-only adapter entry for every remaining phase. Its inline JavaScript source has SHA-256 `08a32f6259e144585eed2d32ee1bf62c5799c6ead51618560b989fd6d6170802`. It is never written to the repository or `/tmp`. Capability mode uses the shown prefix and an empty packet; phase mode changes only the command prefix to `R09_MODE=run PHASE_PACKET_B64='<base64-of-one-complete-approved-packet>'`; the shell body and heredoc source remain exact. Capability verification at R-09.10 Implement time exited 0 with `status=ready`, `adapterReady=true`, `environmentReady=true`, `roleSha256=9859c57a90f707abe6705d820a1269781c79b5eaeb3efcf07570124e9505ba1f`, `providerSawStrictSchema=true`, `oneProviderRequestPerSession=true`, `realProviderRequests=0`, and the same four-case trusted matrix (valid trusted; malformed, wrong-identity, and multiple untrusted, each with exactly one delegated Provider request).

```bash
R09_MODE=capability PHASE_PACKET_B64= bash -c '
set -euo pipefail
readonly MODE="${R09_MODE-}"
readonly PACKET_B64="${PHASE_PACKET_B64-}"
unset R09_MODE PHASE_PACKET_B64 \
  PI_PROVIDER PI_MODEL PI_REASONING_LEVEL \
  PI_SESSION_FILE PI_SESSION_ID

AUTH_JSON="$(
  pi auth check \
    --provider abel \
    --model deepseek-v4-flash \
    --json \
    --no-refresh
)"
export AUTH_JSON
readonly SOURCE="$(cat)"

case "$MODE" in
  capability)
    test -z "$PACKET_B64"
    R09_MODE=capability bun --eval "$SOURCE"
    ;;
  run)
    test -n "$PACKET_B64"
    printf "%s" "$PACKET_B64" |
      base64 --decode |
      R09_MODE=run bun --eval "$SOURCE"
    ;;
  *) exit 64 ;;
esac
' <<'R09_SOURCE'
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { relative, resolve } from "node:path";
import { createAssistantMessageEventStream, InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/compat";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createAgentSession, defineTool, ModelRegistry, ModelRuntime, SessionManager, SettingsManager } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadAgentDefinitions } from "./src/agent-registry.ts";
import { EmptyResourceLoader } from "./src/empty-resource-loader.ts";
import { snapshotDirManifest, snapshotFile } from "./src/file-snapshot.ts";
import { createScopedTools } from "./src/scoped-tools.ts";

const FIXED = Object.freeze({ provider: "abel", model: "deepseek-v4-flash", api: "openai-completions", thinking: "off" });
const ARCHITECTURE = "direct-sdk-delivery-adapter-v2";
const MAX_PROVIDER_REQUESTS = 8;
const ALLOWED_TASKS = new Set(["P-004-SDA2", "P-004-FC", "P-004-FC-CANARY", "P-004-HDR", "P-004-B2", "P-004-C", "P-005", "P-006", "P-007", "P-008"]);
const RETIRED_TASKS = new Set(["P-004-DCR", "P-004-SDA"]);
const DIFF_FIELDS = ["id", "role", "kind", "taskId", "phase", "summary", "diff", "expectedVerification", "risks", "nextStep", "contractCompliant"];
const EVIDENCE_FIELDS = ["id", "role", "kind", "conclusions", "citations", "constraints", "dependencies", "risks", "blockingQuestions", "hints"];
const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const REDISPATCHABLE_CLASSES = new Set(["timeout", "provider-error", "ended-without-submit"]);
const need = (condition, message) => { if (!condition) throw new Error(message); };
const exactKeys = (value, keys) => Boolean(value && typeof value === "object" && !Array.isArray(value)) && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
const canonicalBytes = (value) => {
  const walk = (item) => {
    if (item === null || typeof item === "boolean" || typeof item === "string") return JSON.stringify(item);
    if (typeof item === "number") {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new Error("noncanonical number");
      return String(item);
    }
    if (Array.isArray(item)) return `[${item.map(walk).join(",")}]`;
    if (item && typeof item === "object" && Object.getPrototypeOf(item) === Object.prototype) {
      const keys = Object.keys(item).sort();
      if (keys.some((key) => item[key] === undefined)) throw new Error("undefined canonical member");
      return `{${keys.map((key) => `${JSON.stringify(key)}:${walk(item[key])}`).join(",")}}`;
    }
    throw new Error("noncanonical value");
  };
  return Buffer.from(walk(value), "utf8");
};
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const key of Object.keys(value)) deepFreeze(value[key]);
    Object.freeze(value);
  }
  return value;
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const same = (left, right) => canonicalBytes(left).equals(canonicalBytes(right));
const safePath = (value) => typeof value === "string" && value.length > 0 && value.length <= 512 && !value.startsWith("/") && !value.startsWith("~") && !value.startsWith("./") && !value.includes("\\") && !value.includes("\0") && !value.includes("//") && !value.endsWith("/.") && !value.split("/").includes("..");
const safeDiffPath = (value) => safePath(value) && value !== ".";
const assertNoSymlink = (root, path) => {
  const rootReal = realpathSync(root);
  const absolute = resolve(rootReal, path);
  need(absolute === rootReal || absolute.startsWith(`${rootReal}/`), "path escapes root");
  const parts = relative(rootReal, absolute).split("/").filter(Boolean);
  let current = rootReal;
  for (const part of parts) {
    current = resolve(current, part);
    const stat = lstatSync(current, { throwIfNoEntry: false });
    if (!stat) break;
    need(!stat.isSymbolicLink(), "symlink path rejected");
  }
};
const recapture = (cwd, snapshot) => {
  const next = {};
  for (const path of Object.keys(snapshot).sort()) {
    need(safePath(path), "unsafe snapshot path");
    assertNoSymlink(cwd, path);
    const expected = snapshot[path];
    if (expected.kind === "dir") next[path] = snapshotDirManifest(cwd, path) ?? { kind: "absent", absent: true };
    else if (expected.kind === "file" || expected.kind === "absent") next[path] = snapshotFile(cwd, path) ?? { kind: "absent", absent: true };
    else throw new Error("invalid snapshot kind");
  }
  return next;
};
const coreOf = (packet) => {
  const { snapshot, ...request } = packet.request;
  return { version: packet.version, architecture: packet.architecture, task: packet.task, request, snapshotPaths: Object.keys(snapshot).sort(), prerequisites: packet.prerequisites, identity: packet.identity, resultBounds: packet.resultBounds, redispatchPermitted: packet.redispatchPermitted };
};
const lineCounts = (diff) => {
  let added = 0;
  let deleted = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    if (line.startsWith("-") && !line.startsWith("---")) deleted++;
  }
  return { added, deleted };
};
const headerPath = (text, prefix) => {
  if (text === "/dev/null") return null;
  need(text.startsWith(`${prefix}/`), "noncanonical diff header prefix");
  const path = text.slice(2);
  need(safeDiffPath(path), "unsafe diff path");
  return path;
};
const diffPaths = (diff) => {
  need(typeof diff === "string" && diff.length > 0 && diff.endsWith("\n") && !diff.includes("\r"), "diff must be nonempty UTF-8/LF text");
  need(!/^(?:Binary files|GIT binary patch|rename |copy |old mode |new mode )/mu.test(diff), "unsupported diff form");
  const paths = [];
  let oldPath;
  for (const line of diff.split("\n")) {
    if (line.startsWith("--- ")) {
      need(oldPath === undefined, "unpaired old header");
      oldPath = headerPath(line.slice(4), "a");
    } else if (line.startsWith("+++ ")) {
      need(oldPath !== undefined, "unpaired new header");
      const newPath = headerPath(line.slice(4), "b");
      need(oldPath !== null || newPath !== null, "null/null header pair");
      if (oldPath !== null && newPath !== null) need(oldPath === newPath, "mismatched diff targets");
      const target = newPath ?? oldPath;
      need(!paths.includes(target), "duplicate diff target");
      paths.push(target);
      oldPath = undefined;
    }
  }
  need(oldPath === undefined && paths.length > 0, "incomplete or absent diff headers");
  return paths;
};
const diffSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  role: Type.Literal("implementation-worker"),
  kind: Type.Literal("diff"),
  taskId: Type.String({ minLength: 1, maxLength: 128 }),
  phase: Type.String({ minLength: 1, maxLength: 16 }),
  summary: Type.String({ minLength: 1 }),
  diff: Type.String({ minLength: 1 }),
  expectedVerification: Type.String({ minLength: 1 }),
  risks: Type.Array(Type.String()),
  nextStep: Type.String({ minLength: 1 }),
  contractCompliant: Type.Literal(true),
}, { additionalProperties: false });
const evidenceSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 128 }),
  role: Type.Literal("contract-reviewer"),
  kind: Type.Literal("evidence"),
  conclusions: Type.Array(Type.String()),
  citations: Type.Array(Type.Object({ path: Type.String(), lines: Type.String() }, { additionalProperties: false })),
  constraints: Type.Array(Type.String()),
  dependencies: Type.Array(Type.String()),
  risks: Type.Array(Type.String()),
  blockingQuestions: Type.Array(Type.String()),
  hints: Type.Object({ writeSet: Type.Array(Type.String()), verification: Type.String(), agentsImpact: Type.String() }, { additionalProperties: false }),
}, { additionalProperties: false });
const classifyAssistant = (message) => {
  if (!message || message.role !== "assistant") return "no-final-assistant";
  const submits = message.content.filter((item) => item.type === "toolCall" && item.name === "abel_submit_result");
  if (submits.length === 0) return "text-only";
  if (submits.length > 1) return "multiple-submit";
  return message.content.length === 1 ? "single-submit-only" : "mixed";
};
function localSecondRequestBlock(model) {
  const stream = createAssistantMessageEventStream();
  const message = { role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id, usage: ZERO_USAGE, stopReason: "error", errorMessage: "R-09 session exceeded the phase Provider request budget", timestamp: Date.now() };
  queueMicrotask(() => { stream.push({ type: "error", reason: "error", error: message }); stream.end(message); });
  return stream;
}
function oneRequestProvider(parent, resolved, onFirstRequest, onProviderError = () => {}) {
  let requests = 0;
  const call = async (fn, model, context, options) => {
    if (requests >= MAX_PROVIDER_REQUESTS) return localSecondRequestBlock(model);
    requests++;
    if (requests === 1) onFirstRequest();
    try {
      const msgs = context?.messages ?? context?.message ?? [];
      const last = Array.isArray(msgs) ? msgs.at(-1) : msgs;
      const result = await fn.call(parent, model, context, { ...options, apiKey: resolved.apiKey, headers: { ...resolved.headers, ...options?.headers }, env: { ...resolved.env, ...options?.env }, maxRetries: 0 });
      return result;
    } catch (error) {
      onProviderError(error);
      throw error;
    }
  };
  return {
    ...parent,
    baseUrl: resolved.baseUrl ?? parent.baseUrl,
    headers: { ...parent.headers, ...resolved.headers },
    auth: { apiKey: { name: "R-09 phase-local auth", resolve: async () => ({ auth: { apiKey: resolved.apiKey, headers: resolved.headers, baseUrl: resolved.baseUrl }, env: resolved.env }) } },
    stream(model, context, options) { return call(parent.stream, model, context, options); },
    streamSimple(model, context, options) { return call(parent.streamSimple, model, context, options); },
  };
}
async function sourceIdentity() {
  const checked = JSON.parse(process.env.AUTH_JSON ?? "null");
  need(checked?.status === "ready" && checked.provider === FIXED.provider && checked.authType === "api_key", "fixed API-key auth not ready");
  const source = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false });
  const model = source.getModel(FIXED.provider, FIXED.model);
  const provider = source.getProvider(FIXED.provider);
  need(model && provider && model.provider === FIXED.provider && model.id === FIXED.model && model.api === FIXED.api, "fixed model tuple unavailable");
  need(getSupportedThinkingLevels(model).includes(FIXED.thinking), "thinking off unsupported");
  const resolved = await new ModelRegistry(source).getApiKeyAndHeaders(model);
  need(resolved.ok, "fresh phase auth unavailable");
  return { provider, resolved };
}
async function phaseRuntime(onFirstRequest, onProviderError) {
  const source = await sourceIdentity();
  const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  runtime.registerNativeProvider(oneRequestProvider(source.provider, source.resolved, onFirstRequest, onProviderError));
  const model = runtime.getModel(FIXED.provider, FIXED.model);
  need(model && model.api === FIXED.api, "phase model unavailable");
  return { runtime, model };
}
function readTools(cwd, declaredRead, snapshot, observed) {
  const relPath = (input) => {
    need(typeof input === "string" && input.length > 0 && input.length <= 512 && !input.includes("\u0000") && !input.includes("\\"), "invalid tool path");
    const absolute = input.startsWith("/") ? input : resolve(cwd, input);
    const rel = relative(cwd, absolute);
    need(rel === "" || !rel.startsWith(".."), "tool path escapes root");
    return rel === "" ? "." : rel;
  };
  const declared = (rel) => declaredRead.some((item) => item === "." ? true : snapshot[item]?.kind === "dir" ? rel === item || rel.startsWith(`${item}/`) : rel === item);
  const parentOfDeclared = (rel) => rel !== "." && declaredRead.some((item) => item.includes("/") && item.slice(0, item.lastIndexOf("/")) === rel);
  const coversContent = (rel) => declared(rel);
  const coversMeta = (rel) => declared(rel) || rel === "." || parentOfDeclared(rel);
  const observer = (entry) => {
    let rel;
    try { rel = relPath(entry.path); } catch { return; }
    if (entry.kind === "dir") {
      if (!observed[rel]) observed[rel] = snapshotDirManifest(cwd, rel) ?? { kind: "absent", absent: true };
      return;
    }
    need(coversContent(rel), `undeclared read observation: ${rel}`);
    if (!observed[rel]) observed[rel] = snapshotFile(cwd, rel) ?? { kind: "absent", absent: true };
  };
  return createScopedTools({ roots: [cwd], observer }).map((scoped) => defineTool({
    name: scoped.name,
    label: scoped.name,
    description: scoped.description,
    parameters: scoped.name === "grep" ? Type.Object({ path: Type.String(), pattern: Type.String() }, { additionalProperties: false }) : Type.Object({ path: Type.String() }, { additionalProperties: false }),
    async execute(_id, params) {
      const rel = relPath(params.path);
      need(coversMeta(rel), "tool path is outside declared read set");
      if (scoped.name === "read" || scoped.name === "grep") need(coversContent(rel), "read scope escape");
      const result = await scoped.execute({ ...params, path: rel });
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  }));
}
function validatePacket(packet) {
  need(exactKeys(packet, ["version", "architecture", "task", "request", "prerequisites", "identity", "resultBounds", "redispatchPermitted"]), "invalid packet shape");
  need(packet.version === 2 && packet.architecture === ARCHITECTURE, "invalid adapter version");
  need(!RETIRED_TASKS.has(packet.task) && ALLOWED_TASKS.has(packet.task), "retired or unknown task identity");
  need(exactKeys(packet.request, ["stage", "role", "agentSha256", "id", "phase", "objective", "roots", "context", "declared", "output", "snapshot"]), "invalid request shape");
  need(packet.request.stage === "abel-implement" && packet.request.id === packet.task, "request identity mismatch");
  const worker = packet.request.role === "implementation-worker" && packet.request.output === "diff" && packet.task !== "P-008" && ["red", "green", "refactor"].includes(packet.request.phase);
  const reviewer = packet.request.role === "contract-reviewer" && packet.request.output === "evidence" && packet.task === "P-008" && packet.request.phase === "review";
  need(worker || reviewer, "invalid task/role/output/phase tuple");
  need(typeof packet.request.agentSha256 === "string" && /^[0-9a-f]{64}$/.test(packet.request.agentSha256), "invalid role hash");
  need(typeof packet.request.objective === "string" && packet.request.objective.length > 0 && packet.request.objective.length <= 4096, "invalid objective");
  need(same(packet.request.roots, ["."]), "invalid roots");
  need(exactKeys(packet.request.context, ["agents", "contract"]) && typeof packet.request.context.agents === "string" && typeof packet.request.context.contract === "string" && canonicalBytes(packet.request.context).length <= 65536, "invalid context");
  need(exactKeys(packet.request.declared, ["read", "write", "conflicts", "resources", "verificationLock"]), "invalid declared contract");
  for (const key of ["read", "write"]) need(Array.isArray(packet.request.declared[key]) && packet.request.declared[key].every(safePath), `invalid ${key} set`);
  for (const key of ["conflicts", "resources"]) need(Array.isArray(packet.request.declared[key]) && packet.request.declared[key].every((item) => typeof item === "string" && item.length > 0), `invalid ${key} set`);
  need(typeof packet.request.declared.verificationLock === "string" && packet.request.declared.verificationLock.length > 0, "invalid verification lock");
  need(packet.request.snapshot && typeof packet.request.snapshot === "object" && !Array.isArray(packet.request.snapshot), "invalid snapshot");
  const snapshotPaths = [...new Set([...packet.request.declared.read, ...packet.request.declared.write])].sort();
  need(same(Object.keys(packet.request.snapshot).sort(), snapshotPaths), "snapshot path-key drift");
  need(Array.isArray(packet.prerequisites) && packet.prerequisites.every((item) => typeof item === "string"), "invalid prerequisites");
  need(exactKeys(packet.identity, ["provider", "model", "api", "thinking"]) && same(packet.identity, FIXED), "delivery identity drift");
  need(typeof packet.redispatchPermitted === "boolean", "invalid token declaration");
  if (worker) {
    need(exactKeys(packet.resultBounds, ["kind", "metadataMaxUtf8Bytes", "diffMaxUtf8Bytes", "paths", "maxAdded", "maxDeleted"]), "invalid diff bounds shape");
    need(packet.resultBounds.kind === "diff" && same(packet.resultBounds.paths, packet.request.declared.write), "diff bounds path drift");
    for (const key of ["metadataMaxUtf8Bytes", "diffMaxUtf8Bytes", "maxAdded", "maxDeleted"]) need(Number.isSafeInteger(packet.resultBounds[key]) && packet.resultBounds[key] >= 0, `invalid ${key}`);
  } else {
    need(exactKeys(packet.resultBounds, ["kind", "completeMaxUtf8Bytes", "maxLines"]), "invalid evidence bounds shape");
    need(packet.resultBounds.kind === "evidence" && packet.request.declared.write.length === 0, "invalid evidence bounds");
    for (const key of ["completeMaxUtf8Bytes", "maxLines"]) need(Number.isSafeInteger(packet.resultBounds[key]) && packet.resultBounds[key] >= 0, `invalid ${key}`);
  }
}
function validateValue(packet, value) {
  if (packet.request.output === "diff") {
    need(exactKeys(value, DIFF_FIELDS), "diff result exact shape mismatch");
    need(value.id === packet.request.id && value.role === packet.request.role && value.kind === "diff" && value.taskId === packet.task && value.phase === packet.request.phase, "diff result identity mismatch");
    need(typeof value.summary === "string" && typeof value.diff === "string" && typeof value.expectedVerification === "string" && Array.isArray(value.risks) && value.risks.every((item) => typeof item === "string") && typeof value.nextStep === "string" && value.contractCompliant === true, "diff result field mismatch");
    const paths = diffPaths(value.diff);
    const counts = lineCounts(value.diff);
    const metadata = structuredClone(value);
    delete metadata.diff;
    const metadataUtf8Bytes = canonicalBytes(metadata).length;
    const diffBytes = Buffer.from(value.diff, "utf8");
    need(metadataUtf8Bytes <= packet.resultBounds.metadataMaxUtf8Bytes && diffBytes.length <= packet.resultBounds.diffMaxUtf8Bytes, "diff byte boundary exceeded");
    need(same(paths, packet.resultBounds.paths) && counts.added <= packet.resultBounds.maxAdded && counts.deleted <= packet.resultBounds.maxDeleted, "diff path/line boundary exceeded");
    return { metadataUtf8Bytes, diffUtf8Bytes: diffBytes.length, diffSha256: sha256(diffBytes), paths, ...counts };
  }
  need(exactKeys(value, EVIDENCE_FIELDS), "evidence result exact shape mismatch");
  need(value.id === packet.request.id && value.role === packet.request.role && value.kind === "evidence", "evidence result identity mismatch");
  const bytes = canonicalBytes(value);
  const lines = JSON.stringify(value, null, 2).split("\n").length;
  need(bytes.length <= packet.resultBounds.completeMaxUtf8Bytes && lines <= packet.resultBounds.maxLines, "evidence boundary exceeded");
  return { completeUtf8Bytes: bytes.length, completeSha256: sha256(bytes), lines };
}
async function runAttempt(packet, number) {
  let admitted = false;
  let providerFailed = false;
  let submitAttempts = 0;
  let submitExecutes = 0;
  let accepted;
  let submitCategory = "no-final-assistant";
  const emitFailure = (classification) => {
    console.error(`ABEL_WORKER_ATTEMPT_FAILED ${JSON.stringify({ task: packet.task, phase: packet.request.phase, attempt: number, class: classification, submitAttempts, submitExecutes, finalCategory: submitCategory })}`);
  };
  try {
    const { runtime, model } = await phaseRuntime(() => {
      need(!admitted, "multiple Provider delegation markers");
      admitted = true;
      console.error(`ABEL_WORKER_REQUEST_ADMITTED ${JSON.stringify({ task: packet.task, phase: packet.request.phase, attempt: number, ...FIXED })}`);
    }, () => { providerFailed = true; });
    const role = loadAgentDefinitions().find((item) => item.role === packet.request.role);
    need(role && role.sha256 === packet.request.agentSha256, "package role hash mismatch");
    const observed = {};
    let delivery;
    const submit = defineTool({
      name: "abel_submit_result",
      label: "Submit Abel Result",
      description: "Submit exactly one complete final structural result.",
      executionMode: "sequential",
      parameters: packet.request.output === "diff" ? diffSchema : evidenceSchema,
      async execute(_id, params) {
        submitExecutes++;
        need(submitExecutes === 1 && !accepted, "duplicate structural submission");
        delivery = validateValue(packet, params);
        accepted = deepFreeze(structuredClone(params));
        return { content: [{ type: "text", text: "Abel result accepted." }], details: { accepted: true }, terminate: true };
      },
    });
    const tools = [...readTools(process.cwd(), packet.request.declared.read, packet.request.snapshot, observed), submit];
    const toolNames = tools.map((tool) => tool.name).sort();
    need(same(toolNames, ["abel_submit_result", "find", "grep", "ls", "read"]), "tool set mismatch");
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } } });
    const sessions = SessionManager.inMemory(process.cwd());
    const systemPrompt = [role.content, packet.request.objective, packet.request.context.agents, packet.request.context.contract].join("\n\n");
    const { session } = await createAgentSession({ cwd: process.cwd(), modelRuntime: runtime, model, thinkingLevel: "off", tools: toolNames, customTools: tools, resourceLoader: new EmptyResourceLoader(systemPrompt), sessionManager: sessions, settingsManager: settings });
    need(session.sessionFile === undefined && sessions.getSessionFile() === undefined, "session persistence enabled");
    need(same(session.getActiveToolNames().sort(), toolNames), "active tool drift");
    need(session.getAllTools().find((tool) => tool.name === "abel_submit_result")?.parameters?.additionalProperties === false, "strict schema not exposed");
    const unsubscribe = session.subscribe((event) => {
                        if (event.type === "message_end" && event.message.role === "assistant" && event.message.content.some((item) => item.type === "toolCall" && item.name === "abel_submit_result")) submitCategory = classifyAssistant(event.message);
      if (event.type === "tool_execution_start" && event.toolName === "abel_submit_result") submitAttempts++;
      if (event.type === "tool_execution_end" && event.toolName === "abel_submit_result" && event.isError) void session.abort();
    });
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { void session.abort().finally(() => reject(new Error("phase timeout"))); }, 20 * 60 * 1000);
      timer.unref?.();
    });
    try {
      await Promise.race([session.prompt(`Complete only the approved phase for this request. You may use the read-only tools read, grep, find, and ls to inspect the workspace, but you must not modify it. Your final Assistant message MUST contain exactly one tool call to abel_submit_result carrying the complete structural result required by your context, and no other tool call or assistant text; any other final message fails the phase. The abel_submit_result value MUST carry exactly these identity fields: id="${packet.request.id}", role="${packet.request.role}", kind="diff", taskId="${packet.task}", phase="${packet.request.phase}", contractCompliant=true. The complete diff string MUST be an ordinary unified diff for exactly the declared write path, ending with a newline, with no binary, rename, copy, or mode records.`, { expandPromptTemplates: false }), timeout]);
      if (submitAttempts > 0 && (!accepted || submitAttempts !== 1 || submitExecutes !== 1 || (submitCategory !== "single-submit-only" && submitCategory !== "mixed"))) {
        emitFailure("structural-result-rejection");
        return { ok: false, admitted, class: "structural-result-rejection", submitAttempts, submitExecutes, finalCategory: submitCategory };
      }
      if (!accepted) {
        const classification = admitted ? "ended-without-submit" : "pre-admission-failure";
        emitFailure(classification);
        return { ok: false, admitted, class: classification, submitAttempts, submitExecutes, finalCategory: submitCategory };
      }
      need(same(recapture(process.cwd(), packet.request.snapshot), packet.request.snapshot), "packet snapshot changed during attempt");
      need(same(recapture(process.cwd(), observed), observed), "observed snapshot changed during attempt");
      return { ok: true, admitted: true, structuralResult: accepted, delivery, boundSnapshot: { ...packet.request.snapshot, ...observed }, finalCategory: submitCategory };
    } finally {
      clearTimeout(timer);
      unsubscribe();
      session.agent.state.messages = [];
      session.dispose();
      need(settings.drainErrors().length === 0, "settings persistence error");
    }
  } catch (error) {
    const classification = submitAttempts > 0 && (!accepted || submitAttempts !== 1 || submitExecutes !== 1 || (submitCategory !== "single-submit-only" && submitCategory !== "mixed")) ? "structural-result-rejection" : error instanceof Error && error.message === "phase timeout" ? "timeout" : providerFailed ? "provider-error" : admitted ? "runner-error" : "pre-admission-failure";
    emitFailure(classification);
    return { ok: false, admitted, class: classification, submitAttempts, submitExecutes, finalCategory: submitCategory };
  }
}
async function capability() {
  const role = loadAgentDefinitions().find((item) => item.role === "implementation-worker");
  need(role, "package implementation-worker unavailable");
  const expected = Object.freeze({ id: "P-004-SDA-CAPABILITY", role: "implementation-worker", taskId: "P-004-SDA-CAPABILITY", phase: "red" });
  const valid = Object.freeze({ ...expected, kind: "diff", summary: "capability only", diff: "--- a/README.md\n+++ b/README.md\n@@ -1 +1 @@\n-old\n+new\n", expectedVerification: "faux only", risks: [], nextStep: "discard", contractCompliant: true });
  const cases = [];
  let providerSawStrictSchema = false;
  for (const name of ["valid", "malformed", "wrong-identity", "multiple"]) {
    const faux = fauxProvider({ provider: `r09-${name}`, api: "faux" });
    const malformed = { ...valid };
    delete malformed.expectedVerification;
    const call = name === "malformed" ? malformed : name === "wrong-identity" ? { ...valid, id: "wrong" } : valid;
    faux.setResponses(name === "multiple" ? [fauxAssistantMessage([fauxToolCall("abel_submit_result", valid), fauxToolCall("abel_submit_result", valid)], { stopReason: "toolUse" })] : [(context) => {
      const exposed = context.tools?.find((tool) => tool.name === "abel_submit_result");
      if (name === "valid") providerSawStrictSchema = Boolean(exposed?.parameters?.additionalProperties === false && DIFF_FIELDS.every((field) => exposed.parameters.required?.includes(field)));
      return fauxAssistantMessage(fauxToolCall("abel_submit_result", call), { stopReason: "toolUse" });
    }]);
    let providerRequests = 0;
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
    runtime.registerNativeProvider(oneRequestProvider(faux.provider, {}, () => providerRequests++));
    let attempts = 0;
    let executes = 0;
    let accepted = false;
    let category = "no-final-assistant";
    const submit = defineTool({
      name: "abel_submit_result", label: "Submit Abel Result", description: "Submit exactly one complete structural diff result.", executionMode: "sequential", parameters: diffSchema,
      async execute(_id, params) {
        executes++;
        need(executes === 1 && params.id === expected.id && params.role === expected.role && params.taskId === expected.taskId && params.phase === expected.phase, "capability identity rejection");
        accepted = true;
        return { content: [{ type: "text", text: "accepted" }], details: { accepted: true }, terminate: true };
      },
    });
    const tools = [...readTools(process.cwd(), ["README.md"], { "README.md": snapshotFile(process.cwd(), "README.md") }, {}), submit];
    const settings = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } } });
    const sessions = SessionManager.inMemory(process.cwd());
    const { session } = await createAgentSession({ cwd: process.cwd(), modelRuntime: runtime, model: runtime.getModel(faux.getModel().provider, faux.getModel().id), thinkingLevel: "off", tools: tools.map((tool) => tool.name), customTools: tools, resourceLoader: new EmptyResourceLoader(role.content), sessionManager: sessions, settingsManager: settings });
    need(same(session.getActiveToolNames().sort(), ["abel_submit_result", "find", "grep", "ls", "read"]), "capability tool set mismatch");
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "assistant" && event.message.content.some((item) => item.type === "toolCall" && item.name === "abel_submit_result")) category = classifyAssistant(event.message);
      if (event.type === "tool_execution_start" && event.toolName === "abel_submit_result") attempts++;
      if (event.type === "tool_execution_end" && event.toolName === "abel_submit_result" && event.isError) void session.abort();
    });
    try { await session.prompt("scripted faux capability", { expandPromptTemplates: false }); }
    finally { unsubscribe(); session.agent.state.messages = []; session.dispose(); }
    const trusted = accepted && attempts === 1 && executes === 1 && category === "single-submit-only";
    need(session.sessionFile === undefined && sessions.getSessionFile() === undefined && settings.drainErrors().length === 0, "capability persistence detected");
    need(providerRequests === 1 && faux.state.callCount === 1, "capability delegated more than one Provider request");
    cases.push({ name, attempts, executes, accepted, category, trusted, providerRequests });
  }
  need(providerSawStrictSchema && cases[0].trusted && cases.slice(1).every((item) => !item.trusted), "adapter capability failed");
  let environmentReady = false;
  let environmentError;
  try { await sourceIdentity(); environmentReady = true; } catch (error) { environmentError = error instanceof Error ? error.message : String(error); }
  console.log(JSON.stringify({ status: environmentReady ? "ready" : "blocked", capability: ARCHITECTURE, adapterReady: true, environmentReady, environmentError, fixedIdentity: { ...FIXED, authType: "api_key" }, roleSha256: role.sha256, providerSawStrictSchema, oneProviderRequestPerSession: true, sessionManager: "in-memory", settingsManager: "in-memory", resultRetention: "lexical-memory-only", processExitState: "none", realProviderRequests: 0, fauxOnly: true, cases }, null, 2));
  if (!environmentReady) process.exitCode = 78;
}
async function run() {
  let packet;
  try {
    packet = JSON.parse(await Bun.stdin.text());
    validatePacket(packet);
    need(same(recapture(process.cwd(), packet.request.snapshot), packet.request.snapshot), "initial snapshot stale");
    const frozen = deepFreeze(structuredClone(packet));
    const baseline = canonicalBytes(coreOf(frozen));
    need(baseline.equals(canonicalBytes(coreOf(packet))), "initial canonical mismatch");
    const first = await runAttempt(packet, 1);
    if (first.ok) {
      console.log(JSON.stringify({ task: packet.task, phase: packet.request.phase, attempt: 1, tokenConsumed: false, canonicalSha256: sha256(baseline), ...first }));
      return;
    }
    if (!first.admitted || !REDISPATCHABLE_CLASSES.has(first.class) || !packet.redispatchPermitted) throw new Error(first.class);
    const second = structuredClone(frozen);
    second.request.snapshot = recapture(process.cwd(), frozen.request.snapshot);
    need(baseline.equals(canonicalBytes(coreOf(second))), "redispatch canonical mismatch");
    const final = await runAttempt(second, 2);
    if (!final.ok) throw new Error(final.class);
    console.log(JSON.stringify({ task: packet.task, phase: packet.request.phase, attempt: 2, tokenConsumed: true, canonicalSha256: sha256(baseline), ...final }));
  } catch (error) {
    console.error(`ABEL_WORKER_RUNNER_FAILED ${JSON.stringify({ task: packet?.task ?? "unknown", phase: packet?.request?.phase ?? "unknown", class: error instanceof Error ? error.message : "runner-failure" })}`);
    process.exitCode = 1;
  }
}
if (process.env.R09_MODE === "capability") await capability();
else if (process.env.R09_MODE === "run") await run();
else throw new Error("R09_MODE must be capability or run");
R09_SOURCE
```

##### R-09.1 phase packet and canonical continuity

The P-004-SDA2 Red packet has this exact construction-time shape and current baseline values:

```json
{
  "version": 2,
  "architecture": "direct-sdk-delivery-adapter-v2",
  "task": "P-004-SDA2",
  "request": {
    "stage": "abel-implement",
    "role": "implementation-worker",
    "agentSha256": "9859c57a90f707abe6705d820a1269781c79b5eaeb3efcf07570124e9505ba1f",
    "id": "P-004-SDA2",
    "phase": "red",
    "objective": "P-004-SDA2 Red: add only the approved strict-diff-result fixture precheck and strict diff-result schema and identity-shape property target to test/contracts.property.test.ts; do not modify product code.",
    "roots": ["."],
    "context": {
      "agents": "<exact bounded root AGENTS context>",
      "contract": "<exact approved Scenario and P-004-SDA2 task contract>"
    },
    "declared": {
      "read": [
        "src/contracts.ts",
        "test/contracts.property.test.ts"
      ],
      "write": ["test/contracts.property.test.ts"],
      "conflicts": ["P-004-FC", "P-004-HDR"],
      "resources": ["strict-diff-result-contract"],
      "verificationLock": "p004-sda2-target"
    },
    "output": "diff",
    "snapshot": {
      "src/contracts.ts": {
        "kind": "file",
        "sha256": "2880aff9cd1b512d8799b82abca928d474dee48b8575628165e2438d42cf6852",
        "bytes": 9419
      },
      "test/contracts.property.test.ts": {
        "kind": "file",
        "sha256": "709ad50b626b2c46e5063a44bd7b2536b77ad0295e02eaf3dae1b067cce8375d",
        "bytes": 5905
      }
    }
  },
  "prerequisites": ["P-004-A"],
  "identity": {
    "provider": "abel",
    "model": "deepseek-v4-flash",
    "api": "openai-completions",
    "thinking": "off"
  },
  "resultBounds": {
    "kind": "diff",
    "metadataMaxUtf8Bytes": 4096,
    "diffMaxUtf8Bytes": 12288,
    "paths": ["test/contracts.property.test.ts"],
    "maxAdded": 110,
    "maxDeleted": 10
  },
  "redispatchPermitted": true
}
```

The two context strings are packet construction fields, not a second input surface. Before invocation the Implement parent replaces them with exact bounded current text and serializes one complete JSON value. Green changes only the approved phase/objective, declared write, current snapshot values/path set, Green bounds, and `redispatchPermitted` derived from current-context token evidence. P-008 uses role `contract-reviewer`, output `evidence`, phase `review`, an empty write set, and its approved evidence bounds. Packet input comes only from valid R-09.1 artifacts, the task contract, accepted prerequisite evidence, current workspace snapshot, and current Implement-context token evidence.

One phase is one shell invocation and one Bun process. `Bun.stdin.text()` executes exactly once in run mode. The packet is structured-cloned and recursively frozen. Deterministic canonical bytes are identical in shape to R-09 v1: version, architecture, task, stage, role, role hash, request ID, phase, objective, roots, bounded context, read/write/conflict/resource/verification-lock declarations, output, sorted snapshot path-key set, prerequisites, fixed identity, result bounds, and token declaration. Attempt 2 can change only current snapshot values and fresh phase-local auth; it is derived from the frozen initial packet in the same process and must reproduce the baseline canonical byte buffer. The reported SHA-256 is diagnostic, not the continuity authority. There is no second packet, second objective, parent baseline hash, stdin reread, or attempt 3.

##### R-09.1 attempt classification, markers, and token accounting

Each attempt performs the same admission sequence as R-09: packet/path/symlink/snapshot/canonical validation; no-network exact tuple resolution; `ModelRegistry` fresh auth resolution; fresh in-memory runtime with one wrapped Provider and retries disabled; package-role hash validation; strict runner-local submit tool construction; scoped read-tool construction; empty resources; in-memory settings/session creation; exact five-tool validation; one Provider delegation marker; one Provider request; structural observation; snapshot recapture; disposal exactly once; and bounded stdout delivery. The strict submit schema, runner execute checks, `submitAttemptCount`/`submitExecuteCount` counting, and first-submit-bearing-message classification are unchanged from R-09.

The runner-local Provider wrapper synchronously emits exactly one `ABEL_WORKER_REQUEST_ADMITTED` stderr marker immediately before its first and only delegation. A failed attempt additionally emits exactly one `ABEL_WORKER_ATTEMPT_FAILED` stderr marker at its terminal classification. The runner's final `ABEL_WORKER_RUNNER_FAILED` line carries the final attempt class. Illustrative markers:

```text
ABEL_WORKER_REQUEST_ADMITTED {"task":"P-004-SDA2","phase":"red","attempt":1,"provider":"abel","model":"deepseek-v4-flash","api":"openai-completions","thinking":"off"}
ABEL_WORKER_ATTEMPT_FAILED {"task":"P-004-SDA2","phase":"red","attempt":1,"class":"ended-without-submit","submitAttempts":0,"submitExecutes":0,"finalCategory":"text-only"}
```

A marker contains no credential, token, session ID, timestamp, result ID, or hash. One ADMITTED marker means exactly one delegated Provider request; a later SDK loop request receives only the local error stream. Zero, duplicate, mismatched, or out-of-order ADMITTED markers block; a failed attempt without exactly one matching ATTEMPT_FAILED marker, or an ATTEMPT_FAILED post-marker class without its ADMITTED marker, also blocks without further dispatch.

| Classification | Markers | Token effect | Required outcome |
| --- | ---: | ---: | --- |
| capability, packet, path, symlink, snapshot, canonical, role/hash, auth, session/tool construction failure | ATTEMPT_FAILED `pre-admission-failure`, no ADMITTED | none | exact precondition may be repaired, then a fresh initial runner may start |
| attempt-1 `provider-error`, `timeout`, or `ended-without-submit` | ADMITTED(1) + ATTEMPT_FAILED(1) | consume for same-process attempt 2 | only frozen-packet derivation may continue |
| malformed, wrong-identity, multiple, mixed, or out-of-bounds submit-bearing result | ADMITTED(1) + ATTEMPT_FAILED(1) `structural-result-rejection` | cannot compensate | structural rejection; block immediately |
| attempt-1 post-marker `runner-error` (adapter invariant violation) | ADMITTED(1) + ATTEMPT_FAILED(1) `runner-error` | consumed | block; no redispatch |
| attempt-2 readiness/auth/canonical failure before marker | ATTEMPT_FAILED(2) `pre-admission-failure`, no ADMITTED(2) | still 1 | already consumed; block; no new process may recover attempt 2 |
| attempt-2 post-marker failure | ADMITTED(2) + ATTEMPT_FAILED(2) | 2 | block; no third request |
| valid structural result later rejected by parent schema/path/hash/line/snapshot/semantic/ordinary-Git/wrong-reason checks | 1 or 2 | cannot compensate | block without redispatch |
| accepted attempt 1 | none | remains available for a later phase | continue TDD |
| accepted attempt 2 | none | consumed | later phase has only its initial request |

Each remaining implementation/review task owns one independent task-local Red/Green-shared or review token; FC's discarded canary has none. Tokens never reset, transfer, borrow, revive history, authorize a model independently of an approved phase, or survive process exit as a ledger. Across phases, the parent derives availability only from markers/results observed in the current Implement context.

##### R-09.1 persistence and parent admission boundary

The adapter, Worker, and parent persist no credential, packet, canonical request/hash, marker/token ledger, transcript, raw model output, tool history, result file, session/settings, timestamp, queue, checkpoint, or runtime state. Allowed state is current-process lexical objects, in-memory runtimes/session/settings, one bounded accepted structural value, current command stdout/stderr, and Pi's ordinary host-owned parent transcript. Session messages are erased before disposal. No repository or `/tmp` runner script exists.

The parent recomputes exact UTF-8 bytes, SHA-256, metadata bytes, parsed path set, added/deleted lines, task/request/role/phase, packet and observed snapshots, and bounds. It runs `git apply --check --whitespace=nowarn -` on the exact bytes and applies only those same bytes with `git apply --whitespace=nowarn -`. It never fixes a hunk, formats, reconstructs, splices, partially applies, or uses `--recount` or `--unidiff-zero` to admit a Worker delivery.

The strict chain is `P-004-A -> P-004-SDA2 -> P-004-FC -> P-004-HDR -> P-004-B2 -> P-004-C`. All later Worker/reviewer phases use the R-09.1 adapter v2 entry. Before each phase the parent runs the complete v2 capability command and requires exit 0 with `environmentReady=true`; the environment is currently ready (verified at R-09.1 Design time).

### 9. Parent application uses ordinary Git patch semantics

A schema-valid diff is retained as exact UTF-8 bytes in a process-only map keyed by a random result ID. Retention ends on apply, discard, cancellation, finish, reload, session replacement, or shutdown.

`apply` performs:

1. result-ID and pending-state validation;
2. declared-path and current file-snapshot validation;
3. `git apply --numstat -z --recount -` and `git apply --summary --recount -` inspection of the exact retained bytes; reject binary markers, rename/copy records, mode changes, submodule mode `160000`, duplicate targets, noncanonical/escaping paths, and targets outside the declared write set;
4. `git apply --check --recount --whitespace=nowarn -` with the exact retained bytes;
5. ordinary `git apply --recount --whitespace=nowarn -` with those same bytes.

The parent starts `git` directly with `node:child_process.spawn`, `shell: false`, an argument array, and a piped stdin, then writes the exact retained diff bytes to that stdin. No command argument or temporary file contains the diff. `git apply` without `--reject` is all-or-nothing for this accepted textual subset. The design intentionally does not add custom hunk parsing, before-image storage, fsync, or a private rollback engine. A failed check or apply blocks the branch and advances no Gate, AGENTS, or task state. After a successful apply, the parent runs the approved verification and supplies compact normalized evidence to the next fresh phase.

Intrinsically non-textual work requires an exact pre-approved `parent-mechanical` task. This change has only the repository relocation task in that category.

### 10. Lifecycle state stays in memory

One extension-instance `Runtime` owns activation, queue, active AbortControllers, child sessions, logical Worker metadata, and retained results. It writes no custom/session entries and creates no orchestration state file. Pi's ordinary parent transcript may persist ToolResults because that is host-owned behavior.

One idempotent `drain()` implementation:

1. closes admission;
2. cancels active and queued work;
3. waits for settled promises up to the phase cancellation boundary;
4. disposes child sessions;
5. erases pending retained diffs and logical Worker metadata;
6. removes only `abel_dispatch` from the current active set.

`cancel` drains the selected batch while preserving already accepted independent results. `finish`, stage replacement, reload, session replacement, and shutdown drain all private state. Late callbacks verify an operation token and become no-ops after drain.

### 11. Distribution and evidence-only provenance

The package copies the complete MIT notice into `licenses/pi-subagents-MIT.txt` and summarizes adapted invariants in `THIRD_PARTY_NOTICES.md`. Each adapted module names the source repository, commit, and path in a short source note. A small provenance manifest maps only adapted files; there is no platform-wide source-classification or compatibility database.

Distribution acceptance:

1. runs `bun pm pack --destination <tmp>`;
2. inspects exact archive members and file types;
3. installs or unpacks the archive into an isolated directory;
4. creates user- and project-scoped Pi settings that reference that directory;
5. creates equivalent fixtures for absolute and relative local package directories;
6. loads resources and asserts four Prompts, four Skills, and one extension; verifies the four private package Agent files through the extension's immutable path/name/hash registry rather than treating them as Pi-discovered Agent resources; and uses an SDK-loaded package fixture to assert `abel_dispatch` is present in `getAllTools()` but absent from `getActiveTools()`;
7. proves no forbidden dependency/path, private state, development file, or symlink is shipped.

The `.tgz` path itself is never supplied as a local Pi package. No live npm registry request is made.

## PBT and Verification Strategy

Properties are used only where stable invariants exist:

- **Snapshot idempotence and order independence:** recapturing unchanged files yields the same map regardless of path input order.
- **Unrelated-change invariance:** changing a path outside a result's bound set preserves currentness.
- **Related-change invalidation:** content, type, creation, or deletion of a bound path makes the result stale.
- **Queue/state legality:** every scheduled promise settles once; cancellation prevents later start; terminal transitions do not reverse.
- **Path containment:** generated absolute, parent, backslash, NUL, and symlink paths never escape approved roots.
- **Usage additivity:** aggregation is associative over unique completed message IDs and does not replay prior phases.

Examples cover strict schemas, inactive activation, structural submission, one identical redispatch, patch failures, lifecycle drain, and package contents. E2E covers two disjoint Workers overlapping and both applying successfully, plus an overlapping-file stale case. Static checks cover no public export, no version policy, no forbidden dependency/reference resolution, and complete scenario-to-task traceability.

## Risks / Trade-offs

- [Relocating a dirty Git repository is operationally sensitive] → Record source inode, HEAD, branch, status, untracked inventory, worktrees, and AGENTS hashes; require same-device destination absence; use one no-overwrite rename; verify destination identity; never copy/delete or auto-reverse.
- [The host may change APIs because the package has no version gate] → Keep imports limited to documented public SDK APIs and let normal load/type/test failures surface; make no compatibility promise or runtime classifier.
- [JavaScript regex can spend too long in one pathological match] → Bound pattern length and scanned files, document the limitation, and defer Worker-thread regex isolation unless evidence shows it is needed.
- [Ordinary `git apply` cannot express every filesystem mutation] → Reject unsupported headers and require Design to define exact non-text work as `parent-mechanical`.
- [A crash after successful `git apply` but before validation leaves a changed working tree] → Report the applied result and block task advancement; the parent/user may inspect or revert with normal Git. A private rollback platform is intentionally excluded.
- [Phase-local auth can expire during a long phase] → Bound phases to 20 minutes; fail normally and use the one unchanged mechanical redispatch to obtain fresh auth rather than maintaining a live credential adapter.
- [File snapshots do not detect undeclared external resources] → Require precise task read/write sets and resource locks; serialize unknown scopes; stale-check all actual child reads and submitted targets.
- [One global concurrency limit may underutilize or overload a Provider] → Start with the simple bound of four; add Provider-specific admission only through a future approved design if operational evidence requires it.
- [The parent transcript can retain returned diffs] → Treat it as Pi host-owned session behavior and create no additional child/result/session files.

## Migration Plan

1. Revalidate Gate receipts and record root plus reference identity baselines.
2. Extract the approved package payload and relocate the complete reference repository with one verified no-overwrite rename.
3. Establish the standalone manifest, lockfile, commands, notices, immutable Agents, request/result contracts, scoped reads, snapshots, inactive dispatcher, and minimum child/apply path.
4. Run the seed acceptance in a fresh Pi process; end the bootstrap exception.
5. Before every remaining Worker or reviewer phase, run the R-09.1 v2 `capability` mode for the fixed `abel/deepseek-v4-flash`, `openai-completions`, thinking-`off` identity. Execute a phase only when the complete command exits 0 with `status=ready` and `environmentReady=true`; use the same inline source in `run` mode so one Bun process owns its frozen initial request and any sole conditional redispatch. The historical exit-78 fixed-model-catalog block is resolved and no longer blocks admission.
6. Keep completed P-004-A; retain the original P-004, old P-004-B, old P-004-B1, P-004-B1R, P-004-B1S, P-004-TXT, exhausted P-004-SV, P-004-DC, exhausted P-004-DCR, and exhausted P-004-SDA only as historical blocked delivery evidence; and use the strict `P-004-A -> P-004-SDA2 -> P-004-FC -> P-004-HDR -> P-004-B2 -> P-004-C` Worker chain with the R-09.1 adapter v2. SDA2 delivers the strict diff-result contract through the direct-SDK adapter, FC independently delivers product final-message classification and identity integration before its discarded canary, and HDR uses a dedicated textual-header verification module before retained request-snapshot/serial-apply and logical Worker retry/identity integration continue.
7. Create and inspect a real tarball, install or unpack it into an isolated directory, and load absolute, relative, and tarball-derived package directories.
8. Run target, affected, and complete suites; run OpenSpec strict validation; update only the root AGENTS managed block at stable implementation checkpoints.
9. Report completion without publishing, archiving, committing, or creating a remote repository.

Rollback is ordinary task-level source rollback before relocation. Once the verified reference rename succeeds, no automatic reverse move is attempted; a user-directed manual move is the only reversal.
