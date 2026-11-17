# Workflow plan

```text
# 修复 Cadence WebUI 对话中已显示正文重复追加或重新逐字播放、思考/工具记录迟到插入扰乱阅读，以及运行期间缺少可见进展、工具输出不及时刷新的问题。参考 ../pi-web-ui 的 MIT 实现，交付稳定的流式时间线、可信的运行反馈与回归覆盖。

## Initial route (the service may revise it)
采用端到端的身份连续性修复，而非仅隐藏动画。现有链路是 SDK capture 与 Pi session 并行产生预览/落盘数据，owner 合并后由 WebUI 轮询观察。初始路线：
1. 以 capture message UUID 和真实 contentIndex 建立预览块身份；通过已有 cadence-browser-command marker 添加可选 captureMessageId，将其与实际 Pi entry 关联。读取端严格沿现有 command/run/user/parent/branch 所有权边界校验，不新增第二份正文存储、不按正文相等或可见条数去重。处理 Pi 已写入而关联 marker 或 final capture 尚未到达的中间状态，避免交接窗口重复。工具结果以 callId 关联执行，展示顺序仍来自源消息/块。
2. 保留实时预览的块结构，按真实事件提供不含正文/签名的 thinking 活动占位。占位与最终可读 thinking 条目原位交接；不可读或中止内容明确结束或标为不可用，不制造可展开的假详情。新元数据和旧历史兼容，不降低未知帧、封闭字段及所有权校验。
3. 对外提供稳定步骤渲染身份和足以区分内容变化、执行状态的版本/状态信息。客户端将数据定位坐标与 React 身份分离，按身份协调预览/落盘/分页，拒绝过期读取结果；工具详情按内容版本而非仅 parts 刷新，终态补最后一次读取。
4. 沿用可复用的 Markdown 稳定前缀/活动尾部结构。普通对话不再把已经收到或已显示的快照从零逐字播放；新内容直接增量显示，完成块不因交接或新增工具而重建。thinking 保持默认折叠、正文只按既有落盘详情读取。
5. 在输入区域附近、滚动正文之外显示紧凑运行观察条，分别表达回复活动、workflow 状态和连接/观察新鲜度。优先使用实际观察到的模型/工具活动；没有事件时明确显示等待或暂未收到新进展，不虚构百分比、ETA、成功或卡死。保留 Stop 及当前工作流取消边界，运行时输入、展开、复制和历史阅读不应被遮罩阻断。
6. 保留现有距底跟随、向前加载锚定和“最新消息”入口。正文、图片和详情增高仅在用户处于跟随态时滚动；上翻后不抢回底部。
7. 使用已有测试与规范构建工具，补充导致故障的事件序列与状态断言，更新真实受影响的 MIT 归属/provenance 和工程文档，执行完整 verify 及独立 Agent review 后本地快进交付。

## Decisions
明确决策：先修复 capture→durable→reader→render 的身份/顺序契约，再完善运行可见性；参考上游稳定渲染 key、分段 Markdown 和用户意图滚动，不照搬其按列表位置猜测关联方式。Pi session 保持正文事实源。无正文的 thinking 活动元数据可以实时传递，但不新增思考正文、signature 或内部不可读内容的流式传输；已有可读落盘 thinking 默认折叠并按需读取。工具运行/结果、普通回复终态、workflow 完成、观察连接状态相互独立，不把 stable、agent_end 或工具完成当作交付成功。保持既有读取限额、惰性详情、分支/历史保留、鉴权和取消语义。
非目标：不改 provider/model，不迁移通信到 WebSocket/SSE，不重写或清理旧会话，不移植上游执行/重问语义，不做整站视觉重设计，不修改 ../pi-web-ui，不安装新依赖，不部署、不推送远端。

## Acceptance
1. 新增可重复回归用例，先复现并最终修复：纯 thinking/纯 tool/空 assistant 夹在文字消息之间；text→thinking→tool→text；多个消息在一次轮询间隔完成；合法重复正文；同一消息 final 与 durable/marker 不同到达顺序。最终正文不重复、不丢失，源顺序一致，交接使用稳定身份而不是文本或位置猜测。
2. 同一块从 preview 到 durable，再到终态、重连和分页观察，已显示正文不清空、不从首字重播，展开状态不会因无关条目插入重置；旧历史仍可读取且不会伪造关联。
3. 活动期间输入区附近持续有可信反馈；明确区分等待、已观察到的思考/输出/工具执行、连接或观察滞后，以及回复和 workflow 各自终态。长工具运行或模型无新输出时不再只剩一个终止按钮，也不得伪造进度或自动判定卡死。
4. 同一工具、同一 parts 数但内容发生变化时，已展开详情刷新；完成/失败/取消时读取最后状态。关闭的详情不进行无边界后台抓取，过期请求不回写当前会话。
5. 保持默认折叠 thinking、不传 thinking 原文/签名及限制/脱敏断言；新增活动帧和字段严格校验，未读正文不因占位被提前暴露。
6. 跟随与用户上翻的状态逻辑有回归覆盖；上翻阅读时新内容不强制吸底，回到底部后继续跟随。固定观察条在窄屏和长工具名下不遮住输入与停止控件，中英文同步。
7. 指定 backend/frontend 回归、类型检查、归属/打包检查及 bun run verify 实际通过，指定测试文件确实执行且含通过断言；规范产物与受影响 provenance 一致。交付报告区分自动测试、源码/SSR证据与真实浏览器证据，不把现有纯函数/SSR测试说成浏览器交互通过。
8. 独立 Agent review 检查确切候选提交、边界与测试证据后，本地 fast-forward 合入显示的目标分支；不推送或发布。

## Assumptions (confirmed by approval)
按产品目标优先消除回放和阅读跳动，普通对话取消对已收到快照的人工逐字追赶效果，保留真实新增内容的增量呈现和 Markdown 稳定分段；不另加动画设置。运行反馈采用现有视觉风格的紧凑观察条，不做大面积加载遮罩或虚构进度。允许在现有协议/command marker 中增加必要的向后兼容元数据，并同步受影响的工程契约，但不改写用户旧历史。复用用户已授权的 ../pi-web-ui 代码或设计时保留 MIT 署名和溯源。使用原 checkout 已有 node_modules 的显式只读复用方式，不新增测试依赖或浏览器下载；既有验证主要为受控事件/纯函数/SSR，真实浏览器交互若没有实际证据必须明确标注未验证，不能冒充通过。除执行服务自身提供的私有临时资源外不写仓库外路径。

## Tasks
### stream-identity: 统一 capture 与 Pi 落盘内容的身份、顺序和活动元数据
Depends on: none
Writes: src/worker-public.mjs, src/worker-public.d.mts, src/worker-capture.mjs, src/worker-capture.d.mts, src/sdk-worker.mjs, src/service/conversations.ts, src/service/pi-sessions.ts, src/service/conversation-records.ts, src/service/contracts/workbench.ts, test/worker-capture.test.ts, test/service-contract.test.ts, test/pi-sessions.test.ts, test/conversation-records.test.ts
Reads first: investigation 295cbb75-492e-46e9-8073-2b0873525765 — 真实事件生命周期、Pi 写入先于 capture final 的次序及后台风险。; investigation e182b217-40e9-47c3-9781-7b7062919203 — 最小显式身份桥接方案、旧历史和 getter 隐私边界。; investigation 22446e04-d4d9-4d07-8e10-2b93fd4b13c9 — 实际 schema/validator/type 文件与针对性测试所有者。; engineering/history.md § Ordinary conversation records — Pi 唯一内容事实源及历史所有权约束。; engineering/limits.md § Conversations — 保留读取、预览与详情边界；以实际对应章节及常量为准。
先用受控 fixture 复现 LiveCapture 可见 assistant 计数错误、压平块顺序及 durable-before-final 竞态。实现显式 capture UUID→Pi entry 关联，初始优先扩展既有 command marker 的可选 captureMessageId；严格验证所有权、parent、branch 和唯一性，不以文本/hash/显示条数猜测。按真实 contentIndex 组织预览和落盘块，为纯 thinking、纯 tool、空 assistant 也记录已落盘身份；处理尚未收到 marker 的交接窗口，不能让同一消息暂时显示两份。保留合法重复文本。增加仅包含身份、index、阶段的 thinking 活动事件，绝不读取或传递正文/signature，兼容旧历史缺省值且保持封闭 codec。根据现有共享 workbench 契约输出稳定展示身份、准确工具状态和详情内容版本；把定位/分页索引与渲染身份分开。对旧 capture/transcript 消费者保持兼容，不扩大历史拥有范围或限额。测试覆盖两种交接顺序、批量完成、工具更新 snapshot 不 append、失败/取消、旧 marker 与重试，协议和脱敏测试必须实际执行。具体字段名可按现有契约选择，但必须满足批准的身份与真实性不变量，并给下游前端留下明确类型。

### visible-runtime: 增加持续可见的运行观察条并保护输入与阅读体验
Depends on: none
Writes: web/src/components/workspace/ChatWorkspace.tsx, web/src/components/workspace/RuntimeObservation.tsx, web/src/styles.css, web/src/i18n, test/web/statusbar.test.tsx, test/web/workspace-layout.test.tsx, test/web/runtime-observation.test.tsx
Reads first: investigation e7efa003-2442-4a98-81a2-7b3107e0e81f — 提示消失的实际条件、现有连接事实与跟随/锚定位置。; investigation f4a78f59-3a07-4b09-a08e-c4b41d70b91b — 参考上游分离运行/连接/工具状态与用户滚动意图，避免照搬不适配逻辑。; engineering/clients.md § WebUI contracts — 真实性、thinking、取消与状态分离要求。
独立于后端协议工作，先基于现有 reply/workflow/connection facts 修复状态提示缺席。以 ChatWorkspace 输入区之前、正文滚动容器之外的紧凑组件呈现观察状态；回复和 workflow 同时存在时分别表达，不再用 workflow 的存在隐藏普通回复状态。只展示实际可证明的状态，未知时显示等待/暂未观察到新进展；连接过期保留最后事实并明确滞后，不自动判完成或卡死。保留现有停止、工作流取消、键盘/鼠标输入、复制、展开和最新消息入口，不加全屏或输入区遮罩。准备可供后续时间线接入的活动描述接口，新协议可用后由集成任务接线。沿用现有 80px 底部跟随和上翻锚定策略，避免因状态条周期刷新触发强制滚动。检查窄屏/长名称防溢出、可访问状态提示与 reduced-motion；中英文文案同步，补所有本轮 thinking 占位/状态所需文案。新增组件路径限定在 RuntimeObservation 组件，避免与 ChatTurnView/reader 并行写冲突。新增有判别力的 SSR/纯状态用例，不将其称为浏览器滚动验证。

### stable-timeline: 保持流式时间线身份并修复回放、过期详情和滚动触发
Depends on: stream-identity
Writes: web/src/client/conversation-reader.ts, web/src/client/use-conversation.ts, web/src/components/workspace/turn-source.ts, web/src/components/workspace/ChatTurnView.tsx, web/src/components/workspace/ChatSteps.tsx, web/src/components/workspace/WorkflowAgentView.tsx, web/src/components/StreamMarkdown.tsx, web/src/transcript/use-lazy-window.ts, test/web/conversation-reader.test.tsx, test/web/stream-markdown.test.tsx, test/web/workbench.test.tsx, test/web/workflow-agent.test.tsx, test/web/lazy-window.test.tsx, test/web/chat-timeline.test.tsx
Reads first: investigation 7183b8db-e120-40fe-860e-9a26cb50f9cb — 渲染链路、按位置 key、动画重挂载与稳定前缀风险。; investigation e7efa003-2442-4a98-81a2-7b3107e0e81f — 详情 hook 失效依赖及已有滚动机制。; investigation f4a78f59-3a07-4b09-a08e-c4b41d70b91b — 上游渲染身份、Markdown 稳定块和对应身份测试的参考。; engineering/clients.md § Ordinary conversations — 轮询观察、历史不重放与 thinking 读取边界。
使用 stream-identity 提供的共享类型，按稳定步骤身份协调 reader 的 preview/durable/分页，而非位置、状态或文本长度作为 React key；保留用户展开状态和已显示块。保持快照与回合内容发布一致，忽略取消/换会话/较新版本后的旧请求结果。普通对话的已观察快照不再走从零开始的人工逐字追赶；复用 Markdown frozen prefix/active tail，新增内容直接呈现，已完成块不重播。thinking 活动占位依据真实元数据出现在源顺序位置，原位转换为默认折叠的可读持久步骤，不把活动占位伪造成可读正文。用显式状态判断尾部是否仍在输出，不依赖 stable 推断工具成功或模型仍在写。让已展开工具详情按内容 revision/状态转变重读并终态补读，关闭状态保持惰性、取消结果不能回写。同类 WorkflowAgentView 的运行中/结算详情刷新也应修复，但不改变 workflow 执行状态语义。延续用户控制滚动的现有策略，正文/详情高度变化仅在跟随状态补滚；不写并行任务的 ChatWorkspace、样式及文案目录，必要接线留给集成任务。补 controlled reader、展示身份、无回放进度、详情相同 parts 更新、最终读取、历史兼容、跟随状态回归。现有 node 测试不具备真实 DOM，不得用 SSR 冒充挂载或滚动实测。

### integrate-verify: 整合状态反馈、更新工程契约与 MIT 溯源并生成规范产物
Depends on: stream-identity, visible-runtime, stable-timeline
Writes: web/src/components/workspace/ChatWorkspace.tsx, web/src/components/workspace/RuntimeObservation.tsx, web/src/i18n, test/web/runtime-observation.test.tsx, test/web/chat-timeline.test.tsx, engineering/clients.md, engineering/history.md, engineering/verification.md, docs/reuse-and-distribution.md, THIRD_PARTY_NOTICES.md, provenance/webui-reuse.json, provenance/package-members.json, package.json, src/operator-cli.mjs, src/service-cli.mjs, src/service-host.mjs, src/model-preview.mjs, src/native-build.ts, web/dist
Reads first: investigation efcc9f51-de7a-48c1-a45a-a5f1d0e55593 — 精确构建路线、准备命令、MIT 与出货成员的范围。; engineering/verification.md § Builds and packaging — 只能使用规范 builders，契约变化会影响 Web build identity。; engineering/verification.md § Regression owners — 回归测试所有者与证据边界。; .cadence/knowledge/provenance-pins.md § Provenance pins — 准确区分 destination body pins 与发布成员清单，避免批量掩盖漂移。
整合前序工作，将新观察元数据接到 RuntimeObservation，确认 reply/workflow/连接分别真实呈现且所有新 UI 文案在现有实际 locale 文件中齐备。用组合 fixture 演练 text/thinking/tool 交错、Pi/marker/final 两种顺序、等待、重连、终态与合法重复文本；发现跨层遗漏修复并补回归。只基于实际实现与验证更新已有 Markdown：clients 的 Ordinary conversations/WebUI contracts、history 的 Ordinary conversation records、verification 的 Regression owners，以及确有变化的 reuse-and-distribution Emitted licenses 和 THIRD_PARTY_NOTICES。保留 licenses/pi-web-ui-MIT.txt 与版权归属；不要修改上游仓库或重算 upstream sources pin。按规范命令 bun run build:operator && bun run build:service && bun run build:web 生成受影响产物，Web 构建必须通过其 Node builder，不直接改 dist 或删除未知产物绕过校验。只更新本次改变的 provenance/webui-reuse.json destinations；新增独立出货文件时才同步 package-members 和 package files。运行完整批准 checks，明确记录失败修复、已执行断言及缺少真实浏览器验证的证据边界，供独立 review 检查。

## Setup (explicitly authorized commands)
Execution order: target once before worktree creation, candidate once, then worktree in the candidate and every detached child; listed order within each stage. Each command is a separate process; exports do not persist.
[worktree] 在各工作树显式复用已有依赖，不下载: test ! -e node_modules && test ! -L node_modules && ln -s /home/mirako/abel/cadence/node_modules node_modules (10000ms)

## Baseline verification
修复前后端快速回归基线: bun run test:target test/service-contract.test.ts test/worker-capture.test.ts test/pi-sessions.test.ts test/conversation-records.test.ts (300000ms)
修复前 WebUI 回归基线: bun run test:web (300000ms)

## Verification
Capture 与对话投影回归: bun run test:target test/service-contract.test.ts test/worker-capture.test.ts test/pi-sessions.test.ts test/conversation-records.test.ts (300000ms)
WebUI 完整现有及新增回归: bun run test:web (300000ms)
WebUI 类型检查: bun run check:web (300000ms)
MIT 归属与发布成员检查: bun run test:target test/service-package.test.ts && bun run check:notices && bun run pack:check (300000ms)
项目唯一集成门禁: bun run verify (1200000ms)

## Review reads first
investigation 7183b8db-e120-40fe-860e-9a26cb50f9cb — 根因链路、位置 key 和预览计数的故障路径；区分静态定位与实际测试证据。
investigation e182b217-40e9-47c3-9781-7b7062919203 — 显式 capture/Pi 关联的可行性与消息先落盘的竞态边界。
investigation f4a78f59-3a07-4b09-a08e-c4b41d70b91b — 上游稳定渲染身份、Markdown 和滚动的可借鉴机制及不能照搬之处。
engineering/clients.md § WebUI contracts — 回复/workflow/连接状态、thinking 访问及取消的产品边界。
engineering/verification.md § Builds and packaging — 规范构建产物及 exact candidate 的交付证据要求。
investigation efcc9f51-de7a-48c1-a45a-a5f1d0e55593 — 现有依赖准备、测试能力限制、MIT 与 provenance 处理。

## Automation boundary
After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. No dependency installation beyond the setup commands listed here. Only actual verification and independent Agent review permit delivery. Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue. No push, publication, deployment or recursive delegation. Related project knowledge and workflow Markdown are included. Worktrees/tools are not a sandbox.

## Project documents
engineering/clients.md
engineering/history.md
engineering/verification.md
docs/reuse-and-distribution.md
THIRD_PARTY_NOTICES.md
```
