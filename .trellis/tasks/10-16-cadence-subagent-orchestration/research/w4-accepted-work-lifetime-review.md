# Accepted-work Lifetime — Independent Review

## Disposition

**The assigned slice passes after one reproduced fix.
No known in-scope finding remains.**
Production `src/service/host.ts` still supplies `admission:null`; W4 and the complete product remain incomplete.
Checks/review, model selection/current metadata and client composition were not implemented.

Loaded the active check manifest, child artifacts, mandatory parent artifacts/appendices, curated context, owner/history/orchestration contracts and both lifetime handoffs.
All12 changed-input hashes in the implementer's evidence matched the review preimages.
The existing broad dirty/untracked tree was inspected and preserved, not staged/reset/cleaned.
No agents, dependency changes, real credentials, deployment, task-status changes, frontend edits or user-checkout Git mutations occurred.

## F1 — Late Original Admission Left Publication Permanently Pending

The new actual-host regression holds the real admission append at its commit boundary beyond the unchanged five-second writer reporting deadline.
The reporting result becomes uncertain and closes admission, while the original storage promise remains pending.
After that original is released, its actual accepted journal record becomes durable.

Before the fix, `TaskActions.commit` returned its uncertain work disposition without arranging publication nonapplication.
The resulting actual receipt stayed `admission:accepted, publication:pending`, despite there being no activation or future publication work.
The complete initial two-file run retained **188 passed/1 failed**, original runner exit1; the failure shows expected uncertain versus actual pending.
This is a new demonstrated defect, not a proposed cause of any historical scheduler failure.

`src/service/task-actions.ts#commit` now queues the existing `abandonPublication` observation on uncertain admission reporting.
The same writer serializes it behind the original admission write; it cannot infer acceptance from the report.
If acceptance becomes durable, it records uncertain nonapplication.
If only partial intent exists, the existing reader refuses without fabricating acceptance, candidate bytes, task/run allocation or execution.
The accepted-work disposition remains uncertain; safety storage originals remain independently tracked and cannot authorize fence release merely by settling.
No new writer, retry, public API or resource budget was added.

The regression passes in the final complete affected run.
It verifies no task publication, no native launch, null execution/settlement, a subsequently observable accepted/uncertain receipt and retained quarantine/locks.

## Lifetime and Effect Audit

- **Registration:** the exact accepted control-flow promise is registered with `ServiceOwner` before the first commit microtask, not after activation or native allocation.
  It spans post-commit observation and actual metadata/whole-episode completion; original native/auth/storage accounting stays separate.
  Caught control failures yield explicit uncertainty rather than a successful void promise.
- **Quiesce/Stop:** exactly one action participant installs on the real owner, including external core fixtures.
  Stop publishes its shared attempt before synchronous callbacks, revokes grants/closes queues, and requests selected stops before awaiting originals.
  Reentrant/coalesced Stop and safety registrations during whole-work tails, flush and listener close retain their existing controls.
  A later separately requested Stop is not automatic release after a reporting timeout.
- **Ordinary effects:** quiescence prevents later allocation, launch, plan retention and ordinary v1 publication.
  Existing capture drainage is a continuation, not permission past a recording fence or permission to charge data to safety headroom.
  Actual auth/native settlement and closed admission/gate/parent facts remain separately tracked safety work.
- **Signals:** scheduler aborts and the runner's optional service guard recheck current lease ownership at the signal boundary.
  The existing real SDK lease-loss case observes original zero close without TERM; recording/publication remains uncertain.
  Two added injected-handle controls exercise automatic timeout and malformed-protocol stops with false/throwing ownership guards: both TERM and KILL check ownership, neither signals, and the unchanged unknown deadline cannot become close after a late event.
  The existing TERM-then-lost-ownership escalation control remains intact.
- **Truthful publication:** abandoned metadata and accepted-but-unallocated runs use actual accepted identities and uncertain/null-observation facts, not fabricated candidates or parent admissions.
  Existing candidate identity is retained when one actually exists.
  Shared reducer, reopened receipt, finite projection and both complete export controls preserve execution separately from subsequent publication uncertainty.
- **Reservations:** uncertain episode completion does not refund scheduler holders/episodes or turn an unpublished current target into success.
  A clean native close is not proof of durable recording/publication or escaped-descendant shutdown.

No additional change to owner, scheduler, writer, reducer or native runner was needed by this review.
The one production fix is confined to the action owner's missing uncertain-admission continuation.

## Fixture Teardown

Reviewed fixture disposal observes accepted control flow, writer originals and the original current Stop attempt before explicitly closing its exact live/HTTP/provider transports.
This remains separate from the production owner's deliberate restricted/quarantined lifetime.
It does not recover locks, refund unknown scheduler charges or rewrite outcomes.

The final run retains41 selected fixture receipts:31 scheduler and10 accepted-work receipts.
They contain29 scheduler SDK child observations and5 accepted-work native closes, **not the entire suite's native-child count**.
All10 accepted-work receipts retain quarantined state and checkout locks while recording closed fixture listeners, zero pending writer jobs and zero pending accepted-work promises.
Runner exit0, HTTP closure and these direct-child observations are not universal descendant-closure evidence.

## Executed Verification

Evidence: [w4-accepted-work-lifetime-review-evidence.json](w4-accepted-work-lifetime-review-evidence.json).
It includes exact commands/PIDs/original waits/exits, full356-input freeze, test-result/log hashes, selected case results, all41 selected fixture receipts and the preserved counterexample.

Review root: `/home/mirako/abel/cadence-lifetime-review-DBxkaSEg`, mode0700 on `/dev/sda2` ext4.
Every verification command used a newly allocated0700 child root and identical explicit `TMPDIR/TEMP/TMP` selections.
Commands ran serially; the supervisor waited each original process, with1800s outer allowance and no force-stop.
Initial readonly task/context/diff/status discovery preceded fresh-root allocation; no test/build/provider execution used that setup window.

Observed identities: Linux x86_64, `/usr/bin/node`26.7.0, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.
These are observed identities, not new eligibility predicates.

| Gate                                  | Result                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| Complete18-file affected run          | **1114 passed/0 failed/0 pending**, original exit0;601.645s supervisor elapsed |
| Original complete scheduler file      | **31/31**, included above; all original20s cases retained                      |
| Actual-host accepted-work file        | **10/10**, included above;20s cases/15s SDK children                           |
| Separate legacy store/controller file | **25/25**, original exit0; not added to1114                                    |
| `bun run build:service`               | Exit0; canonical outputs remained byte-identical                               |
| `bun run check`                       | Exit0; syntax, operator/service generated-byte checks and TypeScript           |
| `bun run lint`                        | Exit0; zero warnings/errors, seven existing informational suggestions          |
| `bun run check:agents`                | Exit0                                                                          |
| `bun run check:web`                   | Exit0                                                                          |
| `bun run build:web:check`             | Exit0; canonical browser bytes unchanged                                       |

The affected command uses `/usr/bin/node node_modules/vitest/vitest.mjs run --no-file-parallelism` with18 explicit file paths and JSON/verbose reporters, recorded in the evidence.
It includes owner/CLI/model, action/scheduler/contracts, native SDK/process/capture, publication/reducer/history controls.
The1114 cases mix actual native/filesystem/HTTP execution and labelled injected port/clock/handle/fault controls; they are not1114 native scenarios or full-product qualification.

All356 selected repository inputs matched before and after tests and gates.
The manifest is not an exhaustive hash of installed transitive dependencies or historical artifacts.
Original20s cases,15s SDK children,5s capture/write reports,8MiB/100ms read quanta and1s/3s escalation/unknown bounds were unchanged.
The new failure was reproduced once and the complete affected suite ran after its identified source correction; no cherry-picked unchanged reruns replaced failed evidence.

## Changed Files and Remaining Gates

Review code/test changes:

- `src/service/task-actions.ts`: uncertain-admission nonapplication continuation.
- `test/service-accepted-work.test.ts`: actual late-original admission regression.
- `test/lightweight-process-diff.test.ts`: automatic timeout/protocol signal-guard controls.
- This new report and its new evidence JSON.

Canonical service regeneration changed no generated bytes; owner/scheduler/writer/reducer/native production code and the complete original scheduler test file remain unchanged by this review.

Prior11 scheduler failures, event35 and earlier native/large-capture timeouts remain failed and causally unexplained.
This reviewed correction and passing current-source checks neither explain nor rewrite them.

Still required: accepting-host actions, actual checks/human review, current model/metadata/lineage/build compatibility, W1 proxy/informed recovery, W5 native cutover, W6 accepting browser and W7 complete distribution/full verification/parent acceptance.
No package extraction, browser/terminal acceptance, physical-human/device, paid-provider, Windows/macOS/ConPTY, Node22/Pi1.2 or deployment qualification is supplied here.

Spec-sync recommendation for main: preserve the accepted-work original plus independent native/auth/storage distinction, ordinary-versus-safety/continuation gates, signal-time ownership, and uncertain-report-to-late-acceptance nonapplication rule in the maintained contracts.
This review leaves maintained specs and task state unchanged as assigned.
