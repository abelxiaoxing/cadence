# W3 progress repair — stopped at a concrete format decision

## Disposition

**No functional repair is claimed.
W3 remains blocked.**
I stopped at the delegation's explicit format/ownership decision gate, rather than adding an accepting shortcut or silently changing private/shared schemas.
The new counterexample establishes a legal predecessor for which even a predecessor-only raw proof cannot fit one request.
The existing1194-case result remains prior evidence, not successful recovered-history acceptance.
The named LIMITATION test is unchanged; replacing its assertion with success without a repair would be dishonest.

Only a new excluded helper and this new report/evidence set were authored.
No production history, W1/W2/shared contract, package, lockfile, maintained spec, task status, prior report, Git index/ref or consumer-store bytes were changed.
No agents, credential reads, provider calls, installs, deployment or cleanup were used.

## Discriminating counterexample

New helper: `test/helpers/history-progress-probe.ts`.
It is an ordinary Node executable built locally with packages external, not a shipped worker, mock history reader or extra passing suite case.
The producer uses actual `HistoryFiles.append`, native file writes and the original flush path to retain469 Create-shaped structural records.
These are not actual accepted task creations or SDK work.
It appends a bounded48747-byte final incomplete JSON line and exits with the original waited code77/null signal.
The parent observes the dead owner and performs the real `HistoryRecovery.append`; interactive authority and independent operator acknowledgments are explicitly fabricated fixture inputs.

Fresh final receipt:

| Fact                                  |                                              Observation |
| ------------------------------------- | -------------------------------------------------------: |
| Original predecessor segment          |                   8388608 bytes, exactly the allowed8MiB |
| Actual committed offset               |                                                  8339861 |
| Actual highest complete row           |                                                      469 |
| New committed bridge segment          |                                                785 bytes |
| Original predecessor plus bridge      |                                            8389393 bytes |
| Unchanged per-read allowance          |                                     8388608 bytes /100ms |
| Full administrative scanner           |                    Accepts the preserved tail and bridge |
| Separate cold Node search processes   |         12 calls; advancing zero-hit pages, then refusal |
| Required complete search              |                           **Not completed; probe exit1** |
| Untrusted cursor claim recomputed     | Accepted by cursor decoding, refused by the actual proof |
| Original history tree after all reads |                         Exact path/body hashes unchanged |

The actual `validateRecovery` budget observations are221 bytes for the selected format, then an8388608-byte reservation which refuses.
That is independent of decoder throughput, disk latency or the archive-before-predecessor cost.
Even eliminating the current byte-zero archive rescan leaves the full legal predecessor plus required original metadata outside a single8MiB window.
The torn line is smaller than the normal record bound; there is no interior damage or over-limit segment used to manufacture this failure.
`files.inspect()` accepts the exact original history before public reading.

The helper's completion predicate requires a finished page and the exact single retained target hit, owner, range and content digest; an empty result cannot turn this probe green.
All original children are waited with unchanged15s limits, no force-stop success or rewritten output.
The final probe's actual native/read receipts are in [the evidence directory](w3-progress-repair-checks/evidence.json).

## Why the existing representations do not supply the missing proof

### Trusted source versus untrusted navigation

- The original private ledger/artifact files are the retained source, selected with the existing ownership/link/descriptor checks.
  Their actual committed markers, sequence relationships, bridge placement and preserved predecessor bytes still have to be checked.
- `HistoryFormat` contains only schema, store/workspace UUIDs and root identity.
  None is a secret validation key.
- `RecoveryBridge.previous` contains segment, size, one whole-segment SHA-256, committed offset/sequence and high sequence.
  It has no independently addressable block proofs or authenticated intermediate validation states.
- `CommitMarker.navigationRoot` anchors the derived index tree.
  Indexes remain accelerators and may all be missing; neither their presence nor a mutable head file is required authority.
- `ScanPoint` contains source position, row/event/byte and snapshot position only.
  `scanCursor` hashes public cursor fields with unkeyed SHA-256 and truncates that binding.
  Anyone holding a cursor can recompute it for a different source/snapshot position; the new helper does so through the actual codec.
  Current production correctly refuses that claim when it cannot independently validate the bridge.

A source position is enough to resume *navigation*.
It is not evidence that a cold process previously checked an original prefix.
Passing the cursor's claimed previous sequence, committed offset, rolling hash or a `validated=true` equivalent into `validateRecovery` would therefore weaken the forged-highSeq/recomputed-checksum boundary.
Private record UUIDs, `historyDigest`, file hashes, access tokens and per-boot capabilities must not be silently repurposed as durable secret keys.

### Counterexample to the three current-format shortcuts

1. **Restart the predecessor proof, but not the whole archive.**
   The actual maximum-segment fixture above already exceeds one allowance with original metadata.
   Optimizing parsing or skipping older segments cannot change that byte lower bound.
2. **Carry a hash state or previous-boundary facts in the existing cursor.**
   The public checksum does not authenticate those facts.
   A caller can substitute a state computed from old/other prefix bytes, skip an altered prefix and recompute the binding.
   Comparing the resulting whole hash is not a check of the skipped current original bytes.
   Also, the currently available navigation payload is at most a UUID-v4's122 free bits, two safe integers'106 bits and a small field enum (less than256 bits total).
   A general SHA-256 continuation state alone requires256 bits, before position, pending block/count, two traversal positions and any authentication tag.
   A digest of that state cannot reconstruct it; a reference to it would need a retained source for that state.
3. **Keep the proof in a RAM map or write a cursor/index checkpoint during reads.**
   The former does not survive the required cold restart; the latter violates passive noncreation/no on-read writes.
   The existing optional indexes provide neither a durable keyed cursor registry nor independently verifiable block proofs when absent.

This is a counterexample to preserving *these formats and the exact full-original proof requirement simultaneously*, not a claim that the feature is impossible or that its limits should increase.
New writer-produced proof data could change the problem, but that is a private format/authority decision, not merely reusing the current opaque navigation fields.

## Minimal concrete decision proposal for main

The smallest direct route preserving the current whole-byte proof semantics is a bounded **authenticated read-progress envelope**, not a new execution/authentication/session mechanism:

1. Add one optional portable `ReadCursor.navigation` string, max8192 UTF-8 bytes, reserved for opaque server-issued progress.
   It is null/absent on seeds and ordinary exact-hit detail cursors.
   Existing store/scope/query/snapshot and entity fields retain their meanings.
   W1 owns the public codec/declaration/facade/client correlation change; W3 owns its private interpretation.
2. Add one history-private, exclusively created0600 `read-proof-key.json` with a versioned closed schema, storeId and32 random bytes, created only at explicit initialization or a separately approved informed recovery setup.
   It is not a browser/provider credential, never exported and never used for admission/launch/receipt authorization.
   No generation on GET, no reset, no use of per-boot/access material, no silent adoption of a missing/corrupt key.
   Existing archives and old cursors retain their current validation path; extending old archives requires explicit setup, not on-read migration.
3. Authenticate a finite versioned envelope containing:
   - full read identity and original snapshot address;
   - output source position/row/event/byte;
   - proof phase and original segment/offset/sequence/highSeq/committed offset facts;
   - serializable SHA-256 chaining state, byte count and at most one partial hash block;
   - selected original file-incarnation observations, checked before resumption; changed input invalidates progress rather than rebasing it;
   - independently progressing end/overlap lookahead position, exact target occurrence/content linkage and at most1023 overlap bytes.
   Domain-separate the MAC for read progress.
   Verify it before interpreting state.
   The key or MAC never replaces actual raw-byte/marker/artifact validation; it only attests earlier validation work and prevents caller-invented proof progress.
4. Resume only at explicit validated parser boundaries, reserve every actual read under the existing allowance, and require the completed original predecessor SHA/size/highSeq/committed offset plus actual next-segment bridge placement.
   Repeated recoveries advance one forward validator; do not recursively start a new byte-zero proof.
   Source-change detection remains bounded supported-writer hygiene, not hostile same-user CAS or immutable-filesystem guarantees.

This is a **field/ownership proposal, not implemented or qualified code**.
The8192-byte cap is a proposed envelope ceiling, not permission to increase the8MiB/100ms IO limit or any native20s/15s budget.
Its concrete decoder/state machine, checkpoint-boundary feasibility and cross-window original-file checks need independent review before implementation acceptance.
In particular, arbitrary pending batch/artifact lists must not be squeezed into a truncated token or copied without bounds.

If main rejects a new portable field/key, the alternative decision must explicitly introduce **writer-produced immutable bounded proof nodes and a committed root reference** in the private history format.
That alternative must specify original-prefix corruption semantics, missing-proof behavior and exact recovery-production ordering; calling the nodes removable indexes would not solve the no-index requirement.
I did not silently add either format or treat such a proposal as approved implementation.

## Long-field root cause and required continuation state

`RetainedScan.hasEnd` starts at the begin's batch; `ending` starts at the chunk's batch; `overlap` starts at that same batch and retains its pieces/expected next offset only in locals.
Each new `RetainedScan` loses its `ends` map and all three traversals' positions.
When any of them exceeds a window before returning, the outer source item remains unconsumed and the next request repeats the same work.
Advancing the outer item to hide this stall would skip content or manufacture absent-end coverage.

The proposed envelope separates output progress from lookahead progress.
An end result must still be read from its real committed end batch and checked against the exact origin/detail/content owner; no cached/provided ContentRef is authority.
Overlap must retain exact expected UTF-8 byte position and only the same field's bounded suffix.
Reaching the snapshot without an end remains incomplete/gap, never a fabricated final reference.
Search hit owners/ranges, export original end/hash accounting and missing-trailer semantics stay unchanged.

No long-field repair, repeated-recovery success, complete NDJSON/Markdown export or digest success is claimed here.
Those remain required positive gates after main selects the proof representation.
The maximum-segment counterexample was sufficient to reach the requested STOP condition; I did not implement a half-fix or modify tests to call refusal completion.

## Verification and preservation

All commands used explicit `TMPDIR`, `TEMP` and `TMP` under the newly allocated0700 ext4 directory `/home/mirako/abel/.cadence-w3-progress-31360LyN`.
The shared inode-exhausted `/tmp`, previous evidence roots and all consumer data were left untouched.
The root had over60 million free inodes; `/tmp` had69 at the initial observation.

- New native/cold positive probe: **exit1, featureComplete=false**, preserved as a failed feature experiment.
- Existing discriminating tests: **4 passed /81 name-filtered skipped**, two files.
  These cover the original forged-highSeq/recomputed-checksum refusal, the unchanged LIMITATION refusal, and both original successful cold/warm detail controls followed by snapshot/interior corruption rejection.
  The LIMITATION pass is not progress acceptance; filtered tests are not executed passes.
- Whole `bun run check`: exit0, including no-emit TypeScript for the new helper.
- Whole `bun run check:agents`: exit0.
- Whole lint receipts are recorded separately after formatting the new helper/evidence.
- The full1194 baseline was **not rerun**: there is no production fix to qualify, and the requested targeted failure→fix→success prerequisite was not met.
  No1194/fresh whole-product PASS is asserted.

The first helper build failed because the Bun CLI entry lacked `./`; it produced no bundle, and the attempted Node invocation consequently failed.
The corrected explicit-relative build, first substantive failing probe, and final enhanced failing probe are preserved separately.
No historical failure/log was overwritten.

## Root-cause / maintained-spec delta

**B — cross-layer contract; D — coverage gap; E — implicit assumption.**
Outer continuation was mistaken for a reusable nested integrity proof.
A maximum-size segment and a maximum-size read window being equal leaves no room for even mandatory metadata, before considering parser time.
A publicly recomputable cursor checksum was never a capability to reuse past validation.
Warm caches and refusal-only tests concealed the difference between safe failure and required progress.

Main's maintained-spec follow-up should add:

- For every nested scan, enumerate output position, proof position, trust source, restart representation and actual per-window IO; require positive end-to-end completion, not merely an advancing outer cursor.
- Include a legal exactly-full segment plus bridge in cold/read-only regression fixtures, not only archives whose *aggregate* exceeds a window.
- Explicitly distinguish trusted producer-authored proof data, authenticated server-observed progress and caller navigation; never turn unkeyed cursor checksums into membership authority.
- Require long/interleaved end and overlap progress, zero-hit pages, repeated recovery, complete selected exports/digests and unchanged retained bytes together with all corruption negatives.

Maintained specs were read-only in this delegation, so this delta is recorded here rather than written outside ownership.
**Main must decide the concrete field/private-format handoff before further accepting implementation.
No W3 or product acceptance is requested.**
