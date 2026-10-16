# Admin Users and Personal Showcase Implementation Plan

> 使用 subagent-driven-development 在当前会话执行。用户已确认设计，无需再请求实施许可；不提交或部署。

**Goal:** 站主管理多个账号，启用用户管理本人数据，并通过独立链接完整公开展示。

**Architecture:** 分离管理员依赖、有效登录身份、具名展示对象。复用领域 service、白名单和现有页面；私有工作区与公开展示分别使用认证和具名公开 API。

**Tech Stack:** FastAPI、同步 SQLAlchemy、PostgreSQL/PostGIS、Alembic、SvelteKit 3/Svelte 5、Vitest、Chrome。

## Global Constraints

- 设计：`docs/superpowers/specs/2026-10-16-admin-users-personal-showcase-design.md`，已获用户确认。
- 保留既有 dirty 修改，当前前置展示功能尚未提交。不开启自助注册；不提交、推送、部署或迁移开发库，不读写密钥文件。
- `SITE_OWNER_EMAIL` 是唯一管理员与默认展示站主，受保护且不被普通用户状态开关锁出。
- 历史普通账号默认停用且不公开；完整展示必须显式启用，公开轨迹和起终点，其他私有字段仍排除。
- 不允许跨用户运动数据管理或模拟登录。原七项 SSR 头白名单、CSRF/Origin、指标与导入锁保持。
- 只运行本地原生服务；测试写入仅允许独立 `_test` 数据库。

## Task 1: 后端账号与权限、具名展示

**Files:** `backend/app/modules/admin_users/{router,schema,service}.py`（新）；`users/{model,schema,service}.py`；`auth/{router,service}.py`；`api/dependencies.py`；`showcase/{router,service}.py`；`sharing/{router,service}.py`；`main.py`；新手写迁移；`backend/tests/unit/test_admin_users.py`、`backend/tests/integration/test_admin_users.py`（新）。

**Interfaces:**
- Auth UserView 增加 `is_admin: bool`、`showcase_enabled: bool`，均由 settings+用户状态计算；其余字段保持。
- AdminUser 是 UserView 加 `is_active: bool`。列表 `{items,total,limit,offset}`；GET `/api/v1/admin/users?search=&is_active=&limit=&offset=`。
- POST `/api/v1/admin/users` 输入 `{email,username,password,display_name,timezone,is_active,showcase_enabled}`，默认启用登录、不公开，返回 AdminUser。
- PATCH `/api/v1/admin/users/{id}` 输入 email/display_name/timezone/bio/is_active/showcase_enabled 中至少一项，username 不可变，站主 email/is_active/showcase_enabled 受保护。
- POST `/api/v1/admin/users/{id}/reset-password` 输入 `{new_password}`，返回 `{password_reset:true}`，仅普通用户。
- GET `/api/v1/showcase/users/{username}/...` 与既有 showcase 资源一致，普通用户须 `is_active AND showcase_enabled`；配置站主始终可展示。
- 数据库 `users.is_active`、`users.showcase_enabled` 两 Boolean 默认 false；站主身份计算特判。创建新普通账号显式写 true/false。
- UserView 的 `is_admin` 在 auth/me 调用时显式传入配置，不能仅靠邮箱默认常量。

- [x] 先写并运行失败测试：普通用户登录、禁用旧会话、站主保护、创建重复邮箱、具名公开权限与隔离、白名单。
- [x] 添加状态字段和连续迁移，降级遇到启用/公开普通状态拒绝；不操作开发库。
- [x] 实现 admin service 严格校验、users 行锁、会话撤销、403 管理员鉴权；路由提交事务。
- [x] 登录允许启用普通用户；旧会话每次核对状态。禁用自动清除展示开关；启用不恢复开关或会话。
- [x] 具名 showcase 复用现有读取路由/序列化，保持 SQL owner 约束；旧摘要/分享读取也检查账号有效状态。
- [x] 单测、Ruff；报告失败→通过证据，保存到本计划 scratch 的 task-1-report.md。

## Task 2: 前端展示上下文与本人工作区

**Files:** 新 `lib/api/view-context.ts`，`lib/api/{auth,showcase,activities,statistics,milestones,running-goal,footprints,ai}.ts`、hooks、app types、layout/navigation、业务页面、路由薄包装；新 `tests/unit/view-context.test.ts`。

**Interfaces:** 使用 Task 1 契约。页面路径 `/p/{username}` + dashboard/activities/activities/{id}/activities/wall/footprints/ai；`/workspace` 同资源并含 settings；管理员 `/admin/users` 由 root 完成，请勿编辑该目录。

- [x] 失败测试：具名展示 API/导航路径编码与保留、工作区走本人 API、根站主不受普通登录影响、只读身份。
- [x] User 类型增加 is_admin/showcase_enabled，readSession 严格校验；旧测试合成身份同步补字段，不把未知身份视为管理员。
- [x] 明确上下文，公开不读取本人详情/AI context；仅匹配自己的管理上下文显示写控件。不使用 SSR 跨请求可变全局。
- [x] 增加 `/p/[username]` 和 `/workspace` 的薄页面入口、SSR profile 与权限；复用页面内容/组件，不复制业务计算。用户关闭展示仍可访问工作区。
- [x] 所有内部链接/地图卡片/分页/返回保留上下文，设置和登录跳转适配；站主 root 仍可管理，普通用户 root 只读。
- [x] 修改 AuthForm 登录默认跳转：管理员保留 dashboard，普通用户 workspace/dashboard；退出保持公开浏览。
- [x] 单测/check，记录真实结果到 task-2-report.md；尽量不编辑 root 负责的 ui-api.mjs 与 admin UI。

## Task 3: 用户管理界面与合成验收

**Files:** `frontend/src/lib/api/admin-users.ts`、`routes/admin/users/+page.svelte`、`tests/unit/admin-users.test.ts`、`tests/ui/admin-users.spec.ts`、专用 Playwright 配置，`tests/fixtures/ui-api.mjs`、admin 入口。

- [x] 先测试接口运行时校验、CSRF 写入、错误；API 不接受未知身份字段/密码回传。
- [x] 用 PageHeader/FeedbackState、原生 table/dialog 做分页筛选、新建/编辑、启用/禁用、公开开关、重置和复制链接；密码不在列表或 URL，失败保留草稿。
- [x] 站主受保护；普通账号看不到用户管理入口；所有危险动作二次确认，关闭/成功恢复焦点。
- [x] 合成 API 增加真实契约；Chrome 覆盖管理员 CRUD/状态/重置、普通用户拒绝、个人页导航隔离、工作区私有读写、明暗/手机/键盘。

## Task 4: 集成、迁移演练与交付

- [x] 在显式允许的独立测试库只读核对目标/revision，再升级新迁移，运行 admin/showcase/auth/sharing 与跨用户回归；开发库保持。
- [x] 执行后端单位与 Ruff、前端 unit/check/build、最小相关 Chrome；修复实际失败，不把跳过当通过。
- [x] 独立审查本功能改动的权限、公开边界、路径和迁移；处理发现。
- [x] 更新 README/AGENTS/离线工具说明和下一编号特性文档，写使用方式、接口与隐私、验证记录；原单站主文档加后续扩展说明。
- [x] 核对最终 diff 与 dirty 状态；记录未加载开发实例、未真实用户/HTTPS/生产验收，不提交/推送/部署。

## 完成证据

2026-10-16：后端319单测、独立PostGIS215集成、Ruff154文件检查；前端158单测、check 0/0、adapter-node构建；Chrome开发构建新增7通过，生产构建原展示6+新增7通过。最终审查两P2已复现修复与复核。记录见 `docs/56-admin-users-personal-showcase.md` 与本计划 scratch 报告。开发库、真实账号和密钥未改；未重启开发服务，未提交/推送/部署。
