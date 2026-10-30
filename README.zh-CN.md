# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence 把 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 变成一个持久的任务工作区。
规划一个代码任务，让子代理去执行，运行你自己的检查，再从 Pi 终端（`/cadence`）或浏览器 WebUI 审阅结果；两者连接到同一个后台服务。

## 为什么选择 Cadence

- **工作不随窗口结束。**
  任务运行在后台服务中：关闭终端、退出 Pi 或离开浏览器标签页只是断开连接，任一客户端都能重新连接同一次运行。
- **批准之前不会修改任何文件。**
  任务先只读分析并提出一个可读的计划；只有在你确认那个确切计划之后，文件才会被修改。
- **结果可信。**
  子代理输出、真实的检查运行和你自己的审阅彼此独立：模型的文字或一句“Done”都不算检查通过，失败、取消和未知结果保持相互区分。
- **完整历史。**
  每次运行都保留其消息、工具调用和输出，支持精确搜索与完整的 Markdown/NDJSON 导出；已知的秘密会被脱敏。
- **一个链接涵盖一切。**
  WebUI（桌面和手机，英文与简体中文）还承载普通的 Pi 对话，并可在项目间切换，每个项目都有自己的 owner 和历史。

Cadence 是一个受信任的助手，**不是沙箱**：它的代理用宿主工具直接编辑你的工作副本，所以请只在你能够审阅和恢复的代码上使用它。

## 安装

你需要带 npm 的 Node `>=22.19.0`，以及已安装并登录到模型提供方的 Pi；Cadence 复用 Pi 的登录和模型设置。

```sh
npm install -g @abelxiaoxing/cadence
cadence server install
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

`cadence server install` 注册并启动一个后台服务（Linux 上是 systemd，macOS 上是 LaunchAgent，Windows 上是登录项），并打印一个私有链接 `http://127.0.0.1:17423/?token=…`。
最后一条命令让 Pi 加载同一份副本用于 `/cadence`，因此一次 npm 升级就同时更新两者。
端口和 token 保存在 `~/.pi/agent/cadence/.env`；任何持有 token 的人都可以使用你的工作区，所以请保持链接私密。

## 使用

### 在浏览器中

1. 打开一次打印出的链接；浏览器之后会记住你。
   如果丢失了链接，`cadence token-link --reveal` 会再次打印它。
2. 用右下角的文件夹按钮选择项目文件夹，并选择模型。
3. 发送一条消息进行普通对话，或以 `cadence <goal>` 开头（或选择“Cadence 任务”）创建任务。
4. 当分析提出计划时，打开**查看实施计划**，选择**确认计划并执行**。
5. 在左下角的 dock 中查看子代理；检查、变更和审阅在右侧的**任务详情**下。

### 在终端中

在 Pi 的 TUI 里，自己输入 `/cadence [goal]` 并按回车；粘贴或脚本输入不会打开它。
选择模型，创建或打开任务，编辑其计划并确认 Start；菜单还会显示子代理、检查、变更、审阅和历史。

每个 Pi 会话还在输入框上方显示运行中的后台代理：在空输入框上按 ↓ 选择一个，再按 Enter 阅读其记录（`CADENCE_AGENT_PANEL=off` 可隐藏该面板）。

### 更多项目

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

每个项目都有自己的 owner、端口和历史，命令会打印其私有链接；WebUI 的文件夹选择器以相同方式打开项目。
打开另一个项目永远不会停止之前项目中的工作。

### 检查

在 `.cadence/assistant/config.json` 中列出验证你项目的命令，任务就可以在审阅前作为真实检查运行它们：

```json
{
  "schema": "cadence-assistant-checks/1",
  "checks": [{ "name": "Tests", "command": "bun run test", "timeoutMs": 120000 }]
}
```

## 管理服务

```sh
cadence server status
cadence server restart     # 升级或修改 .env / models.json 之后
cadence server stop        # 保持注册状态，并在下次启动或登录时再次启动
cadence server uninstall   # 在 npm uninstall -g 之前运行
```

用 `npm install -g @abelxiaoxing/cadence@latest` 升级，然后 `cadence server restart`。
restart、stop 和 uninstall 按顺序停止运行中的工作，而不是留下断开连接的工作。
uninstall 只删除服务定义；项目、历史和 Pi 设置保留。
Linux root 与命名服务、远程 HTTPS 访问和恢复见[服务管理](docs/service-management.md)和[远程访问](docs/remote-access.md)。

## 开发

Pi 也可以加载本地 checkout 或打包的 tarball：把其绝对或相对路径加到 Pi 的 `packages`，或试试 `pi -e ./cadence`。
Cadence 不指定 Pi 版本范围；开发用的固定版本和已测试运行时不是通用的兼容性承诺。

```sh
bun install
CADENCE_BROWSER_PATH=/absolute/existing/chromium bun run verify
```

工程指导按领域拆分在 [engineering/](engineering/) 下；[AGENTS.md](AGENTS.md) 中的项目索引说明了哪个文件覆盖哪部分代码。
`verify` 还需要官方 Node 构建、私有临时目录和已有的 Chromium；见[验证](engineering/verification.md)。

## 许可证

Cadence 采用 MIT。
捆绑的适配代码、字体和厂商保留各自许可证；见[复用与分发](docs/reuse-and-distribution.md)和[第三方声明](THIRD_PARTY_NOTICES.md)。
