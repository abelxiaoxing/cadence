# Focused service parent-check contracts (implementation selection)

Production HTTP admission remains null.
This slice changes only TaskActions/TaskScheduler, the existing native launcher, owner-output recording, shared check facts/projection, private literal access and focused tests.
No human review, model selection, client metadata/handshake, dependencies, task state or renderer change is included.

## Native output

`runCheck` gains an optional owner-only service context: frozen host check environment, mandatory signal-time ownership predicate and a mandatory CheckRecording instance.
`runProcess` retains one spawn/TERM/KILL/close implementation.
Legacy callers keep 256KiB aggregate/64KiB preview behavior; service checks have no SDK framing/final requirement and ignored stdin remains EOF.

Service raw stdout+stderr ingress is limited to **16MiB aggregate**, each native chunk <=64KiB, before retention/async work.
Retained combined detail remains <=32MiB; existing owner8MiB/2048 queue, 5s reporting and all disk/quota ceilings remain.
Each stream has independent fatal incremental UTF-8 and TextSanitizer state and pauses independently.
Node can resume paused stdio on exit (`flushStdio`); therefore every ingress chunk is charged before its bounded per-stream queue, with one decoder/transform active per stream and every original continuation retained.
Native close joins both stream tails and capture end (including when later callbacks were discarded after stop).
Output uses one `check` detail with explicit `[stdout]`/`[stderr]` labeled observed chunks; it does not claim a reconstructed total OS write order.
Empty output still has a real completed detail.
No raw spill, complete-output string or preview-as-history.

`HistoryWriter.checkOutput(link,checkId)` is a narrow continuation of an actually started check under its held gate: only that check's content events, through the existing writer/reservations.
It may drain after ordinary quiesce, never past a recording fence.
Original writes remain lifecycle-tracked.
Missing, invalid, oversized or refused recording cannot pass.
Native outcome/exit/closure remain independently recorded even if capture fails afterward.

## Exact owned generation

New optional `check-settled.ownAdvance = {operationId,reservationId,from,to}` permits only `to === from + 1`; `reservationId === checkId`.
The shared RunState requires the actual operation, prior check-start and held per-check gate at `from`.
Passed status additionally requires unchanged fingerprint/completeness, complete committed output, native completed/zero/known close and exact before/after generations matching the advance.
Historical absent-field facts retain their old exact-equality rule.
A foreign advance is never normalized with <=.
Current obligations also compare original run epoch and start cwd/environment identity; changed definitions stay not-run.

## Admission and lifetime

Checks use existing ActionAdmission and the same fair checkout gate/two child-or-check slots.
Durable identity is kind check, graph null, assignments empty.
Target task must drain; configured name/command/timeout match exactly; manual requires existing ingress-created local authority.
Check-start precedes spawn.
Accepted-work/native/storage originals register before effects.
Stop/cancel/timeout/lease loss cannot authorize late launch/publication or release unknown reservations.
Native known no-launch and unconfirmed close are distinct.

Check previews include optional closed `checkEnvironmentPolicy: service-launch-ordinary/1` beside actual cwd/command/timeout and epoch/environment generation.
Historical previews without it retain their original decoding.
Checks pin the frozen host.checkEnvironment object at construction, never resolved auth or browser overlays; replacement refuses current authority.
Actual access/local capability and selected Pi static/known credential literals are available through private readonly sources without getAuth; no empty production-redaction default or public secret/hash projection.
Selected configuration reads may refuse; they never refresh/write credentials.
Existing selected source freshness remains mandatory.

## Evidence boundary

New native multi-operation scenarios may use explicit 60s outer case budgets; existing31 scheduler20s/SDK15s/read8MiB100ms/capture5s cases remain unchanged.
Native processes/filesystem facts and injected stalls/handles are labeled separately.
Independent review and remaining full accepting-owner/product gates are mandatory, not supplied by this document.
