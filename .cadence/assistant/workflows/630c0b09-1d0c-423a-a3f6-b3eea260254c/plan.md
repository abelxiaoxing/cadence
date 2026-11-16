# Workflow plan

```text
# 让 Cadence owner 与 workbench gateway 的普通 / 与 /app 不再每次必须加 /?token：未认证显示无脚本口令页，正确口令 POST 登录设置一年期 HttpOnly SameSite=Strict Cookie，同浏览器同址 token 未变时刷新/重开浏览器/服务同址重启均免重输；错误口令返回空表单与中性提示，token 轮换与无效 Cookie 在 HTML/JSON 401 中均清除；旧 token 链接兼容、Host/Origin/CSRF/native capability、资源与停机保护保留。同时修复两处基线夹具（长路径 Unix socket、继承宿主 cgroup 的 CLI 测试），使 bun run verify 通过。本地交付到当前测试分支，不推送、不发布。

## Initial route (the service may revise it)
入口改造（src/service/http.ts、src/service/gateway.ts、src/service/auth.ts、新增 src/service/auth-page.ts）：
- 未认证 GET / 与 GET /app → 401 HTML 无脚本口令页（新 auth-page.ts 渲染）；该响应是唯一携带 Referrer-Policy: same-origin 的响应（覆盖 fixedHeaders 的 no-referrer），使 Firefox 原生表单送出有效 Origin。
- 口令页：原生 form method=post action=/auth；password 输入 autocomplete=current-password，无 value 回填、无 script/内联事件/localStorage/sessionStorage；隐藏 next 字段（清洗后入口，默认 /app）；?auth_error=1 时显示中性提示（错误口令/轮换/失效同措辞）。
- POST /auth（owner 与 gateway 同构，无既有路由冲突）：requestBoundary（loopback + Host 精确）+ Origin 必须存在且精确相等，缺失/null/外部 → 403，不信任 Sec-Fetch-*；口令比对当前 token。成功 → Set-Cookie（名不变 cadence_<workspaceId>/cadence_<registration.id>，值当前 token，Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000）+ 303 到清洗后 next；失败 → 303 /?auth_error=1（不设置新 cookie），请求携带的无效 Cookie 一并 Set-Cookie Max-Age=0 清除。
- 无效或已轮换 Cookie → 401：Accept text/html → 口令页，否则 JSON {kind:"error",error}；两者均 Set-Cookie Max-Age=0 清除。
- 认证后 GET / → 303 /app（删除 200 text/plain 旧帮助）；认证后 /app 行为不变（gateway 保留 /app?project=<64hex>）。
- next 清洗：仅同源绝对路径，拒 //、\、控制字符，剥离 token 与 auth_error 参数，默认 /app，绝不外部跳转。
- /?token=[redacted] legacy bootstrap 兼容保留，且与 POST 登录一致使用一年期持久 Cookie（同一新常量）；显式错 token 拒绝语义保留。
- worker-public.mjs + worker-public.d.mts 新增独立的一年期 Cookie 期限常量（31536000s）；browserLifetimeMs 不动（http.ts:591 viewer 驱逐仍在用）；public health 保持公开。
- 用 package.json 的 canonical builders 生成全部实际受影响的 service/operator/native/Web 输出（含 src/service-host.mjs、src/service-cli.mjs），不手写 bundle；provenance/package-members.json 是经审查的打包成员策略，只在实际需要时基于源码更新相关条目/hash，不根据待审包反向生成。
测试：Vitest 定向运行（bun run test:target <files>）；更新 test/service-auth.test.ts（364-371 public health/entry 断言适配新 401 口令页 + 新增 cookie 流程断言）；新增 test/gateway-login.test.ts（进程内 fast，参照 gateway-availability.test.ts 风格）。最终唯一 gate bun run verify。
基线夹具：test/research-tools.test.mjs 改寻址（子进程 cwd=长临时目录、相对名 socket 绑定以绕开 107 字符 sun_path 限制，拒绝断言仍用长绝对路径，资源留在继承 TMPDIR）；test/service-autostart.test.ts 控制真实 CLI 使用的 hostSystem/manager/cgroup 适配边界（按既有测试模式调用真实 managementMain 注入受控 hostSystem，或等效隔离实现），保留 inside-service 真实拒绝断言。
基线检查：仅验证原始 HEAD 精确等于 8d0044f0d06f7d89c9be10d7f5a52096f3197499 与 tracked/untracked 洁净；不在原始基线跑整套 verify；组合候选执行完整 bun run verify 与独立 Agent review。
文档：docs/remote-access.md、docs/service-management.md、engineering/clients.md（107-108）仅记录源码支持的事实。

## Decisions
已确认决定：
- 两入口 / 与 /app 未认证 → 401 无脚本口令页；POST 登录成功设 31536000s HttpOnly SameSite=Strict cookie + 303；错误口令 → 303 /?auth_error=1 → 空表单 + 中性提示（与轮换同措辞）；认证后 GET / → 303 /app（删旧帮助）。
- 一年期为默认 Cookie 期限：新 POST 登录与必要旧 token 链接 bootstrap 都使用一年持久 Cookie（同一独立新常量），不设“旧链接仅 12 小时”的产品分歧；browserLifetimeMs（浏览器 viewer 生命周期）保持不变；认证与 legacy 显式错 token 拒绝语义保留。
- 无效/轮换 Cookie 在 HTML 与 JSON 401 中均 Set-Cookie Max-Age=0 清除。
- 严格 Origin：POST /auth 要求 Origin 存在且精确相等，缺失/null/外部均 403，不信任 Sec-Fetch-*；401 口令页是唯一 Referrer-Policy: same-origin 响应（使真实 Firefox 原生表单工作）。
- next 规范化：仅同源，拒 //、\、控制字符，剥离 token/auth_error，默认 /app。
- public health 保持公开；native capability、CSRF（mutation 精确 Origin + x-cadence-csrf）、自停保护语义不变。
- 口令不得进入 localStorage、页面回填或请求 URL。
- 测试运行器为 Vitest；Worker 定向命令为 bun run test:target <files>（不用 bun test，避免误跑 slow 标记的真实 CLI 测试）；最终唯一 gate bun run verify；不扩大测试超时、不调整 slow 标签、不过滤失败断言。
- 基线只验证原始 HEAD 精确等于 8d0044f0d06f7d89c9be10d7f5a52096f3197499 与受控目标/候选初始 tracked/untracked 洁净（获批忽略的 node_modules 链接不误报）；已知 socket 夹具会在 owner TMPDIR 失败且已单列修复任务，不在修复前用整套 verify 作基线；不声称原始项目已通过功能检查；组合候选始终执行完整 bun run verify 与独立 Agent review，最终精确候选本地交付。
- 临时位置仅 owner 分配 TMPDIR；不换 /tmp、不拷贝源码；node_modules setup 仅在链接不存在时创建指向 /home/mirako/abel/cadence/node_modules 的链接，存在且指向该目录时无操作，其它情况（含非匹配 symlink、真实目录）明确拒绝并保留、不删除/替换；源目录须存在且确认为目录；target 与 worktree 均放置；禁下载、复制依赖、profiles、凭据或旧候选源码。
- 用 package.json 的 canonical builders 生成全部实际受影响的 service/operator/native/Web 输出，不手写 bundle；provenance/package-members.json 是经审查的打包成员策略、不是 canonical build 自动生成物，只在实际需要时基于源码更新相关条目/hash，不根据待审包反向生成成员策略。
- autostart 夹具必须控制真实 CLI 使用的 hostSystem/manager/cgroup 适配边界：可按既有测试模式调用真实 managementMain 并注入受控 hostSystem，或等效隔离实现（仅改 HOME/XDG_RUNTIME_DIR/PATH 无法伪造或隔离 /proc/self/cgroup）；保留 inside-service 的真实拒绝断言，不触达生产 manager，不减弱产品保护。
- 保留真实断言与服务自停保护；本地交付当前测试分支；不推送/发布/装开机服务。
非目标：不改发布系统与未关联架构；不动 slow 标记测试；不改 rotate()/CSRF/native/停机保护的既有语义；真实浏览器与独立服务重启验收由外部测试驱动器在本地交付后执行，不属于本 gate。

## Acceptance
- 基线：原始 HEAD 精确等于 8d0044f0d06f7d89c9be10d7f5a52096f3197499，受控目标/候选初始 tracked/untracked 洁净（获批忽略的 node_modules 链接不误报）；不声称原始项目已通过功能检查。
- 组合候选上 bun run verify 通过（十阶段，含 lint、类型检查与全部非 slow 测试），并经独立 Agent review，最终精确候选本地交付。
- owner 与 gateway：未认证 / 与 /app 返回 401 无脚本口令页（无 script/回填/localStorage，Referrer-Policy: same-origin）；正确口令 POST /auth → 303 且 cookie 为 HttpOnly、SameSite=Strict、Path=/、Max-Age=31536000；/?token=[redacted] legacy bootstrap 同样设置一年期持久 cookie；错误口令 → 303 /?auth_error=1 且该页仍是空表单口令页 + 中性提示；Origin 缺失/null/外部 → 403；next 经规范化后不能成为外部跳转（//、\、控制字符、token/auth_error 参数均被拒绝/剥离，默认 /app）；无效/轮换 cookie 的 HTML 与 JSON 401 均清除 cookie；认证后 GET / → 303 /app 进入应用而非旧帮助。
- 两处基线夹具在长 TMPDIR 与隔离环境下通过（bun run test:target 定向验证），真实断言、inside-service 拒绝回归与资源留在继承 TMPDIR 均保留。
- 真实浏览器（Firefox Origin 行为）与独立服务重启验收由外部测试驱动器在本地交付后执行。

## Assumptions (confirmed by approval)
- 登录端点采用 POST /auth（研究确认无既有路由冲突），表单 action 指向它。
- 一年期 Cookie 的新常量命名由 Worker 按项目现有风格决定；browserLifetimeMs 保持不变。
- socket 夹具按研究给出的方向修复：子进程 cwd 相对名绑定（拒绝断言保留长绝对路径）；autostart 夹具按既有测试模式控制 hostSystem/manager/cgroup 适配边界（真实 managementMain 注入受控 hostSystem 或等效隔离实现）。
- node_modules 符号链接为指向 /home/mirako/abel/cadence/node_modules 的绝对链接：不存在才创建，已指向该目录则无操作，其它情况明确拒绝并保留；target 与 worktree 两处放置。
- 文档仅更新 docs/remote-access.md、docs/service-management.md、engineering/clients.md 三处源码支持的事实。

## Tasks
### login-cookie: owner 与 gateway 无脚本口令页 + 一年 Cookie 登录
Depends on: none
Writes: src/service/auth.ts, src/service/auth-page.ts, src/service/http.ts, src/service/gateway.ts, src/worker-public.mjs, src/worker-public.d.mts, src/service-host.mjs, src/service-cli.mjs, provenance/package-members.json, test/service-auth.test.ts, test/gateway-login.test.ts, docs/remote-access.md, docs/service-management.md, engineering/clients.md
Reads first: AGENTS.md — 工程约束与验证要求; docs/remote-access.md — 更新前读取现有入口/轮换事实; investigation f6c48148-a5f4-4cb8-a144-bf9522115c7c — 现有鉴权入口行号、pi-web-ui 参考实现、已确认设计决定与需改文件清单
实现 owner 与 workbench gateway 的无脚本口令页 + 一年期 Cookie 登录。先读研究记录（行号与已确认设计决定）。

只改这些文件：src/service/auth.ts、src/service/auth-page.ts（新增）、src/service/http.ts、src/service/gateway.ts、src/worker-public.mjs、src/worker-public.d.mts、src/service-host.mjs 与 src/service-cli.mjs 及其它实际受影响的 bundle（canonical builders 输出，不手写）、provenance/package-members.json（经审查的打包成员策略，仅在实际需要时基于源码更新相关条目/hash）、test/service-auth.test.ts、test/gateway-login.test.ts（新增）、docs/remote-access.md、docs/service-management.md、engineering/clients.md。

行为：
1) 未认证 GET / 与 GET /app（owner http.ts:537-542 与 514-531；gateway gateway.ts:747-751 与 1176-1182）→ 401 HTML 无脚本口令页（新 src/service/auth-page.ts 渲染）。该响应是唯一携带 Referrer-Policy: same-origin 的响应（覆盖 fixedHeaders http.ts:148-156 的 no-referrer），使 Firefox 原生表单送出有效 Origin。页面：原生 form method=post action=/auth；password 输入 autocomplete=current-password，无 value 回填、无 <script>、无内联事件、无 localStorage/sessionStorage；隐藏 next 字段（清洗后入口，默认 /app）；?auth_error=1 时显示中性提示，错误口令/轮换/失效同措辞。
2) POST /auth（owner 与 gateway 同构，研究确认无路由冲突）：requestBoundary（auth.ts:426-470，loopback + Host 精确）+ Origin 必须存在且精确相等，缺失/null/外部 → 403，不信任 Sec-Fetch-*；口令比对当前 token。成功 → Set-Cookie（名不变 cadence_<workspaceId> auth.ts:485 / cadence_<registration.id> gateway.ts:230-235，值当前 token，Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000）+ 303 到清洗后 next。失败 → 303 /?auth_error=1（不设置新 cookie）；请求携带的无效 Cookie 也 Set-Cookie Max-Age=0 清除。
3) 无效或已轮换 Cookie → 401：Accept text/html → 口令页，否则 JSON {kind:"error",error}（参照 http.ts:139-147）；两者均 Set-Cookie Max-Age=0 清除。rotate()（auth.ts:336-389）语义不变，旧 cookie 自然不再匹配。
4) 认证后 GET / → 303 /app（删除 200 text/plain 旧帮助）；认证后 /app 行为不变（gateway 保留 /app?project=<64hex>）。
5) next 清洗（参照 pi-web-ui server/auth-login.ts sanitizeNextPath）：仅同源绝对路径，拒 //、\、控制字符，剥离 token 与 auth_error 参数，默认 /app，绝不外部跳转。
6) /?token=[redacted] legacy bootstrap 兼容保留，且与 POST 登录一致使用一年期持久 Cookie（同一新常量，不再 12h）；显式错 token 拒绝语义保留。
7) worker-public.mjs 与 worker-public.d.mts 新增独立的一年期 Cookie 期限常量（命名随项目风格，31536000s）；browserLifetimeMs 不动（http.ts:591 viewer 驱逐仍在用）；public health 保持公开。
8) 用 package.json 的 canonical builders 生成全部实际受影响的 service/operator/native/Web 输出（含 src/service-host.mjs、src/service-cli.mjs；若触及其它 bundle，一并为 canonical 输出），不手写 bundle；provenance/package-members.json 是经审查的打包成员策略、不是 build 自动生成物，只在实际需要时基于源码更新相关条目/hash，不根据待审包反向生成。
9) 文档：docs/remote-access.md、docs/service-management.md、engineering/clients.md（107-108）仅更新源码支持的入口/轮换事实。

测试（Vitest；保留真实断言，不跳过、不弱化、不扩超时、不调 slow 标签、不过滤失败断言）：
- 更新 test/service-auth.test.ts：364-371 “public health/entry” 断言适配新 401 口令页；新增：401 页无脚本 + form action=/auth + Referrer-Policy: same-origin；POST 成功 cookie 属性（HttpOnly、SameSite=Strict、Path=/、Max-Age=31536000）+ 303；/?token=[redacted] legacy bootstrap 也设置一年期 cookie；错误口令 303 /?auth_error=1 且该页是空表单 + 中性提示；Origin 缺失/null/外部 → 403；next 规范化（//、\、控制字符拒绝，token/auth_error 剥离，默认 /app，不能外部跳转）；无效 cookie 的 HTML 与 JSON 401 均清除；认证后 GET / → 303 /app。
- 新增 test/gateway-login.test.ts：进程内 fast，参照 test/gateway-availability.test.ts 风格，覆盖 gateway 入口（/ 与 /app?project=）同样的核心断言，next 保留 project 参数。

约束：临时位置仅用 owner 分配的 TMPDIR；不换 /tmp、不拷贝源码；不碰 test/research-tools.test.mjs 与 test/service-autostart.test.ts（另一任务负责）；不改 rotation/CSRF/native capability/停机保护语义；口令不得进入 localStorage、页面回填或请求 URL。完成前运行 bun run test:target test/service-auth.test.ts test/gateway-login.test.ts 并保证通过（Vitest，勿用 bun test）。

### baseline-fixtures: 修复两处基线夹具（长路径 Unix socket、宿主 cgroup CLI 测试）
Depends on: none
Writes: test/research-tools.test.mjs, test/service-autostart.test.ts
Reads first: AGENTS.md — 测试与临时目录约束; investigation f6c48148-a5f4-4cb8-a144-bf9522115c7c — 两处夹具的行号、失败机理与既定修复方向
修复两处基线夹具，使 bun run verify 在隔离目标上（长 owner TMPDIR、宿主 systemd 环境）通过。先读研究记录（行号与失败机理）。

1) test/research-tools.test.mjs（19、99-113）：现状 join(mkdtemp(join(tmpdir(),'pi-observe-')),'socket') + server.listen(path)，owner TMPDIR 很长时（前次实测 2650 字节 TMPDIR、2669 字节 socket 路径）超 107 字符 sun_path 限制导致 listen 失败。修复寻址/引用：子进程 cwd 设为该长临时目录，用相对名 socket 绑定；原“拒绝”断言仍使用长绝对路径（其失败/拒绝即断言内容）；资源留在继承的 TMPDIR。不换 /tmp、不拷贝源码、保留真实断言。
2) test/service-autostart.test.ts 的 server()（1041-1056）：现状 spawn 真实 CLI 并继承 process.env，会触达真实 systemctl --user、/run/user/1000 与生产 cadence.service，且测试/CLI 继承宿主会话 cgroup。修复目标：控制真实 CLI 使用的 hostSystem/manager/cgroup 适配边界——可按既有测试模式调用真实 managementMain 并注入受控 hostSystem，或采用等效隔离实现；注意仅改 HOME/XDG_RUNTIME_DIR/PATH 无法伪造或隔离 /proc/self/cgroup，不得据此声称隔离。保留 inside-service 的真实拒绝断言（cli.ts:919-925，maintenance.ts:55-63 对比 autostart.ts:119-124），不触达生产 manager，不减弱产品保护。

约束：只改这两个文件；临时位置仅用 owner 分配的 TMPDIR；不碰 auth 代码与其它测试；不扩超时、不调 slow 标签、不过滤失败断言。完成前运行 bun run test:target test/research-tools.test.mjs test/service-autostart.test.ts 并保证在长 TMPDIR、无真实 systemd 交互下通过（Vitest，勿用 bun test）。

## Setup (explicitly authorized commands)
Execution order: target once before worktree creation, candidate once, then worktree in the candidate and every detached child; listed order within each stage. Each command is a separate process; exports do not persist.
[target] link-node-modules-target: node -e 'const fs=require("node:fs"),path=require("node:path");const link=path.resolve(process.cwd(),"node_modules"),target="/home/mirako/abel/cadence/node_modules";let st;try{st=fs.statSync(target)}catch(e){console.error("missing node_modules source "+target);process.exit(1)}if(!st.isDirectory()){console.error("node_modules source is not a directory: "+target);process.exit(1)}let cur;try{cur=fs.lstatSync(link)}catch(e){if(e.code!=="ENOENT")throw e}if(cur){let same=false;if(cur.isSymbolicLink()){try{same=fs.realpathSync(link)===fs.realpathSync(target)}catch(e){same=false}}if(same)process.exit(0);console.error("refusing to touch existing node_modules (not a valid symlink to "+target+")");process.exit(1)}fs.symlinkSync(target,link)' (no timeout)
[worktree] link-node-modules-worktree: node -e 'const fs=require("node:fs"),path=require("node:path");const link=path.resolve(process.cwd(),"node_modules"),target="/home/mirako/abel/cadence/node_modules";let st;try{st=fs.statSync(target)}catch(e){console.error("missing node_modules source "+target);process.exit(1)}if(!st.isDirectory()){console.error("node_modules source is not a directory: "+target);process.exit(1)}let cur;try{cur=fs.lstatSync(link)}catch(e){if(e.code!=="ENOENT")throw e}if(cur){let same=false;if(cur.isSymbolicLink()){try{same=fs.realpathSync(link)===fs.realpathSync(target)}catch(e){same=false}}if(same)process.exit(0);console.error("refusing to touch existing node_modules (not a valid symlink to "+target+")");process.exit(1)}fs.symlinkSync(target,link)' (no timeout)

## Baseline verification
baseline-head-identity: test "$(git rev-parse HEAD)" = "8d0044f0d06f7d89c9be10d7f5a52096f3197499" (no timeout)
baseline-clean-tree: test -z "$(git status --porcelain)" (no timeout)

## Verification
verify: bun run verify (1800000ms)

## Review reads first
investigation f6c48148-a5f4-4cb8-a144-bf9522115c7c — 现有鉴权入口行号与机制、pi-web-ui 参考、已确认设计决定、需改文件清单、两处基线夹具失败机理
AGENTS.md — 工程约束、测试与验证要求
docs/remote-access.md — 入口与轮换事实的现有文档，核对更新只记录源码支持的事实

## Automation boundary
After approval the service works to completion without further confirmation. It may on its own: retry and repair a failed assignment; revise the route, the assignments and their order; and bring further repository files into the write scope (never credentials, keys, .env, .git or files outside the repository). When an acceptance item or decision proves impossible it delivers the closest achievable result as a recorded deviation, which names the item, the evidence and what was delivered instead, must be confirmed necessary and minimal by the independent Agent review, and leads the final report. Declared checks always run; a check is set aside only through such a deviation, never silently. At the end it maintains the project's knowledge store under .cadence/ within its fixed budget, adding what this delivery taught and removing what went stale, when a fast-forward can carry it. It stops only for a condition outside the repository: an unavailable model, failed authentication, storage or permission limits, a target branch changed from outside, or a required installation this agreement does not allow. No dependency installation beyond the setup commands listed here. Only actual verification and independent Agent review permit delivery. Authorize one new named task branch and stable isolated worktree after approval, temporary worktrees beside it for assignments that run side by side, local commits and fast-forward delivery of the exact checked and Agent-reviewed candidate into the displayed target. Keep the task branch; retain any worktree with uncommitted, untracked or ignored residue. No push, publication, deployment or recursive delegation. Related project knowledge and workflow Markdown are included. Worktrees/tools are not a sandbox.

## Project documents
docs/remote-access.md
docs/service-management.md
engineering/clients.md
```
