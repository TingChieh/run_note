# Android Phase 0 Capacitor 技术验证

范围为 #131，依据 #130。基线为 `15ae3b81bcf769f96cc835306a3bfb8c06e8e038`。本次改动限于独立的 Android 工程与验证记录。

## 阶段结论

**NO-GO（按当前验收条件）**。API 29 更新到 WebView 133 后，登录、私有数据读取、MapLibre 和一次 GPX 导入走通。原始 WebView 74 无法水合，普通下载文件的 `.gpx` MIME 仍受选择器限制，活动详情的系统返回键会退出应用。Phase 1 启动前需确认最低 WebView 与升级策略、补齐返回键和真实文件提供者行为，并在可信 HTTPS 和真机上验证。真机验证待设备所有者安排。

## 加载与认证

| 方式 | 结果与影响 |
| --- | --- |
| `server.url` | 单一服务器来源让页面、Node SSR、相对 `/api` 代理及浏览器 Cookie 处于同一源。可独立更新部署的 Web，离线启动依赖后续设计。Capacitor 的 `server.url` 是开发用配置，若用于 Phase 1 发布，需先确认正式容器加载方案及桥接信任边界。 |
| 打包前端静态资源 | `pnpm build` 的 `build/client` 顶层只有 favicon 和 `_app`，没有 `index.html`。会话、路由保护、站点上下文和 `/api` 代理依赖 Node 端。直接打包无法运行现有入口。独立移动 SPA 可提供离线启动壳，需要原生包或受控静态资源更新机制，以及独立的 API/认证设计。 |

建议 Phase 1 先在受控 HTTPS 来源验证现有同源 Cookie Session、CSRF 与 Origin，保留 `HttpOnly`、`Secure`、`SameSite=Lax` 与 `__Host-` Cookie。上线方案需要明确可桥接的 HTTPS 来源、外链与重定向行为、更新兼容性和断网恢复。若切换到打包资源，其 `https://localhost` 与后端站点分属不同源，必须单独评审会话凭据、跨源 Cookie/CORS 和 CSRF；不要伪造 Origin、把主机会话暴露给 JS 或扩大 SSR 代理头白名单。

Google Play 的最低功能和稳定性规则会影响依赖网络的容器。发布前应验证首次启动、断网恢复、可操作的错误状态及独立移动使用价值，并核对目标 API、隐私与权限声明。首发签名 APK 的内部验证和 Play 审核属于不同里程碑。

## 插件与下一步

| 能力 | 待验证与建议 |
| --- | --- |
| Health Connect | Phase 2 优先评估支持 Capacitor 8 的桥接或 Jetpack Health Connect 小型插件。Android 10–13 有独立 provider 安装情形，Android 14+ 使用系统模块。验证可用性与权限撤回，按最少权限读取运动会话和经用户同意的路线，处理分页、来源和去重。 |
| HealthKit | iOS 适配阶段评估维护中的插件或 Swift 桥接。明确 HealthKit entitlement、用途说明、授权和数据读范围，验证 `HKWorkout` / `HKWorkoutRoute`、锚点和来源去重。 |
| 后台 GPS | Phase 3 评估支持持续定位、前台服务通知和持久状态的插件或原生桥接。验证锁屏、暂停恢复、权限变化及进程终止。在 Android 和 iOS 真机分别验证。 |
| 文件选择 | 首先验证 Capacitor WebChromeClient 的 HTML 文件输入映射。后续验证本机与云文档提供者的 MIME、文件大小、多选及取消。若需要原生插件，Android 用 SAF 的 `ACTION_OPEN_DOCUMENT`/content URI，iOS 用 `UIDocumentPicker`，继续沿用服务端校验。 |
| 安全存储 | 当前架构让 WebView 管理 HttpOnly Cookie。若未来有原生凭据需求，评估维护中的 Keystore/Keychain 插件或专用桥接，覆盖退出、备份、设备恢复及吊销。 |
| 认证与来源 | 在生产 HTTPS 等效环境验证 Cookie 属性、同源 SSR 与 CSRF、持久会话和导航白名单。跨来源或原生认证需要独立安全评审。 |

参考 [Capacitor 配置](https://capacitorjs.com/docs/config)、[SvelteKit adapter-static](https://svelte.dev/docs/kit/adapter-static)、[Google Play 功能和体验政策](https://support.google.com/googleplay/android-developer/answer/9899034)、[Android Health Connect](https://developer.android.com/health-and-fitness/health-connect)、[Apple HealthKit](https://developer.apple.com/documentation/healthkit)。

## 验证记录

### Android

- 使用 Google SDK cmdline-tools（归档 15859902）、Emulator 37.3.10.0、API 29 Google APIs x86_64 r13 系统镜像、Platform Tools 37.0.3 和 Temurin 21.0.13.1。SDK 与测试实例位于仓库外。
- `emulator -accel-check` 输出 `KVM (version 12) is installed and usable`。首次使用 `-gpu swiftshader_indirect` 退出 139。用 `-gpu software -feature -Vulkan -cores 2 -memory 1536 -accel on` 启动后，`sys.boot_completed=1`、`ro.build.version.sdk=29`。
- `pnpm --dir android install --frozen-lockfile`、`pnpm --dir android sync`、`(cd android/native && ./gradlew --no-daemon assembleDebug)` 成功，最终构建 93 个任务成功。使用 `adb -s emulator-5568 install -r` 安装并用 `am start` 启动。APK 为 `android/native/app/build/outputs/apk/debug/app-debug.apk`，SHA-256 为 `6f3b2f70d0395ce4fd6d9de47b06f577cb88d1a6d9aee4a2ee579535b82a9c2a`。复现命令见 [Android README](../android/README.md)。
- Node 生产构建的 `/admin` 和代理 `/api/v1/health/ready` 均返回 200。WebView 74.0.3729.185 加载 SSR 后记录 `Uncaught (in promise) SyntaxError: Unexpected token ?`。
- 从官方 API 36 Google APIs x86_64 r7 镜像中通过 `adb shell pm path com.google.android.webview` 定位并拉取 WebView APK，同时拉取 `/product/app/TrichromeLibrary/TrichromeLibrary.apk.gz`。将库解压后通过 `adb -s emulator-5568 install` 安装，再用 `adb -s emulator-5568 install -r` 更新 WebView。未改签名或绕过安装校验。API 29 的 `dumpsys webviewupdate` 与 WebView CDP 均报告 133.0.6943.137。这是模拟器复现实验，正式设备的升级渠道需单独验证。

在隔离 PostGIS 测试库和专用合成站主上，用 API 29、WebView 133、Node 生产 SSR 和 `APP_ENV=test` 的真实 FastAPI 执行：

| 检查 | 证据与状态 |
| --- | --- |
| 登录、Cookie、CSRF 与 Origin | 登录表单先取 CSRF，登录 200，`/api/v1/auth/session` 200；Cookie 为 HttpOnly、Lax，Web JS 读取不到，强制停止并重启应用后会话仍在。无 CSRF 退出请求返回 403，正常退出请求返回 200。默认源为 `http://localhost:15297`，生产 HTTPS 的 `__Host-` Secure Cookie 未验。 |
| 会话过期 | 使用现有 `tests.e2e_accounts expire-session` 仅过期该隔离会话。`/api/v1/auth/session` 从 200 变为 401，重访私有仪表盘进入登录页。 |
| 数据读取 | 真实仪表盘汇总、活动列表、私有详情和该详情的路线 API 均返回 200。 |
| GPX | Android DocumentsUI 打开后按 Back 取消，文件输入为空。Downloads 中默认 MIME 的 `.gpx` 文件呈禁用。通过 DocumentsUI 选择 XML 类型的合成 GPX 内容，错误样本返回 400 并显示错误，有效样本返回 201，创建活动并提供详情链接。未测 TCX / MiFitness、云盘提供者或原扩展名上传。 |
| 地图 | GPX 成功页进入详情后渲染 `route-map-ready` Canvas，触摸拖动前后画面变化。外部底图独立可用性、双指缩放和真机 GPU 性能待验。 |
| Back | 选择器中可取消。活动详情按系统 Back 时返回 Android 启动器，没有回到活动列表。Phase 1 评估 `@capacitor/app` 的默认 Back 处理，以及应用历史、弹层和根页退出语义。 |
| 深色及安全区 | Web 的深色按钮生效，CSS 视口为 393 × 751，无横向溢出。1080 × 2280 模拟屏上的 WebView bounds 为 `[0,83][1080,2148]`。截图显示默认竖屏的状态栏和三键区未遮挡 WebView。系统夜间命令仍返回 `Night mode: no`，系统自动外观、旋转、刘海和手势栏待验。 |
| WebView 日志 | 74 的生产 JS 语法错误如上。133 的 CDP 业务验证未捕获未处理 JS 异常。未执行长时间 logcat/性能检查。 |

脱敏截图只展示合成会话过期后空白的登录表单。[查看截图](assets/android-phase0-api29-sign-in.png)。

### Web

- `pnpm install --frozen-lockfile` 成功。统一验证入口的 `pnpm test` 通过 65 个文件、414 个测试，`pnpm check` 报 0 错误、0 警告，`pnpm build` 完成 adapter-node 构建。
- 后端的 `.venv/bin/ruff check app migrations tests` 和 `.venv/bin/ruff format --check app migrations tests` 通过。用进程环境提供独立候选库及允许目标后，`.venv/bin/pytest -q -rs` 本地通过 1080 项，1 项快照迁移测试因未配置 `TEST_SNAPSHOT_DATABASE_URL` 跳过。
