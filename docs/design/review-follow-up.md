# 项目设计审查整改

状态：代码与本地验收完成；真实模型行为验收受 Provider 错误阻塞。
普通工程任务，保留工作区已有修改。

- [x] 验证环境身份：安装后的依赖与 runner 内容绑定到基线/阶段证据；漂移触发暂停与重验。
- [x] 结构化授权：Gate A 保存并继承 ChangeContract；编译与自动 amendment 检查验收和范围。
- [x] 恢复策略：嵌套恢复通过父控制面决策，复用既有持久化工作预留与租约。
- [x] 验证模式：行为保留 Red/Green；获批准的机械修改与重构执行基线/Green及完整交付验证。
- [x] 真实任务评估：提供实际 Pi RPC、一次性消费项目、主机更换、独立隔离 oracle 和安全指标。

详细设计及需求追踪见 `openspec/changes/close-design-review-findings/`。

## 验证边界

新测试覆盖 runner/依赖漂移、环境变化后的存储重开与候选复用、Gate A 结构化权威及拒绝替换、自动 amendment 禁止行为改写、统一恢复决策，以及机械/重构任务不生成 Red 的最终 apply。

真实 Pi 包加载预检通过。
2026-09-06 的实际模型尝试返回 Provider 错误，4 次错误、0 次工具调用、0 token；评估如实记录 `evaluation-model-unavailable`，不计为用户介入或工作流成功。
这不是 UX 验收通过，后续可用 Provider 下需运行全部场景。

只读依赖挂载配合内容身份和执行前后检查，防止普通安装漂移被当作同一环境；不宣称防御宿主恶意并发替换再恢复内容。
依赖哈希有文件数、字节数和时间上限，超限属于环境不可用。
系统库仍属于受信任宿主基础设施。

历史计划保持可读；新模式必须由结构化 Gate A 授权。
内部保留只读阶段槽以兼容已发布计划类型，调度与 ledger 不生成虚假的 Red 完成证据。

## 本地验收记录

- 完整 `bun run verify`：695 项通过、11 项环境条件跳过，类型/语法、格式与 70 成员真实打包清单通过。
- 真实 Linux Bubblewrap：7 项通过，包含 npm/Bun/pnpm/Yarn、8,000 测试报告、环境变化后的重开和最终应用。
- 新进程 seed acceptance：150 项通过及静态检查通过。
- OpenSpec `validate --all --strict`：6 项通过；64 条活动需求/场景引用唯一归属；AGENTS 索引通过。
- Pi RPC preflight 通过；真实模型失败报告保存在 `docs/design/review-live-evaluation.json`，不作为行为验收通过证据。

真实隔离回归还发现并修复了环境身份存在、旧 policy 标记缺省时 ledger 存储 undefined 的兼容性问题。
四种包管理器中的 pnpm 10.12.1 和 Yarn 1.22.22 在临时目录安装用于验收，验证后清理；没有改动宿主全局安装。

最终事务另有独立环境身份事实，进程在 apply 期间重启也不能换环境接受旧证据。
补充回归验证了应用中断、环境改变、回滚、重新验证及复用原候选完成的组合路径；并修复 apply 异常后父状态停在 applying 导致 resume 不可用的问题。

## 后续四项审查修复

- 保留的 `repair-verified` 证据与阶段证据一起复验，使用任务自身的 `repairVerification` 和成功分类；策略缓存区分证据种类。
  普通修复和累计修复的跨重启测试均先复现了错误应用，再验证失败暂停、主工作区不变，以及验证恢复后复用候选完成。
- 执行输入绑定跳过 `changeContract`，保持 Gate A 授权内容独立于执行环境。
  Vitest 和 package-script 的端到端测试覆盖显式合约、修订预检、编译、最终化及拒绝合约替换。
- amendment 预检在编译前注入已有的结构化授权，与 DesignController 的继承逻辑保持一致。
  mechanical/refactor 草稿省略合约的端到端测试均先复现预检失败，再验证完整修订路径。
- 已批准的包脚本获得可安全解析和挂载的 Node、Bun、npm、npx、pnpm、Yarn 绑定，保留复合命令与嵌套脚本语义。
  隔离 PATH 优先使用已解析的私有运行时；真实 Bubblewrap 测试将 Bun 放入私有目录，并断言实际执行来自隔离挂载，覆盖直接、复合和嵌套调用。

本轮验证：`bun run verify` 704 项通过、14 项条件跳过，类型/语法、格式与 70 成员打包检查通过；真实 Linux Bubblewrap 10 项通过（本轮使用 npm/Bun）；新进程 seed acceptance 152 项通过；AGENTS、64 条活动需求/场景追踪及 `git diff --check` 通过。

## 系统 runner 与评估分类补充修复

- 系统 runner 的身份包含启动路径、解析后的目标文件及其所属包目录，覆盖包内实现模块和内置依赖；绝对固定参数中的启动脚本同样绑定。
  保留通用依赖哈希不跟随符号链接的规则，解析失败时按 runner 不可用处理。
  六项回归覆盖无私有挂载的系统绑定，在符号链接不变时修改启动目标、实现模块或内置依赖，验证快照和异步环境身份均失效。
- Implement 未完成时先判断该阶段是否新增模型错误，有错误则记录 `evaluation-model-unavailable`，不增加用户介入次数。
  五项确定性 RPC 主机测试运行真实评估脚本，覆盖 Provider/网络错误、主机重开、正常停滞，以及 Design 已恢复的错误不影响 Implement 分类；无需调用真实模型。

本次补充验证：`bun run verify` 715 项通过、14 项条件跳过，类型/语法、格式和 70 成员打包检查通过；真实 Linux Bubblewrap 10 项通过；真实 Pi RPC 包加载预检通过。
