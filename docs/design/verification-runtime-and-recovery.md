# 验证运行时与恢复策略改进方案

状态：已实施并通过本地验收。
范围：本轮仓库 review 的全部五项 P1/P2 问题；覆盖隔离环境、报告协议、恢复预算、输出限制和 package script 兼容性。
不包含按变更类型取消强制 Red/Green，也不重构 Design 授权模型。
本文为普通工程设计文档，不产生 Gate 收据，不代表已批准的 Implement delivery。

## 1. 目标与设计决策

正常项目应能直接使用现有验证入口；启动故障、报告故障和产品断言失败应有不同的恢复方式。
保护主工作区和宿主依赖，同时给工具提供独立的 HOME、缓存和报告目录。
自动纠错耗尽时保留暂停；父代理作出明确恢复决定后，可以在累计预算内追加一次尝试。
所有执行仍由现有状态机记账，不能通过重命名、重启、换路由或改写说明清空历史。

采用以下五个决定：

1. 每次验证创建短生命周期的执行环境，工具缓存与依赖内容分开挂载。
2. Vitest 使用独立 JSON 报告文件；stdout/stderr 仅是诊断日志。
3. 验证只返回事实，状态机统一决定暂停、修复和继续。
4. 保留一个自动纠错计数和一个累计工作预算；显式追加尝试不重置任何计数。
5. 已批准的 package script 作为完整仓库程序执行，交给对应包管理器解释；Cadence 不实现 shell 解析器。

不增加插件体系、通用环境安装器、新调度服务或独立恢复状态机。
已有 apply 事务、路径 currentness、私有存储、Worker 写入边界和取消清理机制继续承担原有职责。

## 2. 问题与方案对应

| Review 问题               | 根因                                         | 方案                                       | 验收结果                            |
| ------------------------- | -------------------------------------------- | ------------------------------------------ | ----------------------------------- |
| P1：npm / Vitest 启动失败 | 清空环境后没有 HOME；依赖目录内缓存不可写    | 私有执行目录、只读依赖视图、独立可写缓存   | 普通 npm + Vitest 配置项目可运行    |
| P1：日志导致测试误判      | 将全部 stdout 当作 JSON 协议                 | 独立报告文件、严格报告校验                 | 输出普通日志不改变验证结果          |
| P2：条件修正后不能重试    | 自动重试耗尽等同永久禁止；预算绑定初始任务数 | 明确追加一次尝试；按已接纳计划规模扩大额度 | 保留原 run 和历史，合理拆分后可继续 |
| P2：大型测试触发输出限制  | 日志与结构化报告共享 1 MiB 限制              | 日志有界截取、报告单独限额                 | 8,000 个简单测试可完成              |
| P2：已有脚本被拒绝        | 将完整脚本文本当作无 shell 的单个参数验证    | 封存脚本输入，由包管理器原样执行           | check / lint / verify 不需人工展开  |

## 3. 执行路径和模块职责

```mermaid
flowchart LR
    A[已批准的验证合同] --> B[能力检查与输入绑定]
    B --> C[准备隔离执行环境]
    C --> D[包管理器或本地 runner]
    D --> E[报告文件与有界日志]
    E --> F[结构化验证事实]
    F --> G[现有工作流状态机]
    G --> H[继续、暂停或申请一次追加尝试]
```

`verification-capability.ts` 继续负责可执行程序解析、脚本及配置绑定、合同 currentness。
`package-verification.ts` 负责运行参数、工具适配、报告解码和事实归一化。
`isolation-backend.ts` 只负责进程、挂载、取消、超时和日志捕获，不理解 Gate、任务、预算或断言。
`workflow-state-machine.ts` 继续是唯一转换及工作预留权威。
`durable-workflow.ts` 负责复用候选、阶段事实和累计验证，不重复实现预算策略。

执行环境准备代码可提取到一个 `verification-environment.ts`，把挂载与清理从报告解析中移出。
该模块只接受父控制面生成的能力配置，不允许 Worker 指定任意宿主挂载路径。
除这个有独立生命周期的模块外，优先修改现有模块，避免为了分层再增加泛化接口。

## 4. 隔离环境：允许工具正常工作

### 4.1 每次验证的私有目录

在现有 repository-external 私有运行目录下创建本次验证的临时根，挂载为 `/cadence`。
配置以下固定沙箱路径，不继承宿主 HOME 或宿主缓存：

```text
/workspace                       一次性验证工作区
/workspace/node_modules          只读依赖视图
/workspace/node_modules/.vite    本次执行独立缓存
/workspace/node_modules/.vite-temp 本次执行配置编译缓存
/cadence/home                    HOME
/cadence/cache                   XDG_CACHE_HOME
/cadence/tmp                     TMPDIR
/cadence/reports                 结构化报告
```

保留 `CI=1`，按工具配置 npm 缓存等必要环境变量，值只能指向沙箱私有目录。
显式提供 HOME 可避免 npm 因没有宿主用户数据库而无法定位目录。
保留无网络、无宿主凭据、宿主依赖只读和后代进程取消语义。
超时、失败、取消和正常退出均先等待进程及后代结束，再清理临时目录。
临时目录归属于既有 run 私有资源根，随 run 资源清理回收；缓存不成为可恢复业务事实。

### 4.2 依赖视图与工具缓存

不能简单先只读挂载整个 `node_modules`，再假设能在其中创建不存在的缓存挂载点。
采用浅层目录骨架：在私有临时目录建立顶层依赖挂载点和 `.vite`、`.vite-temp` 占位目录，再挂载整个骨架为只读根。
将实际顶层依赖目录及文件逐项只读绑定到相应位置，最后将两个缓存目录绑定到本次执行的可写目录。
相对符号链接保留已有安全解析约束；不能借此扩大到依赖根之外。
骨架仅包含挂载点和必要链接，不复制整棵依赖内容，不修改 consumer 的 `node_modules`。
即使宿主中已有这两个缓存，也使用新的独立缓存，避免沿用宿主临时编译产物。

优先覆盖已经支持的单个 dependency owner；npm、pnpm、Yarn、Bun 的现有安装布局需要分别验证。
Yarn PnP、任意 monorepo 依赖根发现和自定义缓存目录不在此改动中新增支持。
工具要求其他不可写目录时，报告具体环境能力缺失，再通过受控工具配置扩展；不能自动扩大为整棵依赖可写。
保留用户的 Vite config loader，不强制 native loader，以免破坏已有 TypeScript 配置和加载语义。

## 5. 报告协议与错误分类

### 5.1 Vitest 报告独立输出

Vitest 适配器注入 JSON reporter 和指向 `/cadence/reports` 的独立 `outputFile.json`。
报告目录在每次执行前为空，文件名由父控制面生成；有序 steps 的不同步骤使用不同报告文件。
配置中的普通 reporter 可保留，但不能覆盖本次机器报告的输出目标。
合同中与适配器保留参数冲突的 reporter/outputFile 参数，在 preflight 给出明确诊断；不允许用参数排列决定谁覆盖谁。

执行结束且子进程完全停止后，以组件级无 symlink 检查和有界读取打开本次报告。
同时检查进程退出状态、报告结构、测试总数、失败身份、未处理运行时错误和 `minTests`。
Green 不能仅凭 exit 0 通过，Red 不能仅凭非零退出或任意日志匹配通过。
报告缺失、截断、路径不安全、格式错误或与退出结果冲突，均不是成功证据。
不从混有日志的 stdout 中猜测 JSON 起点，也不接受上一次执行的残留报告。

### 5.2 统一结果类型

在 `contracts.ts` 定义父侧验证事实类型，phase 与 cumulative verification 使用同一语义；`index.ts` 不再维护另一份错误码猜测表。
以下为目标类型示意，具体失败码继续使用闭合集合：

```ts
type VerificationObservation =
  | { kind: "accepted"; evidence: VerificationEvidence }
  | { kind: "rejected"; evidence: VerificationEvidence }
  | {
      kind: "unavailable";
      category: "environment" | "adapter" | "resource";
      diagnostic: VerificationDiagnostic;
    }
  | { kind: "cancelled" };
```

`VerificationEvidence` 包含 step、退出码、实际测试统计和稳定失败身份。
`rejected` 表示已获得能够评价当前验证义务的有效证据，包括真正断言失败和没有见证预期 Red。
`unavailable` 表示尚未获得足够证据；不得写入 pre-existing / introduced 基线，也不得触发产品修复。

| 事实                           | 状态机处理             | 自动产品纠错计数             |
| ------------------------------ | ---------------------- | ---------------------------- |
| 有效报告满足当前阶段           | 提交当前验证事实       | 不增加                       |
| 有效报告出现断言失败或错误 Red | 按现有归因规则修复     | 增加                         |
| HOME、缓存或 runner 能力缺失   | 暂停，修复执行环境     | 不增加                       |
| 报告缺失、解析失败或协议冲突   | 暂停，修复适配器       | 不增加                       |
| 报告超限或执行超时             | 暂停，调整受控资源配置 | 不增加                       |
| 用户取消                       | 保留可恢复进度         | 不增加，不退还已经发生的工作 |

Vitest 的启动/配置错误通过 preflight 和结构化结果识别；无法可靠确定原因时使用 `adapter`，不能仅依据 stderr 关键词宣称产品断言失败。
没有结构化报告的 package-script/static-check 仍使用明确批准的退出码与预期失败合同；已知启动故障优先归为 unavailable，未知失败保留为该脚本的检查结果，不宣称具有断言级精度。
复用已封存候选时重新执行验证，不无故重新调用 Worker；currentness 失效时按已有路径规则重建所需事实。

### 5.3 可行动诊断

诊断至少包含 verificationId、stepId、category、code、exitCode、必要的相对路径或工具版本，以及固定的建议动作。
父代理可获得有界且经过脱敏的断言摘要、环境错误摘要；原始 stdout/stderr 不写入 durable journal。
任意日志内容无法可靠脱敏时只保留结构化诊断，不通过异常消息回传原始宿主路径或环境值。
显示层使用这些事实解释失败，不参与分类和重试决定。

## 6. 日志与报告分别限额

默认每个 stdout/stderr 流保留 256 KiB 的头尾摘要，超过后继续消费并丢弃中间日志，记录总字节数和 `truncated`。
输出超过展示预算不终止测试，捕获内存使用保持有界；绝不积累所有 Buffer 后再截断。
保持原有进程超时和取消机制，持续刷日志的程序也无法无限执行。

报告默认读取上限为 64 MiB，由宿主运行配置在启动前设置，Worker 不可修改。
读取时先检查文件大小，再进行有界读取，限制解析结果的条目和摘要大小；不直接把完整报告传入模型上下文或 durable journal。
验证期间可监测报告增长并在超限时停止执行；这种监测不声称提供瞬时文件系统配额，严格磁盘配额需由部署环境提供。
超过报告上限返回 `resource / verification-report-too-large`，携带安全统计和调整建议，不降级为通过或产品失败。

正常大报告通过文件通道解决，因此默认日志阈值无需随测试数量不断增大。
64 MiB 是初始运行默认值，应以 npm/Bun/pnpm/Yarn 消费项目测试确定实际内存和耗时，不把该数值写入用户验收规范。

## 7. 恢复：停止自动循环，允许明确继续

### 7.1 保持稳定义务身份

保留现有 recoveryKey 的验证义务身份，不把路由、提示词、operationId、taskId 或 workspace lineage 填进去制造新事件。
原有 2–3 次 artifact/stale/verification 自动尝试限制继续有效。
普通 resume、重启、rebind、说明改写和提高 maxAttempts 都不重置已经耗尽的自动计数。

取消独立的 run-wide 24 次 failure/repair 硬暂停，将事件数保留为诊断；全部候选及嵌套修复已经受同一个累计工作预算约束。
原有 repair 局部上限作为自动停止条件，不再形成不能被明确恢复的另一套永久封锁。
amendment 的 64 次控制面变更限额保持原职责，不混入候选执行预算。

### 7.2 明确追加一次尝试

在现有 `resume` 增加可选的父代理恢复意图，不新增控制命令：

```json
{
  "command": "resume",
  "stage": "abel-implement",
  "change": "example",
  "operationId": "new-operation",
  "recovery": {
    "incidentKey": "<status-provided>",
    "failureSequence": 7,
    "reason": "route-changed"
  }
}
```

reason 使用闭合集合：`route-changed`、`context-extended`、`parent-directed-retry`。
前两项绑定控制面观察到的路由或读取能力变化；不能只相信调用方的原因字符串。
没有增加 `environment-restored` 授权原因：环境恢复走保留候选的普通复验路径，无须制造新的 Worker 恢复授权。
最后一项明确表示父代理判断值得再尝试一次，不要求伪造可机检的策略变化；必须记录决定并接受累计预算约束。
这是已批准 Implement 内的执行决定，默认不增加用户确认轮次。

状态机原子检查当前 incident、failureSequence、最新 delivery、租约和可用工作额度，再预留一个工作单位并授予一次启动。
该启动仍经过原有路径、验证、候选和 Gate 边界；它只越过已经耗尽的自动次数门槛。
同一 operationId 重放不重复授权；相同旧 failureSequence、跨任务或过期的请求不能再授予启动。
授予在启动后即已消费；中断或崩溃不重复授予、不退还工作。
一次追加最多调用一次候选生成；需要新的嵌套候选时立即暂停，不误报累计预算耗尽。
这次失败后立即暂停，不重新获得一整轮自动重试次数。

`status` 显示 `automaticRetryExhausted` 与 `workBudgetExhausted`，并提供一次追加尝试所需的当前引用。
可追加并不意味着 automatic continuation：父代理必须作出新决定，不能生成无条件循环调用。
执行环境恢复通常只需对保留候选重新验证，不需要调用 Worker 或申请追加授权。
复验操作仍沿用状态机的保守工作预留规则，占用一个累计工作单位；不减少余额，也不增加产品纠错计数。
若复验本身再次出现同一 unavailable，禁止内部无条件自旋，保留诊断等待真实条件变化。
为资源治理，每次复验仍受进程超时、报告限额和现有运行操作边界约束。

### 7.3 累计预算随已接纳计划规模调整

保留一个累计 `used` 和一个当前 `maxWork`，所有候选和嵌套修复继续在启动前预留。
仅在完整 admission 成功时记录已接纳计划的最大阶段数 `phaseHighWater`：

```text
phaseHighWater = max(previousPhaseHighWater, admittedPlanPhaseCount)
maxWork = min(hardLimit, max(previousMaxWork, 24 + 3 * phaseHighWater))
remaining = maxWork - used
```

`hardLimit` 是该 run 首次执行时从宿主资源策略捕获的绝对上限，建议初始默认 512 个工作单位。
初始大型计划在 preflight 检查额度是否足以覆盖最低所需工作，不等执行到一半再发现必然无法完成。
更大的宿主额度必须在启动 run 前显式配置；普通 amendment、rebind 和恢复请求不能修改 hardLimit。

例如初始一个 Red/Green 任务时 maxWork 为 30；接纳 16 个 Red/Green 任务后 phaseHighWater 为 32，maxWork 为 120，原有 used 保留。
重复接纳同一规模、任务改名、缩小后再放大到历史规模均不增加额度。
持续拆分最多增长到 hardLimit；不会因为加新 revision 而按 used 反复充值。
待执行工作超过剩余额度时给出具体资源诊断，保留已完成事实；不伪装成缺少产品决策。
达到 hardLimit 后诚实停止是预期行为，本方案不承诺无限恢复。

## 8. 已批准 package script 原样执行

### 8.1 分离两种合同

保留 `vitest`、`static-check` 和显式 `steps` 的结构化参数校验；参数、相对输入路径仍按各自类型验证。
对于 `package-script.command`，改为有界、非空、无 NUL 的脚本文本，不使用 argv 的 shell 字符黑名单。
编译器从真实 package.json 读取脚本并绑定，执行时再次确认实际脚本文本与批准值一致。
推荐 PlanDraft 仅输入 packageManager、script、args，由编译器填充现有 canonical command；显式传入 command 的旧草案仍需精确匹配。

实际启动继续使用 `spawn(executable, argv, { shell: false })` 调用包管理器的 `run`。
脚本文本不拼入宿主 shell、不经 Cadence 二次拆词；脚本内部 `&&`、引号、变量和递归 run 由包管理器在沙箱内解释。
因此 `check`、`lint`、`verify` 保留原有短路顺序，不需要把相同逻辑复制到 PlanDraft.steps。

通用 package-script 仍是退出码验证；若需要 Vitest 的 minTests 和 Red 断言身份，继续使用专门的 vitest 合同。
不尝试从任意复合脚本中猜测哪个子命令是目标测试，也不自动将复合脚本提升为断言级证据。

### 8.2 封存实际执行输入

执行 package script 会触发包管理器的 pre/post hooks、嵌套脚本和项目配置，因此仅绑定目标 command 不够。
设计和 admission 绑定完整 package.json、当前支持的 lockfile 及包管理器配置。
隔离执行由父控制面传入已批准计划的配置写入路径，允许这些路径上的候选修改；其余路径仍匹配设计时哈希，入口脚本仍严格匹配批准命令。
运行时对实际候选输入重新取快照，执行过程中发生的漂移仍使验证失效。
不新增任意配置发现：每个包管理器适配器维护与当前支持安装模式对应的输入集合；无法证明执行闭包时在 preflight 给出具体缺失项。
项目配置不得使包管理器加载宿主用户配置、宿主 script-shell 或凭据；冲突需在能力检查说明。
骨架依赖视图保留只读代码和隔离缓存，因此 pre/post hooks 无法修改 consumer 依赖或宿主文件。

Cadence 不执行安装或自动下载来补足能力；已批准脚本中的下载请求仍受无网络沙箱限制。
不依赖 shell 文本扫描证明脚本不会联网，也不声称静态识别任意嵌套程序的行为。
当前禁止 bunx/npm exec 等文本的规则，只从完整的已批准 package-script 通道移除；结构化 npx runner 的 `noInstall` 规则保留。
涉及外部服务的脚本仍可能不可用，这属于既有隔离能力范围，不能通过此兼容性修复暗中开放网络。

## 9. 存储、规范与兼容迁移

### 9.1 持久化修改

在现有预算记录增补 phaseHighWater、hardLimit 和 recoveryPolicy 标记，通过 checked additive migration 原子迁移。
一次追加授权使用独立 checked migration 的 `workflow_recovery_grants` 小表，绑定 run、operation、incident、失败序号、原因和消费标记；消费与原有工作预留在同一事务完成。
不增加可覆盖或清零历史的 reset API，不持久化原始日志、完整报告、宿主环境值或新的私有会话记录。

### 9.2 老 run 与新验证语义

已有 run 的 used 和历史失败保留；phaseHighWater 从已持久化且成功接纳的 delivery 恢复。
迁移时 hardLimit 至少覆盖已存在的 maxWork 和 used，不能因新默认值降低已分配额度；超过新默认值的情况保留 legacy ceiling 并标记。
迁移不自动启动 Worker，也不重新授予已耗尽的自动尝试。
老 run 只有在下一次正常控制操作、完成 admission/currentness 检查后，才可以使用新的显式追加入口。

为运行时验证事实附加内部 adapter policy 标记，不改写已批准 canonical plan 字节或 Gate 哈希。
由旧的 stdout 协议或错误分类产生的验证基线，不能直接冒充新适配器下的有效证据。
保留候选和完成记录，在它们下一次被复用或 final apply 前，用新适配器重验有关基线与阶段事实。
复验失败时暂停，阻止继续复用和 apply；不删除历史事件，也不自动推翻已批准计划。
有效证据被否定时，应修正验证条件或提交修订 delivery，再走既有兼容性和依赖失效规则。
保留的完成事实不得触发 Worker 重做，除非验证或 currentness 证明它已不兼容。

### 9.3 必须同步的规范

本方案刻意调整以下现行约束，实施时必须先写相应 OpenSpec delta；不能只修代码让旧测试悄悄失效：

- `workflow-run-control-plane` 的 Persistent recovery reservations：保留预留与不退款，加入明确追加一次尝试和计划规模上限调整。
- `private-agent-orchestration` 的有界恢复要求：改为 route replacement 本身不充值，但父代理可明确追加；环境/报告错误不计入产品纠错。
- `abel-workflow-prompt-package` 的恢复说明：移除“任何耗尽都不能再继续”的表达，区分自动暂停、一次追加和资源耗尽。
- 与上述要求重叠的活动 change `reduce-workflow-approval-loops`：实施前整合其 delta 或先归档，避免两份相反要求同时生效。
- 跨项目验证与隔离规范：补充 HOME、工具缓存、独立报告、完整脚本输入绑定及真实包管理器行为。

实现已整合到活动 change `reduce-workflow-approval-loops`，同步规范、提示词、package-members 和 AGENTS 索引。

## 10. 实施顺序与验收

### 10.1 建议交付顺序

1. 统一验证事实和分类，补充真实 npm / Vitest 失败回归；同时完成 HOME、依赖缓存视图与独立报告通道。
2. 改造有界日志捕获、报告大小校验及诊断传递；验证取消和临时目录回收。
3. 扩展 package-script 编译与输入绑定，覆盖复合脚本、hooks、递归 run 和输入漂移。
4. 修改状态机预算、一次追加入口、持久化迁移及 status；删除重复的总失败次数阻断。
5. 合并规范与提示词变化，运行真实消费项目、存储重开和最终 apply 回归，再完成打包与 traceability 检查。

实现时采用真实故障先失败的回归测试，再完成最小修改；不要以更新错误字符串或提示词正则替代行为验证。
新增模块时同步 package-members 清单和 AGENTS 索引，既有不可变 Agent 文件仅在确需修改指令时按 provenance 规则更新。

### 10.2 验收矩阵

| 场景                                             | 必须满足                                            |
| ------------------------------------------------ | --------------------------------------------------- |
| npm 启动，宿主环境无可用 HOME 继承               | 使用沙箱 HOME 正常执行                              |
| Vitest 普通 JS/TS 配置，宿主无缓存目录           | 能编译配置；consumer 依赖与缓存内容不变             |
| 配置、pretest、测试输出普通日志                  | 结果仅取决于有效报告与退出状态                      |
| 8,000 个简单测试、超过 1 MiB JSON                | 正常完成并校验 minTests                             |
| 日志超过捕获预算                                 | 测试继续，内存有界且标记截取                        |
| 报告缺失、损坏、冲突、symlink 或超限             | unavailable；不通过、不写产品失败基线、不自动改代码 |
| package script 含 &&、引号、变量、嵌套 run       | 包管理器顺序及短路语义保持；不人工展开              |
| pre/post hook 或包管理器配置变更                 | currentness/admission 发现变更，重新绑定后执行      |
| 脚本试图写宿主依赖或访问宿主私有文件             | 仍被隔离阻止                                        |
| 同一自动失败耗尽后普通 resume / rebind / restart | 不新增候选请求、不重置计数                          |
| 父代理明确追加一次尝试                           | 只授予一次，历史 used/失败保留；失败后暂停          |
| 重放、旧失败序号、并发追加、启动后崩溃           | 不重复授予、不退款；租约和状态一致                  |
| 已封存候选遇到环境故障后恢复                     | 重验保留候选，不重新生成补丁                        |
| 一个任务拆成 16 个任务                           | 接纳后额度扩大，完成事实保留、used 不归零           |
| 重命名、重复编译、缩小再放大                     | 不重复扩额；永远不突破 hardLimit                    |
| 旧数据库重开与旧基线复用                         | 原子迁移；新语义重验相关证据后才可 apply            |
| 最终应用、失败回滚、取消后代、清理               | 保持现有一致性和主工作区保护                        |

Linux Bubblewrap job 增加真正的包管理器执行夹具，不只验证 Node 脚本或静态 capability。
至少覆盖已声明支持的 Node 22.13.0 / 24.13.0 与对应 npm，以及 Bun、pnpm、Yarn 的明确版本和 node_modules 安装模式。
Windows/macOS 继续验证解析与能力协议，不由本方案宣称原生 Implement 隔离已经支持。
发布前运行 `bun run verify`、`bun run traceability:check`、真实隔离测试和受影响的 seed acceptance。

## 11. 方案验证记录

上一轮 review 的相关 82 项现有测试通过，但额外真实隔离夹具复现了 npm HOME、Vite 缓存只读、stdout 混入日志及报告输出超限问题。
本次设计验证使用临时目录构造依赖骨架、沙箱 HOME、独立 Vite 缓存和 JSON 报告文件。
真实 Bubblewrap 中，Node 26.7.0 / npm 12.0.2 / Vitest 4.1.10 成功运行带普通配置日志的 8,000 个测试，退出码 0，失败数 0，报告为 1,688,547 字节，超过旧 1 MiB 输出阈值。
夹具显式解析并检查报告统计；stdout 中的配置日志与报告相互独立，运行后临时目录已清理。
这验证了执行目录、缓存视图和报告分离可以组合工作；实现回归已覆盖旧预算迁移、脚本执行与配置漂移；CI 增加 Node 22.13.0 / 24.13.0 下的四种包管理器矩阵。
上述夹具用于验证方案可行性，不替代实施后的永久回归测试和受支持版本矩阵。

## 12. 实施验收记录

2026-09-06 本地验证结果：

- `bun run verify`：语法、生成 worker 新鲜度、TypeScript、Biome、Markdown 全部通过；666 项测试通过、9 项环境条件测试跳过；真实 tarball 的 68 个文件与清单一致。
- `CADENCE_REAL_ISOLATION=1 CADENCE_ALL_PACKAGE_MANAGERS=1 bun run test:target test/isolation-real.integration.test.ts`：5 项通过，包含四种包管理器各运行 8,000 个测试、npm hooks/嵌套脚本/短路、依赖只读保护、旧证据复验、保留候选恢复与最终 apply。
- `bun scripts/seed-acceptance.mjs`：新进程验收通过，142 项相关测试及静态检查通过。
- `bun run check:agents`、`bun run traceability:check` 和 `openspec validate reduce-workflow-approval-loops --strict` 通过；48 条活动需求/场景引用均由一个任务负责。
- 预算迁移回归先复现重启后宿主较小配置误拒绝旧 run 的问题，再验证保留既有上限、used 和耗尽历史；显式修复失败后保留剩余额度，后续明确追加能够完成。

删除重复的提示词全文/字符距离断言、全源文件禁用词扫描，以及通用 package script 已不适用的网络命令别名拒绝测试。
保留真实资源加载、Agent 身份、打包成员、控制命令 schema、路径隔离、取消和 apply 一致性测试；新增与真实故障对应的报告、恢复和脚本行为覆盖。
本地包管理器验收使用 Node 26.7.0、npm 12.0.2、Vitest 4.1.10、pnpm 10.12.1 和 Yarn 1.22.22；受支持的 Node 22.13.0 / 24.13.0 矩阵已配置到 CI，本次没有触发远端 CI。

实现边界保持明确：仅覆盖现有 node_modules 依赖模式和 Linux Bubblewrap；admission 使用完整配置哈希，隔离执行允许已授权路径上的候选修改；改变验证入口命令仍需修订合同。
旧证据复验不通过时暂停且禁止 apply，保留历史而不直接删除任务；环境复验复用已封存候选，但仍占用一次保守工作预留。

## 13. 复审问题修复

复审发现四处未覆盖行为：完整 manifest 哈希拦截已授权修改、截取日志丢失 Red 证据、自动次数耗尽拦截保留候选复验、配置全文黑名单误拒绝注释。
修复先以回归复现，再分别调整可信执行输入、流式证据捕获和恢复准入。

- 配置写入权限只来自父控制面持有的已接纳计划，不新增 Worker 可填写的验证合同字段；按原路径和依赖审批规则验证候选后，才能执行其配置。
- Red 见证按 stdout/stderr 独立进行字节流匹配，最多保留见证长度减一的跨块尾部；UTF-8 分块不丢证据，截取头尾拼接也不会制造证据。
- 耗尽时先检查私有 ledger 中是否有绑定当前 revision 的封存候选；复验路径禁止候选生成，环境错误保留候选与诊断，产品拒绝清除待复验候选并保留累计失败。
- 配置检查忽略引号外的注释，识别有效配置键，普通值中的 token/password 等词不作为拒绝依据。

运行时证据策略更新为 `report-file-v2`，旧策略证据在复用前按现有迁移路径重验，避免旧的日志拼接判定直接沿用。

本轮最终验收：`bun run verify` 全部通过（677 项通过、11 项环境条件测试跳过，68 个打包成员匹配）；真实 Linux Bubblewrap 专项 7 项通过，覆盖 npm/Bun、大日志 Red 和已授权 manifest 候选。
新进程 seed acceptance 的 145 项测试与静态检查通过；OpenSpec strict validate、AGENTS、52 条活动需求追踪和 `git diff --check` 通过。
复验回归覆盖成功、产品拒绝和累计检查仍需补丁三个分支，均验证存储重开后的候选请求次数与剩余预算。

## 14. 完整归因与容量估算修复

- 完整失败集合先比较再摘要，既有失败超过 256 条不会触发误修复；新增失败落在摘要边界之外仍会阻止完成。
  基线通过现有 ArtifactStore 保存，SQLite 仅保存 revision 与内容哈希引用，避免沿用模型投影的 512 元素/64 KiB 存储上限；读取兼容旧内联基线，并在交付迁移时重新封存。
- 非 Vitest 失败哈希绑定 runner、入口命令、参数和规范化失败证据，排除显示 ID、阶段、审批配置哈希。
  证据策略升级为 `report-file-v3`，已有策略的基线重新采集，阶段证据沿现有恢复路径重验。
- Implement 容量估算改为软偏好，保留 16,000 context / 8,000 output 的最低容量。
  自动选择先尝试满足估算的健康路由，同一优先级保持配置顺序；没有满足偏好的路由时回退到满足最低容量的路由，显式 rebind 不受估算拦截。
  连接健康、次数限制和候选完整性检查继续生效。

回归复用原有累计修复、归因和 rebind 测试，覆盖 300 个新增失败的有界反馈、1,024 个既有失败加 257 个新增失败及重启恢复，并补充不同合同 ID 的执行身份和 8K 路由选择行为。

本轮验收：`bun run verify` 通过，679 项测试通过、11 项环境条件测试跳过，68 个打包成员匹配；真实 Linux Bubblewrap 专项 7 项通过，新进程 seed acceptance 的 146 项测试和静态检查通过。
原审查脚本中的 256/257 既有失败、小任务 8K 路由、不同 ID 的同命令全套失败四个场景均完成，未请求误修复。
AGENTS、OpenSpec strict validate、55 条活动需求追踪和 `git diff --check` 通过。
