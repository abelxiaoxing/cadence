---
name: abel-implement
description: 校验已批准的 OpenSpec 变更，并调度子代理并行执行强制 Red-Green-Refactor，在任务检查点维护 AGENTS 索引。
category: abel
tags: [abel, implementation, TDD, agents]
argument-hint: "<change_name>"
---

<abel-request>
$ARGUMENTS
</abel-request>

<!-- ABEL:PROMPT:abel-implement -->
<!-- ABEL:START -->
**参数**：从 `<abel-request>` 读取必需的 `<change_name>`。

# 护栏

- 改动保持最小且已获批准；应用任何修改前做副作用评审；保留无关的脏文件。
- 最少注释/文档，优先自解释代码。
- OpenSpec 约定以 `openspec/config.yaml` 声明的 schema 及其模板为准；OpenSpec 管理的 `openspec/` 生成物（schemas、`config.yaml`、skills 与 slash commands）绝不编辑。

## TDD 护栏（强制）

- **Red**：只创建/执行任务的失败可执行验证；实现代码禁止。
- **Green**：写最小代码满足验证；过度工程禁止。
- **Refactor**：在保持目标与受影响验证为绿、不引入完整套件新失败的前提下优化质量。
- 每次代码/测试变更后必须运行任务验证，并在会话中重新分类累计的 AGENTS 影响；仅在稳定任务检查点写索引。
  绝不跳过验证；测试先行强制。

**技能集成**：见全局 AGENTS《阶段技能矩阵》Implement 列；E2E 任务 → `/dev-browser`。

## 就绪预检（任何代码/测试写入之前）

Implement 不重新作出或请求 Gate A/B 决策；只有 Gate receipts、artifact hashes、追溯链与 OpenSpec strict validation 全部通过时，才将所选变更视为可信设计交付。

1. 从 `<abel-request>` 直接解析 change name；仅在缺失或无法唯一解析时提问。
   绝不要求无条件的 `openspec view` 确认。
2. 解析仓库根目录，记录 `git status --short`，阅读根/相关嵌套索引。
   根索引缺失/无效 → `/abel-init`。
3. `openspec status --change <name> --json`：读 `schemaName`、`changeRoot`、`artifactPaths`、`applyRequires`、`artifacts`。
4. `openspec schema which <schemaName> --json` 读取解析出的 schema.yaml，提取 `apply.tracks` 并相对 `changeRoot` 解析；必须是 `changeRoot` 内一个已存在的具体常规文件。
   缺失/空/不具体/越界路径一律关闭失败；绝不从 apply 指令的 `contextFiles`/`tasks` 推断跟踪路径。
5. `applyRequires` 中每个产物 id 状态必须为 `done`；数组存在或总体完成标记不算数。
6. 校验 `changeRoot/gate-a.yaml` 与 `changeRoot/ready.yaml`：receipt 版本、change/schema 绑定、批准摘要、artifact 覆盖范围、`gate-a.yaml` hash，以及每个规范化相对路径的 SHA-256。
   hash 使用文件原始字节；仅对 schema `apply.tracks` 指向的任务文件先把 `- [x]`/`- [X]` 规范化为 `- [ ]`。
   拒绝绝对路径、`..`、越界与符号链接逃逸。
   receipt 缺失或任一 hash 失效即关闭失败。
7. `openspec validate <name> --strict --type change` 问题为零。
8. 阅读 `artifactPaths` 报告的全部规划产物；运行 `openspec instructions apply --change <name> --json` 并遵循其 apply 契约。
9. 校验稳定 Requirement/Scenario 引用、Requirement → Scenario → Verification → Task 追溯链，以及每个任务的前置条件、`depends_on`、计划写集、冲突/资源锁、派发上下文、验证和 AGENTS 影响契约；缺失、含糊或不可判定时关闭失败。
10. 在任何写入前运行并记录每个未完成任务的目标命令、全部 affected-suite 命令与完整套件基线：命令、退出码、归一化失败标识/原因。
    尚未加入 Red 验证时，目标命令可记录为契约规定的预期状态；既有失败与目标 Red 严格分离，既有失败绝不算 Red。
11. 任一预检项失败 → 停止并返回 `/abel-design --change <name>`；此处绝不虚构或修补产品/行为/架构决策。

**工具路由**：父代理只负责可信交付校验、执行图调度、子代理派发、统一 diff 审查与机械应用、验证决策、Gate/AGENTS/任务状态所有权，不直接编写测试、实现或局部重构。
任务的 Red、Green、Refactor 内容统一由任务 worker 子代理生成；E2E 任务使用 `/dev-browser`。

## 执行图与并行调度（父代理专有）

1. 从全部未完成任务的直接前置任务构建 DAG，拒绝未知任务、自依赖和环。
   非任务前置条件通过契约检查后，且所有前置任务均已由父代理验收并推进状态，任务才进入 ready 集合。
2. 规范化每个计划写集、冲突集和资源锁；写集覆盖测试、fixture、快照与生成输出。
   拒绝绝对路径、`..`、符号链接逃逸和不可判定的宽泛 glob。
   Gate receipt、OpenSpec 跟踪文件和 `AGENTS.md` 不属于子代理写集，只能由父代理按契约写入。
3. 父代理从 ready 集合计算受可用并发槽约束的批次；仅计划写集两两不相交、无冲突边且共享/验证资源锁兼容的任务可同批。
   相同路径、祖先/后代目录、共同生成输出或互斥资源均串行；Design 的建议波次只供核对，不替代重新计算。
4. 每个 ready 任务绑定一个任务局部 worker，并在同一 worker 上通过后续派发连续完成 Red、Green、Refactor，避免把全局上下文复制给 worker。
   首次派发只提供相关 AGENTS 内容、任务契约、允许读取/改动范围、可信基线标识与当前阶段；worker 不得广泛探索。
5. 同批 worker 并行生成当前阶段的统一 diff 和说明，不得写入任何工作树。
   父代理按跟踪文件顺序校验基线、实际路径、契约与 diff，再机械应用合格 diff；父代理不得自行补写或修正实现。
   每次应用后由父代理运行契约命令，并把命令、退出码和归一化结果回传原 worker，作为进入下一阶段或生成修正 diff 的唯一事实。
6. diff 冲突、越界、写集扩张或验证失败时只阻塞该任务及其后继；已独立验收的同批任务可保留。
   机械重派可在不改变行为、架构、依赖和写集契约时基于最新基线进行；需要新行为、实质架构、未声明依赖/冲突或范围扩张时，停止受影响分支并返回 Design。
   禁止无界重试。
7. 一批任务稳定后，父代理逐任务完成 AGENTS 检查点和状态推进，再重新计算 ready 集合；任何后继不得提前调度。
   循环直至 DAG 全部完成。

## 每个任务的委派式 TDD 循环

worker 消费任务契约的普通缩进符号列表（绝非 Markdown 复选框）：前置条件、直接依赖、派发上下文、计划写集、冲突/资源锁、验证类型、Red 命令/预期失败原因、Green 预期行为、受影响套件命令、目标范围和 AGENTS 影响。

1. **🔴 Red（worker → 父代理）**：worker 只用契约规定的验证类型与范围生成失败验证 diff；父代理审查并应用后运行 Red 命令，必须因契约描述的目标缺陷失败。
   加载/导入失败、未运行目标测试或失败身份与批准身份不同时，将结果分类为生成的实现产物拒绝并进入有界修正路径。
   若 Red 在预检候选上通过，或批准命令无法在不改变行为、策略、依赖、架构、范围、写集或验证契约的情况下见证批准行为，则 Red 契约无效：立即返回 `/abel-design --change <name>`，不得消耗产物修正预算。
   非行为变更任务以指定的失败静态验证起步；仅人工任务返回 Design。
2. **🟢 Green（worker → 父代理）**：同一 worker 基于已确认的 Red 证据生成最小实现 diff；父代理审查并应用后运行目标验证。
   失败证据回传 worker，仅允许在声明写集和已批准行为内生成修正 diff。
3. **🔵 Refactor（worker → 父代理）**：同一 worker 仅在声明范围内生成消除重复、改进命名/结构/可读性的可选 diff；父代理每次应用后跑目标验证，重构后跑 affected suite；失败则仅撤销该次重构 diff。
4. **交付验收（父代理）**：拒绝基线不符、越界文件、Gate/索引/跟踪文件修改、验证证据缺失或未批准行为；父代理只做契约判断、机械应用与验证，不直接修码。
5. **AGENTS 检查点（父代理）**：审查完整任务 diff，比较实际与计划的 AGENTS 影响。
   - 暴露未批准的行为/架构 → 停止并返回 design。
   - 分类为 `none` → 记录证据；否则对 `<!-- ABEL:AGENTS-INDEX:START -->` … `<!-- ABEL:AGENTS-INDEX:END -->` 托管区块做最小的更新/创建/移除，保留人工与无关内容。
   - 校验已索引的路径/命令/根到嵌套路由；运行该任务的 AGENTS 验证命令。
6. 父代理重跑目标与受影响验证；全绿后，仅在 schema `apply.tracks` 解析出的具体跟踪文件中更新匹配的那个任务复选框；零个/多个匹配 → 停止并返回 design。

Syntax, import/load, no-test, malformed-diff, and wrong-Red-identity failures are generated implementation-artifact rejection.
A wrong-Red result follows the same bounded artifact-correction path.
Every artifact rejection uses a finite artifact correction budget shared with the phase's mechanical redispatch budget.
When the artifact correction budget is exhausted, report `implementation-artifact-delivery-blocked`; it must not automatically return, transition, or route to Design.
An invalid Red contract is one where Red passes against the preflighted candidate, or where the approved command cannot witness the approved behavior without a substantive behavior, policy, dependency, architecture, scope, write-set, or verification-contract change.
An invalid Red contract must immediately return the contract defect to Design and must not consume the artifact correction budget.
Only an invalid Red contract or another substantive change to behavior, policy, dependency, architecture, scope, write set, or verification contract may route the branch to Design.

父代理拥有主工作区补丁应用、闸门、索引写入与任务完成状态；子代理只接收任务局部索引上下文，只返回统一 diff 与分析，绝不应用补丁、批准决策、编辑索引或推进状态。

## 最终评审与收尾

1. 全部目标测试为绿后运行受影响套件。
2. 重跑同一完整套件命令，与基线的归一化失败标识对比，要求无新增失败。
3. 变更风险需要时以子代理做全局只读评审；接受其编辑后重跑目标验证与 AGENTS 分类。
4. 目标/索引/受影响/完整套件任何失败都阻塞完成；只修复或回退本次变更的编辑。
5. 最终副作用评审。
6. 要求每个任务/索引结论均已解决，然后报告：Red/Green/Refactor 证据、受影响/完整套件相对基线的结果、AGENTS 文件与原因、是否可进入用户授权的归档。
   绝不隐式归档。

## 输出格式

```text
## /abel-implement (TDD)

### 任务 i/N: {任务描述}
🔴 Red  ├─ 类型: {verification_type} ├─ 运行: {red_command} └─ 结果: 因 {预期失败原因} 失败 ✓
🟢 Green ├─ 实现: {文件} ├─ 运行: {red_command} └─ 结果: {green 预期行为} ✓
🔵 Refactor ├─ 优化: {描述} ├─ 运行: {affected_suite_command} └─ 结果: 绿 ✓
AGENTS: {none 的证据 | 更新的索引文件与原因}

### 全部任务完成
├─ 目标测试: 绿 ✓
├─ 受影响套件: 绿 ✓
├─ 完整套件: 相对基线无新增失败 ✓
└─ 可进入用户授权的归档
```

<!-- ABEL:END -->

If the required input is missing or absent, or the request is ambiguous and not unique, stop before any work and ask the user for the missing or clarified input.

Record target, affected suite, and full-suite baselines before writing; keep pre-existing failures separate and never attribute them to the task Red.
Red must fail with the expected identity; a wrong reason is a generated implementation-artifact rejection handled by bounded correction.
If Red passes against the preflighted candidate or the approved command cannot witness the approved behavior, the invalid Red contract returns immediately to Design without consuming the artifact correction budget.
After Green the target and affected suite must be green, in Red-Green-Refactor order, with a stable AGENTS index at checkpoints and no new failure relative to the recorded baseline.
A fresh-context handoff validates the Gate receipt, hash, and trace strictly without requesting Gate approval again.
You must not archive, publish, or commit implicitly: only explicit parent actions may do so.
