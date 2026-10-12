# Logging and Diagnostic Presentation

## Single projection owner

`src/verification-diagnostics.ts` exports:

```ts
diagnosticText(value: string, maximum = 4096,
  secrets: readonly string[] = []): string;
```

Known literal secrets are deduplicated and replaced longest-first before truncation.
OSC/CSI/remaining terminal controls and bidi overrides are stripped; Bearer values, secret-like assignments and URL userinfo are heuristically redacted.
The result is byte-bounded UTF-8 with a visible `[truncated]` marker (or dots for very small budgets), not the old head/tail feedback object.
Do not promise detection of every business secret, encoded secret or user-authored sensitive sentence.

`src/subagent-process.ts` buffers bounded complete output before sanitizing, so split UTF-8 and split known-secret chunks are not exposed through streaming output.
Progress contains only ready/tool-name notices, including known-secret redaction even in tool names.
`src/sdk-worker.mjs` emits no raw tool payloads, thinking, provider errors or credentials.

## Durable context versus diagnostics

- Project `task.json` contains small goal/plan/result/baseline, check metadata/log names and activity, not transcripts or raw command/provider output.
- `TaskStore.writeLog(lock, output)` writes one exclusive 0600 UUID `.log` under the private root, bounded/sanitized to 65536 bytes.
- `readLog(name)` validates only the selected bounded private file and returns sanitized output or fixed unavailable text.
- Do not scan, rotate, reset or clean unrelated historical logs during coordination.
- SDK input credentials live only in memory/anonymous stdin and known-secret redaction state; never persist them or add them to argv/env.

Parent-approved checks are ordinary trusted shell commands and inherit project environment, including ambient credentials.
Unlike SDK auth, all such secrets are not necessarily known to the redactor.
Users must keep secrets out of command strings, task prose and emitted output; no universal secrecy guarantee follows from sanitization.
See [workflow](./lightweight-workflow-guidelines.md) and [storage](./database-guidelines.md).

## UI and operators

Filesystem strings retain raw operational bytes; quote/escape them separately for confirmation and JSON output.
Change fingerprints hash observed raw bytes, while displayed patches are control-stripped/redacted and can be incomplete.
Never compute freshness from the sanitized display.

`startupCardLines({cwd, home, projectTrusted})` returns code-owned research-status labels plus an escaped selected/expected config path.
No trust means no config read; malformed selected configuration yields fixed text without fallback.
`src/index.ts` sends only summary lines when a path line exists, via nonpersistent `notify` in TUI/RPC; print/JSON are silent.
No endpoint, key, model or parser payload is displayed by the card.

Readonly operator success is formatted JSON; failure is fixed `operator-refused` JSON, not arbitrary filesystem/parser text.
Stored runs/checks are historical context, not newly measured freshness or a machine PASS.

## Required assertions

`test/lightweight-process-diff.test.ts`: split secret/UTF-8, terminal controls, byte bounds, tool-name redaction and different SDK/check environment policies.
`test/lightweight-sdk.test.ts`: fabricated key/header literals stay out of output and consumer files.
`test/startup-card.test.ts`: trust, malformed config, repeated nonactivating notifications and secret-free labels.
`test/distribution.test.mjs`: extracted corrupt-config refusal preserves bytes without leaking its content.
