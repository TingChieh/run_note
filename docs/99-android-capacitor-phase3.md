# Android Phase 3：Capacitor 原生运动记录

范围为 #134（父 issue #130），基于 Phase 2 基线 `8aa7131d`（v2.4.0，见 [98 Phase 2 记录](98-android-capacitor-phase2.md)）实施。将版本同步升级至 **`2.5.0`**（Android `versionCode = 20500`），在不改 Web SSR 架构、不重写服务端权威指标算法、不做数据库 Schema 迁移、不重设计全局导航的前提下，交付完整可独立审查的运动记录切片：

1. **跨平台 Web 记录界面（`/activities/record` 与 `/workspace/activities/record`）**：开始、暂停、继续、结束、放弃确认；距离（预览）、用时、配速（预览）、轨迹点数/段数、GPS 状态与上传状态；权限拒绝、定位关闭、仅大致位置阻断（要求精确位置）、通知拒绝、GPS 丢失、离线模式、进程终止恢复、未入队已结束会话原子交接与防误退出保护；复用 RunNote 设计系统令牌与组件，适配 390×844 / 768×1024 / 1440×900 与浅/深色主题。
2. **Android 原生后台定位与前台服务（`LocationRecorderPlugin` + `RecordingForegroundService` + `LocationRecordingPolicy`）**：主动记录期间启动 `foregroundServiceType="location"` 的前台服务并展示锁屏脱敏常驻通知（`VISIBILITY_PRIVATE` + `setPublicVersion`），支持锁屏、切后台与 Doze 期间持续记录与即时落盘；严格要求 `ACCESS_FINE_LOCATION` 精确位置，并在恢复定位开关后自动重新订阅定位源；严格接口解耦以便未来 iOS（Core Location）直接复用同一套 Web UI。
3. **本地轨迹、账号强绑定队列与零迁移幂等上传**：复用现有 `POST /api/v1/gpx-imports` 端点并扩展可选 `Idempotency-Key`（UUID）头与 `expected_owner_id` 账号一致性校验实现真正服务端幂等重放（隔离于 `parser_version="gpx-idemp-v1"` 命名空间）与跨标签切号防护；断网/飞行模式记录后在恢复网络时自动上传一次，失败按指数退避由到期定时器自动重试，退出登录、401 或切换账号立即 `AbortController` 中止在途请求并清空本机草稿与队列。

---

## 1. 架构决策与后台 GPS 插件选型

### 1.1 候选跨平台后台 GPS 方案评估

| 方案 | Capacitor 8 兼容性 | 许可与依赖 | 权限、隐私与恢复能力评估 | 结论 |
| --- | --- | --- | --- | --- |
| `@capacitor-community/background-geolocation` | 未官方声明支持 Capacitor 8.6.2，依赖 Play Services (`play-services-location`) | MIT，但绑定 GMS | 强依赖 Google Play Services，AOSP/无 GMS 设备不可用；缺乏针对 RunNote 暂停分段（`<trkseg>`）、账号隔离及崩溃截断行容错的原子持久化 | **不采用** |
| `@transistorsoft/capacitor-background-geolocation` | 支持 | 商业闭源许可（Android Release 需付费 License Key） | 与 MIT 开源项目 RunNote 许可冲突，且引入高复杂度闭源黑盒状态机与冗余权限 | **不采用** |
| `@capacitor/geolocation` | 支持 | MIT | 仅限前台定位，无 Android Foreground Service，锁屏/切后台/Doze 会立即被系统中断 | **不采用** |
| **仓库内最小原生桥接 `LocationRecorderPlugin` + `RecordingForegroundService`** | 原生适配 Capacitor 8.6.2 | MIT（零第三方商业依赖，零 GMS 强依赖） | 基于 Android 标准框架 `LocationManager` + `ServiceCompat.startForeground(..., FOREGROUND_SERVICE_TYPE_LOCATION)`；精确控制最小权限白名单、零坐标日志、每点即时落盘 NDJSON 崩溃恢复与账号隔离；对外暴露平台无关 `LocationRecorder` 合约，未来 iOS 直接以 Core Location (`allowsBackgroundLocationUpdates`) 实现同名 Swift 插件即可复用 100% Web UI | **采用** |

### 1.2 Web / SSR 与未来 iOS 复用边界

- **Web SSR 硬约束**：`frontend/src/lib/capacitor-recorder.ts` 在非原生环境（SSR 与普通浏览器）下绝不访问原生桥接；在标准浏览器中优雅回退为前台 `navigator.geolocation` 模式并提示“浏览器切后台或锁屏可能暂停定位，后台持续记录请使用 Android 客户端”。
- **未来 iOS 对接面**：`frontend/src/lib/capacitor-env.ts` 定义了平台无关的 `CapacitorLocationRecorderPlugin` 接口（`getCapabilities`、`checkPermissions`、`requestPermissions`、`openAppSettings`、`openLocationSettings`、`startSession`、`pauseSession`、`resumeSession`、`stopSession`、`acknowledgeHandoff`、`discardSession`、`getSessionState`、`getSessionPoints`、`clearAccountSessions`、`addListener('sessionUpdate', ...)`）。未来接入 iOS 时只需实现 Swift 插件，**无需修改任何 Svelte 页面、序列化器或上传队列**。

---

## 2. 权限清单、隐私边界与前台/后台定位政策评审

### 2.1 Android Manifest 最小权限清单（经 `aapt2 dump permissions` 核实）

| 权限 | 适用 API | 用途 | 政策说明 |
| --- | --- | --- | --- |
| `android.permission.ACCESS_FINE_LOCATION` | API 29+ | 跑步精确 GPS 轨迹采集（硬前置） | 仅在用户主动点击「开始跑步」或授权时申请；仅授大致位置时阻断开始并引导升级精确位置 |
| `android.permission.ACCESS_COARSE_LOCATION` | API 31+ | Android 12+ 需与 `FINE` 联合申请 | 不允许在仅大致位置下空跑记录，UI 明确阻断并提供「重新请求精确位置」与系统设置入口 |
| `android.permission.FOREGROUND_SERVICE` | API 29+ | 运行运动记录前台服务 | 仅在主动记录会话期间运行 |
| `android.permission.FOREGROUND_SERVICE_LOCATION` | API 34+ | Android 14+ 声明位置型前台服务 | 与 `<service android:foregroundServiceType="location" android:exported="false" />` 一致 |
| `android.permission.POST_NOTIFICATIONS` | API 33+ | 展示常驻运动进度通知 | 采用 `VISIBILITY_PRIVATE` + 脱敏 `setPublicVersion`（锁屏不泄露距离/耗时）；若用户拒绝，前台服务仍正常运行，UI 提示状态栏通知已隐藏 |

### 2.2 Google Play 后台定位与前台服务政策评审结论

- **刻意不声明 `ACCESS_BACKGROUND_LOCATION`**：根据 Google Play 位置权限政策与 Android 10–16 官方规范，仅由用户在前台主动触发、并伴随可见常驻通知的 `foregroundServiceType="location"` 前台服务，**天然享有锁屏与切后台持续定位能力，无需申请「始终允许（`ACCESS_BACKGROUND_LOCATION`）」**，从而避免不必要的后台常驻定位审查风险与隐私过度索权。该约束已由 JUnit `LocationRecordingPolicyTest.manifestDeclaresMinimalForegroundLocationPermissionsAndNoBackgroundLocation` 与 `aapt2 dump permissions` 门禁双重强制。
- **Android 14–16 前台服务启动限制合规**：
  - `RecordingForegroundService` 使用 `START_NOT_STICKY`，绝不在 `BOOT_COMPLETED` 或后台静默拉起位置前台服务（避免触发 `ForegroundServiceStartNotAllowedException`）。
  - 每次启动/恢复前显式校验精确位置权限（`ACCESS_FINE_LOCATION`）与系统定位开关；捕获 `SecurityException` 与 `IllegalStateException` 转为 `interrupted` 可恢复态而不崩溃；记录中重新打开系统定位开关后，`onProviderEnabled` 自动重新订阅定位源。
- **「仅本次允许」（Android 11+ One-Time Permission）与运行中降权处理**：
  - 运动期间前台服务运行中权限保持有效；若服务中止、或用户在系统设置中中途撤销或降级为仅大致位置，服务捕获 `SecurityException` 或心跳检测到失去 `ACCESS_FINE_LOCATION` 后立即落盘所有已采轨迹点、将状态标记为 `interrupted`（`interruptedReason="permission_revoked"`），恢复应用后展示显式恢复面板，绝不丢弃已有轨迹。
- **隐私、锁屏脱敏与零敏感日志保证**：
  - 原生 `Logger`（`RunNoteRecorder`）与前端代码**绝不输出**经纬度坐标、海拔、原始 GPX、Cookie、CSRF Token 或健康数据（API 29 / 单测与代码审计确认 0 泄露）。
  - 前台常驻通知使用 `NotificationCompat.VISIBILITY_PRIVATE` 与脱敏 `setPublicVersion`（仅显示「RunNote 跑步记录中」），锁屏状态下不暴露里程与运动耗时。
  - 应用私有存储 `files/recordings/` 受 `android:allowBackup="false"` 保护，不参与系统云备份；所有原生读取（`getSessionState` / `getSessionPoints`）均按 `accountId` 校验归属，本地 IndexedDB 队列由 `assertSafeCachePayload()` 拦截敏感键名；退出登录、401 或跨标签切换账号（含 `BroadcastChannel('runnote-auth')`）时立即通过 `AbortController` 中止在途上传并清空私有记录数据与原生会话文件，严防串账号。
  - **展示模式可见性披露**：若站主启用了「完整展示模式」（`full_showcase`），后端策略会将新上传的私密活动同步对公开展示页可见；记录页对此向已开启展示模式的用户展示明确披露提示（`recording-showcase-privacy-note`）。

---

## 3. 幂等上传契约（复用现有接口，零数据库迁移）

### 3.1 后端契约：`POST /api/v1/gpx-imports`（新增可选 `Idempotency-Key` 头与 `expected_owner_id` 字段）

无需新增表或 Alembic 迁移，直接复用既有 `POST /api/v1/gpx-imports`、`GpxImport`（唯一索引 `uq_gpx_imports_owner_raw` / `uq_gpx_imports_owner_canonical`）、每用户 `pg_try_advisory_lock` 导入互斥锁，以及 SSR 代理已放行的 7 个标准请求头白名单（其中已包含 `idempotency-key`）。幂等导入记录通过独立 `parser_version="gpx-idemp-v1"`（与普通上传 `"gpx-parser-v1"` 严格隔离）识别，避免普通导入上传名为 `idempotency:<uuid>.gpx` 的文件时触发误重放或误冲突：

| 场景 | 请求条件 | 服务端行为 | HTTP 状态 |
| --- | --- | --- | --- |
| 普通导入（兼容旧行为） | 不带 `Idempotency-Key` | 原有创建/去重逻辑完全不变（`parser_version="gpx-parser-v1"`，即使用户上传字面文件名 `idempotency:<uuid>.gpx` 也不与幂等命名空间冲突） | `201` / `409 GPX_DUPLICATE` |
| 非法键或归属 UUID 格式 | `Idempotency-Key` 或 `expected_owner_id` 非合法 UUID | FastAPI 参数校验直接拒绝（解析前） | `422 VALIDATION_ERROR` |
| 账号不匹配（跨标签切号兜底） | `expected_owner_id != 当前登录会话 user.id` | 在任何解析/写库前原子拒绝 | `409 ACCOUNT_MISMATCH` |
| 首次实时记录上传 | 合法 UUID `Idempotency-Key` + 有效 GPX | 创建 `Activity` + `GpxImport`（`parser_version="gpx-idemp-v1"`，`original_filename="idempotency:<uuid>.gpx"`，仅本人私密）+ `ActivitySegment`/`ActivityPoint`，递增 `activity_data_version` | `201 Created`（`ApiResponse[ImportView]`） |
| 重复提交 / 弱网重放 | 同账号 + 同 `Idempotency-Key` + 相同 GPX 字节（`raw_sha256` 一致） | 仅在 `parser_version="gpx-idemp-v1"` 命名空间中命中，不新建活动、不重复递增 `activity_data_version`，单次聚合查询还原 `ImportView` 返回（零 N+1；注意：重放读取当前持久化 `Activity` 行，如用户随后手动编辑了标题或可见性则反映最新状态，而非历史冻结快照） | `200 OK`（同一 `activity.id` 与 `import_id`） |
| 键冲突误用 | 同账号 + 同 `Idempotency-Key` + 不同 GPX 内容 | 拒绝覆盖已有记录 | `409 IDEMPOTENCY_CONFLICT` |
| 跨账号提交同键同轨迹 | 用户 B 使用与用户 A 相同的 `Idempotency-Key` 和 GPX | 严格按 `user_id == owner` 隔离，为用户 B 创建独立活动，不泄露用户 A 的任何 ID | `201 Created`（独立 `activity.id`） |

- **服务端指标权威与暂停耗时口径**：前端记录界面的距离与配速明确标注为“预览”（Haversine 估算）；结束生成确定性 GPX 1.1（暂停/继续自动拆分为独立 `<trkseg>`，确保 PostGIS 不跨暂停段连线）并以 `time_mode="absolute"` 上传，最终里程、用时、配速、路线与足迹全部由服务端 PostGIS 管线权威计算。服务端当前按首尾轨迹点时间差计算总耗时（`elapsed_seconds`），包含中途暂停时长并以此计算平均配速；前端已在记录页明确标注该统计口径（`recording-pause-note`）。

### 3.2 本地上传队列、账号强绑定、原子交接与定时退避重试

- **两阶段原子交接（防 `stopped` 后崩溃丢轨迹）**：原生 `stopSession()` 将会话落盘为 `stopped` 后**不立即删除文件**；前端必须先将轨迹原子写入账号隔离 IndexedDB 上传队列，成功后才调用 `acknowledgeHandoff(sessionId)` 清理原生磁盘文件。若写入队列前发生崩溃，下次启动检测到未确认的 `stopped` 会话（`hasPendingHandoff`）会自动补录进队列并阻止新会话覆盖。
- **账号强绑定与跨标签安全**：每次上传前先调用 `/api/v1/auth/session` 核验当前 Cookie 会话是否仍属于该队列项的 `accountId`，并在表单中携带 `expected_owner_id` 由后端二次原子校验；退出登录、401 或其他标签通过 `BroadcastChannel('runnote-auth')` 切换账号时，立即调用 `abortAllRecordingUploads()`（`AbortController`）中止在途请求并清空旧账号队列与原生会话，杜绝将账号 A 的轨迹误传到账号 B。
- **确定性序列化（`frontend/src/lib/gpx-serializer.ts`）**：同一已完成会话重复序列化产生字节级完全一致的 GPX 1.1（7 位小数坐标、ISO-8601 UTC 时间戳），保证重试时 `raw_sha256` 与 `canonical_sha256` 严格一致。
- **到期定时器驱动的指数退避（`frontend/src/lib/recording-uploader.ts`）**：单飞并发控制；离线自动暂存、恢复联网（`online` 事件）自动触发一次上传；遇 `503`/`429`/网络超时执行指数退避（`5s → 15s → 45s → 120s → 300s`），并由 `scheduleNextRecordingUpload()` 在精确 `nextRetryAt` 时刻自动唤醒重试（即便用户停留在页面不刷新、或在到期前提前重连跳过了本次尝试，也会重设剩余时长的定时器）；遇 `409 GPX_DUPLICATE`（含 `existing_activity_id`）直接幂等关联已有活动；遇 `409 ACCOUNT_MISMATCH` 立即中止并清理原账号队列；遇 `401` 暂停队列提示重新登录而不静默丢弃用户轨迹；遇 `400`/`422` 永久校验错误停止无限重试并允许用户显式丢弃。上传成功后立即释放本地原始 GPX 文本并触发 `runnote-activities-changed` 驱动 Phase 2 增量同步。

---

## 4. 失败与异常恢复矩阵

| 故障 / 场景 | 本地持久化与原生行为 | 前端可见状态与恢复操作 | 数据完整性保证 |
| --- | --- | --- | --- |
| 定位权限拒绝 | 不启动前台服务 | 展示「未授予定位权限」错误卡片，提供「请求定位权限」与「打开应用设置」 | 无崩溃，可重新授权 |
| 仅授予大致位置（Android 12+） | 拒绝启动（`PRECISE_LOCATION_REQUIRED`），与 50m 精度过滤口径一致；运行中降权立即中断保存 | 展示「需要精确位置权限」错误卡片并禁用「开始跑步」，提供「重新请求精确位置」与系统设置入口 | 避免空跑零有效点；已采点位不丢失 |
| 通知权限拒绝（Android 13+） | 前台服务仍可运行，通知被系统隐藏 | 展示「通知权限未开启」提示与「打开通知设置」 | 记录不中断 |
| 系统定位开关关闭 / 重新开启 | 拒绝启动；记录中关闭触发 `onProviderDisabled`；重新开启时 `onProviderEnabled` 自动重新订阅定位源 | 展示「系统定位服务已关闭」+「打开定位设置」；常驻通知同步提示 | 已采点位已落盘保留，恢复后继续采点 |
| GPS 信号丢失（> 15s 无定位） | 心跳检测置 `gpsStatus="lost"`，常驻通知更新 | 展示「GPS 信号暂时丢失」告警，引导移至空旷处 | 已有轨迹点不受影响 |
| 锁屏 / 切后台 / Doze | `RecordingForegroundService` 持续接收定位并即时追加写入 `points.ndjson`；锁屏通知 `VISIBILITY_PRIVATE` 隐藏距离与耗时 | 回到前台通过 `handleOnResume()` + `visibilitychange` 无缝同步最新指标 | 0 数据丢失，锁屏不泄露运动指标 |
| 记录中按返回键 / 跳转其他页 | 原生端前台服务继续运行；Web 端提示会暂停采集 | 弹出原生 `<dialog>` 确认框，支持「留在记录页」或「确认离开」 | 防误操作中断 |
| 进程被杀 / 系统内存回收 / 设备重启 | 重启后检测到磁盘存在未结束会话且服务未运行，自动归类为 `interrupted`；`RecordingStore` 使用原子 `Files.move` 落盘并在加载时自动重写修复电力中断造成的 `points.ndjson` 截断尾行，避免后续追加错位 | 顶部展示「检测到未完成的跑步记录」恢复面板，明确提供 **继续记录**（新 `<trkseg>`）、**结束并保存** 或 **安全丢弃**（二次确认 `<dialog>`） | 绝不静默丢数据 |
| 结束记录后入队前崩溃（`stopped` 交接中断） | 原生保留 `status="stopped"` 会话与点位直至前端调用 `acknowledgeHandoff(sessionId)`，并拒绝新 `startSession` 覆盖 | 重启进入记录页自动补录进 IndexedDB 上传队列后确认清理；若补录失败则展示 `recording-pending-handoff-panel` 提供重试保存或显式丢弃，并阻止开始新记录 | 原子交接，0 轨迹丢失 |
| 飞行模式 / 断网完成记录或遇 `503` | 生成 GPX 并写入账号隔离 IndexedDB 队列 | 提示「已保存到本地上传队列，恢复网络后将自动上传一次」；`503` 后展示剩余秒数并在到期定时器触发时自动重试 | 恢复网络或退避到期后自动仅上传一次 |
| 退出登录 / 跨标签切换账号 | 立即 `AbortController` 中止在途请求、取消退避定时器、停止活动服务并调用 `clearPrivateRecordingData()` + `clearAccountSessions()`；后端校验 `expected_owner_id`（`409 ACCOUNT_MISMATCH`） | 清理旧账号全部本机记录与未上传队列并提示账号已切换 | 绝不串账号上传或泄露轨迹 |

---

## 5. 验证命令与真实执行结果

### 5.1 后端单元测试、契约校验、Ruff 与隔离 PostGIS 集成测试

- 契约生成与代码检查：
  - `cd backend && DATABASE_URL=postgresql+psycopg://run_note@127.0.0.1:15432/run_note_ci .venv/bin/python -m app.contract.typescript` — **PASS**（同步 `frontend/src/lib/api/generated/api.ts`）
  - `cd backend && .venv/bin/ruff check app migrations tests && .venv/bin/ruff format --check app migrations tests` — **PASS**（`All checks passed! 294 files already formatted`）
- 后端单元测试：
  - `cd backend && DATABASE_URL=postgresql+psycopg://run_note@127.0.0.1:15432/run_note_ci .venv/bin/pytest tests/unit -q` — **597 passed**（含新增 `test_gpx_idempotency.py`、`test_architecture.py`、`test_api_contract.py`、`test_version.py` 2.5.0 同步断言）
- 隔离临时 PostgreSQL + PostGIS 集成测试（临时集群端口 `15451`，测试库 `run_note_phase3_test`，测后自动销毁，未触碰开发库）：
  - `alembic upgrade head`（确认零新增迁移，`0001_postgis` → `0034_drop_ai_reports`）— **PASS**
  - `.venv/bin/pytest tests/integration/test_gpx_import.py tests/integration/test_cross_user_access.py -v` — **56 passed**（含 `test_gpx_import_idempotency_replay_conflict_isolation_and_no_n_plus_one` 与 `test_gpx_idempotency_is_isolated_from_raw_filename_and_enforces_expected_owner`：覆盖非法 UUID 422、首次上传 201、重复提交 200 重放且不增版本号且 SQL 次数 `<= 12` 无 N+1、同键不同载荷 409 `IDEMPOTENCY_CONFLICT`、跨用户同键同轨迹隔离 201、普通导入字面文件名 `idempotency:<uuid>.gpx` 与 `gpx-idemp-v1` 命名空间完全隔离、`expected_owner_id` 不匹配返回 409 `ACCOUNT_MISMATCH` 与格式非法返回 422）
- 运维脚本单元测试与统一校验脚本：
  - `DATABASE_URL=postgresql+psycopg://run_note@127.0.0.1:15432/run_note_ci python3 scripts/verify.py` — **8/8 PASS**（contract、ruff check/format、597 backend unit、456 frontend vitest、svelte-check 0 errors、139 ops unit、shellcheck）

### 5.2 前端单测、类型/样式检查、生产构建与 Playwright 端到端/视觉验收

- `cd frontend && pnpm check` — **PASS**（`0 errors and 0 warnings`）
- `cd frontend && pnpm lint:style` — **PASS**
- `cd frontend && pnpm test` — **PASS**（**76 test files / 456 tests passed**，含 `gpx-serializer.test.ts`、`recording-store.test.ts`、`recording-uploader.test.ts`（含定时退避自动触发、提前重连重设定时器、跨标签切号预检与 `409 ACCOUNT_MISMATCH`、`AbortController` 立即中止）、`capacitor-recorder.test.ts`（含大致位置 `canRecord=false`、`acknowledgeNativeHandoff`、`accountId` 透传）与既有 `architecture.test.ts`、`api-contract.test.ts`）
- `cd frontend && pnpm build` — **PASS**（`@sveltejs/adapter-node` 生产 SSR 构建通过）
- `cd frontend && COMPANION_USE_PROD_BUILD=1 PHASE3_CAPTURE_SCREENSHOTS=1 pnpm exec playwright test --config playwright.companion-phase3.config.ts --reporter=list` — **8 passed**（生产构建上验证未登录重定向、Web 前台模式、权限拒绝/大致位置阻断开始/通知拒绝/定位关闭、GPS 搜星/良好/丢失/暂停耗时口径提示/继续/返回键防误退/断网暂存/联网单次幂等上传、`stopped` 未入队会话 5 秒内自动补录入队与 `acknowledgeHandoff`、503 退避到期留在页面自动重试上传、跨标签切号中止上传且 0 请求发往账号 B、进程被杀恢复与二次确认丢弃、以及 390×844 / 768×1024 / 1440×900 明暗主题零横向溢出；`companion-phase3.spec.ts` 已纳入 `playwright.ui.config.ts` 以便 GitHub CI `frontend-ui` 自动执行）
- `cd frontend && COMPANION_USE_PROD_BUILD=1 pnpm exec playwright test --config playwright.companion-phase2.config.ts --reporter=list` — **4 passed**（Phase 2 无回归）
- `cd frontend && pnpm exec playwright test --config playwright.ui.config.ts tests/ui/ui-shell.spec.ts --reporter=list` — **PASS**（壳层交互无回归）

### 5.3 Android 原生构建、JUnit 单测、APK 权限审计与 API 29 模拟器实测

- **Gradle 构建与单测**：`pnpm --dir android sync && (cd android/native && ./gradlew --no-daemon testDebugUnitTest assembleDebug)` — **BUILD SUCCESSFUL**，JUnit **32/32 passed**（含 `LocationRecordingPolicyTest` 4 组用例：Manifest 最小权限与禁用 `ACCESS_BACKGROUND_LOCATION` 审计、API 29–36 精确位置硬前置与 FGS 类型评估、GPS 信号分级与精度/速度跳变/分段过滤、原子 `Files.move` 落盘/截断尾行主动修复后追加/按 `accountId` 隔离读取/`stopped` 交接保留与 `acknowledgeHandoff` 会话 ID 核验/进程被杀状态归类/账号切换清理；`ServerUrlPolicyTest` 2.5.0 / 20500 断言）。
- **合并后 Debug APK 权限审计（`aapt2 dump permissions android/native/app/build/outputs/apk/debug/app-debug.apk`）**：
  - 仅包含 `INTERNET`、`ACCESS_NETWORK_STATE`、6 项 `android.permission.health.READ_*`（0 项 `WRITE_*`）、`ACCESS_FINE_LOCATION`、`ACCESS_COARSE_LOCATION`、`FOREGROUND_SERVICE`、`FOREGROUND_SERVICE_LOCATION`、`POST_NOTIFICATIONS`（**0 项 `ACCESS_BACKGROUND_LOCATION`**、**0 项宽泛存储权限**）；`versionCode=20500`、`versionName=2.5.0`。
- **API 29 模拟器运行时实测（`RunNote_Phase0_API29`，`-no-window -gpu off`，WebView `133.0.6943.137`，`adb reverse tcp:15297` 对接本地生产 SSR + 合成 API）**：
  - 安装与启动：`com.tingchieh.runnote`（`versionCode=20500`、`versionName=2.5.0`）安装成功；CDP 确认 `Capacitor.isNativePlatform() === true`、`Plugins.LocationRecorder` 与 `Plugins.HealthData` 均已注册、`document.cookie.length === 0`。
  - 权限与能力：`getCapabilities()` 返回 `platform="android", backgroundSupported=true, requiresNotificationPermission=false, sdkInt=29`；`checkPermissions()` 返回 `location="granted", notification="not_required", preciseLocation=true, canRecord=true`。
  - 前台服务与常驻通知：经 WebView CDP 调用 `LocationRecorder.startSession(...)` 后，`dumpsys activity services` 确认 `RecordingForegroundService` 运行在真实前台服务态（`isForeground=true foregroundId=30501`），`dumpsys notification` 确认常驻通知通道 `channel=runnote_recording category=workout` 正常展示（后续复审加固将通知可见性切换为 `VISIBILITY_PRIVATE` + 脱敏 `setPublicVersion`，锁屏不暴露距离/耗时）；同时验证外部直接 `am start-foreground-service` 因 `android:exported="false"` 被系统权限拦截。
  - 锁屏后台 GPS 落盘与强杀恢复：锁屏（`KEYCODE_POWER`）后通过 `adb emu geo fix` 注入合成定位点，确认 `files/recordings/active_session.json` 与 `files/recordings/points.ndjson`（3 条定位记录）即时落盘；执行 `am force-stop com.tingchieh.runnote` 模拟进程强杀并唤醒重启应用后，`LocationRecorder.getSessionState()` 正确返回 `status="interrupted"`、`interruptedReason="process_terminated"`、`pointCount=3`、`activeDurationMs=2350`（并由此实测发现且修复了 `+layout.svelte` 冷启动匿名态误清中断会话的真实缺陷）。
  - 隐私日志审计：`adb logcat -d -s RunNoteRecorder:* Capacitor:*` 检索全部合成坐标，确认 **`PII_COORDINATE_LEAKS=0`**。

### 5.4 视觉验证截图（合成数据，生产构建，明暗主题）

| 手机 390×844（浅色 · 就绪） | 手机 390×844（深色 · 记录中） | 平板 768×1024（深色） |
| --- | --- | --- |
| ![手机浅色](assets/phase3-mobile-light.png) | ![手机深色](assets/phase3-mobile-dark.png) | ![平板深色](assets/phase3-tablet-dark.png) |

| 平板 768×1024（浅色） | 桌面 1440×900（浅色） | 桌面 1440×900（深色） |
| --- | --- | --- |
| ![平板浅色](assets/phase3-tablet-light.png) | ![桌面浅色](assets/phase3-desktop-light.png) | ![桌面深色](assets/phase3-desktop-dark.png) |

---

## 6. 未关闭门禁、未运行检查与已知限制（如实标注，不声称通过）

1. **真机验证（PKT110 / Android 17 / WebView 144）：未完成**。
   - 本机当前 USB 连接设备为 `F50`（Android 13 / SDK 33，`dumpsys webviewupdate` 缺少 WebView 116+，见 [97 Phase 1 记录](97-android-capacitor-phase1.md)）；`PKT110` 未接入，无法在本机执行真机飞行模式记录→恢复网络单次上传、真机锁屏/切后台/杀进程/重启、真实 GPS 丢失与真机安全区验证。待接入 `PKT110` 后补跑真机签收门禁。
2. **Google Play 政策 / Data Safety 声明与商店审查：未签收**。
   - 代码与 Manifest 已按最小权限原则落实（无 `ACCESS_BACKGROUND_LOCATION`、前台 `foregroundServiceType="location"`、锁屏脱敏通知 `VISIBILITY_PRIVATE`），但 Play Console 中的位置采集 Data Safety 表单、前台服务申报视频与正式上架审查尚未提交签收。
3. **国产 ROM 后台保活与杀进程实测（MIUI/HyperOS、ColorOS、OriginOS、HarmonyOS）：未验证**。
   - 当前无对应真机，已明确标注为未验证项。
4. **CI 范围说明**：
   - `companion-phase3.spec.ts` 已加入 `frontend/playwright.ui.config.ts` 的 `testMatch`，随 GitHub CI `frontend-ui` 自动运行；
   - 当前 GitHub Actions 工作流（`.github/workflows/ci.yml`）**尚未包含 Android Gradle 原生构建/单测 job**，Android 原生单测与 APK 权限审计目前在本机通过 `./gradlew --no-daemon testDebugUnitTest assembleDebug` 与 `aapt2 dump permissions` 执行。
5. **API 29 模拟器补充说明**：使用 `-gpu off` 已在 API 29 模拟器完成安装、WebView 133 加载、前台服务（`isForeground=true` + 常驻通知）、锁屏落盘、`am force-stop` 强杀恢复与 0 坐标日志泄露验证；复审修复后的 `VISIBILITY_PRIVATE`、`acknowledgeHandoff` 与精确位置阻断已在 Android JUnit（32/32）与生产构建 Playwright（8/8）中覆盖，真机（PKT110）物理运动轨迹与飞行模式重连闭环仍待签收。
6. **全量真实后端 Playwright E2E（`playwright.config.ts`）与签名 Release APK 构建：未在本机运行**（PR CI 将覆盖全量后端集成测试、前端单测/构建/合成 UI 与运维演练）。
7. **已知限制**：
   - 应用沿用 Phase 1/2 的在线 `server.url` 加载模式；若在冷启动阶段即完全断网且页面未加载，需联网加载一次页面后方可在离线/飞行模式下发起并暂存记录。
   - 服务端 GPX 导入按首尾点时间差计算总耗时，因此中途长时间暂停会影响服务端平均配速（UI 已在暂停时显式提示）。
   - 本期不实现 iOS App / Core Location、不写 Health Connect/HealthKit、不做离线底图、实时位置分享或语音播报。
   - **回滚方式**：无数据库 Schema 迁移，后端仅对现有 `POST /api/v1/gpx-imports` 增加了向后兼容的可选 `Idempotency-Key` 头与 `expected_owner_id` 表单项；直接 revert PR 提交并重新构建发布包与 APK 即可安全回滚。
