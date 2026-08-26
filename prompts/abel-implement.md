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

## AGENTS 阶段权限（Implement 专用）

Design 阶段的 `AGENTS.md` 只读规则仅适用于 Design 阶段，不继承为全局规则。
进入 Implement 后，父代理必须按 Gate B 已批准的结构化契约在稳定任务检查点执行：

- `agentsImpact: none`：不得修改任何 `AGENTS.md`，且不得声明 `agentsTarget`。
- `agentsImpact: update-existing`：父代理应更新指定现有索引的托管区块。
- `agentsImpact: create-index`：父代理可创建批准路径的新索引。
- `agentsImpact: remove-index`：父代理可移除批准路径的索引托管区块；仅当无人工内容残留时才删除文件。
- 非 `none` 必须有明确 `agentsTarget` 且 `agentsManagedOnly: true`。
  父代理只能修改批准路径及 `<!-- ABEL:AGENTS-INDEX:START -->` 到 `<!-- ABEL:AGENTS-INDEX:END -->` 的托管区域，保留全部人工内容。
- 子代理始终不能修改任何 `AGENTS.md`，其派发写集必须排除 Gate receipt、OpenSpec 跟踪文件和 AGENTS 路径。
- 已批准的 AGENTS checkpoint 是正常 Implement Green/检查点工作，必须完成；不能成为阶段路由或用户恢复动作。

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
6. 校验 `changeRoot/gate-a.yaml` 与 `changeRoot/ready.yaml`：当前 receipt 版本、change/schema 绑定、批准摘要、artifact 覆盖范围、`gate-a.yaml` hash，以及每个规范化相对路径的 SHA-256。
   `ready.yaml` 必须只含一份 canonical `implementGraph`，且 `implementGraphHash` 必须等于 `hashImplementGraphBoundary(implementGraph)`；`verificationClosure` 必须精确为 `{ executable: true, diagnostics: [] }`。
   hash 使用文件原始字节；仅对 schema `apply.tracks` 指向的任务文件先把 `- [x]`/`- [X]` 规范化为 `- [ ]`。
   拒绝绝对路径、`..`、越界与符号链接逃逸。
   receipt 缺失或任一 hash 失效即关闭失败。
7. `openspec validate <name> --strict --type change` 问题为零。
8. 阅读 `artifactPaths` 报告的全部规划产物；运行 `openspec instructions apply --change <name> --json` 并遵循其 apply 契约。
9. 从 receipt 的 `implementGraph` 校验稳定 Requirement/Scenario 引用、Requirement → Scenario → Verification → Task 追溯链，以及每个任务的前置条件、`dependsOn`、计划写集、冲突/资源锁、派发上下文、验证、批准依赖、结构化 AGENTS 影响和影响闭包契约；缺失、含糊或不可判定时按下方矩阵关闭失败。
   每个 phase 必须是 Gate B 批准的结构化 `kind: "vitest" | "package-script" | "static-check" | "steps"`；Implement 不从命令固定下标猜测语义，也不隐式运行 `bun run check`、`bun run test:target` 或任何 consumer script。
   `steps` 按声明顺序执行；precheck 必须是显式 `expected-green` step，不得用 `&&` 或其他 shell operator 合成。
   每个 phase 的直接 verification input 必须恰好绑定为 `workspace` path 或 graph `outputId`；每个 output 必须有唯一 id/path/producer phase 和 `regular-file` postcondition。
   write set 只授予权限，不能推断 provenance。
10. 影响闭包（impact closure）：若任务修改路由授权、页面状态、API 响应或公共 HTML，检查 URL/路由/handler/template 检索证据及全部相关既有测试归类。
    E2E、theme/layout、authorization、HTML/template、API contract 测试必须进入当前写集、明确后续回归任务或有不受影响证据；affected suite 不能只包含新增测试。
    `/videos`、`/api/videos` 等变化须检查全部这些测试面。
11. 在 graph admission 前，使用 receipt 中同一个 `implementGraph` 重跑共享 `assessImplementGraphReadiness`。
    fresh context 的 facts 只来自父代理在跟踪文件中拥有的 completed tasks、当前进程已知的 blocked tasks 与当前工作区安全扫描；不得因文件碰巧存在而推断 task/phase 完成。
    静态 closure 必须继续为 `{ executable: true, diagnostics: [] }`；completed producer 的全部 outputs 必须实际为安全普通文件。
    任一不一致都是 `delivery-invalid` stage blocker，不得调用方另算 missing inputs。
    package script 的 package manager、名称与完整 command 必须和当前 consumer `package.json` 一致；本地 executable 必须受 `node_modules` 约束；`npx` 只能用 `noInstall: true` 并编译为 `--no-install`，不允许下载。
    `vitest` 才注入 JSON reporter、应用 `minTests` 并解析 assertion Red identity；`package-script`/`static-check` 不附加 Vitest 参数，只使用退出码和批准的稳定输出 identity。
    parent-only AGENTS checkpoint 可使用合法的 Node/static contract。
    不支持的 shape 是 `design-readiness/verification-contract-unsupported` stage blocker；缺失 script 是 `verification-adapter/script-missing`，其他缺失/漂移能力使用精确 adapter code；只有 Bubblewrap、Bun 解析、依赖路径或 sandbox runtime 不可用才使用 environment code。
12. 在任何写入前运行并记录每个未完成任务的目标命令、全部 affected-suite 命令与完整套件基线：命令、退出码、归一化失败标识/原因。
    尚未加入 Red 验证时，目标命令可记录为契约规定的预期状态；既有失败与目标 Red 严格分离，既有失败绝不算 Red。
13. 可信交付无效时，在注册任务前输出 stage-level blocker；不得伪装成 task outcome。
    boundary 外的新路径、依赖、行为、策略、架构、冲突、资源、verification 或 AGENTS 需求使当前任务以 typed `approval-boundary` failure 终止。
    工具、依赖路径、命令或沙箱不可用使当前任务以 typed environment failure 终止；可机械修复的产物仅使用 phase 的有界 correction budget。

**工具路由**：父代理只负责可信交付校验、执行图调度、子代理派发、统一 diff 审查与机械应用、验证决策、Gate/AGENTS/任务状态所有权，不直接编写测试、实现或局部重构。
任务的 Red、Green、Refactor 内容统一由任务 worker 子代理生成；E2E 任务使用 `/dev-browser`。

## 执行图与并行调度（父代理专有）

1. 以 receipt-bound `ImplementGraphBoundary` 为唯一执行图；校验 hash 后先调用一次 `admit-graph`，不得另建 stage graph 或逐任务重述完整 boundary。
   从 graph tasks 的 `dependsOn` 计算 DAG，拒绝未知任务、自依赖和环。
   非任务前置条件通过契约检查后，且所有前置任务均已由父代理验收并推进状态，任务才进入 ready 集合。
2. 规范化每个计划写集、冲突集和资源锁；写集覆盖测试、fixture、快照与生成输出。
   拒绝绝对路径、`..`、符号链接逃逸和不可判定的宽泛 glob。
   Gate receipt、OpenSpec 跟踪文件和 `AGENTS.md` 不属于子代理写集，只能由父代理按契约写入。
3. 父代理从 ready 集合计算受可用并发槽约束的批次；仅计划写集两两不相交、无冲突边且共享/验证资源锁兼容的任务可同批。
   相同路径、祖先/后代目录、共同生成输出或互斥资源均串行；Design 的建议波次只供核对，不替代重新计算。
4. 每个 ready task 的首次 Red `task-attempt` 由 Runtime 从已 admitted graph 打开一个 immutable TaskRecord；后续 Green、Refactor、artifact correction 或 stale refresh 仍只提交 `task-attempt` 的 change/task/request/phase identity 与 fresh snapshot。
   每个 ready 任务绑定一个任务局部 worker，并在同一 worker 上通过后续派发连续完成 Red、Green、Refactor，避免把全局上下文复制给 worker。
   首次派发只提供相关 AGENTS 内容、任务契约、允许读取/改动范围、可信基线标识与当前阶段；worker 不得广泛探索。
5. 同批 worker 并行生成当前阶段的统一 diff 和说明，不得写入任何工作树。
   父代理按跟踪文件顺序校验基线、实际路径、契约与 diff，再机械应用合格 diff；父代理不得自行补写或修正实现。
   每次应用后由父代理运行契约命令，并把命令、退出码和归一化结果回传原 worker，作为进入下一阶段或生成修正 diff 的唯一事实。
6. diff 冲突、越界、写集扩张或验证失败时只终止当前任务；已独立验收的同批任务可保留，外层 DAG 的其余调度仍由父代理决定。
   机械重派只可在不改变行为、架构、依赖和固定 boundary 时基于最新 snapshot 进行。
   普通实现或测试失败不得由自然语言推测为契约变化。
   禁止无界重试。
7. 一批任务稳定后，父代理逐任务完成 AGENTS 检查点和状态推进，再重新计算 ready 集合；任何后继不得提前调度。
   循环直至 DAG 全部完成。
8. 当前 phase candidate 在隔离 checkout apply 后、verification 前必须满足该 phase 的全部 output postconditions；main workspace apply 后、phase progression 前再次检查。
   跨任务 output 仅在 producer 整个 task completed 后发布；producer blocked/failed 时 consumer 保持 `dependency-blocked` 且不启动 child，producer completed 但 output 缺失或 unsafe 时返回 `producer-output-unavailable`。

## 每个任务的委派式 TDD 循环

worker 消费任务契约的普通缩进符号列表（绝非 Markdown 复选框）：前置条件、直接依赖、派发上下文、计划写集、冲突/资源锁、验证类型、Red 命令/预期失败原因、Green 预期行为、受影响套件命令、目标范围和 AGENTS 影响。

1. **🔴 Red（worker → 父代理）**：worker 只用契约规定的验证类型与范围生成失败验证 diff；父代理审查并应用后运行 Red 命令，必须因契约描述的目标缺陷失败。
   加载/导入失败、未运行目标测试或失败身份与批准身份不同时，将结果分类为生成的实现产物拒绝并进入有界修正路径。
   若 Red 候选意外通过，记录 `{ kind: "artifact", code: "red-not-witnessed" }`；Runtime 返回有界 `{ kind: "retry", scope: "worker", cause: "artifact", remainingAttempts: 1 }`，因为候选通过本身不证明设计有缺陷。
   已证明批准命令无法见证行为且必须改变行为、策略、依赖、架构、范围、写集或验证契约时，以 `verification-contract-insufficient` 终止当前任务，不消耗产物修正预算。
   非行为变更任务以指定的失败静态验证起步；仅人工任务不具备可执行合同并阻塞。
2. **🟢 Green（worker → 父代理）**：同一 worker 基于已确认的 Red 证据生成最小实现 diff；父代理审查并应用后运行目标验证。
   失败证据回传 worker，仅允许在声明写集和已批准行为内生成修正 diff。
3. **🔵 Refactor（worker → 父代理）**：同一 worker 仅在声明范围内生成消除重复、改进命名/结构/可读性的可选 diff；父代理每次应用后跑目标验证，重构后跑 affected suite；失败则仅撤销该次重构 diff。
4. **交付验收（父代理）**：拒绝基线不符、越界文件、Gate/索引/跟踪文件修改、验证证据缺失或未批准行为；父代理只做契约判断、机械应用与验证，不直接修码。
5. **AGENTS 检查点（父代理）**：审查完整任务 diff，机械比较 `agentsImpact`、`agentsTarget`、`agentsManagedOnly: true` 与实际影响。
   - `none` → 记录未写 AGENTS 的证据；`update-existing | create-index | remove-index` → 父代理在稳定任务检查点按批准目标完成托管区块操作。
     子代理 diff 中出现 AGENTS 路径一律是写集越界。
   - 实际 diff 暴露未批准生产行为/架构，或必须改变 AGENTS/任务契约时，以匹配的 `approval-boundary` code 终止当前任务；正常已批准 checkpoint 继续执行。
   - 校验已索引的路径/命令/根到嵌套路由、marker 唯一性与人工内容不变；运行该任务的 AGENTS 验证命令。
6. 父代理重跑目标与受影响验证；全绿后，仅在 schema `apply.tracks` 解析出的具体跟踪文件中更新匹配的那个任务复选框；零个/多个匹配 → stage-level blocker。

## 当前任务的 typed blocker（闭合）

Runtime 只报告当前任务事实，不选择用户恢复动作，也不控制外层 DAG。
闭合失败类如下：

- malformed diff、syntax/import/load、no-test/错误命令、wrong Red identity、重复/无效提交或 Red 候选意外通过：`{ kind: "artifact", code: <closed-artifact-code> }`，其中意外通过使用 `red-not-witnessed`；首次可在共享两次 launch 内修正，耗尽为 `attempts-exhausted`。
- stale snapshot 使用 `{ kind: "stale", code: <closed-stale-code> }`；可机械重派的 transport failure 使用 `{ kind: "transport", code: "transport-failure" }`；首次可在共享两次 launch 内刷新或同调用重派，耗尽为 `attempts-exhausted`。
- artifact、stale 或 transport 耗尽必须返回 `{ kind: "attempts-exhausted", cause, attemptsUsed: 2, lastFailure: { code, stage, details? } }`。
  `lastFailure` 保留最终具体 closed code 与 `child-session-create | child-provider-stream | child-timeout | child-finalization | structural-submit | candidate-retention | candidate-diff | candidate-preflight | parent-review | candidate-apply | agents-checkpoint | phase-runtime` stage。
  安全 details 只允许 final submit category、有界 submit attempts、schema state、request/role/task/phase 中不匹配的维度名和受约束 verification id；不得返回 prompt、diff、模型原始输出、excerpt、consumer 内容、command/argv、endpoint、credential、环境值或 identity 实际值。
- Bubblewrap、依赖路径、测试沙箱或外部环境不可用：`{ kind: "environment", code: <closed-environment-code> }`，当前任务 terminal blocked。
- 缺失/漂移的已批准 script、runner、本地 executable 或 verification input：`{ kind: "verification-adapter", code: <closed-adapter-code> }`；`script-missing` 不得误报为 `bubblewrap-or-dependency-unavailable`。
- 新路径、依赖、行为、策略、架构、冲突、资源、verification 或 AGENTS 合同：对应 closed `approval-boundary` code，当前任务 terminal blocked，不扩大 boundary。
- result size 超限：`{ kind: "result-limit", limitBytes }`，当前任务 terminal blocked，不接受 partial diff。

可信 delivery 的 receipt/hash/trace/strict/graph closure failure 发生在 `admit-graph` 前并成为 `delivery-invalid` stage blocker，不是 TaskFailure。
预期 Red 失败、artifact defect、stale snapshot、环境失败、已批准 AGENTS checkpoint、已批准文档/测试和 boundary 内兼容修复均不产生阶段选择。
重试预算始终有限。

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
If a Red candidate passes, classify it as an artifact failure with `code: red-not-witnessed`; a separately proven insufficient verification contract terminally blocks the current task without consuming the artifact correction budget.
After Green the target and affected suite must be green, in Red-Green-Refactor order, with a stable AGENTS index at checkpoints and no new failure relative to the recorded baseline.
A fresh-context handoff validates the Gate receipt, hash, and trace strictly without requesting Gate approval again.
You must not archive, publish, or commit implicitly: only explicit parent actions may do so.
