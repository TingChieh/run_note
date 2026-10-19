# 站点设置与用户头像

日期：2026-10-18。设计见 `docs/superpowers/specs/2026-10-18-site-settings-design.md`。

## 使用方式

- **站点设置（仅站主）**：`/settings/site`。可编辑站点标题（≤40）、侧栏副标题（≤40）、页脚标语（≤80）、站点描述（≤200，输出为 `<meta name="description">`），选择默认主题（跟随系统 / 浅色 / 深色），点击「保存站点设置」一次提交。favicon 与站内标志（logo）各有一个上传区，选择文件即上传，可「恢复默认」。非站主访问 `/settings/site` 返回 403，且设置页顶部分区链接不显示「站点设置」。
- **头像（所有可登录用户）**：`/settings`（工作区同一页面 `/workspace/settings`）的「头像」区，每个用户各自一张。侧栏与公开展示按当前展示对象显示头像，未上传或加载失败回退为昵称首字。
- **标题与品牌**：浏览器标签统一为「页面名 · 站点标题」；侧栏、移动顶栏、公开顶栏与页脚读取站点标题、副标题、标语；有 logo 时显示 logo，加载失败回退标题首字；分享海报品牌名跟随站点标题，有 logo 时绘制 logo，失败或超过 2 秒回退 R 字标，不阻断生成。
- **默认主题优先级**：访客本机手选（`runnote-theme`）> 站主设置的站点默认主题 > 系统外观。站点默认为 `system` 时即跟随系统。主题切换器中「自动」项恢复到站点默认。站主保存默认主题后，当前页面通过 `applySiteDefaultTheme` 立即生效，无需刷新；未手选的访客在首屏由 `app.html` 脚本直接解析为 `data-theme`。
- 站点读取失败时降级为内置默认值（标题 `RunNote`、副标题「跑步与足迹」、首字标志、`favicon.ico`、系统主题），页面照常渲染。

## 接口与隐私

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/site` | 公开 | 标题、副标题、页脚标语、描述、默认主题、`favicon_url`、`logo_url` |
| PATCH | `/api/v1/site` | 站主写（`require_admin_write`） | 字段全可选，`exclude_unset`，至少一个；文字去首尾空白，`title` 不得为空；`StrictInput` 拒绝未知字段 |
| PUT | `/api/v1/site/images/{kind}` | 站主写 | multipart 字段 `file`；`kind` 仅 `favicon`/`logo` |
| DELETE | `/api/v1/site/images/{kind}` | 站主写 | 恢复默认 |
| GET | `/api/v1/site/images/{kind}` | 公开 | `image/png`，无图 404 |
| PUT / DELETE | `/api/v1/me/avatar` | 本人写（`require_write`） | 只写本人，不接受客户端传入用户 ID；返回 `{avatar_url}` |
| GET | `/api/v1/me/avatar` | 本人登录 | 本人头像 PNG，无图 404 |
| GET | `/api/v1/showcase/avatar`、`/api/v1/showcase/users/{username}/avatar` | 公开 | 复用展示主体解析（站主，或 `is_active AND showcase_enabled`），否则统一 404 |

- **图片处理**：服务端 Pillow（13.0.0）只接受识别为 PNG / JPEG / WEBP 的文件（其余 415 `IMAGE_UNSUPPORTED`）；文件 ≤5 MiB（413 `IMAGE_TOO_LARGE`）；`Image.MAX_IMAGE_PIXELS = 40_000_000`，超限 422 `IMAGE_TOO_LARGE`；解码失败或最短边 <32 返回 422 `IMAGE_INVALID`。处理流程为方向校正 → 转 RGBA → 居中裁方 → LANCZOS 缩放（不放大；头像 512、logo 256、favicon 64）→ `optimize=True` 写出 PNG，不传 `exif`/`pnginfo`，因此 EXIF/GPS 与文本块一律丢弃，绕过前端直传同样安全。错误信息为中文提示，不回显文件名或 Pillow 原文。
- **请求体上限**：新增 ASGI 中间件 `ImageBodyLimit`，对 `PUT /api/v1/site/images/*` 与 `PUT /api/v1/me/avatar` 限制 6 MiB，在 multipart 解析前拒绝（413 `IMAGE_TOO_LARGE`）。上传入口为 `async def`，Pillow 处理与数据库写入通过 `run_in_threadpool` 卸载。
- **存储**：`site_settings`（单行）、`site_images`、`user_avatars` 三张新表；`users.avatar_version`（sha256 前 16 位）与头像同事务更新。二进制不放入 `users`，常规查询不读大字段。头像随用户删除级联清除。
- **新增字段**：`UserView.avatar_url`（`/me`、登录、会话；指向 `/api/v1/me/avatar?v=…` 或 `null`；管理员用户列表中恒为 `null`，避免指向错误对象）与 `ShowcaseProfile.avatar_url`（可公开时为带版本 URL，否则 `null`）。均为新增字段，既有字段不变。前端 `auth.ts`、`showcase.ts` 解析时按同源固定路径正则白名单校验。
- **公开边界**：公开响应不含邮箱、账户用户名字段、用户 ID；图片 URL 只含版本 hash（具名展示路径中的 username 属公开标识例外）。头像与 logo 不进入外部底图请求或 AI 供应商请求。站点设置与头像写入不调用 `lock_owner`，不影响 `activity_data_version`，不会使 AI 报告变为过时。
- **响应头与缓存**：图片 GET 响应带 `Content-Type: image/png`、`X-Content-Type-Options: nosniff`、`Content-Security-Policy: default-src 'none'`。SSR 代理（安全边界）**未做任何修改**，仍对所有 `/api/` 响应统一加 `no-store`，因此图片没有浏览器缓存；URL 中的 `?v=` 仅用于换图后绕过旧引用。代理对 PUT 的 8 秒超时同样不变，上传需在该时限内完成。
- 响应信封、`StrictInput`、CSRF 与 Origin 校验沿用既有约定；前端写操作先取 `/api/v1/auth/csrf`。

## 部署注意

- 新增 Pillow 依赖（`backend/pyproject.toml` 与 `requirements.lock` 已更新，含哈希）。部署或本地环境需 `uv pip sync requirements.lock`，否则后端无法导入 `PIL`。
- 新迁移 `0012_site_settings`（建三张表、`users.avatar_version`，并插入默认站点行）。迁移升级前 `/api/v1/health/ready` 与 `/api/health` 因 revision 不匹配返回 503；hooks 读取 `/api/v1/site` 失败时按默认值降级渲染。
- 本次迁移只在独立测试库 `runnote_tcx_v2_20261015_test` 升级验证。**开发库与生产库尚未升级**，须另行取得用户授权，并按「备份 → 恢复演练 → 受控单次升级 → 复核」执行。降级有防御：任一新表存在非默认数据时 `raise RuntimeError`，降级仅为单元级 mock 验证，未在数据库上实测。
- 无新增环境变量或配置项。

## 验证记录

测试仅使用合成数据；后端集成只在进程环境注入 `TEST_DATABASE_URL` 与 `TEST_DATABASE_ALLOWED_TARGETS`，指向列入允许目标的独立测试库 `runnote_tcx_v2_20261015_test`，未修改 `.env`，未触碰开发库，未执行 `alembic upgrade/downgrade`（测试库已在 Task 2 升级到 head）。以下为本次最终回归的实际结果。

| 状态 | 命令 / 范围 | 本次实际结果 |
| --- | --- | --- |
| PASS | `backend/`：`.venv/bin/pytest tests/unit -q` | 353 passed，19.58s |
| PASS | `backend/`：`.venv/bin/ruff check app migrations tests` | All checks passed |
| PASS | `backend/`：`.venv/bin/ruff format --check app migrations tests` | 166 files already formatted |
| PASS | `backend/`：`.venv/bin/alembic heads`（只读） | `0012_site_settings (head)`，唯一 |
| PASS | `backend/`：`pytest -q --tb=short -rs tests/integration/test_site_settings.py test_avatars.py test_admin_users.py test_showcase.py test_auth.py test_migrations.py test_ai_reports.py`（进程内注入测试库变量） | 91 passed，1 skipped，22.77s；唯一跳过为 `test_migrations.py:51`，需要 `TEST_SNAPSHOT_DATABASE_URL`（独立快照库），与本特性无关，跳过不计为通过 |
| PASS | `frontend/`：`pnpm test` | 30 files、176 tests passed |
| PASS | `frontend/`：`pnpm check` | 558 files，0 errors，0 warnings |
| PASS | `frontend/`：`pnpm build` | adapter-node 构建成功，保留既有大 chunk 警告 |
| PASS | `playwright.site-settings.config.ts` | 9 passed，8.7s；含站主保存站点设置、默认主题不刷新即生效、logo 失败回退首字、头像上传/移除、普通用户无入口且 `/settings/site` 403 |
| PASS | `playwright.admin-users.config.ts` | 8 passed，11.4s |
| PASS | `playwright.ui.config.ts tests/ui/theme.spec.ts tests/ui/dashboard.spec.ts` | 12 passed，19.5s |
| PASS | `playwright.route-poster.config.ts` | 22 passed，36.2s |
| PASS | `playwright.design-system.config.ts` | 6 passed，4.4s；无截图基线差异，基线未更新 |

以上 Playwright 用例均走合成 API（`frontend/tests/fixtures/ui-api.mjs` 已补齐 site、site images、`/me/avatar`、展示头像接口）。

终审后补充修复（2026-10-19）：

- 图片解码：损坏的 EXIF（`struct.error` 等）由 500 改为 422 `IMAGE_INVALID`；`convert("RGBA")` 纳入同一异常映射。
- 接受 `MPO`（手机 Ultra HDR / 多图 JPEG，取第一帧）。
- 显式像素数检查（`width × height > MAX_IMAGE_PIXELS` → 422 `IMAGE_TOO_LARGE`），不再只依赖非线程安全的 warnings 过滤；JPEG/MPO 解码前 `draft()` 降低内存。
- 上传站点图片先校验 `kind` 再读取请求体；侧栏头像在确认身份期间 `aria-hidden`；品牌 logo 样式合并到 `app.css`。

修复后复验（实际运行）：

| 状态 | 命令 / 范围 | 结果 |
| --- | --- | --- |
| PASS | `backend/`：`.venv/bin/pytest tests/unit -q` | 356 passed |
| PASS | `backend/`：`ruff check` / `ruff format --check` | All checks passed；166 files already formatted |
| PASS | `backend/`：`alembic heads` | `0012_site_settings (head)` |
| PASS | `backend/`：同上 7 个集成测试文件（测试库 `runnote_tcx_v2_20261015_test`） | 91 passed，1 skipped（`test_migrations.py:51` 需快照库，不计为通过） |
| PASS | `frontend/`：`pnpm test` / `pnpm check` / `pnpm build` | 30 files 176 passed；0 errors 0 warnings；构建成功 |
| PASS | `frontend/`：Playwright site-settings / admin-users / route-poster / ui（theme+dashboard） | 9 / 8 / 22 / 12 passed |
| PASS | `frontend/`：Playwright design-system（修复轮执行） | 6 passed，无截图差异，未更新基线 |

未运行或未覆盖：

- `ui-shell.spec.ts`：存在 3 项与本改动无关的既有失败，未运行。
- 默认 e2e（`playwright.config.ts`）、各 `*-e2e.config.ts`、`basemaps-live.config.ts`：未运行。
- 后端全量集成：只运行了上表列出的文件。
- 本地开发服务未重启，运行中的实例尚未加载新接口与新依赖，新接口未在运行实例上验证。
- 开发库未迁移（`0012_site_settings` 仅作用于测试库）；降级防御未在数据库上实测。
- 站点默认主题 `light`/`dark` 的首屏 HTML 注入仅有单元与合成 UI 覆盖，未在真实后端上做浏览器验收；UI 结果不等同真实业务验收。
- 集成中的超限请求体用例只覆盖 `Content-Length` 路径，分块上传路径（`limited_receive`）未单独测试。

## 开发库迁移记录（2026-10-19，用户授权后）

用户明确授权“推送到远程，开发库迁移，安装 pillow，但不要启动开发服务”。本节是上文“开发库未迁移 / 服务未重启”之后的执行记录。

- 推送：`254931c` 已推送至 `origin/main`（`f6c7ff0..254931c`）。
- 依赖：`uv pip install --python .venv/bin/python --require-hashes -r requirements.lock` 校验通过（47 个包，无变更）；`pillow 13.0.0` 已安装，WebP / JPEG / zlib 支持均为 True。
- 停服：原 8001 后端（当时就绪检查因 revision 不匹配持续 503）经 `./backend.command stop` 关闭，备份与升级期间开发库无其他会话；**按授权未重新启动**。5183 前端进程未改动。
- 目标：`127.0.0.1:5432/running_note`，PostgreSQL 18.6 (Homebrew) / PostGIS 3.6.4；预检 `alembic heads` 唯一 `0012_site_settings`，current `0011_admin_user_states`；迁移文件 SHA-256 `d29c24251678a8e6a07afdee5e759c407588fc385f8afd712f713e0a575bdf6a`。
- 备份：`/Users/tingchieh/Backups/RunNote/20261019T092340+0800-site_settings/running_note-before-site_settings.dump`，9779150 字节，权限 0600，目录 0700；`pg_dump --format=custom` 与 `pg_restore --list` 均成功。SHA-256 `1c32b962eded8b5cb1b11e05d08b7386f966fddfdb6863245ae581151f63a3d8`。备份前后全表内容指纹一致；不含实例全局角色与服务配置。
- 恢复演练：独立临时原生实例 `127.0.0.1:63676/runnote_site_settings_restore_test`（`_test` 名称并经 `IntegrationSettings` 显式允许目标校验），`pg_restore --no-owner --no-privileges --exit-on-error --single-transaction` 成功。全部 15 张旧表的列、索引、几何元数据、行数与内容指纹与基线一致；约束 212/224 逐字一致，其余 12 个 CHECK 约束经 dump/restore 后仅反解析文本不同（括号与 `::text` 转换位置），去除这些差异后完全相同。首轮演练正是在这里按严格比对停下的，开发库在演练通过前未升级。副本升级 `0011→0012` 后旧表与升级前副本逐字一致，`alembic check` 无差异。临时实例已停止，目录 `/private/tmp/runnote-site-settings-restore-*` 保留。
- 开发库升级：复核基线自备份以来未变化后，仅执行一次 `alembic upgrade head`（`0011_admin_user_states → 0012_site_settings`）。旧表的列、约束（逐字）、索引、几何元数据与内容指纹均不变；`users` 仅新增可空 `avatar_version`。新增 `site_settings` 1 行（全部为默认值）、`site_images` 0 行、`user_avatars` 0 行（外键 `ON DELETE CASCADE`）。未降级，未改写或清理任何业务数据。
- 复核：`alembic current` → `0012_site_settings (head)`；`alembic check` → `No new upgrade operations detected.`；进程内 TestClient（未进入 lifespan、未启动 worker 或监听端口）读取真实开发库：`/api/v1/health/live`、`/api/v1/health/ready`、`/api/health` 均 200，schema `current`。
- 审计：同一备份目录 `migration-audit.json`（0600），含表结构签名、行数、内容摘要与迁移日志，不含凭据（已核对）或业务行。保留的主要数据：184 条活动、224381 个轨迹点、238 个轨迹段、167 条小米导入、17 个用户。

未运行：开发后端未启动，新接口与图片上传未在运行实例或真实浏览器上验收；未使用真实账号登录或上传。
