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
bun run pack:check  # 真实 tarball 38 成员清单校验
bun run traceability:check   # 81 条 Requirement/Scenario 引用精确解析
```

## 许可（License）

MIT — 详见 [LICENSE](LICENSE) 与 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
