# Client Reuse and Distribution Contract

This is a mandatory authoritative appendix to [design.md](design.md), not a separate product phase or optional scope.
Read it completely with the parent design; sections retain their original numbers for child references.

## 11. Reuse-First Complete Clients

Pinned reference: `xing-shuyin/pi-web-ui@e8bab487af208bc9a1ab60a821652323f598127f`.
Exact source anchors/dependency couplings are in `research/complete-workspace-reuse.md` and `research/design-ui-distribution.md`.

| Source family                                    | Cadence destination/adaptation                                                                                                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| App, LeftPanel/RightPanel, layout/CSS            | `web/src/components/workspace/`: complete task navigation/transcript/inspector shell; remove unrelated chat/PTY/plugin composition.                                                    |
| conv-groups, PlanBoard                           | `navigation/`, `components/plan/`: actual task/run/assignment tree and editable draft graph; no outcome checkbox or prompt-as-Start.                                                   |
| MessageList, Message, LazyMount, ToolCallBlock   | `components/transcript/`: coherent renderer/scroll/tool-detail families with stable paged IDs and authoritative status; no retry/fork/steer generic sender.                            |
| Markdown, StreamMarkdown, code/math/copy helpers | `components/rich/`: retain rich renderer; no dynamic fences, unsafe scripts or automatic external images.                                                                              |
| FilePreview, SCM change/diff presentation        | `components/review/`: captured/current change distinction and readonly artifact/diff inspection; no file editor, Git mutations or arbitrary host path API.                             |
| GlobalSearchModal, SearchBar, session-url        | `components/history/`, `history/`: complete search/hit/deep-link UI using durable cursor APIs, not switch_session.                                                                     |
| Whole run-trace standalone timeline client       | `timeline/`: React mount wrapper + narrow read bridge, retained lanes/filter/zoom/replay; measured observations, no inferred token-speed timing, clear-history, CDN or plugin runtime. |
| use-chat reconciliation, message-delta           | `client/`: shared typed service client/reducer, snapshot/resync/stale-socket protection; no per-tab runtime ownership.                                                                 |
| Dialog, drawers/responsive/styles, copy/download | Action dialogs, phone interaction and complete export UX; persistent status/Cancel, keyboard focus/escape restoration.                                                                 |
| Server/client token/cookie helpers               | Service auth + clean entry; retain MIT attribution, replace insecure remote defaults rather than rebuild unrelated accounts.                                                           |

Browser design: desktop three panes, phone drawers/full-height detail, ≥44px primary touch targets, keyboard operation, clear stale/error/unknown states and available Cancel.
Terminal retains native raw-entry/trust/idle/context checks, editor/confirm/pager and Unicode-width behavior.
Menus cover plans/assignments, Start/Cancel, child messages/tools/timeline, checks/changes/review, history/search/export and service status/diagnosis guidance.
Return/quit explicitly says work continues; Cancel explicitly requests stop.
Both surfaces share DTOs/actions, not separate state inference.
No HTML rendering or frontend framework is required inside the terminal.

## 12. Build, Dependencies, Package and Compatibility Changes

Use React/Vite versions pinned by the inspected upstream lock as the initial reproducible candidates: React/DOM19.3.0, Vite8.3.0/plugin-react6.1.1, react-icons5.7.0, Markdown/remark/rehype/KaTeX/highlight and vis-timeline8.5.4 families enumerated in `research/design-ui-distribution.md` §4.
Add direct type-only dependency edges actually imported by adapted modules; no incidental hoisted dependencies.
Add `ws@8.21.3` as the only new production library; use Node HTTP/crypto/zlib rather than importing Express/general server machinery.
Use `playwright-core@1.63.0` for isolated real-browser qualification; no browser auto-download or reuse of an authenticated personal profile.
No Electron/node-pty/SSH/DSH, upstream package runtime dependency, duplicated Pi bundle or Trellis runtime dependency.

Keep public Pi/typebox/Undici peers external and current development pins initially; owner/worker resolve the same declared installed peers.
Missing capability/dependency refuses, never searches global paths or installs a replacement.
Dependency availability/license bodies remain implementation provisioning gates; lock generation follows the existing isolated, lifecycle-disabled, offline/cache policy and stops rather than silently falling back online.

Generate `src/service-cli.mjs` through Bun local-source bundling with packages external, preserving explicit package-relative worker/Agent/web URLs.
Generate `web/dist` with fixed audited entry/chunk/font/vendor names and no source maps/timestamps/absolute source paths.
Use no-cache/ETag for fixed assets, no-store for private/auth responses; build/protocol mismatch disables actions and requests reload.
Build-check regenerates into private temp and compares exact names/bytes without mutating checked-in artifacts.
Pack requires already-built matching assets, not consumer postinstall compilation.

Extend exact reviewed `provenance/package-members.json`, source/body/pin audits, asset-reference closure and notices; do not derive expectations from the tarball under test.
Audit every new member beyond old 34/16 counts and any old 64-entry diagnostic cap.
Add `provenance/webui-reuse.json`, full pi-web-ui MIT notice, actual bundled dependency/font/vendor notices and shipped concise reuse provenance.
Retain existing Agent/pi-subagents attribution and independent skill/config contracts.

Intentional current-spec/test changes: terminal-only product → two surfaces; foreground cancellation → explicit service ownership; one worker → finite scheduler; no raw public tool detail → reviewed sanitized rich capture; no production deps → exact ws edge; one generated bundle → operator/service/web reproducible builds; fixed old member counts → reviewed complete new closure.
Retain negative intent for synthetic native entry, readonly escalation, no late auth spawn/fallback, exact process settlement, stale review, unknown locks, corrupt-state preservation and archive attacks.
Keep an assertion disposition ledger; do not blanket-delete tests or relabel historical failures.
