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

### The mode toggle's base and disabled declarations are pinned by the capsule contrast test

Kind: pitfall

Why: The capsule readability test reads the base `.mode-toggle` `background: transparent` and `.mode-toggle:disabled` `opacity: 1` from the stylesheet source and asserts both, so a restyle that drops or changes either declaration fails it.

Anchors: `test/web/theme.test.tsx#keeps the disabled mode label, model and placeholder readable on the input capsule`, `web/src/styles.css#.mode-toggle:disabled`

Source: this delivery, 2026-11-20

### An exact .toBe() on a multi-line declaration keeps the space after the opening paren

Kind: pitfall

Why: `declaration()` stores each value with its whitespace runs collapsed to one space, so a rule written across lines — the folder-setup `radial-gradient(` — reads back as `radial-gradient( ellipse …` with a space after `(` and before `)`; verify the normalized string with postcss before asserting an exact match.

Anchors: `test/web/theme.test.tsx#declaration`, `test/web/theme.test.tsx#gives the no-project welcome a soft brand glow and a glass card`, `web/src/styles.css#.folder-setup .chat-messages`

Source: this delivery, 2026-11-24
