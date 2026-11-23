# RunNote Android Phase 0

这是 #131 的调试工程。最低 Android 10（API 29）、Android System WebView / Chrome 116+；构建使用 Capacitor 8.6.2、`@capacitor/app` 8.1.2、JDK 21、Gradle 8.14.3、AGP 8.13.0、Android SDK 36 和 Build Tools 35.0.0。Node 与 pnpm 版本沿用 Web 工程。

```sh
sdkmanager 'platform-tools' 'emulator' 'platforms;android-36' 'build-tools;35.0.0' \
  'system-images;android-29;google_apis;x86_64'
pnpm --dir android install --frozen-lockfile
pnpm --dir android sync
(cd android/native && ./gradlew --no-daemon testDebugUnitTest assembleDebug)
```

调试 APK 位于 `android/native/app/build/outputs/apk/debug/app-debug.apk`。在主机环回地址的 15297 端口启动隔离的 RunNote 实例，后端使用 `APP_ENV=test` 和 `SITE_ORIGIN=http://localhost:15297`。生产构建的前端进程使用同一 `ORIGIN`，`INTERNAL_API_BASE_URL` 指向隔离后端。使用明确的模拟器序列号，以下示例为 `emulator-5568`。

```sh
adb -s emulator-5568 reverse tcp:15297 tcp:15297
adb -s emulator-5568 install -r android/native/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5568 shell am start -n org.runnote.phasezero/.MainActivity
```

## Phase 0 原生防护与适配

- **WebView 最低版本检测（`WebViewSupport` + `MainActivity`）**：启动前通过 `WebViewCompat.getCurrentWebViewPackage()` 校验系统 WebView 版本（`minWebViewVersion: 116`）。低于要求（例如 API 29 库存 WebView 74）时不加载远端页面，展示原生中文升级页（跳转应用商店、打开系统应用详情与重新检测），避免静默白屏或水合失败。
- **系统返回键（`@capacitor/app` + `frontend/src/lib/capacitor-back.ts`）**：按优先级关闭当前打开的 `<dialog>`、Popover 菜单或移动端导航抽屉；无弹层时执行单步历史回退（防连点双导航）；无可回退历史时退出应用。仅在原生 Capacitor 运行时激活，不影响普通 Web 浏览器与 SSR。
- **文件选择器 MIME（`RunNoteWebChromeClient` + `FilePickerIntentHelper`）**：对 Android `MimeTypeMap` 未收录扩展名（`.gpx`、`.tcx`）及容易被文档提供者标记为 `application/octet-stream` 的轨迹/导入文件（含 Mi Fitness `.json`）放宽 DocumentsUI 筛选为 `*/*`（同时保留图片上传的严格 MIME 过滤），继续由前后端解析器做格式校验。
- **调试网络边界**：调试包仅为 `localhost` 开放明文网络访问，并在 `debug-overrides` 中允许信任用户/调试 CA 以便隔离演练本地 HTTPS（release 构建不生效）。`MainActivity.onPause()` 触发 `CookieManager.flush()`，降低后台被系统回收时丢失新登录会话的风险。

更新方法、复现结果和下一阶段限制见 [验证记录](../docs/95-android-capacitor-phase0.md)。
