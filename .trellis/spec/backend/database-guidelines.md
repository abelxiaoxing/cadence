# Task Record and Coordination Storage

## Scope and owners

The historical filename remains for discoverability; current storage is plain JSON, not a database.
`src/task-store.ts#TaskStore` and `src/task-types.ts#decodeTask` own it.
See the [workflow contract](./lightweight-workflow-guidelines.md) for controller choices and outcomes.
Never open, migrate, reset or clean legacy SQLite/checkpoints/locks/session stores.

## Paths and identities

`resolveWorkspace(cwd): { root: string; cwd: string }` canonicalizes the invocation cwd and obtains the actual Git worktree root where available.
Git receives no inherited `GIT_*` overrides; missing Git/confirmed non-repository can use canonical cwd, while uncertain lookup refuses.
Remove only Git's trailing output terminator, never `trim()` a filesystem identifier: valid spaces, tabs, CR/newline bytes survive on supporting filesystems.
Escape paths for display without changing operational bytes.

- Records: `<root>/.cadence/assistant/tasks/<uuid-v4>/task.json`, schema `cadence-workflow-assistant/1`.
- Checks: `<root>/.cadence/assistant/config.json`, schema `cadence-assistant-checks/1`.
- Private root: `<state-home>/cadence-assistant-v1/<sha256(canonical-root)>`, outside the working copy.
- State home: absolute `XDG_STATE_HOME` on non-Windows or `LOCALAPPDATA` on Windows; otherwise `~/.local/state` or `~/AppData/Local` respectively.

Ambient ancestor aliases are canonicalized, including an absent tail, without creating directories; dangling ambient aliases refuse.
Inside the owned namespace, links/non-directories refuse.
Selected files require regular, single-link, bounded data with `lstat`/descriptor checks and `O_NOFOLLOW` where available.
Private namespace directories/files additionally require current-user ownership and no group/other permission bits on POSIX.
This is bounded supported-writer hygiene, not protection from hostile same-user races.

## Record and configuration limits

| Value                   | Current limit / behavior                                                               |
| ----------------------- | -------------------------------------------------------------------------------------- |
| Whole record            | 128 KiB; known top-level keys only; positive safe revision                             |
| Goal / plan             | 8192 / 32768 bytes; goal nonempty                                                      |
| cwd / result / baseline | 4096 / 16384 / 16384 bytes                                                             |
| Checks / activity       | 32 records / 64 entries; activity `at` 64 and `text` 512 bytes                         |
| Review                  | `fingerprint` ≤128 bytes, `outcome` reviewed or reviewed-with-issues                   |
| Task listing            | At most 1000 directory entries; unknown entries refuse                                 |
| Check config            | 32768 bytes; only `schema`, `checks`; at most 32 definitions                           |
| Definition              | Nonblank name ≤128 bytes, command ≤4096 bytes, integer timeout 100–1200000 ms          |
| Name ambiguity          | Duplicate exact names and reserved `Manual command` refuse                             |
| Executable display      | Disallowed controls/bidi refuse; command newline/tab allowed, name newline/tab refused |
| Lock / selected log     | 8192 / 65536 bytes                                                                     |

String bounds are UTF-8 bytes and reject NUL.
`CheckRecord.status` has no `not-run` variant: not-run is projected from missing obligations, not fabricated execution history.
Nested fields are checked by the shared decoders; do not claim every nested object has a closed key set.

## Atomic single-record updates

`loadSnapshot(id)` returns `{record, identity}` where identity hashes the raw selected bytes.
`save(record, expectedRevision, held?, expectedIdentity?)` requires next revision = expected + 1 and the current bytes' identity; creation uses revision 1/expected 0 with absent identity.
Updates use the caller's loaded identity (or the known canonical saved identity), not merely revision equality.

Save holds/acquires the checkout lock, writes an exclusive 0600 temporary, fsyncs/closes it, rechecks ownership and observed target bytes, then renames that single file.
Conflicts preserve external bytes and failed temporary data; unknown task-directory siblings refuse rather than being removed.
Same-revision manual edits invalidate native choices and final-save attempts.
This is optimistic metadata concurrency, not multi-file transaction, hostile-writer CAS or crash-proof durable publication.
Missing list/load/config/lock observation creates nothing.

## Supported-writer coordination

`checkout.lock` has schema `cadence-assistant-lock/1`, `token`, `pid`, `host`, `runId`, `root`.
Exclusive `wx` creation coordinates short metadata updates and an active worker/check for one canonical checkout.
Only the owning process with unchanged lock contents releases normally; active operations release after confirmed direct-child settlement.
Unconfirmed close/unknown release keeps blocking state.
No historical all-log scan gates acquisition or release: validate the selected lock/log only and preserve unrelated material.

`recover(expected, acknowledgeEscapedProcesses)` requires informed terminal confirmation, same host, exact unchanged lock and a PID probe failing specifically with `ESRCH`; lock identity is checked again before unlink.
Live/ambiguous/remote owners refuse; recovery clears only this new coordination file, never kills processes or claims escaped descendants stopped.
Other editors and older Cadence sessions are outside coordination; users must stop older sessions themselves.

## Regression anchors

`test/lightweight-store-controller.test.ts` exercises noncreation, corruption/link/size refusal, actual second-process exclusion, dead unchanged recovery, unrelated-log preservation, ambient aliases and same-revision conflicts.
`test/lightweight-process-diff.test.ts` preserves actual whitespace path bytes and distinguishes config from administrative metadata.
`test/distribution.test.mjs` repeats readonly operator preservation on extracted code and trap consumer files.
