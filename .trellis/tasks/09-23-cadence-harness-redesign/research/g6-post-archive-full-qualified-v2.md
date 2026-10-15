# G6 post-archive whole verification v2 — failed, no retry

## Decision and causal follow-up

**FAIL_STOP_NOT_QUALIFIED — whole verification failed; remaining gates were not run.**
This is a new execution after the parent's separately recorded task-metadata LF correction, not a retry on identical inputs.
The [first failed verification](./g6-post-archive-full-qualified.md), its immutable CORE and original logs remain failed and byte-preserved.
The correction appends exactly one LF:790→791 bytes, unchanged JSON values, completed status/date and mode/UID/GID/device/inode/link count.
Current task SHA256 is `f9af5d95cedfdb84d38e8ea185d9e8ef6be6128a70bf534f0cbe5e19e0c876eb`.
No maintained source/test/specification, dependency, workflow or archived body was repaired by this role.

## Original execution and concrete failure

Actual Linux x64, `/usr/bin/node` v26.7.0, `/usr/bin/bun`1.3.14 and Vitest4.1.10.
Repository coding-agent/AI/TUI/agent-core are0.84.3, typebox1.3.7 and Undici8.9.0.
Global public1.2.0 metadata was recorded separately, not selected for SDK execution.
Public executable/package identities, including legitimate package-store link counts, are retained privately.

`bun run verify`, original PID546281, returned **exit1**, null signal, after136386ms.
Original ChildProcess exit1/close1, both stream EOFs, complete closed stdout/stderr and unforced settlement are retained.
Syntax validation, canonical operator `--check` and TypeScript no-emit completed before lint.
Biome checked138 files with no fixes, no errors and two existing informational findings; Markdown lint checked39 files successfully.
The original missing-LF lint blocker is therefore resolved on these new inputs, without rewriting its failed evidence.

Actual whole result: **589 passed / 13 failed / 27 skipped;629 collected**,15 files:12 passed/3 failed.
Failures: distribution1/8, lightweight-shell9/11 and startup-card3/11.
First reported assertion: `test/distribution.test.mjs:434` expected the `cadence` command but received an empty command list.
The shell's corresponding registration assertion fails at `test/lightweight-shell.test.ts:154`; startup notifications are also absent.

**Harness attribution:** this checker's frozen parent environment explicitly set `CADENCE_SUBAGENT_CHILD=1`.
`src/index.ts:9` deliberately returns before all shell/startup registration under that flag.
The ordinary parent-host registration tests therefore ran in child-only mode; the13 failures are consistent with that suppression, not established production regressions.
The original runner CORE retains its generic validation-failure classification; a separate adjudication records this harness cause without editing the CORE or turning failure into success.
No corrected-environment run, source fix, environment repair or retry was performed.

After the failed whole command, separate check:agents, canonical-operator repetition, spec-link/size-budget audit and current CI-map reference gate were **NOT RUN**.
The final `pack:check` portion of verify was not reached; distribution was not separately rerun.
Discovery found no maintained standalone size/link executable; the planned private pure audit was not executed.

## Observed overlapping synthetic integration evidence

The failed whole run nevertheless completed237 SDK tests and four source/extracted regular/fullscreen POSIX production terminal cases.
Those terminal originals retain waitpid/exit0 and synthetic transcripts; they are not physical-human, paid-provider or Windows ConPTY evidence.
The27 skips remain the explicit Windows-only domain, not27 passes.
Distribution's exact34-member/body/pin audit passed, but its suite remains failed7/1; this is not a separate pack:check PASS.
Its retained actual archive SHA256 is `6e36ad461fe5aef8d15115d72998feae4402f6187d6cd97f426d98a997f1e110`.

The owned SDK capture contains370 original files/126 JSON receipts:15 guarded-SDK,103 explicit mocks, two routing, two successful proxy-response and four thinking controls.
These internal receipts overlap237 SDK tests and are not additional suite totals.
DIRECT PID547992 observed sink2/proxy0/exactCONNECT0; VALIDATED_PROXY PID548005 observed sink0/proxy2/exactCONNECT2.
Both retain original exit1/close1, delivered input, both EOFs, no force and no unexpected route; native runtime warning was absent.
The fixed plain/gzip proxy-response controls retain original zero closes and synthetic successful responses, separately from the CONNECT502 controls.
Raw streams, bounded diagnostics, original PID/wait metadata and worker/input hashes are indexed without redacting a failure into success.
No real-provider payload, normal model/auth request, paid/native Start, installation or modern-G execution was undertaken.

## Current inputs and preservation

A fresh223-input freeze preceded every executed gate: historical222 classify as40 same-body archive relocations,19 exact live-reference substitutions and163 unchanged paths/bodies, plus the new reference-only CI map.
The corrected current task.json body/identity was additionally captured before verify; it is outside historical222.
Current fingerprint: `c23975c7d8c6941ab3d245a6e407dc6b727f24b6f4098ea7ae6bcc830157ab8e`.
This is not an unchanged222-key tree or fresh Git-revision qualification; supplied source51 remains historical identity only.
The new v2 report is excluded from proof inputs and is not referenced by the CI map.

Fresh role-before/after preservation agrees across8171 finite named paths, including7690 public peer files and named E/F/G bodies/consumed markers.
All290 archived files/five subdirectories remain equal across this role;289 bodies exactly match move-after, and task.json differs from move-after only by the separately authorized LF.
All archive modes/ownership/filesystem identities remain preserved; parent/sibling metadata and the absent old active path are unchanged.
All34 shipped bodies/16 source owners/three pins match baseline; worker SHA256 remains `12fff81671cc0bd1d3011f43f9364531bba0a08007dd1abe728de00a676022f3`.
Prior task-completion/live-reference differences and already-existing historical future gates are explicitly retained, not relabeled unchanged or absent.
The supplied pointer remains None without session-store inspection.

## Receipts and pending work

Private owned0700 root; programs, source preimages, command receipts, freezes and SDK captures are owned single-link0600:

```text
/home/mirako/.local/state/cadence-release-qualification/744e5f0de9223044/qualification-7db986a-c8cef218/repair-final-bk0d8kjm/commit-push-audit/ci-round2-authenticated-cb9a5079/g6-post-archive-full-v2-pnfgcf06
```

Immutable `CORE.json` SHA256: `97d59f3240674588937960a1b7952109be86f0883e442d4699d19cca542d35bb`.
It binds complete actual command arrays, filenames, PIDs/native waits, closed logs, current inputs and unrun gates.
`execution-artifacts-index.json` SHA256: `545522da93ef9721d592d96d76c090c964fe395e583e253157c863a855b81dcb`; it binds the adjudication, original synthetic fixtures and SDK raw index; final `index.json` also binds this report.
Original extracted-package modes and test-owned peer links remain intentional fixture semantics, not relaxed receipt custody or repaired source bodies.
The fixed environment used fresh HOME/temp/XDG/Pi paths and offline/cache controls, without ambient environment/argv dumps, credentials or proxy/TLS overrides.
No warning suppression, assertion/budget change, Git/index/CI operation, dependency retargeting, old-consumer cleanup or subagent occurred.

Current whole qualification remains failed; the harness prerequisite needs separate causal adjudication before any later execution.
Fresh actual Linux/macOS/Windows CI, current reference/link/operator/pin gates and independent post-archive semantic lineage review remain pending.
No post-archive qualified map was created; historical native, installation and real-G evidence retains its original domain.
