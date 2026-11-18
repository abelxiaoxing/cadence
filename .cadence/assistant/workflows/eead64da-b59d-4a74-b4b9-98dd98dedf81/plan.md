# Workflow plan

```text
# 全面美化 Cadence WebUI 的明暗两套主题:统一的、克制的玻璃设计语言,覆盖导航、对话、代码与工具输出、输入区、设计选项卡、实施卡、弹层和交互状态;保持长时间阅读清晰度、窄屏体验与渲染性能。

## Initial route (the service may revise it)
token 层:在 web/src/reference.css 与 web/src/styles.css 现有 :root 块内扩展分档玻璃 token 体系(外壳强玻璃 / 内容卡轻玻璃 / 密集阅读面不透明底)、精修阴影层级与降饱和的 mesh/网格背景 token;所有 scheme 相关颜色保持 light-dark() 对,遵守 theme 测试解析器格式(两空格缩进、暗侧为 6 位 hex 或扁平 rgba)。表面层:12 处 backdrop-blur-xl 站点按档改为 24px(外壳)/12px(内容卡)/0(密集阅读面),≤900px 外壳降到 12px;@supports not (backdrop-filter) 时玻璃面回退不透明底。交互层:统一的 :focus-visible / hover / active / disabled / error 处理,覆盖 chips、tabs、buttons、inputs、switches、dialogs、popovers,保留 prefers-reduced-motion 守卫。时间线:web/src/timeline/timeline.css 与 timeline-client.mjs 的固定色板 token 化,保留"同一工具恒同色"编码。构建:用 Node 规范构建器 bun run build:web 重发 web/dist,并刷新 provenance/webui-reuse.json 受影响哈希。

## Decisions
- 三档玻璃:外壳(.topbar/.statusbar/.chat-composer/.action-dialog/.model-popover/.more-menu-items/.panel-drawer)强玻璃;内容卡(.toolcall/.thinking/.receipt/.run-summary/.scm-file/.card/.workflow-line/.workflow-plan)轻玻璃(更高不透明、更弱模糊);代码、终端、工具输出、diff 用稳定近不透明底。
- 模糊分档:外壳 24px、内容卡 12px、密集阅读面 0;≤900px 窄屏外壳 12px,内容卡进一步减弱或移除。
- 背景:保留 mesh 光晕 + 48px 细网格,整体降饱和、降对比。
- 保留 --bg(亮 #f5f7ff / 暗 #020617)与 --accent(light-dark(#2563eb, #22d3ee))固定值;test/web/theme.test.tsx 契约不变。
- 范围:web/src/reference.css、web/src/styles.css、web/src/timeline/timeline.css、web/src/timeline/timeline-client.mjs、web/dist、provenance/webui-reuse.json。
- 非目标:401 认证页(src/service/auth-page.ts)不动;不新增依赖;除色板 token 化外不改行为、标记或类名;不推送、不部署。

## Acceptance
- bun run verify 全绿:theme 测试(固定值、AA 对比矩阵、token-only 规则)、web unit/SSR、web build check(dist 与源码一致)、pack audit。
- 明暗两套同等完成度:全部所列表面属于同一玻璃设计语言;代码/工具输出长文在近不透明底上可读。
- ≤900px 窄屏模糊降档且布局不破;backdrop-filter 不可用时玻璃面回退为不透明底且可读。
- 键盘焦点、禁用、错误状态在所有交互表面清楚可辨。
- 时间线色板随明暗两方案变化,同一工具恒同色。

## Assumptions (confirmed by approval)
- node_modules 按用户批准从原 checkout 符号链接进 candidate 与各工作树;不下载、不安装。
- 时间线保留现有"同一工具恒同色"的色相分配,仅变为 theme-aware。
- web/dist 由规范构建器重新生成,provenance/webui-reuse.json 受影响哈希随本次交付刷新,上游 source/license pins 保留。
- 交付环境具备 PATH 上的 bun 与带 TypeScript type stripping 的 Node(verify 前置)。

## Tasks
### webui-glass-restyle: 重设 WebUI 明暗玻璃设计语言
Depends on: none
Writes: web/src/reference.css, web/src/styles.css
Reads first: investigation d30df91c-a3e5-43fd-8991-93df914e116d — 12 处玻璃表面与 token 归属的完整地图; investigation 3c51dfd3-fce8-40ca-8e15-a56f326056bd — 精确 token 现值与 theme 测试的解析器/固定断言/对比矩阵; engineering/clients.md § Browser — 主题契约的文档描述,改后须仍成立
实现已批准的统一玻璃重设。已批准决定:(1) 三档玻璃——外壳(.topbar/.statusbar/.chat-composer/.action-dialog/.model-popover/.more-menu-items/.panel-drawer)强玻璃;内容卡(.toolcall/.thinking/.receipt/.run-summary/.scm-file/.card/.workflow-line/.workflow-plan)轻玻璃:更高不透明度 + 更弱模糊;密集阅读面(.codeblock 代码块、.termline 终端、工具输出 pre、.scm-diff-* diff)保持/改为稳定近不透明底。明暗两套同等完成度。(2) 模糊:外壳 24px、内容卡 12px、密集阅读面不模糊;@media (max-width: 900px) 外壳降 12px,内容卡进一步减弱或移除。(3) 背景:保留 body::before mesh + body::after 48px 网格,将 --mesh-a/b/c 与 --grid-line 整体降饱和、降对比,让玻璃有依托但不抢文字。(4) 保留 --bg 与 --accent 精确值;test/web/theme.test.tsx 契约不得变更。(5) 交互状态:统一且清楚可辨的 :focus-visible 焦点环、hover、active、disabled、error 处理,覆盖 chips、tb-tab、buttons、inputs、switches、dialogs、popovers、mention-menu;保留现有 prefers-reduced-motion 守卫。精修 --shadow-1/2/3 与 --glass-shadow 得到克制、高级的景深;玻璃边框/高光保持细腻。约束:所有 scheme 相关颜色写入现有 :root 块的 light-dark() 对(两空格缩进、分号结尾、暗侧 6 位 hex 或扁平 rgba——测试解析器严格);:root 之外不得出现字面颜色(token-only 规则,现有两个白名单模式除外);保持 >100 token、>90 light-dark 对;12 处 @apply backdrop-blur-xl 按档替换;新增 @supports not (backdrop-filter: blur(1px)) 回退,玻璃面在不支持时变不透明且文字可读。不改行为、标记、类名;不碰 web/src/timeline/*、src/service/auth-page.ts、任何测试。

### timeline-theme-tokens: 运行轨迹时间线色板 theme 化
Depends on: none
Writes: web/src/timeline/timeline.css, web/src/timeline/timeline-client.mjs
Reads first: investigation be45a721-6776-4c67-a19a-6061bcee5134 — 时间线固定色板、内联注入点与过期回退的完整清单; investigation d30df91c-a3e5-43fd-8991-93df914e116d — 共享 token 与玻璃语言归属,确保时间线引用正确的 token 名
让运行轨迹时间线的固定色板随明暗主题变化。现状:web/src/timeline/timeline-client.mjs 注入固定 hex 内联样式(TOOL_PALETTE 10 色、TOOL_FIXED read/write/bash 三色、MODEL_COLORS thinking/text、error 色);web/src/timeline/timeline.css 有固定 lane 色(#64748b/#3b82f6/#22c55e)、#fff 选中描边、黑 alpha 阴影、以及过期暗色回退(如 var(--accent, #8b5cff) 的紫罗兰旧值)。做法:把色板定义为 light-dark() 自定义属性(写在 timeline.css 的 :root 或复用主 sheet 共享 token 如 --accent/--red/--green/--glass-*),颜色尽量由 CSS 类/token 驱动而非内联 hex;JS 必须按工具取色时保留稳定编码——同一工具在两套方案下恒同色相,仅按方案调整明度/alpha 保证对比。时间线的边框、阴影、选中描边、面板底与共享玻璃语言对齐(引用主 sheet token)。保持 ≤640px 移动适配与 hover:none 触控目标行为不变。不碰 web/src/reference.css、web/src/styles.css、测试或其他文件。

### publish-dist-provenance: 重发 web/dist 并刷新 provenance 哈希
Depends on: webui-glass-restyle, timeline-theme-tokens
Writes: web/dist, provenance/webui-reuse.json
Reads first: engineering/verification.md § Builds and packaging — 规范构建器、dist 陈旧性与 provenance 刷新规则; investigation a74936d8-8f08-4ad8-8a43-b73b2770ea0e — web/dist 入库事实、构建器双构建机制与 provenance 耦合
从重设后的源码重发已入库的 web 构建并刷新 provenance pins。运行 `bun run build:web`(包脚本调用规范 Node 构建器 node scripts/build-web.mjs:在继承的私有临时根下做两次可复现构建并发布到 web/dist)。随后更新 provenance/webui-reuse.json:刷新已变更 web/src 文件的 source 哈希与已变更 web/dist 资产的 destination 哈希(含 manifest.json 与 CSS 资产),保留全部上游 source/license pins 与历史条目;不得手改其他生成字节。完成后用 `bun run build:web:check` 确认 dist 与源码一致。

## Setup (explicitly authorized commands)
Execution order: target once before worktree creation, candidate once, then worktree in the candidate and every detached child; listed order within each stage. Each command is a separate process; exports do not persist.
[worktree] link-node-modules: [ -e node_modules ] || ln -s /home/mirako/.cache/cadence/tmp/engineering.7j3WyGby/acceptance/node_modules node_modules (no timeout)

## Baseline verification
verify-baseline: bun run verify (900000ms)

## Verification
verify: bun run verify (900000ms)

## Review reads first
investigation d30df91c-a3e5-43fd-8991-93df914e116d — 主题架构:12 处玻璃表面、token 归属、blur 站点清单
investigation 3c51dfd3-fce8-40ca-8e15-a56f326056bd — 精确 token 值与 theme 测试契约(固定断言、对比矩阵、token-only 规则)
engineering/clients.md § Browser — WebUI 主题契约,改后必须仍然成立

## Automation boundary
After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. No dependency installation beyond the setup commands listed here. Only actual verification and independent Agent review permit delivery. Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and serialized fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Independent conversations may implement in separate candidates; a verified non-overlapping sibling delivery may be merged into this candidate and checked/reviewed again. Conflicts, changed instructions, overlapping inputs or external target drift retain the candidate for a fresh plan. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue. No push, publication, deployment or recursive delegation. Related project knowledge and workflow Markdown are included. Worktrees/tools are not a sandbox.

## Project documents
engineering/clients.md
```
