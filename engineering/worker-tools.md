# Worker tools and observation

How an admitted worker receives Pi tools, where they operate and who joins their original work.
Parent process, Stop and checkout ownership remain in [lifetimes](lifetimes.md).

## Ownership and capabilities

- `src/worker-workspace.mjs` binds immutable cwd and investigation roots without filesystem access.
  `executionDirectory` maps the pinned execution context into an owner-selected tree; it creates no directory, branch or worktree.
- `src/service/worker-settings.ts` observes owner-bound Pi settings/trust only on explicit admission or proposal preparation.
  Readonly observed bytes go to public `SettingsManager.fromStorage`: Pi owns migration, global/project merge, tool modifiers and selected-model compaction resolution.
  Saved nearest project trust wins over global `defaultProjectTrust`; absent/ask/never does not borrow terminal-only consent.
  Sources retain their ownership/identity checks and are never rewritten.
  Pi's trust getter may take its short native lock on an existing store.
- `src/worker-model.mjs` projects execution preferences into a bounded private snapshot: compaction with resolved model overrides, agent request retry, explicit provider request timeout, HTTP/WebSocket policy, transport, thinking budgets, image preferences, shell path/prefix and standard tool selection.
  Model/provider/thinking **selection** still belongs to the admitted conversation context.
  No package, extension, auth or profile discovery data crosses this seam.
  `WORKER_POLICY` contains service exceptions: no cache-warming traffic or provider-internal retry layer; absent HTTP idle policy means disabled, while an explicit Pi idle timeout is honored.
  These are request policies, not worker lifetimes or tool-call quotas.
- `src/worker-toolkit.mjs` composes admitted Pi tools directly, without a second policies/bundles registry or role-specific editing subset.
  Editing uses Pi's `defaultTools`, including modifiers, or `createCodingTools` defaults when unset.
  Readonly work uses `createReadOnlyTools` when unset; an explicit selection is intersected with those readonly tools.
  Unavailable configured tools refuse rather than silently selecting a replacement.
  The editing selection supports analysis, experiments, editing and debugging throughout the authorized implementation.
  Standard file definitions remain Pi's.
  `bash` and selected `powershell` retain Pi schemas/renderers/backends with a bounded, redacted no-spill accumulator; bash honors the pinned shell path/prefix.
  Nonconversation editing also receives `cadence_report`, not verification or authority.
  Independent research/diagnosis/review remain readonly; only fixed-candidate Review gets `changes`.
  Coordinators get only the owner bridge, never host editing or self-approval authority.
- This inherits persisted settings and standard tools, not a terminal's live extensions, CLI/session-only overrides or MCP closures.
  Missing tools are not installed.
  Headless custom tools need explicit integration, not profile copying or a claim that process-local closures were inherited.
- `src/research-tools.mjs` composes the installed public Pi tool definitions, preserving their schemas, descriptions, renderers, output and strict-sampling preferences.
  Its small host adapter binds relative operations to the first investigation root, refuses known nonregular read targets and keeps search offline.
  It does not implement another scanner, file schema, batch engine or cursor registry.
- `src/sdk-worker.mjs` passes explicit tool names/custom definitions to Pi, verifies actual active names match exactly, then applies toolkit lifetime accounting before capture ingress.
  Omitting the tool allowlist would enable SDK defaults, not mean no tools.
  Ordinary conversations keep the same standard SDK file tools and resource-loading behavior.

These are host tools, not a sandbox.
A shell does not become readonly through a prompt or a fixed cwd.
Git delivery, approvals and service management retain their separate consent contracts; there is no plugin-selected capability or implicit service startup.

## Admission and settings lifetime

An ordinary Send or readonly research admission captures one private runtime snapshot.
Delivery proposals display its credential-free summary and bind it in the source observation; prepare/execute re-observe it, so changed tools/settings require a fresh proposal and confirmation.
Older proposals remain readable but cannot authorize an unbound runtime.
After acceptance, every implementation, diagnosis, review, repair, knowledge worker and request-auth refresh uses that same snapshot.
Editing `.pi/settings.json`, changing preferences or entering the stable worktree does not reconfigure admitted work.
Child `SettingsManager.inMemory` cannot write either source; worktree profiles are neither copied nor rediscovered.
Retained summaries/hashes are evidence, not restart instructions.
The projection excludes resource discovery, interactive UI preferences and model selection.
Existing context/skill loading remains its separate controlled seam; inheritance does not introduce a full default resource loader.

## Ordinary file operations

Use the same parameter protocol as Pi:

```js
read({ path: "src/service/workflows.ts", offset: 100, limit: 30 });
grep({ path: "src", pattern: "CheckoutGate|settle", glob: "**/*.ts" });
find({ path: "src", pattern: "**/*.ts", limit: 100 });
ls({ path: "src", limit: 100 });
```

There is no ordinary `glob` tool, `files/ranges` batch, `patterns` array, `pageSize`, `cursor` or `close` operation.
Call `read` per file and use its next-offset notice for remaining text; use regex alternatives for a multi-pattern search.
This removes the flat initial/query/close schema whose mutually exclusive fields could become impossible to fill when a provider required every field.
Do not reintroduce a second ordinary tool protocol to handle provider argument normalization; Pi owns its standard schemas and validation.

The session cwd remains pinned; readonly file-tool defaults use the first investigation root even when Pi supplies its session cwd in the execution context.
Other roots are selected explicitly, not implicitly searched or merged.
Absolute paths, tilde paths and regular-file symlinks can inspect installed packages outside the checkout.
Roots are navigation defaults, not filesystem permissions.
A known device, socket, pipe or directory is not opened by `read`; this precheck is not a hostile-filesystem or change-and-revert guarantee.

Pi owns formatting, images, matching, `.gitignore` behavior and truncation notices.
Searches respect ignore rules; inspect ignored dependencies/backups through explicit paths and directory listings rather than claiming they were searched.
Results are ordinary text/image content, not a Cadence JSON coverage envelope.
Truncated results are partial evidence; multiple offset reads are live observations, not an atomic source snapshot.
Fixed-candidate review and delivery checks remain separate from these ordinary reads.

The SDK child already requires `PI_OFFLINE=1`; the readonly search adapter also checks it before invoking Pi.
`grep` and `find` use existing `rg` and `fd`/`fdfind` installations or Pi's existing tool cache.
Missing search binaries produce an error without an automatic download, install or profile copy.
This is dependency availability, not permission to enable shell in a readonly role.

## Fixed Git review evidence

`src/change-tools.mjs` retains the specialized `changes` tool for the owner's fixed base/candidate commits.
Its only inputs are paths/diff/base/candidate modes, literal checkout-relative paths and one-use continuation/close cursors.
The owner supplies immutable full OIDs; model arguments cannot substitute them or grant this capability to another worker.
The tool streams Git under backpressure, joining actual child closure on cancel, expiry or disposal; no source copies or spill files are created.
Only successful native EOF/close establishes complete coverage; binary, invalid UTF-8 or unavailable objects cannot become complete empty results.
The shared Git policy removes alternate index/worktree overrides and disables replacements, external diff, textconv and pagers.

Only this specialized tool retains optional nullable cursor fields.
Unknown keys still refuse even if null; non-null query/cursor mixtures refuse without consuming a cursor, guessing intent or replaying work.
Limits live beside `CHANGE_LIMITS`; model-visible evidence, transcript retention and coordinator previews are separate coverage facts.

## Original-operation lifetime

The toolkit stops new admissions and joins each original tool call.
Some installed SDK file tools reject their abort observer before the underlying asynchronous operation settles.
For `read`, `find`, `ls`, `write` and `edit`, the toolkit checks cancellation before admission, invokes the original without that early-rejection signal and waits for its actual promise without a worker deadline.
If cancellation arrived meanwhile, the result reports canceled only after settlement and explicitly allows that the operation may have completed.
An admitted write is never claimed to have rolled back, and no operation is replayed.
This applies to both readonly and editing file tools, not just research.
Pi's `grep` already signals its child on abort and waits for actual child close, so its signal is preserved, as are the shell and fixed-Git stop-and-join paths.

There are no suspended ordinary scans, idle cursor timers or model-managed file handles.
A stuck worker remains owned and observable until explicit Cancel/Stop or a real failure; no inactivity timer or tool quota replaces the removed deadline.
SDK abort, toolkit cleanup and native worker closure remain separate facts; an unconfirmed original cannot release the checkout gate.
The coordinator bridge likewise keeps sent requests until their reply or actual disconnect, without replay.

## Regression owners

- `test/research-tools.test.mjs`: real Pi read/list output, offset continuation, selected roots, explicit paths, aliases, truncation, known nonregular targets and noninstalling search guards.
- `test/research-tools-schema.test.mjs`: exact public SDK schemas and pre-send Responses payloads with strict capability present, absent and disabled; ordinary file tools have no cursor/query ambiguity.
- `test/research-tools-settlement.test.mjs`: actual SDK reads delayed at the public operations seam; cancel and close cannot settle before the read does.
- `test/research-tools-process.test.mjs`: installed SDK search adapters with controlled native spawn/close events; grep cancellation still signals its child, find waits for its original, and process failures never become empty evidence.
- `test/worker-settings.test.ts`: Pi defaults/merges/model overrides/trust, invalid-source refusal, frozen preferences and no source writes.
- `test/worker-toolkit.test.mjs`: inherited editing selections including PowerShell, native shell metadata/backends, readonly boundaries, fixed cwd, standard file original settlement and coordinator isolation.
- `test/change-tools.test.mjs`: fixed-revision evidence, UTF-8 continuation, nullable cursor arguments and native cleanup.
- `test/coordinator-tools.test.mjs`: dispatch, cancellation, actual reply/disconnect and listener lifetime.
- The retained slow `service-workflow` fixture checks selected-root search through a real SDK child; it is not an automatic verification prerequisite.
