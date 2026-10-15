# G6 user-reported xhigh update — independent re-scope review

## Decision

**BLOCK: the exact approved program cannot admit a new sibling root.**
No new normal metadata observation is approved or executed.
This finding concerns root admission, not whether the updated normal configuration advertises xhigh.
The user's “现在提供xhigh了” is a fresh causal reason to consider one new metadata observation; it is not itself observed capability evidence.
G6 remains **OPEN/BLOCKED at6/8**.

The explicitly delegated existing task was used despite its intentionally absent session pointer.
Task metadata/pointer, source, package, installed peers, archive, CI, index, old roots, gates, markers and old reports were not changed.
No normal SDK import, runtime construction, model/auth query, prompt, native CODE Start, HTTP request, live configuration/credential/session read, actual ambient-proxy read or subagent occurred.
No fallback, profile rewrite, canonicalizer change, forced flag or guard removal was made.

## Blocking finding: actual admission contradicts the proposed relocation

The entire16851-byte `diag-program.mjs` was read, including its main and CLI entry.
Although line8 derives ROOT from the module URL, line10 still binds ORIGINAL_ROOT to the old consumed diagnostic directory.
Line109 requires:

```js
requireTrue(ROOT === ORIGINAL_ROOT && fs.realpathSync(ROOT) === ROOT && s.isDirectory() && s.uid === process.getuid() && (s.mode & 0o777) === 0o700);
```

Therefore dynamic module-relative ROOT does **not** mean relocation is admitted.
In the new sibling, ROOT differs from ORIGINAL_ROOT.
The first conjunct refuses before `auditInputs()`, either approval-file read, the exclusive once-marker write, `pureProducer()`, startup selection or SDK imports.
New root-bound B objects cannot cure that independent equality check.
Under the unchanged main publication flow, this path is admission/none, before-imports, refused, bridgePreauthAccepted=false and native exit1—not a new model observation.
This is a static/control prediction, not an executed real CLI result.

Two fabricated-memory controls evaluated the actual admit function, with only its module-URL expression lexically substituted for VM parsing.
The equality guard was retained verbatim; no real filesystem gate or marker operation was available to the controls.

- The new-sibling case refused with input-audit calls0, approval reads0 and marker writes0.
- A fabricated original-root boundary reached its deliberately throwing input-audit stub once, confirming the sibling refusal was the root check rather than an unconditional broken fixture.

The previous [final PASS](./g6-F-preauth-diagnostic-final-review.md) explicitly approved the literal old root and original-root custody.
It does not approve this new literal root.
The [once protocol](./g6-F-preauth-diagnostic-correction-handoff.md) and [observed result](./g6-F-preauth-observed-result.md) remain history, not reusable approval or reset authority.
An owner-level, separately reviewed root-admission change would be required to support relocation; changing code or removing the guard is outside this same-program-hash delegation.
Do not execute the known-refusing candidate, reuse the consumed root, create another root as a fallback or manufacture PASS objects.

## Prepared, unapproved candidate and exact binding

One new owned0700 sibling was created, solely for the explicitly requested preparation:

```text
/home/mirako/.local/state/cadence-release-qualification/744e5f0de9223044/qualification-7db986a-c8cef218/repair-final-bk0d8kjm/commit-push-audit/ci-round2-authenticated-cb9a5079/g6-xhigh-user-update-xvrm9xl0
```

`diag-program.mjs` and `inputs.json` were copied exclusively from the known old diagnostic root, retaining their exact bytes as owned regular single-link0600 files.
The only additional private file is bounded0600 `review-facts.json`, recording safe custody, controlled verification and this BLOCK.
The actual public report hash is bound there without a circular self-hash.
No original program, protocol, correction handoff or evidence was rewritten.

Exact candidate B, **not an approval**:

```json
{
  "root": "/home/mirako/.local/state/cadence-release-qualification/744e5f0de9223044/qualification-7db986a-c8cef218/repair-final-bk0d8kjm/commit-push-audit/ci-round2-authenticated-cb9a5079/g6-xhigh-user-update-xvrm9xl0",
  "programSHA256": "1005c54b586ac271de7595f295fa17f5363ae998503872d849d37828dae86d62",
  "handoffSHA256": "1d4a19cd9b34308cedc12a3826994a15ecd5abbdde395e921637736445b4ccb1",
  "inputsSHA256": "d252049aecea38aa88c5ce8cf48325a5faa9455461f8aec9daf536f118c962b5",
  "sourceRevision": "f64fb93fcccf7f54fd23647efe8508f4c0b66c20",
  "codeFingerprint": "d32ff1ec49d7783d8b595fe54bcd538a46d3025610a5356674d8724fa9ba4e12"
}
```

The handoff hash remains that of the actual original correction handoff hardcoded by the program, not this report.
The parent must not rebind that field to this report.

Neither `independent-review.json` nor `parent-review-gate.json` exists in the candidate.
Neither `diagnostic-once.json` nor `diagnostic-outcome.json` exists there.
Approved command, actual independent-review-file hash and parent-gate-file hash are **NONE** because review is BLOCK.
The existing schemas require `g6-f-preauth-independent-review/1` with outcome PASS, metadataOnly=true and normalOnceApproved=true, and `g6-f-preauth-parent-gate/1` with the actual independent-review bytes' hash and command `preauth-once-after-review`.
Those assertions cannot truthfully be supplied by this review; no executable approval objects or placeholder hashes are emitted.
Even exact objects would still fail the prior root guard.

## Fresh finite custody and verification

An independent Python reader matched all523 original sealed identities against live regular-file metadata and bytes, including eight absences, with exact original peer-target exceptions.
The unchanged program's exported `functionForTests({auditOnly:true})` also returned frozenIdentities523 from the copied input manifest.
That path imports only this builtin-only diagnostic module, does not call diagnose or the source factory, and does not import an SDK or query a model.
No normal profile tree was scanned.

The finite audit also checked:

- All222 repository path/mode/body rows and the unchanged source fingerprint.
- All34 installed F bodies, including16 source bodies and three Agents, plus six peer-capsule bindings and26 exact peer targets.
- The original uid0 single-link `/usr/bin/node` body; no executable substitution.
- All125 pre-existing old-diagnostic files' stat identities before/after, with byte/identity checks for the program, inputs, protocol, both approval files, provenance, once marker, outcome and referenced public reports.
- The original F marker/outcome, qualified F publication, source/archive/stock-worker bindings, old gates and absent old-R source-revision file through the sealed523-file set.

The consumed old diagnostic marker remains SHA256 `14c19ab0cc908d9250d6a8332c97c6686a5d873cdbc1693755bfcaae6720a6e3`.
Its retained outcome remains SHA256 `7e86cef675561a6fd72707eb69f7de38b7c8e290556617531984dda823ce9442`.
That earlier natural exit1/706-byte/stderr0 refusal, including xhigh=false and canonicalAccepted=false, remains unchanged—not replaced by the user's new claim.
The original F getAuth status and precise first source cause remain UNKNOWN.

Fresh original native waits:

- Program syntax: PID463681, exit0, stdout0/stderr0, both EOF, null signal, no force.
- Two fabricated gate controls plus the real readonly preservation helper: PID463688, exit0, stdout526/stderr0, both EOF, null signal, no force.

The first memory-control invocation failed before its tests because its VM wrapper had an un-substituted `import.meta.url` expression.
Its native exit1/stdout0/stderr968 is retained as a failed fixture invocation, not reclassified as PASS; its PID was not retained.
The corrected memory wrapper reproduced that syntax cause, then substituted only the module-URL expression and ran the controls above.
No frozen program was changed and no normal source was involved.
Prior reports'28/20/14/10 control results remain historical; those suites were not rerun or added to new totals.

Scoped nonwriting Markdown validation and final custody are recorded in the private facts.
No TypeScript/product source changed, so whole lint/typecheck/tests, CI, pack and qualification workloads were deliberately not run.
Readonly Git inspection found no tracked diff; unrelated untracked material was left alone.

## Metadata-only boundary remains unchanged

If separately admitted in future, the observation must retain the exact normal public source factory, fixed selector, one public getModel query, zero explicit own-code auth calls, unchanged canonicalizer, startup route policy and30-second budget.
The constructor still uses ordinary configuration/default credential storage with an in-memory model store and disabled model refresh; it is not credential-free or certified zero-network.
Incidental constructor auth/network/billing remain UNKNOWN.
No route value, configuration/model/auth object, unknown metadata key, error property or value hash belongs in persisted output.

The one-frame32-key/1024-byte maximum, Boolean/null flags, fixed enums, stderr0 and original-wait checks remain mandatory.
A validated negative metadata frame with natural exit1 is useful negative evidence, not accepted bridge pre-auth; an accepted frame cannot override a failed/forced/unknown wait.
Public xhigh advertisement must come from the actual imported public thinking-level helper, not manual flagging or an inference about universal upstream model capacity.
Even xhigh=true would not establish canonical acceptance: the earlier defined type/inputLimits and unsupported compatibility predicates may still refuse.
No updated metadata was observed here.

Only this public report and the three new private candidate files were written.
No gates or once markers were minted, and no normal SDK/public-model-source call was made.
Physical-human remains SUPERSEDED, not passed; G6 remains6/8.
