# 持续并行工作流验收记录

本记录对应 `autonomous-parallel-workflow-goal.md` 的开发授权和 a–h 回归要求。
它记录 Cadence 自身的工程验证，不是 Gate、ready receipt 或某个产品 Implement run 的完成证明。
所有运行测试均使用临时 consumer、状态目录和测试夹具。

## 实现与兼容性

任务合同增加可选的 `baselineVerification`。
新编译只有在 affected 的全部输入是原始安全普通文件时才允许省略；未来测试需要显式的既有 baseline。
旧 canonical plan 保持可读，但缺少新身份绑定的旧证据不会自动授权复用。
编译器检查 producer 可达性、阶段时序、删除和 AGENTS checkpoint，并保留新测试的阶段、affected、repair、累计及最终义务。
这里的静态检查覆盖声明输入和受支持的适配器，不能证明任意脚本内部的动态依赖。

基线在任务可运行后按需采集，独立保存成功和失败事实，始终读取 run 的原始不可变 revision。
准备失败不预留 Worker 工作预算。
失败复用绑定原始 revision、验证语义、稳定任务义务、环境和策略，跨交付修订保存在已有 ledger 中；当前任务、verifier 和 producer 身份仅在验证已存观察后重新投影。
恢复计数忽略改名，但用稳定的任务阶段读写边界区分独立 owner；一个 owner 耗尽不会封锁其他任务。
实际前提变化仍受原有恢复上限约束，一次性恢复授权在准备前原子记录消费和 launch 事件，旧失败序号不能重放。

状态机沿用四个共享槽位、现有冲突队列、隔离候选和事务 apply。
单个任务结算或其他 run 释放容量即重新选取任务。
已选择的任务在等待 baseline 时使用既有 `phase-ready` 状态保留冲突占用，防止新解除依赖的任务抢跑。
取消和关闭等待已启动的准备、Worker、验证与资源结算；准备结束后重新检查取消，避免关闭期间启动新 Worker。
取消命令在原操作结算后暂停被 fence 的活动任务，并返回更新后的状态。
完整验收和 post-apply 仍是 run 完成的必要屏障。

只有父控制面从原始输入证明的授权内缺陷可进入既有 batch-bound amendment。
裸 `delivery-invalid`、unsafe、未知错误、hash/proof/receipt/currentness 异常不产生修订权限。
baseline 专属修订保留兼容阶段、成果、检查点和已消耗预算；Gate A 由已有 Design journal 继承，Gate B 重新编译封存。
没有新增通用恢复引擎、数据库 schema 迁移或 package version reset。

Design 摘要区分互不冲突、最多四项的初始组与后续静态兼容任务对，列出 producer 等待、并存的冲突原因及全局验证屏障。
摘要是只读审阅资料，初始组假设共享槽位可用；运行时前提仍由 Implement 检查。

## 回归证据

已落盘的 Red 与后续 Green 日志保留在本机 `/tmp/cadence-parallel-baseline/`；部分定向回归仅保留在会话工具输出中。
这些临时日志不随包发布；回归测试本身保留在仓库。

| 要求                                  | 保留的证据                                                                                                                                                                                                                                                                                |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a：输入时序、原始字节、跨任务依赖     | `verification-input-timing.test.ts` 覆盖未来测试、已有修改输出、依赖、删除和 checkpoint；`compiler-red.log` 为初始失败。真实隔离用例由 Red 创建原始不存在的测试。                                                                                                                         |
| b：新增测试不被遗漏或豁免             | 编译器覆盖单项及同时删除多个局部义务；`compiler-retention-red.log` 有三处真实失败。`verification-attribution.test.ts` 和 `task-baseline.test.ts` 检查不可比义务不能共享失败豁免；真实隔离执行完整新测试链。                                                                               |
| c：重叠、四槽、立即补位、队列预算     | `workflow-engine.integration.test.ts` 使用受控屏障证明四个任务重叠、快任务结算后第五项先于慢任务启动，以及跨 run 释放容量唤醒；依赖、冲突、FIFO 和排队预算回归保留。Red 为 `refill-red.log`、`capacity-event-red.log`、`preparation-conflict-red.log`。                                   |
| d：局部前提仅阻塞相关任务             | 按需 baseline 测试保存 sibling 成功证据；引擎测试让一个任务 baseline 不可用、一个 sibling 活动、一个 dependent 等待，并断言 run 不完成及只有 sibling 消耗预算。`verification-environment-local.test.ts` 检查缺少局部 runner 不使独立检查失败。                                            |
| e：同 run 修订和证据保留              | `runtime-worker-broker.integration.test.ts` 覆盖原始 revision、baseline amendment 与 reopen；真实 Design journal/package delivery/extension tool 用例封存第二版、继承 Gate A、在新 extension context 无 receipt 参数发现续跑，并保留 Red 与预算。                                         |
| f：无变化不重试，变化有界，改名不退款 | baseline 缓存回归覆盖 resume/reopen、交付修订、verifier/task 改名与实际环境变化；`prerequisite-rename-red.log` 证明旧行为在第二版误增恢复计数，修复后计数稳定；`baseline-owner-red.log`、`baseline-grant-red.log` 覆盖独立 owner 和恢复授权重放。原有工作预算、高水位和恢复授权回归保留。 |
| g：无裸错误码修订，诚实暂停           | status、engine、package delivery、adapter 回归拒绝不安全/未知/完整性故障授权，保留取消、耗尽与基础设施失败分类；`authority-red.log` 和 `input-observation-red.log` 保留相应失败证据。                                                                                                     |
| h：结算、重开、currentness、事务恢复  | 并行准备取消/关闭回归先失败于关闭后仍启动 Worker，后修复；日志 `preparation-cancel-red.log`。完整 runtime broker、apply transaction、SQLite、directory-sync 与真实 Linux 后代终止回归检查资源结算及恢复。                                                                                 |

跨修订/改名缓存回归的初次失败是两个 baseline 检查被执行四次而非两次；独立读写边界 owner 回归的初次失败是两个任务 baseline 被错误合并为一次。
这两项先失败后通过的输出保留在会话中，没有另存日志文件。
并发结果按调用者重投影的额外测试在实现后首次即通过，属于补充覆盖，不作为先失败证据。

真实隔离新增用例使用真实 Bubblewrap、package verifier、候选工作区、阶段/累计验证、存储 reopen 和事务 apply。
它的 delivery source 和 candidate proposer 是确定性测试替身，不是实时模型执行。
真实 Design 续跑用例使用真实 journal、编译、Gate proof、receipt discovery 和 extension 工具，但 Worker/准备端口与 OpenSpec 状态探针采用确定性夹具。
另行启用的 OpenSpec CLI 合同测试记录实际安装版本，不能代替未执行的平台矩阵。

## 最终命令结果

| 验证                                         | 实施前基线                                | 最终结果                                                                                                              |
| -------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `bun run verify`                             | 946 passed / 25 skipped；pack 104 members | 1001 passed / 26 skipped；syntax、generated freshness、TypeScript、Biome、Markdown 与 pack 全部通过，仍为 104 members |
| 真实 Linux Bubblewrap 五文件回归             | 36 passed                                 | 37 passed，包含新增原始缺失测试全流程                                                                                 |
| `bun run traceability:check`                 | 70 refs / 3 active changes                | 102 refs / 4 active changes，每条 Scenario 恰有一个 owner                                                             |
| 当前 OpenSpec specs 严格验证                 | 未单独记录                                | 4 passed / 0 failed；新 change 严格验证通过                                                                           |
| 启用真实 OpenSpec CLI 的 Design/CLI 合同测试 | 未单独记录                                | 90 passed / 1 skipped；本机 CLI 1.12.0                                                                                |

最终完整日志为 `verify-final-complete.log`、`isolation-final.log`、`traceability-final.log`、`specs-final.log` 和 `openspec-real-final.log`。
基线没有已有失败，最终没有新增失败。
全量套件新增的一个默认 skip 是需要显式开启真实 Linux 隔离的用例，已在 37 项原生回归中执行。
其余条件性跳过不等于通过；真实 OpenSpec 的启用检查单独列出，Windows/macOS 和 CI Node 版本矩阵未执行。
原有 directory fsync、SQLite reopen/rollback、apply transaction 和后代终止回归保留并通过各自所在的完整或原生套件。
最终结算专项审查未留下未解决问题。

## 授权与保留边界

开发未操作真实 run `afea9483-02e6-4281-94f2-e6795ae6b1fe`。
未提交或发布，未修改 host-trusted 产品、原有 CI/prototype 工作、包版本或真实控制数据库，未启用新的 trusted 执行路径。
已有测试中的 local-trusted 夹具仅作为原有回归执行；新增原生用例显式使用 isolated。
AGENTS 只增加管理区索引，管理区外字节与原始文件一致。
Windows/macOS 原生隔离及 CI Node 版本矩阵未在本次 Linux 工作区执行。
