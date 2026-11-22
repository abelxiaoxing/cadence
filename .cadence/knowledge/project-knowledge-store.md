# Project Knowledge Store

## Store Format and Budgets

### Bounded index and source-anchored topic cards

Managed project knowledge lives in `.cadence/project.md` (index, <= 4096 bytes) and `.cadence/knowledge/*.md` (up to 64 topic cards, <= 8192 bytes each, <= 1024 bytes per `###` entry, <= 204800 bytes total — `KNOWLEDGE_STORE`).
Every index route maps code paths to `target.md#Heading` and every topic entry ends with an `Anchors:` line naming existing repository paths or `path#exactSubstring` symbols.
`lintKnowledge` checks budgets, route syntax, target headings, anchor existence, unanchored entries and duplicate titles.

Anchors: `src/service/knowledge-store.ts#KNOWLEDGE_STORE`, `src/service/knowledge-store.ts#lintKnowledge`

### Worker reading order and knowledge allowance

When preparing worker prompts, Cadence injects managed knowledge under `KNOWLEDGE_LIMITS` (16 KiB total allowance) rather than dumping full repositories or raw prose docs.
Workers read `.cadence/project.md` routes first to locate the exact topic card or `docs/` manual covering the touched area, then verify facts directly against the anchored source files and tests before editing.
Do not duplicate prose that already lives in source constants or user-facing manuals; anchor the owning symbol instead.

Anchors: `src/service/project-knowledge.ts#KNOWLEDGE_LIMITS`, `test/knowledge-store.test.ts`

## Investigation Reuse and Curation

### Citation-backed investigation notes with 14-day reuse

Readonly research and diagnosis workers persist compact, file-and-symbol-cited investigation notes under `INVESTIGATIONS` in private service storage rather than polluting the checkout.
Subsequent planning or recovery steps reuse matching citations within the 14-day freshness window and revalidate cited paths before trusting conclusions, cutting repeated exploratory scans while preventing stale assumptions from outliving code changes.

Anchors: `src/service/investigations.ts#INVESTIGATIONS`, `test/investigations.test.ts`

### Shell-free Stage 6 curation and zero-edit reuse

After Stage 5 review accepts a V5 delivery candidate, Stage 6 runs a shell-free curator inside the stable worktree to add or refresh verified `.cadence/project.md` and `.cadence/knowledge/*.md` entries reflecting newly discovered contracts or invariants.
If the delivery needed no knowledge update (zero-edit `C0`), Stage 6 reuses the already-verified Stage 5 candidate commit without re-running checks; when knowledge files change, `lintKnowledge` must report zero findings before fast-forward integration.

Anchors: `src/service/workflows.ts`, `test/workflow-knowledge.test.ts`
