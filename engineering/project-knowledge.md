# Project knowledge: a bounded store, named reading and curation

`src/service/knowledge-store.ts` owns the managed store's format, budget and deterministic checks; `src/service/project-knowledge.ts` owns what each worker is given to read and the curator's brief.
Neither owns execution, approvals, sessions, plugins or another task store.

## Sources and ownership

Existing `AGENTS.md`, `engineering/`, `docs/` and `.trellis/spec/` remain the owners of their facts and are never rewritten automatically.
The managed store is `.cadence/project.md`, a route table, and topic cards under `.cadence/knowledge/`.
It is a bounded cache of what cannot be cheaply re-derived from the code, not a growing document: new knowledge has to displace or compress old knowledge.
Discovery does not initialize directories, install Trellis hooks, copy profiles or import sessions.
Trellis's ideas of a curated per-reader reading list, research kept for later readers and evidence-based updates informed the design; no Trellis implementation, template or text is incorporated (it is AGPL-licensed).

Project facts, the current delivery's handoff and raw history are separate:

- Shared source-backed knowledge lives in project Markdown.
- Attempts, revised routes, recorded investigations and current check evidence live in the owner's private workflow records.
- Pi still owns conversations.
  Cadence neither rewrites them nor copies their transcripts into project knowledge.

## The store

The route table's `## Routes` section maps code areas to what to read first, one line each: a list item naming one or more backquoted code paths, an arrow (`->`), a backquoted Markdown target with an optional `#Heading`, then a dash and what that settles.
A route's target is a topic card or a section of an existing project document.
A topic card is sections (`##`) of entries; an entry is a `###` heading stating one rule or fact, followed by short `Kind:`, `Why:`, `Anchors:` and `Source:` lines.
An anchor is `` `path` `` or `` `path#text` ``, where the text is a symbol or test name that occurs in the file; line numbers are never anchors.

The budget lives in `KNOWLEDGE_STORE`: 4KiB for the route table, 8KiB per topic, 1KiB per entry, 200KiB for the whole store and at most 64 topic files.
`lintKnowledge` checks a tree against it and against its own references.
A budget violation always fails the delivery, so the store is inside its budget after every delivery.
A route or anchor that does not resolve, a duplicate entry title and an entry without an anchor fail the delivery only where that delivery wrote the entry or changed the referenced file; elsewhere they are notes handed to the curator and the review.
Entries anchored to a file the delivery changed are listed for the curator to check again.
Nothing is pinned: every entry competes for its place.

How the store is used is counted in curated deliveries in the owner's private `workflows-v1/knowledge-use.json` (`KnowledgeUse`): per route target, the delivery it was first seen at and the last one whose workers were routed to it; per topic, the delivery that last looked it over.
It only decides what the curator looks at; it is not knowledge, and routes or topics that left the store are forgotten.
When the record cannot be read or kept, its bytes are left as they are, the run says so, and that delivery picks a topic without it.

## What a worker reads first

Each worker launch observes the documents afresh, before launching the pinned worker under the checkout gate, and `projectKnowledge` composes them in this order:

1. the route table, whole;
2. what the version-3 agreement names for this reader (`WorkflowTask.reads` for an assignment, `reviewReads` for the review): a document, or one section of it, each with its reason;
3. recorded investigations the agreement names (`{research}`), resolved from the owner's private record with a caution when the checkout has moved since;
4. the targets of the routes that the assignment's own write paths match;
5. discovered documents ranked by instruction priority and path/keyword matches, which only fill what is left.

A named source gets up to 8KiB and a discovered one 4KiB of an allowance of at most 16KiB, less when the agreement itself is long.
A long discovered document contributes the sections that mention the reader's terms, in document order, instead of its beginning.
Terms take the write paths first, and a long run of Han characters is also offered as its two-character pieces so a Chinese goal matches Chinese documents.
A named source that does not fit keeps its reason as a one-line pointer; a named document that is missing is said to be missing.
The launch journal retains the source labels, reasons, observed content digests and coverage notices, independently of transcript previews.
Files and ancestors must be ordinary project paths; symlinks, hardlinks, private/session trees and unsafe paths are not traversed.
Known-secret sanitation happens before injection.
It is not universal business-secret detection or a sandbox.
Documents can guide implementation but never grant permissions, skip mandatory checks or authorize a new remote action.

The coordinator keeps its own conversation small: it starts from the route table and asks investigations to read what a route points at.
Every completed investigation is recorded under `workflows-v1/investigations/` by its step's child run identity, with the commit it was made at and a digest of each project file its answer cites (`citedFiles`, at most 32), so a later agreement can name it instead of having each worker explore again.
The coordinator's summary of a research run shows that identity on each step.
A worker is given a named investigation's answer only while every cited file still reads as recorded in its own working tree; otherwise it gets a pointer saying which files changed, without the stale answer.
One that cites no file carries a caution once the checkout has moved.
Asking the same question about the same directories again within 14 days, with every cited file unchanged, is answered from the record by a step that says so and starts no worker; an answer that cites nothing is always investigated again.
The records are kept as long as the runs they point into; nothing is deleted to make room.

## Curation

After implementation and passing checks/review, one editing assignment per delivery maintains knowledge (`Workflows.learn`).
For a version-3 agreement it maintains the managed store, whose paths then belong to the run's write scope, plus any existing documents the agreement names in `documents`.
A fast-forward cannot carry ignored paths or ones the target checkout has its own changes to; then the store is skipped with a note in the run, and only named documents are maintained.
Direct working-copy delivery always maintains it.

The curator is given, prepared by the owner rather than recalled by a model: the budget and current usage, the entries to check again, open findings, the topic that has gone longest without a look, the routes no worker has been routed to for eight deliveries, what the run failed at and how it revised its route (`revisions/`), recorded deviations, the lessons its workers proposed and the latest verification evidence.
A worker may propose up to five one-sentence lessons in its `cadence_report` (completed or blocked); the run keeps at most 32 and hands them over as unverified proposals to check against the committed code.
It merges, adds or drops each lesson; finding nothing reusable is a valid no-change result.
When space is needed it removes, in order: entries whose anchors no longer resolve, duplicates and superseded entries, entries now guaranteed by a test or type, routes nothing has needed for a long time with the entries only they lead to and entries about code that no longer matters, and only then shortens wording without dropping a condition.
With no route table yet, the first delivery creates one that routes the areas it touched to the existing documents that own them.
Parallel assignments never edit knowledge; only this one assignment does, in the candidate.

The store must pass `lintKnowledge` before the step ends; a failure is a settled failure of that step and goes through recovery like any other.
Knowledge changes are then covered by the checks and the independent readonly Agent review of the combined candidate, which is told to judge them: additions short, specific and anchored; removals stale, duplicated, guaranteed by a test or compressed without losing a condition.
Failed or unintegrated candidate notes remain candidate material, not silently published project truth.
Removed entries stay in Git history.
The old `projectContext` proposal field and version 2's `knowledge` paths are retained only for reading historical proposals.

## Regression owners

- `test/knowledge-store.test.ts`: route and entry parsing, section addressing, the budget, blocking versus noted findings, the reading order, section-aware excerpts and Chinese goals.
- `test/project-knowledge.test.ts`, `test/project-knowledge-bounds.test.ts`: fresh source observation, discovery, Trellis-spec reading without activation/import, privacy, partial coverage and the curator's brief.
- `test/workflow-knowledge.test.ts`: the curating step, its failing store check, undeliverable stores, failure history, what each worker is named, the usage record, proposed lessons, and stale or reused investigations.
- `test/investigations.test.ts`: which files an answer cites, changed citations and the identity of a repeated question.
- `test/workflow-delivery.test.ts`: implementation failure, autonomous continuation, real-result handoff, knowledge maintenance and fresh combined-candidate verification in one owner loop.
- `test/workflow-contract.test.ts`: versioned agreement, reading lists and the documentation write boundary.
- Existing workflow scope/Git and lifecycle tests retain process closure, unexpected edits and original user-data outcomes.
