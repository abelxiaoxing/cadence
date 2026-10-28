/** Simplified Chinese for the WebUI. Keys are the English source text, which
 * stays the default and the fallback; `{name}` marks an interpolated value.
 * Error codes, identifiers, commands and recorded content are never translated. */
export const zh = {
  // Dual conversation workbench
  "Task created, but its conversation link was not confirmed.":
    "任务已创建，但与普通对话的关联尚未确认。",
  "Workbench projects": "工作台项目",
  "Your workbench, your projects": "你的工作台，你的项目",
  "No default workspace is created. Open an existing folder to use ordinary conversations and Cadence tasks.":
    "不会创建默认工作区。打开已有文件夹，即可使用普通对话和 Cadence 任务。",
  "Opening a project never starts a task. Switching projects keeps admitted work running in its original directory.":
    "打开项目不会启动任务。切换项目后，已接纳的工作仍在原目录中继续。",
  "Selected project is unavailable. Choose a project explicitly; no directory was reconstructed.":
    "所选项目不可用，请明确选择项目；未重建任何目录。",
  "No projects associated yet.": "尚未关联任何项目。",
  "Chat ready": "可以开始对话",
  "Conversation capture limit exceeded.": "对话记录已达到容量上限。",
  "Start a new conversation; incomplete context is not replayed.":
    "请新建对话；不会重放不完整的上下文。",
  "Current metadata unavailable; showing the active turn only. No state was reconstructed.":
    "当前对话元数据不可用，仅显示仍在运行的轮次，未重建任何状态。",
  "Send unavailable. Check the message limit (16 KiB); observe any pending command before sending again.":
    "暂时无法发送。请检查消息是否超过 16 KiB；如有待确认的命令，请先观察其结果，不要重复发送。",
  Files: "文件",
  "File list": "文件列表",
  "Workspace panels": "工作区面板",
  "Task details": "任务详情",
  "Switch working folder": "切换工作文件夹",
  "Open working folder": "打开工作文件夹",
  "Open this project": "打开此项目",
  "Opening project…": "正在打开项目…",
  "Folder path": "文件夹路径",
  Browse: "浏览",
  "Parent folder": "上级文件夹",
  "Choose a folder on the service host. Opening reuses or starts that project's independent service; current work keeps running.":
    "选择服务所在主机上的文件夹。打开时将复用或启动该项目的独立服务，当前工作会继续运行。",
  "New conversation": "新对话",
  Ordinary: "普通对话",
  "Ordinary conversation": "普通对话",
  "Cadence task": "Cadence 任务",
  "Conversation mode": "对话模式",
  "Back to ordinary conversation": "返回普通对话",
  "What would you like to work on?": "今天想做些什么？",
  "Chat normally, or start with /cadence to prepare a task. Nothing starts until you send.":
    "直接聊天，或以 /cadence 开头准备任务。发送前不会启动任何工作。",
  "Message, or /cadence followed by a task…":
    "输入消息，或使用 /cadence 描述任务…",
  Message: "消息",
  Send: "发送",
  "Stop response": "停止回复",
  "Prepare task": "准备任务",
  "Prepare a plan first; Start requires confirmation.":
    "先准备计划，执行需另行确认 Start。",
  "Direct host tools · no Cadence task":
    "直接使用主机工具 · 不创建 Cadence 任务",
  "Conversation turn": "对话轮次",
  You: "你",
  Tool: "工具",
  "Earlier messages": "较早的消息",
  "Latest messages": "最新消息",
  "Send outcome not yet observed:": "尚未观察到此次发送的结果：",
  "Observe this send before sending again. No automatic retry.":
    "请先观察此次发送的结果，不会自动重试。",
  "This turn has no complete continuation context. Start a new conversation; retained messages are preserved.":
    "此轮没有完整的续聊上下文。请新建对话，已记录的消息会保留。",
  Subagents: "子代理",
  "Subagent roster unavailable": "暂时无法观察子代理列表",
  "Cadence subagents appear here when a task runs.":
    "Cadence 任务运行时，子代理会显示在这里。",
  "Refresh files": "刷新文件",
  "Reference {path}": "引用 {path}",
  "Copy path {path}": "复制路径 {path}",
  "No visible files": "没有可显示的文件",
  "Close preview": "关闭预览",
  "Bounded listing; narrow the directory to see more.":
    "列表已达到显示上限，请进入更具体的目录查看。",
  "File preview is limited; this is not the complete file.":
    "文件预览已截断，并非完整内容。",
  "Readonly preview · references send paths, not file contents":
    "只读预览 · 引用只发送路径，不自动注入文件内容",
  "Hidden thinking, signatures and media are not retained.":
    "隐藏思考、签名和媒体内容不予保留。",
  // Document and fallback page
  "Cadence task workspace": "Cadence 任务工作区",
  "Presentation unavailable": "界面无法显示",
  "No execution result is inferred. Reconnect to observe the owner; accepted work continues.":
    "不会推断任何执行结果。重新连接以观察所有者服务；已接受的工作会继续进行。",
  "Reload observation": "重新加载观察",

  // Conversation-first workspace
  "Build information": "构建信息",
  Conversation: "对话",
  Details: "详情",
  "Back to task": "返回任务",
  "Task {id}": "任务 {id}",
  "{kind} {id}": "{kind} {id}",
  Subagent: "子代理",
  "Recorded conversation": "已记录对话",
  "Recording details": "记录信息",
  "Field details": "原文与复制",
  "New activity — update conversation": "有新动态 · 更新对话",
  "No retained conversations on this page.": "本页没有已保留的对话。",
  "Recent projects": "最近项目",
  "This service exposes one project. Opening it never starts work.":
    "当前服务连接一个项目，打开项目不会启动执行。",
  "Running conversations": "运行的对话",
  "Conversation history": "历史对话",
  "Task conversations": "任务对话与子代理",

  // Topbar, drawers and statusbar
  Tasks: "任务",
  "Recorded views": "已记录视图",
  messages: "消息",
  tools: "工具",
  context: "上下文",
  timeline: "时间线",
  runs: "运行",
  outcomes: "结果",
  "Export selected scope": "导出所选范围",
  "Copy token-free link": "复制不含令牌的链接",
  "Link copy unavailable.": "无法复制链接。",
  "Observe current state": "重新观察当前状态",
  "Choose owner model": "选择所有者模型",
  Model: "模型",
  "Return — work continues": "返回——工作继续",
  "Return — accepted work continues": "返回——已接受的工作会继续",
  Return: "返回",
  "Plan / review": "计划 / 审阅",
  Plan: "计划",
  "Execution and cancellation": "执行与取消",
  "Open active task": "打开活动任务",
  "Cancel run — request stop": "取消运行——请求停止",
  "{message}.": "{message}。",
  "Context changed. Observe again and request a fresh confirmation.":
    "上下文已变化。请重新观察并请求新的确认。",
  "Explicit service guidance: {status} / {start}. No service is started by this page.":
    "显式服务操作：{status} / {start}。本页面不会启动任何服务。",
  "Close drawer": "关闭抽屉",
  "Task navigation drawer": "任务导航抽屉",
  "Plan and review drawer": "计划与审阅抽屉",
  "Selected {kind}:": "已选{kind}：",
  "· snapshot {seq}.": "· 快照 {seq}。",
  "Pages and old outcomes are historical observations, not renewed consent.":
    "分页内容和旧结果是历史观察，不代表重新授权。",
  "Open a task or create one explicitly": "打开一个任务，或显式创建一个",
  "Plans, children, checks and human review share one service owner. No chat or discovery activates execution.":
    "计划、子运行、检查和人工审阅共用一个服务所有者。聊天或浏览不会触发执行。",
  "Create task": "创建任务",
  "No owner run projection in this snapshot.": "此快照中没有所有者运行视图。",
  "No snapshot observed yet; absence is not proof of settlement.":
    "尚未观察到快照；没有记录不代表已结束。",
  "Connection freshness is not execution outcome.":
    "连接是否最新不代表执行结果。",
  " · transport {status}": " · 传输：{status}",
  "{count} active run": "{count} 个活动运行",
  "{count} active runs": "{count} 个活动运行",
  "No active runs": "没有活动运行",
  "Active roster unavailable; absence is not proof of settlement.":
    "活动运行列表不可用；没有记录不代表已结束。",
  "unbuilt source": "未构建的源码",
  "Local browser build: {build}.": "本地浏览器构建：{build}。",
  "Shared compatibility: {state}.": "共享兼容性：{state}。",
  compatible: "兼容",
  "unavailable / mismatch — reload built assets; normal actions disabled":
    "不可用 / 不匹配——请重新加载构建产物；常规操作已禁用",
  "Service unavailable": "服务不可用",
  "Task snapshot not observed yet": "尚未观察到任务快照",
  "No task selected": "未选择任务",
  "Resize left pane": "调整左侧面板宽度",
  "Resize right pane": "调整右侧面板宽度",

  // Detached page and app notices
  Detached: "已断开",
  "Accepted service work continues. No Cancel was requested.":
    "已接受的服务工作会继续进行。没有请求取消。",
  "Observe command after reconnect:": "重新连接后观察命令：",
  "Reconnect as a viewer": "以查看者身份重新连接",
  "Current action context unavailable; observe again.":
    "当前操作上下文不可用；请重新观察。",
  "Preflight refused: {code}": "预检被拒绝：{code}",
  "Preflight unavailable. No automatic retry.": "预检不可用。不会自动重试。",
  "Stop requested; settlement is not yet confirmed.":
    "已请求停止；尚未确认结束。",
  "{code}; cancellation effect {effect}. Observe exact receipt.":
    "{code}；取消效果 {effect}。请观察确切回执。",
  "Cancellation effect uncertain. Observe exact receipt.":
    "取消效果不确定。请观察确切回执。",
  "Observation unavailable or detach unconfirmed; explicit re-entry required.":
    "观察不可用或断开未确认；需要显式重新进入。",
  "Observation unavailable.": "观察不可用。",
  "Access revoked; explicit token re-entry required.":
    "访问已被撤销；需要显式重新输入令牌。",

  // Create task dialog
  Kind: "类型",
  Code: "代码",
  "Readonly research": "只读调研",
  "Readonly diagnosis": "只读诊断",
  Goal: "目标",
  "Preview Create (does not Start)": "预览创建（不会启动）",

  // Action dialogs
  "Close dialog — no cancellation of accepted work":
    "关闭对话框——不会取消已接受的工作",
  "Close — accepted work is not cancelled": "关闭——不会取消已接受的工作",
  "Admission pending/unknown — observe this exact receipt.":
    "准入待定/未知——请观察这个确切回执。",
  "{code}; effect {effect}": "{code}；效果 {effect}",
  "Uncertain; do not repeat the action.": "结果不确定；请勿重复此操作。",
  "Confirm {action}": "确认{action}",
  "Access is not consent. This confirmation applies only to the displayed context, once.":
    "访问权限不等于同意。此确认仅对所显示的上下文生效一次。",
  Checkout: "工作副本",
  "Working directory": "工作目录",
  "Model / API / thinking": "模型 / API / 思考",
  "Check environment": "检查环境",
  "Service launch environment policy, generation {generation}; no browser environment overlays.":
    "服务启动环境策略，第 {generation} 代；不叠加浏览器环境。",
  Observation: "观察",
  "Complete within bounded scope": "在限定范围内完整",
  "Incomplete bounded coverage": "限定范围覆盖不完整",
  Expires: "过期时间",
  "Exact parent check": "确切的父级检查",
  "{name}; timeout {timeout} ms; cwd above.":
    "{name}；超时 {timeout} 毫秒；工作目录见上。",
  "Readonly proposal only. It will not save itself or dispatch editing.":
    "仅为只读提案。它不会自行保存，也不会分派编辑。",
  "Issues: {issues}": "问题：{issues}",
  "Context changed or confirmation expired. Close, observe again and request a new preview.":
    "上下文已变化或确认已过期。请关闭、重新观察并请求新的预览。",
  "Back — no new effect": "返回——不产生新效果",
  "Create {kind} task": "创建{kind}任务",
  "No Start is included.": "不包含启动。",
  "Expected: {output}": "预期产出：{output}",
  "Exact proposed graph and identities (not yet committed)":
    "确切的提议任务图与标识（尚未提交）",
  "Exact human review targets": "确切的人工审阅对象",
  "Human review only; failures, native exit, stale and not-run checks remain unchanged. Issues acknowledgment: {accepted}.":
    "仅为人工审阅；失败、原生退出、过期和未运行的检查保持不变。问题确认：{accepted}。",
  "Explicit owner-wide choice, only while quiescent. This does not resolve credentials, probe a provider, save a plan or Start work.":
    "显式的所有者级选择，仅在空闲时可用。它不会解析凭据、探测提供方、保存计划或启动工作。",
  "Current: {model}": "当前：{model}",
  "No model selected": "未选择模型",
  "Exact model / API / thinking": "确切的模型 / API / 思考级别",
  "Select explicitly": "请显式选择",
  "Catalog capacity exceeded; no partial model list is selectable.":
    "模型目录超出容量；不能从不完整的列表中选择。",
  "{error}. No automatic replacement or retry.":
    "{error}。不会自动替换或重试。",
  "{count} model withheld: its provider or model ID contains a credential value (such as an apiKey equal to the provider name) or control characters. Give each credential a value that matches no provider or model ID; restart the service after editing models.json.":
    "{count} 个模型未列出：其提供方或模型 ID 包含某个凭据值（例如与提供方名称相同的 apiKey）或控制字符。请让每个凭据值都不与任何提供方或模型 ID 重合；修改 models.json 后需重启服务。",
  "{count} models withheld: their provider or model IDs contain a credential value (such as an apiKey equal to the provider name) or control characters. Give each credential a value that matches no provider or model ID; restart the service after editing models.json.":
    "{count} 个模型未列出：其提供方或模型 ID 包含某个凭据值（例如与提供方名称相同的 apiKey）或控制字符。请让每个凭据值都不与任何提供方或模型 ID 重合；修改 models.json 后需重启服务。",
  "Model catalog unavailable ({code}); no model is selectable. No automatic retry.":
    "模型目录不可用（{code}）；无法选择任何模型。不会自动重试。",
  "Choice response unconfirmed; observe catalog before another explicit choice.":
    "选择的响应未确认；请先观察目录再进行下一次显式选择。",
  "Confirm owner model choice": "确认所有者模型选择",
  "Command receipt": "命令回执",
  Admission: "准入",
  Execution: "执行",
  "not settled": "未结束",
  Publication: "发布",
  Run: "运行",
  "metadata action": "元数据操作",
  "{status}. This observation does not authorize replay.":
    "{status}。此观察不授权重放。",
  "Observe exact receipt": "观察确切回执",
  "Conflicting receipt observation refused; prior committed facts preserved.":
    "冲突的回执观察已被拒绝；之前提交的事实已保留。",

  // Retained history readers
  "Retained content fields": "保留的内容字段",
  "Showing matches for entity {entity} on this page only. Continue paging for other fields/versions.":
    "仅显示本页中实体 {entity} 的匹配项。继续翻页可查看其他字段/版本。",
  "Omitted source block:": "已省略的源块：",
  "{bytes} retained bytes": "保留 {bytes} 字节",
  "Inspect complete retained field": "查看完整的保留字段",
  "Recording: {observed}; source: {source};":
    "记录：{observed}；来源：{source}；",
  redacted: "已脱敏",
  "no reported redaction": "未报告脱敏",
  "; omitted: {omissions}": "；已省略：{omissions}",
  ". Not a guarantee of complete original source or universal secret detection.":
    "。不保证原始来源完整，也不保证能检测出所有机密。",
  "Reading all retained field pages…": "正在读取所有保留字段页…",
  "Copied all retained field bytes (source omissions still apply).":
    "已复制全部保留字段字节（来源省略仍然适用）。",
  "Copied retained field bytes; recording is incomplete. No complete-source claim.":
    "已复制保留字段字节；记录不完整。不声称来源完整。",
  "Clipboard unavailable.": "剪贴板不可用。",
  "Full-field copy refused/incomplete.": "完整字段复制被拒绝/不完整。",
  "Retained field": "保留字段",
  "snapshot {seq}": "快照 {seq}",
  "Exact hit bytes [{start}, {end}); only this immutable field is highlighted.":
    "确切命中字节 [{start}, {end})；仅高亮这个不可变字段。",
  "Markdown page": "Markdown 页",
  "Raw page": "原始页",
  "Copy full retained field": "复制完整保留字段",
  "Copy canceled; execution unchanged.": "复制已取消；执行不受影响。",
  "Cancel copy": "取消复制",
  "Detail refused: {error}": "详情被拒绝：{error}",
  "Reading…": "读取中…",
  "Validation in progress. The retained field is not empty.":
    "正在验证。该保留字段并非为空。",
  "Bytes {start}–{end} of {total}.": "第 {start}–{end} 字节，共 {total} 字节。",
  "More retained data available.": "还有更多保留数据。",
  "End of field.": "字段结束。",
  Previous: "上一页",
  "Continue validation": "继续验证",
  "Next field page": "下一字段页",
  "Read unavailable.": "读取不可用。",
  "Exact entity metadata": "确切的实体元数据",
  "Reading exact entity version…": "正在读取确切的实体版本…",
  "Entity refused: {error}": "实体被拒绝：{error}",
  "Entity validation in progress, not missing.": "实体正在验证，并非缺失。",
  "Continue exact entity validation": "继续确切的实体验证",
  "Exact stored owner and associations": "确切存储的所有者与关联",
  "Export retained history": "导出保留历史",
  "Selected {kind}: {id} · snapshot {seq}": "已选{kind}：{id} · 快照 {seq}",
  Format: "格式",
  "NDJSON public archive": "NDJSON 公开归档",
  "Readable Markdown with footer metadata": "带页脚元数据的可读 Markdown",
  "Includes retained context, messages/tools, graph, lifecycle, changes, checks, human review and coverage beyond loaded pages. Redactions and source omissions remain.":
    "包括已加载页之外的保留上下文、消息/工具、任务图、生命周期、变更、检查、人工审阅和覆盖范围。脱敏和来源省略仍然保留。",
  "A native browser download request cannot establish completion. Inspect the original EOF and completion trailer/counts/digest in the downloaded artifact; missing footer means incomplete. Revoked access may terminate without a trailer.":
    "浏览器原生下载请求无法证明下载完成。请检查下载文件中的原始 EOF 以及完成尾部/计数/摘要；缺少页脚即表示不完整。访问被撤销时可能在没有尾部的情况下终止。",
  "Download requested — completion not verified by this browser UI.":
    "已请求下载——此浏览器界面未验证是否完成。",
  "Download unavailable; no archive claimed complete.":
    "下载不可用；不声称任何归档完整。",
  "Request selected-scope download": "请求下载所选范围",
  "Search retained history": "搜索保留历史",
  "Case-sensitive literal query": "区分大小写的字面查询",
  "Case-sensitive literal UTF-8 search. Scope {kind} {id}; snapshot {seq}. No regex, provider request or history repair.":
    "区分大小写的 UTF-8 字面搜索。范围：{kind} {id}；快照 {seq}。不使用正则，不请求提供方，也不修复历史。",
  "Searching bounded retained range…": "正在搜索限定的保留范围…",
  "Search refused: {error}": "搜索被拒绝：{error}",
  "Enter a query to search this selected scope.": "输入查询以搜索所选范围。",
  "Matches on this page: {count}": "本页匹配：{count}",
  "bytes {start}–{end}": "字节 {start}–{end}",
  "Continue same snapshot search": "在同一快照中继续搜索",
  "↑↓ Navigate · Enter Open exact hit · Escape Close. Reopening never resumes execution.":
    "↑↓ 移动 · Enter 打开确切命中 · Escape 关闭。重新打开不会恢复执行。",
  "Search unavailable or invalid; no automatic retry.":
    "搜索不可用或无效；不会自动重试。",
  "Query must be 1–1024 UTF-8 bytes; it was not clipped.":
    "查询必须为 1–1024 个 UTF-8 字节；未做截断。",
  "No hits in this bounded window; search is not finished.":
    "此限定窗口中没有命中；搜索尚未完成。",
  "No hits in the final retained window. Coverage limits above still apply.":
    "最后的保留窗口中没有命中。上方的覆盖范围限制仍然适用。",
  "Immutable admitted graph": "不可变的已准入任务图",
  "Graph refused: {error}": "任务图被拒绝：{error}",
  "Reading graph…": "正在读取任务图…",
  "Graph validation in progress; not an empty graph.":
    "任务图正在验证；并非空图。",
  "Continue graph validation": "继续验证任务图",
  "Find on displayed field page": "在当前字段页中查找",
  " (first 1000 visual highlights)": "（前 1000 处可视高亮）",
  "; not whole-history search": "；不是全历史搜索",
  "Previous match": "上一个匹配",
  "Next match": "下一个匹配",
  "Read refused: {error}. Retained state has not been repaired.":
    "读取被拒绝：{error}。保留状态未被修复。",
  "Reading bounded history page…": "正在读取限定的历史页…",
  "Snapshot selected": "已选择快照",
  "Validating retained history": "正在验证保留历史",
  "; continue this exact read. No data page yet.":
    "；请继续这次确切读取。尚无数据页。",
  "Previous page": "上一页",
  "Next page": "下一页",
  "Observe a new snapshot": "观察新快照",
  "End of this retained snapshot (incomplete).": "此保留快照已结束（不完整）。",
  "End of this retained snapshot.": "此保留快照已结束。",
  "Open retained episode/child details": "打开保留的执行轮次/子运行详情",
  "Inspect admitted graph and plan": "查看已准入的任务图与计划",
  "Search all retained pages in selected scope": "搜索所选范围内的所有保留页",

  // Inspector, plan and review
  "Select a task to inspect plans, checks, changes and review.":
    "选择一个任务以查看计划、检查、变更和审阅。",
  Inspector: "检查器",
  plan: "计划",
  checks: "检查",
  changes: "变更",
  review: "审阅",
  "Owner metadata is stale.": "所有者元数据已过期。",
  "Owner metadata unavailable.": "所有者元数据不可用。",
  "Plan proposal unavailable.": "计划提案不可用。",
  "Current plan metadata unavailable. Observe again; historical text is not action authority.":
    "当前计划元数据不可用。请重新观察；历史文本不能作为操作依据。",
  "Saved graph proof in progress.": "已保存任务图的证明正在进行。",
  "Continue saved graph read": "继续读取已保存的任务图",
  "Load observed saved plan into local draft":
    "将观察到的已保存计划载入本地草稿",
  "Current control context unavailable. Historical data is not action authority.":
    "当前控制上下文不可用。历史数据不能作为操作依据。",
  "Captured historical observations": "已捕获的历史观察",
  "Human review": "人工审阅",
  "Done records human acknowledgment, not execution success or certification. It cannot restart a blocked episode.":
    "“完成”记录的是人工确认，而非执行成功或认证。它不能重新启动被阻塞的执行轮次。",
  "Episode to review": "要审阅的执行轮次",
  "Select an observed episode": "选择一个已观察的执行轮次",
  "I acknowledge current unresolved issues if present; original results will not be rewritten.":
    "我确认当前存在的未解决问题；原始结果不会被改写。",
  "Preview human review / Done": "预览人工审阅 / 完成",
  "Observe current obligations in Checks before requesting review.":
    "请求审阅前，请先在“检查”中观察当前检查项。",
  "Readable plan & decomposition": "可读计划与分解",
  "{count} required assignments": "{count} 个必需子任务",
  "Preview readonly Generate proposal": "预览只读生成提案",
  "Preview Save plan": "预览保存计划",
  "Preview Start saved graph": "预览启动已保存的任务图",
  "Draft changes never execute. Start uses the saved graph shown in its fresh preview, not unsaved text. Generated proposals never save or start themselves.":
    "草稿修改永远不会执行。启动使用其最新预览中显示的已保存任务图，而不是未保存的文本。生成的提案不会自行保存或启动。",
  "Saved assignments name an old model selection. Reading does not rebind them.":
    "已保存的子任务指定了旧的模型选择。读取不会重新绑定它们。",
  "Explicitly rebind draft to current model (requires new Save)":
    "将草稿显式重新绑定到当前模型（需要重新保存）",
  "Readable plan": "可读计划",
  "Read rendered plan": "阅读渲染后的计划",
  "checkout writer": "工作副本写入者",
  readonly: "只读",
  Edit: "编辑",
  "Remove draft assignment": "移除草稿子任务",
  Purpose: "用途",
  Instructions: "指令",
  "Expected output": "预期产出",
  "Current-episode dependencies (whole final text by default)":
    "本轮依赖（默认使用完整最终文本）",
  "Require complete observation": "要求完整观察",
  "Selection: {range}": "选择范围：{range}",
  "reviewed UTF-8 bytes {start}–{end}": "已审阅的 UTF-8 字节 {start}–{end}",
  "whole final text; no silent clipping": "完整最终文本；不会静默截断",
  "Reviewed edge JSON (range/null and exact historical identity)":
    "已审阅的依赖边 JSON（范围/null 与确切历史标识）",
  "Remove edge": "移除依赖边",
  "Explicit historical/advisory edge JSON": "显式的历史/参考依赖边 JSON",
  "Exact committed run/child/result/version plus range and coverage requirement":
    "确切的已提交运行/子运行/结果/版本，以及范围和覆盖要求",
  "Add reviewed historical edge": "添加已审阅的历史依赖边",
  "Discard inline edits": "放弃行内编辑",
  "Apply to local draft": "应用到本地草稿",
  "Role {role}": "角色 {role}",
  "Add assignment": "添加子任务",
  "Remove dependent edges explicitly before deleting this assignment.":
    "删除此子任务前，请先显式移除依赖它的边。",
  "Invalid dependency. Original edge retained; review before Save.":
    "依赖无效。已保留原依赖边；请在保存前审阅。",
  "Historical edge requires actual committed identity; no guessed result reference.":
    "历史依赖边需要真实的已提交标识；不接受猜测的结果引用。",
  View: "视图",
  "Raw text / lines": "原始文本 / 行",
  "Safe Markdown": "安全 Markdown",
  "Observed diff": "观察到的 diff",
  "Wrap: on": "换行：开",
  "Wrap: off": "换行：关",
  "Zoom +": "放大 +",
  "Zoom −": "缩小 −",
  "Captured page only, not a current filesystem read. Line numbers are page-local. Full retained paging and copy are available above.":
    "仅为捕获的页面，不是对当前文件系统的读取。行号仅在本页内有效。上方提供完整的保留分页和复制。",
  "Page headings": "页面标题",
  "Select page line {line}": "选择页内第 {line} 行",
  "Selected page lines {start}–{end}": "已选页内第 {start}–{end} 行",
  "Clear selection": "清除选择",
  "Current configured obligations": "当前已配置的检查项",
  "Observe obligations": "观察检查项",
  "Obligations unavailable: {error}": "检查项不可用：{error}",
  "Obligations unavailable.": "检查项不可用。",
  "No configured obligations. This is not passing check coverage.":
    "没有已配置的检查项。这不代表检查已通过。",
  "Timeout {timeout} ms. Native outcome and freshness remain separate.":
    "超时 {timeout} 毫秒。原生结果与是否最新分别记录。",
  "Preview exact configured check": "预览确切的已配置检查",
  "Browser checks are configured selections only. Native-local manual commands are not a browser shell endpoint.":
    "浏览器中只能运行已配置的检查。本地原生手动命令不是浏览器 shell 端点。",
  "Current checkout changes": "当前工作副本变更",
  "Current checkout changes (not a captured historical diff)":
    "当前工作副本变更（不是捕获的历史 diff）",
  "Observe current changes": "观察当前变更",
  "Current observation unavailable": "当前观察不可用",
  "Fingerprint {identity} · {coverage} · includes pre-existing dirt; not attribution.":
    "指纹 {identity} · {coverage} · 包含既有的未提交修改；不代表归属。",
  "complete within bounded scope": "在限定范围内完整",
  "incomplete coverage": "覆盖不完整",
  "Captured observations include pre-existing dirt. They do not attribute every change to Cadence; bounded fingerprints are not filesystem snapshots.":
    "捕获的观察包含既有的未提交修改。它们不会把每处变更都归于 Cadence；限定指纹不是文件系统快照。",
  "committed #{seq}": "已提交 #{seq}",
  "Inspect full retained {field}": "查看完整保留的{field}",

  // Transcript and tools
  "Copy displayed text": "复制显示的文本",
  "Copy unavailable": "无法复制",
  "{state} message record, not execution outcome":
    "{state}消息记录，不代表执行结果",
  Collapse: "收起",
  "Inspect message": "查看消息",
  "Child {child} · message {message} · version {version}":
    "子运行 {child} · 消息 {message} · 版本 {version}",
  "Result call: {call}. Kept visible independently of the tool card.":
    "结果对应调用：{call}。独立于工具卡片保持可见。",
  "unassociated / orphan": "未关联 / 孤立",
  "No finalized text field in this snapshot. Inspect retained partial/final blocks and omission metadata below.":
    "此快照中没有最终文本字段。请在下方查看保留的部分/最终块以及省略元数据。",
  "All message blocks, source limits and tool associations":
    "全部消息块、来源限制与工具关联",
  "Latest on loaded page": "跳到已加载页的最新处",
  "No message records on this page; more history remains.":
    "本页没有消息记录；还有更多历史。",
  "No message records on this page.": "本页没有消息记录。",
  "SDK tool error observed": "观察到 SDK 工具错误",
  "SDK tool end observed": "观察到 SDK 工具结束",
  "Start observed; end not observed in this snapshot":
    "已观察到开始；此快照中未观察到结束",
  "No start observed": "未观察到开始",
  "Inspect recorded tool call": "查看已记录的工具调用",
  "Child {child} · call {call} · v{version}":
    "子运行 {child} · 调用 {call} · v{version}",
  "SDK tool observations are not native process launch/close or passing parent checks.":
    "SDK 工具观察不代表原生进程的启动/关闭，也不代表父级检查已通过。",
  "Source ID": "来源 ID",
  unavailable: "不可用",
  Declaration: "声明",
  "No declaration recorded; orphan result remains accessible":
    "未记录声明；孤立结果仍可访问",
  "Recorded tool end (not parsed from output)":
    "已记录的工具结束（非从输出解析）",
  "No end fact in this snapshot.": "此快照中没有结束事实。",

  // Runs and sidebar
  "historical projection": "历史视图",
  "owner projection": "所有者视图",
  Lifecycle: "生命周期",
  unsettled: "未结束",
  "Wait/block reason": "等待/阻塞原因",
  "none reported": "未报告",
  "Summary publication": "摘要发布",
  "Native / recording / parent settlement facts (independent of human review)":
    "原生 / 记录 / 父级结束事实（独立于人工审阅）",
  "No settlement recorded": "未记录结束信息",
  "New task": "新建任务",
  "No retained task on this page.": "本页没有保留的任务。",
  "One checkout owner. Open/history never executes.":
    "每个工作副本一个所有者。打开或查看历史永远不会执行。",
  "Active and recent episodes": "活动与近期执行轮次",
  "Runs and assignments": "运行与子任务",
  "Toggle assignments": "展开/收起子任务",
  "{count} descendants": "{count} 个后代",
  " / failed child": " / 有失败的子运行",
  " / unknown child": " / 有未知的子运行",
  "No active or recent episode observed.": "未观察到活动或近期的执行轮次。",
  "All retained episodes for task": "此任务的全部保留执行轮次",

  // Timeline
  "Committed order, not wall time. Replay advances visualization only. Raw observations retain clock/sequence provenance; unknown timing is not reconstructed.":
    "按提交顺序排列，而非真实时间。回放只推进可视化。原始观察保留时钟/序号来源；未知的时间不会被重建。",
  "Bundled timeline unavailable; retained events remain accessible, no CDN fallback.":
    "内置时间线不可用；保留的事件仍可访问，不会回退到 CDN。",
  Owner: "所有者",
  owner: "所有者",
  input: "输入",
  model: "模型",
  "Committed #{seq}; {who}": "已提交 #{seq}；{who}",
  "recorded fact": "已记录事实",
  "Worker-local monotonic observations ({child}): {first}–{last} ms; not aligned to other workers.":
    "工作进程本地单调时钟观察（{child}）：{first}–{last} 毫秒；未与其他工作进程对齐。",
  "Owner observation ({epoch}): {ms} ms; clock origin not established by this reader.":
    "所有者观察（{epoch}）：{ms} 毫秒；此读取器未确定时钟起点。",
  "{scope} — loaded committed page": "{scope}——已加载的提交页",
  "Committed sequence {seq}; page ordinal {ordinal}. Timing shown in raw facts only; clocks may not be comparable.":
    "提交序号 {seq}；页内序数 {ordinal}。时间只在原始事实中显示；各时钟可能无法比较。",

  // Recorded status words shown as labels
  task: "任务",
  run: "运行",
  child: "子运行",
  workspace: "工作区",
  message: "消息",
  tool: "工具",
  "final-text": "最终文本",
  "tool-args": "工具参数",
  "tool-update": "工具更新",
  "tool-result": "工具结果",
  check: "检查",
  user: "用户",
  assistant: "助手",
  partial: "部分",
  final: "最终",
  observed: "已观察",
  create: "创建",
  "generate-plan": "生成计划",
  "save-plan": "保存计划",
  start: "启动",
  research: "调研",
  diagnosis: "诊断",
  edit: "编辑",
  current: "最新",
  stale: "已过期",
  resync: "重新同步中",
  closed: "已关闭",
  "accepted-unallocated": "已接受未分配",
  active: "活动中",
  draining: "排空中",
  queued: "排队中",
  preparing: "准备中",
  running: "运行中",
  closing: "收尾中",
  settled: "已结束",
  completed: "已完成",
  failed: "失败",
  canceled: "已取消",
  timeout: "超时",
  unknown: "未知",
  blocked: "已阻塞",
  pending: "待定",
  published: "已发布",
  conflict: "冲突",
  uncertain: "不确定",
  accepted: "已接受",
  refused: "已拒绝",
  absent: "不存在",
  inconclusive: "无定论",
  "not-run": "未运行",
  passed: "已通过",
  complete: "完整",
  incomplete: "不完整",
  limited: "受限",
  binary: "二进制",
  "hidden-thinking": "隐藏的思考",
  "source-limit": "来源限制",
  "capture-limit": "捕获限制",
  gap: "缺口",
  unsupported: "不支持",
  capacity: "容量",
  dependency: "依赖",
  writer: "写入者",
  "parent-stopped": "父级已停止",
  "wait-expired": "等待超时",
  "handoff-overflow": "交接溢出",
  "stale-dependency": "依赖已过期",
  quarantine: "隔离",
  "incomplete-observation": "观察不完整",
  "unrun-checks": "有未运行的检查",
  "stale-checks": "有过期的检查",
  "failed-checks": "有失败的检查",
  "partial-results": "结果不完整",
  "recording-incomplete": "记录不完整",
  "legacy-context": "旧版上下文",
} satisfies Record<string, string>;
