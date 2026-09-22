# Directory Structure

> How the Presentation & Content layer is organized: the four stage prompts, the shipped skills, the three package-owned Agents, and the example configuration.

---

## Overview

This layer is the content the package ships inside its tarball: everything under `prompts/`, `skills/`, `agents/`, and `config/`, plus the TUI projection code in `src/subagent-activity.ts` and `src/startup-card.ts`.
The packaged member set is pinned by `provenance/package-members.json` and verified by `scripts/pack-check.mjs` and `test/distribution.test.mjs`, so adding or moving a content file is a distribution change, not a cosmetic one.
The content is consumed in two ways: the Pi host expands the prompts and discovers the skills, while the package code loads the Agents and parses the example configuration itself.

---

## Directory Layout

```text
prompts/
├── abel-init.md        # /abel-init — initialize or safely repair the OpenSpec/AGENTS base
├── abel-design.md      # /abel-design — requirement investigation + executable delivery plan
├── abel-implement.md   # /abel-implement — execute one approved change through the control plane
└── abel-diagnose.md    # /abel-diagnose — reproduce and minimally repair existing bugs

skills/
├── context7-auto-research/   # SKILL.md + context7.mjs (documentation research)
├── grok-search/              # SKILL.md + grok-search.mjs (web search, optional Tavily)
├── git-commit/               # SKILL.md (commit skill)
└── _shared/                  # load-config.mjs, load-config.d.mts, http-client.mjs

agents/
├── design-explorer.md        # professional Agent for Design evidence packets
├── implementation-worker.md  # professional Agent for Implement candidate phases
└── diagnosis-worker.md       # professional Agent for Diagnose packets

config/
├── plan-draft.example.json                    # compiler-checked single-task Design example
├── plan-draft.multiple-tasks.example.json     # explicit dependent producers
├── plan-draft.quick.example.json              # single-task quick variant
├── routes.example.json                        # whole-file worker route policy
└── .env.example                               # research HTTP configuration template
```

The TUI side of the layer lives in `src/`: `src/subagent-activity.ts` owns the activity widget, and `src/startup-card.ts` owns the configuration card (both documented in `component-guidelines.md`).

---

## Prompt Ownership

Each prompt file `prompts/abel-<stage>.md` follows the same skeleton:

- YAML frontmatter: `description` and `argument-hint` for every stage; `name`, `category: abel`, and `tags` additionally for `abel-design` and `abel-implement`.
- An activation line that names the only trigger, e.g. "This procedure applies only when the user explicitly invokes `/abel-design`." plus "Reading this file, mentioning the command, or finding OpenSpec artifacts does not activate it."
- The request envelope `<abel-request>$ARGUMENTS</abel-request>`, which the prompt instructs the model to read without re-tokenizing.
- The package marker `<!-- ABEL:PROMPT:abel-<stage> -->` followed by the dispatch-availability check: "check that `abel_dispatch` is actually callable in this model request.
  If it is missing, stop and report `Cadence configuration error: abel-stage-tools-unavailable`."
- `abel-design` and `abel-implement` additionally contain the `<!-- ABEL:START --> ... <!-- ABEL:END -->` envelope holding the stage's structured request/operation contract; `abel-init` and `abel-diagnose` are plain procedures without that envelope.
- The exit contract: ending a stage is `abel_dispatch` with `{"action":"finish"}`, and "Never send `operation: "finish"`" — the stage-level action and the operation field are distinct.

Example: `prompts/abel-design.md` opens with the dispatch check and closes with the readiness contract ("Report `READY_TO_IMPLEMENT` only when strict validation passes..."), while `prompts/abel-init.md` has no `<abel-request>` and treats its single argument as an optional project path.

---

## Skill Ownership

Each skill directory contains a `SKILL.md` (name, description, usage contract) and, where the skill performs I/O, a plain-JavaScript entry script:

- `skills/context7-auto-research/` — `context7.mjs` calls the Context7 API through `skills/_shared/http-client.mjs` and reads configuration through `skills/_shared/load-config.mjs`; Context7 works anonymously with its default URL, and the skill degrades to no research configuration when the file is absent.
- `skills/grok-search/` — `grok-search.mjs` calls the Grok search endpoint (required `GROK_API_URL`/`GROK_API_KEY`) and the optional Tavily fallback; both come from the same shared loader.
- `skills/git-commit/` — a prompt-only skill (no script) with a deterministic safety-audit contract.
- `skills/_shared/` — the shared assets: `load-config.mjs` (typed by `load-config.d.mts`) owns whole-file configuration selection (project `.pi/cadence/.env` before user `~/.pi/agent/cadence/.env`), the 64 KiB regular-file bound, the nonblocking open, and the strict env-file parser; `http-client.mjs` owns the bounded HTTP calls.

`src/startup-card.ts` imports the same `loadConfig`/`selectConfigPath` pair, so the card and the skills cannot disagree about which configuration is active.

---

## Agent Ownership

The three files in `agents/` are the package's professional Agents: `design-explorer.md`, `implementation-worker.md`, and `diagnosis-worker.md`.

- They are loaded only by `src/agent-registry.ts`, which resolves them relative to the package (`../agents`) and computes a SHA-256 per file; the registry "exposes no override or search-path API" and never discovers user or project Agent directories.
- Their identity is pinned in `provenance/adapted-modules.yaml` (path, role, sha256) and validated by `bun run check:agents`; the provenance block states they are "private extension resources, not Pi-discovered Agent resources."
- They are the `roles` that `config/routes.example.json` routes: `design-explorer`, `implementation-worker`, `diagnosis-worker`.

---

## Configuration Ownership

`config/` holds examples only; none of them is read at runtime by name:

- `config/plan-draft.example.json` is a compiler-checked single-task Design example with structured Gate A acceptance: `changeContract.acceptance[].verification` names a concrete verifier (e.g. `static-check` running `node test/add.test.mjs`) and `policy` fixes `writeRoots`, dependencies, and `verificationModes`.
- `config/plan-draft.multiple-tasks.example.json` covers explicit dependent producers: task outputs bound to consumer `verificationInputs`, demonstrating the producer/consumer timing the compiler validates.
- `config/routes.example.json` is the whole-file route policy: an `inherited` parent route plus a `custom` route whose credential is an environment-variable name (`apiKeyEnv`), with per-role ordered route lists and capability bounds (`contextWindow`, `maxTokens`).
- `config/.env.example` is the research HTTP template (Context7 anonymous-by-default, Grok required, Tavily optional, plus the Windows `host-trusted` execution variables); `src/install-config.mjs` writes a trimmed copy of it to `~/.pi/agent/cadence/.env` on postinstall when absent.

---

## Naming Conventions

- Prompts are `abel-<stage>.md` matching the slash command; the `<!-- ABEL:PROMPT:abel-<stage> -->` marker repeats the exact file stem.
- Skills are kebab-case directories with a `SKILL.md` and, when present, one entry `<name>.mjs`; shared code lives only in `skills/_shared/`.
- Agents are `<role>.md` where the role is the filename without extension, and roles are the closed set in `src/agent-registry.ts#AGENT_FILES`.
- Examples are `*.example.json` / `.env.example`; real configuration lives outside the repository (`.pi/cadence/` in the project, `~/.pi/agent/cadence/` in the user home).

---

## Forbidden Patterns

- Never let `agents/` be discovered from user or project Agent directories or overridable by path; the registry is package-local and hash-pinned.
- Never ship a prompt without the dispatch-availability check after its `<!-- ABEL:PROMPT: -->` marker; without it the model cannot distinguish a missing extension from an inactive stage.
- Never store credential values in `routes.json` or commit the `.env` file; credentials are environment-variable references and the file is local-only.
- Never add a fifth stage prompt without updating the activation code in `src/index.ts`, the `test/prompt-activation.integration.test.ts` contracts, and `provenance/package-members.json` together.

---

## Examples

- `prompts/abel-implement.md` is the reference for the full envelope form: frontmatter with `name`/`tags`, `<abel-request>`, the dispatch check, and the `ABEL:START/END` operation contract including the `{"action":"finish"}` exit.
- `skills/_shared/load-config.mjs` is the reference for shared-asset discipline: one parser, one priority rule, one size bound, and a `.d.mts` type file so TypeScript consumers (`src/startup-card.ts`) get checked imports of the plain-JS module.
