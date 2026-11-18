# Web theme tokens and timeline palette

## Theme test scope and vendor overrides

### The theme test parses :root tokens only from reference.css and styles.css

Kind: contract

Why: the token and pair-count checks read shared glass colours from two-space `:root` declarations in those sheets (wrapped values are normalized), not the timeline's separate `--tl-*` palette.

Anchors: `test/web/theme.test.tsx#SHEETS`, `web/src/timeline/timeline.css#--tl-input`

Source: this delivery, 2026-11-18

### The pinned vis vendor CSS gives .vis-item a vendor blue border and background

Kind: pitfall

Why: a timeline block gets both border and fill from `.vis-item` unless its lane overrides them, and a per-tool swatch must override both lane colours in turn.

Anchors: `web/src/timeline/timeline.css#.rtr-tlbody .vis-item.rtr-tc`, `web/dist/assets/vis-timeline.css#vis-item`

Source: this delivery, 2026-11-18
