# Cadence

An MIT-licensed, Pi-only terminal workflow assistant: **plan → one agent → checks → changes → human review**.
Ordinary engineering conversations and independent research skills do not activate the workflow.
The lightweight replacement is unreleased pending independent qualification; local tests are not release or human/provider evidence.

Load the local package by absolute path or a relative path such as `./cadence`, or use an extracted tarball with existing trusted Pi peers.
Cadence does not impose a Pi version range; missing capabilities refuse explicitly.

## Explicit workflow

Open `/cadence` in a trusted, idle interactive Pi terminal.
`/cadence <request>` only prefills a new goal; it never starts work.
Choose New or Open/history, then code, research or diagnosis.
Opening a task restores context, not execution or approval.
Quoted, replayed, model-generated, nonterminal and child invocations cannot start tasks.

For code, write/edit a readable plan or explicitly request a readonly advisory plan.
Review the plan and working-copy changes, then confirm **Start** in the current terminal.
One agent uses the current Pi model/provider and publicly resolved request authentication to edit the chosen working copy.
Unsupported model transport/auth capabilities refuse rather than silently falling back.
Research and diagnosis use readonly tools and human review of conclusions; they cannot escalate into editing or shell checks.

Edits are ordinary trusted host-tool operations, **not a sandbox, certified future-code approval or transactional application**.
There is no automatic rollback, retry, Git mutation, software installation, cleanup or publication.
Stop older Cadence sessions first; external editors and older runtimes are outside the new checkout coordination guarantee.

Progress is foreground and cancellable with Escape.
Navigation/shutdown requests bounded cancellation and waits; an unconfirmed stop remains interrupted/unknown and keeps the new lock.
POSIX group signaling is operational cancellation, not proof that escaped descendants stopped.
Windows direct-child cancellation is weaker; no Job or ConPTY guarantee is claimed.
Continue after interruption/failure requires a new explicit terminal choice and current plan review.
Only explicit informed recovery of an unchanged stale **new** lock can permit another supported writer; old runtime resources are never reset.

## Checks and review

Optionally copy `config/workflow-task.example.json` to `.cadence/assistant/config.json` and edit its named command/timeout definitions (`cadence-assistant-checks/1`).
Missing configuration means no configured checks, never a pass.
Code tasks can also use a manually entered check.
Each parent-run command requires terminal confirmation of the actual command, cwd and timeout.
The parent records exit status, duration and bounded sanitized output; agent prose or exit zero is not a passing check.
Commands are user-approved shell input, not automatically executed model suggestions.
They inherit the parent project environment (including any ambient credentials); resolved SDK request credentials are never added.
The child guard prevents nested Cadence activation.
Configured checks that have not run remain visibly not-run, even when another check passes.

Review includes staged/unstaged changes, untracked/binary/deleted files and baseline dirt, without claiming all changes belong to Cadence.
Non-Git inventory and any unreadable, ignored or truncated coverage are explicitly limited.
Later edits invalidate check/review freshness.
Human Done may record **reviewed-with-issues** when checks are failed, stale, unrun or coverage incomplete; it never converts those outcomes into passed or certified.

## Storage and privacy

- Human-readable bounded records: `.cadence/assistant/tasks/<uuid>/task.json`.
- Private bounded sanitized diagnostics and coordination: `<state-home>/cadence-assistant-v1/<checkout-hash>/`, outside the checkout.
- Authentication is resolved by the parent and sent through anonymous stdin, not argv, project records or credential files.
- Unknown, corrupt, linked or oversized state refuses without reset.
- Missing state stays absent on list/open/doctor.
- Old SQLite/history/checkpoints/candidates, sessions, OpenSpec and uncertain resources are not read as approval, migrated or cleaned.

The SDK child has in-memory settings/session/model/auth stores and explicit resources; it is not Pi CLI startup.
Redaction is bounded best effort for known secrets, not universal secret discovery.
Do not put credentials into goals/plans or approved check commands.

## Independent skills and configuration

The shipped `context7-auto-research`, `grok-search` and `git-commit` skills remain independent of `/cadence`.
The commit skill requires an explicit user commit request; Cadence itself never commits.
Three package-owned Agents provide planning/research, implementation and diagnosis instructions; they are not extra Pi-discovered workflows.

The missing-only installer offers the user configuration template at `~/.pi/agent/cadence/.env`; it never overwrites an existing file.
See `config/.env.example` for Context7/Grok/Tavily settings.
Trusted project overrides may use `.pi/cadence/.env`.
Startup displays configuration status without showing secrets or activating a task.
MIT and pi-subagents attribution are in `LICENSE`, `THIRD_PARTY_NOTICES.md` and `licenses/`.
No Trellis runtime dependency or AGPL source/templates are included.

## Readonly operators

```sh
node /path/to/cadence/src/operator-cli.mjs doctor /path/to/workspace
node /path/to/cadence/src/operator-cli.mjs runs /path/to/workspace
```

These observe only the new records/configuration/lock; they never create missing state, launch work, recover locks or execute checks.
History outcomes are historical, not fresh verification of current files.

## Development and qualification

```sh
bun run build:operator
bun run check
bun run lint
bun run test
bun run check:agents
bun run pack:check
bun pm pack --destination /private/temporary/directory
```

`test/distribution.test.mjs` exercises real archive members/bodies/pins and extracted consumers.
The reviewed manifest is `provenance/package-members.json`, not derived from the archive under test.
Tests distinguish controller logic from real filesystem/process/SDK/package/terminal integration and use explicit integration budgets.
Synthetic loopback models and trusted existing peer links do not prove paid-provider, manager-install or physical-human qualification.
Record actual Node/Pi/platform identities without release version predicates; unexecuted Windows/macOS/human lanes remain missing.
Historical certified-runtime failures are preserved as failed/superseded evidence, not relabeled passes.
