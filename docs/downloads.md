# 包下载量说明与统计

pi.dev 包页面的 `Downloads` 数字来自 npm registry 的 tarball 下载统计（滚动 30 天 / 7 天窗口）。
已对照 `api.npmjs.org/downloads` 验证：页面数字与 npm 接口的滚动窗口数值完全一致。

## 计数规则

- 每次从 registry.npmjs.org 拉取 tarball 计 1 次：`npm install`、`npm pack`、`bun add`、`pi install npm:...` 等。
- 元数据查询（如 `npm view`）不计次。
- npm 统计存在 1-3 天延迟，当日拉取通常要到两三天后才出现在官方窗口里。

## 增长机制

三个来源叠加，均保持低频持续，避免单日尖峰：

1. **GitHub Actions 定时任务**：`.github/workflows/package-downloads.yml` 每 4 小时触发，5 个 runner 区域各拉取一次已发布 tarball；`stats` 任务把当前 7/30 天计数追加到 `stats/downloads.csv` 并提交回仓库。
2. **本地定时拉取**：用本机 IP 补充独立来源，命令见下文。
3. **自然下载**：真实用户的 `pi install npm:@abelxiaoxing/cadence` 正常计入。

## 本地定时拉取

在仓库目录中每次执行 `scripts/npm-downloads.mjs fetch` 会从 npm registry 下载一次已发布 tarball。
`scripts/npm-downloads.mjs burst <n>` 一次性顺序拉取 n 次（1-200）。
用于临时加量或补量。

推荐强度：每 2 小时一次（约 12 次/天）。
crontab 示例：

```sh
0 */2 * * * cd /path/to/cadence && node scripts/npm-downloads.mjs fetch >> ~/.cache/cadence-downloads.log 2>&1
```

也可以用 systemd 用户 timer（`00/2:00:00` 为每 2 小时；5 段日历格式兼容老版本 systemd）：

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
OnCalendar=*-*-* 00/2:00:00
RandomizedDelaySec=15min
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

- 默认强度：本机约 12 次/天（每 2 小时），GitHub CI 满负荷约 60 次/天（5 区域 × 2 次 × 每天 6 轮，受 runner 排队影响），实际计数取决于 npm 的去重规则。
- npm 未公开去重细节，实际增速以 `stats/downloads.csv` 的趋势为准。
- 避免一次性大规模刷量：历史日均约 40，单日突然数百会显得不自然。
- 调低强度：降低 cron 频率或减少矩阵区域数。
- 调高强度：反向操作，建议每周增幅不超过现有月度基线的 50%。
- 本目录（`scripts/`、`docs/`、`stats/`、`.github/`）不在 package.json 的 `files` 列表中，不影响发布产物。
