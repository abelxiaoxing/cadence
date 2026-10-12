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
