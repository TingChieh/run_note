# RunNote Android（Phase 1 Companion）

RunNote 的 Android Capacitor 容器工程（#132），直接复用同一套 RunNote Web UI，不改 Web SSR 架构、不引入独立页面 fork。

- **应用标识**：`com.tingchieh.runnote`（应用名 `RunNote`）
- **版本**：与 `backend/pyproject.toml` / `frontend/package.json` 同步为 `2.3.0`（`versionCode = 20300`，规则 `MAJOR * 10000 + MINOR * 100 + PATCH`）
- **最低系统要求**：Android 10（API 29）、Android System WebView / Chrome **116+**
- **工具链**：Capacitor 8.6.2、`@capacitor/app` 8.1.2、JDK 21、Gradle 8.14.3、AGP 8.13.0、Android SDK 36、Build Tools 35.0.0

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
- **文件导入（`RunNoteWebChromeClient` + `FilePickerIntentHelper`）**：沿用 Phase 0 的 SAF DocumentsUI MIME 放宽，不申请宽泛存储权限。
- **认证与隐私**：沿用同源 HttpOnly Cookie + CSRF + Origin，`onPause()`/`onStop()` 主动 `CookieManager.flush()`；不暴露会话给 JS，不记录凭据、Cookie 或轨迹信息。

详细验证记录与阶段边界见 [Phase 1 交付记录](../docs/97-android-capacitor-phase1.md)。
