# Workflow plan

```text
# 在新建的 Git worktree 中移除普通 Web 对话对 checkout 锁的依赖：同一仓库的不同 Pi session 各自启动和运行，不再相互排队。让启动状态、取消和记录反映真实行为，保留工作流之间的交付协调。

## Initial route (the service may revise it)
从普通 Send 路径移除 CheckoutGate/CheckoutPermit 接线与生命周期，不换成共享锁、文件锁或另一种等待队列。普通新 turn 受理时持久化 starting；鉴权准备等完成后沿用真实执行阶段，不能把尚未启动描画成已输出。将 starting 作为活跃、可取消、可观察的 turn 状态贯通服务协议、读取与 Web；区分工作流/协调器状态、回复内主动等待和历史 queued。以受控的 worker 启动/结算点验证跨会话行为，而不是以请求返回 accepted 或耗时推断。并行推进服务、Web 和边界文档；最后在稳定候选工作树整合、用 canonical builders 生成发布字节、核对来源摘要并验证。

## Decisions
只移除普通对话的 checkout 互斥；普通 host-tool 会话可同时读写同一目录，也不再等待工作流在目标 checkout 上持有的许可，可能并发写同一文件，不承诺事务、自动合并或防覆盖。不放开同一 session 的第二个独立浏览器 run。保留 Enter 引导、Alt+Enter 主动排后、owner 活跃数和资源上限、固定 cwd/model、准入/鉴权/Stop/隔离、旧记录不改写不重放。工作流相互间的读写协调和最终 Git 集成、checkout owner 磁盘租约不变。不改变原生 Pi、不新增只读会话模式、不部署、不推送、不安装依赖。

## Acceptance
① 可控快测实际挂住同 checkout 会话 A 的 worker，不释放 A 时 B 能启动、执行并先完成；反向验证工作流持独占 checkout permit 时普通对话无需等它。② A 活跃时同 session 的第二个独立 Send 仍不能启动；明确容量拒绝时无新 turn、草稿可编辑，无排队或自动重发；主动 steer/queue 保持。③ 从首份 state 和服务投影直到 Web，新的普通回复在启动准备时显示“正在启动”而非“排队中”，保持活跃轮询/停止/导航；旧 queued 仍可读，失去原 worker 的启动中记录据实呈现中断，不改盘、不重放；不改写工作流或主动消息队列的语义。④ 定向验证取消一个并行会话不杀另一个，owner Stop 等所有原始工作结算、状态不确定仍隔离；工作流间交付独占与分支/HEAD/路径检查保留。⑤ 边界文档写清普通会话并发写入自担冲突的语义；生成字节与 pins 一致，受影响快测与 bun run verify 通过，独立 Agent 审查精确候选，再本地快进。

## Assumptions (confirmed by approval)
用户要求的是新 worktree 内实现，不是直接改当前目录，也不是只留未集成的补丁；采用 local-merge，批准后建独立任务分支和稳定 worktree，完成后仅本地快进目标分支。批准含使用原 checkout 已有 node_modules（以及若存在的 web/node_modules）按路径链接供新 worktree 检查/构建使用，不复制源代码、profile 或凭据，不更改依赖版本或安装缺失项；依赖不可用则报告，不下载。容量上限不是等待队列，不以支持无限并发为验收。

## Tasks
### ordinary-service: 移除普通对话整轮锁，贯通真实启动状态与服务端回归
Depends on: none
Writes: src/service, test/conversation-input.test.ts, test/conversation-records.test.ts, test/conversation-rename.test.ts, test/service-conversation-context.test.ts, test/service-conversation-inputs.test.ts
Reads first: investigation 68e63481-f242-4376-a67e-48b378b0f14f — 列有持久化、owner/activity/记录投影、旧 queued 与 slow fixture 的关键边界。; investigation 48da70ec-6a43-4fc6-9b57-45346668ed35 — 列有 gate 消费者和可复用 fast 输入/生命周期夹具。
先读 investigation、生命周期文档及目标源码/测试。解除普通对话与 checkout gate 的接线而不改工作流间的 gate、checkout owner/租约；保留所有原始工作跟踪、Stop、鉴权结算、容量和会话级准入。普通新 turn 的首写为 starting；更新状态类型/codec/摘要、活跃列表、activity、启动恢复/中断/未知的只读投影与真正消息队列的区分。按需要扩展仓内服务/共享协议测试，做真实 Send 到受控 worker 的快测：A 未结算时 B 可先运行和完成（不要用计时或仅 accepted）；工作流占锁时普通 Send 仍启动；覆盖取消隔离、Stop 等待两个原操作、同会话冲突与容量拒绝。更新依赖旧 gate 的 fixture，特别是 slow context 测试用明确同步点保留原断言，不自动跑 slow。不要改 Web 或直接编辑生成物。

### web-starting: Web 区分启动与排队，守住草稿、观察及后续消息操作
Depends on: none
Writes: web/src, test/web
Reads first: investigation 68e63481-f242-4376-a67e-48b378b0f14f — 有实际活跃判断、UI 显示与草稿消费链路及测试缺口。; engineering/clients.md § Ordinary conversations — 保留共享 session、明确 Send/输入意图及生命周期。
以普通 turn 新公开状态 starting 为服务端约定，并行实现所有真正消费普通回复状态的 Web 路径：摘要/头部/侧栏/正文、轮询、导航、停止和输入控件等；启动提示中英文一致，不误报正在排队或已产生输出。不要把合约或所有 queued 全局替换；保留真实 follow-up queue、工作流等状态。明确未受理的容量拒绝保留可编辑草稿、不自动发送；不确定结果保持 observe only。用接入实际 reader/composer/view 数据的 fast Web 回归覆盖首屏、运行态和拒绝，不靠查翻译字符串制造证据。服务端类型与生成物交给其他任务。

### contract-docs: 同步项目与用户文档中的并发边界
Depends on: none
Writes: AGENTS.md, engineering/clients.md, engineering/lifetimes.md, engineering/limits.md, engineering/verification.md, docs/conversation-mode.md
Reads first: investigation 48da70ec-6a43-4fc6-9b57-45346668ed35 — 列有现行持锁承诺及真正仍需协调的工作流保护。; engineering/clients.md § Ordinary conversations — 普通对话与回复内 steer/queue 的公开契约。
更新现有事实归属处，澄清普通 turn 不是 checkout gate 持有者，启动不是排队；并行 host-tool 写同一目录与原生多终端一样可能冲突，Git 交付复核不是文件事务。保留工作流互斥、owner 目录防重、session 单活和 Stop/未知收尾边界，明确用户主动队列未被移除。仅改涉及旧契约、限制与相关回归归属的语句，不重复平铺文档。

### canonical-build: 合并源变更后生成服务与 Web 产物并刷新实变来源摘要
Depends on: ordinary-service, web-starting
Writes: src/service-host.mjs, src/service-cli.mjs, src/model-preview.mjs, src/native-build.ts, web/dist, provenance/webui-reuse.json
Reads first: investigation 48da70ec-6a43-4fc6-9b57-45346668ed35 — 给出 canonical builder 和已知来源正文 pins。; engineering/verification.md § Builds and packaging — 生成字节和打包验收遵循项目单一入口。
基于已合并后端和 Web 变化，用项目 canonical builders（bun run build:service、bun run build:web，其他仅按实际生成图）再生字节，绝不手写 bundle；只刷新必要的本地目的文件摘要，保留上游 pins/licensing。确认完整候选的构建一致性及 fast 验证入口。不要安装、复制依赖、拉取浏览器或自动执行 slow 诊断。

## Setup (explicitly authorized commands)
Execution order: target once before worktree creation, candidate once, then worktree in the candidate and every detached child; listed order within each stage. Each command is a separate process; exports do not persist.
[worktree] 从原 checkout 共享已有安装，不安装依赖: test -d /home/mirako/abel/cadence/node_modules && ln -s /home/mirako/abel/cadence/node_modules node_modules && if test -d /home/mirako/abel/cadence/web/node_modules; then ln -s /home/mirako/abel/cadence/web/node_modules web/node_modules; fi (10000ms)

## Baseline verification
No separate baseline checks declared.

## Verification
普通会话并发、记录与单会话约束: bun run test:target test/conversation-input.test.ts test/conversation-records.test.ts test/conversation-rename.test.ts (180000ms)
工作流之间的协调未退化: bun run test:target test/checkout-gate.test.ts test/workflow-admission.test.ts test/workflow-delivery-runtime.test.ts test/workbench-cadence-control.test.ts (180000ms)
Web 会话读写、输入与观察: bun run test:web test/web/conversation-reader.test.tsx test/web/conversation-send.test.tsx test/web/conversation-inputs.test.tsx (180000ms)
项目唯一集成门禁（含全部默认快测、Web 和生成物）: bun run verify (600000ms)

## Review reads first
investigation 68e63481-f242-4376-a67e-48b378b0f14f — 对照真正受理/启动边界、旧记录和实际 Web 投影，不能只凭改文案判断通过。
investigation 48da70ec-6a43-4fc6-9b57-45346668ed35 — 核对工作流 gate 与 owner 生命周期不被误删，核实测试和生成物入口。
engineering/verification.md § Regression owners — 按项目回归归属审查受控并发证据、快测及未执行环境边界。

## Automation boundary
After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. No dependency installation beyond the setup commands listed here. Only actual verification and independent Agent review permit delivery. Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and serialized fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Independent conversations may implement in separate candidates; a verified non-overlapping sibling delivery may be merged into this candidate and checked/reviewed again. Conflicts, changed instructions, overlapping inputs or external target drift retain the candidate for a fresh plan. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue. No push, publication, deployment or recursive delegation. Related project knowledge and workflow Markdown are included. Worktrees/tools are not a sandbox.

## Project documents
AGENTS.md
engineering/clients.md
engineering/lifetimes.md
engineering/limits.md
engineering/verification.md
docs/conversation-mode.md
```
