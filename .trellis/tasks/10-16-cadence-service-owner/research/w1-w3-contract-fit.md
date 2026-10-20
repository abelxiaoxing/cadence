# W1 consumer-interface fit review — W3/W4

## Verdict and evidence boundary

**NOT READY for the full W1 shared-interface freeze.**
The admission/receipt and worker-capture candidates are useful, but there are concrete bounded-admission and parent-closure problems, and the closed recording/read interfaces cannot yet carry several required owner/history facts without invented worker identities or consumer-local protocols.
This is not a request to implement HTTP, the filesystem writer, SDK authentication or the scheduler in this first chunk.
Main owns changes and the subsequent reciprocal review.

Active task was resolved with `python3 ./.trellis/scripts/task.py current --source` to `.trellis/tasks/10-16-cadence-service-owner` (session source).
This review writes only this research artifact.
No product edits, tests, installs, services, credentials, task changes or Git operations were performed.
Examples below are source-derived counterexamples and proposed verification cases, **not executed reproductions**.

Read the four complete candidate source files, W1 artifacts/manifests/handoff/review, the parent PRD/design/implementation plan, both mandatory appendices, `research/interface-freeze.md`, relevant maintained contracts, and relevant existing contract-test fixtures.
The selected parent contracts supersede old terminal-only specifications.
No external SDK API change is proposed here; external documentation was not needed to establish these portable-interface findings.

Reviewed source identities match the post-fix independent review:

| Source | SHA-256 |
| --- | --- |
| `src/service-contract.ts` | `56482a492910a9a58f3004b1ba854f0910de3b8d2cc16ba1505ab6cff118a0a0` |
| `src/service-client.ts` | `04732fb8edd41b63d71ad5ef0b1305d998fecfcf3bf41911d93569bbb9dd3cab` |
| `src/service/admission.ts` | `202a3f440eb3bcea184b94d29cfca0eafb2d0c762febb3ea8171a76dc557538a` |
| `src/service/ports.ts` | `2a1c6281d03b3dd62d1c7b6e9515f3cc9c7adbec474d5e0d29b8434eb24ce8ed` |

The earlier review's fixes and reported memory-fixture passes are acknowledged, not rerun or promoted to consumer-freeze/native evidence.
Its “ready for joint review” is distinct from the full freeze requested here.

## Required corrections

### F1 — Admission retains an unbounded queue behind stalled async work

**High; concrete behavior in the current core.**

Source: `src/service/admission.ts:60–77,195–245,273–281,345,382–384,424–443`.
`serial()` appends a new closure/promise to an unbounded tail.
Preflight's 16-entry confirmation map does not bound that tail: repeated requests from the same attachment call `detach`, invalidate the prior lease and replace its map entry, but each already-enqueued closure still retains its decoded request until earlier work finishes.
A request can contain a large graph.
Submit has no queue admission bound at all; rejection of invalid/consumed grants happens only after it reaches the queue and performs receipt lookup.
Cancel deliberately bypasses this lane, but concurrent cancel lookups/writes also have no in-flight reservation bound in this core.

If one `owner.observe`, ordinary `persistence.lookup`, `persistence.commit`, or post-commit observation never settles, the queue cannot drain.
Grant expiry is checked on eventual processing, not a queue lifetime bound.
Only Cancel persistence has the five-second recording-stall race.
Thus “one pending modal per attachment bounds RAM” is not true of the retained admission work, even with a single authenticated viewer and individually bounded requests.
This does not require an unauthenticated ingress or a missing future HTTP implementation to occur.

Required correction:

- Reserve bounded pending/in-flight count and retained bytes synchronously before queuing/retaining requests; replacement or invalidation must not leave arbitrarily many retained queue entries.
- Bound receipt-observation requests and cancellation accounting too, while preserving a bounded, coalesced safety-stop path that is not denied behind ordinary action work.
- Specify bounded observation/admission waits and apply the selected recording-stall policy to ordinary persistence, not just Cancel.
  A deadline is not cancellation or rollback of the original write.
- On uncertain accepted/write state, preserve the original promise/intent, fence unsafe admission, and prohibit late activation after timeout/quarantine.
  Do not release reservations as though an unresolved operation settled, or use a timeout to authorize another effect.

Proposed cases: hold each await pending; issue many same-attachment preflights and same/different-ID submits; assert bounded retained work and deterministic capacity responses; verify Cancel remains usable and a late commit never launches.
These are proposed, not executed.

### F2 — Completed parents are forced through an undefined aggregate closure meaning

**High; native-versus-aggregate semantic freeze gap.**

Source: `src/service-contract.ts:386–394,983–1027,1537–1596,1651–1726`.
Both `decodeReceipt` and `decodeRunProjection` require `closure === "direct-child-closed"` whenever execution/outcome is completed.
`RunProjection` represents a parent with `childRunId: null, assignmentId: null`, using the same closure type and success predicate as a child.

Consider parent P with required children A and B, both durably completed after their separate native closes.
P has no original process handle of its own.
It cannot report completed with `null` or `not-launched` closure; it must emit the same literal used for an individual native child.
The same issue reaches P's command receipt.
The literal could be given an explicit collective meaning for a parent, but that meaning is not defined by the current shape/decoder; a consumer must not silently equate one close with “all required children settled.”
Even a one-child parent is an aggregate, not an additional observed native process.

Required correction: distinguish parent aggregate settlement from SDK-child native closure, preferably with discriminated projection/receipt variants or a separate aggregate closure field/type.
If retaining the parent design's literal vocabulary, explicitly define and tag its parent meaning as closure of the required child set, with a common aggregation rule; do not manufacture an extra parent native process.
Parent success must mean every required assignment satisfied its own native and mandatory-recording conditions.
Preserve the exact scope of `direct-child-closed`: it never proves escaped descendants closed, nor all siblings closed.
Do not fix this by weakening `decodeNativeSettlement`.

`NativeSettlement` is correctly the **SDK-child** shape: completed requires delivered stdin, valid assistant final, settled cleanup, native zero close and complete observed capture.
An ordinary successful parent check can have no stdin payload and no assistant final; it must not fabricate those facts to pass this decoder.
A separate check-native shape is required at the owner recording boundary (F3).

Proposed cases: one-parent/one-child and one-parent/many-child success; one failed or unconfirmed child beside completed siblings; native exit zero followed by recording failure; ordinary stdin-less check success.
None may conflate parent aggregate, check result, or SDK-child facts.

### F3 — The recording ports can record SDK children, not the required owner/check facts

**Freeze blocker; missing shared data seam, not missing storage implementation.**

Source: `src/service/ports.ts:82–166`; `src/service-contract.ts:1291–1356,1537–1596`.
`PublicRecordingInput` always contains a `CaptureFrame` and a `RecordingLink` with mandatory `childRunId`.
`CaptureEvent` describes worker messages/tools/details, and detail ownership is only `context | message | tool`.
`ProcessAccountingPort.settlement` also requires that child link and SDK `NativeSettlement`.
`AuthAccountingPort` and `AdmissionPersistence` do provide separate auth/admission seams, but there is no equivalent owner-origin append contract for parent/check/change/review/publication facts.

A real parent shell check cannot use the supplied process port without inventing an SDK child and assistant-final/input semantics.
A task-only human review, baseline/change capture, expected-byte v1 publication conflict, or parent settlement cannot use the only content sink truthfully either.
Adding `Field: "check" | "changes" | "review"` does not solve this: a field name is not a typed owner event, identity linkage, native check observation, or publication transition.
Encoding these as arbitrary strings in worker context/tool records would create the private interpretation layer the freeze explicitly forbids.

Required correction before W3/W4 share a frozen store contract:

- Define a closed owner-origin recording/event port alongside, not in place of, worker capture.
  Link task, parent operation/run, optional child and stable content versions without requiring a fictitious child.
- Give actual checks their own native facts and separately projected obligation/freshness status; `not-run`, stale, failed and passed must not be inferred from tool prose or SDK finals.
- Carry parent settlement and exact dependency-handoff/observation facts, plus v1 publication intent/outcome with expected task revision/raw identity and resulting observation where known.
  Keep publication distinct from execution and recording settlement.
- Connect these events to the same durable batch/sequence/content-reference return contract and to typed read projections.
  No second journal authority or competing decoder is needed.

It is reasonable to leave these ports unimplemented now.
It is not reasonable to freeze the current worker-only sink as the complete W3/W4 interface and require later children to invent incompatible adapters.

### F4 — Current action context and historical run identity are conflated

**Freeze blocker; existing closed projection has no truthful unavailable-context alternative.**

Source: `src/service-contract.ts:705–754,1651–1776`; `src/service-client.ts:317–345`.
`Snapshot` requires one fully valid current `ContextVersion`, and every run must match that context's task.
Each run row contains IDs/state/result, but no frozen admission/graph reference or operation kind.

Two distinct facts are needed:

1. The current checkout/task/model/config identity against which a new action may be confirmed.
2. The immutable admitted identity of each historical run, which can refer to an older plan, graph, model and task revision.

For task T with R1 under graph G1 and R2 under G2, the snapshot has only the current task/graph identity.
A client cannot associate R1's assignment IDs with its own frozen graph using the supplied read model; applying G2 to R1 is false.
Likewise, if the current task bytes or selected model configuration become missing/unsafe, retained valid historical data must remain readable without fabricating a usable current action context from old admission values.
An unconditional `Reply.error` for the whole snapshot would discard that distinction.
`ProjectionTracker` correctly permits progress at the same control revision, but its current-context object is not a substitute for per-run immutable identities.

Required correction:

- Preserve immutable admission/graph/context references and the operation kind on the run/read model, retrievable through the shared typed reader.
- Represent current control-context availability/refusal separately from retained history/state.
  Historical browsing must not construct SDK/auth or synthesize current mutation authority.
- Specify state-update versus context-update behavior: progress need not advance control revision; task/config changes must not relabel old runs; metadata-only updates must not require fabricating a run row.
  A snapshot/resync path for metadata changes is valid if explicitly selected.

This also makes the v1 distinction between completed advisory planning (`planning`) and completed execution (`review`) available without guessing from output text.
The current `CommandIdentity.action.kind` can provide the durable source of that distinction; expose/reference it rather than duplicating inference rules in clients.

### F5 — The bounded read model has no continuation/association contract for rich history

**Freeze blocker; preserve the selected bounds, do not expand snapshots into archives.**

Source: `src/service-contract.ts:1598–1649,1736–1943`; `src/service-client.ts:41–49,154–207`; `src/service/ports.ts:157–166`.

Concrete integration gaps in the current closed shapes:

- A task snapshot contains at most 200 parent/child rows and has no continuation or declared selection/omission policy.
  Twelve retained 16-child episodes already need 204 rows if all parent/child rows are included.
  `ProjectionTracker` can append until 200 and then only request resync; resync cannot discover an older-page contract that does not exist.
  Snapshots are explicitly meant to be bounded live projections, so define their horizon and separate historical run pages rather than raising the cap or silently hiding history.
- Rich worker IDs and content references exist on ingress, but the portable read side exposes only a run's single result reference, `DetailPage`, and `SearchHit`.
  There is no typed record/page carrying message/tool occurrence ownership, orphan associations, or frozen graph/context references back out.
  A task-scoped search hit's cursor retains task scope and a content reference, but does not identify the owning run/child/message/tool occurrence.
  Opening its text is possible; navigating to the correct correlated transcript/tool occurrence is not supplied by this model.
- Initial reads need an explicit contract, not just continuations.
  Search can already be seeded from a known snapshot with `recordId/recordVersion/field: null`, offset zero and a literal query; it is **not** inherently impossible to start search.
  Detail can start from a known content reference.
  But future task/run/message/tool page initialization, scope/snapshot binding and per-reader continuation identity are unspecified; `ReadCursor` has no list-reader discriminator if later page families reuse it unchanged.
  Freeze endpoint/request-bound reader identity or an explicit discriminator where needed; this does not prohibit the useful existing search-hit-cursor → detail navigation.
- `EXPORT_SCHEMA` and download limits exist, but no typed streaming export request/record/trailer or reader port connects the retained graph/content/owner facts to either client.
  Treating arbitrary `DetailPage.text` as a private JSON protocol would violate the single contract/decoder ownership rule.

Required correction: freeze the bounded first-page/request and continuation envelopes, record-owner links, snapshot horizon, and export stream contract with W3 before calling the read/client interface complete.
Include a completion trailer, incomplete-range coverage, selected-scope binding, chunk-wise access-generation recheck and client cancellation that detaches reading rather than execution.
These are interface definitions; real routes, filesystem scans, streaming output and browser rendering can remain later implementations.

Cursor behavior that is already sound should be preserved:

- No epoch in historical cursors; restart stability is compatible with reauthentication on each read.
- Detail continuation keeps content/scope/query/snapshot identity and advances exactly by the returned byte range.
- Search accepts zero-hit advancing continuations and checks literal query-byte range length.
- Cross-record ordering/UTF-8 boundaries, future snapshot rejection, exact source bytes and complete scan exhaustion are W3 reader checks, not something to infer from UUID lexical order.

Freeze a reader policy for rejecting unknown/future snapshot positions rather than accepting a caller's chosen sequence as authority.
Do not silently rebase a continuation to a newer snapshot or reinterpret a search continuation as a different page family.

### F6 — Complete action parity needs a typed bootstrap/result path

**Freeze completeness blocker, not a demand to build every endpoint now.**

Source: `src/service-contract.ts:795–858,983–1040,1598–1605,1736–1776`; `src/service-client.ts:41–49,57–156`.
The finite action methods and browser/local check distinction are good.
However, the supplied client cannot acquire a real workspace context for the first `create`: every snapshot scope is an already-known task/run/child, whereas Create requires a context with `task: null`.
There is no typed session/workspace capability/context reader.
An empty fabricated run snapshot is not a legitimate bootstrap.
Also, accepted Create has neither a task ID in its action nor a task/result ID in its receipt, so its durable result cannot be navigated directly through the supplied interface.

Required correction: define the shared read/bootstrap and created-entity result linkage, or explicitly mark this client surface as an unfrozen partial candidate until those definitions are supplied.
Do not let terminal and browser mint fake observed context or independently guess how operation IDs map to created task IDs.
The complete check/change/review/history/export adapters should consume the same new typed seams from F3–F5, not generic send or casts.
The actual HTTP endpoints remain expected later work.

## Multi-row live projection: freeze a producer rule, not a second sequence clock

Source: `src/service-contract.ts:1778–1841`; `src/service-client.ts:300–345`.
A live update contains exactly one run row, and the tracker ignores subsequent updates with the same committed sequence.
If one committed batch changes parent P and children A/B, sending three row updates all at that batch's final watermark applies only the first.
A matching heartbeat does not detect the missing rows; the periodic snapshot is the eventual repair.
This must not be the accidental parent/multi-run delivery model.

This is **not intrinsically unimplementable with the existing journal**: the producer can allocate distinct committed journal event sequences and send a correctly chained update for each affected row, only after the containing batch commits.
Alternatively, make one update carry all changed rows at the commit watermark.
Freeze and test one rule explicitly, including filtered-scope sequence gaps and parent/child changes in the same batch.
Do not invent client-local sequence numbers or require numerically contiguous global sequences for a filtered scope.
If the existing single-row form is retained, document the distinct-durable-sequence producer obligation in the W1/W3 handoff before approval.

## Fit assessments and valid nonblockers

### Command/receipt CAS is implementable as single-owner coordination

`AdmissionPersistence.commit` documents exact expected-context CAS and one control-revision increment before resolution (`src/service/ports.ts:35–49`).
Admission does receipt lookup before grant/epoch freshness, compares canonical identity excluding disposable grant/attachment, and never activates an existing receipt (`src/service/admission.ts:261–271,285–301,338–409`).
This supports lost-response/restart observation without automatic replay.

The post-commit preview normalization subtracts exactly one control revision and otherwise expects the selected preview unchanged.
Therefore the writer must commit **acceptance**, expose that control revision, and leave action effects/v1 publication to activation; applying save-plan/create/publication inside that commit would violate this contract.
A coordinated owner-context callback/state reference can implement this without a second accepting context copy.
It remains optimistic regarding arbitrary external file writers, not atomic filesystem CAS.

Preserve inert/partial intent and inconclusive lookup rather than treating it as absence.
The absent HTTP/disk implementation and lack of real crash evidence are expected, not separate defects in this first chunk.
F1 is the outstanding boundedness correction to this core.

### Auth uncertainty is representable without pretending it is process closure

`AuthPreparationIntent` and `AuthPreparationSettlement` carry operation/source-selection IDs and fixed outcomes, not credential objects/digests (`src/service/ports.ts:116–137`).
Preparation commits before getAuth; settlement follows the original promise even if caller admission closed.
An unmatched committed preparation after a crash can remain credential-uncertain even when no worker launch occurred.

Keep that uncertainty separate from native process settlement and process-lock recovery.
The real owner must track unresolved original promises, prevent late launches, and wait/quarantine honestly on stop.
Nothing in the current signatures requires canceling the refresh/writeback promise, replaying it, or clearing it through process recovery.
Missing real SDK resolver/management implementations are valid nonblockers for this chunk; their behavior is not proven by these types.
F3's owner/read facts must preserve this distinction when it becomes visible history.

### Partial results and publication do not require a new “partial success” outcome

`ExecutionOutcome` can remain failed/canceled/timeout/unknown/blocked while completed sibling rows and retained result references remain inspectable.
A separate partial enum is not required merely because some children succeeded.
The explicit `partial-results` issue also exists.
The parent all-success rule must never ignore required unstarted/failed/unknown children.
F2 concerns the aggregate closure representation, not adding a green partial state.

`Receipt.publication` and `RunProjection.publication` are already independent from execution.
Completed native work with publication conflict is representable and must remain so; external task bytes are preserved and unsafe continuation blocked.
Likewise native exit zero can remain a native fact while mandatory recording failure prevents overall success.
The missing owner publication/check record seam in F3 must expose those facts rather than overwriting native outcomes.
Human Done/review cannot alter execution/check facts.

### Bounded v1 summaries are compatible with rich retained data

`decodeAction` retains goal 8KiB/plan 32KiB limits; existing `src/task-types.ts` retains result/baseline 16KiB, 64 activities, 32 checks and the 128KiB closed v1 record.
`ContentRef`/detail paging can retain much larger allowed content independently.
There is no requirement to insert full final text into v1 or add task keys.
W3 can publish visibly labeled previews plus stable run IDs and keep full sanitized detail private.
It must check the whole encoded v1 record, not assume each individually valid field guarantees a valid aggregate record.

The approved mapping remains queued/preparing/running → running; completed execution → review; completed advisory planning → planning; failed/blocked/mandatory-recording-failed → failed; canceled/timeout/unknown → interrupted; human closure only → done.
Failed children plus a passed check stay failed/partial; a publication conflict is not a replacement execution outcome.
No extra summary compiler or legacy migration is needed.

### Dependency and content limits are implementable

`Graph`/`Dependency` and `DependencyHandoff` freeze source/range, current versus historical references, destination assignment/dependency index, exact supplied text and coverage (`src/service-contract.ts:524–674,1132–1264`).
Whole-result equality and 16KiB-per-input/32KiB-aggregate limits reject silent clipping.
The independent 96KiB public and 128KiB actual-envelope bounds correctly account for serialization/auth separately.
Oversized required inputs block the episode; no hidden synthesis or archive filesystem access is justified.

W4 must resolve actual committed versions, graph order, known predecessor settlement, freshness/observation and UTF-8 boundaries; W3 supplies exact retained bytes/references.
These are legitimate implementation responsibilities, not evidence that the codec must itself become a scheduler.
Recording the supplied handoff and its observations needs the owner event seam in F3.

### Capture/native/store separation should remain

The synchronous `CaptureSink.reserve` is the correct shape for pre-await ingress accounting.
`PreparedWorkerPort.launch` returns SDK-native facts; `ProcessAccountingPort.settlement` separately returns committed recording status.
A consumer must require both before releasing dependent work.
Native settlement alone must not become durable workflow completion.

The handoff already states that W2 validates wire associations/offsets/hashes before owner sanitization and W3 assigns independent stored offsets/hashes.
Do not treat the TypeScript frame type as proof of sanitization, genuine SDK origin, queue bounds, fsync or native process behavior.
The missing maintained-JS codec integration, real sink, SDK producer and filesystem qualifications are expected later work, not reasons to fake accepting adapters now.

## Main-session correction/handoff order

1. Fix F1 and choose explicit parent/check/aggregate closure semantics for F2.
2. Freeze owner-origin journal/check/publication and immutable-run/current-context separation (F3/F4).
3. Freeze bounded reader initialization/continuations/ownership/export and client bootstrap/result linkage (F5/F6).
4. Record the multi-row committed-update rule and single-editor handoffs; obtain reciprocal W2/W3/W4 agreement on the actual signatures.
5. Main adds/runs focused contract regressions; later native/filesystem/SDK/client lanes remain separately required.

Until then, accept these files as reviewed candidates with compatible pieces, **not a frozen complete W3/W4 consumer contract and not W1/product completion**.
