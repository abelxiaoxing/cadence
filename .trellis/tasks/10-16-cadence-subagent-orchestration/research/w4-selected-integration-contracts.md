# W4 selected integration contracts — accepted-plan slice

## Boundary and authority

The started W4 delegation assigns one editor the existing writer/publication/read seams.
This first coherent slice implements accepted save-plan content production and a bounded readonly published-plan lookup.
It does not enable host task admission, implement a partial executor, change task status/specs, or claim W4 acceptance.
Existing source and unrelated working data remain preserved.

Source facts: `HistoryWriter.openDetail/end` currently generates a random content ID and version1; `publicationRecord` requires the accepted graph's exact committed plan reference and text.
`Action.save-plan` already names that prospective reference.
`OperationState` already reduces metadata publication independently of execution.
No new journal schema, arbitrary public content-ID override, or second writer/reducer is needed.

## Selected APIs

- `src/history/plans.ts` owns pure `proposePlanContent(plan, version, secrets)` and `assertPlanContent(plan, reference, secrets)`.
  Proposals allocate a UUID, exact UTF-8 byte count/SHA and selected positive version, but are not committed references.
  Sanitization-changing text is refused rather than silently modifying approved bytes.
  The caller supplies owner literals explicitly; neither helper reads credentials or writes files.
- `HistoryWriter.retainAcceptedPlan(operationId, secrets)` derives text, task, reference and version exclusively from that operation's committed save-plan action.
  It accepts no replacement text/ID/version.
  It validates exact action membership, current epoch/context and original task bytes, sanitized byte/hash equality, and collision/duplicate ownership before retaining through the existing content/artifact/journal path.
  General owner and worker content allocation stays random/version1.
  Reservations precede retained event copies; original job accounting stays with the existing writer.
- `HistoryReader.publishedPlan(taskId, snapshotSeq)` returns the latest published saved-plan descriptor or null after a conclusive bounded scan.
  It uses original committed acceptance plus the existing `OperationState` publication transition, exact retained plan membership/bytes and graph hash.
  Pending/conflicted/uncertain later save-plan is a refusal, never fallback execution authority.
  It is a bounded owner lookup, not a browser proof token or automatic Start.
  Exhausted scans remain inconclusive.
  No whole-archive cache or write-on-read.
- Saved graph identity for this producer is `{recordId: operationId, revision: graph.revision, sha256: SHA256(canonicalJson(graph))}`.
  A descriptor also carries the exact successful v1 publication revision/raw identity; future ActionOwner must reconcile only its own subsequent publications and refuse foreign edits.
  Historical graph data is not current execution consent.

## Compatibility and remaining composition

Existing history records, format2 reads, worker capture/ordinary owner allocation, public graph/request schemas and strict v1 bounds remain unchanged.
The descriptor lookup is not yet the full graph HTTP/proof/export integration; that remains explicitly pending rather than returning fabricated graph data.
Existing run-associated graph readers continue unchanged.

Future slices must implement the closed per-child/gate/admission-stop vocabulary in the same reducer/progress/export owners; exact own-check generation; real graph/role/hint/model builder; one ActionOwner and fair scheduler; actual frozen-environment full-output checks/review; and the real current-view/HTTP composition.
Goal-only/default/explicit legacy episode production and generated proposal handling remain pending.
Owner-specific sanitizer checks must run before save-plan consent/admission, not merely after acceptance.
The host remains `admission:null` / actions false until all accepting paths exist and are checked.

W1's `prepareTracked`, writer `onOriginal` and existing native worker/check helpers remain the selected lifetime/execution owners.
No SDK, native runner, capture protocol, dependency pin/lock, credentials, actual checkout deployment, cleanup, or Git mutation changes are part of this slice.

## Verification plan

Use fresh0700 disk roots under `/home/mirako/abel/w4-orchestration-tpiPmM` with explicit TMPDIR/TEMP/TMP.
Exercise committed create/save-plan/publication and exact plan retention on actual private disk: no writes for pure proposals, non-v1 plan versions, UTF-8/empty plans, byte/hash/sanitizer refusal, duplicate/collision, wrong-operation/unaccepted IDs, pending/conflicted publication, later revisions and reopened readers.
Label admission/model/role fixture inputs separately from real disk/publication facts.
Run affected history tests, root check/lint/Agent checks and deterministic service rebuild.
Preserve failed logs.
Main must independently check this slice; no product or historical-failure-causality claim follows.
