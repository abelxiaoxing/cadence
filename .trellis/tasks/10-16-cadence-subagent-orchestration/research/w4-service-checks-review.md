# Focused Service Parent Checks — Independent Review

## Disposition

**The focused check boundary passes after the corrections below; no known in-scope blocker remains.**
Production HTTP admission remains **null**.
This is not W4 completion, accepting-host qualification or product acceptance.

Loaded the active check context, child artifacts, mandatory parent artifacts/appendices, current specs and the focused check handoff/contract/evidence.
All355 previous handoff input hashes matched the delegation preimages.
The full review froze363 source/test/build/config/provenance inputs; all remained identical across the full test run and its gates.
Afterward, only `test/service-checks.test.ts` changed to strengthen the rotation fixture with actual native-receive acknowledgments instead of timing-based split writes.
The complete23-case focused files and typecheck were rerun on that final test revision; all production/generated inputs stayed identical.
Exact paths, SHA-256 identities, commands, original runner PIDs/waits/exits and native receipts are in [the new evidence](w4-service-checks-review-evidence.json).
The [correction decisions](w4-service-checks-review-decisions.md) record the narrow implementation boundary.
Historical hashes and failed receipts were not rewritten.

## Findings and Corrections

### F1 — Rotated access tokens escaped a running check's literal snapshot

An actual isolated native shell check waited for a fixture readiness barrier, then read output values from a fixture file after two actual `AccessMaterial.rotate()` calls.
It emitted the original, intermediate and current token across split writes on both stdout and stderr.
The pre-fix regression failed because retained output contained newly rotated literal bytes.
Native exit0 and an apparently passed check did not establish privacy.
No real credentials were used; the child did not inherit the tokens through its environment.

`CheckRecording` now receives owner-private current-literal and change-notification callbacks from `TaskActions` through the existing scheduler.
It uses the existing access revocation notification, reobserves private sources at ingress/transform/final-tail boundaries, and adds literals to the existing `TextSanitizer` without resetting its pending literal, UTF-8, terminal or heuristic state.
Every observed rotation during recording is retained, including an intermediate token replaced before the next output chunk.
Previously known literals are not evicted.
The cumulative union is capped by the existing256KiB literal allowance; uncertainty or exhaustion fails capture instead of forgetting secrets or promoting output to PASS.
Listeners are detached when recording ends or begin fails.
A reentrancy guard prevents recursive access-uncertainty revocation from recursing through the literal reader.

The callback material remains private RAM: no new wire codec, public secret-derived identity, child environment/argv credential merge, provider subsystem or auth request was introduced.
The final native regression requires an exact redacted result on each known fixture stream and original zero close, with no provider contacts.
For every literal on both streams, the next suffix write waits for acknowledgment from the actual parent native receive callback.
It independently asserts that concatenated native chunks contain each fabricated literal but no individual chunk contains it whole.
This establishes real chunk splitting, not merely separate child writes or a sleep.

Selected model literals continue to come from strict readonly validated source snapshots.
An actual mid-check replacement of the fabricated selected key now exercises the dynamic read: capture refuses, replacement bytes do not appear in retained rows, and the changed credential file remains untouched.
No `prepareTracked`/getAuth is invoked by check capture or views.
Unobserved external credential refresh/replacement is not silently accepted as routine renewal.
This is bounded known-literal handling during recording, not universal business-secret detection or an archive-wide retired-secret database.

### F2 — Final sanitizer expansion was not independently charged

Source inspection found that ingress used a fixed2MiB transform reservation while EOF flushing had no transform reservation.
A large held literal prefix can expand at finalization; charging only the original prefix does not account for that output before allocation.
The original1MiB prefix allowance also omitted the full simultaneous literal sets, terminal/heuristic states and decoder tails at their maxima.
This is a source-backed accounting correction, not a claim that an earlier unrelated failure was reproduced or explained.

The prefix reservation now accounts explicitly for both bounded literal sets, pending prefixes, heuristic/ANSI states and decoder tails.
Both ingress and finalization reserve from actual input plus retained-prefix size before transforming: `(inputBytes + retainedBytes + 4) * 12 + 64`.
Output events retain their separate encoded/chunk reservation through the real writer.
This replaces the arbitrary fixed transform allowance; it does not raise the8MiB/2048 owner queue,16MiB raw,64KiB native chunk,32MiB detail,5s recording or disk ceilings.
The cumulative literal-update regression proves cap refusal preserves prior literals rather than evicting them.

## Boundary Audit and Regression Coverage

- **Admission and authority:** checks are separately accepted graph-null/zero-assignment episodes, not SDK nodes.
  Exact configured name/command/timeout, code kind, drained task and native-local manual authority remain enforced.
  New controls reject changed selectors, readonly checks and a second check against the active task without another native launch.
  Browser manual rejection remains covered.
- **Shared coordination:** checks use the same fair checkout holder map and two child-or-check ceiling.
  Existing native check/read/editor exclusion, foreign-generation blocking, revised-graph/new-Start and all31 original scheduler cases pass.
  No second runner, scheduler or writer was added.
- **Native and original lifetimes:** the existing `runCheck/runProcess` path uses frozen ordinary launch environment, check-only CMD quoting/COMSPEC selection and ignored stdin EOF.
  No SDK assistant-final is required.
  Both per-stream original tails, real EOF/close and content-end settlement remain joined.
  Node exit-time `flushStdio` can resume paused reads; charged per-stream queues still serialize each decoder and retain every continuation.
- **Stop and uncertainty:** accepted/native/storage originals remain registered before effects.
  Existing actual native-close plus injected original-storage stall retains the reservation/fences and prevents late ordinary publication.
  Actual lease-file interference prevents later signaling, yields unknown, and eventual unforced exit0 does not repair the earlier unknown.
  Slow/refusing ports remain explicitly injected evidence.
- **Output and framing:** the real SDK-then-shell scenario retains more than140KiB across both streams, split Unicode and known literals.
  New stdout/stderr incomplete-UTF8-tail controls require failed capture independently of native completed/exit0.
  Stream labels are presentation, not unforgeable framing: arbitrary command output containing identical labels is retained literally.
  The combined detail is not a reversible raw-stream archive or reconstructed OS write order.
- **Exact data and coverage:** only the real writer's committed content end supplies the output reference.
  Failed/no-output capture cannot produce PASS or a fabricated reference.
  Inclusive16MiB aggregate and over-limit refusal are recorder-level controls without an accepting sink; they are not a new fully retained16MiB native-shell qualification.
  Existing real disk/quota/native failure lanes passed in the affected suite.
- **Freshness:** `ownAdvance` still joins the actual check/operation/reservation/held gate and exact `from + 1`.
  PASS requires native completion, complete recorded output and unchanged actual observation.
  Foreign generations, changed definition, cwd/environment/epoch and not-run obligations remain independent; historical results are not rewritten.
- **Reopened parity:** a new actual-native/disk case reopens the reader, compares finite run projection with the shared reducer, projects passed/not-run obligations, and consumes both NDJSON and Markdown exports through their real digest/count/trailer and original EOF.
  The exported ownAdvance/output/native facts match the original check settlement.
- **Publication and preservation:** existing v1 expected-byte conflicts preserve external bytes and quarantine.
  Selected files, ordinary environment policy, no resolved-auth merge and current private-source validation remain intact.
  No ordinary environment value is exported merely to describe policy.

## Verification

Available environment: Linux x86_64, ext4 home-disk temporary roots, `/usr/bin/node`26.7.0, Bun1.3.14, installed Pi0.84.3.
Each executable verification/build command used a separately allocated0700 root with explicit TMPDIR/TEMP/TMP.
The initial required task/context and readonly Git status/diff inspection preceded this temp discipline; no Git mutation occurred.
Fixtures further isolate workspace, home, agent directory, state and fabricated providers.

- **Complete affected run:1506 passed,0 failed,0 pending,46 files**, original runner exit0, no supervisor termination;1398.85s observed supervisor elapsed.
- This includes **19 native check cases plus4 injected recorder cases**, and **all31 unchanged scheduler cases**.
  These are subsets, not additional totals.
- The final strengthened native-barrier fixture then passed the complete **23 cases,2 files**, original exit0;79.42s supervisor elapsed.
  This overlaps1506, and is not a second full-suite run or additional test total.
- `bun run check`: exit0, including syntax, TypeScript and exact operator/service generated-byte checks.
- `bun run lint`: exit0, no warnings/errors;10 informational suggestions, including one new test-only template-literal suggestion.
- `bun run check:agents`: exit0.
- `bun run check:web`: exit0.
- `bun run test:web`:105 passed,7 files, exit0.
- `bun run build:web:check`: exit0, canonical web names/bytes unchanged.
- Canonical service/operator rebuilds: exit0.
  Only `src/service-host.mjs` changed; management CLI and operator stayed byte-identical.

All19 final native check receipts observe their original child closes, including the later close that does **not** repair an unknown result.
The original20s scheduler/native,15s SDK child,8MiB/100ms read and5s capture limits were unchanged.
New check scenarios retain their previously selected60s outer case budget.
No repeated unchanged full-suite run was used to obtain green.

## Preserved Diagnostic Failures

1. Pre-fix rotation: one failed native regression,12 filtered cases skipped.
   The boolean leak assertion exposed no token in the log; fabricated failed history remains private and preserved.
2. First post-fix rotation: privacy assertion passed, but a fixture incorrectly counted redaction markers after concatenating two independently interleaved sanitizer tails.
   The failed receipt remains.
   The corrected fixture asserts each known source separately; it is not a parser for arbitrary label-bearing output.
3. Subsequent20-case complete focused and3-case added-control runs passed and overlap the final23 check cases; do not sum them with1506.
4. The first lint after writing this evidence JSON failed on its unformatted arrays only.
   The failed receipt remains; scoped JSON formatting repairs it without a source/test policy change.

Prior producer failures, eleven historical scheduler failures, event35 and other earlier native/history failures remain historical and unexplained.
The fixes and fresh passes do not assign them retrospective causes.

## Recurrence Prevention

The privacy defect combines a cross-layer contract gap and an implicit assumption: action authority remains accepted across rotation, but the recorder incorrectly treated private literal identity as equally immutable.
Static-secret tests missed that lifetime distinction.
The failed post-fix diagnostic was a separate test-model error: joining two interleaved labeled streams is not reconstructing either original stream.

The runtime prevention is bounded additive updates without prefix reset, tied to existing owner notifications and strict source reads.
The test prevention is an actual running process plus two real rotations and acknowledged native chunk boundaries, with independent old/intermediate/new literal assertions.
EOF expansion also now receives the same pre-allocation accounting discipline as ordinary chunks.
Other long-lived consumers of secret snapshots warrant separate review; this delegation does not silently rewrite SDK worker capture or promise global retired-secret retention.
The decision note and these regressions preserve the contract now; main should synchronize maintained orchestration/capture specs after accepting this focused handoff.
No spec commit, template sync or scope expansion was performed.

## Changed Files and Remaining Work

Changed from delegation:

- `src/service/check-recording.ts`: dynamic private literal observation and exact prefix/transform charging.
- `src/service/{task-actions,scheduler}.ts`: private callback wiring only.
- `src/worker-redaction.mjs` and `.d.mts`: bounded additive literals preserving existing sanitizer state.
- `test/service-checks.test.ts`, `test/service-check-recording.test.ts`: nine added regression/control cases.
- `src/service-host.mjs`: canonical generated output.
- This review, its evidence JSON and correction-decision note.

No dependency/pin/lock, renderer, maintained spec, task status, user credentials, deployment, cleanup or historical evidence was changed.
Current auth provenance destination hashes were verified unchanged; no historical provenance was rewritten.

Still required: human issues review; current model selection/metadata and cold own-publication lineage; real build handshake and asset composition; accepting HTTP host; W1 outbound proxy/informed recovery; W5 native cutover; accepting W6 browser and W7 complete distribution/integrated acceptance.
No extracted-package, accepting-browser/terminal, paid-provider, physical-human/device, Windows/macOS/ConPTY or other-runtime qualification follows from this focused review.
