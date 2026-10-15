# G6 F pre-auth diagnostic — independent review

## Decision

**BLOCK.**
Do not publish either approval gate or execute the once command.
One diagnostic correctness finding remains in the frozen real-entry control flow.
No normal SDK import, runtime construction, model observation, auth resolution, native Start or provider request was performed by this review.
No frozen program, old gate, consumed marker, source, installation, package, map, index or task pointer was changed.

Reviewed program SHA256:

```text
c0ec55318ad76d99307faafb34fe2769335fb7f8f3bb58271d8204bbaa81a5c3
```

The existing task was explicitly delegated despite its intentionally absent session pointer.
The complete [handoff](./g6-F-preauth-diagnostic-handoff.md), [triage/proposal](./g6-current-F-first-real-triage.md), task artifacts and curated check context were read.
The complete 222-line diagnostic, private once protocol, retained controls and original 3314-line producer were reviewed, including sourceEnvelope and its guarded entry.
Installed public global SDK declarations, runtime/composer/thinking implementations, relevant SDK documentation and examples were inspected statically, not executed.

## Finding F1 — real entry discards the failure milestone

**Blocking; `D/diag-program.mjs:214–217`, after `diagnose()` returns.**
The helper correctly catches opaque exceptions and retains the failed `lastAttempted` and preceding `lastCompleted` phases.
However, main unconditionally changes both fields to `preservation` while running the readonly post-observation audit, even when the helper already returned `result: refused`.
The eventual real stdout frame therefore loses the exception milestone that this diagnostic was built to preserve.

Two independently reproduced, explicitly fabricated cases:

- SDK-import exception: helper phases `sdk-import` / `startup` become `preservation` / `preservation`.
- Public model-getter exception: helper phases `model` / `runtime` become `preservation` / `preservation`.

This does not create a false success: refusal/nonzero and boundary flags remain intact.
It does violate the required last-attempted/last-completed exception projection and unnecessarily obscures the failure interval.
The retained 28 controls call `functionForTests()`, which returns directly from the helper and never traverses this final CLI publication path; they do not cover the defect.

**Required correction:** preserve the diagnostic's failure phases when a subsequent preservation audit succeeds; a failing preservation audit must still veto acceptance and identify that failure honestly.
Add a labelled in-memory control of the actual main publication sequence with injected dependencies, including import, constructor and model-getter exceptions.
Do not inspect exception properties, change model semantics, widen the output schema or run normal observation to test the correction.
The owner must produce newly bound program/protocol evidence and obtain fresh independent review before parent approval.
No frozen implementation was patched by this review.

## Other reviewed boundaries

No additional blocking issue was found in these bounded static checks:

- Default import has only Node builtin imports and inert definitions; it neither loads the SDK nor reads custody files, constructs a runtime, queries a model or writes a gate/marker.
  Fresh import-only original wait returned exit0, stdout0/stderr0; this is not normal-mode evidence.
- The normal source factory body is byte-identical to the original producer and targets the same public global1.2 entrypoints, not the installed editing SDK0.84.3.
  It retains normal configuration/default credential storage, with in-memory model storage and both initial network-refresh options disabled.
  This is not credential-free or certified zero-network construction.
- Exactly one explicit fixed-selector public model lookup is reachable after successful construction.
  Boolean error/native/custom-stream observations continue into available shape checks; missing model stops after the Boolean error query.
  No request-auth call, availability/catalog query, prompt, tool, session, provider transport or native launcher is introduced by the diagnostic.
- The four unsupported semantic-presence flags remain booleans; own optional undefined values are omitted by the unchanged canonicalizer, while defined unsupported semantics refuse.
  Supported sampling is retained.
  Unknown names/values and opaque exception properties are not projected.
  A nonempty model-type semantic is recorded as present and refused, not silently dropped.
- Fixed stdout validation admits only the declared keys/types/enums and caps one ASCII JSONL frame at1024 UTF-8 bytes.
  Refusal is nonzero; success additionally requires all bridge predicates and preservation.
  No process-wide exception suppression or raw finally-cleanup path was added.
- The shared30-second timer stays referenced while imports/construction/metadata are pending and is unref'ed only after publication.
  Remaining handles may still cause deadline exit1 without a second frame.
  A missing frame, including any handle-less unresolved/unhandled termination, cannot pass the mandatory parent frame-plus-original-wait checks.
- Admission requires the original owned0700 diagnostic root, exact independent/parent gates and exclusive0600 once publication before construction.
  All synchronous gate/marker file operations close before the constructor; there is no auth descriptor or absence-only self-approval.
  The marker is not frozen absent in inputs and must remain consumed after any future outcome.
- Startup uses the original RAM-only equal-pair/opt-in policy before SDK imports and rechecks freshness.
  No route discovery, value dump, secret argv, dispatcher substitution, normal-profile alteration or source/model bridge repair was attempted.

## Custody and verification

Private diagnostic root D:

```text
/home/mirako/.local/state/cadence-release-qualification/744e5f0de9223044/qualification-7db986a-c8cef218/repair-final-bk0d8kjm/commit-push-audit/ci-round2-authenticated-cb9a5079/g6-F-preauth-diagnostic-7uir0wrd
```

New private review evidence leaf, owned0700 with newly written regular single-link0600 files:

```text
/home/mirako/.local/state/cadence-release-qualification/744e5f0de9223044/qualification-7db986a-c8cef218/repair-final-bk0d8kjm/commit-push-audit/ci-round2-authenticated-cb9a5079/g6-F-preauth-diagnostic-review-_j4wfd1t
```

`review-evidence.json` binds this report, the reviewed program and the new original waits.
Independent before/after audits matched all523 sealed identities, including eight absences,222 source rows/bodies/modes,34 installed bodies, six peer capsules and26 attached peer bodies.
Peer ancestor-link and nlink2 exceptions remained restricted to the exact frozen targets; the original root-owned Node body remained pinned separately.
The five declared direct peers, including Undici8.9, and the sixth transitive peer remain unchanged metadata, not normal-source compatibility evidence.
Original eleven gates, native proof38669341877, archivead912e45, source revisionf64, stock worker099261e6 and indexd1463b92 remain preserved.
The original consumed marker1e1f1b47 and outcome b75cd9ca were independently rehashed unchanged.

Executed fresh, each original wait returned exit0/null signal, both EOF, no force and stderr0:

- Diagnostic and new memory-control syntax checks.
- Default import only, stdout0.
- Seven labelled memory controls,7 passed/0 failed, reproducing one finding through exact main-function extraction with fabricated admission/runtime/audit/process/timer dependencies.
  Opaque exception-property reads0; no normal source constructor or lookup occurred.
- Scoped nonwriting Biome check of the frozen diagnostic, no warnings.

The retained28/0 controls and their original wait were read and verified, not rerun or added to the new seven-case count.
Scoped Markdown validation is recorded separately in the private evidence.
No package TypeScript target changed; whole typecheck, product suites, native/CI/install lanes and normal diagnostic mode were not rerun.
Tracked and staged diffs were empty at review; unrelated existing untracked material was left alone.

## Required parent schemas — withheld, not approved

For any subsequently corrected and independently approved program, the existing protocol requires binding object B with exactly:

```text
root programSHA256 handoffSHA256 inputsSHA256 sourceRevision codeFingerprint
```

`root` is literal D; hashes must bind actual reviewed program and handoff bytes.
Current sealed inputs SHA256 is `d252049aecea38aa88c5ce8cf48325a5faa9455461f8aec9daf536f118c962b5`.
Source revision is `f64fb93fcccf7f54fd23647efe8508f4c0b66c20`; fingerprint is `d32ff1ec49d7783d8b595fe54bcd538a46d3025610a5356674d8724fa9ba4e12`.
Inputs transitively bind the original native/F proofs, archive and finite custody set.

Exact independent-review object: B plus `schema: g6-f-preauth-independent-review/1`, `outcome: PASS`, `metadataOnly: true`, `normalOnceApproved: true`.
Exact parent-gate object: B plus `schema: g6-f-preauth-parent-gate/1`, `independentReviewSHA256` of the actual exclusively published review JSON bytes, and `command: preauth-once-after-review`.
No extra keys are admitted; both files must be owned regular single-link0600 and exclusively created by the parent.
**This BLOCK does not authorize either PASS object for the current program.**

Prospective command, **UNEXECUTED AND BLOCKED**:

```sh
/usr/bin/node "$D/diag-program.mjs" preauth-once-after-review
```

The child protocol remains `schema: g6-f-preauth/1`; its exact key set is:

```text
schema lastAttempted lastCompleted passedStage result
startup sdkImport aiImport runtime modelPresent errorPresent nativeProvider
customStream selector limits reasoning xhigh knownFields typePresent
inputLimitsPresent promptCachePresent samplingByThinkingPresent samplingPresent
compatSupported thinkingMapSupported costSupported headersSupported basicFields
canonicalAccepted freshRoute bridgePreauthAccepted explicitGetAuthCalls
```

The25 predicate flags are boolean/null; `bridgePreauthAccepted` is boolean and `explicitGetAuthCalls` is numeric0 for own code only.
Phase enums are `none`, `admission`, `startup`, `sdk-import`, `ai-import`, `runtime`, `model`, `error`, `native`, `config`, `predicates`, `canonical`, `freshness`, `preservation`, `complete`.
Stage enums are `before-imports`, `sdk-imported`, `ai-imported`, `runtime-created`.
Result enums are `not-run`, `refused`, `source-observed-not-product-pass`.
One plain ASCII JSON object plus LF must fit1024 UTF-8 bytes; code0 requires accepted predicates, exact validated frame, stderr0 and original unforced exit0/null signal with both EOF.
Refusal/deadline is code1; any other exit, missing/extra/invalid frame, stderr, forced/unknown wait or exceeded bound invalidates observation.
The parent must buffer anonymous pipes, apply caller-known RAM-only route redaction, discard rejected bytes without persistence/hash and retain only safe original wait facts.
Neither exit0 nor a successful metadata observation qualifies native CODE or inference.

## Remaining disposition

Four future diagnostic approval/once/outcome files remain absent.
Original producer450391's precise source-envelope cause, actual auth-call count and billing remain UNKNOWN; zero downstream native Starts is not a zero-network claim.
Native CI and installed F history remain valid bounded evidence, not normal-profile compatibility.
G6 remains OPEN/BLOCKED at6/8; no paid retry, replacement root, model bridge fix, TUI/observer change or physical-human PASS is authorized.
Only this new public review and the fresh private evidence leaf were written.
