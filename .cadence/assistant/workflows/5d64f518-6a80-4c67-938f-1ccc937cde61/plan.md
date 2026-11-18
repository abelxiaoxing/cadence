# Workflow plan

```text
# 修正 WebUI 顶栏“更多”弹层（.more-menu-items）的视觉验收问题：亮/暗两套主题下给该弹层清晰、稳定、近不透明的文字衬底（真实 Chromium 1360×900、右侧 Files 选中 package.json 时不再透出下层 Branches/目录名/图标并与“Refresh status”等文字重叠），保留其克制玻璃边框、阴影、backdrop-filter 与窄屏/无模糊回退；其余已交付玻璃表面与交互行为一律照旧。随改动经规范构建器再生 web/dist 并刷新必要 provenance 哈希，本地合入 acceptance/glass。

## Initial route (the service may revise it)
单任务局部修正：1) 在 web/src/reference.css 的 :root 块（--menu-bg 旁，157 行）按两空格格式新增近不透明 token --menu-solid-bg: light-dark(rgba(255, 255, 255, 0.97), rgba(15, 23, 42, 0.96))；2) web/src/styles.css 的 .more-menu-items 规则（5077 行起）只把 background 从 var(--menu-bg) 改为 var(--menu-solid-bg)，border/box-shadow/backdrop-filter 等不动；3) bun run build:web 规范重建并发布 web/dist；4) 仅刷新 provenance/webui-reuse.json 中字节变化的 destinations SHA-256（两个 CSS 源 + cadence.css + manifest.json 等实际变化项），保留 sources 上游 pin 与 revisions 历史；5) bun run build:web:check 与 bun run verify 验收。

## Decisions
- 只改 .more-menu-items 的衬底；.action-dialog 与 .model-popover 继续用 --menu-bg，--menu-bg 定义本身不变，顶栏/状态栏/面板/输入框等其余玻璃表面照旧。
- 保留 .more-menu-items 的玻璃边框（--glass-border）、阴影（--shadow-2）、backdrop-filter: blur(var(--glass-shell-blur))、@supports not (backdrop-filter) 的 --bg-elev 回退块和 ≤900px 模糊降档。
- 不改任何 JS/标记/交互行为（AppShell.tsx 等不动）。
- 不下载、不安装、不推送、不部署、不改账户配置；node_modules 复用原 checkout 的符号链接入口（checkout 相对路径 node_modules，已核对为 symlink）链入 candidate 与工作树，不复制不安装。
- 交付为 local-merge，目标分支 acceptance/glass（当前隔离分支，HEAD 32e41d8b）。

## Acceptance
1. reference.css :root 新增 --menu-solid-bg（两空格 light-dark 格式，亮色 alpha ≥0.95、暗色 alpha ≥0.95）；.more-menu-items 的 background 使用该 token；--menu-bg 定义及 .action-dialog/.model-popover 用法不变。
2. .more-menu-items 的边框、圆角、阴影、backdrop-filter 与 @supports 回退块、≤900px 降档规则保持不变；无 JS/标记改动。
3. web/dist 由规范构建器发布，bun run build:web:check 通过。
4. provenance/webui-reuse.json 的 destinations 与磁盘文件哈希一致（service-package 测试通过），sources 上游 pin 与 revisions 历史不变；package-members.json 不变。
5. bun run verify 全绿。

## Assumptions (confirmed by approval)
node_modules 以符号链接从原 checkout 的既有入口 /home/mirako/.cache/cadence/tmp/engineering.7j3WyGby/acceptance/node_modules（已核对为 symlink）复用进 candidate 与工作树，不复制不安装；原 checkout 工作树中无关的脏文件不影响隔离候选；近不透明具体取亮 0.97/暗 0.96，实现时可在 alpha ≥0.95 内微调。

## Tasks
### more-menu-solid-substrate: More 菜单近不透明衬底 + 规范 dist/provenance 刷新
Depends on: none
Writes: web/src/reference.css, web/src/styles.css, web/dist, provenance/webui-reuse.json
Reads first: investigation e247329c-678f-4c0b-97c5-3ceb774dcf98 — 弹层表面精确清单：--menu-bg 定义与全部消费者、.more-menu-* 选择器行号、@supports 回退块、主题测试解析约束（新 HEAD 上两源文件 digest 已复核一致）; .cadence/knowledge/web-theme-tokens.md — 新共享玻璃 token 的归属位置与 :root 两空格解析格式契约; engineering/verification.md § Builds and packaging — 规范 build:web 发布流程与 provenance destinations 刷新规则
背景：WebUI 顶栏“更多”下拉菜单 .more-menu-items 的衬底过透（var(--menu-bg) → var(--glass-bg) = 亮 rgba(255,255,255,0.66)/暗 rgba(15,23,42,0.62)），真实 Chromium 1360×900 下透出下层内容并与菜单文字重叠。产品取舍已定：该弹层要清晰、稳定、近不透明的文字衬底，保留克制玻璃边框/阴影与窄屏回退，其余表面照旧。

步骤：
1. web/src/reference.css 的 :root 块中，紧邻 --menu-bg: var(--glass-bg);（157 行）新增一行 token，沿用该 sheet 的两空格声明格式：--menu-solid-bg: light-dark(rgba(255, 255, 255, 0.97), rgba(15, 23, 42, 0.96));（alpha 可在 ≥0.95 内微调）。
2. web/src/styles.css 的 .more-menu-items 规则（规则 5077 行起，background 声明 5086 行）：仅把 background: var(--menu-bg); 改为 background: var(--menu-solid-bg);；该规则的 border、border-radius、box-shadow、backdrop-filter 及其余声明一律不动。
3. 禁止改动：--menu-bg 的定义；.action-dialog（styles.css 约 2207 行）与 .model-popover（约 4874 行）对 --menu-bg 的用法；@supports not (backdrop-filter: blur(1px)) 回退块（约 5394 行起，含 .more-menu-items → --bg-elev）；≤900px 的 --glass-shell-blur 降档；任何 JS/标记文件（AppShell.tsx 不动）。
4. 运行 bun run build:web 规范重建并发布 web/dist（包脚本走 Node 构建器；不得手改生成物）。
5. 刷新 provenance/webui-reuse.json 中字节变化的 destinations SHA-256（至少 web/src/reference.css、web/src/styles.css、web/dist/assets/cadence.css、web/dist/manifest.json；用 sha256sum 重算全部实际变化的 destination 条目）。顶层 sources 上游 pin 与 revisions 历史保持原样；package-members.json 不变（无成员变化）。
6. 自检：bun run build:web:check 通过。

约束：不下载、不安装；node_modules 已由 setup 符号链接就绪；不改动无关字节。

## Setup (explicitly authorized commands)
Execution order: target once before worktree creation, candidate once, then worktree in the candidate and every detached child; listed order within each stage. Each command is a separate process; exports do not persist.
[worktree] link-node-modules: [ -e node_modules ] || ln -s /home/mirako/.cache/cadence/tmp/engineering.7j3WyGby/acceptance/node_modules node_modules (no timeout)

## Baseline verification
build-web-check-baseline: bun run build:web:check (no timeout)

## Verification
build-web-check: bun run build:web:check (no timeout)
verify: bun run verify (no timeout)

## Review reads first
investigation e247329c-678f-4c0b-97c5-3ceb774dcf98 — 弹层表面精确清单，用于核对改动是否只落在 .more-menu-items 与必要生成物上（新 HEAD 上两源文件 digest 已复核一致）
.cadence/knowledge/web-theme-tokens.md — 新 token 的位置与格式契约
.cadence/knowledge/provenance-pins.md — destinations 与 sources pin 的语义，核对哈希刷新范围
engineering/verification.md § Builds and packaging — 规范构建产物与 provenance 刷新规则

## Automation boundary
After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. No dependency installation beyond the setup commands listed here. Only actual verification and independent Agent review permit delivery. Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and serialized fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Independent conversations may implement in separate candidates; a verified non-overlapping sibling delivery may be merged into this candidate and checked/reviewed again. Conflicts, changed instructions, overlapping inputs or external target drift retain the candidate for a fresh plan. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue. No push, publication, deployment or recursive delegation. Related project knowledge and workflow Markdown are included. Worktrees/tools are not a sandbox.

## Project documents
No existing document is named for update; project knowledge is still read.
```
