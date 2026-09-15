# 用于 /goal 的开发目标正文

在你使用的界面中通过 `/goal` 设置目标时，使用以下正文。
本文件不假定 `/goal` 的额外参数语法；引用该命令不会在当前对话中启动目标。

```text
在 /home/mirako/abel/cadence 开发 @abelxiaoxing/cadence 的持续并行工作流能力。

本目标授权按 docs/autonomous-parallel-workflow-design.md 的架构实施，不再停在调查或方案阶段。先阅读该文档、AGENTS.md、package.json 和当前 Git diff，核对现状后持续完成代码、回归、集成和验证。只有影响目标/授权边界的实质歧义才集中询问；普通技术选择按已批准架构自行解决。

这是开发 Cadence 自身的普通工程任务，不是启动 host-trusted change，也不自动激活任何 Abel 阶段。若当前已有显式激活的阶段，先遵守其边界，不通过本提示词绕过它。被开发产品的职责必须保持：abel-design 设计和封存，abel-implement 在前提满足后执行与恢复。

目标：
1. Design 产出可供独立 subagent 执行的任务图：明确依赖原因、输入/输出 producer、阶段读写边界、验收、冲突、资源和验证前提；投影实际可并行任务及串行原因。
2. Implement 复用现有四个共享槽位、隔离 Worker 和状态机。独立任务并行；单个任务结算就立即补位，不等待整批慢任务。任务内部遵循 Red→Green→Refactor，跨任务仅消费已完成 producer 的有效输出。
3. 区分原始 baseline 与候选/affected/累计验证的输入时刻。未来 Red 测试不得作为原始 baseline 必需输入；新增测试仍完整参与阶段、affected 和最终验收。
4. 局部计划缺陷或外部能力缺失只阻塞相关任务及依赖者，安全独立工作继续。真实全局前提、完整验收和 apply 保留全局屏障。
5. 已证明的授权内技术缺陷通过现有 batch-bound amendment 修订，保留 Gate A、原 run、进度、预算和有效阶段证据，重新编译封存后自动发现交付并继续。用户不需重复审批、切换阶段或复制 receipt。
6. 区分未来产物缺失、既有文件缺失、依赖漂移、Worker 候选错误、外部能力缺失和不安全/未知错误。恢复必须有证据、有界；相同前提的 resume 不重复启动 Worker 或相同失败验证。无合法自动动作时报告具体 blocker、保留进度和最小外部恢复条件。

执行方式：
- 先记录目标测试、受影响测试及全量测试基线，区分预先存在失败。
- 在合成临时工作区和状态存储中复现，先写能证明缺陷的失败回归，再做最小实现和重构。
- 我授权你在开发本功能时使用多个 subagent：父代理先确定共享合同和接口；只并行委派有明确目标、互不重叠写集的模块任务。共享接口、全局配置、状态转换、集成与最终验证由父代理负责。不要让多个代理同时修改 workflow-state-machine.ts 等共享文件。
- 复用既有 compiler、scheduler、status、amendment、恢复事实与存储，不建立第二套引擎、通用恢复平台或能力注册平台。
- 实施顺序遵循架构文档的依赖；prompt 与用户状态在代码支持后接线，不能只改 prompt 宣称完成。
- 完成所需 OpenSpec/traceability 和文档同步，但不伪造 Gate、ready、验收或已封存交付。

必须有先失败后通过的回归：
a. 未来测试不进入原始 baseline；既有文件作为未来修改输出时仍可读取原始字节；Red→Green 和合法跨任务依赖正常。
b. 新测试在阶段、affected、累计和最终验收中没有被删除或按预先存在失败豁免。
c. 至少两个独立任务实际并发；总容量不超过四；快任务结束后慢任务未结束时下一可运行任务已启动；依赖/冲突安全，排队不耗尝试预算。
d. 局部 baseline/外部能力失败不阻塞独立任务，不能提前宣告整个 run completed。
e. 计划缺陷获得受控 continuation；修订及 reopen 后同 run 保留已完成阶段、证据、预算、检查点；不要求阶段切换或重复 Gate A。
f. 无前提变化的 resume 不启动 Worker/重复失败验证；能力确实恢复后才有界继续；预算与恢复记录不能被重命名或重编译重置。
g. 未知错误、不安全路径、hash/receipt/currentness 异常不能仅凭错误码获得计划修订权限；取消、终止失败和预算耗尽仍诚实暂停。
h. 修订、并发合并、cancel/close、存储 reopen 和事务恢复没有遗留后台写入或失效候选；既有 Linux bwrap 和 fsync 回归保留。

不可退让的边界：
- 不绕过 Gate/receipt/hash/traceability/currentness，不伪造验证、审批或完成事实。
- 不在原始 baseline 直接创建缺失测试，不删除验收以通过检查。
- 不手改数据库、不清空证据/任务/检查点/预算、不自动 discard、不通过新 run 或改名返还预算，不借 package version reset 迁移本功能。
- 不自动开启 trusted 模式、切换 Abel 阶段，不把超时、启动失败、缺工具或终止失败当 expected-red。
- 不实现 host-trusted 产品功能；openspec/changes/add-host-trusted-execution 仅作只读回归参考。
- 不操作、恢复、重置或修改真实 run afea9483-02e6-4281-94f2-e6795ae6b1fe；不要未经只读核实引用其历史状态。
- 保留工作区已有修改，不覆盖、撤销、提交、发布；如需更新 AGENTS，只改管理区并逐字保留区外内容。

完成前执行 bun run verify、bun run traceability:check 和适用的真实 Linux bwrap 回归。对照基线报告新增失败、预先存在失败和未执行项；明确区分单元、模拟与真实平台，不把 Linux 通过说成 Windows/macOS 原生通过。

持续工作直到上述开发和验证完成，或没有安全可推进工作且存在具体外部 blocker。不要因普通技术问题停在“建议下一步”。最终报告代码变化、验收证据、兼容性、预算/授权边界和剩余风险。仅在必需工作确实完成时把 goal 标记为完成，不以目标工具结束或某个 subagent 完成为产品成功。
```
