# Cadence

`@abelxiaoxing/cadence` is a shared Pi task workspace with two independently usable clients: native `/cadence` and a browser WebUI.
One explicitly started service owns tasks, bounded subagent collaboration, real parent checks and retained history.
Ordinary conversations, resource discovery, installation and opening history never start work or a service.

This is a trusted workflow assistant, **not a sandbox, certified executor or transactional application system**.
Code workers edit the chosen working copy directly; recovery can require human work.
Model prose, tool results and human Done do not certify checks or code.

## Load and start explicitly

The package can be loaded as a reviewed local package, extracted tarball or installed npm package through Pi's package mechanism.
For a local checkout, add its absolute or relative path to Pi's `packages` setting, or try `pi -e ./cadence`.
Pi loads `src/index.ts`; the service, worker and readonly operator are ordinary JavaScript with no TypeScript/source-tree fallback.
The manifest does not impose a Pi version range; public Pi peers stay external.
Development pins, declared Node baseline (`>=22.19.0`) and actual tested runtime identities are separate facts, not universal compatibility promises.
Required installed peers include public Pi packages, Typebox and Undici; `ws` is the sole production dependency.
Browser assets are prebuilt, not compiled by consumer postinstall.

Before using the shared owner, stop older Cadence sessions and choose one coordination state-home for the checkout.
No old records, databases, credentials or uncertain locks are imported, reset or cleaned.

```sh
cadence-service start --workspace /absolute/project
cadence-service status --workspace /absolute/project
cadence-service token-link --workspace /absolute/project --reveal
```

Use the installed `cadence-service` bin, or `node /absolute/cadence/src/service-cli.mjs` followed by those arguments.
Default binding is numeric loopback `127.0.0.1:17423`; `--foreground` is available for an explicitly configured supervisor.
Start reads the existing Pi agent directory (or an explicit private configuration), never creates another login/profile.
See [service management](docs/service-management.md) for configuration, model/auth policy, Stop, diagnosis and informed recovery.

### Native terminal

In a trusted, idle Pi TUI, type `/cadence [goal]` using fresh native Enter.
The optional goal does not Start; pasted/replayed/nonterminal command dispatch cannot grant native entry.
The client attaches to the existing owner and never falls back to a local executor or starts one implicitly.
Choose the exact owner model/API/thinking level explicitly: initial selection is absent.
Create or open a task, edit a readable plan and finite assignments/dependencies, preview and confirm Start.
Readonly Generate is advisory and requires a separate Save/Start.
Native menus expose child messages/tools/timeline, checks, current changes, review, retained history/search/export and independent active-run Cancel.

Return, session departure and Pi quit **detach; admitted work continues** while the service is alive.
Reattach to observe the same IDs without replay.
Explicit Cancel requests bounded stop; it is not proof that every escaped descendant stopped.

### Browser

Open the locally revealed token link.
Valid bootstrap redirects to a token-free URL and uses an HttpOnly SameSite cookie for subsequent HTTP/WebSocket access; no localStorage token copy.
The browser can create/plan/Start/Cancel, run exact configured checks and record human review without a live Pi terminal.
A token grants workspace access, not action consent.
Every mutation needs its own context-bound preview/confirmation; stale/duplicate/lost replies do not silently replay work.
The WebUI provides task/run/assignment navigation, long retained messages and tool detail, exact literal search, timeline and complete scoped NDJSON/Markdown downloads.
Desktop panes and phone drawers retain cancellation and keyboard controls.

## Execution, checks and review

- Graphs contain 1–16 required assignments with explicit purposes/dependencies and exact model choice; no recursive spawning or autonomous retry.
- Two readonly children may overlap; checkout editing and parent checks serialize across tasks and aliases against readers/writers.
- Research/diagnosis never gain editing or parent-shell authority through a plan or child prompt.
- Configured checks are available on both clients.
  Manual shell checks require the native local capability and fresh command/cwd/timeout confirmation.
- Checks use the service launch's ordinary project environment, never resolved model auth or a browser environment overlay.
- Changes are bounded observations including pre-existing dirt, not proof of causation or a complete filesystem snapshot.
- Failed, canceled, timeout, unknown, blocked, stale and not-run remain distinct.
  Done-with-issues preserves all execution/check facts.

## History and preservation

Human-readable summaries remain `.cadence/assistant/tasks/<id>/task.json`; optional checks remain `.cadence/assistant/config.json`.
Private coordination/history use `<state-home>/cadence-assistant-v1/<checkout-hash>/service-v1/`.
Rich `history-v2` is independent of the recent live buffer; new stores use private format3 and authenticated bounded navigation.
Legacy/unknown formats remain preserved, never auto-migrated.
View/search/export are readonly and cannot resume work or repair history.
Exact task/run/child exports require the completion trailer, counts, digest and original EOF; a short preview or revoked download is not a complete archive.
Capture reports redaction, omitted binary/hidden data, source truncation and incomplete recording explicitly.
Known-secret redaction is not universal detection of business secrets.
Storage exhaustion refuses new work rather than silently evicting history.

Service restart never resumes the old queue.
Uncertain process/auth/storage settlement keeps fences; use documented local informed recovery, not PID-only deletion or automatic cleanup.

## Personal remote access

Keep the backend on loopback and configure one explicit HTTPS origin and trusted immediate reverse proxy.
See [the Caddy example](docs/remote-access.md); it installs or deploys nothing.
Host/Origin/CSRF and pre-upgrade WebSocket checks apply in addition to authentication.
Do not expose credential-bearing plain public HTTP.
Token links may remain in clipboard/history or external logs; redirection cannot retract disclosure.
Local token rotation invalidates old cookies/grants/sockets/downloads, not admitted tasks.
Provider credentials remain server-side; browser tokens and model credentials are separate.
Outbound provider proxy policy is independent of inbound HTTPS and refuses unsupported routes instead of falling back direct.

## Independent shipped content

- `skills/context7-auto-research` and `skills/grok-search` remain independent research tools.
- `skills/git-commit` requires an explicit commit request and deterministic audit; task review never commits.
- Three pinned professional profiles in `agents/` provide readonly design/diagnosis and direct-edit implementation instructions, not execution authority.
- `config/` contains optional research/check examples.
  Missing-only user `.env` template creation is the sole postinstall behavior; no service/build/Git/provider operation runs.
- `node /absolute/cadence/src/operator-cli.mjs doctor|runs [workspace]` remains readonly and independent of service startup.

## Development and evidence

```sh
bun run check
bun run check:web
bun run build:check
bun run lint
bun run check:agents
bun run test:service
bun run test:web
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run test:browser
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
bun pm pack --destination /absolute/private-temp
```

Build/verification use a fresh private directory with `TMPDIR`, `TEMP` and `TMP` set explicitly.
`verify` includes native/unit tests, web tests, required real-browser scenarios and exact real-pack auditing; missing required browser is non-green, never an automatic download.
Source/extracted PTYs, fabricated loopback providers and isolated HTTPS are distinct from physical humans/devices, paid accounts, package-manager installation and native Windows/macOS/ConPTY qualification.
Those additional lanes remain unqualified unless their own receipts exist.
No passing gate authorizes commit, push, publication, installation, deployment or cleanup.

## Licenses and reuse

Cadence is MIT.
The substantial pinned pi-web-ui adaptations, original notices, emitted dependencies, Feather icons, KaTeX OFL fonts and vis embedded vendors are documented in [reuse and distribution](docs/reuse-and-distribution.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
Not all bundled material is covered by Cadence's MIT license.
