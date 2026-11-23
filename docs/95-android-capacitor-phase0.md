# Android Phase 0 Capacitor 技术验证

范围为 #131，依据 #130。初次验证基线为 `15ae3b81bcf769f96cc835306a3bfb8c06e8e038`（PR #135 初始 head `dffa5f71949f30206daff3885484d780bef0a41c`）；随后补齐 WebView 最低版本与升级防护、系统 Back、文件选择器 MIME 与本地隔离 HTTPS 验证（`daf985cb63254a729842d279389c5112c35717ed`），并最终在真实 Android 手机与公网可信 CA + HSTS 的 staging HTTPS 环境完成全部剩余门禁验证。本次改动严格限定在 Phase 0 范围（`android/`、极小前端客户端 Back 桥接及 `MifitnessImport` `accept` 对齐、验证文档与脱敏截图），不改 Web SSR 架构、不进入 Phase 1–3、不合并、不部署、不执行生产迁移。

## 阶段结论

**GO（Phase 0 全部技术验证门禁已关闭；PR #135 保持 draft，待对最新提交复审并由负责人拍板后进入 Phase 1）**。

所有审查条件与原剩余门禁均已闭环：
1. **WebView 最低版本与升级路径（>= 116）**：明确 API 29 库存 WebView 74 无法水合的根因与最低要求（**Android System WebView / Chrome 116+**）；`MainActivity` 启动前原生检测并在库存 WebView `74.0.3729.185` 实测展示原生中文升级页（无白屏/JS 报错）；更新至 API 29 WebView `133.0.6943.137` 与真机 WebView `144.0.7559.132` 均正常进入应用。
2. **系统 Back 与手势导航**：接入 `@capacitor/app@8.1.2` 与前端 `capacitor-back.ts`，并在真机联调 staging（尚未部署 `capacitor-back.ts` 的 2.0.1 Web）时发现并修复了真实阻塞——`@capacitor/app` 在无 JS `backButton` 监听且 `!canGoBack()` 时会吞掉返回键导致无法退出。已在 `MainActivity` 增加原生 `OnBackPressedCallback` 兜底（当 JS 桥接完成注册后完全委托给 `capacitor-back.ts`，并修复异步注册竞态；未注册/旧版服务端/离线页由原生关闭弹层、执行 `webView.goBack()` 或 `finish()`）。在 API 29 模拟器与 Android 17 真机（含左侧边缘滑动手势）均验证了抽屉、Popover、`<dialog>`、详情 → 列表 → 首页回退及无历史退出，无双导航或卡死。
3. **文件选择器 MIME**：通过 `RunNoteWebChromeClient` + `FilePickerIntentHelper` 修复 Android `MimeTypeMap` 缺失 `.gpx`/`.tcx` 映射导致 DocumentsUI 禁用默认 MIME（`application/octet-stream`）文件的问题；在 API 29 模拟器与 Android 17 真机均通过真实 DocumentsUI 选中默认 MIME 的 `.gpx`、`.tcx` 及 Mi Fitness `.json` + 匹配 `.gpx`，全部返回 HTTP **201**。
4. **公网可信 CA HTTPS / HSTS 与 `__Host-` Cookie**：已在真机对接公网可信 CA + `Strict-Transport-Security: max-age=31536000` + HTTP/2 的 staging HTTPS 环境（以及本地隔离 TLS `APP_ENV=production` 环境）完整验证登录、`__Host-run_session`（`HttpOnly; Secure; SameSite=lax; Path=/`）、`document.cookie` 不可见、无 CSRF 退出 403、后台强杀重启会话保持（`CookieManager.flush()`）与正常退出注销（200 → 401）。未修改生产、未部署、未跑生产迁移，仓库不提交任何 staging 域名配置。
5. **真机验证**：已在真实设备（PKT110，Android 17 / SDK 37，WebView `144.0.7559.132`，GPU `Mali-G925-Immortalis MC12`）完成全链路验收，验证了公网 HTTPS/HSTS、安全区（状态栏/挖孔与手势条均无遮挡）、硬件 WebGL 2.0 MapLibre 渲染与拖动、浅/深色切换、DocumentsUI 文件导入与边缘手势返回，全程 0 控制台错误、0 未捕获异常。

**非阻塞的 Phase 1 后续关注项（不阻塞 Phase 0 结论）**：
- **手动深色模式的状态栏图标同步**：真机浅色系统下手动点击 Web 深色切换按钮时，Web 内容正常切换为深色，系统状态栏背景保持浅色；Phase 1 可在主题切换时桥接 Capacitor `SystemBars.setStyle()` 同步状态栏外观。
- **第三方云盘实测**：真机 DocumentsUI 已确认可见本地存储、Downloads、Documents 及已安装的第三方 SAF 文档提供者，但未登录第三方云盘账号执行云端文件拉取，可在 Phase 1 补测大文件与云盘提供者。
- **华为独立 WebView 内核映射**：若后续覆盖 EMUI/HarmonyOS 设备，需单独核对 `com.huawei.webview` 版本号与 Chromium 116 特性映射。
- **正式发布容器策略**：Play 最低功能政策、断网错误壳、导航白名单与外链处理归属 Phase 1 设计。

## 最低系统与 WebView 要求

| 维度 | 要求 | 技术依据 |
| --- | --- | --- |
| 最低 Android API | **API 29（Android 10）** | 维持既有基线（`minSdkVersion = 29`），支持独立更新 System WebView 与现代 SAF DocumentsUI。 |
| 最低 WebView / Chrome | **116+**（`minWebViewVersion = 116`） | 1) Vite 8 默认 `build.target = "baseline-widely-available"` 对应 `chrome111`（保留 ES2020 `?.`、`??` 等现代语法，库存 API 29 的 WebView 74 在加载入口 chunk 时直接抛 `SyntaxError: Unexpected token ?`，阻断 SvelteKit 水合）；2) Tailwind CSS v4 与 `color-mix()` 需 Chrome/WebView 111+；3) 原生 Popover API（`AnchoredPanel`/`BasemapPicker`/`DatePicker`/`TimePicker`）需 114+；4) 前端在 `running-diary.ts`、`ActivityPosterDialog.svelte`、`RoutePosterDialog.svelte` 中直接调用 `AbortSignal.any()`，需 **Chrome/WebView 116+**。 |
| 过旧 WebView 降级策略 | **启动前原生拦截 + 升级引导页** | `MainActivity.load()` 在初始化 Capacitor `Bridge` 之前调用 `WebViewCompat.getCurrentWebViewPackage()`，若版本 `< 116` 或组件缺失，不加载远端 SSR URL，直接展示零 WebView 依赖的原生布局 `activity_webview_upgrade.xml`：显示当前包名/版本号与最低要求，提供「前往更新 WebView」（`market://details?id=<pkg>` → HTTPS Play 链接 → 系统应用详情降级）、「打开 WebView 应用信息」及「重新检测」按钮，避免静默白屏或 `ActivityNotFoundException` 崩溃。 |

## 加载与认证

| 方式 | 结果与影响 |
| --- | --- |
| `server.url` | 单一服务器来源让页面、Node SSR、相对 `/api` 代理及浏览器 Cookie 处于同一源。可独立更新部署的 Web，离线启动依赖后续设计。Capacitor 的 `server.url` 是开发用配置，若用于 Phase 1 发布，需先确认正式容器加载方案、导航白名单及桥接信任边界。 |
| 打包前端静态资源 | `pnpm build` 的 `build/client` 顶层只有 favicon 和 `_app`，没有 `index.html`。会话、路由保护、站点上下文和 `/api` 代理依赖 Node 端。直接打包无法运行现有入口。独立移动 SPA 可提供离线启动壳，需要原生包或受控静态资源更新机制，以及独立的 API/认证设计。 |

**Cookie 与生命周期补充发现**：Chromium Android WebView 默认将新写入的 Cookie 暂存在内存并异步落盘，若登录后立即被系统强杀（`am force-stop`），可能出现会话丢失。已在 `MainActivity.onPause()` 增加 `CookieManager.getInstance().flush()`，在模拟器与真机均确认切后台强杀再启动后会话稳定保持 200。

建议 Phase 1 保留现有同源 Cookie Session、CSRF 与 Origin 校验（`HttpOnly`、`Secure`、`SameSite=Lax`、`__Host-run_session`），不伪造 `Origin`、不把主机会话暴露给 JS、不扩大 SSR 代理头白名单。

## 插件与下一步

| 能力 | 待验证与建议 |
| --- | --- |
| Health Connect | Phase 2 优先评估支持 Capacitor 8 的桥接或 Jetpack Health Connect 小型插件。Android 10–13 有独立 provider 安装情形，Android 14+ 使用系统模块。验证可用性与权限撤回，按最少权限读取运动会话和经用户同意的路线，处理分页、来源和去重。 |
| HealthKit | iOS 适配阶段评估维护中的插件或 Swift 桥接。明确 HealthKit entitlement、用途说明、授权和数据读范围，验证 `HKWorkout` / `HKWorkoutRoute`、锚点和来源去重。 |
| 后台 GPS | Phase 3 评估支持持续定位、前台服务通知和持久状态的插件或原生桥接。验证锁屏、暂停恢复、权限变化及进程终止。在 Android 和 iOS 真机分别验证。 |
| 文件选择 | Phase 0 已在 Android 端覆写 `BridgeWebChromeClient`（`RunNoteWebChromeClient`）解决 `.gpx`/`.tcx`/`.json` 在 DocumentsUI 被禁用的问题，并在 API 29 模拟器与 Android 17 真机验证 Downloads 下的 GPX、TCX、Mi Fitness 导入。Phase 1 补充云盘提供者与大文件场景。 |
| 安全存储 | 当前架构让 WebView 管理 HttpOnly Cookie。若未来有原生凭据需求，评估维护中的 Keystore/Keychain 插件或专用桥接，覆盖退出、备份、设备恢复及吊销。 |
| 认证与来源 | 已在真机公网可信 CA + HSTS 的 staging HTTPS 环境与本地隔离 HTTPS 验证 `__Host-run_session`、同源 SSR、CSRF 与重启持久化。跨来源或原生认证若未来引入仍需独立安全评审。 |

参考 [Capacitor 配置](https://capacitorjs.com/docs/config)、[SvelteKit adapter-static](https://svelte.dev/docs/kit/adapter-static)、[Google Play 功能和体验政策](https://support.google.com/googleplay/android-developer/answer/9899034)、[Android Health Connect](https://developer.android.com/health-and-fitness/health-connect)、[Apple HealthKit](https://developer.apple.com/documentation/healthkit)。

## 验证记录

### 1) 真机 + 公网可信 CA staging HTTPS 验收（关闭剩余门禁）

- **设备**：真实 Android 手机 `PKT110`（Android 17 / SDK 37，物理分辨率 `1216 × 2640` @ `560 dpi`，DPR `3.5`），系统 WebView `com.google.android.webview` **`144.0.7559.132`**（`versionCode: 755913203`），GPU `Mali-G925-Immortalis MC12`（WebGL 2.0）。
- **目标环境**：公网可信 CA + HSTS（`strict-transport-security: max-age=31536000`）+ HTTP/2 的 staging HTTPS 实例（版本 2.0.1，schema 0034；临时本地切换 `server.url` 构建安装调试包后立即恢复，仓库未保留 staging 域名配置，未触碰生产）。
- **临时 staging 调试 APK SHA-256**：`50584cf46657249551149e59dac75aa3716a606c8d098c3439d66387b8eeb616`（未提交 APK 或 keystore）。

| 检查项 | 真机实测证据与状态 |
| --- | --- |
| 公网 HTTPS / TLS / HSTS & WebView 144 | 首次启动直接通过公网可信 CA 校验加载 `https:`（HTTP/2、`strict-transport-security: max-age=31536000`、`window.isSecureContext === true`），`window.Capacitor.isNativePlatform() === true`、`Plugins.App` 可用；WebView `144.0.7559.132 >= 116` 未触发升级拦截页。 |
| 登录、CSRF、`__Host-run_session`、重启与退出 | 使用独立 staging 测试账号登录成功并跳转 `/workspace/dashboard`；CDP 捕获 `Set-Cookie: __Host-run_session=<REDACTED>; HttpOnly; Max-Age=604800; Path=/; SameSite=lax; Secure`；`document.cookie` 为空；无 CSRF `POST /api/v1/auth/logout` 返回 403；切后台（触发 `CookieManager.flush()`）后 `am force-stop` 再启动，`/api/v1/auth/session` 仍为 200；携带合法 CSRF 退出返回 200（`Max-Age=0`）且后续 `/api/v1/auth/session` 返回 401。 |
| 私有 API、MapLibre、GPU 与安全区 | `/api/v1/statistics/summary`、`/api/v1/activities`（含已有记录与新导入记录）、活动详情与路线 API 均返回 200；`[data-testid="route-map-ready"]` 依托 `Mali-G925-Immortalis MC12`（WebGL 2.0）正常渲染，触摸滑动前后画面变化；Android 17 边到边环境下 WebView bounds 为 `[0, 135][1216, 2584]`，CSS 视口 `347 × 699`，`scrollWidth === innerWidth`，顶部挖孔/状态栏与底部手势条均未遮挡内容。 |
| 默认 MIME 文件导入（真实 DocumentsUI） | 通过 Android 17 DocumentsUI 从本地 `Download` 目录选择默认 MIME 合成文件，全部呈启用态并导入成功：<br>- `p0_real_track.gpx` → `POST /api/v1/gpx-imports` **201**；<br>- `p0_real_track.tcx` → `POST /api/v1/tcx-imports` **201**；<br>- Mi Fitness `p0_real_mifit.json` + 匹配 `running_*.gpx` → 预览 **200**、`POST /api/v1/mifitness-imports` **201**。<br>验证后已清理本次新增的 3 条合成活动及手机临时目录，原账号已有记录保持不变。 |
| Back / 边缘手势、深色模式与文档提供者 | 1) 真实左侧边缘滑动手势关闭移动端导航抽屉；<br>2) Back 关闭底图选择器 Popover；<br>3) Back 关闭删除确认 `<dialog>` 并留在详情页；<br>4) 左侧边缘滑动手势由 `/workspace/activities/<id>` 返回 `/workspace/activities`，再按 Back 返回 `/workspace/dashboard`；<br>5) 根页无剩余历史时 Back 正常退出至桌面（修复了此前对 2.0.1 无 JS 监听器页面会吞掉 Back 导致无法退出的问题）；<br>6) Web 深色切换正常（`data-theme="dark"`、`scrollWidth === innerWidth`），浅/深色脱敏截图见 [真机浅色地图](assets/android-phase0-real-map-light.png)、[真机深色地图](assets/android-phase0-real-map-dark.png)；<br>7) DocumentsUI 根目录列出本地存储、Downloads、Documents、媒体目录及系统/第三方 SAF 文档提供者（未登录外部云盘账号）。 |
| WebView 控制台与异常 | 全程 CDP `console_errors = []`、`exceptions = []`。 |

### 2) API 29 模拟器验收（库存 WebView 74 防护 + WebView 133 + 本地隔离 HTTPS）

- **环境**：Google SDK cmdline-tools、Emulator 37.3.10.0、API 29 Google APIs x86_64 r13、Platform Tools 37.0.3、Temurin JDK 21.0.13.1、隔离 PostGIS 测试库 `android_phase0_test`（head `0033_ai_assistant`）。
- **库存 WebView 74 防护实测**：卸载 WebView 更新确认回退至 `74.0.3729.185` 后启动，`logcat` 记录 `W RunNoteWebView: Unsupported system WebView: package=com.google.android.webview, version=74.0.3729.185, required>=116`，未加载远端 SSR，无 `SyntaxError`；展示原生中文升级页（[WebView 74 升级提示截图](assets/android-phase0-api29-webview74-guard.png)），「重新检测」「打开 WebView 应用信息」与 Back 退出均正常；重装 `WebViewGoogle-133.apk`（`133.0.6943.137`）后正常进入应用。
- **WebView 133 全流程（隔离 HTTP 环回 `http://localhost:15297`）**：登录/HttpOnly Cookie/CSRF（无 CSRF 403）/重启持久化（200）、私有 API、DocumentsUI 默认 MIME 的 `.gpx`（201）、`.tcx`（201）、Mi Fitness `.json` + `.gpx`（预览 200 / 导入 201，[DocumentsUI 截图](assets/android-phase0-api29-documentsui-gpx.png)）、MapLibre 渲染与拖动（[模拟器地图截图](assets/android-phase0-api29-map-detail.png)）、Back（抽屉/Popover/弹窗/详情 → 列表 → 首页/根页退出）全部通过，0 控制台错误、0 异常。
- **本地隔离 HTTPS（`APP_ENV=production` + `https://localhost:15443`）**：临时 debug CA 下验证 `__Host-run_session`（`HttpOnly; Secure; SameSite=lax; Path=/`）、`isSecureContext`、CSRF、重启持久化与退出注销（200 → 401），测后已清理临时 CA 资源。

### 3) Android 原生构建、Web / 后端 / CI 回归验证

- **Android 标准调试构建（默认 `http://localhost:15297`）**：
  - `pnpm --dir android install --frozen-lockfile`、`pnpm --dir android sync`、`(cd android/native && ./gradlew --no-daemon testDebugUnitTest assembleDebug)`：**PASS**（JUnit 8/8 通过：`WebViewSupportTest` 4/4、`FilePickerIntentHelperTest` 4/4）。
  - 标准调试 APK SHA-256：`7f68fb8cb8e1f1934cf0937d9b35b47301537ee451a05283286ffdf1ed948955`（APK/keystore 不入库）。
- **Web / 后端 / 运维统一检查**：
  - `python3 scripts/verify.py`（进程环境注入隔离 `DATABASE_URL`）：**8/8 PASS**（contract、ruff check/format、backend unit 629 passed、frontend vitest 66 files / 421 passed、svelte-check 0 errors / 0 warnings、infra ops unit 139 OK、shellcheck）。
  - `cd frontend && pnpm lint:style && pnpm build`：**PASS**；`pnpm format:check` 校验新增与改动前端文件通过。
  - 真实后端 Playwright E2E（隔离测试库 `android_phase0_ci_test`）：`auth.spec.ts`、`gpx-origin.spec.ts`、`mifitness-import.spec.ts` **7/7 passed**。
  - 历史登录页脱敏截图保留：[初始登录页截图](assets/android-phase0-api29-sign-in.png)。
