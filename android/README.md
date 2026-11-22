# RunNote Android Phase 0

这是 #131 的调试工程。最低 Android 10（API 29），构建使用 Capacitor 8.6.2、JDK 21、Gradle 8.14.3、AGP 8.13.0、Android SDK 36 和 Build Tools 35.0.0。Node 与 pnpm 版本沿用 Web 工程。

```sh
sdkmanager 'platform-tools' 'emulator' 'platforms;android-36' 'build-tools;35.0.0' \
  'system-images;android-29;google_apis;x86_64'
pnpm --dir android install --frozen-lockfile
pnpm --dir android sync
(cd android/native && ./gradlew --no-daemon assembleDebug)
```

调试 APK 位于 `android/native/app/build/outputs/apk/debug/app-debug.apk`。在主机环回地址的 15297 端口启动隔离的 RunNote 实例，后端使用 `APP_ENV=test` 和 `SITE_ORIGIN=http://localhost:15297`。生产构建的前端进程使用同一 `ORIGIN`，`INTERNAL_API_BASE_URL` 指向隔离后端。使用明确的模拟器序列号，以下示例为 `emulator-5568`。

```sh
adb -s emulator-5568 reverse tcp:15297 tcp:15297
adb -s emulator-5568 install -r android/native/app/build/outputs/apk/debug/app-debug.apk
adb -s emulator-5568 shell am start -n org.runnote.phasezero/.MainActivity
```

调试包仅为 `localhost` 开放明文网络访问。原始 API 29 Google APIs 镜像的 WebView 74 无法执行当前生产 JS。运行完整路径需另行验证更新过的 WebView。结果和下一阶段限制见 [验证记录](../docs/95-android-capacitor-phase0.md)。
