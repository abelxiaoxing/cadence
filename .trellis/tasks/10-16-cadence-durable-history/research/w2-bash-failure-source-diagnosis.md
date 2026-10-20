# W2 native bash failure — readonly source diagnosis

## Disposition and scope

**Open, unexplained native failure; no repair established.**
The first broad W3 run really failed the positive W2 bash case. The later filtered and broad passes show that the same case can succeed, not why the first attempt failed.
The strongest source-supported lead is overlapping tool-update projections exhausting conservative worker reservations, particularly the 1MiB surcharge per canonical-JSON detail. That is a discriminating hypothesis, **not an attribution of the recorded failure**.

Active task was resolved with `python3 ./.trellis/scripts/task.py current --source`: `.trellis/tasks/10-16-cadence-durable-history`, source `session:pi_01a1434b-d5a8-75bd-a752-9b20360b70f8`.
Only this new research artifact is authored. No source/test/spec/task-status changes, test or verification runs, native worker/service launches, network/install/Git/status operations, credential access or nested agents were performed. File reads, listings and SHA-256 comparisons are source/evidence inspection, not fresh execution qualification.

The parent PRD/design/plan and both mandatory appendices were read. Parent `design-runtime-history.md` §8 requires synchronous pre-copy accounting, bounded queues, honest refusal, public SDK APIs and no raw bash spill; successful native settlement cannot override mandatory capture failure. Existing SDK20s/child15s and capture limits remain mandatory. W3 remains current; a later **serial W2 ownership handoff** is needed for instrumentation or repair.

## 1. Preserved evidence and chronology

Sources:

- `research/w3-sealed-progress-handoff.md` and `research/w3-sealed-progress-checks.json` in this task.
- Private evidence root: `/home/mirako/abel/.cadence-w3-sealed-progress-blJlHLn5` (abbreviated **E** below).
- W2 historical review: `../10-16-cadence-worker-capture/research/w2-producer-review.md`, its `w2-producer-review-checks/review-evidence.json`, and original `w2-producer-handoff.md`.

| Recorded artifact | What it establishes |
| --- | --- |
| E/`09-all-history-prior-ten.log` | Explicit 21-file, `--no-file-parallelism` run: 1209 passed, 2 failed, exit1. `actual v2 SDK/native capture and custom bash: tool=true` failed in 1291ms; the other failure was missing shim export `decodeNavigation`. |
| E/`11-native-capture-diagnostic.log` | Filtered native case family: 3 passed, 27 skipped, exit0, 4.25s. Includes readonly, successful bash and intentional invalid-UTF8 refusal. No per-case queue/branch trace. |
| E/`18-final-history-prior-ten.log` | 1214 passed, 1 failed, exit1: a different >2MiB SDK-to-W3-writer child timeout. W2 bash was not a failing case in that run. |
| E/`19-native-history-diagnostic.log` | The separate W3 timeout reproduced: 0 passed, 1 failed, 41 skipped, exit1. |
| E/`27-final-repaired-history-prior-ten.log` | 21 files, 1215 passed, no failed/skipped, exit0, 555.99s. Later success includes bash, but contains no causal explanation of its earlier failure. |

The handoff describes a real writer-key-guard repair for the separate W3 timeout. The original W2 bash fixture supplies **no recording sink** to `runProcess`; it does not call the W3 writer or its key guard. That repair is not a direct repair of this bash failure. No inference about indirect machine load is justified. The missing shim export likewise does not explain this worker fault.

I read and recomputed the five log hashes above; all match `w3-sealed-progress-checks.json`:

```text
09 aa30813e7476a2ba89c81d9c13f038aa2b6e59ee04ca486c2d64e14ffbb90700
11 b5f2ad88695095159508ec0ecebbf6094ea49c560b60dee943e3c558313a8f73
18 59665b88dc84902eaa83fa7b2771a12e6cf05c905f0460daf04c327555308dc4
19 987b2e414c21b0ecfee07dae343b078366a59b880f946263b7ee8a9884a9c47a
27 ad2da80535a2d12787e3be2050058521200b3a17cca181bb9c524aaa46153290
```

The evidence records Node26.7.0 `/usr/bin/node`, Linux x64, Pi0.84.3, Bun1.3.14 and Vitest4.1.10. These are historical run identities, not newly executed capability observations. The W3 changed-source manifest does not include a complete per-attempt W2/peer closure. Current W2 bodies do match the earlier W2 review hashes (§7); that supports source continuity but cannot reconstruct every historical process input or scheduling condition.

## 2. What the fixed diagnostics actually establish

The failed assertion preserves `outcome: failed`, `closed: true`, `exitCode: 1`, and these two worker snapshots:

| Fixed field | First fault snapshot | Cleanup-settled snapshot |
| --- | --- | --- |
| stage / class | events / event-projection-failed | events / event-projection-failed |
| sdkEvents | 35 | 45 |
| inputBytes | 1042 | 1042 |
| modelOutputBytes | 0 | 0 |
| protocolBytes | 276759 | 299505 |
| terminalStopReason | toolUse | error |
| preflight | accepted | accepted |
| requestPrepared | true | true |
| actualResponseStatus | 200 | 200 |
| cleanupFailures / cleanupSettled | 0 / false | 0 / true |

Interpretation from `src/sdk-worker.mjs:61-146,312-325,412-461,480-549`:

- `fail()` preserves the **first fixed classification**, sets exit1, attempts a worker-failure control frame and emits the early snapshot. Later cleanup cannot repair it.
- `event-projection-failed` is a **many-to-one category**, not a stack location. It covers the subscription catch, `ingress.release` catch, the bash/ToolIngress shared failure callback, emitter write error/stall and stdout error. It does not say which operation or invariant failed.
- `sdkEvents` counts subscription entries, including entries after failure. It is not worker frame count, bash callback count, concurrent handler count or the ID/type of the faulting event. A failure callback can also occur outside that listener.
- `modelOutputBytes` counts assistant text/thinking deltas only. Zero does **not** mean no tool output, arguments, context, frames or memory pressure.
- `protocolBytes` combines emitter accounting with diagnostic bytes already attempted. It is not retained history size, raw bash bytes, queued bytes, delivered-byte acknowledgment or a queue high-water mark. The second value includes earlier diagnostic accounting.
- `terminalStopReason` is updated from actually observed assistant `message_end`, even after failure. `toolUse` says a prior assistant tool-use terminal message was observed; it does not identify the failing update. Later `error` is compatible with abort/error handling and is not proof that the provider caused the first fault.
- `preflight: accepted` is local prompt acceptance. `requestPrepared` is the local public payload hook. Status200 is an actual observed public HTTP response, but supplies neither request count nor an inference/authentication-success certificate for the whole run.
- The second snapshot establishes that the tracked cleanup attempts settled with no recorded cleanup bits. It does not establish every descendant stopped, successful capture, original bash exit0 or durable settlement.
- `runProcess` settles on original worker `close` (`src/subagent-process.ts:114-177,302-333`). The preserved exit1 is a real failed direct-worker outcome, not a timeout relabeled failure. The 1291ms test duration is inconsistent with the ordinary 5s recording-stall or 15s child-timeout path as the first trigger.

The test assertion stopped before its later request-count and empty-directory assertions. Their success cannot be inferred for the failed attempt. The supplied failure log does not retain the actual failing event, bash close facts, exact callback partition, queue metrics, or native stdin/EOF/capture receipt. Those facts remain unknown.

## 3. Actual path and relevant source facts

### Native fixture, not a durable-history test

`test/worker-capture.test.ts:185-318` uses a fabricated numeric-loopback OpenAI-completions fixture, `legacyWorkerEnvelope`, native `process.execPath`, the actual `src/sdk-worker.mjs`, and a strict preload.
The successful bash branch issues one fixed shell command: a fabricated canary followed by 4096 copies of a 19-byte ASCII line. Intended raw output is 77849 bytes; the redacted result is 77834 bytes. This exceeds the stock preview but is far below the 32MiB detail ceiling.
The second model request must contain **exactly one tool-role result with the entire expected redacted output**, not merely echoed command arguments. Then the model emits the final success text. Existing assertions also require worker completed/closed/exit0, empty stderr, two requests and an empty fixture working directory.

`test/helpers/worker-bash-guard.mjs:1-27` only exempts the exact fixed commands for `/bin/bash` or `/usr/bin/bash`, `-c`, matching cwd; it retains the ordinary SDK guard. `test/helpers/lightweight-sdk-guard.mjs` forbids discovery/state access, unrelated writes, subprocesses and non-loopback connections; observed violations force exit91. Do not broaden the guard to diagnose this case.

### Synchronous bash ingress and overlapping awaited projections

The source chain is:

```text
public local bash onData (synchronous)
  -> captureBash: raw lease, fatal UTF8, incremental redaction, retained result
  -> <=4096-code-unit update snapshot
  -> ToolIngress: pre-copy reservation, own-data sanitized copy
  -> public SDK update emission (individual promises, potentially overlapping)
  -> awaited SdkCapture.event -> toolResult -> canonical-JSON detail frames
  -> original stdout write callbacks; finally release the original update copy
```

Important anchors:

- `src/worker-tools.mjs:28-124`: raw `data.length * 12` reservation precedes decoding/copying; redacted accumulator growth is charged; every `onData` invokes an update snapshot; catch aborts/fails without spill. `onData` does not await capture.
- `src/worker-tools.mjs:127-201`: `ToolIngress` reserves available source capacity, measures with expansion, sanitizes a copy, and retains its lease until `release(event)`. Returned update promises are rejection-handled; handing a copy to the SDK does not refund it early.
- Installed public `BashOperations` declaration (`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.d.ts:20-40`) declares `onData: (data: Buffer) => void`. Implementation `bash.js:39-122` subscribes it directly to stdout/stderr `data`. Shell `printf` calls do **not** determine Node chunk boundaries.
- Installed `Agent.subscribe` declaration (`node_modules/@earendil-works/pi-agent-core/dist/agent.d.ts`) promises awaited listeners in subscription order. That is not global event serialization.
- Actual `agent-loop.js:298-331,452-486` calls `emit` separately for each synchronous tool update and stores each promise, awaiting them all after execution before tool end. `agent.js:372-420` awaits listeners inside each `processEvents` call without an inter-event chain. Thus sequential **tool execution** does not prevent concurrent update listeners for one tool.
- `src/worker-capture.mjs:393-456`: shared worker queue ceiling 4MiB/1024 slots; data lane reserves 1MiB/256 slots for control, leaving 3MiB/768 slots. Correctly retained unfinished writes/copies count against this domain.
- `src/worker-capture.mjs:472-535`: each emission temporarily reserves three 64KiB frames, validates synchronously, shrinks to encoded bytes, then retains that charge until the original write callback. A 5s reporting timeout does not refund the original write.
- `src/worker-capture.mjs:563-640,889-935,1118-1138`: **every canonical-JSON detail**, including a small tool update, reserves `4 * secretLiteralBytes + 65536 + 1048576` until the entire detail finishes. The detail emits several awaited frames. Multiple independent update details can therefore hold those large reservations concurrently.
- `src/worker-redaction.mjs:46-79,85-239,501-542`: structural measurement charges up to six bytes per source string byte, rejects unsupported shapes/accessors/cycles, and streaming sanitization has its own strict malformed/ambiguous-source refusals. All these failures currently collapse into the generic worker category.

## 4. Ranked hypotheses and the refusal/bug distinction

### H1 — overlapping canonical-JSON detail reservations (first discriminating target)

**Established source possibility, not a reproduced native cause.**
Even with no secrets, one update detail holds 1114112 bytes. Three simultaneous details would require 3342336 bytes, already above the 3145728-byte data allowance, before update copies, bash accumulation or temporary frame reservations. Two details plus other outstanding work can also leave insufficient capacity.

The fixture's synchronous, OS-partitioned output can produce overlapping callbacks while earlier projections await stdout. Total raw output below 77KiB therefore does not exclude this reservation failure. The recorded event35/protocol276759 counters do not establish or exclude three active projections.

This is closely related in *mechanism*, but not proven identical in occurrence, to the earlier W2 review's ordinary-partial-declaration over-reservation. Its preserved `w2-producer-review-checks/partial-budget-before.log` records `CaptureQueue.reserve -> SdkCapture.prefix -> openStream` capacity failure. That repair selected incremental partial lexical accounting. It did **not** remove the canonical-JSON surcharge from full tool-update/result details.

A reservation refusal is safety-correct under the current accounting. It may nevertheless expose an availability/mechanism defect if a small supported update needs far less retained state and the implementation unnecessarily prepays 1MiB repeatedly. Do not silently accept failed capture as the positive fixture's expected result, or remove charging to force green. Establish actual ownership/retention and needed expansion before changing reservation or serialization policy.

### H2 — genuine bounded ingress exhaustion/backpressure

**Also source-supported, unresolved.**
Every bash read generates a snapshot, often repeating nearly 4096 characters. Many small reads can amplify a modest raw result into many retained copies/frames. `measureData` charges those copies conservatively; raw ingress, accumulator, sanitizer prefixes and unresolved stdout writes share capacity. A truly fast producer with pending consumers may legitimately exhaust byte/slot capacity even without hitting the detail/protocol/event totals.

This differs from H1: count the actual copy/frame/accumulator leases versus the fixed canonical-detail surcharge. Correct charges reaching the declared ceiling are legitimate bounded refusal. Premature refunds, leaked leases after original settlement, an unexpected oversized reservation, or needless duplicate retention are mechanism bugs. A small final result or a later pass does not decide between them.

### H3 — capture/association/redaction or immediate output-I/O fault

**Possible through the generic category; weaker evidence.**
Own-data shape checks, occurrence matching, original frame/hash/offset validation, lexical projection, write callback errors and lease release can all reach the same classification. The exact fixture has one safe named tool call and ASCII source, so intended invalid UTF8, ambiguous source IDs, huge heuristic prefixes and malformed tool-result JSON are not affirmative explanations of `tool=true`.
A chunk-sensitive sanitizer or concurrent projection bug is still possible; no fixed branch facts were preserved to disprove it. Installed SDK source awaits all update promises before tool end, so ordinary end-before-update sequencing is not an established explanation either.

### Unsupported explanations

Do not attribute this record to provider auth failure, quota/ENOSPC, the unrelated export shim, W3 key reads,15s timeout,5s stall, private SDK incompatibility, “flakiness” as a cause, or a confirmed UTF8 refusal. No supplied evidence supports those diagnoses. The intentional `invalid-utf8` case is separate; its successful refusal test does not explain the positive branch's failure.

## 5. Smallest discriminating follow-up for a serial W2 editor

This is a proposal only; **nothing below was executed**.

### A. Preserve the unchanged native positive; add bounded fixture observation

Start with the existing native fixture and guards, same command/expected complete result, same public SDK/adapter, same 20s/15s budgets, same limits and original process settlement. Do not slow the original positive, reduce its output, loosen assertions or rerun until green as a substitute for diagnosis.

Prefer one fixture-only observer/receipt over a public diagnostic/protocol redesign. A guarded test preload can observe exported Cadence classes; any needed closure-level observation is a small explicitly reviewed W2 seam. Do not monkey-patch private SDK internals or replace public bash execution. Keep the production stdout schema, empty-success-stderr rule, existing fixed failure snapshots and their bounds intact.

Retain only bounded primitive facts, first-fault-only plus final/high-water aggregates:

1. **Code-owned first failing operation**, e.g. queue reserve/grow, ingress measure/sanitize/dispatch/release, bash decode/sanitize/append, capture detail-prefix/frame/association, or stdout callback/error. Where classification remains generic, record `unknown`, not exception-derived guesses.
2. At a failed reservation: requested bytes/lane, queue bytes/dataBytes/frames/dataFrames, active canonical-detail count, ingress bytes/frames, pending write count/bytes. Separate retained-copy charges from fixed detail-prefix charges. Use saturating counters, not unbounded event logs.
3. For bash: total bytes, callback count, maximum callback size, retained redacted byte count, abort requested and actual operations settlement/exit disposition. For projections: allowlisted event kind, entered/settled update counts and maximum simultaneous update projections. No raw tool/source IDs are needed.
4. Preserve the native parent result plus `runProcess.onNative`'s existing stdin/final/close facts; count fixture HTTP requests without bodies/headers. Record evidence-write failure separately without overwriting the original test failure. Assert only available EOF facts; do not invent them from cleanup/close.

No payload, command/prompt, provider error, stack, header, environment, credential, source identifier, raw stream or secret-derived hash logging. No inspecting opaque error getters/`message`/`code` to invent a reason; tag known internal throw sites or use fixed unavailable classification. The observer must remain nonthrowing, bounded and must not await the run from inside its listener, refund a lease, insert pacing or swallow the original rejection. Capture at the failing operation, not only afterward: concurrent callbacks can advance counters before a later diagnostic snapshot.

### B. One deterministic overlap control, then its serialized comparison

Use the existing exported `CaptureEmitter`, `CaptureQueue`, `SdkCapture` and `ToolIngress`, with a valid begun single tool occurrence and tiny fabricated own-data updates. Hold the first original output callback with a controlled `Writable` gate, admit up to three updates without awaiting their individual captures, and observe the actual queue/prefix reservations. This is a **labelled injected callback/Writable control**, not native provider evidence.

- Three overlapping canonical detail reservations should expose the arithmetic in H1 without a large source, a 5s wait or heap/RSS inference.
- Compare identical updates released/awaited one at a time. Require complete valid associations, all original leases released and exact retained content on the positive control.
- Release all original gated writes promptly and await original promises/cleanup within existing applicable bounds. Failure-control capacity and first-fault retention must remain intact; late releases must not retroactively change failure into completion.
- Use the SDK's public `Agent` subscription behavior in a separate small capability control if needed; do not simulate it as a serial callback chain and then claim actual overlap tested.

This isolates H1 with very few events. A native receipt identifying the same reservation/overlap is still required to connect it to a newly observed native failure; deterministic reproduction alone cannot retroactively prove the original event35 cause.

### C. Keep one genuine-exhaustion and one malformed-input control

Reuse the existing ingress pending/throw/reject, accumulator exhaustion and invalid-UTF8 negatives (`test/worker-capture.test.ts`) rather than building a new scheduler. If H1 is confirmed and repaired, rerun them to ensure true capacity exhaustion still aborts, original unresolved copies remain charged, no raw spill/retry appears, and malformed input never becomes successful replacement text.

Only if A/B do not discriminate, add controlled chunk partitions over the **same fabricated ASCII bytes** using injected public bash operations: one/small/mixed reads, serial release versus bounded overlapping delivery. Assert exact sanitized final result and no uncharged accumulation. Such partitions test projection mechanics, not native pipe scheduling. Preserve the unmodified real shell positive as the native lane.

## 6. Integration tracking and exact unknowns

Main should keep this item open alongside W3, owned for diagnosis/repair by W2 before final integrated capture acceptance. A useful closure requires a preserved first failing branch/accounting receipt, a causally discriminating control, any justified repair within existing contracts, and fresh native positive plus refusal regressions on frozen inputs. A safety-correct overload determination must show the actually reached ceiling and explain why the intended positive encountered it; it is not permission to downgrade that positive or silently cut the complete-capture requirement.

Still unknown from the original record:

- which shared failure callback/catch first fired, including whether its reason was capacity, shape/association, redaction, write error or release;
- actual callback sizes/count/overlap, active detail reservations, queue high-water values and outstanding original writes/copies;
- the bash process's original exit/abort facts and how much source output was captured when the first fault occurred;
- exact failing event/detail and whether its invariant was valid or violated;
- original request count, final guarded-directory assertion and detailed native input/EOF facts not printed by the failed assertion;
- a causal change between the failed and passing bash attempts. No such repair is reported or established.

Do not erase or relabel the failed broad run, count overlapping reruns as new independent capabilities, or call all W2 capture repaired merely because the final 1215-case command passed. If the original cause remains unrecoverable, retain that precise limitation even after a separately demonstrated defect is repaired.

## 7. Inspected source identities and API references

Read-only current hashes below equal the historical W2 `review-evidence.json` entries:

```text
src/sdk-worker.mjs
  55016e65b7b10bbf3d360ae4828fb47395972fcc062afba3018c6a2250512544
src/subagent-process.ts
  654a689c887b156be053eaf16b603b6c77eb2c17e5a7fd4058c9680508ff09d4
src/worker-capture.mjs
  c17f722b4d403bb5566b0a98f4e7ca4f13aa6a568431144997b646aee7f09d42
src/worker-tools.mjs
  26855dc5a61f746fcf53b90c797a23c093ca9ad9bd94d655441e82ce65300267
src/worker-redaction.mjs
  6f00413bb8805e7f1493505f3c51b812d3d7c0272e828c39c3c8b77fc58d12f2
test/worker-capture.test.ts
  b6a417499dcd30f785dfba97fddfce1fb17fa34bbdce52b6772a8039326e1189
test/helpers/worker-bash-guard.mjs
  58c1fb204e27d6a81acec727f7a909f46457cdf6e638d0e580b7c0543244013b
```

Installed peer implementation hashes inspected without executing it:

```text
node_modules/@earendil-works/pi-agent-core/dist/agent.js
  d84351e451b9fef40fe2532c446aca90d26a4be9038b2d77d3d45dd6eab21d41
node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js
  43cc779ddaf90df41768d3d2d0f7d7ba8b8bce7bedc9dc6062ca8b4de84ae880
node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js
  3050cbe9c5a7fb8ebeff4c5a85233a27e5ebe5a06b2f52db30df0202d021a519
```

Public declarations were checked beside those implementations. Source inspection of installed internals is not a recommendation to import private APIs.
Also read the complete local official `docs/sdk.md`, `docs/message-types.md` and `examples/sdk/05-tools.ts` under `/home/mirako/.bun/install/global/node_modules/@earendil-works/pi-coding-agent/`; these explain public subscription/message/tool distinctions but do not override the installed peer declarations or prove native behavior.
Relevant maintained guides read: `.trellis/spec/backend/{index,lightweight-workflow-guidelines,logging-guidelines,quality-guidelines}.md`, `.trellis/spec/guides/{index,cross-layer-thinking-guide}.md` and `.trellis/workflow.md`. Historical tiny-transcript details are superseded by the approved parent v2 capture contract, not reinstated as diagnosis fixes.

**Verification of this artifact:** source/evidence review and log-hash comparison only. No tests, lint or native diagnostic controls were run in this readonly delegation.
