# Worker tools and observation

How an admitted worker receives Pi tools, where they operate and who joins their original work.
Parent process, Stop and checkout ownership remain in [lifetimes](lifetimes.md).

## Ownership and capabilities

- `src/worker-workspace.mjs` binds immutable cwd and investigation roots without filesystem access.
  `executionDirectory` maps the pinned execution context into an owner-selected tree; it creates no directory, branch or worktree.
- `src/worker-toolkit.mjs` is the trusted request-to-capability registry.
  An owner-validated `edit` purpose receives Pi's `read`, `grep`, `find`, `ls`, `write` and `edit`, plus the existing no-spill `bash` adapter.
  Analysis, editing and checks within an authorized implementation use that same tool set; role prose cannot remove or grant capabilities.
  Nonconversation editing workers also receive `cadence_report`, whose structured result is not verification or execution authority.
  `research`, `diagnosis` and `review` receive the four standard readonly file tools, never an arbitrary shell or write tool.
  Review additionally receives `changes` only with an owner-fixed root/base/candidate binding.
  A browser coordinator receives only its owner bridge and cannot grant itself execution authority.
- `src/research-tools.mjs` composes the installed public Pi tool definitions, preserving their schemas, descriptions, renderers, output and strict-sampling preferences.
  Its small host adapter binds relative operations to the first investigation root, refuses known nonregular read targets and keeps search offline.
  It does not implement another scanner, file schema, batch engine or cursor registry.
- `src/sdk-worker.mjs` passes explicit tool names/custom definitions to Pi, then applies toolkit lifetime accounting before capture ingress.
  Omitting the tool allowlist would enable SDK defaults, not mean no tools.
  Ordinary conversations keep the same standard SDK file tools and resource-loading behavior.

These are host tools, not a sandbox.
A shell does not become readonly through a prompt or a fixed cwd.
Git delivery, approvals and service management retain their separate consent contracts; there is no plugin-selected capability or implicit service startup.

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
For `read`, `find`, `ls`, `write` and `edit`, the toolkit checks cancellation before admission, invokes the original without that early-rejection signal and waits for its actual promise under the existing worker deadline.
If cancellation arrived meanwhile, the result reports canceled only after settlement and explicitly allows that the operation may have completed.
An admitted write is never claimed to have rolled back, and no operation is replayed.
This applies to both readonly and editing file tools, not just research.
Pi's `grep` already signals its child on abort and waits for actual child close, so its signal is preserved, as are the shell and fixed-Git stop-and-join paths.

There are no suspended ordinary scans, idle cursor timers or model-managed file handles.
The parent deadline remains the hard bound for a stuck worker; neither a tool call nor activity renews it.
SDK abort, toolkit cleanup and native worker closure remain separate facts; an unconfirmed original cannot release the checkout gate.
The coordinator bridge likewise keeps sent requests until their reply or actual disconnect, without replay.

## Regression owners

- `test/research-tools.test.mjs`: real Pi read/list output, offset continuation, selected roots, explicit paths, aliases, truncation, known nonregular targets and noninstalling search guards.
- `test/research-tools-schema.test.mjs`: exact public SDK schemas and pre-send Responses payloads with strict capability present, absent and disabled; ordinary file tools have no cursor/query ambiguity.
- `test/research-tools-settlement.test.mjs`: actual SDK reads delayed at the public operations seam; cancel and close cannot settle before the read does.
- `test/research-tools-process.test.mjs`: installed SDK search adapters with controlled native spawn/close events; grep cancellation still signals its child, find waits for its original, and process failures never become empty evidence.
- `test/worker-toolkit.test.mjs`: complete editing tools including shell, readonly boundaries, fixed cwd, standard file original settlement and coordinator isolation.
- `test/change-tools.test.mjs`: fixed-revision evidence, UTF-8 continuation, nullable cursor arguments and native cleanup.
- `test/coordinator-tools.test.mjs`: dispatch, cancellation, actual reply/disconnect and listener lifetime.
- The retained slow `service-workflow` fixture checks selected-root search through a real SDK child; it is not an automatic verification prerequisite.
