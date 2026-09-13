# @abelxiaoxing/cadence

[![npm](https://img.shields.io/npm/v/@abelxiaoxing/cadence)](https://www.npmjs.com/package/@abelxiaoxing/cadence)
[![GitHub](https://img.shields.io/github/license/abelxiaoxing/cadence)](https://github.com/abelxiaoxing/cadence)

## 先看这里：适用范围与最短路径

适合需要明确验收、跨任务验证和断点恢复的修改；普通的小修小补可以直接使用 Pi，不必启用完整工作流。
只有你显式输入阶段命令才会进入 Abel。

1. 安装 Node.js >=22.13、Git、Pi，以及 `@fission-ai/openspec@1.5.0`。
2. 在 Pi 中安装：`pi install npm:@abelxiaoxing/cadence`。
3. 默认 Implement 需要可用的 Linux Bubblewrap；Windows 请使用 WSL。
4. 首次进入项目先运行 `/abel-init`，然后 `/abel-design <需求>`，确认集中呈现的目标与方案，设计完成后运行 `/abel-implement <change>`。
5. 暂停时先查看原因和建议，不要靠反复 resume 或重启“碰运气”；未完成的工作会保留。

### 先检查环境，不先花模型调用

在 Cadence 开发仓库中可用：

```sh
bun run doctor /absolute/path/to/consumer
bun run runs /absolute/path/to/consumer
```

安装包也包含预构建的纯 JavaScript 命令，无需在 node_modules 下加载 TypeScript：

```sh
node /absolute/path/to/cadence/src/operator-cli.mjs doctor /path/to/consumer
node /absolute/path/to/cadence/src/operator-cli.mjs runs /path/to/consumer
```

`doctor` 检查 Git、Node、OpenSpec 入口、实际 Bubblewrap 启动、请求预算和常用脚本静态能力；不调用模型、不执行产品测试、不保证所有集成服务均可用。
包管理器优先采用 `package.json.packageManager`，其次推断唯一锁文件所属的管理器；没有声明和锁文件时明确标为 npm 默认值。
输出包含 `selectedPackageManager`、`selectionSource`、`lockfiles` 和 `ambiguousLockfiles`；多个管理器锁文件且无明确声明时阻塞脚本探测，不静默选择 Bun。
Doctor 不读取私有计划，计划中的显式 runner 仍由正式预检检查；请让项目声明与计划保持一致。
`runs` 只读列出该项目最多 1,000 个 run 和有界存储占用；不会创建、迁移或删除数据库，不自动清理暂停任务。

### 可信本地项目：显式复用宿主环境

默认 `isolated` 不变。
对于自己信任的 Linux 项目，可在启动 Pi **之前**选择：

```sh
export ABEL_EXECUTION_MODE=local-trusted
export ABEL_VERIFICATION_ENV=DATABASE_URL,NODE_ENV
export ABEL_VERIFICATION_TIMEOUT_MS=900000
```

可信模式仍在独立候选目录执行，并复制依赖以避免普通缓存写入修改 consumer 的依赖，但**不是沙箱**：测试可访问宿主文件、网络及显式继承的环境变量，产生的外部副作用不能回滚。
HOME、临时目录和报告仍独立；PATH 复用宿主，仓库内 workspace 链接映射到候选代码。
该模式仍要求 Linux Bubblewrap 的 PID namespace 管理后代进程（包括 detached 后代），但不隔离宿主文件和网络；缺少该能力时暂停，不回退到普通进程组。
原生 macOS/Windows 不提供此执行模式，Windows 可使用 WSL。
依赖副本准备、替换与清理在 I/O Worker 中执行，复制支持取消并等待线程退出；大型依赖复制仍有额外成本；需要安装新依赖、宿主浏览器缓存或服务启动编排时仍需配置/准备，不会自动下载。

可选宿主参数还包括 `ABEL_BWRAP_PATH`、`ABEL_FIRST_PROGRESS_MS` 和 `ABEL_STREAM_IDLE_MS`。
后两者单位为毫秒，默认 90,000 / 180,000，允许 1..1,200,000；验证超时默认 600,000，允许 1..86,400,000。
执行配置和显式环境值的摘要参与验证环境身份，改变配置后会重新验证，不把旧证据当作新环境下的成功。

### 小任务、失败排查与真实评估

- 单任务可采用 [精简作者示例](config/plan-draft.quick.example.json)：只填写一个 `singleTask`，代码生成重复的任务和验证结构，仍经过完整编译。
  明确的验收、影响证据、AGENTS 影响、Red 写入及失败标记仍由作者提供；不代替 Gate A，不支持用简写偷偷增加依赖、删除文件或多任务产物。
- 验证失败返回分离的 stdout/stderr、断言摘要和下一步提示；当前操作的后续 Worker 直接收到这些有界诊断，避免仅凭哈希猜测修复。
  摘要是待解释证据，不是指令或授权；不持久化全文，进程重启后由复验重新采集。
- 非 Vitest 通用命令没有可靠断言级报告时，不再仅凭日志相同认定为旧失败；已有失败基线的归因不明会暂停，不误报通过或自动改无关代码。
- 认证失败暂停修复配置，上下文超限要求拆分，429 保留限流分类；上下文在请求前按模型窗口保守预留输出空间，不静默截断证据。
- `bun run benchmark:verification 10000` 测量依赖扫描；只合并 I/O 尚未开始的同批扫描，验证后的检查不会加入更早的在途扫描；已完成证据不作为下一次 currentness 缓存。
- `bun run eval:matrix` 只做预检；`--live --repeats 3 --model provider/model --output report.json` 才显式调用模型，报告真实完成率、耗时、token、费用及重复修订。
  默认门禁只运行三个具有产品 oracle 的场景；`--include-observations` 可额外收集缺能力场景，该场景不改变门禁结果，也不被宣称为恢复验收成功。
  CI 将缺能力观察放入独立的非门禁 job。
  发布前可手动触发 `Live workflow evaluation`，需要带 `cadence-evaluation` 标签、已配置模型和依赖的 Linux 自托管 runner；普通 CI 不隐式消费模型额度。

## 工作流与执行合同

**Cadence** 是一个面向 Pi 的规范驱动四阶段工作流扩展包，内置可恢复的私有代理编排：

- `/abel-init [project-path]` — 本地、固定顺序且幂等地初始化或安全修复 OpenSpec 与 AGENTS 托管索引，不派发子代理。
- `/abel-design <requirement> | --change <change_name>` — 使用有界只读证据包解决行为与技术决策，生成绑定 Gate A 用户授权与 Gate B 系统计划证明的 canonical delivery；不启动实现 Worker，不运行产品测试，也不修改产品代码。
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
Design 同任务续轮重新收紧允许的工具集合，预检失败或暂停不自动退出；会话重载/恢复不继承阶段激活权限，需重新显式调用对应命令，已保存的 run 不会因此完成或丢弃。

Implement 只暴露 `start`、`status`、`resume`、`rebind`、`cancel` 和 `discard` 控制命令。
`status` 完全本地可用；相同 operation id 幂等重放，进程、会话或 Worker 更换后仍从 durable checkpoint 继续。
Design 从第一步起统一使用 `action: "design"`：新需求通过 `start(requirement)` 进入，已有 change 通过 `start(change)` 进入，后续只携带返回的 `runId`。
需求、决策合同与 Gate A 合同由控制面规范化并计算哈希，调用方无需 SHA-256 工具；Gate B 自动绑定当前已编译 canonical plan，原始瞬时文本不会写入 durable journal。
`validate-plan-draft` 可在 `compile-plan` 前只读运行同一套编译检查，并以结构化 `taskId` / phase / field / verification 诊断定位问题；Design finalization 的安全诊断码也会进入错误详情与可展开 TUI，而不再只显示统一失败标题。
随包提供的 [单任务计划示例](config/plan-draft.example.json) 展示精简 PlanDraft 和结构化 Gate A 合同；按实际仓库替换示例中的路径、证据与验证命令。
草稿可省略 `tracking`、阶段 `verificationInputs` 和现有测试的 `disposition`，编译器按任务、验证契约和已声明产物生成这些机械字段；已批准的 `changeContract` 由控制面继承，无需重复填写。
原子验证命令可放在 `verificationDefinitions` 中，用 `{ "use": "name" }` 在各验证义务引用；Red 的 `expectedFailure` 仍需明确填写。
内联原子验证也可省略 `id` / `classification`；任务公共 `read` 与阶段读取合并，固定 baseline/repair 保护字段由编译器补齐，恢复次数和 AGENTS 影响仍需作者明确选择。
[多任务示例](config/plan-draft.multiple-tasks.example.json) 保留显式依赖和产物 producer；ordered steps 仍使用完整内联合同。
`validate-plan-draft` 返回有界的最终权限、验证用途、恢复次数和实际派生来源摘要；摘要不充当批准或封存证明。
编译结果的 `checks` 分开报告 `structure`、`verificationCapability`、`contractCoverage` 和 `sealing`；静态 `closure.executable: true` 不代表产品测试已运行或 `READY_TO_IMPLEMENT`。
独立 `compileImplementPlan` 未传合同则 `contractCoverage: "not-checked"`；传入合同也不证明该合同已获批准。
正式预检从私有 journal 注入当前 Gate A 合同并报告 `gateA: "current"`，但仍是 `sealing: "not-performed"`；只有正式控制面可以批准和封存交付。
验收缺失诊断列出 acceptance ID；仅当验证 ID 唯一对应一个不同义务时返回字段差异，不猜测最接近的验证器，也不回显命令或参数。
`changedSurfaces` 仅接受 `none`、`route-authorization`、`page-state`、`api-response`、`public-html`；公共影响不得改标为 `none` 来绕过闭包。
`verification.change.affected` 是固定标记 `"task-affected-contracts"`，不能使用 `{ "use": "..." }`；`affectedSuite` 中公共影响测试必须在 `relatedTests` 声明证据和实际 owner。
推导有歧义时拒绝编译，显式错误仍会报错；代码不会据此扩大路径、依赖或产物权限，封存计划保持完整、严格的结构。
预检集中返回不同任务的独立结构错误，并提供字段位置、期望/实际路径和修正提示；工具反馈与 TUI 共用有界脱敏投影。
Design status 将可调用的 `legalOperations` 与顶层 `packetActions` 分开；显式退出只能发送 `{"action":"finish"}`，不能伪装成 `operation: "finish"`。

普通 artifact、错误 Red、transport、environment、stale、conflict、baseline 与验证失败都留在同一 Implement run 中恢复。
累计验证发现 introduced failure 时会自动重开责任任务做有界修复。
artifact、stale candidate 与 verification 纠错会将具体失败码、修复策略和可用失败身份传给下一次 Worker。
自动恢复预算以验证义务和阶段为依据，使用独立 SQLite 事实保存；普通 `resume`、重启、回滚、换路由、任务重命名和合同改写都不能重置额度。
执行前持久化预留工作额度；内部修复也计入同一 run 的有限资源预算。
系统保留 baseline 和 phase facts，并明确区分缺少能力、缺少决定与恢复额度耗尽。
Worker 可读取同一任务各阶段已批准路径的并集，并按需申请 sealed roots 内的普通文件读取；新增读取会绑定合并与最终应用的 currentness，写入和删除仍限于当前阶段；超大补丁先自动尝试紧凑的完整提交，不能完整提交时保留进度，绝不接受部分补丁。
Design 对明确需求尽量只进行一轮集中决策：先调查仓库约定，再一起呈现目标、关键技术取舍、推荐默认值及编译授权；编译器在记录有效计划时原子生成 Gate B 证明，无需第二次用户确认。
相同计划重编译和仅修改决策引用不会重开 Gate。
已完成 change 的新修订从同一 root/change 的最新私有 finalized delivery 继承未变化的决策与授权；仅技术变化保留 Gate A，行为契约变化仍重新生成相应证明。
Design 证据包必须绑定 durable `runId`；接受后的有界证据、决策版本、Gate 证明与 canonical plan 身份写入 owner-private journal。
Design 激活期间，父模型只保留进入前已启用的 `read`、`grep`、`find`、`ls` 与 `abel_dispatch`；原工具集合会在 finalize、finish、切换阶段或 session 结束时精确恢复。
Implementation Worker 不再手写 unified-diff header、hunk range、分段或哈希；它一次提交有序的 `replace`、`rewrite`、`create`、`delete` 操作。
可信控制面在隔离 workspace 中校验精确文本、批准路径和 symlink 安全，生成并内部分块 sealed candidate；超限时保留可恢复状态而不接受截断 patch。
OpenSpec change 制品只能通过私有 `write-artifact` / `delete-artifact` 原子操作变更；产品文件、AGENTS、`gate-a.yaml`、`ready.yaml` 和 `implement-plan.json` 对该通道不可达。
Gate A/B 收据只有一套 canonical 结构，并在 Implement admission 时同时对照同一 root/change 的私有批准事实与 finalization revision/hash 事实验证。

只有继续工作确实需要新增行为、架构/策略、依赖、路径、资源、验证或 AGENTS 权限时才进入 `approval-needed`。
Design 完成主要决策后，Implement 中的新实施选择默认由父模型采用推荐方案，记录后继续执行；不再默认向用户追问。
状态一次返回完整 `blockers`、稳定的 `decisionBatch`，并明确由父模型负责执行自动 `continuation`。
父模型通过当前 Implement 内的 `action: "amend"` 修订同一 change、自动生成计划证明，再由普通 resume 发现并验证新交付；无需切换命令、重新确认或手动传递收据。
交付校验失败和任务过大也能进入该修订通道，不必伪装成用户决策。
修订有独立的持久化预算：每个 run 最多 64 次变更尝试，失败也计数，成功操作重放和只读检查不计数。
自动修订保留 Design 目标、明确限制与验收标准；Worker 仍必须等待新计划通过完整校验才能使用新权限。
新证明尚未就绪时，`resume` 只列为条件命令；证明就绪后可直接恢复，由控制层读取版本和哈希。
增量修订或用户主动选择的 Design 完成后，新的 Implement 上下文都能本地发现并校验交付，继续同一 run。

交互式 TUI、print、JSON 和 RPC 都保留 durable semantic state；父模型有自动继续动作时，TUI 显示 recovering，不把内部待编译状态显示成用户待确认，也不提示用户手动 resume。
queued、preparing、waiting-first-response、running、validating、retrying、verifying、paused、approval-needed、applying 和 recovering 都不是完成；operation-cancelled 表示本次操作取消但 run 仍可恢复，discarded 与 rejected 是非成功终态。
只有最终 apply 与 post-apply verification 提交后的 `completed` 才显示成功。
Design finalization、Implement 终态、Diagnose/显式 `finish` 或 session shutdown 会清除 active stage 与私有子执行状态；Design 还会恢复进入前的精确父工具集合，其他阶段只撤下 `abel_dispatch`。
Gate 等待和可恢复暂停保持激活以接收直接后续操作。

私有 journal、artifact 与 change workspace 位于 consumer repository 之外的 owner-private state root。
暂停会保留最小结构化恢复事实；完成或显式 discard 后安全清理。
不会持久化凭据、环境值、原始 prompt、隐藏推理、完整子会话或原始模型输出。

### 公共 UI 的 impactClosure 作者格式

`page-state` 与 `public-html` 可以同时声明。
以下是 **PlanDraft 任务片段**，合并到现有 `tasks[i]`，不是完整计划；其余 Gate A、阶段、产物和验证合同仍按单任务示例填写。
路径和证据仅用于说明，必须替换为仓库真实调查结果。
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

完整规则：

- `impactClosure` 恰好包含 `changedSurfaces`、`searchEvidence`、`relatedTests`、`affectedSuite` 四个字段，不接受任意扩展字段。
- `changedSurfaces` 是非空、无重复的合法枚举数组；`none` 不能与其他值混用。
  不得为了通过校验将公共影响改为 `none`。
- 存在公共影响时，后三个数组均不得为空；`searchEvidence` 每项为非空字符串，记录实际检索及结论，不是路径对象，也不是可省略的推导字段。
- `relatedTests` 每项包含 `path` 和非空字符串 `evidence`；路径无重复，必须是 `test/` 或 `tests/` 下的仓库相对文件路径，并位于本任务各阶段合并后的 read/write 范围。
  `src/foo.test.ts` 不满足当前测试路径规则。
- PlanDraft 可省略 `disposition`：本任务写入则推导为 `current-task`，只有另一任务写入则为 `regression-task` 并推导 `regressionTaskId`，没有任务写入则为 `unaffected`；多个其他写入者时必须消除歧义。
  `unaffected` 表示不修改该测试，不表示不运行该测试。
- 显式作者格式为 `{ "path": "test/page-state.mjs", "disposition": "current-task", "evidence": "实际证据" }`；只读保留用 `unaffected`。
  跨任务格式为 `{ "path": "test/page-state.mjs", "disposition": "regression-task", "evidence": "实际证据", "regressionTaskId": "ui-regression" }`。
  只有 `regression-task` 携带 `regressionTaskId`；依赖、产物和阶段权限仍需按实际计划声明，不会由闭包新增。
- `affectedSuite` 是无重复的测试路径数组，每项必须有对应的 `relatedTests` 条目；具备快照的运行时校验还要求其中至少一个是已有普通测试文件，不能全靠未来新增测试充当已有证据。
- `affectedSuite` 是影响清单，不是验证器。
  显式 `affectedVerification` 应实际运行这些测试，例如 Vitest 的 `testFiles` 列出二者，或使用仓库真实的测试脚本。
  仍需声明验证输入并遵守 Gate A，不能只补清单就宣称测试已运行。

`validate-plan-draft` 对三个空数组分别返回字段级 category：`search-evidence-required`、`related-tests-required`、`affected-suite-required`，并提供代码维护的 `hint`。
测试漏列仍返回 `impactClosure.affectedSuite.<index>` / `related-test-missing` 和具体 `path`。
空数组不足以确定应选哪些测试，因此不会虚构 `expectedPaths`；按实际证据补齐后，在同一个 Design run 重试预检。

## 内部边界与运行验证

扩展入口负责宿主生命周期与服务装配，交付加载和验证适配器分别由独立模块负责。
工作流入口保留原有导出，状态机仍是唯一状态转换权威；执行服务通过类型化接口返回事实。
状态机读取运行与预算事实，独立的 `workflow-status.ts` 纯函数生成状态、阻塞批次及继续动作，不访问存储或启动执行。
普通阶段和修复阶段共用 `candidate-artifact.ts` 校验、封存候选；恢复旧候选仍按当前批准路径检查，调用方分别处理普通越界和修复权限扩展。
测试检查模块依赖无环，以及子会话无法导入主工作区应用和 run 状态权限。

Implement 父模型属于受信任的宿主编排层，保留原有工具以调查和修复已授权的环境问题；产品修改应通过控制面完成。
子 Worker 和控制面执行路径有代码边界；父模型直接使用宿主工具不经过这些路径，阶段指令约束其行为。
只有 Design 会收紧父工具。
结构化验收固定验证义务，目标是否被充分覆盖仍取决于验收测试的质量。

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

本包要求 Node.js `>=22.13.0`，以使用稳定可用的内置 `node:sqlite`；不从参考仓库源安装。
Pi 相关 peer 依赖使用 `*`，不限制宿主 Pi 的版本；开发依赖的固定版本仅用于仓库构建与测试。

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
默认隔离后端仍为 Linux Bubblewrap；Windows/macOS 的原生隔离、ACL 与完整文件应用语义需要单独实现和验收，缺少隔离能力时保持暂停，不降级为主工作区直接执行。
可信 Linux 项目可以显式选择上面的 `local-trusted` 候选目录执行模式。

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
Implement 保留 16,000 context / 8,000 output 的最低容量要求；任务复杂度估算只影响自动选择的优先级，满足最低要求的 route 仍可作为 fallback 或显式 rebind。
transport 与 malformed structural result 都只在声明的 route 集合内做有界 failover；优先选择达到容量估算的 route，同一优先级保持声明顺序，只有一个 route 时会原地重试一次。

子任务由 Cadence 自己维护模型／工具循环，通过 `pi-ai` 公开接口请求完整响应，不创建 Pi `AgentSession`、覆盖 Agent 钩子或扫描宿主事件历史决定终止。
模型流事件只用于进度与完整响应适配；只有正常完整响应的工具调用可以执行，错误、截断或取消不得提交产物。
继承路由快照当前有效 Provider、模型及每次 attempt 新鲜解析的认证，不修改父 Provider 注册表，也不要求父请求预热。
Provider 自身的流式实现和模型配置仍然生效；宿主 session 的 `before_provider_request`／`onPayload` 不会自动移植到子任务。
需要通用请求定制时，应使用明确配置的 Provider 实现或 custom route；子请求使用自己的 `low` reasoning 请求，最终由模型映射解释。
输出上限沿用声明的模型／Provider 合同，不再隐式删除 Responses 的 `max_output_tokens`。

子 Agent 的 evidence 提交使用精简草稿：工具绑定省略的身份，补齐未提供的提示性字段，然后按严格内部结果合同校验。
引用、约束、风险和未决问题仍须显式提供；省略提示不等于已验证的“没有影响”，也不增加授权。
一次被拒绝的提交可在原会话纠正一次；只有正常以文字结束且从未提交时，才额外提示补交一次。
补交沿用原工具权限、总时限、取消和用量统计，不重新调查，不把文字直接当作交付；传输错误、截断和取消不触发补交。
合法提交可附带简短文字，但接受后不得重复提交或覆盖结果。

相同 pause 的安全指纹与重复计数通过 `status` 暴露，凭据、URL 和原始输出仍保持私有。
`rebind` 只能选择已获 policy 授权且能力匹配的 route，不会扩大任务边界。

验证归因使用完整失败集合；大基线以哈希校验的私有 artifact 持久化，Worker 和状态只接收最多 256 条失败摘要。
非 Vitest 失败身份由执行入口、参数和失败证据决定，不受合同显示 ID 影响；身份用于诊断聚类，但不单独证明两个失败属于同一断言。

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

## 验证执行环境与明确恢复

验证使用独立 HOME、Vite 缓存和报告目录；隔离模式挂载只读 consumer 依赖，可信模式使用候选依赖副本。
Vitest 的 JSON 报告与普通 stdout/stderr 分离，日志超过捕获预算只截取头尾，不终止正常测试。
报告缺失、损坏或超限属于验证不可用，不作为产品失败基线或自动改代码的理由。
已封存候选在环境故障后可重新验证，并在存储重开后复用；即使自动生成次数已耗尽，普通 resume 仍可只复验该候选，不启动新的补丁生成。
非 Vitest 的 Red 证据通过有界流式匹配保留，不受日志头尾截取影响。
完整的已批准 package-script 可包含组合命令、引号和嵌套脚本；包管理器在隔离环境中解释，manifest、lockfile 和项目配置绑定 currentness。
配置注释和普通值不触发禁用词检查；隔离模式中的有效凭据或宿主执行配置仍被拒绝；可信模式允许操作者显式配置。
计划已授权的 manifest/配置写入可在隔离候选中验证；未授权路径仍需匹配设计时哈希，实际入口脚本仍必须与批准命令相同，执行期间的输入漂移仍会使验证失效。
专门的 Vitest 合同仍拥有 JSON reporter、测试数量及 Red 身份检查，复合脚本不会自动获得断言级语义。

自动纠错耗尽后，普通 resume、rebind 和重启不充值。
父代理可使用 status 返回的 `recovery.additionalAttempt`，作为 resume 的 `recovery` 字段明确追加一次尝试；失败后再次暂停，历史消耗保持。
累计工作额度按成功接纳过的最大阶段数增长，任务重命名、重复编译及缩小后恢复原规模不增加额度。
宿主可在启动前设置 `ABEL_WORK_MAX_UNITS`（默认 512）和 `ABEL_VERIFICATION_MAX_REPORT_BYTES`（默认 67108864）；Worker 不能调整这些资源设置。
前者在 run 中固定，后者用于每次独立报告的有界读取。

## 结构化授权与验证模式

新 Design 的 Gate A 使用 `ChangeContract`：目标、稳定验收 ID 与验证义务、明确限制，以及允许的写入范围、依赖和验证模式。
控制面保存规范化的非敏感权威值并注入计划；重排任务不能删除验收或扩大政策。
自动 amendment 保留 Gate A，不能改写已接受的 proposal/spec 或行为决定。
旧文本授权继续可读，其修订保留原有验证义务与保守范围。

任务默认 `verificationMode: "behavior"`，继续执行 Red/Green。
明确授权的 `mechanical` 和 `refactor` 模式采用基线与后置验证，从 Green 开始，不生成 Red 候选。
机械修改限于文档、数据与配置文件；重构不能改写已接受的验证入口；声明公共行为变化时仍需 Red。
全部模式保留累计验证与事务应用。

验证证据现在绑定安装后的依赖内容、runner 和适配器政策。
依赖身份采集在可取消 I/O 线程中执行；工具缓存不参与身份。
环境漂移会暂停验证，恢复后重建基线并重验保留阶段。

## 真实模型工作流评估

开发仓库提供独立评估入口，消费项目和 Git 历史均在临时目录创建，结束后清理。
默认只验证真实 Pi 的包来源与命令激活，不调用模型：

```sh
bun run eval:workflow
bun run eval:workflow --live --scenario small-fix --output /tmp/cadence-evaluation.json --progress-output /tmp/cadence-progress.json
bun run eval:workflow --live --scenario multiple-tasks
bun run eval:workflow --live --scenario restart-recovery
bun run eval:workflow --live --scenario missing-capability
```

`--live` 使用 Pi 当前配置的模型，也可传 `--model provider/model`；需要可用的 Provider、OpenSpec 和 Linux Bubblewrap。
报告记录完成状态、用户介入、重复修订、耗时及宿主报告的 token/成本；最终行为另由隔离 oracle 检查。
`trace` 提供有界的工具/操作计数、安全错误分类、阶段里程碑、重复提交、工具活动区间并集和消息 usage；截止时冻结快照，未到达的里程碑为 null。
非工具时间不是纯模型计算时间。
`configurations` 记录实际模型、reasoning 和非秘密路由指纹，`sourceSha256` / `sourceUnchanged` 标识工作树版本和运行期间是否变化。
可选 `--progress-output` 每 15 秒写一份有界进度快照；无原始参数、提示或响应正文。
源码读取统计只覆盖明确的成功 read，未分类访问不能当作零。
`modelFailureDiagnostics` 最多保留 16 条脱敏错误分类及可从 SDK 错误文字识别的 HTTP 状态；无法识别时明确记录 `unclassified` / `null`。
`autoRetries` 与 `retryDelayMs` 单独记录宿主自动重试次数和计划退避时间，避免把同一请求的多次失败误读为独立故障。
模型服务不可用、阶段停滞、取消与 Design 完成都不会被计为 Implement 成功。
缺少能力的场景用于观察保留状态，不能把任意停滞当作正确恢复。
无原始对话落盘。

## 内部架构与请求预算

`PlanDraft` 只表示作者输入，`ImplementPlan` 独立定义完整执行合同；命名引用和默认值仅在编译入口展开，旧封存计划不被重写。
PlanDraft 的命名或内联 package-script 可以省略 `command`，编译器从 manifest 绑定脚本原文后生成身份；显式不匹配仍拒绝，Gate A 的完整验证合同不被替换。
作者在 `tasks.md` 保留任务 checkbox、目标和精确 Scenario 归属；`compile-plan` 生成独立的验证 ID 绑定区域，保留作者正文，并在两份文件安装成功后记录编译。
旧封存交付仍可读取；缺失作者证据或篡改绑定不能通过追溯检查。
`workflow-state-machine` 继续独占 run/task 状态转换与预算事务；调度、恢复策略和交付差异比较使用只接受事实的内部函数。
`durable-workflow` 管理资源生命周期和交付重放，`phase-execution` 执行候选阶段，`change-verification` 管理基线及变更验证；阶段服务没有主工作区 apply 能力。
Pi 入口负责激活、工具交互、模型能力投影和展示；`package-workflow` 组合控制服务，`package-candidate` 执行受限候选请求，核心不接收 Pi 会话事件或完整宿主上下文。

每次模型请求独立计时，默认 90 秒内没有非空文本、思考或工具参数增量时返回 `first-progress-timeout`；已有进展后空闲 180 秒返回 `stream-idle-timeout`。
HTTP 响应头用于观察，不刷新进展预算；完整终态可直接结束请求，本地工具执行间隙不计入流空闲，下一轮重新计时。
Broker 保留每 attempt 20 分钟总上限和原有有限重试；该上限不代表跨重试的 workflow 总时限。
新请求不再发出 `connect-timeout`，也不声称观测到了 TCP/TLS 建连；旧超时事实和 `connecting` 展示仍可读取。
子执行器限制为 64 轮，序列化上下文取 4 MiB 与模型窗口保守预算中的较小值，不自动压缩或静默截断证据；达到限制返回执行限制失败，候选任务暂停并要求拆分，不作为端点故障重试。
取消后的用量结算最多等待 250 ms，迟到结果不能进入候选提交或主工作区应用。
