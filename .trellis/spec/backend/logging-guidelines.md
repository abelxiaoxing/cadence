# Logging and Diagnostic Presentation

## Single projection owner

`src/verification-diagnostics.ts` exports:

```ts
diagnosticText(value: string, maximum = 4096,
  secrets: readonly string[] = []): string;
```

Known literal secrets are deduplicated and replaced longest-first before truncation.
OSC/CSI/remaining terminal controls and bidi overrides are stripped; Bearer values, secret-like assignments and URL userinfo are heuristically redacted.
The result is byte-bounded UTF-8 with a visible `[truncated]` marker (or dots for very small budgets), not the old head/tail feedback object.
Do not promise detection of every business secret, encoded secret or user-authored sensitive sentence.

`src/subagent-process.ts` buffers bounded complete output before sanitizing, so split UTF-8 and split known-secret chunks are not exposed through streaming output.
Progress contains only ready/tool-name notices, including known-secret redaction even in tool names.
`src/sdk-worker.mjs` emits no raw tool payloads, thinking, provider errors or credentials.

## Durable context versus diagnostics

- Project `task.json` contains small goal/plan/result/baseline, check metadata/log names and activity, not transcripts or raw command/provider output.
- `TaskStore.writeLog(lock, output)` writes one exclusive 0600 UUID `.log` under the private root, bounded/sanitized to 65536 bytes.
- `readLog(name)` validates only the selected bounded private file and returns sanitized output or fixed unavailable text.
- Do not scan, rotate, reset or clean unrelated historical logs during coordination.
- SDK input credentials live only in memory/anonymous stdin and known-secret redaction state; never persist them or add them to argv/env.

Parent-approved checks are ordinary trusted shell commands and inherit project environment, including ambient credentials.
Unlike SDK auth, all such secrets are not necessarily known to the redactor.
Users must keep secrets out of command strings, task prose and emitted output; no universal secrecy guarantee follows from sanitization.
See [workflow](./lightweight-workflow-guidelines.md) and [storage](./database-guidelines.md).

## UI and operators

Filesystem strings retain raw operational bytes; quote/escape them separately for confirmation and JSON output.
Change fingerprints hash observed raw bytes, while displayed patches are control-stripped/redacted and can be incomplete.
Never compute freshness from the sanitized display.

`startupCardLines({cwd, home, projectTrusted})` returns code-owned research-status labels plus an escaped selected/expected config path.
No trust means no config read; malformed selected configuration yields fixed text without fallback.
`src/index.ts` sends only summary lines when a path line exists, via nonpersistent `notify` in TUI/RPC; print/JSON are silent.
No endpoint, key, model or parser payload is displayed by the card.

Readonly operator success is formatted JSON; failure is fixed `operator-refused` JSON, not arbitrary filesystem/parser text.
Stored runs/checks are historical context, not newly measured freshness or a machine PASS.

## Required assertions

`test/lightweight-process-diff.test.ts`: split secret/UTF-8, terminal controls, byte bounds, tool-name redaction and different SDK/check environment policies.
`test/lightweight-sdk.test.ts`: fabricated key/header literals stay out of output and consumer files.
`test/startup-card.test.ts`: trust, malformed config, repeated nonactivating notifications and secret-free labels.
`test/distribution.test.mjs`: extracted corrupt-config refusal preserves bytes without leaking its content.

## Scenario: fixed SDK worker failure facts

### 1. Scope / Trigger

A ready SDK child may fail during prompt preflight, local request preparation, upstream handling, terminal-result validation or cleanup.
Generic stderr and host exit cannot identify those boundaries; retain fixed facts without exporting provider exceptions.
This is diagnostic visibility and fail-closed cleanup, not an auth/model/provider repair or an inference/billing certificate.

### 2. Signatures

`src/sdk-worker.mjs` keeps stdout frames `ready`, `tool{name}`, `final{text,stopReason:"stop"}` unchanged.
On failure only, stderr contains at most two <=512-byte JSON snapshots: the first observed fault before cleanup awaits, then an optional cleanup-settled snapshot with fixed fields: `stage`, `class`, `outcome`, `sdkEvents`, `inputBytes`, `modelOutputBytes`, `protocolBytes`, `terminalStopReason`, `preflight`, `requestPrepared`, `actualResponseStatus`, `cleanupFailures`, `cleanupSettled`.
The compatible generic failure line follows only a cleanup-settled attempt when aggregate capacity permits; success stderr remains empty.

### 3. Contracts

Both diagnostics share the existing256KiB aggregate protocol/output allowance; insufficient remaining capacity omits a line without repairing failure.
Counters saturate at their existing cap plus one; protocolBytes describes emission attempts, not delivered requests.
Classes/stages are code-owned labels; never extract/serialize error messages, stacks, arbitrary codes/getters, tool payloads, headers/env/key/JWT, response bodies, endpoints or usage.
Allowlisted assistant terminal stop reasons come from actual `message_end`; unobserved/invalid values remain UNKNOWN.
Public prompt preflight accepted/rejected is separate from authentication acceptance, sending or inference.
`requestPrepared` means the local public payload hook was reached, not that a request was transmitted.
Response status is only a genuinely observed integer100..599 through the public response hook; null/malformed/throwing accessors stay UNKNOWN and do not suppress the original callback.
WebSocket paths can leave HTTP status UNKNOWN; do not derive one from an error, fixture or SDK diagnostic.

Capture original hooks once from the existing option spread snapshot; ordinary non-async wrappers forward the actual SDK receiver/arguments and exact return/promise/throw/rejection identity.
Do not re-read mutable incoming callbacks or substitute their receiver; preserve the existing maxRetries0 and original payload replacement semantics.
The entire subscriber projection is locally nonthrowing: malformed/null/missing/getter-failing events record a fixed first fault and handled/coalesced abort, not raw Node exceptions.
Do not rewrite/filter provider events or add process-wide rejection suppression.
Any recorded pre-final fault, including rejected-preflight-then-resolve, blocks final emission.
Cleanup after an already emitted final is different: preserve that final as a received frame, but cleanup failure still forces nonzero close and cannot become completed work.

Cleanup independently catches unsubscribe, abort and dispose, including returned promises; bitmask1/2/4 records caught failures separately from the first fault.
Bound-triggered abort rejection is handled immediately and awaited; final abort/dispose still run independently.
The diagnostic writer cannot replace the failed outcome by throwing; no raw unhandled finally error may escape the worker.
Persist the first fixed fault before awaiting abort/cleanup: an unsettled top-level cleanup promise with no remaining native handles can end the process before finally emits anything.
`cleanupSettled:false` preserves uncertainty; do not fabricate cleanup bits or a settled snapshot from child exit.
A later snapshot is emitted only after independent cleanup attempts actually settle; both share the unchanged aggregate cap.
Original parent `RunResult.closed/exitCode/signal/outcome` remains the settlement authority, never a host/driver exit or intended process.exitCode.

### 4. Validation & Error Matrix

| Condition                                               | Required fact/outcome                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| Guards/parse/auth-model/setup/session refuses           | Fixed stage/class, nonzero; no raw exception                       |
| Prompt preflight rejects, then peer resolves valid stop | First fault retained, no final, nonzero                            |
| Malformed independently dispatched subscriber event     | Nonthrowing projection, fixed fault/handled abort; no canary/stack |
| Response status getter throws                           | UNKNOWN observation; original callback still forwarded             |
| Original request hook throws/rejects                    | Exact propagation retained; no observation-induced fallback        |
| Assistant stop exists but result/byte validation fails  | Observed reason retained separately; no successful final           |
| Cleanup fails after valid final                         | Final receipt remains, native nonzero close rejects completion     |
| Remaining aggregate capacity cannot fit diagnostic      | Omit output, retain failure; never raise cap                       |

### 5. Good/Base/Bad Cases

Good: preflight accepted, local payload prepared and observed HTTP401 are separately retained beside failed worker close.
Base: local Codex account extraction may fail without request preparation/response; UNKNOWN is correct, not inferred401.
Bad: treat ready, preflight, one native Start, model metadata or host quit as an upstream inference/fee/worker-success receipt.

### 6. Tests Required

`test/lightweight-sdk.test.ts` keeps every original guarded wire/model/auth/header/tool-result/filesystem assertion.
Native fabricated/loopback controls assert ready-only/nonzero/originalclose plus fixed refusal/result/bound/HTTP observations; success stderr stays empty.
Clearly labelled public-boundary mocks cover hook snapshot/receiver/promise/throw identity, malformed async events/throwing accessors, rejected-preflight settlement, every cleanup path, first-fault retention and diagnostic-cap/write failures.
Raw-child secret canaries must be absent before parent redaction; pure mocks are not real-provider evidence or additional hidden suite totals.

### 7. Wrong vs Correct

Wrong: serialize `error.message`, let a finally rejection print a raw stack, or pass hooks as methods of incoming mutable options.
Correct: fixed primitive diagnostics, independently handled cleanup and snapshot-captured ordinary wrappers forwarding actual SDK receivers.
Wrong: infer original worker exit from PTY/host exit0 or silently reset a failed real attempt marker.
Correct: retain actual direct-worker close facts and the first failed experiment; only a reviewed causally changed-input experiment may follow.
