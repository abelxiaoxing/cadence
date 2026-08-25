# @abelxiaoxing/cadence

[![npm](https://img.shields.io/npm/v/@abelxiaoxing/cadence)](https://www.npmjs.com/package/@abelxiaoxing/cadence)
[![GitHub](https://img.shields.io/github/license/abelxiaoxing/cadence)](https://github.com/abelxiaoxing/cadence)

**Cadence** 是一个面向 pi 的规范驱动四阶段工作流扩展包，内置私有代理编排：

- `/abel-init [project-path]` — 初始化 OpenSpec 并修复 AGENTS 索引。
- `/abel-design <requirement> | --change <change_name>` — 并行只读探索，设计依赖/冲突感知的任务 DAG，经由 Gate A（行为契约）与 Gate B（技术契约）双重批准。
- `/abel-implement <change_name>` — 在已批准的 DAG 上编排任务级专业代理，委派 Red-Green-Refactor，由父代理执行验证。
- `/abel-diagnose <problem-description>` — 先验证根因，再做最小修复。

包是独立的：单一仓库、单一清单、单一 lockfile，无 workspace、无参考仓库检出、不依赖任何外部 Subagent 包。
加载本包会注册一个私有扩展与四个包内专业 Agent；`abel_dispatch` 工具注册但保持未激活，只有经过验证的 Design、Implement 或 Diagnose 阶段才会激活它。

共享工作流规则统一收录于包内 `abel-workflow` skill。

交互式 TUI 中，经过验证的 `abel_dispatch` run 会显示紧凑的 Subagent 角色、请求、阶段、目标、耗时和状态，并在编辑器上方临时汇总仍在排队或运行的 Agents。

该显示只保留有限的终态摘要；不会显示子会话、工具活动、路径、模型身份、隐藏推理、完整引用或完整 diff。

print、JSON 和 RPC 模式保持原有结果与事件行为不变。

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

本包从不检查或分类 Pi 主机版本，不声明任何版本范围，也不从参考仓库源安装。

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
bun run pack:check  # 真实 tarball 44 成员清单校验
bun run traceability:check   # 81 条 Requirement/Scenario 引用精确解析
```

## 许可（License）

MIT — 详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
