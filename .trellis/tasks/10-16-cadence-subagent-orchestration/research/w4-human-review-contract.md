# Human Review — Selected Implementation Contract

Production host admission remains null.
This slice composes explicit review metadata only; no model chooser, client renderer, host activation, new executor or dependency.

## Boundaries

- TaskActions observes and activates the existing review action through ActionAdmission and its original accepted-work registration.
  Preview binds raw task bytes/revision, current saved graph, exact selected latest non-check run, check-obligation revision, changes, cwd/model/environment/checkout versions and explicit issue acknowledgment.
  Readonly tasks have no code-check obligation.
- TaskScheduler adds a bounded metadata barrier waiter to its existing ordered checkout gate, not a child/check episode or native reservation.
  It shares writer preference, blocks younger readers, requires no existing holder at acquisition and releases only after original metadata work is known settled.
  No barrier is held during confirmation.
  Stop rejects queued barriers and prevents new ordinary effects.
- HistoryWriter installs one actual owner review-context callback.
  The callback recaptures selected task, sources, changes and current checks at effect boundaries; immutable historical run/plan proofs may be reused only with their selected identity and original-source validation.
  No default-true callback, old run reservation or fabricated run allocation.
- Current checks use the latest exact definition result, epoch/cwd/environment and checkout generation; older superseded failures remain history, not permanent current failures.
  Manual checks are similarly latest-per-exact-selection; missing code coverage, current failed/stale/unrun checks, incomplete observation/capture or unsuccessful selected execution require acknowledgment.
- Review changes/text are real owner content, associated with the selected historical run but stored/charged to the accepted metadata operation.
  Review never changes native, recording, check or parent settlement facts.
  All v1 writes use publishTask, exact expected bytes/revision and existing bounds; nonapplication uses abandonPublication.
- Cold current-plan proof derives the latest accepted Save and exact subsequent expected-to-observed publication chain from original task rows and the shared publication transition.
  Later pending/conflicted/uncertain operations, missing links, external bytes or exhausted read budgets refuse; no all-archive graph cache or restored model approval.

## Planned Files

`src/service/{task-actions,scheduler}.ts`: admission, live observation, bounded barrier and lifetime composition.
`src/history/{reader,run-state,writer,projection,publication}.ts` plus small owner-local check/review helper if needed: one shared obligation policy, cold lineage, real metadata ownership, writer validation and truthful publication.
Focused native/disk/history tests and canonical generated bundles only as affected.

## Verification

New multi-operation tests use explicit60s case budgets, actual isolated stock SDK/fabricated provider and shell, original process/storage settlement and real retained readers/exports.
Original20s/15s/read8MiB100ms/capture5s bounds remain unchanged.
Injected timing/storage faults are labeled.
Commands use fresh0700 home-disk TMPDIR/TEMP/TMP.
Preserve failures and source freezes; independent review is required from main.
No physical-human/browser/paid-provider or whole-product claim.
