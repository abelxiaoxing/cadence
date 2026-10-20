# Cadence runtime seams for WebUI and terminal collaboration

## Scope, evidence and authorization

Research-only inspection for `.trellis/tasks/10-16-cadence-webui-terminal`.
`python3 ./.trellis/scripts/task.py current --source` resolved this task through the current Pi session.
Read the PRD, maintained backend/frontend guidelines, code/tests, distribution policy, installed public Pi declarations and applicable official docs/examples.
No implementation, dependency installation, tests, packing, Cadence execution, task activation, commits or cleanup were performed.
Test references below are inspected assertions, **not fresh executed evidence**.
A readonly range check validated 108 local file:line references; this checks citation locations, not runtime behavior.
Pre-existing deleted research paths and untracked archives/task artifacts were not reset, imported, staged or repaired.
Only this research file is written by this investigation.
`pi-web-ui` reuse/license assessment is outside this delegated investigation; no executor or product-scope import is approved here.

## Executive findings

1. **Cadence currently runs one foreground operation, not a multi-agent team.**
   Three shipped Agents are alternative instruction profiles for one SDK child; the controller and checkout lock serialize supported work in a canonical checkout.
2. **Live progress is much thinner than the underlying SDK.**
   The parent sees `Agent ready` and `Tool: <name>` notices, then a settled result.
   There are no forwarded tool completion IDs, streamed text, progress percentages or persisted event replay.
3. **Readonly history is useful but cannot serve as live runtime truth unchanged.** `inspectRuns()` deliberately projects every stored `running` task as `interrupted`, even without consulting a live controller.
   A lock alone does not identify a running worker/task.
4. **Observation can preserve native execution consent.
   Browser control changes a deliberate authority boundary.**
   Controller APIs are useful internal seams, but do not independently authenticate a human or validate terminal provenance.
   Merely exposing them as HTTP/RPC is not safe reuse.
5. **The highest-leverage additional decision is runtime ownership:** browser attached to a live Pi terminal, or an owner that survives terminal exit?
   Current navigation/model change/shutdown cancels owned work; detached operation would change more than presentation.

## 1. Current runtime ownership and flow — facts

### Composition and entry authority

- `src/index.ts:6-12` registers the shell only outside `CADENCE_SUBAGENT_CHILD=1`; startup configuration notices are separate and nonactivating (`src/index.ts:11-27`).
- The only workflow command is `/cadence`; its optional argument only prefills a new goal (`src/task-shell.ts:230-240`, `295-309`).
  No browser server, workflow tool or task-control RPC is composed here.
- `TerminalEntryLatch` requires a recent raw Enter matching the editor's single-line `/cadence` text, rejects bracketed paste, clears on other input and consumes once in less than 1500 ms (`src/task-shell.ts:20-52`).
- Eligibility additionally requires TUI mode, UI availability, idle host, no queued messages and project trust (`src/task-shell.ts:54-61`).
  Modal/child checks and epoch/session/cwd currentness surround interactions (`src/task-shell.ts:230-254`).
- Code Start requires a nonblank plan, a review pager, supported exact model transport, and a new confirmation.
  Request preparation resolves current parent auth with cancellation and rechecks model/context (`src/task-shell.ts:354-432`).
- Readonly plan generation is a distinct action; the controller forces research kind irrespective of caller preparation and requires a separate Start to implement (`src/task-controller.ts:190-245`).
  Research/diagnosis have no parent shell checks (`src/task-controller.ts:247-255`).

### Controller, not terminal widgets, owns execution state

`TaskController` imports store/process/diff/types, not Pi UI APIs (`src/task-controller.ts:1-18`).
It owns one selected record, one generation counter/raw-byte persisted identity, one active abort/settled pair, and an unknown-stop blocker (`src/task-controller.ts:32-56`).
Its create/open/editPlan/start/generatePlan/check/observe/done/cancel methods have **no subscription/event bus, network API, authorization principal or resumable operation registry**.
The methods' definitions and the complete active-operation implementation are in `src/task-controller.ts:58-410`.

`CurrentChoice` binds generation, task ID, revision and raw-byte identity; it is a freshness check, not a permission token (`src/task-controller.ts:20-25`, `58-83`).
Start validates that choice, a readable code plan and a caller-supplied `currentContext()` callback (`src/task-controller.ts:197-202`).
The actual native confirmation and trusted auth/model preparation live in the shell, not inside the controller (`src/task-shell.ts:363-432`).
A server must not allow a browser to supply `currentContext: () => true`, an arbitrary `WorkerRequest`, resolved auth, or issue acknowledgment in lieu of an admission policy.

### One worker versus multiple Agents

- `roleInstructions(kind)` picks exactly one of implementation-worker, design-explorer or diagnosis-worker (`src/agent-registry.ts:32-44`).
  These are profiles, not three concurrent workers or three tracked tasks.
- Each start/generatePlan calls one `services.worker`, whose production route calls one `runProcess` launching `sdk-worker.mjs` with `process.execPath` (`src/task-controller.ts:219-228`; `src/subagent-process.ts:500-512`).
- The child creates one SDK session with explicit tools, empty extension/skill/prompt/theme/context discovery, and in-memory state (`src/sdk-worker.mjs:231-270`).
  There is no subagent tool or child scheduler in that setup.
- `active` rejects concurrent controller actions; `TaskStore.acquire()` uses one exclusive checkout lock, including for metadata writers (`src/task-controller.ts:67-76`, `293-312`; `src/task-store.ts:266-291`, `352-365`).
  Separate checkouts/processes are not globally scheduled by Cadence.
- Code has read/grep/find/ls/write/edit/bash; readonly kinds have read/grep/find/ls (`src/sdk-worker.mjs:259-262`).
  Role instructions prohibit nested workers, Git mutation/install/cleanup and certification, but ordinary host tools are **not an OS sandbox** (`src/agent-registry.ts:43-44`).
  Do not claim arbitrary shell subprocesses are impossible.

**Consequence:** multiple worker cards require new identities, coordination, write-conflict policy and outcome aggregation, not mapping the three Agent files into a board.

### Runtime lifetime

`depart()` invalidates epoch/latch/dialogs, dismisses review and awaits controller cancellation (`src/task-shell.ts:81-87`).
Session start/shutdown, model selection, and before switch/fork/tree/compact are wired to this lifecycle; navigation refuses when work was busy or remains blocked (`src/task-shell.ts:88-113`).
Parent input/tool/bash are intercepted while foreground work is busy (`src/task-shell.ts:114-133`).
Escape and progress disposal request cancellation; the screen normally completes only after the action settles (`src/task-shell.ts:176-227`).
There is no current browser-disconnect lifecycle because there is no browser surface.
Attaching/detaching an observer should not be equated with `depart()` or worker settlement.

## 2. What status and progress actually exist

| Layer                      | Available facts                                                                                                                                                                   | Important limits                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Durable task               | ID, revision, kind, goal, plan, cwd, phase, result, baseline, checks, optional review, last 64 activity entries (`src/task-types.ts:25-42`; `src/task-controller.ts:123-132`)     | No worker roster, operation kind, task-linked run ID, structured last `RunResult`, live cursor, token usage or per-tool history.                                                                      |
| Controller memory          | Selected task, `busy`, `blocked`; active abort and settlement (`src/task-controller.ts:32-56`, `306-312`)                                                                         | Not an externally observable live service; only one selected task. Unknown release can block even after native child close.                                                                           |
| Worker stdout              | `ready`, tool start **name**, final text with `stopReason:"stop"` (`src/sdk-worker.mjs:366-402`)                                                                                  | No tool IDs/end/update/result events; no text/thinking stream or progress percentage. Final frame is not native process completion.                                                                   |
| Parent progress callback   | Sanitized strings `Agent ready` and `Tool: <name>` (`src/subagent-process.ts:169-195`)                                                                                            | No run ID/timestamp/sequence. Shell replaces a single status line (`src/task-shell.ts:181-190`); no timeline is saved.                                                                                |
| Parent process result      | `completed/failed/canceled/timeout/unknown`, `closed`, exit code, signal, duration, text, output, truncated (`src/task-types.ts:49-58`)                                           | Structured value exists at settlement but is not persisted wholesale in a task. `closed:true` can also mean no child was launched.                                                                    |
| Parent check               | Exact command/cwd/timeout, exit/duration/status/fingerprint/private log (`src/task-controller.ts:269-290`)                                                                        | No live stdout callback is wired by `runCheck` or the shell; timeout/unknown are not separate `CheckRecord.status` values.                                                                            |
| Worker failure diagnostics | Fixed first-fault/cleanup snapshots with stage/class, bounded counters, stop reason, preflight, preparation/HTTP facts and cleanup flags (`src/sdk-worker.mjs:38-113`, `406-459`) | Failure-only private stderr diagnostics, not a continuous health/progress API or proof of inference. Parent currently stores output rather than interpreting these as authoritative lifecycle events. |
| Readonly operator          | Summary history/config/lock presence (`src/operator-tools.ts:5-51`)                                                                                                               | Historical checks are not freshness-verified; `running` is always projected as `interrupted`. No tool progress is available.                                                                          |

### State meanings must not be collapsed

- `running` is saved **before auth preparation and child launch**, and also used for parent checks and readonly planning (`src/task-controller.ts:203-228`, `257-267`).
  It does not establish that a model is generating or even that a child exists.
- `ready` is emitted before `session.prompt()` and its preflight (`src/sdk-worker.mjs:383-392`).
  It does not establish that a request was sent, accepted by a provider or completed.
- A `tool` notice establishes only a tool start.
  Calling it “current tool running” indefinitely or “tool succeeded” later would invent facts; the child currently drops tool completion events.
- Completed code/research/diagnosis work moves to `review`; completed advisory planning returns to `planning`.
  Failed work becomes `failed`; cancel/timeout/unknown become `interrupted` (`src/task-controller.ts:230-244`, `337-355`).
- Cancellation/timeout/unknown distinctions survive in a returned `RunResult` and bounded activity text, but not as distinct task phases.
  A check can be `stale` if inputs changed, otherwise canceled/failed/passed; timeout/unknown map to failed check status (`src/task-controller.ts:276-283`).
  Do not reconstruct a comprehensive machine event log by parsing prose.
- `done` records human review, possibly `reviewed-with-issues`, not worker success or a passing check (`src/task-controller.ts:375-401`).
  Check failure does not disappear when a person closes a task.
- `open()` projects stored running state as interrupted without writing or resuming (`src/task-controller.ts:106-121`).
  `inspectRuns()` does the same without live-controller knowledge (`src/operator-tools.ts:29-50`).
  Polling the existing `runs` output during a real active run would therefore mislabel it if presented as live status.
- `checkout.lock` contains token, parent PID, hostname, runId and root, **not task ID or worker PID** (`src/task-store.ts:266-276`).
  It is also used by short record saves.
  Lock existence is coordination information, not a worker health signal.

### SDK capability is richer than Cadence's projection

The installed declarations admit `tool_execution_start/update/end` with `toolCallId`; end has `isError` and a result, and message/turn/agent lifecycle events are available (`node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:374-412`).
`AgentSessionEvent` also declares `agent_settled`, retries and queues (`node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:40-81`); `subscribe`, `prompt`, `abort` and last assistant text are public (`:282`, `:361`, `:439`, `:657`).
Cadence uses a subscription but only forwards start names, while counting text/thinking deltas for output limits and observing assistant stop reasons (`src/sdk-worker.mjs:315-382`).

**Design option, not current behavior:** add a bounded, versioned projection of tool ID/name/start/end/error and run lifecycle, with timestamps measured by the owner, rather than exporting raw SDK messages/results/thinking.
A browser timeline could then correlate events honestly; durations measured by Cadence must be labeled as such.
Do not represent event count, elapsed time or model prose as a percentage of completed requirements.
A last-observed timestamp/no-new-events indicator can describe visibility, not diagnose a hung provider.
Forwarding new frames requires coordinated changes to the strict parent decoder, child emitter, limits and tests; unknown frames currently fail (`src/subagent-process.ts:169-195`).

## 3. Process settlement and cancellation invariants

The child awaits prompt settlement, requires a final assistant `stop` and bounded text, emits final, then independently attempts owned cleanup (`src/sdk-worker.mjs:385-459`).
Cleanup failure can make an already-emitted final unsuccessful.
The parent only returns completed protocol work with valid ready/final framing and original native zero `close`; malformed UTF-8/frames, pending tail, missing final, nonzero exit, stdin failure or overflow cannot be repaired by success prose (`src/subagent-process.ts:107-141`, `169-253`).
Settlement uses native `close`, not `exit` (`src/subagent-process.ts:235-249`).

Stop sends TERM, escalates after 1000 ms and reports unknown if close remains unconfirmed after 3000 ms; POSIX targets the group, Windows the direct child (`src/subagent-process.ts:149-168`).
Cancellation/timeout takes precedence over a subsequent zero close (`src/subagent-process.ts:118-120`).
Unknown close or uncertain release retains blocking/lock state; cancellation waits for operation settlement even on release failure (`src/task-controller.ts:337-369`, `403-409`).
This is not universal descendant closure, automatic rollback or permission to kill/recover based on a lost browser connection.

Bounds remain part of the seam: 128 KiB input, 256 KiB aggregate process output, 64 KiB pending protocol buffer, 4096 frames, 16 KiB final text (`src/subagent-process.ts:78-79`, `172-189`, `197-223`).
Parent checks use the same process owner with ordinary project environment and separately approved shell input, unlike the SDK's narrow environment/literal auth stdin route (`src/subagent-process.ts:25-48`, `480-512`, `514-537`).
A slow browser must not stall or throw into the runner's callback; observer buffering/backpressure and dropped-event signaling would need a separate bounded contract.

## 4. Store, review and compatibility seams

`TaskStore` provides bounded readonly load/list/checks/lock/log operations and guarded writes.
Reads preserve absent state; selected corrupt, linked, oversized or unexpected content refuses rather than being reset (`src/task-store.ts:48-101`, `318-350`, `401-431`).
New records live in the working copy; private coordination/logs live outside it, with additional permission checks (`src/task-store.ts:193-245`).
Updating a record requires expected revision and raw-byte identity and rechecks before single-file rename (`src/task-store.ts:352-399`).
This is optimistic supported-writer coordination, not hostile-writer filesystem CAS.

**Compatibility constraint:** the decoder rejects unknown top-level fields (`src/task-types.ts:166-182`), and the store rejects extra siblings inside a task directory (`src/task-store.ts:324-332`).
Adding `events.jsonl` under an existing `<uuid>/`, or silently extending current task JSON with live worker fields, would break old readers.
Any durable event history/new run schema needs an explicit compatibility decision and reviewed storage location; do not casually add sidecar files or migrate old records during observation.
Private logs are not an event ledger; unknown historical logs stay untouched.
Worker protocol stdout is excluded from diagnostic output; worker log names are not stored in TaskRecord, unlike check log names (`src/subagent-process.ts:215-231`; `src/task-controller.ts:269-290`, `341-344`).
Tailing existing logs therefore cannot recover a worker timeline.
A new event directory elsewhere in the checkout also needs freshness review: only `.cadence/assistant/tasks` is excluded, so new telemetry elsewhere can itself stale checks (`src/task-diff.ts:9-11`, `92-97`).

Freshness/check semantics need one shared projection:

- `observe()` delegates to bounded working-copy capture (`src/task-controller.ts:142-144`).
  It is synchronous filesystem/Git observation, not a cheap cached live feed.
- `captureChanges()` excludes only own task metadata from business freshness, disables external diff/textconv and labels baseline dirt without attribution (`src/task-diff.ts:9-14`, `92-139`).
  It has explicit time/file/byte limits (`src/task-diff.ts:14-19`, `24-79`).
  Avoid running it at UI frame frequency.
- Configured checks not matched by **name + command + timeout** remain not-run; record statuses are projected stale when fingerprints differ (`src/task-controller.ts:145-173`).
- `done()` re-observes current fingerprint and requires acknowledgment for incomplete coverage, non-review state, missing/unrun checks or nonpassed outcomes (`src/task-controller.ts:375-401`).
- Execution cwd is the current shell/controller invocation cwd, while lock/capture scope is the canonical workspace root (`src/task-shell.ts:255-265`, `419`; `src/task-controller.ts:142-144`, `267`).
  Browser task selection must not silently redefine approved execution cwd.

## 5. Browser observation versus browser control — options, not authorization

### Option A: observation dashboard, terminal remains the execution owner

Reuse bounded TaskStore/operator projections for persisted history and a live owner projection for actual active work.
An attached readonly bridge could fan out controller transitions and sanitized worker notices without starting another SDK session.
The browser needs to distinguish persisted history, currently owner-confirmed live state and unavailable/stale observation.
Snapshot plus bounded cursor/events is a possible contract; SSE versus WebSocket is not decided.

Required new seams would include:

- A shared readonly task/check/review projection, avoiding the operator's unconditional interrupted projection for an owner-confirmed active run.
- An owner-scoped operation identity linking task, action (plan/worker/check), lifecycle and last observed state; the present lock runId is not sufficient.
- A bounded observer interface outside the shell-local progress callback, with reconnect snapshot behavior and no action on connection establishment/reconnect.
- Explicit display of live-source unavailable versus recorded interrupted/failed/canceled/unknown, with no inference from socket state.

This option retains terminal Start/check/recovery confirmations.
History alone cannot satisfy **live** subagent progress acceptance.
Discovery/viewing must not implicitly create tasks, start work or expose a service; startup ownership needs explicit design.

### Option B: browser can act, same controller/process runtime

Keep execution/check/store authority in one owner and give terminal/browser separate interaction adapters.
Do not implement a browser-only SDK executor beside the existing controller.
The controller is a promising reuse seam, but browser admission needs a deliberate substitute for the shell's native latch, host trust/idle/session/model checks and confirmations.

Decide capabilities individually: create/edit plan, generate plan, Start/Continue, cancel, run checks, acknowledge review, and recover locks.
Even readonly model planning launches a worker, consumes auth/provider resources and writes a draft; it is not equivalent to viewing.
Cancel/recover are controls, not passive observation; recovery is currently an informed local dead-owner operation (`src/task-store.ts:303-316`; `src/task-shell.ts:273-292`).

Control needs authenticated human requests, task/plan/model/cwd/check-bound consent, stale-choice rejection and duplicate/replay handling.
These are proposed obligations, not existing endpoints or a chosen auth scheme.
Shared-controller selection also needs care: a browser must not call `open()` merely to display another task and thereby change the terminal's selected record/generation.
A raw byte identity is useful for conflict detection but never authorization.

### Owner lifetime is a separate product choice

1. **Terminal-attached owner:** browser is useful only while the relevant Pi host is alive; terminal departure retains current cancellation behavior.
   This is closest to the existing implementation.
2. **Persistent owner/headless service:** terminal and browser become clients of an owner with independent lifecycle.
   This changes model/auth/trust sourcing, host busy guards, shutdown/cancel semantics and deployment, even if it still calls the same controller/worker functions.

Do not promise “close the terminal and work continues” from the current foreground implementation.
Conversely, browser disconnect should not create an implicit retry or successful completion under either choice.

### Exposure and content risks

Local single-user observation still exposes goals, plans, file paths, diffs and possibly private check diagnostics.
`diagnosticText` removes terminal controls and known/heuristic secrets; it is **not HTML sanitization or universal business-secret detection** (`src/verification-diagnostics.ts:1-33`).
Use safe text/Markdown rendering and explicitly restrict what is exported; do not serve the private directory or whole checkout as static files.
Remote/multi-user access introduces identity, per-workspace authorization, origin/CSRF/WebSocket checks and credential handling beyond current contracts.
Loopback binding alone is not a complete browser-control security policy.
No existing code in this runtime establishes such a network boundary.

## 6. Pi API evidence and version caveat

Inspected local development peers report coding-agent/AI/TUI **0.84.3**; official docs/examples at `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent` report **1.2.0**.
These are observed identities, not a new version eligibility rule.
Use installed declarations for exact signatures; global docs alone are insufficient.

For citations below, `PI_DOCS` means `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/docs` and `PI_EXAMPLES` the adjacent `examples` directory.

| Assertion                                                                                      | Installed public declaration                                                                                       | Applicable official reference                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Explicit session construction can receive tools/resource loader/session/settings/model runtime | `node_modules/@earendil-works/pi-coding-agent/dist/core/sdk.d.ts:10-64`                                            | `PI_DOCS/sdk.md:97-111`; `PI_EXAMPLES/sdk/12-full-control.ts` (inspected example, not copied defaults).                                                                                                                  |
| Session subscription/prompt/abort are public                                                   | `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:282-295`, `:361`, `:439`                | `PI_DOCS/sdk.md:64-95`; `PI_EXAMPLES/sdk/01-minimal.ts`.                                                                                                                                                                 |
| Tool IDs and start/update/end/isError are available below Cadence's projection                 | `node_modules/@earendil-works/pi-agent-core/dist/types.d.ts:396-411`                                               | `PI_DOCS/json.md`, “Tool execution events”; SDK-versus-wire differences are explicitly described there.                                                                                                                  |
| `agent_end` is not sufficient to declare final session settlement                              | `node_modules/@earendil-works/pi-coding-agent/dist/core/agent-session.d.ts:40-48`                                  | `PI_DOCS/sdk.md:91-95`, `PI_DOCS/rpc.md`, “Run lifecycle”. Cadence still requires its own native child settlement.                                                                                                       |
| TUI and RPC can both have dialog UI, but raw terminal/custom UI are terminal-specific          | `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts:68-78`, `:117`, `:208-215`           | `PI_DOCS/extensions.md`, “UI and modes”; `PI_DOCS/rpc-extension-ui.md:12-26`; `PI_EXAMPLES/extensions/rpc-demo.ts`.                                                                                                      |
| Parent resolved auth and transport-identification methods are public in the installed peer     | `node_modules/@earendil-works/pi-coding-agent/dist/core/model-registry.d.ts:5-14`, `:30`, `:41-42`                 | `PI_DOCS/sdk.md`, “Configuring a session”, and `PI_DOCS/extensions.md`, “Context and session changes”, describe the model/runtime boundary; exact methods are taken from installed declarations, as those docs instruct. |
| Do not start long-lived resources merely by extension discovery                                | Extension composition must respect mode/session lifecycle; Cadence currently only registers in `src/index.ts:6-10` | `PI_DOCS/extensions.md:54-60` says no processes/sockets/watchers/timers in the factory.                                                                                                                                  |

Concrete mismatch: current global JSON docs describe `tool_execution_end.durationMs` and `agent_settled.aborted`; inspected 0.84.3 declarations above do **not** declare those fields.
Do not design the first event projection assuming them, or mistake SDK event payloads for the JSON/RPC wire shape.

**RPC is not a ready-made Cadence control shortcut.**
Official RPC UI forwards supported dialogs but makes `custom()` unavailable and `onTerminalInput()` a no-op (`PI_DOCS/rpc-extension-ui.md:12-26`).
Cadence requires `mode === "tui"`, a real raw-input latch, and custom progress/review, so merely launching Pi in RPC mode or sending `/cadence` will not authorize this workflow (`src/task-shell.ts:20-61`, `135-240`).
Using a generic Pi chat/RPC backend to create separate sessions would also bypass this controller's single-workflow truth unless explicitly adapted.
No Pi browser-attach or Cadence RPC API is assumed.

## 7. Contracts/tests deliberately affected versus invariants to keep

### Policy changes needing explicit review

| Existing contract/assertion                                                                                                 | Observation-only effect                                              | Browser-control / multi-worker effect                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| No web frontend or second executor (`.trellis/spec/frontend/index.md:3-16`; `.trellis/spec/backend/index.md:3-5`)           | “No web frontend” intentionally changes; single executor can remain. | New control authority must be specified; a second executor is not implied.                                                            |
| Only raw TUI entry is admitted (`src/task-shell.ts:20-61`, `230-240`; `test/lightweight-shell.test.ts:152-197`)             | Keep unchanged.                                                      | Browser action path is an intentional new authority channel, not a reason to fake Enter or loosen all modes.                          |
| Fresh native Start and exact auth (`test/lightweight-shell.test.ts:198-252`, `407-428`)                                     | Keep unchanged.                                                      | Preserve native tests, add browser-specific fresh consent/stale-context tests.                                                        |
| Source/extracted nonterminal CLI cannot create/start (`test/distribution.test.mjs:577-651`)                                 | Keep unchanged.                                                      | Can still remain true if control uses a separate explicit adapter; only revise if nonterminal `/cadence` is intentionally authorized. |
| Readonly operators reject start/reset/recover/run (`test/distribution.test.mjs:334-384`; `src/operator-cli-entry.mjs:4-12`) | Reuse as readonly, do not silently expand.                           | Can remain readonly with a separate control surface; expanding them is another policy change.                                         |
| One command/no workflow tools/independent skills (`test/distribution.test.mjs:408-443`)                                     | Preserve or explicitly review any new observer command.              | A browser does not require a model-callable workflow tool.                                                                            |
| Foreground departure cancels and blocks parent activity (`test/lightweight-shell.test.ts:254-310`)                          | Browser connection must not alter it.                                | Persistent owner/background execution requires a deliberate new lifecycle contract and tests.                                         |
| One active controller operation / checkout lock (`test/lightweight-store-controller.test.ts:67-132`)                        | Preserve.                                                            | Coordinated concurrent workers require reviewed changes, not dropping exclusion.                                                      |

### Core invariants recommended to survive either surface

- Viewing/opening/history never grants execution consent; readonly planning is not implementation consent.
- No automatic retries, fallback model/auth/executor, Git mutation/install/publication or consumer cleanup.
- One authoritative owner emits process/check outcomes; browser connection, worker prose and UI optimism cannot manufacture success.
- Task/view/check freshness uses current raw observations and persisted identity, not displayed text or revision alone.
- Failed/canceled/timeout/unknown outcomes, native close uncertainty and retained-lock state remain distinguishable from success.
- Parent check results stay separate from worker output; missing configured obligations remain not-run; Done remains human review.
- Selected unsafe/unknown state refuses; absence stays absent; historical artifacts/locks are never silently migrated/reset.
- Exact current parent model/auth stays server-side and crosses only the bounded child envelope; no credentials in browser events/logs.
- Terminal-only use must not require a browser/server, and independent skills/startup configuration must remain independent.

Inspected regression anchors supporting these include `test/lightweight-store-controller.test.ts:270-306` (unrun obligations), `:350-435` (same-revision conflicts), `:437-503` (advisory planning), `:504-548` (unknown/release failure), `:588-677` (late auth/cancel/reopen); `test/lightweight-process-diff.test.ts:1239-1367` (redaction/protocol/flood/cancel), `:1406-1486` (diff/index/freshness); and `test/lightweight-sdk.test.ts:68-220`, `:2089-2141`, `:2939-2963` (actual SDK cycle versus labelled mocks/effective thinking/cleanup).
The terminal integration matrix remains source/extracted × regular/fullscreen with explicit plan/Start/check/review/reopen/cancel/quit (`test/terminal-integration.test.mjs:170-172`, `427-476`).
Do not replace those terminal regressions with browser-only tests.

## 8. Distribution constraints

- Current package is standalone ESM, version 1.8.4, with one Pi extension and independent skills; Node metadata is `>=22.13.0` (`package.json:1-32`).
  It is not a web application package today.
- Exact reviewed policy is **34 regular archive members / 16 source members** (`provenance/package-members.json:1-36`; `test/distribution.test.mjs:296-319`).
  Browser bundles, server files, assets and notices require an explicit updated member policy, not disabling the audit.
- Audit checks exact membership, source bodies and Agent hashes (`scripts/package-audit.mjs:79-130`).
  UI distribution must audit built/extracted bytes, not just source.
- `src/operator-cli.mjs` is the sole generated operator; changing its bundled store/types/diagnostic dependencies requires regeneration and byte comparison (`scripts/build-operator.mjs:5-24`). `sdk-worker.mjs` is maintained JS and uses a package-relative path, not source-tree/TypeScript fallback (`src/subagent-process.ts:501-504`).
- Package tests explicitly require no `dependencies`, `workspaces` or `exports` today (`test/package-contract.test.mjs:19-40`; `test/independence.test.ts:53-65`).
  New dependencies/exports require reviewed package-contract changes.
- Host Pi peers are wildcards, development coding-agent/AI/TUI are pinned 0.84.3 and Undici 8.9.0 is a declared peer/development pin (`package.json:47-65`).
  Official `PI_DOCS/packages.md:76-92` says host-provided Pi packages should remain peers, not bundled duplicates.
  No dependency install was attempted here.
- MIT and existing pi-subagents notices/pins must remain; any new reused UI group needs its own actual upstream/license provenance.
  Cadence's license does not establish `pi-web-ui` reuse rights (`test/package-contract.test.mjs:64-69`; `.trellis/spec/backend/task-distribution-guidelines.md`, “Independent content and qualification”).
- Future validation routes: targeted `bun run test -- test/distribution.test.mjs`, separate real `bun pm pack --destination <tmp>`, and `bun run verify`; no commands were run by this research.
  Source/static references and prior suite totals are not new packaged-browser or platform evidence.

## 9. Highest-value decisions for the user

1. **Capabilities:** observation dashboard only, or which specific browser actions are authorized?
   Include plan generation, cancellation, checks, human review and lock recovery separately from Start.
2. **Ownership/lifetime:** does the browser attach to the current terminal-owned workflow, or must work continue when the terminal exits?
   The latter is a runtime/product change, not just web rendering.
3. **Worker count:** improve one-worker visibility first, or coordinate multiple workers in this iteration?
   Three role files do not provide a multi-agent runtime.
4. **Exposure:** local single-user only, or remote/multi-user?
   This determines the security/deployment boundary before selecting transport and storage.
5. **Progress depth/history:** ready + last tool + final status, correlated tool lifecycle, or broader task-level progress?
   Must reconnect/restart recover a timeline, or only a bounded current snapshot?
   More detail requires a reviewed event/privacy/schema contract; no honest percentage exists today.

**Recommendation, not approval:** start with local opt-in observation of the existing one-worker owner, shared readonly projection and bounded truthful events; keep Start/check/review terminal-authorized.
If the goal is an actionable workspace, decide authority and owner lifetime first rather than silently adding a second executor later.
