# @abelxiaoxing/cadence

[![npm](https://img.shields.io/npm/v/@abelxiaoxing/cadence)](https://www.npmjs.com/package/@abelxiaoxing/cadence)
[![GitHub](https://img.shields.io/github/license/abelxiaoxing/cadence)](https://github.com/abelxiaoxing/cadence)

**Cadence** 是一个面向 Pi 的规范驱动四阶段工作流扩展包，内置可恢复的私有代理编排：

- `/abel-init [project-path]` — 本地、固定顺序且幂等地初始化或安全修复 OpenSpec 与 AGENTS 托管索引，不派发子代理。
- `/abel-design <requirement> | --change <change_name>` — 使用有界只读证据包解决行为与技术决策，生成经 Gate A（WHAT）和 Gate B（HOW）批准的 canonical delivery；不启动实现 Worker，不运行产品测试，也不修改产品代码。
- `/abel-implement <change_name>` — 在私有不可变 revision 中执行已批准的 Red-Green-Refactor DAG，累计验证全部任务后才通过一次可恢复事务写入主工作区。
- `/abel-diagnose <problem-description>` — 独立执行“复现 → 证伪 → 失败回归 → 最小修复”，不充当 Implement 的失败路由。

包是独立的：单一仓库、单一清单、单一 lockfile，无 workspace、无参考仓库检出、不依赖任何外部 Subagent 包。
加载本包会注册一个私有扩展与四个包内专业 Agent；`abel_dispatch` 工具注册但保持未激活，只有用户显式调用且包来源验证通过的 Design、Implement 或 Diagnose prompt 才会激活它。
仓库中存在 Abel 文件、OpenSpec change、AGENTS 索引或普通文本都不会启动工作流；Init 也不会激活派发工具。

共享工作流规则统一收录于包内 `abel-workflow` Skill；其发现信息同样明确要求先有显式 `/abel-*` 调用。

Implement 只暴露 `start`、`status`、`resume`、`rebind`、`cancel` 和 `discard` 控制命令。
`status` 完全本地可用；相同 operation id 幂等重放，进程、会话或 Worker 更换后仍从 durable checkpoint 继续。

普通 artifact、错误 Red、transport、environment、stale、conflict、baseline 与验证失败都留在同一 Implement run 中恢复。
累计验证发现 introduced failure 时会自动重开责任任务做有界修复；自动预算耗尽后 `resume` 复用已有 baseline 和 phase facts。
只有继续工作确实需要新增行为、架构/策略、依赖、路径、资源、验证或 AGENTS 权限时才进入 `approval-needed`；结果不会携带返回 `/abel-design` 的阶段路由。

交互式 TUI、print、JSON 和 RPC 都以 durable semantic state 为准。
queued、connecting、waiting-first-response、running、validating、retrying、verifying、paused、approval-needed、applying 和 recovering 都不是完成；operation-cancelled 表示本次操作取消但 run 仍可恢复，discarded 与 rejected 是非成功终态。
只有最终 apply 与 post-apply verification 提交后的 `completed` 才显示成功。

私有 journal、artifact 与 change workspace 位于 consumer repository 之外的 owner-private state root。
暂停会保留最小结构化恢复事实；完成或显式 discard 后安全清理。
不会持久化凭据、环境值、原始 prompt、隐藏推理、完整子会话或原始模型输出。

## 安装（Install）

### 在 pi 中快速安装（推荐）

```sh
$ pi install npm:@abelxiaoxing/cadence
Installed npm:@abelxiaoxing/cadence
```

也可以使用 npm 或 bun：

```sh
npm install -g @abelxiaoxing/cadence
# 或使用 bun：bun add -g @abelxiaoxing/cadence
```

已验证的加载路径：

- **npm 包（npm package）** — 从 npm registry 以用户级或项目级 scope 安装 `@abelxiaoxing/cadence`；Pi 发现四个 prompts、四个 skills、私有扩展与包内 Agents。
- **本地包目录（local package directory）** — 将 Pi 指向本仓库的绝对路径或相对路径（absolute or relative path，例如 `./cadence`），Pi 发现同样的资源。
- **已安装 tarball 目录（installed tarball directory）** — 运行 `bun pm pack --destination <tmp>` 生成真实 tarball（.tgz），安装或解压到隔离目录后指向该目录；tarball 文件本身永远不会被当作本地包传给 Pi。

本包要求 Node.js `>=22.13.0`，以使用稳定可用的内置 `node:sqlite`；不从参考仓库源安装，也不维护 Pi 主机版本兼容矩阵。

## Worker 路由（Worker routes）

复制 [`config/routes.example.json`](config/routes.example.json) 到项目级 `.pi/cadence/routes.json` 或用户级 `~/.pi/agent/cadence/routes.json`。
项目文件按整文件优先；route 必须显式列入对应角色，custom route 只引用 `apiKeyEnv` 的变量名，不能把凭据值写进 JSON。
`rebind` 只能选择已获 policy 授权且能力匹配的 route，不会扩大任务边界。

## 跨项目验证合同（Cross-project verification）

Cadence 不要求 consumer repository 提供 `check` 或 `test:target` 脚本。
Gate B 使用 Implement Runtime 同一套 capability validator，只批准 consumer 当前确实能够执行的结构化合同：

- `vitest`：显式 package script、本地 binary 或 `npx`（必须 `noInstall: true`），安全相对测试路径和 `minTests`。
  只有这个 kind 会注入 JSON reporter 并校验 Red assertion identity。
- `package-script`：固定 `bun | npm | pnpm | yarn`、script 名、完整 script
  command 和参数；可用于 typecheck、build 与仓库已有测试脚本。
- `static-check`：本地 binary、禁止下载的 `npx` 或安全相对 Node script；可用于
  schema/Prisma/AGENTS 等静态检查，不接收 Vitest 参数。
- `steps`：显式有序 precheck/target；不使用 `&&` 拼接复合命令。

例如 npm-only consumer 的 Vitest target：

```json
{
  "kind": "vitest",
  "id": "npm-vitest-target",
  "runner": {
    "kind": "package-script",
    "packageManager": "npm",
    "script": "test:run",
    "command": "vitest run"
  },
  "testFiles": ["tests/utils/upstreamFetch.test.js"],
  "args": [],
  "classification": "expected-green",
  "minTests": 1
}
```

Prisma 检查使用本地已安装 executable，不会隐式联网：

```json
{
  "kind": "static-check",
  "id": "prisma-schema",
  "runner": { "kind": "npx", "executable": "prisma", "noInstall": true },
  "args": ["validate"],
  "classification": "expected-green"
}
```

迁移时，将新的 Gate B argv 命令改为上述 kind；需要 `typecheck` 再测试时用 `steps`，并把 typecheck 建模为 expected-green precheck。
Cadence 仍接受旧版 `bun run test:target <paths>` 和 `bun run check` 合同并立即规范化，但 Design 不再生成 argv-only 合同。
脚本缺失会在 readiness 以 `verification-adapter/script-missing` 明确关闭，而不是在 Red 阶段误报为 Bubblewrap 或依赖环境故障。

## 开发（Development）

```sh
bun install
bun run check       # 语法 + 类型检查
bun run lint        # biome + rumdl
bun run test        # 完整测试套件
bun run test:target <files>   # 定向测试
bun run check:agents          # AGENTS 索引校验
```

## 验证（Verification）

```sh
bun run verify      # check && lint && test && pack:check（发布前全套校验）
bun run pack:check  # 真实 tarball 53 成员清单校验
bun run traceability:check   # 162 条 active Requirement/Scenario 引用精确解析且唯一归属
```

## 许可（License）

MIT — 详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
