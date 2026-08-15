---
name: abel-design
description: 在不写产品代码的前提下，产出经双闸门批准、可直接实施且完全可追溯的 OpenSpec 变更。
category: abel
tags: [abel, design, openspec, PBT, subagents, agents]
argument-hint: "<requirement> | --change <change_name>"
---

<abel-request>
$ARGUMENTS
</abel-request>

<!-- ABEL:START -->
# 不可协商规则（最高优先级）

1. 仅设计：绝不生成或修改产品代码。
2. 写入范围：Gate A 之前严格只读，不持久化任何内容；Gate A 之后仅在已解析的 `changeRoot` 内写入，每次只创建一个就绪产物；仅当获批准的回环/一致性修复明确指向某个已完成产物时才可编辑它。
3. 绝不假设或猜测：每个阻塞性决策都必须提交用户（见决策模型）。
4. 仓库 `AGENTS.md` 保持只读：审计其过期声明并规划影响，本阶段绝不编辑；绝不触碰 OpenSpec 管理的 `openspec/` 生成物（schemas、`config.yaml`、skills 与 slash commands）。
5. 最终产出：严格校验通过、完全可追溯、阻塞决策为零、双闸门均在设计阶段完成批准的 OpenSpec 变更（READY_TO_IMPLEMENT）。

技能集成：见全局 AGENTS《阶段技能矩阵》Design 列。

## 决策模型

- 在会话内维护决策台账：id、类别（`behavior | technical`）、问题、证据、选项、建议、结论、状态、受影响产物。
  `BLOCKING_DECISIONS` 为其中未决的非机械决策数。
- 行为决策回答 WHAT：可观察结果、范围/非目标、场景、失败行为、数据/安全/隐私/兼容策略、成功标准。
- 技术决策回答 HOW：接口、数据流、依赖、存储/算法、实现错误机制、关键技术参数。
- 必须由用户批准：目标、范围/非目标与可观察成功行为；数据/安全/隐私/兼容/迁移规则；新依赖、跨模块架构、不可逆变更；任何有实质性权衡的技术选择（含关键参数）。
- 可由 agent 机械决定：仓库惯例唯一确定的命名/位置/局部结构；易逆且无外部行为变化的细节；由已批准设计直接推出的测试放置与执行顺序。
- 机械决策记录后不再重问；存在两个以上有实质差异的可行选项 → 升级为阻塞决策。
- 绝不创建运行时用户/会话状态文件。
  跨上下文只允许在 `changeRoot` 内生成 `gate-a.yaml` 与 `ready.yaml` 作为可复算的审计凭据；它们不是身份签名或工具权限，不得写入 AGENTS 索引。

## 阶段 0 —— 进入、模式与就绪（只读）

- 从 `<abel-request>` 读取完整需求或 `--change <name>`；不得用 frontmatter hint 或正文示例替代实际参数。
  参数为空或歧义阻塞时提问。
- 要求 OpenSpec 根已初始化且 CLI 能力齐全：`new change`、`list --json`、`schemas --json`、`schema which --json`、`schema validate --json`、`templates --json`、`status --json`、`instructions --json`、`validate --strict`。
  缺失则停止并给出 `/abel-init` 补救，本命令不执行初始化。
- 要求根 `AGENTS.md` 存在且托管区块结构有效；阅读相关嵌套索引；逐条对照代码、清单和可执行配置核实目标范围内声明。
  缺失/结构无效则停止并给出 `/abel-init`；过期声明记录进任务影响，本阶段不编辑。
- 模式解析：显式 `--change` → 恢复，不存在则停止并请用户纠正名称或选择新建；精确匹配已有变更 → 恢复；否则新建。
  绝不把疑似笔误静默当作新需求。
- schema 解析优先级：显式选择 > 已有变更 metadata > 项目配置 > `spec-driven`，且须出现在 `openspec schemas --json` 中。
  创建前运行 `schema which --json`、`schema validate --json` 并检查模板，做行为/技术/混合依赖预检；实施兼容性要求具体非空的 `apply.tracks` 与恰好一个产物的 `generates` 匹配，不兼容则在创建前关闭。
- 新建模式在探索前的最低输入：问题/目标陈述 + 范围锚点（涉及哪个模块/目录）；缺失则先简要提问。
- 生成暂定 kebab-case 变更名并用 `openspec list --changes --json` 查重；Gate A 定稿范围后重算并确认。
  此前不持久化任何内容。

## 阶段 1 —— 证据探索（只读）

- 主 agent 只负责核实相关 AGENTS、拆分探索包、派发、校验证据、综合、澄清与 Gate 呈现；广泛代码库探索必须委派。
  主 agent 仅可为范围划分、引用抽查和冲突裁决做最小定向读取。
- 默认并行派发多个只读探索子代理：优先按独立上下文边界拆分；只有一个边界时，按互不重叠的路径或符号证据面拆分。
  平台不支持并行或范围客观不可拆分时，记录原因并降级为一个只读子代理，不得静默改由主 agent 广泛探索。
- 每个探索包包含唯一 `packet_id`、精确路径/符号/问题边界、相关 AGENTS 内容、强制检索策略、禁止写入约束与输出预算；包集合覆盖目标范围，重叠仅用于核对跨边界依赖。
- 子代理强制返回 JSON：`packet_id`、`module_name`、`scope`、`files_read`、`evidence`（每项含 claim、path、line_start、line_end）、`existing_structures`、`existing_conventions`、`constraints_discovered`、`open_questions`、`dependencies`、`write_set_hints`、`validation_hints`、`agents_impact_hints`、`risks`、`success_criteria_hints`。
- 聚合前逐包校验 JSON、范围和引用；无引用、越界或互相冲突的结论必须定向重派或最小抽查。
  把约束、依赖、风险、潜在写集冲突与开放问题并入决策台账。
- 父代理负责验证与综合；子代理绝不批准 Gate、绝不写入。
- 按需 `/context7-auto-research` 核对候选库/API 的官方契约；按需 `/grok-search` 做架构模式调研。
- PBT 边界筛查：空输入、幂等性、顺序、大小/取值边界、状态转换合法性 → 形成阶段 2 的问题清单。

## 阶段 2 —— 行为澄清循环（允许多轮）

- 只覆盖 WHAT；库、协议、算法、存储、拓扑、实现参数一律路由到阶段 4。
- 每轮只提当前影响最大的阻塞问题，简明分组，各附证据、影响与建议默认值。
- 反模式（标记并拒绝）：可观察行为推迟到实现期决定；技术机制伪装成产品需求。
- 答案扩大模块/场景/数据边界 → 仅增量地回到阶段 1。
- 循环至未决行为决策为零。

## ⛔ Gate A —— 批准行为契约

- 呈现行为契约与相关台账条目；用户显式批准目标、范围/非目标、场景/成功标准与各项策略。
- 按批准的范围重算变更名并重新查重。
- 新建模式：仅此一时点运行 `openspec new change <name>`（仅显式非默认选择时加 `--schema`）。
- 构建产物计划，然后只物化安全且就绪的行为类产物。
- 最后写 `changeRoot/gate-a.yaml`：记录 receipt 版本、change/schema、行为契约摘要、批准原文的忠实摘要，以及全部 Gate A 产物的规范化相对路径与原始字节 SHA-256。
  禁止身份、时间戳、会话 id、模型 id 与工具授权字段。

## 产物计划与写入协议

- 创建前依据 schema 定义/模板做兼容性预判；创建后或恢复时依据 `status --json` 与 `instructions --json` 构建产物 DAG：id、输出路径、依赖/状态、决策类别（`behavior | technical | mixed`）、写入闸门、受影响决策；记录 `apply.tracks`。
  仅携带机械信息不使产物变为 mixed。
  `gate-a.yaml`/`ready.yaml` 是工作流审计凭据，不冒充 schema artifact，也不改变 DAG/status。
- 按产物承载的决策分类，绝不按硬编码产物名：behavior → Gate A；technical/mixed → Gate B；依赖 Gate B 产物的行为类 → 等 Gate B 后沿 DAG 推进。
- schema 若要求 Gate A 前写入、写入 `changeRoot` 之外、或以未批准的技术决策解锁行为 → 创建前停止，请用户选择兼容的 schema/映射。
  schema 顺序绝不凌驾于批准之上。
- 每次写入的强制循环：
  1. 重跑 `openspec status --change <name> --json`，核实 schemaName、changeRoot、artifactPaths、状态/依赖与 applyRequires；`existingOutputPaths` 是上下文，不是新文件目标。
  2. 运行 `openspec instructions <artifact-id> --change <name> --json` 并遵循其模板/规则/依赖。
  3. 阅读依赖与已有输出，做双向一致性检查。
  4. 在内存备好内容，于对应闸门前展示决策摘要或统一 diff；物化暴露新的实质决策 → 回到相应循环重新批准。
  5. 批准后只写一个就绪产物（或编辑一个被明确指向的已完成产物）；重跑 status，拓扑推进新解锁的产物。
- Receipt 写入仅免除不存在的 `instructions <artifact-id>`，其余边界、一致性与逐文件写入规则不变；生成前必须重算覆盖文件的 hash。
  任何 receipt 覆盖文件发生变化都立即使该 receipt 失效：回到最早受影响 Gate，实质变化须重新批准，机械一致性修复也须重算 receipt；`ready.yaml` 必须最后生成。

## 阶段 3 —— 技术推导

- 从 Gate A 契约、既有代码模式与官方 API 契约推导技术设计；机械决策直接记录进设计，实质性权衡进入阶段 4。

## 阶段 4 —— 技术决策与验证循环

- 覆盖 HOW：接口、数据流、实现错误机制、依赖/算法与关键参数（如 JWT vs session、经批准的 bcrypt cost factor）。
- PBT 适用性规则（六类筛查：交换/结合、幂等、往返、不变量保持、单调、边界）：具备不变量/往返/幂等/顺序/边界/状态转换的行为必须提取性质与证伪策略；不适合的记录原因并采用示例/E2E/静态验证，不强行套类。
- 每个场景获得稳定引用 `<spec-path>#<requirement-heading>/<scenario-heading>`，标题在 spec 内唯一；全程维护 Requirement → Scenario → Verification → Task。
- 先构建实施任务 DAG：所有任务引用存在且无环；依赖边标记 `artifact | contract | conflict-order`、原因与所需输出。
  由 DAG、写集和资源锁派生建议执行波次；波次只用于审阅，Implement 必须从可信契约重新计算。
- 每个任务恰好一个 schema 复选框，验证契约使用普通缩进符号列表（绝不嵌套 `- [ ]`/`- [x]`）：
  - 任务 ID；Requirement + 稳定 Scenario 引用
  - 直接前置任务（无则 `[]`）、依赖类型、所需输出与原因
  - 非任务前置条件及其可执行或静态检查
  - 派发上下文：完成任务所需的最小 spec、AGENTS、代码路径与符号
  - 建议执行波次；并行资格 `eligible | serial` 及原因
  - 计划写集：修改/新建/删除的精确路径或最窄可判定 glob；预期交付文件/符号
  - 冲突集：任务 ID + 原因；共享状态、生成物、清单、数据库、端口、fixture 或验证资源及所需资源锁
  - 验证类型：`property | example | E2E | static`
  - Red 命令 + 预期失败原因；Green 预期行为
  - 受影响套件命令；目标范围；验证命令的并行资格及资源锁
  - AGENTS 影响：`none | update-existing | create-index | remove-index`
  - AGENTS 目标索引 + 基于证据的原因；AGENTS 验证命令（可执行或静态）
- Gate B 前审计调度契约：前置条件可判定，波次满足拓扑顺序；同波次任务的写集、共享资源和验证锁均不冲突；每个冲突均有 `conflict-order` 串行边；每个任务可由最小派发上下文独立执行。
- 写集未知、过宽或可能重叠的任务不得标为并行；先重塑任务，或用 `conflict-order` 串行化。
- 非行为变更任务的 Red 是变更前即可执行的静态验证。
  仅人工验证的任务不具备实施就绪性，绝不通过 Gate B 或退出；重塑任务直至具备可执行验证。
- 范围内每个索引过期发现分配给一个任务，或报告为无关的既有过期问题。
- 循环至未决技术决策为零；在内存中备好剩余产物内容/统一 diff。

## ⛔ Gate B —— 批准实施契约

- 核实阶段 3/4 忠实展开 Gate A 契约，未引入未批准的新决策。
- 呈现实质技术决策、任务 DAG/建议波次、前置条件、计划写集/冲突/资源锁、验证映射、AGENTS 影响矩阵与产物物化预览；用户显式批准。
- 按写入协议逐个写入剩余就绪产物。
- 最后写 `changeRoot/ready.yaml`：记录 receipt 版本、change/schema、Gate B 批准原文的忠实摘要（含任务 DAG、建议波次、前置条件、计划写集、冲突与资源锁）、任务验证与 AGENTS 影响摘要、`gate-a.yaml` 的 SHA-256，以及全部规划产物的规范化相对路径与 SHA-256；排除 `ready.yaml` 自身。
  任务跟踪文件计算 hash 前只将任务完成标记 `- [x]`/`- [X]` 规范化为 `- [ ]`，其余字节不得忽略。

## 回环规则

- 答案扩大边界 → 阶段 1；技术分析推翻行为契约 → 阶段 2（只重批受影响决策并同步所有受影响产物）；Gate B 发现物化不忠实 → 阶段 3/4（Gate A 未受影响的决策保持批准）；严格校验/验证契约/可追溯性失败 → 引入不一致的最早阶段。
  绝不隐瞒迟发现的阻塞问题。

## 恢复规则

- 仅当相应 receipt、artifact hash、追溯链与 strict validation 全部通过时，才将设计阶段已完成的 Gate 视为可信交付；仅切换上下文不触发重复批准。
- 恢复以当前 schema/status 的 `changeRoot` 与 artifactPaths 为准；receipt 使用上述固定根文件名，但文件存在本身不证明批准。
- 算法：
  1. `openspec status --change <name> --json`，使用其 schemaName、changeRoot、artifactPaths 与状态；阅读全部 `existingOutputPaths` 与依赖。
  2. 校验 `gate-a.yaml`/`ready.yaml` 的格式、change/schema 绑定、规范化相对路径、hash 与覆盖范围；拒绝绝对路径、`..`、越界及符号链接逃逸。
  3. 检查 `openspec validate <name> --strict --type change`、模板完整性、跨产物一致性、可追溯性、验证契约，以及任务 DAG、波次、写集、冲突与资源锁的调度完整性。
  4. 重建产物计划，从最早未完成或不一致的阶段继续，不重新请求仍有有效 receipt 的 Gate。
  5. 选择下一步：变更不存在 → 停止并请用户确认拼写/新建；receipt 缺失、hash 失效或产物不完整/不一致 → 回到最早受影响阶段并重新批准该 Gate；`applyRequires` 全部 `done` 且全部校验通过 → 执行退出审计；仅存未持久化的会话分析 → 无中途恢复，重跑只读分析。

## 退出条件

- [ ] `openspec validate <name> --strict --type change` 问题为零
- [ ] `applyRequires` 中每个产物 id 状态均为 `done`
- [ ] `apply.tracks` 解析到 `changeRoot` 内生成的任务产物
- [ ] 产物一致且可追溯；任务 DAG 无环、前置条件可判定、波次及冲突排序有效、计划写集与资源锁完整；每个任务验证契约完整且可执行，无仅人工任务
- [ ] 每个任务的 AGENTS 影响契约完整；仓库索引未被修改
- [ ] BLOCKING_DECISIONS = 0
- [ ] `gate-a.yaml` 与 `ready.yaml` 格式、覆盖范围及全部 hash 校验通过
- [ ] Gate A 与 Gate B 已在可信实施交付前于设计阶段完成
- [ ] 状态：READY_TO_IMPLEMENT

## 参考命令

- `openspec context --json` / `openspec schemas --json`
- `openspec view` / `openspec list --changes --json` / `openspec list --specs`
- `openspec status --change <name> --json` / `openspec instructions <artifact-id> --change <name> --json`
- `openspec new change <name>`（仅 Gate A）
- 校验失败时 `openspec show <name> --json --deltas-only`
- 定义新约束前 `rg -n "Constraint:|MUST|MUST NOT|INVARIANT:|PROPERTY:" openspec/`
<!-- ABEL:END -->

If the required input is missing or absent, or the request is ambiguous and not unique, stop before any work and ask the user for the missing or clarified input.

Design work is read-only before an explicit Gate A approval: do not write product code, and wait for the user when a blocking decision or ambiguity remains.
Only after Gate A approval may design artifacts be written inside the change root.
Resume an existing change with --change <change_name>: validate the Gate receipt, artifact hash, and trace strictly; when an artifact is inconsistent or invalid, report readiness only when the delivery is complete and READY_TO_IMPLEMENT holds.
