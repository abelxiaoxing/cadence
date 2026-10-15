# Lightweight spec refresh handoff

## Completed scope

Finished the interrupted **spec-only** refresh against current source/tests and the [independent review](./lightweight-independent-review.md).
This continuation changes **24 existing spec files** and adds this handoff; the other three partially refreshed backend guides were reviewed and left byte-identical.
The maintained layer set is now **27 files: 15 live guides/indexes and 12 historical tombstones**.
No product, test, package, CI, dependency, map, PRD/design/implement/status, parent-task or consumer file was changed.
No Git command, installation, paid-provider call, nested agent, task archival or heavy runtime suite was run.
Main retains final evidence, plans, maps, acceptance and release decisions.

## Exact file disposition

Under `.trellis/spec/backend/`:

- Reviewed the eight partially refreshed guides against `src/task-shell.ts`, controller/types/store/diff, process/SDK, registry, startup, operator/distribution owners and relevant current tests.
- `index.md`, `directory-structure.md`, `error-handling.md`, `lightweight-workflow-guidelines.md`: retained their substantive content; only scoped lint formatting changed (aligned tables and ascending numbering where applicable).
- `database-guidelines.md`: retained content, aligned its table and clarified that recovery rechecks **lock identity**, not a second PID probe, before unlink.
- `logging-guidelines.md`, `quality-guidelines.md`, `task-distribution-guidelines.md`: verified, unchanged by this continuation.
- Replaced nine obsolete guides with short tombstones: `task-storage-guidelines.md`, `task-plan-guidelines.md`, `task-execution-guidelines.md`, `task-authoring-guidelines.md`, `task-observation-guidelines.md`, `task-read-snapshot-guidelines.md`, `task-publication-admission-guidelines.md`, `task-execution-admission-guidelines.md`, `task-application-readiness-guidelines.md`.

Under `.trellis/spec/frontend/`:

- Rewrote seven live guides: `index.md`, `directory-structure.md`, `component-guidelines.md`, `hook-guidelines.md`, `state-management.md`, `quality-guidelines.md`, `type-safety.md`.
- They describe actual native dialogs/pager/progress/hooks and fixed Agents/independent skills/configuration, not a web frontend or removed activity/session/compiler runtime.
- Replaced `task-session-guidelines.md`, `task-source-guidelines.md`, `task-planning-guidelines.md` with historical tombstones.

Every tombstone retains its old filename as a discoverable link target and points to the exact corresponding archived body plus current authoritative guidance.
Old detailed headings/contracts live in the archive, not as active implementation instructions.
The seven-section [workflow guide](../../../spec/backend/lightweight-workflow-guidelines.md) remains the single detailed cross-layer API/field/environment/bounds/test contract; frontend guides link to it rather than adding a second framework.

## Preserved archive

The existing [archive manifest](./retired-certified-specs/manifest.json) was verified before editing and again after completion: **27 original files, 705152 bytes**, every recorded size and SHA-256 matches.
Manifest SHA-256 remains `4891873875260ecca8e98b630170022963ab06dffa76d7c6c38cfc2e598c50f7`.
No entry was missing; neither manifest nor any archived Markdown body was changed, overwritten with partial new text, or formatted.
Historical 5547 passed / 5 failed / 9 skipped remains **failed/superseded**, never a new pass.
Old preimages, diagnostic failures, task history, consumer stores and uncertain legacy resources remain untouched.

## Contracts carried forward

All five independent-review fixes are explicit in maintained guidance:

1. Current configured obligations remain not-run unless name **and command and timeout** match a recorded run; duplicate/reserved names refuse and unresolved checks require issues acknowledgment.
2. Explicitly approved parent checks inherit ordinary project environment, including possible ambient credentials; SDK workers use the narrow environment and literal resolved auth over anonymous stdin, never injected check credentials.
3. Git filesystem paths preserve whitespace: strip only the output terminator, escape presentation separately, never `trim()` operational identity.
4. Submodules/gitlinks, ignored/unreadable/linked/oversized content and truncation expose incomplete coverage; native exit facts do not certify unobserved bytes.
5. CI observes available Node/Pi/platform identity and capabilities without Node version/channel selection; engine/peer/dev metadata remains separate.

The guides also retain same-revision raw-record identity conflicts/no overwrite; no all-historical-log scan; goal-only readonly research/diagnosis; advisory readonly planning followed by a separate fresh native code Start; no readonly parent shell checks; exact model/API/auth or explicit refusal; no CLI startup migrations, credential files, `!`/`$` interpolation or fallback executor.
Cancellation is bounded operational settlement: unknown stop/release retains the new lock, not a fabricated universal descendant-closure proof.
Current roles/license/pins and the independently maintained 16-source/34-member archive policy remain explicit; no Trellis AGPL source/template was copied.

## Scoped validation

- `node_modules/.bin/rumdl check .trellis/spec/backend .trellis/spec/frontend`: exit 0, all **27 files** clean.
- Initial scoped lint found 106 formatting findings in 11 files (table alignment, ordered numbering and sentence layout); `rumdl fmt` was restricted to the two maintained layer directories, then check passed.
- `node_modules/.bin/rumdl check --no-exclude <this-handoff>`: exit 0; the normal tasks exclusion was not changed.
- `node_modules/.bin/biome check <archive-manifest>`: exit 0, one JSON file checked, no fixes; this handoff has no separate JSON metadata.
- Static relative-link audit: **112 maintained-spec links** resolve; handoff links resolve too.
- UTF-8 size audit: maintained specs total **89930 bytes**; largest is `backend/lightweight-workflow-guidelines.md` at **15902 bytes**, all below 32768.
- Seven rewritten frontend live guides range **3283–4881 bytes**; none exceeds 5 KiB.
- Archive size/hash validation passed for all 27 entries with manifest bytes unchanged.
- Baseline hash comparison confirmed only the stated spec edits within the inspected source/test/scripts/content/config/provenance/CI/task/spec cohort; this handoff is its sole new file.

Private baseline and validation scratch are under `/tmp/cadence-spec-refresh-mcbr6_i1`; they are not product/runtime evidence or shipped members.
No whole-package check/lint/tests/pack/PTY gate was rerun for this documentation-only continuation.

## Evidence limits and next ownership

The independent review's **205/0/0 across 15 files**, exact 34-member audit and four actual source/extracted regular/fullscreen PTY lanes remain prior frozen-input evidence, not new execution results from this refresh.
The PTYs exercised native plan/Start, readonly planner, real SDK edit, real passing/failing commands, issues review, paging/Unicode/resize, inert reopen, fresh Continue/Escape and waited quit.
The broader negative admission/lifecycle matrix is primarily production-shell **fake-host** coverage, not every negative repeated on a physical terminal.
SDK key/header/OAuth-only Codex/baseURL/null-header/Azure-env loopbacks are synthetic local requests, not paid-service or all-adapter wire qualification.
The new 90-second PTY watchdog/15-second interaction waits are explicit integration budgets, not retimed old five-second failures.

Native Windows/macOS, Windows ConPTY, manager installation, physical-human and paid-provider qualification remain unexecuted in the cited review.
The task remains in progress and unreleased; this handoff neither updates acceptance maps/checklists nor authorizes release, Git mutation, publication, archival or cleanup.
