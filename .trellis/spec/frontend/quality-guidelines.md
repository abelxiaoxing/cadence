# Quality Guidelines

> How the Presentation & Content layer is verified: immutable Agent pins, the prompt-activation host contracts, lint coverage, and the shared loader bounds.

---

## Overview

Content in this layer ships inside the package tarball and drives model behavior, so it is verified like code: hash-pinned, linted, and covered by named test contracts that run across the CI platform matrix.
The gates are `bun run check:agents`, `test/prompt-activation.integration.test.ts`, the skill test files, the lint rules in `.rumdl.toml`/`biome.json`, and the distribution checks that prove the exact member set.

---

## Agent Verification

`bun run check:agents` (`scripts/check-agents.mjs`) validates the managed `<!-- ABEL:AGENTS-INDEX:START/END -->` block in `AGENTS.md`:

- Exactly one marker pair; the block must not contain timestamps, version-policy wording, Gate/approval state, runtime IDs, or reference-package product dependencies (the check's `FORBIDDEN` pattern list).
- Every backticked route must exist inside the repository, contain no `..`, and not be a symlink; command phrases must resolve to an executable on PATH.

The three Agents themselves are verified by identity, not by re-reading: `provenance/adapted-modules.yaml` pins `agents/design-explorer.md`, `agents/diagnosis-worker.md`, and `agents/implementation-worker.md` by path/role/SHA-256, `src/agent-registry.ts` recomputes the hashes at load, and `test/distribution.test.mjs` plus `scripts/pack-check.mjs` prove the packaged bytes match the member manifest.
A changed Agent file therefore fails the pin check, not a content review.

---

## Prompt-Activation Contracts

`test/prompt-activation.integration.test.ts` is the host-contract suite, and the CI `openspec-platform-contract` job runs it on Linux, Windows, and macOS with Node 22.13.0 and 24.13.0.
The named contracts (each an explicit `it` in the file):

- first-provider start and exit: Design start is exposed in the first provider request and tools are restored on exit;
- pre-expansion neutralization: extension-generated `/abel-*` input from a non-interactive/rpc source "does not expand extension-generated /<stage> into a workflow";
- queue rejection: the same rejection covers queued follow-ups, because the `input` hook handles the source before template expansion;
- retained-stage continuity: "keeps a retained Design active when a streaming stage switch is rejected";
- rejected provenance without leakage: "reports rejected package provenance without sending the workflow to the model";
- no authority from replay: "does not grant authority to an identical replay of a previously admitted prompt";
- RPC admission: "accepts an explicit RPC invocation";
- Design tool continuity: "keeps Design tools visible across real Pi follow-ups without ending the stage";
- init/design handoff: "restores ordinary tools when Init follows an unfinished Design" and each stage "exits <stage> before handling an unrelated task";
- request shape: "publishes a discoverable strict Design request envelope", "requests parallel tool calls for an active Design Responses turn", and "publishes durable commands and a separate stage exit during Implement";
- negative activation: "does not activate from plain text containing a package marker", "does not accept an argument-injected marker after the request", "rejects a same-name prompt without package provenance", "requires the matching package marker after input provenance".

`test/prompts.test.mjs` adds the prompt-asset contracts (frontmatter, markers, envelope well-formedness) for all four entrypoints.

---

## Skill and Configuration Verification

- `test/config-context7.test.mjs`, `test/grok-search.test.mjs`, and `test/git-commit.test.mjs` cover the skill assets; the `.mjs` scripts are Biome-checked (`biome check .` includes `skills/`) and syntax-checked by `scripts/check-syntax.mjs` (`node --check`, shell-free, no directory-symlink traversal).
- `test/startup-card.test.ts` covers the card's presentation, the untrusted-project form, repeated loads, and activation isolation (the card never starts a workflow).
- `test/install-config.test.ts` covers the postinstall template writer (`src/install-config.mjs`): it creates `~/.pi/agent/cadence/.env` only when absent, so a user-edited file is never clobbered.
- The shared loader contract is tested through the skills: whole-file priority (project before user), the 64 KiB regular-file bound, the nonblocking open, and the rule that an absent file yields anonymous Context7 defaults while a malformed explicit file fails instead of being hidden by the default.

---

## Lint Coverage

- `prompts/*.md` is linted by `rumdl` with `MD033` relaxed per file (`.rumdl.toml` `[per-file-ignores]`): the prompts legitimately use HTML (`<abel-request>`, `<!-- ABEL:PROMPT: -->`, `<!-- ABEL:START/END -->`) and that HTML is load-bearing — the activation code searches for the markers.
- All other project markdown, including this spec layer, allows only `p` and `img` elements (`MD033 allowed_elements`), plus the global rules: one sentence per line (MD013 reflow), aligned tables (MD060), ordered lists in `1.` style (MD029), and blank-line-separated lists (MD032).
- Biome covers the `.mjs` skill assets and the generated-bundle exclusions; `skills/**/*.mjs` must also pass `node --check` via the syntax script.

---

## Forbidden Patterns

- Never ship an Agent whose bytes differ from the `provenance/adapted-modules.yaml` pin, and never "fix" the pin without a provenance note: the Agents are adapted resources with license attribution in `THIRD_PARTY_NOTICES.md`.
- Never add HTML to a non-prompt markdown file; the only sanctioned HTML is in `prompts/*.md` under the relaxed rule.
- Never put a credential value in `config/routes.example.json` or a committed `.env`; the examples carry environment-variable names and empty values.
- Never add a stage prompt or skill without the matching test file and the `provenance/package-members.json` update in the same change.

---

## Common Mistakes

- Editing `AGENTS.md` inside the managed block and discovering it at `check:agents` time; the block is machine-validated (timestamps and approval state fail it), and Trellis-owned edits belong outside the markers.
- Assuming the local skill tests prove the prompt host contracts; only the platform-matrix `prompt-activation` run covers real Pi expansion behavior across OSes.
- Treating the loader's anonymous Context7 default as a fallback for a broken file; the default applies only when the file is absent — a malformed file is an error the card surfaces.
