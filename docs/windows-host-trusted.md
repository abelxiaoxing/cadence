# Windows 原生可信执行

Windows x64 原生验收已通过：2026-09-16 的 [CI 运行 35104235413](https://github.com/abelxiaoxing/cadence/actions/runs/35104235413)，提交 `3dad869`。
Node 22.13.0 和 24.13.0 均完成源码测试及实际 Windows tarball 解包后的测试。
验收包括基线、Red、暂停重开、Green、累计验证、apply/post-apply、npm hooks/嵌套脚本/失败短路、中文路径依赖替换，以及取消、超时、根进程先退出和 helper 丢失时的后代清理。
Windows tarball 保存在该运行的 `windows-implement-node-*` artifacts 中，保留期为 7 天；源码保留显式重建入口。
`v1.8.0` 的正式 Windows x64 包通过 [GitHub Release](https://github.com/abelxiaoxing/cadence/releases/tag/v1.8.0) 提供，文件名为 `cadence-1.8.0-windows-x64.tgz`；npm 同版本通用包附带源码和显式构建工具。
这是 Windows Server 2022 x64 上的真实 CI 证据；不代表 macOS、Windows ARM64 或所有 Windows 版本均已验收。

## 选择执行模式

Windows x64 的可信项目使用 `host-trusted`。
默认仍是 `isolated`，不会因为 Bubblewrap 不可用而自动切换可信执行。
在启动宿主之前设置 PowerShell 环境变量：

```powershell
$env:ABEL_EXECUTION_MODE = 'host-trusted'
# 使用外部构建的 helper 时指定；Windows 专用包默认使用包内 src/windows-job.exe。
$env:ABEL_WINDOWS_JOB_HELPER = 'C:\CadenceNative\windows-job.exe'
$env:ABEL_VERIFICATION_TIMEOUT_MS = '600000'
# 仅在验证确实需要时显式继承：
$env:ABEL_VERIFICATION_ENV = 'DATABASE_URL,NODE_ENV'
```

普通源码包附带 C 源码和构建工具，不附带未经原生构建的二进制。
Windows 专用 tarball 由下述构建与打包步骤生成，额外包含 helper 和对应 manifest。
没有下载、安装钩子或运行时编译。
缺失、被改动、架构错误或与源码不匹配的 helper 会阻止执行。

运行 `bun run doctor` 检查真实 Job 创建与执行能力。
已安装包也可使用 `node <package>\src\operator-cli.mjs doctor`。
Windows ARM64、UNC/device 路径及 macOS 不在此后端首期范围内。

## 构建与原生验收

维护者在 Windows x64 的 Visual Studio 2022 x64 开发者环境中，使用 MSVC 19.3x/19.4x 和 Windows 10 SDK 执行：

```powershell
node src/build-windows-job.mjs --output C:\CadenceNative
$env:ABEL_WINDOWS_JOB_HELPER = 'C:\CadenceNative\windows-job.exe'
$env:CADENCE_REAL_WINDOWS_JOB = '1'
node node_modules/vitest/vitest.mjs run test/windows-job-real.integration.test.ts
node scripts/pack-windows.mjs --helper C:\CadenceNative\windows-job.exe --output C:\CadenceWindowsPackage
```

已安装的普通包也包含 `src/build-windows-job.mjs`，可显式构建外部 helper 后配置其路径。
构建使用静态 C runtime，并记录源码、helper、编译器哈希和 SDK 版本。
Windows 专用打包校验普通包成员清单加上两个明确的原生文件；它不会发布包。

CI 在 Windows x64、Node 22.13.0/24.13.0 的每个任务中先要求对应 Windows prototype 原生测试通过，再构建新协议 helper，运行源码验收，构建并解包 tarball，然后从解包后的源码和 helper 再运行验收。
原有 macOS prototype 矩阵继续独立运行；Windows 支持不代表 macOS 支持。
原生任务缺少能力时失败，不静默跳过。
原型的 v1 manifest 不能替代生产后端的 v2 helper。
原型结果也不能替代新后端和发布包的实际验收。

## 执行与恢复约定

- 测试在独立候选目录执行，依赖使用副本，workspace 依赖指向候选代码。
  候选补丁保持提交的原始换行字节，不受宿主 Git autocrlf 设置改写；Windows 清理使用支持 Unicode 的 unlink/rmdir。
  保留原测试命令、预期失败身份、报告校验、基线与 Red/Green 流程。
- helper 使用 Windows 10 的 `PROC_THREAD_ATTRIBUTE_JOB_LIST` 原子建立 Job 成员关系，进程挂起创建，确认 Job 成员关系后恢复。
  禁止 breakaway，Job handle 不继承，最后一个 handle 关闭会终止受管进程。
- 根进程退出与整个 Job 结束分别观察。
  超时或取消必须等待 Job 结束；普通非零退出只有在 Job 已结束且 helper 报告完整时才进入产品测试判定。
  helper 的标准输出协议和测试输出隔离；测试的 stdout/stderr 合并捕获，显示日志有界，失败身份流式匹配。
- Windows 环境提供 `SystemRoot`、`ComSpec`、`PATHEXT` 等运行必需变量，以及私有 HOME、USERPROFILE、APPDATA、LOCALAPPDATA、TEMP/TMP 和 npm 缓存。
  其他环境值只按显式配置继承。
- 平台、架构、Node、helper/manifest 字节和执行模式参与证据身份。
  改变后端不能直接复用旧验证结果。
  源码变更未提升包版本，也未重置或迁移用户运行。

**可信执行不是安全沙箱。**
测试拥有当前用户的宿主文件和网络权限；私有目录和依赖副本不能阻止测试主动访问其他路径。
该模式不改变 Linux `isolated` 或 `local-trusted` 的隔离约定。

每次 host 执行前在外部状态目录写入 `.cadence-execution-*.json`，确认进程范围结束后才删除。
宿主丢失、helper 异常或终止无法确认时保留候选目录、临时目录及记录，暂停执行，阻止新执行、apply、清理和包升级重置。
若在 post-apply 验证期间发生，保留已应用内容和事务恢复材料，不能报告成功或在未确认终止时自动回滚。

保留记录不是可据此杀进程的 PID 清单。
应先关闭旧宿主，并由操作人员确认旧验证进程已停止（必要时重启 Windows）；检查记录列出的目录、Git diff 和事务状态后，备份并移除对应保留记录，再启动新宿主进行恢复。
不要通过改业务项目、删测试、改数据库或伪造完成证据绕过暂停。
