# W6 source-port boundary

This independently started W6 pass follows the parent nonoverlap handoff while main routes W4.
Only `web/src/**`, optional web-local configuration, `provenance/webui-reuse.json`, new `licenses/pi-web-ui-reuse.md`, and W6 research are owned here.
No tests/build/browser/runtime fixtures, installation, shared/root configuration edits or task-state changes are part of this pass.

The behavior gap is the absent browser presentation, not missing execution ownership to be filled by a browser runtime.
Data flows from the existing `HttpServiceTransport` through `ServiceClient` and `ProjectionTracker` to scoped paged readers and presentation.
Actions use exact preflight/confirmation/one-shot command/receipt observation; reconnect and unmount never replay or cancel accepted work.
Missing owner current-role/saved-plan allocation metadata remains a typed, explicitly unavailable integration seam.

Port the pinned workspace/navigation, transcript/lazy window/tool, Markdown/math/code/copy, readonly preview/diff, search/deep-link, whole run-trace client and responsive interaction families.
Replace privileged source composition and data/control seams, preserving source headers and recording actual immutable source/destination hashes.
Timeline coordinates will be explicitly committed-sequence visualization unless measured comparable timing is available; no text-speed or browser-clock native timing inference.
All retained pages remain reachable; progress/snapshot are not fabricated empty data.

Reference inspection: `/home/mirako/abel/pi-web-ui` HEAD is `e8bab487af208bc9a1ab60a821652323f598127f`, with empty porcelain status.
`licenses/pi-web-ui-MIT.txt` and `provenance/auth-reuse.json` pre-exist this pass and will not be edited.
Final build/typecheck/browser/license/member qualification is deferred to main on frozen inputs, not claimed passed here.
