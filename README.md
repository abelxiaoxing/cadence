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

四个命令各自包含本阶段需要的操作指引，不再依赖共享工作流 Skill；普通任务不会从技能列表中自动选用 Abel 工作流。
Gate、交付校验和执行状态转换由控制面代码保证。
只有用户通过交互输入或 RPC 显式提交对应斜杠命令才允许激活；扩展生成的命令不会展开工作流。
当前任务的 Gate 回答与续轮保持阶段有效；用户结束工作流或转向无关任务时，父模型先调用 `{"action":"finish"}`，扩展等待活动操作停止并恢复原工具，保留可恢复进度。
此退出同样适用于 Implement，不表示完成或丢弃。
显式调用 Init 也会先退出已有阶段。

Implement 只暴露 `start`、`status`、`resume`、`rebind`、`cancel` 和 `discard` 控制命令。
`status` 完全本地可用；相同 operation id 幂等重放，进程、会话或 Worker 更换后仍从 durable checkpoint 继续。
Design 从第一步起统一使用 `action: "design"`：新需求通过 `start(requirement)` 进入，已有 change 通过 `start(change)` 进入，后续只携带返回的 `runId`。
需求、决策合同与 Gate A 合同由控制面规范化并计算哈希，调用方无需 SHA-256 工具；Gate B 自动绑定当前已编译 canonical plan，原始瞬时文本不会写入 durable journal。
`validate-plan-draft` 可在 `compile-plan` 前只读运行同一套编译检查，并以结构化 `taskId` / phase / field / verification 诊断定位问题；Design finalization 的安全诊断码也会进入错误详情与可展开 TUI，而不再只显示统一失败标题。
Design status 将可调用的 `legalOperations` 与顶层 `packetActions` 分开；显式退出只能发送 `{"action":"finish"}`，不能伪装成 `operation: "finish"`。

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

## 内部边界与运行验证

扩展入口负责宿主生命周期与服务装配，交付加载和验证适配器分别由独立模块负责。
工作流入口保留原有导出，状态机仍是唯一状态转换权威；执行服务通过类型化接口返回事实。
测试检查模块依赖无环，以及子会话无法导入主工作区应用和 run 状态权限。

新身份统一采用 UTF-16 码元排序，不依赖宿主语言环境。
旧 workspace manifest 按已保存的条目顺序验证原身份；已绑定批准证明的历史交付可保留原有集合顺序，仍需验证原始字节哈希和私有批准事实。
普通交付解析保持严格规范化。

私有 SQLite 表结构集中声明，打开时检查必需列、类型、空值约束、主键、唯一键、外键和 STRICT 属性；已支持的补列在同一事务中执行。
结构不符会在业务操作前拒绝，不自动重建或清空已有状态。

原生 I/O 线程以预构建的纯 JavaScript 随包发布，安装到 node_modules 后无需运行时 TypeScript 加载器。
`bun run check` 会检查线程构建产物是否与源码一致；修改相关源码后运行 `bun run build:workspace-io` 更新。
Git 快照与工作区物化由可信本地 I/O 线程执行，不占用宿主事件循环；Git 枚举默认限制为 30 秒，支持取消，线程退出后才返回。
物化优先使用写时复制，始终使用独立 inode 并验证复制内容。
元数据查询只校验 manifest，实际使用产物时再校验字节；未变更文件继续由保留的祖先 revision 持有，整个 run 的私有数据仍在终态统一清理。

Linux CI 单独安装并要求 Bubblewrap，验证实际隔离边界、后代进程取消，以及 Red → 状态重开 → Green → 累计验证 → Apply → Post-apply。
可在已配置 Bubblewrap 的 Linux 主机本地运行：

```sh
CADENCE_REAL_ISOLATION=1 bun run test:target test/isolation-real.integration.test.ts
node --experimental-strip-types scripts/benchmark-workspace.mjs 1000
```

基准输出快照、物化耗时、文件数、字节数及父事件循环延迟；耗时取决于文件系统和仓库大小。
真实隔离测试显式启用后，缺少可用后端会失败，不会跳过。

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

## OpenSpec 启动与平台范围

Design finalization 和 Implement delivery 加载共用无 shell 的 OpenSpec 适配层：读取已安装 `@fission-ai/openspec` 的 `package.json` 中 `bin` 声明，再以 Node 执行 JS 入口；不直接执行 Windows npm 的 `.cmd`，也不调用 `npx`、自动下载或切换 CLI 版本。

默认按宿主 `PATH` 定位 OpenSpec，支持 npm 全局默认/自定义 prefix，以及 Unix npm/Bun 的入口符号链接。
不搜索当前目录，不自动信任 consumer repository 内的 CLI；第一个已发现安装损坏时明确失败，不偷偷选用后续版本。
版本管理器的任意包装脚本、原生 exe 和 PowerShell 脚本不作为可执行回退。

特殊安装可在**启动宿主之前**配置以下环境变量（不属于 Worker 请求参数）：

| 变量                         | 含义                                                                                                                        |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `ABEL_OPENSPEC_PACKAGE_ROOT` | 已安装 `@fission-ai/openspec` 的绝对包目录，包含 `package.json`；不是 `.cmd` 或 JS 文件路径。显式配置代表操作者信任该安装。 |
| `ABEL_OPENSPEC_NODE`         | Node 原生可执行文件的绝对路径，例如 `C:\Program Files\nodejs\node.exe`；默认复用 Node 宿主。非 Node 宿主必须显式配置。      |

配置无效不会退回 PATH。
Windows 环境变量名按不区分大小写读取。
更换全局安装或 PATH 后应重启宿主，确保它继承新环境。

两个 CLI 子进程各有 30 秒超时、每个输出流 4 MiB 上限，关闭 stdin、禁用 OpenSpec telemetry，并在返回检查结果前等待两者结束。
校验报告的 exit 1 与 `valid: false` 被识别为 strict-invalid；无法启动、协议异常、超时、取消、输出超限分别给出安全诊断。
诊断只暴露 command、phase、reason、允许列表中的 systemCode 和 exitCode，不返回原始 stderr、绝对路径或环境变量。
inspection 不可用时不再级联误报 traceability 输入缺失，且绝不生成成功的 ready 收据。

平台契约 CI 使用 Linux、Windows、macOS × Node 22.13.0/24.13.0，显式安装 OpenSpec 1.5.0，验证真实 npm 全局入口、严格校验、Design finalization、失败重试和 proof-bound delivery 加载。
状态协议要求布尔字段 `isComplete`，用于判断 1.5.0 的规划产物是否齐全；若另有 `isPlanningComplete`，该字段也必须为布尔值，且两者均为 `true` 才视为规划完成。
CLI 的其他版本必须满足相同 JSON 协议；新增支持版本应加入契约测试。

**此矩阵不代表原生 Implement 隔离已全平台可用。**
当前隔离后端仍为 Linux Bubblewrap；Windows/macOS 的原生隔离、ACL 与完整文件应用语义需要单独实现和验收，缺少隔离能力时保持暂停，不降级为主工作区直接执行。

本地可用 `CADENCE_REAL_OPENSPEC=1` 启用真实 CLI 测试（Windows 可用 PowerShell 设置 `$env:CADENCE_REAL_OPENSPEC = "1"`），然后运行：

```sh
bun run test:target test/openspec-cli.test.ts test/design-delivery.integration.test.ts
```

未启用时，真实 CLI 用例明确跳过，其他适配层回归测试照常执行。
`bun run check` 的 JS 语法扫描使用 Node 遍历，不依赖 Unix `find`/`xargs`。

## Worker 路由（Worker routes）

路由配置是可选的：没有项目级或用户级文件时，三个包内 Agent 默认继承当前父模型，因此首次 Design、Implement 或 Diagnose 不需要预先配置 endpoint。
只有需要自定义模型、显式顺序或 failover 时，才复制 [`config/routes.example.json`](config/routes.example.json) 到项目级 `.pi/cadence/routes.json` 或用户级 `~/.pi/agent/cadence/routes.json`。
项目文件按整文件优先；route 必须显式列入对应角色，custom route 只引用 `apiKeyEnv` 的变量名，不能把凭据值写进 JSON。
一旦显式文件存在，它就是完整策略；损坏、缺字段或角色引用不一致会 fail closed，不会悄悄退回默认父模型。
旧配置的顶层数字标记 `2` 会被安全迁移为当前 canonical 结构；其他编号会以专用诊断码明确拒绝。
inherited route 声明的能力会与当前父模型真实能力取交集，不能通过夸大的配置绕过 admission。
transport 与 malformed structural result 都只在声明的 route 顺序内做有界 failover；只有一个 route 时会原地重试一次，多个 route 时按顺序切换。
相同 pause 的安全指纹与重复计数通过 `status` 暴露，凭据、URL 和原始输出仍保持私有。
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
bun run pack:check  # 真实 tarball 56 成员清单校验
bun run traceability:check   # 162 条 active Requirement/Scenario 引用精确解析且唯一归属
```

## 许可（License）

MIT — 详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
