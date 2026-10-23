# 累计省份足迹：按活动缓存设计

## 背景与目标

仪表盘“足迹地图”卡片的累计省份汇总（`/api/v1/showcase/footprints/provinces`，同样的 `/api/v1/footprints/provinces`）每次请求都会对**全部历史轨迹**做一遍 PostGIS 空间相交。线上数据累计到 262,350 个点时，旧的“点数上限”预检查把它拦成了 `FOOTPRINT_LIMIT` 错误；上限取消后（提交 `2d9fd3f`），这个接口只剩 5 秒的 `statement_timeout`。

实测（合成数据、隔离 PostGIS）：约 19 万点约 90 ms，约 114 万点约 150 ms，其中约 65 ms 是每次请求解析 34 个省份边界的固定开销。所以今天并不慢，但成本随历史线性增长，而保护只是“超过某个数就拒绝”，数据继续增长迟早会再碰到某条线。

目标：让累计省份汇总的耗时与历史长度脱钩。每条活动只做一次空间相交，汇总变成对一张小表的聚合。接口地址、返回结构和展示都不变。

## 已确认的约束

- 不改前端，不改接口返回结构（`year`、`total`、`activity_count`、`located_activity_count`、`provinces[]`）。
- 公开数据边界不变：省份汇总仍只返回省份编码、名称和各省活动数，不含坐标、标题或文件名。
- 迁移手写，降级要防御性；开发库与线上库的升级由用户按“备份 → 恢复演练 → 受控单次升级 → 复核”执行，我只在隔离测试库上验证。
- 新表是纯派生数据，原始活动与轨迹始终是权威来源。

## 方案

### 数据

新表 `activity_province_caches`，形状与现有 `footprint_activity_caches` 一致：

| 列 | 说明 |
| --- | --- |
| `id` | UUID 主键，`default=uuid4` |
| `user_id` | `ForeignKey("users.id", ondelete="CASCADE")`，建索引 |
| `activity_id` | 唯一；与 `user_id` 组成指向 `activities(id, user_id)` 的复合外键，`ondelete="CASCADE"` |
| `atlas_version` | `String(64)`，省份边界文件内容哈希的前 16 位十六进制；边界文件一变，旧行自动视为过期 |
| `province_codes` | `ARRAY(Integer)`，该活动经过的省级编码，可以为空数组（已算过但不在图集内） |
| `generated_at` | `DateTime(timezone=True)`，`server_default=func.now()` |

删除活动或用户时缓存行随外键级联删除；轨迹在导入后不会被编辑，所以不需要按数据版本失效。

### 读取（`province_summary`）

1. 取本人（可带年份区间）活动总数。
2. 聚合已有且 `atlas_version` 为当前版本的缓存行：每个省的活动数、至少命中一个省的活动数。
3. 对**没有当前缓存行的活动**，用与今天同一套 SQL 现场计算（范围收窄到这些活动 ID），把结果合并进汇总。**GET 不写库**，所以匿名访客请求不会产生写入，也不依赖后台任务的时机。
4. 稳态下没有缺失活动，整个请求不再解析省份边界、不做任何空间相交，只是对几百行做聚合。
5. 保留 5 秒 `statement_timeout`；超时仍返回 `PROVINCE_LIMIT`（“省份足迹计算较慢，请稍后重试”）。

### 补算（足迹 worker）

沿用 `FootprintWorker` 的扫描循环：`run_scan` 在 schema 版本校验通过之后，调用 `fill_province_caches`，每批最多 50 条没有当前缓存行的活动，按创建时间从旧到新，同一批内按用户分组计算并用 `INSERT … ON CONFLICT (activity_id) DO UPDATE` 写入，直到没有缺失为止。

- 幂等，多个 uvicorn worker 同时补算也安全。
- 导入提交后已有的 `wake_footprint_worker` 会立刻触发一次扫描，所以新导入的活动几秒内就有缓存。
- 补算失败只记录日志（不含坐标或标题），下一次扫描（60 秒后）重试；读取路径不受影响。

### 上线与回填

迁移只新增一张空表。升级后、回填完成前，读取路径对全部活动现场计算，行为与现在相同，所以没有停机，也没有错误或不一致。后台 worker 随后自动回填历史活动，之后读取不再有空间计算。

## 错误处理

| 情形 | 行为 |
| --- | --- |
| 现场计算超过 5 秒 | `PROVINCE_LIMIT`，与现状一致 |
| 缓存行的 `atlas_version` 过期 | 视为缺失，现场计算，worker 覆盖更新 |
| 补算抛错 | 记录日志，下一次扫描重试，不影响接口 |
| 活动没有轨迹或不在图集范围内 | 缓存空数组，计入 `activity_count`，不计入 `located_activity_count` |

## 测试计划

均为后端集成测试，在一次性隔离 PostGIS 的 `_test` 库上执行：

- 缓存读取与现场计算得到完全相同的汇总。
- 有缓存时汇总不再触发空间计算（用打桩让 `compute_province_codes` 一旦被调用就失败）。
- 一部分活动有缓存、一部分没有时，汇总包含两者，并且 GET 之后缓存表行数不变。
- `fill_province_caches` 补齐缺失、对过期版本覆盖更新、可重复运行。
- 删除活动后缓存行消失。
- 年份过滤与旧行为一致；无轨迹活动只计入总数。
- 迁移：`alembic upgrade head` 创建表；降级在有数据时拒绝。
- 既有的 `test_province_performance.py`、`test_milestones.py` 继续通过。

## 范围与风险

- 后端：`footprints/model.py`、`footprints/provinces.py`、`footprints/worker.py`、`models/__init__.py`、新迁移与新测试。前端、接口、其他模块不变。
- 迁移需要用户在线上按流程执行；未执行迁移时新代码会因 schema 版本不匹配而被健康检查拦住，这是项目既有的保护。
- 边界文件更新会让所有缓存行变成过期并回填一遍，这是预期行为。
- 若将来要支持“按城市”口径，需要另外设计，不在本次范围。
