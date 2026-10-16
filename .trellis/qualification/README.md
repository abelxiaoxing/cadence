# Qualification references

## Stable CI map

[The G6 CI map](./g6/ci-map.json) lives outside active task directories so whole-task archival cannot break its CI reference.
It is a byte-for-byte copy of the parent's `research/g6-ci-current-map.json`, not a new qualification snapshot.

```sh
bun run traceability:check --map .trellis/qualification/g6/ci-map.json
```

This reference-only map has **8 criteria / 19 checks**: all criteria/checks are `planned`, release lanes are `planned` or `unavailable`, and every evidence array is empty.
The command deliberately omits `--require-passed`; reference validity is not executed test evidence, semantic acceptance, release approval or provider/physical-human qualification.

## Historical snapshots and archival

Historical qualification maps retain their recorded input paths, hashes, statuses and evidence as immutable snapshots, even when those paths no longer resolve in the current tree.
Do not rewrite them or old reports to imply that original commands tested later changes.
The stable CI map does not replace those snapshots; administrative closure of superseded work is not an original acceptance-criteria PASS.

Archive the whole task with its records, rather than extracting or deleting selected history.
The parent was archived on2026-10-16; the following retained archive-parent records now exist with their original bodies unchanged:

```text
.trellis/tasks/archive/2026-10/09-23-cadence-harness-redesign/research/g6-ci-current-map.json
.trellis/tasks/archive/2026-10/09-23-cadence-harness-redesign/research/g6-before-archive-qualified-map.json
.trellis/tasks/archive/2026-10/09-23-cadence-harness-redesign/research/g6-after-archive-qualified-map.json
.trellis/tasks/archive/2026-10/09-23-cadence-harness-redesign/research/g6-final-archived-closeout.md
.trellis/tasks/archive/2026-10/09-23-cadence-harness-redesign/research/g6-final-archive-independent-review.md
.trellis/tasks/archive/2026-10/09-23-cadence-harness-redesign/research/g6-post-archive-native-review.md
```
