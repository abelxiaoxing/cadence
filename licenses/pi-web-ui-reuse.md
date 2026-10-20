# pi-web-ui presentation reuse

Cadence adapts source from [xing-shuyin/pi-web-ui](https://github.com/xing-shuyin/pi-web-ui), revision `e8bab487af208bc9a1ab60a821652323f598127f`.
Copyright (c) 2026 xing-shuyin.
The full existing [MIT license](pi-web-ui-MIT.txt) is retained unchanged.
This adaptation is not endorsed by the upstream author.

Adapted families include the three-pane workspace and drawers, nested navigation and plan editing, lazy transcript/tool cards, Markdown/stream/code/math/copy, readonly preview and diff, search/deep links, reconciliation, and the standalone run-trace client.
Cadence replaces upstream execution, arbitrary messaging, history repair, mutation, plugin and credential-storage boundaries with its finite typed shared service client.
Timeline geometry is explicitly ordinal; recorded worker-local clocks and native check duration remain independently labeled, never aligned into inferred overlap.
The source-level file/hash/modification inventory is `provenance/webui-reuse.json`.

The serial W6 revision adds a deterministic Vite build, explicit observation lifetime, action-specific confirmation and adapted tests.
It externalizes the timeline stylesheet and all 15 static style-inject literals from the exact reviewed vis standalone body without enabling inline stylesheet elements.
Local pure/SSR, HTTP and narrowly scoped empty-workspace/browser CSP tests are not complete workflow, accessibility or distribution qualification.

This note does not license third-party bundled dependencies under upstream's MIT license.
Actual emitted fonts match the available KaTeX 0.18.7 font provenance and separate full OFL/reserved-family notice inputs.
The actual vis standalone includes separately licensed embedded dependencies; its top-level MIT notice alone is insufficient.
`bundled-web.txt` now preserves the full React, Feather, unified/remark/rehype, highlight.js, KaTeX/OFL and actual vis embedded dependency notices, plus emitted Vite/Rolldown helper notices.
Repository `provenance/bundled-notices.json` binds rendered source bodies/output chunks, all60 font bodies and exact original notice slices; the builder and real pack audit enforce that closure.
The current package is an integrated delivery candidate pending independent final review, not a claim that unexecuted human/platform/provider lanes passed.
