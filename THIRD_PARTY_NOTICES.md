# Third-Party Notices

This package adapts narrow lifecycle evidence from the reviewed reference repository `gotgenes/pi-packages` (MIT), commit `a1ee2255b81cb540f88d233112e868ca91fe7846`, package `packages/pi-subagents`.
Only FIFO settlement, cancellation cleanup, legal state transitions, and born-complete session disposal invariants informed this implementation.
The adapted invariants are re-expressed in this package's own code and tests; that historical adaptation shipped no reference code verbatim.

The complete MIT license text of the referenced package is bundled at `licenses/pi-subagents-MIT.txt`.

| Adapted concept                                 | Reference source                | Reference path                                |
| ----------------------------------------------- | ------------------------------- | --------------------------------------------- |
| FIFO settlement of queued work                  | gotgenes/pi-packages @ a1ee2255 | packages/pi-subagents (state/queue semantics) |
| Cancellation cleanup and born-complete disposal | gotgenes/pi-packages @ a1ee2255 | packages/pi-subagents (session lifecycle)     |

## Native agent session browser

`src/agent-browser/session-navigator.ts`, `transcript-pane.ts`, `transcript-content.ts` and `labeled-rule.ts` adapt the readonly session browser from `gotgenes/pi-packages`, commit `52854c12d590142e61a4f6a6947be9084035300d`, `packages/pi-subagents/src/ui/{session-navigator,transcript-content,labeled-rule}.ts` (MIT).
The browser's transcript pane, per-message renderer, incremental content cache, paging/follow behavior and labeled chrome are reused code, not merely UI inspiration.
Cadence replaces upstream agent/file sourcing with its existing readonly event feed and supplies a live Pi list with stable selection and per-agent reading positions.
No upstream executor, manager, steering, stopping or persisted-run reader is included.
`provenance/agent-browser-reuse.json` records exact source hashes, local paths and adaptations; the complete upstream MIT license is preserved in `licenses/pi-subagents-MIT.txt`.

## Bundled browser dependencies, icons and fonts

`licenses/bundled-web.txt` preserves the full actual emitted dependency notices, including React/DOM/scheduler, react-icons and Feather, unified/Markdown/HTML utilities, highlight.js, KaTeX and vis-timeline's embedded vendor versions.
KaTeX font bytes retain separate SIL Open Font License 1.1 and reserved-family notices; KaTeX's MIT code license does not replace them.
The vis standalone bundle's embedded versions are bound to audited source artifacts, not assumed equal to current project dependencies.
Repository `provenance/bundled-notices.json` binds source modules, output assets/fonts and complete notice byte ranges/hashes.
No notice-only package is added as a runtime dependency.
