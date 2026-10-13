# 个人足迹与运动热力图验收

日期：2026-10-12（Asia/Shanghai）。状态：**IMPLEMENTED / 本轮本地功能 TECHNICAL_PASS**。本轮交付个人多轨迹叠加及活动经过频率热力图，不代表生产容量或整个后续阶段验收完成。

## 实际入口与运行

- 个人足迹：http://127.0.0.1:5183/footprints 。主导航新增“个人足迹”，须登录本人账户。
- 年份示例：http://127.0.0.1:5183/footprints?year=2024&mode=heatmap 。没有本人记录时显示空状态。
- 继续复用本轮 5183 前端和 8001 后端，8001 已加载最终实现。原 8000/5173 未操作。
- 停止后启动仍采用 docs/12 的命令：`backend/.venv/bin/python scripts/local-auth.py serve --port 8001 --site-origin http://127.0.0.1:5183`，前端在 frontend 目录以 `INTERNAL_API_BASE_URL=http://127.0.0.1:8001 pnpm dev --port 5183` 启动。不执行迁移。

## 用户可见功能

年份默认按用户时区当年。支持 1900–2100 年、日期范围（结束日包含当天）、轨迹叠加/运动热力图切换。筛选和模式保存 URL，刷新和身份复查重新挂载后恢复。切换会取消旧请求，同时用请求序号防止迟到响应覆盖新结果；失败可重试，不保留过时地图假装当前结果。

轨迹按原 GPX 连续段独立绘制，不连接段间空隙。不同记录使用轮换颜色；点击重叠路线展示此处所有命中的记录，选择详情链接进入现有记录页面。提供折叠的全部可显示记录详情入口。支持缩放、拖动；单点或零长度路径也能显示。热力模式点击网格可查看经过记录数。

空结果和只有无轨迹的手工记录有明确提示；显示筛选活动数量与可显示活动数量。极区部分明确提示包含不支持区域的轨迹段数量，支持区域仍可显示。热力等级固定为 1、2–3、4–7、8–15、16及以上，不随年份最大值重新归一化；图例同时显示当前最高经过次数。

沿用 OSM 道路底图、署名及隐私说明。先加载本地背景/私人 GeoJSON，不等待外部瓦片；瓦片失败或8秒超时后移除底图，仍显示轨迹或热区，支持重试和关闭。地图初始化失败时有提示，轨迹模式的记录链接仍可使用。

## 空间统计口径

固定 **100×100 EPSG:3857 投影米**正方形网格，原点固定为投影坐标 `(0,0)`，索引 `(i,j)` 对应 `[100i,100(i+1)] × [100j,100(j+1)]`。网格不因时间筛选、地图缩放、用户或数据范围而移动。Web Mercator 的米为投影坐标单位，实际地面边长约为 `100*cos(latitude)` 米；例如上海约85.5米，不能将其解释成全球地表严格100米。没有新增空间缓存表、服务或数据库迁移。

从已有 `activity_segments.geom` 读取完整连续段，按原相邻边处理。跨日期变更线的短边先 ShiftLongitude、在180°拆分，再将东侧片段整体平移-360°；不产生横跨全球的边。先裁剪到 ±85.0511287798°，再 ST_Transform 到3857。投影坐标以1微米精度规整浮点误差，使边界行为稳定，尺度远小于GPS精度。前端按独立几何整体移动到就近世界副本，只改变显示，不修改后端网格或原坐标，不逐顶点拉伸另一条路线。

将完整投影线按不超过500投影米切分为完整短边，使用 ST_SquareGrid 生成局部候选格，以 **ST_Intersects(完整边,网格)** 判定经过。此过程不是采样点统计，也不只检测插值点；没有原始采样点的中间网格仍计入。对 `(activity_id,i,j)` 去重，按格 `COUNT(DISTINCT activity_id)`：同一记录的密集点、停留、重复绕圈和多个段在同格只贡献1；不同记录再次经过才增加。

闭合网格边界：完整线段恰好沿格边或触及格角时，相交的相邻格都可计入。**单点段/零长度边单独归入 floor(x/100), floor(y/100) 唯一格**，不向相邻格扩散。此热度表示经过该区域的运动记录数，不表示同一次绕圈次数、停留时间或精确定位密度。

路线展示也使用完整几何，没有把展示简化线作为热度输入。数据库查询先按认证 user_id 和活动日期限制活动，再读取其段；不接受 owner/user_id 等额外参数，不提供其他用户的足迹入口。

## API 与资源预算

`GET /api/v1/footprints?date_from=2024-01-01&date_to=2025-01-01&mode=tracks|heatmap`

日期采用导入时保存的 activity_date，左闭右开；前端包含结束日转换为次日。沿用已有日期验证，单次最多5年。年份等前端参数不直接传给 API。响应为统一 data/error/meta，data 为 GeoJSON FeatureCollection，附带 mode、日期、activity_count、visible_activity_count、unsupported_segment_count、grid_size_m、grid_crs、count_basis 与 max_count。

轨迹 Feature 包含 activity_id/title/activity_date/segment_index；热力 Feature 包含格索引 i/j/count 和 Polygon。私人响应沿用 no-store。匿名401、他人记录详情404，额外参数422。

单次输入上限250000点/10000段；热力上限500000条边-网格命中、20000个输出格。SQL先取预算+1后判断，超限不返回不完整热度。每条查询使用事务局部5秒 statement_timeout，超时/预算超限返回422 FOOTPRINT_LIMIT，提示缩小日期范围；commit/rollback 后不污染连接池配置。浏览器/API既有8秒代理超时同样可显示失败与重试，不宣称任意规模瞬时加载。

## 实际测试结果

| 验收项 | 本轮最终结果 |
| --- | --- |
| 相关完整后端回归 | **226 passed，0 skipped，26.94秒**；单元、认证、GPX、统计、足迹，已有独立 running_note_phase_one_test，禁迁移 |
| 足迹真实 PostGIS 测试 | 6场景通过：完整线经过无GPS点网格、采样密度/绕圈/多段去重、多条次数、分段间隙、单点、空范围、日期排除、参数拒绝、匿名/B隔离、格边、日期变更线、极区、零长度、1000条记录、点/命中/输出预算 |
| 前端 pnpm test | **8文件、32项通过**；筛选/闰日/刷新参数、响应验证、保护路径、日期变更线及对跖路线不拉伸 |
| pnpm check | **0 errors / 0 warnings** |
| pnpm build | 成功，adapter-node产物生成；既有MapLibre/ECharts大chunk及NO_COLOR/FORCE_COLOR提示仍存在 |
| Ruff check / format --check | 通过，74个Python文件格式符合 |
| git diff --check | 通过 |
| Chrome主要流程与最终回归 | **PASS**，真实安装 Google Chrome 155.0.8059.39；正常认证，无伪造Cookie/身份绕过 |

后端实际命令，在 backend 目录：

```sh
RUNNOTE_TEST_NO_MIGRATIONS=1 PYTHONPATH=. .venv/bin/python /private/tmp/runnote-tests.py -q tests/unit tests/integration/test_auth.py tests/integration/test_gpx_import.py tests/integration/test_statistics.py tests/integration/test_footprints.py --tb=short
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
```

`/private/tmp/runnote-tests.py` 是已有本地安全运行器，从 Settings 读取连接信息，仅将 database 改为独立测试目标并设置精确 TEST_DATABASE_ALLOWED_TARGETS；不打印凭据。安全守卫只读核实库名/端口且禁止指向开发库，测试没有执行DDL、清库或删除旧记录。未运行迁移/备份/恢复等已验收基础设施场景。

前端实际命令，在 frontend 目录：

```sh
npm_config_manage_package_manager_versions=false pnpm test
npm_config_manage_package_manager_versions=false pnpm check
npm_config_manage_package_manager_versions=false pnpm build
```

此进程级开关避免本机 pnpm 因 packageManager 版本选择去联网下载，不修改 package.json、锁文件或 .env。

## Chrome 证据

正常注册后验收空地图，再通过真实页面的文件选择、标题/日期表单、导入按钮追加公开上海坐标合成 GPX；没有直接写开发库构造业务记录。2024年2条运动/3个段叠加；稀疏单线与密集绕圈/重复段覆盖的6个格全部热度2。单日只选稀疏路线时热度1；包含2025年不同路线的日期范围同屏具备1与2两个热度等级。

实际通过：年份与范围刷新恢复、结束日包含当天、空筛选、查询网络失败与重试、快速日期切换迟到请求防护、地图点击重叠选择2条详情、真实详情导航、单条运动2个分离段、缩放按钮与拖动、热图瓦片阻断/重试/关闭、B不见A足迹且A详情404、匿名页面跳转及API401。

最终复核复用既有合成A/B账户正常登录，避免重复注册及重置限流。最终A记录ID：

- `38b9fba8-2354-4f36-8c08-c4d3375ac130`
- `04ad33ee-427b-4809-b3e9-439b3d6bd049`
- `f5a1c3c7-879c-422e-a233-17ebe1b13745`

这些记录仅其所属合成验收账户可查看，不把验收账户密码写入文档。此前失败/重试轮次的合成账号和导入数据均保留，没有清理。

证据位于忽略目录 frontend/test-results：`footprints-chrome-result.json`（主要流程19项），`footprints-final-chrome-result.json`（最终修复后18项），`footprints-chrome.cjs`、`footprints-final-chrome.cjs`、三份合成GPX及 `footprint-tracks.png`、`footprint-heatmap.png`、`footprint-fallback.png`。脚本仅为本次本地验收工具，包含正常表单操作，不是新生产依赖。

浏览器CLI首次在文件选择器处遇到工具modal状态异常；改用已有Playwright运行时驱动安装的真实Chrome完成验收，无改用模拟DOM或仅HTTP验收。工具异常会话已关闭，正常脚本Chrome在finally关闭。正常底图的街道渲染与故障降级均有实际截图。

## 审查、约束及未解决范围

独立只读审查发现单点边界多格、日期变更线全球适配问题；均补失败测试后修复。复核又发现逐顶点世界副本平移会拉伸对跖路线，改为独立几何整体平移并补失败测试，最终独立复核没有遗留重要问题。

开发中的日期变更线 ST_WrapX 路径触发本机PostGIS原生 SIGSEGV，PostgreSQL日志记录后自动恢复；最终实现移除该调用，改用 ST_Split/ST_Translate，空间与全部回归通过。本轮未升级数据库服务，未确定原生函数的上游崩溃根因，不把避开该路径声称为修复PostGIS本身。

未修改 .env（最终摘要与此前记录一致：2f38bc025bb23749d776b23d4e67d4d734eebb7f958ac24368650bdbdb1db0ab），无新迁移、无依赖/锁变更、无Docker、无数据库清空/重建、无提交/推送、无公开主页/分享/AI。保留本轮8001/5183供使用。

**NOT VERIFIED**：生产负载、任意250000点形状的容量、浏览器1000条轨迹性能、移动设备、远程CI/部署；日期变更线/极区边界由真实空间与前端几何单元测试覆盖，未另做这些极端位置的Chrome导入场景。大chunk提示尚未消除。固定3857投影米的纬度缩放和5年/资源预算是明确产品边界，不隐藏为全范围支持。

## 修改文件

新增 footprints 后端 router/service/__init__ 与6场景集成测试；main注册路由。新增前端 footprints API/筛选/显示几何工具、FootprintMap、/footprints 页面及单元测试；修改导航与isProtected。更新本文件、README、docs/09、批准设计和实施计划。没有重构其他业务模块。
