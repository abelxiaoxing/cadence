/** Simplified Chinese for the WebUI. Keys are the English source text, which
 * stays the default and the fallback; `{name}` marks an interpolated value.
 * Error codes, identifiers, commands and recorded content are never translated. */
export const zh = {
  "Incomplete model response": "未完成的模型响应",
  "Upstream interrupted. Retry {attempt}/{maxAttempts} is scheduled after {seconds}s; completed tool results are kept.":
    "上游响应中断，第 {attempt}/{maxAttempts} 次重试安排在 {seconds} 秒后；已完成的工具结果已保留。",
  "Retrying the model request ({attempt}/{maxAttempts}); completed tool results are kept.":
    "正在重试模型请求（{attempt}/{maxAttempts}）；已完成的工具结果已保留。",
  "The model request failed after automatic recovery or was not retryable. Partial work is preserved; no workflow step was replayed.":
    "模型请求在自动恢复后仍失败，或该错误不可重试。已有工作已保留，未重放工作流步骤。",
  "Refresh models": "刷新模型列表",
  "The connection changed. Your model choice and draft are kept; send again when ready.":
    "连接状态已变化，模型选择和草稿已保留，请就绪后重新发送。",
  "Used for your next new conversation after choosing a folder.":
    "选择工作目录后，用于下一个新会话。",
  "No models are configured. Add a provider to Pi's models.json or auth.json, then read the list again.":
    "尚未配置模型。请在 Pi 的 models.json 或 auth.json 中添加提供商，然后重新读取列表。",
  "Choose now; the model is verified when you send.":
    "现在选择模型，发送时验证可用性。",
  "Send with this model before approving a plan.":
    "请先使用此模型发送消息，再批准计划。",
  "Preparing execution…": "正在准备执行环境…",
  "Model selection needs a compatible connection": "连接兼容后才能选择模型",
  "Checking execution state…": "正在确认执行状态…",
  "Execution state unavailable": "执行状态暂时无法确认",
  "Model list unavailable": "模型目录读取失败",
  "Last used: {model}": "上次使用：{model}",
  "Last used model; availability is checked when you send.":
    "上次使用的模型，发送时会验证其可用性。",
  "Execution is being prepared for your Send. Models will load when it is ready.":
    "正在为本次发送准备执行环境，就绪后会加载模型。",
  "Reload the page to observe a compatible execution connection before choosing a model.":
    "请重新加载页面，确认执行连接兼容后再选择模型。",
  "The model list changed. Read the current list before choosing again.":
    "模型列表已变化，请读取当前列表后再选择。",
  "The choice was not confirmed. Read the current model before choosing again.":
    "模型选择结果尚未确认，请读取当前模型后再决定是否重新选择。",

  "Recorded history could not be read.": "暂时无法读取历史证据。",
  "Reading recorded history…": "正在读取历史证据…",
  "The context changed ({code}). Read the current state before trying this action again.":
    "上下文已变化（{code}）。请先读取当前状态，再决定是否重新操作。",
  "Observation status": "状态读取",
  "Latest state unavailable.": "当前无法获取最新状态。",
  "Started work may still be running. No message is resent.":
    "已开始的工作可能仍在运行，不会重发消息。",
  "Diagnostic details": "诊断详情",
  "Viewer observation: {code}.": "页面状态读取：{code}。",
  "Context changed. Read the current state before confirming a plan.":
    "上下文已变化，请先读取当前状态，再确认计划。",
  "Toggle conversation navigation": "展开或收起会话导航",
  "Toggle workspace panels": "展开或收起辅助面板",
  "Conversation navigation": "会话导航",
  "Conversation history could not be read. This is not an empty history.":
    "暂时无法读取会话历史，这不代表没有历史记录。",
  "Model selection is unavailable until the current conversation and execution state are observed.":
    "读取当前会话和执行状态后才能选择模型。",
  "Cadence state unavailable": "Cadence 状态未确认",
  "Cadence on next Send": "下次发送开启 Cadence",
  "Cadence off": "Cadence 已关闭",
  "Read the current execution state before approving this plan.":
    "请先读取当前执行状态，再批准此计划。",
  "Wait for the current reply before approving this plan.":
    "请等待当前回复结束，再批准此计划。",
  "Observing plan approval…": "正在确认计划审批结果…",
  "Read the current conversation context before approving this plan.":
    "请先读取当前会话上下文，再批准此计划。",
  "Conversation folder:": "会话目录：",
  "Conversation content has not been read. You can keep a draft; nothing is sent until the context is available.":
    "尚未读取到会话内容。可以先编辑草稿，上下文可用前不会发送。",
  "The last Send is not yet confirmed. No message is resent.":
    "上次发送的结果尚未确认，不会重发消息。",
  "Sending…": "正在发送…",
  "Sending is unavailable until the current context is observed. Your draft stays here.":
    "读取当前上下文后才能发送，草稿会保留在这里。",
  "Conversation state is not current. Previously read content may be shown; this does not mean work has stopped.":
    "会话状态尚未更新。页面可能显示之前读取的内容，这不表示工作已停止。",
  "Not observed": "未读取",
  "Turns in this conversation: {count}": "本会话轮次：{count}",
  "Context {used} / {window} · {percent}%":
    "上下文 {used} / {window} · {percent}%",
  "Context {used} tokens": "上下文 {used} tokens",
  "Context unknown after compaction": "压缩后上下文大小未知",
  "Context window in use": "上下文窗口占用",
  "Context size as of the last completed model response ({model}). Messages after that response are not counted.":
    "上下文大小以最近一次完成的模型回复（{model}）为准，不包含那次回复之后的消息。",
  "A compaction followed that response, so the size is unknown until the next one.":
    "那次回复之后做过压缩，下一次模型回复完成前无法得知大小。",
  "The model list states no context window for this model, so no percentage is shown.":
    "模型列表没有给出这个模型的上下文窗口，因此不显示占比。",
  Working: "工作中",
  "Collapse panel": "收起面板",
  "About this panel": "面板说明",
  "No matching files": "没有匹配的文件",
  "Tool call in progress": "工具调用进行中",
  "Tool result recorded": "已记录工具结果",
  "Tool error recorded": "已记录工具错误",
  "No tool result observed": "未观察到工具结果",
  "Show arguments and output": "查看参数与输出",
  "Nothing more is recorded for this call.": "此调用没有更多记录。",
  Output: "输出",
  "Error output": "错误输出",
  "Files appear once this folder has been observed.":
    "读取到该目录的状态后即可浏览文件。",
  "The conversation folder has not been observed.": "尚未读取到当前会话目录。",
  "Reading files…": "正在读取文件…",
  "Plan approval is currently unavailable.": "当前无法批准此计划。",
  "Running work": "正在进行的工作",

  "History configuration differs. Activity remains observe-only.":
    "历史读取配置不同。此活动仅供观察。",
  "Discovered session": "发现的会话",
  "Owner work already listed below is not duplicated here.":
    "下方已经列出的 owner 工作不在此重复显示。",
  "Active Pi work": "Pi 活动工作",
  "{projects} projects · {sessions} sessions":
    "{projects} 个项目 · {sessions} 个会话",
  "Activity observation is partial. Missing work is not known to have finished.":
    "活动观察不完整。未显示的工作不代表已经结束。",
  "Discovering active work…": "正在发现活动工作…",
  "No active work observed. Idle terminals and owners are not listed.":
    "未观察到活动工作。空闲终端和 owner 不列入此处。",
  "Unattributed work": "无法归属的工作",
  "Terminal turn (observe only)": "终端回合（只读观察）",
  "Owner turn": "Owner 回合",
  "Owner workflow": "Owner 工作流",
  "Current observation": "当前观察",
  "Stale observation": "观察已过期",
  "Unknown activity": "活动状态未知",
  "Activity was discovered; session history is not yet readable. No transcript was created.":
    "已发现活动；会话历史暂不可读。未创建或伪造对话记录。",
  turn: "回合中",
  settling: "收尾中",

  "Complete delivery agreement": "完整交付约定",
  "Implementation route updates": "实现路线调整次数",
  "Earlier workflow steps": "更早的执行步骤",
  "Latest workflow steps": "最新执行步骤",
  recovering: "自动诊断与恢复",
  learning: "沉淀项目知识",
  knowledge: "项目知识",
  "Not recorded": "未记录",
  "Task branch": "任务分支",
  "Task worktree": "任务工作区",
  "Delivery target": "交付目标",
  "Worktree preparation": "工作区准备",
  "Candidate commit": "候选提交",
  "Candidate acceptance": "候选验收",
  "Checks and automatic Agent review passed": "检查和自动 Agent review 已通过",
  "Accepted with {count} of {total} checks set aside by a recorded deviation; the others and the automatic Agent review passed":
    "已验收：{total} 项检查中有 {count} 项被已记录的偏离搁置，其余检查和自动 Agent review 已通过",
  "set aside by a recorded deviation": "已被记录的偏离搁置",
  Assignments: "子任务",
  "Assignment: {state}": "子任务：{state}",
  "{count} running": "{count} 个运行中",
  "{count} queued": "{count} 个排队中",
  "{count} done": "{count} 个已完成",
  "{count} failed": "{count} 个失败",
  "{count} superseded": "{count} 个已被取代",
  "dropped by route revision {revision}": "在第 {revision} 次路线修订中取消",
  "added or rewritten by route revision {revision}":
    "由第 {revision} 次路线修订新增或改写",
  "after {ids}": "在 {ids} 之后",
  "own worktree": "独立工作区",
  integrated: "已合回",
  "kept for inspection": "保留待查看",
  "Only the steps on this page are grouped below; other pages hold more.":
    "下面只归类了本页的步骤，其他分页还有更多步骤。",
  "Route revisions": "路线修订",
  "Paths added to the write scope after approval:":
    "批准之后加入写入范围的路径：",
  "delivered with 1 deviation": "交付时有 1 处偏离",
  "delivered with {count} deviations": "交付时有 {count} 处偏离",
  "Deviations from the agreement": "与约定的偏离",
  "Deviations from the agreement: {count}": "与约定的偏离：{count} 处",
  "Each is an acceptance item or decision that could not be met as written, with what was delivered instead. The automatic Agent review is asked to confirm each one; it is not human review.":
    "每一处都是无法按原文满足的验收项或决定，以及实际交付的替代结果。自动 Agent review 会被要求逐条确认；这不是人工审阅。",
  "Could not be met": "无法满足",
  Why: "原因",
  "Delivered instead": "实际交付",
  "Checks set aside": "搁置的检查",
  None: "无",
  "Recorded at": "记录于",
  "route revision {revision}": "第 {revision} 次路线修订",
  "Local integration": "本地合回",
  "Post-merge checks": "合回后检查",
  "Worktree cleanup": "工作区清理",
  "Task branch delivery": "任务分支交付",
  "Policy: keep the task branch; no push or deployment.":
    "策略：保留任务分支；不推送或部署。",
  retained: "已保留",
  removed: "已移除",
  applied: "已合回",
  applying: "合回中",

  "Invalid image.": "图片格式无效。",
  "Add images": "添加图片",
  "Remove image: {name}": "移除图片：{name}",
  "Attached image": "附加图片",
  "Open image": "打开图片",
  "Image unavailable.": "图片暂不可用。",
  "Loading image…": "正在加载图片…",
  "Remove images before exiting Cadence.": "请先移除图片，再退出 Cadence。",
  "The selected model does not support images. Choose a vision model or remove the images.":
    "当前模型不支持图片。请选择视觉模型或移除图片。",
  "Use PNG, JPEG or WebP images.": "请选择 PNG、JPEG 或 WebP 图片。",
  "Image is empty.": "图片为空。",
  "Context fixed at admission:": "接纳时固定的上下文：",
  "Declared write paths use the checkout root:":
    "声明的写入路径以此 checkout 根目录为基准：",
  "No model": "未使用模型",
  "The message was not sent ({code}). Its draft is kept.":
    "消息尚未发送（{code}）。草稿已保留。",
  "Execution is not ready to approve this plan. Send a message to refresh the conversation first; nothing was approved.":
    "当前执行服务无法接受此计划审批。请先发送消息以刷新会话；未批准任何实施。",
  "Execution was prepared, but the conversation was unreadable before Send. Review its restored context and send again; this message was not sent.":
    "执行服务已准备就绪，但发送前无法读取会话。请查看恢复的上下文后再次发送；本次消息尚未发送。",
  "Conversation context is unavailable. Send can prepare execution, but cannot submit this draft until the context is observed.":
    "当前无法读取会话上下文。点击发送可准备执行服务，但在确认上下文之前不会提交此草稿。",

  "Choose a working folder to see its conversation history.":
    "选择工作目录后，即可查看它的历史会话。",
  "Choose a working folder; its files become available when execution is prepared.":
    "选择工作目录；执行服务就绪后即可浏览文件。",
  "Choose working folder": "选择工作目录",
  "Use this folder": "使用此目录",
  "Selecting folder…": "正在选择目录…",
  "Choose a folder…": "选择目录…",
  "Choose a working folder": "选择工作文件夹",
  "Choose a working folder to start. You can write a draft below.":
    "选择工作文件夹即可开始，也可以先在下方写草稿。",
  "Write a message. Choose a folder before sending…":
    "输入消息，发送前请选择文件夹…",
  "Choose a folder before sending.": "发送前请选择文件夹。",
  "Returning to your last folder {path}…": "正在返回上次的文件夹 {path}…",
  "Could not restore {path}. Choose a folder to continue; nothing was started.":
    "无法恢复 {path}，请选择文件夹以继续；没有启动任何服务。",
  "Choose a folder on the service host. Conversations stay with their folder and running work continues. Nothing starts until you send.":
    "选择服务所在主机上的文件夹。会话保留在原文件夹中，运行中的工作不受影响；仅在发送消息时按需启动执行服务。",
  "Connecting…": "正在连接…",
  "Ready to prepare on Send": "发送时按需准备",
  "Preparing execution for this Send…": "正在为本次发送准备执行服务…",
  "Preparation outcome is unknown ({code}); an execution service may have started. The message was not sent and its draft is kept.":
    "准备结果未知（{code}）；执行服务可能已启动。消息尚未发送，草稿已保留。",
  "Execution preparation was confirmed, but the message was not sent ({code}). Its draft is kept.":
    "执行服务准备已确认，但消息尚未发送（{code}）。草稿已保留。",
  "The message was not accepted ({code}). Its draft is kept.":
    "消息未被接受（{code}）。草稿已保留。",
  "Send outcome is unknown ({code}). Observe the original command before sending again; no automatic retry.":
    "发送结果未知（{code}）。再次发送前请观察原命令的结果；不会自动重试。",
  "Project observation: {code}.": "项目观察：{code}。",
  "Project readiness unknown": "项目准备状态未知",
  "Project observation stale": "项目观察已过期",
  "Viewer observation stale": "当前页面观察已过期",
  "Viewer observation unavailable": "当前页面观察不可用",
  "Viewer disconnected": "当前页面已断开",
  "Execution service: {status}": "执行服务：{status}",
  "Last observed: {count} active runs": "上次观察：{count} 个活动运行",
  "not-started": "尚未启动",

  "Execution compatibility not observed": "尚未读取执行服务兼容性",
  "Execution is stopped. Conversation history remains readable; open this folder to send a new message.":
    "执行服务已停止。仍可查看历史会话；发送新消息前请打开此目录。",
  "Execution stopped · history only": "执行已停止 · 仅查看历史",
  "Newer conversations": "较新的会话",
  "Latest conversations": "最近会话",
  "Reading conversation history…": "正在读取会话历史…",
  "Older conversations": "更早的会话",
  "Conversation activity unavailable.": "当前无法读取会话运行状态。",
  "Files / history": "文件 / 历史",
  "Files and history drawer": "文件与历史面板",
  History: "历史",
  "History details": "历史详情",
  "History is readonly. Start new work in a conversation with /cadence.":
    "历史记录只读。请在对话中通过 /cadence 开始新工作。",
  Next: "下一页",

  "Cadence research, implementation and review agents appear here.":
    "Cadence 的调研、实施和审查代理会显示在这里。",
  "Subagent context": "子代理上下文",
  "Open subagent context": "打开子代理上下文",
  "Back to conversation": "返回对话",
  Back: "返回",
  Workflow: "工作流",
  "Step result": "步骤结果",
  "No result yet.": "暂无结果。",
  "The latest turn's outcome is unknown. Approval waits until it is observed.":
    "最新一轮的结果未知。需要先观察到结果才能批准。",
  "Cadence control state for this conversation is missing, incomplete or unreadable. No mode, plan or run is inferred and nothing was repaired. Start a new conversation; preserve this state for local diagnosis.":
    "此会话的 Cadence 控制状态缺失、不完整或无法读取。系统不会推断模式、计划或运行，也没有做任何修复。请新建会话；保留这些状态以便本地诊断。",
  "The last Cadence message of this conversation was not durably recorded. Its plan is not approvable and nothing was replayed or repaired. Start a new conversation; preserve this state for local diagnosis.":
    "此会话最后一条 Cadence 消息没有被持久记录。它的计划不可批准，系统没有重放或修复任何内容。请新建会话；保留这些状态以便本地诊断。",
  "No plan is awaiting approval.": "当前没有等待批准的计划。",
  "Cadence state unavailable. Observe the conversation before sending.":
    "暂时无法获取 Cadence 状态。请先刷新观察会话再发送。",
  "No retained transcript observed yet; absence is not proof of no activity.":
    "暂未观察到保留记录；这不代表没有活动。",
  "Tools and checks run on the service host, not in a sandbox.":
    "工具和检查直接在服务主机运行，不是安全沙箱。",
  Discussing: "对话中",
  "Awaiting plan approval": "等待批准计划",
  "Cadence conversation": "Cadence 对话",
  "Cadence on": "Cadence 已开启",
  "Exit Cadence": "退出 Cadence",
  "Message, or /cadence to enter continuous Cadence mode…":
    "输入消息，或输入 /cadence 进入持续 Cadence 模式…",
  "Cadence on Send": "发送时进入 Cadence",
  "Cadence stays on. Confirm one plan before implementation.":
    "Cadence 将持续开启。确认一次计划后开始实施。",
  "Cadence workflow": "Cadence 工作流",
  "Current implementation plan": "当前实施计划",
  "Approval covers this goal, its decisions, acceptance and assumptions. The service then finishes on its own: it may revise the route and write scope inside the repository, and records any deviation from the acceptance for the automatic review and the final report. No push, publication or deployment.":
    "批准覆盖本目标及其决定、验收标准和假设。之后由服务自行完成：它可以在仓库内调整路线和写入范围；对验收的任何偏离都会记录下来，交给自动审查确认，并在最终报告中置顶。不包含推送、发布或部署。",
  "Implement this plan": "按此计划实施",
  "To change the plan, continue the conversation. A changed plan requires fresh approval.":
    "需要修改计划时继续对话。计划变更后需要重新批准。",
  "Cadence stays on for this conversation until you explicitly exit.":
    "本对话将持续使用 Cadence，直到你明确退出。",
  "Workflow progress": "工作流进度",
  "Open workflow details": "打开工作流详情",
  Stop: "停止",
  researching: "调研中",
  "merged {commit}": "合并 {commit}",
  "{s}s": "{s} 秒",
  "{m}m {s}s": "{m} 分 {s} 秒",
  "{h}h {m}m": "{h} 小时 {m} 分",
  "Observing workflow": "正在观察工作流",
  "State unavailable is not completion. No automatic resubmission.":
    "状态不可用不代表已经完成。不会自动重新提交。",
  "Actual local merge commit:": "实际本地合并提交：",
  "Agent review is not human review. Worktrees and retained results are preserved.":
    "Agent 审查不是人工审阅。工作树和保留结果不会自动清理。",
  "Exit code": "退出码",
  "Preview is truncated.": "预览已截断。",
  "Read retained step result": "读取保留的步骤结果",
  "Cancel workflow — request stop": "取消工作流 — 请求停止",
  "Workflow activity unavailable; retained work may still be running.":
    "工作流状态不可用；已接受的工作可能仍在运行。",
  "Cadence is off. Accepted work continues; exit does not cancel it.":
    "Cadence 模式已关闭。已接受的工作继续执行；退出不会取消执行。",
  "Incomplete work is not replayed. A new explicit message may continue from the last complete checkpoint.":
    "不会重放未完成工作。明确发送新消息后，可从上一次完整上下文继续。",
  implementing: "实施中",
  verifying: "验证中",
  reviewing: "审查中",
  integrating: "集成中",
  finished: "已结束",
  implementation: "实施",
  git: "Git",

  "Another Cadence process is updating the project registry. Try again in a moment; if this persists, run cadence doctor on the service host.":
    "另一个 Cadence 进程正在更新项目注册表，请稍后再试；如果一直这样，请在服务所在主机运行 cadence doctor。",
  "Start a conversation from the sidebar.": "从左侧开启一段新对话。",
  "Conversations are kept with each project. Open a working folder to see its history.":
    "历史对话按项目保存。打开工作文件夹后，即可查看它的历史对话。",
  "Conversations are kept with each project. Choose a project below and open it to see its history.":
    "历史对话按项目保存。在下方选择项目并打开，即可查看它的历史对话。",
  "Choose a working folder at the bottom right to start chatting.":
    "在右下角选择工作文件夹，即可开始对话。",
  "Files appear here after you open a working folder.":
    "打开工作文件夹后，在这里浏览文件。",
  // Dual conversation workbench
  "Task created, but its conversation link was not confirmed.":
    "任务已创建，但与普通对话的关联尚未确认。",
  "This folder is unavailable. Choose another folder; nothing was moved or recreated.":
    "此文件夹不可用，请选择其他文件夹；没有移动或重建任何目录。",
  "No projects associated yet.": "尚未关联任何项目。",
  "The machine restarted while Cadence was running. Cadence recovered automatically.":
    "Cadence 运行期间机器重启过，已自动恢复。",
  "Cadence ended unexpectedly last time. It recovered automatically.":
    "Cadence 上次意外退出，已自动恢复。",
  "Cadence ran into a problem and restarted itself.":
    "Cadence 遇到问题，已自动重启。",
  "Cadence repaired some incomplete files automatically.":
    "Cadence 已自动修复部分不完整的文件。",
  "Work that was running is marked as interrupted; start it again when you are ready.":
    "当时正在运行的工作已标记为“已中断”，需要时可重新开始。",
  "Released the previous run's locks.": "已释放上次运行留下的锁。",
  "Stopped {count} leftover worker processes.":
    "已停止 {count} 个残留的工作进程。",
  "Stopped the unresponsive previous process.": "已停止无响应的旧进程。",
  "History continues after the last complete entry.":
    "历史记录从最后一条完整记录之后继续。",
  "Unreadable history was archived and a new one was started.":
    "无法读取的历史记录已归档，并已新建历史记录。",
  "Damaged state was archived; it started afresh.":
    "损坏的状态已归档，已重新开始。",
  "Rebuilt the project registry.": "已重建项目注册表。",
  "Set aside interrupted temporary files.": "已移走中断时留下的临时文件。",
  "Archived files are kept for 30 days; cadence doctor shows where.":
    "归档文件保留 30 天，可用 cadence doctor 查看位置。",
  "Folder {name}": "文件夹 {name}",
  "Project registry": "项目注册表",
  "Hide details": "收起详情",
  Dismiss: "知道了",
  "Chat ready": "可以开始对话",
  "Conversation capture limit exceeded.": "对话记录已达到容量上限。",
  "Start a new conversation; incomplete context is not replayed.":
    "请新建对话；不会重放不完整的上下文。",
  "Current metadata unavailable; showing the active turn only. No state was reconstructed.":
    "当前对话元数据不可用，仅显示仍在运行的轮次，未重建任何状态。",
  Files: "文件",
  "File list": "文件列表",
  "Workspace panels": "工作区面板",
  "Task details": "任务详情",
  "Switch working folder": "切换工作文件夹",
  "Open working folder": "打开工作文件夹",
  "Open this folder": "打开此文件夹",
  "Opening folder…": "正在打开文件夹…",
  "Will open:": "将打开：",
  "Open {path}": "打开 {path}",
  "Folder path": "文件夹路径",
  "Type or paste a path, then press Enter": "输入或粘贴路径，按回车前往",
  "Edit path": "输入路径",
  "Current location": "当前位置",
  "Home folder": "主目录",
  "Home folder (~)": "主目录（~）",
  "Filter folders": "筛选文件夹",
  "Filter this folder…": "筛选当前文件夹…",
  "Reading folder…": "正在读取文件夹…",
  "No matching folders.": "没有匹配的文件夹。",
  "No subfolders.": "没有子文件夹。",
  "Enter a full path, for example ~/project.":
    "请输入完整路径，例如 ~/project。",
  "This folder does not exist. Check the path.":
    "找不到这个文件夹，请检查路径。",
  "This location cannot be browsed: it belongs to another account, is protected, or is not a plain folder (for example a link).":
    "无法浏览这个位置：它属于其他账户、受保护，或不是普通文件夹（例如符号链接）。",
  "This folder could not be read right now; it may lack read permission. Try again.":
    "暂时无法读取这个文件夹，可能没有读取权限，请重试。",
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
  "Waiting messages": "等待中的消息",
  "Steering: read at the model's next step": "插队：模型下一步就会读到",
  "Queued: sent when this reply ends": "排队：这条回复结束后发送",
  Withdraw: "撤回",
  "Withdraw and put back in the message box": "撤回并放回输入框",
  "Not delivered.": "未送达。",
  "Not delivered: the reply ended before this message reached the model. Nothing was replayed; send it again.":
    "未送达：回复在这条消息到达模型之前就结束了。没有任何内容被重放；需要的话请重新发送。",
  "Not observed: the session could not be read when the reply ended, so whether this message was delivered was not recorded. Nothing was replayed.":
    "未观察到：回复结束时会话无法读取，因此没有记录这条消息是否送达。没有任何内容被重放。",
  "Put back in the message box": "放回输入框",
  "Queue behind this reply": "排在这条回复之后",
  "Queue: sent when this reply ends (Alt+Enter)":
    "排队：这条回复结束后发送（Alt+Enter）",
  "Steer this reply": "插队到这条回复",
  "Steer: read at the model's next step (Enter)":
    "插队：模型下一步就会读到（Enter）",
  "Enter steers this reply · Alt+Enter queues behind it":
    "Enter 插队 · Alt+Enter 排队",
  "The running reply did not take the message ({reason}). Your text stays here.":
    "进行中的回复没有接收这条消息（{reason}）。你的文字仍在输入框里。",
  "That message has already been handed to the model and can no longer be withdrawn.":
    "这条消息已经交给模型，无法再撤回。",
  "The message was not withdrawn ({reason}).": "消息没有撤回（{reason}）。",
  "A message into a running reply carries no images. Remove them, or send after the reply ends.":
    "发给进行中回复的消息不能带图片。请移除图片，或等回复结束后再发送。",
  "Cadence mode is not changed by a message into a running reply. Send this after the reply ends.":
    "发给进行中回复的消息不会切换 Cadence 模式。请等回复结束后再发送。",
  "Eight messages already wait for this reply. Withdraw one, or wait.":
    "已有 8 条消息在等这条回复。请撤回一条，或稍等。",
  "A message into a running reply continues that reply, not another entry.":
    "发给进行中回复的消息只能接在这条回复上，不能接到别的位置。",
  "Prepare task": "准备任务",
  "Analyzing task…": "正在分析任务…",
  "Send to begin analysis. You will confirm the plan before any edits.":
    "发送后开始分析，修改代码前会请你确认计划。",
  "Task preparation unavailable. Observe the original receipt before sending again.":
    "任务准备不可用，请先查看原始请求结果，不要重复发送。",
  "Task preparation stopped: {reason}. Observe the original receipt; no automatic retry.":
    "任务准备已停止：{reason}。请查看原始请求结果，不会自动重试。",
  "Prepare a plan first; Start requires confirmation.":
    "先准备计划，执行需另行确认 Start。",
  "Direct host tools · no Cadence task":
    "直接使用主机工具 · 不创建 Cadence 任务",
  "Conversation turn": "对话轮次",
  You: "你",
  Tool: "工具",
  "Latest messages": "最新消息",
  "Reading this conversation…": "正在读取对话…",
  "Reading earlier messages…": "正在读取更早的消息…",
  "Reading the rest of this message…": "正在读取这条消息的其余部分…",
  "Send outcome not yet observed:": "尚未观察到此次发送的结果：",
  Subagents: "子代理",
  "{active} active · {total} total": "{active} 个进行中 · 共 {total} 个",
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
  // Turn steps
  "Working steps": "工作过程",
  "Working…": "处理中…",
  Thought: "已思考",
  "Media not retained": "媒体内容未保留",
  "Content not retained": "内容未保留",
  "Thinking that could not be read is not shown.": "无法读取的思考内容不显示。",
  "Show thinking": "展开思考内容",
  "Thinking still being recorded": "思考内容仍在记录中",
  "No thinking text is recorded for this block.": "这段思考没有记录文本。",
  "Media is not retained.": "媒体内容不保留。",
  "Other content is not retained.": "其他类型的内容不保留。",
  "Read 1 file": "读取 1 个文件",
  "Read {n} files": "读取 {n} 个文件",
  "Listed 1 directory": "列出 1 个目录",
  "Listed {n} directories": "列出 {n} 个目录",
  "Searched once": "搜索 1 次",
  "Searched {n} times": "搜索 {n} 次",
  "Ran 1 command": "运行 1 条命令",
  "Ran {n} commands": "运行 {n} 条命令",
  "Edited 1 file": "修改 1 个文件",
  "Edited {n} files": "修改 {n} 个文件",
  "Used 1 tool": "调用 1 次工具",
  "Used {n} tools": "调用 {n} 次工具",
  "{n} failed": "{n} 个失败",
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
  "Recent folders": "最近文件夹",
  "This service exposes one project. Opening it never starts work.":
    "当前服务连接一个项目，打开项目不会启动执行。",
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
  "Export selected scope": "导出所选范围",
  "Copy token-free link": "复制不含令牌的链接",
  "Link copy unavailable.": "无法复制链接。",
  "Link copied.": "链接已复制。",
  "Dismiss notification": "关闭通知",
  "Theme: {current}. Switch to {next}.": "主题：{current}。点击切换为{next}。",
  System: "跟随系统",
  Light: "浅色",
  Dark: "深色",
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
  "Runs in the current snapshot": "当前快照中的运行",
  "Retained runs": "已保留的运行记录",
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
  Checkout: "工作副本",
  Observation: "观察",
  Expires: "过期时间",
  "Expected: {output}": "预期产出：{output}",
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
  readonly: "只读",
  Edit: "编辑",
  Purpose: "用途",
  Instructions: "指令",
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
  "Captured observations include pre-existing dirt. They do not attribute every change to Cadence; bounded fingerprints are not filesystem snapshots.":
    "捕获的观察包含既有的未提交修改。它们不会把每处变更都归于 Cadence；限定指纹不是文件系统快照。",
  "committed #{seq}": "已提交 #{seq}",
  "Inspect full retained {field}": "查看完整保留的{field}",

  // Transcript and tools
  "Copy displayed text": "复制显示的文本",
  "Copy unavailable": "无法复制",
  "Copy message": "复制消息",
  "Message actions": "消息操作",
  "No path recorded": "未记录路径",
  "{added} lines added, {removed} removed":
    "新增 {added} 行，删除 {removed} 行",
  "Built from the call's recorded arguments. It is not compared with the file, so it is not proof of what the file holds.":
    "根据这次调用记录下来的参数生成，没有与文件比对，因此不能证明文件现在的内容。",
  "Error recorded: requested, not applied": "记录到错误：仅为请求内容，未应用",
  "Requested content": "请求写入的内容",
  "Requested change": "请求的修改",
  "No lines recorded.": "没有记录任何行。",
  "Replacement {index} of {count}: {removed} lines for {added}":
    "第 {index} 处替换（共 {count} 处）：{removed} 行换成 {added} 行",
  "Showing the first {shown} of {total} lines.":
    "仅显示前 {shown} 行，共 {total} 行。",
  "Show all lines": "显示全部行",
  "Open image: {name}": "放大查看图片：{name}",
  "Zoom out": "缩小",
  "Zoom in": "放大",
  "Actual size": "原始大小",
  "Fit to window": "适应窗口",
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
  "Filter conversations…": "筛选对话…",
  "Clear filter": "清除筛选",
  "No listed conversation matches. Pages not loaded are not searched.":
    "已列出的对话中没有匹配项。尚未加载的分页不在筛选范围内。",
  Today: "今天",
  Yesterday: "昨天",
  Earlier: "更早",
  Rename: "重命名",
  "Rename {title}": "重命名“{title}”",
  Archive: "归档",
  "Archive {title}": "归档“{title}”",
  Unarchive: "取消归档",
  "Unarchive {title}": "取消归档“{title}”",
  "Conversation name": "对话名称",
  "Empty: titled by its first message": "留空则以第一条消息作标题",
  "Save name": "保存名称",
  "Keep the current name": "保留现有名称",
  "A name can have at most {count} characters.": "名称最多 {count} 个字符。",
  "Renaming…": "正在重命名…",
  "Archiving…": "正在归档…",
  "Unarchiving…": "正在取消归档…",
  "The conversation was not renamed ({code}). Its name is unchanged.":
    "对话没有重命名（{code}），名称保持不变。",
  "The conversation was not archived ({code}). It stays in the history.":
    "对话没有归档（{code}），仍在历史对话中。",
  "The conversation was not unarchived ({code}). It stays archived.":
    "对话没有取消归档（{code}），仍处于归档状态。",
  "Rename outcome is unknown ({code}). The list shows the recorded name when it is read again; nothing is retried.":
    "重命名的结果未知（{code}）。重新读取列表后会显示已记录的名称；不会自动重试。",
  "Archive outcome is unknown ({code}). The lists show the recorded state when they are read again; nothing is retried.":
    "归档操作的结果未知（{code}）。重新读取列表后会显示已记录的状态；不会自动重试。",
  "Rename and archive need the execution service; it starts with your next Send.":
    "重命名和归档需要执行服务在运行；下次发送消息时会启动它。",
  "Rename and archive are unavailable until the execution service is observed.":
    "读取到执行服务的状态后，才能重命名和归档。",
  "Archived conversations": "已归档的对话",
  "Show archived": "查看已归档的对话",
  "Back to history": "返回历史对话",
  "Archiving only leaves a conversation out of the history. Its session file is not moved or deleted.":
    "归档只是不再把对话列在历史对话里，会话文件不会被移动或删除。",
  "Archived conversations could not be read. This is not an empty list.":
    "无法读取已归档的对话，这不代表列表为空。",
  "Reading archived conversations…": "正在读取已归档的对话…",
  "No archived conversations.": "没有已归档的对话。",
  Archived: "已归档",
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
  superseded: "已被取代",
  rejected: "已拒绝",
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
  Off: "关闭",
  Minimal: "最低",
  Low: "低",
  Medium: "中",
  High: "高",
  "Extra high": "极高",
  Max: "最大",
  "A reply or workflow is still running in this project. Switch models after it finishes.":
    "此项目中还有回复或工作流正在运行，结束后再切换模型。",
  "This model's credentials are unavailable. Check auth.json or the provider's API key.":
    "此模型的凭据不可用，请检查 auth.json 或提供方的 API key。",
  "This model or thinking level is not supported.": "不支持此模型或思考级别。",
  "Choose a model": "选择模型",
  "Model: {model}": "模型：{model}",
  "Switch models after the current reply finishes.":
    "当前回复结束后才能切换模型。",
  "Last used model; it is used again when you send.":
    "上次使用的模型，发送时会再次启用。",
  "Choose a model; your message is sent right after.":
    "选择模型后会立即发送你的消息。",
  "Search models": "搜索模型",
  "Search models…": "搜索模型…",
  Models: "模型列表",
  "Reading models…": "正在读取模型…",
  "Credentials unavailable": "凭据不可用",
  "Not supported": "不支持",
  "Used when you send": "发送时启用",
  "No matching models.": "没有匹配的模型。",
  "No models are configured. Add a provider to Pi's models.json or auth.json, then restart the service.":
    "还没有配置模型。请在 Pi 的 models.json 或 auth.json 中添加提供方，然后重启服务。",
  "Thinking level: {level}": "思考级别：{level}",
  Thinking: "思考",
  "The model list could not be read ({code}).": "无法读取模型列表（{code}）。",
  "Read again": "重新读取",
  "The model was not changed ({code}).": "模型未切换（{code}）。",
  "Switching model…": "正在切换模型…",
  "This model is used for future messages in this conversation. Work already started keeps its original model.":
    "此模型用于当前会话后续发送的消息，已开始的工作仍使用原模型。",
  "Type a message below. Turn on Cadence mode to agree on a plan before implementation.":
    "在下方输入消息开始对话。打开 Cadence 模式可以先商定计划再实施。",
  "Cadence mode": "Cadence 模式",
  "Cadence mode is on. Click to exit it.": "Cadence 模式已开启，点击退出。",
  "Your next message turns on Cadence mode. Click to cancel.":
    "发送下一条消息时将开启 Cadence 模式，点击取消。",
  "Turn on Cadence mode: agree on a plan before implementation.":
    "开启 Cadence 模式：先商定计划，再开始实施。",
  "Your next message turns on Cadence mode.":
    "发送下一条消息时将开启 Cadence 模式。",
  "The service is unavailable right now ({code}).":
    "服务暂时不可用（{code}）。",
  "Another operation is still in progress ({code}). Try again when it finishes.":
    "另一项操作仍在进行（{code}），结束后再试。",
  "Model credentials are unavailable ({code}). Check auth.json or the provider's API key.":
    "模型凭据不可用（{code}），请检查 auth.json 或提供方的 API key。",
  "A selected file was refused ({code}); nothing was changed. Run cadence doctor to see which file and field.":
    "所选文件被拒绝（{code}），未做任何修改。运行 cadence doctor 查看是哪个文件和字段。",
  "This is not supported here ({code}).": "此处不支持该操作（{code}）。",
  "A limit was reached ({code}).": "已达到上限（{code}）。",
  More: "更多",
  "Refresh status": "刷新状态",
  "Disconnect this page": "断开此页面",
  "Started work keeps running.": "已开始的工作会继续运行。",
  "No conversations yet.": "还没有对话。",
  "Conversations are kept with each project. Click a project to open it.":
    "对话按项目保存，点击项目即可打开。",
  "Opening…": "正在打开…",
  "Open a working folder to start. Each project keeps its own conversations.":
    "打开一个工作文件夹即可开始，每个项目保存各自的对话。",
  "Open a folder…": "打开文件夹…",
  "Open a working folder to start chatting.": "打开工作文件夹后即可开始对话。",
  "{path} could not be opened ({code}).": "无法打开 {path}（{code}）。",
  "Cadence service": "Cadence 服务",
  "Version, restart and upgrade.": "版本、重启和升级。",
  "Reading the service…": "正在读取服务状态…",
  "Runs as {unit} ({scope} systemd service).":
    "以 {unit} 运行（{scope} 级 systemd 服务）。",
  "This Cadence instance was not started by its systemd service, so the page cannot restart or upgrade it. Use cadence server restart in a terminal.":
    "此 Cadence 实例不是由 systemd 服务启动的，页面无法重启或升级它。请在终端中运行 cadence server restart。",
  "Last request ({time}): {outcome}": "上次请求（{time}）：{outcome}",
  "Installation: npm global.": "安装方式：npm 全局安装。",
  "Installation: npm local.": "安装方式：npm 本地安装。",
  "Installation: Bun local.": "安装方式：Bun 本地安装。",
  "Installation: Bun global.": "安装方式：Bun 全局安装。",
  "Installation: Pi-managed (npm).": "安装方式：Pi 管理（npm）。",
  "Installation: Pi-managed (Bun).": "安装方式：Pi 管理（Bun）。",
  "Pi pins this package version; change its package declaration explicitly before upgrading.":
    "Pi 固定了此包的版本；请先明确修改包声明，再升级。",
  "This account cannot write the installation; update it in a terminal.":
    "当前账户无法写入安装目录；请在终端中更新。",
  "The installation method could not be safely identified; update it using its original installation method.":
    "无法可靠识别安装方式；请按原安装方式更新。",
  Updates: "更新",
  "Update information is unavailable for this installation.":
    "无法获取此安装的更新信息。",
  "Check for updates": "检查更新",
  "Asking the package registry for the latest version…":
    "正在向软件包仓库查询最新版本…",
  "Cadence {version} is the latest version.":
    "Cadence {version} 已是最新版本。",
  "{version} is deprecated on npm and is not offered.":
    "{version} 在 npm 上已弃用，不提供升级。",
  "{version} is available, but this account cannot write the installation; upgrade it in a terminal.":
    "{version} 可用，但当前账户无法写入安装目录；请在终端中升级。",
  "{version} is available, but this installation requires a manual update using its original installation method.":
    "{version} 可用，但当前安装需要按原安装方式手动更新。",
  "Upgrade to {version}": "升级到 {version}",
  "Restart service": "重启服务",
  "Restart Cadence?": "重启 Cadence？",
  "Upgrade Cadence {from} to {to}?": "将 Cadence 从 {from} 升级到 {to}？",
  "The service stops in order and starts again; this page waits and then reloads.":
    "服务会按顺序停止并重新启动；此页面会等待完成后重新加载。",
  "The package manager downloads {to} while Cadence keeps running; then the service stops, {to} is installed and the service starts again. If {to} does not become ready, {from} is reinstalled.":
    "包管理器会在 Cadence 继续运行时下载 {to}；然后服务停止、安装 {to} 并重新启动。如果 {to} 未能就绪，会重新安装 {from}。",
  "{count} running workflows or conversations will be stopped.":
    "{count} 个正在运行的工作流或会话将被停止。",
  "Stop them and continue": "停止它们并继续",
  "Restart now": "立即重启",
  "Upgrade now": "立即升级",
  "Stopping Cadence…": "正在停止 Cadence…",
  "Cadence is starting again…": "Cadence 正在重新启动…",
  "Downloading {to}, then stopping Cadence…":
    "正在下载 {to}，随后停止 Cadence…",
  "Installing {to} and starting Cadence…": "正在安装 {to} 并启动 Cadence…",
  "This runs outside the service: closing or reloading the page does not stop it, and running work is stopped in order.":
    "此操作在服务之外运行：关闭或刷新页面不会中断它，运行中的工作会按顺序停止。",
  "Reload the page to reconnect to the new service.":
    "重新加载页面以连接新的服务。",
  "Details in a terminal:": "在终端中查看详情：",
  "Reload page": "重新加载页面",
  "Cadence did not report back within {minutes} minutes.":
    "Cadence 在 {minutes} 分钟内没有返回结果。",
  "Cadence answered with a different version.": "Cadence 以另一个版本响应。",
  "Cadence restarted.": "Cadence 已重启。",
  "Cadence {version} was already installed.": "Cadence {version} 已经安装。",
  "Cadence {version} is running.": "Cadence {version} 正在运行。",
  "Cadence {to} did not become ready; {version} was reinstalled.":
    "Cadence {to} 未能就绪，已重新安装 {version}。",
  "In progress…": "进行中…",
  "The restart did not finish: {reason}": "重启未完成：{reason}",
  "The upgrade did not finish: {reason}": "升级未完成：{reason}",
  "The release could not be downloaded; the service kept running.":
    "无法下载该版本；服务保持运行。",
  "The running service did not confirm its orderly stop.":
    "正在运行的服务没有确认有序停止。",
  "The package manager could not install the release.":
    "包管理器无法安装该版本。",
  "The new service did not become ready.": "新服务未能就绪。",
  "The service manager refused the operation.": "服务管理器拒绝了此操作。",
  "The job ended without reporting.": "任务在报告结果前结束。",
  "The service was not changed; this page stays connected.":
    "服务没有改动；此页面保持连接。",
  Close: "关闭",
  "Conversation branches": "对话分支",
  "Each line is a message; indented lines are branches. Choose one to read that branch. The terminal shares this tree (/tree in Pi).":
    "每行是一条消息，缩进的是分支。选择一行即可查看那条分支。终端里看到的是同一棵树（Pi 中的 /tree）。",
  "Only the newest messages are listed.": "只列出了最新的消息。",
  "Started in the terminal": "在终端中开始",
  "Started in the WebUI": "在 WebUI 中开始",
  "Branches ({count})": "分支（{count}）",
  Branches: "分支",
  "Show the latest": "查看最新",
  "Filter messages…": "筛选消息…",
  "Refresh branches": "刷新分支",
  "A chosen branch is shown, not the latest.":
    "当前显示的是你选中的分支，不是最新的。",
  "No messages yet.": "还没有消息。",
  "No matching messages": "没有匹配的消息",
  "Edit and resend: {text}": "编辑并重新发送：{text}",
  "Continue from here: {text}": "从这里继续：{text}",
  // The anchor: where the next message continues
  "Send the next message from the end of this turn. It starts a new branch there; the later turns stay on theirs and nothing is deleted.":
    "下一条消息接在这一轮结束的位置发送，并从那里开始一个新分支；后面的轮次留在原来的分支上，不会删除任何内容。",
  "Continue from here": "从这里继续",
  "Edit and resend": "编辑并重新发送",
  "Put this message back in the composer. Sending it starts a new branch beside this one; nothing is deleted.":
    "把这条消息放回输入框。发送后会在它旁边开始一个新分支，不会删除任何内容。",
  "Conversation turn, not in the new message's context":
    "对话轮次，不会进入新消息的上下文",
  "Version {index} of {count}": "第 {index} 个版本，共 {count} 个",
  "Previous version": "上一个版本",
  "Next version": "下一个版本",
  "This message cannot be rewritten from here: the entry it continued is not known.":
    "无法从这里重写这条消息：不知道它接在哪一条记录之后。",
  "Part of the message could not be read back. Check the text and images before sending.":
    "这条消息有一部分没能读回来。发送前请检查文字和图片。",
  "That message could not be found in this conversation.":
    "在这段对话里找不到那条消息。",
  "Rewriting a message": "正在重写一条消息",
  "Continuing after an earlier turn": "接在较早的一轮之后继续",
  "Send starts a new branch beside it; that message and the turns after it stay on their branch and are not in the new context.":
    "发送后会在它旁边开始一个新分支；那条消息和之后的轮次留在原来的分支上，不会进入新的上下文。",
  "Send starts a new branch after that turn; the turns after it stay on their branch and are not in the new context.":
    "发送后会在那一轮之后开始一个新分支；再往后的轮次留在原来的分支上，不会进入新的上下文。",
  "Only the conversation is rewound: files on disk stay as they are.":
    "回退的只是对话，磁盘上的文件不会变。",
  "Reading the message's images…": "正在读取这条消息的图片…",
  "Attachments that were not retained are not attached again.":
    "没有保留下来的附件不会重新附上。",
  "Cancel and restore the draft that was here": "取消，并恢复原来的草稿",
  Cancel: "取消",
  "A chosen branch is shown, not the latest. A message sent now continues from the end of what is shown; the rest stays in the session.":
    "当前显示的是你选中的分支，不是最新的。现在发送的消息会接在所显示内容的末尾，其余内容仍保留在会话中。",
  "From here on, the turns stay on their branch: the message being written will not have them in its context.":
    "从这里往下的轮次留在原来的分支上：正在写的这条消息的上下文里不会有它们。",
  // Question rail and composer
  "Questions in this conversation": "这段对话里的提问",
  "Message box height: automatic. Drag or use the arrow keys to set it.":
    "输入框高度：自动。拖动或用方向键可以调整。",
  "Message box height: fixed. Double-click or press Home for automatic.":
    "输入框高度：固定。双击或按 Home 键恢复自动。",
  Automatic: "自动",
  "{pixels} pixels": "{pixels} 像素",
  "Files to reference": "可引用的文件",
  "Files in the conversation folder": "对话文件夹里的文件",
  "Enter inserts the path · Esc closes": "回车插入路径 · Esc 关闭",
  "This Cadence conversation format is no longer supported. Start a new conversation; existing files are kept ({code}).":
    "此版本不再支持这类旧 Cadence 会话。请新建会话；原有文件会保留（{code}）。",
} satisfies Record<string, string>;
