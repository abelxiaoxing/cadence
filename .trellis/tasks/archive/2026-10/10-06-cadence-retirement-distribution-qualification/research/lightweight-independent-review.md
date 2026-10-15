# Independent lightweight replacement review

## Result and authority

Reviewed the approved lightweight product, not the superseded certified executor. **Five findings fixed; no remaining blocking implementation finding identified within the reviewed bounded contract.** Local verification passes. The task remains **in progress and unreleased**: this is not whole-platform, physical-human, paid-provider or manager-install qualification.

Read current check context, PRD/design/implementation plan, explicit approval, auth decision, retirement design/inventory, core handoff including its follow-up, integration handoff/evidence and title dispositions. Reviewed the current Git diff and complete 16-owner production closure, generated operator/build, shipped roles/configuration, package audit, CI and new tests. Global official Pi SDK/extensions/TUI/provider/model/settings/security documentation and relevant SDK/UI examples were checked against installed public declarations/source. Observed docs 1.1.0 and installed peer 0.84.3 are identities, not release predicates.

No nested agents, repository Git mutation, dependency installation/change, paid-provider request, task archival, publication, consumer cleanup or legacy-state migration. Temporary Git fixtures create their own index/tree/commit objects solely for readonly observation tests; the package repository's index was not mutated. Main-owned PRD/design/status/specs/maps and historical reports were not edited.

## Findings fixed

### 1. Unrun configured checks disappeared after another check passed — high

`TaskController.checkStatuses()` displayed only recorded checks; `done()` required only that at least one recorded check passed. With configured Type check and Tests, running only Type check allowed unqualified `reviewed`, hiding the unrun Tests command.

`src/task-controller.ts` now projects current configured definitions absent from run records as **not-run** and requires reviewed-with-issues acknowledgment. Matching includes name, command and timeout, so a same-name different command does not discharge the configured check. Existing native exit/status facts remain unchanged. `src/task-store.ts` rejects duplicate names and the menu's reserved `Manual command` name rather than silently selecting/overwriting an ambiguous check. Existing records/configuration are never reset.

Regressions in `test/lightweight-store-controller.test.ts` cover partial execution, issue acknowledgment, same-name/different-command mismatch, eventual complete execution, and duplicate/reserved configuration preservation.

### 2. Parent checks silently lost the project environment — medium

`runCheck()` shared the SDK worker's narrow environment allowlist. Ordinary build/test variables disappeared, potentially changing test selection or behavior while presenting the command as an ordinary parent check.

`src/subagent-process.ts` now passes the ordinary inherited environment for explicitly approved checks, with the nested-Cadence child guard. SDK workers retain their narrow environment and anonymous-stdin auth path. Resolved SDK request credentials are never inserted into the parent or check environment. `README.md` explicitly explains that trusted checks can access ambient credentials, just like other host commands; no universal secret-discovery promise is made.

A real child regression verifies a project variable reaches the approved check, the child guard is set, and the same variable remains absent from the SDK process environment.

### 3. Git-root resolution corrupted valid whitespace paths — medium

`resolveWorkspace()` called `trim()` on `git rev-parse --show-toplevel`, removing valid trailing path characters. A real checkout ending in a space could not open.

`src/task-store.ts` removes only Git's output terminator, with platform-appropriate newline handling. Real POSIX fixtures now cover trailing space, tab, carriage return and newline plus a nested invocation cwd. `src/operator-cli.mjs` was canonically regenerated for the store changes. This is not evidence for invalid-on-Windows pathname forms.

### 4. Submodule contents were presented as complete freshness coverage — medium

A Git diff can expose only a gitlink or a generic dirty marker while nested contents change. The previous capture could return `complete: true` without inspecting those contents, including under ignore-submodule configuration.

`src/task-diff.ts` now observes bounded index entries, forces visible submodule dirt in status/diff and marks gitlink content **not inspected / incomplete**. A real Git fixture demonstrates the previous false-complete result and the new explicit limit while preserving index bytes. This does not recursively snapshot submodules: their internal edits are outside the fingerprint's content coverage and human review must retain the limitation. No transaction/CAS or exhaustive repository verifier was introduced.

### 5. CI unnecessarily selected/installed the current Node channel — medium

`.github/workflows/ci.yml` added `actions/setup-node` with `node-version: node`, contrary to the retained available-runner policy. Removed that step; CI still records actual Node/Pi/platform identities and executes the new capability suites. Engine/peer/dev metadata and `bun.lock` are unchanged. Native CI was not run by this review.

## Additional measured coverage

`test/lightweight-sdk.test.ts` adds two real SDK/native-adapter loopback lanes:

- Literal resolved base-URL override beats a deliberately unusable model URL; null Authorization suppresses the adapter's default header; unresolved model-only headers are not forwarded. This lane deliberately constructs the public resolved envelope and does not claim that every field was produced by a real provider resolver.
- Actual public parent credential resolution carries provider-scoped Azure base URL/API version into the child/native adapter; the loopback observes the expected endpoint, query and API-key header. Nothing exports that provider environment into a subprocess environment.

Existing key/tool, headers-only, diagnosis/planner readonly and OAuth-only Codex lanes still execute. These are synthetic credentials/local HTTP fixtures, not Azure/OpenAI paid-service qualification. Other allowlisted adapters remain source-reviewed but not wire-qualified here.

The private before/after control probe executes preserved preimages and current modules. Before: environment exit 7, unrun configured check hidden and accepted without acknowledgment, trailing-space root refused, gitlink coverage falsely complete. After: environment exit 0, not-run visible/refused without acknowledgment, path resolved, gitlink incomplete/visible. The probe uses Bun to load TypeScript; native process/SDK/terminal tests separately run the observed Node host.

## Production boundary review

- Sole native `/cadence` command; raw Enter is transient and consumed, mode/trust/idle/queue/session/model/record checks surround actions. New/Open/startup remain inert. Readonly roles and advisory planning have no write/edit/bash tools or parent shell-check route. Same-revision external record changes invalidate choices and survive final-save conflict.
- One supported-writer checkout lock; bounded auth/cancel/process output, no late auth spawn, normal direct-child close distinct from unknown stop. Unknown stop/release failure retains blocking state. Reopen is context, not permission or replay. Escaped descendants and external/older writers remain outside the guarantee.
- SDK child is ordinary maintained JavaScript, not CLI startup. Public exact auth/model/native adapter; in-memory stores/resources; no private runtime cast, discovery/install fallback, secret argv/file persistence or custom-transport substitution. Process final protocol plus observed zero close, not prose, determines worker completion; that completion is never a passing parent check.
- New bounded project records and private selected diagnostics only. Atomic single-record replacement/observed content identity is ordinary optimistic concurrency, not hostile-writer CAS. Missing observations remain absent; unknown/link/corrupt/oversized selected state refuses; old stores are not imported or cleaned. Historical unrelated logs are not scanned on coordination paths.
- Parent checks retain exit/duration/command/cwd and bounded output. Dirty/staged/unstaged/untracked/binary/deletion observations and baseline dirt remain visible without attribution. Redaction/display bounds and incomplete/ignored/non-Git/submodule coverage remain explicit. Human review cannot convert failed/unrun/stale checks into passes.
- All 93 inventoried retired owners are absent. Current closure remains 16 source files / 34 reviewed regular members; no old compiler/scheduler/seal/transaction/SQLite/native-helper runtime remains behind the entry/operator. Independent skills, startup, missing-only installer, licenses and role pins survive. Available APIs/capabilities, not version equality, control support.

## Retirement and evidence audit

The ledger covers 194 old files and 2,499 static title rows (2,354 test declarations plus 145 suite declarations). All 101 literal assertion references resolve. Checked every original source/script/test/support hash: 365 match integration preimages; seven earlier rewritten core owners correctly resolve to the original 438-file preimage rather than the integration post-rewrite copies. No original hash is missing. The private audit preserves both the initial seven-location mismatch observation and its explicit resolution.

Mixed PORT bodies sampled against original preimages include process protocol/flood/UTF-8, package verification, production entry and legacy preservation. New assertions actually launch native processes, mutate temporary fixture inputs or compare preserved bytes; they are not generic `true` assertions. Retired report-parsing/sealed obligation/native isolation/CAS/first-close machinery is not claimed ported. Ledger group links are related lightweight intent, **not** equivalence of one new test to every old assertion. Counts/references alone are not acceptance evidence.

Historical **5547 passed / 5 failed / 9 skipped remains FAILED/SUPERSEDED**, never a new pass. Original preimages and earlier failed diagnostic receipts remain untouched.

## Frozen final verification

Private root: `/tmp/cadence-lightweight-independent-GQj5jzP8` (0700).
Repository evidence index: `lightweight-independent-evidence.json` beside this report.
Final receipt: `final-receipt.json`, SHA256 `162e2c382488151b7249a8e1f9522d4762137a955f547e1c8bef14f3e5e281c5`.

Observed Node **v26.7.0 `/usr/bin/node`**, Linux x64, Pi coding-agent/AI **0.84.3**. **737 actual existing inputs** were hashed before/after the final serial gates, unchanged; manifest SHA256 `48b89c23f5b6bb6a27b6b58facfcd97154a3f3a1600ab9628569e857d13c80ae`. This report/evidence index are generated afterward and are not retroactively included in that input cohort.

| Final gate | Waited outcome |
| --- | --- |
| `bun run verify` | Exit 0: whole check, lint, test, pack audit |
| Full new suite | 15 files, **205 passed / 0 failed / 0 skipped**, 68.85 s |
| `bun run check:agents` | Exit 0 |
| Both current explicit traceability maps | Exit 0; 8 criteria / 17 checks, reference-valid only |
| Separate `bun pm pack --destination <private>/pack-final` | Exit 0; archive retained |
| Separate every-body/member/pin audit | Exit 0; exact 34 regular members |
| Distribution suite against that exact separate archive | Exit 0; **7 passed**, overlapping coverage, not added to 205 |
| Source/extracted × regular/fullscreen production PTYs | All four exit 0; original waitpid/receipts/transcripts retained |

The four final terminal lanes exercise actual production CLI/entry, native plan/Start consent, readonly Generate plan, real SDK write, actual true/false checks, long Unicode paging/resize, issues review, inert reopen, fresh Continue/Escape and waited quit. Identity/receipt/raw-output/archive hashes are indexed in the private final receipt. Existing trusted peer links only; no installation or source fallback for extracted package bodies.

Earlier independent diagnostic runs are retained, not summed: focused SDK's first null-header test incorrectly expected no User-Agent after fetch supplied its own `node` default. Replaced that fixture assertion with actual Authorization null suppression, which tests the intended contract. An auxiliary direct-Node TypeScript control probe could not load parameter properties / unsupported transform flag; the preserved-source comparison was subsequently run with Bun. These were fixture/probe failures, not hidden passing results or deadline increases.

## Files changed and remaining limits

Changed ten implementation/test/content files: `.github/workflows/ci.yml`, `README.md`, `src/subagent-process.ts`, `src/task-controller.ts`, `src/task-store.ts`, `src/task-diff.ts`, generated `src/operator-cli.mjs`, `test/lightweight-process-diff.test.ts`, `test/lightweight-store-controller.test.ts`, `test/lightweight-sdk.test.ts`; plus this report and its evidence index. No module/member/dependency expansion.

Native Windows/macOS CI, Windows ConPTY, manager installation, physical-human and paid-provider lanes remain unexecuted. The broad replay/busy/stale/child/navigation negative matrix uses production-shell fake-host tests; not every negative was independently repeated through a native terminal. Filesystem/process bounds are operational, not adversarial same-user containment or universal descendant closure. Checks inherit ordinary host environment by design. Unobserved submodule/ignored/oversized contents cannot receive complete freshness claims.

### Prevention handoff for main's maintained specs

Root causes were cross-layer omission (configured obligations versus recorded runs), implicit context assumptions (one environment policy for both SDK and checks, trimming filesystem identifiers), and incomplete observation presented as complete (gitlinks). Regression tests now exercise those boundaries rather than testing isolated helper output alone. The initial null-header fixture failure was a mistaken assumption about native fetch defaults, not evidence of a product auth defect; the corrected test targets Authorization suppression directly. No larger framework is needed. Main should carry these concrete contracts into its already-owned spec refresh; this review deliberately does not edit or commit those files.

Main still owns semantic spec refresh and evidence-map/acceptance decisions. No release, task completion/archive, Git commit, publication or consumer cleanup follows this review.
