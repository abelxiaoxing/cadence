# Archive closeout preflight — preparation only

**Not ready to move/archive yet:** retain final evidence and settle reference handling, then obtain the one-shot work-commit consent.
No commit consent exists.
Engineering acceptance remains complete; no product tests were rerun.

## Scope and ownership

- Active task resolved with `task.py current --source`: `.trellis/tasks/10-16-cadence-integrated-delivery` (session source).
- HEAD `9bd8a8925bb64d3195af6055075c2ed943613fe7`; branch `feat/cadence-harness-redesign`; zero staged paths.
- Current status exactly matches Main's 1,648-path snapshot: **39 modified, 12 deleted, 1,597 untracked**.
- **963 task-owned paths:** 404 frozen product/spec/build/provenance inputs plus 559 nonignored files in the eight new tasks.
  These were already dirty before this preflight; ownership follows accepted records, not this session's edits.
- All **467 final frozen inputs match**, including the 404 dirty inputs and 63 unchanged inputs.
  All 58 direct final-review hashes plus 190 final receipt/export references match.
- **685 excluded pre-existing paths:** 12 missing old G6 files, 667 untracked old archive files, four workspace files, `.trellis/.template-hashes.json`, and `.trellis/qualification/task-retirement-2026-10-16.md`.
  All occur in the original baseline with the same status; do not stage, repair, restore or clean them.
  No additional unrecognized path was found.
  Status equality is not a pre-existing-content hash proof.
- The eight trees hold 1,148 files before this report: 559 nonignored files and **589 ignored `.log` files / 984,566 bytes**.
  Preserve those existing logs on disk; do not force-add or bulk-import them.
  This audit does not certify all historical logs for publication.
- This preflight adds only `archive-preflight.md` and `archive-preflight.json`; Main must hash these two finalized files and any later explicitly retained evidence before presenting the final plan.

## Draft work commits — consent pending

Exact existing path/hash/size/status/group rows are in `archive-preflight.json`, not a directory-wide staging instruction.

1. `feat: deliver integrated Cadence dual-surface workspace` — **380 paths**: implementation, clients, tests, build scripts/assets, dependency lock/pins, provenance and notices.
2. `docs: describe the integrated Cadence service contracts` — **24 paths**: 19 maintained specs, `AGENTS.md`, `README.md`, three operational docs.
3. `docs: retain Cadence redesign plans and qualification` — **559 existing task paths** (51 root planning/status artifacts, 508 research records), these two preflight artifacts, and only the reviewed stable-evidence whitelist after Main prepares it.

Do not interpret these groups as separately qualified product releases.
Work commits first; archive bookkeeping and journal bookkeeping later, separately reviewed.
No blanket `git add`, amend, push, publication or task-state change is authorized.

## Eight-task archive behavior

All eight proposed destinations are `.trellis/tasks/archive/2026-10/<same-name>`; **zero collisions** now.
JSON lists exact source/destination paths and current metadata.
Recheck the month/collisions immediately before any future move.

- Seven children are `in_progress`, branch `feat/cadence-harness-redesign`, base `main`.
  The coordinating parent `10-16-cadence-webui-terminal` correctly remains `planning`, branch null, with seven children.
  Do not invent a branch or mark it started.
- `cmd_archive` does not require a prior completed/in-progress status.
  It changes status/completedAt, clears active session pointers, moves the tree, and invokes lifecycle hooks.
  It is **not a readonly/dry-run operation**.
- **Children first, coordinating parent last.** `find_task_by_name` searches active immediate children only, not archives.
  Archiving each child retains its parent field and the parent's children list.
  Parent-last therefore leaves all seven archived child-parent links intact.
  Parent-first would clear the parent field in active children.
- With remote `origin` and base `main`, the null-branch parent hits the PR-metadata heuristic.
  The existing `--skip-branch-validation` is appropriate **only for this coordination parent that never had its own PR branch**, after Main records that rationale; not a fabricated branch or an exemption for every child.
- Archive **defaults to auto-stage/auto-commit**: config leaves `session_auto_commit` at true.
  Every future archive call must explicitly carry `--no-commit` unless separately authorized otherwise.
  Parent would additionally carry `--skip-branch-validation`.
  No active lifecycle hooks are configured; recheck config before execution.
  `add_session.py` also defaults to auto-commit and supports `--no-commit`.

Sources: `.trellis/scripts/common/task_store.py:1177–1563`, `task_utils.py:59–173,383–499`, `task_context.py:217–267`, `.trellis/config.yaml`, `.trellis/workflow.md` Phase 3.4.

## Reference migration without rewriting history

- Live consumers: **two files / three lines / five targets**.
  `.trellis/spec/backend/service-history-capture-guidelines.md:275,277` has four history/capture links; `provenance/webui-reuse.json:471` records one historical preimage path.
  No current CI/source/scripts/tests/docs/workspace consumer references these eight task names in the audited nonignored files.
- **139 Markdown relative links within the eight-task tree survive** moving together in one month.
  Two relative links out to specs in W1's `research/dependency-provisioning-review.md` do not; retain their original text and supply explicit resolved destinations in the transition index.
  Absolute old temporary links are not fixed by a move.
- **121 historical task files contain repository-root active task paths.**
  Do not rewrite their reports, maps, old command strings, hashes or status assertions.
  Add one small stable transition index mapping the eight old roots to archived roots and exact external evidence paths to their retained copies; keep originals byte-identical.
  This is a lookup/index, not execution evidence or an automatic resolver.
- The **16 implement/check JSONL files contain 266 entries**: 120 point into moving tasks (22 self, 98 parent/sibling).
  The existing validator remaps archived **self references only**.
  Unchanged archived manifests would therefore have **98 cross-task unresolved entries**; do not report ordinary `task.py validate` as passing them.
- Preferred minimal handling: preserve originals and include the 120 derived resolutions with original manifest hashes in the new index, explicitly labeling this archived-reading resolution rather than new implementation inputs or built-in validation.
  If Main requires normal validator/clickable-link operation, separately approve narrowly remapped operational manifests/live spec links with byte-exact preimages and a new administrative delta record.
  Never replace old frozen inputs or retroactively update their hashes.
  The hash-bound provenance preimage field remains historical and resolves through the index.

## Durable final evidence — exact whitelist, not temp-tree copying

Proposed stable root: `.trellis/qualification/cadence-dual-surface-2026-10-20/` (does not exist).
JSON inventories **254 explicitly named external files, 8,123,247 bytes (7.75 MiB)** with exact SHA-256, size, proposed destination and content class:

- 52 external references directly bound by `final-review.json`: final command receipts/logs, 467-input freeze, post-matrix freeze, pack/extraction audits, exact tar, extracted adaptation records, final process inventory, and the bounded preserved failed/counterexample receipts cited by that final review.
- 174 original process/SDK/native/check/browser receipts from the six-lane `final-receipts.json` index, plus its **16 exact public-export bodies**.
  Receipt counts by lane: 156 verify, 0 pack, 0 extract, 9 extracted browser, 5 extracted native, 4 extracted operations.
- Five Main audit files: input, reference-hash, package and process audits plus the pre-acceptance ledger preimage.
- Seven exact runner/extraction/collector and extracted-matrix fixture/config files, including the two generated fixture sources whose recorded hashes also match.

The tar is **1,760,367 bytes**, SHA-256 `0358c904827e5508ac251cb98c87149ef98e14ed0640adf5097dbb95a176c995`.
Retain it, not the whole extracted package, node_modules, browser installation or temporary home.

Whitelist content review: receipts/audits contain facts and paths, not copied profiles/auth stores.
Exports contain the reviewed fabricated retained-detail text, shipped Agent prompts and sanitized `ACTUAL-PARENT-CHECK` output; they are not personal histories.
Logs are named test-command output, including failures.
Two generated test source files contain explicit **fabricated** credential literals; the only credential-pattern hit is the source assertion `Bearer fabricated-new-access`, matched to the repository fixture.
No real credential/profile material was identified in the selected text; this bounded review is not a universal secret-scanner guarantee.
No auth tree, private key, raw profile, unrelated tool-output tree or unknown external directory is whitelisted.

Copy later only after Main review, **byte-for-byte**, preserving original evidence text.
Proposed destinations append `.txt` to `.log` and `.bin` to `.tgz` solely to avoid existing global ignore rules; record the original name/path in the index.
Do not edit `.gitignore`, force-add whole trees, or rewrite embedded absolute paths.
Verify destination hashes against this inventory before relying on retained copies.
Keep existing in-repository final reports/maps/preimages (already among the 559 paths) unchanged and link them from the stable index.

This finite whitelist preserves the final independent acceptance chain, not every superseded temporary candidate.
It does not authorize old temporary-directory maintenance, deleting failed evidence, or pretending old 19/11 failures/event35 were explained.
Existing ignored task logs remain local unless separately reviewed for durable retention.

## Next steps for Main, not performed here

1. Review the 254-file whitelist and retain only approved exact bytes with a small path/hash index; settle the explicit live-link/JSONL handling above.
2. Present one three-work-commit plan including all task-owned prior-session edits and excluding the 685 old paths; obtain explicit Git consent.
3. Only afterward perform separately authorized children-first/parent-last archive bookkeeping with explicit no-auto-commit controls, verify transition hashes/links, then separately review journal bookkeeping.
   No new product run or platform/provider qualification is needed for this administrative preflight.
