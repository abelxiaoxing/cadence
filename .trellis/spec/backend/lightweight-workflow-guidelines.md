# Lightweight Workflow Assistant

## 1. Scope / Trigger

This is the implemented cross-layer contract for explicit `/cadence` work, following the approved replacement of certified autonomous execution and transactional application.
Ordinary engineering, resource discovery and conversation do not activate it.
The source is a trusted terminal workflow assistant: direct host-tool edits can require manual recovery; tool selection and cwd are not an OS sandbox.
There is no compiler graph, candidate seal, multi-file rollback, certified Completion or universal descendant-closure guarantee.

Source anchors below are repository-relative paths and symbol names.
[Independent review](../../tasks/10-06-cadence-retirement-distribution-qualification/research/lightweight-independent-review.md) found and fixed five defects and recorded local passing gates, not release approval.
Native Windows/macOS, manager installation, physical-human and paid-provider qualification remain unexecuted there.
Historical contracts are preserved through [the archive manifest](../../tasks/10-06-cadence-retirement-distribution-qualification/research/retired-certified-specs/manifest.json), not retained as live instructions.

## 2. Signatures

These are internal source APIs, not model-callable tools or a public task RPC:

```ts
// src/task-controller.ts
interface CurrentChoice {
  generation: number;
  id: string;
  revision: number;
  identity: string;
}
// TaskController methods; start and generatePlan have the same parameters:
start(
  choice: CurrentChoice,
  prepare: (task: TaskRecord, signal: AbortSignal) => Promise<WorkerRequest>,
  currentContext: () => boolean,
  onProgress?: (text: string) => void,
): Promise<RunResult>;
check(choice: CurrentChoice, definition: CheckDefinition,
  currentContext: () => boolean): Promise<RunResult>;
done(choice: CurrentChoice, reviewed: ChangeView, acceptIssues: boolean): void;
cancel(): Promise<void>;

// src/task-store.ts
loadSnapshot(id: string): { record: TaskRecord; identity: string } | undefined;
save(record: TaskRecord, expectedRevision: number,
  held?: CheckoutLock, expectedIdentity?: string): TaskRecord;
recover(expected: CheckoutLock, acknowledgeEscapedProcesses: boolean): void;

// src/subagent-process.ts and src/task-diff.ts
runWorker(request: WorkerRequest, signal: AbortSignal,
  onProgress?: (text: string) => void, timeoutMs = 1_200_000): Promise<RunResult>;
runCheck(check: CheckDefinition, cwd: string, signal: AbortSignal): Promise<RunResult>;
runProcess(spec: ProcessSpec): Promise<RunResult>;
safeChildEnv(): NodeJS.ProcessEnv;
// Private SDK selector in subagent-process.ts; finite readonly own-data snapshots only.
// sdkNetworkEnvironment(ambient, scoped): {env: NodeJS.ProcessEnv; redactionLiterals: string[]};
// ProcessSpec.windowsVerbatimArguments?: boolean; Windows parent-check use only.
captureChanges(root: string): ChangeView;
```

`src/task-shell.ts#registerTaskShell` registers only `/cadence [request]`; the optional request prefills a goal, never Start.
`src/operator-cli.mjs doctor|runs [workspace]` is readonly; see [distribution](./task-distribution-guidelines.md).
Use installed public Pi declarations when changing host bindings: `ModelRegistry.getApiKeyAndHeaders(model: Model<Api>): Promise<ResolvedRequestAuth>` is the current parent-auth call.
Global documentation and the installed peer can differ; observed versions are not eligibility predicates.

## 3. Contracts

### Native choice → controller → record

`TerminalEntryLatch` uses actual `onTerminalInput` Enter plus editor text because command dispatch precedes the ordinary input event.
It is consumed once within **1500 ms**, rejects bracketed paste, and clears on other input/departure.
Admission also requires `mode === "tui"`, `hasUI`, trusted project, idle host, no pending messages, no active modal and no `CADENCE_SUBAGENT_CHILD=1`.
Session ID, cwd, epoch, selected model and controller choice are rechecked around awaited actions.
This is native work-session consent, not certification of future bytes.

Code Start requires a nonempty readable plan, displayed context/changes and a fresh native confirmation.
Readonly Generate plan uses the research tool set, saves an advisory draft and requires a separate Start for editing.
Research/diagnosis can start with only a goal; no write/edit/bash tools or parent shell-check menu is available.
The controller enforces kind independently of request preparation.
New/Open/history never executes; a stored `running` record projects as `interrupted` without rewriting it or replaying work.

`src/task-types.ts#TaskRecord` contains `schema`, UUID-v4 `id`, positive `revision`, `kind`, `goal`, `plan`, `cwd`, `phase`, `result`, `baseline`, `checks`, optional `review`, and bounded `activity`.
Kinds are `code | research | diagnosis`; phases are `planning | running | review | interrupted | failed | done`.
`CurrentChoice.identity` is the selected record's raw-byte SHA-256, not an approval token.
Even same-revision manual edits or formatting changes invalidate the choice and cannot be overwritten on final save.
Single-record optimistic replacement is not atomic filesystem CAS against arbitrary writers.
[Storage](./database-guidelines.md) owns paths, limits and lock details.

### Current model/auth → anonymous stdin → actual SDK

`WorkerRequest` has `cwd`, `model: Record<string, unknown>`, `auth`, `kind`, `prompt`, `instructions`, optional `thinkingLevel`.
`auth` is `{ ok: true, apiKey?: string, headers?: Record<string, string | null>, baseUrl?: string, env?: Record<string, string> }`.
The shell awaits public parent auth with abort/30-second timeout and checks current context again before spawning.
Late resolution cannot launch canceled work.
Instructions combine one fixed package role and at most **32768 bytes** of root `AGENTS.md`, explicitly labeled untrusted local content; no full chat/history/diff export.

`src/sdk-worker.mjs` runs via `process.execPath` and a package-relative URL, not Pi CLI startup or an installed TypeScript fallback.
It creates in-memory credentials/models/settings/session and an explicit empty resource loader, with `modelsPath: null`, `allowModelNetwork: false`, `refreshOnCreate: false`.
Compaction and agent retry are disabled; the stream wrapper sets `maxRetries: 0`.
In-memory settings also set public `cacheWarming: "off"` to disable modern SDK automatic refresh scheduling outside that wrapper.
This preserves model `promptCache` metadata and request/token limits; it is not a billing or request-count guarantee.
Older SDKs preserve the unused setting in their in-memory clone.
No default discovery, catalog refresh, CLI migrations or dependency download is introduced.

The single uniform route is `registerNativeProvider(createProvider({ id, models: [model], api, auth }))` with the official adapter and a local resolver returning the literal parent auth/env snapshot.
Resolved base URL overrides model base URL; model headers are removed because parent auth already resolved them.
Never put resolved keys/headers through config interpolation (`!` or `$`).
Null headers retain suppression semantics; provider-scoped env stays in the resolver, not `process.env`.
The allowlist is `openai-completions`, `openai-responses`, `openai-codex-responses`, `anthropic-messages`, `google-generative-ai`, `mistral-conversations`, `azure-openai-responses`.
Registered native/custom function transports (`getRegisteredNativeProvider`, configured `streamSimple`) refuse rather than substitute behavior.
Auth env keys ending `_FILE`, `_PATH` or `_CREDENTIALS` refuse as unsupported ambient-file authentication.
No silent model/provider/API fallback; auth expiry requires a new explicit run, not a token-lifetime guarantee.
Capture `thinkingLevel ?? "off"` once and pass that exact value to `createAgentSession`.
After assigning the created session, read its public `thinkingLevel` getter once and strictly compare it with that captured request beside the existing model-identity guard, before stream wrapping, subscription, READY or prompt.
Missing, null, nonstring, mismatched or throwing effective thinking refuses with the existing fixed `session` / `model-substitution` failure and independent cleanup; never inspect opaque exception properties.
Never clamp, call `setThinkingLevel`, fill a missing map, retry or substitute a model to repair the mismatch.

General `safeChildEnv()` allowlist (unchanged default `runProcess` environment): `PATH`, `HOME`, `USERPROFILE`, `SystemRoot`, `WINDIR`, `COMSPEC`, `TMP`, `TEMP`, `TMPDIR`, `LANG`, `LC_ALL`, `PATHEXT`.
Set `CADENCE_SUBAGENT_CHILD=1`, `PI_OFFLINE=1`, `NO_COLOR=1`; do not inherit provider credentials, `NODE_OPTIONS` or session/control IDs.
Auth travels only in the bounded stdin envelope, never resolved credential argv/files/logs.
Host tools can still access files allowed by the OS account.

SDK-only startup routing is owned by `src/subagent-process.ts#runWorker`, not by the general allowlist or SDK resolver.
Its finite own-descriptor reader recognizes only `http_proxy`, `https_proxy`, `HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `all_proxy`, `NO_PROXY`, `no_proxy`, `NODE_USE_ENV_PROXY`, `NODE_OPTIONS`.
Absence differs from present empty/undefined/nonstring/accessor; selected readers never invoke getters or coerce values.
DIRECT requires no HTTP(S)/ALL/bypass/opt-in request, ambient or scoped; ambient `NODE_OPTIONS` alone remains dropped with no new direct-runtime gate.
VALIDATED_PROXY requires both effective HTTP/HTTPS entries exactly equal; lowercase preference cannot override conflicting uppercase entries.
Matching duplicate cases or mixed cases are allowed, without URL normalization into equality.
ALL/bypass entries refuse even when empty; a partial pair or standalone/bad opt-in refuses.
Proxy mode refuses any ambient `NODE_OPTIONS`; `NODE_USE_ENV_PROXY` may be absent or exactly `"1"`.

The exact proxy URL is at most4096 UTF-8 bytes: HTTP(S), nonempty hostname, optional decimal port1–65535 and only empty/root path.
Validate raw authority/path as well as public URL parsing; reject userinfo/raw `@`, query/fragment delimiters (even empty), normalization-hidden/non-root paths, whitespace, Unicode controls/formats/surrogates, backslashes and malformed authority/ports.
Percent-bearing authorities, including encoded ASCII, reserved characters, Cc/Cf, malformed escapes and IPv6 zones, are explicitly unsupported before public URL normalization; never decode or canonicalize them into admission.
Unencoded HTTP(S) IPv4/IPv6, punycode and safe Unicode hosts retain exact route-string projection even when public URL parsing normalizes the hostname.
Never strip credentials, synthesize a default route or claim a safe URL is trusted/reachable.
Proxy capability requires actual `process.versions.node`, absent Bun identity, and public `process.allowedNodeEnvironmentFlags.has("--use-env-proxy")`.
Missing/false/throwing/unknown support refuses before spawn; no numeric runtime minimum, guessed executable, install, parent dispatcher change, TLS override, adapter fallback or forced SSE.
Only the cached SDK env adds `HTTP_PROXY=<exact route>`, `HTTPS_PROXY=<same route>`, `NODE_USE_ENV_PROXY=1` to `safeChildEnv()`, before the worker's static SDK imports.
No lowercase copies, ALL/bypass, provider secrets, session/control IDs or preloads are promoted; the parent environment is unchanged.

The ephemeral worker captures only that uppercase pair/opt-in in RAM before asynchronous setup.
A configured projection requires nonempty equal HTTP/HTTPS strings and opt-in exactly `"1"`; this is consistency checking, not a second route parser.
After static SDK and selected official adapter imports, before runtime/session requests, it dynamically imports its declared public `undici` peer.
Require callable `EnvHttpProxyAgent`, `setGlobalDispatcher`, `getGlobalDispatcher`; construct exactly one `new EnvHttpProxyAgent({httpProxy, httpsProxy, noProxy: ""})`, retain ownership before setting once, and require public getter identity.
Missing import/API, setup throw or identity mismatch fails with fixed stage `network`, class `unsupported-network`, before ready/prompt; no raw exception or direct fallback.
SDK import-time dispatcher initialization can overwrite native startup routing; startup capability and post-import configuration are both necessary.
DIRECT adds no Undici import, constructor, setter, close or runtime gate.
Never use scoped auth.env as process routing, private dispatcher Symbols/SDK HTTP modules, `undici.install()`, fetch/WebSocket/global-class replacement, TLS overrides or adapter reconstruction.
The parent and ordinary checks remain unchanged.

Recognized scoped `auth.env` route entries may only exactly match the captured validated ambient route (opt-in exactly `"1"`).
Scoped-only/conflicting/credentialed/unsupported/accessor entries refuse; compatible recognized and unrelated provider entries remain literal stdin auth, never a spread into child env.
Capture selected presence/value/descriptor facts once in RAM, serialize the unchanged request, compare serialized scoped presence/value too, then revalidate selected ambient/scoped facts immediately before the one `runProcess` call.
A changed route/descriptor refuses, with no recapture or intervening await/alternate launcher.
This bounds trusted-parent freshness, not hostile same-process atomic isolation.
Append the entire captured credential-free proxy URL to in-memory known literals: existing longest-first `diagnosticText` redaction precedes truncation and buffers split streams/progress.
Never persist/hash real routes, snapshots or parser exceptions; transformed/unknown secrets are not universally detected.
Network refusal is fixed `unsupportedNetwork: SDK proxy configuration or runtime capability is unsupported; no worker launched.` with failed/closed, null exit/signal, duration0, empty output and truncated=false.
Here closed means no launched child exists, not an observed native wait; already-aborted requests remain fixed canceled/no-spawn.
Keep ambient-file-auth refusal and launched native settlement under their existing contracts.

### Process result → checks → human review

`RunResult` records `outcome: completed | failed | canceled | timeout | unknown`, `closed`, nullable `exitCode`/`signal`, `durationMs`, `text`, `output`, `truncated`.
The worker protocol is JSONL: first `{type:"ready"}`, optional `{type:"tool",name}`, one last `{type:"final",text,stopReason:"stop"}`.
Prompt settlement, a valid final assistant stop and normal zero close are all required; prose or exit zero alone is insufficient.
No raw tool arguments/results/thinking are forwarded as progress.

`ProcessSpec.input === undefined` means no payload: spawn stdin as ignored EOF, never inherit the terminal or write a synthetic empty chunk.
Explicit empty strings and nonempty payloads instead request a pipe with strict delivery/error handling; do not merge absence with empty through truthiness or nullish defaults.
`runWorker` always supplies its JSON envelope through that pipe; a stdin transport failure still fails even after a valid final and native zero exit.
No-input protocol fixtures still require complete valid frames and zero close; protocol describes stdout obligations, not an implicit stdin payload.
Nullable stdin cleanup must preserve unknown-stop behavior, and settlement remains on original `close`, not `exit`.
A command's native exit code and runner outcome are separate facts: an unrequested empty write must not turn a genuine successful stdin-less check into failed work.

Current bounds: **128 KiB** input; **256 KiB** aggregate process output; **64 KiB** pending protocol buffer; **4096** frames; **16 KiB** final text; **20 minutes** default worker timeout.
Child emission also caps each line at 64 KiB, SDK events at 4096 and streamed model text/thinking at 256 KiB.
Cancellation/timeout sends TERM, escalates after **1000 ms**, and reports unknown if close is unconfirmed after **3000 ms** from stop.
POSIX signals the process group; Windows signals the direct child only.
Unknown stop or uncertain release retains the new lock/blocking state; direct-child close never proves every escaped descendant stopped.

`CheckDefinition = { name, command, timeoutMs }`; optional config is `cadence-assistant-checks/1` with at most 32 definitions.
Each command/cwd/timeout is confirmed in the terminal, then executed by the parent (`/bin/sh -c` or Windows `COMSPEC /d /s /c`).
Windows `runCheck` wraps the whole approved command in one outer quote pair and sets `windowsVerbatimArguments: true`, matching Node's CMD-shell construction rather than CRT argument escaping.
Keep `/d` to disable AutoRun; CMD removes the outer pair while preserving quoted executables/arguments and the intended shell syntax.
SDK/direct Node launches leave this optional flag unset; never enable verbatim globally or change their script paths into shell commands.
Manual checks use name `Manual` and 120000 ms; the menu label `Manual command` is reserved in config.
Checks inherit the **ordinary project environment**, including any ambient credentials, plus the child guard.
Resolved SDK auth is never inserted into the parent/check environment.
Do not silently apply the SDK narrow-env policy to approved host checks.

`CheckRecord` adds `cwd`, `exitCode`, `durationMs`, `status: passed | failed | canceled | stale`, `fingerprint`, optional private log name.
Configured obligations are not identical to recorded runs: name **and command and timeout** must match, otherwise the configured check remains projected `not-run`.
Duplicate/reserved configuration names refuse.
Changed-during-check inputs become stale even at exit zero.
Missing/failed/stale/canceled checks remain unresolved when a human closes the task.
Incomplete observation does not erase the native command exit fact, but requires `reviewed-with-issues`, not verified coverage.
`done()` re-observes the fingerprint and requires issue acknowledgment for incomplete coverage, non-review phase, missing code checks, unrun configured checks or any non-passed recorded check.
`done` means human review, never certified code.

`ChangeView = { fingerprint, text, complete, git }` is bounded readonly observation.
Staged/unstaged patches, untracked content identities, binary/deletion/mode/rename facts and pre-existing dirt are shown without claiming Cadence caused them.
Git external diff/textconv are disabled; inherited `GIT_*` overrides are removed and `GIT_OPTIONAL_LOCKS=0` is set.
Own `.cadence/assistant/tasks` metadata is excluded from business freshness; check configuration is not excluded.
Gitlinks/submodule internals, ignored/unreadable/linked/oversized content, truncation and exhausted bounds explicitly limit coverage.
Non-Git inventory is not an exhaustive verifier or transactional snapshot.
Capture uses a 3-second observation deadline, Git output caps of 512 KiB, a 2000-entry/file counter, 1 MiB per inventoried file, 8 MiB aggregate and depth 16 for non-Git traversal; rendered changes cap at 128 KiB.
The non-Git counter also counts traversal entries; do not promise exactly 2000 inspected files.
Raw observed bytes feed fingerprints; sanitized displays are not literal complete patches.

## 4. Validation & Error Matrix

| Boundary                                                              | Refusal / truthful outcome                                     |
| --------------------------------------------------------------------- | -------------------------------------------------------------- |
| Nonterminal, synthetic/replayed entry, busy/untrusted host            | No task launch; startup presentation is independent            |
| Empty code plan, stale dialog/model/session/record                    | Refuse; fresh native interaction required                      |
| Missing selected state                                                | Remains absent; no reset/bootstrap on observation              |
| Unknown/corrupt/linked/oversized selected state                       | Refuse and preserve bytes                                      |
| Unsafe/conflicting/stale SDK proxy or unavailable native flag         | Fixed unsupportedNetwork; spawn0, null native facts            |
| Auth/custom transport unsupported or late after abort                 | No fallback and no late spawn                                  |
| Child public proxy bootstrap unavailable or inconsistent              | Fixed network/unsupported-network, no ready/prompt or fallback |
| Malformed UTF-8/frames, missing final, output overflow, nonzero close | Failed/incomplete, not completed                               |
| Canceled/timeout then exit zero                                       | Retain cancellation/timeout outcome                            |
| Required payload stdin error despite valid final/native exit zero     | Failed delivery; never erase the transport failure             |
| Unconfirmed close or release                                          | Interrupted/unknown; supported new writers blocked             |
| Review fingerprint changed                                            | Refuse Done; review again                                      |
| Unrun/failed/stale check or incomplete coverage                       | Explicit issues acknowledgment; never manufacture check PASS   |

## 5. Good/Base/Bad Cases

- Good: review a code plan, explicitly Start one SDK editor, confirm real parent commands, inspect existing and new dirt, then record human review.
- Base: Open interrupted context, inspect files/new lock, and explicitly Continue with fresh auth and consent; nothing resumes automatically.
- Bad: one configured command passes and another is absent, but Done reports an unqualified reviewed result.
- Good: validated ambient pair initializes native Node startup routing and the child configures its owned public dispatcher after imports; scoped auth stays literal and ordinary parent checks stay unchanged.
- Base: DIRECT has no proxy requirement and still drops ambient NODE_OPTIONS.
- Bad: silently ignore bypass, promote auth.env into process env, recapture a changed route, or call CONNECT502 expected SDK failure successful inference.
- Bad: accept percent-encoded Cf in a bare authority because public URL parsing erases it; encoded ASCII is also outside this bounded simple-authority policy, not a model eligibility failure.
- Bad: trim a filesystem root string, hide a submodule limit, clear a lock after unknown stop, or claim all arbitrary business secrets were redacted.

## 6. Tests Required

- `test/lightweight-store-controller.test.ts`: absent noncreation, selected unsafe state, supported-writer exclusion, dead unchanged informed recovery, same-revision conflicts, goal-only readonly actions, advisory planning, unrun obligations and issue acknowledgment.
- `test/lightweight-shell.test.ts`: production registrar with fake host; raw latch, stale/busy/mode/trust/child/navigation controls and no accidental readonly escalation.
- `test/lightweight-process-diff.test.ts`: finite route/case/URL/refusal/own-getter/capability/serialization freshness and aborted no-spawn; exact actual executable/worker/env-before-stdin/protocol; known proxy literals in final/split stderr/malformed tool/progress and byte truncation; preserve general/check env plus native commands/env, framing/UTF-8/flood/cancel/unknown, real whitespace paths, index preservation, gitlinks/ignored/non-Git limits and changed-during-check exit facts.
- URL correction regressions use the production runWorker selector with finite own-data fixtures: raw/encoded controls, upper/lower escapes, ASCII/reserved/invalid/double escapes and zones refuse with spawn0/fixed text/null native facts before capability/normalization; unencoded HTTP(S) ASCII/IPv4/IPv6/punycode/Unicode retains exact routes.
- `test/lightweight-sdk.test.ts`: two actual runWorker/stock-worker/pinned-public-Codex guarded numeric-loopback controls: DIRECT sink>0/proxy0, VALIDATED_PROXY sink0/exact CONNECT>=1/fixed502; ready-only/error/prepared, actual nonzero exit/close, input delivered/both EOF/no force, raw fake canary-free streams and no working-file/tool writes.
  Keep20s test/15s child budgets, all seven wire assertions, original153 cases and subsequent warning-codec controls.
  Label public-resource mocks separately: DIRECT import/set/close0, captured projection/after-import ordering, missing/bad/throwing APIs, allocated-before-failed-setter cleanup and prompt0 on bootstrap failure.
  Native loopback HTTP proxy controls require successful fixed plain/gzip responses with sink0, real original zero close and no global fetch/TLS substitution; CONNECT502 alone is not successful response coverage.
  Feature-unavailable means demonstrated no-spawn and unqualified routing, not skipped/promoted routing PASS.
  Also real SDK local HTTP key/tool, headers-only, fabricated OAuth Codex, base-URL/null-header and Azure-env lanes; not paid-provider qualification or wire coverage of every adapter.
  Effective-thinking controls keep faithful public getters in all three mock session constructors, exact settings assertions and matching absent-request-to-off behavior.
  Mismatch/missing/null/nonstring/throwing getters refuse with no subscription, stream wrapping, READY or prompt; getter reads1 and opaque exception reads0 remain explicit.
  Genuine stock-SDK nonreasoning high/xhigh and reasoning xhigh-without-map controls require stdout0, model contacts0, writes0 and original nonzero close; valid mapped xhigh requires the complete tool-result/auth cycle, exact wire effort, empty stderr and original zero close.
  Actual modern1.2 full-model session equality/effective-thinking and cache-warming-disabled eligible-metadata construction controls remain a separate pending isolated peer-domain lane, not inferred from mocks or declarations.
- `test/distribution.test.mjs` and `test/terminal-integration.test.mjs`: real source/extracted entry/operator/SDK and four regular/fullscreen production PTYs, with actual plan/Start, paging/Unicode/resize, checks, review, cancel and waited quit.
The broad negative matrix is primarily fake-host coverage; do not claim every negative was repeated through a physical terminal.
[Quality](./quality-guidelines.md) separates budgets/evidence from historical failures.

## 7. Wrong vs Correct

```ts
// Wrong: recorded runs alone do not discharge configured obligations.
const verified = task.checks.every((check) => check.status === "passed");

// Correct pattern: current definitions still absent from matching records are not-run.
const missing = definitions.filter((definition) => !task.checks.some((check) =>
  check.name === definition.name && check.command === definition.command &&
  check.timeoutMs === definition.timeoutMs));
// TaskController.done also checks current fingerprint, coverage and all recorded outcomes.
```

Wrong: `gitRoot.trim()` or canonicalizing away real filename characters.
Correct: `resolveWorkspace()` removes only Git's output terminator and canonicalizes the actual filesystem path; escape paths for display separately.
Wrong: reuse a historical approval, SQL checkpoint, process disappearance or old failed suite as current consent/success.
Correct: keep old material untouched, retain explicit uncertainty and ask for a fresh native action.
Wrong: always create stdin pipe and call `stdin.end(input ?? "")`, then treat its empty-write EPIPE as a command failure.
Correct: use ignored EOF when input is absent; pipe supplied strings, preserve strict errors and wait for native close.
Wrong: let Node's generic CRT quoting transform an approved quoted Windows CMD command, or apply verbatim to every worker.
Correct: retain the approved command's inner quotes and ordinary environment, then use the check-only outer quoting and verbatim flag:

```ts
const args = ["/d", "/s", "/c", `"${check.command}"`];
const options = { windowsVerbatimArguments: true }; // Windows runCheck only.
```

Wrong: widen `safeChildEnv`, inherit NODE_OPTIONS or treat literal resolver env as native startup initialization.
Correct: only runWorker supplies a validated cached explicit env before SDK import, and only the configured ephemeral child installs its declared public dispatcher after imports; checks/general defaults remain unchanged.
Wrong: persist a credential-free route or report native exit0 for admission refusal.
Correct: redact the entire RAM-only route literal and report spawn0/null native facts; CONNECT502 proves routing only.
