# W1 contract/client/admission independent review

## Scope and disposition

Reviewed the entire first W1 chunk, not full W1 or parent acceptance.
The five initial files were new/untracked, so review covered their complete bodies rather than relying on a tracked diff: `src/service-contract.ts`, `src/service-client.ts`, `src/service/admission.ts`, `src/service/ports.ts`, and `test/service-contract.test.ts`.
The tracked diff consisted of unrelated pre-existing research deletions, left untouched.

Loaded the task using `task.py current --source`, its `check.jsonl` context and all three child artifacts, all three parent artifacts, both mandatory design appendices, `interface-freeze.md`, and `w1-contract-handoff.md`.
The omitted model-auth research and implementation-plan files were read completely.
The parent-approved replacement takes precedence over obsolete terminal-only/no-service wording.
No other agents were dispatched.

**No verified defects remain in this focused chunk after the fixes below.**
The candidates are ready for the joint W2/W3 interface-freeze review, **not already frozen**.
Reciprocal W2/W3 agreement and main-session ownership handoff remain required; this check does not authorize dependent implementation or establish W1/product completion.

## Findings fixed

### 1. High: pending acceptance could enqueue after a concurrent quarantine

Owner: `src/service/admission.ts`, `ActionAdmission.submit`.

Cancel runs independently of the serialized action lane.
An inconclusive Cancel could set the local fence while another command awaited its acceptance commit or post-commit observation.
The pending submit checked the fence only before those awaits, then enqueued the newly accepted action despite the quarantine.
This was reproduced at both await boundaries using deferred memory ports; the original code returned `ok` and activated.

Now recheck the local fence immediately after committed acceptance and after post-commit observation, before activation.
Preserve the accepted receipt and return `quarantine` with effect `accepted`; exact duplicate receipt observation still works without another effect.
The existing detach/rotation-survival tests remain passing: revoking a client grant is not the same as quarantining the execution owner.

### 2. High: corrupt/inconclusive Cancel recording skipped the safety stop

Owner: `src/service/admission.ts`, `ActionAdmission.cancel`.

A persistence refusal with `corrupt-selected` or `receipt-inconclusive` returned early with effect `none`, bypassing the exactly identified run's stop request and the persistence fence.
These are recording failures, not conclusive evidence that an authorized Cancel should have no effect.
Both cases reproduced against the original implementation.

They now use the existing safety-cancellation path: recheck current authority and run/epoch, request bounded original-handle cancellation through the owner, fence persistence, and report non-durable uncertainty.
Conclusive stale/conflicting commands and known historical duplicates retain their no-new-effect paths.
A separate delayed-write regression verifies that uncommitted Cancel does not request a stop after access generation changes.
This tests port calls, not native termination.

### 3. Medium: empty snapshots admitted a different task's action context

Owner: `src/service-contract.ts`, `decodeSnapshot`.

Task-context correlation was checked only through `runs.some`.
An empty task snapshot could therefore name task A in its scope and task B, or no task, in its context, while passing both decoding and client scope correlation.
Require the task scope to match the context's task even when there are no runs.
The positive empty-snapshot case remains valid.

### 4. Medium: a pre-fault snapshot response could clear a required resync

Owner: `src/service-client.ts`, `ProjectionTracker`.

A snapshot requested before a heartbeat gap or epoch change could arrive afterward at the same committed watermark and reinstall the old view as `current`.
The existing numeric watermark rollback guard did not cover this race.
Both gap and epoch cases reproduced.

One private resync path now invalidates outstanding snapshot tickets whenever the tracker detects a resync fault.
Only a read begun afterward can restore `current`; old subscription generations still cannot update the replacement snapshot.
No mutation retry or execution inference was added.

### 5. Medium: updates could reparent an existing child occurrence

Owner: `src/service-client.ts`, `ProjectionTracker.receive`.

The reducer found a row by child ID and replaced it without checking its parent run or assignment identity.
A structurally valid update could move that occurrence to another run or assignment inside the same task scope.
Both variants reproduced.

Before replacement, require unchanged run/child/assignment linkage; otherwise retain the previous row/watermark and require resync.
This supplements, rather than replaces, the shared wire decoder's task/scope checks.

### 6. Medium: the native codec rejected unsigned Windows exit statuses

Owner: `src/service-contract.ts`, `decodeNativeSettlement`.

The signed-32-bit upper bound rejected DWORD statuses such as `0xc000013a`, losing a representable original native failure fact at the contract boundary.
Retain observed signed/unsigned 32-bit exit values without sign coercion; completed execution still requires exactly zero and all other existing success conditions.
Tests cover the unsigned exception/max values and reject out-of-range/fractional values.
These are codec fixtures on Linux, **not native Windows execution evidence**.

### 7. Medium: search correlation admitted nonliteral ranges and nonprogressing cursors

Owner: `src/service-contract.ts`, `decodeSearchPage`.

A hit range could have a different UTF-8 length from its literal query, despite otherwise matching content/cursor identities.
A continuation could also repeat or move backward within the same record/version/field, allowing repeated reads rather than forward pagination.
The wrong-length case was reproduced before the fix; the continuation conditions were directly absent in the reviewed source and are now regression-tested.

Require exact query-byte range length and strictly advancing offsets within the same entity/version/field.
Keep opaque cross-record/field navigation valid without inventing lexical UUID ordering, and keep zero-hit advancing continuations valid.
Actual source-byte matching, UTF-8 boundary verification and committed read authorization remain W3 reader responsibilities.

## Additional review coverage

- Added negative controls for inherited, hidden, symbol and accessor fields; array getters/sparsity/extra properties; and `toJSON` hooks.
  Getters/hooks are not invoked.
  Null-prototype JSON parsing preserves `__proto__` as data without prototype mutation, and valid non-BMP text round-trips.
- Reviewed closed keys, duplicate-key parsing, structural-depth limits, byte accounting and portable imports throughout both contract/client files.
  These guards are for finite data boundaries, not isolation from hostile same-process Proxy traps or arbitrary global modifications.
- Reviewed graph IDs/revisions, acyclicity, purpose/role/read-only authority, model identity, per-input/aggregate handoff bounds, and the separate actual serialized worker-envelope bound.
  No auth object or secret-derived identity was added to public DTOs.
- Reviewed configured-check exact matching versus local-only manual checks, check/review versions, preview binding, single-use grants, expiration, detach/revoke races and accepted-work lifetime.
- Reviewed same/different-ID admission races, old-epoch duplicate observation versus changed canonical identity, lookup uncertainty, acceptance-before-effect ordering and failed/uncertain commits.
- Reviewed native outcome/closure/input/final/cleanup/capture separation, detail/cursor correlation, old sockets, snapshot watermarks and client no-replay behavior.
  No tool result or human publication was promoted into a parent-check pass.

## Port implementability and freeze conditions

`src/service/ports.ts` was reviewed completely and remains byte-identical to the implementation handoff.
No new store, accepting default adapter, executor, SDK dependency or interface fork was introduced.

The admission CAS is implementable as supported **single-owner** coordination: W3's serialized writer must coordinate the real owner context/control revision, expose that committed revision before resolving, and preserve uncertain intent/commit bytes.
It is not an atomic comparison of arbitrary filesystem state, nor permission to maintain an independent accepting context copy.
The memory fixture demonstrates only call ordering and simulated comparison, not flush/fsync, crash recovery or host-writer exclusion.

The recording reservation is synchronous; its promise resolves at committed acceptance, never browser delivery.
W2/owner must validate original wire offsets/hashes and genuine SDK associations before owner sanitization; W3 owns independent stored offsets/hashes/references and committed coverage.
Do not reuse raw wire hashes as stored identities or validate sanitized content against unsanitized offsets.
Incremental redaction, bounded ingress, reservation consumption/release, sanitizer expansion/chunking and actual durability need reciprocal W2/W3 agreement and implementation tests.
The current typed ports alone do not prove those properties.

W2 must share the executable codec with maintained JavaScript through the planned `worker-public.mjs` boundary under an explicit W1 editor handoff, not copy these TypeScript rules into a second validator.
The owner/W4 must revalidate after preparation awaits and before actual launch, synchronously close admission on quarantine, and request safety cancellation of active/preparing original handles.
Those runtime responsibilities cannot be delegated to client state or inferred from a receipt.

Auth intent/settlement ports retain original-promise accounting without accepting credentials.
`NativeSettlement` remains the SDK-child shape; ordinary parent checks require their own actual absent-input/native-exit facts, not a fake worker final frame.
W2/W3 must also confirm actual final-result reference handoff and mandatory-recording settlement before dependent dispatch.

These are implementation/freeze obligations, not findings that require adding the missing runtime in this focused review.
W4 and W5/W6 still need their assigned action/projection/parity reviews.

## Verification actually executed

Environment: Linux x64, `/usr/bin/node` `v26.7.0`, Bun `1.3.14`, Vitest `4.1.10`.
Installed coding-agent identity `0.84.3` was read from package metadata only; no SDK construction or actual credential/configuration read occurred.

| Command or run                                          | Actual result                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Initial `bun run test -- test/service-contract.test.ts` | Exit 0; 67 passed, 0 failed, 0 skipped.                                                                  |
| Initial `bun run check` and `bun run lint`              | Both exit 0; the formerly blocking baseline JSON formatting issue was already fixed by the main session. |
| First added regression run, before source fixes         | Exit 1; 10 failed / 69 passed / 0 skipped, 79 total.                                                     |
| First fixes rerun                                       | Exit 0; 79 passed / 0 failed / 0 skipped.                                                                |
| Added search regression, before its fix                 | Exit 1; 1 failed / 79 passed / 0 skipped, 80 total.                                                      |
| Final `bun run test -- test/service-contract.test.ts`   | Exit 0; 1 file, **80 passed / 0 failed / 0 skipped**; runner start `23:02:33`.                           |
| Final `bun run check`                                   | Exit 0; JS syntax, generated operator byte comparison, configured whole-package TypeScript no-emit.      |
| Final `bun run lint`                                    | Exit 0; Biome checked 158 files, rumdl checked 41 files under existing exclusions.                       |

Runs overlap; do not add their counts together.
The two existing informational Biome `useTemplate` suggestions at `test/package-audit.test.mjs:31,36` remain untouched and do not fail lint.
No remaining unowned gate failure was observed.
The review document was separately checked explicitly because task research is excluded from the ordinary Markdown gate.
`node_modules/.bin/rumdl check --no-exclude .trellis/tasks/10-16-cadence-service-owner/research/w1-contract-review.md` exited 0 after the scoped formatter corrected its initial 17 sentence/table formatting findings.

No whole-suite, pack, disk-durability, native-service/worker, real authentication/provider, browser/terminal or platform qualification was executed here.
No injected memory marker is a real durable commit, and no stop callback is a native close receipt.

## Changed files and reviewed source identities

This review changed `src/service-contract.ts`, `src/service-client.ts`, `src/service/admission.ts`, and `test/service-contract.test.ts`, plus this new review document.
`src/service/ports.ts` was not changed.

| Reviewed file                   | SHA-256 after fixes                                                |
| ------------------------------- | ------------------------------------------------------------------ |
| `src/service-contract.ts`       | `56482a492910a9a58f3004b1ba854f0910de3b8d2cc16ba1505ab6cff118a0a0` |
| `src/service-client.ts`         | `04732fb8edd41b63d71ad5ef0b1305d998fecfcf3bf41911d93569bbb9dd3cab` |
| `src/service/admission.ts`      | `202a3f440eb3bcea184b94d29cfca0eafb2d0c762febb3ea8171a76dc557538a` |
| `src/service/ports.ts`          | `2a1c6281d03b3dd62d1c7b6e9515f3cc9c7adbec474d5e0d29b8434eb24ce8ed` |
| `test/service-contract.test.ts` | `2fe77e940a25bb109ed4c7d342bccc08fce1b7501f097e75ebd060f193500342` |

## Remaining scope and preservation

Still required in W1: actual lifecycle/registry/overlap/v1-lock coordination, HTTP/WS/token/cookie/Host/Origin/CSRF/local-capability/rotation, installed-public-SDK model/auth accounting, stop/quarantine/recovery, and the generated service CLI/build/package edges.
W2–W7 still own native capture, durable history/search/export/publication, scheduling/checks/review, complete clients/substantial source reuse, distribution/spec updates and integrated acceptance.
Their absence was not disguised as a bug fix or a passing test here.

No package/lock/runtime/controller/worker/shell/spec/frontend/task-status or existing research/history edits were made.
No installations/downloads, user credential reads, real-checkout service start, paid providers, Git mutations, commit, cleanup or task completion occurred.
The main session should independently rerun gates and arrange the reciprocal interface review.
