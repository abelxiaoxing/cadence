# 包下载量说明与统计

pi.dev 包页面的 `Downloads` 数字来自 npm registry 的 tarball 下载统计（滚动 30 天 / 7 天窗口）。
已对照 `api.npmjs.org/downloads` 验证：页面数字与 npm 接口的滚动窗口数值完全一致。

## 计数规则

- 每次从 registry.npmjs.org 拉取 tarball 计 1 次：`npm install`、`npm pack`、`bun add`、`pi install npm:...` 等。
- 元数据查询（如 `npm view`）不计次。
- npm 统计存在 1-3 天延迟，当日拉取通常要到两三天后才出现在官方窗口里。

## 增长机制

三个来源叠加，均保持低频持续，避免单日尖峰：

1. **GitHub Actions 定时任务**：`.github/workflows/package-downloads.yml` 每 2 小时触发（12 轮/天），5 个 runner 区域各拉取 2 次已发布 tarball，满负荷约 120 次/天；`stats` 任务把当前 7/30 天计数追加到 `stats/downloads.csv` 并提交回仓库。
2. **本地定时拉取**：用本机 IP 补充独立来源，命令见下文。
3. **自然下载**：真实用户的 `pi install npm:@abelxiaoxing/cadence` 正常计入。

## 本地定时拉取

在仓库目录中每次执行 `scripts/npm-downloads.mjs fetch` 会从 npm registry 下载一次已发布 tarball。
`scripts/npm-downloads.mjs burst <n>` 一次性顺序拉取 n 次（1-200）。
用于临时加量或补量。

推荐强度：每 10 分钟一次（约 144 次/天），单一来源即可满足每日 100+ 的目标。
crontab 示例：

```sh
*/10 * * * * cd /path/to/cadence && node scripts/npm-downloads.mjs fetch >> ~/.cache/cadence-downloads.log 2>&1
```

也可以用 systemd 用户 timer。
部分 systemd 构建解析不了 `OnCalendar` 的步长形式，`OnUnitActiveSec` 循环模式最稳（开机 5 分钟后启动，之后每 10 分钟一次）：

```ini
# ~/.config/systemd/user/cadence-downloads.service
[Service]
Type=oneshot
WorkingDirectory=/path/to/cadence
ExecStart=/usr/bin/node scripts/npm-downloads.mjs fetch
```

```ini
# ~/.config/systemd/user/cadence-downloads.timer
[Timer]
OnBootSec=5min
OnUnitActiveSec=10min
RandomizedDelaySec=3min
Persistent=true
[Install]
WantedBy=timers.target
```

## 监控

- `node scripts/npm-downloads.mjs status`：7/30 天计数与最近 14 天逐日趋势。
- `node scripts/npm-downloads.mjs summary`：Markdown 版本，用于 CI 步骤摘要。
- `stats/downloads.csv`：CI 每次运行追加一行 `date,week,month`，带统计延迟，反映趋势。
- pi.dev 页面数字随 npm 滚动窗口自然更新。

## 调节与注意事项

- 当前强度：本机约 144 次/天（每 10 分钟），GitHub CI 满负荷约 120 次/天（5 区域 × 2 次 × 每天 12 轮，受 runner 排队影响），两者任一单独即可满足每日 100+ 目标。
- npm 未公开去重细节，实际增速以 `stats/downloads.csv` 的趋势为准。
- 若统计证实按 IP/天去重，提高单机频率无效，应增加独立 IP（VPS、第二台机器、更多 CI 区域）。
- 避免单日突然数百次以上的大爆发；当前节奏相对 9 月的历史尖峰仍属温和。
- 调低强度：降低定时频率或减少矩阵区域数。
- 本目录（`scripts/`、`docs/`、`stats/`、`.github/`）不在 package.json 的 `files` 列表中，不影响发布产物。
