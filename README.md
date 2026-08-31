# @abelxiaoxing/cadence

[![npm](https://img.shields.io/npm/v/@abelxiaoxing/cadence)](https://www.npmjs.com/package/@abelxiaoxing/cadence)
[![GitHub](https://img.shields.io/github/license/abelxiaoxing/cadence)](https://github.com/abelxiaoxing/cadence)

**Cadence** 是一个面向 Pi 的规范驱动四阶段工作流扩展包，内置可恢复的私有代理编排：

- `/abel-init [project-path]` — 本地、固定顺序且幂等地初始化或安全修复 OpenSpec 与 AGENTS 托管索引，不派发子代理。
- `/abel-design <requirement> | --change <change_name>` — 使用有界只读证据包解决行为与技术决策，生成经 Gate A（WHAT）和 Gate B（HOW）批准的 canonical delivery；不启动实现 Worker，不运行产品测试，也不修改产品代码。
- `/abel-implement <change_name>` — 在私有不可变 revision 中执行已批准的 Red-Green-Refactor DAG，累计验证全部任务后才通过一次可恢复事务写入主工作区。
- `/abel-diagnose <problem-description>` — 独立执行“复现 → 证伪 → 失败回归 → 最小修复”，不充当 Implement 的失败路由。

包是独立的：单一仓库、单一清单、单一 lockfile，无 workspace、无参考仓库检出、不依赖任何外部 Subagent 包。
加载本包会注册一个私有扩展与三个包内专业 Agent；`abel_dispatch` 工具注册但保持未激活，只有用户显式调用且包来源验证通过的 Design、Implement 或 Diagnose prompt 才会激活它。
仓库中存在 Abel 文件、OpenSpec change、AGENTS 索引或普通文本都不会启动工作流；Init 也不会激活派发工具。

共享工作流规则统一收录于包内 `abel-workflow` Skill；其发现信息同样明确要求先有显式 `/abel-*` 调用。

Implement 只暴露 `start`、`status`、`resume`、`rebind`、`cancel` 和 `discard` 控制命令。
`status` 完全本地可用；相同 operation id 幂等重放，进程、会话或 Worker 更换后仍从 durable checkpoint 继续。
Design 从第一步起统一使用 `action: "design"`：新需求通过 `start(requirement)` 进入，已有 change 通过 `start(change)` 进入，后续只携带返回的 `runId`。
需求、决策合同与 Gate A 合同由控制面规范化并计算哈希，调用方无需 SHA-256 工具；Gate B 自动绑定当前已编译 canonical plan，原始瞬时文本不会写入 durable journal。

普通 artifact、错误 Red、transport、environment、stale、conflict、baseline 与验证失败都留在同一 Implement run 中恢复。
累计验证发现 introduced failure 时会自动重开责任任务做有界修复；自动预算耗尽后 `resume` 复用已有 baseline 和 phase facts。
Design 证据包必须绑定 durable `runId`；接受后的有界证据、决策版本、Gate 证明与 canonical plan 身份写入 owner-private journal。
Design 激活期间，父模型只保留进入前已启用的 `read`、`grep`、`find`、`ls` 与 `abel_dispatch`；原工具集合会在 finalize、finish、切换阶段或 session 结束时精确恢复。
Implementation Worker 不再手写 unified-diff header、hunk range、分段或哈希；它一次提交有序的 `replace`、`rewrite`、`create`、`delete` 操作。
可信控制面在隔离 workspace 中校验精确文本、批准路径和 symlink 安全，生成并内部分块 sealed candidate；超限时保留可恢复状态而不接受截断 patch。
OpenSpec change 制品只能通过私有 `write-artifact` / `delete-artifact` 原子操作变更；产品文件、AGENTS、`gate-a.yaml`、`ready.yaml` 和 `implement-plan.json` 对该通道不可达。
Gate A/B 收据只有一套 canonical 结构，并在 Implement admission 时同时对照同一 root/change 的私有批准事实与 finalization revision/hash 事实验证。

只有继续工作确实需要新增行为、架构/策略、依赖、路径、资源、验证或 AGENTS 权限时才进入 `approval-needed`。
结果保留原 Implement run，明确给出 authority category、所需 Gate、引用和 `/abel-design --change <change>` 用户指引；不会自动调用另一阶段。
`resume` 只作为带有更高 `deliveryRevision` 与匹配 `receiptHash` 的条件命令出现。
用户显式完成 Design 后，新的 Implement 上下文会通过本地 `status` 自动发现 proof-bound 的精确 revision/hash，再对同一 run 做完整 admission 与 resume；不依赖复制上一次会话内容。

交互式 TUI、print、JSON 和 RPC 都以 durable semantic state 为准。
queued、connecting、waiting-first-response、running、validating、retrying、verifying、paused、approval-needed、applying 和 recovering 都不是完成；operation-cancelled 表示本次操作取消但 run 仍可恢复，discarded 与 rejected 是非成功终态。
只有最终 apply 与 post-apply verification 提交后的 `completed` 才显示成功。
Design finalization、Implement 终态、Diagnose/显式 `finish` 或 session shutdown 会清除 active stage 与 parent bridge；Design 还会恢复进入前的精确父工具集合，其他阶段只撤下 `abel_dispatch`。
Gate 等待和可恢复暂停保持激活以接收直接后续操作。

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

路由配置是可选的：没有项目级或用户级文件时，三个包内 Agent 默认继承当前父模型，因此首次 Design、Implement 或 Diagnose 不需要预先配置 endpoint。
只有需要自定义模型、显式顺序或 failover 时，才复制 [`config/routes.example.json`](config/routes.example.json) 到项目级 `.pi/cadence/routes.json` 或用户级 `~/.pi/agent/cadence/routes.json`。
项目文件按整文件优先；route 必须显式列入对应角色，custom route 只引用 `apiKeyEnv` 的变量名，不能把凭据值写进 JSON。
一旦显式文件存在，它就是完整策略；损坏、缺字段或角色引用不一致会 fail closed，不会悄悄退回默认父模型。
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
