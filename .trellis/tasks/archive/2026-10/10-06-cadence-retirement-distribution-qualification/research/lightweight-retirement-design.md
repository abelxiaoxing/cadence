# Lightweight Cadence retirement

## Scope and observed counts

User-approved reposition supersedes the proposal’s pending decision: trusted workflow assistant, no certified executor/transactional apply. Main owns requirements/specs/maps. Research writes only; no product changes, Git/install/agents/workloads, consumer-state inspection or qualification.

Observed **126 unique manifest members / 106 regular source files**, **194 top-level tests + 52 supporting files**, not 115/196. No fresh pack. `lightweight-retirement-inventory.json` contains paths/hashes/imports/dispositions, exact proposed members and **2,354 static test declarations** plus suites; templates/loops are not executed counts.

Historical **5547/5/9 remains failed**. Dropped contracts become SUPERSEDED, never PASSED. Preserve external preimages/logs/uncertain resources; hashes are not preimages.

## 1. Exact minimal proposed surface

Target **15 source files / 33 package members**: KEEP 3, REWRITE 10, RETIRE 93, NEW 2 modules. Replace three graph examples with one workflow example. **126 − 96 + 3 = 33**; additional members require reviewed deltas.

| Action | Exact paths under `src/` |
| --- | --- |
| KEEP | `startup-card.ts`, `install-config.mjs`, `install-config.d.mts` |
| REWRITE completely | `index.ts`, `task-shell.ts`, `task-controller.ts`, `task-store.ts`, `subagent-process.ts`, `agent-registry.ts`, `verification-diagnostics.ts`, `operator-tools.ts`, `operator-cli-entry.mjs` |
| REGENERATE | `operator-cli.mjs` |
| NEW | `task-types.ts`, `task-diff.ts` |
| RETIRE | **Every other current source file**: exact 93-path/hash list in JSON |

Replace bodies, not compatibility branches. Closure (builtins/existing peers omitted):

```text
index -> shell, startup-card -> shared/load-config
shell -> controller, types, diagnostic text
controller -> store, runner(subagent-process), diff, types
store -> types
runner -> registry, diagnostic text, types
diff -> types, diagnostic text
operator-entry -> operator-tools -> store, diagnostic text
registry / types / diagnostic text / installer -> no old modules
```

Shell owns native input/mode/session/TUI; controller one foreground writer and Start/Cancel/Continue; store bounded metadata; runner one child/check; diff freshness. Operator cannot reach controller/runner. No scheduler/second executor/framework. Parent exit0 is an observed outcome, not certification; model prose is not a check.

## 2. Extraction traps and source anchors

Static closures including types: index **87**, operator **82**, runner **11**, registry **5** files. Also audit dynamic URLs/bundles.

- `agent-registry.ts:8–12,39–45`: execution-retention brings lifetime/state/directory machinery. Keep fixed three package-relative roles/resources and reviewed pins; remove lease API. Use bounded regular/no-link reads: current `statSync` follows links.
- `subagent-process.ts:7–16,512–529`: remove leases, Bubblewrap, Jobs, backend selection and `executionOwnerRoot`. Extract bounded framing/UTF-8, final/error handling, role tools, child guard and cancellation. Rewrite disposable-workspace promises at `234–258` for ordinary checkout edits.
- Runner settings/auth at `262–337` need independent bounded I/O, narrow auth/model access and private settings/temp ownership, not transplanted leases. Disable recursive extensions/prompts and automatic install/updates. Cwd/tool allowlists are not a sandbox.
- `verification-diagnostics.ts:1–4`: remove contracts/VerificationFeedback; retain pure redactor. Existing character caps/partial ANSI regex are not complete byte/control protection. Test aggregate bytes, split UTF-8/secrets and terminal controls; no universal secret-detection claim.
- `task-shell.ts:6,37,119`: compiler/review/session composition must be replaced. Port useful Unicode/navigation behavior from review UI without its records/canonical-review graph.
- `operator-tools.ts:4–10,119,251,296–301`: remove native profiles/admission/observeTasks. Retarget doctor/runs to noncreating new-store/config/host observations. Current generated operator is ~579 KB; no old SQLite/compiler/native probes in its replacement.
- `workspace-io.ts:75`: retire dynamic worker, entry, API, workspace store and callers. `scripts/build-workspace-io.mjs:7–8` builds two bundles; replace with sole `scripts/build-operator.mjs`, updating check/pack/package scripts together.

Retire all 93 owners from **source AND shipped/generated bodies**, including compiler/scheduler/transaction/Completion/storage/native helpers. Do not retain contracts/safe-path/model-source/state-root for old imports.

## 3. New layout; untouched old data; residual guarantees

Propose `<external-state-home>/cadence-assistant-v1/<canonical-checkout-id>/`, magic/schema `cadence-workflow-assistant/1`. Never reuse `state-root.ts:128`'s `abel-cadence` root or task-v1 filenames/schema. Keep `.pi/agent/cadence/.env` only for independent research configuration.

Bounded JSON records with atomic **single-record** replacement suffice. Store plan/check command+cwd+exit/status and bounded sanitized output references, not certificates. Validate paths/links/identity/size; unknown/corrupt records refuse without reset. Coordinate supported writers across processes/sessions, not just a JS flag; uncertain ownership cannot be auto-stolen.

Old SQLite/journals, `.cadence`, `.pi`, sessions, candidate/material/resource directories, OpenSpec and Git bytes stay **entirely untouched**. Minimal product has **no legacy DB reader**. An explanatory notice or optional bounded metadata-only list is enough; no migration/permission import/reset/recovery/cleanup. Restart is context/interruption, never automatic execution.

Old installations can still edit the checkout: require prior sessions stopped; active/uncertain ownership blocks Start. Cross-version exclusion is unresolved, not grounds to retain the executor or inspect unknown roots.

Direct edits can overwrite concurrent/user edits: baseline/diff is not CAS. Capture initial dirty/index/worktree facts; distinguish existing changes, including untracked/deleted/renamed/binary files. Never reset/checkout/clean/stage/commit. Truncated/unreadable diff is incomplete; changed reviewed inputs invalidate check/review state. No atomic multi-file edit, rollback, confinement or exact-future-code approval guarantee remains.

## 4. Tests: retained invariants versus superseded mechanisms

Triage: **7 KEEP / 46 PORT / 141 RETIRE**; supporting **2 KEEP / 13 PORT / 37 RETIRE**. JSON supplies hashes/titles/imports/group reasons. PORT means extraction, not equivalence: annotate each title with new assertion or superseded guarantee before deletion. Not completed acceptance.

- **Independent:** retain config/Context7/Grok/commit/install/startup, archive audit and explicit-map checker behavior. Adapt package expectations without weakening body/link checks.
- **Entry:** source/extracted production tests retain ordinary/quoted/replayed/model-generated input, RPC+hasUI/print/json/unknown, busy/stale/canceled invocation and child negatives. Open/import/reload never reuse Start consent.
- **Store/preservation:** port foundation/authoring/restoration/checkout invariants: old/user bytes, bounds/corruption/links/new schema, one supported writer, inert reopen. SQL/first-close proofs superseded.
- **Runner:** real success/nonzero/malformed/missing-final, floods/UTF-8/timeout/cancel/unconfirmed termination. Namespace/Job descendants guarantees superseded; no cleanup/new writer on unconfirmed stop.
- **Diff:** selected apply/candidate/execution cases preserve dirty/manual changes, delete/rename/untracked/binary/path/index facts and changed review inputs. Transaction/compensation oracle retires.
- **Checks/output:** port known-correct/incorrect oracle controls to parent command outcomes; diagnostic/redaction bounds from usability/feedback tests. No PASS selector or sealed verifier.
- **Controller/UI:** small phases, explicit plan/Start/final review, canceled/stale selections, control-safe Unicode, interruption/Continue. Certified-image proofs superseded.
- **Package/PTY:** actual archive/traps/production entry and regular/fullscreen Escape/resize/navigation/Unicode/quit. Keep independent Python PTY/model-runtime helpers; replace heavy host fixtures. Not human/model proof.

Retire emitter/crash children/DB catalogs/candidate fixtures after preserving preimages outside default discovery. New default: controller/store, runner/check, diff, host/package; separate real filesystem/process/extracted/PTY integration. Define **new budgets**, interaction/cancel versus check duration. Never rewrite old 5000-ms failures into passes or silently skip capabilities.

## 5. Content/distribution/platform changes

Keep independent skills/shared config+HTTP, `.env.example`, missing-only installer, startup card, MIT license/pi-subagents attribution. Keep three professional Agent filenames/roles; rewrite candidate/certification wording for host edits/research/diagnosis/human review. Update YAML pins and runtime/test body expectations together. **No Trellis AGPL source transplantation into MIT**; independently implement architectural ideas.

Retire three `config/task-plan-draft*.json`; add `config/workflow-task.example.json`. Rewrite README/package description/owned AGENTS/operator instructions, preserving Trellis-managed block. Main owns spec/map changes. JSON supplies exact 33-member list. Retain regular/no-link/every-body/source/Agent audits; remove obsolete exe/source-manifest branch. No tests/helpers/Trellis/maps/provenance in pack. Canonically generate operator and load from real extracted node_modules without source/TS fallback.

Scripts: **5 KEEP / 4 REWRITE / 11 RETIRE**, enumerated. Retire benchmarks, Windows pack/MSVC, prototypes/old builder; retarget probes/seed/pack/audit. Add operator builder. Keep syntax/Agent-index/temp/explicit-map utilities. Engines/peers/dev pins/locks unchanged absent demonstrated need.

CI keeps available Ubuntu/Windows/macOS source controller/store/runner/entry checks, hostile Unicode-space-shell paths, real pack/body/pins, extracted operator/extension and trap consumers; actual POSIX regular/fullscreen PTY. Windows launch/cancel/argv/env needs native fixtures: no inherited Job descendant-tree guarantee, no supplied ConPTY proof. macOS trusted execution requires new qualification. Unconfirmed stop stays visible and blocks a new writer.

Retire obsolete isolation/helper CI for dropped contracts, not hidden failures. Keep historical evidence. Release remains **version-neutral identities/capabilities**. Extracted trusted-peer layout is not manager installation/human execution; missing platform/human lanes stay explicit.

## 6. Serialized one-agent retirement after runtime implementation

1. Main rewrites acceptance; freeze full preimages/evidence and rehash inventory.
2. Prove vertical slice/native fixtures and independent registry/redactor/config/operator closure.
3. Replace 10 bodies/add 2 modules/remove 93 owners coherently; audit imports, dynamic URLs, subprocesses and bundle bodies.
4. Finish 46 PORT files' title dispositions before retiring 141 suites/supporting fixtures. Keep seven independent suites. Largest audit batch: fewer tests never implies success.
5. Update Agents/pins/example/scripts/CI/docs/33-member manifest. Run new gates and separate real pack/extracted/PTY, recording identities/exits (not executed here).
6. Independently review data preservation, consent/cancel/unknown state and diff freshness; distinguish local readiness from platform/human release gates. No cleanup/Git/install/release.

**Core risk:** host trust replaces certified confinement/application/closure. Required correctness: current consent, bounded process/output, no overlapping supported writers, honest checks/diff, secret-safe presentation and preserved data. Hidden old execution machinery or false cancellation success fails the redesign.
