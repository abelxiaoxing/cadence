# Current views — assigned implementation contract

## Boundary

Implement the MAIN model/current decision against the existing single TaskActions, actual OwnerModelChoice, TaskStore, HistoryReader and check policy.
Production model-choice POST and task admission remain closed.
Assets/build compatibility, W6 binding, accepting-host workflows and the preserved nineteen failed scheduler/review cases are not qualified by this slice.
No new executor, reader reducer, SDK runtime, credentials/settings writes or history cache.

## Selected APIs

- TaskActions accepts either its existing immutable `selection` or an actual `OwnerModelChoice` (`choice`), never both.
  Structural owner/source/cwd liveness is separate from requiring a selected model.
  Nullable mode allows readonly metadata before selection; mutation context is unavailable.
  Configuration replacement is permitted only through the existing comprehensive owner/writer/model/admission/scheduler quiescence guards; immutable mode continues to refuse retargeting.
- Choice snapshots supply actual config revision above the writer's replay floor.
  Check environment is the constructor-frozen ordinary environment, generation one scoped to this fresh epoch/cwd identity; no read advances checkout generation.
  Accepted work rechecks its frozen real model/config identity, ignoring only accepted access rotation.
- One action-neutral current observation supplies current metadata and previews: selected raw task, actual role/hint sources, choice, saved publication lineage, configured definitions, one change capture and current versions.
  Its prospective single-assignment default is stable for the same raw task/choice and is also used by first Start.
  It is not a saved graph or ContentRef membership claim.
  Immutable fixture mode preserves the old action-specific default policy until its clients cut over.
- `CurrentRequest = {storeId, taskId: UUID|null}`; changes requires nonnull task.
  It never requires an old ContextVersion.
  `CurrentView` echoes the request and includes workspace/epoch/committed sequence, ControlContext, raw task identity, exactly three pinned role hashes, current-v1 plan text with coverage and editability, and saved graph selection.
  Saved selection is proven `none`, `saved` with an actual GraphReadRequest plus planRevision, or `unavailable` with a fixed error.
  Inconclusive proof is never none.
  Existing graph reader/progress owns graph bodies.
- `CurrentChanges` echoes the same request/current identities and carries ObservationFact, bounded sanitized text and coverage from that one capture.
  No ContentRef or generation advancement on reads.
  Whole success Reply <=512KiB; current-v1 text <=32KiB; changes text <=128KiB.
  Redacted current text is noneditable, not an exact editable identity.
- `ActiveRuns` is a bounded complete/unavailable roster (at most eight), with store/workspace/epoch and run/task/operation/kind/stage references.
  It includes committed accepted-unallocated work, active episodes/checks and draining originals, independently of selected historical task pages.
  Uncertain pre-acceptance reporting cannot be represented as a falsely complete empty roster.
  Old-epoch unknown history is not current activity.
  Workspace may carry this additive roster; absence in old uncomposed fixtures means unavailable, not complete-empty.
- Optional `CurrentMetadataPort` and named `/api/v1/current`, `/current-changes`, `/active-runs` readers use the shared DTO codecs, existing authenticated GET/readonly POST and AbortSignal semantics.
  Missing composition refuses.
  No control consent from reads and no production activation.
- Current configured obligations reuse `currentChecks`, including epoch/cwd/environment/generation freshness.
  Revision reflects relevant current results as well as definition changes; review and obligations consume the same policy.
  Original native/check facts are unchanged.
- A portable asynchronous `proposePlan` helper takes decoded current metadata, explicit readable text/assignments and injected UUID/SHA256 operations (Web Crypto or native).
  It constructs only a prospective save-plan action using actual task/graph/plan revisions and exact roles/model.
  It refuses unavailable/redacted metadata and does not resolve graph proof as null, read membership, retain bytes, rebind assignments or submit Save/Start.
  Hashing awaits cannot retarget the copied input; callers must explicitly preflight the returned action.

## Freshness and validation

Revalidate actual sources, raw task/choice/access/control/generation after asynchronous boundaries; no cached preview as authority.
Saved lookup reuses cold TaskPublicationLineage and bounded existing guards.
Pending/conflict/external bytes/missing source/budget exhaustion cannot revive old authority.
Old source IDs remain stale after restart until explicit rebind/save/new Start.

Tests use real isolated owners/choice/store/writer, with labeled native/fault controls.
Preserve existing case/native/read/capture limits and original runner results.
New evidence/handoff must report exact changed hashes and failed gates without rewriting earlier evidence.
Independent review remains required.
