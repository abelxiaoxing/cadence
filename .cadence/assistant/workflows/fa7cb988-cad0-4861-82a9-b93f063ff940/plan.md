# Workflow plan

```text
# 一次交付完整的 Cadence WebUI 优化：从新对话输入、后台会话与计划审阅，到时间轴阅读、输入区遮挡和消息跳转。所有已确认需求共同验收。

## Initial route (the service may revise it)
沿用现有三栏壳层、主题和交互组件，在原位置改进：新会话由唯一输入框承接；在标题处打开当前计划；将活动会话与历史行归并。时间轴在显示层按真实步骤状态折叠，箭头使用固定尾列；在滚动区到输入框之间建立完整遮挡，保留现有问题跳转并贴轨显示。不新建发送、审批、运行或滚动状态机。用同一候选构建贯通各场景后交付。

## Decisions
范围为此前已确认的全部改动，加上最新四项，不互相替代。保持全站配色、三栏结构、用户气泡、停止按钮光学质感、左侧子代理层级；底部连接/延迟/服务状态栏及右侧文件/分支栏本轮不调整。模型和推理强度都常显。计划留在对话内，不另开审阅页，不做历史计划版本库。运行跟踪是视觉分组，不改记录、调度、审批、工具权限或发送语义；不重做独立运行分析视图。不安装新依赖或浏览器，不推送、发布或部署。

## Acceptance
1｜开始输入。真正的新会话中，几何标识、问候、最多两个可编辑起点与输入框居中成组；起点仅填空草稿，不覆盖、不发送。确认首发后同一个输入框平稳归底；已有记录直接用底部布局，加载、未确认、失败不能冒充首发成功。不丢草稿、附件或焦点，不重复提交。发送旁清楚表达普通发送、下次开启 Cadence、已经开启或未知，不在欢迎语/占位/工具栏反复解释。模型和推理强度同时可见，窄屏换行不藏选项；可用键盘调整支持的值。底栏密度不变，未知不报空闲，确实受阻的操作给原因。品牌标识空闲静止，只有当前会话的真实接收或语义变化才短暂反馈一次；重复快照不重播，减少动态时有静态文字。
2｜历史与后台。删除独立「正在进行的工作」面板，有后台活动的会话位于普通历史前；回复与多个关联工作流共用一行，最后一项结束才归位。静态有色记号及可访问标签表示运行，选中态另用底色。反复更新阶段或耗时不改行文案、顺序或焦点。页外、归档、未持久化首轮的活动也可发现；无可靠会话归属的运行有紧凑详情入口，仍能辨认并按原权限停止具体运行，不把断连当结束。不改变其他目录的只读发现或左侧子代理层级。
3｜当前计划。新提案通过会话标题明显可发现，「查看当前计划」在同一对话内打开唯一单栏提案。继续讨论时最新消息与输入框之间不再挂旧卡或旧实施按钮，不抢滚动或焦点；收起后可重开，冷刷新、换会话/分支、替换和重新验证不串版本。开头依次是实际状态、目标、此次变化与保留项；不用未声明的信息补齐字段。取消卡头三列等高框，短路径不被长策略撑出空白。默认只用简短本地化文字表明本机执行非沙箱、真实目标、可调整的范围、交付方式与禁止事项；不硬套本计划的权限到别的计划。精确目标/ref/base、路径、运行策略、命令、假设、验收及完整协议在技术详情内可查，同一段交付原文只显示一次，按钮上方不重复长英文。查看/收起不发批准或重验证请求；只对当前有效绑定实施，需验证时先显式验证，之后仍需单独批准。窄屏不横溢。
4｜时间轴布局。可展开行撑满父容器，同列文本区可收缩省略、右箭头不收缩且共享右边距。长路径、短路径、无路径及不同状态，桌面与 320/390px 窄屏下同列箭头右边界相差不超过 1 CSS px。稍提高路径副标题与名称的可辨性；路径仍能查全，不改工具配色和现有时间轴风格。
5｜完成步骤汇总。同轮连续 3 条及以上已确认完成步骤默认合为一行「已完成 N 步 · 展开过程」；开始正式正文后的已完成短串按至少 2 条处理。正在运行、排队、失败、结果未知的调用保留可见，不因下文出现或轮次结束推断成功。不跨正文/轮次合并；无内容且已不活跃的思考占位可纳入前后已完成段，独立时紧凑、不提供空详情，不伪造结果。键盘/点击均可展开还原原顺序；展开汇总不批量读取详情。用户手动展开或正在聚焦/阅读的内容不被后续快照强制折回。
6｜底部遮挡。底色渐隐带在「↓ 最新消息」胶囊上缘之前已完全不透明，输入舱玻璃后及下方不透出字形；胶囊采用现有色系的高不透明深色磨砂底、外投影及清晰文字/焦点。输入高度变化时仍成立，最后一句可滚到可读区，挡板不截获滚轮、点击、拖动或选字。上翻保持阅读位置，Latest 仍能恢复跟随。
7｜右缘短线。保留 QuestionRail 消息跳转，把刻度整合到右缘细轨内，平时弱隐，悬停轨道或键盘焦点进入才显现。保留当前项、方向键及跳转到未加载消息的能力；不挡原生滚动条拖拽/滚轮、不突兀浮在内容区，维持已有手机隐藏策略。
8｜同一构建综合验收。用本地浏览器和合成数据走通居中输入→确认首发归底、后台多步骤持续更新、发布计划→继续讨论→标题重开→替换/刷新、长工具流折叠→展开→上翻→回到最新消息。后台更新覆盖一分钟或等效受控时长；时间轴含 15 步、无内容思考及单独的异常/未完成步骤。记录桌面与窄屏、浅/深色、键盘和减少动态效果的坐标、交互结果、截图或像素证据。直接对照有无字形的底部画面，不用 CSS 声明或 SSR 代替真实浏览器。完整项目 verify 通过，交付规范构建的 Web 资源。

## Assumptions (confirmed by approval)
未声明的保留项不杜撰；冷刷新默认收起计划正文，以标题入口恢复。输入起点只在空草稿时提供。3 条即触发常规折叠，单条不另套汇总。批准本卡允许隔离工作树链接复用原仓库现有 node_modules，并用已安装本地浏览器测试；不安装、升级软件，不使用个人会话或真实执行批准来测试。

## Tasks
### shell: 新对话入口、品牌反馈与标题中的当前计划
Depends on: none
Writes: web/src/components/workspace/ChatWorkspace.tsx, web/src/components/workspace/ChatWelcome.tsx, web/src/components/workspace/ChatComposer.tsx, web/src/components/workspace/CadenceModeButton.tsx, web/src/components/actions/ModelPicker.tsx, web/src/components/workspace/conversation-entry.css, test/web/conversation-entry-presentation.test.tsx, test/web/current-plan-entry.test.tsx
Reads first: investigation f0354e73-0855-4805-b3c4-b333069b864a — 当前 proposal 不是消息历史；标题入口与绑定可直接复用。; engineering/clients.md § Browser — 区分准备、提交、明确接收/失败与审批；保护首次草稿。; engineering/clients.md § Scroll intent — 居中/归底和计划开合均不能破坏原阅读位置。
以 ChatWorkspace 为接线点：保留唯一 ChatComposer、草稿和真实 send 边界；空态中央成组，受理首发后才归底。用两条以内本地可编辑起点，区分 armed/on/off/unknown；保留模型和强度常显、可键盘调整、窄屏换行。品牌只对已观测事件单次反馈。移除流尾常驻 PlanCard；原标题区域提供「查看当前计划」并在本会话内展开，生命周期随当前提案、导航及继续讨论，不扫描历史，不改变 PlanCard 授权接口，不自动准备、验证或批准。用组件局部样式，不抢占全局样式表，额外键由整合统一登记。测试首发/失败/草稿、计划替换/重开/续聊和无副作用。

### proposal: 重排计划卡，长协议只出现一次
Depends on: none
Writes: web/src/components/workspace/WorkflowPanel.tsx, web/src/components/workspace/plan-proposal.css, test/web/plan-proposal-presentation.test.tsx
Reads first: investigation f0354e73-0855-4805-b3c4-b333069b864a — 明示查看与实施的不同授权边界。; engineering/clients.md § Browser — 源提案、批准前授权说明、交付目标及重新验证契约。
保持既有 PlanCard 输入、审批/验证回调和可用性检查，仅重组内容、局部排版。以状态、目标、声明的变化/保留和授权后果开头；完整条款用同一 proposal 生成，精确协议、权限、假设、差异和标识可核查。移除等高元数据格和 details 外重复 readableDelivery 原文；正确表达各种交付/安装政策、禁用/重验证的区别，不能为简化隐藏实质权限。320px 可读，按钮不被输入区遮住。新增实际卡片测试，中文英文键交整合登记。

### history: 将后台工作合入历史会话列表
Depends on: none
Writes: web/src/App.tsx, web/src/components/workspace/TaskSidebar.tsx, web/src/components/workspace/ConversationRow.tsx, web/src/components/workspace/history-activity.css, test/web/conversations.test.tsx
Reads first: investigation db59cbc6-3365-42b8-a8b3-8418bb2545c4 — 侧栏的真实归属证据、独立结果、归档/页外活动和停止语义。
使用已有活动和历史投影，按可靠会话身份生成稳定行；删除单独工作面板及仅服务旧展示的逻辑，不维护第二份运行状态。运行与选中用不同静态提示。保留页外、归档、新会话、无归属和来源不可读情况，以及具体运行的详情和原权限停止入口。进度更新不移动或替换正在阅读/选择的行。保护子代理层次、跨目录发现和已确定的底栏。覆盖多关联运行及最后一项结算。

### row-layout: 时间轴箭头对齐与路径对比
Depends on: none
Writes: web/src/components/workspace/ChatSteps.tsx, web/src/components/workspace/trace-row.css
Reads first: engineering/clients.md § Stable rendering and details — 了解工具行的标题、目标、状态与详情职责。
沿真正的工具行、可展开头、状态区消除 shrink-to-fit；满宽行、中列 flex:1/min-width:0、路径省略、尾箭头 shrink:0 并统一右边距。作用在对应局部组件，保留完整路径获取、真实状态图标和气泡风格，只调现有色阶。不要改全局主题。

### trace-fold: 把连续已完成步骤收为可展开的一行
Depends on: none
Writes: web/src/components/workspace/ChatTurnView.tsx, web/src/components/workspace/turn-source.ts, web/src/components/workspace/trace-groups.ts, web/src/components/workspace/trace-groups.css, test/web/chat-timeline.test.tsx, test/web/trace-groups.test.tsx
Reads first: engineering/clients.md § Streaming timelines — 步骤稳定身份、工具结果与父轮结算的区别，以及已打开详情的刷新语义。
在真实 ChatTurnView 渲染中按同一轮连续区间显示组，使用已记录的步骤结果，正确对待 body-free 活动及旧记录未知；正文不是工具成功证据。保留非合格状态可见，按验收阈值和段边界处理。展开保持原步骤身份/详情读取坐标与原顺序，用户手动展开优先、不丢键盘焦点；不得通过一次展开把所有 payload 拉进来。覆盖 1/2/3/15 步、运行到结束、失败/未知、占位、分支/轮次边界、重复快照与手动展开。只变中栏呈现，不动左侧子代理层级。

### scrim: 消除输入舱透字与最新消息碰撞
Depends on: none
Writes: web/src/styles.css
Reads first: engineering/clients.md § Scroll intent — 不能把内容高度或输入尺寸变化当作恢复自动跟随的指令。; engineering/verification.md § Optical presentation observation — 以最终像素、按钮命中和滚动结果验收，不只看样式。
针对消息流底部、Latest 和 composer-dock 的现有样式设置响应输入高度的渐隐与实色平台。胶囊之前已经完全遮字，输入舱本身保留玻璃质感；胶囊高不透明深色、清楚投影与焦点。保留末句可滚出遮挡、事件穿透、上翻定位和返回最新，兼顾窄屏、浅色、forced colors。只在有消息时施加，首屏中央输入区不能带出多余遮挡；与 shell 通过现有 dock 结构或整合时最小接线协同，不修改主题、气泡或停止按钮。

### rail: 将右缘消息刻度融入细轨
Depends on: none
Writes: web/src/components/workspace/QuestionRail.tsx, web/src/components/workspace/question-track.css, test/web/question-track.test.tsx
Reads first: engineering/clients.md § Browser — 现有问题跳转轨与键盘、窄屏使用契约。
QuestionRail 是问题跳转导航，不删除。将刻度视觉压入靠滚动条的轨道，常态弱隐，hover/focus-within 显现；保留足够的热区但不覆盖原生滚动条，不依赖 hover 才能键盘访问。保留 roving focus、当前消息跳转、分页、长列表和手机原隐藏行为。保护现有滚动控件，不引入新滚动模型。

### browser-workspace: 复现新对话、计划讨论与后台会话场景
Depends on: none
Writes: scripts/quiet-workspace-observation.mjs
Reads first: engineering/verification.md § Optical presentation observation — 沿用实际构建、合成公开夹具及几何/焦点证据。; investigation f0354e73-0855-4805-b3c4-b333069b864a — 正确复现后续讨论保留相同计划、替换与重验证的区别。
编写可挂入既有光学观察入口的 quiet-workspace 观察模块。用合成公开投影和本地浏览器，测首发前后与常显参数；持续后台更新时的顺序与焦点；截图般长策略、短路径条件下的提案排版、单份详情和顶部授权边界；发布→讨论→重开→替换→刷新时不误触执行请求或重挂旧卡。保留桌面、窄屏、主题、键盘证据，不用真实执行或个人会话。观察入口统一注册由整合负责。

### browser-transcript: 实测箭头坐标、步骤折叠、底部像素和跳转
Depends on: none
Writes: scripts/transcript-polish-observation.mjs
Reads first: engineering/verification.md § Optical presentation observation — 复用真实客户端、稳定帧及像素/交互采样手段。; engineering/clients.md § Streaming timelines — 构造真实状态和语义边界，不用之后的回复伪造工具成功。
编写 transcript-polish 观察模块，入口注册由整合完成。用长短路径和 15 步、无内容思考、异常/未知/进行中混合夹具；量测同列箭头和文字可读性，用鼠标键盘展开并确认稳定，随着内容高度变化检查上翻/跟随。对比其余条件相同的有墨迹/无墨迹画面，验证渐隐开始前确有正文、胶囊上缘前及输入舱后字形贡献为零；测输入高度、末行可达、按钮命中、轨道 hover/focus 与问题跳转。观察桌面/窄屏、两种主题与减少动态。

### integrate: 整合全部场景，在同一构建上联合验收
Depends on: shell, proposal, history, row-layout, trace-fold, scrim, rail, browser-workspace, browser-transcript
Writes: web/src/i18n, web/src/styles.css, web/src/reference.css, web/src/components/workspace/ChatWorkspace.tsx, scripts/qualify-optical.mjs, test/web, engineering/clients.md, engineering/verification.md, docs/conversation-mode.md, web/dist, provenance/webui-reuse.json, provenance/package-members.json
Reads first: engineering/verification.md § Commands and environment — 规范发布资源与唯一完整集成门禁。; engineering/verification.md § Optical presentation observation — 两组最终观察绑定同一构建。; .cadence/knowledge/provenance-pins.md § Pins and build identity — 区分生成物、实际包成员与原始上游来源。
统一登记中英文键和两个浏览器组，接入现有测试/观察框架（不弱化原保障）；整合局部样式次序和必要接线。交叉验证空态不套消息渐隐、首发后归底启动正确遮挡、计划展开与折叠组/输入高度变化不抢读者锚点、头部入口不生成流尾卡；全站色板和受保护组件保持原样。更新既有事实文档。执行 bun run build:web 生成规范资源；按实际变更更新本地哈希和必要的包成员，保留上游来源与许可证。最终对同一候选执行 verify 和两组真实浏览器观察；记录不满足项或不可观察项，不拿静态渲染或过去的通过作证。

## Setup (explicitly authorized commands)
Execution order: target once before worktree creation, candidate once, then worktree in the candidate and every detached child; listed order within each stage. Each command is a separate process; exports do not persist.
[worktree] 工作树复用原仓库现有依赖，不安装: test -d /home/mirako/abel/cadence/node_modules && ln -s /home/mirako/abel/cadence/node_modules node_modules && test -x node_modules/.bin/vitest (10000ms)

## Baseline verification
现有 WebUI 回归基线: bun run test:web (600000ms)

## Verification
完整项目门禁: bun run verify (1200000ms)
实际浏览器：输入、历史列表与计划审阅: node scripts/qualify-optical.mjs --group=quiet-workspace (600000ms)
实际浏览器：时间轴、底部遮挡与消息刻度: node scripts/qualify-optical.mjs --group=transcript-polish (600000ms)

## Review reads first
investigation f0354e73-0855-4805-b3c4-b333069b864a — 核对当前计划入口、冷刷新、替换和真实批准绑定，不造历史关联。
investigation db59cbc6-3365-42b8-a8b3-8418bb2545c4 — 核对去重而不丢活动、停止入口和子代理层级。
engineering/clients.md § Streaming timelines — 保持真实状态、懒读与滚动语义，仅改变确认过的呈现行为。
engineering/verification.md § Optical presentation observation — 用同一最终候选的实际页面证据复核两组交互及其组合效果。

## Automation boundary
After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. No dependency installation beyond the setup commands listed here. Only actual verification and independent Agent review permit delivery. Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and serialized fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Independent conversations may implement in separate candidates; a verified non-overlapping sibling delivery may be merged into this candidate and checked/reviewed again. Conflicts, changed instructions, overlapping inputs or external target drift retain the candidate for a fresh plan. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue. No push, publication, deployment or recursive delegation. Related project knowledge and workflow Markdown are included. Worktrees/tools are not a sandbox.

## Project documents
engineering/clients.md
engineering/verification.md
docs/conversation-mode.md
```
