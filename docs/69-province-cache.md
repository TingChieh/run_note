# 累计省份足迹：按活动缓存

## 使用方式

仪表盘“足迹地图”卡片（累计省级区域，以及按年份的省份汇总）的外观、接口地址和返回结构都不变。变化在后端：

- 每条活动经过哪些省，只做**一次**空间相交，结果存入新表 `activity_province_caches`（只有省级编码，没有坐标、标题或文件名）。
- 读取汇总时，对有效缓存行做聚合；稳态下请求不再解析 34 个省份边界，也不再做任何空间计算。
- 尚未缓存的活动（例如刚导入、后台还没补算到的）会在这次请求里现场计算，然后合并进结果。**GET 不写库**，所以匿名访客的请求不会产生写入，结果也不依赖后台任务的时机。
- 足迹 worker 的扫描循环在每次扫描末尾补算缺失或过期的行，每批最多 50 条；导入提交后已有的 worker 唤醒会让新活动几秒内就有缓存。
- 若某条缓存行的 `atlas_version`（省份边界文件内容哈希的前 16 位）与当前边界文件不一致，它被视为缺失，现场计算并由 worker 覆盖更新。

## 改动范围

仅后端与测试，前端、接口、其他模块不变。

- `backend/app/modules/footprints/model.py`：新增 `ActivityProvinceCache`。
- `backend/app/models/__init__.py`：注册新模型。
- `backend/migrations/versions/0014_activity_province_caches.py`（新增）：建表（`id`、`user_id`、`activity_id`、`atlas_version`、`province_codes integer[]`、`generated_at`）、`activity_id` 唯一约束、`(activity_id, user_id)` 到 `activities(id, user_id)` 的复合外键（`ON DELETE CASCADE`）、`user_id` 索引；降级在表里已有数据时抛 `RuntimeError`，不会丢数据。
- `backend/app/modules/footprints/provinces.py`：新增 `atlas_version`、`province_names`、`compute_province_codes`、`store_province_codes`、`fill_province_caches`；`province_summary` 改为聚合缓存并只在确有缺失活动时现场计算。保留 5 秒 `statement_timeout`，超时仍返回 `PROVINCE_LIMIT`。
- `backend/app/modules/footprints/worker.py`：`run_scan` 末尾补算省份缓存，失败只记日志（不含坐标或标题），下一次扫描重试。
- 测试：`backend/tests/integration/test_province_cache.py`（6 个）、`backend/tests/unit/test_province_cache_migration.py`（1 个）；`backend/tests/unit/test_schema.py` 更新了期望的 head 与表集合。
- 文档：设计 `docs/superpowers/specs/2026-10-23-province-cache-design.md`，计划 `docs/superpowers/plans/2026-10-23-province-cache.md`，以及本文件。

## 接口与隐私

- 接口、返回结构（`year`、`total`、`activity_count`、`located_activity_count`、`provinces[]`）和前端校验都不变；公开接口仍只返回省份编码、名称和各省活动数，不含坐标、标题或文件名。
- 新表是纯派生数据，原始活动和轨迹始终是权威来源；表带 `user_id` 外键与复合外键，删除活动或用户时缓存行级联删除。
- 缓存行只含省级编码数组；日志不记录坐标、标题或供应商原文。

## 上线步骤（需要你执行或授权，我没有操作任何开发库或线上库）

1. 备份线上库，并按 `docs/66` 做恢复演练。
2. 对线上库执行一次受控升级：`alembic upgrade head`（只新增一张空表）。**升级前，新代码会因 schema 版本不匹配被健康检查拦住，这是项目既有的保护；升级后才能部署新代码。**
3. 部署新代码。升级后、回填完成前，读取路径对全部活动现场计算，行为与升级前一致，所以没有停机，也没有错误或不一致；之后 worker 在后台自动回填历史活动。
4. 复核：仪表盘足迹卡片正常；必要时在库里确认 `SELECT count(*) FROM activity_province_caches` 随时间追上活动数。

## 验证记录

2026-10-23，本机，一次性隔离 PostgreSQL 18 + PostGIS（仅 127.0.0.1:55477 的 `rn_iso_test`，只在进程环境注入 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS`，没有碰 `.env`、开发库或线上库；用完已关闭并删除）。

| 实际执行 | 结果 |
| --- | --- |
| 迁移：在隔离库上 `alembic upgrade head`、`downgrade -1`（空表）、再 `upgrade head` | 均成功，`\d activity_province_caches` 与设计一致 |
| `pytest tests/integration/test_migrations.py` | 34 passed，1 skipped（该用例需要另一个快照专用库，不在本次范围） |
| 新增集成测试 `test_province_cache.py` | 6 passed；先写测试再实现，“过期版本”用例在旧实现下先失败（红灯），实现后通过 |
| 新增迁移单元测试 `test_province_cache_migration.py`（离线生成 DDL、降级拒绝丢数据） | 通过 |
| `pytest tests/unit -q` | 374 passed |
| `pytest -q`（全量，隔离库） | 634 passed，1 skipped |
| `ruff check` 与 `ruff format --check` | 通过 |

实现中发现并修正了两处问题：测试里的断言原先针对全局行数，而隔离库在测试之间不清空，已改为只看本测试自己的用户；`province_summary` 在没有缺失活动时仍调用了计算函数，已改为只在确有缺失时调用。

### 耗时对比（合成数据，隔离库，约 114 万点、1100 条活动、8 个城市）

| 路径 | `province_summary` 耗时 |
| --- | --- |
| 改前等价路径：没有缓存，全部现场计算 | 约 176 ms（三次：192、176、177） |
| 全部命中缓存 | 约 2 ms（五次均为 2） |
| 后台把全部行补算一遍 | 约 3.9 秒（含隔离库里其他测试遗留的活动，所以是上限） |

读取耗时与历史长度基本脱钩；这是合成数据，不是你线上的真实数据，也没有测浏览器侧。

### 未运行

- 线上或开发库的真实迁移与回填（按规则不在我的操作范围）。
- 真实数据量下的耗时与回填时长。
- 开发服务未重启；新代码需要先升级迁移再部署后才在线上生效。
- 那 1 个被跳过的迁移用例（需要快照专用库）。

## 剩余风险

- 边界文件（`china-provinces.geojson`）更新会让所有缓存行变成过期，并触发一次全量回填；这是预期行为。
- 回填期间若某些活动的现场计算较慢，读取仍受 5 秒超时保护，最坏情况是卡片显示“省份足迹计算较慢，请稍后重试”，直到后台补算完成。
- 若将来要按城市而不是省份统计，需要另外设计。
