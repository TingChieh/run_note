# GPX 轨迹动态回放与运动视频导出设计

日期：2026-11-20。范围：第一至第三阶段（动态回放）已实现；第四阶段（视频导出）先做了设计，同日按方案 A 实现（见下文“实现结果”）。

## 现状与结论

- `activity_points` 逐点保存坐标与 `recorded_at`，`activity_segments` 保存导入时派生的分段。`gpx/normalization.py` 的 `derive()` 已在时间倒序、零时间位移、相邻点间隔 > 300 s、速度 > 12 m/s 处切段，坏坐标也会断段。TCX 与小米运动健康导入写入同一组表。
- 现有 `/route` 只返回几何，没有时间，不够回放用。
- 因此**不新增表或迁移**，只新增一个只读接口，从已存的点现算回放数据，原始记录不改。

## 后端

`GET /api/v1/activities/{id}/replay`（本人），以及 `GET /api/v1/showcase/activities/{id}/replay`（站主展示，具名展示经 `named_router` 自动复制）。

1. `gpx/queries.py::replay_points`：一条 SQL 取出全部点，并用窗口函数 `LAG` 加 `ST_Distance(geography)` 算出每条边的测地线长度，与 `route_distance` 的 `ST_Length(geography)` 口径一致；SQL 中同时约束 `activity_id` 和 `user_id`。
2. `gpx/replay.py::build_replay`（纯函数）：
   - **真实回放**（`mode=real`）：有时间的点至少 2 个、占比不低于 50%，按路线顺序时间不倒退，且首尾时间不同。两个有时间点之间缺失的时间按距离线性插值；段首、段尾缺失时间的点取最近的已知时间（不编造速度）。如果某一段完全没有时间，整条记录降为模拟回放。
   - **模拟回放**（`mode=simulated`）：时间不可用时，按活动平均配速（缺失时用 6:00/km）把距离映射成时间，不返回配速。
   - **经过时间 / 运动时间**：`elapsed_s` 是距首个时间戳的秒数，跨段继续走；`moving_s` 只累计段内速度 ≥ 0.5 m/s 的区间，跨段的信号中断和原地停留都不计。
   - **平滑配速**：取段内“至少回溯 30 s”的最近点作窗口起点，跨度不足 5 s 或平均速度 < 0.5 m/s 时给 `null`。单个噪声点只占窗口的一小部分，不会引起跳变。
   - 输出按段列式数组（`coordinates/elapsed_s/moving_s/distance_m/pace_s_per_km`），比逐点对象省体积，前端可直接转成 TypedArray。
3. 展示端点经 `showcase/service.py::replay_view` 做白名单重建。

## 前端

- `lib/api/replay.ts`：逐字段运行时校验（长度一致、数值有限、时间/距离/运动时间单调、坐标范围、点数上限 50000、模拟模式不得带配速），经度沿用 `unwrapRoute` 的方式展开，跨 180° 经线时连续绘制。
- `lib/replay/engine.ts`：`ReplayTrack`（Float64Array 列式存储）、`ReplayPoint`（某一时刻的插值结果）、`ReplayState`（`status/time/speed`）。播放时钟以轨迹秒为单位，1x 的播放速率 `rate` 由 `playbackSeconds()` 决定：段内总时长 T 分钟时，全程播放 `clamp(3.5·√T, 15, 120)` 秒。按平方根增长，20–75 分钟的常见跑步落在 15–30 秒，越长的活动时长越长，最多 2 分钟；各点之间仍按记录时间的比例推进。段间信号中断在屏幕上固定停顿 0.6 秒（轨迹秒为 `0.6·rate`），期间标记停在原地，经过时间照常前进。时间定位用二分搜索，并先检查前进方向的提示下标，常见情况下是 O(1)。显示线按距离抽稀到 ≤ 6000 个顶点。
- `lib/replay/playback.ts`：单一 rAF 循环，按真实流逝时间 × `rate` × 倍速推进；单帧上限 250 ms（防止后台标签页恢复时跳进）；不认识地图。
- `lib/replay/replay-map.ts`：图层只创建一次。背景线是每段一条完整的线；已走过的部分由 `displayEdges()` 把抽稀后的线拆成固定的小段（每段一个带数字 id 的要素），用 `feature-state` 切换透明度，几何永不重传。最初的做法是每 150 ms 重传“已走过的整条线”，地图引擎每次都会重新简化，已画好的部分随之变形，用户看到轨迹抖动，因此改成了现在这样。“活动尖端”（最后一个已走过的顶点 → 原始点 → 插值位置）每帧更新，只有几个坐标（`tolerance: 0`）；标记是开启 `subpixelPositioning` 的 DOM Marker。镜头由同一个模块统一控制：`overview` / `follow` / `free` 三种状态；跟随时每帧按指数阻尼把中心靠近标记（时间常数 350 ms，缩放 500 ms），不再每帧直接跳到 GPS 点，GPS 摆动就不会带着整张地图抖；跟随缩放取全局缩放 +1.5（限制在 13–16.5）；手动拖动或旋转进入 `free`（两个按钮都不按下），跟随时手动缩放会保留新的缩放、继续跟随；尺寸变化时只有 `overview` 会重新取景。不调用 `setStyle`，不重建 Map，底图交给 `createBasemapController`，配色在 `map-style.ts::applyReplayTheme` 中只改 paint 属性。
- `ReplayPlayer.svelte`：地图、读数（每 125 ms 刷新一次，避免数字闪烁）、播放/暂停/重新播放、进度条（原生 range，键盘与读屏可用）、在自动节奏基础上的 1x/2x/5x/10x、全局/跟随（状态由地图模块回传，手动拖动后两个按钮都不按下）。
- `ActivityReplayDialog.svelte`：详情页“路线”标题区右侧、与“个人轨迹”标签同一行的入口，打开时才读取数据（页面会话内缓存），关闭即卸载播放器（取消 rAF、移除地图）。

## 第四阶段：视频导出（设计，未实现）

### 目标规格

| 画幅 | 720p | 1080p |
| --- | --- | --- |
| 9:16 | 720×1280 | 1080×1920 |
| 16:9 | 1280×720 | 1920×1080 |
| 1:1 | 720×720 | 1080×1080 |

时长 15/30/60 s，30 fps（分别为 450/900/1800 帧，60 fps 作为可选项）；回放速度 = 轨迹播放时长 ÷ 视频时长。叠加层显示距离、经过时间、配速，可选浅色或深色底图，默认无水印，输出 MP4（H.264）。

### 方案 A：浏览器端导出（推荐先做可行性验证）

逐帧渲染，不做实时录屏：

1. 在离屏容器里按目标尺寸新建一个导出专用的 MapLibre 实例（`pixelRatio: 1`，与可见播放器互不影响），复用 `installReplayLayers` 与 `createBasemapController`。
2. 对每一帧：`sampleAt(track, t)` → 更新图层与镜头 → 等待地图 `idle`（瓦片加载完成，设超时）→ 在 `render` 事件内同步把 `map.getCanvas()` 画到同尺寸的 `OffscreenCanvas`（或者导出实例开启 `preserveDrawingBuffer`）→ 用 Canvas 2D 画叠加层和底图署名 → `new VideoFrame(canvas, { timestamp })`。
3. `VideoEncoder` 编码 H.264（1080p 需要 High Profile Level 4.0 左右，例如 `avc1.640028`；720p 可用 `avc1.42001f`），先用 `VideoEncoder.isConfigSupported` 探测；通过 `encodeQueueSize` 控制背压，避免内存堆积。
4. 用 [Mediabunny](https://mediabunny.dev/)（MPL-2.0，零依赖，是已弃用的 mp4-muxer 的继任者）封装为 MP4，生成 Blob 后下载或调用系统分享。

评估：

- **瓦片与跨域**：现有地图已在 WebGL 中加载 OpenFreeMap 瓦片，WebGL 纹理要求 CORS，因此画布读回在原理上可行，但要实测 `getCanvas()` 在 `render` 事件中读取的结果。逐帧等待 `idle` 会成倍增加瓦片请求和耗时；应控制镜头运动，并遵守 OpenFreeMap 的公平使用条款。
- **安全与隐私**：轨迹始终留在浏览器，第三方只看到与正常浏览相同的视口瓦片请求。视频包含完整轨迹，导出入口应沿用 `ActivityPosterDialog` 的规则（仅本人视图），数据走需认证的本人接口。
- **编码兼容性**：Chrome/Edge 稳定；Safari 到 26 才完整支持 WebCodecs；Firefox 桌面版约从 130 起支持，Android 版不支持，且有已知的 AVC 编码问题（时间戳偏移、Windows/Linux 上 AVCC 记录错误，见 [Remotion 的整理](https://www.remotion.dev/docs/mediabunny/webcodecs-bugs)）。不支持时应明确提示“此浏览器无法导出视频”，不要静默降级成 WebM。
- **资源**：只消耗用户设备，服务器零成本。60 s、1080p、约 8 Mbps 的输出约 60 MB，应以分块写入方式减小内存峰值。导出时间取决于瓦片加载，需要实测。
- **署名**：OpenStreetMap / OpenMapTiles / OpenFreeMap 的署名是数据许可要求，不属于“水印”，应以小字绘入画面。

### 方案 B：Remotion 独立渲染服务（暂不采用）

- 需要一个独立的 Node 服务、无头 Chromium 和 ffmpeg（Remotion 自带），部署上要多一个 systemd 服务和任务队列，与“非容器化、模块化单体”的约束冲突，也增加运维面。
- 无头 Chromium 中跑 MapLibre WebGL：没有 GPU 时只能用软件渲染，速度慢；渲染器必须由服务器拉取瓦片，并经服务间凭据读取轨迹，隐私边界从浏览器移到服务器。
- 许可：个人、非营利组织、≤ 3 人的营利组织可免费使用，其余需要购买 Company License；官方说明 Remotion 5.0 会调整许可（[LICENSE](https://github.com/remotion-dev/remotion/blob/main/LICENSE.md)、[FAQ](https://www.remotion.dev/docs/license-pricing-compliance/faq)）。毕业设计可以免费用，但以后商用要重新评估。
- 适用场景：需要服务端批量生成、或者要求输出与设备无关时才考虑；无论如何，渲染**不进入 FastAPI 主进程**。

### 落地前的验证清单（原计划）

1. 可行性验证页面：分别在 Chrome、Safari 26、Firefox 上，测 9:16/1080p/30 s 的总耗时、单帧耗时和内存峰值。
2. 在各浏览器上跑 `isConfigSupported` 的编码配置矩阵。
3. 检查画布读回结果：不能是空白帧，深浅底图都要试。
4. 确认输出能在 iOS 相册、微信和主流播放器中正常播放。
5. 统计一次导出的瓦片请求数，并对照 OpenFreeMap 的使用条款。

可行性验证通过后，再写实施计划并实现。

### 实现结果（2026-11-20）

按方案 A 实现：`lib/replay/video-export.ts`（离屏地图逐帧渲染与编码）、`lib/replay/mp4.ts`（封装）、`ReplayVideoExport.svelte`（导出面板）。

- **没有引入 Mediabunny**，而是自写约 200 行的单轨 H.264 MP4 封装器（`ftyp`、`moov`（含 `avcC`、`stts`、`stss`、`stsz`、`stco`，乱序帧时加 `ctts`）、`mdat`，`moov` 在前便于边下边播）。原因：项目要求尽量少依赖，导出只需要“一条视频轨、无音频”这一种情形；当前环境的 pnpm 安装也受阻。代价是这部分格式代码由本项目维护，所以有逐个盒子的单元测试，并在真实 Chrome 中用 `ffprobe` 解码校验。
- **离屏地图**：CSS 尺寸为目标分辨率 ÷ `pixelRatio`（`pixelRatio` = 短边 / 540，标注和线宽接近手机屏幕上的观感），开启 `preserveDrawingBuffer`，不可交互，`fadeDuration: 0`。底图通过 `createBasemapController` 新增的 `fixed` 参数固定为 positron 或 dark；取景时为上下两块信息面板留出空间。
- **逐帧流程**：`sampleAt` → `layers.update` → 等待地图 `idle`（单帧最多等 4 s，超时就用已加载的内容）→ 地图画面画到 2D 画布 → 画跑者圆点、标题与日期、全程进度条、距离/用时/配速（模拟回放只显示距离与“模拟用时”）、记录汇总行，以及面板下方独立一行的 OSM/OpenMapTiles/OpenFreeMap 署名 → `VideoFrame` → `VideoEncoder`（依次尝试 High/Main/Baseline，720p 用 Level 3.1，1080p 用 Level 4.0；4/8 Mbps；每 2 s 一个关键帧；编码队列超过 4 帧就等待）。轨迹在“视频时长 − 1.5 s”内走完，最后 1.5 s 停在完整路线上。
- **权限**：与分享图相同，只有登录者查看本人记录时才显示“导出视频”（`viewsOwnRecords`，由 `ActivityPosterDialog` 的内联规则提取而来，两处共用）。
- **验证**：合成 UI 套件中导出 1:1、720p、15 s、深色地图（瓦片被拦截，所以是纯色背景）→ `ffprobe` 得到 `h264 High 720×720，30 fps，450 帧，15.0 s`。另外临时放行 OpenFreeMap，导出 9:16、720p、15 s、浅色地图：画面中有底图瓦片，确认画布读回在实际底图下可行；本机无 GPU 的无头 Chrome 用时 48 s。
- **尚未验证**：Safari、Firefox 实机；1080p、60 s 的耗时与内存；iOS 相册和微信中的播放；跟随镜头的视频（目前视频固定为全局取景，避免逐帧请求新瓦片）。
