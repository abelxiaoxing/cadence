# W3 actual v1 publication and guarded recovery handoff

## Disposition

Implemented actual held-checkout v1 publication and guarded history recovery over the existing single writer.
This is **not** a complete-product, package, client-cutover or W3 acceptance claim.
Main must independently review this slice together with the preceding search/export slice and compose W1/W4.
No task status, shared W1/W2 contract/source, package/lock, maintained spec, credentials, Git index/ref or unrelated consumer bytes were changed.
No agents, installation, deployment, commit, push, lock reclamation or consumer cleanup was performed.

[Evidence](w3-publication-recovery-checks/evidence.json) binds the final 87-file input manifest, commands, receipts and this handoff.
Earlier reports and failed experiments remain preserved.

## Changed owners

- New `src/history/publication.ts`: strict v1 mapping, independently validated retained previews, conservative phases and POSIX publication-directory flushes.
- New `src/history/recovery.ts`: readonly `RecoveryInspectionPort`, exact affected-history digest and required-authority guarded append, without lock-release authority.
- `src/history/writer.ts`: real publication API, committed expected-byte intent/outcome, current operation joins, persisted resource policies, creation cap and recovery-aware restart fences.
- `src/history/run-state.ts`: shared publication transitions, pre-effect uncertain refusals, failure fences and recovered historical projections.
- `src/history/types.ts`: closed private recovery bridge and optional admission resource policy; one shared batch-sequence rule.
- `src/history/files.ts`: original-byte bridge validation and exclusive new-segment recovery write.
- `src/history/navigation.ts`, `search.ts`, `export.ts`: explicit bridge traversal, retained old ranges, incomplete recovered coverage and bounded old-run retirement without rewriting outcomes.
- New `test/service-history-publication-recovery.test.ts` and `test/helpers/history-publication-{fixture,child}.ts`.
- `test/service-history-semantics.test.ts`: two existing positive publication fixtures now perform actual saves instead of asserting invented observed identities. Their original assertions/count remain.

All other previously indexed inputs match the preceding search/export manifest, including W1/W2, public contracts, package/lock and the original genuine native integration case.

## W4 publication API

```ts
writer.publishTask({
  operationId,
  cwd?,       // Required for Create; canonical selected cwd inside checkout.
  result?,    // Optional exact committed selected child final ContentRef.
  baseline?,  // Exact committed before-change ContentRef for this operation/run.
}): Promise<{
  status: "published" | "conflict" | "uncertain" | "refused";
  publicationId: string | null;
  committedSeq: string | null;
  observed: { revision: number; identity: string } | null;
}>;
```

Call after the existing durable command acceptance and, for episodes, immutable run admission.
The operation must belong to this owner epoch and current control context.
Run, task, command, operation, expected raw identity/revision, committed final/change/check/review content and publication transitions are joined, not supplied as arbitrary replacement task fields.
W4 still owns real current observations, scheduler gates and fresh action authority.
`reviewContext` is required for accepted review and rechecked for its selected revision/observation before actual publication.

The one writer serializes:

1. Build the bounded strict-v1 candidate from the accepted action, selected legacy record and committed retained facts.
2. Commit `publication-intent` with exact expected revision/raw identity and next revision/canonical-byte identity.
3. Reassert the original lease/current context and creation cap, then call the real `TaskStore.save(candidate, revision, lease.checkout, identity)`.
4. On POSIX, flush the task directory chain; observe the saved raw snapshot and verify exact revision/identity.
5. Commit the separate published/conflict/uncertain outcome before returning a durable published result.

No save occurs before committed intent; no save is performed by GET, replay, lookup or recovery.
A generic low-level `published` observation now also requires actual selected v1 bytes, not an invented matching pair of hashes.
A failed final journal write cannot turn an observed save into durable publication success.

When selected state/capacity prevents even constructing candidate bytes, no candidate identity or save is invented.
The existing owner-fact vocabulary records an **uncertain pre-effect refusal without an intent**, when the original writer can still commit it.
The reducer permits this failure-only transition, never an intent-less published transition.
It fences current/restarted admission; an unavailable original append still returns non-durable uncertainty.
A missing/corrupt/deleted task is never reset or recreated as a continuation.

### Summary and review rules

- Strict v1 keys and directory shape remain unchanged; no graph/transcript siblings.
- Goal 8 KiB, plan 32 KiB, result/baseline 16 KiB, activity 64, record 128 KiB, tasks 1000 and checks 32 remain compatibility ceilings.
- Result/baseline/advisory summaries identify the stable run and explicitly distinguish clipped summaries from unchanged retained history.
  Full content integrity is read independently while only a bounded UTF-8-safe preview is retained in memory.
- Queued/preparing/running → running; successful ordinary execution → review; successful advisory generation → planning; failed/blocked → failed; canceled/timeout/unknown → interrupted.
  Mandatory recording failure cannot satisfy the completed parent reducer.
- Only an accepted explicit human review fact can publish done.
  Not-run configured obligations, stale/failed checks, actual native exits and execution outcomes are not rewritten by human closure.
  Unqualified reviewed code additionally requires actual check coverage; legacy/recorded stale or mismatching fingerprints remain issues.
- Save-plan validates the selected committed plan bytes/version against the accepted action; it does not import historical approval.
- Create is capped before command reservation and again immediately before save, not merely at the next list operation.
  Additional check or whole-record overflow refuses instead of deleting old records/checks or silently clipping them.

Publication failure does not manufacture a successful parent drain.
Existing original auth/process/gate drain rules remain the only episode-reservation release path.
W4 must observe both native execution and publication status, rather than treating either as a substitute for the other.

## Resource and owner joins

Each new accepted admission persists its selected config generation, quota, episode reservation, free-space floor and control headroom in the private row.
The writer captures its options for the owner lifetime; reopening the same epoch cannot silently substitute different limits.
New confirmations use the selected config generation; changing ceilings still belongs to explicit W1 configuration/new confirmations.

Inventory counts retained/orphan/temp/index/metadata bytes in the owned history namespace, with no cleanup.
Admission refreshes that inventory; prospective v1 temporary/replacement bytes are conservatively charged before saving.
Reservations still do not guarantee actual disk space, and existing consumer business files are not a history-quota inventory.
Recovery checks actual usage/free space against the last recorded quota before its new segment.

Change facts must join a real accepted operation/task/run; change, review and check-output references must belong to their actual operation.
Existing handoff validation still requires frozen dependency order/ranges, exact committed selected predecessor content, native settlement and independent byte equality.
Real checkout freshness and the observation barrier remain W4's owner duties, not inferred filesystem certification by the history reader.

## W1 recovery APIs and authority boundary

```ts
const history = new HistoryRecovery(coordination);
await history.inspect(epoch); // Implements existing readonly RecoveryInspectionPort.
const expected = await inspectRecovery(coordination, history);

const fact = await history.append({
  expected,
  acknowledgeEscapedProcesses: true,
  processes: "externally-resolved",
  credentials: "independently-resolved",
  storage: "independently-resolved",
  // REQUIRED W1 implementation; throws on stale/lost/nonlocal authority.
  assertLocalAuthority: assertCurrentInteractiveLocalChoice,
});
// fact: recoveryId, committedSeq, old epoch, coordinationDigest,
//       original historyDigest, new segmentIdentity.
```

The callback shown is an integration obligation, **not an implemented accepting CLI**.
Do not pass a no-op in production.
Tests label their assertion callbacks and independent acknowledgments as fabricated management facts.
W3 does not implement authentication, decide that an operator actually stopped descendants, clear/signals/steal locks or invoke legacy `TaskStore.recover`.

Inspection validates retained committed artifacts and hashes exact safe history bytes, including orphan/index/temp metadata.
It is passive and performs no SDK/auth/task construction, append or repair.
Unmatched auth and launch/check work are tracked separately; no launch does not settle an auth intent.
Unfinished content, accepted-but-unpublished metadata, undrained run accounting and pre-effect publication refusals keep storage unknown independently.
The inspection is bounded safe-file administrative IO: unsafe files, interior corruption or exhausted inventory bounds refuse, never imply absence.

Append requires all independent acknowledgments, the exact unchanged choice and a required current local-authority assertion.
It invokes the existing W1 owner probe: live/ambiguous owners refuse, including EPERM rather than just successful PID disappearance.
It reasserts authority, exact coordination choice and affected-history digest around original native write/flush boundaries and after the callback itself.
A callback-induced history change or a change after the recovery body is written prevents a durable success return.

The returned fact is usable by a **later W1 exact-lock-release composition**, which must revalidate its own ownership/choice and original promise accounting.
W1 `resolveRecovery` was deliberately not edited and still refuses unavailable; an actual dead-owner takeover is therefore **not composed or qualified here**.
Even a successfully appended W3 recovery fact leaves owner/v1/registry locks byte-identical.

## Preserved-tail bridge and restart behavior

Recovery writes one new exclusive segment; it never appends into/truncates/replaces the damaged original segment.
Its closed bridge binds original segment bytes/hash, committed offset/watermark, highest observed sequence, affected-history digest, exact coordination digest and separate acknowledgments.
The new committed sequence is beyond both the old committed watermark and complete uncommitted rows.

All scanner/navigation paths use the same explicit sequence-gap rule.
A preserved final partial line or valid unmatched batch may be crossed only by the intact matching next bridge.
Malformed interior complete records, mismatching bytes, missing artifacts or arbitrary later files still refuse.
An unsuccessful recovery append preserves its new partial bytes/fences; there is no cleanup-based retry repair.

Original accepted commands, auth intents, native unknown/failure facts and partial content remain inspectable.
The bridge closes unsafe admission fences; it never settles old work as completed, resumes queues or supplies fresh mutation authority.
Ordinary construction/restart never appends recovery.

Recovery intentionally leaves navigation acceleration **unavailable**, not a falsely complete empty index root.
Old snapshot cursors and exact byte ranges remain valid; newer snapshots use authoritative bounded fallback until an explicit future rebuild.
Search/export report bridged coverage incomplete instead of turning skipped uncommitted bytes into a complete archive.
The exporter emits old unresolved run facts before retiring its finite active reducer set.
A source-only empty index root would have hidden retained entities at new snapshots; the final correction and cold reverse-lookup tests prevent that.

## Verification and evidence

Final focused command covers all eight history files and the prior ten-file set:

- **1181 passed, 0 failed, 0 skipped; 18 files; 472.51 seconds.**
- Prior baseline 1140 plus **41 new cases**; 200 history cases and unchanged 981 prior-ten-file cases.
- The shared 114 codec vectors still execute through two surfaces; overlapping semantics and development reruns are not additional independent capabilities.
- Whole `bun run check`, `bun run lint`, and `bun run check:agents` receipts are bound separately in the evidence index.
- Final source/test/package hashes match before and after verification.

Actual boundaries:

- Real temporary v1 saves, independent raw identity checks, retained long result/baseline integrity, 1000-task and 32-check bounds, same-revision/deletion/corrupt preservation and read nonmutation.
- Original ordinary Node children are waited at real before/after-save, before/after actual rename and outcome body/commit crash windows.
  Native rename is wrapped solely to inject the crash at that boundary; it is not replaced with a fake save.
  Failed temporaries and original damaged bytes stay preserved.
- Actual dead-child recovery writes/flushes a new segment, retains locks, separates unmatched auth and launch, rejects stale/changed/interior-corrupt state and preserves old search/detail/reverse-navigation identities.
- Check/native/authority facts in the new structural controls are explicitly fabricated inputs, not new shell/provider/CLI qualification.
  The reopen/new-admission test injects ESRCH while retaining real W1 locks; it proves W3 history reopening, **not actual W1 takeover**.
  EPERM and write-boundary mutations are explicit injections too.
- The unchanged genuine W1 model preparation + W2 guarded stock SDK/native worker + W3 retained history control still stores **more than 2 MiB** with its original **20-second test / 15-second child** bounds.
  Prior actual SDK/check/HTTP/export/revocation and injected ENOSPC/slow-write controls remain in the final focused set.

Available host: `/usr/bin/node` v26.7.0, Linux x86_64, Bun 1.3.14, installed Pi coding-agent/AI 0.84.3.
No native disk-full, full repository suite, generated/extracted package, client cutover, physical-human/device, paid-provider, Node22, modern Pi1.2, Windows/macOS or ConPTY qualification was added.

## Preserved development corrections and remaining composition

Development logs retain early type/fixture mistakes, the two old fabricated-publication positives that now require actual v1 bytes, and intermediate passing runs before later corrections.
The final pass additionally fixes UTF-8 preview boundaries, failure-only pre-effect publication accounting, stale legacy check-review issues, recovered active-state retirement the nonauthoritative recovery index root, and independent unknown-storage inspection for unfinished/pre-effect accounting.
These receipts were not rebound to earlier bytes.

No accepting publication/recovery implementation stub remains in this slice.
Required follow-up remains main's independent W3 review, W1 real local-authority/CLI/exact-lock-release and lifecycle composition, W4 actual scheduler/check/review/current-observation use, and W5–W7 client/distribution/integrated acceptance.
Large inconclusive receipt/point reads still refuse within the existing bounded fallback contract; no on-read index rebuild or arbitrary interior-corruption repair was introduced.
Main should update maintained storage/service-owner guidance after review; those specs were read-only in this delegation.
