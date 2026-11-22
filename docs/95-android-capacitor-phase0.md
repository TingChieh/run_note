# Android Phase 0 Capacitor 技术验证

范围为 #131，依据 #130。基线为 `15ae3b81bcf769f96cc835306a3bfb8c06e8e038`。本次改动限于独立的 Android 工程与验证记录。

## 阶段结论

**NO-GO（按当前验收条件）**。调试 APK 能在 API 29 安装并打开 Node SSR 页面。官方 Google APIs x86_64 镜像内的 WebView 74 无法解析现有 Web 生产包，路由未能水合。Phase 1 需要明确最低 WebView 支持策略，并在更新过 WebView 的 API 29 模拟器及实际设备上补齐关键流程。真机验证待设备所有者安排。

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

## 验证记录

### Android

- 使用 Google SDK cmdline-tools、Emulator、API 29 Google APIs x86_64 r13 系统镜像、Platform Tools 和 Temurin JDK 21。SDK 与测试实例位于仓库外。
- `emulator -accel-check` 输出 `KVM (version 12) is installed and usable`。首次使用 `-gpu swiftshader_indirect` 退出 139。用 `-gpu software -feature -Vulkan -cores 2 -memory 1536 -accel on` 启动后，`sys.boot_completed=1`、`ro.build.version.sdk=29`。
- `./gradlew --no-daemon assembleDebug` 成功。使用 `adb -s emulator-5568 install -r` 安装并用 `am start` 启动。复现命令见 [Android README](../android/README.md)。
- Node 生产构建的 `/admin` 和代理 `/api/v1/health/ready` 均返回 200。WebView 加载 SSR 后记录 `Uncaught (in promise) SyntaxError: Unexpected token ?`。Chromium 为 74.0.3729.185。API 29 交互、地图、导入和真机检查尚未通过。

### Web

- `pnpm install --frozen-lockfile` 成功。统一验证入口的 `pnpm test` 通过 65 个文件、414 个测试，`pnpm check` 报 0 错误、0 警告，`pnpm build` 完成 adapter-node 构建。
