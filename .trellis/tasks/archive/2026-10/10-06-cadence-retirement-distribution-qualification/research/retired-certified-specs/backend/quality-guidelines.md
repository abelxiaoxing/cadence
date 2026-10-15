# Quality Guidelines

## Current task-only source ownership

[Task Distribution and Retirement](../backend/task-distribution-guidelines.md) supersedes the historical stage/OpenSpec/evaluator ownership below.
The sole entry is `src/index.ts` → fixed completion shell; operators are bounded noncreating observations.
No historical Gate, ready receipt, automatic reopen, old cleanup or prompt marker is current authority.
All recorded earlier failures and qualification limits remain historical evidence, not current passes.

Candidate-only convergence: the appended scenario records reviewed behavior before guarded LIVE integration.
Earlier checkpoints remain historical.

> Code quality standards for the Cadence package: the standalone verification commands, the CI platform matrix, distribution rules, and testing discipline.

---

## Overview

Quality is enforced by a small set of standalone commands that run identically on a developer machine and in CI, plus a CI matrix that distinguishes *platform contracts* (what must hold on each OS) from *native qualification* (what only a real native run can prove).
The package is published after `bun run verify` and the distribution checks pass; nothing is skipped by default.

---

## Standalone Commands

| Command                                                                          | What it does                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun run check`                                                                  | `node scripts/check-syntax.mjs` (shell-free `node --check` over `src/`, `scripts/`, `test/`, `skills/`, following no directory symlinks) + `bun scripts/build-workspace-io.mjs --check` (generated-bundle freshness) + `tsc --noEmit`                                                                                                                                                  |
| `bun run lint`                                                                   | `biome check .` + `rumdl check .`                                                                                                                                                                                                                                                                                                                                                      |
| `bun run test`                                                                   | `vitest run` over the whole suite                                                                                                                                                                                                                                                                                                                                                      |
| `bun run test:target <files>`                                                    | `vitest run <files>` — the target-test discipline for focused verification                                                                                                                                                                                                                                                                                                             |
| `bun run check:agents`                                                           | `node scripts/check-agents.mjs` — validates the managed AGENTS index block                                                                                                                                                                                                                                                                                                             |
| `bun run pack:check`                                                             | `node scripts/pack-check.mjs` — builds the real tarball and verifies its member set                                                                                                                                                                                                                                                                                                    |
| `bun run traceability:check`                                                     | `node scripts/traceability-check.mjs` — verifies active OpenSpec Requirement/Scenario ownership                                                                                                                                                                                                                                                                                        |
| `bun run verify`                                                                 | `bun run check && bun run lint && bun run test && bun run pack:check` — the pre-publish gate                                                                                                                                                                                                                                                                                           |
| `bun run doctor <root>` / `bun run runs <root>`                                  | read-only operator inspection via the generated `src/operator-cli.mjs` (doctor reports package-manager selection provenance, OpenSpec resolution, and storage state; runs lists run records)                                                                                                                                                                                           |
| `bun scripts/seed-acceptance.mjs`                                                | fresh-process seed acceptance: runs a named set of durable-workflow/child/apply integration tests then `bun run check`; `--expect-not-ready` asserts the not-ready path                                                                                                                                                                                                                |
| `bun pm pack --destination <tmp>`                                                | the real pack route, run from the package directory, for distribution work                                                                                                                                                                                                                                                                                                             |
| `bun run eval:workflow`, `bun run benchmark:verification`, `bun run eval:matrix` | `scripts/evaluate-workflow.mjs` (disposable Pi RPC consumer evaluation with bounded operation/stage/usage traces frozen at deadline, optional progress snapshots, and actual configuration/source fingerprints; preflight and live-model outcomes are distinct), `scripts/benchmark-verification.mjs` (dependency I/O), `scripts/evaluate-matrix.mjs` (explicit live-model evaluation) |
| `bun scripts/benchmark-workspace.mjs`                                            | measures workspace capture/materialization throughput and the parent event-loop delay of the `workspace-io` worker                                                                                                                                                                                                                                                                     |

---

## CI Matrix

`.github/workflows/ci.yml` defines the platform contracts:

| Job                            | Platform / runtime                                                    | Contract                                                                                                                                  |
| ------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-linux`                 | ubuntu-22.04, available Node, Bun 1.3.14, Bubblewrap                  | `verify`, `check:agents`, explicit portable traceability map                                                                              |
| `task-host-platform-contract`  | Ubuntu/Windows/macOS, available native Node                           | source/extracted production, hostile Unicode/space/shell paths, task entry/source/foundation/compiler/admission                           |
| `storage-platform-contract`    | Ubuntu/Windows/macOS, available native Node                           | directory/file faults, task storage, Completion/closed-handoff/execution crash and reopen                                                 |
| `implement-isolation-contract` | ubuntu-22.04, available Node, Bubblewrap, pnpm 10.12.1 + yarn 1.22.22 | explicit Node source suites, exact archive/extracted native probes and installed-layout no-model PTY; missing requested capabilities fail |
| `host-prototype`               | windows-2022 x64, macos-15-intel x64, macos-15 arm64, available Node  | actual native platform/architecture checks, unshipped prototype `--require-native`, retained diagnostics                                  |
| `windows-implement-contract`   | windows-2022 x64, available Node                                      | native architecture, MSVC/prototype prerequisite, v2 production helper, source and extracted-package Job acceptance                       |

Node/Pi versions and ranges are not matrix eligibility requirements.
Record actual resolved identities; package engines, peer policy and dev locks remain separate and unchanged.
Real runtime/API incompatibility still fails; no version-neutral policy supplies missing native or human evidence.

Two rules fall out of the matrix:

- Windows x64 native-job acceptance is proved only by `test/windows-job-real.integration.test.ts` on a real Windows runner; local tests do not confer native qualification, as stated in `docs/windows-host-trusted.md` (the CI evidence record).
- OpenSpec contracts run against the real pinned `@fission-ai/openspec@1.5.0` with `CADENCE_REAL_OPENSPEC=1` and `OPENSPEC_TELEMETRY=0`; `src/openspec-cli.ts` keeps the invocation shell-free (explicit Node executable, no shell shim parsing, operator-only `ABEL_OPENSPEC_PACKAGE_ROOT` / `ABEL_OPENSPEC_NODE` overrides), and `scripts/ci-openspec-path.mjs` puts the actual npm global command directory on PATH.
- The status protocol is strict: `src/openspec-cli.ts` requires a boolean `isComplete`, and an optional `isPlanningComplete` must also be boolean (and is true for planning completion when present); OpenSpec commands run from the target root, never from a nested directory.

---

## Distribution Rules

- `provenance/adapted-modules.yaml` pins the three package-shipped Agent files by path, role, and SHA-256 (`agents/design-explorer.md`, `agents/diagnosis-worker.md`, `agents/implementation-worker.md`); it also records the reference provenance: attribution in `THIRD_PARTY_NOTICES.md`, license `licenses/pi-subagents-MIT.txt`, and the relocated reference repo as read-only evidence that no package resolution traverses.
- `scripts/pack-check.mjs` (P-007) builds the real tarball and verifies the exact member set against `provenance/package-members.json`, no symlinks, and the four prompt/skill/agent families.
- `scripts/traceability-check.mjs` dynamically verifies that every active Requirement/Scenario entry under `openspec/changes/` resolves and is owned exactly once by the change's `tasks.md`, and that every task reference resolves to the exact delta-spec heading it names; incomplete traceability inputs (a change with `tasks.md` but no `specs/`, or vice versa) fail the check.
- `scripts/check-agents.mjs` validates the managed `<!-- ABEL:AGENTS-INDEX:START/END -->` block in `AGENTS.md`: exactly one marker pair; no timestamps, version-policy wording, Gate/approval state, runtime IDs, or reference-package product dependencies; every backticked path must exist inside the repository and not be a symlink; command phrases must resolve on PATH.
- The target test for this package is `bun run test -- test/distribution.test.mjs`; the full distribution suite is `bun run verify` plus `bun run traceability:check`.

---

## Testing Conventions

- Naming: `*.test.ts` unit tests, `*.integration.test.ts` integration tests (real Git, real SQLite, real workers), `*.property.test.ts` property-based tests, `*.test.mjs` for plain-JS assets (skill scripts, the distribution test, configuration parsing).
- Target-test discipline: verify a change with `bun run test:target <the files that cover it>` during development, and finish with the full `bun run test` before publishing; `scripts/seed-acceptance.mjs` is the fresh-process acceptance for the durable workflow, child-session and apply paths.
- Keep raw validation output outside the checkout in owner-private development-evidence storage; task records retain bounded command/result summaries and provenance (revision, local locator, byte length and SHA-256), clearly distinguishing historical runs from current verification.
  `test/independence.test.ts` walks the working tree, including task research artifacts: do not broaden its ignores or rename raw logs inside the repository merely to evade assertions.
  Relocating existing evidence requires approval, safe non-overwriting copy/flush and byte/hash verification before removing unchanged originals; this is development evidence, not product authority or consumer-state migration.
- Injected unknown-close fixtures must retain the **exact native FD/DB and its namespace at fault capture**, before any assertion, `stat`/`fstat`, logging or other diagnostic that can throw.
  Remove the host from destructive generic teardown at that point, not after the expected refusal.
  A failed assertion, helper disposal, second close or later sibling success is not closure proof.
  Require one original close attempt, original-object/inode liveness and retained restrictions; pair with a healthy real-close control.
  Wrong: assert the captured parent identity, then remove the host from teardown.
  Correct: capture the exact resource, exclude its host from teardown, then observe/assert.
  In `test/task-shell-return.integration.test.ts`, the `hosts.indexOf(h)` / `hosts.splice(index, 1)` exclusion precedes fault diagnostics; no reset/reclose/cleanup manufactures a pass.
  R4 development violated this rule: four temporary fixture namespaces were deleted by generic teardown after a failed assertion while closure was unknown.
  No user consumer was deleted; unlogged original paths prevent a retrospective inode census.
  This remains disclosed, not repaired.
  Independent intentional-failure probes of the corrected capture-first flow retained four namespaces and 20 captured identities through actual worker exit; deliberate assertion failures are not passing normal tests, and native resources are not claimed to survive process exit.
  See the [R4 checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-r4-checkpoint.md) and external `gate2-r4-review/report.md`; scoped preservation is never a universal temporary-filesystem census.
- Opt-in environment flags make coverage real rather than skipped: `CADENCE_REAL_ISOLATION`, `CADENCE_REAL_WINDOWS_JOB`, `CADENCE_REAL_OPENSPEC`, `CADENCE_ALL_PACKAGE_MANAGERS`.
- `biome.json` keeps test files pragmatic (`noExplicitAny` and `noNonNullAssertion` off for `*.test.ts`) while source stays strict; `test/workflow-engine.integration.test.ts` and `openspec/changes/**/implement-plan.json` are formatter/linter-exempt fixtures.

---

## Forbidden Patterns

- Never use a Unix `find | xargs` traversal for syntax checks or file walking; `scripts/check-syntax.mjs` is the shell-free replacement and follows no directory symlinks.
- Never let Bun mask Node spawn behavior in the platform-contract jobs; they invoke `node node_modules/vitest/vitest.mjs` explicitly.
- Never silently skip unavailable isolation or native prerequisites; the opt-in flags turn absence into a job failure.
- Never add a tarball member without updating `provenance/package-members.json`, and never ship a changed Agent file without updating its SHA-256 pin in `provenance/adapted-modules.yaml`.
- Never put timestamps, version-policy claims, or Gate/approval state into the managed AGENTS index block; `bun run check:agents` rejects them.

---

## Common Mistakes

- Running `bun run test` as the only verification for a storage or isolation change; those paths are covered by the platform-contract jobs and the opt-in flags, not the default suite.
- Claiming "Windows works" from a local `vitest` run; only the `windows-implement-contract` and `host-prototype` jobs establish native qualification, and their artifact retention (7 days) is the evidence window.
- Editing `biome.json` to silence a source issue instead of fixing the module; overrides exist only for generated bundles, fixtures, and test pragmatism.

---

## Scenario: C4 native fixture emission and closure acknowledgement

### 1. Scope / Trigger

The original C4 rollout of `test/helpers/task-native-emit.ts` replaced repeated compilation in three native-cold-loader suites: `task-lifetime-open.integration.test.ts`, `task-lifetime-source.integration.test.ts` and `task-lifetime-host-io.test.ts` under `test/`.
The subsequent [D performance approval](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-performance-approval.md) added a fourth consumer, `test/task-lifetime-source-review.integration.test.ts`, through file-local `beforeAll`/`afterAll` only; the helper and its thirty-input inventory were unchanged at that checkpoint.
The current [Gate 2b candidate](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate2-loop-checkpoint.md) adds only `src/task-shell.ts` and `test/helpers/task-shell-registrar-host.ts` to that inventory: **32 unique inputs**, no helper semantic/compiler/options change and maximum **64** unchanged.
The [approved two-literal 30→32 correction](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-emitter-count-approval.md) is implemented and independently reviewed: exactly one count literal in each protected review file changed; every other byte, negative check and deadline remains unchanged.
Both complete suites passed **13 + 29 = 42 tests**, with check/scoped lint passing in implementation and independent review; these overlapping runs are **not 84 tests**.
Only the collection blocker is closed, not R4/timing or Gate 2/D/G2 acceptance.
Independent evidence: `/tmp/cadence-g2-d-implementation.1dzxw491/emitter-count-review/report.md`.
Compilation alone moves to beforeAll; original scenario setup, independent native child evaluation, assertions, both close-fault sides and deadlines remain in place.
This scenario records the independently reviewed fixture amendment before main's full gates, **not itself C acceptance**, a full-suite/distribution/pack checkpoint or a latency SLA.
Subsequent [qualified C acceptance](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-c-acceptance.md) remains historical ABI5 evidence, not qualification of the current D ABI6 core.
[Planning Host](../frontend/task-planning-guidelines.md#same-call-bounded-copying-and-serialization) owns the separately reviewed product codec.
No product cache, additional shipped member, production environment switch, lifetime protocol or authority follows.

### 2. Signatures

```typescript
prepareTaskNativeEmit(): Readonly<{
  loader: string; directory: string; dispose(): void;
}>
```

Zero arguments: no source-root/allowlist/compiler/options/weak-load selector.
The helper derives roots from its own location and installed compiler resolution.
`loader` contains checked native resolve/load hooks; `directory` is private fixture output, never a product permission.
`progressContender(h, id)` in `test/task-planning-c.integration.test.ts` remains a private checked-process fixture with synchronous `commit()` acknowledgement and asynchronous `close()` exit wait, not a production worker API.

### 3. Contracts

- The fourth Source review consumer preserves the complete `scenario(body)` function and all seven original body/assertion strings byte-for-byte, the default **5000-ms** case deadline and **60000-ms** child deadline, flags/native URLs/cwd/environment/buffers and per-child cleanup.
  No hook-timeout override or extra Source case was added.
  Each child still evaluates independently; only checked compiler output is shared, not modules/DBs/SDK instances/anchors.
- The current literal inventory is **32 inputs (27 product + 5 fixtures)**, maximum 64; the historical Source-only amendment needed no inventory expansion.
  Source ≤2 MiB/file and 8 MiB total, emitted output ≤4 MiB/file and 16 MiB total, manifest/package each ≤64 KiB, compiler ≤16 MiB and manifest relative paths ≤512 UTF-8 bytes.
  Closed manifest entries bind source/output bytes, hashes and descriptor stamps; runtime identity is the actual Node version, not a Node-binary digest.
- Evaluate the **captured compiler bytes**, not require.cache exports paired with a newer disk hash.
  TypeScript 6.0.3 uses the unchanged `transpileModule` expression: ES2022/ESNext/verbatimModuleSyntax, no filename option.
  Pin compiler/package/options identities; recheck source/compiler/package/output after build.
  Return emitted bytes at the original source URL so each scenario evaluates independently, without shared module/anchor/DB state.
- Require owner-private 0700 output directory and 0600 single-link output/manifest files; pin original directory/ancestors and no-follow descriptor/path stamps.
  Installed source/compiler inputs may be hardlinked/mode0666 when their exact facts are pinned; do not relabel them private output.
- Select an original literal `.ts` request **lexically before native realpath** from exact listed file/absolute/explicit-relative paths.
  Before and after one unchanged nextResolve call, read/hash the complete original selected source and recheck current manifest/package/runtime/options/private paths.
  Capture all supported result fields as own data (including null format and supported import-attribute type), require the exact full original URL, and return only after the second checks.
  No late getter, bare-alias selection, redirect to another allowed `.ts`, or `.ts`→`.js` leaf redirect is acceptable.
  Nonmatching suffixes, including ordinary query routes, delegate natively; a query/fragment itself ending in `.ts` retains full URL equality and selected-file checks.
- Resolve checks compiler **negative metadata only**: expected dev/ino/mode/uid/nlink/size/mtimeNs/ctimeNs, bounded regular owned file, fixed ancestors, O_RDONLY|O_NOFOLLOW, two actual FD observations and final path/ancestor checks.
  Matching stamps return no bytes/hash or positive byte-identity certificate.
  Manifest and package still receive complete byte/hash checks on both resolve sides.
  Bootstrap and **every matching load** unconditionally read/hash the full compiler/package/manifest, then validate selected source/output before supplying executable bytes.
  Resolve success never replaces that load check; no weak-mode boolean or mutable digest memo.
- Attempt each acquired descriptor's close once; close failure outranks success or prior refusal.
  Retain uncertain output/resources rather than retry-close, recurse through caller-modifiable paths or call disposal proof of closure.
  Capture created directory identity inside guarded initialization before chmod; a proved original private empty directory may unwind nonrecursively after chmod failure.
  Missing identity, changed inode/ancestors, symlink/nonprivate/nonempty output does not authorize guessed cleanup.
- A compiler payload-only error or same-stamp/masked byte drift may escape resolve but **must refuse first matching load before evaluation**.
  Already evaluated/cached imports where load does not run gain no fresh-evaluation guarantee.
  Same-user ABA, arbitrary foreign JS, unsupported hot edits and delegated routes are not a generic cache authority or sandbox promise.
- Contender: commit checked progress and capture clocks on the still-open original store; mandatory task-DB/coordinator close must return normally **before success acknowledgement**.
  Failure sets nonzero exit before attempting failed output; the parent still checks failed ACK and awaits actual successful child exit.
  Commit/ACK/helper-dispose flags are not resource or descendant settlement; real matching process exit ends that process's local OS resources, not other workers or anchored work in a surviving process.

### 4. Validation & Error Matrix

| Condition                                                                                                                | Required result                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Missing/unsafe input, malformed manifest, mismatched compiler/options, stale/corrupt output or unlisted matching request | Fixed `fixture-emit-*` refusal; no compile-on-miss/stale fallback or raw path/exception projection   |
| Original source changed before/inside nextResolve, redirected URL, accessor/unsupported returned metadata                | Refuse before returning the captured matching resolution; zero/one native callback respectively      |
| Compiler metadata drift during resolve                                                                                   | Refuse with existing bounded file/changed/I/O mapping; single mandatory close if acquired            |
| Compiler byte drift hidden from all metadata checks                                                                      | Resolve may succeed; full matching load refuses `fixture-emit-changed`, sentinel unexecuted          |
| Full compiler payload read failure                                                                                       | `fixture-emit-io` at bootstrap/load unless close fails                                               |
| Close throws before or after native syscall                                                                              | `fixture-emit-close` wins; one attempt, no second-close success inference                            |
| Unknown construction-directory identity or unsafe unwind                                                                 | Retain rather than recursive/guessed cleanup                                                         |
| Contender task/coordinator close or acknowledgement output failure                                                       | No successful closure ACK; failed ACK where possible and nonzero exit; parent exit check still fails |
| Native runtime/prerequisite unavailable                                                                                  | Bounded refusal/failing qualification, never a new silent skip or inferred platform pass             |

Historical `task-storage-invalid` alone proves neither corrupt data nor a timeout.
Controlled native CLOSE/SQLITE_BUSY reproduced a mechanism on precodec/current code; it does not establish the discarded historical occurrence's cause.
Do not change product error mapping, refresh the private witness or add a busy retry to conceal a fixture ACK race.

### 5. Good / Base / Bad Cases

- Good: a new native child receives verified emitted bytes at its original URL, evaluates independently and runs unchanged original close-fault assertions.
- Base: a nonmatching native import delegates; a cached import carries no new freshness claim; a legitimate peer fixture generation does not invalidate ancestor timestamps alone.
- Bad: trust resolve/mtime as a compiler hash, pair stale compiler exports with new disk bytes, share an evaluated anchor/DB, or move scenario work outside its deadline.
- Good contender: normal original-store closure precedes ACK and actual exit is separately awaited; before/after-real-close faults both fail.
- Bad contender: acknowledge commit before close, read clocks from a closed store, or regard expected tool refusal as proof that the child succeeded.

### 6. Tests Required

Keep assertions and original five-second deadlines (plus preexisting explicit longer declarations) unchanged; bounded P0/P3 profiles are not full gates or a latency SLA.
Native Windows/macOS, terminal and installed-tarball routes remain unqualified by Linux Node 26.7/Pi 0.84.3 evidence; versions are observed identities, not lane prerequisites.

| Existing test path                              | Required assertion points                                                                                                                                                                                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/task-native-emit.test.ts`                 | Compiler/options and exact output parity; all finite bounds/identity/open/read/close faults; full source/compiler/package/manifest pre/post-resolve negatives; captured metadata and one native call                                                       |
| `test/task-native-emit-review.test.ts`          | Original `.ts`→`.js`/other-allowed-`.ts` redirects refuse before evaluation; bare alias refuses; original URLs/query delegation/peer generation and pinned hardlinked inputs work; known empty unwind and both close-fault sides                           |
| `test/task-native-emit-phase-review.test.ts`    | Actual generated native hooks: full bootstrap and each first load; metadata-only resolve uses fresh FDs; actual compiler mutation with mask retained through load still hashes/refuses before never-imported sentinel; all stamp fields and close priority |
| `test/task-planning-codec.test.ts`              | Exact private codec bytes/error/reflection parity and busy SDK observations; see Planning Host, not a loader cache test                                                                                                                                    |
| `test/task-planning-c-contender-review.test.ts` | Extract actual CHILD: held close emits no ACK; task/coordinator before/after-close faults and partial/failed ACK output fail; exactly one close and real child exit                                                                                        |
| `test/task-planning-c.integration.test.ts`      | Last manager getter's separately alive checked contender commits after parent lease release; require actual injection, refused result, event+2/record+1, one retained question and successful child exit                                                   |

When an inventory expansion is approved, check all three literal-count consumers above: the normal emitter suite and both independent review suites.
Update each affected literal only within its approved boundary; keep the exact expected count (currently 32), never derive it from the actual inventory or weaken the independent maximum/bounds to avoid collection failure.
Retain the original three native suites, the fourth Source review consumer with its unchanged seven scenarios, and the **unchanged** older B H3 assertion file `test/task-authoring-tools.integration.test.ts`; finite component passes do not replace full repository/distribution/Agent/traceability and separate real-pack gates.
Test output/copies/profiles stay external/private; no source/test assertion edits merely to erase historical red evidence.
D R1–R3 review closes the demonstrated final pre-effect and fresh post-close ordering/API defects; the later [R4 continuation](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-r4-checkpoint.md) independently reviews callback-poison/original-body negative screening and bounded appended coverage.
First 50 new cases pass; second 27 pass and the enabled 4097-public-intent maximum-history case times out **20651/20000 ms**, last predeadline page unknown.
This is not 78 passing cases; maximum byte-heavy session history also remains unqualified.
[Session qualification](../frontend/task-session-guidelines.md#d-gate-2b-candidate-and-correction-qualification) distinguishes saved file-loaded callbacks, actual native phase faults/no recognition fallback and minimized detail versus raw-row paging.
Preserve old prefixes/deadlines/skip rules.
The original 43-file run remains 1840 passes/8 timeouts plus two historical collection failures; closing collection does not erase that red.
Six old composite timeouts remain unresolved despite four passing solo Source comparisons.
The research full-loop phase diagnostic timed out at its original 20000 ms: nine asks consumed 19.390 s, planning assertions were late, Return resumed after cleanup and Open was unobserved.
A later single CPU profile also timed out; inclusive weighted samples overlap and are neither isolated wall time, call counts nor demonstrated improvement.
Do not promote async late bodies into completed assertion sequences, sum selected passes into full gates, raise deadlines or silently optimize protected owners.
The protected shared-schema experiment in task research `planning-d-schema-comparison-amendment.md` remains **unapproved and unimplemented**; its technical proposal belongs there, not in current implementation contracts.
The manifest's 124 members and 12 passing distribution tests are not separate real-pack/all-body qualification.
Earlier 1234-pass serial/default foundation runs and C's accepted 123-member archive remain historical, not current-candidate full-suite/pack results.

### 7. Wrong vs Correct

```typescript
// Wrong: matching stamps/resolve are positive byte authority for later load.
if (resolved) return cachedEmit;
// Correct: inside every matching load, before returning emitted bytes:
const m = current(); // Full live compiler/package/manifest validation.
// Then verify the selected source and exact private emitted bytes.
```

```typescript
// Wrong: successful commit can race original-store closure.
writeAck(committed);
store.close();
// Correct: capture clocks while open; acknowledge only normal closure.
try {
  // Existing checked progress; committed = clocks from this original store.
} finally { store.close(); }
writeAck(committed); // Parent must still await actual child exit.
```

Neither pattern changes Source idle/currentness, native N1 visibility, private/outbox/file H3 checks or lifetime unknown-closure rules.

## Scenario: D generated dependency propagation and partial gates

### 1. Scope / Trigger

D's approved ABI6 change in `src/task-lifetime.ts` propagates through `src/directory-sync.ts` into the generated `src/workspace-io-worker.mjs`.
The frozen D boundary excluded generated files; the user subsequently approved only this derived worker in `planning-d-generated-worker-approval.md` under the active task's research records.
It was regenerated through the unchanged script in an isolated mirror and independently compared against canonical output.
Operator/script/production-entry bytes remain unchanged.
This narrow approval is not a general regeneration exception.
Last accepted B/C composition is ABI5; the current reviewed D core is ABI6.
Subsequent narrow performance approval, independent delta review and main's integrated checks clear Gate 1 technically for Gate 2 implementation only; D/whole-G2 acceptance remains pending.

### 2. Signatures

```sh
# Run from the package directory whose sources/output are being checked:
bun scripts/build-workspace-io.mjs --check
bun run check
```

`--check` compares the generated destinations without writing them, stopping at the first mismatch.
The same script without `--check` writes both generated files.
Under the approved D amendment, run that writer in a private package mirror, verify operator equality and copy back only the authorized workspace-worker bytes; do not rewrite the unchanged operator.
The script uses `Bun.build({root, target:"node", format:"esm", packages:"external", sourcemap:"none", minify:false})` with code-owned entrypoints.

### 3. Contracts

- Canonical build/check **cwd is the target package root**, including preserved baseline copies.
  Absolute entrypoints and `root` do not make Bun's emitted source comments independent of process cwd.
  A baseline script launched from the repository cwd can differ for that reason and cannot prove preexisting staleness.
- Main corrected the initial preexisting-failure diagnosis: the preserved baseline generated check **passes** at cwd `/tmp/cadence-g2-d-implementation.1dzxw491/baseline`.
  Correct-cwd current output changes the workspace worker through ABI6; operator CLI generated bytes remain unchanged.
  This establishes dependency propagation, not a stronger claim about compiler-version causation.
- Freshness failure stops composite `bun run check` before its tsc phase; a separately passing `tsc --noEmit` does not clear it.
  Trace shared-helper imports into generated consumers before excluding a generated file from a change boundary.
  If a derived delta crosses that boundary, stop for review/approval; do not hand-edit output, bypass `--check`, downgrade ABI or weaken tests.
- Historical partial checkpoint: worker storage **550 passes** and lifetime **646 passes** are separate runs.
  Earlier combined **1195/1** Source timeout remains failed history.
  After regeneration, `bun run check` and **21 worker tests** passed independently.
  The then-combined serial run was **1195/1** (original 20000-ms full-budget test); default was **1194/2** (budget and original 5000-ms Source test).
  Fixed baseline/current selected-case comparisons passed with overlapping timings; a separately profiled current budget run failed **20183/20000 ms**.
  Neither establishes the original cause or a preexisting-timeout exemption.
  Do not sum focused results into acceptance.
- Storage S1/S2, lifetime L1 and the generated delta were independently reviewed, but those timing failures kept integrated Gate 1 blocked at that checkpoint.
  Performance work was then unimplemented/pending separate approval.
  Subsequent explicit `批准` in [performance approval](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-performance-approval.md), implementation and independent delta review supersede that pending state, not the failed evidence.
  The exact amendment changes only private traversal/payload helpers, 38 appended D storage regressions and Source review loader/setup; guards/DDL/budgets/helper/compiler/options/worker/operator remain unchanged.
  [Storage Guidelines](./task-storage-guidelines.md#scenario-d-traversal-local-select-reuse-without-fact-caching) owns fresh-read/lazy-ordering contracts.
  Independent review found no blocker and freshly passed **345** focused tests, `bun run check` and scoped Biome; these overlap earlier counts, not new integrated totals.
- The fixed eight whole-file comparisons were collected once in **before-1 → current-1 → current-2 → before-2** order, budget then Source each time, under `--fileParallelism=false --cache=false`.
  CURRENT passed all original 55 storage and seven Source cases plus setup/cleanup in both invocations, with unchanged 20000/5000-ms named deadlines.
  Preset paired reduction **>=10%** and CURRENT deadline headroom **>=10%** held: budget reductions **23.1527% /16.4855%**, headroom **21.2886% /28.8957%**; Source reductions **15.5773% /17.6525%**, headroom **26.9332% /26.6350%**.
  No replacement samples, adaptive retries or isolated per-candidate speedup claim.
  BEFORE-1 budget remains **54 passed /1 timeout**, 20485.147225 ms. The original body is synchronous; the installed runner checks elapsed time after normal return, separately from assertion rejection.
  Its assertions completed and duration was not censored, permitting only the approved **diagnostic failed-control comparison**, never passing qualification.
  Other BEFORE cases passed; no new cause or latency SLA follows these combined-candidate samples.
- Source compilation cost remains visible: CURRENT non-case module time is **1241.934629 /1219.061583 ms** (about 1.2 s), versus BEFORE **5.331910 /4.938590 ms**.
  This is module duration minus seven-case sum: **setup + cleanup + runner overhead**, including emission/disposal, not exact emitter-only CPU/hook duration.
  Batched hook-receipt timestamps cannot measure emission.
  Full process walls were CURRENT **22.963/23.114 s**, BEFORE **26.716/26.471 s**; moved setup is neither zero-cost compilation nor proof of faster native closure.
- Latest [Gate 1 checkpoint](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate1-checkpoint.md): after independent review, main ran the exact original **27-file list once serial and once default**, with unchanged config/assertions/deadlines and no added skips or concurrent delegated test run.
  Serial `--fileParallelism=false --cache=false`: **1234 passed, zero failures/skips**, **1011.48 s**.
  Default `--cache=false`: **1234 passed, zero failures/skips**, **220.66 s**.
  Post-run identity checks passed; never sum these overlapping runs into 2468 tests.
  This cleared only the then-reviewed foundation for Gate 2 implementation; registrar/Return was absent at that checkpoint.
  The later implemented [Gate 2b candidate](../../tasks/09-24-cadence-task-shell-and-approval/research/planning-d-gate2-loop-checkpoint.md) remains blocked/unaccepted, with new-host/native/CLI/process-crash/full repository/distribution/Agent/traceability/real-pack gates still required.
  No D/G2 acceptance, production activation or new runtime/platform grade follows.
  Preserve earlier integrated/profiling failures, local appended-fixture FK/spy-recursion and TS7006 failures, corrected wrong-cwd diagnosis and cache incident.
  Fresh checks supersede current blockers, not historical outcomes.
- Raw logs/copies/probes stay external under `/tmp/cadence-g2-d-implementation.1dzxw491/` (the earlier foundation spec capture's checks are under `spec/`).
  Correction evidence is `storage-correction-review/review.md` and `lifetime-correction-review/report.md` there; baseline/build evidence is under `bundle-diagnostic/`.
  Performance implementation/review reports are `performance/report.md` and `performance-review/report.md`; main's commands/logs/input hashes are under `performance-integrated/`.
  This spec capture's static checks are under `performance-spec/`.
  These private locators are development evidence, not shipped authority or permanent runtime dependencies.

### 4. Validation & Error Matrix

| Observation                                                                   | Required disposition                                                                       |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Correct-cwd current generated bytes differ                                    | `workspace-io-bundle-stale`; composite check remains failed                                |
| Baseline checked from a different cwd                                         | Invalid comparison for preexisting-staleness diagnosis; repeat in baseline package cwd     |
| Derived output outside approved boundary                                      | Stop for user scope amendment; keep generated file unchanged                               |
| Standalone types/focused suites pass but composite/default combined run fails | Report each result separately; no acceptance claim                                         |
| Existing deadline exceeded                                                    | Preserve failed evidence and deadline; controlled serial reproduction is separate evidence |

### 5. Good / Base / Bad Cases

- Good: compare baseline/current builds from their respective package cwd, isolate unchanged operator output versus ABI6 worker delta, then request boundary amendment.
- Base: scoped Markdown lint verifies only the three changed specs; it qualifies no product/runtime gate.
- Bad: call a wrong-cwd baseline failure preexisting, regenerate an excluded bundle automatically, infer a compiler-version cause, or replace the combined failure with a sum of worker passes.

### 6. Tests Required

After a separately approved generated-file amendment, canonical freshness must pass alongside type/syntax checks; assert unchanged operator output and retain `test/task-lifetime-worker.test.ts`'s anchor-absence/default worker behavior.
Keep `test/task-shell-d-store.test.ts`, `test/task-shell-d-lifetime.test.ts` and unchanged A/B/C/G1/Source/N1/resource/Open regressions; separate core/SDK/native/CLI claims.
Full repository/distribution/Agent/traceability and separate real pack with exact member/body comparison remain required later; no such gates are supplied by this documentation pass.
Do not assume a check-only linter is filesystem-readonly: an external-report `rumdl check` launched from the repository cwd changed `.rumdl_cache/workspace_index.bin` and added two cache entries during the independent review.
That preservation incident remains disclosed; product/test/dependency/Git inputs were preserved, not every repository file.
For external document lint, use an external cwd plus explicitly verified cache isolation/disablement.
Sending stdout outside the checkout does not isolate tool caches.
Never delete/restore user caches to manufacture preservation.

### 7. Wrong vs Correct

Wrong: “The baseline build failed from our current checkout, so D did not cause staleness; regenerate to clear check.”
Correct: compare with each package as cwd, identify the transitive ABI6 worker delta, preserve the corrected diagnosis and obtain the missing scope approval before writing derived bytes.
Root causes to prevent are **change-propagation failure** and a **comparison-environment assumption**; targeted import-graph review and same-cwd baseline checks address them without manufacturing acceptance.

## Scenario: Candidate-only finite G2 convergence qualification

### 1. Scope / Trigger

The private convergence contract replaces per-read whole-history policy, compounded extremes and fixed performance comparisons only.
Earlier red reports and source remain failed evidence; no count here declares LIVE integration, G2 acceptance or production readiness.

### 2. Signatures

Run actual `bun run check`, scoped Biome, complete affected suites, `bun run verify`, `bun run check:agents`, `bun run traceability:check`, explicit distribution and separate `bun pm pack --destination <external>` from the sole candidate.
Current prospective `vitest.config.ts` default is `Math.min(4, availableParallelism())`; full verification must not use a serial/filter/skip substitute.

### 3. Contracts

Separate lawful retained capacity, maximum byte shape, pagination and representative complete interactions.
The four specifically authorized composite tests retain original bodies with 60000-ms watchdogs; no 18-second SLA/fixed trial sequence is reinstated.
Pure 16-MiB full reconstruction and modest regular/fullscreen native all-role positives are separate axes, not retrospective qualification of failed compounded stress.
Repository-pinned Pi 0.84.3 real OS PTY and file-loaded fresh-process recovery are distinct from SDK native fixtures and physical-human/containment claims.
Default compiler is unavailable; positives remain solely in excluded test helpers, not G3/G4 certification.
The candidate provenance list has 126 exact regular members, including the two review owners; verify actual archive set and every body hash, no helper/test/spec/cache members.
Current native-emitter inventory is exactly 34 inputs (two review-owner additions), ceiling 64; all three exact-count consumers and original assertions remain.
Retain raw logs/start-end hashes/actual waited exits externally; a detached supervisor may preserve its own wait receipt beyond a tool wait, never kill unknown resources or infer an exit.
PTY input pacing must use a minimum elapsed interval, not a single buffered-output drain; preserve raw Escape and record/assert separation without inferring UI/resource closure.
Private TMPDIR/cache/dependency paths cannot write LIVE caches; no installation, Git/admin action or old-namespace cleanup.
Full legacy verification requires a physical private `node_modules` directory, not a candidate-root symlink; preserve existing installed-copy bytes/links rather than relax dependency-root admission or report assertions.

### 4. Validation & Error Matrix

A censored tool wait/no receipt, worker error/OOM or timeout is not a passing suite or resource-close certificate.
Preserve first red, correct a concrete demonstrated defect and qualify changed bytes; no blind retry-until-green.
Missing native platforms are explicit limits, not inferred passes or silent new skips.

### 5. Good/Base/Bad Cases

Good: real full cap4 gate, unchanged inputs and actual child wait, plus exact archive/body inventory.
Base: Linux Node26/Pi0.84.3 evidence with native Windows/macOS explicitly unqualified; no prescribed Node/Pi version axes.
Bad: add overlapping tranche counts, replace full verification with serial subsets or call process exit external-worker settlement.

### 6. Tests Required

Retain all complete G1/A/B/C/D/resource/source/native/business/privacy regressions, compiler/default-unavailable and issuer negatives, and seven saved/unsaved file-loaded process cuts.
Keep explicit audit versus unrelated-history tolerance and targeted key/reference/session-ID regressions enabled.
Pack assertions must independently exclude every test helper and preserve production index/content/version/schema-profile boundaries.

### 7. Wrong vs Correct

Wrong: successful targeted totals or manifest length proves distribution/full acceptance.
Correct: execute the real complete gates and separate pack; bind results to current hashes, exact archive bodies, platform limits and preserved failed history.
