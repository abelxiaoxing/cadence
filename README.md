# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence turns [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) into a conversation-driven engineering workflow.
Enter `/cadence [goal]`, align the plan through conversation, then let the persistent owner implement and verify it.
The optional WebUI supports the same persistent conversation workflow without a live Pi terminal, alongside ordinary chat and explicitly labelled legacy tasks.

## Why Cadence

- **Work outlives the window.**
  Tasks run in a background service: closing the terminal, quitting Pi or leaving the browser tab only detaches, and either client can reattach to the same run.
- **Nothing is edited before you approve.**
  A task first analyzes readonly and proposes a readable plan; files change only after you confirm that exact plan.
- **Results you can trust.**
  Subagent output, real check runs and your own review stay separate: model prose or a "Done" never counts as a passed check, and failed, canceled and unknown outcomes stay distinct.
- **Complete history.**
  Conversation workflows retain sanitized transcripts and actual process results; legacy task history also provides exact search and Markdown/NDJSON export.
- **One link for everything.**
  The WebUI (desktop and phone, English and 简体中文) also hosts ordinary Pi conversations and switches between projects, each with its own owner and history.

Cadence is a trusted assistant, **not a sandbox**: its agents edit your working copy directly with host tools, so use it on code you can review and recover.

## Install

You need Node `>=22.19.0` with npm, and Pi installed and logged in to a model provider; Cadence reuses Pi's login and model settings.

```sh
npm install -g @abelxiaoxing/cadence
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

For the optional WebUI/boot service, explicitly run `cadence server install`.
It registers and starts a background service (systemd on Linux, a LaunchAgent on macOS, a login entry on Windows) and prints a private link, `http://127.0.0.1:17423/?token=…`.
The last command lets Pi load the same copy for `/cadence`, so one npm upgrade updates both.
The port and token live in `~/.pi/agent/cadence/.env`; anyone with the token can use your workspace, so keep the link private.

## Use

### In the browser

1. Open the printed link once; the browser then remembers you.
   If you lose it, `cadence token-link --reveal` prints it again.
2. Choose a project folder with the lower-right folder button.
   Saved model preferences are reused on Send; choose once if none is available.
3. Send `/cadence [goal]` once to enter Cadence in this conversation; continue with normal messages to investigate and clarify requirements.
4. Review the complete inline plan and click **Implement this plan** (or send `按计划实施`).
   The owner implements, verifies, repairs within budget and delivers as approved.
5. Follow actual progress, subagent transcripts and local merge results in the conversation.
   Refresh and completion keep Cadence on; **Exit Cadence** only exits the mode, while **Cancel workflow — request stop** requests cancellation.

**Legacy task** retains the old create/plan/Save/Start/check/human-Review route explicitly.

### In the terminal

Enter `/cadence <goal>` once in any trusted project's Pi conversation.
Continue with normal messages: Cadence investigates, consolidates questions and develops a readable plan with you.
After explicit plan approval it automatically implements, reviews, verifies, performs bounded repairs and delivers as agreed.
Independent Git tasks use separate worktrees and may run in parallel; approved local commits/merge never imply a remote push.

**Completing a goal leaves the conversation in Cadence mode.**
No repeated command is needed.
Type `exit cadence` or `退出 Cadence` to leave; departure does not cancel accepted work.
Native use starts/reuses a local project owner on demand, without installing a system service.
Model preferences are remembered in `~/.pi/agent/cadence/settings.json`; authentication stays with Pi.

See [Conversation mode](docs/conversation-mode.md) for exact approval, worktree prerequisites and cancellation.
`/cadence-inspect` retains the advanced legacy task/history UI, including separate checks and human review; it is not the daily entrypoint.
Browser approval is separately bound to the displayed plan and conversation; authentication alone never authorizes execution.

### More projects

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

Each project gets its own owner, port and history, and the command prints its private link; the WebUI folder picker opens projects the same way.
Opening another project never stops work in the previous one.

### Checks

New workflows declare their checks in the approved plan.
For legacy tasks, list configured checks in `.cadence/assistant/config.json`:

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
