# Worker capabilities and observation

How an admitted worker receives tools, where those tools operate, and who closes their resources.
The resource values live beside `RESEARCH_LIMITS` in `src/research-scan.mjs` and are indexed in [limits](limits.md).
Parent process, Stop and checkout ownership remain in [lifetimes](lifetimes.md).

## Ownership

- `src/worker-workspace.mjs` binds an immutable cwd and investigation roots without filesystem access.
  `executionDirectory` maps the existing pinned `ExecutionContext` into an owner-selected tree; it never creates a directory, branch or worktree.
  The service retains canonical-path validation and its existing empty-subdirectory preparation.
- `src/worker-toolkit.mjs` is the one trusted capability registry and request-to-capability policy.
  An owner-validated `edit` purpose receives SDK file tools and the captured no-spill shell adapter; nonconversation editing workers additionally receive the nonexecuting `cadence_report` tool, whose structured result is not verification or execution authority; `research`, `diagnosis` and the protocol's explicit `review` purpose receive the observation bundle.
  Automatic review uses that same readonly bundle, plus `changes` only when its trusted request carries the owner-fixed root/base/candidate binding, never editing authority.
  A browser coordinator receives only its owner bridge.
  Prompt roles, repository files, model arguments and arbitrary plugins cannot register tools or grant capabilities.
- `src/sdk-worker.mjs` passes the toolkit's explicit names/custom definitions and bound cwd to the installed public Pi SDK.
  Ordinary conversations retain their existing SDK file tools, image support and ordinary resource loader.
  The runtime wraps actual SDK tools for original-operation accounting before capture ingress, and rejects an unexpected tool name.
  It does not own another role-specific list of tool names.
- `src/research-tools.mjs` owns observation schemas, request normalization, response accounting and worker-local cursor admission/expiry.
  `src/research-scan.mjs` owns streaming lines, directory positions, source observations and the actual handles.
  There is one scanner, not separate singleton/batch or legacy/paged engines.

The registry is intentionally code, not a plugin framework or an extensible permission language.
Tool implementation is replaceable inside a trusted capability bundle; adding a model-visible name does not require changing the SDK bootstrap.
These are host tools, not an OS sandbox.
In particular, a shell is not made readonly by its cwd, a prompt, or a Git worktree.
Git commits/integration, approvals and delivery remain service-owned operations under the existing consent contracts.
Branch/worktree creation and integration live in the service-owned [delivery lifecycle](worktree-delivery.md), not this registry; there is no implicit tool discovery.

## Fixed Git review evidence

`src/change-tools.mjs` owns the `changes` capability, whose only inputs are paths/diff/base/candidate observation modes, literal checkout-relative paths and one-use continuation/close cursors.
The owner supplies immutable full OIDs and the review root; model arguments cannot substitute them or grant this capability to an editing/coordinating worker.
The tool streams native Git output under backpressure, with bounded active/idle pipes and actual-child closure on cancellation, expiry or disposal; it creates no source copies or spill files.
Coverage is complete only at successful native EOF/close; binary, invalid UTF-8 and unavailable objects cannot become complete empty results.
The shared Git policy removes inherited alternate index/worktree overrides and disables replacement objects; observation commands disable external diff/textconv/pager and use literal pathspecs.
These are readonly Git observations, not arbitrary shell access or a guarantee that an Agent inspected all evidence.
Limits live beside `CHANGE_LIMITS`; evidence, capture and status-preview coverage remain separate.

## Observation requests

The default observation bundle has familiar `read`, `grep`, `find` and `ls` entrypoints; those names are not the capability model.
Each accepts an initial query or exclusively `{cursor}` / `{cursor, close: true}`.
Continuation cannot change a query's paths, patterns, ranges or page size.
Provider schemas use an object root, not an object union; the execution boundary validates initial-query versus continuation exclusivity before admitting or consuming a scan.
Paths are resolved within the worker's admitted roots; relative paths use the first root, and output paths name that root's zero-based index.

```js
read({ path: "src/service/workflows.ts", offset: 100, limit: 30 });
read({ files: [
  { path: "src/a.ts", ranges: [{ start: 20, end: 60 }, { start: 90, end: 110 }] },
  { path: "src/b.ts" },
], pageSize: 20 });
grep({ path: "src", patterns: ["CheckoutGate", "settle"], glob: "**/*.ts" });
find({ path: "src", pattern: "*.ts", pageSize: 20 });
ls({ path: "src", pageSize: 20 });
read({ cursor: "<returned token>" });
```

`read` offset/limit select a requested line interval, not a page size; without a limit it can continue to actual EOF.
Batch paths are resolved and duplicate files/overlapping line intervals are merged before reading their contents.
Ranges use inclusive, one-based line numbers.
Locating a far line may return progress before reaching it.
The scanner reads chunks and retains its actual byte/line position and pending lookahead across pages, never rereading a consumed prefix.
A complete requested range is complete even when the file has further lines.

`grep` accepts one `pattern` or a `patterns` array with literal OR semantics, optional case folding and a simple file glob.
Each line is scanned for all patterns; `matchedPatterns` names zero-based input indexes, with one result per matching line.
There is no regex engine, query DSL or search subprocess.
`find` and `grep` traverse directories in filesystem order, without following tree symlinks, interpreting `.gitignore`, or silently excluding backup trees.
Their existing `.git`/`node_modules`, special-file and depth omissions remain visible.
`ls` describes entries, including symlinks, without traversing them.
An explicitly selected special file is also omitted by `find`/`grep`, not labelled as regular text; `read` refuses a known nonregular target before opening it and rechecks the actual opened file.

## Responses and coverage

Tool content is JSON with `items`, `state`, `nextCursor`, `pausedBy`, `coverage`, `progress` and elapsed time.
Navigation and coverage are in model-visible content as well as ordinary tool details; a UI-only field cannot guide an agent's continuation.
The encoded tool result, including JSON escaping and metadata, fits the output bound.
A row too large to fit alone is explicitly omitted rather than causing an infinite sequence of empty pages.

- `more` means continue the exact returned cursor.
  An empty result page is progress, not absence.
- `done` means this query has no remaining scan work; it does not by itself mean coverage is complete.
- `closed` acknowledges explicit release, not completed research.
- `coverage.complete` is true only for `done` with no recorded omissions in the requested scope.
- `coverage.omissions` retains bounded reason counters across pages, separate from a temporary time/byte/entry/result/output quantum.
- `progress` reports this page's actual read bytes, inspected entries/lines and their cumulative totals, including lookahead; returned rows need not cause new disk reads.

Line assembly retains UTF-8 bytes across chunks/quanta and decodes complete lines, so a cut multibyte character does not discard a valid file prefix.
U+FEFF is preserved as source text, including at line starts; per-line decoding cannot silently remove it as if each line were a new file BOM.
Binary files, invalid UTF-8 lines and oversized lines are reported as omissions; an oversized line is skipped through its newline with bounded memory, and later lines remain readable.
Oversized/invalid lines outside requested intervals do not reduce that interval's coverage; binary detection still applies to the file bytes read.

These observations are `live-filesystem`, not an atomic repository snapshot or proof against change-and-revert.
Open files/directories and selected roots are identity-checked before/after pages, and files are checked before normal closure.
Detected replacement/modification refuses the continuation as source-changed; it never silently rewinds or mixes a new observation into the old cursor.
External editors are not excluded by Cadence's checkout gate, and a previously completed file is not indefinitely watched.
Search coverage, transcript retention coverage and the coordinator's result preview remain separate facts; missing retained evidence cannot be reconstructed by a cursor from a departed worker.

## Resource lifetime

Live scan reservations include opening, running, suspended and closing scans; completed queries have no cumulative count quota.
A cursor is an opaque one-use worker-local handle, bound to its tool and normalized query.
Consumed, expired, foreign-tool and foreign-worker tokens refuse; no request automatically starts a replacement scan.
Concurrent attempts to consume one token cannot both advance it.
Idle expiry closes only the scanner's owned handles, never project files or retained history, and does not release a slot before closure settles.

The toolkit stops new admissions and joins every actual tool original on close, including stock SDK tools.
The runtime requests SDK abort independently; a rejected observer or session disposal is not proof that an original tool stopped.
Observation cancellation/close refuses new I/O, joins already-started operations, and then closes handles.
Failed handle closure remains a cleanup failure, never an unreadable-file omission or successful slot refund.
The coordinator bridge likewise stops queued sends but keeps listeners until sent originals receive their reply or actual disconnect.
Synchronous and callback send failures both release that pending entry and report the same fixed transport error, without exposing the original exception or replaying the request.
The runtime joins toolkit disposal before reporting final cleanup settlement, including when SDK creation or prompting failed.
The parent total deadline remains the hard bound for stuck work; cursor activity never renews it.

## Regression owners

- `test/change-tools.test.mjs`: fixed-revision evidence, UTF-8 continuation, cursor ownership, cleanup and trusted review-only composition.
- `test/worker-toolkit.test.mjs`: trusted capability selection, explicit SDK allowlists, shared cwd, original-operation cleanup and noncreating worktree-relative placement.
- `test/research-tools.test.mjs`: batch/range semantics, actual continuations, multi-pattern evidence, output accounting, source changes and honest coverage.
- `test/research-tools-schema.test.mjs`: object-root parameter schemas through the installed public SDK validator and Responses adapter's pre-send hook, without network/provider execution.
- `test/research-tools-settlement.test.mjs`: delayed original reads/closes, directory quanta, idle-expiry charges and closure failures.
- `test/coordinator-tools.test.mjs`: serialized dispatch, queued cancellation, actual reply/disconnect lifetime and listener disposal.
- Existing SDK/process/context tests retain the separate native, auth, capture, pinned-context and checkout-gate contracts.
