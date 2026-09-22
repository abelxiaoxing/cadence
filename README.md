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

Worker 使用独立的 `pi --mode json -p --no-session` 子进程，并继承当前父模型的 `provider/id` 引用与宿主 Pi 凭据配置。
子进程按角色使用明确工具白名单；Implement 子进程只在 disposable proposal workspace 中编辑，父控制面仍负责 diff、写入边界、候选 sealing 和验证。
取消会终止并等待子进程及其管道收束。

工作目录和 `--tools` 不是操作系统沙箱；需要更强隔离时仍应使用 Bubblewrap、容器或平台原生 Job。
父进程会拒绝超出 approved write/delete set 的变更，不会静默丢弃。

Cadence 不再读取 `.pi/cadence/routes.json` 或 `~/.pi/agent/cadence/routes.json`，也不再维护 route health、custom subagent provider 或 endpoint 路由。
请使用宿主 Pi 的模型、`models.json` 和认证配置；缺失认证或模型时会返回有界错误而不会静默切换。

研究服务配置使用项目级 `.pi/cadence/.env` 或用户级 `~/.pi/agent/cadence/.env`。

可参考 [`config/.env.example`](config/.env.example)。

密钥只保存在本地，不要提交 Git。

## 加载方式

包可以从以下路径加载：

- **npm 包（npm package）**：`pi install npm:@abelxiaoxing/cadence`
- **本地包目录（local package directory）**：将 Pi 指向仓库的绝对或相对路径（例如 `./cadence`）
- **已安装 tarball 目录（installed tarball directory）**：用 `bun pm pack --destination <tmp>` 生成 `.tgz`，安装或解压后指向该目录

Pi 相关 peer 依赖使用 `*`，不限制宿主 Pi 的版本。

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

## 附录

### 公共 UI 的 impactClosure 作者格式

`page-state` 与 `public-html` 可以同时声明。
以下是 **PlanDraft 任务片段**，合并到现有 `tasks[i]`；路径和证据必须替换为仓库真实调查结果。
假设 Red 修改 `test/page-state.mjs`，已有 `test/public-html.mjs` 只读保留：

```json
{
  "read": ["test/page-state.mjs", "test/public-html.mjs"],
  "impactClosure": {
    "changedSurfaces": ["page-state", "public-html"],
    "searchEvidence": [
      "检索页面状态的调用点及 test/、tests/ 中的覆盖：test/page-state.mjs 需更新状态切换断言，test/public-html.mjs 覆盖现有公开 HTML。"
    ],
    "relatedTests": [
      {
        "path": "test/page-state.mjs",
        "evidence": "本任务 Red 更新页面状态切换回归；由阶段 write 推导为 current-task。"
      },
      {
        "path": "test/public-html.mjs",
        "evidence": "保留已有 HTML 断言并执行受影响验证；无任务写入，推导为 unaffected。"
      }
    ],
    "affectedSuite": ["test/page-state.mjs", "test/public-html.mjs"]
  }
}
```

`impactClosure` 恰好包含 `changedSurfaces`、`searchEvidence`、`relatedTests` 和 `affectedSuite` 四个字段。
`changedSurfaces` 是合法枚举数组，`none` 不能与其他值混用。
`searchEvidence` 记录实际检索与结论。
`relatedTests` 每项位于 `test/` 或 `tests/` 下，`disposition` 可省略由编译器推导。
`affectedSuite` 是影响清单而非验证器，每项必须有对应的 `relatedTests` 条目。

## 项目结构

- `src/`：扩展和工作流实现
- `prompts/`：四个用户入口
- `agents/`、`skills/`：随包资源
- `config/`：示例配置
- `openspec/specs/`：当前规范
- `docs/`：仅保留必要的平台说明
- `README.md` 附录：公共 UI 计划的 impactClosure 作者格式

历史设计、评估报告和已完成变更不放在主仓库中。

## 许可

MIT，详见 [LICENSE](LICENSE) 和 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
