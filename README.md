# @abelxiaoxing/cadence

面向 Pi 的 Abel 工作流扩展：提供 Design、Implement、Diagnose 和 Init 四个显式命令。
普通任务无需启用工作流；只有用户主动输入斜杠命令时才会激活。

## 安装

要求：Node.js >= 22.13、Git、Pi，以及 `@fission-ai/openspec@1.5.0`。

```sh
pi install npm:@abelxiaoxing/cadence
```

## 使用

```text
/abel-init
/abel-design <需求>
/abel-implement <change>
/abel-diagnose <问题描述>
```

- `abel-init`：初始化或修复项目的 OpenSpec 与 AGENTS 基础结构。
- `abel-design`：调查需求并生成可执行交付计划。
- `abel-implement`：执行已批准的计划，支持暂停、恢复和取消。
- `abel-diagnose`：复现问题并执行最小修复。

Implement 默认使用 Linux Bubblewrap 隔离。

可信 Linux 项目可显式设置 `ABEL_EXECUTION_MODE=local-trusted`。

Windows x64 的可信模式见 [Windows 执行说明](docs/windows-host-trusted.md)。

## 配置

没有自定义路由时，Worker 默认继承当前父模型。

需要自定义模型时，复制 [`config/routes.example.json`](config/routes.example.json) 到项目的 `.pi/cadence/routes.json` 或用户目录 `~/.pi/agent/cadence/routes.json`。

研究服务配置使用项目级 `.pi/cadence/.env` 或用户级 `~/.pi/agent/cadence/.env`。

可参考 [`config/.env.example`](config/.env.example)。

密钥只保存在本地，不要提交 Git。

## 开发

```sh
bun install
bun run check       # 语法、构建产物和类型检查
bun run lint        # 格式与 Markdown 检查
bun run test        # 测试
bun run verify      # 发布前完整检查
```

其他只读检查：

```sh
bun run doctor /path/to/project
bun run runs /path/to/project
bun run pack:check
bun run traceability:check
```

## 项目结构

- `src/`：扩展和工作流实现
- `prompts/`：四个用户入口
- `agents/`、`skills/`：随包资源
- `config/`：示例配置
- `openspec/specs/`：当前规范
- `docs/`：仅保留必要的平台说明

历史设计、评估报告和已完成变更不放在主仓库中。

## 许可

MIT，详见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
