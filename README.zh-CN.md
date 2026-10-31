# Cadence

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · [Español](README.es.md) · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

Cadence 把 [Pi](https://www.npmjs.com/package/@earendil-works/pi-coding-agent) 变成一种持续对话驱动的工程工作方式。
输入一次 `/cadence [目标]`，通过对话对齐计划，再由后台 owner 自动实施、验证和交付；WebUI 支持同样的持续对话流程，不需要 Pi 终端在线。

## 为什么选择 Cadence

- **工作不随窗口结束。**
  任务运行在后台服务中：关闭终端、退出 Pi 或离开浏览器标签页只是断开连接，重新打开原生或浏览器对话即可继续观察工作。
- **批准之前不会修改任何文件。**
  任务先只读分析并提出一个可读的计划；只有在你确认那个确切计划之后，文件才会被修改。
- **结果可信。**
  子代理输出、真实的检查运行和你自己的审阅彼此独立：模型的文字或一句“Done”都不算检查通过，失败、取消和未知结果保持相互区分。
- **完整历史。**
  新工作流保留脱敏后的子代理记录与实际进程结果；旧任务历史另支持精确搜索及 Markdown/NDJSON 导出。
- **一个链接涵盖一切。**
  WebUI（桌面和手机，英文与简体中文）还承载普通的 Pi 对话，并可在项目间切换，每个项目都有自己的 owner 和历史。

Cadence 是一个受信任的助手，**不是沙箱**：它的代理用宿主工具直接编辑你的工作副本，所以请只在你能够审阅和恢复的代码上使用它。

## 安装

你需要带 npm 的 Node `>=22.19.0`，以及已安装并登录到模型提供方的 Pi；Cadence 复用 Pi 的登录和模型设置。

```sh
npm install -g @abelxiaoxing/cadence
pi install "$(npm root -g)/@abelxiaoxing/cadence"
```

可选 WebUI/开机服务使用显式命令 `cadence server install` 注册并启动一个后台服务（Linux 上是 systemd，macOS 上是 LaunchAgent，Windows 上是登录项），并打印一个私有链接 `http://127.0.0.1:17423/?token=…`。
最后一条命令让 Pi 加载同一份副本用于 `/cadence`，因此一次 npm 升级就同时更新两者。
端口和 token 保存在 `~/.pi/agent/cadence/.env`；任何持有 token 的人都可以使用你的工作区，所以请保持链接私密。

## 使用

### 在浏览器中

1. 打开一次打印出的链接；浏览器之后会记住你。
   如果丢失了链接，`cadence token-link --reveal` 会再次打印它。
2. 用右下角的文件夹按钮明确选择项目。
   发送时复用已保存的模型偏好；没有可用偏好时只需选择一次。
3. 输入一次 `/cadence [目标]`，当前对话进入持续 Cadence 模式；之后正常对话，调查项目并反复澄清需求。
4. 查看完整计划，点击**按此计划实施**或发送 `按计划实施`。
   后台自动实施、检查、有限修复，并按计划完成本地交付。
5. 在同一对话查看真实进度和合并结果；子代理的完整上下文从左下角**子代理**面板打开。
   刷新、完成目标后仍保持 Cadence；**退出 Cadence**不取消后台工作，**取消工作流 — 请求停止**才请求取消。

### 在终端中：一次进入，持续对话

在任意已信任项目的 Pi 对话里输入一次 `/cadence <目标>`，之后正常对话即可。
Cadence 自动调查仓库、汇总需要你决定的问题，并与你反复对齐需求，生成包含范围、依赖、并行安排、环境准备、检查及交付策略的计划。
完整计划确认后，输入 `按计划实施`，系统自动实施、审查、验证、进行有界修复，并按约定完成本地交付。
独立 Git 任务在不同 worktree 中并行，验证后本地合并；不会默认推送、发布或部署。
非 Git 项目可选择直接工作副本交付，不执行提交或合并。

**完成任务后，这个对话仍然保持 Cadence 模式，不需要再次输入 `/cadence`。**
明确输入 `退出 Cadence` 或 `exit cadence` 才退出。
退出、关闭 Pi 或切换对话只脱离观察，不取消已接受的工作；需要取消时直接告诉 Cadence。

日常原生使用可按需启动或复用本地项目 owner，**无需安装系统服务或先进入项目管理器**。
模型偏好记在 `~/.pi/agent/cadence/settings.json`，跨项目复用，不复制 Pi 凭据。
项目知识维护在 `.cadence/project.md`；隔离 worktree 不会自动复制依赖或凭据，必要的准备命令会列入计划确认。

详细边界见 [对话模式](docs/conversation-mode.md)。
`/cadence-history [运行 ID]` 提供只读诊断、运行详情和已有任务历史，不创建或执行任务，也不启动服务。
见[历史与诊断](docs/history.md)。
浏览器批准与所展示的计划、会话和访问身份绑定；登录本身不是执行授权。

### 更多项目

```sh
cadence project open /absolute/project
cadence project open /absolute/new-project --create
```

每个项目都有自己的 owner、端口和历史，命令会打印其私有链接；WebUI 的文件夹选择器以相同方式打开项目。
打开另一个项目永远不会停止之前项目中的工作。

### 检查

检查命令在你批准的具体计划中列出，包括基线检查和验收检查。
真实检查结果与自动 Agent 审查保持独立。

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
