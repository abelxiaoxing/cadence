# G6 final closure — archive and live-reference transition plan

## Scope: plan only

No archive, task mutation, Git/index operation, source/script/SDK/dependency change, install, paid/native Start or CI/test rerun is performed by this document.
The [current closeout](./g6-current-G-final-closeout.md) and stable-parent `g6-before-archive-qualified-map.json` are the **pre-archive source51 qualification snapshot**.
All eight required criteria,22 required checks and six lanes now have bounded semantic evidence; the optional physical-human check is unavailable, not passed.
The original required-reference CLI538910 exited0; independent parent **semantic archive-gate review** must still confirm evidence coverage and domain boundaries, not merely count green statuses.
Only after that review may the parent perform the separately authorized G6-only transition; do not archive parent/siblings or create/select/activate another task.

## Read-only Trellis behavior established

Inspected `.trellis/scripts/common/task_store.py` (`cmd_archive`, starting1257) and `common/task_utils.py` (`archive_destination_for`, starting110).
The intended later command, without bypass flags, is:

```sh
python3 .trellis/scripts/task.py archive 10-06-cadence-retirement-distribution-qualification --no-commit
```

- Destination is `.trellis/tasks/archive/YYYY-MM/10-06-cadence-retirement-distribution-qualification`, using the execution date, not a guessed frozen month.
- A pre-existing destination must refuse **before** state mutation; do not merge, overwrite, nest, delete or silently rename a collision.
- The task must remain a real direct child of `.trellis/tasks`; branch metadata validation remains enabled, with no `--skip-branch-validation` or hook bypass.
- Only G6 `task.json` should intentionally change to `status:completed` and `completedAt:<execution-date>`; retain every other field.
- G6 `children:[]` means no child reparenting.
  Parent `planning` and siblings remain unchanged.
- Parent keeps its G6 children entry: Trellis progress treats a child absent from the active set as completed; do not remove that entry or mark the parent complete.
- Supplied pointer is already None and should stay None.
  The archive implementation may clear **Trellis-internal** session pointers to G6 before moving it; that is distinct from normal Pi/session/credential stores, which remain out of scope.
- `--no-commit` avoids automatic task-directory staging/commit, including unrelated/unreviewed material.
  It does not bypass validation or `after_archive` hooks.
- Project `.trellis/config.json` does not exist.
  Actual loader is `common/config.py` → `.trellis/config.yaml`; its inspected `hooks`/`after_archive` examples are comments, with no active archive hook configured.
- Recheck that scoped project hook configuration immediately before execution.
  Any newly defined hook must be evaluated for authorized effects **before** archive; never bypass it or mutate global configuration to proceed.
- Hook failures are warnings after the move; therefore command0 alone must not substitute for checking actual transition state and hook settlement.

No normal credential/config/session store was inspected; the explicitly requested project workflow configuration is the sole configuration inspection here.

## Complete move inventory and preservation contract

The frozen222 source inventory contains **40 tracked G6-prefixed files**, not two.
They include PRD/design/implement, task/context JSONL, acceptance-map-ci and the27 retired specification bodies plus manifest.
A later archive moves the **whole task directory**, including the hundreds of additional public untracked research/evidence records, not just these40 files.
P's `archive-plan-reference-inventory.json` records the exact40 qualification paths and a separate complete current G6 resource inventory, using lstat/no-follow regular-owned body hashes and metadata.
The inventory is an observation/proposal, not an executed move or a fresh Git/index inventory.

Before the actual move, seal a fresh complete inventory after any authorized new records have been added:

1. Enumerate every G6 directory/resource without following links; record relative name/type/owner/mode/link count/size/device/inode and every owned regular body's SHA256.
2. Refuse unknown links, special files or external targets.
   Do not delete, dereference or normalize uncertain resources to make the inventory pass.
3. Record explicit old-path → proposed new-path entries for **every** moved regular file, including the untracked records; independently list the exact40 qualified/tracked-prefix paths.
4. Save complete protected hashes for parent/siblings, old maps/reports/failures and finite named historical/consumer markers without expanding into ambient stores.
5. After move, enumerate the destination again and compare exact relative-name coverage, bodies, modes/ownership and applicable identity metadata; record any legitimate filesystem identity change explicitly.
6. Only task.json's reviewed completion fields may change body bytes.
   No history/preimage/failure record may be rewritten or discarded; confirm the old active directory is absent and the archive contains all40 plus every inventoried additional resource.
7. The public records move; private qualification roots, E/F/G consumers, original seals/logs/gates/once markers, public peer roots and uncertain old resources do **not** move or receive cleanup.

Do not claim that archiving repairs missing438 preimages, restores all133 unrelated untracked files, passes historical5547 failures or establishes physical-human capability.
No symbolic root shim, old-path refill, hardlink alias or private input-seal rewrite is acceptable.
Archive all current public G6 human records as task resources, not private consumer cleanup targets.

## Live references requiring later, narrowly owned edits

A scoped search of `.github/workflows`, `biome.json`, `scripts`, `test`, `README.md`, `AGENTS.md` and live `.trellis/spec` found only CI/Biome/spec live G6-prefix references outside task history.
Observed spec inventory is **17 files,19 matching lines,31 literal target occurrences**; the supplied18-pointer estimate is not treated as an exact file count.
The private inventory records each exact file/line/target and original hash; no broad historical-task search or replacement was used.

| Live file(s)                                                                                                   | Exact planned operation after destination is known                                                                                |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml:47`                                                                                  | Translate only acceptance-map-ci path to the actual archive prefix                                                                |
| `biome.json:57`                                                                                                | Translate the single exact format-only exception for historical g6-current-qualified-map; preserve parser/linter/reference checks |
| `.trellis/spec/backend/{index,lightweight-workflow,quality,task-distribution}-guidelines` and retirement stubs | Translate only G6 task links; preserve historical statements and all other text                                                   |
| `.trellis/spec/frontend/{quality,task-planning,task-session,task-source}-guidelines.md`                        | Same narrow link translation                                                                                                      |

The backend shorthand above includes `index.md`, `lightweight-workflow-guidelines.md`, `quality-guidelines.md`, `task-distribution-guidelines.md` and the nine inventoried `task-*-guidelines.md` retirement stubs; use the exact private file list, not filename generation.
Do not broaden Biome formatting exclusions or weaken lint, native tests, gates or budgets.
These are unshipped documentation/workflow/format-path edits: all34 shipped runtime/package member bodies,16 source owners, three pins, manifest/lock and generated operator must remain bit-identical to source51.
The complete source/document fingerprint nevertheless **changes** through task relocation, completion metadata and live-link substitutions; do not claim an unchanged222-path tree.

Historical sealed maps and `retired-certified-specs/manifest.json` move **byte-for-byte**, retaining their original path strings as historical context.
Do not rewrite that manifest, old reports, old map evidence arrays or private seals to make them dereferenceable under a new tree.
The stable-parent pre-archive map also stays byte-for-byte: its PRD/inputs intentionally describe the pre-archive tree and will cease to be a current dereferenceable map after relocation.

## Separate post-archive current map and lineage

Proposed NEW stable-parent output, **not created by this plan**:

```text
.trellis/tasks/09-23-cadence-harness-redesign/research/g6-after-archive-qualified-map.json
```

Its PRD, check source references where moved, and every relevant input path must use the actual archive prefix; retain the original23 IDs, required flags and optional-unavailable physical-human treatment.
No archived-prefix references may be prewritten into the pre-archive map before those paths exist.

A new closed **PATHONLY relocation/qualification supplement** must bridge source51 to the archived tree:

- Bind the immutable pre-archive map/hash, original whole/native/G-install/control/real-review receipts and the complete before/after move manifest.
- For every original118 input (and the complete222 qualification inventory), distinguish unchanged path/body, moved path/same body, intentional task metadata change and exact live-link-only substitution.
- Prove each changed live spec/CI/Biome body differs only by the enumerated path substitution; record both actual old/new hashes and exact translated path pairs.
- Independently rehash all34 shipped member bodies/16 owners/three pins against source51; do not repack, reinstall or execute an old consumer merely to establish byte equality.
- Preserve original execution identity: real/native commands ran against their recorded source51 tree and original G root.
  New doc/path hashes were **not** their exact tested inputs.
- Record the supplement's actual executed non-model audit command, runtime, original wait/exit, complete closed streams, input bindings and original receipt hashes; do not label a semantic audit command as a paid/provider run.
- Combine that explicit path-only bridge with prior actual source/native/real evidence and new post-transition verification.
  Schema-strict map evidence has no arbitrary metadata fields: keep explanatory lineage in a separately bound receipt/closeout, not fabricated schema keys.
- Never blindly replace prior evidence input hashes and claim original commands tested a tree they never saw.
  A new post-map passing binding needs the actual supplement/current verification that proves its relevance; independent semantic review must approve lane/platform attribution, especially modern Linux versus source three-OS.

After the authorized path-only transition, run actual current reference validation (`--require-passed` on the NEW post-map), scoped lint/nonexcluded Markdown/link checks and current check/test/CI responsibilities sufficient to validate the changed workflow paths.
Retain new original waits/closed streams and observe actual CI/runtime/counts instead of copying old totals into new executions.
If any check fails, preserve its first map/program/body/log/native wait before causal repair; do not weaken assertions, budgets, fixtures, checks or the archive lineage.
These later checks/CI require their own delegated execution scope; none is executed here.
No new paid CODE Start, normal model/auth lookup or native real experiment is needed merely for documentation/path/metadata relocation.
Do not claim the post-archive current map is passed until all relevant references, new bindings, unchanged runtime bodies and semantic lineage are genuinely proven.

## Later version-control boundary

No Git/index call is made in this work.
The later standing G6-only commit authority must use an explicit reviewed whitelist: old40 paths + corresponding new40, exactly chosen live CI/Biome/spec reference files, G6 task.json state and explicitly selected new closeout/map/transition records.
All other relocated untracked G6 records remain preserved on disk; relocation is not permission for broad staging.
Re-evaluate any whitelist additions deliberately; do not stage parent/sibling task-state changes or the unrelated133-file history wholesale.
No `git add .`/`-A`/`--all`, automatic task-root staging, write-tree, amend/force, hook bypass, reset/clean or configuration mutation.
Only a subsequent independently reviewed post-archive map/closeout and actual transition receipts can declare **G6 archived**; this plan declares no archival, commit, publication or parent completion.
