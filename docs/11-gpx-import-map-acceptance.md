# GPX 导入、持久化与路线地图本地验收

日期：2026-10-12。结论：本次要求的上传 → 解析/指标 → PostgreSQL/PostGIS 保存 → 本人列表/详情 → MapLibre 路线 → 刷新重读流程 **PASS**。S2-03 保持关闭，没有重新设计认证。没有执行迁移、修改 `.env`、清库、重置限流、使用 Docker、提交或推送。

## 步骤归属与实现

- **S2-04**：受限 multipart、安全 XML/gpxpy、原始轨迹序号、坏点断段、缺失属性处理、spawn 独立解析和 15 秒预算。
- **S2-05**：Haversine 独立对照、真实 geography 边距/分段线长、暂停及缺失时间规则、日期/时区、canonical-v1 指纹。
- **S2-06**：当前认证 owner、来源/CSRF、跨 worker 本人导入锁、本人去重、四表及用户版本原子提交、本人详情/路线权限。
- **S2-07 最小必要部分**：沿用已完成的认证前端，新增上传、错误/重复提示、列表和详情重读。
- **用户明确授权的阶段三提前交付**：本人分页列表、GeoJSON 路线接口和 MapLibre 起终点/连续段展示。未实现日历、热力图、统计、分享或 AI；不宣称整个阶段三或 S2-07/S2-08 全部完成。

沿用已有 `0003_gpx_storage` 模型。原始 GPX 保存为 bytea，轨迹点保存为 `Point(4326)`，各连续段派生为 `LineString(4326)`；单点段保留点但线为 NULL。段间没有空间边。距离为各段 `ST_Length(geom::geography)` 总和；最终指标三位小数 half-even，配速用未舍入的距离/耗时计算。存储距离或耗时量化为零时配速为 NULL，符合已有数据库约束。

多轨迹/多段保留；非法坐标丢弃且断段，不跨坏点桥接。缺失/坏/无 UTC 偏移时间为 NULL；incomplete 和 invalid 不伪造耗时/配速。完整时间的总耗时包含暂停和段间间隔。日期依据可信开始时间及所选/本人时区，开始时间未知需明确补录日期。

安全限制为原文 10 MiB、完整 multipart 11 MiB、50000 源点、1000 源段，含无效点和空段。禁 DTD/实体/外部资源；扩展名和 MIME 不是可信校验依据。解析 worker 不持有数据库会话；每 API 进程一个解析槽，超时终止并回收子进程。独立 watchdog 也限制部分 pipe 消息造成的阻塞。

写入前重新验证原 Cookie 会话，避免解析期间撤销后仍提交。原文、摘要、段、点和 `activity_data_version + 1` 在同一短事务；重复/失败不增加版本。本人 raw/canonical 去重，409 仅返回本人的已有记录 ID。查询同时校验 id 与 owner，其他用户真实 ID 和不存在 ID 都为 404。前端无全局私人数据缓存，沿用 Cookie/CSRF、no-store 和既有身份变更保护。

## 实际接口和页面

| 地址 | 行为 |
| --- | --- |
| `POST /api/v1/gpx-imports` | 单文件上传，字段 `file`、可选 `title/timezone/activity_date`；成功 201 |
| `GET /api/v1/activities?limit=20&offset=0` | 本人日期/ID 倒序分页列表 |
| `GET /api/v1/activities/{id}` | 本人摘要、指标和质量信息 |
| `GET /api/v1/activities/{id}/route` | 本人连续段 GeoJSON、起终点；单点为 Point |
| <http://127.0.0.1:5183/activities> | 登录后上传及查看本人活动 |
| <http://127.0.0.1:5183/activities/760d92f2-8078-475d-957a-8f47a6ee0652> | Chrome 验收用户 A 的赤道样本详情 |
| <http://127.0.0.1:5183/activities/7aadf359-763a-4608-b3cb-47ab8368f517> | 同一用户多轨迹段样本详情 |

示例详情属于真实注册的验收用户，其他账号不能访问；无需使用示例用户或固定账号，正常注册/登录后自行上传即可。可直接选 `backend/tests/fixtures/gpx/equator-six.gpx` 演示。

MapLibre GL JS 固定版本 5.20.0，按需加载。当前仅使用本地样式、分段路线、单点和起终点标记，**没有道路底图**；不向外部瓦片服务发送坐标。支持缩放、路线范围适配和跨日期变更线展开；窗口尺寸变化重新适配，组件销毁清理地图/观察器/标记。

## 实际测试结果

| 检查 | 结果 |
| --- | --- |
| 后端相关 pytest | **215 passed，0 skipped，26.19s**：全部单元、认证集成、GPX 集成 |
| 黄金文件 | 41 个静态案例的解析/原文/指标/点序/几何/版本核对通过 |
| 资源边界 | 10/11 MiB、源点/段数量、50000 点 spawn 结果、超时/崩溃/部分 pipe 消息及恢复通过 |
| 50000 不同点真实入库 | 50000 点、1 段、点序及源序 0..49999、线点数一致，SQL 调用少于 250；独立目标用例 3.02s |
| 写入及权限 | 中途写点失败回滚、数据库 UNIQUE 裁决、解析期间撤销、数据库故障脱敏/锁释放、跨应用同用户并发及 A/B 隔离通过 |
| Ruff check / format --check | 通过，56 个相关 Python 文件格式正确 |
| 前端 `pnpm test` | **18 passed**，4 文件 |
| 前端 `pnpm check` | **0 errors / 0 warnings** |
| 前端 `pnpm build` | 成功；MapLibre 延迟加载 chunk 1024.33 kB / gzip 272.32 kB，有 >500 kB 提示 |
| `git diff --check` | 通过 |
| 独立只读代码审查 | 发现两项 P2 并修复/复核关闭；未发现遗留重要问题 |

相关测试使用现有独立库 `127.0.0.1:5432/running_note_phase_one_test`，通过现有 IntegrationSettings 允许列表及只读实际目标守卫；只验证其 revision 为 0003，不执行 Alembic 或清理。每次生成正常合成用户和测试数据，保留已有记录。本轮未重复跑含迁移的基础设施测试，**215 是本次相关回归，不是全仓库含迁移测试的总数**。

可复用命令（backend 目录；只把目标配置传入子进程，不输出连接密码）：

```bash
.venv/bin/python - <<'PY'
import os, subprocess
from app.core.config import Settings
from sqlalchemy.engine import make_url
url = make_url(Settings().database_url).set(database='running_note_phase_one_test')
env = {**os.environ,
       'TEST_DATABASE_URL': url.render_as_string(hide_password=False),
       'TEST_DATABASE_ALLOWED_TARGETS': f'{url.host}:{url.port or 5432}/{url.database}',
       'RUNNOTE_TEST_NO_MIGRATIONS': '1'}
raise SystemExit(subprocess.run([
    '.venv/bin/pytest', 'tests/unit', 'tests/integration/test_auth.py',
    'tests/integration/test_gpx_import.py', '-q', '--tb=short'
], env=env).returncode)
PY
.venv/bin/ruff check app tests/unit tests/integration/test_gpx_import.py
.venv/bin/ruff format --check app tests/unit tests/integration/test_gpx_import.py
```

## 真实 Chrome 联调

使用 Playwright CLI 操作安装的 Chrome，目标为开发 API8001/前端5183；正常表单注册两个唯一用户，没有伪造 Cookie 或固定用户绕过。保留新增的开发记录与注册尝试，不重置限流。

| 场景 | 结果 |
| --- | --- |
| A 上传赤道六点文件、进入详情 | 距离 1.113 km、经过时间 10:00、配速 8:59/km；路线、起终点可见 |
| 详情刷新、返回列表 | 已保存记录重新从 API 读取，仍存在 |
| 无效 XML | 页面明确显示“GPX XML 不合法” |
| 相同用户重复导入 | “此 GPX 已经导入”，已有记录链接指向 A 的原活动 |
| 多轨迹段上传与刷新 | 5 点、3 段，两个 LineString 和一个 Point；0.223 km、4:00，不跨段连线 |
| 缺失时间文件 | 时间不完整，耗时/配速显示“—”，路线仍展示；最终服务重载后可用 |
| 匿名直接访问 | 页面跳转登录；摘要和路线 API 均 401 |
| B 访问 A 的真实 ID | 页面“记录不存在”；摘要和路线 API 均 404 |
| B 上传同一文件 | 独立成功，ID `1edeccf0-193a-42b2-ab92-dce712be9049`，A 的列表不包含 B |
| 窗口尺寸及地图 | 容器/canvas 同步 974/670px，稳定视口路线及两端点完整展示，无加载提示 |

开发库只读核对 A 的赤道活动：原始 659 字节与文件完全一致；6 个点，派生线 ST_NPoints=6；distance_m=1113.195、elapsed_seconds=600.000、pace=538.989，temporal_quality=complete，导入后用户版本=1。开发/测试库 schema 仍为 0003；`.env` SHA256 仍为 `2f38bc025bb23749d776b23d4e67d4d734eebb7f958ac24368650bdbdb1db0ab`。

本地截图（Git 忽略）：`frontend/test-results/gpx-viewport.png` 为稳定最终视口图。初次整页截图曾显示不完整地图，已补按实际布局/尺寸适配；以稳定视口截图和实际标记位置复验，不把仅 ready 属性当视觉通过。浏览器验收为本轮 CLI 实测，不宣称新增了完整 CI E2E 套件。

## 启动与文件

8001/5183 当前可用，不重复启动。若以后停止，从根目录在两个终端运行：

```bash
backend/.venv/bin/python scripts/local-auth.py serve --port 8001 --site-origin http://127.0.0.1:5183
```

```bash
cd frontend
INTERNAL_API_BASE_URL=http://127.0.0.1:8001 pnpm dev --port 5183
```

脚本复用现有本地 HMAC 密钥，不覆盖 `.env`，不迁移或重置限流。保留既有8000/5173服务；只重载本任务8001以加载新增接口和修复。8002/5184 无监听。

本轮变更（不包含此前已完成的认证文件）：

- 新增后端 `modules/gpx/{schema,parser,normalization,metrics,fingerprint,worker,queries,service,router,body_limit}.py`。
- 新增后端 `modules/activities/{schema,service,router}.py`；修改 `app/main.py` 和 `core/errors.py` 接入路由、限额和安全重复详情。
- 新增 `tests/unit/test_gpx_algorithms.py`、`tests/integration/test_gpx_import.py`。
- 新增前端 `lib/api/activities.ts`、`lib/components/RouteMap.svelte`、`lib/server/proxy-policy.ts`、`routes/activities/[id]/+page.svelte`。
- 修改前端 `routes/activities/+page.svelte`、`lib/server/backend.ts`、`routes/api/[...path]/+server.ts`；`+layout.svelte` 仅更新本轮页脚文字，认证逻辑保留。
- 新增 `tests/unit/activities.test.ts`、`tests/unit/proxy-policy.test.ts`；修改 `package.json`、`pnpm-lock.yaml` 固定 MapLibre 依赖。
- 更新 README、本记录、第二阶段进度；新增 `docs/superpowers/plans/2026-10-12-gpx-import-map.md`。

## 未完成/未验证

- 未接入道路底图；后续需明确地图提供方、许可及隐私选择。
- 未做生产 HTTPS/代理/多机器部署、生产并发容量/RSS、真实设备浏览器兼容性或远程 CI 验收。50000 点 API/DB 测试不等于 50000 点地图性能验收。
- 未覆盖全阶段 S2-07 所有资料编辑/密码 UI 和 S2-08 全量联合门槛；本轮没有重新开展已通过的迁移/基础设施验收。
- MapLibre chunk 较大，首访详情需要下载约272 kB gzip；保留按需加载，未为消除提示改动无关构建配置。

本次业务流程已交付，工作停在这里，不自动进入其他功能或下一阶段。
