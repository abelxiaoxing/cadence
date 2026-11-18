# Web theme tokens and timeline palette

## Theme test scope and vendor overrides

### The theme test parses :root tokens only from reference.css and styles.css

Kind: contract

Why: `SHEETS` reads just those two sheets, so `timeline.css` carries its own `--tl-*` `light-dark()` palette tokens outside the token-only and pair-count rules; new shared glass tokens belong on `:root` of the two sheets, where the test's two-space parser format applies.

Anchors: `test/web/theme.test.tsx#SHEETS`, `web/src/timeline/timeline.css#--tl-input`

Source: this delivery, 2026-11-18

### The pinned vis vendor CSS gives .vis-item a vendor blue border and background

Kind: pitfall

Why: the pinned `vis-timeline.css` sets `.vis-item` `border-color: #97b0f8`, `border-width: 1px` and `background-color: #d5ddf6`, so the timeline lane and swatch rules must keep setting both `border-color` and `background`; dropping either reverts blocks to the vendor blue.

Anchors: `web/src/timeline/timeline.css#.rtr-tlbody .vis-item.rtr-tc`, `web/dist/assets/vis-timeline.css#vis-item`

Source: this delivery, 2026-11-18

### Biome wraps long :root light-dark() token values onto multiple lines

Kind: pitfall

Why: `biome check` inside `bun run verify` reformats a `:root` declaration that exceeds 80 columns, so a single-line `--menu-solid-bg: light-dark(rgba(...), rgba(...));` fails the lint stage; write the value wrapped with a 2-space property and 4-space arguments, matching `--glass-border` and `--menu-solid-bg`.

Anchors: `web/src/reference.css#--menu-solid-bg`, `web/src/reference.css#--glass-border`

Source: this delivery, 2026-11-18
