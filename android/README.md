# RunNote Android（Phase 1–3 Companion）

RunNote 的 Android Capacitor 容器工程（#132、#133、#134），直接复用同一套 RunNote Web UI，不改 Web SSR 架构、不引入独立页面 fork。

- **应用标识**：`com.tingchieh.runnote`（应用名 `RunNote`）
- **版本**：与 `backend/pyproject.toml` / `frontend/package.json` 同步为 `2.5.0`（`versionCode = 20500`，规则 `MAJOR * 10000 + MINOR * 100 + PATCH`）
- **最低系统要求**：Android 10（API 29）、Android System WebView / Chrome **116+**
- **工具链**：Capacitor 8.6.2、`@capacitor/app` 8.1.2、`androidx.health.connect:connect-client` 1.1.0、Kotlin 2.1.21、JDK 21、Gradle 8.14.3、AGP 8.13.0、Android SDK 36、Build Tools 35.0.0

## 1. Debug 构建（本地隔离联调）

默认 `debug` 构建指向 `http://localhost:15297`（仓库不硬编码 staging 或生产域名），并可通过 `-Prunnote.serverUrl` 或 `RUNNOTE_SERVER_URL` 在构建时注入任意合法 HTTPS 来源（非环回地址强制 HTTPS）：

```sh
pnpm --dir android install --frozen-lockfile
pnpm --dir android sync
(cd android/native && ./gradlew --no-daemon testDebugUnitTest assembleDebug)
```

调试 APK 输出：`android/native/app/build/outputs/apk/debug/app-debug.apk`。

本地隔离联调示例（使用明确模拟器序列号）：

```sh
adb -s emulator-5554 reverse tcp:15297 tcp:15297
adb -s emulator-5554 install -r android/native/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5554 shell am start -n com.tingchieh.runnote/.MainActivity
```

## 2. Release 签名构建

**安全规则**：
- Keystore 与口令必须放在仓库之外（例如 `~/.local/share/runnote-android/keystore/`，权限 `0600`），**绝不提交到仓库**。
- Release 构建强制要求通过 `-Prunnote.serverUrl` 或 `RUNNOTE_SERVER_URL` 提供 `https://` 非环回服务地址；未配置服务地址或未配置签名凭证时 Gradle 直接拒绝构建。
- Release 不启用明文 HTTP，不信任用户 CA（见 `android/native/app/src/main/res/xml/network_security_config.xml`）。

通过环境变量注入示例：

```sh
pnpm --dir android install --frozen-lockfile
pnpm --dir android sync
(
  cd android/native && \
  RUNNOTE_SERVER_URL="https://your-runnote.example" \
  RUNNOTE_KEYSTORE_PATH="$HOME/.local/share/runnote-android/keystore/runnote-release.jks" \
  RUNNOTE_KEYSTORE_PASSWORD="<store-password>" \
  RUNNOTE_KEY_ALIAS="runnote" \
  RUNNOTE_KEY_PASSWORD="<key-password>" \
  ./gradlew --no-daemon assembleRelease
)
```

也可将签名项写入 Git 忽略的本地文件 `android/native/keystore.properties`（键名：`runnote.keystore.path`、`runnote.keystore.password`、`runnote.key.alias`、`runnote.key.password`）。

校验签名与指纹：

```sh
apksigner verify --verbose --print-certs android/native/app/build/outputs/apk/release/app-release.apk
sha256sum android/native/app/build/outputs/apk/release/app-release.apk
```

## 3. 容器能力与安全边界

- **WebView >= 116 原生拦截（`WebViewSupport`）**：启动前校验系统 WebView，过旧或缺失时展示零 WebView 依赖的原生中文升级页。
- **导航白名单与外链处理（`NavigationPolicy` + `RunNoteWebViewClient`）**：同源 `http(s)` 留在 WebView；外部 `http(s)` 通过 Chrome Custom Tab / 系统浏览器打开；`mailto:` 交系统处理；`javascript:`、`file://`、`content://`、`data:`、`blob:`、`intent://` 及未知 scheme 全部拦截拒绝。
- **系统栏深浅色同步（`SystemAppearancePlugin` + `SystemBarStyleHelper` + `frontend/src/lib/capacitor-theme.ts`）**：Web 手动切换浅/深色或跟随系统时，同步更新状态栏/手势条背景色（`#F6F7F4` / `#292725`）与图标对比度。
- **断网与连接错误覆盖层（`view_connection_error.xml`）**：主文档断网、超时或 TLS 校验失败（绝不忽略证书错误）时展示原生中文提示与「重新加载」/「返回上一页」入口，不覆盖服务端 403/404/500 页面。
- **返回键与边缘手势（`BackNavigationHelper` + `frontend/src/lib/capacitor-back.ts`）**：依次处理连接错误层、`<dialog>`、Popover、移动抽屉、单步历史回退与根页退出。
- **Health Connect 只读桥接（`HealthDataPlugin` + `HealthConnectPolicy` + `HealthPermissionsRationaleActivity`）**：
  - 仅声明 6 项最小化只读权限（`READ_STEPS`、`READ_DISTANCE`、`READ_ACTIVE_CALORIES_BURNED`、`READ_HEART_RATE`、`READ_RESTING_HEART_RATE`、`READ_SLEEP`），**零 `WRITE_*` 权限、零轨迹/后台读取权限**；
  - 前端统一通过 `frontend/src/lib/capacitor-health.ts` 访问平台无关的 `HealthData` 插件接口，后续 iOS 可无痛接入 Apple HealthKit；
  - 提供中文权限说明页（支持 Android 10–13 `ACTION_SHOW_PERMISSIONS_RATIONALE` 与 Android 14+ `VIEW_PERMISSION_USAGE`）。
- **离线缓存与增量同步（`frontend/src/lib/offline-cache.ts` + `companion-sync.ts`）**：
  - 使用按账号命名空间隔离的 IndexedDB 缓存数据汇总、活动列表/详情与足迹元数据（不缓存明文 Token、Cookie、原始 GPX/TCX、离线底图或私人身心健康日记）；
  - 通过 `GET /api/v1/activities/sync` 基于 `activity_data_version` + `updated_at` 游标分页增量同步、去重、断网重试与删除对齐；退出登录、401 或切换账号自动清空私有缓存。
- **实时运动记录与前台后台定位（`LocationRecorderPlugin` + `RecordingForegroundService` + `LocationRecordingPolicy` + `frontend/src/lib/capacitor-recorder.ts`）**：
  - 仅在用户主动开始记录期间启动 `foregroundServiceType="location"` 的前台服务并展示锁屏脱敏常驻通知（`VISIBILITY_PRIVATE` + `setPublicVersion`），支持锁屏、切后台、Doze 持续记录；遵循 Google Play 最小权限原则，**不声明 `ACCESS_BACKGROUND_LOCATION`**；
  - 仅申请 `ACCESS_FINE_LOCATION`、`ACCESS_COARSE_LOCATION`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_LOCATION`、`POST_NOTIFICATIONS`（API 33+）；严格要求精确位置（`ACCESS_FINE_LOCATION`），仅授大致位置时阻断开始并引导升级精确位置；妥善处理权限拒绝、通知拒绝、运行中降权与「仅本次允许」失效，系统定位重新开启后自动恢复订阅；
  - 每个有效 GPS 点即时写入应用私有目录（`files/recordings/`，原子 `Files.move` 元数据 JSON + 追加式 NDJSON，恢复时自动修复崩溃截断尾行，禁止云备份 `allowBackup="false"`），进程被杀或重启后显式提示恢复或安全丢弃；结束交接采用两阶段确认（IndexedDB 入队成功后调用 `acknowledgeHandoff`，未确认的 `stopped` 会话阻止新记录覆盖），绝不静默丢数据；
  - 结束后生成确定性 GPX 1.1（暂停/继续分段），经本地账号强绑定队列（预检 `/api/v1/auth/session` + `expected_owner_id` + `Idempotency-Key` + `AbortController`）幂等上传至 `POST /api/v1/gpx-imports`（断网暂存、到期定时器驱动指数退避自动重试、重复提交返回同一结果），服务端保持指标权威；退出登录/跨标签切换账号立即中止在途请求并清理本机记录与队列。
- **文件导入（`RunNoteWebChromeClient` + `FilePickerIntentHelper`）**：沿用 Phase 0 的 SAF DocumentsUI MIME 放宽，不申请宽泛存储权限。
- **认证与隐私**：沿用同源 HttpOnly Cookie + CSRF + Origin，`onPause()`/`onStop()` 主动 `CookieManager.flush()`；不暴露会话给 JS，不记录凭据、Cookie、健康数据原文或 GPS 坐标。

详细验证记录与阶段边界见 [Phase 1 交付记录](../docs/97-android-capacitor-phase1.md)、[Phase 2 交付记录](../docs/98-android-capacitor-phase2.md) 与 [Phase 3 交付记录](../docs/99-android-capacitor-phase3.md)。
