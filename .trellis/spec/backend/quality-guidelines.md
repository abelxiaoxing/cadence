# Backend Quality Guidelines

## Gates and scope

Run from this standalone package directory:

```sh
bun run check
bun run lint
bun run test
bun run check:agents
bun run pack:check
bun run test -- test/distribution.test.mjs
bun pm pack --destination <private-temp>
bun run traceability:check --map <repository-relative-map.json>
```

`bun run verify` is check + lint + test + pack:check; check:agents is also a separately named gate.
`check` runs JS syntax validation, canonical operator byte comparison and TypeScript no-emit.
A targeted test or temporary partial typecheck is not whole-package verification.
For documentation-only changes, run scoped `node_modules/.bin/rumdl check <paths>`; historical task copies use the existing tasks exclusion, not a new broad ignore.
Biome formats/checks JavaScript/TypeScript/JSON; do not hand-edit the generated operator.
The single generated historical `research/release-preparation/g6-current-qualified-map.json` has formatting disabled only: its compact evidence/input repetition fits the traceability checker's1MiB bound, while pretty printing does not.
Keep its parser/linter/reference/hash validation; preserve original bytes and failed/passed bindings, never broaden this exception to source/tests or general task data.

## Match the test to the boundary

- Fast controller/state tests inject services to test choice, phases, obligations and freshness without expensive host construction.
- `lightweight-store-controller` also contains real filesystem and second-process lock cases; do not call the entire file pure unit coverage.
- `lightweight-process-diff` executes actual children/checks and temporary Git/non-Git observations, preserves index bytes and tests incomplete coverage.
- `lightweight-sdk` uses actual SDK/native adapters and local HTTP fixtures with fabricated auth, including one write/tool-result cycle and readonly tool lists.
- `lightweight-shell` loads production registration with a fake host; it owns the broad stale/busy/replay/mode/navigation negative matrix.
- `distribution`, `package-audit`, `package-contract`, `independence` cover actual package boundaries and independent contracts.
- `terminal-integration` shares source/extracted × regular/fullscreen production CLI scenarios across POSIX Python PTY and an excluded Windows ConPTY fixture; each producer must wait the original process and retain receipts/transcripts.
- Windows-only console/parser/startup controls are a separate producer domain, not native passes on Linux; static source review or ordinary Windows CI cannot qualify unexecuted ConPTY.

Use explicit responsibility-appropriate budgets: SDK tests currently allow 20 seconds with a 15-second child timeout; new PTYs allow 90 seconds with 15-second interaction waits.
These are new integration scenarios, not retimed old 5000/1500/60000-ms certified-engine bodies.
An escaped fixture's eventual exit does not repair its earlier unknown-stop result.
No model prose/process exit is a passing parent check; no static reference count is execution evidence.

## Evidence and platform policy

The [independent review](../../tasks/archive/2026-10/10-06-cadence-retirement-distribution-qualification/research/lightweight-independent-review.md) records 15 files, 205 passed / 0 failed / 0 skipped, exact 34-member audit and four actual production PTYs on its frozen inputs.
This is prior local evidence, not an assertion that later edits were tested or that release is approved.
Keep failed diagnostic receipts and distinguish overlapping separate distribution runs from additional test totals.

Record actual Node executable/version, Pi identity, OS/architecture and capability results.
CI uses the runner's available Node, not setup-node version/channel selection; package engine metadata, wildcard peers, development pins and lockfile remain separate policies.
Version-neutral does not mean every Node/Pi/platform combination was executed or is known supported.
Windows/macOS native lanes, ConPTY, manager installs, physical-human and paid-provider lanes remain unqualified unless their own receipts exist.
Loopback adapters do not qualify paid services or every allowlisted adapter.
Post-import public Undici proxy configuration requires a fresh native Node22 routing receipt before claiming the observed Node22 bootstrap gap fixed; local Node26 success or mocked setter identity is not Node22 qualification.
Preserve DIRECT sink>0/proxy0/exactCONNECT0 and VALIDATED_PROXY sink0/proxy>0/exactCONNECT>=1 with the original HTTPS sink/fixed502 proxy, native exit1/close1, EOF/input/no-force and raw-canary assertions.
Missing actual startup capability remains no-spawn/unqualified routing, not a proxy pass or a new runtime-version skip.
Keep public-resource mock counts separate from native SDK controls and whole totals; configured plain/gzip loopback response controls must use stock fetch/SDK/public APIs and original bounds.
A compression incompatibility must fail visibly; never copy `undici.install()` or replace global networking implementations to hide it.
Diagnostic range15 extends only cleanup bit8; exact keys/two snapshots/512 bytes/shared256KiB and the narrowly recognized original-PID UNDICI-EHPA startup prefix remain unchanged.
Whole543/0/27 and CI38619715664 Linux542/1/27, Windows565/1/4, macOS543/0/27 are historical after new worker/package bytes, not fresh repair evidence.

## Review checklist

Check current native consent, no late auth spawn, exact transport, no resolved-secret persistence, selected-state refusal/noncreation, unknown-lock retention, configured obligations, honest diff coverage and human issues acknowledgment.
Preserve ordinary check environment and literal filesystem path bytes.
Review member closure and regenerated bundle after store/types/operator edits.
Require regression assertions at affected boundaries, not `true` placeholders or a larger proof/cache framework.
[Distribution](./task-distribution-guidelines.md) owns old assertion dispositions: historical 5547/5/9 remains failed/superseded.

## Scenario: native CI fixture coordination and diagnostics

### 1. Scope / Trigger

Native SDK, shell, extraction and terminal tests must establish their actual prerequisites rather than inherit Linux-only path or elapsed-time assumptions.
Run `38223395036` on `7db986a` had real Windows/macOS failures; keep it failed even after later repairs.

### 2. Signatures

- Node `--import` receives the existing guard URL's `.href`; the worker program argument remains a filesystem path.
- `scripts/ci-temp.mjs` exports one newly allocated canonical `cadence-ci-*` directory as `TMPDIR`, `TEMP` and `TMP` via `GITHUB_ENV`.
- The PTY fixture config gives Python a fixture-only control fd; the actual CLI closes that fd before exec.
- The sole readiness payload is `{event:"cancellation-http-pending",requestOrdinal:4,editingOrdinal:3}` from the actual parsed pending HTTP request.

### 3. Contracts

The terminal case matches its foreground view and readiness event within one shared 15-second interaction deadline, preserving the 90-second production-case budget and exact four requests.
A progress heading, worker-ready frame, timer or model prose is not HTTP readiness.
The driver buffers split/early events, caps event input at 512 bytes and preserves original waited quit/exit facts.
Readiness is a fixture prerequisite, never user consent or descendant settlement.

The round-2 Ubuntu transcript reached a failed menu after the confirmed `true` check, before the HTTP barrier; do not misdiagnose every PTY deadline as a readiness or elapsed-time defect.
Native probes demonstrated an absent-input empty-write EPIPE can override genuine exit zero, but the original CI did not upload that check's precise child exit/error.
Regression assertions must check outcome, closed state and native exit facts together; fixed random samples cannot prove a reached race absent.
Windows libuv protects stdio fd 0–2 from `fs.closeSync`, so its successful return is not proof of native reader closure.
Use genuinely established portable prerequisites or honestly labelled public parent-write-side fault injection; keep mocked lifecycle ordering separate from native/CI evidence.

CI uploads only explicitly named diagnostics beneath the exported owned temp directory: terminal `pty-receipt.json`, `terminal.bin`, sanitized `identity.json`, and distribution `distribution-diagnostics.json`.
Do not use unrelated `runner.temp`, upload whole trees/configuration/auth/peer data, or scan/reset old temp directories.
Identity/request-order diagnostics are failure-safe, bounded and omit auth headers/keys, raw bodies, prompts and environment dumps.

### 4. Validation & Error Matrix

| Condition                                                           | Required outcome                                           |
| ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Guard preload is a Windows drive path                               | ESM refusal; fix the specifier, never remove the guard     |
| Malformed, duplicate, unexpected, overflowing, missing or EOF event | Failed driver receipt, not skip or fabricated readiness    |
| CLI exits before view/event match                                   | Failed interaction with actual waitpid facts               |
| Extracted/copied tree has missing, linked or altered body           | Failed exact audit; retain first gap without source refill |
| Diagnostic write fails during another failure                       | Preserve the original failure, not diagnostic success      |
| Windows has no existing POSIX PTY producer                          | Remains outside that lane; no ConPTY evidence inferred     |

### 5. Good/Base/Bad Cases

Good: wait for actual parsed HTTP request four before Escape, then independently require the interrupted view and original waited quit.
Base: product cancellation before any HTTP request remains valid and separately tested.
Bad: increase the 1.5-second sleep, accept three-or-four requests, remove hostile path characters, or silently skip a failing native lane.

### 6. Tests Required

`test/lightweight-sdk.test.ts` keeps all guarded wire lanes; `test/lightweight-process-diff.test.ts` verifies native quoted-command behavior and check-only CMD options without weakening SDK environment isolation.
Its stdin regressions distinguish absent, explicit empty and payload demands; cover EOF/fast zero/nonzero/controller states, and retain payload-error-after-valid-final/zero, abort/unknown and real-close obligations.
No-input uses ignored EOF; required payload remains pipe-based and fail-closed.
`test/distribution.test.mjs` audits extracted/copied trees, root/ancestor link refusal and fixed application-error JSON.
`test/terminal-integration.test.mjs` keeps all four shared production scenarios, POSIX real barrier/error/exec-fd controls, and distinct Windows-native console/control/startup fixtures.
The excluded ConPTY helper is not an SDK worker, production executor or member of the 34-file package.
A repaired Linux pass is not repaired native Windows/macOS qualification; rerun the new reviewed commit on those actual runners.

### 7. Wrong vs Correct

Wrong: `fileURLToPath(guardUrl)` as an ESM preload, or an unrelated upload directory.
Correct: `guardUrl.href` for `--import` and `${{ env.TMPDIR }}` for the owned fixture producer/uploader contract.
Wrong: assert only echo output/exit zero, or claim Windows reader closure from `fs.closeSync(0)`.
Correct: also require completed/closed, distinguish demand before launching stdin transport, and label the actual regression precondition/evidence type.

## Scenario: excluded Windows ConPTY qualification

### 1. Scope / Trigger

Use only for actual Windows terminal qualification of the shared production CLI scenarios.
`test/helpers/task-shell-conpty.ps1` loads the independently implemented `.cs` helper through existing pwsh/.NET in-memory `Add-Type`; no installation, MSVC/SDK/Job, runtime dependency or source fallback.
Static/local POSIX results do not prove C# compilation, native attach, Unicode/raw/resize or original Windows quit.
Keep a distinct required `windows-conpty` lane planned until its own native evidence exists.

### 2. Signatures

```text
pwsh -NoLogo -NoProfile -NonInteractive -File <task-shell-conpty.ps1> <config>
Fixture.Run(configPath, compilationElapsedMs, pwshVersion) -> exit status
config: {root,cwd,argv,env,steps}; step: {expect?,event?,resize?,send?}
```

Helper stdin is the separate readiness pipe; Pi is created with an actual pseudoconsole, never redirected ordinary stdin/stdout or a forced isTTY/UI.
The control payload is the same fixed HTTP4/editing3 JSON event, at most 512 aggregate bytes.
Smoke-only scheduling/read-size fields and fixed helper signals are fixture prerequisites, not product RPC or authorization.
Receipt names remain `pty-receipt.json`, `terminal.bin`, `identity.json` under owned temporary roots.
Windows receipt uses `nativeWaitReturned`, `nativeWaitResult`, `exitCode`, `waitBeforeClose`, `quitObservedBeforeTeardown`, `cleanQuit`, `forced`, teardown/drain/resource facts and bounded first-fault projections; never fabricate `waitpidReturned`.

### 3. Contracts

Create synchronous noninheritable input/output pipes, HPCON flags0, pointer-sized STARTUPINFOEXW and its documented HPCON **value** attribute.
CreateProcessW receives real available Node/Pi, CRT-quoted Unicode argv and a sorted double-NUL Unicode environment, inherit=false and STARTF_USESTDHANDLES with all three standard handles NULL, matching Microsoft's inspected ConptyConnection launcher.
Never pass helper/control pipe handles as child stdio or enable general handle inheritance.
The NULL-stdio policy is a native repair candidate: prior flag-free creation succeeded but had no screen text; only new child diagnostics/native console observations can establish whether this startup change actually repaired the failure.
Windows HOME/USERPROFILE, LOCALAPPDATA, APPDATA and temp are isolated; preserve only ordinary startup system variables, not auth, NODE_OPTIONS or control/session state.
Output/input/control pumps run independently; ResizePseudoConsole receives columns/rows and must be corroborated by actual child output where asserted.
No native call return, helper exit, stdout EOF or process absence substitutes for the original Pi process handle signaled and obtained exit0 **before** force-stop or ClosePseudoConsole.
ClosePseudoConsole may return before EOF or block on older systems: keep draining on a different thread; unknown close/drain/join cannot pass.
Use the correct delete/free/close operation for attribute list, allocated env, HPCON and ordinary handles.

Strict parsing covers successfully read in-flight and already-queued bytes, split/early payload, unique exact keys, integer ordinals, malformed UTF-8, trailing/duplicate/overflow and EOF.
After cutoff request, validate remaining available input before the first successful native zero-available snapshot establishes cutoff; thread Join is not protocol drain.
`futureInputValidated:false` means later writes/closure are outside this bounded snapshot, not permanently certified absent.
Negative controls establish actual console/raw/argv/home/input-isolation prerequisites before publishing faults; a PID or forced wait is insufficient.
Late-fault controls park the reader, prove queued data or broken-pipe, then permit original unforced quit.
Startup scheduling injections are labelled injections, not reproduced OS Thread.Start failures.

Pumps distinguish attempted/started/entered/ready/joined; unstarted threads are never joined, and independent teardown attempts continue after individual failures.
Diagnostic mutations/snapshots share one lock; unjoined-worker snapshots explicitly retain uncertainty.
Keep first native wait/exit/I/O fault separate from final wait/stop facts; do not overwrite it during teardown or collect unbounded polling logs.
Complete identity projection, including helper hash reads, belongs inside the nonthrowing diagnostic boundary; fixed unavailable/null data must not replace the original failure.
Smoke-only prerequisite `identity.json` uses a distinct schema and synchronous <=8KiB writes before lazy stdio access, then fixed first-check/type/error-code/TTY/dimension/equality/raw/write facts.
It never exports actual argv/env/path, arbitrary messages/stacks or auth; missing bootstrap remains unavailable rather than inferred TTY failure.
Recorded diagnostic facts cannot satisfy CONSOLE_READY/CONSOLE_INPUT_ISOLATED output gates or replace any original prerequisite assertion.

Retain original 90s production budget including Add-Type, shared 15s view/event and 15s quit waits, 1000ms checks, pack30s/extract10s, key40ms/Escape100ms pacing and 15-minute CI job.
Windows checks are CMD builtins `exit /b 0` and `exit /b 1`; exact four HTTP requests and original consent/review/cancel steps remain unchanged.
The new helper transcript bound is 4MiB and receipt bound64KiB; overflow fails while draining, never truncates into success or changes product/POSIX limits.
Automated workflow records remain physicalHuman=false/paidProvider=false, without universal descendant closure.

### 4. Validation & Error Matrix

| Condition                                                                      | Required outcome                                                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| pwsh compilation/API/layout/launch missing or fails                            | Failed diagnostic, not skip/install/fallback                                      |
| Terminal/event prerequisite absent or child exits early                        | Failed within original shared interaction budget                                  |
| Malformed, duplicate, trailing, overflowing or EOF control input before cutoff | Preserve strict failure and first native facts                                    |
| Late queued protocol fault after original exit0                                | Preserve original quit and protocol failure separately; never cleanQuit           |
| Native wait/error followed by later successful stop                            | Retain first fault and later final facts separately                               |
| Worker startup/Ready/Join/close/drain unconfirmed                              | Independent bounded teardown; retained uncertainty, not success                   |
| Identity projection/hash/write fails                                           | Fixed unavailable metadata; original assertion/setup error preserved              |
| ConPTY differential output lacks fresh view match                              | Preserve raw transcript/failure; no stale-heading, fake screen or larger deadline |

### 5. Good/Base/Bad Cases

Good: real shared code workflow, exact HTTP4 barrier, original process wait/zero quit, then HPCON close and actual output drain.
Base: malformed helper input after genuinely observed native console/input prerequisites produces the expected failed receipt; it is not a product failure or extra suite pass.
Bad: mark ordinary Windows green, Linux producer skips or static review as ConPTY passed; close the pseudoconsole first and call the resulting process exit a clean quit.

### 6. Tests Required

`test/terminal-integration.test.mjs`: four unchanged production scenarios on each actual producer; Windows Unicode CRT argv/actual isTTY/raw/isolated home/input/no-inherit/resize/quit controls, strict event faults, gated late faults and explicit startup injections.
Keep original POSIX driver controls and native outcome/exit assertions; do not sum internal controls or overlapping separate distribution checks into whole-suite totals.
Diagnostic regression must throw during projection/helper read, not only fail target I/O; portable Windows-env assertions remain configuration coverage only.
Require actual native compilation/API/control/quit receipts before binding a Windows lane passed; available Node/Pi/pwsh/.NET/OS identity is evidence, not a new version predicate.

### 7. Wrong vs Correct

Wrong: cancel the control reader and call successful Join proof that queued tail was validated, or preserve only the final wait result.
Correct: record bounded native validation cutoff independently of Join, retain queued/in-flight faults and first native error alongside final stop facts.
Wrong: build identity hashes as arguments outside a protected writer.
Correct: evaluate the entire projection callback inside the failure-safe boundary and preserve the original error.
Wrong: infer a precise child TTY/argv/size assertion from a title-only ConPTY transcript or force-stop exit1.
Correct: retain the original failed native run, write independent bounded prerequisite facts, and distinguish a startup-policy candidate from an actually executed repair.
