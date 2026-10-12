# 年度运动日历、基础统计与道路底图本地验收

日期：2026-10-12。沿用已验收的认证、GPX、活动表与 PostGIS 数据；本次交付阶段三地图增强与阶段四日历/基础统计的最小业务范围，不代表整个阶段四关闭。

## 访问与启动

- 仪表盘：http://127.0.0.1:5183/dashboard
- 导入/记录：http://127.0.0.1:5183/activities
- 已登录合成验收账户的底图详情：http://127.0.0.1:5183/activities/1ce3f32c-b934-4ecf-8bca-133263ed84dd
- 后端：http://127.0.0.1:8001 。既有 8000/5173 服务未操作；8001 已更新为当前实现，5183 热更新。

服务已运行时直接访问，不重复启动。停止后从仓库根目录：

```sh
backend/.venv/bin/python scripts/local-auth.py serve --port 8001 --site-origin http://127.0.0.1:5183
```

另一个终端：

```sh
cd frontend
INTERNAL_API_BASE_URL=http://127.0.0.1:8001 pnpm dev --port 5183
```

复用既有本地认证密钥，不显示密钥、不修改 `.env`。无需执行迁移。

## 用户功能及统计口径

年度日历显示完整 365/366 天，周一开始，支持 1900–2100 年、距离/次数色阶、同日多次聚合、点击日期读本人当天分页记录。灰色表示没有记录；零距离活动保留活动色。色阶按所选年份最大值分四档，不表示跨年绝对对比。年份、维度、周期和日期写入 URL，可在刷新或身份复查重新挂载后恢复；私人数据仍重新经认证读取。

累计及年度统计包含距离、次数、运动天数、已知耗时合计及覆盖量、可靠平均配速及覆盖距离。ECharts 显示自然周（周一）/自然月趋势，可切换距离、次数、已知耗时、配速；数据表提供完整数值，空桶补齐，部分周期有标记。

日期按导入时保存的 `activity_date` 和时区快照归属，避免 UTC 转换偏移；账户以后改变时区不移动历史活动。默认年份按当前用户时区计算。

耗时仅求和已知值，并明确已知/未知活动数量；全无已知耗时返回 NULL。平均配速仅纳入正距离、正耗时且时间质量 complete/manual 的记录，以总耗时除以总距离计算（秒/km，半偶舍入至三位小数），不平均各次配速、不为缺时间记录虚构数值。

后端从活动摘要即时聚合，无新增统计表、轨迹点扫描或汇总缓存。全部查询显式限定认证用户。

接口：

- `GET /api/v1/statistics/calendar?year=2024&metric=distance|count`
- `GET /api/v1/statistics/summary` 为累计；可提供配对 `date_from/date_to`。
- `GET /api/v1/statistics/trends?date_from=2024-01-01&date_to=2025-01-01&period=week|month|year`
- 活动列表新增可选 `activity_date=YYYY-MM-DD`，分页总数使用同一过滤条件。

范围左闭右开、1900–2100 年、单次最多五年，异常参数返回422。前端仅使用本轮周/月趋势。

## 地图来源及降级

MapLibre 使用 OpenStreetMap 标准栅格瓦片 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`，可见 © OpenStreetMap contributors 链接指向版权页。遵守 [官方瓦片政策](https://operations.osmfoundation.org/policies/tiles/)：标准 HTTPS 端点、正常浏览器 Referer/缓存、无批量下载、离线缓存或预取。

本地样式和 GeoJSON 轨迹先显示，外部栅格不阻塞路线。瓦片错误/超时移除栅格，保留原分段、起终点与指标，提示并支持重试和关闭底图。外部服务接收当前视口瓦片请求元数据，不上传整份 GPX。标准瓦片为尽力服务，无 SLA；未来生产规模需重新评估服务容量与条款。

## 实际验收

| 项目 | 结果 |
| --- | --- |
| 后端单元、认证、GPX、统计集成 | 220 passed，27.21s；既有独立 `running_note_phase_one_test`，禁迁移开关开启，无跳过冒称通过 |
| 前端 `pnpm test` | 最终 7 文件、27 项通过 |
| 前端 `pnpm check` | 0 errors、0 warnings |
| 前端 `pnpm build` | 成功；MapLibre 和 ECharts 按需 chunk 超500kB提示仍存在 |
| Ruff check / format --check | 通过，59个相关Python文件 |
| `git diff --check` | 通过 |
| Chrome 日历 | 2024年366天；距离/次数切换、同日3次列表、空的2月29日提示通过 |
| Chrome 趋势与恢复 | 周/月图表实际渲染；刷新和触发focus身份复查后保持2024年、次数、月周期和2月29日选择 |
| Chrome 底图成功 | 上海公开坐标合成GPX实际上传，街道底图、路线、2个标记与署名可见 |
| Chrome 瓦片故障 | 阻断瓦片网络后路线与2个标记仍显示；错误提示、重试、关闭通过 |
| Chrome 用户隔离 | A累计4次，B在独立上下文正常登录后累计1次/1113.195m，当天列表1次；B请求A详情404 |
| Chrome 匿名保护 | dashboard重定向登录；summary/calendar/trends均401 |

已有A账户2024年数据库对照：3次、1558.473m、1个活动日；已知耗时840秒（2次已知/1次未知）；配速有效距离1335.834m、平均628.821秒/km；质量提示1次。新上海合成路线为2026年10月12日，约301m/360秒，只增加普通验收活动，不覆盖已有记录。

自动化覆盖同日多次、闰年/世纪年、时间快照日期、缺耗时NULL、加权配速、自然周月与截短桶、空桶、参数范围及用户隔离。独立只读代码审查发现统计重试应保留日期选择，已修复，并在 Chrome 阻断累计请求后实测重试恢复，月数据表12行；其余未发现重要问题。故障注入产生预期网络控制台错误。

截图位于忽略目录 `frontend/test-results/history-dashboard.png`、`map-basemap.png`、`map-fallback.png`；浏览器 CLI 记录归档于 `frontend/test-results/history-cli/`。

## 本轮文件

- 后端：`app/modules/statistics/{schema,service,router}.py`、`app/main.py`；`app/modules/activities/{router,service}.py`；`tests/integration/test_statistics.py`。
- 前端：`src/lib/api/{statistics,dashboard-query,map-style,activities}.ts`；`src/lib/components/{CalendarGrid,TrendChart,RouteMap}.svelte`、`trend-chart-runtime.ts`；`src/routes/dashboard/+page.svelte`；`tests/unit/{statistics,dashboard-query,map-style}.test.ts`；`package.json`、`pnpm-lock.yaml`（ECharts6.0.0）。
- 文档：本文、README、第二阶段进度、`docs/superpowers/plans/2026-10-12-calendar-statistics.md`。

上述以本轮范围列出；Git 工作区还包含此前认证/GPX尚未提交的文件，全部保留。

## 边界与未验证

未修改 `.env`，开发 schema 保持 `0003_gpx_storage`；未迁移、清库、重建数据库、重置限流、使用Docker、提交、推送或部署。保留8001/5183供本地使用。

未验证生产负载、远程CI、移动设备兼容性与长期瓦片服务可用性；现有按需大chunk提示尚未消除。本轮用户功能本地验收通过，不提前实现公开分享、AI分析或空间热力图。
