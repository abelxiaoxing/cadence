# Accepted-work lifetime implementation contract

Scope: the serial assignment in `accepted-work-lifetime-handoff.md` only.
Production task admission remains null.
No frontend, model-selection, checks/review, protocol, dependency or resource-budget change.

Smallest gap: the lifecycle owner joins individual native/auth/storage promises but not the accepted action's continuation between those promises.
External TaskActions also never installs its quiesce participant.
Fixture quarantine intentionally retains locks, but currently also leaves its owned transports open.

Selected implementation:

- Add one owner-private accepted-work original registration returning an explicit settled/uncertain disposition.
  Register before scheduling control work; rejection is never known completion.
  Keep native/auth/storage independently tracked.
  Install exactly one synchronous action-quiesce participant on the actual ServiceOwner.
- Start the action lifetime around the actual commit-to-activation continuation, not only when a child exists.
  A committed action waits for activation or quiesce disposition; metadata and the scheduler's whole control-flow completion belong to that lifetime.
  Stop revokes grants and closes queues synchronously, requests all native stops before awaiting originals, and cannot release through an empty process roster.
- Keep existing writer serialization and original hooks.
  Add narrowly owned quiescence/effect checks and candidate-less uncertain-publication recording for accepted work that cannot publish.
  No fabricated candidate, allocation or native result.
  Necessary closed stop/settlement observations remain original tracked writes with existing bounds.
- Track episode control-flow jobs through original completion even on failure; preserve quarantined episodes/reservations.
  Do not interpret a swallowed Promise<void>, reporter timeout or global pending count as successful work.
- Narrow TaskActions' dependency type to the actual owner/writer/reader/model/access/coordination members it uses.
- Fixture teardown joins its exact action/writer/native originals then explicitly closes only its own live/HTTP/WS/provider resources, even after quarantined Stop.
  This does not release locks or repair unknown outcomes.

Expected edits: `src/service/{owner,task-actions,scheduler}.ts`, narrow `src/history/writer.ts` and its existing publication reducer only if required for pre-allocation uncertainty, focused owner/core/native/history tests, exact fixture teardown, and canonically regenerated service output.
Independent review is still required.

Fresh root: `/home/mirako/abel/cadence-accepted-lifetime-tIqJSJkX`, mode0700.
Initial task discovery preceded allocation and used the existing home-disk parent as TMPDIR/TEMP/TMP; subsequent commands select the allocated root.
Preserve every failed run.
The previous 31-case diagnostic pass does not repair or explain the older eleven failures.
