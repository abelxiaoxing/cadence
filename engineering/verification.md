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
For a repair, select one named group, for example `node scripts/qualify-optical.mjs --group=agent-scroll:dark:390`, `--group=dark:320`, `--group=reading` or `--group=forced-colors`; `--group=agent-scroll` checks that behavior across all six views.
For the conversation UI, run `--group=quiet-workspace` and `--group=transcript-polish` against the **same** canonical build.
Each selects dark/light at 320, 390 and 1440 CSS px, including reduced motion at 390; suffix `:<theme>:<width>` for one view.
`quietWorkspace` records the one editor across a held/refused Send and an accepted first message, title-only plan review, a synthetic rebind (no execution approval) and linked/unattributed work over 90 seconds of controlled roster time.
`transcriptPolish` records disclosure edges, focus and exact lazy-read counts, reading offsets, question jumps, and paired glyph/no-glyph screenshots with the composer at two heights.
Compare `masks[].result`: the visible area must change, but the area from above Latest through the dock and bottom gutter must not.
A selected run is labelled targeted even on success.
With no arguments the full matrix remains one process under its original command deadline.
The report directory is printed before observation; `progress.ndjson` records each group's start and settlement against its build and HEAD.
A start without settlement is partial evidence, not a completed group.
The script prints the directory containing `summary.json` under that scope: branch, HEAD and canonical browser build identity, viewports, geometry, contrast samples, frame windows and paint attribution.
For the design submission, implementation/confirmation and code/tool controls, `controls` records the actual button after scrolling and stable layout: name, four edges and size, viewport, intersections with clipping ancestors, disabled state, center and four inset edge hits.
For a control inside `dialog:modal`, `controlGeometry` intersects the viewport and clipping ancestors through the dialog itself, not the transcript behind the top layer.
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
`copyIndicators` checks the subdued desktop rest state, measures a straight SVG stroke against the adjacent material after pointer reveal, then checks the visible Tab outline for the same control; missing samples or ratios below 3:1 fail.
The `expand` conversation does not stream: its folded head is already reachable both at the bottom and after wheeling up past 80px.
For desktop wheel probes, size the native Chromium window to cover the emulated viewport: even a trusted wheel over a hit-tested element can leave the pane still when the compositor's input surface is smaller.
Compare `inputWindows` with the pane's actual bottom distance in `toolWheels`, not just the DOM event.
Before activation and after real detail growth and stable frames, record the pane's scrollTop, client/scroll heights, bottom distance and first fully visible reading block/offset, without any corrective scrolling or focus between samples.
Check Latest only after the up-scroll comparison: shorten the viewport after the click to distinguish resumed follow from a one-time jump.
Incremental follow remains a separate observation.
A missing browser or failed observation is not a pass.

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
- `checkout-gate`, `workflow-admission`, `workflow-delivery-runtime`, `workbench-cadence-control`: fair shared/exclusive access among workflows, cross-conversation workflow admission, same-conversation exclusion, overlapping isolated implementations, refresh-before-curation ordering and final guidance/branch/HEAD fences.
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
- `service-conversation-context`, `service-workflow-context`: same-checkout subdirectories and same-cwd conversations, cwd/model snapshots fixed at admission, exact stale-plan refusal, worktree/check cwd, restart/default preservation, old-identity refusal and conversation model isolation.
- `service-cli`: real owners started from the `.env` port and token, reselection of a stopped workspace, edits while running, rotation of the token line, a runtime fault's worker stop/successor/recovering restart and the readable refusal for a removed project directory.
- `workspace-landing`: no-default-workspace startup, explicit root refusal and noncreating native/readonly entry.
- `gateway-conversations`, `gateway-files`, `gateway-send`, `test/web/{conversation-send,send-observation}.test.tsx`: stopped-owner history/mode/step and file reads without startup or writes (`gateway-files` covers a never-prepared folder, the owner's file refusals and the no-redaction-source refusal without starting anything), unchanged draft identity across selection/first startup/Stop/refresh, exact stopped-state guards and readonly restoration; real same-origin project routing, browser-only authority, retirement on token rotation, continuing ordinary work, nonactivating selection followed by a Send that reclaims a provably dead registry lock and genuine multi-owner Stop over loopback.
  Preparation needs fresh auth/CSRF, sends no message or approval, does not adopt a merely browsed independent owner, and adds no warm-Send receipt quota; lost preparation/Send replies and departure cannot replay or rebind a message.
  Same-epoch re-entry waits for the new observation generation, never the previous attachment.
- `gateway-login`, `test/web/{assets,entry-recovery,startup-script}.test.tsx`: authenticated build-scoped URLs on both entries, uncached HTML, transient first-read recovery, auth refusal, and pre-mount module-failure recovery bounded across reloads.
  These use real asset bytes, controlled GETs/timers and the startup script in a simulated document, not a browser cache or deployed reverse proxy.
- `gateway-availability`, `test/web/{owner-bindings,project-entry,observation}.test.tsx`: authenticated access across different or absent builds, failed gateway binding eviction, client-chosen attachment IDs, lost-header/body recovery without slot leaks, idempotent detach, same-viewer polling and replacement-owner/CSRF recovery without mixed-epoch readiness or command/grant replay.
  The gateway fixture is in-process with a controlled HTTP owner, not an SDK or boot service.
- `activity`, `activity-discovery`, `activity-auth`, `test/web/activity.test.tsx`: real-turn-only native metadata, final settlement, exact admission attribution, nonactivating registry discovery, partial/stale observations, private-file preservation, cancellable browser polling and branch navigation.
  Controlled observations do not qualify real browsers, providers or production services.
- `agent-lifetime`, `worker-auth`, `worker-model`, `lightweight-process-diff`: virtual time past the old deadline for each worker route, multi-round SDK investigation, bridge detach versus explicit cancel, automatic compaction/final selection, request-bound owner OAuth renewal and original-write joins, bounded settled capture state and redacted log truncation.
  These use controlled native/auth/provider ports, not live services or paid providers.

### Ordinary Send admission

`test/conversation-input.test.ts` holds session A's stand-in worker open and takes the same exclusive permit used by workflows.
It reads B's first `state.json` before its run begins, then holds auth preparation open to check that the head, turn and activity all show `starting` without assistant output.
B must then launch, write its reply and settle before A ends or the permit is released; acceptance receipts and elapsed time cannot establish that ordering.
The same fixture checks same-session and capacity refusals without a new turn, per-turn cancellation and owner Stop waiting for auth settlement and native close.
`test/conversation-records.test.ts` checks interruption against the untouched state file, separately from an owner's recorded unknown closure.
On the Web side, `test/web/conversation-reader.test.tsx` polls from startup to the first answer with localized transcript markup; `test/web/chat-timeline.test.tsx` drives the workspace's in-reply input, Stop and draft handling after a definite refusal or an uncertain Send.
These are controlled worker, reader and view fixtures, not a live provider or mounted browser.

## Builds and packaging

Regenerate operator/service/native/browser outputs only through their canonical builders; `--check` variants compare new private output without overwriting canonical bytes.
Publish `web/dist` through `bun run build:web` (the package script runs `node scripts/build-web.mjs`): Vite run under Bun lays out its preload helper differently, so a Bun build fails a Node `build:web:check`.
The canonical builder compares two private builds under the inherited temporary root and publishes their validated asset/manifest closure; never hand-edit generated assets or rebuild service/native outputs for a Web-only source change.
Refresh affected destination hashes in `provenance/webui-reuse.json` while preserving upstream source/license pins and historical evidence; generated asset names belong to the independently maintained `provenance/package-members.json`, which changes only when the reviewed shipped membership changes.
Review the independently enumerated package member list and every emitted body, not a count or an expected list generated from the tar under test.
The pack stage also parses every module the archive ships and refuses a relative runtime import the archive does not contain: the source tree resolves such an import, so only the archive shows a file left out of `files`.
Keep public Pi peers external for the extension, the exact Undici/ws runtime edges, the exact optional SDK pins for the standalone owner and all upstream/font/vendor notices.
Preserve original license bytes through their precise Git attributes; line-ending normalization must not invalidate audited source/notice hashes.

## Optical observations by build

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

### Unavailable mode: missing capsule paint versus a moving layout

On HEAD `181b8995713f0c5361b14765206a7feea041504a`, `verify` passed but the owner's `optical-evidence-9ZJFCq/summary.json` stopped after 48 scene audits on canonical build `b24896e9a328c9c358f7e42efccec06e7502136d0ba632f46adac803ba7d780b`.
At dark/390px the button was natively disabled, with the expected name and title, but `paintedGlyph` was null.
**17.977:1** was the CSS ink calculated against a canvas pixel, not readable painted text.
There were no performance windows.
That check did not complete the six views or the draw/follow observations.

**Targeted replay:** Same integration worktree, installed headless Chromium 151.0.7922.34, fresh profile, synthetic loopback projections, Obsidian, six rounds alternating 390×820 and 320×820 at DPR 1.
Each sequence opened the retained artifact in Inspector → changes, exercised its find/navigation, dismissed the compact drawer and navigated to `#chat=optical-unknown`.
Readiness required that conversation's heading, its degraded-read notice and its native disabled `Cadence state unavailable` button with matching label and title.
Each round kept two distinct unmodified PNGs: the first screenshot requested at observed readiness, and another after 300ms and stable button geometry.
This is not a trace of every intervening compositor frame.

- **Before:** `unknown-frames-H34Y6G` under the inherited run temporary root retains all 24 PNGs, `summary.json` and their `landmarks.json` pixel readings.
  At 320px the six ready frames showed ink; four subsequent stable frames did not.
  At 390px five ready captures straddled a geometry change; do not classify them from their pre-capture Range alone.
  Five of the six stable captures were missing ink.
  In `390-1-stable.png`, bitmap and CSS viewport were both 390×820 with no zoom or offset.
  The notice glyph at (34,583) was RGB(227,166,174), and its rule began where expected.
  The button remained at (59.5,694), 200.875×28; its text Range ran from (103.5,699.20) to (249.375,716.20).
  The capsule top (195,618), backings at x=118/176/234, y=697, and even the pixel nearest the requested ink in that Range were **all canvas RGB(9,10,13)**.
  This was not a whole-screenshot offset.
- **Repair:** Filter, glass base and grain now share a noninteractive material behind the controls; the focus outline, top refraction and local flow stay on the form.
  No palette or contrast threshold changed.
  On rebuilt `cd62a3ba58343e40492568f5829478092285e9754e30e8059fa7a8178eece430`, `unknown-frames-4CcssV` repeated the same 24 captures.
  All stable frames painted the label.
  Its original pre-capture sampler still flagged the six 390px ready frames: the footer reflow had moved the button down 18px **during** the capture.
  The saved PNGs have both the notice and the ink at the new positions.
- **Frame binding:** `unknownMode` keeps the ready and stable screenshots separately.
  It brackets each PNG with document identity, route, semantics and geometry, checks bitmap/viewport dimensions, and identifies the presented geometry from the notice rule and the pixel above it, **not** from the mode label.
  Ambiguous or missing evidence fails; a later frame cannot replace the first.
  `unknown-bound-6QVhrs` exercised that binding on six further rounds per width: all 24 bound frames had effective opacity 1 and ink RGB(242,244,248) against all three RGB(19,20,24) backings, **16.715:1**.
  At 390px the actual ink pixel was (108,704), and the capsule outside/top/inside pixels were RGB(7,8,10)/(66,69,77)/(19,20,24).
  At 320px the button y was 676, the Range y was 681.20–698.20, the backings y=679 and the ink at (108,686).
  In a separate collector-only negative control (`unknown-negative-control-ik4cK4`), substituting the saved blank 320px frame produced a dark/320/ready problem, preserved the stable and next viewport readings, and exited 1.
  This was not a failure on a newly painted product frame.

These targeted observations do not qualify a physical phone, hardware GPU, live service, or the full candidate.
For the six theme/viewport pairs, draw counts, incremental follow/up-scroll/Latest and performance windows, use only the owner's **new** `qualify-optical` report on the final candidate.
The earlier build reports above are not results for this one.

### Recent folders and reply-locked thinking levels

`pickerStates` in the optical report targets two cases the general text audit cannot establish: a current project after focus leaves it, and labels on native disabled buttons (excluded by that audit).
In first-use setup, both recent paths must exist but neither may have `aria-current` or the leading mark.
In the selected project the statusbar opens the chooser; browsing `specimen/facets` changes the Open target, **not** the mark on `specimen`.
Tab visits both enabled rows with a separate visible outline, then leaves for the breadcrumbs.
No recent folder is opened.
In a separate running-reply conversation, opening the composer model picker reads `optical` with Low, Medium and High offered.
Only Medium is pressed; all three are natively disabled and the lock notice is visible.
Tab goes from model search to Stop and Shift+Tab returns, without activating either control.

**Targeted observation:** `picker-evidence-ZPblIa/summary.json` in the run temporary root, canonical build `a5bc3bf6ab8ca00bece76dce61bc270715d11a84f6b6e6198fe996aaef269865` over pre-commit HEAD `d5d52ff1` in the integration worktree.
Installed headless Chrome 151.0.7922.34, DPR 1, synthetic loopback data, both system schemes at 320×820, 390×820 and 1440×900.
The 18 picker observations retain 42 unmodified viewport PNGs and 294 comparisons.
The pointer was outside the controls; each capture was bracketed by matching semantics, hit tests and geometry, without retrying the screenshot.
The folder mark is sampled across its width near both ends and the middle, against the adjacent row, section card and dialog padding.
Thinking level text uses actual glyph ink and backing inside each button; the selected border is sampled against its face and the menu.
`pickerStates[].frames` records each PNG, folder/button rectangles, sample coordinates, RGBs and ratios.
Worst observed ratios (rounded):

| Indicator or text                    | Obsidian             | Alabaster           |
| ------------------------------------ | -------------------- | ------------------- |
| Mark at rest, on row / card / dialog | 10.513/11.458/11.221 | 9.346/10.378/10.378 |
| Folder path / keyboard focus         | 5.728/10.513         | 5.589/9.346         |
| Low / Medium / High                  | 5.887/10.157/5.887   | 5.541/9.515/5.541   |
| Lock notice                          | 5.547                | 5.637               |
| Medium border, on button / menu      | 10.271/11.211        | 9.515/10.558        |

The earlier targeted probe required a dialog hit in the section padding and, in three sessions, could no longer find the earlier model label at click time; `picker-evidence-mf2cyQ` records those failures.
The revised probe locates the trigger by the live reply lock and tests the installed selection inside the open picker.
`theme.test.tsx` separately computes contrast from the stylesheet rules and their backing layers; it does not measure DOM focus or painted pixels.
These picker observations did not send a message, choose a model, use a live provider, qualify a physical device or repeat the performance windows.
The full candidate checks and independent review remain the owner's evidence.

### Partial composer paint after closing Inspector

**Failed baseline.**
On pre-repair HEAD `7e7b30a` (`a5bc3bf6ab8ca00bece76dce61bc270715d11a84f6b6e6198fe996aaef269865`), the owner's `optical-evidence-fxd9pr` recorded one failure in 143 scene audits.
In light/1440×900 the capsule surface was still present, but its disabled mode label, model label and placeholder disappeared between `ready` and `stable`.
The part of the hint still visible at the right is not the mode button.
A computed foreground on a correctly painted material does not establish that the text was drawn.

**Targeted comparison.**
Same integration worktree, installed headless Chrome 151.0.7922.34, DPR 1, fresh profile per series and synthetic loopback reads.
Each round opens history → Inspector → Changes, searches the retained artifact across views and pages, closes Inspector (Escape on compact screens) and enters `optical-unknown`.
Each evidence directory below is under the inherited `TMPDIR` and retains a JSON summary and both unmodified PNGs for each observed round/view.
`ready` is the first capture after route/heading/degraded notice/native disabled-button readiness; `stable` uses the existing 300ms and stable geometry.
Neither phase substitutes for the other.

| Light/1440, six rounds                   | Web build (prefix) | Ready / stable frames meeting all three text checks | Evidence directory        |
| ---------------------------------------- | ------------------ | --------------------------------------------------- | ------------------------- |
| Unchanged UI                             | `a5bc3bf6ab8c`     | 6/6 ready; 5/6 stable                               | `capsule-before-QUN4vH`   |
| Short painted grip only                  | `40251c351733`     | 6/6 ready; 6/6 stable                               | `capsule-handle-OrlJHu`   |
| Sibling filter plate only, original grip | `d50b5b170e5d`     | 6/6 ready; 5/6 stable                               | `capsule-plate-EuiukN`    |
| Short grip and sibling plate             | `60ed592b4fe2`     | 6/6 ready; 6/6 stable                               | `capsule-combined-P33k1z` |

The grip-only change **still failed** on the second dark/1440 stable capture in the two-round matrix `capsule-handle-matrix-XXrkZf`.
Neither change in isolation establishes the compositor's root cause.
The combined treatment keeps the hit area but changes only the mark, and paints the base and stationary grain on the capsule itself.
A noninteractive workspace pseudo-element behind the form samples the backdrop; its CSS anchor follows wrapping and resizing.
Without anchor support it is not needed for contrast.
Without filter support the capsule gets the opaque fallback.
No repaint timer, React update or forced layer promotion was added.

**Final targeted build.** `bun run build:web` produced `60ed592b4fe2ec3f0f96ff1c8b68bd9f3c4d1339565df6a83f6cf1cc5c91cf22` in this worktree.
In `capsule-combined-grid-yxWsEs`, two rounds in each of dark/light × 320×820, 390×820 and 1440×900 produced 24 bound frames.
All passed.
The notice edge, not the glyphs, selected the presented geometry when the 390px footer reflowed during capture.
An earlier series (`capsule-combined-matrix-ODqdDG`) stopped in dark/1440 artifact search on an active-match assertion, **before** its composer observation; it is not a six-view result.

The mode text Range uses all three adjacent backing samples.
The model sample is the common leading 24px **inside the span's text Range**, so a loading caption can change without making a CPU icon, chevron or border eligible.
For the empty textarea, the first word `Message,` is located from its content origin and first-line metrics; the backing point is in the adjacent textarea padding.
Each reading records its pixel, coordinates and backing from the **same** PNG.
The lowest painted ratios in the two-round matrix were:

| Text        | Obsidian (ink / backing RGB; ratio) | Alabaster (ink / backing RGB; ratio) |
| ----------- | ----------------------------------- | ------------------------------------ |
| Mode        | 242,244,248 / 25,25,29; **15.917**  | 17,19,24 / 247,247,248; **17.355**   |
| Model       | 138,147,162 / 19,20,24; **5.939**   | 94,102,117 / 252,252,253; **5.637**  |
| Placeholder | 138,147,162 / 19,20,24; **5.939**   | 94,102,117 / 252,252,253; **5.637**  |

Collector-only negative control `capsule-saved-control-P60hnC` used the owner's original light/1440 PNGs instead of new product frames: ready passed, stable failed (exit 1).
No mode or placeholder ink was found; even the strongest model-region pixel was only 1.102:1.
`capsule-controls-rY1fJ4` separately exercised Shift+Tab focus, ArrowUp (64→80), pointer drag near the edge (80→128), Home (automatic), and an open menu hit **outside** the capsule at 1440 and 390px.
The plate matched the form bounds before and after resizing, with no filter on the form.
The desktop flow probe observed the retained thinking/tool transitions and static reduced-motion state.

**Limits.**
These are sampled compositor frames, not continuous video or a guarantee that a different GPU, browser or physical phone cannot reproduce the defect.
No live workspace, hardware-GPU comparison, non-Chromium fallback run, performance windows or full qualification rerun is claimed here.
The owner's final `qualify-optical` and `verify` results and independent review must bind the actual delivery candidate.

### Composer height grip at rest

The native range has no visible track or thumb.
Its short mark must contrast with **both** the reading surface above the capsule and the glass below it, before someone finds and focuses the range.
`theme.test.tsx` looks up the no-hover media rule separately from the base rule, form-hover reveal and direct hover/focus/active rule.
Against the old `--border`, the touch and form-hover tests failed in **both** schemes (1.550:1 Alabaster and 2.064:1 Obsidian even on the bare canvas).
Only the resting ink changed to `--control-fg`; the direct interaction still widens the mark and manual height keeps its dot.

**Local build comparison.**
In this integration worktree on pre-repair HEAD `0160bee`, `bun run build:web` produced `cac0cdd54b92d7eff921225f2cfe24ac0e0e212150301e4d995ce3ab169d9553`.
The `composerGrip` probe ran against the unchanged `60ed592b4fe2` and repaired builds with installed headless Chrome 151.0.7922.34, a fresh profile per matrix, DPR 1 and the synthetic selected project's `reading` conversation with a rendered assistant message.
At 320 and 390px, CDP enabled one touch point; `(hover: none)` matched and neither form nor grip was hovered.
At 1440px the mouse moved to (850,781.5) inside the textarea: the form was hovered, the grip was not.
This headless host reports `(hover: none)` even without touch emulation; the equally specific form-hover rule follows that default.
The grip was neither focused nor pressed in any capture.
The probe disables its touch override and parks the pointer on exit.

Each view supplied one unmodified PNG, bound to the same range geometry and input state before and after capture.
At each x, the probe requires the mark's ink inside the 48×4px gradient, then compares that **painted pixel** independently to the first clear row on either side.
A missing mark or either ratio below 3:1 fails.
Coordinates below are pixels from the viewport's top left; the range hit box remained 14px tall.

| Viewport | Hit width | Sample x positions | y above / ink / below |
| -------- | --------: | ------------------ | --------------------- |
| 320×820  |       254 | 144, 160, 176      | 588 / 591 / 593       |
| 390×820  |       324 | 179, 195, 211      | 646 / 649 / 651       |
| 1440×900 |       782 | 834, 850, 866      | 745 / 748 / 750       |

| Scheme    | Repaired ink RGB | Above RGB   | Below RGB   | Above / below contrast | Worst with old ink |
| --------- | ---------------- | ----------- | ----------- | ---------------------- | ------------------ |
| Obsidian  | 138,147,162      | 7,8,10      | 19,20,24    | 6.465 / **5.939**      | 1.920              |
| Alabaster | 94,102,117       | 231,232,234 | 252,252,253 | **4.714** / 5.637      | 1.379              |

All six baseline frames failed contrast; all 36 paired readings in the six repaired frames met 3:1.
The retained `summary.json` and PNGs are under `$TMPDIR/grip-matrix-9TaTGzbB/{evidence-uNFCkB,evidence-hNHraA}` respectively.
These are point samples with emulated input, not a physical touchscreen, hardware mouse or cross-browser qualification.
No interaction or compositor conclusion is inferred from the source-only tests.
This grip-only run does not replace the separate unavailable-mode `ready` and `stable` glyph observations, the owner's two checks on the final candidate, or independent review.

### Empty design answer, open menus and retained step results

The earlier owner observation (`optical-evidence-yGB0is`, HEAD `3712df19`, build `cac0cdd54b92`) passed 143 scene audits but did not sample the empty custom answer, check the four open frames' material, or copy a retained step file.
The repair's targeted matrix is `$TMPDIR/detail-evidence-VydTU4/summary.json` on the same task branch and integration worktree, over pre-commit HEAD `3712df19`.
`bun run build:web` produced `6764640acb2a6576d371383daa43b5de62adc6db8ac16c3c3294fc7c33947250`.
Installed headless Chrome 151.0.7922.34, fresh profile, DPR 1, both system schemes at 320×820, 390×820 and 1440×900; only local synthetic projections were served.

The 36 unmodified viewport PNGs provide 126 comparisons.
On the actual design card, the enabled, editable “Other idea” contained the empty string, with the pointer elsewhere.
Three straight-edge pixels (¼, ½, ¾ of its width, outside the corner radii) were each compared with the card outside and the fill inside in the **same frame**.
Tab from the checked radio reached an independent outline without editing or submitting.
For the four open frames the probe records computed translucent base, static grain, top and side border colours, shadow and backdrop filter; sampled label ink and indicators come from the actual screenshot, not those declarations.
The menu frame and tested button were hit at their edges.
ArrowDown moved the `@` selection without leaving the editor; Tab reached Ambient light, the first view option and Zoom out.
The visible current-view stroke remained on Timeline while the first option had focus.
Worst observed contrast ratios (across the three widths per scheme):

| Painted ink / backing                                    | Obsidian                       | Alabaster                    |
| -------------------------------------------------------- | ------------------------------ | ---------------------------- |
| Other idea border / card, fill; Tab outline / card       | 5.783, 5.818; 11.568           | 5.589, 5.682; 10.378         |
| Mention name; selected stroke / row, menu                | 10.282; 10.157, 11.221         | 9.515; 9.430, 10.558         |
| Timeline label; selected stroke / row, menu; Tab outline | 10.157; 10.182, 11.105; 11.221 | 9.497; 9.515, 10.475; 10.558 |
| Ambient light label, on glyph; Tab outline               | 5.552, 5.552; 11.221           | 5.637, 5.637; 10.558         |
| Attached image title; Zoom out outline                   | 5.610; 11.221                  | 5.589; 10.378                |

The input was 244×37.19, 314×37.19 and 756×32.84 CSS px in viewport order.
The mention frame was 302, 372 and 830px wide; Details 180px, More 260px and the fixture lightbox 164.16px at all widths.
`pickerStates[].frames` binds samples to the unchanged geometry across each capture; `controls` includes copy-button bounds, ancestor clipping and five hit points.

For the synthetic `dockRun` and its `facet` step alone, `workflow-detail` returns a 37-character multiline file distinct from the preview.
From both the overview and child view, opening then pressing Tab and Space on Copy wrote **exactly once**, preserving indentation, trailing spaces, blank line and final newline, to the document-local write-only receiver.
All 12 copy controls were 32.5×28 CSS px, fully visible, with no extra detail read; the preview and folded state offered no visible file-copy action.
`detail-evidence-ajU167` additionally exercised the compact navigation-row sequence with both result reads before reopening the drawer (dark/320 only).
Earlier targeted probes `detail-evidence-EmPOK9` and `detail-evidence-t66c5e` stopped before completing the matrix: they recorded a changing mention border, missing sample geometry or an unreachable image/dock target.
Those frames are not counted as passes.

**Regression owners:** `test/web/theme.test.tsx` checks the component selectors, grain over card, input fill and opaque no-filter declarations.
`test/web/chat-timeline.test.tsx` drives `WorkflowCard` and `WorkflowAgentView` through controlled reads: closed/pending files are not copyable, the selected response supplies both the body and copy prop, and a late response or failed-step final refresh cannot turn the preview into a result.
`test/web/workflow.test.tsx` checks the localized copy label and bounded-file notice by SSR.
These tests are not pixel or clipboard evidence.
The browser samples are not a physical phone, a platform clipboard, a non-Chromium/no-filter engine or a live workflow executor.
This targeted run did not repeat the performance windows or the full candidate gate; the owner's final checks and independent review are separate.

### Keyboard paint in the `@` path menu

**Failed frame.**
The owner's full run `optical-evidence-AL8ylY` on `d5d2f36f` (web build `6764640acb2a`) supersedes the earlier targeted mention result above.
After the path-suggestions audit, ArrowDown selected `material.ts` in the DOM, but at 390 and 1440px in both schemes the expected stroke pixel was the menu base: RGB(25,26,30) or (253,253,254).
The original PNGs remain in that directory.
`mention-negative-hBPwsP/control.json` applies the glyph and stroke probes to those saved bytes, not to a re-rendering.
The menu bounds, `material.ts` Range and both stroke comparisons match the original recorded geometry exactly; the added hint and `facets` targets use their Ranges from the repaired layout.
All six comparisons rejected each of the four failed frames; both original 320px frames passed.
A valid selection and a high computed contrast on the glass did not mean the foreground was painted.

**Repaired build.**
In the same integration worktree over `d5d2f36f`, `bun run build:web` produced `f1b112df9bbfe454658cf334f4bda6ae3135c7c5b5dc30b6ef7c46deda999fa8`.
The listbox frame owns the illuminated border and shadow; its pointer-transparent `::before` owns the fill, grain, filter and opaque fallback.
Only `.mention-list` scrolls.
The real keyboard probe parks the pointer, moves from `facets` to `material.ts`, and verifies the textarea still controls the listbox and names the selected option.
It binds one viewport PNG to the same state and geometry on both sides of capture.
It measures both hint spans and both option names in their text Ranges, plus the original stroke point against the row and menu.
The menu-side RGB is also checked against the plate's allowed composited range.
Blur and grain declarations are read from the plate, not inferred from the text pixels.

Installed headless Chrome 151.0.7922.34, Linux, DPR 1, synthetic loopback reads, empty selected conversation, dark/light × 320×820, 390×820 and 1440×900.
Each directory below is under the inherited `TMPDIR` and retains `summary.json` and the actual keyboard PNGs.

| Targeted comparison                                                                                                                       | Round 1                            | Round 2                            |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ---------------------------------- |
| Original sequence, including the preceding same-page path-suggestions audit                                                               | `mention-evidence-erVyKn` (6/6)    | `mention-evidence-2bVZZp` (6/6)    |
| Path-suggestions background measured in a separate document; same `@` → `facets` → ArrowDown on a fresh document with no text suppression | `mention-independent-7nu33P` (6/6) | `mention-independent-u9gHma` (6/6) |

Worst ratios on the 24 keyboard frames (one unmodified PNG for all six comparisons per view):

| Painted ink / backing         |        Obsidian |      Alabaster |
| ----------------------------- | --------------: | -------------: |
| Folder hint / keyboard hint   |   5.610 / 5.610 |  5.686 / 5.686 |
| `facets` / `material.ts` name | 10.626 / 10.282 | 10.113 / 9.515 |
| Selected stroke on row / menu | 10.157 / 11.221 | 9.430 / 10.558 |

Both paths retained the separate under-text background measurement (worst 5.027:1).
Neither produced a sampling-only failure on this build; the full collector keeps the preceding audit in place.
In the separate 50-option fixture `mention-long-list-JRJvcA`, ArrowUp wrapped from the first to the last option.
At dark/320 and light/1440 the 320px frame did not move; the 318px inner scroller moved to 1252px and 1231px respectively, bringing the full row inside it.
Enter and Tab inserted the selected path; Escape closed without insertion or sending.
Without the list's scroll padding, the intermediate light/1440 run (`mention-long-list-VRYv25`) left the last row 0.39px outside its scrollport.
That intermediate build's two complete menu matrices (`mention-evidence-GdPffZ`, `mention-evidence-6ORen7`) and the partial pilot (`mention-evidence-jsr23t`, stopped before the second folder Hero) are not included in the repaired-build totals.

These are point samples, not continuous paint or physical-phone, hardware-GPU or non-Chromium qualification.
The no-filter fallback is covered by the stylesheet test, not an engine without filter support.
No live workspace, performance windows, full candidate check or independent review is claimed by these targeted runs.

### Reading the design card and tabbing into the history view menu

On pre-repair HEAD `c18484584fec` (build `f1b112df9bbf`), the owner's `optical-evidence-l5GjLf` recorded four failures.
At light/320 the empty input's top was −414px; the submit button received Tab focus but its visible height was zero and all five pointer hits missed.
At dark/320 Timeline remained selected while Tools had focus, but Timeline's computed ink changed from RGB(204,209,217) to (203,208,216) across the PNG.
In the same sequence on that build, `design-view-initial-8GkJUx` recorded a CSS `color` transition **on Timeline itself** from (138,147,162) to (203,208,216), as well as background transitions.
Its later screenshot did not reproduce the mismatch.

In the same integration worktree and task branch over `c18484584fec`, `bun run build:web` produced `a39cd87b62872931b63f97e7765833c4f8e1370868cc94382837b4a0a2f8c61f`.
Only the history view options opt out of the generic button transition.
Select Timeline, reopen the menu, move the pointer away and Tab onto Tools: the selected stroke, separate focus outline and menu material are all measured in one unmodified PNG.
Neither the `@` menu nor production scroll-follow logic changed.

**Targeted matrix:** `$TMPDIR/design-view-card-tRMBSX/summary.json` and 30 viewport PNGs; installed headless Chrome 151.0.7922.34, fresh profile, DPR 1, synthetic loopback projections, both themes at 320×820, 390×820 and 1440×900 (320 first).
In each design chat one wheel event hit the transcript; bottom distance went from 0 to 180px and Latest appeared.
Each control was positioned once.
`pickerStates[].positions` records pane metrics, target bounds and active control before/after positioning and on both sides of each shot.
At 320px the pane was 526px tall and the card 608px: the option group, empty input and submit button were fully visible **in turn**, at scrollTop 1932, 2117 and 2264 of scrollHeight 3376.
The input's top was 318.53px.
Submit occupied x=33–277, y=308.72–365.47; across all six views its clipping intersection equalled its full rect and all five hits succeeded before and after Tab.
No answer was edited, submitted or approved.
Real wheel/Tab reading did not snap back to the end in these observations.

| Worst ratio across widths                                | Obsidian                 | Alabaster              |
| -------------------------------------------------------- | ------------------------ | ---------------------- |
| Painted selected `Frames` / unselected `Everywhere`      | 16.569 / 17.134          | 17.813 / 15.456        |
| Other idea resting border on card / fill                 | 5.783 / 5.818            | 5.589 / 5.682          |
| Tab outline on card (empty input and submit)             | 11.568                   | 10.378                 |
| Timeline text / stroke against row / stroke against menu | 10.157 / 10.182 / 11.105 | 9.497 / 9.515 / 10.475 |
| Tools Tab outline against menu                           | 11.221                   | 10.558                 |

The design audit also measures under-text backings on the visible card: the minima were 5.498:1 (Other idea) and 4.808:1 (More compositing).
It cannot pass using text in the header or status bar.
An intermediate whole-page comparison failed on dark/1440 (`design-view-settled-70dxrZ`) although the two design option readings agreed.
The instrumented `design-view-sequence-5YKcH0` retained a light/1440 failed capture and both point lists: only the real latency numeral changed, from 1 to 0.
A clock or timing sample elsewhere is not part of a design control's identity.
The final design comparison targets the actual card, without retrying a changed frame; the other page audits retain their coverage.
Neither intermediate failure counts as a passing frame.

These are point samples on Chromium, not continuous paint, physical-device or cross-engine qualification.
The targeted run included the following open agreement but not the full collector, performance windows, final `verify` or independent review.
The owner checks the actual delivery candidate separately.

### Invalid math in chat and the history/Changes card material

Use the `questions` conversation for the missing-argument `\frac`; it is separate from the fixed idle, scroll and incremental timing specimens.
`readingStates` → `incomplete formula` targets the visible error span with its parse-error title, not other text in the scene.
An unmodified viewport PNG must contain a glyph stem inside the hit-tested source text range; compare it with the adjacent paragraph pixel.
A second capture suppresses only the text fill to sample the actual backing under the range.
Both checks require samples and at least 4.5:1.
The Markdown SSR test separately renders an unknown command: KaTeX colors a normal HTML math child there rather than emitting a `.katex-error` span.
It also checks that a valid fraction still renders.

**Local observation:** build `5ddac3383d1541b663e9c6eea60d0dd424e53cba5d7997ba99d227603b2a3771`, in the integration worktree over `44056c909532` before the repair commit.
`$TMPDIR/optical-evidence-7afNXD/summary.json` records the branch and build, with 143 scenes, no reported problems or unavailable scenarios.
Installed headless Chrome 151.0.7922.34, SwiftShader, DPR 1, synthetic loopback data; 320×820, 390×820 and 1440×900 in each theme.
Each of the six formula captures had one painted stem and three under-text samples.
The worst ratios were the same at all three widths:

| Theme             | Painted error text RGB | Backing RGB   | Worst ratio |
| ----------------- | ---------------------- | ------------- | ----------: |
| Obsidian Optical  | 227, 166, 174          | 9, 10, 13     |     9.739:1 |
| Mineral Alabaster | 132, 63, 80            | 244, 245, 247 |     6.856:1 |

`cardMaterials` records 18 states: the actual `.rtr` shell in History → Timeline, and the `.scm-file` article at rest and under the pointer in Inspector → Changes, for each theme/viewport pair.
The probe hit-tests each heading and compares the card's computed material on either side of one unmodified PNG.
All four edges were 1px solid; top/other edge alpha was .22/.10 in Obsidian and .94/.16 in Alabaster.
Both gradient tiles (5×7 and 7×11px) stayed in place, with no card animation.
The filter was 3px blur at compact widths and 5px at desktop, both with 105% saturation.
The 10px-offset, 30px-blur shadow stayed present.
Hover changed only the file fill, from .94/.92 alpha to opaque in dark/light respectively.

These are point-in-time Chromium readings, not physical-device or cross-engine results.
The material fields are computed styles, not isolated pixel measurements of each texture layer.
The no-filter fallback, `.scm-file.active`, the other shared card selectors and the unknown-command error shape have stylesheet or SSR coverage, not additional browser scenes.
The owner's final candidate checks and independent review remain separate.

### Open workflow progress card

In the `design` conversation, click `.workflow-line-open` and wait for `.workflow-board` before measuring the progress card.
`cardMaterials` scrolls `article.workflow-card > header > strong` into view, parks the pointer outside the card and hit-tests the heading.
It reads the enclosing article's computed style before and after a viewport PNG, not the conversation summary or a Bento step's surface.
The `assignments` scene still measures geometry and contrast separately.

**Local observation:** `$TMPDIR/optical-evidence-txT11A/summary.json`, build `e9980014b838b138f4d265a1f4ba92c66aca8e2417e820b3de7b45cbd901b0dc` over pre-commit HEAD `b932e25b` in the same integration worktree.
Installed headless Chrome 151.0.7922.34 recorded six resting progress cards: both themes at 320×820, 390×820 and 1440×900.
Their widths were 288, 358 and 800px respectively.
Obsidian's fill was `rgba(23, 24, 28, .94)`, with top/other edge alpha .22/.10; Alabaster's was `rgba(251, 251, 252, .92)`, with edge alpha .94/.16.
All had 14px corners, four 1px solid edges, two stationary grain tiles (5×7 and 7×11px), no card animation and a shadow with 10px vertical offset and 30px blur.
The backdrop blur was 3px at compact widths and 5px on desktop, with 105% saturation throughout.

These material readings are computed styles on mounted cards using synthetic data, not pixel measurements of individual layers or physical-device results.
The opaque no-filter backing is covered by the dual-theme stylesheet test, not by a fallback browser run.
Final `verify`, browser observation on the committed candidate and independent review remain the owner's checks.

### Compact wings, chat step cards and incomplete edits

On the integration worktree over `5bb760e8791d`, the canonical web build was `0f4271a12ed6b77cd681e69220a69c890f7ebb3bc33bf44d8b3100c12b1a5e6d`.
`$TMPDIR/optical-evidence-qllrhq/summary.json` binds the branch, build and viewport PNGs: installed headless Chrome 151.0.7922.34, SwiftShader, DPR 1, synthetic loopback data.
The full collector recorded 143 scene audits with no reported problems or unavailable scenarios.

In the separate `step-material` conversation, `cardMaterials` includes the two folded, readable steps rendered by `ToolStep` and `ThinkingStep` (not a turn activity flag) at 320×820, 390×820 and 1440×900, in both themes.
`wingMaterials` records both open drawers at each compact width in each theme: after the slide ends, the probe requires zero translation and a hit on a heading inside the non-inert wing.
The 12 card and eight wing readings compare the **mounted surface's computed styles** before and after a PNG.
A hidden element resolves expected token values only; it is not the measured surface.
The compact wing had 8px blur / 112% saturation and .80 dark / .72 light fill alpha; the cards had 3px compact or 5px desktop blur / 105% saturation and .94 / .92 alpha.
Both retained the two stationary grain tiles, lit top, three quieter edges and tier-specific shadow.

`surfaceContrast` is separate **pixel evidence**.
Each Tab frame compares an actual glyph stem and the focused control's solid outline to their adjacent backings in one unmodified PNG.
A second capture with text fill suppressed samples the surface beneath the visible text against its computed foreground.
Worst ratios across the tested widths (under-text / painted label / painted Tab focus):

| Surface and label       | Obsidian                 | Alabaster               |
| ----------------------- | ------------------------ | ----------------------- |
| Left wing, Running work | 10.977 / 11.960 / 11.960 | 7.994 / 8.369 / 8.374   |
| Right wing, Branches    | 11.321 / 11.668 / 11.951 | 8.043 / 8.043 / 8.374   |
| Tool, read              | 5.783 / 16.278 / 11.568  | 5.544 / 17.824 / 10.296 |
| Thinking                | 5.783 / 5.783 / 11.568   | 5.589 / 5.589 / 10.378  |

The opaque no-filter base is a dual-theme stylesheet regression, not an observation in a browser lacking filters.
Compact secondary labels use neutral ink: light secondary on the original translucent wing over scrim and grain computed to only 4.368:1.
The long transcript exposed a separate paint failure: `optical-evidence-snThAM` lost the dark desktop tool-summary copy focus.
In `copy-ring-diag-v4lOb1`, the entire card interior sampled as canvas even though the focus and box did not move.
The focused step now keeps its own fill and grain but paints its filter on a noninteractive plate behind them, not around the controls.
`copy-ring-diag-TzG8sC` measured that copy outline at 11.568 / 10.378 in the repaired build.
An intermediate full observation (`optical-evidence-h46kYd`) also recorded a low dark desktop mention-editor outline and stopped on the light/390 code fold.
These are not passing frames.
The new material sequence now follows the existing interaction sequences; the fold probe uses a settled button hit and checks both disclosure and pre after **each** click.
The mention threshold is unchanged; a single later pass does not establish the cause of the earlier outline reading.

The final report retains all twelve 2.6s frame windows and Paint roots.
Median intervals rounded to 16.7ms; scroll and incremental p95 ranged from 16.7 to 16.8ms with no intervals over 50ms.
One ambient-on idle window had one interval over 50ms (1/153); the highest idle p95 was 33.4ms in an off window.
The incremental windows recorded two tool-card Paint events each, on or off, with no ambient draws.
Hidden, reduced-motion and explicitly disabled also drew zero.
This does not identify every rasterized glyph or qualify hardware GPUs, physical phones or other engines.

`file-diff.test.tsx` contrasts a missing replacement side with an explicitly empty string, including mixed valid/invalid batches and legacy arguments.
`chat-timeline.test.tsx` opens the real `ToolStep` with controlled lazy detail and checks the displayed arguments and `CopyButton` payload, without a diff card or counts.
This is not an OS clipboard test or a claim about the file on disk.
Final candidate verification and independent review are the owner's checks.

### Composer paint bounds after artifact find

**Failed baseline.**
On integration HEAD `38b63ba9`, the owner's `optical-evidence-harqRF` failed dark/1440 on build `0f4271a12ed6`, despite a passing `verify` and an earlier clean browser run on the same build.
The form was at (434,747), 832×119 CSS px in both frames.
In `stable` a hard-edged patch began at (374,699), 60px left and 48px above the form, and ended at x=885 (exclusive).
It covered part of the degraded-read notice as well as the placeholder, mode and model; their DOM rectangles had not disappeared.

**Controlled comparisons.**
The evidence directories below are in the inherited `TMPDIR`.
Each series used a fresh local Chromium 151.0.7922.34 profile, DPR 1 and synthetic loopback reads from this worktree.
Each round opened history → Inspector → Changes → retained artifact, ran `observeArtifactFind` through views and pages, closed Inspector, then entered `optical-unknown` via `observeUnknownMode`.
Every first-ready and stable PNG was kept; neither a later phase nor a later round replaces a failed frame.
For CSS-only comparisons the fixture served the canonical CSS plus the indicated declaration from initial load; those are diagnostic variants, not new build identities.

- With unchanged styles, `bounds-baseline-Wp2jUl` passed 8/8 pairs.
  With **only** the anchored plate removed, `bounds-noanchor-AMyq0t` lost ink in stable round 3 at the original (374,699) edge.
- Shifting the broad shadow from (0,12) to (−48,−20), or increasing its blur from 40 to 72px, tinted the top notice witness: `bounds-offset-7gbAc0` and `bounds-radius-qi9dLd` each failed binding in all eight pairs.
  Radius round 6 stable also lost the form paint.
  These unbound frames are **not** passes.
- Changing only horizontal offset to −48px or reducing only blur to 24px preserved binding (`bounds-sideways-fin9b2`, `bounds-compact-O1YPRh`, 16/16 pairs each).
  Neither reproduced a translated hard rectangle: movement **with** the shadow was not established.
- We compared filter bounds instead.
  The anchor's resolved rectangle matched the form; an inset of 24px horizontally and 20px vertically moved it to (458,767), 784×79.
  Stable round 6 still painted the bad rectangle from (374,699), not the inset edge (`bounds-layersB-ZyxR6f`, 7/8 pairs).
  Neither the tool card at y=501–535 nor the left wing ending at x=251 intersected that patch.
  The unchanged and no-anchor/shifted-shadow layer controls each passed 8/8 pairs (`bounds-layersA-jr3JcM`, `bounds-layersC-LDUovX`).
  This compares CSS geometry and presented pixels, not an engine tile trace.
- Bounding the glass, grain and edges to the naturally sized dock stopped the observed spill but did **not** by itself preserve the native foreground.
  `bounds-local-d22zKb` (`e40998a35baf`) still lost ink on stable round 10 of 16; the notice remained at 7.542:1.
  Flat, negative-underlay and rim-only diagnostics each passed 16/16 (`bounds-flat-zQVHL7`, `bounds-underlay-M0AE8J`, `bounds-rim-GyikNq`), but on the canonical negative-underlay build `15876c41c44b`, **4/32 stable** lost ink (`bounds-backing-zK0w37`).
- On that last build, changing **only** the catalog trigger to replace its face immediately with its caption, rather than interpolating the old button colors, preserved all 32 ready and 32 stable foregrounds (`bounds-instant-hcNolJ`).
  The production change keeps the full blur/saturate backing and multi-shadow dock; it does not condition paint on mode, theme, viewport or test timing.

**Sampler negative controls.**
The original five foreground readings and unique top-rule binding remain mandatory in both phases.
`noticePaint` separately tests the lower stems of the notice's final word and its leading rule against adjacent padding on that same PNG.
Replaying the saved owner pair and the new plate-removal round-3 pair through the collector (`bounds-negative-owner-ObOiBM`, `bounds-negative-new-ICcIg8`) accepted ready, rejected stable and exited 1 in both cases.
In the latter stable the upper rule still bound the frame, but there was no lower word ink and the rule at (451,701) was RGB(64,51,57) on RGB(27,24,29), just **1.465:1**.

**Repaired canonical build.** `bun run build:web` produced `a68f69d32931aaa85d76544ba8c77bda351ad303a9989360a887f32fcb54ba4d` in the same integration worktree over `38b63ba9`.
`bounds-instant-build-KpnBYj` contains 32 dark/1440×900 pairs; `bounds-instant-matrix-per2T7` contains four rounds each of light/1440×900 and dark/light at 320×820 and 390×820.
All 104 frames bound and passed, without CSS overrides, GPU switches or recaptures.
Worst painted mode / model / placeholder / outside-notice word ratios were **15.917 / 11.879 / 5.939 / 7.542** in Obsidian and **17.355 / 10.468 / 5.637 / 6.396** in Alabaster.
The weakest composer combination was the Alabaster placeholder, RGB(94,102,117) on RGB(252,252,253).

In `capsule-bounds-height-4rXsug`, all six views kept the folder draft unsendable, the plate and form coincident, and the range hittable outside the form.
Shift+Tab landed on the grip; ArrowUp stepped 64→80 and raised the actual textarea from 67→80px; Home restored automatic height.
An earlier control harness incorrectly required a 16px geometry delta from a **snapped range value**, leaving manual height selected for its remaining grip samples (`capsule-bounds-interaction-vxKeWw`, failed).
The corrected comparison measures the textarea and the dock independently.
The four sides of the editor's keyboard outline contrasted at ≥5.558:1, and both Search models and an `@` item were hit outside the capsule at every size.
Both desktop flow sequences retained actual activity and stopped animation on failed observation and reduced motion.

**Limits.**
These are two presented frames per navigation, not continuous raster or a Chromium root-cause proof.
No physical device, hardware GPU, non-Chromium filter fallback or live service was qualified here.
The opaque fallback is covered by the theme tests.
Timing/follow measurements, full-candidate verification and independent review remain separate owner checks.

### Folder actions in progress and plain message leading

**Before repair:** The 143-scene report for `a68f69d3` did not measure text inside the disabled directory action or the line height of non-Markdown messages.
A targeted reproduction on those canonical bytes (`optical-evidence-RFBVsx/summary.json` under the run's temporary root, 320×820) found that the button's 0.45 group opacity also faded its status text.
Painted **Selecting / Opening** ratios were **1.821 / 1.798** in Obsidian and **1.529 / 1.535** in Alabaster.
The unsaved attempt paragraph measured 1.60× in both themes; that assertion stopped the pre-repair prose sequence before the pending or undelivered rows.

**After repair:** `bun run build:web` produced `951e70b63e298dffed8a5ffbda8a5dd52604b5a5fd6aff10371860d30433b45a` over pre-commit HEAD `8f6b3497` in the same integration worktree.
`optical-evidence-KNosEq/summary.json` and its 12 unmodified viewport PNGs record a targeted run in installed headless Chrome 151.0.7922.34, DPR 1, with synthetic loopback data at 320×820, 390×820 and 1440×900 in both system themes.

- **Folder actions (`pickerStates`):** The folder-first gateway and direct owner each received a typed path different from the displayed listing, followed by a click on the enabled footer action.
  Holding that path's directory GET exposed `Selecting folder…` or `Opening folder…` on the *natively disabled* button.
  Each button was fully within the viewport and clipping ancestors, with center and four inset edge hits.
  The minimum sampled glyph-to-adjacent-face ratio across both paths and all widths was **16.569:1** in Obsidian (RGB 242,244,248 on 20,21,25) and **17.813:1** in Alabaster (17,19,24 on 250,250,251), without DOM substitution or text suppression.
  Releasing the held GET with `invalid` produced the path error and restored the enabled idle label in all 12 cases.
  Ordinary browsing remained a read, not a busy Open.
  The fixture rejects unexpected writes; no selection or open command was exercised.
- **Plain message bodies (`leading`):** The existing unsaved `attempt`, a live conversation with queue and steer inputs, and a separate settled conversation with an undelivered input supplied four real body paragraphs per view.
  All 24 visible `p.chat-attempt-text` samples measured **23.1px line height at 14px**, within 1/64 CSS px of 1.65×.
  No withdraw, restore or send action was activated.

These are measurements of the English status labels and synthetic message bodies on those browser bytes, not physical-device, live-service, performance or full-candidate qualification.
The owner reruns the full checks and independent review on the delivery candidate.

### Code disclosure under the pointer

**Failure.**
On integration HEAD `52c9f1a4f799`, the owner's `optical-evidence-DywCt6` stopped after 14 dark/320 scenes on canonical build `951e70b63e29`.
Tab reached the buttons, but the first pointer fold was not observed.
No later scenes or timing windows in that run qualified.

We repeated reading → composer grip → Tab to fold and copy on those bytes in local Chrome 151.0.7922.34 at 320×820, DPR 1, using only the synthetic loopback fixture.
Evidence directories below are under the run's `TMPDIR`; each has a `summary.json` with the build identity.
The probe bound the `reading` route, mounted turn `00000001`, `ts` caption and exact generated `const crystal` line.
It retained the button and adjacent `pre`, not just a selector to query after input.

- In four rounds per path (`optical-evidence-S9zhi1`), centering an already visible control missed in round 3.
  The measured button spanned y=322.58–350.58; at pointerdown it spanned 281.58–309.58.
  All three trusted events at y≈336 hit `span.hljs-keyword`.
  Both nodes stayed connected, expanded/hidden stayed `true/false`, and the body remained visible.
  This is evidence of a stale coordinate, **not** a click resetting Markdown state.
  Natural bottom and real wheel-away pointer pairs each worked 4/4.
  The diagnostic's separate URL-substring poll counter and Enter dispatch did not establish a completed poll or keyboard activation; those cases are not passes.
- `optical-evidence-rqf1Fp` matched completed `cadence-conversation` reads by parsed request fields.
  A forwarding diagnostic setter recorded real writes to the pane's native `scrollTop`.
  In both rounds a real 48px wheel moved the pane from 1540 to 1492, then the workspace follow effect put it back at 1540 without a change to the 2066px transcript or 526px scrollport.
  Space after Shift+Tab generated the native button click and toggled both ways.
  The first repair removed the unconditional poll follow, but a repeated row ResizeObserver delivery still did the same write (`08b4ca041f5e`, `optical-evidence-LLo1EV`); passing at the natural bottom alone would have missed this defect.

**Repair and targeted result.** `ChatWorkspace` now compares the actual scrollable end for both render and resize notifications.
A changed end still follows reader intent; Latest explicitly jumps even if the extent did not change.
The 80px boundary and Markdown identity are unchanged.
`chat-timeline.test.tsx` distinguishes an unchanged poll *and* row observation at 48px from real content growth and scrollport resize.
Targeted Web tests passed (51 chat-timeline, 22 lazy-window); these controlled dimensions do not prove pointer behavior.

On canonical build `14ddd7a96204cb8300e329b19652a5c469f651a1d4a40785cb0adf1d59a3b5c8` over the same HEAD:

- In `optical-evidence-coGwZr`, four dark/320 rounds each measured at center, natural bottom and after the 48px wheel, held the measured point across a completed unchanged mode read, then dispatched once.
  All 12 fold/reopen pairs reached the original button.
  In every wheel round the gap stayed 48px and the button top stayed y=329.58 until activation.
  The resize from toggling the disclosure then legitimately changed the end.
- `optical-evidence-MOB2Zo` ran the revised qualification's reading section in both themes at 320×820, 390×820 and 1440×900.
  It measures without recentering.
  `codeDisclosures` records before/after connection and disclosure state, button bounds, scroll offset and gap, and capture-phase targets, bounds and trusted flags.
  All **24 pointer** activations (natural bottom and 180px wheel-away) and **12 keyboard** activations (Tab through Copy, Shift+Tab back, Space) completed on their original block.
  Collapsing produced `aria-expanded="false"`, `pre.hidden === true` and zero body height; reopening reversed both attributes and the visible opening keyword hit its own text range.
  At dark/320 the resting fold and copy bounds were x=23–69.89 and x=254.5–287, both y=281.58–309.58.
  Transcript, clip and hit geometry are in the same report.
- On those six views the adjacent lazy tool still followed expansion at bottom, kept the reading anchor while away, and resumed follow after Latest and viewport resize.
  In a separate light/desktop streaming observation, growth followed from top 564→738; after a real wheel it kept top 558 through the next increment, and Latest returned to gap zero.

**Not the full matrix.**
These are synthetic local Chromium reading/scroll observations, not physical-device, performance, auth or all-surface qualification.
The owner still runs no-argument `bun run verify`, the full `node scripts/qualify-optical.mjs` matrix (including timing/paint windows) and independent review on the actual delivery candidate before integration.

### Live subagent scroll, recorded thinking and plan validation

The earlier owner's `optical-evidence-ps2SRI` on `32d31c70` did not exercise these three states.
The following is a **targeted** observation on that pre-commit HEAD plus the repairs, in the same task branch and integration worktree.
`$TMPDIR/optical-evidence-J6uqLT/summary.json` records canonical WebUI build `a0bce69fbfa5aa5ababd729f02f84835a431f14f5ff8f3fd759142a9d5efc100`, installed headless Chrome 151.0.7922.34 and synthetic loopback records.
DPR 1; both themes at 320×820, 390×820 and 1440×900.

- **Subagent:** `agentScroll` enters a separate running child through its dock row, not the terminal retained-result specimen.
  Each released transcript GET has a numbered notice; sample only once that response is rendered and the pane geometry is stable.
  The table gives `.workflow-agent .chat-messages` geometry in CSS px, identical in the two themes.
  After the real −48px wheel, reads 2 and 3 both left the initial dimensions and the reading offset unchanged.
  No sampling step centered the transcript.

  | Width | Scroll height / client height | Initial top → wheel top → poll 2 → poll 3 | Top on first growth | Top after −128px, held through expansion and growth | Top at keyboard Latest → next growth |
  | ----- | ----------------------------- | ----------------------------------------- | ------------------- | --------------------------------------------------- | ------------------------------------ |
  | 320   | 1854 / 680                    | 1174 → 1126 → 1126 → 1126                 | 1291                | 1163                                                | 1916 → 2032                          |
  | 390   | 1531 / 698                    | 833 → 785 → 785 → 785                     | 949                 | 821                                                 | 1549 → 1665                          |
  | 1440  | 1205 / 787                    | 418 → 370 → 370 → 370                     | 535                 | 407                                                 | 1134 → 1251                          |

  The followed growth, Tab/Space Latest and growth after Latest all ended at gap zero.
  While away, one pointer click on the visible tool disclosure increased the extent by 483–508px without moving the reader.
  For desktop emulation hit-test the upper inline padding for the wheel: in `optical-evidence-3wPY6j` a center wheel reached the DOM but did not scroll.
  There was no follow write or extent change.
  An event alone is not a scroll measurement.
- **Thinking:** `step-material` opens the recorded thinking disclosure.
  `leading` checks the visible range of the exact two-line text node in `.thinking-body` rather than its title, Markdown or loading message.
  All six measured 21.45px line height at 13px font size (1.65).
  The unit/SSR cases for body-free activity remain separate; the browser did not read hidden reasoning from a live model.
- **Plan:** in `pickerStates` → `plan-validation`, the settled conversation has an installed model and a stale proposal catalog identity.
  Click the enabled **Validate plan again** action and hold its matching `conversation-models` GET.
  A still-enabled button, different label, missing stem or missing backing sample is not evidence of busy contrast.
  All six unmodified viewport PNGs show the disabled **Validating plan…** label.
  At each width, the dark stem RGB(242,244,248) on the button face RGB(20,21,25) measured **16.569:1**, the light stem RGB(17,19,24) on RGB(250,250,251) **17.813:1**.
  The fixture then returned a read error: busy cleared, the validation action was available again and no Send, validation command, approval or implementation request was made.

These are local browser viewport observations, not physical-device, hardware GPU or real-service qualification.
They do not rerun the performance windows or replace the owner's full matrix, no-argument `verify` and independent review on the eventual delivery candidate.

### Conversation workspace and transcript (targeted local observation)

The `quiet-workspace` and `transcript-polish` groups exercised canonical build `e0a73edb2eaab2047db789d37a943f4daf91320e3f1acb64bede9f1f4ff7af80` over pre-delivery HEAD `f193839d9766df787aed49a80fc3019706797390` in Chrome 151.0.7922.34.
Reports `optical-evidence-kn0TYA` and `optical-evidence-qKtZOz` contain the per-view controls, reading offsets and PNGs; each recorded six completed views and zero problems.

- At widths 320/390/1440 in both themes the new dock started at y=439.63/424.78/527.53, with no transcript shelf.
  The same focused editor kept its attachment through a refused Send; after the admitted first message the dock and pane boundary met at y=606/606/736, with a 72px shelf and zero bottom gap.
  The 390px view used reduced motion and still reported the receipt in text.
- The 90-second fixture kept one focused history row for the reply and its two linked workflows through phase updates and an unavailable read; it stayed up with one workflow and returned to history only after settlement.
  The title opened one proposal without a stream-tail card; further discussion, replacement, cold refresh and explicit revalidation did not reuse an old open panel or submit implementation approval.
- In each mixed trace the 15 completed tool calls counted as 15, not 16 for the body-free thought; expansion made zero detail reads, and the disclosure arrows had a 0px spread.
  With auto and tall composers the paired ink/no-ink images differed at 18,632–66,984 pixels in the visible region and **zero** pixels from one row above Latest through the protected region, dock and bottom gutter.
  Desktop scrollbar dragging and keyboard jumps reached the older question; phone rails stayed hidden.

These are targeted synthetic observations, not a pass of the no-argument optical matrix or a run against a provider.
An additional older `--group=dark:320` run (`optical-evidence-ckqDPw`) stopped at the disabled-model scene: its session advertises `actions: false`, so the real picker disabled all three options, not just the two ineligible entries assumed by the probe.
That run did not qualify later legacy scenes.

**Final conversation build:** Both conversation groups ran again after the optical repairs below, against `a57d98d4287ffe4fc2f2bbb110e50d27aa0cbdf66b0bbc5083384536fea994a5` in Chrome 151.0.7922.34.
`optical-evidence-FixLvG` (quiet-workspace) and `optical-evidence-Unfp4d` (transcript-polish) under the session `TMPDIR` each contain six completed views, zero problems and no unexpected requests.
In both themes the plan opened and closed over the existing transcript at scrollTop 1313/1290/499 for widths 320/390/1440; the editor remained focused on publication and later discussion left no implementation button in the stream.
After the 90-second controlled roster sequence there was no background brand feedback.
The trace arrows again had a 0px spread, and resizing the editor while reading left scrollTop unchanged at 6452/4604/2447 before Latest restored a zero bottom gap.
Across the twelve ink/no-ink pairs the visible region changed at 18,632–66,984 pixels; the protected strip, editor and gutter each changed at zero pixels.
These reports exercise keyboard input and reduced motion (390px); they do not exercise a physical phone, real provider or execution approval.

### Legacy probes on the same conversation build (targeted, not a matrix pass)

`optical-evidence-9APiKJ/summary.json` under the run's `TMPDIR` is the subsequent `node scripts/qualify-optical.mjs --group=dark:320` observation on build `e0a73edb2eaab2047db789d37a943f4daf91320e3f1acb64bede9f1f4ff7af80`, Chrome 151.0.7922.34, DPR 1, 320×820.
It reached 24 scene audits and the final plan-validation probe, then **exited 1 with two problems**.
The default loopback viewer remained readonly.
A separate origin projected a current viewer for the eligible-control cases; both servers still refused writes other than detach.
Both unexpected-request ledgers were empty.

- Tab and Shift+Tab reached `fixture/optical` in the current viewer and skipped both disabled buttons.
  The *painted* reasons for quartz and slate measured 6.111:1 and 6.035:1.
  In the readonly viewer all three were disabled and Shift+Tab returned to search, but the global lock reason **was not readable**.
  `models-readonly-dark-320-failed.png` shows it underneath the footer: the text Range spans y=785.61–801.61, while the status bar starts at y=769.
  The fixed compact `.model-popover` is inside the `.composer-dock` stacking context; the probe did not hide the footer or accept a DOM string instead of visible ink.
- The opened design dialog retained transcript top 1289 with Latest present.
  Its selected and unselected options were visible, but `other-idea-dark-320-rest.png` failed the original 3:1 border check.
  The empty input border RGB(66,69,77) measured **1.832:1** on the card and **1.925:1** on the fill.
  `web/src/components/workspace/design.css` has a resting `.design-custom` rule, but the canonical CSS on this build contains no `.design-custom` selector.
  The subsequent input/submit Tab frames were not reached in that scene.
- The independent workflow dot stayed at (23,118) on `design` through both selections, other-row hover and keyboard focus.
  On selected `reading`, the face at (14,244) was RGB(21,28,45) against wing RGB(12,15,21); the outer focus at (6,244) measured 6.207:1.
  File and subagent rows retained their stroke and focus checks.
  The open left drawer's **Conversation history** and the right drawer's **Branches** both passed their text, focus and material probes.
- Unknown mode retained its original ready/stable PNG comparison: the `Message` placeholder stem measured 10.025:1, model text 6.120:1 and the unknown thinking level 5.421:1.
  With a running reply, Low/Medium/High were native disabled and Tab went search → Stop → search.
  No model choice or Stop was activated.
- Opening the current plan from its title made zero validation reads.
  The explicit validation held exactly one `conversation-models` GET for `validate-specimen`.
  The disabled busy label measured 16.540:1; the failed read displayed `invalid` inside the panel and restored the enabled **Validate plan again** control.
  A subsequent catalog refresh was not a second validation.
  No approval or execution request was issued.

**Desktop boundary:** the `dark:1440` and `light:1440` groups (`optical-evidence-V2CVCk`, `optical-evidence-TYLjUo`) both reached the readonly/current picker comparison.
At dark/1440 the readonly reason passed at 6.111:1.
Neither desktop group passed: the right sash's middle outside sample at (1075,458) fell on the transcript scrollbar, measuring **2.269:1** dark and **2.811:1** light (required 3:1).
A separate dark 1440×900 diagnostic (`optical-evidence-PGuqUp`, **desktop-context-subset**, not a rerun of those groups) Tab-focused the enabled Queue and Steer buttons with the draft intact, without activating them.
It completed the reply-locked picker, all nine composer-flow observations (including `Conversation read: stale.`, recovery and reduced motion), and the held/failed plan-validation read with zero unexpected requests.
No new browser, provider, consumer profile or build participated.

### Compact picker, design field and pane focus: rebuilt candidate

`bun run build:web` produced `66907e8aec0e006c90842c3653a00c10a023015a41206d1df840e44b1015e2d3`.
The three original `node scripts/qualify-optical.mjs --group=…` commands used that build, installed Chrome 151.0.7922.34, DPR 1 and disposable profiles.
Reports below are relative to the run's `TMPDIR`; each group has `summary.json` and `progress.ndjson`.
All three exited **1**, not a matrix pass:

- `dark:320` (320×820), `optical-evidence-BVC5qf`: 24 scene audits; the design submit geometry and its dependent frame assertion failed.
- `dark:1440` (1440×900), `optical-evidence-OZzCY0`: 15 scene audits; stopped waiting for Latest after the wheel over the folded tool.
- `light:1440` (1440×900), `optical-evidence-fPC8Hx`: 15 scene audits; also stopped at that wheel, with an earlier 1.055:1 Latest-label reading in the tool-output scene (white on sampled RGB(247,249,252), required 4.5:1).

**Picker:** At 320 the readonly lock reason's ink at (43,741) measured 6.111:1 on its backing at (19,742).
All three options remained native disabled: Tab skipped them and Shift+Tab returned to search.
On the independent current viewer, both directions reached `fixture/optical` while skipping quartz and slate; their reason glyphs measured 6.111 and 6.035:1.
No option, approval or execution was activated; both unexpected-request ledgers were empty in all three groups (non-GET refusal, detach excepted).
`style-boundaries-XpJM27/report.json` and its three PNGs supplement the group: the 320px dock grew from 151 to 404px via the keyboard grip, but the menu bottom stayed at 761, above the status bar at 769.
At 530×660 the footer occupied 33 rather than 51px; the menu bottom followed it to 619 (workspace bottom 627), with visible lock ink at (43,599), 6.104:1.
All three frames had a nonempty internally scrollable list and three disabled options.
An initial supplemental capture (`style-boundaries-C4w5PB`) crossed catalog arrival and failed its stability assertion; the three-frame comparison waited for the actual disabled catalog before sampling.

**Design:** In the compact report's `other-idea-dark-320-rest.png`, x=94/160/226 at y=407 sampled RGB(176,190,209) on the actual empty field border, 9.314:1 against the card at y=405 and 9.783:1 against the fill at y=410.
Tab from the selected radio produced a 5.686:1 outline at y=404 against y=402 (`other-idea-dark-320-tab.png`).
The subsequent Tab reached the enabled submit button without activating it, and the center and four edge hit tests all reached that button.
In `other-idea-dark-320-failed.png` its ring at (12,655) measured 5.414:1 against (9,655).
The formal `submit-tab` frame still **failed**: `controlGeometry` intersected the button (x=15–305, y=635.36–675.86) with `.chat-messages` ending at y=606, reporting zero visible height.
`ActionDialog` uses `showModal()`; the open dialog was in the top layer and filled the 320×820 viewport, not clipped to the transcript behind it.
The transcript remained at 1307 with Latest present.
Check clipping up to the modal and the viewport, retaining all button edge hits and pixel assertions; do not reposition the dialog to fit the transcript.

**Sashes:** The original top/middle/bottom samples were at y=131/458/785 for both 6px handles.
On the left, ink x=258 against outside/inside x=255/260 measured at least 17.623:1 dark and 15.424:1 light.
On the right, ink x=1078 against x=1075/1080 measured at least 6.240:1 dark and 7.999:1 light; the limiting surface in both was the scrollbar thumb at (1075,458).
Both sashes received Tab focus; the solid 2px line and all five hit positions were retained (`controlFocus` in the two desktop reports).
In the subsequent desktop `expand` scene, folded and expanded bottom-follow were observed, but away/Latest was not.
In the supplemental dark desktop diagnostic, a trusted −144 wheel at (845,443.33) hit the `material.ts` subtitle; `scrollTop` stayed at 702 of 702 and Latest never appeared.
Neither that diagnostic nor the compact submit screenshot substitutes for the failed group assertions.
The later desktop scenes were not reached.

### Top-layer controls, native wheel input and Latest paint

The requested three groups ran against the same canonical `bun run build:web` output, `a57d98d4287ffe4fc2f2bbb110e50d27aa0cbdf66b0bbc5083384536fea994a5`, over pre-delivery HEAD `f193839d9766df787aed49a80fc3019706797390`.
Installed Chrome 151.0.7922.34, DPR 1, disposable profiles and the separate synthetic readonly/current-context viewers; report directories below are under the inherited `TMPDIR`.
Each has `summary.json` and `progress.ndjson`.
These are complete invocations of the named groups, **not** a no-argument matrix or `verify` result:

| Command                                               | Exit | Scene audits | Report                    |
| ----------------------------------------------------- | ---: | -----------: | ------------------------- |
| `node scripts/qualify-optical.mjs --group=dark:320`   |    0 |           24 | `optical-evidence-QA65K8` |
| `node scripts/qualify-optical.mjs --group=dark:1440`  |    1 |           23 | `optical-evidence-eKggpk` |
| `node scripts/qualify-optical.mjs --group=light:1440` |    0 |           23 | `optical-evidence-j9Q0U5` |

All reached the final plan-validation probe, with empty `unexpectedRequests.readonly` and `unexpectedRequests.currentContext` in each report.
The dark desktop failure was after the requested modal and scroll cases; its first-ready unknown-mode frame is **not qualified** (details below).

**Modal.**
In `other-idea-dark-320-submit-tab.png`, the enabled design submit button's visible and full rects both span x=15–305, y=635.36–675.86.
`pickerStates` records the center and all four inset edges hitting the button and actual Tab focus; ring (12,655) against (9,655) measured 5.414:1.
The transcript stayed at 1307 with Latest visible on both sides of the capture.
No submission occurred.
On desktop the same Tab ring at (658,708) against (655,708) was 5.408:1 dark / 5.421:1 light; transcript top remained 482.
The clip list stops *after* the nearest `dialog:modal`, not at its parent scroller and not at an ordinary open dialog.
A separate Chromium clipping probe of a 110×72 button inside nested overflow measured 60×20 under `show()`, 75×31 under `showModal()` (both the dialog and its inner scroller still clip), and 45×31 after the modal crossed the left viewport edge.

**Wheel.**
Both desktop `inputWindows` changed the native 780×580 window at (10,10) to 1472×1024 at the same origin; the page stayed 1440×900.
`toolWheels` records the original `material.ts` center hit at (845,443.328), `deltaY=-144`, a trusted non-prevented wheel and the actual scroll.
ScrollTop/clientHeight/scrollHeight went from 702/654/1356 to 558/654/1356, stable bottom distance **144px**.
By the time the passive DOM listener saw the event, the compositor had scrolled and the same screen point was over prose.
Opening the same head grew the extent to 1845 with top still 558 and the same paragraph (index 16) still 23.125px from the pane top.
Latest reached top 1191 (bottom gap 0); reducing the viewport to 804px tall changed the pane height to 558 and top to 1287, still gap 0.
No scroll position assignment or product follow change was needed.

**Latest ink.**
The light/1440 tool-output page audit retained all 200 visible text samples.
`latestPaint` binds one button (x=780.375–919.625, y=692–724), its text Range (x=813.375–904.625, y=699.203–716.203) and text/backing hits on both sides of both viewport PNGs.
`tool-output-light-1440-original.png` has a white stem at (827,706) on RGB(23,30,41) at (811,707): **16.744:1**.
The face against the adjacent shelf at (944,707) measured 15.876:1.
In `tool-output-light-1440-no-glyphs.png`, both the former stem and adjacent interior pixel are RGB(23,30,41).
Neither the label nor its backing was omitted; no frame was replaced and no `.scroll-bottom` paint or sampling-coordinate correction was warranted by this pair.

**Newly reached cases and limits.**
On `66907e8aec0e`, two instrumentation pilots stopped after lightbox (`optical-evidence-8gBMln`, `optical-evidence-cXTFNn`, exit 1): the original point had hit the head but the passive event arrived after it moved.
They did not observe later cases.
The next full groups on those bytes reached the final probe: compact dark exited 0 (`optical-evidence-0umcBQ`); both desktop groups exited 1 (`optical-evidence-yJJR4P`, `optical-evidence-msd0D7`).
At (611.45,542.86), 1px inside the implementation button, desktop hit-testing returned the card instead.
Positioning the inline actions relatively preserved their rectangles and restored all five button hits in the rebuilt groups (never activated).
In both light desktop unknown-mode frames the small reasoning dash painted at only 3.333:1; using the existing primary ink raised it to 5.577:1 on the same backing without resizing the control.

The remaining `dark:1440` problem on the rebuilt bytes is `unknownMode` → `ready`: the original `unknown-dark-1440-ready.png` matched **two** before/after candidate bindings, not exactly one.
Both have the same alert-rule landmark at (451,631), mode button, capsule and viewport.
The stable frame passed; it does not replace the unbound first frame.
`notice-bindings-drYp9G/report.json` is a separate diagnosis, not a substitute group run: holding then releasing the same synthetic conversation-models GET moves the dash Range from x=681.05–690.89 to x=668.39–678.23 without moving that notice landmark.
The pending trigger has a transparent top border; the settled trigger's top edge is RGB(100,141,255).
The original failed PNG has the latter at (597,815).
For `modeFrame` / `observeUnknownMode` in `scripts/optical-fixtures/composer-observations.mjs`, use an independent trigger-edge witness **in addition to** the notice rule when these two layouts cross one capture; retain the original first-ready frame, unique binding, and all six foreground checks.
An ambiguous binding is not a contrast pass.

### Unavailable-mode first frame: model edge binding

**Retained frame:** The collector replay used the original `optical-evidence-eKggpk/unknown-dark-1440-ready.png` (SHA-256 `3f5e224d72386fcf5bb730346750b977000ec3ff1daa3e162f5712a747ff1f67`) and the same canonical build `a57d98d4287ffe4fc2f2bbb110e50d27aa0cbdf66b0bbc5083384536fea994a5`.
`model-edge-replay-smH1j8/report.json` under the inherited `TMPDIR` records both geometries around the controlled catalog response, matching `notice-bindings-drYp9G`.
Both matched the notice at (451,631); only **Choose a model** matched the trigger edge:

- **Reading models…** (232.39px wide, dash x=681.05–690.89): its transparent top would match its adjacent padding, but the PNG edge at (603,815) was RGB(100,141,255) against RGB(13,17,24) at (603,816).
- **Choose a model** (219.73px wide, dash x=668.39–678.23): the PNG edge at (597,815) exactly matched its computed solid RGB(100,141,255); the padding at (597,816) was RGB(13,17,24).

Replay exited 0, binding candidate 1 **before** checking glyphs.
The request gate was only for reconstructing the two geometries: holding one conversation-models read alone initially worked (`model-edge-replay-e1JXXE`, exit 0), but a second attempt already had the settled catalog (`model-edge-replay-TSdCCJ`, exit 1 on the two-layout coverage assertion).
The final replay held catalog GETs including the project preview; the normal group has no such gate.

**Live group:** An intermediate `node scripts/qualify-optical.mjs --group=dark:1440` exited 1 (`optical-evidence-wcXnev/summary.json`): both candidates matched because the native tooltip had changed, not the displayed caption, rectangle, dash Range or border.
The collector now records both tooltip strings separately from layout identity; different sampling targets still require exactly one match.
The same complete group on the same build exited **0** (`optical-evidence-NsQuMF/summary.json`, `progress.ndjson`, 23 scene audits, zero problems).
In its first `ready` capture only the tooltip changed; `stable` had the same settled layout and its own PNG.
At 1440×900, DPR 1, each frame contained the three mode-label samples at 16.832/16.297/16.832:1, model at 6.120:1, dash at 8.709:1 and placeholder at 10.025:1 (all opacity 1); notice text and rule each measured 7.542:1.
The route, degraded notice and native disabled mode name/title matched in both phases; `unexpectedRequests.readonly` and `unexpectedRequests.currentContext` were empty.
This is one targeted group, not a rerun of `verify` or of the full optical matrix.

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
