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

## Match the test to the boundary

- Fast controller/state tests inject services to test choice, phases, obligations and freshness without expensive host construction.
- `lightweight-store-controller` also contains real filesystem and second-process lock cases; do not call the entire file pure unit coverage.
- `lightweight-process-diff` executes actual children/checks and temporary Git/non-Git observations, preserves index bytes and tests incomplete coverage.
- `lightweight-sdk` uses actual SDK/native adapters and local HTTP fixtures with fabricated auth, including one write/tool-result cycle and readonly tool lists.
- `lightweight-shell` loads production registration with a fake host; it owns the broad stale/busy/replay/mode/navigation negative matrix.
- `distribution`, `package-audit`, `package-contract`, `independence` cover actual package boundaries and independent contracts.
- `terminal-integration` executes source/extracted × regular/fullscreen production CLI PTYs; Python waits for original quit and retains receipts/transcripts.

Use explicit responsibility-appropriate budgets: SDK tests currently allow 20 seconds with a 15-second child timeout; new PTYs allow 90 seconds with 15-second interaction waits.
These are new integration scenarios, not retimed old 5000/1500/60000-ms certified-engine bodies.
An escaped fixture's eventual exit does not repair its earlier unknown-stop result.
No model prose/process exit is a passing parent check; no static reference count is execution evidence.

## Evidence and platform policy

The [independent review](../../tasks/10-06-cadence-retirement-distribution-qualification/research/lightweight-independent-review.md) records 15 files, 205 passed / 0 failed / 0 skipped, exact 34-member audit and four actual production PTYs on its frozen inputs.
This is prior local evidence, not an assertion that later edits were tested or that release is approved.
Keep failed diagnostic receipts and distinguish overlapping separate distribution runs from additional test totals.

Record actual Node executable/version, Pi identity, OS/architecture and capability results.
CI uses the runner's available Node, not setup-node version/channel selection; package engine metadata, wildcard peers, development pins and lockfile remain separate policies.
Version-neutral does not mean every Node/Pi/platform combination was executed or is known supported.
Windows/macOS native lanes, ConPTY, manager installs, physical-human and paid-provider lanes remain unqualified unless their own receipts exist.
Loopback adapters do not qualify paid services or every allowlisted adapter.

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
`test/terminal-integration.test.mjs` keeps all four production scenarios and real barrier/error/exec-fd controls in their existing POSIX responsibility domain.
A repaired Linux pass is not repaired native Windows/macOS qualification; rerun the new reviewed commit on those actual runners.

### 7. Wrong vs Correct

Wrong: `fileURLToPath(guardUrl)` as an ESM preload, or an unrelated upload directory.
Correct: `guardUrl.href` for `--import` and `${{ env.TMPDIR }}` for the owned fixture producer/uploader contract.
Wrong: assert only echo output/exit zero, or claim Windows reader closure from `fs.closeSync(0)`.
Correct: also require completed/closed, distinguish demand before launching stdin transport, and label the actual regression precondition/evidence type.
