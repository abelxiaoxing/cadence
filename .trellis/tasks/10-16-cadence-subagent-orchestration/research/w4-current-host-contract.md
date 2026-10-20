# Current-host composition contract — implementation revision

## Authority and boundary

The MAIN `model-current-view-decision.md`, complete composition research and canonical parent design govern this work.
Existing human-review/check/accepted-work reviews supersede older descriptions of their missing core paths.
No prior test count supplies current acceptance.

First implementation boundary: the actual loaded model runtime → bounded catalog → authenticated explicit RAM choice → shared client.
Production task admission remains null until nullable TaskActions/current-view/build/client composition is complete and qualified.
This is not a reduced product scope or completed delivery.

## Exact model DTO/API contract

One portable codec owns these closed DTOs through `service-contract.ts`:

- `ModelSelector`: provider/model/API/thinking, identical to ModelSelection without sourceSelectionId.
  The maintained worker codec owns this factoring; max remains rejected, not clamped.
- `ChoiceVersion`: epoch UUID, positive accessGeneration/configRev, random catalogId UUID.
  The catalog ID is not a private file hash.
- `ModelCandidate`: provider (128 UTF-8 bytes), model (256), api (supported API or null for unsupported), thinking (at most seven distinct SDK levels, including nonselectable max), eligibility candidate/unsupported/auth-unavailable.
  No name, base URL, header, env, pricing, credential fingerprint or selection ID.
- `ModelCatalog`: version, selected ModelSelection|null, status complete/capacity, entries at most200.
  Capacity returns no clipped roster.
  Whole Reply stays512KiB.
  Exact explicit selectors can still be validated when catalog capacity is exceeded.
- `ChooseModelRequest`: expected ChoiceVersion plus ModelSelector choice.
- `ModelChoiceState`: version plus selected ModelSelection|null.
  Choice replies return state rather than a potentially overflowing full catalog.
  This is epoch RAM metadata, not a durable task receipt.

`GET /api/v1/models` is an authenticated passive catalog read with optional client AbortSignal.
`POST /api/v1/model-choice` is an explicit mutation requiring the existing attachment/native capability or cookie+Origin+CSRF boundary.
No query/body mixing or auto retry.
Lost reply is reconciled by catalog read, never POST replay.
Existing session GET refreshes capabilities on the same attachment.

`OwnerModelContext.catalog()` enumerates only configured source providers via real public getModels(provider), not getAvailable/checkAuth/getAuth.
Count bounds apply before candidate copying; returned raw model bodies never cross the boundary.
Unsupported/custom function transports remain nonselectable.
Known literal/unsafe identifier projection refuses instead of redacting into a selectable alias.
Enumeration makes no selection.
Selection validates exact public getModel/getSupportedThinkingLevels and original selected file/environment guards without creating a session.

`OwnerModelChoice` starts null with configRev strictly above HistoryWriter's replayed policy revision floor.
Successful changed choice advances configRev/catalogId and retires obsolete quiescent source IDs; exact unchanged valid choice reuses its ID/revision.
The existing low-level selection path remains internal.
Installation is synchronous after expected version/source/access/quiescence checks, with no await/effect gap.
No settings/default/first-model fallback or host-config rewrite.

`ServiceOwner.assertQuiescent()` checks phase/admission closure, every native/auth/storage/work original, Stop/flush state and the installed action-owner guard.
An installed action owner without a configuration guard refuses.
The actual TaskActions guard checks pending admission/originals, accepted-unallocated work, metadata/review, and scheduler episodes/holders/queued review barriers.
Writer pending/fenced/reserved and model loading/preparation are independently checked.
Refusal never revokes grants/cancels accepted work.
Success revokes unused grants through the one actual action-owner hook.

## Remaining exact integration contract

Nullable choice must be supplied to the same TaskActions instance, with replay-floor config revision and frozen check environment; observations must not fake actions or read old admission contexts as current authority.
The default prospective graph identity displayed in current context must be the identical one used by Start.
Current metadata remains <=512KiB, current-v1 plan32KiB, change body128KiB, active references<=8; saved graph bodies use the existing graph/progress reader and1MiB envelope.
No-selection supports truthful readonly metadata but not task action capability.

The W6 adapter must use shared current DTOs and a portable prospective UUID/hash helper, preserve explicit proof progress and source IDs, and perform no implicit Save/Start/rebind.
Build integration must extract a nonexecuting shared hash helper, embed independent service contract identity, load the actual fixed asset closure before HTTP construction, enforce compatibility at ingress and UI, and preserve separately authenticated compatible Cancel.
Compiled service cannot inspect TypeScript/source as a fallback.
Actual private secret sources and existing dynamic rotation callbacks remain required.

## Verification and exclusions

Add real isolated stock-SDK catalog/choice controls and actual native/cookie HTTP clients: no initial selection/auth contacts, exact selection/reuse/replacement, stale versions/source, unsupported max, capacity, secret projection, busy originals/action guards, same-attachment refresh, rotation, restart and closed task gates.
Label injected original-lifetime barriers separately from native SDK/filesystem/HTTP facts.
Run complete affected backend/shared/web tests and build/type/lint/Agent gates with fresh0700 home-disk TMPDIR/TEMP/TMP per command; preserve failed receipts.
No agents, pins/install/Git/status/credentials/deployment/cleanup/task-status changes.
Independent review and all remaining W1/W5/W6/W7 gates stay open.

## Partial implementation safety boundary

The complete current-view/build/client composition cannot be qualified in this pass.
Production host installs only the real catalog reader; `HttpAdapters.modelChoice` is separately optional and remains absent, exactly like task admission.
All production model-choice POSTs refuse unavailable without installing a selection.
The real private `OwnerModelChoice` core and typed wire/client operation are implemented for the next composition, not advertised as accepting HTTP behavior.
Its native fixture exercises real SDK/disk/readonly authenticated HTTP plus private choice; it does not qualify build-gated model-choice ingress.
Existing immutable-selection TaskActions deliberately refuses configuration changes even when idle until its nullable choice integration is implemented.
No placeholder accepting callback or build-compatible default is installed.
