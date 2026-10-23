# 个人足迹：全部记录与自动整合快照

日期：2026-10-15。

## 使用方式

个人足迹的「轨迹叠加」「运动热力图」都读取本人全部历史记录，移除年份和日期范围。旧带年份链接会进入全量视图，仅保留模式。无轨迹活动计入总记录数，地图另显示可展示数。

导入 GPX、TCX、小米运动记录，或编辑、单条/批量删除后，已有活动数据版本号使旧快照立即不可读取；页面显示正在生成，后台每 60 秒扫描并计算缺失的单活动派生结果。生成完成后，等待中的页面每 5 秒读取进度并自动展示。队列等待可能超过一个扫描周期，不保证导入后 60 秒内完成。

后台每 24 小时刷新一次整合结果，复用未改变的空间缓存。每用户仅一份成功快照，两种模式在同一事务替换；删除活动级联清理对应派生缓存。清理不删除原始活动与源文件。定期刷新失败时，如果源版本仍一致，保留有效结果并提示后台重试；源版本变化则不展示旧路线。

本轮代码交付未执行开发库迁移或重启开发后端。需完成受控数据库升级并启动新版后端后，实际开发服务才能提供新接口与后台任务。

## 改动范围

- 后端新增 `footprints/model.py`、`schema.py`、`snapshot.py`、`worker.py`，注册到模型与应用生命周期；原有日期范围计算服务与省份接口保持不变。
- 新增迁移 `0010_footprint_snapshots`，建立私有单活动缓存和用户快照两张表；复合外键保证活动与用户归属一致，防御性降级拒绝丢弃已有派生数据。
- 前端扩展足迹 API 运行时校验，页面移除筛选，地图仅扩展数据类型。保留交互、主题、底图失败兜底、完整数据表与详情入口。
- 新增快照单元、真实 PostGIS 集成和前端状态测试；既有迁移测试动态读取发布 head，并分别测试历史迁移自己的防丢失逻辑。

## 接口与隐私

新增受认证保护的 `GET /api/v1/footprints/all?mode=tracks|heatmap`。仍返回 `{data,error,meta.request_id}`，data 包含 `status`、`generated_at`、`refreshing`、`refresh_failed`、`result`。

`result` 仅在成功版本与当前用户数据版本及算法版本一致时存在；全量集合明确 `scope=all`，不伪造日期范围。GET 只读取选定模式及状态，不执行空间计算或访问原始点/段，也不读取另一个模式的大型 JSON。匿名返回 401，未知参数返回 422，不接受 owner 参数，响应维持 no-store。

单活动热区沿用完整边与固定 100×100 EPSG:3857 网格相交，再按活动内去重；同活动绕圈或多段同格计一次，不同活动累计。日期变更线、极区、零长度、单点、多段断点沿用既有语义。

后台独立 Session 在线程执行，任务使用独立命名空间的数据库 advisory lock，不改变导入锁。生成期间不持有 users 行锁，发布时短锁复核源版本；并发编辑/导入/删除导致旧任务放弃发布。失败状态与退避持久化，停止时取消活动查询并释放连接，重启可补建。

快照包含私人坐标，只在本地 PostgreSQL 与本人浏览器使用，不进入公开分享、AI 请求或日志。原导入防重复、认证、CSRF、分享、原始指标与数据均保留。

## 验证记录

以下为本轮真实执行，数据库与 Chrome 均使用合成数据。

- PASS：后端全量单元测试 `.venv/bin/pytest tests/unit -q`，286 passed in 23.09s。使用提权运行仅用于单元测试合成 HTTP 服务器的本机端口权限；无真实供应商调用。
- PASS：`backend/.venv/bin/python /private/tmp/runnote-footprint-work/database.py tests/integration/test_footprint_snapshots.py -q -s`，13 passed in 8.19s。隔离原生 PostgreSQL18/PostGIS 实例 `127.0.0.1:55449`，显式允许的 `runnote_footprints_test`。
- PASS：同一运行器执行 `test_footprints.py test_gpx_import.py test_tcx_import.py test_mifitness_import.py test_activity_management.py test_activity_library.py test_migrations.py test_tcx_migration.py test_database.py -q`，160 passed in 64.69s。另一个 `runnote_footprints_snapshot_test` 从旧 schema 升级，校验旧 sentinel、空间参考数据及幂等升级保留；未跳过快照迁移目标。
- PASS：新集成覆盖跨年份与双用户隔离、三种导入的增量缓存、编辑/删除/批量删除旧快照立即不可读、真实后台线程自动生成及停止、同用户任务去重、生成中编辑阻止旧发布、退避与 24 小时刷新、算法旧版替换、周期失败保留成功版本以及降级防护。
- PASS：空间快照与原实时结果逐字段对照，覆盖日期变更线、极区、单点、多段和零长度；活动级绕圈/多段去重与跨活动累加有独立预期。
- PASS：`backend/.venv/bin/ruff check backend/app backend/migrations backend/tests`；`ruff format --check`，141 files already formatted。

- PASS：前端 `pnpm test`，19 个文件、123 测试通过；`pnpm check`，0 errors / 0 warnings；`pnpm build`，adapter-node 构建成功，仅既有大 chunk 提示。
- PASS：`pnpm exec playwright test --config /private/tmp/runnote-footprints-playwright.config.ts`，真实 Chrome 31 passed in 54.2s（足迹 13、p2 11、主题 7），使用独立合成 API 8193 与前端 5193。包括超过 5 分钟 pending 后完成、刷新失败、401、卸载、两模式、主题和键盘回归。
- PASS：独立审查提出的轮询五分钟上限和定期失败提示问题均已修复并回归，未遗留重要发现。
- 已目视 [桌面轨迹](local-evidence/2026/10/15/01a14002-959f-7bd0-a695-f04997d80774/footprints-desktop-tracks.png) 与 [手机热图](local-evidence/2026/10/15/01a14002-959f-7bd0-a695-f04997d80774/footprints-mobile-heatmap-map.png)，未见筛选控件或横向溢出。

性能样本：独立测试用户六条合成活动，每条几何 50000 个顶点，总 300000 个顶点，超过原账户 250000 点预算；未创建对应 30 万条原始 `activity_points` 行。最后一次快照生成 3647.01ms，三次 ASGI TestClient 全量轨迹读取为 132.29/140.23/146.43ms，每次 4 条 SQL，JSON 序列化约 6968336 字节。逐项确认保留全部 300000 个顶点，读取没有原始点/段查询和 `ST_Intersects`。这些是本机单用户热缓存样本，不是生产延迟、浏览器绘制性能或无限容量证明。

资源边界：单活动计算仍限制空间候选数量、网格数及查询时间；合并快照上限 200000 个网格、64MiB，任务预算 120 秒。超限明确失败并后台退避，不静默删记录或截断。完整历史的传输、内存及绘制成本依然存在。

## 未运行与运行边界

未升级开发库、未重启开发服务、未验证开发账号或生产环境。未执行开发数据清理、真实用户导入、真实 AI 调用、提交或推送。合成 Chrome UI 与隔离库验收分别记录，不等同于开发实例已加载代码。其它会话并发修改的业务文件保持原样，不纳入本任务成果。

## 后续开发库迁移

用户随后明确授权“迁移吧”。已完成开发库 0009→0010 的备份、隔离恢复演练、单次升级与全表数据复核；详细证据见 [开发库迁移验收](48-footprints-development-migration.md)。本节更新前文“本轮未迁移”的时间边界，开发后端仍保持关闭，快照后台实际生成尚未运行。
