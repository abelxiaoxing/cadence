# Development and verification

How to develop, test and verify Cadence, which tests own which contracts, and the regression lessons every change must keep.
Read this before integrating any change.

## Commands and environment

```sh
bun run check
bun run check:web
bun run build:check
bun run lint
bun run check:agents
bun run test
bun run test:target test/service-contract.test.ts
bun run test:service
bun run test:web
bun run verify
bun pm pack --destination /absolute/private-temp
```

`bun run verify` is the sole integration and release gate, not a preliminary pass before another suite.
It runs every independent check at once: syntax, generated bundles, incremental type checks, deterministic web build checks, lint, Agent pins, fast root tests, Web unit/SSR tests and exact real-pack auditing, with a time and outcome for each stage.
There is no full verification mode, browser gate or browser dependency; unknown options fail before any stage starts.
Keep new gate checks short and deterministic.
Slow process/SDK/PTY/service-manager tests are not release prerequisites or automatic follow-ups, including when those areas change.
A green gate qualifies only those executed checks, not real-browser interaction, long-running process behavior, paid providers or native Windows/macOS/ConPTY operation.
Older release receipts remain historical evidence, not requirements for future releases.
No passing gate authorizes commit, push, publication, installation, deployment or cleanup of consumer data or retained work.

Build/verification use the single private engineering session scope prescribed in `AGENTS.md`, with `TMPDIR`, `TEMP` and `TMP` set explicitly, outside every Git working copy and on the checkout's disk filesystem rather than a nearly full tmpfs.
Do not use `$HOME/cadence-*.XXXXXX` or a new sibling of the checkout for each check, review or commit.
`scripts/verification-temp.mjs` checks this before `verify` starts any stage using the shared readonly validator in `src/service/run-environment.ts`; it refuses invalid input without creating, redirecting or cleaning directories.
Approved service deliveries already receive the [owner-prepared temporary environment](checks-review.md#automatic-conversation-workflow), so their plans simply name the project check commands; manual engineering supplies its scope as follows on POSIX (Windows uses `%LOCALAPPDATA%/cadence/tmp/`):

```sh
# One scope for the whole engineering session, not one per tool call.
set -eu
umask 077
base="${XDG_CACHE_HOME:-$HOME/.cache}/cadence/tmp"
# Refuse a wrong-disk, Git or aliased cache before creating anything there.
ancestor="$base"
while [ ! -e "$ancestor" ]; do ancestor=$(dirname "$ancestor"); done
node --input-type=module -e 'import { assertTemporaryDirectory } from "./src/service/run-environment.ts"; assertTemporaryDirectory(process.cwd(), process.argv[1], false)' "$ancestor"
mkdir -p -- "$base"
export TMPDIR="$(mktemp -d "$base/engineering.XXXXXXXX")"
export TEMP="$TMPDIR" TMP="$TMPDIR"
node --input-type=module -e 'import { assertVerificationTemp } from "./scripts/verification-temp.mjs"; assertVerificationTemp(process.cwd())'
# Put any necessary logs/reports/packages below $TMPDIR; prefer stdout.
bun run verify
```

Reuse that exact scope across subsequent commands; do not run the allocation block for every tool call.
The scope's creator owns its cleanup, not `verify`: after the final result has been reported and all original commands/children have settled, remove only that exact, still-owned directory if no evidence or deliverable needs retaining.
A verification failure does not authorize immediate deletion; preserve its evidence through diagnosis, then dispose of the session's scratch after resolution rather than accumulating successful-run logs indefinitely.
If work is live, closure is uncertain or a report/package must be retained, leave the scope in the designated container and report its exact path and reason; never sweep old scopes or delete the shared container.
No automatic migration or cleanup of previously scattered directories is implied.
Unit runs point their workers at `cadence-test-run-<pid>` under that root and remove the whole subtree in the vitest globalSetup teardown, so a finished run leaves no fixtures behind; the caller's root is left as found.
It needs a Node with TypeScript type stripping (official builds; a distro Node built without it fails `build:web:check`), but no Chromium.

## Optical presentation observation

`node scripts/qualify-optical.mjs` is an independent, optional observation against the current canonical `web/dist`, **not** a release stage.
It checks the browser build identity and asset digests, serves synthetic public projections on ephemeral loopback and exercises the actual client via a local Chromium DevTools pipe.
No provider, execution command, installation, auth submission or user profile participates.
`OPTICAL_CHROME` may name an already-installed executable.
Use the same private temporary environment as for `verify`.
The script prints the directory containing `summary.json` under that scope: branch, HEAD and canonical browser build identity, viewports, geometry, contrast samples, draw counts, frame windows and paint attribution.
For the design submission, implementation/confirmation and code/tool controls, `controls` records the actual button after scrolling and stable layout: name, four edges and size, viewport, intersections with clipping ancestors, disabled state, center and four inset edge hits.
Enabled buttons must receive visible focus via Tab; disabled ones have no keyboard-operability claim.
No submit or confirmation is activated.
The full-command and requested-write copies use Tab, Space and a write-only receiver inside the disposable document, never the system clipboard.
For the expanded shell card, compare the received string to the multiline command, including its leading spaces, tab and trailing newline, not the card summary or output.
`searchNavigation` exercises two allowlisted literal queries against actual byte offsets in a synthetic retained field.
Check the focused combobox, its controlled listbox and selected option across continuation, continued typing and real arrow keys; the probe must not scroll the options.
Measure the solid stroke on both adjacent screenshot surfaces, and compare the Enter destination's cursor, marked text and byte range to the active hit.
`fieldFind` includes localized no-language fence captions, real prose and folded code with the same words, and a generated gutter before the 1000th genuine match.
`toolCards` binds a disclosure to one synthetic route, tool name and target path, waits for a stable hit-tested button, then activates the folded head once with real pointer input.
It records the event targets, before/after disclosure states and completed conversation-step read coordinates/result category, not the detail payload.
The requested edit must contain both `opal` and `silver` inside that same card; both compositor word samples must reach 4.5:1 at each viewport/theme, independently of the artifact diff.
`copyIndicators` measures a straight SVG stroke against the adjacent material with the pointer outside and no hover/focus, then the visible Tab outline for the same control; missing samples or ratios below 3:1 fail.
The `expand` conversation does not stream: its folded head is already reachable both at the bottom and after wheeling up past 80px.
Before activation and after real detail growth and stable frames, record the pane's scrollTop, client/scroll heights, bottom distance and first fully visible reading block/offset, without any corrective scrolling or focus between samples.
Check Latest only after the up-scroll comparison: shorten the viewport after the click to distinguish resumed follow from a one-time jump.
Incremental follow remains a separate observation.
A missing browser, unavailable draw scenario or failed observation is not a pass.

### Earlier optical build (historical observation)

On branch `cadence/git-worktree-cadence-spatial-optical-craft-webui-b4181761-740f-4805-8c68-3d948841cbe3`, candidate build `6b29c6567c5d9ffc3ae9829bfc77103018dad4f4330acf0a9ea22e59ae3cabc3` was observed before the owner's delivery commit (base `f625cfc1a85e2ee2453bdcdd5836ffe364bd8c06`).
Headless Chrome 151.0.7922.34, Linux, ANGLE Vulkan/SwiftShader, DPR 1; **software** WebGL, not physical GPU or phone qualification.
Both schemes at 320×820, 390×820 and 1440×900: 125 scene observations including the additional forced-colors login, 133 hit-tested control centers and 11,078 text/background samples.
The matrix opened both Heroes, directory/service/model/overflow and path menus, compact drawers, file preview, long Markdown and its code controls, lazy tool output, lightbox, design, plan, assignments, history trace and retained artifact/diff, plus initial and invalid native password forms.
At the three widths the chat row measured 278/348/790px; its scrolling viewport had client/scroll widths of 310/310, 380/380 and 1170/1170px.
The code's 2147px scroll width stayed inside 276/346/788px clients.
At 320px the navigation and inspector opener centers were (21,21) and (299,21); Escape returned navigation focus.
No synthetic Send or approval was used.

Contrast used computed foregrounds against samples of the composited material under visible text with glyph ink temporarily removed; indicators were sampled on the unmodified capture.
These are sampled points, not every possible background pixel.
Worst small text: dark history time `#8a93a2` on RGB(32,33,37), **5.19:1**; light artifact line number `#5e6675` on RGB(233,234,238), **4.81:1**.
Lowest sampled indicator/focus was 5.87:1 (light composer).
Observations prompted repairs to placeholder and hovered artifact contrast, parked drawer geometry, trace tab wrapping and the connection strip.
In particular, a filtered footer sometimes lost its connection dot during compositor captures; the translucent strip no longer blurs the surface behind it.

Same 1440×900 viewport/content, 2.6s windows in on/off/off/on order per scenario. p50 was 16.7ms throughout; p95 values below are milliseconds for individual rounds, not cross-device guarantees.

| Scene               | On p95      | Off p95     | Frames over 50ms                     | Main-thread paint attribution                                                         |
| ------------------- | ----------- | ----------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| Empty idle          | 16.8 / 16.8 | 16.8 / 33.4 | 1/126 in first on round, otherwise 0 | No repeating text paints; occasional document/menu or footer paint                    |
| Scroll              | 16.7 / 16.8 | 16.8 / 16.8 | 0                                    | Document, Latest, occasional menu                                                     |
| Incremental reading | 16.8 / 16.7 | 16.8 / 16.7 | 0                                    | Transcript wrapper, text/code, document and footer on read updates in both conditions |

The single long idle frame did not repeat.
The 480×300 Hero buffer drew 25 times in a separate 1.25s window, zero with reduced motion, disabled or after context loss.
The restored context drew 25 times; an actually hidden tab had no draws in 1s.
Scrolling and incremental reading had zero ambient draws.
Growth followed the bottom, up-scroll held its position and Latest returned to the end.
DevTools Paint node IDs describe paint roots, not exact glyph rasterization or compositor/GPU energy.
No deployment, real credentials, live model workloads, device battery life, physical mobile browser or hardware GPU was tested.

### First review repair (historical pre-commit observation)

The earlier 125 scenes above do not qualify these repairs.
In the same integration worktree and branch, rebuilt WebUI `8caaa40ee1f40c9ed407552bd64b3c01a21438b887e8837b2f46d77ffdb48da0` was observed over pre-commit HEAD `29b90eacafe5de09aee55af568e904f93f481b63` (`optical-evidence-AoCIa6/summary.json` under the run's temporary root).
This identifies the measured bytes, not an accepted delivery commit.
The later owner check on `c587ef71` stopped at light/390px without observing the edit: 111 scenes, no performance windows (`optical-evidence-VNyPN2`).
The following *earlier* measurements do not override that failed check.
Headless Chrome 151.0.7922.34, DPR 1, ANGLE/Vulkan SwiftShader; dark and light at 320×820, 390×820 and 1440×900.
The pre-commit report contains 143 scene audits and 13,156 visible text samples, including system light/dark initial and error password forms and the additional forced-colors retry.

- On all six empty-to-failed-first-attempt switches the transcript kept the attempt and its notice without a Hero, at final opacity 0.07 and zero draws in 1.25s.
- All 42 critical button observations retained the full rectangle through viewport and clipping ancestors, passed center and four edge hits and received keyboard focus (all enabled in these samples).
  At 320px the design submit wrapped within x=33–277 (244×57px); implementation and confirmation measured about 140×28 and 166×28px.
  No Send, approval or execution was triggered.
  With only 400 rows displayed, Space on the write-body copy delivered exactly 3,962 characters (407 lines including the final newline) to the controlled receiver in all six cases.
- The chat viewport client/scroll widths matched at 310/380/1170px; the 2147px code line scrolled inside 276/346/788px clients.
  Unknown run and check statuses appeared separately in the header and expandable summary.
  Read start/update/end chips matched their lane blocks: RGB(154,200,183) dark and RGB(56,103,86) light; the independent write swatch differed in both schemes.
- Requested edit, foreground over sampled word background (RGB): dark `opal` (163,200,173) over (40,49,45) **7.287:1**, deleted `silver` (227,166,174) over (54,41,46) **6.827:1**; light `opal` (53,94,74) over (206,213,208) **4.929:1**, deleted `silver` (132,63,80) over (219,206,210) **4.904:1**.
  The lowest sampled ordinary text in each theme was the tool card's language label: dark (138,147,162) over (34,36,41) **5.010:1**; light (94,102,117) over (226,227,231) **4.507:1**.
  Lowest sampled focus/indicator: **5.870:1** (light composer).

At 1440×900, same 2.6s windows in on/off/off/on order: p50 was 16.7ms throughout and no measured frame exceeded 50ms.
Idle p95 was 16.7/33.4/33.4/16.7ms; scroll 16.7/16.7/16.8/16.8ms; increment 16.8/16.7/16.8/16.8ms.
Idle showed occasional document/menu paints; scroll also painted Latest; increment paints included transcript/text/code roots and footer in both conditions, with no reading-scene ambient draws.
Streaming stayed at the bottom, up-scroll held on growth and Latest returned to the end.
The 480×300 Hero buffer drew 26 times in a separate 1.25s window and 25 after context restoration; reduced motion, explicit off and lost context each drew zero, as did the actually hidden tab in 1s.
These are compositor point samples and short local frame windows, not exhaustive contrast or energy measurements; no physical phone, hardware GPU, screen reader, live provider, authentication submission or deployment was tested.

### Detail-follow and copy contrast repair (historical local observation)

On the same branch/worktree, `optical-evidence-rDzygp/summary.json` measured canonical build `8df3ab6e4e89bff7d49dd0b523517560d83d773a9e553e3b8ba8c439c18e9e4e` over pre-commit HEAD `c587ef71a75048652099a09d372e20bed1445892`.
Headless Chrome 151.0.7922.34, DPR 1, SwiftShader; both themes at 320×820, 390×820 and 1440×900, plus the forced-colors password form.
The run recorded 143 scene audits, 13,137 visible text samples and 46 button observations with no reported problems or unavailable scenarios.
This is local evidence on these bytes, not owner acceptance, hardware GPU or physical-device qualification.

- All six requested edit cards expanded on the first activation and rendered the two words after their matching lazy read.
  Dark added/deleted: **7.287/6.827:1**; light: **4.929/4.904:1**.
  A separate intermediate run found dark workflow status text at 4.490:1 over its grained card; the state now has a solid backing and stronger neutral ink.
  The worst final small text was the diff language: **5.010:1** dark (138,147,162 on 34,36,41), **4.507:1** light (94,102,117 on 226,227,231).
- Resting desktop tool-target copy: dark RGB(171,176,183) on (22,23,26), **8.216:1**; light (89,93,101) on (251,251,252), **6.389:1**.
  Shared message copy: dark (170,174,182) on (9,10,13), **8.898:1**; light (87,92,101) on (244,245,247), **6.162:1**.
  Their respective Tab outlines measured 11.568/10.378:1 and 12.776/9.839:1 (dark/light).
- Opening the loading row had exposed a queued programmatic scroll event arriving *after* detail layout, leaving the previously following reader 428px from the end.
  With the clamped follow offset distinguished from reader input, in both themes the detail added 476/451/451px at the three widths and bottom distance remained 0.
  From 144px up, scrollTop stayed at 1357/983/591px respectively and the same visible heading stayed at y=26.03/43.17/15.22px inside the pane; Latest returned to 0 bottom distance and kept it there when the pane became 96px shorter in all six.
- Empty Hero: 480×300, 26 draws in 1.25s and 25 after context restoration; lost, off, reduced and actually hidden each drew zero.
  All six first attempts settled at opacity 0.07 with zero draws.
  At 1440×900 (2.6s, on/off/off/on) p50 was 16.7ms in every window; p95 idle 16.8/33.4/33.4/16.8ms, scroll and increment both 16.8/16.8/16.7/16.8ms.
  No frame exceeded 50ms; scrolling and increments had zero ambient draws.
  Idle paints were occasional document/menu roots; scrolling also painted Latest; increment paints included transcript, text, code and footer in both conditions.
  Paint roots are not glyph rasterization or power measurements; these short windows are not cross-device performance guarantees.

### Selected line, question rail and inline link (local observation)

The `8df3ab6e` observations above did not exercise these three resting states.
In the same integration worktree, `optical-evidence-fLwa2H/summary.json` measured canonical build `542aa77442f9ac57ce9439c236c3ff0955f22959da855a5f7a3b923f83b00462` over pre-commit HEAD `614436087cff7c3cc1d7eb90d45148d5a1c9cc6f`.
Chrome 151.0.7922.34, headless Linux, ANGLE/Vulkan SwiftShader, DPR 1; both themes at 320×820, 390×820 and 1440×900.
The report keeps `readingStates` separate from the 143 general scene audits (13,159 text samples) and the 48 button observations.
A missing target or sample fails independently of the rest of the page.

- **Selected number, all six views:** Click raw artifact line 2, move the pointer away, require `.sel:not(:hover)` and hit-test the digit and adjacent backing inside that line's `.fp-num`.
  Use its foreground over the pixel just left of the digit in the unmodified capture; require ink in the glyph bounds as well.
  An intermediate capture after a page-wide glyph-suppressed audit lacked the desktop digit despite a DOM hit; that capture is not contrast evidence.
  The probe now measures the selection before that audit and clears it for the original unselected scene.
  Dark: RGB(138,147,162) on (27,28,33), **5.488:1**; light: (94,102,117) on (238,239,242), **5.027:1**, at each width.
- **Inline link, all six views:** A settled two-turn branch supplies both the tree and the transcript; its ordinary reply has prose on both sides of the `specimen notes` fragment link.
  With no hover or focus, the actual hit-tested link computed an underline in its text color with automatic thickness.
  Its foreground against the composited material under its text (glyph fill temporarily suppressed) measured **12.776:1** dark, RGB(203,208,216) on (9,10,13), and **9.839:1** light, (57,62,72) on (244,245,247), at each width.
  The link was not followed.
- **Question marks, both desktop views:** With neither hover nor focus in the rail, the current mark was 16px wide and the noncurrent one 10px; only the marks were visible.
  In a single unmodified capture the noncurrent center (1427,399) against the material above it (1427,395) measured **6.387:1** dark, RGB(138,147,162) on (9,10,13), and **5.298:1** light, (94,102,117) on (244,245,247).
  Tab reached the current mark, then ArrowUp moved focus to the other mark; each visible outline measured **12.776:1** dark and **9.839:1** light, the same RGB pairs as the prose link.
  At 320 and 390px the rail was present but `display:none` as designed; no narrow rail contrast is claimed.

No problem or unavailable scenario was recorded in that local report.
The lowest general small-text sample remained the diff language label (5.010:1 dark, 4.507:1 light).
At 1440×900 all twelve 2.6s windows had p50 16.7ms; p95 in on/off/off/on order: idle 16.8/16.7/16.7/16.8ms, scroll 16.7/16.8/16.7/16.7ms, increment 16.7ms throughout.
One idle-off window had 1/153 intervals over 50ms (0.65%); all other windows had none.
Idle paints involved document/menu and occasional footer; scroll also painted Latest; incremental reads painted transcript, text and code roots in both conditions with zero ambient draws.
These are compositor samples and short frame windows, not exhaustive pixel coverage, glyph rasterization traces, hardware GPU or physical-device qualification, or the owner's final verification and review.

### Pending directory reads, shared Markdown links and side-specific drags

On the same branch and integration worktree, `optical-evidence-Bzwn1S/summary.json` under the run's temporary root records canonical build `c08d220b1839b13414298c2f9d22b9d87455e852787dae2369a2236457d76258` over pre-commit HEAD `bbd1e5198b9da1701689fb477320a40d3d6fe988`.
The installed headless Chrome 151.0.7922.34 (Linux, ANGLE/Vulkan SwiftShader, DPR 1) rendered synthetic data in both themes at 320×820, 390×820 and 1440×900.
Evidence for these repairs is in **6 `directoryReads`, 18 prose-link `readingStates`, and 26 `drawerGestures`** from this build, not the earlier 143-scene audit.

- **Directory:** A pointer click requested `/optical/specimen/facets`; the fixture held that response until each still-enabled `Parent folder` and `facets` label was hit-tested away from hover on the previous listing.
  The list had `aria-busy="true"` and a reading notice; Open was disabled.
  Each label gave three text samples per view, dark **5.610:1** (RGB 138,147,162 on 25,26,30), light **5.589:1** (94,102,117 on 251,251,252), at all three widths.
  Releasing the matching read displayed the child path and its `quartz` entry, cleared busy and enabled Open; dismissing without selection left Send disabled.
  No Open or Send was activated.
- **Links:** The ordinary reply, the visible PlanCard prose and the retained artifact switched to Safe Markdown each contained an inline fragment link between words.
  The pointer was parked; the hit-tested label was neither hovered nor focused and computed a solid, automatic-thickness underline in its text color.
  Worst dark/light text ratios across the three widths: chat **12.776/9.839**, plan **10.997/10.025**, artifact **11.448/10.378**.
  For the plan minima (320px), the actual dark/light materials were RGB(27,28,31)/(247,247,248); for the artifact minima (desktop dark, all light), (23,24,28)/(251,251,252).
  Foregrounds were (203,208,216) dark and (57,62,72) light, measured against compositor backings with glyph fill suppressed, not anti-aliased stroke measurements.
  No link was followed and neither design nor implementation was submitted.
- **Touch:** CDP touch input on the actual selected-project shell held each horizontal drag beyond the 320ms flick window.
  At 320px the measured left/right widths were **275.19/294.39px**; a 168px inward drag gave transforms **−120.96/+141.12px** and scrim opacities **.581/.543**; releasing opened, cancelling the same pull stayed closed.
  At 390px the respective widths were **300/358.80px**, transforms **−147/+208.74px**, opacities **.533/.446**, with the same outcomes.
  A 245px outward push closed both sides at each width, held at transforms −245/+245px and opacities .152/.207 (320px) and .222/.350 (390px).
  The distinguishing **390px right-edge 138px** pull held at **+238.74px** with **.3663** scrim progress after 766/765ms (dark/light) and stayed closed: below 40% of its own 105% travel, despite exceeding the left drawer's 126px threshold.
  After each end/cancel the expanded and inert states, scrim and box matched the result; no dragging class or inline override remained.

The same report completed the general scene and control observations with no reported problem or unavailable scenario.
In the twelve 2.6s desktop windows p50 was 16.7ms throughout; p95 (on/off/off/on) was 16.8/33.4/33.4/16.8ms idle, 16.8ms throughout scrolling and 16.7/16.7/16.8/16.8ms during incremental reads; no interval exceeded 50ms.
Only idle-on windows drew ambient frames; scroll painted document/Latest and incremental reads painted text, code, transcript and footer roots in both conditions.
These are local compositor samples and emulated touch viewports, not exhaustive pixel coverage, physical phones, system edge-gesture arbitration, hardware-GPU timings or the owner's post-commit checks and review.

### Split-control focus, folded field matches and paragraph leading

The `c08d220b` matrix above is historical: it did not Tab to the sashes or the live reply actions, navigate inside folded code on a field page, or measure cross-view paragraph leading.
In the same integration worktree, `optical-evidence-TXq5lF/summary.json` under the run's temporary root records canonical build `f128824387407e238891e67fd7a9204b46c6987a09abfe148f80443e88126283` over pre-commit HEAD `e86f4794c26de22c71190ba007516bd9582f76a1`.
Headless Chrome 151.0.7922.34, Linux, ANGLE/Vulkan SwiftShader, DPR 1, a fresh profile and readonly synthetic responses; both themes at 320×820, 390×820 and 1440×900.
These are worker observations of those bytes, not the owner's final checks or independent review.

- **Desktop Tab focus (`controlFocus`, eight controls):** Both panes were open.
  Tab reached the range inputs, then an actual draft typed in the independent `live-input` conversation exposed Queue and Steer beside Stop.
  The next Tab from Queue reached Steer; the draft remained unsent.
  The sashes occupied x=257–263 and 1077–1083, y=50–878.
  At three heights the probe sampled the 2px solid focus stroke against the material on *each* side.
  Queue and Steer occupied x=952–986 and 986–1020, y=824–856, fully inside the pill's x=952–1020 clip.
  Each ring was sampled at four side midpoints against the adjacent material inside that same button, not against the outer composer outline.
  `controlFocus` records sample coordinates, control and ancestor clip rectangles, edge hits and the worst ink/backing pair.
  Missing samples, clipped controls or contrast below 3:1 fail.
  Worst screenshot RGB pairs (ink on adjacent backing) in left/right/Queue/Steer order:
  - Dark: 203,208,216 on 8,9,12 (**12.850:1**); 203,208,216 on 83,86,96 (**4.726:1**); 203,208,216 on 20,21,25 (**11.775:1**); 29,30,34 on 194,199,207 (**9.805:1**).
  - Light: 57,62,72 on 229,230,232 (**8.594:1**); 57,62,72 on 168,172,181 (**4.719:1**); 57,62,72 on 251,251,252 (**10.378:1**); 245,245,245 on 65,70,79 (**8.701:1**).
  - During repair a capture had an empty composer despite a DOM hit.
    Removing its backdrop filter only when the split appeared still produced a blank layer in a light-theme run.
  The running reply now keeps the same unfiltered material before and after typing.
- **Field find (`fieldFind`, six viewports/themes):** On the retained detail page, both disclosures were closed before the case-sensitive search for `FacetSpotZircon`.
  Next opened only the matching block.
  After changing the query to `FacetSpot`, folding the target again and pressing Enter also revealed it.
  Shift+Enter and Previous reached the overview, appendix and folded target in reverse; the other block stayed closed.
  The active Highlight Range had to name the expected text at its actual offset, fit completely inside the viewport and all clipping ancestors, and pass a center hit test without test-side scroll correction.
  At 320/390/1440px the unique hit scrolled the long line horizontally by **2687/2617/2175px** and the tab vertically by **845/777/542px** in each theme.
  Query and raw/Markdown changes cleared the active highlight; moving to the next field page and unmounting for the context view left no stale highlight.
- **Reading (`leading`, 30 visible paragraphs):** At all six theme/width combinations the computed line-height/font-size (CSS px) was **23.1/14** in chat, the plan and the retained history message, **20.625/12.5** inside the opened complete agreement and **21.45/13** in the Markdown artifact preview.
  Each ratio is **1.65** (per-sample tolerance 1/64px in line-height).
  No measurements were inferred from wrappers or closed details.

The same run retained the 143 general scene audits and 12 desktop frame windows with no reported failure or unavailable scenario.
Lowest general small-text contrast remained the requested diff language label: dark 5.010:1 and light 4.507:1.
At 1440×900 all 2.6s windows had p50 16.7ms and no interval over 50ms; p95 (on/off/off/on) was 16.7/33.4/33.4/16.8ms idle, 16.7/16.8/16.7/16.7ms scrolling and 16.8/16.7/16.7/16.7ms incremental reading.
The incremental windows painted transcript, text and code roots with either setting, with no ambient draws; scrolling painted document/Latest.
The 480×300 Hero drew 26 times in 1.25s and 25 after restoration; off, reduced, lost and actually hidden each drew zero.
These compositor samples and short local frame windows do not qualify physical phones, hardware GPUs, live providers or other operating systems.
No send, queue, steer, stop, approval or auth submission was activated.

### Full commands, keyboard search and retained-field boundaries

In the same task worktree, `optical-evidence-p3ohAl/summary.json` under the run's temporary root records canonical build `d55cdc298ca69c272882f1dd9ab956f26fde9bd4f429d805023713deb0544337` over pre-commit HEAD `a775d72b4b0873054f697307b448ef0913639817`.
The following are measurements on those bytes, not results carried forward from `f1288243`.
The installed headless Chrome 151.0.7922.34 used a fresh profile, Linux ANGLE/Vulkan SwiftShader and DPR 1 in dark and light at 320×820, 390×820 and 1440×900.

- **Full command:** In all six views the lazy `bash` card opened and displayed the 527-character fixture command.
  `Copy command` received Tab focus, its center and four inner edges were reachable, and Space delivered exactly one unchanged string to the document-local receiver.
  The 34.5×28 CSS-pixel button was entirely inside the clip at x=244.5–279, 314.5–349 and 1190.5–1225 respectively.
  Neither a shell nor the platform clipboard was used.
- **Global search:** Escape restored the opener.
  Continuing from 24 hits to the next 12 retired the old active ID; typing in the still-focused input started a fresh query.
  ArrowDown reached the initially offscreen `Recorded layer 17.`; ArrowUp returned to `Recorded layer 2.`.
  Neither the document nor dialog scrolled.
  Enter opened that field's exact v1 cursor and highlighted bytes **[93, 107)**, not the first occurrence of the same query.
  At 320/390/1440px the result pane's vertical clip was y=176.31–627.31 / 176.31–627.31 / 260.27–755.27; its scrollTop at hit 17 was **1342 / 1078 / 754**, and at hit 2 **189 / 174 / 142**.
  All sampled active rows fit the measured clipping intersections.
  The worst stroke ratios against the **row / dialog** were **7.319 / 8.055** dark (RGB 173,182,197 on 37,39,43 / 30,31,35) and **5.882 / 6.543** light (82,89,100 on 234,234,236 / 246,246,247).
- **Find in field:** English `Code` and Chinese `代码` present only in a code caption each produced zero highlights and disabled both navigation buttons.
  On the page with genuine matches each produced exactly two ranges, one in prose and one inside folded code.
  The gutter-only digit `2` had no range; the `1` search reached `Final 1.` as the 1000th real match.
  The existing folded reveal, case, horizontal scroll, backward/forward, raw-page and cleanup assertions also ran.

The same report completed all 143 general scene audits and 12 desktop timing windows with no reported problem or unavailable scenario.
The lowest small-text ratio was the diff language label, 5.010 dark and 4.507 light.
The 480×300 Hero drew 25 times in 1.25s, 25 after restoration and zero while lost, hidden, disabled or under reduced motion.
All 2.6s windows had p50 16.7ms and no interval over 50ms.
In on/off/off/on order, p95 was 16.7/16.7/16.8/16.7ms idle, 16.7/16.8/16.8/16.7ms scrolling and 16.7ms throughout incremental reading.
Only idle-on drew ambient frames.
Main-thread paints included document/menu at idle, Latest while scrolling and transcript, code, message text and footer during increments with either setting.
During probe repair, end-follow had moved the expanded agreement paragraph offscreen; the typography probe now wheels away from the end before positioning and hit-testing that paragraph, independently of the unassisted search and follow tests.
A pre-final headless run also did not observe the original tab becoming hidden after a fixed delay; the probe now foregrounds the measured tab before activating another tab and measures only after observing `document.hidden`.
These are local compositor samples and short synthetic observations, not screen-reader, physical-phone, hardware-GPU, live-provider or post-commit acceptance evidence.

### Current panel, disabled models and artifact page find

`optical-evidence-phDbdI/summary.json` under the run temporary root records canonical build `e5f7f324cbf7b92c8d46690529d003fa0d939861fe7564ecaf59f1a8a30da425` over pre-commit HEAD `d71252a5589fec3a49221dfa1c40aae761bc105f` on the same task branch and integration worktree.
These are new observations, not the results for `d55cdc29` above.
The installed Chrome 151.0.7922.34 used a fresh profile, synthetic loopback data and Linux ANGLE/Vulkan SwiftShader at DPR 1, in both themes at 320×820, 390×820 and 1440×900.

- **Current page (`panelTabs`, 150 samples of tab state):** Folder setup displayed the static current Files label.
  In chat the selectable pages were Files and Branches; in history they were Files and History details, with contents/checks/changes/reviews inside Inspector.
  For each button, Tab or Shift+Tab focused the inactive target and Space selected it without moving its box.
  The underline remained exclusive to the current page both after focus left and with the pointer over its neighbor; keyboard focus had its own outline.
  All measured boxes fit their clipping ancestors and the viewport, with center and four inset edge hits.
  Worst underline on tab / wing: dark **10.977 / 11.775:1** (RGB 203,208,216 on 27,28,33 / 20,21,25); light **9.335 / 10.289:1** (57,62,72 on 238,239,242 / 250,250,251).
  The separate focus sample reached at least **10.874:1** dark and **9.335:1** light.
  An earlier 320px run clipped the last Inspector tab: compact padding now puts its full 65.61px box at x=238.80–304.41.
- **Model catalog (`disabledModels`, 24 targeted text captures):** `optical` was selectable; both `quartz` (Credentials unavailable) and `slate` (Not supported) remained native disabled buttons during measurement and were skipped by Tab.
  Each name and each reason had its own nonempty text Range hit test, visible glyph ink and adjacent backing pixel inside the same button on the unmodified compositor capture; ancestor alpha was included (1 in these samples).
  In quartz/slate order, worst name contrast was **15.789/14.952:1** dark (242,244,248 on 25,26,30 / 30,31,35) and **18.278/17.507:1** light (17,19,24 on 253,253,254 / 248,248,249).
  Reason contrast was **5.610/5.552:1** dark (138,147,162 on 25,26,30 / 26,27,31) and **5.686:1** for each light reason (94,102,117 on 253,253,254).
  Earlier captures sometimes contained only the backdrop where focused controls should have been.
  The docked right wing and picker now filter a separate material layer behind their controls; the open picker is not nested inside a filtered composer.
- **Artifact (`artifactFind`, six Inspector → changes → retained detail sessions):** A notice-only phrase, native view option, zoom control, raw gutter digit and selection footer each gave **0/0**, two disabled navigation buttons and no registered ranges.
  Generated image/link notices also gave no hits in Markdown; the retained label `facet 7` remained navigable.
  With the input unchanged, `Captured` yielded **1/1** in the raw line, Markdown heading (despite its ToC copy) and diff line, never the notice.
  Each view/page change cleared the active highlight; Next then activated the exact text in the connected new body with a visible center hit.
  Paging forward found the new added line, Previous returned to the first page, and unmount removed both highlight sets.
  Full-field copy delivered the exact 288 characters from both immutable pages to the document-local receiver.
  Ordinary field pages, folded code revelation, literal case, the 1000-real-range bound and global search navigation ran separately as before.

All 143 general scene audits and 12 desktop timing windows completed without a reported problem or unavailable scene.
The lowest general text ratios were **5.010:1** dark and **4.507:1** light (diff language label).
At 1440×900 all windows had p50 16.7ms and no interval over 50ms; p95 in on/off/off/on order was 16.7/33.4/33.4/16.7ms idle, 16.7/16.7/16.8/16.7ms scrolling and 16.7/16.8/16.8/16.7ms incremental reading.
Incremental reads painted transcript, message and code roots with either setting; scroll paints included Latest.
Only idle-on drew ambient frames in these windows.
The 480×300 Hero drew 25 times in 1.25s and 25 after context restoration; hidden, reduced motion, explicit off and lost context each drew zero.
A preceding run did not observe the page becoming hidden when activating an unrelated target.
The probe now opens a sibling tab from the measured page and requires `document.hidden` before counting background draws.
These short observations do not qualify hardware GPUs, physical phones, live providers or the owner's post-commit checks and independent review.

### Retained turns, composer mode and current navigation rows (historical observation)

`optical-evidence-j679hv/summary.json` in the run temporary root records canonical `bun run build:web` build `fa5f00c6cf357f504baf6e9af9849d482b4d87d30576e681d2e50c9dcb3844da`, over pre-commit HEAD `5aa12a4d795c1e2f4bc516c27281da228921ac70` in the same integration worktree and task branch.
These measurements are from that build: installed Chrome 151.0.7922.34, synthetic loopback fixture, disposable profile, ANGLE/Vulkan SwiftShader, DPR 1.

- **Current activity (`composerFlow`):** At 1440×900 in each theme, a successful thinking observation set `data-flow` and ran one `prism-flow` animation on the input capsule.
  A failed turn read then left the same thinking turn visible: the assistant paragraph still passed a text-range hit test, the unsent draft was unchanged, but the attribute was absent, `::before` reported `animation-name: none` and no flow animation was running.
  A successful tool read restored flow; reduced motion kept the indication static, and restoring motion brought back one animation.
  Waiting, text and settlement showed none, with another positive thinking observation immediately before settlement.
  The separate `chat-timeline` component regression covers paused reads, unavailable/replaced execution attachments and recovery after reconnect; this browser fixture induced a read failure, not an attachment race or live-owner restart.
- **Mode uncertainty:** English and Chinese component tests cross a failed mode read with retained on/armed intent and check the actual composer hint and native disabled button (text, class, accessible name and title).
  An ordinary message does not require an affirmative Cadence observation, and no toggle, design edit or design submission grants implementation approval.
- **Navigation (`selectedRows`):** In both themes at 320×820, 390×820 and 1440×900, the probe opened `reading` then `design`, and `material.ts` then `optics.ts`, using the visible navigation and file controls.
  It reopened compact conversation drawers after selection.
  The solid leading mark moved with `aria-current`; active and inactive controls kept their widths.
  The probe measured each selected row at rest, with the other row hovered, and with the current button keyboard-focused.
  All four file actions remained Tab-reachable and hit-testable without activation.
  Across 72 selection states, three points inside the mark were sampled on unmodified compositor captures and compared separately to the row and wing at the same height (432 comparisons, each required ≥3:1).
  The ink must match the painted stroke, not an outline coordinate.
  The 24 focused states additionally sampled the separate outer outline against the wing.

Worst measured marker ratios by adjacent surface (RGB triplets give **ink on backing**):

| Theme / control     | Marker on row                      | Marker on wing            | Separate focus on wing |
| ------------------- | ---------------------------------- | ------------------------- | ---------------------- |
| Obsidian / session  | 10.782:1 (203,208,216 on 28,30,33) | 11.775:1 (on 20,21,25)    | 11.775:1               |
| Obsidian / file     | 10.380:1 (203,208,216 on 32,33,37) | 11.312:1 (on 25,25,29)    | 11.336:1               |
| Alabaster / session | 9.263:1 (57,62,72 on 238,238,240)  | 10.289:1 (on 250,250,251) | 10.289:1               |
| Alabaster / file    | 8.939:1 (57,62,72 on 234,234,237)  | 9.944:1 (on 246,246,248)  | 9.944:1                |

The lowest selection ratio was the light `material.ts` row at rest at 1440px.
The lowest general text samples across 143 scene audits were the 320px requested-edit language labels: dark **5.010:1**, light **4.507:1**.
The 12 desktop frame windows all had p50 16.7ms and 0% of intervals >50ms.
In on/off/off/on order, p95 was 16.7ms throughout at idle, 16.8/16.8/16.7/16.8ms scrolling and 16.7/16.7/16.8/16.7ms with increments.
Only idle-on drew ambient frames in those windows; scroll paints included Latest and increments painted message, code, transcript and footer with either preference.
The separate 1.25s Hero windows counted 25 draws and 25 after restoration; loss, hidden, reduced motion and explicit off counted zero.
An initial probe left the synthetic project selected before the next folder-first case; row and flow checks now run before the existing disposable-origin last-project cleanup.
That pre-commit run reported no problems or unavailable scenes.
No hardware GPU, physical phone, live provider, actual service restart or post-commit owner review is claimed.

### Project drawer readiness and unavailable mode text

**Interrupted owner observation:** On HEAD `6de7793c3aeccaa3be4dda5bd1d5e005ee8c0761`, build `fa5f00c6cf357f504baf6e9af9849d482b4d87d30576e681d2e50c9dcb3844da` passed `verify`, but `optical-evidence-GGucAw/summary.json` stopped after 119 scene audits.
At light/390px the navigation toggle received a click; the reading row's center was then `(0, 0)`.
The shared welcome markup did not identify which shell received the click.
There were **no performance windows** in this run.
The earlier complete observation above is not its result.

**After repair:** `optical-evidence-CRNq9N/summary.json` under the run's temporary root records canonical build `83cbab9ae8ebb31844976fc76bf65b01dd9f4ec2c85dc43a1adef39bd59d5482`, on the same task branch and integration worktree over pre-commit HEAD `6de7793c`.
Installed Chrome 151.0.7922.34 ran against synthetic loopback reads in a fresh profile, with DPR 1 and ANGLE/Vulkan SwiftShader.
All 143 scene audits completed, with no reported problems or unavailable scenes.

- `rowDrawers` records FolderSetup on the requested `#chat=empty` route while the workbench entry is held.
  After release, all six viewport/theme pairs showed the project header, “New conversation” and the project conversation list before either toggle was used.
  Opening or reopening required the project toggle's expanded state and its non-inert wing (`.open` on compact screens).
  Each pointer selection used a stable, fully intersecting box with a hit-tested center.
  In light/390px the selected `reading` button measured 232 × 34.125px, center `(125, 300.83)` inside the button.
  No shell layout change was necessary for the measured cases.
  The 72 `selectedRows` states cover the two conversations and two files at rest, adjacent hover and keyboard focus.
  The lowest marker-to-row ratio was 8.939:1; each file's four actions were Tab-reached and hit-tested without activation.
- `unknownMode` requires the dedicated conversation's degraded `cadence-conversation` notice **and** its native disabled, neutrally named mode button.
  It measures the button's text node, excluding the switch graphic and composer hint.
  Three points just above the text range sample the capsule through the transparent button.
  Each screenshot must contain glyph ink in the range.
  The report records the worst backing coordinate and RGB, a painted glyph pixel, text bounds and effective opacity (1 throughout).

Worst mode-label contrast by viewport (dark ink RGB 242,244,248; light ink RGB 17,19,24):

| Viewport | Text bounds x/y, w×h (CSS px, rounded) | Dark backing / ratio | Light backing / ratio  |
| -------- | -------------------------------------- | -------------------- | ---------------------- |
| 320×820  | 103.5/681.2, 145.88×17                 | 19,20,24 / 16.715:1  | 252,252,253 / 18.123:1 |
| 390×820  | 103.5/699.2, 145.88×17                 | 19,20,24 / 16.715:1  | 252,252,253 / 18.123:1 |
| 1440×900 | 531.5/831.2, 145.88×17                 | 25,25,29 / 15.917:1  | 247,247,248 / 17.355:1 |

Across the general scene audits, the lowest text ratios were 5.010:1 dark and 4.507:1 light (requested-edit language label).
The first unsaved attempt settled at opacity 0.07 with no ambient draws in each reading window.
At 1440×900 the twelve 2.6s frame windows had p50 16.7ms and 0% of intervals >50ms.
In on/off/off/on order, p95 (ms) was 16.7/33.4/33.4/16.7 at idle, 16.7/16.8/16.7/16.7 scrolling and 16.7/16.8/16.7/16.7 during increments.
Only idle-on drew ambient frames.
Scroll Paint events included Latest; incremental paints included message, code, transcript wrapper and footer with either preference.
End-follow, up-scroll through growth and Latest were observed.
The separate 1.25s windows counted 26 Hero draws, 25 after restoration and zero while hidden, reduced, disabled or context-lost.
These are local browser observations, not hardware GPU, physical phone or live service qualification.

### Current workflow row and pending file preview

`optical-evidence-lfSRRA/summary.json` under the run temporary root records canonical build `01f1bbfb2f85458c45ed26f2b0e3d6b9cfff7c5ceaa501654d340d3e1260a522` over pre-commit HEAD `9293a76c1f3c5c59d058de383cbd78bb6b718479` on the same task branch and integration worktree.
Installed headless Chrome 151.0.7922.34, ANGLE/Vulkan SwiftShader, DPR 1; dark and light system schemes at 320×820, 390×820 and 1440×900.
The measurements below come from this build's **36 `workflowRows` and 12 `filePreviewReads`**, not the preceding build's 143 scene audits.

- **Workflow:** A separate conversation listed the synthetic “Inspect the facet” run with one retained research child.
  Pointer activation of each dock button in turn opened the matching central heading and the run card or child's recorded result.
  On compact screens each selection dismissed the navigation drawer; measurements waited for it to reopen.
  The only `aria-current` button carried the solid leading rule, without a change in width or height.
  Each rest, adjacent-hover and keyboard state sampled three points on the painted rule against both the row and the wing (216 comparisons); the 12 keyboard states also sampled the outer ring independently.
  The rule was not measured at the step's status dot.
- **File preview:** The loopback fixture held the next `file` response for the clicked path, first `material.ts`, then `optics.ts`.
  With the matching header present and no old code, the screenshot contained glyph ink for “Reading…” inside the preview's status paragraph.
  The text ratio used its effective foreground against the painted backing just above the glyph range.
  The 22×22px close button passed center and inset-edge hit tests and received visible Tab focus before release.
  After release the status disappeared and the code line matched the file, including on switching paths.
  A further held refresh of `optics.ts` showed both its retained line and the status; releasing it after `material.ts` had settled did not replace the new preview.

Worst contrasts in these observations (RGB triplets are foreground on backing; ratios are rounded):

| Theme     | Marker on selected row             | Marker on wing | Focus ring on wing | Pending preview text                |
| --------- | ---------------------------------- | -------------- | ------------------ | ----------------------------------- |
| Obsidian  | 10.782:1 (203,208,216 on 28,30,33) | 11.775:1       | 11.775:1           | 5.887:1 (138,147,162 on 20,21,25)   |
| Alabaster | 9.263:1 (57,62,72 on 238,238,240)  | 10.289:1       | 10.289:1           | 5.541:1 (94,102,117 on 250,250,251) |

Separately, this run completed its 143 general scene audits (lowest text: dark 5.010:1, light 4.507:1) and 12 desktop frame windows without a reported problem or unavailable scene.
At idle, scrolling and incrementing, p50 was 16.7ms throughout, with no interval over 50ms.
In on/off/off/on order, p95 (ms) was 16.8/16.7/33.4/16.7 at idle, 16.7/16.8/16.8/16.7 scrolling and 16.7/16.8/16.8/16.8 during increments.
Only idle-on drew ambient frames; scrolling painted Latest and increments painted message/code and transcript content with either preference.
The separate Hero windows counted 26 draws and 25 after restoration; loss, reduced motion, explicit off and hidden counted zero.
These were English browser observations on a fresh profile and synthetic readonly service, not live workflow execution, physical-device, hardware GPU or screen-reader qualification.
The Chinese loading text, error and empty-file branches are component regressions, not additional browser scenes.

### Panel focus departure and the reply clock

**Interrupted owner check:** `optical-evidence-RDBrS3/summary.json` on HEAD `c493e9db` (build `01f1bbfb…`) stopped at scene 129, before the performance and draw windows.
At 1440×900 in Alabaster, Branches remained selected after focus returned to Files, and its full button hit-tested; the worst stroke pixel and both reported backings were RGB (252,252,253), **1:1**.
Even the sampled tab face was indistinguishable from the rail; that capture retained per-surface minima, not all pixels or proof of label ink.
In a fixed eight-sequence replay of the same focus path on the old build (`optical-evidence-Nxycdw`), the 2px stroke covered x=1175.67–1254.81, y=80–82, including the original sample positions.
The replay captured the label ink, selected face and stroke (9.335:1 on the tab); it did **not** reproduce the missing paint or invalidate the owner's failed frame.
For the label backing use the gap beside its text range, not the keyboard outline above it (`optical-evidence-oqwI3O` sampled the latter).

**After repair:** `optical-evidence-xedVN2/summary.json` under the run temporary root identifies canonical build `62245e12a29342e782b9fb1d48c65c1110e625ff7d08e6ce91a0d173e083a360`, over `c493e9db` in the same integration worktree and task branch.
The desktop toolbar now sits above, not over, the filtered wing body.
Installed headless Chrome 151.0.7922.34, disposable profile, synthetic loopback data, ANGLE/Vulkan SwiftShader, DPR 1; both system schemes at 320×820, 390×820 and 1440×900.
This run completed 143 general scene audits, 150 tab states and all 12 performance windows; no problems or unavailable scenarios reported by the script.

- **Selection:** `panelTabs` records ARIA, stroke bounds, label ink, button/clip rectangles and all 1,548 screenshot comparisons (including the separate focus indicator).
  On the light desktop, with Files focused (`aria-pressed=false`) and Branches selected (`true`), its center and four inset edges hit and the label painted at (1199,66).
  The stroke at y=81 was RGB (57,62,72), 9.335:1 on the face (238,239,242), 10.289:1 on the rail, 10.468:1 on the glass below; label 16.161:1.
  Across viewports after focus departure, worst stroke on face / wing was 9.335 / 10.289 in Alabaster and 10.977 / 11.775 in Obsidian; adjacent hover did not erase the indicator.
  The separately sampled keyboard outline reached at least 9.335:1 light and 10.874:1 dark.
  Failed contrast or missing ink remains a hard failure even when the probe continues to independent scenes.
- **Activity:** `composerFlow` observed the real footer in both desktop schemes: live thinking `Working 1:16`; refused turn read, “Conversation activity unavailable.” with neither working item nor duration; successful reread, `Working 1:18` from the original start.
  Waiting and streaming text still showed Working without composer flow; settlement removed Working without showing the unavailable notice.
  The same retained assistant paragraph remained hit-test readable and the unsent draft unchanged through every stage.
- **Reading and controls:** Lowest general text sample was the edit language caption: 4.507:1 light (94,102,117 on 226,227,231), 5.010:1 dark (138,147,162 on 34,36,41).
  At 320 / 390 / 1440px the long message was 278 / 348 / 790px wide; the code scrolled 2147px inside 276 / 346 / 788px clients, without a page-wide horizontal scroll.
  `controls` records 72 measurements including Confirm implementation (165.9×28px at all three widths, center and four inset edges hit, Tab reachable; not activated).
  Increments followed the bottom, growth preserved an up-scrolled position, and Latest resumed follow after expansion and resize.

At 1440×900 in Obsidian, 2.6s frame windows in **on / off / off / on** order (times in ms, rounded):

| Scenario  | p50                 | p95                 | Frames >50ms | Ambient draws |
| --------- | ------------------- | ------------------- | ------------ | ------------- |
| Idle Hero | 16.7/16.7/16.7/16.7 | 16.8/16.7/16.8/16.8 | 0% in each   | 52/0/0/52     |
| Scroll    | 16.7/16.7/16.7/16.7 | 16.7/16.8/16.7/16.8 | 0% in each   | 0/0/0/0       |
| Increment | 16.7/16.7/16.7/16.7 | 16.8/16.8/16.8/16.8 | 0% in each   | 0/0/0/0       |

Idle Paint roots were document/menu/footer or none; scrolling painted Latest, not transcript text; increments painted the transcript wrapper, message, code and footer with either preference.
The Hero used a 480×300 buffer and drew 25 times in 1.25s; hidden, reduced, disabled and context-lost windows counted zero, and each corresponding foreground, motion, switch or context restoration counted 25.
All six unsaved-attempt transitions settled at opacity 0.07 with zero reading draws.
These are local compositor samples and main-thread Paint roots, not per-glyph raster traces, power measurements, hardware GPU, physical phone, screen reader or live owner/provider qualification.
They do not substitute for the owner's candidate checks or review.

## Development practice

Read affected source and adjacent tests, identify the actual owner of a contract, then make the smallest coherent change.
Use ordinary source editing and directly affected fast tests while developing; run `verify` once at a stable integration boundary or before release, not after every local edit.
`test`, `test:target` and `test:service` default to excluding the `slow` tag; `verify` also avoids importing whole files tagged `slow`.
Test workers load `test/no-fsync.mjs`, which makes fsync a no-op inside them (spawned owners and CLIs still flush): crash tests kill processes and no test simulates power loss.
A root test is tagged `slow` (`{ tags: ["slow"] }`, or `// @module-tag slow` as a whole file's first line) when it takes about 0.4 s or more alone, usually because it starts real owners, SDK workers, CLIs or crash children; short process tests stay untagged.
Retained slow tests are for explicitly requested, file-targeted diagnosis only, using `node node_modules/vitest/vitest.mjs run test/<file>.test.ts --tags-filter=slow`; do not run them as another suite or imply they passed with `verify`.
The real systemd diagnostic additionally requires `CADENCE_SYSTEMD_E2E=1` and a running user manager; it uses and removes a temporary unit under `$XDG_RUNTIME_DIR/systemd/user`, never a production service.

Use the external private temp root described above for targeted tests too.
Development may explicitly link already installed matching dependencies rather than copy/install them; `node_modules` links are ignored and Vite preserves their logical module paths, while the unchanged notice audit verifies all module bytes and membership.
This is not implicit dependency setup for consumer workflows.
A checkout-local `.cache` root makes non-Git fixtures inherit the checkout and triggers `Private state home must be outside the working copy`; this is an invalid test environment, not evidence that unrelated features broke.
A nearly full tmpfs `/tmp` makes owners refuse at their free-space floor (`receipt-inconclusive`) and `web/dist` publication fail with EXDEV.
Delivery workers and checks use the inherited owner-prepared temporary root; they do not create, relocate or clean it, invent owner markers or treat its expected existence as a conflict.
Historical explicitly declared setup resources keep their original meaning, not a prerequisite for a new run.
Keep prior evidence during diagnosis inside the same session scope; each targeted Vitest JSON report uses a new filename.
Final session disposal follows the ownership rules above.
A marker is required only when the approved setup actually created and declared one; per-command temporary directories are not evidence of a missing shared run resource.
Before a targeted run, assert that every named test file exists; afterward require a matching `testResults` entry for every exact path and at least one `assertionResults` item with `status: "passed"` in each file, with no failed tests/files.
Missing files, omitted files and files containing only skipped/todo cases fail coverage even if Vitest exits zero.
This targeted coverage check is not a substitute for the sole integration gate or independent automatic Agent review.
Use fabricated credentials, isolated homes/state and local fixtures; never personal credentials, automatic downloads or unknown process cleanup.
Fast CLI tests use the real management entrypoint with a controlled `AutostartSystem`: changing HOME alone does not isolate the inherited cgroup or service manager.
Keep in-service refusal coverage without touching the enclosing service.
Socket fixtures bind a short relative name in an isolated child's cwd and test the resulting real inode through its long absolute path; they neither constrain the owner's temporary-root length nor create fallback directories.
Git ownership fixtures must select their own system configuration as well as an isolated home: hosted runner images can set system-wide `safe.directory = *`, which changing `HOME` does not remove.
`project-start` supplies that fixture-only configuration inside its Git shim, after the production environment sanitizer, and separately proves root refusal under user and system wildcard trust without modifying host configuration.
A DIRECT process-test environment has all routing variables absent, including `NO_PROXY`/`no_proxy`; wildcard bypass variables are unsupported, not a way to request direct access.
The `cadence-mode`, `history-shell`, `startup-card` and `agent-panel-cadence` fake terminal fixtures explicitly clear an inherited `CADENCE_SUBAGENT_CHILD` for their external-Pi scenario and restore it afterward; child-refusal cases set it themselves.
Production workers and checks retain the guard, including when they run verification.
A test waits for the event it needs, not a wall-clock guess; fixed waits stay only where time is the contract.
Outer command budgets must cover the selected tests; existing SDK20s/child15s and PTY90s/interaction15s fixture budgets are not increased to obtain green.

Preserve failed attempts until diagnosis is resolved; correct a demonstrated cause before rerunning, and never assign old failures a retrospective cause without evidence.
Do not recreate the removed project workflow integration unless explicitly requested.
Removing development tooling must never delete consumer `.cadence` data or private service state.

## Regression owners

This index includes retained slow diagnostics; their presence does not add them to the gate.
The release gate does not launch a browser.
The separate optical observation below does not turn unit tests into browser evidence.

- `cadence-mode`, `cadence-mode-pty`, `workflow-contract`, `service-workflow`: persistent conversation activation/exit/branch restoration, actual Pi POSIX TUI/on-demand-owner flow, conversation-bound models/defaults, exact plan approval, DAG validation, real SDK worktrees/checks/local integration and cancellation.
- `service-conversation-workflow`, `test/web/workflow.test.tsx`: actual SDK dialogue tools, persistent mode/model restoration, caller-bound single admission, exit/cancel separation, browser-only approval/local merge and lost-reply observation.
- `plan-revalidation`, `test/web/plan-revalidation.test.tsx`: unchanged-plan recovery across owner/model lifetimes using real proposal/control/context persistence with stand-in model sources and settled-turn facts; captured startup intent, explicit validation without Send/grant/worker, immutable prior snapshots, fresh confirmation, changed context refusal, no model substitution, lost-response/departure handling and English/Chinese recovery cards.
  `plan-revalidation` and `workflow-admission` also check pre-admission effect-free refusals, recording before grant consumption/work registration, receipt lookup without repeated recording and retirement of both grant layers.
  Controlled state/SSR tests are not real-browser or provider qualification.
- `workflow-contract`, `workbench-cadence-control`, `workflow-research`: the coordinator's tool input and research outcomes.
  `workflow-contract` holds the schema that states no bound, the completed plan input and one named refusal per field; `workbench-cadence-control` the browser's refusals (the reported step id in place of an investigation identity, never the word oversize), the unchanged-plan instruction and the per-question research result; `workflow-research` runs the owner against a stand-in worker launch for the single second asking, recording under both identities as each answer settles, the run that completes with what is missing and the one that fails with no answer.
  The stand-in launch is not an SDK worker or a provider; `lightweight-sdk`'s mocked worker body covers the provider's reason on the failure diagnostic, redacted with the worker's credential.
- `workflow-controller`, `workflow-delivery`, `workflow-verification`, `workflow-recovery-regressions`, `workflow-source-identity`, `workflow-step-pages`, `project-knowledge`, `project-knowledge-bounds`: service-owned recovery without user Send, no attempt quota, actual failed-step references retained across repair failures, explicit target/candidate/worktree setup placement, rephrased no-progress detection, automatic replan labelling for concrete scope/route changes, fixed permission boundaries, partial-work handoff, verified knowledge updates, fresh context and non-evicting step pages.
- `run-environment`, `workflow-recovery-regressions`, `workflow-lifecycle`, `lightweight-process-diff`, `workflow-admission`: owned temporary roots in one designated pool, no HOME/workspace-parent fallback, shared verification rules, no inherited-variable dependency, same-workspace reuse and cross-workspace isolation, intent-before-create, ownership-safe cleanup and retained uncertainty.
  The owner tests join controlled original work and cleanup before releasing the gate, keep cleanup checkpoints nonterminal, handle Cancel/Stop/quarantine arriving during cleanup, preserve confirmed removals on restart and retain final deviation notices.
  Worker-boundary tests carry a complete context-limit agreement alongside long escaped checkout and temporary paths with shared or separate prefixes, including a detached assignment's relative combined-candidate location, without enlarging either field; scratch names its inherited variable rather than duplicating its absolute path.
  Launcher tests observe the actual spawn environment with controlled handles, while a short real shell check covers an absent inherited `TMPDIR`.
  Proposal preparation and research allocate nothing; an old runtime policy cannot authorize new resources.
  These are not real-provider or native Windows/macOS qualification.
- `task-worktree`, `workflow-delivery-runtime`, `workflow-delivery-admission`, `repository-coordination`, `repository-recovery`, `change-tools`: approved-only named stable candidates, adaptive recovery/knowledge (including baseline repairs that expand the original scope), exact acceptance and repeated owned fast-forwards, changed-target retention, original-operation leases, readonly evidence and recovery.
  The full real admission case remains slow; controlled runtime/recovery tests are not paid-provider or real-owner qualification.
  `workflow-recovery-regressions` covers a detached repair mistaking already-integrated sibling outputs for missing work: changed candidate paths route to a follow-up while unrelated scope additions remain usable, including integration advancing during the comparison; Git precheck refusals retain their reason without fabricating native results.
- `workflow-git`, `workbench-send-admission`: staged-versus-worktree scope, actual commit ancestry, and pre-/post-acceptance error classification without erasing uncertain attempts.
- `pi-sessions`, `service-conversation-pages`, `service-conversation-retention`, `conversation-retirement`, `conversation-records`, `test/web/conversation-reader.test.tsx`: conversations as the project's Pi sessions (directory precedence, incremental and torn-line reads, turns, readable thinking as lazily read steps, the bounded context-size walk, read redaction, lossless parts), a browser turn's file and branches, the branch tree, live-preview counting, incremental large-session identity/continuation, command/entry correlation, current redaction, durable status and unsupported old identities without storage changes.
- `worker-capture`, `pi-sessions`, `conversation-records`, `runtime-timeline`, `test/web/{conversation-reader,chat-timeline,stream-markdown,runtime-observation}.test.tsx`: capture UUID/content-index continuity across empty, thinking-only and tool-only messages, text/thinking/tool/text ordering, batched messages and legitimate repeated bodies; both final-before-marker and marker-before-final with an unmarked Pi tail, cold/reconnected observations and earlier pages.
  Closed activity frames, shared capture bounds, redaction and lazy Pi-only thinking remain enforced; metadata is not a second body store.
  `conversation-records` changes the reader's fabricated secret set after a tool-start without another capture event, then checks raw and decoded activity on repeated reads and tool updates, normal tool names and nameless waiting, earlier-page headers, post-redaction byte/Unicode bounds, unchanged capture/admission/session bytes and identities, and secret-source refusal versus last-known fallback.
  Its full-tool-page regression drives genuine CaptureEmitter/SdkCapture → LiveCapture → ConversationRecords → `decodeWorkbenchResult`, with real arguments/output and capture-legal names: repeated `~xy~` expands only at read time, while `"a".repeat(117) + "~xy~🔧"` exercises an owner learning the secret after the SDK and the old UTF-16 `slice` surrogate split.
  Read the complete page containing the tool, not only `before=1`: both listing and lazy `conversation-step` must decode, agree with the activity name, exclude secrets/isolated surrogates and fit 128 JSON-encoded bytes; over-limit names and unknown public fields still refuse.
  The same cases assert unchanged capture activity sequence, admission/state/index/session bytes, source order and render identity; equal-part output updates change content versions, terminal reads retain final output, both result-final/marker orders survive an unmarked Pi tail, and a new overlay-free cold reader preserves the result (including error results).
  Pi handoff may change read coordinates but not render identity; display-name-only redaction does not change the arguments/output version.
  These fixtures preserve the separate early-page coverage and do not exercise a real browser.
  `pi-sessions` compares unexecuted declarations for `error`, `length`, `aborted` and normal tool-use responses between genuine capture and both linked and unmarked legacy Pi history, retaining assistant state/notice, read identities and unchanged history bytes.
  `conversation-records` drives genuine CaptureEmitter/SdkCapture → LiveCapture with controlled Pi files and `decodeWorkbenchResult`: final-first, marker-first and Pi-written-before-marker observations keep the no-result tool neutral in both listings and details, including running retries, failed/canceled settlement, a new cold reader and earlier-page reads.
  Matching successful and `isError=true` tool results precede that failed/canceled response and keep their independent outcomes and source order; the unexecuted declaration has no tool-start, tool-end or tool-result event, and readonly observations preserve admission/state/index/session bytes.
  `pi-sessions` also owns source tool identity versus display-name boundaries: 126/127/128-byte ASCII, multibyte/surrogate-pair and JSON-escaped names, read-redaction expansion, clipped-prefix/redacted-display collisions, unresolved duplicate IDs, post-result reuse and historical missing-name/ID behavior.
  Linked and unmarked histories keep matching results at their declaration's position with one tool item and the original render identity, output and result-derived state; closed public detail decoding, encoded name bounds, scalar-safe clipping, fabricated-secret exclusion and unchanged Pi bytes guard the private local association index.
  `conversation-records` sends capture-allowed 127/128-byte ASCII tool names through genuine CaptureEmitter/SdkCapture → LiveCapture and controlled Pi files/public decoding, in both final-first and marker-first order for declarations and results, including Pi-written-before-marker reads.
  It checks one tool in text/tool/text source order, stable render IDs, lazy detail state/output/version, same-part updates, reply settlement, overlay-free cold reconnects and earlier pages; over-limit source names stay in Pi-only fixtures rather than weakening capture limits, while capture-legal read-redaction expansion uses the full-tool-page regression above.
  Independent-execution regressions in `worker-capture` cover no declaration, end without start, private-name mismatch, missing source identity, ambiguous ended executions, retired declarations/partials and legal reuse after a result or new user boundary; only a uniquely associated execution without a declaration supplies the marker's result-call identity.
  `pi-sessions` rejects extra fields, invalid or missing UUIDs, wrong roles/parents, duplicate message/result identities (including cross-command/branch collisions) and foreign command/user/run or pre-admission links without changing Pi bytes; it also checks earlier-turn preview suppression with and without the new result-call marker field.
  `conversation-records` drives independent executions with no declaration, end without start, duplicate declarations/IDs (including different names), unstarted declarations and clipped/redacted display collisions through both final-first and marker-first sequences, for successful and error results.
  Assertions cover Pi-written-before-marker observations, one source-positioned result with a stable call render ID, still-unresolved declarations, same-part output/version updates, earlier steps/steered turns, terminal reads and a new cold reader with no live overlay; admission/state/index/session bytes remain unchanged by reads.
  These are deterministic local association/handoff regressions, not real-provider, transport, service-manager or browser-interaction evidence; a passing live-overlay assertion alone cannot qualify the durable reader.
  `test/web/workbench.test.tsx` supplies public items only, with English/Chinese SSR matrices across running and terminal replies: unavailable/canceled declarations say no tool result was observed, while recorded errors remain errors; cards stay folded and details remain lazy.
  Focused reruns are `bun run test:target test/pi-sessions.test.ts test/conversation-records.test.ts` and `bun run test:web test/web/workbench.test.tsx`, with the exact-file/passed-assertion coverage rule above.
  These are controlled capture/private-file/public-decoder fixtures and separate SSR, not a live provider, service-manager or browser-interaction test.
  Reader/detail lifetimes reject mixed pages and late responses, refresh equal-part tool revisions and read reply/workflow terminal snapshots without fetching closed details.
  `test/helpers/runtime-timeline.ts` owns the shared typed event sequence and public DTO expectations, including explicit fixture identities and opaque content-version equality/change tokens; it imports no service implementation, SDK or React.
  `test/runtime-timeline.test.ts` drives genuine CaptureEmitter/SdkCapture through LiveCapture and fabricated command-owned Pi records into decodeWorkbenchResult, asserting the actual projection against that contract.
  `test/web/runtime-observation.test.tsx` supplies the same contract through controlled workbenchRead calls to the real ConversationReader and existing workspace SSR, not prefilled reader state.
  Together these are split, contract-connected tests, not one single-process capture-to-SSR chain: they cover activity, waiting, silent tools, failed reads/recovery, reconnects, folded thinking without streamed bodies/signatures, equal-part tool revisions and separate reply/workflow outcomes.
  The shared `independentTimeline`/`independentResults` contract additionally covers undeclared and ambiguous executions across both marker/final orders and completed/failed/canceled replies; `runtime-timeline` validates it against genuine capture, controlled Pi records and closed public decoding through an unmarked tail, overlay-free cold reads and earlier step pages.
  A second whole execution/result with identical output completes between observations and must remain a separate identity in source order; versions are equality/change tokens, not proof that equal bodies are the same occurrence.
  `test/web/conversation-reader.test.tsx` consumes that same contract through real `ConversationReader` reads, checking pagination, cold reconnects, closed-detail laziness and rejection of same-part stale versions, equal-body wrong identities and retired-conversation replies.
  `test/web/chat-timeline.test.tsx` feeds those reader observations to the actual `ChatWorkspace` → `ChatTurnView` → `ToolStep` path with controlled hooks: an opened independent tool keeps its keyed state and old displayed output during updates/handoff/final reads, unrelated declarations/results stay folded, earlier history preserves the key, and obsolete requests cannot replace current output.
  These backend and Web consumers are separate controlled fixtures, not one capture-to-mounted-browser test; key-addressed hook cells do not exercise React DOM reconciliation, real focus/scrolling or viewport layout.
  Focused independent-result reruns are `bun run test:target test/worker-capture.test.ts test/pi-sessions.test.ts test/conversation-records.test.ts test/runtime-timeline.test.ts` and `bun run test:web test/web/conversation-reader.test.tsx test/web/chat-timeline.test.tsx`; apply the exact-file/passed-assertion coverage rule above, not just a zero exit code.
  Workflow observations and read failures are controlled inputs, not a real workflow executor or transport outage.
  Keep backend imports out of Web tests so frontend type checking does not traverse service/SDK declarations.
  `stream-markdown` checks immediate complete snapshots without replay and lossless source-offset segmentation across LF/CRLF/CR, indentation and blank separators.
  Its SSR comparisons parse emitted HTML into semantic element/attribute/text trees and compare segmented output with the authoritative whole-document `MarkdownBody`: loose/nested lists, quotes, indented/fenced code, dollar/backslash math, nested/multiline/escaped/duplicate references, footnote numbering/backlinks/footer, GFM and safe HTML/link/media behavior.
  Arriving math closers or definitions may revise dependent syntax; toggling terminal status alone keeps the same markup, including incomplete fences.
  The shared workflow caller retains its pacer/plain-fence policy, with SSR coverage of complete long snapshots.
  `chat-timeline` follows the actual `ChatWorkspace` → `ChatTurnView` → `StepText` → ordinary `StreamMarkdown` path and inspects segment keys, component/renderer types and source slices across append, active-to-frozen, durable/terminal handoff, unrelated tools, re-observation and prepended history; new syntax preserves the unaffected prefix.
  These element-tree assertions do not mount React DOM or measure performance; `workbench` separately checks stable row identities and folded thinking.
  `test/web/chat-timeline.test.tsx` also executes `ChatWorkspace` with controlled hooks and observations and inspects its actual outer Fragment and child keys: preview-to-Pi handoff, inserted thinking/tools, settlement, re-observation and prepended history retain those keys, equal bodies remain separate and legacy turns keep their recorded fallback.
  Key-addressed child hook cells exercise an opened tool retaining its displayed detail while its final read is pending; these cells are a test harness, not React's DOM reconciler.
  The same workspace fixture drives the real lazy-window observer callback over registered row refs without a new conversation snapshot: below/exactly at the 80px boundary, paused reading, Latest, user return to the bottom, composer resize, hidden-view restoration, earlier-page compensation and observer/frame cleanup.
  It also asserts that registration/measurement, question tracking and jump pins, branch versions, workflow placement, edit/continue and Send anchors still use read/navigation coordinates, not rendering identities.
  Helper-only identity or resize tests cannot establish that the main workspace is wired to them.
  For attachment races, `chat-timeline` drives `ChatWorkspace` through the actual `useConversation` and `ConversationReader`, holding individual head/turn Promises across a read pause, loss and recovery with identical owner IDs, and independent epoch/version replacements.
  Obsolete replies ignore abort, including an error released after a new success.
  Check the composer and reported footer clock before the new turn arrives, with no `summary.live`, and verify the draft, branch reads, body and paused scroll survive.
  `conversation-reader` gates an earlier turn page while a retained detail remains readable; `statusbar` renders unavailable, untimed and timed activity.
  These controlled regressions do not measure browser animation, paint or a real owner restart.
  A focused wiring rerun is `bun run test:web test/web/chat-timeline.test.tsx test/web/lazy-window.test.tsx`; read-redaction and Markdown semantic regressions are selected with `bun run test:target test/conversation-records.test.ts` and `bun run test:web test/web/stream-markdown.test.tsx test/web/chat-timeline.test.tsx`.
  Apply the exact-file/passed-assertion coverage rule above; these commands identify regression owners, not a recorded pass or a replacement for `verify` and independent Agent review of the new candidate.
  `test/web/{runtime-observation,workspace-layout,lazy-window,workflow-agent}.test.tsx` covers in-transcript observations without a separate composer status strip, Stop markup and follow-versus-scrolled-up resize intent.
  Controlled hooks, element-tree/source/CSS assertions, synthetic ResizeObserver dimensions and SSR are not a mounted DOM: native scroll clamping/anchoring, React DOM reconciliation, real browser scrolling, narrow-screen/focus/pointer behavior and paid providers remain unverified by these tests.
- `test/workflow-runtime.test.ts`, `test/web/{chat-timeline,workflow-agent,workbench}.test.tsx`: workflow tool publication and the actual subagent-view wiring, separate from the ordinary Pi timeline fixtures above.
  `workflow-runtime` drives real `SdkCapture`/`CaptureEmitter` events through `WorkflowTranscript`/`TurnCapture`, serializes a retained snapshot only when `accept` requests publication, then supplies those bytes to the real `Workflows.transcript` reader and `decodeWorkbenchResult`/`recordedTurn`.
  It checks tool-start without a following message, multi-chunk replacement snapshots with equal parts before tool-end, reverse-order success/error for same-named distinct calls with empty results, parent termination without tool-end, and unchanged readable legacy bytes without inferred state or association.
  This is the producer-to-persistence-publication-to-reader seam with controlled retained bytes, not a running owner's disk writer, SDK child or provider.
  `chat-timeline` executes `WorkflowAgentView` → `useWorkbench` → `recordedTurn` → `ChatTurnView` → `ToolStep` with controlled transport replies, hook scheduling and a fake clock, not a replacement detail function: opened output refreshes at equal parts, preserves the old value while pending, and gets a final completed/failed/canceled/unknown snapshot after the live interval stops.
  It checks closed tool and step-result laziness, aborts obsolete live polls on settlement, and changes client/run/step while transcript/result reads are pending to prove those late replies cannot write into the new view.
  `workflow-agent` SSR exercises that same view-to-card path with controlled public observations in English/Chinese, checking explicit running/result/error and legacy-neutral labels independently of reply and workflow status; `workbench` covers the shared card's completed/failed/canceled/unknown reply matrix, including an unfinished call and a recorded legacy error.
  These are separate controlled producer/reader and view tests, not one capture-to-browser end-to-end test; key-addressed hook cells model cleanup, not React DOM reconciliation, and SSR does not qualify real scrolling, focus, pointer interaction or narrow-screen layout.
  Focused reruns are `bun run test:target test/workflow-runtime.test.ts` and `bun run test:web test/web/chat-timeline.test.tsx test/web/workflow-agent.test.tsx test/web/workbench.test.tsx`, with the exact-file/passed-assertion coverage rule above; they do not replace `verify` or independent Agent review.
- `conversation-rename`, `gateway-archive`, `conversation-records`, `session-sharing`, `pi-sdk-baseline`, `session-rename`: the owner's rename rules against a stand-in child (read-back acknowledgement, one per session, no Send meanwhile, Stop, repeated commands), archive records in live and stopped-owner listings, the terminal's silence about a name record, and Pi's own `appendSessionInfo` shape.
  `session-rename` is slow: the real child against fabricated session files (one appended entry, a torn last line, another identity, an older format, an empty or missing file, the child guard) and a generated owner renaming and archiving over HTTP across a restart.
- `test/web/{conversation-inputs,composer,conversation-reader}.test.tsx`: when the browser offers the text typed to a running reply, the two commands, what each outcome does to the draft, a waiting message's whole-text rule, the waiting and undelivered rows, the split control beside Stop, and the reader carrying both lists.
  SSR markup and pure functions exercise no key press, focus or real owner.
- `conversation-input`, `worker-inputs`, `pi-sessions`, `pi-sdk-baseline`, `workbench-send-admission`, `service-conversation-inputs`: messages sent into a running reply.
  `conversation-input` runs the owner against a stand-in worker (durable record before hand-over, hand-over only to a listening worker, bounds, withdrawal, settlement of delivered, undelivered and unknown messages, the startup rule, run-bound plan approval); `worker-inputs` runs the worker's sequencing against the installed SDK's real `AgentSession` with a controlled provider reply (a steer after the running tool call, queued prompts after a normal end, nothing after a failure or stop, one final capture frame after several prompts).
  `pi-sdk-baseline` pins the two Pi behaviours that sequencing rests on: a steer is queued only into a running reply, and Pi continues a failed reply into a queued one unless the queue is cleared as `agent_end` is reported.
  `service-conversation-inputs` is slow: a generated owner, its real worker and Pi's session file over HTTP, and a real coordinator turn whose plan stays approvable after a message was sent into it; the stand-in and in-process fixtures do not qualify a real provider or the child's IPC.
- `conversation-images`, `service-conversation-images`, `test/web/images.test.tsx` plus `pi-sessions`/`gateway-conversations`: chunked image uploads without count/size quotas, exact Send/caller binding, SDK images through the private pipe, model capability refusal, readonly history/branch/media projection, image-only Send, upload failure and retained preview projection.
- `abort-scope`, `service-http-client-abort`: missing static cancellation APIs individually/together, pre-cancel/first reason, full-body deadline, normal/error cleanup and no command replay or service cancellation; finite transport fixtures do not start a real owner.
- `test/web/{project-entry,conversation-send,send-observation}.test.tsx`: pre-dispatch versus unconfirmed/confirmed preparation, attachment timeout after confirmation, pinned Send fields and original uncertain command IDs, scoped wait cleanup and same-epoch reattachment without replay.
- `test/web/{project-resume,conversation-reader,workbench,folder-draft,workspace-layout,stale-banner,locale}.test.tsx`: complete-link selection without storage, readonly server-held history/mode/context/work restoration, the shared folder-first shell and non-sending first-use draft handoff (including blocked storage), image pagination/parallel detail cancellation, retained stale observations and independent localized status/errors.
  Pure/controlled-fetch/SSR coverage is not physical Edge/Chrome/Android or production validation.
- `test/web/{theme,toasts,file-diff,preview,conversations,workbench}.test.tsx`: both colour schemes' token contrast at WCAG AA and the no-literal-colour rule (computed from the stylesheet sources), the theme choice, the toast queue and store, an `edit`/`write` call's recorded arguments as a requested change, the fenced file preview and lightbox markup, the message action bar and its whole-message text, and day-grouped, filtered conversation rows.
  Computed values and SSR markup are not a rendered page, a pointer, focus order or a real clipboard.
- `test/web/{context-usage,conversation-rows,workbench,workflow}.test.tsx`: the statusbar's context item (catalog match, tokens only, unknown after compaction, absent) and the reader carrying it, rename and archive as single commands with their refused, unknown, pending and no-owner states and the archived list's unreadable-versus-empty states, thinking blocks as folded lazily read steps that are neither answer text nor tool evidence, and a delivery's assignment counts, board, per-run dock groups, deviations and set-aside checks.
  SSR markup and pure functions exercise no pointer, focus, drawer or real owner.
- `test/web/{conversation-tree,conversation-reader,composer,question-rail,activity,model-wait,workbench}.test.tsx`: the session tree's rows, versions and question ordinals, the anchor a Send names (rewrite head with and without the turn's `parent`, the saved form, an anchored Send through a model wait and its release), a jump that reads back gap-free and a branch opened at one of its messages, the leaf written to the chat hash, the Branches tab's states, the version pager and off-context turns, prompt recall, the caret's line rule without layout, the `@` path token, the remembered composer height and the rail's layout.
  Pure functions, a mocked hook runtime and SSR do not show scrolling, focus, a pointer drag, text measurement or a real owner's branches.
- `model-preview`, `model-preview-process`, `model-preview-recovery`, `gateway-models`, `test/web/{model-preview,model-catalog,model-picker,model-wait,conversation-send,workbench}.test.tsx`: isolated readonly Pi source projection (context windows included), no credential/store mutations, secret-bearing identifier withholding, changed/half-written sources, project/default scope, pre-start model/thinking selection, obsolete preview rejection and exact preselection installation on Send without substitution/replay, both model-wait choice paths, exit receipt parity, native-close process charging and exact-ledger recovery.
  Controlled registries/SSR do not qualify a real browser or provider.
- `service-contract`, `service-model-choice`, `service-auth`: closed DTOs, exact source/choice/current authority and authenticated access.
- `pi-sources`: Cadence's closed `models.json` check compared field by field, at every object level, with the pinned SDK's published `schemas/models.schema.json` (a value of each field's type accepted, another type refused at its path, nothing else accepted); the retired `compat.reasoningEffortMap`; file/JSON/schema/SDK refusals that name the field and never a value; the win32 branch (simulated on this host, not a Windows run); and doctor reporting exactly the owner's pre-bind report.
  Its real-SDK `pi-runtime` case is slow.
- `checkout-gate`, `workflow-admission`, `workflow-delivery-runtime`, `workbench-cadence-control`: fair shared/exclusive access, cross-conversation admission, same-conversation exclusion, overlapping isolated implementations, refresh-before-curation ordering and final guidance/branch/HEAD fences.
  `workflow-parallel` is a retained slow real-Git diagnostic for isolated candidate refresh and successful-sibling integration fences, not part of the fast gate.
- `service-owner`, `self-heal`: original operations, overlap, Stop, and startup self-healing from real crashed owners, registry locks, partial reservations, orphan workers, torn/unreadable history, half-written metadata, removed project directories and dead workbenches (live owners never reclaimed).
- `worker-model`, `worker-retry-projection`, `conversation-records`, `test/web/model-retry.test.tsx`: public SDK Responses EOF recovery under a fake clock, one user message, no completed-tool replay or partial-call execution, bounded attempts, nonretryable auth/quota, Stop during backoff, reset per-request diagnostics, bounded progress failure handling, readonly refresh and localized SSR; no real upstream qualification.
  `worker-model` also holds the first auth reply while the actual SDK overlaps provider discovery and prompt preflight: more than two pending resolutions must queue, not fail before Send.
  A mocked `createAgentSession` or an immediately resolved auth stub cannot cover that startup graph.
  The retained, file-targeted `worker-auth-process` diagnostic covers real SDK children/IPC for ordinary, coordinator and workflow routes plus generated-owner browser HTTP Send; it remains slow, not another release prerequisite.
- `worker-*`, `lightweight-sdk`, `lightweight-process-diff`, `research-tools`, `research-tools-settlement`, `workflow-lifecycle`: genuine SDK/tool capture, split redaction, no-spill bounds and original native facts.
  `worker-capture` checks Pi's actual `AgentSession` system-message path (a low-level `Agent` alone does not reproduce it), explicit context omissions, strict message pairing, and split key/delimiter/whitespace redaction across repeated projections.
  Real-owner provider fixtures decode both string and typed text-part message bodies; recovery evidence and observation cursors must survive the current SDK serialization.
  `worker-settings` covers Pi merge/model-override/trust semantics, malformed-source refusal and inert snapshots without source writes.
  `worker-toolkit` covers inherited editing selections, PowerShell and native shell schemas/backends, readonly boundaries, immutable placement and original-operation joins; `research-tools` covers actual Pi read/list semantics and `research-tools-settlement` delays actual SDK I/O to test cancellation; `coordinator-tools` owns bridge admission and disposal.
  `research-tools-schema` compares ordinary tool schemas with the installed public SDK and checks pre-send Responses serialization without the retired batch/query/cursor protocol; specialized `changes` alone retains nullable cursor fields.
  `research-tools-process` uses installed SDK search adapters with controlled subprocess events to verify grep's actual abort/close path, find's original settlement and error propagation.
  These are not paid-provider requests or qualification of externally installed search binaries.
- `service-history-*`: durable ordering, cold/no-index/restarted proof/search/export, corruption/torn/quota and expected-byte publication.
- `history-shell`, `native-client`, `native-history`, `terminal-integration`: readonly entry guards, shared service, Unicode/paging and detach; daily native approval/cancel belongs to `cadence-mode`.
- `agent-panel`, `agent-panel-model`, `agent-panel-cadence`: running-only lists, stale keyboard/mouse selection, stable open reading snapshots, bounded abandoned-run observation and final reads after transient failures, conversation-scoped admission attribution (not cwd or copied fork history), no settled-child rereads, and readonly owner observation that never starts, cancels or replays work; departure fences late reads and only detaches.
- `test/web/`: fast pure/SSR tests for presentation, client state, scoped Send/approval, retained history/images, built-asset serving, auth and content policy; no browser launch, real DOM interaction or viewport qualification.
- `package-*`, `distribution`, `service-package`, `independence`: exact tar/member/body/import/notice closure and nonactivating discovery.
  The import closure is read from the real archive by the gate's pack stage (`scripts/pack-check.mjs`); `package-audit` holds its fabricated-archive cases.
- `npm-release`: parsed workflow triggers/permissions/pins, real tiny-Git tag ancestry and drift, strict candidate/registry identities, exact archive auditing, bounded readonly metadata observation that ends pending rather than failed, and digest/`latest` confirmation.
  Fake-clock/stream fixtures cover delayed version/tarball/latest visibility, the shared deadline and unchanged request ceiling, original-read settlement, immediate mismatch refusal and independent publish receipts without extending test timeouts.
  Fixtures are local or controlled-fetch only; a passing gate does not qualify a GitHub-hosted run, npm OIDC exchange or real publication.
- `service-autostart`, `project-start`, `install-config`: explicit `cadence server` registration on systemd (root system scope without linger, legacy user scope), launchd and the Windows Run key, separate named service definitions and directory owners, definition escaping, restart/disable/mask/foreign handling, orderly Stop before every change, the `.env` port and token lines and a package without install scripts.
- `service-installation`, `service-maintenance`, `service-maintenance-systemd`, `test/web/service-dialog.test.tsx`: exact Pi/npm/Bun copy and manager discovery (including conflicting global-directory evidence and Pi-prefix fallback refusal), pinned/ambiguous/unwritable refusal, unchanged Pi settings, explicit npm scope, complete Bun deprecation metadata, successful restart exit, confirmed new-owner Stop before rollback and partial-install restoration, cgroup and `InvocationID` proofs, the job record, and against a real user manager a child inside the service that is refused without change and a WebUI restart that a transient unit completes.
- `service-conversation-context`, `service-workflow-context`: same-checkout subdirectories and same-cwd conversations, queued/admitted model snapshots, exact stale-plan refusal, worktree/check cwd, restart/default preservation, old-identity refusal and conversation model isolation.
- `service-cli`: real owners started from the `.env` port and token, reselection of a stopped workspace, edits while running, rotation of the token line, a runtime fault's worker stop/successor/recovering restart and the readable refusal for a removed project directory.
- `workspace-landing`: no-default-workspace startup, explicit root refusal and noncreating native/readonly entry.
- `gateway-conversations`, `gateway-files`, `gateway-send`, `test/web/{conversation-send,send-observation}.test.tsx`: stopped-owner history/mode/step and file reads without startup or writes (`gateway-files` covers a never-prepared folder, the owner's file refusals and the no-redaction-source refusal without starting anything), unchanged draft identity across selection/first startup/Stop/refresh, exact stopped-state guards and readonly restoration; real same-origin project routing, browser-only authority, retirement on token rotation, continuing ordinary work, nonactivating selection followed by a Send that reclaims a provably dead registry lock and genuine multi-owner Stop over loopback.
  Preparation needs fresh auth/CSRF, sends no message or approval, does not adopt a merely browsed independent owner, and adds no warm-Send receipt quota; lost preparation/Send replies and departure cannot replay or rebind a message.
  Same-epoch re-entry waits for the new observation generation, never the previous attachment.
- `gateway-availability`, `test/web/{owner-bindings,project-entry,observation}.test.tsx`: authenticated access across different or absent builds, failed gateway binding eviction, client-chosen attachment IDs, lost-header/body recovery without slot leaks, idempotent detach, same-viewer polling and replacement-owner/CSRF recovery without mixed-epoch readiness or command/grant replay.
  The gateway fixture is in-process with a controlled HTTP owner, not an SDK or boot service.
- `activity`, `activity-discovery`, `activity-auth`, `test/web/activity.test.tsx`: real-turn-only native metadata, final settlement, exact admission attribution, nonactivating registry discovery, partial/stale observations, private-file preservation, cancellable browser polling and branch navigation.
  Controlled observations do not qualify real browsers, providers or production services.
- `agent-lifetime`, `worker-auth`, `worker-model`, `lightweight-process-diff`: virtual time past the old deadline for each worker route, multi-round SDK investigation, bridge detach versus explicit cancel, automatic compaction/final selection, request-bound owner OAuth renewal and original-write joins, bounded settled capture state and redacted log truncation.
  These use controlled native/auth/provider ports, not live services or paid providers.

## Builds and packaging

Regenerate operator/service/native/browser outputs only through their canonical builders; `--check` variants compare new private output without overwriting canonical bytes.
Publish `web/dist` through `bun run build:web` (the package script runs `node scripts/build-web.mjs`): Vite run under Bun lays out its preload helper differently, so a Bun build fails a Node `build:web:check`.
The canonical builder compares two private builds under the inherited temporary root and publishes their validated asset/manifest closure; never hand-edit generated assets or rebuild service/native outputs for a Web-only source change.
Refresh affected destination hashes in `provenance/webui-reuse.json` while preserving upstream source/license pins and historical evidence; generated asset names belong to the independently maintained `provenance/package-members.json`, which changes only when the reviewed shipped membership changes.
Review the independently enumerated package member list and every emitted body, not a count or an expected list generated from the tar under test.
The pack stage also parses every module the archive ships and refuses a relative runtime import the archive does not contain: the source tree resolves such an import, so only the archive shows a file left out of `files`.
Keep public Pi peers external for the extension, the exact Undici/ws runtime edges, the exact optional SDK pins for the standalone owner and all upstream/font/vendor notices.
Preserve original license bytes through their precise Git attributes; line-ending normalization must not invalidate audited source/notice hashes.

## Validation and regression lessons

| Condition                                                      | Required behavior                                                                                     |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Missing/unsafe/corrupt/partial selected state                  | Readonly observation changes nothing; startup archives what a dead owner left half-written            |
| Native exit0 with recording/stdin/final/cleanup failure        | Preserve native zero independently; no workflow success                                               |
| Stale grant, selected task bytes or model/source identity      | Refuse and require fresh observation/confirmation                                                     |
| Unknown original stop/auth/storage or changed lease            | Quarantine, settle, stop own ledger workers, exit; the successor's startup heal recovers it           |
| Failed/unrun/stale check, partial child or incomplete coverage | Explicit issues review; preserve independent recorded outcomes                                        |
| Lost reply or detached view                                    | Observe original receipt/run; no mutation replay or implicit Cancel                                   |
| Invalid read proof or changed source/key                       | Refuse; never rebase or interpret budget exhaustion as absence                                        |
| Dirty/partial/extra compiled assets or unsafe archive          | Refuse in place; no source refill, wildcard serving or fallback build                                 |
| Extension import outside Pi aliases declared only as a peer    | Exact production dependency; Pi's install omits peers and Pi fails to start                           |
| Missing optional SDK or Pi `auth.json`                         | Project-less workbench may start without loading either; explicit project startup retains its refusal |
| Package files hard-linked into a package manager's store (Bun) | Packaged reads ignore link count, bind exact bodies; other files stay single-link                     |
| Host refuses during startup                                    | Fixed code/stage and Pi problem words; a registered host exits and the next start recovers            |
| Pi SDK upgrade adds or retires models.json fields              | Mirror its published schema, closed and typed; a retired field refuses with its migration             |
| Workbench alive while a project's Pi sources refuse            | Doctor runs the owner's pre-bind and SDK checks; the browser shows `corrupt-selected`                 |
| Workspace containing the private state home                    | Refuse the project selection; no redirection, default directory or state relocation                   |
| Restart changes the definition's workspace or Node path        | Stop with the loaded definition before rewriting, not only a signal                                   |
| npm 12 or Bun skips untrusted install scripts by default       | Ship none; `cadence server install` registers the service and creates the template                    |
| Service manager that only signals (launchd, Windows login)     | Orderly Stop first; an unconfirmed Stop changes nothing; no SIGTERM or `taskkill`                     |
| Pi's TUI replaces an info status with the next one             | The missing-service hint is its own warning notification                                              |
| Token source the user edits (`CADENCE_TOKEN` in `.env`)        | Read once before binding, never bound for the run: an edit cannot fence Stop                          |
| Saved port/token source differs from `.env`                    | Only when stopped, reselect just those under the reservation; running ones refuse                     |
| User-made `.env` (0755/0644, umask 002, dotfiles links)        | Like Pi's sources: ownership only, links followed; each refusal names its reason                      |
| Credential value inside a provider/model ID (Ollama `ollama`)  | Withhold and count only that catalog entry; choosing it refuses; others selectable                    |
| Git output past its buffer/time bound (`node_modules` listing) | Hash a fixed outcome, never pipe-timed partial bytes: an unchanged tree keeps one identity            |
| Long streamed reply captured chunk by chunk                    | Track sizes and preview heads incrementally; rescans stalled the owner and failed reads               |
| models.json edited while the owner runs                        | Redact session reads with the last observed literals; never fail history or return it unredacted      |
| A terminal message sent from the same entry as a browser turn  | Use the worker-recorded command/user-entry marker, including when both sides send identical text      |
| A turn's steps watched live, then failing without an answer    | Derive the fold from the settled turn on every render, not from mount-time state; user toggles win    |
| A shown list re-read in the background (sidebar polling)       | Keep the rows in place; only a page with no rows yet shows its reading hint                           |
| Power loss or shutdown while an owner runs (idle or busy)      | Next start proves the holder dead (boot ID, PID, start identity) and recovers; no typed confirmation  |
| Systemd unit pointing at a removed project directory           | Readable refusal, exit78 (no restart loop); its dead reservation is released account-wide             |
| A steer still in Pi's queue when its reply fails for good      | Take it back as `agent_end` is reported or Pi continues into it; record it undelivered, never resend  |
| Shipped module importing a file left out of `files` (2.1.0)    | Pack stage resolves every shipped import inside the real archive; a `slow` test is never the gate     |
| A count or size bound in a tool schema (2 questions, 2.0.x)    | The schema states shape only; the service refuses by field, so the model can correct the call         |
| A refusal naming the wrong cause (`oversize` for an identity)  | Name the field, what it holds and what is accepted; never a bare code the model will act on           |
| A provider that fails one of several concurrent subagents      | Record each answer as it settles, ask the failed question once more alone, keep the provider's reason |

Good: current context → exact plan approval → durable acceptance → genuine original native/auth/storage settlement → real checks → automatic Agent review.
Archived human Review is not a new workflow approval.
Base: a client leaves and another reattaches to the same accepted run without launching it again.
Bad: model prose, a valid cursor, a prepared graph, one native exit or a human Done checkbox becomes fabricated execution/check success.

Wrong: release a reservation when `Promise.race` reports a timeout, or retry a mutation when its reply is missing.
Correct: retain the original operation/fences and observe the exact receipt; a separately explicit safety request does not renew task consent.
Wrong: show only preview/ring text as full history, or sum overlapping test runs into a larger suite total.
Correct: expose bounded continuations/full exports and report the exact executed domain and final original exit.

Pi inheritance regression owners: `workflow-admission` binds preference changes to fresh approval and pins queued snapshots; `worker-auth` proves request renewal cannot reload preferences; `lightweight-sdk` rejects substituted active tool sets before a model request.
Public-boundary fixtures do not qualify live extensions/MCP, real PowerShell/provider behavior on every platform, or a deployed service update.
