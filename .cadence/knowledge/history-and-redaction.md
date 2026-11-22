# Capture, history and redaction

## Ordinary Pi session sharing and capture handoff

### Pi owns session files; Cadence reads them incrementally without rewriting or migrating

Kind: contract

Why: `pi-sessions.ts` folds JSONL files in 64 KiB chunks with an 8 MiB body LRU and tolerates torn trailing lines without imposing a total file-size cap; pre-Pi `conversations-v1` records are refused rather than migrated.
Branch context size walks back at most `USAGE_WALK` (256) entries and becomes unknown after compaction.

Anchors: `src/service/pi-sessions.ts#USAGE_WALK`, `src/service/conversation-records.ts`, `test/pi-sessions.test.ts`

Source: internalized from engineering/history.md, 2026-11-22

### Live capture handoff and tool association bind exact private call identity, never display names

Kind: pitfall

Why: `cadence-browser-command/1` links finalized Pi messages via `captureMessageId` and independent executions via `captureResultCallId` so live previews never duplicate or drop turns across marker/final ordering.
Display names apply current `readSecrets()` redaction before Unicode-safe 128-byte JSON clipping, while association keeps unredacted private IDs/names locally; unexecuted declarations stay neutral (`unavailable`/`canceled`/`pending`) rather than inheriting parent error state.

Anchors: `src/service/conversation-records.ts#readSecrets`, `src/worker-capture.mjs`, `test/conversation-records.test.ts`, `test/runtime-timeline.test.ts`

Source: internalized from engineering/history.md, 2026-11-22

## Workflow records, capture publication and redaction

### Workflow transcripts publish on tool-update snapshots and preserve unknown parent settlement

Kind: contract

Why: `TurnCapture` triggers expected-byte transcript publication on `tool-start`, `tool-update` (replacement snapshot), `tool-end`, message-end, model-retry and worker-failure.
If a parent step settles without `tool-end`, the reader projects the still-running transcript as `unknown` without rewriting retained bytes or fabricating tool results.

Anchors: `src/service/turn-capture.ts#TurnCapture`, `src/service/workflow-result.ts#WORKFLOW_RESULT_BYTES`, `test/workflow-runtime.test.ts`

Source: internalized from engineering/history.md, 2026-11-22

### Redaction runs across split chunks before persistence and reapplies on every read

Kind: contract

Why: Capture and result projections sanitize known credentials, owner tokens and terminal controls across chunk boundaries and escaped literals (including decode-before-sanitize on structured JSON replies) before writing and reapply current `readSecrets()` on every read without mutating retained history.
Live activity metadata is cloned and re-sanitized on every read even when no new capture event arrived.

Anchors: `src/worker-redaction.mjs`, `src/service/conversation-records.ts#readSecrets`, `test/worker-capture.test.ts`

Source: internalized from engineering/history.md, 2026-11-22

## Retained history readers and format-3 proofs

### Cooperative read quantums apply only to client reads, never owner authority decisions

Kind: pitfall

Why: Client-facing history reads enforce cooperative 100 ms / 8 MiB quantums (retrying up to twice on wall-clock host stalls with no progress) and use format-3 AES-256-GCM cursors that validate source/key incarnations without granting mutation authority.
Owner-internal authority reads (current views, admission, publication, receipts) stay byte-bounded without wall-clock expiry so slow hosts never fail owner decisions.

Anchors: `src/history/writer.ts`, `src/history/recovery.ts`, `test/service-history-projection.test.ts`

Source: internalized from engineering/history.md, 2026-11-22
