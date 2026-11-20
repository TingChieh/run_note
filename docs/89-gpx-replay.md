# 89 GPX 轨迹动态回放

在跑步详情页按记录时间重放这次跑步：完整轨迹作为背景，已走过的路段逐渐高亮，标记沿轨迹平滑移动，同时显示累计距离、时间与当前配速。设计与取舍见 [specs/2026-11-20-gpx-replay-design.md](superpowers/specs/2026-11-20-gpx-replay-design.md)（含第四阶段视频导出的方案评估与实现说明）。

## 使用方式

1. 打开任一有轨迹的跑步详情（`/activities/{id}`、`/p/{username}/activities/{id}`、`/workspace/activities/{id}`），点击“路线”标题区右侧、“个人轨迹”标签旁的“动态回放”。
2. 对话框内：播放 / 暂停 / 重新播放；拖动进度条跳到任意位置；1x、2x、5x、10x 倍速；“全局视角”看全程，“镜头跟随”平滑地追着标记走（跟随时可以缩放；手动拖动或旋转后两个按钮都不按下，点任一按钮恢复）。播放到结尾后，按钮变为“重新开始”。
3. 节奏：1x 不是真实时间，而是按运动时长自动定节奏，常见跑步（约 20–75 分钟）全程 15–30 秒，运动越久时长越长，最多 2 分钟（全程秒数 = `clamp(3.5·√分钟数, 15, 120)`）；各段之间的快慢比例仍按记录时间。2x/5x/10x 在此基础上加速。
4. 读数：
   - **距离**：服务端按 PostGIS 测地线逐边累计，与轨迹距离口径一致；跨段的断点不计入。
   - **经过时间**：从第一个时间戳起算，信号中断期间照常走。
   - **运动时间**：只累计段内速度 ≥ 0.5 m/s 的时间，不含原地停留和信号中断。
   - **当前配速**：最近约 30 s 窗口的平滑配速；静止或信号中断时显示“—”。
5. 回放类型：
   - **真实回放**：按记录时间还原节奏。少量缺失的时间按距离补齐（补齐的点数在接口的 `interpolated_point_count` 中，界面不单独显示）。
   - **模拟回放**：时间缺失过多、时间倒退或全部相同时，按距离匀速播放（使用活动平均配速，没有时用 6:00/km），读数改为“模拟用时”，不显示配速。
6. 信号中断（导入时因相邻点间隔 > 300 s 或速度 > 12 m/s 而切开的段）：两段之间不连线、不插值移动，标记在原地停顿 0.6 秒后跳到下一段起点。

## 导出视频

登录者查看本人记录时（工作区、站主看根展示、本人的具名展示）有两个入口：跑步详情黄色页头右下角的“分享”菜单 → “导出视频”（会直接打开回放并展开导出面板；同一菜单里还有“生成分享图”），以及回放对话框控件区右侧（“全局视角 / 镜头跟随”旁边）的“导出视频”按钮：

- 选项：画幅 9:16 竖屏 / 16:9 横屏 / 1:1 方形；清晰度 720p / 1080p；时长 15 / 30 / 60 秒；浅色或深色地图。
- 署名：地图来自 OpenStreetMap / OpenMapTiles（经 OpenFreeMap），数据许可要求在作品中注明来源，所以署名在数据面板下方单独一行（带浅底的小字），不与任何数据重叠；底图加载失败时用纯色背景，也就不显示署名。
- 进度：开始导出后进度卡片会自动滚入视野，依次显示“准备地图 → 加载底图 → 逐帧绘制 → 生成 MP4”；准备阶段是来回滑动的不定进度条，绘制阶段显示百分比、已绘帧数 / 总帧数和预计剩余时间，左侧实时预览正在绘制的画面；完成后在一张结果卡片里并排显示视频预览与“视频已生成 · 尺寸 · 时长 · 文件大小 · 导出用时”，以及“保存 MP4 / 分享视频 / 重新导出”，焦点移到“保存 MP4”；开始导出按钮此时隐藏，修改选项后用“重新导出”。
- 画面数据：数据面板顶部是全程进度条；第一行是当前距离、用时、配速（大字；信号中断或停顿时沿用最近一次有效配速，不显示“—”）；下面是本次记录的汇总：日期、总距离、设备用时或经过时间、平均配速、平均心率、热量、步数（缺失的项不显示；竖屏和方形每行四项、自动换行，横屏一行排完）。画面顶部不再放标题卡片。
- 输出：MP4（H.264，30 fps），无水印。画面有上述数据和跑者圆点，轨迹逐渐高亮，最后 1.5 秒停在完整路线上；底部保留地图数据署名（数据许可要求）。底图加载失败时用纯色背景，并提示用户。
- 在浏览器本机生成，可预览、保存，支持的设备还能直接调用系统分享；不上传到服务器。导出逐帧绘制地图，需要保持页面在前台，可随时取消。
- 需要支持 WebCodecs H.264 编码的浏览器（最新版 Chrome、Edge、Safari）；不支持时面板直接说明原因。

## 接口与隐私

- `GET /api/v1/activities/{id}/replay`：本人接口。他人或不存在的 ID 返回 404；记录没有轨迹时返回 404 `REPLAY_UNAVAILABLE`。
- `GET /api/v1/showcase/activities/{id}/replay`、`GET /api/v1/showcase/users/{username}/activities/{id}/replay`：完整展示端点，主体规则与 `/route` 相同（站主，或已启用展示的用户）；响应在 `showcase/service.py::replay_view` 中做白名单重建。
- 响应结构 `ReplayView`：`mode`、`point_count`、`interpolated_point_count`、`distance_m`、`elapsed_seconds`、`moving_seconds`、`segments[]`；每段为列式数组 `coordinates`、`elapsed_s`、`moving_s`、`distance_m`、`pace_s_per_km`（模拟模式下为 `null`）。
- 时间以“距开始的秒数”给出，不返回逐点的绝对时间戳。展示端点本来就公开完整轨迹和开始时间，这里不扩大公开范围。**旧版摘要分享（`/shared/*`、`/public/*`）不提供回放。**
- 不新增表、不新增迁移、不修改已存的点或活动；回放数据每次请求时从 `activity_points` 现算。
- 轨迹始终留在浏览器内，底图只请求视口瓦片（与路线地图相同）。
- 管理员只读查看他人记录的页面（`/admin/users/{id}/activities/{activityId}`）**没有**加入回放入口。
- 视频导出不新增接口，只使用页面已经读到的回放数据；访客没有导出入口。导出期间只向 OpenFreeMap 请求取景范围内的瓦片，与查看地图时相同。

## 性能

- 后端：在隔离的 `_test` 库上导入一条 50,000 点的合成 GPX，`/replay` 三次请求的耗时为 0.31 / 0.24 / 0.26 s，响应 JSON 2.67 MB（生产 Caddy 会用 `encode zstd gzip` 压缩）。
- 前端：播放时钟由真实时间（乘以自动节奏与倍速）驱动，不按点下标推进；用二分搜索（带前进提示）定位时间区间；显示线抽稀到 ≤ 6000 个顶点；图层只创建一次，每帧只更新“活动尖端”的几个坐标和标记位置；已走过的线最多每 150 ms 上传一次；读数每 125 ms 刷新一次；关闭对话框时取消 rAF 并移除地图。Vitest 中，5 万点轨迹的构建与 3600 帧采样分别有 1.5 s 与 200 ms 的上限断言。

## 验证记录

2026-11-20，在本机（Fedora）执行：

- `backend/.venv/bin/pytest tests/unit -q` → 555 passed。
- `backend/.venv/bin/ruff check app migrations tests`、`ruff format --check` → 通过。
- 在 scratchpad 中用 `initdb` 起的临时 PostGIS 集群（库名 `runnote_replay_test`，已 `alembic upgrade head`；只通过进程环境注入 `TEST_DATABASE_URL`/`TEST_DATABASE_ALLOWED_TARGETS`）上跑 `pytest tests/integration/test_replay.py test_showcase.py test_cross_user_access.py test_gpx_import.py test_admin_readonly_activities.py` → 64 passed。其余集成测试未在本机运行。
- 一条 50,000 点的合成 GPX 在同一临时库上的接口耗时，见上文“性能”一节。
- `svelte-kit sync && svelte-check` → 0 errors, 0 warnings。
- `vitest run` → 55 个文件、367 个用例全部通过（含 `tests/unit/replay.test.ts`、契约与架构检查）。
- `vite build` → 成功（只有既有的大 chunk 警告）。
- 合成 UI 套件 `playwright test --config playwright.ui.config.ts`：第一次全量运行 342 passed / 4 skipped / 2 failed，两条失败都在 `sport-detail.spec.ts`，是新按钮把“路线”标题撑高、打破了指标列与地图顶部对齐造成的。把按钮改到标题区独立的一列后，`sport-detail.spec.ts` 加 `activity-replay.spec.ts` → 12 passed；所有访问详情页的 18 个 spec 重跑 → 231 passed / 4 skipped（跳过项与全量运行相同）。修复之后没有再跑一次全量 348 个用例。
- `activity-replay.spec.ts` 覆盖：真实回放的完整操作（播放/暂停/倍速/拖动/信号中断/镜头/结束后重新开始/关闭后焦点回到入口）、模拟回放、手机深色布局（控件不滚动即可见）与键盘操作、读取失败后重试。
- `scripts/verify.py` 没有整体运行：本机 `pnpm` 要求重装依赖而中止，以上命令是直接调用对应二进制完成的。
- 根据反馈做了两处调整：“个人轨迹”标签与回放按钮并排对齐；1x 改为按运动时长自动定节奏，常见跑步 15–30 秒。调整后：`svelte-check` 0 错误、Vitest 367 passed，访问详情页的 18 个 UI spec 重跑 231 passed / 4 skipped；全量 348 个 UI 用例没有再跑。
- 第三轮（镜头抖动、轨迹抖动、视角切换、视频导出）：已走过的轨迹改为固定小段加 `feature-state`，镜头改为阻尼跟随并统一管理三种状态，新增浏览器端 MP4 导出。验证：`svelte-check` 0 错误；Vitest 56 个文件、373 个用例通过（新增 MP4 盒结构与帧时间轴测试）；`activity-replay.spec.ts`（7 个，含镜头切换、访客无导出入口、站主导出后由 `ffprobe` 解码：h264 High，720×720，450 帧）加 `sport-detail.spec.ts` → 15 passed；`playwright.activity-poster.config.ts`（分享图权限规则改用共享函数）→ 11 passed。临时放行底图的导出已解码并抽帧查看；这个临时测试没有保留在仓库里。
- 第四轮（按反馈）：删除播放器下方的说明文字，模拟回放改由“模拟用时”标签和配速“—”的读屏说明表达；“导出视频”从对话框标题栏移到控件区、镜头切换旁边。验证：`svelte-check` 0 错误；`activity-replay.spec.ts` 加 `sport-detail.spec.ts` → 15 passed（站主导出的视频仍由 `ffprobe` 解码通过）。
- 第五轮（按反馈）：页头的“生成分享图”按钮换成“分享”菜单（生成分享图 / 导出视频），回放对话框内的导出按钮保留；`AnchoredPanel` 新增 `text` 变体，`ActivityPosterDialog` 新增 `showTrigger` 与 `open(from)`，`ActivityReplayDialog` 新增 `openExport(from)`。验证：`svelte-check` 0 错误；`activity-replay`、`sport-detail`、`crossbrowser-glass`、`activities` 四个 spec → 52 passed / 4 skipped；`playwright.activity-poster.config.ts` → 11 passed。
- 第六轮（按反馈）：导出进度改为分阶段提示 + 进度条 + 帧数与剩余时间 + 实时预览，进度卡片自动滚入视野（原先出现在对话框可见区域之外，看起来“没反应”）；`backend.command` 增加前端端口与来源的比对提示。验证：`svelte-check` 0 错误；Vitest 373 passed；`activity-replay`、`sport-detail`、`crossbrowser-glass` → 23 passed / 4 skipped（导出测试断言进度条数值增长、帧数文本、完成摘要与焦点，导出文件 `ffprobe` 为 h264 720×720 450 帧）；`backend.command` 在 8399 端口用临时测试库验证了不一致与一致两种情况，ShellCheck 0.11 已无警告（HEAD 遗留的 SC2034 未用循环变量一并改为 `_`）；本机安装 ShellCheck 后，AGENTS.md 列出的 `infra/native` ShellCheck 命令与 `test_shell_style.py` 也已通过。
- 第七轮（按反馈）：回放地图与详情页路线地图的数据署名默认收起为 ⓘ（`startAttributionCollapsed`：只收起 MapLibre 在底图到达时的那一次自动展开，之后点击照常切换）；视频导出新增“简洁背景”（网格 + 路线，无地图数据、无署名），街道地图模式的署名缩小并调淡。验证：`svelte-check` 0 错误；Vitest 373 passed；`activity-replay`、`basemaps`、`sport-detail` → 30 passed（新增：合成底图加载后署名处于收起状态、点击可展开；简洁背景导出不请求 OpenFreeMap、无“底图暂不可用”提示，视频 `ffprobe` 为 h264 720×1280 450 帧）。另用临时测试放行真实底图，确认回放地图只显示 ⓘ、视频署名为面板角落小字；临时测试未保留。
- 第八轮（按反馈，用户选择“两种都要”）：视频背景改为街道地图 / 简化街道 / 我的轨迹三选一；`createBasemapController` 的视频专用参数改为选项对象 `{ fixed, restyle }`。验证：`svelte-check` 0 错误；Vitest 374 passed（新增 `simplifyBasemapStyle` 的保留 / 丢弃 / 配色测试）；`activity-replay`、`basemaps`、`sport-detail`、`footprints` → 63 passed（新增：我的轨迹经本人足迹接口取数、画面外的轨迹被滤掉、不请求 OpenFreeMap；简化街道在合成样式下底图就绪）。另用临时测试放行真实底图导出浅色、深色简化街道各一段并抽帧查看；临时测试未保留。
- 第九轮（按反馈）：视频背景改回只有街道地图（删除简化街道、我的轨迹及 `simplifyBasemapStyle`、`restyle` 选项和对应测试）；署名移到数据面板下方独立一行；面板加入全程进度条和记录汇总行，视频里的配速在中断时沿用最近一次有效值。诊断用户截图里的“—”：只读查询开发库中该记录，真实回放 1163 点、1 s 采样，仅 46 个点无配速，截图那一帧落在约 114 s 的信号中断里。验证：`svelte-check` 0 错误；Vitest 373 passed；`activity-replay`、`basemaps`、`sport-detail`、`footprints` → 61 passed（导出视频 `ffprobe` 为 h264 720×720 450 帧）；另用临时测试放行真实底图导出 9:16 并查看画面底部：署名独立一行、汇总六项清晰可读；临时测试未保留。
- 第十轮（按反馈）：导出结果改为一张卡片（预览 + 信息 + 保存 / 分享 / 重新导出）；视频去掉顶部标题卡片，日期并入汇总，汇总在竖屏与方形画面按每行四项换行；回放对话框加 `clip-path: inset(0 round var(--radius-card))`，让带 `backdrop-filter` 的玻璃控件滚动时不再画到圆角外（Chrome 中复现不到该问题，按截图判断是 WebKit 行为；本机 WebKit 缺系统依赖无法运行，Safari 未实测）。验证：`svelte-check` 0 错误；Vitest 373 passed；`activity-replay`、`sport-detail`、`crossbrowser-glass` → 23 passed / 4 skipped；`playwright.activity-poster.config.ts` → 11 passed；临时测试导出竖屏七项汇总并查看画面、在 Chrome 中检查滚动时四角裁剪，临时测试未保留。
