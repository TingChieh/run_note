# RunNote V1.0 集成验收

日期：2026-10-13（Asia/Shanghai）。范围：本地开发库 `127.0.0.1:5432/running_note`，经用户明确授权执行 `0003_gpx_storage` → `0005_ai_reports (head)`。未连接远程/生产数据库；未使用Docker、downgrade或付费AI。

## Git 与目标确认

- 分支 `main`，HEAD `9e59c2c506d85c16b615c194d1bee38f69e4ddc8`，相对 `origin/main` ahead 4；本轮未创建Git提交或推送。
- 执行前复核连接身份：host `127.0.0.1`、port `5432`、database `running_note`、role `run_note`，revision `0003_gpx_storage`；代码唯一head为 `0005_ai_reports`。只在该目标运行迁移。
- 本轮三个临时验收脚本随后清理。验收文档为工作区变更，未提交。

## 写入暂停、备份与隔离恢复

- 迁移前检查未见目标开发库客户端会话或等待锁。原8001/5183服务连接隔离数据库 `55445/runnote_ai_20261013_test`，与开发库无关。迁移操作期间未发现竞争写入会话。
- 备份：`~/Backups/RunNote/20261013T124735+0800-run-note-v1-upgrade/running_note.dump`，自定义pg_dump归档，39,487字节，SHA-256 `2d216fadb6eaadce7d8974c77a68bbd8b10cdaff541ffd8e87974e66fc1dfcca`。归档目录模式0700，文件模式0600；归档目录清单45项。备份位于项目外。
- `pg_dump`成功，`pg_restore --list`成功；新备份恢复到独立临时PostgreSQL实例成功，恢复库结构、业务行数及数据摘要核对通过。恢复副本从0003演练升级至0005成功。隔离恢复数据目录保留于 `/private/tmp/runnote-v1-final-restore-8f24hoat`，不属于开发库。
- 备份/恢复没有覆盖集群级角色/ACL、其他数据库或实例级配置；本任务验证的是目标库完整归档及业务数据恢复。

## 正式迁移

- 执行 `alembic upgrade head`，按序应用 `0004_public_sharing`、`0005_ai_reports`，均成功。没有锁超时、无限等待、强制终止其他会话或失败后恢复操作。
- 迁移后revision为 `0005_ai_reports`，与代码head一致。保留既定锁超时与语句超时预算。
- 0004增加主页简介、分享链接及相关外键/check/唯一约束和public局部索引；0005增加AI报告表、用户级联外键、状态/日期/完成/删除/正文/用量约束、用户时间索引、用户内幂等唯一约束和pending部分唯一索引。新增约束均validated；索引存在。未发现迁移造成旧活动行变更。
- PostGIS 3.6.4可用；SRID、几何有效性、距离及长度空间函数查询通过。

## 数据完整性

| 数据 | 升级前/备份 | 升级后 | 结果 |
| --- | ---: | ---: | --- |
| 用户 | 17 | 17 | PASS |
| 活动 | 14 | 14 | PASS |
| GPX导入 | 14 | 14 | PASS |
| 轨迹段 | 22 | 22 | PASS |
| 轨迹点 | 63 | 63 | PASS |

升级后业务行/轨迹指纹与升级前备份一致；统计指纹 `67843fd2fd55c527280e42928aae3592` 一致。完整性异常检查均为0。升级未改变活动可见性（原14条均为private）、轨迹数据或既有统计值。升级前后 `.env` 与 `.env.auth-rate.key` 摘要分别保持 `2f38bc025bb23749d776b23d4e67d4d734eebb7f958ac24368650bdbdb1db0ab` 与 `d60b37b97179fd040564452b6553738e6ef081dab541afe0ae190220a9433107`；文件未修改。

## 服务和关键流程

- PASS：标准本地API `127.0.0.1:8001` 连接升级后的开发库；前端 `127.0.0.1:5183` 代理至API。健康检查显示数据库连接、PostGIS启用、schema current；liveness为ok。
- PASS：现有浏览器登录会话有效；本人活动列表、2026统计/日历、个人足迹空态及AI统计依据页面可加载。
- NOT VERIFIED：浏览器当前账号没有活动。活动列表和个人统计显示0条，因此没有本人记录可用于详情路线地图、分享管理的有数据路径或足迹热力图非空路径。数据库的14条活动属于其他用户；没有越权查看或修改。
- NOT VERIFIED：开发库AI服务未配置，页面明确显示模型未配置且无活动，生成按钮禁用。本次没有配置Mock、创建报告或调用供应商。AI模拟生成和分享非空业务流程此前已在隔离库完成，分别见[AI验收](16-ai-running-analysis-acceptance.md)和[公开分享验收](14-public-sharing-acceptance.md)。
- Git最终状态：`main...origin/main [ahead 4]`；仅本验收记录/README/进度文档改动未提交，无迁移代码改动或密钥变化。

## 前轮范围结论

前轮数据库升级、备份恢复、迁移结构和既有业务数据完整性均PASS，正式版本为 `0005_ai_reports (head)`。开发库当前登录账号没有活动，所以前轮只确认其空数据读流程。本轮经用户授权，在独立账号和隔离数据库完成下述非空流程；没有向开发库添加测试账号或活动。

## V1.0 非空业务集成验收

日期：2026-10-13（Asia/Shanghai）。最终结果：**LOCAL INTEGRATION_PASS / MOCK AI_PASS，具备进入UI/UX优化阶段的条件**。本轮仅验收现有功能，业务代码、迁移文件和依赖没有变更。这里的通过结论覆盖本机开发启动方式及模拟AI，不代表生产部署或真实模型验收。

### 同一环境与认证机制

- 原有开发服务8001/5183保持运行。既有隔离服务8002/5184及其数据库同样保留。
- 本轮数据库为 `127.0.0.1:55445/runnote_v1_20261013_test`，在既有原生隔离PostgreSQL实例内新建；应用角色 `runnote_v1_app` 为非超级用户，无创建库/角色权限。PostGIS由隔离实例管理员预装，测试库从零升级到 `0005_ai_reports`。实际连接身份和普通角色属性已只读复核。
- 后端完整回归使用同一测试库，另设 `runnote_v1_snapshot_20261013_test` 仅供迁移历史保留用例，允许列表显式限定这两个55445目标。没有将测试URL指向开发库。
- Chrome全部业务请求使用前端5185，经既有同源API代理到8003，再访问上述单一测试库。API沿用 `create_app`、正常认证/会话/CSRF/owner校验和现有本地认证密钥；没有固定用户替代、伪造Cookie或绕过认证。
- 8003仅注入 `tests.ai_mock.DemoProvider`，模型标记为 `mock-v1-integration`。没有配置外部供应商地址或真实AI密钥，不调用付费AI。
- 正常表单注册A/B两个独立合成账号，A退出后重新登录，B在独立浏览器上下文中使用自己的会话；匿名访问使用第三个无登录上下文。失败试跑的合成账号和自动化夹具均保留在测试库，没有清理/重建任何数据库。

### 合成GPX与存储证据

成功验收账号A的四个文件全部通过Chrome文件选择及上传表单导入，没有直接写入活动表：

| 文件/日期 | 点/段 | 距离 | 耗时 | 场景 |
| --- | --- | ---: | ---: | --- |
| v1-week-one / 2026-09-14 | 3/1 | 953.044m | 600s | 基础路线 |
| v1-week-two-loop / 2026-09-21 | 5/1 | 1906.087m | 1200s | 同一路线往返、与前次重叠 |
| v1-week-three-no-time / 2026-09-28 | 3/1 | 953.044m | 未知 | 无时间，表单补录日期，配速留空 |
| v1-week-four-segments / 2026-10-05 | 5/2 | 1429.515m | 1200s | 重叠主路线与不相连的另一轨迹段 |

A共4活动、4份GPX、16点、5段；B正常上传与A第一份完全相同的文件，独立保存为1活动、3点、1段。本人去重拒绝重复上传，跨用户相同文件可独立保存。成功A/B的真实ID只保存在本地忽略的验收结果中。

隔离库只读核对：GPX原文与合成文件逐字节相同，SHA-256/byte_size一致；各点坐标、段/点序号与源XML一致，SRID均4326；派生线点数和几何有效性通过，独立 `ST_Length(geom::geography)` 汇总与保存距离差值不超过0.0006m。两段路线没有跨断点连接。

总距离5241.690m、4活动/4活动日、已知耗时3000s（3条）、缺耗时1条；配速覆盖距离4288.646m，加权平均699.521s/km，界面显示11:40/km。日历、统计、趋势和AI快照核对同一组上传记录，未知时间没有按零处理。

### 核心功能结果

| 核心功能 | 结果 | 本轮证据 |
| --- | --- | --- |
| 认证及私人数据归属 | PASS | A正常注册/退出/登录，HttpOnly/SameSite=Lax；B与匿名无法读取A私人详情、路线、分享管理和AI报告 |
| GPX上传与持久化 | PASS | 四次正常上传、刷新重读、本人重复拒绝；原文/点/段SQL核对，B独立导入相同文件 |
| 活动详情及路线地图 | PASS | 路线canvas、起终点可见，缩放及刷新重读；缺耗时详情、两段路线不桥接 |
| 年度运动日历 | PASS | 365日/4条活动，与日期一致；点击2026-09-21下钻唯一活动，刷新保留选择 |
| 运动统计及趋势 | PASS | 年度/累计/周趋势与上传记录汇总一致；周/月切换、趋势数据表和URL恢复 |
| 个人多轨迹叠加 | PASS | 4条活动/5条分段feature；过滤3条重叠记录后点击地图显示3个详情入口并可跳转 |
| 运动热力图 | PASS | 18网格，最大4次；包含1次和4次网格，往返经过没有重复计入，刷新保留模式 |
| 公开主页及分享/撤销 | PASS | private默认、unlisted摘要链接创建/复制/匿名访问、public-only主页统计/日历/下钻；两条token撤销且不复活，无公开坐标 |
| 模拟AI分析与历史/删除 | PASS | 主动同意后生成、加载/保存、历史/深链/刷新；同一4活动事实依据，B读删404，数据版本变更标记旧报告，删除后正文/快照清空且额度不返还 |

分享阶段：A的本人统计始终4条，但公开主页只统计1条public；设回private后公开统计归零。显式撤销和设private均使token立即404，再公开也不复活。分享摘要字段白名单、no-store/no-referrer及 `has_shared_route=false` 核对通过；匿名路线401，公开分享路线404。最终A四条活动全部private、两条链接均撤销。

AI阶段：全流程仅1次生成POST；刷新/查看历史没有再生成，A计入1次尝试。正常删除后详情404、历史总数0，数据库仅保留已完成的尝试元数据，`report_text=NULL`、`stats_snapshot={}`、无pending。报告删除发生在测试库，未读取真实用户报告。

### Chrome与自动化结果

- **PASS：真实安装Google Chrome 155.0.8059.40，29项完整串联检查，0未捕获pageerror。** 使用可见浏览器窗口及独立A/B/匿名上下文，正常表单操作。API断言由浏览器沿用该账号会话发出，用于核对界面事实和权限，没有构造登录Cookie。
- **PASS：后端全仓pytest 318 passed / 0 skipped，55.55秒。** 包含认证、GPX、统计、足迹、分享、AI、数据库和迁移测试；先完成回归，再顺序运行Chrome，避免夹具与浏览器交错写入。
- **PASS：前端10文件40 tests passed；svelte-check 0 errors / 0 warnings；生产构建和adapter-node输出成功。**
- **PASS：Ruff check、format --check（96文件），最终git diff --check。**
- **PASS：独立只读存储复核7项。** 覆盖原文/点段、汇总/加权配速、最终私有状态和两链接撤销、AI删除清空、B独立原文、开发库汇总和敏感文件摘要。
- 已查看详情地图、足迹叠加/热力、公开主页及AI截图；主路线/起终点、不同热力等级、日历与报告事实可见。OSM道路瓦片在足迹截图正常加载；部分截图在首次瓦片加载期间捕获，不将此视为第三方服务长期可用性证据。

本轮命令（仓库根目录；前端命令在frontend目录）：

```sh
backend/.venv/bin/python /private/tmp/runnote-v1-integration-run.py test -q --tb=short
backend/.venv/bin/python /private/tmp/runnote-v1-integration-run.py serve
# frontend目录，仅进程环境指定隔离API
INTERNAL_API_BASE_URL=http://127.0.0.1:8003 npm_config_manage_package_manager_versions=false pnpm dev --port 5185

# 仓库根目录
node output/playwright/test-results/v1-integration/v1-chrome.cjs
backend/.venv/bin/python output/playwright/test-results/v1-integration/v1-storage-check.py

# backend目录
.venv/bin/ruff check app migrations tests
.venv/bin/ruff format --check app migrations tests
# frontend目录
npm_config_manage_package_manager_versions=false pnpm test
npm_config_manage_package_manager_versions=false pnpm check
npm_config_manage_package_manager_versions=false pnpm build
```

本地证据目录 `output/playwright/test-results/v1-integration/` 已由既有 `test-results/` 规则忽略，目录权限0700；文件权限0600。保留合成GPX/manifest、Chrome脚本、29项结果JSON、trace、截图、只读存储核对脚本/JSON及本轮测试/构建日志。trace可能包含仅供验收的合成会话信息，不提交或公开。隔离运行器位于 `/private/tmp/runnote-v1-integration-run.py`；prepare拒绝覆盖已有测试库，复用时使用test/serve/verify，不重新prepare。

### V1.0验收边界与后续状态

| 状态 | 项目 | 判断 |
| --- | --- | --- |
| V1.0验收时FAIL；V1.1本地已修复 | adapter-node构建产物直接HTTP启动时，GPX multipart被SvelteKit返回403 | 根因及安全修复已在下方V1.1记录；当前本地开发模式与构建模式的Chrome上传和来源/CSRF/owner拒绝用例均通过。生产HTTPS反向代理仍未验证。 |
| 已修正的验收脚本问题 | 趋势数据入口被误定位为button | 实际为原生summary，截图确认趋势正常。仅修正本地验收脚本后完整29项重跑通过，未改业务代码 |
| 已知低影响项 | favicon.ico 404；SvelteKit replaceState弃用提示；构建MapLibre/ECharts大chunk和NO_COLOR/FORCE_COLOR提示 | 未影响本轮业务通过；可在UI/UX或性能优化时处理 |
| NOT VERIFIED | 真实AI供应商兼容性、质量/费用 | 本轮只验收模拟供应商；付费调用为0 |
| NOT VERIFIED | 生产HTTPS/代理/部署、远程CI、长期服务可用性、真实移动设备和生产并发容量 | 本机Chrome与隔离数据证据不覆盖这些范围；保留既有验收记录中的边界用例，不宣称本轮重新覆盖全部设备/故障场景 |

V1.0核心业务串联没有遗留业务FAIL；当时构建产物HTTP路径尚未通过。V1.1已完成本地开发与adapter-node构建两种模式修复和回归。真实AI、生产HTTPS反代与生产发布仍未验收。

### 收尾与保护状态

- 本轮只读统计开发库仍为17用户、14活动、14 GPX、22段、63点，revision仍0005。只读取汇总数量和版本，没有读取其他用户的私人运动字段、原文或坐标。
- `.env` 与认证密钥摘要与本文件前轮记录相同；没有写入配置或密钥。
- 本轮新增8003/5185测试服务已停止，真实Chrome会话已关闭。原8001/5183及既有8002/5184与共享隔离实例55445保留；没有修改PostgreSQL服务配置或停止共享实例。测试数据库及合成记录保留供复核。
- Git HEAD保持 `9e59c2c506d85c16b615c194d1bee38f69e4ddc8`；原未提交README/进度/本记录改动均保留。工作区只包含这三份文档改动，无业务代码、迁移或依赖变更；未提交/推送。

## V1.1 构建 HTTP 来源修复

日期：2026-10-13（Asia/Shanghai）。

- 根因：adapter-node 6.0.0 的运行 handler 在未配置 `PROTOCOL_HEADER` 时，从 Host 推导 origin，但将协议默认成 `https`。该版本不读取运行时 `ORIGIN` 环境变量。通过本机 HTTP 访问时，浏览器 Origin 为 `http://...`，SvelteKit 生产模式在调用同源 `/api` 代理之前以 `Cross-site POST form submissions are forbidden` 返回403。开发 Vite 不执行这项生产构建 CSRF 检查，因此开发流程可成功。FastAPI 的精确 `SITE_ORIGIN` 与 CSRF Token 校验并非原始构建403的拒绝层。
- 修复：加入仅允许回环主机的 `pnpm start:local` 启动入口，在私有 HTTP listener 中将 adapter-node 配置的协议头覆盖为 `http`，值由实际本地 listener 决定且不读取客户端头；Host 仍参与同源比较。API仍检查实际 Origin、会话绑定的 `X-CSRF-Token` 与 HttpOnly/SameSite Cookie。未关闭 SvelteKit CSRF、未增加受信任跨站来源。
- README补充本地构建运行方式与生产 HTTPS 反代来源要求。Playwright回归用例覆盖浏览器GPX正常导入、伪造Origin拒绝、缺失CSRF拒绝和跨账号修改拒绝；分别运行开发服务器和 adapter-node 构建产物。
- 根因复现：未配置协议头的adapter-node直接HTTP请求，用真实合成GPX multipart和匹配HTTP Origin命中SvelteKit文本403 `Cross-site POST form submissions are forbidden`；FastAPI未收到该请求。
- 修复后真实 Chrome：Vite开发模式 **1 passed**；adapter-node构建模式 **1 passed**。两种模式均正常注册两个独立合成用户、导入GPX并打开详情/路线地图；检查Cookie为HttpOnly、SameSite=Lax；伪造Origin和缺失CSRF均403，第二用户携带自己的有效CSRF尝试将第一用户活动设为public返回404。
- 自动化回归：后端单元+认证+GPX **249 passed**（使用隔离数据库、禁止迁移）；前端 **10 files / 40 tests passed**；`svelte-check` **0 errors / 0 warnings**；adapter-node production build成功。构建仍显示既有大chunk提示及NO_COLOR/FORCE_COLOR环境提示。
- 隔离与保护：测试数据库为全新临时PostgreSQL/PostGIS `127.0.0.1:55446/run_note_v11_test`，仅含合成记录；本轮临时API和数据库服务已停止。只读复核原开发库仍是 `127.0.0.1:5432/running_note`、revision `0005_ai_reports`、17用户、14活动。未修改 `.env`、认证密钥或PostgreSQL配置，没有Docker、提交、推送或部署。
- 未验证：本地`start:local`专供回环HTTP验收；生产HTTPS反代需由受控代理覆盖协议头，且Node端口不能被不可信来源直连，本轮未部署或验收该环境。生产Secure Cookie与真实移动设备也未在本轮验证。

## V1.1 UI/UX 审查

只审查并规划，没有大规模改写页面。分优先级计划见 [V1.1 UI/UX 改造计划](18-v1.1-ui-ux-plan.md)。
