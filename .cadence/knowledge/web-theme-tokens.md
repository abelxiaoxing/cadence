# Web theme tokens and timeline palette

## Source checks and shipped styles

### Passing source contrast checks does not prove a rule ships

Kind: pitfall

Why: `rootTokens` reads two-space `:root` declarations from `SHEETS`, including the `--tl-*` palette in `optical-tokens.css`; the design-input border test also checks canonical `cadence.css` because a source sheet can pass without being imported.

Anchors: `test/web/theme.test.tsx#rootTokens`, `web/src/optical-tokens.css#--tl-input`, `test/web/theme.test.tsx#ships the design input's resting border in the canonical browser stylesheet`, `web/src/components/workspace/design.css#.design-custom input:not(:focus)`

Source: this delivery, 2026-11-20

### A timeline swatch must override both the vendor border and fill

Kind: pitfall

Why: The pinned `.vis-item` supplies its own blue border and background, so a lane sets both and the per-tool rule overrides both lane colours before the error override.

Anchors: `web/dist/assets/vis-timeline.css#.vis-item`, `web/src/timeline/timeline.css#.rtr-tlbody .vis-item.rtr-tc`, `web/src/timeline/timeline-client.mjs#toolClass`

Source: this delivery, 2026-11-20
