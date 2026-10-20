# W1-Owned Interface Freeze Handoff

The original planning shape below is now concretized in W1 shared source.
Joint reciprocal consumer acceptance is recorded in `../../10-16-cadence-service-owner/research/joint-interface-freeze.json`, binding actual source hashes and both consumer reports.
The candidate passed114 focused portable tests; native/runtime acceptance is still pending.
W1 retains shared contract/client files and `test/service-contract.test.ts` ownership.
W2/W3 have accepted the interfaces; no shared-file ownership transfer or child implementation is implied until main explicitly assigns it.
The main session assigns one editor at a time for shared files and records any material contract change in the authoritative parent design.

## Required Contract Groups

| Group                  | Producer → consumer                    | Required facts                                                                                                                                     |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Action context         | Clients → admission                    | Epoch/access/config/control/task/graph identities, exact action payload, explicit one-use grant and command ID.                                    |
| Receipt lookup         | History → owner/client                 | Known accepted/refused/uncertain versus conclusively absent; inconclusive indexes never authorize duplicate work.                                  |
| Capture frame          | Worker → decoder                       | Protocol2, child identity, monotonic worker sequence, typed genuine message/tool/detail data and source/capture coverage.                          |
| Public recording input | Decoder/owner → history writer         | Validated sanitized data, independent stored offsets/hashes, actual identity linkage; no auth envelopes or unbounded objects.                      |
| Commit result          | History writer → scheduler/projector   | Global committed sequence and stable content/result references; only durable native settlement permits dependent work.                             |
| Auth accounting        | Owner auth adapter → journal           | Credential-free preparation intent before getAuth, original-promise settlement afterward, unknown on unmatched crash.                              |
| Dependency handoff     | Scheduler/history → worker preparation | Exact committed input versions/ranges, frozen order, supplied/omitted coverage and exact serialized request budget.                                |
| Read cursor            | Reader → clients                       | Store/scope/query/snapshot/entity/version/offset, independently authenticated on every read and stable across restart.                             |
| Projection             | Owner/reader → both clients            | Task/run/child lifecycle, native outcome/closure, wait/block reasons, check/review, recording coverage and connection freshness as separate facts. |

## Shape and Error Semantics

The public client exposes finite typed methods, not a generic upstream message sender.
A recording sink returns a promise for committed acceptance or a typed persistence refusal; it never waits for a browser.
Synchronous source callbacks reserve bounded ingress capacity before their first await; accounting cannot begin only after an async queue wait.
The owner can request safety cancellation even when persistence fails, but must label its receipt/effect durability unknown.
A successful native exit and failed recording remain two facts, not an invented successful workflow.

Request/body and worker budgets are different: control payload1MiB accommodates a graph512KiB; each actual worker envelope remains128KiB.
Dependency input selection is frozen and bounded, not an instruction to concatenate the complete archive.
All constants come from the selected parent design/appendices, not earlier competing research defaults.

## Freeze Evidence to Produce During W1

- Actual exported DTO/decoder/port signatures and relevant source hashes.
- W2/W3 review of framing, source limits, sanitization, artifact refs, commit/receipt and closure semantics.
- W4 review of role/dependency/input/wait-block transitions and W5/W6 review of action/read parity.
- Shared contract tests for invalid/oversized values, unknown versus absent receipt, duplicate/stale admission, authentic capture coverage and cursor identity.
- Exact shared-file editor handoff schedule; reciprocal interface agreement is not a circular implementation dependency.

No future child may replace these shared contracts with local casts, separate reducers or a private protocol to bypass an integration difficulty.

## Explicit Read-Progress Revision

The original freeze remains historical.
Main assigned the additive cursor/progress/readonly-POST correction in `read-progress-decision.md` to one W3 editor, then an independent checker, after source-reviewed proof of the old representation's limit.
Record new source hashes and replacement read-correlation vectors; never relabel the old hashes as the new contract.
Worker/model/capture/admission semantics are not part of that revision.
