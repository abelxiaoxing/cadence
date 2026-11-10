# Project knowledge and adaptive delivery context

`src/service/project-knowledge.ts` owns readonly selection and materialization of project knowledge, plus the knowledge-maintenance assignment policy.
It does not own execution, approvals, sessions, plugins or another task store.

## Sources and ownership

Existing `AGENTS.md`, `engineering/`, `docs/` and `.trellis/spec/` remain the owners of their facts.
`.cadence/project.md` is a compact project map and knowledge index; `.cadence/knowledge/` is an optional home for topics without an existing owner, never a mandatory template tree.
Markdown references can identify additional topic owners.
Discovery does not initialize directories, install Trellis hooks, copy profiles or import sessions.
Trellis's context-manifest and evidence-based spec-update ideas informed the design; no Trellis implementation or templates are incorporated.

Project facts, the current delivery's handoff and raw history are separate:

- Shared source-backed knowledge lives in project Markdown.
- Attempts, revised routes and current check evidence live in the owner's existing private workflow records.
- Pi still owns conversations.
  Cadence neither rewrites them nor copies their transcripts into project knowledge.

## Worker context

Each worker launch observes the relevant documents afresh, before launching the pinned worker under the checkout gate.
The context combines the approved goal/decisions/acceptance, the current assignment, relevant instructions and selected topic excerpts.
The launch journal retains the source paths, selection reasons, observed content digests and coverage notices, independently of transcript previews.
Source digests describe the materialized bytes; a bounded file excerpt is explicitly partial, not a digest of unseen bytes.
Implementation, readonly diagnosis and review share the selector; their assignment prompts retain their different capabilities and evidence.

Selection prioritizes project and ancestor instructions, approved documentation targets, indexes and path/keyword matches.
Limits live beside `KNOWLEDGE_LIMITS`: shallow discovery, total directory entries (including irrelevant files), candidates, keywords and file bytes are per-observation resource controls, not delivery quotas.
The context byte bound includes headings, full paths, selection reasons, separators and omission notices, including an empty allowance.
Omitted or truncated material stays visible in the launch record and selected excerpts name the full source for on-demand reads.
Files and ancestors must be ordinary project paths; symlinks, hardlinks, private/session trees and unsafe paths are not traversed.
Known-secret sanitation happens before injection.
It is not universal business-secret detection or a sandbox.
Documents can guide implementation but never grant permissions, skip mandatory checks or authorize a new remote action.

## Learning and publication

Version-3 agreements name exact Markdown `documents` write paths (version 2 called them `knowledge`), prepared by the coordinator rather than a user form.
They participate in approval observations and write scope like implementation targets.
Local-merge therefore needs clean, nonignored knowledge targets too; use working-copy delivery for dirty or ignored documentation, without changing ignore rules or copying user source into candidates.
Generated workflow delivery notes retain their separate expected-byte publication behavior.

After implementation and passing checks/review, a dedicated editing assignment inspects the actual candidate and current native evidence, then updates only those approved documentation paths.
It preserves human text, updates existing topic owners, avoids duplicate conventions, and records concrete interfaces, validated failure lessons and test/source references.
No reusable discovery is a valid no-change result; a generic summary is not a reason to manufacture a new rule.
Knowledge changes are followed by checks and independent readonly Agent review of the combined candidate.
Failed or unintegrated candidate notes remain candidate material, not silently published project truth.
The old `projectContext` proposal field is retained only for reading historical proposals; its planned prose is never used to generate new project facts.

## Regression owners

- `test/project-knowledge.test.ts`: fresh source observation, existing topic selection, Trellis-spec reading without activation/import, privacy, partial coverage and maintenance policy.
- `test/workflow-delivery.test.ts`: implementation failure, autonomous continuation, real-result handoff, knowledge maintenance and fresh combined-candidate verification in one owner loop.
- `test/workflow-contract.test.ts`: versioned agreement and explicit documentation write boundary.
- Existing workflow scope/Git and lifecycle tests retain process closure, unexpected edits and original user-data outcomes.
