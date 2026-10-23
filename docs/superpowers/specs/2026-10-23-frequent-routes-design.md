# 常跑路线归类设计

日期：2026-10-23

## 目标

把形状重合的多次跑步自动归为「同一条路线」，展示每条路线的跑过次数、最佳/平均用时与配速、历次成绩趋势。分享图不在本范围（由单次跑步分享图功能另行处理）。

## 范围

做：后端归类与只读接口、列表页、详情页。
不做：手动重命名/合并/拆分、路线分享图、路线推荐。

## 归类算法

- **输入**：每个活动的 `activity_segments.LINESTRING`（SRID 4326）。多段轨迹按顺序拼接为一条用于比较；无轨迹或不足最小长度的活动不参与。
- **指纹**：把各段按 `segment_index` 收集并用 `ST_SimplifyPreserveTopology`（约 5 米）简化，存为 `MULTILINESTRING`。距离取活动自身的 `distance_m`（服务端权威值）。
- **粗筛**：距离相差 ≤15%（相对较大者），且外包框相交；起终点不作条件。
- **精筛**：PostGIS 计算两条轨迹的 50 米缓冲区互相覆盖率（缓冲半径按纬度修正 1/cos(lat)），取两个方向的较小值，≥80% 视为同一路线。缓冲区覆盖本身与方向、起点无关，因此反向跑、换起点的环线天然归为一组，无需额外旋转逻辑。
- **聚类**：按日期从旧到新增量处理。新活动与同用户已入组成员比较，每组取最佳覆盖率；命中则入覆盖率最高的组，命中多组时并入最早建立的组，未命中则新建。组内不存聚合值。
- **代表轨迹**：读取时取距离最接近组内中位数的成员（并列取最早），不落库。
- 阈值（15%、50 米、80%、最小长度）集中放在常量里，算法版本号 `ALGORITHM_VERSION` 变化即全量重算。

## 数据模型

迁移手写，序号现场 `ls backend/migrations/versions/` 确认，降级在有数据时 `raise RuntimeError`。

- `route_groups`：`id`(uuid)、`user_id`(CASCADE)、`algorithm_version`、`created_at`。不存次数、日期、中位距离等聚合值，全部在读取时由 SQL 对成员活动聚合，避免删除/编辑活动后失真。
- `route_group_members`：`activity_id`(PK，与 `user_id` 组成指向 `activities` 的复合外键，CASCADE)、`group_id`(CASCADE)、`user_id`、`coverage`(0–1)。
- `route_fingerprints`：`id`、`user_id`、`activity_id`(唯一，复合外键 CASCADE)、`algorithm_version`、`geom`(`MULTILINESTRING` 4326，可空：无轨迹或不足 1 km 的活动存空值以免重复计算)、`generated_at`。
- 枚举与约束遵循现有规范（具名 `CheckConstraint`，时间列 `timezone=True`，不使用 `relationship()`）。新模型注册到 `app/models/__init__.py`。

## 后端模块 `modules/route_groups`

- `service.py`：指纹构建、候选查询、聚类、读取聚合（成绩列表、最佳/平均用时与配速均由 SQL 聚合）。
- `queries.py`：空间比较 SQL（属于确需拆出的空间查询）。
- `groups.py`：`fill_route_groups`，在足迹 worker 的 `run_scan` 中紧跟 `fill_province_caches` 调用（同一线程、同一唤醒），不新增另一套调度；每次有界批处理，用 `pg_try_advisory_xact_lock` 保证同一用户同一时刻只有一个归类事务。算法版本变化时先清空旧版本再重建。过期靠“缺指纹/未入组”判断，不依赖 `activity_data_version`。
- `router.py` / `schema.py`：`APIRouter(prefix="/api/v1/routes")`，响应沿用 `envelope`，请求/响应继承既有约定。

接口（均为只读 GET，`limit` 默认 20、上限 100，`offset` 同通用规则）：

- `GET /api/v1/routes/groups` — 列表：`{items, total, limit, offset}`，每项含 id、run_count、median_distance_m、best/avg 用时与配速（用时取 `COALESCE(timer_seconds, elapsed_seconds)`）、first/last 日期、代表轨迹简化折线 `shape`（用于缩略图）。仅列出跑过 ≥2 次的路线。支持 `sort=count|recent|distance`。
- `GET /api/v1/routes/groups/{id}` — 详情：代表轨迹、成员成绩列表（日期、用时、配速、距离、activity_id）。
- 展示端点：`/api/v1/showcase/routes/groups*` 与 `/api/v1/showcase/users/{username}/routes/groups*`，使用独立白名单序列化，SQL 内固定 subject（站主或满足 `is_active AND showcase_enabled` 的用户），不接受客户端 owner ID。
- 他人资源一律 404。
- 归类未就绪（该用户仍有未处理活动）时，列表带 `building: true`，前端显示「正在整理路线」并轮询，不阻塞。

隐私：响应不含邮箱、备注、文件名、原始 GPX/TCX。公开展示可含完整轨迹（沿用完整展示规则），旧版摘要分享不涉及本功能。

## 前端

- `lib/api/route-groups.ts`：运行时响应校验、领域错误类 `RouteGroupError`；展示端点走白名单重建。
- 列表页 `routes/<区域>/routes`：卡片网格，缩略图、「约 X km 路线」默认名、跑过次数、最佳用时；排序切换；空态、加载态、错误态、building 态。
- 详情页：地图复用 `basemap-controller.ts` 与 `BasemapPicker`（`maplibre-gl` 仅 `onMount` 内动态导入），ECharts 画历次用时趋势，下方成绩表，趋势图附 `<details>` 数据表兜底；缺失值渲染 `—`。
- 遵循 `disposed` 标志、单调请求令牌、401 清除私人状态；主题用 `watchSystemTheme`。
- 样式用语义令牌与现有卡片/玻璃组件，不新增通用组件除非出现真实重复，新增则同步 design-system 文档与 showcase。
- 导航入口：加入工作区与展示页现有导航，具体位置实施时对照现有布局确定。

## 测试

- 后端 unit：指纹重采样、反向与起点旋转、阈值边界、版本过期判断（无 DB）。
- 后端 integration（独立 `_test` 库）：聚类命中/不命中/合并、删除活动后重归类、归属 404、展示 subject 约束、迁移升级与防御性降级。
- 前端 Vitest：响应校验、排序、格式化。
- 前端 UI（Playwright，合成 API）：同步补 `frontend/tests/fixtures/ui-api.mjs`；列表/详情/空/错误/building 态、主题、键盘焦点。
- 检查：`ruff check`、`ruff format --check`、`pnpm test`、`pnpm check`。

## 风险与待定

- 阈值需用合成样本调参；真实数据上的效果在迁移后另行验证，不在开发库写入测试数据。
- 全量首次归类对活动多的用户耗时较长，worker 须分批、可中断、可重入。
- 开发库迁移须用户明确授权，按"备份 → 恢复演练 → 单次升级 → 复核"进行。

## 文档

完成后追加 `docs/NN-frequent-routes.md`（编号现场确认），含使用方式、接口与隐私、验证记录。
