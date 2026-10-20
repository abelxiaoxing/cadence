# W2 producer / recording independent review

## Scope and disposition

Reviewed the actual producer, stateful decoder, native launcher, mandatory recording adapter, sanitizers and custom bash boundary, not just the relocated schemas.
Loaded the child artifacts/curated context, parent PRD/design/plan and both mandatory appendices; inspected installed public Pi0.84.3 declarations/agent-loop/bash operations and the relevant complete official SDK/message/session documentation and SDK examples.
The approved redesign supersedes the old tiny-transcript contract, not the preserved auth, readonly, input, cleanup, native-close or cancellation guarantees.

The defects below were fixed within W2 ownership.
No W1 implementation, frozen portable DTO/limit/port semantics, package/lock, task status, existing report, credential store belonging to a user, Git index/ref or consumer history was changed.
No nested agents, installations, provider accounts, deployments, pack or release operations were used.
This review does **not** close W2 or qualify the integrated product.

Final verification results and exact source/log identities are recorded in [review evidence](w2-producer-review-checks/review-evidence.json).
W3/W4 composition and W7 distribution remain genuine gates, not defects attributed to missing future modules.

## Findings fixed

| Finding                                                      | Counterexample / correction                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Healthy batched recorder falsely exhausts capture            | The prepared native2MiB response failed against a serialized100ms recorder. `WorkerRecording.chain` waited for each acknowledgment before submitting the next input, preventing batching and accumulating conservative reservations. Invoke commits synchronously in source order into the **one** sink; bound outstanding admission below existing byte/slot ceilings and pause the actual stdout reader while awaiting capacity. No budget increases or dropped detail. |
| Prepared source freshness gap                                | A real `OwnerModelContext.consume` test changed fabricated credentials inside `sink.reserve`; the old adapter still launched. Allocate recording/parser reservations inside the encoder, **before W1's final freshness/size/cancellation check**. Its synchronous use callback then enters the existing native launcher. The regression now observes no worker/contact.                                                                                                   |
| Owner-only MIME secret reaches storage                       | The second projection sanitized text, tool names and source IDs but not `omitted-block.mimeType`. Redact changed MIME to null with explicit redacted coverage. `sourceType` and reason are already closed code-owned enums, not arbitrary source strings.                                                                                                                                                                                                                 |
| Partial argument source incorrectly treated as complete JSON | Legitimate unfinished strings and unexecuted declarations failed when ending their UTF-8 partial field. Preserve safe unfinished prefixes without inventing closing syntax. Malformed/undecodable suffixes are explicit redacted unsupported-source omissions; escaped invalid unquoted tokens cannot bypass sanitization. Final/execution canonical JSON remains strict, and resource overflow still fails.                                                              |
| Ordinary partial declarations over-reserved                  | Five small simultaneous declarations exhausted the worker queue because every partial stream prepaid1MiB. Charge incremental lexical retention and its source/expansion transfer instead; include retained stack keys in accounting. The shared4MiB/1024 and8MiB/2048 ceilings are unchanged.                                                                                                                                                                             |
| Final block/selection hash disagreement                      | Independent finalized blocks `token=` and `ordinary` produced a different hash when selected text was sanitized again across the block boundary. Select the ordered concatenation of the same finalized **field projections**, without inserted separators or a second cross-field interpretation. Original wire hashes remain validated before owner sanitization.                                                                                                       |
| Invented association for null IDs                            | Null IDs were published as unavailable but could still match by null/name in RAM. Only nonempty actual string IDs can join occurrences; unsafe string IDs remain usable privately without publishing their bytes. A further wire regression rejects replacement of a declaration's observed source identity at tool-start.                                                                                                                                                |
| Non-awaited callback / bash retention gaps                   | Tool update callback throws prematurely refunded possibly enqueued copies, and returned rejections were not handled. Handle returned promises and retain handed-off leases until original subscriber release. The redacted bash accumulator now participates in the same queue before append, rather than bypassing it up to the detail ceiling. Exhaustion aborts/fails without spill or retry.                                                                          |

Additional native-path corrections preserve original facts: no-input/legacy parsing remains synchronous; recording-only pause/drain waits the original read continuation before finalizing native close; all stop reasons wake ingress waits; an already observed native close is not signaled as a live PID; synchronous required-stdin write failure waits for real close.
Independent unused-lease cleanup failures retain uncertainty rather than throwing opaque sink errors or preventing other releases.

## Changed files

- `src/subagent-process.ts`: bounded native ingress and real prepared-context composition.
- `src/worker-recording.ts`: ordered pipelined sink admission, retention transfer and second projection.
- `src/worker-capture.mjs`, `src/worker-capture.d.mts`: private queue accounting, finalized field selection and association validation.
- `src/worker-redaction.mjs`, `src/worker-redaction.d.mts`: safe partial-source handling and retained lexical accounting.
- `src/worker-tools.mjs`: synchronous ingress lifetime and bounded redacted bash retention.
- `test/worker-capture.test.ts`, `test/worker-recording.test.ts`: counterexamples and actual native/prepared/disk controls.

`src/sdk-worker.mjs`, `src/sdk-network.ts`, `src/worker-public.mjs`/declaration and W1 facade/contracts/ports remain unchanged by this review.
The portable JS validators remain the sole executable wire/DTO owner.
No v1 accepting parser, default accepting sink or durable legacy fallback was introduced.

## Verification results

Final frozen-source run: **981 passed / 0 failed / 0 skipped, 10 files, 240.57s**.
This is the prior955-case focused set plus26 review regressions, not a sum of overlapping reruns.
`bun run check` and `bun run check:agents` passed; the final lint receipt is in the evidence index.
The source hashes before and after the final run are identical, including the unchanged frozen interfaces and package/lock.
No known in-scope blocking finding remains on the tested host; the integration/qualification limits below still apply.

## Verification classification

### Native SDK / filesystem boundaries

- Actual stock SDK/adapter, numeric-loopback fabricated auth, prepared v2 launcher and a response exceeding2MiB (not the sink-less legacy adapter).
  The fixture submits bounded batches at100ms/256KiB into one serialized sequence of genuine `appendFile` operations.
  Assertions require exact full selected text, canary redaction, zero original exit, valid final, delivered stdin, actual close and released leases.
  Existing20s test/15s child budgets remain.
- A genuinely fast512KiB SDK response against a gated recorder retains original pending charges after the5s reporting stall.
  Releasing the original gate/write clears charges but cannot repair the returned unsuccessful recording.
- Actual filesystem write refusal (EISDIR) fences the fixture writer after one append attempt and cannot produce completion.
  This is **not** a native disk-quota/ENOSPC qualification.
- Real `OwnerModelContext` reads only explicitly created fabricated stores, resolves public SDK auth and supplies its actual one-use closure to the native launcher.
  Positive small and greater-than96KiB actual serialized envelopes remain within128KiB; original worker close, both EOFs, stdin delivery, one launch/contact and replay refusal are asserted.
  Missing sink, changed request, cancellation and source change at reservation launch nothing.
  These are real W1 preparation APIs; their auth-journal receipts remain injected.
- Existing guarded actual bash output/result/no-spill and invalid UTF-8, model/thinking/header/null/base-URL/auth/proxy, input/cleanup/cancel/unknown native lanes are retained.
  The exact tool-role output assertion was not weakened to match command arguments.

The disk recorder's content references and commit watermarks are **fixture references**, not W3 journal/fsync/crash durability.
W1 auth accounting in composition controls is explicitly injected.
The2MiB disk cases still inject the outer prepared closure; the separate W1 cases exercise the real closure.
Neither classification is substituted for the other.

### Injected / portable boundaries

Public-event tests cover partial/final/unexecuted declarations, absent/null/unsafe/reused IDs, orphan observations, changed source identity and finalized-vs-stream fields.
Five simultaneous partial declarations and synchronous overlapping callback/failure controls exercise accounting before subscriber yield.
Controlled bash operations exercise accumulator exhaustion, not an additional native shell qualification.

Metadata and escaped/canonical-JSON sanitization controls use bounded fabricated source values.
An additional31-size escaped non-BMP/split-surrogate probe passed; it is a portable probe and is **not added** to the suite total.
Worker-known canaries stay out of raw child stdout.
The owner-only fake canary is deliberately absent from stdin/auth, can occur in the fixture's private child pipe, and is removed before public recording; browser secrets are not supplied to the child for redaction.

The original assertion disposition map remains preserved.
Same-v2 legacy presentation is temporary W5 compatibility only.
Exact model/thinking, literal auth/null headers, proxy routing, UTF-8, required stdin, native unknown/cleanup and readonly safety intent remain.
The old tiny output refusals remain deliberate rich-capture replacements, not deleted flood protection.
Shared codec vectors executing through two entry surfaces and overlapping development reruns are not independent extra capabilities.

## Preserved failures and remaining gates

All review experiments are retained under `w2-producer-review-checks/`, including the healthy batching failure, projection failures, real freshness launch counterexample, null-ID/escaped-token/source-identity failures and partial-reservation exhaustion.
Fixture-development failures are distinguished: an initially invalid source-type test value, state-home placement, inherited routing refusal, missing type metadata and an initial pause implementation applied to legacy lifecycle mocks.
Those failures were corrected, not relabeled native passes or hidden by weaker fixtures.

W3 must still provide its real ordered batch sink, independently stored offsets/hashes/versions, durable exact result membership, auth/process settlement, actual quota/crash/torn-tail behavior and history readers.
W4 must compose launch intent, original settlement, dependency eligibility and unknown fences.
W5 owns removal of embedded legacy reachability; W7 owns exact maintained-helper/package/extracted-client closure and integrated acceptance.

No complete repository suite, package/extraction, service/client cutover, real W3 durability, real storage quota exhaustion, paid-provider, physical-human, Node22, modern1.2 peer, Windows/macOS or ConPTY qualification is claimed.
Cadence-owned accounting is not a total SDK/provider/process-memory bound, universal secret detector, sandbox or descendant-closure proof.
