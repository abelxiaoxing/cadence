## Context

See `proposal.md` for the motivation and `specs/abel-workflow-prompt-package/spec.md` for the observable contract.
The repository is a Bun workspace whose existing packages are runtime extensions under `@gotgenes`, while this change introduces a prompts-and-skills-only package under the separate `@abel` scope.
Pi 0.84.1 supports package-declared prompt and skill resources, string `argument-hint` values, non-recursive prompt-template loading from explicit globs, and `$ARGUMENTS` expansion.
The package must also provide two network-backed research skills without inheriting the Python environments, machine-local configuration, or credentials used by the current reference deployments.
The change crosses package resources, network and configuration boundaries, distribution metadata, monorepo registration, release configuration, tests, and AGENTS routing, so an explicit technical design is required.

## Goals / Non-Goals

**Goals:**

- Establish `packages/pi-abel-workflow/` as an independently testable package boundary with no runtime npm dependency.
- Make prompt and skill discovery verifiable against the real Pi 0.84.1 implementation.
- Keep shared workflow rules authoritative in one bundled skill while leaving each prompt responsible for its stage-specific entry contract.
- Provide deterministic, dependency-free Node.js clients for Context7, Grok-compatible Chat Completions, and optional Tavily operations.
- Make configuration precedence, retry behavior, secret handling, tarball contents, and Git commit behavior executable contracts.
- Integrate the package into the existing Bun workspace, local Pi settings, release-please configuration, documentation, lockfile, and AGENTS indexes.
- Make each Implement task's exact affected-suite commands an executable dynamic repair boundary while preserving all-green affected-suite completion.

**Non-Goals:**

- Do not add an extension entrypoint or register runtime agents.
- Do not modify `packages/pi-subagents` or rely on any unshipped `pi-subagents` API.
- Do not create agent Markdown, orchestration, worktree scheduling, a permission package, UI, or runtime workflow-state storage.
- Do not copy a machine-local virtual environment or require Python, uv, `httpx`, `tenacity`, or another runtime library.
- Do not install from the monorepo git source as though its package root were the workflow subdirectory.
- Do not publish the package in this change.
- Do not extend dynamic affected-suite repair to Diagnose, full-suite-only baseline failures, unrelated dirty files, or repairs requiring unapproved substantive decisions.

## Decisions

### 1. Package layout and Pi manifest

The package will use this runtime and test layout:

```text
packages/pi-abel-workflow/
├── AGENTS.md
├── LICENSE
├── README.md
├── package.json
├── config/
│   └── .env.example
├── prompts/
│   ├── abel-init.md
│   ├── abel-design.md
│   ├── abel-implement.md
│   └── abel-diagnose.md
├── skills/
│   ├── _shared/
│   │   ├── http-client.mjs
│   │   └── load-config.mjs
│   ├── abel-workflow/
│   │   └── SKILL.md
│   ├── context7-auto-research/
│   │   ├── SKILL.md
│   │   └── context7.mjs
│   ├── git-commit/
│   │   └── SKILL.md
│   └── grok-search/
│       ├── SKILL.md
│       └── grok-search.mjs
└── test/
    ├── config-context7.test.mjs
    ├── distribution.test.mjs
    ├── git-commit.test.mjs
    ├── grok-search.test.mjs
    ├── package-contract.test.mjs
    ├── prompts.test.mjs
    ├── stage-contracts.test.mjs
    └── workflow-skill.test.mjs
```

`skills/_shared/` deliberately has no `SKILL.md`, so Pi cannot discover it as a fifth skill.
The package has no extension entrypoint, `src/` tree, TypeScript configuration, or Vitest configuration.

The manifest will declare:

```json
{
  "name": "@abel/pi-abel-workflow",
  "version": "0.0.0",
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "pi": {
    "prompts": ["./prompts/*.md"],
    "skills": ["./skills"]
  },
  "peerDependencies": {
    "@earendil-works/pi-coding-agent": ">=0.84.1"
  },
  "devDependencies": {
    "@earendil-works/pi-coding-agent": "0.84.1"
  }
}
```

Biome, rumdl, and Vitest will be package development dependencies resolved through the workspace catalog.
The package will have no `dependencies` entry.
The `check` script will run `node --check` over every `.mjs` under `skills/` and `test/`, the `lint` script will run Biome and rumdl, and the `test` script will run Vitest discovery over `test/**/*.test.mjs`.
Only Bun will update `bun.lock`.

The `files` allowlist will enumerate the four prompt files by `prompts/*.md`, the four skill descriptors, the two skill CLIs, the two shared helpers, and `config/.env.example`.
It will not recursively admit `test/`, the package root, or unbounded internal documentation.
`package.json`, `README.md`, and `LICENSE` remain required tarball entries whether listed explicitly or automatically included by the packer.

This direct-resource package was chosen over an extension wrapper because Pi already exposes prompt and skill package resources and an extension would create an unnecessary runtime API and permission surface.
A bare prompt-directory manifest entry was rejected because package resource collection can recurse, while the explicit `./prompts/*.md` pattern preserves the required non-recursive prompt surface.

### 2. Prompt templates and shared workflow contract

Each prompt will use a string-valued `argument-hint` matching its public invocation:

```yaml
argument-hint: "[project-path]"
```

```yaml
argument-hint: "<requirement> | --change <change_name>"
```

```yaml
argument-hint: "<change_name>"
```

```yaml
argument-hint: "<problem-description>"
```

Each prompt will place the unmodified template expansion inside this boundary:

```xml
<abel-request>
$ARGUMENTS
</abel-request>
```

Prompt prose will interpret the complete value from that boundary and will not define a second whitespace tokenizer.
Required-input prompts will close on absent or non-unique input instead of inferring a value.

`skills/abel-workflow/SKILL.md` will be the authoritative shared source for stage responsibilities, Gate semantics, receipt and hash integrity, Requirement-to-Task traceability, Red-Green-Refactor, baseline treatment, AGENTS managed blocks, stable checkpoints, parent-agent authority, and read-only subagent boundaries.
The four prompt bodies will retain only their input contract, stage-specific procedure, and explicit requirement to load the shared skill.
This avoids depending on a user-global `AGENTS.md` and avoids four diverging copies of the same rules.

Neither prompt frontmatter nor skill frontmatter will narrow the Pi main Agent's tools.
Gate A and Gate B text will approve behavior and implementation contracts only, with no permission-package or interactive tool-authorization meaning.

The tests will instantiate Pi 0.84.1's real `DefaultResourceLoader` for resource discovery.
They will use Pi 0.84.1's real prompt-template expansion path for quoted and space-containing `$ARGUMENTS` values rather than reproduce Pi's expansion algorithm in test code.
A temporary nested prompt Markdown file will prove that the package's explicit prompt glob remains non-recursive.

### 3. Configuration source and parser

Both network skills will import `skills/_shared/load-config.mjs`.
The loader will receive injectable `cwd` and `home` values for tests and will use `process.cwd()` and the platform home directory only at the CLI boundary.

It will select exactly one whole file in this order:

1. `<cwd>/.pi/pi-abel-workflow/.env` when that file exists.
2. `~/.pi/agent/pi-abel-workflow/.env` otherwise.

An existing project file is authoritative even when incomplete, so absent fields cause an error instead of being filled from the user file.
The loader will never inspect an `.env` beside the installed package code.
API configuration will not be read from `process.env`.

The parser will support comments, blank lines, the first `=` separator, and ordinary unquoted, single-quoted, or double-quoted values.
It will treat values as literal text and will not perform variable interpolation, shell expansion, command substitution, escape execution, or cross-file merging.
Unknown names will not change the interpretation of known names.
Errors may identify the selected path and missing field names but will not include configuration values.

The distributed `config/.env.example` will document Context7, Grok, and Tavily fields without credentials.
`TAVILY_ENABLED` will default to `false` in that example and in runtime parsing unless its selected-file value is exactly a supported true literal.

A package-relative `.env` and direct `process.env` support were rejected because both would recreate a machine-local runtime dependency or permit ambient credentials to override the documented project-versus-user boundary.
Merging project and user files was rejected because it makes credential provenance difficult to audit and lets an incomplete project override silently inherit unrelated user settings.

### 4. Shared HTTP reliability and secret handling

`skills/_shared/http-client.mjs` will expose a small injectable request helper used by both research clients.
Production calls will use Node.js 22's native `fetch`, `AbortController`, and timers, while tests inject fake `fetch` and `sleep` functions.

Every attempt will have a 30-second timeout and one logical request will make at most three attempts.
The default waits before the second and third attempts will be one and two seconds.
Only network errors, timeouts, and HTTP `408`, `429`, `500`, `502`, `503`, or `504` will be retryable.
A valid `Retry-After` delta-seconds or HTTP-date value will replace the default wait but will be capped at ten seconds per wait.
Non-retryable `4xx` responses, malformed JSON, and structurally invalid successful responses will fail immediately.
All requests will be non-streaming.

Errors will report a sanitized operation, endpoint, status, and cause without including API keys, complete Authorization headers, or response text that reproduces credentials.
The tests will supply representative secrets and assert that stdout, stderr, and thrown messages do not contain them.

Independent ad hoc retry loops were rejected because they would make timeout, retry, and redaction behavior diverge between Context7, Grok, and Tavily calls.
A third-party retry or HTTP package was rejected because Node.js 22 already provides the needed primitives and the package is intended to have no runtime dependency.

### 5. Context7 skill client

`skills/context7-auto-research/context7.mjs` will provide:

```bash
node context7.mjs search <library-name> <query|->
node context7.mjs context <library-id> <query|->
```

The selected `.env` file must exist.
`CONTEXT7_API_KEY` may be empty, while `CONTEXT7_API_URL` is optional and defaults to `https://context7.com/api/v2`.
A non-empty key will be sent as a Bearer token.

`search` will issue a request to `/libs/search` with `libraryName` and `query`.
`context` will issue a request to `/context` with `libraryId`, `query`, and `type=json`.
The final URL builder will normalize one trailing slash from the configured base before appending these paths.

A lone `-` query operand will read the complete UTF-8 query from stdin.
Using `-` with other query operands, supplying empty input, passing an unknown command, receiving malformed JSON, or receiving an invalid response shape will produce a non-zero exit.
Successful output will be formatted JSON suitable for the Skill workflow to inspect.

The current machine-local CommonJS helper was used only as behavioral evidence and will not be copied or loaded at runtime.
The new ESM client and Skill documentation will be independently written around the approved package configuration and reliability contracts.

### 6. Grok and Tavily skill client

`skills/grok-search/grok-search.mjs` will provide:

```bash
node grok-search.mjs web_search --query <text> \
  [--platform <name>] [--min-results <n>] [--max-results <n>] \
  [--model <id>] [--extra-sources <n>]

node grok-search.mjs web_fetch --url <url> [--out <path>]

node grok-search.mjs web_map --url <url> \
  [--instructions <text>] [--max-depth <n>] \
  [--max-breadth <n>] [--limit <n>]

node grok-search.mjs get_config_info
```

`GROK_API_URL` and `GROK_API_KEY` will be required from the selected file.
`GROK_MODEL` will default to `grok-4.20-non-reasoning`.
The client will normalize the configured API base and send a Bearer-authenticated, non-streaming request to `<GROK_API_URL>/chat/completions`.
It will use an explicit system instruction for search JSON or structured Markdown retrieval and a user message containing the requested query or URL.

`web_search` will require the model result to parse into an array of objects and will normalize each accepted item to `title`, `url`, and `description` strings.
Items without an HTTP or HTTPS URL and responses that cannot satisfy the requested result contract will fail instead of returning raw mixed text as success.
`--platform` will constrain the search instruction without changing output shape.
`--model` will override the selected-file model for that invocation only.

Integer options will accept canonical non-negative or positive decimal strings as appropriate and must remain JavaScript safe integers.
`min-results` must be at least one, `max-results` must be at least `min-results`, `extra-sources` must be non-negative and no greater than Tavily's documented search-result limit, and `max-depth` must be between one and five.
`max-breadth` and `limit` must be positive safe integers.
Invalid values will close before a network request and will never be silently clipped.

Tavily will be enabled only when `TAVILY_ENABLED=true` and `TAVILY_API_KEY` is non-empty.
`TAVILY_API_URL` will default to `https://api.tavily.com`.
All Tavily requests will use Bearer authentication and JSON bodies.

When Tavily is enabled, `web_fetch` will first call `/extract` with the requested URL and Markdown format.
An extract failure will produce a sanitized warning and fall back to the Grok fetch request.
If both providers fail, the command will exit non-zero.
When Tavily is disabled, `web_fetch` will use Grok directly.

`web_map` will call `/map` with `url`, optional `instructions`, `max_depth`, `max_breadth`, and `limit`.
It will close before any request when Tavily is disabled or incomplete.

A positive `--extra-sources` value will call Tavily `/search` with the query and requested result count.
The command will close before starting Grok when Tavily is not available for an explicitly requested extra-source contract.
If either required provider call then fails, the command will return failure rather than claim complete extra-source results.
Successful Grok and Tavily results will be merged in provider order, deduplicated by exact normalized URL, and will preserve the first occurrence.

`get_config_info` will print the selected configuration path, sanitized provider URLs, selected model, and enabled/configured booleans.
It will not print keys or make a network connection test.

A provider-specific Python implementation and copied virtual environment were rejected because they violate package independence and add a second runtime toolchain.
Native xAI server-side search tools were not selected because the approved `GROK_API_URL` is an OpenAI-compatible gateway boundary and arbitrary compatible gateways do not guarantee xAI Responses API tool support.
The non-streaming Chat Completions contract is the smallest portable interface across that boundary.

### 7. Explicit-request Git commit skill

`skills/git-commit/SKILL.md` will be declarative and will not add an executable that can run automatically.
A workflow completion, Gate approval, or installed Skill will never itself authorize a commit.
The Skill will activate only when the user explicitly asks to commit or invokes it.

After activation it will read the root and relevant nested `AGENTS.md` files, then inspect `git status --short`, `git diff`, and `git diff --staged`.
It will exclude `.env` files, credentials, private keys, user or session state, and obviously unrelated paths.

When all safe relevant changes form one logical commit, it may stage only an explicit path list with `git add -- <paths>`, derive a repository-compliant Conventional Commit message from the actual diff, and execute the commit.
When changes contain multiple logical groups, unrelated dirty files, ambiguous deletions, unsafe files, or no uniquely safe grouping, it will leave the index and history unchanged and ask the user to choose a group.

The Skill will prohibit `git add .`, `git add -A`, `git add -p`, `--no-verify`, `--amend`, reset, force push, and Git configuration changes.
A hook failure will be reported as received with the staged state preserved, and the Skill will not bypass the hook.

Always requiring a separately prepared staged index was rejected because it removes the requested intelligent-staging capability.
Requiring another confirmation for every unambiguous explicit path list was rejected because the explicit commit request plus deterministic safety audit is sufficient, while every ambiguity still closes for user choice.

### 8. Distribution and independent-loading verification

Distribution tests will run the real `bun pm pack --destination <temporary-directory>` from the package directory and inspect the resulting tar archive.
The exact required set will include package metadata, README, LICENSE, four prompts, four Skill descriptors, both network CLIs, both shared helpers, and `config/.env.example`.
The test will reject `AGENTS.md`, `test/`, `.env`, `.venv`, TypeScript or Vitest configuration, backups, internal working documents, workflow state, credentials, and symbolic links.
It will also scan shipped text and manifest data for runtime dependencies on `/home/abelxiaoxing/.agents/` or `/home/abelxiaoxing/work/AbelWorkflow`.

Temporary user-scoped and trusted-project-scoped Pi configurations will load the packed or local package through Pi 0.84.1's real resource loader.
Both scopes must expose exactly the four prompt names and four Skill names.
This gives executable confidence in the npm artifact without publishing it or falsely treating the monorepo git source as a subdirectory package root.

A mocked resource inventory was rejected because it would not detect manifest-glob, frontmatter, loader, or tarball incompatibilities.
A live npm installation test was rejected for this phase because the package does not yet exist in the registry and publishing is explicitly out of scope.

### 9. Monorepo and AGENTS integration

The root `.pi/settings.json` will add only the local `../packages/pi-abel-workflow` package path.
It will not add an npm disable entry before the package's first publication.

`README.md` will list `@abel/pi-abel-workflow` as a prompts-and-skills workflow package and will distinguish its supported npm and local-package installation from the all-packages monorepo git installation.
`release-please-config.json` will add the `packages/pi-abel-workflow` component and the package's `docs/plans` and `docs/retro` exclusions.
`.release-please-manifest.json` will initialize the component at `0.0.0`.
`bun.lock` will be regenerated with Bun after the new workspace manifest and development dependencies are present.
No CI publish script requires modification because the existing release job derives released package paths from release-please output.

The managed block in `pi-packages/AGENTS.md` will add a route for the prompts-first package and an explicit index-level exception to the human-authored legacy generalization that every package is a runtime extension under `@gotgenes`.
The human-authored text outside the managed block will remain unchanged under the AGENTS maintenance contract.
A new `packages/pi-abel-workflow/AGENTS.md` managed block will route prompts, skills, shared runtime helpers, tests, tarball verification, affected-suite commands, and the full-suite parent index.
The outer repository index already routes implementation to `pi-packages/AGENTS.md`, so it needs no change.
`openspec/AGENTS.md` remains untouched.

### 10. Testing strategy and property screening

All tests will live under `test/**/*.test.mjs` and use Vitest without TypeScript or a package Vitest configuration.
Network tests will inject fake `fetch`, `sleep`, `cwd`, and `home` dependencies and will never access a live provider or a real user configuration file.

Property tests will target behaviors with stable invariants and boundaries:

- One logical HTTP request never performs more than three attempts.
- A non-retryable status always performs exactly one attempt.
- Selecting a project `.env` is invariant under changes to the user `.env`.
- Configuration values never cross the selected-file boundary.
- Merged provider results have unique URLs and preserve the first occurrence order.
- Accepted integer arguments round-trip to the exact requested safe integer and invalid boundary values fail rather than clip.

Example tests will cover fixed prompt names, frontmatter strings, required inputs, CLI request shapes, normalized output, sanitized errors, and the explicit Git commit contract.
Static contract tests are appropriate for natural-language workflow and Skill rules because this phase distributes instructions rather than a workflow execution engine.
Real Pi resource loading, prompt expansion, package packing, and user/project package discovery provide the end-to-end layer.
Browser E2E is not part of this package's own verification because it has no browser surface, while the distributed workflow still preserves the approved external `dev-browser` prerequisite rule for future tasks that explicitly require it.

### 11. Implement affected-suite dynamic repair boundary

`skills/abel-workflow/SKILL.md` will carry the authoritative Implement-only rule, while `prompts/abel-implement.md` will sequence its execution.
This keeps the cross-context handoff contract centralized without applying the behavior to Diagnose.
No runtime extension, dependency, state file, or deterministic workflow engine will be added.

For each task, the implementation stage will treat the task's exact affected-suite commands as the dynamic repair boundary:

1. Before writes, execute the target, affected, and full baselines and retain command, exit code, normalized failure identity, reproducibility, attribution, and root-cause evidence in the implementation context and final report only.
2. Add every reproducible pre-existing failure from an exact affected-suite command to a dynamic repair set, even when the failure lies outside the task's original module or target-file list.
3. Keep the declared target files as the expected static write scope; only an attributed failure in the dynamic repair set can justify an additional repair path.
4. Classify a failure revealed by a later affected run as `pre-existing`, `introduced`, or `unresolved`. Include a pre-existing failure, repair or revert an introduced failure, and stop on unresolved attribution.
5. Treat transient, environmental, external-service-dependent, or non-reproducible failure as a blocker with an executable recovery condition, not as authorization for speculative product edits.
6. Return to Design when a repair needs new behavior, data/security/privacy/compatibility policy, a dependency, cross-module architecture, irreversibility, or another substantive decision.
7. Complete the task only when its target and every affected command pass. Continue to compare the full suite only for new failures; a baseline failure visible solely there does not enter the task automatically.

The static contract test in `test/stage-contracts.test.mjs` will assert the boundary source, cross-module inclusion, Red separation, root-cause and minimum-repair requirement, three-way attribution, environmental blocker, Design return, full-suite exclusion, and all-green completion.
Its Red must fail because the current prompt and shared Skill omit those clauses, not because the test or command is missing.
Static verification is selected because this package distributes natural-language workflow contracts rather than an executable classifier or state machine.
The state transitions and set boundary are suitable future property-test targets if deterministic orchestration is implemented, but inventing such a runtime in this phase would violate scope.

Placing the rule only in the Implement prompt was rejected because it would weaken the shared Skill as the trusted cross-context source.
Placing it in the generic verification section without an Implement qualifier was rejected because Diagnose must retain its existing scope behavior.
Adding a runtime scope manager was rejected as deferred orchestration work.

### 12. Later phases remain documentation only

The design will preserve five separate roadmap directions without code, placeholders, or compatibility layers in this phase:

1. A `pi-subagents` agent-source registration API.
2. Workflow-owned, runnable professional agent Markdown after that API exists.
3. An Abel dependency and conflict-key orchestrator.
4. Deterministic Gate receipt and artifact SHA-256 tooling.
5. An optional single-command meta package.

These directions do not create current entrypoints and do not alter the first-phase package manifest or task graph.

## Risks / Trade-offs

- [Natural-language stage contracts can drift without an execution engine] → Keep shared rules in one Skill, verify required clauses statically, and exercise the real Pi resource and prompt boundaries.
- [An OpenAI-compatible gateway may not provide live web retrieval despite accepting the request] → Document the gateway responsibility, validate output strictly, and offer Tavily as an explicit optional second provider rather than claiming native xAI tool support.
- [Provider APIs can evolve] → Isolate request and response adapters behind two small CLIs, close on invalid shapes, and cover the approved current contracts with fake-network tests.
- [A project `.env` can shadow a complete user file with an incomplete file] → Treat that as an intentional provenance boundary and return the selected path plus actionable missing-field names.
- [Retry can multiply latency] → Cap attempts at three, each attempt at 30 seconds, and each wait at 10 seconds.
- [Tarball globs can admit unintended files as directories grow] → Use an explicit allowlist and inspect a real packed archive in tests.
- [The package scope differs from the existing monorepo scope] → Use the full `@abel/pi-abel-workflow` name in scripts, release configuration, tests, documentation, and index routing.
- [First publication cannot be completed by the normal trusted-publishing path] → Leave publication out of this change and follow the repository's documented manual first-release process later.
- [Intelligent staging can accidentally include unrelated work] → Permit only explicit-path staging after a single-logical-change audit and close for user choice on every ambiguity.
- [An affected command can span unrelated modules and enlarge a task substantially] → Use only the exact Gate-B-approved commands as the boundary, require reproducibility and attribution, permit minimum repair only, and return substantive decisions to Design.
- [Passing one failure can unmask another] → Re-run the same affected commands, classify every newly visible failure before edits, and stop when attribution remains unresolved.
- [Environmental failures could provoke speculative code changes] → Require an executable recovery condition and block completion without product edits.

## Migration Plan

1. Add the package skeleton, pinned Pi development surface, package scripts, documentation, license, local registration, release component, manifest entry, lockfile, and AGENTS routes.
2. Add the four prompts and shared workflow Skill, then verify real Pi discovery and prompt expansion.
3. Add the configuration and HTTP helpers, Context7 client, Grok/Tavily client, and Git commit Skill under fake-network and static safety tests.
4. Amend the Implement prompt and shared Skill under a failing static contract test so exact affected-suite commands define the dynamic repair boundary and affected completion remains all-green.
5. Pack the package, verify the exact archive, and load it in temporary user and project scopes with Pi 0.84.1.
6. Run the package affected suite and the repository full suite, dynamically repairing reproducible failures inside the former while preserving full-suite-only pre-existing failures as baseline evidence.

Rollback is a single package-boundary reversal: remove the local registration, release component and manifest entry, README row, AGENTS routes, package directory, and lockfile changes introduced by its manifest.
No user data or migration state must be converted because this phase stores none and does not publish.
