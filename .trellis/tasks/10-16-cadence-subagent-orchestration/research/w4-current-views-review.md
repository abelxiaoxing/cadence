# W4 Current Views — Independent Review

## Disposition and scope

**Four reproduced findings fixed; the assigned source slice passes its focused checks.**
No known reproduced finding remains in this slice.
This is not W4/product acceptance or permission to open production admission.
The earlier model-choice **617 passed /19 failed** command remains **failed and unexplained**; these later passes do not establish its cause, waive it or replace its receipt.

Reviewed the active check context, child/parent requirements and mandatory appendices, MAIN decision, current-view contract/handoff/evidence, actual nullable TaskActions consumer, choice/original-lifetime owners, proposal helper, shared DTOs, readers and transport.
The producer's changed-input hashes matched at delegation.
Existing unrelated changes were preserved; only `src/service/task-actions.ts`, `test/service-current.test.ts` and these two new review records changed.
No agents, dependency/pin/lock changes, repository Git mutations/status, real credentials/profile, deployment, cleanup, task-status changes or frontend rewrite occurred.

## Reproduced findings and narrow fixes

### F1 — No-choice reads could return text sanitized against obsolete private literals

A real isolated owner with no selected model read a legacy plan containing a fabricated future key.
The regression replaces its fabricated credential file after the original saved-plan lookup, before the current reply.
Previously the read returned successfully: selected-model freshness was conditional on a selection and did not recheck the literal snapshot.

`observeCurrent` now exposes one source validator that reobserves the bounded private literal policy even without a model choice, alongside actual lease/cwd/roles/hints/model/task/access/control/generation checks.
It refuses the interleaved read; a subsequent independent read redacts the now-known literal and remains noneditable/unavailable.
No selection, getAuth, settings/configuration write or private-history write is introduced.
This is a labeled synchronous filesystem interleaving, not a claim of atomic hostile-writer isolation or universal secret detection.

### F2 — A preview could issue a grant after its selected task bytes changed

The real configured-check read was interleaved with a same-revision task-file whitespace edit.
Previously the actual ActionAdmission preflight returned `ok`: the task identity had been checked before subsequent check/review derivation, while the final model check did not reread the task.
The new regression requires stale/no-effect and no provider contact or history write.

Preview construction now finishes its shared decoding and all obligation/review derivation, revalidates configured definitions and the same current-source validator, then supplies writer context and returns.
The existing post-await accepted/auth/worker guards remain; no cached preview, old RunIdentity or permissive freshness callback replaces them.
The reproduced defect was a stale preview/grant, **not demonstrated unauthorized execution**: later submit reobservation was already another guard.

### F3 — Current obligations could publish an obsolete definition set/revision

A configured-check read returned the real original definitions while the fixture changed the selected config immediately afterward.
Previously `checkObligations` returned that obsolete set rather than refusing.
The shared owner obligation derivation now rereads exact configured selections/revision before updating its relevant-result revision; its public caller also rechecks current sources after derivation.
The next independent read returns the new definition as not-run, not a fabricated execution record.

The final preview uses the same configured-selection owner, including workspace Create.
No new check reducer, generation inequality relaxation or rewriting of native/check facts was added.

### F4 — The new workspace label bypassed known-literal redaction

An isolated checkout path containing the fabricated model key appeared literally in `TaskActions.workspace().rootLabel`.
Other current/preview text already used the owner literal policy.
Workspace now obtains the same current observation's literals and sanitizes only the displayed label; operational path bytes remain unchanged.
This fixes the assigned TaskActions callback, not activation or replacement of the deliberately uncomposed production host workspace adapter.

## Boundary audit and additional controls

- **One nullable consumer:** actual `OwnerModelChoice` and one TaskActions/Admission/Scheduler; structural liveness remains separate from selected-model authority.
  No-choice reads expose current-v1 plan/real pinned roles without selecting or reviving old source IDs.
  Accepted execution retains its exact selected model in durable admission.
- **Quiescence:** added controls exercise pending admission, a registered original accepted promise, a real journal reservation, and both held/queued review barriers against the nullable consumer.
  Existing pending Save, accepted allocation and full owner/model original-lifetime tests also pass.
  Refused replacement preserves selection/version; successful quiescent replacement invalidates old grants.
- **Current/prospective identity:** first research/code Start shares the current builder's default graph.
  New controls cover the actual 16-entry draft eviction, same-revision raw-byte edits and changed project hints; old contexts refuse instead of silently retargeting.
  Replayed config floor, new epoch/cwd and frozen launch environment remain unchanged.
- **Saved versus proposed:** actual Save retains/publishes before graph reads, including cold own-summary/review lineage.
  Pending/conflicted/external-byte proof stays unavailable, never none; old selected-model IDs are not rebound by reading.
  No new ContentRef is asserted for current-v1 text or current change bodies.
- **Active references:** all eight real accepted-but-unallocated episodes appear independently of the selected ninth task, with capacity refusal for a ninth episode and closed DTO rejection of overflow/foreign epoch.
  A pending original acceptance returns unavailable rather than complete-empty.
  An actual successful native check remains draining while its original final publication is deliberately held.
  The eight-episode control cancels before allocation resumes and launches no SDK child; it does not qualify eight simultaneous native workers or authenticated HTTP Cancel.
  Old-epoch unknown history is excluded by the current-owner-only source, not interpreted as current work.
- **Changes/check truth:** one actual capture still supplies current body and fingerprint, with honest coverage and no generation advance on read.
  Actual own-generation PASS, later external stale, changed configured not-run, latest relevant check results, epoch/cwd/environment freshness and human issues review retain their shared policy and immutable native facts.
- **Portable proposal:** shared decoders run before digest work; tests now cover malformed UTF-8, plan/instruction byte bounds, wrong role/model, duplicate assignment, version overflow, invalid UUID/hash and async caller-mutation safety.
  Native and Web Crypto hashes agree.
  A real explicit Save with a colliding prospective record ID cannot adopt retained membership or overwrite v1; it conservatively fences on retention refusal.
  A syntactically valid wrong digest is still refused by server preflight.
  The helper remains Node-free, a local proposal only, and unbound from W6.
- **Transport:** existing typed current GET/readonly POST, exact correlation, AbortSignal, raw whole-Reply 512KiB, plan32KiB and changes128KiB limits remain.
  Auth/Origin/CSRF/local/attachment, finite proof/graph envelopes and export revocation regressions pass.
  No GET publication, getAuth, settings/discovery, all-archive cache or new reader protocol was added.

The original thirteen cases were not treated as exhaustive proof.
The file now has twenty-four cases, supplemented by complete affected scheduler/check/review/model/owner/HTTP/lineage files.
Timing/source/response fault injections are explicitly distinct from real native SDK, shell and disk facts.

## Executed verification and freeze

Evidence root: `/home/mirako/cadence-current-review-QBa1Itak`, freshly allocated mode0700 on `/dev/sda2` ext4.
Every command set TMPDIR/TEMP/TMP to a mode0700 home-disk root; initial context commands used the separate `.cache/cadence-review-w4-current` directory, then all executable verification used the root above.
Fixtures further isolated home, agent directory, workspace and state and used fabricated credentials/numeric loopback.
Observed runtime: Linux x86_64, `/usr/bin/node` v26.7.0, Bun1.3.14, installed Pi0.84.3, Vitest4.1.10.

[Evidence JSON](w4-current-views-review-evidence.json) binds exact commands, original runner PIDs/waits/exits, logs/results, native receipt hashes, preimages and the final **376-input** manifest.
The final executable inputs stayed identical through the disjoint regression batches and canonical gates.
The final current-file result precedes manifest creation but uses the same final source/test bytes; its earlier preimage and subsequent input hashes are retained.

| Final batch                                                               | Passed / files | Original runner elapsed |
| ------------------------------------------------------------------------- | -------------: | ----------------------: |
| Current-view file                                                         |          24 /1 |                  68.70s |
| Complete scheduler/core/accepted-work/check/human-review files            |          82 /5 |                 546.04s |
| Model-choice/review/model-context/owner/contracts/auth                    |         549 /6 |                 156.01s |
| Plans/projection/live-detail/publication/proof/graph-boundary/export HTTP |         139 /7 |                 131.27s |

These disjoint final batches are **794 passed /0 failed /0 pending across19 files**, not a whole-repository suite or794 native scenarios.
The unchanged green files were not repeatedly rerun to manufacture a pass.
All original runners were waited with ample outer allowances and no forced termination.

Canonical `build:service`, `build:web`, `build:web:check`, root `check`, `check:agents`, `check:web` and `test:web` exited0.
Web tests: **105 passed /7 files**, not browser execution.
Operator, management/host bundles and all canonical browser assets remained byte-identical; both private web productions matched, and the separate byte-check matched the canonical closure.
This is expected while TaskActions is not imported by the mutation-closed production host; it is not compiled accepting-host coverage.
Current auth/web destination provenance remains unchanged and is separately hash-checked.
Final whole lint and explicit new-report Markdown results are recorded in the evidence JSON.

No existing20s case,15s native-child,8MiB/100ms read or5s recording allowance changed.
The new eight-episode multi-operation fixture has a declared60s case budget, not a larger child/read/capture budget.
The new manual-check fixture initially used an invalid1000ms selector; its preserved21-pass/1-fail run correctly refused before launch.
It was corrected to the existing mandatory Manual/120000ms selection without changing its20s case allowance.
The four pre-fix failures and that fixture mistake remain separate failed receipts; no later pass rewrites them.

Final source SHA-256: `cc5f6bb79b0f96b7460c792f3e23290eeb949dc840a4656af51e4eca44501c08`.
Final test SHA-256: `42bdf4a49fc4522f56ec717321ab98aad344b49ba611047dc941bcffcde1c1be`.
Final manifest SHA-256: `61ccf6562fc4cf18550faf6cfcb0662c59b19c878fe40c0d064ecbd12448292b`.

## Remaining gates and limits

1. The prior nineteen broader scheduler/review failures remain unresolved historical failures, even though the complete affected files passed once here on changed source.
2. Production model-choice POST/current/task admission must remain closed until actual host/current/secret/lifetime composition, package-relative assets and independently computed compatibility are implemented and reviewed.
3. W6 metadata/chooser/current-changes/active-run adapters must revalidate after awaited graph/digest work, preserve same-attachment refresh and keep Save/Generate/Start separate.
   No browser action/handshake was activated or qualified here.
4. Accepting authenticated full workflows, complete Stop windows, W1 proxy/informed recovery, W5 native cutover and W7 exact package/notices/extraction/full acceptance remain open.
5. Paid-provider, physical-human/device, alternate native platform/runtime/peer and real deployment qualification remain absent.
   Bounded source rereads do not promise atomic filesystem snapshots, change-and-revert detection or universal redaction.

Spec-sync judgment: the final source check must follow dependent check/review reads, and readonly sanitization freshness must not depend on having a selected model.
These executable lessons are recorded here for the main-owned spec update; no maintained spec or task-status edits were made in this review.
