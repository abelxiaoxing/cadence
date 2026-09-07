# Cadence 端到端体验优化方案

2026-09-07；承接已实施的架构改造。
本轮建立可以闭环验收的优化顺序，补齐诊断依据，并实施已有复现支持的首批修复。
普通工程任务，不激活 Abel slash-command 阶段。

## 判断与范围

应该继续优化，当前的状态是架构与确定性契约通过，端到端体验没有通过。
下一阶段以真实 consumer 的独立最终 oracle 为完成标准，文件变小、JSON 变短或预检通过均不能替代它。
继续保留独立的 PlanDraft / ImplementPlan、唯一状态转换权威及窄 Pi 适配层。
这两项应当作为后续优化的约束：作者只提供意图、证据和必要选择；Pi 只负责激活、交互、配置适配与展示。
本轮修复均落在编译器、控制状态机、路由及独立评估脚本内，没有扩大宿主事件依赖或另建 agent runtime。

目前不能把所有耗时归为编译器，也不能把所有 failedTools 归为协议错误。
上一轮单任务 75 次工具调用、多任务 15 次工具调用，均在 600 秒截止时未完成 Design；它们是不同轨迹，没有同条件旧/新对照。
该结果见 [上一轮实施与验收记录](architecture-cost-reassessment.md)。

## 本轮已完成的证据工作

### 有界评估观测

修改现有 `scripts/workflow-evaluation.mjs` 和 `scripts/evaluate-workflow.mjs`，不向产品运行时添加事件总线或诊断服务。
新增观测覆盖：

- 按闭集工具名、action、operation 统计调用、失败、正常返回、领域阻塞及相同内容重复提交。
- 保留有限数量的安全错误码、schema 字段、阶段里程碑及前段/末段操作轨迹，不保存原始参数、提示、思考、源码或响应内容。
- 用活动区间并集计算工具占用时间；将子调查占用、本地工具独占、非工具时间分开，避免并行调用重复计时。
- 记录已完成 assistant 消息的观察窗口和 input / output / cache token；这不是独立的物理 HTTP 请求计数，也不是纯模型计算时间。
- 记录 Design、交接、Implement、oracle 的起止与未完成状态；在截止处冻结快照，取消后的迟到事件不能改写截止观测。
- 读取公开 RPC `get_state`，记录实际模型、reasoning、容量和路由指纹；保留源码指纹及运行期间是否变化。
- 可选 `--progress-output` 每 15 秒输出同一份有界元数据，便于观察尚未结束的诊断运行；写入失败不影响工作流执行。

源码读取计数目前只覆盖明确指向 package src/scripts 的成功 `read`；不把 grep、find 或 shell 的未分类访问当作零次源码查阅。
一般文件工具的未知错误仍记为 unclassified，不解析或保存任意错误正文。
任何未观测值都不能用零来替代成功。

新增回归先在旧实现上失败，再补实现通过。
评估观测首轮全量 `bun run verify` 通过：821 项测试通过、14 项条件跳过，92 个打包成员匹配清单。
最初评估器 28 项测试覆盖并行计时、阶段截止、失败字段投影、原始内容不回显、采样上限和迟到事件隔离。
本轮诊断使用当前 `abel/LocalModel`、`xhigh`、262144 context window、32768 maxTokens，没有修改用户全局模型配置。

### 300 秒诊断与工具可见性

[单任务诊断](end-to-end-diagnostic-small-fix.json)于 300,350 ms 结束，截止快照为 300,026 ms；未完成 Design。
42 次调用全部为文件调查：18 次 read、12 次 ls、8 次 grep、4 次 find，没有调用 abel_dispatch。
5 次失败来自 read / find，一般文件错误正文未保留，分类为 unclassified；本样本没有发生 Gate 或 compiler 工具错误。

本地工具活动区间并集只有 295 ms；子调查为 0 ms；非工具观察时间为 299,731 ms。
15 个已完成 assistant 消息累计 input 533,401、output 14,605，最大单消息 input 58,911；cache 为 0。
报告有 4 次确定的 harness 源码 read 和 2 次示例 read，所有 Gate / 草稿 / 编译 / Implement / oracle 里程碑均为 null。
因此本样本定位的是进入控制流程前的调查停滞，不能推断编译器慢，更不能将非工具时间全部称为模型计算。

另用只读临时扩展观察首个 before_provider_request 的工具名，15 秒探针确认实际请求包含 abel_dispatch、read、grep、find、ls，未发现未知工具，序列化工具 schema 为 20,872 字节。
[允许字段的探针结果](end-to-end-tool-surface.json)不保存提示、请求正文或认证材料。
该探针说明初始工具缺失无法解释这次停滞；不代表已知道模型选择每次调查的原因，也不是成功验收样本。
诊断和探针源码指纹同为 `7a912a08437250641a88de050970400dfedf251a96607415dfa6d17c4941bbb2`，运行期间不变。

### 已复现的作者协议缺口

修复前，`assessDeliveryTraceability()` 要求 `tasks.md` 出现任务的阶段 verification ID。
精简草稿已由编译器生成这些 ID，但当时 `DesignController.#compilePlan()` 只安装 `implement-plan.json`，没有将对应机械绑定安装到任务文档。
编译器返回的 `tasksMarkdown` 也没有被这条控制路径采用。

使用随包单任务示例、真实编译器和追溯校验器进行本地复现：

| 输入                                               | 结果                                                   |
| -------------------------------------------------- | ------------------------------------------------------ |
| 精简 PlanDraft                                     | 编译成功                                               |
| 任务 ID + 明确 Scenario 引用 + 语义描述的 tasks.md | traceability-verification-unmapped                     |
| 编译器现有 renderTasks 输出                        | 缺少 Scenario 引用；任务 ID 格式不符合当前追溯识别规则 |
| 向作者文档手工复制编译器生成的阶段 ID              | 追溯校验成功                                           |

[机器可读复现](end-to-end-traceability-reproduction.json)保留了上述结果。
复现脚本位于本机 `/tmp/cadence-traceability-reproduction.ts`，使用临时 consumer，不修改产品文件。
这证明“身份由机器生成，追溯文档仍由模型抄写身份”的断点存在。
它没有证明上一轮 600 秒超时已走到这个断点；上轮报告没有这种因果证据。

## 实施顺序

### P0：先固定可用的诊断与基线

本轮已实现上述观测，并运行一个独占的、300 秒截止的单任务诊断样本。
缩短时间窗的目的是定位构造路径，不把它与旧 600 秒样本作速度对比。
每个报告必须说明实际配置、源码版本、阶段是否到达、是否通过 oracle 和观测限制。
保留失败样本，不靠反复重跑直到一次成功来宣布完成。

进入正式对照前固定 Node / Pi / OpenSpec /模型及 reasoning、路由、consumer 初始字节、需求、授权文本、截止时限、oracle 和并发条件。
既有 `multiple-tasks` 场景要求逻辑独立的任务，但两个函数位于同一个源文件；不能将它称为无文件冲突的并行吞吐基准。
基线/候选按 A/B/B/A 等顺序交错且串行执行，避免同一端点的并发负载成为未记录变量。

### P1：让编译器完成机械追溯绑定

这是已具备确定性证据的首个产品修改，本轮已实施。

作者继续提供任务目标、验收证据、Scenario 引用和明确任务归属；不新增一门引用语言，也不让机器猜语义归属。
编译器从完整计划生成任务与阶段 verifier 的机械绑定段，并通过现有私有 Design 写入路径安装到 `tasks.md` 的代码受管区域。
保留作者说明和 Scenario 引用区域；生成段不得掩盖作者区域缺少任务/Scenario 归属的问题。

实现边界：

- `delivery-compiler.ts` 负责纯投影和稳定排序；已有计划验证保留任务身份唯一性。
  绑定段覆盖 Red/Green/Refactor 与机械/refactor 模式，不生成第二份任务 checkbox。
- `design-control.ts` 在现有 finalization lease 下检查任务文件当前性，分别原子安装受管段与完整计划，二者成功后才提交原有 compile-plan journal 事实。
  没有跨文件原子提交的虚假承诺；中断时可确定性重放，finalization 仍逐项重验。
  Pi 事件不参与写入。
- 复用现有编译操作日志，无新增 schema、存储或批准机制。
  旧 sealed delivery 没有受管段时仍按原有追溯格式读取；只有新的 compile-plan 会安装生成段。
- finalization 继续重新读取计划、任务和 spec，绑定实际字节；不能删除 traceability 检查来让任务“变快”。

迁移只作用于新编译的 Design 草稿；旧 sealed delivery 和已批准字节继续按原有规则读取。
同一规范计划重复编译应产生相同生成段；显式篡改、Scenario 改名、重复 owner 或交付修订改变必须被正确拒绝或重新生成。
如果无法安全辨认旧文档的作者区域与受管区域，应返回具体诊断，不能覆盖整个文件。

通过条件：精简单任务和带依赖多任务都能经公开 Design 工具从写草稿、预检、编译走到真实 OpenSpec finalization，无需读取 compiler 源码或手抄 generated ID。
还需覆盖编译中断与重放、只更新生成区域、旧交付重开，以及 Implement 完成 checkbox 后的 currentness 验证。

### P1 补充：命名 package-script 的命令绑定顺序

本轮 600 秒样本把问题推进到草稿预检，并实际报告 script-command-mismatch。
只读检查同一临时 consumer 的 manifest 与草稿，确认实际脚本为 `node --test test/*.test.mjs`，草稿却填写 `command: "npm run test"`。
该字段绑定的是脚本原文，运行入口由 packageManager / script 表达；显式不一致应该继续拒绝。

还复现了代码顺序缺口：已有 bindDraftVerificationInputs 支持省略 command，但 named definition 在它运行前就要求完整 command，导致同一省略规则在两类作者输入中不一致。
本轮将 manifest 绑定移到 author expansion 之前，再在展开后绑定完整验证器的执行输入。
没有新 DSL 或执行接口；PlanDraft 类型允许省略 package-script command，封存类型仍完整。
显式错误值不被替换，Gate A 的完整接受验证也不被编译器改写。
新增回归验证省略/显式正确值得到相同完整计划和验证身份、显式错误仍拒绝；Prompt 与字段提示解释脚本原文和启动命令的区别。

### P2：收敛 Design 的调查与构造路线

本轮已实施 Prompt 顺序调整和 start/status 的小型 nextStep 指引；实际效果由后续样本判断。
优化的是何时已有足够证据进入设计，不是减少必要证据。

显式 Design 调用先创建或恢复 durable run，避免在长时间探索后才获得 runId 和进度事实。
已有路径明确、行为局部、验证工具已知的任务，优先并行读取适用指令、manifest、目标实现和现有测试；必要事实齐备后进入 Gate 与草稿，不继续无目的地遍历目录。
只有独立证据缺口确实有价值时才使用调查子调用；不把子代理作为每个简单任务的固定仪式。

在现有 start/status 返回中增加小型、代码拥有的当前步骤指引，说明本步缺什么、可用的作者字段和已安装文档入口。
当前工具描述已经包含示例绝对路径，不再增加一套发现服务。
整理 Prompt 中“先调查”与“从第一步持久化”、旧字符串 Gate 示例与结构化新工作要求的叙述顺序；历史兼容保留在解析器中，新任务主路径只示范一种写法。

保持相同工具与命令数量，不加任意批处理 DSL。
只合并独立读取及已授权独立工件写入的模型轮次；不同工件继续使用独立 operation id 和既有租约/重放规则。
有依赖的审批、草稿、编译、finalization 仍按正确顺序执行。

本轮实现仅修改 `prompts/abel-design.md` 与 `src/design-control.ts` 的引导内容，另由现有 `src/design-diagnostics.ts` 提供追溯修复提示；无需继续扩展 Pi 入口。
不得改 immutable professional Agents，也不让控制服务导入 Pi 生命周期事件。

通过条件：对固定简单场景，调查能结束并提交计划；无未修正协议错误、无需要人手重新授权的等待，且必要源码/测试/约束证据仍可追溯。
调用次数作为诊断指标；不制定对所有仓库一刀切的读取次数硬上限。

### P2 补充：恢复拒绝不制造虚假 readiness

冻结样本已进入 Implement，后续优先级转为结构提交失败及恢复链路。
本轮在确定性测试中复现并修复两个问题：

- 过期或无效的额外恢复授权被拒绝时，旧代码已将运行从 paused 改为 ready，并改变 legalCommands。
  状态机现先校验并记录恢复授权，再进入 ready；普通拒绝保留原暂停状态、失败历史和工作预算。
  同一请求若已接纳新的批准交付，而旧授权随之失效，则保留已接纳的交付并明确暂停，不留下 validating 或 ready。
- 单 inherited 路由经结构失败进入冷却后，同会话普通 resume 正常暂停；重启后恢复持久绑定却将冷却误映射为 route-capability-insufficient。
  broker 现区分真实能力不足与临时 endpoint-unavailable；没有延长预算、清除历史或绕过冷却。

回归覆盖额外授权一次消费与重放、拒绝前后状态一致、修订交付后的拒绝、结构失败后的同会话恢复、重开、冷却结束后重新执行。
只注入结构失败结果，不声称重现了真实模型的具体无效提交字段。
评估器新增 flat Implement 的 control 分类、pause.code、有限的提交分类/schema/次数，以及 resume 是否携带 recovery / deliveryRevision 的布尔观测。
这些字段不包含请求身份、内容或动态诊断正文；已有失败报告保持原样，不用新口径重写历史。

接下来先定位真实提交为何在两次机会内都被拒绝，再运行固定版本的单任务验收。
若反馈仍不足，优先在已有 child-session / submit-tool 边界保留代码拥有的字段路径及校验类别，不捕获完整模型响应、不创建新的诊断服务。
同一实际字段错误可在离线回归中重放并修复后，再开始 P4 的重复单任务/多任务矩阵。
恢复状态修复不能代替首次结构提交成功，也不能证明整个任务已通过 oracle。

### P3：再优化反馈体积与模型请求成本

仅在 P1/P2 后的轨迹仍显示上下文或长响应占主导时实施。
先测量实际工具 schema、状态回执、预检摘要、重复材料和各轮 usage，再决定压缩对象。
不能把所有 nonToolMs 称为模型计算，也不能仅凭 xhigh 就断言降低 reasoning 能保持质量。

优先使用有界摘要和已存在工件引用，减少重复传回完整事实；必要作者输入与批准依据必须始终可读取。
保留 Gate 精确结构与可就地纠错字段，不退回宽泛 object 把隐藏约束重新交给模型试错。
利用已有显式阶段切换提供当前阶段接口，不按每个小状态重新注册一套动态工具框架。

模型或 reasoning 调整作为独立实验，不能混在源码变化里归因。
如比较 xhigh 与较低档位，保持其他条件不变，要求同一独立 oracle 和证据完整性通过；结果不合格就不采用该档位。
不修改用户全局配置，不恢复宿主 payload 捕获，不把 HTTP headers 当作模型已开始工作的证明。

### P4：端到端闭环验收

建议采用以下工程门槛；这是本方案的目标，不是已测得的能力。

1. 单任务及多任务各连续 3 个、串行、600 秒固定窗口样本，全部通过独立 oracle，且没有额外人工纠错或重复批准。
2. 每次都分别报告 Gate、草稿、预检、编译、finalization、Implement 和 oracle；未到达记 null，不成功不进入成功耗时均值。
3. 不需要直接查阅 Cadence 实现源码来理解作者协议；无法分类的访问单列，不能算成零。
4. 正常路径不需要重抄机器 ID；故意注入的一个字段错误能够用反馈完成一次局部修正。
5. Red/Green、baseline、累计验证、有限恢复、旧交付重开、取消/迟到、唯一状态权威和最终 apply 的既有检查全部保留。

连续 3 次用于工程验收，不宣称统计显著。
要声称性能改善，继续采用同条件旧/新交错样本；初始建议每格 5 次并公开全部结果，不报小样本 p95。
若只是在更长时间窗内完成，应报告“容量条件改变后完成”，不能报告同条件提速。

## 本轮验证记录

- 最新 `bun run verify`：836 项测试通过，16 项条件跳过；类型/语法、lint 和 92 项分发清单通过。
- 恢复状态、真实 durable broker 组合和评估观测的 176 项定向测试通过；过期授权留下 ready、重启冷却误报能力不足的断言均先在旧实现失败，再经修复通过。
- 新增 Design 回归先在旧实现失败，修复后通过，覆盖不手抄生成 ID、受管段不能掩盖缺失作者证据、篡改与编译中断重开；作者正文的 UTF-8 BOM 也保持不变。
- 纯投影覆盖机械/refactor/可选 Refactor、作者前后文保留、重复 Scenario、Scenario 改名、多任务稳定排序和残缺/重复 marker。
- `CADENCE_REAL_OPENSPEC=1` 的 3 项实际 CLI 验证通过：精简单任务和带依赖多任务都经写工件、预检、编译、封存、加载完成；另一项验证完成 checkbox 后仍可接纳，验证绑定篡改仍拒绝。
- `check:agents`、64 项活动追溯引用和 `openspec validate --all --strict --no-interactive` 的 6 项验证通过。

### 600 秒候选诊断

[候选单任务报告](end-to-end-candidate-small-fix.json)：600,091 ms 截止，37 次调用，7 次工具失败，未通过独立 oracle。
约 55.3 秒建立 run，241.7 秒通过 Gate A，417.2 秒写入草稿；4 次预检均失败，未编译、未进入 Implement。
失败包括 1 次 start 参数错误、2 次一般文件读取错误和 4 次预检错误；预检后段明确出现 script-command-mismatch 与 change-contract-acceptance-missing。
报告有 0 次确定的 harness 源码 read、2 次示例 read；未分类访问仍不等同于零。
工具活动区间并集为 420 ms；18 个已完成 assistant 消息 input 556,094、output 28,354；最大单消息 input 48,823。

这个样本运行期间发生 Prompt 换行格式化和评估器正常等待分类修正，sourceUnchanged 为 false，因此只保留为失败诊断，排除固定版本的正式对照与验收。
其旧观测器还把 start / bind-change 的正常 Design 等待各误记为一个 domainFailure；它们不是工具错误，不应加入 failedTools。
该口径已有回归修正。
repeatedPayloads 只表示忽略身份字段后的相同请求参数；固定路径的 preflight 请求重复不能证明磁盘草稿没改过。

### 第二份 600 秒候选诊断

[命令绑定修复后的报告](end-to-end-fixed-small-fix.json)：600,092 ms 截止，48 次工具调用、5 次工具错误，designCompleted 为 true，completed 为 false。
268.2 秒通过 Gate A，342.2 秒写入草稿，493.2 秒通过预检，499.2 秒编译，554.9 秒完成真实 Design 封存。
封存后仍出现一次 ls 和一次 read；截止时尚未进入 Implement，最终 oracle 未运行。
该样本只证明这一次 Design 完成，不能计作端到端通过。

工具活动区间并集为 1,453 ms；宿主累计 tokens 为 997,060，包含重复输入上下文，不能当作新输出文本或完整子模型成本。
源码 read 计数为 0、示例 read 为 2。
运行期间工作区出现本轮未修改的依赖清单、锁文件和包契约测试更新；其中锁文件变化使 sourceUnchanged 为 false。
保留这些并行改动及原始报告，因此这份样本同样排除固定版本正式验收。

根据封存后的实际操作轨迹，Prompt 已补充成功封存后直接返回简短 readiness、停止重复读收据和目录的指引；其效果必须继续验证。
当时将代码和 node_modules 复制到独立私有快照，另做 1,200 秒功能验收，避免后续工作区变化污染版本；结果见下一节。
20 分钟窗口单列为容量条件，不能替代 600 秒体验门槛。

### 冻结版本的扩展功能验收：进入 Implement，仍失败

[冻结样本](end-to-end-extended-small-fix.json)使用 1,200 秒窗口，实际在 1,143,575 ms（约 19 分 4 秒）结束，reason 为 implementation-stalled，sourceUnchanged 为 true。
Design 完成，Implement 未完成，最终 apply 与独立 oracle 未通过；这次并非截止超时。

| 里程碑                   | 累计时间 |
| ------------------------ | -------: |
| Gate A                   | 159.5 秒 |
| 首份草稿                 | 231.1 秒 |
| 成功预检                 | 338.8 秒 |
| 编译                     | 344.6 秒 |
| Design 封存              | 348.7 秒 |
| 进入 Implement 阶段      | 368.7 秒 |
| Implement start 返回暂停 | 475.3 秒 |
| resume 工具异常          | 543.1 秒 |

共 61 次工具调用、4 次工具错误，宿主累计 tokens 为 2,524,315；这些包含重复输入，并非完整子模型用量。
报告 userInterventions 为 1，表示评估器将未完成的最终回复判为需要介入；本次没有实际人工补充纠错。
0 次确定的 harness 源码 read 与 21 次未分类 shell 调用不能解释为没有查阅实现。

运行时曾只读检查临时 SQLite：任务停在 Red，pauseCode 为 endpoint-unavailable；提交诊断为 mixed、2 次提交、schema invalid。
路由 health 为 open，lastCode 为 invalid-structural-result；恢复事件记录 1 次失败，上限 2。
resume 操作被标记 interrupted，运行投影却为 ready，任务仍 paused。
endpoint-unavailable 在这里不构成网络连接故障证据；retryAt 存在独立数据库列中，投影 JSON 未包含它也不构成存储缺失。

旧评估器未保留该 resume 的具体异常码、是否携带额外授权，以及子代理的无效字段。
尝试备份时评估器已清理临时 consumer，因此未获得完整状态副本；只保留上述当时的只读观察和已写出的有界报告。
本轮新增回归复现了“拒绝授权后留下 ready”和“重启冷却误报能力不足”，但不能将前者认定为这次线上异常的已证实根因。
延长窗口已不足以解决此样本，下一步应修复具体提交/恢复失败，再检验体验门槛。

### 模型档位与宿主条件

后续候选仍使用同一模型和路由。

曾用 --model abel/LocalModel:medium 请求较低档位，但实际 get_state 仍返回 xhigh；必须按实际配置记录，不能将命令参数当作配置已生效。
检查确认全局设置字节未改变。
进一步调用公开 RPC get_available_thinking_levels，当前 LocalModel 只暴露 xhigh，因此该宿主会将 medium 归一到唯一可用档位。
[能力探针](end-to-end-thinking-capability.json)没有调用模型，也没有修改 Provider 能力或全局偏好。
本机安装 Pi 为 0.85.1。
工作区中独立发生的 peer 版本范围调整已保留；正式可比矩阵仍需固定具体宿主和已解析依赖版本，不能把版本范围当作兼容性实测。
两份 600 秒样本之间存在命令绑定修复等代码差异，且实际 reasoning 相同；不能把差异归因于档位，也不作同条件速度比较。
这一轮仍要求真实 Design、Implement、最终 apply 与独立 oracle 完成；任一步未完成就继续记失败。

## 决策约束

不因历史样本耗时而继续拆大类，不通过放宽 Gate、取消 traceability、跳过测试或扩大写权限来提高完成率。
不以无限自动重试解决不理解协议的问题。
每个产品修改都应有失败复现、最小改动和相应通过条件；观察不足时先增加局部观测，不先决定重写架构。
