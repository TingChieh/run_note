# 单账号个人展示站实施计划

**Goal:** 指定唯一账号提供匿名只读展示，唯一管理员通过 `/admin` 管理。

**Architecture:** 新增 `/api/v1/showcase` 白名单读取接口，复用领域查询。既有本人接口仍认证；统一身份依赖限制唯一管理员，注册端点关闭。前端分离展示资料与认证资料。

**Tech Stack:** FastAPI、同步 SQLAlchemy、PostGIS、SvelteKit 3/Svelte 5、Playwright Chrome。

## 全局约束

- 已确认设计见同名 spec；本计划在当前会话顺序执行。
- 保留当前全部未提交修改，只对相关文件增量编辑；不提交、推送、部署、修改密钥或迁移开发库。
- 完整轨迹例外仅限指定站主的新展示接口；禁止公开其他账号、邮箱、备注、源文件及密钥。
- 接口权限在 FastAPI 执行，适配生产 Caddy 直接代理 API 的拓扑。

## 任务 1：后端展示与权限

文件：`backend/app/core/config.py`、`api/dependencies.py`、`modules/auth/router.py`、`modules/showcase/{router,schema,service}.py`、`main.py`，测试 `backend/tests/unit/test_showcase.py`。

- [x] 写测试：匿名展示请求可达、缺失站主失败关闭、展示字段白名单、非管理员会话拒绝、注册关闭；先执行并确认失败。
- [x] 增加 `SITE_OWNER_EMAIL` 配置与精确账号匹配；`get_identity` 校验唯一管理员，登录后检查账号，关闭注册。
- [x] 新建展示 profile、activities/categories/detail/route、statistics、goals、footprints、completed reports 接口。所有查询由服务端站主 ID 过滤，报告读取不调用 recover/cleanup/provider。
- [x] 执行新测试，Ruff 检查和格式检查。

## 任务 2：前端匿名与管理员模式

文件：`lib/api/{showcase,activities,ai,footprints,statistics,milestones,running-goal}.ts`，hooks、布局、导航、页面与既有目标/记录组件；测试 `tests/unit/showcase.test.ts`。

- [x] 测试公开响应重建、错误与 URL 路由、仅 settings/admin 管理路径保护；先执行失败。
- [x] 读取默认走展示 API；活动管理读取保留本人接口，以保留备注编辑。写入继续使用原认证 API。
- [x] SSR 加载公开 profile；匿名浏览不伪造管理员，管理会话才读认证接口。提供 `/admin`，停用旧登录/注册页面。
- [x] 导航及业务页面按真实管理员状态隐藏写控件；公开 AI 不加载管理 context；目标只读展示；更新 visibility 提示。
- [x] 执行前端单测及 `pnpm check`。

## 任务 3：浏览器与部署交付

文件：合成 `ui-api.mjs`、专用 showcase Playwright 配置与 spec、README、`.env.example`、AGENTS、编号验收记录。

- [x] 合成 API 支持公开读取和管理员会话；新增真实 Chrome 桌面/手机匿名页面、完整路线、AI、管理员与退出测试。
- [x] 更新已有 UI 夹具/登录路径与受影响契约，运行相关 UI 回归。
- [x] 执行后端 unit、前端 unit、check/build、Ruff；失败时定位并做最小修复。
- [x] 文档说明唯一账号配置、已有账号部署前提、首次初始化、原生生产进程/代理与公开路线例外；不提供隐含自动注册。
- [x] 最终核对 diff、dirty 状态与权限覆盖；记录真实结果及未验证的开发服务/生产部署。

## 执行收尾

已完成实现、受影响测试与部署说明，实际证据见 `docs/55-single-owner-showcase.md`。记录指标字号的原有 UI 断言仍失败，未调整无关排版；迁移专用回归、旧真实后端前端 E2E、真实站主数据与 Linux HTTPS 部署未验收。未重启开发服务、未操作开发库数据、未提交/推送/部署。
