# 站点设置与用户头像设计

日期：2026-10-18。用户要求设置中除用户设置外增加网站站点设置（标题、icon、头像等）。已确认：

- 头像：**每个用户各自头像**，侧栏按当前展示对象显示，无头像回退首字。
- 图标：**favicon 与站内标志分开上传**；未上传时保持现有 `favicon.ico` 与首字标志。
- 默认主题：站主设「跟随系统 / 浅色 / 深色」，**仅在访客本机未手选时生效**。
- 可配置文字：站点标题、侧栏副标题、页脚标语、站点描述（meta description）；**分享海报品牌**也跟随标题与标志。
- 图片处理：**服务端 Pillow 解码重编码为 PNG**（新增依赖）。

## 方案比较（图片处理）

1. 采用：服务端 Pillow 解码、方向校正、居中裁方、缩放、重编码 PNG，必定丢弃 EXIF/GPS 与其他元数据，绕过前端直传同样安全。代价是新增依赖。
2. 浏览器 canvas 编码 + 服务端自写 PNG 分块校验：无新依赖，但自写安全关键解析器，边缘图片易误判。
3. 仅校验格式大小、原样存储：无法清除 EXIF GPS，违反坐标不外泄边界，不采用。

## 数据模型

迁移 `0012_site_settings`（实施时以 `ls backend/migrations/versions/` 确认序号）：

- `site_settings`：单行，`id SMALLINT PRIMARY KEY` + `CHECK (id = 1)`；`title VARCHAR(40)` 默认 `RunNote`；`subtitle VARCHAR(40)` 默认 `跑步与足迹`；`footer_tagline VARCHAR(80)` 默认 `记录每一步，看见你的进步。`；`description VARCHAR(200)` 默认 `汇总你的跑步数据、活动日历与运动趋势，从这里探索记录、足迹和 AI 分析。`；`default_theme VARCHAR(10)` 默认 `system`，具名 CHECK 限定 `system|light|dark`；`updated_at`。迁移插入默认行。
- `site_images`：`kind VARCHAR(10) PRIMARY KEY`（CHECK `favicon|logo`），`png_bytes BYTEA`，`width`/`height INTEGER`，`sha256 CHAR(64)`，`updated_at`。
- `user_avatars`：`user_id` 主键，`ForeignKey("users.id", ondelete="CASCADE")`，`png_bytes BYTEA`，`sha256 CHAR(64)`，`updated_at`。二进制不放 `users`，避免常规查询读出大字段。
- `users.avatar_version VARCHAR(16) NULL`：头像 sha256 前 16 位，上传/移除时与 `user_avatars` 同事务更新。`UserView` 与展示 profile 由此生成 URL，无需额外查询。
- 降级：任一表存在非默认数据（`site_images`/`user_avatars` 有行，或 `site_settings` 与默认值不同）时 `raise RuntimeError`。

## 接口与隐私

新模块 `app/modules/site_settings/`（router/schema/service/model + `images.py` 图片处理）：

| 方法 | 路径 | 权限 | 说明 |
| --- | --- | --- | --- |
| GET | `/api/v1/site` | 公开 | `{title, subtitle, footer_tagline, description, default_theme, favicon_url, logo_url}`；图片 URL 为 `/api/v1/site/images/{kind}?v=<sha256前16位>` 或 `null` |
| PATCH | `/api/v1/site` | 站主写（`require_admin_write`） | 字段全可选，`exclude_unset`，至少一个；文字去首尾空白，`title` 不得为空；返回同 GET |
| PUT | `/api/v1/site/images/{kind}` | 站主写 | multipart 字段 `file`；返回同 GET |
| DELETE | `/api/v1/site/images/{kind}` | 站主写 | 恢复默认；返回同 GET |
| GET | `/api/v1/site/images/{kind}` | 公开 | `image/png`，`X-Content-Type-Options: nosniff`，`Content-Security-Policy: default-src 'none'`；无图 404。SSR 代理对所有 `/api/` 响应统一 `no-store`（安全边界不改），URL 中的 `?v=` 仅用于换图后绕过旧引用 |
| PUT/DELETE | `/api/v1/me/avatar` | 本人写（`require_write`） | 上传/移除本人头像；返回 `{avatar_url}` |
| GET | `/api/v1/me/avatar` | 本人登录 | 本人头像 PNG（同上响应头）；无图 404 |
| GET | `/api/v1/showcase/avatar`、`/api/v1/showcase/users/{username}/avatar` | 公开 | 复用既有展示主体解析（站主或 `is_active AND showcase_enabled`），否则统一 404；响应头同站点图片 |

- `kind` 仅 `favicon|logo`，其他值 404。
- 既有 `GET /api/v1/showcase/profile` 与具名 profile 增加 `avatar_url`（可公开时为带版本 URL，否则 `null`）；`UserView`（`/me`、登录、会话）增加 `avatar_url`（指向 `/api/v1/me/avatar?v=…` 或 `null`；管理员用户列表中恒为 `null`，避免指向错误对象）。均为**新增字段**，既有字段不变。
- 公开响应不含邮箱、账户用户名字段、user id；图片 URL 只含版本 hash（具名路径中的 username 为公开标识例外）。头像与 logo 不进入外部底图请求或 AI 供应商请求。
- 写操作修改站点设置不调用 `lock_owner`（不属于运动数据，不使 AI 报告过时）；头像同理。

### 图片处理（`images.py`，同步，上传入口用 `run_in_threadpool` 卸载）

- 新增 ASGI 中间件 `ImageBodyLimit`（仿 `GpxBodyLimit`）对 `PUT /api/v1/site/images/*` 与 `PUT /api/v1/me/avatar` 限制请求体 6 MiB，在 multipart 解析前拒绝；文件读取上限 5 MiB（超出 413 `IMAGE_TOO_LARGE`）；`Image.MAX_IMAGE_PIXELS` 设为 40,000,000，解码超限或 `DecompressionBombError` → 422 `IMAGE_TOO_LARGE`。
- 只接受 Pillow 识别格式为 `PNG|JPEG|WEBP`，否则 415 `IMAGE_UNSUPPORTED`（GIF/SVG/ICO 等均拒绝）；解码失败 → 422 `IMAGE_INVALID`。
- `ImageOps.exif_transpose` → 转 `RGBA` → 居中裁方 → `LANCZOS` 缩放到目标边长（不放大小图，最小边 < 32 → 422 `IMAGE_INVALID`）：头像 512、logo 256、favicon 64。
- 以 `optimize=True` 写出 PNG，不传 `exif`/`pnginfo`，即不含任何元数据；记录 sha256。
- 错误信息均为中文用户提示，不回显文件名或 Pillow 原文。

## 前端

### 设置页

- `/settings`（与 `/workspace/settings` 共用组件）：账户设置，在现有资料/公开主页/改密码之外新增「头像」区。
- `/settings/site`：站点设置，仅站主；hooks 对非站主返回 403（同 `/admin/users`）。文字表单（标题、副标题、页脚标语、站点描述）+ 默认主题单选组，一次「保存站点设置」提交 PATCH；favicon、站内标志各一个上传区，选择文件即上传，可「恢复默认」。
- 两页顶部链接组「账户设置 / 站点设置」（`aria-current`；站点设置链接仅站主可见）。导航「设置」在两页均高亮（既有 `startsWith` 规则）。
- 新通用组件 `lib/components/ImageUpload.svelte`（头像/favicon/logo 复用）：props `label`、`src`（当前 URL 或 null）、`fallback`（无图时显示的字符）、`shape: 'circle'|'square'`、`busy`、`error`、`onselect(file)`、`onremove()`；原生 `<input type="file" accept="image/png,image/jpeg,image/webp">`；同步更新 `docs/design-system/components.md` 与 showcase。

### 数据流与渲染

- `hooks.server.ts` 对页面请求读取 `GET /api/v1/site` → `locals.site`；失败用内置默认值（`lib/site-defaults.ts`），不阻断页面。`+layout.server.ts` 返回 `site`。
- `app.html`：favicon 改为 `%runnote.favicon%`，首屏脚本读取 `%runnote.theme%` 作为无本机偏好时的默认；二者由 `transformPageChunk` 注入（值来自 `locals.site`，经白名单校验后 HTML 转义）。根元素增加 `data-site-theme`，`system-theme.ts` 的「自动」解析为站点默认（站点默认为 `system` 时即跟随系统）；`ThemeToggle` 的自动项文案改为「自动（站点默认）」。
- 标签标题：新增 `pageTitle(name, site)` 工具，11 个页面统一为「名称 · {标题}」。
- 品牌区（`AppNavigation` 侧栏与移动顶栏、`+layout.svelte` 公开顶栏）：有 logo 显示 `<img alt="">`（品牌链接保留 `aria-label`），否则显示标题首字；品牌名、副标题、页脚标语读取 `site`。
- layout 统一输出 `<meta name="description" content={site.description}>`，移除数据汇总页单独的 description。
- 侧栏头像：`profile.avatar_url` 存在时显示圆形 `<img alt="{昵称}的头像">`，加载失败回退首字；工作区由 hooks 从 `/me` 的 `avatar_url` 填入。
- 分享海报：`route-poster-render.ts` 的品牌名改用站点标题；有 logo 时以同源 URL 加载为 `ImageBitmap` 绘制，失败或超时（2 秒）回退 R 字标，不阻断生成。「每一步，都算数」不变。
- 接口层 `lib/api/site.ts`：`readSite`、`updateSite`、`uploadSiteImage`、`removeSiteImage`、`uploadAvatar`、`removeAvatar`；逐字段校验（长度、主题枚举、URL 必须匹配同源固定路径正则），失败抛 `SiteError`；写操作先取 CSRF；401 映射「登录已过期」。`lib/api/showcase.ts` 与 `auth.ts` 的解析增加 `avatar_url`（可选、同源路径白名单）。

## 错误与降级

- 站点设置读取失败：默认标题、首字标志、`favicon.ico`、系统主题，页面正常。
- 图片上传失败：错误显示在对应上传区，旧图保留。
- 头像或 logo 图片加载失败：回退首字，不显示破图。
- 未迁移的目标库：`/api/v1/health/ready` 因 revision 不匹配返回 503（预期）；hooks 读取 `/site` 失败时按降级渲染。

## 依赖与迁移

- `backend/pyproject.toml` 增加 `Pillow==<实施时最新稳定版>`，按 `requirements.lock` 头部命令重新生成哈希锁（需联网）。
- 迁移只在允许的 `_test` 库升级验证；**不在开发库执行**，开发库升级需用户另行授权并遵循「备份 → 恢复演练 → 受控单次升级 → 复核」。

## 测试

- 后端 unit：图片处理（合成带 GPS EXIF 的 JPEG 重编码后无 EXIF/文本块；非方图裁方；尺寸；拒绝 GIF/SVG 文本/截断文件/超像素；最小边）；schema（长度、去空白、空标题、主题枚举、PATCH 至少一个字段、未知字段）。
- 后端 integration（`_test` 库）：`/site` 读写权限（匿名、普通用户、站主、缺 CSRF）；图片 PUT/GET/DELETE 与响应头；请求体超限 413；头像本人读写、公开边界（未公开/停用 404、开启展示可读）、删除用户级联；迁移 head 唯一；降级防御（有数据时拒绝）。
- 前端 unit：`site.ts` 校验；主题三层解析（本机 > 站点默认 > 系统）；`pageTitle`。
- 合成 API：`ui-api.mjs` 补齐 site/images/avatar 接口。
- UI：站点设置保存后品牌名/副标题/页脚/标签标题更新；上传 logo 侧栏显示图片；站点默认深色首屏即深色，本机手选浅色优先；头像上传与回退；普通用户无站点设置入口且 `/settings/site` 403。
- design-system：新组件进入 showcase；品牌区改动若导致既有截图基线变化，单独列出由用户确认是否更新基线。

## 范围外

多套主题配色、自定义域名/SEO、交互式裁剪框（统一自动居中裁切）、海报标语可配置。

## 验证记录

特性文档与完整验证记录见 `docs/61-site-settings.md`。最终回归实际结果（2026-10-18）：

- `backend/`：`pytest tests/unit -q` 353 passed；`ruff check` 通过；`ruff format --check` 166 files already formatted；`alembic heads` 唯一 `0012_site_settings`。
- 后端集成（仅测试库 `runnote_tcx_v2_20261015_test`，进程内注入）：`test_site_settings`、`test_avatars`、`test_admin_users`、`test_showcase`、`test_auth`、`test_migrations`、`test_ai_reports` 共 91 passed，1 skipped（`test_migrations.py:51` 需要 `TEST_SNAPSHOT_DATABASE_URL`，与本特性无关）。
- `frontend/`：`pnpm test` 30 files、176 tests passed；`pnpm check` 558 files 0 errors 0 warnings；`pnpm build` 成功（既有大 chunk 警告）。
- Playwright（合成 API）：site-settings 9 passed；admin-users 8 passed；`theme.spec.ts` + `dashboard.spec.ts` 12 passed；route-poster 22 passed；design-system 6 passed，无基线差异，未更新基线。
- 未运行：`ui-shell`（3 项既有失败）、e2e 与 live 配置、其余后端集成文件；开发服务未重启；开发库未迁移。
