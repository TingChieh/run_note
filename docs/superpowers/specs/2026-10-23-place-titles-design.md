# 按附近地物自动命名跑步设计

日期：2026-10-23

## 目标

导入跑步记录时，如果用户没有自己起名，就根据轨迹附近的地物自动命名，例如「湖边跑步」「河边跑步」。已有记录通过一个离线脚本显式补一次。全程在本地 PostGIS 内计算，坐标不出本机。

## 范围

做：本地地物表与离线导入脚本、识别规则、导入时入队与后台命名、历史记录补全脚本（预览 / 应用 / 还原）。
不做：在线地理编码、编辑页「建议名称」按钮、带地名的标题（如「西湖边跑步」，留作后续增强）、AI 供应商参与命名。

## 隐私与硬约束

- 不向任何第三方发送坐标、轨迹或活动数据（`AGENTS.md` 第 8 节）。OSM 数据仅在离线准备阶段由管理员下载区域文件，识别时只读本地表。
- 名称只含类别词，不含坐标或用户信息。
- 迁移手写、不在开发库执行未授权迁移；补全脚本对开发库和生产库都属于写数据，`--apply` 必须用户明确授权并先备份。
- 非容器化：离线脚本依赖本机安装的 `osmium`（osmium-tool），不引入 Docker。

## 数据

### `place_features`（全局参考数据，无 `user_id`，与省份地图同类）

- `id` uuid、`category`（`String(16)` + 具名 `CheckConstraint`：`lake`、`river`、`sea`、`park`、`stadium`）、`geom`（`GEOGRAPHY(GEOMETRY, 4326)`，GiST 索引；用 geography 才能让 `ST_DWithin` 按米计算并使用索引）、`region`（导入区域标签，`String(64)`）、`imported_at`。
- 类别来自 OSM 标签映射：
  - `lake`：`natural=water` 且 `water` 为 `lake`/`reservoir`，面积 ≥ 10,000 m²。
  - `river`：`waterway=river|canal`，或 `natural=water` 且 `water=river`。
  - `sea`：`natural=coastline`、`natural=bay`。
  - `park`：`leisure=park|nature_reserve`，面积 ≥ 5,000 m²。
  - `stadium`：`leisure=stadium`，或 `leisure=track` 且 `sport=running`。
- 几何用 `ST_SimplifyPreserveTopology`（约 10 米）简化。不保存 OSM 名称与其他标签。

### `activity_place_names`（命名队列与结果，用户数据）

- `activity_id`（PK，与 `user_id` 组成指向 `activities` 的复合外键，CASCADE）、`user_id`、`state`（`pending`/`done`/`skipped`，具名 `CheckConstraint`）、`category`（可空）、`share`（0–1，可空）、`applied_title`（可空）、`algorithm_version`、`updated_at`。
- `pending`：已入队等待识别。`done`：已识别并改名。`skipped`：已处理但未改名（无命中、标题已被用户改过、地物表为空等）。
- 迁移序号现场确认（当前计划中的 `0015_route_groups` 之后为 `0016`），降级有数据时 `raise RuntimeError`。

## 识别规则（`modules/place_titles/rules.py`，纯函数 + SQL）

- 沿轨迹每约 200 米取一个采样点；一个采样点在某类别地物 100 米内（`ST_DWithin` 的 geography 距离，单位米）记为该类别「靠近」。
- 各类别份额 = 靠近点数 / 采样点总数。取份额最高且 ≥ 0.4 的类别；并列时按 `sea` > `lake` > `river` > `park` > `stadium` 取先。
- 名称：`sea`→「海边跑步」、`lake`→「湖边跑步」、`river`→「河边跑步」、`park`→「公园跑步」、`stadium`→「操场跑步」。无命中则不改名，记为 `skipped`。
- 阈值与词表集中为常量，变化时提升 `ALGORITHM_VERSION`。
- 活动轨迹不足 1 km 或没有轨迹段时不识别（`skipped`）。

## 改名条件

仅当活动标题恰好等于默认标题 `跑步 · {activity_date}` 时才改（与 `gpx/service.py` 与 `mifitness/service.py` 的默认标题一致）。用户手动起过的标题永远不覆盖。更新语句用 `WHERE title = :default_title` 作乐观条件，避免与用户同时编辑竞态。改名同时在同一事务内 `lock_owner` 并递增 `activity_data_version`，以便旧 AI 报告被标记为过时。

## 新导入的流程

1. 导入服务（GPX/TCX 共用的 `import_track`、小米运动健康导入）在创建活动且标题为默认标题时，于同一事务内向 `activity_place_names` 插入 `pending` 行。具体入口以实施时对导入代码的确认为准，不新增另一套导入互斥。
2. 导入后已有的 `wake_footprint_worker` 唤醒；`run_scan` 在 `fill_route_groups` 之后调用 `fill_place_titles`，只处理 `pending` 行，每批有界、可中断、可重入，用 `pg_try_advisory_xact_lock` 保证同一用户同一时刻单事务。
3. 地物表为空时，`pending` 行保持原样（不标 `skipped`），待数据导入后下一次扫描再处理。
4. worker 只处理 `pending`，**不回头改历史记录**。

## 历史记录补全脚本 `scripts/backfill-place-titles.py`

与 `scripts/site-owner.py` 同为离线运维脚本，仓库内提供，不由助手部署。

- 候选 = 标题仍为默认标题且队列状态不是 `done` 的记录。默认只预览：列出每条将改的「日期 · 当前标题 → 新标题」，并统计命中、未命中、因标题已被改过而跳过的数量；不写库。
- `--apply`：先要求确认已备份，再只改标题仍为默认标题的记录；每条改动写入 JSON 日志（活动 ID、旧标题、新标题）；改名成功的队列行置 `done`，之后不再处理；未命中的记录不标记，下次运行（例如新导入了区域数据后）会重新评估。
- `--revert <日志文件>`：按日志逐条把标题还原，仅当当前标题仍等于日志里的新标题时才还原。
- 数据库连接沿用现有脚本的读取方式，不打印 DSN 与密钥。

## 地物导入脚本 `scripts/osm-places.py`

- 输入：管理员预先下载的区域 `.osm.pbf`（可多个省份，逐个导入，可追加）与 `--region` 标签。
- 流程：`osmium tags-filter` 过滤相关标签 → `osmium export -f geojsonseq` → 脚本逐行读取、映射类别、过滤面积、简化、写入 `place_features`。同一 `region` 重复导入时在一个事务内先删后插，保证可重复。
- 脚本在实施时用小型合成 `.osm` 样例验证映射与面积过滤，不把真实 OSM 数据提交进仓库。
- 数据来源与许可：OpenStreetMap contributors（ODbL）；在文档中记录来源与区域，网站现有底图已有署名，无需新增界面署名，除非后续在界面展示地名。

## 后端模块 `modules/place_titles/`

`model.py`（两张表映射）、`rules.py`（类别词表、阈值、选择类别的纯函数）、`service.py`（识别 SQL、入队、应用改名、预览/还原供脚本调用）、`worker.py`（`fill_place_titles`）。无新增 HTTP 接口，不改响应结构。新模型注册到 `app/models/__init__.py`。

## 测试

- 单元（无 DB）：类别选择与并列优先级、阈值边界、默认标题判断、标题词表。
- 集成（独立 `_test` 库，合成地物）：靠近湖/河/海/公园/操场各命中、份额不足不改名、用户手改标题不被覆盖、地物表为空保持 `pending`、入队随导入同事务、worker 命名并递增 `activity_data_version`、他人数据不串。
- 脚本：预览不写库、`--apply` 只改默认标题、重复运行幂等、`--revert` 仅还原仍匹配的标题；测试通过函数调用，不对开发库执行。
- 检查：`ruff check`、`ruff format --check`、`pytest`；集成测试需已授权升级的 `_test` 库，未运行则如实标注。

## 风险与待确认

- 区域：用户主要在几个省份跑步，具体省份清单在准备数据时由用户提供；落在已导入区域之外的轨迹保持默认标题。
- 阈值（100 米、0.4、10,000 m² 等）需用合成样本调参，真实数据效果上线后再看；变化即提升算法版本。
- 小米运动健康与批量导入的具体入队位置需在实施前读代码确认。
- 依赖本机 `osmium` 命令行；未安装时脚本给出明确的中文提示并退出，不静默失败。

## 文档

完成后追加 `docs/NN-place-titles.md`（编号现场确认），含使用方式（导入数据、补全历史、还原）、接口与隐私、验证记录。
