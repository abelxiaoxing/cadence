# Error Handling

## Refuse without substitution

Current owners are `src/task-types.ts`, `task-store.ts`, `service/task-actions.ts`, `subagent-process.ts`, `sdk-worker.mjs` and `task-shell.ts`.
Use their existing decoders and bounded result vocabulary, not a new error registry or retired certification framework.
[Workflow](./lightweight-workflow-guidelines.md) owns exact signatures and limits.

Ordinary validation throws bounded code-owned messages (`Unknown or corrupt task record`, `Revision conflict`, `Task changed; reopen it`).
Selected corrupt/unknown/linked/oversized state stays untouched; absence is not corruption and observation must not create it.
Never repair by reset, legacy import, fallback executor/provider, automatic retry or consumer cleanup.

## Result semantics

| Situation                                               | Required distinction                                                      |
| ------------------------------------------------------- | ------------------------------------------------------------------------- |
| Before launch failure                                   | Failed or canceled, `closed: true` means no launched direct child remains |
| Unexpected rejection after launch                       | `unknown`, `closed: false`; never invent settlement                       |
| Valid SDK final plus zero close                         | Worker completed, not a passing correctness check                         |
| Missing final, invalid UTF-8/protocol, nonzero or flood | Failed/incomplete                                                         |
| Abort/timeout followed by zero close                    | Canceled/timeout remains the result                                       |
| No close within stop bound                              | Unknown, interrupted task, retained lock                                  |
| Release throws                                          | Block new work but still settle cancellation waiters                      |
| Files changed after review                              | Reject Done and require review again                                      |
| Check missing/failed/stale or coverage incomplete       | Preserve facts; human acceptance is reviewed-with-issues                  |

The process runner sends TERM then KILL with explicit bounds and observes original direct-child close.
Later process absence is not retroactive proof of original close, and direct-child close is not whole-family settlement.
Continue is a new explicit action; direct edits may need manual recovery.

## Host and auth boundaries

`awaitWithAbort(work, signal, timeoutMs = 30000)` bounds waiting even when host auth itself is not cancelable.
The client/admission/scheduler recheck signal/current context/persisted record before launch so late resolution cannot restart work.
Missing supported public APIs, unsupported adapters, custom function transports and ambient-file auth refuse visibly with no model fallback.
Do not copy global-doc-only APIs into installed-peer code without checking declarations.

The shell catches action errors and displays `diagnosticText`; progress failure uses a fixed message asking the user to inspect task/coordination state.
The SDK child catches provider/tool errors without printing raw messages/stacks, emits fixed failure text and exits nonzero.
The operator prints fixed JSON `{ok:false,error:"operator-refused",usage:...}` with exit 1.
Startup-card errors are presentation-only and cannot authorize or suppress workflow admission.

## Tests and anti-patterns

Use `test/lightweight-process-diff.test.ts` for real malformed/nonzero/flood/UTF-8/TERM-ignore and held-descendant-pipe cases.
Use `test/lightweight-store-controller.test.ts` for launched rejection, retained lock, same-revision final-save conflict and release-failure waiter settlement.
Use `test/lightweight-shell.test.ts` for stale dialogs, custom transport and pre-progress Escape.

Wrong: catch any operation error, clear its lock and report completion.
Correct: retain unknown ownership, settle foreground waiters and expose explicit inspection/recovery.
Wrong: sanitize a failure into a passing status.
Correct: [logging](./logging-guidelines.md) changes display bytes only; exit/outcome/freshness remain independent facts.
