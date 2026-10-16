# 用户管理与独立个人展示

日期：2026-10-16。已确认设计：固定站主继续公开展示，管理员管理多个账号；其他用户可使用独立链接展示与站主相同的完整内容，并在本人工作区管理数据。本记录取代第 55 篇的单账号登录限制；原生 systemd/Caddy 模板继续适用。

## 使用方式

- 主域 `/dashboard`、记录、足迹墙、足迹和 AI 页面始终展示 `SITE_OWNER_EMAIL` 对应站主。普通账号登录不会改变主域的数据对象。
- 站主直接访问 `/admin` 登录，在 `/admin/users` 列表按邮箱/用户名与启用状态筛选、分页，新增/编辑用户，启用/禁用登录，重置密码，开启/关闭完整展示，以及复制展示链接。
- 新账号默认启用登录、不公开。用户名为 3–30 位小写字母、数字或下划线，创建后固定。初始/重置密码要求 12–128 字符，不出现在列表或 URL。
- 普通启用账号同样从 `/admin` 登录，默认进入 `/workspace/dashboard`；记录导入/编辑/删除、目标、AI 生成/删除和设置只作用于本人。本人可在 `/workspace/settings` 输入当前密码修改密码，成功后全部会话失效并重新登录。
- 完整展示入口 `/p/{username}` 跳转到 `/p/{username}/dashboard`；另有 `activities`、`activities/{id}`、`activities/wall`、`footprints` 和 `ai`。导航、记录链接、返回、地图卡片和分页保留该用户上下文。即使站主已登录，这些页面也始终只读。
- 开启展示前会提示：全部历史及未来记录（含 private/unlisted）、完整路线与精确起终点均会公开。旧版摘要主页开关不控制完整展示；需要隐藏完整展示时，由管理员关闭账号展示。
- 禁用账号会保留数据、撤销全部会话、关闭完整展示，并阻断旧摘要主页、公开记录及分享链接。重新启用不恢复会话或展示开关。修改邮箱或重置密码也撤销该账号全部会话。
- 配置站主是唯一管理员，邮箱、启用和展示状态受保护，不允许通过管理接口重置站主密码；站主使用设置页输入当前密码修改。没有硬删除账号、模拟登录或跨用户运动记录管理。
- 注册继续关闭，旧 `/login`、`/register` 返回 404；前台不增加登录/注册入口。

## 接口与隐私

管理员接口（均使用既有响应信封，写操作要求 CSRF/Origin）：

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/v1/admin/users` | `search`、`is_active`、`limit`、`offset` 分页筛选 |
| POST `/api/v1/admin/users` | 创建邮箱/用户名/昵称/时区/初始密码/登录及展示状态 |
| PATCH `/api/v1/admin/users/{id}` | 至少一个 email/display_name/timezone/bio/is_active/showcase_enabled 字段；不允许改用户名 |
| POST `/api/v1/admin/users/{id}/reset-password` | `{new_password}`，撤销全部会话 |

认证及本人资料增加明确的 `is_admin`、`showcase_enabled` 布尔值；管理用户视图另含 `is_active`。后台权限由后端 `require_admin` / `require_admin_write` 执行，普通用户直接调用返回 403；本人资源继续在 service 中按 owner 过滤，他人资源统一 404。

具名公开 GET `/api/v1/showcase/users/{username}/...` 复用根展示的资源与独立白名单。每次请求先解析展示对象：配置站主或同时启用登录与完整展示的普通用户。无效/未公开/停用对象统一 404；所有活动、目标、统计、报告和空间查询由服务端约束该用户 ID，不能接受客户端指定 owner ID。

公开响应包含昵称、时区、活动标题/分类/标签/指标、完整路线与精确起终点，以及已成功未删除报告的公开内容。邮箱、内部 owner ID、账户用户名字段、私人备注、源文件名、GPX/TCX 原文、质量原文、密码/会话/供应商密钥不公开。username 是展示 URL 的公开标识。公开 AI 不调用私人 context/recover/cleanup 或供应商；生成报告仍保留既有汇总白名单和本人授权。旧摘要接口仍不公开路线。

SSR 代理的固定目标源、同源 `/api/` 路径、七项请求头白名单、11 MiB 上传限制保持。Cookie、CSRF、Origin、导入互斥锁、数据版本和归属校验保持；公开页隐藏写控件只是界面约束，真实权限由后端执行。

## 部署与迁移

继续原生 PostgreSQL/PostGIS、Python、Node、pnpm 和 Caddy/systemd，不使用 Docker。`infra/native/` 路由模板无需新增路径规则：`/api/*` 到后端，`/p/*`、`/workspace/*`、`/admin/*` 等由 Node 处理。

1. 受控部署前核对目标库、代码版本、`alembic heads/current`，备份到项目外并完成恢复演练。升级开发库或生产库仍需单独授权；此功能实现不代表授权迁移真实库。
2. 本次新增手写迁移 `0011_admin_user_states`，为 `users` 加入 `is_active` 和 `showcase_enabled`，数据库默认均 false。因此历史普通账号默认停用/不公开，旧会话不可继续使用；配置站主由服务端特判为管理员/有效展示，不会被这两个默认值锁出。
3. 由操作者在受控单次步骤执行 `alembic upgrade head`，禁止各 worker 自动迁移。应用期望版本与目标库不一致时 ready 会返回 503；应协调升级与服务切换。已有数据状态的降级会被防御性拒绝，不把 downgrade 视为默认回滚。
4. 后端继续显式设置 `SITE_OWNER_EMAIL`。恢复已有站主数据库后用 `backend/.venv/bin/python scripts/site-owner.py status` 只读核对。只有全新空站初始化时才受控运行 `create`；该脚本不自动升级、不重置或启用其他账号，配置站主无需额外状态初始化。
5. 升级后站主登录后台，只为需要的历史账号显式启用登录/展示。启用登录不自动公开，重新启用也不恢复展示。完整公开包含历史 private/unlisted 记录，开启前须核对目标账号与提示。
6. 按第 55 篇配置 HTTPS、受控 Origin、Secure/HttpOnly Cookie、内部 API/Node 监听和进程密钥。上线验收补充两名用户具名导航与路线隔离、未公开404、普通本人管理/管理员403、禁用/改邮箱/重置会话失效和主域固定站主。

本次只核验并升级原生独立测试库 `127.0.0.1:5432/runnote_tcx_v2_20261015_test`，从 `0010_footprint_snapshots` 到 `0011_admin_user_states`。开发库、真实账号、密钥和生产环境未改动；当前开发服务尚未重启加载新功能。

## 验证记录

测试全部使用合成数据或显式允许的 `_test` 库；进程内注入测试变量，不改 `.env`。迁移升级成功后再执行真实 PostGIS API 集成。

| 状态 | 命令 / 范围 | 本次实际结果 |
| --- | --- | --- |
| PASS | 后端 `.venv/bin/pytest tests/unit -q` | 319 passed，19.97s |
| PASS | 独立库 `pytest tests/integration --ignore=tests/integration/test_migrations.py -q --tb=short` | 215 passed，85.91s；含真实登录、账号创建/变更/重置、跨 worker 会话失效、GPX 与完整展示隔离 |
| PASS | `ruff check app migrations tests` / `ruff format --check app migrations tests` | All checks passed；154 files already formatted |
| PASS | 前端 `pnpm test` | 27 files、158 tests passed |
| PASS | 前端 `pnpm check` | 0 errors、0 warnings |
| PASS | 前端 `pnpm build` | adapter-node 构建成功，保留既有大 chunk 警告 |
| PASS | 离线工具 Ruff/check format 与 `site-owner.py --help` | 检查通过；1 file already formatted；帮助正常退出 |
| PASS | `playwright test --config playwright.admin-users.config.ts` 最终开发构建验收 | 7 passed，10.5s；账号操作、两用户全页面/路线只读、私有工作区、改密重登、禁用与403、真实站内链接切换 |
| PASS | `playwright test --config playwright.showcase-build.config.ts` | Node 生产构建 +合成 API，6 passed，6.2s；匿名桌面/手机/明暗、管理员退出和关闭注册 |
| PASS | `playwright test --config playwright.admin-users-build.config.ts` | 同一生产构建新增功能，最终 7 passed，6.7s |
| PASS | `git diff --check` | 无空白错误 |

后端宽回归初次 7 failed /208 passed：旧合成账号夹具未显式启用，切换模拟站主配置后被新状态规则拒绝，另有身份字段精确断言滞后。仅为新建的测试账号写入 `is_active=True` 并更新字段断言后，215 项全部通过；正式权限没有放宽。新 Chrome 权限检查初次误把页面导航算作 API 读取，修正监听范围后通过。

独立审查发现两个 P2：客户端切换展示对象时，根 layout 资料及侧栏目标可能沿用前一对象。新增真实 `<a>` 点击回归，修前实跑分别出现旧昵称和旧 37 km 目标（期望本人昵称和 89 km）；根 server load 显式跟踪 `url.pathname`，侧栏目标按上下文 prefix 重建后，7 项全部通过。审查复核确认两项根因已解决，未发现新增 P1/P2。该用例直接覆盖具名页→本人工作区；具名 A→B 与不同合成时区没有由这条用例直接执行，双用户页面硬导航与后端查询隔离另有覆盖。

生产构建旧展示首轮 5 passed /1 failed：旧断言仍要求退出到 `/admin?reason=logout`，已批准的当前行为是在公开页退出后继续公开浏览。测试改为断言仍在 `/activities`、身份变为公开展示和写控件消失，没有更改实现或放宽认证断言。重跑 6 项通过。新增功能生产构建首轮 6 passed /1 failed：仪表盘自动补充 year/metric/period 查询，旧断言要求 URL 严格无 query。改为断言稳定 pathname 后，全部 7 项通过；未更改业务代码。

桌面个人详情和手机暗色账号弹窗截图已实际打开检查。路线与精确起终点可见、无编辑/分享写控件；底图不可用时路线仍显示。手机表单在视口内滚动，保留草稿与错误提示。视觉证据来自合成 API，不等同真实用户业务验收。

### 未运行与限制

- 未运行迁移专用 `test_migrations.py` 的完整空库/历史迁移矩阵；本轮已真实升级独立库并有防御降级单测。
- 未运行整个 Chrome 全集或历史注册式真实后端 E2E；后者需改为独立测试库离线预置受管账号，不得重开正式注册。
- 未重启开发服务，未操作真实站主或其他真实账号，未调用真实 AI 供应商；未在 Linux/公网 HTTPS 验收部署模板。
- 未提交、推送或部署。原工作区已有的 UI/地图/设计系统修改全部保留，不全部归因于本功能。

### 改动范围

- 后端：新增 `modules/admin_users`、用户状态迁移；扩展 auth/dependencies/users、具名 showcase 和旧摘要账号有效性检查，复用现有事务与领域 service。
- 前端：新增 admin-users 客户端与 `/admin/users`、显式 view-context、`/p/[username]/*` 与 `/workspace/*` 薄路由，复用原页面/组件；登录、导航与本人密码设置适配。
- 测试：账号权限/迁移/具名读取单元及集成、上下文/API 单元、合成 API 与专用 Chrome 配置；旧合成账号创建夹具适配新状态。
- 文档：设计/计划、本记录、README、AGENTS、`.env.example` 注释及第 55 篇后续扩展指引。


## 同日本机部署记录（用户另行授权后）

用户明确授权“提交部署”，并选择“部署到本机现有服务，完成数据库备份、恢复演练、迁移和重启”。本节是前述“未部署”开发验收之后的执行记录，不代表公网发布。

- 目标：原生 `127.0.0.1:5432/running_note`，PostgreSQL 18.6 /PostGIS 3.6.4；核对既有后端8001及Vite前端5183的命令和项目工作目录后暂停，消除备份期间的会话及后台写入。
- 项目外自定义格式完整备份：`/Users/tingchieh/Backups/RunNote/20261016T213353+0800-admin_users/running_note-before-admin_users.dump`，9779171字节、权限0600、目录0700；`pg_restore --list`通过。SHA256：`20c860d18aae2ef0d3643804ea1f388443f32018d6c92e4c0447cb8fb59a313c`。不包含整个实例全局角色/服务配置。
- 独立原生恢复目标：`127.0.0.1:64657/runnote_admin_users_restore_test`，明确通过 `_test` 名称与目标允许验证。完整事务恢复、旧结构/全表内容指纹校验、`0010→0011`演练和 `alembic check`均通过。恢复不带原owner/ACL；临时实例已停止、目录保留。
- 首轮演练在新增约束比对处停止：PostgreSQL18对两个新增非空字段登记 `users_is_active_not_null`、`users_showcase_enabled_not_null`，均为有效的 `n` 约束。将验证限定为仅允许这两个预期约束后，从同一未变化备份重新完整恢复演练通过；开发库在演练通过前未执行升级。
- 开发库最终基线复核一致后，仅执行一次 `0010_footprint_snapshots→0011_admin_user_states`。全部原列内容指纹、行数、索引和几何元数据保持；仅增加两个预期 Boolean非空默认false字段及对应约束。`alembic check`输出 `No new upgrade operations detected.`。未重置密码、启用普通账号、改运动记录或重写配置密钥。
- 迁移证据位于同一备份目录 `migration-audit.json`。为避免新状态丢失，不执行降级；回滚需基于备份和实际目标另行受控规划。
- 原后端8001与Vite前端5183已重启；前端只在进程环境指向8001，未改 `.env`。实际读取后端ready、前端 `/api/health`、公开profile均200；匿名后台API401、无效个人页404；离线工具status确认配置站主存在。
- 真实Chrome连接本机运行服务，五个公开页面的HTTP200、预期标题、无写控件，以及 `/admin` 登录表单均通过。未使用真实密码登录或在真实账号执行增删改；账号生命周期写入仍以此前隔离库/合成Chrome证据为准。未执行公网HTTPS验收或Git推送。

提交范围专门从工作区拆出：不包含既有底图、地图染色、页面动效和设计系统工作；混合文件只提交本功能所需段落，原工作区内容不覆盖。精确提交快照在项目外独立目录重新验证：后端319单测（20.54s）；前端24文件/150单测、类型0错误0警告、adapter-node构建通过；新增账号与个人展示生产Chrome7项通过（7.5s）。与前述158项的差额是未纳入本提交的既有独立地图单元测试，并非删减原工作区测试。
