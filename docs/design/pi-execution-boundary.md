# Pi 执行边界重构方案

## 决策

Cadence 拥有子任务循环和交付终态；Pi 宿主只负责扩展激活、模型配置、公开工具定义和展示。
模型传输依赖 pi-ai 的公开 streamSimple 和完整 AssistantMessage 合同，不使用 coding-agent 的子 AgentSession 或覆盖其底层 Agent 钩子。

## 实施步骤

1. 新增模型轮次适配器，隔离流事件、完整响应、进度、取消与迟到结算。
2. 重写 child-session：显式维护内存上下文、工具调用结果和提交计数，在整批处理后决定继续或终止。
3. 删除 ParentPayloadBridge 和 EmptyResourceLoader；继承路由快照当前有效 Provider、模型及新鲜认证，不注册包装器，不截获父请求回调。
4. 保留 Provider 自身行为；不再继承宿主会话级 payload 钩子，也不从父请求移植 reasoning 等请求级配置。
5. 将旧桥接专属测试替换为新边界合同测试，继续运行结构化交付、取消、封存、真实 HTTP 和完整分发测试。
6. 更新现行规范、包成员、文档、依赖边界与架构断言；不修改历史归档的事实。

## 不变量

- 只有完整正常响应中的工具调用可以执行；截断、传输错误和取消响应不能提交产物。
- 只有五个白名单工具，模型输入参数先校验，不加载任何宿主资源。
- 最多两次结构化提交；第一次拒绝后可纠正，第二次无效后不再调用模型。
- 已接受结果后不得有第二个终态提交；同批只读调用不改变已接受产物。
- 正常文字结束且从未提交时只提醒补交一次，不重置总时限。
- broker 拥有重试；Provider-managed retries 禁用，模型调用与工具执行均传播取消。
- 不自动接受自由文本、不扩大权限、不修改审批、验证或最终应用权威。

## 验证计划

先建立禁止底层钩子、父注册表修改和 dist/core 导入的失败断言。
以确定性 Provider 和本地 HTTP 验证循环、提交预算、批次语义、认证、错误归类、用量和取消。
最终运行 verify、check:agents、traceability:check 和真实打包检查。
跨版本和真实外部模型成功率不能由单版本本地测试推断。

## 实施结果

新增 `src/child-model.ts`，重写 `src/child-session.ts` 的执行控制，删除 `src/parent-payload-bridge.ts` 与 `src/empty-resource-loader.ts`。
生产 Provider 组合使用无磁盘配置发现的 `pi-ai createModels`，仅宿主测试夹具保留 `ModelRuntime` 创建。
子模型上下文只含数据化工具 schema，不将 execute 函数或宿主资源传给 Provider。
每个子执行使用独立 sessionId，并通过公开的 session-resource 清理接口释放该子执行的 Provider 连接／缓存；不会清理父 session。
取消结算保留最多 250 ms 的协作用量回报窗口，不接受迟到交付。

停止决定只由 Cadence 显式循环作出，工具定义的 `terminate` 字段不再决定子执行的批次终态。
同批工具按源顺序执行，合法提交附带只读调用可成功，重复终态仍拒绝。
已发生提交拒绝后若 Provider 随后报错，优先保留原有结构化失败事实；原截止时间和用户取消优先于它。

继承路由在认证前后检查模型及 Provider 身份，入场后采用该 attempt 的快照。
后续父模型切换影响下一 attempt，不再通过捕获回调的 generation 隐式修改当前请求；阶段退出仍由所属 operation 的取消／drain 管理。
输出上限沿用模型与 Provider 的声明，不再对 Responses payload 删除 `max_output_tokens`。
需要宿主会话级 payload 改写才能工作的服务，应迁移到明确的 Provider 实现或 custom route。

包清单删除两项、增加一项，运行包共 74 个成员。
Pi SDK peer（包括 `pi-ai`）统一使用 `*`，不限制宿主 Pi 的版本；开发依赖的固定版本仅用于仓库构建与测试，不作为用户安装约束。
测试不再导入 Pi 的 dist/core 路径，prompt 展开改用公开宿主 Session API 验证。

旧桥接专属测试被新 Provider 快照测试替换，而非标记跳过。
验收覆盖实际 Responses 请求、带密钥／无密钥 custom route 本地 HTTP、模型／Provider 认证竞态、取消／原时限、异常完整响应不执行工具、两次提交计数、清理隔离及原有候选封存和最终应用。
最终 `bun run verify` 通过：780 项测试通过、14 项条件跳过，类型／语法、lint 和 74 成员真实打包检查通过。
新进程 seed acceptance 的 164 项测试和类型／语法检查通过；项目索引、64 条现行追踪引用和差异空白检查通过。
本次没有外部真实模型性能基准；原有 14 项条件测试仍按环境跳过，不能将跳过解释为已验证。
