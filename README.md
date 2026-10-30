# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence turns [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) into a persistent task workspace.
Plan a code task, let subagents work on it, run your checks and review the result from the Pi terminal (`/cadence`) or a browser WebUI; both attach to the same background service.

## Why Cadence

- **Work outlives the window.**
  Tasks run in a background service: closing the terminal, quitting Pi or leaving the browser tab only detaches, and either client can reattach to the same run.
- **Nothing is edited before you approve.**
  A task first analyzes readonly and proposes a readable plan; files change only after you confirm that exact plan.
- **Results you can trust.**
  Subagent output, real check runs and your own review stay separate: model prose or a "Done" never counts as a passed check, and failed, canceled and unknown outcomes stay distinct.
- **Complete history.**
  Every run keeps its messages, tool calls and outputs, with exact search and complete Markdown/NDJSON export; known secrets are redacted.
- **One link for everything.**
  The WebUI (desktop and phone, English and 简体中文) also hosts ordinary Pi conversations and switches between projects, each with its own owner and history.

Cadence is a trusted assistant, **not a sandbox**: its agents edit your working copy directly with host tools, so use it on code you can review and recover.

## Install

You need Node `>=22.19.0` with npm, and Pi installed and logged in to a model provider; Cadence reuses Pi's login and model settings.

```sh
npm install -g @abelxiaoxing/cadence
cadence server install
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` registers and starts a background service (systemd on Linux, a LaunchAgent on macOS, a login entry on Windows) and prints a private link, `http://127.0.0.1:17423/?token=…`.
The last command lets Pi load the same copy for `/cadence`, so one npm upgrade updates both.
The port and token live in `~/.pi/agent/cadence/.env`; anyone with the token can use your workspace, so keep the link private.

## Use

### In the browser

1. Open the printed link once; the browser then remembers you.
   If you lose it, `cadence token-link --reveal` prints it again.
2. Choose a project folder with the folder button in the lower right, and choose a model.
3. Send a message for an ordinary conversation, or begin it with `cadence <goal>` (or select Cadence task) to create a task.
4. When the analysis proposes a plan, open **Review implementation plan** and choose **Confirm plan and execute**.
5. Follow subagents in the lower-left dock; checks, changes and review are under **Task details** on the right.

### In the terminal

In Pi's TUI, type `/cadence [goal]` and press Enter yourself; pasted or scripted input does not open it.
Choose a model, create or open a task, edit its plan and confirm Start; the menus also show subagents, checks, changes, review and history.

Every Pi session also shows running background agents above the input: press ↓ on an empty input to select one and Enter to read its transcript (`CADENCE_AGENT_PANEL=off` hides the panel).

### More projects

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

Each project gets its own owner, port and history, and the command prints its private link; the WebUI folder picker opens projects the same way.
Opening another project never stops work in the previous one.

### Checks

List the commands that verify your project in `.cadence/assistant/config.json`, and tasks can run them as real checks before review:

```json
{
  "schema": "cadence-assistant-checks/1",
  "checks": [{ "name": "Tests", "command": "bun run test", "timeoutMs": 120000 }]
}
```

## Manage the service

```sh
cadence server status
cadence server restart     # after an upgrade or a .env / models.json change
cadence server stop        # stays registered and starts again at the next boot or login
cadence server uninstall   # run before npm uninstall -g
```

Upgrade with `npm install -g @abelxiaoxing/cadence@latest`, then `cadence server restart`.
Restart, stop and uninstall stop running work in order rather than leaving it detached.
Uninstall removes only the service definition; projects, history and Pi settings stay.
Linux root and named services, remote HTTPS access and recovery are covered in [service management](docs/service-management.md) and [remote access](docs/remote-access.md).

## Development

Pi can also load a local checkout or packed tarball: add its absolute or relative path to Pi's `packages`, or try `pi -e ./cadence`.
Cadence does not impose a Pi version range; development pins and tested runtimes are not universal compatibility promises.

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

Engineering guidance is split by area under [engineering/](engineering/); the project index in [AGENTS.md](AGENTS.md) says which file covers which code.
`verify` also needs an official Node build, a private temporary directory and an existing Chromium; see [verification](engineering/verification.md).

## License

Cadence is MIT.
Bundled adaptations, fonts and vendors keep their own licenses; see [reuse and distribution](docs/reuse-and-distribution.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
