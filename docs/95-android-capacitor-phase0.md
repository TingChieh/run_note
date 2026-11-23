# Android Phase 0 Capacitor 技术验证

范围为 #131，依据 #130。初次验证基线为 `15ae3b81bcf769f96cc835306a3bfb8c06e8e038`（PR #135 head `dffa5f71949f30206daff3885484d780bef0a41c`）；本次重跑按独立审查条件补齐 WebView 最低版本与升级防护、系统 Back 键、文件选择器 MIME 及本地隔离 HTTPS/`__Host-` Cookie 验证。本次改动仍限定在 Phase 0 范围（`android/`、极小前端客户端 Back 桥接及 `MifitnessImport` `accept` 对齐、验证文档与测试），不改 Web SSR 架构、不进入 Phase 1–3、不合并、不部署、不执行生产迁移。

## 阶段结论

**CONDITIONAL-GO（有条件通过；剩余两项准入 gate 未关闭前暂不启动 Phase 1）**。

上次 NO-GO 的三项应用层阻塞已全部修复并在 API 29 模拟器上验证通过：
1. **WebView 最低版本与升级路径**：明确了 API 29 库存 WebView 74 无法水合的根因与最低要求（**Android System WebView / Chrome 116+**）；在 `MainActivity` 启动前增加原生版本检测与升级引导页，在库存 WebView 74 上验证不再白屏/报错，更新到 WebView 133 后完整流程通过。
2. **系统 Back**：接入 `@capacitor/app` 8.1.2 与前端 `capacitor-back.ts`，验证了移动端导航抽屉、Popover（底图选择器）、模态 `<dialog>`（删除确认）、详情 → 列表 → 首页回退及无历史时退出，无双导航或卡死。
3. **文件选择器 MIME**：通过 `RunNoteWebChromeClient` + `FilePickerIntentHelper` 解决 Android `MimeTypeMap` 缺失 `.gpx`/`.tcx` 映射导致 DocumentsUI 禁用默认 MIME（`application/octet-stream`）文件的问题；实测 Downloads 中默认 MIME 的 `.gpx`、`.tcx` 及 Mi Fitness `.json` + `.gpx` 均可选中并成功返回 HTTP 201。
4. **HTTPS 与 `__Host-` Cookie（隔离演练）**：在独立本地 TLS 反向代理 + `APP_ENV=production` + `SITE_ORIGIN=https://localhost:15443` 下验证了 `__Host-run_session`（`HttpOnly; Secure; SameSite=lax; Path=/`）、`window.isSecureContext`、CSRF 拒绝/放行、重启持久化与退出注销。

**剩余未关闭 gate（进入 Phase 1 前必须完成）**：
- **真机未验证**：当前开发机未连接可用于 UI 验收的 Android 真机（`adb devices` 仅见一台无屏 USB 5G 随身 Wi-Fi `MU300/F50`，未对其做任何操作）。真机上的 WebView 升级渠道、手势导航、安全区/刘海、系统夜间模式、云盘/系统文档提供者及 GPU 地图性能待设备所有者安排真机实测。
- **公网可信 CA 的 staging/生产 HTTPS 域名未验证**：本次 HTTPS 验证使用仅限 debug 包的临时本地 CA（`https://localhost:15443`），未触碰生产环境，也不等价于公网可信证书链（如 Let's Encrypt + Caddy、HSTS、外链与重定向边界）的正式域名验收。

## 最低系统与 WebView 要求

| 维度 | 要求 | 技术依据 |
| --- | --- | --- |
| 最低 Android API | **API 29（Android 10）** | 维持既有基线（`minSdkVersion = 29`），支持独立更新 System WebView 与现代 SAF DocumentsUI。 |
| 最低 WebView / Chrome | **116+**（`minWebViewVersion = 116`） | 1) Vite 8 默认 `build.target = "baseline-widely-available"` 对应 `chrome111`（保留 ES2020 `?.`、`??` 等现代语法，库存 API 29 的 WebView 74 在加载入口 chunk 时直接抛 `SyntaxError: Unexpected token ?`，阻断 SvelteKit 水合）；2) Tailwind CSS v4 与 `color-mix()` 需 Chrome/WebView 111+；3) 原生 Popover API（`AnchoredPanel`/`BasemapPicker`/`DatePicker`/`TimePicker`）需 114+；4) 前端在 `running-diary.ts`、`ActivityPosterDialog.svelte`、`RoutePosterDialog.svelte` 中直接调用 `AbortSignal.any()`，需 **Chrome/WebView 116+**。 |
| 过旧 WebView 降级策略 | **启动前原生拦截 + 升级引导页** | `MainActivity.load()` 在初始化 Capacitor `Bridge` 之前调用 `WebViewCompat.getCurrentWebViewPackage()`，若版本 `< 116` 或组件缺失，不加载远端 SSR URL，直接展示零 WebView 依赖的原生布局 `activity_webview_upgrade.xml`：显示当前包名/版本号与最低要求，提供「前往更新 WebView」（`market://details?id=<pkg>` → HTTPS Play 链接 → 系统应用详情降级）、「打开 WebView 应用信息」及「重新检测」按钮，避免静默白屏或 `ActivityNotFoundException` 崩溃。 |

> 说明：华为 WebView（`com.huawei.webview`）采用独立版本号体系，当前在 `WebViewSupport` 中按 Capacitor 既有约定区分（`>= 10`），真机阶段如涉及华为设备需单独确认其内核对应的 Chromium 特性版本。无 GMS 设备走「打开 WebView 应用信息」与系统应用市场升级路径。

## 加载与认证

| 方式 | 结果与影响 |
| --- | --- |
| `server.url` | 单一服务器来源让页面、Node SSR、相对 `/api` 代理及浏览器 Cookie 处于同一源。可独立更新部署的 Web，离线启动依赖后续设计。Capacitor 的 `server.url` 是开发用配置，若用于 Phase 1 发布，需先确认正式容器加载方案、导航白名单及桥接信任边界。 |
| 打包前端静态资源 | `pnpm build` 的 `build/client` 顶层只有 favicon 和 `_app`，没有 `index.html`。会话、路由保护、站点上下文和 `/api` 代理依赖 Node 端。直接打包无法运行现有入口。独立移动 SPA 可提供离线启动壳，需要原生包或受控静态资源更新机制，以及独立的 API/认证设计。 |

**Cookie 与生命周期补充发现**：Chromium Android WebView 默认将新写入的 Cookie 暂存在内存并异步落盘，若登录后立即被系统强杀（`am force-stop`），可能出现会话丢失。已在 `MainActivity.onPause()` 增加 `CookieManager.getInstance().flush()`，切后台后强杀再启动会话稳定保持 200。

建议 Phase 1 保留现有同源 Cookie Session、CSRF 与 Origin 校验（`HttpOnly`、`Secure`、`SameSite=Lax`、`__Host-run_session`），并在公网可信 CA 的 staging/生产等效 HTTPS 域名上完成最终验收；不要伪造 `Origin`、把主机会话暴露给 JS 或扩大 SSR 代理头白名单。

Google Play 的最低功能和稳定性规则会影响依赖网络的容器。发布前应验证首次启动、断网恢复、可操作的错误状态及独立移动使用价值，并核对目标 API、隐私与权限声明。

## 插件与下一步

| 能力 | 待验证与建议 |
| --- | --- |
| Health Connect | Phase 2 优先评估支持 Capacitor 8 的桥接或 Jetpack Health Connect 小型插件。Android 10–13 有独立 provider 安装情形，Android 14+ 使用系统模块。验证可用性与权限撤回，按最少权限读取运动会话和经用户同意的路线，处理分页、来源和去重。 |
| HealthKit | iOS 适配阶段评估维护中的插件或 Swift 桥接。明确 HealthKit entitlement、用途说明、授权和数据读范围，验证 `HKWorkout` / `HKWorkoutRoute`、锚点和来源去重。 |
| 后台 GPS | Phase 3 评估支持持续定位、前台服务通知和持久状态的插件或原生桥接。验证锁屏、暂停恢复、权限变化及进程终止。在 Android 和 iOS 真机分别验证。 |
| 文件选择 | Phase 0 已在 Android 端覆写 `BridgeWebChromeClient`（`RunNoteWebChromeClient`）解决 `.gpx`/`.tcx`/`.json` 在 DocumentsUI 被禁用的问题，并验证了 Downloads 下的 GPX、TCX、Mi Fitness 导入。后续在真机验证第三方云盘（Google Drive/网盘/微信转发文件）提供者、大文件与多选取消。 |
| 安全存储 | 当前架构让 WebView 管理 HttpOnly Cookie。若未来有原生凭据需求，评估维护中的 Keystore/Keychain 插件或专用桥接，覆盖退出、备份、设备恢复及吊销。 |
| 认证与来源 | 已在本地隔离 HTTPS（`APP_ENV=production` + `__Host-run_session`）走通；仍需在公网可信 CA 域名与真机完成最终验收。跨来源或原生认证需要独立安全评审。 |

参考 [Capacitor 配置](https://capacitorjs.com/docs/config)、[SvelteKit adapter-static](https://svelte.dev/docs/kit/adapter-static)、[Google Play 功能和体验政策](https://support.google.com/googleplay/android-developer/answer/9899034)、[Android Health Connect](https://developer.android.com/health-and-fitness/health-connect)、[Apple HealthKit](https://developer.apple.com/documentation/healthkit)。

## 验证记录（Phase 0 重跑）

### Android 构建与原生单测

- 环境：Google SDK cmdline-tools、Emulator 37.3.10.0、API 29 Google APIs x86_64 r13 系统镜像、Platform Tools 37.0.3、Temurin JDK 21.0.13.1、独立 PostgreSQL 18 + PostGIS 隔离测试库（`android_phase0_test`，head `0033_ai_assistant`）。SDK、临时证书与测试库均位于仓库外。
- 依赖与构建：
  - `pnpm --dir android install --frozen-lockfile`（新增 `@capacitor/app@8.1.2`）
  - `pnpm --dir android sync`（检出 1 个 Android 插件 `@capacitor/app@8.1.2`）
  - `(cd android/native && ./gradlew --no-daemon testDebugUnitTest assembleDebug)`：成功（JUnit 8/8 通过：`WebViewSupportTest` 4/4、`FilePickerIntentHelperTest` 4/4）。
  - 最终调试 APK：`android/native/app/build/outputs/apk/debug/app-debug.apk`，SHA-256：`c210f601a715300e52a60ab3c4d3be9841191079b9827de22b11c24bf3044e39`（未提交 APK 或 keystore）。

### 1) 库存 WebView 74 防护实测（API 29）

在 `emulator-5568` 上卸载 WebView 更新，确认 `dumpsys webviewupdate` 回退至库存 `74.0.3729.185` 后启动应用：

- `logcat` 记录 `W RunNoteWebView: Unsupported system WebView: package=com.google.android.webview, version=74.0.3729.185, required>=116`，未加载远端 SSR，无 `SyntaxError`。
- 屏幕呈现原生中文升级页（`需要更新系统 WebView`、`当前检测：74.0.3729.185（com.google.android.webview）`、`前往更新 WebView`、`打开 WebView 应用信息`、`重新检测`）。
- 点击「重新检测」显示 `仍检测到旧版 WebView（74.0.3729.185），请先完成系统组件更新后再试。`；点击「打开 WebView 应用信息」成功跳转 `com.android.settings/.applications.InstalledAppDetails`；按系统 Back 正常返回并退出至桌面。
- 截图证据：[API 29 库存 WebView 74 原生升级提示](assets/android-phase0-api29-webview74-guard.png)。
- 重新安装 `WebViewGoogle-133.apk`（`133.0.6943.137`）后启动应用，正常进入 RunNote。

### 2) API 29 + WebView 133 完整功能验收（隔离 HTTP 环回）

在隔离 PostGIS 测试库 `android_phase0_test`、合成站主账号、`APP_ENV=test` 真实 FastAPI 与生产构建 Node SSR（`http://localhost:15297`）下，使用 `adb -s emulator-5568` 与 WebView CDP 实测：

| 检查项 | 证据与状态 |
| --- | --- |
| 安装与启动 | `adb -s emulator-5568 install -r` 与 `am start` 成功，`window.Capacitor.isNativePlatform() === true`，`window.Capacitor.Plugins.App` 可用，UA 报告 `Chrome/133.0.6943.137`。 |
| 登录、Cookie、CSRF、Origin | `/admin` 表单经 `/api/v1/auth/csrf`（200）→ `/api/v1/auth/login`（200）完成登录；`/api/v1/auth/session` 返回 200；`document.cookie` 为空（HttpOnly 不可读）；无 CSRF 退出返回 403；切后台（触发 `onPause` `CookieManager.flush()`）后 `am force-stop` 再重启，`/api/v1/auth/session` 仍为 200。 |
| 私有 API 读取 | 仪表盘汇总（`/api/v1/statistics/summary`）、活动列表（`/api/v1/activities`）、活动详情与路线 API 均返回 200。 |
| 文件选择器 MIME（GPX / TCX / Mi Fitness） | 向 `/sdcard/Download/` 推送标准扩展名合成文件（系统识别为 `BIN file` / `application/octet-stream` 与 `JSON document`）：<br>- `p0_rerun_track.gpx`：DocumentsUI 中 `enabled=true`，选中提交 `POST /api/v1/gpx-imports` 返回 **201**；<br>- `p0_rerun_track.tcx`：DocumentsUI 中 `enabled=true`，选中提交 `POST /api/v1/tcx-imports` 返回 **201**；<br>- Mi Fitness `p0_mifit_summaries.json` + 匹配 `running_*.gpx`：DocumentsUI 中均 `enabled=true`，预览 `POST /api/v1/mifitness-imports?preview=true` 返回 **200**，导入 `POST /api/v1/mifitness-imports` 返回 **201**。<br>[DocumentsUI 启用状态截图](assets/android-phase0-api29-documentsui-gpx.png)。 |
| MapLibre 地图与拖动 | 活动详情页渲染 `[data-testid="route-map-ready"]` Canvas，真实触摸滑动（`adb shell input swipe`）前后截图像素变化，起终点与轨迹正常平移。[地图详情截图](assets/android-phase0-api29-map-detail.png)。 |
| 系统 Back（全路径） | 1) 打开移动端导航抽屉 → Back 关闭抽屉并留在当前页；<br>2) 详情页打开底图选择器 Popover → Back 关闭 Popover 并留在详情页；<br>3) 详情页打开删除确认 `<dialog>` → Back 关闭弹窗并留在详情页；<br>4) 详情页 `/activities/<id>` → Back 返回 `/activities`（不退回桌面）；<br>5) 列表页 `/activities` → Back 返回 `/`（无双导航）；<br>6) 根页无可返回历史 → Back 正常退出至 `NexusLauncherActivity`。 |
| 视口与 WebView 日志 | CSS 视口 `393 × 751`，`scrollWidth === innerWidth`（无横向溢出）；全程 CDP `console_errors = []`、`exceptions = []`。 |

### 3) 隔离本地 HTTPS / `__Host-` Cookie 验证

在不修改生产、不部署、不提交任何证书或密钥的前提下，于仓库外生成临时测试 CA 与 `localhost` SAN 证书，仅在本次验证期间通过 debug 构建的 `<debug-overrides>` 信任该临时 CA，启动隔离后端（`APP_ENV=production`、`SITE_ORIGIN=https://localhost:15443`、内存临时 `AUTH_RATE_HASH_KEY`）、隔离 Node SSR（`ORIGIN=https://localhost:15443`）与本地 TLS 代理，经 `adb -s emulator-5568 reverse tcp:15443 tcp:15443` 在 API 29 + WebView 133 实测：

- WebView 完成严格 X.509 校验加载 `https://localhost:15443`，`window.isSecureContext === true`。
- `/api/v1/auth/csrf` 与 `/api/v1/auth/login`（`Origin: https://localhost:15443`）返回 200，响应 `Set-Cookie` 确认为 `__Host-run_session=<REDACTED>; HttpOnly; Max-Age=604800; Path=/; SameSite=lax; Secure`。
- `document.cookie` 读取不到 `__Host-run_session`；无 CSRF 退出请求返回 403；切后台 + `am force-stop` 重启后 `/api/v1/auth/session` 保持 200；携带合法 CSRF 退出返回 200，随后 `/api/v1/auth/session` 返回 401。
- 验证结束后已移除临时调试 CA 资源并恢复默认配置与标准调试 APK。
- **缺口与风险**：本地环回 TLS 仅验证了 Android WebView 对 `__Host-` + `Secure` Cookie、HTTPS `Origin` 与 CSRF 的协议兼容性，**不能替代公网可信 CA（Let's Encrypt/Caddy）的真实 staging/生产域名验证**（需在后续验证真实证书链、HSTS、TLS 1.3 协商、第三方底图混合内容与外链跳出行为）。

### 4) 未完成项与剩余 Gate

- **真机未验证**：本机无已连接的 Android 真机手机（已跳过仅有的 USB 5G 随身 Wi-Fi `MU300/F50`），因此真机 WebView 升级、系统手势返回、刘海/折叠屏安全区、系统深色自动跟随、真机 GPU 地图帧率与云盘文件提供者均未验证。
- **公网可信 HTTPS 域名未验证**：见第 3 节。

### 5) Web / 后端 / CI 回归验证

- `python3 scripts/verify.py`（进程环境注入隔离 `DATABASE_URL`）：**8/8 PASS**
  - `contract`: OpenAPI → TypeScript 契约一致
  - `backend`: `ruff check` 通过、`ruff format --check`（301 files）通过、`pytest tests/unit -q` **629 passed**
  - `frontend`: `pnpm test` **66 files / 421 passed**（含新增 `capacitor-back.test.ts` 7 项）、`pnpm check` **0 errors, 0 warnings**
  - `infra`: `unittest discover -s infra/native/tests` **139 tests OK**、`shellcheck` 通过
- 前端额外专项校验：
  - `pnpm lint:style` 通过；`pnpm format:check` 校验本次新增/修改文件全部通过；`pnpm build` 完成 adapter-node 生产构建。
  - 真实后端 Playwright E2E（隔离测试库 `android_phase0_ci_test`）：`pnpm test:e2e tests/e2e/auth.spec.ts tests/e2e/gpx-origin.spec.ts tests/e2e/mifitness-import.spec.ts --reporter=list` **7/7 passed**。
- 本机未运行项（由 PR #135 GitHub CI 全量覆盖）：后端完整集成测试（CI `backend` job）、前端全量合成 UI Playwright（CI `frontend-ui` job）、原生发布/回滚/异地备份/Caddy 演练（CI `infra` job）。
- 历史登录页脱敏截图保留：[初始登录页截图](assets/android-phase0-api29-sign-in.png)。
